import { types } from "node:util";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../../contracts/generated/foundation/utc-instant.generated.js";
import { WAKEFLOW_DEMAND_EVENT_SOURCING_STORED_EVENT_SCHEMA } from "../../../contracts/generated/governance/demand/demand-event-sourcing-stored-event.generated.js";
import type { WakeflowDemandEventStreamCommit as CommitWire } from "../../../contracts/generated/governance/demand/demand-event-stream-commit.generated.js";
import { WAKEFLOW_DEMAND_EVENT_STREAM_COMMIT_SCHEMA } from "../../../contracts/generated/governance/demand/demand-event-stream-commit.generated.js";
import {
  parseWakeflowDurableIdOfKind,
  type WakeflowDurableId,
  WakeflowDurableIdError,
} from "../../../contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../../foundation/crypto/canonical-json-sha256.js";
import {
  parseSha256Digest,
  type Sha256Digest,
  Sha256Error,
} from "../../../foundation/crypto/sha256.js";
import {
  DeterministicJsonDocumentError,
  parseDeterministicJsonDocument,
  renderDeterministicJsonDocument,
} from "../../../foundation/data/deterministic-json-document.js";
import {
  type JsonValue,
  JsonValueError,
  parseJsonValue,
} from "../../../foundation/data/json-value.js";
import {
  PassiveOwnDataError,
  parsePlainRecord,
} from "../../../foundation/data/passive-own-data.js";
import { type Fail, failWith, ModuleError } from "../../../foundation/error/module-error.js";
import { createRuntimeJsonSchemaValidator } from "../../../foundation/schema/runtime-json-schema.js";
import {
  computeDemandAggregateStateDigest,
  type DemandAggregateState,
} from "../model/demand-aggregate-state.js";
import {
  type DemandEventSourcingAggregate,
  parseDemandEventSourcingAggregate,
} from "./demand-event-sourcing-aggregate.js";
import {
  DemandEventSourcingDecisionError,
  evolveDemandEventSourcingState,
} from "./demand-event-sourcing-decider.js";
import type { DemandUncommittedEvent } from "./demand-event-sourcing-event.js";
import {
  assertSupportedDemandEventSourcingStateModelVersion,
  DemandEventSourcingStateVersionError,
} from "./demand-event-sourcing-state-version.js";
import {
  computeDemandEventSourcingStoredEventDigest,
  createDemandEventSourcingStoredEvent,
  type DemandEventSourcingStoredEvent,
  DemandEventSourcingStoredEventError,
  parseDemandEventSourcingStoredEvent,
} from "./demand-event-sourcing-stored-event.js";
import {
  DemandEventSourcingUpcasterError,
  upcastDemandEventSourcingStoredEvent,
} from "./demand-event-sourcing-upcaster.js";
import {
  type DemandEventCommitSequence,
  DemandEventStreamPositionError,
  type DemandEventStreamRevision,
  parseDemandEventCommitSequence,
  parseDemandEventStreamRevision,
} from "./demand-event-stream-position.js";

/**
 * Wakeflow Governance / Demand Event Sourcing：一次原子追加产生的不可变提交记录。
 *
 * `commitSequence` 是不替换目标的物理槽位；事件流修订号是提交中事件的逻辑位置。
 * 一条提交记录可以承载一个命令产生的多个事件，并通过 `previousCommitDigest` 串联历史。
 *
 * 可选的 `writer` 记录追加这条提交的构建（制品版本与 manifest 摘要，C11 / 计划 §3.6）：它随提交
 * 持久化并进入提交摘要链，但不进事件数据摘要、命令摘要与幂等判定；旧流的提交没有它。
 */

const DEMAND_EVENT_STREAM_COMMIT_ARTIFACT_KIND = "wakeflow-demand-event-stream-commit" as const;
const DEMAND_EVENT_STREAM_COMMIT_SCHEMA_VERSION = 1 as const;

export interface DemandEventStreamCommit {
  readonly artifactKind: typeof DEMAND_EVENT_STREAM_COMMIT_ARTIFACT_KIND;
  readonly schemaVersion: typeof DEMAND_EVENT_STREAM_COMMIT_SCHEMA_VERSION;
  readonly commitId: WakeflowDurableId<"demand-event-commit">;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly commitSequence: DemandEventCommitSequence;
  readonly commandDigest: Sha256Digest;
  readonly expectedStreamRevision: number;
  readonly firstStreamRevision: DemandEventStreamRevision;
  readonly lastStreamRevision: DemandEventStreamRevision;
  readonly previousCommitDigest: Sha256Digest | null;
  readonly events: readonly [
    Readonly<DemandEventSourcingStoredEvent>,
    ...Readonly<DemandEventSourcingStoredEvent>[],
  ];
  /** 客户端幂等键与它绑定的请求摘要；没有客户端键的提交省略。 */
  readonly idempotency?: Readonly<DemandEventStreamCommitIdempotency>;
  /** 追加这条提交的构建；旧流与没有 manifest 的构建写出的提交省略，读回按 `null` 处理。 */
  readonly writer?: Readonly<DemandEventStreamCommitWriter>;
}

export interface DemandEventStreamCommitIdempotency {
  readonly key: string;
  readonly requestDigest: Sha256Digest;
}

/** 写者戳：追加提交的构建在制品清单里的发布版本与清单字节摘要。 */
export interface DemandEventStreamCommitWriter {
  readonly version: string;
  readonly manifestDigest: Sha256Digest;
}

const WRITER_VERSION_PATTERN =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/u;
const WRITER_VERSION_MAXIMUM_LENGTH = 64;

/**
 * 准入一个写者戳；`undefined` 与 `null` 都表示没有戳（测试构建没有 manifest），返回 `null`。
 * 戳由组合根从本进程的制品身份注入，不参与命令摘要、事件数据摘要与幂等判定。
 */
export function parseDemandEventStreamCommitWriter(
  value: unknown,
  path = "$writer",
): Readonly<DemandEventStreamCommitWriter> | null {
  if (value === undefined || value === null) return null;
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", path, error);
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (
    keys.length !== 2 ||
    keys[0] !== "manifestDigest" ||
    keys[1] !== "version" ||
    typeof record.version !== "string" ||
    record.version.length > WRITER_VERSION_MAXIMUM_LENGTH ||
    !WRITER_VERSION_PATTERN.test(record.version)
  ) {
    fail("input", path);
  }
  return Object.freeze({
    version: record.version,
    manifestDigest: parseDigest(record.manifestDigest, `${path}/manifestDigest`),
  });
}

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;

function parseIdempotency(
  value: unknown,
  path: string,
): Readonly<DemandEventStreamCommitIdempotency> | undefined {
  if (value === undefined) return undefined;
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", path, error);
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (
    keys.length !== 2 ||
    keys[0] !== "key" ||
    keys[1] !== "requestDigest" ||
    typeof record.key !== "string" ||
    !IDEMPOTENCY_KEY_PATTERN.test(record.key)
  ) {
    fail("input", path);
  }
  return Object.freeze({
    key: record.key,
    requestDigest: parseDigest(record.requestDigest, `${path}/requestDigest`),
  });
}

/** 已准备追加操作对指定物理前缀的进程内、非持久化源资源预期。 */
export interface DemandEventStreamAppendSourceExpectation {
  readonly lastEventDigest: Sha256Digest | null;
  readonly stateDigest: Sha256Digest | null;
}

export interface PreparedDemandEventStreamCommit {
  readonly commit: Readonly<DemandEventStreamCommit>;
  readonly aggregate: Readonly<DemandEventSourcingAggregate>;
  readonly sourceExpectation: Readonly<DemandEventStreamAppendSourceExpectation>;
}

export type DemandEventStreamCommitErrorReason =
  | "input"
  | "json"
  | "schema"
  | "identifier"
  | "position"
  | "digest"
  | "event"
  | "aggregate"
  | "relation"
  | "event-version"
  | "state-version"
  | "transition"
  | "representation";

export class DemandEventStreamCommitError extends ModuleError<DemandEventStreamCommitErrorReason> {
  static override readonly code = "wakeflow-demand-event-stream-commit";
}

const fail: Fail<DemandEventStreamCommitErrorReason> = failWith(DemandEventStreamCommitError);

const validateWire = createRuntimeJsonSchemaValidator<CommitWire>(
  WAKEFLOW_DEMAND_EVENT_STREAM_COMMIT_SCHEMA,
  [
    WAKEFLOW_DEMAND_EVENT_SOURCING_STORED_EVENT_SCHEMA,
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
    WAKEFLOW_UTC_INSTANT_SCHEMA,
  ],
);
const ISSUED_PREPARED_COMMITS = new WeakSet<object>();

function parseDigest(value: unknown, path: string): Sha256Digest {
  try {
    return parseSha256Digest(value, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("digest", path, error);
    throw error;
  }
}

function parseExpectedRevision(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail("position", path);
  }
  return value as number;
}

function parseCommitId(value: unknown, path: string): WakeflowDurableId<"demand-event-commit"> {
  try {
    return parseWakeflowDurableIdOfKind(value, "demand-event-commit", path);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("identifier", path, error);
    throw error;
  }
}

function parseDemandId(value: unknown, path: string): WakeflowDurableId<"demand"> {
  try {
    return parseWakeflowDurableIdOfKind(value, "demand", path);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("identifier", path, error);
    throw error;
  }
}

/** 只验证提交记录自身的结构和序列关系，不替代归约器语义验证。 */
export function parseDemandEventStreamCommit(value: unknown): Readonly<DemandEventStreamCommit> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$commit");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path, error);
    throw error;
  }
  const result = validateWire(json);
  if (!result.ok) fail("schema", result.path);
  const wire = result.value;
  const expectedStreamRevision = parseExpectedRevision(
    wire.expectedStreamRevision,
    "$/expectedStreamRevision",
  );
  if (expectedStreamRevision > Number.MAX_SAFE_INTEGER - wire.events.length) {
    fail("position", "$/expectedStreamRevision");
  }
  let commitSequence: DemandEventCommitSequence;
  let firstStreamRevision: DemandEventStreamRevision;
  let lastStreamRevision: DemandEventStreamRevision;
  try {
    commitSequence = parseDemandEventCommitSequence(wire.commitSequence, "$/commitSequence");
    firstStreamRevision = parseDemandEventStreamRevision(
      wire.firstStreamRevision,
      "$/firstStreamRevision",
    );
    lastStreamRevision = parseDemandEventStreamRevision(
      wire.lastStreamRevision,
      "$/lastStreamRevision",
    );
  } catch (error: unknown) {
    if (error instanceof DemandEventStreamPositionError) {
      fail("position", error.path, error);
    }
    throw error;
  }
  const demandId = parseDemandId(wire.demandId, "$/demandId");
  const idempotency = parseIdempotency(wire.idempotency, "$/idempotency");
  const writer = parseDemandEventStreamCommitWriter(wire.writer, "$/writer");
  const events: DemandEventSourcingStoredEvent[] = [];
  const eventIds = new Set<string>();
  for (const [index, eventValue] of wire.events.entries()) {
    let event: Readonly<DemandEventSourcingStoredEvent>;
    try {
      event = parseDemandEventSourcingStoredEvent(eventValue);
    } catch (error: unknown) {
      if (error instanceof DemandEventSourcingStoredEventError) {
        fail("event", `$/events/${index}`, error);
      }
      throw error;
    }
    if (
      event.demandId !== demandId ||
      event.streamRevision !== firstStreamRevision + index ||
      eventIds.has(event.eventId)
    ) {
      fail("relation", `$/events/${index}`);
    }
    eventIds.add(event.eventId);
    events.push(event);
  }
  if (
    firstStreamRevision !== expectedStreamRevision + 1 ||
    lastStreamRevision !== expectedStreamRevision + events.length ||
    (commitSequence === 1) !== (expectedStreamRevision === 0) ||
    (commitSequence === 1) !== (wire.previousCommitDigest === null)
  ) {
    fail("relation", "$commit");
  }
  const first = events[0];
  if (first === undefined) fail("relation", "$/events");
  const frozenEvents: [
    Readonly<DemandEventSourcingStoredEvent>,
    ...Readonly<DemandEventSourcingStoredEvent>[],
  ] = [first];
  frozenEvents.push(...events.slice(1));
  return Object.freeze({
    artifactKind: DEMAND_EVENT_STREAM_COMMIT_ARTIFACT_KIND,
    schemaVersion: DEMAND_EVENT_STREAM_COMMIT_SCHEMA_VERSION,
    commitId: parseCommitId(wire.commitId, "$/commitId"),
    demandId,
    commitSequence,
    commandDigest: parseDigest(wire.commandDigest, "$/commandDigest"),
    expectedStreamRevision,
    firstStreamRevision,
    lastStreamRevision,
    previousCommitDigest:
      wire.previousCommitDigest === null
        ? null
        : parseDigest(wire.previousCommitDigest, "$/previousCommitDigest"),
    events: Object.freeze(frozenEvents),
    ...(idempotency === undefined ? {} : { idempotency }),
    ...(writer === null ? {} : { writer }),
  });
}

export function renderDemandEventStreamCommit(commit: Readonly<DemandEventStreamCommit>): string {
  return renderDeterministicJsonDocument(commit, "$commit");
}

export function parseDemandEventStreamCommitDocument(
  text: unknown,
): Readonly<DemandEventStreamCommit> {
  let json: JsonValue;
  try {
    json = parseDeterministicJsonDocument(text, "$commit");
  } catch (error: unknown) {
    if (error instanceof DeterministicJsonDocumentError) {
      fail("representation", "$commit", error);
    }
    throw error;
  }
  const commit = parseDemandEventStreamCommit(json);
  if (renderDemandEventStreamCommit(commit) !== text) {
    fail("representation", "$commit");
  }
  return commit;
}

export function computeDemandEventStreamCommitDigest(value: unknown): Sha256Digest {
  return computeCanonicalJsonSha256Digest(parseDemandEventStreamCommit(value));
}

/** 一条命令产生的全部未提交事件及其提交身份；写者戳省略与 `null` 同义（不盖戳）。 */
export interface DemandEventStreamCommitDraft {
  readonly commitId: WakeflowDurableId<"demand-event-commit">;
  readonly commandDigest: Sha256Digest;
  readonly events: readonly [
    Readonly<DemandUncommittedEvent>,
    ...Readonly<DemandUncommittedEvent>[],
  ];
  readonly idempotency?: Readonly<DemandEventStreamCommitIdempotency>;
  readonly writer?: Readonly<DemandEventStreamCommitWriter> | null;
}

/**
 * 每类事件要么声明它绑定的流位置，要么显式声明不绑定；事件联合多出成员时这里编译不过。
 * 结果与回调的提交由追加命令的幂等键派生（ADR-0013 决定 C），不绑流位置；缺陷修复授权经决定
 * 传递绑定（决策器核对 `source.streamRevision` 等于决定的流位置加一）；其余事件的载荷不含流位置。
 */
function eventCommitBoundaryRevision(event: Readonly<DemandUncommittedEvent>): number | null {
  switch (event.eventType) {
    case "lifecycle.demand-completed":
      return event.data.completion.observedState.streamRevision;
    // 围栏令牌的期望修订必须等于本次提交的期望修订：信封与新代际都绑定它们被追加时的流位置。
    case "delivery.delivery-prepared":
      return event.data.envelope.fence.expectedStreamRevision;
    case "delivery.delivery-rearmed":
      return event.data.rearm.fence.expectedStreamRevision;
    // 决定绑定它审查时的流位置。
    case "review.target-result-decided":
      return event.data.decision.reviewed.streamRevision;
    case "publication.demand-published":
    case "lifecycle.demand-cancelled":
    case "lifecycle.demand-escalated":
    case "lifecycle.decision-recorded":
    case "lifecycle.demand-continued":
    case "evidence.managed-evidence-recorded":
    case "tasking.target-task-planned":
    case "delivery.delivery-outcome-recorded":
    case "result.target-result-recorded":
    case "result.callback-reissued":
    case "review.product-defect-remediation-authorized":
      return null;
    default:
      return unhandledEvent(event);
  }
}

function unhandledEvent(_event: never): never {
  fail("relation", "$/eventType");
}

/** 复验事件自身声明的提交边界，避免恢复身份与实际 Commit 脱节。 */
function assertEventCommitBoundary(
  event: Readonly<DemandUncommittedEvent>,
  expectedStreamRevision: number,
  path: string,
): void {
  const bound = eventCommitBoundaryRevision(event);
  if (bound !== null && bound !== expectedStreamRevision) fail("relation", path);
}

/**
 * 把提交记录确定性应用到指定的当前聚合。
 *
 * 本函数在任何文件副作用前执行，也用于磁盘读取和完整审计；因此语义非法的
 * 候选资源不能先成为不可变提交记录，再由后置重放发现错误。
 */
export function applyDemandEventStreamCommit(
  current: Readonly<DemandEventSourcingAggregate> | null,
  commit: Readonly<DemandEventStreamCommit>,
): Readonly<DemandEventSourcingAggregate> {
  if (
    (current === null &&
      (commit.commitSequence !== 1 ||
        commit.expectedStreamRevision !== 0 ||
        commit.previousCommitDigest !== null)) ||
    (current !== null &&
      (commit.demandId !== current.demandId ||
        commit.commitSequence !== current.commitSequence + 1 ||
        commit.expectedStreamRevision !== current.streamRevision ||
        commit.previousCommitDigest !== current.lastCommitDigest))
  ) {
    fail("relation", "$commit");
  }

  let state: Readonly<DemandAggregateState> | null = current?.state ?? null;
  let lastEvent: Readonly<DemandEventSourcingStoredEvent> | undefined;
  for (const [index, storedEvent] of commit.events.entries()) {
    try {
      assertSupportedDemandEventSourcingStateModelVersion(
        storedEvent.resultingStateModelVersion,
        `$/events/${index}/resultingStateModelVersion`,
      );
    } catch (error: unknown) {
      if (error instanceof DemandEventSourcingStateVersionError) {
        fail("state-version", `$/events/${index}/resultingStateModelVersion`, error);
      }
      throw error;
    }
    let currentEvent: Readonly<DemandUncommittedEvent>;
    try {
      currentEvent = upcastDemandEventSourcingStoredEvent(storedEvent);
    } catch (error: unknown) {
      if (error instanceof DemandEventSourcingUpcasterError) {
        if (error.reason === "unsupported-version" || error.reason === "unsupported-event-type") {
          fail("event-version", `$/events/${index}/eventVersion`, error);
        }
        fail("event", `$/events/${index}`, error);
      }
      throw error;
    }
    assertEventCommitBoundary(currentEvent, commit.expectedStreamRevision, `$/events/${index}`);
    let next: Readonly<DemandAggregateState>;
    try {
      next = evolveDemandEventSourcingState(state, currentEvent);
    } catch (error: unknown) {
      if (error instanceof DemandEventSourcingDecisionError) {
        fail("transition", `$/events/${index}`, error);
      }
      throw error;
    }
    if (
      storedEvent.streamRevision !== commit.firstStreamRevision + index ||
      storedEvent.resultingStateDigest !== computeDemandAggregateStateDigest(next)
    ) {
      fail("transition", `$/events/${index}`);
    }
    state = next;
    lastEvent = storedEvent;
  }
  if (state === null || lastEvent === undefined) fail("transition", "$/events");
  const lastCommitDigest = computeDemandEventStreamCommitDigest(commit);
  return parseDemandEventSourcingAggregate({
    demandId: commit.demandId,
    commitSequence: commit.commitSequence,
    streamRevision: commit.lastStreamRevision,
    lastCommitDigest,
    lastEvent,
    lastEventDigest: computeDemandEventSourcingStoredEventDigest(lastEvent),
    state,
    stateDigest: computeDemandAggregateStateDigest(state),
  });
}

/**
 * 只接纳本进程经过完整状态演进后签发的预备提交能力。
 *
 * 磁盘提交记录、恢复意图 JSON 或调用方自行构造的准备记录不能直接获得追加权限。
 * 签发结果还携带 `sourceExpectation`，供事件存储绑定指定物理尾部；进程重启后的
 * 恢复流程必须重新执行命令和决策准备。
 */
export function assertPreparedDemandEventStreamCommit(
  value: unknown,
): asserts value is Readonly<PreparedDemandEventStreamCommit> {
  if (
    typeof value !== "object" ||
    value === null ||
    types.isProxy(value) ||
    !Object.isFrozen(value) ||
    !ISSUED_PREPARED_COMMITS.has(value)
  ) {
    fail("input", "$preparedCommit");
  }
}

function buildDemandEventStreamCommit(
  current: Readonly<DemandEventSourcingAggregate> | null,
  input: Readonly<DemandEventStreamCommitDraft>,
): Readonly<PreparedDemandEventStreamCommit> {
  const firstEvent = input.events[0];
  const expectedStreamRevision = current?.streamRevision ?? 0;
  if (
    (current !== null && current.commitSequence >= Number.MAX_SAFE_INTEGER) ||
    expectedStreamRevision > Number.MAX_SAFE_INTEGER - input.events.length
  ) {
    fail("position", "$aggregate");
  }
  const commitSequence = (current?.commitSequence ?? 0) + 1;
  const demandId = current?.demandId ?? firstEvent.demandId;
  const eventIds = new Set<string>();
  for (const [index, event] of input.events.entries()) {
    if (event.demandId !== demandId || eventIds.has(event.eventId)) {
      fail("relation", `$/events/${index}`);
    }
    eventIds.add(event.eventId);
  }
  let state: Readonly<DemandAggregateState> | null = current?.state ?? null;
  const storedEvents: DemandEventSourcingStoredEvent[] = [];
  for (const [index, event] of input.events.entries()) {
    assertEventCommitBoundary(event, expectedStreamRevision, `$/events/${index}`);
    let next: Readonly<DemandAggregateState>;
    try {
      next = evolveDemandEventSourcingState(state, event);
    } catch (error: unknown) {
      if (error instanceof DemandEventSourcingDecisionError) {
        fail("transition", `$/events/${index}`, error);
      }
      throw error;
    }
    storedEvents.push(
      createDemandEventSourcingStoredEvent(event, expectedStreamRevision + index + 1, next),
    );
    state = next;
  }
  const commit = parseDemandEventStreamCommit({
    artifactKind: DEMAND_EVENT_STREAM_COMMIT_ARTIFACT_KIND,
    schemaVersion: DEMAND_EVENT_STREAM_COMMIT_SCHEMA_VERSION,
    commitId: input.commitId,
    demandId,
    commitSequence,
    commandDigest: input.commandDigest,
    expectedStreamRevision,
    firstStreamRevision: expectedStreamRevision + 1,
    lastStreamRevision: expectedStreamRevision + storedEvents.length,
    previousCommitDigest: current?.lastCommitDigest ?? null,
    events: storedEvents,
    ...(input.idempotency === undefined ? {} : { idempotency: input.idempotency }),
    ...(input.writer === undefined || input.writer === null ? {} : { writer: input.writer }),
  });
  const aggregate = applyDemandEventStreamCommit(current, commit);
  const sourceExpectation = Object.freeze({
    lastEventDigest: current?.lastEventDigest ?? null,
    stateDigest: current?.stateDigest ?? null,
  });
  return Object.freeze({ commit, aggregate, sourceExpectation });
}

/** 纯计算一条Commit计划，不签发Event Store append capability。 */
export function planDemandEventStreamCommit(
  current: Readonly<DemandEventSourcingAggregate> | null,
  input: Readonly<DemandEventStreamCommitDraft>,
): Readonly<DemandEventStreamCommit> {
  return buildDemandEventStreamCommit(current, input).commit;
}

/** 根据当前聚合和一条命令产生的全部未提交事件签发完整追加能力。 */
export function prepareDemandEventStreamCommit(
  current: Readonly<DemandEventSourcingAggregate> | null,
  input: Readonly<DemandEventStreamCommitDraft>,
): Readonly<PreparedDemandEventStreamCommit> {
  const prepared = buildDemandEventStreamCommit(current, input);
  ISSUED_PREPARED_COMMITS.add(prepared);
  return prepared;
}
