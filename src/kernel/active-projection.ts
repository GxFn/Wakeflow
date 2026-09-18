import { rmdir } from "node:fs/promises";
import path from "node:path";

import { computeCanonicalJsonSha256Digest } from "../foundation/crypto/canonical-json-sha256.js";
import { computeSha256Digest, type Sha256Digest } from "../foundation/crypto/sha256.js";
import type { JsonValue } from "../foundation/data/json-value.js";
import {
  createDirectoryAtomically,
  DurableDirectoryMaterializationError,
  materializeDirectoryPath,
} from "../foundation/filesystem/durable-directory-materialization.js";
import {
  DurableAtomicFileStageRecoveryError,
  recoverDurableAtomicFileStagesForTargets,
} from "../foundation/filesystem/durable-atomic-file-stage-recovery.js";
import {
  createFileAtomically,
  DurableAtomicFileWriteError,
  replaceFileAtomically,
} from "../foundation/filesystem/durable-atomic-file-write.js";
import {
  ExactRegularFileUnlinkError,
  unlinkRegularFileExactly,
} from "../foundation/filesystem/exact-regular-file-unlink.js";
import type { FileNodeSnapshot } from "../foundation/filesystem/file-node-snapshot.js";
import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../foundation/filesystem/portable-resource-path.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../foundation/filesystem/rooted-directory.js";
import {
  inspectRootedExclusiveFileLock,
  retireRootedExclusiveFileLockResidue,
  RootedExclusiveFileLockError,
  withRootedExclusiveFileLock,
} from "../foundation/filesystem/rooted-exclusive-file-lock.js";
import {
  readStableResourceDirectory,
  StableDirectoryReadError,
} from "../foundation/filesystem/stable-directory-read.js";
import {
  StableFileReadError,
  type StableFileSource,
} from "../foundation/filesystem/stable-file-read.js";
import {
  readStrictTextFile,
  StrictTextFileError,
} from "../foundation/filesystem/strict-text-file.js";
import { parseByteCount } from "../foundation/numeric/byte-count.js";
import { encodeUtf8 } from "../foundation/text/utf8.js";
import { fail } from "./error.js";
import {
  demandProjectionIndexRef,
  demandProjectionProgressRef,
  demandProjectionRootRef,
  WAKEFLOW_ACTIVE_CURRENT_ROOT_REF,
  WAKEFLOW_ACTIVE_PROJECTION_LOCK_REF,
  WAKEFLOW_ACTIVE_PROJECTIONS_ROOT_REF,
  WAKEFLOW_ACTIVE_ROOT_REF,
  WAKEFLOW_ACTIVE_WORKSPACE_INDEX_REF,
  WAKEFLOW_ACTIVE_WORKSPACE_STATUS_REF,
} from "./layout.js";

/**
 * Wakeflow Kernel / Active Projection：`.wakeflow-active` 的两级容器与人读投影（能力卡 9 §9.4，
 * gate-log §13.94 D5）。
 *
 * 容器：`.wakeflow-active` 与 `current` 两个 0700 目录由维护事务独占创建，这里提供检查与
 * 物化。投影：工作区索引、工作区当前状态、每个活动 Demand 的索引与进度页，全部由一份
 * 纯数据事实渲染，文件带 `<!-- wakeflow:…-projection:v1:sha256:<指纹> -->` 标记，0600，
 * 单文件上限 8 MiB。目标分四类：current、missing、stale（带标记但字节不同）、unsafe
 * （符号链接、非普通文件、硬链接数不为 1、不可读、超限或没有标记即手写）；任一目标 unsafe
 * 整轮零写。重写在投影短锁内逐文件 CAS；已不活动的 Demand 页面只在每个文件都带标记时退休。
 * 投影只是导航，机器记录才是权威；本模块不读配置、不读事件流，事实由调用方提供。
 */

const ACTIVE_PROJECTION_VERSION = 1 as const;
const ACTIVE_PROJECTION_FILE_MODE = 0o600 as const;
const ACTIVE_PROJECTION_DIRECTORY_MODE = 0o700 as const;
const ACTIVE_PROJECTION_MAXIMUM_BYTES = parseByteCount(
  8 * 1024 * 1024,
  "$activeProjection.maximumBytes",
);
const LOCK_TIMEOUT_MILLISECONDS = 10_000;
const DIRECTORY_MAXIMUM_ENTRIES = 4096;
const DEMAND_DIRECTORY_PATTERN =
  /^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MARKER_PATTERN = /<!-- wakeflow:(active|demand)-projection:v1:(sha256:[0-9a-f]{64}) -->/u;
const INLINE_MAXIMUM_LENGTH = 200;

type Signal = { readonly signal?: AbortSignal };

function signalOptions(signal: AbortSignal | undefined): Signal {
  return signal === undefined ? {} : { signal };
}

function assertRoot(root: unknown): asserts root is RootedDirectory {
  if (!(root instanceof RootedDirectory)) fail("invalid-request", "projection-root", "$root");
}

function currentUserId(): bigint | null {
  return typeof process.geteuid === "function" ? BigInt(process.geteuid()) : null;
}

// ---- 两级容器 ----------------------------------------------------------------

export interface ActiveLayoutEntryInspection {
  readonly resourcePath: PortableResourcePath;
  readonly status: "absent" | "current" | "conflict";
  readonly nodeDigest: Sha256Digest | null;
}

export interface ActiveLayoutInspection {
  readonly kind: "WakeflowActiveLayoutInspection";
  readonly status: "absent" | "incomplete" | "current" | "conflict";
  readonly entries: readonly Readonly<ActiveLayoutEntryInspection>[];
  readonly observationDigest: Sha256Digest;
}

function privateDirectoryCurrent(node: Readonly<FileNodeSnapshot>): boolean {
  const user = currentUserId();
  return (
    node.kind === "directory" &&
    node.permissionBits === ACTIVE_PROJECTION_DIRECTORY_MODE &&
    (user === null || node.userId === user)
  );
}

function nodeDigest(node: Readonly<FileNodeSnapshot>): Sha256Digest {
  return computeCanonicalJsonSha256Digest({
    kind: node.kind,
    deviceId: node.deviceId.toString(),
    inodeId: node.inodeId.toString(),
    permissionBits: node.permissionBits,
    userId: node.userId.toString(),
  });
}

async function inspectLayoutEntry(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
): Promise<Readonly<ActiveLayoutEntryInspection>> {
  try {
    const resource = await root.inspectExistingResource(resourcePath, "$activeLayout");
    return Object.freeze({
      resourcePath,
      status: privateDirectoryCurrent(resource.node) ? ("current" as const) : ("conflict" as const),
      nodeDigest: nodeDigest(resource.node),
    });
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError && error.reason === "resource-not-found") {
      return Object.freeze({ resourcePath, status: "absent" as const, nodeDigest: null });
    }
    if (error instanceof RootedDirectoryError) {
      fail("io-failure", "active-layout-root-scope", "$root", { cause: error });
    }
    throw error;
  }
}

/** 只检查 root/current 两个节点，不扫描任何活动业务聚合。 */
export async function inspectActiveLayout(
  root: RootedDirectory,
  options: Signal = {},
): Promise<Readonly<ActiveLayoutInspection>> {
  assertRoot(root);
  if (options.signal?.aborted === true) fail("io-failure", "aborted", "$signal");
  const active = await inspectLayoutEntry(root, WAKEFLOW_ACTIVE_ROOT_REF);
  const current = await inspectLayoutEntry(root, WAKEFLOW_ACTIVE_CURRENT_ROOT_REF);
  const status =
    active.status === "conflict" || current.status === "conflict"
      ? ("conflict" as const)
      : active.status === "absent" && current.status === "absent"
        ? ("absent" as const)
        : active.status === "current" && current.status === "current"
          ? ("current" as const)
          : ("incomplete" as const);
  const basis = {
    kind: "WakeflowActiveLayoutInspection" as const,
    status,
    entries: [active, current],
  };
  return Object.freeze({
    ...basis,
    entries: Object.freeze(basis.entries),
    observationDigest: computeCanonicalJsonSha256Digest(basis),
  });
}

/** 要求共享活动布局已由其 owner 完整建立。 */
export async function assertActiveLayoutCurrent(
  root: RootedDirectory,
  options: Signal = {},
): Promise<Readonly<ActiveLayoutInspection>> {
  const inspection = await inspectActiveLayout(root, options);
  if (inspection.status !== "current") {
    fail("precondition-failed", "active-layout-not-current", "$activeLayout");
  }
  return inspection;
}

export interface ActiveLayoutMaterializationEntry {
  readonly resourcePath: PortableResourcePath;
  readonly disposition: "created" | "current";
  readonly node: Readonly<FileNodeSnapshot>;
}

export interface ActiveLayoutMaterializationResult {
  readonly disposition: "created" | "current";
  readonly entries: readonly Readonly<ActiveLayoutMaterializationEntry>[];
}

async function existingLayoutDirectory(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  errorPath: string,
): Promise<Readonly<FileNodeSnapshot> | null> {
  try {
    return (await root.inspectExistingResource(resourcePath, errorPath)).node;
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError && error.reason === "resource-not-found") return null;
    if (error instanceof RootedDirectoryError) {
      fail("io-failure", "active-layout-root-scope", "$root", { cause: error });
    }
    throw error;
  }
}

async function createLayoutDirectory(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  errorPath: string,
  signal: AbortSignal | undefined,
): Promise<Readonly<FileNodeSnapshot>> {
  try {
    const created = await createDirectoryAtomically(root, resourcePath, {
      mode: ACTIVE_PROJECTION_DIRECTORY_MODE,
      ...signalOptions(signal),
    });
    return created.node;
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryMaterializationError) {
      if (error.reason === "aborted") fail("io-failure", "aborted", "$signal");
      fail("io-failure", `active-layout-${error.reason}`, errorPath, { cause: error });
    }
    throw error;
  }
}

async function ensureLayoutDirectory(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  recovering: boolean,
  signal: AbortSignal | undefined,
): Promise<Readonly<ActiveLayoutMaterializationEntry>> {
  const errorPath = `$activeLayout/${resourcePath}`;
  const existing = await existingLayoutDirectory(root, resourcePath, errorPath);
  const node = existing ?? (await createLayoutDirectory(root, resourcePath, errorPath, signal));
  if (!privateDirectoryCurrent(node)) {
    fail("precondition-failed", "active-layout-node-policy", errorPath);
  }
  if (existing !== null && !recovering) {
    fail("precondition-failed", "active-layout-exists", errorPath);
  }
  return Object.freeze({
    resourcePath,
    disposition: existing === null ? ("created" as const) : ("current" as const),
    node,
  });
}

/** 独占创建两级容器；`recovering` 时幂等补齐尚未发生的创建。 */
export async function materializeActiveLayout(
  root: RootedDirectory,
  options: Readonly<{ readonly recovering: boolean; readonly signal?: AbortSignal }>,
): Promise<Readonly<ActiveLayoutMaterializationResult>> {
  assertRoot(root);
  if (options.signal?.aborted === true) fail("io-failure", "aborted", "$signal");
  const active = await ensureLayoutDirectory(
    root,
    WAKEFLOW_ACTIVE_ROOT_REF,
    options.recovering,
    options.signal,
  );
  const current = await ensureLayoutDirectory(
    root,
    WAKEFLOW_ACTIVE_CURRENT_ROOT_REF,
    options.recovering,
    options.signal,
  );
  const entries = Object.freeze([active, current]);
  return Object.freeze({
    disposition: entries.some((entry) => entry.disposition === "created") ? "created" : "current",
    entries,
  });
}

// ---- 事实与渲染 --------------------------------------------------------------

export type ActiveProjectionLanguage = "en" | "zh-Hans";

export interface ActiveProjectionPodFacts {
  readonly podId: string;
  readonly name: string;
  readonly placement: "primary" | "worktree";
  readonly lifecycle: "open" | "closing";
  readonly activeDemandId: string | null;
  readonly worktrees: readonly Readonly<{
    readonly repositoryId: string;
    readonly repositoryName: string;
    readonly receipt: "absent" | "present" | "checkout-missing";
  }>[];
}

export interface ActiveProjectionRouteFacts {
  readonly disposition: string;
  readonly frontier: string | null;
  readonly owner: string;
  readonly suggestedTool: string | null;
  readonly blockers: readonly string[];
}

export interface ActiveProjectionTargetFacts {
  readonly targetTaskId: string;
  readonly workType: "implementation" | "test";
  readonly phase: string;
  readonly repositoryId: string | null;
  readonly windowId: string;
}

export interface ActiveProjectionProgressFacts {
  readonly implementationTargets: number;
  readonly implementationAccepted: number;
  readonly deliveriesInFlight: number;
  readonly resultsAwaitingReview: number;
  readonly testTargets: number;
  readonly testAccepted: number;
}

export interface ActiveProjectionDemandFacts {
  readonly demandId: string;
  readonly title: string;
  readonly demandType: string;
  readonly podId: string;
  readonly podName: string;
  readonly lifecycle: string;
  readonly streamRevision: number;
  readonly stateDigest: Sha256Digest;
  readonly reviewSnapshotDigest: Sha256Digest;
  readonly route: Readonly<ActiveProjectionRouteFacts>;
  readonly progress: Readonly<ActiveProjectionProgressFacts>;
  readonly targets: readonly Readonly<ActiveProjectionTargetFacts>[];
  readonly lastEventId: string | null;
  readonly awaitingDecision: string | null;
  readonly evidenceCount: number;
}

export interface ActiveProjectionUnmergedFacts {
  readonly demandId: string;
  readonly targetTaskId: string;
  readonly repositoryId: string;
  readonly branch: string;
  readonly commit: string;
}

/** 渲染投影所需的全部事实；纯数据，不含路径、句柄或摘要之外的私有值。 */
export interface ActiveProjectionFacts {
  readonly language: ActiveProjectionLanguage;
  readonly program: Readonly<{ readonly programId: string; readonly displayName: string }>;
  readonly configDigest: Sha256Digest;
  readonly pods: readonly Readonly<ActiveProjectionPodFacts>[];
  readonly unmergedAccepted: readonly Readonly<ActiveProjectionUnmergedFacts>[];
  readonly demands: readonly Readonly<ActiveProjectionDemandFacts>[];
}

export interface ActiveProjectionFile {
  readonly resourcePath: PortableResourcePath;
  readonly kind: "workspace" | "demand";
  readonly demandId: string | null;
  readonly fingerprint: Sha256Digest;
  readonly content: string;
  readonly bytes: Uint8Array;
  readonly digest: Sha256Digest;
}

const TEXT = Object.freeze({
  en: Object.freeze({
    indexTitle: "Wakeflow Active Workspace",
    statusTitle: "Workspace Current Status",
    notice:
      "Generated projection only. Config, requirement packages, and Demand event streams remain authoritative; do not edit by hand.",
    program: "Program",
    programId: "Program ID",
    status: "Current status",
    board: "Requirement board",
    demands: "Active demands",
    noDemands: "No active Demand.",
    source: "Projection source",
    pods: "Pods",
    podHeader: "| Pod | Placement | Lifecycle | Active demand | Worktrees |",
    demandHeader: "| Demand | Title | Type | Pod | Disposition | Frontier | Owner |",
    unmerged: "Accepted results whose branch still exists",
    unmergedHeader: "| Demand | Target | Repository | Branch | Commit |",
    none: "none",
    back: "Active workspace index",
    demandIndex: "Demand",
    progress: "Developer progress",
    route: "Route",
    frontier: "Frontier",
    owner: "Owner",
    tool: "Suggested tool",
    blockers: "Blockers",
    targets: "Targets",
    targetHeader: "| Target | Work type | Phase | Repository | Window |",
    counts: "Progress counts",
    implementationTargets: "Implementation targets",
    implementationAccepted: "Implementation accepted",
    deliveriesInFlight: "Deliveries in flight",
    resultsAwaitingReview: "Results awaiting review",
    testTargets: "Test targets",
    testAccepted: "Test accepted",
    lastEvent: "Last event",
    streamRevision: "Stream revision",
    awaitingDecision: "Awaiting user decision",
    evidence: "Managed evidence records",
    lifecycle: "Lifecycle",
  }),
  "zh-Hans": Object.freeze({
    indexTitle: "Wakeflow 活动工作区",
    statusTitle: "工作区当前状态",
    notice: "仅为生成式投影。Config、需求包与 Demand 事件流仍是权威；请勿手改。",
    program: "程序",
    programId: "程序 ID",
    status: "当前状态",
    board: "需求看板",
    demands: "活动 Demand",
    noDemands: "当前没有活动 Demand。",
    source: "投影来源",
    pods: "Pod",
    podHeader: "| Pod | 位置 | 生命周期 | 活动 Demand | Worktree |",
    demandHeader: "| Demand | 标题 | 类型 | Pod | 处置 | 前沿 | 责任方 |",
    unmerged: "已接受但分支仍在的结果",
    unmergedHeader: "| Demand | 目标 | 仓库 | 分支 | 提交 |",
    none: "无",
    back: "活动工作区索引",
    demandIndex: "Demand",
    progress: "开发进度",
    route: "路由",
    frontier: "前沿",
    owner: "责任方",
    tool: "建议工具",
    blockers: "阻塞",
    targets: "目标",
    targetHeader: "| 目标 | 工作类型 | 阶段 | 仓库 | 窗口 |",
    counts: "进度计数",
    implementationTargets: "实现目标",
    implementationAccepted: "实现已接受",
    deliveriesInFlight: "投递进行中",
    resultsAwaitingReview: "待评审结果",
    testTargets: "测试目标",
    testAccepted: "测试已接受",
    lastEvent: "最近事件",
    streamRevision: "事件流修订",
    awaitingDecision: "等待用户决定",
    evidence: "受管证据记录",
    lifecycle: "生命周期",
  }),
});

/** 控制字符、删除符、C1 控制符与两个 Unicode 行终止符都不能进入单行文本。 */
function isControlCodePoint(codePoint: number): boolean {
  return (
    codePoint < 0x20 ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    codePoint === 0x2028 ||
    codePoint === 0x2029
  );
}

/** 单行文本：去掉控制字符与表格分隔符，压缩空白，有界。 */
function inline(value: string): string {
  let stripped = "";
  for (const character of value) {
    stripped += isControlCodePoint(character.codePointAt(0) ?? 0) ? " " : character;
  }
  const cleaned = stripped.replace(/\|/gu, "\\|").replace(/\s+/gu, " ").trim();
  return cleaned.length > INLINE_MAXIMUM_LENGTH
    ? `${cleaned.slice(0, INLINE_MAXIMUM_LENGTH - 1)}…`
    : cleaned;
}

function code(value: string): string {
  return `\`${inline(value).replace(/`/gu, "'")}\``;
}

function marker(kind: "active" | "demand", fingerprint: Sha256Digest): string {
  return `<!-- wakeflow:${kind}-projection:v${ACTIVE_PROJECTION_VERSION}:${fingerprint} -->`;
}

function fingerprintOf(basis: JsonValue): Sha256Digest {
  return computeCanonicalJsonSha256Digest({
    kind: "WakeflowActiveProjectionFingerprint",
    version: ACTIVE_PROJECTION_VERSION,
    basis,
  });
}

function workspaceFingerprint(facts: Readonly<ActiveProjectionFacts>): Sha256Digest {
  return fingerprintOf({
    language: facts.language,
    configDigest: facts.configDigest,
    pods: facts.pods.map((pod) => ({
      podId: pod.podId,
      name: pod.name,
      placement: pod.placement,
      lifecycle: pod.lifecycle,
      activeDemandId: pod.activeDemandId,
      worktrees: pod.worktrees.map((worktree) => ({ ...worktree })),
    })),
    unmergedAccepted: facts.unmergedAccepted.map((entry) => ({ ...entry })),
    demands: facts.demands.map((demand) => ({
      demandId: demand.demandId,
      title: demand.title,
      demandType: demand.demandType,
      podId: demand.podId,
      streamRevision: demand.streamRevision,
      stateDigest: demand.stateDigest,
      reviewSnapshotDigest: demand.reviewSnapshotDigest,
      route: { ...demand.route, blockers: [...demand.route.blockers] },
    })),
  });
}

function demandFingerprint(
  language: ActiveProjectionLanguage,
  demand: Readonly<ActiveProjectionDemandFacts>,
): Sha256Digest {
  return fingerprintOf({
    language,
    demandId: demand.demandId,
    streamRevision: demand.streamRevision,
    stateDigest: demand.stateDigest,
    reviewSnapshotDigest: demand.reviewSnapshotDigest,
    podName: demand.podName,
    route: { ...demand.route, blockers: [...demand.route.blockers] },
    awaitingDecision: demand.awaitingDecision,
    evidenceCount: demand.evidenceCount,
  });
}

function relativeFromActive(resourcePath: PortableResourcePath): string {
  return resourcePath.slice(`${WAKEFLOW_ACTIVE_ROOT_REF}/`.length);
}

function renderIndex(facts: Readonly<ActiveProjectionFacts>, fingerprint: Sha256Digest): string {
  const text = TEXT[facts.language];
  const demands =
    facts.demands.length === 0
      ? [text.noDemands]
      : facts.demands.map(
          (demand) =>
            `- [${inline(demand.title)}](${relativeFromActive(demandProjectionIndexRef(demand.demandId))}) · ${code(demand.demandId)} · ${inline(demand.route.disposition)}`,
        );
  return `${[
    `# ${text.indexTitle}`,
    "",
    marker("active", fingerprint),
    "",
    `> ${text.notice}`,
    "",
    `- ${text.program}: ${inline(facts.program.displayName)}`,
    `- ${text.programId}: ${code(facts.program.programId)}`,
    `- [${text.status}](${relativeFromActive(WAKEFLOW_ACTIVE_WORKSPACE_STATUS_REF)})`,
    `- [${text.board}](current/board/index.md)`,
    "",
    `## ${text.demands}`,
    "",
    ...demands,
  ].join("\n")}\n`;
}

function renderStatus(facts: Readonly<ActiveProjectionFacts>, fingerprint: Sha256Digest): string {
  const text = TEXT[facts.language];
  const pods = facts.pods.map(
    (pod) =>
      `| ${inline(pod.name)} ${code(pod.podId)} | ${pod.placement} | ${pod.lifecycle} | ${pod.activeDemandId === null ? text.none : code(pod.activeDemandId)} | ${
        pod.worktrees.length === 0
          ? text.none
          : pod.worktrees
              .map((worktree) => `${inline(worktree.repositoryName)}: ${worktree.receipt}`)
              .join(", ")
      } |`,
  );
  const demands = facts.demands.map(
    (demand) =>
      `| [${code(demand.demandId)}](../${relativeFromActive(demandProjectionIndexRef(demand.demandId))}) | ${inline(demand.title)} | ${demand.demandType} | ${inline(demand.podName)} | ${demand.route.disposition} | ${demand.route.frontier ?? "—"} | ${demand.route.owner} |`,
  );
  const unmerged = facts.unmergedAccepted.map(
    (entry) =>
      `| ${code(entry.demandId)} | ${code(entry.targetTaskId)} | ${code(entry.repositoryId)} | ${code(entry.branch)} | ${code(entry.commit)} |`,
  );
  return `${[
    `# ${text.statusTitle}`,
    "",
    marker("active", fingerprint),
    "",
    `> ${text.notice}`,
    "",
    `- ${text.programId}: ${code(facts.program.programId)}`,
    `- ${text.source}: ${code(facts.configDigest)}`,
    "",
    `## ${text.pods}`,
    "",
    text.podHeader,
    "| --- | --- | --- | --- | --- |",
    ...pods,
    "",
    `## ${text.demands}`,
    "",
    ...(demands.length === 0
      ? [text.noDemands]
      : [text.demandHeader, "| --- | --- | --- | --- | --- | --- | --- |", ...demands]),
    "",
    `## ${text.unmerged}`,
    "",
    ...(unmerged.length === 0
      ? [text.none]
      : [text.unmergedHeader, "| --- | --- | --- | --- | --- |", ...unmerged]),
    "",
    `[${text.back}](../index.md)`,
  ].join("\n")}\n`;
}

function renderDemandIndex(
  language: ActiveProjectionLanguage,
  demand: Readonly<ActiveProjectionDemandFacts>,
  fingerprint: Sha256Digest,
): string {
  const text = TEXT[language];
  const targets = demand.targets.map(
    (target) =>
      `| ${code(target.targetTaskId)} | ${target.workType} | ${target.phase} | ${target.repositoryId === null ? "—" : code(target.repositoryId)} | ${code(target.windowId)} |`,
  );
  return `${[
    `# ${text.demandIndex}: ${inline(demand.title)}`,
    "",
    marker("demand", fingerprint),
    "",
    `> ${text.notice}`,
    "",
    `- Demand: ${code(demand.demandId)} (${demand.demandType})`,
    `- ${text.pods}: ${inline(demand.podName)} ${code(demand.podId)}`,
    `- ${text.lifecycle}: ${demand.lifecycle}`,
    `- ${text.streamRevision}: ${demand.streamRevision}`,
    `- [${text.progress}](developer-progress.md)`,
    "",
    `## ${text.route}`,
    "",
    `- ${text.status}: ${demand.route.disposition}`,
    `- ${text.frontier}: ${demand.route.frontier ?? "—"}`,
    `- ${text.owner}: ${demand.route.owner}`,
    `- ${text.tool}: ${demand.route.suggestedTool === null ? "—" : code(demand.route.suggestedTool)}`,
    `- ${text.blockers}: ${demand.route.blockers.length === 0 ? text.none : demand.route.blockers.map(inline).join(", ")}`,
    "",
    `## ${text.targets}`,
    "",
    ...(targets.length === 0
      ? [text.none]
      : [text.targetHeader, "| --- | --- | --- | --- | --- |", ...targets]),
    "",
    `[${text.back}](../../index.md)`,
  ].join("\n")}\n`;
}

function renderDemandProgress(
  language: ActiveProjectionLanguage,
  demand: Readonly<ActiveProjectionDemandFacts>,
  fingerprint: Sha256Digest,
): string {
  const text = TEXT[language];
  const progress = demand.progress;
  return `${[
    `# ${text.progress}: ${inline(demand.title)}`,
    "",
    marker("demand", fingerprint),
    "",
    `> ${text.notice}`,
    "",
    `- Demand: ${code(demand.demandId)}`,
    `- ${text.status}: ${demand.route.disposition} · ${demand.route.frontier ?? "—"} · ${demand.route.owner}`,
    `- ${text.awaitingDecision}: ${demand.awaitingDecision === null ? text.none : inline(demand.awaitingDecision)}`,
    "",
    `## ${text.counts}`,
    "",
    `- ${text.implementationTargets}: ${progress.implementationTargets}`,
    `- ${text.implementationAccepted}: ${progress.implementationAccepted}`,
    `- ${text.deliveriesInFlight}: ${progress.deliveriesInFlight}`,
    `- ${text.resultsAwaitingReview}: ${progress.resultsAwaitingReview}`,
    `- ${text.testTargets}: ${progress.testTargets}`,
    `- ${text.testAccepted}: ${progress.testAccepted}`,
    "",
    `- ${text.evidence}: ${demand.evidenceCount}`,
    `- ${text.lastEvent}: ${demand.lastEventId === null ? text.none : code(demand.lastEventId)} · ${text.streamRevision} ${demand.streamRevision}`,
    "",
    `[${text.demandIndex}](index.md)`,
  ].join("\n")}\n`;
}

function file(
  resourcePath: PortableResourcePath,
  kind: ActiveProjectionFile["kind"],
  demandId: string | null,
  fingerprint: Sha256Digest,
  content: string,
): Readonly<ActiveProjectionFile> {
  const bytes = encodeUtf8(content, `$projection/${resourcePath}`);
  if (bytes.byteLength > ACTIVE_PROJECTION_MAXIMUM_BYTES) {
    fail("capacity-exceeded", "projection-bytes", `$projection/${resourcePath}`);
  }
  return Object.freeze({
    resourcePath,
    kind,
    demandId,
    fingerprint,
    content,
    bytes,
    digest: computeSha256Digest(bytes, `$projection/${resourcePath}`),
  });
}

/** 从事实渲染全部投影文件：两份工作区页面加每个活动 Demand 的两份页面。 */
export function renderActiveProjectionFiles(
  facts: Readonly<ActiveProjectionFacts>,
): readonly Readonly<ActiveProjectionFile>[] {
  const fingerprint = workspaceFingerprint(facts);
  const files = [
    file(
      WAKEFLOW_ACTIVE_WORKSPACE_INDEX_REF,
      "workspace",
      null,
      fingerprint,
      renderIndex(facts, fingerprint),
    ),
    file(
      WAKEFLOW_ACTIVE_WORKSPACE_STATUS_REF,
      "workspace",
      null,
      fingerprint,
      renderStatus(facts, fingerprint),
    ),
  ];
  for (const demand of facts.demands) {
    const demandPrint = demandFingerprint(facts.language, demand);
    files.push(
      file(
        demandProjectionIndexRef(demand.demandId),
        "demand",
        demand.demandId,
        demandPrint,
        renderDemandIndex(facts.language, demand, demandPrint),
      ),
      file(
        demandProjectionProgressRef(demand.demandId),
        "demand",
        demand.demandId,
        demandPrint,
        renderDemandProgress(facts.language, demand, demandPrint),
      ),
    );
  }
  return Object.freeze(files);
}

/** 一组投影文件的确定性摘要：维护计划用它做步骤目标。 */
export function computeActiveProjectionSetDigest(
  files: readonly Readonly<ActiveProjectionFile>[],
): Sha256Digest {
  return computeCanonicalJsonSha256Digest({
    kind: "WakeflowActiveProjectionSet",
    version: ACTIVE_PROJECTION_VERSION,
    files: files.map((entry) => ({ resourcePath: entry.resourcePath, digest: entry.digest })),
  });
}

/** 空工作区（fresh 初始化）的事实：只有配置里的 pod，没有 Demand。 */
export function freshActiveProjectionFacts(
  input: Readonly<{
    readonly language: ActiveProjectionLanguage;
    readonly program: Readonly<{ readonly programId: string; readonly displayName: string }>;
    readonly configDigest: Sha256Digest;
    readonly pods: readonly Readonly<{
      readonly podId: string;
      readonly name: string;
      readonly placement: "primary" | "worktree";
      readonly lifecycle: "open" | "closing";
      readonly worktrees: readonly Readonly<{
        readonly repositoryId: string;
        readonly repositoryName: string;
      }>[];
    }>[];
  }>,
): Readonly<ActiveProjectionFacts> {
  return Object.freeze({
    language: input.language,
    program: input.program,
    configDigest: input.configDigest,
    pods: Object.freeze(
      input.pods.map((pod) =>
        Object.freeze({
          podId: pod.podId,
          name: pod.name,
          placement: pod.placement,
          lifecycle: pod.lifecycle,
          activeDemandId: null,
          worktrees: Object.freeze(
            pod.worktrees.map((worktree) =>
              Object.freeze({ ...worktree, receipt: "absent" as const }),
            ),
          ),
        }),
      ),
    ),
    unmergedAccepted: Object.freeze([]),
    demands: Object.freeze([]),
  });
}

// ---- 目标检查与发布 ------------------------------------------------------------

export type ActiveProjectionTargetStatus = "current" | "missing" | "stale" | "unsafe";

export interface ActiveProjectionTargetInspection {
  readonly resourcePath: PortableResourcePath;
  readonly status: ActiveProjectionTargetStatus;
  /** unsafe 的原因：`symlink`、`not-file`、`links`、`mode`、`owner`、`too-large`、`encoding`、`handwritten`、`io`。 */
  readonly reason: string | null;
  readonly source: Readonly<StableFileSource> | null;
  readonly currentDigest: Sha256Digest | null;
  readonly targetDigest: Sha256Digest;
}

function unsafe(
  resourcePath: PortableResourcePath,
  targetDigest: Sha256Digest,
  reason: string,
  source: Readonly<StableFileSource> | null = null,
): Readonly<ActiveProjectionTargetInspection> {
  return Object.freeze({
    resourcePath,
    status: "unsafe" as const,
    reason,
    source,
    currentDigest: source?.digest ?? null,
    targetDigest,
  });
}

/** 读失败的分类：缺失返回 `null`，中止与根作用域上抛，其余都是 unsafe 的原因。 */
function classifyReadFailure(error: unknown): string | null {
  if (error instanceof StableFileReadError) {
    if (error.reason === "not-found") return null;
    if (error.reason === "aborted") fail("io-failure", "aborted", "$signal");
    if (error.reason === "root-scope") {
      fail("io-failure", "projection-root-scope", "$root", { cause: error });
    }
    return error.reason === "symlink" || error.reason === "not-file" || error.reason === "too-large"
      ? error.reason
      : "io";
  }
  if (error instanceof StrictTextFileError) return "encoding";
  throw error;
}

/** 节点策略：单链接、0600、当前用户所有；违反即 unsafe 的原因。 */
function nodePolicyViolation(node: Readonly<FileNodeSnapshot>): string | null {
  if (node.linkCount !== 1n) return "links";
  if (node.permissionBits !== ACTIVE_PROJECTION_FILE_MODE) return "mode";
  const user = currentUserId();
  if (user !== null && node.userId !== user) return "owner";
  return null;
}

async function inspectTarget(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
  targetDigest: Sha256Digest,
  signal: AbortSignal | undefined,
): Promise<Readonly<ActiveProjectionTargetInspection>> {
  let read: Awaited<ReturnType<typeof readStrictTextFile>>;
  try {
    read = await readStrictTextFile(root, resourcePath, {
      maximumBytes: ACTIVE_PROJECTION_MAXIMUM_BYTES,
      ...signalOptions(signal),
    });
  } catch (error: unknown) {
    const reason = classifyReadFailure(error);
    if (reason !== null) return unsafe(resourcePath, targetDigest, reason);
    return Object.freeze({
      resourcePath,
      status: "missing" as const,
      reason: null,
      source: null,
      currentDigest: null,
      targetDigest,
    });
  }
  const source: Readonly<StableFileSource> = Object.freeze({
    resourcePath: read.resourcePath,
    node: read.node,
    byteCount: read.byteCount,
    digest: read.digest,
  });
  const violation = nodePolicyViolation(read.node);
  if (violation !== null) return unsafe(resourcePath, targetDigest, violation, source);
  if (read.digest !== targetDigest && !MARKER_PATTERN.test(read.text)) {
    return unsafe(resourcePath, targetDigest, "handwritten", source);
  }
  return Object.freeze({
    resourcePath,
    status: read.digest === targetDigest ? ("current" as const) : ("stale" as const),
    reason: null,
    source,
    currentDigest: read.digest,
    targetDigest,
  });
}

/** 零写检查每个目标文件的分类。 */
export async function inspectActiveProjectionTargets(
  root: RootedDirectory,
  files: readonly Readonly<ActiveProjectionFile>[],
  options: Signal = {},
): Promise<readonly Readonly<ActiveProjectionTargetInspection>[]> {
  assertRoot(root);
  const targets: Readonly<ActiveProjectionTargetInspection>[] = [];
  for (const entry of files) {
    targets.push(await inspectTarget(root, entry.resourcePath, entry.digest, options.signal));
  }
  return Object.freeze(targets);
}

export interface ActiveProjectionRetiredDirectory {
  readonly demandId: string;
  readonly disposition: "retired" | "unsafe";
}

export interface ActiveProjectionPublicationReceipt {
  readonly disposition: "current" | "created" | "updated" | "unsafe";
  readonly targets: readonly Readonly<ActiveProjectionTargetInspection>[];
  readonly retired: readonly Readonly<ActiveProjectionRetiredDirectory>[];
  readonly observationDigest: Sha256Digest;
}

export interface PublishActiveProjectionOptions {
  readonly signal?: AbortSignal;
  /** 维护事务的 affected-step 恢复：先退休失活的锁与遗留暂存文件。 */
  readonly recovering?: boolean;
}

function mapWriteError(error: DurableAtomicFileWriteError): never {
  if (error.reason === "aborted") fail("io-failure", "aborted", "$signal");
  if (
    error.reason === "target-exists" ||
    error.reason === "expectation-changed" ||
    error.reason === "expectation-read-failure"
  ) {
    fail("io-failure", "projection-contended", "$projection", { cause: error, retryable: true });
  }
  fail("io-failure", `projection-write-${error.reason}`, "$projection", { cause: error });
}

async function ensureProjectionDirectories(
  root: RootedDirectory,
  files: readonly Readonly<ActiveProjectionFile>[],
  signal: AbortSignal | undefined,
): Promise<void> {
  const directories = new Set<PortableResourcePath>();
  for (const entry of files) {
    if (entry.demandId !== null) directories.add(demandProjectionRootRef(entry.demandId));
  }
  for (const directory of directories) {
    try {
      await materializeDirectoryPath(root, directory, {
        mode: ACTIVE_PROJECTION_DIRECTORY_MODE,
        ...signalOptions(signal),
      });
    } catch (error: unknown) {
      if (error instanceof DurableDirectoryMaterializationError) {
        if (error.reason === "aborted") fail("io-failure", "aborted", "$signal");
        fail("io-failure", `projection-directory-${error.reason}`, `$projection/${directory}`, {
          cause: error,
        });
      }
      throw error;
    }
  }
}

async function writeTarget(
  root: RootedDirectory,
  entry: Readonly<ActiveProjectionFile>,
  target: Readonly<ActiveProjectionTargetInspection>,
  signal: AbortSignal | undefined,
): Promise<"created" | "replaced" | null> {
  if (target.status === "current") return null;
  try {
    if (target.status === "missing") {
      await createFileAtomically(root, entry.resourcePath, entry.bytes, {
        mode: ACTIVE_PROJECTION_FILE_MODE,
        ...signalOptions(signal),
      });
      return "created";
    }
    if (target.source === null) fail("unexpected", "projection-source", "$projection");
    await replaceFileAtomically(root, entry.resourcePath, entry.bytes, {
      mode: ACTIVE_PROJECTION_FILE_MODE,
      expected: target.source,
      ...signalOptions(signal),
    });
    return "replaced";
  } catch (error: unknown) {
    if (error instanceof DurableAtomicFileWriteError) mapWriteError(error);
    throw error;
  }
}

async function listDemandProjectionDirectories(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<readonly string[]> {
  try {
    const listing = await readStableResourceDirectory(root, WAKEFLOW_ACTIVE_PROJECTIONS_ROOT_REF, {
      maximumEntries: DIRECTORY_MAXIMUM_ENTRIES,
      ...signalOptions(signal),
    });
    return Object.freeze(
      listing.entries
        .filter(
          (entry) => entry.node.kind === "directory" && DEMAND_DIRECTORY_PATTERN.test(entry.name),
        )
        .map((entry) => entry.name)
        .sort(),
    );
  } catch (error: unknown) {
    if (error instanceof StableDirectoryReadError && error.reason === "not-found") {
      return Object.freeze([]);
    }
    if (error instanceof StableDirectoryReadError) {
      if (error.reason === "aborted") fail("io-failure", "aborted", "$signal");
      fail("io-failure", `projection-listing-${error.reason}`, "$projection", { cause: error });
    }
    throw error;
  }
}

interface RetirableMember {
  readonly resourcePath: PortableResourcePath;
  readonly node: Readonly<FileNodeSnapshot>;
}

/** 一个带标记的普通单链接文件才是可退休成员；任何别的都让整个目录留下（`null`）。 */
async function retirableMember(
  root: RootedDirectory,
  entry: Readonly<{ readonly resourcePath: PortableResourcePath; readonly node: FileNodeSnapshot }>,
  signal: AbortSignal | undefined,
): Promise<RetirableMember | null> {
  if (entry.node.kind !== "file" || entry.node.linkCount !== 1n) return null;
  try {
    const read = await readStrictTextFile(root, entry.resourcePath, {
      maximumBytes: ACTIVE_PROJECTION_MAXIMUM_BYTES,
      ...signalOptions(signal),
    });
    return MARKER_PATTERN.test(read.text)
      ? { resourcePath: entry.resourcePath, node: read.node }
      : null;
  } catch (error: unknown) {
    if (error instanceof StableFileReadError && error.reason === "aborted") {
      fail("io-failure", "aborted", "$signal");
    }
    return null;
  }
}

async function retirableMembers(
  root: RootedDirectory,
  directory: PortableResourcePath,
  signal: AbortSignal | undefined,
): Promise<readonly RetirableMember[] | null> {
  let listing: Awaited<ReturnType<typeof readStableResourceDirectory>>;
  try {
    listing = await readStableResourceDirectory(root, directory, {
      maximumEntries: DIRECTORY_MAXIMUM_ENTRIES,
      ...signalOptions(signal),
    });
  } catch (error: unknown) {
    if (error instanceof StableDirectoryReadError && error.reason === "aborted") {
      fail("io-failure", "aborted", "$signal");
    }
    return null;
  }
  const members: RetirableMember[] = [];
  for (const entry of listing.entries) {
    const member = await retirableMember(root, entry, signal);
    if (member === null) return null;
    members.push(member);
  }
  return members;
}

async function unlinkMember(
  root: RootedDirectory,
  member: RetirableMember,
  directory: PortableResourcePath,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    await unlinkRegularFileExactly(root, member.resourcePath, {
      expectedNode: member.node,
      ...signalOptions(signal),
    });
  } catch (error: unknown) {
    if (error instanceof ExactRegularFileUnlinkError) {
      if (error.reason === "aborted") fail("io-failure", "aborted", "$signal");
      fail("io-failure", `projection-retire-${error.reason}`, `$projection/${directory}`, {
        cause: error,
      });
    }
    throw error;
  }
}

/** 退休一个已不活动的 Demand 页面目录：每个成员都必须是带标记的普通文件，否则整个目录留下。 */
async function retireDemandProjection(
  root: RootedDirectory,
  demandId: string,
  signal: AbortSignal | undefined,
): Promise<Readonly<ActiveProjectionRetiredDirectory>> {
  const directory = demandProjectionRootRef(demandId);
  const members = await retirableMembers(root, directory, signal);
  if (members === null) return Object.freeze({ demandId, disposition: "unsafe" as const });
  for (const member of members) await unlinkMember(root, member, directory, signal);
  try {
    await rmdir(path.join(root.absolutePath, ...directory.split("/")));
  } catch (error: unknown) {
    fail("io-failure", "projection-retire-directory", `$projection/${directory}`, {
      cause: error,
    });
  }
  return Object.freeze({ demandId, disposition: "retired" as const });
}

async function retireInactiveLock(root: RootedDirectory): Promise<void> {
  let lock: Awaited<ReturnType<typeof inspectRootedExclusiveFileLock>>;
  try {
    lock = await inspectRootedExclusiveFileLock(root, WAKEFLOW_ACTIVE_PROJECTION_LOCK_REF);
  } catch (error: unknown) {
    if (error instanceof RootedExclusiveFileLockError) {
      fail("io-failure", "projection-lock", "$projection", { cause: error });
    }
    throw error;
  }
  if (lock.status !== "held" || lock.ownerState !== "inactive") return;
  try {
    await retireRootedExclusiveFileLockResidue(root, WAKEFLOW_ACTIVE_PROJECTION_LOCK_REF, lock);
  } catch (error: unknown) {
    if (error instanceof RootedExclusiveFileLockError) {
      fail("io-failure", "projection-lock", "$projection", { cause: error });
    }
    throw error;
  }
}

/** 目标的父目录尚不存在（首次发布前的 Demand 页面目录）：那里不可能有暂存文件，无需退休。 */
async function stageParentPresent(
  root: RootedDirectory,
  resourcePath: PortableResourcePath,
): Promise<boolean> {
  const errorPath = `$projection/${resourcePath}`;
  const parent = parsePortableResourcePath(
    resourcePath.slice(0, resourcePath.lastIndexOf("/")),
    errorPath,
  );
  try {
    await root.inspectExistingResource(parent, errorPath);
    return true;
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError && error.reason === "resource-not-found")
      return false;
    if (error instanceof RootedDirectoryError) {
      fail("io-failure", "projection-stage", errorPath, { cause: error });
    }
    throw error;
  }
}

async function settleStages(
  root: RootedDirectory,
  files: readonly Readonly<ActiveProjectionFile>[],
  signal: AbortSignal | undefined,
): Promise<void> {
  for (const entry of files) {
    if (!(await stageParentPresent(root, entry.resourcePath))) continue;
    try {
      const recovery = await recoverDurableAtomicFileStagesForTargets(
        root,
        [entry.resourcePath],
        signalOptions(signal),
      );
      if (recovery.activeStageCount !== 0 || recovery.unknownStageCount !== 0) {
        fail("io-failure", "projection-stage-active", `$projection/${entry.resourcePath}`);
      }
    } catch (error: unknown) {
      if (error instanceof DurableAtomicFileStageRecoveryError) {
        if (error.reason === "aborted") fail("io-failure", "aborted", "$signal");
        fail("io-failure", "projection-stage", `$projection/${entry.resourcePath}`, {
          cause: error,
        });
      }
      throw error;
    }
  }
}

function mapLockError(error: RootedExclusiveFileLockError): never {
  if (error.reason === "aborted") fail("io-failure", "aborted", "$signal");
  if (error.reason === "timeout" || error.reason === "owner-active") {
    fail("io-failure", "projection-contended", "$projection", { cause: error, retryable: true });
  }
  fail("io-failure", `projection-lock-${error.reason}`, "$projection", { cause: error });
}

function receiptOf(
  disposition: ActiveProjectionPublicationReceipt["disposition"],
  targets: readonly Readonly<ActiveProjectionTargetInspection>[],
  retired: readonly Readonly<ActiveProjectionRetiredDirectory>[],
): Readonly<ActiveProjectionPublicationReceipt> {
  return Object.freeze({
    disposition,
    targets,
    retired,
    observationDigest: computeCanonicalJsonSha256Digest({
      kind: "WakeflowActiveProjectionPublication",
      disposition,
      targets: targets.map((target) => ({
        resourcePath: target.resourcePath,
        status: target.status,
        reason: target.reason,
        currentDigest: target.currentDigest,
        targetDigest: target.targetDigest,
      })),
      retired: retired.map((entry) => ({ ...entry })),
    }),
  });
}

/**
 * 在投影锁内让磁盘等于渲染结果：任一目标 unsafe 整轮零写；否则缺失创建、过期 CAS 替换、
 * 当前不动；`files` 之外的 Demand 页面目录只在全部成员带标记时退休。
 */
export async function publishActiveProjection(
  root: RootedDirectory,
  files: readonly Readonly<ActiveProjectionFile>[],
  options: PublishActiveProjectionOptions = {},
): Promise<Readonly<ActiveProjectionPublicationReceipt>> {
  assertRoot(root);
  const signal = options.signal;
  if (signal?.aborted === true) fail("io-failure", "aborted", "$signal");
  if (options.recovering === true) {
    await retireInactiveLock(root);
    await settleStages(root, files, signal);
  }
  try {
    return await withRootedExclusiveFileLock(
      root,
      WAKEFLOW_ACTIVE_PROJECTION_LOCK_REF,
      () => publishLocked(root, files, signal),
      { acquireTimeoutMilliseconds: LOCK_TIMEOUT_MILLISECONDS, ...signalOptions(signal) },
    );
  } catch (error: unknown) {
    if (error instanceof RootedExclusiveFileLockError) mapLockError(error);
    throw error;
  }
}

async function writeTargets(
  root: RootedDirectory,
  files: readonly Readonly<ActiveProjectionFile>[],
  before: readonly Readonly<ActiveProjectionTargetInspection>[],
  signal: AbortSignal | undefined,
): Promise<"current" | "created" | "updated"> {
  let disposition: "current" | "created" | "updated" = "current";
  for (const [index, entry] of files.entries()) {
    const target = before[index];
    if (target === undefined) fail("unexpected", "projection-target", "$projection");
    const outcome = await writeTarget(root, entry, target, signal);
    if (outcome === "replaced") disposition = "updated";
    else if (outcome === "created" && disposition === "current") disposition = "created";
  }
  return disposition;
}

async function retireInactiveDemandProjections(
  root: RootedDirectory,
  files: readonly Readonly<ActiveProjectionFile>[],
  signal: AbortSignal | undefined,
): Promise<readonly Readonly<ActiveProjectionRetiredDirectory>[]> {
  const active = new Set(
    files.flatMap((entry) => (entry.demandId === null ? [] : [entry.demandId])),
  );
  const retired: Readonly<ActiveProjectionRetiredDirectory>[] = [];
  for (const demandId of await listDemandProjectionDirectories(root, signal)) {
    if (active.has(demandId)) continue;
    retired.push(await retireDemandProjection(root, demandId, signal));
  }
  return Object.freeze(retired);
}

async function publishLocked(
  root: RootedDirectory,
  files: readonly Readonly<ActiveProjectionFile>[],
  signal: AbortSignal | undefined,
): Promise<Readonly<ActiveProjectionPublicationReceipt>> {
  const before = await inspectActiveProjectionTargets(root, files, signalOptions(signal));
  if (before.some((target) => target.status === "unsafe")) {
    return receiptOf("unsafe", before, Object.freeze([]));
  }
  await ensureProjectionDirectories(root, files, signal);
  const disposition = await writeTargets(root, files, before, signal);
  const retired = await retireInactiveDemandProjections(root, files, signal);
  const after = await inspectActiveProjectionTargets(root, files, signalOptions(signal));
  if (after.some((target) => target.status !== "current")) {
    fail("io-failure", "projection-commit-uncertain", "$projection");
  }
  return receiptOf(disposition, after, retired);
}
