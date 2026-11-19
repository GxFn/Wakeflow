import { createWakeflowDurableId, parseWakeflowDurableIdOfKind, WakeflowDurableIdError, } from "../../../contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../../foundation/crypto/canonical-json-sha256.js";
import { parseSha256Digest, Sha256Error } from "../../../foundation/crypto/sha256.js";
import { PassiveOwnDataError, parsePlainRecord, } from "../../../foundation/data/passive-own-data.js";
import { deriveUuidV4, parseUuidV4 } from "../../../foundation/identity/uuid-v4.js";
import { parseUtcInstant, UtcInstantError, } from "../../../foundation/time/utc-instant.js";
import { assertDeliveryEnvelopeMatchesTaskPackage, DeliveryEnvelopeError, parseDeliveryEnvelope, } from "../../delivery/delivery-envelope.js";
import { DeliveryOutcomeError, parseDeliveryOutcome, } from "../../delivery/delivery-outcome.js";
import { DeliveryRearmError, parseDeliveryRearm, } from "../../delivery/delivery-rearm.js";
import { createTargetDeliveryProductDefectRemediationContext, TargetDeliveryProductDefectRemediationContextError, } from "../../delivery/target-delivery-product-defect-remediation-context.js";
import { createTargetDeliveryReworkContext, TargetDeliveryReworkContextError, } from "../../delivery/target-delivery-rework-context.js";
import { ManagedEvidenceManifestError, parseManagedEvidenceManifest, } from "../../evidence/managed-evidence-manifest.js";
import { DemandCompletionError, parseDemandCompletion, } from "../../lifecycle/demand-completion.js";
import { parseTargetResult, TargetResultError, targetResultRecordedEventIdFromResult, } from "../../result/target-result.js";
import { parseTargetResultCallbackRecord, parseTargetResultCallbackReissue, parseTargetResultEvidenceResolutions, TargetResultCallbackError, } from "../../result/target-result-callback.js";
import { parseTargetSessionPromptObservation, TargetSessionPromptObservationError, } from "../../result/target-session-prompts.js";
import { ControllerImplementationReviewDecisionError, parseControllerImplementationReviewDecision, } from "../../review/controller-implementation-review-decision.js";
import { ControllerProductDefectRemediationAuthorizationError, parseControllerProductDefectRemediationAuthorization, productDefectRemediationAuthorizedEventId, } from "../../review/controller-product-defect-remediation-authorization.js";
import { ControllerReviewDecisionError, controllerReviewDecisionEventId, parseControllerReviewDecision, } from "../../review/controller-review-decision.js";
import { parseTaskPackage, TaskPackageError, } from "../../tasking/task-package.js";
import { assertTestExecutionAttemptMatchesPackage, TestExecutionAttemptError, } from "../../testing/test-execution-attempt.js";
import { authorizeProductDefectRemediationInDemandAggregateState, cancelDemandAggregateState, completeDemandAggregateState, continueDemandAggregateState, createInitialDemandAggregateState, DemandAggregateStateError, decideTargetResultReviewInDemandAggregateState, escalateDemandAggregateState, historicalTestTargetIdsAtContinuation, parseDemandAggregateState, planTargetTaskInDemandAggregateState, prepareDeliveryInDemandAggregateState, rearmDeliveryInDemandAggregateState, recordDecisionInDemandAggregateState, recordDeliveryOutcomeInDemandAggregateState, recordManagedEvidenceInDemandAggregateState, recordTargetResultInDemandAggregateState, reissueCallbackInDemandAggregateState, } from "../model/demand-aggregate-state.js";
import { computeDemandAuthorityDigest, DemandAuthorityError, parseDemandAuthority, } from "../model/demand-authority.js";
import { DemandEventSourcingEventError, parseDemandUncommittedEvent, } from "./demand-event-sourcing-event.js";
const ERROR_MESSAGES = {
    input: "Demand Event Sourcing command input is invalid.",
    identifier: "Demand Event Sourcing command contains an invalid identity.",
    time: "Demand Event Sourcing command contains an invalid recorded time.",
    digest: "Demand Event Sourcing command contains an invalid digest.",
    text: "Demand Event Sourcing command contains non-canonical text.",
    "task-package": "Demand Event Sourcing command contains an invalid TaskPackage.",
    "demand-authority": "Demand Event Sourcing command contains an invalid Demand Authority.",
    "demand-completion": "Demand Event Sourcing command contains an invalid Demand Completion.",
    "lifecycle-data": "Demand Event Sourcing command carries invalid lifecycle data.",
    "managed-evidence-manifest": "Demand Event Sourcing command contains an invalid Managed Evidence Manifest.",
    "delivery-envelope": "Demand Event Sourcing command contains an invalid Delivery Envelope.",
    "target-delivery-rework-context": "Demand Event Sourcing command contains an invalid Target Delivery rework source.",
    "target-delivery-product-defect-remediation-context": "Demand Event Sourcing command contains an invalid Target Delivery product-defect remediation source.",
    "delivery-outcome": "Demand Event Sourcing command contains an invalid Delivery Outcome.",
    "delivery-rearm": "Demand Event Sourcing command contains an invalid Delivery Rearm.",
    "target-result": "Demand Event Sourcing command contains an invalid TargetResult.",
    "controller-implementation-review-decision": "Demand Event Sourcing command contains an invalid Controller Target Review Decision.",
    "controller-review-decision": "Demand Event Sourcing command contains an invalid Controller Review Decision.",
    "controller-product-defect-remediation-authorization": "Demand Event Sourcing command contains an invalid Controller Product Defect Remediation Authorization.",
    "target-result-callback": "Demand Event Sourcing command contains an invalid Target Result callback record.",
    state: "Demand Event Sourcing Decider received an invalid aggregate state.",
    identity: "Demand Event Sourcing command does not belong to the aggregate.",
    transition: "Demand Event Sourcing command or event is not admitted from the current state.",
    event: "Demand Event Sourcing Decider received an invalid event.",
};
export class DemandEventSourcingDecisionError extends Error {
    name = "DemandEventSourcingDecisionError";
    code = "wakeflow-demand-event-sourcing-decision";
    reason;
    path;
    constructor(reason, path, options) {
        super(ERROR_MESSAGES[reason], options);
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
]);
const CANCEL_FIELDS = Object.freeze([
    "commandType",
    "commandVersion",
    "demandId",
    "eventId",
    "reason",
    "recordedAt",
]);
const COMPLETE_DEMAND_FIELDS = Object.freeze([
    "authority",
    "commandType",
    "commandVersion",
    "completion",
    "eventId",
]);
const ESCALATE_DEMAND_FIELDS = Object.freeze([
    "commandType",
    "commandVersion",
    "demandId",
    "escalation",
    "eventId",
    "recordedAt",
]);
const RECORD_DECISION_FIELDS = Object.freeze([
    "commandType",
    "commandVersion",
    "decision",
    "demandId",
    "eventId",
    "recordedAt",
]);
const CONTINUE_DEMAND_FIELDS = Object.freeze([
    "commandType",
    "commandVersion",
    "continuation",
    "demandId",
    "eventId",
    "recordedAt",
]);
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
]);
const RECORD_MANAGED_EVIDENCE_FIELDS = Object.freeze([
    "commandType",
    "commandVersion",
    "eventId",
    "manifest",
]);
const PREPARE_DELIVERY_BASE_FIELDS = Object.freeze([
    "commandType",
    "commandVersion",
    "envelope",
    "eventId",
    "taskPackage",
]);
const RECORD_DELIVERY_OUTCOME_FIELDS = Object.freeze([
    "commandType",
    "commandVersion",
    "eventId",
    "outcome",
]);
const REARM_DELIVERY_FIELDS = Object.freeze([
    "commandType",
    "commandVersion",
    "eventId",
    "rearm",
]);
const RECORD_TARGET_RESULT_FIELDS = Object.freeze([
    "callback",
    "commandType",
    "commandVersion",
    "evidenceResolution",
    "result",
]);
const RECORD_OBSERVED_TARGET_RESULT_FIELDS = Object.freeze([
    "callback",
    "commandType",
    "commandVersion",
    "evidenceResolution",
    "result",
    "sessionPrompts",
]);
const REISSUE_CALLBACK_FIELDS = Object.freeze([
    "commandType",
    "commandVersion",
    "eventId",
    "reissue",
]);
const DECIDE_TARGET_RESULT_REVIEW_FIELDS = Object.freeze([
    "commandType",
    "commandVersion",
    "decision",
]);
const DECIDE_TARGET_RESULT_REVIEW_WITH_AUTHORIZATION_FIELDS = Object.freeze([
    "authorization",
    "commandType",
    "commandVersion",
    "decision",
]);
// biome-ignore lint/suspicious/noControlCharactersInRegex: the pattern exists to reject control characters in record text
const CONTROL_EXCEPT_LF_PATTERN = /\r|[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;
function fail(reason, path, cause) {
    throw new DemandEventSourcingDecisionError(reason, path, cause === undefined ? undefined : { cause });
}
/** 生命周期命令的数据借事件解析器按 Schema 准入，不另写一份编解码。 */
function lifecycleEvent(eventType, data) {
    try {
        return parseDemandUncommittedEvent({
            eventId: PROBE_EVENT_ID,
            demandId: PROBE_DEMAND_ID,
            recordedAt: PROBE_RECORDED_AT,
            eventType,
            data,
        });
    }
    catch (error) {
        if (error instanceof DemandEventSourcingEventError) {
            fail("lifecycle-data", "$/data", error);
        }
        throw error;
    }
}
function escalationData(value) {
    const event = lifecycleEvent("lifecycle.demand-escalated", {
        escalation: value,
    });
    if (event.eventType !== "lifecycle.demand-escalated") {
        fail("lifecycle-data", "$/escalation");
    }
    return event.data.escalation;
}
function decisionData(value) {
    const event = lifecycleEvent("lifecycle.decision-recorded", {
        decision: value,
    });
    if (event.eventType !== "lifecycle.decision-recorded") {
        fail("lifecycle-data", "$/decision");
    }
    return event.data.decision;
}
function continuationData(value) {
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
function exactCommand(record, fields) {
    const keys = Object.keys(record).sort();
    if (keys.length !== fields.length || keys.some((key, index) => key !== fields[index])) {
        fail("input", "$command");
    }
    return record;
}
function parseId(value, kind, path) {
    try {
        return parseWakeflowDurableIdOfKind(value, kind, path);
    }
    catch (error) {
        if (error instanceof WakeflowDurableIdError)
            fail("identifier", path, error);
        throw error;
    }
}
function parseTime(value) {
    try {
        return parseUtcInstant(value, "$/recordedAt");
    }
    catch (error) {
        if (error instanceof UtcInstantError)
            fail("time", "$/recordedAt", error);
        throw error;
    }
}
function parseDigest(value, path) {
    try {
        return parseSha256Digest(value, path);
    }
    catch (error) {
        if (error instanceof Sha256Error)
            fail("digest", path, error);
        throw error;
    }
}
function parseReason(value) {
    if (typeof value !== "string" ||
        value.length === 0 ||
        Array.from(value).length > 8192 ||
        !value.isWellFormed() ||
        value.normalize("NFC") !== value ||
        value.trim() !== value ||
        CONTROL_EXCEPT_LF_PATTERN.test(value)) {
        fail("text", "$/reason");
    }
    return value;
}
function parsePublishDemandCommand(base) {
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
function parseCancelDemandCommand(base) {
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
function parseCompleteDemandCommand(base) {
    const command = exactCommand(base, COMPLETE_DEMAND_FIELDS);
    let authority;
    let completion;
    try {
        authority = parseDemandAuthority(command.authority);
    }
    catch (error) {
        if (error instanceof DemandAuthorityError) {
            fail("demand-authority", "$/authority", error);
        }
        throw error;
    }
    try {
        completion = parseDemandCompletion(command.completion);
    }
    catch (error) {
        if (error instanceof DemandCompletionError) {
            fail("demand-completion", "$/completion", error);
        }
        throw error;
    }
    if (authority.demandId !== completion.demandId ||
        completion.testingMode !== authority.testingDecision.mode ||
        computeDemandAuthorityDigest(authority) !== completion.authorityDigest) {
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
function parseEscalateDemandCommand(base) {
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
function parseRecordDecisionCommand(base) {
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
function parseContinueDemandCommand(base) {
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
function parsePlanTargetTaskCommand(base) {
    const command = exactCommand(base, PLAN_TARGET_TASK_FIELDS);
    let taskPackage;
    try {
        taskPackage = parseTaskPackage(command.taskPackage);
    }
    catch (error) {
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
function parseRecordManagedEvidenceCommand(base) {
    const command = exactCommand(base, RECORD_MANAGED_EVIDENCE_FIELDS);
    let manifest;
    try {
        manifest = parseManagedEvidenceManifest(command.manifest);
    }
    catch (error) {
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
function parsePreparedEnvelopeAndPackage(command) {
    let envelope;
    let taskPackage;
    try {
        envelope = parseDeliveryEnvelope(command.envelope);
    }
    catch (error) {
        if (error instanceof DeliveryEnvelopeError) {
            fail("delivery-envelope", "$/envelope", error);
        }
        throw error;
    }
    try {
        taskPackage = parseTaskPackage(command.taskPackage);
        assertDeliveryEnvelopeMatchesTaskPackage(envelope, taskPackage);
    }
    catch (error) {
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
function assertReworkContextMatchesEnvelope(decision, previousResult, envelope) {
    try {
        const projected = createTargetDeliveryReworkContext({
            decision,
            previousResult,
        });
        if (envelope.rework === undefined ||
            computeCanonicalJsonSha256Digest(projected) !==
                computeCanonicalJsonSha256Digest(envelope.rework)) {
            fail("target-delivery-rework-context", "$/reworkSource");
        }
    }
    catch (error) {
        if (error instanceof DemandEventSourcingDecisionError)
            throw error;
        if (error instanceof TargetDeliveryReworkContextError) {
            fail("target-delivery-rework-context", "$/reworkSource", error);
        }
        throw error;
    }
}
/** 返工投递的来源：评审决定与上一份结果，投影出来的返工上下文必须与信封里的那份逐字节相同。 */
function parseReworkSource(value, envelope) {
    let source;
    try {
        source = parsePlainRecord(value, "$/reworkSource");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError) {
            fail("target-delivery-rework-context", "$/reworkSource", error);
        }
        throw error;
    }
    const sourceKeys = Object.keys(source).sort();
    if (sourceKeys.length !== 2 ||
        sourceKeys[0] !== "decision" ||
        sourceKeys[1] !== "previousResult") {
        fail("target-delivery-rework-context", "$/reworkSource");
    }
    let decision;
    let previousResult;
    try {
        decision = parseControllerImplementationReviewDecision(source.decision);
    }
    catch (error) {
        if (error instanceof ControllerImplementationReviewDecisionError) {
            fail("controller-implementation-review-decision", "$/reworkSource/decision", error);
        }
        throw error;
    }
    try {
        previousResult = parseTargetResult(source.previousResult);
    }
    catch (error) {
        if (error instanceof TargetResultError) {
            fail("target-result", "$/reworkSource/previousResult", error);
        }
        throw error;
    }
    assertReworkContextMatchesEnvelope(decision, previousResult, envelope);
    return Object.freeze({ decision, previousResult });
}
/** 由授权与上一份结果投影出修复上下文，与信封里的那份比摘要。 */
function assertRemediationContextMatchesEnvelope(authorization, previousResult, envelope) {
    try {
        const projected = createTargetDeliveryProductDefectRemediationContext({
            authorization,
            previousResult,
        });
        if (envelope.productDefectRemediation === undefined ||
            computeCanonicalJsonSha256Digest(projected) !==
                computeCanonicalJsonSha256Digest(envelope.productDefectRemediation)) {
            fail("target-delivery-product-defect-remediation-context", "$/productDefectRemediationSource");
        }
    }
    catch (error) {
        if (error instanceof DemandEventSourcingDecisionError)
            throw error;
        if (error instanceof TargetDeliveryProductDefectRemediationContextError) {
            fail("target-delivery-product-defect-remediation-context", "$/productDefectRemediationSource", error);
        }
        throw error;
    }
}
/** 产品缺陷修复投递的来源：授权与上一份结果，投影出来的修复上下文必须与信封里的那份逐字节相同。 */
function parseProductDefectRemediationSource(value, envelope) {
    let source;
    try {
        source = parsePlainRecord(value, "$/productDefectRemediationSource");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError) {
            fail("target-delivery-product-defect-remediation-context", "$/productDefectRemediationSource", error);
        }
        throw error;
    }
    const sourceKeys = Object.keys(source).sort();
    if (sourceKeys.length !== 2 ||
        sourceKeys[0] !== "authorization" ||
        sourceKeys[1] !== "previousResult") {
        fail("target-delivery-product-defect-remediation-context", "$/productDefectRemediationSource");
    }
    let authorization;
    let previousResult;
    try {
        authorization = parseControllerProductDefectRemediationAuthorization(source.authorization);
    }
    catch (error) {
        if (error instanceof ControllerProductDefectRemediationAuthorizationError) {
            fail("controller-product-defect-remediation-authorization", "$/productDefectRemediationSource/authorization", error);
        }
        throw error;
    }
    try {
        previousResult = parseTargetResult(source.previousResult);
    }
    catch (error) {
        if (error instanceof TargetResultError) {
            fail("target-result", "$/productDefectRemediationSource/previousResult", error);
        }
        throw error;
    }
    assertRemediationContextMatchesEnvelope(authorization, previousResult, envelope);
    return Object.freeze({ authorization, previousResult });
}
function assertTestAttemptMatchesPackage(envelope, taskPackage) {
    try {
        assertTestExecutionAttemptMatchesPackage(envelope.attempt, taskPackage);
    }
    catch (error) {
        if (error instanceof TestExecutionAttemptError) {
            fail("delivery-envelope", "$/envelope/attempt", error);
        }
        throw error;
    }
}
/** 命令带着返工来源就解析它；没带而信封里有返工上下文，是缺了来源。 */
function optionalReworkSource(present, command, envelope) {
    if (present)
        return parseReworkSource(command.reworkSource, envelope);
    if (envelope.rework !== undefined)
        fail("target-delivery-rework-context", "$/reworkSource");
    return undefined;
}
/** 命令带着修复来源就解析它；没带而信封里有修复上下文，是缺了来源。 */
function optionalProductDefectRemediationSource(present, command, envelope) {
    if (present) {
        return parseProductDefectRemediationSource(command.productDefectRemediationSource, envelope);
    }
    if (envelope.productDefectRemediation !== undefined) {
        fail("target-delivery-product-defect-remediation-context", "$/productDefectRemediationSource");
    }
    return undefined;
}
function parsePrepareDeliveryCommand(base) {
    const hasReworkSource = Object.hasOwn(base, "reworkSource");
    const hasProductDefectRemediationSource = Object.hasOwn(base, "productDefectRemediationSource");
    if (hasReworkSource && hasProductDefectRemediationSource) {
        fail("input", "$command");
    }
    const command = exactCommand(base, [
        ...PREPARE_DELIVERY_BASE_FIELDS,
        ...(hasReworkSource ? ["reworkSource"] : []),
        ...(hasProductDefectRemediationSource ? ["productDefectRemediationSource"] : []),
    ].sort());
    const { envelope, taskPackage } = parsePreparedEnvelopeAndPackage(command);
    if (envelope.workType === "test") {
        assertTestAttemptMatchesPackage(envelope, taskPackage);
        if (hasReworkSource || hasProductDefectRemediationSource) {
            fail("input", "$command");
        }
    }
    const reworkSource = optionalReworkSource(hasReworkSource, command, envelope);
    const productDefectRemediationSource = optionalProductDefectRemediationSource(hasProductDefectRemediationSource, command, envelope);
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
function parseRecordDeliveryOutcomeCommand(base) {
    const command = exactCommand(base, RECORD_DELIVERY_OUTCOME_FIELDS);
    let outcome;
    try {
        outcome = parseDeliveryOutcome(command.outcome);
    }
    catch (error) {
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
function parseRearmDeliveryCommand(base) {
    const command = exactCommand(base, REARM_DELIVERY_FIELDS);
    let rearm;
    try {
        rearm = parseDeliveryRearm(command.rearm);
    }
    catch (error) {
        if (error instanceof DeliveryRearmError)
            fail("delivery-rearm", "$/rearm", error);
        throw error;
    }
    return Object.freeze({
        commandType: "delivery.rearm-delivery",
        commandVersion: 1,
        eventId: parseId(command.eventId, "demand-event", "$/eventId"),
        rearm,
    });
}
function parseRecordTargetResultCommand(base) {
    const observed = Object.hasOwn(base, "sessionPrompts");
    const command = exactCommand(base, observed ? RECORD_OBSERVED_TARGET_RESULT_FIELDS : RECORD_TARGET_RESULT_FIELDS);
    let sessionPrompts;
    if (observed) {
        try {
            sessionPrompts = parseTargetSessionPromptObservation(command.sessionPrompts, "$/sessionPrompts");
        }
        catch (error) {
            if (error instanceof TargetSessionPromptObservationError)
                fail("input", error.path, error);
            throw error;
        }
    }
    let result;
    try {
        result = parseTargetResult(command.result);
    }
    catch (error) {
        if (error instanceof TargetResultError) {
            fail("target-result", "$/result", error);
        }
        throw error;
    }
    let callback;
    let evidenceResolution;
    try {
        callback = parseTargetResultCallbackRecord(command.callback, "$/callback");
        evidenceResolution = parseTargetResultEvidenceResolutions(command.evidenceResolution, "$/evidenceResolution");
    }
    catch (error) {
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
function parseReissueCallbackCommand(base) {
    const command = exactCommand(base, REISSUE_CALLBACK_FIELDS);
    let reissue;
    try {
        reissue = parseTargetResultCallbackReissue(command.reissue, "$/reissue");
    }
    catch (error) {
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
function parseDecideTargetResultCommand(base) {
    const hasAuthorization = Object.hasOwn(base, "authorization");
    const command = exactCommand(base, hasAuthorization
        ? DECIDE_TARGET_RESULT_REVIEW_WITH_AUTHORIZATION_FIELDS
        : DECIDE_TARGET_RESULT_REVIEW_FIELDS);
    let decision;
    try {
        decision = parseControllerReviewDecision(command.decision);
    }
    catch (error) {
        if (error instanceof ControllerReviewDecisionError) {
            fail("controller-review-decision", "$/decision", error);
        }
        throw error;
    }
    const productDefect = decision.kind === "WakeflowControllerTestReviewDecision" &&
        decision.escalation?.classification === "product-defect";
    if (productDefect !== hasAuthorization)
        fail("input", "$/authorization");
    if (!hasAuthorization) {
        return Object.freeze({
            commandType: "review.decide-target-result",
            commandVersion: 1,
            decision,
        });
    }
    let authorization;
    try {
        authorization = parseControllerProductDefectRemediationAuthorization(command.authorization);
    }
    catch (error) {
        if (error instanceof ControllerProductDefectRemediationAuthorizationError) {
            fail("controller-product-defect-remediation-authorization", "$/authorization", error);
        }
        throw error;
    }
    if (authorization.source.testReviewDecision.targetReviewDecisionId !==
        decision.targetReviewDecisionId ||
        authorization.source.testReviewDecision.decisionDigest !== decision.decisionDigest ||
        authorization.source.reviewSnapshotDigest !== decision.reviewed.snapshotDigest ||
        authorization.source.streamRevision !== decision.reviewed.streamRevision + 1) {
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
const COMMAND_PARSERS = Object.freeze({
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
export function parseDemandEventSourcingCommand(value) {
    let base;
    try {
        base = parsePlainRecord(value, "$command");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", "$command", error);
        throw error;
    }
    if (base.commandVersion !== 1)
        fail("input", "$/commandVersion");
    const commandType = base.commandType;
    const parser = typeof commandType === "string" && Object.hasOwn(COMMAND_PARSERS, commandType)
        ? COMMAND_PARSERS[commandType]
        : undefined;
    if (parser === undefined)
        fail("input", "$/commandType");
    return parser(base);
}
/** 计算已准入命令的稳定幂等摘要；事件存储不接受调用方自行声明的摘要。 */
export function computeDemandEventSourcingCommandDigest(value) {
    return computeCanonicalJsonSha256Digest(parseDemandEventSourcingCommand(value));
}
function singleEvent(event) {
    return Object.freeze([event]);
}
function parseState(value) {
    if (value === null)
        return null;
    try {
        return parseDemandAggregateState(value);
    }
    catch (error) {
        if (error instanceof DemandAggregateStateError)
            fail("state", "$state", error);
        throw error;
    }
}
function decidePublishDemand(state, command) {
    if (state !== null)
        fail("transition", "$state");
    return singleEvent(parseDemandUncommittedEvent({
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
    }));
}
function decideRecordManagedEvidence(state, command) {
    if (state.demandId !== command.manifest.demandId) {
        fail("identity", "$/manifest/demandId");
    }
    try {
        recordManagedEvidenceInDemandAggregateState(state, command.manifest);
    }
    catch (error) {
        if (error instanceof DemandAggregateStateError) {
            fail("transition", "$state/managedEvidence", error);
        }
        throw error;
    }
    return singleEvent(parseDemandUncommittedEvent({
        eventId: command.eventId,
        demandId: command.manifest.demandId,
        recordedAt: command.manifest.capturedAt,
        eventType: "evidence.managed-evidence-recorded",
        data: { manifest: command.manifest },
    }));
}
function decideCompleteDemand(state, command) {
    if (state.demandId !== command.completion.demandId) {
        fail("identity", "$/completion/demandId");
    }
    try {
        completeDemandAggregateState(state, command.completion);
    }
    catch (error) {
        if (error instanceof DemandAggregateStateError) {
            fail("transition", "$state", error);
        }
        throw error;
    }
    return singleEvent(parseDemandUncommittedEvent({
        eventId: command.eventId,
        demandId: command.completion.demandId,
        recordedAt: command.completion.completedAt,
        eventType: "lifecycle.demand-completed",
        data: { completion: command.completion },
    }));
}
function decideRecordTargetResult(state, command) {
    try {
        recordTargetResultInDemandAggregateState(state, command.result, command.callback);
    }
    catch (error) {
        if (error instanceof DemandAggregateStateError) {
            fail("transition", "$state/targetTasks", error);
        }
        throw error;
    }
    return singleEvent(parseDemandUncommittedEvent({
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
    }));
}
function decideReissueCallback(state, command) {
    try {
        reissueCallbackInDemandAggregateState(state, command.reissue);
    }
    catch (error) {
        if (error instanceof DemandAggregateStateError) {
            fail("transition", "$state/targetTasks", error);
        }
        throw error;
    }
    return singleEvent(parseDemandUncommittedEvent({
        eventId: command.eventId,
        demandId: state.demandId,
        recordedAt: command.reissue.issuedAt,
        eventType: "result.callback-reissued",
        data: { reissue: command.reissue },
    }));
}
function decideRearmDelivery(state, command) {
    try {
        rearmDeliveryInDemandAggregateState(state, command.rearm);
    }
    catch (error) {
        if (error instanceof DemandAggregateStateError) {
            fail("transition", "$state/targetTasks", error);
        }
        throw error;
    }
    return singleEvent(parseDemandUncommittedEvent({
        eventId: command.eventId,
        demandId: state.demandId,
        recordedAt: command.rearm.rearmedAt,
        eventType: "delivery.delivery-rearmed",
        data: { rearm: command.rearm },
    }));
}
function decideRecordDeliveryOutcome(state, command) {
    try {
        recordDeliveryOutcomeInDemandAggregateState(state, command.outcome);
    }
    catch (error) {
        if (error instanceof DemandAggregateStateError) {
            fail("transition", "$state/targetTasks", error);
        }
        throw error;
    }
    return singleEvent(parseDemandUncommittedEvent({
        eventId: command.eventId,
        demandId: state.demandId,
        recordedAt: command.outcome.observedAt,
        eventType: "delivery.delivery-outcome-recorded",
        data: { outcome: command.outcome },
    }));
}
function decidePrepareDelivery(state, command) {
    if (state.demandId !== command.envelope.demandId) {
        fail("identity", "$/envelope/demandId");
    }
    try {
        prepareDeliveryInDemandAggregateState(state, command.envelope);
    }
    catch (error) {
        if (error instanceof DemandAggregateStateError) {
            fail("transition", "$state/targetTasks", error);
        }
        throw error;
    }
    return singleEvent(parseDemandUncommittedEvent({
        eventId: command.eventId,
        demandId: command.envelope.demandId,
        recordedAt: command.envelope.preparedAt,
        eventType: "delivery.delivery-prepared",
        data: { envelope: command.envelope },
    }));
}
function decidePlanTargetTask(state, command) {
    if (state.demandId !== command.taskPackage.demandId) {
        fail("identity", "$/taskPackage/demandId");
    }
    try {
        planTargetTaskInDemandAggregateState(state, command.taskPackage);
    }
    catch (error) {
        if (error instanceof DemandAggregateStateError) {
            fail("transition", "$state/targetTasks", error);
        }
        throw error;
    }
    return singleEvent(parseDemandUncommittedEvent({
        eventId: command.eventId,
        demandId: command.taskPackage.demandId,
        recordedAt: command.taskPackage.createdAt,
        eventType: "tasking.target-task-planned",
        data: { taskPackage: command.taskPackage },
    }));
}
function decideEscalateDemand(state, command) {
    try {
        escalateDemandAggregateState(state, command.escalation, command.eventId);
    }
    catch (error) {
        if (error instanceof DemandAggregateStateError) {
            fail("transition", "$state/awaitingDecision", error);
        }
        throw error;
    }
    return singleEvent(parseDemandUncommittedEvent({
        eventId: command.eventId,
        demandId: command.demandId,
        recordedAt: command.recordedAt,
        eventType: "lifecycle.demand-escalated",
        data: { escalation: command.escalation },
    }));
}
function decideRecordDecision(state, command) {
    try {
        recordDecisionInDemandAggregateState(state, command.decision.escalationEventId);
    }
    catch (error) {
        if (error instanceof DemandAggregateStateError) {
            fail("transition", "$state/awaitingDecision", error);
        }
        throw error;
    }
    return singleEvent(parseDemandUncommittedEvent({
        eventId: command.eventId,
        demandId: command.demandId,
        recordedAt: command.recordedAt,
        eventType: "lifecycle.decision-recorded",
        data: { decision: command.decision },
    }));
}
function decideContinueDemand(state, command) {
    // 续接边界是决策事实：续接前已有的 test 目标随事件持久化，归约器只照抄事件携带的边界。
    const historicalTestTargetIds = historicalTestTargetIdsAtContinuation(state);
    try {
        continueDemandAggregateState(state, command.continuation.kind, command.eventId, historicalTestTargetIds, command.continuation.supplement);
    }
    catch (error) {
        if (error instanceof DemandAggregateStateError) {
            fail("transition", "$state/lifecycle", error);
        }
        throw error;
    }
    return singleEvent(parseDemandUncommittedEvent({
        eventId: command.eventId,
        demandId: command.demandId,
        recordedAt: command.recordedAt,
        eventType: "lifecycle.demand-continued",
        data: {
            continuation: command.continuation,
            ...(historicalTestTargetIds.length === 0 ? {} : { historicalTestTargetIds }),
        },
    }));
}
function decideCancelDemand(state, command) {
    if (state.lifecycle !== "active")
        fail("transition", "$state/lifecycle");
    return singleEvent(parseDemandUncommittedEvent({
        eventId: command.eventId,
        demandId: command.demandId,
        recordedAt: command.recordedAt,
        eventType: "lifecycle.demand-cancelled",
        data: { reason: command.reason },
    }));
}
/** 根据当前状态对一条业务命令作出纯事件决策。 */
export function decideDemandEventSourcingCommand(stateValue, commandValue) {
    const state = parseState(stateValue);
    const command = parseDemandEventSourcingCommand(commandValue);
    if (command.commandType === "publication.publish-demand") {
        return decidePublishDemand(state, command);
    }
    if (state === null)
        fail("transition", "$state");
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
    if (state.demandId !== command.demandId)
        fail("identity", "$/demandId");
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
function decideReview(state, command) {
    let decided;
    try {
        decided = decideTargetResultReviewInDemandAggregateState(state, command.decision);
    }
    catch (error) {
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
        }
        catch (error) {
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
function assertReworkBrakeReleased(state, decision) {
    if (decision.kind !== "WakeflowControllerImplementationReviewDecision" ||
        decision.decision !== "rework" ||
        decision.resumption?.basis.kind === "decision-recorded") {
        return;
    }
    const target = state.targetTasks.find((entry) => entry.targetTaskId === decision.targetTaskId);
    if (target !== undefined &&
        target.workType !== "test" &&
        (target.reworkCount ?? 0) >= DEMAND_REWORK_ESCALATION_THRESHOLD - 1) {
        fail("transition", "$state/targetTasks/reworkCount");
    }
}
function reviewEscalationContent(decision) {
    if (decision.decision !== "escalate")
        return null;
    if (decision.kind === "WakeflowControllerImplementationReviewDecision") {
        return decision.escalation;
    }
    return decision.escalation?.classification === "needs-decision"
        ? decision.escalation.userDecision
        : null;
}
/** escalate 决定同一提交附带 `lifecycle.demand-escalated{source: review-decision}`。 */
function reviewEscalation(decided, decision, decidedEvent) {
    const content = reviewEscalationContent(decision);
    if (content === null)
        return null;
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
    }
    catch (error) {
        if (error instanceof DemandAggregateStateError) {
            fail("transition", "$state/awaitingDecision", error);
        }
        throw error;
    }
    return escalationEvent;
}
function derivedEventId(namespace, decisionEventId) {
    return createWakeflowDurableId("demand-event", parseUuidV4(deriveUuidV4(namespace, decisionEventId), "$eventId"));
}
function applyManagedEvidenceRecorded(state, event) {
    try {
        return recordManagedEvidenceInDemandAggregateState(state, event.data.manifest);
    }
    catch (error) {
        if (error instanceof DemandAggregateStateError) {
            fail("transition", "$state/managedEvidence", error);
        }
        throw error;
    }
}
function applyTargetTaskPlanned(state, event) {
    try {
        return planTargetTaskInDemandAggregateState(state, event.data.taskPackage);
    }
    catch (error) {
        if (error instanceof DemandAggregateStateError) {
            fail("transition", "$state/targetTasks", error);
        }
        throw error;
    }
}
function applyDeliveryPrepared(state, event) {
    try {
        return prepareDeliveryInDemandAggregateState(state, event.data.envelope);
    }
    catch (error) {
        if (error instanceof DemandAggregateStateError) {
            fail("transition", "$state/targetTasks", error);
        }
        throw error;
    }
}
function applyDeliveryOutcomeRecorded(state, event) {
    try {
        return recordDeliveryOutcomeInDemandAggregateState(state, event.data.outcome);
    }
    catch (error) {
        if (error instanceof DemandAggregateStateError) {
            fail("transition", "$state/targetTasks", error);
        }
        throw error;
    }
}
function applyDeliveryRearmed(state, event) {
    try {
        return rearmDeliveryInDemandAggregateState(state, event.data.rearm);
    }
    catch (error) {
        if (error instanceof DemandAggregateStateError) {
            fail("transition", "$state/targetTasks", error);
        }
        throw error;
    }
}
function applyTargetResultRecorded(state, event) {
    try {
        return recordTargetResultInDemandAggregateState(state, event.data.result, event.data.callback);
    }
    catch (error) {
        if (error instanceof DemandAggregateStateError) {
            fail("transition", "$state/targetTasks", error);
        }
        throw error;
    }
}
function applyCallbackReissued(state, event) {
    try {
        return reissueCallbackInDemandAggregateState(state, event.data.reissue);
    }
    catch (error) {
        if (error instanceof DemandAggregateStateError) {
            fail("transition", "$state/targetTasks", error);
        }
        throw error;
    }
}
function applyTargetResultDecided(state, event) {
    try {
        return decideTargetResultReviewInDemandAggregateState(state, event.data.decision);
    }
    catch (error) {
        if (error instanceof DemandAggregateStateError) {
            fail("transition", "$state/targetTasks", error);
        }
        throw error;
    }
}
function applyProductDefectRemediationAuthorized(state, event) {
    try {
        return authorizeProductDefectRemediationInDemandAggregateState(state, event.data.authorization);
    }
    catch (error) {
        if (error instanceof DemandAggregateStateError) {
            fail("transition", "$state/targetTasks", error);
        }
        throw error;
    }
}
function applyDemandEscalated(state, event) {
    try {
        return escalateDemandAggregateState(state, event.data.escalation, event.eventId);
    }
    catch (error) {
        if (error instanceof DemandAggregateStateError) {
            fail("transition", "$state/awaitingDecision", error);
        }
        throw error;
    }
}
function applyDecisionRecorded(state, event) {
    try {
        return recordDecisionInDemandAggregateState(state, event.data.decision.escalationEventId);
    }
    catch (error) {
        if (error instanceof DemandAggregateStateError) {
            fail("transition", "$state/awaitingDecision", error);
        }
        throw error;
    }
}
function applyDemandContinued(state, event) {
    try {
        return continueDemandAggregateState(state, event.data.continuation.kind, event.eventId, event.data.historicalTestTargetIds, event.data.continuation.supplement);
    }
    catch (error) {
        if (error instanceof DemandAggregateStateError) {
            fail("transition", "$state/lifecycle", error);
        }
        throw error;
    }
}
function applyDemandCompleted(state, event) {
    try {
        return completeDemandAggregateState(state, event.data.completion);
    }
    catch (error) {
        if (error instanceof DemandAggregateStateError) {
            fail("transition", "$state/lifecycle", error);
        }
        throw error;
    }
}
/** 取消事件只带原因，状态的转移不看它。 */
function applyDemandCancelled(state) {
    try {
        return cancelDemandAggregateState(state);
    }
    catch (error) {
        if (error instanceof DemandAggregateStateError) {
            fail("transition", "$state/lifecycle", error);
        }
        throw error;
    }
}
/** 将一个已决定但尚未持久化的事件确定性应用到状态。 */
export function evolveDemandEventSourcingState(stateValue, eventValue) {
    const state = parseState(stateValue);
    let event;
    try {
        event = parseDemandUncommittedEvent(eventValue);
    }
    catch (error) {
        if (error instanceof DemandEventSourcingEventError)
            fail("event", "$event", error);
        throw error;
    }
    if (event.eventType === "publication.demand-published") {
        if (state !== null)
            fail("transition", "$state");
        return createInitialDemandAggregateState(event.demandId, event.data.authorityDigest);
    }
    if (state === null)
        fail("transition", "$state");
    if (state.demandId !== event.demandId)
        fail("identity", "$/demandId");
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
function unhandledEvent(_event) {
    fail("event", "$/eventType");
}
