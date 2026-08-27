import pLimit from "p-limit";

import {
  parseSha256Digest,
  Sha256Error,
} from "../../../foundation/crypto/sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../../foundation/data/passive-own-data.js";
import { readDeterministicJsonFile } from "../../../foundation/filesystem/deterministic-json-file.js";
import { DeterministicJsonDocumentError } from "../../../foundation/data/deterministic-json-document.js";
import {
  sameFileNodeSnapshot,
  type FileNodeSnapshot,
} from "../../../foundation/filesystem/file-node-snapshot.js";
import type { PortableResourcePath } from "../../../foundation/filesystem/portable-resource-path.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../../foundation/filesystem/rooted-directory.js";
import {
  readStableResourceDirectory,
  StableDirectoryReadError,
  type StableDirectoryReadResult,
} from "../../../foundation/filesystem/stable-directory-read.js";
import { StableFileReadError } from "../../../foundation/filesystem/stable-file-read.js";
import { StrictTextFileError } from "../../../foundation/filesystem/strict-text-file.js";
import {
  computeDemandEventStreamCommitDigest,
  parseDemandEventStreamCommitDocument,
  parseDemandEventStreamCommitFileName,
  DemandEventStreamCommitError,
  type DemandEventStreamCommit,
  type PreparedDemandEventStreamCommit,
  renderDemandEventStreamCommit,
} from "./demand-event-stream-commit.js";
import {
  computeDemandEventSourcingStoredEventDigest,
} from "./demand-event-sourcing-stored-event.js";
import { encodeUtf8 } from "../../../foundation/text/utf8.js";
import {
  parseDemandEventCommitSequence,
} from "./demand-event-sourcing-aggregate.js";
import {
  demandEventStreamCommitRef,
  DEMAND_EVENT_STREAM_COMMITS_ROOT_REF,
} from "./demand-event-sourcing-paths.js";
import {
  DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMIT_BYTES,
  DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMITS,
  DEMAND_FILE_EVENT_STORE_MAXIMUM_TOTAL_BYTES,
  DemandFileEventStoreError,
  assertDemandFileEventStoreDirectory,
  assertDemandFileEventStoreFile,
  failDemandFileEventStore as fail,
  type DemandFileEventStoreCursor,
  type DemandFileEventStoreReadResult,
  type DemandFileEventStoreTailReadResult,
} from "./demand-file-event-store-contract.js";

/** Demand 文件事件存储的稳定提交清单与读取边界。 */

const COMMIT_READ_CONCURRENCY = 8;

export interface LoadedDemandFileEventCommit {
  readonly commit: Readonly<DemandEventStreamCommit>;
  readonly node: Readonly<FileNodeSnapshot>;
  readonly text: string;
}

function sameDirectoryRead(
  left: Readonly<StableDirectoryReadResult<PortableResourcePath>>,
  right: Readonly<StableDirectoryReadResult<PortableResourcePath>>,
): boolean {
  return sameFileNodeSnapshot(left.directoryNode, right.directoryNode)
    && left.entries.length === right.entries.length
    && left.entries.every((entry, index) => {
      const other = right.entries[index];
      return other !== undefined
        && entry.name === other.name
        && entry.resourcePath === other.resourcePath
        && sameFileNodeSnapshot(entry.node, other.node);
    });
}

export async function readDemandFileEventDirectory(
  root: RootedDirectory,
  ref: PortableResourcePath,
  maximumEntries: number,
  signal: AbortSignal | undefined,
  expectedNode?: Readonly<FileNodeSnapshot>,
): Promise<Readonly<StableDirectoryReadResult<PortableResourcePath>>> {
  try {
    const result = await readStableResourceDirectory(root, ref, {
      maximumEntries,
      ...(expectedNode === undefined ? {} : { expectedNode }),
      ...(signal === undefined ? {} : { signal }),
    });
    assertDemandFileEventStoreDirectory(result.directoryNode, `$${ref}`);
    return result;
  } catch (error: unknown) {
    if (error instanceof DemandFileEventStoreError) throw error;
    if (error instanceof StableDirectoryReadError) {
      if (error.reason === "not-found") fail("not-initialized", `$${ref}`);
      if (error.reason === "too-many-entries") fail("capacity", `$${ref}`);
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "root-scope") fail("root-scope", "$root");
      fail("stream-changed", `$${ref}`);
    }
    throw error;
  }
}

export async function readDemandFileEventCommit(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  expectedNode: Readonly<FileNodeSnapshot>,
  signal: AbortSignal | undefined,
  path: string,
  admittedLinkCounts: readonly bigint[] = [1n],
): Promise<Readonly<LoadedDemandFileEventCommit>> {
  assertDemandFileEventStoreFile(expectedNode, path, admittedLinkCounts);
  let read;
  try {
    read = await readDeterministicJsonFile(root, resourcePath, {
      maximumBytes: DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMIT_BYTES,
      expectedNode,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof DemandFileEventStoreError) throw error;
    if (error instanceof StableFileReadError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (
        error.reason === "root-scope"
        || error.reason === "unsupported-platform"
      ) {
        fail("root-scope", "$root");
      }
      if (
        error.reason === "not-found"
        || error.reason === "expectation-changed"
        || error.reason === "source-changed"
      ) {
        fail("stream-changed", path);
      }
      if (error.reason === "too-large") fail("capacity", path);
      if (
        error.reason === "symlink"
        || error.reason === "not-file"
      ) {
        fail("stream-invalid", path);
      }
      fail("operation-failure", path);
    }
    if (
      error instanceof StrictTextFileError
      || error instanceof DeterministicJsonDocumentError
    ) {
      fail("stream-invalid", path);
    }
    throw error;
  }
  try {
    return Object.freeze({
      commit: parseDemandEventStreamCommitDocument(read.text),
      node: read.node,
      text: read.text,
    });
  } catch (error: unknown) {
    if (error instanceof DemandEventStreamCommitError) {
      fail("stream-invalid", path);
    }
    throw error;
  }
}

function assertCommitChain(
  commits: readonly Readonly<DemandEventStreamCommit>[],
): void {
  let previous: Readonly<DemandEventStreamCommit> | null = null;
  const commitIds = new Set<string>();
  const eventIds = new Set<string>();
  for (const [index, commit] of commits.entries()) {
    if (
      commit.commitSequence !== index + 1
      || commitIds.has(commit.commitId)
      || (previous === null && (
        commit.expectedStreamRevision !== 0
        || commit.previousCommitDigest !== null
      ))
      || (previous !== null && (
        commit.demandId !== previous.demandId
        || commit.expectedStreamRevision !== previous.lastStreamRevision
        || commit.previousCommitDigest
          !== computeDemandEventStreamCommitDigest(previous)
      ))
    ) {
      fail("stream-invalid", `$commits/${index}`);
    }
    commitIds.add(commit.commitId);
    for (const event of commit.events) {
      if (eventIds.has(event.eventId)) {
        fail("stream-invalid", `$commits/${index}/events`);
      }
      eventIds.add(event.eventId);
    }
    previous = commit;
  }
}

export function demandFileEventCursorFrom(
  commit: Readonly<DemandEventStreamCommit> | undefined,
): Readonly<DemandFileEventStoreCursor> | null {
  if (commit === undefined) return null;
  return Object.freeze({
    commitSequence: commit.commitSequence,
    streamRevision: commit.lastStreamRevision,
    lastCommitDigest: computeDemandEventStreamCommitDigest(commit),
  });
}

function parseCursor(value: unknown): Readonly<DemandFileEventStoreCursor> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$cursor");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$cursor");
    throw error;
  }
  const keys = Object.keys(record).sort();
  if (
    keys.length !== 3
    || keys[0] !== "commitSequence"
    || keys[1] !== "lastCommitDigest"
    || keys[2] !== "streamRevision"
    || !Number.isSafeInteger(record.streamRevision)
    || (record.streamRevision as number) < 1
  ) {
    fail("input", "$cursor");
  }
  let lastCommitDigest;
  try {
    lastCommitDigest = parseSha256Digest(
      record.lastCommitDigest,
      "$/lastCommitDigest",
    );
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("input", "$/lastCommitDigest");
    throw error;
  }
  return Object.freeze({
    commitSequence: parseDemandEventCommitSequence(
      record.commitSequence,
      "$/commitSequence",
    ),
    streamRevision: record.streamRevision as number,
    lastCommitDigest,
  });
}

function assertInventoryNames(
  read: Readonly<StableDirectoryReadResult<PortableResourcePath>>,
): void {
  let totalBytes = 0;
  read.entries.forEach((entry, index) => {
    const parsed = parseDemandEventStreamCommitFileName(entry.name);
    assertDemandFileEventStoreFile(entry.node, `$commits/${index}`);
    if (parsed.commitSequence !== index + 1) {
      fail("stream-invalid", `$commits/${index}`);
    }
    if (entry.node.byteCount > DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMIT_BYTES) {
      fail("capacity", `$commits/${index}`);
    }
    totalBytes += entry.node.byteCount;
  });
  if (totalBytes > DEMAND_FILE_EVENT_STORE_MAXIMUM_TOTAL_BYTES) {
    fail("capacity", "$commits");
  }
}

export async function readAllDemandFileEventCommits(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<Readonly<DemandFileEventStoreReadResult>> {
  const before = await readDemandFileEventDirectory(
    root,
    DEMAND_EVENT_STREAM_COMMITS_ROOT_REF,
    DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMITS,
    signal,
  );
  assertInventoryNames(before);
  const limit = pLimit(COMMIT_READ_CONCURRENCY);
  const loaded = await Promise.all(before.entries.map((entry, index) => (
    limit(() => readDemandFileEventCommit(
      root,
      entry.resourcePath,
      entry.node,
      signal,
      `$commits/${index}`,
    ))
  )));
  const after = await readDemandFileEventDirectory(
    root,
    DEMAND_EVENT_STREAM_COMMITS_ROOT_REF,
    DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMITS,
    signal,
    before.directoryNode,
  );
  if (!sameDirectoryRead(before, after)) fail("stream-changed", "$commits");
  const commits = Object.freeze(loaded.map((entry) => entry.commit));
  assertCommitChain(commits);
  return Object.freeze({ commits, cursor: demandFileEventCursorFrom(commits.at(-1)) });
}

export async function readDemandFileEventCommitsAfter(
  root: RootedDirectory,
  cursorValue: unknown,
  signal: AbortSignal | undefined,
): Promise<Readonly<DemandFileEventStoreTailReadResult>> {
  const cursor = parseCursor(cursorValue);
  const before = await readDemandFileEventDirectory(
    root,
    DEMAND_EVENT_STREAM_COMMITS_ROOT_REF,
    DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMITS,
    signal,
  );
  if (before.entries.length < cursor.commitSequence) {
    fail("stream-invalid", "$cursor/commitSequence");
  }
  assertInventoryNames(before);
  const selected = before.entries.slice(cursor.commitSequence - 1);
  const limit = pLimit(COMMIT_READ_CONCURRENCY);
  const loaded = await Promise.all(selected.map((entry, index) => (
    limit(() => readDemandFileEventCommit(
      root,
      entry.resourcePath,
      entry.node,
      signal,
      `$commits/${cursor.commitSequence - 1 + index}`,
    ))
  )));
  const after = await readDemandFileEventDirectory(
    root,
    DEMAND_EVENT_STREAM_COMMITS_ROOT_REF,
    DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMITS,
    signal,
    before.directoryNode,
  );
  if (!sameDirectoryRead(before, after)) fail("stream-changed", "$commits");
  const anchor = loaded[0]?.commit;
  if (
    anchor === undefined
    || anchor.commitSequence !== cursor.commitSequence
    || anchor.lastStreamRevision !== cursor.streamRevision
    || computeDemandEventStreamCommitDigest(anchor) !== cursor.lastCommitDigest
  ) {
    fail("stream-invalid", "$cursor");
  }
  let previous = anchor;
  for (const [index, entry] of loaded.slice(1).entries()) {
    const commit = entry.commit;
    if (
      commit.commitSequence !== previous.commitSequence + 1
      || commit.demandId !== previous.demandId
      || commit.expectedStreamRevision !== previous.lastStreamRevision
      || commit.previousCommitDigest
        !== computeDemandEventStreamCommitDigest(previous)
    ) {
      fail("stream-invalid", `$tail/${index}`);
    }
    previous = commit;
  }
  const finalCursor = demandFileEventCursorFrom(previous);
  if (finalCursor === null) fail("stream-invalid", "$commits");
  return Object.freeze({
    anchorCommit: anchor,
    commits: Object.freeze(loaded.slice(1).map((entry) => entry.commit)),
    cursor: finalCursor,
  });
}

export async function readDemandFileEventCommitOrNull(
  root: RootedDirectory,
  ref: PortableResourcePath,
  signal: AbortSignal | undefined,
  admittedLinkCounts: readonly bigint[] = [1n],
): Promise<Readonly<LoadedDemandFileEventCommit> | null> {
  let resource;
  try {
    resource = await root.inspectExistingResource(ref);
  } catch (error: unknown) {
    if (
      error instanceof RootedDirectoryError
      && error.reason === "resource-not-found"
    ) {
      return null;
    }
    if (error instanceof RootedDirectoryError) fail("root-scope", "$root");
    throw error;
  }
  return readDemandFileEventCommit(
    root,
    ref,
    resource.node,
    signal,
    "$commit",
    admittedLinkCounts,
  );
}

export async function readDemandFileEventCommitAt(
  root: RootedDirectory,
  sequenceValue: unknown,
  signal: AbortSignal | undefined,
): Promise<Readonly<DemandEventStreamCommit> | null> {
  const sequence = parseDemandEventCommitSequence(sequenceValue);
  const loaded = await readDemandFileEventCommitOrNull(
    root,
    demandEventStreamCommitRef(sequence),
    signal,
  );
  if (loaded === null) return null;
  if (loaded.commit.commitSequence !== sequence) {
    fail("stream-invalid", "$commit/commitSequence");
  }
  return loaded.commit;
}

/**
 * 在候选资源产生任何副作用前，验证完整有界前缀与下一次追加的准入关系。
 *
 * `commitId`、`eventId` 是不可变事件流身份，`sourceExpectation` 则把进程内状态绑定到
 * 持久化尾部；两者都不能只留给事后审计。当前事件流总量硬上限为
 * 64 MiB，因此当前通过验证完整前缀保证正确性；未来若增加派生身份索引，它仍
 * 必须由同一提交权威重建，并保持本函数遇到不确定状态时保守拒绝的语义。
 */
export async function assertDemandFileEventAppendAdmission(
  root: RootedDirectory,
  prepared: Readonly<PreparedDemandEventStreamCommit>,
  signal: AbortSignal | undefined,
): Promise<void> {
  const { commit, sourceExpectation } = prepared;
  const prefix = await readAllDemandFileEventCommits(root, signal);
  if (prefix.commits.length !== commit.commitSequence - 1) {
    fail("concurrency-conflict", "$commit/commitSequence");
  }
  const currentBytes = prefix.commits.reduce(
    (total, current) => total + encodeUtf8(
      renderDemandEventStreamCommit(current),
    ).byteLength,
    0,
  );
  const commitBytes = encodeUtf8(
    renderDemandEventStreamCommit(commit),
  ).byteLength;
  if (
    prefix.commits.length >= DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMITS
    || commitBytes > DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMIT_BYTES
    || currentBytes + commitBytes > DEMAND_FILE_EVENT_STORE_MAXIMUM_TOTAL_BYTES
  ) {
    fail("capacity", "$commit");
  }
  if (commit.commitSequence === 1) {
    if (
      commit.expectedStreamRevision !== 0
      || commit.previousCommitDigest !== null
    ) {
      fail("concurrency-conflict", "$commit");
    }
    if (
      sourceExpectation.lastEventDigest !== null
      || sourceExpectation.stateDigest !== null
    ) {
      fail(
        "append-provenance-conflict",
        "$preparedCommit/sourceExpectation",
      );
    }
  } else {
    const previous = prefix.commits.at(-1);
    if (previous === undefined) fail("stream-invalid", "$commits");
    if (
      previous.lastStreamRevision !== commit.expectedStreamRevision
      || computeDemandEventStreamCommitDigest(previous)
      !== commit.previousCommitDigest
      || previous.demandId !== commit.demandId
    ) {
      fail("concurrency-conflict", "$commit");
    }
    const previousLastEvent = previous.events.at(-1);
    if (previousLastEvent === undefined) fail("stream-invalid", "$commits/last");
    if (
      sourceExpectation.stateDigest
        !== previousLastEvent.resultingStateDigest
      || sourceExpectation.lastEventDigest
        !== computeDemandEventSourcingStoredEventDigest(previousLastEvent)
    ) {
      fail(
        "append-provenance-conflict",
        "$preparedCommit/sourceExpectation",
      );
    }
  }

  if (prefix.commits.some((current) => current.commitId === commit.commitId)) {
    fail("append-identity-conflict", "$commit/commitId");
  }
  const eventIds = new Set<string>();
  for (const current of prefix.commits) {
    for (const event of current.events) eventIds.add(event.eventId);
  }
  for (const [index, event] of commit.events.entries()) {
    if (eventIds.has(event.eventId)) {
      fail(
        "append-identity-conflict",
        `$commit/events/${index}/eventId`,
      );
    }
  }
}
