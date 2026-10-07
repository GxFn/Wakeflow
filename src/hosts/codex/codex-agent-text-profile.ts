/**
 * Wakeflow Host / Codex：agent 面文本的宿主取值表（gate-log §13.99 D3、D9）。
 *
 * 本模块是纯数据加确定性渲染，与 `codex-hook-fragment.ts` 同一模式：文本只有一份源
 * （`assets/agent-text/`，仓库相对，不出现任何宿主名），宿主差异写成九个封闭占位符，取值
 * 住在这里。制品构建器动态 import 本模块，对源目录里的每份 Markdown 做一次封闭替换后写进
 * 候选制品——源里出现未登记的占位符，或表里有没被任何源文件用到的取值，构建即失败。
 *
 * 语言（D6）：技能与命令只发英文，README 双语且与英文共用同一套占位符，所以取值分
 * `en` 与可选 `zh` 两面。`zh` 只给被中文源文件用到的键（`commandSurface`、`hostTrustSteps`）；
 * `instructionFile` 这类与语言无关的取值不带 `zh`，由构建器按"取值必须有用户"逐面核对。
 *
 * 渲染只替换不解析：替换用函数式 replacer，取值里的 `$` 不会被当成替换模式；一次遍历不
 * 回扫已替换的文本，所以取值里即便出现 `{{...}}` 也不会被二次展开。字节只由本表决定，不
 * 含版本号或构建标识，两次构建因此字节一致。
 *
 * 本模块不导入任何东西：取值是给人读的文本，没有运行时依赖，也不看对端宿主。
 */

/** 九个封闭占位符（D3，§13.118 加 windowBootstrap，重发守卫与窗口续接后加 resendGuard、windowResume）；源目录里出现表外的占位符即构建失败。 */
export type CodexAgentTextPlaceholderKey =
  | "instructionFile"
  | "windowLaunch"
  | "windowBootstrap"
  | "deliveryAction"
  | "worktreeLaunch"
  | "commandSurface"
  | "hostTrustSteps"
  | "windowResume"
  | "resendGuard";

/** 渲染语言：`zh` 只用于 `README.zh-CN.md`，其余源文件一律 `en`（D6）。 */
export type CodexAgentTextLanguage = "en" | "zh";

export interface CodexAgentTextPlaceholderValue {
  readonly en: string;
  /** 只给被中文源文件用到的键；多余的 `zh` 面没有用户，构建器拒绝。 */
  readonly zh?: string;
}

/** 命令面是 Claude 独有（D2）：Codex 插件不发 slash 命令，`commands/` 不进本候选。 */
export const CODEX_AGENT_TEXT_COMMANDS_INCLUDED = false;

const INSTRUCTION_FILE = "AGENTS.md";

/** Codex 线程不会被挪进新进程：relocate 在本宿主不适用，线程没了就开新线程再 replace（§13.134）。 */
const WINDOW_LAUNCH =
  "use list_projects to resolve the existing outer workspace project by canonical path and " +
  "host, then create_thread with target.type project, that projectId, and environment.type " +
  "local for every role. Never register role directories as projects or substitute projectless " +
  "chats or codex exec sessions. The chat starts in the workspace root; the role's execution " +
  "root is separate and must be stated in its startup prompt with windowId, role skill, scope " +
  "and return pointer. Read the execution root's instructions explicitly and use it as command " +
  "workdir. Retain the creation result and wait for a ready threadId; clientThreadId is not a " +
  "binding handle. Read back project membership and actual startup before registration. If " +
  "the list omits a newly created chat, use direct UI confirmation and disclose that limitation; " +
  "cwd and title alone do not prove project membership. A missing project or unavailable " +
  "creation tool is a blocker, not permission for an external fallback. Do not retry creation " +
  "after an ambiguous result until you establish whether the first chat exists. Keep requested " +
  "role chats visible; archive only when the user authorizes retiring them. A thread is never " +
  "moved into a new process, so relocate does not apply on this host; replace a gone thread " +
  "only with an authorized new chat in the same outer project.";

/** Codex 没有 tmux：Controller 就是当前线程，先登记自己再开别的。 */
const WINDOW_BOOTSTRAP =
  "reuse the current chat as Controller only when its outer workspace project membership " +
  "and workspace-root SessionStart are established. A source-maintenance chat in another " +
  "project is not that Controller. With the user's existing authorization, create the " +
  "Controller in the workspace project first, verify and register it, then handle the other " +
  "roles in that same project. Do not ask again for authorization already given. If this " +
  "chat is not that Controller, tell the user which chat is and continue there instead of " +
  "running the Controller flow from here.";

const DELIVERY_ACTION =
  "send the permit's prompt into the target window's thread with your Codex thread " +
  "tool, once, and keep exactly what that send call returned.";

const WORKTREE_LAUNCH =
  "create a linked checkout from the configured product repository's local HEAD using " +
  "git worktree add with the suggested branch name and an available checkout path inside " +
  "the Wakeflow workspace root, beside it in the same outer directory, or inside that product " +
  "repository - registration refuses a checkout anywhere else. Keep " +
  "the role chat in the same outer project using a local environment: create_thread's " +
  "worktree environment targets the project's primary repository. Pass the assigned " +
  "checkout in the startup prompt and record worktree.executionRoot from pwd there along " +
  "with git worktree list --porcelain and git rev-parse --git-common-dir. Wakeflow verifies " +
  "the checkout's repository and pointer files independently of the chat's SessionStart.";

/**
 * 插件更新后的窗口换代（§13.134）：本线程先换代——它的服务只有用户能重连，在那之前不跑维护、
 * 也不换别的窗口（过期服务给的启动意图是旧的）；之后其他过期窗口开新线程加 replace。
 */
const WINDOW_RESUME =
  "when this serving MCP is outdated, ask the user to restart the Codex app and resume " +
  "this existing chat before maintenance: only an app restart reloads Wakeflow's MCP server; " +
  "resuming or continuing a chat does not. A peer window that verify reports as `stale` " +
  "(its session started under an older artifact) is refreshed the same way - the user " +
  "restarts the app once and resumes that existing chat through the host; `unverified` " +
  "peers carry no such evidence and are left alone. Replace its binding only when the old " +
  "chat is gone and the user authorizes a replacement chat. A missing hook alone does not " +
  "justify creating or rebinding a chat.";

/** Codex 没有助手替你守重发：发送前自己看接收窗口的线程。 */
const RESEND_GUARD =
  "check the receiving window's thread before sending again; when the prompt already " +
  "arrived there, record or report that landing instead of sending a second time.";

const COMMAND_SURFACE_EN =
  "This host ships no slash commands. Say what you want in plain words; the skill " +
  "that is loaded routes it to the right tool.";

const COMMAND_SURFACE_ZH = "本宿主不发 slash 命令。直接说人话即可，已加载的技能会把它路由到对应工具。";

const HOST_TRUST_STEPS_EN = [
  "Codex desktop uses the Node runtime supplied by the app. In the CLI, ensure Node 24",
  "is on PATH when the host does not supply a runtime.",
  "Open `/hooks` and trust Wakeflow's four hooks after reviewing them by their",
  "definition hash. Until you do, all four are skipped: no session is observed, so no",
  "window can be registered and no delivery can be shown to have landed. A plugin",
  "update that changes the hook definition bytes (the 1.1.0 update did) makes Codex ask",
  "you to trust the four hooks again: after an update, open `/hooks` once; when nothing",
  "of Wakeflow's is waiting there, the update kept the hooks.",
].join("\n");

const HOST_TRUST_STEPS_ZH = [
  "Codex 桌面应用使用宿主自带的 Node。CLI 未提供宿主运行时时，需要 PATH 中有 Node 24。",
  "在 `/hooks` 里按定义哈希审阅并信任 Wakeflow 的四个 hook。信任之前四个 hook 全部被",
  "跳过：没有会话被观察到，窗口无法登记，投递也拿不到落地证据。插件更新改变了 hook 定义",
  "字节时（1.1.0 这次就改了），Codex 会要求重新信任这四个 hook：更新后打开一次 `/hooks`，",
  "里面没有 Wakeflow 的待审阅条目，说明这次更新没有动 hook。",
].join("\n");

/** 九个占位符的 Codex 取值；键序与 D3 列出的顺序一致，新增的两个排在最后。 */
export const CODEX_AGENT_TEXT_PLACEHOLDERS: Readonly<
  Record<CodexAgentTextPlaceholderKey, Readonly<CodexAgentTextPlaceholderValue>>
> = Object.freeze({
  instructionFile: Object.freeze({ en: INSTRUCTION_FILE }),
  windowLaunch: Object.freeze({ en: WINDOW_LAUNCH }),
  windowBootstrap: Object.freeze({ en: WINDOW_BOOTSTRAP }),
  deliveryAction: Object.freeze({ en: DELIVERY_ACTION }),
  worktreeLaunch: Object.freeze({ en: WORKTREE_LAUNCH }),
  commandSurface: Object.freeze({ en: COMMAND_SURFACE_EN, zh: COMMAND_SURFACE_ZH }),
  hostTrustSteps: Object.freeze({ en: HOST_TRUST_STEPS_EN, zh: HOST_TRUST_STEPS_ZH }),
  windowResume: Object.freeze({ en: WINDOW_RESUME }),
  resendGuard: Object.freeze({ en: RESEND_GUARD }),
});

/** 未登记占位符的稳定错误码；构建器的预检先于它触发，本抛出是最后一道防线。 */
export const CODEX_AGENT_TEXT_UNKNOWN_PLACEHOLDER_CODE = "wakeflow-agent-text-unknown-placeholder";

function codexAgentTextValue(key: string, language: CodexAgentTextLanguage): string {
  const value = (
    CODEX_AGENT_TEXT_PLACEHOLDERS as Readonly<
      Record<string, Readonly<CodexAgentTextPlaceholderValue> | undefined>
    >
  )[key];
  if (value === undefined) {
    throw new Error(`${CODEX_AGENT_TEXT_UNKNOWN_PLACEHOLDER_CODE}: ${key}`);
  }
  return language === "zh" ? (value.zh ?? value.en) : value.en;
}

/** 一次封闭替换：遍历一遍源文本，替换结果不再被回扫。 */
export function renderCodexAgentText(source: string, language: CodexAgentTextLanguage): string {
  return source.replace(/\{\{([A-Za-z]+)\}\}/gu, (_match: string, key: string): string =>
    codexAgentTextValue(key, language),
  );
}
