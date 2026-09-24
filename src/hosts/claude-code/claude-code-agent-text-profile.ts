import { CLAUDE_CODE_TMUX_ASSET_COMMAND } from "./claude-code-tmux-asset.js";

/**
 * Wakeflow Host / Claude Code：agent 面文本的宿主取值表（gate-log §13.99 D3、D9）。
 *
 * 本模块是纯数据加确定性渲染，与 `claude-code-hook-fragment.ts` 同一模式：文本只有一份源
 * （`assets/agent-text/`，仓库相对，不出现任何宿主名），宿主差异写成七个封闭占位符，取值
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

/** 七个封闭占位符（D3，§13.118 加 windowBootstrap）；源目录里出现表外的占位符即构建失败。 */
export type ClaudeCodeAgentTextPlaceholderKey =
  | "instructionFile"
  | "windowLaunch"
  | "windowBootstrap"
  | "deliveryAction"
  | "worktreeLaunch"
  | "commandSurface"
  | "hostTrustSteps";

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
  `from the workspace root: \`${TMUX_HELPER} launch --window <windowId>\`. The helper opens ` +
  "the tmux window at the intent's root, starts `claude` with the listed parameters and a " +
  "fresh session id, waits for the session-start hook record, and prints the creation " +
  "observation to register verbatim. After each registration run `mark --window <windowId>` " +
  "so the tmux window " +
  "carries the five Wakeflow options; `panes` prints the tmux-panes observation, and " +
  "`close --window <windowId>` prints the closure evidence a decommission needs.";

/** Controller 自己怎么进 tmux：用户是被引导者，从不自己配置 tmux（§13.118）。 */
const WINDOW_BOOTSTRAP =
  `run \`${TMUX_HELPER} preflight\` and read \`insideTmux\`. When it is true this session is ` +
  "the Controller: register it with `self` (pipe your own window's inspect result in). When it " +
  "is false this session only bootstraps and must not register itself: `launch` the Controller " +
  "window's own intent too, so a fresh Controller starts inside the tmux session the helper " +
  "creates, launch every other window with `--wait 0`, then give the user the exact `attach` " +
  "command the helper printed, ask them to accept the trust dialog in every window (`Ctrl-b n` " +
  "moves to the next one) and to tell you when that is done; only then register each window " +
  "from the observations you kept, run `mark --all`, and tell the user to continue in the tmux " +
  "Controller and close this session. The user never sets tmux up by hand: you do it and tell " +
  "them the one thing to run or press.";

const DELIVERY_ACTION =
  "pipe the permit's prompt into the tmux helper, run from the workspace root: " +
  `\`${TMUX_HELPER} deliver --window <windowId> --handle-digest <the permit's handleDigest>\`. ` +
  "It checks the pane against the locator and the handle digest, pastes the prompt, presses " +
  "Return once and captures the pane once, then prints the `attempt` and `readback` to " +
  "record verbatim.";

const WORKTREE_LAUNCH =
  "run `git worktree add` yourself at the path the intent names, or let the host make " +
  "it by starting that window with `claude --worktree <name>`, which puts the checkout " +
  "on branch `worktree-<name>`.";

const COMMAND_SURFACE_EN =
  "`/wakeflow-init` sets up or repairs the workspace, `/wakeflow-status` reports where " +
  "it stands, `/wakeflow-next` takes the next step on the active Demand, and " +
  "`/wakeflow-pod` creates or closes a pod.";

const COMMAND_SURFACE_ZH =
  "`/wakeflow-init` 初始化或修复工作区，`/wakeflow-status` 报告当前状态，" +
  "`/wakeflow-next` 在活动 Demand 上推进一步，`/wakeflow-pod` 创建或关闭 pod。";

const HOST_TRUST_STEPS_EN = [
  "The first time you start Claude Code in the workspace directory, accept the",
  "workspace trust dialog. Without it neither the plugin's hooks nor the status line",
  "run, so no session is observed and no delivery can be shown to have landed.",
  "`wakeflow_maintain_workspace` writes the status line command into a managed block in",
  "`settings.local.json`; that block belongs to Wakeflow, and a `statusLine` you rewrite",
  "yourself is reported as a difference the next time the workspace is reconciled.",
  "",
  "You never set tmux up by hand. Start `claude` in the workspace directory and run",
  "`/wakeflow-init`: the Controller creates the tmux session and every window itself through",
  "the helper maintenance installs at",
  "`.wakeflow-local/runtime/hosts/claude-code/operations/assets/tmux.mjs`, tells you the exact",
  "`tmux attach` command once the windows are up, and which trust dialogs to accept. It",
  "delivers prompts through the same helper. Maintenance also writes one precise allow rule",
  "for that helper into the workspace root's `.claude/settings.json`, so the helper runs",
  "without a permission prompt; nothing broader such as `Bash(tmux *)` is written.",
].join("\n");

const HOST_TRUST_STEPS_ZH = [
  "第一次在工作区目录里启动 Claude Code 时，必须接受工作区信任对话。不接受时插件的 hook",
  "与状态栏都不运行：没有会话被观察到，投递也拿不到落地证据。状态栏命令由",
  "`wakeflow_maintain_workspace` 写进 `settings.local.json` 的托管块；那个块归 Wakeflow",
  "所有，你自己改写 `statusLine` 会在下一次对账里被报成差异。",
  "",
  "你不需要自己配置 tmux。在工作区目录里运行 `claude`，执行 `/wakeflow-init`：Controller 会通过",
  "维护装到 `.wakeflow-local/runtime/hosts/claude-code/operations/assets/tmux.mjs` 的助手自己",
  "建 tmux 会话、开全部窗口，窗口开好后告诉你要执行的那一条 `tmux attach` 命令、要接受哪些信任",
  "对话；投递 prompt 也走同一个助手。维护还会往工作区根的 `.claude/settings.json` 写一条只放行",
  "这个助手的 allow 规则，助手因此不弹权限；不会写 `Bash(tmux *)` 之类更宽的规则。",
].join("\n");

/** 七个占位符的 Claude Code 取值；键序与 D3 列出的顺序一致。 */
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
