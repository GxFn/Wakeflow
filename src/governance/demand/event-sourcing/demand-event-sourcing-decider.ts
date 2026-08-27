import type { Sha256Digest } from "../../../foundation/crypto/sha256.js";
import {
  computeCanonicalJsonSha256Digest,
} from "../../../foundation/crypto/canonical-json-sha256.js";
import {
  parseSha256Digest,
  Sha256Error,
} from "../../../foundation/crypto/sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../../foundation/data/passive-own-data.js";
import type { JsonValue } from "../../../foundation/data/json-value.js";
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
import {
  cancelDemandAggregateState,
  createInitialDemandAggregateState,
  parseDemandAggregateState,
  DemandAggregateStateError,
  type DemandAggregateState,
} from "../model/demand-aggregate-state.js";
import {
  parseDemandUncommittedEvent,
  DemandEventSourcingEventError,
  type DemandUncommittedEvent,
} from "./demand-event-sourcing-event.js";

/**
 * Wakeflow Governance / Demand Event Sourcing：Demand Aggregate 的纯 Decider。
 *
 * `decide` 只从已验证 command 与当前 state 产生零个或多个 uncommitted event；
 * `evolve` 只把一个 event 确定性应用到 state。两者都不读取文件、Ledger、时间或
 * 网络，也不分配 stream revision、commit sequence 或 snapshot。
 */

export interface PublishDemandCommand {
  readonly commandType: "publication.publish-demand";
  readonly commandVersion: 1;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly recordedAt: UtcInstant;
  readonly identityDigest: Sha256Digest;
  readonly authorityDigest: Sha256Digest;
}

export interface CancelDemandCommand {
  readonly commandType: "lifecycle.cancel-demand";
  readonly commandVersion: 1;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly recordedAt: UtcInstant;
  readonly reason: string;
}

export type DemandEventSourcingCommand =
  | PublishDemandCommand
  | CancelDemandCommand;

export type DemandEventSourcingDecisionErrorReason =
  | "input"
  | "identifier"
  | "time"
  | "digest"
  | "text"
  | "state"
  | "identity"
  | "transition"
  | "event";

const ERROR_MESSAGES = {
  "input": "Demand Event Sourcing command input is invalid.",
  "identifier": "Demand Event Sourcing command contains an invalid identity.",
  "time": "Demand Event Sourcing command contains an invalid recorded time.",
  "digest": "Demand Event Sourcing command contains an invalid digest.",
  "text": "Demand Event Sourcing command contains non-canonical text.",
  "state": "Demand Event Sourcing Decider received an invalid aggregate state.",
  "identity": "Demand Event Sourcing command does not belong to the aggregate.",
  "transition": "Demand Event Sourcing command or event is not admitted from the current state.",
  "event": "Demand Event Sourcing Decider received an invalid event.",
} as const satisfies Readonly<Record<
  DemandEventSourcingDecisionErrorReason,
  string
>>;

export class DemandEventSourcingDecisionError extends Error {
  override readonly name = "DemandEventSourcingDecisionError";
  readonly code = "wakeflow-demand-event-sourcing-decision" as const;
  readonly reason: DemandEventSourcingDecisionErrorReason;
  readonly path: string;

  constructor(reason: DemandEventSourcingDecisionErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const PUBLISH_FIELDS = Object.freeze([
  "authorityDigest",
  "commandType",
  "commandVersion",
  "demandId",
  "eventId",
  "identityDigest",
  "recordedAt",
] as const);
const CANCEL_FIELDS = Object.freeze([
  "commandType",
  "commandVersion",
  "demandId",
  "eventId",
  "reason",
  "recordedAt",
] as const);
const CONTROL_EXCEPT_LF_PATTERN =
  /\r|[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;

function fail(
  reason: DemandEventSourcingDecisionErrorReason,
  path: string,
): never {
  throw new DemandEventSourcingDecisionError(reason, path);
}

function exactCommand(
  value: unknown,
  fields: readonly string[],
): Readonly<Record<string, unknown>> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$command");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$command");
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (
    keys.length !== fields.length
    || keys.some((key, index) => key !== fields[index])
  ) {
    fail("input", "$command");
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

function parseReason(value: unknown): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 8192
    || !value.isWellFormed()
    || value.normalize("NFC") !== value
    || value.trim() !== value
    || CONTROL_EXCEPT_LF_PATTERN.test(value)
  ) {
    fail("text", "$/reason");
  }
  return value;
}

export function parseDemandEventSourcingCommand(
  value: unknown,
): Readonly<DemandEventSourcingCommand> {
  let base: Readonly<Record<string, unknown>>;
  try {
    base = parsePlainRecord(value, "$command");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$command");
    throw error;
  }
  if (base.commandVersion !== 1) fail("input", "$/commandVersion");

  if (base.commandType === "publication.publish-demand") {
    const command = exactCommand(base, PUBLISH_FIELDS);
    return Object.freeze({
      commandType: "publication.publish-demand",
      commandVersion: 1,
      demandId: parseId(command.demandId, "demand", "$/demandId"),
      eventId: parseId(command.eventId, "demand-event", "$/eventId"),
      recordedAt: parseTime(command.recordedAt),
      identityDigest: parseDigest(command.identityDigest, "$/identityDigest"),
      authorityDigest: parseDigest(command.authorityDigest, "$/authorityDigest"),
    });
  }

  if (base.commandType === "lifecycle.cancel-demand") {
    const command = exactCommand(base, CANCEL_FIELDS);
    return Object.freeze({
      commandType: "lifecycle.cancel-demand",
      commandVersion: 1,
      demandId: parseId(command.demandId, "demand", "$/demandId"),
      eventId: parseId(command.eventId, "demand-event", "$/eventId"),
      recordedAt: parseTime(command.recordedAt),
      reason: parseReason(command.reason),
    });
  }

  fail("input", "$/commandType");
}

/** 计算已准入 command 的稳定幂等摘要；Store 不接受调用方自报 digest。 */
export function computeDemandEventSourcingCommandDigest(
  value: unknown,
): Sha256Digest {
  return computeCanonicalJsonSha256Digest(
    parseDemandEventSourcingCommand(value) as unknown as JsonValue,
  );
}

function parseState(
  value: unknown,
): Readonly<DemandAggregateState> | null {
  if (value === null) return null;
  try {
    return parseDemandAggregateState(value);
  } catch (error: unknown) {
    if (error instanceof DemandAggregateStateError) fail("state", "$state");
    throw error;
  }
}

/** 根据当前 state 对一个业务 command 作出纯事件决策。 */
export function decideDemandEventSourcingCommand(
  stateValue: unknown,
  commandValue: unknown,
): readonly [Readonly<DemandUncommittedEvent>] {
  const state = parseState(stateValue);
  const command = parseDemandEventSourcingCommand(commandValue);

  if (command.commandType === "publication.publish-demand") {
    if (state !== null) fail("transition", "$state");
    return Object.freeze([parseDemandUncommittedEvent({
      eventId: command.eventId,
      demandId: command.demandId,
      recordedAt: command.recordedAt,
      eventType: "publication.demand-published",
      data: {
        identityRef: "identity.json",
        identityDigest: command.identityDigest,
        authorityRef: "authority.json",
        authorityDigest: command.authorityDigest,
      },
    })]) as readonly [Readonly<DemandUncommittedEvent>];
  }

  if (state === null) fail("transition", "$state");
  if (state.demandId !== command.demandId) fail("identity", "$/demandId");
  if (state.lifecycle !== "active") fail("transition", "$state/lifecycle");
  return Object.freeze([parseDemandUncommittedEvent({
    eventId: command.eventId,
    demandId: command.demandId,
    recordedAt: command.recordedAt,
    eventType: "lifecycle.demand-cancelled",
    data: { reason: command.reason },
  })]) as readonly [Readonly<DemandUncommittedEvent>];
}

/** 将一个已决定但尚未持久化的事件确定性应用到 state。 */
export function evolveDemandEventSourcingState(
  stateValue: unknown,
  eventValue: unknown,
): Readonly<DemandAggregateState> {
  const state = parseState(stateValue);
  let event: Readonly<DemandUncommittedEvent>;
  try {
    event = parseDemandUncommittedEvent(eventValue);
  } catch (error: unknown) {
    if (error instanceof DemandEventSourcingEventError) fail("event", "$event");
    throw error;
  }

  if (event.eventType === "publication.demand-published") {
    if (state !== null) fail("transition", "$state");
    return createInitialDemandAggregateState(event.demandId);
  }
  if (state === null) fail("transition", "$state");
  if (state.demandId !== event.demandId) fail("identity", "$/demandId");
  try {
    return cancelDemandAggregateState(state);
  } catch (error: unknown) {
    if (error instanceof DemandAggregateStateError) {
      fail("transition", "$state/lifecycle");
    }
    throw error;
  }
}
