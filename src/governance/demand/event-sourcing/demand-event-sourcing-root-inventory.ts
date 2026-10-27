import { types } from "node:util";
import {
  PassiveOwnDataError,
  parsePlainRecord,
} from "../../../foundation/data/passive-own-data.js";
import {
  type DurableAtomicFileStageAddress,
  DurableAtomicFileStageAddressError,
  hasDurableAtomicFileStagePrefix,
  parseDurableAtomicFileStageFileName,
  readDurableAtomicFileStageOwnerState,
} from "../../../foundation/filesystem/durable-atomic-file-stage-address.js";
import {
  type FileNodeSnapshot,
  sameFileNodeSnapshot,
} from "../../../foundation/filesystem/file-node-snapshot.js";
import type { PortableResourcePath } from "../../../foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../foundation/filesystem/rooted-directory.js";
import {
  readStableResourceDirectory,
  readStableRootDirectory,
  StableDirectoryReadError,
  type StableDirectoryReadResult,
} from "../../../foundation/filesystem/stable-directory-read.js";
import {
  inspectManagedEvidenceRecordSetInventory,
  type ManagedEvidenceRecordSetInventory,
  ManagedEvidenceRecordSetInventoryError,
} from "../../evidence/managed-evidence-record-set-inventory.js";
import { MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_FILE_NAME } from "../../evidence/managed-evidence-resource-paths.js";
import {
  parseTaskPackageProjectionFileName,
  TASK_PACKAGE_PROJECTIONS_ROOT_REF,
  TaskPackageProjectionPathError,
} from "../../tasking/task-package-projection-paths.js";
import {
  DEMAND_EVENT_APPEND_CANDIDATES_ROOT_REF,
  DEMAND_EVENT_SOURCING_ARTIFACTS_ROOT_REF,
  DEMAND_EVENT_SOURCING_ROOT_REF,
  DEMAND_EVENT_SOURCING_SNAPSHOTS_ROOT_REF,
  DEMAND_EVENT_SOURCING_TRANSACTIONS_ROOT_REF,
  DEMAND_EVENT_STREAM_COMMITS_ROOT_REF,
  DEMAND_EVENT_STREAM_INDEX_ROOT_REF,
  DEMAND_PERMIT_PROMPT_KINDS,
  DEMAND_PERMIT_PROMPTS_ROOT_REF,
  DemandEventSourcingPathError,
  type DemandPermitPromptKind,
  demandPermitPromptKindRootRef,
  parseDemandEventStreamCommitFileName,
  parseDemandPermitPromptFileName,
  parseDemandPermitPromptKind,
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
 * 健康状态下候选目录与事务目录为空，并对可重建TaskPackage
 * packet投影执行封闭命名和私有节点策略检查。Managed Evidence作为不可变业务内容，
 * 额外通过专用record-set inventory关闭healthy Manifest/顶层，并对当前事务stage/final
 * 执行完整tree分类；与Aggregate selector的关系仍由Root Authority验证。尚未出现真实
 * 消费者的可选投影目录不要求提前存在。快照是可重建缓存：快照目录里 foundation 自己的
 * 原子暂存按写者状态分类（§13.161 B3-2），死写者留下的残留被容忍而不计入快照数，
 * 回收仍交给下一次同目标写入。
 */

export type DemandEventSourcingRootInventoryPhase =
  | "healthy"
  | "demand-publication"
  | "managed-evidence-publication";

export interface DemandEventSourcingRootInventory {
  readonly commitCount: number;
  readonly snapshotCount: number;
  readonly artifactCount: number;
  readonly transactionCount: 0 | 1;
  readonly appendCandidateCount: 0;
  readonly managedEvidence: Readonly<ManagedEvidenceRecordSetInventory>;
  readonly nodes: Readonly<{
    readonly root: Readonly<FileNodeSnapshot>;
    readonly identity: Readonly<FileNodeSnapshot>;
    readonly authority: Readonly<FileNodeSnapshot>;
    readonly eventSourcing: Readonly<FileNodeSnapshot>;
    readonly commits: Readonly<FileNodeSnapshot>;
    readonly snapshots: Readonly<FileNodeSnapshot>;
    readonly index: Readonly<FileNodeSnapshot>;
    readonly appendCandidates: Readonly<FileNodeSnapshot>;
    readonly artifacts: Readonly<FileNodeSnapshot>;
    readonly taskPackages: Readonly<FileNodeSnapshot>;
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
  input: "Demand Event Sourcing root inventory input is invalid.",
  "root-scope": "Demand Event Sourcing root changed during inventory.",
  "tree-shape": "Demand Event Sourcing root contains a missing or unknown resource.",
  "node-policy": "Demand Event Sourcing root resource violates private node policy.",
  capacity: "Demand Event Sourcing root inventory exceeds its capacity.",
  "source-changed": "Demand Event Sourcing root inventory changed during observation.",
  aborted: "Demand Event Sourcing root inventory was aborted.",
  "operation-failure": "Demand Event Sourcing root inventory failed.",
} as const satisfies Readonly<Record<DemandEventSourcingRootInventoryErrorReason, string>>;

export class DemandEventSourcingRootInventoryError extends Error {
  override readonly name = "DemandEventSourcingRootInventoryError";
  readonly code = "wakeflow-demand-event-sourcing-root-inventory" as const;
  readonly reason: DemandEventSourcingRootInventoryErrorReason;
  readonly path: string;

  constructor(reason: DemandEventSourcingRootInventoryErrorReason, path: string) {
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
  "index",
  "snapshots",
] as const);
const ARTIFACT_NAMES = new Set(["managed-evidence", "permits", "task-packages"]);

function fail(reason: DemandEventSourcingRootInventoryErrorReason, path: string): never {
  throw new DemandEventSourcingRootInventoryError(reason, path);
}

function exactNames(
  read: Readonly<StableDirectoryReadResult<PortableResourcePath | null>>,
  names: readonly string[],
  path: string,
): void {
  if (
    read.entries.length !== names.length ||
    read.entries.some((entry, index) => entry.name !== names[index])
  ) {
    fail("tree-shape", path);
  }
}

function assertArtifactNames(
  read: Readonly<StableDirectoryReadResult<PortableResourcePath | null>>,
): void {
  if (
    !read.entries.some((entry) => entry.name === "task-packages") ||
    read.entries.some((entry) => !ARTIFACT_NAMES.has(entry.name))
  ) {
    fail("tree-shape", "$artifacts");
  }
}

function assertDirectory(node: Readonly<FileNodeSnapshot>, path: string): void {
  if (
    node.kind !== "directory" ||
    node.permissionBits !== DEMAND_FILE_EVENT_STORE_DIRECTORY_MODE ||
    (typeof process.geteuid === "function" && node.userId !== BigInt(process.geteuid()))
  ) {
    fail("node-policy", path);
  }
}

function assertFile(node: Readonly<FileNodeSnapshot>, path: string): void {
  if (
    node.kind !== "file" ||
    node.permissionBits !== DEMAND_FILE_EVENT_STORE_FILE_MODE ||
    node.linkCount !== 1n ||
    (typeof process.geteuid === "function" && node.userId !== BigInt(process.geteuid()))
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
    error.reason === "not-found" ||
    error.reason === "symlink" ||
    error.reason === "not-directory"
  ) {
    fail("tree-shape", path);
  }
  fail("operation-failure", path);
}

function mapManagedEvidenceError(error: ManagedEvidenceRecordSetInventoryError): never {
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (error.reason === "root-scope") fail("root-scope", "$root");
  if (error.reason === "capacity") fail("capacity", "$managed-evidence");
  if (error.reason === "source-changed") {
    fail("source-changed", "$managed-evidence");
  }
  if (error.reason === "node-policy") {
    fail("node-policy", "$managed-evidence");
  }
  if (
    error.reason === "tree-shape" ||
    error.reason === "transaction" ||
    error.reason === "record"
  ) {
    fail("tree-shape", "$managed-evidence");
  }
  fail("operation-failure", "$managed-evidence");
}

async function readResource(
  root: RootedDirectory,
  ref: PortableResourcePath,
  maximumEntries: number,
  signal: AbortSignal | undefined,
  expectedNode?: Readonly<FileNodeSnapshot>,
): Promise<Readonly<StableDirectoryReadResult<PortableResourcePath>>> {
  try {
    return await readStableResourceDirectory(root, ref, {
      maximumEntries,
      ...(expectedNode === undefined ? {} : { expectedNode }),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof StableDirectoryReadError) mapReadError(error, `$${ref}`);
    throw error;
  }
}

function parseOptions(value: unknown): Readonly<{
  readonly phase: DemandEventSourcingRootInventoryPhase;
  readonly signal: AbortSignal | undefined;
}> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value === undefined ? {} : value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }
  if (
    Object.keys(record).some((key) => key !== "phase" && key !== "signal") ||
    (record.signal !== undefined &&
      (typeof record.signal !== "object" ||
        record.signal === null ||
        types.isProxy(record.signal) ||
        !(record.signal instanceof AbortSignal))) ||
    (record.phase !== undefined &&
      record.phase !== "healthy" &&
      record.phase !== "demand-publication" &&
      record.phase !== "managed-evidence-publication")
  ) {
    fail("input", "$options");
  }
  return Object.freeze({
    phase:
      record.phase === "demand-publication" || record.phase === "managed-evidence-publication"
        ? record.phase
        : "healthy",
    signal: record.signal as AbortSignal | undefined,
  });
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

function optionalEntryNode(
  read: Readonly<StableDirectoryReadResult<PortableResourcePath | null>>,
  name: string,
): Readonly<FileNodeSnapshot> | undefined {
  return read.entries.find((candidate) => candidate.name === name)?.node;
}

function permitPromptKind(name: string, path: string): DemandPermitPromptKind {
  try {
    return parseDemandPermitPromptKind(name);
  } catch (error: unknown) {
    if (error instanceof DemandEventSourcingPathError) fail("tree-shape", path);
    throw error;
  }
}

/** 可选的许可 prompt 工件（K6）：两类子目录各装以 target-delivery 身份命名的 `.txt`；别的形状都是 tree-shape。 */
async function inspectPermitPrompts(
  root: RootedDirectory,
  artifacts: Readonly<StableDirectoryReadResult<PortableResourcePath | null>>,
  signal: AbortSignal | undefined,
): Promise<number> {
  const permitsNode = optionalEntryNode(artifacts, "permits");
  if (permitsNode === undefined) return 0;
  const permits = await readResource(
    root,
    DEMAND_PERMIT_PROMPTS_ROOT_REF,
    DEMAND_PERMIT_PROMPT_KINDS.length,
    signal,
    permitsNode,
  );
  assertDirectory(permits.directoryNode, "$permits");
  let count = 0;
  for (const [kindIndex, entry] of permits.entries.entries()) {
    const kind = permitPromptKind(entry.name, `$permits/${kindIndex}`);
    assertDirectory(entry.node, `$permits/${kind}`);
    const prompts = await readResource(
      root,
      demandPermitPromptKindRootRef(kind),
      DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMITS,
      signal,
      entry.node,
    );
    assertDirectory(prompts.directoryNode, `$permits/${kind}`);
    prompts.entries.forEach((prompt, index) => {
      assertFile(prompt.node, `$permits/${kind}/${index}`);
      try {
        parseDemandPermitPromptFileName(prompt.name);
      } catch (error: unknown) {
        if (error instanceof DemandEventSourcingPathError) {
          fail("tree-shape", `$permits/${kind}/${index}`);
        }
        throw error;
      }
    });
    count += prompts.entries.length;
  }
  return count;
}

/**
 * 快照目录里 foundation 自己的原子暂存文件不是快照，也不是未知资源（§13.161 B3-2 的同一分类）：
 * 写者还活着 → 一次检查点正在落盘，按 source-changed 让调用方稍后重来；写者已死 → 残留由下一次
 * 同目标写入回收，这里容忍、不计入快照数也不删除；所有者未知或名字畸形 → 仍按 tree-shape 拒绝。
 */
function isToleratedSnapshotStageResidue(name: string, path: string): boolean {
  if (!hasDurableAtomicFileStagePrefix(name)) return false;
  let stage: Readonly<DurableAtomicFileStageAddress>;
  try {
    stage = parseDurableAtomicFileStageFileName(name);
  } catch (error: unknown) {
    if (error instanceof DurableAtomicFileStageAddressError) fail("tree-shape", path);
    throw error;
  }
  const owner = readDurableAtomicFileStageOwnerState(stage);
  if (owner === "active") fail("source-changed", path);
  if (owner === "unknown") fail("tree-shape", path);
  return true;
}

/** 稳定证明一个 normal-load Demand root 的完整允许集合。 */
export async function inspectDemandEventSourcingRootInventory(
  root: RootedDirectory,
  options?: {
    readonly phase?: DemandEventSourcingRootInventoryPhase;
    readonly signal?: AbortSignal;
  },
): Promise<Readonly<DemandEventSourcingRootInventory>> {
  if (
    typeof root !== "object" ||
    root === null ||
    types.isProxy(root) ||
    !(root instanceof RootedDirectory)
  ) {
    fail("input", "$root");
  }
  const { phase, signal } = parseOptions(options);
  let before: Awaited<ReturnType<typeof readStableRootDirectory>>;
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
    requiredEntryNode(before, "event-sourcing", "$event-sourcing"),
  );
  assertDirectory(eventSourcing.directoryNode, "$event-sourcing");
  exactNames(eventSourcing, EVENT_SOURCING_NAMES, "$event-sourcing");
  eventSourcing.entries.forEach((entry, index) => {
    assertDirectory(entry.node, `$event-sourcing/${index}`);
  });

  const candidates = await readResource(
    root,
    DEMAND_EVENT_APPEND_CANDIDATES_ROOT_REF,
    1,
    signal,
    requiredEntryNode(eventSourcing, "append-candidates", "$append-candidates"),
  );
  const commits = await readResource(
    root,
    DEMAND_EVENT_STREAM_COMMITS_ROOT_REF,
    DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMITS,
    signal,
    requiredEntryNode(eventSourcing, "commits", "$commits"),
  );
  const snapshots = await readResource(
    root,
    DEMAND_EVENT_SOURCING_SNAPSHOTS_ROOT_REF,
    DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMITS,
    signal,
    requiredEntryNode(eventSourcing, "snapshots", "$snapshots"),
  );
  const indexes = await readResource(
    root,
    DEMAND_EVENT_STREAM_INDEX_ROOT_REF,
    DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMITS,
    signal,
    requiredEntryNode(eventSourcing, "index", "$index"),
  );
  const artifacts = await readResource(
    root,
    DEMAND_EVENT_SOURCING_ARTIFACTS_ROOT_REF,
    ARTIFACT_NAMES.size + 1,
    signal,
    requiredEntryNode(before, "artifacts", "$artifacts"),
  );
  assertDirectory(artifacts.directoryNode, "$artifacts");
  assertArtifactNames(artifacts);
  const taskPackagesNode = requiredEntryNode(artifacts, "task-packages", "$task-packages");
  assertDirectory(taskPackagesNode, "$task-packages");
  const taskPackages = await readResource(
    root,
    TASK_PACKAGE_PROJECTIONS_ROOT_REF,
    DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMITS,
    signal,
    taskPackagesNode,
  );
  const managedEvidenceNode = optionalEntryNode(artifacts, "managed-evidence");
  const transactions = await readResource(
    root,
    DEMAND_EVENT_SOURCING_TRANSACTIONS_ROOT_REF,
    1,
    signal,
    requiredEntryNode(before, "transactions", "$transactions"),
  );
  assertEmpty(candidates, "$append-candidates");
  assertDirectory(taskPackages.directoryNode, "$task-packages");
  taskPackages.entries.forEach((entry, index) => {
    assertFile(entry.node, `$task-packages/${index}`);
    try {
      parseTaskPackageProjectionFileName(entry.name);
    } catch (error: unknown) {
      if (error instanceof TaskPackageProjectionPathError) {
        fail("tree-shape", `$task-packages/${index}`);
      }
      throw error;
    }
  });
  const permitCount = await inspectPermitPrompts(root, artifacts, signal);
  assertDirectory(transactions.directoryNode, "$transactions");
  let managedEvidenceTransactionNode: Readonly<FileNodeSnapshot> | undefined;
  if (phase === "healthy") {
    if (transactions.entries.length !== 0) fail("tree-shape", "$transactions");
  } else if (phase === "demand-publication") {
    if (transactions.entries.length !== 1 || transactions.entries[0]?.name !== "publication.json") {
      fail("tree-shape", "$transactions");
    }
    assertFile(transactions.entries[0].node, "$transactions/publication.json");
    if (managedEvidenceNode !== undefined) {
      fail("tree-shape", "$managed-evidence");
    }
  } else {
    if (
      transactions.entries.length !== 1 ||
      transactions.entries[0]?.name !== MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_FILE_NAME
    ) {
      fail("tree-shape", "$transactions");
    }
    managedEvidenceTransactionNode = transactions.entries[0].node;
    assertFile(managedEvidenceTransactionNode, "$transactions/managed-evidence-publication.json");
  }
  let managedEvidence: Readonly<ManagedEvidenceRecordSetInventory>;
  try {
    managedEvidence = await inspectManagedEvidenceRecordSetInventory(root, {
      ...(managedEvidenceNode === undefined ? {} : { expectedRootNode: managedEvidenceNode }),
      ...(managedEvidenceTransactionNode === undefined
        ? {}
        : { expectedTransactionNode: managedEvidenceTransactionNode }),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof ManagedEvidenceRecordSetInventoryError) {
      mapManagedEvidenceError(error);
    }
    throw error;
  }
  assertDirectory(commits.directoryNode, "$commits");
  assertDirectory(snapshots.directoryNode, "$snapshots");
  commits.entries.forEach((entry, index) => {
    assertFile(entry.node, `$commits/${index}`);
    let parsed: ReturnType<typeof parseDemandEventStreamCommitFileName>;
    try {
      parsed = parseDemandEventStreamCommitFileName(entry.name);
    } catch (error: unknown) {
      if (error instanceof DemandEventSourcingPathError) {
        fail("tree-shape", `$commits/${index}`);
      }
      throw error;
    }
    if (parsed.commitSequence !== index + 1) {
      fail("tree-shape", `$commits/${index}`);
    }
  });
  let snapshotCount = 0;
  snapshots.entries.forEach((entry, index) => {
    assertFile(entry.node, `$snapshots/${index}`);
    if (isToleratedSnapshotStageResidue(entry.name, `$snapshots/${index}`)) return;
    try {
      parseDemandEventStreamCommitFileName(entry.name);
    } catch (error: unknown) {
      if (error instanceof DemandEventSourcingPathError) {
        fail("tree-shape", `$snapshots/${index}`);
      }
      throw error;
    }
    snapshotCount += 1;
  });
  assertDirectory(indexes.directoryNode, "$index");
  indexes.entries.forEach((entry, index) => {
    assertFile(entry.node, `$index/${index}`);
    try {
      parseDemandEventStreamCommitFileName(entry.name);
    } catch (error: unknown) {
      if (error instanceof DemandEventSourcingPathError) {
        fail("tree-shape", `$index/${index}`);
      }
      throw error;
    }
  });

  let after: Awaited<ReturnType<typeof readStableRootDirectory>>;
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
  if (
    !sameFileNodeSnapshot(
      eventSourcing.directoryNode,
      requiredEntryNode(after, "event-sourcing", "$event-sourcing"),
    ) ||
    !sameFileNodeSnapshot(
      artifacts.directoryNode,
      requiredEntryNode(after, "artifacts", "$artifacts"),
    ) ||
    !sameFileNodeSnapshot(
      transactions.directoryNode,
      requiredEntryNode(after, "transactions", "$transactions"),
    )
  ) {
    fail("source-changed", "$root");
  }
  return Object.freeze({
    commitCount: commits.entries.length,
    snapshotCount,
    artifactCount: taskPackages.entries.length + managedEvidence.recordCount + permitCount,
    transactionCount: transactions.entries.length as 0 | 1,
    appendCandidateCount: 0,
    managedEvidence,
    nodes: Object.freeze({
      root: after.directoryNode,
      identity: requiredEntryNode(after, "identity.json", "$identity"),
      authority: requiredEntryNode(after, "authority.json", "$authority"),
      eventSourcing: requiredEntryNode(after, "event-sourcing", "$event-sourcing"),
      commits: commits.directoryNode,
      snapshots: snapshots.directoryNode,
      index: indexes.directoryNode,
      appendCandidates: candidates.directoryNode,
      artifacts: artifacts.directoryNode,
      taskPackages: taskPackages.directoryNode,
      transactions: transactions.directoryNode,
    }),
  });
}
