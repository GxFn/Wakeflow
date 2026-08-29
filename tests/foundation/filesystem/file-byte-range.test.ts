import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  createFileByteRange,
  FileByteRangeError,
  parseFileByteOffset,
  type FileByteOffset,
  type FileByteRangeErrorReason,
} from "../../../src/foundation/filesystem/file-byte-range.js";
import {
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
