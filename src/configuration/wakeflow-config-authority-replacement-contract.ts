import { types } from "node:util";

import {
  computeSha256Digest,
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../foundation/crypto/sha256.js";
import {
  parsePlainRecord,
  pickOwnDataProperties,
  PassiveOwnDataError,
} from "../foundation/data/passive-own-data.js";
import {
  DurableAtomicFileWriteError,
  type DurableAtomicFileReplaceResult,
} from "../foundation/filesystem/durable-atomic-file-write.js";
import {
  parseDurableAtomicFileReplaceOptions,
} from "../foundation/filesystem/durable-atomic-file-write-contract.js";
import {
  FileNodeSnapshotError,
  sameFileNodeSnapshot,
} from "../foundation/filesystem/file-node-snapshot.js";
import { parsePortableResourcePath } from "../foundation/filesystem/portable-resource-path.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../foundation/filesystem/rooted-directory.js";
import {
  RootedExclusiveFileLockError,
  type RootedExclusiveFileLockOptions,
} from "../foundation/filesystem/rooted-exclusive-file-lock.js";
import type { StableFileSource } from "../foundation/filesystem/stable-file-read.js";
import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../foundation/identity/wakeflow-durable-id.js";
import { encodeUtf8, Utf8Error } from "../foundation/text/utf8.js";
import { WAKEFLOW_CONFIG_AUTHORITY_FILE_MODE } from "./wakeflow-config-authority-publication.js";
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
 * Config 替换流程的领域合同、无副作用输入准入，以及共享的源资源和目标事实。
 *
 * 本模块由正常替换和显式恢复共同使用，不执行文件替换、暂存文件清理或锁残留退休。
 * 错误、P1 所有者与权限策略、调用方预期和目标字节在此保持唯一解释，避免两条路径
 * 形成不同的 Config 权威记录准入规则。
 */

export const WAKEFLOW_CONFIG_AUTHORITY_LOCK_REF = parsePortableResourcePath(
  ".wakeflow-config-authority.lock",
);
export const WAKEFLOW_CONFIG_AUTHORITY_LOCK_TIMEOUT_MILLISECONDS = 10_000;

export interface WakeflowConfigAuthorityReplacementOptions {
  readonly acquireTimeoutMilliseconds?: number;
  readonly retryDelayMilliseconds?: number;
  readonly signal?: AbortSignal;
}

export interface WakeflowConfigAuthorityReplacementRecoveryOptions {
  readonly signal?: AbortSignal;
}

export interface WakeflowConfigAuthorityReplacementReceipt {
  readonly disposition: "current" | "replaced";
  readonly source: Readonly<WakeflowConfigAuthoritySnapshot>;
  readonly effect: Readonly<DurableAtomicFileReplaceResult> | null;
  readonly authority: Readonly<WakeflowConfigAuthoritySnapshot>;
}

export interface WakeflowConfigAuthorityReplacementRecoveryReceipt {
  readonly disposition: "recovered";
  readonly replacement: Readonly<WakeflowConfigAuthorityReplacementReceipt>;
}

export type WakeflowConfigAuthorityReplacementErrorReason =
  | "input"
  | "unsupported-platform"
  | "root-scope"
  | "root-policy"
  | "config"
  | "capacity"
  | "placement"
  | "source-invalid"
  | "source-policy"
  | "program-identity"
  | "conflict"
  | "lock-timeout"
  | "lock-unsafe"
  | "recovery-not-required"
  | "recovery-required"
  | "aborted"
  | "replacement-failure"
  | "commit-uncertain";

const ERROR_MESSAGES = {
  "input": "Wakeflow config authority replacement input is invalid.",
  "unsupported-platform": "Wakeflow config authority replacement requires reliable local POSIX ownership semantics.",
  "root-scope": "Wakeflow config authority replacement lost its workspace root scope.",
  "root-policy": "Wakeflow config authority replacement requires a current-user workspace root.",
  "config": "Wakeflow config authority replacement requires one strict v3 desired model.",
  "capacity": "Wakeflow config authority replacement exceeds its recoverable byte limit.",
  "placement": "Wakeflow config authority replacement declares an unsafe root placement.",
  "source-invalid": "Current Wakeflow config authority cannot be loaded strictly.",
  "source-policy": "Current Wakeflow config authority violates replacement source policy.",
  "program-identity": "Wakeflow config authority replacement cannot change program identity.",
  "conflict": "Wakeflow config authority no longer matches its expected source.",
  "lock-timeout": "Wakeflow config authority replacement lock acquisition timed out.",
  "lock-unsafe": "Wakeflow config authority replacement lock is unsafe.",
  "recovery-not-required": "Wakeflow config authority replacement has no lock residue to recover.",
  "recovery-required": "Wakeflow config authority replacement residue cannot be recovered automatically.",
  "aborted": "Wakeflow config authority replacement was aborted before commit.",
  "replacement-failure": "Wakeflow config authority could not be replaced safely.",
  "commit-uncertain": "Replaced Wakeflow config authority could not be proven exact.",
} as const satisfies Readonly<Record<
  WakeflowConfigAuthorityReplacementErrorReason,
  string
>>;

/** Config replacement 与显式恢复的稳定、脱敏错误。 */
export class WakeflowConfigAuthorityReplacementError extends Error {
  override readonly name = "WakeflowConfigAuthorityReplacementError";
  readonly code = "wakeflow-config-authority-replacement" as const;
  readonly reason: WakeflowConfigAuthorityReplacementErrorReason;
  readonly path: string;

  constructor(
    reason: WakeflowConfigAuthorityReplacementErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

export interface ParsedWakeflowConfigAuthorityReplacementOptions {
  readonly acquireTimeoutMilliseconds: number;
  readonly retryDelayMilliseconds: number | undefined;
  readonly signal: AbortSignal | undefined;
}

export interface ParsedWakeflowConfigAuthorityRecoveryOptions {
  readonly signal: AbortSignal | undefined;
}

export interface ParsedWakeflowConfigAuthorityExpectation {
  readonly workspaceRoot: string;
  readonly source: Readonly<StableFileSource>;
  readonly configDigest: Sha256Digest;
  readonly programId: WakeflowDurableId<"program">;
}

export interface PreparedWakeflowConfigAuthorityDesired {
  readonly model: WakeflowConfigV3Model;
  readonly bytes: Uint8Array;
  readonly sourceDigest: Sha256Digest;
  readonly configDigest: Sha256Digest;
}

export function failWakeflowConfigAuthorityReplacement(
  reason: WakeflowConfigAuthorityReplacementErrorReason,
  path: string,
): never {
  throw new WakeflowConfigAuthorityReplacementError(reason, path);
}

export function assertWakeflowConfigAuthorityRoot(
  value: unknown,
): asserts value is RootedDirectory {
  if (
    typeof value !== "object"
    || value === null
    || types.isProxy(value)
    || !(value instanceof RootedDirectory)
  ) {
    failWakeflowConfigAuthorityReplacement("input", "$root");
  }
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return typeof value === "object"
    && value !== null
    && !types.isProxy(value)
    && value instanceof AbortSignal;
}

function optionRecord(value: unknown): Readonly<Record<string, unknown>> {
  try {
    return parsePlainRecord(value === undefined ? {} : value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) {
      failWakeflowConfigAuthorityReplacement("input", "$options");
    }
    failWakeflowConfigAuthorityReplacement("input", "$options");
  }
}

function parsePositiveMilliseconds(value: unknown, path: string): number {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value <= 0
    || value > 300_000
  ) {
    failWakeflowConfigAuthorityReplacement("input", path);
  }
  return value;
}

function parseSignal(value: unknown): AbortSignal | undefined {
  if (value === undefined) return undefined;
  if (!isAbortSignal(value)) {
    failWakeflowConfigAuthorityReplacement("input", "$options.signal");
  }
  return value;
}

export function parseWakeflowConfigAuthorityReplacementOptions(
  value: unknown,
): Readonly<ParsedWakeflowConfigAuthorityReplacementOptions> {
  const record = optionRecord(value);
  const allowed = new Set([
    "acquireTimeoutMilliseconds",
    "retryDelayMilliseconds",
    "signal",
  ]);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    failWakeflowConfigAuthorityReplacement("input", "$options");
  }
  return Object.freeze({
    acquireTimeoutMilliseconds: record.acquireTimeoutMilliseconds === undefined
      ? WAKEFLOW_CONFIG_AUTHORITY_LOCK_TIMEOUT_MILLISECONDS
      : parsePositiveMilliseconds(
          record.acquireTimeoutMilliseconds,
          "$options.acquireTimeoutMilliseconds",
        ),
    retryDelayMilliseconds: record.retryDelayMilliseconds === undefined
      ? undefined
      : parsePositiveMilliseconds(
          record.retryDelayMilliseconds,
          "$options.retryDelayMilliseconds",
        ),
    signal: parseSignal(record.signal),
  });
}

export function parseWakeflowConfigAuthorityRecoveryOptions(
  value: unknown,
): Readonly<ParsedWakeflowConfigAuthorityRecoveryOptions> {
  const record = optionRecord(value);
  if (Object.keys(record).some((key) => key !== "signal")) {
    failWakeflowConfigAuthorityReplacement("input", "$options");
  }
  return Object.freeze({ signal: parseSignal(record.signal) });
}

export function assertWakeflowConfigAuthorityNotAborted(
  signal: AbortSignal | undefined,
): void {
  if (signal?.aborted === true) {
    failWakeflowConfigAuthorityReplacement("aborted", "$signal");
  }
}

export function currentWakeflowConfigAuthorityUserId(): bigint {
  if (process.platform === "win32" || typeof process.geteuid !== "function") {
    failWakeflowConfigAuthorityReplacement("unsupported-platform", "$root");
  }
  return BigInt(process.geteuid());
}

export async function assertCurrentUserWakeflowConfigAuthorityRoot(
  root: RootedDirectory,
  expectedUserId: bigint,
): Promise<void> {
  try {
    const node = await root.assertCurrent("$root");
    if (node.userId !== expectedUserId) {
      failWakeflowConfigAuthorityReplacement("root-policy", "$root");
    }
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigAuthorityReplacementError) throw error;
    if (error instanceof RootedDirectoryError) {
      failWakeflowConfigAuthorityReplacement("root-scope", "$root");
    }
    failWakeflowConfigAuthorityReplacement("root-scope", "$root");
  }
}

export function parseWakeflowConfigAuthorityExpectation(
  value: unknown,
  expectedUserId: bigint,
): Readonly<ParsedWakeflowConfigAuthorityExpectation> {
  let projected;
  let modelProjected;
  let programProjected;
  let sourceProjected;
  try {
    projected = pickOwnDataProperties(
      value,
      ["configDigest", "model", "source", "workspaceRoot"] as const,
      "$expected",
    );
    modelProjected = pickOwnDataProperties(
      projected.model,
      ["program"] as const,
      "$/expected/model",
    );
    programProjected = pickOwnDataProperties(
      modelProjected.program,
      ["programId"] as const,
      "$/expected/model/program",
    );
    sourceProjected = pickOwnDataProperties(
      projected.source,
      ["byteCount", "digest", "node", "resourcePath"] as const,
      "$/expected/source",
    );
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) {
      failWakeflowConfigAuthorityReplacement("input", "$expected");
    }
    failWakeflowConfigAuthorityReplacement("input", "$expected");
  }
  if (
    typeof projected.workspaceRoot !== "string"
    || projected.configDigest === undefined
    || programProjected.programId === undefined
    || sourceProjected.byteCount === undefined
    || sourceProjected.digest === undefined
    || sourceProjected.node === undefined
    || sourceProjected.resourcePath === undefined
  ) {
    failWakeflowConfigAuthorityReplacement("input", "$expected");
  }
  let configDigest: Sha256Digest;
  try {
    configDigest = parseSha256Digest(
      projected.configDigest,
      "$/expected/configDigest",
    );
  } catch (error: unknown) {
    if (error instanceof Sha256Error) {
      failWakeflowConfigAuthorityReplacement("input", "$/expected/configDigest");
    }
    failWakeflowConfigAuthorityReplacement("input", "$/expected/configDigest");
  }
  let programId: WakeflowDurableId<"program">;
  try {
    programId = parseWakeflowDurableIdOfKind(
      programProjected.programId,
      "program",
      "$/expected/model/program/programId",
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) {
      failWakeflowConfigAuthorityReplacement("input", "$/expected/model/program/programId");
    }
    failWakeflowConfigAuthorityReplacement("input", "$/expected/model/program/programId");
  }
  let source: Readonly<StableFileSource>;
  try {
    source = parseDurableAtomicFileReplaceOptions({
      mode: WAKEFLOW_CONFIG_AUTHORITY_FILE_MODE,
      expected: {
        byteCount: sourceProjected.byteCount,
        digest: sourceProjected.digest,
        node: sourceProjected.node,
        resourcePath: sourceProjected.resourcePath,
      },
    }).expected;
  } catch (error: unknown) {
    if (error instanceof DurableAtomicFileWriteError) {
      failWakeflowConfigAuthorityReplacement("input", "$expected");
    }
    failWakeflowConfigAuthorityReplacement("input", "$expected");
  }
  if (
    source.resourcePath !== WAKEFLOW_CONFIG_FILE_REF
    || source.node.linkCount !== 1n
    || source.node.permissionBits !== WAKEFLOW_CONFIG_AUTHORITY_FILE_MODE
    || source.node.userId !== expectedUserId
  ) {
    failWakeflowConfigAuthorityReplacement("source-policy", "$/expected/source");
  }
  return Object.freeze({
    workspaceRoot: projected.workspaceRoot,
    source,
    configDigest,
    programId,
  });
}

export function prepareWakeflowConfigAuthorityDesired(
  value: unknown,
): Readonly<PreparedWakeflowConfigAuthorityDesired> {
  let model: WakeflowConfigV3Model;
  try {
    model = parseWakeflowConfigV3(value);
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigV3Error) {
      failWakeflowConfigAuthorityReplacement("config", error.path);
    }
    failWakeflowConfigAuthorityReplacement("config", "$config");
  }
  let bytes: Uint8Array;
  try {
    bytes = encodeUtf8(renderWakeflowConfigV3(model), "$config");
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigV3Error || error instanceof Utf8Error) {
      failWakeflowConfigAuthorityReplacement("config", "$config");
    }
    failWakeflowConfigAuthorityReplacement("config", "$config");
  }
  if (bytes.byteLength > WAKEFLOW_CONFIG_MAXIMUM_BYTES) {
    failWakeflowConfigAuthorityReplacement("capacity", "$config");
  }
  try {
    return Object.freeze({
      model,
      bytes,
      sourceDigest: computeSha256Digest(bytes, "$config"),
      configDigest: computeWakeflowConfigV3Digest(model),
    });
  } catch {
    failWakeflowConfigAuthorityReplacement("config", "$config");
  }
}

export async function assertWakeflowConfigAuthorityDesiredPlacements(
  root: RootedDirectory,
  model: WakeflowConfigV3Model,
): Promise<void> {
  try {
    await validateWakeflowConfigRootPlacements(root, model);
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigRootPlacementError) {
      if (error.reason === "root-scope") {
        failWakeflowConfigAuthorityReplacement("root-scope", "$root");
      }
      if (error.reason === "input") {
        failWakeflowConfigAuthorityReplacement("input", error.path);
      }
      failWakeflowConfigAuthorityReplacement("placement", error.path);
    }
    failWakeflowConfigAuthorityReplacement("placement", "$placements");
  }
}

export async function readCurrentWakeflowConfigAuthority(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
  afterCommit: boolean,
): Promise<Readonly<WakeflowConfigAuthoritySnapshot>> {
  try {
    return await readWakeflowConfigAuthoritySnapshot(
      root,
      signal === undefined ? undefined : { signal },
    );
  } catch (error: unknown) {
    if (afterCommit) {
      failWakeflowConfigAuthorityReplacement("commit-uncertain", "$resourcePath");
    }
    if (error instanceof WakeflowConfigAuthoritySnapshotError) {
      if (error.reason === "aborted") {
        failWakeflowConfigAuthorityReplacement("aborted", "$signal");
      }
      if (error.reason === "root-scope") {
        failWakeflowConfigAuthorityReplacement("root-scope", "$root");
      }
      failWakeflowConfigAuthorityReplacement("source-invalid", "$source");
    }
    failWakeflowConfigAuthorityReplacement("source-invalid", "$source");
  }
}

export function assertWakeflowConfigAuthoritySourcePolicy(
  snapshot: Readonly<WakeflowConfigAuthoritySnapshot>,
  expectedUserId: bigint,
): void {
  const node = snapshot.source.node;
  if (
    node.kind !== "file"
    || node.linkCount !== 1n
    || node.permissionBits !== WAKEFLOW_CONFIG_AUTHORITY_FILE_MODE
    || node.userId !== expectedUserId
  ) {
    failWakeflowConfigAuthorityReplacement("source-policy", "$source");
  }
}

export function sameWakeflowConfigAuthoritySource(
  left: Readonly<StableFileSource>,
  right: Readonly<StableFileSource>,
): boolean {
  try {
    return left.resourcePath === right.resourcePath
      && left.byteCount === right.byteCount
      && left.digest === right.digest
      && sameFileNodeSnapshot(left.node, right.node);
  } catch (error: unknown) {
    if (error instanceof FileNodeSnapshotError) {
      failWakeflowConfigAuthorityReplacement("input", "$expected");
    }
    failWakeflowConfigAuthorityReplacement("input", "$expected");
  }
}

export function matchesWakeflowConfigAuthorityExpectation(
  root: RootedDirectory,
  current: Readonly<WakeflowConfigAuthoritySnapshot>,
  expected: Readonly<ParsedWakeflowConfigAuthorityExpectation>,
): boolean {
  return expected.workspaceRoot === root.absolutePath
    && current.workspaceRoot === root.absolutePath
    && current.configDigest === expected.configDigest
    && current.model.program.programId === expected.programId
    && sameWakeflowConfigAuthoritySource(current.source, expected.source);
}

export function wakeflowConfigAuthorityLockOptions(
  options: Readonly<ParsedWakeflowConfigAuthorityReplacementOptions>,
): RootedExclusiveFileLockOptions {
  return {
    acquireTimeoutMilliseconds: options.acquireTimeoutMilliseconds,
    ...(options.retryDelayMilliseconds === undefined
      ? {}
      : { retryDelayMilliseconds: options.retryDelayMilliseconds }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };
}

export function mapWakeflowConfigAuthorityLockError(
  error: RootedExclusiveFileLockError,
  committed: boolean,
): never {
  if (committed) {
    failWakeflowConfigAuthorityReplacement("commit-uncertain", "$resourcePath");
  }
  if (error.reason === "input") {
    failWakeflowConfigAuthorityReplacement("input", error.path);
  }
  if (error.reason === "aborted") {
    failWakeflowConfigAuthorityReplacement("aborted", "$signal");
  }
  if (error.reason === "timeout") {
    failWakeflowConfigAuthorityReplacement("lock-timeout", "$lock");
  }
  if (error.reason === "root-scope" || error.reason === "parent") {
    failWakeflowConfigAuthorityReplacement("root-scope", "$root");
  }
  if (error.reason === "owner-active" || error.reason === "residue-changed") {
    failWakeflowConfigAuthorityReplacement("recovery-required", "$lock");
  }
  failWakeflowConfigAuthorityReplacement("lock-unsafe", "$lock");
}
