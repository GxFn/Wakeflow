import { types } from "node:util";

import {
  computeWakeflowConfigV3Digest,
  parseWakeflowConfigV3,
  WakeflowConfigV3Error,
  type WakeflowConfigV3Model,
} from "../../configuration/wakeflow-config-v3.js";
import {
  validateWakeflowConfigRootPlacements,
  WakeflowConfigRootPlacementError,
} from "../../configuration/wakeflow-config-root-placement.js";
import {
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  readStableFile,
  StableFileReadError,
  type StableFileSource,
} from "../../foundation/filesystem/stable-file-read.js";
import {
  planWholeFileContentTransition,
  WholeFileContentTransitionError,
  type WholeFileContentTransition,
} from "../../foundation/filesystem/whole-file-content-transition.js";
import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../foundation/identity/wakeflow-durable-id.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import {
  admitWakeflowResourceOperation,
  WakeflowResourceProcessingContractError,
  type WakeflowResourceOperation,
} from "../../foundation/resource/resource-processing-contract.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import {
  parseWakeflowWorkspaceHostResourceProfile,
  WakeflowWorkspaceHostResourceProfileError,
  type WakeflowWorkspaceHostResourceProfile,
} from "../workspace-host-resource-profile.js";
import type {
  WakeflowWorkspaceResourceDeclaration,
} from "../workspace-resource-declaration.js";
import {
  createWakeflowManagedSupportResourceCatalog,
  type WakeflowManagedSupportResourceCatalog,
} from "./wakeflow-managed-support-resource-catalog.js";
import {
  createWakeflowSupportMemoryAuthority,
  WakeflowSupportMemoryAuthorityError,
  type WakeflowSupportMemoryAuthority,
} from "./wakeflow-support-memory-authority.js";
import {
  WAKEFLOW_MANAGED_SUPPORT_ROOT_MODE,
} from "./wakeflow-managed-support-root-materialization.js";

/**
 * Wakeflow Workspace / Support：whole-file memory 的只读检查。
 *
 * 本模块绑定 workspace/support 两个已打开根、current/desired Config 摘要、动态 Resource
 * Catalog、Support memory authority、稳定文件读取与 whole-file content transition。
 * source 只能缺失、精确等于 desired 或精确等于 current renderer；其他整文件字节拒绝。
 *
 * 它不创建 Support 根、不写 memory，也不决定 maintenance action 或旧根清理政策。
 */

export const WAKEFLOW_SUPPORT_MEMORY_MAXIMUM_BYTES = parseByteCount(
  256 * 1024,
  "$supportMemory.maximumBytes",
);
export const WAKEFLOW_SUPPORT_MEMORY_FILE_MODE = 0o644;

export interface WakeflowSupportMemoryInspectionRequest {
  readonly currentConfig: unknown | null;
  readonly expectedCurrentConfigDigest: Sha256Digest | null;
  readonly desiredConfig: unknown;
  readonly expectedDesiredConfigDigest: Sha256Digest;
  readonly profile: unknown;
  readonly expectedCatalogDigest: Sha256Digest;
  readonly surfaceId: unknown;
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
  | "input"
  | "config"
  | "profile"
  | "catalog"
  | "surface"
  | "placement"
  | "root-policy"
  | "authority"
  | "source"
  | "source-policy"
  | "unadmitted-source"
  | "capacity"
  | "aborted";

const ERROR_MESSAGES = {
  input: "Wakeflow support memory inspection input is invalid.",
  config: "Wakeflow support memory inspection config is invalid.",
  profile: "Wakeflow support memory inspection host profile is invalid.",
  catalog: "Wakeflow support memory inspection catalog is invalid.",
  surface: "Wakeflow support memory inspection surface is unavailable.",
  placement: "Wakeflow support memory root placement is inconsistent.",
  "root-policy": "Wakeflow support memory root violates its node policy.",
  authority: "Wakeflow support memory content authority is invalid.",
  source: "Wakeflow support memory source cannot be read stably.",
  "source-policy": "Wakeflow support memory source violates its node policy.",
  "unadmitted-source":
    "Wakeflow support memory source is not an admitted whole-file render.",
  capacity: "Wakeflow support memory exceeds its byte budget.",
  aborted: "Wakeflow support memory inspection was aborted.",
} as const satisfies Readonly<Record<
  WakeflowSupportMemoryInspectionErrorReason,
  string
>>;

/** Support memory 只读检查失败的稳定、脱敏错误。 */
export class WakeflowSupportMemoryInspectionError extends Error {
  override readonly name = "WakeflowSupportMemoryInspectionError";
  readonly code = "wakeflow-support-memory-inspection" as const;
  readonly reason: WakeflowSupportMemoryInspectionErrorReason;
  readonly path: string;

  constructor(reason: WakeflowSupportMemoryInspectionErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

export interface ParsedWakeflowSupportMemoryInspectionRequest {
  readonly currentConfig: WakeflowConfigV3Model | null;
  readonly currentConfigDigest: Sha256Digest | null;
  readonly desiredConfig: WakeflowConfigV3Model;
  readonly desiredConfigDigest: Sha256Digest;
  readonly profile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  readonly catalog: Readonly<WakeflowManagedSupportResourceCatalog>;
  readonly surfaceId: WakeflowDurableId<"surface">;
  readonly signal: AbortSignal | undefined;
}

function fail(
  reason: WakeflowSupportMemoryInspectionErrorReason,
  path: string,
): never {
  throw new WakeflowSupportMemoryInspectionError(reason, path);
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return typeof value === "object"
    && value !== null
    && !types.isProxy(value)
    && value instanceof AbortSignal;
}

function parseDigest(value: unknown, path: string): Sha256Digest {
  try {
    return parseSha256Digest(value, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("input", path);
    throw error;
  }
}

function parseConfig(value: unknown, path: string): WakeflowConfigV3Model {
  try {
    return parseWakeflowConfigV3(value);
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigV3Error) fail("config", path);
    throw error;
  }
}

/** 快照并绑定 current/desired Config、Host Profile、Catalog 与 Surface ID。 */
export function parseWakeflowSupportMemoryInspectionRequest(
  value: unknown,
): Readonly<ParsedWakeflowSupportMemoryInspectionRequest> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$request");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$request");
    throw error;
  }
  const required = [
    "currentConfig",
    "desiredConfig",
    "expectedCatalogDigest",
    "expectedCurrentConfigDigest",
    "expectedDesiredConfigDigest",
    "profile",
    "surfaceId",
  ];
  const expected = record.signal === undefined
    ? required
    : [...required, "signal"].sort();
  const keys = Object.keys(record).sort();
  if (
    keys.length !== expected.length
    || keys.some((key, index) => key !== expected[index])
    || (record.signal !== undefined && !isAbortSignal(record.signal))
  ) {
    fail("input", "$request");
  }
  const desiredConfig = parseConfig(record.desiredConfig, "$request.desiredConfig");
  const desiredConfigDigest = parseDigest(
    record.expectedDesiredConfigDigest,
    "$request.expectedDesiredConfigDigest",
  );
  if (computeWakeflowConfigV3Digest(desiredConfig) !== desiredConfigDigest) {
    fail("config", "$request.expectedDesiredConfigDigest");
  }
  let currentConfig: WakeflowConfigV3Model | null;
  let currentConfigDigest: Sha256Digest | null;
  if (record.currentConfig === null) {
    if (record.expectedCurrentConfigDigest !== null) {
      fail("input", "$request.expectedCurrentConfigDigest");
    }
    currentConfig = null;
    currentConfigDigest = null;
  } else {
    currentConfig = parseConfig(record.currentConfig, "$request.currentConfig");
    currentConfigDigest = parseDigest(
      record.expectedCurrentConfigDigest,
      "$request.expectedCurrentConfigDigest",
    );
    if (computeWakeflowConfigV3Digest(currentConfig) !== currentConfigDigest) {
      fail("config", "$request.expectedCurrentConfigDigest");
    }
    if (currentConfig.program.programId !== desiredConfig.program.programId) {
      fail("config", "$request.desiredConfig.program.programId");
    }
  }
  let profile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  try {
    profile = parseWakeflowWorkspaceHostResourceProfile(record.profile);
  } catch (error: unknown) {
    if (error instanceof WakeflowWorkspaceHostResourceProfileError) {
      fail("profile", "$request.profile");
    }
    throw error;
  }
  let surfaceId: WakeflowDurableId<"surface">;
  try {
    surfaceId = parseWakeflowDurableIdOfKind(
      record.surfaceId,
      "surface",
      "$request.surfaceId",
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) {
      fail("input", "$request.surfaceId");
    }
    throw error;
  }
  const catalog = createWakeflowManagedSupportResourceCatalog(
    desiredConfig,
    profile,
  );
  const expectedCatalogDigest = parseDigest(
    record.expectedCatalogDigest,
    "$request.expectedCatalogDigest",
  );
  if (catalog.catalogDigest !== expectedCatalogDigest) {
    fail("catalog", "$request.expectedCatalogDigest");
  }
  if (!catalog.declarations.some((entry) => (
    entry.declarationId === `support.${surfaceId}.root`
  ))) {
    fail("surface", "$request.surfaceId");
  }
  return Object.freeze({
    currentConfig,
    currentConfigDigest,
    desiredConfig,
    desiredConfigDigest,
    profile,
    catalog,
    surfaceId,
    signal: record.signal as AbortSignal | undefined,
  });
}

function assertRoot(value: unknown, path: string): asserts value is RootedDirectory {
  if (
    typeof value !== "object"
    || value === null
    || types.isProxy(value)
    || !(value instanceof RootedDirectory)
  ) {
    fail("input", path);
  }
}

function currentUserId(): bigint {
  if (process.platform === "win32" || typeof process.geteuid !== "function") {
    fail("root-policy", "$supportRoot");
  }
  return BigInt(process.geteuid());
}

async function admitRoots(
  workspaceRoot: RootedDirectory,
  supportRoot: RootedDirectory,
  request: Readonly<ParsedWakeflowSupportMemoryInspectionRequest>,
): Promise<void> {
  let report;
  try {
    report = await validateWakeflowConfigRootPlacements(
      workspaceRoot,
      request.desiredConfig,
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigRootPlacementError) {
      fail("placement", error.path);
    }
    throw error;
  }
  const placement = report.roots.find((entry) => (
    entry.key === `support.${request.surfaceId}.root`
  ));
  if (
    placement?.state !== "present"
    || placement.realPath !== supportRoot.absolutePath
  ) {
    fail("placement", "$supportRoot");
  }
  let node;
  try {
    node = await supportRoot.assertCurrent("$supportRoot");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) fail("placement", "$supportRoot");
    throw error;
  }
  if (
    node.kind !== "directory"
    || node.permissionBits !== WAKEFLOW_MANAGED_SUPPORT_ROOT_MODE
    || node.userId !== currentUserId()
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
    if (
      error instanceof WakeflowSupportMemoryAuthorityError
      && error.reason === "surface"
    ) {
      return null;
    }
    if (error instanceof WakeflowSupportMemoryAuthorityError) {
      fail("authority", error.path);
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
      fail(error.reason === "surface" ? "surface" : "authority", error.path);
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
    const read = await readStableFile(
      supportRoot,
      request.profile.instructionFileName,
      {
        maximumBytes: WAKEFLOW_SUPPORT_MEMORY_MAXIMUM_BYTES,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      },
    );
    if (
      read.node.kind !== "file"
      || read.node.permissionBits !== WAKEFLOW_SUPPORT_MEMORY_FILE_MODE
      || read.node.linkCount !== 1n
      || read.node.userId !== currentUserId()
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
      if (error.reason === "not-found") return null;
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "too-large") fail("capacity", "$source");
      if (error.reason === "symlink" || error.reason === "not-file") {
        fail("source-policy", "$source");
      }
      fail("source", "$source");
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
    const current = await readStableFile(
      supportRoot,
      request.profile.instructionFileName,
      {
        maximumBytes: WAKEFLOW_SUPPORT_MEMORY_MAXIMUM_BYTES,
        ...(initial === null ? {} : { expectedNode: initial.facts.node }),
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      },
    );
    if (
      initial === null
      || current.digest !== initial.facts.digest
      || current.byteCount !== initial.facts.byteCount
    ) {
      fail("source", "$source");
    }
  } catch (error: unknown) {
    if (error instanceof WakeflowSupportMemoryInspectionError) throw error;
    if (error instanceof StableFileReadError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (initial === null && error.reason === "not-found") return;
      fail("source", "$source");
    }
    throw error;
  }
}

/** 检查一个已物化 Support 根内的 whole-file memory，并生成零写入候选。 */
export async function inspectWakeflowSupportMemory(
  workspaceRootValue: RootedDirectory,
  supportRootValue: RootedDirectory,
  requestValue: WakeflowSupportMemoryInspectionRequest,
): Promise<Readonly<WakeflowSupportMemoryInspection>> {
  assertRoot(workspaceRootValue, "$workspaceRoot");
  assertRoot(supportRootValue, "$supportRoot");
  const request = parseWakeflowSupportMemoryInspectionRequest(requestValue);
  if (request.signal?.aborted === true) fail("aborted", "$signal");
  await admitRoots(workspaceRootValue, supportRootValue, request);
  const declaration = request.catalog.declarations.find((entry) => (
    entry.declarationId
      === `support.${request.surfaceId}.instruction.${request.profile.hostId}`
  ));
  if (declaration === undefined) fail("surface", "$request.surfaceId");
  let operation: Readonly<WakeflowResourceOperation>;
  try {
    operation = admitWakeflowResourceOperation(
      declaration.processing,
      "deterministic-rewrite",
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowResourceProcessingContractError) {
      fail("catalog", "$request.expectedCatalogDigest");
    }
    throw error;
  }
  const current = currentAuthority(request);
  const desired = desiredAuthority(request);
  const source = await readSource(supportRootValue, request);
  let transition: Readonly<WholeFileContentTransition>;
  try {
    transition = planWholeFileContentTransition(
      source?.bytes ?? null,
      {
        currentContents: current === null ? [] : [encodeUtf8(current.body)],
        desiredContent: encodeUtf8(desired.body),
      },
    );
  } catch (error: unknown) {
    if (error instanceof WholeFileContentTransitionError) {
      if (error.reason === "unadmitted-source") {
        fail("unadmitted-source", "$source");
      }
      fail("authority", error.path);
    }
    throw error;
  }
  if (
    transition.desiredByteCount > WAKEFLOW_SUPPORT_MEMORY_MAXIMUM_BYTES
    || transition.desiredDigest !== desired.bodyDigest
  ) {
    fail("capacity", "$target");
  }
  await revalidateSource(supportRootValue, request, source);
  return Object.freeze({
    kind: "WakeflowSupportMemoryInspection",
    status: transition.disposition === "current"
      ? "current"
      : "publication-required",
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
