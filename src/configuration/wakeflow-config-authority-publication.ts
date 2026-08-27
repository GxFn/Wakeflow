import { types } from "node:util";

import type { Sha256Digest } from "../foundation/crypto/sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../foundation/data/passive-own-data.js";
import {
  createFileAtomically,
  DurableAtomicFileWriteError,
  type DurableAtomicFileWriteResult,
} from "../foundation/filesystem/durable-atomic-file-write.js";
import {
  sameFileNodeSnapshot,
} from "../foundation/filesystem/file-node-snapshot.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../foundation/filesystem/rooted-directory.js";
import { encodeUtf8, Utf8Error } from "../foundation/text/utf8.js";
import {
  readWakeflowConfigAuthoritySnapshot,
  WakeflowConfigAuthoritySnapshotError,
  WAKEFLOW_CONFIG_FILE_REF,
  WAKEFLOW_CONFIG_MAXIMUM_BYTES,
  type WakeflowConfigAuthoritySnapshot,
} from "./wakeflow-config-authority-snapshot.js";
import {
  validateWakeflowConfigRootPlacements,
  WakeflowConfigRootPlacementError,
} from "./wakeflow-config-root-placement.js";
import {
  computeWakeflowConfigV3Digest,
  parseWakeflowConfigV3,
  WakeflowConfigV3Error,
  type WakeflowConfigV3Model,
} from "./wakeflow-config-v3.js";
import { renderWakeflowConfigV3 } from "./wakeflow-config-v3-document.js";

/**
 * Wakeflow Configuration：严格 v3 Config 权威记录的仅限首次创建持久发布。
 *
 * 本模块只负责首次创建单个 Config 资源。它先准入无副作用的选项数据，验证 POSIX
 * 根目录所有者、严格模型、1 MiB 确定性字节和全部配置根目录位置，再复用 Foundation
 * 原子创建能力完成不替换目标的发布。最后，模块通过 Config Authority Snapshot 回读
 * 同一文件系统节点、源摘要和配置摘要。成功回执同时证明物理发布和领域准入成立。
 *
 * 本模块不替换已有配置、不创建 Workspace 目录、不持有锁、不生成维护计划，也不解释
 * 完整的首次初始化流程。替换、锁和非活动残留由 INF-1 的后续独立模块负责；任何原子
 * 提交后的回读校验失败都返回“提交结果不确定”。
 */

export const WAKEFLOW_CONFIG_AUTHORITY_FILE_MODE = 0o644;

export interface WakeflowConfigAuthorityPublicationOptions {
  readonly signal?: AbortSignal;
}

export interface WakeflowConfigAuthorityPublicationReceipt {
  readonly disposition: "published";
  readonly publication: Readonly<DurableAtomicFileWriteResult<"created">>;
  readonly authority: Readonly<WakeflowConfigAuthoritySnapshot>;
}

export type WakeflowConfigAuthorityPublicationErrorReason =
  | "input"
  | "unsupported-platform"
  | "root-scope"
  | "root-policy"
  | "config"
  | "capacity"
  | "placement"
  | "target-exists"
  | "aborted"
  | "publication-failure"
  | "commit-uncertain";

const ERROR_MESSAGES = {
  "input": "Wakeflow config authority publication input is invalid.",
  "unsupported-platform": "Wakeflow config authority publication requires reliable local POSIX ownership semantics.",
  "root-scope": "Wakeflow config authority publication lost its workspace root scope.",
  "root-policy": "Wakeflow config authority publication requires a current-user workspace root.",
  "config": "Wakeflow config authority publication requires one strict v3 model.",
  "capacity": "Wakeflow config authority publication exceeds its recoverable byte limit.",
  "placement": "Wakeflow config authority publication declares an unsafe root placement.",
  "target-exists": "Wakeflow config authority already exists.",
  "aborted": "Wakeflow config authority publication was aborted before commit.",
  "publication-failure": "Wakeflow config authority could not be published safely.",
  "commit-uncertain": "Published Wakeflow config authority could not be proven exact.",
} as const satisfies Readonly<Record<
  WakeflowConfigAuthorityPublicationErrorReason,
  string
>>;

/** Config 首次发布失败时返回的稳定、脱敏错误。 */
export class WakeflowConfigAuthorityPublicationError extends Error {
  override readonly name = "WakeflowConfigAuthorityPublicationError";
  readonly code = "wakeflow-config-authority-publication" as const;
  readonly reason: WakeflowConfigAuthorityPublicationErrorReason;
  readonly path: string;

  constructor(
    reason: WakeflowConfigAuthorityPublicationErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface ParsedOptions {
  readonly signal: AbortSignal | undefined;
}

function fail(
  reason: WakeflowConfigAuthorityPublicationErrorReason,
  path: string,
): never {
  throw new WakeflowConfigAuthorityPublicationError(reason, path);
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

function isAbortSignal(value: unknown): value is AbortSignal {
  return typeof value === "object"
    && value !== null
    && !types.isProxy(value)
    && value instanceof AbortSignal;
}

function parseOptions(value: unknown): Readonly<ParsedOptions> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value === undefined ? {} : value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }
  if (
    Object.keys(record).some((key) => key !== "signal")
    || (record.signal !== undefined && !isAbortSignal(record.signal))
  ) {
    fail("input", "$options");
  }
  return Object.freeze({
    signal: record.signal as AbortSignal | undefined,
  });
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) fail("aborted", "$signal");
}

function currentEffectiveUserId(): bigint {
  if (process.platform === "win32" || typeof process.geteuid !== "function") {
    fail("unsupported-platform", "$root");
  }
  return BigInt(process.geteuid());
}

async function assertCurrentUserRoot(
  root: RootedDirectory,
  expectedUserId: bigint,
): Promise<void> {
  try {
    const node = await root.assertCurrent("$root");
    if (node.userId !== expectedUserId) fail("root-policy", "$root");
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigAuthorityPublicationError) throw error;
    if (error instanceof RootedDirectoryError) fail("root-scope", "$root");
    fail("root-scope", "$root");
  }
}

function parseModel(value: unknown): WakeflowConfigV3Model {
  try {
    return parseWakeflowConfigV3(value);
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigV3Error) fail("config", error.path);
    fail("config", "$config");
  }
}

function renderModelBytes(model: WakeflowConfigV3Model): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = encodeUtf8(renderWakeflowConfigV3(model), "$config");
  } catch (error: unknown) {
    if (
      error instanceof WakeflowConfigV3Error
      || error instanceof Utf8Error
    ) {
      fail("config", "$config");
    }
    fail("config", "$config");
  }
  if (bytes.byteLength > WAKEFLOW_CONFIG_MAXIMUM_BYTES) {
    fail("capacity", "$config");
  }
  return bytes;
}

async function assertPlacements(
  root: RootedDirectory,
  model: WakeflowConfigV3Model,
): Promise<void> {
  try {
    await validateWakeflowConfigRootPlacements(root, model);
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigRootPlacementError) {
      if (error.reason === "root-scope") fail("root-scope", "$root");
      if (error.reason === "input") fail("input", error.path);
      fail("placement", error.path);
    }
    fail("placement", "$placements");
  }
}

function computeModelDigest(model: WakeflowConfigV3Model): Sha256Digest {
  try {
    return computeWakeflowConfigV3Digest(model);
  } catch {
    fail("config", "$config");
  }
}

function mapAtomicWriteError(error: DurableAtomicFileWriteError): never {
  if (error.reason === "target-exists") {
    fail("target-exists", "$resourcePath");
  }
  if (error.reason === "input") fail("input", error.path);
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (error.reason === "capacity") fail("capacity", "$config");
  if (
    error.reason === "root-scope"
    || error.reason === "parent-changed"
  ) {
    fail("root-scope", "$root");
  }
  if (
    error.reason === "commit-uncertain"
    || error.reason === "durability-failure"
    || error.reason === "stage-cleanup-failure"
    || error.reason === "close-failure"
  ) {
    fail("commit-uncertain", "$resourcePath");
  }
  fail("publication-failure", "$resourcePath");
}

async function publishBytes(
  root: RootedDirectory,
  bytes: Uint8Array,
  signal: AbortSignal | undefined,
): Promise<Readonly<DurableAtomicFileWriteResult<"created">>> {
  try {
    return await createFileAtomically(root, WAKEFLOW_CONFIG_FILE_REF, bytes, {
      mode: WAKEFLOW_CONFIG_AUTHORITY_FILE_MODE,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof DurableAtomicFileWriteError) {
      mapAtomicWriteError(error);
    }
    fail("publication-failure", "$resourcePath");
  }
}

async function readBackCommittedAuthority(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<Readonly<WakeflowConfigAuthoritySnapshot>> {
  try {
    return await readWakeflowConfigAuthoritySnapshot(
      root,
      signal === undefined ? undefined : { signal },
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigAuthoritySnapshotError) {
      fail("commit-uncertain", "$resourcePath");
    }
    fail("commit-uncertain", "$resourcePath");
  }
}

function assertReadback(
  publication: Readonly<DurableAtomicFileWriteResult<"created">>,
  authority: Readonly<WakeflowConfigAuthoritySnapshot>,
  expectedConfigDigest: Sha256Digest,
  expectedUserId: bigint,
): void {
  if (
    publication.resourcePath !== WAKEFLOW_CONFIG_FILE_REF
    || publication.node.kind !== "file"
    || publication.node.permissionBits !== WAKEFLOW_CONFIG_AUTHORITY_FILE_MODE
    || publication.node.linkCount !== 1n
    || publication.node.userId !== expectedUserId
    || authority.source.resourcePath !== publication.resourcePath
    || authority.source.byteCount !== publication.byteCount
    || authority.source.digest !== publication.digest
    || !sameFileNodeSnapshot(authority.source.node, publication.node)
    || authority.configDigest !== expectedConfigDigest
  ) {
    fail("commit-uncertain", "$resourcePath");
  }
}

/**
 * 从严格 v3 模型持久创建此前不存在的 `wakeflow.config.json`。
 *
 * 只有 Foundation 已同步文件与父目录，且 Config Snapshot 回读同一物理节点和语义
 * 权威事实后，函数才返回成功。任意现存目标一律拒绝；本入口不提供确保存在、替换
 * 或隐式修复语义。
 */
export async function publishWakeflowConfigAuthority(
  root: RootedDirectory,
  modelValue: unknown,
  options?: WakeflowConfigAuthorityPublicationOptions,
): Promise<Readonly<WakeflowConfigAuthorityPublicationReceipt>> {
  assertRoot(root);
  const parsed = parseOptions(options);
  assertNotAborted(parsed.signal);
  const expectedUserId = currentEffectiveUserId();
  const model = parseModel(modelValue);
  const bytes = renderModelBytes(model);
  const expectedConfigDigest = computeModelDigest(model);

  await assertCurrentUserRoot(root, expectedUserId);
  await assertPlacements(root, model);
  // 位置检查可能触及多个同级根目录；提交前再次确认 Workspace 根目录所有者和当前状态。
  await assertCurrentUserRoot(root, expectedUserId);
  assertNotAborted(parsed.signal);

  const publication = await publishBytes(root, bytes, parsed.signal);
  // 发布已经跨过不替换目标的提交点；此后的失败不能再表述为“提交前已取消”。
  const authority = await readBackCommittedAuthority(root, parsed.signal);
  assertReadback(
    publication,
    authority,
    expectedConfigDigest,
    expectedUserId,
  );
  return Object.freeze({
    disposition: "published" as const,
    publication,
    authority,
  });
}
