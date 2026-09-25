import { parseWakeflowConfigPlacement, WakeflowConfigError, } from "../../configuration/wakeflow-config.js";
import { WAKEFLOW_WINDOW_RUNTIME_UNREGISTERED_PROJECTION_SCHEMA, } from "../../contracts/generated/workspace/window-runtime-unregistered-projection.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA, } from "../../contracts/generated/foundation/sha256-digest.generated.js";
import { computeCanonicalJsonSha256Digest, } from "../../foundation/crypto/canonical-json-sha256.js";
import { computeSha256Digest, parseSha256Digest, Sha256Error, } from "../../foundation/crypto/sha256.js";
import { parseDeterministicJsonDocument, renderDeterministicJsonDocument, DeterministicJsonDocumentError, } from "../../foundation/data/deterministic-json-document.js";
import { parseJsonValue, JsonValueError, } from "../../foundation/data/json-value.js";
import { parseWakeflowDurableIdOfKind, WakeflowDurableIdError, } from "../../contracts/identity/wakeflow-durable-id.js";
import { createRuntimeJsonSchemaValidator, } from "../../foundation/schema/runtime-json-schema.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import { compileWakeflowWindowRuntimeDesiredTopology, WakeflowWindowRuntimeDesiredTopologyError, } from "./wakeflow-window-runtime-desired-topology.js";
import { wakeflowWindowRuntimeProjectionRef, wakeflowWindowRuntimeProjectionRootRef, } from "./wakeflow-window-runtime-paths.js";
/**
 * Wakeflow Workspace / Window Runtime：Fresh 初始化的未注册窗口投影集合。
 *
 * 每条记录只连接 desired topology 与当前未注册状态，固定表达
 * `identity=unregistered`、`rootObservation=unobserved` 和 identity preflight blocker。
 * 它不声明 Binding 目录为空；该物理事实只由 Fresh Publication 在文件系统边界证明。
 * 本模块也不生成 Binding、不判断 dispatch policy/host availability，不保存 display
 * title、raw handle、绝对路径或时间字段。
 */
export const WAKEFLOW_WINDOW_RUNTIME_PROJECTION_KIND = "WakeflowWindowRuntimeProjection";
export const WAKEFLOW_WINDOW_RUNTIME_PROJECTION_VERSION = 1;
const WAKEFLOW_WINDOW_RUNTIME_PROJECTION_SET_KIND = "WakeflowWindowRuntimeProjectionSet";
const ERROR_MESSAGES = {
    input: "Window Runtime unregistered projection input is invalid.",
    schema: "Window Runtime unregistered projection does not satisfy its Schema.",
    identity: "Window Runtime unregistered projection identity is invalid.",
    placement: "Window Runtime unregistered projection placement is invalid.",
    relation: "Window Runtime unregistered projection fields are inconsistent.",
    digest: "Window Runtime unregistered projection digest is invalid.",
    representation: "Window Runtime unregistered projection bytes are not deterministic.",
};
/** 未注册 Window Runtime 投影准入失败的稳定、脱敏错误。 */
export class WakeflowWindowRuntimeUnregisteredProjectionRecordError extends Error {
    name = "WakeflowWindowRuntimeUnregisteredProjectionRecordError";
    code = "wakeflow-window-runtime-unregistered-projection-record";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
/** 由同一 Config/Host 编译出的纯 source 发生内部关系漂移。 */
export class WakeflowWindowRuntimeUnregisteredProjectionError extends Error {
    name = "WakeflowWindowRuntimeUnregisteredProjectionError";
    code = "wakeflow-window-runtime-unregistered-projection";
    reason = "source";
    path;
    constructor(path) {
        super("Window Runtime unregistered projection source is invalid.");
        this.path = path;
    }
}
const validateProjectionWire = createRuntimeJsonSchemaValidator(WAKEFLOW_WINDOW_RUNTIME_UNREGISTERED_PROJECTION_SCHEMA, [WAKEFLOW_SHA256_DIGEST_SCHEMA]);
function failRecord(reason, path) {
    throw new WakeflowWindowRuntimeUnregisteredProjectionRecordError(reason, path);
}
function typedId(value, kind, path) {
    try {
        return parseWakeflowDurableIdOfKind(value, kind, path);
    }
    catch (error) {
        if (error instanceof WakeflowDurableIdError)
            failRecord("identity", path);
        throw error;
    }
}
function digest(value, path) {
    try {
        return parseSha256Digest(value, path);
    }
    catch (error) {
        if (error instanceof Sha256Error)
            failRecord("digest", path);
        throw error;
    }
}
function logicalRoot(value, role, programId) {
    if (value.kind === "program") {
        const rootProgramId = typedId(value.programId, "program", "$/logicalRoot/programId");
        if (role !== "controller" || rootProgramId !== programId) {
            failRecord("relation", "$/logicalRoot");
        }
        return Object.freeze({ kind: "program", programId: rootProgramId });
    }
    if (value.kind === "support-surface") {
        if (role !== "design" && role !== "test") {
            failRecord("relation", "$/logicalRoot");
        }
        return Object.freeze({
            kind: "support-surface",
            surfaceId: typedId(value.surfaceId, "surface", "$/logicalRoot/surfaceId"),
        });
    }
    if (role !== "product")
        failRecord("relation", "$/logicalRoot");
    return Object.freeze({
        kind: "repository",
        repositoryId: typedId(value.repositoryId, "repository", "$/logicalRoot/repositoryId"),
    });
}
function configuredPlacement(value, role) {
    if (value === ".") {
        if (role !== "controller")
            failRecord("relation", "$/configuredPlacement");
        return value;
    }
    if (role === "controller")
        failRecord("relation", "$/configuredPlacement");
    try {
        return parseWakeflowConfigPlacement(value, "$/configuredPlacement");
    }
    catch (error) {
        if (error instanceof WakeflowConfigError) {
            failRecord("placement", "$/configuredPlacement");
        }
        throw error;
    }
}
function unregisteredPreflight() {
    const reason = Object.freeze({
        code: "identity-unregistered",
        source: "identity",
    });
    const blockingReasons = Object.freeze([reason]);
    return Object.freeze({
        status: "blocked",
        blockingReasons,
    });
}
function rootObservation(root, placement) {
    const basis = {
        kind: "WakeflowWindowRuntimeRootObservation",
        schemaVersion: 1,
        logicalRoot: root,
        configuredPlacement: placement,
        status: "unobserved",
    };
    return Object.freeze({
        status: "unobserved",
        observationDigest: computeCanonicalJsonSha256Digest(basis),
    });
}
function projectionBasis(value) {
    return {
        kind: WAKEFLOW_WINDOW_RUNTIME_PROJECTION_KIND,
        schemaVersion: WAKEFLOW_WINDOW_RUNTIME_PROJECTION_VERSION,
        programId: value.programId,
        hostId: value.hostId,
        windowId: value.windowId,
        role: value.role,
        logicalRoot: value.logicalRoot,
        configuredPlacement: value.configuredPlacement,
        identity: value.identity,
        rootObservation: value.rootObservation,
        preflight: value.preflight,
        sourceFingerprints: value.sourceFingerprints,
    };
}
/** 对任意内存值执行 Schema、类型化关系和全部摘要准入。 */
export function parseWakeflowWindowRuntimeUnregisteredProjection(value) {
    let json;
    try {
        json = parseJsonValue(value, "$projection");
    }
    catch (error) {
        if (error instanceof JsonValueError)
            failRecord("input", error.path);
        throw error;
    }
    const validated = validateProjectionWire(json);
    if (!validated.ok)
        failRecord("schema", validated.path);
    const wire = validated.value;
    const programId = typedId(wire.programId, "program", "$/programId");
    const windowId = typedId(wire.windowId, "window", "$/windowId");
    const root = logicalRoot(wire.logicalRoot, wire.role, programId);
    const placement = configuredPlacement(wire.configuredPlacement, wire.role);
    const expectedObservation = rootObservation(root, placement);
    const actualObservationDigest = digest(wire.rootObservation.observationDigest, "$/rootObservation/observationDigest");
    const sourceFingerprints = Object.freeze({
        desiredTopologyDigest: digest(wire.sourceFingerprints.desiredTopologyDigest, "$/sourceFingerprints/desiredTopologyDigest"),
        windowTopologyDigest: digest(wire.sourceFingerprints.windowTopologyDigest, "$/sourceFingerprints/windowTopologyDigest"),
        rootObservationDigest: digest(wire.sourceFingerprints.rootObservationDigest, "$/sourceFingerprints/rootObservationDigest"),
    });
    const expectedWindowTopologyDigest = computeCanonicalJsonSha256Digest({
        windowId,
        role: wire.role,
        logicalRoot: root,
        configuredPlacement: placement,
    });
    if (actualObservationDigest !== expectedObservation.observationDigest
        || sourceFingerprints.rootObservationDigest
            !== expectedObservation.observationDigest
        || sourceFingerprints.windowTopologyDigest !== expectedWindowTopologyDigest) {
        failRecord("relation", "$/sourceFingerprints");
    }
    const normalized = {
        kind: WAKEFLOW_WINDOW_RUNTIME_PROJECTION_KIND,
        schemaVersion: WAKEFLOW_WINDOW_RUNTIME_PROJECTION_VERSION,
        programId,
        hostId: wire.hostId,
        windowId,
        role: wire.role,
        logicalRoot: root,
        configuredPlacement: placement,
        identity: Object.freeze({ status: "unregistered" }),
        rootObservation: expectedObservation,
        preflight: unregisteredPreflight(),
        sourceFingerprints,
    };
    const suppliedProjectionDigest = digest(wire.projectionDigest, "$/projectionDigest");
    const expectedProjectionDigest = computeCanonicalJsonSha256Digest(projectionBasis(normalized));
    if (suppliedProjectionDigest !== expectedProjectionDigest) {
        failRecord("digest", "$/projectionDigest");
    }
    return Object.freeze({
        ...projectionBasis(normalized),
        projectionDigest: expectedProjectionDigest,
    });
}
/** 解析确定性 JSON 文档并重验领域关系和自身摘要。 */
export function parseWakeflowWindowRuntimeUnregisteredProjectionDocument(text) {
    let value;
    try {
        value = parseDeterministicJsonDocument(text, "$windowRuntimeProjection");
    }
    catch (error) {
        if (error instanceof DeterministicJsonDocumentError) {
            failRecord("representation", error.path);
        }
        throw error;
    }
    const projection = parseWakeflowWindowRuntimeUnregisteredProjection(value);
    if (renderDeterministicJsonDocument(projection, "$windowRuntimeProjection")
        !== text) {
        failRecord("representation", "$windowRuntimeProjection");
    }
    return projection;
}
function projectionFor(programId, hostId, desiredTopologyDigest, window) {
    const observation = rootObservation(window.logicalRoot, window.configuredPlacement);
    const basis = {
        kind: WAKEFLOW_WINDOW_RUNTIME_PROJECTION_KIND,
        schemaVersion: WAKEFLOW_WINDOW_RUNTIME_PROJECTION_VERSION,
        programId,
        hostId,
        windowId: window.windowId,
        role: window.role,
        logicalRoot: window.logicalRoot,
        configuredPlacement: window.configuredPlacement,
        identity: Object.freeze({ status: "unregistered" }),
        rootObservation: observation,
        preflight: unregisteredPreflight(),
        sourceFingerprints: Object.freeze({
            desiredTopologyDigest,
            windowTopologyDigest: window.windowTopologyDigest,
            rootObservationDigest: observation.observationDigest,
        }),
    };
    const body = projectionBasis(basis);
    return parseWakeflowWindowRuntimeUnregisteredProjection({
        ...body,
        projectionDigest: computeCanonicalJsonSha256Digest(body),
    });
}
function entryFor(profileValue, projection) {
    const document = renderDeterministicJsonDocument(projection, "$windowRuntimeProjection");
    return Object.freeze({
        windowId: projection.windowId,
        resourceRef: wakeflowWindowRuntimeProjectionRef(profileValue, projection.windowId),
        projection,
        document,
        documentDigest: computeSha256Digest(encodeUtf8(document, "$windowRuntimeProjection")),
    });
}
/** 从同一 Config/Host 的 desired topology 与空 identity source 生成全部未注册投影。 */
export function compileWakeflowWindowRuntimeUnregisteredProjectionSet(configValue, profileValue) {
    let desired;
    try {
        desired = compileWakeflowWindowRuntimeDesiredTopology(configValue, profileValue);
    }
    catch (error) {
        if (error instanceof WakeflowWindowRuntimeDesiredTopologyError) {
            throw new WakeflowWindowRuntimeUnregisteredProjectionError(error.path);
        }
        throw error;
    }
    const projectionRootRef = wakeflowWindowRuntimeProjectionRootRef(profileValue);
    const entries = Object.freeze(desired.windows.map((window) => entryFor(profileValue, projectionFor(desired.programId, desired.hostId, desired.desiredTopologyDigest, window))));
    const basis = {
        kind: WAKEFLOW_WINDOW_RUNTIME_PROJECTION_SET_KIND,
        schemaVersion: 1,
        programId: desired.programId,
        hostId: desired.hostId,
        projectionRootRef,
        desiredTopologyDigest: desired.desiredTopologyDigest,
        entries: entries.map((entry) => ({
            windowId: entry.windowId,
            resourceRef: entry.resourceRef,
            projectionDigest: entry.projection.projectionDigest,
            documentDigest: entry.documentDigest,
        })),
    };
    return Object.freeze({
        ...basis,
        entries,
        projectionSetDigest: computeCanonicalJsonSha256Digest(basis),
    });
}
