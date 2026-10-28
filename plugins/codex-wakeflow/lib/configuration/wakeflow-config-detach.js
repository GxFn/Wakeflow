import { parseWakeflowConfig } from "./wakeflow-config.js";
import { renderWakeflowConfig } from "./wakeflow-config-document.js";
/** 以该仓库为根的窗口 ID（任何 pod），排序；`null` 取全部窗口（detach-workspace）。 */
export function wakeflowDetachedWindowIds(model, repositoryId) {
    return Object.freeze(model.topology.windows
        .filter((window) => repositoryId === null ||
        (window.root.kind === "repository" && window.root.repositoryId === repositoryId))
        .map((window) => String(window.windowId))
        .sort());
}
/** 从当前模型推导 detach-repository 的期望模型；未知或最后一个仓库给出阻塞码。 */
export function deriveWakeflowDetachRepositoryConfig(model, repositoryId) {
    const repositories = model.topology.repositories;
    if (!repositories.some((entry) => entry.repositoryId === repositoryId)) {
        return Object.freeze({ kind: "blocked", blockerCode: "detach-repository-unknown" });
    }
    if (repositories.length === 1) {
        return Object.freeze({ kind: "blocked", blockerCode: "detach-repository-last" });
    }
    // 经渲染再解析：模型是冻结的类型化视图，期望模型必须重新经过完整的配置文法。
    const document = JSON.parse(renderWakeflowConfig(model));
    const windowIds = wakeflowDetachedWindowIds(model, repositoryId);
    document.topology.repositories = document.topology.repositories.filter((entry) => entry.repositoryId !== repositoryId);
    document.topology.windows = document.topology.windows.filter((window) => !windowIds.includes(window.windowId));
    // worktree pod 对该仓库的检出记录随仓库离开配置，推导才过文法；这样的 pod 本身由能力层以
    // detach-pod-open 阻塞，推导出的期望 Config 不会被发布。
    for (const pod of document.pods) {
        pod.worktrees = pod.worktrees.filter((worktree) => worktree.repositoryId !== repositoryId);
    }
    return Object.freeze({ kind: "config", model: parseWakeflowConfig(document), windowIds });
}
