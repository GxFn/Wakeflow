import pLimit from "p-limit";

import type { WakeflowHostId } from "../contracts/vocabulary/wakeflow-host-id.js";
import { parseSha256Digest, type Sha256Digest } from "../foundation/crypto/sha256.js";
import { parseByteCount } from "../foundation/numeric/byte-count.js";
import {
  parseDeterministicJsonDocument,
  renderDeterministicJsonDocument,
} from "../foundation/data/deterministic-json-document.js";
import { parseJsonValue, type JsonObject, type JsonValue } from "../foundation/data/json-value.js";
import { readDeterministicJsonFile } from "../foundation/filesystem/deterministic-json-file.js";
import {
  createFileAtomically,
  DurableAtomicFileWriteError,
} from "../foundation/filesystem/durable-atomic-file-write.js";
import {
  DurableDirectoryMaterializationError,
  materializeDirectoryPath,
} from "../foundation/filesystem/durable-directory-materialization.js";
import { unlinkRegularFileExactly } from "../foundation/filesystem/exact-regular-file-unlink.js";
import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../foundation/filesystem/portable-resource-path.js";
import {
  RootedDirectoryError,
  type RootedDirectory,
} from "../foundation/filesystem/rooted-directory.js";
import {
  readStableResourceDirectory,
  StableDirectoryReadError,
  type StableDirectoryEntry,
} from "../foundation/filesystem/stable-directory-read.js";
import { readStableFile, StableFileReadError } from "../foundation/filesystem/stable-file-read.js";
import { deriveUuidV4 } from "../foundation/identity/uuid-v4.js";
import { encodeUtf8 } from "../foundation/text/utf8.js";
import { parseUtcInstant, type UtcInstant } from "../foundation/time/utc-instant.js";
import { fail } from "./error.js";
import { hostHookObservationsRootRef, parseWakeflowHostId } from "./layout.js";

/**
 * Wakeflow Kernel / Hook Observations：宿主 hook 交回的观察记录（ADR-0009 调整一）。
 *
 * 宿主进程在会话开始、提示提交、一轮结束、会话结束时调用 Wakeflow 自带的脚本，
 * 脚本把事实写成一条记录：会话或线程标识、cwd、时间、可选的 turn 标识与摘要。
 * 记录只存摘要，从不存提示或助手消息正文。登记、投递与关闭的准入按这些记录
 * 核对"宿主说的"与"Agent 说的"是否一致。记录是私有权威：目录 0700、文件 0600，
 * 不进入任何公共结果。
 *
 * 保留策略（gate-log §13.97 D7）：`recordedAt` 恰好毫秒精度，文件名才能按时间预筛；写入器在
 * 新落地一条记录后只按龄修剪同一宿主目录里早于 `HOST_HOOK_RETENTION_MILLISECONDS` 的记录文件——
 * 这是 Wakeflow 第一条自动 unlink 路径，只动符合记录命名的普通文件。截止基准不直接取调用方交来的
 * `recordedAt`，而取它与"目录里除本条之外最新的记录命名条目"的较小者：宿主时钟跳到未来时，一次
 * 未来时间的写入只能修剪到与不跳变时相同的那批记录，D7b 的 30 天损失边界不会被一次写入越过；
 * 目录里没有别的记录命名条目时不修剪。幂等重写（`current`）没有新证据落地，跳过修剪，同步 hook
 * 不为重复触发付一次目录列举。修剪失败吞掉（记录已写成），中止不吞：内核各模块一律把中止上抛为
 * `io-failure`/`aborted`，D7b 的"修剪失败吞掉"刻意不覆盖它——`writeHostHookObservation` 以
 * `aborted` 拒绝时记录可能已经 durable，调用方不能据此断定没写成。读取器把"列举后读取时已不存在"
 * 当作消失而不是 `skipped`：异步 hook 的修剪与 status 的读取并发时没有伪失败。所有消费者都只在
 * 有界窗口内读记录，被修剪的记录不再被引用。
 */

export const HOST_HOOK_EVENTS = Object.freeze([
  "session-start",
  "user-prompt-submit",
  "stop",
  "session-end",
  "turn-complete",
] as const);

export type HostHookEvent = (typeof HOST_HOOK_EVENTS)[number];

export interface HostHookObservation {
  readonly kind: "WakeflowHostHookObservation";
  readonly schemaVersion: 1;
  readonly recordId: string;
  readonly hostId: WakeflowHostId;
  readonly event: HostHookEvent;
  /** Claude 的 session_id 或 Codex 的线程标识；就是绑定句柄的值。 */
  readonly sessionId: string;
  /** 宿主报告的会话工作目录，绝对路径；只在私有记录里出现。 */
  readonly cwd: string;
  readonly recordedAt: UtcInstant;
  readonly turnId: string | null;
  readonly promptDigest: Sha256Digest | null;
  readonly lastAssistantMessageDigest: Sha256Digest | null;
  readonly transcriptRef: string | null;
}

export interface HostHookObservationInput {
  readonly hostId: WakeflowHostId;
  readonly event: HostHookEvent;
  readonly sessionId: string;
  readonly cwd: string;
  readonly recordedAt: UtcInstant;
  readonly turnId?: string | null;
  readonly promptDigest?: Sha256Digest | null;
  readonly lastAssistantMessageDigest?: Sha256Digest | null;
  readonly transcriptRef?: string | null;
}

export interface HostHookObservationFilter {
  readonly event?: HostHookEvent;
  readonly sessionId?: string;
  /** 只取不早于此刻的记录。 */
  readonly since?: UtcInstant;
  /** 最多返回的记录数，缺省 256，上限 16,384（目录列举上限）。 */
  readonly limit?: number;
}

export interface HostHookObservationInventory {
  readonly records: readonly Readonly<HostHookObservation>[];
  /**
   * 目录里存在但无法作为记录读入的条目数：文件名不合法，或内容不可用、与文件名不符。
   * 被 `event` / `since` / `sessionId` 过滤掉的记录不计入；列举后、读取前已被修剪掉的记录
   * 也不计入（它已不在目录里）。调用方据此判断证据通道是否可信。
   */
  readonly skipped: number;
}

const RECORD_KIND = "WakeflowHostHookObservation";
const IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{1,256}$/u;
const CWD_MAXIMUM_LENGTH = 4096;

function hasControlCharacter(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}
const FILE_NAME_PATTERN =
  /^(\d{8}T\d{9}Z)-(session-start|user-prompt-submit|stop|session-end|turn-complete)-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/u;
const RECORD_MAXIMUM_BYTES = parseByteCount(64 * 1024, "$observation.maximumBytes");
/**
 * 读取路径的目录列举上限，同时是 `limit` 的上限：每回合两条记录，30 天内活跃的工作区会越过
 * 4,096（§13.97 D7c）。端点与观察域按上限读取时引用这个常量，不各自重写字面量。
 */
export const HOST_HOOK_DIRECTORY_MAXIMUM_ENTRIES = 16384;
/** 修剪路径的列举上限高于读取路径：目录越过读取上限后仍能靠修剪恢复（§13.97 D7b）。 */
const PRUNE_MAXIMUM_ENTRIES = 65536;
/** 修剪 unlink 的并发上限：与稳定目录读取的 lstat 并发同量级，越界目录一次要 unlink 上万个文件。 */
const PRUNE_UNLINK_CONCURRENCY = 8;
/** 记录只按龄保留：早于此值的记录文件在下一次成功写入后被 unlink（§13.97 D7b）。 */
export const HOST_HOOK_RETENTION_MILLISECONDS = 30 * 24 * 60 * 60 * 1000;
/** ISO 毫秒形 `YYYY-MM-DDTHH:MM:SS.mmmZ` 的长度：文件名模式要求 9 位数字，其他精度永远读不出。 */
const MILLISECOND_INSTANT_LENGTH = 24;
const DEFAULT_LIMIT = 256;
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const RECORD_KEYS = Object.freeze([
  "kind",
  "schemaVersion",
  "recordId",
  "hostId",
  "event",
  "sessionId",
  "cwd",
  "recordedAt",
  "turnId",
  "promptDigest",
  "lastAssistantMessageDigest",
  "transcriptRef",
]);

function isHostHookEvent(value: unknown): value is HostHookEvent {
  return typeof value === "string" && (HOST_HOOK_EVENTS as readonly string[]).includes(value);
}

function identifier(value: unknown, path: string): string {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    fail("invalid-request", "hook-identifier", path);
  }
  return value;
}

function optionalIdentifier(value: unknown, path: string): string | null {
  return value === null || value === undefined ? null : identifier(value, path);
}

function optionalDigest(value: unknown, path: string): Sha256Digest | null {
  return value === null || value === undefined ? null : parseSha256Digest(value, path);
}

function cwd(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > CWD_MAXIMUM_LENGTH ||
    !value.startsWith("/") ||
    hasControlCharacter(value)
  ) {
    fail("invalid-request", "hook-cwd", path);
  }
  return value;
}

function optionalText(value: unknown, path: string): string | null {
  if (value === null || value === undefined) return null;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > CWD_MAXIMUM_LENGTH ||
    hasControlCharacter(value)
  ) {
    fail("invalid-request", "hook-text", path);
  }
  return value;
}

function compactInstant(recordedAt: UtcInstant): string {
  return recordedAt.replace(/[-:.]/gu, "");
}

/** 记录时间必须恰好 3 位小数秒：文件名的 9 位数字由此而来（§13.97 D7a）。 */
function millisecondInstant(value: unknown, path: string): UtcInstant {
  const instant = parseUtcInstant(value, path);
  if (instant.length !== MILLISECOND_INSTANT_LENGTH || instant[19] !== ".") {
    fail("invalid-request", "hook-instant-precision", path);
  }
  return instant;
}

/** 由宿主、事件、会话、时间与 turn 派生记录标识：hook 重复触发不会造出第二条记录。 */
function deriveHostHookObservationId(
  input: Pick<HostHookObservation, "hostId" | "event" | "sessionId" | "recordedAt" | "turnId">,
): string {
  return deriveUuidV4(
    "wakeflow-host-hook-observation",
    input.hostId,
    input.event,
    input.sessionId,
    input.recordedAt,
    input.turnId ?? "",
  );
}

/** 用宿主交回的事实创建一条记录；不合法的输入以 `invalid-request` 拒绝。 */
export function createHostHookObservation(
  input: Readonly<HostHookObservationInput>,
): Readonly<HostHookObservation> {
  if (typeof input !== "object" || input === null) {
    fail("invalid-request", "hook-input", "$observation");
  }
  const hostId = parseWakeflowHostId(input.hostId, "$observation.hostId");
  if (!isHostHookEvent(input.event)) fail("invalid-request", "hook-event", "$observation.event");
  const partial = {
    hostId,
    event: input.event,
    sessionId: identifier(input.sessionId, "$observation.sessionId"),
    cwd: cwd(input.cwd, "$observation.cwd"),
    recordedAt: millisecondInstant(input.recordedAt, "$observation.recordedAt"),
    turnId: optionalIdentifier(input.turnId, "$observation.turnId"),
    promptDigest: optionalDigest(input.promptDigest, "$observation.promptDigest"),
    lastAssistantMessageDigest: optionalDigest(
      input.lastAssistantMessageDigest,
      "$observation.lastAssistantMessageDigest",
    ),
    transcriptRef: optionalText(input.transcriptRef, "$observation.transcriptRef"),
  };
  return Object.freeze({
    kind: RECORD_KIND,
    schemaVersion: 1,
    recordId: deriveHostHookObservationId(partial),
    ...partial,
  });
}

/** 严格解析一条持久化记录；键集、摘要与标识必须自洽。 */
function parseHostHookObservation(value: JsonValue): Readonly<HostHookObservation> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("invalid-request", "hook-record", "$record");
  }
  const object = value as JsonObject;
  const keys = Object.keys(object).sort();
  if (keys.length !== RECORD_KEYS.length || keys.some((key) => !RECORD_KEYS.includes(key))) {
    fail("invalid-request", "hook-record", "$record");
  }
  if (object.kind !== RECORD_KIND || object.schemaVersion !== 1) {
    fail("invalid-request", "hook-record", "$record");
  }
  const record = createHostHookObservation({
    hostId: object.hostId as WakeflowHostId,
    event: object.event as HostHookEvent,
    sessionId: object.sessionId as string,
    cwd: object.cwd as string,
    recordedAt: object.recordedAt as UtcInstant,
    turnId: object.turnId as string | null,
    promptDigest: object.promptDigest as Sha256Digest | null,
    lastAssistantMessageDigest: object.lastAssistantMessageDigest as Sha256Digest | null,
    transcriptRef: object.transcriptRef as string | null,
  });
  if (record.recordId !== object.recordId) {
    fail("invalid-request", "hook-record-id", "$record.recordId");
  }
  return record;
}

function renderHostHookObservation(record: Readonly<HostHookObservation>): string {
  return renderDeterministicJsonDocument(parseJsonValue(record, "$record"), "$record");
}

/** 记录文件名：`<时间紧凑形>-<事件>-<recordId>.json`，按名字即可按时间与事件预筛。 */
function hostHookObservationFileName(record: Readonly<HostHookObservation>): string {
  return `${compactInstant(record.recordedAt)}-${record.event}-${record.recordId}.json`;
}

function hostHookObservationRef(record: Readonly<HostHookObservation>): PortableResourcePath {
  return parsePortableResourcePath(
    `${hostHookObservationsRootRef(record.hostId)}/${hostHookObservationFileName(record)}`,
    "$record",
  );
}

export interface WriteHostHookObservationReceipt {
  readonly record: Readonly<HostHookObservation>;
  readonly resourceRef: PortableResourcePath;
  readonly disposition: "created" | "current";
}

function isAbortFailure(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { readonly reason?: unknown }).reason === "aborted"
  );
}

/** 中止一律上抛为内核错误；其他失败交给调用方按自己的语义处理。 */
function rethrowAbort(error: unknown): void {
  if (isAbortFailure(error)) fail("io-failure", "aborted", "$signal", { cause: error });
}

/** 紧凑形 `YYYYMMDDTHHMMSSmmmZ` 还原成 ISO 毫秒形；日期不自洽的合成文件名返回 `null`。 */
function expandCompactInstant(value: string): UtcInstant | null {
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}.${value.slice(15, 18)}Z`;
  const milliseconds = Date.parse(iso);
  if (!Number.isFinite(milliseconds)) return null;
  return new Date(milliseconds).toISOString() === iso ? (iso as UtcInstant) : null;
}

/** 目录里除刚写入的那条之外、最新的记录命名条目的紧凑形；一条都没有时返回 `null`。 */
function newestOtherRecordCompact(
  entries: readonly Readonly<StableDirectoryEntry>[],
  writtenName: string,
): string | null {
  let newest: string | null = null;
  for (const entry of entries) {
    if (entry.name === writtenName) continue;
    const match = FILE_NAME_PATTERN.exec(entry.name);
    if (match === null) continue;
    const compact = match[1] as string;
    if (newest === null || compact > newest) newest = compact;
  }
  return newest;
}

/**
 * 早于"截止基准 - 保留期"的记录文件名前缀：与文件名同为定宽紧凑形，可直接比较。基准取
 * `recordedAt` 与目录里除本条之外最新记录的**较小者**——钉住基准的是目录自己的历史，所以宿主
 * 时钟跳到未来时，一条未来时间的记录只能修剪到与不跳变时相同的那批，D7b 的 30 天损失边界不会被
 * 一次写入越过。基准或结果不可表示（合成文件名、越出四位年份）时返回 `null`，即不修剪。
 */
function retentionCutoffCompact(recordedAt: UtcInstant, newestOther: string): string | null {
  const basis =
    newestOther < compactInstant(recordedAt) ? expandCompactInstant(newestOther) : recordedAt;
  if (basis === null) return null;
  const iso = new Date(Date.parse(basis) - HOST_HOOK_RETENTION_MILLISECONDS).toISOString();
  if (iso.length !== MILLISECOND_INSTANT_LENGTH) return null;
  return compactInstant(parseUtcInstant(iso, "$retention"));
}

function isExpiredRecordEntry(entry: Readonly<StableDirectoryEntry>, cutoff: string): boolean {
  const match = FILE_NAME_PATTERN.exec(entry.name);
  return match !== null && entry.node.kind === "file" && (match[1] as string) < cutoff;
}

/**
 * unlink 一个过期记录文件。修剪是尽力而为且幂等的：崩溃后重现的过期文件在下一次成功写入时
 * 再被修剪，所以不给每个文件付 inode 与父目录两次 fsync——同步 hook 只有几秒预算，越界目录
 * 一次要 unlink 上万个文件。单个文件的失败只影响它自己；中止上抛。
 */
async function unlinkExpiredHostHookObservation(
  root: RootedDirectory,
  entry: Readonly<StableDirectoryEntry>,
  signal: { readonly signal?: AbortSignal },
): Promise<void> {
  try {
    await unlinkRegularFileExactly(root, entry.resourcePath, {
      expectedNode: entry.node,
      durability: "none",
      ...signal,
    });
  } catch (error: unknown) {
    rethrowAbort(error);
  }
}

/** 列举修剪范围；列举失败只让本次修剪作罢（记录已写成），中止上抛。 */
async function listPruneEntries(
  root: RootedDirectory,
  hostId: WakeflowHostId,
  signal: { readonly signal?: AbortSignal },
): Promise<readonly Readonly<StableDirectoryEntry>[] | null> {
  try {
    return (
      await readStableResourceDirectory(root, hostHookObservationsRootRef(hostId), {
        maximumEntries: PRUNE_MAXIMUM_ENTRIES,
        ...signal,
      })
    ).entries;
  } catch (error: unknown) {
    rethrowAbort(error);
    return null;
  }
}

/**
 * 按龄修剪同一宿主目录：只 unlink 符合记录命名、早于截止基准减保留期的普通文件；无法识别的条目
 * 留给 verify 的门，永远不被修剪。截止基准由目录里已有的记录钳住（见 `retentionCutoffCompact`），
 * 目录里除刚写入的这条之外没有记录命名条目时一条都不修剪。列举上限高于读取上限，目录越界后仍能
 * 恢复。每个失败只影响那一个文件；修剪整体失败被吞掉（记录已写成），中止不吞。
 */
async function pruneExpiredHostHookObservations(
  root: RootedDirectory,
  record: Readonly<HostHookObservation>,
  signal: { readonly signal?: AbortSignal },
): Promise<void> {
  const entries = await listPruneEntries(root, record.hostId, signal);
  if (entries === null) return;
  const newestOther = newestOtherRecordCompact(entries, hostHookObservationFileName(record));
  if (newestOther === null) return;
  const cutoff = retentionCutoffCompact(record.recordedAt, newestOther);
  if (cutoff === null) return;
  const limit = pLimit(PRUNE_UNLINK_CONCURRENCY);
  const settled = await Promise.allSettled(
    entries
      .filter((entry) => isExpiredRecordEntry(entry, cutoff))
      .map((entry) => limit(unlinkExpiredHostHookObservation, root, entry, signal)),
  );
  for (const result of settled) {
    if (result.status === "rejected") throw result.reason;
  }
}

async function materializeHostHookDirectory(
  root: RootedDirectory,
  hostId: WakeflowHostId,
  signal: { readonly signal?: AbortSignal },
): Promise<void> {
  try {
    await materializeDirectoryPath(root, hostHookObservationsRootRef(hostId), {
      mode: DIRECTORY_MODE,
      ...signal,
    });
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryMaterializationError) {
      fail("io-failure", `observation-directory-${error.reason}`, "$observation", {
        cause: error,
      });
    }
    throw error;
  }
}

/** 创建记录文件；同名已存在时返回 `false`，其他写失败以 `io-failure` 拒绝。 */
async function createHostHookObservationFile(
  root: RootedDirectory,
  resourceRef: PortableResourcePath,
  document: string,
  signal: { readonly signal?: AbortSignal },
): Promise<boolean> {
  try {
    await createFileAtomically(root, resourceRef, encodeUtf8(document, "$record"), {
      mode: FILE_MODE,
      ...signal,
    });
    return true;
  } catch (error: unknown) {
    if (error instanceof DurableAtomicFileWriteError && error.reason === "target-exists") {
      return false;
    }
    if (error instanceof DurableAtomicFileWriteError) {
      fail("io-failure", `observation-write-${error.reason}`, "$observation", { cause: error });
    }
    throw error;
  }
}

/**
 * 写入一条记录：同一事实重复写入返回 `current`，同名不同内容拒绝。只有新落地一条记录（`created`）
 * 才按龄修剪同一宿主目录（§13.97 D7b）——`current` 没有新证据落地，修剪不会有新结果，而 hook 事件
 * 在 D5 下是同步的，不该为一次重复触发再列举一遍整个目录。
 */
export async function writeHostHookObservation(
  root: RootedDirectory,
  input: Readonly<HostHookObservationInput>,
  options: { readonly signal?: AbortSignal } = {},
): Promise<Readonly<WriteHostHookObservationReceipt>> {
  const record = createHostHookObservation(input);
  const resourceRef = hostHookObservationRef(record);
  const signal = options.signal === undefined ? {} : { signal: options.signal };
  await materializeHostHookDirectory(root, record.hostId, signal);
  const document = renderHostHookObservation(record);
  let disposition: "created" | "current" = "created";
  if (!(await createHostHookObservationFile(root, resourceRef, document, signal))) {
    const existing = await readDeterministicJsonFile(root, resourceRef, {
      maximumBytes: RECORD_MAXIMUM_BYTES,
      ...signal,
    });
    if (existing.text !== document) {
      fail("precondition-failed", "observation-conflict", "$observation");
    }
    disposition = "current";
  }
  if (disposition === "created") await pruneExpiredHostHookObservations(root, record, signal);
  return Object.freeze({ record, resourceRef, disposition });
}

function namePrefilter(
  name: string,
  filter: Readonly<HostHookObservationFilter>,
): Readonly<{ readonly event: HostHookEvent; readonly compact: string }> | null {
  const match = FILE_NAME_PATTERN.exec(name);
  if (match === null) return null;
  const event = match[2] as HostHookEvent;
  const compact = match[1] as string;
  if (filter.event !== undefined && event !== filter.event) return null;
  if (filter.since !== undefined && compact < compactInstant(filter.since)) return null;
  return Object.freeze({ event, compact });
}

interface ObservationCandidate {
  readonly entry: Readonly<StableDirectoryEntry>;
  readonly event: HostHookEvent;
}

async function listObservationCandidates(
  root: RootedDirectory,
  hostId: WakeflowHostId,
  filter: Readonly<HostHookObservationFilter>,
  signal: { readonly signal?: AbortSignal },
): Promise<Readonly<{
  readonly candidates: readonly ObservationCandidate[];
  /** 文件名不符合记录命名的条目数；调用方的过滤条件不影响它。 */
  readonly unrecognized: number;
}> | null> {
  let listing: Awaited<ReturnType<typeof readStableResourceDirectory>>;
  try {
    listing = await readStableResourceDirectory(root, hostHookObservationsRootRef(hostId), {
      maximumEntries: HOST_HOOK_DIRECTORY_MAXIMUM_ENTRIES,
      ...signal,
    });
  } catch (error: unknown) {
    if (error instanceof StableDirectoryReadError && error.reason === "not-found") return null;
    if (error instanceof StableDirectoryReadError) {
      fail("io-failure", `observation-listing-${error.reason}`, "$observations", { cause: error });
    }
    throw error;
  }
  const candidates: ObservationCandidate[] = [];
  let unrecognized = 0;
  for (const entry of listing.entries) {
    if (FILE_NAME_PATTERN.exec(entry.name) === null) {
      unrecognized += 1;
      continue;
    }
    const prefilter = namePrefilter(entry.name, filter);
    if (prefilter !== null) candidates.push({ entry, event: prefilter.event });
  }
  candidates.sort((left, right) => left.entry.name.localeCompare(right.entry.name));
  return Object.freeze({ candidates, unrecognized });
}

/** 列举后读取前已不存在的候选：不是证据通道的损坏，不计入 `skipped`（§13.97 D7c）。 */
const VANISHED = Symbol("vanished");

/**
 * 判定候选读取失败是否因为文件已经消失：`not-found` 直接成立；`expectation-changed` 再看一眼
 * 路径，节点已不在也成立（列举到读取之间被修剪）。中止一律上抛。
 */
async function candidateVanished(
  root: RootedDirectory,
  candidate: ObservationCandidate,
  error: unknown,
): Promise<boolean> {
  rethrowAbort(error);
  if (!(error instanceof StableFileReadError)) return false;
  if (error.reason === "not-found") return true;
  if (error.reason !== "expectation-changed") return false;
  try {
    await root.inspectExistingResource(candidate.entry.resourcePath, "$candidate");
    return false;
  } catch (inspection: unknown) {
    if (inspection instanceof RootedDirectoryError && inspection.reason === "resource-not-found") {
      return true;
    }
    return false;
  }
}

/**
 * 读取一个候选文件；内容不可用、宿主不符或文件名与记录不一致都返回 `null`，列举后已消失返回
 * `VANISHED`。
 */
async function readCandidateRecord(
  root: RootedDirectory,
  hostId: WakeflowHostId,
  candidate: ObservationCandidate,
  signal: { readonly signal?: AbortSignal },
): Promise<Readonly<HostHookObservation> | typeof VANISHED | null> {
  let record: Readonly<HostHookObservation>;
  try {
    const read = await readDeterministicJsonFile(root, candidate.entry.resourcePath, {
      maximumBytes: RECORD_MAXIMUM_BYTES,
      expectedNode: candidate.entry.node,
      ...signal,
    });
    record = parseHostHookObservation(parseDeterministicJsonDocument(read.text, "$record"));
  } catch (error: unknown) {
    return (await candidateVanished(root, candidate, error)) ? VANISHED : null;
  }
  if (record.hostId !== hostId || hostHookObservationRef(record) !== candidate.entry.resourcePath) {
    return null;
  }
  return record;
}

export interface ReadHostHookObservationsOptions {
  readonly signal?: AbortSignal;
}

/** 读取上限缺省 256，上限等于目录列举上限（§13.97 D7c）。 */
function readLimit(filter: Readonly<HostHookObservationFilter>): number {
  const limit = filter.limit ?? DEFAULT_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > HOST_HOOK_DIRECTORY_MAXIMUM_ENTRIES) {
    fail("invalid-request", "hook-limit", "$filter.limit");
  }
  return limit;
}

/** 逐条读取候选：读不出计入 `skipped`，消失跳过，会话过滤在记录内容上进行。 */
async function readListedCandidates(
  root: RootedDirectory,
  hostId: WakeflowHostId,
  candidates: readonly ObservationCandidate[],
  filter: Readonly<HostHookObservationFilter>,
  signal: { readonly signal?: AbortSignal },
): Promise<
  Readonly<{ readonly records: readonly Readonly<HostHookObservation>[]; readonly skipped: number }>
> {
  const limit = readLimit(filter);
  const records: Readonly<HostHookObservation>[] = [];
  let skipped = 0;
  for (const candidate of candidates) {
    if (records.length >= limit) break;
    const record = await readCandidateRecord(root, hostId, candidate, signal);
    if (record === VANISHED) continue;
    if (record === null) {
      skipped += 1;
    } else if (filter.sessionId === undefined || record.sessionId === filter.sessionId) {
      records.push(record);
    }
  }
  return Object.freeze({ records: Object.freeze(records), skipped });
}

async function readObservations(
  root: RootedDirectory,
  hostIdValue: WakeflowHostId,
  filter: Readonly<HostHookObservationFilter>,
  options: Readonly<ReadHostHookObservationsOptions>,
  onListed: (() => Promise<void>) | null,
): Promise<Readonly<HostHookObservationInventory>> {
  const hostId = parseWakeflowHostId(hostIdValue);
  readLimit(filter);
  const signal = options.signal === undefined ? {} : { signal: options.signal };
  const listed = await listObservationCandidates(root, hostId, filter, signal);
  if (listed === null) return Object.freeze({ records: Object.freeze([]), skipped: 0 });
  if (onListed !== null) await onListed();
  const read = await readListedCandidates(root, hostId, listed.candidates, filter, signal);
  return Object.freeze({ records: read.records, skipped: listed.unrecognized + read.skipped });
}

/** 有界读取一个宿主的记录；无法读入的条目只计数，不让证据通道整体失败。 */
export async function readHostHookObservations(
  root: RootedDirectory,
  hostIdValue: WakeflowHostId,
  filter: Readonly<HostHookObservationFilter> = {},
  options: Readonly<ReadHostHookObservationsOptions> = {},
): Promise<Readonly<HostHookObservationInventory>> {
  return readObservations(root, hostIdValue, filter, options, null);
}

/**
 * 与 `readHostHookObservations` 走同一条读取路径，只是在列举完成、逐条读取之前调用一次
 * `onListed`：内核测试用它确定性地复现"列举后被修剪"的并发（§13.97 D7c）。观察点留在这个单独
 * 命名的导出里，`readHostHookObservations` 的选项因此保持 §13.97 定下的形状，生产调用方既传不进
 * 回调，也不会顺手把带回调的选项对象透传下去。
 */
export async function readHostHookObservationsInterleaved(
  root: RootedDirectory,
  hostIdValue: WakeflowHostId,
  filter: Readonly<HostHookObservationFilter>,
  onListed: () => Promise<void>,
  options: Readonly<ReadHostHookObservationsOptions> = {},
): Promise<Readonly<HostHookObservationInventory>> {
  return readObservations(root, hostIdValue, filter, options, onListed);
}

export interface HostHookObservationRecordRead {
  readonly record: Readonly<HostHookObservation>;
  /** 记录文件字节的摘要：受管证据以它引用记录，不复制记录本身。 */
  readonly digest: Sha256Digest;
  readonly byteCount: number;
}

/** 按记录标识读取一个宿主的一条记录；目录或记录不存在、内容不可用都返回 `null`。 */
export async function readHostHookObservationRecord(
  root: RootedDirectory,
  hostIdValue: WakeflowHostId,
  recordId: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<Readonly<HostHookObservationRecordRead> | null> {
  const hostId = parseWakeflowHostId(hostIdValue);
  const signal = options.signal === undefined ? {} : { signal: options.signal };
  const listed = await listObservationCandidates(root, hostId, {}, signal);
  if (listed === null) return null;
  const candidate = listed.candidates.find((entry) => {
    const match = FILE_NAME_PATTERN.exec(entry.entry.name);
    return match !== null && match[3] === recordId;
  });
  if (candidate === undefined) return null;
  const record = await readCandidateRecord(root, hostId, candidate, signal);
  if (record === VANISHED || record === null || record.recordId !== recordId) return null;
  try {
    const read = await readStableFile(root, candidate.entry.resourcePath, {
      maximumBytes: RECORD_MAXIMUM_BYTES,
      expectedNode: candidate.entry.node,
      ...signal,
    });
    return Object.freeze({ record, digest: read.digest, byteCount: Number(read.byteCount) });
  } catch (error: unknown) {
    if (error instanceof StableFileReadError) {
      rethrowAbort(error);
      return null;
    }
    throw error;
  }
}
