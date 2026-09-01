import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import { canonicalizeJson } from "../../foundation/data/canonical-json.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import type { WakeflowDurableId } from "../../contracts/identity/wakeflow-durable-id.js";
import type { WakeflowWorkspaceHostResourceProfile } from "../../workspace/workspace-host-resource-profile.js";
import type { WakeflowWindowHostBinding } from "../../workspace/window-runtime/wakeflow-window-host-binding.js";
import {
  inspectWakeflowWindowHostBindingInventory,
  WakeflowWindowHostBindingStoreError,
} from "../../workspace/window-runtime/wakeflow-window-host-binding-store.js";
import {
  compileWakeflowWindowHostBindingStoreAuthority,
  WakeflowWindowHostBindingStoreAuthorityError,
} from "../../workspace/window-runtime/wakeflow-window-host-binding-store-authority.js";
import type { WakeflowWindowHostIdentityProfile } from "../../workspace/window-runtime/wakeflow-window-host-identity-profile.js";
import type { DemandOperationAuthorityContext } from "../demand/demand-operation-authority-context.js";
import {
  DemandEventSourcingRepository,
  DemandEventSourcingRepositoryError,
  type AuditedDemandTargetResultHistory,
} from "../demand/event-sourcing/demand-event-sourcing-repository.js";
import type { TargetResult } from "../result/target-result.js";
import type { ControllerImplementationReviewDecision } from "../review/controller-implementation-review-decision.js";
import type { ControllerProductDefectRemediationAuthorization } from "../review/controller-product-defect-remediation-authorization.js";
import {
  computeTaskPackageDigest,
  TaskPackageError,
  type TaskPackage,
} from "../tasking/task-package.js";
import {
  TaskPackageProjectionStore,
  TaskPackageProjectionStoreError,
} from "../tasking/task-package-projection-store.js";
import {
  assertTargetDeliveryIntentMatchesTaskPackage,
  TargetDeliveryIntentError,
  type TargetDeliveryProductDefectRemediationContext,
  type TargetDeliveryReworkContext,
} from "./target-delivery-intent.js";
import {
  createTargetDeliveryReworkContext,
  TargetDeliveryReworkContextError,
} from "./target-delivery-rework-context.js";
import {
  createTargetDeliveryProductDefectRemediationContext,
  TargetDeliveryProductDefectRemediationContextError,
} from "./target-delivery-product-defect-remediation-context.js";
import type { TargetDeliveryPreparationPlan } from "./target-delivery-preparation-plan.js";

/** Target Delivery Preparation对TaskPackage、Config拓扑与私有Binding的组合准入。 */

interface TargetDeliveryPreparationSourceBase {
  readonly taskPackage: Readonly<TaskPackage>;
  readonly taskPackageDigest: Sha256Digest;
  readonly binding: Readonly<WakeflowWindowHostBinding>;
}

export interface TargetDeliveryPreparationReworkSource {
  readonly decision: Readonly<ControllerImplementationReviewDecision>;
  readonly previousResult: Readonly<TargetResult>;
}

export interface TargetDeliveryPreparationProductDefectRemediationSource {
  readonly authorization: Readonly<ControllerProductDefectRemediationAuthorization>;
  readonly previousResult: Readonly<TargetResult>;
}

export interface InitialTargetDeliveryPreparationSources extends TargetDeliveryPreparationSourceBase {
  readonly purpose: "initial";
}

export interface ReworkTargetDeliveryPreparationSources extends TargetDeliveryPreparationSourceBase {
  readonly purpose: "implementation-review-rework";
  readonly reworkSource: Readonly<TargetDeliveryPreparationReworkSource>;
  readonly reworkContext: Readonly<TargetDeliveryReworkContext>;
}

export interface ProductDefectRemediationTargetDeliveryPreparationSources extends TargetDeliveryPreparationSourceBase {
  readonly purpose: "product-defect-remediation";
  readonly productDefectRemediationSource: Readonly<TargetDeliveryPreparationProductDefectRemediationSource>;
  readonly productDefectRemediationContext: Readonly<TargetDeliveryProductDefectRemediationContext>;
}

export type TargetDeliveryPreparationSources =
  | InitialTargetDeliveryPreparationSources
  | ReworkTargetDeliveryPreparationSources
  | ProductDefectRemediationTargetDeliveryPreparationSources;

export type TargetDeliveryPreparationAuthorityErrorReason =
  | "config"
  | "demand-authority"
  | "task-package"
  | "rework"
  | "product-defect-remediation"
  | "topology"
  | "binding"
  | "aborted";

const ERROR_MESSAGES = {
  config: "Target Delivery Preparation Config authority is invalid.",
  "demand-authority":
    "Target Delivery Preparation Demand authority is invalid.",
  "task-package":
    "Target Delivery Preparation TaskPackage authority is invalid.",
  rework: "Target Delivery Preparation rework history is invalid or stale.",
  "product-defect-remediation":
    "Target Delivery Preparation product-defect remediation history is invalid or stale.",
  topology:
    "Target Delivery Preparation assignment is not in current Config topology.",
  binding: "Target Delivery Preparation current Binding authority is invalid.",
  aborted: "Target Delivery Preparation authority loading was aborted.",
} as const satisfies Readonly<
  Record<TargetDeliveryPreparationAuthorityErrorReason, string>
>;

/** Preparation业务来源无法形成当前闭合权威时的稳定错误。 */
export class TargetDeliveryPreparationAuthorityError extends Error {
  override readonly name = "TargetDeliveryPreparationAuthorityError";
  readonly code = "wakeflow-target-delivery-preparation-authority" as const;
  readonly reason: TargetDeliveryPreparationAuthorityErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;

  constructor(
    reason: TargetDeliveryPreparationAuthorityErrorReason,
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
  reason: TargetDeliveryPreparationAuthorityErrorReason,
  cause?: unknown,
): never {
  throw new TargetDeliveryPreparationAuthorityError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
  );
}

function sameAuthorityReference(left: unknown, right: unknown): boolean {
  return (
    canonicalizeJson(left, "$leftAuthorityRef") ===
    canonicalizeJson(right, "$rightAuthorityRef")
  );
}

function assertTaskPackageAuthority(
  context: Readonly<DemandOperationAuthorityContext>,
  targetTaskId: WakeflowDurableId<"target-task">,
  taskPackage: Readonly<TaskPackage>,
  taskPackageDigest: Sha256Digest,
): void {
  if (taskPackage.workType !== "implementation") fail("task-package");
  const target = context.loaded.aggregate.state.targetTasks.find(
    (entry) => entry.targetTaskId === targetTaskId,
  );
  if (
    context.loaded.identity.demandId !== taskPackage.demandId ||
    context.loaded.identity.programId !== taskPackage.programId ||
    context.loaded.authorityDigest !== taskPackage.demandAuthorityDigest ||
    context.loaded.identity.demandType === "research"
  ) {
    fail("demand-authority");
  }
  if (
    target === undefined ||
    target.workType === "test" ||
    (target.phase !== "planned" &&
      target.phase !== "rework-requested" &&
      target.phase !== "product-defect-rework-requested") ||
    target.taskPackageId !== taskPackage.taskPackageId ||
    target.taskPackageDigest !== taskPackageDigest ||
    target.repositoryId !== taskPackage.assignment.repositoryId ||
    target.windowId !== taskPackage.assignment.windowId ||
    taskPackage.selectedAuthorityRefs.some(
      (reference) =>
        !context.loaded.authority.authorityRefs.some((candidate) =>
          sameAuthorityReference(candidate, reference),
        ),
    )
  ) {
    fail("task-package");
  }
  if (
    context.config.model.program.programId !== taskPackage.programId ||
    context.config.configDigest !== taskPackage.configDigest
  ) {
    fail("config");
  }
  const repository =
    context.config.indexes.repositoryById[taskPackage.assignment.repositoryId];
  const window =
    context.config.indexes.windowById[taskPackage.assignment.windowId];
  if (
    repository === undefined ||
    window === undefined ||
    window.role !== "product" ||
    window.root.kind !== "repository" ||
    window.root.repositoryId !== repository.repositoryId
  ) {
    fail("topology");
  }
}

async function loadPreparationPurpose(
  context: Readonly<DemandOperationAuthorityContext>,
  targetTaskId: WakeflowDurableId<"target-task">,
  signal: AbortSignal | undefined,
): Promise<
  Readonly<
    | { readonly purpose: "initial" }
    | {
        readonly purpose: "implementation-review-rework";
        readonly reworkSource: Readonly<TargetDeliveryPreparationReworkSource>;
        readonly reworkContext: Readonly<TargetDeliveryReworkContext>;
      }
    | {
        readonly purpose: "product-defect-remediation";
        readonly productDefectRemediationSource: Readonly<TargetDeliveryPreparationProductDefectRemediationSource>;
        readonly productDefectRemediationContext: Readonly<TargetDeliveryProductDefectRemediationContext>;
      }
  >
> {
  const target = context.loaded.aggregate.state.targetTasks.find(
    (entry) => entry.targetTaskId === targetTaskId,
  );
  if (target?.phase === "planned") {
    return Object.freeze({ purpose: "initial" as const });
  }
  if (
    target?.phase !== "rework-requested" &&
    target?.phase !== "product-defect-rework-requested"
  ) {
    fail("rework");
  }
  const sourceFailureReason =
    target.phase === "product-defect-rework-requested"
      ? ("product-defect-remediation" as const)
      : ("rework" as const);
  try {
    const history = await new DemandEventSourcingRepository(
      context.demandRoot,
    ).auditTargetResultHistory(signal === undefined ? undefined : { signal });
    if (
      history.aggregate.streamRevision !==
        context.loaded.aggregate.streamRevision ||
      history.aggregate.stateDigest !== context.loaded.aggregate.stateDigest
    ) {
      fail(sourceFailureReason);
    }
    if (target.phase === "product-defect-rework-requested") {
      const located = locateProductDefectRemediationSource(history, {
        productDefectRemediationId:
          target.productDefectRemediation.productDefectRemediationId,
        authorizationDigest:
          target.productDefectRemediation.authorizationDigest,
        testReviewDecisionId:
          target.productDefectRemediation.testReviewDecisionId,
        testReviewDecisionDigest:
          target.productDefectRemediation.testReviewDecisionDigest,
        targetTaskId: target.targetTaskId,
        targetResultId: target.currentDelivery.targetResult.targetResultId,
        resultDigest: target.currentDelivery.targetResult.resultDigest,
      });
      return Object.freeze({
        purpose: "product-defect-remediation" as const,
        productDefectRemediationSource: located.productDefectRemediationSource,
        productDefectRemediationContext:
          located.productDefectRemediationContext,
      });
    }
    const located = locateReworkSource(history, {
      targetReviewDecisionId:
        target.currentDelivery.reviewDecision.targetReviewDecisionId,
      decisionDigest: target.currentDelivery.reviewDecision.decisionDigest,
      targetResultId: target.currentDelivery.targetResult.targetResultId,
      resultDigest: target.currentDelivery.targetResult.resultDigest,
    });
    return Object.freeze({
      purpose: "implementation-review-rework" as const,
      reworkSource: located.reworkSource,
      reworkContext: located.reworkContext,
    });
  } catch (error: unknown) {
    if (error instanceof TargetDeliveryPreparationAuthorityError) throw error;
    if (error instanceof DemandEventSourcingRepositoryError) {
      if (error.reason === "aborted") fail("aborted", error);
      fail(sourceFailureReason, error);
    }
    if (error instanceof TargetDeliveryReworkContextError) {
      fail("rework", error);
    }
    if (error instanceof TargetDeliveryProductDefectRemediationContextError) {
      fail("product-defect-remediation", error);
    }
    throw error;
  }
}

interface ExpectedTargetDeliveryReworkSource {
  readonly targetReviewDecisionId: ControllerImplementationReviewDecision["targetReviewDecisionId"];
  readonly decisionDigest: Sha256Digest;
  readonly targetResultId: TargetResult["targetResultId"];
  readonly resultDigest: Sha256Digest;
}

function locateReworkSource(
  history: Readonly<AuditedDemandTargetResultHistory>,
  expected: Readonly<ExpectedTargetDeliveryReworkSource>,
): Readonly<{
  readonly reworkSource: Readonly<TargetDeliveryPreparationReworkSource>;
  readonly reworkContext: Readonly<TargetDeliveryReworkContext>;
}> {
  const decision = history.targetReviewDecisions.find(
    (source) =>
      source.decision.targetReviewDecisionId ===
      expected.targetReviewDecisionId,
  );
  const previousResult = history.targetResults.find(
    (source) => source.result.targetResultId === expected.targetResultId,
  );
  if (
    decision === undefined ||
    previousResult === undefined ||
    decision.decision.kind !==
      "WakeflowControllerImplementationReviewDecision" ||
    decision.decision.decisionDigest !== expected.decisionDigest ||
    decision.decision.decision !== "rework" ||
    previousResult.result.resultDigest !== expected.resultDigest ||
    previousResult.sourceEvent.streamRevision >=
      decision.sourceEvent.streamRevision
  ) {
    fail("rework");
  }
  const reworkSource = Object.freeze({
    decision: decision.decision,
    previousResult: previousResult.result,
  });
  return Object.freeze({
    reworkSource,
    reworkContext: createTargetDeliveryReworkContext(reworkSource),
  });
}

interface ExpectedProductDefectRemediationSource {
  readonly productDefectRemediationId: ControllerProductDefectRemediationAuthorization["productDefectRemediationId"];
  readonly authorizationDigest: Sha256Digest;
  readonly testReviewDecisionId: ControllerProductDefectRemediationAuthorization["source"]["testReviewDecision"]["targetReviewDecisionId"];
  readonly testReviewDecisionDigest: Sha256Digest;
  readonly targetTaskId: WakeflowDurableId<"target-task">;
  readonly targetResultId: TargetResult["targetResultId"];
  readonly resultDigest: Sha256Digest;
}

function locateProductDefectRemediationSource(
  history: Readonly<AuditedDemandTargetResultHistory>,
  expected: Readonly<ExpectedProductDefectRemediationSource>,
): Readonly<{
  readonly productDefectRemediationSource: Readonly<TargetDeliveryPreparationProductDefectRemediationSource>;
  readonly productDefectRemediationContext: Readonly<TargetDeliveryProductDefectRemediationContext>;
}> {
  const authorizationSource =
    history.productDefectRemediationAuthorizations.find(
      (source) =>
        source.authorization.productDefectRemediationId ===
        expected.productDefectRemediationId,
    );
  const previousResult = history.targetResults.find(
    (source) => source.result.targetResultId === expected.targetResultId,
  );
  const authorization = authorizationSource?.authorization;
  const affected = authorization?.affectedTargets.find(
    (target) => target.baseline.targetTaskId === expected.targetTaskId,
  );
  if (
    authorization === undefined ||
    authorizationSource === undefined ||
    previousResult === undefined ||
    affected === undefined ||
    authorization.authorizationDigest !== expected.authorizationDigest ||
    authorization.source.testReviewDecision.targetReviewDecisionId !==
      expected.testReviewDecisionId ||
    authorization.source.testReviewDecision.decisionDigest !==
      expected.testReviewDecisionDigest ||
    previousResult.result.workType !== "implementation" ||
    previousResult.result.targetTaskId !== expected.targetTaskId ||
    previousResult.result.resultDigest !== expected.resultDigest ||
    affected.baseline.targetResultId !== expected.targetResultId ||
    affected.baseline.resultDigest !== expected.resultDigest ||
    affected.baseline.taskPackageId !==
      previousResult.result.taskPackage.taskPackageId ||
    affected.baseline.taskPackageDigest !==
      previousResult.result.taskPackage.digest ||
    previousResult.sourceEvent.streamRevision >=
      authorizationSource.sourceEvent.streamRevision
  ) {
    fail("product-defect-remediation");
  }
  const productDefectRemediationSource = Object.freeze({
    authorization,
    previousResult: previousResult.result,
  });
  return Object.freeze({
    productDefectRemediationSource,
    productDefectRemediationContext:
      createTargetDeliveryProductDefectRemediationContext(
        productDefectRemediationSource,
      ),
  });
}

/**
 * 从完整事件历史恢复已规划返工Intent对应的Decision/Result命令来源。
 *
 * 该路径供Apply幂等重建命令摘要使用，因此不依赖当前Aggregate仍停留在
 * `rework-requested`，也不依赖可删除投影。
 */
export async function loadTargetDeliveryPreparationReworkSourceFromEventHistory(
  repository: DemandEventSourcingRepository,
  intent: Readonly<{
    readonly rework?: Readonly<TargetDeliveryReworkContext>;
  }>,
  signal: AbortSignal | undefined,
): Promise<Readonly<TargetDeliveryPreparationReworkSource> | undefined> {
  if (intent.rework === undefined) return undefined;
  try {
    const history = await repository.auditTargetResultHistory(
      signal === undefined ? undefined : { signal },
    );
    const located = locateReworkSource(history, {
      targetReviewDecisionId: intent.rework.decision.targetReviewDecisionId,
      decisionDigest: intent.rework.decision.decisionDigest,
      targetResultId: intent.rework.previousResult.targetResultId,
      resultDigest: intent.rework.previousResult.resultDigest,
    });
    if (
      canonicalizeJson(located.reworkContext, "$historyReworkContext") !==
      canonicalizeJson(intent.rework, "$intentReworkContext")
    ) {
      fail("rework");
    }
    return located.reworkSource;
  } catch (error: unknown) {
    if (error instanceof TargetDeliveryPreparationAuthorityError) throw error;
    if (error instanceof DemandEventSourcingRepositoryError) {
      if (error.reason === "aborted") fail("aborted", error);
      fail("rework", error);
    }
    if (error instanceof TargetDeliveryReworkContextError) {
      fail("rework", error);
    }
    throw error;
  }
}

/** 从Event历史恢复产品缺陷Intent对应的Authorization与先前产品Result。 */
export async function loadTargetDeliveryPreparationProductDefectRemediationSourceFromEventHistory(
  repository: DemandEventSourcingRepository,
  intent: Readonly<{
    readonly productDefectRemediation?: Readonly<TargetDeliveryProductDefectRemediationContext>;
  }>,
  signal: AbortSignal | undefined,
): Promise<
  Readonly<TargetDeliveryPreparationProductDefectRemediationSource> | undefined
> {
  const context = intent.productDefectRemediation;
  if (context === undefined) return undefined;
  try {
    const history = await repository.auditTargetResultHistory(
      signal === undefined ? undefined : { signal },
    );
    const affectedAuthorization =
      history.productDefectRemediationAuthorizations.find(
        (source) =>
          source.authorization.productDefectRemediationId ===
          context.authorization.productDefectRemediationId,
      );
    const affected = affectedAuthorization?.authorization.affectedTargets.find(
      (target) =>
        target.baseline.targetResultId ===
        context.previousResult.targetResultId,
    );
    if (affected === undefined) fail("product-defect-remediation");
    const located = locateProductDefectRemediationSource(history, {
      productDefectRemediationId:
        context.authorization.productDefectRemediationId,
      authorizationDigest: context.authorization.authorizationDigest,
      testReviewDecisionId: context.testReviewDecision.targetReviewDecisionId,
      testReviewDecisionDigest: context.testReviewDecision.decisionDigest,
      targetTaskId: affected.baseline.targetTaskId,
      targetResultId: context.previousResult.targetResultId,
      resultDigest: context.previousResult.resultDigest,
    });
    if (
      canonicalizeJson(
        located.productDefectRemediationContext,
        "$historyProductDefectRemediationContext",
      ) !== canonicalizeJson(context, "$intentProductDefectRemediationContext")
    ) {
      fail("product-defect-remediation");
    }
    return located.productDefectRemediationSource;
  } catch (error: unknown) {
    if (error instanceof TargetDeliveryPreparationAuthorityError) throw error;
    if (error instanceof DemandEventSourcingRepositoryError) {
      if (error.reason === "aborted") fail("aborted", error);
      fail("product-defect-remediation", error);
    }
    if (error instanceof TargetDeliveryProductDefectRemediationContextError) {
      fail("product-defect-remediation", error);
    }
    throw error;
  }
}

async function loadTaskPackageProjection(
  context: Readonly<DemandOperationAuthorityContext>,
  targetTaskId: WakeflowDurableId<"target-task">,
  signal: AbortSignal | undefined,
): Promise<
  Readonly<{
    readonly taskPackage: Readonly<TaskPackage>;
    readonly taskPackageDigest: Sha256Digest;
  }>
> {
  const target = context.loaded.aggregate.state.targetTasks.find(
    (entry) => entry.targetTaskId === targetTaskId,
  );
  if (target === undefined) fail("task-package");
  try {
    const projection = await new TaskPackageProjectionStore(
      context.demandRoot,
    ).load(target.taskPackageId, {
      expectedTaskPackageDigest: target.taskPackageDigest,
      ...(signal === undefined ? {} : { signal }),
    });
    assertTaskPackageAuthority(
      context,
      targetTaskId,
      projection.taskPackage,
      projection.taskPackageDigest,
    );
    return Object.freeze({
      taskPackage: projection.taskPackage,
      taskPackageDigest: projection.taskPackageDigest,
    });
  } catch (error: unknown) {
    if (error instanceof TargetDeliveryPreparationAuthorityError) throw error;
    if (error instanceof TaskPackageProjectionStoreError) {
      if (error.reason === "aborted") fail("aborted", error);
      fail("task-package", error);
    }
    throw error;
  }
}

async function loadCurrentBinding(
  workspaceRoot: RootedDirectory,
  context: Readonly<DemandOperationAuthorityContext>,
  resourceProfile: Readonly<WakeflowWorkspaceHostResourceProfile>,
  identityProfile: Readonly<WakeflowWindowHostIdentityProfile>,
  windowId: WakeflowDurableId<"window">,
  signal: AbortSignal | undefined,
): Promise<Readonly<WakeflowWindowHostBinding>> {
  try {
    const authority = compileWakeflowWindowHostBindingStoreAuthority(
      context.config.model,
      resourceProfile,
      identityProfile,
    );
    const inventory = await inspectWakeflowWindowHostBindingInventory(
      workspaceRoot,
      authority,
      signal === undefined ? {} : { signal },
    );
    const matches = inventory.bindings.filter(
      (entry) => entry.windowId === windowId,
    );
    if (matches.length !== 1 || matches[0] === undefined) fail("binding");
    return matches[0];
  } catch (error: unknown) {
    if (error instanceof TargetDeliveryPreparationAuthorityError) throw error;
    if (
      error instanceof WakeflowWindowHostBindingStoreAuthorityError ||
      error instanceof WakeflowWindowHostBindingStoreError
    ) {
      if (
        error instanceof WakeflowWindowHostBindingStoreError &&
        error.reason === "aborted"
      ) {
        fail("aborted", error);
      }
      fail("binding", error);
    }
    throw error;
  }
}

/** 从完整read-only上下文加载同一Target Task的TaskPackage与当前Binding。 */
export async function loadTargetDeliveryPreparationSources(
  workspaceRoot: RootedDirectory,
  context: Readonly<DemandOperationAuthorityContext>,
  targetTaskId: WakeflowDurableId<"target-task">,
  resourceProfile: Readonly<WakeflowWorkspaceHostResourceProfile>,
  identityProfile: Readonly<WakeflowWindowHostIdentityProfile>,
  signal: AbortSignal | undefined,
): Promise<Readonly<TargetDeliveryPreparationSources>> {
  const loaded = await loadTaskPackageProjection(context, targetTaskId, signal);
  const binding = await loadCurrentBinding(
    workspaceRoot,
    context,
    resourceProfile,
    identityProfile,
    loaded.taskPackage.assignment.windowId,
    signal,
  );
  const purpose = await loadPreparationPurpose(context, targetTaskId, signal);
  return Object.freeze({ ...loaded, binding, ...purpose });
}

/** 从原始Tasking事件恢复Apply重试所需的完整TaskPackage，不依赖可删除投影。 */
export async function loadTargetDeliveryPreparationTaskPackageFromEvent(
  repository: DemandEventSourcingRepository,
  plan: Readonly<TargetDeliveryPreparationPlan>,
  signal: AbortSignal | undefined,
): Promise<Readonly<TaskPackage>> {
  try {
    const located = await repository.findTargetTaskPlannedEvent(
      plan.intent.target.taskPackageId,
      signal === undefined ? undefined : { signal },
    );
    if (located === null) fail("task-package");
    const taskPackage = located.event.data.taskPackage;
    if (
      computeTaskPackageDigest(taskPackage) !==
      plan.intent.target.taskPackageDigest
    ) {
      fail("task-package");
    }
    assertTargetDeliveryIntentMatchesTaskPackage(plan.intent, taskPackage);
    return taskPackage;
  } catch (error: unknown) {
    if (error instanceof TargetDeliveryPreparationAuthorityError) throw error;
    if (
      error instanceof DemandEventSourcingRepositoryError ||
      error instanceof TargetDeliveryIntentError ||
      error instanceof TaskPackageError
    ) {
      if (
        error instanceof DemandEventSourcingRepositoryError &&
        error.reason === "aborted"
      ) {
        fail("aborted", error);
      }
      fail("task-package", error);
    }
    throw error;
  }
}
