import { Buffer } from "node:buffer";
import { types } from "node:util";

import { computeCanonicalJsonSha256Digest } from "../crypto/canonical-json-sha256.js";
import {
  computeSha256Digest,
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../crypto/sha256.js";
import { JsonValueError, parseJsonValue } from "../data/json-value.js";
import {
  parseDenseArray,
  parsePlainRecord,
  PassiveOwnDataError,
} from "../data/passive-own-data.js";
import {
  addByteCounts,
  parseByteCount,
  ByteCountError,
  type ByteCount,
} from "../numeric/byte-count.js";
import type { FileNodeSnapshot } from "./file-node-snapshot.js";
import {
  parsePortableResourcePath,
  PortableResourcePathError,
  type PortableResourcePath,
} from "./portable-resource-path.js";

/** Wakeflow Foundation / Filesystem：目录树候选的精确清单计划与公共合同。 */

export const DIRECTORY_TREE_CANDIDATE_PLAN_ARTIFACT_KIND =
  "wakeflow-directory-tree-candidate-plan" as const;
export const DIRECTORY_TREE_CANDIDATE_PLAN_SCHEMA_VERSION = 1 as const;
const DIRECTORY_TREE_CANDIDATE_MAXIMUM_PLAN_FILES = 4096;
const DIRECTORY_TREE_CANDIDATE_MAXIMUM_PLAN_DIRECTORIES = 8192;
/** v1任何owner都不能放宽的资源消耗上限；具体业务只能提供更小预算。 */
const DIRECTORY_TREE_CANDIDATE_V1_HARD_LIMITS = Object.freeze({
  maximumDepth: 64,
  maximumEntries: 8192,
  maximumFileBytes: 32 * 1024 * 1024,
  maximumFiles: DIRECTORY_TREE_CANDIDATE_MAXIMUM_PLAN_FILES,
  maximumPathBytes: 1024,
  maximumTotalBytes: 256 * 1024 * 1024,
} as const);

export interface DirectoryTreeCandidateFileInput {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly mode: number;
}

/** 业务owner在Foundation硬上限内可进一步收紧的目录树容量。 */
export interface DirectoryTreeCandidateCapacity {
  readonly maximumDepth: number;
  readonly maximumEntries: number;
  readonly maximumFileBytes: number;
  readonly maximumFiles: number;
  readonly maximumTotalBytes: number;
}

export interface DirectoryTreeCandidateOptions
  extends DirectoryTreeCandidateCapacity {
  readonly directoryMode: number;
  readonly signal?: AbortSignal;
}

export interface DirectoryTreeCandidatePlanFile {
  readonly path: PortableResourcePath;
  readonly byteCount: ByteCount;
  readonly digest: Sha256Digest;
  readonly mode: number;
}

export interface DirectoryTreeCandidatePlan {
  readonly artifactKind: typeof DIRECTORY_TREE_CANDIDATE_PLAN_ARTIFACT_KIND;
  readonly schemaVersion: typeof DIRECTORY_TREE_CANDIDATE_PLAN_SCHEMA_VERSION;
  readonly directoryMode: number;
  readonly directories: readonly PortableResourcePath[];
  readonly files: readonly Readonly<DirectoryTreeCandidatePlanFile>[];
  readonly totalBytes: ByteCount;
  readonly treeDigest: Sha256Digest;
}

export interface InspectDirectoryTreeCandidateOptions {
  readonly expectedRootNode?: Readonly<FileNodeSnapshot>;
  readonly signal?: AbortSignal;
}

export interface DirectoryTreeCandidateResult {
  readonly candidateRootPath: PortableResourcePath;
  readonly plan: Readonly<DirectoryTreeCandidatePlan>;
  readonly rootNode: Readonly<FileNodeSnapshot>;
}

export interface DirectoryTreeCandidateProgress {
  readonly candidateRootPath: PortableResourcePath;
  readonly plan: Readonly<DirectoryTreeCandidatePlan>;
  readonly rootNode: Readonly<FileNodeSnapshot>;
  readonly status: "incomplete" | "complete";
  readonly missingDirectories: readonly PortableResourcePath[];
  readonly missingFiles: readonly PortableResourcePath[];
}

export type DurableDirectoryTreeCandidateErrorReason =
  | "input"
  | "file-order"
  | "path-conflict"
  | "capacity"
  | "target-exists"
  | "tree-conflict"
  | "source-changed"
  | "operation-failure"
  | "aborted";

const ERROR_MESSAGES = {
  input: "Directory tree candidate input is invalid.",
  "file-order": "Directory tree candidate files are not in canonical order.",
  "path-conflict": "Directory tree candidate paths do not form one closed tree.",
  capacity: "Directory tree candidate exceeds its declared capacity.",
  "target-exists": "Directory tree candidate target already exists.",
  "tree-conflict": "Directory tree candidate does not match its closed plan.",
  "source-changed": "Directory tree candidate changed during verification.",
  "operation-failure": "Directory tree candidate could not be created durably.",
  aborted: "Directory tree candidate operation was aborted.",
} as const satisfies Readonly<Record<
  DurableDirectoryTreeCandidateErrorReason,
  string
>>;

export class DurableDirectoryTreeCandidateError extends Error {
  override readonly name = "DurableDirectoryTreeCandidateError";
  readonly code = "wakeflow-durable-directory-tree-candidate" as const;
  readonly reason: DurableDirectoryTreeCandidateErrorReason;
  readonly path: string;

  constructor(reason: DurableDirectoryTreeCandidateErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface ParsedDirectoryTreeCandidateOptions {
  readonly directoryMode: number;
  readonly maximumDepth: number;
  readonly maximumEntries: number;
  readonly maximumFileBytes: ByteCount;
  readonly maximumFiles: number;
  readonly maximumTotalBytes: ByteCount;
  readonly signal: AbortSignal | undefined;
}

export interface PreparedDirectoryTreeCandidateFile
  extends DirectoryTreeCandidatePlanFile {
  readonly bytes: Uint8Array;
}

export interface PreparedDirectoryTreeCandidate {
  readonly plan: Readonly<DirectoryTreeCandidatePlan>;
  readonly files: readonly Readonly<PreparedDirectoryTreeCandidateFile>[];
  readonly options: Readonly<ParsedDirectoryTreeCandidateOptions>;
}

const OPTION_FIELDS = Object.freeze([
  "directoryMode",
  "maximumDepth",
  "maximumEntries",
  "maximumFileBytes",
  "maximumFiles",
  "maximumTotalBytes",
  "signal",
] as const);
const CAPACITY_FIELDS = Object.freeze([
  "maximumDepth",
  "maximumEntries",
  "maximumFileBytes",
  "maximumFiles",
  "maximumTotalBytes",
] as const);
const PLAN_FIELDS = Object.freeze([
  "artifactKind",
  "directoryMode",
  "directories",
  "files",
  "schemaVersion",
  "totalBytes",
  "treeDigest",
] as const);
const PLAN_FILE_FIELDS = Object.freeze([
  "byteCount",
  "digest",
  "mode",
  "path",
] as const);
const INPUT_FILE_FIELDS = Object.freeze(["bytes", "mode", "path"] as const);

export function throwDirectoryTreeCandidateError(
  reason: DurableDirectoryTreeCandidateErrorReason,
  path: string,
): never {
  return fail(reason, path);
}

function fail(
  reason: DurableDirectoryTreeCandidateErrorReason,
  path: string,
): never {
  throw new DurableDirectoryTreeCandidateError(reason, path);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactFields(
  value: Readonly<Record<string, unknown>>,
  fields: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value).sort(compareText);
  const expected = [...fields].sort(compareText);
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    fail("input", path);
  }
}

function plainRecord(
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> {
  try {
    return parsePlainRecord(value, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", path);
    throw error;
  }
}

function denseArray(
  value: unknown,
  maximumLength: number,
  path: string,
): readonly unknown[] {
  try {
    return parseDenseArray(value, maximumLength, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) {
      if (error.reason === "array-length") fail("capacity", path);
      fail("input", path);
    }
    throw error;
  }
}

function parseMode(value: unknown, path: string): number {
  if (
    typeof value !== "number"
    || !Number.isInteger(value)
    || value < 0
    || value > 0o777
  ) {
    fail("input", path);
  }
  return value;
}

function parseCandidateDirectoryMode(value: unknown, path: string): number {
  const mode = parseMode(value, path);
  if ((mode & 0o700) !== 0o700) fail("input", path);
  return mode;
}

function parseCandidateFileMode(value: unknown, path: string): number {
  const mode = parseMode(value, path);
  if ((mode & 0o400) !== 0o400) fail("input", path);
  return mode;
}

function parsePositiveCount(value: unknown, path: string): number {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value <= 0
  ) {
    fail("input", path);
  }
  return value;
}

function byteCount(value: unknown, path: string): ByteCount {
  try {
    return parseByteCount(value, path);
  } catch (error: unknown) {
    if (error instanceof ByteCountError) fail("input", path);
    throw error;
  }
}

export function isDirectoryTreeCandidateAbortSignal(
  value: unknown,
): value is AbortSignal {
  return typeof value === "object"
    && value !== null
    && !types.isProxy(value)
    && value instanceof AbortSignal;
}

type ParsedDirectoryTreeCandidateCapacity = Readonly<{
  readonly maximumDepth: number;
  readonly maximumEntries: number;
  readonly maximumFileBytes: ByteCount;
  readonly maximumFiles: number;
  readonly maximumTotalBytes: ByteCount;
}>;

function parseCapacityFields(
  record: Readonly<Record<string, unknown>>,
  path: string,
): ParsedDirectoryTreeCandidateCapacity {
  const capacity = Object.freeze({
    maximumDepth: parsePositiveCount(
      record.maximumDepth,
      `${path}/maximumDepth`,
    ),
    maximumEntries: parsePositiveCount(
      record.maximumEntries,
      `${path}/maximumEntries`,
    ),
    maximumFileBytes: byteCount(
      record.maximumFileBytes,
      `${path}/maximumFileBytes`,
    ),
    maximumFiles: parsePositiveCount(
      record.maximumFiles,
      `${path}/maximumFiles`,
    ),
    maximumTotalBytes: byteCount(
      record.maximumTotalBytes,
      `${path}/maximumTotalBytes`,
    ),
  });
  const ceilings = DIRECTORY_TREE_CANDIDATE_V1_HARD_LIMITS;
  if (capacity.maximumDepth > ceilings.maximumDepth) {
    fail("input", `${path}/maximumDepth`);
  }
  if (capacity.maximumEntries > ceilings.maximumEntries) {
    fail("input", `${path}/maximumEntries`);
  }
  if (capacity.maximumFileBytes > ceilings.maximumFileBytes) {
    fail("input", `${path}/maximumFileBytes`);
  }
  if (capacity.maximumFiles > ceilings.maximumFiles) {
    fail("input", `${path}/maximumFiles`);
  }
  if (capacity.maximumTotalBytes > ceilings.maximumTotalBytes) {
    fail("input", `${path}/maximumTotalBytes`);
  }
  return capacity;
}

function parseCapacity(
  value: unknown,
): ParsedDirectoryTreeCandidateCapacity {
  const record = plainRecord(value, "$capacity");
  exactFields(record, CAPACITY_FIELDS, "$capacity");
  return parseCapacityFields(record, "$capacity");
}

function parseOptions(value: unknown): Readonly<ParsedDirectoryTreeCandidateOptions> {
  const record = plainRecord(value, "$options");
  const allowed = new Set<string>(OPTION_FIELDS);
  const missing = OPTION_FIELDS
    .filter((field) => field !== "signal")
    .find((field) => !Object.hasOwn(record, field));
  const unexpected = Object.keys(record).find((key) => !allowed.has(key));
  if (missing !== undefined || unexpected !== undefined) {
    fail("input", `$options/${unexpected ?? missing}`);
  }
  const signal = record.signal;
  if (signal !== undefined && !isDirectoryTreeCandidateAbortSignal(signal)) {
    fail("input", "$options/signal");
  }
  const capacity = parseCapacityFields(record, "$options");
  return Object.freeze({
    ...capacity,
    directoryMode: parseCandidateDirectoryMode(
      record.directoryMode,
      "$options/directoryMode",
    ),
    signal,
  });
}

export function parseDirectoryTreeCandidatePath(
  value: unknown,
  path: string,
): PortableResourcePath {
  try {
    return parsePortableResourcePath(value, path);
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) fail("input", path);
    throw error;
  }
}

function parseDigest(value: unknown, path: string): Sha256Digest {
  try {
    return parseSha256Digest(value, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("input", path);
    throw error;
  }
}

function portablePathDepth(path: PortableResourcePath): number {
  let depth = 1;
  for (let index = 0; index < path.length; index += 1) {
    if (path.charCodeAt(index) === 0x2f) depth += 1;
  }
  return depth;
}

function assertPlanPathHardCapacity(
  pathValue: PortableResourcePath,
  path: string,
): void {
  if (
    Buffer.byteLength(pathValue, "utf8")
      > DIRECTORY_TREE_CANDIDATE_V1_HARD_LIMITS.maximumPathBytes
    || portablePathDepth(pathValue)
      > DIRECTORY_TREE_CANDIDATE_V1_HARD_LIMITS.maximumDepth
  ) {
    fail("capacity", path);
  }
}

function parsePlanPath(value: unknown, path: string): PortableResourcePath {
  const parsed = parseDirectoryTreeCandidatePath(value, path);
  assertPlanPathHardCapacity(parsed, path);
  return parsed;
}

function addParentDirectories(
  filePath: PortableResourcePath,
  filePaths: ReadonlySet<PortableResourcePath>,
  directories: Set<PortableResourcePath>,
  fileCount: number,
): void {
  const segments = filePath.split("/");
  let current = "";
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (segment === undefined) fail("path-conflict", "$/files");
    current = current.length === 0 ? segment : `${current}/${segment}`;
    const directory = parsePortableResourcePath(current);
    if (filePaths.has(directory)) fail("path-conflict", "$/files");
    directories.add(directory);
    if (
      directories.size + fileCount
        > DIRECTORY_TREE_CANDIDATE_V1_HARD_LIMITS.maximumEntries
    ) {
      fail("capacity", "$/files");
    }
  }
}

function assertNoPortableCaseCollision(
  directories: readonly PortableResourcePath[],
  files: readonly Readonly<DirectoryTreeCandidatePlanFile>[],
): void {
  const collisionKeys = new Set<string>();
  for (const path of directories) {
    const key = path.toLowerCase();
    if (collisionKeys.has(key)) fail("path-conflict", "$/files");
    collisionKeys.add(key);
  }
  for (const file of files) {
    const key = file.path.toLowerCase();
    if (collisionKeys.has(key)) fail("path-conflict", "$/files");
    collisionKeys.add(key);
  }
}

export function directoryTreeCandidateMaximumPathDepth(
  directories: readonly PortableResourcePath[],
  files: readonly Readonly<DirectoryTreeCandidatePlanFile>[],
): number {
  let maximum = 0;
  for (const directory of directories) {
    maximum = Math.max(maximum, portablePathDepth(directory));
  }
  for (const file of files) {
    maximum = Math.max(maximum, portablePathDepth(file.path));
  }
  return maximum;
}

function assertPathClosure(
  files: readonly Readonly<DirectoryTreeCandidatePlanFile>[],
): readonly PortableResourcePath[] {
  const filePaths = new Set(files.map((file) => file.path));
  const directories = new Set<PortableResourcePath>();
  for (const [index, file] of files.entries()) {
    const previous = files[index - 1];
    if (previous !== undefined && compareText(previous.path, file.path) >= 0) {
      fail("file-order", `$/files/${index}/path`);
    }
    addParentDirectories(file.path, filePaths, directories, files.length);
  }
  const orderedDirectories = Object.freeze([...directories].sort(compareText));
  assertNoPortableCaseCollision(orderedDirectories, files);
  return orderedDirectories;
}

function planDigestValue(
  directoryMode: number,
  directories: readonly PortableResourcePath[],
  files: readonly Readonly<DirectoryTreeCandidatePlanFile>[],
  totalBytes: ByteCount,
): Sha256Digest {
  try {
    return computeCanonicalJsonSha256Digest(parseJsonValue({
      artifactKind: DIRECTORY_TREE_CANDIDATE_PLAN_ARTIFACT_KIND,
      schemaVersion: DIRECTORY_TREE_CANDIDATE_PLAN_SCHEMA_VERSION,
      directoryMode,
      directories,
      files,
      totalBytes,
    }, "$plan"));
  } catch (error: unknown) {
    if (error instanceof JsonValueError) fail("input", "$plan");
    throw error;
  }
}

function buildPlan(
  directoryMode: number,
  files: readonly Readonly<DirectoryTreeCandidatePlanFile>[],
): Readonly<DirectoryTreeCandidatePlan> {
  if (files.length === 0) fail("input", "$/files");
  const directories = assertPathClosure(files);
  let totalBytes = parseByteCount(0, "$plan/totalBytes");
  for (const file of files) {
    try {
      totalBytes = addByteCounts(totalBytes, file.byteCount, "$plan/totalBytes");
    } catch (error: unknown) {
      if (error instanceof ByteCountError) fail("capacity", "$/files");
      throw error;
    }
  }
  assertPlanComponentsCapacity(
    directories,
    files,
    totalBytes,
    DIRECTORY_TREE_CANDIDATE_V1_HARD_LIMITS,
    "$/files",
  );
  return Object.freeze({
    artifactKind: DIRECTORY_TREE_CANDIDATE_PLAN_ARTIFACT_KIND,
    schemaVersion: DIRECTORY_TREE_CANDIDATE_PLAN_SCHEMA_VERSION,
    directoryMode,
    directories,
    files: Object.freeze([...files]),
    totalBytes,
    treeDigest: planDigestValue(directoryMode, directories, files, totalBytes),
  });
}

function assertPlanComponentsCapacity(
  directories: readonly PortableResourcePath[],
  files: readonly Readonly<DirectoryTreeCandidatePlanFile>[],
  totalBytes: ByteCount,
  capacity: Readonly<DirectoryTreeCandidateCapacity>,
  path: string,
): void {
  if (
    files.length > capacity.maximumFiles
    || directories.length > DIRECTORY_TREE_CANDIDATE_MAXIMUM_PLAN_DIRECTORIES
    || directories.length + files.length > capacity.maximumEntries
    || files.some((file) => file.byteCount > capacity.maximumFileBytes)
    || totalBytes > capacity.maximumTotalBytes
    || directoryTreeCandidateMaximumPathDepth(directories, files)
      > capacity.maximumDepth
  ) {
    fail("capacity", path);
  }
}

function assertPlanCapacity(
  plan: Readonly<DirectoryTreeCandidatePlan>,
  capacity: Readonly<DirectoryTreeCandidateCapacity>,
  path: string,
): void {
  assertPlanComponentsCapacity(
    plan.directories,
    plan.files,
    plan.totalBytes,
    capacity,
    path,
  );
}

export function prepareDirectoryTreeCandidate(
  filesValue: unknown,
  optionsValue: unknown,
): Readonly<PreparedDirectoryTreeCandidate> {
  const options = parseOptions(optionsValue);
  assertDirectoryTreeCandidateNotAborted(options.signal);
  const values = denseArray(filesValue, options.maximumFiles, "$files");
  if (values.length === 0) fail("input", "$files");
  const files = values.map((value, index): Readonly<PreparedDirectoryTreeCandidateFile> => {
    const input = plainRecord(value, `$files/${index}`);
    exactFields(input, INPUT_FILE_FIELDS, `$files/${index}`);
    const inputBytes = input.bytes;
    if (
      !ArrayBuffer.isView(inputBytes)
      || !(inputBytes instanceof Uint8Array)
      || types.isProxy(inputBytes)
      || inputBytes.buffer instanceof SharedArrayBuffer
    ) {
      fail("input", `$files/${index}/bytes`);
    }
    if (inputBytes.byteLength > options.maximumFileBytes) {
      fail("capacity", `$files/${index}/bytes`);
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(inputBytes);
    } catch {
      fail("capacity", `$files/${index}/bytes`);
    }
    return Object.freeze({
      path: parsePlanPath(input.path, `$files/${index}/path`),
      bytes,
      byteCount: parseByteCount(bytes.byteLength, `$files/${index}/bytes`),
      digest: computeSha256Digest(bytes, `$files/${index}/bytes`),
      mode: parseCandidateFileMode(input.mode, `$files/${index}/mode`),
    });
  });
  const planFiles = Object.freeze(files.map((file) => Object.freeze({
    path: file.path,
    byteCount: file.byteCount,
    digest: file.digest,
    mode: file.mode,
  })));
  const plan = buildPlan(options.directoryMode, planFiles);
  assertPlanCapacity(plan, options, "$files");
  return Object.freeze({ plan, files: Object.freeze(files), options });
}

export function planDirectoryTreeCandidate(
  filesValue: readonly DirectoryTreeCandidateFileInput[],
  optionsValue: DirectoryTreeCandidateOptions,
): Readonly<DirectoryTreeCandidatePlan> {
  return prepareDirectoryTreeCandidate(filesValue, optionsValue).plan;
}

function parsePlanFile(
  value: unknown,
  index: number,
): Readonly<DirectoryTreeCandidatePlanFile> {
  const path = `$/files/${index}`;
  const record = plainRecord(value, path);
  exactFields(record, PLAN_FILE_FIELDS, path);
  return Object.freeze({
    path: parsePlanPath(record.path, `${path}/path`),
    byteCount: byteCount(record.byteCount, `${path}/byteCount`),
    digest: parseDigest(record.digest, `${path}/digest`),
    mode: parseCandidateFileMode(record.mode, `${path}/mode`),
  });
}

/**
 * 从已有内容摘要描述符生成与 bytes 入口完全相同的目录树候选计划。
 *
 * 本入口不读取文件或信任调用方摘要；上层必须把每个描述符交给真实 copy/verify
 * consumer。计划仍执行排序、路径闭包、总量、深度和 tree digest 的完整复验。
 */
export function planDirectoryTreeCandidateFromFileDescriptors(
  filesValue: readonly DirectoryTreeCandidatePlanFile[],
  optionsValue: DirectoryTreeCandidateOptions,
): Readonly<DirectoryTreeCandidatePlan> {
  const options = parseOptions(optionsValue);
  assertDirectoryTreeCandidateNotAborted(options.signal);
  const values = denseArray(filesValue, options.maximumFiles, "$files");
  if (values.length === 0) fail("input", "$files");
  const files = Object.freeze(values.map(parsePlanFile));
  const plan = buildPlan(options.directoryMode, files);
  assertPlanCapacity(plan, options, "$files");
  return plan;
}

/**
 * 重建并验证一份持久目录树计划。
 *
 * v1始终执行Foundation硬上限；owner可提供更小容量，但不能借此放宽硬上限。容量
 * 不进入持久计划或tree digest，同一内容的身份不会因调用方准入政策而改变。
 */
export function parseDirectoryTreeCandidatePlan(
  value: unknown,
  capacityValue?: DirectoryTreeCandidateCapacity,
): Readonly<DirectoryTreeCandidatePlan> {
  const capacity = capacityValue === undefined
    ? undefined
    : parseCapacity(capacityValue);
  const record = plainRecord(value, "$plan");
  exactFields(record, PLAN_FIELDS, "$plan");
  if (
    record.artifactKind !== DIRECTORY_TREE_CANDIDATE_PLAN_ARTIFACT_KIND
    || record.schemaVersion !== DIRECTORY_TREE_CANDIDATE_PLAN_SCHEMA_VERSION
  ) {
    fail("input", "$plan");
  }
  const files = Object.freeze(
    denseArray(
      record.files,
      DIRECTORY_TREE_CANDIDATE_MAXIMUM_PLAN_FILES,
      "$/files",
    ).map(parsePlanFile),
  );
  const rebuilt = buildPlan(
    parseCandidateDirectoryMode(record.directoryMode, "$/directoryMode"),
    files,
  );
  const rawDirectories = denseArray(
    record.directories,
    DIRECTORY_TREE_CANDIDATE_MAXIMUM_PLAN_DIRECTORIES,
    "$/directories",
  )
    .map((entry, index) => parsePlanPath(
      entry,
      `$/directories/${index}`,
    ));
  const totalBytes = byteCount(record.totalBytes, "$/totalBytes");
  const treeDigest = parseDigest(record.treeDigest, "$/treeDigest");
  if (
    rawDirectories.length !== rebuilt.directories.length
    || rawDirectories.some((entry, index) => entry !== rebuilt.directories[index])
    || totalBytes !== rebuilt.totalBytes
    || treeDigest !== rebuilt.treeDigest
  ) {
    fail("path-conflict", "$plan");
  }
  if (capacity !== undefined) {
    assertPlanCapacity(rebuilt, capacity, "$plan");
  }
  return rebuilt;
}

export function joinDirectoryTreeCandidatePath(
  candidateRootPath: PortableResourcePath,
  relativePath: PortableResourcePath,
): PortableResourcePath {
  return parsePortableResourcePath(`${candidateRootPath}/${relativePath}`);
}

export function assertDirectoryTreeCandidateNotAborted(
  signal: AbortSignal | undefined,
): void {
  if (signal?.aborted === true) fail("aborted", "$signal");
}
