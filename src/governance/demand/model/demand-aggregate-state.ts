import type {
  WakeflowDemandAggregateState as DemandAggregateStateWire,
  CurrentDelivery as ProductCurrentDeliveryWire,
  TestCurrentDelivery as TestCurrentDeliveryWire,
  TestObservedCurrentDelivery as TestObservedCurrentDeliveryWire,
  TestResultCurrentDelivery as TestResultCurrentDeliveryWire,
  TestReviewedCurrentDelivery as TestReviewedCurrentDeliveryWire,
  TestAttemptState as TestAttemptStateWire,
  ProductDefectRemediation as ProductDefectRemediationWire,
} from "../../../contracts/generated/governance/demand/demand-aggregate-state.generated.js";
import { WAKEFLOW_DEMAND_AGGREGATE_STATE_SCHEMA } from "../../../contracts/generated/governance/demand/demand-aggregate-state.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../../contracts/generated/foundation/utc-instant.generated.js";
import { WAKEFLOW_TEST_EXECUTION_ATTEMPT_SCHEMA } from "../../../contracts/generated/governance/testing/test-execution-attempt.generated.js";
import { WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA } from "../../../contracts/generated/governance/ledger/ledger-authority-member-reference.generated.js";
import { computeCanonicalJsonSha256Digest } from "../../../foundation/crypto/canonical-json-sha256.js";
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
import { createRuntimeJsonSchemaValidator } from "../../../foundation/schema/runtime-json-schema.js";
import {
  parseUtcInstant,
  UtcInstantError,
  type UtcInstant,
} from "../../../foundation/time/utc-instant.js";
import {
  parseManagedEvidenceManifest,
  ManagedEvidenceManifestError,
  type ManagedEvidenceManifest,
} from "../../evidence/managed-evidence-manifest.js";
import {
  computeTaskPackageDigest,
  parseTaskPackage,
  TaskPackageError,
  type TaskPackage,
  type TaskPackageCommitExpectation,
} from "../../tasking/task-package.js";
import {
  deliveryPurpose,
  DeliveryEnvelopeError,
  parseDeliveryEnvelope,
  type DeliveryEnvelope,
} from "../../delivery/delivery-envelope.js";
import {
  DeliveryOutcomeError,
  parseDeliveryOutcome,
  type DeliveryDisposition,
  type DeliveryEvidenceKind,
  type DeliveryOutcome,
  type DeliveryReadbackStatus,
} from "../../delivery/delivery-outcome.js";
import {
  DELIVERY_REARM_LIMIT,
  DeliveryRearmError,
  parseDeliveryRearm,
  type DeliveryRearm,
} from "../../delivery/delivery-rearm.js";
import {
  parseTargetResult,
  TargetResultError,
  type TargetResult,
} from "../../result/target-result.js";
import type { ControllerImplementationReviewDecision } from "../../review/controller-implementation-review-decision.js";
import {
  parseControllerReviewDecision,
  ControllerReviewDecisionError,
  type ControllerReviewDecision,
} from "../../review/controller-review-decision.js";
import type { ControllerTestReviewDecision } from "../../review/controller-test-review-decision.js";
import {
  parseControllerProductDefectRemediationAuthorization,
  ControllerProductDefectRemediationAuthorizationError,
  type ControllerProductDefectRemediationAuthorization,
} from "../../review/controller-product-defect-remediation-authorization.js";
import {
  deriveTargetResultCallbackId,
  parseTargetResultCallbackRecord,
  parseTargetResultCallbackReissue,
  TARGET_RESULT_CALLBACK_GENERATION_LIMIT,
  TargetResultCallbackError,
  type TargetResultCallbackRecord,
  type TargetResultCallbackReissue,
} from "../../result/target-result-callback.js";
import {
  parseDemandCompletion,
  DemandCompletionError,
  type DemandCompletion,
} from "../../lifecycle/demand-completion.js";
import {
  assertRerunTestExecutionAttemptFollows,
  parseTestExecutionAttempt,
  TestExecutionAttemptError,
  type TestExecutionAttempt,
} from "../../testing/test-execution-attempt.js";
import type { WakeflowWorkspaceHostId } from "../../../workspace/workspace-host-resource-profile.js";
import {
  parseWakeflowWindowHostBindingId,
  WakeflowWindowHostBindingIdError,
  type WakeflowWindowHostBindingId,
} from "../../../workspace/window-runtime/wakeflow-window-host-binding-id.js";

/**
 * Wakeflow Governance / Demand Model：领域事件归约器生成的纯聚合状态。
 *
 * 本状态不保存事件流修订号、事件尾部、身份/权威关系摘要或更新时间；这些事实
 * 属于事件溯源的持久化封装或快照。`authorityDigest` 让纯 Decider 能验证新任务绑定
 * publication 时冻结的 Authority；`targetTasks` 只保存调度前真正需要的最小摘要，
 * 完整 TaskPackage、Delivery Envelope、Delivery Outcome、Delivery Rearm、TargetResult
 * 与 Controller Review Decision 仍属于事件数据；状态只保存当前 Delivery（含围栏与
 * 结局摘要）、Result（含 wake-controller 回调的当前代际）和 Review 的最小摘要，工作声明
 * 本身在内核的共享协调根。测试合同在 test 任务包里；已经
 * 观察到产品缺陷的旧Test Target继续作为历史代际保留自己的attempt、Result与
 * Decision。`managedEvidence`只在首个Evidence Event后出现，且只保存Manifest与payload
 * 的精确selector；完整Manifest仍由Event拥有。`pendingTestRetest`只记录产品缺陷修复后
 * 尚待创建的一代复测，不复制完整Authorization或事件历史。尚未实现的Pod不使用
 * 空数组或null占位。
 */

const DEMAND_AGGREGATE_STATE_ARTIFACT_KIND =
  "wakeflow-demand-aggregate-state" as const;
const DEMAND_AGGREGATE_STATE_SCHEMA_VERSION = 1 as const;

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

export interface DemandDeliveryPreparedTargetTaskState extends DemandImplementationTargetTaskStateBase {
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

interface DemandObservedHostEffectTargetTaskStateBase extends DemandImplementationTargetTaskStateBase {
  readonly currentDelivery: Readonly<
    DemandCurrentDeliveryBase & {
      readonly outcome: Readonly<DemandDeliveryOutcomeSummary>;
    }
  >;
}

export interface DemandHostEffectAcceptedTargetTaskState extends DemandObservedHostEffectTargetTaskStateBase {
  readonly phase: "host-effect-accepted";
}

export interface DemandHostEffectIndeterminateTargetTaskState extends DemandObservedHostEffectTargetTaskStateBase {
  readonly phase: "host-effect-indeterminate";
}

export interface DemandHostEffectRejectedTargetTaskState extends DemandObservedHostEffectTargetTaskStateBase {
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

export interface DemandResultReportedTargetTaskState extends DemandImplementationTargetTaskStateBase {
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

export interface DemandProductDefectReworkRequestedTargetTaskState extends DemandReviewedTargetTaskStateBase {
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

type DemandReviewedTargetPhase =
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

export interface DemandTestHostEffectAcceptedTargetTaskState extends DemandTestObservedHostEffectTargetTaskStateBase {
  readonly phase: "test-host-effect-accepted";
}

export interface DemandTestHostEffectIndeterminateTargetTaskState extends DemandTestObservedHostEffectTargetTaskStateBase {
  readonly phase: "test-host-effect-indeterminate";
}

export interface DemandTestHostEffectRejectedTargetTaskState extends DemandTestObservedHostEffectTargetTaskStateBase {
  readonly phase: "test-host-effect-rejected";
}

export interface DemandTestResultReportedTargetTaskState extends DemandTestObservedHostEffectTargetTaskStateBase {
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

interface DemandTestReviewedTargetTaskStateBase extends DemandTestObservedHostEffectTargetTaskStateBase {
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

export interface DemandTestAnotherAttemptRequestedTargetTaskState extends DemandTestReviewedTargetTaskStateBase {
  readonly phase: "test-another-attempt-requested";
}

export interface DemandTestProductDefectTargetTaskState extends DemandTestReviewedTargetTaskStateBase {
  readonly phase: "test-product-defect";
}

export interface DemandTestReviewBlockedTargetTaskState extends DemandTestReviewedTargetTaskStateBase {
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
}

export interface DemandAwaitingDecision {
  readonly escalationEventId: WakeflowDurableId<"demand-event">;
  readonly issue: string;
  readonly source: NonNullable<DemandAggregateStateWire["awaitingDecision"]>["source"];
}

export type DemandContinuationKind =
  | "optimization"
  | "requirement-supplement"
  | "verified-bug";

export interface DemandContinuationState {
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly kind: DemandContinuationKind;
  readonly planningRequired: boolean;
}

export interface DemandManagedEvidenceSummary {
  readonly evidenceId: WakeflowDurableId<"evidence">;
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
  "task-package":
    "Demand aggregate state transition contains an invalid TaskPackage.",
  "delivery-envelope":
    "Demand aggregate state transition contains an invalid Delivery Envelope.",
  "delivery-outcome":
    "Demand aggregate state transition contains an invalid Delivery Outcome.",
  "delivery-rearm":
    "Demand aggregate state transition contains an invalid Delivery Rearm.",
  "target-result":
    "Demand aggregate state transition contains an invalid TargetResult.",
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

  constructor(reason: DemandAggregateStateErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

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
function fail(reason: DemandAggregateStateErrorReason, path: string): never {
  throw new DemandAggregateStateError(reason, path);
}

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
    | "demand-event"
    | "demand-event-commit"
    | "evidence"
    | "test-attempt"
    | "work-claim",
>(value: unknown, kind: Kind, path: string): WakeflowDurableId<Kind> {
  try {
    return parseWakeflowDurableIdOfKind(value, kind, path);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("identifier", path);
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
    bindingId = parseWakeflowWindowHostBindingId(
      value.bindingId,
      `${path}/bindingId`,
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowWindowHostBindingIdError) {
      fail("identifier", `${path}/bindingId`);
    }
    throw error;
  }
  if (
    !Number.isSafeInteger(value.generation) ||
    value.generation < 1 ||
    value.generation > DELIVERY_REARM_LIMIT + 1 ||
    !Number.isSafeInteger(value.fence.streamRevision) ||
    value.fence.streamRevision < 2
  ) {
    fail("relation", `${path}/generation`);
  }
  return Object.freeze({
    deliveryId: parseId(
      value.deliveryId,
      "target-delivery",
      `${path}/deliveryId`,
    ),
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
    | ProductCurrentDeliveryWire["outcome"]
    | TestObservedCurrentDeliveryWire["outcome"]
  >,
  path: string,
): Readonly<DemandDeliveryOutcomeSummary> {
  let observedAt: UtcInstant;
  try {
    observedAt = parseUtcInstant(value.observedAt, `${path}/observedAt`);
  } catch (error: unknown) {
    if (error instanceof UtcInstantError)
      fail("relation", `${path}/observedAt`);
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
    if (error instanceof UtcInstantError)
      fail("relation", `${path}/reportedAt`);
    throw error;
  }
  // reportedAt只保留Report来源时钟的审计事实；Event流修订、当前状态摘要和
  // TargetResult对Host Effect的精确引用共同建立因果关系，不比较跨来源墙钟。
  const targetResultId = parseId(
    value.targetResultId,
    "target-result",
    `${path}/targetResultId`,
  );
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
    if (error instanceof UtcInstantError) fail("relation", `${path}/issuedAt`);
    throw error;
  }
  let bindingId: WakeflowWindowHostBindingId;
  try {
    bindingId = parseWakeflowWindowHostBindingId(value.bindingId, `${path}/bindingId`);
  } catch (error: unknown) {
    if (error instanceof WakeflowWindowHostBindingIdError) {
      fail("identifier", `${path}/bindingId`);
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
    controllerWindowId: parseId(
      value.controllerWindowId,
      "window",
      `${path}/controllerWindowId`,
    ),
    bindingId,
  });
}

function parseTargetReviewDecisionSummary(
  value: NonNullable<ProductCurrentDeliveryWire["reviewDecision"]>,
  path: string,
): Readonly<DemandTargetReviewDecisionSummary> {
  let decidedAt: UtcInstant;
  try {
    decidedAt = parseUtcInstant(value.decidedAt, `${path}/decidedAt`);
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) fail("relation", `${path}/decidedAt`);
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
    controllerWindowId: parseId(
      value.controllerWindowId,
      "window",
      `${path}/controllerWindowId`,
    ),
    decidedAt,
  });
}

function parseTestReviewDecisionSummary(
  value: NonNullable<TestReviewedCurrentDeliveryWire["reviewDecision"]>,
  path: string,
): Readonly<DemandTestReviewDecisionSummary> {
  let decidedAt: UtcInstant;
  try {
    decidedAt = parseUtcInstant(value.decidedAt, `${path}/decidedAt`);
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) fail("relation", `${path}/decidedAt`);
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
    controllerWindowId: parseId(
      value.controllerWindowId,
      "window",
      `${path}/controllerWindowId`,
    ),
    decidedAt,
  });
}

function reviewPhaseForDecision(
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

function testReviewPhaseForDecision(
  decision: Readonly<ControllerTestReviewDecision>,
): DemandTestReviewedPhase {
  return decision.decision === "escalate"
    ? decision.escalation?.classification === "product-defect"
      ? "test-product-defect"
      : "test-escalated"
    : testReviewPhasesForDecision(decision.decision)[0] ?? "test-review-blocked";
}

const STEP_ID_PATTERN = /^ts-[1-9][0-9]?$/u;

function compareStepId(left: string, right: string): number {
  return Number(left.slice(3)) - Number(right.slice(3));
}

function parseAcceptanceAnchorIds(
  values: readonly string[],
  path: string,
): readonly string[] {
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
    if (error instanceof Sha256Error) fail("digest", path);
    throw error;
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseManagedEvidenceSummaries(
  values: readonly NonNullable<
    DemandAggregateStateWire["managedEvidence"]
  >[number][],
): readonly Readonly<DemandManagedEvidenceSummary>[] {
  const result: Readonly<DemandManagedEvidenceSummary>[] = [];
  let previousEvidenceId: string | undefined;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined) fail("schema", `$/managedEvidence/${index}`);
    const path = `$/managedEvidence/${index}`;
    const evidenceId = parseId(
      value.evidenceId,
      "evidence",
      `${path}/evidenceId`,
    );
    if (
      previousEvidenceId !== undefined &&
      compareText(previousEvidenceId, evidenceId) >= 0
    ) {
      fail("relation", path);
    }
    previousEvidenceId = evidenceId;
    result.push(
      Object.freeze({
        evidenceId,
        manifestDigest: parseDigest(
          value.manifestDigest,
          `${path}/manifestDigest`,
        ),
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
    parsedStepIds.some(
      (stepId, index) =>
        !STEP_ID_PATTERN.test(stepId) ||
        (index > 0 && compareStepId(parsedStepIds[index - 1]!, stepId) >= 0),
    )
  ) {
    fail("relation", `${path}/failedStepIds`);
  }
  const firstStepId = parsedStepIds[0];
  if (firstStepId === undefined) {
    fail("relation", `${path}/failedStepIds`);
  }
  const failedStepIds: DemandProductDefectRemediationSummary["failedStepIds"] =
    Object.freeze([firstStepId, ...parsedStepIds.slice(1)]);
  let authorizedAt: UtcInstant;
  try {
    authorizedAt = parseUtcInstant(value.authorizedAt, `${path}/authorizedAt`);
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) {
      fail("relation", `${path}/authorizedAt`);
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
    authorizationDigest: parseDigest(
      value.authorizationDigest,
      `${path}/authorizationDigest`,
    ),
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
    testAttemptId: parseId(
      value.testAttemptId,
      "test-attempt",
      `${path}/testAttemptId`,
    ),
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
      fail("relation", `${path}/attempt`);
    }
    throw error;
  }
  let preparedAt: UtcInstant;
  try {
    preparedAt = parseUtcInstant(value.delivery.preparedAt, `${path}/delivery/preparedAt`);
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) {
      fail("relation", `${path}/delivery/preparedAt`);
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
      envelopeDigest: parseDigest(
        value.delivery.envelopeDigest,
        `${path}/delivery/envelopeDigest`,
      ),
      preparedAt,
    }),
  });
}

function parseTestAttemptLineage(
  values: readonly TestAttemptStateWire[],
  target: Readonly<{
    readonly targetTaskId: WakeflowDurableId<"target-task">;
    readonly taskPackageId: WakeflowDurableId<"task-package">;
    readonly taskPackageDigest: Sha256Digest;
  }>,
  path: string,
): DemandTestAttemptLineage {
  if (values.length === 0 || values.length > 10) fail("relation", path);
  const attempts = values.map((value, index) =>
    parseTestAttemptState(value, `${path}/${index}`),
  );
  const first = attempts[0];
  if (first === undefined) fail("relation", path);
  const attemptIds = new Set<string>();
  const deliveryIds = new Set<string>();
  const priorResultIds = new Set<string>();
  const reviewDecisionIds = new Set<string>();
  for (let index = 0; index < attempts.length; index += 1) {
    const state = attempts[index]!;
    const attempt = state.attempt;
    const previous = index === 0 ? undefined : attempts[index - 1];
    if (
      attemptIds.has(attempt.testAttemptId) ||
      attempt.targetTaskId !== target.targetTaskId ||
      attempt.contract.taskPackageId !== target.taskPackageId ||
      attempt.contract.taskPackageDigest !== target.taskPackageDigest ||
      (index === 0 && (attempt.mode !== "initial" || attempt.ordinal !== 1))
    ) {
      fail("relation", `${path}/${index}/attempt`);
    }
    attemptIds.add(attempt.testAttemptId);
    if (previous !== undefined) {
      try {
        assertRerunTestExecutionAttemptFollows(attempt, previous.attempt);
      } catch (error: unknown) {
        if (error instanceof TestExecutionAttemptError) {
          fail("relation", `${path}/${index}/attempt`);
        }
        throw error;
      }
      if (attempt.mode !== "rerun") {
        fail("relation", `${path}/${index}/attempt/mode`);
      }
      const resultId = attempt.rerunSource.previousResult.targetResultId;
      const decisionId =
        attempt.rerunSource.reviewDecision.targetReviewDecisionId;
      if (priorResultIds.has(resultId) || reviewDecisionIds.has(decisionId)) {
        fail("relation", `${path}/${index}/attempt/rerunSource`);
      }
      priorResultIds.add(resultId);
      reviewDecisionIds.add(decisionId);
    }
    if (deliveryIds.has(state.delivery.deliveryId)) {
      fail("relation", `${path}/${index}/delivery`);
    }
    deliveryIds.add(state.delivery.deliveryId);
  }
  return Object.freeze([first, ...attempts.slice(1)]);
}


function parseTargetTasks(
  values: readonly DemandAggregateStateWire["targetTasks"][number][],
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
      taskPackageDigest: parseDigest(
        value.taskPackageDigest,
        `${path}/taskPackageDigest`,
      ),
      windowId: parseId(value.windowId, "window", `${path}/windowId`),
    };
    // 每个当前投递的围栏声明在整个状态里唯一：同一声明不能同时服务两个目标。
    const registerClaim = (delivery: Readonly<DemandCurrentDeliveryBase>) => {
      if (claimIds.has(delivery.fence.claimId)) {
        fail("relation", `${path}/currentDelivery/fence/claimId`);
      }
      claimIds.add(delivery.fence.claimId);
    };
    if (value.workType === "test") {
      if (value.reworkCount !== undefined) {
        fail("relation", path);
      }
      if (value.phase === "planned") {
        result.push(
          Object.freeze({
            ...common,
            workType: "test" as const,
            phase: "planned" as const,
          }),
        );
        continue;
      }
      if (
        (value.phase !== "test-delivery-prepared" &&
          value.phase !== "test-host-effect-accepted" &&
          value.phase !== "test-host-effect-indeterminate" &&
          value.phase !== "test-host-effect-rejected" &&
          value.phase !== "test-result-reported" &&
          value.phase !== "test-accepted" &&
          value.phase !== "test-another-attempt-requested" &&
          value.phase !== "test-product-defect" &&
          value.phase !== "test-review-blocked" &&
          value.phase !== "test-escalated") ||
        value.currentDelivery === undefined ||
        value.testAttempts === undefined ||
        value.testAttempts.length > 10
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
      const testAttempts = parseTestAttemptLineage(
        value.testAttempts,
        common,
        `${path}/testAttempts`,
      );
      const attemptState = testAttempts.at(-1)!;
      if (
        attemptState.attempt.targetTaskId !== common.targetTaskId ||
        currentDelivery.testAttemptId !== attemptState.attempt.testAttemptId ||
        currentDelivery.deliveryId !== attemptState.delivery.deliveryId ||
        currentDelivery.envelopeDigest !== attemptState.delivery.envelopeDigest
      ) {
        fail("relation", `${path}/testAttempts`);
      }
      if (value.phase === "test-delivery-prepared") {
        result.push(
          Object.freeze({
            ...common,
            workType: "test" as const,
            phase: "test-delivery-prepared" as const,
            currentDelivery,
            testAttempts,
          }),
        );
        continue;
      }
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
      if (
        value.phase === "test-accepted" ||
        value.phase === "test-another-attempt-requested" ||
        value.phase === "test-product-defect" ||
        value.phase === "test-review-blocked" ||
        value.phase === "test-escalated"
      ) {
        const reviewedDelivery =
          value.currentDelivery as TestReviewedCurrentDeliveryWire;
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
        const reviewDecision = parseTestReviewDecisionSummary(
          reviewedDelivery.reviewDecision,
          `${path}/currentDelivery/reviewDecision`,
        );
        const expectedPhase = value.phase;
        if (
          !testReviewPhasesForDecision(reviewDecision.decision).includes(
            expectedPhase,
          )
        ) {
          fail("relation", `${path}/phase`);
        }
        result.push(
          Object.freeze({
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
          }),
        );
      } else if (value.phase === "test-result-reported") {
        const resultDelivery =
          value.currentDelivery as TestResultCurrentDeliveryWire;
        if (
          resultDelivery.targetResult === undefined ||
          outcome.disposition === "rejected-before-send"
        ) {
          fail("relation", `${path}/currentDelivery`);
        }
        result.push(
          Object.freeze({
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
          }),
        );
      } else {
        const expectedPhase =
          outcome.disposition === "accepted"
            ? ("test-host-effect-accepted" as const)
            : outcome.disposition === "indeterminate"
              ? ("test-host-effect-indeterminate" as const)
              : ("test-host-effect-rejected" as const);
        if (value.phase !== expectedPhase) fail("relation", `${path}/phase`);
        result.push(
          Object.freeze({
            ...common,
            workType: "test" as const,
            phase: expectedPhase,
            currentDelivery: Object.freeze({
              ...currentDelivery,
              outcome,
            }),
            testAttempts,
          }),
        );
      }
      continue;
    }
    if (
      value.repositoryId === undefined ||
      value.commitExpectation === undefined ||
      value.acceptanceAnchorIds === undefined
    ) {
      fail("schema", path);
    }
    const repositoryId = parseId(
      value.repositoryId,
      "repository",
      `${path}/repositoryId`,
    );
    // 一个仓库同时只能有一个未接受且未被替代的实现目标；已接受与被替代的目标是历史。
    if (value.phase !== "accepted" && value.phase !== "superseded") {
      if (repositoryIds.has(repositoryId)) fail("relation", path);
      repositoryIds.add(repositoryId);
    }
    const base = {
      ...common,
      repositoryId,
      commitExpectation: value.commitExpectation,
      acceptanceAnchorIds: parseAcceptanceAnchorIds(
        value.acceptanceAnchorIds,
        `${path}/acceptanceAnchorIds`,
      ),
      ...(value.reworkCount === undefined
        ? {}
        : { reworkCount: value.reworkCount }),
    };
    const productCurrentDelivery = value.currentDelivery as
      ProductCurrentDeliveryWire | undefined;
    if (value.phase === "superseded") {
      if (value.supersededByTargetTaskId === undefined) {
        fail("schema", `${path}/supersededByTargetTaskId`);
      }
      const supersededByTargetTaskId = parseId(
        value.supersededByTargetTaskId,
        "target-task",
        `${path}/supersededByTargetTaskId`,
      );
      if (supersededByTargetTaskId === targetTaskId) fail("relation", path);
      result.push(
        Object.freeze({
          ...base,
          phase: "superseded" as const,
          supersededByTargetTaskId,
        }),
      );
      continue;
    }
    if (value.phase === "planned") {
      result.push(Object.freeze({ ...base, phase: "planned" as const }));
      continue;
    }
    if (productCurrentDelivery === undefined) {
      fail("relation", `${path}/currentDelivery`);
    }
    const currentDelivery = parseCurrentDeliveryBase(
      productCurrentDelivery,
      `${path}/currentDelivery`,
    );
    registerClaim(currentDelivery);
    if (value.phase === "delivery-prepared") {
      result.push(
        Object.freeze({
          ...base,
          phase: "delivery-prepared" as const,
          currentDelivery,
        }),
      );
      continue;
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
      result.push(
        Object.freeze({
          ...base,
          phase: expectedPhase,
          currentDelivery: observedDelivery,
        }),
      );
      continue;
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
      result.push(
        Object.freeze({
          ...base,
          phase: "result-reported" as const,
          currentDelivery: resultDelivery,
        }),
      );
      continue;
    }
    if (productCurrentDelivery.reviewDecision === undefined) {
      fail("relation", `${path}/currentDelivery/reviewDecision`);
    }
    const reviewDecision = parseTargetReviewDecisionSummary(
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
      result.push(
        Object.freeze({
          ...base,
          phase: "product-defect-rework-requested" as const,
          currentDelivery: reviewedDelivery,
          productDefectRemediation: parseProductDefectRemediationSummary(
            value.productDefectRemediation,
            reviewDecision,
            `${path}/productDefectRemediation`,
          ),
        }),
      );
      continue;
    }
    const phase = reviewPhaseForDecision(reviewDecision.decision);
    if (value.phase !== phase) fail("relation", `${path}/phase`);
    result.push(
      Object.freeze({
        ...base,
        phase,
        currentDelivery: reviewedDelivery,
      }),
    );
  }
  return Object.freeze(result);
}


type DeliveryBearingTargetTaskState = Exclude<
  DemandTargetTaskState,
  | DemandPlannedTargetTaskState
  | DemandTestPlannedTargetTaskState
  | DemandSupersededTargetTaskState
>;

function deliveryBearingTargets(
  current: Readonly<DemandAggregateState>,
): readonly Readonly<DeliveryBearingTargetTaskState>[] {
  return current.targetTasks.filter(
    (entry): entry is Readonly<DeliveryBearingTargetTaskState> =>
      entry.phase !== "planned" && entry.phase !== "superseded",
  );
}

function currentDeliveryOf(
  envelope: Readonly<DeliveryEnvelope>,
  generation: number,
): Readonly<DemandCurrentDeliveryBase> {
  return Object.freeze({
    deliveryId: envelope.deliveryId,
    envelopeDigest: envelope.envelopeDigest,
    promptDigest: envelope.promptDigest,
    generation,
    hostId: envelope.route.hostId,
    bindingId: envelope.route.bindingId,
    fence: Object.freeze({
      claimId: envelope.fence.claimId,
      claimDigest: envelope.fence.claimDigest,
      streamRevision: envelope.fence.expectedStreamRevision + 1,
    }),
  });
}

function assertClaimUnused(
  current: Readonly<DemandAggregateState>,
  claimId: WakeflowDurableId<"work-claim">,
): void {
  if (
    deliveryBearingTargets(current).some(
      (entry) => entry.currentDelivery.fence.claimId === claimId,
    )
  ) {
    fail("transition", "$/targetTasks");
  }
}

/** `delivery.delivery-prepared.v1` 使用的纯状态转换：实现与 test 两类目标共用。 */
export function prepareDeliveryInDemandAggregateState(
  currentValue: unknown,
  envelopeValue: unknown,
): Readonly<DemandAggregateState> {
  const current = parseDemandAggregateState(currentValue);
  let envelope: Readonly<DeliveryEnvelope>;
  try {
    envelope = parseDeliveryEnvelope(envelopeValue);
  } catch (error: unknown) {
    if (error instanceof DeliveryEnvelopeError) {
      fail("delivery-envelope", "$envelope");
    }
    throw error;
  }
  const target = current.targetTasks.find(
    (entry) => entry.targetTaskId === envelope.target.targetTaskId,
  );
  if (
    current.lifecycle !== "active" ||
    envelope.demandId !== current.demandId ||
    target === undefined ||
    target.taskPackageId !== envelope.target.taskPackageId ||
    target.taskPackageDigest !== envelope.target.taskPackageDigest ||
    target.windowId !== envelope.route.windowId ||
    deliveryBearingTargets(current).some(
      (entry) => entry.currentDelivery.deliveryId === envelope.deliveryId,
    )
  ) {
    fail("transition", "$/targetTasks");
  }
  assertClaimUnused(current, envelope.fence.claimId);
  const currentDelivery = currentDeliveryOf(envelope, 1);
  if (envelope.workType === "test") {
    if (
      target.workType !== "test" ||
      envelope.attempt.targetTaskId !== target.targetTaskId ||
      envelope.attempt.contract.taskPackageId !== target.taskPackageId ||
      envelope.attempt.contract.taskPackageDigest !== target.taskPackageDigest
    ) {
      fail("transition", "$/targetTasks");
    }
    const attemptDelivery = Object.freeze({
      deliveryId: envelope.deliveryId,
      envelopeDigest: envelope.envelopeDigest,
      preparedAt: envelope.preparedAt,
    });
    const testCurrentDelivery = Object.freeze({
      ...currentDelivery,
      testAttemptId: envelope.attempt.testAttemptId,
    });
    if (envelope.attempt.mode === "initial") {
      if (target.phase !== "planned") fail("transition", "$/targetTasks");
      return parseDemandAggregateState({
        ...current,
        targetTasks: current.targetTasks.map((entry) =>
          entry.targetTaskId === target.targetTaskId
            ? {
                ...target,
                phase: "test-delivery-prepared",
                currentDelivery: testCurrentDelivery,
                testAttempts: [{ attempt: envelope.attempt, delivery: attemptDelivery }],
              }
            : entry,
        ),
      });
    }
    if (target.phase !== "test-another-attempt-requested") {
      fail("transition", "$/targetTasks");
    }
    const previousAttempt = target.testAttempts.at(-1)!;
    try {
      assertRerunTestExecutionAttemptFollows(
        envelope.attempt,
        previousAttempt.attempt,
      );
    } catch (error: unknown) {
      if (error instanceof TestExecutionAttemptError) {
        fail("transition", "$/targetTasks");
      }
      throw error;
    }
    const rerunSource = envelope.attempt.rerunSource;
    if (
      target.testAttempts.length >= 10 ||
      target.testAttempts.some(
        (entry) => entry.attempt.testAttemptId === envelope.attempt.testAttemptId,
      ) ||
      rerunSource.previousResult.targetResultId !==
        target.currentDelivery.targetResult.targetResultId ||
      rerunSource.previousResult.resultDigest !==
        target.currentDelivery.targetResult.resultDigest ||
      rerunSource.reviewDecision.targetReviewDecisionId !==
        target.currentDelivery.reviewDecision.targetReviewDecisionId ||
      rerunSource.reviewDecision.decisionDigest !==
        target.currentDelivery.reviewDecision.decisionDigest ||
      target.currentDelivery.reviewDecision.decision !==
        "request-another-attempt"
    ) {
      fail("transition", "$/targetTasks");
    }
    return parseDemandAggregateState({
      ...current,
      targetTasks: current.targetTasks.map((entry) =>
        entry.targetTaskId === target.targetTaskId
          ? {
              ...target,
              phase: "test-delivery-prepared",
              currentDelivery: testCurrentDelivery,
              testAttempts: [
                ...target.testAttempts,
                { attempt: envelope.attempt, delivery: attemptDelivery },
              ],
            }
          : entry,
      ),
    });
  }
  if (target.workType === "test") fail("transition", "$/targetTasks");
  const purpose = deliveryPurpose(envelope);
  if (target.phase === "planned" || target.phase === "host-effect-rejected") {
    // 初次投递，或 rearm 用尽后换新信封重新准备。
    if (purpose !== "initial") fail("transition", "$/targetTasks");
    if (
      target.phase === "host-effect-rejected" &&
      target.currentDelivery.generation <= DELIVERY_REARM_LIMIT
    ) {
      fail("transition", "$/targetTasks");
    }
  } else if (target.phase === "rework-requested") {
    if (
      purpose !== "implementation-review-rework" ||
      envelope.rework === undefined ||
      envelope.deliveryId === target.currentDelivery.deliveryId ||
      envelope.rework.decision.targetReviewDecisionId !==
        target.currentDelivery.reviewDecision.targetReviewDecisionId ||
      envelope.rework.decision.decisionDigest !==
        target.currentDelivery.reviewDecision.decisionDigest ||
      envelope.rework.previousResult.targetResultId !==
        target.currentDelivery.targetResult.targetResultId ||
      envelope.rework.previousResult.resultDigest !==
        target.currentDelivery.targetResult.resultDigest
    ) {
      fail("transition", "$/targetTasks");
    }
  } else if (target.phase === "product-defect-rework-requested") {
    const remediation = envelope.productDefectRemediation;
    if (
      purpose !== "product-defect-remediation" ||
      remediation === undefined ||
      envelope.deliveryId === target.currentDelivery.deliveryId ||
      remediation.authorization.productDefectRemediationId !==
        target.productDefectRemediation.productDefectRemediationId ||
      remediation.authorization.authorizationDigest !==
        target.productDefectRemediation.authorizationDigest ||
      remediation.testReviewDecision.targetReviewDecisionId !==
        target.productDefectRemediation.testReviewDecisionId ||
      remediation.testReviewDecision.decisionDigest !==
        target.productDefectRemediation.testReviewDecisionDigest ||
      remediation.previousResult.targetResultId !==
        target.currentDelivery.targetResult.targetResultId ||
      remediation.previousResult.resultDigest !==
        target.currentDelivery.targetResult.resultDigest ||
      remediation.requiredCorrections.length !==
        target.productDefectRemediation.failedStepIds.length ||
      remediation.requiredCorrections.some(
        (correction, index) =>
          correction.stepId !==
          target.productDefectRemediation.failedStepIds[index],
      )
    ) {
      fail("transition", "$/targetTasks");
    }
  } else {
    fail("transition", "$/targetTasks");
  }
  return parseDemandAggregateState({
    ...current,
    targetTasks: current.targetTasks.map((entry) => {
      if (entry.targetTaskId !== target.targetTaskId) return entry;
      if (target.phase === "product-defect-rework-requested") {
        const {
          productDefectRemediation: _productDefectRemediation,
          ...withoutRemediation
        } = target;
        return {
          ...withoutRemediation,
          phase: "delivery-prepared",
          currentDelivery,
        };
      }
      const { currentDelivery: _previous, ...withoutDelivery } = target as typeof target & {
        readonly currentDelivery?: unknown;
      };
      return {
        ...withoutDelivery,
        phase: "delivery-prepared",
        currentDelivery,
      };
    }),
  });
}

function phaseForDisposition(
  workType: "implementation" | "test",
  disposition: DeliveryDisposition,
): DemandTargetTaskState["phase"] {
  if (workType === "test") {
    return disposition === "accepted"
      ? "test-host-effect-accepted"
      : disposition === "indeterminate"
        ? "test-host-effect-indeterminate"
        : "test-host-effect-rejected";
  }
  return disposition === "accepted"
    ? "host-effect-accepted"
    : disposition === "indeterminate"
      ? "host-effect-indeterminate"
      : "host-effect-rejected";
}

/**
 * `delivery.delivery-outcome-recorded.v1` 使用的纯状态转换。首次处置来自
 * delivery-prepared；indeterminate 之后允许再记一次（hook 记录到达或 Controller 显式解决）。
 */
export function recordDeliveryOutcomeInDemandAggregateState(
  currentValue: unknown,
  outcomeValue: unknown,
): Readonly<DemandAggregateState> {
  const current = parseDemandAggregateState(currentValue);
  let outcome: Readonly<DeliveryOutcome>;
  try {
    outcome = parseDeliveryOutcome(outcomeValue);
  } catch (error: unknown) {
    if (error instanceof DeliveryOutcomeError) {
      fail("delivery-outcome", "$outcome");
    }
    throw error;
  }
  const candidates = deliveryBearingTargets(current).filter(
    (entry) => entry.currentDelivery.deliveryId === outcome.deliveryId,
  );
  const target = candidates.length === 1 ? candidates[0] : undefined;
  if (
    target === undefined ||
    current.lifecycle !== "active" ||
    target.currentDelivery.generation !== outcome.generation ||
    target.currentDelivery.fence.claimId !== outcome.fence.claimId ||
    target.currentDelivery.fence.claimDigest !== outcome.fence.claimDigest
  ) {
    fail("transition", "$/targetTasks");
  }
  const firstOutcome =
    target.phase === "delivery-prepared" || target.phase === "test-delivery-prepared";
  const reevaluation =
    target.phase === "host-effect-indeterminate" ||
    target.phase === "test-host-effect-indeterminate";
  if (!firstOutcome && !reevaluation) fail("transition", "$/targetTasks");
  if (reevaluation && outcome.disposition === "indeterminate") {
    fail("transition", "$/targetTasks");
  }
  const workType = target.workType === "test" ? "test" : "implementation";
  const summary: DemandDeliveryOutcomeSummary = Object.freeze({
    outcomeDigest: outcome.outcomeDigest,
    disposition: outcome.disposition,
    evidenceKind: outcome.evidence.kind,
    readbackStatus: outcome.readback.status,
    claimHandling: outcome.claimHandling,
    observedAt: outcome.observedAt,
  });
  return parseDemandAggregateState({
    ...current,
    targetTasks: current.targetTasks.map((entry) =>
      entry.targetTaskId === target.targetTaskId
        ? {
            ...entry,
            phase: phaseForDisposition(workType, outcome.disposition),
            currentDelivery: {
              ...target.currentDelivery,
              outcome: summary,
            },
          }
        : entry,
    ),
  });
}

/** `delivery.delivery-rearmed.v1` 使用的纯状态转换：同一信封、新声明与围栏、代际加一。 */
export function rearmDeliveryInDemandAggregateState(
  currentValue: unknown,
  rearmValue: unknown,
): Readonly<DemandAggregateState> {
  const current = parseDemandAggregateState(currentValue);
  let rearm: Readonly<DeliveryRearm>;
  try {
    rearm = parseDeliveryRearm(rearmValue);
  } catch (error: unknown) {
    if (error instanceof DeliveryRearmError) fail("delivery-rearm", "$rearm");
    throw error;
  }
  const candidates = deliveryBearingTargets(current).filter(
    (entry) => entry.currentDelivery.deliveryId === rearm.deliveryId,
  );
  const target = candidates.length === 1 ? candidates[0] : undefined;
  // rearmedAt 只保留来源时钟的审计事实；因果关系由处置摘要、围栏与追加 CAS 建立。
  if (
    target === undefined ||
    current.lifecycle !== "active" ||
    (target.phase !== "host-effect-rejected" &&
      target.phase !== "test-host-effect-rejected") ||
    target.currentDelivery.generation !== rearm.previousGeneration ||
    target.currentDelivery.fence.claimId !== rearm.previousFence.claimId ||
    target.currentDelivery.fence.claimDigest !== rearm.previousFence.claimDigest ||
    target.currentDelivery.outcome.outcomeDigest !== rearm.rejectedOutcomeDigest ||
    target.currentDelivery.outcome.disposition !== "rejected-before-send" ||
    rearm.generation > DELIVERY_REARM_LIMIT + 1
  ) {
    fail("transition", "$/targetTasks");
  }
  assertClaimUnused(current, rearm.fence.claimId);
  const { outcome: _outcome, ...withoutOutcome } = target.currentDelivery;
  const rearmed = {
    ...withoutOutcome,
    generation: rearm.generation,
    fence: {
      claimId: rearm.fence.claimId,
      claimDigest: rearm.fence.claimDigest,
      streamRevision: rearm.fence.expectedStreamRevision + 1,
    },
  };
  return parseDemandAggregateState({
    ...current,
    targetTasks: current.targetTasks.map((entry) =>
      entry.targetTaskId === target.targetTaskId
        ? {
            ...entry,
            phase:
              target.workType === "test"
                ? "test-delivery-prepared"
                : "delivery-prepared",
            currentDelivery: rearmed,
          }
        : entry,
    ),
  });
}


function callbackSummaryOf(
  result: Readonly<TargetResult>,
  callback: Readonly<TargetResultCallbackRecord>,
): Readonly<DemandTargetResultCallbackSummary> {
  if (callback.callbackId !== deriveTargetResultCallbackId(result.targetResultId)) {
    fail("transition", "$callback/callbackId");
  }
  return Object.freeze({
    callbackId: callback.callbackId,
    generation: callback.generation,
    promptDigest: callback.promptDigest,
    issuedAt: callback.issuedAt,
    controllerWindowId: callback.controllerWindowId,
    bindingId: callback.bindingId,
  });
}

/** `result.target-result-recorded.v1` 使用的纯状态转换：结果与其回调记录一起进入摘要。 */
export function recordTargetResultInDemandAggregateState(
  currentValue: unknown,
  resultValue: unknown,
  callbackValue: unknown,
): Readonly<DemandAggregateState> {
  const current = parseDemandAggregateState(currentValue);
  let result: Readonly<TargetResult>;
  try {
    result = parseTargetResult(resultValue);
  } catch (error: unknown) {
    if (error instanceof TargetResultError) fail("target-result", "$result");
    throw error;
  }
  let callbackRecord: Readonly<TargetResultCallbackRecord>;
  try {
    callbackRecord = parseTargetResultCallbackRecord(callbackValue);
  } catch (error: unknown) {
    if (error instanceof TargetResultCallbackError) {
      fail("target-result-callback", "$callback");
    }
    throw error;
  }
  const callback = callbackSummaryOf(result, callbackRecord);
  const target = current.targetTasks.find(
    (entry) => entry.targetTaskId === result.targetTaskId,
  );
  if (result.workType === "test") {
    if (
      current.lifecycle !== "active" ||
      result.demandId !== current.demandId ||
      target === undefined ||
      target.workType !== "test" ||
      (target.phase !== "test-host-effect-accepted" &&
        target.phase !== "test-host-effect-indeterminate") ||
      target.taskPackageId !== result.taskPackage.taskPackageId ||
      target.taskPackageDigest !== result.taskPackage.digest ||
      target.windowId !== result.assignment.windowId ||
      target.currentDelivery.deliveryId !== result.deliveryId ||
      target.currentDelivery.testAttemptId !==
        result.testExecution.testAttemptId ||
      target.currentDelivery.generation !== result.delivery.generation ||
      target.currentDelivery.fence.claimId !== result.delivery.fence.claimId ||
      target.currentDelivery.fence.claimDigest !==
        result.delivery.fence.claimDigest ||
      target.currentDelivery.outcome.outcomeDigest !==
        result.delivery.outcomeDigest ||
      target.currentDelivery.outcome.disposition !==
        result.delivery.disposition ||
      target.currentDelivery.outcome.readbackStatus !==
        result.delivery.readbackStatus ||
      current.targetTasks.some(
        (entry) =>
          (entry.phase === "result-reported" ||
            entry.phase === "test-result-reported") &&
          entry.currentDelivery.targetResult.targetResultId ===
            result.targetResultId,
      )
    ) {
      fail("transition", "$/targetTasks");
    }
    return parseDemandAggregateState({
      ...current,
      targetTasks: current.targetTasks.map((entry) =>
        entry.targetTaskId === target.targetTaskId
          ? {
              ...target,
              phase: "test-result-reported",
              currentDelivery: {
                ...target.currentDelivery,
                targetResult: {
                  targetResultId: result.targetResultId,
                  resultDigest: result.resultDigest,
                  outcome: result.report.outcome,
                  reportedAt: result.report.reportedAt,
                  claimHandling: "release-authorized",
                  callback,
                },
              },
            }
          : entry,
      ),
    });
  }
  if (target === undefined || target.workType === "test") {
    fail("transition", "$/targetTasks");
  }
  const reportAnchorIds = result.report.anchorEvidence.map(
    (entry) => entry.anchorId,
  );
  const completedAnchorsClose =
    result.report.outcome !== "completed" ||
    (reportAnchorIds.length === target.acceptanceAnchorIds.length &&
      target.acceptanceAnchorIds.every((anchorId) =>
        reportAnchorIds.includes(anchorId),
      ));
  const commitPolicyCloses =
    result.report.outcome !== "completed" ||
    (target.commitExpectation === "commit"
      ? result.report.repositoryChange.disposition === "committed"
      : result.report.repositoryChange.disposition !== "committed");
  if (
    current.lifecycle !== "active" ||
    result.demandId !== current.demandId ||
    (target.phase !== "host-effect-accepted" &&
      target.phase !== "host-effect-indeterminate") ||
    target.taskPackageId !== result.taskPackage.taskPackageId ||
    target.taskPackageDigest !== result.taskPackage.digest ||
    target.repositoryId !== result.assignment.repositoryId ||
    target.windowId !== result.assignment.windowId ||
    target.currentDelivery.deliveryId !== result.deliveryId ||
    target.currentDelivery.generation !== result.delivery.generation ||
    target.currentDelivery.fence.claimId !== result.delivery.fence.claimId ||
    target.currentDelivery.fence.claimDigest !==
      result.delivery.fence.claimDigest ||
    target.currentDelivery.outcome.outcomeDigest !==
      result.delivery.outcomeDigest ||
    target.currentDelivery.outcome.disposition !==
      result.delivery.disposition ||
    target.currentDelivery.outcome.readbackStatus !==
      result.delivery.readbackStatus ||
    result.report.repositoryChange.repositoryId !== target.repositoryId ||
    reportAnchorIds.some(
      (anchorId) => !target.acceptanceAnchorIds.includes(anchorId),
    ) ||
    !completedAnchorsClose ||
    !commitPolicyCloses ||
    current.targetTasks.some(
      (entry) =>
        entry.phase === "result-reported" &&
        entry.currentDelivery.targetResult.targetResultId ===
          result.targetResultId,
    )
  ) {
    fail("transition", "$/targetTasks");
  }
  return parseDemandAggregateState({
    ...current,
    targetTasks: current.targetTasks.map((entry) =>
      entry.targetTaskId === target.targetTaskId
        ? {
            ...entry,
            phase: "result-reported",
            currentDelivery: {
              ...target.currentDelivery,
              targetResult: {
                targetResultId: result.targetResultId,
                resultDigest: result.resultDigest,
                outcome: result.report.outcome,
                reportedAt: result.report.reportedAt,
                claimHandling: "release-authorized",
                callback,
              },
            },
          }
        : entry,
    ),
  });
}

/**
 * `result.callback-reissued.v1` 使用的纯状态转换：同一回调换绑定与代际；只在结果尚未被
 * Controller 决定的阶段允许，决定一旦记录回调即 acknowledged。
 */
export function reissueCallbackInDemandAggregateState(
  currentValue: unknown,
  reissueValue: unknown,
): Readonly<DemandAggregateState> {
  const current = parseDemandAggregateState(currentValue);
  let reissue: Readonly<TargetResultCallbackReissue>;
  try {
    reissue = parseTargetResultCallbackReissue(reissueValue);
  } catch (error: unknown) {
    if (error instanceof TargetResultCallbackError) {
      fail("target-result-callback", "$reissue");
    }
    throw error;
  }
  const target = current.targetTasks.find(
    (entry) =>
      (entry.phase === "result-reported" || entry.phase === "test-result-reported") &&
      entry.currentDelivery.targetResult.targetResultId === reissue.targetResultId,
  );
  if (
    current.lifecycle !== "active" ||
    target === undefined ||
    (target.phase !== "result-reported" && target.phase !== "test-result-reported")
  ) {
    fail("transition", "$/targetTasks");
  }
  const callback = target.currentDelivery.targetResult.callback;
  if (
    callback.callbackId !== reissue.callbackId ||
    callback.generation !== reissue.previousGeneration ||
    callback.promptDigest !== reissue.promptDigest ||
    reissue.generation > TARGET_RESULT_CALLBACK_GENERATION_LIMIT
  ) {
    fail("transition", "$/targetTasks");
  }
  return parseDemandAggregateState({
    ...current,
    targetTasks: current.targetTasks.map((entry) =>
      entry.targetTaskId === target.targetTaskId
        ? {
            ...target,
            currentDelivery: {
              ...target.currentDelivery,
              targetResult: {
                ...target.currentDelivery.targetResult,
                callback: {
                  ...callback,
                  generation: reissue.generation,
                  issuedAt: reissue.issuedAt,
                  controllerWindowId: reissue.controllerWindowId,
                  bindingId: reissue.bindingId,
                },
              },
            },
          }
        : entry,
    ),
  });
}

type ReviewedTargetTaskState = Extract<
  DemandTargetTaskState,
  { readonly currentDelivery: { readonly reviewDecision: unknown } }
>;

/**
 * blocked 或 escalated 之后在同一结果上再次决定的准入（§13.87 D4）：新决定必须带
 * `resumption` 指向当前决定；`condition-cleared` 只接 blocked，`decision-recorded`
 * 只接已被用户回答的 escalate（`awaitingDecision` 已清除）。
 */
function assertResumptionAdmitted(
  current: Readonly<DemandAggregateState>,
  target: Readonly<ReviewedTargetTaskState>,
  decision: Readonly<ControllerReviewDecision>,
): void {
  const resumption = decision.resumption;
  const previous = target.currentDelivery.reviewDecision;
  if (
    resumption === null ||
    resumption.previousDecisionId !== previous.targetReviewDecisionId ||
    (resumption.basis.kind === "condition-cleared") !== (previous.decision === "blocked") ||
    (resumption.basis.kind === "decision-recorded" &&
      (previous.decision !== "escalate" || current.awaitingDecision !== undefined))
  ) {
    fail("transition", "$/targetTasks/resumption");
  }
}

/** `review.target-result-decided.v1` 使用的纯状态转换。 */
export function decideTargetResultReviewInDemandAggregateState(
  currentValue: unknown,
  decisionValue: unknown,
): Readonly<DemandAggregateState> {
  const current = parseDemandAggregateState(currentValue);
  let decision: Readonly<ControllerReviewDecision>;
  try {
    decision = parseControllerReviewDecision(decisionValue);
  } catch (error: unknown) {
    if (error instanceof ControllerReviewDecisionError) {
      fail("controller-review-decision", "$decision");
    }
    throw error;
  }
  const target = current.targetTasks.find(
    (entry) => entry.targetTaskId === decision.targetTaskId,
  );
  const duplicateDecision = current.targetTasks.some((entry) => {
    if (
      !("currentDelivery" in entry) ||
      !("reviewDecision" in entry.currentDelivery)
    ) {
      return false;
    }
    return (
      entry.currentDelivery.reviewDecision.targetReviewDecisionId ===
      decision.targetReviewDecisionId
    );
  });
  if (
    current.lifecycle !== "active" ||
    decision.demandId !== current.demandId ||
    target === undefined ||
    decision.reviewed.stateDigest !==
      computeDemandAggregateStateDigest(current) ||
    decision.reviewed.taskPackageId !== target.taskPackageId ||
    decision.reviewed.taskPackageDigest !== target.taskPackageDigest ||
    duplicateDecision
  ) {
    fail("transition", "$/targetTasks");
  }

  if (decision.kind === "WakeflowControllerTestReviewDecision") {
    if (
      target.workType !== "test" ||
      (target.phase !== "test-result-reported" &&
        target.phase !== "test-review-blocked" &&
        target.phase !== "test-escalated") ||
      decision.reviewed.targetResultId !==
        target.currentDelivery.targetResult.targetResultId ||
      decision.reviewed.targetResultDigest !==
        target.currentDelivery.targetResult.resultDigest ||
      decision.reviewed.targetResultOutcome !==
        target.currentDelivery.targetResult.outcome ||
      decision.reviewed.targetResultReportedAt !==
        target.currentDelivery.targetResult.reportedAt ||
      decision.testExecution.testAttemptId !==
        target.currentDelivery.testAttemptId
    ) {
      fail("transition", "$/targetTasks");
    }
    if (target.phase === "test-result-reported") {
      if (decision.resumption !== null) fail("transition", "$/targetTasks/resumption");
    } else {
      assertResumptionAdmitted(current, target, decision);
    }
    const phase = testReviewPhaseForDecision(decision);
    return parseDemandAggregateState({
      ...current,
      targetTasks: current.targetTasks.map((entry) =>
        entry.targetTaskId === target.targetTaskId
          ? {
              ...target,
              phase,
              currentDelivery: {
                ...target.currentDelivery,
                reviewDecision: {
                  targetReviewDecisionId: decision.targetReviewDecisionId,
                  decisionDigest: decision.decisionDigest,
                  decision: decision.decision,
                  controllerWindowId: decision.controllerWindowId,
                  decidedAt: decision.decidedAt,
                },
              },
            }
          : entry,
      ),
    });
  }

  if (
    target.workType === "test" ||
    (target.phase !== "result-reported" &&
      target.phase !== "review-blocked" &&
      target.phase !== "escalated")
  ) {
    fail("transition", "$/targetTasks");
  }
  if (
    decision.reviewed.targetResultId !==
      target.currentDelivery.targetResult.targetResultId ||
    decision.reviewed.targetResultDigest !==
      target.currentDelivery.targetResult.resultDigest ||
    decision.reviewed.targetResultOutcome !==
      target.currentDelivery.targetResult.outcome ||
    decision.reviewed.targetResultReportedAt !==
      target.currentDelivery.targetResult.reportedAt
  ) {
    fail("transition", "$/targetTasks");
  }
  if (target.phase === "result-reported") {
    if (decision.resumption !== null) fail("transition", "$/targetTasks/resumption");
  } else {
    assertResumptionAdmitted(current, target, decision);
  }
  const phase = reviewPhaseForDecision(decision.decision);
  const reworkCount =
    decision.decision === "rework"
      ? (target.reworkCount ?? 0) + 1
      : target.reworkCount;
  return parseDemandAggregateState({
    ...current,
    targetTasks: current.targetTasks.map((entry) =>
      entry.targetTaskId === target.targetTaskId
        ? {
            ...target,
            ...(reworkCount === undefined ? {} : { reworkCount }),
            phase,
            currentDelivery: {
              ...target.currentDelivery,
              reviewDecision: {
                targetReviewDecisionId: decision.targetReviewDecisionId,
                decisionDigest: decision.decisionDigest,
                decision: decision.decision,
                controllerWindowId: decision.controllerWindowId,
                decidedAt: decision.decidedAt,
              },
            },
          }
        : entry,
    ),
  });
}

/** `review.product-defect-remediation-authorized.v1`使用的纯状态转换。 */
export function authorizeProductDefectRemediationInDemandAggregateState(
  currentValue: unknown,
  authorizationValue: unknown,
): Readonly<DemandAggregateState> {
  const current = parseDemandAggregateState(currentValue);
  let authorization: Readonly<ControllerProductDefectRemediationAuthorization>;
  try {
    authorization =
      parseControllerProductDefectRemediationAuthorization(authorizationValue);
  } catch (error: unknown) {
    if (error instanceof ControllerProductDefectRemediationAuthorizationError) {
      fail(
        "controller-product-defect-remediation-authorization",
        "$authorization",
      );
    }
    throw error;
  }
  const testTarget = current.targetTasks.find(
    (target) => target.targetTaskId === authorization.source.testTargetTaskId,
  );
  if (
    current.lifecycle !== "active" ||
    authorization.demandId !== current.demandId ||
    authorization.source.stateDigest !==
      computeDemandAggregateStateDigest(current) ||
    current.pendingTestRetest !== undefined ||
    testTarget === undefined ||
    testTarget.workType !== "test" ||
    testTarget.phase !== "test-product-defect" ||
    testTarget.taskPackageId !==
      authorization.source.testTaskPackage.taskPackageId ||
    testTarget.taskPackageDigest !==
      authorization.source.testTaskPackage.taskPackageDigest ||
    testTarget.currentDelivery.testAttemptId !==
      authorization.source.testAttemptId ||
    testTarget.currentDelivery.targetResult.targetResultId !==
      authorization.source.targetResult.targetResultId ||
    testTarget.currentDelivery.targetResult.resultDigest !==
      authorization.source.targetResult.resultDigest ||
    testTarget.currentDelivery.reviewDecision.targetReviewDecisionId !==
      authorization.source.testReviewDecision.targetReviewDecisionId ||
    testTarget.currentDelivery.reviewDecision.decisionDigest !==
      authorization.source.testReviewDecision.decisionDigest ||
    testTarget.currentDelivery.reviewDecision.decidedAt !==
      authorization.source.testReviewDecision.decidedAt ||
    testTarget.currentDelivery.reviewDecision.decision !== "escalate" ||
    testTarget.currentDelivery.reviewDecision.controllerWindowId !==
      authorization.controllerWindowId
  ) {
    fail("transition", "$state/targetTasks");
  }
  const authorizationTargets = new Map(
    authorization.affectedTargets.map(
      (target) => [target.baseline.targetTaskId, target] as const,
    ),
  );
  if (
    authorizationTargets.size !== authorization.affectedTargets.length ||
    authorization.affectedTargets.some(({ baseline }) => {
      const target = current.targetTasks.find(
        (entry) => entry.targetTaskId === baseline.targetTaskId,
      );
      return (
        target === undefined ||
        target.workType === "test" ||
        target.phase !== "accepted" ||
        target.taskPackageId !== baseline.taskPackageId ||
        target.taskPackageDigest !== baseline.taskPackageDigest ||
        target.repositoryId !== baseline.repositoryId ||
        target.windowId !== baseline.windowId ||
        target.currentDelivery.targetResult.targetResultId !==
          baseline.targetResultId ||
        target.currentDelivery.targetResult.resultDigest !==
          baseline.resultDigest ||
        target.currentDelivery.reviewDecision.targetReviewDecisionId !==
          baseline.targetReviewDecisionId ||
        target.currentDelivery.reviewDecision.decisionDigest !==
          baseline.decisionDigest ||
        target.currentDelivery.reviewDecision.decision !== "accept"
      );
    })
  ) {
    fail("transition", "$state/targetTasks");
  }
  return parseDemandAggregateState({
    ...current,
    pendingTestRetest: {
      kind: "product-defect-retest",
      previousTestTarget: {
        targetTaskId: testTarget.targetTaskId,
        taskPackageId: testTarget.taskPackageId,
        taskPackageDigest: testTarget.taskPackageDigest,
      },
      testReviewDecision: {
        targetReviewDecisionId:
          authorization.source.testReviewDecision.targetReviewDecisionId,
        decisionDigest: authorization.source.testReviewDecision.decisionDigest,
      },
      productDefectRemediation: {
        productDefectRemediationId: authorization.productDefectRemediationId,
        authorizationDigest: authorization.authorizationDigest,
      },
    },
    targetTasks: current.targetTasks.map((target) => {
      const authorizedTarget = authorizationTargets.get(target.targetTaskId);
      if (authorizedTarget === undefined || target.workType === "test") {
        return target;
      }
      return {
        ...target,
        phase: "product-defect-rework-requested",
        productDefectRemediation: {
          productDefectRemediationId: authorization.productDefectRemediationId,
          authorizationDigest: authorization.authorizationDigest,
          testReviewDecisionId:
            authorization.source.testReviewDecision.targetReviewDecisionId,
          testReviewDecisionDigest:
            authorization.source.testReviewDecision.decisionDigest,
          failedStepIds: authorizedTarget.failedStepIds,
          correctionObjective: authorizedTarget.correctionObjective,
          authorizedAt: authorization.authorizedAt,
        },
      };
    }),
  });
}

function normalizeState(
  wire: Readonly<DemandAggregateStateWire>,
): Readonly<DemandAggregateState> {
  const targetTasks = parseTargetTasks(wire.targetTasks);
  const managedEvidence =
    wire.managedEvidence === undefined
      ? undefined
      : parseManagedEvidenceSummaries(wire.managedEvidence);
  const implementationTargets = targetTasks.filter(
    (target) => target.workType !== "test",
  );
  const liveImplementationTargets = implementationTargets.filter(
    (target) => target.phase !== "superseded",
  );
  const testTargets = targetTasks.filter(
    (target) => target.workType === "test",
  );
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
      : parseContinuationState(wire.continuation);
  // 同一时间只有一个未终结的 test 目标（能力卡 5 Q4）；历史代际只能停在 test-product-defect。
  const openTestTargets = testTargets.filter(
    (target) => target.phase !== "test-product-defect",
  );
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
      !testTargets.some(
        (target) =>
          target.phase === "test-product-defect" &&
          target.targetTaskId ===
            pendingTestRetest.previousTestTarget.targetTaskId &&
          target.taskPackageId ===
            pendingTestRetest.previousTestTarget.taskPackageId &&
          target.taskPackageDigest ===
            pendingTestRetest.previousTestTarget.taskPackageDigest &&
          target.currentDelivery.reviewDecision.targetReviewDecisionId ===
            pendingTestRetest.testReviewDecision.targetReviewDecisionId &&
          target.currentDelivery.reviewDecision.decisionDigest ===
            pendingTestRetest.testReviewDecision.decisionDigest &&
          target.currentDelivery.reviewDecision.decision === "escalate",
      ))
  ) {
    fail("relation", "$/pendingTestRetest");
  }
  if (
    wire.lifecycle === "completed" &&
    (pendingTestRetest !== undefined ||
      liveImplementationTargets.length === 0 ||
      liveImplementationTargets.some((target) => target.phase !== "accepted") ||
      (testTargets.length > 0 &&
        (openTestTargets.length !== 1 ||
          openTestTargets[0]?.phase !== "test-accepted")))
  ) {
    fail("relation", "$/lifecycle");
  }
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
  });
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
  parseId(
    value.source.targetTaskId,
    "target-task",
    "$/awaitingDecision/source/targetTaskId",
  );
  return Object.freeze({
    escalationEventId,
    issue: value.issue,
    source: Object.freeze({ ...value.source }),
  });
}

function parseContinuationState(
  value: NonNullable<DemandAggregateStateWire["continuation"]>,
): Readonly<DemandContinuationState> {
  return Object.freeze({
    eventId: parseId(value.eventId, "demand-event", "$/continuation/eventId"),
    kind: value.kind,
    planningRequired: value.planningRequired,
  });
}

export interface DemandEscalationSource {
  readonly issue: string;
  readonly source: DemandAwaitingDecision["source"];
}

/** `lifecycle.demand-escalated.v1`：活动 Demand 进入等待决定；同一时刻只能有一个未回答的升级。 */
export function escalateDemandAggregateState(
  currentValue: unknown,
  escalation: Readonly<DemandEscalationSource>,
  escalationEventIdValue: unknown,
): Readonly<DemandAggregateState> {
  const current = parseDemandAggregateState(currentValue);
  const escalationEventId = parseId(
    escalationEventIdValue,
    "demand-event",
    "$escalationEventId",
  );
  if (
    current.lifecycle !== "active" ||
    current.awaitingDecision !== undefined ||
    !current.targetTasks.some(
      (target) => target.targetTaskId === escalation.source.targetTaskId,
    )
  ) {
    fail("transition", "$state/awaitingDecision");
  }
  return parseDemandAggregateState({
    ...current,
    awaitingDecision: {
      escalationEventId,
      issue: escalation.issue,
      source: escalation.source,
    },
  });
}

/** `lifecycle.decision-recorded.v1`：用户回答清除等待中的升级。 */
export function recordDecisionInDemandAggregateState(
  currentValue: unknown,
  escalationEventIdValue: unknown,
): Readonly<DemandAggregateState> {
  const current = parseDemandAggregateState(currentValue);
  const escalationEventId = parseId(
    escalationEventIdValue,
    "demand-event",
    "$escalationEventId",
  );
  if (
    current.lifecycle !== "active" ||
    current.awaitingDecision === undefined ||
    current.awaitingDecision.escalationEventId !== escalationEventId
  ) {
    fail("transition", "$state/awaitingDecision");
  }
  const { awaitingDecision: _awaitingDecision, ...rest } = current;
  return parseDemandAggregateState(rest);
}

/** `lifecycle.demand-continued.v1`：已完成的 Demand 回到 active，并要求先规划新的任务包。 */
export function continueDemandAggregateState(
  currentValue: unknown,
  kindValue: unknown,
  eventIdValue: unknown,
): Readonly<DemandAggregateState> {
  const current = parseDemandAggregateState(currentValue);
  const eventId = parseId(eventIdValue, "demand-event", "$eventId");
  if (
    current.lifecycle !== "completed" ||
    (kindValue !== "optimization" &&
      kindValue !== "requirement-supplement" &&
      kindValue !== "verified-bug")
  ) {
    fail("transition", "$state/lifecycle");
  }
  // 已接受的目标留在状态里作为历史；续接要求先规划新的任务包，同一仓库允许再次规划。
  return parseDemandAggregateState({
    ...current,
    lifecycle: "active",
    continuation: { eventId, kind: kindValue, planningRequired: true },
  });
}

/** `evidence.managed-evidence-recorded.v1`使用的纯状态转换。 */
export function recordManagedEvidenceInDemandAggregateState(
  currentValue: unknown,
  manifestValue: unknown,
): Readonly<DemandAggregateState> {
  const current = parseDemandAggregateState(currentValue);
  let manifest: Readonly<ManagedEvidenceManifest>;
  try {
    manifest = parseManagedEvidenceManifest(manifestValue);
  } catch (error: unknown) {
    if (error instanceof ManagedEvidenceManifestError) {
      fail("managed-evidence-manifest", "$manifest");
    }
    throw error;
  }
  const recorded = current.managedEvidence ?? [];
  if (
    current.lifecycle !== "active" ||
    manifest.demandId !== current.demandId ||
    manifest.demandAuthorityDigest !== current.authorityDigest ||
    recorded.some((entry) => entry.evidenceId === manifest.evidenceId)
  ) {
    fail("transition", "$state/managedEvidence");
  }
  return parseDemandAggregateState({
    ...current,
    managedEvidence: [
      ...recorded,
      {
        evidenceId: manifest.evidenceId,
        manifestDigest: manifest.manifestDigest,
        payloadArtifactDigest: manifest.payload.artifactDigest,
      },
    ].sort((left, right) => compareText(left.evidenceId, right.evidenceId)),
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

/** 可被替代的实现目标 phase：没有在飞的宿主效果，也没有待评审的结果。 */
const REPLACEABLE_PHASES: readonly DemandTargetTaskState["phase"][] = Object.freeze([
  "planned",
  "delivery-prepared",
  "host-effect-rejected",
  "rework-requested",
  "product-defect-rework-requested",
  "escalated",
  "review-blocked",
]);

function supersedeTarget(
  target: Readonly<DemandTargetTaskState>,
  supersededByTargetTaskId: WakeflowDurableId<"target-task">,
): Readonly<DemandSupersededTargetTaskState> {
  if (target.workType === "test") fail("transition", "$state/targetTasks");
  return Object.freeze({
    targetTaskId: target.targetTaskId,
    taskPackageId: target.taskPackageId,
    taskPackageDigest: target.taskPackageDigest,
    repositoryId: target.repositoryId,
    windowId: target.windowId,
    commitExpectation: target.commitExpectation,
    acceptanceAnchorIds: target.acceptanceAnchorIds,
    ...(target.reworkCount === undefined ? {} : { reworkCount: target.reworkCount }),
    phase: "superseded" as const,
    supersededByTargetTaskId,
  });
}

/**
 * 同仓库谱系（能力卡 5 Q2）：仓库里已有未接受且未被替代的目标时，新包必须是它的
 * replacement 且旧目标可替代；只剩已接受目标时，新包必须是其中一个的 continuation；
 * 仓库尚无目标时不得声明谱系。返回被替代目标的标识。
 */
function applyLineage(
  current: Readonly<DemandAggregateState>,
  taskPackage: Readonly<TaskPackage>,
): WakeflowDurableId<"target-task"> | null {
  if (taskPackage.workType !== "implementation") return null;
  const repositoryId = taskPackage.assignment.repositoryId;
  const sameRepository = current.targetTasks.filter(
    (entry) => entry.workType !== "test" && entry.repositoryId === repositoryId,
  );
  const open = sameRepository.find(
    (entry) => entry.phase !== "accepted" && entry.phase !== "superseded",
  );
  const lineage = taskPackage.lineage;
  if (open !== undefined) {
    if (
      lineage === null ||
      lineage.kind !== "replacement" ||
      lineage.replacesTargetTaskId !== open.targetTaskId ||
      !REPLACEABLE_PHASES.includes(open.phase)
    ) {
      fail("transition", "$state/targetTasks/lineage");
    }
    return open.targetTaskId;
  }
  const accepted = sameRepository.filter((entry) => entry.phase === "accepted");
  if (accepted.length > 0) {
    if (
      lineage === null ||
      lineage.kind !== "continuation" ||
      !accepted.some((entry) => entry.targetTaskId === lineage.continuesTargetTaskId)
    ) {
      fail("transition", "$state/targetTasks/lineage");
    }
    return null;
  }
  if (lineage !== null) fail("transition", "$state/targetTasks/lineage");
  return null;
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
    current.lifecycle !== "active" ||
    taskPackage.demandId !== current.demandId ||
    taskPackage.demandAuthorityDigest !== current.authorityDigest ||
    current.targetTasks.some(
      (entry) =>
        entry.targetTaskId === taskPackage.targetTaskId ||
        entry.taskPackageId === taskPackage.taskPackageId,
    )
  ) {
    fail("transition", "$state/targetTasks");
  }
  if (taskPackage.workType === "test") {
    const testTargets = current.targetTasks.filter(
      (target) => target.workType === "test",
    );
    const liveImplementationTargets = current.targetTasks.filter(
      (target) => target.workType !== "test" && target.phase !== "superseded",
    );
    const baselineByTarget = new Map(
      taskPackage.implementationBaselines.map(
        (baseline) => [baseline.targetTaskId, baseline] as const,
      ),
    );
    const pendingTestRetest = current.pendingTestRetest;
    const lineage = taskPackage.lineage;
    const lineageCloses =
      lineage === null
        ? pendingTestRetest === undefined && testTargets.length === 0
        : pendingTestRetest !== undefined &&
          lineage.retestsTargetTaskId ===
            pendingTestRetest.previousTestTarget.targetTaskId &&
          lineage.productDefectRemediationId ===
            pendingTestRetest.productDefectRemediation
              .productDefectRemediationId &&
          lineage.authorizationDigest ===
            pendingTestRetest.productDefectRemediation.authorizationDigest;
    if (
      !lineageCloses ||
      testTargets.some((target) => target.phase !== "test-product-defect") ||
      liveImplementationTargets.length === 0 ||
      liveImplementationTargets.length !== baselineByTarget.size ||
      liveImplementationTargets.some((target) => {
        const baseline = baselineByTarget.get(target.targetTaskId);
        return (
          target.phase !== "accepted" ||
          baseline === undefined ||
          baseline.taskPackageId !== target.taskPackageId ||
          baseline.taskPackageDigest !== target.taskPackageDigest ||
          baseline.repositoryId !== target.repositoryId ||
          baseline.windowId !== target.windowId ||
          baseline.targetResultId !==
            target.currentDelivery.targetResult.targetResultId ||
          baseline.resultDigest !==
            target.currentDelivery.targetResult.resultDigest ||
          baseline.targetReviewDecisionId !==
            target.currentDelivery.reviewDecision.targetReviewDecisionId ||
          baseline.decisionDigest !==
            target.currentDelivery.reviewDecision.decisionDigest
        );
      })
    ) {
      fail("transition", "$state/targetTasks");
    }
    const { pendingTestRetest: _pendingTestRetest, ...withoutPendingTestRetest } =
      current;
    return parseDemandAggregateState({
      ...withoutPendingTestRetest,
      targetTasks: [
        ...current.targetTasks,
        {
          targetTaskId: taskPackage.targetTaskId,
          taskPackageId: taskPackage.taskPackageId,
          taskPackageDigest: computeTaskPackageDigest(taskPackage),
          workType: "test",
          windowId: taskPackage.assignment.windowId,
          phase: "planned",
        },
      ].sort((left, right) =>
        compareText(left.targetTaskId, right.targetTaskId),
      ),
    });
  }
  if (
    current.pendingTestRetest !== undefined ||
    current.targetTasks.some((entry) => entry.workType === "test")
  ) {
    fail("transition", "$state/targetTasks");
  }
  const superseded = applyLineage(current, taskPackage);
  const nextTargetTasks = [
    ...current.targetTasks.map((entry) =>
      entry.targetTaskId === superseded
        ? supersedeTarget(entry, taskPackage.targetTaskId)
        : entry,
    ),
    Object.freeze({
      targetTaskId: taskPackage.targetTaskId,
      taskPackageId: taskPackage.taskPackageId,
      taskPackageDigest: computeTaskPackageDigest(taskPackage),
      repositoryId: taskPackage.assignment.repositoryId,
      windowId: taskPackage.assignment.windowId,
      commitExpectation: taskPackage.commitExpectation,
      acceptanceAnchorIds: Object.freeze(
        taskPackage.acceptanceAnchors.map((anchor) => anchor.anchorId),
      ),
      phase: "planned" as const,
    }),
  ].sort((left, right) => compareText(left.targetTaskId, right.targetTaskId));
  return parseDemandAggregateState({
    ...current,
    ...(current.continuation === undefined
      ? {}
      : {
          continuation: { ...current.continuation, planningRequired: false },
        }),
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

/** `lifecycle.demand-completed.v1`使用的成功终态转换。 */
export function completeDemandAggregateState(
  currentValue: unknown,
  completionValue: unknown,
): Readonly<DemandAggregateState> {
  const current = parseDemandAggregateState(currentValue);
  let completion: Readonly<DemandCompletion>;
  try {
    completion = parseDemandCompletion(completionValue);
  } catch (error: unknown) {
    if (error instanceof DemandCompletionError) {
      fail("transition", "$completion");
    }
    throw error;
  }
  const implementationTargets = current.targetTasks.filter(
    (target) => target.workType !== "test" && target.phase !== "superseded",
  );
  const testTargets = current.targetTasks.filter(
    (target) => target.workType === "test",
  );
  const openTestTargets = testTargets.filter(
    (target) => target.phase !== "test-product-defect",
  );
  const testingClosed =
    completion.testingMode === "controller-only"
      ? testTargets.length === 0
      : current.pendingTestRetest === undefined &&
        openTestTargets.length === 1 &&
        openTestTargets[0]?.phase === "test-accepted";
  if (
    current.lifecycle !== "active" ||
    completion.demandId !== current.demandId ||
    completion.authorityDigest !== current.authorityDigest ||
    completion.observedState.stateDigest !==
      computeDemandAggregateStateDigest(current) ||
    implementationTargets.length === 0 ||
    implementationTargets.some((target) => target.phase !== "accepted") ||
    current.awaitingDecision !== undefined ||
    current.continuation?.planningRequired === true ||
    !testingClosed
  ) {
    fail("transition", "$state");
  }
  return parseDemandAggregateState({
    ...current,
    lifecycle: "completed",
  });
}

export function computeDemandAggregateStateDigest(
  value: unknown,
): Sha256Digest {
  return computeCanonicalJsonSha256Digest(parseDemandAggregateState(value));
}
