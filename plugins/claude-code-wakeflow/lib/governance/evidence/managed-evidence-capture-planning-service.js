import { types } from "node:util";
import pLimit from "p-limit";
import { parseWakeflowDurableIdOfKind, WakeflowDurableIdError, } from "../../contracts/identity/wakeflow-durable-id.js";
import { inspectLoadedArtifactTree, validateLoadedArtifactTreeManifest, LoadedArtifactTreeIdentityError, } from "../../foundation/artifact/loaded-artifact-tree-identity.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { parsePlainRecord, PassiveOwnDataError } from "../../foundation/data/passive-own-data.js";
import { sameFileNodeIdentity, } from "../../foundation/filesystem/file-node-snapshot.js";
import { parsePortableResourcePath, } from "../../foundation/filesystem/portable-resource-path.js";
import { RootedDirectory, RootedDirectoryError, } from "../../foundation/filesystem/rooted-directory.js";
import { readStableFile, StableFileReadError } from "../../foundation/filesystem/stable-file-read.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { decodeUtf8, Utf8Error } from "../../foundation/text/utf8.js";
import { readHostHookObservationRecord } from "../../kernel/hook-observations.js";
import { WakeflowError } from "../../kernel/error.js";
import { deriveDurableId } from "../../kernel/ids.js";
import { CREDENTIAL_PRIVACY_FINDING_KINDS, DEFAULT_ALLOWED_ID_PREFIXES, scanPrivacy, } from "../../kernel/privacy-scan.js";
import { assertDemandOperationConfigCurrent, closeDemandOperationAuthorityContext, openDemandOperationAuthorityContext, DemandOperationAuthorityContextError, } from "../demand/demand-operation-authority-context.js";
import { loadDemandEventSourcingRootAuthority, DemandEventSourcingRootAuthorityError, } from "../demand/event-sourcing/demand-event-sourcing-root-authority.js";
import { LedgerAuthorityStore } from "../ledger/ledger-authority-store.js";
import { createManagedEvidenceCapturePlan, ManagedEvidenceCapturePlanError, } from "./managed-evidence-capture-plan.js";
import { listPodWorktreeReceiptsAnyHost } from "../../kernel/pod-worktree-receipts.js";
import { openConfiguredManagedEvidenceSourceRoot, ManagedEvidenceConfiguredSourceRootError, } from "./managed-evidence-configured-source-root.js";
import { createManagedEvidenceManifest, MANAGED_EVIDENCE_PAYLOAD_LIMITS, MANAGED_EVIDENCE_PRIVACY_FINDING_LIMIT, ManagedEvidenceManifestError, } from "./managed-evidence-manifest.js";
import { encodeManagedEvidenceSourceProjection } from "./managed-evidence-source-projection.js";
import { assertManagedEvidenceKindMatchesSource, managedEvidenceSourceKey, parseManagedEvidenceSourceSelection, ManagedEvidenceSourceSelectionError, } from "./managed-evidence-source-selection.js";
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
};
export class ManagedEvidenceCapturePlanningServiceError extends Error {
    name = "ManagedEvidenceCapturePlanningServiceError";
    code = "wakeflow-managed-evidence-capture-planning-service";
    reason;
    causeCode;
    causeReason;
    constructor(reason, causeCode = null, causeReason = null) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.causeCode = causeCode;
        this.causeReason = causeReason;
    }
}
const CONTENT_CLASSIFICATION_CONCURRENCY = 4;
const MAXIMUM_FILE_BYTES = parseByteCount(MANAGED_EVIDENCE_PAYLOAD_LIMITS.maxFileBytes);
const CAPTURED_FILE_REF = parsePortableResourcePath("content");
const NON_TEXT_CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
const BLOCKER_LIMIT = 16;
function ownString(value, key) {
    if (typeof value !== "object" || value === null)
        return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined &&
        Object.hasOwn(descriptor, "value") &&
        typeof descriptor.value === "string"
        ? descriptor.value
        : null;
}
function fail(reason, cause) {
    throw new ManagedEvidenceCapturePlanningServiceError(reason, ownString(cause, "code"), ownString(cause, "reason"));
}
function parseOptions(value) {
    let record;
    try {
        record = parsePlainRecord(value === undefined ? {} : value, "$options");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", error);
        throw error;
    }
    if (Object.keys(record).some((key) => key !== "clock" && key !== "signal") ||
        (record.clock !== undefined &&
            (typeof record.clock !== "function" || types.isProxy(record.clock))) ||
        (record.signal !== undefined &&
            (typeof record.signal !== "object" ||
                record.signal === null ||
                types.isProxy(record.signal) ||
                !(record.signal instanceof AbortSignal)))) {
        fail("input");
    }
    return Object.freeze({
        clock: record.clock,
        signal: record.signal,
    });
}
function assertNotAborted(signal) {
    if (signal?.aborted === true)
        fail("aborted");
}
function parseDemandId(value) {
    try {
        return parseWakeflowDurableIdOfKind(value, "demand", "$demandId");
    }
    catch (error) {
        if (error instanceof WakeflowDurableIdError)
            fail("input", error);
        throw error;
    }
}
function parseSelection(value) {
    try {
        return parseManagedEvidenceSourceSelection(value);
    }
    catch (error) {
        if (error instanceof ManagedEvidenceSourceSelectionError)
            fail("input", error);
        throw error;
    }
}
function rethrowPlanningError(error) {
    if (error instanceof ManagedEvidenceCapturePlanningServiceError)
        throw error;
    if (error instanceof DemandOperationAuthorityContextError) {
        if (error.reason === "aborted")
            fail("aborted", error);
        if (error.reason === "config" || error.reason === "stale-config")
            fail("config", error);
        fail("demand", error);
    }
    if (error instanceof RootedDirectoryError)
        fail("source-root", error);
    if (error instanceof StableFileReadError)
        mapStableFileError(error);
    if (error instanceof LoadedArtifactTreeIdentityError)
        mapArtifactError(error);
    throw error;
}
/** 内核读取（hook 观察记录、pod worktree 回执）的失败收敛为本模块的稳定错误。 */
async function readKernelSource(read, signal) {
    try {
        return await read();
    }
    catch (error) {
        if (error instanceof WakeflowError) {
            if (error.reason === "aborted" || signal?.aborted === true)
                fail("aborted", error);
            fail("source", error);
        }
        throw error;
    }
}
function mapStableFileError(error) {
    if (error.reason === "aborted")
        fail("aborted", error);
    if (error.reason === "too-large")
        fail("capacity", error);
    if (error.reason === "source-changed" || error.reason === "expectation-changed") {
        fail("source-changed", error);
    }
    if (error.reason === "not-file")
        fail("source-type", error);
    fail("source", error);
}
function mapArtifactError(error) {
    if (error.reason === "aborted")
        fail("aborted", error);
    if (error.reason === "entry-limit" ||
        error.reason === "depth-limit" ||
        error.reason === "file-count" ||
        error.reason === "file-bytes" ||
        error.reason === "total-bytes" ||
        error.reason === "ref-bytes") {
        fail("capacity", error);
    }
    if (error.reason === "source-changed")
        fail("source-changed", error);
    fail("source", error);
}
/** 隐私白名单：工作区根、ledger 根与配置里的全部仓库与支撑面真实路径（能力卡 8 Q1）。 */
export function managedEvidencePrivacyPolicy(workspaceRoot, config, worktreePaths = []) {
    const roots = new Set([
        workspaceRoot.absolutePath,
        config.placements.workspaceRoot,
        config.ledgerRoot,
        ...worktreePaths,
    ]);
    for (const entry of config.placements.roots) {
        roots.add(entry.absolutePath);
        if (entry.realPath !== null)
            roots.add(entry.realPath);
    }
    return Object.freeze({
        allowedPathRoots: Object.freeze([...roots]),
        allowedIdPrefixes: DEFAULT_ALLOWED_ID_PREFIXES,
    });
}
/** opaque 字节不扫描；文本成员的每条命中带成员引用与行号。 */
function classifyContent(bytes, ref, policy) {
    let text;
    try {
        text = decodeUtf8(bytes, "$content");
    }
    catch (error) {
        if (error instanceof Utf8Error)
            return Object.freeze({ opaque: true, findings: [] });
        throw error;
    }
    if (NON_TEXT_CONTROL_PATTERN.test(text))
        return Object.freeze({ opaque: true, findings: [] });
    return Object.freeze({
        opaque: false,
        findings: Object.freeze(scanPrivacy(text, policy).map((finding) => Object.freeze({ ref, line: finding.line, kind: finding.kind }))),
    });
}
function compareFinding(left, right) {
    if (left.ref !== right.ref)
        return left.ref < right.ref ? -1 : 1;
    if (left.line !== right.line)
        return left.line - right.line;
    if (left.kind === right.kind)
        return 0;
    return left.kind < right.kind ? -1 : 1;
}
/** 同一行同一种命中只保留一条；Manifest要求(ref, line, kind)严格递增。 */
function uniqueFindings(sorted) {
    return sorted.filter((finding, index) => index === 0 || compareFinding(sorted[index - 1], finding) !== 0);
}
function reviewOf(classified) {
    const findings = uniqueFindings(classified.flatMap((entry) => entry.content.findings).sort(compareFinding));
    return Object.freeze({
        opaqueFileRefs: Object.freeze(classified.filter((entry) => entry.content.opaque).map((entry) => entry.ref)),
        privacyFindings: Object.freeze(findings.filter((finding) => !CREDENTIAL_PRIVACY_FINDING_KINDS.includes(finding.kind))),
        credentialFindings: Object.freeze(findings.filter((finding) => CREDENTIAL_PRIVACY_FINDING_KINDS.includes(finding.kind))),
    });
}
/**
 * 内容阻塞项（能力卡 8 Q1，切片 8 D3）：凭证类命中永远阻塞；opaque 成员与非凭证类命中只在
 * `reject` 策略下阻塞；超过记录容量的非凭证类命中不能被确认。
 */
export function deriveManagedEvidenceContentBlockers(review, policy) {
    const blockers = [];
    for (const finding of review.credentialFindings) {
        blockers.push(`privacy:${finding.kind}:${finding.ref}:${finding.line}`);
    }
    if (review.privacyFindings.length > MANAGED_EVIDENCE_PRIVACY_FINDING_LIMIT) {
        blockers.push(`privacy-findings-overflow:${review.privacyFindings.length}`);
    }
    if (policy === "reject") {
        for (const ref of review.opaqueFileRefs)
            blockers.push(`opaque-content:${ref}`);
        for (const finding of review.privacyFindings) {
            blockers.push(`privacy:${finding.kind}:${finding.ref}:${finding.line}`);
        }
    }
    return Object.freeze(blockers.slice(0, BLOCKER_LIMIT));
}
function singleFileIdentity(byteCount, digest, executable) {
    let manifest;
    try {
        manifest = validateLoadedArtifactTreeManifest({
            artifactKind: "wakeflow-loaded-artifact-tree",
            fileCount: 1,
            files: [{ bytes: byteCount, digest, executable, ref: CAPTURED_FILE_REF }],
            schemaVersion: 1,
            totalBytes: byteCount,
        });
    }
    catch (error) {
        if (error instanceof LoadedArtifactTreeIdentityError)
            mapArtifactError(error);
        throw error;
    }
    return Object.freeze({ artifactDigest: computeCanonicalJsonSha256Digest(manifest), manifest });
}
async function captureFile(root, source, expectedNode, policy, signal) {
    let read;
    try {
        read = await readStableFile(root, source.path, {
            maximumBytes: MAXIMUM_FILE_BYTES,
            expectedNode,
            ...(signal === undefined ? {} : { signal }),
        });
    }
    catch (error) {
        if (error instanceof StableFileReadError)
            mapStableFileError(error);
        throw error;
    }
    const content = classifyContent(read.bytes, CAPTURED_FILE_REF, policy);
    return Object.freeze({
        identity: singleFileIdentity(Number(read.byteCount), read.digest, (read.node.permissionBits & 0o111) !== 0),
        source,
        review: reviewOf([{ ref: CAPTURED_FILE_REF, content }]),
    });
}
async function openSelectedTreeRoot(sourceRoot, source, expectedNode) {
    let observation;
    try {
        observation = await sourceRoot.inspectExistingResource(source.path, "$source");
    }
    catch (error) {
        if (error instanceof RootedDirectoryError)
            fail("source", error);
        throw error;
    }
    if (observation.node.kind !== "directory" || !sameFileNodeIdentity(observation.node, expectedNode)) {
        fail("source-type");
    }
    let treeRoot;
    try {
        treeRoot = await RootedDirectory.open(observation.physicalPath, "$source");
        const current = await treeRoot.assertCurrent("$source");
        if (!sameFileNodeIdentity(expectedNode, current))
            fail("source-changed");
        return treeRoot;
    }
    catch (error) {
        if (treeRoot !== undefined) {
            try {
                await treeRoot.close();
            }
            catch {
                // 首个打开或身份错误优先。
            }
        }
        if (error instanceof ManagedEvidenceCapturePlanningServiceError)
            throw error;
        if (error instanceof RootedDirectoryError)
            fail("source", error);
        throw error;
    }
}
async function inspectTreeIdentity(treeRoot, signal) {
    try {
        return await inspectLoadedArtifactTree(treeRoot, {
            limits: MANAGED_EVIDENCE_PAYLOAD_LIMITS,
            ...(signal === undefined ? {} : { signal }),
        });
    }
    catch (error) {
        if (error instanceof LoadedArtifactTreeIdentityError)
            mapArtifactError(error);
        throw error;
    }
}
async function classifyTreeFiles(treeRoot, identity, policy, signal) {
    const limit = pLimit(CONTENT_CLASSIFICATION_CONCURRENCY);
    const settled = await Promise.allSettled(identity.manifest.files.map((file) => limit(async () => {
        let read;
        try {
            read = await readStableFile(treeRoot, file.ref, {
                maximumBytes: MAXIMUM_FILE_BYTES,
                ...(signal === undefined ? {} : { signal }),
            });
        }
        catch (error) {
            if (error instanceof StableFileReadError)
                mapStableFileError(error);
            throw error;
        }
        if (Number(read.byteCount) !== file.bytes || read.digest !== file.digest) {
            fail("source-changed");
        }
        return Object.freeze({ ref: file.ref, content: classifyContent(read.bytes, file.ref, policy) });
    })));
    for (const result of settled) {
        if (result.status === "rejected")
            throw result.reason;
    }
    return reviewOf(settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : [])));
}
async function captureTree(sourceRoot, source, expectedNode, policy, signal) {
    const treeRoot = await openSelectedTreeRoot(sourceRoot, source, expectedNode);
    let result;
    let failure;
    try {
        const first = await inspectTreeIdentity(treeRoot, signal);
        const review = await classifyTreeFiles(treeRoot, first, policy, signal);
        const current = await inspectTreeIdentity(treeRoot, signal);
        if (current.artifactDigest !== first.artifactDigest)
            fail("source-changed");
        result = Object.freeze({ identity: current, source, review });
    }
    catch (error) {
        failure = error;
    }
    try {
        await treeRoot.close();
    }
    catch (error) {
        if (failure === undefined)
            failure = error;
    }
    if (failure !== undefined)
        throw failure;
    if (result === undefined)
        fail("operation-failure");
    return result;
}
async function captureManagedPath(workspaceRoot, config, source, policy, signal) {
    let sourceRoot;
    try {
        sourceRoot = await openConfiguredManagedEvidenceSourceRoot(workspaceRoot, config, source, signal === undefined ? {} : { signal });
    }
    catch (error) {
        if (error instanceof ManagedEvidenceConfiguredSourceRootError)
            fail("source-root", error);
        if (error instanceof WakeflowError && error.reason === "aborted")
            fail("aborted", error);
        throw error;
    }
    let result;
    let failure;
    try {
        let observation;
        try {
            observation = await sourceRoot.inspectExistingResource(source.path, "$source");
        }
        catch (error) {
            if (error instanceof RootedDirectoryError)
                fail("source", error);
            throw error;
        }
        if (observation.node.kind === "symbolic-link")
            fail("source");
        const expectedKind = source.resourceType === "file" ? "file" : "directory";
        if (observation.node.kind !== expectedKind)
            fail("source-type");
        result =
            source.resourceType === "file"
                ? await captureFile(sourceRoot, source, observation.node, policy, signal)
                : await captureTree(sourceRoot, source, observation.node, policy, signal);
    }
    catch (error) {
        failure = error;
    }
    try {
        await sourceRoot.close();
    }
    catch (error) {
        if (failure === undefined)
            failure = error;
    }
    if (failure !== undefined)
        throw failure;
    if (result === undefined)
        fail("operation-failure");
    return result;
}
/**
 * 引用类来源：负载是来源投影文档。投影里只有 typed id、记录标识与摘要，唯一的自由文本是
 * 链接 URL，因此只有 URL 经隐私扫描（查询串里的凭证会被拦下）。
 */
function captureProjection(source, policy) {
    const projection = encodeManagedEvidenceSourceProjection(source);
    const findings = source.kind === "link"
        ? scanPrivacy(source.url, policy).map((finding) => Object.freeze({ ref: CAPTURED_FILE_REF, line: finding.line, kind: finding.kind }))
        : [];
    return Object.freeze({
        identity: singleFileIdentity(projection.byteCount, projection.digest, false),
        source,
        review: reviewOf([{ ref: CAPTURED_FILE_REF, content: { opaque: false, findings } }]),
    });
}
async function captureObservation(workspaceRoot, selection, source, policy, signal) {
    const read = await readKernelSource(() => readHostHookObservationRecord(workspaceRoot, source.hostId, source.recordId, signal === undefined ? {} : { signal }), signal);
    if (read === null)
        fail("source");
    const record = read.record;
    const projected = Object.freeze({
        kind: "observation",
        hostId: source.hostId,
        recordId: source.recordId,
        event: record.event,
        recordedAt: record.recordedAt,
        turnId: record.turnId,
        promptDigest: record.promptDigest,
        lastAssistantMessageDigest: record.lastAssistantMessageDigest,
        transcript: record.transcriptRef === null ? "absent" : "present",
        recordDigest: read.digest,
    });
    try {
        assertManagedEvidenceKindMatchesSource(selection.kind, projected);
    }
    catch (error) {
        if (error instanceof ManagedEvidenceSourceSelectionError)
            fail("kind", error);
        throw error;
    }
    return captureProjection(projected, policy);
}
async function captureSelectedSource(workspaceRoot, config, selection, worktreePaths, signal) {
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
            if (config.indexes.repositoryById[source.repositoryId] === undefined)
                fail("source-root");
            return captureProjection(source, policy);
        default: {
            const exhaustive = source;
            return exhaustive;
        }
    }
}
function demandExpectation(context) {
    return Object.freeze({
        streamRevision: context.loaded.aggregate.streamRevision,
        stateDigest: context.loaded.aggregate.stateDigest,
        lastEventId: context.loaded.aggregate.lastEvent.eventId,
        lastEventDigest: context.loaded.aggregate.lastEventDigest,
    });
}
async function assertAuthorityCurrent(workspaceRoot, context, expected, signal) {
    try {
        await assertDemandOperationConfigCurrent(workspaceRoot, context.config, signal);
        const current = await loadDemandEventSourcingRootAuthority(context.demandRoot, new LedgerAuthorityStore(context.ledgerRoot), { audit: true, ...(signal === undefined ? {} : { signal }) });
        if (current.authorityDigest !== context.loaded.authorityDigest ||
            current.aggregate.streamRevision !== expected.streamRevision ||
            current.aggregate.stateDigest !== expected.stateDigest ||
            current.aggregate.lastEvent.eventId !== expected.lastEventId ||
            current.aggregate.lastEventDigest !== expected.lastEventDigest) {
            fail("demand");
        }
    }
    catch (error) {
        if (error instanceof ManagedEvidenceCapturePlanningServiceError)
            throw error;
        if (error instanceof DemandOperationAuthorityContextError) {
            if (error.reason === "aborted")
                fail("aborted", error);
            if (error.reason === "stale-config")
                fail("config", error);
            fail("demand", error);
        }
        if (error instanceof DemandEventSourcingRootAuthorityError) {
            if (error.reason === "aborted")
                fail("aborted", error);
            fail("demand", error);
        }
        throw error;
    }
}
/** Evidence 身份从 Demand、来源键与负载摘要派生：同内容同一份记录，不消耗随机 UUID（D1）。 */
export function deriveManagedEvidenceId(demandId, selection, artifactDigest) {
    return deriveDurableId("evidence", "managed-evidence", demandId, managedEvidenceSourceKey(selection.source), artifactDigest);
}
function manifestFindings(review) {
    return Object.freeze(review.privacyFindings.flatMap((finding) => finding.kind === "unlisted-absolute-path" || finding.kind === "bare-uuid"
        ? [Object.freeze({ ref: finding.ref, line: finding.line, kind: finding.kind })]
        : []));
}
function createManifest(context, demandId, selection, captured, clock) {
    const needsReview = captured.review.opaqueFileRefs.length > 0 || captured.review.privacyFindings.length > 0;
    try {
        return createManagedEvidenceManifest({
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
        }, clock === undefined ? {} : { clock });
    }
    catch (error) {
        if (error instanceof ManagedEvidenceManifestError) {
            if (error.reason === "time")
                fail("time", error);
            fail("manifest", error);
        }
        throw error;
    }
}
export class ManagedEvidenceCapturePlanningService {
    #workspaceRoot;
    constructor(workspaceRoot) {
        if (typeof workspaceRoot !== "object" ||
            workspaceRoot === null ||
            types.isProxy(workspaceRoot) ||
            !(workspaceRoot instanceof RootedDirectory)) {
            fail("input");
        }
        this.#workspaceRoot = workspaceRoot;
    }
    /**
     * 读取当前 Authority 与来源，返回不含任何持久副作用的捕获结果：内容阻塞时返回阻塞项而不
     * 读时钟，否则返回完整 capture plan。
     */
    async preview(demandIdValue, selectionValue, optionsValue = {}) {
        const options = parseOptions(optionsValue);
        assertNotAborted(options.signal);
        const demandId = parseDemandId(demandIdValue);
        const selection = parseSelection(selectionValue);
        let context;
        let result;
        let failure;
        try {
            context = await openDemandOperationAuthorityContext(this.#workspaceRoot, demandId, options.signal);
            if (context.loaded.aggregate.state.lifecycle !== "active" ||
                context.loaded.identity.programId !== context.config.model.program.programId) {
                fail("demand");
            }
            const expectedDemand = demandExpectation(context);
            // Demand 所在 pod 的 worktree 检出路径进入隐私白名单：测试输出里出现自己的检出不算泄露。
            const workspaceRoot = this.#workspaceRoot;
            const podId = context.loaded.identity.podId;
            const worktreePaths = (await readKernelSource(() => listPodWorktreeReceiptsAnyHost(workspaceRoot, podId, options.signal === undefined ? {} : { signal: options.signal }), options.signal)).map((receipt) => receipt.path);
            const captured = await captureSelectedSource(this.#workspaceRoot, context.config, selection, worktreePaths, options.signal);
            const blockers = deriveManagedEvidenceContentBlockers(captured.review, selection.contentReview);
            if (blockers.length > 0) {
                result = Object.freeze({ status: "blocked", blockers, review: captured.review });
            }
            else {
                await assertAuthorityCurrent(this.#workspaceRoot, context, expectedDemand, options.signal);
                const manifest = createManifest(context, demandId, selection, captured, options.clock);
                try {
                    result = Object.freeze({
                        status: "ready",
                        plan: createManagedEvidenceCapturePlan({
                            configDigest: context.config.configDigest,
                            expectedDemand,
                            manifest,
                        }),
                        review: captured.review,
                        existing: context.loaded.aggregate.state.managedEvidence?.find((entry) => entry.evidenceId === manifest.evidenceId) ?? null,
                    });
                }
                catch (error) {
                    if (error instanceof ManagedEvidenceCapturePlanError)
                        fail("operation-failure", error);
                    throw error;
                }
            }
        }
        catch (error) {
            failure = error;
        }
        if (context !== undefined) {
            try {
                await closeDemandOperationAuthorityContext(context);
            }
            catch (error) {
                if (failure === undefined)
                    failure = error;
            }
        }
        if (failure !== undefined)
            rethrowPlanningError(failure);
        if (result === undefined)
            fail("operation-failure");
        return result;
    }
}
