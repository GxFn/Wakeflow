import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  Sha256Hasher,
  Sha256HasherError,
  type Sha256HasherErrorReason,
} from "../../../src/foundation/crypto/sha256-hasher.js";
import {
  computeSha256Digest,
  computeSha256Hex,
} from "../../../src/foundation/crypto/sha256.js";

const encoder = new TextEncoder();

function expectSha256HasherError(
  action: () => unknown,
  reason: Sha256HasherErrorReason,
  expectedPath: string,
): Sha256HasherError {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }

  if (!(caught instanceof Sha256HasherError)) {
    throw new Error("Expected Sha256HasherError.");
  }
  equal(caught.name, "Sha256HasherError");
  equal(caught.code, "wakeflow-sha256-hasher");
  equal(caught.reason, reason);
  equal(caught.path, expectedPath);
  return caught;
}

function asBytes(value: unknown): Uint8Array {
  return value as Uint8Array;
}

test("incremental chunks match the existing one-shot SHA-256 contract", () => {
  const text = "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";
  const bytes = encoder.encode(text);
  const hasher = new Sha256Hasher();

  hasher
    .update(bytes.subarray(0, 1))
    .update(bytes.subarray(1, 17))
    .update(bytes.subarray(17, 43))
    .update(bytes.subarray(43));

  const result = hasher.digest();
  equal(result.byteCount, bytes.byteLength);
  equal(result.hex, computeSha256Hex(bytes));
  equal(result.digest, computeSha256Digest(bytes));
  equal(Object.isFrozen(result), true);
});

test("an untouched hasher produces the standard empty SHA-256 digest", () => {
  const result = new Sha256Hasher().digest();

  equal(result.byteCount, 0);
  equal(
    result.hex,
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
  equal(result.digest, `sha256:${result.hex}`);
});

test("Buffer and offset views contribute only their exact visible bytes", () => {
  const hasher = new Sha256Hasher();
  const storage = Uint8Array.from([0xff, 0x61, 0x62, 0x63, 0xee]);
  const view = new Uint8Array(storage.buffer, 1, 3);
  const before = [...storage];

  const returned = hasher.update(Buffer.from("", "utf8")).update(view);
  equal(returned, hasher);
  const result = hasher.digest();

  equal(result.byteCount, 3);
  equal(result.hex, computeSha256Hex(encoder.encode("abc")));
  deepEqual([...storage], before);
});

test("byte counts accumulate exactly across many chunks", () => {
  const hasher = new Sha256Hasher();
  const chunks = Array.from(
    { length: 257 },
    (_unused, index) => Uint8Array.from({ length: index % 31 }, () => index),
  );
  const expectedBytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));

  let expectedCount = 0;
  for (const chunk of chunks) {
    hasher.update(chunk);
    expectedCount += chunk.byteLength;
    equal(hasher.byteCount, expectedCount);
  }

  const result = hasher.digest();
  equal(result.byteCount, expectedBytes.byteLength);
  equal(result.digest, computeSha256Digest(expectedBytes));
});

test("invalid inputs are rejected before mutating an active hasher", () => {
  const hasher = new Sha256Hasher();
  const invalid: readonly unknown[] = [
    "abc",
    [0x61, 0x62, 0x63],
    new Uint16Array([0x6162]),
    new DataView(new ArrayBuffer(3)),
    new ArrayBuffer(3),
  ];

  for (const value of invalid) {
    expectSha256HasherError(
      () => hasher.update(asBytes(value), "$.chunk"),
      "input-type",
      "$.chunk",
    );
    equal(hasher.byteCount, 0);
  }

  hasher.update(encoder.encode("abc"));
  equal(hasher.digest().hex, computeSha256Hex(encoder.encode("abc")));
});

test("Proxy byte views are rejected without invoking traps", () => {
  let trapCalls = 0;
  const proxy = new Proxy(new Uint8Array([0x61]), {
    getPrototypeOf: () => {
      trapCalls += 1;
      return Uint8Array.prototype;
    },
  });
  const hasher = new Sha256Hasher();

  expectSha256HasherError(
    () => hasher.update(asBytes(proxy), "$.chunk"),
    "input-type",
    "$.chunk",
  );
  equal(trapCalls, 0);
  equal(hasher.byteCount, 0);
});

test("digest and update cannot be repeated after finalization", () => {
  const hasher = new Sha256Hasher();
  hasher.update(encoder.encode("abc"));
  hasher.digest();

  const updateError = expectSha256HasherError(
    () => hasher.update(encoder.encode("def")),
    "already-finalized",
    "$hasher",
  );
  equal(updateError.message.includes("abc"), false);

  expectSha256HasherError(
    () => hasher.digest(),
    "already-finalized",
    "$hasher",
  );
  equal(hasher.byteCount, 3);
});

test("large deterministic input hashes without a combined string conversion", () => {
  const hasher = new Sha256Hasher();
  const chunk = Uint8Array.from(
    { length: 64 * 1024 },
    (_unused, index) => index % 251,
  );
  const repeats = 16;

  for (let index = 0; index < repeats; index += 1) hasher.update(chunk);
  const expected = Buffer.concat(
    Array.from({ length: repeats }, () => Buffer.from(chunk)),
  );
  const result = hasher.digest();

  equal(result.byteCount, expected.byteLength);
  equal(result.digest, computeSha256Digest(expected));
});
