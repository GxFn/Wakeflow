import { types } from "node:util";

import {
  parseSha256Digest,
  type Sha256Digest,
  Sha256Error,
} from "../../foundation/crypto/sha256.js";
import {
  PassiveOwnDataError,
  parsePlainRecord,
} from "../../foundation/data/passive-own-data.js";
import {
  createFileAtomically,
  DurableAtomicFileWriteError,
  replaceFileAtomically,
} from "../../foundation/filesystem/durable-atomic-file-write.js";
import {
  DurableDirectoryMaterializationError,
  materializeDirectoryPath,
} from "../../foundation/filesystem/durable-directory-materialization.js";
import {
  type PortableResourcePath,
  parsePortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import {
  readStableFile,
  StableFileReadError,
  type StableFileSource,
} from "../../foundation/filesystem/stable-file-read.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import { hostRuntimeRootRef } from "../../kernel/layout.js";
import type { WakeflowHostMaintenanceOperationInput } from "../../workspace/maintenance/wakeflow-host-maintenance-contribution.js";

/**
 * Wakeflow Host / Claude Code：宿主资产的通用维护操作（gate-log §13.94 D6 的状态栏资产机制，
 * §13.117 D4 推广到 tmux 助手）。
 *
 * 一份资产就是 Wakeflow 私有运行时目录 `operations/assets`（0700）里的一个精确字节文件（0600）。
 * 计划只读：字节与模式等于期望即无操作；缺失或不同即一条操作。执行是单文件 CAS：缺失创建、
 * 不同替换；affected 恢复接受目标已提交。资产的文件名、字节、摘要与操作身份由描述符给出，
 * 本模块不认识任何一份具体资产。
 */

export interface ClaudeCodeHostAssetDescriptor {
  readonly fileName: string;
  readonly ref: PortableResourcePath;
  /** 资产的精确字节：维护事务写入的就是这一份，verify 按它核对。 */
  readonly content: string;
  readonly digest: Sha256Digest;
  readonly operationId: string;
  readonly operationKind: string;
  readonly ownerId: string;
  readonly targetKey: string;
}

interface ClaudeCodeHostAssetOperationPayload {
  readonly fileName: string;
  readonly digest: Sha256Digest;
}

export interface ExecuteClaudeCodeHostAssetOperationRequest {
  readonly operation: unknown;
  readonly recoveringAffectedOperation: boolean;
  readonly signal?: AbortSignal;
}

export interface ClaudeCodeHostAssetOperationResult {
  readonly operationId: string;
  readonly disposition: "current" | "created" | "updated";
  readonly targetDigest: Sha256Digest;
}

export type ClaudeCodeHostAssetOperationErrorReason =
  | "input"
  | "operation"
  | "read"
  | "source-stale"
  | "write"
  | "aborted";

const ERROR_MESSAGES = {
  input: "Claude host asset operation input is invalid.",
  operation: "Claude host asset operation payload is invalid.",
  read: "Claude host asset could not be read safely.",
  "source-stale": "Claude host asset changed since the plan was made.",
  write: "Claude host asset could not be written safely.",
  aborted: "Claude host asset operation was aborted.",
} as const satisfies Readonly<Record<ClaudeCodeHostAssetOperationErrorReason, string>>;

/** 宿主资产操作失败的稳定、脱敏错误。 */
export class ClaudeCodeHostAssetOperationError extends Error {
  override readonly name = "ClaudeCodeHostAssetOperationError";
  readonly code = "wakeflow-claude-code-host-asset-operation" as const;
  readonly reason: ClaudeCodeHostAssetOperationErrorReason;
  readonly path: string;

  constructor(reason: ClaudeCodeHostAssetOperationErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function fail(reason: ClaudeCodeHostAssetOperationErrorReason, path: string): never {
  throw new ClaudeCodeHostAssetOperationError(reason, path);
}

const ASSET_MAXIMUM_BYTES = parseByteCount(256 * 1024, "$asset.maximumBytes");
const ASSET_MODE = 0o600;
const DIRECTORY_MODE = 0o700;
const ASSETS_DIRECTORY_REF = parsePortableResourcePath(
  `${hostRuntimeRootRef("claude-code")}/operations/assets`,
  "$asset",
);

function signalOptions(signal: AbortSignal | undefined): { readonly signal?: AbortSignal } {
  return signal === undefined ? {} : { signal };
}

function assertRoot(root: unknown): asserts root is RootedDirectory {
  if (
    typeof root !== "object"
    || root === null
    || types.isProxy(root)
    || !(root instanceof RootedDirectory)
  ) {
    fail("input", "$root");
  }
}

/** 当前资产的稳定来源；缺失为 null。 */
async function currentAsset(
  root: RootedDirectory,
  asset: Readonly<ClaudeCodeHostAssetDescriptor>,
  signal: AbortSignal | undefined,
): Promise<Readonly<StableFileSource> | null> {
  try {
    const read = await readStableFile(root, asset.ref, {
      maximumBytes: ASSET_MAXIMUM_BYTES,
      ...signalOptions(signal),
    });
    return Object.freeze({
      resourcePath: read.resourcePath,
      node: read.node,
      byteCount: read.byteCount,
      digest: read.digest,
    });
  } catch (error: unknown) {
    if (error instanceof StableFileReadError) {
      if (error.reason === "not-found") return null;
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("read", "$asset");
    }
    throw error;
  }
}

/** 零写计划：字节已是期望即 null，否则一条操作（sourceDigest 是当前字节摘要或 null）。 */
export async function planClaudeCodeHostAssetOperation(
  root: RootedDirectory,
  asset: Readonly<ClaudeCodeHostAssetDescriptor>,
  options: { readonly signal?: AbortSignal } = {},
): Promise<WakeflowHostMaintenanceOperationInput | null> {
  assertRoot(root);
  const current = await currentAsset(root, asset, options.signal);
  if (
    current !== null
    && current.digest === asset.digest
    && current.node.permissionBits === ASSET_MODE
  ) {
    return null;
  }
  return Object.freeze({
    operationId: asset.operationId,
    operationKind: asset.operationKind,
    ownerId: asset.ownerId,
    targetKey: asset.targetKey,
    sourceDigest: current?.digest ?? null,
    targetDigest: asset.digest,
    payload: {
      fileName: asset.fileName,
      digest: asset.digest,
    },
  });
}

function parsePayload(
  value: unknown,
  asset: Readonly<ClaudeCodeHostAssetDescriptor>,
): Readonly<ClaudeCodeHostAssetOperationPayload> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$operation");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("operation", error.path);
    throw error;
  }
  let digest: Sha256Digest;
  try {
    digest = parseSha256Digest(record.digest, "$operation.digest");
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("operation", "$operation.digest");
    throw error;
  }
  if (
    Object.keys(record).sort().join(" ") !== "digest fileName"
    || record.fileName !== asset.fileName
    || digest !== asset.digest
  ) {
    fail("operation", "$operation");
  }
  return Object.freeze({ fileName: asset.fileName, digest });
}

async function ensureAssetsDirectory(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    await materializeDirectoryPath(root, ASSETS_DIRECTORY_REF, {
      mode: DIRECTORY_MODE,
      ...signalOptions(signal),
    });
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryMaterializationError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("write", "$asset.directory");
    }
    throw error;
  }
}

/** 执行：缺失创建、不同 CAS 替换；已是期望字节即 current（恢复与普通执行同一判定）。 */
export async function executeClaudeCodeHostAssetOperation(
  root: RootedDirectory,
  asset: Readonly<ClaudeCodeHostAssetDescriptor>,
  request: Readonly<ExecuteClaudeCodeHostAssetOperationRequest>,
): Promise<Readonly<ClaudeCodeHostAssetOperationResult>> {
  assertRoot(root);
  const payload = parsePayload(request.operation, asset);
  const current = await currentAsset(root, asset, request.signal);
  if (
    current !== null
    && current.digest === payload.digest
    && current.node.permissionBits === ASSET_MODE
  ) {
    return Object.freeze({
      operationId: asset.operationId,
      disposition: "current" as const,
      targetDigest: payload.digest,
    });
  }
  const bytes = encodeUtf8(asset.content, "$asset");
  try {
    if (current === null) {
      await ensureAssetsDirectory(root, request.signal);
      await createFileAtomically(root, asset.ref, bytes, {
        mode: ASSET_MODE,
        ...signalOptions(request.signal),
      });
      return Object.freeze({
        operationId: asset.operationId,
        disposition: "created" as const,
        targetDigest: payload.digest,
      });
    }
    await replaceFileAtomically(root, asset.ref, bytes, {
      mode: ASSET_MODE,
      expected: current,
      ...signalOptions(request.signal),
    });
  } catch (error: unknown) {
    if (error instanceof DurableAtomicFileWriteError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "expectation-changed" || error.reason === "target-exists") {
        fail("source-stale", "$asset");
      }
      fail("write", "$asset");
    }
    throw error;
  }
  return Object.freeze({
    operationId: asset.operationId,
    disposition: "updated" as const,
    targetDigest: payload.digest,
  });
}
