import { computeSha256Digest, type Sha256Digest } from "../../foundation/crypto/sha256.js";

/**
 * Wakeflow Host / Claude Code：插件级 hook 配置片段（gate-log §13.97 D5、D6）。
 *
 * 本模块是纯数据加确定性渲染：制品构建器把 `renderClaudeCodeHooksJson()` 的字节原样写成制品根的
 * `hooks/hooks.json`，Claude Code 在插件启用后按它在 `SessionStart`、`UserPromptSubmit`、`Notification`、
 * `Stop`、`SessionEnd` 时启动 `hooks/observe.mjs`。处理器用 exec 形式（`command: "node"` 加 `args`，不经
 * shell），`${CLAUDE_PLUGIN_ROOT}` 占位符在 args 里由宿主展开；argv 只带固定标记与 `--host claude-code`，
 * 工作区由脚本按声明拓扑定位（D2），所以片段里没有工作区根，这五个观察事件都不设 matcher。
 *
 * 同步与异步（D5）：`SessionStart` 同步、5 秒；`UserPromptSubmit` 异步（只观察不控制，不给每次提示
 * 加启动延迟）；`Notification` 异步、5 秒（open-items A7，§13.167：等待权限、空闲等待、登录或用量提示
 * 这些宿主阻塞状态只有它能看见，观察器只记类型）；`Stop` 同步、5 秒——它是结果接受的完成证据，异步 hook 会在 `-p` 收尾时被杀掉；
 * `SessionEnd` 同步、3 秒（插件 hook 抬不高 1.5 秒预算，靠脚本快）。渲染结果必须跨版本字节稳定：
 * 只含占位符，不含版本号或构建标识；键序固定、2 空格缩进、尾随换行。
 *
 * 第六个事件是控制而不是观察（ADR-0020 的 2026-11-16 补充，open-items X30）：`PreToolUse` 上、只对编辑工具
 * （matcher 是精确名字的列表）同步启动同一个脚本，带写守卫的标记；守卫只在已绑定的非 Controller 窗口要写
 * 受管路径时拒绝，其余放行。同步是必须的——异步 hook 的决定宿主不认；超时与故障在宿主那里都是放行，守卫
 * 因此不可能挡住一次它没判定的编辑。matcher 里的 `MultiEdit` 是给还带这个工具的旧宿主留的，没有它的
 * 宿主上这一项什么也不匹配。
 *
 * 本模块只依赖 foundation crypto：标记与宿主参数是与入口 `wakeflow-hook-observer.ts`、
 * `wakeflow-hook-write-guard.ts` 约定的字面量，宿主层不能反向导入入口，测试核对两处相等。
 */

export type ClaudeCodeHookEventName =
  | "SessionStart"
  | "UserPromptSubmit"
  | "PreToolUse"
  | "Notification"
  | "Stop"
  | "SessionEnd";

export interface ClaudeCodeHookHandler {
  readonly type: "command";
  readonly command: "node";
  readonly args: readonly string[];
  /** 只在异步处理器上出现，且只取 true；同步处理器没有这个键。 */
  readonly async?: true;
  readonly timeout: number;
}

export interface ClaudeCodeHookMatcherGroup {
  /** 只在写守卫的组上出现；观察事件的组没有这个键（对每一次事件都启动）。 */
  readonly matcher?: string;
  readonly hooks: readonly ClaudeCodeHookHandler[];
}

export interface ClaudeCodeHookFragment {
  readonly hooks: Readonly<Record<ClaudeCodeHookEventName, readonly ClaudeCodeHookMatcherGroup[]>>;
}

export const CLAUDE_CODE_HOOK_OBSERVER_MARKER = "--wakeflow-hook-observer-v1" as const;
export const CLAUDE_CODE_HOOK_OBSERVER_HOST_ARGUMENT = "--host" as const;
export const CLAUDE_CODE_HOOK_OBSERVER_HOST_ID = "claude-code" as const;
export const CLAUDE_CODE_HOOK_OBSERVER_SCRIPT_PATH = "hooks/observe.mjs" as const;
export const CLAUDE_CODE_WRITE_GUARD_MARKER = "--wakeflow-write-guard-v1" as const;
/**
 * 写守卫看的工具：宿主的编辑工具，精确名字的列表（只含字母与 `|`，宿主不当正则）。与 tmux 助手启动时带的
 * `Edit(...)` deny 规则覆盖同一组工具；Bash 不在其列——命令文本判不准写的是哪里。
 */
export const CLAUDE_CODE_WRITE_GUARD_MATCHER = "Edit|Write|MultiEdit|NotebookEdit" as const;

// biome-ignore lint/suspicious/noTemplateCurlyInString: 宿主在运行时展开该占位符
const PLUGIN_ROOT_PLACEHOLDER = "${CLAUDE_PLUGIN_ROOT}";
const SESSION_START_TIMEOUT_SECONDS = 5;
const USER_PROMPT_SUBMIT_TIMEOUT_SECONDS = 5;
const NOTIFICATION_TIMEOUT_SECONDS = 5;
const STOP_TIMEOUT_SECONDS = 5;
const SESSION_END_TIMEOUT_SECONDS = 3;
const WRITE_GUARD_TIMEOUT_SECONDS = 5;

const OBSERVER_ARGS: readonly string[] = Object.freeze([
  `${PLUGIN_ROOT_PLACEHOLDER}/${CLAUDE_CODE_HOOK_OBSERVER_SCRIPT_PATH}`,
  CLAUDE_CODE_HOOK_OBSERVER_MARKER,
  CLAUDE_CODE_HOOK_OBSERVER_HOST_ARGUMENT,
  CLAUDE_CODE_HOOK_OBSERVER_HOST_ID,
]);

const WRITE_GUARD_ARGS: readonly string[] = Object.freeze([
  `${PLUGIN_ROOT_PLACEHOLDER}/${CLAUDE_CODE_HOOK_OBSERVER_SCRIPT_PATH}`,
  CLAUDE_CODE_WRITE_GUARD_MARKER,
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

/** 写守卫的组：键序 matcher、hooks；处理器同步，决定才作数。 */
function writeGuardGroup(): readonly ClaudeCodeHookMatcherGroup[] {
  return Object.freeze([
    Object.freeze({
      matcher: CLAUDE_CODE_WRITE_GUARD_MATCHER,
      hooks: Object.freeze([
        Object.freeze({
          type: "command" as const,
          command: "node" as const,
          args: WRITE_GUARD_ARGS,
          timeout: WRITE_GUARD_TIMEOUT_SECONDS,
        }),
      ]),
    }),
  ]);
}

/**
 * `hooks/hooks.json` 的对象形：六个事件、每个事件一个组、组里恰好一个处理器；五个观察事件的组没有 matcher，
 * `PreToolUse` 的组带编辑工具的 matcher。
 */
export const CLAUDE_CODE_HOOK_FRAGMENT: ClaudeCodeHookFragment = Object.freeze({
  hooks: Object.freeze({
    SessionStart: group(handler(SESSION_START_TIMEOUT_SECONDS, false)),
    UserPromptSubmit: group(handler(USER_PROMPT_SUBMIT_TIMEOUT_SECONDS, true)),
    PreToolUse: writeGuardGroup(),
    Notification: group(handler(NOTIFICATION_TIMEOUT_SECONDS, true)),
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
