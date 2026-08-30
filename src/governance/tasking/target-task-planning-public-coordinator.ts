import type {
  WakeflowTargetTaskPlanningResultV1 as TargetTaskPlanningPublicResultWire,
} from "../../contracts/generated/entrypoints/wakeflow-target-task-planning-result.generated.js";
import {
  WAKEFLOW_TARGET_TASK_PLANNING_RESULT_SCHEMA,
} from "../../contracts/generated/entrypoints/wakeflow-target-task-planning-result.generated.js";
import {
  encodeCanonicalJson,
} from "../../foundation/data/canonical-json.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../../foundation/data/json-value.js";
import {
  parsePortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  createRuntimeJsonSchemaValidator,
} from "../../foundation/schema/runtime-json-schema.js";
import {
  demandFinalRootRef,
} from "../demand/publication/demand-publication-paths.js";
import {
  parseTargetTaskPlanningPublicRequest,
  TargetTaskPlanningPublicContractError,
  WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_SCHEMA_VERSION,
  WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME,
} from "./target-task-planning-public-contract.js";
import {
  TargetTaskPlanningService,
  TargetTaskPlanningServiceError,
  type TargetTaskPlanningApplyOptions,
  type TargetTaskPlanningPreviewOptions,
  type TargetTaskPlanningServiceEventAuthority,
} from "./target-task-planning-service.js";

/**
 * Wakeflow Governance / Tasking：公共 preview/apply 的根目录和结果脱敏边界。
 *
 * MCP request 只选择 Authority member paths；Planning service 恢复完整引用并拥有所有
 * 业务校验。Coordinator 不解释计划、不追加事件，也不执行宿主效果。
 */

export type TargetTaskPlanningPublicResult =
  Readonly<TargetTaskPlanningPublicResultWire>;

export interface TargetTaskPlanningPublicCoordinatorOptions {
  readonly preview?: TargetTaskPlanningPreviewOptions;
  readonly apply?: TargetTaskPlanningApplyOptions;
}

export type TargetTaskPlanningPublicCoordinatorErrorReason =
  | "root"
  | "preview"
  | "apply"
  | "output";

const ERROR_MESSAGES = {
  root: "Target Task Planning public workspace root is invalid.",
  preview: "Target Task Planning public preview failed.",
  apply: "Target Task Planning public apply failed.",
  output: "Target Task Planning public result violated its boundary.",
} as const satisfies Readonly<Record<
  TargetTaskPlanningPublicCoordinatorErrorReason,
  string
>>;

export class TargetTaskPlanningPublicCoordinatorError extends Error {
  override readonly name = "TargetTaskPlanningPublicCoordinatorError";
  readonly code = "wakeflow-target-task-planning-public-coordinator" as const;
  readonly reason: TargetTaskPlanningPublicCoordinatorErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;
  readonly eventAuthority: TargetTaskPlanningServiceEventAuthority;

  constructor(
    reason: TargetTaskPlanningPublicCoordinatorErrorReason,
    causeCode: string | null = null,
    causeReason: string | null = null,
    eventAuthority: TargetTaskPlanningServiceEventAuthority = "unchanged",
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.causeCode = causeCode;
    this.causeReason = causeReason;
    this.eventAuthority = eventAuthority;
  }
}

const PUBLIC_RESULT_MAXIMUM_BYTES = 24 * 1024 * 1024;
const validateResult =
  createRuntimeJsonSchemaValidator<TargetTaskPlanningPublicResultWire>(
    WAKEFLOW_TARGET_TASK_PLANNING_RESULT_SCHEMA,
  );

function ownString(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined
    && Object.hasOwn(descriptor, "value")
    && typeof descriptor.value === "string"
    ? descriptor.value
    : null;
}

function fail(
  reason: TargetTaskPlanningPublicCoordinatorErrorReason,
  cause?: unknown,
  eventAuthority: TargetTaskPlanningServiceEventAuthority =
    cause instanceof TargetTaskPlanningServiceError
      ? cause.eventAuthority
      : "unchanged",
): never {
  throw new TargetTaskPlanningPublicCoordinatorError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
    eventAuthority,
  );
}

function containsPrivateText(
  value: JsonValue,
  privateValues: ReadonlySet<string>,
): boolean {
  if (typeof value === "string") {
    return [...privateValues].some((privateValue) => (
      value.includes(privateValue)
    ));
  }
  if (value === null || typeof value !== "object") return false;
  return Object.values(value).some((entry) => (
    containsPrivateText(entry, privateValues)
  ));
}

function publicResult(
  value: unknown,
  privateValues: ReadonlySet<string>,
): TargetTaskPlanningPublicResult {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$result");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("output", error);
    throw error;
  }
  if (
    encodeCanonicalJson(json, "$result").byteLength
      > PUBLIC_RESULT_MAXIMUM_BYTES
    || containsPrivateText(json, privateValues)
    || !validateResult(json).ok
  ) {
    fail("output");
  }
  return json as unknown as TargetTaskPlanningPublicResult;
}

function applyResult(
  result: Awaited<ReturnType<TargetTaskPlanningService["apply"]>>,
) {
  const taskPackage = result.plan.taskPackage;
  const targetTask = result.commandResult.aggregate.state.targetTasks.find(
    (entry) => entry.taskPackageId === taskPackage.taskPackageId,
  );
  if (targetTask === undefined) fail("output");
  const localProjectionRef = result.projection.projection.source.resourcePath;
  return {
    kind: "WakeflowTargetTaskPlanningApplyResult" as const,
    schemaVersion: WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_SCHEMA_VERSION,
    tool: WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME,
    mode: "apply" as const,
    status: "completed" as const,
    disposition: result.disposition,
    eventAuthority: "current" as const,
    demandId: result.plan.demandId,
    planDigest: result.planDigest,
    commandDigest: result.commandDigest,
    event: {
      eventId: result.projection.sourceEvent.eventId,
      streamRevision: result.projection.sourceEvent.streamRevision,
    },
    commit: {
      commitId: result.commandResult.commit.commitId,
      commitSequence: result.commandResult.commit.commitSequence,
      commitDigest: result.commitDigest,
    },
    stateDigest: result.commandResult.aggregate.stateDigest,
    targetTask: {
      targetTaskId: targetTask.targetTaskId,
      taskPackageId: targetTask.taskPackageId,
      repositoryId: targetTask.repositoryId,
      windowId: targetTask.windowId,
      phase: targetTask.phase,
    },
    taskPackageProjection: {
      disposition: result.projection.disposition,
      resourceRef: parsePortableResourcePath(
        `${demandFinalRootRef(result.plan.demandId)}/${localProjectionRef}`,
      ),
      taskPackageDigest:
        result.projection.projection.taskPackageDigest,
      documentDigest: result.projection.projection.source.digest,
    },
  };
}

/** 执行一个公共 Target Task Planning preview 或 exact-plan apply。 */
export async function executeTargetTaskPlanningPublicRequest(
  value: unknown,
  options: TargetTaskPlanningPublicCoordinatorOptions = {},
): Promise<TargetTaskPlanningPublicResult> {
  const request = parseTargetTaskPlanningPublicRequest(value);
  let root: RootedDirectory;
  try {
    root = await RootedDirectory.open(request.root, "$request.root");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) fail("root", error);
    throw error;
  }
  const privateValues = new Set([request.root, root.absolutePath]);
  let eventAuthority: TargetTaskPlanningServiceEventAuthority = "unchanged";
  let result: TargetTaskPlanningPublicResult | undefined;
  let failure: unknown;
  try {
    const service = new TargetTaskPlanningService(root);
    if (request.mode === "preview") {
      let preview;
      try {
        preview = await service.preview({
          demandId: request.demandId,
          taskPackage: request.taskPackage,
        }, options.preview);
      } catch (error: unknown) {
        if (error instanceof TargetTaskPlanningServiceError) {
          fail("preview", error);
        }
        throw error;
      }
      result = publicResult({
        kind: "WakeflowTargetTaskPlanningPreviewResult",
        schemaVersion: WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_SCHEMA_VERSION,
        tool: WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME,
        mode: "preview",
        status: "ready",
        plan: preview.plan,
        planDigest: preview.planDigest,
      }, privateValues);
    } else {
      let applied;
      try {
        applied = await service.apply(
          request.plan,
          request.planDigest,
          options.apply,
        );
        eventAuthority = "current";
      } catch (error: unknown) {
        if (error instanceof TargetTaskPlanningServiceError) {
          eventAuthority = error.eventAuthority;
          fail("apply", error);
        }
        throw error;
      }
      result = publicResult(applyResult(applied), privateValues);
    }
  } catch (error: unknown) {
    failure = error;
  }
  try {
    await root.close();
  } catch (error: unknown) {
    if (failure === undefined) fail("root", error, eventAuthority);
  }
  if (failure !== undefined) throw failure;
  if (result === undefined) fail("output", undefined, eventAuthority);
  return result;
}

export { TargetTaskPlanningPublicContractError };
