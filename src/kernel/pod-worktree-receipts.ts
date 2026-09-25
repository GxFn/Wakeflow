import { readFile, realpath, rm, stat } from "node:fs/promises";
import path from "node:path";

import {
  parseWakeflowDurableIdOfKind,
  type WakeflowDurableId,
  WakeflowDurableIdError,
} from "../contracts/identity/wakeflow-durable-id.js";
import {
  WAKEFLOW_HOST_IDS,
  type WakeflowHostId,
} from "../contracts/vocabulary/wakeflow-host-id.js";
import { computeCanonicalJsonSha256Digest } from "../foundation/crypto/canonical-json-sha256.js";
import { parseSha256Digest, type Sha256Digest, Sha256Error } from "../foundation/crypto/sha256.js";
import {
  DeterministicJsonDocumentError,
  parseDeterministicJsonDocument,
  renderDeterministicJsonDocument,
} from "../foundation/data/deterministic-json-document.js";
import { type JsonObject, type JsonValue, parseJsonValue } from "../foundation/data/json-value.js";
import { readDeterministicJsonFile } from "../foundation/filesystem/deterministic-json-file.js";
import {
  createFileAtomically,
  DurableAtomicFileWriteError,
  replaceFileAtomically,
} from "../foundation/filesystem/durable-atomic-file-write.js";
import {
  DurableDirectoryMaterializationError,
  materializeDirectoryPath,
} from "../foundation/filesystem/durable-directory-materialization.js";
import {
  ExactRegularFileUnlinkError,
  unlinkRegularFileExactly,
} from "../foundation/filesystem/exact-regular-file-unlink.js";
import {
  type PortableResourcePath,
  parsePortableResourcePath,
} from "../foundation/filesystem/portable-resource-path.js";
import {
  type RootedDirectory,
  RootedDirectoryError,
} from "../foundation/filesystem/rooted-directory.js";
import {
  readStableResourceDirectory,
  StableDirectoryReadError,
} from "../foundation/filesystem/stable-directory-read.js";
import { StableFileReadError } from "../foundation/filesystem/stable-file-read.js";
import { StrictTextFileError } from "../foundation/filesystem/strict-text-file.js";
import { parseByteCount } from "../foundation/numeric/byte-count.js";
import { encodeUtf8 } from "../foundation/text/utf8.js";
import {
  parseUtcInstant,
  type UtcInstant,
  UtcInstantError,
} from "../foundation/time/utc-instant.js";
import { fail } from "./error.js";
import {
  hostPodReceiptsRootRef,
  parseWakeflowHostId,
  podReceiptRootRef,
  podWorktreeReceiptRef,
} from "./layout.js";

/**
 * Wakeflow Kernel / Pod Worktree Receipts：worktree pod 产品窗口的执行位置回执（ADR-0010 D4）。
 *
 * Agent 在会话 cwd 里运行 `git worktree list --porcelain` 与 `git rev-parse --git-common-dir`
 * 并交回原文；这里解析 porcelain，取 path 等于该会话 `session-start` cwd 的那一条，然后用
 * 文件系统事实核对：common dir 是配置仓库根下的 `.git`，检出不是主检出，`<path>/.git` 是
 * 指向 `<common>/worktrees/<name>` 的指针文件，admin 目录的 `gitdir` 指回检出，`HEAD` 与
 * 回执的分支或提交一致。Wakeflow 不 spawn git。回执是私有权威：目录 0700、文件 0600，
 * 绝对路径只在回执文件里出现，公共结果只回 head、branch 与 detached。
 */

export interface GitWorktreePorcelainEntry {
  /** 宿主报告的检出路径，未做 realpath。 */
  readonly path: string;
  readonly head: string | null;
  /** 去掉 `refs/heads/` 前缀的分支名；detached 或 bare 为 null。 */
  readonly branch: string | null;
  readonly detached: boolean;
  readonly bare: boolean;
  readonly locked: boolean;
  readonly prunable: boolean;
}

export interface PodWorktreeObservation {
  readonly porcelain: string;
  readonly commonDir: string;
}

export interface AdmittedPodWorktree {
  /** 检出目录的 realpath。 */
  readonly path: string;
  readonly head: string;
  readonly branch: string | null;
  readonly locked: boolean;
}

export interface PodWorktreeReceipt {
  readonly kind: "WakeflowPodWorktreeReceipt";
  readonly schemaVersion: 1;
  readonly hostId: WakeflowHostId;
  readonly podId: WakeflowDurableId<"pod">;
  readonly windowId: WakeflowDurableId<"window">;
  readonly repositoryId: WakeflowDurableId<"repository">;
  readonly bindingId: string;
  readonly path: string;
  readonly head: string;
  readonly branch: string | null;
  readonly locked: boolean;
  readonly observedAt: UtcInstant;
  readonly receiptDigest: Sha256Digest;
}

export interface PodWorktreeReceiptDraft {
  readonly hostId: WakeflowHostId;
  readonly podId: string;
  readonly windowId: string;
  readonly repositoryId: string;
  readonly bindingId: string;
  readonly worktree: Readonly<AdmittedPodWorktree>;
  readonly observedAt: UtcInstant;
}

interface Signal {
  readonly signal?: AbortSignal;
}

const RECEIPT_KIND = "WakeflowPodWorktreeReceipt" as const;
const RECEIPT_SCHEMA_VERSION = 1 as const;
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const RECEIPT_MAXIMUM_BYTES = parseByteCount(16 * 1024, "$receipt.maximumBytes");
const PORCELAIN_MAXIMUM_CHARACTERS = 64 * 1024;
const PORCELAIN_MAXIMUM_ENTRIES = 256;
const POINTER_FILE_MAXIMUM_BYTES = 16 * 1024;
const DIRECTORY_MAXIMUM_ENTRIES = 512;
const GIT_OBJECT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/u;
const BINDING_ID_PATTERN =
  /^window_binding_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RECEIPT_FIELDS = Object.freeze([
  "bindingId",
  "branch",
  "head",
  "hostId",
  "kind",
  "locked",
  "observedAt",
  "path",
  "podId",
  "receiptDigest",
  "repositoryId",
  "schemaVersion",
  "windowId",
]);

function signalOptions(signal: AbortSignal | undefined): Signal {
  return signal === undefined ? {} : { signal };
}

// ---- porcelain ----------------------------------------------------------------

interface MutablePorcelainEntry {
  path: string;
  head: string | null;
  branch: string | null;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
}

/** `key` 为 `line`（1 起的行号）或 `entry`（0 起的条目序号）。 */
function porcelainFail(reason: string, value: number, key: "line" | "entry" = "line"): never {
  fail("invalid-request", "worktree-porcelain", "$request.observation.worktree.porcelain", {
    details: { check: reason, [key]: String(value) },
  });
}

function applyPorcelainLine(entry: MutablePorcelainEntry, line: string, index: number): void {
  if (line.startsWith("HEAD ")) {
    const head = line.slice("HEAD ".length);
    if (!GIT_OBJECT_PATTERN.test(head)) porcelainFail("head", index);
    entry.head = head;
    return;
  }
  if (line.startsWith("branch ")) {
    const ref = line.slice("branch ".length);
    if (!ref.startsWith("refs/heads/")) porcelainFail("branch", index);
    const branch = ref.slice("refs/heads/".length);
    if (!BRANCH_PATTERN.test(branch)) porcelainFail("branch", index);
    entry.branch = branch;
    return;
  }
  if (line === "detached") {
    entry.detached = true;
    return;
  }
  if (line === "bare") {
    entry.bare = true;
    return;
  }
  if (line === "locked" || line.startsWith("locked ")) {
    entry.locked = true;
    return;
  }
  if (line === "prunable" || line.startsWith("prunable ")) {
    entry.prunable = true;
    return;
  }
  porcelainFail("unknown-line", index);
}

function startPorcelainEntry(
  entries: MutablePorcelainEntry[],
  line: string,
  index: number,
): MutablePorcelainEntry {
  const worktreePath = line.slice("worktree ".length);
  if (!path.isAbsolute(worktreePath)) porcelainFail("path", index);
  if (entries.length >= PORCELAIN_MAXIMUM_ENTRIES) porcelainFail("entries", index);
  const entry: MutablePorcelainEntry = {
    path: worktreePath,
    head: null,
    branch: null,
    detached: false,
    bare: false,
    locked: false,
    prunable: false,
  };
  entries.push(entry);
  return entry;
}

function assertPorcelainEntries(entries: readonly MutablePorcelainEntry[]): void {
  for (const [index, entry] of entries.entries()) {
    if (entry.branch !== null && entry.detached)
      porcelainFail("branch-and-detached", index, "entry");
    if (!entry.bare && entry.head === null) porcelainFail("head-missing", index, "entry");
  }
}

/** 解析 `git worktree list --porcelain` 的原文；未知行、非绝对路径或超量条目即拒绝。 */
export function parseGitWorktreePorcelain(
  text: string,
): readonly Readonly<GitWorktreePorcelainEntry>[] {
  if (text.length > PORCELAIN_MAXIMUM_CHARACTERS) porcelainFail("size", 0);
  const entries: MutablePorcelainEntry[] = [];
  let current: MutablePorcelainEntry | null = null;
  for (const [index, raw] of text.split(/\r?\n/u).entries()) {
    const line = raw.trimEnd();
    if (line.length === 0) {
      current = null;
    } else if (line.startsWith("worktree ")) {
      current = startPorcelainEntry(entries, line, index + 1);
    } else if (current === null) {
      porcelainFail("orphan-line", index + 1);
    } else {
      applyPorcelainLine(current, line, index + 1);
    }
  }
  assertPorcelainEntries(entries);
  return Object.freeze(entries.map((entry) => Object.freeze({ ...entry })));
}

// ---- admission against the filesystem -------------------------------------------

export interface AdmitPodWorktreeInput {
  readonly observation: Readonly<PodWorktreeObservation>;
  /** 该会话 `session-start` 记录的 cwd；回执必须描述这一个检出。 */
  readonly sessionCwd: string;
  /** 配置仓库根的绝对路径（主检出）。 */
  readonly repositoryRoot: string;
}

function receiptFail(check: string): never {
  fail("precondition-failed", "worktree-receipt", "$request.observation.worktree", {
    details: { check },
  });
}

async function realpathOrNull(candidate: string): Promise<string | null> {
  try {
    return await realpath(candidate);
  } catch {
    return null;
  }
}

async function readPointerFile(candidate: string): Promise<string | null> {
  try {
    const node = await stat(candidate);
    if (!node.isFile() || node.size > POINTER_FILE_MAXIMUM_BYTES) return null;
    return (await readFile(candidate, "utf8")).trim();
  } catch {
    return null;
  }
}

/** 从 `git rev-parse --git-common-dir` 的原文得到 common dir 的 realpath；相对值按会话 cwd 解析。 */
async function resolveCommonDir(commonDir: string, sessionReal: string): Promise<string> {
  const trimmed = commonDir.trim();
  if (trimmed.length === 0 || trimmed.includes("\n")) receiptFail("common-dir");
  const resolved = await realpathOrNull(path.resolve(sessionReal, trimmed));
  if (resolved === null) receiptFail("common-dir");
  return resolved;
}

/** 候选检出的 realpath 等于会话 cwd 的那一条；主检出、bare 与 prunable 都不是执行位置。 */
async function selectSessionEntry(
  entries: readonly Readonly<GitWorktreePorcelainEntry>[],
  sessionReal: string,
  repositoryReal: string,
): Promise<Readonly<GitWorktreePorcelainEntry>> {
  for (const entry of entries) {
    if (entry.bare || entry.prunable) continue;
    const entryReal = await realpathOrNull(entry.path);
    if (entryReal !== sessionReal) continue;
    if (entryReal === repositoryReal) receiptFail("main-checkout");
    if (entry.head === null) receiptFail("head");
    return entry;
  }
  receiptFail("session-worktree");
}

/** `<path>/.git` 指针、admin 目录回指针与 HEAD 三处必须与回执互相印证。 */
async function verifyLinkedWorktree(
  checkoutReal: string,
  commonReal: string,
  entry: Readonly<GitWorktreePorcelainEntry>,
): Promise<void> {
  const pointer = await readPointerFile(path.join(checkoutReal, ".git"));
  if (pointer === null || !pointer.startsWith("gitdir: ")) receiptFail("gitdir-pointer");
  const adminReal = await realpathOrNull(
    path.resolve(checkoutReal, pointer.slice("gitdir: ".length)),
  );
  const worktreesRoot = path.join(commonReal, "worktrees");
  if (
    adminReal === null ||
    path.dirname(adminReal) !== worktreesRoot ||
    !adminReal.startsWith(`${worktreesRoot}${path.sep}`)
  ) {
    receiptFail("gitdir-pointer");
  }
  const back = await readPointerFile(path.join(adminReal, "gitdir"));
  if (back === null) receiptFail("gitdir-backpointer");
  const backReal = await realpathOrNull(path.resolve(adminReal, back));
  if (backReal !== path.join(checkoutReal, ".git")) receiptFail("gitdir-backpointer");
  const head = await readPointerFile(path.join(adminReal, "HEAD"));
  if (head === null) receiptFail("head-mismatch");
  if (entry.branch !== null) {
    if (head !== `ref: refs/heads/${entry.branch}`) receiptFail("head-mismatch");
  } else if (head !== entry.head) {
    receiptFail("head-mismatch");
  }
}

/** 准入一份 worktree 观察；成功返回 realpath、HEAD、分支与锁定状态。 */
export async function admitPodWorktreeObservation(
  input: Readonly<AdmitPodWorktreeInput>,
): Promise<Readonly<AdmittedPodWorktree>> {
  const entries = parseGitWorktreePorcelain(input.observation.porcelain);
  const repositoryReal = await realpathOrNull(input.repositoryRoot);
  if (repositoryReal === null) receiptFail("repository-root");
  const sessionReal = await realpathOrNull(input.sessionCwd);
  if (sessionReal === null) receiptFail("session-cwd");
  const commonReal = await resolveCommonDir(input.observation.commonDir, sessionReal);
  const expectedCommon = await realpathOrNull(path.join(repositoryReal, ".git"));
  if (expectedCommon === null || commonReal !== expectedCommon) receiptFail("common-dir");
  const entry = await selectSessionEntry(entries, sessionReal, repositoryReal);
  await verifyLinkedWorktree(sessionReal, commonReal, entry);
  return Object.freeze({
    path: sessionReal,
    head: entry.head as string,
    branch: entry.branch,
    locked: entry.locked,
  });
}

/** porcelain 里除主检出外的检出 realpath 集合：登记前用它匹配 `session-start` 的 cwd。 */
export async function candidateWorktreePaths(
  porcelain: string,
  repositoryRoot: string,
): Promise<ReadonlySet<string>> {
  const repositoryReal = await realpathOrNull(repositoryRoot);
  const paths = new Set<string>();
  for (const entry of parseGitWorktreePorcelain(porcelain)) {
    if (entry.bare || entry.prunable) continue;
    const entryReal = await realpathOrNull(entry.path);
    if (entryReal !== null && entryReal !== repositoryReal) paths.add(entryReal);
  }
  return paths;
}

// ---- receipt record -----------------------------------------------------------------

function parseId<Kind extends "pod" | "window" | "repository">(
  value: unknown,
  kind: Kind,
  path: string,
): WakeflowDurableId<Kind> {
  try {
    return parseWakeflowDurableIdOfKind(value, kind, path);
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) {
      fail("invalid-request", "receipt-identity", path, { cause: error });
    }
    throw error;
  }
}

/** 目录项名是否为该种类的持久标识；杂散项（`notes.json`、`pod_old`）跳过而不是抛出。 */
function isDurableIdOfKind(value: string, kind: "pod" | "repository"): boolean {
  try {
    parseWakeflowDurableIdOfKind(value, kind, "$receipt");
    return true;
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) return false;
    throw error;
  }
}

function receiptBasis(
  draft: Readonly<PodWorktreeReceiptDraft>,
): Omit<PodWorktreeReceipt, "receiptDigest"> {
  if (!BINDING_ID_PATTERN.test(draft.bindingId)) {
    fail("invalid-request", "receipt-binding", "$receipt/bindingId");
  }
  if (!path.isAbsolute(draft.worktree.path))
    fail("invalid-request", "receipt-path", "$receipt/path");
  if (!GIT_OBJECT_PATTERN.test(draft.worktree.head)) {
    fail("invalid-request", "receipt-head", "$receipt/head");
  }
  if (draft.worktree.branch !== null && !BRANCH_PATTERN.test(draft.worktree.branch)) {
    fail("invalid-request", "receipt-branch", "$receipt/branch");
  }
  return Object.freeze({
    kind: RECEIPT_KIND,
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    hostId: parseWakeflowHostId(draft.hostId, "$receipt/hostId"),
    podId: parseId(draft.podId, "pod", "$receipt/podId"),
    windowId: parseId(draft.windowId, "window", "$receipt/windowId"),
    repositoryId: parseId(draft.repositoryId, "repository", "$receipt/repositoryId"),
    bindingId: draft.bindingId,
    path: draft.worktree.path,
    head: draft.worktree.head,
    branch: draft.worktree.branch,
    locked: draft.worktree.locked,
    observedAt: draft.observedAt,
  });
}

function exactRecord(value: JsonValue, path: string): Readonly<Record<string, JsonValue>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid-request", "receipt-shape", path);
  }
  const record = value as JsonObject;
  const keys = Object.keys(record).sort();
  if (
    keys.length !== RECEIPT_FIELDS.length ||
    keys.some((key, index) => key !== RECEIPT_FIELDS[index])
  ) {
    fail("invalid-request", "receipt-shape", path);
  }
  return record as Readonly<Record<string, JsonValue>>;
}

function text(value: JsonValue | undefined, path: string): string {
  if (typeof value !== "string") fail("invalid-request", "receipt-shape", path);
  return value;
}

/** 严格解析一份回执；摘要必须等于其规范 JSON 摘要。 */
function parsePodWorktreeReceipt(value: unknown, path = "$receipt"): Readonly<PodWorktreeReceipt> {
  const record = exactRecord(parseJsonValue(value, path), path);
  if (record.kind !== RECEIPT_KIND || record.schemaVersion !== RECEIPT_SCHEMA_VERSION) {
    fail("invalid-request", "receipt-kind", `${path}/kind`);
  }
  if (typeof record.locked !== "boolean")
    fail("invalid-request", "receipt-shape", `${path}/locked`);
  if (record.branch !== null && typeof record.branch !== "string") {
    fail("invalid-request", "receipt-shape", `${path}/branch`);
  }
  let observedAt: UtcInstant;
  try {
    observedAt = parseUtcInstant(record.observedAt, `${path}/observedAt`);
  } catch (error: unknown) {
    if (error instanceof UtcInstantError) {
      fail("invalid-request", "receipt-time", `${path}/observedAt`);
    }
    throw error;
  }
  let receiptDigest: Sha256Digest;
  try {
    receiptDigest = parseSha256Digest(record.receiptDigest, `${path}/receiptDigest`);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) {
      fail("invalid-request", "receipt-digest", `${path}/receiptDigest`);
    }
    throw error;
  }
  const basis = receiptBasis({
    hostId: text(record.hostId, `${path}/hostId`) as WakeflowHostId,
    podId: text(record.podId, `${path}/podId`),
    windowId: text(record.windowId, `${path}/windowId`),
    repositoryId: text(record.repositoryId, `${path}/repositoryId`),
    bindingId: text(record.bindingId, `${path}/bindingId`),
    worktree: {
      path: text(record.path, `${path}/path`),
      head: text(record.head, `${path}/head`),
      branch: record.branch as string | null,
      locked: record.locked,
    },
    observedAt,
  });
  if (computeCanonicalJsonSha256Digest(basis as unknown as JsonObject) !== receiptDigest) {
    fail("invalid-request", "receipt-digest", `${path}/receiptDigest`);
  }
  return Object.freeze({ ...basis, receiptDigest });
}

/** 从草稿创建回执并封摘要。 */
export function createPodWorktreeReceipt(
  draft: Readonly<PodWorktreeReceiptDraft>,
): Readonly<PodWorktreeReceipt> {
  const basis = receiptBasis(draft);
  return parsePodWorktreeReceipt({
    ...basis,
    receiptDigest: computeCanonicalJsonSha256Digest(basis as unknown as JsonObject),
  });
}

function renderPodWorktreeReceipt(receipt: Readonly<PodWorktreeReceipt>): string {
  return renderDeterministicJsonDocument(
    parseJsonValue(parsePodWorktreeReceipt(receipt), "$receipt"),
    "$receipt",
  );
}

// ---- store ------------------------------------------------------------------------------

function mapWriteError(error: unknown, what: string): never {
  if (
    error instanceof DurableAtomicFileWriteError ||
    error instanceof DurableDirectoryMaterializationError
  ) {
    fail("io-failure", `${what}-${error.reason}`, "$receipt", { cause: error });
  }
  throw error;
}

/** 写入或换代一份回执：同仓库的旧回执被整文件替换。 */
export async function writePodWorktreeReceipt(
  root: RootedDirectory,
  receiptValue: unknown,
  options: Signal = {},
): Promise<void> {
  const receipt = parsePodWorktreeReceipt(receiptValue);
  const signal = signalOptions(options.signal);
  const ref = podWorktreeReceiptRef(receipt.hostId, receipt.podId, receipt.repositoryId);
  const directory = parsePortableResourcePath(
    `${podReceiptRootRef(receipt.hostId, receipt.podId)}/worktrees`,
    "$receipt",
  );
  const bytes = encodeUtf8(renderPodWorktreeReceipt(receipt), "$receipt");
  try {
    await materializeDirectoryPath(root, directory, { mode: DIRECTORY_MODE, ...signal });
    const existing = await readReceiptSource(root, ref, signal);
    if (existing === null) {
      await createFileAtomically(root, ref, bytes, { mode: FILE_MODE, ...signal });
    } else {
      await replaceFileAtomically(root, ref, bytes, {
        mode: FILE_MODE,
        expected: {
          resourcePath: existing.resourcePath,
          node: existing.node,
          byteCount: existing.byteCount,
          digest: existing.digest,
        },
        ...signal,
      });
    }
  } catch (error: unknown) {
    mapWriteError(error, "receipt-write");
  }
}

async function readReceiptSource(root: RootedDirectory, ref: PortableResourcePath, signal: Signal) {
  try {
    const read = await readDeterministicJsonFile(root, ref, {
      maximumBytes: RECEIPT_MAXIMUM_BYTES,
      ...signal,
    });
    return Object.freeze({
      resourcePath: read.resourcePath,
      node: read.node,
      byteCount: read.byteCount,
      digest: read.digest,
      text: read.text,
    });
  } catch (error: unknown) {
    if (error instanceof StableFileReadError && error.reason === "not-found") return null;
    if (error instanceof RootedDirectoryError && error.reason === "resource-not-found") return null;
    if (error instanceof StableFileReadError && error.reason === "aborted") {
      fail("io-failure", "aborted", "$signal", { cause: error });
    }
    if (
      error instanceof StableFileReadError ||
      error instanceof DeterministicJsonDocumentError ||
      error instanceof StrictTextFileError
    ) {
      fail("io-failure", "receipt-read", "$receipt", { cause: error });
    }
    if (error instanceof RootedDirectoryError) {
      fail("io-failure", "receipt-read", "$receipt", { cause: error });
    }
    throw error;
  }
}

/** 读一份回执；不存在返回 null，损坏即 `io-failure`。 */
export async function readPodWorktreeReceipt(
  root: RootedDirectory,
  hostId: WakeflowHostId,
  podId: string,
  repositoryId: string,
  options: Signal = {},
): Promise<Readonly<PodWorktreeReceipt> | null> {
  const ref = podWorktreeReceiptRef(hostId, podId, repositoryId);
  const source = await readReceiptSource(root, ref, signalOptions(options.signal));
  if (source === null) return null;
  const receipt = parsePodWorktreeReceipt(parseDeterministicJsonDocument(source.text, "$receipt"));
  if (
    receipt.hostId !== hostId ||
    receipt.podId !== podId ||
    receipt.repositoryId !== repositoryId ||
    renderPodWorktreeReceipt(receipt) !== source.text
  ) {
    fail("io-failure", "receipt-representation", "$receipt");
  }
  return receipt;
}

/** 列出一个 pod 的全部 worktree 回执（按仓库标识排序）；目录不存在即空。 */
export async function listPodWorktreeReceipts(
  root: RootedDirectory,
  hostId: WakeflowHostId,
  podId: string,
  options: Signal = {},
): Promise<readonly Readonly<PodWorktreeReceipt>[]> {
  const directory = parsePortableResourcePath(
    `${podReceiptRootRef(hostId, podId)}/worktrees`,
    "$receipt",
  );
  let listing: Awaited<ReturnType<typeof readStableResourceDirectory>>;
  try {
    listing = await readStableResourceDirectory(root, directory, {
      maximumEntries: DIRECTORY_MAXIMUM_ENTRIES,
      ...signalOptions(options.signal),
    });
  } catch (error: unknown) {
    if (error instanceof StableDirectoryReadError && error.reason === "not-found") {
      return Object.freeze([]);
    }
    if (error instanceof StableDirectoryReadError) {
      fail("io-failure", `receipt-listing-${error.reason}`, "$receipt", { cause: error });
    }
    throw error;
  }
  const receipts: Readonly<PodWorktreeReceipt>[] = [];
  for (const entry of listing.entries) {
    if (!entry.name.endsWith(".json")) continue;
    const repositoryId = entry.name.slice(0, -".json".length);
    if (!isDurableIdOfKind(repositoryId, "repository")) continue;
    const receipt = await readPodWorktreeReceipt(root, hostId, podId, repositoryId, options);
    if (receipt !== null) receipts.push(receipt);
  }
  return Object.freeze(
    receipts.sort((left, right) =>
      left.repositoryId < right.repositoryId ? -1 : left.repositoryId > right.repositoryId ? 1 : 0,
    ),
  );
}

/**
 * 不带宿主身份的消费者（demand 生命周期、证据）按 podId 在两个宿主目录里找回执：
 * 一个 pod 的窗口只在一个宿主上登记，取第一个有回执的宿主。
 */
export async function listPodWorktreeReceiptsAnyHost(
  root: RootedDirectory,
  podId: string,
  options: Signal = {},
): Promise<readonly Readonly<PodWorktreeReceipt>[]> {
  for (const hostId of WAKEFLOW_HOST_IDS) {
    const receipts = await listPodWorktreeReceipts(root, hostId, podId, options);
    if (receipts.length > 0) return receipts;
  }
  return Object.freeze([]);
}

/**
 * 本宿主上除 `excludePodId` 之外、回执路径等于该检出的第一份回执（§13.128，旧实现 T03
 * "rejects a worktree occupied by another current Pod"）：一个检出同一时刻只属于一个 pod。
 */
export async function findPodWorktreeReceiptByPath(
  root: RootedDirectory,
  hostId: WakeflowHostId,
  checkoutPath: string,
  excludePodId: string,
  options: Signal = {},
): Promise<Readonly<PodWorktreeReceipt> | null> {
  const target = (await realpathOrNull(checkoutPath)) ?? checkoutPath;
  for (const podId of await listPodReceiptDirectories(root, hostId, options)) {
    if (podId === excludePodId) continue;
    for (const receipt of await listPodWorktreeReceipts(root, hostId, podId, options)) {
      if (receipt.path === target) return receipt;
    }
  }
  return null;
}

/** 列出本宿主有回执目录的 pod 标识；recover 用它发现配置里已不存在的孤儿目录。 */
export async function listPodReceiptDirectories(
  root: RootedDirectory,
  hostId: WakeflowHostId,
  options: Signal = {},
): Promise<readonly string[]> {
  try {
    const listing = await readStableResourceDirectory(root, hostPodReceiptsRootRef(hostId), {
      maximumEntries: DIRECTORY_MAXIMUM_ENTRIES,
      ...signalOptions(options.signal),
    });
    return Object.freeze(
      listing.entries
        .filter((entry) => entry.node.kind === "directory" && isDurableIdOfKind(entry.name, "pod"))
        .map((entry) => entry.name)
        .sort(),
    );
  } catch (error: unknown) {
    if (error instanceof StableDirectoryReadError && error.reason === "not-found") {
      return Object.freeze([]);
    }
    if (error instanceof StableDirectoryReadError) {
      fail("io-failure", `receipt-listing-${error.reason}`, "$receipt", { cause: error });
    }
    throw error;
  }
}

/** 退休一份回执；不存在返回 false。 */
export async function retirePodWorktreeReceipt(
  root: RootedDirectory,
  hostId: WakeflowHostId,
  podId: string,
  repositoryId: string,
  options: Signal = {},
): Promise<boolean> {
  const ref = podWorktreeReceiptRef(hostId, podId, repositoryId);
  const source = await readReceiptSource(root, ref, signalOptions(options.signal));
  if (source === null) return false;
  try {
    await unlinkRegularFileExactly(root, ref, {
      expectedNode: source.node,
      ...signalOptions(options.signal),
    });
    return true;
  } catch (error: unknown) {
    if (error instanceof ExactRegularFileUnlinkError) {
      fail("io-failure", `receipt-retire-${error.reason}`, "$receipt", { cause: error });
    }
    throw error;
  }
}

/** 删除一个 pod 的整个回执目录（Wakeflow 自己的私有文件）；不存在即 false。 */
export async function retirePodReceipts(
  root: RootedDirectory,
  hostId: WakeflowHostId,
  podId: string,
): Promise<boolean> {
  const ref = podReceiptRootRef(hostId, podId);
  const absolute = path.join(root.absolutePath, ...ref.split("/"));
  try {
    const node = await stat(absolute);
    if (!node.isDirectory()) return false;
  } catch {
    return false;
  }
  try {
    await rm(absolute, { recursive: true, force: true });
  } catch (error: unknown) {
    fail("io-failure", "receipt-retire-directory", "$receipt", { cause: error });
  }
  return true;
}

/** 检出是否仍在：目录存在且带 `.git` 指针文件。 */
export async function worktreeCheckoutPresent(
  receipt: Readonly<PodWorktreeReceipt>,
): Promise<boolean> {
  try {
    const node = await stat(receipt.path);
    if (!node.isDirectory()) return false;
    const pointer = await stat(path.join(receipt.path, ".git"));
    return pointer.isFile();
  } catch {
    return false;
  }
}
