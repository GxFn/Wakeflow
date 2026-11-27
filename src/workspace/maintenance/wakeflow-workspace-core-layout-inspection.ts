import { types } from "node:util";

import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import type { FileNodeSnapshot } from "../../foundation/filesystem/file-node-snapshot.js";
import { KernelFileLockError } from "../../foundation/filesystem/kernel-file-lock.js";
import type { PortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import {
  isRootedDirectory,
  type RootedDirectory,
  RootedDirectoryError,
  type RootedResourceSnapshot,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  readStableResourceDirectory,
  StableDirectoryReadError,
  type StableDirectoryReadResult,
} from "../../foundation/filesystem/stable-directory-read.js";
import { throwIfAborted } from "../../foundation/node/abort-signal.js";
import { ownedByAnotherUser, requireCurrentUserId } from "../../foundation/node/current-user.js";
import { inspectActiveLayout } from "../../kernel/active-projection.js";
import { WakeflowError } from "../../kernel/error.js";
import { isWorkspaceLockFileName, isWorkspaceLockHeld } from "../../kernel/workspace-locks.js";
import {
  parseWakeflowMaintenanceOperationId,
  WakeflowMaintenanceOperationIdError,
} from "./wakeflow-maintenance-operation-id.js";
import {
  WAKEFLOW_LOCAL_ROOT_REF,
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
  | "inspection";

const ERROR_MESSAGES = {
  input: "Wakeflow workspace core layout inspection input is invalid.",
  "root-scope": "Wakeflow workspace root changed during layout inspection.",
  capacity: "Wakeflow workspace core layout exceeds its inspection budget.",
  "source-changed": "Wakeflow workspace core layout changed during inspection.",
  inspection: "Wakeflow workspace core layout could not be inspected safely.",
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
  resourcePath: Parameters<RootedDirectory["inspectResourceOrNull"]>[0],
): Promise<Readonly<RootedResourceSnapshot> | null> {
  try {
    return await root.inspectResourceOrNull(resourcePath, "$resourcePath");
  } catch (error: unknown) {
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

/** 门是一把内核咨询锁（ADR-0033）：要么此刻被持有，要么没有；路径不是锁文件时不安全。 */
type GateLockState = "absent" | "active" | "unsafe";

// An unsafe gate is a conflict whether or not the maintenance directories exist.
function prefixProtocolStatus(lockState: GateLockState): WakeflowLocalProtocolStatus {
  if (lockState === "unsafe") return "conflict";
  return lockState === "active" ? "busy" : "bootstrap-prefix";
}

/**
 * 锁目录里是不是只有本协议的锁文件。锁文件不带任何状态——没有人持有时它与不存在没有区别——所以一次没有
 * 做完的初始化留下的锁目录不妨碍下一次按"全新"来预览。不认识的名字、不是 0600 普通文件的条目都算不兼容。
 */
async function locksRootHoldsOnlyLockFiles(
  root: RootedDirectory,
  locksRef: PortableResourcePath,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  const contents = await readDirectory(root, locksRef, signal);
  return contents.entries.every(
    (entry) =>
      isWorkspaceLockFileName(entry.name) &&
      entry.node.kind === "file" &&
      entry.node.permissionBits === 0o600 &&
      !ownedByAnotherUser(entry.node.userId),
  );
}

async function gateLockState(root: RootedDirectory): Promise<GateLockState> {
  try {
    return (await isWorkspaceLockHeld(root, "maintenance-gate")) ? "active" : "absent";
  } catch (error: unknown) {
    if (!(error instanceof KernelFileLockError)) throw error;
    if (error.reason === "unsafe-lock") return "unsafe";
    fail("inspection", "$gate", error);
  }
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
        entry.name !== "maintenance" && entry.name !== "locks" && entry.name !== "incidents",
    )
  ) {
    freshCompatible = false;
  }
  const locks = entryNamed(runtime, "locks");
  if (locks !== null) {
    if (!validPrivateDirectory(locks.node)) freshCompatible = false;
    else if (!(await locksRootHoldsOnlyLockFiles(root, locks.resourcePath, signal))) {
      freshCompatible = false;
    }
  }
  const maintenanceEntry = entryNamed(runtime, "maintenance");
  const lockState = await gateLockState(root);
  if (lockState !== "absent") freshCompatible = false;
  if (lockState === "unsafe") issueCodes.push("maintenance-gate-unsafe");
  if (maintenanceEntry === null) {
    const status = prefixProtocolStatus(lockState);
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
    const status = prefixProtocolStatus(lockState);
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
  const residuePresent = transactions.entries.length > 0;
  if (residuePresent) {
    issueCodes.push("maintenance-transaction-residue");
    freshCompatible = false;
  }
  // 门被持有就是有一次维护在跑；没有人持有而事务目录里留着东西，是上一次维护没有做完。锁目录不在而别的
  // 都在，是从文件锁的版本更新上来的工作区（ADR-0033 决定 10）：协议还差这一段，对账以修复模式补上它。
  const status: WakeflowLocalProtocolStatus =
    lockState === "unsafe"
      ? "conflict"
      : lockState === "active"
        ? "busy"
        : residuePresent
          ? "recovery-required"
          : locks === null
            ? "bootstrap-prefix"
            : "idle";
  return Object.freeze({
    status,
    freshCompatible: freshCompatible && (status === "idle" || status === "bootstrap-prefix"),
    protocolComplete: locks !== null,
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
  throwIfAborted(signal);
  const issueCodes: string[] = [];
  const active = await inspectActive(rootValue, signal);
  // `incomplete` 是维护可补齐的状态，不是 issue：gate 要求 issueCodes 为空才放行修复。
  if (active.status === "conflict") issueCodes.push("active-layout-node-policy");
  const local = await inspectLocal(rootValue, signal, issueCodes);
  throwIfAborted(signal);
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
