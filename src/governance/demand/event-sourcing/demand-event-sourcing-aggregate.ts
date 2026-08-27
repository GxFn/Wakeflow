import {
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../../foundation/crypto/sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../../foundation/data/passive-own-data.js";
import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../../foundation/identity/wakeflow-durable-id.js";
import {
  computeDemandAggregateStateDigest,
  parseDemandAggregateState,
  DemandAggregateStateError,
  type DemandAggregateState,
} from "../model/demand-aggregate-state.js";
import {
  computeDemandEventSourcingStoredEventDigest,
  parseDemandEventSourcingStoredEvent,
  DemandEventSourcingStoredEventError,
  type DemandEventSourcingStoredEvent,
} from "./demand-event-sourcing-stored-event.js";
import {
  parseDemandEventStreamRevision,
  type DemandEventStreamRevision,
} from "./demand-event-stream-position.js";
import {
  upcastDemandEventSourcingStoredEvent,
  DemandEventSourcingUpcasterError,
} from "./demand-event-sourcing-upcaster.js";
import {
  assertSupportedDemandEventSourcingStateModelVersion,
  DemandEventSourcingStateVersionError,
} from "./demand-event-sourcing-state-version.js";

/**
 * Wakeflow Governance / Demand Event Sourcing：一次 aggregate rehydration 结果。
 *
 * Aggregate 只保存当前 state、stream cursor 与 tail 证明，不携带完整历史事件数组。
 * 完整历史属于 Event Store；full audit 通过流式 replay 独立完成。
 */

declare const DEMAND_EVENT_COMMIT_SEQUENCE_BRAND: unique symbol;
export type DemandEventCommitSequence = number & {
  readonly [DEMAND_EVENT_COMMIT_SEQUENCE_BRAND]: "DemandEventCommitSequence";
};

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

const ERROR_MESSAGES = {
  "input": "Demand Event Sourcing aggregate input is invalid.",
  "identifier": "Demand Event Sourcing aggregate contains an invalid identity.",
  "position": "Demand Event Sourcing aggregate contains an invalid cursor.",
  "digest": "Demand Event Sourcing aggregate contains an invalid digest.",
  "event": "Demand Event Sourcing aggregate contains an invalid tail event.",
  "version": "Demand Event Sourcing aggregate tail version is unsupported.",
  "state": "Demand Event Sourcing aggregate contains an invalid state.",
  "relation": "Demand Event Sourcing aggregate cursor, tail and state do not close.",
} as const satisfies Readonly<Record<
  DemandEventSourcingAggregateErrorReason,
  string
>>;

export class DemandEventSourcingAggregateError extends Error {
  override readonly name = "DemandEventSourcingAggregateError";
  readonly code = "wakeflow-demand-event-sourcing-aggregate" as const;
  readonly reason: DemandEventSourcingAggregateErrorReason;
  readonly path: string;

  constructor(reason: DemandEventSourcingAggregateErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

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

function fail(
  reason: DemandEventSourcingAggregateErrorReason,
  path: string,
): never {
  throw new DemandEventSourcingAggregateError(reason, path);
}

export function parseDemandEventCommitSequence(
  value: unknown,
  path = "$commitSequence",
): DemandEventCommitSequence {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    fail("position", path);
  }
  return value as DemandEventCommitSequence;
}

function parseDigest(value: unknown, path: string): Sha256Digest {
  try {
    return parseSha256Digest(value, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("digest", path);
    throw error;
  }
}

/** 对进程内 aggregate cursor/state fact 做完整防御性复验。 */
export function parseDemandEventSourcingAggregate(
  value: unknown,
): Readonly<DemandEventSourcingAggregate> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$aggregate");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$aggregate");
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (
    keys.length !== FIELDS.length
    || keys.some((key, index) => key !== FIELDS[index])
  ) {
    fail("input", "$aggregate");
  }
  let demandId: WakeflowDurableId<"demand">;
  try {
    demandId = parseWakeflowDurableIdOfKind(
      record.demandId,
      "demand",
      "$/demandId",
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) {
      fail("identifier", "$/demandId");
    }
    throw error;
  }
  let lastEvent: Readonly<DemandEventSourcingStoredEvent>;
  try {
    lastEvent = parseDemandEventSourcingStoredEvent(record.lastEvent);
  } catch (error: unknown) {
    if (error instanceof DemandEventSourcingStoredEventError) {
      fail("event", "$/lastEvent");
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
      error instanceof DemandEventSourcingStateVersionError
      || error instanceof DemandEventSourcingUpcasterError
    ) {
      fail("version", "$/lastEvent");
    }
    throw error;
  }
  let state: Readonly<DemandAggregateState>;
  try {
    state = parseDemandAggregateState(record.state);
  } catch (error: unknown) {
    if (error instanceof DemandAggregateStateError) fail("state", "$/state");
    throw error;
  }
  const streamRevision = parseDemandEventStreamRevision(
    record.streamRevision,
    "$/streamRevision",
  );
  const lastEventDigest = parseDigest(
    record.lastEventDigest,
    "$/lastEventDigest",
  );
  const stateDigest = parseDigest(record.stateDigest, "$/stateDigest");
  const commitSequence = parseDemandEventCommitSequence(
    record.commitSequence,
    "$/commitSequence",
  );
  if (
    commitSequence > streamRevision
    ||
    lastEvent.demandId !== demandId
    || lastEvent.streamRevision !== streamRevision
    || state.demandId !== demandId
    || computeDemandEventSourcingStoredEventDigest(lastEvent) !== lastEventDigest
    || computeDemandAggregateStateDigest(state) !== stateDigest
    || lastEvent.resultingStateDigest !== stateDigest
  ) {
    fail("relation", "$aggregate");
  }
  return Object.freeze({
    demandId,
    commitSequence,
    streamRevision,
    lastCommitDigest: parseDigest(
      record.lastCommitDigest,
      "$/lastCommitDigest",
    ),
    lastEvent,
    lastEventDigest,
    state,
    stateDigest,
  });
}
