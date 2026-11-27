import { type Fail, failWith, ModuleError } from "../../../foundation/error/module-error.js";
import {
  type FileNodeSnapshot,
  sameFileNodeSnapshot,
} from "../../../foundation/filesystem/file-node-snapshot.js";
import type { PortableResourcePath } from "../../../foundation/filesystem/portable-resource-path.js";
import {
  isPrivateDirectory,
  isPrivateFile,
} from "../../../foundation/filesystem/private-node-policy.js";
import type { RootedDirectory } from "../../../foundation/filesystem/rooted-directory.js";
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
  DEMAND_FILE_EVENT_STORE_FILE_MODE,
  DEMAND_FILE_EVENT_STORE_MAXIMUM_COMMITS,
} from "./demand-file-event-store.js";
import { classifyDemandStageDirectory, DemandStageDirectoryError } from "./demand-stage-residue.js";

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
  | "operation-failure";

export class DemandEventSourcingRootInventoryError extends ModuleError<DemandEventSourcingRootInventoryErrorReason> {
  static override readonly code = "wakeflow-demand-event-sourcing-root-inventory";
}

const fail: Fail<DemandEventSourcingRootInventoryErrorReason> = failWith(
  DemandEventSourcingRootInventoryError,
);

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
  if (!isPrivateDirectory(node)) fail("node-policy", path);
}

function assertFile(node: Readonly<FileNodeSnapshot>, path: string): void {
  if (!isPrivateFile(node)) fail("node-policy", path);
}

function mapReadError(error: StableDirectoryReadError, path: string): never {
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
  fail("operation-failure", path, error);
}

function mapManagedEvidenceError(error: ManagedEvidenceRecordSetInventoryError): never {
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
  fail("operation-failure", "$managed-evidence", error);
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
    if (error instanceof DemandEventSourcingPathError) fail("tree-shape", path, error);
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
          fail("tree-shape", `$permits/${kind}/${index}`, error);
        }
        throw error;
      }
    });
    count += prompts.entries.length;
  }
  return count;
}

/**
 * `index/`、`snapshots/` 与 `task-packages/` 的成员（1.4.1 段 1b）：这三个目录的文件经原子写入建成，死掉的
 * 写者留下的暂存文件、以及与暂存共用一个节点的目标，按 `classifyDemandStageDirectory` 的规则放行：暂存
 * 文件不算成员，成对的目标照常算成员（照常被读、被计数），两样都不删除（清除归工作区维护的
 * reconcile）。写者还活着是 `source-changed`，调用方稍后重来；认不出的形状仍按 `tree-shape` 或
 * `node-policy` 拒绝。其余目录没有这条放行。
 */
function stageDirectoryMembers(
  read: Readonly<StableDirectoryReadResult<PortableResourcePath | null>>,
  path: string,
) {
  try {
    return classifyDemandStageDirectory(read.entries, DEMAND_FILE_EVENT_STORE_FILE_MODE).members;
  } catch (error: unknown) {
    if (error instanceof DemandStageDirectoryError) {
      fail(error.reason, `${path}/${error.index}`, error);
    }
    throw error;
  }
}

/** 稳定证明一个 normal-load Demand root 的完整允许集合。 */
export async function inspectDemandEventSourcingRootInventory(
  root: RootedDirectory,
  options: {
    readonly phase?: DemandEventSourcingRootInventoryPhase;
    readonly signal?: AbortSignal;
  } = {},
): Promise<Readonly<DemandEventSourcingRootInventory>> {
  const { phase = "healthy", signal } = options;
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
  const taskPackageMembers = stageDirectoryMembers(taskPackages, "$task-packages");
  taskPackageMembers.forEach((entry, index) => {
    try {
      parseTaskPackageProjectionFileName(entry.name);
    } catch (error: unknown) {
      if (error instanceof TaskPackageProjectionPathError) {
        fail("tree-shape", `$task-packages/${index}`, error);
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
        fail("tree-shape", `$commits/${index}`, error);
      }
      throw error;
    }
    if (parsed.commitSequence !== index + 1) {
      fail("tree-shape", `$commits/${index}`);
    }
  });
  const snapshotMembers = stageDirectoryMembers(snapshots, "$snapshots");
  snapshotMembers.forEach((entry, index) => {
    try {
      parseDemandEventStreamCommitFileName(entry.name);
    } catch (error: unknown) {
      if (error instanceof DemandEventSourcingPathError) {
        fail("tree-shape", `$snapshots/${index}`, error);
      }
      throw error;
    }
  });
  assertDirectory(indexes.directoryNode, "$index");
  stageDirectoryMembers(indexes, "$index").forEach((entry, index) => {
    try {
      parseDemandEventStreamCommitFileName(entry.name);
    } catch (error: unknown) {
      if (error instanceof DemandEventSourcingPathError) {
        fail("tree-shape", `$index/${index}`, error);
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
    snapshotCount: snapshotMembers.length,
    artifactCount: taskPackageMembers.length + managedEvidence.recordCount + permitCount,
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
