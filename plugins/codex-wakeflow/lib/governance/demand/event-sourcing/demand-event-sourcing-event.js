import { WAKEFLOW_DECISION_RECORDED_EVENT_DATA_V1_SCHEMA } from "../../../contracts/generated/governance/demand/decision-recorded-event-data-v1.generated.js";
import { WAKEFLOW_DEMAND_CONTINUED_EVENT_DATA_V1_SCHEMA } from "../../../contracts/generated/governance/demand/demand-continued-event-data-v1.generated.js";
import { WAKEFLOW_DEMAND_ESCALATED_EVENT_DATA_V1_SCHEMA } from "../../../contracts/generated/governance/demand/demand-escalated-event-data-v1.generated.js";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../../contracts/generated/foundation/utc-instant.generated.js";
import { parseJsonValue, JsonValueError, } from "../../../foundation/data/json-value.js";
import { createRuntimeJsonSchemaValidator, } from "../../../foundation/schema/runtime-json-schema.js";
import { parseSha256Digest, Sha256Error, } from "../../../foundation/crypto/sha256.js";
import { parsePlainRecord, PassiveOwnDataError, } from "../../../foundation/data/passive-own-data.js";
import { parseWakeflowDurableIdOfKind, WakeflowDurableIdError, } from "../../../contracts/identity/wakeflow-durable-id.js";
import { parseUtcInstant, UtcInstantError, } from "../../../foundation/time/utc-instant.js";
import { parseManagedEvidenceManifest, ManagedEvidenceManifestError, } from "../../evidence/managed-evidence-manifest.js";
import { parseTaskPackage, TaskPackageError, } from "../../tasking/task-package.js";
import { parseTargetResult, targetResultRecordedEventIdFromResult, TargetResultError, } from "../../result/target-result.js";
import { controllerReviewDecisionEventId, parseControllerReviewDecision, ControllerReviewDecisionError, } from "../../review/controller-review-decision.js";
import { deriveTargetResultCallbackId, parseTargetResultCallbackRecord, parseTargetResultCallbackReissue, parseTargetResultEvidenceResolutions, TargetResultCallbackError, } from "../../result/target-result-callback.js";
import { parseControllerProductDefectRemediationAuthorization, productDefectRemediationAuthorizedEventId, ControllerProductDefectRemediationAuthorizationError, } from "../../review/controller-product-defect-remediation-authorization.js";
import { parseDemandCompletion, DemandCompletionError, } from "../../lifecycle/demand-completion.js";
import { DeliveryEnvelopeError, parseDeliveryEnvelope, } from "../../delivery/delivery-envelope.js";
import { DeliveryOutcomeError, parseDeliveryOutcome, } from "../../delivery/delivery-outcome.js";
import { DeliveryRearmError, parseDeliveryRearm, } from "../../delivery/delivery-rearm.js";
const ERROR_MESSAGES = {
    input: "Demand Event Sourcing event input is invalid.",
    identifier: "Demand Event Sourcing event contains an invalid identity.",
    time: "Demand Event Sourcing event contains an invalid recorded time.",
    digest: "Demand Event Sourcing event contains an invalid digest.",
    "event-type": "Demand Event Sourcing event type and data do not form one closed variant.",
    text: "Demand Event Sourcing event contains non-canonical text.",
    "task-package": "Demand Event Sourcing event contains an invalid TaskPackage.",
    "delivery-envelope": "Demand Event Sourcing event contains an invalid Delivery Envelope.",
    "delivery-outcome": "Demand Event Sourcing event contains an invalid Delivery Outcome.",
    "delivery-rearm": "Demand Event Sourcing event contains an invalid Delivery Rearm.",
    "target-result": "Demand Event Sourcing event contains an invalid TargetResult.",
    "controller-review-decision": "Demand Event Sourcing event contains an invalid Controller Review Decision.",
    "controller-product-defect-remediation-authorization": "Demand Event Sourcing event contains an invalid Controller Product Defect Remediation Authorization.",
    "target-result-callback": "Demand Event Sourcing event contains an invalid Target Result callback record.",
    "demand-completion": "Demand Event Sourcing event contains an invalid Demand Completion.",
    "lifecycle-data": "Demand Event Sourcing event carries invalid lifecycle data.",
    "managed-evidence-manifest": "Demand Event Sourcing event contains an invalid Managed Evidence Manifest.",
    relation: "Demand Event Sourcing event identity and payload do not close.",
};
export class DemandEventSourcingEventError extends Error {
    name = "DemandEventSourcingEventError";
    code = "wakeflow-demand-event-sourcing-event";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
const BASE_FIELDS = Object.freeze([
    "data",
    "demandId",
    "eventId",
    "eventType",
    "recordedAt",
]);
const PUBLISHED_DATA_FIELDS = Object.freeze([
    "authorityDigest",
    "authorityRef",
    "identityDigest",
    "identityRef",
]);
const CANCELLED_DATA_FIELDS = Object.freeze(["reason"]);
const COMPLETED_DATA_FIELDS = Object.freeze(["completion"]);
const ESCALATED_DATA_FIELDS = Object.freeze(["escalation"]);
const DECISION_RECORDED_DATA_FIELDS = Object.freeze(["decision"]);
const CONTINUED_DATA_FIELDS = Object.freeze(["continuation"]);
const LIFECYCLE_DATA_REFERENCES = Object.freeze([
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
    WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
    WAKEFLOW_UTC_INSTANT_SCHEMA,
]);
const validateEscalatedData = createRuntimeJsonSchemaValidator(WAKEFLOW_DEMAND_ESCALATED_EVENT_DATA_V1_SCHEMA, LIFECYCLE_DATA_REFERENCES);
const validateDecisionRecordedData = createRuntimeJsonSchemaValidator(WAKEFLOW_DECISION_RECORDED_EVENT_DATA_V1_SCHEMA, LIFECYCLE_DATA_REFERENCES);
const validateContinuedData = createRuntimeJsonSchemaValidator(WAKEFLOW_DEMAND_CONTINUED_EVENT_DATA_V1_SCHEMA, LIFECYCLE_DATA_REFERENCES);
/** 生命周期事件的数据只有 Schema 形状，没有独立领域编解码器；这里按 Schema 严格准入。 */
function lifecycleData(validate, value, path) {
    let json;
    try {
        json = parseJsonValue(value, path);
    }
    catch (error) {
        if (error instanceof JsonValueError)
            fail("lifecycle-data", path);
        throw error;
    }
    const result = validate(json);
    if (!result.ok)
        fail("lifecycle-data", path);
    return Object.freeze(result.value);
}
const MANAGED_EVIDENCE_RECORDED_DATA_FIELDS = Object.freeze([
    "manifest",
]);
const TARGET_TASK_PLANNED_DATA_FIELDS = Object.freeze(["taskPackage"]);
const DELIVERY_PREPARED_DATA_FIELDS = Object.freeze(["envelope"]);
const DELIVERY_OUTCOME_RECORDED_DATA_FIELDS = Object.freeze(["outcome"]);
const DELIVERY_REARMED_DATA_FIELDS = Object.freeze(["rearm"]);
const TARGET_RESULT_RECORDED_DATA_FIELDS = Object.freeze([
    "callback",
    "evidenceResolution",
    "result",
]);
const CALLBACK_REISSUED_DATA_FIELDS = Object.freeze(["reissue"]);
const CONTROLLER_TARGET_REVIEW_DECIDED_DATA_FIELDS = Object.freeze([
    "decision",
]);
const PRODUCT_DEFECT_REMEDIATION_AUTHORIZED_DATA_FIELDS = Object.freeze([
    "authorization",
]);
const CONTROL_EXCEPT_LF_PATTERN = /\r|[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;
function fail(reason, path) {
    throw new DemandEventSourcingEventError(reason, path);
}
function exactRecord(value, fields, path) {
    let record;
    try {
        record = parsePlainRecord(value, path);
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", path);
        throw error;
    }
    const keys = Object.keys(record).sort();
    if (keys.length !== fields.length ||
        keys.some((key, index) => key !== fields[index])) {
        fail("input", path);
    }
    return record;
}
function parseId(value, kind, path) {
    try {
        return parseWakeflowDurableIdOfKind(value, kind, path);
    }
    catch (error) {
        if (error instanceof WakeflowDurableIdError)
            fail("identifier", path);
        throw error;
    }
}
function parseTime(value) {
    try {
        return parseUtcInstant(value, "$/recordedAt");
    }
    catch (error) {
        if (error instanceof UtcInstantError)
            fail("time", "$/recordedAt");
        throw error;
    }
}
function parseDigest(value, path) {
    try {
        return parseSha256Digest(value, path);
    }
    catch (error) {
        if (error instanceof Sha256Error)
            fail("digest", path);
        throw error;
    }
}
function parseCanonicalReason(value) {
    if (typeof value !== "string" ||
        value.length === 0 ||
        Array.from(value).length > 8192 ||
        !value.isWellFormed() ||
        value.normalize("NFC") !== value ||
        value.trim() !== value ||
        CONTROL_EXCEPT_LF_PATTERN.test(value)) {
        fail("text", "$/data/reason");
    }
    return value;
}
/** 解析字段集合严格受限，且不含任何持久化位置字段的未提交事件。 */
export function parseDemandUncommittedEvent(value) {
    const record = exactRecord(value, BASE_FIELDS, "$event");
    const eventId = parseId(record.eventId, "demand-event", "$/eventId");
    const demandId = parseId(record.demandId, "demand", "$/demandId");
    const recordedAt = parseTime(record.recordedAt);
    if (record.eventType === "publication.demand-published") {
        const data = exactRecord(record.data, PUBLISHED_DATA_FIELDS, "$/data");
        if (data.identityRef !== "identity.json" ||
            data.authorityRef !== "authority.json") {
            fail("event-type", "$/data");
        }
        return Object.freeze({
            eventId,
            demandId,
            recordedAt,
            eventType: "publication.demand-published",
            data: Object.freeze({
                identityRef: "identity.json",
                identityDigest: parseDigest(data.identityDigest, "$/data/identityDigest"),
                authorityRef: "authority.json",
                authorityDigest: parseDigest(data.authorityDigest, "$/data/authorityDigest"),
            }),
        });
    }
    if (record.eventType === "lifecycle.demand-cancelled") {
        const data = exactRecord(record.data, CANCELLED_DATA_FIELDS, "$/data");
        return Object.freeze({
            eventId,
            demandId,
            recordedAt,
            eventType: "lifecycle.demand-cancelled",
            data: Object.freeze({ reason: parseCanonicalReason(data.reason) }),
        });
    }
    if (record.eventType === "lifecycle.demand-completed") {
        const data = exactRecord(record.data, COMPLETED_DATA_FIELDS, "$/data");
        let completion;
        try {
            completion = parseDemandCompletion(data.completion);
        }
        catch (error) {
            if (error instanceof DemandCompletionError) {
                fail("demand-completion", "$/data/completion");
            }
            throw error;
        }
        if (completion.demandId !== demandId ||
            completion.completedAt !== recordedAt) {
            fail("relation", "$event");
        }
        return Object.freeze({
            eventId,
            demandId,
            recordedAt,
            eventType: "lifecycle.demand-completed",
            data: Object.freeze({ completion }),
        });
    }
    if (record.eventType === "lifecycle.demand-escalated") {
        const data = exactRecord(record.data, ESCALATED_DATA_FIELDS, "$/data");
        const escalation = lifecycleData(validateEscalatedData, data, "$/data").escalation;
        return Object.freeze({
            eventId,
            demandId,
            recordedAt,
            eventType: "lifecycle.demand-escalated",
            data: Object.freeze({ escalation: Object.freeze(escalation) }),
        });
    }
    if (record.eventType === "lifecycle.decision-recorded") {
        const data = exactRecord(record.data, DECISION_RECORDED_DATA_FIELDS, "$/data");
        const decision = lifecycleData(validateDecisionRecordedData, data, "$/data").decision;
        return Object.freeze({
            eventId,
            demandId,
            recordedAt,
            eventType: "lifecycle.decision-recorded",
            data: Object.freeze({ decision: Object.freeze(decision) }),
        });
    }
    if (record.eventType === "lifecycle.demand-continued") {
        const data = exactRecord(record.data, CONTINUED_DATA_FIELDS, "$/data");
        const continuation = lifecycleData(validateContinuedData, data, "$/data").continuation;
        return Object.freeze({
            eventId,
            demandId,
            recordedAt,
            eventType: "lifecycle.demand-continued",
            data: Object.freeze({ continuation: Object.freeze(continuation) }),
        });
    }
    if (record.eventType === "evidence.managed-evidence-recorded") {
        const data = exactRecord(record.data, MANAGED_EVIDENCE_RECORDED_DATA_FIELDS, "$/data");
        let manifest;
        try {
            manifest = parseManagedEvidenceManifest(data.manifest);
        }
        catch (error) {
            if (error instanceof ManagedEvidenceManifestError) {
                fail("managed-evidence-manifest", "$/data/manifest");
            }
            throw error;
        }
        if (manifest.demandId !== demandId || manifest.capturedAt !== recordedAt) {
            fail("relation", "$event");
        }
        return Object.freeze({
            eventId,
            demandId,
            recordedAt,
            eventType: "evidence.managed-evidence-recorded",
            data: Object.freeze({ manifest }),
        });
    }
    if (record.eventType === "tasking.target-task-planned") {
        const data = exactRecord(record.data, TARGET_TASK_PLANNED_DATA_FIELDS, "$/data");
        let taskPackage;
        try {
            taskPackage = parseTaskPackage(data.taskPackage);
        }
        catch (error) {
            if (error instanceof TaskPackageError) {
                fail("task-package", "$/data/taskPackage");
            }
            throw error;
        }
        if (taskPackage.demandId !== demandId ||
            taskPackage.createdAt !== recordedAt) {
            fail("relation", "$event");
        }
        return Object.freeze({
            eventId,
            demandId,
            recordedAt,
            eventType: "tasking.target-task-planned",
            data: Object.freeze({ taskPackage }),
        });
    }
    if (record.eventType === "delivery.delivery-prepared") {
        const data = exactRecord(record.data, DELIVERY_PREPARED_DATA_FIELDS, "$/data");
        let envelope;
        try {
            envelope = parseDeliveryEnvelope(data.envelope);
        }
        catch (error) {
            if (error instanceof DeliveryEnvelopeError) {
                fail("delivery-envelope", "$/data/envelope");
            }
            throw error;
        }
        if (envelope.demandId !== demandId || envelope.preparedAt !== recordedAt) {
            fail("relation", "$event");
        }
        return Object.freeze({
            eventId,
            demandId,
            recordedAt,
            eventType: "delivery.delivery-prepared",
            data: Object.freeze({ envelope }),
        });
    }
    if (record.eventType === "delivery.delivery-outcome-recorded") {
        const data = exactRecord(record.data, DELIVERY_OUTCOME_RECORDED_DATA_FIELDS, "$/data");
        let outcome;
        try {
            outcome = parseDeliveryOutcome(data.outcome);
        }
        catch (error) {
            if (error instanceof DeliveryOutcomeError) {
                fail("delivery-outcome", "$/data/outcome");
            }
            throw error;
        }
        if (outcome.observedAt !== recordedAt)
            fail("relation", "$event");
        return Object.freeze({
            eventId,
            demandId,
            recordedAt,
            eventType: "delivery.delivery-outcome-recorded",
            data: Object.freeze({ outcome }),
        });
    }
    if (record.eventType === "delivery.delivery-rearmed") {
        const data = exactRecord(record.data, DELIVERY_REARMED_DATA_FIELDS, "$/data");
        let rearm;
        try {
            rearm = parseDeliveryRearm(data.rearm);
        }
        catch (error) {
            if (error instanceof DeliveryRearmError)
                fail("delivery-rearm", "$/data/rearm");
            throw error;
        }
        if (rearm.rearmedAt !== recordedAt)
            fail("relation", "$event");
        return Object.freeze({
            eventId,
            demandId,
            recordedAt,
            eventType: "delivery.delivery-rearmed",
            data: Object.freeze({ rearm }),
        });
    }
    if (record.eventType === "result.target-result-recorded") {
        const data = exactRecord(record.data, TARGET_RESULT_RECORDED_DATA_FIELDS, "$/data");
        let result;
        try {
            result = parseTargetResult(data.result);
        }
        catch (error) {
            if (error instanceof TargetResultError) {
                fail("target-result", "$/data/result");
            }
            throw error;
        }
        let callback;
        let evidenceResolution;
        try {
            callback = parseTargetResultCallbackRecord(data.callback, "$/data/callback");
            evidenceResolution = parseTargetResultEvidenceResolutions(data.evidenceResolution, "$/data/evidenceResolution");
        }
        catch (error) {
            if (error instanceof TargetResultCallbackError) {
                fail("target-result-callback", error.path);
            }
            throw error;
        }
        if (result.demandId !== demandId ||
            result.report.reportedAt !== recordedAt ||
            targetResultRecordedEventIdFromResult(result) !== eventId ||
            callback.callbackId !== deriveTargetResultCallbackId(result.targetResultId)) {
            fail("relation", "$event");
        }
        return Object.freeze({
            eventId,
            demandId,
            recordedAt,
            eventType: "result.target-result-recorded",
            data: Object.freeze({ result, callback, evidenceResolution }),
        });
    }
    if (record.eventType === "result.callback-reissued") {
        const data = exactRecord(record.data, CALLBACK_REISSUED_DATA_FIELDS, "$/data");
        let reissue;
        try {
            reissue = parseTargetResultCallbackReissue(data.reissue, "$/data/reissue");
        }
        catch (error) {
            if (error instanceof TargetResultCallbackError) {
                fail("target-result-callback", error.path);
            }
            throw error;
        }
        if (reissue.issuedAt !== recordedAt ||
            reissue.callbackId !== deriveTargetResultCallbackId(reissue.targetResultId)) {
            fail("relation", "$event");
        }
        return Object.freeze({
            eventId,
            demandId,
            recordedAt,
            eventType: "result.callback-reissued",
            data: Object.freeze({ reissue }),
        });
    }
    if (record.eventType === "review.target-result-decided") {
        const data = exactRecord(record.data, CONTROLLER_TARGET_REVIEW_DECIDED_DATA_FIELDS, "$/data");
        let decision;
        try {
            decision = parseControllerReviewDecision(data.decision);
        }
        catch (error) {
            if (error instanceof ControllerReviewDecisionError) {
                fail("controller-review-decision", "$/data/decision");
            }
            throw error;
        }
        if (decision.demandId !== demandId ||
            decision.decidedAt !== recordedAt ||
            controllerReviewDecisionEventId(decision) !== eventId) {
            fail("relation", "$event");
        }
        return Object.freeze({
            eventId,
            demandId,
            recordedAt,
            eventType: "review.target-result-decided",
            data: Object.freeze({ decision }),
        });
    }
    if (record.eventType === "review.product-defect-remediation-authorized") {
        const data = exactRecord(record.data, PRODUCT_DEFECT_REMEDIATION_AUTHORIZED_DATA_FIELDS, "$/data");
        let authorization;
        try {
            authorization = parseControllerProductDefectRemediationAuthorization(data.authorization);
        }
        catch (error) {
            if (error instanceof ControllerProductDefectRemediationAuthorizationError) {
                fail("controller-product-defect-remediation-authorization", "$/data/authorization");
            }
            throw error;
        }
        if (authorization.demandId !== demandId ||
            authorization.authorizedAt !== recordedAt ||
            productDefectRemediationAuthorizedEventId(authorization) !== eventId) {
            fail("relation", "$event");
        }
        return Object.freeze({
            eventId,
            demandId,
            recordedAt,
            eventType: "review.product-defect-remediation-authorized",
            data: Object.freeze({ authorization }),
        });
    }
    fail("event-type", "$/eventType");
}
