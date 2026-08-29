import { equal } from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
  canonicalizeJson,
  CanonicalJsonError,
  encodeCanonicalJson,
  type CanonicalJsonErrorReason,
} from "../../../src/foundation/data/canonical-json.js";

function expectCanonicalJsonError(
  action: () => unknown,
  reason: CanonicalJsonErrorReason,
  expectedPath?: string,
): CanonicalJsonError {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }

  if (!(caught instanceof CanonicalJsonError)) {
    throw new Error("Expected CanonicalJsonError.");
  }
  equal(caught.name, "CanonicalJsonError");
  equal(caught.code, "wakeflow-canonical-json");
  equal(caught.reason, reason);
  if (expectedPath !== undefined) equal(caught.path, expectedPath);
  return caught;
}

test("RFC 8785 primitive serialization example is reproduced exactly", () => {
  const value = {
    numbers: [333333333.33333329, 1e30, 4.50, 2e-3, 1e-27],
    string: "€$\u000f\nA'B\"\\\\\"/",
    literals: [null, true, false],
  };
  const expected = String.raw`{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\u000f\nA'B\"\\\\\"/"}`;

  equal(canonicalizeJson(value), expected);
  equal(Buffer.from(encodeCanonicalJson(value)).toString("utf8"), expected);
  equal(canonicalizeJson(null), "null");
  equal(canonicalizeJson("plain"), "\"plain\"");
  equal(canonicalizeJson(1e30), "1e+30");
});

test("property names use recursive raw UTF-16 ordering while arrays keep order", () => {
  const value = {
    "\ufb33": "Hebrew",
    "😀": "Emoji",
    "€": "Euro",
    "ö": "Latin",
    "\u0080": "Control",
    "1": "One",
    "\r": "Carriage Return",
    nested: { z: 1, a: 2 },
    list: [{ z: 1, a: 2 }, "tail"],
  };
  const expected = String.raw`{"\r":"Carriage Return","1":"One","list":[{"a":2,"z":1},"tail"],"nested":{"a":2,"z":1},"":"Control","ö":"Latin","€":"Euro","😀":"Emoji","דּ":"Hebrew"}`;

  equal(canonicalizeJson(value), expected);
});

test("existing Wakeflow golden canonical bytes and digest stay unchanged", () => {
  const value = {
    z: 3,
    nested: { beta: 2, alpha: 1 },
    list: [{ y: true, x: null }, "tail"],
  };
  const expected = "{\"list\":[{\"x\":null,\"y\":true},\"tail\"],\"nested\":{\"alpha\":1,\"beta\":2},\"z\":3}";
  const expectedDigest = "04c388804319fd9e79ca995acf88a5be8f47a2e04634aa2dcae809c3514509cc";
  const bytes = encodeCanonicalJson(value);

  equal(canonicalizeJson(value), expected);
  equal(Buffer.from(bytes).toString("utf8"), expected);
  equal(createHash("sha256").update(bytes).digest("hex"), expectedDigest);
});

test("UTF-8 encoding returns independent byte arrays and preserves Unicode", () => {
  const first = encodeCanonicalJson({ decomposed: "e\u0301", composed: "\u00e9" });
  const second = encodeCanonicalJson({ decomposed: "e\u0301", composed: "\u00e9" });
  const expected = "{\"composed\":\"é\",\"decomposed\":\"é\"}";

  equal(Buffer.from(first).toString("utf8"), expected);
  equal(Buffer.from(second).toString("utf8"), expected);
  first[0] = 0;
  equal(Buffer.from(second).toString("utf8"), expected);
});

test("invalid input is mapped to one canonical error family without executing behavior", () => {
  expectCanonicalJsonError(
    () => canonicalizeJson({ list: [undefined] }),
    "unsupported-type",
    "$/list/0",
  );
  expectCanonicalJsonError(
    () => canonicalizeJson({ value: -0 }),
    "negative-zero",
    "$/value",
  );
  expectCanonicalJsonError(
    () => canonicalizeJson({ value: "\ud800" }),
    "lone-surrogate",
    "$/value",
  );

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
  expectCanonicalJsonError(
    () => canonicalizeJson({ nested: proxy }),
    "proxy",
    "$/nested",
  );
  equal(trapCalls, 0);

  let toJsonCalls = 0;
  expectCanonicalJsonError(
    () => canonicalizeJson({
      toJSON: () => {
        toJsonCalls += 1;
        return "not-data";
      },
    }),
    "unsupported-type",
    "$/toJSON",
  );
  equal(toJsonCalls, 0);

  equal(canonicalizeJson({ toJSON: "ordinary-data" }), "{\"toJSON\":\"ordinary-data\"}");
});

test("inherited toJSON hooks are rejected without execution", () => {
  for (const prototype of [Object.prototype, Array.prototype]) {
    const previous = Object.getOwnPropertyDescriptor(prototype, "toJSON");
    let hookCalls = 0;
    try {
      Object.defineProperty(prototype, "toJSON", {
        configurable: true,
        value: () => {
          hookCalls += 1;
          return "forged";
        },
      });
      const error = expectCanonicalJsonError(
        () => canonicalizeJson([true], "$.payload"),
        "canonicalizer-failure",
        "$.payload",
      );
      equal(error.message.includes("forged"), false);
      equal(hookCalls, 0);
    } finally {
      if (previous === undefined) Reflect.deleteProperty(prototype, "toJSON");
      else Object.defineProperty(prototype, "toJSON", previous);
    }
  }
});
