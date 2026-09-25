import { types } from "node:util";

import pLimit from "p-limit";

import type { WakeflowConfigAuthoritySnapshot } from "../../configuration/wakeflow-config-authority-snapshot.js";
import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import {
  inspectLoadedArtifactTree,
  validateLoadedArtifactTreeManifest,
  LoadedArtifactTreeIdentityError,
  type LoadedArtifactTreeIdentity,
  type LoadedArtifactTreeManifest,
} from "../../foundation/artifact/loaded-artifact-tree-identity.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { parsePlainRecord, PassiveOwnDataError } from "../../foundation/data/passive-own-data.js";
import {
  sameFileNodeIdentity,
  type FileNodeSnapshot,
} from "../../foundation/filesystem/file-node-snapshot.js";
import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import { readStableFile, StableFileReadError } from "../../foundation/filesystem/stable-file-read.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { decodeUtf8, Utf8Error } from "../../foundation/text/utf8.js";
import type { UtcWallClock } from "../../foundation/time/wall-clock.js";
import { readHostHookObservationRecord } from "../../kernel/hook-observations.js";
import { WakeflowError } from "../../kernel/error.js";
import { deriveDurableId } from "../../kernel/ids.js";
import {
  CREDENTIAL_PRIVACY_FINDING_KINDS,
  DEFAULT_ALLOWED_ID_PREFIXES,
  scanPrivacy,
  type PrivacyFinding,
  type PrivacyScanPolicy,
} from "../../kernel/privacy-scan.js";
import {
  assertDemandOperationConfigCurrent,
  closeDemandOperationAuthorityContext,
  openDemandOperationAuthorityContext,
  DemandOperationAuthorityContextError,
  type DemandOperationAuthorityContext,
} from "../demand/demand-operation-authority-context.js";
import {
  loadDemandEventSourcingRootAuthority,
  DemandEventSourcingRootAuthorityError,
} from "../demand/event-sourcing/demand-event-sourcing-root-authority.js";
import type { DemandManagedEvidenceSummary } from "../demand/model/demand-aggregate-state.js";
import { LedgerAuthorityStore } from "../ledger/ledger-authority-store.js";
import {
  createManagedEvidenceCapturePlan,
  ManagedEvidenceCapturePlanError,
  type ManagedEvidenceCaptureDemandExpectation,
  type ManagedEvidenceCapturePlan,
} from "./managed-evidence-capture-plan.js";
import { listPodWorktreeReceiptsAnyHost } from "../../kernel/pod-worktree-receipts.js";
import {
  openConfiguredManagedEvidenceSourceRoot,
  ManagedEvidenceConfiguredSourceRootError,
} from "./managed-evidence-configured-source-root.js";
import {
  createManagedEvidenceManifest,
  MANAGED_EVIDENCE_PAYLOAD_LIMITS,
  MANAGED_EVIDENCE_PRIVACY_FINDING_LIMIT,
  type ManagedEvidenceManifest,
  type ManagedEvidencePrivacyFinding,
  ManagedEvidenceManifestError,
} from "./managed-evidence-manifest.js";
import { encodeManagedEvidenceSourceProjection } from "./managed-evidence-source-projection.js";
import {
  assertManagedEvidenceKindMatchesSource,
  managedEvidenceSourceKey,
  parseManagedEvidenceSourceSelection,
  ManagedEvidenceSourceSelectionError,
  type ManagedEvidenceContentReviewPolicy,
  type ManagedEvidenceManagedPathSource,
  type ManagedEvidenceSource,
  type ManagedEvidenceSourceSelection,
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
  readonly privacyFindings: readonly Readonly<ManagedEvidenceCaptureFinding>[];
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
  | "aborted"
  | "operation-failure";

const ERROR_MESSAGES = {
  input: "Managed evidence capture planning input is invalid.",
  config: "Managed evidence capture planning Config is invalid.",
  demand: "Managed evidence capture planning Demand authority is invalid.",
  "source-root": "Managed evidence capture planning source root is invalid.",
  source: "Managed evidence capture planning source is unavailable or unsafe.",
  "source-type": "Managed evidence capture planning source type is inconsistent.",
  "source-changed": "Managed evidence capture planning source changed during observation.",
  kind: "Managed evidence capture planning kind does not match the observed source.",
  capacity: "Managed evidence capture planning source exceeds its capacity.",
  identity: "Managed evidence capture planning identity derivation failed.",
  time: "Managed evidence capture planning capture time failed.",
  manifest: "Managed evidence capture planning manifest is invalid.",
  aborted: "Managed evidence capture planning was aborted.",
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
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.causeCode = causeCode;
    this.causeReason = causeReason;
  }
}

interface ParsedOptions {
  readonly clock: UtcWallClock | undefined;
  readonly signal: AbortSignal | undefined;
}

interface CapturedSource {
  readonly identity: Readonly<LoadedArtifactTreeIdentity>;
  readonly source: ManagedEvidenceSource;
  readonly review: Readonly<ManagedEvidenceCaptureReview>;
}

const CONTENT_CLASSIFICATION_CONCURRENCY = 4;
const MAXIMUM_FILE_BYTES = parseByteCount(MANAGED_EVIDENCE_PAYLOAD_LIMITS.maxFileBytes);
const CAPTURED_FILE_REF = parsePortableResourcePath("content");
const NON_TEXT_CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
const BLOCKER_LIMIT = 16;

function ownString(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined &&
    Object.hasOwn(descriptor, "value") &&
    typeof descriptor.value === "string"
    ? descriptor.value
    : null;
}

function fail(reason: ManagedEvidenceCapturePlanningServiceErrorReason, cause?: unknown): never {
  throw new ManagedEvidenceCapturePlanningServiceError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
  );
}

function parseOptions(value: unknown): Readonly<ParsedOptions> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value === undefined ? {} : value, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", error);
    throw error;
  }
  if (
    Object.keys(record).some((key) => key !== "clock" && key !== "signal") ||
    (record.clock !== undefined &&
      (typeof record.clock !== "function" || types.isProxy(record.clock))) ||
    (record.signal !== undefined &&
      (typeof record.signal !== "object" ||
        record.signal === null ||
        types.isProxy(record.signal) ||
        !(record.signal instanceof AbortSignal)))
  ) {
    fail("input");
  }
  return Object.freeze({
    clock: record.clock as UtcWallClock | undefined,
    signal: record.signal as AbortSignal | undefined,
  });
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) fail("aborted");
}

function parseDemandId(value: unknown): WakeflowDurableId<"demand"> {
  try {
    return parseWakeflowDurableIdOfKind(value, "demand", "$demandId");
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) fail("input", error);
    throw error;
  }
}

function parseSelection(value: unknown): Readonly<ManagedEvidenceSourceSelection> {
  try {
    return parseManagedEvidenceSourceSelection(value);
  } catch (error: unknown) {
    if (error instanceof ManagedEvidenceSourceSelectionError) fail("input", error);
    throw error;
  }
}

function rethrowPlanningError(error: unknown): never {
  if (error instanceof ManagedEvidenceCapturePlanningServiceError) throw error;
  if (error instanceof DemandOperationAuthorityContextError) {
    if (error.reason === "aborted") fail("aborted", error);
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
      if (error.reason === "aborted" || signal?.aborted === true) fail("aborted", error);
      fail("source", error);
    }
    throw error;
  }
}

function mapStableFileError(error: StableFileReadError): never {
  if (error.reason === "aborted") fail("aborted", error);
  if (error.reason === "too-large") fail("capacity", error);
  if (error.reason === "source-changed" || error.reason === "expectation-changed") {
    fail("source-changed", error);
  }
  if (error.reason === "not-file") fail("source-type", error);
  fail("source", error);
}

function mapArtifactError(error: LoadedArtifactTreeIdentityError): never {
  if (error.reason === "aborted") fail("aborted", error);
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

/** 隐私白名单：工作区根、ledger 根与配置里的全部仓库与支撑面真实路径（能力卡 8 Q1）。 */
export function managedEvidencePrivacyPolicy(
  workspaceRoot: RootedDirectory,
  config: Readonly<WakeflowConfigAuthoritySnapshot>,
  worktreePaths: readonly string[] = [],
): PrivacyScanPolicy {
  const roots = new Set<string>([
    workspaceRoot.absolutePath,
    config.placements.workspaceRoot,
    config.ledgerRoot,
    ...worktreePaths,
  ]);
  for (const entry of config.placements.roots) {
    roots.add(entry.absolutePath);
    if (entry.realPath !== null) roots.add(entry.realPath);
  }
  return Object.freeze({
    allowedPathRoots: Object.freeze([...roots]),
    allowedIdPrefixes: DEFAULT_ALLOWED_ID_PREFIXES,
  });
}

interface ClassifiedContent {
  readonly opaque: boolean;
  readonly findings: readonly Readonly<ManagedEvidenceCaptureFinding>[];
}

/** opaque 字节不扫描；文本成员的每条命中带成员引用与行号。 */
function classifyContent(
  bytes: Uint8Array,
  ref: PortableResourcePath,
  policy: PrivacyScanPolicy,
): Readonly<ClassifiedContent> {
  let text: string;
  try {
    text = decodeUtf8(bytes, "$content");
  } catch (error: unknown) {
    if (error instanceof Utf8Error) return Object.freeze({ opaque: true, findings: [] });
    throw error;
  }
  if (NON_TEXT_CONTROL_PATTERN.test(text)) return Object.freeze({ opaque: true, findings: [] });
  return Object.freeze({
    opaque: false,
    findings: Object.freeze(
      scanPrivacy(text, policy).map((finding) =>
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
  return sorted.filter(
    (finding, index) => index === 0 || compareFinding(sorted[index - 1]!, finding) !== 0,
  );
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
    privacyFindings: Object.freeze(
      findings.filter((finding) => !CREDENTIAL_PRIVACY_FINDING_KINDS.includes(finding.kind)),
    ),
    credentialFindings: Object.freeze(
      findings.filter((finding) => CREDENTIAL_PRIVACY_FINDING_KINDS.includes(finding.kind)),
    ),
  });
}

/**
 * 内容阻塞项（能力卡 8 Q1，切片 8 D3）：凭证类命中永远阻塞；opaque 成员与非凭证类命中只在
 * `reject` 策略下阻塞；超过记录容量的非凭证类命中不能被确认。
 */
export function deriveManagedEvidenceContentBlockers(
  review: Readonly<ManagedEvidenceCaptureReview>,
  policy: ManagedEvidenceContentReviewPolicy,
): readonly string[] {
  const blockers: string[] = [];
  for (const finding of review.credentialFindings) {
    blockers.push(`privacy:${finding.kind}:${finding.ref}:${finding.line}`);
  }
  if (review.privacyFindings.length > MANAGED_EVIDENCE_PRIVACY_FINDING_LIMIT) {
    blockers.push(`privacy-findings-overflow:${review.privacyFindings.length}`);
  }
  if (policy === "reject") {
    for (const ref of review.opaqueFileRefs) blockers.push(`opaque-content:${ref}`);
    for (const finding of review.privacyFindings) {
      blockers.push(`privacy:${finding.kind}:${finding.ref}:${finding.line}`);
    }
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
  policy: PrivacyScanPolicy,
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
  const content = classifyContent(read.bytes, CAPTURED_FILE_REF, policy);
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
  if (observation.node.kind !== "directory" || !sameFileNodeIdentity(observation.node, expectedNode)) {
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
  policy: PrivacyScanPolicy,
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
        return Object.freeze({ ref: file.ref, content: classifyContent(read.bytes, file.ref, policy) });
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
  policy: PrivacyScanPolicy,
  signal: AbortSignal | undefined,
): Promise<Readonly<CapturedSource>> {
  const treeRoot = await openSelectedTreeRoot(sourceRoot, source, expectedNode);
  let result: Readonly<CapturedSource> | undefined;
  let failure: unknown;
  try {
    const first = await inspectTreeIdentity(treeRoot, signal);
    const review = await classifyTreeFiles(treeRoot, first, policy, signal);
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
  policy: PrivacyScanPolicy,
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
    if (error instanceof WakeflowError && error.reason === "aborted") fail("aborted", error);
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
        ? await captureFile(sourceRoot, source, observation.node, policy, signal)
        : await captureTree(sourceRoot, source, observation.node, policy, signal);
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
  policy: PrivacyScanPolicy,
): Readonly<CapturedSource> {
  const projection = encodeManagedEvidenceSourceProjection(source);
  const findings =
    source.kind === "link"
      ? scanPrivacy(source.url, policy).map((finding) =>
          Object.freeze({ ref: CAPTURED_FILE_REF, line: finding.line, kind: finding.kind }),
        )
      : [];
  return Object.freeze({
    identity: singleFileIdentity(projection.byteCount, projection.digest, false),
    source,
    review: reviewOf([{ ref: CAPTURED_FILE_REF, content: { opaque: false, findings } }]),
  });
}

async function captureObservation(
  workspaceRoot: RootedDirectory,
  selection: Readonly<ManagedEvidenceSourceSelection>,
  source: Extract<ManagedEvidenceSourceSelection["source"], { readonly kind: "observation" }>,
  policy: PrivacyScanPolicy,
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
  return captureProjection(projected, policy);
}

async function captureSelectedSource(
  workspaceRoot: RootedDirectory,
  config: Readonly<WakeflowConfigAuthoritySnapshot>,
  selection: Readonly<ManagedEvidenceSourceSelection>,
  worktreePaths: readonly string[],
  signal: AbortSignal | undefined,
): Promise<Readonly<CapturedSource>> {
  const policy = managedEvidencePrivacyPolicy(workspaceRoot, config, worktreePaths);
  const source = selection.source;
  switch (source.kind) {
    case "managed-path":
      return captureManagedPath(workspaceRoot, config, source, policy, signal);
    case "observation":
      return captureObservation(workspaceRoot, selection, source, policy, signal);
    case "link":
      return captureProjection(source, policy);
    case "commit":
      if (config.indexes.repositoryById[source.repositoryId] === undefined) fail("source-root");
      return captureProjection(source, policy);
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
      if (error.reason === "aborted") fail("aborted", error);
      if (error.reason === "stale-config") fail("config", error);
      fail("demand", error);
    }
    if (error instanceof DemandEventSourcingRootAuthorityError) {
      if (error.reason === "aborted") fail("aborted", error);
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

function manifestFindings(
  review: Readonly<ManagedEvidenceCaptureReview>,
): readonly Readonly<ManagedEvidencePrivacyFinding>[] {
  return Object.freeze(
    review.privacyFindings.flatMap((finding) =>
      finding.kind === "unlisted-absolute-path" || finding.kind === "bare-uuid"
        ? [Object.freeze({ ref: finding.ref, line: finding.line, kind: finding.kind })]
        : [],
    ),
  );
}

function createManifest(
  context: Readonly<DemandOperationAuthorityContext>,
  demandId: WakeflowDurableId<"demand">,
  selection: Readonly<ManagedEvidenceSourceSelection>,
  captured: Readonly<CapturedSource>,
  clock: UtcWallClock | undefined,
): Readonly<ManagedEvidenceManifest> {
  const needsReview =
    captured.review.opaqueFileRefs.length > 0 || captured.review.privacyFindings.length > 0;
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
          privacyFindings: manifestFindings(captured.review),
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
    if (
      typeof workspaceRoot !== "object" ||
      workspaceRoot === null ||
      types.isProxy(workspaceRoot) ||
      !(workspaceRoot instanceof RootedDirectory)
    ) {
      fail("input");
    }
    this.#workspaceRoot = workspaceRoot;
  }

  /**
   * 读取当前 Authority 与来源，返回不含任何持久副作用的捕获结果：内容阻塞时返回阻塞项而不
   * 读时钟，否则返回完整 capture plan。
   */
  async preview(
    demandIdValue: unknown,
    selectionValue: unknown,
    optionsValue: ManagedEvidenceCapturePlanningOptions = {},
  ): Promise<ManagedEvidenceCapturePreview> {
    const options = parseOptions(optionsValue);
    assertNotAborted(options.signal);
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
      // Demand 所在 pod 的 worktree 检出路径进入隐私白名单：测试输出里出现自己的检出不算泄露。
      const workspaceRoot = this.#workspaceRoot;
      const podId = context.loaded.identity.podId;
      const worktreePaths = (
        await readKernelSource(
          () =>
            listPodWorktreeReceiptsAnyHost(
              workspaceRoot,
              podId,
              options.signal === undefined ? {} : { signal: options.signal },
            ),
          options.signal,
        )
      ).map((receipt) => receipt.path);
      const captured = await captureSelectedSource(
        this.#workspaceRoot,
        context.config,
        selection,
        worktreePaths,
        options.signal,
      );
      const blockers = deriveManagedEvidenceContentBlockers(captured.review, selection.contentReview);
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
