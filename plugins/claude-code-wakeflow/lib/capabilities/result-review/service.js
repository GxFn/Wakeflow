import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { computeSha256Digest, parseSha256Digest, Sha256Error, } from "../../foundation/crypto/sha256.js";
import { parseJsonValue } from "../../foundation/data/json-value.js";
import { parsePortableResourcePath, PortableResourcePathError, } from "../../foundation/filesystem/portable-resource-path.js";
import { readStableFile, StableFileReadError, } from "../../foundation/filesystem/stable-file-read.js";
import { deriveUuidV4 } from "../../foundation/identity/uuid-v4.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import { readUtcWallClock } from "../../foundation/time/wall-clock.js";
import { buildDemandControllerRoute } from "../../governance/controller/demand-controller-route.js";
import { closeDemandOperationAuthorityContext, DemandOperationAuthorityContextError, openDemandOperationAuthorityContext, openDemandReadAuthorityContext, } from "../../governance/demand/demand-operation-authority-context.js";
import { DemandEventSourcingCommandHandlerError, executeDemandEventSourcingCommand, } from "../../governance/demand/event-sourcing/demand-event-sourcing-command-handler.js";
import { parseDemandEventSourcingCommand, } from "../../governance/demand/event-sourcing/demand-event-sourcing-decider.js";
import { DemandEventSourcingRepository, DemandEventSourcingRepositoryError, } from "../../governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { computeDemandEventStreamCommitDigest } from "../../governance/demand/event-sourcing/demand-event-stream-commit.js";
import { parseDemandEventStreamRevision } from "../../governance/demand/event-sourcing/demand-event-stream-position.js";
import { upcastDemandEventSourcingStoredEvent } from "../../governance/demand/event-sourcing/demand-event-sourcing-upcaster.js";
import { computeDemandAggregateStateDigest, decideTargetResultReviewInDemandAggregateState, } from "../../governance/demand/model/demand-aggregate-state.js";
import { MANAGED_EVIDENCE_MANIFEST_MAXIMUM_BYTES, MANAGED_EVIDENCE_PAYLOAD_LIMITS, } from "../../governance/evidence/managed-evidence-manifest.js";
import { loadManagedEvidenceRecord, ManagedEvidenceRecordReaderError, readManagedEvidencePayloadMember, } from "../../governance/evidence/managed-evidence-record-reader.js";
import { managedEvidenceRecordAddress } from "../../governance/evidence/managed-evidence-resource-paths.js";
import { createImplementationTargetResult, ImplementationTargetResultError, } from "../../governance/result/implementation-target-result.js";
import { createImplementationTargetResultReport, ImplementationTargetResultReportError, } from "../../governance/result/implementation-target-result-report.js";
import { computeTargetResultCallbackPromptDigest, deriveTargetResultCallbackId, deriveTargetResultCallbackStatus, parseTargetResultCallbackRecord, TARGET_RESULT_CALLBACK_SILENCE_MILLISECONDS, TargetResultCallbackError, } from "../../governance/result/target-result-callback.js";
import { createTestTargetResult, TestTargetResultError, } from "../../governance/result/test-target-result.js";
import { createTestTargetResultReport, TestTargetResultReportError, } from "../../governance/result/test-target-result-report.js";
import { createControllerImplementationReviewDecision, ControllerImplementationReviewDecisionError, } from "../../governance/review/controller-implementation-review-decision.js";
import { createControllerProductDefectRemediationAuthorization, ControllerProductDefectRemediationAuthorizationError, } from "../../governance/review/controller-product-defect-remediation-authorization.js";
import { normalizeControllerReviewEscalation, normalizeControllerReviewResumption, normalizeControllerTestReviewEscalation, } from "../../governance/review/controller-review-decision-contract.js";
import { createControllerTestReviewDecision, ControllerTestReviewDecisionError, } from "../../governance/review/controller-test-review-decision.js";
import { buildDemandResultReviewSnapshotFromHistory, readDemandResultReviewSnapshot, } from "../../governance/review/demand-result-review-snapshot.js";
import { afterMutationRefresh } from "../../governance/observation/active-projection-refresh.js";
import { runAppendCommand, } from "../../kernel/append-command.js";
import { commandShellExecutionOptions, runCommandShell } from "../../kernel/command-shell.js";
import { fail } from "../../kernel/error.js";
import { readHostHookObservations } from "../../kernel/hook-observations.js";
import { deriveNextProjection } from "../../kernel/next-projection.js";
import { DEFAULT_ALLOWED_ID_PREFIXES } from "../../kernel/privacy-scan.js";
import { releaseWorkClaimIfHeld } from "../../kernel/work-claims.js";
import { inspectWakeflowWindowHostBindingInventory, WakeflowWindowHostBindingStoreError, } from "../../workspace/window-runtime/wakeflow-window-host-binding-store.js";
import { compileWakeflowWindowHostBindingStoreAuthority } from "../../workspace/window-runtime/wakeflow-window-host-binding-store-authority.js";
import { compileWakeflowWindowLaunchIntents } from "../../workspace/window-runtime/wakeflow-window-launch-intent.js";
import { admitImplementationReviewDecisionResult, admitTargetResultImportResult, admitTargetResultReviewInspectionResult, admitTestReviewDecisionResult, parseImplementationReviewDecisionRequest, parseTargetResultImportRequest, parseTargetResultReviewInspectionRequest, parseTestReviewDecisionRequest, WAKEFLOW_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME, WAKEFLOW_RESULT_REVIEW_PUBLIC_SCHEMA_VERSION, WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME, WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME, WAKEFLOW_TEST_REVIEW_DECISION_PUBLIC_TOOL_NAME, } from "./contract.js";
import { collectEvidenceReferences, deriveCallbackLanding, deriveImplementationAllowedDecisions, deriveImplementationDecisionBlockers, derivePrivacyRules, deriveResumptionBlockers, deriveStepViews, deriveTargetCompletion, deriveTestAllowedDecisions, deriveTestDecisionBlockers, findReviewEscalationEventId, implementationPhaseForDecision, planEvidenceLocator, reportTexts, summarizeResultForCallback, testPhaseForDecision, } from "./decide.js";
import { renderWakeControllerPrompt } from "./prompt.js";
const REPORT_PRIVACY_POLICY = Object.freeze({
    allowedPathRoots: Object.freeze([]),
    allowedIdPrefixes: DEFAULT_ALLOWED_ID_PREFIXES,
});
const MANIFEST_READ_LIMIT = parseByteCount(MANAGED_EVIDENCE_MANIFEST_MAXIMUM_BYTES, "$limit");
const PAYLOAD_READ_LIMIT = parseByteCount(MANAGED_EVIDENCE_PAYLOAD_LIMITS.maxFileBytes, "$limit");
const HANDLER_ERROR_TABLE = Object.freeze({
    "concurrency-conflict": [
        "concurrency-conflict",
        "stream-revision",
        "$request.expectedStreamRevision",
    ],
    "idempotency-conflict": ["idempotency-mismatch", "request-digest", "$request.idempotencyKey"],
    "decision-rejected": ["precondition-failed", "decision-rejected", "$request"],
    aborted: ["io-failure", "aborted", "$signal"],
    input: ["invalid-request", "command", "$request"],
});
function signalOptions(signal) {
    return signal === undefined ? {} : { signal };
}
/** 第一个阻塞项的前缀是错误原因；全部阻塞项按 `blocker`、`blocker2`… 进入公开 details。 */
function rejectWith(blockers, path) {
    const first = blockers[0];
    if (first === undefined)
        fail("unexpected", "empty-blockers", path);
    fail("precondition-failed", first.split(":")[0] ?? first, path, {
        details: Object.fromEntries(blockers
            .slice(0, 8)
            .map((blocker, index) => [index === 0 ? "blocker" : `blocker${index + 1}`, blocker])),
    });
}
function mapContextError(error) {
    if (error instanceof DemandOperationAuthorityContextError) {
        if (error.reason === "aborted")
            fail("io-failure", "aborted", "$signal", { cause: error });
        if (error.reason === "root") {
            fail("root-invalid", "demand-root", "$request.demandId", { cause: error });
        }
        fail("precondition-failed", `authority-${error.reason}`, "$request", { cause: error });
    }
    throw error;
}
function mapHandlerError(error) {
    if (error instanceof DemandEventSourcingCommandHandlerError) {
        const [code, reason, path] = HANDLER_ERROR_TABLE[error.reason] ?? [
            "io-failure",
            "event-stream",
            "$request.demandId",
        ];
        fail(code, reason, path, { cause: error });
    }
    throw error;
}
function mapRepositoryError(error) {
    if (error instanceof DemandEventSourcingRepositoryError) {
        if (error.reason === "aborted")
            fail("io-failure", "aborted", "$signal", { cause: error });
        fail("io-failure", "event-stream", "$request.demandId", { cause: error });
    }
    throw error;
}
function mapRecordError(error, path) {
    if (error instanceof ImplementationTargetResultReportError ||
        error instanceof TestTargetResultReportError ||
        error instanceof ImplementationTargetResultError ||
        error instanceof TestTargetResultError ||
        error instanceof TargetResultCallbackError ||
        error instanceof ControllerImplementationReviewDecisionError ||
        error instanceof ControllerTestReviewDecisionError ||
        error instanceof ControllerProductDefectRemediationAuthorizationError) {
        fail("precondition-failed", `record-${error.reason}`, path, { cause: error });
    }
    throw error;
}
function sharedFail(reason, path) {
    fail("invalid-request", reason, `$request${path.slice(1)}`);
}
function nowFrom(options) {
    return readUtcWallClock(options.clock);
}
// ---- 上下文 -------------------------------------------------------------------
async function openContext(workspaceRoot, demandId, facade, options, mode) {
    try {
        const open = mode === "append" ? openDemandOperationAuthorityContext : openDemandReadAuthorityContext;
        const authority = await open(workspaceRoot, demandId, options.signal);
        return Object.freeze({ workspaceRoot, authority, facade, options });
    }
    catch (error) {
        mapContextError(error);
    }
}
async function closeContext(context) {
    try {
        await closeDemandOperationAuthorityContext(context.authority);
    }
    catch (error) {
        mapContextError(error);
    }
}
/** 追加前先核对观察到的流修订：过期修订不该先做 I/O 再在提交边界失败。 */
function assertFreshRevision(context, binding) {
    if (context.authority.loaded.aggregate.streamRevision !== binding.expectedStreamRevision) {
        fail("concurrency-conflict", "stream-revision", "$request.expectedStreamRevision", {
            details: { observed: String(context.authority.loaded.aggregate.streamRevision) },
        });
    }
}
/** Demand 所在 pod 的作用域：回调落到该 pod 的 Controller（ADR-0010 D2）。 */
function demandPodScope(context) {
    const podId = context.authority.loaded.identity.podId;
    const scope = Object.hasOwn(context.authority.config.indexes.podScopes, podId)
        ? context.authority.config.indexes.podScopes[podId]
        : undefined;
    if (scope === undefined) {
        fail("precondition-failed", "pod-unknown", "$request.demandId", { details: { podId } });
    }
    return scope;
}
/** worktree pod 的实现结果必须报分支：Codex 的 worktree 线程从 detached HEAD 起步（ADR-0010 D4）。 */
function assertWorktreeBranch(context, result) {
    if (result.workType !== "implementation")
        return;
    if (demandPodScope(context).pod.placement !== "worktree")
        return;
    if (result.report.repositoryChange.branch === null) {
        fail("precondition-failed", "worktree-branch-required", "$request.report.content.repositoryChange.branch");
    }
}
async function loadWindow(context, windowId) {
    const { facade, authority } = context;
    let bindings;
    try {
        const storeAuthority = compileWakeflowWindowHostBindingStoreAuthority(authority.config.model, facade.resourceProfile, facade.identityProfile);
        bindings = (await inspectWakeflowWindowHostBindingInventory(context.workspaceRoot, storeAuthority, signalOptions(context.options.signal))).bindings;
    }
    catch (error) {
        if (error instanceof WakeflowWindowHostBindingStoreError) {
            if (error.reason === "aborted")
                fail("io-failure", "aborted", "$signal", { cause: error });
            fail("precondition-failed", "binding-store", "$request.demandId", { cause: error });
        }
        throw error;
    }
    const binding = bindings.find((entry) => entry.windowId === windowId);
    if (binding === undefined)
        fail("precondition-failed", "binding-missing", "$request.demandId");
    if (binding.hostId !== facade.hostId) {
        fail("precondition-failed", "binding-host", "$request.demandId");
    }
    const intent = compileWakeflowWindowLaunchIntents(authority.config.model, facade.resourceProfile).intents.find((entry) => entry.windowId === windowId);
    if (intent === undefined)
        fail("precondition-failed", "window-unknown", "$request.demandId");
    return Object.freeze({
        binding,
        bindingDigest: computeCanonicalJsonSha256Digest(parseJsonValue(binding, "$binding")),
        handleDigest: computeSha256Digest(encodeUtf8(binding.handle.value, "$handle"), "$handle"),
        displayTitle: intent.displayTitle,
    });
}
async function sessionRecords(context, sessionId, since) {
    const inventory = await readHostHookObservations(context.workspaceRoot, context.facade.hostId, { sessionId, since }, signalOptions(context.options.signal));
    return inventory.records.map((record) => Object.freeze({
        recordId: record.recordId,
        event: record.event,
        promptDigest: record.promptDigest,
        recordedAt: record.recordedAt,
    }));
}
/** 某窗口当前绑定会话的 hook 记录；窗口尚无绑定时视为没有记录。 */
async function windowRecords(context, windowId, since) {
    const storeAuthority = compileWakeflowWindowHostBindingStoreAuthority(context.authority.config.model, context.facade.resourceProfile, context.facade.identityProfile);
    let binding;
    try {
        binding = (await inspectWakeflowWindowHostBindingInventory(context.workspaceRoot, storeAuthority, signalOptions(context.options.signal))).bindings.find((entry) => entry.windowId === windowId);
    }
    catch (error) {
        if (error instanceof WakeflowWindowHostBindingStoreError) {
            if (error.reason === "aborted")
                fail("io-failure", "aborted", "$signal", { cause: error });
            fail("precondition-failed", "binding-store", "$request.demandId", { cause: error });
        }
        throw error;
    }
    if (binding === undefined || binding.hostId !== context.facade.hostId)
        return Object.freeze([]);
    return sessionRecords(context, binding.handle.value, since);
}
// ---- 事件流 -------------------------------------------------------------------
async function loadHistory(repository, signal) {
    try {
        return await repository.auditTargetResultHistory(signalOptions(signal));
    }
    catch (error) {
        mapRepositoryError(error);
    }
}
async function boundCommit(repository, binding, signal) {
    try {
        const bound = await repository.findCommitByIdempotencyKey(binding.idempotencyKey, signalOptions(signal));
        if (bound !== null && bound.idempotency?.requestDigest !== binding.requestDigest) {
            fail("idempotency-mismatch", "request-digest", "$request.idempotencyKey");
        }
        return bound;
    }
    catch (error) {
        mapRepositoryError(error);
    }
}
async function appendCommand(repository, command, binding, signal) {
    try {
        return await executeDemandEventSourcingCommand(repository, command, {
            commitId: binding.commitId,
            expectedStreamRevision: binding.expectedStreamRevision,
            idempotency: { key: binding.idempotencyKey, requestDigest: binding.requestDigest },
            ...signalOptions(signal),
        });
    }
    catch (error) {
        mapHandlerError(error);
    }
}
function upcast(stored) {
    return upcastDemandEventSourcingStoredEvent(stored);
}
async function next(context, outcome) {
    const snapshot = await readDemandResultReviewSnapshot(context.authority.demandRoot, signalOptions(context.options.signal));
    const route = buildDemandControllerRoute({ ...context.authority.loaded, aggregate: outcome.commandResult.aggregate }, snapshot);
    return deriveNextProjection(route);
}
function receipts(commandResult) {
    const first = commandResult.commit.events[0];
    const last = commandResult.commit.events.at(-1);
    if (first === undefined || last === undefined)
        fail("unexpected", "commit-empty", "$result");
    return {
        event: { eventId: first.eventId, streamRevision: first.streamRevision },
        commit: {
            commitId: commandResult.commit.commitId,
            commitSequence: commandResult.commit.commitSequence,
            commitDigest: computeDemandEventStreamCommitDigest(commandResult.commit),
        },
        stateDigest: last.resultingStateDigest,
    };
}
function deliveryTargetOf(context, deliveryId) {
    const candidates = context.authority.loaded.aggregate.state.targetTasks.filter((entry) => entry.phase !== "planned" &&
        entry.phase !== "superseded" &&
        entry.currentDelivery.deliveryId === deliveryId);
    const target = candidates[0];
    if (target === undefined || candidates.length !== 1) {
        fail("not-found", "delivery-unknown", "$request.deliveryId");
    }
    return target;
}
const IMPORTABLE_PHASES = Object.freeze([
    "host-effect-accepted",
    "host-effect-indeterminate",
    "test-host-effect-accepted",
    "test-host-effect-indeterminate",
]);
async function loadEnvelope(repository, deliveryId, signal) {
    try {
        const located = await repository.findDeliveryPreparedEvent(deliveryId, signalOptions(signal));
        if (located === null)
            fail("not-found", "envelope-unknown", "$request.deliveryId");
        return located.event.data.envelope;
    }
    catch (error) {
        mapRepositoryError(error);
    }
}
async function loadTaskPackage(repository, taskPackageId, signal) {
    try {
        const located = await repository.findTargetTaskPlannedEvent(taskPackageId, signalOptions(signal));
        if (located === null)
            fail("precondition-failed", "task-package-missing", "$request.deliveryId");
        return located.event.data.taskPackage;
    }
    catch (error) {
        mapRepositoryError(error);
    }
}
/** 定位符只在同 Demand 的受管证据记录内解析，逐条核 sha256（§13.87 D3）。 */
async function resolveEvidence(context, references) {
    const recorded = new Set((context.authority.loaded.aggregate.state.managedEvidence ?? []).map((entry) => entry.evidenceId));
    const unresolved = [];
    const mismatched = [];
    const resolutions = [];
    for (const [index, reference] of references.entries()) {
        const resolved = await resolveEvidenceReference(context, reference, recorded);
        if (resolved === null)
            unresolved.push(index);
        else if (resolved === "kind-mismatch")
            mismatched.push(index);
        else
            resolutions.push(resolved);
    }
    if (unresolved.length > 0 || mismatched.length > 0) {
        rejectWith([
            ...unresolved.slice(0, 2).map((index) => `evidence-unresolved:${index}`),
            ...mismatched.slice(0, 2).map((index) => `evidence-kind-mismatch:${index}`),
        ], "$request.report");
    }
    return Object.freeze(resolutions);
}
/** 读取定位符指向的成员并返回它的摘要与字节数；manifest 走稳定读取，payload 成员经记录读取器核对。 */
async function readEvidenceMember(root, plan, signal) {
    if (plan.member === "manifest") {
        const read = await readStableFile(root, managedEvidenceRecordAddress(plan.evidenceId).manifestRef, { maximumBytes: MANIFEST_READ_LIMIT, ...signal });
        return Object.freeze({ digest: read.digest, bytes: Number(read.byteCount) });
    }
    const record = await loadManagedEvidenceRecord(root, plan.evidenceId, signal);
    const member = await readManagedEvidencePayloadMember(root, record, plan.memberRef, {
        maximumBytes: PAYLOAD_READ_LIMIT,
        ...signal,
    });
    return Object.freeze({ digest: member.member.digest, bytes: Number(member.member.bytes) });
}
function unresolvedOrRethrow(error) {
    if (error instanceof PortableResourcePathError || error instanceof Sha256Error)
        return null;
    if (error instanceof StableFileReadError || error instanceof ManagedEvidenceRecordReaderError) {
        if (error.reason === "aborted")
            fail("io-failure", "aborted", "$signal", { cause: error });
        return null;
    }
    throw error;
}
async function resolveEvidenceReference(context, reference, recorded) {
    const plan = planEvidenceLocator(reference.ref);
    if (plan === null || !recorded.has(plan.evidenceId))
        return null;
    try {
        const ref = parsePortableResourcePath(reference.ref, "$ref");
        const digest = parseSha256Digest(reference.digest, "$digest");
        const signal = signalOptions(context.options.signal);
        const facts = await readEvidenceMember(context.authority.demandRoot, plan, signal);
        if (facts.digest !== digest)
            return null;
        if (reference.kind !== null) {
            const record = await loadManagedEvidenceRecord(context.authority.demandRoot, plan.evidenceId, signal);
            if (record.manifest.kind !== reference.kind)
                return "kind-mismatch";
        }
        return Object.freeze({ ref, digest, evidenceId: plan.evidenceId, bytes: facts.bytes });
    }
    catch (error) {
        return unresolvedOrRethrow(error);
    }
}
function buildResult(input, target, envelope, taskPackage, options) {
    if (!("outcome" in target.currentDelivery)) {
        fail("precondition-failed", "outcome-missing", "$request.deliveryId");
    }
    const outcome = target.currentDelivery.outcome;
    if (outcome.disposition === "rejected-before-send") {
        fail("precondition-failed", "outcome-rejected", "$request.deliveryId");
    }
    const delivery = Object.freeze({
        generation: target.currentDelivery.generation,
        fence: Object.freeze({
            claimId: target.currentDelivery.fence.claimId,
            claimDigest: target.currentDelivery.fence.claimDigest,
        }),
        outcomeDigest: outcome.outcomeDigest,
        disposition: outcome.disposition,
        readbackStatus: outcome.readbackStatus,
        observedAt: outcome.observedAt,
    });
    const clock = options.clock === undefined ? {} : { clock: options.clock };
    try {
        if (input.report.workType === "test") {
            if (taskPackage.workType !== "test") {
                fail("precondition-failed", "work-type", "$request.report.workType");
            }
            const report = createTestTargetResultReport(input.report.content, clock);
            return createTestTargetResult({ taskPackage, envelope, delivery, report });
        }
        if (taskPackage.workType !== "implementation") {
            fail("precondition-failed", "work-type", "$request.report.workType");
        }
        const report = createImplementationTargetResultReport(input.report.content, clock);
        return createImplementationTargetResult({ taskPackage, envelope, delivery, report });
    }
    catch (error) {
        mapRecordError(error, "$request.report");
    }
}
async function issueCallback(context, result, taskPackage, streamRevision, now) {
    const scope = demandPodScope(context);
    const controllerWindowId = scope.controllerWindow.windowId;
    const window = await loadWindow(context, controllerWindowId);
    const summary = summarizeResultForCallback(result);
    const prompt = renderWakeControllerPrompt({
        language: context.authority.config.model.presentation.language,
        demandId: result.demandId,
        podId: `${scope.pod.name} (${scope.pod.podId})`,
        target: {
            targetTaskId: result.targetTaskId,
            taskPackageId: taskPackage.taskPackageId,
            workType: result.workType,
            objective: taskPackage.objective,
        },
        result: {
            targetResultId: result.targetResultId,
            resultDigest: result.resultDigest,
            outcome: summary.outcome,
            summary: summary.summary,
            branch: summary.branch,
            commits: summary.commits,
            verdict: summary.verdict,
            streamRevision,
        },
    });
    try {
        const callback = parseTargetResultCallbackRecord({
            callbackId: deriveTargetResultCallbackId(result.targetResultId),
            controllerWindowId,
            bindingId: window.binding.bindingId,
            bindingDigest: window.bindingDigest,
            portablePrompt: prompt,
            promptDigest: computeTargetResultCallbackPromptDigest(prompt),
            generation: 1,
            issuedAt: now,
        });
        return Object.freeze({ callback, window });
    }
    catch (error) {
        mapRecordError(error, "$request.deliveryId");
    }
}
/** 结果事件之后释放围栏声明；缺失或已易主都不是错误——事件已经提交，清理找不到目标不能否定它。 */
async function releaseFence(context, windowId, fence) {
    await releaseWorkClaimIfHeld(context.workspaceRoot, windowId, fence, signalOptions(context.options.signal));
}
async function replayImport(context, commandResult) {
    const stored = commandResult.commit.events[0];
    if (stored === undefined)
        fail("precondition-failed", "commit-empty", "$request.idempotencyKey");
    const event = upcast(stored);
    if (event.eventType !== "result.target-result-recorded") {
        fail("precondition-failed", "commit-kind", "$request.idempotencyKey");
    }
    const window = await loadWindow(context, event.data.callback.controllerWindowId);
    if (window.binding.bindingId !== event.data.callback.bindingId) {
        fail("precondition-failed", "binding-changed", "$request.idempotencyKey");
    }
    await releaseFence(context, event.data.result.assignment.windowId, event.data.result.delivery.fence);
    return Object.freeze({
        commandResult: Object.freeze({ ...commandResult, disposition: "idempotent" }),
        result: event.data.result,
        callback: event.data.callback,
        window,
    });
}
async function executeImport(context, input, binding) {
    const { authority, options } = context;
    const repository = new DemandEventSourcingRepository(authority.demandRoot);
    const bound = await boundCommit(repository, binding, options.signal);
    if (bound !== null) {
        return replayImport(context, { commit: bound, aggregate: authority.loaded.aggregate });
    }
    assertFreshRevision(context, binding);
    const target = deliveryTargetOf(context, input.deliveryId);
    if (!IMPORTABLE_PHASES.includes(target.phase)) {
        rejectWith([`target-phase:${target.phase}`], "$request.deliveryId");
    }
    if (target.currentDelivery.hostId !== context.facade.hostId) {
        fail("precondition-failed", "delivery-host", "$request.deliveryId");
    }
    if (target.currentDelivery.fence.claimDigest !== input.claimDigest) {
        fail("precondition-failed", "fence-mismatch", "$request.claimDigest");
    }
    const privacyRules = derivePrivacyRules(reportTexts(input.report.content), REPORT_PRIVACY_POLICY);
    if (privacyRules.length > 0) {
        rejectWith(privacyRules.map((rule) => `privacy:${rule}`), "$request.report");
    }
    const envelope = await loadEnvelope(repository, input.deliveryId, options.signal);
    if (envelope.workType !== input.report.workType) {
        fail("precondition-failed", "work-type", "$request.report.workType");
    }
    const taskPackage = await loadTaskPackage(repository, envelope.target.taskPackageId, options.signal);
    const evidenceResolution = await resolveEvidence(context, collectEvidenceReferences(input.report.content));
    const result = buildResult(input, target, envelope, taskPackage, options);
    assertWorktreeBranch(context, result);
    const now = nowFrom(options);
    const issued = await issueCallback(context, result, taskPackage, binding.expectedStreamRevision + 1, now);
    const command = parseDemandEventSourcingCommand({
        commandType: "result.record-target-result",
        commandVersion: 1,
        result,
        callback: issued.callback,
        evidenceResolution,
    });
    const commandResult = await appendCommand(repository, command, binding, options.signal);
    if (commandResult.disposition === "idempotent")
        return replayImport(context, commandResult);
    await releaseFence(context, envelope.route.windowId, result.delivery.fence);
    return Object.freeze({
        commandResult,
        result,
        callback: issued.callback,
        window: issued.window,
    });
}
function importResult(envelope, outcome, nextProjection) {
    const { callback, window } = outcome;
    return admitTargetResultImportResult({
        kind: "WakeflowTargetResultImportResult",
        schemaVersion: WAKEFLOW_RESULT_REVIEW_PUBLIC_SCHEMA_VERSION,
        tool: WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME,
        status: outcome.commandResult.disposition,
        demandId: envelope.demandId,
        result: outcome.result,
        callback: {
            callbackId: callback.callbackId,
            permit: {
                prompt: callback.portablePrompt,
                hostAction: {
                    effect: "send-prompt-to-window",
                    hostId: window.binding.hostId,
                    windowId: window.binding.windowId,
                    displayTitle: window.displayTitle,
                    bindingId: callback.bindingId,
                    handleDigest: window.handleDigest,
                },
                generation: callback.generation,
                issuedAt: callback.issuedAt,
            },
        },
        ...receipts(outcome.commandResult),
        next: nextProjection,
    });
}
/** 执行一次 `wakeflow_import_target_result`。 */
export async function executeTargetResultImportRequest(facade, value, options = {}) {
    return runAppendCommand({
        tool: WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME,
        parseRequest: (raw) => {
            const request = parseTargetResultImportRequest(raw);
            return Object.freeze({
                envelope: Object.freeze({
                    root: request.root,
                    demandId: request.demandId,
                    idempotencyKey: request.idempotencyKey,
                    expectedStreamRevision: request.expectedStreamRevision,
                }),
                input: Object.freeze({
                    deliveryId: request.deliveryId,
                    claimDigest: request.claimDigest,
                    report: request.report,
                }),
            });
        },
        open: (workspaceRoot, envelope) => openContext(workspaceRoot, envelope.demandId, facade, options, "append"),
        close: closeContext,
        privateValues: (context) => [context.authority.ledgerRoot.absolutePath],
        execute: (context, input, binding) => afterMutationRefresh(context.workspaceRoot, context.options.signal, () => executeImport(context, input, binding)),
        next,
        result: importResult,
    }, value, commandShellExecutionOptions(options.durability));
}
function targetPhaseLabel(target) {
    return target.status === "reported" ? "reported" : target.phase;
}
const RESUMABLE_PHASES = Object.freeze({
    "review-blocked": "review-blocked",
    "test-review-blocked": "review-blocked",
    escalated: "escalated",
    "test-escalated": "escalated",
});
function reviewUnitOf(history, target) {
    if (target.status === "awaiting-result")
        return null;
    const aggregateTarget = history.aggregate.state.targetTasks.find((entry) => entry.targetTaskId === target.targetTaskId);
    if (aggregateTarget === undefined)
        fail("unexpected", "target-missing", "$request");
    if (target.status === "reported") {
        return Object.freeze({
            status: "reported",
            target,
            aggregateTarget,
            currentDecision: null,
            currentDecisionSourceEvent: null,
            reviewUnitDigest: target.reviewUnitDigest,
            escalationEventId: null,
            escalationAnswered: false,
        });
    }
    const status = RESUMABLE_PHASES[target.phase];
    if (status === undefined)
        return null;
    const escalationEventId = findReviewEscalationEventId(history.escalations.map((entry) => ({
        eventId: entry.sourceEvent.eventId,
        source: entry.escalation.source,
    })), target.reviewDecision);
    const reviewUnitDigest = computeCanonicalJsonSha256Digest({
        status: "reported",
        targetTaskId: target.targetTaskId,
        outcome: target.outcome,
        taskPackageSourceEvent: target.taskPackageSourceEvent,
        taskPackage: target.taskPackage,
        targetResultSourceEvent: target.targetResultSourceEvent,
        targetResult: target.targetResult,
        priorReviewHistory: [
            ...target.priorReviewHistory,
            { sourceEvent: target.reviewDecisionSourceEvent, decision: target.reviewDecision },
        ],
    });
    return Object.freeze({
        status,
        target,
        aggregateTarget,
        currentDecision: target.reviewDecision,
        currentDecisionSourceEvent: target.reviewDecisionSourceEvent,
        reviewUnitDigest,
        escalationEventId,
        escalationAnswered: escalationEventId !== null &&
            history.decisionRecords.some((entry) => entry.decision.escalationEventId === escalationEventId),
    });
}
/** 完成证据来自目标窗口会话，回调落地来自 Controller 窗口会话；都按记录时间过滤。 */
async function loadReviewEvidence(context, unit) {
    const result = unit.target.targetResult;
    const aggregateTarget = unit.aggregateTarget;
    if (!("currentDelivery" in aggregateTarget) ||
        !("targetResult" in aggregateTarget.currentDelivery)) {
        fail("unexpected", "result-missing", "$request");
    }
    const callback = aggregateTarget.currentDelivery.targetResult.callback;
    const [targetRecords, callbackRecords] = await Promise.all([
        windowRecords(context, result.assignment.windowId, result.report.reportedAt),
        windowRecords(context, callback.controllerWindowId, callback.issuedAt),
    ]);
    return Object.freeze({
        targetCompletion: deriveTargetCompletion(targetRecords, result.report.reportedAt),
        callbackLanding: deriveCallbackLanding(callbackRecords, callback.promptDigest, callback.issuedAt),
        callbackRecords,
    });
}
function testResultView(history, result) {
    const source = history.taskPackages.find((entry) => entry.taskPackage.taskPackageId === result.taskPackage.taskPackageId);
    if (source === undefined || source.taskPackage.workType !== "test")
        return null;
    return Object.freeze({
        targetTaskId: result.targetTaskId,
        attemptOrdinal: result.testExecution.ordinal,
        steps: result.report.steps,
        itemIdByStepId: new Map(source.taskPackage.testContract.steps.map((step) => [step.stepId, step.requirementRef.itemId])),
    });
}
function testUnitView(history, unit, targetCompletion) {
    const { target, aggregateTarget } = unit;
    if (target.taskPackage.workType !== "test" ||
        target.targetResult.workType !== "test" ||
        aggregateTarget.workType !== "test" ||
        !("testAttempts" in aggregateTarget)) {
        return null;
    }
    const result = target.targetResult;
    const views = (results) => results.flatMap((entry) => {
        const view = entry.workType === "test" ? testResultView(history, entry) : null;
        return view === null ? [] : [view];
    });
    const priorAttempts = views(history.targetResults
        .map((entry) => entry.result)
        .filter((entry) => entry.workType === "test" &&
        entry.targetTaskId === result.targetTaskId &&
        entry.testExecution.ordinal < result.testExecution.ordinal));
    const lineage = target.taskPackage.lineage;
    const retested = views(lineage === null
        ? []
        : history.targetResults
            .map((entry) => entry.result)
            .filter((entry) => entry.targetTaskId === lineage.retestsTargetTaskId));
    const steps = deriveStepViews(target.taskPackage.testContract.steps, { steps: result.report.steps, stepIds: result.testExecution.stepIds }, priorAttempts, retested);
    const previous = priorAttempts.find((entry) => entry.attemptOrdinal === result.testExecution.ordinal - 1);
    return Object.freeze({
        taskPackage: target.taskPackage,
        steps,
        admission: Object.freeze({
            outcome: result.report.outcome,
            targetCompletion,
            steps,
            attemptCount: aggregateTarget.testAttempts.length,
            maxAttempts: target.taskPackage.testContract.maxAttempts,
            previouslyFlakyStepIds: Object.freeze((previous?.steps ?? [])
                .filter((step) => step.failure?.classification === "flaky")
                .map((step) => step.stepId)),
        }),
        attemptScope: Object.freeze({
            ordinal: result.testExecution.ordinal,
            stepIds: result.testExecution.stepIds,
        }),
    });
}
function decisionSummary(decision) {
    const shared = {
        targetReviewDecisionId: decision.targetReviewDecisionId,
        decisionDigest: decision.decisionDigest,
        decision: decision.decision,
        assessment: decision.assessment,
        independentChecks: decision.independentChecks,
        rationale: decision.rationale,
        blockingReasons: decision.blockingReasons,
        residualRisks: decision.residualRisks,
        resumption: decision.resumption,
        callbackLanding: decision.callbackLanding,
        targetCompletion: decision.targetCompletion,
        decidedAt: decision.decidedAt,
    };
    return decision.kind === "WakeflowControllerImplementationReviewDecision"
        ? { workType: "implementation", ...shared, escalation: decision.escalation }
        : {
            workType: "test",
            ...shared,
            stepIds: decision.stepIds,
            escalation: decision.escalation,
        };
}
function resumptionBasisView(unit) {
    if (unit.status === "reported")
        return null;
    if (unit.status === "review-blocked")
        return { kind: "condition-cleared" };
    if (unit.escalationEventId === null)
        fail("unexpected", "escalation-missing", "$request");
    return {
        kind: "decision-recorded",
        escalationEventId: unit.escalationEventId,
        answered: unit.escalationAnswered,
    };
}
/**
 * 允许的决定（§13.87 D6）：分类到决定的机器规则；升级尚未被用户回答时任何决定都不能记录，
 * 集合为空，`resumptionBasis.answered` 说明原因。
 */
function allowedDecisionsFor(unit, testView, targetCompletion, resumptionBasis) {
    if (resumptionBasis?.kind === "decision-recorded" && !resumptionBasis.answered) {
        return Object.freeze([]);
    }
    return testView === null
        ? deriveImplementationAllowedDecisions({ outcome: unit.target.outcome, targetCompletion })
        : deriveTestAllowedDecisions(testView.admission);
}
async function inspectReview(context, request) {
    const repository = new DemandEventSourcingRepository(context.authority.demandRoot);
    const history = await loadHistory(repository, context.options.signal);
    const snapshot = buildDemandResultReviewSnapshotFromHistory(history);
    if (snapshot.demand.lifecycle !== "active") {
        fail("precondition-failed", `lifecycle-${snapshot.demand.lifecycle}`, "$request.demandId");
    }
    const target = snapshot.targets.find((entry) => entry.targetTaskId === request.targetTaskId);
    if (target === undefined)
        fail("not-found", "target-unknown", "$request.targetTaskId");
    const unit = reviewUnitOf(history, target);
    if (unit === null)
        rejectWith([`target-phase:${targetPhaseLabel(target)}`], "$request.targetTaskId");
    const evidence = await loadReviewEvidence(context, unit);
    const aggregateTarget = unit.aggregateTarget;
    if (!("currentDelivery" in aggregateTarget) ||
        !("targetResult" in aggregateTarget.currentDelivery)) {
        fail("unexpected", "result-missing", "$request");
    }
    const callback = aggregateTarget.currentDelivery.targetResult.callback;
    const callbackStatus = deriveTargetResultCallbackStatus({
        issuedAt: callback.issuedAt,
        promptDigest: callback.promptDigest,
        landingRecords: evidence.callbackRecords,
        acknowledged: unit.currentDecision !== null,
        now: nowFrom(context.options),
        silenceMilliseconds: TARGET_RESULT_CALLBACK_SILENCE_MILLISECONDS,
    });
    const testView = testUnitView(history, unit, evidence.targetCompletion);
    const resumptionBasis = resumptionBasisView(unit);
    return admitTargetResultReviewInspectionResult({
        kind: "WakeflowTargetResultReviewInspectionResult",
        schemaVersion: WAKEFLOW_RESULT_REVIEW_PUBLIC_SCHEMA_VERSION,
        tool: WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME,
        status: "current",
        demand: snapshot.demand,
        eventStream: snapshot.eventStream,
        snapshotDigest: snapshot.snapshotDigest,
        reviewUnit: {
            status: unit.status,
            workType: unit.target.taskPackage.workType,
            targetTaskId: unit.target.targetTaskId,
            outcome: unit.target.outcome,
            taskPackageSourceEvent: unit.target.taskPackageSourceEvent,
            taskPackage: unit.target.taskPackage,
            targetResultSourceEvent: unit.target.targetResultSourceEvent,
            targetResult: unit.target.targetResult,
            priorReviewHistory: unit.target.priorReviewHistory.map((entry) => ({
                sourceEvent: entry.sourceEvent,
                decision: decisionSummary(entry.decision),
            })),
            reviewUnitDigest: unit.reviewUnitDigest,
            currentDecision: unit.currentDecision === null || unit.currentDecisionSourceEvent === null
                ? null
                : {
                    sourceEvent: unit.currentDecisionSourceEvent,
                    decision: decisionSummary(unit.currentDecision),
                },
            resumptionBasis,
            callback: {
                status: callbackStatus.status,
                generation: callback.generation,
                issuedAt: callback.issuedAt,
                landedRecordId: callbackStatus.landedRecordId,
            },
            targetCompletion: evidence.targetCompletion,
            allowedDecisions: allowedDecisionsFor(unit, testView, evidence.targetCompletion, resumptionBasis),
            testSteps: testView === null ? null : testView.steps,
            attemptScope: testView === null ? null : testView.attemptScope,
        },
    });
}
/** 执行一次 `wakeflow_inspect_target_result_review`。 */
export async function executeTargetResultReviewInspectionRequest(facade, value, options = {}) {
    return runCommandShell({
        tool: WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME,
        parseRequest: (raw) => {
            const request = parseTargetResultReviewInspectionRequest(raw);
            return { envelope: { root: request.root, demandId: request.demandId }, input: request };
        },
        open: (workspaceRoot, envelope) => openContext(workspaceRoot, envelope.demandId, facade, options, "read"),
        close: closeContext,
        privateValues: (context) => [context.authority.ledgerRoot.absolutePath],
    }, value, () => undefined, (context, binding) => inspectReview(context, binding.input), commandShellExecutionOptions(options.durability));
}
async function loadDecisionSources(context, request, workType) {
    const repository = new DemandEventSourcingRepository(context.authority.demandRoot);
    const history = await loadHistory(repository, context.options.signal);
    const snapshot = buildDemandResultReviewSnapshotFromHistory(history);
    if (snapshot.snapshotDigest !== request.snapshotDigest) {
        fail("precondition-failed", "snapshot-stale", "$request.snapshotDigest");
    }
    const target = snapshot.targets.find((entry) => entry.status !== "awaiting-result" &&
        entry.targetResult.targetResultId === request.targetResultId);
    if (target === undefined)
        fail("not-found", "result-unknown", "$request.targetResultId");
    const unit = reviewUnitOf(history, target);
    if (unit === null)
        rejectWith([`target-phase:${targetPhaseLabel(target)}`], "$request.targetResultId");
    if (unit.target.taskPackage.workType !== workType) {
        fail("precondition-failed", "work-type", "$request.targetResultId");
    }
    if (unit.reviewUnitDigest !== request.reviewUnitDigest) {
        fail("precondition-failed", "review-unit-stale", "$request.reviewUnitDigest");
    }
    const resumptionBlockers = deriveResumptionBlockers(resumptionSource(unit), request.resumption);
    if (resumptionBlockers.length > 0)
        rejectWith(resumptionBlockers, "$request.resumption");
    const evidence = await loadReviewEvidence(context, unit);
    return Object.freeze({ repository, history, unit, evidence });
}
function resumptionSource(unit) {
    return Object.freeze({
        status: unit.status,
        currentDecisionId: unit.currentDecision?.targetReviewDecisionId ?? null,
        escalationEventId: unit.escalationEventId,
        escalationAnswered: unit.escalationAnswered,
    });
}
function reviewedOf(sources, request) {
    const { target } = sources.unit;
    return Object.freeze({
        snapshotDigest: request.snapshotDigest,
        reviewUnitDigest: request.reviewUnitDigest,
        stateDigest: sources.history.aggregate.stateDigest,
        streamRevision: sources.history.aggregate.streamRevision,
        taskPackageId: target.taskPackage.taskPackageId,
        taskPackageDigest: target.targetResult.taskPackage.digest,
        targetResultId: target.targetResult.targetResultId,
        targetResultDigest: target.targetResult.resultDigest,
        targetResultOutcome: target.targetResult.report.outcome,
        targetResultReportedAt: target.targetResult.report.reportedAt,
    });
}
function decisionOptions(options) {
    return {
        ...(options.clock === undefined ? {} : { clock: options.clock }),
        ...(options.uuidFactory === undefined ? {} : { uuidFactory: options.uuidFactory }),
    };
}
function assertControllerAuthority(context, sources) {
    const programId = sources.unit.target.taskPackage.programId;
    if (context.authority.config.model.program.programId !== programId ||
        context.authority.loaded.identity.programId !== programId) {
        fail("precondition-failed", "controller-authority", "$request.demandId");
    }
}
function attachedEvents(commandResult) {
    let escalationEventId = null;
    let productDefectRemediationId = null;
    for (const stored of commandResult.commit.events.slice(1)) {
        const event = upcast(stored);
        if (event.eventType === "lifecycle.demand-escalated")
            escalationEventId = event.eventId;
        if (event.eventType === "review.product-defect-remediation-authorized") {
            productDefectRemediationId = event.data.authorization.productDefectRemediationId;
        }
    }
    return { escalationEventId, productDefectRemediationId };
}
function replayDecision(commandResult, kind) {
    const stored = commandResult.commit.events[0];
    if (stored === undefined)
        fail("precondition-failed", "commit-empty", "$request.idempotencyKey");
    const event = upcast(stored);
    if (event.eventType !== "review.target-result-decided" || event.data.decision.kind !== kind) {
        fail("precondition-failed", "commit-kind", "$request.idempotencyKey");
    }
    return Object.freeze({
        commandResult: Object.freeze({ ...commandResult, disposition: "idempotent" }),
        decision: event.data.decision,
        targetTaskId: event.data.decision.targetTaskId,
    });
}
function decisionReceiptBody(outcome) {
    const decision = outcome.decision;
    return {
        decision: {
            targetReviewDecisionId: decision.targetReviewDecisionId,
            decisionDigest: decision.decisionDigest,
            decision: decision.decision,
            decidedAt: decision.decidedAt,
            callbackLanding: decision.callbackLanding === null ? "unlanded" : "landed",
            targetCompletion: decision.targetCompletion === null ? "pending" : "confirmed",
        },
        ...receipts(outcome.commandResult),
    };
}
function aggregateTargetOf(outcome) {
    const target = outcome.commandResult.aggregate.state.targetTasks.find((entry) => entry.targetTaskId === outcome.targetTaskId);
    if (target === undefined)
        fail("unexpected", "target-missing", "$result");
    return target;
}
async function executeImplementationDecision(context, input, binding) {
    const { authority, options } = context;
    const { request } = input;
    const repository = new DemandEventSourcingRepository(authority.demandRoot);
    const bound = await boundCommit(repository, binding, options.signal);
    if (bound !== null) {
        return replayDecision({ commit: bound, aggregate: authority.loaded.aggregate }, "WakeflowControllerImplementationReviewDecision");
    }
    assertFreshRevision(context, binding);
    const sources = await loadDecisionSources(context, request, "implementation");
    assertControllerAuthority(context, sources);
    const blockers = deriveImplementationDecisionBlockers(request.decision, {
        outcome: sources.unit.target.outcome,
        targetCompletion: sources.evidence.targetCompletion,
    });
    if (blockers.length > 0)
        rejectWith(blockers, "$request.decision");
    let decision;
    try {
        decision = createControllerImplementationReviewDecision({
            programId: sources.unit.target.taskPackage.programId,
            demandId: request.demandId,
            targetTaskId: sources.unit.target.targetTaskId,
            controllerWindowId: authority.config.indexes.controllerWindow.windowId,
            reviewed: reviewedOf(sources, request),
            decision: request.decision,
            assessment: request.assessment,
            independentChecks: request.independentChecks,
            rationale: request.rationale,
            blockingReasons: request.blockingReasons,
            residualRisks: request.residualRisks,
            escalation: request.escalation === undefined
                ? null
                : normalizeControllerReviewEscalation(request.escalation, "$/escalation", sharedFail),
            resumption: request.resumption === undefined
                ? null
                : normalizeControllerReviewResumption(request.resumption, "$/resumption", sharedFail),
            callbackLanding: sources.evidence.callbackLanding,
            targetCompletion: sources.evidence.targetCompletion.status === "confirmed"
                ? {
                    recordId: sources.evidence.targetCompletion.recordId,
                    event: sources.evidence.targetCompletion.event,
                    observedAt: sources.evidence.targetCompletion.observedAt,
                }
                : null,
        }, decisionOptions(options));
    }
    catch (error) {
        mapRecordError(error, "$request.decision");
    }
    const command = parseDemandEventSourcingCommand({
        commandType: "review.decide-target-result",
        commandVersion: 1,
        decision,
    });
    const commandResult = await appendCommand(repository, command, binding, options.signal);
    if (commandResult.disposition === "idempotent") {
        return replayDecision(commandResult, "WakeflowControllerImplementationReviewDecision");
    }
    return Object.freeze({ commandResult, decision, targetTaskId: decision.targetTaskId });
}
function implementationDecisionResult(envelope, outcome, nextProjection) {
    const decision = outcome.decision;
    if (decision.kind !== "WakeflowControllerImplementationReviewDecision") {
        fail("unexpected", "decision-kind", "$result");
    }
    const target = aggregateTargetOf(outcome);
    if (target.workType === "test")
        fail("unexpected", "target-kind", "$result");
    const phase = outcome.commandResult.disposition === "committed"
        ? implementationPhaseForDecision(decision.decision)
        : target.phase;
    if (phase !== "accepted" &&
        phase !== "rework-requested" &&
        phase !== "review-blocked" &&
        phase !== "escalated") {
        fail("unexpected", "target-phase", "$result");
    }
    return admitImplementationReviewDecisionResult({
        kind: "WakeflowImplementationReviewDecisionResult",
        schemaVersion: WAKEFLOW_RESULT_REVIEW_PUBLIC_SCHEMA_VERSION,
        tool: WAKEFLOW_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME,
        status: outcome.commandResult.disposition,
        demandId: envelope.demandId,
        ...decisionReceiptBody(outcome),
        target: {
            targetTaskId: target.targetTaskId,
            phase,
            reworkCount: target.reworkCount ?? 0,
        },
        attached: { escalationEventId: attachedEvents(outcome.commandResult).escalationEventId },
        next: nextProjection,
    });
}
/** 执行一次 `wakeflow_record_implementation_review_decision`。 */
export async function executeImplementationReviewDecisionRequest(facade, value, options = {}) {
    return runAppendCommand({
        tool: WAKEFLOW_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME,
        parseRequest: (raw) => {
            const request = parseImplementationReviewDecisionRequest(raw);
            return Object.freeze({
                envelope: Object.freeze({
                    root: request.root,
                    demandId: request.demandId,
                    idempotencyKey: request.idempotencyKey,
                    expectedStreamRevision: request.expectedStreamRevision,
                }),
                input: Object.freeze({ request }),
            });
        },
        open: (workspaceRoot, envelope) => openContext(workspaceRoot, envelope.demandId, facade, options, "append"),
        close: closeContext,
        privateValues: (context) => [context.authority.ledgerRoot.absolutePath],
        execute: (context, input, binding) => afterMutationRefresh(context.workspaceRoot, context.options.signal, () => executeImplementationDecision(context, input, binding)),
        next,
        result: implementationDecisionResult,
    }, value, commandShellExecutionOptions(options.durability));
}
function stepIdTuple(values) {
    if (values === undefined)
        return null;
    const [first, ...rest] = values;
    if (first === undefined)
        fail("invalid-request", "step-ids", "$request.stepIds");
    return Object.freeze([first, ...rest]);
}
/**
 * `escalate{product-defect}` 的缺陷修复授权：失败步骤取自结果，基线取自测试任务包的
 * 实现基线，状态摘要是决定之后的聚合状态（§13.87 D5）。
 */
function remediationAuthorization(sources, decision, options) {
    if (decision.escalation?.classification !== "product-defect")
        return undefined;
    const { target } = sources.unit;
    if (target.taskPackage.workType !== "test" || target.targetResult.workType !== "test") {
        fail("unexpected", "work-type", "$request");
    }
    const decided = decideTargetResultReviewInDemandAggregateState(sources.history.aggregate.state, decision);
    // 授权身份从决定派生：同一决定永远得到同一授权与事件身份，也不消耗第二个 UUID。
    const authorizationUuidFactory = () => deriveUuidV4("product-defect-remediation", decision.targetReviewDecisionId);
    try {
        return createControllerProductDefectRemediationAuthorization({
            decision,
            routeSource: {
                reviewSnapshotDigest: decision.reviewed.snapshotDigest,
                stateDigest: computeDemandAggregateStateDigest(decided),
                streamRevision: parseDemandEventStreamRevision(decision.reviewed.streamRevision + 1),
            },
            testTaskPackage: {
                taskPackageId: target.taskPackage.taskPackageId,
                taskPackageDigest: target.targetResult.taskPackage.digest,
            },
            failedSteps: target.targetResult.report.steps
                .filter((step) => step.verdict === "fail")
                .map((step) => ({ stepId: step.stepId, observed: step.observed })),
            baselines: target.taskPackage.implementationBaselines,
        }, { ...decisionOptions(options), uuidFactory: authorizationUuidFactory });
    }
    catch (error) {
        mapRecordError(error, "$request.escalation");
    }
}
async function executeTestDecision(context, input, binding) {
    const { authority, options } = context;
    const { request } = input;
    const repository = new DemandEventSourcingRepository(authority.demandRoot);
    const bound = await boundCommit(repository, binding, options.signal);
    if (bound !== null) {
        return replayDecision({ commit: bound, aggregate: authority.loaded.aggregate }, "WakeflowControllerTestReviewDecision");
    }
    assertFreshRevision(context, binding);
    const sources = await loadDecisionSources(context, request, "test");
    assertControllerAuthority(context, sources);
    const testView = testUnitView(sources.history, sources.unit, sources.evidence.targetCompletion);
    if (testView === null || sources.unit.target.targetResult.workType !== "test") {
        fail("precondition-failed", "work-type", "$request.targetResultId");
    }
    const blockers = deriveTestDecisionBlockers(request, testView.admission);
    if (blockers.length > 0)
        rejectWith(blockers, "$request.decision");
    let decision;
    try {
        decision = createControllerTestReviewDecision({
            programId: sources.unit.target.taskPackage.programId,
            demandId: request.demandId,
            targetTaskId: sources.unit.target.targetTaskId,
            controllerWindowId: authority.config.indexes.controllerWindow.windowId,
            reviewed: reviewedOf(sources, request),
            testExecution: {
                testAttemptId: sources.unit.target.targetResult.testExecution.testAttemptId,
            },
            decision: request.decision,
            assessment: request.assessment,
            independentChecks: request.independentChecks,
            rationale: request.rationale,
            blockingReasons: request.blockingReasons,
            residualRisks: request.residualRisks,
            stepIds: stepIdTuple(request.stepIds),
            escalation: request.escalation === undefined
                ? null
                : normalizeControllerTestReviewEscalation(request.escalation, "$/escalation", sharedFail),
            resumption: request.resumption === undefined
                ? null
                : normalizeControllerReviewResumption(request.resumption, "$/resumption", sharedFail),
            callbackLanding: sources.evidence.callbackLanding,
            targetCompletion: sources.evidence.targetCompletion.status === "confirmed"
                ? {
                    recordId: sources.evidence.targetCompletion.recordId,
                    event: sources.evidence.targetCompletion.event,
                    observedAt: sources.evidence.targetCompletion.observedAt,
                }
                : null,
        }, decisionOptions(options));
    }
    catch (error) {
        mapRecordError(error, "$request.decision");
    }
    const authorization = remediationAuthorization(sources, decision, options);
    const command = parseDemandEventSourcingCommand({
        commandType: "review.decide-target-result",
        commandVersion: 1,
        decision,
        ...(authorization === undefined ? {} : { authorization }),
    });
    const commandResult = await appendCommand(repository, command, binding, options.signal);
    if (commandResult.disposition === "idempotent") {
        return replayDecision(commandResult, "WakeflowControllerTestReviewDecision");
    }
    return Object.freeze({ commandResult, decision, targetTaskId: decision.targetTaskId });
}
function testDecisionResult(envelope, outcome, nextProjection) {
    const decision = outcome.decision;
    if (decision.kind !== "WakeflowControllerTestReviewDecision") {
        fail("unexpected", "decision-kind", "$result");
    }
    const target = aggregateTargetOf(outcome);
    if (target.workType !== "test" || !("testAttempts" in target)) {
        fail("unexpected", "target-kind", "$result");
    }
    const phase = outcome.commandResult.disposition === "committed"
        ? testPhaseForDecision(decision.decision, decision.escalation?.classification ?? null)
        : target.phase;
    if (phase !== "test-accepted" &&
        phase !== "test-another-attempt-requested" &&
        phase !== "test-review-blocked" &&
        phase !== "test-product-defect" &&
        phase !== "test-escalated") {
        fail("unexpected", "target-phase", "$result");
    }
    return admitTestReviewDecisionResult({
        kind: "WakeflowTestReviewDecisionResult",
        schemaVersion: WAKEFLOW_RESULT_REVIEW_PUBLIC_SCHEMA_VERSION,
        tool: WAKEFLOW_TEST_REVIEW_DECISION_PUBLIC_TOOL_NAME,
        status: outcome.commandResult.disposition,
        demandId: envelope.demandId,
        ...decisionReceiptBody(outcome),
        target: {
            targetTaskId: target.targetTaskId,
            phase,
            attemptCount: target.testAttempts.length,
        },
        attached: attachedEvents(outcome.commandResult),
        next: nextProjection,
    });
}
/** 执行一次 `wakeflow_record_test_review_decision`。 */
export async function executeTestReviewDecisionRequest(facade, value, options = {}) {
    return runAppendCommand({
        tool: WAKEFLOW_TEST_REVIEW_DECISION_PUBLIC_TOOL_NAME,
        parseRequest: (raw) => {
            const request = parseTestReviewDecisionRequest(raw);
            return Object.freeze({
                envelope: Object.freeze({
                    root: request.root,
                    demandId: request.demandId,
                    idempotencyKey: request.idempotencyKey,
                    expectedStreamRevision: request.expectedStreamRevision,
                }),
                input: Object.freeze({ request }),
            });
        },
        open: (workspaceRoot, envelope) => openContext(workspaceRoot, envelope.demandId, facade, options, "append"),
        close: closeContext,
        privateValues: (context) => [context.authority.ledgerRoot.absolutePath],
        execute: (context, input, binding) => afterMutationRefresh(context.workspaceRoot, context.options.signal, () => executeTestDecision(context, input, binding)),
        next,
        result: testDecisionResult,
    }, value, commandShellExecutionOptions(options.durability));
}
