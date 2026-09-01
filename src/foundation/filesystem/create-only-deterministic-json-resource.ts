import { types } from "node:util";

import {
  DeterministicJsonDocumentError,
  parseDeterministicJsonDocument,
} from "../data/deterministic-json-document.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../data/passive-own-data.js";
import { encodeUtf8, Utf8Error } from "../text/utf8.js";
import {
  parseByteCount,
  ByteCountError,
  type ByteCount,
} from "../numeric/byte-count.js";
import {
  createFileAtomically,
  DurableAtomicFileWriteError,
} from "./durable-atomic-file-write.js";
import {
  materializeDirectoryPath,
  DurableDirectoryMaterializationError,
} from "./durable-directory-materialization.js";
import {
  readDeterministicJsonFile,
  type DeterministicJsonFileResult,
} from "./deterministic-json-file.js";
import type { FileNodeSnapshot } from "./file-node-snapshot.js";
import {
  parsePortableResourcePath,
  PortableResourcePathError,
  splitPortableResourcePath,
  type PortableResourcePath,
} from "./portable-resource-path.js";
import { RootedDirectory, RootedDirectoryError } from "./rooted-directory.js";
import { StableFileReadError } from "./stable-file-read.js";
import { StrictTextFileError } from "./strict-text-file.js";

/**
 * Wakeflow Foundation / Filesystem：私有确定性 JSON 资源的只创建物化。
 *
 * 本模块把两个已经反复出现的文件系统约束组合为一个可复用原语：先按固定权限逐级
 * 物化父目录，再以不替换语义耐久创建一份确定性 JSON 文件。目标已存在时只允许字节
 * 完全相同，并重新验证普通文件、权限、单硬链接和当前用户所有权。
 *
 * 它不解释 JSON 领域结构、摘要权威、资源目录准入或业务事件。调用方必须先从自己的
 * 权威来源生成完整期望文本，并在成功后使用领域 parser 复验返回内容。
 */

export interface CreateOnlyDeterministicJsonResourcePolicy {
  readonly directoryPath: PortableResourcePath;
  readonly resourcePath: PortableResourcePath;
  readonly directoryMode: number;
  readonly fileMode: number;
  readonly maximumBytes: ByteCount;
}

export interface LoadCreateOnlyDeterministicJsonResourceOptions {
  readonly signal?: AbortSignal;
}

export interface MaterializeCreateOnlyDeterministicJsonResourceOptions {
  readonly signal?: AbortSignal;
}

export interface CreateOnlyDeterministicJsonResourceReceipt {
  readonly disposition: "created" | "current";
  readonly source: Readonly<DeterministicJsonFileResult>;
}

export type CreateOnlyDeterministicJsonResourceErrorReason =
  | "input"
  | "not-found"
  | "conflict"
  | "node-policy"
  | "capacity"
  | "recovery-required"
  | "commit-uncertain"
  | "root-scope"
  | "aborted"
  | "operation-failure";

const ERROR_MESSAGES = {
  input: "Create-only deterministic JSON resource input is invalid.",
  "not-found": "Create-only deterministic JSON resource does not exist.",
  conflict: "Create-only deterministic JSON resource has different bytes.",
  "node-policy":
    "Create-only deterministic JSON resource violates its node policy.",
  capacity: "Create-only deterministic JSON resource exceeds its capacity.",
  "recovery-required":
    "Create-only deterministic JSON resource requires stage recovery.",
  "commit-uncertain":
    "Create-only deterministic JSON resource commit cannot be proven.",
  "root-scope":
    "Create-only deterministic JSON resource lost its rooted scope.",
  aborted: "Create-only deterministic JSON resource operation was aborted.",
  "operation-failure":
    "Create-only deterministic JSON resource operation failed.",
} as const satisfies Readonly<
  Record<CreateOnlyDeterministicJsonResourceErrorReason, string>
>;

/** 只创建确定性 JSON 资源失败时的稳定、脱敏错误。 */
export class CreateOnlyDeterministicJsonResourceError extends Error {
  override readonly name = "CreateOnlyDeterministicJsonResourceError";
  readonly code = "wakeflow-create-only-deterministic-json-resource" as const;
  readonly reason: CreateOnlyDeterministicJsonResourceErrorReason;
  readonly path: string;

  constructor(
    reason: CreateOnlyDeterministicJsonResourceErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface ParsedResourcePolicy extends CreateOnlyDeterministicJsonResourcePolicy {
  readonly directoryPath: PortableResourcePath;
  readonly resourcePath: PortableResourcePath;
}

function fail(
  reason: CreateOnlyDeterministicJsonResourceErrorReason,
  path: string,
): never {
  throw new CreateOnlyDeterministicJsonResourceError(reason, path);
}

function exactRecord(
  value: unknown,
  fields: readonly string[],
  path: string,
): Readonly<Record<string, unknown>> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, path);
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", path);
    throw error;
  }
  const keys = Object.keys(record).sort();
  const expected = [...fields].sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  ) {
    fail("input", path);
  }
  return record;
}

function portablePath(value: unknown, path: string): PortableResourcePath {
  try {
    return parsePortableResourcePath(value, path);
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) fail("input", path);
    throw error;
  }
}

function mode(value: unknown, path: string): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 0o777
  ) {
    fail("input", path);
  }
  return value;
}

function maximumBytes(value: unknown): ByteCount {
  let parsed: ByteCount;
  try {
    parsed = parseByteCount(value, "$/maximumBytes");
  } catch (error: unknown) {
    if (error instanceof ByteCountError) fail("input", "$/maximumBytes");
    throw error;
  }
  if (parsed < 1) fail("input", "$/maximumBytes");
  return parsed;
}

function isStrictDescendant(
  directoryPath: PortableResourcePath,
  resourcePath: PortableResourcePath,
): boolean {
  let directorySegments: readonly string[];
  let resourceSegments: readonly string[];
  try {
    directorySegments = splitPortableResourcePath(
      directoryPath,
      "$/directoryPath",
    );
    resourceSegments = splitPortableResourcePath(
      resourcePath,
      "$/resourcePath",
    );
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) fail("input", "$policy");
    throw error;
  }
  return (
    resourceSegments.length > directorySegments.length &&
    directorySegments.every(
      (segment, index) => resourceSegments[index] === segment,
    )
  );
}

function parsePolicy(value: unknown): Readonly<ParsedResourcePolicy> {
  const record = exactRecord(
    value,
    [
      "directoryMode",
      "directoryPath",
      "fileMode",
      "maximumBytes",
      "resourcePath",
    ],
    "$policy",
  );
  const directoryPath = portablePath(record.directoryPath, "$/directoryPath");
  const resourcePath = portablePath(record.resourcePath, "$/resourcePath");
  if (!isStrictDescendant(directoryPath, resourcePath)) {
    fail("input", "$/resourcePath");
  }
  return Object.freeze({
    directoryPath,
    resourcePath,
    directoryMode: mode(record.directoryMode, "$/directoryMode"),
    fileMode: mode(record.fileMode, "$/fileMode"),
    maximumBytes: maximumBytes(record.maximumBytes),
  });
}

function parseSignal(value: unknown): AbortSignal | undefined {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }
  if (Object.keys(record).some((key) => key !== "signal")) {
    fail("input", "$options");
  }
  const signal = record.signal;
  if (
    signal !== undefined &&
    (typeof signal !== "object" ||
      signal === null ||
      types.isProxy(signal) ||
      !(signal instanceof AbortSignal))
  ) {
    fail("input", "$/signal");
  }
  return signal as AbortSignal | undefined;
}

function assertRoot(value: unknown): asserts value is RootedDirectory {
  if (
    typeof value !== "object" ||
    value === null ||
    types.isProxy(value) ||
    !(value instanceof RootedDirectory)
  ) {
    fail("input", "$root");
  }
}

function currentUserId(): bigint | null {
  return typeof process.geteuid === "function"
    ? BigInt(process.geteuid())
    : null;
}

function assertDirectoryNode(
  node: Readonly<FileNodeSnapshot>,
  expectedMode: number,
): void {
  if (
    node.kind !== "directory" ||
    node.permissionBits !== expectedMode ||
    (currentUserId() !== null && node.userId !== currentUserId())
  ) {
    fail("node-policy", "$directory");
  }
}

function assertFileNode(
  node: Readonly<FileNodeSnapshot>,
  expectedMode: number,
): void {
  if (
    node.kind === "file" &&
    node.permissionBits === expectedMode &&
    node.linkCount === 2n &&
    (currentUserId() === null || node.userId === currentUserId())
  ) {
    fail("recovery-required", "$resource");
  }
  if (
    node.kind !== "file" ||
    node.permissionBits !== expectedMode ||
    node.linkCount !== 1n ||
    (currentUserId() !== null && node.userId !== currentUserId())
  ) {
    fail("node-policy", "$resource");
  }
}

async function inspectResourceNodeOrNull(
  root: RootedDirectory,
  policy: Readonly<ParsedResourcePolicy>,
): Promise<Readonly<FileNodeSnapshot> | null> {
  try {
    return (await root.inspectExistingResource(policy.resourcePath)).node;
  } catch (error: unknown) {
    if (
      error instanceof RootedDirectoryError &&
      error.reason === "resource-not-found"
    ) {
      return null;
    }
    if (error instanceof RootedDirectoryError) {
      if (
        error.reason === "ancestor-symlink" ||
        error.reason === "ancestor-type" ||
        error.reason === "resource-alias"
      ) {
        fail("node-policy", "$resource");
      }
      fail("root-scope", "$root");
    }
    throw error;
  }
}

function mapReadError(error: unknown): never {
  if (error instanceof StableFileReadError) {
    if (error.reason === "aborted") fail("aborted", "$signal");
    if (error.reason === "not-found") fail("not-found", "$resource");
    if (
      error.reason === "root-scope" ||
      error.reason === "unsupported-platform"
    ) {
      fail("root-scope", "$root");
    }
    if (
      error.reason === "expectation-changed" ||
      error.reason === "source-changed"
    ) {
      fail("conflict", "$resource");
    }
    if (error.reason === "too-large") fail("capacity", "$resource");
    if (error.reason === "symlink" || error.reason === "not-file") {
      fail("node-policy", "$resource");
    }
    fail("operation-failure", "$resource");
  }
  if (
    error instanceof StrictTextFileError ||
    error instanceof DeterministicJsonDocumentError
  ) {
    fail("conflict", "$resource");
  }
  throw error;
}

async function load(
  root: RootedDirectory,
  policy: Readonly<ParsedResourcePolicy>,
  signal: AbortSignal | undefined,
): Promise<Readonly<DeterministicJsonFileResult>> {
  const node = await inspectResourceNodeOrNull(root, policy);
  if (node === null) fail("not-found", "$resource");
  assertFileNode(node, policy.fileMode);
  try {
    return await readDeterministicJsonFile(root, policy.resourcePath, {
      maximumBytes: policy.maximumBytes,
      expectedNode: node,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    mapReadError(error);
  }
}

function mapDirectoryError(error: DurableDirectoryMaterializationError): never {
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (
    error.reason === "root-scope" ||
    error.reason === "parent-changed" ||
    error.reason === "path-changed"
  ) {
    fail("root-scope", "$root");
  }
  if (
    error.reason === "target-symlink" ||
    error.reason === "target-not-directory"
  ) {
    fail("node-policy", "$directory");
  }
  if (
    error.reason === "commit-uncertain" ||
    error.reason === "durability-failure" ||
    error.reason === "close-failure"
  ) {
    fail("commit-uncertain", "$directory");
  }
  fail("operation-failure", "$directory");
}

function mapWriteError(error: DurableAtomicFileWriteError): never {
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (error.reason === "root-scope" || error.reason === "parent-changed") {
    fail("root-scope", "$root");
  }
  if (error.reason === "capacity") fail("capacity", "$resource");
  if (error.reason === "stage-recovery-required") {
    fail("recovery-required", "$resource");
  }
  if (
    error.reason === "commit-uncertain" ||
    error.reason === "durability-failure" ||
    error.reason === "stage-cleanup-failure" ||
    error.reason === "close-failure"
  ) {
    fail("commit-uncertain", "$resource");
  }
  fail("operation-failure", "$resource");
}

/** 按固定节点策略稳定读取一份已有的只创建确定性 JSON 资源。 */
export async function loadCreateOnlyDeterministicJsonResource(
  rootValue: unknown,
  policyValue: unknown,
  optionsValue: LoadCreateOnlyDeterministicJsonResourceOptions = {},
): Promise<Readonly<DeterministicJsonFileResult>> {
  assertRoot(rootValue);
  const policy = parsePolicy(policyValue);
  const signal = parseSignal(optionsValue);
  if (signal?.aborted === true) fail("aborted", "$signal");
  return load(rootValue, policy, signal);
}

/**
 * 幂等物化一份只创建确定性 JSON 资源；已有目标只有与完整期望文本一致时才返回
 * `current`，任何不同字节都保持冲突且不会被覆盖。
 */
export async function materializeCreateOnlyDeterministicJsonResource(
  rootValue: unknown,
  policyValue: unknown,
  expectedTextValue: unknown,
  optionsValue: MaterializeCreateOnlyDeterministicJsonResourceOptions = {},
): Promise<Readonly<CreateOnlyDeterministicJsonResourceReceipt>> {
  assertRoot(rootValue);
  const policy = parsePolicy(policyValue);
  const signal = parseSignal(optionsValue);
  if (signal?.aborted === true) fail("aborted", "$signal");
  if (typeof expectedTextValue !== "string") fail("input", "$expectedText");
  try {
    parseDeterministicJsonDocument(expectedTextValue, "$expectedText");
  } catch (error: unknown) {
    if (error instanceof DeterministicJsonDocumentError) {
      fail("input", "$expectedText");
    }
    throw error;
  }
  let bytes: Uint8Array;
  try {
    bytes = encodeUtf8(expectedTextValue, "$expectedText");
  } catch (error: unknown) {
    if (error instanceof Utf8Error) fail("input", "$expectedText");
    throw error;
  }
  if (bytes.byteLength > policy.maximumBytes) {
    fail("capacity", "$expectedText");
  }
  let directory;
  try {
    directory = await materializeDirectoryPath(
      rootValue,
      policy.directoryPath,
      {
        mode: policy.directoryMode,
        ...(signal === undefined ? {} : { signal }),
      },
    );
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryMaterializationError) {
      mapDirectoryError(error);
    }
    throw error;
  }
  assertDirectoryNode(directory.node, policy.directoryMode);
  let disposition: "created" | "current" = "created";
  try {
    await createFileAtomically(rootValue, policy.resourcePath, bytes, {
      mode: policy.fileMode,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (
      error instanceof DurableAtomicFileWriteError &&
      error.reason === "target-exists"
    ) {
      disposition = "current";
    } else if (error instanceof DurableAtomicFileWriteError) {
      mapWriteError(error);
    } else {
      throw error;
    }
  }
  let source: Readonly<DeterministicJsonFileResult>;
  try {
    source = await load(rootValue, policy, signal);
  } catch (error: unknown) {
    if (
      disposition === "created" &&
      error instanceof CreateOnlyDeterministicJsonResourceError
    ) {
      fail("commit-uncertain", "$resource");
    }
    throw error;
  }
  if (source.text !== expectedTextValue) {
    fail(
      disposition === "created" ? "commit-uncertain" : "conflict",
      "$resource",
    );
  }
  return Object.freeze({ disposition, source });
}
