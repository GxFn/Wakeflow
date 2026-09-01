import type {
  WakeflowDemandAggregateState as DemandAggregateStateWire,
  CurrentDelivery as ProductCurrentDeliveryWire,
  TestCurrentDelivery as TestCurrentDeliveryWire,
  TestClaimedCurrentDelivery as TestClaimedCurrentDeliveryWire,
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
import { WAKEFLOW_TEST_CARD_SCHEMA } from "../../../contracts/generated/governance/testing/test-card.generated.js";
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
  parsePortableResourcePath,
  PortableResourcePathError,
  type PortableResourcePath,
} from "../../../foundation/filesystem/portable-resource-path.js";
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
  computeTaskPackageDigest,
  parseTaskPackage,
  TaskPackageError,
  type TaskPackage,
  type TaskPackageCommitExpectation,
} from "../../tasking/task-package.js";
import {
  parseTargetDeliveryIntent,
  targetDeliveryPurpose,
  TargetDeliveryIntentError,
  type TargetDeliveryIntent,
} from "../../delivery/target-delivery-intent.js";
import {
  parseWindowWorkClaim,
  parseWindowWorkClaimId,
  WindowWorkClaimError,
  type WindowWorkClaim,
  type WindowWorkClaimId,
} from "../../delivery/window-work-claim.js";
import { windowWorkClaimRef } from "../../delivery/window-work-claim-resource-catalog.js";
import {
  parseTargetDeliveryHostEffectObservation,
  targetDeliveryHostEffectDisposition,
  TargetDeliveryHostEffectObservationError,
  type TargetDeliveryHostEffectDisposition,
  type TargetDeliveryHostEffectObservation,
} from "../../delivery/target-delivery-host-effect-observation.js";
import {
  parseTargetHostEffectRearm,
  TargetHostEffectRearmError,
  type TargetHostEffectRearm,
} from "../../delivery/target-host-effect-rearm.js";
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
  parseControllerTargetReviewResume,
  ControllerTargetReviewResumeError,
  type ControllerTargetReviewResume,
} from "../../review/controller-target-review-resume.js";
import {
  parseDemandCompletion,
  DemandCompletionError,
  type DemandCompletion,
} from "../../lifecycle/demand-completion.js";
import {
  parseTestCard,
  TestCardError,
  type TestCard,
} from "../../testing/test-card.js";
import {
  parseTestCardGenerationSource,
  TestCardGenerationSourceError,
  type TestCardGenerationSource,
} from "../../testing/test-card-generation-source.js";
import {
  assertRerunTestExecutionAttemptFollows,
  parseTestExecutionAttempt,
  TestExecutionAttemptError,
  type TestExecutionAttempt,
} from "../../testing/test-execution-attempt.js";
import {
  parseTestDeliveryIntent,
  MAXIMUM_TEST_DELIVERY_AUTHORIZATIONS_PER_ATTEMPT,
  TestDeliveryIntentError,
  type TestDeliveryIntent,
} from "../../testing/test-delivery-intent.js";
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
 * 完整 TaskPackage、TargetDeliveryIntent、WindowWorkClaim、Host Effect Observation、
 * Rearm、TargetResult 与Controller Review Decision仍属于事件数据；状态只保存当前
 * Delivery、Result和Review的最小摘要。`currentTestCard`只指向当前测试合同；已经
 * 观察到产品缺陷的旧Test Target继续作为历史代际保留自己的Card、attempt、Result与
 * Decision。`pendingTestRetest`只记录产品缺陷修复后尚待创建的一代复测，不复制完整
 * Authorization或事件历史。尚未实现的Evidence与Pod不使用空数组或null占位。
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
}

export interface DemandPlannedTargetTaskState extends DemandImplementationTargetTaskStateBase {
  readonly phase: "planned";
}

export interface DemandDeliveryPreparedTargetTaskState extends DemandImplementationTargetTaskStateBase {
  readonly phase: "delivery-prepared";
  readonly currentDelivery: Readonly<{
    readonly targetDeliveryId: WakeflowDurableId<"target-delivery">;
    readonly intentDigest: Sha256Digest;
    readonly hostId: WakeflowWorkspaceHostId;
    readonly bindingId: WakeflowWindowHostBindingId;
  }>;
}

export interface DemandWorkClaimSummary {
  readonly claimId: WindowWorkClaimId;
  readonly claimRef: PortableResourcePath;
  readonly claimDigest: Sha256Digest;
  readonly claimedAt: UtcInstant;
  readonly hostObservationAuthorityDigest: Sha256Digest;
  readonly claimEventId: WakeflowDurableId<"demand-event">;
  readonly claimCommitId: WakeflowDurableId<"demand-event-commit">;
  readonly claimEventStreamRevision: number;
  readonly claimExpectedStateDigest: Sha256Digest;
}

interface DemandHostEffectDeliveryBase {
  readonly targetDeliveryId: WakeflowDurableId<"target-delivery">;
  readonly intentDigest: Sha256Digest;
  readonly hostId: WakeflowWorkspaceHostId;
  readonly bindingId: WakeflowWindowHostBindingId;
  readonly workClaim: Readonly<DemandWorkClaimSummary>;
}

export interface DemandHostEffectClaimedTargetTaskState extends DemandImplementationTargetTaskStateBase {
  readonly phase: "host-effect-claimed";
  readonly currentDelivery: Readonly<DemandHostEffectDeliveryBase>;
}

export interface DemandHostEffectSummary {
  readonly observationDigest: Sha256Digest;
  readonly disposition: TargetDeliveryHostEffectDisposition;
  readonly readbackStatus: TargetDeliveryHostEffectObservation["readback"]["status"];
  readonly claimHandling: "retain" | "release-authorized";
  readonly observedAt: UtcInstant;
}

interface DemandObservedHostEffectTargetTaskStateBase extends DemandImplementationTargetTaskStateBase {
  readonly currentDelivery: Readonly<
    DemandHostEffectDeliveryBase & {
      readonly hostEffect: Readonly<DemandHostEffectSummary>;
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

export interface DemandTargetResultSummary {
  readonly targetResultId: WakeflowDurableId<"target-result">;
  readonly resultDigest: Sha256Digest;
  readonly outcome: TargetResult["report"]["outcome"];
  readonly reportedAt: UtcInstant;
  readonly claimHandling: "release-authorized";
}

export interface DemandResultReportedTargetTaskState extends DemandImplementationTargetTaskStateBase {
  readonly phase: "result-reported";
  readonly currentDelivery: Readonly<
    DemandHostEffectDeliveryBase & {
      readonly hostEffect: Readonly<DemandHostEffectSummary>;
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
    DemandHostEffectDeliveryBase & {
      readonly hostEffect: Readonly<DemandHostEffectSummary>;
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
  readonly failedCheckIds: readonly [string, ...string[]];
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

export interface DemandRedesignRequestedTargetTaskState extends DemandReviewedTargetTaskStateBase {
  readonly phase: "redesign-requested";
}

export interface DemandReviewBlockedTargetTaskState extends DemandReviewedTargetTaskStateBase {
  readonly phase: "review-blocked";
}

type DemandReviewedTargetPhase =
  | DemandAcceptedTargetTaskState["phase"]
  | DemandReworkRequestedTargetTaskState["phase"]
  | DemandRedesignRequestedTargetTaskState["phase"]
  | DemandReviewBlockedTargetTaskState["phase"];

export type DemandTargetTaskState =
  | DemandPlannedTargetTaskState
  | DemandDeliveryPreparedTargetTaskState
  | DemandHostEffectClaimedTargetTaskState
  | DemandHostEffectAcceptedTargetTaskState
  | DemandHostEffectIndeterminateTargetTaskState
  | DemandHostEffectRejectedTargetTaskState
  | DemandResultReportedTargetTaskState
  | DemandAcceptedTargetTaskState
  | DemandProductDefectReworkRequestedTargetTaskState
  | DemandReworkRequestedTargetTaskState
  | DemandRedesignRequestedTargetTaskState
  | DemandReviewBlockedTargetTaskState
  | DemandTestPlannedTargetTaskState
  | DemandTestDeliveryPreparedTargetTaskState
  | DemandTestHostEffectClaimedTargetTaskState
  | DemandTestHostEffectAcceptedTargetTaskState
  | DemandTestHostEffectIndeterminateTargetTaskState
  | DemandTestHostEffectRejectedTargetTaskState
  | DemandTestResultReportedTargetTaskState
  | DemandTestAcceptedTargetTaskState
  | DemandTestAnotherAttemptRequestedTargetTaskState
  | DemandTestProductDefectTargetTaskState
  | DemandTestReviewBlockedTargetTaskState;

interface DemandTestTargetTaskStateBase {
  readonly targetTaskId: WakeflowDurableId<"target-task">;
  readonly taskPackageId: WakeflowDurableId<"task-package">;
  readonly taskPackageDigest: Sha256Digest;
  readonly workType: "test";
  readonly windowId: WakeflowDurableId<"window">;
  readonly testCard: Readonly<DemandTestCardSummary>;
}

export interface DemandTestPlannedTargetTaskState extends DemandTestTargetTaskStateBase {
  readonly phase: "planned";
}

export interface DemandTestDeliveryAuthorizationSummary {
  readonly ordinal: number;
  readonly targetDeliveryId: WakeflowDurableId<"target-delivery">;
  readonly intentDigest: Sha256Digest;
  readonly preparedAt: UtcInstant;
}

export interface DemandTestAttemptState {
  readonly attempt: Readonly<TestExecutionAttempt>;
  readonly deliveryAuthorizations: readonly [
    Readonly<DemandTestDeliveryAuthorizationSummary>,
    ...Readonly<DemandTestDeliveryAuthorizationSummary>[],
  ];
}

export type DemandTestAttemptLineage = readonly [
  Readonly<DemandTestAttemptState>,
  ...Readonly<DemandTestAttemptState>[],
];

interface DemandTestCurrentDeliveryBase {
  readonly targetDeliveryId: WakeflowDurableId<"target-delivery">;
  readonly intentDigest: Sha256Digest;
  readonly hostId: WakeflowWorkspaceHostId;
  readonly bindingId: WakeflowWindowHostBindingId;
  readonly testAttemptId: WakeflowDurableId<"test-attempt">;
}

export interface DemandTestDeliveryPreparedTargetTaskState extends DemandTestTargetTaskStateBase {
  readonly phase: "test-delivery-prepared";
  readonly currentDelivery: Readonly<DemandTestCurrentDeliveryBase>;
  readonly testAttempts: DemandTestAttemptLineage;
}

export interface DemandTestWorkClaimSummary extends DemandWorkClaimSummary {
  readonly testDispatchPacketDigest: Sha256Digest;
}

export interface DemandTestHostEffectClaimedTargetTaskState extends DemandTestTargetTaskStateBase {
  readonly phase: "test-host-effect-claimed";
  readonly currentDelivery: Readonly<
    DemandTestCurrentDeliveryBase & {
      readonly workClaim: Readonly<DemandTestWorkClaimSummary>;
    }
  >;
  readonly testAttempts: DemandTestAttemptLineage;
}

interface DemandTestObservedHostEffectTargetTaskStateBase extends DemandTestTargetTaskStateBase {
  readonly currentDelivery: Readonly<
    DemandTestCurrentDeliveryBase & {
      readonly workClaim: Readonly<DemandTestWorkClaimSummary>;
      readonly hostEffect: Readonly<DemandHostEffectSummary>;
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
      readonly workClaim: Readonly<DemandTestWorkClaimSummary>;
      readonly hostEffect: Readonly<DemandHostEffectSummary>;
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
      readonly workClaim: Readonly<DemandTestWorkClaimSummary>;
      readonly hostEffect: Readonly<DemandHostEffectSummary>;
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

export interface DemandAggregateState {
  readonly artifactKind: typeof DEMAND_AGGREGATE_STATE_ARTIFACT_KIND;
  readonly schemaVersion: typeof DEMAND_AGGREGATE_STATE_SCHEMA_VERSION;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly authorityDigest: Sha256Digest;
  readonly lifecycle: DemandLifecycle;
  readonly targetTasks: readonly Readonly<DemandTargetTaskState>[];
  /** 当前可规划或执行的测试合同；历史Test Target保留自己的Card摘要。 */
  readonly currentTestCard?: Readonly<DemandTestCardSummary>;
  /** 已获Controller授权、尚未由新TestCard消费的一次产品缺陷复测。 */
  readonly pendingTestRetest?: Readonly<DemandPendingTestRetest>;
}

export type DemandPendingTestRetest = Extract<
  TestCardGenerationSource,
  Readonly<{ readonly kind: "product-defect-retest" }>
>;

export interface DemandTestCardSummary {
  readonly testCardId: WakeflowDurableId<"test-card">;
  readonly testCardDigest: Sha256Digest;
  readonly targetTaskId: WakeflowDurableId<"target-task">;
  readonly testWindowId: WakeflowDurableId<"window">;
}

export type DemandAggregateStateErrorReason =
  | "json"
  | "schema"
  | "identifier"
  | "digest"
  | "task-package"
  | "target-delivery-intent"
  | "window-work-claim"
  | "target-delivery-host-effect-observation"
  | "target-host-effect-rearm"
  | "target-result"
  | "controller-review-decision"
  | "controller-product-defect-remediation-authorization"
  | "controller-target-review-resume"
  | "test-card"
  | "test-card-generation-source"
  | "test-delivery-intent"
  | "relation"
  | "transition";

const ERROR_MESSAGES = {
  json: "Demand aggregate state is not passive JSON data.",
  schema: "Demand aggregate state does not satisfy its portable Schema.",
  identifier: "Demand aggregate state contains an invalid Demand identity.",
  digest: "Demand aggregate state contains an invalid digest.",
  "task-package":
    "Demand aggregate state transition contains an invalid TaskPackage.",
  "target-delivery-intent":
    "Demand aggregate state transition contains an invalid Target Delivery Intent.",
  "window-work-claim":
    "Demand aggregate state transition contains an invalid Window Work Claim.",
  "target-delivery-host-effect-observation":
    "Demand aggregate state transition contains an invalid Target Delivery Host Effect observation.",
  "target-host-effect-rearm":
    "Demand aggregate state transition contains an invalid Target Host Effect Rearm.",
  "target-result":
    "Demand aggregate state transition contains an invalid TargetResult.",
  "controller-review-decision":
    "Demand aggregate state transition contains an invalid Controller Review Decision.",
  "controller-product-defect-remediation-authorization":
    "Demand aggregate state transition contains an invalid Controller Product Defect Remediation Authorization.",
  "controller-target-review-resume":
    "Demand aggregate state transition contains an invalid Controller Target Review Resume.",
  "test-card":
    "Demand aggregate state transition contains an invalid TestCard.",
  "test-card-generation-source":
    "Demand aggregate state transition contains an invalid TestCard Generation Source.",
  "test-delivery-intent":
    "Demand aggregate state transition contains an invalid Test Delivery Intent.",
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
    WAKEFLOW_TEST_CARD_SCHEMA,
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
    | "test-attempt"
    | "test-card",
>(value: unknown, kind: Kind, path: string): WakeflowDurableId<Kind> {
  try {
    return parseWakeflowDurableIdOfKind(value, kind, path);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("identifier", path);
    throw error;
  }
}

function parseCurrentDeliveryBase(
  value: ProductCurrentDeliveryWire,
  path: string,
): DemandDeliveryPreparedTargetTaskState["currentDelivery"] {
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
  return Object.freeze({
    targetDeliveryId: parseId(
      value.targetDeliveryId,
      "target-delivery",
      `${path}/targetDeliveryId`,
    ),
    intentDigest: parseDigest(value.intentDigest, `${path}/intentDigest`),
    hostId: value.hostId,
    bindingId,
  });
}

function parseWorkClaimSummary(
  value: NonNullable<
    | ProductCurrentDeliveryWire["workClaim"]
    | TestClaimedCurrentDeliveryWire["workClaim"]
  >,
  windowId: WakeflowDurableId<"window">,
  path: string,
): DemandHostEffectClaimedTargetTaskState["currentDelivery"]["workClaim"] {
  let claimRef: PortableResourcePath;
  try {
    claimRef = parsePortableResourcePath(value.claimRef, `${path}/claimRef`);
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) {
      fail("relation", `${path}/claimRef`);
    }
    throw error;
  }
  if (claimRef !== windowWorkClaimRef(windowId)) {
    fail("relation", `${path}/claimRef`);
  }
  let claimId: WindowWorkClaimId;
  try {
    claimId = parseWindowWorkClaimId(value.claimId, `${path}/claimId`);
  } catch (error: unknown) {
    if (error instanceof WindowWorkClaimError) {
      fail("identifier", `${path}/claimId`);
    }
    throw error;
  }
  let claimedAt: UtcInstant;
  try {
    claimedAt = parseUtcInstant(value.claimedAt, `${path}/claimedAt`);
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) fail("relation", `${path}/claimedAt`);
    throw error;
  }
  return Object.freeze({
    claimId,
    claimRef,
    claimDigest: parseDigest(value.claimDigest, `${path}/claimDigest`),
    claimedAt,
    hostObservationAuthorityDigest: parseDigest(
      value.hostObservationAuthorityDigest,
      `${path}/hostObservationAuthorityDigest`,
    ),
    claimEventId: parseId(
      value.claimEventId,
      "demand-event",
      `${path}/claimEventId`,
    ),
    claimCommitId: parseId(
      value.claimCommitId,
      "demand-event-commit",
      `${path}/claimCommitId`,
    ),
    claimEventStreamRevision: value.claimEventStreamRevision,
    claimExpectedStateDigest: parseDigest(
      value.claimExpectedStateDigest,
      `${path}/claimExpectedStateDigest`,
    ),
  });
}

function parseTestWorkClaimSummary(
  value: NonNullable<
    | TestClaimedCurrentDeliveryWire["workClaim"]
    | TestObservedCurrentDeliveryWire["workClaim"]
  >,
  windowId: WakeflowDurableId<"window">,
  path: string,
): Readonly<DemandTestWorkClaimSummary> {
  return Object.freeze({
    ...parseWorkClaimSummary(value, windowId, path),
    testDispatchPacketDigest: parseDigest(
      value.testDispatchPacketDigest,
      `${path}/testDispatchPacketDigest`,
    ),
  });
}

function parseHostEffectSummary(
  value: NonNullable<
    | ProductCurrentDeliveryWire["hostEffect"]
    | TestObservedCurrentDeliveryWire["hostEffect"]
  >,
  path: string,
): Readonly<DemandHostEffectSummary> {
  let observedAt: UtcInstant;
  try {
    observedAt = parseUtcInstant(value.observedAt, `${path}/observedAt`);
  } catch (error: unknown) {
    if (error instanceof UtcInstantError)
      fail("relation", `${path}/observedAt`);
    throw error;
  }
  // observedAt 只保留来源时钟的审计事实；Aggregate 的因果顺序由 Event 流修订、
  // 当前状态摘要和 Observation 对 Claim 的精确引用保证，不比较跨来源墙钟。
  return Object.freeze({
    observationDigest: parseDigest(
      value.observationDigest,
      `${path}/observationDigest`,
    ),
    disposition: value.disposition,
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
  return Object.freeze({
    targetResultId: parseId(
      value.targetResultId,
      "target-result",
      `${path}/targetResultId`,
    ),
    resultDigest: parseDigest(value.resultDigest, `${path}/resultDigest`),
    outcome: value.outcome,
    reportedAt,
    claimHandling: "release-authorized" as const,
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
      : decision === "redesign"
        ? "redesign-requested"
        : "review-blocked";
}

function testReviewPhaseForDecision(
  decision: ControllerTestReviewDecision["decision"],
): DemandTargetTaskState["phase"] {
  return decision === "accept"
    ? "test-accepted"
    : decision === "request-another-attempt"
      ? "test-another-attempt-requested"
      : decision === "escalate-product-defect"
        ? "test-product-defect"
        : "test-review-blocked";
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

function parseTestCardSummary(
  value: Readonly<
    NonNullable<DemandAggregateStateWire["targetTasks"][number]["testCard"]>
  >,
  path: string,
): Readonly<DemandTestCardSummary> {
  return Object.freeze({
    testCardId: parseId(value.testCardId, "test-card", `${path}/testCardId`),
    testCardDigest: parseDigest(value.testCardDigest, `${path}/testCardDigest`),
    targetTaskId: parseId(
      value.targetTaskId,
      "target-task",
      `${path}/targetTaskId`,
    ),
    testWindowId: parseId(value.testWindowId, "window", `${path}/testWindowId`),
  });
}

function testTargetMatchesCard(
  target: Readonly<DemandTestTargetTaskStateBase>,
  testCard: Readonly<DemandTestCardSummary>,
): boolean {
  return (
    target.targetTaskId === testCard.targetTaskId &&
    target.windowId === testCard.testWindowId &&
    target.testCard.testCardId === testCard.testCardId &&
    target.testCard.testCardDigest === testCard.testCardDigest
  );
}

function parsePendingTestRetest(
  value: unknown,
): Readonly<DemandPendingTestRetest> {
  let source: Readonly<TestCardGenerationSource>;
  try {
    source = parseTestCardGenerationSource(value);
  } catch (error: unknown) {
    if (error instanceof TestCardGenerationSourceError) {
      fail("test-card-generation-source", "$/pendingTestRetest");
    }
    throw error;
  }
  if (source.kind !== "product-defect-retest") {
    fail("relation", "$/pendingTestRetest/kind");
  }
  return source;
}

function pendingTestRetestMatches(
  left: Readonly<DemandPendingTestRetest>,
  right: Readonly<DemandPendingTestRetest>,
): boolean {
  return (
    left.previousTestCard.testCardId === right.previousTestCard.testCardId &&
    left.previousTestCard.testCardDigest ===
      right.previousTestCard.testCardDigest &&
    left.testReviewDecision.targetReviewDecisionId ===
      right.testReviewDecision.targetReviewDecisionId &&
    left.testReviewDecision.decisionDigest ===
      right.testReviewDecision.decisionDigest &&
    left.productDefectRemediation.productDefectRemediationId ===
      right.productDefectRemediation.productDefectRemediationId &&
    left.productDefectRemediation.authorizationDigest ===
      right.productDefectRemediation.authorizationDigest
  );
}

function parseProductDefectRemediationSummary(
  value: Readonly<ProductDefectRemediationWire>,
  acceptedDecision: Readonly<DemandTargetReviewDecisionSummary>,
  path: string,
): Readonly<DemandProductDefectRemediationSummary> {
  const parsedCheckIds = parseAcceptanceAnchorIds(
    value.failedCheckIds,
    `${path}/failedCheckIds`,
  );
  if (
    parsedCheckIds.some(
      (check, index) =>
        index > 0 && compareText(parsedCheckIds[index - 1]!, check) >= 0,
    )
  ) {
    fail("relation", `${path}/failedCheckIds`);
  }
  const firstCheckId = parsedCheckIds[0];
  if (firstCheckId === undefined) {
    fail("relation", `${path}/failedCheckIds`);
  }
  const failedCheckIds: DemandProductDefectRemediationSummary["failedCheckIds"] =
    Object.freeze([firstCheckId, ...parsedCheckIds.slice(1)]);
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
    failedCheckIds,
    correctionObjective: value.correctionObjective,
    authorizedAt,
  });
}

function parseTestCurrentDelivery(
  value: Readonly<
    | TestCurrentDeliveryWire
    | TestClaimedCurrentDeliveryWire
    | TestObservedCurrentDeliveryWire
    | TestResultCurrentDeliveryWire
    | TestReviewedCurrentDeliveryWire
  >,
  path: string,
): Readonly<DemandTestCurrentDeliveryBase> {
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
  return Object.freeze({
    targetDeliveryId: parseId(
      value.targetDeliveryId,
      "target-delivery",
      `${path}/targetDeliveryId`,
    ),
    intentDigest: parseDigest(value.intentDigest, `${path}/intentDigest`),
    hostId: value.hostId,
    bindingId,
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
  const authorizationValues = value.deliveryAuthorizations;
  if (
    authorizationValues.length === 0 ||
    authorizationValues.length >
      MAXIMUM_TEST_DELIVERY_AUTHORIZATIONS_PER_ATTEMPT
  ) {
    fail("relation", `${path}/deliveryAuthorizations`);
  }
  const parsedAuthorizations = authorizationValues.map(
    (authorization, index) => {
      const authorizationPath = `${path}/deliveryAuthorizations/${index}`;
      let preparedAt: UtcInstant;
      try {
        preparedAt = parseUtcInstant(
          authorization.preparedAt,
          `${authorizationPath}/preparedAt`,
        );
      } catch (error: unknown) {
        if (error instanceof UtcInstantError) {
          fail("relation", `${authorizationPath}/preparedAt`);
        }
        throw error;
      }
      return Object.freeze({
        ordinal: authorization.ordinal,
        targetDeliveryId: parseId(
          authorization.targetDeliveryId,
          "target-delivery",
          `${authorizationPath}/targetDeliveryId`,
        ),
        intentDigest: parseDigest(
          authorization.intentDigest,
          `${authorizationPath}/intentDigest`,
        ),
        preparedAt,
      });
    },
  );
  if (
    new Set(parsedAuthorizations.map((entry) => entry.targetDeliveryId))
      .size !== parsedAuthorizations.length ||
    parsedAuthorizations.some((entry, index) => entry.ordinal !== index + 1)
  ) {
    fail("relation", `${path}/deliveryAuthorizations`);
  }
  const firstAuthorization = parsedAuthorizations[0];
  if (firstAuthorization === undefined) {
    fail("relation", `${path}/deliveryAuthorizations`);
  }
  const deliveryAuthorizations: DemandTestAttemptState["deliveryAuthorizations"] =
    Object.freeze([firstAuthorization, ...parsedAuthorizations.slice(1)]);
  return Object.freeze({
    attempt,
    deliveryAuthorizations,
  });
}

function parseTestAttemptLineage(
  values: readonly TestAttemptStateWire[],
  targetTaskId: WakeflowDurableId<"target-task">,
  testCard: Readonly<DemandTestCardSummary>,
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
      attempt.targetTaskId !== targetTaskId ||
      attempt.testCard.testCardId !== testCard.testCardId ||
      attempt.testCard.testCardDigest !== testCard.testCardDigest ||
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
    for (const authorization of state.deliveryAuthorizations) {
      if (deliveryIds.has(authorization.targetDeliveryId)) {
        fail("relation", `${path}/${index}/deliveryAuthorizations`);
      }
      deliveryIds.add(authorization.targetDeliveryId);
    }
  }
  return Object.freeze([first, ...attempts.slice(1)]);
}

function parseTargetTasks(
  values: readonly DemandAggregateStateWire["targetTasks"][number][],
): readonly Readonly<DemandTargetTaskState>[] {
  const result: Readonly<DemandTargetTaskState>[] = [];
  const packageIds = new Set<string>();
  const repositoryIds = new Set<string>();
  const testCardIds = new Set<string>();
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
    if (value.workType === "test") {
      if (value.testCard === undefined) {
        fail("relation", path);
      }
      const testCard = parseTestCardSummary(value.testCard, `${path}/testCard`);
      if (
        testCardIds.has(testCard.testCardId) ||
        testCard.targetTaskId !== common.targetTaskId ||
        testCard.testWindowId !== common.windowId
      ) {
        fail("relation", `${path}/testCard`);
      }
      testCardIds.add(testCard.testCardId);
      if (value.phase === "planned") {
        result.push(
          Object.freeze({
            ...common,
            workType: "test" as const,
            testCard,
            phase: "planned" as const,
          }),
        );
        continue;
      }
      if (
        (value.phase !== "test-delivery-prepared" &&
          value.phase !== "test-host-effect-claimed" &&
          value.phase !== "test-host-effect-accepted" &&
          value.phase !== "test-host-effect-indeterminate" &&
          value.phase !== "test-host-effect-rejected" &&
          value.phase !== "test-result-reported" &&
          value.phase !== "test-accepted" &&
          value.phase !== "test-another-attempt-requested" &&
          value.phase !== "test-product-defect" &&
          value.phase !== "test-review-blocked") ||
        value.currentDelivery === undefined ||
        value.testAttempts === undefined ||
        value.testAttempts.length > 10
      ) {
        fail("relation", path);
      }
      const currentDelivery = parseTestCurrentDelivery(
        value.currentDelivery as
          | TestCurrentDeliveryWire
          | TestClaimedCurrentDeliveryWire
          | TestObservedCurrentDeliveryWire
          | TestResultCurrentDeliveryWire
          | TestReviewedCurrentDeliveryWire,
        `${path}/currentDelivery`,
      );
      const testAttempts = parseTestAttemptLineage(
        value.testAttempts,
        common.targetTaskId,
        testCard,
        `${path}/testAttempts`,
      );
      const attemptState = testAttempts.at(-1)!;
      const authorization = attemptState.deliveryAuthorizations.at(-1)!;
      if (
        attemptState.attempt.targetTaskId !== common.targetTaskId ||
        attemptState.attempt.testCard.testCardId !== testCard.testCardId ||
        attemptState.attempt.testCard.testCardDigest !==
          testCard.testCardDigest ||
        currentDelivery.testAttemptId !== attemptState.attempt.testAttemptId ||
        currentDelivery.targetDeliveryId !== authorization.targetDeliveryId ||
        currentDelivery.intentDigest !== authorization.intentDigest
      ) {
        fail("relation", `${path}/testAttempts`);
      }
      if (value.phase === "test-delivery-prepared") {
        result.push(
          Object.freeze({
            ...common,
            workType: "test" as const,
            testCard,
            phase: "test-delivery-prepared" as const,
            currentDelivery,
            testAttempts,
          }),
        );
      } else if (value.phase === "test-host-effect-claimed") {
        const claimedDelivery =
          value.currentDelivery as TestClaimedCurrentDeliveryWire;
        if (claimedDelivery.workClaim === undefined) {
          fail("relation", `${path}/currentDelivery/workClaim`);
        }
        result.push(
          Object.freeze({
            ...common,
            workType: "test" as const,
            testCard,
            phase: "test-host-effect-claimed" as const,
            currentDelivery: Object.freeze({
              ...currentDelivery,
              workClaim: parseTestWorkClaimSummary(
                claimedDelivery.workClaim,
                common.windowId,
                `${path}/currentDelivery/workClaim`,
              ),
            }),
            testAttempts,
          }),
        );
      } else if (
        value.phase === "test-accepted" ||
        value.phase === "test-another-attempt-requested" ||
        value.phase === "test-product-defect" ||
        value.phase === "test-review-blocked"
      ) {
        const reviewedDelivery =
          value.currentDelivery as TestReviewedCurrentDeliveryWire;
        if (
          reviewedDelivery.workClaim === undefined ||
          reviewedDelivery.hostEffect === undefined ||
          reviewedDelivery.targetResult === undefined ||
          reviewedDelivery.reviewDecision === undefined
        ) {
          fail("relation", `${path}/currentDelivery`);
        }
        const workClaim = parseTestWorkClaimSummary(
          reviewedDelivery.workClaim,
          common.windowId,
          `${path}/currentDelivery/workClaim`,
        );
        const hostEffect = parseHostEffectSummary(
          reviewedDelivery.hostEffect,
          `${path}/currentDelivery/hostEffect`,
        );
        if (hostEffect.disposition === "rejected-before-effect") {
          fail("relation", `${path}/currentDelivery/hostEffect`);
        }
        const targetResult = parseTargetResultSummary(
          reviewedDelivery.targetResult,
          `${path}/currentDelivery/targetResult`,
        );
        const reviewDecision = parseTestReviewDecisionSummary(
          reviewedDelivery.reviewDecision,
          `${path}/currentDelivery/reviewDecision`,
        );
        const expectedPhase = testReviewPhaseForDecision(
          reviewDecision.decision,
        );
        if (value.phase !== expectedPhase) {
          fail("relation", `${path}/phase`);
        }
        result.push(
          Object.freeze({
            ...common,
            workType: "test" as const,
            testCard,
            phase: expectedPhase,
            currentDelivery: Object.freeze({
              ...currentDelivery,
              workClaim,
              hostEffect,
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
          resultDelivery.workClaim === undefined ||
          resultDelivery.hostEffect === undefined ||
          resultDelivery.targetResult === undefined
        ) {
          fail("relation", `${path}/currentDelivery`);
        }
        const workClaim = parseTestWorkClaimSummary(
          resultDelivery.workClaim,
          common.windowId,
          `${path}/currentDelivery/workClaim`,
        );
        const hostEffect = parseHostEffectSummary(
          resultDelivery.hostEffect,
          `${path}/currentDelivery/hostEffect`,
        );
        if (hostEffect.disposition === "rejected-before-effect") {
          fail("relation", `${path}/currentDelivery/hostEffect`);
        }
        result.push(
          Object.freeze({
            ...common,
            workType: "test" as const,
            testCard,
            phase: "test-result-reported" as const,
            currentDelivery: Object.freeze({
              ...currentDelivery,
              workClaim,
              hostEffect,
              targetResult: parseTargetResultSummary(
                resultDelivery.targetResult,
                `${path}/currentDelivery/targetResult`,
              ),
            }),
            testAttempts,
          }),
        );
      } else {
        const observedDelivery =
          value.currentDelivery as TestObservedCurrentDeliveryWire;
        if (
          observedDelivery.workClaim === undefined ||
          observedDelivery.hostEffect === undefined
        ) {
          fail("relation", `${path}/currentDelivery`);
        }
        const workClaim = parseTestWorkClaimSummary(
          observedDelivery.workClaim,
          common.windowId,
          `${path}/currentDelivery/workClaim`,
        );
        const hostEffect = parseHostEffectSummary(
          observedDelivery.hostEffect,
          `${path}/currentDelivery/hostEffect`,
        );
        const expectedPhase =
          hostEffect.disposition === "accepted"
            ? ("test-host-effect-accepted" as const)
            : hostEffect.disposition === "indeterminate"
              ? ("test-host-effect-indeterminate" as const)
              : ("test-host-effect-rejected" as const);
        if (value.phase !== expectedPhase) fail("relation", `${path}/phase`);
        result.push(
          Object.freeze({
            ...common,
            workType: "test" as const,
            testCard,
            phase: expectedPhase,
            currentDelivery: Object.freeze({
              ...currentDelivery,
              workClaim,
              hostEffect,
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
    if (repositoryIds.has(repositoryId)) fail("relation", path);
    repositoryIds.add(repositoryId);
    const base = {
      ...common,
      repositoryId,
      commitExpectation: value.commitExpectation,
      acceptanceAnchorIds: parseAcceptanceAnchorIds(
        value.acceptanceAnchorIds,
        `${path}/acceptanceAnchorIds`,
      ),
    };
    const productCurrentDelivery = value.currentDelivery as
      ProductCurrentDeliveryWire | undefined;
    if (value.phase === "planned") {
      result.push(Object.freeze({ ...base, phase: "planned" as const }));
    } else if (value.phase === "delivery-prepared") {
      if (productCurrentDelivery === undefined) {
        fail("relation", `${path}/currentDelivery`);
      }
      result.push(
        Object.freeze({
          ...base,
          phase: "delivery-prepared" as const,
          currentDelivery: parseCurrentDeliveryBase(
            productCurrentDelivery,
            `${path}/currentDelivery`,
          ),
        }),
      );
    } else {
      if (
        productCurrentDelivery === undefined ||
        productCurrentDelivery.workClaim === undefined
      ) {
        fail("relation", `${path}/currentDelivery/workClaim`);
      }
      const workClaim = parseWorkClaimSummary(
        productCurrentDelivery.workClaim,
        base.windowId,
        `${path}/currentDelivery/workClaim`,
      );
      const currentDelivery = Object.freeze({
        ...parseCurrentDeliveryBase(
          productCurrentDelivery,
          `${path}/currentDelivery`,
        ),
        workClaim,
      });
      if (value.phase === "host-effect-claimed") {
        result.push(
          Object.freeze({
            ...base,
            phase: "host-effect-claimed" as const,
            currentDelivery,
          }),
        );
      } else {
        if (productCurrentDelivery.hostEffect === undefined) {
          fail("relation", `${path}/currentDelivery/hostEffect`);
        }
        const observedDelivery = Object.freeze({
          ...currentDelivery,
          hostEffect: parseHostEffectSummary(
            productCurrentDelivery.hostEffect,
            `${path}/currentDelivery/hostEffect`,
          ),
        });
        if (value.phase === "host-effect-accepted") {
          result.push(
            Object.freeze({
              ...base,
              phase: "host-effect-accepted" as const,
              currentDelivery: observedDelivery,
            }),
          );
        } else if (value.phase === "host-effect-indeterminate") {
          result.push(
            Object.freeze({
              ...base,
              phase: "host-effect-indeterminate" as const,
              currentDelivery: observedDelivery,
            }),
          );
        } else if (value.phase === "host-effect-rejected") {
          result.push(
            Object.freeze({
              ...base,
              phase: "host-effect-rejected" as const,
              currentDelivery: observedDelivery,
            }),
          );
        } else {
          if (productCurrentDelivery.targetResult === undefined) {
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
          } else {
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
                  productDefectRemediation:
                    parseProductDefectRemediationSummary(
                      value.productDefectRemediation,
                      reviewDecision,
                      `${path}/productDefectRemediation`,
                    ),
                }),
              );
            } else {
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
          }
        }
      }
    }
  }
  return Object.freeze(result);
}

/** `delivery.target-delivery-prepared` 当前事件使用的纯状态转换。 */
export function prepareTargetDeliveryInDemandAggregateState(
  currentValue: unknown,
  intentValue: unknown,
): Readonly<DemandAggregateState> {
  const current = parseDemandAggregateState(currentValue);
  let intent: Readonly<TargetDeliveryIntent>;
  try {
    intent = parseTargetDeliveryIntent(intentValue);
  } catch (error: unknown) {
    if (error instanceof TargetDeliveryIntentError) {
      fail("target-delivery-intent", "$intent");
    }
    throw error;
  }
  const target = current.targetTasks.find(
    (entry) => entry.targetTaskId === intent.target.targetTaskId,
  );
  if (
    current.lifecycle !== "active" ||
    intent.demandId !== current.demandId ||
    target === undefined ||
    target.workType === "test" ||
    target.taskPackageId !== intent.target.taskPackageId ||
    target.taskPackageDigest !== intent.target.taskPackageDigest ||
    target.windowId !== intent.route.windowId
  ) {
    fail("transition", "$/targetTasks");
  }
  const purpose = targetDeliveryPurpose(intent);
  if (target.phase === "planned") {
    if (purpose !== "initial") {
      fail("transition", "$/targetTasks");
    }
  } else if (target.phase === "rework-requested") {
    if (
      purpose !== "implementation-review-rework" ||
      intent.rework === undefined ||
      intent.targetDeliveryId === target.currentDelivery.targetDeliveryId ||
      intent.rework.decision.targetReviewDecisionId !==
        target.currentDelivery.reviewDecision.targetReviewDecisionId ||
      intent.rework.decision.decisionDigest !==
        target.currentDelivery.reviewDecision.decisionDigest ||
      intent.rework.previousResult.targetResultId !==
        target.currentDelivery.targetResult.targetResultId ||
      intent.rework.previousResult.resultDigest !==
        target.currentDelivery.targetResult.resultDigest
    ) {
      fail("transition", "$/targetTasks");
    }
  } else if (target.phase === "product-defect-rework-requested") {
    const remediation = intent.productDefectRemediation;
    if (
      purpose !== "product-defect-remediation" ||
      remediation === undefined ||
      intent.targetDeliveryId === target.currentDelivery.targetDeliveryId ||
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
        target.productDefectRemediation.failedCheckIds.length ||
      remediation.requiredCorrections.some(
        (correction, index) =>
          correction.checkId !==
          target.productDefectRemediation.failedCheckIds[index],
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
          currentDelivery: {
            targetDeliveryId: intent.targetDeliveryId,
            intentDigest: intent.intentDigest,
            hostId: intent.route.hostId,
            bindingId: intent.route.bindingId,
          },
        };
      }
      return {
        ...target,
        phase: "delivery-prepared",
        currentDelivery: {
          targetDeliveryId: intent.targetDeliveryId,
          intentDigest: intent.intentDigest,
          hostId: intent.route.hostId,
          bindingId: intent.route.bindingId,
        },
      };
    }),
  });
}

/** `testing.test-delivery-prepared.v1`使用的Test Delivery授权状态转换。 */
export function prepareTestDeliveryInDemandAggregateState(
  currentValue: unknown,
  intentValue: unknown,
): Readonly<DemandAggregateState> {
  const current = parseDemandAggregateState(currentValue);
  let intent: Readonly<TestDeliveryIntent>;
  try {
    intent = parseTestDeliveryIntent(intentValue);
  } catch (error: unknown) {
    if (error instanceof TestDeliveryIntentError) {
      fail("test-delivery-intent", "$intent");
    }
    throw error;
  }
  const target = current.targetTasks.find(
    (entry) => entry.targetTaskId === intent.target.targetTaskId,
  );
  if (
    current.lifecycle !== "active" ||
    current.currentTestCard === undefined ||
    intent.demandId !== current.demandId ||
    target === undefined ||
    target.workType !== "test" ||
    target.taskPackageId !== intent.target.taskPackageId ||
    target.taskPackageDigest !== intent.target.taskPackageDigest ||
    target.windowId !== intent.route.windowId ||
    target.testCard.testCardId !== intent.target.testCard.testCardId ||
    target.testCard.testCardDigest !== intent.target.testCard.testCardDigest ||
    current.currentTestCard.testCardId !== intent.target.testCard.testCardId ||
    current.currentTestCard.testCardDigest !==
      intent.target.testCard.testCardDigest ||
    intent.attempt.targetTaskId !== target.targetTaskId ||
    intent.attempt.testCard.testCardId !== target.testCard.testCardId ||
    intent.attempt.testCard.testCardDigest !== target.testCard.testCardDigest ||
    current.targetTasks.some(
      (entry) =>
        "currentDelivery" in entry &&
        entry.currentDelivery.targetDeliveryId === intent.targetDeliveryId,
    )
  ) {
    fail("transition", "$/targetTasks");
  }
  if (intent.replacement === undefined) {
    if (intent.attempt.mode === "initial") {
      if (target.phase !== "planned") {
        fail("transition", "$/targetTasks");
      }
      return parseDemandAggregateState({
        ...current,
        targetTasks: current.targetTasks.map((entry) =>
          entry.targetTaskId === target.targetTaskId
            ? {
                ...target,
                phase: "test-delivery-prepared",
                currentDelivery: {
                  targetDeliveryId: intent.targetDeliveryId,
                  intentDigest: intent.intentDigest,
                  hostId: intent.route.hostId,
                  bindingId: intent.route.bindingId,
                  testAttemptId: intent.attempt.testAttemptId,
                },
                testAttempts: [
                  {
                    attempt: intent.attempt,
                    deliveryAuthorizations: [
                      {
                        ordinal: 1,
                        targetDeliveryId: intent.targetDeliveryId,
                        intentDigest: intent.intentDigest,
                        preparedAt: intent.preparedAt,
                      },
                    ],
                  },
                ],
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
        intent.attempt,
        previousAttempt.attempt,
      );
    } catch (error: unknown) {
      if (error instanceof TestExecutionAttemptError) {
        fail("transition", "$/targetTasks");
      }
      throw error;
    }
    if (
      target.testAttempts.length >= 10 ||
      target.testAttempts.some(
        (entry) => entry.attempt.testAttemptId === intent.attempt.testAttemptId,
      ) ||
      intent.attempt.rerunSource.previousResult.targetResultId !==
        target.currentDelivery.targetResult.targetResultId ||
      intent.attempt.rerunSource.previousResult.resultDigest !==
        target.currentDelivery.targetResult.resultDigest ||
      intent.attempt.rerunSource.reviewDecision.targetReviewDecisionId !==
        target.currentDelivery.reviewDecision.targetReviewDecisionId ||
      intent.attempt.rerunSource.reviewDecision.decisionDigest !==
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
              currentDelivery: {
                targetDeliveryId: intent.targetDeliveryId,
                intentDigest: intent.intentDigest,
                hostId: intent.route.hostId,
                bindingId: intent.route.bindingId,
                testAttemptId: intent.attempt.testAttemptId,
              },
              testAttempts: [
                ...target.testAttempts,
                {
                  attempt: intent.attempt,
                  deliveryAuthorizations: [
                    {
                      ordinal: 1,
                      targetDeliveryId: intent.targetDeliveryId,
                      intentDigest: intent.intentDigest,
                      preparedAt: intent.preparedAt,
                    },
                  ],
                },
              ],
            }
          : entry,
      ),
    });
  }
  if (target.phase !== "test-host-effect-rejected") {
    fail("transition", "$/targetTasks");
  }
  const attemptState = target.testAttempts.at(-1)!;
  const previousAuthorization = attemptState.deliveryAuthorizations.at(-1)!;
  const replacement = intent.replacement;
  if (
    replacement.authorizationOrdinal !==
      attemptState.deliveryAuthorizations.length + 1 ||
    replacement.previousDelivery.targetDeliveryId !==
      target.currentDelivery.targetDeliveryId ||
    replacement.previousDelivery.targetDeliveryId !==
      previousAuthorization.targetDeliveryId ||
    replacement.previousDelivery.intentDigest !==
      target.currentDelivery.intentDigest ||
    replacement.previousDelivery.intentDigest !==
      previousAuthorization.intentDigest ||
    replacement.previousDelivery.testDispatchPacketDigest !==
      target.currentDelivery.workClaim.testDispatchPacketDigest ||
    replacement.rejectedHostEffect.claimId !==
      target.currentDelivery.workClaim.claimId ||
    replacement.rejectedHostEffect.claimDigest !==
      target.currentDelivery.workClaim.claimDigest ||
    replacement.rejectedHostEffect.claimEventId !==
      target.currentDelivery.workClaim.claimEventId ||
    replacement.rejectedHostEffect.claimCommitId !==
      target.currentDelivery.workClaim.claimCommitId ||
    replacement.rejectedHostEffect.observationDigest !==
      target.currentDelivery.hostEffect.observationDigest ||
    replacement.rejectedHostEffect.observedAt !==
      target.currentDelivery.hostEffect.observedAt ||
    target.currentDelivery.hostEffect.disposition !==
      "rejected-before-effect" ||
    target.currentDelivery.hostEffect.claimHandling !== "release-authorized" ||
    intent.attempt.testAttemptId !== attemptState.attempt.testAttemptId
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
            currentDelivery: {
              targetDeliveryId: intent.targetDeliveryId,
              intentDigest: intent.intentDigest,
              hostId: intent.route.hostId,
              bindingId: intent.route.bindingId,
              testAttemptId: intent.attempt.testAttemptId,
            },
            testAttempts: [
              ...target.testAttempts.slice(0, -1),
              {
                attempt: attemptState.attempt,
                deliveryAuthorizations: [
                  ...attemptState.deliveryAuthorizations,
                  {
                    ordinal: replacement.authorizationOrdinal,
                    targetDeliveryId: intent.targetDeliveryId,
                    intentDigest: intent.intentDigest,
                    preparedAt: intent.preparedAt,
                  },
                ],
              },
            ],
          }
        : entry,
    ),
  });
}

/** `delivery.target-host-effect-claimed.v1` 使用的纯状态转换。 */
export function claimTargetHostEffectInDemandAggregateState(
  currentValue: unknown,
  claimValue: unknown,
): Readonly<DemandAggregateState> {
  const current = parseDemandAggregateState(currentValue);
  let claim: Readonly<WindowWorkClaim>;
  try {
    claim = parseWindowWorkClaim(claimValue);
  } catch (error: unknown) {
    if (error instanceof WindowWorkClaimError) {
      fail("window-work-claim", "$claim");
    }
    throw error;
  }
  const target = current.targetTasks.find(
    (entry) => entry.targetTaskId === claim.target.targetTaskId,
  );
  if (
    current.lifecycle !== "active" ||
    claim.target.demandId !== current.demandId ||
    target === undefined ||
    target.windowId !== claim.route.windowId ||
    claim.claimTransition.expectedStateDigest !==
      computeDemandAggregateStateDigest(current)
  ) {
    fail("transition", "$/targetTasks");
  }
  const workClaim = {
    claimId: claim.claimId,
    claimRef: windowWorkClaimRef(claim.route.windowId),
    claimDigest: claim.claimDigest,
    claimedAt: claim.claimedAt,
    hostObservationAuthorityDigest: claim.hostObservation.authorityDigest,
    claimEventId: claim.claimTransition.eventId,
    claimCommitId: claim.claimTransition.commitId,
    claimEventStreamRevision: claim.claimTransition.expectedStreamRevision + 1,
    claimExpectedStateDigest: claim.claimTransition.expectedStateDigest,
  } as const;
  if (target.workType === "test") {
    const claimTarget = claim.target;
    if (
      !("workType" in claimTarget) ||
      claimTarget.workType !== "test" ||
      target.phase !== "test-delivery-prepared" ||
      target.currentDelivery.targetDeliveryId !==
        claimTarget.targetDeliveryId ||
      target.currentDelivery.intentDigest !== claimTarget.intentDigest ||
      target.currentDelivery.hostId !== claim.route.hostId ||
      target.currentDelivery.bindingId !== claim.route.bindingId ||
      target.currentDelivery.testAttemptId !== claimTarget.testAttemptId
    ) {
      fail("transition", "$/targetTasks");
    }
    return parseDemandAggregateState({
      ...current,
      targetTasks: current.targetTasks.map((entry) =>
        entry.targetTaskId === target.targetTaskId
          ? {
              ...entry,
              phase: "test-host-effect-claimed",
              currentDelivery: {
                ...target.currentDelivery,
                workClaim: {
                  ...workClaim,
                  testDispatchPacketDigest:
                    claimTarget.testDispatchPacketDigest,
                },
              },
            }
          : entry,
      ),
    });
  }
  if (
    "workType" in claim.target ||
    target.phase !== "delivery-prepared" ||
    target.currentDelivery.targetDeliveryId !== claim.target.targetDeliveryId ||
    target.currentDelivery.intentDigest !== claim.target.intentDigest ||
    target.currentDelivery.hostId !== claim.route.hostId ||
    target.currentDelivery.bindingId !== claim.route.bindingId
  ) {
    fail("transition", "$/targetTasks");
  }
  return parseDemandAggregateState({
    ...current,
    targetTasks: current.targetTasks.map((entry) =>
      entry.targetTaskId === target.targetTaskId
        ? {
            ...entry,
            phase: "host-effect-claimed",
            currentDelivery: {
              ...target.currentDelivery,
              workClaim,
            },
          }
        : entry,
    ),
  });
}

/** `delivery.target-host-effect-observed.v1` 使用的纯状态转换。 */
export function observeTargetHostEffectInDemandAggregateState(
  currentValue: unknown,
  observationValue: unknown,
): Readonly<DemandAggregateState> {
  const current = parseDemandAggregateState(currentValue);
  let observation: Readonly<TargetDeliveryHostEffectObservation>;
  try {
    observation = parseTargetDeliveryHostEffectObservation(observationValue);
  } catch (error: unknown) {
    if (error instanceof TargetDeliveryHostEffectObservationError) {
      fail("target-delivery-host-effect-observation", "$observation");
    }
    throw error;
  }
  const deliveryTargets = current.targetTasks.filter(
    (
      entry,
    ): entry is Exclude<
      DemandTargetTaskState,
      DemandPlannedTargetTaskState | DemandTestPlannedTargetTaskState
    > => entry.phase !== "planned",
  );
  const candidates = deliveryTargets.filter(
    (entry) =>
      entry.currentDelivery.targetDeliveryId ===
      observation.action.targetDeliveryId,
  );
  const target = candidates.length === 1 ? candidates[0] : undefined;
  if (
    target === undefined ||
    (target.phase !== "host-effect-claimed" &&
      target.phase !== "test-host-effect-claimed")
  ) {
    fail("transition", "$/targetTasks");
  }
  if (
    current.lifecycle !== "active" ||
    target.windowId !== observation.action.windowId ||
    target.currentDelivery.intentDigest !== observation.action.intentDigest ||
    target.currentDelivery.hostId !== observation.action.hostId ||
    target.currentDelivery.bindingId !== observation.action.bindingId ||
    target.currentDelivery.workClaim.claimId !== observation.action.actionId ||
    target.currentDelivery.workClaim.claimDigest !==
      observation.action.claimDigest ||
    target.currentDelivery.workClaim.hostObservationAuthorityDigest !==
      observation.action.hostObservationAuthorityDigest ||
    target.currentDelivery.workClaim.claimEventId !==
      observation.action.claimEventId ||
    target.currentDelivery.workClaim.claimCommitId !==
      observation.action.claimCommitId ||
    target.currentDelivery.workClaim.claimEventStreamRevision !==
      observation.action.claimEventStreamRevision ||
    target.currentDelivery.workClaim.claimExpectedStateDigest !==
      observation.action.claimExpectedStateDigest ||
    target.currentDelivery.workClaim.claimedAt !== observation.action.issuedAt
  ) {
    fail("transition", "$/targetTasks");
  }
  if (target.workType === "test") {
    if (
      target.phase !== "test-host-effect-claimed" ||
      !("workType" in observation.action) ||
      observation.action.workType !== "test" ||
      target.currentDelivery.testAttemptId !==
        observation.action.testAttemptId ||
      target.currentDelivery.workClaim.testDispatchPacketDigest !==
        observation.action.testDispatchPacketDigest
    ) {
      fail("transition", "$/targetTasks");
    }
  } else if (
    target.phase !== "host-effect-claimed" ||
    "workType" in observation.action
  ) {
    fail("transition", "$/targetTasks");
  }
  const disposition = targetDeliveryHostEffectDisposition(observation);
  const phase =
    target.workType === "test"
      ? disposition === "accepted"
        ? ("test-host-effect-accepted" as const)
        : disposition === "indeterminate"
          ? ("test-host-effect-indeterminate" as const)
          : ("test-host-effect-rejected" as const)
      : disposition === "accepted"
        ? ("host-effect-accepted" as const)
        : disposition === "indeterminate"
          ? ("host-effect-indeterminate" as const)
          : ("host-effect-rejected" as const);
  const claimHandling =
    disposition === "rejected-before-effect"
      ? ("release-authorized" as const)
      : ("retain" as const);
  return parseDemandAggregateState({
    ...current,
    targetTasks: current.targetTasks.map((entry) =>
      entry.targetTaskId === target.targetTaskId
        ? {
            ...entry,
            phase,
            currentDelivery: {
              ...target.currentDelivery,
              hostEffect: {
                observationDigest: observation.observationDigest,
                disposition,
                readbackStatus: observation.readback.status,
                claimHandling,
                observedAt: observation.observedAt,
              },
            },
          }
        : entry,
    ),
  });
}

/** `delivery.target-host-effect-rearmed.v1` 使用的纯状态转换。 */
export function rearmTargetHostEffectInDemandAggregateState(
  currentValue: unknown,
  rearmValue: unknown,
): Readonly<DemandAggregateState> {
  const current = parseDemandAggregateState(currentValue);
  let rearm: Readonly<TargetHostEffectRearm>;
  try {
    rearm = parseTargetHostEffectRearm(rearmValue);
  } catch (error: unknown) {
    if (error instanceof TargetHostEffectRearmError) {
      fail("target-host-effect-rearm", "$rearm");
    }
    throw error;
  }
  const target = current.targetTasks.find(
    (entry) => entry.targetTaskId === rearm.target.targetTaskId,
  );
  // rearmedAt只保留Rearm来源时钟的审计事实；Rejected Attempt身份、Observation
  // 摘要、当前Aggregate状态与Event append CAS共同建立因果关系，不比较墙钟。
  if (
    current.lifecycle !== "active" ||
    rearm.target.demandId !== current.demandId ||
    target === undefined ||
    target.phase !== "host-effect-rejected" ||
    target.currentDelivery.targetDeliveryId !== rearm.target.targetDeliveryId ||
    target.currentDelivery.workClaim.claimId !==
      rearm.rejectedAttempt.claimId ||
    target.currentDelivery.workClaim.claimDigest !==
      rearm.rejectedAttempt.claimDigest ||
    target.currentDelivery.workClaim.claimEventId !==
      rearm.rejectedAttempt.claimEventId ||
    target.currentDelivery.workClaim.claimCommitId !==
      rearm.rejectedAttempt.claimCommitId ||
    target.currentDelivery.hostEffect.observationDigest !==
      rearm.rejectedAttempt.observationDigest ||
    target.currentDelivery.hostEffect.disposition !==
      "rejected-before-effect" ||
    target.currentDelivery.hostEffect.claimHandling !== "release-authorized"
  ) {
    fail("transition", "$/targetTasks");
  }
  return parseDemandAggregateState({
    ...current,
    targetTasks: current.targetTasks.map((entry) =>
      entry.targetTaskId === target.targetTaskId
        ? {
            ...entry,
            phase: "delivery-prepared",
            currentDelivery: {
              targetDeliveryId: target.currentDelivery.targetDeliveryId,
              intentDigest: target.currentDelivery.intentDigest,
              hostId: target.currentDelivery.hostId,
              bindingId: target.currentDelivery.bindingId,
            },
          }
        : entry,
    ),
  });
}

/** `result.target-result-recorded.v1` 使用的纯状态转换。 */
export function recordTargetResultInDemandAggregateState(
  currentValue: unknown,
  resultValue: unknown,
): Readonly<DemandAggregateState> {
  const current = parseDemandAggregateState(currentValue);
  let result: Readonly<TargetResult>;
  try {
    result = parseTargetResult(resultValue);
  } catch (error: unknown) {
    if (error instanceof TargetResultError) fail("target-result", "$result");
    throw error;
  }
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
      target.testCard.testCardId !== result.testExecution.testCard.testCardId ||
      target.testCard.testCardDigest !==
        result.testExecution.testCard.testCardDigest ||
      target.currentDelivery.targetDeliveryId !== result.targetDeliveryId ||
      target.currentDelivery.testAttemptId !==
        result.testExecution.testAttemptId ||
      target.currentDelivery.workClaim.claimId !== result.hostEffect.actionId ||
      target.currentDelivery.workClaim.claimDigest !==
        result.hostEffect.claimDigest ||
      target.currentDelivery.workClaim.testDispatchPacketDigest !==
        result.testExecution.testDispatchPacketDigest ||
      target.currentDelivery.hostEffect.observationDigest !==
        result.hostEffect.observationDigest ||
      target.currentDelivery.hostEffect.disposition !==
        result.hostEffect.disposition ||
      target.currentDelivery.hostEffect.readbackStatus !==
        result.hostEffect.readbackStatus ||
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
    target.currentDelivery.targetDeliveryId !== result.targetDeliveryId ||
    target.currentDelivery.workClaim.claimId !== result.hostEffect.actionId ||
    target.currentDelivery.workClaim.claimDigest !==
      result.hostEffect.claimDigest ||
    target.currentDelivery.hostEffect.observationDigest !==
      result.hostEffect.observationDigest ||
    target.currentDelivery.hostEffect.disposition !==
      result.hostEffect.disposition ||
    target.currentDelivery.hostEffect.readbackStatus !==
      result.hostEffect.readbackStatus ||
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
              },
            },
          }
        : entry,
    ),
  });
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
      target.phase !== "test-result-reported" ||
      decision.reviewed.targetResultId !==
        target.currentDelivery.targetResult.targetResultId ||
      decision.reviewed.targetResultDigest !==
        target.currentDelivery.targetResult.resultDigest ||
      decision.reviewed.targetResultOutcome !==
        target.currentDelivery.targetResult.outcome ||
      decision.reviewed.targetResultReportedAt !==
        target.currentDelivery.targetResult.reportedAt ||
      decision.testExecution.testAttemptId !==
        target.currentDelivery.testAttemptId ||
      decision.testExecution.testCard.testCardId !==
        target.testCard.testCardId ||
      decision.testExecution.testCard.testCardDigest !==
        target.testCard.testCardDigest ||
      decision.testExecution.testDispatchPacketDigest !==
        target.currentDelivery.workClaim.testDispatchPacketDigest
    ) {
      fail("transition", "$/targetTasks");
    }
    const phase = testReviewPhaseForDecision(decision.decision);
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

  if (target.workType === "test" || target.phase !== "result-reported") {
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
  const phase = reviewPhaseForDecision(decision.decision);
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
  const currentTestCard = current.currentTestCard;
  const testTarget = current.targetTasks.find(
    (target) => target.targetTaskId === authorization.source.testTargetTaskId,
  );
  if (
    current.lifecycle !== "active" ||
    authorization.demandId !== current.demandId ||
    authorization.source.stateDigest !==
      computeDemandAggregateStateDigest(current) ||
    currentTestCard === undefined ||
    currentTestCard.testCardId !== authorization.source.testCard.testCardId ||
    currentTestCard.testCardDigest !==
      authorization.source.testCard.testCardDigest ||
    testTarget === undefined ||
    testTarget.workType !== "test" ||
    testTarget.phase !== "test-product-defect" ||
    testTarget.testCard.testCardId !==
      authorization.source.testCard.testCardId ||
    testTarget.testCard.testCardDigest !==
      authorization.source.testCard.testCardDigest ||
    testTarget.currentDelivery.testAttemptId !==
      authorization.source.testAttemptId ||
    testTarget.currentDelivery.workClaim.testDispatchPacketDigest !==
      authorization.source.testDispatchPacketDigest ||
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
    testTarget.currentDelivery.reviewDecision.decision !==
      "escalate-product-defect" ||
    testTarget.currentDelivery.reviewDecision.controllerWindowId !==
      authorization.controllerWindowId
  ) {
    fail("transition", "$state/currentTestCard");
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
  const { currentTestCard: _currentTestCard, ...withoutCurrentTestCard } =
    current;
  return parseDemandAggregateState({
    ...withoutCurrentTestCard,
    pendingTestRetest: {
      kind: "product-defect-retest",
      previousTestCard: authorization.source.testCard,
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
          failedCheckIds: authorizedTarget.failedCheckIds,
          correctionObjective: authorizedTarget.correctionObjective,
          authorizedAt: authorization.authorizedAt,
        },
      };
    }),
  });
}

/** `review.target-result-resumed.v1` 使用的纯状态转换。 */
export function resumeBlockedTargetReviewInDemandAggregateState(
  currentValue: unknown,
  resumeValue: unknown,
): Readonly<DemandAggregateState> {
  const current = parseDemandAggregateState(currentValue);
  let resume: Readonly<ControllerTargetReviewResume>;
  try {
    resume = parseControllerTargetReviewResume(resumeValue);
  } catch (error: unknown) {
    if (error instanceof ControllerTargetReviewResumeError) {
      fail("controller-target-review-resume", "$resume");
    }
    throw error;
  }
  const target = current.targetTasks.find(
    (entry) => entry.targetTaskId === resume.targetTaskId,
  );
  if (
    current.lifecycle !== "active" ||
    resume.demandId !== current.demandId ||
    target === undefined ||
    (target.phase !== "review-blocked" &&
      target.phase !== "test-review-blocked") ||
    resume.blockedSource.stateDigest !==
      computeDemandAggregateStateDigest(current) ||
    target.currentDelivery.reviewDecision.decision !== "blocked" ||
    resume.blockedDecision.targetReviewDecisionId !==
      target.currentDelivery.reviewDecision.targetReviewDecisionId ||
    resume.blockedDecision.decisionDigest !==
      target.currentDelivery.reviewDecision.decisionDigest ||
    resume.blockedDecision.targetResultId !==
      target.currentDelivery.targetResult.targetResultId ||
    resume.blockedDecision.targetResultDigest !==
      target.currentDelivery.targetResult.resultDigest
  ) {
    fail("transition", "$/targetTasks");
  }
  const { reviewDecision: _reviewDecision, ...resumedDelivery } =
    target.currentDelivery;
  return parseDemandAggregateState({
    ...current,
    targetTasks: current.targetTasks.map((entry) =>
      entry.targetTaskId === target.targetTaskId
        ? {
            ...target,
            phase:
              target.workType === "test"
                ? "test-result-reported"
                : "result-reported",
            currentDelivery: resumedDelivery,
          }
        : entry,
    ),
  });
}

function normalizeState(
  wire: Readonly<DemandAggregateStateWire>,
): Readonly<DemandAggregateState> {
  const targetTasks = parseTargetTasks(wire.targetTasks);
  const implementationTargets = targetTasks.filter(
    (target) => target.workType !== "test",
  );
  const testTargets = targetTasks.filter(
    (target) => target.workType === "test",
  );
  const currentTestCard =
    wire.currentTestCard === undefined
      ? undefined
      : parseTestCardSummary(wire.currentTestCard, "$/currentTestCard");
  const pendingTestRetest =
    wire.pendingTestRetest === undefined
      ? undefined
      : parsePendingTestRetest(wire.pendingTestRetest);
  const currentTestTargets =
    currentTestCard === undefined
      ? []
      : testTargets.filter((target) =>
          testTargetMatchesCard(target, currentTestCard),
        );
  const historicalTestTargets =
    currentTestCard === undefined
      ? testTargets
      : testTargets.filter(
          (target) => !testTargetMatchesCard(target, currentTestCard),
        );
  if (
    historicalTestTargets.some(
      (target) => target.phase !== "test-product-defect",
    ) ||
    (currentTestCard !== undefined &&
      (implementationTargets.length === 0 ||
        implementationTargets.some((target) => target.phase !== "accepted") ||
        currentTestTargets.length > 1 ||
        (currentTestTargets.length === 0 &&
          testTargets.some(
            (target) =>
              target.targetTaskId === currentTestCard.targetTaskId ||
              target.testCard.testCardId === currentTestCard.testCardId,
          ))))
  ) {
    fail("relation", "$/currentTestCard");
  }
  if (
    pendingTestRetest !== undefined &&
    (currentTestCard !== undefined ||
      !testTargets.some(
        (target) =>
          target.phase === "test-product-defect" &&
          target.testCard.testCardId ===
            pendingTestRetest.previousTestCard.testCardId &&
          target.testCard.testCardDigest ===
            pendingTestRetest.previousTestCard.testCardDigest &&
          target.currentDelivery.reviewDecision.targetReviewDecisionId ===
            pendingTestRetest.testReviewDecision.targetReviewDecisionId &&
          target.currentDelivery.reviewDecision.decisionDigest ===
            pendingTestRetest.testReviewDecision.decisionDigest &&
          target.currentDelivery.reviewDecision.decision ===
            "escalate-product-defect",
      ))
  ) {
    fail("relation", "$/pendingTestRetest");
  }
  if (
    wire.lifecycle === "completed" &&
    (pendingTestRetest !== undefined ||
      implementationTargets.length === 0 ||
      implementationTargets.some((target) => target.phase !== "accepted") ||
      (testTargets.length === 0
        ? currentTestCard !== undefined
        : currentTestCard === undefined ||
          currentTestTargets.length !== 1 ||
          currentTestTargets[0]?.phase !== "test-accepted"))
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
    ...(currentTestCard === undefined ? {} : { currentTestCard }),
    ...(pendingTestRetest === undefined ? {} : { pendingTestRetest }),
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
    const currentTestCard = current.currentTestCard;
    if (
      currentTestCard === undefined ||
      currentTestCard.testCardId !== taskPackage.testCard.testCardId ||
      currentTestCard.testCardDigest !== taskPackage.testCard.testCardDigest ||
      currentTestCard.targetTaskId !== taskPackage.targetTaskId ||
      currentTestCard.testWindowId !== taskPackage.assignment.windowId ||
      current.targetTasks.some(
        (target) =>
          target.workType === "test" &&
          target.testCard.testCardId === currentTestCard.testCardId,
      ) ||
      current.targetTasks.some(
        (target) => target.workType !== "test" && target.phase !== "accepted",
      )
    ) {
      fail("transition", "$state/currentTestCard");
    }
    return parseDemandAggregateState({
      ...current,
      targetTasks: [
        ...current.targetTasks,
        {
          targetTaskId: taskPackage.targetTaskId,
          taskPackageId: taskPackage.taskPackageId,
          taskPackageDigest: computeTaskPackageDigest(taskPackage),
          workType: "test",
          windowId: taskPackage.assignment.windowId,
          testCard: currentTestCard,
          phase: "planned",
        },
      ].sort((left, right) =>
        compareText(left.targetTaskId, right.targetTaskId),
      ),
    });
  }
  if (
    current.currentTestCard !== undefined ||
    current.targetTasks.some((entry) => entry.workType === "test") ||
    current.targetTasks.some(
      (entry) =>
        entry.workType !== "test" &&
        entry.repositoryId === taskPackage.assignment.repositoryId,
    )
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
      commitExpectation: taskPackage.commitExpectation,
      acceptanceAnchorIds: Object.freeze(
        taskPackage.acceptanceAnchors.map((anchor) => anchor.anchorId),
      ),
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
    (target) => target.workType !== "test",
  );
  const testTargets = current.targetTasks.filter(
    (target) => target.workType === "test",
  );
  const currentTestCard = current.currentTestCard;
  const currentTestTarget =
    currentTestCard === undefined
      ? undefined
      : testTargets.find((target) =>
          testTargetMatchesCard(target, currentTestCard),
        );
  const testingClosed =
    completion.testingMode === "controller-only"
      ? currentTestCard === undefined && testTargets.length === 0
      : currentTestCard !== undefined &&
        currentTestTarget?.phase === "test-accepted" &&
        testTargets.every(
          (target) =>
            target === currentTestTarget ||
            target.phase === "test-product-defect",
        );
  if (
    current.lifecycle !== "active" ||
    completion.demandId !== current.demandId ||
    completion.authorityDigest !== current.authorityDigest ||
    completion.observedState.stateDigest !==
      computeDemandAggregateStateDigest(current) ||
    current.targetTasks.length === 0 ||
    implementationTargets.some((target) => target.phase !== "accepted") ||
    !testingClosed
  ) {
    fail("transition", "$state");
  }
  return parseDemandAggregateState({
    ...current,
    lifecycle: "completed",
  });
}

/** `testing.test-card-created`当前版本使用的TestCard准入转换。 */
export function createTestCardInDemandAggregateState(
  currentValue: unknown,
  testCardValue: unknown,
  generationSourceValue: unknown,
): Readonly<DemandAggregateState> {
  const current = parseDemandAggregateState(currentValue);
  let testCard: Readonly<TestCard>;
  let generationSource: Readonly<TestCardGenerationSource>;
  try {
    testCard = parseTestCard(testCardValue);
  } catch (error: unknown) {
    if (error instanceof TestCardError) fail("test-card", "$testCard");
    throw error;
  }
  try {
    generationSource = parseTestCardGenerationSource(generationSourceValue);
  } catch (error: unknown) {
    if (error instanceof TestCardGenerationSourceError) {
      fail("test-card-generation-source", "$generationSource");
    }
    throw error;
  }
  const baselineByTarget = new Map(
    testCard.implementationBaselines.map(
      (baseline) => [baseline.targetTaskId, baseline] as const,
    ),
  );
  const implementationTargets = current.targetTasks.filter(
    (target) => target.workType !== "test",
  );
  const testTargets = current.targetTasks.filter(
    (target) => target.workType === "test",
  );
  const generationCloses =
    generationSource.kind === "initial"
      ? current.pendingTestRetest === undefined && testTargets.length === 0
      : current.pendingTestRetest !== undefined &&
        pendingTestRetestMatches(current.pendingTestRetest, generationSource) &&
        testTargets.some(
          (target) =>
            target.phase === "test-product-defect" &&
            target.testCard.testCardId ===
              generationSource.previousTestCard.testCardId &&
            target.testCard.testCardDigest ===
              generationSource.previousTestCard.testCardDigest &&
            target.currentDelivery.reviewDecision.targetReviewDecisionId ===
              generationSource.testReviewDecision.targetReviewDecisionId &&
            target.currentDelivery.reviewDecision.decisionDigest ===
              generationSource.testReviewDecision.decisionDigest,
        );
  if (
    current.lifecycle !== "active" ||
    current.currentTestCard !== undefined ||
    testCard.demandId !== current.demandId ||
    testCard.demandAuthorityDigest !== current.authorityDigest ||
    testCard.source.stateDigest !==
      computeDemandAggregateStateDigest(current) ||
    implementationTargets.length === 0 ||
    !generationCloses ||
    implementationTargets.length !== baselineByTarget.size ||
    implementationTargets.some((target) => {
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
    }) ||
    current.targetTasks.some(
      (target) => target.targetTaskId === testCard.targetTaskId,
    )
  ) {
    fail("transition", "$state");
  }
  const { pendingTestRetest: _pendingTestRetest, ...withoutPendingTestRetest } =
    current;
  return parseDemandAggregateState({
    ...withoutPendingTestRetest,
    currentTestCard: {
      testCardId: testCard.testCardId,
      testCardDigest: testCard.testCardDigest,
      targetTaskId: testCard.targetTaskId,
      testWindowId: testCard.testWindowId,
    },
  });
}

export function computeDemandAggregateStateDigest(
  value: unknown,
): Sha256Digest {
  return computeCanonicalJsonSha256Digest(parseDemandAggregateState(value));
}
