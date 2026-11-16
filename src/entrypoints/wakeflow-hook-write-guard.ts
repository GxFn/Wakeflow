import nodePath from "node:path";

import { parseWakeflowHostId } from "../kernel/layout.js";
import {
  type HookHostId,
  isEqualOrUnder,
  isRecord,
  matchingWorkspaces,
  parseHookStdinObject,
  readWakeflowConfigRecord,
  realpathOrNull,
  resolveSubject,
  sessionBoundWindowIds,
} from "./wakeflow-hook-workspaces.js";

/**
 * Wakeflow Entrypoint / Hook Write Guard：受管路径的写守卫（ADR-0020 决定 6 的 2026-11-16 补充，open-items X30）。
 *
 * 宿主在 `PreToolUse` 上、对编辑工具（matcher 在 hook 片段里）同步启动观察脚本并带上本模块的标记；观察器的
 * 进程入口按标记把这一次调用交到这里。判定只有一条：这个会话在某个匹配的工作区里绑定着窗口、绑定的每个
 * 窗口在配置里都是 Controller 之外的已知角色、并且工具要写的路径落在那个工作区的受管路径里——才拒绝。
 * 受管路径与角色同 tmux 助手启动时带的 deny 规则是一张表（`CLAUDE_CODE_MANAGED_WRITE_DENY`，宿主层；
 * 本模块的闭包按 D1 限于 foundation 与 kernel，所以这里是字面量，测试核对两处相等），账本根读配置。
 *
 * 其余一律放行：非 Wakeflow 会话、没有绑定的会话、Controller、角色认不出、配置读不出、stdin 不合形状或
 * 超限、任何内部故障。它是降低误用的一层，不是隔离——只拦宿主的编辑工具，拦不住 Bash 与任意子进程；所以
 * 拿不准时放行，一个出错的守卫不能挡住任何会话的编辑。
 *
 * 载体与启动参数的区别：`--disallowedTools` 只随 tmux 助手启动的那条命令带入，桌面 app 接手会话之后不保留
 * （§13.249 现场核实）；插件 hook 随插件在每个会话里生效，两种传输同一份。
 *
 * 进程合同：拒绝时向 stdout 写恰好一行 hook 决定 JSON（`permissionDecision: "deny"`），放行时 stdout 为空；
 * 退出码始终为 0（非 0 非 2 的退出码在宿主那里同样是放行，退出 0 加 JSON 是宿主文档给的拒绝形式）。
 * stderr 只在异常时打一行固定代码，不含路径与会话标识。
 */

export const WAKEFLOW_WRITE_GUARD_MARKER = "--wakeflow-write-guard-v1";
export const WAKEFLOW_WRITE_GUARD_HOST_ARGUMENT = "--host";
/** 宿主交来的事件名；别的事件带着本标记启动时一律放行。 */
export const WAKEFLOW_WRITE_GUARD_EVENT = "PreToolUse";
/** `Write` 的 `tool_input` 带整份内容：超过这个大小的调用读不出路径，放行。 */
export const WAKEFLOW_WRITE_GUARD_STDIN_MAXIMUM_BYTES = 4 * 1024 * 1024;

/**
 * 受管路径的写拒绝表（相对工作区根）：与宿主层的 `CLAUDE_CODE_MANAGED_WRITE_DENY` 逐项相等，
 * `tests/entrypoints/wakeflow-hook-write-guard.test.ts` 钉着。目录整棵拒绝，文件按名字拒绝。
 */
export const WAKEFLOW_WRITE_GUARD_MANAGED_PATHS = Object.freeze({
  roles: Object.freeze(["design", "product", "test"] as const),
  directories: Object.freeze([".wakeflow-local", ".wakeflow-active"] as const),
  files: Object.freeze([
    "wakeflow.config.json",
    ".claude/settings.json",
    ".claude/settings.local.json",
  ] as const),
});

/** 拒绝时交给宿主、由宿主转给那个窗口里的 agent 的说明：不含路径，告诉它该怎么办。 */
export const WAKEFLOW_WRITE_GUARD_DENIAL_REASON =
  "Wakeflow write guard: this path holds Wakeflow-managed state of the workspace (its " +
  "configuration, runtime records, active Demand files, ledger, or the workspace's Claude Code " +
  "settings). A window bound as design, product or test does not edit it; Wakeflow's tools and " +
  "the Controller window write it. Do not retry through another tool or a shell command. If the " +
  "assigned work appears to need a change there, stop and say so in your result.";

/** 写守卫自己的 stderr 词汇表；`launcher` 与 `node-version` 仍由制品 launcher 以观察器的前缀打出。 */
export type WriteGuardCode =
  | "argv-invalid"
  | "host-unknown"
  | "stdin-too-large"
  | "stdin-invalid"
  | "event-unknown"
  | "internal";

export interface WriteGuardInput {
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdin: Uint8Array | string;
}

export interface WriteGuardOutcome {
  readonly decision: "allow" | "deny";
  /** 只在调用本身不合形状或内部故障时非 null；正常的放行与拒绝都是 null。 */
  readonly code: WriteGuardCode | null;
}

interface GuardRequest {
  readonly sessionId: string;
  readonly cwd: string;
  /** 工具要写的路径；这个工具调用不带路径时为 null。 */
  readonly target: string | null;
}

const CANONICAL_WALK_MAXIMUM_LEVELS = 64;
const GUARDED_ROLES: readonly string[] = WAKEFLOW_WRITE_GUARD_MANAGED_PATHS.roles;

function allow(code: WriteGuardCode | null = null): WriteGuardOutcome {
  return Object.freeze({ decision: "allow" as const, code });
}

const DENY: WriteGuardOutcome = Object.freeze({ decision: "deny" as const, code: null });

/** argv 固定为 `<标记> --host <宿主>`，与观察器同形。 */
function parseHost(argv: unknown): Readonly<{ hostId: HookHostId }> | WriteGuardCode {
  if (!Array.isArray(argv) || argv.length !== 3) return "argv-invalid";
  const [marker, argument, host] = argv as readonly unknown[];
  if (marker !== WAKEFLOW_WRITE_GUARD_MARKER || argument !== WAKEFLOW_WRITE_GUARD_HOST_ARGUMENT) {
    return "argv-invalid";
  }
  try {
    return Object.freeze({ hostId: parseWakeflowHostId(host, "$argv.host") });
  } catch {
    return "host-unknown";
  }
}

/** 编辑工具的路径键：`Edit`、`Write` 是 `file_path`，`NotebookEdit` 是 `notebook_path`。 */
function targetOf(toolInput: unknown): string | null {
  if (!isRecord(toolInput)) return null;
  for (const key of ["file_path", "notebook_path"] as const) {
    const value = toolInput[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function parseRequest(object: Readonly<Record<string, unknown>>): GuardRequest | WriteGuardCode {
  const sessionId = object.session_id;
  const cwd = object.cwd;
  const eventName = object.hook_event_name;
  if (
    typeof sessionId !== "string" ||
    sessionId.length === 0 ||
    typeof cwd !== "string" ||
    !nodePath.isAbsolute(cwd) ||
    typeof eventName !== "string"
  ) {
    return "stdin-invalid";
  }
  if (eventName !== WAKEFLOW_WRITE_GUARD_EVENT) return "event-unknown";
  return Object.freeze({ sessionId, cwd, target: targetOf(object.tool_input) });
}

/**
 * 一个路径的真实写法：它自己存在就取 realpath；不存在（要新建的文件）就取最近一级存在的祖先的 realpath
 * 再接上其余各段。祖先里的符号链接因此被解开，受管目录下新建文件也认得出。
 */
async function canonicalPath(target: string): Promise<string> {
  const rest: string[] = [];
  let existing = target;
  for (let level = 0; level < CANONICAL_WALK_MAXIMUM_LEVELS; level += 1) {
    const real = await realpathOrNull(existing);
    if (real !== null) return rest.length === 0 ? real : nodePath.join(real, ...rest);
    const parent = nodePath.dirname(existing);
    if (parent === existing) break;
    rest.unshift(nodePath.basename(existing));
    existing = parent;
  }
  return target;
}

/** 字面写法与真实写法：宿主按哪一种交来都认。 */
async function spellingsOf(target: string): Promise<readonly string[]> {
  const canonical = await canonicalPath(target);
  return canonical === target ? [target] : [target, canonical];
}

/** 绑定着这个会话的每个窗口都在配置里、都是 Controller 之外的已知角色才算；认不出的一律不算。 */
function everyBoundWindowIsGuarded(
  topology: Readonly<Record<string, unknown>>,
  windowIds: readonly (string | null)[],
): boolean {
  const windows = topology.windows;
  if (!Array.isArray(windows)) return false;
  for (const windowId of windowIds) {
    if (windowId === null) return false;
    const declared = (windows as readonly unknown[]).find(
      (entry) => isRecord(entry) && entry.windowId === windowId,
    );
    if (!isRecord(declared) || typeof declared.role !== "string") return false;
    if (!GUARDED_ROLES.includes(declared.role)) return false;
  }
  return true;
}

/**
 * 配置里的账本根（绝对路径）。读不出即 null；账本根等于工作区根或包着它时也当作读不出——那样的配置会让
 * 整个工作区都变成"受管"，守卫宁可不拦账本也不挡住所有编辑。
 */
function ledgerRootOf(root: string, config: Readonly<Record<string, unknown>>): string | null {
  const storage = config.storage;
  if (!isRecord(storage) || typeof storage.ledgerRoot !== "string") return null;
  if (storage.ledgerRoot.length === 0) return null;
  const ledgerRoot = nodePath.resolve(root, storage.ledgerRoot);
  return isEqualOrUnder(root, ledgerRoot) ? null : ledgerRoot;
}

async function underAnyDirectory(
  targets: readonly string[],
  directories: readonly string[],
): Promise<boolean> {
  for (const directory of directories) {
    for (const spelling of await spellingsOf(directory)) {
      if (targets.some((target) => isEqualOrUnder(target, spelling))) return true;
    }
  }
  return false;
}

async function isAnyFile(targets: readonly string[], files: readonly string[]): Promise<boolean> {
  for (const file of files) {
    for (const spelling of await spellingsOf(file)) {
      if (targets.includes(spelling)) return true;
    }
  }
  return false;
}

async function targetIsManaged(
  root: string,
  config: Readonly<Record<string, unknown>>,
  targets: readonly string[],
): Promise<boolean> {
  const ledgerRoot = ledgerRootOf(root, config);
  const directories = [
    ...WAKEFLOW_WRITE_GUARD_MANAGED_PATHS.directories.map((entry) => nodePath.join(root, entry)),
    ...(ledgerRoot === null ? [] : [ledgerRoot]),
  ];
  if (await underAnyDirectory(targets, directories)) return true;
  return isAnyFile(
    targets,
    WAKEFLOW_WRITE_GUARD_MANAGED_PATHS.files.map((entry) =>
      nodePath.join(root, ...entry.split("/")),
    ),
  );
}

async function workspaceDenies(
  root: string,
  hostId: HookHostId,
  sessionId: string,
  targets: readonly string[],
): Promise<boolean> {
  const windowIds = await sessionBoundWindowIds(root, hostId, sessionId);
  if (windowIds.length === 0) return false;
  const config = await readWakeflowConfigRecord(root);
  if (config === null || !everyBoundWindowIsGuarded(config.topology, windowIds)) return false;
  return targetIsManaged(root, config, targets);
}

async function decide(input: WriteGuardInput): Promise<WriteGuardOutcome> {
  const host = parseHost(input.argv);
  if (typeof host === "string") return allow(host);
  const parsed = parseHookStdinObject(input.stdin, WAKEFLOW_WRITE_GUARD_STDIN_MAXIMUM_BYTES);
  if (!parsed.ok) return allow(parsed.code);
  const request = parseRequest(parsed.value);
  if (typeof request === "string") return allow(request);
  if (request.target === null) return allow();
  const subject = await resolveSubject(request.cwd, isRecord(input.env) ? input.env : {});
  if (subject === null) return allow();
  const workspaces = await matchingWorkspaces(subject);
  if (workspaces.length === 0) return allow();
  const targets = await spellingsOf(nodePath.resolve(request.cwd, request.target));
  for (const workspace of workspaces) {
    if (await workspaceDenies(workspace, host.hostId, request.sessionId, targets)) return DENY;
  }
  return allow();
}

/**
 * 纯函数入口：从不触碰 `process.*`、从不抛出、从不写文件。预期之外的内部故障报 `internal` 并放行。
 */
export async function runWakeflowWriteGuard(input: WriteGuardInput): Promise<WriteGuardOutcome> {
  try {
    return await decide(input);
  } catch {
    return allow("internal");
  }
}

/** 宿主认的拒绝决定：一行 JSON。键序固定，字节只由常量决定。 */
export function renderWriteGuardDenial(): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: WAKEFLOW_WRITE_GUARD_EVENT,
      permissionDecision: "deny",
      permissionDecisionReason: WAKEFLOW_WRITE_GUARD_DENIAL_REASON,
    },
  });
}

/**
 * 进程侧：只在拒绝时向 stdout 写一行决定，只在 code 非 null 时向 stderr 打一行固定代码；退出码由调用它的
 * 进程入口（观察器的 `main`）钉在 0。写流失败不改变结果——写不出拒绝即放行。
 */
export async function runWakeflowWriteGuardProcess(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  stdin: Uint8Array,
): Promise<void> {
  const outcome = await runWakeflowWriteGuard({ argv, env, stdin });
  try {
    if (outcome.code !== null) process.stderr.write(`wakeflow-write-guard: ${outcome.code}\n`);
    if (outcome.decision === "deny") process.stdout.write(`${renderWriteGuardDenial()}\n`);
  } catch {
    // 流不可用：没有写出拒绝，宿主按放行处理。
  }
}
