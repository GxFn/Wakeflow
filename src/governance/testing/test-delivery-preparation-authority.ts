import { canonicalizeJson } from "../../foundation/data/canonical-json.js";
import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import type { WakeflowDurableId } from "../../contracts/identity/wakeflow-durable-id.js";
import type { DemandTargetTaskState } from "../demand/model/demand-aggregate-state.js";
import type { WakeflowWorkspaceHostResourceProfile } from "../../workspace/workspace-host-resource-profile.js";
import type { WakeflowWindowHostBinding } from "../../workspace/window-runtime/wakeflow-window-host-binding.js";
import type { WakeflowWindowHostIdentityProfile } from "../../workspace/window-runtime/wakeflow-window-host-identity-profile.js";
import {
  loadCurrentDeliveryWindowBinding,
  TargetDeliveryBindingAuthorityError,
} from "../delivery/target-delivery-binding-authority.js";
import {
  inspectWindowWorkClaim,
  WindowWorkClaimStoreError,
} from "../delivery/window-work-claim-store.js";
import type { DemandOperationAuthorityContext } from "../demand/demand-operation-authority-context.js";
import {
  DemandEventSourcingRepository,
  DemandEventSourcingRepositoryError,
} from "../demand/event-sourcing/demand-event-sourcing-repository.js";
import {
  buildDemandPostAcceptanceRoute,
  DemandPostAcceptanceRouteError,
} from "../review/demand-post-acceptance-route.js";
import {
  buildDemandResultReviewSnapshotFromHistory,
  readDemandResultReviewSnapshot,
  DemandResultReviewSnapshotError,
} from "../review/demand-result-review-snapshot.js";
import {
  computeTaskPackageDigest,
  type TestTaskPackage,
} from "../tasking/task-package.js";
import {
  TaskPackageProjectionStore,
  TaskPackageProjectionStoreError,
} from "../tasking/task-package-projection-store.js";
import {
  assertTestTaskPackageMatchesTestCard,
  TestTaskPackageError,
} from "./test-task-package.js";
import type { TestCard } from "./test-card.js";
import {
  assertTestDeliveryIntentMatchesSources,
  MAXIMUM_TEST_DELIVERY_AUTHORIZATIONS_PER_ATTEMPT,
  TestDeliveryIntentError,
  type TestDeliveryReplacementAuthorization,
} from "./test-delivery-intent.js";
import type { TestDeliveryPreparationPlan } from "./test-delivery-preparation-plan.js";
import type {
  RerunTestExecutionAttempt,
  TestExecutionAttempt,
} from "./test-execution-attempt.js";

/** Test Delivery Preparation对领域Event、Config、Binding与物理Claim的组合准入。 */

interface TestDeliveryPreparationSourceBase {
  readonly taskPackage: Readonly<TestTaskPackage>;
  readonly testCard: Readonly<TestCard>;
  readonly binding: Readonly<WakeflowWindowHostBinding>;
}

export interface InitialTestDeliveryPreparationSources extends TestDeliveryPreparationSourceBase {
  readonly mode: "initial";
}

export interface ReplacementTestDeliveryPreparationSources extends TestDeliveryPreparationSourceBase {
  readonly mode: "replacement-authorization";
  readonly attempt: Readonly<TestExecutionAttempt>;
  readonly replacement: Readonly<TestDeliveryReplacementAuthorization>;
}

export interface RerunTestDeliveryPreparationSources extends TestDeliveryPreparationSourceBase {
  readonly mode: "rerun";
  readonly previousAttempt: Readonly<TestExecutionAttempt>;
  readonly rerunSource: RerunTestExecutionAttempt["rerunSource"];
}

export type TestDeliveryPreparationSources =
  | InitialTestDeliveryPreparationSources
  | RerunTestDeliveryPreparationSources
  | ReplacementTestDeliveryPreparationSources;

export type TestDeliveryPreparationAuthorityErrorReason =
  | "placement"
  | "route"
  | "task-package"
  | "test-card"
  | "config"
  | "authority"
  | "binding"
  | "claim"
  | "observation"
  | "attempt-capacity"
  | "authorization-capacity"
  | "aborted";

const ERROR_MESSAGES = {
  placement: "Test Delivery Preparation currently requires main placement.",
  route: "Test Delivery Preparation route is not admitted.",
  "task-package": "Test Delivery Preparation TaskPackage authority is invalid.",
  "test-card": "Test Delivery Preparation TestCard authority is invalid.",
  config: "Test Delivery Preparation Config Test window is invalid.",
  authority: "Test Delivery Preparation Demand Authority is invalid.",
  binding: "Test Delivery Preparation current Binding is invalid.",
  claim:
    "Test Delivery Preparation cannot retain a conflicting Window WorkClaim.",
  observation: "Test Delivery Preparation rejected host effect is invalid.",
  "attempt-capacity":
    "TestCard has no remaining logical Test attempt capacity.",
  "authorization-capacity":
    "Test Delivery attempt has no remaining authorization capacity.",
  aborted: "Test Delivery Preparation authority loading was aborted.",
} as const satisfies Readonly<
  Record<TestDeliveryPreparationAuthorityErrorReason, string>
>;

export class TestDeliveryPreparationAuthorityError extends Error {
  override readonly name = "TestDeliveryPreparationAuthorityError";
  readonly code = "wakeflow-test-delivery-preparation-authority" as const;
  readonly reason: TestDeliveryPreparationAuthorityErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;

  constructor(
    reason: TestDeliveryPreparationAuthorityErrorReason,
    causeCode: string | null = null,
    causeReason: string | null = null,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.causeCode = causeCode;
    this.causeReason = causeReason;
  }
}

function ownString(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined &&
    Object.hasOwn(descriptor, "value") &&
    typeof descriptor.value === "string"
    ? descriptor.value
    : null;
}

function fail(
  reason: TestDeliveryPreparationAuthorityErrorReason,
  cause?: unknown,
): never {
  throw new TestDeliveryPreparationAuthorityError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
  );
}

function authorityContains(
  context: Readonly<DemandOperationAuthorityContext>,
  reference: unknown,
): boolean {
  const expected = canonicalizeJson(reference, "$expectedAuthorityReference");
  return context.loaded.authority.authorityRefs.some(
    (candidate) =>
      canonicalizeJson(candidate, "$authorityReference") === expected,
  );
}

async function assertProductClaimsAbsent(
  workspaceRoot: RootedDirectory,
  testCard: Readonly<TestCard>,
  signal: AbortSignal | undefined,
): Promise<void> {
  for (const windowId of [
    ...new Set(
      testCard.implementationBaselines.map((baseline) => baseline.windowId),
    ),
  ].sort()) {
    try {
      const claim = await inspectWindowWorkClaim(
        workspaceRoot,
        windowId,
        signal === undefined ? {} : { signal },
      );
      if (claim.status !== "absent") fail("claim");
    } catch (error: unknown) {
      if (error instanceof TestDeliveryPreparationAuthorityError) throw error;
      if (error instanceof WindowWorkClaimStoreError) {
        if (error.reason === "aborted") fail("aborted", error);
        fail("claim", error);
      }
      throw error;
    }
  }
}

async function assertWindowClaimAbsent(
  workspaceRoot: RootedDirectory,
  windowId: WakeflowDurableId<"window">,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    const claim = await inspectWindowWorkClaim(
      workspaceRoot,
      windowId,
      signal === undefined ? {} : { signal },
    );
    if (claim.status !== "absent") fail("claim");
  } catch (error: unknown) {
    if (error instanceof TestDeliveryPreparationAuthorityError) throw error;
    if (error instanceof WindowWorkClaimStoreError) {
      if (error.reason === "aborted") fail("aborted", error);
      fail("claim", error);
    }
    throw error;
  }
}

type DemandTestTargetTaskState = Extract<
  DemandTargetTaskState,
  { readonly workType: "test" }
>;

function assertTestPreparationSourcesCurrent(
  context: Readonly<DemandOperationAuthorityContext>,
  target: Readonly<DemandTestTargetTaskState>,
  taskPackage: Readonly<TestTaskPackage>,
  testCard: Readonly<TestCard>,
): void {
  if (
    context.loaded.identity.programId !== taskPackage.programId ||
    context.loaded.identity.demandId !== taskPackage.demandId ||
    context.loaded.authorityDigest !== taskPackage.demandAuthorityDigest ||
    context.loaded.identity.demandType === "research"
  ) {
    fail("authority");
  }
  if (
    computeTaskPackageDigest(taskPackage) !== target.taskPackageDigest ||
    taskPackage.targetTaskId !== target.targetTaskId ||
    taskPackage.assignment.windowId !== target.windowId ||
    context.config.model.program.programId !== taskPackage.programId ||
    context.config.configDigest !== taskPackage.configDigest ||
    context.config.indexes.testWindow.windowId !== target.windowId ||
    context.config.indexes.testWindow.role !== "test"
  ) {
    fail("config");
  }
  if (
    !taskPackage.selectedAuthorityRefs.every((reference) =>
      authorityContains(context, reference),
    ) ||
    !authorityContains(context, testCard.environmentAuthority) ||
    !testCard.testBasisAuthorities.every((reference) =>
      authorityContains(context, reference),
    )
  ) {
    fail("authority");
  }
}

async function loadTestCardFromEvent(
  repository: DemandEventSourcingRepository,
  testCardId: WakeflowDurableId<"test-card">,
  signal: AbortSignal | undefined,
): Promise<Readonly<TestCard>> {
  try {
    const located = await repository.findTestCardCreatedEvent(
      testCardId,
      signal === undefined ? undefined : { signal },
    );
    if (located === null) fail("test-card");
    return located.event.data.testCard;
  } catch (error: unknown) {
    if (error instanceof TestDeliveryPreparationAuthorityError) throw error;
    if (error instanceof DemandEventSourcingRepositoryError) {
      if (error.reason === "aborted") fail("aborted", error);
      fail("test-card", error);
    }
    throw error;
  }
}

/** 零写加载当前Test Delivery Preparation所需的全部Authority来源。 */
export async function loadTestDeliveryPreparationSources(
  workspaceRoot: RootedDirectory,
  context: Readonly<DemandOperationAuthorityContext>,
  targetTaskId: WakeflowDurableId<"target-task">,
  resourceProfile: Readonly<WakeflowWorkspaceHostResourceProfile>,
  identityProfile: Readonly<WakeflowWindowHostIdentityProfile>,
  signal: AbortSignal | undefined,
): Promise<Readonly<TestDeliveryPreparationSources>> {
  if (context.loaded.identity.executionPlacement.mode !== "main") {
    fail("placement");
  }
  try {
    const snapshot = await readDemandResultReviewSnapshot(
      context.demandRoot,
      signal === undefined ? undefined : { signal },
    );
    const route = buildDemandPostAcceptanceRoute(context.loaded, snapshot);
    if (
      route.nextStage.status !== "test-delivery-planning" ||
      route.nextStage.testTask.targetTaskId !== targetTaskId
    ) {
      fail("route");
    }
    const target = context.loaded.aggregate.state.targetTasks.find(
      (entry) => entry.targetTaskId === targetTaskId,
    );
    if (
      target === undefined ||
      target.workType !== "test" ||
      target.phase !== "planned"
    ) {
      fail("route");
    }
    const projection = await new TaskPackageProjectionStore(
      context.demandRoot,
    ).load(target.taskPackageId, {
      expectedTaskPackageDigest: target.taskPackageDigest,
      ...(signal === undefined ? {} : { signal }),
    });
    if (projection.taskPackage.workType !== "test") fail("task-package");
    const taskPackage = projection.taskPackage;
    const repository = new DemandEventSourcingRepository(context.demandRoot);
    const testCard = await loadTestCardFromEvent(
      repository,
      taskPackage.testCard.testCardId,
      signal,
    );
    try {
      assertTestTaskPackageMatchesTestCard(taskPackage, testCard);
    } catch (error: unknown) {
      if (error instanceof TestTaskPackageError) fail("task-package", error);
      throw error;
    }
    assertTestPreparationSourcesCurrent(context, target, taskPackage, testCard);
    await assertProductClaimsAbsent(workspaceRoot, testCard, signal);
    let binding: Readonly<WakeflowWindowHostBinding>;
    try {
      binding = await loadCurrentDeliveryWindowBinding(
        workspaceRoot,
        context.config.model,
        resourceProfile,
        identityProfile,
        target.windowId,
        signal,
      );
    } catch (error: unknown) {
      if (error instanceof TargetDeliveryBindingAuthorityError) {
        if (error.reason === "aborted") fail("aborted", error);
        fail("binding", error);
      }
      throw error;
    }
    return Object.freeze({
      mode: "initial" as const,
      taskPackage,
      testCard,
      binding,
    });
  } catch (error: unknown) {
    if (error instanceof TestDeliveryPreparationAuthorityError) throw error;
    if (error instanceof DemandResultReviewSnapshotError) {
      if (error.reason === "aborted") fail("aborted", error);
      fail("route", error);
    }
    if (error instanceof DemandPostAcceptanceRouteError) fail("route", error);
    if (error instanceof TaskPackageProjectionStoreError) {
      if (error.reason === "aborted") fail("aborted", error);
      fail("task-package", error);
    }
    throw error;
  }
}

/**
 * 为Controller已授权的下一次logical Test attempt加载闭合来源。
 *
 * Rerun继续使用同一TaskPackage/TestCard，但必须绑定当前lineage尾部、精确Test Result
 * 与`request-another-attempt` Decision。该函数不创建attempt或操作环境。
 */
export async function loadRerunTestDeliveryPreparationSources(
  workspaceRoot: RootedDirectory,
  context: Readonly<DemandOperationAuthorityContext>,
  targetTaskId: WakeflowDurableId<"target-task">,
  resourceProfile: Readonly<WakeflowWorkspaceHostResourceProfile>,
  identityProfile: Readonly<WakeflowWindowHostIdentityProfile>,
  signal: AbortSignal | undefined,
): Promise<Readonly<RerunTestDeliveryPreparationSources>> {
  if (context.loaded.identity.executionPlacement.mode !== "main") {
    fail("placement");
  }
  try {
    const repository = new DemandEventSourcingRepository(context.demandRoot);
    const history = await repository.auditTargetResultHistory(
      signal === undefined ? undefined : { signal },
    );
    const snapshot = buildDemandResultReviewSnapshotFromHistory(history);
    const route = buildDemandPostAcceptanceRoute(context.loaded, snapshot);
    const target = history.aggregate.state.targetTasks.find(
      (entry) => entry.targetTaskId === targetTaskId,
    );
    if (
      route.nextStage.status !== "test-another-attempt-planning" ||
      route.nextStage.testReview.targetTaskId !== targetTaskId ||
      target === undefined ||
      target.workType !== "test" ||
      target.phase !== "test-another-attempt-requested"
    ) {
      fail("route");
    }
    const rerunSource = Object.freeze({
      previousAttemptId: route.nextStage.testReview.testAttemptId,
      previousResult: Object.freeze({
        targetResultId: route.nextStage.testReview.targetResultId,
        resultDigest: route.nextStage.testReview.resultDigest,
      }),
      reviewDecision: Object.freeze({
        targetReviewDecisionId:
          route.nextStage.testReview.targetReviewDecisionId,
        decisionDigest: route.nextStage.testReview.decisionDigest,
      }),
    });
    const previousAttempt = target.testAttempts.at(-1)!.attempt;
    const taskSource = history.taskPackages.find(
      (source) => source.taskPackage.taskPackageId === target.taskPackageId,
    );
    const testCardSource = history.testCards.find(
      (source) => source.testCard.testCardId === target.testCard.testCardId,
    );
    const resultSource = history.targetResults.find(
      (source) =>
        source.result.targetResultId ===
        rerunSource.previousResult.targetResultId,
    );
    const decisionSource = history.targetReviewDecisions.find(
      (source) =>
        source.decision.targetReviewDecisionId ===
        rerunSource.reviewDecision.targetReviewDecisionId,
    );
    if (
      taskSource === undefined ||
      taskSource.taskPackage.workType !== "test" ||
      testCardSource === undefined ||
      resultSource === undefined ||
      resultSource.result.workType !== "test" ||
      decisionSource === undefined ||
      decisionSource.decision.kind !== "WakeflowControllerTestReviewDecision"
    ) {
      fail("route");
    }
    const taskPackage = taskSource.taskPackage;
    const testCard = testCardSource.testCard;
    const result = resultSource.result;
    const decision = decisionSource.decision;
    if (target.testAttempts.length >= testCard.maxAttempts) {
      fail("attempt-capacity");
    }
    if (
      previousAttempt.testAttemptId !== rerunSource.previousAttemptId ||
      target.currentDelivery.targetResult.targetResultId !==
        result.targetResultId ||
      target.currentDelivery.targetResult.resultDigest !==
        result.resultDigest ||
      target.currentDelivery.reviewDecision.targetReviewDecisionId !==
        decision.targetReviewDecisionId ||
      target.currentDelivery.reviewDecision.decisionDigest !==
        decision.decisionDigest ||
      decision.decision !== "request-another-attempt" ||
      decision.reviewed.targetResultId !== result.targetResultId ||
      decision.reviewed.targetResultDigest !== result.resultDigest ||
      decision.testExecution.testAttemptId !== previousAttempt.testAttemptId ||
      decision.testExecution.testCard.testCardId !== testCard.testCardId ||
      decision.testExecution.testCard.testCardDigest !==
        testCard.testCardDigest ||
      decision.testExecution.testDispatchPacketDigest !==
        result.testExecution.testDispatchPacketDigest ||
      result.testExecution.testAttemptId !== previousAttempt.testAttemptId ||
      result.testExecution.testCard.testCardId !== testCard.testCardId ||
      result.testExecution.testCard.testCardDigest !==
        testCard.testCardDigest ||
      rerunSource.previousResult.resultDigest !== result.resultDigest ||
      rerunSource.reviewDecision.decisionDigest !== decision.decisionDigest
    ) {
      fail("route");
    }
    try {
      assertTestTaskPackageMatchesTestCard(taskPackage, testCard);
    } catch (error: unknown) {
      if (error instanceof TestTaskPackageError) fail("task-package", error);
      throw error;
    }
    assertTestPreparationSourcesCurrent(context, target, taskPackage, testCard);
    await assertProductClaimsAbsent(workspaceRoot, testCard, signal);
    await assertWindowClaimAbsent(workspaceRoot, target.windowId, signal);
    let binding: Readonly<WakeflowWindowHostBinding>;
    try {
      binding = await loadCurrentDeliveryWindowBinding(
        workspaceRoot,
        context.config.model,
        resourceProfile,
        identityProfile,
        target.windowId,
        signal,
      );
    } catch (error: unknown) {
      if (error instanceof TargetDeliveryBindingAuthorityError) {
        if (error.reason === "aborted") fail("aborted", error);
        fail("binding", error);
      }
      throw error;
    }
    return Object.freeze({
      mode: "rerun" as const,
      taskPackage,
      testCard,
      binding,
      previousAttempt,
      rerunSource,
    });
  } catch (error: unknown) {
    if (error instanceof TestDeliveryPreparationAuthorityError) throw error;
    if (error instanceof DemandResultReviewSnapshotError) {
      if (error.reason === "aborted") fail("aborted", error);
      fail("route", error);
    }
    if (error instanceof DemandPostAcceptanceRouteError) fail("route", error);
    if (error instanceof DemandEventSourcingRepositoryError) {
      if (error.reason === "aborted") fail("aborted", error);
      fail("route", error);
    }
    throw error;
  }
}

/**
 * 为明确未发生宿主效果的Test Delivery加载替代授权来源。
 *
 * 该准入保留同一logical attempt，但要求旧Observation、旧Claim Event、旧Intent、
 * Aggregate尾部以及已释放的物理Claim形成一条闭合证据链。新的Binding只负责新授权，
 * 不会改写上一份投递历史。
 */
export async function loadReplacementTestDeliveryPreparationSources(
  workspaceRoot: RootedDirectory,
  context: Readonly<DemandOperationAuthorityContext>,
  targetTaskId: WakeflowDurableId<"target-task">,
  resourceProfile: Readonly<WakeflowWorkspaceHostResourceProfile>,
  identityProfile: Readonly<WakeflowWindowHostIdentityProfile>,
  signal: AbortSignal | undefined,
): Promise<Readonly<ReplacementTestDeliveryPreparationSources>> {
  if (context.loaded.identity.executionPlacement.mode !== "main") {
    fail("placement");
  }
  try {
    const snapshot = await readDemandResultReviewSnapshot(
      context.demandRoot,
      signal === undefined ? undefined : { signal },
    );
    const route = buildDemandPostAcceptanceRoute(context.loaded, snapshot);
    const target = context.loaded.aggregate.state.targetTasks.find(
      (entry) => entry.targetTaskId === targetTaskId,
    );
    if (
      route.nextStage.status !== "test-delivery-replacement-planning" ||
      route.nextStage.rejectedDelivery.targetTaskId !== targetTaskId ||
      target === undefined ||
      target.workType !== "test" ||
      target.phase !== "test-host-effect-rejected"
    ) {
      fail("route");
    }
    const rejectedDelivery = route.nextStage.rejectedDelivery;
    const attemptState = target.testAttempts.at(-1)!;
    const previousAuthorization = attemptState.deliveryAuthorizations.at(-1)!;
    if (
      attemptState.deliveryAuthorizations.length >=
      MAXIMUM_TEST_DELIVERY_AUTHORIZATIONS_PER_ATTEMPT
    ) {
      fail("authorization-capacity");
    }
    if (
      target.currentDelivery.targetDeliveryId !==
        rejectedDelivery.targetDeliveryId ||
      target.currentDelivery.workClaim.claimId !==
        rejectedDelivery.workClaimId ||
      target.currentDelivery.hostEffect.observationDigest !==
        rejectedDelivery.observationDigest ||
      target.currentDelivery.hostEffect.disposition !==
        "rejected-before-effect" ||
      target.currentDelivery.hostEffect.readbackStatus !== "unavailable" ||
      target.currentDelivery.hostEffect.claimHandling !==
        "release-authorized" ||
      previousAuthorization.targetDeliveryId !==
        rejectedDelivery.targetDeliveryId ||
      previousAuthorization.intentDigest !== target.currentDelivery.intentDigest
    ) {
      fail("observation");
    }

    const repository = new DemandEventSourcingRepository(context.demandRoot);
    const [preparedEvent, claimEvent, observationEvent, taskEvent] =
      await Promise.all([
        repository.findTestDeliveryPreparedEvent(
          rejectedDelivery.targetDeliveryId,
          signal === undefined ? undefined : { signal },
        ),
        repository.findTargetHostEffectClaimedEvent(
          rejectedDelivery.workClaimId,
          signal === undefined ? undefined : { signal },
        ),
        repository.findTargetHostEffectObservedEvent(
          rejectedDelivery.workClaimId,
          signal === undefined ? undefined : { signal },
        ),
        repository.findTargetTaskPlannedEvent(
          target.taskPackageId,
          signal === undefined ? undefined : { signal },
        ),
      ]);
    if (
      preparedEvent === null ||
      claimEvent === null ||
      observationEvent === null
    ) {
      fail("observation");
    }
    if (
      taskEvent === null ||
      taskEvent.event.data.taskPackage.workType !== "test"
    ) {
      fail("task-package");
    }
    const previousIntent = preparedEvent.event.data.intent;
    const claim = claimEvent.event.data.claim;
    const observation = observationEvent.event.data.observation;
    const taskPackage = taskEvent.event.data.taskPackage;
    const testCard = await loadTestCardFromEvent(
      repository,
      target.testCard.testCardId,
      signal,
    );
    try {
      assertTestTaskPackageMatchesTestCard(taskPackage, testCard);
      assertTestDeliveryIntentMatchesSources(
        previousIntent,
        taskPackage,
        testCard,
      );
    } catch (error: unknown) {
      if (error instanceof TestTaskPackageError) fail("task-package", error);
      if (error instanceof TestDeliveryIntentError) fail("observation", error);
      throw error;
    }
    if (
      previousIntent.intentDigest !== target.currentDelivery.intentDigest ||
      canonicalizeJson(previousIntent.attempt, "$previousAttempt") !==
        canonicalizeJson(attemptState.attempt, "$currentAttempt") ||
      !("workType" in claim.target) ||
      claim.target.workType !== "test" ||
      claim.target.demandId !== context.loaded.identity.demandId ||
      claim.target.targetTaskId !== targetTaskId ||
      claim.target.targetDeliveryId !== rejectedDelivery.targetDeliveryId ||
      claim.target.intentDigest !== previousIntent.intentDigest ||
      claim.target.testAttemptId !== attemptState.attempt.testAttemptId ||
      claim.target.testDispatchPacketDigest !==
        target.currentDelivery.workClaim.testDispatchPacketDigest ||
      claim.claimId !== rejectedDelivery.workClaimId ||
      claim.claimDigest !== target.currentDelivery.workClaim.claimDigest ||
      claim.claimTransition.eventId !==
        target.currentDelivery.workClaim.claimEventId ||
      claim.claimTransition.commitId !==
        target.currentDelivery.workClaim.claimCommitId ||
      claimEvent.storedEvent.eventId !== claim.claimTransition.eventId ||
      !("workType" in observation.action) ||
      observation.action.workType !== "test" ||
      observation.action.actionId !== rejectedDelivery.workClaimId ||
      observation.action.targetDeliveryId !==
        rejectedDelivery.targetDeliveryId ||
      observation.action.intentDigest !== previousIntent.intentDigest ||
      observation.action.testAttemptId !== attemptState.attempt.testAttemptId ||
      observation.action.testDispatchPacketDigest !==
        claim.target.testDispatchPacketDigest ||
      observation.observationDigest !== rejectedDelivery.observationDigest ||
      observation.attempt.status !== "rejected-before-effect" ||
      observation.readback.status !== "unavailable" ||
      observation.observedAt !== target.currentDelivery.hostEffect.observedAt
    ) {
      fail("observation");
    }
    assertTestPreparationSourcesCurrent(context, target, taskPackage, testCard);
    await assertProductClaimsAbsent(workspaceRoot, testCard, signal);
    await assertWindowClaimAbsent(workspaceRoot, target.windowId, signal);

    let binding: Readonly<WakeflowWindowHostBinding>;
    try {
      binding = await loadCurrentDeliveryWindowBinding(
        workspaceRoot,
        context.config.model,
        resourceProfile,
        identityProfile,
        target.windowId,
        signal,
      );
    } catch (error: unknown) {
      if (error instanceof TargetDeliveryBindingAuthorityError) {
        if (error.reason === "aborted") fail("aborted", error);
        fail("binding", error);
      }
      throw error;
    }
    const replacement = Object.freeze({
      kind: "rejected-before-effect" as const,
      authorizationOrdinal: attemptState.deliveryAuthorizations.length + 1,
      previousDelivery: Object.freeze({
        targetDeliveryId: previousIntent.targetDeliveryId,
        intentDigest: previousIntent.intentDigest,
        testDispatchPacketDigest:
          target.currentDelivery.workClaim.testDispatchPacketDigest,
      }),
      rejectedHostEffect: Object.freeze({
        claimId: claim.claimId,
        claimDigest: claim.claimDigest,
        claimEventId: claim.claimTransition.eventId,
        claimCommitId: claim.claimTransition.commitId,
        observationDigest: observation.observationDigest,
        observedAt: observation.observedAt,
      }),
    }) satisfies Readonly<TestDeliveryReplacementAuthorization>;
    return Object.freeze({
      mode: "replacement-authorization" as const,
      taskPackage,
      testCard,
      binding,
      attempt: attemptState.attempt,
      replacement,
    });
  } catch (error: unknown) {
    if (error instanceof TestDeliveryPreparationAuthorityError) throw error;
    if (error instanceof DemandResultReviewSnapshotError) {
      if (error.reason === "aborted") fail("aborted", error);
      fail("route", error);
    }
    if (error instanceof DemandPostAcceptanceRouteError) fail("route", error);
    if (error instanceof DemandEventSourcingRepositoryError) {
      if (error.reason === "aborted") fail("aborted", error);
      fail("observation", error);
    }
    throw error;
  }
}

/**
 * 从当前Test Target phase选择唯一Preparation变体；每个分支仍重建并复验完整
 * Post-Acceptance Route，Aggregate phase本身不授予写权限。
 */
export async function loadCurrentTestDeliveryPreparationSources(
  workspaceRoot: RootedDirectory,
  context: Readonly<DemandOperationAuthorityContext>,
  targetTaskId: WakeflowDurableId<"target-task">,
  resourceProfile: Readonly<WakeflowWorkspaceHostResourceProfile>,
  identityProfile: Readonly<WakeflowWindowHostIdentityProfile>,
  signal: AbortSignal | undefined,
): Promise<Readonly<TestDeliveryPreparationSources>> {
  const target = context.loaded.aggregate.state.targetTasks.find(
    (entry) => entry.targetTaskId === targetTaskId,
  );
  if (target?.workType !== "test") fail("route");
  if (target.phase === "planned") {
    return loadTestDeliveryPreparationSources(
      workspaceRoot,
      context,
      targetTaskId,
      resourceProfile,
      identityProfile,
      signal,
    );
  }
  if (target.phase === "test-another-attempt-requested") {
    return loadRerunTestDeliveryPreparationSources(
      workspaceRoot,
      context,
      targetTaskId,
      resourceProfile,
      identityProfile,
      signal,
    );
  }
  if (target.phase === "test-host-effect-rejected") {
    return loadReplacementTestDeliveryPreparationSources(
      workspaceRoot,
      context,
      targetTaskId,
      resourceProfile,
      identityProfile,
      signal,
    );
  }
  fail("route");
}

/** 已提交重试从原始Event恢复命令来源，不依赖可删除投影或后来Config。 */
export async function loadTestDeliveryPreparationSourcesFromEvents(
  repository: DemandEventSourcingRepository,
  plan: Readonly<TestDeliveryPreparationPlan>,
  signal: AbortSignal | undefined,
): Promise<
  Readonly<Pick<TestDeliveryPreparationSources, "taskPackage" | "testCard">>
> {
  try {
    const taskEvent = await repository.findTargetTaskPlannedEvent(
      plan.intent.target.taskPackageId,
      signal === undefined ? undefined : { signal },
    );
    if (
      taskEvent === null ||
      taskEvent.event.data.taskPackage.workType !== "test"
    ) {
      fail("task-package");
    }
    const taskPackage = taskEvent.event.data.taskPackage;
    const testCard = await loadTestCardFromEvent(
      repository,
      plan.intent.target.testCard.testCardId,
      signal,
    );
    assertTestDeliveryIntentMatchesSources(plan.intent, taskPackage, testCard);
    return Object.freeze({ taskPackage, testCard });
  } catch (error: unknown) {
    if (error instanceof TestDeliveryPreparationAuthorityError) throw error;
    if (error instanceof DemandEventSourcingRepositoryError) {
      if (error.reason === "aborted") fail("aborted", error);
      fail("task-package", error);
    }
    if (error instanceof TestDeliveryIntentError) fail("task-package", error);
    throw error;
  }
}
