import { computeSha256Digest, type Sha256Digest } from "../../foundation/crypto/sha256.js";

/**
 * Wakeflow Host / Codex：插件级 hook 配置片段（gate-log §13.97 D5、D6）。
 *
 * 本模块是纯数据加确定性渲染：制品构建器把 `renderCodexHooksJson()` 的字节原样写成制品根的
 * `hooks/hooks.json`（Codex 的默认位置，不改插件清单），Codex 在用户于 `/hooks` 里按定义哈希审阅信任
 * 后按它在 `SessionStart`、`UserPromptSubmit`、`Stop`、`SessionEnd` 时启动 `hooks/observe.mjs`。Codex
 * 只有命令串形式：`node "${PLUGIN_ROOT}/hooks/observe.mjs" --wakeflow-hook-observer-v1 --host codex`，
 * 占位符由宿主展开；argv 只带固定标记与 `--host codex`，工作区由脚本按声明拓扑定位（D2），所以片段里
 * 没有工作区根，四个事件都不设 matcher。
 *
 * 同步与异步（D5）：`SessionStart` 同步、5 秒；`UserPromptSubmit` 异步（只观察不控制，不给每次提示
 * 加启动延迟）；`Stop` 同步、5 秒——它是结果接受的完成证据，而 Codex 在会话结束时取消未完成的后台
 * hook；`SessionEnd` 同步、3 秒（Codex 的上限）。渲染结果必须跨版本字节稳定：Codex 的信任按定义哈希
 * 记录，字节一变四个 hook 就被跳过直到重新信任，所以只含占位符，不含版本号或构建标识；键序固定、
 * 2 空格缩进、尾随换行。
 *
 * 本模块只依赖 foundation crypto：标记与宿主参数是与入口 `wakeflow-hook-observer.ts` 约定的字面量，
 * 宿主层不能反向导入入口，测试核对两处相等。
 */

export type CodexHookEventName = "SessionStart" | "UserPromptSubmit" | "Stop" | "SessionEnd";

export interface CodexHookHandler {
  readonly type: "command";
  readonly command: string;
  /** 只在异步处理器上出现，且只取 true；同步处理器没有这个键。 */
  readonly async?: true;
  readonly timeout: number;
}

export interface CodexHookMatcherGroup {
  readonly hooks: readonly CodexHookHandler[];
}

export interface CodexHookFragment {
  readonly hooks: Readonly<Record<CodexHookEventName, readonly CodexHookMatcherGroup[]>>;
}

export const CODEX_HOOK_OBSERVER_MARKER = "--wakeflow-hook-observer-v1" as const;
export const CODEX_HOOK_OBSERVER_HOST_ARGUMENT = "--host" as const;
export const CODEX_HOOK_OBSERVER_HOST_ID = "codex" as const;
export const CODEX_HOOK_OBSERVER_SCRIPT_PATH = "hooks/observe.mjs" as const;

// biome-ignore lint/suspicious/noTemplateCurlyInString: 宿主在运行时展开该占位符
const PLUGIN_ROOT_PLACEHOLDER = "${PLUGIN_ROOT}";
const SESSION_START_TIMEOUT_SECONDS = 5;
const USER_PROMPT_SUBMIT_TIMEOUT_SECONDS = 5;
const STOP_TIMEOUT_SECONDS = 5;
const SESSION_END_TIMEOUT_SECONDS = 3;

/** 命令串：脚本路径带双引号（占位符展开后的路径可含空格），其余三个参数是固定字面量。 */
export const CODEX_HOOK_OBSERVER_COMMAND: string = [
  "node",
  `"${PLUGIN_ROOT_PLACEHOLDER}/${CODEX_HOOK_OBSERVER_SCRIPT_PATH}"`,
  CODEX_HOOK_OBSERVER_MARKER,
  CODEX_HOOK_OBSERVER_HOST_ARGUMENT,
  CODEX_HOOK_OBSERVER_HOST_ID,
].join(" ");

/** 键序固定：type、command、（async）、timeout；`async` 只在异步处理器上出现。 */
function handler(timeout: number, asynchronous: boolean): CodexHookHandler {
  return Object.freeze(
    asynchronous
      ? { type: "command", command: CODEX_HOOK_OBSERVER_COMMAND, async: true, timeout }
      : { type: "command", command: CODEX_HOOK_OBSERVER_COMMAND, timeout },
  );
}

function group(entry: CodexHookHandler): readonly CodexHookMatcherGroup[] {
  return Object.freeze([Object.freeze({ hooks: Object.freeze([entry]) })]);
}

/** `hooks/hooks.json` 的对象形：四个事件、每个事件一个无 matcher 的组、组里恰好一个处理器。 */
export const CODEX_HOOK_FRAGMENT: CodexHookFragment = Object.freeze({
  hooks: Object.freeze({
    SessionStart: group(handler(SESSION_START_TIMEOUT_SECONDS, false)),
    UserPromptSubmit: group(handler(USER_PROMPT_SUBMIT_TIMEOUT_SECONDS, true)),
    Stop: group(handler(STOP_TIMEOUT_SECONDS, false)),
    SessionEnd: group(handler(SESSION_END_TIMEOUT_SECONDS, false)),
  }),
});

/** 确定性渲染：2 空格缩进的 JSON 加尾随换行，字节只由片段数据决定。 */
export function renderCodexHooksJson(): string {
  return `${JSON.stringify(CODEX_HOOK_FRAGMENT, null, 2)}\n`;
}

/**
 * 渲染字节的 sha256：Codex 的信任按定义哈希记录，本常量是片段对"这就是我渲染的字节"的声明。
 * 制品构建器在写出 `hooks/hooks.json` 前读取本常量并核对渲染字节，不一致即以稳定错误码
 * `wakeflow-artifact-hook-fragment-digest` 失败。工作区的 verify 不读它——`host-hook-channel`
 * 门看的是观察记录，不是制品字节。
 */
export const CODEX_HOOK_FRAGMENT_DIGEST: Sha256Digest = computeSha256Digest(
  new TextEncoder().encode(renderCodexHooksJson()),
  "$fragment",
);
