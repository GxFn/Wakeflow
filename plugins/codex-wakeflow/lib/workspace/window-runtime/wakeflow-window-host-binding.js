import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../contracts/generated/foundation/utc-instant.generated.js";
import { WAKEFLOW_WINDOW_HOST_BINDING_SCHEMA, } from "../../contracts/generated/workspace/window-host-binding.generated.js";
import { parseWakeflowDurableIdOfKind, WakeflowDurableIdError, } from "../../contracts/identity/wakeflow-durable-id.js";
import { parseSha256Digest, Sha256Error, } from "../../foundation/crypto/sha256.js";
import { DeterministicJsonDocumentError, parseDeterministicJsonDocument, renderDeterministicJsonDocument, } from "../../foundation/data/deterministic-json-document.js";
import { JsonValueError, parseJsonValue, } from "../../foundation/data/json-value.js";
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
 *
 * `launch`（1.3.0，open-items G14 / A3）是握手那一刻这个窗口自己的启动事实：服务端按当时的 Config 与宿主
 * 画像解析出的取值与摘要，加上助手读出的宿主版本。status 用它按字段说明漂移；1.3.0 之前写下的绑定没有
 * 这一项，文件里不出现，照旧按整份启动意图摘要比较。
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
    constructor(reason, path, options) {
        super(ERROR_MESSAGES[reason], options);
        this.reason = reason;
        this.path = path;
    }
}
const validateWire = createRuntimeJsonSchemaValidator(WAKEFLOW_WINDOW_HOST_BINDING_SCHEMA, [WAKEFLOW_SHA256_DIGEST_SCHEMA, WAKEFLOW_UTC_INSTANT_SCHEMA]);
function fail(reason, path, cause) {
    throw new WakeflowWindowHostBindingError(reason, path, cause === undefined ? undefined : { cause });
}
function typedId(value, kind, path) {
    try {
        return parseWakeflowDurableIdOfKind(value, kind, path);
    }
    catch (error) {
        if (error instanceof WakeflowDurableIdError)
            fail("schema", path, error);
        throw error;
    }
}
function bindingId(value) {
    try {
        return parseWakeflowWindowHostBindingId(value, "$/bindingId");
    }
    catch (error) {
        if (error instanceof WakeflowWindowHostBindingIdError) {
            fail("schema", "$/bindingId", error);
        }
        throw error;
    }
}
function digest(value, path = "$/source/launchIntentDigest") {
    try {
        return parseSha256Digest(value, path);
    }
    catch (error) {
        if (error instanceof Sha256Error) {
            fail("schema", path, error);
        }
        throw error;
    }
}
/** 取值表按名字排序后冻结：同一组取值只有一种写法，记录的字节才确定。 */
function launchFacts(wire) {
    const values = {};
    for (const name of Object.keys(wire.values).sort())
        values[name] = wire.values[name] ?? null;
    return Object.freeze({
        executionDigest: digest(wire.executionDigest, "$/launch/executionDigest"),
        values: Object.freeze(values),
        hostVersion: wire.hostVersion,
    });
}
function instant(value, path) {
    try {
        return parseUtcInstant(value, path);
    }
    catch (error) {
        if (error instanceof UtcInstantError)
            fail("time", path, error);
        throw error;
    }
}
function identityProfile(value) {
    try {
        return parseWakeflowWindowHostIdentityProfile(value);
    }
    catch (error) {
        if (error instanceof WakeflowWindowHostIdentityProfileError) {
            fail("profile", error.path, error);
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
            fail("handle", "$/handle", error);
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
            fail("input", error.path, error);
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
        // 没有这一项的旧记录不补 null：文件里没有的键，解析后也没有，确定性字节才对得上。
        ...(wire.launch === undefined ? {} : { launch: launchFacts(wire.launch) }),
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
        ...(input.launch === undefined ? {} : { launch: input.launch }),
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
            fail("representation", error.path, error);
        }
        throw error;
    }
    const binding = parseWakeflowWindowHostBinding(json, identityProfileValue);
    if (renderDeterministicJsonDocument(binding, "$windowHostBinding") !== text) {
        fail("representation", "$windowHostBinding");
    }
    return binding;
}
