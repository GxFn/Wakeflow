import { computeSha256Digest, type Sha256Digest } from "../../foundation/crypto/sha256.js";

/**
 * Wakeflow Host / Claude Code：插件级 hook 配置片段（gate-log §13.97 D5、D6）。
 *
 * 本模块是纯数据加确定性渲染：制品构建器把 `renderClaudeCodeHooksJson()` 的字节原样写成制品根的
 * `hooks/hooks.json`，Claude Code 在插件启用后按它在 `SessionStart`、`UserPromptSubmit`、`Stop`、
 * `SessionEnd` 时启动 `hooks/observe.mjs`。处理器用 exec 形式（`command: "node"` 加 `args`，不经
 * shell），`${CLAUDE_PLUGIN_ROOT}` 占位符在 args 里由宿主展开；argv 只带固定标记与 `--host claude-code`，
 * 工作区由脚本按声明拓扑定位（D2），所以片段里没有工作区根，四个事件都不设 matcher。
 *
 * 同步与异步（D5）：`SessionStart` 同步、5 秒；`UserPromptSubmit` 异步（只观察不控制，不给每次提示
 * 加启动延迟）；`Stop` 同步、5 秒——它是结果接受的完成证据，异步 hook 会在 `-p` 收尾时被杀掉；
 * `SessionEnd` 同步、3 秒（插件 hook 抬不高 1.5 秒预算，靠脚本快）。渲染结果必须跨版本字节稳定：
 * 只含占位符，不含版本号或构建标识；键序固定、2 空格缩进、尾随换行。
 *
 * 本模块只依赖 foundation crypto：标记与宿主参数是与入口 `wakeflow-hook-observer.ts` 约定的字面量，
 * 宿主层不能反向导入入口，测试核对两处相等。
 */

export type ClaudeCodeHookEventName = "SessionStart" | "UserPromptSubmit" | "Stop" | "SessionEnd";

export interface ClaudeCodeHookHandler {
  readonly type: "command";
  readonly command: "node";
  readonly args: readonly string[];
  /** 只在异步处理器上出现，且只取 true；同步处理器没有这个键。 */
  readonly async?: true;
  readonly timeout: number;
}

export interface ClaudeCodeHookMatcherGroup {
  readonly hooks: readonly ClaudeCodeHookHandler[];
}

export interface ClaudeCodeHookFragment {
  readonly hooks: Readonly<Record<ClaudeCodeHookEventName, readonly ClaudeCodeHookMatcherGroup[]>>;
}

export const CLAUDE_CODE_HOOK_OBSERVER_MARKER = "--wakeflow-hook-observer-v1" as const;
export const CLAUDE_CODE_HOOK_OBSERVER_HOST_ARGUMENT = "--host" as const;
export const CLAUDE_CODE_HOOK_OBSERVER_HOST_ID = "claude-code" as const;
export const CLAUDE_CODE_HOOK_OBSERVER_SCRIPT_PATH = "hooks/observe.mjs" as const;

// biome-ignore lint/suspicious/noTemplateCurlyInString: 宿主在运行时展开该占位符
const PLUGIN_ROOT_PLACEHOLDER = "${CLAUDE_PLUGIN_ROOT}";
const SESSION_START_TIMEOUT_SECONDS = 5;
const USER_PROMPT_SUBMIT_TIMEOUT_SECONDS = 5;
const STOP_TIMEOUT_SECONDS = 5;
const SESSION_END_TIMEOUT_SECONDS = 3;

const OBSERVER_ARGS: readonly string[] = Object.freeze([
  `${PLUGIN_ROOT_PLACEHOLDER}/${CLAUDE_CODE_HOOK_OBSERVER_SCRIPT_PATH}`,
  CLAUDE_CODE_HOOK_OBSERVER_MARKER,
  CLAUDE_CODE_HOOK_OBSERVER_HOST_ARGUMENT,
  CLAUDE_CODE_HOOK_OBSERVER_HOST_ID,
]);

/** 键序固定：type、command、args、（async）、timeout；`async` 只在异步处理器上出现。 */
function handler(timeout: number, asynchronous: boolean): ClaudeCodeHookHandler {
  return Object.freeze(
    asynchronous
      ? { type: "command", command: "node", args: OBSERVER_ARGS, async: true, timeout }
      : { type: "command", command: "node", args: OBSERVER_ARGS, timeout },
  );
}

function group(entry: ClaudeCodeHookHandler): readonly ClaudeCodeHookMatcherGroup[] {
  return Object.freeze([Object.freeze({ hooks: Object.freeze([entry]) })]);
}

/** `hooks/hooks.json` 的对象形：四个事件、每个事件一个无 matcher 的组、组里恰好一个处理器。 */
export const CLAUDE_CODE_HOOK_FRAGMENT: ClaudeCodeHookFragment = Object.freeze({
  hooks: Object.freeze({
    SessionStart: group(handler(SESSION_START_TIMEOUT_SECONDS, false)),
    UserPromptSubmit: group(handler(USER_PROMPT_SUBMIT_TIMEOUT_SECONDS, true)),
    Stop: group(handler(STOP_TIMEOUT_SECONDS, false)),
    SessionEnd: group(handler(SESSION_END_TIMEOUT_SECONDS, false)),
  }),
});

/** 确定性渲染：2 空格缩进的 JSON 加尾随换行，字节只由片段数据决定。 */
export function renderClaudeCodeHooksJson(): string {
  return `${JSON.stringify(CLAUDE_CODE_HOOK_FRAGMENT, null, 2)}\n`;
}

/**
 * 渲染字节的 sha256：本常量是片段对"这就是我渲染的字节"的声明。制品构建器在写出
 * `hooks/hooks.json` 前读取本常量并核对渲染字节，不一致即以稳定错误码
 * `wakeflow-artifact-hook-fragment-digest` 失败。工作区的 verify 不读它——`host-hook-channel`
 * 门看的是观察记录，不是制品字节。
 */
export const CLAUDE_CODE_HOOK_FRAGMENT_DIGEST: Sha256Digest = computeSha256Digest(
  new TextEncoder().encode(renderClaudeCodeHooksJson()),
  "$fragment",
);
