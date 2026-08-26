import type {
  WakeflowDemandAggregateState as DemandAggregateStateWire,
} from "../../../contracts/generated/governance/demand/demand-aggregate-state.generated.js";
import {
  WAKEFLOW_DEMAND_AGGREGATE_STATE_SCHEMA,
} from "../../../contracts/generated/governance/demand/demand-aggregate-state.generated.js";
import {
  computeCanonicalJsonSha256Digest,
} from "../../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../../foundation/crypto/sha256.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../../foundation/data/json-value.js";
import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../../foundation/identity/wakeflow-durable-id.js";
import {
  createRuntimeJsonSchemaValidator,
} from "../../../foundation/schema/runtime-json-schema.js";

/**
 * Wakeflow Governance / Demand Model：Domain Event reducer 生成的纯 Aggregate state。
 *
 * 本状态不保存 stream revision、event tail、identity/authority digest 或更新时间；
 * 这些属于 Event Sourcing envelope/snapshot。RH-2 的业务 section 真实地表示“尚无
 * Tasking/Delivery/Result/Test/Review/Evidence/Pod 事实”，后续只由对应 Owner 事件
 * 和 reducer 扩展，不允许 generic patch。
 */

export const DEMAND_AGGREGATE_STATE_ARTIFACT_KIND =
  "wakeflow-demand-aggregate-state" as const;
export const DEMAND_AGGREGATE_STATE_SCHEMA_VERSION = 1 as const;

export type DemandLifecycle = "active" | "completed" | "cancelled";

export interface DemandAggregateState {
  readonly artifactKind: typeof DEMAND_AGGREGATE_STATE_ARTIFACT_KIND;
  readonly schemaVersion: typeof DEMAND_AGGREGATE_STATE_SCHEMA_VERSION;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly lifecycle: DemandLifecycle;
  readonly tasking: Readonly<{
    readonly taskPackages: readonly [];
    readonly targetTasks: readonly [];
  }>;
  readonly delivery: Readonly<{
    readonly currentDeliveries: readonly [];
  }>;
  readonly result: Readonly<{
    readonly currentResults: readonly [];
  }>;
  readonly testing: Readonly<{
    readonly testCards: readonly [];
    readonly testAttempts: readonly [];
  }>;
  readonly review: Readonly<{
    readonly pendingCandidate: null;
  }>;
  readonly evidence: Readonly<{
    readonly items: readonly [];
  }>;
  readonly pod: null;
}

export type DemandAggregateStateErrorReason =
  | "json"
  | "schema"
  | "identifier"
  | "transition";

const ERROR_MESSAGES = {
  "json": "Demand aggregate state is not passive JSON data.",
  "schema": "Demand aggregate state does not satisfy its portable Schema.",
  "identifier": "Demand aggregate state contains an invalid Demand identity.",
  "transition": "Demand aggregate lifecycle transition is not admitted.",
} as const satisfies Readonly<Record<
  DemandAggregateStateErrorReason,
  string
>>;

export class DemandAggregateStateError extends Error {
  override readonly name = "DemandAggregateStateError";
  readonly code = "wakeflow-demand-aggregate-state" as const;
  readonly reason: DemandAggregateStateErrorReason;
  readonly path: string;

  constructor(reason: DemandAggregateStateErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const validateWire =
  createRuntimeJsonSchemaValidator<DemandAggregateStateWire>(
    WAKEFLOW_DEMAND_AGGREGATE_STATE_SCHEMA,
  );
const EMPTY_FACTS = Object.freeze([]) as readonly [];

function fail(reason: DemandAggregateStateErrorReason, path: string): never {
  throw new DemandAggregateStateError(reason, path);
}

function freezeState(
  wire: Readonly<DemandAggregateStateWire>,
  demandId: WakeflowDurableId<"demand">,
): Readonly<DemandAggregateState> {
  return Object.freeze({
    artifactKind: DEMAND_AGGREGATE_STATE_ARTIFACT_KIND,
    schemaVersion: DEMAND_AGGREGATE_STATE_SCHEMA_VERSION,
    demandId,
    lifecycle: wire.lifecycle,
    tasking: Object.freeze({
      taskPackages: EMPTY_FACTS,
      targetTasks: EMPTY_FACTS,
    }),
    delivery: Object.freeze({
      currentDeliveries: EMPTY_FACTS,
    }),
    result: Object.freeze({
      currentResults: EMPTY_FACTS,
    }),
    testing: Object.freeze({
      testCards: EMPTY_FACTS,
      testAttempts: EMPTY_FACTS,
    }),
    review: Object.freeze({ pendingCandidate: null }),
    evidence: Object.freeze({ items: EMPTY_FACTS }),
    pod: null,
  });
}

export function parseDemandAggregateState(
  value: unknown,
): Readonly<DemandAggregateState> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$state");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path);
    throw error;
  }
  const result = validateWire(json);
  if (!result.ok) fail("schema", result.path);
  let demandId: WakeflowDurableId<"demand">;
  try {
    demandId = parseWakeflowDurableIdOfKind(
      result.value.demandId,
      "demand",
      "$/demandId",
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("identifier", "$/demandId");
    throw error;
  }
  return freezeState(result.value, demandId);
}

/** publication.demand-published.v1 唯一允许创建的初始业务状态。 */
export function createInitialDemandAggregateState(
  demandIdValue: unknown,
): Readonly<DemandAggregateState> {
  let demandId: WakeflowDurableId<"demand">;
  try {
    demandId = parseWakeflowDurableIdOfKind(
      demandIdValue,
      "demand",
      "$demandId",
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("identifier", "$demandId");
    throw error;
  }
  return parseDemandAggregateState({
    artifactKind: DEMAND_AGGREGATE_STATE_ARTIFACT_KIND,
    schemaVersion: DEMAND_AGGREGATE_STATE_SCHEMA_VERSION,
    demandId,
    lifecycle: "active",
    tasking: { taskPackages: [], targetTasks: [] },
    delivery: { currentDeliveries: [] },
    result: { currentResults: [] },
    testing: { testCards: [], testAttempts: [] },
    review: { pendingCandidate: null },
    evidence: { items: [] },
    pod: null,
  });
}

/** lifecycle.demand-cancelled.v1 使用的纯状态转换。 */
export function cancelDemandAggregateState(
  currentValue: unknown,
): Readonly<DemandAggregateState> {
  const current = parseDemandAggregateState(currentValue);
  if (current.lifecycle !== "active") fail("transition", "$/lifecycle");
  return parseDemandAggregateState({
    ...current,
    lifecycle: "cancelled",
  });
}

export function computeDemandAggregateStateDigest(
  value: unknown,
): Sha256Digest {
  return computeCanonicalJsonSha256Digest(
    parseDemandAggregateState(value) as unknown as JsonValue,
  );
}
