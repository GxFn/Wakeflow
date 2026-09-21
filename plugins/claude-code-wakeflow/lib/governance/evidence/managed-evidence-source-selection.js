import { parseWakeflowDurableIdOfKind, WakeflowDurableIdError, } from "../../contracts/identity/wakeflow-durable-id.js";
import { isEvidenceKind } from "../../contracts/vocabulary/evidence-kinds.js";
import { isWakeflowHostId, } from "../../contracts/vocabulary/wakeflow-host-id.js";
import { parseSha256Digest, Sha256Error } from "../../foundation/crypto/sha256.js";
import { parsePlainRecord, PassiveOwnDataError } from "../../foundation/data/passive-own-data.js";
import { parsePortableResourcePath, PortableResourcePathError, } from "../../foundation/filesystem/portable-resource-path.js";
import { parseUtcInstant, UtcInstantError, } from "../../foundation/time/utc-instant.js";
import { HOST_HOOK_EVENTS } from "../../kernel/hook-observations.js";
const ERROR_MESSAGES = {
    input: "Managed evidence source selection input is invalid.",
    identifier: "Managed evidence source selection contains an invalid typed identity.",
    path: "Managed evidence source selection contains an invalid portable path.",
    kind: "Managed evidence kind does not match its source.",
    source: "Managed evidence source selection must identify one admitted source.",
    record: "Managed evidence observation source contains an invalid record projection.",
    url: "Managed evidence link source must be one https URL without credentials.",
    commit: "Managed evidence commit source contains an invalid object id.",
    digest: "Managed evidence source contains an invalid digest.",
    time: "Managed evidence source contains an invalid time.",
    "content-review": "Managed evidence source selection content review policy is invalid.",
};
export class ManagedEvidenceSourceSelectionError extends Error {
    name = "ManagedEvidenceSourceSelectionError";
    code = "wakeflow-managed-evidence-source-selection";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
const SELECTION_FIELDS = Object.freeze(["contentReview", "kind", "source"]);
const MANAGED_PATH_FIELDS = Object.freeze(["kind", "path", "resourceType", "root"]);
const OBSERVATION_SELECTION_FIELDS = Object.freeze(["hostId", "kind", "recordId"]);
const OBSERVATION_SOURCE_FIELDS = Object.freeze([
    "event",
    "hostId",
    "kind",
    "lastAssistantMessageDigest",
    "promptDigest",
    "recordDigest",
    "recordId",
    "recordedAt",
    "transcript",
    "turnId",
]);
const LINK_SELECTION_FIELDS = Object.freeze(["kind", "url"]);
const LINK_SOURCE_FIELDS = Object.freeze(["digest", "kind", "url"]);
const COMMIT_FIELDS = Object.freeze(["commitOid", "kind", "repositoryId"]);
const REPOSITORY_ROOT_FIELDS = Object.freeze(["kind", "repositoryId"]);
const SUPPORT_ROOT_FIELDS = Object.freeze(["kind", "surfaceId"]);
const POD_WORKTREE_ROOT_FIELDS = Object.freeze(["kind", "podId", "repositoryId"]);
const RECORD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TURN_ID_PATTERN = /^[A-Za-z0-9._:-]{1,256}$/u;
const COMMIT_OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const URL_MAXIMUM_LENGTH = 2048;
const RESERVED_SOURCE_ROOT_SEGMENTS = new Set([".git", ".wakeflow-active", ".wakeflow-local"]);
/** 种类与来源的固定关系：`transcript` 只能引用带 transcript 的 hook 记录（Q3）。 */
const KINDS_BY_SOURCE = Object.freeze({
    "managed-path": Object.freeze(["test-output", "diff", "document"]),
    observation: Object.freeze(["hook-observation", "transcript"]),
    link: Object.freeze(["link"]),
    commit: Object.freeze(["commit"]),
});
function fail(reason, path) {
    throw new ManagedEvidenceSourceSelectionError(reason, path);
}
function compareText(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
function exactRecord(value, fields, path, reason) {
    let record;
    try {
        record = parsePlainRecord(value, path);
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail(reason, path);
        throw error;
    }
    const keys = Object.keys(record).sort(compareText);
    if (keys.length !== fields.length || keys.some((key, index) => key !== fields[index])) {
        fail(reason, path);
    }
    return record;
}
function parseId(value, kind, path) {
    try {
        return parseWakeflowDurableIdOfKind(value, kind, path);
    }
    catch (error) {
        if (error instanceof WakeflowDurableIdError)
            fail("identifier", path);
        throw error;
    }
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
function parseNullableDigest(value, path) {
    return value === null ? null : parseDigest(value, path);
}
function parseSourceRoot(value, path) {
    let base;
    try {
        base = parsePlainRecord(value, path);
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("source", path);
        throw error;
    }
    if (base.kind === "repository") {
        const record = exactRecord(base, REPOSITORY_ROOT_FIELDS, path, "source");
        return Object.freeze({
            kind: "repository",
            repositoryId: parseId(record.repositoryId, "repository", `${path}/repositoryId`),
        });
    }
    if (base.kind === "support-surface") {
        const record = exactRecord(base, SUPPORT_ROOT_FIELDS, path, "source");
        return Object.freeze({
            kind: "support-surface",
            surfaceId: parseId(record.surfaceId, "surface", `${path}/surfaceId`),
        });
    }
    if (base.kind === "pod-worktree") {
        const record = exactRecord(base, POD_WORKTREE_ROOT_FIELDS, path, "source");
        return Object.freeze({
            kind: "pod-worktree",
            podId: parseId(record.podId, "pod", `${path}/podId`),
            repositoryId: parseId(record.repositoryId, "repository", `${path}/repositoryId`),
        });
    }
    fail("source", `${path}/kind`);
}
function parseManagedPath(value, path) {
    const record = exactRecord(value, MANAGED_PATH_FIELDS, path, "source");
    let resourcePath;
    try {
        resourcePath = parsePortableResourcePath(record.path, `${path}/path`);
    }
    catch (error) {
        if (error instanceof PortableResourcePathError)
            fail("path", `${path}/path`);
        throw error;
    }
    const firstSegment = resourcePath.split("/", 1)[0]?.toLowerCase();
    if (firstSegment !== undefined && RESERVED_SOURCE_ROOT_SEGMENTS.has(firstSegment)) {
        fail("path", `${path}/path`);
    }
    if (record.resourceType !== "file" && record.resourceType !== "tree") {
        fail("source", `${path}/resourceType`);
    }
    return Object.freeze({
        kind: "managed-path",
        root: parseSourceRoot(record.root, `${path}/root`),
        path: resourcePath,
        resourceType: record.resourceType,
    });
}
function parseHostId(value, path) {
    if (!isWakeflowHostId(value))
        fail("source", path);
    return value;
}
function parseRecordId(value, path) {
    if (typeof value !== "string" || !RECORD_ID_PATTERN.test(value))
        fail("record", path);
    return value;
}
function parseObservationSelection(value, path) {
    const record = exactRecord(value, OBSERVATION_SELECTION_FIELDS, path, "source");
    return Object.freeze({
        kind: "observation",
        hostId: parseHostId(record.hostId, `${path}/hostId`),
        recordId: parseRecordId(record.recordId, `${path}/recordId`),
    });
}
function parseHookEvent(value, path) {
    if (typeof value !== "string" || !HOST_HOOK_EVENTS.includes(value)) {
        fail("record", path);
    }
    return value;
}
function parseObservationSource(value, path) {
    const record = exactRecord(value, OBSERVATION_SOURCE_FIELDS, path, "record");
    let recordedAt;
    try {
        recordedAt = parseUtcInstant(record.recordedAt, `${path}/recordedAt`);
    }
    catch (error) {
        if (error instanceof UtcInstantError)
            fail("time", `${path}/recordedAt`);
        throw error;
    }
    if (record.turnId !== null &&
        (typeof record.turnId !== "string" || !TURN_ID_PATTERN.test(record.turnId))) {
        fail("record", `${path}/turnId`);
    }
    if (record.transcript !== "present" && record.transcript !== "absent") {
        fail("record", `${path}/transcript`);
    }
    return Object.freeze({
        kind: "observation",
        hostId: parseHostId(record.hostId, `${path}/hostId`),
        recordId: parseRecordId(record.recordId, `${path}/recordId`),
        event: parseHookEvent(record.event, `${path}/event`),
        recordedAt,
        turnId: record.turnId,
        promptDigest: parseNullableDigest(record.promptDigest, `${path}/promptDigest`),
        lastAssistantMessageDigest: parseNullableDigest(record.lastAssistantMessageDigest, `${path}/lastAssistantMessageDigest`),
        transcript: record.transcript,
        recordDigest: parseDigest(record.recordDigest, `${path}/recordDigest`),
    });
}
/** 只接受不带凭证、不含空白与引号的 https URL；不做规范化，记录调用方给出的原文。 */
export function parseManagedEvidenceLinkUrl(value, path = "$/source/url") {
    if (typeof value !== "string" ||
        value.length === 0 ||
        value.length > URL_MAXIMUM_LENGTH ||
        /[\s"'`<>]/u.test(value)) {
        fail("url", path);
    }
    let url;
    try {
        url = new URL(value);
    }
    catch {
        fail("url", path);
    }
    if (url.protocol !== "https:" ||
        url.username !== "" ||
        url.password !== "" ||
        url.hostname.length === 0) {
        fail("url", path);
    }
    return value;
}
function parseLink(value, path, fields) {
    const record = exactRecord(value, fields, path, "source");
    return Object.freeze({
        kind: "link",
        url: parseManagedEvidenceLinkUrl(record.url, `${path}/url`),
        digest: Object.hasOwn(record, "digest")
            ? parseNullableDigest(record.digest, `${path}/digest`)
            : null,
    });
}
function parseCommit(value, path) {
    const record = exactRecord(value, COMMIT_FIELDS, path, "source");
    if (typeof record.commitOid !== "string" || !COMMIT_OID_PATTERN.test(record.commitOid)) {
        fail("commit", `${path}/commitOid`);
    }
    return Object.freeze({
        kind: "commit",
        repositoryId: parseId(record.repositoryId, "repository", `${path}/repositoryId`),
        commitOid: record.commitOid,
    });
}
function sourceKindOf(value, path) {
    let base;
    try {
        base = parsePlainRecord(value, path);
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("source", path);
        throw error;
    }
    if (typeof base.kind !== "string")
        fail("source", `${path}/kind`);
    return base.kind;
}
/** 解析调用方选择里的来源：observation 只带记录身份，link 的摘要可省略。 */
export function parseManagedEvidenceSelectionSource(value, path = "$/source") {
    switch (sourceKindOf(value, path)) {
        case "managed-path":
            return parseManagedPath(value, path);
        case "observation":
            return parseObservationSelection(value, path);
        case "link": {
            const kind = Object.hasOwn(value, "digest")
                ? LINK_SOURCE_FIELDS
                : LINK_SELECTION_FIELDS;
            return parseLink(value, path, kind);
        }
        case "commit":
            return parseCommit(value, path);
        default:
            fail("source", `${path}/kind`);
    }
}
/** 解析 Manifest 与规划共用的来源投影：observation 带完整脱敏字段，link 的摘要必须显式。 */
export function parseManagedEvidenceSourceDescriptor(value, path = "$/source") {
    switch (sourceKindOf(value, path)) {
        case "managed-path":
            return parseManagedPath(value, path);
        case "observation":
            return parseObservationSource(value, path);
        case "link":
            return parseLink(value, path, LINK_SOURCE_FIELDS);
        case "commit":
            return parseCommit(value, path);
        default:
            fail("source", `${path}/kind`);
    }
}
/** 种类必须属于来源允许的集合；`transcript` 还要求记录带 transcript。 */
export function assertManagedEvidenceKindMatchesSource(kind, source, path = "$/kind") {
    if (!KINDS_BY_SOURCE[source.kind].includes(kind))
        fail("kind", path);
    if (kind === "transcript" &&
        source.kind === "observation" &&
        "transcript" in source &&
        source.transcript !== "present") {
        fail("kind", path);
    }
}
/** 解析公共层之下仍只包含调用方意图的证据选择。 */
export function parseManagedEvidenceSourceSelection(value) {
    const record = exactRecord(value, SELECTION_FIELDS, "$selection", "input");
    if (!isEvidenceKind(record.kind))
        fail("kind", "$/kind");
    if (record.contentReview !== "reject" && record.contentReview !== "controller-confirmed") {
        fail("content-review", "$/contentReview");
    }
    const source = parseManagedEvidenceSelectionSource(record.source);
    assertManagedEvidenceKindMatchesSource(record.kind, source);
    return Object.freeze({ kind: record.kind, source, contentReview: record.contentReview });
}
function sourceRootKey(root) {
    switch (root.kind) {
        case "repository":
            return `repository:${root.repositoryId}`;
        case "support-surface":
            return `support-surface:${root.surfaceId}`;
        case "pod-worktree":
            return `pod-worktree:${root.podId}:${root.repositoryId}`;
        default: {
            const exhaustive = root;
            return exhaustive;
        }
    }
}
/** 来源的稳定键：同一 Demand 里同键同内容的记录只有一份（切片 8 D1）。 */
export function managedEvidenceSourceKey(source) {
    switch (source.kind) {
        case "managed-path":
            return `managed-path:${sourceRootKey(source.root)}:${source.resourceType}:${source.path}`;
        case "observation":
            return `observation:${source.hostId}:${source.recordId}`;
        case "link":
            return `link:${source.url}`;
        case "commit":
            return `commit:${source.repositoryId}:${source.commitOid}`;
        default: {
            const exhaustive = source;
            return exhaustive;
        }
    }
}
