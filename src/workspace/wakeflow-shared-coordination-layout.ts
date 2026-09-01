import { types } from "node:util";

import { WINDOW_WORK_CLAIMS_ROOT_RESOURCE_DECLARATION } from "../governance/delivery/window-work-claim-resource-catalog.js";
import { computeCanonicalJsonSha256Digest } from "../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../foundation/crypto/sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../foundation/data/passive-own-data.js";
import {
  materializeDirectoryPath,
  DurableDirectoryMaterializationError,
} from "../foundation/filesystem/durable-directory-materialization.js";
import type { FileNodeSnapshot } from "../foundation/filesystem/file-node-snapshot.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../foundation/filesystem/rooted-directory.js";
import {
  admitWakeflowResourceOperation,
  WakeflowResourceProcessingContractError,
} from "../foundation/resource/resource-processing-contract.js";
import {
  WAKEFLOW_SHARED_COORDINATION_ROOT_RESOURCE_DECLARATION,
  WAKEFLOW_SHARED_RUNTIME_ROOT_RESOURCE_DECLARATION,
} from "./workspace-shared-runtime-resource-catalog.js";
import type { WakeflowWorkspaceResourceDeclaration } from "./workspace-resource-declaration.js";

/** Wakeflow Workspace：shared/coordination/WindowWorkClaim静态目录链的唯一物化owner。 */

export const WAKEFLOW_SHARED_COORDINATION_LAYOUT_DECLARATIONS = Object.freeze([
  WAKEFLOW_SHARED_RUNTIME_ROOT_RESOURCE_DECLARATION,
  WAKEFLOW_SHARED_COORDINATION_ROOT_RESOURCE_DECLARATION,
  WINDOW_WORK_CLAIMS_ROOT_RESOURCE_DECLARATION,
]) satisfies readonly Readonly<WakeflowWorkspaceResourceDeclaration>[];

export const WAKEFLOW_SHARED_COORDINATION_LAYOUT_AUTHORITY_DIGEST: Sha256Digest =
  computeCanonicalJsonSha256Digest({
    kind: "WakeflowSharedCoordinationLayoutAuthority",
    schemaVersion: 1,
    declarations: WAKEFLOW_SHARED_COORDINATION_LAYOUT_DECLARATIONS,
  });

export type WakeflowSharedCoordinationLayoutStatus =
  "missing" | "partial" | "current";

export interface WakeflowSharedCoordinationLayoutInspection {
  readonly status: WakeflowSharedCoordinationLayoutStatus;
  readonly existingDirectoryCount: number;
  readonly authorityDigest: Sha256Digest;
  readonly observationDigest: Sha256Digest;
}

export interface WakeflowSharedCoordinationLayoutMaterializationOptions {
  readonly mode: "fresh" | "recover" | "ensure";
  readonly signal?: AbortSignal;
}

export interface WakeflowSharedCoordinationLayoutMaterializationResult {
  readonly disposition: "created" | "current";
  readonly createdDirectoryCount: number;
  readonly authorityDigest: Sha256Digest;
  readonly observationDigest: Sha256Digest;
}

export type WakeflowSharedCoordinationLayoutErrorReason =
  | "input"
  | "authority"
  | "strict-absent"
  | "layout"
  | "root-scope"
  | "aborted"
  | "operation-failure";

const ERROR_MESSAGES = {
  input: "Shared Coordination Layout input is invalid.",
  authority: "Shared Coordination Layout declarations are invalid.",
  "strict-absent": "Fresh Shared Coordination Layout target already exists.",
  layout: "Shared Coordination Layout contains an unsafe directory.",
  "root-scope": "Shared Coordination Layout lost workspace scope.",
  aborted: "Shared Coordination Layout operation was aborted.",
  "operation-failure": "Shared Coordination Layout materialization failed.",
} as const satisfies Readonly<
  Record<WakeflowSharedCoordinationLayoutErrorReason, string>
>;

/** Shared Coordination Layout检查或物化失败时的稳定错误。 */
export class WakeflowSharedCoordinationLayoutError extends Error {
  override readonly name = "WakeflowSharedCoordinationLayoutError";
  readonly code = "wakeflow-shared-coordination-layout" as const;
  readonly reason: WakeflowSharedCoordinationLayoutErrorReason;
  readonly path: string;

  constructor(
    reason: WakeflowSharedCoordinationLayoutErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function fail(
  reason: WakeflowSharedCoordinationLayoutErrorReason,
  path: string,
): never {
  throw new WakeflowSharedCoordinationLayoutError(reason, path);
}

function currentUserId(): bigint | null {
  return typeof process.geteuid === "function"
    ? BigInt(process.geteuid())
    : null;
}

function assertDirectory(node: Readonly<FileNodeSnapshot>, path: string): void {
  if (
    node.kind !== "directory" ||
    node.permissionBits !== 0o700 ||
    (currentUserId() !== null && node.userId !== currentUserId())
  ) {
    fail("layout", path);
  }
}

function assertRoot(value: unknown): asserts value is RootedDirectory {
  if (
    typeof value !== "object" ||
    value === null ||
    types.isProxy(value) ||
    !(value instanceof RootedDirectory)
  ) {
    fail("input", "$root");
  }
}

function parseOptions(
  value: unknown,
): Readonly<WakeflowSharedCoordinationLayoutMaterializationOptions> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }
  if (
    !Object.hasOwn(record, "mode") ||
    Object.keys(record).some((key) => key !== "mode" && key !== "signal") ||
    !new Set(["fresh", "recover", "ensure"]).has(record.mode as string) ||
    (record.signal !== undefined &&
      (typeof record.signal !== "object" ||
        record.signal === null ||
        types.isProxy(record.signal) ||
        !(record.signal instanceof AbortSignal)))
  ) {
    fail("input", "$options");
  }
  if ((record.signal as AbortSignal | undefined)?.aborted === true) {
    fail("aborted", "$signal");
  }
  return Object.freeze({
    mode: record.mode as "fresh" | "recover" | "ensure",
    ...(record.signal === undefined
      ? {}
      : { signal: record.signal as AbortSignal }),
  });
}

async function optionalDirectory(
  root: RootedDirectory,
  declaration: Readonly<WakeflowWorkspaceResourceDeclaration>,
): Promise<boolean> {
  const ref = declaration.placement.relativePath;
  if (ref === null) fail("authority", "$declarations");
  try {
    const observation = await root.inspectExistingResource(ref, "$layout");
    assertDirectory(observation.node, `$layout/${ref}`);
    return true;
  } catch (error: unknown) {
    if (
      error instanceof RootedDirectoryError &&
      error.reason === "resource-not-found"
    ) {
      return false;
    }
    if (error instanceof WakeflowSharedCoordinationLayoutError) throw error;
    if (error instanceof RootedDirectoryError) fail("root-scope", "$root");
    throw error;
  }
}

/** 零写入检查三层共享协调目录是否缺失、部分存在或完整。 */
export async function inspectWakeflowSharedCoordinationLayout(
  root: RootedDirectory,
): Promise<Readonly<WakeflowSharedCoordinationLayoutInspection>> {
  assertRoot(root);
  let existingDirectoryCount = 0;
  for (const declaration of WAKEFLOW_SHARED_COORDINATION_LAYOUT_DECLARATIONS) {
    if (await optionalDirectory(root, declaration)) existingDirectoryCount += 1;
  }
  const status =
    existingDirectoryCount === 0
      ? "missing"
      : existingDirectoryCount ===
          WAKEFLOW_SHARED_COORDINATION_LAYOUT_DECLARATIONS.length
        ? "current"
        : "partial";
  const basis = {
    kind: "WakeflowSharedCoordinationLayoutObservation" as const,
    status,
    existingDirectoryCount,
    authorityDigest: WAKEFLOW_SHARED_COORDINATION_LAYOUT_AUTHORITY_DIGEST,
  };
  return Object.freeze({
    status,
    existingDirectoryCount,
    authorityDigest: WAKEFLOW_SHARED_COORDINATION_LAYOUT_AUTHORITY_DIGEST,
    observationDigest: computeCanonicalJsonSha256Digest(basis),
  });
}

/** 按fresh/recover/ensure语义耐久物化三层共享协调目录。 */
export async function materializeWakeflowSharedCoordinationLayout(
  root: RootedDirectory,
  optionsValue: WakeflowSharedCoordinationLayoutMaterializationOptions,
): Promise<Readonly<WakeflowSharedCoordinationLayoutMaterializationResult>> {
  assertRoot(root);
  const options = parseOptions(optionsValue);
  const before = await inspectWakeflowSharedCoordinationLayout(root);
  if (options.mode === "fresh" && before.status !== "missing") {
    fail("strict-absent", "$layout");
  }
  let createdDirectoryCount = 0;
  for (const declaration of WAKEFLOW_SHARED_COORDINATION_LAYOUT_DECLARATIONS) {
    const ref = declaration.placement.relativePath;
    if (ref === null) fail("authority", "$declarations");
    try {
      admitWakeflowResourceOperation(
        declaration.processing,
        "materialize-directory",
      );
      const result = await materializeDirectoryPath(root, ref, {
        mode: 0o700,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
      const target = result.segments.find(
        (entry) => entry.resourcePath === ref,
      );
      if (target?.disposition === "created") createdDirectoryCount += 1;
    } catch (error: unknown) {
      if (error instanceof WakeflowResourceProcessingContractError) {
        fail("authority", "$declarations");
      }
      if (error instanceof DurableDirectoryMaterializationError) {
        if (error.reason === "aborted") fail("aborted", "$signal");
        if (error.reason === "root-scope") fail("root-scope", "$root");
        fail("operation-failure", `$layout/${ref}`);
      }
      throw error;
    }
  }
  const after = await inspectWakeflowSharedCoordinationLayout(root);
  if (after.status !== "current") fail("operation-failure", "$layout");
  return Object.freeze({
    disposition: createdDirectoryCount === 0 ? "current" : "created",
    createdDirectoryCount,
    authorityDigest: WAKEFLOW_SHARED_COORDINATION_LAYOUT_AUTHORITY_DIGEST,
    observationDigest: after.observationDigest,
  });
}
