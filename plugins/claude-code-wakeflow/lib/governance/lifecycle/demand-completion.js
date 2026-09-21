import { WAKEFLOW_DEMAND_COMPLETION_SCHEMA } from "../../contracts/generated/governance/lifecycle/demand-completion.generated.js";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../contracts/generated/foundation/utc-instant.generated.js";
import { parseWakeflowDurableIdOfKind, WakeflowDurableIdError, } from "../../contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { parseSha256Digest, Sha256Error, } from "../../foundation/crypto/sha256.js";
import { JsonValueError, parseJsonValue, } from "../../foundation/data/json-value.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import { parseUtcInstant, UtcInstantError, } from "../../foundation/time/utc-instant.js";
import { readUtcWallClock, UtcWallClockError, } from "../../foundation/time/wall-clock.js";
import { parseRequirementLineageReference, RequirementLineageError, } from "../demand/model/requirement-lineage.js";
/**
 * Wakeflow Governance / Lifecycle：Demand成功终态的不可变事件载荷。
 *
 * Completion绑定Controller、冻结Authority、testing mode、post-acceptance route、Review
 * Snapshot、Event Stream和已认领的需求包来源。它不删除Test lineage，也不执行看板归档、
 * BusinessArchive或宿主关闭。
 */
const COMPLETION_KIND = "WakeflowDemandCompletion";
const COMPLETION_SCHEMA_VERSION = 1;
const ERROR_MESSAGES = {
    json: "Demand Completion is not passive JSON data.",
    schema: "Demand Completion does not satisfy its Schema.",
    identifier: "Demand Completion contains an invalid typed identity.",
    digest: "Demand Completion contains an invalid or inconsistent digest.",
    path: "Demand Completion contains an invalid requirement package reference.",
    position: "Demand Completion contains an invalid revision.",
    time: "Demand Completion contains an invalid completion time.",
    route: "Demand Completion requires a valid completion-preflight route.",
    package: "Demand Completion requirement package source is invalid.",
    relation: "Demand Completion sources are inconsistent.",
};
/** Demand成功终态记录准入、创建或来源闭合失败时的稳定错误。 */
export class DemandCompletionError extends Error {
    name = "DemandCompletionError";
    code = "wakeflow-demand-completion";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
const validateWire = createRuntimeJsonSchemaValidator(WAKEFLOW_DEMAND_COMPLETION_SCHEMA, [
    WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
    WAKEFLOW_UTC_INSTANT_SCHEMA,
]);
function fail(reason, path) {
    throw new DemandCompletionError(reason, path);
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
function completionBasis(value) {
    return {
        kind: COMPLETION_KIND,
        schemaVersion: COMPLETION_SCHEMA_VERSION,
        programId: value.programId,
        demandId: value.demandId,
        controllerWindowId: value.controllerWindowId,
        authorityDigest: value.authorityDigest,
        testingMode: value.testingMode,
        postAcceptanceRouteDigest: value.postAcceptanceRouteDigest,
        reviewSnapshotDigest: value.reviewSnapshotDigest,
        observedState: value.observedState,
        packageSource: value.packageSource,
        completedAt: value.completedAt,
    };
}
/** 严格解析并复验self-excluding digest的Demand Completion。 */
export function parseDemandCompletion(value) {
    let json;
    try {
        json = parseJsonValue(value, "$completion");
    }
    catch (error) {
        if (error instanceof JsonValueError)
            fail("json", error.path);
        throw error;
    }
    const validated = validateWire(json);
    if (!validated.ok)
        fail("schema", validated.path);
    const wire = validated.value;
    let lineage;
    try {
        lineage = parseRequirementLineageReference({
            artifactKind: "wakeflow-requirement-lineage",
            schemaVersion: 1,
            requirementId: wire.packageSource.requirementId,
            recordRef: wire.packageSource.recordRef,
            recordDigest: wire.packageSource.recordDigest,
        });
    }
    catch (error) {
        if (error instanceof RequirementLineageError) {
            fail(error.reason === "path" ? "path" : "package", `$/packageSource${error.path.slice(1)}`);
        }
        throw error;
    }
    if (!Number.isSafeInteger(wire.observedState.streamRevision) ||
        wire.observedState.streamRevision < 1 ||
        !Number.isSafeInteger(wire.packageSource.claimStateRevision) ||
        wire.packageSource.claimStateRevision < 2) {
        fail("position", "$completion");
    }
    let completedAt;
    try {
        completedAt = parseUtcInstant(wire.completedAt, "$/completedAt");
    }
    catch (error) {
        if (error instanceof UtcInstantError)
            fail("time", "$/completedAt");
        throw error;
    }
    const basis = completionBasis({
        kind: COMPLETION_KIND,
        schemaVersion: COMPLETION_SCHEMA_VERSION,
        programId: id(wire.programId, "program", "$/programId"),
        demandId: id(wire.demandId, "demand", "$/demandId"),
        controllerWindowId: id(wire.controllerWindowId, "window", "$/controllerWindowId"),
        authorityDigest: digest(wire.authorityDigest, "$/authorityDigest"),
        testingMode: wire.testingMode,
        postAcceptanceRouteDigest: digest(wire.postAcceptanceRouteDigest, "$/postAcceptanceRouteDigest"),
        reviewSnapshotDigest: digest(wire.reviewSnapshotDigest, "$/reviewSnapshotDigest"),
        observedState: Object.freeze({
            streamRevision: wire.observedState.streamRevision,
            stateDigest: digest(wire.observedState.stateDigest, "$/observedState/stateDigest"),
            lastEventId: id(wire.observedState.lastEventId, "demand-event", "$/observedState/lastEventId"),
            lastEventDigest: digest(wire.observedState.lastEventDigest, "$/observedState/lastEventDigest"),
        }),
        packageSource: Object.freeze({
            requirementId: lineage.requirementId,
            recordRef: lineage.recordRef,
            recordDigest: lineage.recordDigest,
            claimStateRevision: wire.packageSource.claimStateRevision,
            claimStateDigest: digest(wire.packageSource.claimStateDigest, "$/packageSource/claimStateDigest"),
        }),
        completedAt,
    });
    const completionDigest = digest(wire.completionDigest, "$/completionDigest");
    if (computeCanonicalJsonSha256Digest(basis) !== completionDigest) {
        fail("digest", "$/completionDigest");
    }
    return Object.freeze({ ...basis, completionDigest });
}
/** 从completion-preflight route和精确claimed需求包来源创建成功终态记录。 */
export function createDemandCompletion(input, options = {}) {
    if (input.routeSource.status !== "completion-preflight") {
        fail("route", "$routeSource");
    }
    let completedAt;
    try {
        completedAt =
            options.clock === undefined
                ? readUtcWallClock()
                : readUtcWallClock(options.clock);
    }
    catch (error) {
        if (error instanceof UtcWallClockError)
            fail("time", "$clock");
        throw error;
    }
    const basis = completionBasis({
        kind: COMPLETION_KIND,
        schemaVersion: COMPLETION_SCHEMA_VERSION,
        programId: input.routeSource.programId,
        demandId: input.routeSource.demandId,
        controllerWindowId: input.controllerWindowId,
        authorityDigest: input.routeSource.authorityDigest,
        testingMode: input.routeSource.testingClosure.mode,
        postAcceptanceRouteDigest: input.routeSource.routeDigest,
        reviewSnapshotDigest: input.routeSource.reviewSnapshotDigest,
        observedState: input.routeSource.observedState,
        packageSource: input.packageSource,
        completedAt,
    });
    return parseDemandCompletion({
        ...basis,
        completionDigest: computeCanonicalJsonSha256Digest(basis),
    });
}
export function computeDemandCompletionDigest(value) {
    return parseDemandCompletion(value).completionDigest;
}
