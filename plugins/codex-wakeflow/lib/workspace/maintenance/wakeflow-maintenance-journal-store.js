import { createFileAtomically, replaceFileAtomically, DurableAtomicFileWriteError, } from "../../foundation/filesystem/durable-atomic-file-write.js";
import { readDeterministicJsonFile, } from "../../foundation/filesystem/deterministic-json-file.js";
import { DeterministicJsonDocumentError, } from "../../foundation/data/deterministic-json-document.js";
import { recoverDurableAtomicFileStagesForTargets, DurableAtomicFileStageRecoveryError, } from "../../foundation/filesystem/durable-atomic-file-stage-recovery.js";
import { unlinkRegularFileExactly, ExactRegularFileUnlinkError, } from "../../foundation/filesystem/exact-regular-file-unlink.js";
import { RootedDirectory, RootedDirectoryError, } from "../../foundation/filesystem/rooted-directory.js";
import { readStableResourceDirectory, StableDirectoryReadError, } from "../../foundation/filesystem/stable-directory-read.js";
import { StableFileReadError, } from "../../foundation/filesystem/stable-file-read.js";
import { StrictTextFileError, } from "../../foundation/filesystem/strict-text-file.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { admitWakeflowResourceOperation, WakeflowResourceProcessingContractError, } from "../../foundation/resource/resource-processing-contract.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import { assertWakeflowMaintenanceGateContext, WakeflowMaintenanceGateError, } from "./wakeflow-maintenance-gate.js";
import { assertWakeflowMaintenanceIntentAndJournalAreOnlyTransaction, assertWakeflowMaintenanceIntentIsOnlyTransactionPrefix, WakeflowMaintenanceExecutionIntentStoreError, } from "./wakeflow-maintenance-execution-intent-store.js";
import { computeWakeflowMaintenanceJournalDigest, createPreparedWakeflowMaintenanceJournal, createWakeflowMaintenanceJournalResourceDeclaration, parseWakeflowMaintenanceJournal, isWakeflowMaintenanceJournalSuccessor, renderWakeflowMaintenanceJournal, WakeflowMaintenanceJournalError, } from "./wakeflow-maintenance-journal.js";
import { parseWakeflowMaintenanceOperationId, WakeflowMaintenanceOperationIdError, wakeflowMaintenanceJournalRef, } from "./wakeflow-maintenance-operation-id.js";
import { WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_REF, } from "./wakeflow-maintenance-resource-catalog.js";
/**
 * Wakeflow Workspace / Maintenance：maintenance journal（prepared、executing 或 terminal）的 gate-bound 物理 store。
 *
 * create 与 retire 只能在有效 MaintenanceGateContext 内执行；普通读取保持只读。
 * Journal只能在同operation immutable intent已经精确发布后创建；checkpoint期间目录
 * 必须只含intent+journal。Intent先退休后，prepared/terminal journal才能最终退休。
 */
export const WAKEFLOW_MAINTENANCE_JOURNAL_MAXIMUM_BYTES = parseByteCount(64 * 1024, "$maintenanceJournal.maximumBytes");
/** 对一个 exact journal target 执行关闭作用域的 Foundation stage 恢复。 */
export async function recoverWakeflowMaintenanceJournalStages(root, operationIdValue) {
    const operationId = admittedOperationId(operationIdValue);
    try {
        const receipt = await recoverDurableAtomicFileStagesForTargets(root, Object.freeze([wakeflowMaintenanceJournalRef(operationId)]));
        if (receipt.activeStageCount !== 0
            || receipt.unknownStageCount !== 0) {
            fail("recovery-required", "$journalStage");
        }
        return receipt;
    }
    catch (error) {
        if (error instanceof WakeflowMaintenanceJournalStoreError)
            throw error;
        if (error instanceof DurableAtomicFileStageRecoveryError) {
            fail("recovery-required", "$journalStage");
        }
        throw error;
    }
}
const ERROR_MESSAGES = {
    input: "Wakeflow maintenance journal store input is invalid.",
    gate: "Wakeflow maintenance journal store requires the active matching gate.",
    "transactions-shape": "Wakeflow maintenance transaction resources have an invalid shape.",
    source: "Wakeflow maintenance journal source cannot be read stably.",
    "source-policy": "Wakeflow maintenance journal violates its node policy.",
    journal: "Wakeflow maintenance journal content is invalid.",
    capacity: "Wakeflow maintenance journal exceeds its capacity.",
    conflict: "Wakeflow maintenance journal changed before its exact effect.",
    "recovery-required": "Wakeflow maintenance journal requires explicit recovery.",
    "effect-failure": "Wakeflow maintenance journal effect failed safely.",
    "commit-uncertain": "Wakeflow maintenance journal commit could not be proven.",
};
/** Maintenance journal store 失败的稳定、脱敏错误。 */
export class WakeflowMaintenanceJournalStoreError extends Error {
    name = "WakeflowMaintenanceJournalStoreError";
    code = "wakeflow-maintenance-journal-store";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
const ISSUED_SOURCES = new WeakSet();
function fail(reason, path) {
    throw new WakeflowMaintenanceJournalStoreError(reason, path);
}
function admittedOperationId(value) {
    try {
        return parseWakeflowMaintenanceOperationId(value);
    }
    catch (error) {
        if (error instanceof WakeflowMaintenanceOperationIdError) {
            fail("input", "$operationId");
        }
        throw error;
    }
}
function admittedJournalByteCount(bytes) {
    if (bytes.byteLength > WAKEFLOW_MAINTENANCE_JOURNAL_MAXIMUM_BYTES) {
        fail("capacity", "$journal");
    }
    return parseByteCount(bytes.byteLength, "$journal.byteCount");
}
/** 在任何bootstrap/gate效果前验证initial journal的持久表示容量。 */
export function assertWakeflowPreparedMaintenanceJournalCapacity(operationId, intentDigest, plan) {
    let journal;
    try {
        journal = createPreparedWakeflowMaintenanceJournal(operationId, intentDigest, plan);
    }
    catch (error) {
        if (error instanceof WakeflowMaintenanceJournalError) {
            fail("input", "$journal");
        }
        throw error;
    }
    return admittedJournalByteCount(encodeUtf8(renderWakeflowMaintenanceJournal(journal)));
}
function currentUserId() {
    if (process.platform === "win32" || typeof process.geteuid !== "function") {
        fail("source-policy", "$journal");
    }
    return BigInt(process.geteuid());
}
function assertGate(root, context) {
    try {
        assertWakeflowMaintenanceGateContext(context, root);
    }
    catch (error) {
        if (error instanceof WakeflowMaintenanceGateError) {
            fail("gate", "$context");
        }
        throw error;
    }
}
function admitOperation(operationId, recipe) {
    const declaration = createWakeflowMaintenanceJournalResourceDeclaration(operationId);
    try {
        admitWakeflowResourceOperation(declaration.processing, recipe);
    }
    catch (error) {
        if (error instanceof WakeflowResourceProcessingContractError) {
            fail("input", "$journal");
        }
        throw error;
    }
}
async function assertTransactionsEmpty(root) {
    try {
        await readStableResourceDirectory(root, WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_REF, { maximumEntries: 0 });
    }
    catch (error) {
        if (error instanceof StableDirectoryReadError) {
            if (error.reason === "too-many-entries") {
                fail("transactions-shape", "$transactions");
            }
            fail("source", "$transactions");
        }
        throw error;
    }
}
/** 在任何退休效果前证明 transactions 只含指定 exact journal。 */
export async function assertWakeflowMaintenanceJournalIsOnlyTransaction(root, sourceValue) {
    if (typeof sourceValue !== "object"
        || sourceValue === null
        || !ISSUED_SOURCES.has(sourceValue)) {
        fail("input", "$source");
    }
    let read;
    try {
        read = await readStableResourceDirectory(root, WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_REF, { maximumEntries: 1 });
    }
    catch (error) {
        if (error instanceof StableDirectoryReadError) {
            if (error.reason === "too-many-entries") {
                fail("transactions-shape", "$transactions");
            }
            fail("source", "$transactions");
        }
        throw error;
    }
    if (read.entries.length !== 1
        || read.entries[0]?.resourcePath !== sourceValue.resourcePath) {
        fail("transactions-shape", "$transactions");
    }
}
/** 读取并严格复验一个 maintenance journal（prepared、executing 或 terminal）。 */
export async function readWakeflowMaintenanceJournal(root, operationIdValue) {
    const operationId = admittedOperationId(operationIdValue);
    const resourcePath = wakeflowMaintenanceJournalRef(operationId);
    let read;
    try {
        read = await readDeterministicJsonFile(root, resourcePath, {
            maximumBytes: WAKEFLOW_MAINTENANCE_JOURNAL_MAXIMUM_BYTES,
        });
    }
    catch (error) {
        if (error instanceof StableFileReadError) {
            if (error.reason === "too-large")
                fail("capacity", "$journal");
            if (error.reason === "not-found")
                fail("source", "$journal");
            if (error.reason === "symlink" || error.reason === "not-file") {
                fail("source-policy", "$journal");
            }
            fail("source", "$journal");
        }
        if (error instanceof StrictTextFileError
            || error instanceof DeterministicJsonDocumentError) {
            fail("journal", "$journal");
        }
        throw error;
    }
    if (read.node.kind !== "file"
        || read.node.permissionBits !== 0o600
        || read.node.linkCount !== 1n
        || read.node.userId !== currentUserId()) {
        fail("source-policy", "$journal");
    }
    let journal;
    try {
        journal = parseWakeflowMaintenanceJournal(read.value);
    }
    catch (error) {
        if (error instanceof WakeflowMaintenanceJournalError) {
            fail("journal", error.path);
        }
        throw error;
    }
    if (journal.operationId !== operationId
        || renderWakeflowMaintenanceJournal(journal) !== read.text) {
        fail("journal", "$journal");
    }
    const journalDigest = computeWakeflowMaintenanceJournalDigest(journal);
    const source = Object.freeze({
        operationId,
        resourcePath,
        node: read.node,
        digest: read.digest,
        journalDigest,
        journal,
    });
    ISSUED_SOURCES.add(source);
    return source;
}
/** 读取可选journal；absent与unsafe source严格区分。 */
export async function readWakeflowMaintenanceJournalOrNull(root, operationIdValue) {
    const operationId = admittedOperationId(operationIdValue);
    try {
        await root.inspectExistingResource(wakeflowMaintenanceJournalRef(operationId));
    }
    catch (error) {
        if (error instanceof RootedDirectoryError
            && error.reason === "resource-not-found") {
            return null;
        }
        if (error instanceof RootedDirectoryError)
            fail("source", "$journal");
        throw error;
    }
    return readWakeflowMaintenanceJournal(root, operationId);
}
/** 在有效 gate scope 内 absent-only 发布一份 prepared journal。 */
export async function publishPreparedWakeflowMaintenanceJournal(root, context, intentSource, planValue) {
    assertGate(root, context);
    let journal;
    try {
        journal = createPreparedWakeflowMaintenanceJournal(context.operationId, intentSource.intentDigest, planValue);
    }
    catch (error) {
        if (error instanceof WakeflowMaintenanceJournalError) {
            fail("input", "$plan");
        }
        throw error;
    }
    if (intentSource.operationId !== context.operationId
        || intentSource.intent.planDigest !== journal.planDigest) {
        fail("input", "$intentSource");
    }
    admitOperation(context.operationId, "exclusive-create");
    try {
        await assertWakeflowMaintenanceIntentIsOnlyTransactionPrefix(root, intentSource);
    }
    catch (error) {
        if (error instanceof WakeflowMaintenanceExecutionIntentStoreError) {
            if (error.reason === "transactions-shape") {
                fail("transactions-shape", "$transactions");
            }
            fail("conflict", "$intent");
        }
        throw error;
    }
    const bytes = encodeUtf8(renderWakeflowMaintenanceJournal(journal));
    admittedJournalByteCount(bytes);
    const intendedDigest = computeWakeflowMaintenanceJournalDigest(journal);
    let publication;
    try {
        publication = await createFileAtomically(root, wakeflowMaintenanceJournalRef(context.operationId), bytes, { mode: 0o600 });
    }
    catch (error) {
        if (error instanceof DurableAtomicFileWriteError) {
            if (error.reason === "target-exists")
                fail("conflict", "$journal");
            if (error.reason === "stage-recovery-required") {
                fail("recovery-required", "$journal");
            }
            if (error.reason === "commit-uncertain"
                || error.reason === "durability-failure"
                || error.reason === "stage-cleanup-failure"
                || error.reason === "close-failure") {
                fail("commit-uncertain", "$journal");
            }
            fail("effect-failure", "$journal");
        }
        throw error;
    }
    let source;
    try {
        source = await readWakeflowMaintenanceJournal(root, context.operationId);
    }
    catch {
        fail("commit-uncertain", "$journal");
    }
    if (publication.resourcePath !== source.resourcePath
        || publication.digest !== source.digest
        || publication.byteCount !== source.node.byteCount
        || publication.node.deviceId !== source.node.deviceId
        || publication.node.inodeId !== source.node.inodeId
        || source.journal.intentDigest !== intentSource.intentDigest
        || source.journal.planDigest !== journal.planDigest
        || source.journalDigest !== intendedDigest) {
        fail("commit-uncertain", "$journal");
    }
    return source;
}
/** 在有效 gate scope 内以CAS写入一个且仅一个合法 journal 后继。 */
export async function checkpointWakeflowMaintenanceJournal(root, context, intentSource, sourceValue, proposedValue) {
    assertGate(root, context);
    if (typeof sourceValue !== "object"
        || sourceValue === null
        || !ISSUED_SOURCES.has(sourceValue)
        || sourceValue.operationId !== context.operationId) {
        fail("input", "$source");
    }
    let proposed;
    try {
        proposed = parseWakeflowMaintenanceJournal(proposedValue);
    }
    catch (error) {
        if (error instanceof WakeflowMaintenanceJournalError) {
            fail("journal", "$proposed");
        }
        throw error;
    }
    if (!isWakeflowMaintenanceJournalSuccessor(sourceValue.journal, proposed)) {
        fail("input", "$proposed");
    }
    const declaration = createWakeflowMaintenanceJournalResourceDeclaration(context.operationId);
    try {
        admitWakeflowResourceOperation(declaration.processing, "exact-source-replace");
    }
    catch (error) {
        if (error instanceof WakeflowResourceProcessingContractError) {
            fail("input", "$journal");
        }
        throw error;
    }
    if (intentSource.operationId !== context.operationId
        || sourceValue.journal.intentDigest !== intentSource.intentDigest) {
        fail("input", "$intentSource");
    }
    try {
        await assertWakeflowMaintenanceIntentAndJournalAreOnlyTransaction(root, intentSource);
    }
    catch (error) {
        if (error instanceof WakeflowMaintenanceExecutionIntentStoreError) {
            if (error.reason === "transactions-shape") {
                fail("transactions-shape", "$transactions");
            }
            fail("conflict", "$intent");
        }
        throw error;
    }
    const current = await readWakeflowMaintenanceJournal(root, context.operationId);
    if (current.digest !== sourceValue.digest
        || current.journalDigest !== sourceValue.journalDigest
        || current.node.deviceId !== sourceValue.node.deviceId
        || current.node.inodeId !== sourceValue.node.inodeId) {
        fail("conflict", "$journal");
    }
    const proposedBytes = encodeUtf8(renderWakeflowMaintenanceJournal(proposed));
    admittedJournalByteCount(proposedBytes);
    const proposedDigest = computeWakeflowMaintenanceJournalDigest(proposed);
    let replacement;
    try {
        replacement = await replaceFileAtomically(root, sourceValue.resourcePath, proposedBytes, {
            mode: 0o600,
            expected: Object.freeze({
                resourcePath: sourceValue.resourcePath,
                node: sourceValue.node,
                byteCount: sourceValue.node.byteCount,
                digest: sourceValue.digest,
            }),
        });
    }
    catch (error) {
        if (error instanceof DurableAtomicFileWriteError) {
            if (error.reason === "input")
                fail("input", error.path);
            if (error.reason === "expectation-changed"
                || error.reason === "expectation-read-failure"
                || error.reason === "target-exists") {
                fail("conflict", "$journal");
            }
            if (error.reason === "stage-recovery-required") {
                fail("recovery-required", "$journal");
            }
            if (error.reason === "commit-uncertain"
                || error.reason === "durability-failure"
                || error.reason === "stage-cleanup-failure"
                || error.reason === "close-failure") {
                fail("commit-uncertain", "$journal");
            }
            fail("effect-failure", "$journal");
        }
        throw error;
    }
    let source;
    try {
        source = await readWakeflowMaintenanceJournal(root, context.operationId);
    }
    catch {
        fail("commit-uncertain", "$journal");
    }
    if (replacement.digest !== source.digest
        || replacement.byteCount !== source.node.byteCount
        || replacement.node.deviceId !== source.node.deviceId
        || replacement.node.inodeId !== source.node.inodeId
        || source.journalDigest !== proposedDigest) {
        fail("commit-uncertain", "$journal");
    }
    return source;
}
/** exact-retire 的共同一段：唯一事务复验、CAS 重读、exact unlink 与提交后空事务复验。 */
async function retireExactWakeflowMaintenanceJournal(root, context, source) {
    admitOperation(context.operationId, "exact-retire");
    await assertWakeflowMaintenanceJournalIsOnlyTransaction(root, source);
    const current = await readWakeflowMaintenanceJournal(root, context.operationId);
    if (current.digest !== source.digest
        || current.journalDigest !== source.journalDigest
        || current.node.deviceId !== source.node.deviceId
        || current.node.inodeId !== source.node.inodeId) {
        fail("conflict", "$journal");
    }
    let retirement;
    try {
        retirement = await unlinkRegularFileExactly(root, source.resourcePath, { expectedNode: source.node });
    }
    catch (error) {
        if (error instanceof ExactRegularFileUnlinkError) {
            if (error.reason === "source-changed"
                || error.reason === "source-not-found") {
                fail("conflict", "$journal");
            }
            if (error.reason === "commit-uncertain"
                || error.reason === "durability-failure"
                || error.reason === "close-failure") {
                fail("commit-uncertain", "$journal");
            }
            fail("effect-failure", "$journal");
        }
        throw error;
    }
    try {
        await assertTransactionsEmpty(root);
    }
    catch {
        fail("commit-uncertain", "$journal");
    }
    return retirement;
}
/** 在同一有效 gate scope 内退休尚未执行任何 step 的 exact prepared journal。 */
export async function retirePreparedWakeflowMaintenanceJournal(root, context, sourceValue) {
    assertGate(root, context);
    if (typeof sourceValue !== "object"
        || sourceValue === null
        || !ISSUED_SOURCES.has(sourceValue)
        || sourceValue.operationId !== context.operationId
        || sourceValue.journal.checkpoint !== 0
        || sourceValue.journal.state !== "prepared") {
        fail("input", "$source");
    }
    const retirement = await retireExactWakeflowMaintenanceJournal(root, context, sourceValue);
    return Object.freeze({
        disposition: "retired-prepared",
        operationId: context.operationId,
        journalDigest: sourceValue.journalDigest,
        retirement,
    });
}
/** 在同一有效 gate scope 内退休已经terminal的exact journal。 */
export async function retireTerminalWakeflowMaintenanceJournal(root, context, sourceValue) {
    assertGate(root, context);
    if (typeof sourceValue !== "object"
        || sourceValue === null
        || !ISSUED_SOURCES.has(sourceValue)
        || sourceValue.operationId !== context.operationId
        || sourceValue.journal.state !== "terminal"
        || sourceValue.journal.affectedStepId !== null
        || sourceValue.journal.checkpoint !== sourceValue.journal.stepIds.length) {
        fail("input", "$source");
    }
    await retireExactWakeflowMaintenanceJournal(root, context, sourceValue);
}
