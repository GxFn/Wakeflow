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
} from "../../../foundation/identity/wakeflow-durable-id.js";
import {
  parseUtcInstant,
  UtcInstantError,
  type UtcInstant,
} from "../../../foundation/time/utc-instant.js";

/**
 * Wakeflow Governance / Demand Event Sourcing：尚未进入 Event Store 的领域事件。
 *
 * current/uncommitted event 只描述已经发生的业务事实及其稳定身份、记录时间；它不
 * 携带 persisted eventVersion、stream revision、commit sequence、predecessor 或
 * resulting-state digest。版本 codec 负责 current model 与磁盘版本之间的转换。
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

export type DemandUncommittedEvent =
  | DemandPublishedUncommittedEvent
  | DemandCancelledUncommittedEvent;

export type DemandEventSourcingEventErrorReason =
  | "input"
  | "identifier"
  | "time"
  | "digest"
  | "event-type"
  | "text";

const ERROR_MESSAGES = {
  "input": "Demand Event Sourcing event input is invalid.",
  "identifier": "Demand Event Sourcing event contains an invalid identity.",
  "time": "Demand Event Sourcing event contains an invalid recorded time.",
  "digest": "Demand Event Sourcing event contains an invalid digest.",
  "event-type": "Demand Event Sourcing event type and data do not form one closed variant.",
  "text": "Demand Event Sourcing event contains non-canonical text.",
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

/** 解析一个不含任何持久化位置字段的关闭型 uncommitted event。 */
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

  fail("event-type", "$/eventType");
}
