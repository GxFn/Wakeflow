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
 * 加启动延迟）；`Notification` 异步（open-items A7，§13.167：等待权限、空闲等待、登录或用量提示
 * 这些宿主阻塞状态只有它能看见，观察器只记类型）；`Stop` 同步、5 秒——它是结果接受的完成证据，异步 hook 会在 `-p` 收尾时被杀掉；
 * `SessionEnd` 同步、3 秒（插件 hook 抬不高 1.5 秒预算，靠脚本快）。两个异步处理器也写着 5 秒，但宿主
 * 对 `async: true` 的 command hook 不执行 `timeout`（hooks 参考的 `timeout` 字段与"Run hooks in the
 * background"一节），这两次运行的上限只来自观察器自己：有界的 stdin、配置与列举读取，窗口状态子进程
 * 1 秒超时；它没有整体的墙钟期限。键留着：文档没说宿主从哪一版起不再执行它，仍执行的宿主上就是 5 秒。
 * 渲染结果必须跨版本字节稳定：只含占位符，不含版本号或构建标识；键序固定、2 空格缩进、尾随换行。
 *
 * 第六个事件是控制而不是观察（ADR-0020 的 2026-11-16 补充，open-items X30）：`PreToolUse` 上、只对编辑工具
 * （matcher 是精确名字的列表）同步启动同一个脚本，带写守卫的标记；守卫只在已绑定的非 Controller 窗口要写
 * 受管路径时拒绝，其余放行。同步是必须的——异步 hook 的决定宿主不认。守卫起不来、被杀、意外退出或超时，
 * 都由宿主处置：普通会话里这是非阻塞错误，调用照常走权限流程；实验性的 Code Mode（2.1.323 起，缺省关）
 * 在 `onFailure` 未设时会拒绝那次调用：2.1.323 到 2.1.328 上，没给出决定的 `PreToolUse` hook（起不来、
 * 被杀、意外退出码、超时）都让调用被拒；2.1.329 的更新日志把出错改成与普通会话一样放行，Code Mode 文档
 * 写明超时（`the hook did not finish`）仍然被拒，要放行就设 `"onFailure": "continue"`。所以守卫的处理器
 * 显式带 `onFailure: "continue"`（宿主 2.1.295 起认这个键）：两种模式、各个版本下守卫的故障与超时都放行，
 * 守卫不可能挡住一次它没判定的编辑。比 2.1.295 早的宿主没有 Code Mode，不认这个键：hooks 文档没写它们
 * 怎么处置未知键，没有一手文档可引；能找到的都指向忽略——宿主更新日志 2.1.274（修掉插件 hooks 文件顶层
 * `$schema` 的 "unknown key" 提示，可见此前是提示而不是拒收），以及 2.1.197、2.1.229、2.1.267 上的第三方
 * 报告（有的版本提示一句），本机 2.1.325 与 2.1.328 的 `claude plugin validate` 对不认识的处理器键也不报。
 * 那里的缺省本来就是放行。认识这个键的宿主遇到非法取值会让 `PreToolUse` 所在的整份 hooks 不生效，所以
 * 取值只能是 continue 或 block。
 * 观察事件的处理器不带这个键：异步处理器上它不起作用，其余观察事件的缺省就是继续。matcher 里的
 * `MultiEdit` 是给还带这个工具的旧宿主留的，没有它的宿主上这一项什么也不匹配。
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
  /** 只在写守卫的处理器上出现，且只取 continue：守卫的故障与超时在任何模式下都放行。 */
  readonly onFailure?: "continue";
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

/**
 * 写守卫的组：键序 matcher、hooks；处理器同步，决定才作数；处理器的键序 type、command、args、timeout、
 * onFailure，`onFailure` 排在最后，前面的字节与观察事件的同步处理器同形。
 */
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
          onFailure: "continue" as const,
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
