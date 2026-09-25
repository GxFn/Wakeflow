import { createFileAtomically, DurableAtomicFileWriteError, } from "../../foundation/filesystem/durable-atomic-file-write.js";
import { recoverDurableAtomicFileStagesForTargets, DurableAtomicFileStageRecoveryError, } from "../../foundation/filesystem/durable-atomic-file-stage-recovery.js";
import { readDeterministicJsonFile, } from "../../foundation/filesystem/deterministic-json-file.js";
import { DeterministicJsonDocumentError, parseDeterministicJsonDocument, } from "../../foundation/data/deterministic-json-document.js";
import { unlinkRegularFileExactly, ExactRegularFileUnlinkError, } from "../../foundation/filesystem/exact-regular-file-unlink.js";
import { RootedDirectory, RootedDirectoryError, } from "../../foundation/filesystem/rooted-directory.js";
import { readStableResourceDirectory, StableDirectoryReadError, } from "../../foundation/filesystem/stable-directory-read.js";
import { StableFileReadError, } from "../../foundation/filesystem/stable-file-read.js";
import { StrictTextFileError, } from "../../foundation/filesystem/strict-text-file.js";
import { parseByteCount, } from "../../foundation/numeric/byte-count.js";
import { admitWakeflowResourceOperation, WakeflowResourceProcessingContractError, } from "../../foundation/resource/resource-processing-contract.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import { assertWakeflowMaintenanceGateContext, WakeflowMaintenanceGateError, } from "./wakeflow-maintenance-gate.js";
import { computeWakeflowMaintenanceExecutionIntentDigest, createWakeflowMaintenanceIntentResourceDeclaration, parseWakeflowMaintenanceExecutionIntent, renderWakeflowMaintenanceExecutionIntent, WakeflowMaintenanceExecutionIntentError, } from "./wakeflow-maintenance-execution-intent.js";
import { parseWakeflowMaintenanceOperationId, WakeflowMaintenanceOperationIdError, wakeflowMaintenanceIntentRef, wakeflowMaintenanceJournalRef, } from "./wakeflow-maintenance-operation-id.js";
import { WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_REF, } from "./wakeflow-maintenance-resource-catalog.js";
/**
 * Wakeflow Workspace / Maintenance：immutable execution intent 的私有物理 store。
 *
 * Intent 以0600 absent-only原子发布一次，随后只读并由mutable journal的intentDigest绑定。
 * 每次目录形状检查都只接受同operation的 intent 或 intent+journal；它不是第二状态机。
 */
export const WAKEFLOW_MAINTENANCE_EXECUTION_INTENT_MAXIMUM_BYTES = parseByteCount(2 * 1024 * 1024, "$maintenanceIntent.maximumBytes");
const ERROR_MESSAGES = {
    input: "Wakeflow maintenance execution intent store input is invalid.",
    gate: "Wakeflow maintenance execution intent store requires the active matching gate.",
    "transactions-shape": "Wakeflow maintenance transaction resources have an invalid shape.",
    source: "Wakeflow maintenance execution intent cannot be read stably.",
    "source-policy": "Wakeflow maintenance execution intent violates its node policy.",
    intent: "Wakeflow maintenance execution intent content is invalid.",
    capacity: "Wakeflow maintenance execution intent exceeds its capacity.",
    conflict: "Wakeflow maintenance execution intent changed before its exact effect.",
    "recovery-required": "Wakeflow maintenance execution intent requires explicit recovery.",
    "effect-failure": "Wakeflow maintenance execution intent effect failed safely.",
    "commit-uncertain": "Wakeflow maintenance execution intent commit could not be proven.",
};
/** Maintenance execution intent store 失败的稳定、脱敏错误。 */
export class WakeflowMaintenanceExecutionIntentStoreError extends Error {
    name = "WakeflowMaintenanceExecutionIntentStoreError";
    code = "wakeflow-maintenance-execution-intent-store";
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
    throw new WakeflowMaintenanceExecutionIntentStoreError(reason, path);
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
function admittedByteCount(bytes) {
    if (bytes.byteLength > WAKEFLOW_MAINTENANCE_EXECUTION_INTENT_MAXIMUM_BYTES) {
        fail("capacity", "$intent");
    }
    return parseByteCount(bytes.byteLength, "$intent.byteCount");
}
/** 在任何bootstrap/gate效果前验证intent的确定性持久表示容量。 */
export function assertWakeflowMaintenanceExecutionIntentCapacity(value) {
    let bytes;
    try {
        bytes = encodeUtf8(renderWakeflowMaintenanceExecutionIntent(value));
    }
    catch (error) {
        if (error instanceof WakeflowMaintenanceExecutionIntentError) {
            fail("input", "$intent");
        }
        throw error;
    }
    return admittedByteCount(bytes);
}
function currentUserId() {
    if (process.platform === "win32" || typeof process.geteuid !== "function") {
        fail("source-policy", "$intent");
    }
    return BigInt(process.geteuid());
}
function assertSource(value) {
    if (typeof value !== "object"
        || value === null
        || !ISSUED_SOURCES.has(value)) {
        fail("input", "$intentSource");
    }
}
function admitOperation(operationId, recipe) {
    try {
        admitWakeflowResourceOperation(createWakeflowMaintenanceIntentResourceDeclaration(operationId).processing, recipe);
    }
    catch (error) {
        if (error instanceof WakeflowResourceProcessingContractError) {
            fail("input", "$intent");
        }
        throw error;
    }
}
async function assertTransactionEntries(root, expected) {
    let read;
    try {
        read = await readStableResourceDirectory(root, WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_REF, { maximumEntries: expected.length });
    }
    catch (error) {
        if (error instanceof StableDirectoryReadError) {
            fail("transactions-shape", "$transactions");
        }
        throw error;
    }
    const actual = read.entries.map((entry) => entry.resourcePath).sort();
    const sortedExpected = [...expected].sort();
    if (actual.length !== sortedExpected.length
        || actual.some((entry, index) => entry !== sortedExpected[index])) {
        fail("transactions-shape", "$transactions");
    }
}
/** 证明transactions目录精确为空。 */
async function assertWakeflowMaintenanceTransactionsEmpty(root) {
    return assertTransactionEntries(root, []);
}
/** 证明transactions只含指定exact intent。 */
export async function assertWakeflowMaintenanceIntentIsOnlyTransactionPrefix(root, source) {
    assertSource(source);
    await assertTransactionEntries(root, [source.resourcePath]);
    await assertIntentSourceCurrent(root, source);
}
/** 证明transactions只含同operation的exact intent与journal。 */
export async function assertWakeflowMaintenanceIntentAndJournalAreOnlyTransaction(root, source) {
    assertSource(source);
    await assertTransactionEntries(root, [
        source.resourcePath,
        wakeflowMaintenanceJournalRef(source.operationId),
    ]);
    await assertIntentSourceCurrent(root, source);
}
async function assertIntentSourceCurrent(root, source) {
    const current = await readWakeflowMaintenanceExecutionIntent(root, source.operationId);
    if (current.digest !== source.digest
        || current.intentDigest !== source.intentDigest
        || current.node.deviceId !== source.node.deviceId
        || current.node.inodeId !== source.node.inodeId) {
        fail("conflict", "$intent");
    }
}
async function resourceNodeOrNull(root, resourcePath) {
    try {
        return (await root.inspectExistingResource(resourcePath)).node;
    }
    catch (error) {
        if (error instanceof RootedDirectoryError
            && error.reason === "resource-not-found") {
            return null;
        }
        if (error instanceof RootedDirectoryError)
            fail("source", "$intent");
        throw error;
    }
}
/** 对exact intent target执行关闭作用域的Foundation stage恢复。 */
export async function recoverWakeflowMaintenanceExecutionIntentStages(root, operationIdValue) {
    const operationId = admittedOperationId(operationIdValue);
    try {
        const receipt = await recoverDurableAtomicFileStagesForTargets(root, Object.freeze([wakeflowMaintenanceIntentRef(operationId)]));
        if (receipt.activeStageCount !== 0 || receipt.unknownStageCount !== 0) {
            fail("recovery-required", "$intentStage");
        }
        return receipt;
    }
    catch (error) {
        if (error instanceof WakeflowMaintenanceExecutionIntentStoreError) {
            throw error;
        }
        if (error instanceof DurableAtomicFileStageRecoveryError) {
            fail("recovery-required", "$intentStage");
        }
        throw error;
    }
}
async function readIntentAtNode(root, operationId, node) {
    if (node.kind !== "file"
        || node.permissionBits !== 0o600
        || node.linkCount !== 1n
        || node.userId !== currentUserId()) {
        fail("source-policy", "$intent");
    }
    const resourcePath = wakeflowMaintenanceIntentRef(operationId);
    let read;
    try {
        read = await readDeterministicJsonFile(root, resourcePath, {
            maximumBytes: WAKEFLOW_MAINTENANCE_EXECUTION_INTENT_MAXIMUM_BYTES,
            expectedNode: node,
        });
    }
    catch (error) {
        if (error instanceof StableFileReadError) {
            if (error.reason === "too-large")
                fail("capacity", "$intent");
            fail("source", "$intent");
        }
        if (error instanceof StrictTextFileError
            || error instanceof DeterministicJsonDocumentError) {
            fail("intent", "$intent");
        }
        throw error;
    }
    let intent;
    try {
        intent = parseWakeflowMaintenanceExecutionIntent(read.value);
        if (renderWakeflowMaintenanceExecutionIntent(intent) !== read.text) {
            fail("intent", "$intent");
        }
    }
    catch (error) {
        if (error instanceof WakeflowMaintenanceExecutionIntentError) {
            fail("intent", error.path);
        }
        throw error;
    }
    if (intent.operationId !== operationId)
        fail("intent", "$/operationId");
    const intentDigest = computeWakeflowMaintenanceExecutionIntentDigest(intent);
    const source = Object.freeze({
        operationId,
        resourcePath,
        node: read.node,
        digest: read.digest,
        intentDigest,
        intent,
    });
    ISSUED_SOURCES.add(source);
    return source;
}
/** 读取并严格复验一个immutable execution intent。 */
export async function readWakeflowMaintenanceExecutionIntent(root, operationIdValue) {
    const operationId = admittedOperationId(operationIdValue);
    const node = await resourceNodeOrNull(root, wakeflowMaintenanceIntentRef(operationId));
    if (node === null)
        fail("source", "$intent");
    return readIntentAtNode(root, operationId, node);
}
/** 读取可选intent；absent与unsafe source严格区分。 */
export async function readWakeflowMaintenanceExecutionIntentOrNull(root, operationIdValue) {
    const operationId = admittedOperationId(operationIdValue);
    const node = await resourceNodeOrNull(root, wakeflowMaintenanceIntentRef(operationId));
    return node === null ? null : readIntentAtNode(root, operationId, node);
}
/** 在有效gate内absent-only发布并重读一份immutable intent。 */
export async function publishWakeflowMaintenanceExecutionIntent(root, context, intentValue) {
    try {
        assertWakeflowMaintenanceGateContext(context, root);
    }
    catch (error) {
        if (error instanceof WakeflowMaintenanceGateError) {
            fail("gate", "$context");
        }
        throw error;
    }
    let intent;
    let text;
    try {
        text = renderWakeflowMaintenanceExecutionIntent(intentValue);
        intent = parseWakeflowMaintenanceExecutionIntent(parseDeterministicJsonDocument(text, "$intent"));
    }
    catch (error) {
        if (error instanceof WakeflowMaintenanceExecutionIntentError) {
            fail("input", "$intent");
        }
        throw error;
    }
    if (intent.operationId !== context.operationId) {
        fail("input", "$/operationId");
    }
    admitOperation(context.operationId, "exclusive-create");
    await assertWakeflowMaintenanceTransactionsEmpty(root);
    const bytes = encodeUtf8(text);
    admittedByteCount(bytes);
    const intendedDigest = computeWakeflowMaintenanceExecutionIntentDigest(intent);
    let publication;
    try {
        publication = await createFileAtomically(root, wakeflowMaintenanceIntentRef(context.operationId), bytes, { mode: 0o600 });
    }
    catch (error) {
        if (error instanceof DurableAtomicFileWriteError) {
            if (error.reason === "target-exists")
                fail("conflict", "$intent");
            if (error.reason === "stage-recovery-required") {
                fail("recovery-required", "$intent");
            }
            if (error.reason === "commit-uncertain"
                || error.reason === "durability-failure"
                || error.reason === "stage-cleanup-failure"
                || error.reason === "close-failure") {
                fail("commit-uncertain", "$intent");
            }
            fail("effect-failure", "$intent");
        }
        throw error;
    }
    let source;
    try {
        source = await readWakeflowMaintenanceExecutionIntent(root, context.operationId);
    }
    catch {
        fail("commit-uncertain", "$intent");
    }
    if (publication.resourcePath !== source.resourcePath
        || publication.digest !== source.digest
        || publication.byteCount !== source.node.byteCount
        || publication.node.deviceId !== source.node.deviceId
        || publication.node.inodeId !== source.node.inodeId
        || source.intentDigest !== intendedDigest) {
        fail("commit-uncertain", "$intent");
    }
    return source;
}
/** 在journal仍存在时先精确退休immutable intent。 */
export async function retireWakeflowMaintenanceExecutionIntent(root, context, source) {
    try {
        assertWakeflowMaintenanceGateContext(context, root);
    }
    catch (error) {
        if (error instanceof WakeflowMaintenanceGateError) {
            fail("gate", "$context");
        }
        throw error;
    }
    assertSource(source);
    if (source.operationId !== context.operationId) {
        fail("input", "$intentSource");
    }
    admitOperation(context.operationId, "exact-retire");
    await assertWakeflowMaintenanceIntentAndJournalAreOnlyTransaction(root, source);
    let retirement;
    try {
        retirement = await unlinkRegularFileExactly(root, source.resourcePath, { expectedNode: source.node });
    }
    catch (error) {
        if (error instanceof ExactRegularFileUnlinkError) {
            if (error.reason === "source-changed"
                || error.reason === "source-not-found") {
                fail("conflict", "$intent");
            }
            if (error.reason === "commit-uncertain"
                || error.reason === "durability-failure"
                || error.reason === "close-failure") {
                fail("commit-uncertain", "$intent");
            }
            fail("effect-failure", "$intent");
        }
        throw error;
    }
    try {
        await assertTransactionEntries(root, [
            wakeflowMaintenanceJournalRef(context.operationId),
        ]);
    }
    catch {
        fail("commit-uncertain", "$intent");
    }
    return Object.freeze({
        disposition: "retired-intent",
        operationId: context.operationId,
        intentDigest: source.intentDigest,
        retirement,
    });
}
