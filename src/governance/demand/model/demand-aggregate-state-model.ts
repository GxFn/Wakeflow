import type { WakeflowDemandAggregateState as DemandAggregateStateWire } from "../../../contracts/generated/governance/demand/demand-aggregate-state.generated.js";
import type { WakeflowDurableId } from "../../../contracts/identity/wakeflow-durable-id.js";
import type { EvidenceKind } from "../../../contracts/vocabulary/evidence-kinds.js";
import type { Sha256Digest } from "../../../foundation/crypto/sha256.js";
import type { UtcInstant } from "../../../foundation/time/utc-instant.js";
import type { WakeflowWindowHostBindingId } from "../../../workspace/window-runtime/wakeflow-window-host-binding-id.js";
import type { WakeflowWorkspaceHostId } from "../../../workspace/workspace-host-resource-profile.js";
import type {
  DeliveryDisposition,
  DeliveryEvidenceKind,
  DeliveryReadbackStatus,
} from "../../delivery/delivery-outcome.js";
import type { TargetResult } from "../../result/target-result.js";
import type { ControllerImplementationReviewDecision } from "../../review/controller-implementation-review-decision.js";
import type { ControllerTestReviewDecision } from "../../review/controller-test-review-decision.js";
import type { TaskPackageCommitExpectation } from "../../tasking/task-package.js";
import type { TestExecutionAttempt } from "../../testing/test-execution-attempt.js";
import type { RequirementLineageReference } from "./requirement-lineage.js";

/**
 * Wakeflow Governance / Demand Model / Aggregate Model：聚合状态的形状：每个阶段的目标状态、投递与结果的摘要、聚合错误。只有类型、错误与两个不读状态以外任何东西的小函数。
 *
 * 从 `demand-aggregate-state.ts` 按关注点分出来的一段（open-items L5，gate-log §13.255）；对外的入口仍是那个
 * 文件，它只转出别处在用的公开名字。
 */

export const DEMAND_AGGREGATE_STATE_ARTIFACT_KIND = "wakeflow-demand-aggregate-state" as const;

export const DEMAND_AGGREGATE_STATE_SCHEMA_VERSION = 1 as const;

export type DemandLifecycle = "active" | "cancelled" | "completed";

interface DemandImplementationTargetTaskStateBase {
  readonly targetTaskId: WakeflowDurableId<"target-task">;
  readonly taskPackageId: WakeflowDurableId<"task-package">;
  readonly taskPackageDigest: Sha256Digest;
  /** 旧implementation状态不写入判别字段，以保持已有Event的state digest。 */
  readonly workType?: never;
  readonly repositoryId: WakeflowDurableId<"repository">;
  readonly windowId: WakeflowDurableId<"window">;
  readonly commitExpectation: TaskPackageCommitExpectation;
  readonly acceptanceAnchorIds: readonly string[];
  /** 已被评审判为 rework 的次数；从未 rework 的目标不写入，保持既有 state digest。 */
  readonly reworkCount?: number;
  /** 评审前被 `supersedes` 导入取代的结果（R5）；从未取代的目标不写入，保持既有 state digest。 */
  readonly supersededTargetResultIds?: readonly WakeflowDurableId<"target-result">[];
}

export interface DemandPlannedTargetTaskState extends DemandImplementationTargetTaskStateBase {
  readonly phase: "planned";
}

export interface DemandDeliveryFenceSummary {
  readonly claimId: WakeflowDurableId<"work-claim">;
  readonly claimDigest: Sha256Digest;
  readonly streamRevision: number;
}

/** 当前投递的最小摘要：信封身份、代际、绑定代际与围栏；prompt 全文留在事件里。 */
export interface DemandCurrentDeliveryBase {
  readonly deliveryId: WakeflowDurableId<"target-delivery">;
  readonly envelopeDigest: Sha256Digest;
  readonly promptDigest: Sha256Digest;
  readonly generation: number;
  readonly hostId: WakeflowWorkspaceHostId;
  readonly bindingId: WakeflowWindowHostBindingId;
  readonly fence: Readonly<DemandDeliveryFenceSummary>;
}

export interface DemandDeliveryPreparedTargetTaskState
  extends DemandImplementationTargetTaskStateBase {
  readonly phase: "delivery-prepared";
  readonly currentDelivery: Readonly<DemandCurrentDeliveryBase>;
}

export interface DemandDeliveryOutcomeSummary {
  readonly outcomeDigest: Sha256Digest;
  readonly disposition: DeliveryDisposition;
  readonly evidenceKind: DeliveryEvidenceKind;
  readonly readbackStatus: DeliveryReadbackStatus;
  readonly claimHandling: "retain" | "release-authorized";
  readonly observedAt: UtcInstant;
}

interface DemandObservedHostEffectTargetTaskStateBase
  extends DemandImplementationTargetTaskStateBase {
  readonly currentDelivery: Readonly<
    DemandCurrentDeliveryBase & {
      readonly outcome: Readonly<DemandDeliveryOutcomeSummary>;
    }
  >;
}

export interface DemandHostEffectAcceptedTargetTaskState
  extends DemandObservedHostEffectTargetTaskStateBase {
  readonly phase: "host-effect-accepted";
}

export interface DemandHostEffectIndeterminateTargetTaskState
  extends DemandObservedHostEffectTargetTaskStateBase {
  readonly phase: "host-effect-indeterminate";
}

export interface DemandHostEffectRejectedTargetTaskState
  extends DemandObservedHostEffectTargetTaskStateBase {
  readonly phase: "host-effect-rejected";
}

/** 结果回调的当前代际：落地由读侧从 Controller 会话记录派生，这里只记签发事实。 */
export interface DemandTargetResultCallbackSummary {
  readonly callbackId: WakeflowDurableId<"target-delivery">;
  readonly generation: number;
  readonly promptDigest: Sha256Digest;
  readonly issuedAt: UtcInstant;
  readonly controllerWindowId: WakeflowDurableId<"window">;
  readonly bindingId: WakeflowWindowHostBindingId;
}

export interface DemandTargetResultSummary {
  readonly targetResultId: WakeflowDurableId<"target-result">;
  readonly resultDigest: Sha256Digest;
  readonly outcome: TargetResult["report"]["outcome"];
  readonly reportedAt: UtcInstant;
  readonly claimHandling: "release-authorized";
  readonly callback: Readonly<DemandTargetResultCallbackSummary>;
}

export interface DemandResultReportedTargetTaskState
  extends DemandImplementationTargetTaskStateBase {
  readonly phase: "result-reported";
  readonly currentDelivery: Readonly<
    DemandCurrentDeliveryBase & {
      readonly outcome: Readonly<DemandDeliveryOutcomeSummary>;
      readonly targetResult: Readonly<DemandTargetResultSummary>;
    }
  >;
}

export interface DemandTargetReviewDecisionSummary {
  readonly targetReviewDecisionId: WakeflowDurableId<"target-review-decision">;
  readonly decisionDigest: Sha256Digest;
  readonly decision: ControllerImplementationReviewDecision["decision"];
  readonly controllerWindowId: WakeflowDurableId<"window">;
  readonly decidedAt: UtcInstant;
}

interface DemandReviewedTargetTaskStateBase extends DemandImplementationTargetTaskStateBase {
  readonly currentDelivery: Readonly<
    DemandCurrentDeliveryBase & {
      readonly outcome: Readonly<DemandDeliveryOutcomeSummary>;
      readonly targetResult: Readonly<DemandTargetResultSummary>;
      readonly reviewDecision: Readonly<DemandTargetReviewDecisionSummary>;
    }
  >;
}

export interface DemandAcceptedTargetTaskState extends DemandReviewedTargetTaskStateBase {
  readonly phase: "accepted";
}

export interface DemandProductDefectRemediationSummary {
  readonly productDefectRemediationId: WakeflowDurableId<"product-defect-remediation">;
  readonly authorizationDigest: Sha256Digest;
  readonly testReviewDecisionId: WakeflowDurableId<"target-review-decision">;
  readonly testReviewDecisionDigest: Sha256Digest;
  readonly failedStepIds: readonly [string, ...string[]];
  readonly correctionObjective: string;
  readonly authorizedAt: UtcInstant;
}

export interface DemandProductDefectReworkRequestedTargetTaskState
  extends DemandReviewedTargetTaskStateBase {
  readonly phase: "product-defect-rework-requested";
  readonly productDefectRemediation: Readonly<DemandProductDefectRemediationSummary>;
}

export interface DemandReworkRequestedTargetTaskState extends DemandReviewedTargetTaskStateBase {
  readonly phase: "rework-requested";
}

/** 实现评审升级给用户；用户回答后由 Controller 带 resumption 再决定（§13.87 D4）。 */
export interface DemandEscalatedTargetTaskState extends DemandReviewedTargetTaskStateBase {
  readonly phase: "escalated";
}

export interface DemandReviewBlockedTargetTaskState extends DemandReviewedTargetTaskStateBase {
  readonly phase: "review-blocked";
}

/** 被替代的实现目标：终态，不再参与路由、完成与仓库独占；历史在事件流里。 */
export interface DemandSupersededTargetTaskState extends DemandImplementationTargetTaskStateBase {
  readonly phase: "superseded";
  readonly supersededByTargetTaskId: WakeflowDurableId<"target-task">;
}

export type DemandReviewedTargetPhase =
  | DemandAcceptedTargetTaskState["phase"]
  | DemandReworkRequestedTargetTaskState["phase"]
  | DemandEscalatedTargetTaskState["phase"]
  | DemandReviewBlockedTargetTaskState["phase"];

export type DemandTargetTaskState =
  | DemandPlannedTargetTaskState
  | DemandDeliveryPreparedTargetTaskState
  | DemandHostEffectAcceptedTargetTaskState
  | DemandHostEffectIndeterminateTargetTaskState
  | DemandHostEffectRejectedTargetTaskState
  | DemandResultReportedTargetTaskState
  | DemandAcceptedTargetTaskState
  | DemandProductDefectReworkRequestedTargetTaskState
  | DemandReworkRequestedTargetTaskState
  | DemandEscalatedTargetTaskState
  | DemandReviewBlockedTargetTaskState
  | DemandSupersededTargetTaskState
  | DemandTestPlannedTargetTaskState
  | DemandTestDeliveryPreparedTargetTaskState
  | DemandTestHostEffectAcceptedTargetTaskState
  | DemandTestHostEffectIndeterminateTargetTaskState
  | DemandTestHostEffectRejectedTargetTaskState
  | DemandTestResultReportedTargetTaskState
  | DemandTestAcceptedTargetTaskState
  | DemandTestAnotherAttemptRequestedTargetTaskState
  | DemandTestProductDefectTargetTaskState
  | DemandTestReviewBlockedTargetTaskState
  | DemandTestEscalatedTargetTaskState;

interface DemandTestTargetTaskStateBase {
  readonly targetTaskId: WakeflowDurableId<"target-task">;
  readonly taskPackageId: WakeflowDurableId<"task-package">;
  readonly taskPackageDigest: Sha256Digest;
  readonly workType: "test";
  readonly windowId: WakeflowDurableId<"window">;
  /** 评审前被 `supersedes` 导入取代的结果（R5）；从未取代的目标不写入。 */
  readonly supersededTargetResultIds?: readonly WakeflowDurableId<"target-result">[];
}

export interface DemandTestPlannedTargetTaskState extends DemandTestTargetTaskStateBase {
  readonly phase: "planned";
}

export interface DemandTestAttemptDeliverySummary {
  readonly deliveryId: WakeflowDurableId<"target-delivery">;
  readonly envelopeDigest: Sha256Digest;
  readonly preparedAt: UtcInstant;
}

export interface DemandTestAttemptState {
  readonly attempt: Readonly<TestExecutionAttempt>;
  readonly delivery: Readonly<DemandTestAttemptDeliverySummary>;
}

export type DemandTestAttemptLineage = readonly [
  Readonly<DemandTestAttemptState>,
  ...Readonly<DemandTestAttemptState>[],
];

/** 谱系是非空元组，最后一项必然存在；`Array.prototype.at` 不做元组推断，所以在这里收窄一次。 */
export function lastTestAttempt(
  lineage: DemandTestAttemptLineage,
): Readonly<DemandTestAttemptState> {
  return lineage[lineage.length - 1] ?? lineage[0];
}

export interface DemandTestCurrentDeliveryBase extends DemandCurrentDeliveryBase {
  readonly testAttemptId: WakeflowDurableId<"test-attempt">;
}

export interface DemandTestDeliveryPreparedTargetTaskState extends DemandTestTargetTaskStateBase {
  readonly phase: "test-delivery-prepared";
  readonly currentDelivery: Readonly<DemandTestCurrentDeliveryBase>;
  readonly testAttempts: DemandTestAttemptLineage;
}

interface DemandTestObservedHostEffectTargetTaskStateBase extends DemandTestTargetTaskStateBase {
  readonly currentDelivery: Readonly<
    DemandTestCurrentDeliveryBase & {
      readonly outcome: Readonly<DemandDeliveryOutcomeSummary>;
    }
  >;
  readonly testAttempts: DemandTestAttemptLineage;
}

export interface DemandTestHostEffectAcceptedTargetTaskState
  extends DemandTestObservedHostEffectTargetTaskStateBase {
  readonly phase: "test-host-effect-accepted";
}

export interface DemandTestHostEffectIndeterminateTargetTaskState
  extends DemandTestObservedHostEffectTargetTaskStateBase {
  readonly phase: "test-host-effect-indeterminate";
}

export interface DemandTestHostEffectRejectedTargetTaskState
  extends DemandTestObservedHostEffectTargetTaskStateBase {
  readonly phase: "test-host-effect-rejected";
}

export interface DemandTestResultReportedTargetTaskState
  extends DemandTestObservedHostEffectTargetTaskStateBase {
  readonly phase: "test-result-reported";
  readonly currentDelivery: Readonly<
    DemandTestCurrentDeliveryBase & {
      readonly outcome: Readonly<DemandDeliveryOutcomeSummary>;
      readonly targetResult: Readonly<DemandTargetResultSummary>;
    }
  >;
}

export interface DemandTestReviewDecisionSummary {
  readonly targetReviewDecisionId: WakeflowDurableId<"target-review-decision">;
  readonly decisionDigest: Sha256Digest;
  readonly decision: ControllerTestReviewDecision["decision"];
  readonly controllerWindowId: WakeflowDurableId<"window">;
  readonly decidedAt: UtcInstant;
}

interface DemandTestReviewedTargetTaskStateBase
  extends DemandTestObservedHostEffectTargetTaskStateBase {
  readonly currentDelivery: Readonly<
    DemandTestCurrentDeliveryBase & {
      readonly outcome: Readonly<DemandDeliveryOutcomeSummary>;
      readonly targetResult: Readonly<DemandTargetResultSummary>;
      readonly reviewDecision: Readonly<DemandTestReviewDecisionSummary>;
    }
  >;
}

export interface DemandTestAcceptedTargetTaskState extends DemandTestReviewedTargetTaskStateBase {
  readonly phase: "test-accepted";
}

export interface DemandTestAnotherAttemptRequestedTargetTaskState
  extends DemandTestReviewedTargetTaskStateBase {
  readonly phase: "test-another-attempt-requested";
}

export interface DemandTestProductDefectTargetTaskState
  extends DemandTestReviewedTargetTaskStateBase {
  readonly phase: "test-product-defect";
}

export interface DemandTestReviewBlockedTargetTaskState
  extends DemandTestReviewedTargetTaskStateBase {
  readonly phase: "test-review-blocked";
}

/** 测试评审 `escalate{needs-decision}`：升级给用户，回答后带 resumption 再决定。 */
export interface DemandTestEscalatedTargetTaskState extends DemandTestReviewedTargetTaskStateBase {
  readonly phase: "test-escalated";
}

export interface DemandAggregateState {
  readonly artifactKind: typeof DEMAND_AGGREGATE_STATE_ARTIFACT_KIND;
  readonly schemaVersion: typeof DEMAND_AGGREGATE_STATE_SCHEMA_VERSION;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly authorityDigest: Sha256Digest;
  readonly lifecycle: DemandLifecycle;
  readonly targetTasks: readonly Readonly<DemandTargetTaskState>[];
  /** 已由Event记录的Managed Evidence最小selector；完整Manifest不复制到Aggregate。 */
  readonly managedEvidence?: readonly Readonly<DemandManagedEvidenceSummary>[];
  /** 已获Controller授权、尚未由 retest 谱系的 test 任务包消费的一次产品缺陷复测。 */
  readonly pendingTestRetest?: Readonly<DemandPendingTestRetest>;
  /** 一次尚未得到用户回答的升级；存在时路由为 awaiting-decision（ADR-0012 D5）。 */
  readonly awaitingDecision?: Readonly<DemandAwaitingDecision>;
  /** 最近一次从归档重开的续接谱系；`planningRequired` 直到新任务包规划完成。 */
  readonly continuation?: Readonly<DemandContinuationState>;
  /**
   * 历次 requirement-supplement 续接并入的 supplement 需求包（Q7 裁决），按并入顺序。它们的验收标准与源需求的
   * 一起构成验收全集；没有并入过时不写入，既有 state digest 不变。
   */
  readonly supplements?: readonly Readonly<DemandSupplementPackage>[];
}

/** 并入 Demand 的一个 supplement 需求包：标识、Ledger 记录引用与记录摘要（与源需求的谱系引用同形）。 */
export type DemandSupplementPackage = Pick<
  RequirementLineageReference,
  "requirementId" | "recordRef" | "recordDigest"
>;

export interface DemandAwaitingDecision {
  readonly escalationEventId: WakeflowDurableId<"demand-event">;
  readonly issue: string;
  readonly source: NonNullable<DemandAggregateStateWire["awaitingDecision"]>["source"];
}

export type DemandContinuationKind = "optimization" | "requirement-supplement" | "verified-bug";

export interface DemandContinuationState {
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly kind: DemandContinuationKind;
  readonly planningRequired: boolean;
  /** 续接那一刻已存在的 test 目标：上一轮的历史，不再算未终结或当前的测试代际。 */
  readonly historicalTestTargetIds?: readonly WakeflowDurableId<"target-task">[];
}

/** 当前测试代际的 test 目标：排除续接前留下的历史 test 目标。 */
export function currentTestTargetsOf(
  state: Readonly<{
    readonly targetTasks: readonly Readonly<DemandTargetTaskState>[];
    readonly continuation?: Readonly<DemandContinuationState> | undefined;
  }>,
): readonly Readonly<DemandTargetTaskState>[] {
  const historical = state.continuation?.historicalTestTargetIds ?? [];
  return state.targetTasks.filter(
    (target) => target.workType === "test" && !historical.includes(target.targetTaskId),
  );
}

export interface DemandManagedEvidenceSummary {
  readonly evidenceId: WakeflowDurableId<"evidence">;
  readonly kind: EvidenceKind;
  readonly manifestDigest: Sha256Digest;
  readonly payloadArtifactDigest: Sha256Digest;
}

export interface DemandPendingTestRetest {
  readonly kind: "product-defect-retest";
  readonly previousTestTarget: Readonly<{
    readonly targetTaskId: WakeflowDurableId<"target-task">;
    readonly taskPackageId: WakeflowDurableId<"task-package">;
    readonly taskPackageDigest: Sha256Digest;
  }>;
  readonly testReviewDecision: Readonly<{
    readonly targetReviewDecisionId: WakeflowDurableId<"target-review-decision">;
    readonly decisionDigest: Sha256Digest;
  }>;
  readonly productDefectRemediation: Readonly<{
    readonly productDefectRemediationId: WakeflowDurableId<"product-defect-remediation">;
    readonly authorizationDigest: Sha256Digest;
  }>;
}

export type DemandAggregateStateErrorReason =
  | "json"
  | "schema"
  | "identifier"
  | "digest"
  | "task-package"
  | "delivery-envelope"
  | "delivery-outcome"
  | "delivery-rearm"
  | "target-result"
  | "controller-review-decision"
  | "controller-product-defect-remediation-authorization"
  | "target-result-callback"
  | "managed-evidence-manifest"
  | "relation"
  | "transition";

const ERROR_MESSAGES = {
  json: "Demand aggregate state is not passive JSON data.",
  schema: "Demand aggregate state does not satisfy its portable Schema.",
  identifier: "Demand aggregate state contains an invalid Demand identity.",
  digest: "Demand aggregate state contains an invalid digest.",
  "task-package": "Demand aggregate state transition contains an invalid TaskPackage.",
  "delivery-envelope": "Demand aggregate state transition contains an invalid Delivery Envelope.",
  "delivery-outcome": "Demand aggregate state transition contains an invalid Delivery Outcome.",
  "delivery-rearm": "Demand aggregate state transition contains an invalid Delivery Rearm.",
  "target-result": "Demand aggregate state transition contains an invalid TargetResult.",
  "controller-review-decision":
    "Demand aggregate state transition contains an invalid Controller Review Decision.",
  "controller-product-defect-remediation-authorization":
    "Demand aggregate state transition contains an invalid Controller Product Defect Remediation Authorization.",
  "target-result-callback":
    "Demand aggregate state transition contains an invalid Target Result callback record.",
  "managed-evidence-manifest":
    "Demand aggregate state transition contains an invalid Managed Evidence Manifest.",
  relation: "Demand aggregate target task summaries are inconsistent.",
  transition: "Demand aggregate lifecycle transition is not admitted.",
} as const satisfies Readonly<Record<DemandAggregateStateErrorReason, string>>;

export class DemandAggregateStateError extends Error {
  override readonly name = "DemandAggregateStateError";
  readonly code = "wakeflow-demand-aggregate-state" as const;
  readonly reason: DemandAggregateStateErrorReason;
  readonly path: string;

  constructor(reason: DemandAggregateStateErrorReason, path: string, options?: ErrorOptions) {
    super(ERROR_MESSAGES[reason], options);
    this.reason = reason;
    this.path = path;
  }
}

export function fail(
  reason: DemandAggregateStateErrorReason,
  path: string,
  cause?: unknown,
): never {
  throw new DemandAggregateStateError(reason, path, cause === undefined ? undefined : { cause });
}
