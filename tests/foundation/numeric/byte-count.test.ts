import { deepEqual, equal } from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  addByteCounts,
  byteCountFromBigInt,
  ByteCountError,
  MAX_SAFE_BYTE_COUNT,
  parseByteCount,
  subtractByteCounts,
  type ByteCount,
  type ByteCountErrorReason,
} from "../../../src/foundation/numeric/byte-count.js";

function expectByteCountError(
  action: () => unknown,
  reason: ByteCountErrorReason,
  expectedPath: string,
): ByteCountError {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }

  if (!(caught instanceof ByteCountError)) {
    throw new Error("Expected ByteCountError.");
  }
  equal(caught.name, "ByteCountError");
  equal(caught.code, "wakeflow-byte-count");
  equal(caught.reason, reason);
  equal(caught.path, expectedPath);
  return caught;
}

function asByteCount(value: unknown): ByteCount {
  return value as ByteCount;
}

function asBigInt(value: unknown): bigint {
  return value as bigint;
}

test("non-negative safe integer numbers receive the ByteCount brand", () => {
  const cases = [0, 1, 4_096, Number.MAX_SAFE_INTEGER] as const;

  equal(MAX_SAFE_BYTE_COUNT, Number.MAX_SAFE_INTEGER);
  for (const value of cases) {
    const count: ByteCount = parseByteCount(value);
    equal(count, value);
  }
});

test("number parsing rejects negative, fractional, unsafe, and coerced inputs", () => {
  const invalid: readonly unknown[] = [
    -1,
    0.5,
    Number.MAX_SAFE_INTEGER + 1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    0n,
    "1",
    null,
  ];

  for (const value of invalid) {
    expectByteCountError(
      () => parseByteCount(value, "$.bytes"),
      "number-range",
      "$.bytes",
    );
  }
});

test("BigInt conversion is exact across the complete safe integer range", () => {
  const cases = [
    [0n, 0],
    [1n, 1],
    [4_294_967_296n, 4_294_967_296],
    [BigInt(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
  ] as const;

  for (const [value, expected] of cases) {
    const count: ByteCount = byteCountFromBigInt(value);
    equal(count, expected);
  }
});

test("BigInt conversion rejects negative, oversized, and non-BigInt inputs", () => {
  const invalid: readonly unknown[] = [
    -1n,
    BigInt(Number.MAX_SAFE_INTEGER) + 1n,
    0,
    "1",
    null,
  ];

  for (const value of invalid) {
    expectByteCountError(
      () => byteCountFromBigInt(asBigInt(value), "$.stat.size"),
      "bigint-range",
      "$.stat.size",
    );
  }
});

test("checked addition preserves exact values and rejects overflow", () => {
  const cases = [
    [0, 0, 0],
    [1, 2, 3],
    [Number.MAX_SAFE_INTEGER - 1, 1, Number.MAX_SAFE_INTEGER],
  ] as const;

  for (const [left, right, expected] of cases) {
    equal(
      addByteCounts(parseByteCount(left), parseByteCount(right)),
      expected,
    );
  }

  const error = expectByteCountError(
    () => addByteCounts(
      parseByteCount(Number.MAX_SAFE_INTEGER),
      parseByteCount(1),
      "$.treeBytes",
    ),
    "addition-overflow",
    "$.treeBytes",
  );
  equal(error.message.includes(String(Number.MAX_SAFE_INTEGER)), false);
});

test("checked subtraction preserves zero and rejects negative results", () => {
  const cases = [
    [0, 0, 0],
    [3, 1, 2],
    [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 0],
  ] as const;

  for (const [total, part, expected] of cases) {
    equal(
      subtractByteCounts(parseByteCount(total), parseByteCount(part)),
      expected,
    );
  }

  expectByteCountError(
    () => subtractByteCounts(
      parseByteCount(1),
      parseByteCount(2),
      "$.remaining",
    ),
    "subtraction-underflow",
    "$.remaining",
  );
});

test("arithmetic revalidates forged ByteCount inputs at member paths", () => {
  expectByteCountError(
    () => addByteCounts(asByteCount(-1), parseByteCount(1)),
    "number-range",
    "$left",
  );
  expectByteCountError(
    () => addByteCounts(parseByteCount(1), asByteCount(0.5), "$.sum"),
    "number-range",
    "$.sum.right",
  );
  expectByteCountError(
    () => subtractByteCounts(asByteCount("2"), parseByteCount(1)),
    "number-range",
    "$total",
  );
  expectByteCountError(
    () => subtractByteCounts(parseByteCount(2), asByteCount(-1), "$.diff"),
    "number-range",
    "$.diff.part",
  );
});

test("ByteCount is distinct from an unchecked number", () => {
  const raw: number = 10;

  // @ts-expect-error 未经准入的 number 不能直接获得 ByteCount 品牌。
  const unchecked: ByteCount = raw;
  equal(unchecked, raw);

  const checked: ByteCount = parseByteCount(raw);
  equal(checked, raw);
});

test("byte-count is a pure numeric primitive without runtime dependencies", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/foundation/numeric/byte-count.ts"),
    "utf8",
  );
  const imports = [...source.matchAll(/from\s+["']([^"']+)["']/gu)]
    .map((entry) => entry[1]);

  deepEqual(imports, []);
  equal(source.includes("node:"), false);
  equal(source.includes("Buffer."), false);
  equal(source.includes("statSync"), false);
  equal(source.includes("MAX_SAFE_BYTE_COUNT"), true);
});
