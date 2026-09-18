import type { WakeflowDurableId } from "../../contracts/identity/wakeflow-durable-id.js";
import type { PortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import { parsePortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import { readStrictTextFile } from "../../foundation/filesystem/strict-text-file.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import {
  parseUtcInstant,
  UtcInstantError,
  type UtcInstant,
} from "../../foundation/time/utc-instant.js";
import type { UtcWallClock } from "../../foundation/time/wall-clock.js";
import { buildDemandControllerRoute } from "../../governance/controller/demand-controller-route.js";
import {
  closeDemandOperationAuthorityContext,
  DemandOperationAuthorityContextError,
  openDemandOperationAuthorityContext,
  type DemandOperationAuthorityContext,
} from "../../governance/demand/demand-operation-authority-context.js";
import { parseDemandEventSourcingCommand } from "../../governance/demand/event-sourcing/demand-event-sourcing-decider.js";
import {
  DemandEventSourcingCommandHandlerError,
  executeDemandEventSourcingCommand,
  type DemandEventSourcingCommandResult,
} from "../../governance/demand/event-sourcing/demand-event-sourcing-command-handler.js";
import {
  DemandEventSourcingRepository,
  DemandEventSourcingRepositoryError,
} from "../../governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { computeDemandEventStreamCommitDigest } from "../../governance/demand/event-sourcing/demand-event-stream-commit.js";
import { upcastDemandEventSourcingStoredEvent } from "../../governance/demand/event-sourcing/demand-event-sourcing-upcaster.js";
import { demandFinalRootRef } from "../../governance/demand/publication/demand-publication-paths.js";
import { ledgerAuthorityMemberRef } from "../../governance/ledger/ledger-authority-paths.js";
import type { RequirementRecord } from "../../governance/ledger/ledger-authority-record.js";
import {
  LedgerAuthorityStore,
  LedgerAuthorityStoreError,
  type LoadedLedgerAuthorityRecord,
} from "../../governance/ledger/ledger-authority-store.js";
import {
  DemandPostAcceptanceRouteError,
  resolveDemandTestEnvironmentAuthority,
} from "../../governance/review/demand-post-acceptance-route.js";
import { readDemandResultReviewSnapshot } from "../../governance/review/demand-result-review-snapshot.js";
import {
  computeTaskPackageDigest,
  createTaskPackage,
  TaskPackageError,
  type TaskPackage,
  type TestTaskLineage,
} from "../../governance/tasking/task-package.js";
import {
  TaskPackageProjectionStore,
  TaskPackageProjectionStoreError,
  type TaskPackageProjectionMaterializationReceipt,
} from "../../governance/tasking/task-package-projection-store.js";
import type { WakeflowErrorCode } from "../../contracts/vocabulary/wakeflow-error-code.js";
import {
  runAppendCommand,
  type AppendCommandBinding,
  type AppendCommandEnvelope,
} from "../../kernel/append-command.js";
import { fail, isWakeflowError } from "../../kernel/error.js";
import { deriveDurableId } from "../../kernel/ids.js";
import { deriveNextProjection, type NextProjection } from "../../kernel/next-projection.js";
import {
  admitTargetTaskPlanningResult,
  parseTargetTaskPlanningRequest,
  WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_SCHEMA_VERSION,
  WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME,
  type TargetTaskPlanningRequest,
  type TargetTaskPlanningResult,
} from "./contract.js";
import {
  deriveAnchorReferenceBlockers,
  deriveImplementationBaselines,
  deriveLineageBlockers,
  deriveLineageExpectation,
  derivePlanReview,
  deriveSectionAnchorBlockers,
  deriveTestPlanningBlockers,
  deriveTestStepReferenceBlockers,
  deriveTopologyBlockers,
  parseAcceptanceCriteria,
} from "./decide.js";

/**
 * Wakeflow Capabilities / Tasking：`wakeflow_plan_target_task` 的效果。
 *
 * 追加型一次调用：Controller 提交任务包草稿与幂等键，Wakeflow 读需求包记录核对锚点
 * 引用与章节锚点、对照仓库谱系、执行审阅门与拓扑门、派生确定性身份、追加
 * `tasking.target-task-planned`、物化任务包投影、返回 `next`。同键同请求重放首次结果，
 * 同键异请求以 `idempotency-mismatch` 拒绝。test 包由 Controller 撰写测试合同，Wakeflow
 * 派生测试窗口、环境成员、实现基线与 retest 谱系的授权身份（能力卡 5 修订 5.2）。
 */

export interface ExecuteTargetTaskPlanningOptions {
  readonly clock?: UtcWallClock;
  readonly signal?: AbortSignal;
}

type ImplementationRequest = Extract<
  TargetTaskPlanningRequest["taskPackage"],
  { readonly workType: "implementation" }
>;
type TestRequest = Extract<TargetTaskPlanningRequest["taskPackage"], { readonly workType: "test" }>;

interface SliceInput {
  readonly taskPackage: TargetTaskPlanningRequest["taskPackage"];
  readonly planReviewConfirmedAt: UtcInstant | null;
}

interface SliceContext {
  readonly workspaceRoot: RootedDirectory;
  readonly authority: Readonly<DemandOperationAuthorityContext>;
  readonly options: ExecuteTargetTaskPlanningOptions;
}

interface SliceOutcome {
  readonly commandResult: Readonly<
    Pick<DemandEventSourcingCommandResult, "disposition" | "commit" | "aggregate">
  >;
  readonly taskPackage: Readonly<TaskPackage>;
  readonly projection: Readonly<TaskPackageProjectionMaterializationReceipt>;
}

const REQUIREMENT_MEMBER_MAXIMUM_BYTES = parseByteCount(4 * 1024 * 1024, "$member.maximumBytes");

function signalOptions(signal: AbortSignal | undefined): { readonly signal?: AbortSignal } {
  return signal === undefined ? {} : { signal };
}

const DETAIL_BLOCKER_LIMIT = 8;

/** 理由取首个阻塞项的种类（冒号前的 kebab-case 标记），阻塞项逐条进 details（至多八条）。 */
function rejectWith(blockers: readonly string[], path: string): never {
  const first = blockers[0];
  if (first === undefined) fail("unexpected", "empty-blockers", path);
  fail("precondition-failed", first.split(":")[0] ?? first, path, {
    details: Object.fromEntries(
      blockers
        .slice(0, DETAIL_BLOCKER_LIMIT)
        .map((blocker, index) => [index === 0 ? "blocker" : `blocker${index + 1}`, blocker]),
    ),
  });
}

function mapContextError(error: unknown): never {
  if (error instanceof DemandOperationAuthorityContextError) {
    if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
    if (error.reason === "root") {
      fail("root-invalid", "demand-root", "$request.demandId", { cause: error });
    }
    fail("precondition-failed", `authority-${error.reason}`, "$request", { cause: error });
  }
  throw error;
}

function mapPackageError(error: unknown): never {
  if (error instanceof TaskPackageError) {
    fail("invalid-request", "task-package", "$request.taskPackage", { cause: error });
  }
  throw error;
}

const HANDLER_ERROR_TABLE: Readonly<Record<string, readonly [WakeflowErrorCode, string, string]>> =
  Object.freeze({
    "concurrency-conflict": [
      "concurrency-conflict",
      "stream-revision",
      "$request.expectedStreamRevision",
    ],
    "idempotency-conflict": ["idempotency-mismatch", "request-digest", "$request.idempotencyKey"],
    "decision-rejected": ["precondition-failed", "decision-rejected", "$request.taskPackage"],
    aborted: ["io-failure", "aborted", "$signal"],
    input: ["invalid-request", "command", "$request"],
  });

function mapHandlerError(error: unknown): never {
  if (error instanceof DemandEventSourcingCommandHandlerError) {
    const [code, reason, path] = HANDLER_ERROR_TABLE[error.reason] ?? [
      "io-failure",
      "event-stream",
      "$request.demandId",
    ];
    fail(code, reason, path, { cause: error });
  }
  throw error;
}

// ---- 需求包记录：锚点引用与章节锚点的来源 -------------------------------------

type LoadedPackage = Readonly<LoadedLedgerAuthorityRecord<RequirementRecord>>;

async function loadRequirementPackage(context: SliceContext): Promise<LoadedPackage> {
  const lineage = context.authority.loaded.identity.source;
  let loaded: LoadedPackage;
  try {
    loaded = await new LedgerAuthorityStore(context.authority.ledgerRoot).loadRequirement(
      lineage.requirementId,
      signalOptions(context.options.signal),
    );
  } catch (error: unknown) {
    if (error instanceof LedgerAuthorityStoreError) {
      if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
      fail("precondition-failed", `requirement-record-${error.reason}`, "$ledger", {
        cause: error,
      });
    }
    throw error;
  }
  if (loaded.recordDigest !== lineage.recordDigest) {
    fail("precondition-failed", "requirement-record-drift", "$ledger");
  }
  return loaded;
}

async function readRequirementText(context: SliceContext, loaded: LoadedPackage): Promise<string> {
  const document = loaded.documents.find((candidate) => candidate.role === "requirement");
  if (document === undefined) fail("precondition-failed", "requirement-member-missing", "$ledger");
  try {
    const read = await readStrictTextFile(
      context.authority.ledgerRoot,
      ledgerAuthorityMemberRef(loaded.record, document.path),
      { maximumBytes: REQUIREMENT_MEMBER_MAXIMUM_BYTES, ...signalOptions(context.options.signal) },
    );
    if (read.digest !== document.digest) {
      fail("precondition-failed", "requirement-member-drift", "$ledger");
    }
    return read.text;
  } catch (error: unknown) {
    if (isWakeflowError(error)) throw error;
    fail("io-failure", "requirement-member-read", "$ledger", { cause: error });
  }
}

function resolveAuthorityReferences(
  context: SliceContext,
  memberRefs: readonly string[],
): TaskPackage["selectedAuthorityRefs"] {
  const resolved = memberRefs.map((memberRef) => {
    const reference = context.authority.loaded.authority.authorityRefs.find(
      (candidate) => candidate.memberRef === memberRef,
    );
    if (reference === undefined) {
      fail(
        "precondition-failed",
        "authority-reference-unknown",
        "$request.taskPackage.selectedAuthorityMemberRefs",
      );
    }
    return reference;
  });
  const first = resolved[0];
  if (first === undefined) {
    fail(
      "invalid-request",
      "authority-reference-empty",
      "$request.taskPackage.selectedAuthorityMemberRefs",
    );
  }
  return Object.freeze([first, ...resolved.slice(1)]);
}

// ---- 任务包草稿 -------------------------------------------------------------

async function buildImplementationPackage(
  context: SliceContext,
  input: SliceInput,
  requested: ImplementationRequest,
  binding: Readonly<AppendCommandBinding>,
): Promise<Readonly<TaskPackage>> {
  const { authority, options } = context;
  const identity = authority.loaded.identity;
  if (identity.demandType === "research") {
    fail("precondition-failed", "research-demand-has-no-implementation", "$request.taskPackage");
  }
  const loaded = await loadRequirementPackage(context);
  const review = derivePlanReview({
    taskPlanReview: loaded.record.taskPlanReview,
    confirmedAt: input.planReviewConfirmedAt,
  });
  if (review.blocker !== null || review.planReview === null) {
    rejectWith([review.blocker ?? "task-plan-review-required"], "$request.planReview");
  }
  const blockers = [
    ...deriveTopologyBlockers({
      config: authority.config,
      repositoryId: requested.assignment.repositoryId,
      windowId: requested.assignment.windowId,
      podId: identity.podId,
    }),
    ...deriveSectionAnchorBlockers(
      requested.sectionAnchors,
      loaded.record.sections.map((section) => section.anchor),
    ),
  ];
  if (blockers.length > 0) rejectWith(blockers, "$request.taskPackage");
  const selectedAuthorityRefs = resolveAuthorityReferences(
    context,
    requested.selectedAuthorityMemberRefs,
  );
  const taskPackageId = deriveDurableId(
    "task-package",
    "plan-target-task",
    identity.demandId,
    binding.idempotencyKey,
  );
  const targetTaskId = deriveDurableId(
    "target-task",
    "plan-target-task",
    identity.demandId,
    binding.idempotencyKey,
  );
  let taskPackage: Readonly<TaskPackage>;
  try {
    taskPackage = createTaskPackage(
      {
        programId: identity.programId,
        configDigest: authority.config.configDigest,
        demandId: identity.demandId,
        demandAuthorityDigest: authority.loaded.authorityDigest,
        taskPackageId,
        targetTaskId,
        assignment: requested.assignment,
        workType: "implementation",
        objective: requested.objective,
        confirmedContext: requested.confirmedContext,
        selectedAuthorityRefs,
        boundaries: requested.boundaries,
        completionExpectations: requested.completionExpectations,
        commitExpectation: requested.commitExpectation,
        acceptanceAnchors: requested.acceptanceAnchors,
        lineage: requested.lineage,
        planReview: review.planReview,
        sectionAnchors: requested.sectionAnchors,
      },
      options.clock === undefined ? {} : { clock: options.clock },
    );
  } catch (error: unknown) {
    mapPackageError(error);
  }
  if (taskPackage.workType !== "implementation") fail("unexpected", "work-type", "$request");
  const anchorBlockers = deriveAnchorReferenceBlockers({
    anchors: taskPackage.acceptanceAnchors,
    recordDigest: identity.source.recordDigest,
    criteria: parseAcceptanceCriteria(await readRequirementText(context, loaded)),
  });
  if (anchorBlockers.length > 0)
    rejectWith(anchorBlockers, "$request.taskPackage.acceptanceAnchors");
  const lineageBlockers = deriveLineageBlockers(
    taskPackage.lineage,
    deriveLineageExpectation(authority.loaded.aggregate.state, requested.assignment.repositoryId),
  );
  if (lineageBlockers.length > 0) rejectWith(lineageBlockers, "$request.taskPackage.lineage");
  return taskPackage;
}

/** 测试环境成员来自需求包唯一的 landing 角色成员；对不上就是准入阻塞而非内部错误。 */
function testEnvironmentOf(context: SliceContext) {
  try {
    return resolveDemandTestEnvironmentAuthority(context.authority.loaded);
  } catch (error: unknown) {
    if (error instanceof DemandPostAcceptanceRouteError) {
      rejectWith(["test-environment-authority"], "$request.taskPackage");
    }
    throw error;
  }
}

function testLineageOf(context: SliceContext, requested: TestRequest): TestTaskLineage {
  const pending = context.authority.loaded.aggregate.state.pendingTestRetest;
  if (requested.lineage === null || pending === undefined) return null;
  return Object.freeze({
    kind: "retest" as const,
    retestsTargetTaskId: requested.lineage.retestsTargetTaskId as WakeflowDurableId<"target-task">,
    productDefectRemediationId: pending.productDefectRemediation.productDefectRemediationId,
    authorizationDigest: pending.productDefectRemediation.authorizationDigest,
  });
}

async function buildTestPackage(
  context: SliceContext,
  input: SliceInput,
  requested: TestRequest,
  binding: Readonly<AppendCommandBinding>,
): Promise<Readonly<TaskPackage>> {
  const { authority, options } = context;
  const identity = authority.loaded.identity;
  if (input.planReviewConfirmedAt !== null) {
    rejectWith(["task-plan-review-not-requested"], "$request.planReview");
  }
  const state = authority.loaded.aggregate.state;
  const planningBlockers = deriveTestPlanningBlockers({
    testingMode: authority.loaded.authority.testingDecision.mode,
    state,
    lineage: requested.lineage,
  });
  if (planningBlockers.length > 0) rejectWith(planningBlockers, "$request.taskPackage");
  // 测试任务派给 Demand 所在 pod 的 Test 窗口（ADR-0010 D2）。
  const podScope = Object.hasOwn(authority.config.indexes.podScopes, identity.podId)
    ? authority.config.indexes.podScopes[identity.podId]
    : undefined;
  if (podScope === undefined) rejectWith([`pod-unknown:${identity.podId}`], "$request.taskPackage");
  const testWindow = podScope.testWindow;
  const environment = testEnvironmentOf(context);
  const loaded = await loadRequirementPackage(context);
  const steps = requested.testContract.steps.map((step, index) =>
    Object.freeze({
      stepId: `ts-${index + 1}`,
      given: step.given,
      when: step.when,
      // biome-ignore lint/suspicious/noThenProperty: Given/When/Then 合同步骤字段（§13.85 D1）
      then: step.then,
      requirementRef: step.requirementRef,
    }),
  );
  const stepBlockers = deriveTestStepReferenceBlockers({
    steps,
    recordDigest: identity.source.recordDigest,
    criteria: parseAcceptanceCriteria(await readRequirementText(context, loaded)),
  });
  if (stepBlockers.length > 0) rejectWith(stepBlockers, "$request.taskPackage.testContract.steps");
  const selectedAuthorityRefs = resolveAuthorityReferences(
    context,
    requested.selectedAuthorityMemberRefs,
  );
  let taskPackage: Readonly<TaskPackage>;
  try {
    taskPackage = createTaskPackage(
      {
        programId: identity.programId,
        configDigest: authority.config.configDigest,
        demandId: identity.demandId,
        demandAuthorityDigest: authority.loaded.authorityDigest,
        taskPackageId: deriveDurableId(
          "task-package",
          "plan-target-task",
          identity.demandId,
          binding.idempotencyKey,
        ),
        targetTaskId: deriveDurableId(
          "target-task",
          "plan-target-task",
          identity.demandId,
          binding.idempotencyKey,
        ),
        assignment: { windowId: testWindow.windowId },
        workType: "test",
        objective: requested.objective,
        confirmedContext: requested.confirmedContext,
        selectedAuthorityRefs,
        boundaries: requested.boundaries,
        completionExpectations: requested.completionExpectations,
        acceptanceAnchors: [],
        testContract: {
          question: requested.testContract.question,
          objectBoundary: requested.testContract.objectBoundary,
          steps,
          environment,
          allowedSkills: requested.testContract.allowedSkills,
          setupPolicy: requested.testContract.setupPolicy,
          maxAttempts: requested.testContract.maxAttempts,
          stopConditions: requested.testContract.stopConditions,
        },
        implementationBaselines: deriveImplementationBaselines(state),
        lineage: testLineageOf(context, requested),
      },
      options.clock === undefined ? {} : { clock: options.clock },
    );
  } catch (error: unknown) {
    mapPackageError(error);
  }
  if (taskPackage.workType !== "test") fail("unexpected", "work-type", "$request");
  return taskPackage;
}

function buildPackage(
  context: SliceContext,
  input: SliceInput,
  binding: Readonly<AppendCommandBinding>,
): Promise<Readonly<TaskPackage>> {
  if (input.taskPackage.workType === "test") {
    return buildTestPackage(context, input, input.taskPackage, binding);
  }
  return buildImplementationPackage(context, input, input.taskPackage, binding);
}

// ---- 追加 -------------------------------------------------------------------

function plannedTaskPackage(
  commandResult: Readonly<Pick<DemandEventSourcingCommandResult, "commit">>,
): Readonly<TaskPackage> {
  const event = upcastDemandEventSourcingStoredEvent(commandResult.commit.events[0]);
  if (event.eventType !== "tasking.target-task-planned") {
    fail("precondition-failed", "commit-not-planning", "$request.idempotencyKey");
  }
  return event.data.taskPackage;
}

async function materialize(
  demandRoot: RootedDirectory,
  taskPackage: Readonly<TaskPackage>,
  signal: AbortSignal | undefined,
): Promise<Readonly<TaskPackageProjectionMaterializationReceipt>> {
  try {
    return await new TaskPackageProjectionStore(demandRoot).materialize(
      taskPackage.taskPackageId,
      signalOptions(signal),
    );
  } catch (error: unknown) {
    if (error instanceof TaskPackageProjectionStoreError) {
      fail("io-failure", "projection", "$request.demandId", { cause: error });
    }
    throw error;
  }
}

async function boundCommit(
  repository: DemandEventSourcingRepository,
  binding: Readonly<AppendCommandBinding>,
  signal: AbortSignal | undefined,
) {
  try {
    return await repository.findCommitByIdempotencyKey(
      binding.idempotencyKey,
      signalOptions(signal),
    );
  } catch (error: unknown) {
    if (error instanceof DemandEventSourcingRepositoryError) {
      fail("io-failure", "event-stream", "$request.demandId", { cause: error });
    }
    throw error;
  }
}

async function execute(
  context: SliceContext,
  input: SliceInput,
  binding: Readonly<AppendCommandBinding>,
): Promise<SliceOutcome> {
  const { authority, options } = context;
  const repository = new DemandEventSourcingRepository(authority.demandRoot);
  // 幂等键先于任何领域校验解析：重试不该因为"已有活动谱系"之类的后置条件被误拒。
  const bound = await boundCommit(repository, binding, options.signal);
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
      projection: await materialize(authority.demandRoot, taskPackage, options.signal),
    });
  }
  const drafted = await buildPackage(context, input, binding);
  const command = parseDemandEventSourcingCommand({
    commandType: "tasking.plan-target-task",
    commandVersion: 1,
    eventId: deriveDurableId(
      "demand-event",
      "plan-target-task",
      authority.loaded.identity.demandId,
      binding.idempotencyKey,
    ),
    taskPackage: drafted,
  });
  let commandResult: Readonly<DemandEventSourcingCommandResult>;
  try {
    commandResult = await executeDemandEventSourcingCommand(repository, command, {
      commitId: binding.commitId,
      expectedStreamRevision: binding.expectedStreamRevision,
      idempotency: { key: binding.idempotencyKey, requestDigest: binding.requestDigest },
      ...signalOptions(options.signal),
    });
  } catch (error: unknown) {
    mapHandlerError(error);
  }
  const taskPackage =
    commandResult.disposition === "idempotent" ? plannedTaskPackage(commandResult) : drafted;
  return Object.freeze({
    commandResult,
    taskPackage,
    projection: await materialize(authority.demandRoot, taskPackage, options.signal),
  });
}

async function next(context: SliceContext, outcome: SliceOutcome): Promise<NextProjection> {
  const snapshot = await readDemandResultReviewSnapshot(
    context.authority.demandRoot,
    signalOptions(context.options.signal),
  );
  const route = buildDemandControllerRoute(
    { ...context.authority.loaded, aggregate: outcome.commandResult.aggregate },
    snapshot,
  );
  return deriveNextProjection(route);
}

function targetTaskOf(taskPackage: Readonly<TaskPackage>) {
  if (taskPackage.workType === "test") {
    return {
      workType: "test" as const,
      targetTaskId: taskPackage.targetTaskId,
      taskPackageId: taskPackage.taskPackageId,
      windowId: taskPackage.assignment.windowId,
      phase: "planned" as const,
      lineage: taskPackage.lineage,
      testContract: {
        stepCount: taskPackage.testContract.steps.length,
        maxAttempts: taskPackage.testContract.maxAttempts,
        environmentMemberRef: taskPackage.testContract.environment.memberRef,
      },
    };
  }
  return {
    workType: "implementation" as const,
    targetTaskId: taskPackage.targetTaskId,
    taskPackageId: taskPackage.taskPackageId,
    repositoryId: taskPackage.assignment.repositoryId,
    windowId: taskPackage.assignment.windowId,
    phase: "planned" as const,
    lineage: taskPackage.lineage,
  };
}

function assembleResult(
  envelope: Readonly<AppendCommandEnvelope>,
  outcome: SliceOutcome,
  nextProjection: Readonly<NextProjection>,
): TargetTaskPlanningResult {
  const { commandResult, taskPackage, projection } = outcome;
  const projectionRef: PortableResourcePath = parsePortableResourcePath(
    `${demandFinalRootRef(taskPackage.demandId)}/${projection.projection.source.resourcePath}`,
  );
  return admitTargetTaskPlanningResult({
    kind: "WakeflowTargetTaskPlanningResult",
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
    targetTask: targetTaskOf(taskPackage),
    taskPackageProjection: {
      disposition: projection.disposition,
      resourceRef: projectionRef,
      taskPackageDigest: computeTaskPackageDigest(taskPackage),
      documentDigest: projection.projection.source.digest,
    },
    next: {
      frontier: nextProjection.frontier,
      owner: nextProjection.owner,
      suggestedTool: nextProjection.suggestedTool,
      blockers: [...nextProjection.blockers],
    },
  });
}

function planReviewConfirmedAt(request: TargetTaskPlanningRequest): UtcInstant | null {
  if (request.planReview === undefined) return null;
  try {
    return parseUtcInstant(request.planReview.confirmedAt, "$request.planReview.confirmedAt");
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) {
      fail("invalid-request", "plan-review-time", "$request.planReview.confirmedAt", {
        cause: error,
      });
    }
    throw error;
  }
}

/** 执行一次 `wakeflow_plan_target_task`。 */
export async function executeTargetTaskPlanningPublicRequest(
  value: unknown,
  options: ExecuteTargetTaskPlanningOptions = {},
): Promise<TargetTaskPlanningResult> {
  return runAppendCommand<SliceInput, SliceContext, SliceOutcome, TargetTaskPlanningResult>(
    {
      tool: WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME,
      parseRequest: (raw) => {
        const request = parseTargetTaskPlanningRequest(raw);
        return Object.freeze({
          envelope: Object.freeze({
            root: request.root,
            demandId: request.demandId,
            idempotencyKey: request.idempotencyKey,
            expectedStreamRevision: request.expectedStreamRevision,
          }),
          input: Object.freeze({
            taskPackage: request.taskPackage,
            planReviewConfirmedAt: planReviewConfirmedAt(request),
          }),
        });
      },
      open: async (workspaceRoot, envelope) => {
        try {
          const authority = await openDemandOperationAuthorityContext(
            workspaceRoot,
            envelope.demandId as WakeflowDurableId<"demand">,
            options.signal,
          );
          return Object.freeze({ workspaceRoot, authority, options });
        } catch (error: unknown) {
          mapContextError(error);
        }
      },
      close: async (context) => {
        try {
          await closeDemandOperationAuthorityContext(context.authority);
        } catch (error: unknown) {
          mapContextError(error);
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
