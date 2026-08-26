import { equal } from "node:assert/strict";
import { test } from "node:test";

import {
  CanonicalJsonError,
  encodeCanonicalJson,
} from "../../../src/foundation/data/canonical-json.js";
import {
  computeCanonicalJsonSha256Digest,
  computeCanonicalJsonSha256Hex,
} from "../../../src/foundation/crypto/canonical-json-sha256.js";
import {
  computeSha256Digest,
  computeSha256Hex,
  type Sha256Digest,
  type Sha256Hex,
} from "../../../src/foundation/crypto/sha256.js";

test("existing Wakeflow canonical JSON SHA-256 golden values stay unchanged", () => {
  const value = {
    z: 3,
    nested: { beta: 2, alpha: 1 },
    list: [{ y: true, x: null }, "tail"],
  };
  const expectedHex = "04c388804319fd9e79ca995acf88a5be8f47a2e04634aa2dcae809c3514509cc";
  const expectedDigest = `sha256:${expectedHex}`;
  const hex: Sha256Hex = computeCanonicalJsonSha256Hex(value);
  const digest: Sha256Digest = computeCanonicalJsonSha256Digest(value);

  equal(hex, expectedHex);
  equal(digest, expectedDigest);
});

test("object construction order is irrelevant while a data change changes the digest", () => {
  const first = {
    z: 3,
    nested: { beta: 2, alpha: 1 },
    list: [true, false],
  };
  const reordered = {
    list: [true, false],
    nested: { alpha: 1, beta: 2 },
    z: 3,
  };
  const changed = {
    list: [false, true],
    nested: { alpha: 1, beta: 2 },
    z: 3,
  };

  equal(
    computeCanonicalJsonSha256Digest(first),
    computeCanonicalJsonSha256Digest(reordered),
  );
  equal(
    computeCanonicalJsonSha256Digest(first)
      === computeCanonicalJsonSha256Digest(changed),
    false,
  );
});

test("composition is exactly canonical UTF-8 bytes followed by SHA-256", () => {
  const value = { text: "e\u0301", values: [null, true, 1e30] };
  const bytes = encodeCanonicalJson(value);

  equal(computeCanonicalJsonSha256Hex(value), computeSha256Hex(bytes));
  equal(computeCanonicalJsonSha256Digest(value), computeSha256Digest(bytes));
});

test("canonical input errors propagate with their original owner, reason, and path", () => {
  let trapCalls = 0;
  const proxy = new Proxy({ value: true }, {
    get: () => {
      trapCalls += 1;
      return undefined;
    },
    getOwnPropertyDescriptor: () => {
      trapCalls += 1;
      return undefined;
    },
    getPrototypeOf: () => {
      trapCalls += 1;
      return null;
    },
    ownKeys: () => {
      trapCalls += 1;
      return [];
    },
  });

  let caught: unknown;
  try {
    computeCanonicalJsonSha256Digest({ nested: proxy }, "$.payload");
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof CanonicalJsonError)) {
    throw new Error("Expected CanonicalJsonError.");
  }
  equal(caught.reason, "proxy");
  equal(caught.path, "$.payload/nested");
  equal(trapCalls, 0);
});
