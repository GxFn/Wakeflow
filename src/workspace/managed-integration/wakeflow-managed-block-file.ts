import { types } from "node:util";

import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import {
  createFileAtomically,
  type DurableAtomicFileReplaceResult,
  DurableAtomicFileWriteError,
  type DurableAtomicFileWriteResult,
  replaceFileAtomically,
} from "../../foundation/filesystem/durable-atomic-file-write.js";
import {
  ExactRegularFileUnlinkError,
  unlinkRegularFileExactly,
} from "../../foundation/filesystem/exact-regular-file-unlink.js";
import { sameFileNodeSnapshot } from "../../foundation/filesystem/file-node-snapshot.js";
import {
  type PortableResourcePath,
  PortableResourcePathError,
  parsePortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
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
  type ByteCount,
  ByteCountError,
  parseByteCount,
} from "../../foundation/numeric/byte-count.js";
import {
  planWakeflowManagedTextAuthorityTransition,
  type WakeflowManagedTextAuthorityTransition,
  WakeflowManagedTextAuthorityTransitionError,
} from "./wakeflow-managed-text-authority-transition.js";
import {
  inspectWakeflowManagedTextEnvelope,
  parseWakeflowManagedTextEnvelopeTarget,
  removeWakeflowManagedTextEnvelope,
  WakeflowManagedTextEnvelopeError,
  type WakeflowManagedTextEnvelopeIdentity,
  type WakeflowManagedTextEnvelopeTarget,
  type WakeflowManagedTextRemovalResult,
} from "./wakeflow-managed-text-envelope.js";

/**
 * Wakeflow Workspace / Managed Integration：任意根目录里一个文件中 Wakeflow 托管块的
 * 只读检查与 CAS 重组。
 *
 * 调用方提供已由领域权威推导出的 current/desired envelope target；本模块只做机械部分：
 * 稳定读取（当前用户拥有的单链接普通文件，权限位不限）、current→desired 转换、目标不存在
 * 时以给定权限原子创建只含托管块的文件、存在时以完整 StableFileSource 做 CAS 替换并保留
 * 所有者权限位、提交后读回闭合。它不取得锁、不知道文件属于哪个领域，也不解释区域外文本。
 */

export interface WakeflowManagedBlockFileRequest {
  readonly resourcePath: unknown;
  readonly currentTargets: readonly unknown[];
  readonly desiredTarget: unknown;
  readonly maximumBytes?: ByteCount;
  readonly signal?: AbortSignal;
}

export interface WakeflowManagedBlockFileInspection {
  readonly status: "managed-current" | "recompose-required";
  readonly resourcePath: PortableResourcePath;
  readonly source: Readonly<StableFileSource> | null;
  readonly transition: Readonly<WakeflowManagedTextAuthorityTransition>;
}

export interface WakeflowManagedBlockFileRecompositionOptions {
  readonly createMode: number;
}

export type WakeflowManagedBlockFileEffect =
  | Readonly<DurableAtomicFileWriteResult<"created">>
  | Readonly<DurableAtomicFileReplaceResult>;

export interface WakeflowManagedBlockFileReceipt {
  readonly disposition: "current" | "created" | "replaced";
  readonly effect: Readonly<WakeflowManagedBlockFileEffect> | null;
  readonly inspection: Readonly<WakeflowManagedBlockFileInspection>;
}

export type WakeflowManagedBlockFileErrorReason =
  | "input"
  | "unsupported-platform"
  | "root-scope"
  | "root-policy"
  | "source"
  | "source-capacity"
  | "source-policy"
  | "envelope"
  | "unknown-managed-body"
  | "target-capacity"
  | "conflict"
  | "recovery-required"
  | "aborted"
  | "effect-failure"
  | "commit-uncertain";

const ERROR_MESSAGES = {
  input: "Wakeflow managed block file input is invalid.",
  "unsupported-platform": "Wakeflow managed block file requires POSIX ownership facts.",
  "root-scope": "Wakeflow managed block file lost its root scope.",
  "root-policy": "Wakeflow managed block file requires a current-user root.",
  source: "Wakeflow managed block file source cannot be read stably.",
  "source-capacity": "Wakeflow managed block file source exceeds its byte budget.",
  "source-policy": "Wakeflow managed block file source violates its node policy.",
  envelope: "Wakeflow managed block file envelope is invalid.",
  "unknown-managed-body": "Wakeflow managed block file body is not an admitted render.",
  "target-capacity": "Wakeflow managed block file candidate exceeds its byte budget.",
  conflict: "Wakeflow managed block file source changed before atomic publication.",
  "recovery-required":
    "Wakeflow managed block file target has stage residue that requires explicit recovery.",
  aborted: "Wakeflow managed block file operation was aborted.",
  "effect-failure": "Wakeflow managed block file effect failed.",
  "commit-uncertain": "Wakeflow managed block file commit outcome is uncertain.",
} as const satisfies Readonly<Record<WakeflowManagedBlockFileErrorReason, string>>;

/** 托管块文件检查或重组失败的稳定、脱敏错误。 */
export class WakeflowManagedBlockFileError extends Error {
  override readonly name = "WakeflowManagedBlockFileError";
  readonly code = "wakeflow-managed-block-file" as const;
  readonly reason: WakeflowManagedBlockFileErrorReason;
  readonly path: string;

  constructor(reason: WakeflowManagedBlockFileErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

const DEFAULT_MAXIMUM_BYTES = parseByteCount(1024 * 1024, "$managedBlockFile.maximumBytes");

/** 读源文件只需要路径、字节预算与信号：重组请求与删除请求共用。 */
interface SourceReadRequest {
  readonly resourcePath: PortableResourcePath;
  readonly maximumBytes: ByteCount;
  readonly signal: AbortSignal | undefined;
}

interface ParsedRequest extends SourceReadRequest {
  readonly currentTargets: readonly Readonly<WakeflowManagedTextEnvelopeTarget>[];
  readonly desiredTarget: Readonly<WakeflowManagedTextEnvelopeTarget>;
}

function fail(reason: WakeflowManagedBlockFileErrorReason, path: string): never {
  throw new WakeflowManagedBlockFileError(reason, path);
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

function isAbortSignal(value: unknown): value is AbortSignal {
  return (
    typeof value === "object" &&
    value !== null &&
    !types.isProxy(value) &&
    value instanceof AbortSignal
  );
}

function parseRequest(value: WakeflowManagedBlockFileRequest): Readonly<ParsedRequest> {
  if (typeof value !== "object" || value === null || types.isProxy(value)) {
    fail("input", "$request");
  }
  let resourcePath: PortableResourcePath;
  try {
    resourcePath = parsePortableResourcePath(value.resourcePath, "$request.resourcePath");
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) fail("input", "$request.resourcePath");
    throw error;
  }
  if (value.signal !== undefined && !isAbortSignal(value.signal)) {
    fail("input", "$request.signal");
  }
  if (!Array.isArray(value.currentTargets)) fail("input", "$request.currentTargets");
  // envelope target 的形状由 transition planner 严格准入；这里只做零 I/O 的预演。
  try {
    planWakeflowManagedTextAuthorityTransition(new Uint8Array(), {
      currentTargets: value.currentTargets,
      desiredTarget: value.desiredTarget,
    });
  } catch (error: unknown) {
    if (error instanceof WakeflowManagedTextAuthorityTransitionError) {
      fail("input", error.path);
    }
    throw error;
  }
  let maximumBytes = DEFAULT_MAXIMUM_BYTES;
  if (value.maximumBytes !== undefined) {
    try {
      maximumBytes = parseByteCount(value.maximumBytes, "$request.maximumBytes");
    } catch (error: unknown) {
      if (error instanceof ByteCountError) fail("input", "$request.maximumBytes");
      throw error;
    }
  }
  return Object.freeze({
    resourcePath,
    currentTargets: Object.freeze([
      ...value.currentTargets,
    ] as Readonly<WakeflowManagedTextEnvelopeTarget>[]),
    desiredTarget: value.desiredTarget as Readonly<WakeflowManagedTextEnvelopeTarget>,
    maximumBytes,
    signal: value.signal,
  });
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) fail("aborted", "$signal");
}

function currentUserId(): bigint {
  if (process.platform === "win32" || typeof process.geteuid !== "function") {
    fail("unsupported-platform", "$root");
  }
  return BigInt(process.geteuid());
}

async function assertCurrentUserRoot(root: RootedDirectory, expectedUserId: bigint): Promise<void> {
  let userId: bigint;
  try {
    userId = (await root.assertCurrent("$root")).userId;
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) fail("root-scope", "$root");
    throw error;
  }
  if (userId !== expectedUserId) fail("root-policy", "$root");
}

async function readSource(
  root: RootedDirectory,
  request: Readonly<SourceReadRequest>,
  expectedUserId: bigint,
): Promise<Readonly<{
  readonly facts: Readonly<StableFileSource>;
  readonly bytes: Uint8Array;
}> | null> {
  try {
    const read = await readStableFile(root, request.resourcePath, {
      maximumBytes: request.maximumBytes,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    if (
      read.node.kind !== "file" ||
      read.node.linkCount !== 1n ||
      read.node.userId !== expectedUserId
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
    if (error instanceof WakeflowManagedBlockFileError) throw error;
    if (error instanceof StableFileReadError) {
      if (error.reason === "not-found") return null;
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "symlink" || error.reason === "not-file") {
        fail("source-policy", "$source");
      }
      if (error.reason === "too-large") fail("source-capacity", "$source");
      fail("source", "$source");
    }
    throw error;
  }
}

async function revalidateSource(
  root: RootedDirectory,
  request: Readonly<SourceReadRequest>,
  initial: Awaited<ReturnType<typeof readSource>>,
): Promise<void> {
  try {
    const current = await readStableFile(root, request.resourcePath, {
      maximumBytes: request.maximumBytes,
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
    if (error instanceof WakeflowManagedBlockFileError) throw error;
    if (error instanceof StableFileReadError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (initial === null && error.reason === "not-found") return;
      fail("source", "$source");
    }
    throw error;
  }
}

async function inspectParsed(
  root: RootedDirectory,
  request: Readonly<ParsedRequest>,
  expectedUserId: bigint,
): Promise<Readonly<WakeflowManagedBlockFileInspection>> {
  assertNotAborted(request.signal);
  const read = await readSource(root, request, expectedUserId);
  let transition: Readonly<WakeflowManagedTextAuthorityTransition>;
  try {
    transition = planWakeflowManagedTextAuthorityTransition(read?.bytes ?? new Uint8Array(), {
      currentTargets: request.currentTargets,
      desiredTarget: request.desiredTarget,
    });
  } catch (error: unknown) {
    if (error instanceof WakeflowManagedTextAuthorityTransitionError) {
      if (error.reason === "unadmitted-source") fail("unknown-managed-body", "$source");
      if (error.reason === "relation" || error.reason === "envelope") {
        fail("envelope", "$source");
      }
      fail("input", error.path);
    }
    throw error;
  }
  if (transition.target !== null && transition.target.byteCount > request.maximumBytes) {
    fail("target-capacity", "$target");
  }
  await revalidateSource(root, request, read);
  return Object.freeze({
    status: transition.disposition === "current" ? "managed-current" : "recompose-required",
    resourcePath: request.resourcePath,
    source: read?.facts ?? null,
    transition,
  });
}

/** 稳定检查根目录里一个文件的托管块，生成零写入的 current 或重组候选。 */
export async function inspectWakeflowManagedBlockFile(
  rootValue: RootedDirectory,
  requestValue: WakeflowManagedBlockFileRequest,
): Promise<Readonly<WakeflowManagedBlockFileInspection>> {
  assertRoot(rootValue);
  const request = parseRequest(requestValue);
  return inspectParsed(rootValue, request, currentUserId());
}

function mapAtomicError(error: DurableAtomicFileWriteError): never {
  if (error.reason === "input") fail("input", error.path);
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (error.reason === "capacity") fail("target-capacity", "$target");
  if (
    error.reason === "target-exists" ||
    error.reason === "expectation-changed" ||
    error.reason === "expectation-read-failure"
  ) {
    fail("conflict", "$source");
  }
  if (error.reason === "root-scope" || error.reason === "parent-changed") {
    fail("root-scope", "$root");
  }
  if (error.reason === "stage-recovery-required") {
    fail("recovery-required", "$resourcePath");
  }
  if (
    error.reason === "commit-uncertain" ||
    error.reason === "durability-failure" ||
    error.reason === "stage-cleanup-failure" ||
    error.reason === "close-failure"
  ) {
    fail("commit-uncertain", "$resourcePath");
  }
  fail("effect-failure", "$resourcePath");
}

async function publishTarget(
  root: RootedDirectory,
  request: Readonly<ParsedRequest>,
  inspection: Readonly<WakeflowManagedBlockFileInspection>,
  createMode: number,
): Promise<Readonly<WakeflowManagedBlockFileEffect>> {
  const target = inspection.transition.target;
  if (inspection.status !== "recompose-required" || target === null) {
    fail("source", "$target");
  }
  try {
    if (inspection.source === null) {
      return await createFileAtomically(root, request.resourcePath, target.bytes, {
        mode: createMode,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      });
    }
    return await replaceFileAtomically(root, request.resourcePath, target.bytes, {
      mode: inspection.source.node.permissionBits,
      expected: inspection.source,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
  } catch (error: unknown) {
    if (error instanceof DurableAtomicFileWriteError) mapAtomicError(error);
    fail("effect-failure", "$resourcePath");
  }
}

function sameSource(left: Readonly<StableFileSource>, right: Readonly<StableFileSource>): boolean {
  return (
    left.resourcePath === right.resourcePath &&
    left.byteCount === right.byteCount &&
    left.digest === right.digest &&
    sameFileNodeSnapshot(left.node, right.node)
  );
}

function assertReadback(
  request: Readonly<ParsedRequest>,
  before: Readonly<WakeflowManagedBlockFileInspection>,
  effect: Readonly<WakeflowManagedBlockFileEffect>,
  after: Readonly<WakeflowManagedBlockFileInspection>,
  expectedUserId: bigint,
  createMode: number,
): void {
  const target = before.transition.target;
  const source = after.source;
  const expectedMode = before.source === null ? createMode : before.source.node.permissionBits;
  if (
    target === null ||
    source === null ||
    after.status !== "managed-current" ||
    after.transition.sourceAuthority !== "desired" ||
    after.transition.target !== null ||
    effect.resourcePath !== request.resourcePath ||
    effect.digest !== target.digest ||
    effect.byteCount !== target.byteCount ||
    effect.node.kind !== "file" ||
    effect.node.permissionBits !== expectedMode ||
    effect.node.linkCount !== 1n ||
    effect.node.userId !== expectedUserId ||
    source.resourcePath !== effect.resourcePath ||
    source.digest !== effect.digest ||
    source.byteCount !== effect.byteCount ||
    !sameFileNodeSnapshot(source.node, effect.node)
  ) {
    fail("commit-uncertain", "$resourcePath");
  }
  if (effect.publication === "created") {
    if (before.source !== null) fail("commit-uncertain", "$resourcePath");
  } else if (before.source === null || !sameSource(effect.previous, before.source)) {
    fail("commit-uncertain", "$resourcePath");
  }
}

function parseOptions(value: unknown): number {
  if (
    typeof value !== "object" ||
    value === null ||
    types.isProxy(value) ||
    Object.keys(value).some((key) => key !== "createMode")
  ) {
    fail("input", "$options");
  }
  const createMode = (value as { readonly createMode?: unknown }).createMode;
  if (
    typeof createMode !== "number" ||
    !Number.isInteger(createMode) ||
    createMode < 0 ||
    createMode > 0o777
  ) {
    fail("input", "$options.createMode");
  }
  return createMode;
}

/** 在调用方持有的事务内幂等创建或 CAS 替换一个文件里的 Wakeflow 托管块。 */
export async function recomposeWakeflowManagedBlockFile(
  rootValue: RootedDirectory,
  requestValue: WakeflowManagedBlockFileRequest,
  optionsValue: WakeflowManagedBlockFileRecompositionOptions,
): Promise<Readonly<WakeflowManagedBlockFileReceipt>> {
  assertRoot(rootValue);
  const createMode = parseOptions(optionsValue);
  const request = parseRequest(requestValue);
  assertNotAborted(request.signal);
  const expectedUserId = currentUserId();
  await assertCurrentUserRoot(rootValue, expectedUserId);
  const before = await inspectParsed(rootValue, request, expectedUserId);
  if (before.status !== "recompose-required") {
    return Object.freeze({ disposition: "current", effect: null, inspection: before });
  }
  await assertCurrentUserRoot(rootValue, expectedUserId);
  assertNotAborted(request.signal);
  const effect = await publishTarget(rootValue, request, before, createMode);
  let after: Readonly<WakeflowManagedBlockFileInspection>;
  try {
    after = await inspectParsed(
      rootValue,
      Object.freeze({ ...request, signal: undefined }),
      expectedUserId,
    );
  } catch {
    fail("commit-uncertain", "$resourcePath");
  }
  assertReadback(request, before, effect, after, expectedUserId, createMode);
  return Object.freeze({
    disposition: effect.publication,
    effect,
    inspection: after,
  });
}

// ---- 删除托管块（ADR-0024 的 remove-managed-block）---------------------------------------------

export interface WakeflowManagedBlockRemovalRequest {
  readonly resourcePath: unknown;
  /** 可删的已知渲染：当前渲染与已登记的历史渲染，同 component、同 owner、正文互不相同。 */
  readonly admittedTargets: readonly unknown[];
  readonly maximumBytes?: ByteCount;
  readonly signal?: AbortSignal;
}

export interface WakeflowManagedBlockRemovalTarget {
  readonly bytes: Uint8Array;
  readonly byteCount: ByteCount;
  readonly digest: Sha256Digest;
  /** 删掉块之后文件为空（或只剩空白）即删文件，否则保留其余内容。 */
  readonly deletesFile: boolean;
}

export interface WakeflowManagedBlockRemovalInspection {
  /** absent：文件不在或没有我们的块；removal-required：块在且正文是已知渲染。 */
  readonly status: "absent" | "removal-required";
  readonly resourcePath: PortableResourcePath;
  readonly identity: Readonly<WakeflowManagedTextEnvelopeIdentity>;
  readonly source: Readonly<StableFileSource> | null;
  readonly target: Readonly<WakeflowManagedBlockRemovalTarget> | null;
}

export interface WakeflowManagedBlockRemovalReceipt {
  readonly disposition: "current" | "replaced" | "deleted";
  readonly inspection: Readonly<WakeflowManagedBlockRemovalInspection>;
}

interface ParsedRemovalRequest extends SourceReadRequest {
  readonly identity: Readonly<WakeflowManagedTextEnvelopeIdentity>;
  readonly admittedBodies: readonly string[];
}

const MAXIMUM_ADMITTED_TARGETS = 8;

function parseRemovalRequest(
  value: WakeflowManagedBlockRemovalRequest,
): Readonly<ParsedRemovalRequest> {
  if (typeof value !== "object" || value === null || types.isProxy(value)) {
    fail("input", "$request");
  }
  let resourcePath: PortableResourcePath;
  try {
    resourcePath = parsePortableResourcePath(value.resourcePath, "$request.resourcePath");
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) fail("input", "$request.resourcePath");
    throw error;
  }
  if (value.signal !== undefined && !isAbortSignal(value.signal)) {
    fail("input", "$request.signal");
  }
  if (
    !Array.isArray(value.admittedTargets) ||
    value.admittedTargets.length === 0 ||
    value.admittedTargets.length > MAXIMUM_ADMITTED_TARGETS
  ) {
    fail("input", "$request.admittedTargets");
  }
  const targets = value.admittedTargets.map((target, index) => {
    try {
      return parseWakeflowManagedTextEnvelopeTarget(target);
    } catch (error: unknown) {
      if (error instanceof WakeflowManagedTextEnvelopeError) {
        fail("input", `$request.admittedTargets/${index}`);
      }
      throw error;
    }
  });
  const first = targets[0];
  if (first === undefined) fail("input", "$request.admittedTargets");
  const admittedBodies: string[] = [];
  for (const [index, target] of targets.entries()) {
    if (
      target.component !== first.component ||
      target.owner !== first.owner ||
      admittedBodies.includes(target.body)
    ) {
      fail("input", `$request.admittedTargets/${index}`);
    }
    admittedBodies.push(target.body);
  }
  let maximumBytes = DEFAULT_MAXIMUM_BYTES;
  if (value.maximumBytes !== undefined) {
    try {
      maximumBytes = parseByteCount(value.maximumBytes, "$request.maximumBytes");
    } catch (error: unknown) {
      if (error instanceof ByteCountError) fail("input", "$request.maximumBytes");
      throw error;
    }
  }
  return Object.freeze({
    resourcePath,
    identity: Object.freeze({ component: first.component, owner: first.owner }),
    admittedBodies: Object.freeze(admittedBodies),
    maximumBytes,
    signal: value.signal,
  });
}

/** 删掉块之后只剩空格、制表与换行的文件视为空：没有用户内容可保留。 */
function blankBytes(bytes: Uint8Array): boolean {
  return bytes.every((byte) => byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d);
}

async function inspectRemovalParsed(
  root: RootedDirectory,
  request: Readonly<ParsedRemovalRequest>,
  expectedUserId: bigint,
): Promise<Readonly<WakeflowManagedBlockRemovalInspection>> {
  assertNotAborted(request.signal);
  const read = await readSource(root, request, expectedUserId);
  const absent = (source: Readonly<StableFileSource> | null) =>
    Object.freeze({
      status: "absent" as const,
      resourcePath: request.resourcePath,
      identity: request.identity,
      source,
      target: null,
    });
  if (read === null) return absent(null);
  let envelope: ReturnType<typeof inspectWakeflowManagedTextEnvelope>;
  try {
    envelope = inspectWakeflowManagedTextEnvelope(read.bytes);
  } catch (error: unknown) {
    if (error instanceof WakeflowManagedTextEnvelopeError) fail("envelope", "$source");
    throw error;
  }
  if (envelope.kind !== "managed") {
    await revalidateSource(root, request, read);
    return absent(read.facts);
  }
  if (
    envelope.component !== request.identity.component ||
    envelope.owner !== request.identity.owner
  ) {
    fail("envelope", "$source");
  }
  // 只有正文可证明是 Wakeflow 写的（当前渲染或已登记的历史渲染）才删；另一个工作区的块同样未知。
  if (!request.admittedBodies.includes(envelope.body)) fail("unknown-managed-body", "$source");
  let removal: Readonly<WakeflowManagedTextRemovalResult>;
  try {
    removal = removeWakeflowManagedTextEnvelope(read.bytes, request.identity);
  } catch (error: unknown) {
    if (error instanceof WakeflowManagedTextEnvelopeError) fail("envelope", "$source");
    throw error;
  }
  await revalidateSource(root, request, read);
  return Object.freeze({
    status: "removal-required",
    resourcePath: request.resourcePath,
    identity: request.identity,
    source: read.facts,
    target: Object.freeze({
      bytes: removal.bytes,
      byteCount: removal.byteCount,
      digest: removal.digest,
      deletesFile: blankBytes(removal.bytes),
    }),
  });
}

/** 零写入检查一个文件里能否删掉 Wakeflow 托管块：不在或没有块即 absent，正文未知即 unknown-managed-body。 */
export async function inspectWakeflowManagedBlockRemoval(
  rootValue: RootedDirectory,
  requestValue: WakeflowManagedBlockRemovalRequest,
): Promise<Readonly<WakeflowManagedBlockRemovalInspection>> {
  assertRoot(rootValue);
  const request = parseRemovalRequest(requestValue);
  return inspectRemovalParsed(rootValue, request, currentUserId());
}

function mapUnlinkError(error: ExactRegularFileUnlinkError): never {
  if (error.reason === "input") fail("input", error.path);
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (error.reason === "root-scope" || error.reason === "parent-changed") {
    fail("root-scope", "$root");
  }
  if (error.reason === "source-changed" || error.reason === "source-not-found") {
    fail("conflict", "$source");
  }
  if (
    error.reason === "commit-uncertain" ||
    error.reason === "durability-failure" ||
    error.reason === "close-failure"
  ) {
    fail("commit-uncertain", "$resourcePath");
  }
  fail("effect-failure", "$resourcePath");
}

async function publishRemoval(
  root: RootedDirectory,
  request: Readonly<ParsedRemovalRequest>,
  inspection: Readonly<WakeflowManagedBlockRemovalInspection>,
): Promise<void> {
  const target = inspection.target;
  const source = inspection.source;
  if (inspection.status !== "removal-required" || target === null || source === null) {
    fail("source", "$target");
  }
  const signal = request.signal === undefined ? {} : { signal: request.signal };
  if (target.deletesFile) {
    try {
      await unlinkRegularFileExactly(root, request.resourcePath, {
        expectedNode: source.node,
        ...signal,
      });
    } catch (error: unknown) {
      if (error instanceof ExactRegularFileUnlinkError) mapUnlinkError(error);
      fail("effect-failure", "$resourcePath");
    }
    return;
  }
  try {
    await replaceFileAtomically(root, request.resourcePath, target.bytes, {
      mode: source.node.permissionBits,
      expected: source,
      ...signal,
    });
  } catch (error: unknown) {
    if (error instanceof DurableAtomicFileWriteError) mapAtomicError(error);
    fail("effect-failure", "$resourcePath");
  }
}

/**
 * 在调用方持有的事务内幂等删除一个文件里的 Wakeflow 托管块：块已不在即 current；删掉块后文件
 * 为空则精确删文件，否则 CAS 替换并保留所有者权限位；提交后读回闭合。
 */
export async function removeWakeflowManagedBlockFile(
  rootValue: RootedDirectory,
  requestValue: WakeflowManagedBlockRemovalRequest,
): Promise<Readonly<WakeflowManagedBlockRemovalReceipt>> {
  assertRoot(rootValue);
  const request = parseRemovalRequest(requestValue);
  assertNotAborted(request.signal);
  const expectedUserId = currentUserId();
  await assertCurrentUserRoot(rootValue, expectedUserId);
  const before = await inspectRemovalParsed(rootValue, request, expectedUserId);
  if (before.status !== "removal-required" || before.target === null) {
    return Object.freeze({ disposition: "current", inspection: before });
  }
  await assertCurrentUserRoot(rootValue, expectedUserId);
  assertNotAborted(request.signal);
  await publishRemoval(rootValue, request, before);
  let after: Readonly<WakeflowManagedBlockRemovalInspection>;
  try {
    after = await inspectRemovalParsed(
      rootValue,
      Object.freeze({ ...request, signal: undefined }),
      expectedUserId,
    );
  } catch {
    fail("commit-uncertain", "$resourcePath");
  }
  const deleted = before.target.deletesFile;
  if (
    after.status !== "absent" ||
    (deleted
      ? after.source !== null
      : after.source === null ||
        after.source.digest !== before.target.digest ||
        after.source.byteCount !== before.target.byteCount)
  ) {
    fail("commit-uncertain", "$resourcePath");
  }
  return Object.freeze({ disposition: deleted ? "deleted" : "replaced", inspection: after });
}
