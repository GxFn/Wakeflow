import { computeSha256Digest } from "../../foundation/crypto/sha256.js";
import { parsePortableResourcePath, } from "../../foundation/filesystem/portable-resource-path.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import { hostRuntimeRootRef, WAKEFLOW_CONFIG_SCHEMA_VERSION } from "../../kernel/layout.js";
/**
 * Wakeflow Host / Claude Code：tmux 助手资产（gate-log §13.117 D4）。
 *
 * 资产是一段 Agent 用 `node` 调用的脚本，装在 Wakeflow 自己的私有运行时目录里，与状态栏资产同一
 * 发布机制（字节精确、0600、verify 核对）。它把旧项目进程内 tmux 适配器的精确序列搬到 Agent
 * 手里：开会话或窗口、冻结标题、写五个 Wakeflow 窗口选项、启动 `claude`、读回 pane 清单、
 * 粘贴并回车一次再回读一次、关闭窗口。它只输出现有 MCP 工具已经要求的观察 JSON；
 * Wakeflow 本身仍不 spawn 任何进程，落地判定仍只看 hook 记录。
 *
 * 子命令（都从工作区根以 `node .wakeflow-local/runtime/hosts/claude-code/operations/assets/tmux.mjs
 * <子命令>` 调用，stdout 恰好一行 JSON）：
 *
 * - `preflight`：node、tmux 与 claude 是否可用及其版本、配置的会话是否已存在、当前是否在 tmux 里。
 * - `launch --window <windowId>`：stdin 是 `wakeflow_register_window_binding` inspect 的结果
 *   （或其 `launchIntent`）。生成 session id，按启动意图开窗口并启动 `claude`，等目标会话的
 *   `session-start` hook 记录，打印登记用的 creation observation。launch 与 resume 都在意图参数之后加
 *   `--allowedTools`：Wakeflow MCP 规则与按助手绝对路径的 `Bash(node <path> *)`（路径只进启动命令）。意图带 `local-head` 的 worktree
 *   意图且参数里有 `--worktree <name>` 时（§13.130 H4），先在意图根（仓库主检出）准备检出：
 *   `<root>/.claude/worktrees/<name>` 不存在就 `git worktree add -b worktree-<name> <path> HEAD`
 *   （分支已存在而检出不存在时拒绝为 `worktree-branch-exists`，由 Controller 询问用户），存在就复用
 *   （`claude --worktree` 对已有检出只加锁），并保证仓库的
 *   `.git/info/exclude` 有 `.claude/worktrees/` 一行；结果里 `worktreePrepared` 说明做了什么。
 *   收养（§13.134）：窗口没有定位器、却已有一个带本窗口三个标识（program、host、window）的活 pane 时
 *   不再开第二个——恰好一个且在跑 claude，就从那个 claude 进程的 argv（`--session-id` 或 `--resume`）
 *   取会话 id，有它的 session-start 记录作证才把它原样交给登记（`adopted: true`、`created: "adopted"`，
 *   不开窗口、不动 tmux）；没有记录拒绝为 `adopt-unproven`，跑的不是 claude 为 `window-present-not-claude`，
 *   多于一个为 `window-ambiguous`；已死的 pane 与已带 binding / locator 标识（登记过）的 pane 不算。
 * - `resume --window <windowId> [--wait N] [--force] [--in-place]`：stdin 同 launch；用绑定里的私有会话 id 以
 *   `claude --resume` 在新 pane 里续同一会话，等到新的 session-start 记录后打印 relocate 用的
 *   observation；定位器的 pane 还活着时拒绝为 `locator-live`（`--force` 跳过），提示改用 `--in-place`。
 *   launch 对活着的 pane 同样拒绝。
 *   `--in-place`（§13.134）：在定位器那个 pane 里用 `tmux respawn-pane -k` 以同一会话、同一意图参数重启，
 *   坐标、定位器、绑定与窗口选项（标识、冻结的标题）都不变，之后不用 relocate 也不用 mark。pane 按
 *   deliver 的同一套核对定位；会话在保留期内没有任何 user-prompt-submit 记录（从未有过对话，claude 不会
 *   --resume 它）时不动窗口、拒绝为 `resume-never-conversed`；且必须已闲置：输入框可见且为空、整屏没有工作中标记，否则拒绝为
 *   `window-busy`（observed 为 working、menu-cursor、input-box-unseen 或 input-not-empty；`--force` 不跳过）。
 *   助手就跑在这个 pane 里（`TMUX_PANE` 相同，即 Controller 重启自己）时不截屏：`CLAUDE_CODE_SESSION_ID`
 *   必须等于绑定的会话（否则 `self-mismatch`），然后交给一个脱离的子进程两秒后 respawn、立即返回
 *   `scheduled`；重启后的会话以一句固定 prompt 开头，让它先 verify 再接着做。
 *   deliver 在粘贴前查目标会话的落地记录：同一段 prompt 已落地就拒绝为 `already-landed` 并
 *   带上那条记录（宿主中断后的重发拿到证据而不是第二次投递），`--force` 才照发。
 *   launch 与 resume 等不到 hook 记录时再看新 pane：已消失或已死就报 `resume-exited` / `launch-exited`
 *   （claude 拒绝 --resume 一个从未有过对话的会话时就是这样退出的），只有活着才是 `pending`。
 * - `self`：Controller 给自己的窗口出同一份 observation（`TMUX_PANE` 与
 *   `CLAUDE_CODE_SESSION_ID` 来自 Claude Code 交给 shell 的环境）。
 * - `mark --window <windowId> | --all`：登记后把 binding 与 locator 标识写到窗口选项上。
 * - `panes`：`tmux list-panes -a` 转成 `tmux-panes` 观察。
 * - `deliver --window <windowId> [--handle-digest <sha256>] [--wait-landing <seconds>]`：stdin 是
 *   许可里的 prompt；先核对 pane（与定位器相关的 pane 恰好一个、活着、跑的是 claude、标识与坐标都对），
 *   粘贴前截屏一次：尾部看不到输入框（权限、信任对话框或选择菜单）就拒绝为 failed-before-send 的
 *   `target-not-at-prompt`（`--force` 不跳过），截屏失败为 `capture-failed`；
 *   粘贴、回车一次、回读一次，再等目标会话的 user-prompt-submit hook 记录（默认 3 秒），打印
 *   `wakeflow_record_delivery_outcome` 的 attempt、readback 与 landing。回读（§13.130 H1）看两种
 *   屏幕证据：prompt 首行子串，或 Claude Code 把粘贴折叠成的 `[Pasted text #N +M lines]` 指示且
 *   M 与 prompt 行数一致；都看不到才是 pending。回读只是屏幕摘要，落地仍只看 hook 记录。
 * - `nudge --window <windowId> [--text <phrase>]`（§13.130 H3）：被 "API Error: Connection lost
 *   mid-response" 切断的一轮不会自己续上；按 deliver 的同一套 pane 核对定位后截屏一次，只在屏幕尾部
 *   有 `API Error` 行且它是输入框上方最后一条对话行（之后没有回复、已渲染的用户消息或其他输出）、
 *   没有工作中标记（"esc to interrupt"、"running … hooks"、2.1.283 的 "… (23s · …" 计时行）且输入框为空时才粘贴一句
 *   （默认 "Continue."）并回车一次，打印 status（nudged / not-needed / busy / pane-missing）、
 *   匹配到的错误行与截屏摘要；一次调用最多推一次，看不到错误行绝不推。
 * - `close --window <windowId>`：关闭前后各读一次 pane 清单，打印 decommission 的 closure；只有恰好
 *   一个 pane 同时对上定位器坐标与本窗口标识时才杀窗口，否则不杀并报 closeResult `unknown`。
 * - `teardown [--force]`：引导要重来时杀掉配置的 tmux 会话；有任何登记窗口时拒绝，除非 --force。
 *
 * 脚本从自身位置推导工作区根，从不从 cwd 推断；输出里不含绝对路径，唯一例外是 launch observation
 * 里登记请求要求的 git worktree 原文事实（`git worktree list --porcelain` 与 `--git-common-dir`），
 * 收养的 launch 也一样。
 */
export const CLAUDE_CODE_TMUX_ASSET_FILE_NAME = "tmux.mjs";
export const CLAUDE_CODE_TMUX_ASSET_REF = parsePortableResourcePath(`${hostRuntimeRootRef("claude-code")}/operations/assets/${CLAUDE_CODE_TMUX_ASSET_FILE_NAME}`, "$asset");
/** Agent 从工作区根调用助手的命令前缀；技能文本与权限规则都引用它。 */
export const CLAUDE_CODE_TMUX_ASSET_COMMAND = `node ${CLAUDE_CODE_TMUX_ASSET_REF}`;
/**
 * 工作区根 `.claude/settings.json` 里精确到这一条调用的 allow 规则（§13.117 D5）：
 * 只放行助手本身，不恢复旧项目的 `Bash(tmux *)` 与 `Bash(node *)`。
 */
export const WAKEFLOW_CLAUDE_CODE_TMUX_PERMISSION_RULE = `Bash(${CLAUDE_CODE_TMUX_ASSET_COMMAND} *)`;
/** 助手脚本。不含反引号与模板插值，以便原样嵌入；字节在模块加载时定型。 */
const SCRIPT = String.raw `#!/usr/bin/env node
// Generated by Wakeflow. Claude Code tmux helper asset; do not edit.
// wakeflow-tmux-helper-schema: 1
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, opendirSync, readFileSync, readSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOST_ID = "claude-code";
const HANDLE_KIND = "claude-session";
const DEFAULT_SESSION_NAME = "wakeflow";
// tmux 把格式输出里的制表符等不可打印字符替换成下划线（3.6 实测），字段分隔符因此必须是可打印且不会出现在字段里的串。
const FIELD_SEPARATOR = "~|~";
const SESSION_ID_PLACEHOLDER = "<uuid-v4 generated by the Agent>";
const WORKSPACE_ROOT_PLACEHOLDER = "<workspace root>";
const RUNTIME = ".wakeflow-local/runtime/hosts/claude-code";
const LOCATORS = RUNTIME + "/identity/window-locators";
const BINDINGS = RUNTIME + "/identity/window-bindings";
const HOOKS = RUNTIME + "/observations/hooks";
const OPTION_NAMES = Object.freeze({
  programId: "@wakeflow_program_id",
  hostId: "@wakeflow_host_id",
  windowId: "@wakeflow_window_id",
  bindingId: "@wakeflow_binding_id",
  locatorId: "@wakeflow_locator_id",
});
const PANE_FORMAT = [
  "#{session_name}",
  "#{window_id}",
  "#{pane_id}",
  "#{pane_dead}",
  "#{pane_current_command}",
  "#{@wakeflow_program_id}",
  "#{@wakeflow_host_id}",
  "#{@wakeflow_window_id}",
  "#{@wakeflow_binding_id}",
  "#{@wakeflow_locator_id}",
  "#{pane_pid}",
].join(FIELD_SEPARATOR);
const MAX_PANES = 16;
const MAX_CONFIG_BYTES = 1048576;
const MAX_RECORD_BYTES = 65536;
const MAX_STDIN_BYTES = 262144;
const MAX_LABEL = 128;
const MAX_VERSION = 64;
const MARKER_MINIMUM = 12;
const MARKER_MAXIMUM = 96;
const NUDGE_DEFAULT_TEXT = "Continue.";
const NUDGE_TEXT_MAXIMUM = 256;
const SCREEN_TAIL_LINES = 12;
// Claude Code 自己渲染输入框时用的折叠指示模式（2.1.282）：带行数或不带。
const PASTED_TEXT_INDICATOR = /\[Pasted text #[0-9]+(?: \+([0-9]+) lines)?\]/gu;
const API_ERROR_PATTERN = /API Error/u;
// 工作中标记。Claude Code 2.1.283 的计时行不再带 "esc to interrupt"（§13.134，§13.133 现场 A9）：
// 省略号后紧跟已用时的括号，例如 "✢ Computing… (23s · ↓ 1.4k tokens · …)"、"… (1m 5s"、"… (2h 3m 4s"；
// 回合结束的 "✻ Crunched for 3m 6s · done 4:10 PM" 没有省略号，不匹配。API 断连重试时显示
// "✻ Waiting for API response · will retry in 2m 25s"，回合还没结束却没有计时括号，也算工作中（§13.134 现场）。
const BUSY_PATTERNS = Object.freeze([
  /Waiting for API response/u,
  /will retry in [0-9]/u,
  /esc to interrupt/iu,
  /running [A-Za-z]+ hooks/iu,
  /…\s*\((?:[0-9]+[hm]\s+)*[0-9]+[hms]\b/u,
]);
// 输入框那一行：新版 TUI 用 U+276F，旧版用 >；后面是已键入的文本或占位提示。
const INPUT_LINE_PATTERN = /^[\u276f>]\s?(.*)$/u;
const INPUT_PLACEHOLDER_PREFIX = "Try \"";
// 输入框上下的边框线（只由横线组成）。
const INPUT_BORDER_PATTERN = /^[\u2500\u2501\u2550-]+$/u;
const WORKTREE_NAME_PATTERN = /^[a-z][a-z0-9-]{0,63}$/u;
const WORKTREE_EXCLUDE_LINE = ".claude/worktrees/";
const WORKTREE_EXCLUDE_PATTERN = /^\/?\.claude\/worktrees\/?$/u;
const HOOK_POLL_MS = 500;
const DEFAULT_LANDING_WAIT_SECONDS = 3;
const DEFAULT_WAIT_SECONDS = 20;
const MAX_WAIT_SECONDS = 120;
const WINDOW_ID_PATTERN = /^window_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const TMUX_WINDOW_PATTERN = /^@[0-9]{1,9}$/u;
const TMUX_PANE_PATTERN = /^%[0-9]{1,9}$/u;
// spawn tmux / git 前的环境（§13.117 D4，§13.132）：剥掉 TMUX / TMUX_PANE 与全部 CLAUDE* 变量，只留下
// 用户自己的 Claude 配置。从 Controller 的 Bash 里首次启动的 tmux 服务器会把环境交给每个新窗口：
// CLAUDECODE=1 让新 claude 以为自己是嵌套会话，桌面应用与 SDK 注入的变量（CLAUDE_EFFORT、
// CLAUDE_CODE_DISABLE_CRON、会话与消息通道标识……）会改变新会话的行为。宿主注入的名字随版本增减，
// 所以按"用户配置白名单"放行，而不是按"会话变量黑名单"剥离；ANTHROPIC_* 等非 CLAUDE 变量照旧传下去。
const USER_CLAUDE_ENVIRONMENT_NAMES = Object.freeze([
  "CLAUDE_CONFIG_DIR",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_MAX_OUTPUT_TOKENS",
  "CLAUDE_CODE_API_KEY_HELPER_TTL_MS",
  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
  "CLAUDE_CODE_CLIENT_CERT",
  "CLAUDE_CODE_CLIENT_KEY",
  "CLAUDE_CODE_CLIENT_KEY_PASSPHRASE",
]);
// 选择模型提供方与跳过其认证的变量族（CLAUDE_CODE_USE_BEDROCK / _VERTEX / _FOUNDRY、CLAUDE_CODE_SKIP_*_AUTH）。
const USER_CLAUDE_ENVIRONMENT_PREFIXES = Object.freeze(["CLAUDE_CODE_USE_", "CLAUDE_CODE_SKIP_"]);
// 每个启动或续上的会话都带的两条 allow 规则（--allowedTools）：Wakeflow MCP 工具与按本助手绝对路径调用的
// 助手本身。产品与测试窗口的根没有工作区根的 settings，助手又按绝对路径调用，相对规则对不上。
// MCP 规则必须等于 WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE（测试核对）。
const MCP_PERMISSION_RULE = "mcp__plugin_wakeflow_wakeflow";
// 送前屏幕：选择菜单或权限、信任对话框的光标行（"❯ 1. Yes"），此时输入框不在，粘贴会被吞、回车会选默认项。
const MENU_CURSOR_PATTERN = /^[❯>]\s?[0-9]+[.)]\s/u;
// resume --in-place 重启助手自己所在的 pane 时（§13.134）：先打印结果，再由脱离的子进程隔几秒 respawn；
// 重启后的会话以这一句作为首条 prompt，先 verify 再接着做。
const SELF_RESTART_DELAY_SECONDS = 2;
const SELF_RESTART_PROMPT = "Wakeflow: this Controller session restarted in place to load the updated plugin. Load the wakeflow-controller skill again, since its text may have changed, then call wakeflow_verify and continue where you left off.";
// 收养时读 claude 进程 argv 的上限（ps 的 args 列）。
const MAX_PROCESS_ARGUMENTS = 8192;

const ASSET_PATH = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(ASSET_PATH), "..", "..", "..", "..", "..", "..");

class HelperFailure extends Error {
  constructor(reason, extra) {
    super(reason);
    this.reason = reason;
    this.extra = extra ?? {};
  }
}

function refuse(reason, extra) {
  throw new HelperFailure(reason, extra);
}

function isControl(codePoint) {
  return codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f) || codePoint === 0x2028 || codePoint === 0x2029;
}

function cleanLabel(value, fallback, maximum) {
  if (typeof value !== "string") return fallback;
  let text = "";
  for (const character of value) text += isControl(character.codePointAt(0) ?? 0) ? " " : character;
  const cleaned = text.replace(/\s+/gu, " ").trim();
  return cleaned.length === 0 ? fallback : cleaned.slice(0, maximum ?? MAX_LABEL);
}

function sha256(text) {
  return "sha256:" + createHash("sha256").update(text, "utf8").digest("hex");
}

function readBoundedJson(file, maximumBytes) {
  let descriptor = null;
  try {
    descriptor = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.size > maximumBytes) return null;
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, null);
      if (count === 0) break;
      offset += count;
    }
    const after = lstatSync(file);
    if (offset !== opened.size || after.ino !== opened.ino || after.size !== opened.size) return null;
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, offset)));
  } catch {
    return null;
  } finally {
    if (descriptor !== null) {
      try {
        closeSync(descriptor);
      } catch {
        // diagnostic read is already closed
      }
    }
  }
}

function listJsonNames(directory) {
  let handle = null;
  const names = [];
  try {
    handle = opendirSync(directory);
    for (;;) {
      const entry = handle.readSync();
      if (entry === null) break;
      if (entry.isFile() && entry.name.endsWith(".json")) names.push(entry.name);
    }
  } catch {
    return [];
  } finally {
    if (handle !== null) {
      try {
        handle.closeSync();
      } catch {
        // diagnostic enumeration is already closed
      }
    }
  }
  names.sort();
  return names;
}

// Hook history is either flat v1 or UTC-day/digest-prefix partitions. Stream
// names so unrelated stop records never consume a lookup's in-memory capacity.
function* hookNames(event, relative = "", depth = 0) {
  const base = path.join(ROOT, ...HOOKS.split("/"));
  const directory = path.join(base, relative);
  let handle = null;
  try {
    const before = lstatSync(directory);
    if (!before.isDirectory() || before.isSymbolicLink() || realpathSync(directory) !== directory) refuse("hook-observations-unavailable");
    handle = opendirSync(directory);
    for (;;) {
      const entry = handle.readSync();
      if (entry === null) break;
      const child = relative === "" ? entry.name : relative + "/" + entry.name;
      const partition = depth === 0 ? /^\d{8}$/u.test(entry.name) : depth === 1 && /^[0-9a-f]{2}$/u.test(entry.name);
      if (partition) yield* hookNames(event, child, depth + 1);
      else if (entry.name.endsWith(".json") && entry.name.includes("-" + event + "-")) yield child;
    }
    const after = lstatSync(directory);
    if (before.dev !== after.dev || before.ino !== after.ino) refuse("hook-observations-unavailable");
  } catch (error) {
    if (relative === "" && handle === null && error?.code === "ENOENT") return;
    if (error instanceof HelperFailure) throw error;
    refuse("hook-observations-unavailable");
  } finally {
    if (handle !== null) {
      try { handle.closeSync(); } catch { /* already closed */ }
    }
  }
}

function readHookRecord(name) {
  const file = path.join(ROOT, ...HOOKS.split("/"), name);
  const record = readBoundedJson(file, MAX_RECORD_BYTES);
  if (record !== null && typeof record === "object" && typeof record.sessionId === "string") return record;
  try { lstatSync(file); }
  catch (error) { if (error?.code === "ENOENT") return null; }
  refuse("hook-observations-unavailable");
}

function latestHookRecord(event, sessionId, promptDigest = null) {
  let latest = null;
  let latestName = "";
  for (const name of hookNames(event)) {
    const record = readHookRecord(name);
    if (record === null || record.sessionId !== sessionId || (promptDigest !== null && record.promptDigest !== promptDigest)) continue;
    const basename = path.basename(name);
    if (basename > latestName) { latestName = basename; latest = record; }
  }
  return latest;
}

function readStdinBytes() {
  const chunks = [];
  let total = 0;
  const buffer = Buffer.alloc(65536);
  for (;;) {
    let count = 0;
    try {
      count = readSync(0, buffer, 0, buffer.length, null);
    } catch (error) {
      if (error?.code === "EAGAIN") continue;
      if (error?.code === "EOF") break;
      break;
    }
    if (count === 0) break;
    total += count;
    if (total > MAX_STDIN_BYTES) refuse("stdin-too-large");
    chunks.push(Buffer.from(buffer.subarray(0, count)));
  }
  return Buffer.concat(chunks);
}

function readStdinText() {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(readStdinBytes());
  } catch (error) {
    if (error instanceof HelperFailure) throw error;
    refuse("stdin-invalid");
  }
}

function readStdinJson() {
  const text = readStdinText();
  if (text.trim().length === 0) refuse("stdin-empty");
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) refuse("stdin-invalid");
    return parsed;
  } catch (error) {
    if (error instanceof HelperFailure) throw error;
    refuse("stdin-invalid");
  }
}

function readConfig() {
  if (!existsSync(path.join(ROOT, "wakeflow.config.json"))) refuse("root-unresolved");
  const parsed = readBoundedJson(path.join(ROOT, "wakeflow.config.json"), MAX_CONFIG_BYTES);
  if (parsed === null || typeof parsed !== "object" || parsed.kind !== "WakeflowConfig" || parsed.schemaVersion !== ${WAKEFLOW_CONFIG_SCHEMA_VERSION}) {
    refuse("config-invalid");
  }
  if (typeof parsed.program?.programId !== "string" || !Array.isArray(parsed.topology?.windows) || !Array.isArray(parsed.pods)) {
    refuse("config-invalid");
  }
  return parsed;
}

function tmuxContext(config) {
  const tmux = config.hosts?.["claude-code"]?.tmux ?? {};
  const socketName = typeof tmux.socketName === "string" && tmux.socketName.length > 0 ? tmux.socketName : null;
  const sessionName = typeof tmux.sessionName === "string" && tmux.sessionName.length > 0 ? tmux.sessionName : DEFAULT_SESSION_NAME;
  return Object.freeze({ socketName, sessionName });
}

function hostEnvironment() {
  const environment = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (name === "TMUX" || name === "TMUX_PANE") continue;
    if (
      name.startsWith("CLAUDE")
      && !USER_CLAUDE_ENVIRONMENT_NAMES.includes(name)
      && !USER_CLAUDE_ENVIRONMENT_PREFIXES.some((prefix) => name.startsWith(prefix))
    ) {
      continue;
    }
    environment[name] = value;
  }
  return environment;
}

function run(command, args, options) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: options?.env ?? hostEnvironment(),
    maxBuffer: 8 * 1024 * 1024,
    ...(options?.input === undefined ? {} : { input: options.input }),
    ...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
  });
  const ok = result.error === undefined && result.status === 0;
  return Object.freeze({ ok, stdout: result.stdout ?? "", stderr: result.stderr ?? "", status: result.status });
}

function tmuxArguments(context, args) {
  return [...(context.socketName === null ? [] : ["-L", context.socketName]), ...args];
}

function tmux(context, args, options) {
  return run("tmux", tmuxArguments(context, args), options);
}

function shellQuote(value) {
  return "'" + value.replace(/'/gu, "'\\''") + "'";
}

function claudeBinary() {
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (directory.length === 0) continue;
    const candidate = path.join(directory, "claude");
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // not in this directory
    }
  }
  return "claude";
}

function versionOf(command, versionArguments) {
  const result = run(command, versionArguments);
  if (!result.ok) return Object.freeze({ available: false, version: null });
  const line = result.stdout.split("\n").find((entry) => entry.trim().length > 0) ?? "";
  return Object.freeze({ available: true, version: cleanLabel(line, "unknown", MAX_VERSION) });
}

function currentSocketName() {
  const tmuxEnvironment = process.env.TMUX;
  if (typeof tmuxEnvironment !== "string" || tmuxEnvironment.length === 0) return null;
  const socketPath = tmuxEnvironment.split(",")[0] ?? "";
  return socketPath.length === 0 ? null : path.basename(socketPath);
}

function parseWindowId(value, name) {
  if (typeof value !== "string" || !WINDOW_ID_PATTERN.test(value)) refuse("window-id-invalid", { argument: name });
  return value;
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  const options = { window: null, all: false, force: false, inPlace: false, wait: DEFAULT_WAIT_SECONDS, handleDigest: null, waitLanding: DEFAULT_LANDING_WAIT_SECONDS, text: null };
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === "--all") {
      options.all = true;
    } else if (argument === "--force") {
      options.force = true;
    } else if (argument === "--in-place") {
      options.inPlace = true;
    } else if (argument === "--window") {
      options.window = parseWindowId(rest[index + 1], "--window");
      index += 1;
    } else if (argument === "--wait") {
      const seconds = Number(rest[index + 1]);
      if (!Number.isInteger(seconds) || seconds < 0 || seconds > MAX_WAIT_SECONDS) refuse("wait-invalid");
      options.wait = seconds;
      index += 1;
    } else if (argument === "--wait-landing") {
      const seconds = Number(rest[index + 1]);
      if (!Number.isInteger(seconds) || seconds < 0 || seconds > MAX_WAIT_SECONDS) refuse("wait-landing-invalid");
      options.waitLanding = seconds;
      index += 1;
    } else if (argument === "--text") {
      const text = rest[index + 1];
      const characters = typeof text === "string" ? [...text] : [];
      if (
        characters.length === 0
        || characters.length > NUDGE_TEXT_MAXIMUM
        || text.trim().length === 0
        || characters.some((character) => isControl(character.codePointAt(0) ?? 0))
      ) {
        refuse("text-invalid");
      }
      options.text = text;
      index += 1;
    } else if (argument === "--handle-digest") {
      const digest = rest[index + 1];
      if (typeof digest !== "string" || !DIGEST_PATTERN.test(digest)) refuse("handle-digest-invalid");
      options.handleDigest = digest;
      index += 1;
    } else {
      refuse("argument-unknown");
    }
  }
  return Object.freeze({ command: command ?? null, options: Object.freeze(options) });
}

function primaryControllerWindowId(config) {
  const primary = config.pods.find((pod) => pod?.placement === "primary");
  const controller = config.topology.windows.find((window) => (
    window?.role === "controller" && (primary === undefined || window?.podId === primary.podId)
  ));
  if (controller === undefined || typeof controller.windowId !== "string") refuse("controller-window-unknown");
  return controller.windowId;
}

function unwrapIntent(input, options) {
  const launchIntent = typeof input.launchIntent === "object" && input.launchIntent !== null ? input.launchIntent : input;
  const windowId = options.window ?? (typeof input.windowId === "string" ? input.windowId : null);
  if (windowId === null) refuse("window-required");
  parseWindowId(windowId, "--window");
  if (typeof launchIntent.intentDigest !== "string" || !DIGEST_PATTERN.test(launchIntent.intentDigest)) {
    refuse("intent-invalid", { field: "intentDigest" });
  }
  return Object.freeze({ windowId, launchIntent });
}

function resolvePlacement(placement) {
  if (typeof placement !== "string" || placement.length === 0) refuse("intent-invalid", { field: "cwd" });
  // 仓库可以放在工作区根旁边（配置里的 "../X"），所以只要求目录存在，不要求在根之内。
  const absolute = path.resolve(ROOT, placement);
  const relative = path.relative(ROOT, absolute);
  try {
    if (!statSync(absolute).isDirectory()) refuse("cwd-missing");
  } catch (error) {
    if (error instanceof HelperFailure) throw error;
    refuse("cwd-missing");
  }
  return Object.freeze({ absolute, relative: relative.length === 0 ? "." : relative });
}

function parseCreatedCoordinate(stdout) {
  const line = stdout.split("\n").find((entry) => entry.trim().length > 0) ?? "";
  const [windowId, paneId] = line.trim().split(FIELD_SEPARATOR);
  if (!TMUX_WINDOW_PATTERN.test(windowId ?? "") || !TMUX_PANE_PATTERN.test(paneId ?? "")) refuse("tmux-coordinate-invalid");
  return Object.freeze({ windowId, paneId });
}

function setWindowOptions(context, windowId, options) {
  for (const [key, value] of Object.entries(options)) {
    if (value === null || value === undefined) continue;
    const result = tmux(context, ["set-option", "-w", "-t", windowId, OPTION_NAMES[key], String(value)]);
    if (!result.ok) refuse("tmux-option-failed", { option: OPTION_NAMES[key] });
  }
}

function freezeTitle(context, windowId) {
  const result = tmux(context, ["set-option", "-w", "-t", windowId, "automatic-rename", "off"]);
  if (!result.ok) refuse("tmux-option-failed", { option: "automatic-rename" });
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function sessionStartRecord(sessionId) {
  return latestHookRecord("session-start", sessionId);
}

function waitForSessionStart(sessionId, seconds) {
  const deadline = Date.now() + seconds * 1000;
  for (;;) {
    const record = sessionStartRecord(sessionId);
    if (record !== null) return Object.freeze({ status: "observed", record });
    if (Date.now() >= deadline) return Object.freeze({ status: "pending", record: null });
    sleep(HOOK_POLL_MS);
  }
}

function observeWorktree(cwd) {
  const porcelain = run("git", ["worktree", "list", "--porcelain"], { cwd });
  const commonDir = run("git", ["rev-parse", "--git-common-dir"], { cwd });
  if (!porcelain.ok || !commonDir.ok || porcelain.stdout.length === 0 || commonDir.stdout.trim().length === 0) return null;
  return Object.freeze({ porcelain: porcelain.stdout, commonDir: commonDir.stdout.trim() });
}

function requestedWorktreeName(resolvedArguments) {
  const index = resolvedArguments.indexOf("--worktree");
  if (index === -1) return null;
  const name = resolvedArguments[index + 1];
  if (typeof name !== "string" || !WORKTREE_NAME_PATTERN.test(name)) refuse("intent-invalid", { field: "worktree-name" });
  return name;
}

// 仓库的 .git/info/exclude 里保证有 ".claude/worktrees/" 一行，主检出的 status 才不会多出一行未跟踪目录；
// 只碰这个非跟踪文件，从不改仓库里的任何跟踪文件。
function ensureWorktreeExclude(gitDir) {
  const infoDirectory = path.join(gitDir, "info");
  const excludeFile = path.join(infoDirectory, "exclude");
  let existing = "";
  try {
    existing = readFileSync(excludeFile, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") refuse("worktree-exclude-failed", { operation: "read" });
  }
  if (existing.split("\n").some((line) => WORKTREE_EXCLUDE_PATTERN.test(line.trim()))) return "present";
  try {
    mkdirSync(infoDirectory, { recursive: true });
    appendFileSync(excludeFile, (existing.length === 0 || existing.endsWith("\n") ? "" : "\n") + WORKTREE_EXCLUDE_LINE + "\n");
  } catch {
    refuse("worktree-exclude-failed", { operation: "write" });
  }
  return "appended";
}

// basePolicy local-head 的实现（§13.130 H4）：claude --worktree 对不存在的路径会从远端默认分支建检出、
// 对已有检出只加锁复用，所以助手先在仓库主检出按本地 HEAD 把检出准备好，claude 随后复用它。
// §13.130：git 调用去掉会把仓库重定向到别处的 GIT_* 变量，只认 cwd 所在的仓库。
const GIT_REDIRECT_VARIABLES = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_CEILING_DIRECTORIES"];

function git(repositoryRoot, args) {
  const env = hostEnvironment();
  for (const name of GIT_REDIRECT_VARIABLES) delete env[name];
  return run("git", args, { cwd: repositoryRoot, env });
}

function realpathOrNull(target) {
  try {
    return realpathSync(target);
  } catch {
    return null;
  }
}

// 本仓库 git worktree list --porcelain 登记的检出路径（realpath）。
function registeredWorktrees(repositoryRoot) {
  const listed = git(repositoryRoot, ["worktree", "list", "--porcelain"]);
  if (!listed.ok) refuse("worktree-list-failed");
  return listed.stdout.split("\n").filter((line) => line.startsWith("worktree ")).map((line) => realpathOrNull(line.slice(9)) ?? line.slice(9));
}

function prepareWorktree(repositoryRoot, name) {
  // §13.130：配置的落点必须就是仓库顶层，否则 git 会落到上层仓库；任何写入之前先核对。
  const placement = realpathOrNull(repositoryRoot);
  const toplevel = git(repositoryRoot, ["rev-parse", "--show-toplevel"]);
  if (placement === null || !toplevel.ok || realpathOrNull(toplevel.stdout.trim()) !== placement) refuse("worktree-root-not-toplevel");
  const commonDir = git(repositoryRoot, ["rev-parse", "--git-common-dir"]);
  if (!commonDir.ok || commonDir.stdout.trim().length === 0) refuse("worktree-repository-invalid");
  const checkout = path.join(repositoryRoot, ".claude", "worktrees", name);
  const branch = "worktree-" + name;
  if (existsSync(checkout)) {
    // §13.130：只有本仓库登记的这条检出才算复用；其他占位目录拒绝，不写任何东西。
    if (!registeredWorktrees(repositoryRoot).includes(realpathOrNull(checkout))) refuse("worktree-path-occupied", { branch });
    return Object.freeze({ prepared: "reused", branch, exclude: ensureWorktreeExclude(path.resolve(repositoryRoot, commonDir.stdout.trim())) });
  }
  // §13.130：分支已存在而检出不在时不复用旧分支（它可能不在本地 HEAD 上），交给 Controller 问用户。
  if (git(repositoryRoot, ["rev-parse", "--verify", "--quiet", "refs/heads/" + branch]).ok) refuse("worktree-branch-exists", { branch });
  const exclude = ensureWorktreeExclude(path.resolve(repositoryRoot, commonDir.stdout.trim()));
  const added = git(repositoryRoot, ["worktree", "add", "-b", branch, checkout, "HEAD"]);
  if (!added.ok) refuse("worktree-add-failed", { branch, status: added.status });
  return Object.freeze({ prepared: "created", branch, exclude });
}

function creationObservation(sessionId, launchIntentDigest, coordinates, worktree) {
  return Object.freeze({
    handle: { kind: HANDLE_KIND, value: sessionId },
    launchIntentDigest,
    observedAt: new Date().toISOString(),
    tmux: coordinates,
    ...(worktree === null ? {} : { worktree }),
  });
}

// 原生安装的 claude 是按版本号命名的二进制（pane_current_command 是 "2.1.281" 这样的字符串），
// 所以 pane 里到底跑的是不是 claude 要看进程表：pane 进程或其两层内的子进程里有可执行名为 claude 的即是。
function processTable() {
  const result = run("ps", ["-axo", "pid=,ppid=,comm="]);
  if (!result.ok) return null;
  const rows = [];
  for (const line of result.stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/u.exec(line);
    if (match !== null) rows.push({ pid: Number(match[1]), ppid: Number(match[2]), executable: match[3].trim() });
  }
  return rows;
}

// pane 进程或其两层内子进程里可执行名为 claude 的那个进程的 pid，没有就是 null。
function claudeProcessFor(panePid, table) {
  if (table === null || !Number.isInteger(panePid)) return null;
  let frontier = [panePid];
  const seen = new Set();
  for (let depth = 0; depth < 3 && frontier.length > 0; depth += 1) {
    const next = [];
    for (const pid of frontier) {
      if (seen.has(pid)) continue;
      seen.add(pid);
      const row = table.find((entry) => entry.pid === pid);
      if (row !== undefined && path.basename(row.executable) === "claude") return pid;
      for (const child of table) if (child.ppid === pid) next.push(child.pid);
    }
    frontier = next;
  }
  return null;
}

// pane 行是观察的一部分，形状不变；claude 进程的 pid 只留在助手内部（claudePids，按 pane id），收养时用（§13.134）。
function parsePaneRows(context, stdout, table) {
  const rows = [];
  const claudePids = new Map();
  for (const line of stdout.split("\n")) {
    if (line.length === 0) continue;
    const fields = line.split(FIELD_SEPARATOR);
    if (fields.length !== 11) continue;
    const [sessionName, windowId, paneId, paneDead, currentCommand, programId, hostId, logicalWindowId, bindingId, locatorId, panePid] = fields;
    if (!TMUX_WINDOW_PATTERN.test(windowId) || !TMUX_PANE_PATTERN.test(paneId)) continue;
    const optional = (value) => (value.length === 0 ? null : value.slice(0, 256));
    const claudePid = claudeProcessFor(Number(panePid), table);
    if (claudePid !== null) claudePids.set(paneId, claudePid);
    rows.push(Object.freeze({
      socketName: context.socketName,
      sessionName: sessionName.slice(0, 128),
      windowId,
      paneId,
      paneWindowId: windowId,
      paneDead: paneDead === "1",
      currentCommand: claudePid === null ? currentCommand.slice(0, 256) : "claude",
      options: Object.freeze({
        programId: optional(programId),
        hostId: optional(hostId),
        windowId: optional(logicalWindowId),
        bindingId: optional(bindingId),
        locatorId: optional(locatorId),
      }),
    }));
  }
  return Object.freeze({ rows, claudePids });
}

function listPanes(context) {
  const result = tmux(context, ["list-panes", "-a", "-F", PANE_FORMAT]);
  if (!result.ok) return Object.freeze({ available: false, rows: [], claudePids: new Map() });
  const parsed = parsePaneRows(context, result.stdout, processTable());
  return Object.freeze({ available: true, rows: parsed.rows, claudePids: parsed.claudePids });
}

function readLocator(windowId) {
  const record = readBoundedJson(path.join(ROOT, ...LOCATORS.split("/"), windowId + ".json"), MAX_RECORD_BYTES);
  if (
    record === null
    || record.kind !== "WakeflowWindowLocator"
    || record.hostId !== HOST_ID
    || record.windowId !== windowId
    || typeof record.locatorId !== "string"
    || typeof record.bindingId !== "string"
    || typeof record.programId !== "string"
    || typeof record.tmux?.sessionName !== "string"
    || !TMUX_WINDOW_PATTERN.test(record.tmux?.windowId ?? "")
    || !TMUX_PANE_PATTERN.test(record.tmux?.paneId ?? "")
  ) {
    return null;
  }
  return record;
}

function locatorWindowIds() {
  const directory = path.join(ROOT, ...LOCATORS.split("/"));
  return listJsonNames(directory)
    .map((name) => name.slice(0, -".json".length))
    .filter((name) => WINDOW_ID_PATTERN.test(name));
}

function relatedPanes(rows) {
  const locators = locatorWindowIds().map(readLocator).filter((record) => record !== null);
  const related = rows.filter((row) => (
    Object.values(row.options).some((value) => value !== null)
    || locators.some((locator) => (
      locator.tmux.sessionName === row.sessionName
      && locator.tmux.windowId === row.windowId
      && locator.tmux.paneId === row.paneId
    ))
  ));
  return Object.freeze({ panes: related.slice(0, MAX_PANES), truncated: related.length > MAX_PANES, total: rows.length });
}

function panesObservation(context) {
  const listed = listPanes(context);
  if (!listed.available) return Object.freeze({ observation: { kind: "unobserved" }, truncated: false, total: 0 });
  const related = relatedPanes(listed.rows);
  return Object.freeze({
    observation: { kind: "tmux-panes", panes: related.panes },
    truncated: related.truncated,
    total: related.total,
  });
}

function promptMarker(prompt) {
  const line = prompt.split("\n").map((entry) => entry.trim()).find((entry) => entry.length > 0) ?? "";
  return line.length < MARKER_MINIMUM ? null : line.slice(0, MARKER_MAXIMUM);
}

function attachCommand(context) {
  return (context.socketName === null ? "tmux" : "tmux -L " + context.socketName) + " attach -t " + context.sessionName;
}

function commandPreflight(config) {
  const context = tmuxContext(config);
  const session = tmux(context, ["has-session", "-t", "=" + context.sessionName]);
  return {
    ok: true,
    command: "preflight",
    node: Object.freeze({ available: true, version: cleanLabel(process.version, "unknown", MAX_VERSION) }),
    tmux: versionOf("tmux", ["-V"]),
    claude: versionOf("claude", ["--version"]),
    session: { socketName: context.socketName, sessionName: context.sessionName, present: session.ok, attach: attachCommand(context) },
    insideTmux: typeof process.env.TMUX_PANE === "string" && process.env.TMUX_PANE.length > 0,
    currentSocketName: currentSocketName(),
    sessionIdVisible: typeof process.env.CLAUDE_CODE_SESSION_ID === "string" && UUID_PATTERN.test(process.env.CLAUDE_CODE_SESSION_ID),
  };
}

// 定位器指向的 pane 还活着就不再开第二个物理窗口（旧实现 resume 的同一守卫，§13.125）。
function assertLocatorNotLive(context, windowId, options) {
  const locator = readLocator(windowId);
  if (locator === null || options.force) return;
  const listed = listPanes(context);
  if (!listed.available) return;
  const live = listed.rows.find((entry) => (
    entry.sessionName === locator.tmux.sessionName
    && entry.windowId === locator.tmux.windowId
    && entry.paneId === locator.tmux.paneId
    && !entry.paneDead
  ));
  if (live !== undefined) {
    refuse("locator-live", {
      tmux: { windowId: live.windowId, paneId: live.paneId },
      hint: "the window is still running: restart it in its own pane with resume --in-place once it is idle, or close it first",
    });
  }
}

function sessionStartNames(sessionId) {
  const names = [];
  for (const name of hookNames("session-start")) {
    const record = readHookRecord(name);
    if (record !== null && record.sessionId === sessionId) {
      if (names.length >= 16384) refuse("hook-query-incomplete");
      names.push(name);
    }
  }
  names.sort((left, right) => path.basename(left).localeCompare(path.basename(right)));
  return names;
}

// resume 之后的证据是一条新的 session-start 记录（Claude Code 对 --resume 也触发 SessionStart）。
function waitForNewSessionStart(sessionId, before, seconds) {
  const deadline = Date.now() + seconds * 1000;
  for (;;) {
    const fresh = sessionStartNames(sessionId).filter((name) => !before.has(name));
    if (fresh.length > 0) {
      const record = readHookRecord(fresh[fresh.length - 1]);
      if (record !== null) return Object.freeze({ status: "observed", record });
    }
    if (Date.now() >= deadline) return Object.freeze({ status: "pending", record: null });
    sleep(HOOK_POLL_MS);
  }
}

// SessionStart 没到时看新 pane 是否还活着：claude 拒绝 --resume（例如会话从未有过对话）会直接退出，
// 这时不能把一个已死或已消失的 pane 当作"待定"交给 relocate。坐标带会话名时（resume --in-place 用定位器的
// 坐标，§13.134）按它核对，否则按配置的会话。
function assertPaneAlive(context, command, coordinates) {
  const listed = listPanes(context);
  if (!listed.available) return;
  const sessionName = coordinates.sessionName ?? context.sessionName;
  const pane = listed.rows.find((entry) => (
    entry.sessionName === sessionName
    && entry.windowId === coordinates.windowId
    && entry.paneId === coordinates.paneId
  ));
  if (pane === undefined || pane.paneDead) {
    refuse(command + "-exited", {
      tmux: { windowId: coordinates.windowId, paneId: coordinates.paneId, pane: pane === undefined ? "absent" : "dead" },
      hint: "claude exited before its SessionStart hook; a session that never held a conversation cannot be resumed, launch a fresh one instead",
    });
  }
}

// 绝对路径只在助手进程里算出、只进 tmux 的启动命令，不进任何输出。
function sessionPermissionRules() {
  return [MCP_PERMISSION_RULE, "Bash(node " + ASSET_PATH + " *)"];
}

// pane 里启动 claude 的整条命令：--allowedTools 是变长参数，必须放在意图自己的参数之后、作为最后一个选项，只加一次。
function claudePaneCommand(resolvedArguments) {
  return [claudeBinary(), ...resolvedArguments, "--allowedTools", ...sessionPermissionRules()].map(shellQuote).join(" ");
}

function paneEnvironmentArguments() {
  return typeof process.env.PATH === "string" ? ["-e", "PATH=" + process.env.PATH] : [];
}

function intentPlacement(launchIntent, execution) {
  return resolvePlacement(execution.tmux?.cwd ?? launchIntent.root?.configuredPlacement);
}

function intentWindowName(launchIntent, execution) {
  return cleanLabel(execution.tmux?.windowName ?? launchIntent.displayTitle, "window");
}

function openTmuxWindow(config, context, windowId, launchIntent, execution, resolvedArguments) {
  const placement = intentPlacement(launchIntent, execution);
  const windowName = intentWindowName(launchIntent, execution);
  const command = claudePaneCommand(resolvedArguments);
  const exists = tmux(context, ["has-session", "-t", "=" + context.sessionName]).ok;
  const creation = tmux(context, [
    ...(exists ? ["new-window", "-d", "-t", "=" + context.sessionName] : ["new-session", "-d", "-s", context.sessionName]),
    ...paneEnvironmentArguments(),
    "-n", windowName,
    "-c", placement.absolute,
    "-P", "-F", "#{window_id}" + FIELD_SEPARATOR + "#{pane_id}",
    command,
  ]);
  if (!creation.ok) refuse("tmux-create-failed", { created: exists ? "new-window" : "new-session" });
  const coordinates = parseCreatedCoordinate(creation.stdout);
  freezeTitle(context, coordinates.windowId);
  setWindowOptions(context, coordinates.windowId, { programId: config.program.programId, hostId: HOST_ID, windowId });
  return { coordinates, windowName, placement, exists };
}

function assertExecution(execution) {
  if (
    typeof execution !== "object"
    || execution === null
    || execution.kind !== HOST_ID
    || execution.command !== "claude"
    || !Array.isArray(execution.arguments)
    || !execution.arguments.every((argument) => typeof argument === "string")
  ) {
    refuse("intent-invalid", { field: "execution" });
  }
}

// 去掉 --session-id <占位符>，改为 --resume <绑定里的会话 id>；其余参数（模型、权限、--add-dir）照旧。
function resumeArguments(execution, sessionId) {
  const resolvedArguments = [];
  for (let index = 0; index < execution.arguments.length; index += 1) {
    const argument = execution.arguments[index];
    if (argument === "--session-id" && execution.arguments[index + 1] === SESSION_ID_PLACEHOLDER) {
      index += 1;
      continue;
    }
    if (argument === SESSION_ID_PLACEHOLDER) continue;
    resolvedArguments.push(argument.startsWith(WORKSPACE_ROOT_PLACEHOLDER) ? ROOT + argument.slice(WORKSPACE_ROOT_PLACEHOLDER.length) : argument);
  }
  if (resolvedArguments.some((argument) => /^<[^>]*>$/u.test(argument))) refuse("placeholder-unresolved");
  resolvedArguments.push("--resume", sessionId);
  return resolvedArguments;
}

// 在已有 pane 里重启的 tmux 参数：-k 杀掉 pane 里现在的进程，cwd 与 PATH 同开窗口时一样。
function respawnArguments(paneId, placement, command) {
  return ["respawn-pane", "-k", "-t", paneId, "-c", placement.absolute, ...paneEnvironmentArguments(), command];
}

// 助手是否就跑在这个 pane 里：TMUX_PANE 相同，且与配置在同一个 tmux 服务器上（与 self 同一判断）。
function runsInPane(context, paneId) {
  return process.env.TMUX_PANE === paneId && (currentSocketName() ?? "default") === (context.socketName ?? "default");
}

// resume --in-place 的"已闲置"判断（§13.134）：输入框可见且为空（与 deliver 送前同一判断），而且整屏除输入框
// 本身以外没有工作中标记。工作中标记看整屏而不只尾部：计时行下面挂着待办清单时，它会被推到尾部
// SCREEN_TAIL_LINES 行之外，只看尾部会把正在工作的窗口当成闲置杀掉。
// observed 只报分类：working、menu-cursor、input-box-unseen 或 input-not-empty。
function idleAssessment(screen) {
  const prompted = promptAssessment(screen);
  if (!prompted.atPrompt) return Object.freeze({ idle: false, observed: prompted.observed });
  const all = allScreenLines(screen).map((line) => line.plain);
  // boxTop / boxBottom 是尾部里的下标，换算成整屏下标。
  const offset = all.length - Math.min(all.length, SCREEN_TAIL_LINES);
  const outside = all.filter((_, index) => index < offset + prompted.boxTop || index > offset + prompted.boxBottom);
  if (outside.some((line) => BUSY_PATTERNS.some((pattern) => pattern.test(line)))) return Object.freeze({ idle: false, observed: "working" });
  return Object.freeze({ idle: true, observed: null });
}

// 助手自己所在的 pane 不能同步 respawn（-k 会先杀掉正在等结果的会话）：交给一个脱离的 sh，隔几秒再执行同一条
// tmux 命令，参数按位置传，不再套一层 shell 引号。子进程拿到的是同一份剥过的宿主环境。
function scheduleSelfRespawn(context, tmuxCommandArguments) {
  let child;
  try {
    child = spawn("/bin/sh", ["-c", "sleep " + SELF_RESTART_DELAY_SECONDS + '; exec "$@"', "sh", "tmux", ...tmuxArguments(context, tmuxCommandArguments)], {
      detached: true,
      stdio: "ignore",
      env: hostEnvironment(),
    });
  } catch {
    refuse("restart-schedule-failed");
  }
  child.on("error", () => {
    // 同步拿不到 pid 时已经拒绝；这里只防止晚到的错误事件打断已经打印的结果
  });
  if (child.pid === undefined) refuse("restart-schedule-failed");
  child.unref();
}

// resume --in-place（§13.134，§13.133 现场 C8/F10）：插件更新后窗口要重新加载，定位器的 pane 却还活着。
// 在同一个 pane 里用 respawn-pane -k 以 claude --resume 重启同一会话、同一意图参数：tmux 坐标、定位器、绑定与
// 窗口选项（标识、冻结的标题）都不变，之后不用 relocate 也不用 mark。
function resumeInPlace(context, windowId, launchIntent, execution, sessionId, options) {
  const resolvedArguments = resumeArguments(execution, sessionId);
  const placement = intentPlacement(launchIntent, execution);
  const windowName = intentWindowName(launchIntent, execution);
  const located = locateDeliveryPane(context, windowId, null);
  if (!located.ok) refuse(located.reason, located.extra);
  const coordinates = located.locator.tmux;
  if (runsInPane(context, coordinates.paneId)) {
    // Controller 重启自己：此刻它正忙着跑这一次 Bash，所以不看屏幕；只核对它就是绑定的那个会话。
    if (process.env.CLAUDE_CODE_SESSION_ID !== sessionId) {
      refuse("self-mismatch", { hint: "this pane runs a different Claude session than the window binding; register this window again with self instead of resuming it" });
    }
    // 固定的首条 prompt 紧跟 --resume <id>，在变长的 --allowedTools 之前。
    const command = claudePaneCommand([...resolvedArguments, SELF_RESTART_PROMPT]);
    scheduleSelfRespawn(context, respawnArguments(coordinates.paneId, placement, command));
    return {
      ok: true,
      command: "resume",
      windowId,
      resumed: true,
      inPlace: true,
      self: true,
      scheduled: true,
      restartAfterSeconds: SELF_RESTART_DELAY_SECONDS,
    };
  }
  // 从未有过对话的会话 claude 拒绝 --resume，respawn 只会把窗口杀掉（§13.133 现场：没收到过投递的产品窗口）。
  // 先查这个会话有没有 user-prompt-submit 记录，没有就不动窗口，交给 close、launch、replace。
  if (!sessionConversed(sessionId)) {
    refuse("resume-never-conversed", {
      hint: "this session never held a conversation (no prompt record within the hook retention window), so claude cannot resume it; the window was left untouched: close it, launch it again, register it with replace and mark it",
    });
  }
  const captured = tmux(context, ["capture-pane", "-e", "-p", "-t", coordinates.paneId]);
  if (!captured.ok) refuse("capture-failed");
  const idle = idleAssessment(captured.stdout);
  if (!idle.idle) {
    refuse("window-busy", {
      observed: idle.observed,
      evidenceDigest: sha256(captured.stdout),
      hint: "the window is working or shows a dialog; wait until its turn ends (a dialog is answered by the user in that window), then run resume --in-place again",
    });
  }
  const before = new Set(sessionStartNames(sessionId));
  const respawned = tmux(context, respawnArguments(coordinates.paneId, placement, claudePaneCommand(resolvedArguments)));
  if (!respawned.ok) refuse("tmux-respawn-failed");
  const hook = waitForNewSessionStart(sessionId, before, options.wait);
  if (hook.status === "pending") assertPaneAlive(context, "resume", coordinates);
  return {
    ok: true,
    command: "resume",
    windowId,
    resumed: true,
    inPlace: true,
    observation: creationObservation(sessionId, launchIntent.intentDigest, {
      socketName: context.socketName,
      sessionName: coordinates.sessionName,
      windowId: coordinates.windowId,
      paneId: coordinates.paneId,
    }, null),
    hook: { sessionStart: hook.status },
    window: { name: windowName, cwd: placement.relative },
  };
}

function commandResume(config, options) {
  const context = tmuxContext(config);
  const { windowId, launchIntent } = unwrapIntent(readStdinJson(), options);
  const execution = launchIntent.execution;
  assertExecution(execution);
  const binding = readBoundedJson(path.join(ROOT, ...BINDINGS.split("/"), windowId + ".json"), MAX_RECORD_BYTES);
  const sessionId = binding?.handle?.kind === HANDLE_KIND ? binding.handle.value : null;
  if (typeof sessionId !== "string" || !UUID_PATTERN.test(sessionId)) refuse("binding-missing", { hint: "resume needs a registered window; launch a fresh one instead" });
  if (options.inPlace) return resumeInPlace(context, windowId, launchIntent, execution, sessionId, options);
  assertLocatorNotLive(context, windowId, options);
  const resolvedArguments = resumeArguments(execution, sessionId);
  const before = new Set(sessionStartNames(sessionId));
  const opened = openTmuxWindow(config, context, windowId, launchIntent, execution, resolvedArguments);
  const hook = waitForNewSessionStart(sessionId, before, options.wait);
  if (hook.status === "pending") assertPaneAlive(context, "resume", opened.coordinates);
  return {
    ok: true,
    command: "resume",
    windowId,
    resumed: true,
    observation: creationObservation(sessionId, launchIntent.intentDigest, {
      socketName: context.socketName,
      sessionName: context.sessionName,
      windowId: opened.coordinates.windowId,
      paneId: opened.coordinates.paneId,
    }, null),
    hook: { sessionStart: hook.status },
    window: { name: opened.windowName, cwd: opened.placement.relative, created: opened.exists ? "new-window" : "new-session" },
    ...(opened.exists ? {} : { attach: attachCommand(context) }),
  };
}

// 进程的完整 argv（ps 的 args 列，有界）里 --session-id 或 --resume 后面的会话 UUID（也认 "--session-id=<id>"
// 这种写法），读不到就是 null。
function sessionIdOfProcess(pid) {
  const listed = run("ps", ["-o", "args=", "-p", String(pid)]);
  if (!listed.ok) return null;
  const words = listed.stdout.slice(0, MAX_PROCESS_ARGUMENTS).split(/\s+/u);
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const inline = /^--(?:session-id|resume)=(.*)$/u.exec(word);
    if (inline !== null && UUID_PATTERN.test(inline[1])) return inline[1];
    if ((word === "--session-id" || word === "--resume") && UUID_PATTERN.test(words[index + 1] ?? "")) return words[index + 1];
  }
  return null;
}

// launch 的收养（§13.134，§13.133 现场 I6）：引导会话开了窗口、却在登记之前被关掉，窗口里的 claude 还在跑。
// 只在这个窗口没有定位器时看：带本窗口三个标识（program、host、window）的活 pane 恰好一个且在跑 claude，
// 就从那个 claude 进程的 argv 取会话 id，有它的 session-start 记录作证才收养；已死的 pane 不算，
// 已经带 binding 或 locator 标识的也不算（它登记过，后来定位器被退役，不是"从未登记"的窗口）。
// 没有候选返回 null，照常开窗口；其余情形一律拒绝，绝不开第二个窗口。
function adoptionCandidate(config, context, windowId) {
  const listed = listPanes(context);
  if (!listed.available) return null;
  const candidates = listed.rows.filter((row) => (
    !row.paneDead
    && row.options.programId === config.program.programId
    && row.options.hostId === HOST_ID
    && row.options.windowId === windowId
    && row.options.bindingId === null
    && row.options.locatorId === null
  ));
  if (candidates.length === 0) return null;
  if (candidates.length > 1) {
    refuse("window-ambiguous", {
      count: candidates.length,
      hint: "more than one live tmux pane carries this window id; have the user end all but one of them (/exit in claude, exit in a shell), then launch again",
    });
  }
  const row = candidates[0];
  const tmuxCoordinates = { windowId: row.windowId, paneId: row.paneId };
  if (row.currentCommand !== "claude") {
    refuse("window-present-not-claude", {
      tmux: tmuxCoordinates,
      observed: row.currentCommand,
      hint: "a tmux window carries this window id but does not run claude; have the user close it, then launch again",
    });
  }
  const pid = listed.claudePids.get(row.paneId);
  const sessionId = pid === undefined ? null : sessionIdOfProcess(pid);
  const record = sessionId === null ? null : sessionStartRecord(sessionId);
  if (record === null) {
    refuse("adopt-unproven", {
      tmux: tmuxCoordinates,
      hint: "a claude window for this window id is running but no SessionStart record proves its session yet; if it shows a dialog have the user answer it there, otherwise have the user exit claude in that window, then launch again",
    });
  }
  return Object.freeze({ row, sessionId, record });
}

function commandLaunch(config, options) {
  const context = tmuxContext(config);
  const { windowId, launchIntent } = unwrapIntent(readStdinJson(), options);
  const execution = launchIntent.execution;
  assertLocatorNotLive(context, windowId, options);
  assertExecution(execution);
  const sessionId = randomUUID();
  const resolvedArguments = execution.arguments.map((argument) => {
    if (argument === SESSION_ID_PLACEHOLDER) return sessionId;
    if (argument.startsWith(WORKSPACE_ROOT_PLACEHOLDER)) return ROOT + argument.slice(WORKSPACE_ROOT_PLACEHOLDER.length);
    return argument;
  });
  if (!resolvedArguments.includes(sessionId)) refuse("intent-invalid", { field: "session-id-placeholder" });
  if (resolvedArguments.some((argument) => /^<[^>]*>$/u.test(argument))) refuse("placeholder-unresolved");
  const worktreeName = requestedWorktreeName(resolvedArguments);
  const worktreeRequested = resolvedArguments.includes("--worktree");
  const localHeadWorktree = worktreeName !== null && launchIntent.worktree?.basePolicy === "local-head";
  // 意图的落点在碰 tmux 之前核对（收养也要报它）。
  const placement = intentPlacement(launchIntent, execution);
  if (readLocator(windowId) === null) {
    const adopted = adoptionCandidate(config, context, windowId);
    if (adopted !== null) {
      // 与 launch 同样按最新 session-start 记录的 cwd 读 worktree 事实；observation 带当前意图的摘要。
      const adoptedWorktree = worktreeRequested && typeof adopted.record.cwd === "string" ? observeWorktree(adopted.record.cwd) : null;
      return {
        ok: true,
        command: "launch",
        windowId,
        adopted: true,
        observation: creationObservation(adopted.sessionId, launchIntent.intentDigest, {
          socketName: context.socketName,
          sessionName: adopted.row.sessionName,
          windowId: adopted.row.windowId,
          paneId: adopted.row.paneId,
        }, adoptedWorktree),
        hook: { sessionStart: "observed" },
        window: { name: intentWindowName(launchIntent, execution), cwd: placement.relative, created: "adopted" },
        ...(worktreeRequested && adoptedWorktree === null ? { worktreeObservation: "pending" } : {}),
        worktreePrepared: localHeadWorktree ? "adopted" : "not-requested",
      };
    }
  }
  const prepared = localHeadWorktree
    ? prepareWorktree(resolvePlacement(launchIntent.root?.configuredPlacement).absolute, worktreeName)
    : null;
  // §13.130：检出准备好之后的失败仍带 worktreePrepared 与分支，Controller 才知道留下了一条检出。
  let opened;
  let hook;
  try {
    opened = openTmuxWindow(config, context, windowId, launchIntent, execution, resolvedArguments);
    hook = waitForSessionStart(sessionId, options.wait);
    if (hook.status === "pending") assertPaneAlive(context, "launch", opened.coordinates);
  } catch (error) {
    if (prepared === null) throw error;
    const failure = error instanceof HelperFailure ? error : new HelperFailure("unexpected");
    throw new HelperFailure(failure.reason, { ...failure.extra, worktreePrepared: prepared.prepared, worktreeBranch: prepared.branch });
  }
  const worktree = worktreeRequested && typeof hook.record?.cwd === "string" ? observeWorktree(hook.record.cwd) : null;
  return {
    ok: true,
    command: "launch",
    windowId,
    observation: creationObservation(sessionId, launchIntent.intentDigest, {
      socketName: context.socketName,
      sessionName: context.sessionName,
      windowId: opened.coordinates.windowId,
      paneId: opened.coordinates.paneId,
    }, worktree),
    hook: { sessionStart: hook.status },
    window: { name: opened.windowName, cwd: opened.placement.relative, created: opened.exists ? "new-window" : "new-session" },
    ...(opened.exists ? {} : { attach: attachCommand(context) }),
    ...(worktreeRequested && worktree === null ? { worktreeObservation: "pending" } : {}),
    worktreePrepared: prepared === null ? "not-requested" : prepared.prepared,
    ...(prepared === null ? {} : { worktreeBranch: prepared.branch, worktreeExclude: prepared.exclude }),
  };
}

function commandSelf(config, options) {
  const context = tmuxContext(config);
  const pane = process.env.TMUX_PANE;
  if (typeof pane !== "string" || !TMUX_PANE_PATTERN.test(pane)) refuse("not-in-tmux");
  const sessionId = process.env.CLAUDE_CODE_SESSION_ID;
  if (typeof sessionId !== "string" || !UUID_PATTERN.test(sessionId)) refuse("session-id-unavailable");
  const socketName = currentSocketName();
  if ((socketName ?? "default") !== (context.socketName ?? "default")) refuse("socket-mismatch");
  const input = readStdinJson();
  const windowId = options.window ?? (typeof input.windowId === "string" ? input.windowId : primaryControllerWindowId(config));
  const { launchIntent } = unwrapIntent({ ...input, windowId }, { window: windowId });
  const shown = tmux(context, ["display-message", "-p", "-t", pane, ["#{session_name}", "#{window_id}", "#{pane_id}"].join(FIELD_SEPARATOR)]);
  if (!shown.ok) refuse("tmux-display-failed");
  const [sessionName, tmuxWindowId, paneId] = (shown.stdout.split("\n")[0] ?? "").split(FIELD_SEPARATOR);
  if (typeof sessionName !== "string" || sessionName.length === 0 || !TMUX_WINDOW_PATTERN.test(tmuxWindowId ?? "") || paneId !== pane) {
    refuse("tmux-coordinate-invalid");
  }
  freezeTitle(context, tmuxWindowId);
  setWindowOptions(context, tmuxWindowId, { programId: config.program.programId, hostId: HOST_ID, windowId });
  return {
    ok: true,
    command: "self",
    windowId,
    observation: creationObservation(sessionId, launchIntent.intentDigest, {
      socketName: context.socketName,
      sessionName,
      windowId: tmuxWindowId,
      paneId,
    }, null),
    ...(sessionName === context.sessionName ? {} : { note: "controller-outside-configured-session" }),
  };
}

function commandPanes(config) {
  const observed = panesObservation(tmuxContext(config));
  return { ok: true, command: "panes", ...observed };
}

function commandMark(config, options) {
  const context = tmuxContext(config);
  const windowIds = options.all ? locatorWindowIds() : options.window === null ? refuse("window-required") : [options.window];
  const windows = [];
  for (const windowId of windowIds) {
    const locator = readLocator(windowId);
    if (locator === null) {
      windows.push({ windowId, status: "locator-missing" });
      continue;
    }
    const shown = tmux(context, ["display-message", "-p", "-t", locator.tmux.paneId, "#{window_id}"]);
    if (!shown.ok || shown.stdout.trim() !== locator.tmux.windowId) {
      windows.push({ windowId, status: "pane-missing" });
      continue;
    }
    setWindowOptions(context, locator.tmux.windowId, {
      programId: locator.programId,
      hostId: HOST_ID,
      windowId,
      bindingId: locator.bindingId,
      locatorId: locator.locatorId,
    });
    windows.push({ windowId, status: "marked" });
  }
  return { ok: windows.every((entry) => entry.status === "marked"), command: "mark", windows };
}

function beforeSend(reason, windowId, extra) {
  return { ok: false, command: "deliver", windowId, reason, attempt: { status: "failed-before-send" }, ...(extra ?? {}) };
}

// pane 行与定位器的坐标一致。
function paneCoordinatesMatch(locator, entry) {
  return entry.sessionName === locator.tmux.sessionName
    && entry.windowId === locator.tmux.windowId
    && entry.paneId === locator.tmux.paneId;
}

// pane 行带着这个窗口的五个 @wakeflow_* 标识。
function paneMetadataMatch(locator, windowId, entry) {
  return entry.options.programId === locator.programId
    && entry.options.hostId === HOST_ID
    && entry.options.windowId === windowId
    && entry.options.bindingId === locator.bindingId
    && entry.options.locatorId === locator.locatorId;
}

// deliver 与 nudge 共用的送前 pane authority（与旧实现同形，§13.122）：定位器、可选的句柄摘要、按坐标或
// 标识相关的 pane 恰好一个、活着、跑的是 claude、标识与坐标都对。失败只描述原因，由各命令决定输出形状。
function locateDeliveryPane(context, windowId, handleDigest) {
  const failure = (reason, extra) => Object.freeze({ ok: false, reason, extra: extra ?? {} });
  const locator = readLocator(windowId);
  if (locator === null) return failure("locator-missing");
  if (handleDigest !== null) {
    const binding = readBoundedJson(path.join(ROOT, ...BINDINGS.split("/"), windowId + ".json"), MAX_RECORD_BYTES);
    const value = binding?.handle?.kind === HANDLE_KIND ? binding.handle.value : null;
    if (typeof value !== "string" || sha256(value) !== handleDigest) return failure("handle-mismatch");
  }
  const listed = listPanes(context);
  if (!listed.available) return failure("panes-unavailable");
  const coordinatesMatch = (entry) => paneCoordinatesMatch(locator, entry);
  const metadataMatch = (entry) => paneMetadataMatch(locator, windowId, entry);
  // 与旧实现的 pane authority 同形：按坐标或标识相关的 pane 必须恰好一个、活着、跑的是 claude，
  // 标识与坐标都对才粘贴（gate-log §13.122）。
  const related = listed.rows.filter((entry) => coordinatesMatch(entry) || metadataMatch(entry));
  if (related.length === 0) return failure("pane-missing");
  if (related.length > 1) return failure("duplicate-pane", { panes: related.map((entry) => entry.paneId) });
  const row = related[0];
  if (row.paneDead) return failure("pane-dead");
  if (!metadataMatch(row)) return failure("metadata-mismatch", { hint: "run mark for this window first" });
  if (!coordinatesMatch(row)) {
    return failure("locator-stale", {
      hint: "the marked pane moved; register the window again",
      observed: { windowId: row.windowId, paneId: row.paneId },
    });
  }
  if (row.currentCommand !== "claude") return failure("wrong-process", { observed: row.currentCommand });
  return Object.freeze({ ok: true, locator, row });
}

// 粘贴并回车一次：tmux 缓冲区装文本、paste-buffer 进 pane、send-keys Enter。失败只报到哪一步。
function pasteAndSubmit(context, paneId, text) {
  const bufferName = "wakeflow-" + randomUUID();
  const loaded = tmux(context, ["load-buffer", "-b", bufferName, "-"], { input: text });
  if (!loaded.ok) return Object.freeze({ stage: "load-buffer" });
  const pasted = tmux(context, ["paste-buffer", "-d", "-p", "-b", bufferName, "-t", paneId]);
  if (!pasted.ok) {
    tmux(context, ["delete-buffer", "-b", bufferName]);
    return Object.freeze({ stage: "paste" });
  }
  const entered = tmux(context, ["send-keys", "-t", paneId, "Enter"]);
  if (!entered.ok) return Object.freeze({ stage: "enter" });
  return Object.freeze({ stage: null });
}

// 回读的两种屏幕证据（§13.130 H1）：prompt 首行子串，或 Claude Code 把整段粘贴折叠成的
// "[Pasted text #N +M lines]" 指示。M 是它折叠的文本里的换行数：现场看到的是 prompt（去首尾空白后）
// 的行数减一，按原样粘贴的换行数也认；一行的 prompt 只有不带计数的指示。
// 只认输入框里的那一个指示（§13.130）：它必须在屏幕上最后一个输入框行里、且是全屏最后一个指示；
// 对话区里更早投递留下的同形指示不算。
function pastedIndicatorAgrees(prompt, screen) {
  const trimmedLines = prompt.trim().split("\n").length;
  const pastedBreaks = prompt.split("\n").length - 1;
  const lines = screen.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  let inputIndex = -1;
  lines.forEach((line, index) => {
    if (INPUT_LINE_PATTERN.test(line)) inputIndex = index;
  });
  if (inputIndex < 0) return false;
  if (lines.slice(inputIndex + 1).some((line) => [...line.matchAll(PASTED_TEXT_INDICATOR)].length > 0)) return false;
  const found = [...lines[inputIndex].matchAll(PASTED_TEXT_INDICATOR)].at(-1);
  if (found === undefined) return false;
  if (found[1] === undefined) return trimmedLines === 1;
  const count = Number(found[1]);
  return count === trimmedLines - 1 || count === pastedBreaks;
}

function readbackObservation(prompt, screen) {
  const marker = promptMarker(prompt);
  const seen = (marker !== null && screen.includes(marker)) || pastedIndicatorAgrees(prompt, screen);
  return { status: seen ? "confirmed" : "pending", evidenceDigest: sha256(screen) };
}

function commandDeliver(config, options) {
  const context = tmuxContext(config);
  if (options.window === null) refuse("window-required");
  const windowId = options.window;
  const prompt = readStdinText();
  if (prompt.trim().length === 0) refuse("stdin-empty");
  const located = locateDeliveryPane(context, windowId, options.handleDigest);
  if (!located.ok) return beforeSend(located.reason, windowId, located.extra);
  const locator = located.locator;
  // 幂等：同一段 prompt 已经在目标会话落地（有它的 user-prompt-submit 记录）就不再粘贴——被宿主
  // 中断的一轮重发时拿到的是落地证据而不是第二次投递；--force 才照发（§13.127）。
  const landed = observeLanding(windowId, prompt, 0);
  if (landed.status === "observed" && !options.force) {
    return beforeSend("already-landed", windowId, {
      landing: landed,
      hint: "this prompt already landed in the bound session; record the outcome with this landing instead of sending again (--force sends anyway)",
    });
  }
  // 送前看一眼 pane：输入框不在（权限、信任对话框或选择菜单）就不粘贴——粘贴会被吞，回车会替用户选默认项。
  // 工作中的 pane 只要输入框可见仍照发（排队是正常的）。--force 不跳过这一步。
  const before = tmux(context, ["capture-pane", "-e", "-p", "-t", locator.tmux.paneId]);
  if (!before.ok) return beforeSend("capture-failed", windowId);
  const prompted = promptAssessment(before.stdout);
  if (!prompted.atPrompt) {
    return beforeSend("target-not-at-prompt", windowId, {
      observed: prompted.observed,
      evidenceDigest: sha256(before.stdout),
      hint: "the target pane shows a dialog or menu instead of its input box; have the user answer it in that window, then rearm",
    });
  }
  const submitted = pasteAndSubmit(context, locator.tmux.paneId, prompt);
  if (submitted.stage === "load-buffer") return beforeSend("load-buffer-failed", windowId);
  if (submitted.stage !== null) return { ok: false, command: "deliver", windowId, reason: submitted.stage + "-failed", attempt: { status: "unknown" } };
  const attemptDigest = sha256(JSON.stringify({
    sessionName: locator.tmux.sessionName,
    windowId: locator.tmux.windowId,
    paneId: locator.tmux.paneId,
    promptDigest: sha256(prompt),
  }));
  const captured = tmux(context, ["capture-pane", "-p", "-t", locator.tmux.paneId]);
  const readback = captured.ok ? readbackObservation(prompt, captured.stdout) : { status: "unavailable" };
  const landing = observeLanding(windowId, prompt, options.waitLanding);
  return { ok: true, command: "deliver", windowId, attempt: { status: "sent", evidenceDigest: attemptDigest }, readback, landing };
}

// 会话是否有过对话：保留期内有它的任一条 user-prompt-submit 记录。
function sessionConversed(sessionId) {
  return latestHookRecord("user-prompt-submit", sessionId) !== null;
}

// 落地证据是目标会话的 user-prompt-submit hook 记录：摘要按内核规则取去首尾空白后 UTF-8 的 SHA-256；
// 观察脚本已剥掉宿主的粘贴外壳，所以记录里的摘要就是这里算的值。只查已存在的记录，不推断。
function promptSubmitRecord(sessionId, promptDigest) {
  return latestHookRecord("user-prompt-submit", sessionId, promptDigest);
}

function observeLanding(windowId, prompt, seconds) {
  const binding = readBoundedJson(path.join(ROOT, ...BINDINGS.split("/"), windowId + ".json"), MAX_RECORD_BYTES);
  const sessionId = binding?.handle?.kind === HANDLE_KIND ? binding.handle.value : null;
  if (typeof sessionId !== "string") return { status: "unavailable" };
  const promptDigest = sha256(prompt.trim());
  const deadline = Date.now() + seconds * 1000;
  for (;;) {
    const record = promptSubmitRecord(sessionId, promptDigest);
    if (record !== null) {
      return {
        status: "observed",
        recordId: typeof record.recordId === "string" ? record.recordId : null,
        recordedAt: typeof record.recordedAt === "string" ? record.recordedAt : null,
      };
    }
    if (Date.now() >= deadline) return { status: "pending", promptDigest };
    sleep(HOOK_POLL_MS);
  }
}

// 屏幕尾部（最后 SCREEN_TAIL_LINES 个非空行）：Claude Code 的错误行、工作中标记与输入框都在这里。
// 屏幕可以带 SGR 属性（capture-pane -e）：结构判断看去掉属性后的文字；输入框里的暗色（SGR 2）段是
// Claude Code 的占位提示或提示建议（§13.133 现场：回合结束后输入框里的灰色建议），不算用户打的字。
const SGR_PATTERN = /\u001b\[[0-9;]*m/gu;
const DIM_SEGMENT_PATTERN = /\u001b\[2m.*?(?:\u001b\[(?:0|22)m|$)/gu;

// 整屏的非空行（capture-pane 不带 -S 只截可见的一屏）。
function allScreenLines(screen) {
  return screen
    .split("\n")
    .map((raw) => ({ raw, plain: raw.replace(SGR_PATTERN, "").trim() }))
    .filter((line) => line.plain.length > 0);
}

function screenLines(screen) {
  return allScreenLines(screen).slice(-SCREEN_TAIL_LINES);
}

function screenTail(screen) {
  return screenLines(screen).map((line) => line.plain);
}

function typedInput(rawLine) {
  const text = rawLine.replace(DIM_SEGMENT_PATTERN, "").replace(SGR_PATTERN, "").trim();
  const found = INPUT_LINE_PATTERN.exec(text);
  return (found === null ? text : found[1]).trim();
}

// 输入框上方最后一条对话行：取尾部最后一个输入框行之前、跳过输入框边框线的最后一行。
function lastTranscriptLine(tail) {
  let inputIndex = -1;
  tail.forEach((line, index) => {
    if (INPUT_LINE_PATTERN.test(line)) inputIndex = index;
  });
  const above = tail.slice(0, inputIndex).filter((line) => !INPUT_BORDER_PATTERN.test(line));
  return above.at(-1) ?? null;
}

// deliver 送前的屏幕判断（§13.130 审查，§13.132 现场）：输入框是"边框线、输入行（及续行）、边框线"这一结构，
// 取尾部最后一对边框线夹住的块，块的第一行必须是输入行且不是菜单光标行（"❯ 1. Yes"）。信任对话框的
// "❯ No, exit"、权限与选择菜单都不在两条边框线之间，一律拒绝；对话记录里渲染过的 "> 1. …" 在输入框之上，
// 不影响判断；输入框里已有别人打了一半的字也拒绝。observed 只报分类（menu-cursor、input-box-unseen 或
// input-not-empty），不回显屏幕文字：权限选项里会出现命令与绝对目录。
function promptAssessment(screen) {
  const lines = screenLines(screen);
  const tail = lines.map((line) => line.plain);
  const borders = tail.map((line, index) => (INPUT_BORDER_PATTERN.test(line) ? index : -1)).filter((index) => index >= 0);
  const lower = borders.at(-1);
  const upper = borders.at(-2);
  const inputLine = lower !== undefined && upper !== undefined && lower - upper >= 2 ? tail[upper + 1] : undefined;
  if (inputLine === undefined || !INPUT_LINE_PATTERN.test(inputLine) || MENU_CURSOR_PATTERN.test(inputLine)) {
    const menu = tail.some((line) => MENU_CURSOR_PATTERN.test(line));
    return Object.freeze({ atPrompt: false, observed: menu ? "menu-cursor" : "input-box-unseen" });
  }
  // 输入框里已有文字（暗色的占位提示与提示建议除外）：粘贴会接在别人打了一半的字后面、回车一起提交，同样拒绝。
  const typed = typedInput(lines[upper + 1].raw);
  if (typed.length > 0 && !typed.startsWith(INPUT_PLACEHOLDER_PREFIX)) {
    return Object.freeze({ atPrompt: false, observed: "input-not-empty" });
  }
  // boxTop / boxBottom 是输入框两条边框线在尾部里的下标，resume --in-place 的闲置判断据此把输入框本身排除在外。
  return Object.freeze({ atPrompt: true, observed: null, boxTop: upper, boxBottom: lower });
}

// 只在"被切断且已闲置"时才推一句（§13.130 H3）：尾部有 API Error 行且它是输入框上方最后一条对话行、
// 没有工作中标记、输入框可见且为空。
function nudgeAssessment(screen) {
  const tail = screenTail(screen);
  const errorLine = tail.filter((line) => API_ERROR_PATTERN.test(line)).pop() ?? null;
  if (errorLine === null) return Object.freeze({ status: "not-needed", observedError: null, observedBusy: null });
  const observedError = cleanLabel(errorLine, "API Error", NUDGE_TEXT_MAXIMUM);
  for (const line of tail) {
    if (BUSY_PATTERNS.some((pattern) => pattern.test(line))) {
      return Object.freeze({ status: "busy", observedError, observedBusy: cleanLabel(line, "working", NUDGE_TEXT_MAXIMUM) });
    }
  }
  const lines = screenLines(screen);
  const inputIndex = tail.findLastIndex((line) => INPUT_LINE_PATTERN.test(line));
  const inputLine = inputIndex < 0 ? null : INPUT_LINE_PATTERN.exec(tail[inputIndex]);
  if (inputLine === null) return Object.freeze({ status: "busy", observedError, observedBusy: "input-box-unseen" });
  const typed = typedInput(lines[inputIndex].raw);
  if (typed.length > 0 && !typed.startsWith(INPUT_PLACEHOLDER_PREFIX)) {
    return Object.freeze({ status: "busy", observedError, observedBusy: "input-not-empty" });
  }
  // 错误行必须是输入框上方最后一条对话行（§13.130）：之后有回复、完成行、已渲染的用户消息
  // （例如上一次推过的 "Continue."）或任何输出，说明这一轮已经往下走了，不再粘贴。
  if (lastTranscriptLine(tail) !== errorLine) return Object.freeze({ status: "not-needed", observedError, observedBusy: null });
  return Object.freeze({ status: "nudged", observedError, observedBusy: null });
}

function commandNudge(config, options) {
  const context = tmuxContext(config);
  if (options.window === null) refuse("window-required");
  const windowId = options.window;
  const located = locateDeliveryPane(context, windowId, null);
  if (!located.ok) {
    return { ok: false, command: "nudge", windowId, status: "pane-missing", reason: located.reason, observedError: null, ...located.extra };
  }
  const paneId = located.locator.tmux.paneId;
  const captured = tmux(context, ["capture-pane", "-e", "-p", "-t", paneId]);
  if (!captured.ok) refuse("capture-failed");
  const evidenceDigest = sha256(captured.stdout);
  const assessed = nudgeAssessment(captured.stdout);
  if (assessed.status !== "nudged") {
    return {
      ok: true,
      command: "nudge",
      windowId,
      status: assessed.status,
      observedError: assessed.observedError,
      ...(assessed.observedBusy === null ? {} : { observedBusy: assessed.observedBusy }),
      evidenceDigest,
    };
  }
  const text = options.text ?? NUDGE_DEFAULT_TEXT;
  const submitted = pasteAndSubmit(context, paneId, text);
  if (submitted.stage !== null) {
    return { ok: false, command: "nudge", windowId, reason: submitted.stage + "-failed", observedError: assessed.observedError, evidenceDigest };
  }
  return {
    ok: true,
    command: "nudge",
    windowId,
    status: "nudged",
    observedError: assessed.observedError,
    evidenceDigest,
    textDigest: sha256(text.trim()),
  };
}

function commandClose(config, options) {
  const context = tmuxContext(config);
  if (options.window === null) refuse("window-required");
  const windowId = options.window;
  const locator = readLocator(windowId);
  if (locator === null) refuse("locator-missing");
  const preClose = panesObservation(context).observation;
  // tmux 服务重启后窗口 @N 会复用：只在恰好一个 pane 同时对上坐标与本窗口标识时才杀，
  // 否则不动任何窗口，报 unknown 交给人工宿主关口。
  const listed = listPanes(context);
  const owned = listed.available
    ? listed.rows.filter((entry) => paneCoordinatesMatch(locator, entry) && paneMetadataMatch(locator, windowId, entry))
    : [];
  if (owned.length !== 1) {
    return {
      ok: true,
      command: "close",
      windowId,
      closure: { preClose, closeResult: { status: "unknown" }, postClose: preClose },
    };
  }
  const killed = tmux(context, ["kill-window", "-t", locator.tmux.windowId]);
  const postClose = panesObservation(context).observation;
  return {
    ok: true,
    command: "close",
    windowId,
    closure: { preClose, closeResult: { status: killed.ok ? "closed" : "failed" }, postClose },
  };
}

// 引导过程要重来时的复位：没有任何登记窗口时才杀配置的 tmux 会话，除非 --force。
function commandTeardown(config, options) {
  const context = tmuxContext(config);
  const registered = locatorWindowIds();
  if (registered.length > 0 && !options.force) refuse("windows-registered", { registered: registered.length });
  const present = tmux(context, ["has-session", "-t", "=" + context.sessionName]).ok;
  if (!present) return { ok: true, command: "teardown", sessionName: context.sessionName, status: "absent" };
  const killed = tmux(context, ["kill-session", "-t", "=" + context.sessionName]);
  return { ok: killed.ok, command: "teardown", sessionName: context.sessionName, status: killed.ok ? "killed" : "failed" };
}

function emit(value, exitCode) {
  process.stdout.write(JSON.stringify(value) + "\n");
  process.exitCode = exitCode;
}

function main() {
  let parsed;
  try {
    parsed = parseArguments(process.argv.slice(2));
    const config = readConfig();
    const options = parsed.options;
    let result;
    switch (parsed.command) {
      case "preflight":
        result = commandPreflight(config);
        break;
      case "resume":
        result = commandResume(config, options);
        break;
      case "launch":
        result = commandLaunch(config, options);
        break;
      case "self":
        result = commandSelf(config, options);
        break;
      case "panes":
        result = commandPanes(config);
        break;
      case "mark":
        result = commandMark(config, options);
        break;
      case "deliver":
        result = commandDeliver(config, options);
        break;
      case "nudge":
        result = commandNudge(config, options);
        break;
      case "close":
        result = commandClose(config, options);
        break;
      case "teardown":
        result = commandTeardown(config, options);
        break;
      default:
        refuse("command-unknown");
    }
    emit(result, result.ok ? 0 : 1);
  } catch (error) {
    if (error instanceof HelperFailure) {
      emit({ ok: false, command: parsed?.command ?? null, reason: error.reason, ...error.extra }, 1);
      return;
    }
    emit({ ok: false, command: parsed?.command ?? null, reason: "unexpected" }, 2);
  }
}

main();
`;
/** 资产的精确字节：维护事务写入的就是这一份，verify 按它核对。 */
export const CLAUDE_CODE_TMUX_ASSET_CONTENT = SCRIPT.endsWith("\n") ? SCRIPT : `${SCRIPT}\n`;
export const CLAUDE_CODE_TMUX_ASSET_DIGEST = computeSha256Digest(encodeUtf8(CLAUDE_CODE_TMUX_ASSET_CONTENT, "$asset"), "$asset");
