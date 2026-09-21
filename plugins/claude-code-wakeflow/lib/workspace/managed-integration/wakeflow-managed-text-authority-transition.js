import { computeSha256Digest, } from "../../foundation/crypto/sha256.js";
import { parseDenseArray, parsePlainRecord, PassiveOwnDataError, } from "../../foundation/data/passive-own-data.js";
import { encodeUtf8, Utf8Error } from "../../foundation/text/utf8.js";
import { inspectWakeflowManagedTextEnvelope, parseWakeflowManagedTextEnvelopeTarget, recomposeWakeflowManagedTextEnvelope, WakeflowManagedTextEnvelopeError, } from "./wakeflow-managed-text-envelope.js";
const ERROR_MESSAGES = {
    input: "Wakeflow managed text authority transition input is invalid.",
    target: "Wakeflow managed text authority transition target is invalid.",
    envelope: "Wakeflow managed text source envelope is invalid.",
    relation: "Wakeflow managed text source belongs to another owner.",
    "unadmitted-source": "Wakeflow managed text source body is not an admitted authority render.",
};
/** Managed Text 权威转换失败的稳定、脱敏错误。 */
export class WakeflowManagedTextAuthorityTransitionError extends Error {
    name = "WakeflowManagedTextAuthorityTransitionError";
    code = "wakeflow-managed-text-authority-transition";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new WakeflowManagedTextAuthorityTransitionError(reason, path);
}
function parseTarget(value, path) {
    let target;
    try {
        target = parseWakeflowManagedTextEnvelopeTarget(value);
    }
    catch (error) {
        if (error instanceof WakeflowManagedTextEnvelopeError) {
            fail("target", path);
        }
        throw error;
    }
    let bodyDigest;
    try {
        bodyDigest = computeSha256Digest(encodeUtf8(target.body, path), path);
    }
    catch (error) {
        if (error instanceof Utf8Error)
            fail("target", path);
        throw error;
    }
    return Object.freeze({ target, bodyDigest });
}
function parseRequest(value) {
    let record;
    let currentValues;
    try {
        record = parsePlainRecord(value, "$request");
        currentValues = parseDenseArray(record.currentTargets, 8, "$request.currentTargets");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", error.path);
        throw error;
    }
    if (Object.keys(record).sort().join("\u0000")
        !== "currentTargets\u0000desiredTarget") {
        fail("input", "$request");
    }
    const desiredTarget = parseTarget(record.desiredTarget, "$request.desiredTarget");
    const currentTargets = Object.freeze(currentValues.map((target, index) => (parseTarget(target, `$request.currentTargets/${index}`))));
    const seenDigests = new Set();
    for (const [index, current] of currentTargets.entries()) {
        if (current.target.component !== desiredTarget.target.component
            || current.target.owner !== desiredTarget.target.owner) {
            fail("relation", `$request.currentTargets/${index}`);
        }
        if (seenDigests.has(current.bodyDigest)) {
            fail("input", `$request.currentTargets/${index}`);
        }
        seenDigests.add(current.bodyDigest);
    }
    return Object.freeze({ currentTargets, desiredTarget });
}
function inspectSource(value) {
    try {
        return inspectWakeflowManagedTextEnvelope(value);
    }
    catch (error) {
        if (error instanceof WakeflowManagedTextEnvelopeError) {
            fail("envelope", "$source");
        }
        throw error;
    }
}
function sameManagedBody(envelope, target) {
    return envelope.kind === "managed"
        && envelope.bodyDigest === target.bodyDigest
        && envelope.body === target.target.body;
}
/**
 * 检查当前正文所有权并生成零 I/O 的幂等 current 或精确重组候选。
 */
export function planWakeflowManagedTextAuthorityTransition(sourceValue, requestValue) {
    const request = parseRequest(requestValue);
    const sourceEnvelope = inspectSource(sourceValue);
    const desired = request.desiredTarget;
    if (sourceEnvelope.kind === "managed"
        && (sourceEnvelope.component !== desired.target.component
            || sourceEnvelope.owner !== desired.target.owner)) {
        fail("relation", "$source");
    }
    if (sameManagedBody(sourceEnvelope, desired)) {
        return Object.freeze({
            disposition: "current",
            sourceAuthority: "desired",
            target: null,
        });
    }
    if (sourceEnvelope.kind === "managed") {
        const admitted = request.currentTargets.some((target) => (sameManagedBody(sourceEnvelope, target)));
        if (!admitted)
            fail("unadmitted-source", "$source");
    }
    let target;
    try {
        target = recomposeWakeflowManagedTextEnvelope(sourceValue, desired.target);
    }
    catch (error) {
        if (error instanceof WakeflowManagedTextEnvelopeError) {
            fail("envelope", "$source");
        }
        throw error;
    }
    if (target.disposition === "current")
        fail("envelope", "$source");
    return Object.freeze({
        disposition: "recompose-required",
        sourceAuthority: sourceEnvelope.kind === "managed"
            ? "admitted-current"
            : "unmanaged",
        target,
    });
}
