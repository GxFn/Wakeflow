import type { WakeflowConfigModel } from "../../configuration/wakeflow-config.js";
import {
  validateWakeflowConfigRootPlacements,
  WakeflowConfigRootPlacementError,
} from "../../configuration/wakeflow-config-root-placement.js";
import type { WakeflowDurableId } from "../../contracts/identity/wakeflow-durable-id.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import { type Fail, failWith, ModuleError } from "../../foundation/error/module-error.js";
import {
  type RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  readStableFile,
  readStableFileOrNull,
  StableFileReadError,
  type StableFileSource,
} from "../../foundation/filesystem/stable-file-read.js";
import {
  planWholeFileContentTransition,
  type WholeFileContentTransition,
  WholeFileContentTransitionError,
} from "../../foundation/filesystem/whole-file-content-transition.js";
import { throwIfAborted } from "../../foundation/node/abort-signal.js";
import { requireCurrentUserId } from "../../foundation/node/current-user.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import {
  admitWakeflowResourceOperation,
  type WakeflowResourceOperation,
  WakeflowResourceProcessingContractError,
} from "../../foundation/resource/resource-processing-contract.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import {
  historicalWakeflowManagedTextBodies,
  WAKEFLOW_SUPPORT_MEMORY_BODY_HISTORY,
} from "../managed-integration/wakeflow-managed-text-history.js";
import type { WakeflowWorkspaceHostResourceProfile } from "../workspace-host-resource-profile.js";
import type { WakeflowWorkspaceResourceDeclaration } from "../../kernel/workspace-resource-declaration.js";
import {
  createWakeflowManagedSupportResourceCatalog,
  type WakeflowManagedSupportResourceCatalog,
} from "./wakeflow-managed-support-resource-catalog.js";
import { WAKEFLOW_MANAGED_SUPPORT_ROOT_MODE } from "./wakeflow-managed-support-root-materialization.js";
import {
  createWakeflowSupportMemoryAuthority,
  type WakeflowSupportMemoryAuthority,
  WakeflowSupportMemoryAuthorityError,
} from "./wakeflow-support-memory-authority.js";

/**
 * Wakeflow Workspace / Support：whole-file memory 的只读检查。
 *
 * 本模块绑定 workspace/support 两个已打开根、current/desired Config 摘要、动态 Resource
 * Catalog、Support memory authority、稳定文件读取与 whole-file content transition。
 * source 只能缺失、精确等于 desired 或精确等于 current renderer；其他整文件字节拒绝。
 *
 * 它不创建 Support 根、不写 memory，也不决定 maintenance action 或旧根清理政策。
 */

const WAKEFLOW_SUPPORT_MEMORY_MAXIMUM_BYTES = parseByteCount(
  256 * 1024,
  "$supportMemory.maximumBytes",
);
export const WAKEFLOW_SUPPORT_MEMORY_FILE_MODE = 0o644;

export interface WakeflowSupportMemoryInspectionRequest {
  readonly currentConfig: WakeflowConfigModel | null;
  readonly expectedCurrentConfigDigest: Sha256Digest | null;
  readonly desiredConfig: WakeflowConfigModel;
  readonly expectedDesiredConfigDigest: Sha256Digest;
  readonly profile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  readonly expectedCatalogDigest: Sha256Digest;
  readonly surfaceId: WakeflowDurableId<"surface">;
  readonly signal?: AbortSignal;
}

export interface WakeflowSupportMemoryInspection {
  readonly kind: "WakeflowSupportMemoryInspection";
  readonly status: "current" | "publication-required";
  readonly currentConfigDigest: Sha256Digest | null;
  readonly desiredConfigDigest: Sha256Digest;
  readonly catalogDigest: Sha256Digest;
  readonly declaration: Readonly<WakeflowWorkspaceResourceDeclaration>;
  readonly operation: Readonly<WakeflowResourceOperation>;
  readonly currentAuthority: Readonly<WakeflowSupportMemoryAuthority> | null;
  readonly desiredAuthority: Readonly<WakeflowSupportMemoryAuthority>;
  readonly source: Readonly<StableFileSource> | null;
  readonly transition: Readonly<WholeFileContentTransition>;
}

export type WakeflowSupportMemoryInspectionErrorReason =
  | "config"
  | "catalog"
  | "surface"
  | "placement"
  | "root-policy"
  | "authority"
  | "source"
  | "source-policy"
  | "unadmitted-source"
  | "capacity";

/** Support memory 只读检查失败的稳定、脱敏错误。 */
export class WakeflowSupportMemoryInspectionError extends ModuleError<WakeflowSupportMemoryInspectionErrorReason> {
  static override readonly code = "wakeflow-support-memory-inspection";
}

const fail: Fail<WakeflowSupportMemoryInspectionErrorReason> = failWith(
  WakeflowSupportMemoryInspectionError,
);

export interface ParsedWakeflowSupportMemoryInspectionRequest {
  readonly currentConfig: WakeflowConfigModel | null;
  readonly currentConfigDigest: Sha256Digest | null;
  readonly desiredConfig: WakeflowConfigModel;
  readonly desiredConfigDigest: Sha256Digest;
  readonly profile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  readonly catalog: Readonly<WakeflowManagedSupportResourceCatalog>;
  readonly surfaceId: WakeflowDurableId<"surface">;
  readonly signal: AbortSignal | undefined;
}

/**
 * 把调用方已类型化的请求换成执行用的形状：编出 Support 目录并核对该 surface 在里面。保留的关系检查只有
 * current 与 desired 是同一个 program——reconfigure 的 desired Config 来自公共请求，current 来自盘上，
 * 这是两者第一次相遇的地方（A-spec R10）。
 */
export function wakeflowSupportMemoryRequestModel(
  request: Omit<WakeflowSupportMemoryInspectionRequest, "signal">,
  signal: AbortSignal | undefined,
): Readonly<ParsedWakeflowSupportMemoryInspectionRequest> {
  const { currentConfig, desiredConfig, profile, surfaceId } = request;
  if (
    currentConfig !== null &&
    currentConfig.program.programId !== desiredConfig.program.programId
  ) {
    fail("config", "$request.desiredConfig.program.programId");
  }
  const catalog = createWakeflowManagedSupportResourceCatalog(desiredConfig, profile);
  if (!catalog.declarations.some((entry) => entry.declarationId === `support.${surfaceId}.root`)) {
    fail("surface", "$request.surfaceId");
  }
  return Object.freeze({
    currentConfig,
    currentConfigDigest: request.expectedCurrentConfigDigest,
    desiredConfig,
    desiredConfigDigest: request.expectedDesiredConfigDigest,
    profile,
    catalog,
    surfaceId,
    signal,
  });
}

function currentUserId(): bigint {
  return requireCurrentUserId(() => fail("root-policy", "$supportRoot"));
}

async function admitRoots(
  workspaceRoot: RootedDirectory,
  supportRoot: RootedDirectory,
  request: Readonly<ParsedWakeflowSupportMemoryInspectionRequest>,
): Promise<void> {
  let report: Awaited<ReturnType<typeof validateWakeflowConfigRootPlacements>>;
  try {
    report = await validateWakeflowConfigRootPlacements(workspaceRoot, request.desiredConfig);
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigRootPlacementError) {
      fail("placement", error.path, error);
    }
    throw error;
  }
  const placement = report.roots.find((entry) => entry.key === `support.${request.surfaceId}.root`);
  if (placement?.state !== "present" || placement.realPath !== supportRoot.absolutePath) {
    fail("placement", "$supportRoot");
  }
  let node: Awaited<ReturnType<RootedDirectory["assertCurrent"]>>;
  try {
    node = await supportRoot.assertCurrent("$supportRoot");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) fail("placement", "$supportRoot", error);
    throw error;
  }
  if (
    node.kind !== "directory" ||
    node.permissionBits !== WAKEFLOW_MANAGED_SUPPORT_ROOT_MODE ||
    node.userId !== currentUserId()
  ) {
    fail("root-policy", "$supportRoot");
  }
}

function currentAuthority(
  request: Readonly<ParsedWakeflowSupportMemoryInspectionRequest>,
): Readonly<WakeflowSupportMemoryAuthority> | null {
  if (request.currentConfig === null) return null;
  try {
    return createWakeflowSupportMemoryAuthority(
      request.currentConfig,
      request.profile,
      request.surfaceId,
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowSupportMemoryAuthorityError && error.reason === "surface") {
      return null;
    }
    if (error instanceof WakeflowSupportMemoryAuthorityError) {
      fail("authority", error.path, error);
    }
    throw error;
  }
}

function desiredAuthority(
  request: Readonly<ParsedWakeflowSupportMemoryInspectionRequest>,
): Readonly<WakeflowSupportMemoryAuthority> {
  try {
    return createWakeflowSupportMemoryAuthority(
      request.desiredConfig,
      request.profile,
      request.surfaceId,
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowSupportMemoryAuthorityError) {
      fail(error.reason === "surface" ? "surface" : "authority", error.path, error);
    }
    throw error;
  }
}

async function readSource(
  supportRoot: RootedDirectory,
  request: Readonly<ParsedWakeflowSupportMemoryInspectionRequest>,
): Promise<Readonly<{
  readonly facts: Readonly<StableFileSource>;
  readonly bytes: Uint8Array;
}> | null> {
  try {
    const read = await readStableFileOrNull(supportRoot, request.profile.instructionFileName, {
      maximumBytes: WAKEFLOW_SUPPORT_MEMORY_MAXIMUM_BYTES,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    if (read === null) return null;
    if (
      read.node.kind !== "file" ||
      read.node.permissionBits !== WAKEFLOW_SUPPORT_MEMORY_FILE_MODE ||
      read.node.linkCount !== 1n ||
      read.node.userId !== currentUserId()
    ) {
      fail("source-policy", "$source");
    }
    return Object.freeze({
      facts: Object.freeze({
        resourcePath: read.resourcePath,
        node: read.node,
        byteCount: read.byteCount,
        digest: read.digest,
      }),
      bytes: read.bytes,
    });
  } catch (error: unknown) {
    if (error instanceof WakeflowSupportMemoryInspectionError) throw error;
    if (error instanceof StableFileReadError) {
      if (error.reason === "too-large") fail("capacity", "$source", error);
      if (error.reason === "symlink" || error.reason === "not-file") {
        fail("source-policy", "$source", error);
      }
      fail("source", "$source", error);
    }
    throw error;
  }
}

async function revalidateSource(
  supportRoot: RootedDirectory,
  request: Readonly<ParsedWakeflowSupportMemoryInspectionRequest>,
  initial: Awaited<ReturnType<typeof readSource>>,
): Promise<void> {
  try {
    const current = await readStableFile(supportRoot, request.profile.instructionFileName, {
      maximumBytes: WAKEFLOW_SUPPORT_MEMORY_MAXIMUM_BYTES,
      ...(initial === null ? {} : { expectedNode: initial.facts.node }),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    if (
      initial === null ||
      current.digest !== initial.facts.digest ||
      current.byteCount !== initial.facts.byteCount
    ) {
      fail("source", "$source");
    }
  } catch (error: unknown) {
    if (error instanceof WakeflowSupportMemoryInspectionError) throw error;
    if (error instanceof StableFileReadError) {
      if (initial === null && error.reason === "not-found") return;
      fail("source", "$source", error);
    }
    throw error;
  }
}

/** 检查一个已物化 Support 根内的 whole-file memory，并生成零写入候选。 */
export async function inspectWakeflowSupportMemory(
  workspaceRootValue: RootedDirectory,
  supportRootValue: RootedDirectory,
  { signal, ...requestValue }: WakeflowSupportMemoryInspectionRequest,
): Promise<Readonly<WakeflowSupportMemoryInspection>> {
  const request = wakeflowSupportMemoryRequestModel(requestValue, signal);
  throwIfAborted(request.signal);
  await admitRoots(workspaceRootValue, supportRootValue, request);
  const declaration = request.catalog.declarations.find(
    (entry) =>
      entry.declarationId === `support.${request.surfaceId}.instruction.${request.profile.hostId}`,
  );
  if (declaration === undefined) fail("surface", "$request.surfaceId");
  let operation: Readonly<WakeflowResourceOperation>;
  try {
    operation = admitWakeflowResourceOperation(declaration.processing, "deterministic-rewrite");
  } catch (error: unknown) {
    if (error instanceof WakeflowResourceProcessingContractError) {
      fail("catalog", "$request.expectedCatalogDigest", error);
    }
    throw error;
  }
  const current = currentAuthority(request);
  const desired = desiredAuthority(request);
  const source = await readSource(supportRootValue, request);
  let transition: Readonly<WholeFileContentTransition>;
  try {
    transition = planWholeFileContentTransition(source?.bytes ?? null, {
      // C5（§13.167）：前序渲染作为额外 current 内容准入，旧记忆被重写为当前渲染而不是阻塞。
      currentContents:
        current === null
          ? []
          : [
              encodeUtf8(current.body),
              ...historicalWakeflowManagedTextBodies(
                WAKEFLOW_SUPPORT_MEMORY_BODY_HISTORY,
                current.body,
                request.currentConfig,
                request.profile,
                request.surfaceId,
              ).map((body) => encodeUtf8(body)),
            ],
      desiredContent: encodeUtf8(desired.body),
    });
  } catch (error: unknown) {
    if (error instanceof WholeFileContentTransitionError) {
      if (error.reason === "unadmitted-source") {
        fail("unadmitted-source", "$source", error);
      }
      fail("authority", error.path, error);
    }
    throw error;
  }
  if (
    transition.desiredByteCount > WAKEFLOW_SUPPORT_MEMORY_MAXIMUM_BYTES ||
    transition.desiredDigest !== desired.bodyDigest
  ) {
    fail("capacity", "$target");
  }
  await revalidateSource(supportRootValue, request, source);
  return Object.freeze({
    kind: "WakeflowSupportMemoryInspection",
    status: transition.disposition === "current" ? "current" : "publication-required",
    currentConfigDigest: request.currentConfigDigest,
    desiredConfigDigest: request.desiredConfigDigest,
    catalogDigest: request.catalog.catalogDigest,
    declaration,
    operation,
    currentAuthority: current,
    desiredAuthority: desired,
    source: source?.facts ?? null,
    transition,
  });
}
