import { computeCanonicalJsonSha256Digest } from "../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../foundation/crypto/sha256.js";
import {
  createDirectoryAtomically,
  DurableDirectoryMaterializationError,
} from "../foundation/filesystem/durable-directory-materialization.js";
import type { FileNodeSnapshot } from "../foundation/filesystem/file-node-snapshot.js";
import type { PortableResourcePath } from "../foundation/filesystem/portable-resource-path.js";
import { isPrivateDirectory } from "../foundation/filesystem/private-node-policy.js";
import {
  type RootedDirectory,
  RootedDirectoryError,
} from "../foundation/filesystem/rooted-directory.js";
import { signalOptions, throwIfAborted } from "../foundation/node/abort-signal.js";
import { fail, failIo } from "./error.js";
import { WAKEFLOW_ACTIVE_CURRENT_ROOT_REF, WAKEFLOW_ACTIVE_ROOT_REF } from "./layout.js";

/**
 * Wakeflow Kernel / Active Layout：`.wakeflow-active` 的两级容器（能力卡 9 §9.4，gate-log §13.94 D5）。
 *
 * `.wakeflow-active` 与 `current` 两个 0700 目录由维护事务独占创建，这里提供检查与物化；
 * 容器里的人读投影在 `workspace/active-projection/active-projection.ts`。
 */

export const ACTIVE_PROJECTION_DIRECTORY_MODE = 0o700 as const;

type Signal = { readonly signal?: AbortSignal };

export interface ActiveLayoutEntryInspection {
  readonly resourcePath: PortableResourcePath;
  readonly status: "absent" | "current" | "conflict";
  readonly nodeDigest: Sha256Digest | null;
}

export interface ActiveLayoutInspection {
  readonly kind: "WakeflowActiveLayoutInspection";
  readonly status: "absent" | "incomplete" | "current" | "conflict";
  readonly entries: readonly Readonly<ActiveLayoutEntryInspection>[];
  readonly observationDigest: Sha256Digest;
}

function nodeDigest(node: Readonly<FileNodeSnapshot>): Sha256Digest {
  return computeCanonicalJsonSha256Digest({
    kind: node.kind,
    deviceId: node.deviceId.toString(),
    inodeId: node.inodeId.toString(),
    permissionBits: node.permissionBits,
    userId: node.userId.toString(),
  });
}

async function inspectLayoutEntry(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
): Promise<Readonly<ActiveLayoutEntryInspection>> {
  try {
    const resource = await root.inspectResourceOrNull(resourcePath, "$activeLayout");
    if (resource === null) {
      return Object.freeze({ resourcePath, status: "absent" as const, nodeDigest: null });
    }
    return Object.freeze({
      resourcePath,
      status: isPrivateDirectory(resource.node) ? ("current" as const) : ("conflict" as const),
      nodeDigest: nodeDigest(resource.node),
    });
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) {
      fail("io-failure", "active-layout-root-scope", "$root", { cause: error });
    }
    throw error;
  }
}

/** 只检查 root/current 两个节点，不扫描任何活动业务聚合。 */
export async function inspectActiveLayout(
  root: RootedDirectory,
  options: Signal = {},
): Promise<Readonly<ActiveLayoutInspection>> {
  throwIfAborted(options.signal);
  const active = await inspectLayoutEntry(root, WAKEFLOW_ACTIVE_ROOT_REF);
  const current = await inspectLayoutEntry(root, WAKEFLOW_ACTIVE_CURRENT_ROOT_REF);
  const status =
    active.status === "conflict" || current.status === "conflict"
      ? ("conflict" as const)
      : active.status === "absent" && current.status === "absent"
        ? ("absent" as const)
        : active.status === "current" && current.status === "current"
          ? ("current" as const)
          : ("incomplete" as const);
  const basis = {
    kind: "WakeflowActiveLayoutInspection" as const,
    status,
    entries: [active, current],
  };
  return Object.freeze({
    ...basis,
    entries: Object.freeze(basis.entries),
    observationDigest: computeCanonicalJsonSha256Digest(basis),
  });
}

/** 要求共享活动布局已由其 owner 完整建立。 */
export async function assertActiveLayoutCurrent(
  root: RootedDirectory,
  options: Signal = {},
): Promise<Readonly<ActiveLayoutInspection>> {
  const inspection = await inspectActiveLayout(root, options);
  if (inspection.status !== "current") {
    fail("precondition-failed", "active-layout-not-current", "$activeLayout");
  }
  return inspection;
}

export interface ActiveLayoutMaterializationEntry {
  readonly resourcePath: PortableResourcePath;
  readonly disposition: "created" | "current";
  readonly node: Readonly<FileNodeSnapshot>;
}

export interface ActiveLayoutMaterializationResult {
  readonly disposition: "created" | "current";
  readonly entries: readonly Readonly<ActiveLayoutMaterializationEntry>[];
}

async function existingLayoutDirectory(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  errorPath: string,
): Promise<Readonly<FileNodeSnapshot> | null> {
  try {
    return (await root.inspectResourceOrNull(resourcePath, errorPath))?.node ?? null;
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) {
      fail("io-failure", "active-layout-root-scope", "$root", { cause: error });
    }
    throw error;
  }
}

async function createLayoutDirectory(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  errorPath: string,
  signal: AbortSignal | undefined,
): Promise<Readonly<FileNodeSnapshot>> {
  try {
    const created = await createDirectoryAtomically(root, resourcePath, {
      mode: ACTIVE_PROJECTION_DIRECTORY_MODE,
      ...signalOptions(signal),
    });
    return created.node;
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryMaterializationError)
      failIo("active-layout", errorPath, error);
    throw error;
  }
}

async function ensureLayoutDirectory(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  recovering: boolean,
  signal: AbortSignal | undefined,
): Promise<Readonly<ActiveLayoutMaterializationEntry>> {
  const errorPath = `$activeLayout/${resourcePath}`;
  const existing = await existingLayoutDirectory(root, resourcePath, errorPath);
  const node = existing ?? (await createLayoutDirectory(root, resourcePath, errorPath, signal));
  if (!isPrivateDirectory(node)) {
    fail("precondition-failed", "active-layout-node-policy", errorPath);
  }
  if (existing !== null && !recovering) {
    fail("precondition-failed", "active-layout-exists", errorPath);
  }
  return Object.freeze({
    resourcePath,
    disposition: existing === null ? ("created" as const) : ("current" as const),
    node,
  });
}

/** 独占创建两级容器；`recovering` 时幂等补齐尚未发生的创建。 */
export async function materializeActiveLayout(
  root: RootedDirectory,
  options: Readonly<{ readonly recovering: boolean; readonly signal?: AbortSignal }>,
): Promise<Readonly<ActiveLayoutMaterializationResult>> {
  throwIfAborted(options.signal);
  const active = await ensureLayoutDirectory(
    root,
    WAKEFLOW_ACTIVE_ROOT_REF,
    options.recovering,
    options.signal,
  );
  const current = await ensureLayoutDirectory(
    root,
    WAKEFLOW_ACTIVE_CURRENT_ROOT_REF,
    options.recovering,
    options.signal,
  );
  const entries = Object.freeze([active, current]);
  return Object.freeze({
    disposition: entries.some((entry) => entry.disposition === "created") ? "created" : "current",
    entries,
  });
}
