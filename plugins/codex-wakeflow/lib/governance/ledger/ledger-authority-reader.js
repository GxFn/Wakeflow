import { WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA, } from "../../contracts/generated/governance/ledger/ledger-authority-member-reference.generated.js";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../contracts/generated/foundation/sha256-digest.generated.js";
import { parseSha256Digest, Sha256Error, } from "../../foundation/crypto/sha256.js";
import { DeterministicJsonDocumentError } from "../../foundation/data/deterministic-json-document.js";
import { JsonValueError, parseJsonValue, } from "../../foundation/data/json-value.js";
import { readDeterministicJsonFile, } from "../../foundation/filesystem/deterministic-json-file.js";
import { parsePortableResourcePath, PortableResourcePathError, splitPortableResourcePath, } from "../../foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import { readStableFile, StableFileReadError, } from "../../foundation/filesystem/stable-file-read.js";
import { readStableResourceTree, StableResourceTreeReadError, } from "../../foundation/filesystem/stable-resource-tree-read.js";
import { StrictTextFileError } from "../../foundation/filesystem/strict-text-file.js";
import { parseWakeflowDurableIdOfKind, WakeflowDurableIdError, } from "../../contracts/identity/wakeflow-durable-id.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import { computeLedgerAuthorityRecordDigest, parseLedgerAuthorityRecordDocument, LedgerAuthorityRecordError, } from "./ledger-authority-record.js";
import { LEDGER_AUTHORITY_FAMILY, ledgerAuthorityMemberRef, ledgerAuthorityRecordRef, ledgerAuthorityRootRef, requirementRootRef, } from "./ledger-authority-paths.js";
import { assertLedgerAuthorityNode, throwLedgerAuthorityStoreError as fail, } from "./ledger-authority-store-contract.js";
import { LEDGER_AUTHORITY_MAXIMUM_TREE_DEPTH, LEDGER_AUTHORITY_MAXIMUM_TREE_ENTRIES, LEDGER_AUTHORITY_MAXIMUM_TREE_FILES, LEDGER_AUTHORITY_MEMBER_MAXIMUM_BYTES, LEDGER_AUTHORITY_RECORD_MAXIMUM_BYTES, LEDGER_AUTHORITY_TREE_MAXIMUM_BYTES, } from "./ledger-authority-storage-policy.js";
/**
 * Wakeflow Governance / Ledger：不可变权威目录树读取器与成员引用编解码器。
 *
 * 读取器只按指定记录标识加载最终目录，不观察事务目录。因此，一条记录的发布残留
 * 不会阻断另一条已提交记录。读取器仍在同一次稳定目录树观察中复验全部目录、文件、
 * 摘要和清单闭合关系。
 */
const MEMBER_REFERENCE_ARTIFACT_KIND = "wakeflow-ledger-authority-member-reference";
const MEMBER_REFERENCE_SCHEMA_VERSION = 1;
const validateMemberReference = createRuntimeJsonSchemaValidator(WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA, [WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA, WAKEFLOW_SHA256_DIGEST_SCHEMA]);
function fileSource(source, path) {
    assertLedgerAuthorityNode(source.node, "file", path);
    return Object.freeze({
        resourcePath: source.resourcePath,
        node: source.node,
        byteCount: source.byteCount,
        digest: source.digest,
    });
}
function expectedResourcePaths(record) {
    const rootRef = ledgerAuthorityRootRef(record);
    const expected = new Map();
    expected.set(ledgerAuthorityRecordRef(record), "file");
    for (const document of record.documents) {
        const segments = splitPortableResourcePath(document.path);
        for (let index = 1; index < segments.length; index += 1) {
            expected.set(parsePortableResourcePath(`${rootRef}/${segments.slice(0, index).join("/")}`), "directory");
        }
        expected.set(ledgerAuthorityMemberRef(record, document.path), "file");
    }
    return expected;
}
function mapTreeError(error) {
    if (error.reason === "not-found")
        fail("not-found", "$record");
    if (error.reason === "entry-limit"
        || error.reason === "depth-limit"
        || error.reason === "file-count"
        || error.reason === "file-bytes"
        || error.reason === "total-bytes") {
        fail("capacity", "$record");
    }
    if (error.reason === "aborted")
        fail("aborted", "$signal");
    if (error.reason === "root-scope")
        fail("root-scope", "$root");
    fail("conflict", "$record");
}
async function readRecordDocument(root, recordRef, expectedNode, signal) {
    try {
        return await readDeterministicJsonFile(root, recordRef, {
            maximumBytes: LEDGER_AUTHORITY_RECORD_MAXIMUM_BYTES,
            expectedNode,
            ...(signal === undefined ? {} : { signal }),
        });
    }
    catch (error) {
        if (error instanceof StableFileReadError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            if (error.reason === "root-scope")
                fail("root-scope", "$root");
            if (error.reason === "too-large")
                fail("capacity", "$record");
            fail("conflict", "$record");
        }
        if (error instanceof StrictTextFileError
            || error instanceof DeterministicJsonDocumentError) {
            fail("record", "$record");
        }
        throw error;
    }
}
/** 按需求包标识从最终根目录严格加载一条不可变 Ledger 权威记录。 */
export async function loadLedgerAuthorityRecord(root, requirementId, signal) {
    const rootRef = requirementRootRef(requirementId);
    let tree;
    try {
        tree = await readStableResourceTree(root, rootRef, {
            maximumEntries: LEDGER_AUTHORITY_MAXIMUM_TREE_ENTRIES,
            maximumDepth: LEDGER_AUTHORITY_MAXIMUM_TREE_DEPTH,
            maximumFiles: LEDGER_AUTHORITY_MAXIMUM_TREE_FILES,
            maximumFileBytes: LEDGER_AUTHORITY_MEMBER_MAXIMUM_BYTES,
            maximumTotalBytes: LEDGER_AUTHORITY_TREE_MAXIMUM_BYTES,
            ...(signal === undefined ? {} : { signal }),
        });
    }
    catch (error) {
        if (error instanceof StableResourceTreeReadError)
            mapTreeError(error);
        throw error;
    }
    assertLedgerAuthorityNode(tree.treeRootNode, "directory", "$recordRoot");
    const recordEntry = tree.entries.find((entry) => entry.resourcePath === `${rootRef}/record.json`);
    if (recordEntry === undefined || recordEntry.node.kind !== "file") {
        fail("conflict", "$record/record.json");
    }
    const read = await readRecordDocument(root, recordEntry.resourcePath, recordEntry.node, signal);
    let record;
    try {
        record = parseLedgerAuthorityRecordDocument(read.text);
    }
    catch (error) {
        if (error instanceof LedgerAuthorityRecordError)
            fail("record", "$record");
        throw error;
    }
    if (record.requirementId !== requirementId)
        fail("conflict", "$record");
    const expected = expectedResourcePaths(record);
    if (tree.entries.length !== expected.size
        || tree.entries.some((entry) => {
            const kind = expected.get(entry.resourcePath);
            return kind === undefined || entry.node.kind !== kind;
        })) {
        fail("conflict", "$recordRoot");
    }
    for (const entry of tree.entries) {
        assertLedgerAuthorityNode(entry.node, entry.node.kind === "directory" ? "directory" : "file", "$recordRoot");
    }
    const fileByRef = new Map(tree.files.map((file) => [file.resourcePath, file]));
    const documents = record.documents.map((document) => {
        const memberRef = ledgerAuthorityMemberRef(record, document.path);
        const source = fileByRef.get(memberRef);
        if (source === undefined || source.digest !== document.digest) {
            fail("member", "$record/documents");
        }
        return Object.freeze({
            ...document,
            memberRef,
            source: fileSource(source, "$record/documents"),
        });
    });
    const recordSource = fileSource(read, "$record/record.json");
    return Object.freeze({
        family: LEDGER_AUTHORITY_FAMILY,
        record,
        recordRootRef: rootRef,
        recordRef: recordSource.resourcePath,
        recordDigest: computeLedgerAuthorityRecordDigest(record),
        recordSource,
        documents: Object.freeze(documents),
    });
}
function parseReferencePath(value, path) {
    try {
        return parsePortableResourcePath(value, path);
    }
    catch (error) {
        if (error instanceof PortableResourcePathError)
            fail("input", path);
        throw error;
    }
}
function parseReferenceDigest(value, path) {
    try {
        return parseSha256Digest(value, path);
    }
    catch (error) {
        if (error instanceof Sha256Error)
            fail("input", path);
        throw error;
    }
}
/** 解析可持久化的 Ledger 成员引用，并验证引用字段之间的关系。 */
export function parseLedgerAuthorityMemberReference(value) {
    let json;
    try {
        json = parseJsonValue(value, "$reference");
    }
    catch (error) {
        if (error instanceof JsonValueError)
            fail("input", error.path);
        throw error;
    }
    const result = validateMemberReference(json);
    if (!result.ok)
        fail("input", result.path);
    const recordRef = parseReferencePath(result.value.recordRef, "$/recordRef");
    const recordDigest = parseReferenceDigest(result.value.recordDigest, "$/recordDigest");
    const memberPath = parseReferencePath(result.value.memberPath, "$/memberPath");
    if (memberPath.toLowerCase() === "record.json"
        || memberPath.toLowerCase().startsWith("record.json/")) {
        fail("input", "$/memberPath");
    }
    const memberRef = parseReferencePath(result.value.memberRef, "$/memberRef");
    const memberDigest = parseReferenceDigest(result.value.memberDigest, "$/memberDigest");
    let recordId;
    try {
        recordId = parseWakeflowDurableIdOfKind(result.value.recordId, "requirement", "$/recordId");
    }
    catch (error) {
        if (error instanceof WakeflowDurableIdError)
            fail("input", "$/recordId");
        throw error;
    }
    const expectedRoot = requirementRootRef(recordId);
    if (recordRef !== `${expectedRoot}/record.json`
        || memberRef !== `${expectedRoot}/${memberPath}`) {
        fail("input", "$reference");
    }
    return Object.freeze({
        artifactKind: MEMBER_REFERENCE_ARTIFACT_KIND,
        schemaVersion: MEMBER_REFERENCE_SCHEMA_VERSION,
        family: LEDGER_AUTHORITY_FAMILY,
        recordId,
        recordRef,
        recordDigest,
        memberPath,
        memberRef,
        memberDigest,
        role: result.value.role,
        mediaType: result.value.mediaType,
    });
}
/** 从已经严格加载的记录创建可跨领域传递的成员引用；角色取自记录中的成员声明。 */
export function createLedgerAuthorityMemberReference(loaded, memberPathValue) {
    const memberPath = parseReferencePath(memberPathValue, "$memberPath");
    const document = loaded.documents.find((candidate) => candidate.path === memberPath);
    if (document === undefined)
        fail("input", "$memberPath");
    return parseLedgerAuthorityMemberReference({
        artifactKind: MEMBER_REFERENCE_ARTIFACT_KIND,
        schemaVersion: MEMBER_REFERENCE_SCHEMA_VERSION,
        family: loaded.family,
        recordId: loaded.record.requirementId,
        recordRef: loaded.recordRef,
        recordDigest: loaded.recordDigest,
        memberPath: document.path,
        memberRef: document.memberRef,
        memberDigest: document.digest,
        role: document.role,
        mediaType: document.mediaType,
    });
}
/** 解析成员引用，读取对应的不可变成员，并复验摘要与记录关系。 */
export async function resolveLoadedLedgerAuthorityMemberReference(root, loaded, reference, signal) {
    const document = loaded.documents.find((candidate) => candidate.path === reference.memberPath);
    if (loaded.recordRef !== reference.recordRef
        || loaded.recordDigest !== reference.recordDigest
        || document === undefined
        || document.memberRef !== reference.memberRef
        || document.digest !== reference.memberDigest
        || document.role !== reference.role
        || document.mediaType !== reference.mediaType) {
        fail("conflict", "$reference");
    }
    let read;
    try {
        read = await readStableFile(root, document.memberRef, {
            maximumBytes: LEDGER_AUTHORITY_MEMBER_MAXIMUM_BYTES,
            expectedNode: document.source.node,
            ...(signal === undefined ? {} : { signal }),
        });
    }
    catch (error) {
        if (error instanceof StableFileReadError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            fail("conflict", "$reference");
        }
        throw error;
    }
    if (read.digest !== reference.memberDigest)
        fail("conflict", "$reference");
    return Object.freeze({
        reference,
        loaded,
        document,
        bytes: new Uint8Array(read.bytes),
        source: fileSource(read, "$reference"),
    });
}
