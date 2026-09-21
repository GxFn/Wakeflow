import { parseWakeflowDurableIdOfKind, WakeflowDurableIdError, } from "../../contracts/identity/wakeflow-durable-id.js";
import { parseSha256Digest, Sha256Error, } from "../../foundation/crypto/sha256.js";
import { parsePlainRecord, PassiveOwnDataError, } from "../../foundation/data/passive-own-data.js";
import { parsePortableResourcePath, PortableResourcePathError, } from "../../foundation/filesystem/portable-resource-path.js";
import { parseUtcInstant, UtcInstantError, } from "../../foundation/time/utc-instant.js";
import { deriveDurableId } from "../../kernel/ids.js";
import { parseWakeflowWindowHostBindingId, WakeflowWindowHostBindingIdError, } from "../../workspace/window-runtime/wakeflow-window-host-binding-id.js";
import { computeDeliveryPromptDigest, DeliveryEnvelopeError, } from "../delivery/delivery-envelope.js";
/**
 * Wakeflow Governance / Result：结果导入随附的 wake-controller 回调记录（§13.87 D1）。
 *
 * 回调不是投递：不取工作声明、不要求目标 Agent 记结局。记录冻结 Controller 窗口、
 * 绑定代际、可移植 prompt 与摘要；落地由 Controller 会话在 `issuedAt` 之后、摘要相符的
 * `user-prompt-submit` 记录证明，读侧惰性派生。重发只换绑定与代际，prompt 不变。
 */
/** 回调代际上限：一次签发加三次重发（复用投递的 rearm 上限）。 */
export const TARGET_RESULT_CALLBACK_GENERATION_LIMIT = 4;
/** 回调静默阈值：签发后十分钟无落地记录即 silent，可由 rearm_delivery 重发（与投递落地静默一致）。 */
export const TARGET_RESULT_CALLBACK_SILENCE_MILLISECONDS = 10 * 60 * 1000;
const ERROR_MESSAGES = {
    input: "Target Result callback record input is invalid.",
    identifier: "Target Result callback record contains an invalid identity.",
    digest: "Target Result callback record contains an invalid digest.",
    path: "Target Result evidence resolution contains an invalid portable path.",
    time: "Target Result callback record contains an invalid time.",
    text: "Target Result callback record contains an invalid prompt.",
    relation: "Target Result callback record facts are inconsistent.",
};
export class TargetResultCallbackError extends Error {
    name = "TargetResultCallbackError";
    code = "wakeflow-target-result-callback";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
const CALLBACK_FIELDS = Object.freeze([
    "bindingDigest",
    "bindingId",
    "callbackId",
    "controllerWindowId",
    "generation",
    "issuedAt",
    "portablePrompt",
    "promptDigest",
]);
const REISSUE_FIELDS = Object.freeze([
    "bindingDigest",
    "bindingId",
    "callbackId",
    "controllerWindowId",
    "generation",
    "issuedAt",
    "previousGeneration",
    "promptDigest",
    "targetResultId",
]);
const RESOLUTION_FIELDS = Object.freeze(["bytes", "digest", "evidenceId", "ref"]);
const MAXIMUM_EVIDENCE_RESOLUTIONS = 64;
function fail(reason, path) {
    throw new TargetResultCallbackError(reason, path);
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
    if (keys.length !== fields.length || keys.some((key, index) => key !== fields[index])) {
        fail("input", path);
    }
    return record;
}
function id(value, kind, path) {
    try {
        return parseWakeflowDurableIdOfKind(value, kind, path);
    }
    catch (error) {
        if (error instanceof WakeflowDurableIdError)
            fail("identifier", path);
        throw error;
    }
}
function digest(value, path) {
    try {
        return parseSha256Digest(value, path);
    }
    catch (error) {
        if (error instanceof Sha256Error)
            fail("digest", path);
        throw error;
    }
}
function instant(value, path) {
    try {
        return parseUtcInstant(value, path);
    }
    catch (error) {
        if (error instanceof UtcInstantError)
            fail("time", path);
        throw error;
    }
}
function bindingId(value, path) {
    try {
        return parseWakeflowWindowHostBindingId(value, path);
    }
    catch (error) {
        if (error instanceof WakeflowWindowHostBindingIdError)
            fail("identifier", path);
        throw error;
    }
}
function generation(value, minimum, path) {
    if (typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value < minimum ||
        value > TARGET_RESULT_CALLBACK_GENERATION_LIMIT) {
        fail("relation", path);
    }
    return value;
}
/** 回调 prompt 的摘要覆盖去除首尾空白后的文本，与投递信封的最终 prompt 摘要同一算法。 */
export function computeTargetResultCallbackPromptDigest(prompt) {
    try {
        return computeDeliveryPromptDigest(prompt);
    }
    catch (error) {
        if (error instanceof DeliveryEnvelopeError)
            fail("text", "$callback/portablePrompt");
        throw error;
    }
}
/** 回调身份由结果身份派生：一份结果只有一条回调，重发只换代际。 */
export function deriveTargetResultCallbackId(targetResultId) {
    return deriveDurableId("target-delivery", "target-result-callback", targetResultId);
}
export function parseTargetResultCallbackRecord(value, path = "$callback") {
    const record = exactRecord(value, CALLBACK_FIELDS, path);
    if (typeof record.portablePrompt !== "string")
        fail("text", `${path}/portablePrompt`);
    const promptDigest = digest(record.promptDigest, `${path}/promptDigest`);
    if (computeTargetResultCallbackPromptDigest(record.portablePrompt) !== promptDigest ||
        record.generation !== 1) {
        fail("relation", `${path}/promptDigest`);
    }
    return Object.freeze({
        callbackId: id(record.callbackId, "target-delivery", `${path}/callbackId`),
        controllerWindowId: id(record.controllerWindowId, "window", `${path}/controllerWindowId`),
        bindingId: bindingId(record.bindingId, `${path}/bindingId`),
        bindingDigest: digest(record.bindingDigest, `${path}/bindingDigest`),
        portablePrompt: record.portablePrompt,
        promptDigest,
        generation: 1,
        issuedAt: instant(record.issuedAt, `${path}/issuedAt`),
    });
}
export function parseTargetResultCallbackReissue(value, path = "$reissue") {
    const record = exactRecord(value, REISSUE_FIELDS, path);
    const previousGeneration = generation(record.previousGeneration, 1, `${path}/previousGeneration`);
    const nextGeneration = generation(record.generation, 2, `${path}/generation`);
    if (nextGeneration !== previousGeneration + 1)
        fail("relation", `${path}/generation`);
    return Object.freeze({
        targetResultId: id(record.targetResultId, "target-result", `${path}/targetResultId`),
        callbackId: id(record.callbackId, "target-delivery", `${path}/callbackId`),
        previousGeneration,
        generation: nextGeneration,
        controllerWindowId: id(record.controllerWindowId, "window", `${path}/controllerWindowId`),
        bindingId: bindingId(record.bindingId, `${path}/bindingId`),
        bindingDigest: digest(record.bindingDigest, `${path}/bindingDigest`),
        promptDigest: digest(record.promptDigest, `${path}/promptDigest`),
        issuedAt: instant(record.issuedAt, `${path}/issuedAt`),
    });
}
export function parseTargetResultEvidenceResolutions(value, path = "$evidenceResolution") {
    if (!Array.isArray(value) || value.length > MAXIMUM_EVIDENCE_RESOLUTIONS)
        fail("input", path);
    const refs = new Set();
    const resolutions = value.map((entry, index) => {
        const entryPath = `${path}/${index}`;
        const record = exactRecord(entry, RESOLUTION_FIELDS, entryPath);
        let ref;
        try {
            ref = parsePortableResourcePath(record.ref, `${entryPath}/ref`);
        }
        catch (error) {
            if (error instanceof PortableResourcePathError)
                fail("path", `${entryPath}/ref`);
            throw error;
        }
        if (refs.has(ref))
            fail("relation", `${entryPath}/ref`);
        refs.add(ref);
        if (typeof record.bytes !== "number" ||
            !Number.isSafeInteger(record.bytes) ||
            record.bytes < 0) {
            fail("relation", `${entryPath}/bytes`);
        }
        return Object.freeze({
            ref,
            digest: digest(record.digest, `${entryPath}/digest`),
            evidenceId: id(record.evidenceId, "evidence", `${entryPath}/evidenceId`),
            bytes: record.bytes,
        });
    });
    return Object.freeze(resolutions);
}
/** 回调状态由读侧惰性派生：决定已记录即 acknowledged，否则按落地记录与静默阈值判断。 */
export function deriveTargetResultCallbackStatus(input) {
    const landed = input.landingRecords.find((record) => record.promptDigest === input.promptDigest &&
        Date.parse(record.recordedAt) >= Date.parse(input.issuedAt));
    if (input.acknowledged) {
        return Object.freeze({
            status: "acknowledged",
            landedRecordId: landed?.recordId ?? null,
            landedAt: landed?.recordedAt ?? null,
        });
    }
    if (landed !== undefined) {
        return Object.freeze({
            status: "landed",
            landedRecordId: landed.recordId,
            landedAt: landed.recordedAt,
        });
    }
    const silent = Date.parse(input.now) - Date.parse(input.issuedAt) > input.silenceMilliseconds;
    return Object.freeze({
        status: silent ? "silent" : "pending",
        landedRecordId: null,
        landedAt: null,
    });
}
