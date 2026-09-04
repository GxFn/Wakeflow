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
  type StableDirectoryEntry,
  type StableDirectoryReadResult,
} from "../../../foundation/filesystem/stable-directory-read.js";
import { StableFileReadError } from "../../../foundation/filesystem/stable-file-read.js";
import { StrictTextFileError } from "../../../foundation/filesystem/strict-text-file.js";
import {
  computeDemandEventStreamCommitDigest,
  parseDemandEventStreamCommitDocument,
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
  parseDemandEventStreamRevision,
  DemandEventStreamPositionError,
} from "./demand-event-stream-position.js";
import {
  demandEventStreamCommitRef,
  parseDemandEventStreamCommitFileName,
  DemandEventSourcingPathError,
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

function demandFileEventCursorFrom(
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
  try {
    return Object.freeze({
      commitSequence: parseDemandEventCommitSequence(
        record.commitSequence,
        "$/commitSequence",
      ),
      streamRevision: parseDemandEventStreamRevision(
        record.streamRevision,
        "$/streamRevision",
      ),
      lastCommitDigest,
    });
  } catch (error: unknown) {
    if (error instanceof DemandEventStreamPositionError) {
      fail("input", error.path);
    }
    throw error;
  }
}

async function readCommitEntries(
  root: RootedDirectory,
  entries: readonly Readonly<StableDirectoryEntry>[],
  indexOffset: number,
  signal: AbortSignal | undefined,
): Promise<readonly Readonly<LoadedDemandFileEventCommit>[]> {
  const limit = pLimit(COMMIT_READ_CONCURRENCY);
  const settled = await Promise.allSettled(entries.map((entry, index) => (
    limit(() => readDemandFileEventCommit(
      root,
      entry.resourcePath,
      entry.node,
      signal,
      `$commits/${indexOffset + index}`,
    ))
  )));
  const loaded: Readonly<LoadedDemandFileEventCommit>[] = [];
  for (const result of settled) {
    if (result.status === "rejected") throw result.reason;
    loaded.push(result.value);
  }
  return Object.freeze(loaded);
}

function assertInventoryNames(
  read: Readonly<StableDirectoryReadResult<PortableResourcePath>>,
): void {
  let totalBytes = 0;
  read.entries.forEach((entry, index) => {
    let parsed;
    try {
      parsed = parseDemandEventStreamCommitFileName(entry.name);
    } catch (error: unknown) {
      if (error instanceof DemandEventSourcingPathError) {
        fail("stream-invalid", `$commits/${index}`);
      }
      throw error;
    }
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
  const loaded = await readCommitEntries(root, before.entries, 0, signal);
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
  // 尾部读取按序号逐文件探测，不枚举整个提交目录：成本只与尾部长度有关。
  const anchorLoaded = await readDemandFileEventCommitOrNull(
    root,
    demandEventStreamCommitRef(cursor.commitSequence),
    signal,
  );
  const anchor = anchorLoaded?.commit;
  if (
    anchor === undefined
    || anchor.commitSequence !== cursor.commitSequence
    || anchor.lastStreamRevision !== cursor.streamRevision
    || computeDemandEventStreamCommitDigest(anchor) !== cursor.lastCommitDigest
  ) {
    fail("stream-invalid", "$cursor");
  }
  const commits: Readonly<DemandEventStreamCommit>[] = [];
  let previous = anchor;
  for (
    let sequence = cursor.commitSequence + 1;
    sequence <= DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMITS;
    sequence += 1
  ) {
    const loaded = await readDemandFileEventCommitOrNull(
      root,
      demandEventStreamCommitRef(parseDemandEventCommitSequence(sequence, "$tail")),
      signal,
    );
    if (loaded === null) break;
    const commit = loaded.commit;
    if (
      commit.commitSequence !== sequence
      || commit.demandId !== previous.demandId
      || commit.expectedStreamRevision !== previous.lastStreamRevision
      || commit.previousCommitDigest
        !== computeDemandEventStreamCommitDigest(previous)
    ) {
      fail("stream-invalid", `$tail/${commits.length}`);
    }
    commits.push(commit);
    previous = commit;
  }
  const finalCursor = demandFileEventCursorFrom(previous);
  if (finalCursor === null) fail("stream-invalid", "$commits");
  return Object.freeze({
    anchorCommit: anchor,
    commits: Object.freeze(commits),
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
  let sequence;
  try {
    sequence = parseDemandEventCommitSequence(sequenceValue);
  } catch (error: unknown) {
    if (error instanceof DemandEventStreamPositionError) {
      fail("input", "$sequence");
    }
    throw error;
  }
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

/** 对一段已读入的完整前缀执行同一套追加准入检查，不做任何 I/O。 */
export function assertDemandFileEventAppendAdmissionAgainstPrefix(
  prefixCommits: readonly Readonly<DemandEventStreamCommit>[],
  prepared: Readonly<PreparedDemandEventStreamCommit>,
): void {
  const { commit, sourceExpectation } = prepared;
  const prefix = { commits: prefixCommits };
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
  if (
    commit.idempotency !== undefined
    && prefix.commits.some(
      (current) => current.idempotency?.key === commit.idempotency?.key,
    )
  ) {
    fail("append-identity-conflict", "$commit/idempotency/key");
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
