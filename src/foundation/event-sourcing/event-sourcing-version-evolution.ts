import { types } from "node:util";

import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../data/json-value.js";
import {
  parseDenseArray,
  parsePlainRecord,
  PassiveOwnDataError,
} from "../data/passive-own-data.js";

/**
 * Wakeflow Foundation / Event Sourcing：持久化事件数据的逐版本纯内存演进 Registry。
 *
 * Registry 持有一个事件家族的版本 codec 与连续 vN→vN+1 steps。每一级输入输出都
 * 重新收敛为 frozen JsonValue，并由目标版本 codec 复验；它不读取文件、时间、配置，
 * 不修改 persisted bytes，也不解释 event identity、stream position 或领域状态。
 */

export interface EventSourcingVersionCodec {
  readonly version: number;
  readonly parse: (value: Readonly<JsonValue>) => unknown;
}

export interface EventSourcingVersionUpcastStep {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly upcast: (value: Readonly<JsonValue>) => unknown;
}

export interface EventSourcingVersionEvolutionDefinition {
  readonly currentVersion: number;
  readonly codecs: readonly Readonly<EventSourcingVersionCodec>[];
  readonly steps: readonly Readonly<EventSourcingVersionUpcastStep>[];
}

export interface EventSourcingVersionEvolutionResult {
  readonly sourceVersion: number;
  readonly currentVersion: number;
  readonly data: Readonly<JsonValue>;
}

export type EventSourcingVersionEvolutionErrorReason =
  | "input"
  | "definition"
  | "unsupported-version"
  | "codec"
  | "missing-step"
  | "upcast";

const ERROR_MESSAGES = {
  "input": "Event Sourcing version evolution input is invalid.",
  "definition": "Event Sourcing version evolution definition is invalid.",
  "unsupported-version": "Persisted Event Sourcing version is unsupported.",
  "codec": "Persisted Event Sourcing version data is invalid.",
  "missing-step": "Event Sourcing version evolution chain is incomplete.",
  "upcast": "Event Sourcing version upcast failed.",
} as const satisfies Readonly<Record<
  EventSourcingVersionEvolutionErrorReason,
  string
>>;

export class EventSourcingVersionEvolutionError extends Error {
  override readonly name = "EventSourcingVersionEvolutionError";
  readonly code = "wakeflow-event-sourcing-version-evolution" as const;
  readonly reason: EventSourcingVersionEvolutionErrorReason;
  readonly path: string;

  constructor(
    reason: EventSourcingVersionEvolutionErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface ParsedDefinition {
  readonly currentVersion: number;
  readonly codecs: readonly Readonly<EventSourcingVersionCodec>[];
  readonly steps: readonly Readonly<EventSourcingVersionUpcastStep>[];
}

function fail(
  reason: EventSourcingVersionEvolutionErrorReason,
  path: string,
): never {
  throw new EventSourcingVersionEvolutionError(reason, path);
}

function parseVersion(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    fail("definition", path);
  }
  return value as number;
}

function parseFunction(
  value: unknown,
  path: string,
): (...args: never[]) => unknown {
  if (typeof value !== "function" || types.isProxy(value)) {
    fail("definition", path);
  }
  return value as (...args: never[]) => unknown;
}

function exactRecord(
  value: unknown,
  fields: readonly string[],
  path: string,
): Readonly<Record<string, unknown>> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("definition", path);
    throw error;
  }
  const keys = Object.keys(record).sort();
  const expected = [...fields].sort();
  if (
    keys.length !== expected.length
    || keys.some((key, index) => key !== expected[index])
  ) {
    fail("definition", path);
  }
  return record;
}

function parseDefinition(value: unknown): Readonly<ParsedDefinition> {
  const definition = exactRecord(
    value,
    ["codecs", "currentVersion", "steps"],
    "$definition",
  );
  let codecValues: readonly unknown[];
  let stepValues: readonly unknown[];
  try {
    codecValues = parseDenseArray(definition.codecs, 256, "$/codecs");
    stepValues = parseDenseArray(definition.steps, 255, "$/steps");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("definition", error.path);
    throw error;
  }
  if (codecValues.length === 0) fail("definition", "$/codecs");
  const codecs = codecValues.map((value, index) => {
    const record = exactRecord(value, ["parse", "version"], `$/codecs/${index}`);
    return Object.freeze({
      version: parseVersion(record.version, `$/codecs/${index}/version`),
      parse: parseFunction(
        record.parse,
        `$/codecs/${index}/parse`,
      ) as EventSourcingVersionCodec["parse"],
    });
  });
  const steps = stepValues.map((value, index) => {
    const record = exactRecord(
      value,
      ["fromVersion", "toVersion", "upcast"],
      `$/steps/${index}`,
    );
    const fromVersion = parseVersion(
      record.fromVersion,
      `$/steps/${index}/fromVersion`,
    );
    const toVersion = parseVersion(
      record.toVersion,
      `$/steps/${index}/toVersion`,
    );
    if (toVersion !== fromVersion + 1) {
      fail("definition", `$/steps/${index}/toVersion`);
    }
    return Object.freeze({
      fromVersion,
      toVersion,
      upcast: parseFunction(
        record.upcast,
        `$/steps/${index}/upcast`,
      ) as EventSourcingVersionUpcastStep["upcast"],
    });
  });
  return Object.freeze({
    currentVersion: parseVersion(
      definition.currentVersion,
      "$/currentVersion",
    ),
    codecs: Object.freeze(codecs),
    steps: Object.freeze(steps),
  });
}

function snapshotJson(value: unknown, path: string): Readonly<JsonValue> {
  try {
    return parseJsonValue(value, path);
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("codec", path);
    throw error;
  }
}

/** 一个事件家族的 immutable、可复用版本演进计划。 */
export class EventSourcingVersionEvolutionRegistry {
  readonly #currentVersion: number;
  readonly #supportedVersions: readonly number[];
  readonly #codecs: ReadonlyMap<number, Readonly<EventSourcingVersionCodec>>;
  readonly #steps: ReadonlyMap<number, Readonly<EventSourcingVersionUpcastStep>>;

  constructor(definitionValue: EventSourcingVersionEvolutionDefinition) {
    const definition = parseDefinition(definitionValue);
    const codecs = new Map<number, Readonly<EventSourcingVersionCodec>>();
    for (const [index, codec] of definition.codecs.entries()) {
      if (codec.version > definition.currentVersion || codecs.has(codec.version)) {
        fail("definition", `$/codecs/${index}/version`);
      }
      codecs.set(codec.version, codec);
    }
    if (!codecs.has(definition.currentVersion)) {
      fail("definition", "$/currentVersion");
    }
    const steps = new Map<number, Readonly<EventSourcingVersionUpcastStep>>();
    for (const [index, step] of definition.steps.entries()) {
      if (
        step.toVersion > definition.currentVersion
        || steps.has(step.fromVersion)
        || !codecs.has(step.fromVersion)
        || !codecs.has(step.toVersion)
      ) {
        fail("definition", `$/steps/${index}`);
      }
      steps.set(step.fromVersion, step);
    }
    for (const version of codecs.keys()) {
      for (let current = version; current < definition.currentVersion; current += 1) {
        if (!steps.has(current)) fail("missing-step", `$/steps/${current}`);
      }
    }
    this.#currentVersion = definition.currentVersion;
    this.#supportedVersions = Object.freeze([...codecs.keys()].sort(
      (left, right) => left - right,
    ));
    this.#codecs = codecs;
    this.#steps = steps;
  }

  get currentVersion(): number {
    return this.#currentVersion;
  }

  get supportedVersions(): readonly number[] {
    return this.#supportedVersions;
  }

  /** 从任一受支持 persisted version 确定性演进到 current version。 */
  evolve(
    sourceVersionValue: unknown,
    sourceDataValue: unknown,
  ): Readonly<EventSourcingVersionEvolutionResult> {
    if (
      !Number.isSafeInteger(sourceVersionValue)
      || (sourceVersionValue as number) < 1
    ) {
      fail("input", "$sourceVersion");
    }
    const sourceVersion = sourceVersionValue as number;
    let codec = this.#codecs.get(sourceVersion);
    if (codec === undefined) fail("unsupported-version", "$sourceVersion");
    let data = snapshotJson(sourceDataValue, "$data");
    try {
      data = snapshotJson(codec.parse(data), "$data");
    } catch (error: unknown) {
      if (error instanceof EventSourcingVersionEvolutionError) throw error;
      fail("codec", "$data");
    }
    for (let version = sourceVersion; version < this.#currentVersion; version += 1) {
      const step = this.#steps.get(version);
      if (step === undefined) fail("missing-step", `$steps/${version}`);
      let upcasted: unknown;
      try {
        upcasted = step.upcast(data);
      } catch {
        fail("upcast", `$steps/${version}`);
      }
      codec = this.#codecs.get(step.toVersion);
      if (codec === undefined) fail("missing-step", `$codecs/${step.toVersion}`);
      try {
        data = snapshotJson(codec.parse(
          snapshotJson(upcasted, `$steps/${version}`),
        ), `$codecs/${step.toVersion}`);
      } catch (error: unknown) {
        if (error instanceof EventSourcingVersionEvolutionError) throw error;
        fail("codec", `$codecs/${step.toVersion}`);
      }
    }
    return Object.freeze({
      sourceVersion,
      currentVersion: this.#currentVersion,
      data,
    });
  }
}
