import { parseWakeflowConfig, type WakeflowConfigModel } from "./wakeflow-config.js";
import { renderWakeflowConfig } from "./wakeflow-config-document.js";

/**
 * Wakeflow Configuration：退出路径的 Config 推导（ADR-0024）。
 *
 * `detach-repository` 发布去掉该仓库及其产品窗口的 Config：这里从当前模型推导期望模型，
 * 维护能力用它组请求，静态物化预览用同一函数重算并核对。worktree pod 对该仓库的占用由
 * 能力层在推导之前以 `detach-pod-open:<podId>` 阻塞，所以推导只删仓库与窗口，不碰 pod 记录。
 * 最后一个仓库不能单独分离（配置文法要求至少一个仓库）：那是 `detach-workspace` 的事。
 */

export type WakeflowDetachRepositoryBlockerCode =
  | "detach-repository-unknown"
  | "detach-repository-last";

export type WakeflowDetachRepositoryDerivation =
  | Readonly<{
      readonly kind: "config";
      readonly model: WakeflowConfigModel;
      /** 随仓库一起离开配置的窗口（所有 pod 里以该仓库为根的产品窗口），排序。 */
      readonly windowIds: readonly string[];
    }>
  | Readonly<{
      readonly kind: "blocked";
      readonly blockerCode: WakeflowDetachRepositoryBlockerCode;
    }>;

interface WireWindow {
  readonly windowId: string;
  readonly root: { readonly kind: string; readonly repositoryId?: string };
}

interface WireTopology {
  repositories: { readonly repositoryId: string }[];
  windows: WireWindow[];
}

interface WirePod {
  worktrees: { readonly repositoryId: string }[];
}

/** 以该仓库为根的窗口 ID（任何 pod），排序；`null` 取全部窗口（detach-workspace）。 */
export function wakeflowDetachedWindowIds(
  model: WakeflowConfigModel,
  repositoryId: string | null,
): readonly string[] {
  return Object.freeze(
    model.topology.windows
      .filter(
        (window) =>
          repositoryId === null ||
          (window.root.kind === "repository" && window.root.repositoryId === repositoryId),
      )
      .map((window) => String(window.windowId))
      .sort(),
  );
}

/** 从当前模型推导 detach-repository 的期望模型；未知或最后一个仓库给出阻塞码。 */
export function deriveWakeflowDetachRepositoryConfig(
  model: WakeflowConfigModel,
  repositoryId: string,
): WakeflowDetachRepositoryDerivation {
  const repositories = model.topology.repositories;
  if (!repositories.some((entry) => entry.repositoryId === repositoryId)) {
    return Object.freeze({ kind: "blocked", blockerCode: "detach-repository-unknown" });
  }
  if (repositories.length === 1) {
    return Object.freeze({ kind: "blocked", blockerCode: "detach-repository-last" });
  }
  // 经渲染再解析：模型是冻结的类型化视图，期望模型必须重新经过完整的配置文法。
  const document = JSON.parse(renderWakeflowConfig(model)) as {
    topology: WireTopology;
    pods: WirePod[];
  };
  const windowIds = wakeflowDetachedWindowIds(model, repositoryId);
  document.topology.repositories = document.topology.repositories.filter(
    (entry) => entry.repositoryId !== repositoryId,
  );
  document.topology.windows = document.topology.windows.filter(
    (window) => !windowIds.includes(window.windowId),
  );
  // worktree pod 对该仓库的检出记录随仓库离开配置，推导才过文法；这样的 pod 本身由能力层以
  // detach-pod-open 阻塞，推导出的期望 Config 不会被发布。
  for (const pod of document.pods) {
    pod.worktrees = pod.worktrees.filter((worktree) => worktree.repositoryId !== repositoryId);
  }
  return Object.freeze({ kind: "config", model: parseWakeflowConfig(document), windowIds });
}
