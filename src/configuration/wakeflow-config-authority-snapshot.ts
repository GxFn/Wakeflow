import { types } from "node:util";

import type { Sha256Digest } from "../foundation/crypto/sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../foundation/data/passive-own-data.js";
import type { FileNodeSnapshot } from "../foundation/filesystem/file-node-snapshot.js";
import {
  readDeterministicJsonFile,
} from "../foundation/filesystem/deterministic-json-file.js";
import {
  DeterministicJsonDocumentError,
} from "../foundation/data/deterministic-json-document.js";
import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../foundation/filesystem/rooted-directory.js";
import { StableFileReadError } from "../foundation/filesystem/stable-file-read.js";
import { StrictTextFileError } from "../foundation/filesystem/strict-text-file.js";
import {
  parseByteCount,
  type ByteCount,
} from "../foundation/numeric/byte-count.js";
import {
  validateWakeflowConfigRootPlacements,
  WakeflowConfigRootPlacementError,
  type WakeflowConfigRootPlacementReport,
} from "./wakeflow-config-root-placement.js";
import {
  buildWakeflowConfigV3Indexes,
  computeWakeflowConfigV3Digest,
  parseWakeflowConfigV3,
  WakeflowConfigV3Error,
  type WakeflowConfigV3Indexes,
  type WakeflowConfigV3Model,
} from "./wakeflow-config-v3.js";
import { renderWakeflowConfigV3 } from "./wakeflow-config-v3-document.js";

/**
 * Wakeflow Configuration：一次操作范围内的 v3 配置 authority 快照。
 *
 * 本文件从调用方已经打开的 RootedDirectory 固定读取 `wakeflow.config.json`，绑定
 * 同一次稳定读取的节点、字节数和 source digest，再完成严格 UTF-8/JSON、公开
 * Schema、typed reference、根 placement 与常用索引。source digest 证明文件表达
 * 字节，config digest 证明规范化 JSON 语义；两者不能互相替代。
 *
 * 快照不缓存“当前 workspace”，也不保证返回后文件继续不变。任何写入型 owner
 * 必须在自己的 lock/CAS 边界重新加载并核对 source snapshot/config digest。
 */

export const WAKEFLOW_CONFIG_AUTHORITY_SNAPSHOT_VERSION = 1 as const;
export const WAKEFLOW_CONFIG_AUTHORITY_SNAPSHOT_KIND =
  "WakeflowConfigAuthoritySnapshot" as const;
export const WAKEFLOW_CONFIG_FILE_REF = parsePortableResourcePath(
  "wakeflow.config.json",
);
export const WAKEFLOW_CONFIG_MAXIMUM_BYTES = parseByteCount(1024 * 1024);

export interface WakeflowConfigAuthoritySource {
  readonly resourcePath: PortableResourcePath;
  readonly node: Readonly<FileNodeSnapshot>;
  readonly byteCount: ByteCount;
  readonly digest: Sha256Digest;
}

export interface WakeflowConfigAuthoritySnapshot {
  readonly kind: typeof WAKEFLOW_CONFIG_AUTHORITY_SNAPSHOT_KIND;
  readonly schemaVersion: typeof WAKEFLOW_CONFIG_AUTHORITY_SNAPSHOT_VERSION;
  readonly workspaceRoot: string;
  readonly source: Readonly<WakeflowConfigAuthoritySource>;
  readonly model: WakeflowConfigV3Model;
  readonly indexes: Readonly<WakeflowConfigV3Indexes>;
  readonly configDigest: Sha256Digest;
  readonly placements: Readonly<WakeflowConfigRootPlacementReport>;
  readonly ledgerRoot: string;
}

export interface WakeflowConfigAuthoritySnapshotOptions {
  readonly signal?: AbortSignal;
}

export type WakeflowConfigAuthoritySnapshotErrorReason =
  | "input"
  | "root-scope"
  | "source"
  | "source-policy"
  | "source-changed"
  | "encoding"
  | "json"
  | "representation"
  | "config"
  | "placement"
  | "aborted"
  | "load-failure";

const ERROR_MESSAGES = {
  "input": "Wakeflow config authority snapshot input is invalid.",
  "root-scope": "Wakeflow config workspace root could not be held stable.",
  "source": "Wakeflow canonical config source is unavailable or unsafe.",
  "source-policy": "Wakeflow canonical config source violates its node policy.",
  "source-changed": "Wakeflow canonical config changed during snapshot loading.",
  "encoding": "Wakeflow canonical config is not strict UTF-8 text.",
  "json": "Wakeflow canonical config is not valid JSON.",
  "representation": "Wakeflow canonical config does not use its deterministic domain representation.",
  "config": "Wakeflow canonical config is not the strict public v3 authority.",
  "placement": "Wakeflow canonical config declares unsafe root placements.",
  "aborted": "Wakeflow config authority snapshot loading was aborted.",
  "load-failure": "Wakeflow config authority snapshot failed closed.",
} as const satisfies Readonly<Record<
  WakeflowConfigAuthoritySnapshotErrorReason,
  string
>>;

/** 配置 authority 快照失败的稳定、脱敏错误。 */
export class WakeflowConfigAuthoritySnapshotError extends Error {
  override readonly name = "WakeflowConfigAuthoritySnapshotError";
  readonly code = "wakeflow-config-authority-snapshot" as const;
  readonly reason: WakeflowConfigAuthoritySnapshotErrorReason;
  readonly path: string;

  constructor(
    reason: WakeflowConfigAuthoritySnapshotErrorReason,
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
  reason: WakeflowConfigAuthoritySnapshotErrorReason,
  path: string,
): never {
  throw new WakeflowConfigAuthoritySnapshotError(reason, path);
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
  if (Object.keys(record).some((key) => key !== "signal")) {
    fail("input", "$options");
  }
  if (record.signal !== undefined && !isAbortSignal(record.signal)) {
    fail("input", "$options.signal");
  }
  return Object.freeze({ signal: record.signal });
}

function mapStableReadError(error: StableFileReadError): never {
  if (error.reason === "input") fail("input", error.path);
  if (error.reason === "root-scope") fail("root-scope", "$root");
  if (error.reason === "source-changed") fail("source-changed", "$source");
  if (error.reason === "aborted") fail("aborted", "$signal");
  fail("source", "$source");
}

function mapStrictTextError(error: StrictTextFileError): never {
  if (error.reason === "input") fail("input", error.path);
  if (error.reason === "utf8" || error.reason === "bom") {
    fail("encoding", "$source");
  }
  fail("representation", "$source");
}

function mapDeterministicJsonError(
  error: DeterministicJsonDocumentError,
): never {
  if (error.reason === "json-syntax") fail("json", "$document");
  if (error.reason === "non-deterministic") {
    fail("representation", "$document");
  }
  fail("config", error.path);
}

async function readConfigSource(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
) {
  const options = {
    maximumBytes: WAKEFLOW_CONFIG_MAXIMUM_BYTES,
    ...(signal === undefined ? {} : { signal }),
  };
  try {
    return await readDeterministicJsonFile(
      root,
      WAKEFLOW_CONFIG_FILE_REF,
      options,
    );
  } catch (error: unknown) {
    if (error instanceof StableFileReadError) mapStableReadError(error);
    if (error instanceof StrictTextFileError) mapStrictTextError(error);
    if (error instanceof DeterministicJsonDocumentError) {
      mapDeterministicJsonError(error);
    }
    throw error;
  }
}

function assertSourcePolicy(node: Readonly<FileNodeSnapshot>): void {
  if (node.linkCount !== 1n || (node.permissionBits & 0o111) !== 0) {
    fail("source-policy", "$source");
  }
}

function parseConfigModel(value: unknown): WakeflowConfigV3Model {
  try {
    return parseWakeflowConfigV3(value);
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigV3Error) fail("config", error.path);
    throw error;
  }
}

async function validatePlacements(
  root: RootedDirectory,
  model: WakeflowConfigV3Model,
): Promise<Readonly<WakeflowConfigRootPlacementReport>> {
  try {
    return await validateWakeflowConfigRootPlacements(root, model);
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigRootPlacementError) {
      if (error.reason === "root-scope") fail("root-scope", "$root");
      fail("placement", error.path);
    }
    throw error;
  }
}

function requiredLedgerRoot(
  placements: Readonly<WakeflowConfigRootPlacementReport>,
): string {
  const ledger = placements.roots.find((entry) => entry.key === "ledger.root");
  if (ledger === undefined) fail("placement", "$placements");
  return ledger.absolutePath;
}

async function loadSnapshot(
  root: RootedDirectory,
  options: Readonly<ParsedOptions>,
): Promise<Readonly<WakeflowConfigAuthoritySnapshot>> {
  const read = await readConfigSource(root, options.signal);
  assertSourcePolicy(read.node);
  const model = parseConfigModel(read.value);
  if (renderWakeflowConfigV3(model) !== read.text) {
    fail("representation", "$document");
  }
  const configDigest = computeWakeflowConfigV3Digest(model);
  if (configDigest !== read.semanticDigest) fail("config", "$document");
  const placements = await validatePlacements(root, model);
  return Object.freeze({
    kind: WAKEFLOW_CONFIG_AUTHORITY_SNAPSHOT_KIND,
    schemaVersion: WAKEFLOW_CONFIG_AUTHORITY_SNAPSHOT_VERSION,
    workspaceRoot: root.absolutePath,
    source: Object.freeze({
      resourcePath: read.resourcePath,
      node: read.node,
      byteCount: read.byteCount,
      digest: read.digest,
    }),
    model,
    indexes: buildWakeflowConfigV3Indexes(model),
    configDigest,
    placements,
    ledgerRoot: requiredLedgerRoot(placements),
  });
}

/** 从一个已打开 workspace 根读取并构造完整 v3 配置 authority 快照。 */
export async function readWakeflowConfigAuthoritySnapshot(
  root: RootedDirectory,
  options?: WakeflowConfigAuthoritySnapshotOptions,
): Promise<Readonly<WakeflowConfigAuthoritySnapshot>> {
  try {
    return await loadSnapshot(root, parseOptions(options));
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigAuthoritySnapshotError) throw error;
    throw new WakeflowConfigAuthoritySnapshotError("load-failure", "$snapshot");
  }
}
