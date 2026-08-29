import { types } from "node:util";

import {
  computeCanonicalJsonSha256Digest,
} from "../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import type { FileNodeSnapshot } from "../../foundation/filesystem/file-node-snapshot.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import type { PortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import {
  WAKEFLOW_ACTIVE_CURRENT_ROOT_REF,
  WAKEFLOW_ACTIVE_ROOT_REF,
} from "./wakeflow-active-paths.js";
import {
  WAKEFLOW_ACTIVE_LAYOUT_AUTHORITY_DIGEST,
} from "./wakeflow-active-resource-catalog.js";

/** Wakeflow Workspace / Active：共享 Active Layout 的轻量只读节点观察。 */

export interface WakeflowActiveLayoutEntryInspection {
  readonly resourcePath: PortableResourcePath;
  readonly status: "absent" | "current" | "conflict";
  readonly nodeDigest: Sha256Digest | null;
}

export interface WakeflowActiveLayoutInspection {
  readonly kind: "WakeflowActiveLayoutInspection";
  readonly status: "absent" | "incomplete" | "current" | "conflict";
  readonly authorityDigest: Sha256Digest;
  readonly observationDigest: Sha256Digest;
  readonly entries: readonly Readonly<WakeflowActiveLayoutEntryInspection>[];
}

export type WakeflowActiveLayoutInspectionErrorReason =
  | "input"
  | "not-current"
  | "root-scope"
  | "aborted";

const ERROR_MESSAGES = {
  input: "Wakeflow Active layout inspection input is invalid.",
  "not-current": "Wakeflow Active layout is not current.",
  "root-scope": "Wakeflow Active layout inspection lost workspace scope.",
  aborted: "Wakeflow Active layout inspection was aborted.",
} as const satisfies Readonly<Record<
  WakeflowActiveLayoutInspectionErrorReason,
  string
>>;

/** Active Layout 检查失败的稳定、脱敏错误。 */
export class WakeflowActiveLayoutInspectionError extends Error {
  override readonly name = "WakeflowActiveLayoutInspectionError";
  readonly code = "wakeflow-active-layout-inspection" as const;
  readonly reason: WakeflowActiveLayoutInspectionErrorReason;
  readonly path: string;

  constructor(reason: WakeflowActiveLayoutInspectionErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function fail(
  reason: WakeflowActiveLayoutInspectionErrorReason,
  path: string,
): never {
  throw new WakeflowActiveLayoutInspectionError(reason, path);
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

function currentUserId(): bigint | null {
  return typeof process.geteuid === "function"
    ? BigInt(process.geteuid())
    : null;
}

function currentPrivateDirectory(node: Readonly<FileNodeSnapshot>): boolean {
  return node.kind === "directory"
    && node.permissionBits === 0o700
    && (currentUserId() === null || node.userId === currentUserId());
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) fail("aborted", "$signal");
}

async function inspectEntry(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
): Promise<Readonly<WakeflowActiveLayoutEntryInspection>> {
  try {
    const resource = await root.inspectExistingResource(resourcePath);
    return Object.freeze({
      resourcePath,
      status: currentPrivateDirectory(resource.node)
        ? "current" as const
        : "conflict" as const,
      nodeDigest: nodeDigest(resource.node),
    });
  } catch (error: unknown) {
    if (
      error instanceof RootedDirectoryError
      && error.reason === "resource-not-found"
    ) {
      return Object.freeze({
        resourcePath,
        status: "absent" as const,
        nodeDigest: null,
      });
    }
    if (error instanceof RootedDirectoryError) fail("root-scope", "$root");
    throw error;
  }
}

/** 只检查 root/current 两个节点，不扫描任何 Active 业务聚合。 */
export async function inspectWakeflowActiveLayout(
  rootValue: RootedDirectory,
  signal?: AbortSignal,
): Promise<Readonly<WakeflowActiveLayoutInspection>> {
  if (
    typeof rootValue !== "object"
    || rootValue === null
    || types.isProxy(rootValue)
    || !(rootValue instanceof RootedDirectory)
  ) {
    fail("input", "$root");
  }
  assertNotAborted(signal);
  const entries = Object.freeze([
    await inspectEntry(rootValue, WAKEFLOW_ACTIVE_ROOT_REF),
    await inspectEntry(rootValue, WAKEFLOW_ACTIVE_CURRENT_ROOT_REF),
  ]);
  assertNotAborted(signal);
  const [active, current] = entries;
  if (active === undefined || current === undefined) fail("root-scope", "$root");
  const status = active.status === "conflict" || current.status === "conflict"
    ? "conflict" as const
    : active.status === "absent" && current.status === "absent"
      ? "absent" as const
      : active.status === "current" && current.status === "current"
        ? "current" as const
        : "incomplete" as const;
  const basis = {
    kind: "WakeflowActiveLayoutInspection" as const,
    status,
    authorityDigest: WAKEFLOW_ACTIVE_LAYOUT_AUTHORITY_DIGEST,
    entries,
  };
  return Object.freeze({
    ...basis,
    observationDigest: computeCanonicalJsonSha256Digest(basis),
  });
}

/** 要求共享 Active Layout 已由其 owner 完整建立。 */
export async function assertWakeflowActiveLayoutCurrent(
  root: RootedDirectory,
  signal?: AbortSignal,
): Promise<Readonly<WakeflowActiveLayoutInspection>> {
  const inspection = await inspectWakeflowActiveLayout(root, signal);
  if (inspection.status !== "current") fail("not-current", "$activeLayout");
  return inspection;
}
