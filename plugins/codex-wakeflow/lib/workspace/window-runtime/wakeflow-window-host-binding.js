import { WAKEFLOW_WINDOW_HOST_BINDING_SCHEMA, } from "../../contracts/generated/workspace/window-host-binding.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../contracts/generated/foundation/utc-instant.generated.js";
import { parseSha256Digest, Sha256Error, } from "../../foundation/crypto/sha256.js";
import { parseDeterministicJsonDocument, renderDeterministicJsonDocument, DeterministicJsonDocumentError, } from "../../foundation/data/deterministic-json-document.js";
import { parseJsonValue, JsonValueError, } from "../../foundation/data/json-value.js";
import { parseWakeflowDurableIdOfKind, WakeflowDurableIdError, } from "../../contracts/identity/wakeflow-durable-id.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import { parseUtcInstant, UtcInstantError, } from "../../foundation/time/utc-instant.js";
import { parseWakeflowWindowHostBindingId, WakeflowWindowHostBindingIdError, } from "./wakeflow-window-host-binding-id.js";
import { parseWakeflowWindowHostHandle, parseWakeflowWindowHostIdentityProfile, WakeflowWindowHostIdentityProfileError, } from "./wakeflow-window-host-identity-profile.js";
/**
 * Wakeflow Workspace / Window Runtime：私有 Window Host Binding 权威记录。
 *
 * 记录只回答“当前宿主的哪个 opaque handle 对应哪个稳定 windowId”，并保存产生该
 * 事实的 Agent host-create observation。它不保存窗口角色、逻辑根、宿主可用性或
 * Delivery 状态；公开consumer只能取得脱敏ref与bindingId。
 */
const WAKEFLOW_WINDOW_HOST_BINDING_KIND = "WakeflowWindowHostBinding";
const WAKEFLOW_WINDOW_HOST_BINDING_VERSION = 1;
const ERROR_MESSAGES = {
    input: "Window Host Binding is not passive JSON data.",
    schema: "Window Host Binding does not satisfy its portable Schema.",
    profile: "Window Host Binding does not belong to the supplied Host Identity Profile.",
    handle: "Window Host Binding contains an invalid current-host handle.",
    time: "Window Host Binding contains an invalid UTC instant.",
    representation: "Window Host Binding bytes are not deterministic.",
};
/** Window Host Binding 准入失败的稳定、脱敏错误。 */
export class WakeflowWindowHostBindingError extends Error {
    name = "WakeflowWindowHostBindingError";
    code = "wakeflow-window-host-binding";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
const validateWire = createRuntimeJsonSchemaValidator(WAKEFLOW_WINDOW_HOST_BINDING_SCHEMA, [WAKEFLOW_SHA256_DIGEST_SCHEMA, WAKEFLOW_UTC_INSTANT_SCHEMA]);
function fail(reason, path) {
    throw new WakeflowWindowHostBindingError(reason, path);
}
function typedId(value, kind, path) {
    try {
        return parseWakeflowDurableIdOfKind(value, kind, path);
    }
    catch (error) {
        if (error instanceof WakeflowDurableIdError)
            fail("schema", path);
        throw error;
    }
}
function bindingId(value) {
    try {
        return parseWakeflowWindowHostBindingId(value, "$/bindingId");
    }
    catch (error) {
        if (error instanceof WakeflowWindowHostBindingIdError) {
            fail("schema", "$/bindingId");
        }
        throw error;
    }
}
function digest(value) {
    try {
        return parseSha256Digest(value, "$/source/launchIntentDigest");
    }
    catch (error) {
        if (error instanceof Sha256Error) {
            fail("schema", "$/source/launchIntentDigest");
        }
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
function identityProfile(value) {
    try {
        return parseWakeflowWindowHostIdentityProfile(value);
    }
    catch (error) {
        if (error instanceof WakeflowWindowHostIdentityProfileError) {
            fail("profile", error.path);
        }
        throw error;
    }
}
function opaqueHandle(profile, value) {
    try {
        return parseWakeflowWindowHostHandle(profile, value);
    }
    catch (error) {
        if (error instanceof WakeflowWindowHostIdentityProfileError) {
            fail("handle", "$/handle");
        }
        throw error;
    }
}
/** 对任意值执行Schema、当前宿主handle、类型化身份和审计时间准入。 */
export function parseWakeflowWindowHostBinding(value, identityProfileValue) {
    let json;
    try {
        json = parseJsonValue(value, "$binding");
    }
    catch (error) {
        if (error instanceof JsonValueError)
            fail("input", error.path);
        throw error;
    }
    const validated = validateWire(json);
    if (!validated.ok)
        fail("schema", validated.path);
    const wire = validated.value;
    const profile = identityProfile(identityProfileValue);
    if (wire.hostId !== profile.hostId)
        fail("profile", "$/hostId");
    const observedAt = instant(wire.source.observedAt, "$/source/observedAt");
    const registeredAt = instant(wire.registeredAt, "$/registeredAt");
    return Object.freeze({
        kind: WAKEFLOW_WINDOW_HOST_BINDING_KIND,
        schemaVersion: WAKEFLOW_WINDOW_HOST_BINDING_VERSION,
        programId: typedId(wire.programId, "program", "$/programId"),
        hostId: wire.hostId,
        windowId: typedId(wire.windowId, "window", "$/windowId"),
        bindingId: bindingId(wire.bindingId),
        handle: opaqueHandle(profile, wire.handle),
        source: Object.freeze({
            kind: "agent-host-create-result",
            launchIntentDigest: digest(wire.source.launchIntentDigest),
            observedAt,
        }),
        registeredAt,
    });
}
/** 从已准入字段创建一份完整 Binding 记录。 */
export function createWakeflowWindowHostBinding(input, identityProfileValue) {
    return parseWakeflowWindowHostBinding({
        kind: WAKEFLOW_WINDOW_HOST_BINDING_KIND,
        schemaVersion: WAKEFLOW_WINDOW_HOST_BINDING_VERSION,
        programId: input.programId,
        hostId: input.hostId,
        windowId: input.windowId,
        bindingId: input.bindingId,
        handle: input.handle,
        source: {
            kind: "agent-host-create-result",
            launchIntentDigest: input.launchIntentDigest,
            observedAt: input.observedAt,
        },
        registeredAt: input.registeredAt,
    }, identityProfileValue);
}
/** 渲染唯一确定性 JSON 文档；文件权限由 Binding store 固定为 0600。 */
export function renderWakeflowWindowHostBinding(value, identityProfileValue) {
    return renderDeterministicJsonDocument(parseWakeflowWindowHostBinding(value, identityProfileValue), "$windowHostBinding");
}
/** 解析确定性 JSON 文档并拒绝任何等价但非规范字节。 */
export function parseWakeflowWindowHostBindingDocument(text, identityProfileValue) {
    let json;
    try {
        json = parseDeterministicJsonDocument(text, "$windowHostBinding");
    }
    catch (error) {
        if (error instanceof DeterministicJsonDocumentError) {
            fail("representation", error.path);
        }
        throw error;
    }
    const binding = parseWakeflowWindowHostBinding(json, identityProfileValue);
    if (renderDeterministicJsonDocument(binding, "$windowHostBinding") !== text) {
        fail("representation", "$windowHostBinding");
    }
    return binding;
}
