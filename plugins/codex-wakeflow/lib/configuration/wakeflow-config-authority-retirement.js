import { parseSha256Digest, Sha256Error } from "../foundation/crypto/sha256.js";
import { DurableResourceRenameError, renameResourceDurably, } from "../foundation/filesystem/durable-resource-rename.js";
import { RootedDirectory, RootedDirectoryError, } from "../foundation/filesystem/rooted-directory.js";
import { RootedExclusiveFileLockError, withRootedExclusiveFileLock, } from "../foundation/filesystem/rooted-exclusive-file-lock.js";
import { assertCurrentUserWakeflowConfigAuthorityRoot, currentWakeflowConfigAuthorityUserId, parseWakeflowConfigAuthorityReplacementOptions, WAKEFLOW_CONFIG_AUTHORITY_LOCK_REF, WakeflowConfigAuthorityReplacementError, wakeflowConfigAuthorityLockOptions, } from "./wakeflow-config-authority-replacement-contract.js";
import { readWakeflowConfigAuthoritySnapshot, readWakeflowDetachedConfigRecord, WAKEFLOW_CONFIG_FILE_REF, WAKEFLOW_DETACHED_CONFIG_FILE_REF, WakeflowConfigAuthoritySnapshotError, } from "./wakeflow-config-authority-snapshot.js";
const ERROR_MESSAGES = {
    input: "Wakeflow config authority retirement input is invalid.",
    "unsupported-platform": "Wakeflow config authority retirement requires POSIX ownership facts.",
    "root-scope": "Wakeflow config authority retirement lost its workspace root scope.",
    "root-policy": "Wakeflow config authority retirement requires a current-user workspace root.",
    source: "Wakeflow config authority retirement source is unavailable.",
    conflict: "Wakeflow config authority changed before retirement.",
    "destination-exists": "Wakeflow detached config file already exists beside the config.",
    lock: "Wakeflow config authority retirement could not take the config lock.",
    "commit-uncertain": "Wakeflow config authority retirement commit outcome is uncertain.",
    "retirement-failure": "Wakeflow config authority retirement failed.",
    aborted: "Wakeflow config authority retirement was aborted.",
};
/** Config 退役失败的稳定、脱敏错误。 */
export class WakeflowConfigAuthorityRetirementError extends Error {
    name = "WakeflowConfigAuthorityRetirementError";
    code = "wakeflow-config-authority-retirement";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
const REASONS = new Set(Object.keys(ERROR_MESSAGES));
function fail(reason, path) {
    throw new WakeflowConfigAuthorityRetirementError(reason, path);
}
/** 替换合同的准入错误按同名原因过桥，其余归为 retirement-failure。 */
function mapReplacementContractError(error) {
    if (REASONS.has(error.reason)) {
        fail(error.reason, error.path);
    }
    fail("retirement-failure", error.path);
}
function assertNotAborted(signal) {
    if (signal?.aborted === true)
        fail("aborted", "$signal");
}
async function configResourceExists(root) {
    try {
        await root.inspectExistingResource(WAKEFLOW_CONFIG_FILE_REF, "$config");
        return true;
    }
    catch (error) {
        if (error instanceof RootedDirectoryError && error.reason === "resource-not-found") {
            return false;
        }
        if (error instanceof RootedDirectoryError)
            fail("root-scope", "$root");
        throw error;
    }
}
async function readCurrentOrNull(root, signal) {
    try {
        return await readWakeflowConfigAuthoritySnapshot(root, signal === undefined ? undefined : { signal });
    }
    catch (error) {
        if (error instanceof WakeflowConfigAuthoritySnapshotError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            if (error.reason === "root-scope")
                fail("root-scope", "$root");
            if (error.reason === "source" && !(await configResourceExists(root)))
                return null;
            fail("source", "$config");
        }
        throw error;
    }
}
async function readDetached(root, signal) {
    try {
        return await readWakeflowDetachedConfigRecord(root, signal === undefined ? undefined : { signal });
    }
    catch (error) {
        if (error instanceof WakeflowConfigAuthoritySnapshotError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            if (error.reason === "root-scope")
                fail("root-scope", "$root");
            fail("source", "$detached");
        }
        throw error;
    }
}
function mapRenameError(error) {
    if (error.reason === "aborted")
        fail("aborted", "$signal");
    if (error.reason === "destination-exists")
        fail("destination-exists", "$detached");
    if (error.reason === "root-scope")
        fail("root-scope", "$root");
    if (error.reason === "commit-uncertain")
        fail("commit-uncertain", "$detached");
    fail("retirement-failure", "$config");
}
async function renameConfigToDetached(root, current, signal) {
    try {
        return await renameResourceDurably(root, WAKEFLOW_CONFIG_FILE_REF, WAKEFLOW_DETACHED_CONFIG_FILE_REF, {
            expectedSourceNode: current.source.node,
            ...(signal === undefined ? {} : { signal }),
        });
    }
    catch (error) {
        if (error instanceof DurableResourceRenameError)
            mapRenameError(error);
        fail("retirement-failure", "$config");
    }
}
/** 退役文件是同一个节点、同样的字节与摘要。 */
function retiredRecordMatches(after, expected, current, renamed) {
    return (after.configDigest === expected &&
        after.source.digest === current.source.digest &&
        after.source.byteCount === current.source.byteCount &&
        after.source.node.deviceId === renamed.node.deviceId &&
        after.source.node.inodeId === renamed.node.inodeId);
}
/** 提交后读回闭合：退役文件匹配，配置文件已不在。 */
async function assertRetirementReadback(root, expected, current, renamed) {
    let after = null;
    try {
        after = await readDetached(root, undefined);
    }
    catch {
        fail("commit-uncertain", "$detached");
    }
    const matches = after !== null && retiredRecordMatches(after, expected, current, renamed);
    if (after === null || !matches || (await configResourceExists(root))) {
        fail("commit-uncertain", "$detached");
    }
    return after;
}
async function retireUnderLock(root, expected, options, expectedUserId, markCommitted) {
    assertNotAborted(options.signal);
    const detached = await readDetached(root, options.signal);
    const current = await readCurrentOrNull(root, options.signal);
    if (current === null) {
        // 已经退役：只有带着期望摘要的退役文件在，才是"当前"；否则这里不是同一个工作区的终态。
        if (detached === null || detached.configDigest !== expected)
            fail("source", "$config");
        return Object.freeze({ disposition: "current", configDigest: expected, detached });
    }
    if (current.configDigest !== expected)
        fail("conflict", "$config");
    if (detached !== null)
        fail("destination-exists", "$detached");
    await assertCurrentUserWakeflowConfigAuthorityRoot(root, expectedUserId);
    assertNotAborted(options.signal);
    const renamed = await renameConfigToDetached(root, current, options.signal);
    markCommitted();
    const after = await assertRetirementReadback(root, expected, current, renamed);
    return Object.freeze({ disposition: "retired", configDigest: expected, detached: after });
}
function parseExpectedDigest(value) {
    try {
        return parseSha256Digest(value, "$expectedConfigDigest");
    }
    catch (error) {
        if (error instanceof Sha256Error)
            fail("input", "$expectedConfigDigest");
        throw error;
    }
}
/** 锁内外的失败归类：自己的错误原样抛，合同错误过桥，锁错误按是否已提交归为 lock 或 commit-uncertain。 */
function mapRetirementFailure(error, committed) {
    if (error instanceof WakeflowConfigAuthorityRetirementError)
        throw error;
    if (error instanceof WakeflowConfigAuthorityReplacementError) {
        mapReplacementContractError(error);
    }
    if (error instanceof RootedExclusiveFileLockError) {
        if (error.reason === "aborted")
            fail("aborted", "$signal");
        fail(committed ? "commit-uncertain" : "lock", "$lock");
    }
    fail(committed ? "commit-uncertain" : "retirement-failure", "$config");
}
/** 在 Config 专属短锁内把带期望摘要的配置文件改名为退役文件；已退役即幂等 current。 */
export async function retireWakeflowConfigAuthority(root, expectedConfigDigestValue, options) {
    if (!(root instanceof RootedDirectory))
        fail("input", "$root");
    const expected = parseExpectedDigest(expectedConfigDigestValue);
    let parsed;
    let expectedUserId;
    try {
        parsed = parseWakeflowConfigAuthorityReplacementOptions(options);
        expectedUserId = currentWakeflowConfigAuthorityUserId();
        await assertCurrentUserWakeflowConfigAuthorityRoot(root, expectedUserId);
    }
    catch (error) {
        mapRetirementFailure(error, false);
    }
    assertNotAborted(parsed.signal);
    let committed = false;
    try {
        return await withRootedExclusiveFileLock(root, WAKEFLOW_CONFIG_AUTHORITY_LOCK_REF, () => retireUnderLock(root, expected, parsed, expectedUserId, () => {
            committed = true;
        }), wakeflowConfigAuthorityLockOptions(parsed));
    }
    catch (error) {
        mapRetirementFailure(error, committed);
    }
}
