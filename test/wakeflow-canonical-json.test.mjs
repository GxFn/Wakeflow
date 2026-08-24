import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalJson,
  canonicalJsonBytes,
  canonicalJsonDigest,
  canonicalJsonDigestHex,
} from "../core/scripts/lib/wakeflow-canonical-json.mjs";

const canonicalFixture = {
  z: 3,
  nested: { beta: 2, alpha: 1 },
  list: [{ y: true, x: null }, "tail"],
};

test("canonical JSON sorts object keys recursively while preserving array order", () => {
  const expected = "{\"list\":[{\"x\":null,\"y\":true},\"tail\"],\"nested\":{\"alpha\":1,\"beta\":2},\"z\":3}";
  assert.equal(canonicalJson(canonicalFixture), expected);
  assert.equal(
    canonicalJson({ nested: { alpha: 1, beta: 2 }, list: [{ x: null, y: true }, "tail"], z: 3 }),
    expected,
  );
});

test("canonical JSON rejects values outside the lossless JSON data model", () => {
  const hidden = { visible: true };
  Object.defineProperty(hidden, "hidden", { value: "not represented", enumerable: false });
  const accessor = {};
  Object.defineProperty(accessor, "computed", { get: () => "not stable", enumerable: true });
  const arrayWithExtra = [];
  arrayWithExtra.note = "not represented";
  const invalid = [
    { value: { omitted: undefined }, path: "$/omitted" },
    { value: { nonFinite: Number.NaN }, path: "$/nonFinite" },
    { value: { date: new Date("2026-08-06T00:00:00.000Z") }, path: "$/date" },
    { value: [, "tail"], path: "$/0" },
    { value: hidden, path: "$/hidden" },
    { value: accessor, path: "$/computed" },
    { value: arrayWithExtra, path: "$/note" },
  ];
  const cyclic = {};
  cyclic.self = cyclic;
  invalid.push({ value: cyclic, path: "$/self" });
  for (const { value, path } of invalid) {
    assert.throws(
      () => canonicalJson(value),
      (error) => error?.code === "wakeflow-canonical-json-domain" && error.path === path,
    );
  }
});

test("canonical JSON rejects foreign prototypes without executing their constructor accessor", () => {
  let getterCalls = 0;
  const prototype = {};
  Object.defineProperty(prototype, "constructor", {
    get() {
      getterCalls += 1;
      return class ForgedConstructor {};
    },
  });
  const value = Object.create(prototype);
  assert.throws(
    () => canonicalJson(value),
    (error) => error?.code === "wakeflow-canonical-json-domain" && error.path === "$",
  );
  assert.equal(getterCalls, 0);
});

test("canonical JSON rejects decorated arrays and excessive depth before serialization", () => {
  let getterCalls = 0;
  const decorated = ["value"];
  const prototype = Object.create(Array.prototype);
  Object.defineProperty(prototype, "authority", {
    get() {
      getterCalls += 1;
      return "forged";
    },
  });
  Object.setPrototypeOf(decorated, prototype);
  assert.throws(
    () => canonicalJson(decorated),
    (error) => error?.code === "wakeflow-canonical-json-domain" && error.path === "$",
  );
  assert.equal(getterCalls, 0);

  let nested = null;
  for (let depth = 0; depth < 256; depth += 1) nested = [nested];
  assert.throws(
    () => canonicalJson(nested),
    (error) => error?.code === "wakeflow-canonical-json-domain"
      && error.details?.maximumDepth === 128,
  );
});

test("canonical JSON never invokes inherited toJSON hooks", () => {
  let objectCalls = 0;
  let arrayCalls = 0;
  const previousObjectHook = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON");
  const previousArrayHook = Object.getOwnPropertyDescriptor(Array.prototype, "toJSON");
  try {
    Object.defineProperty(Object.prototype, "toJSON", {
      configurable: true,
      value() {
        objectCalls += 1;
        return "forged-object";
      },
    });
    Object.defineProperty(Array.prototype, "toJSON", {
      configurable: true,
      value() {
        arrayCalls += 1;
        return "forged-array";
      },
    });
    assert.equal(canonicalJson({ list: ["safe"] }), "{\"list\":[\"safe\"]}");
    assert.equal(objectCalls, 0);
    assert.equal(arrayCalls, 0);
  } finally {
    if (previousObjectHook) Object.defineProperty(Object.prototype, "toJSON", previousObjectHook);
    else delete Object.prototype.toJSON;
    if (previousArrayHook) Object.defineProperty(Array.prototype, "toJSON", previousArrayHook);
    else delete Array.prototype.toJSON;
  }
});

test("canonical bytes and both digest forms retain one deterministic golden value", () => {
  const expectedDigest = "04c388804319fd9e79ca995acf88a5be8f47a2e04634aa2dcae809c3514509cc";
  assert.equal(canonicalJsonBytes(canonicalFixture).toString("utf8"), canonicalJson(canonicalFixture));
  assert.equal(canonicalJsonDigest(canonicalFixture), `sha256:${expectedDigest}`);
  assert.equal(canonicalJsonDigestHex(canonicalFixture), expectedDigest);
});
