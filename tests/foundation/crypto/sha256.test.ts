import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  computeSha256Digest,
  computeSha256Hex,
  parseSha256Digest,
  parseSha256Hex,
  SHA256_DIGEST_PREFIX,
  Sha256Error,
  type Sha256Digest,
  type Sha256ErrorReason,
  type Sha256Hex,
} from "../../../src/foundation/crypto/sha256.js";

const encoder = new TextEncoder();

function expectSha256Error(
  action: () => unknown,
  reason: Sha256ErrorReason,
  expectedPath?: string,
): Sha256Error {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }

  if (!(caught instanceof Sha256Error)) {
    throw new Error("Expected Sha256Error.");
  }
  equal(caught.name, "Sha256Error");
  equal(caught.code, "wakeflow-sha256");
  equal(caught.reason, reason);
  if (expectedPath !== undefined) equal(caught.path, expectedPath);
  return caught;
}

function asBytes(value: unknown): Uint8Array {
  return value as Uint8Array;
}

test("NIST SHA-256 vectors produce exact lowercase hex and prefixed digests", () => {
  const vectors = [
    {
      input: "",
      expected: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    },
    {
      input: "abc",
      expected: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    },
    {
      input: "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
      expected: "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    },
  ] as const;

  equal(SHA256_DIGEST_PREFIX, "sha256:");
  for (const vector of vectors) {
    const bytes = encoder.encode(vector.input);
    equal(computeSha256Hex(bytes), vector.expected);
    equal(computeSha256Digest(bytes), `sha256:${vector.expected}`);
  }
});

test("Buffer and offset Uint8Array views hash only their exact visible bytes", () => {
  const expected = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
  equal(computeSha256Hex(Buffer.from("abc", "utf8")), expected);

  const storage = Uint8Array.from([0xff, 0x61, 0x62, 0x63, 0xee]);
  const view = new Uint8Array(storage.buffer, 1, 3);
  const before = [...storage];
  equal(computeSha256Hex(view), expected);
  deepEqual([...storage], before);
});

test("validated hex and digest strings receive their distinct branded types", () => {
  const hexValue = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
  const digestValue = `sha256:${hexValue}`;
  const hex: Sha256Hex = parseSha256Hex(hexValue);
  const digest: Sha256Digest = parseSha256Digest(digestValue);

  equal(hex, hexValue);
  equal(digest, digestValue);
});

test("hex and prefixed digest parsing is exact, lowercase, and non-coercive", () => {
  const hexValue = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
  const invalidHex: readonly unknown[] = [
    null,
    1,
    hexValue.toUpperCase(),
    hexValue.slice(1),
    `${hexValue}0`,
    `sha256:${hexValue}`,
  ];
  for (const value of invalidHex) {
    expectSha256Error(
      () => parseSha256Hex(value, "$.hex"),
      "hex-format",
      "$.hex",
    );
  }

  const invalidDigest: readonly unknown[] = [
    null,
    1,
    hexValue,
    `SHA256:${hexValue}`,
    `sha256:${hexValue.toUpperCase()}`,
    `sha256:${hexValue.slice(1)}`,
    `sha256:${hexValue}0`,
  ];
  for (const value of invalidDigest) {
    expectSha256Error(
      () => parseSha256Digest(value, "$.digest"),
      "digest-format",
      "$.digest",
    );
  }
});

test("hashing rejects non-Uint8Array inputs without invoking proxy traps", () => {
  const invalid: readonly unknown[] = [
    "abc",
    [0x61, 0x62, 0x63],
    new Uint16Array([0x6162]),
    new DataView(new ArrayBuffer(3)),
    new ArrayBuffer(3),
  ];
  for (const value of invalid) {
    expectSha256Error(
      () => computeSha256Hex(asBytes(value), "$.bytes"),
      "input-type",
      "$.bytes",
    );
  }

  let trapCalls = 0;
  const proxy = new Proxy(new Uint8Array([0x61]), {
    getPrototypeOf: () => {
      trapCalls += 1;
      return Uint8Array.prototype;
    },
  });
  expectSha256Error(
    () => computeSha256Digest(asBytes(proxy), "$.bytes"),
    "input-type",
    "$.bytes",
  );
  equal(trapCalls, 0);
});
