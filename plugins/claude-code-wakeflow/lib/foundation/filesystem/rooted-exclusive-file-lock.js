import { setTimeout as delay } from "node:timers/promises";
import { types } from "node:util";
import { threadId } from "node:worker_threads";
import { renderDeterministicJsonDocument, DeterministicJsonDocumentError, } from "../data/deterministic-json-document.js";
import { parseDenseArray, parsePlainRecord, PassiveOwnDataError, } from "../data/passive-own-data.js";
import { createUuidV4, parseUuidV4, UuidV4Error, } from "../identity/uuid-v4.js";
import { readNodeSystemErrorCode } from "../node/node-system-error.js";
import { parseByteCount } from "../numeric/byte-count.js";
import { encodeUtf8 } from "../text/utf8.js";
import { readMonotonicClock, } from "../time/monotonic-clock.js";
import { isMonotonicDeadlineReached, monotonicDeadlineAfter, monotonicDeadlineRemaining, } from "../time/monotonic-deadline.js";
import { monotonicDurationFromMilliseconds, } from "../time/monotonic-duration.js";
import { createFileAtomically, DurableAtomicFileWriteError, } from "./durable-atomic-file-write.js";
import { DURABLE_ATOMIC_FILE_STAGE_MAXIMUM_TARGET_SCOPE, recoverDurableAtomicFileStagesForTargets, DurableAtomicFileStageRecoveryError, } from "./durable-atomic-file-stage-recovery.js";
import { readDeterministicJsonFile } from "./deterministic-json-file.js";
import { unlinkRegularFileExactly, ExactRegularFileUnlinkError, } from "./exact-regular-file-unlink.js";
import { sameFileNodeSnapshot, } from "./file-node-snapshot.js";
import { parsePortableResourcePath, PortableResourcePathError, splitPortableResourcePath, } from "./portable-resource-path.js";
import { RootedDirectory, RootedDirectoryError, } from "./rooted-directory.js";
import { StableFileReadError } from "./stable-file-read.js";
import { StrictTextFileError } from "./strict-text-file.js";
/**
 * Wakeflow Foundation / Filesystem：根作用域内的短生命周期独占文件锁。
 *
 * 锁记录通过 `DurableAtomicFileCreate` 的操作系统不替换边界完整发布。竞争者只等待
 * 并复验已有目标是权限位 `0600` 的普通文件（单链接；创建暂存仍在时为两个链接）；
 * 持有者可以跨 `await` 执行有界临界区，最后根据创建回执绑定的指定 inode 删除锁文件并同步父目录。
 *
 * 本层故意不自动打破失效锁。Node.js 没有暴露支持比较后删除的 `unlinkat` 或
 * `renameat2`；根据修改时间或进程号猜测后删除路径，可能在旧职责所有者释放锁、
 * 新职责所有者创建锁的窗口中误删新锁。崩溃残留必须由了解业务意图记录和进程事实的
 * 显式恢复职责所有者处理。本锁也不是分布式锁，不适用于不可靠的共享网络文件系统。
 * 同一 Node.js 进程和线程的职责所有者状态由内存活动令牌精确判断；其他线程或进程
 * 只能根据进程是否存在作保守判断，不能据此自动夺锁。
 */
const ROOTED_EXCLUSIVE_LOCK_DEFAULT_TIMEOUT_MILLISECONDS = 2_000;
const ROOTED_EXCLUSIVE_LOCK_DEFAULT_RETRY_MILLISECONDS = 25;
const ROOTED_EXCLUSIVE_LOCK_MAXIMUM_RECORD_BYTES = 4 * 1024;
const ERROR_MESSAGES = {
    "input": "Rooted exclusive file lock input is invalid.",
    "root-scope": "Rooted exclusive file lock lost its root scope.",
    "parent": "Rooted exclusive file lock parent is unavailable or unsafe.",
    "unsafe-lock": "Existing rooted exclusive lock target is not a safe lock record.",
    "acquire-failure": "Rooted exclusive file lock could not be acquired safely.",
    "timeout": "Rooted exclusive file lock acquisition timed out.",
    "aborted": "Rooted exclusive file lock acquisition was aborted.",
    "release-failure": "Rooted exclusive file lock could not release its exact record.",
    "owner-active": "Rooted exclusive file lock owner is still active or unverifiable.",
    "residue-changed": "Rooted exclusive file lock residue changed before retirement.",
};
/** exclusive lock 生命周期失败的稳定、脱敏错误。 */
export class RootedExclusiveFileLockError extends Error {
    name = "RootedExclusiveFileLockError";
    code = "wakeflow-rooted-exclusive-file-lock";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
const ISSUED_LOCK_OBSERVATIONS = new WeakSet();
const ACTIVE_LOCK_TOKENS = new Set();
const LOCK_RECORD_FIELDS = Object.freeze([
    "kind",
    "pid",
    "threadId",
    "token",
    "version",
]);
const LOCK_TOKEN_PATTERN = /^([1-9][0-9]*)-(0|[1-9][0-9]*)-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u;
const MAXIMUM_NODE_TIMER_DELAY_MILLISECONDS = 2_147_483_647;
function fail(reason, path) {
    throw new RootedExclusiveFileLockError(reason, path);
}
function assertRoot(value) {
    if (typeof value !== "object"
        || value === null
        || types.isProxy(value)
        || !(value instanceof RootedDirectory)) {
        fail("input", "$root");
    }
}
function parsePositiveMilliseconds(value, path) {
    if (typeof value !== "number"
        || !Number.isSafeInteger(value)
        || value <= 0) {
        fail("input", path);
    }
    return value;
}
function isAbortSignal(value) {
    return typeof value === "object"
        && value !== null
        && !types.isProxy(value)
        && value instanceof AbortSignal;
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
    const allowed = new Set([
        "acquireTimeoutMilliseconds",
        "retryDelayMilliseconds",
        "signal",
        "tokenUuidFactory",
    ]);
    if (Object.keys(record).some((key) => !allowed.has(key))) {
        fail("input", "$options");
    }
    if (record.signal !== undefined && !isAbortSignal(record.signal)) {
        fail("input", "$options.signal");
    }
    if (record.tokenUuidFactory !== undefined
        && (typeof record.tokenUuidFactory !== "function"
            || types.isProxy(record.tokenUuidFactory))) {
        fail("input", "$options.tokenUuidFactory");
    }
    return Object.freeze({
        acquireTimeoutMilliseconds: parsePositiveMilliseconds(record.acquireTimeoutMilliseconds === undefined
            ? ROOTED_EXCLUSIVE_LOCK_DEFAULT_TIMEOUT_MILLISECONDS
            : record.acquireTimeoutMilliseconds, "$options.acquireTimeoutMilliseconds"),
        retryDelayMilliseconds: parsePositiveMilliseconds(record.retryDelayMilliseconds === undefined
            ? ROOTED_EXCLUSIVE_LOCK_DEFAULT_RETRY_MILLISECONDS
            : record.retryDelayMilliseconds, "$options.retryDelayMilliseconds"),
        signal: record.signal,
        tokenUuidFactory: record.tokenUuidFactory,
    });
}
function parseRetirementTargets(lockPath, value) {
    let record;
    let relatedValues;
    try {
        record = parsePlainRecord(value === undefined ? {} : value, "$options");
        if (Object.keys(record).some((key) => key !== "relatedTargetResourcePaths")) {
            fail("input", "$options");
        }
        relatedValues = parseDenseArray(record.relatedTargetResourcePaths === undefined
            ? []
            : record.relatedTargetResourcePaths, DURABLE_ATOMIC_FILE_STAGE_MAXIMUM_TARGET_SCOPE - 1, "$options.relatedTargetResourcePaths");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", "$options");
        throw error;
    }
    const targets = [lockPath];
    for (const [index, value] of relatedValues.entries()) {
        let target;
        try {
            target = parsePortableResourcePath(value, `$options.relatedTargetResourcePaths/${index}`);
        }
        catch (error) {
            if (error instanceof PortableResourcePathError) {
                fail("input", `$options.relatedTargetResourcePaths/${index}`);
            }
            throw error;
        }
        if (targets.includes(target)) {
            fail("input", `$options.relatedTargetResourcePaths/${index}`);
        }
        targets.push(target);
    }
    const lockParent = splitPortableResourcePath(lockPath).slice(0, -1).join("/");
    if (targets.some((target) => (splitPortableResourcePath(target).slice(0, -1).join("/") !== lockParent))) {
        fail("input", "$options.relatedTargetResourcePaths");
    }
    return Object.freeze(targets);
}
function assertOperation(value) {
    if (typeof value !== "function" || types.isProxy(value)) {
        fail("input", "$operation");
    }
}
function assertNotAborted(signal) {
    if (signal?.aborted === true)
        fail("aborted", "$signal");
}
function readLockMonotonicClock() {
    try {
        return readMonotonicClock();
    }
    catch {
        fail("acquire-failure", "$lock");
    }
}
function lockDeadline(timeoutMilliseconds) {
    try {
        return monotonicDeadlineAfter(readLockMonotonicClock(), monotonicDurationFromMilliseconds(timeoutMilliseconds));
    }
    catch (error) {
        if (error instanceof RootedExclusiveFileLockError)
            throw error;
        fail("acquire-failure", "$lock");
    }
}
function createLockCandidate(tokenUuidFactory) {
    let tokenUuid;
    try {
        tokenUuid = tokenUuidFactory === undefined
            ? createUuidV4()
            : createUuidV4(tokenUuidFactory);
    }
    catch {
        fail("acquire-failure", "$lock");
    }
    const record = Object.freeze({
        kind: "WakeflowExclusiveFileLock",
        pid: process.pid,
        threadId,
        token: `${process.pid}-${threadId}-${tokenUuid}`,
        version: 1,
    });
    let bytes;
    try {
        bytes = encodeUtf8(renderDeterministicJsonDocument(record, "$lockRecord"), "$lockRecord");
    }
    catch {
        fail("acquire-failure", "$lock");
    }
    if (bytes.byteLength > ROOTED_EXCLUSIVE_LOCK_MAXIMUM_RECORD_BYTES) {
        fail("acquire-failure", "$lock");
    }
    return Object.freeze({ record, bytes });
}
function observeOwnerState(record) {
    if (record.pid === process.pid) {
        if (record.threadId !== threadId)
            return "unknown";
        return ACTIVE_LOCK_TOKENS.has(record.token) ? "active" : "inactive";
    }
    try {
        process.kill(record.pid, 0);
        return "active";
    }
    catch (error) {
        const code = readNodeSystemErrorCode(error);
        if (code === "ESRCH")
            return "inactive";
        return "unknown";
    }
}
function parseLockRecord(value) {
    let record;
    try {
        record = parsePlainRecord(value, "$lock");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("unsafe-lock", "$lock");
        throw error;
    }
    const keys = Object.keys(record).sort();
    if (keys.length !== LOCK_RECORD_FIELDS.length
        || keys.some((key, index) => key !== LOCK_RECORD_FIELDS[index])
        || record.kind !== "WakeflowExclusiveFileLock"
        || record.version !== 1
        || typeof record.pid !== "number"
        || !Number.isSafeInteger(record.pid)
        || record.pid <= 0
        || typeof record.threadId !== "number"
        || !Number.isSafeInteger(record.threadId)
        || record.threadId < 0
        || typeof record.token !== "string") {
        fail("unsafe-lock", "$lock");
    }
    const token = LOCK_TOKEN_PATTERN.exec(record.token);
    if (token === null
        || Number(token[1]) !== record.pid
        || Number(token[2]) !== record.threadId) {
        fail("unsafe-lock", "$lock");
    }
    try {
        parseUuidV4(token[3], "$lock/token");
    }
    catch (error) {
        if (error instanceof UuidV4Error)
            fail("unsafe-lock", "$lock");
        throw error;
    }
    return Object.freeze({
        kind: "WakeflowExclusiveFileLock",
        pid: record.pid,
        threadId: record.threadId,
        token: record.token,
        version: 1,
    });
}
/** 稳定观察锁记录；记录内容和令牌只供进程内恢复使用，不得进入公共结果。 */
export async function inspectRootedExclusiveFileLock(root, lockPath) {
    assertRoot(root);
    let read;
    try {
        read = await readDeterministicJsonFile(root, lockPath, {
            maximumBytes: parseByteCount(ROOTED_EXCLUSIVE_LOCK_MAXIMUM_RECORD_BYTES),
        });
    }
    catch (error) {
        if (error instanceof StableFileReadError
            && error.reason === "not-found") {
            const absent = Object.freeze({ status: "absent" });
            return absent;
        }
        if (error instanceof StableFileReadError
            && error.reason === "source-changed") {
            fail("residue-changed", "$lock");
        }
        if (error instanceof StableFileReadError) {
            if (error.reason === "symlink"
                || error.reason === "not-file"
                || error.reason === "too-large") {
                fail("unsafe-lock", "$lock");
            }
            if (error.reason === "input")
                fail("input", error.path);
            if (error.reason === "root-scope"
                || error.reason === "unsupported-platform") {
                fail("root-scope", "$root");
            }
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            // 打开、读取、关闭或摘要计算失败可能发生在旧持有者释放、新持有者获取的短窗口；
            // 锁竞争方只重试并受获取截止时间限制，绝不据此删除路径名。
            fail("residue-changed", "$lock");
        }
        if (error instanceof StrictTextFileError) {
            fail("unsafe-lock", "$lock");
        }
        if (error instanceof DeterministicJsonDocumentError) {
            fail("unsafe-lock", "$lock");
        }
        throw error;
    }
    // `createFileAtomically` 先 link(stage, target) 再 unlink stage，竞争者可能短暂看到两个链接。
    if (read.node.kind !== "file"
        || (read.node.linkCount !== 1n && read.node.linkCount !== 2n)
        || read.node.permissionBits !== 0o600
        || (typeof process.geteuid === "function"
            && read.node.userId !== BigInt(process.geteuid()))) {
        fail("unsafe-lock", "$lock");
    }
    const record = parseLockRecord(read.value);
    if (renderDeterministicJsonDocument(record, "$lock") !== read.text) {
        fail("unsafe-lock", "$lock");
    }
    const observation = Object.freeze({
        status: "held",
        record,
        node: read.node,
        byteCount: read.byteCount,
        digest: read.digest,
        ownerState: observeOwnerState(record),
    });
    ISSUED_LOCK_OBSERVATIONS.add(observation);
    return observation;
}
/**
 * 显式退休已经证明持有者不再活动，且仍与指定观察结果一致的锁残留。
 *
 * 调用方必须先持有自己的领域恢复证据；本函数不读取恢复意图记录，不根据
 * `mtime` 猜测锁是否过期，也不接受自行构造的观察结果。调用方声明的相关目标与
 * lockPath 必须位于同一父目录；发现集合外 stage 时保持锁和该 stage 不变。
 */
export async function retireRootedExclusiveFileLockResidue(root, lockPath, observation, options) {
    assertRoot(root);
    const retirementTargets = parseRetirementTargets(lockPath, options);
    if (typeof observation !== "object"
        || observation === null
        || !Object.isFrozen(observation)
        || !ISSUED_LOCK_OBSERVATIONS.has(observation)
        || observation.status !== "held") {
        fail("input", "$observation");
    }
    if (observation.ownerState !== "inactive")
        fail("owner-active", "$lock");
    try {
        const stageRecovery = await recoverDurableAtomicFileStagesForTargets(root, retirementTargets);
        if (stageRecovery.activeStageCount !== 0
            || stageRecovery.unknownStageCount !== 0) {
            fail("residue-changed", "$lock");
        }
    }
    catch (error) {
        if (error instanceof RootedExclusiveFileLockError)
            throw error;
        if (error instanceof DurableAtomicFileStageRecoveryError) {
            fail("residue-changed", "$lock");
        }
        throw error;
    }
    const current = await inspectRootedExclusiveFileLock(root, lockPath);
    if (current.status !== "held"
        || current.ownerState !== "inactive"
        || current.record.token !== observation.record.token
        || current.digest !== observation.digest
        || !sameFileNodeSnapshot(current.node, observation.node)) {
        fail("residue-changed", "$lock");
    }
    try {
        await unlinkRegularFileExactly(root, lockPath, {
            expectedNode: observation.node,
        });
    }
    catch (error) {
        if (error instanceof ExactRegularFileUnlinkError) {
            fail("residue-changed", "$lock");
        }
        throw error;
    }
}
function mapCreateError(error) {
    if (error.reason === "target-exists")
        return "contended";
    if (error.reason === "input")
        fail("input", error.path);
    if (error.reason === "root-scope")
        fail("root-scope", "$root");
    if (error.reason === "parent-not-found"
        || error.reason === "parent-symlink"
        || error.reason === "parent-not-directory"
        || error.reason === "parent-open-failure"
        || error.reason === "parent-changed") {
        fail("parent", "$lock");
    }
    if (error.reason === "aborted")
        fail("aborted", "$signal");
    fail("acquire-failure", "$lock");
}
async function lockTargetExists(root, lockPath) {
    try {
        await root.inspectExistingResource(lockPath, "$lock");
        return true;
    }
    catch (error) {
        if (error instanceof RootedDirectoryError) {
            if (error.reason === "resource-not-found")
                return false;
            if (error.reason === "resource-changed")
                return true;
            // 首次 lstat 后锁文件被并发删除时，真实路径检查只能报告观察失败；
            // 返回 contended 后 assertSafeExistingLock 会立即重新执行完整安全检查。
            if (error.reason === "inspection-failure")
                return true;
            if (error.reason === "resource-path")
                fail("input", "$lockPath");
            if (error.reason === "ancestor-symlink"
                || error.reason === "ancestor-type") {
                fail("parent", "$lock");
            }
            fail("root-scope", "$root");
        }
        throw error;
    }
}
async function tryAcquire(root, lockPath, signal, tokenUuidFactory) {
    // 竞争热点路径先执行一次不跟随符号链接的目标观察，避免每轮重试都扫描父目录。
    if (await lockTargetExists(root, lockPath))
        return null;
    const candidate = createLockCandidate(tokenUuidFactory);
    ACTIVE_LOCK_TOKENS.add(candidate.record.token);
    try {
        const created = await createFileAtomically(root, lockPath, candidate.bytes, {
            mode: 0o600,
            ...(signal === undefined ? {} : { signal }),
        });
        return Object.freeze({
            node: created.node,
            token: candidate.record.token,
        });
    }
    catch (error) {
        ACTIVE_LOCK_TOKENS.delete(candidate.record.token);
        if (error instanceof DurableAtomicFileWriteError) {
            if (mapCreateError(error) === "contended")
                return null;
        }
        throw error;
    }
}
async function assertSafeExistingLock(root, lockPath) {
    try {
        await inspectRootedExclusiveFileLock(root, lockPath);
    }
    catch (error) {
        if (error instanceof RootedExclusiveFileLockError) {
            if (error.reason === "residue-changed")
                return;
            if (error.reason === "root-scope") {
                try {
                    await root.assertCurrent("$root");
                    return;
                }
                catch {
                    throw error;
                }
            }
            throw error;
        }
        if (error instanceof RootedDirectoryError) {
            if (error.reason === "resource-not-found"
                || error.reason === "resource-changed")
                return;
            if (error.reason === "ancestor-symlink"
                || error.reason === "ancestor-type") {
                fail("parent", "$lock");
            }
            fail("root-scope", "$root");
        }
        throw error;
    }
}
async function waitForRetry(milliseconds, signal) {
    try {
        await delay(milliseconds, undefined, signal === undefined ? {} : { signal });
    }
    catch (error) {
        if (signal?.aborted === true) {
            fail("aborted", "$signal");
        }
        fail("acquire-failure", "$lock");
    }
}
function remainingRetryDelayMilliseconds(deadline, retryDelayMilliseconds) {
    const now = readLockMonotonicClock();
    if (isMonotonicDeadlineReached(deadline, now))
        fail("timeout", "$lock");
    const remaining = monotonicDeadlineRemaining(deadline, now);
    const oneMillisecond = 1000000n;
    let retry;
    let maximumTimer;
    try {
        retry = monotonicDurationFromMilliseconds(retryDelayMilliseconds);
        maximumTimer = monotonicDurationFromMilliseconds(MAXIMUM_NODE_TIMER_DELAY_MILLISECONDS);
    }
    catch {
        fail("input", "$options.retryDelayMilliseconds");
    }
    const bounded = remaining < retry ? remaining : retry;
    const timerBounded = bounded < maximumTimer ? bounded : maximumTimer;
    return Number((timerBounded + oneMillisecond - 1n) / oneMillisecond);
}
async function acquire(root, lockPath, options) {
    const deadline = lockDeadline(options.acquireTimeoutMilliseconds);
    while (true) {
        assertNotAborted(options.signal);
        if (isMonotonicDeadlineReached(deadline, readLockMonotonicClock())) {
            fail("timeout", "$lock");
        }
        const acquired = await tryAcquire(root, lockPath, options.signal, options.tokenUuidFactory);
        if (acquired !== null)
            return acquired;
        await assertSafeExistingLock(root, lockPath);
        await waitForRetry(remainingRetryDelayMilliseconds(deadline, options.retryDelayMilliseconds), options.signal);
    }
}
async function release(root, lockPath, acquired) {
    try {
        await unlinkRegularFileExactly(root, lockPath, {
            expectedNode: acquired.node,
            settlement: "replacement-allowed",
        });
    }
    catch (error) {
        if (error instanceof ExactRegularFileUnlinkError) {
            fail("release-failure", `$lock/${error.reason}`);
        }
        throw error;
    }
}
/** 在指定根作用域锁记录存续期间执行异步临界区。 */
export async function withRootedExclusiveFileLock(root, lockPath, operation, options) {
    assertRoot(root);
    assertOperation(operation);
    const parsed = parseOptions(options);
    const acquired = await acquire(root, lockPath, parsed);
    let result;
    let operationError;
    let operationFailed = false;
    try {
        result = await operation();
    }
    catch (error) {
        operationFailed = true;
        operationError = error;
    }
    try {
        await release(root, lockPath, acquired);
    }
    finally {
        ACTIVE_LOCK_TOKENS.delete(acquired.token);
    }
    if (operationFailed)
        throw operationError;
    return result;
}
