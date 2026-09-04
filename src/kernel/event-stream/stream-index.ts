import {
  DeterministicJsonDocumentError,
  parseDeterministicJsonDocument,
  renderDeterministicJsonDocument,
} from "../../foundation/data/deterministic-json-document.js";
import type { JsonObject, JsonValue } from "../../foundation/data/json-value.js";
import { readDeterministicJsonFile } from "../../foundation/filesystem/deterministic-json-file.js";
import {
  createFileAtomically,
  DurableAtomicFileWriteError,
} from "../../foundation/filesystem/durable-atomic-file-write.js";
import {
  unlinkRegularFileExactly,
  ExactRegularFileUnlinkError,
} from "../../foundation/filesystem/exact-regular-file-unlink.js";
import type { FileNodeSnapshot } from "../../foundation/filesystem/file-node-snapshot.js";
import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import {
  RootedDirectoryError,
  type RootedDirectory,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  readStableResourceDirectory,
  StableDirectoryReadError,
} from "../../foundation/filesystem/stable-directory-read.js";
import { StableFileReadError } from "../../foundation/filesystem/stable-file-read.js";
import { StrictTextFileError } from "../../foundation/filesystem/strict-text-file.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import { fail, isWakeflowError } from "../error.js";

/**
 * Wakeflow Kernel / Event Stream：事件流的身份索引检查点（ADR-0005、ADR-0013 L0.3）。
 *
 * 索引是可删除、可重建的派生检查点，按提交序号以不可替换文件发布，记录到某个提交为止
 * 的全部 commitId、eventId、每种事件类型出现的提交序号、每个提交的摘要与总字节数。
 * 有了它，追加准入只需读一个前序提交文件，按身份定位事件只需读命中的提交文件，
 * 都不再重放整条流。索引损坏或落后时，消费者回退到全量读取并重建；索引从不是权威。
 */

export const STREAM_INDEX_ARTIFACT_KIND = "wakeflow-event-stream-index" as const;
export const STREAM_INDEX_SCHEMA_VERSION = 1 as const;
export const STREAM_INDEX_MAXIMUM_BYTES = parseByteCount(
  8 * 1024 * 1024,
  "$streamIndex.maximumBytes",
);
export const STREAM_INDEX_MAXIMUM_FILES = 10_000;

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const FILE_NAME_PATTERN = /^(?<sequence>[0-9]{16})\.json$/u;

export interface StreamIndexEvent {
  readonly sequence: number;
  readonly revision: number;
  readonly type: string;
}

export interface StreamIndex {
  readonly artifactKind: typeof STREAM_INDEX_ARTIFACT_KIND;
  readonly schemaVersion: typeof STREAM_INDEX_SCHEMA_VERSION;
  readonly streamId: string;
  readonly commitSequence: number;
  readonly streamRevision: number;
  readonly lastCommitDigest: string | null;
  readonly totalCommitBytes: number;
  /** commitId → commitSequence。 */
  readonly commits: Readonly<Record<string, number>>;
  /** commitSequence（十进制字符串）→ 提交摘要。 */
  readonly digests: Readonly<Record<string, string>>;
  /** eventId → 位置与类型。 */
  readonly events: Readonly<Record<string, StreamIndexEvent>>;
  /** eventType → 出现该类型事件的提交序号，升序去重。 */
  readonly byType: Readonly<Record<string, readonly number[]>>;
  /** 客户端幂等键 → commitSequence。 */
  readonly keys: Readonly<Record<string, number>>;
}

export interface IndexableCommitEvent {
  readonly eventId: string;
  readonly streamRevision: number;
  readonly eventType: string;
}

export interface IndexableCommit {
  readonly commitId: string;
  readonly commitSequence: number;
  readonly expectedStreamRevision: number;
  readonly lastStreamRevision: number;
  readonly previousCommitDigest: string | null;
  readonly digest: string;
  readonly byteLength: number;
  readonly events: readonly IndexableCommitEvent[];
  readonly idempotencyKey?: string;
}

export interface LocatedStreamIndex {
  readonly index: Readonly<StreamIndex>;
  readonly resourcePath: PortableResourcePath;
  readonly node: Readonly<FileNodeSnapshot>;
}

function isSequence(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && DIGEST_PATTERN.test(value);
}

function isNonEmptyToken(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

export function createStreamIndex(streamId: string): Readonly<StreamIndex> {
  if (!isNonEmptyToken(streamId)) fail("invalid-request", "stream-id", "$streamId");
  return Object.freeze({
    artifactKind: STREAM_INDEX_ARTIFACT_KIND,
    schemaVersion: STREAM_INDEX_SCHEMA_VERSION,
    streamId,
    commitSequence: 0,
    streamRevision: 0,
    lastCommitDigest: null,
    totalCommitBytes: 0,
    commits: Object.freeze({}),
    digests: Object.freeze({}),
    events: Object.freeze({}),
    byType: Object.freeze({}),
    keys: Object.freeze({}),
  });
}

/** 把一条已链到索引尾部的提交并入索引；链接不上即 `precondition-failed`。 */
export function advanceStreamIndex(
  index: Readonly<StreamIndex>,
  commit: Readonly<IndexableCommit>,
): Readonly<StreamIndex> {
  if (
    commit.commitSequence !== index.commitSequence + 1 ||
    commit.expectedStreamRevision !== index.streamRevision ||
    commit.previousCommitDigest !== index.lastCommitDigest ||
    !isDigest(commit.digest) ||
    !isSequence(commit.byteLength) ||
    commit.events.length === 0 ||
    commit.lastStreamRevision !== index.streamRevision + commit.events.length
  ) {
    fail("precondition-failed", "index-anchor", "$commit");
  }
  if (!isNonEmptyToken(commit.commitId) || Object.hasOwn(index.commits, commit.commitId)) {
    fail("precondition-failed", "commit-id-conflict", "$commit.commitId");
  }
  if (
    commit.idempotencyKey !== undefined &&
    (!isNonEmptyToken(commit.idempotencyKey) ||
      Object.hasOwn(index.keys, commit.idempotencyKey))
  ) {
    fail("precondition-failed", "idempotency-key-conflict", "$commit.idempotencyKey");
  }
  const events: Record<string, StreamIndexEvent> = { ...index.events };
  const byType: Record<string, number[]> = Object.fromEntries(
    Object.entries(index.byType).map(([type, sequences]) => [type, [...sequences]]),
  );
  for (const [position, event] of commit.events.entries()) {
    if (
      !isNonEmptyToken(event.eventId) ||
      !isNonEmptyToken(event.eventType) ||
      event.streamRevision !== index.streamRevision + position + 1 ||
      Object.hasOwn(events, event.eventId)
    ) {
      fail("precondition-failed", "event-id-conflict", `$commit.events[${position}]`);
    }
    events[event.eventId] = Object.freeze({
      sequence: commit.commitSequence,
      revision: event.streamRevision,
      type: event.eventType,
    });
    const sequences = byType[event.eventType] ?? [];
    if (sequences.at(-1) !== commit.commitSequence) sequences.push(commit.commitSequence);
    byType[event.eventType] = sequences;
  }
  return Object.freeze({
    artifactKind: STREAM_INDEX_ARTIFACT_KIND,
    schemaVersion: STREAM_INDEX_SCHEMA_VERSION,
    streamId: index.streamId,
    commitSequence: commit.commitSequence,
    streamRevision: commit.lastStreamRevision,
    lastCommitDigest: commit.digest,
    totalCommitBytes: index.totalCommitBytes + commit.byteLength,
    commits: Object.freeze({ ...index.commits, [commit.commitId]: commit.commitSequence }),
    digests: Object.freeze({ ...index.digests, [String(commit.commitSequence)]: commit.digest }),
    events: Object.freeze(events),
    byType: Object.freeze(
      Object.fromEntries(
        Object.entries(byType).map(([type, sequences]) => [type, Object.freeze(sequences)]),
      ),
    ),
    keys: Object.freeze(
      commit.idempotencyKey === undefined
        ? index.keys
        : { ...index.keys, [commit.idempotencyKey]: commit.commitSequence },
    ),
  });
}

/** 从一段自提交 1 起的完整前缀重建索引。 */
export function buildStreamIndex(
  streamId: string,
  commits: readonly Readonly<IndexableCommit>[],
): Readonly<StreamIndex> {
  let index = createStreamIndex(streamId);
  for (const commit of commits) index = advanceStreamIndex(index, commit);
  return index;
}

function record(value: JsonValue, path: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid-request", "index-shape", path);
  }
  return value as JsonObject;
}

/** 严格解析一份索引文档；任何形状或一致性问题都以 `invalid-request` 失败。 */
export function parseStreamIndex(value: JsonValue): Readonly<StreamIndex> {
  const root = record(value, "$");
  if (
    root.artifactKind !== STREAM_INDEX_ARTIFACT_KIND ||
    root.schemaVersion !== STREAM_INDEX_SCHEMA_VERSION ||
    !isNonEmptyToken(root.streamId) ||
    !isSequence(root.commitSequence) ||
    !isSequence(root.streamRevision) ||
    !(root.lastCommitDigest === null || isDigest(root.lastCommitDigest)) ||
    !isSequence(root.totalCommitBytes) ||
    Object.keys(root).length !== 12
  ) {
    fail("invalid-request", "index-shape", "$");
  }
  const commits = record(root.commits ?? null, "$.commits");
  const digests = record(root.digests ?? null, "$.digests");
  const events = record(root.events ?? null, "$.events");
  const byType = record(root.byType ?? null, "$.byType");
  const keys = record(root.keys ?? null, "$.keys");
  const commitEntries = Object.entries(commits);
  if (commitEntries.length !== root.commitSequence) {
    fail("invalid-request", "index-shape", "$.commits");
  }
  const sequences = new Set<number>();
  for (const [commitId, sequence] of commitEntries) {
    if (
      !isNonEmptyToken(commitId) ||
      !isSequence(sequence) ||
      sequence < 1 ||
      sequence > root.commitSequence ||
      sequences.has(sequence) ||
      !isDigest(digests[String(sequence)])
    ) {
      fail("invalid-request", "index-shape", "$.commits");
    }
    sequences.add(sequence);
  }
  if (Object.keys(digests).length !== root.commitSequence) {
    fail("invalid-request", "index-shape", "$.digests");
  }
  if (
    root.commitSequence > 0 &&
    digests[String(root.commitSequence)] !== root.lastCommitDigest
  ) {
    fail("invalid-request", "index-shape", "$.lastCommitDigest");
  }
  const parsedEvents: Record<string, StreamIndexEvent> = {};
  const revisions = new Set<number>();
  for (const [eventId, entry] of Object.entries(events)) {
    const located = record(entry, `$.events.${eventId}`);
    if (
      !isNonEmptyToken(eventId) ||
      !isSequence(located.sequence) ||
      !sequences.has(located.sequence) ||
      !isSequence(located.revision) ||
      located.revision < 1 ||
      located.revision > root.streamRevision ||
      revisions.has(located.revision) ||
      !isNonEmptyToken(located.type) ||
      Object.keys(located).length !== 3
    ) {
      fail("invalid-request", "index-shape", "$.events");
    }
    revisions.add(located.revision);
    parsedEvents[eventId] = Object.freeze({
      sequence: located.sequence,
      revision: located.revision,
      type: located.type,
    });
  }
  if (revisions.size !== root.streamRevision) {
    fail("invalid-request", "index-shape", "$.streamRevision");
  }
  const parsedKeys: Record<string, number> = {};
  for (const [key, sequence] of Object.entries(keys)) {
    if (!isNonEmptyToken(key) || !isSequence(sequence) || !sequences.has(sequence)) {
      fail("invalid-request", "index-shape", "$.keys");
    }
    parsedKeys[key] = sequence;
  }
  const parsedByType: Record<string, readonly number[]> = {};
  for (const [type, list] of Object.entries(byType)) {
    if (!isNonEmptyToken(type) || !Array.isArray(list) || list.length === 0) {
      fail("invalid-request", "index-shape", "$.byType");
    }
    let previous = 0;
    for (const sequence of list) {
      if (!isSequence(sequence) || sequence <= previous || !sequences.has(sequence)) {
        fail("invalid-request", "index-shape", "$.byType");
      }
      previous = sequence;
    }
    parsedByType[type] = Object.freeze([...(list as number[])]);
  }
  return Object.freeze({
    artifactKind: STREAM_INDEX_ARTIFACT_KIND,
    schemaVersion: STREAM_INDEX_SCHEMA_VERSION,
    streamId: root.streamId,
    commitSequence: root.commitSequence,
    streamRevision: root.streamRevision,
    lastCommitDigest: root.lastCommitDigest,
    totalCommitBytes: root.totalCommitBytes,
    commits: Object.freeze({ ...(commits as Record<string, number>) }),
    digests: Object.freeze({ ...(digests as Record<string, string>) }),
    events: Object.freeze(parsedEvents),
    byType: Object.freeze(parsedByType),
    keys: Object.freeze(parsedKeys),
  });
}

export function renderStreamIndex(index: Readonly<StreamIndex>): string {
  return renderDeterministicJsonDocument(index as unknown as JsonValue);
}

export function streamIndexFileName(sequence: number): string {
  if (!isSequence(sequence)) fail("invalid-request", "index-sequence", "$sequence");
  return `${String(sequence).padStart(16, "0")}.json`;
}

export function streamIndexRef(
  directoryRef: PortableResourcePath,
  sequence: number,
): PortableResourcePath {
  return parsePortableResourcePath(`${directoryRef}/${streamIndexFileName(sequence)}`);
}

interface IndexFileEntry {
  readonly sequence: number;
  readonly resourcePath: PortableResourcePath;
  readonly node: Readonly<FileNodeSnapshot>;
}

async function listIndexFiles(
  root: RootedDirectory,
  directoryRef: PortableResourcePath,
  signal: AbortSignal | undefined,
): Promise<readonly IndexFileEntry[] | null> {
  let read;
  try {
    read = await readStableResourceDirectory(root, directoryRef, {
      maximumEntries: STREAM_INDEX_MAXIMUM_FILES,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof StableDirectoryReadError) return null;
    throw error;
  }
  const entries: IndexFileEntry[] = [];
  for (const entry of read.entries) {
    const match = FILE_NAME_PATTERN.exec(entry.name);
    const sequence = match?.groups?.sequence;
    if (sequence === undefined || entry.node.kind !== "file") continue;
    entries.push({ sequence: Number(sequence), resourcePath: entry.resourcePath, node: entry.node });
  }
  entries.sort((left, right) => right.sequence - left.sequence);
  return entries;
}

/**
 * 读取最新可用的索引；目录缺失、文件损坏、形状不合法都返回 `null`，由调用方回退重建。
 * `expectedStreamId` 不匹配的索引同样视为不可用。
 */
export async function readLatestStreamIndex(
  root: RootedDirectory,
  directoryRef: PortableResourcePath,
  expectedStreamId: string | null,
  signal?: AbortSignal,
): Promise<Readonly<LocatedStreamIndex> | null> {
  const entries = await listIndexFiles(root, directoryRef, signal);
  if (entries === null) return null;
  for (const entry of entries) {
    try {
      const read = await readDeterministicJsonFile(root, entry.resourcePath, {
        maximumBytes: STREAM_INDEX_MAXIMUM_BYTES,
        expectedNode: entry.node,
        ...(signal === undefined ? {} : { signal }),
      });
      const index = parseStreamIndex(parseDeterministicJsonDocument(read.text));
      if (
        (expectedStreamId !== null && index.streamId !== expectedStreamId) ||
        index.commitSequence !== entry.sequence
      ) {
        continue;
      }
      return Object.freeze({ index, resourcePath: entry.resourcePath, node: read.node });
    } catch (error: unknown) {
      if (
        error instanceof DeterministicJsonDocumentError ||
        error instanceof StableFileReadError ||
        error instanceof StrictTextFileError ||
        isWakeflowError(error)
      ) {
        continue;
      }
      throw error;
    }
  }
  return null;
}

/** 以不可替换文件发布一份索引；同序号已存在即视为已发布。 */
export async function publishStreamIndex(
  root: RootedDirectory,
  directoryRef: PortableResourcePath,
  index: Readonly<StreamIndex>,
  options: { readonly mode: number; readonly signal?: AbortSignal },
): Promise<"published" | "existing"> {
  const bytes = encodeUtf8(renderStreamIndex(index));
  if (bytes.byteLength > STREAM_INDEX_MAXIMUM_BYTES) {
    fail("capacity-exceeded", "index-bytes", "$index");
  }
  try {
    await createFileAtomically(root, streamIndexRef(directoryRef, index.commitSequence), bytes, {
      mode: options.mode,
      durability: "none",
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    return "published";
  } catch (error: unknown) {
    if (error instanceof DurableAtomicFileWriteError) {
      if (error.reason === "target-exists") return "existing";
      fail("io-failure", "index-publish", "$index", { cause: error });
    }
    throw error;
  }
}

/** 直接退休一个序号的索引文件；不存在或退休失败都返回 `false`。 */
export async function retireStreamIndexAt(
  root: RootedDirectory,
  directoryRef: PortableResourcePath,
  sequence: number,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!isSequence(sequence) || sequence < 1) return false;
  const ref = streamIndexRef(directoryRef, sequence);
  let node: Readonly<FileNodeSnapshot>;
  try {
    node = (await root.inspectExistingResource(ref)).node;
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) return false;
    throw error;
  }
  if (node.kind !== "file") return false;
  try {
    await unlinkRegularFileExactly(root, ref, {
      expectedNode: node,
      durability: "none",
      ...(signal === undefined ? {} : { signal }),
    });
    return true;
  } catch (error: unknown) {
    if (error instanceof ExactRegularFileUnlinkError) return false;
    throw error;
  }
}

/** 退休序号小于 `keepFromSequence` 的索引文件；退休失败只计数，不抛出。 */
export async function retireStreamIndexesBefore(
  root: RootedDirectory,
  directoryRef: PortableResourcePath,
  keepFromSequence: number,
  signal?: AbortSignal,
): Promise<{ readonly retired: number; readonly failed: number }> {
  const entries = await listIndexFiles(root, directoryRef, signal);
  let retired = 0;
  let failed = 0;
  for (const entry of entries ?? []) {
    if (entry.sequence >= keepFromSequence) continue;
    try {
      await unlinkRegularFileExactly(root, entry.resourcePath, {
        expectedNode: entry.node,
        durability: "none",
        ...(signal === undefined ? {} : { signal }),
      });
      retired += 1;
    } catch (error: unknown) {
      if (error instanceof ExactRegularFileUnlinkError) {
        failed += 1;
        continue;
      }
      throw error;
    }
  }
  return Object.freeze({ retired, failed });
}
