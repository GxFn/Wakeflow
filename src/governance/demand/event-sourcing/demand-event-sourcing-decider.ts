import {
  createWakeflowDurableId,
  parseWakeflowDurableIdOfKind,
  type WakeflowDurableId,
  WakeflowDurableIdError,
} from "../../../contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../../foundation/crypto/sha256.js";
import { parseSha256Digest, Sha256Error } from "../../../foundation/crypto/sha256.js";
import {
  PassiveOwnDataError,
  parsePlainRecord,
} from "../../../foundation/data/passive-own-data.js";
import { type Fail, failWith, ModuleError } from "../../../foundation/error/module-error.js";
import { deriveUuidV4, parseUuidV4 } from "../../../foundation/identity/uuid-v4.js";
import {
  parseUtcInstant,
  type UtcInstant,
  UtcInstantError,
} from "../../../foundation/time/utc-instant.js";
import {
  assertDeliveryEnvelopeMatchesTaskPackage,
  type DeliveryEnvelope,
  DeliveryEnvelopeError,
  parseDeliveryEnvelope,
} from "../../delivery/delivery-envelope.js";
import {
  type DeliveryOutcome,
  DeliveryOutcomeError,
  parseDeliveryOutcome,
} from "../../delivery/delivery-outcome.js";
import {
  type DeliveryRearm,
  DeliveryRearmError,
  parseDeliveryRearm,
} from "../../delivery/delivery-rearm.js";
import {
  createTargetDeliveryProductDefectRemediationContext,
  TargetDeliveryProductDefectRemediationContextError,
} from "../../review/target-delivery-product-defect-remediation-context.js";
import {
  createTargetDeliveryReworkContext,
  TargetDeliveryReworkContextError,
} from "../../review/target-delivery-rework-context.js";
import {
  type ManagedEvidenceManifest,
  ManagedEvidenceManifestError,
  parseManagedEvidenceManifest,
} from "../../evidence/managed-evidence-manifest.js";
import {
  type DemandCompletion,
  DemandCompletionError,
  parseDemandCompletion,
} from "../../lifecycle/demand-completion.js";
import {
  parseTargetResult,
  type TargetResult,
  TargetResultError,
  targetResultRecordedEventIdFromResult,
} from "../../result/target-result.js";
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
  parseTargetSessionPromptObservation,
  type TargetSessionPromptObservation,
  TargetSessionPromptObservationError,
} from "../../result/target-session-prompts.js";
import {
  type ControllerImplementationReviewDecision,
  ControllerImplementationReviewDecisionError,
  parseControllerImplementationReviewDecision,
} from "../../review/controller-implementation-review-decision.js";
import {
  type ControllerProductDefectRemediationAuthorization,
  ControllerProductDefectRemediationAuthorizationError,
  parseControllerProductDefectRemediationAuthorization,
  productDefectRemediationAuthorizedEventId,
} from "../../review/controller-product-defect-remediation-authorization.js";
import {
  type ControllerReviewDecision,
  ControllerReviewDecisionError,
  controllerReviewDecisionEventId,
  parseControllerReviewDecision,
} from "../../review/controller-review-decision.js";
import type { ControllerReviewEscalation } from "../../review/controller-review-decision-contract.js";
import {
  parseTaskPackage,
  type TaskPackage,
  TaskPackageError,
} from "../../tasking/task-package.js";
import {
  assertTestExecutionAttemptMatchesPackage,
  TestExecutionAttemptError,
} from "../../testing/test-execution-attempt.js";
import {
  authorizeProductDefectRemediationInDemandAggregateState,
  cancelDemandAggregateState,
  completeDemandAggregateState,
  continueDemandAggregateState,
  createInitialDemandAggregateState,
  type DemandAggregateState,
  DemandAggregateStateError,
  decideTargetResultReviewInDemandAggregateState,
  escalateDemandAggregateState,
  historicalTestTargetIdsAtContinuation,
  parseDemandAggregateState,
  planTargetTaskInDemandAggregateState,
  prepareDeliveryInDemandAggregateState,
  rearmDeliveryInDemandAggregateState,
  recordDecisionInDemandAggregateState,
  recordDeliveryOutcomeInDemandAggregateState,
  recordManagedEvidenceInDemandAggregateState,
  recordTargetResultInDemandAggregateState,
  reissueCallbackInDemandAggregateState,
} from "../model/demand-aggregate-state.js";
import {
  computeDemandAuthorityDigest,
  type DemandAuthority,
  DemandAuthorityError,
  parseDemandAuthority,
} from "../model/demand-authority.js";
import {
  type DemandContinuation,
  type DemandDecisionRecord,
  type DemandEscalation,
  DemandEventSourcingEventError,
  type DemandUncommittedEvent,
  parseDemandUncommittedEvent,
} from "./demand-event-sourcing-event.js";

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
  /** 导入那一刻对目标会话的越级观察（open-items H13）；没有观察的调用方不给。 */
  readonly sessionPrompts?: Readonly<TargetSessionPromptObservation>;
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

export class DemandEventSourcingDecisionError extends ModuleError<DemandEventSourcingDecisionErrorReason> {
  static override readonly code = "wakeflow-demand-event-sourcing-decision";
}

const fail: Fail<DemandEventSourcingDecisionErrorReason> = failWith(
  DemandEventSourcingDecisionError,
);

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
/**
 * 同一实现目标的第三次 rework 被刹车拒绝（ADR-0012 D5，W21 修法 B）：Controller 改记 escalate 交用户
 * 决定，用户回答后带 `decision-recorded` resumption 的 rework 放行一次。阈值进配置留作后续。
 */
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
const RECORD_OBSERVED_TARGET_RESULT_FIELDS = Object.freeze([
  "callback",
  "commandType",
  "commandVersion",
  "evidenceResolution",
  "result",
  "sessionPrompts",
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
// biome-ignore lint/suspicious/noControlCharactersInRegex: the pattern exists to reject control characters in record text
const CONTROL_EXCEPT_LF_PATTERN = /\r|[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;

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
      fail("lifecycle-data", "$/data", error);
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
  if (keys.length !== fields.length || keys.some((key, index) => key !== fields[index])) {
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
    if (error instanceof WakeflowDurableIdError) fail("identifier", path, error);
    throw error;
  }
}

function parseTime(value: unknown): UtcInstant {
  try {
    return parseUtcInstant(value, "$/recordedAt");
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) fail("time", "$/recordedAt", error);
    throw error;
  }
}

function parseDigest(value: unknown, path: string): Sha256Digest {
  try {
    return parseSha256Digest(value, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("digest", path, error);
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

function parsePublishDemandCommand(
  base: Readonly<Record<string, unknown>>,
): Readonly<DemandEventSourcingCommand> {
  const command = exactCommand(base, PUBLISH_FIELDS);
  return Object.freeze({
    commandType: "publication.publish-demand",
    commandVersion: 1,
    demandId: parseId(command.demandId, "demand", "$/demandId"),
    eventId: parseId(command.eventId, "demand-event", "$/eventId"),
    recordedAt: parseTime(command.recordedAt),
    identityDigest: parseDigest(command.identityDigest, "$/identityDigest"),
    authorityDigest: parseDigest(command.authorityDigest, "$/authorityDigest"),
  });
}

function parseCancelDemandCommand(
  base: Readonly<Record<string, unknown>>,
): Readonly<DemandEventSourcingCommand> {
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

function parseCompleteDemandCommand(
  base: Readonly<Record<string, unknown>>,
): Readonly<DemandEventSourcingCommand> {
  const command = exactCommand(base, COMPLETE_DEMAND_FIELDS);
  let authority: Readonly<DemandAuthority>;
  let completion: Readonly<DemandCompletion>;
  try {
    authority = parseDemandAuthority(command.authority);
  } catch (error: unknown) {
    if (error instanceof DemandAuthorityError) {
      fail("demand-authority", "$/authority", error);
    }
    throw error;
  }
  try {
    completion = parseDemandCompletion(command.completion);
  } catch (error: unknown) {
    if (error instanceof DemandCompletionError) {
      fail("demand-completion", "$/completion", error);
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

function parseEscalateDemandCommand(
  base: Readonly<Record<string, unknown>>,
): Readonly<DemandEventSourcingCommand> {
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

function parseRecordDecisionCommand(
  base: Readonly<Record<string, unknown>>,
): Readonly<DemandEventSourcingCommand> {
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

function parseContinueDemandCommand(
  base: Readonly<Record<string, unknown>>,
): Readonly<DemandEventSourcingCommand> {
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

function parsePlanTargetTaskCommand(
  base: Readonly<Record<string, unknown>>,
): Readonly<DemandEventSourcingCommand> {
  const command = exactCommand(base, PLAN_TARGET_TASK_FIELDS);
  let taskPackage: Readonly<TaskPackage>;
  try {
    taskPackage = parseTaskPackage(command.taskPackage);
  } catch (error: unknown) {
    if (error instanceof TaskPackageError) {
      fail("task-package", "$/taskPackage", error);
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

function parseRecordManagedEvidenceCommand(
  base: Readonly<Record<string, unknown>>,
): Readonly<DemandEventSourcingCommand> {
  const command = exactCommand(base, RECORD_MANAGED_EVIDENCE_FIELDS);
  let manifest: Readonly<ManagedEvidenceManifest>;
  try {
    manifest = parseManagedEvidenceManifest(command.manifest);
  } catch (error: unknown) {
    if (error instanceof ManagedEvidenceManifestError) {
      fail("managed-evidence-manifest", "$/manifest", error);
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

/** prepare 命令带来的信封与任务包：各自合法，并且彼此对得上。 */
function parsePreparedEnvelopeAndPackage(
  command: Readonly<Record<string, unknown>>,
): Readonly<{ envelope: Readonly<DeliveryEnvelope>; taskPackage: Readonly<TaskPackage> }> {
  let envelope: Readonly<DeliveryEnvelope>;
  let taskPackage: Readonly<TaskPackage>;
  try {
    envelope = parseDeliveryEnvelope(command.envelope);
  } catch (error: unknown) {
    if (error instanceof DeliveryEnvelopeError) {
      fail("delivery-envelope", "$/envelope", error);
    }
    throw error;
  }
  try {
    taskPackage = parseTaskPackage(command.taskPackage);
    assertDeliveryEnvelopeMatchesTaskPackage(envelope, taskPackage);
  } catch (error: unknown) {
    if (error instanceof TaskPackageError) {
      fail("task-package", "$/taskPackage", error);
    }
    if (error instanceof DeliveryEnvelopeError) {
      fail("delivery-envelope", "$/envelope", error);
    }
    throw error;
  }
  return { envelope, taskPackage };
}

/** 由决定与上一份结果投影出返工上下文，与信封里的那份比摘要。 */
function assertReworkContextMatchesEnvelope(
  decision: Readonly<ControllerImplementationReviewDecision>,
  previousResult: Readonly<TargetResult>,
  envelope: Readonly<DeliveryEnvelope>,
): void {
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
      fail("target-delivery-rework-context", "$/reworkSource", error);
    }
    throw error;
  }
}

/** 返工投递的来源：评审决定与上一份结果，投影出来的返工上下文必须与信封里的那份逐字节相同。 */
function parseReworkSource(
  value: unknown,
  envelope: Readonly<DeliveryEnvelope>,
): NonNullable<PrepareDeliveryCommand["reworkSource"]> {
  let source: Readonly<Record<string, unknown>>;
  try {
    source = parsePlainRecord(value, "$/reworkSource");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) {
      fail("target-delivery-rework-context", "$/reworkSource", error);
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
      fail("controller-implementation-review-decision", "$/reworkSource/decision", error);
    }
    throw error;
  }
  try {
    previousResult = parseTargetResult(source.previousResult);
  } catch (error: unknown) {
    if (error instanceof TargetResultError) {
      fail("target-result", "$/reworkSource/previousResult", error);
    }
    throw error;
  }
  assertReworkContextMatchesEnvelope(decision, previousResult, envelope);
  return Object.freeze({ decision, previousResult });
}

/** 由授权与上一份结果投影出修复上下文，与信封里的那份比摘要。 */
function assertRemediationContextMatchesEnvelope(
  authorization: Readonly<ControllerProductDefectRemediationAuthorization>,
  previousResult: Readonly<TargetResult>,
  envelope: Readonly<DeliveryEnvelope>,
): void {
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
    if (error instanceof TargetDeliveryProductDefectRemediationContextError) {
      fail(
        "target-delivery-product-defect-remediation-context",
        "$/productDefectRemediationSource",
        error,
      );
    }
    throw error;
  }
}

/** 产品缺陷修复投递的来源：授权与上一份结果，投影出来的修复上下文必须与信封里的那份逐字节相同。 */
function parseProductDefectRemediationSource(
  value: unknown,
  envelope: Readonly<DeliveryEnvelope>,
): NonNullable<PrepareDeliveryCommand["productDefectRemediationSource"]> {
  let source: Readonly<Record<string, unknown>>;
  try {
    source = parsePlainRecord(value, "$/productDefectRemediationSource");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) {
      fail(
        "target-delivery-product-defect-remediation-context",
        "$/productDefectRemediationSource",
        error,
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
    fail("target-delivery-product-defect-remediation-context", "$/productDefectRemediationSource");
  }
  let authorization: Readonly<ControllerProductDefectRemediationAuthorization>;
  let previousResult: Readonly<TargetResult>;
  try {
    authorization = parseControllerProductDefectRemediationAuthorization(source.authorization);
  } catch (error: unknown) {
    if (error instanceof ControllerProductDefectRemediationAuthorizationError) {
      fail(
        "controller-product-defect-remediation-authorization",
        "$/productDefectRemediationSource/authorization",
        error,
      );
    }
    throw error;
  }
  try {
    previousResult = parseTargetResult(source.previousResult);
  } catch (error: unknown) {
    if (error instanceof TargetResultError) {
      fail("target-result", "$/productDefectRemediationSource/previousResult", error);
    }
    throw error;
  }
  assertRemediationContextMatchesEnvelope(authorization, previousResult, envelope);
  return Object.freeze({ authorization, previousResult });
}

function assertTestAttemptMatchesPackage(
  envelope: Readonly<Extract<DeliveryEnvelope, { readonly workType: "test" }>>,
  taskPackage: Readonly<TaskPackage>,
): void {
  try {
    assertTestExecutionAttemptMatchesPackage(envelope.attempt, taskPackage);
  } catch (error: unknown) {
    if (error instanceof TestExecutionAttemptError) {
      fail("delivery-envelope", "$/envelope/attempt", error);
    }
    throw error;
  }
}

/** 命令带着返工来源就解析它；没带而信封里有返工上下文，是缺了来源。 */
function optionalReworkSource(
  present: boolean,
  command: Readonly<Record<string, unknown>>,
  envelope: Readonly<DeliveryEnvelope>,
): PrepareDeliveryCommand["reworkSource"] {
  if (present) return parseReworkSource(command.reworkSource, envelope);
  if (envelope.rework !== undefined) fail("target-delivery-rework-context", "$/reworkSource");
  return undefined;
}

/** 命令带着修复来源就解析它；没带而信封里有修复上下文，是缺了来源。 */
function optionalProductDefectRemediationSource(
  present: boolean,
  command: Readonly<Record<string, unknown>>,
  envelope: Readonly<DeliveryEnvelope>,
): PrepareDeliveryCommand["productDefectRemediationSource"] {
  if (present) {
    return parseProductDefectRemediationSource(command.productDefectRemediationSource, envelope);
  }
  if (envelope.productDefectRemediation !== undefined) {
    fail("target-delivery-product-defect-remediation-context", "$/productDefectRemediationSource");
  }
  return undefined;
}

function parsePrepareDeliveryCommand(
  base: Readonly<Record<string, unknown>>,
): Readonly<DemandEventSourcingCommand> {
  const hasReworkSource = Object.hasOwn(base, "reworkSource");
  const hasProductDefectRemediationSource = Object.hasOwn(base, "productDefectRemediationSource");
  if (hasReworkSource && hasProductDefectRemediationSource) {
    fail("input", "$command");
  }
  const command = exactCommand(
    base,
    [
      ...PREPARE_DELIVERY_BASE_FIELDS,
      ...(hasReworkSource ? (["reworkSource"] as const) : []),
      ...(hasProductDefectRemediationSource ? (["productDefectRemediationSource"] as const) : []),
    ].sort(),
  );
  const { envelope, taskPackage } = parsePreparedEnvelopeAndPackage(command);
  if (envelope.workType === "test") {
    assertTestAttemptMatchesPackage(envelope, taskPackage);
    if (hasReworkSource || hasProductDefectRemediationSource) {
      fail("input", "$command");
    }
  }
  const reworkSource = optionalReworkSource(hasReworkSource, command, envelope);
  const productDefectRemediationSource = optionalProductDefectRemediationSource(
    hasProductDefectRemediationSource,
    command,
    envelope,
  );
  return Object.freeze({
    commandType: "delivery.prepare-delivery",
    commandVersion: 1,
    eventId: parseId(command.eventId, "demand-event", "$/eventId"),
    envelope,
    taskPackage,
    ...(reworkSource === undefined ? {} : { reworkSource }),
    ...(productDefectRemediationSource === undefined ? {} : { productDefectRemediationSource }),
  });
}

function parseRecordDeliveryOutcomeCommand(
  base: Readonly<Record<string, unknown>>,
): Readonly<DemandEventSourcingCommand> {
  const command = exactCommand(base, RECORD_DELIVERY_OUTCOME_FIELDS);
  let outcome: Readonly<DeliveryOutcome>;
  try {
    outcome = parseDeliveryOutcome(command.outcome);
  } catch (error: unknown) {
    if (error instanceof DeliveryOutcomeError) {
      fail("delivery-outcome", "$/outcome", error);
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

function parseRearmDeliveryCommand(
  base: Readonly<Record<string, unknown>>,
): Readonly<DemandEventSourcingCommand> {
  const command = exactCommand(base, REARM_DELIVERY_FIELDS);
  let rearm: Readonly<DeliveryRearm>;
  try {
    rearm = parseDeliveryRearm(command.rearm);
  } catch (error: unknown) {
    if (error instanceof DeliveryRearmError) fail("delivery-rearm", "$/rearm", error);
    throw error;
  }
  return Object.freeze({
    commandType: "delivery.rearm-delivery",
    commandVersion: 1,
    eventId: parseId(command.eventId, "demand-event", "$/eventId"),
    rearm,
  });
}

function parseRecordTargetResultCommand(
  base: Readonly<Record<string, unknown>>,
): Readonly<DemandEventSourcingCommand> {
  const observed = Object.hasOwn(base, "sessionPrompts");
  const command = exactCommand(
    base,
    observed ? RECORD_OBSERVED_TARGET_RESULT_FIELDS : RECORD_TARGET_RESULT_FIELDS,
  );
  let sessionPrompts: Readonly<TargetSessionPromptObservation> | undefined;
  if (observed) {
    try {
      sessionPrompts = parseTargetSessionPromptObservation(
        command.sessionPrompts,
        "$/sessionPrompts",
      );
    } catch (error: unknown) {
      if (error instanceof TargetSessionPromptObservationError) fail("input", error.path, error);
      throw error;
    }
  }
  let result: Readonly<TargetResult>;
  try {
    result = parseTargetResult(command.result);
  } catch (error: unknown) {
    if (error instanceof TargetResultError) {
      fail("target-result", "$/result", error);
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
      fail("target-result-callback", error.path, error);
    }
    throw error;
  }
  return Object.freeze({
    commandType: "result.record-target-result",
    commandVersion: 1,
    result,
    callback,
    evidenceResolution,
    ...(sessionPrompts === undefined ? {} : { sessionPrompts }),
  });
}

function parseReissueCallbackCommand(
  base: Readonly<Record<string, unknown>>,
): Readonly<DemandEventSourcingCommand> {
  const command = exactCommand(base, REISSUE_CALLBACK_FIELDS);
  let reissue: Readonly<TargetResultCallbackReissue>;
  try {
    reissue = parseTargetResultCallbackReissue(command.reissue, "$/reissue");
  } catch (error: unknown) {
    if (error instanceof TargetResultCallbackError) {
      fail("target-result-callback", error.path, error);
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

function parseDecideTargetResultCommand(
  base: Readonly<Record<string, unknown>>,
): Readonly<DemandEventSourcingCommand> {
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
      fail("controller-review-decision", "$/decision", error);
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
    authorization = parseControllerProductDefectRemediationAuthorization(command.authorization);
  } catch (error: unknown) {
    if (error instanceof ControllerProductDefectRemediationAuthorizationError) {
      fail("controller-product-defect-remediation-authorization", "$/authorization", error);
    }
    throw error;
  }
  if (
    authorization.source.testReviewDecision.targetReviewDecisionId !==
      decision.targetReviewDecisionId ||
    authorization.source.testReviewDecision.decisionDigest !== decision.decisionDigest ||
    authorization.source.reviewSnapshotDigest !== decision.reviewed.snapshotDigest ||
    authorization.source.streamRevision !== decision.reviewed.streamRevision + 1
  ) {
    fail("controller-product-defect-remediation-authorization", "$/authorization/source");
  }
  return Object.freeze({
    commandType: "review.decide-target-result",
    commandVersion: 1,
    decision,
    authorization,
  });
}

/**
 * 每种命令一个解析函数（open-items L5）：`parseDemandEventSourcingCommand` 只做信封核对与分派，
 * 各命令自己的字段在各自的函数里。键是命令类型的字面量，分派用 `Object.hasOwn`，原型键不算命令。
 */
const COMMAND_PARSERS: Readonly<
  Record<string, (base: Readonly<Record<string, unknown>>) => Readonly<DemandEventSourcingCommand>>
> = Object.freeze({
  "publication.publish-demand": parsePublishDemandCommand,
  "lifecycle.cancel-demand": parseCancelDemandCommand,
  "lifecycle.complete-demand": parseCompleteDemandCommand,
  "lifecycle.escalate-demand": parseEscalateDemandCommand,
  "lifecycle.record-decision": parseRecordDecisionCommand,
  "lifecycle.continue-demand": parseContinueDemandCommand,
  "tasking.plan-target-task": parsePlanTargetTaskCommand,
  "evidence.record-managed-evidence": parseRecordManagedEvidenceCommand,
  "delivery.prepare-delivery": parsePrepareDeliveryCommand,
  "delivery.record-delivery-outcome": parseRecordDeliveryOutcomeCommand,
  "delivery.rearm-delivery": parseRearmDeliveryCommand,
  "result.record-target-result": parseRecordTargetResultCommand,
  "result.reissue-callback": parseReissueCallbackCommand,
  "review.decide-target-result": parseDecideTargetResultCommand,
});

export function parseDemandEventSourcingCommand(
  value: unknown,
): Readonly<DemandEventSourcingCommand> {
  let base: Readonly<Record<string, unknown>>;
  try {
    base = parsePlainRecord(value, "$command");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$command", error);
    throw error;
  }
  if (base.commandVersion !== 1) fail("input", "$/commandVersion");
  const commandType = base.commandType;
  const parser =
    typeof commandType === "string" && Object.hasOwn(COMMAND_PARSERS, commandType)
      ? COMMAND_PARSERS[commandType]
      : undefined;
  if (parser === undefined) fail("input", "$/commandType");
  return parser(base);
}

/** 计算已准入命令的稳定幂等摘要；事件存储不接受调用方自行声明的摘要。 */
export function computeDemandEventSourcingCommandDigest(
  command: Readonly<DemandEventSourcingCommand>,
): Sha256Digest {
  return computeCanonicalJsonSha256Digest(command);
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
    if (error instanceof DemandAggregateStateError) fail("state", "$state", error);
    throw error;
  }
}

/** 一种命令的已解析形状：分派之后各段拿到的就是自己那一种（open-items L5）。 */
type CommandOf<Type extends DemandEventSourcingCommand["commandType"]> = Extract<
  DemandEventSourcingCommand,
  { readonly commandType: Type }
>;

function decidePublishDemand(
  state: Readonly<DemandAggregateState> | null,
  command: Readonly<CommandOf<"publication.publish-demand">>,
): DecidedEvents {
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

function decideRecordManagedEvidence(
  state: Readonly<DemandAggregateState>,
  command: Readonly<CommandOf<"evidence.record-managed-evidence">>,
): DecidedEvents {
  if (state.demandId !== command.manifest.demandId) {
    fail("identity", "$/manifest/demandId");
  }
  try {
    recordManagedEvidenceInDemandAggregateState(state, command.manifest);
  } catch (error: unknown) {
    if (error instanceof DemandAggregateStateError) {
      fail("transition", "$state/managedEvidence", error);
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

function decideCompleteDemand(
  state: Readonly<DemandAggregateState>,
  command: Readonly<CommandOf<"lifecycle.complete-demand">>,
): DecidedEvents {
  if (state.demandId !== command.completion.demandId) {
    fail("identity", "$/completion/demandId");
  }
  try {
    completeDemandAggregateState(state, command.completion);
  } catch (error: unknown) {
    if (error instanceof DemandAggregateStateError) {
      fail("transition", "$state", error);
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

function decideRecordTargetResult(
  state: Readonly<DemandAggregateState>,
  command: Readonly<CommandOf<"result.record-target-result">>,
): DecidedEvents {
  try {
    recordTargetResultInDemandAggregateState(state, command.result, command.callback);
  } catch (error: unknown) {
    if (error instanceof DemandAggregateStateError) {
      fail("transition", "$state/targetTasks", error);
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
        ...(command.sessionPrompts === undefined ? {} : { sessionPrompts: command.sessionPrompts }),
      },
    }),
  );
}

function decideReissueCallback(
  state: Readonly<DemandAggregateState>,
  command: Readonly<CommandOf<"result.reissue-callback">>,
): DecidedEvents {
  try {
    reissueCallbackInDemandAggregateState(state, command.reissue);
  } catch (error: unknown) {
    if (error instanceof DemandAggregateStateError) {
      fail("transition", "$state/targetTasks", error);
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

function decideRearmDelivery(
  state: Readonly<DemandAggregateState>,
  command: Readonly<CommandOf<"delivery.rearm-delivery">>,
): DecidedEvents {
  try {
    rearmDeliveryInDemandAggregateState(state, command.rearm);
  } catch (error: unknown) {
    if (error instanceof DemandAggregateStateError) {
      fail("transition", "$state/targetTasks", error);
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

function decideRecordDeliveryOutcome(
  state: Readonly<DemandAggregateState>,
  command: Readonly<CommandOf<"delivery.record-delivery-outcome">>,
): DecidedEvents {
  try {
    recordDeliveryOutcomeInDemandAggregateState(state, command.outcome);
  } catch (error: unknown) {
    if (error instanceof DemandAggregateStateError) {
      fail("transition", "$state/targetTasks", error);
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

function decidePrepareDelivery(
  state: Readonly<DemandAggregateState>,
  command: Readonly<CommandOf<"delivery.prepare-delivery">>,
): DecidedEvents {
  if (state.demandId !== command.envelope.demandId) {
    fail("identity", "$/envelope/demandId");
  }
  try {
    prepareDeliveryInDemandAggregateState(state, command.envelope);
  } catch (error: unknown) {
    if (error instanceof DemandAggregateStateError) {
      fail("transition", "$state/targetTasks", error);
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

function decidePlanTargetTask(
  state: Readonly<DemandAggregateState>,
  command: Readonly<CommandOf<"tasking.plan-target-task">>,
): DecidedEvents {
  if (state.demandId !== command.taskPackage.demandId) {
    fail("identity", "$/taskPackage/demandId");
  }
  try {
    planTargetTaskInDemandAggregateState(state, command.taskPackage);
  } catch (error: unknown) {
    if (error instanceof DemandAggregateStateError) {
      fail("transition", "$state/targetTasks", error);
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

function decideEscalateDemand(
  state: Readonly<DemandAggregateState>,
  command: Readonly<CommandOf<"lifecycle.escalate-demand">>,
): DecidedEvents {
  try {
    escalateDemandAggregateState(state, command.escalation, command.eventId);
  } catch (error: unknown) {
    if (error instanceof DemandAggregateStateError) {
      fail("transition", "$state/awaitingDecision", error);
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

function decideRecordDecision(
  state: Readonly<DemandAggregateState>,
  command: Readonly<CommandOf<"lifecycle.record-decision">>,
): DecidedEvents {
  try {
    recordDecisionInDemandAggregateState(state, command.decision.escalationEventId);
  } catch (error: unknown) {
    if (error instanceof DemandAggregateStateError) {
      fail("transition", "$state/awaitingDecision", error);
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

function decideContinueDemand(
  state: Readonly<DemandAggregateState>,
  command: Readonly<CommandOf<"lifecycle.continue-demand">>,
): DecidedEvents {
  // 续接边界是决策事实：续接前已有的 test 目标随事件持久化，归约器只照抄事件携带的边界。
  const historicalTestTargetIds = historicalTestTargetIdsAtContinuation(state);
  try {
    continueDemandAggregateState(
      state,
      command.continuation.kind,
      command.eventId,
      historicalTestTargetIds,
      command.continuation.supplement,
    );
  } catch (error: unknown) {
    if (error instanceof DemandAggregateStateError) {
      fail("transition", "$state/lifecycle", error);
    }
    throw error;
  }
  return singleEvent(
    parseDemandUncommittedEvent({
      eventId: command.eventId,
      demandId: command.demandId,
      recordedAt: command.recordedAt,
      eventType: "lifecycle.demand-continued",
      data: {
        continuation: command.continuation,
        ...(historicalTestTargetIds.length === 0 ? {} : { historicalTestTargetIds }),
      },
    }),
  );
}

function decideCancelDemand(
  state: Readonly<DemandAggregateState>,
  command: Readonly<CommandOf<"lifecycle.cancel-demand">>,
): DecidedEvents {
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

/** 根据当前状态对一条业务命令作出纯事件决策。 */
export function decideDemandEventSourcingCommand(
  state: Readonly<DemandAggregateState> | null,
  command: Readonly<DemandEventSourcingCommand>,
): DecidedEvents {
  if (command.commandType === "publication.publish-demand") {
    return decidePublishDemand(state, command);
  }
  if (state === null) fail("transition", "$state");
  // 这一组命令各自在聚合的守卫里核对归属，不在这里比对 demandId。
  switch (command.commandType) {
    case "evidence.record-managed-evidence":
      return decideRecordManagedEvidence(state, command);
    case "lifecycle.complete-demand":
      return decideCompleteDemand(state, command);
    case "review.decide-target-result":
      return decideReview(state, command);
    case "result.record-target-result":
      return decideRecordTargetResult(state, command);
    case "result.reissue-callback":
      return decideReissueCallback(state, command);
    case "delivery.rearm-delivery":
      return decideRearmDelivery(state, command);
    case "delivery.record-delivery-outcome":
      return decideRecordDeliveryOutcome(state, command);
    case "delivery.prepare-delivery":
      return decidePrepareDelivery(state, command);
    case "tasking.plan-target-task":
      return decidePlanTargetTask(state, command);
    default:
      break;
  }
  if (state.demandId !== command.demandId) fail("identity", "$/demandId");
  switch (command.commandType) {
    case "lifecycle.escalate-demand":
      return decideEscalateDemand(state, command);
    case "lifecycle.record-decision":
      return decideRecordDecision(state, command);
    case "lifecycle.continue-demand":
      return decideContinueDemand(state, command);
    default:
      return decideCancelDemand(state, command);
  }
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
    decided = decideTargetResultReviewInDemandAggregateState(state, command.decision);
  } catch (error: unknown) {
    if (error instanceof DemandAggregateStateError) {
      fail("transition", "$state/targetTasks", error);
    }
    throw error;
  }
  assertReworkBrakeReleased(state, command.decision);
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
      authorizeProductDefectRemediationInDemandAggregateState(decided, authorization);
    } catch (error: unknown) {
      if (error instanceof DemandAggregateStateError) {
        fail("transition", "$state/targetTasks", error);
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
  return escalation === null
    ? singleEvent(decidedEvent)
    : Object.freeze([decidedEvent, escalation]);
}

/**
 * 第三次 rework 刹车（ADR-0012 D5，W21 修法 B）：实现目标累计 rework 达到阈值减一后，再记 rework
 * 被拒——Controller 改记 escalate 交用户决定；用户回答后带 `decision-recorded` resumption 的 rework
 * 放行一次（resumption 的合法性已由聚合转换核对）。旧刹车附带的 `rework-brake` 升级事件留在历史流里，
 * 仍按事件重放。
 */
function assertReworkBrakeReleased(
  state: Readonly<DemandAggregateState>,
  decision: DecideTargetResultReviewCommand["decision"],
): void {
  if (
    decision.kind !== "WakeflowControllerImplementationReviewDecision" ||
    decision.decision !== "rework" ||
    decision.resumption?.basis.kind === "decision-recorded"
  ) {
    return;
  }
  const target = state.targetTasks.find((entry) => entry.targetTaskId === decision.targetTaskId);
  if (
    target !== undefined &&
    target.workType !== "test" &&
    (target.reworkCount ?? 0) >= DEMAND_REWORK_ESCALATION_THRESHOLD - 1
  ) {
    fail("transition", "$state/targetTasks/reworkCount");
  }
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
    escalateDemandAggregateState(decided, escalationEvent.data.escalation, escalationEvent.eventId);
  } catch (error: unknown) {
    if (error instanceof DemandAggregateStateError) {
      fail("transition", "$state/awaitingDecision", error);
    }
    throw error;
  }
  return escalationEvent;
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

/** 一种事件的已解析形状：分派之后各段拿到的就是自己那一种（open-items L5）。 */
type EventOf<Type extends DemandUncommittedEvent["eventType"]> = Extract<
  DemandUncommittedEvent,
  { readonly eventType: Type }
>;

function applyManagedEvidenceRecorded(
  state: Readonly<DemandAggregateState>,
  event: Readonly<EventOf<"evidence.managed-evidence-recorded">>,
): Readonly<DemandAggregateState> {
  try {
    return recordManagedEvidenceInDemandAggregateState(state, event.data.manifest);
  } catch (error: unknown) {
    if (error instanceof DemandAggregateStateError) {
      fail("transition", "$state/managedEvidence", error);
    }
    throw error;
  }
}

function applyTargetTaskPlanned(
  state: Readonly<DemandAggregateState>,
  event: Readonly<EventOf<"tasking.target-task-planned">>,
): Readonly<DemandAggregateState> {
  try {
    return planTargetTaskInDemandAggregateState(state, event.data.taskPackage);
  } catch (error: unknown) {
    if (error instanceof DemandAggregateStateError) {
      fail("transition", "$state/targetTasks", error);
    }
    throw error;
  }
}

function applyDeliveryPrepared(
  state: Readonly<DemandAggregateState>,
  event: Readonly<EventOf<"delivery.delivery-prepared">>,
): Readonly<DemandAggregateState> {
  try {
    return prepareDeliveryInDemandAggregateState(state, event.data.envelope);
  } catch (error: unknown) {
    if (error instanceof DemandAggregateStateError) {
      fail("transition", "$state/targetTasks", error);
    }
    throw error;
  }
}

function applyDeliveryOutcomeRecorded(
  state: Readonly<DemandAggregateState>,
  event: Readonly<EventOf<"delivery.delivery-outcome-recorded">>,
): Readonly<DemandAggregateState> {
  try {
    return recordDeliveryOutcomeInDemandAggregateState(state, event.data.outcome);
  } catch (error: unknown) {
    if (error instanceof DemandAggregateStateError) {
      fail("transition", "$state/targetTasks", error);
    }
    throw error;
  }
}

function applyDeliveryRearmed(
  state: Readonly<DemandAggregateState>,
  event: Readonly<EventOf<"delivery.delivery-rearmed">>,
): Readonly<DemandAggregateState> {
  try {
    return rearmDeliveryInDemandAggregateState(state, event.data.rearm);
  } catch (error: unknown) {
    if (error instanceof DemandAggregateStateError) {
      fail("transition", "$state/targetTasks", error);
    }
    throw error;
  }
}

function applyTargetResultRecorded(
  state: Readonly<DemandAggregateState>,
  event: Readonly<EventOf<"result.target-result-recorded">>,
): Readonly<DemandAggregateState> {
  try {
    return recordTargetResultInDemandAggregateState(state, event.data.result, event.data.callback);
  } catch (error: unknown) {
    if (error instanceof DemandAggregateStateError) {
      fail("transition", "$state/targetTasks", error);
    }
    throw error;
  }
}

function applyCallbackReissued(
  state: Readonly<DemandAggregateState>,
  event: Readonly<EventOf<"result.callback-reissued">>,
): Readonly<DemandAggregateState> {
  try {
    return reissueCallbackInDemandAggregateState(state, event.data.reissue);
  } catch (error: unknown) {
    if (error instanceof DemandAggregateStateError) {
      fail("transition", "$state/targetTasks", error);
    }
    throw error;
  }
}

function applyTargetResultDecided(
  state: Readonly<DemandAggregateState>,
  event: Readonly<EventOf<"review.target-result-decided">>,
): Readonly<DemandAggregateState> {
  try {
    return decideTargetResultReviewInDemandAggregateState(state, event.data.decision);
  } catch (error: unknown) {
    if (error instanceof DemandAggregateStateError) {
      fail("transition", "$state/targetTasks", error);
    }
    throw error;
  }
}

function applyProductDefectRemediationAuthorized(
  state: Readonly<DemandAggregateState>,
  event: Readonly<EventOf<"review.product-defect-remediation-authorized">>,
): Readonly<DemandAggregateState> {
  try {
    return authorizeProductDefectRemediationInDemandAggregateState(state, event.data.authorization);
  } catch (error: unknown) {
    if (error instanceof DemandAggregateStateError) {
      fail("transition", "$state/targetTasks", error);
    }
    throw error;
  }
}

function applyDemandEscalated(
  state: Readonly<DemandAggregateState>,
  event: Readonly<EventOf<"lifecycle.demand-escalated">>,
): Readonly<DemandAggregateState> {
  try {
    return escalateDemandAggregateState(state, event.data.escalation, event.eventId);
  } catch (error: unknown) {
    if (error instanceof DemandAggregateStateError) {
      fail("transition", "$state/awaitingDecision", error);
    }
    throw error;
  }
}

function applyDecisionRecorded(
  state: Readonly<DemandAggregateState>,
  event: Readonly<EventOf<"lifecycle.decision-recorded">>,
): Readonly<DemandAggregateState> {
  try {
    return recordDecisionInDemandAggregateState(state, event.data.decision.escalationEventId);
  } catch (error: unknown) {
    if (error instanceof DemandAggregateStateError) {
      fail("transition", "$state/awaitingDecision", error);
    }
    throw error;
  }
}

function applyDemandContinued(
  state: Readonly<DemandAggregateState>,
  event: Readonly<EventOf<"lifecycle.demand-continued">>,
): Readonly<DemandAggregateState> {
  try {
    return continueDemandAggregateState(
      state,
      event.data.continuation.kind,
      event.eventId,
      event.data.historicalTestTargetIds,
      event.data.continuation.supplement,
    );
  } catch (error: unknown) {
    if (error instanceof DemandAggregateStateError) {
      fail("transition", "$state/lifecycle", error);
    }
    throw error;
  }
}

function applyDemandCompleted(
  state: Readonly<DemandAggregateState>,
  event: Readonly<EventOf<"lifecycle.demand-completed">>,
): Readonly<DemandAggregateState> {
  try {
    return completeDemandAggregateState(state, event.data.completion);
  } catch (error: unknown) {
    if (error instanceof DemandAggregateStateError) {
      fail("transition", "$state/lifecycle", error);
    }
    throw error;
  }
}

/** 取消事件只带原因，状态的转移不看它。 */
function applyDemandCancelled(
  state: Readonly<DemandAggregateState>,
): Readonly<DemandAggregateState> {
  try {
    return cancelDemandAggregateState(state);
  } catch (error: unknown) {
    if (error instanceof DemandAggregateStateError) {
      fail("transition", "$state/lifecycle", error);
    }
    throw error;
  }
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
    if (error instanceof DemandEventSourcingEventError) fail("event", "$event", error);
    throw error;
  }

  if (event.eventType === "publication.demand-published") {
    if (state !== null) fail("transition", "$state");
    return createInitialDemandAggregateState(event.demandId, event.data.authorityDigest);
  }
  if (state === null) fail("transition", "$state");
  if (state.demandId !== event.demandId) fail("identity", "$/demandId");
  switch (event.eventType) {
    case "evidence.managed-evidence-recorded":
      return applyManagedEvidenceRecorded(state, event);
    case "tasking.target-task-planned":
      return applyTargetTaskPlanned(state, event);
    case "delivery.delivery-prepared":
      return applyDeliveryPrepared(state, event);
    case "delivery.delivery-outcome-recorded":
      return applyDeliveryOutcomeRecorded(state, event);
    case "delivery.delivery-rearmed":
      return applyDeliveryRearmed(state, event);
    case "result.target-result-recorded":
      return applyTargetResultRecorded(state, event);
    case "result.callback-reissued":
      return applyCallbackReissued(state, event);
    case "review.target-result-decided":
      return applyTargetResultDecided(state, event);
    case "review.product-defect-remediation-authorized":
      return applyProductDefectRemediationAuthorized(state, event);
    case "lifecycle.demand-escalated":
      return applyDemandEscalated(state, event);
    case "lifecycle.decision-recorded":
      return applyDecisionRecorded(state, event);
    case "lifecycle.demand-continued":
      return applyDemandContinued(state, event);
    case "lifecycle.demand-completed":
      return applyDemandCompleted(state, event);
    case "lifecycle.demand-cancelled":
      return applyDemandCancelled(state);
    default:
      return unhandledEvent(event);
  }
}

/** 穷尽性守卫：事件联合多出成员时这里编译不过，新事件不会落进任何兜底分支。 */
function unhandledEvent(_event: never): never {
  fail("event", "$/eventType");
}
