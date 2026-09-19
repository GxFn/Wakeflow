/**
 * Wakeflow Host / Codex：agent 面文本的宿主取值表（gate-log §13.99 D3、D9）。
 *
 * 本模块是纯数据加确定性渲染，与 `codex-hook-fragment.ts` 同一模式：文本只有一份源
 * （`assets/agent-text/`，仓库相对，不出现任何宿主名），宿主差异写成六个封闭占位符，取值
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

/** 六个封闭占位符（D3）；源目录里出现表外的占位符即构建失败。 */
export type CodexAgentTextPlaceholderKey =
  | "instructionFile"
  | "windowLaunch"
  | "deliveryAction"
  | "worktreeLaunch"
  | "commandSurface"
  | "hostTrustSteps";

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

const WINDOW_LAUNCH =
  "open a new Codex thread rooted at the directory the intent names, started with " +
  "the parameters it lists.";

const DELIVERY_ACTION =
  "send the permit's prompt into the target window's thread with your Codex thread " +
  "tool, once, and keep exactly what that send call returned.";

const WORKTREE_LAUNCH =
  "run `git worktree add` yourself at the path the intent names. The checkout starts " +
  "on a detached HEAD, so the branch has to exist before any result is imported from it.";

const COMMAND_SURFACE_EN =
  "This host ships no slash commands. Say what you want in plain words; the skill " +
  "that is loaded routes it to the right tool.";

const COMMAND_SURFACE_ZH = "本宿主不发 slash 命令。直接说人话即可，已加载的技能会把它路由到对应工具。";

const HOST_TRUST_STEPS_EN = [
  "Open `/hooks` and trust Wakeflow's four hooks after reviewing them by their",
  "definition hash. Until you do, all four are skipped: no session is observed, so no",
  "window can be registered and no delivery can be shown to have landed. If a plugin",
  "update changes the hook definition bytes, Codex asks you to trust them again -",
  "under a normal update `/hooks` should show nothing of Wakeflow's waiting for review.",
].join("\n");

const HOST_TRUST_STEPS_ZH = [
  "在 `/hooks` 里按定义哈希审阅并信任 Wakeflow 的四个 hook。信任之前四个 hook 全部被",
  "跳过：没有会话被观察到，窗口无法登记，投递也拿不到落地证据。插件更新后若 hook 定义",
  "字节发生变化，Codex 会要求重新信任——正常更新后 `/hooks` 里不应出现待审阅的 Wakeflow",
  "条目。",
].join("\n");

/** 六个占位符的 Codex 取值；键序与 D3 列出的顺序一致。 */
export const CODEX_AGENT_TEXT_PLACEHOLDERS: Readonly<
  Record<CodexAgentTextPlaceholderKey, Readonly<CodexAgentTextPlaceholderValue>>
> = Object.freeze({
  instructionFile: Object.freeze({ en: INSTRUCTION_FILE }),
  windowLaunch: Object.freeze({ en: WINDOW_LAUNCH }),
  deliveryAction: Object.freeze({ en: DELIVERY_ACTION }),
  worktreeLaunch: Object.freeze({ en: WORKTREE_LAUNCH }),
  commandSurface: Object.freeze({ en: COMMAND_SURFACE_EN, zh: COMMAND_SURFACE_ZH }),
  hostTrustSteps: Object.freeze({ en: HOST_TRUST_STEPS_EN, zh: HOST_TRUST_STEPS_ZH }),
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
