import type { JsonObject } from "../../foundation/data/json-value.js";
import type { WakeflowWindowLaunchInstructionInput } from "../../workspace/window-runtime/wakeflow-window-launch-instructions.js";
import type { WakeflowWorkspaceHostLaunchTemplate } from "../../workspace/workspace-host-resource-profile.js";

/**
 * Wakeflow Host / Claude Code：launch intent 到 Agent 启动分步的渲染，按窗口传输各一支（ADR-0025 D3）。
 *
 * tmux 传输（`tmux-session`）：pane 里起 `claude --session-id <Agent 生成> …`，登记带 tmux 坐标。
 * 桌面传输（`desktop-session`）：桌面助手以 `claude --bg … --name <标题>` 起会话、`claude stop` 后
 * `claude --desktop --resume <id>` 送进 Code 标签，会话 id 由宿主分配（`sessionIdPolicy: host-assigned`），
 * 登记带 `desktop.sessionId`；启动提示、`--name` 与 `--allowedTools` 由助手在这些参数之后追加，与 tmux 助手同形。
 * 两支共用配置覆盖（effort、model 按角色，permissionMode 整体）、`--add-dir` 规则与 worktree 事实。
 */

type LaunchIntent = WakeflowWindowLaunchInstructionInput["intent"];
type AttachedWorktrees = WakeflowWindowLaunchInstructionInput["attachedWorktrees"];
type SessionLaunchTemplate = Extract<
  WakeflowWorkspaceHostLaunchTemplate,
  { readonly kind: "tmux-session" | "desktop-session" }
>;

function claudeAddDirArguments(
  intent: LaunchIntent,
  attached: AttachedWorktrees,
  ledgerRoot: string,
): readonly string[] {
  const arguments_: string[] = [];
  if (intent.root.configuredPlacement !== ".") arguments_.push("--add-dir", "<workspace root>");
  // 账本在工作区之外（缺省的 `../wakeflow-ledger`）时每个窗口都要读需求包（投递提示词的阅读顺序列出
  // requirement.md 与 landing.md），它不在任何一个允许目录里（§13.133 现场 F11，§13.134）。
  if (ledgerRoot.startsWith("../")) arguments_.push("--add-dir", `<workspace root>/${ledgerRoot}`);
  for (const view of attached) {
    if (view.pathFromWorkspaceRoot !== null) {
      arguments_.push("--add-dir", `<workspace root>/${view.pathFromWorkspaceRoot}`);
    }
  }
  return arguments_;
}

/** tmux 会话名的上限（登记请求 Schema 的 `tmux.sessionName` maxLength）。 */
const TMUX_SESSION_NAME_MAXIMUM = 128;

/**
 * 窗口的 tmux 会话名（§13.186）：primary pod 用配置的会话名；worktree pod 各开一个自己的会话
 * `<配置名>-<pod 名>`，窗口不再挤在一个会话里。pod 名形如 `^[a-z][a-z0-9-]{0,31}$`，配置名最长 128，
 * 拼接超长时截断配置名那一段，保证整体不超过登记合同的上限。
 */
export function claudeCodeTmuxSessionNameFor(
  configured: string,
  intent: Readonly<{ readonly podPlacement: string; readonly podName: string }>,
): string {
  if (intent.podPlacement !== "worktree") return configured;
  const suffix = `-${intent.podName}`;
  const base = configured.slice(0, Math.max(1, TMUX_SESSION_NAME_MAXIMUM - suffix.length));
  return `${base}${suffix}`;
}

/**
 * pod 窗口显示名里 pod 名与模板标题之间的分隔（`<pod 名> · <标题>`，能力卡 9 Q6；生产者是 pod 切片的
 * `derivePodWindows`）。去前缀规则只认这一个常量：launch 指令的渲染（下面的 `claudeCodeTmuxWindowNameFor`）
 * 与 tmux 助手的 `mark`（`claude-code-tmux-asset.ts` 在构建脚本时填入同一常量）据此得到同一个窗口名，
 * mark 才不会把 launch 去掉的前缀加回去（open-items W28）。profile 测试钉住它能还原派生的显示名。
 */
export const CLAUDE_CODE_POD_WINDOW_TITLE_SEPARATOR = " · " as const;

/**
 * 窗口在 tmux 里的名字（§13.186）：worktree pod 的窗口已经在 pod 自己的会话里，显示名里的
 * `<pod 名> · ` 前缀（能力卡 9 Q6 的逻辑显示名，保持不变）在会话内是冗余的，tmux 窗口名去掉它；
 * primary pod 与没有前缀的显示名原样使用。助手里的 `tmuxWindowNameFor` 是同一规则的脚本副本。
 * 桌面传输的会话标题（`--name`，侧栏分组按 pod）用同一个名字。
 */
export function claudeCodeTmuxWindowNameFor(
  intent: Readonly<{
    readonly podPlacement: string;
    readonly podName: string;
    readonly displayTitle: string;
  }>,
): string {
  const prefix = `${intent.podName}${CLAUDE_CODE_POD_WINDOW_TITLE_SEPARATOR}`;
  return intent.podPlacement === "worktree" && intent.displayTitle.startsWith(prefix)
    ? intent.displayTitle.slice(prefix.length)
    : intent.displayTitle;
}

const WORKTREE_REGISTRATION =
  "after the session starts inside the worktree, report the handle plus the verbatim output of `git worktree list --porcelain` and `git rev-parse --git-common-dir` run in the session cwd";
const TMUX_WORKTREE_NOTE =
  "claude --worktree reuses an existing checkout at .claude/worktrees/<name> (create it from the local HEAD first for basePolicy local-head); without one it creates the checkout from the remote default branch when a remote exists; the session cwd is that checkout";
// 桌面会话绝不用 --worktree：桌面 app 与 agent view 会把检出当成自己的 worktree，归档会话就删掉检出（ADR-0025 D4）。
const DESKTOP_WORKTREE_NOTE =
  "the desktop helper prepares the checkout at .claude/worktrees/<name> from the local HEAD (basePolicy local-head) and starts claude --bg with that checkout as the session cwd; never pass --worktree: the desktop app would claim the checkout as its own worktree and archiving the session would delete it";

/** worktree pod 产品窗口的 worktree 事实：两种传输同一组字段，只有 note 说明检出怎样成为会话的 cwd。 */
function worktreeFacts(
  intent: LaunchIntent,
  profile: WakeflowWindowLaunchInstructionInput["profile"],
  note: string,
): JsonObject | null {
  if (intent.worktree === null) return null;
  return {
    repositoryId: intent.worktree.repositoryId,
    suggestedName: intent.worktree.suggestedName,
    basePolicy: intent.worktree.basePolicy,
    launch: profile.surfaces.worktree.launch,
    hostBranch: `worktree-${intent.worktree.suggestedName}`,
    registration: WORKTREE_REGISTRATION,
    note,
  };
}

/** 配置覆盖模板：effort 与 model 按角色，permissionMode 整体（用户裁决 Q4，§13.134）。 */
function launchPreferences(
  model: WakeflowWindowLaunchInstructionInput["model"],
  role: LaunchIntent["role"],
  template: SessionLaunchTemplate,
) {
  const host = model.hosts?.["claude-code"];
  const launch = host?.launch;
  return {
    host,
    effort:
      launch?.reasoningEffortByRole?.[role] ??
      launch?.reasoningEffortByRole?.default ??
      (role === "controller" ? template.controllerEffort : template.defaultEffort),
    modelName: launch?.modelByRole?.[role] ?? launch?.modelByRole?.default ?? null,
    permissionMode: launch?.permissionMode ?? template.permissionMode,
  };
}

function renderTmuxSessionLaunch(
  input: WakeflowWindowLaunchInstructionInput,
  template: Extract<SessionLaunchTemplate, { readonly kind: "tmux-session" }>,
): JsonObject {
  const { model, intent, profile, attachedWorktrees: attached } = input;
  const { host, effort, modelName, permissionMode } = launchPreferences(
    model,
    intent.role,
    template,
  );
  return {
    kind: profile.hostId,
    tmux: {
      socketName: host?.tmux?.socketName ?? null,
      sessionName: claudeCodeTmuxSessionNameFor(
        host?.tmux?.sessionName ?? template.sessionName,
        intent,
      ),
      windowName: claudeCodeTmuxWindowNameFor(intent),
      cwd: intent.root.configuredPlacement,
    },
    command: "claude",
    arguments: [
      ...(intent.worktree === null ? [] : ["--worktree", intent.worktree.suggestedName]),
      "--session-id",
      "<uuid-v4 generated by the Agent>",
      "--permission-mode",
      permissionMode,
      "--effort",
      effort,
      ...(modelName === null ? [] : ["--model", modelName]),
      ...claudeAddDirArguments(intent, attached, model.storage.ledgerRoot),
    ],
    sessionIdPolicy: "agent-generates-uuid-v4",
    registration:
      "report handle kind claude-session with the generated session id plus the tmux socket, session, window, and pane",
    worktree: worktreeFacts(intent, profile, TMUX_WORKTREE_NOTE),
    attachedWorktrees: attached,
  };
}

/**
 * 桌面会话：没有 `--session-id`（`--bg` 自己管理会话 id，助手从输出读回）、没有 `--worktree`（pod 窗口以
 * 准备好的检出为 cwd）；`desktop.title` 是 `--name` 的值，与 tmux 窗口名同一规则；`desktop.cwd` 是会话的
 * 启动目录（相对工作区根）。
 */
function renderDesktopSessionLaunch(
  input: WakeflowWindowLaunchInstructionInput,
  template: Extract<SessionLaunchTemplate, { readonly kind: "desktop-session" }>,
): JsonObject {
  const { model, intent, profile, attachedWorktrees: attached } = input;
  const { effort, modelName, permissionMode } = launchPreferences(model, intent.role, template);
  return {
    kind: "claude-code-desktop",
    desktop: {
      title: claudeCodeTmuxWindowNameFor(intent),
      cwd: intent.root.configuredPlacement,
    },
    command: "claude",
    arguments: [
      "--permission-mode",
      permissionMode,
      "--effort",
      effort,
      ...(modelName === null ? [] : ["--model", modelName]),
      ...claudeAddDirArguments(intent, attached, model.storage.ledgerRoot),
    ],
    sessionIdPolicy: "host-assigned",
    registration:
      "report handle kind claude-session with the host-assigned session id read back from claude --bg, plus desktop.sessionId local_<that id>",
    worktree: worktreeFacts(intent, profile, DESKTOP_WORKTREE_NOTE),
    attachedWorktrees: attached,
  };
}

/** Claude owns its CLI, window-transport and attached-directory arguments. */
export function renderClaudeCodeWindowLaunchInstructions(
  input: WakeflowWindowLaunchInstructionInput,
): JsonObject {
  const template = input.profile.launch;
  switch (template.kind) {
    case "tmux-session":
      return renderTmuxSessionLaunch(input, template);
    case "desktop-session":
      return renderDesktopSessionLaunch(input, template);
    default:
      throw new Error("Expected a session launch template.");
  }
}
