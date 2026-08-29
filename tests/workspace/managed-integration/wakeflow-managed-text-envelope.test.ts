import { deepEqual, equal, match } from "node:assert/strict";
import { test } from "node:test";

import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";
import {
  inspectWakeflowManagedTextEnvelope,
  recomposeWakeflowManagedTextEnvelope,
  removeWakeflowManagedTextEnvelope,
  WakeflowManagedTextEnvelopeError,
  type WakeflowManagedTextEnvelopeErrorReason,
} from "../../../src/workspace/managed-integration/wakeflow-managed-text-envelope.js";

const TARGET = Object.freeze({
  component: "host-instruction",
  owner: "host-instruction-integration",
  body: "# Wakeflow 指令\n\n- 保留用户内容。\n",
});
const UPDATED_TARGET = Object.freeze({
  ...TARGET,
  body: "# Wakeflow 指令\n\n- 保留用户内容。\n- 使用新 TypeScript 实现。\n",
});

function bytes(value: Uint8Array): Buffer {
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function expectEnvelopeError(
  action: () => unknown,
  reason: WakeflowManagedTextEnvelopeErrorReason,
  path: string,
): void {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof WakeflowManagedTextEnvelopeError, true);
  if (caught instanceof WakeflowManagedTextEnvelopeError) {
    equal(caught.code, "wakeflow-managed-text-envelope");
    equal(caught.reason, reason);
    equal(caught.path, path);
  }
}

test("managed text envelope recomposes and removes one byte-exact owned block", () => {
  const outside = encodeUtf8("\ufeff# 用户 e\u0301\r\n尾部无换行");
  const outsideSnapshot = Buffer.from(outside);
  const unmanaged = inspectWakeflowManagedTextEnvelope(outside);
  deepEqual(unmanaged, {
    kind: "unmanaged",
    sourceByteCount: outside.byteLength,
    sourceDigest: computeSha256Digest(outside),
    outsideDigest: computeSha256Digest(outside),
  });
  equal(Object.isFrozen(unmanaged), true);

  const inserted = recomposeWakeflowManagedTextEnvelope(outside, TARGET);
  equal(inserted.disposition, "inserted");
  equal(inserted.byteCount, inserted.bytes.byteLength);
  equal(inserted.digest, computeSha256Digest(inserted.bytes));
  deepEqual(bytes(inserted.bytes).subarray(0, outside.byteLength), outsideSnapshot);
  const rendered = bytes(inserted.bytes).toString("utf8");
  const bodyDigest = computeSha256Digest(encodeUtf8(TARGET.body));
  match(
    rendered,
    new RegExp(
      `\\n<!-- wakeflow:managed-content:v1:begin component=host-instruction owner=host-instruction-integration digest=${bodyDigest} sep=1 -->\\n`,
      "u",
    ),
  );
  match(
    rendered,
    new RegExp(
      `<!-- wakeflow:managed-content:v1:end component=host-instruction owner=host-instruction-integration digest=${bodyDigest} sep=1 -->\\n$`,
      "u",
    ),
  );

  const inspection = inspectWakeflowManagedTextEnvelope(inserted.bytes);
  equal(inspection.kind, "managed");
  if (inspection.kind !== "managed") {
    throw new Error("Expected one managed envelope.");
  }
  equal(inspection.component, TARGET.component);
  equal(inspection.owner, TARGET.owner);
  equal(inspection.body, TARGET.body);
  equal(inspection.bodyDigest, bodyDigest);
  equal(inspection.separator, "owned-leading-lf");
  equal(inspection.sourceDigest, inserted.digest);
  equal(inspection.outsideDigest, computeSha256Digest(outsideSnapshot));
  equal(inspection.prefixOutsideRange.offset, 0);
  equal(inspection.prefixOutsideRange.length, outside.byteLength);
  equal(inspection.ownedRange.offset, outside.byteLength);
  equal(inspection.suffixOutsideRange.length, 0);
  equal(Object.isFrozen(inspection), true);
  equal(Object.isFrozen(inspection.ownedRange), true);

  const current = recomposeWakeflowManagedTextEnvelope(
    inserted.bytes,
    TARGET,
  );
  equal(current.disposition, "current");
  deepEqual(bytes(current.bytes), bytes(inserted.bytes));

  const suffix = encodeUtf8("用户后缀\r\n");
  const withSuffix = Buffer.concat([bytes(inserted.bytes), suffix]);
  const updated = recomposeWakeflowManagedTextEnvelope(
    withSuffix,
    UPDATED_TARGET,
  );
  equal(updated.disposition, "updated");
  deepEqual(bytes(updated.bytes).subarray(0, outside.byteLength), outsideSnapshot);
  deepEqual(bytes(updated.bytes).subarray(-suffix.byteLength), bytes(suffix));
  const updatedInspection = inspectWakeflowManagedTextEnvelope(updated.bytes);
  equal(updatedInspection.kind, "managed");
  if (updatedInspection.kind === "managed") {
    equal(updatedInspection.body, UPDATED_TARGET.body);
    equal(updatedInspection.suffixOutsideRange.length, suffix.byteLength);
  }

  const removed = removeWakeflowManagedTextEnvelope(updated.bytes, {
    component: TARGET.component,
    owner: TARGET.owner,
  });
  equal(removed.disposition, "removed");
  deepEqual(
    bytes(removed.bytes),
    Buffer.concat([outsideSnapshot, suffix]),
  );
  equal(removed.digest, computeSha256Digest(removed.bytes));
});

test("managed text envelope rejects malformed, foreign, and behavioral input", () => {
  const valid = bytes(recomposeWakeflowManagedTextEnvelope(
    encodeUtf8("用户前缀\n"),
    TARGET,
  ).bytes);
  const text = valid.toString("utf8");
  const begin = text.match(
    /<!-- wakeflow:managed-content:v1:begin[^\n]+ -->/u,
  )?.[0];
  const end = text.match(
    /<!-- wakeflow:managed-content:v1:end[^\n]+ -->/u,
  )?.[0];
  if (begin === undefined || end === undefined) {
    throw new Error("Managed marker fixture is unavailable.");
  }

  const malformedCases = [
    {
      name: "duplicate",
      source: Buffer.concat([valid, valid]),
      reason: "marker" as const,
      path: "$marker",
    },
    {
      name: "orphan",
      source: encodeUtf8(text.replace(`${end}\n`, "")),
      reason: "marker" as const,
      path: "$marker",
    },
    {
      name: "reversed",
      source: encodeUtf8(
        text
          .replace(begin, "__WAKEFLOW_BEGIN__")
          .replace(end, begin)
          .replace("__WAKEFLOW_BEGIN__", end),
      ),
      reason: "marker-pair" as const,
      path: "$marker",
    },
    {
      name: "body-tamper",
      source: encodeUtf8(text.replace("保留用户内容", "修改用户内容")),
      reason: "body-digest" as const,
      path: "$body",
    },
    {
      name: "end-owner-mismatch",
      source: encodeUtf8(text.replace(
        end,
        end.replace(
          "owner=host-instruction-integration",
          "owner=foreign-owner",
        ),
      )),
      reason: "marker-pair" as const,
      path: "$marker",
    },
    {
      name: "end-separator-mismatch",
      source: encodeUtf8(text.replace(end, end.replace("sep=0", "sep=1"))),
      reason: "marker-pair" as const,
      path: "$marker",
    },
    {
      name: "marker-crlf",
      source: encodeUtf8(text.replace(`${begin}\n`, `${begin}\r\n`)),
      reason: "marker" as const,
      path: "$marker",
    },
  ];
  for (const current of malformedCases) {
    expectEnvelopeError(
      () => inspectWakeflowManagedTextEnvelope(current.source),
      current.reason,
      current.path,
    );
  }

  for (const body of [
    "missing newline",
    "crlf\r\n",
    "decomposed e\u0301\n",
    "\ufeffbom\n",
    "two newlines\n\n",
  ]) {
    expectEnvelopeError(
      () => recomposeWakeflowManagedTextEnvelope(valid, {
        ...TARGET,
        body,
      }),
      "body-profile",
      "$target.body",
    );
  }
  expectEnvelopeError(
    () => inspectWakeflowManagedTextEnvelope(
      Uint8Array.from([0xc3, 0x28]),
    ),
    "utf8",
    "$source",
  );
  expectEnvelopeError(
    () => inspectWakeflowManagedTextEnvelope(encodeUtf8(
      "<!-- wakeflow:managed-content:v2:begin component=future -->\n",
    )),
    "marker",
    "$marker",
  );
  expectEnvelopeError(
    () => recomposeWakeflowManagedTextEnvelope(valid, {
      ...TARGET,
      owner: "foreign-owner",
    }),
    "relation",
    "$target",
  );
  expectEnvelopeError(
    () => removeWakeflowManagedTextEnvelope(valid, {
      component: "foreign-component",
      owner: TARGET.owner,
    }),
    "relation",
    "$identity",
  );

  const sharedSource = new Uint8Array(new SharedArrayBuffer(4));
  sharedSource.set(encodeUtf8("text"));
  expectEnvelopeError(
    () => inspectWakeflowManagedTextEnvelope(sharedSource),
    "input",
    "$source",
  );

  let trapCalls = 0;
  const byteProxy = new Proxy(Uint8Array.from([0x61]), {
    get: () => {
      trapCalls += 1;
      return undefined;
    },
  });
  expectEnvelopeError(
    () => inspectWakeflowManagedTextEnvelope(byteProxy),
    "input",
    "$source",
  );
  const targetProxy = new Proxy({ ...TARGET }, {
    get: () => {
      trapCalls += 1;
      return undefined;
    },
    ownKeys: () => {
      trapCalls += 1;
      return [];
    },
  });
  expectEnvelopeError(
    () => recomposeWakeflowManagedTextEnvelope(valid, targetProxy),
    "input",
    "$target",
  );
  equal(trapCalls, 0);

  const mutableSource = encodeUtf8("alias source");
  const recomposed = recomposeWakeflowManagedTextEnvelope(
    mutableSource,
    TARGET,
  );
  mutableSource.fill(0);
  equal(bytes(recomposed.bytes).includes(0), false);
});
