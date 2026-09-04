import type { WakeflowTargetTaskPlanningResultV1 } from "../../contracts/generated/entrypoints/wakeflow-target-task-planning-result.generated.js";
import { WAKEFLOW_TARGET_TASK_PLANNING_RESULT_SCHEMA } from "../../contracts/generated/entrypoints/wakeflow-target-task-planning-result.generated.js";
import type { WakeflowDurableId } from "../../contracts/identity/wakeflow-durable-id.js";
import type { JsonValue } from "../../foundation/data/json-value.js";
import { parsePortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import type { UtcWallClock } from "../../foundation/time/wall-clock.js";
import { buildDemandControllerRoute } from "../../governance/controller/demand-controller-route.js";
import {
  computeDemandEventSourcingCommandDigest,
  parseDemandEventSourcingCommand,
} from "../../governance/demand/event-sourcing/demand-event-sourcing-decider.js";
import {
  executeDemandEventSourcingCommand,
  DemandEventSourcingCommandHandlerError,
  type DemandEventSourcingCommandResult,
} from "../../governance/demand/event-sourcing/demand-event-sourcing-command-handler.js";
import {
  DemandEventSourcingRepository,
  DemandEventSourcingRepositoryError,
} from "../../governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { computeDemandEventStreamCommitDigest } from "../../governance/demand/event-sourcing/demand-event-stream-commit.js";
import { upcastDemandEventSourcingStoredEvent } from "../../governance/demand/event-sourcing/demand-event-sourcing-upcaster.js";
import { demandFinalRootRef } from "../../governance/demand/publication/demand-publication-paths.js";
import { readDemandResultReviewSnapshot } from "../../governance/review/demand-result-review-snapshot.js";
import {
  assertTargetTaskPlanningAuthorityAndTopology,
  closeTargetTaskPlanningAuthorityContext,
  openTargetTaskPlanningAuthorityContext,
  resolveTargetTaskPlanningAuthorityReferences,
  TargetTaskPlanningAuthorityError,
  type TargetTaskPlanningAuthorityContext,
} from "../../governance/tasking/target-task-planning-authority.js";
import {
  parseTargetTaskPlanningPreviewRequest,
  TargetTaskPlanningInputError,
} from "../../governance/tasking/target-task-planning-input.js";
import {
  parseTargetTaskPlanningPublicRequest,
  WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_SCHEMA_VERSION,
  WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME,
} from "../../governance/tasking/target-task-planning-public-contract.js";
import {
  computeTaskPackageDigest,
  createTaskPackage,
  TaskPackageError,
  type TaskPackage,
} from "../../governance/tasking/task-package.js";
import {
  TaskPackageProjectionStore,
  TaskPackageProjectionStoreError,
  type TaskPackageProjectionMaterializationReceipt,
} from "../../governance/tasking/task-package-projection-store.js";
import {
  createTestTaskPackage,
  TestTaskPackageError,
} from "../../governance/testing/test-task-package.js";
import {
  assertTestTaskPlanningPackage,
  loadTestTaskPlanningSources,
  TestTaskPlanningAuthorityError,
} from "../../governance/testing/test-task-planning-authority.js";
import {
  runAppendCommand,
  type AppendCommandBinding,
  type AppendCommandEnvelope,
} from "../../kernel/append-command.js";
import { fail, isWakeflowError } from "../../kernel/error.js";
import { deriveDurableId } from "../../kernel/ids.js";
import {
  deriveNextProjection,
  type NextProjection,
} from "../../kernel/next-projection.js";

/**
 * Wakeflow Capabilities / Tasking：`wakeflow_plan_target_task` 切片（ADR-0013 试点）。
 *
 * 追加型一次调用：Controller 提交任务包草稿与幂等键，Wakeflow 校验权威与拓扑、
 * 派生确定性身份、追加 `tasking.target-task-planned`、物化任务包投影、返回 `next`。
 * 同键同请求的重试返回首次结果；同键不同请求以 `idempotency-mismatch` 拒绝。
 */

export interface ExecuteTargetTaskPlanningOptions {
  readonly clock?: UtcWallClock;
  readonly signal?: AbortSignal;
}

type PublicResult = Readonly<WakeflowTargetTaskPlanningResultV1>;

interface SliceInput {
  readonly taskPackage: ReturnType<
    typeof parseTargetTaskPlanningPreviewRequest
  >["taskPackage"];
}

interface SliceOutcome {
  readonly commandResult: Readonly<
    Pick<DemandEventSourcingCommandResult, "disposition" | "commit" | "aggregate">
  >;
  readonly taskPackage: Readonly<TaskPackage>;
  readonly projection: Readonly<TaskPackageProjectionMaterializationReceipt>;
}

const validateResult =
  createRuntimeJsonSchemaValidator<WakeflowTargetTaskPlanningResultV1>(
    WAKEFLOW_TARGET_TASK_PLANNING_RESULT_SCHEMA,
  );

function mapAuthorityError(error: unknown): never {
  if (error instanceof TargetTaskPlanningAuthorityError) {
    if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
    if (error.reason === "root") fail("root-invalid", "demand-root", "$request.demandId", { cause: error });
    fail("precondition-failed", `authority-${error.reason}`, "$request", { cause: error });
  }
  if (error instanceof TestTaskPlanningAuthorityError) {
    fail("precondition-failed", "test-authority", "$request.taskPackage", { cause: error });
  }
  if (error instanceof TaskPackageError || error instanceof TestTaskPackageError) {
    fail("invalid-request", "task-package", "$request.taskPackage", { cause: error });
  }
  if (error instanceof TargetTaskPlanningInputError) {
    fail("invalid-request", "task-package", "$request.taskPackage", { cause: error });
  }
  throw error;
}

function mapHandlerError(error: unknown): never {
  if (error instanceof DemandEventSourcingCommandHandlerError) {
    switch (error.reason) {
      case "concurrency-conflict":
        fail("concurrency-conflict", "stream-revision", "$request.expectedStreamRevision", { cause: error });
      case "idempotency-conflict":
        fail("idempotency-mismatch", "request-digest", "$request.idempotencyKey", { cause: error });
      case "decision-rejected":
        fail("precondition-failed", "decision-rejected", "$request.taskPackage", { cause: error });
      case "aborted":
        fail("io-failure", "aborted", "$signal", { cause: error });
      case "input":
        fail("invalid-request", "command", "$request", { cause: error });
      default:
        fail("io-failure", "event-stream", "$request.demandId", { cause: error });
    }
  }
  throw error;
}

function plannedTaskPackage(
  commandResult: Readonly<Pick<DemandEventSourcingCommandResult, "commit">>,
): Readonly<TaskPackage> {
  const stored = commandResult.commit.events[0];
  const event = upcastDemandEventSourcingStoredEvent(stored);
  if (event.eventType !== "tasking.target-task-planned") {
    fail("precondition-failed", "commit-not-planning", "$request.idempotencyKey");
  }
  return event.data.taskPackage;
}

async function buildPackage(
  context: TargetTaskPlanningAuthorityContext,
  workspaceRoot: RootedDirectory,
  input: SliceInput,
  binding: Readonly<AppendCommandBinding>,
  options: ExecuteTargetTaskPlanningOptions,
): Promise<Readonly<TaskPackage>> {
  const demandId = context.loaded.identity.demandId;
  const taskPackageId = deriveDurableId(
    "task-package",
    "plan-target-task",
    demandId,
    binding.idempotencyKey,
  );
  const clock = options.clock === undefined ? {} : { clock: options.clock };
  try {
    if (input.taskPackage.workType === "test") {
      const sources = await loadTestTaskPlanningSources(
        workspaceRoot,
        context,
        options.signal,
      );
      const taskPackage = createTestTaskPackage(
        {
          configDigest: context.config.configDigest,
          taskPackageId,
          testCard: sources.testCard,
        },
        clock,
      );
      assertTestTaskPlanningPackage(context, taskPackage, sources.testCard);
      return taskPackage;
    }
    const targetTaskId = deriveDurableId(
      "target-task",
      "plan-target-task",
      demandId,
      binding.idempotencyKey,
    );
    const selectedAuthorityRefs = resolveTargetTaskPlanningAuthorityReferences(
      context,
      input.taskPackage.selectedAuthorityMemberRefs,
    );
    const taskPackage = createTaskPackage(
      {
        programId: context.loaded.identity.programId,
        configDigest: context.config.configDigest,
        demandId,
        demandAuthorityDigest: context.loaded.authorityDigest,
        taskPackageId,
        targetTaskId,
        assignment: input.taskPackage.assignment,
        workType: input.taskPackage.workType,
        objective: input.taskPackage.objective,
        confirmedContext: input.taskPackage.confirmedContext,
        selectedAuthorityRefs,
        boundaries: input.taskPackage.boundaries,
        completionExpectations: input.taskPackage.completionExpectations,
        commitExpectation: input.taskPackage.commitExpectation,
        acceptanceAnchors: input.taskPackage.acceptanceAnchors,
      },
      clock,
    );
    assertTargetTaskPlanningAuthorityAndTopology(context, taskPackage);
    return taskPackage;
  } catch (error: unknown) {
    mapAuthorityError(error);
  }
}

interface SliceContext {
  readonly workspaceRoot: RootedDirectory;
  readonly authority: TargetTaskPlanningAuthorityContext;
  readonly options: ExecuteTargetTaskPlanningOptions;
}

async function execute(
  context: SliceContext,
  input: SliceInput,
  binding: Readonly<AppendCommandBinding>,
): Promise<SliceOutcome> {
  const { authority, options } = context;
  const repository = new DemandEventSourcingRepository(authority.demandRoot);
  const signal = options.signal === undefined ? {} : { signal: options.signal };
  // 幂等键先于任何领域校验解析：重试不该因为"已有活动谱系"之类的后置条件被误拒。
  let bound;
  try {
    bound = await repository.findCommitByIdempotencyKey(binding.idempotencyKey, signal);
  } catch (error: unknown) {
    if (error instanceof DemandEventSourcingRepositoryError) {
      fail("io-failure", "event-stream", "$request.demandId", { cause: error });
    }
    throw error;
  }
  if (bound !== null) {
    if (bound.idempotency?.requestDigest !== binding.requestDigest) {
      fail("idempotency-mismatch", "request-digest", "$request.idempotencyKey");
    }
    const commandResult = Object.freeze({
      disposition: "idempotent" as const,
      commit: bound,
      aggregate: authority.loaded.aggregate,
    });
    const taskPackage = plannedTaskPackage(commandResult);
    return Object.freeze({
      commandResult,
      taskPackage,
      projection: await materialize(authority.demandRoot, taskPackage, signal),
    });
  }
  const drafted = await buildPackage(
    authority,
    context.workspaceRoot,
    input,
    binding,
    options,
  );
  const eventId = deriveDurableId(
    "demand-event",
    "plan-target-task",
    authority.loaded.identity.demandId,
    binding.idempotencyKey,
  );
  const command = parseDemandEventSourcingCommand({
    commandType: "tasking.plan-target-task",
    commandVersion: 1,
    eventId,
    taskPackage: drafted,
  });
  computeDemandEventSourcingCommandDigest(command);
  let commandResult: Readonly<DemandEventSourcingCommandResult>;
  try {
    commandResult = await executeDemandEventSourcingCommand(repository, command, {
      commitId: binding.commitId,
      expectedStreamRevision: binding.expectedStreamRevision,
      idempotency: {
        key: binding.idempotencyKey,
        requestDigest: binding.requestDigest,
      },
      ...signal,
    });
  } catch (error: unknown) {
    mapHandlerError(error);
  }
  const taskPackage =
    commandResult.disposition === "idempotent"
      ? plannedTaskPackage(commandResult)
      : drafted;
  return Object.freeze({
    commandResult,
    taskPackage,
    projection: await materialize(authority.demandRoot, taskPackage, signal),
  });
}

async function materialize(
  demandRoot: RootedDirectory,
  taskPackage: Readonly<TaskPackage>,
  signal: { readonly signal?: AbortSignal },
): Promise<Readonly<TaskPackageProjectionMaterializationReceipt>> {
  try {
    return await new TaskPackageProjectionStore(demandRoot).materialize(
      taskPackage.taskPackageId,
      signal,
    );
  } catch (error: unknown) {
    if (error instanceof TaskPackageProjectionStoreError) {
      fail("io-failure", "projection", "$request.demandId", { cause: error });
    }
    throw error;
  }
}

async function next(
  context: SliceContext,
  outcome: SliceOutcome,
): Promise<Readonly<NextProjection>> {
  const snapshot = await readDemandResultReviewSnapshot(
    context.authority.demandRoot,
    context.options.signal === undefined ? undefined : { signal: context.options.signal },
  );
  const route = buildDemandControllerRoute(
    { ...context.authority.loaded, aggregate: outcome.commandResult.aggregate },
    snapshot,
  );
  return deriveNextProjection(route);
}

function assembleResult(
  envelope: Readonly<AppendCommandEnvelope>,
  outcome: SliceOutcome,
  nextProjection: Readonly<NextProjection>,
): PublicResult {
  const { commandResult, taskPackage, projection } = outcome;
  const targetTask =
    taskPackage.workType === "test"
      ? {
          workType: "test" as const,
          targetTaskId: taskPackage.targetTaskId,
          taskPackageId: taskPackage.taskPackageId,
          windowId: taskPackage.assignment.windowId,
          phase: "planned" as const,
          testCard: taskPackage.testCard,
        }
      : {
          workType: "implementation" as const,
          targetTaskId: taskPackage.targetTaskId,
          taskPackageId: taskPackage.taskPackageId,
          repositoryId: taskPackage.assignment.repositoryId,
          windowId: taskPackage.assignment.windowId,
          phase: "planned" as const,
        };
  const assembled = {
    kind: "WakeflowTargetTaskPlanningResult" as const,
    schemaVersion: WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_SCHEMA_VERSION,
    tool: WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME,
    status: commandResult.disposition,
    demandId: envelope.demandId as WakeflowDurableId<"demand">,
    event: {
      eventId: projection.sourceEvent.eventId,
      streamRevision: projection.sourceEvent.streamRevision,
    },
    commit: {
      commitId: commandResult.commit.commitId,
      commitSequence: commandResult.commit.commitSequence,
      commitDigest: computeDemandEventStreamCommitDigest(commandResult.commit),
    },
    stateDigest: commandResult.aggregate.stateDigest,
    targetTask,
    taskPackageProjection: {
      disposition: projection.disposition,
      resourceRef: parsePortableResourcePath(
        `${demandFinalRootRef(taskPackage.demandId)}/${projection.projection.source.resourcePath}`,
      ),
      taskPackageDigest: computeTaskPackageDigest(taskPackage),
      documentDigest: projection.projection.source.digest,
    },
    next: {
      frontier: nextProjection.frontier,
      owner: nextProjection.owner,
      suggestedTool: nextProjection.suggestedTool,
      blockers: [...nextProjection.blockers],
    },
  };
  const validated = validateResult(assembled as unknown as JsonValue);
  if (!validated.ok) fail("output-boundary", "schema", `$result${validated.path.slice(1)}`);
  return validated.value;
}

/** 执行一次公共 Target Task Planning 追加。 */
export async function executeTargetTaskPlanningPublicRequest(
  value: unknown,
  options: ExecuteTargetTaskPlanningOptions = {},
): Promise<PublicResult> {
  return runAppendCommand<SliceInput, SliceContext, SliceOutcome, PublicResult>(
    {
      tool: WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME,
      parseRequest: (raw) => {
        const request = parseTargetTaskPlanningPublicRequest(raw);
        let parsed;
        try {
          parsed = parseTargetTaskPlanningPreviewRequest({
            demandId: request.demandId,
            taskPackage: request.taskPackage,
          });
        } catch (error: unknown) {
          if (error instanceof TargetTaskPlanningInputError) {
            fail("invalid-request", "task-package", "$request.taskPackage", { cause: error });
          }
          throw error;
        }
        return Object.freeze({
          envelope: Object.freeze({
            root: request.root,
            demandId: request.demandId,
            idempotencyKey: request.idempotencyKey,
            expectedStreamRevision: request.expectedStreamRevision,
          }),
          input: Object.freeze({ taskPackage: parsed.taskPackage }),
        });
      },
      open: async (workspaceRoot, envelope) => {
        try {
          const authority = await openTargetTaskPlanningAuthorityContext(
            workspaceRoot,
            envelope.demandId as WakeflowDurableId<"demand">,
            options.signal,
          );
          return Object.freeze({ workspaceRoot, authority, options });
        } catch (error: unknown) {
          if (isWakeflowError(error)) throw error;
          mapAuthorityError(error);
        }
      },
      close: async (context) => {
        try {
          await closeTargetTaskPlanningAuthorityContext(context.authority);
        } catch (error: unknown) {
          mapAuthorityError(error);
        }
      },
      privateValues: (context) => [context.authority.ledgerRoot.absolutePath],
      execute,
      next,
      result: assembleResult,
    },
    value,
  );
}
