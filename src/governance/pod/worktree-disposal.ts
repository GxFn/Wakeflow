import type { WakeflowHostId } from "../../contracts/vocabulary/wakeflow-host-id.js";

/**
 * Wakeflow Governance / Pod：closing pod 仍在的检出的处置引导（gate-log §13.94 D10）。
 *
 * Wakeflow 从不删除 worktree（ADR-0010 D4）：这里只给 Agent 一条建议命令与一条宿主备选，
 * pod 关闭结果与 status 的 pod 段共用。路径是相对工作区根的相对路径，不含绝对路径。
 */

export interface WorktreeDisposalGuidance {
  readonly suggested: string;
  readonly alternative: string;
}

export function worktreeDisposalGuidance(
  hostId: WakeflowHostId,
  relativeCheckoutPath: string,
): Readonly<WorktreeDisposalGuidance> {
  return Object.freeze({
    suggested: `git worktree remove ${relativeCheckoutPath}`,
    alternative:
      hostId === "claude-code"
        ? "End the Claude Code worktree session; Claude Code removes a worktree it created when the session ends, then run git worktree prune in the repository."
        : "Archive the Codex thread that owns the worktree environment, then run git worktree prune in the repository.",
  });
}
