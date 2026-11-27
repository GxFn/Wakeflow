import {
  parseWakeflowDurableIdOfKind,
  type WakeflowDurableId,
  WakeflowDurableIdError,
} from "../../../contracts/identity/wakeflow-durable-id.js";
import {
  parseSha256Digest,
  type Sha256Digest,
  Sha256Error,
} from "../../../foundation/crypto/sha256.js";
import {
  PassiveOwnDataError,
  parsePlainRecord,
} from "../../../foundation/data/passive-own-data.js";
import { type Fail, failWith, ModuleError } from "../../../foundation/error/module-error.js";
import {
  computeDemandAggregateStateDigest,
  type DemandAggregateState,
  DemandAggregateStateError,
  parseDemandAggregateState,
} from "../model/demand-aggregate-state.js";
import {
  assertSupportedDemandEventSourcingStateModelVersion,
  DemandEventSourcingStateVersionError,
} from "./demand-event-sourcing-state-version.js";
import {
  computeDemandEventSourcingStoredEventDigest,
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
 * Wakeflow Governance / Demand Event Sourcing：一次聚合重建结果。
 *
 * 聚合只保存当前状态、事件流游标和尾部证明，不携带完整历史事件数组。完整历史属于
 * 事件存储；完整审计通过流式重放独立完成。
 */

export interface DemandEventSourcingAggregate {
  readonly demandId: WakeflowDurableId<"demand">;
  readonly commitSequence: DemandEventCommitSequence;
  readonly streamRevision: DemandEventStreamRevision;
  readonly lastCommitDigest: Sha256Digest;
  readonly lastEvent: Readonly<DemandEventSourcingStoredEvent>;
  readonly lastEventDigest: Sha256Digest;
  readonly state: Readonly<DemandAggregateState>;
  readonly stateDigest: Sha256Digest;
}

export type DemandEventSourcingAggregateErrorReason =
  | "input"
  | "identifier"
  | "position"
  | "digest"
  | "event"
  | "version"
  | "state"
  | "relation";

export class DemandEventSourcingAggregateError extends ModuleError<DemandEventSourcingAggregateErrorReason> {
  static override readonly code = "wakeflow-demand-event-sourcing-aggregate";
}

const fail: Fail<DemandEventSourcingAggregateErrorReason> = failWith(
  DemandEventSourcingAggregateError,
);

const FIELDS = Object.freeze([
  "commitSequence",
  "demandId",
  "lastCommitDigest",
  "lastEvent",
  "lastEventDigest",
  "state",
  "stateDigest",
  "streamRevision",
] as const);

function parseDigest(value: unknown, path: string): Sha256Digest {
  try {
    return parseSha256Digest(value, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("digest", path, error);
    throw error;
  }
}

function parseAggregateDemandId(value: unknown): WakeflowDurableId<"demand"> {
  try {
    return parseWakeflowDurableIdOfKind(value, "demand", "$/demandId");
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) {
      fail("identifier", "$/demandId", error);
    }
    throw error;
  }
}

/** 聚合的最后一个事件：先按存储形状解析，再确认它的状态模型版本受支持、事件本身升级得上来。 */
function parseAggregateLastEvent(value: unknown): Readonly<DemandEventSourcingStoredEvent> {
  let lastEvent: Readonly<DemandEventSourcingStoredEvent>;
  try {
    lastEvent = parseDemandEventSourcingStoredEvent(value);
  } catch (error: unknown) {
    if (error instanceof DemandEventSourcingStoredEventError) {
      fail("event", "$/lastEvent", error);
    }
    throw error;
  }
  try {
    assertSupportedDemandEventSourcingStateModelVersion(
      lastEvent.resultingStateModelVersion,
      "$/lastEvent/resultingStateModelVersion",
    );
    upcastDemandEventSourcingStoredEvent(lastEvent);
  } catch (error: unknown) {
    if (
      error instanceof DemandEventSourcingStateVersionError ||
      error instanceof DemandEventSourcingUpcasterError
    ) {
      fail("version", "$/lastEvent", error);
    }
    throw error;
  }
  return lastEvent;
}

function parseAggregateState(value: unknown): Readonly<DemandAggregateState> {
  try {
    return parseDemandAggregateState(value);
  } catch (error: unknown) {
    if (error instanceof DemandAggregateStateError) fail("state", "$/state", error);
    throw error;
  }
}

function parseAggregatePosition(record: Readonly<Record<string, unknown>>): Readonly<{
  streamRevision: DemandEventStreamRevision;
  commitSequence: DemandEventCommitSequence;
}> {
  try {
    const streamRevision = parseDemandEventStreamRevision(
      record.streamRevision,
      "$/streamRevision",
    );
    const commitSequence = parseDemandEventCommitSequence(
      record.commitSequence,
      "$/commitSequence",
    );
    return { streamRevision, commitSequence };
  } catch (error: unknown) {
    if (error instanceof DemandEventStreamPositionError) {
      fail("position", error.path, error);
    }
    throw error;
  }
}

/** 对进程内聚合游标和状态事实执行完整的防御性复验。 */
export function parseDemandEventSourcingAggregate(
  value: unknown,
): Readonly<DemandEventSourcingAggregate> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$aggregate");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$aggregate", error);
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (keys.length !== FIELDS.length || keys.some((key, index) => key !== FIELDS[index])) {
    fail("input", "$aggregate");
  }
  const demandId = parseAggregateDemandId(record.demandId);
  const lastEvent = parseAggregateLastEvent(record.lastEvent);
  const state = parseAggregateState(record.state);
  const { streamRevision, commitSequence } = parseAggregatePosition(record);
  const lastEventDigest = parseDigest(record.lastEventDigest, "$/lastEventDigest");
  const stateDigest = parseDigest(record.stateDigest, "$/stateDigest");
  if (
    commitSequence > streamRevision ||
    lastEvent.demandId !== demandId ||
    lastEvent.streamRevision !== streamRevision ||
    state.demandId !== demandId ||
    computeDemandEventSourcingStoredEventDigest(lastEvent) !== lastEventDigest ||
    computeDemandAggregateStateDigest(state) !== stateDigest ||
    lastEvent.resultingStateDigest !== stateDigest
  ) {
    fail("relation", "$aggregate");
  }
  return Object.freeze({
    demandId,
    commitSequence,
    streamRevision,
    lastCommitDigest: parseDigest(record.lastCommitDigest, "$/lastCommitDigest"),
    lastEvent,
    lastEventDigest,
    state,
    stateDigest,
  });
}
