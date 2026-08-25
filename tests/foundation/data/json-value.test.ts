import { deepEqual, equal, notEqual } from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  JSON_VALUE_MAXIMUM_DEPTH,
  JsonValueError,
  parseJsonValue,
  type JsonArray,
  type JsonObject,
  type JsonValue,
  type JsonValueErrorReason,
} from "../../../src/foundation/data/json-value.js";

function expectJsonValueError(
  action: () => unknown,
  reason: JsonValueErrorReason,
  expectedPath?: string,
): JsonValueError {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }

  if (!(caught instanceof JsonValueError)) {
    throw new Error("Expected JsonValueError.");
  }
  equal(caught.name, "JsonValueError");
  equal(caught.code, "wakeflow-json-value");
  equal(caught.reason, reason);
  if (expectedPath !== undefined) equal(caught.path, expectedPath);
  return caught;
}

function requireJsonObject(value: JsonValue): JsonObject {
  if (value === null || typeof value !== "object" || isJsonArray(value)) {
    throw new Error("Expected JsonObject.");
  }
  return value;
}

function isJsonArray(value: JsonValue): value is JsonArray {
  return Array.isArray(value);
}

function requireJsonArray(value: JsonValue): JsonArray {
  if (!isJsonArray(value)) throw new Error("Expected JsonArray.");
  return value;
}

function requireJsonProperty(value: JsonObject, key: string): JsonValue {
  const member = value[key];
  if (member === undefined) throw new Error(`Missing JSON property: ${key}`);
  return member;
}

function requireJsonElement(value: JsonArray, index: number): JsonValue {
  const member = value[index];
  if (member === undefined) throw new Error(`Missing JSON element: ${index}`);
  return member;
}

test("JSON primitives are preserved without coercion", () => {
  const values: readonly JsonValue[] = [
    null,
    false,
    true,
    "",
    "plain",
    "\u{1f642}",
    0,
    1,
    -1,
    Number.MIN_VALUE,
    Number.MAX_VALUE,
    Number.MAX_SAFE_INTEGER + 1,
  ];

  for (const value of values) equal(parseJsonValue(value), value);
});

test("unsupported values, non-finite numbers, and negative zero fail at their exact path", () => {
  const invalid = [
    { value: undefined, reason: "unsupported-type" },
    { value: 1n, reason: "unsupported-type" },
    { value: Symbol("not-json"), reason: "unsupported-type" },
    { value: () => undefined, reason: "unsupported-type" },
    { value: Number.NaN, reason: "non-finite-number" },
    { value: Number.POSITIVE_INFINITY, reason: "non-finite-number" },
    { value: Number.NEGATIVE_INFINITY, reason: "non-finite-number" },
    { value: -0, reason: "negative-zero" },
  ] as const;

  for (const entry of invalid) {
    expectJsonValueError(
      () => parseJsonValue({ field: entry.value }),
      entry.reason,
      "$/field",
    );
  }

  expectJsonValueError(
    () => parseJsonValue([undefined]),
    "unsupported-type",
    "$/0",
  );
});

test("strings preserve Unicode exactly and reject lone surrogates", () => {
  const composed = "\u00e9";
  const decomposed = "e\u0301";
  const snapshot = requireJsonObject(parseJsonValue({ composed, decomposed }));
  equal(snapshot.composed, composed);
  equal(snapshot.decomposed, decomposed);
  notEqual(snapshot.composed, snapshot.decomposed);

  expectJsonValueError(
    () => parseJsonValue({ text: "\ud800" }),
    "lone-surrogate",
    "$/text",
  );
  expectJsonValueError(
    () => parseJsonValue({ text: "\udc00" }),
    "lone-surrogate",
    "$/text",
  );

  const invalidKey = Object.create(null) as Record<string, unknown>;
  Object.defineProperty(invalidKey, "\ud800", { value: true, enumerable: true });
  expectJsonValueError(
    () => parseJsonValue(invalidKey, "$.record"),
    "lone-surrogate",
    "$.record",
  );
});

test("nested containers become detached, recursively frozen JSON values", () => {
  const shared = { count: 1 };
  const source: { list: unknown[]; nested: { count: number } } = {
    list: [shared, { leaf: true }],
    nested: shared,
  };

  const snapshot = requireJsonObject(parseJsonValue(source));
  const list = requireJsonArray(requireJsonProperty(snapshot, "list"));
  const listShared = requireJsonObject(requireJsonElement(list, 0));
  const listLeaf = requireJsonObject(requireJsonElement(list, 1));
  const nested = requireJsonObject(requireJsonProperty(snapshot, "nested"));

  equal(Object.getPrototypeOf(snapshot), null);
  equal(Object.getPrototypeOf(nested), null);
  equal(Object.getPrototypeOf(list), Array.prototype);
  equal(Object.isFrozen(snapshot), true);
  equal(Object.isFrozen(list), true);
  equal(Object.isFrozen(listShared), true);
  equal(Object.isFrozen(listLeaf), true);
  equal(Object.isFrozen(nested), true);
  notEqual(listShared, shared);
  notEqual(nested, shared);
  notEqual(listShared, nested);

  shared.count = 2;
  source.list.push("later");
  equal(listShared.count, 1);
  equal(nested.count, 1);
  equal(list.length, 2);
});

test("cycles are rejected while repeated non-cyclic references are copied independently", () => {
  const cyclicRecord: Record<string, unknown> = {};
  cyclicRecord.self = cyclicRecord;
  expectJsonValueError(
    () => parseJsonValue(cyclicRecord),
    "cycle",
    "$/self",
  );

  const cyclicArray: unknown[] = [];
  cyclicArray.push(cyclicArray);
  expectJsonValueError(
    () => parseJsonValue(cyclicArray),
    "cycle",
    "$/0",
  );

  const repeated = { stable: true };
  const snapshot = requireJsonArray(parseJsonValue([repeated, repeated]));
  const first = requireJsonObject(requireJsonElement(snapshot, 0));
  const second = requireJsonObject(requireJsonElement(snapshot, 1));
  deepEqual(first, second);
  notEqual(first, second);
});

test("the depth limit preserves the existing root-at-zero contract", () => {
  let accepted: unknown = null;
  for (let depth = 0; depth < JSON_VALUE_MAXIMUM_DEPTH; depth += 1) {
    accepted = [accepted];
  }
  parseJsonValue(accepted);

  const rejected = [accepted];
  expectJsonValueError(
    () => parseJsonValue(rejected),
    "maximum-depth",
  );
});

test("recursive proxy and accessor inputs execute no behavior", () => {
  let trapCalls = 0;
  const proxy = new Proxy({ safe: true }, {
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
  expectJsonValueError(
    () => parseJsonValue({ nested: proxy }),
    "proxy",
    "$/nested",
  );
  equal(trapCalls, 0);

  let getterCalls = 0;
  const behavioral = Object.create(null) as Record<string, unknown>;
  Object.defineProperty(behavioral, "value", {
    enumerable: true,
    get: () => {
      getterCalls += 1;
      return "not-data";
    },
  });
  expectJsonValueError(
    () => parseJsonValue({ nested: behavioral }),
    "accessor-property",
    "$/nested/value",
  );
  equal(getterCalls, 0);

  let toJsonCalls = 0;
  const withToJson = {
    toJSON: () => {
      toJsonCalls += 1;
      return "not-data";
    },
  };
  expectJsonValueError(
    () => parseJsonValue(withToJson),
    "unsupported-type",
    "$/toJSON",
  );
  equal(toJsonCalls, 0);

  const revocable = Proxy.revocable({ value: true }, {});
  revocable.revoke();
  expectJsonValueError(
    () => parseJsonValue(revocable.proxy),
    "proxy",
    "$",
  );
});

test("non-JSON record and array structure retains precise neutral reasons", () => {
  const customRecord = Object.create({ inherited: true }) as Record<string, unknown>;
  customRecord.value = true;
  expectJsonValueError(
    () => parseJsonValue(customRecord),
    "record-prototype",
    "$",
  );

  const withSymbol = { visible: true };
  Object.defineProperty(withSymbol, Symbol("extension"), { value: true });
  expectJsonValueError(() => parseJsonValue(withSymbol), "symbol-key", "$");

  const withHidden = { visible: true };
  Object.defineProperty(withHidden, "hidden", { value: true, enumerable: false });
  expectJsonValueError(
    () => parseJsonValue(withHidden),
    "non-enumerable-property",
    "$/hidden",
  );

  const customArray = [true];
  Object.setPrototypeOf(customArray, null);
  expectJsonValueError(
    () => parseJsonValue(customArray),
    "array-prototype",
    "$",
  );

  expectJsonValueError(
    () => parseJsonValue(new Array<unknown>(1)),
    "array-slot",
    "$/0",
  );

  const withExtra = [true];
  Object.defineProperty(withExtra, "extra", { value: true, enumerable: true });
  expectJsonValueError(
    () => parseJsonValue(withExtra),
    "array-extra-property",
    "$/extra",
  );
});

test("special keys remain data and nested paths use JSON Pointer escaping", () => {
  const source = Object.create(null) as Record<string, unknown>;
  Object.defineProperty(source, "__proto__", { value: "safe", enumerable: true });
  Object.defineProperty(source, "constructor", { value: "data", enumerable: true });
  const snapshot = requireJsonObject(parseJsonValue(source));
  equal(Object.getPrototypeOf(snapshot), null);
  equal(snapshot.__proto__, "safe");
  equal(snapshot.constructor, "data");

  expectJsonValueError(
    () => parseJsonValue({ "a/b~c": undefined }),
    "unsupported-type",
    "$/a~1b~0c",
  );
});

test("json-value depends only on the passive own-data primitive", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/foundation/data/json-value.ts"),
    "utf8",
  );
  const imports = [...source.matchAll(/from\s+["']([^"']+)["']/gu)]
    .map((match) => match[1]);

  deepEqual(imports, ["./passive-own-data.js"]);
});
