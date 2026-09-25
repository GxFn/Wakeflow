import { parseDenseArray, parsePlainRecord, PassiveOwnDataError, } from "../../foundation/data/passive-own-data.js";
import { WAKEFLOW_WORKSPACE_HOST_IDS, } from "../workspace-host-resource-profile.js";
/**
 * Wakeflow Workspace / Window Runtime：宿主窗口不透明身份的静态准入画像。
 *
 * 画像只声明当前宿主返回哪一种 handle、最大长度和必须拒绝的占位文本。handle value
 * 被视为宿主拥有的不透明 identifier；Wakeflow 不从旧实现猜测 UUID、tmux 或 thread
 * 内部格式，也不借此取得创建、读取、发送或关闭宿主窗口的能力。
 */
const WAKEFLOW_WINDOW_HOST_IDENTITY_PROFILE_KIND = "WakeflowWindowHostIdentityProfile";
const WAKEFLOW_WINDOW_HOST_IDENTITY_MAXIMUM_RESERVED_VALUES = 64;
const WAKEFLOW_WINDOW_HOST_IDENTITY_MAXIMUM_HANDLE_LENGTH = 1024;
const ERROR_MESSAGES = {
    input: "Window Host Identity Profile is not passive data.",
    shape: "Window Host Identity Profile has an invalid field set.",
    host: "Window Host Identity Profile host is invalid.",
    kind: "Window Host Identity Profile handle kind is invalid.",
    capacity: "Window Host Identity Profile capacity is invalid.",
    reserved: "Window Host Identity Profile reserved value set is invalid.",
    handle: "Window host handle is invalid for the current host profile.",
};
/** Host Identity Profile 或 opaque handle 准入失败的稳定错误。 */
export class WakeflowWindowHostIdentityProfileError extends Error {
    name = "WakeflowWindowHostIdentityProfileError";
    code = "wakeflow-window-host-identity-profile";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
const PROFILE_FIELDS = Object.freeze([
    "handleKind",
    "hostId",
    "kind",
    "maximumHandleLength",
    "reservedHandleValues",
]);
const HANDLE_FIELDS = Object.freeze(["kind", "value"]);
const HANDLE_KIND_PATTERN = /^[a-z][a-z0-9-]{0,63}$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const HOST_ID_SET = new Set(WAKEFLOW_WORKSPACE_HOST_IDS);
function fail(reason, path) {
    throw new WakeflowWindowHostIdentityProfileError(reason, path);
}
function record(value, path) {
    try {
        return parsePlainRecord(value, path);
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", error.path);
        throw error;
    }
}
function exactFields(value, fields, path) {
    const keys = Object.keys(value).sort();
    if (keys.length !== fields.length
        || keys.some((key, index) => key !== fields[index])) {
        fail("shape", path);
    }
}
function handleKind(value, path) {
    if (typeof value !== "string"
        || !value.isWellFormed()
        || value.normalize("NFC") !== value
        || !HANDLE_KIND_PATTERN.test(value)) {
        fail("kind", path);
    }
    return value;
}
/** 把宿主自有静态值准入为冻结的窗口身份画像。 */
export function parseWakeflowWindowHostIdentityProfile(value) {
    const parsed = record(value, "$profile");
    exactFields(parsed, PROFILE_FIELDS, "$profile");
    if (parsed.kind !== WAKEFLOW_WINDOW_HOST_IDENTITY_PROFILE_KIND) {
        fail("shape", "$profile.kind");
    }
    if (typeof parsed.hostId !== "string" || !HOST_ID_SET.has(parsed.hostId)) {
        fail("host", "$profile.hostId");
    }
    if (typeof parsed.maximumHandleLength !== "number"
        || !Number.isSafeInteger(parsed.maximumHandleLength)
        || parsed.maximumHandleLength < 1
        || parsed.maximumHandleLength
            > WAKEFLOW_WINDOW_HOST_IDENTITY_MAXIMUM_HANDLE_LENGTH) {
        fail("capacity", "$profile.maximumHandleLength");
    }
    const maximumHandleLength = parsed.maximumHandleLength;
    let reservedValues;
    try {
        reservedValues = parseDenseArray(parsed.reservedHandleValues, WAKEFLOW_WINDOW_HOST_IDENTITY_MAXIMUM_RESERVED_VALUES, "$profile.reservedHandleValues");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("reserved", error.path);
        throw error;
    }
    const seen = new Set();
    let previousKey;
    const reservedHandleValues = Object.freeze(reservedValues.map((entry, index) => {
        const caseKey = typeof entry === "string" ? entry.toLowerCase() : "";
        if (typeof entry !== "string"
            || !entry.isWellFormed()
            || entry.normalize("NFC") !== entry
            || entry.length === 0
            || entry.length > maximumHandleLength
            || entry.trim() !== entry
            || CONTROL_PATTERN.test(entry)
            || seen.has(caseKey)
            || (previousKey !== undefined && previousKey >= caseKey)) {
            fail("reserved", `$profile.reservedHandleValues/${index}`);
        }
        seen.add(caseKey);
        previousKey = caseKey;
        return entry;
    }));
    return Object.freeze({
        kind: WAKEFLOW_WINDOW_HOST_IDENTITY_PROFILE_KIND,
        hostId: parsed.hostId,
        handleKind: handleKind(parsed.handleKind, "$profile.handleKind"),
        maximumHandleLength,
        reservedHandleValues,
    });
}
/** 使用当前宿主画像准入一个 Agent 回传的不透明窗口 handle。 */
export function parseWakeflowWindowHostHandle(profileValue, value) {
    const profile = parseWakeflowWindowHostIdentityProfile(profileValue);
    const parsed = record(value, "$handle");
    exactFields(parsed, HANDLE_FIELDS, "$handle");
    if (parsed.kind !== profile.handleKind)
        fail("handle", "$handle.kind");
    const handleValue = parsed.value;
    if (typeof handleValue !== "string"
        || !handleValue.isWellFormed()
        || handleValue.normalize("NFC") !== handleValue
        || handleValue.length === 0
        || handleValue.length > profile.maximumHandleLength
        || handleValue.trim() !== handleValue
        || CONTROL_PATTERN.test(handleValue)
        || profile.reservedHandleValues.some((reserved) => (reserved.toLowerCase() === handleValue.toLowerCase()))) {
        fail("handle", "$handle.value");
    }
    return Object.freeze({
        kind: profile.handleKind,
        value: handleValue,
    });
}
