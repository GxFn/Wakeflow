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
import { canonicalizeJson } from "../../../foundation/data/canonical-json.js";
import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../../contracts/identity/wakeflow-durable-id.js";
import {
  parseUtcInstant,
  UtcInstantError,
  type UtcInstant,
} from "../../../foundation/time/utc-instant.js";
import {
  cancelDemandAggregateState,
  authorizeProductDefectRemediationInDemandAggregateState,
  claimTargetHostEffectInDemandAggregateState,
  completeDemandAggregateState,
  createTestCardInDemandAggregateState,
  createInitialDemandAggregateState,
  decideTargetResultReviewInDemandAggregateState,
  observeTargetHostEffectInDemandAggregateState,
  prepareTestDeliveryInDemandAggregateState,
  prepareTargetDeliveryInDemandAggregateState,
  rearmTargetHostEffectInDemandAggregateState,
  recordTargetResultInDemandAggregateState,
  resumeBlockedTargetReviewInDemandAggregateState,
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
  assertTargetDeliveryIntentMatchesTaskPackage,
  parseTargetDeliveryIntent,
  TargetDeliveryIntentError,
  type TargetDeliveryIntent,
} from "../../delivery/target-delivery-intent.js";
import {
  createTargetDeliveryReworkContext,
  TargetDeliveryReworkContextError,
} from "../../delivery/target-delivery-rework-context.js";
import {
  createTargetDeliveryProductDefectRemediationContext,
  TargetDeliveryProductDefectRemediationContextError,
} from "../../delivery/target-delivery-product-defect-remediation-context.js";
import {
  parseWindowWorkClaim,
  WindowWorkClaimError,
  type WindowWorkClaim,
} from "../../delivery/window-work-claim.js";
import {
  parseTargetDeliveryHostEffectObservation,
  targetDeliveryHostEffectObservationEventId,
  TargetDeliveryHostEffectObservationError,
  type TargetDeliveryHostEffectObservation,
} from "../../delivery/target-delivery-host-effect-observation.js";
import {
  parseTargetHostEffectRearm,
  targetHostEffectRearmEventId,
  TargetHostEffectRearmError,
  type TargetHostEffectRearm,
} from "../../delivery/target-host-effect-rearm.js";
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
import {
  controllerTargetReviewResumeEventId,
  parseControllerTargetReviewResume,
  ControllerTargetReviewResumeError,
  type ControllerTargetReviewResume,
} from "../../review/controller-target-review-resume.js";
import {
  parseControllerProductDefectRemediationAuthorization,
  productDefectRemediationAuthorizedEventId,
  ControllerProductDefectRemediationAuthorizationError,
  type ControllerProductDefectRemediationAuthorization,
} from "../../review/controller-product-defect-remediation-authorization.js";
import {
  parseDemandUncommittedEvent,
  DemandEventSourcingEventError,
  type DemandUncommittedEvent,
} from "./demand-event-sourcing-event.js";
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
  assertTestDeliveryIntentMatchesSources,
  parseTestDeliveryIntent,
  TestDeliveryIntentError,
  type TestDeliveryIntent,
} from "../../testing/test-delivery-intent.js";

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

export interface PlanTargetTaskCommand {
  readonly commandType: "tasking.plan-target-task";
  readonly commandVersion: 1;
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly taskPackage: Readonly<TaskPackage>;
}

export interface CreateTestCardCommand {
  readonly commandType: "testing.create-test-card";
  readonly commandVersion: 1;
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly authority: Readonly<DemandAuthority>;
  readonly testCard: Readonly<TestCard>;
  readonly generationSource: Readonly<TestCardGenerationSource>;
  readonly generationAuthorization?: Readonly<ControllerProductDefectRemediationAuthorization>;
}

export interface PrepareTargetDeliveryCommand {
  readonly commandType: "delivery.prepare-target-delivery";
  readonly commandVersion: 1;
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly intent: Readonly<TargetDeliveryIntent>;
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

export interface PrepareTestDeliveryCommand {
  readonly commandType: "testing.prepare-test-delivery";
  readonly commandVersion: 1;
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly intent: Readonly<TestDeliveryIntent>;
  readonly taskPackage: Readonly<TaskPackage>;
  readonly testCard: Readonly<TestCard>;
}

export interface ClaimTargetHostEffectCommand {
  readonly commandType: "delivery.claim-target-host-effect";
  readonly commandVersion: 1;
  readonly claim: Readonly<WindowWorkClaim>;
}

export interface RecordTargetHostEffectObservationCommand {
  readonly commandType: "delivery.record-target-host-effect-observation";
  readonly commandVersion: 1;
  readonly observation: Readonly<TargetDeliveryHostEffectObservation>;
}

export interface RearmTargetHostEffectCommand {
  readonly commandType: "delivery.rearm-target-host-effect";
  readonly commandVersion: 1;
  readonly rearm: Readonly<TargetHostEffectRearm>;
}

export interface RecordTargetResultCommand {
  readonly commandType: "result.record-target-result";
  readonly commandVersion: 1;
  readonly result: Readonly<TargetResult>;
}

export interface DecideTargetResultReviewCommand {
  readonly commandType: "review.decide-target-result";
  readonly commandVersion: 1;
  readonly decision: Readonly<ControllerReviewDecision>;
}

export interface ResumeTargetResultReviewCommand {
  readonly commandType: "review.resume-target-result";
  readonly commandVersion: 1;
  readonly resume: Readonly<ControllerTargetReviewResume>;
}

export interface AuthorizeProductDefectRemediationCommand {
  readonly commandType: "review.authorize-product-defect-remediation";
  readonly commandVersion: 1;
  readonly authorization: Readonly<ControllerProductDefectRemediationAuthorization>;
}

export type DemandEventSourcingCommand =
  | PublishDemandCommand
  | CancelDemandCommand
  | CompleteDemandCommand
  | CreateTestCardCommand
  | PlanTargetTaskCommand
  | PrepareTestDeliveryCommand
  | PrepareTargetDeliveryCommand
  | ClaimTargetHostEffectCommand
  | RecordTargetHostEffectObservationCommand
  | RearmTargetHostEffectCommand
  | RecordTargetResultCommand
  | DecideTargetResultReviewCommand
  | ResumeTargetResultReviewCommand
  | AuthorizeProductDefectRemediationCommand;

export type DemandEventSourcingDecisionErrorReason =
  | "input"
  | "identifier"
  | "time"
  | "digest"
  | "text"
  | "task-package"
  | "demand-authority"
  | "demand-completion"
  | "test-card"
  | "test-card-generation-source"
  | "test-delivery-intent"
  | "target-delivery-intent"
  | "target-delivery-rework-context"
  | "target-delivery-product-defect-remediation-context"
  | "window-work-claim"
  | "target-delivery-host-effect-observation"
  | "target-host-effect-rearm"
  | "target-result"
  | "controller-implementation-review-decision"
  | "controller-review-decision"
  | "controller-product-defect-remediation-authorization"
  | "controller-target-review-resume"
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
  "test-card": "Demand Event Sourcing command contains an invalid TestCard.",
  "test-card-generation-source":
    "Demand Event Sourcing command contains an invalid TestCard Generation Source.",
  "test-delivery-intent":
    "Demand Event Sourcing command contains an invalid Test Delivery Intent.",
  "target-delivery-intent":
    "Demand Event Sourcing command contains an invalid Target Delivery Intent.",
  "target-delivery-rework-context":
    "Demand Event Sourcing command contains an invalid Target Delivery rework source.",
  "target-delivery-product-defect-remediation-context":
    "Demand Event Sourcing command contains an invalid Target Delivery product-defect remediation source.",
  "window-work-claim":
    "Demand Event Sourcing command contains an invalid Window Work Claim.",
  "target-delivery-host-effect-observation":
    "Demand Event Sourcing command contains an invalid Target Delivery Host Effect observation.",
  "target-host-effect-rearm":
    "Demand Event Sourcing command contains an invalid Target Host Effect Rearm.",
  "target-result":
    "Demand Event Sourcing command contains an invalid TargetResult.",
  "controller-implementation-review-decision":
    "Demand Event Sourcing command contains an invalid Controller Target Review Decision.",
  "controller-review-decision":
    "Demand Event Sourcing command contains an invalid Controller Review Decision.",
  "controller-product-defect-remediation-authorization":
    "Demand Event Sourcing command contains an invalid Controller Product Defect Remediation Authorization.",
  "controller-target-review-resume":
    "Demand Event Sourcing command contains an invalid Controller Target Review Resume.",
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
const PLAN_TARGET_TASK_FIELDS = Object.freeze([
  "commandType",
  "commandVersion",
  "eventId",
  "taskPackage",
] as const);
const CREATE_TEST_CARD_FIELDS = Object.freeze([
  "authority",
  "commandType",
  "commandVersion",
  "eventId",
  "generationSource",
  "testCard",
] as const);
const CREATE_RETEST_CARD_FIELDS = Object.freeze([
  "authority",
  "commandType",
  "commandVersion",
  "eventId",
  "generationAuthorization",
  "generationSource",
  "testCard",
] as const);
const PREPARE_TARGET_DELIVERY_FIELDS = Object.freeze([
  "commandType",
  "commandVersion",
  "eventId",
  "intent",
  "taskPackage",
] as const);
const PREPARE_TEST_DELIVERY_FIELDS = Object.freeze([
  "commandType",
  "commandVersion",
  "eventId",
  "intent",
  "taskPackage",
  "testCard",
] as const);
const PREPARE_TARGET_DELIVERY_REWORK_FIELDS = Object.freeze([
  "commandType",
  "commandVersion",
  "eventId",
  "intent",
  "reworkSource",
  "taskPackage",
] as const);
const PREPARE_TARGET_DELIVERY_PRODUCT_DEFECT_REMEDIATION_FIELDS = Object.freeze(
  [
    "commandType",
    "commandVersion",
    "eventId",
    "intent",
    "productDefectRemediationSource",
    "taskPackage",
  ] as const,
);
const CLAIM_TARGET_HOST_EFFECT_FIELDS = Object.freeze([
  "claim",
  "commandType",
  "commandVersion",
] as const);
const RECORD_TARGET_HOST_EFFECT_OBSERVATION_FIELDS = Object.freeze([
  "commandType",
  "commandVersion",
  "observation",
] as const);
const REARM_TARGET_HOST_EFFECT_FIELDS = Object.freeze([
  "commandType",
  "commandVersion",
  "rearm",
] as const);
const RECORD_TARGET_RESULT_FIELDS = Object.freeze([
  "commandType",
  "commandVersion",
  "result",
] as const);
const DECIDE_TARGET_RESULT_REVIEW_FIELDS = Object.freeze([
  "commandType",
  "commandVersion",
  "decision",
] as const);
const RESUME_TARGET_RESULT_REVIEW_FIELDS = Object.freeze([
  "commandType",
  "commandVersion",
  "resume",
] as const);
const AUTHORIZE_PRODUCT_DEFECT_REMEDIATION_FIELDS = Object.freeze([
  "authorization",
  "commandType",
  "commandVersion",
] as const);
const CONTROL_EXCEPT_LF_PATTERN =
  /\r|[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;

function fail(
  reason: DemandEventSourcingDecisionErrorReason,
  path: string,
): never {
  throw new DemandEventSourcingDecisionError(reason, path);
}

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
    value.length > 8192 ||
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
      (authority.testingDecision.mode !== "controller-only" &&
        authority.testingDecision.mode !== "real-environment") ||
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

  if (base.commandType === "testing.create-test-card") {
    let generationSource: Readonly<TestCardGenerationSource>;
    try {
      generationSource = parseTestCardGenerationSource(base.generationSource);
    } catch (error: unknown) {
      if (error instanceof TestCardGenerationSourceError) {
        fail("test-card-generation-source", "$/generationSource");
      }
      throw error;
    }
    const requiresGenerationAuthorization =
      generationSource.kind === "product-defect-retest";
    const command = exactCommand(
      base,
      requiresGenerationAuthorization
        ? CREATE_RETEST_CARD_FIELDS
        : CREATE_TEST_CARD_FIELDS,
    );
    let authority: Readonly<DemandAuthority>;
    let testCard: Readonly<TestCard>;
    let generationAuthorization:
      Readonly<ControllerProductDefectRemediationAuthorization> | undefined;
    try {
      authority = parseDemandAuthority(command.authority);
    } catch (error: unknown) {
      if (error instanceof DemandAuthorityError) {
        fail("demand-authority", "$/authority");
      }
      throw error;
    }
    try {
      testCard = parseTestCard(command.testCard);
    } catch (error: unknown) {
      if (error instanceof TestCardError) fail("test-card", "$/testCard");
      throw error;
    }
    if (requiresGenerationAuthorization) {
      try {
        generationAuthorization =
          parseControllerProductDefectRemediationAuthorization(
            command.generationAuthorization,
          );
      } catch (error: unknown) {
        if (
          error instanceof ControllerProductDefectRemediationAuthorizationError
        ) {
          fail(
            "controller-product-defect-remediation-authorization",
            "$/generationAuthorization",
          );
        }
        throw error;
      }
      if (
        generationSource.kind !== "product-defect-retest" ||
        generationAuthorization.productDefectRemediationId !==
          generationSource.productDefectRemediation
            .productDefectRemediationId ||
        generationAuthorization.authorizationDigest !==
          generationSource.productDefectRemediation.authorizationDigest ||
        generationAuthorization.source.testCard.testCardId !==
          generationSource.previousTestCard.testCardId ||
        generationAuthorization.source.testCard.testCardDigest !==
          generationSource.previousTestCard.testCardDigest ||
        generationAuthorization.source.testReviewDecision
          .targetReviewDecisionId !==
          generationSource.testReviewDecision.targetReviewDecisionId ||
        generationAuthorization.source.testReviewDecision.decisionDigest !==
          generationSource.testReviewDecision.decisionDigest
      ) {
        fail("test-card-generation-source", "$/generationSource");
      }
    }
    if (
      authority.demandId !== testCard.demandId ||
      authority.testingDecision.mode !== "real-environment" ||
      computeDemandAuthorityDigest(authority) !==
        testCard.demandAuthorityDigest ||
      authority.testingDecision.environmentMemberRef !==
        testCard.environmentAuthority.memberRef ||
      !authority.authorityRefs.some(
        (reference) =>
          canonicalizeJson(reference, "$authorityReference") ===
          canonicalizeJson(
            testCard.environmentAuthority,
            "$environmentAuthority",
          ),
      ) ||
      !testCard.testBasisAuthorities.every((basisAuthority) =>
        authority.authorityRefs.some(
          (reference) =>
            canonicalizeJson(reference, "$authorityReference") ===
            canonicalizeJson(basisAuthority, "$testBasisAuthority"),
        ),
      )
    ) {
      fail("test-card", "$/testCard");
    }
    return Object.freeze({
      commandType: "testing.create-test-card",
      commandVersion: 1,
      eventId: parseId(command.eventId, "demand-event", "$/eventId"),
      authority,
      testCard,
      generationSource,
      ...(generationAuthorization === undefined
        ? {}
        : { generationAuthorization }),
    });
  }

  if (base.commandType === "delivery.prepare-target-delivery") {
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
      hasReworkSource
        ? PREPARE_TARGET_DELIVERY_REWORK_FIELDS
        : hasProductDefectRemediationSource
          ? PREPARE_TARGET_DELIVERY_PRODUCT_DEFECT_REMEDIATION_FIELDS
          : PREPARE_TARGET_DELIVERY_FIELDS,
    );
    let intent: Readonly<TargetDeliveryIntent>;
    let taskPackage: Readonly<TaskPackage>;
    try {
      intent = parseTargetDeliveryIntent(command.intent);
    } catch (error: unknown) {
      if (error instanceof TargetDeliveryIntentError) {
        fail("target-delivery-intent", "$/intent");
      }
      throw error;
    }
    try {
      taskPackage = parseTaskPackage(command.taskPackage);
      assertTargetDeliveryIntentMatchesTaskPackage(intent, taskPackage);
    } catch (error: unknown) {
      if (error instanceof TaskPackageError) {
        fail("task-package", "$/taskPackage");
      }
      if (error instanceof TargetDeliveryIntentError) {
        fail("target-delivery-intent", "$/intent");
      }
      throw error;
    }
    let reworkSource: PrepareTargetDeliveryCommand["reworkSource"];
    let productDefectRemediationSource: PrepareTargetDeliveryCommand["productDefectRemediationSource"];
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
          intent.rework === undefined ||
          computeCanonicalJsonSha256Digest(projected) !==
            computeCanonicalJsonSha256Digest(intent.rework)
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
    } else if (intent.rework !== undefined) {
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
          intent.productDefectRemediation === undefined ||
          computeCanonicalJsonSha256Digest(projected) !==
            computeCanonicalJsonSha256Digest(intent.productDefectRemediation)
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
    } else if (intent.productDefectRemediation !== undefined) {
      fail(
        "target-delivery-product-defect-remediation-context",
        "$/productDefectRemediationSource",
      );
    }
    return Object.freeze({
      commandType: "delivery.prepare-target-delivery",
      commandVersion: 1,
      eventId: parseId(command.eventId, "demand-event", "$/eventId"),
      intent,
      taskPackage,
      ...(reworkSource === undefined ? {} : { reworkSource }),
      ...(productDefectRemediationSource === undefined
        ? {}
        : { productDefectRemediationSource }),
    });
  }

  if (base.commandType === "testing.prepare-test-delivery") {
    const command = exactCommand(base, PREPARE_TEST_DELIVERY_FIELDS);
    let intent: Readonly<TestDeliveryIntent>;
    let taskPackage: Readonly<TaskPackage>;
    let testCard: Readonly<TestCard>;
    try {
      intent = parseTestDeliveryIntent(command.intent);
    } catch (error: unknown) {
      if (error instanceof TestDeliveryIntentError) {
        fail("test-delivery-intent", "$/intent");
      }
      throw error;
    }
    try {
      taskPackage = parseTaskPackage(command.taskPackage);
    } catch (error: unknown) {
      if (error instanceof TaskPackageError) {
        fail("task-package", "$/taskPackage");
      }
      throw error;
    }
    try {
      testCard = parseTestCard(command.testCard);
      assertTestDeliveryIntentMatchesSources(intent, taskPackage, testCard);
    } catch (error: unknown) {
      if (error instanceof TestCardError) fail("test-card", "$/testCard");
      if (error instanceof TestDeliveryIntentError) {
        fail("test-delivery-intent", "$/intent");
      }
      throw error;
    }
    return Object.freeze({
      commandType: "testing.prepare-test-delivery",
      commandVersion: 1,
      eventId: parseId(command.eventId, "demand-event", "$/eventId"),
      intent,
      taskPackage,
      testCard,
    });
  }

  if (base.commandType === "delivery.claim-target-host-effect") {
    const command = exactCommand(base, CLAIM_TARGET_HOST_EFFECT_FIELDS);
    let claim: Readonly<WindowWorkClaim>;
    try {
      claim = parseWindowWorkClaim(command.claim);
    } catch (error: unknown) {
      if (error instanceof WindowWorkClaimError) {
        fail("window-work-claim", "$/claim");
      }
      throw error;
    }
    return Object.freeze({
      commandType: "delivery.claim-target-host-effect",
      commandVersion: 1,
      claim,
    });
  }

  if (base.commandType === "delivery.record-target-host-effect-observation") {
    const command = exactCommand(
      base,
      RECORD_TARGET_HOST_EFFECT_OBSERVATION_FIELDS,
    );
    let observation: Readonly<TargetDeliveryHostEffectObservation>;
    try {
      observation = parseTargetDeliveryHostEffectObservation(
        command.observation,
      );
    } catch (error: unknown) {
      if (error instanceof TargetDeliveryHostEffectObservationError) {
        fail("target-delivery-host-effect-observation", "$/observation");
      }
      throw error;
    }
    return Object.freeze({
      commandType: "delivery.record-target-host-effect-observation",
      commandVersion: 1,
      observation,
    });
  }

  if (base.commandType === "delivery.rearm-target-host-effect") {
    const command = exactCommand(base, REARM_TARGET_HOST_EFFECT_FIELDS);
    let rearm: Readonly<TargetHostEffectRearm>;
    try {
      rearm = parseTargetHostEffectRearm(command.rearm);
    } catch (error: unknown) {
      if (error instanceof TargetHostEffectRearmError) {
        fail("target-host-effect-rearm", "$/rearm");
      }
      throw error;
    }
    return Object.freeze({
      commandType: "delivery.rearm-target-host-effect",
      commandVersion: 1,
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
    return Object.freeze({
      commandType: "result.record-target-result",
      commandVersion: 1,
      result,
    });
  }

  if (base.commandType === "review.decide-target-result") {
    const command = exactCommand(base, DECIDE_TARGET_RESULT_REVIEW_FIELDS);
    let decision: Readonly<ControllerReviewDecision>;
    try {
      decision = parseControllerReviewDecision(command.decision);
    } catch (error: unknown) {
      if (error instanceof ControllerReviewDecisionError) {
        fail("controller-review-decision", "$/decision");
      }
      throw error;
    }
    return Object.freeze({
      commandType: "review.decide-target-result",
      commandVersion: 1,
      decision,
    });
  }

  if (base.commandType === "review.authorize-product-defect-remediation") {
    const command = exactCommand(
      base,
      AUTHORIZE_PRODUCT_DEFECT_REMEDIATION_FIELDS,
    );
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
    return Object.freeze({
      commandType: "review.authorize-product-defect-remediation",
      commandVersion: 1,
      authorization,
    });
  }

  if (base.commandType === "review.resume-target-result") {
    const command = exactCommand(base, RESUME_TARGET_RESULT_REVIEW_FIELDS);
    let resume: Readonly<ControllerTargetReviewResume>;
    try {
      resume = parseControllerTargetReviewResume(command.resume);
    } catch (error: unknown) {
      if (error instanceof ControllerTargetReviewResumeError) {
        fail("controller-target-review-resume", "$/resume");
      }
      throw error;
    }
    return Object.freeze({
      commandType: "review.resume-target-result",
      commandVersion: 1,
      resume,
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

function singleEvent(
  event: Readonly<DemandUncommittedEvent>,
): readonly [Readonly<DemandUncommittedEvent>] {
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
): readonly [Readonly<DemandUncommittedEvent>] {
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
  if (command.commandType === "testing.create-test-card") {
    if (state.demandId !== command.testCard.demandId) {
      fail("identity", "$/testCard/demandId");
    }
    try {
      createTestCardInDemandAggregateState(
        state,
        command.testCard,
        command.generationSource,
      );
    } catch (error: unknown) {
      if (error instanceof DemandAggregateStateError) {
        fail("transition", "$state");
      }
      throw error;
    }
    return singleEvent(
      parseDemandUncommittedEvent({
        eventId: command.eventId,
        demandId: command.testCard.demandId,
        recordedAt: command.testCard.createdAt,
        eventType: "testing.test-card-created",
        data: {
          testCard: command.testCard,
          generationSource: command.generationSource,
        },
      }),
    );
  }
  if (command.commandType === "review.authorize-product-defect-remediation") {
    try {
      authorizeProductDefectRemediationInDemandAggregateState(
        state,
        command.authorization,
      );
    } catch (error: unknown) {
      if (error instanceof DemandAggregateStateError) {
        fail("transition", "$state/targetTasks");
      }
      throw error;
    }
    return singleEvent(
      parseDemandUncommittedEvent({
        eventId: productDefectRemediationAuthorizedEventId(
          command.authorization,
        ),
        demandId: command.authorization.demandId,
        recordedAt: command.authorization.authorizedAt,
        eventType: "review.product-defect-remediation-authorized",
        data: { authorization: command.authorization },
      }),
    );
  }
  if (command.commandType === "review.resume-target-result") {
    try {
      resumeBlockedTargetReviewInDemandAggregateState(state, command.resume);
    } catch (error: unknown) {
      if (error instanceof DemandAggregateStateError) {
        fail("transition", "$state/targetTasks");
      }
      throw error;
    }
    return singleEvent(
      parseDemandUncommittedEvent({
        eventId: controllerTargetReviewResumeEventId(command.resume),
        demandId: command.resume.demandId,
        recordedAt: command.resume.resumedAt,
        eventType: "review.target-result-resumed",
        data: { resume: command.resume },
      }),
    );
  }
  if (command.commandType === "review.decide-target-result") {
    try {
      decideTargetResultReviewInDemandAggregateState(state, command.decision);
    } catch (error: unknown) {
      if (error instanceof DemandAggregateStateError) {
        fail("transition", "$state/targetTasks");
      }
      throw error;
    }
    return singleEvent(
      parseDemandUncommittedEvent({
        eventId: controllerReviewDecisionEventId(command.decision),
        demandId: command.decision.demandId,
        recordedAt: command.decision.decidedAt,
        eventType: "review.target-result-decided",
        data: { decision: command.decision },
      }),
    );
  }
  if (command.commandType === "result.record-target-result") {
    try {
      recordTargetResultInDemandAggregateState(state, command.result);
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
        data: { result: command.result },
      }),
    );
  }
  if (command.commandType === "delivery.rearm-target-host-effect") {
    try {
      rearmTargetHostEffectInDemandAggregateState(state, command.rearm);
    } catch (error: unknown) {
      if (error instanceof DemandAggregateStateError) {
        fail("transition", "$state/targetTasks");
      }
      throw error;
    }
    return singleEvent(
      parseDemandUncommittedEvent({
        eventId: targetHostEffectRearmEventId(command.rearm),
        demandId: command.rearm.target.demandId,
        recordedAt: command.rearm.rearmedAt,
        eventType: "delivery.target-host-effect-rearmed",
        data: { rearm: command.rearm },
      }),
    );
  }
  if (
    command.commandType === "delivery.record-target-host-effect-observation"
  ) {
    try {
      observeTargetHostEffectInDemandAggregateState(state, command.observation);
    } catch (error: unknown) {
      if (error instanceof DemandAggregateStateError) {
        fail("transition", "$state/targetTasks");
      }
      throw error;
    }
    return singleEvent(
      parseDemandUncommittedEvent({
        eventId: targetDeliveryHostEffectObservationEventId(
          command.observation.action.actionId,
        ),
        demandId: state.demandId,
        recordedAt: command.observation.observedAt,
        eventType: "delivery.target-host-effect-observed",
        data: { observation: command.observation },
      }),
    );
  }
  if (command.commandType === "delivery.claim-target-host-effect") {
    try {
      claimTargetHostEffectInDemandAggregateState(state, command.claim);
    } catch (error: unknown) {
      if (error instanceof DemandAggregateStateError) {
        fail("transition", "$state/targetTasks");
      }
      throw error;
    }
    return singleEvent(
      parseDemandUncommittedEvent({
        eventId: command.claim.claimTransition.eventId,
        demandId: command.claim.target.demandId,
        recordedAt: command.claim.claimedAt,
        eventType: "delivery.target-host-effect-claimed",
        data: { claim: command.claim },
      }),
    );
  }
  if (command.commandType === "delivery.prepare-target-delivery") {
    if (state.demandId !== command.intent.demandId) {
      fail("identity", "$/intent/demandId");
    }
    try {
      prepareTargetDeliveryInDemandAggregateState(state, command.intent);
    } catch (error: unknown) {
      if (error instanceof DemandAggregateStateError) {
        fail("transition", "$state/targetTasks");
      }
      throw error;
    }
    return singleEvent(
      parseDemandUncommittedEvent({
        eventId: command.eventId,
        demandId: command.intent.demandId,
        recordedAt: command.intent.preparedAt,
        eventType: "delivery.target-delivery-prepared",
        data: { intent: command.intent },
      }),
    );
  }
  if (command.commandType === "testing.prepare-test-delivery") {
    if (state.demandId !== command.intent.demandId) {
      fail("identity", "$/intent/demandId");
    }
    try {
      prepareTestDeliveryInDemandAggregateState(state, command.intent);
    } catch (error: unknown) {
      if (error instanceof DemandAggregateStateError) {
        fail("transition", "$state/targetTasks");
      }
      throw error;
    }
    return singleEvent(
      parseDemandUncommittedEvent({
        eventId: command.eventId,
        demandId: command.intent.demandId,
        recordedAt: command.intent.preparedAt,
        eventType: "testing.test-delivery-prepared",
        data: { intent: command.intent },
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
  if (event.eventType === "delivery.target-delivery-prepared") {
    try {
      return prepareTargetDeliveryInDemandAggregateState(
        state,
        event.data.intent,
      );
    } catch (error: unknown) {
      if (error instanceof DemandAggregateStateError) {
        fail("transition", "$state/targetTasks");
      }
      throw error;
    }
  }
  if (event.eventType === "testing.test-delivery-prepared") {
    try {
      return prepareTestDeliveryInDemandAggregateState(
        state,
        event.data.intent,
      );
    } catch (error: unknown) {
      if (error instanceof DemandAggregateStateError) {
        fail("transition", "$state/targetTasks");
      }
      throw error;
    }
  }
  if (event.eventType === "delivery.target-host-effect-claimed") {
    try {
      return claimTargetHostEffectInDemandAggregateState(
        state,
        event.data.claim,
      );
    } catch (error: unknown) {
      if (error instanceof DemandAggregateStateError) {
        fail("transition", "$state/targetTasks");
      }
      throw error;
    }
  }
  if (event.eventType === "delivery.target-host-effect-observed") {
    try {
      return observeTargetHostEffectInDemandAggregateState(
        state,
        event.data.observation,
      );
    } catch (error: unknown) {
      if (error instanceof DemandAggregateStateError) {
        fail("transition", "$state/targetTasks");
      }
      throw error;
    }
  }
  if (event.eventType === "delivery.target-host-effect-rearmed") {
    try {
      return rearmTargetHostEffectInDemandAggregateState(
        state,
        event.data.rearm,
      );
    } catch (error: unknown) {
      if (error instanceof DemandAggregateStateError) {
        fail("transition", "$state/targetTasks");
      }
      throw error;
    }
  }
  if (event.eventType === "result.target-result-recorded") {
    try {
      return recordTargetResultInDemandAggregateState(state, event.data.result);
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
  if (event.eventType === "review.target-result-resumed") {
    try {
      return resumeBlockedTargetReviewInDemandAggregateState(
        state,
        event.data.resume,
      );
    } catch (error: unknown) {
      if (error instanceof DemandAggregateStateError) {
        fail("transition", "$state/targetTasks");
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
  if (event.eventType === "testing.test-card-created") {
    try {
      return createTestCardInDemandAggregateState(
        state,
        event.data.testCard,
        event.data.generationSource,
      );
    } catch (error: unknown) {
      if (error instanceof DemandAggregateStateError) {
        fail("transition", "$state");
      }
      throw error;
    }
  }
  try {
    return cancelDemandAggregateState(state);
  } catch (error: unknown) {
    if (error instanceof DemandAggregateStateError) {
      fail("transition", "$state/lifecycle");
    }
    throw error;
  }
}
