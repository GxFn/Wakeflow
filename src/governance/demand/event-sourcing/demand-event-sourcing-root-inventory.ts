import { types } from "node:util";

import type { FileNodeSnapshot } from "../../../foundation/filesystem/file-node-snapshot.js";
import type { PortableResourcePath } from "../../../foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../foundation/filesystem/rooted-directory.js";
import {
  readStableResourceDirectory,
  readStableRootDirectory,
  StableDirectoryReadError,
  type StableDirectoryReadResult,
} from "../../../foundation/filesystem/stable-directory-read.js";
import {
  parseDemandEventStreamCommitFileName,
} from "./demand-event-stream-commit.js";
import {
  DEMAND_EVENT_APPEND_CANDIDATES_ROOT_REF,
  DEMAND_EVENT_SOURCING_ARTIFACTS_ROOT_REF,
  DEMAND_EVENT_SOURCING_ROOT_REF,
  DEMAND_EVENT_SOURCING_SNAPSHOTS_ROOT_REF,
  DEMAND_EVENT_SOURCING_TRANSACTIONS_ROOT_REF,
  DEMAND_EVENT_STREAM_COMMITS_ROOT_REF,
} from "./demand-event-sourcing-paths.js";
import {
  DEMAND_FILE_EVENT_STORE_DIRECTORY_MODE,
  DEMAND_FILE_EVENT_STORE_FILE_MODE,
  DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMITS,
} from "./demand-file-event-store.js";

/**
 * Wakeflow Governance / Demand Event Sourcing：健康 Demand 根目录的排他资源清单。
 *
 * 本能力不仅验证必需资源存在，还证明根目录和事件溯源子树中不存在未知项。提交记录
 * 和快照内容由各自存储验证；本模块负责目录层级、文件系统节点类型、私有权限位、
 * 健康状态下候选目录与事务目录为空，以及当前 RH-2 的空 Artifacts 边界。
 */

export interface DemandEventSourcingRootInventory {
  readonly commitCount: number;
  readonly snapshotCount: number;
  readonly artifactCount: 0;
  readonly transactionCount: 0 | 1;
  readonly appendCandidateCount: 0;
  readonly nodes: Readonly<{
    readonly root: Readonly<FileNodeSnapshot>;
    readonly identity: Readonly<FileNodeSnapshot>;
    readonly authority: Readonly<FileNodeSnapshot>;
    readonly eventSourcing: Readonly<FileNodeSnapshot>;
    readonly commits: Readonly<FileNodeSnapshot>;
    readonly snapshots: Readonly<FileNodeSnapshot>;
    readonly appendCandidates: Readonly<FileNodeSnapshot>;
    readonly artifacts: Readonly<FileNodeSnapshot>;
    readonly transactions: Readonly<FileNodeSnapshot>;
  }>;
}

export type DemandEventSourcingRootInventoryErrorReason =
  | "input"
  | "root-scope"
  | "tree-shape"
  | "node-policy"
  | "capacity"
  | "source-changed"
  | "aborted"
  | "operation-failure";

const ERROR_MESSAGES = {
  "input": "Demand Event Sourcing root inventory input is invalid.",
  "root-scope": "Demand Event Sourcing root changed during inventory.",
  "tree-shape": "Demand Event Sourcing root contains a missing or unknown resource.",
  "node-policy": "Demand Event Sourcing root resource violates private node policy.",
  "capacity": "Demand Event Sourcing root inventory exceeds its capacity.",
  "source-changed": "Demand Event Sourcing root inventory changed during observation.",
  "aborted": "Demand Event Sourcing root inventory was aborted.",
  "operation-failure": "Demand Event Sourcing root inventory failed.",
} as const satisfies Readonly<Record<
  DemandEventSourcingRootInventoryErrorReason,
  string
>>;

export class DemandEventSourcingRootInventoryError extends Error {
  override readonly name = "DemandEventSourcingRootInventoryError";
  readonly code = "wakeflow-demand-event-sourcing-root-inventory" as const;
  readonly reason: DemandEventSourcingRootInventoryErrorReason;
  readonly path: string;

  constructor(
    reason: DemandEventSourcingRootInventoryErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const ROOT_NAMES = Object.freeze([
  "artifacts",
  "authority.json",
  "event-sourcing",
  "identity.json",
  "transactions",
] as const);
const EVENT_SOURCING_NAMES = Object.freeze([
  "append-candidates",
  "commits",
  "snapshots",
] as const);

function fail(
  reason: DemandEventSourcingRootInventoryErrorReason,
  path: string,
): never {
  throw new DemandEventSourcingRootInventoryError(reason, path);
}

function exactNames(
  read: Readonly<StableDirectoryReadResult<PortableResourcePath | null>>,
  names: readonly string[],
  path: string,
): void {
  if (
    read.entries.length !== names.length
    || read.entries.some((entry, index) => entry.name !== names[index])
  ) {
    fail("tree-shape", path);
  }
}

function assertDirectory(node: Readonly<FileNodeSnapshot>, path: string): void {
  if (
    node.kind !== "directory"
    || node.permissionBits !== DEMAND_FILE_EVENT_STORE_DIRECTORY_MODE
  ) {
    fail("node-policy", path);
  }
}

function assertFile(node: Readonly<FileNodeSnapshot>, path: string): void {
  if (
    node.kind !== "file"
    || node.permissionBits !== DEMAND_FILE_EVENT_STORE_FILE_MODE
    || node.linkCount !== 1n
  ) {
    fail("node-policy", path);
  }
}

function mapReadError(error: StableDirectoryReadError, path: string): never {
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (error.reason === "too-many-entries") fail("capacity", path);
  if (error.reason === "source-changed") fail("source-changed", path);
  if (error.reason === "root-scope") fail("root-scope", "$root");
  if (
    error.reason === "not-found"
    || error.reason === "symlink"
    || error.reason === "not-directory"
  ) {
    fail("tree-shape", path);
  }
  fail("operation-failure", path);
}

async function readResource(
  root: RootedDirectory,
  ref: PortableResourcePath,
  maximumEntries: number,
  signal: AbortSignal | undefined,
): Promise<Readonly<StableDirectoryReadResult<PortableResourcePath>>> {
  try {
    return await readStableResourceDirectory(root, ref, {
      maximumEntries,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof StableDirectoryReadError) mapReadError(error, `$${ref}`);
    throw error;
  }
}

function assertEmpty(
  read: Readonly<StableDirectoryReadResult<PortableResourcePath>>,
  path: string,
): void {
  assertDirectory(read.directoryNode, path);
  if (read.entries.length !== 0) fail("tree-shape", path);
}

function requiredEntryNode(
  read: Readonly<StableDirectoryReadResult<PortableResourcePath | null>>,
  name: string,
  path: string,
): Readonly<FileNodeSnapshot> {
  const entry = read.entries.find((candidate) => candidate.name === name);
  if (entry === undefined) fail("tree-shape", path);
  return entry.node;
}

/** 稳定证明一个 normal-load Demand root 的完整允许集合。 */
export async function inspectDemandEventSourcingRootInventory(
  root: RootedDirectory,
  options?: {
    readonly phase?: "healthy" | "publication";
    readonly signal?: AbortSignal;
  },
): Promise<Readonly<DemandEventSourcingRootInventory>> {
  if (
    typeof root !== "object"
    || root === null
    || types.isProxy(root)
    || !(root instanceof RootedDirectory)
  ) {
    fail("input", "$root");
  }
  if (
    options !== undefined
    && (
      typeof options !== "object"
      || options === null
      || types.isProxy(options)
      || Object.keys(options).some(
        (key) => key !== "phase" && key !== "signal",
      )
      || (options.signal !== undefined && !(options.signal instanceof AbortSignal))
      || (
        options.phase !== undefined
        && options.phase !== "healthy"
        && options.phase !== "publication"
      )
    )
  ) {
    fail("input", "$options");
  }
  const signal = options?.signal;
  const phase = options?.phase ?? "healthy";
  let before;
  try {
    before = await readStableRootDirectory(root, {
      maximumEntries: 64,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof StableDirectoryReadError) mapReadError(error, "$root");
    throw error;
  }
  assertDirectory(before.directoryNode, "$root");
  exactNames(before, ROOT_NAMES, "$root");
  for (const [index, entry] of before.entries.entries()) {
    if (entry.name === "identity.json" || entry.name === "authority.json") {
      assertFile(entry.node, `$root/${index}`);
    } else {
      assertDirectory(entry.node, `$root/${index}`);
    }
  }

  const eventSourcing = await readResource(
    root,
    DEMAND_EVENT_SOURCING_ROOT_REF,
    64,
    signal,
  );
  assertDirectory(eventSourcing.directoryNode, "$event-sourcing");
  exactNames(eventSourcing, EVENT_SOURCING_NAMES, "$event-sourcing");
  eventSourcing.entries.forEach((entry, index) => {
    assertDirectory(entry.node, `$event-sourcing/${index}`);
  });

  const [candidates, commits, snapshots, artifacts, transactions] =
    await Promise.all([
      readResource(root, DEMAND_EVENT_APPEND_CANDIDATES_ROOT_REF, 0, signal),
      readResource(
        root,
        DEMAND_EVENT_STREAM_COMMITS_ROOT_REF,
        DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMITS,
        signal,
      ),
      readResource(
        root,
        DEMAND_EVENT_SOURCING_SNAPSHOTS_ROOT_REF,
        DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMITS,
        signal,
      ),
      readResource(root, DEMAND_EVENT_SOURCING_ARTIFACTS_ROOT_REF, 0, signal),
      readResource(
        root,
        DEMAND_EVENT_SOURCING_TRANSACTIONS_ROOT_REF,
        phase === "publication" ? 1 : 0,
        signal,
      ),
    ]);
  assertEmpty(candidates, "$append-candidates");
  assertEmpty(artifacts, "$artifacts");
  assertDirectory(transactions.directoryNode, "$transactions");
  if (phase === "healthy") {
    if (transactions.entries.length !== 0) fail("tree-shape", "$transactions");
  } else {
    if (
      transactions.entries.length !== 1
      || transactions.entries[0]?.name !== "publication.json"
    ) {
      fail("tree-shape", "$transactions");
    }
    assertFile(transactions.entries[0].node, "$transactions/publication.json");
  }
  assertDirectory(commits.directoryNode, "$commits");
  assertDirectory(snapshots.directoryNode, "$snapshots");
  commits.entries.forEach((entry, index) => {
    assertFile(entry.node, `$commits/${index}`);
    try {
      const parsed = parseDemandEventStreamCommitFileName(entry.name);
      if (parsed.commitSequence !== index + 1) {
        fail("tree-shape", `$commits/${index}`);
      }
    } catch {
      fail("tree-shape", `$commits/${index}`);
    }
  });
  snapshots.entries.forEach((entry, index) => {
    assertFile(entry.node, `$snapshots/${index}`);
    try {
      parseDemandEventStreamCommitFileName(entry.name);
    } catch {
      fail("tree-shape", `$snapshots/${index}`);
    }
  });

  let after;
  try {
    after = await readStableRootDirectory(root, {
      maximumEntries: 64,
      expectedNode: before.directoryNode,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof StableDirectoryReadError) mapReadError(error, "$root");
    throw error;
  }
  exactNames(after, ROOT_NAMES, "$root");
  return Object.freeze({
    commitCount: commits.entries.length,
    snapshotCount: snapshots.entries.length,
    artifactCount: 0,
    transactionCount: transactions.entries.length as 0 | 1,
    appendCandidateCount: 0,
    nodes: Object.freeze({
      root: after.directoryNode,
      identity: requiredEntryNode(after, "identity.json", "$identity"),
      authority: requiredEntryNode(after, "authority.json", "$authority"),
      eventSourcing: requiredEntryNode(
        after,
        "event-sourcing",
        "$event-sourcing",
      ),
      commits: commits.directoryNode,
      snapshots: snapshots.directoryNode,
      appendCandidates: candidates.directoryNode,
      artifacts: artifacts.directoryNode,
      transactions: transactions.directoryNode,
    }),
  });
}
