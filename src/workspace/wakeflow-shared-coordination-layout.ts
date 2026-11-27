import { computeCanonicalJsonSha256Digest } from "../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../foundation/crypto/sha256.js";
import { type Fail, failWith, ModuleError } from "../foundation/error/module-error.js";
import {
  DurableDirectoryMaterializationError,
  materializeDirectoryPath,
} from "../foundation/filesystem/durable-directory-materialization.js";
import { isPrivateDirectory } from "../foundation/filesystem/private-node-policy.js";
import {
  type RootedDirectory,
  RootedDirectoryError,
} from "../foundation/filesystem/rooted-directory.js";
import { throwIfAborted } from "../foundation/node/abort-signal.js";
import {
  admitWakeflowResourceOperation,
  WakeflowResourceProcessingContractError,
} from "../foundation/resource/resource-processing-contract.js";
import { WORK_CLAIMS_ROOT_REF } from "../kernel/layout.js";
import {
  privateWorkspaceDirectoryDeclaration,
  type WakeflowWorkspaceResourceDeclaration,
} from "./workspace-resource-declaration.js";
import {
  WAKEFLOW_SHARED_COORDINATION_ROOT_RESOURCE_DECLARATION,
  WAKEFLOW_SHARED_RUNTIME_ROOT_RESOURCE_DECLARATION,
} from "./workspace-shared-runtime-resource-catalog.js";

/** Wakeflow Workspace：shared/coordination/工作声明静态目录链的唯一物化 owner。 */

/** 窗口工作声明目录：路径由内核 `layout.ts` 定义，物化与静态矩阵由本模块声明。 */
export const WORK_CLAIMS_ROOT_RESOURCE_DECLARATION = privateWorkspaceDirectoryDeclaration({
  declarationId: "coordination.window-work-claims-root",
  family: "coordination",
  ownerId: "shared-runtime-layout",
  scope: "host-neutral",
  relativePath: WORK_CLAIMS_ROOT_REF,
});

const WAKEFLOW_SHARED_COORDINATION_LAYOUT_DECLARATIONS = Object.freeze([
  WAKEFLOW_SHARED_RUNTIME_ROOT_RESOURCE_DECLARATION,
  WAKEFLOW_SHARED_COORDINATION_ROOT_RESOURCE_DECLARATION,
  WORK_CLAIMS_ROOT_RESOURCE_DECLARATION,
]) satisfies readonly Readonly<WakeflowWorkspaceResourceDeclaration>[];

export const WAKEFLOW_SHARED_COORDINATION_LAYOUT_AUTHORITY_DIGEST: Sha256Digest =
  computeCanonicalJsonSha256Digest({
    kind: "WakeflowSharedCoordinationLayoutAuthority",
    schemaVersion: 1,
    declarations: WAKEFLOW_SHARED_COORDINATION_LAYOUT_DECLARATIONS,
  });

export type WakeflowSharedCoordinationLayoutStatus = "missing" | "partial" | "current";

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
  | "authority"
  | "strict-absent"
  | "layout"
  | "root-scope"
  | "operation-failure";

/** Shared Coordination Layout检查或物化失败时的稳定错误。 */
export class WakeflowSharedCoordinationLayoutError extends ModuleError<WakeflowSharedCoordinationLayoutErrorReason> {
  static override readonly code = "wakeflow-shared-coordination-layout";
}

const fail: Fail<WakeflowSharedCoordinationLayoutErrorReason> = failWith(
  WakeflowSharedCoordinationLayoutError,
);

async function optionalDirectory(
  root: RootedDirectory,
  declaration: Readonly<WakeflowWorkspaceResourceDeclaration>,
): Promise<boolean> {
  const ref = declaration.placement.relativePath;
  if (ref === null) fail("authority", "$declarations");
  try {
    const observation = await root.inspectResourceOrNull(ref, "$layout");
    if (observation === null) return false;
    if (!isPrivateDirectory(observation.node)) fail("layout", `$layout/${ref}`);
    return true;
  } catch (error: unknown) {
    if (error instanceof WakeflowSharedCoordinationLayoutError) throw error;
    if (error instanceof RootedDirectoryError) fail("root-scope", "$root", error);
    throw error;
  }
}

/** 零写入检查三层共享协调目录是否缺失、部分存在或完整。 */
export async function inspectWakeflowSharedCoordinationLayout(
  root: RootedDirectory,
): Promise<Readonly<WakeflowSharedCoordinationLayoutInspection>> {
  let existingDirectoryCount = 0;
  for (const declaration of WAKEFLOW_SHARED_COORDINATION_LAYOUT_DECLARATIONS) {
    if (await optionalDirectory(root, declaration)) existingDirectoryCount += 1;
  }
  const status =
    existingDirectoryCount === 0
      ? "missing"
      : existingDirectoryCount === WAKEFLOW_SHARED_COORDINATION_LAYOUT_DECLARATIONS.length
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

/** 把一条声明的目录建出来；交回这一次是否新建了它。 */
async function materializeDeclaredDirectory(
  root: RootedDirectory,
  declaration: (typeof WAKEFLOW_SHARED_COORDINATION_LAYOUT_DECLARATIONS)[number],
  signal: AbortSignal | undefined,
): Promise<boolean> {
  const ref = declaration.placement.relativePath;
  if (ref === null) fail("authority", "$declarations");
  try {
    admitWakeflowResourceOperation(declaration.processing, "materialize-directory");
    const result = await materializeDirectoryPath(root, ref, {
      mode: 0o700,
      ...(signal === undefined ? {} : { signal }),
    });
    const target = result.segments.find((entry) => entry.resourcePath === ref);
    return target?.disposition === "created";
  } catch (error: unknown) {
    if (error instanceof WakeflowResourceProcessingContractError) {
      fail("authority", "$declarations", error);
    }
    if (error instanceof DurableDirectoryMaterializationError) {
      if (error.reason === "root-scope") fail("root-scope", "$root", error);
      fail("operation-failure", `$layout/${ref}`, error);
    }
    throw error;
  }
}

/** 按fresh/recover/ensure语义耐久物化三层共享协调目录。 */
export async function materializeWakeflowSharedCoordinationLayout(
  root: RootedDirectory,
  { mode, signal }: WakeflowSharedCoordinationLayoutMaterializationOptions,
): Promise<Readonly<WakeflowSharedCoordinationLayoutMaterializationResult>> {
  throwIfAborted(signal);
  const before = await inspectWakeflowSharedCoordinationLayout(root);
  if (mode === "fresh" && before.status !== "missing") {
    fail("strict-absent", "$layout");
  }
  let createdDirectoryCount = 0;
  for (const declaration of WAKEFLOW_SHARED_COORDINATION_LAYOUT_DECLARATIONS) {
    if (await materializeDeclaredDirectory(root, declaration, signal)) {
      createdDirectoryCount += 1;
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
