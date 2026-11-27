import pLimit from "p-limit";

import type { WakeflowConfigAuthoritySnapshot } from "../../configuration/wakeflow-config-authority-snapshot.js";
import {
  parseWakeflowDurableIdOfKind,
  type WakeflowDurableId,
  WakeflowDurableIdError,
} from "../../contracts/identity/wakeflow-durable-id.js";
import { isEvidenceKind } from "../../contracts/vocabulary/evidence-kinds.js";
import {
  inspectLoadedArtifactTree,
  type LoadedArtifactTreeIdentity,
  LoadedArtifactTreeIdentityError,
  type LoadedArtifactTreeManifest,
  validateLoadedArtifactTreeManifest,
} from "../../foundation/artifact/loaded-artifact-tree-identity.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { ownString } from "../../foundation/data/own-string.js";
import {
  type FileNodeSnapshot,
  sameFileNodeIdentity,
} from "../../foundation/filesystem/file-node-snapshot.js";
import {
  type PortableResourcePath,
  parsePortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  readStableFile,
  StableFileReadError,
} from "../../foundation/filesystem/stable-file-read.js";
import type { GitCommitObservation } from "../../foundation/git/git-commit-observation.js";
import { OperationAbortedError, throwIfAborted } from "../../foundation/node/abort-signal.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { decodeUtf8, Utf8Error } from "../../foundation/text/utf8.js";
import type { UtcWallClock } from "../../foundation/time/wall-clock.js";
import { WakeflowError } from "../../kernel/error.js";
import { readHostHookObservationRecord } from "../../kernel/hook-observations.js";
import { deriveDurableId } from "../../kernel/ids.js";
import { type PrivacyFinding, scanPrivacy, scanPrivacyText } from "../../kernel/privacy-scan.js";
import {
  assertDemandOperationConfigCurrent,
  closeDemandOperationAuthorityContext,
  type DemandOperationAuthorityContext,
  DemandOperationAuthorityContextError,
  openDemandOperationAuthorityContext,
} from "../demand/demand-operation-authority-context.js";
import {
  DemandEventSourcingRootAuthorityError,
  loadDemandEventSourcingRootAuthority,
} from "../demand/event-sourcing/demand-event-sourcing-root-authority.js";
import type { DemandManagedEvidenceSummary } from "../demand/model/demand-aggregate-state.js";
import { LedgerAuthorityStore } from "../ledger/ledger-authority-store.js";
import {
  createManagedEvidenceCapturePlan,
  type ManagedEvidenceCaptureDemandExpectation,
  type ManagedEvidenceCapturePlan,
  ManagedEvidenceCapturePlanError,
} from "./managed-evidence-capture-plan.js";
import {
  managedEvidenceCommitObservationOf,
  observeConfiguredRepositoryCommit,
} from "./managed-evidence-commit-observation.js";
import {
  ManagedEvidenceConfiguredSourceRootError,
  openConfiguredManagedEvidenceSourceRoot,
} from "./managed-evidence-configured-source-root.js";
import {
  createManagedEvidenceManifest,
  MANAGED_EVIDENCE_PAYLOAD_LIMITS,
  type ManagedEvidenceManifest,
  ManagedEvidenceManifestError,
} from "./managed-evidence-manifest.js";
import { encodeManagedEvidenceSourceProjection } from "./managed-evidence-source-projection.js";
import {
  assertManagedEvidenceKindMatchesSource,
  type ManagedEvidenceCommitSelection,
  type ManagedEvidenceContentReviewPolicy,
  type ManagedEvidenceManagedPathSource,
  type ManagedEvidenceSource,
  type ManagedEvidenceSourceSelection,
  ManagedEvidenceSourceSelectionError,
  managedEvidenceSourceKey,
  parseManagedEvidenceSourceSelection,
} from "./managed-evidence-source-selection.js";

/**
 * Wakeflow Governance / Evidence：证据来源的零写捕获规划（切片 8 D1 到 D3）。
 *
 * Service 重新读取 Config 与完整 Demand Authority，按来源种类观察实际字节：`managed-path`
 * 稳定读取配置根下的文件或目录树，`observation` 读取本工作区的一条 hook 记录并只保留脱敏
 * 投影，`link` 与 `commit` 只渲染引用投影。文本成员经内核隐私扫描；凭证类命中永远阻塞，
 * opaque 成员与非凭证类命中只在 Controller 确认下进入记录。Evidence 身份由 Demand、来源键
 * 与负载摘要派生，同内容永远得到同一份记录。Preview 不创建 Evidence 目录、stage、Event 或
 * 投影，也不执行宿主效果。
 */

export interface ManagedEvidenceCapturePlanningOptions {
  readonly clock?: UtcWallClock;
  readonly signal?: AbortSignal;
}

export interface ManagedEvidenceCaptureFinding {
  readonly ref: PortableResourcePath;
  readonly line: number;
  readonly kind: PrivacyFinding["kind"];
}

/** 捕获时观察到的、需要 Controller 确认或永远阻塞的内容事实。 */
export interface ManagedEvidenceCaptureReview {
  readonly opaqueFileRefs: readonly PortableResourcePath[];
  readonly credentialFindings: readonly Readonly<ManagedEvidenceCaptureFinding>[];
}

export type ManagedEvidenceCapturePreview =
  | Readonly<{
      readonly status: "ready";
      readonly plan: Readonly<ManagedEvidenceCapturePlan>;
      readonly review: Readonly<ManagedEvidenceCaptureReview>;
      /** 同一 Demand 里已存在的同身份记录；apply 据此回放 already-recorded。 */
      readonly existing: Readonly<DemandManagedEvidenceSummary> | null;
    }>
  | Readonly<{
      readonly status: "blocked";
      readonly blockers: readonly string[];
      readonly review: Readonly<ManagedEvidenceCaptureReview>;
    }>;

export type ManagedEvidenceCapturePlanningServiceErrorReason =
  | "input"
  | "config"
  | "demand"
  | "source-root"
  | "source"
  | "source-type"
  | "source-changed"
  | "kind"
  | "capacity"
  | "identity"
  | "time"
  | "manifest"
  | "operation-failure";

const ERROR_MESSAGES = {
  input: "Managed evidence capture planning input is invalid.",
  config: "Managed evidence capture planning Config is invalid.",
  demand: "Managed evidence capture planning Demand authority is invalid.",
  "source-root": "Managed evidence capture planning source root is invalid.",
  source: "Managed evidence capture planning source is unavailable or unsafe.",
  "source-type": "Managed evidence capture planning source type is inconsistent.",
  "source-changed": "Managed evidence capture planning source changed during observation.",
  kind: "Managed evidence capture planning kind does not match its source.",
  capacity: "Managed evidence capture planning source exceeds its capacity.",
  identity: "Managed evidence capture planning identity derivation failed.",
  time: "Managed evidence capture planning capture time failed.",
  manifest: "Managed evidence capture planning manifest is invalid.",
  "operation-failure": "Managed evidence capture planning failed.",
} as const satisfies Readonly<Record<ManagedEvidenceCapturePlanningServiceErrorReason, string>>;

export class ManagedEvidenceCapturePlanningServiceError extends Error {
  override readonly name = "ManagedEvidenceCapturePlanningServiceError";
  readonly code = "wakeflow-managed-evidence-capture-planning-service" as const;
  readonly reason: ManagedEvidenceCapturePlanningServiceErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;

  constructor(
    reason: ManagedEvidenceCapturePlanningServiceErrorReason,
    causeCode: string | null = null,
    causeReason: string | null = null,
    options?: ErrorOptions,
  ) {
    super(ERROR_MESSAGES[reason], options);
    this.reason = reason;
    this.causeCode = causeCode;
    this.causeReason = causeReason;
  }
}

interface CapturedSource {
  readonly identity: Readonly<LoadedArtifactTreeIdentity>;
  readonly source: ManagedEvidenceSource;
  readonly review: Readonly<ManagedEvidenceCaptureReview>;
  /** 来源自身的阻塞项（例如仓库里没有这个提交）；与内容审查的阻塞项一起返回。 */
  readonly blockers?: readonly string[];
}

const CONTENT_CLASSIFICATION_CONCURRENCY = 4;
const MAXIMUM_FILE_BYTES = parseByteCount(MANAGED_EVIDENCE_PAYLOAD_LIMITS.maxFileBytes);
const CAPTURED_FILE_REF = parsePortableResourcePath("content");
const BLOCKER_LIMIT = 16;

function fail(reason: ManagedEvidenceCapturePlanningServiceErrorReason, cause?: unknown): never {
  throw new ManagedEvidenceCapturePlanningServiceError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
    cause === undefined ? undefined : { cause },
  );
}

function parseDemandId(value: unknown): WakeflowDurableId<"demand"> {
  try {
    return parseWakeflowDurableIdOfKind(value, "demand", "$demandId");
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("input", error);
    throw error;
  }
}

/**
 * 选择里 kind 与来源种类不配（例如文件来源配 `transcript`）单独报 `kind`，与观察到的 hook 记录
 * 不带 transcript 同一原因，调用方据此改 kind 而不是猜整份选择（gate-log §13.134，收 §13.133 G12）。
 * 闭集之外的 kind 不是"不配"而是选择本身坏了，仍报 `input`：解析器对两者都给 `kind`，
 * 但只有在选择已通过普通记录准入之后才会走到 kind 检查，所以这里读 `kind` 字段是安全的。
 */
function parseSelection(value: unknown): Readonly<ManagedEvidenceSourceSelection> {
  try {
    return parseManagedEvidenceSourceSelection(value);
  } catch (error: unknown) {
    if (error instanceof ManagedEvidenceSourceSelectionError) {
      const mismatch =
        error.reason === "kind" && isEvidenceKind((value as { readonly kind?: unknown }).kind);
      fail(mismatch ? "kind" : "input", error);
    }
    throw error;
  }
}

function rethrowPlanningError(error: unknown): never {
  if (error instanceof ManagedEvidenceCapturePlanningServiceError) throw error;
  if (error instanceof DemandOperationAuthorityContextError) {
    if (error.reason === "config" || error.reason === "stale-config") fail("config", error);
    fail("demand", error);
  }
  if (error instanceof RootedDirectoryError) fail("source-root", error);
  if (error instanceof StableFileReadError) mapStableFileError(error);
  if (error instanceof LoadedArtifactTreeIdentityError) mapArtifactError(error);
  throw error;
}

/** 内核读取（hook 观察记录、pod worktree 回执）的失败收敛为本模块的稳定错误。 */
async function readKernelSource<T>(
  read: () => Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  try {
    return await read();
  } catch (error: unknown) {
    if (error instanceof WakeflowError) {
      if (signal?.aborted === true) throw new OperationAbortedError({ cause: error });
      fail("source", error);
    }
    throw error;
  }
}

function mapStableFileError(error: StableFileReadError): never {
  if (error.reason === "too-large") fail("capacity", error);
  if (error.reason === "source-changed" || error.reason === "expectation-changed") {
    fail("source-changed", error);
  }
  if (error.reason === "not-file") fail("source-type", error);
  fail("source", error);
}

function mapArtifactError(error: LoadedArtifactTreeIdentityError): never {
  if (
    error.reason === "entry-limit" ||
    error.reason === "depth-limit" ||
    error.reason === "file-count" ||
    error.reason === "file-bytes" ||
    error.reason === "total-bytes" ||
    error.reason === "ref-bytes"
  ) {
    fail("capacity", error);
  }
  if (error.reason === "source-changed") fail("source-changed", error);
  fail("source", error);
}

interface ClassifiedContent {
  readonly opaque: boolean;
  readonly findings: readonly Readonly<ManagedEvidenceCaptureFinding>[];
}

/**
 * Every decodable member is scanned, including opaque text; findings retain source lines.
 * A member that is not UTF-8 is still scanned through a lossy decode: a key embedded among
 * binary bytes must not escape the capture gate (§13.161 B9-3).
 */
function classifyContent(
  bytes: Uint8Array,
  ref: PortableResourcePath,
): Readonly<ClassifiedContent> {
  let text: string;
  try {
    text = decodeUtf8(bytes, "$content");
  } catch (error: unknown) {
    if (!(error instanceof Utf8Error)) throw error;
    const lossy = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    return Object.freeze({
      opaque: true,
      findings: Object.freeze(
        scanPrivacyText(lossy).findings.map((finding) =>
          Object.freeze({ ref, line: finding.line, kind: finding.kind }),
        ),
      ),
    });
  }
  const scanned = scanPrivacyText(text);
  return Object.freeze({
    opaque: scanned.opaque,
    findings: Object.freeze(
      scanned.findings.map((finding) =>
        Object.freeze({ ref, line: finding.line, kind: finding.kind }),
      ),
    ),
  });
}

function compareFinding(
  left: Readonly<ManagedEvidenceCaptureFinding>,
  right: Readonly<ManagedEvidenceCaptureFinding>,
): number {
  if (left.ref !== right.ref) return left.ref < right.ref ? -1 : 1;
  if (left.line !== right.line) return left.line - right.line;
  if (left.kind === right.kind) return 0;
  return left.kind < right.kind ? -1 : 1;
}

/** 同一行同一种命中只保留一条；Manifest要求(ref, line, kind)严格递增。 */
function uniqueFindings(
  sorted: readonly Readonly<ManagedEvidenceCaptureFinding>[],
): Readonly<ManagedEvidenceCaptureFinding>[] {
  return sorted.filter((finding, index) => {
    const previous = index === 0 ? undefined : sorted[index - 1];
    return previous === undefined || compareFinding(previous, finding) !== 0;
  });
}

function reviewOf(
  classified: readonly Readonly<{ ref: PortableResourcePath; content: ClassifiedContent }>[],
): Readonly<ManagedEvidenceCaptureReview> {
  const findings = uniqueFindings(
    classified.flatMap((entry) => entry.content.findings).sort(compareFinding),
  );
  return Object.freeze({
    opaqueFileRefs: Object.freeze(
      classified.filter((entry) => entry.content.opaque).map((entry) => entry.ref),
    ),
    credentialFindings: Object.freeze(findings),
  });
}

/**
 * 内容阻塞项（能力卡 8 Q1，切片 8 D3）：凭证类命中永远阻塞；opaque 成员只在 `reject` 策略下阻塞。
 * 隐私扫描只认凭证（ADR-0031），所以没有"可以被确认的隐私命中"这一类了。
 */
export function deriveManagedEvidenceContentBlockers(
  review: Readonly<ManagedEvidenceCaptureReview>,
  policy: ManagedEvidenceContentReviewPolicy,
): readonly string[] {
  const blockers: string[] = [];
  for (const finding of review.credentialFindings) {
    blockers.push(`privacy:${finding.kind}:${finding.ref}:${finding.line}`);
  }
  if (policy === "reject") {
    for (const ref of review.opaqueFileRefs) blockers.push(`opaque-content:${ref}`);
  }
  return Object.freeze(blockers.slice(0, BLOCKER_LIMIT));
}

function singleFileIdentity(
  byteCount: number,
  digest: LoadedArtifactTreeManifest["files"][number]["digest"],
  executable: boolean,
): Readonly<LoadedArtifactTreeIdentity> {
  let manifest: Readonly<LoadedArtifactTreeManifest>;
  try {
    manifest = validateLoadedArtifactTreeManifest({
      artifactKind: "wakeflow-loaded-artifact-tree",
      fileCount: 1,
      files: [{ bytes: byteCount, digest, executable, ref: CAPTURED_FILE_REF }],
      schemaVersion: 1,
      totalBytes: byteCount,
    });
  } catch (error: unknown) {
    if (error instanceof LoadedArtifactTreeIdentityError) mapArtifactError(error);
    throw error;
  }
  return Object.freeze({ artifactDigest: computeCanonicalJsonSha256Digest(manifest), manifest });
}

async function captureFile(
  root: RootedDirectory,
  source: Readonly<ManagedEvidenceManagedPathSource>,
  expectedNode: Readonly<FileNodeSnapshot>,
  signal: AbortSignal | undefined,
): Promise<Readonly<CapturedSource>> {
  let read: Awaited<ReturnType<typeof readStableFile>>;
  try {
    read = await readStableFile(root, source.path, {
      maximumBytes: MAXIMUM_FILE_BYTES,
      expectedNode,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof StableFileReadError) mapStableFileError(error);
    throw error;
  }
  const content = classifyContent(read.bytes, CAPTURED_FILE_REF);
  return Object.freeze({
    identity: singleFileIdentity(
      Number(read.byteCount),
      read.digest,
      (read.node.permissionBits & 0o111) !== 0,
    ),
    source,
    review: reviewOf([{ ref: CAPTURED_FILE_REF, content }]),
  });
}

async function openSelectedTreeRoot(
  sourceRoot: RootedDirectory,
  source: Readonly<ManagedEvidenceManagedPathSource>,
  expectedNode: Readonly<FileNodeSnapshot>,
): Promise<RootedDirectory> {
  let observation: Awaited<ReturnType<RootedDirectory["inspectExistingResource"]>>;
  try {
    observation = await sourceRoot.inspectExistingResource(source.path, "$source");
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) fail("source", error);
    throw error;
  }
  if (
    observation.node.kind !== "directory" ||
    !sameFileNodeIdentity(observation.node, expectedNode)
  ) {
    fail("source-type");
  }
  let treeRoot: RootedDirectory | undefined;
  try {
    treeRoot = await RootedDirectory.open(observation.physicalPath, "$source");
    const current = await treeRoot.assertCurrent("$source");
    if (!sameFileNodeIdentity(expectedNode, current)) fail("source-changed");
    return treeRoot;
  } catch (error: unknown) {
    if (treeRoot !== undefined) {
      try {
        await treeRoot.close();
      } catch {
        // 首个打开或身份错误优先。
      }
    }
    if (error instanceof ManagedEvidenceCapturePlanningServiceError) throw error;
    if (error instanceof RootedDirectoryError) fail("source", error);
    throw error;
  }
}

async function inspectTreeIdentity(
  treeRoot: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<Readonly<LoadedArtifactTreeIdentity>> {
  try {
    return await inspectLoadedArtifactTree(treeRoot, {
      limits: MANAGED_EVIDENCE_PAYLOAD_LIMITS,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof LoadedArtifactTreeIdentityError) mapArtifactError(error);
    throw error;
  }
}

async function classifyTreeFiles(
  treeRoot: RootedDirectory,
  identity: Readonly<LoadedArtifactTreeIdentity>,
  signal: AbortSignal | undefined,
): Promise<Readonly<ManagedEvidenceCaptureReview>> {
  const limit = pLimit(CONTENT_CLASSIFICATION_CONCURRENCY);
  const settled = await Promise.allSettled(
    identity.manifest.files.map((file) =>
      limit(async () => {
        let read: Awaited<ReturnType<typeof readStableFile>>;
        try {
          read = await readStableFile(treeRoot, file.ref, {
            maximumBytes: MAXIMUM_FILE_BYTES,
            ...(signal === undefined ? {} : { signal }),
          });
        } catch (error: unknown) {
          if (error instanceof StableFileReadError) mapStableFileError(error);
          throw error;
        }
        if (Number(read.byteCount) !== file.bytes || read.digest !== file.digest) {
          fail("source-changed");
        }
        return Object.freeze({
          ref: file.ref,
          content: classifyContent(read.bytes, file.ref),
        });
      }),
    ),
  );
  for (const result of settled) {
    if (result.status === "rejected") throw result.reason;
  }
  return reviewOf(
    settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : [])),
  );
}

async function captureTree(
  sourceRoot: RootedDirectory,
  source: Readonly<ManagedEvidenceManagedPathSource>,
  expectedNode: Readonly<FileNodeSnapshot>,
  signal: AbortSignal | undefined,
): Promise<Readonly<CapturedSource>> {
  const treeRoot = await openSelectedTreeRoot(sourceRoot, source, expectedNode);
  let result: Readonly<CapturedSource> | undefined;
  let failure: unknown;
  try {
    const first = await inspectTreeIdentity(treeRoot, signal);
    const review = await classifyTreeFiles(treeRoot, first, signal);
    const current = await inspectTreeIdentity(treeRoot, signal);
    if (current.artifactDigest !== first.artifactDigest) fail("source-changed");
    result = Object.freeze({ identity: current, source, review });
  } catch (error: unknown) {
    failure = error;
  }
  try {
    await treeRoot.close();
  } catch (error: unknown) {
    if (failure === undefined) failure = error;
  }
  if (failure !== undefined) throw failure;
  if (result === undefined) fail("operation-failure");
  return result;
}

async function captureManagedPath(
  workspaceRoot: RootedDirectory,
  config: Readonly<WakeflowConfigAuthoritySnapshot>,
  source: Readonly<ManagedEvidenceManagedPathSource>,
  signal: AbortSignal | undefined,
): Promise<Readonly<CapturedSource>> {
  let sourceRoot: RootedDirectory;
  try {
    sourceRoot = await openConfiguredManagedEvidenceSourceRoot(
      workspaceRoot,
      config,
      source,
      signal === undefined ? {} : { signal },
    );
  } catch (error: unknown) {
    if (error instanceof ManagedEvidenceConfiguredSourceRootError) fail("source-root", error);
    throw error;
  }
  let result: Readonly<CapturedSource> | undefined;
  let failure: unknown;
  try {
    let observation: Awaited<ReturnType<RootedDirectory["inspectExistingResource"]>>;
    try {
      observation = await sourceRoot.inspectExistingResource(source.path, "$source");
    } catch (error: unknown) {
      if (error instanceof RootedDirectoryError) fail("source", error);
      throw error;
    }
    if (observation.node.kind === "symbolic-link") fail("source");
    const expectedKind = source.resourceType === "file" ? "file" : "directory";
    if (observation.node.kind !== expectedKind) fail("source-type");
    result =
      source.resourceType === "file"
        ? await captureFile(sourceRoot, source, observation.node, signal)
        : await captureTree(sourceRoot, source, observation.node, signal);
  } catch (error: unknown) {
    failure = error;
  }
  try {
    await sourceRoot.close();
  } catch (error: unknown) {
    if (failure === undefined) failure = error;
  }
  if (failure !== undefined) throw failure;
  if (result === undefined) fail("operation-failure");
  return result;
}

/**
 * 引用类来源：负载是来源投影文档。投影里只有 typed id、记录标识与摘要，唯一的自由文本是
 * 链接 URL，因此只有 URL 经隐私扫描（查询串里的凭证会被拦下）。
 */
function captureProjection(
  source: Exclude<ManagedEvidenceSource, Readonly<ManagedEvidenceManagedPathSource>>,
): Readonly<CapturedSource> {
  const projection = encodeManagedEvidenceSourceProjection(source);
  const findings =
    source.kind === "link"
      ? scanPrivacy(source.url).map((finding) =>
          Object.freeze({ ref: CAPTURED_FILE_REF, line: finding.line, kind: finding.kind }),
        )
      : [];
  return Object.freeze({
    identity: singleFileIdentity(projection.byteCount, projection.digest, false),
    source,
    review: reviewOf([{ ref: CAPTURED_FILE_REF, content: { opaque: false, findings } }]),
  });
}

/** 只读地观察仓库里的这个提交（ADR-0028）；拿不到结论返回 null，记录照旧只带引用。 */
async function observeCommit(
  config: Readonly<WakeflowConfigAuthoritySnapshot>,
  source: Readonly<ManagedEvidenceCommitSelection>,
  signal: AbortSignal | undefined,
): Promise<GitCommitObservation | null> {
  try {
    return await observeConfiguredRepositoryCommit(config, source, signal);
  } catch (error: unknown) {
    if (error instanceof ManagedEvidenceConfiguredSourceRootError) fail("source-root", error);
    throw error;
  }
}

/**
 * 提交来源：仓库里没有这个对象、或它不是提交时给出阻塞项；观察到了就把事实并进来源，负载仍是来源
 * 投影（由清单的来源字段完整重建）。
 */
async function captureCommit(
  config: Readonly<WakeflowConfigAuthoritySnapshot>,
  source: Readonly<ManagedEvidenceCommitSelection>,
  signal: AbortSignal | undefined,
): Promise<Readonly<CapturedSource>> {
  if (config.indexes.repositoryById[source.repositoryId] === undefined) fail("source-root");
  const observed = await observeCommit(config, source, signal);
  if (observed === null) return captureProjection(source);
  if (observed.status !== "observed") {
    const blocker =
      observed.status === "missing"
        ? `commit-unknown:${source.commitOid}`
        : `commit-not-a-commit:${source.commitOid}`;
    return Object.freeze({ ...captureProjection(source), blockers: [blocker] });
  }
  return captureProjection(
    Object.freeze({ ...source, observation: managedEvidenceCommitObservationOf(observed) }),
  );
}

async function captureObservation(
  workspaceRoot: RootedDirectory,
  selection: Readonly<ManagedEvidenceSourceSelection>,
  source: Extract<ManagedEvidenceSourceSelection["source"], { readonly kind: "observation" }>,
  signal: AbortSignal | undefined,
): Promise<Readonly<CapturedSource>> {
  const read = await readKernelSource(
    () =>
      readHostHookObservationRecord(
        workspaceRoot,
        source.hostId,
        source.recordId,
        signal === undefined ? {} : { signal },
      ),
    signal,
  );
  if (read === null) fail("source");
  const record = read.record;
  const projected = Object.freeze({
    kind: "observation" as const,
    hostId: source.hostId,
    recordId: source.recordId,
    event: record.event,
    recordedAt: record.recordedAt,
    turnId: record.turnId,
    promptDigest: record.promptDigest,
    lastAssistantMessageDigest: record.lastAssistantMessageDigest,
    transcript: record.transcriptRef === null ? ("absent" as const) : ("present" as const),
    recordDigest: read.digest,
  });
  try {
    assertManagedEvidenceKindMatchesSource(selection.kind, projected);
  } catch (error: unknown) {
    if (error instanceof ManagedEvidenceSourceSelectionError) fail("kind", error);
    throw error;
  }
  return captureProjection(projected);
}

async function captureSelectedSource(
  workspaceRoot: RootedDirectory,
  config: Readonly<WakeflowConfigAuthoritySnapshot>,
  selection: Readonly<ManagedEvidenceSourceSelection>,
  signal: AbortSignal | undefined,
): Promise<Readonly<CapturedSource>> {
  const source = selection.source;
  switch (source.kind) {
    case "managed-path":
      return captureManagedPath(workspaceRoot, config, source, signal);
    case "observation":
      return captureObservation(workspaceRoot, selection, source, signal);
    case "link":
      return captureProjection(source);
    case "commit":
      return captureCommit(config, source, signal);
    default: {
      const exhaustive: never = source;
      return exhaustive;
    }
  }
}

function demandExpectation(
  context: Readonly<DemandOperationAuthorityContext>,
): Readonly<ManagedEvidenceCaptureDemandExpectation> {
  return Object.freeze({
    streamRevision: context.loaded.aggregate.streamRevision,
    stateDigest: context.loaded.aggregate.stateDigest,
    lastEventId: context.loaded.aggregate.lastEvent.eventId,
    lastEventDigest: context.loaded.aggregate.lastEventDigest,
  });
}

async function assertAuthorityCurrent(
  workspaceRoot: RootedDirectory,
  context: Readonly<DemandOperationAuthorityContext>,
  expected: Readonly<ManagedEvidenceCaptureDemandExpectation>,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    await assertDemandOperationConfigCurrent(workspaceRoot, context.config, signal);
    const current = await loadDemandEventSourcingRootAuthority(
      context.demandRoot,
      new LedgerAuthorityStore(context.ledgerRoot),
      { audit: true, ...(signal === undefined ? {} : { signal }) },
    );
    if (
      current.authorityDigest !== context.loaded.authorityDigest ||
      current.aggregate.streamRevision !== expected.streamRevision ||
      current.aggregate.stateDigest !== expected.stateDigest ||
      current.aggregate.lastEvent.eventId !== expected.lastEventId ||
      current.aggregate.lastEventDigest !== expected.lastEventDigest
    ) {
      fail("demand");
    }
  } catch (error: unknown) {
    if (error instanceof ManagedEvidenceCapturePlanningServiceError) throw error;
    if (error instanceof DemandOperationAuthorityContextError) {
      if (error.reason === "stale-config") fail("config", error);
      fail("demand", error);
    }
    if (error instanceof DemandEventSourcingRootAuthorityError) {
      fail("demand", error);
    }
    throw error;
  }
}

/** Evidence 身份从 Demand、来源键与负载摘要派生：同内容同一份记录，不消耗随机 UUID（D1）。 */
export function deriveManagedEvidenceId(
  demandId: WakeflowDurableId<"demand">,
  selection: Readonly<ManagedEvidenceSourceSelection>,
  artifactDigest: string,
): WakeflowDurableId<"evidence"> {
  return deriveDurableId(
    "evidence",
    "managed-evidence",
    demandId,
    managedEvidenceSourceKey(selection.source),
    artifactDigest,
  );
}

function createManifest(
  context: Readonly<DemandOperationAuthorityContext>,
  demandId: WakeflowDurableId<"demand">,
  selection: Readonly<ManagedEvidenceSourceSelection>,
  captured: Readonly<CapturedSource>,
  clock: UtcWallClock | undefined,
): Readonly<ManagedEvidenceManifest> {
  // 需要 Controller 确认的只剩 opaque 成员；`privacyFindings` 留在清单里只为读旧记录，新记录恒为空。
  const needsReview = captured.review.opaqueFileRefs.length > 0;
  try {
    return createManagedEvidenceManifest(
      {
        evidenceId: deriveManagedEvidenceId(demandId, selection, captured.identity.artifactDigest),
        programId: context.loaded.identity.programId,
        demandId,
        demandAuthorityDigest: context.loaded.authorityDigest,
        kind: selection.kind,
        recordedBy: {
          windowId: context.config.indexes.controllerWindow.windowId,
          configDigest: context.config.configDigest,
        },
        source: captured.source,
        payload: {
          artifactDigest: captured.identity.artifactDigest,
          treeManifest: captured.identity.manifest,
        },
        contentReview: {
          disposition: needsReview ? "controller-confirmed" : "not-required",
          opaqueFileRefs: captured.review.opaqueFileRefs,
          privacyFindings: [],
        },
      },
      clock === undefined ? {} : { clock },
    );
  } catch (error: unknown) {
    if (error instanceof ManagedEvidenceManifestError) {
      if (error.reason === "time") fail("time", error);
      fail("manifest", error);
    }
    throw error;
  }
}

export class ManagedEvidenceCapturePlanningService {
  readonly #workspaceRoot: RootedDirectory;

  constructor(workspaceRoot: RootedDirectory) {
    this.#workspaceRoot = workspaceRoot;
  }

  /**
   * 读取当前 Authority 与来源，返回不含任何持久副作用的捕获结果：内容阻塞时返回阻塞项而不
   * 读时钟，否则返回完整 capture plan。
   */
  async preview(
    demandIdValue: unknown,
    selectionValue: unknown,
    options: ManagedEvidenceCapturePlanningOptions = {},
  ): Promise<ManagedEvidenceCapturePreview> {
    throwIfAborted(options.signal);
    const demandId = parseDemandId(demandIdValue);
    const selection = parseSelection(selectionValue);
    let context: Readonly<DemandOperationAuthorityContext> | undefined;
    let result: ManagedEvidenceCapturePreview | undefined;
    let failure: unknown;
    try {
      context = await openDemandOperationAuthorityContext(
        this.#workspaceRoot,
        demandId,
        options.signal,
      );
      if (
        context.loaded.aggregate.state.lifecycle !== "active" ||
        context.loaded.identity.programId !== context.config.model.program.programId
      ) {
        fail("demand");
      }
      const expectedDemand = demandExpectation(context);
      const captured = await captureSelectedSource(
        this.#workspaceRoot,
        context.config,
        selection,
        options.signal,
      );
      const blockers = [
        ...(captured.blockers ?? []),
        ...deriveManagedEvidenceContentBlockers(captured.review, selection.contentReview),
      ];
      if (blockers.length > 0) {
        result = Object.freeze({ status: "blocked" as const, blockers, review: captured.review });
      } else {
        await assertAuthorityCurrent(this.#workspaceRoot, context, expectedDemand, options.signal);
        const manifest = createManifest(context, demandId, selection, captured, options.clock);
        try {
          result = Object.freeze({
            status: "ready" as const,
            plan: createManagedEvidenceCapturePlan({
              configDigest: context.config.configDigest,
              expectedDemand,
              manifest,
            }),
            review: captured.review,
            existing:
              context.loaded.aggregate.state.managedEvidence?.find(
                (entry) => entry.evidenceId === manifest.evidenceId,
              ) ?? null,
          });
        } catch (error: unknown) {
          if (error instanceof ManagedEvidenceCapturePlanError) fail("operation-failure", error);
          throw error;
        }
      }
    } catch (error: unknown) {
      failure = error;
    }
    if (context !== undefined) {
      try {
        await closeDemandOperationAuthorityContext(context);
      } catch (error: unknown) {
        if (failure === undefined) failure = error;
      }
    }
    if (failure !== undefined) rethrowPlanningError(failure);
    if (result === undefined) fail("operation-failure");
    return result;
  }
}
