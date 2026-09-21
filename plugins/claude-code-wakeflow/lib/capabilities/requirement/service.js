import { readWakeflowConfigAuthoritySnapshot, WakeflowConfigAuthoritySnapshotError, } from "../../configuration/wakeflow-config-authority-snapshot.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { parseJsonValue } from "../../foundation/data/json-value.js";
import { parsePortableResourcePath, } from "../../foundation/filesystem/portable-resource-path.js";
import { RootedDirectory, RootedDirectoryError, } from "../../foundation/filesystem/rooted-directory.js";
import { StableFileReadError } from "../../foundation/filesystem/stable-file-read.js";
import { readStrictTextFile, StrictTextFileError, } from "../../foundation/filesystem/strict-text-file.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import { parseUtcInstant } from "../../foundation/time/utc-instant.js";
import { readUtcWallClock } from "../../foundation/time/wall-clock.js";
import { createRequirementRecord, LedgerAuthorityRecordError, } from "../../governance/ledger/ledger-authority-record.js";
import { LedgerAuthorityStore, LedgerAuthorityStoreError, } from "../../governance/ledger/ledger-authority-store.js";
import { commandShellExecutionOptions, runCommandShell } from "../../kernel/command-shell.js";
import { fail, WakeflowError } from "../../kernel/error.js";
import { runPublicationTransaction, } from "../../kernel/publication-transaction.js";
import { activateRequirementClaim, createRequirementClaimState, createRequirementClaimStateFile, listRequirementClaimStates, readRequirementClaimState, refreshRequirementBoardIndex, replaceRequirementClaimStateFile, withdrawRequirementClaim, } from "../../kernel/requirement-board.js";
import { admitBoardInspectionResult, admitRequirementPublicationResult, parseBoardInspectionRequest, parseRequirementPublicationRequest, WAKEFLOW_BOARD_INSPECTION_PUBLIC_TOOL_NAME, WAKEFLOW_REQUIREMENT_PUBLIC_SCHEMA_VERSION, WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME, } from "./contract.js";
import { analyzePackageDocuments, deriveClaimTransitionBlockers, derivePublishBlockers, deriveRequirementId, PRIVACY_BLOCKER_PREFIX, privacyBlockers, } from "./decide.js";
import { boardCounts, deriveRequirementNext, selectBoardEntries, toBoardEntry, } from "./projection.js";
const MEMBER_MAXIMUM_BYTES = parseByteCount(4 * 1024 * 1024, "$member.maximumBytes");
const MEDIA_TYPES = Object.freeze({
    md: "text/markdown",
    txt: "text/plain",
    json: "application/json",
    csv: "text/csv",
    yaml: "application/yaml",
    yml: "application/yaml",
    toml: "application/toml",
});
function signalOptions(signal) {
    return signal === undefined ? {} : { signal };
}
function mapStoreError(error) {
    if (error instanceof LedgerAuthorityStoreError) {
        switch (error.reason) {
            case "lock-timeout":
                fail("concurrency-conflict", "ledger-lock", "$ledger", { cause: error, retryable: true });
                break;
            case "conflict":
                fail("precondition-failed", "record-conflict", "$request.package", { cause: error });
                break;
            case "not-found":
                fail("not-found", "record-absent", "$request.requirementId", { cause: error });
                break;
            case "recovery-required":
            case "recovery-input-required":
                fail("recovery-required", "ledger-publication", "$ledger", { cause: error });
                break;
            case "aborted":
                fail("io-failure", "aborted", "$signal", { cause: error });
                break;
            default:
                fail("io-failure", `ledger-${error.reason}`, "$ledger", { cause: error });
        }
    }
    throw error;
}
async function openContext(root, options) {
    let snapshot;
    try {
        snapshot = await readWakeflowConfigAuthoritySnapshot(root, signalOptions(options.signal));
    }
    catch (error) {
        if (error instanceof WakeflowConfigAuthoritySnapshotError) {
            if (error.reason === "aborted")
                fail("io-failure", "aborted", "$signal", { cause: error });
            fail("precondition-failed", "config-authority", "$request.root", { cause: error });
        }
        throw error;
    }
    const placement = snapshot.placements.roots.find((entry) => entry.key === "ledger.root");
    if (placement === undefined || placement.state !== "present" || placement.realPath === null) {
        fail("precondition-failed", "ledger-root-missing", "$request.root");
    }
    let ledgerRoot;
    try {
        ledgerRoot = await RootedDirectory.open(placement.absolutePath, "$ledgerRoot");
    }
    catch (error) {
        if (error instanceof RootedDirectoryError) {
            fail("precondition-failed", "ledger-root", "$request.root", { cause: error });
        }
        throw error;
    }
    if (ledgerRoot.absolutePath !== placement.realPath) {
        await ledgerRoot.close();
        fail("precondition-failed", "ledger-root-alias", "$request.root");
    }
    return Object.freeze({
        root,
        snapshot,
        ledgerRoot,
        store: new LedgerAuthorityStore(ledgerRoot),
        clock: options.clock,
        signal: options.signal,
    });
}
function mediaTypeOf(path) {
    const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
    const mediaType = MEDIA_TYPES[extension];
    if (mediaType === undefined)
        fail("invalid-request", "attachment-media-type", "$request.package.attachments");
    return mediaType;
}
async function readSurfaceDocument(surface, role, sourcePath, recordPath, signal) {
    try {
        const read = await readStrictTextFile(surface, parsePortableResourcePath(sourcePath, "$request.package"), {
            maximumBytes: MEMBER_MAXIMUM_BYTES,
            ...signalOptions(signal),
        });
        return Object.freeze({
            role,
            path: parsePortableResourcePath(recordPath, "$request.package"),
            text: read.text,
            digest: read.digest,
        });
    }
    catch (error) {
        if (error instanceof StableFileReadError && error.reason === "not-found") {
            fail("not-found", "package-document", `$request.package.${role}`, { cause: error });
        }
        if (error instanceof StableFileReadError || error instanceof StrictTextFileError) {
            fail("invalid-request", `package-document-${error.reason}`, `$request.package.${role}`, {
                cause: error,
            });
        }
        throw error;
    }
}
function attachmentRecordPath(sourcePath) {
    const name = sourcePath.slice(sourcePath.lastIndexOf("/") + 1);
    return `attachments/${name}`;
}
/** 从设计面读全部成员；附件按文件名进入 `attachments/`，重名即拒绝。 */
async function readPackageDocuments(context, input) {
    const surface = context.snapshot.model.topology.supportSurfaces.find((entry) => entry.surfaceId === input.designSurfaceId && entry.capability === "design");
    if (surface === undefined)
        fail("not-found", "design-surface", "$request.package.designSurfaceId");
    const placement = context.snapshot.placements.roots.find((entry) => entry.key === `support.${input.designSurfaceId}.root`);
    if (placement === undefined || placement.state !== "present" || placement.realPath === null) {
        fail("precondition-failed", "design-surface-root", "$request.package.designSurfaceId");
    }
    let root;
    try {
        root = await RootedDirectory.open(placement.absolutePath, "$designRoot");
    }
    catch (error) {
        if (error instanceof RootedDirectoryError) {
            fail("precondition-failed", "design-surface-root", "$request.package.designSurfaceId", {
                cause: error,
            });
        }
        throw error;
    }
    try {
        if (root.absolutePath !== placement.realPath) {
            fail("precondition-failed", "design-surface-alias", "$request.package.designSurfaceId");
        }
        const attachments = input.attachments ?? [];
        const names = new Set(attachments.map(attachmentRecordPath));
        if (names.size !== attachments.length) {
            fail("invalid-request", "attachment-name-collision", "$request.package.attachments");
        }
        const documents = [
            await readSurfaceDocument(root, "requirement", input.requirementPath, "requirement.md", context.signal),
            await readSurfaceDocument(root, "landing", input.landingPath, "landing.md", context.signal),
        ];
        for (const attachment of [...attachments].sort()) {
            mediaTypeOf(attachment);
            documents.push(await readSurfaceDocument(root, "attachment", attachment, attachmentRecordPath(attachment), context.signal));
        }
        return Object.freeze(documents);
    }
    finally {
        await root.close();
    }
}
function assertOriginWindow(context, input) {
    if (context.snapshot.indexes.windowById[input.originWindowId] ===
        undefined) {
        fail("not-found", "origin-window", "$request.package.originWindowId");
    }
}
/** 记录成员按路径的码元顺序排列；这是 ledger 记录编解码器的要求。 */
function sortedByPath(documents) {
    return [...documents].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}
function planDigestOf(plan) {
    return computeCanonicalJsonSha256Digest(parseJsonValue(plan, "$plan"));
}
function recordDraft(context, input, documents, analysis, confirmationSectionDigest) {
    return {
        programId: context.snapshot.model.program.programId,
        title: input.title,
        demandType: input.demandType,
        priority: input.priority,
        originWindowId: input.originWindowId,
        testingDecision: { mode: input.testingDecision.mode, summary: input.testingDecision.summary },
        taskPlanReview: input.taskPlanReview ?? "controller",
        supersedes: (input.supersedes ?? null),
        parked: input.parked === undefined ? null : { trigger: input.parked.trigger },
        confirmation: {
            confirmedAt: parseUtcInstant(input.confirmation?.confirmedAt ?? "", "$request.package.confirmation"),
            sectionDigest: confirmationSectionDigest,
        },
        documents: sortedByPath(documents).map((document) => ({
            role: document.role,
            path: document.path,
            mediaType: document.role === "attachment" ? mediaTypeOf(document.path) : "text/markdown",
            digest: document.digest,
        })),
        sections: analysis.sections.map((section) => ({ ...section })),
    };
}
async function loadExistingRecord(context, requirementId) {
    try {
        return await context.store.loadRequirement(requirementId, signalOptions(context.signal));
    }
    catch (error) {
        if (error instanceof LedgerAuthorityStoreError && error.reason === "not-found")
            return null;
        mapStoreError(error);
    }
}
/** 请求了 supersedes 但看板上没有该包时为 `"unknown"`；未请求为 `null`。 */
async function supersededState(context, requirementId) {
    if (requirementId === undefined)
        return null;
    const source = await readRequirementClaimState(context.root, requirementId, context.signal);
    return source === null ? "unknown" : source.state;
}
async function planPublish(context, request, facts) {
    const input = request.package;
    assertOriginWindow(context, input);
    const documents = await readPackageDocuments(context, input);
    const analysis = analyzePackageDocuments(input.demandType, input.title, documents);
    const supersedes = await supersededState(context, input.supersedes);
    const confirmedAt = input.confirmation?.confirmedAt ?? null;
    const blockers = derivePublishBlockers({
        analysis,
        demandType: input.demandType,
        testingDecisionMode: input.testingDecision.mode,
        confirmedAt,
        supersedes,
        headerTexts: [
            { label: "testingDecision.summary", text: input.testingDecision.summary },
            ...(input.parked === undefined
                ? []
                : [{ label: "parked.trigger", text: input.parked.trigger }]),
        ],
    });
    // 隐私命中时不回显任何章节正文：阻塞项只说位置与类别。
    const privacyHit = blockers.some((blocker) => blocker.startsWith(PRIVACY_BLOCKER_PREFIX));
    facts.current = Object.freeze({
        summary: Object.freeze({
            title: input.title,
            demandType: input.demandType,
            priority: input.priority,
            testingDecision: input.testingDecision,
            sections: privacyHit ? [] : analysis.summary,
            missingSections: analysis.missing,
        }),
        requirementId: null,
    });
    if (blockers.length > 0 || analysis.confirmationSectionDigest === null || confirmedAt === null) {
        return Object.freeze({ status: "blocked", blockers, plan: null, digest: null });
    }
    const requirementId = deriveRequirementId({
        programId: context.snapshot.model.program.programId,
        designSurfaceId: input.designSurfaceId,
        title: input.title,
        demandType: input.demandType,
        priority: input.priority,
        originWindowId: input.originWindowId,
        testingDecision: input.testingDecision,
        taskPlanReview: input.taskPlanReview ?? "controller",
        supersedes: input.supersedes ?? null,
        parkedTrigger: input.parked?.trigger ?? null,
        documents,
        confirmedAt,
        confirmationSectionDigest: analysis.confirmationSectionDigest,
    });
    if (input.supersedes === requirementId) {
        return Object.freeze({
            status: "blocked",
            blockers: Object.freeze(["supersedes-self"]),
            plan: null,
            digest: null,
        });
    }
    facts.current = Object.freeze({ ...facts.current, requirementId });
    const plan = Object.freeze({
        action: "publish",
        requirementId,
        draft: recordDraft(context, input, documents, analysis, analysis.confirmationSectionDigest),
        supersedes: input.supersedes ?? null,
    });
    // preview 就把记录过一遍编解码器：apply 写不进去的记录在这里就报阻塞。
    try {
        candidateRecord(plan);
    }
    catch (error) {
        if (error instanceof LedgerAuthorityRecordError) {
            return Object.freeze({
                status: "blocked",
                blockers: Object.freeze([`record-invalid:${error.reason}`]),
                plan: null,
                digest: null,
            });
        }
        throw error;
    }
    return Object.freeze({
        status: "ready",
        blockers: Object.freeze([]),
        plan,
        digest: planDigestOf(plan),
    });
}
/** 记录字节由计划完全决定：`recordedAt` 取确认时间，重放与恢复都得到同一份记录。 */
function candidateRecord(plan) {
    return createRequirementRecord({ requirementId: plan.requirementId, ...plan.draft }, { clock: () => plan.draft.confirmation.confirmedAt });
}
async function planClaimTransition(context, request) {
    const source = await readRequirementClaimState(context.root, request.requirementId, context.signal);
    const blockers = [
        ...deriveClaimTransitionBlockers(request.action, source, request.expectedStateDigest),
        ...(request.action === "withdraw" ? privacyBlockers("reason", request.reason) : []),
    ];
    if (blockers.length > 0) {
        return Object.freeze({
            status: "blocked",
            blockers: Object.freeze(blockers),
            plan: null,
            digest: null,
        });
    }
    const plan = Object.freeze({
        action: request.action,
        requirementId: request.requirementId,
        expectedStateDigest: request.expectedStateDigest,
        reason: request.action === "withdraw" ? request.reason : null,
    });
    return Object.freeze({
        status: "ready",
        blockers: Object.freeze([]),
        plan,
        digest: planDigestOf(plan),
    });
}
function receiptOf(loaded, source) {
    return Object.freeze({
        requirementId: loaded.record.requirementId,
        recordRef: loaded.recordRef,
        recordDigest: loaded.recordDigest,
        status: source.state.status,
        revision: source.state.revision,
        stateDigest: source.digest,
    });
}
/** 记录去掉 `recordedAt` 后的内容摘要：同内容重发为 current。 */
function contentDigest(record) {
    const { recordedAt: _recordedAt, ...content } = record;
    return computeCanonicalJsonSha256Digest(parseJsonValue(content, "$record"));
}
async function ensureRecord(context, plan) {
    const candidate = candidateRecord(plan);
    const existing = await loadExistingRecord(context, plan.requirementId);
    if (existing !== null) {
        if (contentDigest(existing.record) !== contentDigest(candidate)) {
            fail("precondition-failed", "record-conflict", "$request.package");
        }
        return Object.freeze({ loaded: existing, wrote: false });
    }
    const members = await memberBytes(context, plan);
    try {
        await context.store.publish(candidate, members, signalOptions(context.signal));
    }
    catch (error) {
        mapStoreError(error);
    }
    const loaded = await loadExistingRecord(context, plan.requirementId);
    if (loaded === null)
        fail("recovery-required", "record-vanished", "$ledger");
    return Object.freeze({ loaded, wrote: true });
}
/** apply 时重读设计面成员；计划摘要已由内核比对，这里再核每个成员摘要。 */
async function memberBytes(context, plan) {
    const input = requestPackageOf(context);
    const documents = await readPackageDocuments(context, input);
    return sortedByPath(documents).map((document) => {
        const declared = plan.draft.documents.find((entry) => entry.path === document.path);
        if (declared === undefined || declared.digest !== document.digest) {
            fail("precondition-failed", "plan-drift", `$request.package`);
        }
        return Object.freeze({ path: document.path, bytes: encodeUtf8(document.text, "$member") });
    });
}
const requestPackages = new WeakMap();
function requestPackageOf(context) {
    const input = requestPackages.get(context);
    if (input === undefined)
        fail("unexpected", "package-input", "$request.package");
    return input;
}
/** 看板状态由记录补齐：搁置条件在记录头部，发布时间取当下；已存在即沿用。 */
async function ensureClaimState(context, loaded) {
    const record = loaded.record;
    const state = createRequirementClaimState({
        requirementId: record.requirementId,
        programId: record.programId,
        recordDigest: loaded.recordDigest,
        title: record.title,
        demandType: record.demandType,
        priority: record.priority,
        publishedAt: readUtcWallClock(context.clock),
        supersedes: record.supersedes,
        parkedTrigger: record.parked?.trigger ?? null,
    });
    const existing = await readRequirementClaimState(context.root, record.requirementId, context.signal);
    if (existing === null) {
        await createRequirementClaimStateFile(context.root, state, context.signal);
    }
    const source = await readRequirementClaimState(context.root, record.requirementId, context.signal);
    if (source === null)
        fail("recovery-required", "claim-state-vanished", "$board");
    return source;
}
async function withdrawSuperseded(context, supersedes, successor, at) {
    if (supersedes === null)
        return null;
    const source = await readRequirementClaimState(context.root, supersedes, context.signal);
    if (source === null)
        return null;
    let current = source;
    if (source.state.status === "pending" || source.state.status === "parked") {
        const next = withdrawRequirementClaim(source.state, `superseded-by:${successor}`, at);
        await replaceRequirementClaimStateFile(context.root, source, next, context.signal);
        const reread = await readRequirementClaimState(context.root, supersedes, context.signal);
        if (reread === null)
            fail("recovery-required", "claim-state-vanished", "$board");
        current = reread;
    }
    const loaded = await loadExistingRecord(context, supersedes);
    if (loaded === null)
        fail("recovery-required", "record-vanished", "$ledger");
    return receiptOf(loaded, current);
}
async function pendingCount(context) {
    const listing = await listRequirementClaimStates(context.root, context.signal);
    return listing.states.filter((state) => state.status === "pending").length;
}
/** 索引是自愈的投影：权威状态已提交，与并发写者的争用不能让本次调用报失败。 */
async function refreshBoardIndexQuietly(context) {
    try {
        await refreshRequirementBoardIndex(context.root, context.signal);
    }
    catch (error) {
        if (!(error instanceof WakeflowError) || error.reason !== "board-index-contended")
            throw error;
    }
}
async function applyPublish(context, plan) {
    const { loaded, wrote } = await ensureRecord(context, plan);
    const source = await ensureClaimState(context, loaded);
    const superseded = await withdrawSuperseded(context, plan.supersedes, plan.requirementId, parseUtcInstant(source.state.publishedAt, "$claimState.publishedAt"));
    await refreshBoardIndexQuietly(context);
    return Object.freeze({
        disposition: wrote ? "published" : "current",
        package: receiptOf(loaded, source),
        superseded,
        pendingCount: await pendingCount(context),
    });
}
async function applyClaimTransition(context, plan) {
    const source = await readRequirementClaimState(context.root, plan.requirementId, context.signal);
    if (source === null)
        fail("not-found", "package-unknown", "$request.requirementId");
    if (source.digest !== plan.expectedStateDigest) {
        fail("concurrency-conflict", "claim-state-drift", "$request.expectedStateDigest", {
            retryable: false,
        });
    }
    const at = readUtcWallClock(context.clock);
    const next = plan.action === "activate"
        ? activateRequirementClaim(source.state, at)
        : withdrawRequirementClaim(source.state, plan.reason ?? "withdrawn", at);
    await replaceRequirementClaimStateFile(context.root, source, next, context.signal);
    await refreshBoardIndexQuietly(context);
    const reread = await readRequirementClaimState(context.root, plan.requirementId, context.signal);
    if (reread === null)
        fail("recovery-required", "claim-state-vanished", "$board");
    const loaded = await loadExistingRecord(context, plan.requirementId);
    if (loaded === null)
        fail("recovery-required", "record-vanished", "$ledger");
    return Object.freeze({
        disposition: plan.action === "activate" ? "activated" : "withdrawn",
        package: receiptOf(loaded, reread),
        superseded: null,
        pendingCount: await pendingCount(context),
    });
}
/** recover：记录是权威，看板可由记录补齐；被替代包若仍待认领则撤回。 */
async function recoverPublish(context, requirementId) {
    try {
        await context.store.recoverRecordPublication(requirementId, signalOptions(context.signal));
    }
    catch (error) {
        if (!(error instanceof LedgerAuthorityStoreError && error.reason === "not-found"))
            mapStoreError(error);
    }
    const loaded = await loadExistingRecord(context, requirementId);
    if (loaded === null)
        fail("not-found", "record-absent", "$request.operationId");
    const source = await ensureClaimState(context, loaded);
    const superseded = await withdrawSuperseded(context, loaded.record.supersedes, requirementId, parseUtcInstant(source.state.publishedAt, "$claimState.publishedAt"));
    await refreshBoardIndexQuietly(context);
    return Object.freeze({
        disposition: "recovered",
        package: receiptOf(loaded, source),
        superseded,
        pendingCount: await pendingCount(context),
    });
}
function nextOf(phase) {
    if (phase.mode === "preview") {
        return deriveRequirementNext({
            confirmationMissing: phase.planned.blockers.includes("user-confirmation-missing"),
            awaitingApply: phase.planned.status === "ready",
            pendingCount: 0,
        });
    }
    return deriveRequirementNext({
        confirmationMissing: false,
        awaitingApply: false,
        pendingCount: phase.outcome.pendingCount,
    });
}
function assembleResult(envelope, input, phase, next, facts) {
    const base = {
        schemaVersion: WAKEFLOW_REQUIREMENT_PUBLIC_SCHEMA_VERSION,
        tool: WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME,
        next,
    };
    if (phase.mode === "preview") {
        if (input.mode === "recover")
            fail("unexpected", "preview-mode", "$request.mode");
        return admitRequirementPublicationResult({
            ...base,
            kind: "WakeflowRequirementPublicationPreview",
            mode: "preview",
            action: input.action,
            status: phase.planned.status,
            blockers: phase.planned.blockers,
            planDigest: phase.planned.digest,
            requirementId: facts.requirementId,
            summary: facts.summary,
        });
    }
    const action = input.mode === "recover" ? "publish" : input.action;
    return admitRequirementPublicationResult({
        ...base,
        kind: "WakeflowRequirementPublicationMutation",
        mode: envelope.mode,
        action,
        disposition: phase.outcome.disposition,
        package: phase.outcome.package,
        superseded: phase.outcome.superseded,
    });
}
/** 执行一次 `wakeflow_publish_requirement`。 */
export async function executeRequirementPublicationRequest(value, options = {}) {
    const facts = { current: Object.freeze({ summary: null, requirementId: null }) };
    return runPublicationTransaction({
        tool: WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME,
        parseRequest: (raw) => {
            const request = parseRequirementPublicationRequest(raw);
            if (request.mode === "recover") {
                return {
                    envelope: {
                        root: request.root,
                        mode: "recover",
                        planDigest: null,
                        operationId: request.operationId,
                    },
                    input: request,
                };
            }
            return {
                envelope: {
                    root: request.root,
                    mode: request.mode,
                    planDigest: request.mode === "apply"
                        ? (request.planDigest ?? null)
                        : null,
                    operationId: null,
                },
                input: request,
            };
        },
        open: (root) => openContext(root, options),
        close: async (context) => {
            await context.ledgerRoot.close();
        },
        plan: async (context, input) => {
            if (input.mode === "recover")
                fail("unexpected", "plan-mode", "$request.mode");
            if (input.action === "publish") {
                requestPackages.set(context, input.package);
                return planPublish(context, input, facts);
            }
            return planClaimTransition(context, input);
        },
        apply: (context, _input, plan) => plan.action === "publish"
            ? applyPublish(context, plan)
            : applyClaimTransition(context, plan),
        recover: (context, operationId) => recoverPublish(context, operationId),
        next: async (_context, phase) => nextOf(phase),
        result: (envelope, input, phase, next) => assembleResult(envelope, input, phase, next, facts.current),
        privateValues: (context) => [context.snapshot.ledgerRoot, context.ledgerRoot.absolutePath],
    }, value, commandShellExecutionOptions(options.durability));
}
function recordView(loaded) {
    const record = loaded.record;
    return {
        recordRef: loaded.recordRef,
        originWindowId: record.originWindowId,
        testingDecision: record.testingDecision,
        taskPlanReview: record.taskPlanReview,
        confirmedAt: record.confirmation.confirmedAt,
        documents: record.documents.map((document) => ({
            role: document.role,
            path: document.path,
            mediaType: document.mediaType,
            digest: document.digest,
        })),
        sections: record.sections.map((section) => ({
            path: section.path,
            anchor: section.anchor,
            heading: section.heading,
            line: section.line,
        })),
    };
}
async function inspectBoard(context, request) {
    const listing = await listRequirementClaimStates(context.root, context.signal);
    const counts = boardCounts(listing.states);
    const next = deriveRequirementNext({
        confirmationMissing: false,
        awaitingApply: false,
        pendingCount: counts.pending,
    });
    const base = {
        schemaVersion: WAKEFLOW_REQUIREMENT_PUBLIC_SCHEMA_VERSION,
        tool: WAKEFLOW_BOARD_INSPECTION_PUBLIC_TOOL_NAME,
        next,
    };
    if (request.view === "list") {
        const limit = request.limit ?? 50;
        const selected = selectBoardEntries(listing.states, request.filter ?? {}, limit);
        return admitBoardInspectionResult({
            ...base,
            kind: "WakeflowBoardList",
            view: "list",
            counts,
            totalMatched: selected.totalMatched,
            truncated: selected.totalMatched > selected.entries.length || listing.skipped > 0,
            packages: selected.entries,
        });
    }
    const source = await readRequirementClaimState(context.root, request.requirementId, context.signal);
    if (source === null)
        fail("not-found", "package-unknown", "$request.requirementId");
    const loaded = await loadExistingRecord(context, request.requirementId);
    if (loaded === null)
        fail("not-found", "record-absent", "$request.requirementId");
    return admitBoardInspectionResult({
        ...base,
        kind: "WakeflowBoardPackage",
        view: "package",
        package: toBoardEntry(source.state, source.digest),
        record: recordView(loaded),
    });
}
/** 执行一次 `wakeflow_inspect_board`。 */
export async function executeBoardInspectionRequest(value, options = {}) {
    return runCommandShell({
        tool: WAKEFLOW_BOARD_INSPECTION_PUBLIC_TOOL_NAME,
        parseRequest: (raw) => {
            const request = parseBoardInspectionRequest(raw);
            return { envelope: { root: request.root }, input: request };
        },
        open: async (root) => {
            const context = await openContext(root, options);
            return Object.freeze({
                root: context.root,
                snapshot: context.snapshot,
                ledgerRoot: context.ledgerRoot,
                store: context.store,
                signal: context.signal,
            });
        },
        close: async (context) => {
            await context.ledgerRoot.close();
        },
        privateValues: (context) => [context.snapshot.ledgerRoot, context.ledgerRoot.absolutePath],
    }, value, () => { }, (context, binding) => inspectBoard(context, binding.input), commandShellExecutionOptions(options.durability));
}
