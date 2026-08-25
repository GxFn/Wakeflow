import { deepEqual, equal } from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  assertFileByteRangeWithin,
  createFileByteRange,
  FileByteRangeError,
  parseFileByteOffset,
  parseFileByteRange,
  type FileByteOffset,
  type FileByteRange,
  type FileByteRangeErrorReason,
} from "../../../src/foundation/filesystem/file-byte-range.js";
import {
  MAX_SAFE_BYTE_COUNT,
  parseByteCount,
  type ByteCount,
} from "../../../src/foundation/numeric/byte-count.js";

function expectRangeError(
  action: () => unknown,
  reason: FileByteRangeErrorReason,
  expectedPath: string,
): FileByteRangeError {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof FileByteRangeError)) {
    throw new Error("Expected FileByteRangeError.");
  }
  equal(caught.name, "FileByteRangeError");
  equal(caught.code, "wakeflow-file-byte-range");
  equal(caught.reason, reason);
  equal(caught.path, expectedPath);
  return caught;
}

function asOffset(value: unknown): FileByteOffset {
  return value as FileByteOffset;
}

function asByteCount(value: unknown): ByteCount {
  return value as ByteCount;
}

function asRange(value: unknown): FileByteRange {
  return value as FileByteRange;
}

test("file byte offsets admit exactly non-negative safe integers", () => {
  equal(parseFileByteOffset(0), 0);
  equal(parseFileByteOffset(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);

  for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1", 1n, null]) {
    expectRangeError(
      () => parseFileByteOffset(value, "$.position"),
      "offset-range",
      "$.position",
    );
  }
});

test("range creation derives one frozen half-open boundary", () => {
  const range = createFileByteRange(
    parseFileByteOffset(5),
    parseByteCount(7),
  );
  deepEqual(range, { offset: 5, length: 7, endExclusive: 12 });
  equal(Object.isFrozen(range), true);

  const empty = createFileByteRange(
    parseFileByteOffset(Number.MAX_SAFE_INTEGER),
    parseByteCount(0),
  );
  equal(empty.offset, Number.MAX_SAFE_INTEGER);
  equal(empty.endExclusive, Number.MAX_SAFE_INTEGER);
});

test("range end arithmetic fails before safe-integer overflow", () => {
  expectRangeError(
    () => createFileByteRange(
      parseFileByteOffset(Number.MAX_SAFE_INTEGER),
      parseByteCount(1),
      "$.range",
    ),
    "end-overflow",
    "$.range",
  );
  expectRangeError(
    () => createFileByteRange(
      asOffset(-1),
      parseByteCount(1),
      "$.range",
    ),
    "offset-range",
    "$.range.offset",
  );
  expectRangeError(
    () => createFileByteRange(
      parseFileByteOffset(0),
      asByteCount(-1),
      "$.range",
    ),
    "length-range",
    "$.range.length",
  );
});

test("passive range parsing accepts only offset and length", () => {
  const range = parseFileByteRange({ offset: 3, length: 4 }, "$.range");
  deepEqual(range, { offset: 3, length: 4, endExclusive: 7 });

  for (const value of [
    {},
    { offset: 1 },
    { length: 1 },
    { offset: 1, length: 1, endExclusive: 2 },
    { offset: 1, length: 1, extra: true },
    [],
  ]) {
    expectRangeError(
      () => parseFileByteRange(value, "$.range"),
      "range-shape",
      "$.range",
    );
  }

  let getterCalls = 0;
  const accessor: Record<string, unknown> = { length: 1 };
  Object.defineProperty(accessor, "offset", {
    get: () => {
      getterCalls += 1;
      return 0;
    },
    enumerable: true,
  });
  expectRangeError(
    () => parseFileByteRange(accessor),
    "range-shape",
    "$range",
  );
  equal(getterCalls, 0);
});

test("file bounds accept full, interior, and zero-length EOF ranges", () => {
  const fileSize = parseByteCount(10);
  const ranges = [
    parseFileByteRange({ offset: 0, length: 10 }),
    parseFileByteRange({ offset: 2, length: 3 }),
    parseFileByteRange({ offset: 10, length: 0 }),
    parseFileByteRange({ offset: 0, length: 0 }),
  ];
  for (const range of ranges) {
    assertFileByteRangeWithin(range, fileSize);
  }
});

test("file bounds reject offset or end beyond EOF", () => {
  const fileSize = parseByteCount(10);
  for (const range of [
    parseFileByteRange({ offset: 11, length: 0 }),
    parseFileByteRange({ offset: 9, length: 2 }),
  ]) {
    expectRangeError(
      () => assertFileByteRangeWithin(range, fileSize, "$.range"),
      "out-of-bounds",
      "$.range",
    );
  }
});

test("bounds assertion revalidates forged range and file-size brands", () => {
  expectRangeError(
    () => assertFileByteRangeWithin(
      asRange({ offset: 1, length: 2, endExclusive: 9 }),
      parseByteCount(10),
      "$.range",
    ),
    "range-field",
    "$.range.endExclusive",
  );
  expectRangeError(
    () => assertFileByteRangeWithin(
      asRange({ offset: 0, length: 1, endExclusive: 1, extra: true }),
      parseByteCount(10),
      "$.range",
    ),
    "range-shape",
    "$.range",
  );
  expectRangeError(
    () => assertFileByteRangeWithin(
      parseFileByteRange({ offset: 0, length: 0 }),
      asByteCount(-1),
    ),
    "file-size",
    "$fileByteCount",
  );
});

test("file-byte-range is a pure passive numeric composition", () => {
  const source = readFileSync(
    path.join(
      process.cwd(),
      "src/foundation/filesystem/file-byte-range.ts",
    ),
    "utf8",
  );
  const imports = [...source.matchAll(/from\s+["']([^"']+)["']/gu)]
    .map((entry) => entry[1]);
  deepEqual(imports, [
    "../data/passive-own-data.js",
    "../numeric/byte-count.js",
  ]);
  equal(source.includes("node:fs"), false);
  equal(source.includes("class "), true);
  equal(source.includes("Buffer"), false);
  equal(source.includes("TextDecoder"), false);
  equal(source.includes("BigInt"), false);
  equal(MAX_SAFE_BYTE_COUNT, Number.MAX_SAFE_INTEGER);
});
