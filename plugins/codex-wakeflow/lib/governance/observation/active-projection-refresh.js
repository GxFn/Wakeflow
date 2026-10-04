import { readWakeflowConfigAuthoritySnapshot, WakeflowConfigAuthoritySnapshotError, } from "../../configuration/wakeflow-config-authority-snapshot.js";
import { RootedDirectory, RootedDirectoryError, } from "../../foundation/filesystem/rooted-directory.js";
import { publishActiveProjection, renderActiveProjectionFiles, } from "../../kernel/active-projection.js";
import { fail, WakeflowError } from "../../kernel/error.js";
import { withWorkspaceOperationScope } from "../../kernel/workspace-operation-scope.js";
import { buildActiveProjectionFacts } from "./active-projection-facts.js";
import { observeWorkspace } from "./workspace-observation.js";
function signalOptions(signal) {
    return signal === undefined ? {} : { signal };
}
async function openLedgerRoot(root, snapshot) {
    const placement = snapshot.placements.roots.find((entry) => entry.key === "ledger.root");
    if (placement === undefined || placement.state !== "present" || placement.realPath === null) {
        fail("precondition-failed", "ledger-root-missing", "$request.root");
    }
    try {
        return await RootedDirectory.open(placement.absolutePath, "$ledgerRoot", {
            durability: root.durability,
        });
    }
    catch (error) {
        if (error instanceof RootedDirectoryError) {
            fail("io-failure", "ledger-root", "$request.root", { cause: error });
        }
        throw error;
    }
}
async function readSnapshot(root, signal) {
    try {
        return await readWakeflowConfigAuthoritySnapshot(root, signalOptions(signal));
    }
    catch (error) {
        if (error instanceof WakeflowConfigAuthoritySnapshotError) {
            if (error.reason === "aborted")
                fail("io-failure", "aborted", "$signal", { cause: error });
            fail("io-failure", `config-${error.reason}`, "$request.root", { cause: error });
        }
        throw error;
    }
}
/** 锁内的一轮：观察、压成事实、渲染；退休证据与文件同出这一轮观察。 */
async function renderRound(root, snapshot, ledgerRoot, signal) {
    const observation = await observeWorkspace(root, snapshot, ledgerRoot, {
        hosts: [],
        currentHostId: null,
        scope: "projection",
        ...signalOptions(signal),
    });
    const facts = buildActiveProjectionFacts(observation);
    // 这一轮没看全活动 Demand 就一个页面目录都不删。
    return { files: renderActiveProjectionFiles(facts), activeDemands: facts.activeDemands };
}
/**
 * 观察、渲染、发布；返回发布回执（`unsafe` 表示手写文件让整轮零写）。
 *
 * 观察、事实与渲染都在投影锁内：发布只按锁内那一刻的字节做 CAS，本身不带先后，所以在锁外
 * 观察的两轮并发刷新可以按与各自观察相反的顺序落盘，把旧状态写在新状态上，一直留到下一次
 * 变更才自愈。配置与 Ledger 根也必须在 publisher 锁内读取，不能让闭包携带锁外的旧来源。
 */
export async function refreshActiveProjection(root, options = {}) {
    return withWorkspaceOperationScope(root, "shared", () => publishActiveProjection(root, async () => {
        const snapshot = await readSnapshot(root, options.signal);
        const ledgerRoot = await openLedgerRoot(root, snapshot);
        try {
            return await renderRound(root, snapshot, ledgerRoot, options.signal);
        }
        finally {
            await ledgerRoot.close();
        }
    }, {
        ...signalOptions(options.signal),
        ...(options.acquireTimeoutMilliseconds === undefined
            ? {}
            : { acquireTimeoutMilliseconds: options.acquireTimeoutMilliseconds }),
    }), signalOptions(options.signal));
}
/**
 * 静默刷新：吞掉已归类的 Wakeflow 失败（派生物不能否定已提交的事件）；中止、`unexpected`
 * 与非 Wakeflow 错误上抛。`unexpected` 是"没人认领的错误"，也就是编程错误的出口，静默它
 * 会让投影器自己的缺陷永远不被发现；已归类的失败（io-failure、precondition-failed、
 * capacity-exceeded 等）都是环境事实，下一次刷新或 `wakeflow_status` 会自愈。
 */
export async function refreshActiveProjectionQuietly(root, signal) {
    try {
        await refreshActiveProjection(root, signalOptions(signal));
    }
    catch (error) {
        if (!(error instanceof WakeflowError) || error.reason === "aborted" || error.code === "unexpected") {
            throw error;
        }
    }
}
/** 变更执行器的包装：先执行变更（提交或应用），成功后静默刷新一次投影，再返回变更结果。 */
export async function afterMutationRefresh(root, signal, mutate) {
    if (signal?.aborted === true)
        fail("io-failure", "aborted", "$signal");
    const result = await mutate();
    // mutate 已经返回提交结果；取消只跳过可重建投影，不能否定该结果。
    try {
        await refreshActiveProjectionQuietly(root, signal);
    }
    catch (error) {
        if (!(error instanceof WakeflowError) || error.reason !== "aborted")
            throw error;
    }
    return result;
}
