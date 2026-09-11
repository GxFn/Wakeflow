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
import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../foundation/filesystem/portable-resource-path.js";
import type { RootedDirectory } from "../foundation/filesystem/rooted-directory.js";
import {
  readStableResourceDirectory,
  StableDirectoryReadError,
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
  /** 最多返回的记录数，缺省 256。 */
  readonly limit?: number;
}

export interface HostHookObservationInventory {
  readonly records: readonly Readonly<HostHookObservation>[];
  /** 目录里存在但无法作为记录读入的条目数；调用方据此判断证据通道是否可信。 */
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
const DIRECTORY_MAXIMUM_ENTRIES = 4096;
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
    recordedAt: parseUtcInstant(input.recordedAt, "$observation.recordedAt"),
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

/** 记录文件：`<时间紧凑形>-<事件>-<recordId>.json`，按名字即可按时间与事件预筛。 */
function hostHookObservationRef(record: Readonly<HostHookObservation>): PortableResourcePath {
  return parsePortableResourcePath(
    `${hostHookObservationsRootRef(record.hostId)}/${compactInstant(record.recordedAt)}-${record.event}-${record.recordId}.json`,
    "$record",
  );
}

export interface WriteHostHookObservationReceipt {
  readonly record: Readonly<HostHookObservation>;
  readonly resourceRef: PortableResourcePath;
  readonly disposition: "created" | "current";
}

/** 写入一条记录：同一事实重复写入返回 `current`，同名不同内容拒绝。 */
export async function writeHostHookObservation(
  root: RootedDirectory,
  input: Readonly<HostHookObservationInput>,
  options: { readonly signal?: AbortSignal } = {},
): Promise<Readonly<WriteHostHookObservationReceipt>> {
  const record = createHostHookObservation(input);
  const resourceRef = hostHookObservationRef(record);
  const signal = options.signal === undefined ? {} : { signal: options.signal };
  try {
    await materializeDirectoryPath(root, hostHookObservationsRootRef(record.hostId), {
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
  const document = renderHostHookObservation(record);
  try {
    await createFileAtomically(root, resourceRef, encodeUtf8(document, "$record"), {
      mode: FILE_MODE,
      ...signal,
    });
    return Object.freeze({ record, resourceRef, disposition: "created" as const });
  } catch (error: unknown) {
    if (!(error instanceof DurableAtomicFileWriteError) || error.reason !== "target-exists") {
      if (error instanceof DurableAtomicFileWriteError) {
        fail("io-failure", `observation-write-${error.reason}`, "$observation", { cause: error });
      }
      throw error;
    }
  }
  const existing = await readDeterministicJsonFile(root, resourceRef, {
    maximumBytes: RECORD_MAXIMUM_BYTES,
    ...signal,
  });
  if (existing.text !== document) {
    fail("precondition-failed", "observation-conflict", "$observation");
  }
  return Object.freeze({ record, resourceRef, disposition: "current" as const });
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
  readonly entry: Awaited<ReturnType<typeof readStableResourceDirectory>>["entries"][number];
  readonly event: HostHookEvent;
}

async function listObservationCandidates(
  root: RootedDirectory,
  hostId: WakeflowHostId,
  filter: Readonly<HostHookObservationFilter>,
  signal: { readonly signal?: AbortSignal },
): Promise<Readonly<{
  readonly candidates: readonly ObservationCandidate[];
  readonly total: number;
}> | null> {
  let listing: Awaited<ReturnType<typeof readStableResourceDirectory>>;
  try {
    listing = await readStableResourceDirectory(root, hostHookObservationsRootRef(hostId), {
      maximumEntries: DIRECTORY_MAXIMUM_ENTRIES,
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
  for (const entry of listing.entries) {
    const prefilter = namePrefilter(entry.name, filter);
    if (prefilter !== null) candidates.push({ entry, event: prefilter.event });
  }
  candidates.sort((left, right) => left.entry.name.localeCompare(right.entry.name));
  return Object.freeze({ candidates, total: listing.entries.length });
}

/** 读取一个候选文件；内容不可用、宿主不符或文件名与记录不一致都返回 `null`。 */
async function readCandidateRecord(
  root: RootedDirectory,
  hostId: WakeflowHostId,
  candidate: ObservationCandidate,
  signal: { readonly signal?: AbortSignal },
): Promise<Readonly<HostHookObservation> | null> {
  let record: Readonly<HostHookObservation>;
  try {
    const read = await readDeterministicJsonFile(root, candidate.entry.resourcePath, {
      maximumBytes: RECORD_MAXIMUM_BYTES,
      expectedNode: candidate.entry.node,
      ...signal,
    });
    record = parseHostHookObservation(parseDeterministicJsonDocument(read.text, "$record"));
  } catch {
    return null;
  }
  if (record.hostId !== hostId || hostHookObservationRef(record) !== candidate.entry.resourcePath) {
    return null;
  }
  return record;
}

/** 有界读取一个宿主的记录；无法读入的条目只计数，不让证据通道整体失败。 */
export async function readHostHookObservations(
  root: RootedDirectory,
  hostIdValue: WakeflowHostId,
  filter: Readonly<HostHookObservationFilter> = {},
  options: { readonly signal?: AbortSignal } = {},
): Promise<Readonly<HostHookObservationInventory>> {
  const hostId = parseWakeflowHostId(hostIdValue);
  const limit = filter.limit ?? DEFAULT_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > DIRECTORY_MAXIMUM_ENTRIES) {
    fail("invalid-request", "hook-limit", "$filter.limit");
  }
  const signal = options.signal === undefined ? {} : { signal: options.signal };
  const listed = await listObservationCandidates(root, hostId, filter, signal);
  if (listed === null) return Object.freeze({ records: Object.freeze([]), skipped: 0 });
  const records: Readonly<HostHookObservation>[] = [];
  let skipped = listed.total - listed.candidates.length;
  for (const candidate of listed.candidates) {
    if (records.length >= limit) break;
    const record = await readCandidateRecord(root, hostId, candidate, signal);
    if (record === null) {
      skipped += 1;
    } else if (filter.sessionId === undefined || record.sessionId === filter.sessionId) {
      records.push(record);
    }
  }
  return Object.freeze({ records: Object.freeze(records), skipped });
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
  if (record === null || record.recordId !== recordId) return null;
  try {
    const read = await readStableFile(root, candidate.entry.resourcePath, {
      maximumBytes: RECORD_MAXIMUM_BYTES,
      expectedNode: candidate.entry.node,
      ...signal,
    });
    return Object.freeze({ record, digest: read.digest, byteCount: Number(read.byteCount) });
  } catch (error: unknown) {
    if (error instanceof StableFileReadError) {
      if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
      return null;
    }
    throw error;
  }
}
