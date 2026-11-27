import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../../contracts/generated/foundation/utc-instant.generated.js";
import type {
  WakeflowDemandAggregateState as DemandAggregateStateWire,
  CurrentDelivery as ProductCurrentDeliveryWire,
  ProductDefectRemediation as ProductDefectRemediationWire,
  TestAttemptState as TestAttemptStateWire,
  TestCurrentDelivery as TestCurrentDeliveryWire,
  TestObservedCurrentDelivery as TestObservedCurrentDeliveryWire,
  TestResultCurrentDelivery as TestResultCurrentDeliveryWire,
  TestReviewedCurrentDelivery as TestReviewedCurrentDeliveryWire,
} from "../../../contracts/generated/governance/demand/demand-aggregate-state.generated.js";
import { WAKEFLOW_DEMAND_AGGREGATE_STATE_SCHEMA } from "../../../contracts/generated/governance/demand/demand-aggregate-state.generated.js";
import { WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA } from "../../../contracts/generated/governance/ledger/ledger-authority-member-reference.generated.js";
import { WAKEFLOW_TEST_EXECUTION_ATTEMPT_SCHEMA } from "../../../contracts/generated/governance/testing/test-execution-attempt.generated.js";
import {
  parseWakeflowDurableIdOfKind,
  type WakeflowDurableId,
  WakeflowDurableIdError,
} from "../../../contracts/identity/wakeflow-durable-id.js";
import { isEvidenceKind } from "../../../contracts/vocabulary/evidence-kinds.js";
import { computeCanonicalJsonSha256Digest } from "../../../foundation/crypto/canonical-json-sha256.js";
import {
  parseSha256Digest,
  type Sha256Digest,
  Sha256Error,
} from "../../../foundation/crypto/sha256.js";
import {
  type JsonValue,
  JsonValueError,
  parseJsonValue,
} from "../../../foundation/data/json-value.js";
import { createRuntimeJsonSchemaValidator } from "../../../foundation/schema/runtime-json-schema.js";
import {
  parseUtcInstant,
  type UtcInstant,
  UtcInstantError,
} from "../../../foundation/time/utc-instant.js";
import {
  parseWakeflowWindowHostBindingId,
  type WakeflowWindowHostBindingId,
  WakeflowWindowHostBindingIdError,
} from "../../../workspace/window-runtime/wakeflow-window-host-binding-id.js";
import { DELIVERY_REARM_LIMIT } from "../../delivery/delivery-rearm.js";
import {
  deriveTargetResultCallbackId,
  TARGET_RESULT_CALLBACK_GENERATION_LIMIT,
} from "../../result/target-result-callback.js";
import type { ControllerImplementationReviewDecision } from "../../review/controller-implementation-review-decision.js";
import type { ControllerTestReviewDecision } from "../../review/controller-test-review-decision.js";
import {
  assertRerunTestExecutionAttemptFollows,
  parseTestExecutionAttempt,
  type TestExecutionAttempt,
  TestExecutionAttemptError,
} from "../../testing/test-execution-attempt.js";
import {
  currentTestTargetsOf,
  DEMAND_AGGREGATE_STATE_ARTIFACT_KIND,
  DEMAND_AGGREGATE_STATE_SCHEMA_VERSION,
  type DemandAggregateState,
  type DemandAwaitingDecision,
  type DemandContinuationState,
  type DemandCurrentDeliveryBase,
  type DemandDeliveryOutcomeSummary,
  type DemandLifecycle,
  type DemandManagedEvidenceSummary,
  type DemandPendingTestRetest,
  type DemandProductDefectRemediationSummary,
  type DemandResultReportedTargetTaskState,
  type DemandReviewedTargetPhase,
  type DemandSupplementPackage,
  type DemandTargetResultCallbackSummary,
  type DemandTargetResultSummary,
  type DemandTargetReviewDecisionSummary,
  type DemandTargetTaskState,
  type DemandTestAcceptedTargetTaskState,
  type DemandTestAnotherAttemptRequestedTargetTaskState,
  type DemandTestAttemptLineage,
  type DemandTestAttemptState,
  type DemandTestCurrentDeliveryBase,
  type DemandTestEscalatedTargetTaskState,
  type DemandTestProductDefectTargetTaskState,
  type DemandTestReviewBlockedTargetTaskState,
  fail,
  lastTestAttempt,
} from "./demand-aggregate-state-model.js";
import {
  parseRequirementLineageReference,
  RequirementLineageError,
} from "./requirement-lineage.js";

/**
 * Wakeflow Governance / Demand Model / Aggregate Wire：聚合状态的准入：wire Schema 校验之后逐字段归一——标识、摘要、每个目标按阶段要带的事实、补充包与续接、整份状态的摘要。别的模块只经 `parseDemandAggregateState` 拿到状态。
 *
 * 从 `demand-aggregate-state.ts` 按关注点分出来的一段（open-items L5，gate-log §13.255）；对外的入口仍是那个
 * 文件，它只转出别处在用的公开名字。
 */

const validateWire = createRuntimeJsonSchemaValidator<DemandAggregateStateWire>(
  WAKEFLOW_DEMAND_AGGREGATE_STATE_SCHEMA,
  [
    WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
    WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA,
    WAKEFLOW_TEST_EXECUTION_ATTEMPT_SCHEMA,
    WAKEFLOW_UTC_INSTANT_SCHEMA,
  ],
);

/** 一个测试目标的尝试上限，对应 test-execution-attempt Schema 的序号最大值。 */
export const TEST_ATTEMPT_LIMIT = 10;

function parseId<
  Kind extends
    | "demand"
    | "demand-event"
    | "target-task"
    | "task-package"
    | "repository"
    | "window"
    | "target-delivery"
    | "target-result"
    | "target-review-decision"
    | "product-defect-remediation"
    | "demand-event-commit"
    | "evidence"
    | "test-attempt"
    | "work-claim",
>(value: unknown, kind: Kind, path: string): WakeflowDurableId<Kind> {
  try {
    return parseWakeflowDurableIdOfKind(value, kind, path);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("identifier", path, error);
    throw error;
  }
}

function parseCurrentDeliveryBase(
  value:
    | ProductCurrentDeliveryWire
    | TestCurrentDeliveryWire
    | TestObservedCurrentDeliveryWire
    | TestResultCurrentDeliveryWire
    | TestReviewedCurrentDeliveryWire,
  path: string,
): Readonly<DemandCurrentDeliveryBase> {
  let bindingId: WakeflowWindowHostBindingId;
  try {
    bindingId = parseWakeflowWindowHostBindingId(value.bindingId, `${path}/bindingId`);
  } catch (error: unknown) {
    if (error instanceof WakeflowWindowHostBindingIdError) {
      fail("identifier", `${path}/bindingId`, error);
    }
    throw error;
  }
  if (
    !Number.isSafeInteger(value.generation) ||
    value.generation < 1 ||
    value.generation > DELIVERY_REARM_LIMIT + 1
  ) {
    fail("relation", `${path}/generation`);
  }
  if (!Number.isSafeInteger(value.fence.streamRevision) || value.fence.streamRevision < 2) {
    fail("relation", `${path}/fence/streamRevision`);
  }
  return Object.freeze({
    deliveryId: parseId(value.deliveryId, "target-delivery", `${path}/deliveryId`),
    envelopeDigest: parseDigest(value.envelopeDigest, `${path}/envelopeDigest`),
    promptDigest: parseDigest(value.promptDigest, `${path}/promptDigest`),
    generation: value.generation,
    hostId: value.hostId,
    bindingId,
    fence: Object.freeze({
      claimId: parseId(value.fence.claimId, "work-claim", `${path}/fence/claimId`),
      claimDigest: parseDigest(value.fence.claimDigest, `${path}/fence/claimDigest`),
      streamRevision: value.fence.streamRevision,
    }),
  });
}

function parseDeliveryOutcomeSummary(
  value: NonNullable<
    ProductCurrentDeliveryWire["outcome"] | TestObservedCurrentDeliveryWire["outcome"]
  >,
  path: string,
): Readonly<DemandDeliveryOutcomeSummary> {
  let observedAt: UtcInstant;
  try {
    observedAt = parseUtcInstant(value.observedAt, `${path}/observedAt`);
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) fail("relation", `${path}/observedAt`, error);
    throw error;
  }
  // observedAt 只保留来源时钟的审计事实；因果顺序由事件流修订、当前状态摘要与
  // 处置对围栏的精确引用保证，不比较跨来源墙钟。
  if (
    (value.disposition === "rejected-before-send") !==
    (value.claimHandling === "release-authorized")
  ) {
    fail("relation", `${path}/claimHandling`);
  }
  return Object.freeze({
    outcomeDigest: parseDigest(value.outcomeDigest, `${path}/outcomeDigest`),
    disposition: value.disposition,
    evidenceKind: value.evidenceKind,
    readbackStatus: value.readbackStatus,
    claimHandling: value.claimHandling,
    observedAt,
  });
}

function parseTargetResultSummary(
  value: NonNullable<ProductCurrentDeliveryWire["targetResult"]>,
  path: string,
): Readonly<DemandTargetResultSummary> {
  let reportedAt: UtcInstant;
  try {
    reportedAt = parseUtcInstant(value.reportedAt, `${path}/reportedAt`);
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) fail("relation", `${path}/reportedAt`, error);
    throw error;
  }
  // reportedAt只保留Report来源时钟的审计事实；Event流修订、当前状态摘要和
  // TargetResult对Host Effect的精确引用共同建立因果关系，不比较跨来源墙钟。
  const targetResultId = parseId(value.targetResultId, "target-result", `${path}/targetResultId`);
  return Object.freeze({
    targetResultId,
    resultDigest: parseDigest(value.resultDigest, `${path}/resultDigest`),
    outcome: value.outcome,
    reportedAt,
    claimHandling: "release-authorized" as const,
    callback: parseCallbackSummary(value.callback, targetResultId, `${path}/callback`),
  });
}

function parseCallbackSummary(
  value: NonNullable<ProductCurrentDeliveryWire["targetResult"]>["callback"],
  targetResultId: WakeflowDurableId<"target-result">,
  path: string,
): Readonly<DemandTargetResultCallbackSummary> {
  let issuedAt: UtcInstant;
  try {
    issuedAt = parseUtcInstant(value.issuedAt, `${path}/issuedAt`);
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) fail("relation", `${path}/issuedAt`, error);
    throw error;
  }
  let bindingId: WakeflowWindowHostBindingId;
  try {
    bindingId = parseWakeflowWindowHostBindingId(value.bindingId, `${path}/bindingId`);
  } catch (error: unknown) {
    if (error instanceof WakeflowWindowHostBindingIdError) {
      fail("identifier", `${path}/bindingId`, error);
    }
    throw error;
  }
  const callbackId = parseId(value.callbackId, "target-delivery", `${path}/callbackId`);
  if (
    callbackId !== deriveTargetResultCallbackId(targetResultId) ||
    !Number.isSafeInteger(value.generation) ||
    value.generation < 1 ||
    value.generation > TARGET_RESULT_CALLBACK_GENERATION_LIMIT
  ) {
    fail("relation", `${path}/callbackId`);
  }
  return Object.freeze({
    callbackId,
    generation: value.generation,
    promptDigest: parseDigest(value.promptDigest, `${path}/promptDigest`),
    issuedAt,
    controllerWindowId: parseId(value.controllerWindowId, "window", `${path}/controllerWindowId`),
    bindingId,
  });
}

/** 实现与测试审查决定摘要形状相同，只有 decision 的取值域不同。 */
function parseReviewDecisionSummary<Decision extends string>(
  value: {
    readonly targetReviewDecisionId: string;
    readonly decisionDigest: string;
    readonly decision: Decision;
    readonly controllerWindowId: string;
    readonly decidedAt: string;
  },
  path: string,
): Readonly<{
  targetReviewDecisionId: WakeflowDurableId<"target-review-decision">;
  decisionDigest: Sha256Digest;
  decision: Decision;
  controllerWindowId: WakeflowDurableId<"window">;
  decidedAt: UtcInstant;
}> {
  let decidedAt: UtcInstant;
  try {
    decidedAt = parseUtcInstant(value.decidedAt, `${path}/decidedAt`);
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) fail("relation", `${path}/decidedAt`, error);
    throw error;
  }
  return Object.freeze({
    targetReviewDecisionId: parseId(
      value.targetReviewDecisionId,
      "target-review-decision",
      `${path}/targetReviewDecisionId`,
    ),
    decisionDigest: parseDigest(value.decisionDigest, `${path}/decisionDigest`),
    decision: value.decision,
    controllerWindowId: parseId(value.controllerWindowId, "window", `${path}/controllerWindowId`),
    decidedAt,
  });
}

/** 状态里记录的审查决定摘要只取决定的身份、摘要、取值、窗口与时间。 */
export function reviewDecisionSummaryOf<
  Decision extends Pick<
    ControllerImplementationReviewDecision | ControllerTestReviewDecision,
    "targetReviewDecisionId" | "decisionDigest" | "decision" | "controllerWindowId" | "decidedAt"
  >,
>(
  decision: Decision,
): Pick<
  Decision,
  "targetReviewDecisionId" | "decisionDigest" | "decision" | "controllerWindowId" | "decidedAt"
> {
  return {
    targetReviewDecisionId: decision.targetReviewDecisionId,
    decisionDigest: decision.decisionDigest,
    decision: decision.decision,
    controllerWindowId: decision.controllerWindowId,
    decidedAt: decision.decidedAt,
  };
}

/**
 * 一个 TargetResult 身份只能被记录一次：任何阶段仍携带结果的目标（已报告、已审查、
 * 返工、阻塞或升级）都占用它的 targetResultId。
 */
export function targetResultIdInUse(targets: readonly object[], targetResultId: string): boolean {
  return targets.some((entry) => {
    const delivery = (
      entry as {
        readonly currentDelivery?: { readonly targetResult?: { readonly targetResultId: string } };
      }
    ).currentDelivery;
    return delivery?.targetResult?.targetResultId === targetResultId;
  });
}

export function reviewPhaseForDecision(
  decision: ControllerImplementationReviewDecision["decision"],
): DemandReviewedTargetPhase {
  return decision === "accept"
    ? "accepted"
    : decision === "rework"
      ? "rework-requested"
      : decision === "escalate"
        ? "escalated"
        : "review-blocked";
}

type DemandTestReviewedPhase =
  | DemandTestAcceptedTargetTaskState["phase"]
  | DemandTestAnotherAttemptRequestedTargetTaskState["phase"]
  | DemandTestProductDefectTargetTaskState["phase"]
  | DemandTestReviewBlockedTargetTaskState["phase"]
  | DemandTestEscalatedTargetTaskState["phase"];

/** 摘要不带升级分类：escalate 的两个 phase 都成立，精确分类由事件与仓库审计核对。 */
function testReviewPhasesForDecision(
  decision: ControllerTestReviewDecision["decision"],
): readonly DemandTestReviewedPhase[] {
  return decision === "accept"
    ? ["test-accepted"]
    : decision === "request-another-attempt"
      ? ["test-another-attempt-requested"]
      : decision === "escalate"
        ? ["test-product-defect", "test-escalated"]
        : ["test-review-blocked"];
}

export function testReviewPhaseForDecision(
  decision: Readonly<ControllerTestReviewDecision>,
): DemandTestReviewedPhase {
  return decision.decision === "escalate"
    ? decision.escalation?.classification === "product-defect"
      ? "test-product-defect"
      : "test-escalated"
    : (testReviewPhasesForDecision(decision.decision)[0] ?? "test-review-blocked");
}

const STEP_ID_PATTERN = /^ts-[1-9][0-9]?$/u;

function compareStepId(left: string, right: string): number {
  return Number(left.slice(3)) - Number(right.slice(3));
}

function parseAcceptanceAnchorIds(values: readonly string[], path: string): readonly string[] {
  if (
    values.length === 0 ||
    new Set(values).size !== values.length ||
    values.some((value) => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value))
  ) {
    fail("relation", path);
  }
  return Object.freeze([...values]);
}

function parseDigest(value: unknown, path: string): Sha256Digest {
  try {
    return parseSha256Digest(value, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("digest", path, error);
    throw error;
  }
}

export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseManagedEvidenceSummaries(
  values: readonly NonNullable<DemandAggregateStateWire["managedEvidence"]>[number][],
): readonly Readonly<DemandManagedEvidenceSummary>[] {
  const result: Readonly<DemandManagedEvidenceSummary>[] = [];
  let previousEvidenceId: string | undefined;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined) fail("schema", `$/managedEvidence/${index}`);
    const path = `$/managedEvidence/${index}`;
    const evidenceId = parseId(value.evidenceId, "evidence", `${path}/evidenceId`);
    if (previousEvidenceId !== undefined && compareText(previousEvidenceId, evidenceId) >= 0) {
      fail("relation", path);
    }
    previousEvidenceId = evidenceId;
    if (!isEvidenceKind(value.kind)) fail("schema", `${path}/kind`);
    result.push(
      Object.freeze({
        evidenceId,
        kind: value.kind,
        manifestDigest: parseDigest(value.manifestDigest, `${path}/manifestDigest`),
        payloadArtifactDigest: parseDigest(
          value.payloadArtifactDigest,
          `${path}/payloadArtifactDigest`,
        ),
      }),
    );
  }
  return Object.freeze(result);
}

/** 待消费的复测记录只引用聚合内的历史 test 目标、其审查决定与缺陷修复授权。 */
function parsePendingTestRetest(
  value: NonNullable<DemandAggregateStateWire["pendingTestRetest"]>,
): Readonly<DemandPendingTestRetest> {
  const path = "$/pendingTestRetest";
  return Object.freeze({
    kind: "product-defect-retest" as const,
    previousTestTarget: Object.freeze({
      targetTaskId: parseId(
        value.previousTestTarget.targetTaskId,
        "target-task",
        `${path}/previousTestTarget/targetTaskId`,
      ),
      taskPackageId: parseId(
        value.previousTestTarget.taskPackageId,
        "task-package",
        `${path}/previousTestTarget/taskPackageId`,
      ),
      taskPackageDigest: parseDigest(
        value.previousTestTarget.taskPackageDigest,
        `${path}/previousTestTarget/taskPackageDigest`,
      ),
    }),
    testReviewDecision: Object.freeze({
      targetReviewDecisionId: parseId(
        value.testReviewDecision.targetReviewDecisionId,
        "target-review-decision",
        `${path}/testReviewDecision/targetReviewDecisionId`,
      ),
      decisionDigest: parseDigest(
        value.testReviewDecision.decisionDigest,
        `${path}/testReviewDecision/decisionDigest`,
      ),
    }),
    productDefectRemediation: Object.freeze({
      productDefectRemediationId: parseId(
        value.productDefectRemediation.productDefectRemediationId,
        "product-defect-remediation",
        `${path}/productDefectRemediation/productDefectRemediationId`,
      ),
      authorizationDigest: parseDigest(
        value.productDefectRemediation.authorizationDigest,
        `${path}/productDefectRemediation/authorizationDigest`,
      ),
    }),
  });
}

function parseProductDefectRemediationSummary(
  value: Readonly<ProductDefectRemediationWire>,
  acceptedDecision: Readonly<DemandTargetReviewDecisionSummary>,
  path: string,
): Readonly<DemandProductDefectRemediationSummary> {
  const parsedStepIds = value.failedStepIds;
  if (
    parsedStepIds.some((stepId, index) => {
      if (!STEP_ID_PATTERN.test(stepId)) return true;
      const previous = index > 0 ? parsedStepIds[index - 1] : undefined;
      return previous !== undefined && compareStepId(previous, stepId) >= 0;
    })
  ) {
    fail("relation", `${path}/failedStepIds`);
  }
  const firstStepId = parsedStepIds[0];
  if (firstStepId === undefined) {
    fail("relation", `${path}/failedStepIds`);
  }
  const failedStepIds: DemandProductDefectRemediationSummary["failedStepIds"] = Object.freeze([
    firstStepId,
    ...parsedStepIds.slice(1),
  ]);
  let authorizedAt: UtcInstant;
  try {
    authorizedAt = parseUtcInstant(value.authorizedAt, `${path}/authorizedAt`);
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) {
      fail("relation", `${path}/authorizedAt`, error);
    }
    throw error;
  }
  // authorizedAt只保留Authorization来源时钟的审计事实；Test Decision、accepted
  // baseline、当前Aggregate状态与Event append CAS共同建立因果关系，不比较墙钟。
  if (
    acceptedDecision.decision !== "accept" ||
    !value.correctionObjective.isWellFormed() ||
    value.correctionObjective.normalize("NFC") !== value.correctionObjective
  ) {
    fail("relation", path);
  }
  return Object.freeze({
    productDefectRemediationId: parseId(
      value.productDefectRemediationId,
      "product-defect-remediation",
      `${path}/productDefectRemediationId`,
    ),
    authorizationDigest: parseDigest(value.authorizationDigest, `${path}/authorizationDigest`),
    testReviewDecisionId: parseId(
      value.testReviewDecisionId,
      "target-review-decision",
      `${path}/testReviewDecisionId`,
    ),
    testReviewDecisionDigest: parseDigest(
      value.testReviewDecisionDigest,
      `${path}/testReviewDecisionDigest`,
    ),
    failedStepIds,
    correctionObjective: value.correctionObjective,
    authorizedAt,
  });
}

function parseTestCurrentDelivery(
  value: Readonly<
    | TestCurrentDeliveryWire
    | TestObservedCurrentDeliveryWire
    | TestResultCurrentDeliveryWire
    | TestReviewedCurrentDeliveryWire
  >,
  path: string,
): Readonly<DemandTestCurrentDeliveryBase> {
  return Object.freeze({
    ...parseCurrentDeliveryBase(value, path),
    testAttemptId: parseId(value.testAttemptId, "test-attempt", `${path}/testAttemptId`),
  });
}

function parseTestAttemptState(
  value: Readonly<TestAttemptStateWire>,
  path: string,
): Readonly<DemandTestAttemptState> {
  let attempt: Readonly<TestExecutionAttempt>;
  try {
    attempt = parseTestExecutionAttempt(value.attempt);
  } catch (error: unknown) {
    if (error instanceof TestExecutionAttemptError) {
      fail("relation", `${path}/attempt`, error);
    }
    throw error;
  }
  let preparedAt: UtcInstant;
  try {
    preparedAt = parseUtcInstant(value.delivery.preparedAt, `${path}/delivery/preparedAt`);
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) {
      fail("relation", `${path}/delivery/preparedAt`, error);
    }
    throw error;
  }
  return Object.freeze({
    attempt,
    delivery: Object.freeze({
      deliveryId: parseId(
        value.delivery.deliveryId,
        "target-delivery",
        `${path}/delivery/deliveryId`,
      ),
      envelopeDigest: parseDigest(value.delivery.envelopeDigest, `${path}/delivery/envelopeDigest`),
      preparedAt,
    }),
  });
}

type TestAttemptTarget = Readonly<{
  readonly targetTaskId: WakeflowDurableId<"target-task">;
  readonly taskPackageId: WakeflowDurableId<"task-package">;
  readonly taskPackageDigest: Sha256Digest;
}>;

/** 这次尝试是这个测试目标的：目标标识与任务包（标识与摘要）都对得上。 */
function attemptBelongsToTarget(
  attempt: Readonly<TestExecutionAttempt>,
  target: TestAttemptTarget,
): boolean {
  return (
    attempt.targetTaskId === target.targetTaskId &&
    attempt.contract.taskPackageId === target.taskPackageId &&
    attempt.contract.taskPackageDigest === target.taskPackageDigest
  );
}

/**
 * 谱系里第二项起的每次尝试都是上一项的重跑：按重跑合同接得上，并且它依据的上一份结果与评审决定在整条
 * 谱系里只被用过这一次。
 */
function assertRerunAttemptFollows(
  attempt: Readonly<TestExecutionAttempt>,
  previous: Readonly<DemandTestAttemptState>,
  attemptPath: string,
  priorResultIds: Set<string>,
  reviewDecisionIds: Set<string>,
): void {
  try {
    assertRerunTestExecutionAttemptFollows(attempt, previous.attempt);
  } catch (error: unknown) {
    if (error instanceof TestExecutionAttemptError) {
      fail("relation", attemptPath, error);
    }
    throw error;
  }
  if (attempt.mode !== "rerun") {
    fail("relation", `${attemptPath}/mode`);
  }
  const resultId = attempt.rerunSource.previousResult.targetResultId;
  const decisionId = attempt.rerunSource.reviewDecision.targetReviewDecisionId;
  if (priorResultIds.has(resultId) || reviewDecisionIds.has(decisionId)) {
    fail("relation", `${attemptPath}/rerunSource`);
  }
  priorResultIds.add(resultId);
  reviewDecisionIds.add(decisionId);
}

function parseTestAttemptLineage(
  values: readonly TestAttemptStateWire[],
  target: TestAttemptTarget,
  path: string,
): DemandTestAttemptLineage {
  if (values.length === 0 || values.length > TEST_ATTEMPT_LIMIT) fail("relation", path);
  const attempts = values.map((value, index) => parseTestAttemptState(value, `${path}/${index}`));
  const first = attempts[0];
  if (first === undefined) fail("relation", path);
  const attemptIds = new Set<string>();
  const deliveryIds = new Set<string>();
  const priorResultIds = new Set<string>();
  const reviewDecisionIds = new Set<string>();
  for (const [index, state] of attempts.entries()) {
    const attempt = state.attempt;
    const previous = index === 0 ? undefined : attempts[index - 1];
    const attemptPath = `${path}/${index}/attempt`;
    if (
      attemptIds.has(attempt.testAttemptId) ||
      !attemptBelongsToTarget(attempt, target) ||
      (index === 0 && (attempt.mode !== "initial" || attempt.ordinal !== 1))
    ) {
      fail("relation", attemptPath);
    }
    attemptIds.add(attempt.testAttemptId);
    if (previous !== undefined) {
      assertRerunAttemptFollows(attempt, previous, attemptPath, priorResultIds, reviewDecisionIds);
    }
    if (deliveryIds.has(state.delivery.deliveryId)) {
      fail("relation", `${path}/${index}/delivery`);
    }
    deliveryIds.add(state.delivery.deliveryId);
  }
  return Object.freeze([first, ...attempts.slice(1)]);
}

type TargetTaskWire = DemandAggregateStateWire["targetTasks"][number];

/** 两种目标共有的四个字段。 */
interface TargetTaskCommon {
  readonly targetTaskId: WakeflowDurableId<"target-task">;
  readonly taskPackageId: WakeflowDurableId<"task-package">;
  readonly taskPackageDigest: Sha256Digest;
  readonly windowId: WakeflowDurableId<"window">;
}

/** 登记当前投递的围栏声明；同一声明在整个状态里出现第二次即失败。 */
type RegisterClaim = (delivery: Readonly<DemandCurrentDeliveryBase>) => void;

/** 一个测试目标的状态：阶段决定当前投递要带哪些事实，谱系的末项必须就是当前投递。 */
type TestReviewedPhase =
  | "test-accepted"
  | "test-another-attempt-requested"
  | "test-product-defect"
  | "test-review-blocked"
  | "test-escalated";

type TestDeliveryBearingPhase =
  | "test-delivery-prepared"
  | "test-host-effect-accepted"
  | "test-host-effect-indeterminate"
  | "test-host-effect-rejected"
  | "test-result-reported"
  | TestReviewedPhase;

function isTestReviewedPhase(phase: string): phase is TestReviewedPhase {
  return (
    phase === "test-accepted" ||
    phase === "test-another-attempt-requested" ||
    phase === "test-product-defect" ||
    phase === "test-review-blocked" ||
    phase === "test-escalated"
  );
}

/** 已经准备过投递的测试阶段：`planned` 之外的全部。 */
function isTestDeliveryBearingPhase(phase: string): phase is TestDeliveryBearingPhase {
  return (
    phase === "test-delivery-prepared" ||
    phase === "test-host-effect-accepted" ||
    phase === "test-host-effect-indeterminate" ||
    phase === "test-host-effect-rejected" ||
    phase === "test-result-reported" ||
    isTestReviewedPhase(phase)
  );
}

/** 已经有评审决定的测试目标：结果与决定都在，决定推出的阶段集合里要有记下的这个阶段。 */
function parseReviewedTestTarget(
  value: TargetTaskWire,
  expectedPhase: TestReviewedPhase,
  path: string,
  common: Readonly<TargetTaskCommon>,
  currentDelivery: ReturnType<typeof parseTestCurrentDelivery>,
  testAttempts: DemandTestAttemptLineage,
  outcome: ReturnType<typeof parseDeliveryOutcomeSummary>,
): Readonly<DemandTargetTaskState> {
  const reviewedDelivery = value.currentDelivery as TestReviewedCurrentDeliveryWire;
  if (
    reviewedDelivery.targetResult === undefined ||
    reviewedDelivery.reviewDecision === undefined ||
    outcome.disposition === "rejected-before-send"
  ) {
    fail("relation", `${path}/currentDelivery`);
  }
  const targetResult = parseTargetResultSummary(
    reviewedDelivery.targetResult,
    `${path}/currentDelivery/targetResult`,
  );
  const reviewDecision = parseReviewDecisionSummary(
    reviewedDelivery.reviewDecision,
    `${path}/currentDelivery/reviewDecision`,
  );
  if (!testReviewPhasesForDecision(reviewDecision.decision).includes(expectedPhase)) {
    fail("relation", `${path}/phase`);
  }
  return Object.freeze({
    ...common,
    workType: "test" as const,
    phase: expectedPhase,
    currentDelivery: Object.freeze({
      ...currentDelivery,
      outcome,
      targetResult,
      reviewDecision,
    }),
    testAttempts,
  });
}

/** 已经有投递结局的测试目标：按阶段再要结果与评审决定；只有结局的那三个阶段由结局的去向推出。 */
function parseObservedTestTarget(
  value: TargetTaskWire,
  path: string,
  common: Readonly<TargetTaskCommon>,
  currentDelivery: ReturnType<typeof parseTestCurrentDelivery>,
  testAttempts: DemandTestAttemptLineage,
): Readonly<DemandTargetTaskState> {
  const observedDelivery = value.currentDelivery as
    | TestObservedCurrentDeliveryWire
    | TestResultCurrentDeliveryWire
    | TestReviewedCurrentDeliveryWire;
  if (observedDelivery.outcome === undefined) {
    fail("relation", `${path}/currentDelivery/outcome`);
  }
  const outcome = parseDeliveryOutcomeSummary(
    observedDelivery.outcome,
    `${path}/currentDelivery/outcome`,
  );
  if (isTestReviewedPhase(value.phase)) {
    return parseReviewedTestTarget(
      value,
      value.phase,
      path,
      common,
      currentDelivery,
      testAttempts,
      outcome,
    );
  } else if (value.phase === "test-result-reported") {
    const resultDelivery = value.currentDelivery as TestResultCurrentDeliveryWire;
    if (
      resultDelivery.targetResult === undefined ||
      outcome.disposition === "rejected-before-send"
    ) {
      fail("relation", `${path}/currentDelivery`);
    }
    return Object.freeze({
      ...common,
      workType: "test" as const,
      phase: "test-result-reported" as const,
      currentDelivery: Object.freeze({
        ...currentDelivery,
        outcome,
        targetResult: parseTargetResultSummary(
          resultDelivery.targetResult,
          `${path}/currentDelivery/targetResult`,
        ),
      }),
      testAttempts,
    });
  } else {
    const expectedPhase =
      outcome.disposition === "accepted"
        ? ("test-host-effect-accepted" as const)
        : outcome.disposition === "indeterminate"
          ? ("test-host-effect-indeterminate" as const)
          : ("test-host-effect-rejected" as const);
    if (value.phase !== expectedPhase) fail("relation", `${path}/phase`);
    return Object.freeze({
      ...common,
      workType: "test" as const,
      phase: expectedPhase,
      currentDelivery: Object.freeze({
        ...currentDelivery,
        outcome,
      }),
      testAttempts,
    });
  }
}

function parseTestTargetTask(
  value: TargetTaskWire,
  path: string,
  common: Readonly<TargetTaskCommon>,
  registerClaim: RegisterClaim,
): Readonly<DemandTargetTaskState> {
  if (value.reworkCount !== undefined) {
    fail("relation", path);
  }
  if (value.phase === "planned") {
    return Object.freeze({
      ...common,
      workType: "test" as const,
      phase: "planned" as const,
    });
  }
  if (
    !isTestDeliveryBearingPhase(value.phase) ||
    value.currentDelivery === undefined ||
    value.testAttempts === undefined
  ) {
    fail("relation", path);
  }
  const currentDelivery = parseTestCurrentDelivery(
    value.currentDelivery as
      | TestCurrentDeliveryWire
      | TestObservedCurrentDeliveryWire
      | TestResultCurrentDeliveryWire
      | TestReviewedCurrentDeliveryWire,
    `${path}/currentDelivery`,
  );
  registerClaim(currentDelivery);
  const testAttempts = parseTestAttemptLineage(value.testAttempts, common, `${path}/testAttempts`);
  const attemptState = lastTestAttempt(testAttempts);
  if (
    attemptState.attempt.targetTaskId !== common.targetTaskId ||
    currentDelivery.testAttemptId !== attemptState.attempt.testAttemptId ||
    currentDelivery.deliveryId !== attemptState.delivery.deliveryId ||
    currentDelivery.envelopeDigest !== attemptState.delivery.envelopeDigest
  ) {
    fail("relation", `${path}/testAttempts`);
  }
  if (value.phase === "test-delivery-prepared") {
    return Object.freeze({
      ...common,
      workType: "test" as const,
      phase: "test-delivery-prepared" as const,
      currentDelivery,
      testAttempts,
    });
  }
  return parseObservedTestTarget(value, path, common, currentDelivery, testAttempts);
}

/** 一个实现目标的状态：阶段沿投递、结局、结果、评审逐层加事实，每一层缺了前一层即失败。 */
/** 实现目标各阶段共有的字段：四个公共字段加仓库、提交期望、验收锚点与返工次数。 */
type ProductTargetBase = TargetTaskCommon & {
  readonly repositoryId: WakeflowDurableId<"repository">;
  readonly commitExpectation: NonNullable<TargetTaskWire["commitExpectation"]>;
  readonly acceptanceAnchorIds: readonly string[];
  readonly reworkCount?: number;
};

/** 已经有评审决定的实现目标：产品缺陷返工要带修复摘要；其余阶段由决定本身推出，必须与记下的阶段一致。 */
function parseReviewedProductTarget(
  value: TargetTaskWire,
  path: string,
  base: Readonly<ProductTargetBase>,
  productCurrentDelivery: ProductCurrentDeliveryWire,
  resultDelivery: DemandResultReportedTargetTaskState["currentDelivery"],
): Readonly<DemandTargetTaskState> {
  if (productCurrentDelivery.reviewDecision === undefined) {
    fail("relation", `${path}/currentDelivery/reviewDecision`);
  }
  const reviewDecision = parseReviewDecisionSummary(
    productCurrentDelivery.reviewDecision,
    `${path}/currentDelivery/reviewDecision`,
  );
  const reviewedDelivery = Object.freeze({
    ...resultDelivery,
    reviewDecision,
  });
  if (value.phase === "product-defect-rework-requested") {
    if (value.productDefectRemediation === undefined) {
      fail("relation", `${path}/productDefectRemediation`);
    }
    return Object.freeze({
      ...base,
      phase: "product-defect-rework-requested" as const,
      currentDelivery: reviewedDelivery,
      productDefectRemediation: parseProductDefectRemediationSummary(
        value.productDefectRemediation,
        reviewDecision,
        `${path}/productDefectRemediation`,
      ),
    });
  }
  const phase = reviewPhaseForDecision(reviewDecision.decision);
  if (value.phase !== phase) fail("relation", `${path}/phase`);
  return Object.freeze({
    ...base,
    phase,
    currentDelivery: reviewedDelivery,
  });
}

/**
 * 已经准备过投递的实现目标：阶段沿投递、结局、结果、评审逐层加事实，每一层缺了前一层即失败。
 */
function parseDeliveredProductTarget(
  value: TargetTaskWire,
  path: string,
  base: Readonly<ProductTargetBase>,
  productCurrentDelivery: ProductCurrentDeliveryWire | undefined,
  registerClaim: RegisterClaim,
): Readonly<DemandTargetTaskState> {
  if (productCurrentDelivery === undefined) {
    fail("relation", `${path}/currentDelivery`);
  }
  const currentDelivery = parseCurrentDeliveryBase(
    productCurrentDelivery,
    `${path}/currentDelivery`,
  );
  registerClaim(currentDelivery);
  if (value.phase === "delivery-prepared") {
    return Object.freeze({
      ...base,
      phase: "delivery-prepared" as const,
      currentDelivery,
    });
  }
  if (productCurrentDelivery.outcome === undefined) {
    fail("relation", `${path}/currentDelivery/outcome`);
  }
  const observedDelivery = Object.freeze({
    ...currentDelivery,
    outcome: parseDeliveryOutcomeSummary(
      productCurrentDelivery.outcome,
      `${path}/currentDelivery/outcome`,
    ),
  });
  if (
    value.phase === "host-effect-accepted" ||
    value.phase === "host-effect-indeterminate" ||
    value.phase === "host-effect-rejected"
  ) {
    const expectedPhase =
      observedDelivery.outcome.disposition === "accepted"
        ? ("host-effect-accepted" as const)
        : observedDelivery.outcome.disposition === "indeterminate"
          ? ("host-effect-indeterminate" as const)
          : ("host-effect-rejected" as const);
    if (value.phase !== expectedPhase) fail("relation", `${path}/phase`);
    return Object.freeze({
      ...base,
      phase: expectedPhase,
      currentDelivery: observedDelivery,
    });
  }
  if (
    productCurrentDelivery.targetResult === undefined ||
    observedDelivery.outcome.disposition === "rejected-before-send"
  ) {
    fail("relation", `${path}/currentDelivery/targetResult`);
  }
  const resultDelivery = Object.freeze({
    ...observedDelivery,
    targetResult: parseTargetResultSummary(
      productCurrentDelivery.targetResult,
      `${path}/currentDelivery/targetResult`,
    ),
  });
  if (value.phase === "result-reported") {
    return Object.freeze({
      ...base,
      phase: "result-reported" as const,
      currentDelivery: resultDelivery,
    });
  }
  return parseReviewedProductTarget(value, path, base, productCurrentDelivery, resultDelivery);
}

function parseProductTargetTask(
  value: TargetTaskWire,
  path: string,
  common: Readonly<TargetTaskCommon>,
  registerClaim: RegisterClaim,
  repositoryIds: Set<string>,
): Readonly<DemandTargetTaskState> {
  if (
    value.repositoryId === undefined ||
    value.commitExpectation === undefined ||
    value.acceptanceAnchorIds === undefined
  ) {
    fail("schema", path);
  }
  const repositoryId = parseId(value.repositoryId, "repository", `${path}/repositoryId`);
  // 一个仓库同时只能有一个未接受且未被替代的实现目标；已接受与被替代的目标是历史。
  if (value.phase !== "accepted" && value.phase !== "superseded") {
    if (repositoryIds.has(repositoryId)) fail("relation", path);
    repositoryIds.add(repositoryId);
  }
  const base: ProductTargetBase = {
    ...common,
    repositoryId,
    commitExpectation: value.commitExpectation,
    acceptanceAnchorIds: parseAcceptanceAnchorIds(
      value.acceptanceAnchorIds,
      `${path}/acceptanceAnchorIds`,
    ),
    ...(value.reworkCount === undefined ? {} : { reworkCount: value.reworkCount }),
  };
  const productCurrentDelivery = value.currentDelivery as ProductCurrentDeliveryWire | undefined;
  if (value.phase === "superseded") {
    if (value.supersededByTargetTaskId === undefined) {
      fail("schema", `${path}/supersededByTargetTaskId`);
    }
    const supersededByTargetTaskId = parseId(
      value.supersededByTargetTaskId,
      "target-task",
      `${path}/supersededByTargetTaskId`,
    );
    if (supersededByTargetTaskId === common.targetTaskId) fail("relation", path);
    return Object.freeze({
      ...base,
      phase: "superseded" as const,
      supersededByTargetTaskId,
    });
  }
  if (value.phase === "planned") {
    return Object.freeze({ ...base, phase: "planned" as const });
  }
  return parseDeliveredProductTarget(value, path, base, productCurrentDelivery, registerClaim);
}

function parseTargetTasks(
  values: readonly TargetTaskWire[],
): readonly Readonly<DemandTargetTaskState>[] {
  const result: Readonly<DemandTargetTaskState>[] = [];
  const packageIds = new Set<string>();
  const repositoryIds = new Set<string>();
  const claimIds = new Set<string>();
  let previousTargetTaskId: string | undefined;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined) fail("schema", `$/targetTasks/${index}`);
    const path = `$/targetTasks/${index}`;
    const targetTaskId = parseId(value.targetTaskId, "target-task", `${path}/targetTaskId`);
    const taskPackageId = parseId(value.taskPackageId, "task-package", `${path}/taskPackageId`);
    if (
      (previousTargetTaskId !== undefined &&
        compareText(previousTargetTaskId, targetTaskId) >= 0) ||
      packageIds.has(taskPackageId)
    ) {
      fail("relation", path);
    }
    previousTargetTaskId = targetTaskId;
    packageIds.add(taskPackageId);
    const common = {
      targetTaskId,
      taskPackageId,
      taskPackageDigest: parseDigest(value.taskPackageDigest, `${path}/taskPackageDigest`),
      windowId: parseId(value.windowId, "window", `${path}/windowId`),
    };
    // 每个当前投递的围栏声明在整个状态里唯一：同一声明不能同时服务两个目标。
    const registerClaim = (delivery: Readonly<DemandCurrentDeliveryBase>) => {
      if (claimIds.has(delivery.fence.claimId)) {
        fail("relation", `${path}/currentDelivery/fence/claimId`);
      }
      claimIds.add(delivery.fence.claimId);
    };
    result.push(
      value.workType === "test"
        ? parseTestTargetTask(value, path, common, registerClaim)
        : parseProductTargetTask(value, path, common, registerClaim, repositoryIds),
    );
  }
  return Object.freeze(result);
}

/** 待复测记录指的那一代测试目标：停在产品缺陷、任务包与那次升级的评审决定都对得上。 */
function isRetestSource(
  target: ReturnType<typeof currentTestTargetsOf>[number],
  pendingTestRetest: Readonly<DemandPendingTestRetest>,
): boolean {
  return (
    target.phase === "test-product-defect" &&
    target.targetTaskId === pendingTestRetest.previousTestTarget.targetTaskId &&
    target.taskPackageId === pendingTestRetest.previousTestTarget.taskPackageId &&
    target.taskPackageDigest === pendingTestRetest.previousTestTarget.taskPackageDigest &&
    target.currentDelivery.reviewDecision.targetReviewDecisionId ===
      pendingTestRetest.testReviewDecision.targetReviewDecisionId &&
    target.currentDelivery.reviewDecision.decisionDigest ===
      pendingTestRetest.testReviewDecision.decisionDigest &&
    target.currentDelivery.reviewDecision.decision === "escalate"
  );
}

/**
 * 目标之间与目标同生命周期之间的三条关系：未终结的测试目标至多一个，并且只能站在全部已接受的实现基线
 * 上；待复测记录要有它指的那一代缺陷目标，且此时没有未终结的测试目标；completed 的 Demand 没有未了结的
 * 实现与测试。
 */
function assertTargetRelations(
  lifecycle: DemandAggregateStateWire["lifecycle"],
  targetTasks: readonly Readonly<DemandTargetTaskState>[],
  continuation: Readonly<DemandContinuationState> | undefined,
  pendingTestRetest: Readonly<DemandPendingTestRetest> | undefined,
): void {
  const implementationTargets = targetTasks.filter((target) => target.workType !== "test");
  const liveImplementationTargets = implementationTargets.filter(
    (target) => target.phase !== "superseded",
  );
  const testTargets = currentTestTargetsOf({ targetTasks, continuation });
  // 同一时间只有一个未终结的 test 目标（能力卡 5 Q4）；历史代际只能停在 test-product-defect。
  const openTestTargets = testTargets.filter((target) => target.phase !== "test-product-defect");
  // 未终结的 test 目标只能站在全部已接受的实现基线上；缺陷代际之后的产品返工不受此限。
  if (
    openTestTargets.length > 1 ||
    (openTestTargets.length === 1 &&
      (liveImplementationTargets.length === 0 ||
        liveImplementationTargets.some((target) => target.phase !== "accepted")))
  ) {
    fail("relation", "$/targetTasks");
  }
  if (
    pendingTestRetest !== undefined &&
    (openTestTargets.length !== 0 ||
      !testTargets.some((target) => isRetestSource(target, pendingTestRetest)))
  ) {
    fail("relation", "$/pendingTestRetest");
  }
  if (
    lifecycle === "completed" &&
    (pendingTestRetest !== undefined ||
      // research（not-applicable）零实现目标也能 completed（§13.94 D8）；实现目标数量由完成转换按测试模式把关。
      liveImplementationTargets.some((target) => target.phase !== "accepted") ||
      (testTargets.length > 0 &&
        (openTestTargets.length !== 1 || openTestTargets[0]?.phase !== "test-accepted")))
  ) {
    fail("relation", "$/lifecycle");
  }
}

function normalizeState(wire: Readonly<DemandAggregateStateWire>): Readonly<DemandAggregateState> {
  const targetTasks = parseTargetTasks(wire.targetTasks);
  const managedEvidence =
    wire.managedEvidence === undefined
      ? undefined
      : parseManagedEvidenceSummaries(wire.managedEvidence);
  const pendingTestRetest =
    wire.pendingTestRetest === undefined
      ? undefined
      : parsePendingTestRetest(wire.pendingTestRetest);
  const awaitingDecision =
    wire.awaitingDecision === undefined
      ? undefined
      : parseAwaitingDecision(wire.awaitingDecision, wire.lifecycle);
  const continuation =
    wire.continuation === undefined
      ? undefined
      : parseContinuationState(wire.continuation, targetTasks);
  const supplements =
    wire.supplements === undefined ? undefined : parseSupplementPackages(wire.supplements);
  assertTargetRelations(wire.lifecycle, targetTasks, continuation, pendingTestRetest);
  return Object.freeze({
    artifactKind: DEMAND_AGGREGATE_STATE_ARTIFACT_KIND,
    schemaVersion: DEMAND_AGGREGATE_STATE_SCHEMA_VERSION,
    demandId: parseId(wire.demandId, "demand", "$/demandId"),
    authorityDigest: parseDigest(wire.authorityDigest, "$/authorityDigest"),
    lifecycle: wire.lifecycle,
    targetTasks,
    ...(managedEvidence === undefined ? {} : { managedEvidence }),
    ...(pendingTestRetest === undefined ? {} : { pendingTestRetest }),
    ...(awaitingDecision === undefined ? {} : { awaitingDecision }),
    ...(continuation === undefined ? {} : { continuation }),
    ...(supplements === undefined ? {} : { supplements }),
  });
}

/** 并入的 supplement 包不重复：同一个包、同一份记录只并入一次。 */
function parseSupplementPackages(
  value: NonNullable<DemandAggregateStateWire["supplements"]>,
): readonly Readonly<DemandSupplementPackage>[] {
  const parsed = value.map((entry, index) => {
    try {
      const lineage = parseRequirementLineageReference({
        artifactKind: "wakeflow-requirement-lineage",
        schemaVersion: 1,
        ...entry,
      });
      return Object.freeze({
        requirementId: lineage.requirementId,
        recordRef: lineage.recordRef,
        recordDigest: lineage.recordDigest,
      });
    } catch (error: unknown) {
      if (error instanceof RequirementLineageError)
        fail("relation", `$/supplements/${index}`, error);
      throw error;
    }
  });
  if (
    new Set(parsed.map((entry) => entry.requirementId)).size !== parsed.length ||
    new Set(parsed.map((entry) => entry.recordDigest)).size !== parsed.length
  ) {
    fail("relation", "$/supplements");
  }
  return Object.freeze(parsed);
}

/** 升级只在活动 Demand 上等待回答；终态不能携带未回答的升级。 */
function parseAwaitingDecision(
  value: NonNullable<DemandAggregateStateWire["awaitingDecision"]>,
  lifecycle: DemandLifecycle,
): Readonly<DemandAwaitingDecision> {
  if (lifecycle !== "active") fail("relation", "$/awaitingDecision");
  const escalationEventId = parseId(
    value.escalationEventId,
    "demand-event",
    "$/awaitingDecision/escalationEventId",
  );
  parseId(value.source.targetTaskId, "target-task", "$/awaitingDecision/source/targetTaskId");
  return Object.freeze({
    escalationEventId,
    issue: value.issue,
    source: Object.freeze({ ...value.source }),
  });
}

/** 历史 test 目标必须是状态里已终结（test-accepted 或 test-product-defect）的 test 目标。 */
function parseContinuationState(
  value: NonNullable<DemandAggregateStateWire["continuation"]>,
  targetTasks: readonly Readonly<DemandTargetTaskState>[],
): Readonly<DemandContinuationState> {
  const historical = value.historicalTestTargetIds;
  if (
    historical?.some((targetTaskId) => {
      const target = targetTasks.find((entry) => entry.targetTaskId === targetTaskId);
      return (
        target === undefined ||
        (target.phase !== "test-accepted" && target.phase !== "test-product-defect")
      );
    })
  ) {
    fail("relation", "$/continuation/historicalTestTargetIds");
  }
  return Object.freeze({
    eventId: parseId(value.eventId, "demand-event", "$/continuation/eventId"),
    kind: value.kind,
    planningRequired: value.planningRequired,
    ...(historical === undefined
      ? {}
      : {
          historicalTestTargetIds: Object.freeze(
            historical.map((targetTaskId, index) =>
              parseId(
                targetTaskId,
                "target-task",
                `$/continuation/historicalTestTargetIds/${index}`,
              ),
            ),
          ),
        }),
  });
}

export function parseDemandAggregateState(value: unknown): Readonly<DemandAggregateState> {
  let json: JsonValue;
  try {
    json = parseJsonValue(value, "$state");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("json", error.path, error);
    throw error;
  }
  const result = validateWire(json);
  if (!result.ok) fail("schema", result.path);
  return normalizeState(result.value);
}

/** `publication.demand-published.v1` 唯一允许创建的初始业务状态。 */
export function createInitialDemandAggregateState(
  demandId: WakeflowDurableId<"demand">,
  authorityDigest: Sha256Digest,
): Readonly<DemandAggregateState> {
  return parseDemandAggregateState({
    artifactKind: DEMAND_AGGREGATE_STATE_ARTIFACT_KIND,
    schemaVersion: DEMAND_AGGREGATE_STATE_SCHEMA_VERSION,
    demandId,
    authorityDigest,
    lifecycle: "active",
    targetTasks: [],
  });
}

/** 状态是本编解码签发或读回的类型化值；规范 JSON 摘要自己做 JSON 准入。 */
export function computeDemandAggregateStateDigest(
  state: Readonly<DemandAggregateState>,
): Sha256Digest {
  return computeCanonicalJsonSha256Digest(state);
}
