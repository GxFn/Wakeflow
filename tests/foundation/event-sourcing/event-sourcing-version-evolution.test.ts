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

test("Event Sourcing version registry 区分 codec 与 upcast 失败", () => {
  const invalidUpcast = new EventSourcingVersionEvolutionRegistry({
    currentVersion: 2,
    codecs: [
      { version: 1, parse: (value) => value },
      { version: 2, parse: (value) => value },
    ],
    steps: [{
      fromVersion: 1,
      toVersion: 2,
      upcast: () => undefined,
    }],
  });
  throws(
    () => invalidUpcast.evolve(1, {}),
    (error: unknown) => (
      error instanceof EventSourcingVersionEvolutionError
      && error.reason === "upcast"
      && error.path === "$/steps/1"
    ),
  );

  const spoofingCodec = new EventSourcingVersionEvolutionRegistry({
    currentVersion: 1,
    codecs: [{
      version: 1,
      parse: () => {
        throw new EventSourcingVersionEvolutionError("upcast", "$spoof");
      },
    }],
    steps: [],
  });
  throws(
    () => spoofingCodec.evolve(1, {}),
    (error: unknown) => (
      error instanceof EventSourcingVersionEvolutionError
      && error.reason === "codec"
      && error.path === "$data"
    ),
  );
});

test("Event Sourcing version registry 以 definition 拒绝畸形定义并给出精确路径", () => {
  const codec = (version: number) => ({ version, parse: (value: unknown) => value });
  const step = (fromVersion: number, toVersion: number) => ({
    fromVersion,
    toVersion,
    upcast: (value: unknown) => value,
  });
  const cases: readonly (readonly [string, unknown, string])[] = [
    ["duplicate codec version", {
      currentVersion: 1, codecs: [codec(1), codec(1)], steps: [],
    }, "$/codecs/1/version"],
    ["codec above currentVersion", {
      currentVersion: 1, codecs: [codec(1), codec(2)], steps: [],
    }, "$/codecs/1/version"],
    ["missing currentVersion codec", {
      currentVersion: 2, codecs: [codec(1)], steps: [],
    }, "$/currentVersion"],
    ["non-consecutive step", {
      currentVersion: 3, codecs: [codec(1), codec(3)], steps: [step(1, 3)],
    }, "$/steps/0/toVersion"],
    ["duplicate fromVersion", {
      currentVersion: 2, codecs: [codec(1), codec(2)], steps: [step(1, 2), step(1, 2)],
    }, "$/steps/1"],
    ["step endpoint without codec", {
      currentVersion: 3, codecs: [codec(2), codec(3)], steps: [step(1, 2), step(2, 3)],
    }, "$/steps/0"],
    ["extra codec field", {
      currentVersion: 1, codecs: [{ ...codec(1), extra: true }], steps: [],
    }, "$/codecs/0"],
    ["extra definition field", {
      currentVersion: 1, codecs: [codec(1)], steps: [], extra: true,
    }, "$definition"],
    ["empty codec list", {
      currentVersion: 1, codecs: [], steps: [],
    }, "$/codecs"],
    ["non-function parse", {
      currentVersion: 1, codecs: [{ version: 1, parse: "parse" }], steps: [],
    }, "$/codecs/0/parse"],
  ];
  for (const [label, definition, path] of cases) {
    throws(
      () => new EventSourcingVersionEvolutionRegistry(
        definition as ConstructorParameters<typeof EventSourcingVersionEvolutionRegistry>[0],
      ),
      (error: unknown) => (
        error instanceof EventSourcingVersionEvolutionError
        && error.reason === "definition"
        && error.path === path
      ),
      label,
    );
  }
});
