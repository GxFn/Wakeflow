import { type Dirent, constants as fileSystemConstants } from "node:fs";
import {
  type FileHandle,
  lstat,
  opendir,
  open as openFileHandle,
  readFile,
  realpath,
} from "node:fs/promises";
import nodePath from "node:path";

import { computeSha256Digest, type Sha256Digest } from "../foundation/crypto/sha256.js";
import { RootedDirectory } from "../foundation/filesystem/rooted-directory.js";
import { decodeUtf8, encodeUtf8 } from "../foundation/text/utf8.js";
import { parseUtcInstant } from "../foundation/time/utc-instant.js";
import {
  createHostHookObservation,
  type HostHookEvent,
  type HostHookObservationInput,
  writeHostHookObservation,
} from "../kernel/hook-observations.js";
import {
  hostRuntimeRootRef,
  parseWakeflowHostId,
  WAKEFLOW_CONFIG_KIND,
  WAKEFLOW_CONFIG_SCHEMA_VERSION,
} from "../kernel/layout.js";
import { computePromptDigest } from "../kernel/prompt-digest.js";

/**
 * Wakeflow Entrypoint / Hook Observer：两宿主生命周期 hook 的观察脚本（gate-log §13.97 D1–D4）。
 *
 * 宿主在 `SessionStart`、`UserPromptSubmit`、`Stop`、`SessionEnd` 时按插件级 hook 配置启动本入口：
 * stdin 是宿主的 hook JSON，argv 只带固定标记与 `--host <codex | claude-code>`，`--host` 只供给写进
 * 记录的 `hostId`，字段映射在两宿主间完全同形。工作区按声明拓扑定位（D2）：锚点是会话 cwd
 * （cwd 已删除时用 `CLAUDE_PROJECT_DIR`）与 worktree 指针指向的主仓库；候选根是锚点及其至多 8 级
 * 祖先里含 `wakeflow.config.json` 的目录，加上祖先的直接子目录里含它的目录；每个候选只结构化读取
 * `topology.repositories[].path` 与 `topology.supportSurfaces[].path`，realpath(cwd) 等于或位于根、
 * 支持面、仓库之下，或位于主仓库为声明仓库的检出之下即匹配。`session-start` 写进每个匹配的工作区，
 * 其余事件只写进绑定目录已持有该 `session_id` 句柄的工作区。记录只经内核 `writeHostHookObservation`
 * 写入（D3）：只有 `session_id`、`cwd`、`hook_event_name` 是必填，不合内核合同即 `stdin-invalid`；
 * 可选字段（turn 标识、transcript 路径、消息正文）不合合同时只把该字段降级为 null，会话事实照写。
 * 进程永远退出 0、stdout 为空、stderr 只在异常时打一行固定代码，不含路径、句柄与提示正文（D4）；
 * 进程级守卫经 `registerProcessGuards` 只登记一次，一次故障恰好一行。闭包限于 foundation 与
 * kernel：不加载配置校验器，非 Wakeflow 会话必须静默且便宜。
 *
 * 记录的语义边界：被打断或 API 失败的回合没有 `stop` 记录，消费者把缺席当 pending；Codex 的
 * `session-end` 最迟滞后 30 分钟，不是活性信号；同一处理器被注册两次会得到两条时间不同的记录，
 * 消费者取首条匹配。
 */

export const WAKEFLOW_HOOK_OBSERVER_MARKER = "--wakeflow-hook-observer-v1";
export const WAKEFLOW_HOOK_OBSERVER_HOST_ARGUMENT = "--host";
export const WAKEFLOW_HOOK_OBSERVER_STDIN_MAXIMUM_BYTES = 4 * 1024 * 1024;

/** 纯函数入口的闭集：`internal` 是预期之外的内部故障，与写入失败区分开（D4）。 */
export type HookObserverCode =
  | "argv-invalid"
  | "host-unknown"
  | "stdin-too-large"
  | "stdin-invalid"
  | "event-unknown"
  | "write-failed"
  | "internal";

/**
 * stderr 上的完整代码词汇表（D4、D10）：纯函数入口的闭集，加上只有制品 launcher 会打的
 * `launcher`（动态 import 失败或入口缺 `main`）。进程级守卫（未捕获异常、未处理拒绝）打的是
 * 闭集里的 `internal`，与纯函数入口的内部故障同一个代码——用户与验证门看到的是这一个词汇表。
 */
export type HookObserverStderrCode = HookObserverCode | "launcher";

export interface HookObserverInput {
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdin: Uint8Array | string;
  readonly clock?: () => Date;
  /** 观察脚本所属制品的 manifest 摘要；launcher 在进程入口算一次，测试可注入（§13.127）。 */
  readonly artifactManifestDigest?: Sha256Digest | null;
}

export interface HookObserverWrittenRecord {
  readonly workspaceRoot: string;
  readonly recordId: string;
  readonly disposition: "created" | "current";
}

export interface HookObserverOutcome {
  readonly code: HookObserverCode | null;
  readonly written: readonly Readonly<HookObserverWrittenRecord>[];
}

type HostId = HostHookObservationInput["hostId"];
type Parsed<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; code: HookObserverCode }>;

interface HookPayload {
  readonly sessionId: string;
  readonly cwd: string;
  /** 宿主事件名映射到内核事件；未知事件为 null。 */
  readonly event: HostHookEvent | null;
  readonly transcriptPath: string | null;
  readonly prompt: string | null;
  readonly lastAssistantMessage: string | null;
  readonly turnId: string | null;
}

interface Subject {
  /** cwd 的 realpath；cwd 已消失时是 `CLAUDE_PROJECT_DIR` 的 realpath。 */
  readonly path: string;
  /** 主体位于 worktree 检出之下时，`gitdir` 指针指向的主仓库 realpath。 */
  readonly worktreeMain: string | null;
}

interface WorkspaceDeclaration {
  readonly root: string;
  readonly repositories: readonly string[];
  readonly supportSurfaces: readonly string[];
}

const HOST_EVENTS: ReadonlyMap<string, HostHookEvent> = new Map<string, HostHookEvent>([
  ["SessionStart", "session-start"],
  ["UserPromptSubmit", "user-prompt-submit"],
  ["Stop", "stop"],
  ["SessionEnd", "session-end"],
]);
const WAKEFLOW_CONFIG_FILE_NAME = "wakeflow.config.json";
const GIT_ENTRY_NAME = ".git";
const GITDIR_POINTER_PREFIX = "gitdir: ";
const CONFIG_MAXIMUM_BYTES = 1024 * 1024;
const BINDING_MAXIMUM_BYTES = 64 * 1024;
const GITDIR_POINTER_MAXIMUM_BYTES = 4096;
const ANCESTOR_LEVELS = 8;
const GIT_WALK_MAXIMUM_LEVELS = 64;
/**
 * 列举的上限约束的是列举之后要做的事：每个候选子目录一次 stat、每条绑定一次有界读取。上限只
 * 截断收集，不作废已经收集到的名字——一个大目录里的工作区必须仍然可见（D2 b 的"每目录至多列
 * 1,024 项"取的是这份有界代价，不是"超限即全部丢弃"）。`LISTING_MAXIMUM_ENTRIES` 再给条目流
 * 本身一个硬顶，让病态目录（十万个文件、没有子目录）也不能把单次 hook 拖出 D4 的时间预算。
 */
const CHILD_LISTING_MAXIMUM_NAMES = 1024;
const BINDINGS_LISTING_MAXIMUM_NAMES = 4096;
const LISTING_MAXIMUM_ENTRIES = 65_536;
const BINDINGS_DIRECTORY_SEGMENTS: readonly string[] = ["identity", "window-bindings"];
const READ_FLAGS = fileSystemConstants.O_RDONLY | fileSystemConstants.O_NOFOLLOW;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function failure(code: HookObserverCode): Parsed<never> {
  return Object.freeze({ ok: false as const, code });
}

function success<T>(value: T): Parsed<T> {
  return Object.freeze({ ok: true as const, value });
}

// ---- argv 与 stdin ------------------------------------------------------------

/** argv 固定为 `<标记> --host <宿主>`；缺标记或形状不对是 argv-invalid，宿主不识别是 host-unknown。 */
function parseHost(argv: unknown): Parsed<HostId> {
  if (!Array.isArray(argv) || argv.length !== 3) return failure("argv-invalid");
  const [marker, argument, host] = argv as readonly unknown[];
  if (
    marker !== WAKEFLOW_HOOK_OBSERVER_MARKER ||
    argument !== WAKEFLOW_HOOK_OBSERVER_HOST_ARGUMENT
  ) {
    return failure("argv-invalid");
  }
  try {
    return success(parseWakeflowHostId(host, "$argv.host"));
  } catch {
    return failure("host-unknown");
  }
}

function stdinBytes(stdin: unknown): Uint8Array | null {
  if (stdin instanceof Uint8Array) return stdin;
  if (typeof stdin !== "string") return null;
  try {
    return encodeUtf8(stdin, "$stdin");
  } catch {
    return null;
  }
}

function parseJsonObject(bytes: Uint8Array): Readonly<Record<string, unknown>> | null {
  try {
    const value: unknown = JSON.parse(decodeUtf8(bytes, "$stdin"));
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

/** stdin 是一个宿主 hook JSON 对象；超限先于解析判定，缺公共字段即 stdin-invalid。 */
function parsePayload(stdin: unknown): Parsed<HookPayload> {
  const bytes = stdinBytes(stdin);
  if (bytes === null) return failure("stdin-invalid");
  if (bytes.byteLength > WAKEFLOW_HOOK_OBSERVER_STDIN_MAXIMUM_BYTES) {
    return failure("stdin-too-large");
  }
  const object = parseJsonObject(bytes);
  if (object === null) return failure("stdin-invalid");
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
    return failure("stdin-invalid");
  }
  return success(
    Object.freeze({
      sessionId,
      cwd,
      event: HOST_EVENTS.get(eventName) ?? null,
      transcriptPath: optionalString(object.transcript_path),
      prompt: optionalString(object.prompt),
      lastAssistantMessage: optionalString(object.last_assistant_message),
      turnId: optionalString(object.turn_id) ?? optionalString(object.prompt_id),
    }),
  );
}

// ---- 记录映射（D3）--------------------------------------------------------------

function textDigest(text: string | null): Sha256Digest | null {
  if (text === null) return null;
  try {
    return computeSha256Digest(encodeUtf8(text, "$text"), "$text");
  } catch {
    return null;
  }
}

/**
 * Claude Code 把粘贴进来的 prompt 包成 `<pasted_content id="…">…</pasted_content id="…">`（闭合标签
 * 重复属性）、把跨会话消息包成
 * `<cross-session-message …>…</cross-session-message>` 再交给 hook（2026-09-24 真实宿主实测，
 * gate-log §13.119）。落地判定比的是信封 prompt 的摘要，所以先剥掉宿主的传输外壳再算；外壳只是
 * 宿主怎么送进来的痕迹，不是用户或 Controller 写的字。Codex 没有这种外壳，原样计算。
 */
const CLAUDE_CODE_PROMPT_WRAPPERS: readonly RegExp[] = [
  /^<pasted_content\b[^>\n]*>\n?([\s\S]*?)\n?<\/pasted_content\b[^>\n]*>$/u,
  /^<cross-session-message\b[^>\n]*>\n?([\s\S]*?)\n?<\/cross-session-message\b[^>\n]*>$/u,
];

export function unwrapHostPrompt(hostId: HostId, prompt: string): string {
  if (hostId !== "claude-code") return prompt;
  let text = prompt.trim();
  for (let depth = 0; depth < 2; depth += 1) {
    const match = CLAUDE_CODE_PROMPT_WRAPPERS.map((pattern) => pattern.exec(text)).find(
      (entry) => entry !== null,
    );
    if (match === undefined || match === null) break;
    text = (match[1] ?? "").trim();
  }
  return text;
}

function promptDigest(hostId: HostId, prompt: string | null): Sha256Digest | null {
  if (prompt === null) return null;
  try {
    return computePromptDigest(unwrapHostPrompt(hostId, prompt));
  } catch {
    return null;
  }
}

/** 必填字段（宿主、事件、会话、cwd）与时间按内核合同核对：任何一个不合合同即 stdin-invalid。 */
function requiredInput(
  hostId: HostId,
  payload: HookPayload,
  event: HostHookEvent,
  clock: () => Date,
): Readonly<HostHookObservationInput> | null {
  try {
    const input: Readonly<HostHookObservationInput> = Object.freeze({
      hostId,
      event,
      sessionId: payload.sessionId,
      cwd: payload.cwd,
      recordedAt: parseUtcInstant(clock().toISOString(), "$recordedAt"),
      turnId: null,
      promptDigest: null,
      lastAssistantMessageDigest: null,
      transcriptRef: null,
    });
    createHostHookObservation(input);
    return input;
  } catch {
    return null;
  }
}

/**
 * 可选字段逐个问内核：合同文法（标识符模式、文本长度与控制字符）只住在内核，这里不复制它。
 * 内核拒绝的字段降级为 null 而不丢整条记录——宿主给出的 turn 标识或 transcript 路径不合文法时，
 * 会话事实本身仍是证据。
 */
function degradeToKernel(
  required: Readonly<HostHookObservationInput>,
  field: "turnId" | "transcriptRef",
  value: string | null,
): string | null {
  if (value === null) return null;
  try {
    createHostHookObservation(
      field === "turnId" ? { ...required, turnId: value } : { ...required, transcriptRef: value },
    );
    return value;
  } catch {
    return null;
  }
}

/** 必填字段不合合同即 null（stdin-invalid）；可选字段各自降级；写入阶段只剩 I/O 失败。 */
function recordInput(
  hostId: HostId,
  payload: HookPayload,
  event: HostHookEvent,
  clock: () => Date,
  artifactManifestDigest: Sha256Digest | null | undefined,
): Readonly<HostHookObservationInput> | null {
  const required = requiredInput(hostId, payload, event, clock);
  if (required === null) return null;
  return Object.freeze({
    ...required,
    artifactManifestDigest: artifactManifestDigest ?? null,
    turnId: degradeToKernel(required, "turnId", payload.turnId),
    promptDigest: event === "user-prompt-submit" ? promptDigest(hostId, payload.prompt) : null,
    lastAssistantMessageDigest: event === "stop" ? textDigest(payload.lastAssistantMessage) : null,
    transcriptRef: degradeToKernel(required, "transcriptRef", payload.transcriptPath),
  });
}

// ---- 有界、不跟随符号链接的文件系统读取 -----------------------------------------

type NodeKind = "directory" | "file" | "other";

async function nodeKind(target: string): Promise<NodeKind | null> {
  try {
    const stats = await lstat(target);
    if (stats.isDirectory()) return "directory";
    return stats.isFile() ? "file" : "other";
  } catch {
    return null;
  }
}

async function realpathOrNull(target: string): Promise<string | null> {
  try {
    return await realpath(target);
  } catch {
    return null;
  }
}

async function closeQuietly(handle: FileHandle | null): Promise<void> {
  if (handle === null) return;
  try {
    await handle.close();
  } catch {
    // 诊断读取已经结束；关闭失败不改变结果。
  }
}

/** 读满 `size` 字节；提前 EOF 时交回实际读到的字节数，调用方据此判定文件是否变了。 */
async function readExactly(
  handle: FileHandle,
  size: number,
): Promise<Readonly<[Uint8Array, number]>> {
  const bytes = new Uint8Array(size);
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await handle.read(bytes, offset, size - offset, null);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  return [bytes, offset];
}

/**
 * 与状态栏资产（`claude-code-statusline-asset.ts` 的 `readBoundedJson`）同一做法：O_NOFOLLOW 打开、
 * 按打开时的大小预分配并恰好读这么多字节（上限在分配之前判定，不读到 EOF）、事后 lstat 复核
 * inode 与大小。
 */
async function readBoundedBytes(file: string, maximumBytes: number): Promise<Uint8Array | null> {
  let handle: FileHandle | null = null;
  try {
    handle = await openFileHandle(file, READ_FLAGS);
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size > maximumBytes) return null;
    const [bytes, read] = await readExactly(handle, opened.size);
    const after = await lstat(file);
    if (read !== opened.size || after.ino !== opened.ino || after.size !== opened.size) {
      return null;
    }
    return bytes;
  } catch {
    return null;
  } finally {
    await closeQuietly(handle);
  }
}

async function readBoundedJson(file: string, maximumBytes: number): Promise<unknown> {
  const bytes = await readBoundedBytes(file, maximumBytes);
  if (bytes === null) return null;
  try {
    return JSON.parse(decodeUtf8(bytes, "$file")) as unknown;
  } catch {
    return null;
  }
}

/** 到上限就停止收集并交回已有的名字；目录不可读或中途失败同样只交回已经收到的部分。 */
async function listEntryNames(
  directory: string,
  maximumNames: number,
  accept: (entry: Dirent) => boolean,
): Promise<readonly string[]> {
  const names: string[] = [];
  try {
    let observed = 0;
    for await (const entry of await opendir(directory)) {
      observed += 1;
      if (accept(entry)) names.push(entry.name);
      if (names.length >= maximumNames || observed >= LISTING_MAXIMUM_ENTRIES) break;
    }
  } catch {
    // 打开失败、条目流中途出错或目录被换掉：已经收到的名字仍然是有效候选。
  }
  return names.sort();
}

// ---- 工作区定位（D2）------------------------------------------------------------

/** 只读 `gitdir: <主仓库>/.git/worktrees/<name>` 指针文件，不 spawn git；相对指针按检出目录解析。 */
async function mainRepositoryFromPointer(checkout: string): Promise<string | null> {
  const bytes = await readBoundedBytes(
    nodePath.join(checkout, GIT_ENTRY_NAME),
    GITDIR_POINTER_MAXIMUM_BYTES,
  );
  if (bytes === null) return null;
  let text: string;
  try {
    text = decodeUtf8(bytes, "$gitdir");
  } catch {
    return null;
  }
  if (!text.startsWith(GITDIR_POINTER_PREFIX)) return null;
  const target = (text.slice(GITDIR_POINTER_PREFIX.length).split("\n", 1)[0] ?? "").trim();
  if (target.length === 0) return null;
  const pointer = nodePath.resolve(checkout, target);
  const worktrees = nodePath.dirname(pointer);
  const gitDirectory = nodePath.dirname(worktrees);
  if (
    nodePath.basename(worktrees) !== "worktrees" ||
    nodePath.basename(gitDirectory) !== GIT_ENTRY_NAME
  ) {
    return null;
  }
  return realpathOrNull(nodePath.dirname(gitDirectory));
}

/** 从主体向上找最近的 `.git`：是指针文件才产生主仓库锚点，是目录或其他节点即结束。 */
async function worktreeMainRepository(start: string): Promise<string | null> {
  let directory = start;
  for (let level = 0; level < GIT_WALK_MAXIMUM_LEVELS; level += 1) {
    const kind = await nodeKind(nodePath.join(directory, GIT_ENTRY_NAME));
    if (kind === "file") return mainRepositoryFromPointer(directory);
    if (kind !== null) return null;
    const parent = nodePath.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
  return null;
}

async function resolveSubject(
  cwd: string,
  env: Readonly<Record<string, string | undefined>>,
): Promise<Subject | null> {
  const projectDirectory = env.CLAUDE_PROJECT_DIR;
  const fallback =
    typeof projectDirectory === "string" && nodePath.isAbsolute(projectDirectory)
      ? projectDirectory
      : null;
  const path =
    (await realpathOrNull(cwd)) ?? (fallback === null ? null : await realpathOrNull(fallback));
  if (path === null) return null;
  return Object.freeze({ path, worktreeMain: await worktreeMainRepository(path) });
}

async function holdsWakeflowConfig(directory: string): Promise<boolean> {
  return (await nodeKind(nodePath.join(directory, WAKEFLOW_CONFIG_FILE_NAME))) === "file";
}

async function collectCandidates(
  directory: string,
  listChildren: boolean,
  roots: Set<string>,
): Promise<void> {
  if (await holdsWakeflowConfig(directory)) roots.add(directory);
  if (!listChildren) return;
  const children = await listEntryNames(directory, CHILD_LISTING_MAXIMUM_NAMES, (entry) =>
    entry.isDirectory(),
  );
  for (const child of children) {
    const candidate = nodePath.join(directory, child);
    if (await holdsWakeflowConfig(candidate)) roots.add(candidate);
  }
}

/**
 * 候选根：每个锚点及其至多 8 级祖先里含配置的目录，加上每个祖先的直接子目录里含配置的目录。
 * 锚点自己的子目录从不列举：位于锚点之下的工作区不可能包含锚点。
 */
async function candidateRoots(subject: Subject): Promise<readonly string[]> {
  const anchors =
    subject.worktreeMain === null ? [subject.path] : [subject.path, subject.worktreeMain];
  const listed = new Set<string>();
  const checked = new Set<string>();
  const roots = new Set<string>();
  for (const anchor of anchors) {
    let directory = anchor;
    for (let level = 0; level <= ANCESTOR_LEVELS; level += 1) {
      const listChildren = level > 0 && !listed.has(directory);
      if (listChildren) listed.add(directory);
      if (listChildren || !checked.has(directory)) {
        checked.add(directory);
        await collectCandidates(directory, listChildren, roots);
      }
      const parent = nodePath.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  return [...roots].sort();
}

function declaredPaths(
  topology: Readonly<Record<string, unknown>>,
  key: "repositories" | "supportSurfaces",
): readonly string[] | null {
  const entries = topology[key];
  if (!Array.isArray(entries)) return null;
  const paths: string[] = [];
  for (const entry of entries as readonly unknown[]) {
    if (!isRecord(entry) || typeof entry.path !== "string") return null;
    paths.push(entry.path);
  }
  return paths;
}

/** 结构化读取两个 placement 数组；形状不对就跳过该候选，不加载校验器。 */
async function readWorkspaceDeclaration(root: string): Promise<WorkspaceDeclaration | null> {
  const config = await readBoundedJson(
    nodePath.join(root, WAKEFLOW_CONFIG_FILE_NAME),
    CONFIG_MAXIMUM_BYTES,
  );
  if (
    !isRecord(config) ||
    config.kind !== WAKEFLOW_CONFIG_KIND ||
    config.schemaVersion !== WAKEFLOW_CONFIG_SCHEMA_VERSION ||
    !isRecord(config.topology)
  ) {
    return null;
  }
  const repositories = declaredPaths(config.topology, "repositories");
  const supportSurfaces = declaredPaths(config.topology, "supportSurfaces");
  if (repositories === null || supportSurfaces === null) return null;
  return Object.freeze({ root, repositories, supportSurfaces });
}

function isEqualOrUnder(subject: string, target: string): boolean {
  if (subject === target) return true;
  const prefix = target.endsWith(nodePath.sep) ? target : `${target}${nodePath.sep}`;
  return subject.startsWith(prefix);
}

async function declaredPathMatches(
  root: string,
  declared: string,
  subject: Subject,
  repository: boolean,
): Promise<boolean> {
  const real = await realpathOrNull(nodePath.resolve(root, declared));
  if (real === null) return false;
  return isEqualOrUnder(subject.path, real) || (repository && real === subject.worktreeMain);
}

async function workspaceMatches(
  declaration: WorkspaceDeclaration,
  subject: Subject,
): Promise<boolean> {
  if (isEqualOrUnder(subject.path, declaration.root)) return true;
  for (const surface of declaration.supportSurfaces) {
    if (await declaredPathMatches(declaration.root, surface, subject, false)) return true;
  }
  for (const repository of declaration.repositories) {
    if (await declaredPathMatches(declaration.root, repository, subject, true)) return true;
  }
  return false;
}

async function matchingWorkspaces(subject: Subject): Promise<readonly string[]> {
  const matched: string[] = [];
  for (const candidate of await candidateRoots(subject)) {
    const root = await realpathOrNull(candidate);
    if (root === null || matched.includes(root)) continue;
    const declaration = await readWorkspaceDeclaration(root);
    if (declaration !== null && (await workspaceMatches(declaration, subject))) matched.push(root);
  }
  return matched.sort();
}

// ---- 绑定门（D2 d）------------------------------------------------------------

function bindingsDirectory(root: string, hostId: HostId): string {
  return nodePath.join(
    root,
    ...hostRuntimeRootRef(hostId).split("/"),
    ...BINDINGS_DIRECTORY_SEGMENTS,
  );
}

/** 结构化读取绑定记录的 `handle.value`：持有该 session_id 句柄的工作区才接收后三类事件。 */
async function workspaceBindsSession(
  root: string,
  hostId: HostId,
  sessionId: string,
): Promise<boolean> {
  const directory = bindingsDirectory(root, hostId);
  const names = await listEntryNames(
    directory,
    BINDINGS_LISTING_MAXIMUM_NAMES,
    (entry) => entry.isFile() && entry.name.endsWith(".json"),
  );
  for (const name of names) {
    const record = await readBoundedJson(nodePath.join(directory, name), BINDING_MAXIMUM_BYTES);
    if (isRecord(record) && isRecord(record.handle) && record.handle.value === sessionId) {
      return true;
    }
  }
  return false;
}

// ---- 写入 ---------------------------------------------------------------------

async function writeObservation(
  root: string,
  input: Readonly<HostHookObservationInput>,
): Promise<Readonly<HookObserverWrittenRecord> | null> {
  let directory: RootedDirectory | null = null;
  try {
    directory = await RootedDirectory.open(root, "$workspaceRoot");
    const receipt = await writeHostHookObservation(directory, input);
    return Object.freeze({
      workspaceRoot: root,
      recordId: receipt.record.recordId,
      disposition: receipt.disposition,
    });
  } catch {
    return null;
  } finally {
    if (directory !== null) {
      try {
        await directory.close();
      } catch {
        // 记录已写成或已失败；根句柄关闭失败不改变结果。
      }
    }
  }
}

function outcome(
  code: HookObserverCode | null,
  written: readonly Readonly<HookObserverWrittenRecord>[],
): HookObserverOutcome {
  return Object.freeze({ code, written: Object.freeze([...written]) });
}

function defaultClock(): Date {
  return new Date();
}

async function observe(
  input: HookObserverInput,
  written: Readonly<HookObserverWrittenRecord>[],
): Promise<HookObserverOutcome> {
  const host = parseHost(input.argv);
  if (!host.ok) return outcome(host.code, written);
  const payload = parsePayload(input.stdin);
  if (!payload.ok) return outcome(payload.code, written);
  if (payload.value.event === null) return outcome("event-unknown", written);
  const clock = typeof input.clock === "function" ? input.clock : defaultClock;
  const record = recordInput(
    host.value,
    payload.value,
    payload.value.event,
    clock,
    input.artifactManifestDigest,
  );
  if (record === null) return outcome("stdin-invalid", written);
  const subject = await resolveSubject(payload.value.cwd, isRecord(input.env) ? input.env : {});
  if (subject === null) return outcome(null, written);
  let failed = false;
  for (const workspace of await matchingWorkspaces(subject)) {
    if (
      record.event !== "session-start" &&
      !(await workspaceBindsSession(workspace, host.value, record.sessionId))
    ) {
      continue;
    }
    const result = await writeObservation(workspace, record);
    if (result === null) {
      failed = true;
    } else {
      written.push(result);
    }
  }
  return outcome(failed ? "write-failed" : null, written);
}

/**
 * 纯函数入口：从不触碰 `process.*`、从不抛出、从不写 stdout。一个工作区写失败只标记
 * `write-failed`，不影响其他工作区；没有匹配的工作区时 code 为 null 且不写。外层 catch 只兜
 * 预期之外的内部故障（例如调用方传进来的输入对象在取值时抛错），它发生在写之前也可能发生在
 * 写之中，所以报 `internal` 而不是冒充 `write-failed`——已经写成的记录仍在 `written` 里。
 */
export async function runWakeflowHookObserver(
  input: HookObserverInput,
): Promise<HookObserverOutcome> {
  const written: Readonly<HookObserverWrittenRecord>[] = [];
  try {
    return await observe(input, written);
  } catch {
    return outcome("internal", written);
  }
}

// ---- 进程入口（D4）--------------------------------------------------------------

/** stderr 上只出现 `HookObserverStderrCode` 里的词：类型让进程侧与导出的词汇表不会各说各话。 */
function writeStderrLine(code: HookObserverStderrCode): void {
  try {
    process.stderr.write(`wakeflow-hook-observer: ${code}\n`);
  } catch {
    // stderr 不可用时也不改变退出码。
  }
}

function internalGuard(): void {
  writeStderrLine("internal");
  process.exitCode = 0;
}

let processGuardsRegistered = false;

/**
 * 进程级守卫只有一条登记路径：未捕获异常与未处理拒绝各打一行固定代码、退出码钉在 0。模块级
 * 标志让 `main()` 与任何再次调用它的 launcher 都不会登记第二个守卫，一次进程级故障恰好一行。
 */
export function registerProcessGuards(): void {
  if (processGuardsRegistered) return;
  processGuardsRegistered = true;
  process.on("uncaughtException", internalGuard);
  process.on("unhandledRejection", internalGuard);
}

/** 读完整个 stdin；超限后继续消费但不再保留，超限本身由纯函数入口按字节数判定。 */
async function readStandardInput(): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of process.stdin as AsyncIterable<unknown>) {
    const bytes = chunk instanceof Uint8Array ? chunk : Buffer.from(String(chunk), "utf8");
    if (total <= WAKEFLOW_HOOK_OBSERVER_STDIN_MAXIMUM_BYTES) chunks.push(bytes);
    total += bytes.byteLength;
  }
  return Buffer.concat(chunks);
}

/**
 * 观察脚本所属制品的 manifest 摘要（§13.127）：制品根是 `lib/entrypoints/<本文件>` 的上两级；
 * 测试构建没有 manifest，读成 null。用 URL 相对解析而不引入 node:url，保持入口闭包不变（D1）。
 */
async function artifactManifestDigestOf(importMetaUrl: string): Promise<Sha256Digest | null> {
  try {
    const bytes = await readFile(new URL("../../artifact-manifest.json", importMetaUrl));
    return computeSha256Digest(new Uint8Array(bytes), "$artifactManifest");
  } catch {
    return null;
  }
}

/**
 * 进程入口：只在 code 非 null 时向 stderr 打恰好一行固定代码，从不写 stdout，退出码保持 0。
 * 制品 launcher 只调用它；守卫在这里登记，launcher 自己不再登记。
 */
export async function main(): Promise<void> {
  process.exitCode = 0;
  registerProcessGuards();
  try {
    const stdin = await readStandardInput();
    const result = await runWakeflowHookObserver({
      argv: process.argv.slice(2),
      env: process.env,
      stdin,
      artifactManifestDigest: await artifactManifestDigestOf(import.meta.url),
    });
    if (result.code !== null) writeStderrLine(result.code);
  } catch {
    writeStderrLine("internal");
  }
  process.exitCode = 0;
}
