import {
  deepEqual,
  equal,
  throws,
} from "node:assert/strict";
import { test } from "node:test";

import {
  EventSourcingVersionEvolutionRegistry,
  EventSourcingVersionEvolutionError,
} from "../../../src/foundation/event-sourcing/event-sourcing-version-evolution.js";
import {
  parsePlainRecord,
} from "../../../src/foundation/data/passive-own-data.js";

function exactData(value: unknown, fields: readonly string[]) {
  const record = parsePlainRecord(value, "$data");
  const keys = Object.keys(record).sort();
  const expected = [...fields].sort();
  if (
    keys.length !== expected.length
    || keys.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError("Unexpected version data.");
  }
  return record;
}

test("Event Sourcing version registry 执行 v1→v2→v3 连续演进", () => {
  const registry = new EventSourcingVersionEvolutionRegistry({
    currentVersion: 3,
    codecs: [
      {
        version: 1,
        parse: (value) => {
          const data = exactData(value, ["label"]);
          if (typeof data.label !== "string") throw new TypeError();
          return { label: data.label };
        },
      },
      {
        version: 2,
        parse: (value) => {
          const data = exactData(value, ["count", "label"]);
          if (typeof data.label !== "string" || data.count !== 1) {
            throw new TypeError();
          }
          return { count: 1, label: data.label };
        },
      },
      {
        version: 3,
        parse: (value) => {
          const data = exactData(value, ["count", "name"]);
          if (typeof data.name !== "string" || data.count !== 1) {
            throw new TypeError();
          }
          return { count: 1, name: data.name };
        },
      },
    ],
    steps: [
      {
        fromVersion: 1,
        toVersion: 2,
        upcast: (value) => {
          const data = value as { readonly label: string };
          return { count: 1, label: data.label };
        },
      },
      {
        fromVersion: 2,
        toVersion: 3,
        upcast: (value) => {
          const data = value as { readonly count: number; readonly label: string };
          return { count: data.count, name: data.label };
        },
      },
    ],
  });

  const source = Object.freeze({ label: "legacy" });
  const result = registry.evolve(1, source);
  equal(result.sourceVersion, 1);
  equal(result.currentVersion, 3);
  deepEqual(JSON.parse(JSON.stringify(result.data)), {
    count: 1,
    name: "legacy",
  });
  deepEqual(source, { label: "legacy" });
  equal(Object.isFrozen(result.data), true);
  equal(
    JSON.stringify(registry.evolve(3, result.data).data),
    JSON.stringify(result.data),
  );
});

test("Event Sourcing version registry 拒绝未知版本与不闭合定义", () => {
  const registry = new EventSourcingVersionEvolutionRegistry({
    currentVersion: 1,
    codecs: [{ version: 1, parse: (value) => value }],
    steps: [],
  });
  throws(
    () => registry.evolve(2, {}),
    (error: unknown) => (
      error instanceof EventSourcingVersionEvolutionError
      && error.reason === "unsupported-version"
    ),
  );
  throws(
    () => new EventSourcingVersionEvolutionRegistry({
      currentVersion: 2,
      codecs: [
        { version: 1, parse: (value) => value },
        { version: 2, parse: (value) => value },
      ],
      steps: [],
    }),
    (error: unknown) => (
      error instanceof EventSourcingVersionEvolutionError
      && error.reason === "missing-step"
    ),
  );
});
