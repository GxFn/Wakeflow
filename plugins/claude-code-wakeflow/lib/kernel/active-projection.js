import { rmdir } from "node:fs/promises";
import path from "node:path";
import { computeCanonicalJsonSha256Digest } from "../foundation/crypto/canonical-json-sha256.js";
import { computeSha256Digest } from "../foundation/crypto/sha256.js";
import { createDirectoryAtomically, DurableDirectoryMaterializationError, materializeDirectoryPath, } from "../foundation/filesystem/durable-directory-materialization.js";
import { DurableAtomicFileStageRecoveryError, recoverDurableAtomicFileStagesForTargets, } from "../foundation/filesystem/durable-atomic-file-stage-recovery.js";
import { createFileAtomically, DurableAtomicFileWriteError, replaceFileAtomically, } from "../foundation/filesystem/durable-atomic-file-write.js";
import { ExactRegularFileUnlinkError, unlinkRegularFileExactly, } from "../foundation/filesystem/exact-regular-file-unlink.js";
import { parsePortableResourcePath, } from "../foundation/filesystem/portable-resource-path.js";
import { RootedDirectory, RootedDirectoryError, } from "../foundation/filesystem/rooted-directory.js";
import { inspectRootedExclusiveFileLock, retireRootedExclusiveFileLockResidue, RootedExclusiveFileLockError, withRootedExclusiveFileLock, } from "../foundation/filesystem/rooted-exclusive-file-lock.js";
import { readStableResourceDirectory, StableDirectoryReadError, } from "../foundation/filesystem/stable-directory-read.js";
import { StableFileReadError, } from "../foundation/filesystem/stable-file-read.js";
import { readStrictTextFile, StrictTextFileError, } from "../foundation/filesystem/strict-text-file.js";
import { parseByteCount } from "../foundation/numeric/byte-count.js";
import { encodeUtf8 } from "../foundation/text/utf8.js";
import { fail } from "./error.js";
import { demandProjectionIndexRef, demandProjectionProgressRef, demandProjectionRootRef, WAKEFLOW_ACTIVE_CURRENT_ROOT_REF, WAKEFLOW_ACTIVE_PROJECTION_LOCK_REF, WAKEFLOW_ACTIVE_PROJECTIONS_ROOT_REF, WAKEFLOW_ACTIVE_ROOT_REF, WAKEFLOW_ACTIVE_WORKSPACE_INDEX_REF, WAKEFLOW_ACTIVE_WORKSPACE_STATUS_REF, } from "./layout.js";
/**
 * Wakeflow Kernel / Active Projection：`.wakeflow-active` 的两级容器与人读投影（能力卡 9 §9.4，
 * gate-log §13.94 D5）。
 *
 * 容器：`.wakeflow-active` 与 `current` 两个 0700 目录由维护事务独占创建，这里提供检查与
 * 物化。投影：工作区索引、工作区当前状态、每个活动 Demand 的索引与进度页，全部由一份
 * 纯数据事实渲染，文件带 `<!-- wakeflow:…-projection:v1:sha256:<指纹> -->` 标记，0600，
 * 单文件上限 8 MiB。目标分四类：current、missing、stale（带标记但字节不同）、unsafe
 * （符号链接、非普通文件、硬链接数不为 1、不可读、超限或没有标记即手写）；任一目标 unsafe
 * 整轮零写。重写在投影短锁内逐文件 CAS；已不活动的 Demand 页面只在调用方交来"这一轮确实
 * 把活动 Demand 看全了"的证据、且该 id 不在证据里时退休，退休本身再要求每个成员都带标记。
 * 投影只是导航，机器记录才是权威；本模块不读配置、不读事件流，事实由调用方提供。
 */
const ACTIVE_PROJECTION_VERSION = 1;
const ACTIVE_PROJECTION_FILE_MODE = 0o600;
const ACTIVE_PROJECTION_DIRECTORY_MODE = 0o700;
const ACTIVE_PROJECTION_MAXIMUM_BYTES = parseByteCount(8 * 1024 * 1024, "$activeProjection.maximumBytes");
const LOCK_TIMEOUT_MILLISECONDS = 10_000;
const DIRECTORY_MAXIMUM_ENTRIES = 4096;
const DEMAND_DIRECTORY_PATTERN = /^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MARKER_PATTERN = /<!-- wakeflow:(active|demand)-projection:v1:(sha256:[0-9a-f]{64}) -->/u;
const INLINE_MAXIMUM_LENGTH = 200;
function signalOptions(signal) {
    return signal === undefined ? {} : { signal };
}
function assertRoot(root) {
    if (!(root instanceof RootedDirectory))
        fail("invalid-request", "projection-root", "$root");
}
function currentUserId() {
    return typeof process.geteuid === "function" ? BigInt(process.geteuid()) : null;
}
function privateDirectoryCurrent(node) {
    const user = currentUserId();
    return (node.kind === "directory" &&
        node.permissionBits === ACTIVE_PROJECTION_DIRECTORY_MODE &&
        (user === null || node.userId === user));
}
function nodeDigest(node) {
    return computeCanonicalJsonSha256Digest({
        kind: node.kind,
        deviceId: node.deviceId.toString(),
        inodeId: node.inodeId.toString(),
        permissionBits: node.permissionBits,
        userId: node.userId.toString(),
    });
}
async function inspectLayoutEntry(root, resourcePath) {
    try {
        const resource = await root.inspectExistingResource(resourcePath, "$activeLayout");
        return Object.freeze({
            resourcePath,
            status: privateDirectoryCurrent(resource.node) ? "current" : "conflict",
            nodeDigest: nodeDigest(resource.node),
        });
    }
    catch (error) {
        if (error instanceof RootedDirectoryError && error.reason === "resource-not-found") {
            return Object.freeze({ resourcePath, status: "absent", nodeDigest: null });
        }
        if (error instanceof RootedDirectoryError) {
            fail("io-failure", "active-layout-root-scope", "$root", { cause: error });
        }
        throw error;
    }
}
/** 只检查 root/current 两个节点，不扫描任何活动业务聚合。 */
export async function inspectActiveLayout(root, options = {}) {
    assertRoot(root);
    if (options.signal?.aborted === true)
        fail("io-failure", "aborted", "$signal");
    const active = await inspectLayoutEntry(root, WAKEFLOW_ACTIVE_ROOT_REF);
    const current = await inspectLayoutEntry(root, WAKEFLOW_ACTIVE_CURRENT_ROOT_REF);
    const status = active.status === "conflict" || current.status === "conflict"
        ? "conflict"
        : active.status === "absent" && current.status === "absent"
            ? "absent"
            : active.status === "current" && current.status === "current"
                ? "current"
                : "incomplete";
    const basis = {
        kind: "WakeflowActiveLayoutInspection",
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
export async function assertActiveLayoutCurrent(root, options = {}) {
    const inspection = await inspectActiveLayout(root, options);
    if (inspection.status !== "current") {
        fail("precondition-failed", "active-layout-not-current", "$activeLayout");
    }
    return inspection;
}
async function existingLayoutDirectory(root, resourcePath, errorPath) {
    try {
        return (await root.inspectExistingResource(resourcePath, errorPath)).node;
    }
    catch (error) {
        if (error instanceof RootedDirectoryError && error.reason === "resource-not-found")
            return null;
        if (error instanceof RootedDirectoryError) {
            fail("io-failure", "active-layout-root-scope", "$root", { cause: error });
        }
        throw error;
    }
}
async function createLayoutDirectory(root, resourcePath, errorPath, signal) {
    try {
        const created = await createDirectoryAtomically(root, resourcePath, {
            mode: ACTIVE_PROJECTION_DIRECTORY_MODE,
            ...signalOptions(signal),
        });
        return created.node;
    }
    catch (error) {
        if (error instanceof DurableDirectoryMaterializationError) {
            if (error.reason === "aborted")
                fail("io-failure", "aborted", "$signal");
            fail("io-failure", `active-layout-${error.reason}`, errorPath, { cause: error });
        }
        throw error;
    }
}
async function ensureLayoutDirectory(root, resourcePath, recovering, signal) {
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
        disposition: existing === null ? "created" : "current",
        node,
    });
}
/** 独占创建两级容器；`recovering` 时幂等补齐尚未发生的创建。 */
export async function materializeActiveLayout(root, options) {
    assertRoot(root);
    if (options.signal?.aborted === true)
        fail("io-failure", "aborted", "$signal");
    const active = await ensureLayoutDirectory(root, WAKEFLOW_ACTIVE_ROOT_REF, options.recovering, options.signal);
    const current = await ensureLayoutDirectory(root, WAKEFLOW_ACTIVE_CURRENT_ROOT_REF, options.recovering, options.signal);
    const entries = Object.freeze([active, current]);
    return Object.freeze({
        disposition: entries.some((entry) => entry.disposition === "created") ? "created" : "current",
        entries,
    });
}
const TEXT = Object.freeze({
    en: Object.freeze({
        indexTitle: "Wakeflow Active Workspace",
        statusTitle: "Workspace Current Status",
        notice: "Generated projection only. Config, requirement packages, and Demand event streams remain authoritative; do not edit by hand.",
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
        unmerged: "Accepted implementation results with a recorded branch",
        unmergedNote: "Branch and commit are what the accepted result recorded. The projection cannot read repository pointers, so a branch listed here may already be merged or deleted; wakeflow_status reports the merge state.",
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
        unmerged: "已接受且记录了分支的实现结果",
        unmergedNote: "分支与提交是被接受的结果当时记下的。投影读不到仓库指针，这里列出的分支可能已经合并或删除；合并状态由 wakeflow_status 报告。",
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
function isControlCodePoint(codePoint) {
    return (codePoint < 0x20 ||
        (codePoint >= 0x7f && codePoint <= 0x9f) ||
        codePoint === 0x2028 ||
        codePoint === 0x2029);
}
/** 单行文本：去掉控制字符与表格分隔符，压缩空白，有界。 */
function inline(value) {
    let stripped = "";
    for (const character of value) {
        stripped += isControlCodePoint(character.codePointAt(0) ?? 0) ? " " : character;
    }
    const cleaned = stripped.replace(/\|/gu, "\\|").replace(/\s+/gu, " ").trim();
    return cleaned.length > INLINE_MAXIMUM_LENGTH
        ? `${cleaned.slice(0, INLINE_MAXIMUM_LENGTH - 1)}…`
        : cleaned;
}
function code(value) {
    return `\`${inline(value).replace(/`/gu, "'")}\``;
}
function marker(kind, fingerprint) {
    return `<!-- wakeflow:${kind}-projection:v${ACTIVE_PROJECTION_VERSION}:${fingerprint} -->`;
}
function fingerprintOf(basis) {
    return computeCanonicalJsonSha256Digest({
        kind: "WakeflowActiveProjectionFingerprint",
        version: ACTIVE_PROJECTION_VERSION,
        basis,
    });
}
function workspaceFingerprint(facts) {
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
function demandFingerprint(language, demand) {
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
function relativeFromActive(resourcePath) {
    return resourcePath.slice(`${WAKEFLOW_ACTIVE_ROOT_REF}/`.length);
}
function renderIndex(facts, fingerprint) {
    const text = TEXT[facts.language];
    const demands = facts.demands.length === 0
        ? [text.noDemands]
        : facts.demands.map((demand) => `- [${inline(demand.title)}](${relativeFromActive(demandProjectionIndexRef(demand.demandId))}) · ${code(demand.demandId)} · ${inline(demand.route.disposition)}`);
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
function renderStatus(facts, fingerprint) {
    const text = TEXT[facts.language];
    const pods = facts.pods.map((pod) => `| ${inline(pod.name)} ${code(pod.podId)} | ${pod.placement} | ${pod.lifecycle} | ${pod.activeDemandId === null ? text.none : code(pod.activeDemandId)} | ${pod.worktrees.length === 0
        ? text.none
        : pod.worktrees
            .map((worktree) => `${inline(worktree.repositoryName)}: ${worktree.receipt}`)
            .join(", ")} |`);
    const demands = facts.demands.map((demand) => `| [${code(demand.demandId)}](../${relativeFromActive(demandProjectionIndexRef(demand.demandId))}) | ${inline(demand.title)} | ${demand.demandType} | ${inline(demand.podName)} | ${demand.route.disposition} | ${demand.route.frontier ?? "—"} | ${demand.route.owner} |`);
    const unmerged = facts.unmergedAccepted.map((entry) => `| ${code(entry.demandId)} | ${code(entry.targetTaskId)} | ${code(entry.repositoryId)} | ${code(entry.branch)} | ${code(entry.commit)} |`);
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
        // 投影按 projection 作用域派生，仓库域被有意置空（§13.94 D5），这一段因此只能说出它
        // 真正有的东西：接受时记下的分支；分支还在不在、合没合并由 wakeflow_status 核对仓库指针。
        `## ${text.unmerged}`,
        "",
        `> ${text.unmergedNote}`,
        "",
        ...(unmerged.length === 0
            ? [text.none]
            : [text.unmergedHeader, "| --- | --- | --- | --- | --- |", ...unmerged]),
        "",
        `[${text.back}](../index.md)`,
    ].join("\n")}\n`;
}
function renderDemandIndex(language, demand, fingerprint) {
    const text = TEXT[language];
    const targets = demand.targets.map((target) => `| ${code(target.targetTaskId)} | ${target.workType} | ${target.phase} | ${target.repositoryId === null ? "—" : code(target.repositoryId)} | ${code(target.windowId)} |`);
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
function renderDemandProgress(language, demand, fingerprint) {
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
function file(resourcePath, kind, demandId, fingerprint, content) {
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
export function renderActiveProjectionFiles(facts) {
    const fingerprint = workspaceFingerprint(facts);
    const files = [
        file(WAKEFLOW_ACTIVE_WORKSPACE_INDEX_REF, "workspace", null, fingerprint, renderIndex(facts, fingerprint)),
        file(WAKEFLOW_ACTIVE_WORKSPACE_STATUS_REF, "workspace", null, fingerprint, renderStatus(facts, fingerprint)),
    ];
    for (const demand of facts.demands) {
        const demandPrint = demandFingerprint(facts.language, demand);
        files.push(file(demandProjectionIndexRef(demand.demandId), "demand", demand.demandId, demandPrint, renderDemandIndex(facts.language, demand, demandPrint)), file(demandProjectionProgressRef(demand.demandId), "demand", demand.demandId, demandPrint, renderDemandProgress(facts.language, demand, demandPrint)));
    }
    return Object.freeze(files);
}
/** 一组投影文件的确定性摘要：维护计划用它做步骤目标。 */
export function computeActiveProjectionSetDigest(files) {
    return computeCanonicalJsonSha256Digest({
        kind: "WakeflowActiveProjectionSet",
        version: ACTIVE_PROJECTION_VERSION,
        files: files.map((entry) => ({ resourcePath: entry.resourcePath, digest: entry.digest })),
    });
}
/** 空工作区（fresh 初始化）的事实：只有配置里的 pod，没有 Demand。 */
export function freshActiveProjectionFacts(input) {
    return Object.freeze({
        language: input.language,
        program: input.program,
        configDigest: input.configDigest,
        pods: Object.freeze(input.pods.map((pod) => Object.freeze({
            podId: pod.podId,
            name: pod.name,
            placement: pod.placement,
            lifecycle: pod.lifecycle,
            activeDemandId: null,
            worktrees: Object.freeze(pod.worktrees.map((worktree) => Object.freeze({ ...worktree, receipt: "absent" }))),
        }))),
        unmergedAccepted: Object.freeze([]),
        demands: Object.freeze([]),
        // fresh 初始化只读 Config，没有观察过活动 Demand：没有证据就不退休任何页面目录。
        activeDemands: Object.freeze({ observed: false, activeDemandIds: Object.freeze([]) }),
    });
}
function unsafe(resourcePath, targetDigest, reason, source = null) {
    return Object.freeze({
        resourcePath,
        status: "unsafe",
        reason,
        source,
        currentDigest: source?.digest ?? null,
        targetDigest,
    });
}
/** 读失败的分类：缺失返回 `null`，中止与根作用域上抛，其余都是 unsafe 的原因。 */
function classifyReadFailure(error) {
    if (error instanceof StableFileReadError) {
        if (error.reason === "not-found")
            return null;
        if (error.reason === "aborted")
            fail("io-failure", "aborted", "$signal");
        if (error.reason === "root-scope") {
            fail("io-failure", "projection-root-scope", "$root", { cause: error });
        }
        return error.reason === "symlink" || error.reason === "not-file" || error.reason === "too-large"
            ? error.reason
            : "io";
    }
    if (error instanceof StrictTextFileError)
        return "encoding";
    throw error;
}
/** 节点策略：单链接、0600、当前用户所有；违反即 unsafe 的原因。 */
function nodePolicyViolation(node) {
    if (node.linkCount !== 1n)
        return "links";
    if (node.permissionBits !== ACTIVE_PROJECTION_FILE_MODE)
        return "mode";
    const user = currentUserId();
    if (user !== null && node.userId !== user)
        return "owner";
    return null;
}
async function inspectTarget(root, resourcePath, targetDigest, signal) {
    let read;
    try {
        read = await readStrictTextFile(root, resourcePath, {
            maximumBytes: ACTIVE_PROJECTION_MAXIMUM_BYTES,
            ...signalOptions(signal),
        });
    }
    catch (error) {
        const reason = classifyReadFailure(error);
        if (reason !== null)
            return unsafe(resourcePath, targetDigest, reason);
        return Object.freeze({
            resourcePath,
            status: "missing",
            reason: null,
            source: null,
            currentDigest: null,
            targetDigest,
        });
    }
    const source = Object.freeze({
        resourcePath: read.resourcePath,
        node: read.node,
        byteCount: read.byteCount,
        digest: read.digest,
    });
    const violation = nodePolicyViolation(read.node);
    if (violation !== null)
        return unsafe(resourcePath, targetDigest, violation, source);
    if (read.digest !== targetDigest && !MARKER_PATTERN.test(read.text)) {
        return unsafe(resourcePath, targetDigest, "handwritten", source);
    }
    return Object.freeze({
        resourcePath,
        status: read.digest === targetDigest ? "current" : "stale",
        reason: null,
        source,
        currentDigest: read.digest,
        targetDigest,
    });
}
/** 零写检查每个目标文件的分类。 */
export async function inspectActiveProjectionTargets(root, files, options = {}) {
    assertRoot(root);
    const targets = [];
    for (const entry of files) {
        targets.push(await inspectTarget(root, entry.resourcePath, entry.digest, options.signal));
    }
    return Object.freeze(targets);
}
function mapWriteError(error) {
    if (error.reason === "aborted")
        fail("io-failure", "aborted", "$signal");
    if (error.reason === "target-exists" ||
        error.reason === "expectation-changed" ||
        error.reason === "expectation-read-failure") {
        fail("io-failure", "projection-contended", "$projection", { cause: error, retryable: true });
    }
    fail("io-failure", `projection-write-${error.reason}`, "$projection", { cause: error });
}
async function ensureProjectionDirectories(root, files, signal) {
    const directories = new Set();
    for (const entry of files) {
        if (entry.demandId !== null)
            directories.add(demandProjectionRootRef(entry.demandId));
    }
    for (const directory of directories) {
        try {
            await materializeDirectoryPath(root, directory, {
                mode: ACTIVE_PROJECTION_DIRECTORY_MODE,
                ...signalOptions(signal),
            });
        }
        catch (error) {
            if (error instanceof DurableDirectoryMaterializationError) {
                if (error.reason === "aborted")
                    fail("io-failure", "aborted", "$signal");
                fail("io-failure", `projection-directory-${error.reason}`, `$projection/${directory}`, {
                    cause: error,
                });
            }
            throw error;
        }
    }
}
async function writeTarget(root, entry, target, signal) {
    if (target.status === "current")
        return null;
    try {
        if (target.status === "missing") {
            await createFileAtomically(root, entry.resourcePath, entry.bytes, {
                mode: ACTIVE_PROJECTION_FILE_MODE,
                ...signalOptions(signal),
            });
            return "created";
        }
        if (target.source === null)
            fail("unexpected", "projection-source", "$projection");
        await replaceFileAtomically(root, entry.resourcePath, entry.bytes, {
            mode: ACTIVE_PROJECTION_FILE_MODE,
            expected: target.source,
            ...signalOptions(signal),
        });
        return "replaced";
    }
    catch (error) {
        if (error instanceof DurableAtomicFileWriteError)
            mapWriteError(error);
        throw error;
    }
}
async function listDemandProjectionDirectories(root, signal) {
    try {
        const listing = await readStableResourceDirectory(root, WAKEFLOW_ACTIVE_PROJECTIONS_ROOT_REF, {
            maximumEntries: DIRECTORY_MAXIMUM_ENTRIES,
            ...signalOptions(signal),
        });
        return Object.freeze(listing.entries
            .filter((entry) => entry.node.kind === "directory" && DEMAND_DIRECTORY_PATTERN.test(entry.name))
            .map((entry) => entry.name)
            .sort());
    }
    catch (error) {
        if (error instanceof StableDirectoryReadError && error.reason === "not-found") {
            return Object.freeze([]);
        }
        if (error instanceof StableDirectoryReadError) {
            if (error.reason === "aborted")
                fail("io-failure", "aborted", "$signal");
            fail("io-failure", `projection-listing-${error.reason}`, "$projection", { cause: error });
        }
        throw error;
    }
}
/** 一个带标记的普通单链接文件才是可退休成员；任何别的都让整个目录留下（`null`）。 */
async function retirableMember(root, entry, signal) {
    if (entry.node.kind !== "file" || entry.node.linkCount !== 1n)
        return null;
    try {
        const read = await readStrictTextFile(root, entry.resourcePath, {
            maximumBytes: ACTIVE_PROJECTION_MAXIMUM_BYTES,
            ...signalOptions(signal),
        });
        return MARKER_PATTERN.test(read.text)
            ? { resourcePath: entry.resourcePath, node: read.node }
            : null;
    }
    catch (error) {
        if (error instanceof StableFileReadError && error.reason === "aborted") {
            fail("io-failure", "aborted", "$signal");
        }
        return null;
    }
}
async function retirableMembers(root, directory, signal) {
    let listing;
    try {
        listing = await readStableResourceDirectory(root, directory, {
            maximumEntries: DIRECTORY_MAXIMUM_ENTRIES,
            ...signalOptions(signal),
        });
    }
    catch (error) {
        if (error instanceof StableDirectoryReadError && error.reason === "aborted") {
            fail("io-failure", "aborted", "$signal");
        }
        return null;
    }
    const members = [];
    for (const entry of listing.entries) {
        const member = await retirableMember(root, entry, signal);
        if (member === null)
            return null;
        members.push(member);
    }
    return members;
}
async function unlinkMember(root, member, directory, signal) {
    try {
        await unlinkRegularFileExactly(root, member.resourcePath, {
            expectedNode: member.node,
            ...signalOptions(signal),
        });
    }
    catch (error) {
        if (error instanceof ExactRegularFileUnlinkError) {
            if (error.reason === "aborted")
                fail("io-failure", "aborted", "$signal");
            fail("io-failure", `projection-retire-${error.reason}`, `$projection/${directory}`, {
                cause: error,
            });
        }
        throw error;
    }
}
/** 退休一个已不活动的 Demand 页面目录：每个成员都必须是带标记的普通文件，否则整个目录留下。 */
async function retireDemandProjection(root, demandId, signal) {
    const directory = demandProjectionRootRef(demandId);
    const members = await retirableMembers(root, directory, signal);
    if (members === null)
        return Object.freeze({ demandId, disposition: "unsafe" });
    for (const member of members)
        await unlinkMember(root, member, directory, signal);
    try {
        await rmdir(path.join(root.absolutePath, ...directory.split("/")));
    }
    catch (error) {
        fail("io-failure", "projection-retire-directory", `$projection/${directory}`, {
            cause: error,
        });
    }
    return Object.freeze({ demandId, disposition: "retired" });
}
async function retireInactiveLock(root) {
    let lock;
    try {
        lock = await inspectRootedExclusiveFileLock(root, WAKEFLOW_ACTIVE_PROJECTION_LOCK_REF);
    }
    catch (error) {
        if (error instanceof RootedExclusiveFileLockError) {
            fail("io-failure", "projection-lock", "$projection", { cause: error });
        }
        throw error;
    }
    if (lock.status !== "held" || lock.ownerState !== "inactive")
        return;
    try {
        // 退休先在锁的父目录内做 stage 恢复，集合外的 stage 一律拒绝。工作区索引与锁同住
        // `.wakeflow-active/`，崩溃留下的索引 stage 因此必须一起声明：否则恢复恰好在它存在的
        // 那一轮（也就是恢复存在的理由）以 residue-changed 失败，失活的锁再也退不掉。
        await retireRootedExclusiveFileLockResidue(root, WAKEFLOW_ACTIVE_PROJECTION_LOCK_REF, lock, {
            relatedTargetResourcePaths: [WAKEFLOW_ACTIVE_WORKSPACE_INDEX_REF],
        });
    }
    catch (error) {
        if (error instanceof RootedExclusiveFileLockError) {
            fail("io-failure", "projection-lock", "$projection", { cause: error });
        }
        throw error;
    }
}
/** 目标的父目录尚不存在（首次发布前的 Demand 页面目录）：那里不可能有暂存文件，无需退休。 */
async function stageParentPresent(root, resourcePath) {
    const errorPath = `$projection/${resourcePath}`;
    const parent = parsePortableResourcePath(resourcePath.slice(0, resourcePath.lastIndexOf("/")), errorPath);
    try {
        await root.inspectExistingResource(parent, errorPath);
        return true;
    }
    catch (error) {
        if (error instanceof RootedDirectoryError && error.reason === "resource-not-found")
            return false;
        if (error instanceof RootedDirectoryError) {
            fail("io-failure", "projection-stage", errorPath, { cause: error });
        }
        throw error;
    }
}
async function settleStages(root, files, signal) {
    for (const entry of files) {
        if (!(await stageParentPresent(root, entry.resourcePath)))
            continue;
        try {
            const recovery = await recoverDurableAtomicFileStagesForTargets(root, [entry.resourcePath], signalOptions(signal));
            if (recovery.activeStageCount !== 0 || recovery.unknownStageCount !== 0) {
                fail("io-failure", "projection-stage-active", `$projection/${entry.resourcePath}`);
            }
        }
        catch (error) {
            if (error instanceof DurableAtomicFileStageRecoveryError) {
                if (error.reason === "aborted")
                    fail("io-failure", "aborted", "$signal");
                fail("io-failure", "projection-stage", `$projection/${entry.resourcePath}`, {
                    cause: error,
                });
            }
            throw error;
        }
    }
}
function mapLockError(error) {
    if (error.reason === "aborted")
        fail("io-failure", "aborted", "$signal");
    if (error.reason === "timeout" || error.reason === "owner-active") {
        fail("io-failure", "projection-contended", "$projection", { cause: error, retryable: true });
    }
    fail("io-failure", `projection-lock-${error.reason}`, "$projection", { cause: error });
}
function receiptOf(disposition, targets, retired) {
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
 * 当前不动；`files` 之外的 Demand 页面目录只在 `activeDemands` 证明这一轮看全了活动
 * Demand、且全部成员带标记时退休。
 *
 * `render` 是闭包时先取锁再渲染：观察与落盘之间没有第二个发布方插队的窗口。恢复语义里
 * 退休失活的锁必须发生在取锁之前（不然谁也取不到），暂存结算则挪进锁内——它读的是同一批
 * 目标所在的目录，锁内读才不会撞上另一个发布方正在写的活动 stage。
 */
export async function publishActiveProjection(root, render, options = {}) {
    assertRoot(root);
    const signal = options.signal;
    if (signal?.aborted === true)
        fail("io-failure", "aborted", "$signal");
    if (options.recovering === true)
        await retireInactiveLock(root);
    try {
        return await withRootedExclusiveFileLock(root, WAKEFLOW_ACTIVE_PROJECTION_LOCK_REF, () => renderAndPublishLocked(root, render, options), {
            acquireTimeoutMilliseconds: options.acquireTimeoutMilliseconds ?? LOCK_TIMEOUT_MILLISECONDS,
            ...signalOptions(signal),
        });
    }
    catch (error) {
        if (error instanceof RootedExclusiveFileLockError)
            mapLockError(error);
        throw error;
    }
}
/** 锁内的一轮：渲染（或接过已渲染的文件）、按需结算暂存、再发布。 */
async function renderAndPublishLocked(root, render, options) {
    const signal = options.signal;
    const rendering = typeof render === "function" ? await render() : { files: render };
    const evidence = rendering.activeDemands ?? options.activeDemands;
    if (options.recovering === true)
        await settleStages(root, rendering.files, signal);
    return publishLocked(root, rendering.files, evidence, signal);
}
async function writeTargets(root, files, before, signal) {
    let disposition = "current";
    for (const [index, entry] of files.entries()) {
        const target = before[index];
        if (target === undefined)
            fail("unexpected", "projection-target", "$projection");
        const outcome = await writeTarget(root, entry, target, signal);
        if (outcome === "replaced")
            disposition = "updated";
        else if (outcome === "created" && disposition === "current")
            disposition = "created";
    }
    return disposition;
}
/**
 * 退休遍历需要"不活动"的正面证据：没有证据、或这一轮没把活动 Demand 看全（域读不出、
 * 或其中某个 Demand 读不出）就一个目录都不删——`files` 里缺一个 Demand 既可能是它真的
 * 不活动，也可能只是这一轮没读出来，两者在 `files` 上无法区分。
 */
async function retireInactiveDemandProjections(root, files, evidence, signal) {
    if (evidence === undefined || !evidence.observed)
        return Object.freeze([]);
    const active = new Set(evidence.activeDemandIds);
    for (const entry of files) {
        if (entry.demandId !== null)
            active.add(entry.demandId);
    }
    const retired = [];
    for (const demandId of await listDemandProjectionDirectories(root, signal)) {
        if (active.has(demandId))
            continue;
        retired.push(await retireDemandProjection(root, demandId, signal));
    }
    return Object.freeze(retired);
}
async function publishLocked(root, files, evidence, signal) {
    const before = await inspectActiveProjectionTargets(root, files, signalOptions(signal));
    if (before.some((target) => target.status === "unsafe")) {
        return receiptOf("unsafe", before, Object.freeze([]));
    }
    await ensureProjectionDirectories(root, files, signal);
    const disposition = await writeTargets(root, files, before, signal);
    const retired = await retireInactiveDemandProjections(root, files, evidence, signal);
    const after = await inspectActiveProjectionTargets(root, files, signalOptions(signal));
    if (after.some((target) => target.status !== "current")) {
        fail("io-failure", "projection-commit-uncertain", "$projection");
    }
    return receiptOf(disposition, after, retired);
}
