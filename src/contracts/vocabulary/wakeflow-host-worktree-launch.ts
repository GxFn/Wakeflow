/**
 * Wakeflow Contracts / Vocabulary：宿主为 worktree pod 开窗的两种方式（宿主资源 Profile 的
 * `surfaces.worktree.launch`）。pod 的处置指引按它选择宿主备选。
 */

export const WAKEFLOW_WORKSPACE_HOST_WORKTREE_LAUNCHES = Object.freeze([
  "claude-worktree-flag",
  "git-worktree",
] as const);
export type WakeflowWorkspaceHostWorktreeLaunch =
  (typeof WAKEFLOW_WORKSPACE_HOST_WORKTREE_LAUNCHES)[number];
