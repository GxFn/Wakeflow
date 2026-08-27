import { Buffer } from "node:buffer";
import { types } from "node:util";

import type {
  LoadedArtifactTreeFile as LoadedArtifactTreeFileWire,
  LoadedArtifactTreeManifest as LoadedArtifactTreeManifestWire,
} from "../../contracts/generated/foundation/loaded-artifact-tree-manifest.generated.js";
import { computeCanonicalJsonSha256Digest } from "../crypto/canonical-json-sha256.js";
import {
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../crypto/sha256.js";
import {
  JsonValueError,
  parseJsonValue,
  type JsonValue,
} from "../data/json-value.js";
import {
  parseDenseArray,
  parsePlainRecord,
  PassiveOwnDataError,
} from "../data/passive-own-data.js";
import {
  addByteCounts,
  ByteCountError,
  parseByteCount,
  type ByteCount,
} from "../numeric/byte-count.js";
import {
  parsePortableResourcePath,
  PortableResourcePathError,
  type PortableResourcePath,
} from "../filesystem/portable-resource-path.js";
import { RootedDirectory } from "../filesystem/rooted-directory.js";
import {
  readStableRootResourceTree,
  StableResourceTreeReadError,
} from "../filesystem/stable-resource-tree-read.js";

/**
 * Wakeflow Foundation / Artifact：已加载制品目录树的位置无关内容身份。
 *
 * 本模块把 `StableResourceTreeRead` 提供的物理内容事实转换为与当前 v1 协议兼容的
 * 清单和目录树摘要。物理 inode、所有者、修改时间和状态变更时间只参与整树复验，
 * 不进入位置无关的内容身份；清单只包含引用、字节数、摘要和可执行权限事实。
 *
 * 遇到符号链接、特殊节点、非 NFC 引用或跨平台大小写冲突时，模块会保守拒绝。
 * 底层稳定目录树能力负责证明结构预算、文件预算和观察期间的来源未漂移。本结果
 * 不能替代发布来源证明、宿主激活证明或迁移授权。
 */

export const LOADED_ARTIFACT_TREE_MANIFEST_VERSION = 1 as const;
export const LOADED_ARTIFACT_TREE_MANIFEST_KIND =
  "wakeflow-loaded-artifact-tree" as const;

/** 与当前支持的清单 v1 保持一致、不得放宽的安全预算。 */
export const LOADED_ARTIFACT_TREE_IDENTITY_LIMITS = Object.freeze({
  maxDepth: 64,
  maxEntries: 8192,
  maxFileBytes: 32 * 1024 * 1024,
  maxFiles: 4096,
  maxRefBytes: 1024,
  maxTotalBytes: 256 * 1024 * 1024,
} as const);

export interface LoadedArtifactTreeIdentityLimits {
  readonly maxDepth: number;
  readonly maxEntries: number;
  readonly maxFileBytes: number;
  readonly maxFiles: number;
  readonly maxRefBytes: number;
  readonly maxTotalBytes: number;
}

export interface LoadedArtifactTreeIdentityOptions {
  readonly limits?: LoadedArtifactTreeIdentityLimits;
  readonly signal?: AbortSignal;
}

export interface LoadedArtifactTreeManifestValidationOptions {
  readonly limits?: LoadedArtifactTreeIdentityLimits;
}

export type LoadedArtifactTreeFile = Readonly<
  Omit<LoadedArtifactTreeFileWire, "bytes" | "digest" | "ref"> & {
    readonly bytes: ByteCount;
    readonly digest: Sha256Digest;
    readonly ref: PortableResourcePath;
  }
>;

export type LoadedArtifactTreeManifest = Readonly<
  Omit<
    LoadedArtifactTreeManifestWire,
    "fileCount" | "files" | "totalBytes"
  > & {
    readonly fileCount: number;
    readonly files: readonly [
      LoadedArtifactTreeFile,
      ...LoadedArtifactTreeFile[],
    ];
    readonly totalBytes: ByteCount;
  }
>;

export interface LoadedArtifactTreeIdentity {
  readonly artifactDigest: Sha256Digest;
  readonly manifest: LoadedArtifactTreeManifest;
}

export type LoadedArtifactTreeIdentityErrorReason =
  | "input"
  | "root-scope"
  | "entry-limit"
  | "depth-limit"
  | "file-count"
  | "file-bytes"
  | "total-bytes"
  | "ref-bytes"
  | "ref-collision"
  | "symlink"
  | "special-node"
  | "empty-tree"
  | "source-changed"
  | "inspection-failure"
  | "manifest-shape"
  | "manifest-order"
  | "manifest-totals"
  | "aborted";

const ERROR_MESSAGES = {
  "input": "Loaded artifact tree identity input is invalid.",
  "root-scope": "Loaded artifact tree could not establish its root scope.",
  "entry-limit": "Loaded artifact tree exceeds its physical entry budget.",
  "depth-limit": "Loaded artifact tree exceeds its relative depth budget.",
  "file-count": "Loaded artifact tree exceeds its regular-file budget.",
  "file-bytes": "A loaded artifact file exceeds its byte budget.",
  "total-bytes": "Loaded artifact tree exceeds its total byte budget.",
  "ref-bytes": "A loaded artifact ref exceeds its UTF-8 byte budget.",
  "ref-collision": "Loaded artifact refs collide under portable comparison.",
  "symlink": "Loaded artifact tree cannot contain symbolic links.",
  "special-node": "Loaded artifact tree can contain only directories and regular files.",
  "empty-tree": "Loaded artifact tree must contain at least one regular file.",
  "source-changed": "Loaded artifact tree changed while it was inspected.",
  "inspection-failure": "Loaded artifact tree could not be inspected safely.",
  "manifest-shape": "Loaded artifact tree manifest shape is invalid.",
  "manifest-order": "Loaded artifact tree manifest refs are not canonical.",
  "manifest-totals": "Loaded artifact tree manifest totals are inconsistent.",
  "aborted": "Loaded artifact tree inspection was aborted.",
} as const satisfies Readonly<Record<
  LoadedArtifactTreeIdentityErrorReason,
  string
>>;

export class LoadedArtifactTreeIdentityError extends Error {
  override readonly name = "LoadedArtifactTreeIdentityError";
  readonly code = "wakeflow-loaded-artifact-tree-identity" as const;
  readonly reason: LoadedArtifactTreeIdentityErrorReason;
  readonly path: string;

  constructor(reason: LoadedArtifactTreeIdentityErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface ParsedIdentityOptions {
  readonly limits: Readonly<LoadedArtifactTreeIdentityLimits>;
  readonly signal: AbortSignal | undefined;
}

const LIMIT_FIELDS = Object.freeze([
  "maxDepth",
  "maxEntries",
  "maxFileBytes",
  "maxFiles",
  "maxRefBytes",
  "maxTotalBytes",
] as const);

const MANIFEST_FIELDS = Object.freeze([
  "artifactKind",
  "fileCount",
  "files",
  "schemaVersion",
  "totalBytes",
] as const);

const FILE_FIELDS = Object.freeze([
  "bytes",
  "digest",
  "executable",
  "ref",
] as const);

function fail(
  reason: LoadedArtifactTreeIdentityErrorReason,
  path: string,
): never {
  throw new LoadedArtifactTreeIdentityError(reason, path);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertExactFields(
  record: Readonly<Record<string, unknown>>,
  fields: readonly string[],
  path: string,
  reason: "input" | "manifest-shape",
): void {
  const keys = Object.keys(record).sort(compareText);
  const expected = [...fields].sort(compareText);
  if (
    keys.length !== expected.length
    || keys.some((key, index) => key !== expected[index])
  ) {
    fail(reason, path);
  }
}

function parsePositiveInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    fail("input", path);
  }
  return value;
}

function parseNonNegativeInteger(
  value: unknown,
  path: string,
  reason: "manifest-shape" | "manifest-totals",
): number {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < 0
  ) {
    fail(reason, path);
  }
  return value;
}

function parseLimits(value: unknown): Readonly<LoadedArtifactTreeIdentityLimits> {
  if (value === undefined) return LOADED_ARTIFACT_TREE_IDENTITY_LIMITS;
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$options.limits");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options.limits");
    throw error;
  }
  assertExactFields(record, LIMIT_FIELDS, "$options.limits", "input");
  const parsed = Object.fromEntries(LIMIT_FIELDS.map((field) => [
    field,
    parsePositiveInteger(record[field], `$options.limits.${field}`),
  ])) as unknown as LoadedArtifactTreeIdentityLimits;
  for (const field of LIMIT_FIELDS) {
    if (parsed[field] > LOADED_ARTIFACT_TREE_IDENTITY_LIMITS[field]) {
      fail("input", `$options.limits.${field}`);
    }
  }
  return Object.freeze(parsed);
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return typeof value === "object"
    && value !== null
    && !types.isProxy(value)
    && value instanceof AbortSignal;
}

function parseIdentityOptions(value: unknown): Readonly<ParsedIdentityOptions> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value === undefined ? {} : value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }
  const allowed = new Set(["limits", "signal"]);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    fail("input", "$options");
  }
  if (record.signal !== undefined && !isAbortSignal(record.signal)) {
    fail("input", "$options.signal");
  }
  return Object.freeze({
    limits: parseLimits(record.limits),
    signal: record.signal,
  });
}

function parseValidationOptions(
  value: unknown,
): Readonly<LoadedArtifactTreeIdentityLimits> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value === undefined ? {} : value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }
  if (Object.keys(record).some((key) => key !== "limits")) {
    fail("input", "$options");
  }
  return parseLimits(record.limits);
}

function parseManifestByteCount(
  value: unknown,
  path: string,
): ByteCount {
  try {
    return parseByteCount(value, path);
  } catch (error: unknown) {
    if (error instanceof ByteCountError) fail("manifest-shape", path);
    throw error;
  }
}

function parseManifestRef(value: unknown, path: string): PortableResourcePath {
  try {
    return parsePortableResourcePath(value, path);
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) fail("manifest-shape", path);
    throw error;
  }
}

function parseManifestDigest(value: unknown, path: string): Sha256Digest {
  try {
    return parseSha256Digest(value, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("manifest-shape", path);
    throw error;
  }
}

function portableCollisionKey(ref: PortableResourcePath): string {
  return ref.toLowerCase();
}

function parseManifestFile(
  value: unknown,
  index: number,
  limits: Readonly<LoadedArtifactTreeIdentityLimits>,
): LoadedArtifactTreeFile {
  const path = `$manifest.files.${index}`;
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("manifest-shape", path);
    throw error;
  }
  assertExactFields(record, FILE_FIELDS, path, "manifest-shape");
  const bytes = parseManifestByteCount(record.bytes, `${path}.bytes`);
  if (bytes > limits.maxFileBytes) fail("file-bytes", `${path}.bytes`);
  const ref = parseManifestRef(record.ref, `${path}.ref`);
  if (ref.split("/").length > limits.maxDepth) {
    fail("depth-limit", `${path}.ref`);
  }
  if (Buffer.byteLength(ref, "utf8") > limits.maxRefBytes) {
    fail("ref-bytes", `${path}.ref`);
  }
  if (typeof record.executable !== "boolean") {
    fail("manifest-shape", `${path}.executable`);
  }
  return Object.freeze({
    bytes,
    digest: parseManifestDigest(record.digest, `${path}.digest`),
    executable: record.executable,
    ref,
  });
}

function parseManifest(
  value: unknown,
  limits: Readonly<LoadedArtifactTreeIdentityLimits>,
): LoadedArtifactTreeManifest {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$manifest");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("manifest-shape", "$manifest");
    throw error;
  }
  assertExactFields(record, MANIFEST_FIELDS, "$manifest", "manifest-shape");
  if (
    record.artifactKind !== LOADED_ARTIFACT_TREE_MANIFEST_KIND
    || record.schemaVersion !== LOADED_ARTIFACT_TREE_MANIFEST_VERSION
  ) {
    fail("manifest-shape", "$manifest");
  }
  let values: readonly unknown[];
  try {
    values = parseDenseArray(record.files, limits.maxFiles, "$manifest.files");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) {
      if (error.reason === "array-length") {
        fail("file-count", "$manifest.files");
      }
      fail("manifest-shape", "$manifest.files");
    }
    throw error;
  }
  if (values.length === 0) fail("empty-tree", "$manifest.files");

  const files: LoadedArtifactTreeFile[] = [];
  const collisionKeys = new Set<string>();
  let previousRef: PortableResourcePath | undefined;
  let totalBytes = parseByteCount(0, "$manifest.totalBytes");
  for (const [index, value] of values.entries()) {
    const file = parseManifestFile(value, index, limits);
    if (
      previousRef !== undefined
      && compareText(previousRef, file.ref) >= 0
    ) {
      fail("manifest-order", `$manifest.files.${index}.ref`);
    }
    previousRef = file.ref;
    const collisionKey = portableCollisionKey(file.ref);
    if (collisionKeys.has(collisionKey)) {
      fail("ref-collision", `$manifest.files.${index}.ref`);
    }
    collisionKeys.add(collisionKey);
    try {
      totalBytes = addByteCounts(totalBytes, file.bytes, "$manifest.totalBytes");
    } catch (error: unknown) {
      if (error instanceof ByteCountError) fail("manifest-totals", "$manifest.totalBytes");
      throw error;
    }
    if (totalBytes > limits.maxTotalBytes) {
      fail("total-bytes", "$manifest.totalBytes");
    }
    files.push(file);
  }
  const fileCount = parseNonNegativeInteger(
    record.fileCount,
    "$manifest.fileCount",
    "manifest-shape",
  );
  const declaredTotalBytes = parseNonNegativeInteger(
    record.totalBytes,
    "$manifest.totalBytes",
    "manifest-shape",
  );
  if (fileCount !== files.length || declaredTotalBytes !== totalBytes) {
    fail("manifest-totals", "$manifest");
  }
  return Object.freeze({
    artifactKind: LOADED_ARTIFACT_TREE_MANIFEST_KIND,
    fileCount: files.length,
    files: Object.freeze(files) as readonly [
      LoadedArtifactTreeFile,
      ...LoadedArtifactTreeFile[],
    ],
    schemaVersion: LOADED_ARTIFACT_TREE_MANIFEST_VERSION,
    totalBytes,
  });
}

export function validateLoadedArtifactTreeManifest(
  value: unknown,
  options?: LoadedArtifactTreeManifestValidationOptions,
): LoadedArtifactTreeManifest {
  return parseManifest(value, parseValidationOptions(options));
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) fail("aborted", "$signal");
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

function mapStableTreeReadError(error: StableResourceTreeReadError): never {
  if (error.reason === "entry-limit") fail("entry-limit", "$tree");
  if (error.reason === "depth-limit") fail("depth-limit", "$tree");
  if (error.reason === "file-count") fail("file-count", "$tree.files");
  if (error.reason === "file-bytes") fail("file-bytes", "$tree.files");
  if (error.reason === "total-bytes") fail("total-bytes", "$tree.totalBytes");
  if (error.reason === "symlink") fail("symlink", "$tree");
  if (error.reason === "source-changed") fail("source-changed", "$tree");
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (error.reason === "root-scope") fail("root-scope", "$root");
  if (error.reason === "input") fail("input", error.path);
  fail("inspection-failure", "$tree");
}

async function readArtifactTree(
  root: RootedDirectory,
  options: Readonly<ParsedIdentityOptions>,
) {
  try {
    return await readStableRootResourceTree(root, {
      maximumEntries: options.limits.maxEntries,
      maximumDepth: options.limits.maxDepth,
      maximumFiles: options.limits.maxFiles,
      maximumFileBytes: parseByteCount(
        options.limits.maxFileBytes,
        "$limits.maxFileBytes",
      ),
      maximumTotalBytes: parseByteCount(
        options.limits.maxTotalBytes,
        "$limits.maxTotalBytes",
      ),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (error: unknown) {
    if (error instanceof StableResourceTreeReadError) {
      mapStableTreeReadError(error);
    }
    throw error;
  }
}

async function inspectArtifactManifest(
  root: RootedDirectory,
  options: Readonly<ParsedIdentityOptions>,
): Promise<LoadedArtifactTreeManifest> {
  const tree = await readArtifactTree(root, options);
  for (const entry of tree.entries) {
    assertNotAborted(options.signal);
    if (Buffer.byteLength(entry.resourcePath, "utf8") > options.limits.maxRefBytes) {
      fail("ref-bytes", "$tree.entries");
    }
    if (entry.node.kind === "directory") continue;
    if (entry.node.kind === "symbolic-link") fail("symlink", "$tree.entries");
    if (entry.node.kind !== "file") fail("special-node", "$tree.entries");
  }
  const files = tree.files.map((file): LoadedArtifactTreeFile => Object.freeze({
    bytes: file.byteCount,
    digest: file.digest,
    executable: (file.node.permissionBits & 0o111) !== 0,
    ref: file.resourcePath,
  }));
  if (files.length === 0) fail("empty-tree", "$tree.files");
  return parseManifest({
    artifactKind: LOADED_ARTIFACT_TREE_MANIFEST_KIND,
    fileCount: files.length,
    files,
    schemaVersion: LOADED_ARTIFACT_TREE_MANIFEST_VERSION,
    totalBytes: tree.totalFileBytes,
  }, options.limits);
}

function manifestJsonValue(manifest: LoadedArtifactTreeManifest): JsonValue {
  try {
    return parseJsonValue(manifest, "$manifest");
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("manifest-shape", error.path);
    throw error;
  }
}

export async function inspectLoadedArtifactTree(
  root: RootedDirectory,
  options?: LoadedArtifactTreeIdentityOptions,
): Promise<Readonly<LoadedArtifactTreeIdentity>> {
  assertRoot(root);
  const parsed = parseIdentityOptions(options);
  assertNotAborted(parsed.signal);
  const manifest = await inspectArtifactManifest(root, parsed);
  const value = manifestJsonValue(manifest);
  return Object.freeze({
    artifactDigest: computeCanonicalJsonSha256Digest(value),
    manifest,
  });
}
