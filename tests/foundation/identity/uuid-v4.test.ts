import { deepEqual, equal, notEqual } from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  createUuidV4,
  parseUuidV4,
  UuidV4Error,
  type UuidV4,
  type UuidV4ErrorReason,
  type UuidV4Factory,
} from "../../../src/foundation/identity/uuid-v4.js";

function expectUuidV4Error(
  action: () => unknown,
  reason: UuidV4ErrorReason,
  expectedPath: string,
): UuidV4Error {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }

  if (!(caught instanceof UuidV4Error)) {
    throw new Error("Expected UuidV4Error.");
  }
  equal(caught.name, "UuidV4Error");
  equal(caught.code, "wakeflow-uuid-v4");
  equal(caught.reason, reason);
  equal(caught.path, expectedPath);
  return caught;
}

function asUuidV4Factory(value: unknown): UuidV4Factory {
  return value as UuidV4Factory;
}

test("canonical lowercase UUIDv4 values receive the UuidV4 brand", () => {
  const values = [
    "00000000-0000-4000-8000-000000000000",
    "aaaaaaaa-aaaa-4aaa-9aaa-aaaaaaaaaaaa",
    "bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb",
    "ffffffff-ffff-4fff-bfff-ffffffffffff",
  ] as const;

  for (const value of values) {
    const uuid: UuidV4 = parseUuidV4(value);
    equal(uuid, value);
  }

  const uncheckedText: string = values[0];
  // @ts-expect-error 未经解析的普通 string 不能直接获得 UuidV4 品牌。
  const uncheckedUuid: UuidV4 = uncheckedText;
  equal(uncheckedUuid, uncheckedText);
});

test("parsing rejects aliases, other versions, variants, and non-strings", () => {
  const valid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const invalid: readonly unknown[] = [
    null,
    1,
    {},
    valid.toUpperCase(),
    ` ${valid}`,
    `${valid}\n`,
    `{${valid}}`,
    `urn:uuid:${valid}`,
    "00000000-0000-0000-0000-000000000000",
    "ffffffff-ffff-ffff-ffff-ffffffffffff",
    "aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa",
    "aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa",
    "aaaaaaaa-aaaa-4aaa-0aaa-aaaaaaaaaaaa",
    "aaaaaaaa-aaaa-4aaa-7aaa-aaaaaaaaaaaa",
    "aaaaaaaa-aaaa-4aaa-caaa-aaaaaaaaaaaa",
    "aaaaaaaa-aaaa-4aaa-faaa-aaaaaaaaaaaa",
    "aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa",
  ];

  for (const value of invalid) {
    expectUuidV4Error(
      () => parseUuidV4(value, "$.identity"),
      "format",
      "$.identity",
    );
  }
});

test("custom factories are called once and their valid result is branded", () => {
  const expected = "12345678-90ab-4cde-8fab-1234567890ab";
  let calls = 0;
  const uuid = createUuidV4(() => {
    calls += 1;
    return expected;
  });

  const branded: UuidV4 = uuid;
  equal(branded, expected);
  equal(calls, 1);
});

test("factory boundaries reject invalid sources without coercing results", () => {
  expectUuidV4Error(
    () => createUuidV4(asUuidV4Factory(null)),
    "factory-type",
    "$uuidFactory",
  );

  const sourceFailure = new Error("private source failure");
  const failure = expectUuidV4Error(
    () => createUuidV4(() => {
      throw sourceFailure;
    }),
    "factory-failure",
    "$uuidFactory",
  );
  equal(failure.message.includes(sourceFailure.message), false);
  equal("cause" in failure, false);

  let conversionCalls = 0;
  const executableResult = {
    toString() {
      conversionCalls += 1;
      return "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    },
  };
  const resultFailure = expectUuidV4Error(
    () => createUuidV4(asUuidV4Factory(() => executableResult)),
    "factory-result",
    "$uuidFactory",
  );
  equal(conversionCalls, 0);
  equal(resultFailure.message.includes("aaaaaaaa"), false);

  expectUuidV4Error(
    () => createUuidV4(() => "aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa"),
    "factory-result",
    "$uuidFactory",
  );
});

test("Node.js default generation returns canonical UUIDv4 values", () => {
  const generated = Array.from({ length: 32 }, () => createUuidV4());

  for (const uuid of generated) {
    equal(parseUuidV4(uuid), uuid);
    equal(uuid.length, 36);
  }
  equal(new Set(generated).size, generated.length);
  notEqual(generated[0], generated[1]);
});

test("errors normalize empty paths and do not disclose rejected values", () => {
  const rejected = "private-invalid-uuid";
  const error = expectUuidV4Error(
    () => parseUuidV4(rejected, ""),
    "format",
    "$",
  );

  equal(error.message.includes(rejected), false);
  equal("cause" in error, false);
});

test("uuid-v4 has one official runtime dependency and no domain coupling", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/foundation/identity/uuid-v4.ts"),
    "utf8",
  );
  const imports = [...source.matchAll(/from\s+["']([^"']+)["']/gu)]
    .map((entry) => entry[1]);

  deepEqual(imports, ["node:crypto"]);
  equal(source.includes("randomUUID"), true);
  equal(source.includes("canonical-json"), false);
  equal(source.includes("WakeflowId"), false);
});
