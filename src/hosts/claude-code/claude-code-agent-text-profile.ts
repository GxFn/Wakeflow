import { CLAUDE_CODE_TMUX_ASSET_COMMAND } from "./claude-code-tmux-asset.js";

/**
 * Wakeflow Host / Claude Code：agent 面文本的宿主取值表（gate-log §13.99 D3、D9）。
 *
 * 本模块是纯数据加确定性渲染，与 `claude-code-hook-fragment.ts` 同一模式：文本只有一份源
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
 * 本模块只导入 tmux 助手的命令常量（与权限规则同源）；取值是给人读的文本，没有运行时依赖，也不看对端宿主。
 */

/** 九个封闭占位符（D3，§13.118 加 windowBootstrap，重发守卫与窗口续接后加 resendGuard、windowResume）；源目录里出现表外的占位符即构建失败。 */
export type ClaudeCodeAgentTextPlaceholderKey =
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
export type ClaudeCodeAgentTextLanguage = "en" | "zh";

export interface ClaudeCodeAgentTextPlaceholderValue {
  readonly en: string;
  /** 只给被中文源文件用到的键；多余的 `zh` 面没有用户，构建器拒绝。 */
  readonly zh?: string;
}

/** 命令面是 Claude 独有（D2）：四个命令随本候选发出。 */
export const CLAUDE_CODE_AGENT_TEXT_COMMANDS_INCLUDED = true;

const INSTRUCTION_FILE = "CLAUDE.md";

/** 助手的调用前缀：从工作区根用 node 调用，与权限规则同一字符串（§13.117 D4、D5）。 */
const TMUX_HELPER: string = CLAUDE_CODE_TMUX_ASSET_COMMAND;

const WINDOW_LAUNCH =
  "pipe the intent (the `launchIntent` that `wakeflow_register_window_binding` inspect " +
  "returns, or the maintenance result's entry for that window) into the tmux helper, run " +
  `from the workspace root: \`${TMUX_HELPER} launch --window <windowId>\`. Make every helper ` +
  "call its own Bash command with literal arguments - no shell loop, variable or chain of " +
  "helper calls: only such a plain call matches the helper's allow rule, and anything else " +
  "stops at a permission prompt the user has to answer. The helper opens " +
  "the tmux window at the intent's root, starts `claude` with the listed parameters and a " +
  "fresh session id, waits for the session-start hook record, and prints the creation " +
  "observation to register verbatim. After each registration run `mark --window <windowId>` " +
  "so the tmux window " +
  "carries the five Wakeflow options; `panes` prints the tmux-panes observation, and " +
  "`close --window <windowId>` prints the closure evidence a decommission needs. When a " +
  "registered window's pane is gone but its session should continue (tmux restarted, pane " +
  "closed by mistake), pipe the inspect result into `resume --window <windowId>`: it starts " +
  "`claude --resume` with the bound session in a new pane and prints the observation for the " +
  "binding tool's `relocate`, which keeps the binding and records the new pane; then `mark` again. " +
  "`launch` and `resume` refuse while the located pane is still alive (`locator-live`; a live " +
  "window on an older plugin is restarted with `resume --in-place`, as the plugin-update steps " +
  "say), and report " +
  "`resume-exited` / `launch-exited` when `claude` quit before its SessionStart hook: a session " +
  "that never held a conversation cannot be resumed, so launch a fresh window instead. Both wait " +
  "up to `--wait <seconds>` (default 20, at most 120) for that hook record; `hook.sessionStart: pending` with " +
  "a live pane leaves startup unproven; inspect hook execution, keep the observation, and register or " +
  "relocate with it once the record exists, and pass a longer `--wait` next time.";

/**
 * 插件更新后的窗口换代（§13.134 C8、C16）：先就地重启 Controller 自己，再逐个就地重启其他过期
 * 窗口。过期的服务算出的启动意图是旧代码的（例如仍是旧的 acceptEdits 缺省），维护也不能从它跑，
 * 所以本窗口先换代：助手排好两秒后的重启，会话带着新插件与新的 MCP 服务器自己续上，用户不必
 * `/mcp` 重连，也不必碰 tmux；续上后 verify、必要时对账装上新助手，才轮到其他窗口。窗格已经没了
 * 的续接（新窗格 + relocate）仍在 WINDOW_LAUNCH 里。工作区里的助手只由维护部署：还是就地重启
 * 之前的旧助手时它以 `argument-unknown` 拒绝 `--in-place`，这一次只能先由用户 `/mcp` 重连本窗口
 * 的服务、再对账装上新助手，然后从头再来。
 */
const WINDOW_RESUME =
  "if this serving MCP is outdated, first tell the user in one sentence " +
  "that this window will restart in place in a few seconds and carry on by itself, then pipe " +
  `your own inspect result into \`${TMUX_HELPER} resume --window <this windowId> --in-place\` ` +
  "and end your turn. It returns at once (`self: true`, `scheduled: true`); about two seconds " +
  "later this session restarts with the updated plugin and a fresh Wakeflow server - no " +
  "`/mcp` reconnect is needed - and resumes by itself with a prompt to load this skill again " +
  "(the copy in your context predates the update), call `wakeflow_verify` and continue where " +
  "you left off. A helper installed before in-place restarts existed " +
  "refuses `--in-place` as `argument-unknown`: then ask the user to run `/mcp` in this window " +
  "and reconnect `wakeflow`, run a reconcile as in step 0, which installs the current helper, " +
  "and start this section again. If this server is already current, skip its restart. For peer " +
  "windows that verify reports as `stale` (`windows-stale:<n>`: each such session started under an older artifact), take them one at a time, each only while it sits idle at an empty prompt, and " +
  "pipe each one's inspect result into `resume --window <windowId> --in-place`, one helper " +
  "call per Bash command. The session restarts inside its own pane on the updated plugin; the " +
  "binding, coordinates and marks stay, so there is nothing to relocate or mark, and " +
  "`hook.sessionStart: pending` means startup is unproven; inspect hook execution. `window-busy` " +
  "means that window is working, shows a dialog or menu, or holds typed input, and `--force` " +
  "does not override it: go on with the next window and retry this one once its turn has " +
  "ended - a dialog, a menu or typed input waits for the user, so tell them which window it " +
  "is. `resume-exited` means the process exited before startup evidence; read the refusal's `hint` and that pane before retrying. " +
  "`resume-never-conversed` reports missing conversation evidence: inspect host history first. " +
  "Only if a fresh session is required and authorized, close the old one, launch it again, " +
  "register it with `replace` and `mark` it.";

/** 重发守卫：助手发送前查接收窗口的落地记录（§13.127）。 */
const RESEND_GUARD =
  "the helper checks the receiving window's landing record before it sends and refuses " +
  "with `already-landed`, printing that landing, when the prompt is already there; record " +
  "or report that landing instead of forcing a second send (`--force` is only for a prompt " +
  "you have established never reached the window).";

/**
 * Controller 自己怎么进 tmux：用户是被引导者，从不自己配置 tmux（§13.118）。引导会话登记前就被
 * 关掉时，tmux 里的 Controller 用 `launch` 收编仍在运行的窗口再登记（§13.134 I6），不在 tmux
 * 里 teardown。收编被拒时按助手的 hint 引导用户：在多出来或无从证明的窗口里退出 claude（仍停在
 * 信任对话框的窗口只需接受它），或关掉跑着别的东西的窗口，然后再 launch。
 */
const WINDOW_BOOTSTRAP =
  `run \`${TMUX_HELPER} preflight\` and read \`insideTmux\`. When it is true this session is ` +
  "the Controller: register it with `self` (pipe your own window's inspect result in). A " +
  "window that a setup session started but never registered (it was closed too early) is " +
  "still running: `launch` it as below and the helper adopts it instead of opening a second " +
  "one (`adopted: true`); register that observation as usual, and run `mark --all` once every " +
  "window is registered. If adoption is refused (`adopt-unproven`, `window-ambiguous`, " +
  "`window-present-not-claude`), never open a second window and never `teardown` from inside " +
  "tmux: tell the user which window it is and what the refusal's `hint` asks of them - exit " +
  "`claude` there with `/exit` (in all but one of the windows, for `window-ambiguous`), or " +
  "close a window that runs something else with `Ctrl-b &` and then `y` - and `launch` again " +
  "once they have. An unproven window that still shows its trust dialog only needs that " +
  "dialog accepted. When `insideTmux` " +
  "is false this session only bootstraps and must not register itself: `launch` the Controller " +
  "window's own intent too, so a fresh Controller starts inside the tmux session the helper " +
  "creates, launch every other window with `--wait 0`, then give the user the exact `attach` " +
  "command the helper printed, ask them to accept the trust dialog in every window (`Ctrl-b n` " +
  "moves to the next one), to keep this session open until you have registered the windows, " +
  "and to tell you when the dialogs are done; only then register each window " +
  "from the observations you kept, run `mark --all`, and tell the user to continue in the tmux " +
  "Controller and close this session. The user never sets tmux up by hand: you do it and tell " +
  "them the one thing to run or press. If a bootstrap has to be redone before any window was " +
  "registered, `teardown` kills that tmux session; with registered windows it refuses unless " +
  "`--force`.";

const DELIVERY_ACTION =
  "pipe the permit's prompt into the tmux helper, run from the workspace root: " +
  `\`${TMUX_HELPER} deliver --window <windowId> --handle-digest <the permit's handleDigest>\`. ` +
  "It checks the pane against the locator and the handle digest, refuses before sending with " +
  "`target-not-at-prompt` when the pane shows a dialog or menu instead of its input box (nothing " +
  "was sent: ask the user to answer it in that window, then send again - a target delivery recorded as " +
  "`failed-before-send` is re-armed by the Controller, a callback is simply delivered again with the same " +
  "permit; never send keys to that window yourself), pastes the prompt, presses " +
  "Return once and captures the pane once, then waits a few seconds for the target session's prompt-submit hook record and prints the `attempt`, `readback` and `landing` to " +
  "record verbatim. `readback: confirmed` only means the prompt's first line, or Claude " +
  "Code's collapsed `[Pasted text #N +M lines]` indicator with the matching line count, was " +
  "on screen; landing is proven by the hook record alone. From a product or surface window, prefix the helper path with the " +
  "workspace root you were given with `--add-dir` instead of running from the root; the " +
  "helper finds the workspace from its own location.";

const WORKTREE_LAUNCH =
  "the helper's `launch` prepares it when it starts the product window with " +
  "`claude --worktree <name>` from a `local-head` worktree intent: it creates " +
  "`<repository>/.claude/worktrees/<name>` from the repository's local HEAD on branch " +
  "`worktree-<name>`, reuses the checkout only when this repository's worktree list has it, " +
  "and adds `.claude/worktrees/` to the repository's `.git/info/exclude`; its result says " +
  "`worktreePrepared: created` or `reused`. It refuses without writing when the placement is " +
  "not the repository top level (`worktree-root-not-toplevel`), when `worktree-<name>` exists " +
  "without its checkout (`worktree-branch-exists`: ask the user whether to delete or rename it) " +
  "or when another directory holds the path (`worktree-path-occupied`). A launch that fails " +
  "after the checkout was prepared still reports `worktreePrepared` and `worktreeBranch`, so " +
  "tell the user that checkout was left behind. Do not start such a window with a " +
  "bare `claude --worktree`: without an existing checkout Claude Code creates it from the " +
  "remote default branch, not from the local HEAD.";

const COMMAND_SURFACE_EN =
  "`/wakeflow:init` sets up or repairs the workspace, `/wakeflow:status` reports where " +
  "it stands, `/wakeflow:next` takes the next step on the active Demand, and " +
  "`/wakeflow:pod` creates or closes a pod. Claude Code always namespaces plugin commands, so " +
  "the `wakeflow:` prefix is part of the name.";

const COMMAND_SURFACE_ZH =
  "`/wakeflow:init` 初始化或修复工作区，`/wakeflow:status` 报告当前状态，" +
  "`/wakeflow:next` 在活动 Demand 上推进一步，`/wakeflow:pod` 创建或关闭 pod。" +
  "Claude Code 的插件命令一律带插件名前缀，`wakeflow:` 是命令名的一部分。";

/** README 的一次性宿主动作；窗口缺省以 auto 权限模式启动（用户裁决 Q4，§13.134）。 */
const HOST_TRUST_STEPS_EN = [
  "The first time you start Claude Code in the workspace directory, accept the",
  "workspace trust dialog. Without it neither the plugin's hooks nor the status line",
  "run, so no session is observed and no delivery can be shown to have landed.",
  "`wakeflow_maintain_workspace` writes the status line command into a managed block in",
  "`settings.local.json`; that block belongs to Wakeflow, and a `statusLine` you rewrite",
  "yourself is reported as a difference the next time the workspace is reconciled.",
  "",
  "You never set tmux up by hand. Start `claude` in the workspace directory and run",
  "`/wakeflow:init`: the Controller creates the tmux session and every window itself through",
  "the helper maintenance installs at",
  "`.wakeflow-local/runtime/hosts/claude-code/operations/assets/tmux.mjs`, tells you the exact",
  "`tmux attach` command once the windows are up, and which trust dialogs to accept. It",
  "delivers prompts through the same helper. Maintenance also writes precise allow rules for",
  "that helper and the Wakeflow MCP tools into the workspace root's `.claude/settings.json`,",
  "and every window the helper launches or resumes is started with those two tools allowed,",
  "so product and test windows do not stop at a permission prompt for them either; nothing",
  "broader such as `Bash(tmux *)` is written.",
  "",
  "By default every window the helper launches runs in Claude Code's `auto` permission mode:",
  "Claude Code reviews routine actions itself instead of asking you. A window may still ask",
  "you a one-time question the first time, for example whether to allow reads outside its",
  "working directories; the Controller tells you which window is asking. If your account has",
  "no auto mode, ask the Controller to set `hosts.claude-code.launch.permissionMode` to",
  "`acceptEdits` through maintenance; the windows then stop for a permission prompt on",
  "commands.",
].join("\n");

const HOST_TRUST_STEPS_ZH = [
  "第一次在工作区目录里启动 Claude Code 时，必须接受工作区信任对话。不接受时插件的 hook",
  "与状态栏都不运行：没有会话被观察到，投递也拿不到落地证据。状态栏命令由",
  "`wakeflow_maintain_workspace` 写进 `settings.local.json` 的托管块；那个块归 Wakeflow",
  "所有，你自己改写 `statusLine` 会在下一次对账里被报成差异。",
  "",
  "你不需要自己配置 tmux。在工作区目录里运行 `claude`，执行 `/wakeflow:init`：Controller 会通过",
  "维护装到 `.wakeflow-local/runtime/hosts/claude-code/operations/assets/tmux.mjs` 的助手自己",
  "建 tmux 会话、开全部窗口，窗口开好后告诉你要执行的那一条 `tmux attach` 命令、要接受哪些信任",
  "对话；投递 prompt 也走同一个助手。维护还会往工作区根的 `.claude/settings.json` 写只放行这个",
  "助手和 Wakeflow MCP 工具的 allow 规则；助手启动或恢复的每个窗口也带着这两项放行启动，所以产品",
  "窗口和测试窗口同样不会为它们弹权限。不会写 `Bash(tmux *)` 之类更宽的规则。",
  "",
  "助手启动的每个窗口缺省以 Claude Code 的 `auto` 权限模式运行：常规操作由 Claude Code 自己审，",
  "不再逐条问你。窗口第一次仍可能问你一个一次性的问题（例如是否允许读取工作目录之外的文件），",
  "Controller 会告诉你是哪个窗口在问。你的账号没有 auto 模式时，让 Controller 经维护把",
  "`hosts.claude-code.launch.permissionMode` 设为 `acceptEdits`；之后窗口执行命令时会弹权限确认。",
].join("\n");

/** 九个占位符的 Claude Code 取值；键序与 D3 列出的顺序一致，新增的两个排在最后。 */
export const CLAUDE_CODE_AGENT_TEXT_PLACEHOLDERS: Readonly<
  Record<ClaudeCodeAgentTextPlaceholderKey, Readonly<ClaudeCodeAgentTextPlaceholderValue>>
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
export const CLAUDE_CODE_AGENT_TEXT_UNKNOWN_PLACEHOLDER_CODE =
  "wakeflow-agent-text-unknown-placeholder";

function claudeCodeAgentTextValue(key: string, language: ClaudeCodeAgentTextLanguage): string {
  const value = (
    CLAUDE_CODE_AGENT_TEXT_PLACEHOLDERS as Readonly<
      Record<string, Readonly<ClaudeCodeAgentTextPlaceholderValue> | undefined>
    >
  )[key];
  if (value === undefined) {
    throw new Error(`${CLAUDE_CODE_AGENT_TEXT_UNKNOWN_PLACEHOLDER_CODE}: ${key}`);
  }
  return language === "zh" ? (value.zh ?? value.en) : value.en;
}

/** 一次封闭替换：遍历一遍源文本，替换结果不再被回扫。 */
export function renderClaudeCodeAgentText(
  source: string,
  language: ClaudeCodeAgentTextLanguage,
): string {
  return source.replace(/\{\{([A-Za-z]+)\}\}/gu, (_match: string, key: string): string =>
    claudeCodeAgentTextValue(key, language),
  );
}
