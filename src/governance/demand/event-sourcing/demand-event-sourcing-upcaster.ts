import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../../foundation/data/passive-own-data.js";
import type { DemandUncommittedEvent } from "./demand-event-sourcing-event.js";
import {
  parseDemandEventSourcingStoredEvent,
  toDemandUncommittedEvent,
  DemandEventSourcingStoredEventError,
} from "./demand-event-sourcing-stored-event.js";

/**
 * Wakeflow Governance / Demand Event Sourcing：历史 event upcaster registry。
 *
 * persisted `eventType` 不绑定 TypeScript class 名；`eventType + eventVersion` 先通过
 * 本 registry 路由，再转换成当前 reducer 接受的 uncommitted event。当前只有 v1，
 * 但版本分派已经是显式代码路径，未来版本不得通过修改历史 bytes 实现。
 */

export const DEMAND_EVENT_SOURCING_CURRENT_EVENT_VERSIONS = Object.freeze({
  "publication.demand-published": 1,
  "lifecycle.demand-cancelled": 1,
} as const);

export type DemandEventSourcingUpcasterErrorReason =
  | "input"
  | "unsupported-version"
  | "event";

const ERROR_MESSAGES = {
  "input": "Demand Event Sourcing upcaster input is invalid.",
  "unsupported-version": "Demand Event Sourcing event version is unsupported.",
  "event": "Demand Event Sourcing stored event cannot be upcast.",
} as const satisfies Readonly<Record<
  DemandEventSourcingUpcasterErrorReason,
  string
>>;

export class DemandEventSourcingUpcasterError extends Error {
  override readonly name = "DemandEventSourcingUpcasterError";
  readonly code = "wakeflow-demand-event-sourcing-upcaster" as const;
  readonly reason: DemandEventSourcingUpcasterErrorReason;
  readonly path: string;

  constructor(reason: DemandEventSourcingUpcasterErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function fail(reason: DemandEventSourcingUpcasterErrorReason, path: string): never {
  throw new DemandEventSourcingUpcasterError(reason, path);
}

/** 把任一受支持 persisted version 转换成当前 reducer event。 */
export function upcastDemandEventSourcingStoredEvent(
  value: unknown,
): Readonly<DemandUncommittedEvent> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$event");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$event");
    throw error;
  }
  const eventType = record.eventType;
  const eventVersion = record.eventVersion;
  if (
    typeof eventType !== "string"
    || typeof eventVersion !== "number"
    || !Number.isSafeInteger(eventVersion)
  ) {
    fail("input", "$event");
  }
  const currentVersion = Object.hasOwn(
    DEMAND_EVENT_SOURCING_CURRENT_EVENT_VERSIONS,
    eventType,
  )
    ? DEMAND_EVENT_SOURCING_CURRENT_EVENT_VERSIONS[
        eventType as keyof typeof DEMAND_EVENT_SOURCING_CURRENT_EVENT_VERSIONS
      ]
    : undefined;
  if (currentVersion === undefined || eventVersion !== currentVersion) {
    fail("unsupported-version", "$/eventVersion");
  }
  try {
    return toDemandUncommittedEvent(
      parseDemandEventSourcingStoredEvent(record),
    );
  } catch (error: unknown) {
    if (error instanceof DemandEventSourcingStoredEventError) {
      fail("event", "$event");
    }
    throw error;
  }
}
