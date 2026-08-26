import { deepEqual, equal, throws } from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  createWakeflowDurableId,
  parseWakeflowDurableId,
  parseWakeflowDurableIdOfKind,
  WAKEFLOW_DURABLE_ID_KINDS,
  WakeflowDurableIdError,
  type ParsedWakeflowDurableId,
  type WakeflowDurableId,
  type WakeflowDurableIdErrorReason,
  type WakeflowDurableIdKind,
} from "../../../src/foundation/identity/wakeflow-durable-id.js";
import {
  createUuidV4,
  parseUuidV4,
  type UuidV4,
} from "../../../src/foundation/identity/uuid-v4.js";

const FIXED_UUID_TEXT = "12345678-90ab-4cde-8fab-1234567890ab";
const FIXED_UUID = parseUuidV4(FIXED_UUID_TEXT);

function expectWakeflowDurableIdError(
  action: () => unknown,
  reason: WakeflowDurableIdErrorReason,
  expectedPath: string,
): WakeflowDurableIdError {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }

  if (!(caught instanceof WakeflowDurableIdError)) {
    throw new Error("Expected WakeflowDurableIdError.");
  }
  equal(caught.name, "WakeflowDurableIdError");
  equal(caught.code, "wakeflow-durable-id");
  equal(caught.reason, reason);
  equal(caught.path, expectedPath);
  return caught;
}

function asDurableKind(value: unknown): WakeflowDurableIdKind {
  return value as WakeflowDurableIdKind;
}

function asUuidV4(value: unknown): UuidV4 {
  return value as UuidV4;
}

test("durable kind vocabulary is exact, derived, and runtime frozen", () => {
  const schema = JSON.parse(readFileSync(
    path.join(
      process.cwd(),
      "src/contracts/schemas/foundation/wakeflow-durable-id-kind.schema.json",
    ),
    "utf8",
  )) as { readonly enum?: unknown };
  if (!Array.isArray(schema.enum)) {
    throw new Error("Expected durable ID kind enum Schema.");
  }

  deepEqual(WAKEFLOW_DURABLE_ID_KINDS, schema.enum);
  equal(WAKEFLOW_DURABLE_ID_KINDS.length, 25);
  equal(WAKEFLOW_DURABLE_ID_KINDS.includes("demand-event-commit"), true);
  equal(Object.isFrozen(WAKEFLOW_DURABLE_ID_KINDS), true);
  throws(
    () => (WAKEFLOW_DURABLE_ID_KINDS as unknown as string[]).push("lease"),
    TypeError,
  );
});

test("creation preserves the exact kind in the branded return type", () => {
  const programId: WakeflowDurableId<"program"> =
    createWakeflowDurableId("program", FIXED_UUID);
  equal(programId, `program_${FIXED_UUID_TEXT}`);

  const broadId: WakeflowDurableId = programId;
  equal(broadId, programId);

  // @ts-expect-error program ID 不能赋给 window ID。
  const wrongKind: WakeflowDurableId<"window"> = programId;
  equal(wrongKind, programId);

  const uncheckedText: string = `program_${FIXED_UUID_TEXT}`;
  // @ts-expect-error 未经解析的普通 string 不能直接获得 durable ID 品牌。
  const uncheckedId: WakeflowDurableId<"program"> = uncheckedText;
  equal(uncheckedId, uncheckedText);
});

test("untyped parsing returns frozen discriminated lexical facts", () => {
  const value = `repository_${FIXED_UUID_TEXT}`;
  const parsed = parseWakeflowDurableId(value);

  deepEqual(parsed, {
    kind: "repository",
    uuid: FIXED_UUID_TEXT,
    value,
  });
  equal(Object.isFrozen(parsed), true);

  const facts: ParsedWakeflowDurableId = parsed;
  if (facts.kind === "repository") {
    const narrowed: WakeflowDurableId<"repository"> = facts.value;
    equal(narrowed, value);
  } else {
    throw new Error("Expected repository lexical facts.");
  }
});

test("kind-specific parsing returns the requested branded scalar", () => {
  const value = `task-package_${FIXED_UUID_TEXT}`;
  const taskPackageId: WakeflowDurableId<"task-package"> =
    parseWakeflowDurableIdOfKind(value, "task-package", "$.taskPackageId");

  equal(taskPackageId, value);
  expectWakeflowDurableIdError(
    () => parseWakeflowDurableIdOfKind(value, "target-task", "$.targetTaskId"),
    "kind-mismatch",
    "$.targetTaskId",
  );
});

test("parsing rejects malformed, unknown, non-durable, and invalid UUID values", () => {
  const invalidCases: readonly Readonly<{
    value: unknown;
    reason: WakeflowDurableIdErrorReason;
  }>[] = [
    { value: null, reason: "format" },
    { value: {}, reason: "format" },
    { value: FIXED_UUID_TEXT, reason: "format" },
    { value: `_ ${FIXED_UUID_TEXT}`, reason: "format" },
    { value: `program__${FIXED_UUID_TEXT}`, reason: "format" },
    { value: `PROGRAM_${FIXED_UUID_TEXT}`, reason: "kind-unknown" },
    { value: `binding_${FIXED_UUID_TEXT}`, reason: "kind-unknown" },
    { value: `lease_${FIXED_UUID_TEXT}`, reason: "kind-unknown" },
    {
      value: "program_12345678-90ab-7cde-8fab-1234567890ab",
      reason: "uuid-format",
    },
    {
      value: "program_12345678-90ab-4cde-cfab-1234567890ab",
      reason: "uuid-format",
    },
    { value: `program_${FIXED_UUID_TEXT.toUpperCase()}`, reason: "uuid-format" },
  ];

  for (const invalidCase of invalidCases) {
    expectWakeflowDurableIdError(
      () => parseWakeflowDurableId(invalidCase.value, "$.id"),
      invalidCase.reason,
      "$.id",
    );
  }
});

test("creation and expected-kind boundaries revalidate runtime values", () => {
  expectWakeflowDurableIdError(
    () => createWakeflowDurableId(asDurableKind("binding"), FIXED_UUID),
    "kind-unknown",
    "$kind",
  );
  expectWakeflowDurableIdError(
    () => createWakeflowDurableId("program", asUuidV4("not-a-uuid")),
    "uuid-format",
    "$uuid",
  );
  expectWakeflowDurableIdError(
    () => parseWakeflowDurableIdOfKind(
      `program_${FIXED_UUID_TEXT}`,
      asDurableKind("binding"),
      "$.id",
    ),
    "kind-unknown",
    "$expectedKind",
  );

  let conversionCalls = 0;
  const executableValue = {
    toString() {
      conversionCalls += 1;
      return `program_${FIXED_UUID_TEXT}`;
    },
  };
  expectWakeflowDurableIdError(
    () => parseWakeflowDurableId(executableValue, "$.id"),
    "format",
    "$.id",
  );
  equal(conversionCalls, 0);
});

test("default creation composes the official UUIDv4 source", () => {
  const demandId = createWakeflowDurableId("demand");
  const parsed = parseWakeflowDurableId(demandId);

  equal(parsed.kind, "demand");
  equal(parsed.value, demandId);
  equal(parsed.uuid.length, FIXED_UUID_TEXT.length);

  const injectedUuid = createUuidV4(() => FIXED_UUID_TEXT);
  equal(
    createWakeflowDurableId("evidence", injectedUuid),
    `evidence_${FIXED_UUID_TEXT}`,
  );
});

test("errors normalize paths and do not disclose rejected identity material", () => {
  const rejected = "private-kind_private-uuid";
  const error = expectWakeflowDurableIdError(
    () => parseWakeflowDurableId(rejected, ""),
    "kind-unknown",
    "$",
  );

  equal(error.message.includes("private-kind"), false);
  equal(error.message.includes("private-uuid"), false);
  equal("cause" in error, false);
});
