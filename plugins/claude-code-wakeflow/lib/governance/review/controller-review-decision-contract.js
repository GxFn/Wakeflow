import { parseWakeflowDurableIdOfKind, WakeflowDurableIdError, } from "../../contracts/identity/wakeflow-durable-id.js";
import { parseSha256Digest, Sha256Error, } from "../../foundation/crypto/sha256.js";
import { parseUtcInstant, UtcInstantError, } from "../../foundation/time/utc-instant.js";
const CONTROL_EXCEPT_LF_PATTERN = /\r|[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;
function reviewText(value, path, fail, maximum = 8192) {
    if (value.length === 0 ||
        value.length > maximum ||
        !value.isWellFormed() ||
        value.normalize("NFC") !== value ||
        value.trim() !== value ||
        CONTROL_EXCEPT_LF_PATTERN.test(value)) {
        fail("text", path);
    }
    return value;
}
function reviewDigest(value, path, fail) {
    try {
        return parseSha256Digest(value, path);
    }
    catch (error) {
        if (error instanceof Sha256Error)
            fail("digest", path);
        throw error;
    }
}
function reviewId(value, kind, path, fail) {
    try {
        return parseWakeflowDurableIdOfKind(value, kind, path);
    }
    catch (error) {
        if (error instanceof WakeflowDurableIdError)
            fail("identifier", path);
        throw error;
    }
}
function reviewInstant(value, path, fail) {
    try {
        return parseUtcInstant(value, path);
    }
    catch (error) {
        if (error instanceof UtcInstantError)
            fail("time", path);
        throw error;
    }
}
/** 把 Schema 已校验的升级内容冻结为领域值；备选方案至少一个（Schema 上限 4）。 */
export function normalizeControllerReviewEscalation(wire, path, fail) {
    const options = wire.options.map((option, index) => Object.freeze({
        option: reviewText(option.option, `${path}/options/${index}/option`, fail, 1024),
        impact: reviewText(option.impact, `${path}/options/${index}/impact`, fail, 2048),
    }));
    const [first, ...rest] = options;
    if (first === undefined)
        fail("text", `${path}/options`);
    const admittedOptions = Object.freeze([first, ...rest]);
    return Object.freeze({
        issue: reviewText(wire.issue, `${path}/issue`, fail),
        requirementRefs: Object.freeze(wire.requirementRefs.map((reference, index) => Object.freeze({
            recordDigest: reviewDigest(reference.recordDigest, `${path}/requirementRefs/${index}/recordDigest`, fail),
            sectionAnchor: reference.sectionAnchor,
        }))),
        evidence: Object.freeze(wire.evidence.map((entry, index) => Object.freeze({
            kind: entry.kind,
            id: entry.id,
            digest: reviewDigest(entry.digest, `${path}/evidence/${index}/digest`, fail),
        }))),
        options: admittedOptions,
        recommendation: reviewText(wire.recommendation, `${path}/recommendation`, fail, 4096),
    });
}
export function normalizeControllerReviewResumption(wire, path, fail) {
    return Object.freeze({
        previousDecisionId: reviewId(wire.previousDecisionId, "target-review-decision", `${path}/previousDecisionId`, fail),
        basis: wire.basis.kind === "condition-cleared"
            ? Object.freeze({ kind: "condition-cleared" })
            : Object.freeze({
                kind: "decision-recorded",
                escalationEventId: reviewId(wire.basis.escalationEventId, "demand-event", `${path}/basis/escalationEventId`, fail),
            }),
        summary: reviewText(wire.summary, `${path}/summary`, fail),
    });
}
export function normalizeControllerReviewCallbackLanding(wire, path, fail) {
    if (wire === null)
        return null;
    return Object.freeze({
        recordId: wire.recordId,
        landedAt: reviewInstant(wire.landedAt, `${path}/landedAt`, fail),
    });
}
export function normalizeControllerReviewTargetCompletion(wire, path, fail) {
    if (wire === null)
        return null;
    return Object.freeze({
        recordId: wire.recordId,
        event: wire.event,
        observedAt: reviewInstant(wire.observedAt, `${path}/observedAt`, fail),
    });
}
export function normalizeControllerTestReviewEscalation(wire, path, fail) {
    if (wire.classification === "needs-decision") {
        if (wire.userDecision === undefined || wire.remediation !== undefined) {
            fail("text", `${path}/userDecision`);
        }
        return Object.freeze({
            classification: "needs-decision",
            userDecision: normalizeControllerReviewEscalation(wire.userDecision, `${path}/userDecision`, fail),
        });
    }
    const remediation = wire.remediation;
    if (remediation === undefined || wire.userDecision !== undefined) {
        fail("text", `${path}/remediation`);
    }
    const targets = remediation.affectedTargets.map((target, index) => {
        const targetPath = `${path}/remediation/affectedTargets/${index}`;
        const [firstStep, ...otherSteps] = target.failedStepIds;
        if (firstStep === undefined)
            fail("text", `${targetPath}/failedStepIds`);
        const failedStepIds = Object.freeze([
            firstStep,
            ...otherSteps,
        ]);
        return Object.freeze({
            targetTaskId: reviewId(target.targetTaskId, "target-task", `${targetPath}/targetTaskId`, fail),
            failedStepIds,
            correctionObjective: reviewText(target.correctionObjective, `${targetPath}/correctionObjective`, fail),
        });
    });
    const [firstTarget, ...otherTargets] = targets;
    if (firstTarget === undefined)
        fail("text", `${path}/remediation/affectedTargets`);
    const affectedTargets = Object.freeze([firstTarget, ...otherTargets]);
    return Object.freeze({
        classification: "product-defect",
        remediation: Object.freeze({
            affectedTargets,
            authorizationRationale: reviewText(remediation.authorizationRationale, `${path}/remediation/authorizationRationale`, fail),
        }),
    });
}
