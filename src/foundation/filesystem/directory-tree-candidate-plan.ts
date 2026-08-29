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

export interface DirectoryTreeCandidateFileInput {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly mode: number;
}

export interface DirectoryTreeCandidateOptions {
  readonly directoryMode: number;
  readonly maximumDepth: number;
  readonly maximumEntries: number;
  readonly maximumFileBytes: number;
  readonly maximumFiles: number;
  readonly maximumTotalBytes: number;
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

export interface ParsedDirectoryTreeCandidateOptions {
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
    if (error instanceof PassiveOwnDataError) fail("input", path);
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
  return Object.freeze({
    directoryMode: parseMode(record.directoryMode, "$options/directoryMode"),
    maximumDepth: parsePositiveCount(record.maximumDepth, "$options/maximumDepth"),
    maximumEntries: parsePositiveCount(record.maximumEntries, "$options/maximumEntries"),
    maximumFileBytes: byteCount(record.maximumFileBytes, "$options/maximumFileBytes"),
    maximumFiles: parsePositiveCount(record.maximumFiles, "$options/maximumFiles"),
    maximumTotalBytes: byteCount(record.maximumTotalBytes, "$options/maximumTotalBytes"),
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

function parentDirectories(path: PortableResourcePath): readonly PortableResourcePath[] {
  const segments = path.split("/");
  return Object.freeze(segments.slice(0, -1).map((_, index) => (
    parsePortableResourcePath(segments.slice(0, index + 1).join("/"))
  )));
}

export function directoryTreeCandidateMaximumPathDepth(
  directories: readonly PortableResourcePath[],
  files: readonly Readonly<DirectoryTreeCandidatePlanFile>[],
): number {
  return Math.max(
    0,
    ...directories.map((entry) => entry.split("/").length),
    ...files.map((entry) => entry.path.split("/").length),
  );
}

function assertPathClosure(
  files: readonly Readonly<DirectoryTreeCandidatePlanFile>[],
): readonly PortableResourcePath[] {
  const directories = new Set<PortableResourcePath>();
  for (const [index, file] of files.entries()) {
    const previous = files[index - 1];
    if (previous !== undefined && compareText(previous.path, file.path) >= 0) {
      fail("file-order", `$/files/${index}/path`);
    }
    for (const other of files) {
      if (
        other !== file
        && (
          file.path.startsWith(`${other.path}/`)
          || other.path.startsWith(`${file.path}/`)
        )
      ) {
        fail("path-conflict", "$/files");
      }
    }
    for (const directory of parentDirectories(file.path)) directories.add(directory);
  }
  return Object.freeze([...directories].sort(compareText));
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

function assertPlanCapacity(
  plan: Readonly<DirectoryTreeCandidatePlan>,
  options: Readonly<ParsedDirectoryTreeCandidateOptions>,
  path: string,
): void {
  if (
    plan.files.length > options.maximumFiles
    || plan.directories.length > DIRECTORY_TREE_CANDIDATE_MAXIMUM_PLAN_DIRECTORIES
    || plan.directories.length + plan.files.length > options.maximumEntries
    || plan.files.some((file) => file.byteCount > options.maximumFileBytes)
    || plan.totalBytes > options.maximumTotalBytes
    || directoryTreeCandidateMaximumPathDepth(plan.directories, plan.files)
      > options.maximumDepth
  ) {
    fail("capacity", path);
  }
}

export function prepareDirectoryTreeCandidate(
  filesValue: unknown,
  optionsValue: unknown,
): Readonly<PreparedDirectoryTreeCandidate> {
  const options = parseOptions(optionsValue);
  if (
    options.maximumFiles > DIRECTORY_TREE_CANDIDATE_MAXIMUM_PLAN_FILES
    || options.maximumEntries
      > DIRECTORY_TREE_CANDIDATE_MAXIMUM_PLAN_FILES
        + DIRECTORY_TREE_CANDIDATE_MAXIMUM_PLAN_DIRECTORIES
  ) {
    fail("input", "$options");
  }
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
    ) {
      fail("input", `$files/${index}/bytes`);
    }
    const bytes = new Uint8Array(inputBytes);
    if (bytes.byteLength > options.maximumFileBytes) {
      fail("capacity", `$files/${index}/bytes`);
    }
    return Object.freeze({
      path: parseDirectoryTreeCandidatePath(input.path, `$files/${index}/path`),
      bytes,
      byteCount: parseByteCount(bytes.byteLength, `$files/${index}/bytes`),
      digest: computeSha256Digest(bytes, `$files/${index}/bytes`),
      mode: parseMode(input.mode, `$files/${index}/mode`),
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
    path: parseDirectoryTreeCandidatePath(record.path, `${path}/path`),
    byteCount: byteCount(record.byteCount, `${path}/byteCount`),
    digest: parseDigest(record.digest, `${path}/digest`),
    mode: parseMode(record.mode, `${path}/mode`),
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
  if (
    options.maximumFiles > DIRECTORY_TREE_CANDIDATE_MAXIMUM_PLAN_FILES
    || options.maximumEntries
      > DIRECTORY_TREE_CANDIDATE_MAXIMUM_PLAN_FILES
        + DIRECTORY_TREE_CANDIDATE_MAXIMUM_PLAN_DIRECTORIES
  ) {
    fail("input", "$options");
  }
  const values = denseArray(filesValue, options.maximumFiles, "$files");
  if (values.length === 0) fail("input", "$files");
  const files = Object.freeze(values.map(parsePlanFile));
  const plan = buildPlan(options.directoryMode, files);
  assertPlanCapacity(plan, options, "$files");
  return plan;
}

export function parseDirectoryTreeCandidatePlan(
  value: unknown,
): Readonly<DirectoryTreeCandidatePlan> {
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
  const rebuilt = buildPlan(parseMode(record.directoryMode, "$/directoryMode"), files);
  const rawDirectories = denseArray(
    record.directories,
    DIRECTORY_TREE_CANDIDATE_MAXIMUM_PLAN_DIRECTORIES,
    "$/directories",
  )
    .map((entry, index) => parseDirectoryTreeCandidatePath(
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
