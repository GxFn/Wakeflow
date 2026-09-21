import { types } from "node:util";
import { DeterministicJsonDocumentError, } from "../../foundation/data/deterministic-json-document.js";
import { parsePlainRecord, PassiveOwnDataError, } from "../../foundation/data/passive-own-data.js";
import { createFileAtomically, DurableAtomicFileWriteError, } from "../../foundation/filesystem/durable-atomic-file-write.js";
import { readDeterministicJsonFile, } from "../../foundation/filesystem/deterministic-json-file.js";
import { unlinkRegularFileExactly, ExactRegularFileUnlinkError, } from "../../foundation/filesystem/exact-regular-file-unlink.js";
import { sameFileNodeSnapshot, } from "../../foundation/filesystem/file-node-snapshot.js";
import { RootedDirectory, RootedDirectoryError, } from "../../foundation/filesystem/rooted-directory.js";
import { StableFileReadError } from "../../foundation/filesystem/stable-file-read.js";
import { StrictTextFileError } from "../../foundation/filesystem/strict-text-file.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { admitWakeflowResourceOperation, WakeflowResourceProcessingContractError, } from "../../foundation/resource/resource-processing-contract.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import { createManagedEvidencePublicationTransactionResourceDeclaration, } from "./managed-evidence-resource-catalog.js";
import { computeManagedEvidencePublicationTransactionDigest, parseManagedEvidencePublicationTransaction, parseManagedEvidencePublicationTransactionDocument, renderManagedEvidencePublicationTransaction, MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_MAXIMUM_BYTES, ManagedEvidencePublicationTransactionError, } from "./managed-evidence-publication-transaction.js";
import { MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_REF, } from "./managed-evidence-resource-paths.js";
/**
 * Wakeflow Governance / Evidence：固定Publication Transaction journal的耐久Store。
 *
 * Store只拥有Demand根内一个0600、single-link、absent-only journal槽位。正常create
 * 遇到任何现存文件都会拒绝并路由显式恢复；load稳定读取并签发进程内retire能力；
 * retire在提交前重读exact文档，再按节点预期耐久unlink。
 *
 * 本模块不保存可变phase、不创建Managed Evidence容器或stage、不读取原source、
 * 不追加Event，也不判断何时允许退休。Event前取消与Event后前向完成仍由未来
 * Publication Application根据Transaction、Inventory与Event Store共同决定。
 */
export const MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_FILE_MODE = 0o600;
const ERROR_MESSAGES = {
    input: "Managed evidence publication transaction store input is invalid.",
    "root-scope": "Managed evidence publication transaction store escaped its Demand root.",
    "transaction-exists": "Managed evidence publication transaction journal already exists.",
    conflict: "Managed evidence publication transaction journal is invalid or changed.",
    capacity: "Managed evidence publication transaction journal exceeds its capacity.",
    aborted: "Managed evidence publication transaction store operation was aborted.",
    "recovery-required": "Managed evidence publication transaction journal requires explicit recovery.",
    "operation-failure": "Managed evidence publication transaction store operation failed.",
};
/** Journal生命周期无法安全证明时的稳定、脱敏错误。 */
export class ManagedEvidencePublicationTransactionStoreError extends Error {
    name = "ManagedEvidencePublicationTransactionStoreError";
    code = "wakeflow-managed-evidence-publication-transaction-store";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
const ISSUED_STORED_TRANSACTIONS = new WeakSet();
const TRANSACTION_MAXIMUM_BYTES = parseByteCount(MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_MAXIMUM_BYTES);
function fail(reason, path) {
    throw new ManagedEvidencePublicationTransactionStoreError(reason, path);
}
function assertRoot(value) {
    if (typeof value !== "object" ||
        value === null ||
        types.isProxy(value) ||
        !(value instanceof RootedDirectory)) {
        fail("input", "$root");
    }
}
function parseOptions(value) {
    let record;
    try {
        record = parsePlainRecord(value === undefined ? {} : value, "$options");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", "$options");
        throw error;
    }
    if (Object.keys(record).some((key) => key !== "signal") ||
        (record.signal !== undefined &&
            (typeof record.signal !== "object" ||
                record.signal === null ||
                types.isProxy(record.signal) ||
                !(record.signal instanceof AbortSignal)))) {
        fail("input", "$options");
    }
    return Object.freeze({
        signal: record.signal,
    });
}
function assertNotAborted(signal) {
    if (signal?.aborted === true)
        fail("aborted", "$signal");
}
function currentUserId() {
    return typeof process.geteuid === "function"
        ? BigInt(process.geteuid())
        : null;
}
function assertJournalNode(node) {
    const userId = currentUserId();
    if (node.kind !== "file" ||
        node.permissionBits !== MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_FILE_MODE ||
        node.linkCount !== 1n ||
        (userId !== null && node.userId !== userId)) {
        fail("conflict", "$transaction");
    }
}
function parseExpectedNode(value) {
    if (value === undefined)
        return undefined;
    if (typeof value !== "object" ||
        value === null ||
        types.isProxy(value) ||
        !Object.isFrozen(value)) {
        fail("input", "$expectedNode");
    }
    try {
        sameFileNodeSnapshot(value, value);
    }
    catch {
        fail("input", "$expectedNode");
    }
    return value;
}
function admitMutation(transaction, recipe) {
    const declaration = createManagedEvidencePublicationTransactionResourceDeclaration(transaction.manifest.demandId);
    try {
        admitWakeflowResourceOperation(declaration.processing, recipe);
    }
    catch (error) {
        if (error instanceof WakeflowResourceProcessingContractError) {
            fail("operation-failure", "$catalog");
        }
        throw error;
    }
}
async function journalNodeOrNull(root) {
    try {
        return (await root.inspectExistingResource(MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_REF, "$transaction")).node;
    }
    catch (error) {
        if (error instanceof RootedDirectoryError &&
            error.reason === "resource-not-found") {
            return null;
        }
        if (error instanceof RootedDirectoryError)
            fail("root-scope", "$root");
        throw error;
    }
}
function mapReadError(error) {
    if (error instanceof StableFileReadError) {
        if (error.reason === "aborted")
            fail("aborted", "$signal");
        if (error.reason === "root-scope" ||
            error.reason === "unsupported-platform") {
            fail("root-scope", "$root");
        }
        if (error.reason === "too-large")
            fail("capacity", "$transaction");
        fail("conflict", "$transaction");
    }
    if (error instanceof StrictTextFileError ||
        error instanceof DeterministicJsonDocumentError) {
        fail("conflict", "$transaction");
    }
    throw error;
}
async function readStoredAtNode(root, expectedNode, signal) {
    assertJournalNode(expectedNode);
    let source;
    try {
        source = await readDeterministicJsonFile(root, MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_REF, {
            maximumBytes: TRANSACTION_MAXIMUM_BYTES,
            expectedNode,
            ...(signal === undefined ? {} : { signal }),
        });
    }
    catch (error) {
        mapReadError(error);
    }
    let transaction;
    try {
        transaction = parseManagedEvidencePublicationTransactionDocument(source.text);
    }
    catch (error) {
        if (error instanceof ManagedEvidencePublicationTransactionError) {
            fail("conflict", "$transaction");
        }
        throw error;
    }
    const stored = Object.freeze({
        transaction,
        transactionDigest: computeManagedEvidencePublicationTransactionDigest(transaction),
        source,
    });
    ISSUED_STORED_TRANSACTIONS.add(stored);
    return stored;
}
function sameTransaction(left, right) {
    return renderManagedEvidencePublicationTransaction(left) ===
        renderManagedEvidencePublicationTransaction(right);
}
/** 读取当前固定journal；严格absent返回null，非法或漂移资源失败关闭。 */
export async function loadManagedEvidencePublicationTransaction(root, optionsValue = {}) {
    assertRoot(root);
    const options = parseOptions(optionsValue);
    assertNotAborted(options.signal);
    const node = await journalNodeOrNull(root);
    return node === null
        ? null
        : readStoredAtNode(root, node, options.signal);
}
/** 读取并证明固定journal仍绑定exact Transaction与可选原始node。 */
export async function requireCurrentManagedEvidencePublicationTransaction(root, transactionValue, expectedNodeValue, optionsValue = {}) {
    assertRoot(root);
    const options = parseOptions(optionsValue);
    assertNotAborted(options.signal);
    let transaction;
    try {
        transaction = parseManagedEvidencePublicationTransaction(transactionValue);
    }
    catch (error) {
        if (error instanceof ManagedEvidencePublicationTransactionError) {
            fail("input", "$transaction");
        }
        throw error;
    }
    const expectedNode = parseExpectedNode(expectedNodeValue);
    const stored = await loadManagedEvidencePublicationTransaction(root, options.signal === undefined ? undefined : { signal: options.signal });
    if (stored === null ||
        stored.transactionDigest !==
            computeManagedEvidencePublicationTransactionDigest(transaction) ||
        !sameTransaction(stored.transaction, transaction) ||
        (expectedNode !== undefined &&
            !sameFileNodeSnapshot(stored.source.node, expectedNode))) {
        fail("conflict", "$transaction");
    }
    return stored;
}
function mapCreateError(error) {
    if (error.reason === "aborted")
        fail("aborted", "$signal");
    if (error.reason === "root-scope")
        fail("root-scope", "$root");
    if (error.reason === "capacity")
        fail("capacity", "$transaction");
    if (error.reason === "target-exists") {
        fail("transaction-exists", "$transaction");
    }
    if (error.reason === "commit-uncertain" ||
        error.reason === "durability-failure" ||
        error.reason === "stage-cleanup-failure" ||
        error.reason === "stage-recovery-required" ||
        error.reason === "close-failure") {
        fail("recovery-required", "$transaction");
    }
    fail("operation-failure", "$transaction");
}
/** 严格absent-only创建并同步完整journal；现存exact journal也必须走显式恢复。 */
export async function createManagedEvidencePublicationTransactionJournal(root, transactionValue, optionsValue = {}) {
    assertRoot(root);
    const options = parseOptions(optionsValue);
    assertNotAborted(options.signal);
    let transaction;
    try {
        transaction = parseManagedEvidencePublicationTransaction(transactionValue);
    }
    catch (error) {
        if (error instanceof ManagedEvidencePublicationTransactionError) {
            fail("input", "$transaction");
        }
        throw error;
    }
    admitMutation(transaction, "exclusive-create");
    const text = renderManagedEvidencePublicationTransaction(transaction);
    const bytes = encodeUtf8(text, "$transaction");
    if (bytes.byteLength >
        MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_MAXIMUM_BYTES) {
        fail("capacity", "$transaction");
    }
    let publication;
    try {
        publication = await createFileAtomically(root, MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_REF, bytes, {
            mode: MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_FILE_MODE,
            ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
    }
    catch (error) {
        if (error instanceof DurableAtomicFileWriteError)
            mapCreateError(error);
        throw error;
    }
    let stored;
    try {
        // journal已经提交后不再让取消遮蔽readback；失败统一要求显式恢复。
        stored = await readStoredAtNode(root, publication.node, undefined);
    }
    catch (error) {
        if (error instanceof ManagedEvidencePublicationTransactionStoreError) {
            fail("recovery-required", "$transaction");
        }
        throw error;
    }
    if (!sameTransaction(stored.transaction, transaction)) {
        fail("recovery-required", "$transaction");
    }
    return stored;
}
function assertStoredCapability(value) {
    if (typeof value !== "object" ||
        value === null ||
        types.isProxy(value) ||
        !Object.isFrozen(value) ||
        !ISSUED_STORED_TRANSACTIONS.has(value)) {
        fail("input", "$stored");
    }
}
/** 只退休Store重新读证后的exact journal；缺失、替换或提交不确定均不伪造成功。 */
export async function retireManagedEvidencePublicationTransactionJournal(root, storedValue, optionsValue = {}) {
    assertRoot(root);
    const options = parseOptions(optionsValue);
    assertStoredCapability(storedValue);
    assertNotAborted(options.signal);
    admitMutation(storedValue.transaction, "exact-retire");
    let current;
    try {
        current = await readStoredAtNode(root, storedValue.source.node, options.signal);
    }
    catch (error) {
        if (error instanceof ManagedEvidencePublicationTransactionStoreError) {
            if (error.reason === "aborted")
                throw error;
            if (error.reason === "root-scope")
                throw error;
            fail("conflict", "$transaction");
        }
        throw error;
    }
    if (current.transactionDigest !== storedValue.transactionDigest ||
        !sameFileNodeSnapshot(current.source.node, storedValue.source.node) ||
        !sameTransaction(current.transaction, storedValue.transaction)) {
        fail("conflict", "$transaction");
    }
    let retirement;
    try {
        retirement = await unlinkRegularFileExactly(root, MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_REF, {
            expectedNode: current.source.node,
            ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
    }
    catch (error) {
        if (error instanceof ExactRegularFileUnlinkError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            if (error.reason === "root-scope")
                fail("root-scope", "$root");
            fail("recovery-required", "$transaction");
        }
        throw error;
    }
    ISSUED_STORED_TRANSACTIONS.delete(storedValue);
    return Object.freeze({
        transactionDigest: storedValue.transactionDigest,
        retirement,
    });
}
