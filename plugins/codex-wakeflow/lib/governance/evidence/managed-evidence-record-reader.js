import { types } from "node:util";
import { parseWakeflowDurableIdOfKind, WakeflowDurableIdError, } from "../../contracts/identity/wakeflow-durable-id.js";
import { DeterministicJsonDocumentError } from "../../foundation/data/deterministic-json-document.js";
import { parsePlainRecord, PassiveOwnDataError, } from "../../foundation/data/passive-own-data.js";
import { inspectDirectoryTreeCandidate, DurableDirectoryTreeCandidateError, } from "../../foundation/filesystem/durable-directory-tree-candidate.js";
import { readDeterministicJsonFile } from "../../foundation/filesystem/deterministic-json-file.js";
import { sameFileNodeSnapshot, FileNodeSnapshotError, } from "../../foundation/filesystem/file-node-snapshot.js";
import { joinPortableResourcePath, parsePortableResourcePath, PortableResourcePathError, } from "../../foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import { readStableResourceDirectory, StableDirectoryReadError, } from "../../foundation/filesystem/stable-directory-read.js";
import { readStableFile, StableFileReadError, } from "../../foundation/filesystem/stable-file-read.js";
import { StrictTextFileError } from "../../foundation/filesystem/strict-text-file.js";
import { ByteCountError, parseByteCount, } from "../../foundation/numeric/byte-count.js";
import { MANAGED_EVIDENCE_MANIFEST_MAXIMUM_BYTES, parseManagedEvidenceManifestDocument, ManagedEvidenceManifestError, } from "./managed-evidence-manifest.js";
import { MANAGED_EVIDENCE_RECORD_DIRECTORY_MODE, MANAGED_EVIDENCE_RECORD_EXECUTABLE_FILE_MODE, MANAGED_EVIDENCE_RECORD_FILE_MODE, planManagedEvidenceRecordTree, ManagedEvidenceRecordTreePlanError, } from "./managed-evidence-record-tree-plan.js";
import { managedEvidenceRecordAddress, MANAGED_EVIDENCE_MANIFEST_FILE_NAME, MANAGED_EVIDENCE_PAYLOAD_DIRECTORY_NAME, ManagedEvidenceResourcePathError, } from "./managed-evidence-resource-paths.js";
/**
 * Wakeflow Governance / Evidence：一份immutable final record的按需物理读取。
 *
 * Metadata读取只关闭record顶层与确定性Manifest，不散列全部payload。成员读取按
 * Manifest声明的路径、长度、SHA-256和mode验证一个完整文件；整树验证才遍历并散列
 * 全部payload。Manifest v1没有分块摘要，因此本模块不提供会伪装成独立可验证内容的
 * byte-range读取。
 *
 * 本模块不判断Demand Event selector、Program/Authority关系、调用面隐私或内容真实
 * 性；上层Reading Service必须先取得健康Demand Authority，再使用本模块签发的记录
 * capability。
 */
const MANIFEST_MAXIMUM_BYTES = parseByteCount(MANAGED_EVIDENCE_MANIFEST_MAXIMUM_BYTES);
const ERROR_MESSAGES = {
    input: "Managed evidence record reader input is invalid.",
    "root-scope": "Managed evidence record reader escaped its Demand root.",
    "not-found": "Managed evidence final record does not exist.",
    "node-policy": "Managed evidence final record violates its private node policy.",
    record: "Managed evidence final record structure is invalid.",
    manifest: "Managed evidence final record Manifest is invalid.",
    "member-not-found": "Managed evidence payload member is not declared.",
    capacity: "Managed evidence payload member exceeds the admitted read capacity.",
    "content-mismatch": "Managed evidence payload bytes differ from their Manifest descriptor.",
    "source-changed": "Managed evidence final record changed during reading.",
    aborted: "Managed evidence record reading was aborted.",
    "operation-failure": "Managed evidence final record could not be read safely.",
};
/** 单记录Manifest、成员或整树读取无法稳定证明时的脱敏错误。 */
export class ManagedEvidenceRecordReaderError extends Error {
    name = "ManagedEvidenceRecordReaderError";
    code = "wakeflow-managed-evidence-record-reader";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
const ISSUED_RECORDS = new WeakSet();
function fail(reason, path) {
    throw new ManagedEvidenceRecordReaderError(reason, path);
}
function assertRoot(value) {
    if (typeof value !== "object" ||
        value === null ||
        types.isProxy(value) ||
        !(value instanceof RootedDirectory)) {
        fail("input", "$root");
    }
}
function parseSignal(value, path) {
    if (value !== undefined &&
        (typeof value !== "object" ||
            value === null ||
            types.isProxy(value) ||
            !(value instanceof AbortSignal))) {
        fail("input", path);
    }
    return value;
}
function parseExpectedNode(value) {
    if (value === undefined)
        return undefined;
    if (typeof value !== "object" ||
        value === null ||
        types.isProxy(value) ||
        !Object.isFrozen(value)) {
        fail("input", "$/expectedRootNode");
    }
    try {
        sameFileNodeSnapshot(value, value);
    }
    catch (error) {
        if (error instanceof FileNodeSnapshotError) {
            fail("input", "$/expectedRootNode");
        }
        throw error;
    }
    return value;
}
function parseLoadOptions(value) {
    let record;
    try {
        record = parsePlainRecord(value === undefined ? {} : value, "$options");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", "$options");
        throw error;
    }
    if (Object.keys(record).some((key) => key !== "expectedRootNode" && key !== "signal")) {
        fail("input", "$options");
    }
    return Object.freeze({
        expectedRootNode: parseExpectedNode(record.expectedRootNode),
        signal: parseSignal(record.signal, "$/signal"),
    });
}
function parseMemberOptions(value) {
    let record;
    try {
        record = parsePlainRecord(value, "$options");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", "$options");
        throw error;
    }
    if (!Object.hasOwn(record, "maximumBytes") ||
        Object.keys(record).some((key) => key !== "maximumBytes" && key !== "signal")) {
        fail("input", "$options");
    }
    let maximumBytes;
    try {
        maximumBytes = parseByteCount(record.maximumBytes, "$/maximumBytes");
    }
    catch (error) {
        if (error instanceof ByteCountError)
            fail("input", "$/maximumBytes");
        throw error;
    }
    return Object.freeze({
        maximumBytes,
        signal: parseSignal(record.signal, "$/signal"),
    });
}
function parseVerifyOptions(value) {
    let record;
    try {
        record = parsePlainRecord(value === undefined ? {} : value, "$options");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", "$options");
        throw error;
    }
    if (Object.keys(record).some((key) => key !== "signal")) {
        fail("input", "$options");
    }
    return Object.freeze({
        signal: parseSignal(record.signal, "$/signal"),
    });
}
function parseEvidenceId(value) {
    try {
        return parseWakeflowDurableIdOfKind(value, "evidence", "$evidenceId");
    }
    catch (error) {
        if (error instanceof WakeflowDurableIdError)
            fail("input", "$evidenceId");
        throw error;
    }
}
function parseMemberRef(value) {
    try {
        return parsePortableResourcePath(value, "$memberRef");
    }
    catch (error) {
        if (error instanceof PortableResourcePathError) {
            fail("input", "$memberRef");
        }
        throw error;
    }
}
function currentUserId() {
    if (typeof process.geteuid !== "function")
        return null;
    try {
        return BigInt(process.geteuid());
    }
    catch {
        fail("operation-failure", "$user");
    }
}
function assertPrivateDirectory(node, path) {
    const userId = currentUserId();
    if (node.kind !== "directory" ||
        node.permissionBits !== MANAGED_EVIDENCE_RECORD_DIRECTORY_MODE ||
        (userId !== null && node.userId !== userId)) {
        fail("node-policy", path);
    }
}
function assertPrivateFile(node, mode, path) {
    const userId = currentUserId();
    if (node.kind !== "file" ||
        node.permissionBits !== mode ||
        node.linkCount !== 1n ||
        (userId !== null && node.userId !== userId)) {
        fail("node-policy", path);
    }
}
function mapDirectoryError(error) {
    if (error.reason === "aborted")
        fail("aborted", "$signal");
    if (error.reason === "root-scope")
        fail("root-scope", "$root");
    if (error.reason === "not-found")
        fail("not-found", "$record");
    if (error.reason === "source-changed" ||
        error.reason === "expectation-changed") {
        fail("source-changed", "$record");
    }
    if (error.reason === "symlink" ||
        error.reason === "not-directory" ||
        error.reason === "too-many-entries") {
        fail("record", "$record");
    }
    fail("operation-failure", "$record");
}
async function readRecordRoot(root, recordRootRef, expectedNode, signal) {
    try {
        return await readStableResourceDirectory(root, recordRootRef, {
            maximumEntries: 2,
            ...(expectedNode === undefined ? {} : { expectedNode }),
            ...(signal === undefined ? {} : { signal }),
        });
    }
    catch (error) {
        if (error instanceof StableDirectoryReadError)
            mapDirectoryError(error);
        throw error;
    }
}
function exactRecordRoot(read) {
    const manifest = read.entries[0];
    const payload = read.entries[1];
    if (read.entries.length !== 2 ||
        manifest?.name !== MANAGED_EVIDENCE_MANIFEST_FILE_NAME ||
        payload?.name !== MANAGED_EVIDENCE_PAYLOAD_DIRECTORY_NAME) {
        fail("record", "$record");
    }
    assertPrivateDirectory(read.directoryNode, "$record");
    assertPrivateFile(manifest.node, MANAGED_EVIDENCE_RECORD_FILE_MODE, "$record/manifest");
    assertPrivateDirectory(payload.node, "$record/payload");
    return Object.freeze({
        manifestNode: manifest.node,
        payloadNode: payload.node,
    });
}
function sameDirectoryRead(left, right) {
    return (sameFileNodeSnapshot(left.directoryNode, right.directoryNode) &&
        left.entries.length === right.entries.length &&
        left.entries.every((entry, index) => {
            const other = right.entries[index];
            return (other !== undefined &&
                entry.name === other.name &&
                sameFileNodeSnapshot(entry.node, other.node));
        }));
}
function mapManifestReadError(error) {
    if (error instanceof StableFileReadError) {
        if (error.reason === "aborted")
            fail("aborted", "$signal");
        if (error.reason === "root-scope")
            fail("root-scope", "$root");
        if (error.reason === "source-changed" ||
            error.reason === "expectation-changed") {
            fail("source-changed", "$record/manifest");
        }
        fail("manifest", "$record/manifest");
    }
    if (error instanceof StrictTextFileError ||
        error instanceof DeterministicJsonDocumentError) {
        fail("manifest", "$record/manifest");
    }
    throw error;
}
function issueRecord(value) {
    const record = Object.freeze(value);
    ISSUED_RECORDS.add(record);
    return record;
}
function assertRecordCapability(value) {
    if (typeof value !== "object" ||
        value === null ||
        types.isProxy(value) ||
        !Object.isFrozen(value) ||
        !ISSUED_RECORDS.has(value)) {
        fail("input", "$record");
    }
}
function sameRecord(left, right) {
    return (left.manifest.manifestDigest === right.manifest.manifestDigest &&
        left.recordTreePlan.planDigest === right.recordTreePlan.planDigest &&
        sameFileNodeSnapshot(left.rootNode, right.rootNode) &&
        sameFileNodeSnapshot(left.manifestNode, right.manifestNode) &&
        sameFileNodeSnapshot(left.payloadNode, right.payloadNode));
}
/** 稳定加载一份final record的Manifest与顶层节点；payload内容保持deferred。 */
export async function loadManagedEvidenceRecord(rootValue, evidenceIdValue, optionsValue = {}) {
    assertRoot(rootValue);
    const evidenceId = parseEvidenceId(evidenceIdValue);
    const options = parseLoadOptions(optionsValue);
    if (options.signal?.aborted === true)
        fail("aborted", "$signal");
    let address;
    try {
        address = managedEvidenceRecordAddress(evidenceId);
    }
    catch (error) {
        if (error instanceof ManagedEvidenceResourcePathError) {
            fail("input", "$evidenceId");
        }
        throw error;
    }
    const before = await readRecordRoot(rootValue, address.recordRootRef, options.expectedRootNode, options.signal);
    const topLevel = exactRecordRoot(before);
    let read;
    try {
        read = await readDeterministicJsonFile(rootValue, address.manifestRef, {
            maximumBytes: MANIFEST_MAXIMUM_BYTES,
            expectedNode: topLevel.manifestNode,
            ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
    }
    catch (error) {
        mapManifestReadError(error);
    }
    let manifest;
    try {
        manifest = parseManagedEvidenceManifestDocument(read.text);
    }
    catch (error) {
        if (error instanceof ManagedEvidenceManifestError) {
            fail("manifest", "$record/manifest");
        }
        throw error;
    }
    if (manifest.evidenceId !== evidenceId) {
        fail("manifest", "$record/manifest/evidenceId");
    }
    let recordTreePlan;
    try {
        recordTreePlan = planManagedEvidenceRecordTree(manifest);
    }
    catch (error) {
        if (error instanceof ManagedEvidenceRecordTreePlanError) {
            fail("record", "$record/manifest");
        }
        throw error;
    }
    if (read.digest !== recordTreePlan.manifestDocumentDigest) {
        fail("manifest", "$record/manifest");
    }
    const after = await readRecordRoot(rootValue, address.recordRootRef, before.directoryNode, options.signal);
    const afterTopLevel = exactRecordRoot(after);
    if (!sameDirectoryRead(before, after)) {
        fail("source-changed", "$record");
    }
    return issueRecord({
        manifest,
        recordTreePlan,
        rootNode: after.directoryNode,
        manifestNode: afterTopLevel.manifestNode,
        payloadNode: afterTopLevel.payloadNode,
    });
}
async function requireCurrentRecord(root, record, signal) {
    const current = await loadManagedEvidenceRecord(root, record.manifest.evidenceId, {
        expectedRootNode: record.rootNode,
        ...(signal === undefined ? {} : { signal }),
    });
    if (!sameRecord(record, current))
        fail("source-changed", "$record");
    return current;
}
function memberDescriptor(record, memberRef) {
    const descriptor = record.manifest.payload.treeManifest.files.find((candidate) => candidate.ref === memberRef);
    if (descriptor === undefined)
        fail("member-not-found", "$memberRef");
    return descriptor;
}
function mapMemberReadError(error) {
    if (error.reason === "aborted")
        fail("aborted", "$signal");
    if (error.reason === "root-scope")
        fail("root-scope", "$root");
    if (error.reason === "too-large")
        fail("capacity", "$member");
    if (error.reason === "source-changed" ||
        error.reason === "expectation-changed") {
        fail("source-changed", "$member");
    }
    if (error.reason === "not-found" ||
        error.reason === "symlink" ||
        error.reason === "not-file") {
        fail("content-mismatch", "$member");
    }
    fail("operation-failure", "$member");
}
/** 按Manifest descriptor读取并验证一个完整payload member。 */
export async function readManagedEvidencePayloadMember(rootValue, recordValue, memberRefValue, optionsValue) {
    assertRoot(rootValue);
    assertRecordCapability(recordValue);
    const memberRef = parseMemberRef(memberRefValue);
    const options = parseMemberOptions(optionsValue);
    if (options.signal?.aborted === true)
        fail("aborted", "$signal");
    const before = await requireCurrentRecord(rootValue, recordValue, options.signal);
    const member = memberDescriptor(before, memberRef);
    if (member.bytes > options.maximumBytes)
        fail("capacity", "$member");
    const memberPath = joinPortableResourcePath(managedEvidenceRecordAddress(before.manifest.evidenceId).payloadRootRef, memberRef, "$memberPath");
    let read;
    try {
        read = await readStableFile(rootValue, memberPath, {
            maximumBytes: options.maximumBytes,
            ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
    }
    catch (error) {
        if (error instanceof StableFileReadError)
            mapMemberReadError(error);
        throw error;
    }
    const expectedMode = member.executable
        ? MANAGED_EVIDENCE_RECORD_EXECUTABLE_FILE_MODE
        : MANAGED_EVIDENCE_RECORD_FILE_MODE;
    assertPrivateFile(read.node, expectedMode, "$member");
    if (read.byteCount !== member.bytes || read.digest !== member.digest) {
        fail("content-mismatch", "$member");
    }
    const current = await requireCurrentRecord(rootValue, before, options.signal);
    return Object.freeze({
        record: current,
        member,
        opaque: current.manifest.contentReview.opaqueFileRefs.includes(member.ref),
        bytes: read.bytes,
        payloadVerification: "member",
    });
}
function mapTreeVerificationError(error) {
    if (error.reason === "aborted")
        fail("aborted", "$signal");
    if (error.reason === "source-changed") {
        fail("source-changed", "$record");
    }
    fail("content-mismatch", "$record/payload");
}
/** 验证Manifest与全部payload成员形成exact、内容匹配的完整record tree。 */
export async function verifyManagedEvidenceRecord(rootValue, recordValue, optionsValue = {}) {
    assertRoot(rootValue);
    assertRecordCapability(recordValue);
    const options = parseVerifyOptions(optionsValue);
    if (options.signal?.aborted === true)
        fail("aborted", "$signal");
    const before = await requireCurrentRecord(rootValue, recordValue, options.signal);
    try {
        await inspectDirectoryTreeCandidate(rootValue, before.recordTreePlan.destinationRootPath, before.recordTreePlan.directoryPlan, {
            expectedRootNode: before.rootNode,
            ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
    }
    catch (error) {
        if (error instanceof DurableDirectoryTreeCandidateError) {
            mapTreeVerificationError(error);
        }
        throw error;
    }
    return Object.freeze({
        record: await requireCurrentRecord(rootValue, before, options.signal),
        payloadVerification: "complete",
    });
}
