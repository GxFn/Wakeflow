import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import {
  computeCanonicalJsonSha256Digest,
} from "../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  parseTaskPackage,
  TaskPackageError,
  type TaskPackage,
} from "./task-package.js";

/**
 * Wakeflow Governance / Tasking：Target Task Planning 的不可变 preview/apply 计划。
 *
 * 计划冻结一次追加所需的 TaskPackage、Event/Commit 身份和预期事件流位置。它是
 * Apply 的完整输入，但计划摘要不是授权；Apply 仍须重读 Config、Demand、Ledger 和
 * 当前 stream，或证明同一 Commit 已经存在后只执行投影恢复。
 */

const TARGET_TASK_PLANNING_PLAN_KIND =
  "WakeflowTargetTaskPlanningPlan" as const;
const TARGET_TASK_PLANNING_PLAN_SCHEMA_VERSION = 1 as const;

export interface TargetTaskPlanningPlan {
  readonly kind: typeof TARGET_TASK_PLANNING_PLAN_KIND;
  readonly schemaVersion: typeof TARGET_TASK_PLANNING_PLAN_SCHEMA_VERSION;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly expectedStreamRevision: number;
  readonly commitId: WakeflowDurableId<"demand-event-commit">;
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly taskPackage: Readonly<TaskPackage>;
}

export type TargetTaskPlanningPlanErrorReason =
  | "input"
  | "identifier"
  | "position"
  | "task-package"
  | "relation";

const ERROR_MESSAGES = {
  input: "Target Task Planning plan input is invalid.",
  identifier: "Target Task Planning plan contains an invalid identity.",
  position: "Target Task Planning plan contains an invalid stream position.",
  "task-package": "Target Task Planning plan contains an invalid TaskPackage.",
  relation: "Target Task Planning plan fields do not close.",
} as const satisfies Readonly<Record<
  TargetTaskPlanningPlanErrorReason,
  string
>>;

export class TargetTaskPlanningPlanError extends Error {
  override readonly name = "TargetTaskPlanningPlanError";
  readonly code = "wakeflow-target-task-planning-plan" as const;
  readonly reason: TargetTaskPlanningPlanErrorReason;
  readonly path: string;

  constructor(reason: TargetTaskPlanningPlanErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const PLAN_FIELDS = Object.freeze([
  "commitId",
  "demandId",
  "eventId",
  "expectedStreamRevision",
  "kind",
  "schemaVersion",
  "taskPackage",
] as const);
const PLAN_DRAFT_FIELDS = Object.freeze([
  "commitId",
  "demandId",
  "eventId",
  "expectedStreamRevision",
  "taskPackage",
] as const);

function fail(
  reason: TargetTaskPlanningPlanErrorReason,
  path: string,
): never {
  throw new TargetTaskPlanningPlanError(reason, path);
}

function parseId<Kind extends
  | "demand"
  | "demand-event"
  | "demand-event-commit"
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

/** 解析并冻结一份字段集合关闭的 Planning plan。 */
export function parseTargetTaskPlanningPlan(
  value: unknown,
): Readonly<TargetTaskPlanningPlan> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$plan");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$plan");
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (
    keys.length !== PLAN_FIELDS.length
    || keys.some((key, index) => key !== PLAN_FIELDS[index])
    || record.kind !== TARGET_TASK_PLANNING_PLAN_KIND
    || record.schemaVersion !== TARGET_TASK_PLANNING_PLAN_SCHEMA_VERSION
  ) {
    fail("input", "$plan");
  }
  if (
    !Number.isSafeInteger(record.expectedStreamRevision)
    || (record.expectedStreamRevision as number) < 1
  ) {
    fail("position", "$/expectedStreamRevision");
  }
  let taskPackage: Readonly<TaskPackage>;
  try {
    taskPackage = parseTaskPackage(record.taskPackage);
  } catch (error: unknown) {
    if (error instanceof TaskPackageError) {
      fail("task-package", "$/taskPackage");
    }
    throw error;
  }
  const demandId = parseId(record.demandId, "demand", "$/demandId");
  if (taskPackage.demandId !== demandId) fail("relation", "$plan");
  return Object.freeze({
    kind: TARGET_TASK_PLANNING_PLAN_KIND,
    schemaVersion: TARGET_TASK_PLANNING_PLAN_SCHEMA_VERSION,
    demandId,
    expectedStreamRevision: record.expectedStreamRevision as number,
    commitId: parseId(
      record.commitId,
      "demand-event-commit",
      "$/commitId",
    ),
    eventId: parseId(record.eventId, "demand-event", "$/eventId"),
    taskPackage,
  });
}

/** 从已经准入的字段创建计划；仍复用同一个严格 parser。 */
export function createTargetTaskPlanningPlan(
  value: unknown,
): Readonly<TargetTaskPlanningPlan> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$draft");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$draft");
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (
    keys.length !== PLAN_DRAFT_FIELDS.length
    || keys.some((key, index) => key !== PLAN_DRAFT_FIELDS[index])
  ) {
    fail("input", "$draft");
  }
  return parseTargetTaskPlanningPlan({
    kind: TARGET_TASK_PLANNING_PLAN_KIND,
    schemaVersion: TARGET_TASK_PLANNING_PLAN_SCHEMA_VERSION,
    commitId: record.commitId,
    demandId: record.demandId,
    eventId: record.eventId,
    expectedStreamRevision: record.expectedStreamRevision,
    taskPackage: record.taskPackage,
  });
}

/** 计算 preview/apply 使用的 Canonical plan digest。 */
export function computeTargetTaskPlanningPlanDigest(
  value: unknown,
): Sha256Digest {
  return computeCanonicalJsonSha256Digest(
    parseTargetTaskPlanningPlan(value),
  );
}
