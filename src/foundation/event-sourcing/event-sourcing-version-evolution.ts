import { type JsonValue, JsonValueError, parseJsonValue } from "../data/json-value.js";
import { type Fail, failWith, ModuleError } from "../error/module-error.js";

/**
 * Wakeflow Foundation / Event Sourcing：持久化事件数据的逐版本内存演进注册表。
 *
 * 注册表保存一个事件家族的版本编解码器和连续的 `vN → vN+1` 转换步骤。每一级输入
 * 和输出（来自磁盘的事件数据）都会重新转换为冻结的 `JsonValue`，并由目标版本编解码器复验。本模块不读取
 * 文件、时间或配置，不修改持久化字节，也不解释事件标识、事件流位置或领域状态。
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

export class EventSourcingVersionEvolutionError extends ModuleError<EventSourcingVersionEvolutionErrorReason> {
  static override readonly code = "wakeflow-event-sourcing-version-evolution";
}

const fail: Fail<EventSourcingVersionEvolutionErrorReason> = failWith(
  EventSourcingVersionEvolutionError,
);

function snapshotJson(
  value: unknown,
  path: string,
  reason: "codec" | "upcast" = "codec",
): Readonly<JsonValue> {
  try {
    return parseJsonValue(value, path);
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail(reason, path);
    throw error;
  }
}

/** 编解码器按版本登记：至少一个、版本不重复且不超过当前版本，当前版本必须在。 */
function indexCodecs(
  definition: EventSourcingVersionEvolutionDefinition,
): Map<number, Readonly<EventSourcingVersionCodec>> {
  if (definition.codecs.length === 0) fail("definition", "$/codecs");
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
  return codecs;
}

/** 演进步骤按起始版本登记：每一步恰好升一级、起止版本都有编解码器、同一起点只有一步。 */
function indexSteps(
  definition: EventSourcingVersionEvolutionDefinition,
  codecs: ReadonlyMap<number, Readonly<EventSourcingVersionCodec>>,
): Map<number, Readonly<EventSourcingVersionUpcastStep>> {
  const steps = new Map<number, Readonly<EventSourcingVersionUpcastStep>>();
  for (const [index, step] of definition.steps.entries()) {
    if (step.toVersion !== step.fromVersion + 1) {
      fail("definition", `$/steps/${index}/toVersion`);
    }
    if (
      step.toVersion > definition.currentVersion ||
      steps.has(step.fromVersion) ||
      !codecs.has(step.fromVersion) ||
      !codecs.has(step.toVersion)
    ) {
      fail("definition", `$/steps/${index}`);
    }
    steps.set(step.fromVersion, step);
  }
  return steps;
}

/** 一个事件家族的不可变、可复用版本演进计划。 */
export class EventSourcingVersionEvolutionRegistry {
  readonly #currentVersion: number;
  readonly #supportedVersions: readonly number[];
  readonly #codecs: ReadonlyMap<number, Readonly<EventSourcingVersionCodec>>;
  readonly #steps: ReadonlyMap<number, Readonly<EventSourcingVersionUpcastStep>>;

  /**
   * 定义是编码器模块的常量，形状由类型保证、不再复验；这里只核对类型表达不了的版本关系：
   * 版本唯一且不超过当前版本、每一步恰好升一级、每个受支持版本都能连续走到当前版本。
   */
  constructor(definition: EventSourcingVersionEvolutionDefinition) {
    const codecs = indexCodecs(definition);
    const steps = indexSteps(definition, codecs);
    for (const version of codecs.keys()) {
      for (let current = version; current < definition.currentVersion; current += 1) {
        if (!steps.has(current)) fail("missing-step", `$/steps/${current}`);
      }
    }
    this.#currentVersion = definition.currentVersion;
    this.#supportedVersions = Object.freeze([...codecs.keys()].sort((left, right) => left - right));
    this.#codecs = codecs;
    this.#steps = steps;
  }

  get currentVersion(): number {
    return this.#currentVersion;
  }

  get supportedVersions(): readonly number[] {
    return this.#supportedVersions;
  }

  /** 从任一受支持的持久化版本确定性演进到当前版本。 */
  evolve(
    sourceVersionValue: unknown,
    sourceDataValue: unknown,
  ): Readonly<EventSourcingVersionEvolutionResult> {
    if (!Number.isSafeInteger(sourceVersionValue) || (sourceVersionValue as number) < 1) {
      fail("input", "$sourceVersion");
    }
    const sourceVersion = sourceVersionValue as number;
    let codec = this.#codecs.get(sourceVersion);
    if (codec === undefined) fail("unsupported-version", "$sourceVersion");
    let data = snapshotJson(sourceDataValue, "$data");
    let parsed: unknown;
    try {
      parsed = codec.parse(data);
    } catch {
      fail("codec", "$data");
    }
    data = snapshotJson(parsed, "$data");
    for (let version = sourceVersion; version < this.#currentVersion; version += 1) {
      const step = this.#steps.get(version);
      if (step === undefined) fail("missing-step", `$/steps/${version}`);
      let upcasted: unknown;
      try {
        upcasted = step.upcast(data);
      } catch {
        fail("upcast", `$/steps/${version}`);
      }
      codec = this.#codecs.get(step.toVersion);
      if (codec === undefined) {
        fail("missing-step", `$/codecs/${step.toVersion}`);
      }
      const intermediate = snapshotJson(upcasted, `$/steps/${version}`, "upcast");
      try {
        parsed = codec.parse(intermediate);
      } catch {
        fail("codec", `$/codecs/${step.toVersion}`);
      }
      data = snapshotJson(parsed, `$/codecs/${step.toVersion}`);
    }
    return Object.freeze({
      sourceVersion,
      currentVersion: this.#currentVersion,
      data,
    });
  }
}
