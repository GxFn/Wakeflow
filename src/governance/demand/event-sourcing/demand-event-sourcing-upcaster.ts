import {
  EventSourcingVersionEvolutionError,
} from "../../../foundation/event-sourcing/event-sourcing-version-evolution.js";
import {
  DemandEventSourcingEventError,
  type DemandUncommittedEvent,
} from "./demand-event-sourcing-event.js";
import {
  decodeDemandEventSourcingPersistedEvent,
} from "./demand-event-sourcing-event-version-codec.js";
import {
  parseDemandEventSourcingPersistedEventEnvelope,
  DemandEventSourcingPersistedEventEnvelopeError,
} from "./demand-event-sourcing-persisted-event-envelope.js";

/**
 * Wakeflow Governance / Demand Event Sourcing：持久化事件的版本演进与升版转换。
 *
 * 处理顺序依次为事件封装准入、事件家族编解码、逐级版本注册表转换和当前事件模型
 * 投影。未知类型或版本会在归约器执行前失败。本模块不修改持久化字节或摘要、不读取
 * 文件或快照，也不承担状态模型版本的历史摘要验证。
 */

export type DemandEventSourcingUpcasterErrorReason =
  | "input"
  | "unsupported-event-type"
  | "unsupported-version"
  | "codec"
  | "upcast"
  | "event";

const ERROR_MESSAGES = {
  "input": "Demand Event Sourcing upcaster input is invalid.",
  "unsupported-event-type": "Demand Event Sourcing event type is unsupported.",
  "unsupported-version": "Demand Event Sourcing event version is unsupported.",
  "codec": "Demand Event Sourcing persisted event payload is invalid.",
  "upcast": "Demand Event Sourcing event version evolution failed.",
  "event": "Demand Event Sourcing persisted event cannot become a current event.",
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

/** 把任一受支持的持久化版本转换为当前归约器事件。 */
export function upcastDemandEventSourcingStoredEvent(
  value: unknown,
): Readonly<DemandUncommittedEvent> {
  let envelope;
  try {
    envelope = parseDemandEventSourcingPersistedEventEnvelope(value);
  } catch (error: unknown) {
    if (error instanceof DemandEventSourcingPersistedEventEnvelopeError) {
      fail("input", error.path);
    }
    throw error;
  }
  try {
    return decodeDemandEventSourcingPersistedEvent(envelope);
  } catch (error: unknown) {
    if (error instanceof EventSourcingVersionEvolutionError) {
      if (error.path === "$/eventType") {
        fail("unsupported-event-type", "$/eventType");
      }
      if (error.reason === "unsupported-version") {
        fail("unsupported-version", "$/eventVersion");
      }
      if (error.reason === "codec") fail("codec", "$/data");
      fail("upcast", "$/data");
    }
    if (error instanceof DemandEventSourcingEventError) {
      fail("event", "$event");
    }
    throw error;
  }
}

export {
  DEMAND_EVENT_SOURCING_CURRENT_EVENT_VERSIONS,
} from "./demand-event-sourcing-event-version-codec.js";
