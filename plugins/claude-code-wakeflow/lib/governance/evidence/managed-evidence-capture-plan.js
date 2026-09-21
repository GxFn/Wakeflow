import { parseWakeflowDurableIdOfKind, WakeflowDurableIdError, } from "../../contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { parseSha256Digest, Sha256Error, } from "../../foundation/crypto/sha256.js";
import { parsePlainRecord, PassiveOwnDataError, } from "../../foundation/data/passive-own-data.js";
import { parseDemandEventStreamRevision, DemandEventStreamPositionError, } from "../demand/event-sourcing/demand-event-stream-position.js";
import { parseManagedEvidenceManifest, ManagedEvidenceManifestError, } from "./managed-evidence-manifest.js";
/**
 * Wakeflow Governance / Evidence：零写capture结果的纯计划合同。
 *
 * Capture Planning Service负责读取Config、Demand与source；本模块只关闭它返回的
 * Config摘要、Event Sourcing追加预期和完整Manifest。`planDigest`证明调用方交回的
 * plan仍是同一份preview，不授予文件写入、Event追加或恢复能力。
 */
export const MANAGED_EVIDENCE_CAPTURE_PLAN_KIND = "WakeflowManagedEvidenceCapturePlan";
export const MANAGED_EVIDENCE_CAPTURE_PLAN_VERSION = 1;
const ERROR_MESSAGES = {
    input: "Managed evidence capture plan input is invalid.",
    identifier: "Managed evidence capture plan contains an invalid identity.",
    position: "Managed evidence capture plan contains an invalid stream position.",
    digest: "Managed evidence capture plan contains an invalid digest.",
    manifest: "Managed evidence capture plan contains an invalid Manifest.",
    relation: "Managed evidence capture plan fields do not describe one preview.",
};
/** Capture plan无法形成单一零写preview时的稳定错误。 */
export class ManagedEvidenceCapturePlanError extends Error {
    name = "ManagedEvidenceCapturePlanError";
    code = "wakeflow-managed-evidence-capture-plan";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
const CREATE_FIELDS = Object.freeze([
    "configDigest",
    "expectedDemand",
    "manifest",
]);
const PLAN_FIELDS = Object.freeze([
    "configDigest",
    "expectedDemand",
    "kind",
    "manifest",
    "planDigest",
    "schemaVersion",
]);
const EXPECTATION_FIELDS = Object.freeze([
    "lastEventDigest",
    "lastEventId",
    "stateDigest",
    "streamRevision",
]);
function fail(reason, path) {
    throw new ManagedEvidenceCapturePlanError(reason, path);
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
    const actual = Object.keys(record).sort();
    const expected = [...fields].sort();
    if (actual.length !== expected.length ||
        actual.some((key, index) => key !== expected[index])) {
        fail("input", path);
    }
    return record;
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
function parseLastEventId(value) {
    try {
        return parseWakeflowDurableIdOfKind(value, "demand-event", "$/expectedDemand/lastEventId");
    }
    catch (error) {
        if (error instanceof WakeflowDurableIdError) {
            fail("identifier", "$/expectedDemand/lastEventId");
        }
        throw error;
    }
}
function parseExpectation(value) {
    const record = exactRecord(value, EXPECTATION_FIELDS, "$/expectedDemand");
    let streamRevision;
    try {
        streamRevision = parseDemandEventStreamRevision(record.streamRevision, "$/expectedDemand/streamRevision");
    }
    catch (error) {
        if (error instanceof DemandEventStreamPositionError) {
            fail("position", "$/expectedDemand/streamRevision");
        }
        throw error;
    }
    return Object.freeze({
        streamRevision,
        stateDigest: parseDigest(record.stateDigest, "$/expectedDemand/stateDigest"),
        lastEventId: parseLastEventId(record.lastEventId),
        lastEventDigest: parseDigest(record.lastEventDigest, "$/expectedDemand/lastEventDigest"),
    });
}
function parseManifest(value) {
    try {
        return parseManagedEvidenceManifest(value);
    }
    catch (error) {
        if (error instanceof ManagedEvidenceManifestError) {
            fail("manifest", "$/manifest");
        }
        throw error;
    }
}
function buildBasis(configDigestValue, expectationValue, manifestValue) {
    const configDigest = parseDigest(configDigestValue, "$/configDigest");
    const expectedDemand = parseExpectation(expectationValue);
    const manifest = parseManifest(manifestValue);
    if (configDigest !== manifest.recordedBy.configDigest) {
        fail("relation", "$/configDigest");
    }
    return Object.freeze({
        kind: MANAGED_EVIDENCE_CAPTURE_PLAN_KIND,
        schemaVersion: MANAGED_EVIDENCE_CAPTURE_PLAN_VERSION,
        configDigest,
        expectedDemand,
        manifest,
    });
}
/** 从Planning已确认的三个事实生成确定性capture plan。 */
export function createManagedEvidenceCapturePlan(value) {
    const record = exactRecord(value, CREATE_FIELDS, "$input");
    const basis = buildBasis(record.configDigest, record.expectedDemand, record.manifest);
    return Object.freeze({
        ...basis,
        planDigest: computeCanonicalJsonSha256Digest(basis, "$plan"),
    });
}
/** 重新解析并验证调用方交回的完整零写capture plan。 */
export function parseManagedEvidenceCapturePlan(value) {
    const record = exactRecord(value, PLAN_FIELDS, "$plan");
    if (record.kind !== MANAGED_EVIDENCE_CAPTURE_PLAN_KIND ||
        record.schemaVersion !== MANAGED_EVIDENCE_CAPTURE_PLAN_VERSION) {
        fail("input", "$plan");
    }
    const basis = buildBasis(record.configDigest, record.expectedDemand, record.manifest);
    const planDigest = parseDigest(record.planDigest, "$/planDigest");
    if (planDigest !== computeCanonicalJsonSha256Digest(basis, "$plan")) {
        fail("relation", "$/planDigest");
    }
    return Object.freeze({ ...basis, planDigest });
}
export function computeManagedEvidenceCapturePlanDigest(value) {
    return parseManagedEvidenceCapturePlan(value).planDigest;
}
