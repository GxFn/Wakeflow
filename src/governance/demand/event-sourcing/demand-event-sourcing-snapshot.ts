import type {
  WakeflowDemandEventSourcingSnapshot as SnapshotWire,
} from "../../../contracts/generated/governance/demand/demand-event-sourcing-snapshot.generated.js";
import {
  WAKEFLOW_DEMAND_EVENT_SOURCING_SNAPSHOT_SCHEMA,
} from "../../../contracts/generated/governance/demand/demand-event-sourcing-snapshot.generated.js";
import { WAKEFLOW_DEMAND_AGGREGATE_STATE_SCHEMA } from "../../../contracts/generated/governance/demand/demand-aggregate-state.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../../contracts/generated/foundation/sha256-digest.generated.js";
import {
  computeCanonicalJsonSha256Digest,
} from "../../../foundation/crypto/canonical-json-sha256.js";
import {
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../../foundation/crypto/sha256.js";
import {
  DeterministicJsonDocumentError,
  parseDeterministicJsonDocument,
  renderDeterministicJsonDocument,
} from "../../../foundation/data/deterministic-json-document.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../../foundation/data/json-value.js";
import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../../contracts/identity/wakeflow-durable-id.js";
import { createRuntimeJsonSchemaValidator } from "../../../foundation/schema/runtime-json-schema.js";
import {
  computeDemandAggregateStateDigest,
  parseDemandAggregateState,
  DemandAggregateStateError,
  type DemandAggregateState,
} from "../model/demand-aggregate-state.js";
import {
  computeDemandEventStreamCommitDigest,
  parseDemandEventStreamCommit,
  DemandEventStreamCommitError,
  type DemandEventStreamCommit,
} from "./demand-event-stream-commit.js";
import {
  parseDemandEventSourcingAggregate,
  DemandEventSourcingAggregateError,
  type DemandEventSourcingAggregate,
} from "./demand-event-sourcing-aggregate.js";
import {
  computeDemandEventSourcingStoredEventDigest,
} from "./demand-event-sourcing-stored-event.js";
import {
  parseDemandEventCommitSequence,
  parseDemandEventStreamRevision,
  DemandEventStreamPositionError,
  type DemandEventCommitSequence,
  type DemandEventStreamRevision,
} from "./demand-event-stream-position.js";
import {
  computeDemandEventSourcingVersionCompatibilityDigest,
} from "./demand-event-sourcing-version-compatibility.js";

/**
 * Wakeflow Governance / Demand Event Sourcing：不可变、带版本的快照。
 *
 * 快照只在完整提交边界创建，并绑定提交摘要、事件流尾部和聚合状态。它是可以删除、
 * 可以重建的优化，不是事件权威事实。快照不兼容或损坏时，仓储会选择更早的快照，
 * 或从提交 1 完整重放；正常加载不会在读取路径中改写快照。
 */

const DEMAND_EVENT_SOURCING_SNAPSHOT_ARTIFACT_KIND =
  "wakeflow-demand-event-sourcing-snapshot" as const;
const DEMAND_EVENT_SOURCING_SNAPSHOT_SCHEMA_VERSION = 1 as const;

export interface DemandEventSourcingSnapshot {
  readonly artifactKind: typeof DEMAND_EVENT_SOURCING_SNAPSHOT_ARTIFACT_KIND;
  readonly schemaVersion: typeof DEMAND_EVENT_SOURCING_SNAPSHOT_SCHEMA_VERSION;
  readonly versionCompatibilityDigest: Sha256Digest;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly commitSequence: DemandEventCommitSequence;
  readonly streamRevision: DemandEventStreamRevision;
  readonly lastCommitDigest: Sha256Digest;
  readonly lastEventId: WakeflowDurableId<"demand-event">;
  readonly lastEventDigest: Sha256Digest;
  readonly state: Readonly<DemandAggregateState>;
  readonly stateDigest: Sha256Digest;
}

export type DemandEventSourcingSnapshotErrorReason =
  | "input"
  | "json"
  | "schema"
  | "identifier"
  | "position"
  | "digest"
  | "state"
  | "aggregate"
  | "commit"
  | "mismatch"
  | "representation";

const ERROR_MESSAGES = {
  "input": "Demand Event Sourcing snapshot input is invalid.",
  "json": "Demand Event Sourcing snapshot is not passive JSON data.",
  "schema": "Demand Event Sourcing snapshot does not satisfy its Schema.",
  "identifier": "Demand Event Sourcing snapshot contains an invalid identity.",
  "position": "Demand Event Sourcing snapshot contains an invalid stream position.",
  "digest": "Demand Event Sourcing snapshot contains an invalid digest.",
  "state": "Demand Event Sourcing snapshot contains an invalid aggregate state.",
  "aggregate": "Demand Event Sourcing snapshot requires a valid aggregate.",
  "commit": "Demand Event Sourcing snapshot requires a valid anchor commit.",
  "mismatch": "Demand Event Sourcing snapshot does not match its commit boundary.",
  "representation": "Demand Event Sourcing snapshot bytes are not deterministic.",
} as const satisfies Readonly<Record<
  DemandEventSourcingSnapshotErrorReason,
  string
>>;

export class DemandEventSourcingSnapshotError extends Error {
  override readonly name = "DemandEventSourcingSnapshotError";
  readonly code = "wakeflow-demand-event-sourcing-snapshot" as const;
  readonly reason: DemandEventSourcingSnapshotErrorReason;
  readonly path: string;

  constructor(reason: DemandEventSourcingSnapshotErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateWire = createRuntimeJsonSchemaValidator<SnapshotWire>(
  WAKEFLOW_DEMAND_EVENT_SOURCING_SNAPSHOT_SCHEMA,
  [WAKEFLOW_DEMAND_AGGREGATE_STATE_SCHEMA, WAKEFLOW_SHA256_DIGEST_SCHEMA],
);

function fail(
  reason: DemandEventSourcingSnapshotErrorReason,
  path: string,
): never {
  throw new DemandEventSourcingSnapshotError(reason, path);
}

function parseDigest(value: unknown, path: string): Sha256Digest {
  try {
    return parseSha256Digest(value, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("digest", path);
    throw error;
  }
}

export function parseDemandEventSourcingSnapshot(
  value: unknown,
): Readonly<DemandEventSourcingSnapshot> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$snapshot");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    throw error;
  }
  const result = validateWire(json);
  if (!result.ok) fail("schema", result.path);
  const wire = result.value;
  let demandId: WakeflowDurableId<"demand">;
  let lastEventId: WakeflowDurableId<"demand-event">;
  try {
    demandId = parseWakeflowDurableIdOfKind(
      wire.demandId,
      "demand",
      "$/demandId",
    );
    lastEventId = parseWakeflowDurableIdOfKind(
      wire.lastEventId,
      "demand-event",
      "$/lastEventId",
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) {
      fail("identifier", error.path);
    }
    throw error;
  }
  let state: Readonly<DemandAggregateState>;
  try {
    state = parseDemandAggregateState(wire.state);
  } catch (error: unknown) {
    if (error instanceof DemandAggregateStateError) fail("state", "$/state");
    throw error;
  }
  const stateDigest = parseDigest(wire.stateDigest, "$/stateDigest");
  const versionCompatibilityDigest = parseDigest(
    wire.versionCompatibilityDigest,
    "$/versionCompatibilityDigest",
  );
  let commitSequence: DemandEventCommitSequence;
  let streamRevision: DemandEventStreamRevision;
  try {
    commitSequence = parseDemandEventCommitSequence(
      wire.commitSequence,
      "$/commitSequence",
    );
    streamRevision = parseDemandEventStreamRevision(
      wire.streamRevision,
      "$/streamRevision",
    );
  } catch (error: unknown) {
    if (error instanceof DemandEventStreamPositionError) {
      fail("position", error.path);
    }
    throw error;
  }
  if (
    state.demandId !== demandId
    || commitSequence > streamRevision
    || computeDemandAggregateStateDigest(state) !== stateDigest
    || versionCompatibilityDigest
      !== computeDemandEventSourcingVersionCompatibilityDigest()
  ) {
    fail("mismatch", "$snapshot");
  }
  return Object.freeze({
    artifactKind: DEMAND_EVENT_SOURCING_SNAPSHOT_ARTIFACT_KIND,
    schemaVersion: DEMAND_EVENT_SOURCING_SNAPSHOT_SCHEMA_VERSION,
    versionCompatibilityDigest,
    demandId,
    commitSequence,
    streamRevision,
    lastCommitDigest: parseDigest(
      wire.lastCommitDigest,
      "$/lastCommitDigest",
    ),
    lastEventId,
    lastEventDigest: parseDigest(wire.lastEventDigest, "$/lastEventDigest"),
    state,
    stateDigest,
  });
}

export function createDemandEventSourcingSnapshot(
  aggregateValue: unknown,
): Readonly<DemandEventSourcingSnapshot> {
  let aggregate: Readonly<DemandEventSourcingAggregate>;
  try {
    aggregate = parseDemandEventSourcingAggregate(aggregateValue);
  } catch (error: unknown) {
    if (error instanceof DemandEventSourcingAggregateError) {
      fail("aggregate", "$aggregate");
    }
    throw error;
  }
  return parseDemandEventSourcingSnapshot({
    artifactKind: DEMAND_EVENT_SOURCING_SNAPSHOT_ARTIFACT_KIND,
    schemaVersion: DEMAND_EVENT_SOURCING_SNAPSHOT_SCHEMA_VERSION,
    versionCompatibilityDigest:
      computeDemandEventSourcingVersionCompatibilityDigest(),
    demandId: aggregate.demandId,
    commitSequence: aggregate.commitSequence,
    streamRevision: aggregate.streamRevision,
    lastCommitDigest: aggregate.lastCommitDigest,
    lastEventId: aggregate.lastEvent.eventId,
    lastEventDigest: aggregate.lastEventDigest,
    state: aggregate.state,
    stateDigest: aggregate.stateDigest,
  });
}

/** 从快照及其指定锚定提交恢复轻量聚合游标和状态。 */
export function restoreDemandEventSourcingSnapshot(
  snapshotValue: unknown,
  anchorCommitValue: unknown,
): Readonly<DemandEventSourcingAggregate> {
  const snapshot = parseDemandEventSourcingSnapshot(snapshotValue);
  let anchor: Readonly<DemandEventStreamCommit>;
  try {
    anchor = parseDemandEventStreamCommit(anchorCommitValue);
  } catch (error: unknown) {
    if (error instanceof DemandEventStreamCommitError) fail("commit", "$commit");
    throw error;
  }
  const lastEvent = anchor.events.at(-1);
  if (
    lastEvent === undefined
    || anchor.demandId !== snapshot.demandId
    || anchor.commitSequence !== snapshot.commitSequence
    || anchor.lastStreamRevision !== snapshot.streamRevision
    || computeDemandEventStreamCommitDigest(anchor) !== snapshot.lastCommitDigest
    || lastEvent.eventId !== snapshot.lastEventId
    || computeDemandEventSourcingStoredEventDigest(lastEvent)
      !== snapshot.lastEventDigest
    || lastEvent.resultingStateDigest !== snapshot.stateDigest
  ) {
    fail("mismatch", "$snapshot");
  }
  try {
    return parseDemandEventSourcingAggregate({
      demandId: snapshot.demandId,
      commitSequence: snapshot.commitSequence,
      streamRevision: snapshot.streamRevision,
      lastCommitDigest: snapshot.lastCommitDigest,
      lastEvent,
      lastEventDigest: snapshot.lastEventDigest,
      state: snapshot.state,
      stateDigest: snapshot.stateDigest,
    });
  } catch (error: unknown) {
    if (error instanceof DemandEventSourcingAggregateError) {
      fail("mismatch", "$snapshot");
    }
    throw error;
  }
}

export function renderDemandEventSourcingSnapshot(value: unknown): string {
  return renderDeterministicJsonDocument(
    parseDemandEventSourcingSnapshot(value),
    "$snapshot",
  );
}

export function parseDemandEventSourcingSnapshotDocument(
  text: unknown,
): Readonly<DemandEventSourcingSnapshot> {
  let json: JsonValue;
  try {
    json = parseDeterministicJsonDocument(text, "$snapshot");
  } catch (error: unknown) {
    if (error instanceof DeterministicJsonDocumentError) {
      fail("representation", "$snapshot");
    }
    throw error;
  }
  const snapshot = parseDemandEventSourcingSnapshot(json);
  if (renderDemandEventSourcingSnapshot(snapshot) !== text) {
    fail("representation", "$snapshot");
  }
  return snapshot;
}

/** 快照自身的语义摘要；它与快照中的聚合 `stateDigest` 明确不同。 */
export function computeDemandEventSourcingSnapshotDigest(
  value: unknown,
): Sha256Digest {
  return computeCanonicalJsonSha256Digest(
    parseDemandEventSourcingSnapshot(value),
  );
}
