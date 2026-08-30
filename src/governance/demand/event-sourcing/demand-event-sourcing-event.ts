import type { Sha256Digest } from "../../../foundation/crypto/sha256.js";
import {
  parseSha256Digest,
  Sha256Error,
} from "../../../foundation/crypto/sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../../foundation/data/passive-own-data.js";
import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../../contracts/identity/wakeflow-durable-id.js";
import {
  parseUtcInstant,
  UtcInstantError,
  type UtcInstant,
} from "../../../foundation/time/utc-instant.js";
import {
  parseTaskPackage,
  TaskPackageError,
  type TaskPackage,
} from "../../tasking/task-package.js";

/**
 * Wakeflow Governance / Demand Event Sourcing：尚未进入事件存储的领域事件。
 *
 * 当前未提交事件只描述已经发生的业务事实、稳定身份和记录时间。它不携带持久化
 * `eventVersion`、事件流修订号、提交序号、前序提交或结果状态摘要。版本编解码器
 * 负责当前内存模型与磁盘版本之间的转换。
 */

export interface DemandPublishedUncommittedEvent {
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly recordedAt: UtcInstant;
  readonly eventType: "publication.demand-published";
  readonly data: Readonly<{
    readonly identityRef: "identity.json";
    readonly identityDigest: Sha256Digest;
    readonly authorityRef: "authority.json";
    readonly authorityDigest: Sha256Digest;
  }>;
}

export interface DemandCancelledUncommittedEvent {
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly recordedAt: UtcInstant;
  readonly eventType: "lifecycle.demand-cancelled";
  readonly data: Readonly<{
    readonly reason: string;
  }>;
}

export interface TargetTaskPlannedUncommittedEvent {
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly recordedAt: UtcInstant;
  readonly eventType: "tasking.target-task-planned";
  readonly data: Readonly<{
    readonly taskPackage: Readonly<TaskPackage>;
  }>;
}

export type DemandUncommittedEvent =
  | DemandPublishedUncommittedEvent
  | DemandCancelledUncommittedEvent
  | TargetTaskPlannedUncommittedEvent;

export type DemandEventSourcingEventErrorReason =
  | "input"
  | "identifier"
  | "time"
  | "digest"
  | "event-type"
  | "text"
  | "task-package"
  | "relation";

const ERROR_MESSAGES = {
  "input": "Demand Event Sourcing event input is invalid.",
  "identifier": "Demand Event Sourcing event contains an invalid identity.",
  "time": "Demand Event Sourcing event contains an invalid recorded time.",
  "digest": "Demand Event Sourcing event contains an invalid digest.",
  "event-type": "Demand Event Sourcing event type and data do not form one closed variant.",
  "text": "Demand Event Sourcing event contains non-canonical text.",
  "task-package": "Demand Event Sourcing event contains an invalid TaskPackage.",
  "relation": "Demand Event Sourcing event identity and TaskPackage do not close.",
} as const satisfies Readonly<Record<
  DemandEventSourcingEventErrorReason,
  string
>>;

export class DemandEventSourcingEventError extends Error {
  override readonly name = "DemandEventSourcingEventError";
  readonly code = "wakeflow-demand-event-sourcing-event" as const;
  readonly reason: DemandEventSourcingEventErrorReason;
  readonly path: string;

  constructor(reason: DemandEventSourcingEventErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const BASE_FIELDS = Object.freeze([
  "data",
  "demandId",
  "eventId",
  "eventType",
  "recordedAt",
] as const);
const PUBLISHED_DATA_FIELDS = Object.freeze([
  "authorityDigest",
  "authorityRef",
  "identityDigest",
  "identityRef",
] as const);
const CANCELLED_DATA_FIELDS = Object.freeze(["reason"] as const);
const TARGET_TASK_PLANNED_DATA_FIELDS = Object.freeze([
  "taskPackage",
] as const);
const CONTROL_EXCEPT_LF_PATTERN =
  /\r|[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;

function fail(
  reason: DemandEventSourcingEventErrorReason,
  path: string,
): never {
  throw new DemandEventSourcingEventError(reason, path);
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
    if (error instanceof PassiveOwnDataError) fail("input", path);
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (
    keys.length !== fields.length
    || keys.some((key, index) => key !== fields[index])
  ) {
    fail("input", path);
  }
  return record;
}

function parseId<Kind extends "demand" | "demand-event">(
  value: unknown,
  kind: Kind,
  path: string,
): WakeflowDurableId<Kind> {
  try {
    return parseWakeflowDurableIdOfKind(value, kind, path);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("identifier", path);
    throw error;
  }
}

function parseTime(value: unknown): UtcInstant {
  try {
    return parseUtcInstant(value, "$/recordedAt");
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) fail("time", "$/recordedAt");
    throw error;
  }
}

function parseDigest(value: unknown, path: string): Sha256Digest {
  try {
    return parseSha256Digest(value, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("digest", path);
    throw error;
  }
}

function parseCanonicalReason(value: unknown): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 8192
    || !value.isWellFormed()
    || value.normalize("NFC") !== value
    || value.trim() !== value
    || CONTROL_EXCEPT_LF_PATTERN.test(value)
  ) {
    fail("text", "$/data/reason");
  }
  return value;
}

/** 解析字段集合严格受限，且不含任何持久化位置字段的未提交事件。 */
export function parseDemandUncommittedEvent(
  value: unknown,
): Readonly<DemandUncommittedEvent> {
  const record = exactRecord(value, BASE_FIELDS, "$event");
  const eventId = parseId(record.eventId, "demand-event", "$/eventId");
  const demandId = parseId(record.demandId, "demand", "$/demandId");
  const recordedAt = parseTime(record.recordedAt);

  if (record.eventType === "publication.demand-published") {
    const data = exactRecord(record.data, PUBLISHED_DATA_FIELDS, "$/data");
    if (
      data.identityRef !== "identity.json"
      || data.authorityRef !== "authority.json"
    ) {
      fail("event-type", "$/data");
    }
    return Object.freeze({
      eventId,
      demandId,
      recordedAt,
      eventType: "publication.demand-published",
      data: Object.freeze({
        identityRef: "identity.json",
        identityDigest: parseDigest(data.identityDigest, "$/data/identityDigest"),
        authorityRef: "authority.json",
        authorityDigest: parseDigest(data.authorityDigest, "$/data/authorityDigest"),
      }),
    });
  }

  if (record.eventType === "lifecycle.demand-cancelled") {
    const data = exactRecord(record.data, CANCELLED_DATA_FIELDS, "$/data");
    return Object.freeze({
      eventId,
      demandId,
      recordedAt,
      eventType: "lifecycle.demand-cancelled",
      data: Object.freeze({ reason: parseCanonicalReason(data.reason) }),
    });
  }

  if (record.eventType === "tasking.target-task-planned") {
    const data = exactRecord(
      record.data,
      TARGET_TASK_PLANNED_DATA_FIELDS,
      "$/data",
    );
    let taskPackage: Readonly<TaskPackage>;
    try {
      taskPackage = parseTaskPackage(data.taskPackage);
    } catch (error: unknown) {
      if (error instanceof TaskPackageError) {
        fail("task-package", "$/data/taskPackage");
      }
      throw error;
    }
    if (
      taskPackage.demandId !== demandId
      || taskPackage.createdAt !== recordedAt
    ) {
      fail("relation", "$event");
    }
    return Object.freeze({
      eventId,
      demandId,
      recordedAt,
      eventType: "tasking.target-task-planned",
      data: Object.freeze({ taskPackage }),
    });
  }

  fail("event-type", "$/eventType");
}
