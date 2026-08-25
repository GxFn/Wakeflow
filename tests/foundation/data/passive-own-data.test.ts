import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  parseDenseArray,
  parsePlainRecord,
  PassiveOwnDataError,
  pickOwnDataProperties,
  type PassiveOwnDataErrorReason,
} from "../../../src/foundation/data/passive-own-data.js";

function expectPassiveOwnDataError(
  action: () => unknown,
  reason: PassiveOwnDataErrorReason,
  expectedPath?: string,
): PassiveOwnDataError {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }

  if (!(caught instanceof PassiveOwnDataError)) {
    throw new Error("Expected PassiveOwnDataError.");
  }
  equal(caught.name, "PassiveOwnDataError");
  equal(caught.code, "wakeflow-passive-own-data");
  equal(caught.reason, reason);
  if (expectedPath !== undefined) equal(caught.path, expectedPath);
  return caught;
}

function asSelection(value: unknown): readonly string[] {
  return value as readonly string[];
}

test("all public operations reject proxies without invoking traps", () => {
  let trapCalls = 0;
  const objectProxy = new Proxy({ selected: 1 }, {
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

  expectPassiveOwnDataError(() => parsePlainRecord(objectProxy), "proxy", "$");
  expectPassiveOwnDataError(
    () => pickOwnDataProperties(objectProxy, ["selected"]),
    "proxy",
    "$",
  );

  const arrayProxy = new Proxy([1], {
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
  expectPassiveOwnDataError(() => parseDenseArray(arrayProxy, 1), "proxy", "$");

  equal(trapCalls, 0);
});

test("accessor properties are rejected without executing getters or setters", () => {
  let getterCalls = 0;
  let setterCalls = 0;
  const record = Object.create(null) as Record<string, unknown>;
  Object.defineProperty(record, "behavioral", {
    enumerable: true,
    configurable: true,
    get: () => {
      getterCalls += 1;
      return "not-data";
    },
    set: () => {
      setterCalls += 1;
    },
  });

  expectPassiveOwnDataError(
    () => parsePlainRecord(record, "$.record"),
    "accessor-property",
    "$.record/behavioral",
  );
  expectPassiveOwnDataError(
    () => pickOwnDataProperties(record, ["behavioral"], "$.projection"),
    "accessor-property",
    "$.projection/behavioral",
  );

  const array = [1];
  Object.defineProperty(array, "0", {
    enumerable: true,
    configurable: true,
    get: () => {
      getterCalls += 1;
      return 1;
    },
    set: () => {
      setterCalls += 1;
    },
  });
  expectPassiveOwnDataError(
    () => parseDenseArray(array, 1, "$.array"),
    "accessor-property",
    "$.array/0",
  );

  equal(getterCalls, 0);
  equal(setterCalls, 0);
});

test("plain records reject symbols and non-enumerable own properties", () => {
  const withSymbol = { visible: true };
  Object.defineProperty(withSymbol, Symbol("hidden"), {
    value: "private",
    enumerable: true,
  });
  expectPassiveOwnDataError(() => parsePlainRecord(withSymbol), "symbol-key", "$");

  const withHidden = { visible: true };
  Object.defineProperty(withHidden, "hidden", {
    value: "private",
    enumerable: false,
  });
  expectPassiveOwnDataError(
    () => parsePlainRecord(withHidden),
    "non-enumerable-property",
    "$/hidden",
  );
});

test("plain record parsing snapshots ordinary and null-prototype records", () => {
  const ordinarySource: Record<string, unknown> = { first: 1, optional: undefined };
  const ordinarySnapshot = parsePlainRecord(ordinarySource);
  equal(Object.getPrototypeOf(ordinarySnapshot), null);
  equal(Object.isFrozen(ordinarySnapshot), true);
  equal(ordinarySnapshot.first, 1);
  equal(Object.hasOwn(ordinarySnapshot, "optional"), true);

  ordinarySource.first = 2;
  delete ordinarySource.optional;
  equal(ordinarySnapshot.first, 1);
  equal(Object.hasOwn(ordinarySnapshot, "optional"), true);

  const nullPrototypeSource = Object.create(null) as Record<string, unknown>;
  nullPrototypeSource.value = "kept";
  const nullPrototypeSnapshot = parsePlainRecord(nullPrototypeSource);
  equal(Object.getPrototypeOf(nullPrototypeSnapshot), null);
  equal(nullPrototypeSnapshot.value, "kept");
});

test("plain record snapshots special property names without prototype effects", () => {
  const source = Object.create(null) as Record<string, unknown>;
  Object.defineProperty(source, "__proto__", { value: "proto-data", enumerable: true });
  Object.defineProperty(source, "constructor", {
    value: "constructor-data",
    enumerable: true,
  });
  Object.defineProperty(source, "toString", {
    value: "to-string-data",
    enumerable: true,
  });

  const snapshot = parsePlainRecord(source);
  equal(Object.getPrototypeOf(snapshot), null);
  equal(snapshot.__proto__, "proto-data");
  equal(snapshot.constructor, "constructor-data");
  equal(snapshot.toString, "to-string-data");
  deepEqual(Object.keys(snapshot).sort(), ["__proto__", "constructor", "toString"]);
});

test("property projection ignores unrelated extensions and custom prototypes", () => {
  let unrelatedGetterCalls = 0;
  const prototype = Object.create(null) as Record<string, unknown>;
  Object.defineProperty(prototype, "inherited", {
    enumerable: true,
    get: () => {
      unrelatedGetterCalls += 1;
      return "inherited";
    },
  });
  const source = Object.create(prototype) as Record<PropertyKey, unknown>;
  source.selected = 7;
  Object.defineProperty(source, "unrelated", {
    enumerable: true,
    get: () => {
      unrelatedGetterCalls += 1;
      return "unrelated";
    },
  });
  Object.defineProperty(source, "hidden", { value: true, enumerable: false });
  source[Symbol("extension")] = true;

  const snapshot = pickOwnDataProperties(source, ["selected", "inherited"] as const);
  equal(Object.getPrototypeOf(snapshot), null);
  equal(Object.isFrozen(snapshot), true);
  deepEqual(Object.keys(snapshot), ["selected"]);
  equal(snapshot.selected, 7);
  equal(Object.hasOwn(snapshot, "inherited"), false);
  equal(unrelatedGetterCalls, 0);
});

test("property projection preserves own undefined and omits missing keys", () => {
  const snapshot = pickOwnDataProperties(
    { present: undefined },
    ["present", "missing"] as const,
  );

  equal(Object.hasOwn(snapshot, "present"), true);
  equal(snapshot.present, undefined);
  equal(Object.hasOwn(snapshot, "missing"), false);
});

test("property selection must itself be passive, dense, unique, and non-empty", () => {
  const source = { selected: 1 };

  expectPassiveOwnDataError(
    () => pickOwnDataProperties(source, []),
    "property-selection",
    "$.keys",
  );
  expectPassiveOwnDataError(
    () => pickOwnDataProperties(source, ["selected", "selected"]),
    "property-selection",
    "$.keys/1",
  );
  expectPassiveOwnDataError(
    () => pickOwnDataProperties(source, [""]),
    "property-selection",
    "$.keys/0",
  );
  expectPassiveOwnDataError(
    () => pickOwnDataProperties(source, asSelection(["selected", 1])),
    "property-selection",
    "$.keys/1",
  );

  const sparse = new Array<string>(1);
  expectPassiveOwnDataError(
    () => pickOwnDataProperties(source, sparse),
    "property-selection",
    "$.keys/0",
  );

  const customPrototype = ["selected"];
  Object.setPrototypeOf(customPrototype, null);
  expectPassiveOwnDataError(
    () => pickOwnDataProperties(source, customPrototype),
    "property-selection",
    "$.keys",
  );

  let selectorGetterCalls = 0;
  const behavioral = ["selected"];
  Object.defineProperty(behavioral, "0", {
    enumerable: true,
    get: () => {
      selectorGetterCalls += 1;
      return "selected";
    },
  });
  expectPassiveOwnDataError(
    () => pickOwnDataProperties(source, behavioral),
    "property-selection",
    "$.keys/0",
  );
  equal(selectorGetterCalls, 0);

  let selectorTrapCalls = 0;
  const selectionProxy = new Proxy(["selected"], {
    getOwnPropertyDescriptor: () => {
      selectorTrapCalls += 1;
      return undefined;
    },
    getPrototypeOf: () => {
      selectorTrapCalls += 1;
      return null;
    },
    ownKeys: () => {
      selectorTrapCalls += 1;
      return [];
    },
  });
  expectPassiveOwnDataError(
    () => pickOwnDataProperties(source, selectionProxy),
    "property-selection",
    "$.keys",
  );
  equal(selectorTrapCalls, 0);
});

test("dense arrays reject non-standard structure and invalid bounds", () => {
  const customPrototype = [1];
  Object.setPrototypeOf(customPrototype, null);
  expectPassiveOwnDataError(
    () => parseDenseArray(customPrototype, 1),
    "array-prototype",
    "$",
  );

  const sparse = new Array<unknown>(1);
  expectPassiveOwnDataError(() => parseDenseArray(sparse, 1), "array-slot", "$/0");

  const withExtra = [1];
  Object.defineProperty(withExtra, "extra", { value: true, enumerable: true });
  expectPassiveOwnDataError(
    () => parseDenseArray(withExtra, 1),
    "array-extra-property",
    "$/extra",
  );

  const withHiddenIndex = [1];
  Object.defineProperty(withHiddenIndex, "0", { value: 1, enumerable: false });
  expectPassiveOwnDataError(
    () => parseDenseArray(withHiddenIndex, 1),
    "non-enumerable-property",
    "$/0",
  );

  const withSymbol = [1];
  Object.defineProperty(withSymbol, Symbol("extension"), { value: true });
  expectPassiveOwnDataError(() => parseDenseArray(withSymbol, 1), "symbol-key", "$");

  expectPassiveOwnDataError(() => parseDenseArray([1, 2], 1), "array-length", "$");
  expectPassiveOwnDataError(() => parseDenseArray([], -1), "array-length", "$");
  expectPassiveOwnDataError(
    () => parseDenseArray([], Number.MAX_SAFE_INTEGER + 1),
    "array-length",
    "$",
  );
});

test("dense array parsing returns a frozen shallow snapshot", () => {
  const nested = { mutable: true };
  const source: unknown[] = [nested, undefined];
  const snapshot = parseDenseArray(source, 2);

  equal(Array.isArray(snapshot), true);
  equal(Object.getPrototypeOf(snapshot), Array.prototype);
  equal(Object.isFrozen(snapshot), true);
  equal(snapshot.length, 2);
  equal(snapshot[0], nested);
  equal(snapshot[1], undefined);
  equal(Object.isFrozen(nested), false);

  source[0] = "changed";
  source.push("extra");
  equal(snapshot[0], nested);
  equal(snapshot.length, 2);
});

test("record parsing is shallow and does not freeze nested values", () => {
  const nested = { count: 1 };
  const snapshot = parsePlainRecord({ nested });

  equal(snapshot.nested, nested);
  equal(Object.isFrozen(nested), false);
  nested.count = 2;
  equal((snapshot.nested as { count: number }).count, 2);
});

test("the foundation primitive depends only on the Node.js proxy detector", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/foundation/data/passive-own-data.ts"),
    "utf8",
  );
  const imports = [...source.matchAll(/from\s+["']([^"']+)["']/gu)]
    .map((match) => match[1]);

  deepEqual(imports, ["node:util"]);
});
