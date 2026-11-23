import { types } from "node:util";

import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import {
  DurableAtomicFileStageAddressError,
  hasDurableAtomicFileStagePrefix,
  parseDurableAtomicFileStageFileName,
  readDurableAtomicFileStageOwnerState,
} from "../../foundation/filesystem/durable-atomic-file-stage-address.js";
import type { FileNodeSnapshot } from "../../foundation/filesystem/file-node-snapshot.js";
import type { PortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import {
  isRootedDirectory,
  type RootedDirectory,
  RootedDirectoryError,
  type RootedResourceSnapshot,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  inspectRootedExclusiveFileLock,
  RootedExclusiveFileLockError,
} from "../../foundation/filesystem/rooted-exclusive-file-lock.js";
import { isRootedReadWriteScopeLockName } from "../../foundation/filesystem/rooted-read-write-scope.js";
import {
  readStableResourceDirectory,
  type StableDirectoryEntry,
  StableDirectoryReadError,
  type StableDirectoryReadResult,
} from "../../foundation/filesystem/stable-directory-read.js";
import { ownedByAnotherUser, requireCurrentUserId } from "../../foundation/node/current-user.js";
import { inspectActiveLayout } from "../../kernel/active-projection.js";
import { WakeflowError } from "../../kernel/error.js";
import {
  parseWakeflowMaintenanceOperationId,
  WakeflowMaintenanceOperationIdError,
} from "./wakeflow-maintenance-operation-id.js";
import {
  WAKEFLOW_LOCAL_ROOT_REF,
  WAKEFLOW_MAINTENANCE_GATE_REF,
  WAKEFLOW_MAINTENANCE_ROOT_REF,
  WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_REF,
  WAKEFLOW_RUNTIME_ROOT_REF,
} from "./wakeflow-maintenance-resource-catalog.js";

/**
 * Wakeflow Workspace / Maintenance：Workspace 核心私有布局的只读稳定检查。
 *
 * 本模块只分类 Active 两级共享布局和 Local maintenance 协议，不清理、不创建目录，也不解释
 * transaction 文件内容。Local 的 freshCompatible 仅在路径是 `local → runtime →
 * maintenance → transactions` 的任意空前缀、所有已有目录均为当前用户 `0700`，且无
 * gate/stage/intent/其他条目时为 true。
 *
 * 已安装 workspace 可以在 Local/Runtime 中包含其他领域 owner 的资源；这些资源不会
 * 被 fresh 采用，但在完整 maintenance protocol 为 idle 时不构成运行期冲突。
 */

/** `incomplete`：`.wakeflow-active` 在而 `current/` 不在，可由维护 ensure 补齐；`conflict` 只报告。 */
type WakeflowActiveRootStatus = "absent" | "present" | "incomplete" | "conflict";
type WakeflowLocalProtocolStatus =
  | "absent"
  | "bootstrap-prefix"
  | "idle"
  | "busy"
  | "recovery-required"
  | "conflict";

/**
 * `transactions` 目录里的一个条目（§13.130）：按 intent 的命名约定（`<operationId>.intent.json`）
 * 分类；名字不合约定、或 operation ID 不是 `maintenance_operation_<uuid>` 的都是 `unknown`，维护
 * recover 按 operation ID 找不到它们。1.4 起一次维护只有 intent 这一个文件（ADR-0031，5a 的 C 行）；
 * 1.3 留下的 `<operationId>.journal.json` 因此也是 `unknown`。本检查不读条目内容。
 */
export interface WakeflowMaintenanceResidue {
  readonly name: string;
  readonly kind: "intent" | "unknown";
  readonly operationId: string | null;
}

export interface WakeflowWorkspaceCoreLayoutInspection {
  readonly active: Readonly<{
    readonly status: WakeflowActiveRootStatus;
    readonly nodeDigest: Sha256Digest | null;
  }>;
  readonly local: Readonly<{
    readonly status: WakeflowLocalProtocolStatus;
    readonly freshCompatible: boolean;
    readonly protocolComplete: boolean;
    /** `transactions` 目录里的条目，按名字排序；目录不在或没读到那一层时为空。 */
    readonly residues: readonly Readonly<WakeflowMaintenanceResidue>[];
    readonly nodeDigest: Sha256Digest | null;
    readonly protocolDigest: Sha256Digest | null;
  }>;
  readonly issueCodes: readonly string[];
  readonly inspectionDigest: Sha256Digest;
}

interface WakeflowWorkspaceCoreLayoutInspectionOptions {
  readonly signal?: AbortSignal;
}

export type WakeflowWorkspaceCoreLayoutInspectionErrorReason =
  | "input"
  | "root-scope"
  | "capacity"
  | "source-changed"
  | "inspection"
  | "aborted";

const ERROR_MESSAGES = {
  input: "Wakeflow workspace core layout inspection input is invalid.",
  "root-scope": "Wakeflow workspace root changed during layout inspection.",
  capacity: "Wakeflow workspace core layout exceeds its inspection budget.",
  "source-changed": "Wakeflow workspace core layout changed during inspection.",
  inspection: "Wakeflow workspace core layout could not be inspected safely.",
  aborted: "Wakeflow workspace core layout inspection was aborted.",
} as const satisfies Readonly<Record<WakeflowWorkspaceCoreLayoutInspectionErrorReason, string>>;

/** 核心私有布局检查失败的稳定、脱敏错误。 */
export class WakeflowWorkspaceCoreLayoutInspectionError extends Error {
  override readonly name = "WakeflowWorkspaceCoreLayoutInspectionError";
  readonly code = "wakeflow-workspace-core-layout-inspection" as const;
  readonly reason: WakeflowWorkspaceCoreLayoutInspectionErrorReason;
  readonly path: string;

  constructor(
    reason: WakeflowWorkspaceCoreLayoutInspectionErrorReason,
    path: string,
    options?: ErrorOptions,
  ) {
    super(ERROR_MESSAGES[reason], options);
    this.reason = reason;
    this.path = path;
  }
}

const MAXIMUM_PROTOCOL_ENTRIES = 4_096;

function fail(
  reason: WakeflowWorkspaceCoreLayoutInspectionErrorReason,
  path: string,
  cause?: unknown,
): never {
  throw new WakeflowWorkspaceCoreLayoutInspectionError(
    reason,
    path,
    cause === undefined ? undefined : { cause },
  );
}

function parseSignal(value: unknown): AbortSignal | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "object" ||
    value === null ||
    types.isProxy(value) ||
    !(value instanceof AbortSignal)
  ) {
    fail("input", "$options.signal");
  }
  return value;
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) fail("aborted", "$signal");
}

function assertRoot(value: unknown): asserts value is RootedDirectory {
  if (!isRootedDirectory(value)) fail("input", "$root");
}

function currentUserId(): bigint {
  return requireCurrentUserId(() => fail("inspection", "$root"));
}

function nodeDigest(node: Readonly<FileNodeSnapshot>): Sha256Digest {
  return computeCanonicalJsonSha256Digest({
    kind: node.kind,
    deviceId: node.deviceId.toString(),
    inodeId: node.inodeId.toString(),
    rawMode: node.rawMode.toString(),
    permissionBits: node.permissionBits,
    linkCount: node.linkCount.toString(),
    userId: node.userId.toString(),
    groupId: node.groupId.toString(),
    specialDeviceId: node.specialDeviceId.toString(),
    byteCount: node.byteCount,
    modifiedAtNanoseconds: node.modifiedAtNanoseconds.toString(),
    changedAtNanoseconds: node.changedAtNanoseconds.toString(),
  });
}

function directoryDigest(read: Readonly<StableDirectoryReadResult>): Sha256Digest {
  return computeCanonicalJsonSha256Digest({
    nodeDigest: nodeDigest(read.directoryNode),
    entries: read.entries.map((entry) => ({
      name: entry.name,
      nodeDigest: nodeDigest(entry.node),
    })),
  });
}

function validPrivateDirectory(node: Readonly<FileNodeSnapshot>): boolean {
  return (
    node.kind === "directory" && node.permissionBits === 0o700 && node.userId === currentUserId()
  );
}

async function optionalResource(
  root: RootedDirectory,
  resourcePath: Parameters<RootedDirectory["inspectExistingResource"]>[0],
): Promise<Readonly<RootedResourceSnapshot> | null> {
  try {
    return await root.inspectExistingResource(resourcePath, "$resourcePath");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError && error.reason === "resource-not-found") {
      return null;
    }
    if (error instanceof RootedDirectoryError) fail("root-scope", "$root", error);
    throw error;
  }
}

async function readDirectory(
  root: RootedDirectory,
  resourcePath: Parameters<typeof readStableResourceDirectory>[1],
  signal: AbortSignal | undefined,
): Promise<Readonly<StableDirectoryReadResult>> {
  try {
    return await readStableResourceDirectory(root, resourcePath, {
      maximumEntries: MAXIMUM_PROTOCOL_ENTRIES,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof StableDirectoryReadError) {
      if (error.reason === "aborted") fail("aborted", "$signal", error);
      if (error.reason === "too-many-entries") fail("capacity", "$entries", error);
      if (error.reason === "source-changed") {
        fail("source-changed", "$resourcePath", error);
      }
      if (error.reason === "root-scope" || error.reason === "expectation-changed") {
        fail("root-scope", "$root", error);
      }
      fail("inspection", "$resourcePath", error);
    }
    throw error;
  }
}

async function inspectActive(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<
  Readonly<{
    readonly status: WakeflowActiveRootStatus;
    readonly nodeDigest: Sha256Digest | null;
  }>
> {
  try {
    const inspection = await inspectActiveLayout(root, signal === undefined ? {} : { signal });
    return Object.freeze({
      status:
        inspection.status === "absent"
          ? ("absent" as const)
          : inspection.status === "current"
            ? ("present" as const)
            : inspection.status === "incomplete"
              ? ("incomplete" as const)
              : ("conflict" as const),
      nodeDigest: inspection.status === "absent" ? null : inspection.observationDigest,
    });
  } catch (error: unknown) {
    if (error instanceof WakeflowError) {
      if (error.reason === "aborted") fail("aborted", "$signal", error);
      if (error.reason === "active-layout-root-scope") fail("root-scope", "$root", error);
      fail("inspection", "$activeLayout", error);
    }
    throw error;
  }
}

function entryNamed(read: Readonly<StableDirectoryReadResult>, name: string) {
  return read.entries.find((entry) => entry.name === name) ?? null;
}

const NO_MAINTENANCE_RESIDUES: readonly Readonly<WakeflowMaintenanceResidue>[] = Object.freeze([]);
const RESIDUE_NAME_PATTERN = /^(.+)\.intent\.json$/u;

function maintenanceResidue(name: string): Readonly<WakeflowMaintenanceResidue> {
  const match = RESIDUE_NAME_PATTERN.exec(name);
  const candidate = match?.[1];
  if (candidate !== undefined) {
    try {
      return Object.freeze({
        name,
        kind: "intent" as const,
        operationId: parseWakeflowMaintenanceOperationId(candidate),
      });
    } catch (error: unknown) {
      if (!(error instanceof WakeflowMaintenanceOperationIdError)) throw error;
    }
  }
  return Object.freeze({ name, kind: "unknown" as const, operationId: null });
}

/** 残留条目按名字排序分类；只看名字，不读内容。 */
function maintenanceResidues(
  names: readonly string[],
): readonly Readonly<WakeflowMaintenanceResidue>[] {
  return Object.freeze([...names].sort().map(maintenanceResidue));
}

type GateLockState = "absent" | "active" | "inactive-or-unknown" | "unsafe";

// An unsafe gate is a conflict whether or not the maintenance directories exist.
function prefixProtocolStatus(
  lockState: GateLockState,
  stagePresent: boolean,
): WakeflowLocalProtocolStatus {
  if (lockState === "unsafe") return "conflict";
  if (lockState === "active") return "busy";
  return lockState !== "absent" || stagePresent ? "recovery-required" : "bootstrap-prefix";
}

/** 准入目录里的一个条目是不是确定由死掉的进程留下的：本协议的锁文件或 create 暂存，所有者已不在。 */
async function deadAdmissionEntry(
  root: RootedDirectory,
  entry: Readonly<StableDirectoryEntry>,
): Promise<boolean> {
  const node = entry.node;
  if (node.kind !== "file" || node.permissionBits !== 0o600 || ownedByAnotherUser(node.userId)) {
    return false;
  }
  if (isRootedReadWriteScopeLockName(entry.name)) {
    try {
      const lock = await inspectRootedExclusiveFileLock(root, entry.resourcePath);
      return lock.status === "absent" || lock.ownerState === "inactive";
    } catch (error: unknown) {
      if (!(error instanceof RootedExclusiveFileLockError)) throw error;
      if (error.reason === "aborted") fail("aborted", "$signal", error);
      return false;
    }
  }
  if (!hasDurableAtomicFileStagePrefix(entry.name)) return false;
  try {
    const stage = parseDurableAtomicFileStageFileName(entry.name);
    return (
      stage.operation === "create" &&
      stage.mode === 0o600 &&
      readDurableAtomicFileStageOwnerState(stage, node) === "inactive"
    );
  } catch (error: unknown) {
    if (error instanceof DurableAtomicFileStageAddressError) return false;
    throw error;
  }
}

/**
 * 操作准入目录里是不是只有死掉的进程留下的东西（1.4.1 段 1b，清单第 3 项第 3 行）。全新初始化的应用死在
 * 独占范围里，会留下写者锁与准入闩；以前目录里只要有任何条目就不算全新，于是那次初始化再也预览不出来，
 * 而能收掉这些锁的正是它自己——应用在维护闩之下进入独占范围时，准入会退役死掉的闩、写者锁、读者租约
 * 与 create 暂存。这里只读、不删；认的是那个准入认的同一个封闭集合，活着的、判断不出的、不认识的条目
 * 都照旧算不兼容。
 */
async function admissionHoldsOnlyDeadResidue(
  root: RootedDirectory,
  admissionRef: PortableResourcePath,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  const contents = await readDirectory(root, admissionRef, signal);
  for (const entry of contents.entries) {
    if (!(await deadAdmissionEntry(root, entry))) return false;
  }
  return true;
}

async function inspectLocal(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
  issueCodes: string[],
): Promise<WakeflowWorkspaceCoreLayoutInspection["local"]> {
  const localResource = await optionalResource(root, WAKEFLOW_LOCAL_ROOT_REF);
  if (localResource === null) {
    return Object.freeze({
      status: "absent",
      freshCompatible: true,
      protocolComplete: false,
      residues: NO_MAINTENANCE_RESIDUES,
      nodeDigest: null,
      protocolDigest: null,
    });
  }
  const localNodeDigest = nodeDigest(localResource.node);
  if (!validPrivateDirectory(localResource.node)) {
    issueCodes.push("local-root-node-policy");
    return Object.freeze({
      status: "conflict",
      freshCompatible: false,
      protocolComplete: false,
      residues: NO_MAINTENANCE_RESIDUES,
      nodeDigest: localNodeDigest,
      protocolDigest: null,
    });
  }
  const local = await readDirectory(root, WAKEFLOW_LOCAL_ROOT_REF, signal);
  let freshCompatible = local.entries.every((entry) => entry.name === "runtime");
  const runtimeEntry = entryNamed(local, "runtime");
  if (runtimeEntry === null) {
    return Object.freeze({
      status: local.entries.length === 0 ? "bootstrap-prefix" : "conflict",
      freshCompatible: local.entries.length === 0,
      protocolComplete: false,
      residues: NO_MAINTENANCE_RESIDUES,
      nodeDigest: localNodeDigest,
      protocolDigest: directoryDigest(local),
    });
  }
  if (!validPrivateDirectory(runtimeEntry.node)) {
    issueCodes.push("runtime-root-node-policy");
    return Object.freeze({
      status: "conflict",
      freshCompatible: false,
      protocolComplete: false,
      residues: NO_MAINTENANCE_RESIDUES,
      nodeDigest: localNodeDigest,
      protocolDigest: directoryDigest(local),
    });
  }
  const runtime = await readDirectory(root, WAKEFLOW_RUNTIME_ROOT_REF, signal);
  // `incidents` 是边界诊断的可丢弃落点（§13.166 G1）：它的存在不说明工作区已被使用，不影响 fresh 兼容。
  if (
    runtime.entries.some(
      (entry) =>
        entry.name !== "maintenance" &&
        entry.name !== "operation-admission" &&
        entry.name !== "incidents",
    )
  ) {
    freshCompatible = false;
  }
  const admission = entryNamed(runtime, "operation-admission");
  if (admission !== null) {
    if (!validPrivateDirectory(admission.node)) freshCompatible = false;
    else if (!(await admissionHoldsOnlyDeadResidue(root, admission.resourcePath, signal))) {
      freshCompatible = false;
    }
  }
  const stagePresent = runtime.entries.some((entry) => hasDurableAtomicFileStagePrefix(entry.name));
  if (stagePresent) issueCodes.push("maintenance-gate-stage-residue");
  const maintenanceEntry = entryNamed(runtime, "maintenance");
  let lockState: GateLockState = "absent";
  try {
    const lock = await inspectRootedExclusiveFileLock(root, WAKEFLOW_MAINTENANCE_GATE_REF);
    if (lock.status === "held") {
      lockState = lock.ownerState === "active" ? "active" : "inactive-or-unknown";
      freshCompatible = false;
    }
  } catch (error: unknown) {
    if (!(error instanceof RootedExclusiveFileLockError)) throw error;
    if (error.reason === "aborted") fail("aborted", "$signal", error);
    if (error.reason === "root-scope") fail("root-scope", "$root", error);
    if (error.reason === "unsafe-lock") {
      lockState = "unsafe";
      freshCompatible = false;
    } else if (error.reason === "residue-changed") {
      lockState = "inactive-or-unknown";
      freshCompatible = false;
    } else {
      fail("inspection", "$gate", error);
    }
  }
  if (lockState === "unsafe") issueCodes.push("maintenance-gate-unsafe");
  if (maintenanceEntry === null) {
    const status = prefixProtocolStatus(lockState, stagePresent);
    return Object.freeze({
      status,
      freshCompatible: freshCompatible && status === "bootstrap-prefix",
      protocolComplete: false,
      residues: NO_MAINTENANCE_RESIDUES,
      nodeDigest: localNodeDigest,
      protocolDigest: computeCanonicalJsonSha256Digest({
        local: directoryDigest(local),
        runtime: directoryDigest(runtime),
        lockState,
      }),
    });
  }
  if (!validPrivateDirectory(maintenanceEntry.node)) {
    issueCodes.push("maintenance-root-node-policy");
    return Object.freeze({
      status: "conflict",
      freshCompatible: false,
      protocolComplete: false,
      residues: NO_MAINTENANCE_RESIDUES,
      nodeDigest: localNodeDigest,
      protocolDigest: directoryDigest(runtime),
    });
  }
  const maintenance = await readDirectory(root, WAKEFLOW_MAINTENANCE_ROOT_REF, signal);
  if (maintenance.entries.some((entry) => entry.name !== "transactions")) {
    issueCodes.push("maintenance-root-unknown-entry");
    return Object.freeze({
      status: "conflict",
      freshCompatible: false,
      protocolComplete: false,
      residues: NO_MAINTENANCE_RESIDUES,
      nodeDigest: localNodeDigest,
      protocolDigest: directoryDigest(maintenance),
    });
  }
  const transactionsEntry = entryNamed(maintenance, "transactions");
  if (transactionsEntry === null) {
    const status = prefixProtocolStatus(lockState, stagePresent);
    return Object.freeze({
      status,
      freshCompatible: freshCompatible && status === "bootstrap-prefix",
      protocolComplete: false,
      residues: NO_MAINTENANCE_RESIDUES,
      nodeDigest: localNodeDigest,
      protocolDigest: computeCanonicalJsonSha256Digest({
        local: directoryDigest(local),
        runtime: directoryDigest(runtime),
        maintenance: directoryDigest(maintenance),
        lockState,
      }),
    });
  }
  if (!validPrivateDirectory(transactionsEntry.node)) {
    issueCodes.push("maintenance-transactions-node-policy");
    return Object.freeze({
      status: "conflict",
      freshCompatible: false,
      protocolComplete: false,
      residues: NO_MAINTENANCE_RESIDUES,
      nodeDigest: localNodeDigest,
      protocolDigest: directoryDigest(maintenance),
    });
  }
  const transactions = await readDirectory(
    root,
    WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_REF,
    signal,
  );
  const residuePresent = transactions.entries.length > 0 || stagePresent;
  if (transactions.entries.length > 0) {
    issueCodes.push("maintenance-transaction-residue");
    freshCompatible = false;
  }
  const status: WakeflowLocalProtocolStatus =
    lockState === "unsafe"
      ? "conflict"
      : lockState === "active"
        ? "busy"
        : lockState === "inactive-or-unknown" || residuePresent
          ? "recovery-required"
          : "idle";
  return Object.freeze({
    status,
    freshCompatible: freshCompatible && status === "idle",
    protocolComplete: true,
    residues: maintenanceResidues(transactions.entries.map((entry) => entry.name)),
    nodeDigest: localNodeDigest,
    protocolDigest: computeCanonicalJsonSha256Digest({
      local: directoryDigest(local),
      runtime: directoryDigest(runtime),
      maintenance: directoryDigest(maintenance),
      transactions: directoryDigest(transactions),
      lockState,
    }),
  });
}

/** 稳定分类 Workspace 核心私有布局；不执行任何写入或恢复。 */
export async function inspectWakeflowWorkspaceCoreLayout(
  rootValue: RootedDirectory,
  optionsValue: WakeflowWorkspaceCoreLayoutInspectionOptions = {},
): Promise<Readonly<WakeflowWorkspaceCoreLayoutInspection>> {
  assertRoot(rootValue);
  if (
    typeof optionsValue !== "object" ||
    optionsValue === null ||
    types.isProxy(optionsValue) ||
    Object.keys(optionsValue).some((key) => key !== "signal")
  ) {
    fail("input", "$options");
  }
  const signal = parseSignal(optionsValue.signal);
  assertNotAborted(signal);
  const issueCodes: string[] = [];
  const active = await inspectActive(rootValue, signal);
  // `incomplete` 是维护可补齐的状态，不是 issue：gate 要求 issueCodes 为空才放行修复。
  if (active.status === "conflict") issueCodes.push("active-layout-node-policy");
  const local = await inspectLocal(rootValue, signal, issueCodes);
  assertNotAborted(signal);
  const sortedIssues = Object.freeze([...new Set(issueCodes)].sort());
  const inspectionDigest = computeCanonicalJsonSha256Digest({
    kind: "WakeflowWorkspaceCoreLayoutInspectionDigestBasis",
    active,
    local,
    issueCodes: sortedIssues,
  });
  return Object.freeze({
    active,
    local,
    issueCodes: sortedIssues,
    inspectionDigest,
  });
}
