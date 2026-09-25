import type { Sha256Digest } from "../../../foundation/crypto/sha256.js";
import { computeCanonicalJsonSha256Digest } from "../../../foundation/crypto/canonical-json-sha256.js";
import {
  parseSha256Digest,
  Sha256Error,
} from "../../../foundation/crypto/sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../../foundation/data/passive-own-data.js";
import {
  createWakeflowDurableId,
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../../contracts/identity/wakeflow-durable-id.js";
import {
  deriveUuidV4,
  parseUuidV4,
} from "../../../foundation/identity/uuid-v4.js";
import {
  parseUtcInstant,
  UtcInstantError,
  type UtcInstant,
} from "../../../foundation/time/utc-instant.js";
import {
  cancelDemandAggregateState,
  authorizeProductDefectRemediationInDemandAggregateState,
  completeDemandAggregateState,
  continueDemandAggregateState,
  createInitialDemandAggregateState,
  decideTargetResultReviewInDemandAggregateState,
  escalateDemandAggregateState,
  recordDeliveryOutcomeInDemandAggregateState,
  prepareDeliveryInDemandAggregateState,
  rearmDeliveryInDemandAggregateState,
  recordDecisionInDemandAggregateState,
  recordManagedEvidenceInDemandAggregateState,
  recordTargetResultInDemandAggregateState,
  reissueCallbackInDemandAggregateState,
  planTargetTaskInDemandAggregateState,
  parseDemandAggregateState,
  DemandAggregateStateError,
  type DemandAggregateState,
} from "../model/demand-aggregate-state.js";
import {
  computeDemandAuthorityDigest,
  parseDemandAuthority,
  DemandAuthorityError,
  type DemandAuthority,
} from "../model/demand-authority.js";
import {
  parseTaskPackage,
  TaskPackageError,
  type TaskPackage,
} from "../../tasking/task-package.js";
import {
  assertDeliveryEnvelopeMatchesTaskPackage,
  DeliveryEnvelopeError,
  parseDeliveryEnvelope,
  type DeliveryEnvelope,
} from "../../delivery/delivery-envelope.js";
import {
  DeliveryOutcomeError,
  parseDeliveryOutcome,
  type DeliveryOutcome,
} from "../../delivery/delivery-outcome.js";
import {
  DeliveryRearmError,
  parseDeliveryRearm,
  type DeliveryRearm,
} from "../../delivery/delivery-rearm.js";
import {
  createTargetDeliveryReworkContext,
  TargetDeliveryReworkContextError,
} from "../../delivery/target-delivery-rework-context.js";
import {
  createTargetDeliveryProductDefectRemediationContext,
  TargetDeliveryProductDefectRemediationContextError,
} from "../../delivery/target-delivery-product-defect-remediation-context.js";
import {
  parseTargetResult,
  targetResultRecordedEventIdFromResult,
  TargetResultError,
  type TargetResult,
} from "../../result/target-result.js";
import {
  parseControllerImplementationReviewDecision,
  ControllerImplementationReviewDecisionError,
  type ControllerImplementationReviewDecision,
} from "../../review/controller-implementation-review-decision.js";
import {
  controllerReviewDecisionEventId,
  parseControllerReviewDecision,
  ControllerReviewDecisionError,
  type ControllerReviewDecision,
} from "../../review/controller-review-decision.js";
import type { ControllerReviewEscalation } from "../../review/controller-review-decision-contract.js";
import {
  parseTargetResultCallbackRecord,
  parseTargetResultCallbackReissue,
  parseTargetResultEvidenceResolutions,
  TargetResultCallbackError,
  type TargetResultCallbackRecord,
  type TargetResultCallbackReissue,
  type TargetResultEvidenceResolution,
} from "../../result/target-result-callback.js";
import {
  parseControllerProductDefectRemediationAuthorization,
  productDefectRemediationAuthorizedEventId,
  ControllerProductDefectRemediationAuthorizationError,
  type ControllerProductDefectRemediationAuthorization,
} from "../../review/controller-product-defect-remediation-authorization.js";
import {
  parseDemandUncommittedEvent,
  DemandEventSourcingEventError,
  type DemandContinuation,
  type DemandDecisionRecord,
  type DemandEscalation,
  type DemandUncommittedEvent,
} from "./demand-event-sourcing-event.js";
import {
  parseManagedEvidenceManifest,
  ManagedEvidenceManifestError,
  type ManagedEvidenceManifest,
} from "../../evidence/managed-evidence-manifest.js";
import {
  parseDemandCompletion,
  DemandCompletionError,
  type DemandCompletion,
} from "../../lifecycle/demand-completion.js";
import {
  assertTestExecutionAttemptMatchesPackage,
  TestExecutionAttemptError,
} from "../../testing/test-execution-attempt.js";

/**
 * Wakeflow Governance / Demand Event Sourcing：Demand 聚合的纯决策器。
 *
 * `decide` 只根据已验证命令和当前状态产生零个或多个未提交事件；`evolve` 只把一个
 * 事件确定性应用到状态。两者都不读取文件、Ledger、时间或网络，也不分配事件流
 * 修订号、提交序号或快照。
 */

export interface PublishDemandCommand {
  readonly commandType: "publication.publish-demand";
  readonly commandVersion: 1;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly recordedAt: UtcInstant;
  readonly identityDigest: Sha256Digest;
  readonly authorityDigest: Sha256Digest;
}

export interface CancelDemandCommand {
  readonly commandType: "lifecycle.cancel-demand";
  readonly commandVersion: 1;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly recordedAt: UtcInstant;
  readonly reason: string;
}

export interface CompleteDemandCommand {
  readonly commandType: "lifecycle.complete-demand";
  readonly commandVersion: 1;
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly authority: Readonly<DemandAuthority>;
  readonly completion: Readonly<DemandCompletion>;
}

/** 升级命令由评审决定或第三次 rework 刹车发出；`escalation` 按事件 Schema 准入。 */
export interface EscalateDemandCommand {
  readonly commandType: "lifecycle.escalate-demand";
  readonly commandVersion: 1;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly recordedAt: UtcInstant;
  readonly escalation: DemandEscalation;
}

export interface RecordDecisionCommand {
  readonly commandType: "lifecycle.record-decision";
  readonly commandVersion: 1;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly recordedAt: UtcInstant;
  readonly decision: DemandDecisionRecord;
}

export interface ContinueDemandCommand {
  readonly commandType: "lifecycle.continue-demand";
  readonly commandVersion: 1;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly recordedAt: UtcInstant;
  readonly continuation: DemandContinuation;
}

export interface PlanTargetTaskCommand {
  readonly commandType: "tasking.plan-target-task";
  readonly commandVersion: 1;
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly taskPackage: Readonly<TaskPackage>;
}

export interface RecordManagedEvidenceCommand {
  readonly commandType: "evidence.record-managed-evidence";
  readonly commandVersion: 1;
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly manifest: Readonly<ManagedEvidenceManifest>;
}

export interface PrepareDeliveryCommand {
  readonly commandType: "delivery.prepare-delivery";
  readonly commandVersion: 1;
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly envelope: Readonly<DeliveryEnvelope>;
  readonly taskPackage: Readonly<TaskPackage>;
  readonly reworkSource?: Readonly<{
    readonly decision: Readonly<ControllerImplementationReviewDecision>;
    readonly previousResult: Readonly<TargetResult>;
  }>;
  readonly productDefectRemediationSource?: Readonly<{
    readonly authorization: Readonly<ControllerProductDefectRemediationAuthorization>;
    readonly previousResult: Readonly<TargetResult>;
  }>;
}

export interface RecordDeliveryOutcomeCommand {
  readonly commandType: "delivery.record-delivery-outcome";
  readonly commandVersion: 1;
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly outcome: Readonly<DeliveryOutcome>;
}

export interface RearmDeliveryCommand {
  readonly commandType: "delivery.rearm-delivery";
  readonly commandVersion: 1;
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly rearm: Readonly<DeliveryRearm>;
}

export interface RecordTargetResultCommand {
  readonly commandType: "result.record-target-result";
  readonly commandVersion: 1;
  readonly result: Readonly<TargetResult>;
  readonly callback: Readonly<TargetResultCallbackRecord>;
  readonly evidenceResolution: readonly Readonly<TargetResultEvidenceResolution>[];
}

/** 回调重发：不取声明、按当前 Controller 绑定重算、代际加一（§13.87 D1）。 */
export interface ReissueCallbackCommand {
  readonly commandType: "result.reissue-callback";
  readonly commandVersion: 1;
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly reissue: Readonly<TargetResultCallbackReissue>;
}

/**
 * 评审决定：escalate 在同一提交附带升级事件；测试 `escalate{product-defect}` 必须携带
 * 由决定与基线派生的缺陷修复授权，同一提交附带授权事件（§13.87 D5）。
 */
export interface DecideTargetResultReviewCommand {
  readonly commandType: "review.decide-target-result";
  readonly commandVersion: 1;
  readonly decision: Readonly<ControllerReviewDecision>;
  readonly authorization?: Readonly<ControllerProductDefectRemediationAuthorization>;
}

export type DemandEventSourcingCommand =
  | PublishDemandCommand
  | CancelDemandCommand
  | CompleteDemandCommand
  | EscalateDemandCommand
  | RecordDecisionCommand
  | ContinueDemandCommand
  | RecordManagedEvidenceCommand
  | PlanTargetTaskCommand
  | PrepareDeliveryCommand
  | RecordDeliveryOutcomeCommand
  | RearmDeliveryCommand
  | RecordTargetResultCommand
  | ReissueCallbackCommand
  | DecideTargetResultReviewCommand;

export type DemandEventSourcingDecisionErrorReason =
  | "input"
  | "identifier"
  | "time"
  | "digest"
  | "text"
  | "task-package"
  | "demand-authority"
  | "demand-completion"
  | "lifecycle-data"
  | "managed-evidence-manifest"
  | "delivery-envelope"
  | "target-delivery-rework-context"
  | "target-delivery-product-defect-remediation-context"
  | "delivery-outcome"
  | "delivery-rearm"
  | "target-result"
  | "target-result-callback"
  | "controller-implementation-review-decision"
  | "controller-review-decision"
  | "controller-product-defect-remediation-authorization"
  | "state"
  | "identity"
  | "transition"
  | "event";

const ERROR_MESSAGES = {
  input: "Demand Event Sourcing command input is invalid.",
  identifier: "Demand Event Sourcing command contains an invalid identity.",
  time: "Demand Event Sourcing command contains an invalid recorded time.",
  digest: "Demand Event Sourcing command contains an invalid digest.",
  text: "Demand Event Sourcing command contains non-canonical text.",
  "task-package":
    "Demand Event Sourcing command contains an invalid TaskPackage.",
  "demand-authority":
    "Demand Event Sourcing command contains an invalid Demand Authority.",
  "demand-completion":
    "Demand Event Sourcing command contains an invalid Demand Completion.",
  "lifecycle-data":
    "Demand Event Sourcing command carries invalid lifecycle data.",
  "managed-evidence-manifest":
    "Demand Event Sourcing command contains an invalid Managed Evidence Manifest.",
  "delivery-envelope":
    "Demand Event Sourcing command contains an invalid Delivery Envelope.",
  "target-delivery-rework-context":
    "Demand Event Sourcing command contains an invalid Target Delivery rework source.",
  "target-delivery-product-defect-remediation-context":
    "Demand Event Sourcing command contains an invalid Target Delivery product-defect remediation source.",
  "delivery-outcome":
    "Demand Event Sourcing command contains an invalid Delivery Outcome.",
  "delivery-rearm":
    "Demand Event Sourcing command contains an invalid Delivery Rearm.",
  "target-result":
    "Demand Event Sourcing command contains an invalid TargetResult.",
  "controller-implementation-review-decision":
    "Demand Event Sourcing command contains an invalid Controller Target Review Decision.",
  "controller-review-decision":
    "Demand Event Sourcing command contains an invalid Controller Review Decision.",
  "controller-product-defect-remediation-authorization":
    "Demand Event Sourcing command contains an invalid Controller Product Defect Remediation Authorization.",
  "target-result-callback":
    "Demand Event Sourcing command contains an invalid Target Result callback record.",
  state: "Demand Event Sourcing Decider received an invalid aggregate state.",
  identity: "Demand Event Sourcing command does not belong to the aggregate.",
  transition:
    "Demand Event Sourcing command or event is not admitted from the current state.",
  event: "Demand Event Sourcing Decider received an invalid event.",
} as const satisfies Readonly<
  Record<DemandEventSourcingDecisionErrorReason, string>
>;

export class DemandEventSourcingDecisionError extends Error {
  override readonly name = "DemandEventSourcingDecisionError";
  readonly code = "wakeflow-demand-event-sourcing-decision" as const;
  readonly reason: DemandEventSourcingDecisionErrorReason;
  readonly path: string;

  constructor(reason: DemandEventSourcingDecisionErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const PUBLISH_FIELDS = Object.freeze([
  "authorityDigest",
  "commandType",
  "commandVersion",
  "demandId",
  "eventId",
  "identityDigest",
  "recordedAt",
] as const);
const CANCEL_FIELDS = Object.freeze([
  "commandType",
  "commandVersion",
  "demandId",
  "eventId",
  "reason",
  "recordedAt",
] as const);
const COMPLETE_DEMAND_FIELDS = Object.freeze([
  "authority",
  "commandType",
  "commandVersion",
  "completion",
  "eventId",
] as const);
const ESCALATE_DEMAND_FIELDS = Object.freeze([
  "commandType",
  "commandVersion",
  "demandId",
  "escalation",
  "eventId",
  "recordedAt",
] as const);
const RECORD_DECISION_FIELDS = Object.freeze([
  "commandType",
  "commandVersion",
  "decision",
  "demandId",
  "eventId",
  "recordedAt",
] as const);
const CONTINUE_DEMAND_FIELDS = Object.freeze([
  "commandType",
  "commandVersion",
  "continuation",
  "demandId",
  "eventId",
  "recordedAt",
] as const);
/** 同一任务第三次 rework 自动升级（ADR-0012 D5）；阈值进配置留作后续。 */
export const DEMAND_REWORK_ESCALATION_THRESHOLD = 3;
const PLAN_TARGET_TASK_FIELDS = Object.freeze([
  "commandType",
  "commandVersion",
  "eventId",
  "taskPackage",
] as const);
const RECORD_MANAGED_EVIDENCE_FIELDS = Object.freeze([
  "commandType",
  "commandVersion",
  "eventId",
  "manifest",
] as const);
const PREPARE_DELIVERY_BASE_FIELDS = Object.freeze([
  "commandType",
  "commandVersion",
  "envelope",
  "eventId",
  "taskPackage",
] as const);
const RECORD_DELIVERY_OUTCOME_FIELDS = Object.freeze([
  "commandType",
  "commandVersion",
  "eventId",
  "outcome",
] as const);
const REARM_DELIVERY_FIELDS = Object.freeze([
  "commandType",
  "commandVersion",
  "eventId",
  "rearm",
] as const);
const RECORD_TARGET_RESULT_FIELDS = Object.freeze([
  "callback",
  "commandType",
  "commandVersion",
  "evidenceResolution",
  "result",
] as const);
const REISSUE_CALLBACK_FIELDS = Object.freeze([
  "commandType",
  "commandVersion",
  "eventId",
  "reissue",
] as const);
const DECIDE_TARGET_RESULT_REVIEW_FIELDS = Object.freeze([
  "commandType",
  "commandVersion",
  "decision",
] as const);
const DECIDE_TARGET_RESULT_REVIEW_WITH_AUTHORIZATION_FIELDS = Object.freeze([
  "authorization",
  "commandType",
  "commandVersion",
  "decision",
] as const);
const CONTROL_EXCEPT_LF_PATTERN =
  /\r|[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;

function fail(
  reason: DemandEventSourcingDecisionErrorReason,
  path: string,
): never {
  throw new DemandEventSourcingDecisionError(reason, path);
}

/** 生命周期命令的数据借事件解析器按 Schema 准入，不另写一份编解码。 */
function lifecycleEvent(
  eventType: DemandUncommittedEvent["eventType"],
  data: unknown,
): Readonly<DemandUncommittedEvent> {
  try {
    return parseDemandUncommittedEvent({
      eventId: PROBE_EVENT_ID,
      demandId: PROBE_DEMAND_ID,
      recordedAt: PROBE_RECORDED_AT,
      eventType,
      data,
    });
  } catch (error: unknown) {
    if (error instanceof DemandEventSourcingEventError) {
      fail("lifecycle-data", "$/data");
    }
    throw error;
  }
}

function escalationData(value: unknown): DemandEscalation {
  const event = lifecycleEvent("lifecycle.demand-escalated", {
    escalation: value,
  });
  if (event.eventType !== "lifecycle.demand-escalated") {
    fail("lifecycle-data", "$/escalation");
  }
  return event.data.escalation;
}

function decisionData(value: unknown): DemandDecisionRecord {
  const event = lifecycleEvent("lifecycle.decision-recorded", {
    decision: value,
  });
  if (event.eventType !== "lifecycle.decision-recorded") {
    fail("lifecycle-data", "$/decision");
  }
  return event.data.decision;
}

function continuationData(value: unknown): DemandContinuation {
  const event = lifecycleEvent("lifecycle.demand-continued", {
    continuation: value,
  });
  if (event.eventType !== "lifecycle.demand-continued") {
    fail("lifecycle-data", "$/continuation");
  }
  return event.data.continuation;
}

const PROBE_DEMAND_ID = "demand_00000000-0000-4000-8000-000000000000";
const PROBE_EVENT_ID = "demand-event_00000000-0000-4000-8000-000000000000";
const PROBE_RECORDED_AT = "2000-01-01T00:00:00.000Z";

function exactCommand(
  record: Readonly<Record<string, unknown>>,
  fields: readonly string[],
): Readonly<Record<string, unknown>> {
  const keys = Object.keys(record).sort();
  if (
    keys.length !== fields.length ||
    keys.some((key, index) => key !== fields[index])
  ) {
    fail("input", "$command");
  }
  return record;
}

function parseId<Kind extends "demand" | "demand-event">(
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

function parseTime(value: unknown): UtcInstant {
  try {
    return parseUtcInstant(value, "$/recordedAt");
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) fail("time", "$/recordedAt");
    throw error;
  }
}

function parseDigest(value: unknown, path: string): Sha256Digest {
  try {
    return parseSha256Digest(value, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("digest", path);
    throw error;
  }
}

function parseReason(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Array.from(value).length > 8192 ||
    !value.isWellFormed() ||
    value.normalize("NFC") !== value ||
    value.trim() !== value ||
    CONTROL_EXCEPT_LF_PATTERN.test(value)
  ) {
    fail("text", "$/reason");
  }
  return value;
}

export function parseDemandEventSourcingCommand(
  value: unknown,
): Readonly<DemandEventSourcingCommand> {
  let base: Readonly<Record<string, unknown>>;
  try {
    base = parsePlainRecord(value, "$command");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$command");
    throw error;
  }
  if (base.commandVersion !== 1) fail("input", "$/commandVersion");

  if (base.commandType === "publication.publish-demand") {
    const command = exactCommand(base, PUBLISH_FIELDS);
    return Object.freeze({
      commandType: "publication.publish-demand",
      commandVersion: 1,
      demandId: parseId(command.demandId, "demand", "$/demandId"),
      eventId: parseId(command.eventId, "demand-event", "$/eventId"),
      recordedAt: parseTime(command.recordedAt),
      identityDigest: parseDigest(command.identityDigest, "$/identityDigest"),
      authorityDigest: parseDigest(
        command.authorityDigest,
        "$/authorityDigest",
      ),
    });
  }

  if (base.commandType === "lifecycle.cancel-demand") {
    const command = exactCommand(base, CANCEL_FIELDS);
    return Object.freeze({
      commandType: "lifecycle.cancel-demand",
      commandVersion: 1,
      demandId: parseId(command.demandId, "demand", "$/demandId"),
      eventId: parseId(command.eventId, "demand-event", "$/eventId"),
      recordedAt: parseTime(command.recordedAt),
      reason: parseReason(command.reason),
    });
  }

  if (base.commandType === "lifecycle.complete-demand") {
    const command = exactCommand(base, COMPLETE_DEMAND_FIELDS);
    let authority: Readonly<DemandAuthority>;
    let completion: Readonly<DemandCompletion>;
    try {
      authority = parseDemandAuthority(command.authority);
    } catch (error: unknown) {
      if (error instanceof DemandAuthorityError) {
        fail("demand-authority", "$/authority");
      }
      throw error;
    }
    try {
      completion = parseDemandCompletion(command.completion);
    } catch (error: unknown) {
      if (error instanceof DemandCompletionError) {
        fail("demand-completion", "$/completion");
      }
      throw error;
    }
    if (
      authority.demandId !== completion.demandId ||
      completion.testingMode !== authority.testingDecision.mode ||
      computeDemandAuthorityDigest(authority) !== completion.authorityDigest
    ) {
      fail("demand-completion", "$/completion");
    }
    return Object.freeze({
      commandType: "lifecycle.complete-demand",
      commandVersion: 1,
      eventId: parseId(command.eventId, "demand-event", "$/eventId"),
      authority,
      completion,
    });
  }

  if (base.commandType === "lifecycle.escalate-demand") {
    const command = exactCommand(base, ESCALATE_DEMAND_FIELDS);
    return Object.freeze({
      commandType: "lifecycle.escalate-demand",
      commandVersion: 1,
      demandId: parseId(command.demandId, "demand", "$/demandId"),
      eventId: parseId(command.eventId, "demand-event", "$/eventId"),
      recordedAt: parseTime(command.recordedAt),
      escalation: escalationData(command.escalation),
    });
  }

  if (base.commandType === "lifecycle.record-decision") {
    const command = exactCommand(base, RECORD_DECISION_FIELDS);
    return Object.freeze({
      commandType: "lifecycle.record-decision",
      commandVersion: 1,
      demandId: parseId(command.demandId, "demand", "$/demandId"),
      eventId: parseId(command.eventId, "demand-event", "$/eventId"),
      recordedAt: parseTime(command.recordedAt),
      decision: decisionData(command.decision),
    });
  }

  if (base.commandType === "lifecycle.continue-demand") {
    const command = exactCommand(base, CONTINUE_DEMAND_FIELDS);
    return Object.freeze({
      commandType: "lifecycle.continue-demand",
      commandVersion: 1,
      demandId: parseId(command.demandId, "demand", "$/demandId"),
      eventId: parseId(command.eventId, "demand-event", "$/eventId"),
      recordedAt: parseTime(command.recordedAt),
      continuation: continuationData(command.continuation),
    });
  }

  if (base.commandType === "tasking.plan-target-task") {
    const command = exactCommand(base, PLAN_TARGET_TASK_FIELDS);
    let taskPackage: Readonly<TaskPackage>;
    try {
      taskPackage = parseTaskPackage(command.taskPackage);
    } catch (error: unknown) {
      if (error instanceof TaskPackageError) {
        fail("task-package", "$/taskPackage");
      }
      throw error;
    }
    return Object.freeze({
      commandType: "tasking.plan-target-task",
      commandVersion: 1,
      eventId: parseId(command.eventId, "demand-event", "$/eventId"),
      taskPackage,
    });
  }

  if (base.commandType === "evidence.record-managed-evidence") {
    const command = exactCommand(base, RECORD_MANAGED_EVIDENCE_FIELDS);
    let manifest: Readonly<ManagedEvidenceManifest>;
    try {
      manifest = parseManagedEvidenceManifest(command.manifest);
    } catch (error: unknown) {
      if (error instanceof ManagedEvidenceManifestError) {
        fail("managed-evidence-manifest", "$/manifest");
      }
      throw error;
    }
    return Object.freeze({
      commandType: "evidence.record-managed-evidence",
      commandVersion: 1,
      eventId: parseId(command.eventId, "demand-event", "$/eventId"),
      manifest,
    });
  }

  if (base.commandType === "delivery.prepare-delivery") {
    const hasReworkSource = Object.hasOwn(base, "reworkSource");
    const hasProductDefectRemediationSource = Object.hasOwn(
      base,
      "productDefectRemediationSource",
    );
    if (hasReworkSource && hasProductDefectRemediationSource) {
      fail("input", "$command");
    }
    const command = exactCommand(
      base,
      [
        ...PREPARE_DELIVERY_BASE_FIELDS,
        ...(hasReworkSource ? (["reworkSource"] as const) : []),
        ...(hasProductDefectRemediationSource
          ? (["productDefectRemediationSource"] as const)
          : []),
      ].sort(),
    );
    let envelope: Readonly<DeliveryEnvelope>;
    let taskPackage: Readonly<TaskPackage>;
    try {
      envelope = parseDeliveryEnvelope(command.envelope);
    } catch (error: unknown) {
      if (error instanceof DeliveryEnvelopeError) {
        fail("delivery-envelope", "$/envelope");
      }
      throw error;
    }
    try {
      taskPackage = parseTaskPackage(command.taskPackage);
      assertDeliveryEnvelopeMatchesTaskPackage(envelope, taskPackage);
    } catch (error: unknown) {
      if (error instanceof TaskPackageError) {
        fail("task-package", "$/taskPackage");
      }
      if (error instanceof DeliveryEnvelopeError) {
        fail("delivery-envelope", "$/envelope");
      }
      throw error;
    }
    if (envelope.workType === "test") {
      try {
        assertTestExecutionAttemptMatchesPackage(envelope.attempt, taskPackage);
      } catch (error: unknown) {
        if (error instanceof TestExecutionAttemptError) {
          fail("delivery-envelope", "$/envelope/attempt");
        }
        throw error;
      }
      if (hasReworkSource || hasProductDefectRemediationSource) {
        fail("input", "$command");
      }
    }
    let reworkSource: PrepareDeliveryCommand["reworkSource"];
    let productDefectRemediationSource: PrepareDeliveryCommand["productDefectRemediationSource"];
    if (hasReworkSource) {
      let source: Readonly<Record<string, unknown>>;
      try {
        source = parsePlainRecord(command.reworkSource, "$/reworkSource");
      } catch (error: unknown) {
        if (error instanceof PassiveOwnDataError) {
          fail("target-delivery-rework-context", "$/reworkSource");
        }
        throw error;
      }
      const sourceKeys = Object.keys(source).sort();
      if (
        sourceKeys.length !== 2 ||
        sourceKeys[0] !== "decision" ||
        sourceKeys[1] !== "previousResult"
      ) {
        fail("target-delivery-rework-context", "$/reworkSource");
      }
      let decision: Readonly<ControllerImplementationReviewDecision>;
      let previousResult: Readonly<TargetResult>;
      try {
        decision = parseControllerImplementationReviewDecision(source.decision);
      } catch (error: unknown) {
        if (error instanceof ControllerImplementationReviewDecisionError) {
          fail(
            "controller-implementation-review-decision",
            "$/reworkSource/decision",
          );
        }
        throw error;
      }
      try {
        previousResult = parseTargetResult(source.previousResult);
      } catch (error: unknown) {
        if (error instanceof TargetResultError) {
          fail("target-result", "$/reworkSource/previousResult");
        }
        throw error;
      }
      try {
        const projected = createTargetDeliveryReworkContext({
          decision,
          previousResult,
        });
        if (
          envelope.rework === undefined ||
          computeCanonicalJsonSha256Digest(projected) !==
            computeCanonicalJsonSha256Digest(envelope.rework)
        ) {
          fail("target-delivery-rework-context", "$/reworkSource");
        }
      } catch (error: unknown) {
        if (error instanceof DemandEventSourcingDecisionError) throw error;
        if (error instanceof TargetDeliveryReworkContextError) {
          fail("target-delivery-rework-context", "$/reworkSource");
        }
        throw error;
      }
      reworkSource = Object.freeze({ decision, previousResult });
    } else if (envelope.rework !== undefined) {
      fail("target-delivery-rework-context", "$/reworkSource");
    }
    if (hasProductDefectRemediationSource) {
      let source: Readonly<Record<string, unknown>>;
      try {
        source = parsePlainRecord(
          command.productDefectRemediationSource,
          "$/productDefectRemediationSource",
        );
      } catch (error: unknown) {
        if (error instanceof PassiveOwnDataError) {
          fail(
            "target-delivery-product-defect-remediation-context",
            "$/productDefectRemediationSource",
          );
        }
        throw error;
      }
      const sourceKeys = Object.keys(source).sort();
      if (
        sourceKeys.length !== 2 ||
        sourceKeys[0] !== "authorization" ||
        sourceKeys[1] !== "previousResult"
      ) {
        fail(
          "target-delivery-product-defect-remediation-context",
          "$/productDefectRemediationSource",
        );
      }
      let authorization: Readonly<ControllerProductDefectRemediationAuthorization>;
      let previousResult: Readonly<TargetResult>;
      try {
        authorization = parseControllerProductDefectRemediationAuthorization(
          source.authorization,
        );
      } catch (error: unknown) {
        if (
          error instanceof ControllerProductDefectRemediationAuthorizationError
        ) {
          fail(
            "controller-product-defect-remediation-authorization",
            "$/productDefectRemediationSource/authorization",
          );
        }
        throw error;
      }
      try {
        previousResult = parseTargetResult(source.previousResult);
      } catch (error: unknown) {
        if (error instanceof TargetResultError) {
          fail(
            "target-result",
            "$/productDefectRemediationSource/previousResult",
          );
        }
        throw error;
      }
      try {
        const projected = createTargetDeliveryProductDefectRemediationContext({
          authorization,
          previousResult,
        });
        if (
          envelope.productDefectRemediation === undefined ||
          computeCanonicalJsonSha256Digest(projected) !==
            computeCanonicalJsonSha256Digest(envelope.productDefectRemediation)
        ) {
          fail(
            "target-delivery-product-defect-remediation-context",
            "$/productDefectRemediationSource",
          );
        }
      } catch (error: unknown) {
        if (error instanceof DemandEventSourcingDecisionError) throw error;
        if (
          error instanceof TargetDeliveryProductDefectRemediationContextError
        ) {
          fail(
            "target-delivery-product-defect-remediation-context",
            "$/productDefectRemediationSource",
          );
        }
        throw error;
      }
      productDefectRemediationSource = Object.freeze({
        authorization,
        previousResult,
      });
    } else if (envelope.productDefectRemediation !== undefined) {
      fail(
        "target-delivery-product-defect-remediation-context",
        "$/productDefectRemediationSource",
      );
    }
    return Object.freeze({
      commandType: "delivery.prepare-delivery",
      commandVersion: 1,
      eventId: parseId(command.eventId, "demand-event", "$/eventId"),
      envelope,
      taskPackage,
      ...(reworkSource === undefined ? {} : { reworkSource }),
      ...(productDefectRemediationSource === undefined
        ? {}
        : { productDefectRemediationSource }),
    });
  }

  if (base.commandType === "delivery.record-delivery-outcome") {
    const command = exactCommand(base, RECORD_DELIVERY_OUTCOME_FIELDS);
    let outcome: Readonly<DeliveryOutcome>;
    try {
      outcome = parseDeliveryOutcome(command.outcome);
    } catch (error: unknown) {
      if (error instanceof DeliveryOutcomeError) {
        fail("delivery-outcome", "$/outcome");
      }
      throw error;
    }
    return Object.freeze({
      commandType: "delivery.record-delivery-outcome",
      commandVersion: 1,
      eventId: parseId(command.eventId, "demand-event", "$/eventId"),
      outcome,
    });
  }

  if (base.commandType === "delivery.rearm-delivery") {
    const command = exactCommand(base, REARM_DELIVERY_FIELDS);
    let rearm: Readonly<DeliveryRearm>;
    try {
      rearm = parseDeliveryRearm(command.rearm);
    } catch (error: unknown) {
      if (error instanceof DeliveryRearmError) fail("delivery-rearm", "$/rearm");
      throw error;
    }
    return Object.freeze({
      commandType: "delivery.rearm-delivery",
      commandVersion: 1,
      eventId: parseId(command.eventId, "demand-event", "$/eventId"),
      rearm,
    });
  }

  if (base.commandType === "result.record-target-result") {
    const command = exactCommand(base, RECORD_TARGET_RESULT_FIELDS);
    let result: Readonly<TargetResult>;
    try {
      result = parseTargetResult(command.result);
    } catch (error: unknown) {
      if (error instanceof TargetResultError) {
        fail("target-result", "$/result");
      }
      throw error;
    }
    let callback: Readonly<TargetResultCallbackRecord>;
    let evidenceResolution: readonly Readonly<TargetResultEvidenceResolution>[];
    try {
      callback = parseTargetResultCallbackRecord(command.callback, "$/callback");
      evidenceResolution = parseTargetResultEvidenceResolutions(
        command.evidenceResolution,
        "$/evidenceResolution",
      );
    } catch (error: unknown) {
      if (error instanceof TargetResultCallbackError) {
        fail("target-result-callback", error.path);
      }
      throw error;
    }
    return Object.freeze({
      commandType: "result.record-target-result",
      commandVersion: 1,
      result,
      callback,
      evidenceResolution,
    });
  }

  if (base.commandType === "result.reissue-callback") {
    const command = exactCommand(base, REISSUE_CALLBACK_FIELDS);
    let reissue: Readonly<TargetResultCallbackReissue>;
    try {
      reissue = parseTargetResultCallbackReissue(command.reissue, "$/reissue");
    } catch (error: unknown) {
      if (error instanceof TargetResultCallbackError) {
        fail("target-result-callback", error.path);
      }
      throw error;
    }
    return Object.freeze({
      commandType: "result.reissue-callback",
      commandVersion: 1,
      eventId: parseId(command.eventId, "demand-event", "$/eventId"),
      reissue,
    });
  }

  if (base.commandType === "review.decide-target-result") {
    const hasAuthorization = Object.hasOwn(base, "authorization");
    const command = exactCommand(
      base,
      hasAuthorization
        ? DECIDE_TARGET_RESULT_REVIEW_WITH_AUTHORIZATION_FIELDS
        : DECIDE_TARGET_RESULT_REVIEW_FIELDS,
    );
    let decision: Readonly<ControllerReviewDecision>;
    try {
      decision = parseControllerReviewDecision(command.decision);
    } catch (error: unknown) {
      if (error instanceof ControllerReviewDecisionError) {
        fail("controller-review-decision", "$/decision");
      }
      throw error;
    }
    const productDefect =
      decision.kind === "WakeflowControllerTestReviewDecision" &&
      decision.escalation?.classification === "product-defect";
    if (productDefect !== hasAuthorization) fail("input", "$/authorization");
    if (!hasAuthorization) {
      return Object.freeze({
        commandType: "review.decide-target-result",
        commandVersion: 1,
        decision,
      });
    }
    let authorization: Readonly<ControllerProductDefectRemediationAuthorization>;
    try {
      authorization = parseControllerProductDefectRemediationAuthorization(
        command.authorization,
      );
    } catch (error: unknown) {
      if (
        error instanceof ControllerProductDefectRemediationAuthorizationError
      ) {
        fail(
          "controller-product-defect-remediation-authorization",
          "$/authorization",
        );
      }
      throw error;
    }
    if (
      authorization.source.testReviewDecision.targetReviewDecisionId !==
        decision.targetReviewDecisionId ||
      authorization.source.testReviewDecision.decisionDigest !==
        decision.decisionDigest ||
      authorization.source.reviewSnapshotDigest !==
        decision.reviewed.snapshotDigest ||
      authorization.source.streamRevision !==
        decision.reviewed.streamRevision + 1
    ) {
      fail(
        "controller-product-defect-remediation-authorization",
        "$/authorization/source",
      );
    }
    return Object.freeze({
      commandType: "review.decide-target-result",
      commandVersion: 1,
      decision,
      authorization,
    });
  }

  fail("input", "$/commandType");
}

/** 计算已准入命令的稳定幂等摘要；事件存储不接受调用方自行声明的摘要。 */
export function computeDemandEventSourcingCommandDigest(
  value: unknown,
): Sha256Digest {
  return computeCanonicalJsonSha256Digest(
    parseDemandEventSourcingCommand(value),
  );
}

type DecidedEvents = readonly [
  Readonly<DemandUncommittedEvent>,
  ...Readonly<DemandUncommittedEvent>[],
];

function singleEvent(event: Readonly<DemandUncommittedEvent>): DecidedEvents {
  return Object.freeze([event]);
}

function parseState(value: unknown): Readonly<DemandAggregateState> | null {
  if (value === null) return null;
  try {
    return parseDemandAggregateState(value);
  } catch (error: unknown) {
    if (error instanceof DemandAggregateStateError) fail("state", "$state");
    throw error;
  }
}

/** 根据当前状态对一条业务命令作出纯事件决策。 */
export function decideDemandEventSourcingCommand(
  stateValue: unknown,
  commandValue: unknown,
): DecidedEvents {
  const state = parseState(stateValue);
  const command = parseDemandEventSourcingCommand(commandValue);

  if (command.commandType === "publication.publish-demand") {
    if (state !== null) fail("transition", "$state");
    return singleEvent(
      parseDemandUncommittedEvent({
        eventId: command.eventId,
        demandId: command.demandId,
        recordedAt: command.recordedAt,
        eventType: "publication.demand-published",
        data: {
          identityRef: "identity.json",
          identityDigest: command.identityDigest,
          authorityRef: "authority.json",
          authorityDigest: command.authorityDigest,
        },
      }),
    );
  }

  if (state === null) fail("transition", "$state");
  if (command.commandType === "evidence.record-managed-evidence") {
    if (state.demandId !== command.manifest.demandId) {
      fail("identity", "$/manifest/demandId");
    }
    try {
      recordManagedEvidenceInDemandAggregateState(state, command.manifest);
    } catch (error: unknown) {
      if (error instanceof DemandAggregateStateError) {
        fail("transition", "$state/managedEvidence");
      }
      throw error;
    }
    return singleEvent(
      parseDemandUncommittedEvent({
        eventId: command.eventId,
        demandId: command.manifest.demandId,
        recordedAt: command.manifest.capturedAt,
        eventType: "evidence.managed-evidence-recorded",
        data: { manifest: command.manifest },
      }),
    );
  }
  if (command.commandType === "lifecycle.complete-demand") {
    if (state.demandId !== command.completion.demandId) {
      fail("identity", "$/completion/demandId");
    }
    try {
      completeDemandAggregateState(state, command.completion);
    } catch (error: unknown) {
      if (error instanceof DemandAggregateStateError) {
        fail("transition", "$state");
      }
      throw error;
    }
    return singleEvent(
      parseDemandUncommittedEvent({
        eventId: command.eventId,
        demandId: command.completion.demandId,
        recordedAt: command.completion.completedAt,
        eventType: "lifecycle.demand-completed",
        data: { completion: command.completion },
      }),
    );
  }
  if (command.commandType === "review.decide-target-result") {
    return decideReview(state, command);
  }
  if (command.commandType === "result.record-target-result") {
    try {
      recordTargetResultInDemandAggregateState(
        state,
        command.result,
        command.callback,
      );
    } catch (error: unknown) {
      if (error instanceof DemandAggregateStateError) {
        fail("transition", "$state/targetTasks");
      }
      throw error;
    }
    return singleEvent(
      parseDemandUncommittedEvent({
        eventId: targetResultRecordedEventIdFromResult(command.result),
        demandId: command.result.demandId,
        recordedAt: command.result.report.reportedAt,
        eventType: "result.target-result-recorded",
        data: {
          result: command.result,
          callback: command.callback,
          evidenceResolution: command.evidenceResolution,
        },
      }),
    );
  }
  if (command.commandType === "result.reissue-callback") {
    try {
      reissueCallbackInDemandAggregateState(state, command.reissue);
    } catch (error: unknown) {
      if (error instanceof DemandAggregateStateError) {
        fail("transition", "$state/targetTasks");
      }
      throw error;
    }
    return singleEvent(
      parseDemandUncommittedEvent({
        eventId: command.eventId,
        demandId: state.demandId,
        recordedAt: command.reissue.issuedAt,
        eventType: "result.callback-reissued",
        data: { reissue: command.reissue },
      }),
    );
  }
  if (command.commandType === "delivery.rearm-delivery") {
    try {
      rearmDeliveryInDemandAggregateState(state, command.rearm);
    } catch (error: unknown) {
      if (error instanceof DemandAggregateStateError) {
        fail("transition", "$state/targetTasks");
      }
      throw error;
    }
    return singleEvent(
      parseDemandUncommittedEvent({
        eventId: command.eventId,
        demandId: state.demandId,
        recordedAt: command.rearm.rearmedAt,
        eventType: "delivery.delivery-rearmed",
        data: { rearm: command.rearm },
      }),
    );
  }
  if (command.commandType === "delivery.record-delivery-outcome") {
    try {
      recordDeliveryOutcomeInDemandAggregateState(state, command.outcome);
    } catch (error: unknown) {
      if (error instanceof DemandAggregateStateError) {
        fail("transition", "$state/targetTasks");
      }
      throw error;
    }
    return singleEvent(
      parseDemandUncommittedEvent({
        eventId: command.eventId,
        demandId: state.demandId,
        recordedAt: command.outcome.observedAt,
        eventType: "delivery.delivery-outcome-recorded",
        data: { outcome: command.outcome },
      }),
    );
  }
  if (command.commandType === "delivery.prepare-delivery") {
    if (state.demandId !== command.envelope.demandId) {
      fail("identity", "$/envelope/demandId");
    }
    try {
      prepareDeliveryInDemandAggregateState(state, command.envelope);
    } catch (error: unknown) {
      if (error instanceof DemandAggregateStateError) {
        fail("transition", "$state/targetTasks");
      }
      throw error;
    }
    return singleEvent(
      parseDemandUncommittedEvent({
        eventId: command.eventId,
        demandId: command.envelope.demandId,
        recordedAt: command.envelope.preparedAt,
        eventType: "delivery.delivery-prepared",
        data: { envelope: command.envelope },
      }),
    );
  }
  if (command.commandType === "tasking.plan-target-task") {
    if (state.demandId !== command.taskPackage.demandId) {
      fail("identity", "$/taskPackage/demandId");
    }
    try {
      planTargetTaskInDemandAggregateState(state, command.taskPackage);
    } catch (error: unknown) {
      if (error instanceof DemandAggregateStateError) {
        fail("transition", "$state/targetTasks");
      }
      throw error;
    }
    return singleEvent(
      parseDemandUncommittedEvent({
        eventId: command.eventId,
        demandId: command.taskPackage.demandId,
        recordedAt: command.taskPackage.createdAt,
        eventType: "tasking.target-task-planned",
        data: { taskPackage: command.taskPackage },
      }),
    );
  }
  if (state.demandId !== command.demandId) fail("identity", "$/demandId");
  if (command.commandType === "lifecycle.escalate-demand") {
    try {
      escalateDemandAggregateState(state, command.escalation, command.eventId);
    } catch (error: unknown) {
      if (error instanceof DemandAggregateStateError) {
        fail("transition", "$state/awaitingDecision");
      }
      throw error;
    }
    return singleEvent(
      parseDemandUncommittedEvent({
        eventId: command.eventId,
        demandId: command.demandId,
        recordedAt: command.recordedAt,
        eventType: "lifecycle.demand-escalated",
        data: { escalation: command.escalation },
      }),
    );
  }
  if (command.commandType === "lifecycle.record-decision") {
    try {
      recordDecisionInDemandAggregateState(
        state,
        command.decision.escalationEventId,
      );
    } catch (error: unknown) {
      if (error instanceof DemandAggregateStateError) {
        fail("transition", "$state/awaitingDecision");
      }
      throw error;
    }
    return singleEvent(
      parseDemandUncommittedEvent({
        eventId: command.eventId,
        demandId: command.demandId,
        recordedAt: command.recordedAt,
        eventType: "lifecycle.decision-recorded",
        data: { decision: command.decision },
      }),
    );
  }
  if (command.commandType === "lifecycle.continue-demand") {
    try {
      continueDemandAggregateState(
        state,
        command.continuation.kind,
        command.eventId,
      );
    } catch (error: unknown) {
      if (error instanceof DemandAggregateStateError) {
        fail("transition", "$state/lifecycle");
      }
      throw error;
    }
    return singleEvent(
      parseDemandUncommittedEvent({
        eventId: command.eventId,
        demandId: command.demandId,
        recordedAt: command.recordedAt,
        eventType: "lifecycle.demand-continued",
        data: { continuation: command.continuation },
      }),
    );
  }
  if (state.lifecycle !== "active") fail("transition", "$state/lifecycle");
  return singleEvent(
    parseDemandUncommittedEvent({
      eventId: command.eventId,
      demandId: command.demandId,
      recordedAt: command.recordedAt,
      eventType: "lifecycle.demand-cancelled",
      data: { reason: command.reason },
    }),
  );
}

/**
 * 评审决定的事件组：决定事件之后，escalate 附带升级（实现 escalate 与测试
 * needs-decision），测试 product-defect 附带缺陷修复授权，rework 达阈值附带刹车升级。
 */
function decideReview(
  state: Readonly<DemandAggregateState>,
  command: DecideTargetResultReviewCommand,
): DecidedEvents {
  let decided: Readonly<DemandAggregateState>;
  try {
    decided = decideTargetResultReviewInDemandAggregateState(
      state,
      command.decision,
    );
  } catch (error: unknown) {
    if (error instanceof DemandAggregateStateError) {
      fail("transition", "$state/targetTasks");
    }
    throw error;
  }
  const decidedEvent = parseDemandUncommittedEvent({
    eventId: controllerReviewDecisionEventId(command.decision),
    demandId: command.decision.demandId,
    recordedAt: command.decision.decidedAt,
    eventType: "review.target-result-decided",
    data: { decision: command.decision },
  });
  const authorization = command.authorization;
  if (authorization !== undefined) {
    try {
      authorizeProductDefectRemediationInDemandAggregateState(
        decided,
        authorization,
      );
    } catch (error: unknown) {
      if (error instanceof DemandAggregateStateError) {
        fail("transition", "$state/targetTasks");
      }
      throw error;
    }
    return Object.freeze([
      decidedEvent,
      parseDemandUncommittedEvent({
        eventId: productDefectRemediationAuthorizedEventId(authorization),
        demandId: authorization.demandId,
        recordedAt: authorization.authorizedAt,
        eventType: "review.product-defect-remediation-authorized",
        data: { authorization },
      }),
    ]);
  }
  const escalation = reviewEscalation(decided, command.decision, decidedEvent);
  if (escalation !== null) return Object.freeze([decidedEvent, escalation]);
  const brake = reworkBrakeEscalation(decided, command.decision, decidedEvent);
  return brake === null
    ? singleEvent(decidedEvent)
    : Object.freeze([decidedEvent, brake]);
}

function reviewEscalationContent(
  decision: DecideTargetResultReviewCommand["decision"],
): Readonly<ControllerReviewEscalation> | null {
  if (decision.decision !== "escalate") return null;
  if (decision.kind === "WakeflowControllerImplementationReviewDecision") {
    return decision.escalation;
  }
  return decision.escalation?.classification === "needs-decision"
    ? decision.escalation.userDecision
    : null;
}

/** escalate 决定同一提交附带 `lifecycle.demand-escalated{source: review-decision}`。 */
function reviewEscalation(
  decided: Readonly<DemandAggregateState>,
  decision: DecideTargetResultReviewCommand["decision"],
  decidedEvent: Readonly<DemandUncommittedEvent>,
): Readonly<DemandUncommittedEvent> | null {
  const content = reviewEscalationContent(decision);
  if (content === null) return null;
  const escalationEvent = parseDemandUncommittedEvent({
    eventId: derivedEventId("demand-event:review-escalation", decidedEvent.eventId),
    demandId: decision.demandId,
    recordedAt: decision.decidedAt,
    eventType: "lifecycle.demand-escalated",
    data: {
      escalation: {
        issue: content.issue,
        requirementRefs: content.requirementRefs,
        evidence: content.evidence,
        options: content.options,
        recommendation: content.recommendation,
        source: {
          kind: "review-decision",
          targetTaskId: decision.targetTaskId,
          targetReviewDecisionId: decision.targetReviewDecisionId,
          decisionDigest: decision.decisionDigest,
        },
      },
    },
  });
  if (escalationEvent.eventType !== "lifecycle.demand-escalated") {
    fail("lifecycle-data", "$/decision/escalation");
  }
  try {
    escalateDemandAggregateState(
      decided,
      escalationEvent.data.escalation,
      escalationEvent.eventId,
    );
  } catch (error: unknown) {
    if (error instanceof DemandAggregateStateError) {
      fail("transition", "$state/awaitingDecision");
    }
    throw error;
  }
  return escalationEvent;
}

/**
 * 第三次 rework 刹车：评审决定为 rework 且该目标累计 rework 次数达到阈值时，
 * 同一提交附带一个 `lifecycle.demand-escalated`；升级事件标识由决定事件派生。
 */
function reworkBrakeEscalation(
  decided: Readonly<DemandAggregateState>,
  decision: DecideTargetResultReviewCommand["decision"],
  decidedEvent: Readonly<DemandUncommittedEvent>,
): Readonly<DemandUncommittedEvent> | null {
  if (decision.decision !== "rework" || decided.awaitingDecision !== undefined) {
    return null;
  }
  const target = decided.targetTasks.find(
    (entry) => entry.targetTaskId === decision.targetTaskId,
  );
  if (
    target === undefined ||
    target.workType === "test" ||
    (target.reworkCount ?? 0) < DEMAND_REWORK_ESCALATION_THRESHOLD
  ) {
    return null;
  }
  const reworkCount = target.reworkCount ?? 0;
  return parseDemandUncommittedEvent({
    eventId: derivedEventId("demand-event:rework-brake", decidedEvent.eventId),
    demandId: decision.demandId,
    recordedAt: decision.decidedAt,
    eventType: "lifecycle.demand-escalated",
    data: {
      escalation: {
        issue: `Target task ${decision.targetTaskId} was sent back for rework ${reworkCount} times; the rework brake (threshold ${DEMAND_REWORK_ESCALATION_THRESHOLD}) requires a user decision before further delivery.`,
        requirementRefs: [],
        evidence: [
          {
            kind: "review-decision",
            id: decision.targetReviewDecisionId,
            digest: decision.decisionDigest,
          },
        ],
        options: [
          {
            option: "Narrow or restate the requirement, then plan a replacement task package.",
            impact: "Requires a supplementary requirement package from Design.",
          },
          {
            option: "Accept the current result with the recorded residual risks.",
            impact: "The demand can complete without another rework round.",
          },
          {
            option: "Cancel the demand.",
            impact: "Results and evidence are archived; the requirement package is withdrawn.",
          },
        ],
        recommendation: `Review the ${reworkCount} rework decisions before choosing; repeated rework usually means the task package or the requirement is under-specified.`,
        source: {
          kind: "rework-brake",
          targetTaskId: decision.targetTaskId,
          reworkCount,
        },
      },
    },
  });
}

function derivedEventId(
  namespace: string,
  decisionEventId: WakeflowDurableId<"demand-event">,
): WakeflowDurableId<"demand-event"> {
  return createWakeflowDurableId(
    "demand-event",
    parseUuidV4(deriveUuidV4(namespace, decisionEventId), "$eventId"),
  );
}

/** 将一个已决定但尚未持久化的事件确定性应用到状态。 */
export function evolveDemandEventSourcingState(
  stateValue: unknown,
  eventValue: unknown,
): Readonly<DemandAggregateState> {
  const state = parseState(stateValue);
  let event: Readonly<DemandUncommittedEvent>;
  try {
    event = parseDemandUncommittedEvent(eventValue);
  } catch (error: unknown) {
    if (error instanceof DemandEventSourcingEventError) fail("event", "$event");
    throw error;
  }

  if (event.eventType === "publication.demand-published") {
    if (state !== null) fail("transition", "$state");
    return createInitialDemandAggregateState(
      event.demandId,
      event.data.authorityDigest,
    );
  }
  if (state === null) fail("transition", "$state");
  if (state.demandId !== event.demandId) fail("identity", "$/demandId");
  if (event.eventType === "evidence.managed-evidence-recorded") {
    try {
      return recordManagedEvidenceInDemandAggregateState(
        state,
        event.data.manifest,
      );
    } catch (error: unknown) {
      if (error instanceof DemandAggregateStateError) {
        fail("transition", "$state/managedEvidence");
      }
      throw error;
    }
  }
  if (event.eventType === "tasking.target-task-planned") {
    try {
      return planTargetTaskInDemandAggregateState(
        state,
        event.data.taskPackage,
      );
    } catch (error: unknown) {
      if (error instanceof DemandAggregateStateError) {
        fail("transition", "$state/targetTasks");
      }
      throw error;
    }
  }
  if (event.eventType === "delivery.delivery-prepared") {
    try {
      return prepareDeliveryInDemandAggregateState(state, event.data.envelope);
    } catch (error: unknown) {
      if (error instanceof DemandAggregateStateError) {
        fail("transition", "$state/targetTasks");
      }
      throw error;
    }
  }
  if (event.eventType === "delivery.delivery-outcome-recorded") {
    try {
      return recordDeliveryOutcomeInDemandAggregateState(
        state,
        event.data.outcome,
      );
    } catch (error: unknown) {
      if (error instanceof DemandAggregateStateError) {
        fail("transition", "$state/targetTasks");
      }
      throw error;
    }
  }
  if (event.eventType === "delivery.delivery-rearmed") {
    try {
      return rearmDeliveryInDemandAggregateState(state, event.data.rearm);
    } catch (error: unknown) {
      if (error instanceof DemandAggregateStateError) {
        fail("transition", "$state/targetTasks");
      }
      throw error;
    }
  }
  if (event.eventType === "result.target-result-recorded") {
    try {
      return recordTargetResultInDemandAggregateState(
        state,
        event.data.result,
        event.data.callback,
      );
    } catch (error: unknown) {
      if (error instanceof DemandAggregateStateError) {
        fail("transition", "$state/targetTasks");
      }
      throw error;
    }
  }
  if (event.eventType === "result.callback-reissued") {
    try {
      return reissueCallbackInDemandAggregateState(state, event.data.reissue);
    } catch (error: unknown) {
      if (error instanceof DemandAggregateStateError) {
        fail("transition", "$state/targetTasks");
      }
      throw error;
    }
  }
  if (event.eventType === "review.target-result-decided") {
    try {
      return decideTargetResultReviewInDemandAggregateState(
        state,
        event.data.decision,
      );
    } catch (error: unknown) {
      if (error instanceof DemandAggregateStateError) {
        fail("transition", "$state/targetTasks");
      }
      throw error;
    }
  }
  if (event.eventType === "review.product-defect-remediation-authorized") {
    try {
      return authorizeProductDefectRemediationInDemandAggregateState(
        state,
        event.data.authorization,
      );
    } catch (error: unknown) {
      if (error instanceof DemandAggregateStateError) {
        fail("transition", "$state/targetTasks");
      }
      throw error;
    }
  }
  if (event.eventType === "lifecycle.demand-escalated") {
    try {
      return escalateDemandAggregateState(
        state,
        event.data.escalation,
        event.eventId,
      );
    } catch (error: unknown) {
      if (error instanceof DemandAggregateStateError) {
        fail("transition", "$state/awaitingDecision");
      }
      throw error;
    }
  }
  if (event.eventType === "lifecycle.decision-recorded") {
    try {
      return recordDecisionInDemandAggregateState(
        state,
        event.data.decision.escalationEventId,
      );
    } catch (error: unknown) {
      if (error instanceof DemandAggregateStateError) {
        fail("transition", "$state/awaitingDecision");
      }
      throw error;
    }
  }
  if (event.eventType === "lifecycle.demand-continued") {
    try {
      return continueDemandAggregateState(
        state,
        event.data.continuation.kind,
        event.eventId,
      );
    } catch (error: unknown) {
      if (error instanceof DemandAggregateStateError) {
        fail("transition", "$state/lifecycle");
      }
      throw error;
    }
  }
  if (event.eventType === "lifecycle.demand-completed") {
    try {
      return completeDemandAggregateState(state, event.data.completion);
    } catch (error: unknown) {
      if (error instanceof DemandAggregateStateError) {
        fail("transition", "$state/lifecycle");
      }
      throw error;
    }
  }
  if (event.eventType === "lifecycle.demand-cancelled") {
    try {
      return cancelDemandAggregateState(state);
    } catch (error: unknown) {
      if (error instanceof DemandAggregateStateError) {
        fail("transition", "$state/lifecycle");
      }
      throw error;
    }
  }
  return unhandledEvent(event);
}

/** 穷尽性守卫：事件联合多出成员时这里编译不过，新事件不会落进任何兜底分支。 */
function unhandledEvent(_event: never): never {
  fail("event", "$/eventType");
}
