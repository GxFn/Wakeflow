import { WAKEFLOW_SHA256_DIGEST_SCHEMA, } from "../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_WINDOW_RUNTIME_REGISTERED_PROJECTION_SCHEMA, } from "../../contracts/generated/workspace/window-runtime-registered-projection.generated.js";
import { WAKEFLOW_WINDOW_RUNTIME_UNREGISTERED_PROJECTION_SCHEMA, } from "../../contracts/generated/workspace/window-runtime-unregistered-projection.generated.js";
import { computeCanonicalJsonSha256Digest, } from "../../foundation/crypto/canonical-json-sha256.js";
import { computeSha256Digest, } from "../../foundation/crypto/sha256.js";
import { renderDeterministicJsonDocument, } from "../../foundation/data/deterministic-json-document.js";
import { parseJsonValue, } from "../../foundation/data/json-value.js";
import { createRuntimeJsonSchemaValidator, } from "../../foundation/schema/runtime-json-schema.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import { parseWakeflowWorkspaceHostResourceProfile, WakeflowWorkspaceHostResourceProfileError, } from "../workspace-host-resource-profile.js";
import { parseWakeflowWindowHostBinding, } from "./wakeflow-window-host-binding.js";
import { wakeflowWindowHostBindingRef, wakeflowWindowRuntimeProjectionRef, } from "./wakeflow-window-runtime-paths.js";
import { parseWakeflowWindowRuntimeUnregisteredProjection, WAKEFLOW_WINDOW_RUNTIME_PROJECTION_KIND, WAKEFLOW_WINDOW_RUNTIME_PROJECTION_VERSION, } from "./wakeflow-window-runtime-unregistered-projection.js";
const ERROR_MESSAGES = {
    input: "Window Runtime registered projection input is invalid.",
    schema: "Window Runtime registered projection does not satisfy its Schema.",
    source: "Window Runtime registered projection sources are inconsistent.",
};
/** Registered projection 编译或准入失败的稳定、脱敏错误。 */
export class WakeflowWindowRuntimeRegisteredProjectionError extends Error {
    name = "WakeflowWindowRuntimeRegisteredProjectionError";
    code = "wakeflow-window-runtime-registered-projection";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
const validateWire = createRuntimeJsonSchemaValidator(WAKEFLOW_WINDOW_RUNTIME_REGISTERED_PROJECTION_SCHEMA, [
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
    WAKEFLOW_WINDOW_RUNTIME_UNREGISTERED_PROJECTION_SCHEMA,
]);
function fail(reason, path) {
    throw new WakeflowWindowRuntimeRegisteredProjectionError(reason, path);
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
function assertSources(profile, source, binding) {
    if (!profile.surfaces.windowIdentity
        || profile.hostId !== source.hostId
        || source.programId !== binding.programId
        || source.hostId !== binding.hostId
        || source.windowId !== binding.windowId) {
        fail("source", "$sources");
    }
}
/** 从当前 topology 投影与私有 Binding 编译脱敏 registered 投影。 */
function compileWakeflowWindowRuntimeRegisteredProjection(profileValue, identityProfileValue, unregisteredValue, bindingValue) {
    let profile;
    let source;
    let binding;
    try {
        profile = parseWakeflowWorkspaceHostResourceProfile(profileValue);
        source = parseWakeflowWindowRuntimeUnregisteredProjection(unregisteredValue);
        binding = parseWakeflowWindowHostBinding(bindingValue, identityProfileValue);
    }
    catch (error) {
        if (error instanceof WakeflowWorkspaceHostResourceProfileError) {
            fail("input", "$profile");
        }
        fail("input", "$sources");
    }
    assertSources(profile, source, binding);
    const reason = Object.freeze({
        code: "root-unobserved",
        source: "root-observation",
    });
    const basis = {
        kind: WAKEFLOW_WINDOW_RUNTIME_PROJECTION_KIND,
        schemaVersion: WAKEFLOW_WINDOW_RUNTIME_PROJECTION_VERSION,
        programId: source.programId,
        hostId: source.hostId,
        windowId: source.windowId,
        role: source.role,
        logicalRoot: source.logicalRoot,
        configuredPlacement: source.configuredPlacement,
        identity: Object.freeze({
            status: "registered",
            bindingRef: wakeflowWindowHostBindingRef(profile, binding.windowId),
            bindingId: binding.bindingId,
        }),
        rootObservation: source.rootObservation,
        preflight: Object.freeze({
            status: "blocked",
            blockingReasons: Object.freeze([reason]),
        }),
        sourceFingerprints: Object.freeze({
            desiredTopologyDigest: source.sourceFingerprints.desiredTopologyDigest,
            windowTopologyDigest: source.sourceFingerprints.windowTopologyDigest,
            rootObservationDigest: source.sourceFingerprints.rootObservationDigest,
        }),
    };
    const projection = Object.freeze({
        ...projectionBasis(basis),
        projectionDigest: computeCanonicalJsonSha256Digest(projectionBasis(basis)),
    });
    const validated = validateWire(parseJsonValue(projection, "$projection"));
    if (!validated.ok)
        fail("schema", validated.path);
    return projection;
}
/** 编译一份带资源引用、确定性文档和物理字节摘要的 registered 投影目标。 */
export function compileWakeflowWindowRuntimeRegisteredProjectionEntry(profileValue, identityProfileValue, unregisteredValue, bindingValue) {
    const projection = compileWakeflowWindowRuntimeRegisteredProjection(profileValue, identityProfileValue, unregisteredValue, bindingValue);
    const document = renderDeterministicJsonDocument(projection, "$windowRuntimeProjection");
    return Object.freeze({
        windowId: projection.windowId,
        resourceRef: wakeflowWindowRuntimeProjectionRef(profileValue, projection.windowId),
        projection,
        document,
        documentDigest: computeSha256Digest(encodeUtf8(document, "$windowRuntimeProjection")),
    });
}
