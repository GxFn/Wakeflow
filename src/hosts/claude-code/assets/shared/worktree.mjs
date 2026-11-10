// worktree pod 的检出准备与观察（两个助手共用）：只在仓库主检出里用 git 建检出，只碰 .git/info/exclude 这一个非跟踪文件。

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { refuse } from "./failure.mjs";
import { boundedDetail, git, run } from "./host-process.mjs";
import { realpathOrNull } from "./workspace.mjs";

export const WORKTREE_NAME_PATTERN = /^[a-z][a-z0-9-]{0,63}$/u;
const WORKTREE_EXCLUDE_LINE = ".claude/worktrees/";
const WORKTREE_EXCLUDE_PATTERN = /^\/?\.claude\/worktrees\/?$/u;

/**
 * 登记请求要的 git worktree 原文事实：`git worktree list --porcelain` 与 `--git-common-dir`。
 * @param {string} cwd
 */
export function observeWorktree(cwd) {
  const porcelain = run("git", ["worktree", "list", "--porcelain"], { cwd });
  const commonDir = run("git", ["rev-parse", "--git-common-dir"], { cwd });
  if (
    !porcelain.ok ||
    !commonDir.ok ||
    porcelain.stdout.length === 0 ||
    commonDir.stdout.trim().length === 0
  )
    return null;
  return Object.freeze({ porcelain: porcelain.stdout, commonDir: commonDir.stdout.trim() });
}

// 仓库的 .git/info/exclude 里保证有 ".claude/worktrees/" 一行，主检出的 status 才不会多出一行未跟踪目录；
// 只碰这个非跟踪文件，从不改仓库里的任何跟踪文件。
/**
 * @param {string} gitDir
 * @returns {"present" | "appended"}
 */
function ensureWorktreeExclude(gitDir) {
  const infoDirectory = path.join(gitDir, "info");
  const excludeFile = path.join(infoDirectory, "exclude");
  let existing = "";
  try {
    existing = readFileSync(excludeFile, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") refuse("worktree-exclude-failed", { operation: "read" });
  }
  if (existing.split("\n").some((line) => WORKTREE_EXCLUDE_PATTERN.test(line.trim())))
    return "present";
  try {
    mkdirSync(infoDirectory, { recursive: true });
    appendFileSync(
      excludeFile,
      `${(existing.length === 0 || existing.endsWith("\n") ? "" : "\n") + WORKTREE_EXCLUDE_LINE}\n`,
    );
  } catch {
    refuse("worktree-exclude-failed", { operation: "write" });
  }
  return "appended";
}

// 本仓库 git worktree list --porcelain 登记的检出路径（realpath）。
/** @param {string} repositoryRoot */
function registeredWorktrees(repositoryRoot) {
  const listed = git(repositoryRoot, ["worktree", "list", "--porcelain"]);
  if (!listed.ok) refuse("worktree-list-failed", { detail: boundedDetail(listed.stderr) });
  return listed.stdout
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => realpathOrNull(line.slice(9)) ?? line.slice(9));
}

// basePolicy local-head 的实现（§13.130 H4）：claude --worktree 对不存在的路径会从远端默认分支建检出、对已有检出
// 只加锁复用，所以助手先在仓库主检出按本地 HEAD 把检出准备好——tmux 窗口随后由 claude --worktree 复用它，桌面会话
// 以它为 cwd 启动（不传 --worktree，app 才不会把它当成自己的 worktree，L17 E6、E8）。
/**
 * @param {string} repositoryRoot
 * @param {string} name
 * @returns {Readonly<PreparedWorktree>}
 */
export function prepareWorktree(repositoryRoot, name) {
  // §13.130：配置的落点必须就是仓库顶层，否则 git 会落到上层仓库；任何写入之前先核对。
  const placement = realpathOrNull(repositoryRoot);
  const toplevel = git(repositoryRoot, ["rev-parse", "--show-toplevel"]);
  if (placement === null || !toplevel.ok || realpathOrNull(toplevel.stdout.trim()) !== placement)
    refuse("worktree-root-not-toplevel");
  const commonDir = git(repositoryRoot, ["rev-parse", "--git-common-dir"]);
  if (!commonDir.ok || commonDir.stdout.trim().length === 0) refuse("worktree-repository-invalid");
  const checkout = path.join(repositoryRoot, ".claude", "worktrees", name);
  const branch = `worktree-${name}`;
  if (existsSync(checkout)) {
    // §13.130：只有本仓库登记的这条检出才算复用；其他占位目录拒绝，不写任何东西。
    const registered = registeredWorktrees(repositoryRoot);
    const resolved = realpathOrNull(checkout);
    if (resolved === null || !registered.includes(resolved))
      refuse("worktree-path-occupied", { branch });
    return Object.freeze({
      prepared: "reused",
      branch,
      checkout,
      root: placement,
      exclude: ensureWorktreeExclude(path.resolve(repositoryRoot, commonDir.stdout.trim())),
    });
  }
  // §13.130：分支已存在而检出不在时不复用旧分支（它可能不在本地 HEAD 上），交给 Controller 问用户。
  if (git(repositoryRoot, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).ok)
    refuse("worktree-branch-exists", { branch });
  const exclude = ensureWorktreeExclude(path.resolve(repositoryRoot, commonDir.stdout.trim()));
  const added = git(repositoryRoot, ["worktree", "add", "-b", branch, checkout, "HEAD"]);
  if (!added.ok)
    refuse("worktree-add-failed", {
      branch,
      status: added.status,
      detail: boundedDetail(added.stderr),
    });
  return Object.freeze({ prepared: "created", branch, checkout, root: placement, exclude });
}
