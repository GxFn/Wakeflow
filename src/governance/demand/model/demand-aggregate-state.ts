import type {
  WakeflowDemandAggregateState as DemandAggregateStateWire,
} from "../../../contracts/generated/governance/demand/demand-aggregate-state.generated.js";
import {
  WAKEFLOW_DEMAND_AGGREGATE_STATE_SCHEMA,
} from "../../../contracts/generated/governance/demand/demand-aggregate-state.generated.js";
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
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../../foundation/data/json-value.js";
import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../../contracts/identity/wakeflow-durable-id.js";
import {
  createRuntimeJsonSchemaValidator,
} from "../../../foundation/schema/runtime-json-schema.js";
import {
  computeTaskPackageDigest,
  parseTaskPackage,
  TaskPackageError,
  type TaskPackage,
} from "../../tasking/task-package.js";

/**
 * Wakeflow Governance / Demand Model：领域事件归约器生成的纯聚合状态。
 *
 * 本状态不保存事件流修订号、事件尾部、身份/权威关系摘要或更新时间；这些事实
 * 属于事件溯源的持久化封装或快照。`authorityDigest` 让纯 Decider 能验证新任务绑定
 * publication 时冻结的 Authority；`targetTasks` 只保存调度前真正需要的最小摘要，
 * 完整 TaskPackage 仍属于事件数据。尚未实现的 Delivery、Result、Test、Review、
 * Evidence 与 Pod 不使用空数组或 null 占位。
 */

const DEMAND_AGGREGATE_STATE_ARTIFACT_KIND =
  "wakeflow-demand-aggregate-state" as const;
const DEMAND_AGGREGATE_STATE_SCHEMA_VERSION = 1 as const;

export type DemandLifecycle = "active" | "cancelled";

export interface DemandTargetTaskState {
  readonly targetTaskId: WakeflowDurableId<"target-task">;
  readonly taskPackageId: WakeflowDurableId<"task-package">;
  readonly taskPackageDigest: Sha256Digest;
  readonly repositoryId: WakeflowDurableId<"repository">;
  readonly windowId: WakeflowDurableId<"window">;
  readonly phase: "planned";
}

export interface DemandAggregateState {
  readonly artifactKind: typeof DEMAND_AGGREGATE_STATE_ARTIFACT_KIND;
  readonly schemaVersion: typeof DEMAND_AGGREGATE_STATE_SCHEMA_VERSION;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly authorityDigest: Sha256Digest;
  readonly lifecycle: DemandLifecycle;
  readonly targetTasks: readonly Readonly<DemandTargetTaskState>[];
}

export type DemandAggregateStateErrorReason =
  | "json"
  | "schema"
  | "identifier"
  | "digest"
  | "task-package"
  | "relation"
  | "transition";

const ERROR_MESSAGES = {
  "json": "Demand aggregate state is not passive JSON data.",
  "schema": "Demand aggregate state does not satisfy its portable Schema.",
  "identifier": "Demand aggregate state contains an invalid Demand identity.",
  "digest": "Demand aggregate state contains an invalid digest.",
  "task-package": "Demand aggregate state transition contains an invalid TaskPackage.",
  "relation": "Demand aggregate target task summaries are inconsistent.",
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
    [WAKEFLOW_SHA256_DIGEST_SCHEMA],
  );
function fail(reason: DemandAggregateStateErrorReason, path: string): never {
  throw new DemandAggregateStateError(reason, path);
}

function parseId<Kind extends
  | "demand"
  | "target-task"
  | "task-package"
  | "repository"
  | "window"
>(
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

function parseDigest(value: unknown, path: string): Sha256Digest {
  try {
    return parseSha256Digest(value, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("digest", path);
    throw error;
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseTargetTasks(
  values: readonly DemandAggregateStateWire["targetTasks"][number][],
): readonly Readonly<DemandTargetTaskState>[] {
  const result: Readonly<DemandTargetTaskState>[] = [];
  const packageIds = new Set<string>();
  const repositoryIds = new Set<string>();
  let previousTargetTaskId: string | undefined;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined) fail("schema", `$/targetTasks/${index}`);
    const path = `$/targetTasks/${index}`;
    const targetTaskId = parseId(
      value.targetTaskId,
      "target-task",
      `${path}/targetTaskId`,
    );
    const taskPackageId = parseId(
      value.taskPackageId,
      "task-package",
      `${path}/taskPackageId`,
    );
    const repositoryId = parseId(
      value.repositoryId,
      "repository",
      `${path}/repositoryId`,
    );
    if (
      (previousTargetTaskId !== undefined
        && compareText(previousTargetTaskId, targetTaskId) >= 0)
      || packageIds.has(taskPackageId)
      || repositoryIds.has(repositoryId)
    ) {
      fail("relation", path);
    }
    previousTargetTaskId = targetTaskId;
    packageIds.add(taskPackageId);
    repositoryIds.add(repositoryId);
    result.push(Object.freeze({
      targetTaskId,
      taskPackageId,
      taskPackageDigest: parseDigest(
        value.taskPackageDigest,
        `${path}/taskPackageDigest`,
      ),
      repositoryId,
      windowId: parseId(value.windowId, "window", `${path}/windowId`),
      phase: "planned",
    }));
  }
  return Object.freeze(result);
}

function normalizeState(
  wire: Readonly<DemandAggregateStateWire>,
): Readonly<DemandAggregateState> {
  return Object.freeze({
    artifactKind: DEMAND_AGGREGATE_STATE_ARTIFACT_KIND,
    schemaVersion: DEMAND_AGGREGATE_STATE_SCHEMA_VERSION,
    demandId: parseId(wire.demandId, "demand", "$/demandId"),
    authorityDigest: parseDigest(wire.authorityDigest, "$/authorityDigest"),
    lifecycle: wire.lifecycle,
    targetTasks: parseTargetTasks(wire.targetTasks),
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
  return normalizeState(result.value);
}

/** `publication.demand-published.v1` 唯一允许创建的初始业务状态。 */
export function createInitialDemandAggregateState(
  demandIdValue: unknown,
  authorityDigestValue: unknown,
): Readonly<DemandAggregateState> {
  return parseDemandAggregateState({
    artifactKind: DEMAND_AGGREGATE_STATE_ARTIFACT_KIND,
    schemaVersion: DEMAND_AGGREGATE_STATE_SCHEMA_VERSION,
    demandId: parseId(demandIdValue, "demand", "$demandId"),
    authorityDigest: parseDigest(authorityDigestValue, "$authorityDigest"),
    lifecycle: "active",
    targetTasks: [],
  });
}

/** `tasking.target-task-planned.v1` 使用的纯状态转换。 */
export function planTargetTaskInDemandAggregateState(
  currentValue: unknown,
  taskPackageValue: unknown,
): Readonly<DemandAggregateState> {
  const current = parseDemandAggregateState(currentValue);
  let taskPackage: Readonly<TaskPackage>;
  try {
    taskPackage = parseTaskPackage(taskPackageValue);
  } catch (error: unknown) {
    if (error instanceof TaskPackageError) fail("task-package", "$taskPackage");
    throw error;
  }
  if (
    current.lifecycle !== "active"
    || taskPackage.demandId !== current.demandId
    || taskPackage.demandAuthorityDigest !== current.authorityDigest
    || current.targetTasks.some((entry) => (
      entry.targetTaskId === taskPackage.targetTaskId
      || entry.taskPackageId === taskPackage.taskPackageId
      || entry.repositoryId === taskPackage.assignment.repositoryId
    ))
  ) {
    fail("transition", "$state/targetTasks");
  }
  const nextTargetTasks = [
    ...current.targetTasks,
    Object.freeze({
      targetTaskId: taskPackage.targetTaskId,
      taskPackageId: taskPackage.taskPackageId,
      taskPackageDigest: computeTaskPackageDigest(taskPackage),
      repositoryId: taskPackage.assignment.repositoryId,
      windowId: taskPackage.assignment.windowId,
      phase: "planned" as const,
    }),
  ].sort((left, right) => compareText(left.targetTaskId, right.targetTaskId));
  return parseDemandAggregateState({
    ...current,
    targetTasks: nextTargetTasks,
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
    parseDemandAggregateState(value),
  );
}
