import { readWakeflowConfigAuthoritySnapshot, WakeflowConfigAuthoritySnapshotError, } from "../../configuration/wakeflow-config-authority-snapshot.js";
import { sameFileNodeIdentity, sameFileNodeSnapshot, } from "../../foundation/filesystem/file-node-snapshot.js";
import { RootedDirectory, RootedDirectoryError, } from "../../foundation/filesystem/rooted-directory.js";
import { loadDemandEventSourcingRootAuthority, DemandEventSourcingRootAuthorityError, } from "./event-sourcing/demand-event-sourcing-root-authority.js";
import { DEMAND_FILE_EVENT_STORE_DIRECTORY_MODE } from "./event-sourcing/demand-file-event-store-contract.js";
import { demandFinalRootRef } from "./publication/demand-publication-paths.js";
import { LedgerAuthorityStore, LedgerAuthorityStoreError, } from "../ledger/ledger-authority-store.js";
const ERROR_MESSAGES = {
    root: "Demand operation root could not be held safely.",
    config: "Demand operation Config authority is invalid.",
    "demand-authority": "Demand operation authority is invalid.",
    "stale-config": "Demand operation Config authority changed.",
    aborted: "Demand operation authority loading was aborted.",
};
/** 通用Demand操作上下文无法安全打开、保持或关闭时的稳定错误。 */
export class DemandOperationAuthorityContextError extends Error {
    name = "DemandOperationAuthorityContextError";
    code = "wakeflow-demand-operation-authority-context";
    reason;
    causeCode;
    causeReason;
    constructor(reason, causeCode = null, causeReason = null) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.causeCode = causeCode;
        this.causeReason = causeReason;
    }
}
function ownString(value, key) {
    if (typeof value !== "object" || value === null)
        return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined &&
        Object.hasOwn(descriptor, "value") &&
        typeof descriptor.value === "string"
        ? descriptor.value
        : null;
}
function fail(reason, cause) {
    throw new DemandOperationAuthorityContextError(reason, ownString(cause, "code"), ownString(cause, "reason"));
}
function currentUserId() {
    return typeof process.geteuid === "function"
        ? BigInt(process.geteuid())
        : null;
}
/** 从Workspace root安全打开一个已发布Demand的私有根目录。 */
export async function openDemandOperationRoot(workspaceRoot, demandId) {
    let observation;
    try {
        observation = await workspaceRoot.inspectExistingResource(demandFinalRootRef(demandId), "$demandRoot");
    }
    catch (error) {
        if (error instanceof RootedDirectoryError)
            fail("root", error);
        throw error;
    }
    if (observation.node.kind !== "directory" ||
        observation.node.permissionBits !==
            DEMAND_FILE_EVENT_STORE_DIRECTORY_MODE ||
        (currentUserId() !== null && observation.node.userId !== currentUserId())) {
        fail("root");
    }
    let demandRoot;
    try {
        demandRoot = await RootedDirectory.open(observation.physicalPath, "$demandRoot", 
        // 派生根继承来源根的持久化级别：同一次调用打开的多个根不得对耐久性有分歧。
        { durability: workspaceRoot.durability });
        const current = await demandRoot.assertCurrent("$demandRoot");
        if (!sameFileNodeIdentity(observation.node, current))
            fail("root");
        return demandRoot;
    }
    catch (error) {
        if (demandRoot !== undefined) {
            try {
                await demandRoot.close();
            }
            catch {
                // 首个打开或身份准入错误优先。
            }
        }
        if (error instanceof DemandOperationAuthorityContextError)
            throw error;
        if (error instanceof RootedDirectoryError)
            fail("root", error);
        throw error;
    }
}
/** 关闭一个Demand操作持有的RootedDirectory。 */
export async function closeDemandOperationRoot(root) {
    try {
        await root.close();
    }
    catch (error) {
        fail("root", error);
    }
}
async function openDemandAuthorityContext(workspaceRoot, demandId, signal, audit) {
    let config;
    try {
        config = await readWakeflowConfigAuthoritySnapshot(workspaceRoot, signal === undefined ? undefined : { signal });
    }
    catch (error) {
        if (error instanceof WakeflowConfigAuthoritySnapshotError) {
            if (error.reason === "aborted")
                fail("aborted", error);
            fail("config", error);
        }
        throw error;
    }
    let ledgerRoot;
    let demandRoot;
    try {
        ledgerRoot = await RootedDirectory.open(config.ledgerRoot, "$ledgerRoot", {
            // Ledger 根同样由工作区根派生，级别随来源根走。
            durability: workspaceRoot.durability,
        });
        demandRoot = await openDemandOperationRoot(workspaceRoot, demandId);
        const loaded = await loadDemandEventSourcingRootAuthority(demandRoot, new LedgerAuthorityStore(ledgerRoot), {
            ...(audit ? { audit: true } : {}),
            ...(signal === undefined ? {} : { signal }),
        });
        return Object.freeze({ config, demandRoot, ledgerRoot, loaded });
    }
    catch (error) {
        if (demandRoot !== undefined) {
            try {
                await demandRoot.close();
            }
            catch {
                // 首个权威加载错误优先。
            }
        }
        if (ledgerRoot !== undefined) {
            try {
                await ledgerRoot.close();
            }
            catch {
                // 首个权威加载错误优先。
            }
        }
        if (error instanceof DemandOperationAuthorityContextError)
            throw error;
        if (error instanceof RootedDirectoryError)
            fail("root", error);
        if (error instanceof DemandEventSourcingRootAuthorityError ||
            error instanceof LedgerAuthorityStoreError) {
            if (error.reason === "aborted")
                fail("aborted", error);
            fail("demand-authority", error);
        }
        throw error;
    }
}
/**
 * 打开当前Config、Ledger与Demand组合上下文；按 ADR-0005 默认走快照加尾部，
 * 校验类入口应直接用仓储的 `audit` 从 Commit 1 完整审计。
 */
export async function openDemandOperationAuthorityContext(workspaceRoot, demandId, signal) {
    return openDemandAuthorityContext(workspaceRoot, demandId, signal, false);
}
/**
 * 打开适合只读消费的Demand组合上下文；允许Root Authority使用Snapshot + tail，
 * 仍执行完整Inventory、Identity、Authority、Ledger、revision 1与当前Aggregate闭包。
 */
export async function openDemandReadAuthorityContext(workspaceRoot, demandId, signal) {
    return openDemandAuthorityContext(workspaceRoot, demandId, signal, false);
}
/** 关闭组合上下文持有的Demand与Ledger根，首个关闭失败优先。 */
export async function closeDemandOperationAuthorityContext(context) {
    let failure;
    try {
        await context.demandRoot.close();
    }
    catch (error) {
        failure = error;
    }
    try {
        await context.ledgerRoot.close();
    }
    catch (error) {
        if (failure === undefined)
            failure = error;
    }
    if (failure !== undefined)
        fail("root", failure);
}
/** Apply提交前复验同一Config字节与物理节点仍是Preview读取的权威。 */
export async function assertDemandOperationConfigCurrent(workspaceRoot, expected, signal) {
    let current;
    try {
        current = await readWakeflowConfigAuthoritySnapshot(workspaceRoot, signal === undefined ? undefined : { signal });
    }
    catch (error) {
        if (error instanceof WakeflowConfigAuthoritySnapshotError) {
            if (error.reason === "aborted")
                fail("aborted", error);
            fail("config", error);
        }
        throw error;
    }
    if (current.configDigest !== expected.configDigest ||
        current.source.digest !== expected.source.digest ||
        !sameFileNodeSnapshot(current.source.node, expected.source.node)) {
        fail("stale-config");
    }
}
