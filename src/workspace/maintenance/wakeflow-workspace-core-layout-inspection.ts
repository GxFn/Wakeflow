import { types } from "node:util";

import {
  computeCanonicalJsonSha256Digest,
} from "../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import {
  hasDurableAtomicFileStagePrefix,
} from "../../foundation/filesystem/durable-atomic-file-stage-address.js";
import type { FileNodeSnapshot } from "../../foundation/filesystem/file-node-snapshot.js";
import {
  RootedDirectory,
  RootedDirectoryError,
  type RootedResourceSnapshot,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  inspectRootedExclusiveFileLock,
  RootedExclusiveFileLockError,
} from "../../foundation/filesystem/rooted-exclusive-file-lock.js";
import {
  readStableResourceDirectory,
  StableDirectoryReadError,
  type StableDirectoryReadResult,
} from "../../foundation/filesystem/stable-directory-read.js";
import {
  inspectWakeflowActiveLayout,
  WakeflowActiveLayoutInspectionError,
} from "../active/wakeflow-active-layout-inspection.js";
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
 * gate/stage/journal/其他条目时为 true。
 *
 * 已安装 workspace 可以在 Local/Runtime 中包含其他领域 owner 的资源；这些资源不会
 * 被 fresh 采用，但在完整 maintenance protocol 为 idle 时不构成运行期冲突。
 */

export type WakeflowActiveRootStatus = "absent" | "present" | "conflict";
export type WakeflowLocalProtocolStatus =
  | "absent"
  | "bootstrap-prefix"
  | "idle"
  | "busy"
  | "recovery-required"
  | "conflict";

export interface WakeflowWorkspaceCoreLayoutInspection {
  readonly kind: "WakeflowWorkspaceCoreLayoutInspection";
  readonly active: Readonly<{
    readonly status: WakeflowActiveRootStatus;
    readonly nodeDigest: Sha256Digest | null;
  }>;
  readonly local: Readonly<{
    readonly status: WakeflowLocalProtocolStatus;
    readonly freshCompatible: boolean;
    readonly protocolComplete: boolean;
    readonly nodeDigest: Sha256Digest | null;
    readonly protocolDigest: Sha256Digest | null;
  }>;
  readonly issueCodes: readonly string[];
  readonly inspectionDigest: Sha256Digest;
}

export interface WakeflowWorkspaceCoreLayoutInspectionOptions {
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
} as const satisfies Readonly<Record<
  WakeflowWorkspaceCoreLayoutInspectionErrorReason,
  string
>>;

/** 核心私有布局检查失败的稳定、脱敏错误。 */
export class WakeflowWorkspaceCoreLayoutInspectionError extends Error {
  override readonly name = "WakeflowWorkspaceCoreLayoutInspectionError";
  readonly code = "wakeflow-workspace-core-layout-inspection" as const;
  readonly reason: WakeflowWorkspaceCoreLayoutInspectionErrorReason;
  readonly path: string;

  constructor(
    reason: WakeflowWorkspaceCoreLayoutInspectionErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const MAXIMUM_PROTOCOL_ENTRIES = 4_096;

function fail(
  reason: WakeflowWorkspaceCoreLayoutInspectionErrorReason,
  path: string,
): never {
  throw new WakeflowWorkspaceCoreLayoutInspectionError(reason, path);
}

function parseSignal(value: unknown): AbortSignal | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "object"
    || value === null
    || types.isProxy(value)
    || !(value instanceof AbortSignal)
  ) {
    fail("input", "$options.signal");
  }
  return value;
}

function assertRoot(value: unknown): asserts value is RootedDirectory {
  if (
    typeof value !== "object"
    || value === null
    || types.isProxy(value)
    || !(value instanceof RootedDirectory)
  ) {
    fail("input", "$root");
  }
}

function currentUserId(): bigint {
  if (process.platform === "win32" || typeof process.geteuid !== "function") {
    fail("inspection", "$root");
  }
  return BigInt(process.geteuid());
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

function directoryDigest(
  read: Readonly<StableDirectoryReadResult>,
): Sha256Digest {
  return computeCanonicalJsonSha256Digest({
    nodeDigest: nodeDigest(read.directoryNode),
    entries: read.entries.map((entry) => ({
      name: entry.name,
      nodeDigest: nodeDigest(entry.node),
    })),
  });
}

function validPrivateDirectory(node: Readonly<FileNodeSnapshot>): boolean {
  return node.kind === "directory"
    && node.permissionBits === 0o700
    && node.userId === currentUserId();
}

async function optionalResource(
  root: RootedDirectory,
  resourcePath: Parameters<RootedDirectory["inspectExistingResource"]>[0],
): Promise<Readonly<RootedResourceSnapshot> | null> {
  try {
    return await root.inspectExistingResource(resourcePath, "$resourcePath");
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
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "too-many-entries") fail("capacity", "$entries");
      if (error.reason === "source-changed") {
        fail("source-changed", "$resourcePath");
      }
      if (
        error.reason === "root-scope"
        || error.reason === "expectation-changed"
      ) {
        fail("root-scope", "$root");
      }
      fail("inspection", "$resourcePath");
    }
    throw error;
  }
}

async function inspectActive(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<Readonly<{
  readonly status: WakeflowActiveRootStatus;
  readonly nodeDigest: Sha256Digest | null;
}>> {
  try {
    const inspection = await inspectWakeflowActiveLayout(root, signal);
    return Object.freeze({
      status: inspection.status === "absent"
        ? "absent" as const
        : inspection.status === "current"
          ? "present" as const
          : "conflict" as const,
      nodeDigest: inspection.status === "absent"
        ? null
        : inspection.observationDigest,
    });
  } catch (error: unknown) {
    if (error instanceof WakeflowActiveLayoutInspectionError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "root-scope") fail("root-scope", "$root");
      fail("inspection", "$activeLayout");
    }
    throw error;
  }
}

function entryNamed(
  read: Readonly<StableDirectoryReadResult>,
  name: string,
) {
  return read.entries.find((entry) => entry.name === name) ?? null;
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
      nodeDigest: localNodeDigest,
      protocolDigest: directoryDigest(local),
    });
  }
  const runtime = await readDirectory(root, WAKEFLOW_RUNTIME_ROOT_REF, signal);
  const runtimeAllowedFresh = new Set(["maintenance"]);
  if (runtime.entries.some((entry) => !runtimeAllowedFresh.has(entry.name))) {
    freshCompatible = false;
  }
  const stagePresent = runtime.entries.some((entry) => (
    hasDurableAtomicFileStagePrefix(entry.name)
  ));
  if (stagePresent) issueCodes.push("maintenance-gate-stage-residue");
  const maintenanceEntry = entryNamed(runtime, "maintenance");
  let lockState: "absent" | "active" | "inactive-or-unknown" | "unsafe" =
    "absent";
  try {
    const lock = await inspectRootedExclusiveFileLock(
      root,
      WAKEFLOW_MAINTENANCE_GATE_REF,
    );
    if (lock.status === "held") {
      lockState = lock.ownerState === "active"
        ? "active"
        : "inactive-or-unknown";
      freshCompatible = false;
    }
  } catch (error: unknown) {
    if (error instanceof RootedExclusiveFileLockError) {
      lockState = error.reason === "unsafe-lock" ? "unsafe" : "inactive-or-unknown";
      freshCompatible = false;
    } else {
      throw error;
    }
  }
  if (lockState === "unsafe") issueCodes.push("maintenance-gate-unsafe");
  if (maintenanceEntry === null) {
    const status: WakeflowLocalProtocolStatus = lockState === "active"
      ? "busy"
      : lockState !== "absent" || stagePresent
        ? "recovery-required"
        : "bootstrap-prefix";
    return Object.freeze({
      status,
      freshCompatible: freshCompatible && status === "bootstrap-prefix",
      protocolComplete: false,
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
      nodeDigest: localNodeDigest,
      protocolDigest: directoryDigest(runtime),
    });
  }
  const maintenance = await readDirectory(
    root,
    WAKEFLOW_MAINTENANCE_ROOT_REF,
    signal,
  );
  if (maintenance.entries.some((entry) => entry.name !== "transactions")) {
    issueCodes.push("maintenance-root-unknown-entry");
    return Object.freeze({
      status: "conflict",
      freshCompatible: false,
      protocolComplete: false,
      nodeDigest: localNodeDigest,
      protocolDigest: directoryDigest(maintenance),
    });
  }
  const transactionsEntry = entryNamed(maintenance, "transactions");
  if (transactionsEntry === null) {
    const status: WakeflowLocalProtocolStatus = lockState === "active"
      ? "busy"
      : lockState !== "absent" || stagePresent
        ? "recovery-required"
        : "bootstrap-prefix";
    return Object.freeze({
      status,
      freshCompatible: freshCompatible && status === "bootstrap-prefix",
      protocolComplete: false,
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
  const status: WakeflowLocalProtocolStatus = lockState === "unsafe"
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
    typeof optionsValue !== "object"
    || optionsValue === null
    || types.isProxy(optionsValue)
    || Object.keys(optionsValue).some((key) => key !== "signal")
  ) {
    fail("input", "$options");
  }
  const signal = parseSignal(optionsValue.signal);
  if (signal?.aborted === true) fail("aborted", "$signal");
  const issueCodes: string[] = [];
  const active = await inspectActive(rootValue, signal);
  if (active.status === "conflict") issueCodes.push("active-layout-node-policy");
  const local = await inspectLocal(rootValue, signal, issueCodes);
  const sortedIssues = Object.freeze([...new Set(issueCodes)].sort());
  const inspectionDigest = computeCanonicalJsonSha256Digest({
    kind: "WakeflowWorkspaceCoreLayoutInspectionDigestBasis",
    active,
    local,
    issueCodes: sortedIssues,
  });
  return Object.freeze({
    kind: "WakeflowWorkspaceCoreLayoutInspection",
    active,
    local,
    issueCodes: sortedIssues,
    inspectionDigest,
  });
}
