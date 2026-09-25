import path from "node:path";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { computeSha256Digest } from "../../foundation/crypto/sha256.js";
import { parseJsonValue } from "../../foundation/data/json-value.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import { parseUtcInstant, UtcInstantError, } from "../../foundation/time/utc-instant.js";
import { readUtcWallClock } from "../../foundation/time/wall-clock.js";
import { buildDemandControllerRoute } from "../../governance/controller/demand-controller-route.js";
import { computeDeliveryPromptDigest, createDeliveryEnvelope, DeliveryEnvelopeError, deliveryTaskPackageRef, } from "../../governance/delivery/delivery-envelope.js";
import { createDeliveryOutcome, DeliveryOutcomeError, } from "../../governance/delivery/delivery-outcome.js";
import { createDeliveryRearm, DeliveryRearmError, } from "../../governance/delivery/delivery-rearm.js";
import { createTargetDeliveryProductDefectRemediationContext, TargetDeliveryProductDefectRemediationContextError, } from "../../governance/delivery/target-delivery-product-defect-remediation-context.js";
import { createTargetDeliveryReworkContext, TargetDeliveryReworkContextError, } from "../../governance/delivery/target-delivery-rework-context.js";
import { closeDemandOperationAuthorityContext, DemandOperationAuthorityContextError, openDemandOperationAuthorityContext, } from "../../governance/demand/demand-operation-authority-context.js";
import { demandFinalRootRef } from "../../governance/demand/publication/demand-publication-paths.js";
import { listPodWorktreeReceipts, readPodWorktreeReceipt, } from "../../kernel/pod-worktree-receipts.js";
import { DemandEventSourcingCommandHandlerError, executeDemandEventSourcingCommand, } from "../../governance/demand/event-sourcing/demand-event-sourcing-command-handler.js";
import { parseDemandEventSourcingCommand, } from "../../governance/demand/event-sourcing/demand-event-sourcing-decider.js";
import { DemandEventSourcingRepository, DemandEventSourcingRepositoryError, } from "../../governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { computeDemandEventStreamCommitDigest } from "../../governance/demand/event-sourcing/demand-event-stream-commit.js";
import { upcastDemandEventSourcingStoredEvent } from "../../governance/demand/event-sourcing/demand-event-sourcing-upcaster.js";
import { deriveTargetResultCallbackStatus, parseTargetResultCallbackReissue, TARGET_RESULT_CALLBACK_GENERATION_LIMIT, TARGET_RESULT_CALLBACK_SILENCE_MILLISECONDS, TargetResultCallbackError, } from "../../governance/result/target-result-callback.js";
import { ControllerImplementationReviewDecisionError, parseControllerImplementationReviewDecision, } from "../../governance/review/controller-implementation-review-decision.js";
import { DemandResultReviewSnapshotError, readDemandResultReviewSnapshot, } from "../../governance/review/demand-result-review-snapshot.js";
import { afterMutationRefresh } from "../../governance/observation/active-projection-refresh.js";
import { computeTaskPackageDigest, } from "../../governance/tasking/task-package.js";
import { createInitialTestExecutionAttempt, createRerunTestExecutionAttempt, TestExecutionAttemptError, } from "../../governance/testing/test-execution-attempt.js";
import { runAppendCommand, } from "../../kernel/append-command.js";
import { commandShellExecutionOptions } from "../../kernel/command-shell.js";
import { fail, failWithBlockers as rejectWith } from "../../kernel/error.js";
import { readHostHookObservations } from "../../kernel/hook-observations.js";
import { deriveDurableId } from "../../kernel/ids.js";
import { deriveNextProjection } from "../../kernel/next-projection.js";
import { createWorkClaim, deriveWorkClaimId, inspectWorkClaim, releaseWorkClaim, releaseWorkClaimIfHeld, takeWorkClaim, } from "../../kernel/work-claims.js";
import { inspectWakeflowWindowHostBindingInventory, WakeflowWindowHostBindingStoreError, } from "../../workspace/window-runtime/wakeflow-window-host-binding-store.js";
import { compileWakeflowWindowHostBindingStoreAuthority } from "../../workspace/window-runtime/wakeflow-window-host-binding-store-authority.js";
import { compileWakeflowWindowLaunchIntents, } from "../../workspace/window-runtime/wakeflow-window-launch-intent.js";
import { admitPrepareDeliveryResult, admitRearmDeliveryResult, admitRecordDeliveryOutcomeResult, parsePrepareDeliveryRequest, parseRearmDeliveryRequest, parseRecordDeliveryOutcomeRequest, WAKEFLOW_DELIVERY_PUBLIC_SCHEMA_VERSION, WAKEFLOW_PREPARE_DELIVERY_PUBLIC_TOOL_NAME, WAKEFLOW_REARM_DELIVERY_PUBLIC_TOOL_NAME, WAKEFLOW_RECORD_DELIVERY_OUTCOME_PUBLIC_TOOL_NAME, } from "./contract.js";
import { deriveClaimBlocker, deriveDeliveryDisposition, derivePrepareBlockers, deriveRearmBlockers, landingSilenceExceeded, sendReturnProvesLanding, } from "./decide.js";
import { renderDeliveryPortablePrompt } from "./prompt.js";
function isCallbackPermit(outcome) {
    return "kind" in outcome && outcome.kind === "callback";
}
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
    if (error instanceof DeliveryEnvelopeError ||
        error instanceof DeliveryOutcomeError ||
        error instanceof DeliveryRearmError ||
        error instanceof TargetResultCallbackError ||
        error instanceof TestExecutionAttemptError ||
        error instanceof TargetDeliveryReworkContextError ||
        error instanceof TargetDeliveryProductDefectRemediationContextError) {
        fail("precondition-failed", `record-${error.reason}`, path, { cause: error });
    }
    throw error;
}
function nowFrom(options) {
    return readUtcWallClock(options.clock);
}
function parseInstant(value, path) {
    try {
        return parseUtcInstant(value, path);
    }
    catch (error) {
        if (error instanceof UtcInstantError)
            fail("invalid-request", "time", path, { cause: error });
        throw error;
    }
}
// ---- 上下文与路由 ---------------------------------------------------------------
async function openContext(workspaceRoot, envelope, facade, options) {
    try {
        const authority = await openDemandOperationAuthorityContext(workspaceRoot, envelope.demandId, options.signal);
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
/** 追加前先核对观察到的流修订：过期修订不该先取声明再在提交边界失败。 */
function assertFreshRevision(context, binding) {
    if (context.authority.loaded.aggregate.streamRevision !== binding.expectedStreamRevision) {
        fail("concurrency-conflict", "stream-revision", "$request.expectedStreamRevision", {
            details: { observed: String(context.authority.loaded.aggregate.streamRevision) },
        });
    }
}
function targetOf(context, targetTaskId) {
    const target = context.authority.loaded.aggregate.state.targetTasks.find((entry) => entry.targetTaskId === targetTaskId);
    if (target === undefined)
        fail("not-found", "target-unknown", "$request.targetTaskId");
    return target;
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
function relativeWorkspaceRoot(placement) {
    const depth = placement
        .split("/")
        .filter((segment) => segment.length > 0 && segment !== ".").length;
    return depth === 0 ? "." : Array.from({ length: depth }, () => "..").join("/");
}
async function readBinding(context, windowId) {
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
            fail("precondition-failed", "binding-store", "$request.targetTaskId", { cause: error });
        }
        throw error;
    }
    const binding = bindings.find((entry) => entry.windowId === windowId);
    if (binding === undefined)
        fail("precondition-failed", "binding-missing", "$request.targetTaskId");
    if (binding.hostId !== facade.hostId) {
        fail("precondition-failed", "binding-host", "$request.targetTaskId");
    }
    return binding;
}
function digestBinding(binding) {
    return computeCanonicalJsonSha256Digest(parseJsonValue(binding, "$binding"));
}
async function loadRoute(context, windowId) {
    const { facade, authority } = context;
    const binding = await readBinding(context, windowId);
    const intent = compileWakeflowWindowLaunchIntents(authority.config.model, facade.resourceProfile).intents.find((entry) => entry.windowId === windowId);
    if (intent === undefined)
        fail("precondition-failed", "window-unknown", "$request.targetTaskId");
    return Object.freeze({
        binding,
        bindingDigest: digestBinding(binding),
        handleDigest: computeSha256Digest(encodeUtf8(binding.handle.value, "$handle"), "$handle"),
        displayTitle: intent.displayTitle,
        configuredPlacement: intent.root.configuredPlacement,
        podId: intent.podId,
        podName: intent.podName,
        podPlacement: intent.podPlacement,
        worktreePath: await worktreePathFor(context, intent, binding),
    });
}
/** worktree pod 的产品窗口：投递准备要求 worktree 回执存在且与当前绑定同代（能力卡 6，ADR-0010）。 */
async function worktreePathFor(context, intent, binding) {
    if (intent.worktree === null)
        return null;
    const receipt = await readPodWorktreeReceipt(context.workspaceRoot, context.facade.hostId, intent.podId, intent.worktree.repositoryId, signalOptions(context.options.signal));
    if (receipt === null) {
        fail("precondition-failed", "worktree-receipt-missing", "$request.targetTaskId");
    }
    if (receipt.bindingId !== binding.bindingId) {
        fail("precondition-failed", "worktree-receipt-stale", "$request.targetTaskId");
    }
    return receipt.path;
}
/** Test 窗口以附加目录方式读 pod 的 worktree：每仓库一条相对本窗口根的路径（ADR-0010 D4）。 */
async function attachedWorktreesFor(context, taskPackage, route) {
    if (taskPackage.workType !== "test" || route.podPlacement !== "worktree")
        return Object.freeze([]);
    const receipts = await listPodWorktreeReceipts(context.workspaceRoot, context.facade.hostId, route.podId, signalOptions(context.options.signal));
    const windowRoot = path.resolve(context.workspaceRoot.absolutePath, route.configuredPlacement);
    return Object.freeze(receipts.map((receipt) => Object.freeze({
        repositoryId: receipt.repositoryId,
        pathFromWindow: path.relative(windowRoot, receipt.path),
    })));
}
// ---- 事件流 -------------------------------------------------------------------
async function boundCommit(repository, binding, signal) {
    try {
        return await repository.findCommitByIdempotencyKey(binding.idempotencyKey, signalOptions(signal));
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
function committedEvent(commandResult, eventType) {
    const stored = commandResult.commit.events[0];
    if (stored === undefined)
        fail("precondition-failed", "commit-empty", "$request.idempotencyKey");
    const event = upcastDemandEventSourcingStoredEvent(stored);
    if (event.eventType !== eventType) {
        fail("precondition-failed", "commit-kind", "$request.idempotencyKey");
    }
    return Object.freeze({ stored, event });
}
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
async function loadTaskPackage(repository, target, signal) {
    try {
        const located = await repository.findTargetTaskPlannedEvent(target.taskPackageId, signalOptions(signal));
        if (located === null)
            fail("precondition-failed", "task-package-missing", "$request.targetTaskId");
        return located.event.data.taskPackage;
    }
    catch (error) {
        mapRepositoryError(error);
    }
}
/** 提交后读取复核快照；快照错误映射为稳定的 Wakeflow 错误，而不是 unexpected。 */
async function readSnapshotForNext(context) {
    try {
        return await readDemandResultReviewSnapshot(context.authority.demandRoot, signalOptions(context.options.signal));
    }
    catch (error) {
        if (error instanceof DemandResultReviewSnapshotError) {
            if (error.reason === "aborted")
                fail("io-failure", "aborted", "$signal", { cause: error });
            fail("io-failure", "result-review-snapshot", "$request.demandId", { cause: error });
        }
        throw error;
    }
}
async function next(context, outcome) {
    const snapshot = await readSnapshotForNext(context);
    const route = buildDemandControllerRoute({ ...context.authority.loaded, aggregate: outcome.commandResult.aggregate }, snapshot);
    return deriveNextProjection(route);
}
// ---- 声明 ---------------------------------------------------------------------
async function takeClaim(context, route, holder, claimId, now) {
    const signal = signalOptions(context.options.signal);
    const windowId = route.binding.windowId;
    const existing = (await inspectWorkClaim(context.workspaceRoot, windowId, signal)).claim;
    const knownDeliveryIds = context.authority.loaded.aggregate.state.targetTasks.flatMap((entry) => entry.phase === "planned" || entry.phase === "superseded"
        ? []
        : [entry.currentDelivery.deliveryId]);
    if (existing !== null && existing.claimId !== claimId) {
        const decision = deriveClaimBlocker(existing.holder, holder.demandId, holder.targetTaskId, knownDeliveryIds);
        if (decision.blocker !== null)
            rejectWith([decision.blocker], "$request.targetTaskId");
        if (decision.reclaim)
            await releaseWorkClaim(context.workspaceRoot, existing, signal);
    }
    const claim = createWorkClaim({
        claimId,
        hostId: context.facade.hostId,
        windowId,
        bindingId: route.binding.bindingId,
        holder,
        claimedAt: now,
    });
    const taken = await takeWorkClaim(context.workspaceRoot, claim, signal);
    const created = taken.disposition === "created";
    // 声明与绑定存储各自加锁：取得声明后复核绑定摘要，窗口在检查与声明之间被重绑时拒绝。
    try {
        const current = await readBinding(context, windowId);
        if (digestBinding(current) !== route.bindingDigest) {
            fail("precondition-failed", "binding-changed", "$request.targetTaskId");
        }
    }
    catch (error) {
        if (created)
            await releaseQuietly(context, taken.claim);
        throw error;
    }
    return Object.freeze({ claim: taken.claim, created });
}
async function releaseQuietly(context, claim) {
    try {
        await releaseWorkClaim(context.workspaceRoot, claim, signalOptions(context.options.signal));
    }
    catch {
        // 追加失败后的回滚是尽力而为；残留声明由 endpoint 的 release-claim 恢复门处理。
    }
}
async function loadHistory(repository, signal) {
    try {
        return await repository.auditTargetResultHistory(signalOptions(signal));
    }
    catch (error) {
        mapRepositoryError(error);
    }
}
async function loadReworkSource(repository, target, signal) {
    if (target.phase !== "rework-requested")
        fail("precondition-failed", "rework-phase", "$request.targetTaskId");
    return loadReworkSourceById(repository, target.currentDelivery.reviewDecision.targetReviewDecisionId, target.currentDelivery.targetResult.targetResultId, signal);
}
async function loadReworkSourceById(repository, targetReviewDecisionId, targetResultId, signal) {
    const history = await loadHistory(repository, signal);
    const decisionSource = history.targetReviewDecisions.find((entry) => entry.decision.targetReviewDecisionId === targetReviewDecisionId);
    const resultSource = history.targetResults.find((entry) => entry.result.targetResultId === targetResultId);
    if (decisionSource === undefined || resultSource === undefined) {
        fail("precondition-failed", "rework-history", "$request.targetTaskId");
    }
    try {
        return Object.freeze({
            decision: parseControllerImplementationReviewDecision(decisionSource.decision),
            previousResult: resultSource.result,
        });
    }
    catch (error) {
        if (error instanceof ControllerImplementationReviewDecisionError) {
            fail("precondition-failed", "rework-decision", "$request.targetTaskId", { cause: error });
        }
        throw error;
    }
}
async function loadRemediationSource(repository, target, signal) {
    if (target.phase !== "product-defect-rework-requested") {
        fail("precondition-failed", "remediation-phase", "$request.targetTaskId");
    }
    return loadRemediationSourceById(repository, target.productDefectRemediation.productDefectRemediationId, target.currentDelivery.targetResult.targetResultId, signal);
}
async function loadRemediationSourceById(repository, productDefectRemediationId, targetResultId, signal) {
    const history = await loadHistory(repository, signal);
    const authorizationSource = history.productDefectRemediationAuthorizations.find((entry) => entry.authorization.productDefectRemediationId === productDefectRemediationId);
    const resultSource = history.targetResults.find((entry) => entry.result.targetResultId === targetResultId);
    if (authorizationSource === undefined || resultSource === undefined) {
        fail("precondition-failed", "remediation-history", "$request.targetTaskId");
    }
    return Object.freeze({
        authorization: authorizationSource.authorization,
        previousResult: resultSource.result,
    });
}
/** 重跑范围来自 `request-another-attempt{stepIds}` 决定记录（§13.87 D6）。 */
async function loadRerunStepIds(repository, targetReviewDecisionId, signal) {
    const history = await loadHistory(repository, signal);
    const decision = history.targetReviewDecisions.find((entry) => entry.decision.targetReviewDecisionId === targetReviewDecisionId)?.decision;
    if (decision?.kind !== "WakeflowControllerTestReviewDecision") {
        fail("precondition-failed", "rerun-decision", "$request.targetTaskId");
    }
    return decision.stepIds;
}
async function testAttemptFor(repository, target, taskPackage, testAttemptId, signal) {
    if (target.workType !== "test")
        fail("precondition-failed", "target-work-type", "$request.targetTaskId");
    if (target.phase === "planned") {
        try {
            return createInitialTestExecutionAttempt({ testAttemptId, taskPackage });
        }
        catch (error) {
            mapRecordError(error, "$request.targetTaskId");
        }
    }
    // rearm 用尽后换新信封：被拒的尝试从未到达会话，原样重发同一次尝试。
    if (target.phase === "test-host-effect-rejected") {
        const rejected = target.testAttempts.at(-1);
        if (rejected === undefined)
            fail("precondition-failed", "rerun-history", "$request.targetTaskId");
        return rejected.attempt;
    }
    if (target.phase !== "test-another-attempt-requested") {
        fail("precondition-failed", "rerun-phase", "$request.targetTaskId");
    }
    const previousAttempt = target.testAttempts.at(-1);
    if (previousAttempt === undefined)
        fail("precondition-failed", "rerun-history", "$request.targetTaskId");
    const stepIds = await loadRerunStepIds(repository, target.currentDelivery.reviewDecision.targetReviewDecisionId, signal);
    try {
        return createRerunTestExecutionAttempt({
            testAttemptId,
            taskPackage,
            previousAttempt: previousAttempt.attempt,
            previousResult: {
                targetResultId: target.currentDelivery.targetResult.targetResultId,
                resultDigest: target.currentDelivery.targetResult.resultDigest,
            },
            reviewDecision: {
                targetReviewDecisionId: target.currentDelivery.reviewDecision.targetReviewDecisionId,
                decisionDigest: target.currentDelivery.reviewDecision.decisionDigest,
            },
            stepIds,
        });
    }
    catch (error) {
        mapRecordError(error, "$request.targetTaskId");
    }
}
function testContractSection(taskPackage, attempt) {
    const contract = taskPackage.testContract;
    return Object.freeze({
        question: contract.question,
        objectBoundary: contract.objectBoundary,
        steps: contract.steps.map((step) => Object.freeze({
            stepId: step.stepId,
            given: step.given,
            when: step.when,
            // biome-ignore lint/suspicious/noThenProperty: Given/When/Then 合同步骤字段（§13.85 D1）
            then: step.then,
        })),
        environmentMemberRef: contract.environment.memberRef,
        allowedSkills: contract.allowedSkills,
        setupDirective: attempt.environmentSetup.directive,
        attemptOrdinal: attempt.ordinal,
        maxAttempts: contract.maxAttempts,
        stopConditions: contract.stopConditions,
    });
}
function renderPrompt(context, input, sources, pointer) {
    const { taskPackage, route } = sources;
    const instructionFile = context.facade.resourceProfile.instructionFileName;
    const repositoryId = taskPackage.workType === "implementation" ? taskPackage.assignment.repositoryId : null;
    return renderDeliveryPortablePrompt({
        language: input.language,
        displayTitle: route.displayTitle,
        taskPackage,
        authored: {
            goal: input.authored.goal,
            focus: input.authored.focus,
            boundary: input.authored.boundary,
        },
        identity: {
            demandId: taskPackage.demandId,
            podId: `${route.podName} (${route.podId})`,
            windowId: route.binding.windowId,
            repositoryId,
            bindingId: route.binding.bindingId,
        },
        readingOrder: {
            workspaceRootFromWindow: route.worktreePath === null
                ? relativeWorkspaceRoot(route.configuredPlacement)
                : path.relative(route.worktreePath, context.workspaceRoot.absolutePath),
            attachedWorktrees: sources.attachedWorktrees,
            taskPackageRef: deliveryTaskPackageRef(taskPackage.demandId, taskPackage.taskPackageId),
            requirementSections: taskPackage.workType === "implementation" ? taskPackage.sectionAnchors : [],
            workspaceInstructionFile: instructionFile,
            repositoryInstructionFile: repositoryId === null ? null : instructionFile,
            stateRootRef: demandFinalRootRef(taskPackage.demandId),
        },
        returnPointer: pointer,
        rework: sources.rework,
        productDefectRemediation: sources.remediation,
        testContract: sources.testContract,
    });
}
async function replayPermit(context, commandResult, eventType) {
    const { stored, event } = committedEvent(commandResult, eventType);
    const repository = new DemandEventSourcingRepository(context.authority.demandRoot);
    const deliveryId = event.eventType === "delivery.delivery-prepared"
        ? event.data.envelope.deliveryId
        : event.eventType === "delivery.delivery-rearmed"
            ? event.data.rearm.deliveryId
            : fail("precondition-failed", "commit-kind", "$request.idempotencyKey");
    const envelope = event.eventType === "delivery.delivery-prepared"
        ? event.data.envelope
        : await loadEnvelope(repository, deliveryId, context.options.signal);
    const generation = event.eventType === "delivery.delivery-rearmed" ? event.data.rearm.generation : 1;
    const fence = event.eventType === "delivery.delivery-rearmed" ? event.data.rearm.fence : envelope.fence;
    const route = await loadRoute(context, envelope.route.windowId);
    return Object.freeze({
        commandResult: Object.freeze({ disposition: "idempotent", ...commandResult }),
        envelope,
        route,
        generation,
        fence: Object.freeze({ claimId: fence.claimId, claimDigest: fence.claimDigest }),
        issuedAt: event.recordedAt,
        eventId: stored.eventId,
    });
}
async function executePrepare(context, input, binding) {
    const { authority, options } = context;
    const repository = new DemandEventSourcingRepository(authority.demandRoot);
    const bound = await boundCommit(repository, binding, options.signal);
    if (bound !== null) {
        if (bound.idempotency?.requestDigest !== binding.requestDigest) {
            fail("idempotency-mismatch", "request-digest", "$request.idempotencyKey");
        }
        return replayPermit(context, { commit: bound, aggregate: authority.loaded.aggregate }, "delivery.delivery-prepared");
    }
    assertFreshRevision(context, binding);
    const target = targetOf(context, input.targetTaskId);
    const currentGeneration = target.phase === "planned" || target.phase === "superseded"
        ? null
        : target.currentDelivery.generation;
    const blockers = derivePrepareBlockers({
        workType: target.workType === "test" ? "test" : "implementation",
        phase: target.phase,
        generation: currentGeneration,
    });
    if (blockers.length > 0)
        rejectWith(blockers, "$request.targetTaskId");
    const taskPackage = await loadTaskPackage(repository, target, options.signal);
    const route = await loadRoute(context, taskPackage.assignment.windowId);
    const demandId = authority.loaded.identity.demandId;
    const deliveryId = deriveDurableId("target-delivery", "prepare-delivery", demandId, binding.idempotencyKey);
    const claimId = deriveWorkClaimId("prepare-delivery", demandId, binding.idempotencyKey);
    const now = nowFrom(options);
    const sources = await prepareSources(context, repository, target, taskPackage, route, binding);
    const taken = await takeClaim(context, route, { demandId, targetTaskId: target.targetTaskId, deliveryId, generation: 1 }, claimId, now);
    try {
        const portablePrompt = renderPrompt(context, input, sources.prompt, {
            deliveryId,
            claimDigest: taken.claim.claimDigest,
            streamRevision: binding.expectedStreamRevision + 1,
            generation: 1,
        });
        const envelope = createEnvelope(input, sources, taken.claim, {
            deliveryId,
            taskPackage,
            route,
            portablePrompt,
            expectedStreamRevision: binding.expectedStreamRevision,
            preparedAt: now,
        });
        const command = parseDemandEventSourcingCommand({
            commandType: "delivery.prepare-delivery",
            commandVersion: 1,
            eventId: deriveDurableId("demand-event", "prepare-delivery", demandId, binding.idempotencyKey),
            envelope,
            taskPackage,
            ...(sources.reworkSource === null ? {} : { reworkSource: sources.reworkSource }),
            ...(sources.remediationSource === null
                ? {}
                : { productDefectRemediationSource: sources.remediationSource }),
        });
        const commandResult = await appendCommand(repository, command, binding, options.signal);
        if (commandResult.disposition === "idempotent") {
            return replayPermit(context, commandResult, "delivery.delivery-prepared");
        }
        return Object.freeze({
            commandResult,
            envelope,
            route,
            generation: 1,
            fence: Object.freeze({ claimId: taken.claim.claimId, claimDigest: taken.claim.claimDigest }),
            issuedAt: now,
            eventId: committedEvent(commandResult, "delivery.delivery-prepared").stored.eventId,
        });
    }
    catch (error) {
        if (taken.created)
            await releaseQuietly(context, taken.claim);
        throw error;
    }
}
async function prepareSources(context, repository, target, taskPackage, route, binding) {
    const signal = context.options.signal;
    const attachedWorktrees = await attachedWorktreesFor(context, taskPackage, route);
    if (taskPackage.workType === "test") {
        const testAttemptId = deriveDurableId("test-attempt", "prepare-delivery", taskPackage.demandId, binding.idempotencyKey);
        const attempt = await testAttemptFor(repository, target, taskPackage, testAttemptId, signal);
        return Object.freeze({
            prompt: {
                taskPackage,
                route,
                attachedWorktrees,
                rework: null,
                remediation: null,
                testContract: testContractSection(taskPackage, attempt),
            },
            attempt,
            reworkSource: null,
            remediationSource: null,
        });
    }
    const basis = await implementationBasis(repository, target, signal);
    try {
        return Object.freeze({
            prompt: {
                taskPackage,
                route,
                attachedWorktrees,
                rework: basis.reworkSource === null
                    ? null
                    : createTargetDeliveryReworkContext(basis.reworkSource),
                remediation: basis.remediationSource === null
                    ? null
                    : createTargetDeliveryProductDefectRemediationContext(basis.remediationSource),
                testContract: null,
            },
            attempt: null,
            ...basis,
        });
    }
    catch (error) {
        mapRecordError(error, "$request.targetTaskId");
    }
}
/**
 * 实现投递的返工依据：返工与缺陷修复各从当前决定取；rearm 用尽后换新信封时从被拒信封
 * 原样带过来，否则新 prompt 会丢掉评审决定与必改项，像一次全新的任务。
 */
async function implementationBasis(repository, target, signal) {
    const none = { reworkSource: null, remediationSource: null };
    if (target.phase === "rework-requested") {
        return { ...none, reworkSource: await loadReworkSource(repository, target, signal) };
    }
    if (target.phase === "product-defect-rework-requested") {
        return { ...none, remediationSource: await loadRemediationSource(repository, target, signal) };
    }
    if (target.phase !== "host-effect-rejected")
        return none;
    const rejected = await loadEnvelope(repository, target.currentDelivery.deliveryId, signal);
    if (rejected.workType !== "implementation")
        return none;
    if (rejected.rework !== undefined) {
        const { decision, previousResult } = rejected.rework;
        return {
            ...none,
            reworkSource: await loadReworkSourceById(repository, decision.targetReviewDecisionId, previousResult.targetResultId, signal),
        };
    }
    const remediation = rejected.productDefectRemediation;
    if (remediation === undefined)
        return none;
    return {
        ...none,
        remediationSource: await loadRemediationSourceById(repository, remediation.authorization.productDefectRemediationId, remediation.previousResult.targetResultId, signal),
    };
}
function createEnvelope(input, sources, claim, facts) {
    const { taskPackage, route } = facts;
    const shared = {
        deliveryId: facts.deliveryId,
        programId: taskPackage.programId,
        configDigest: taskPackage.configDigest,
        demandId: taskPackage.demandId,
        target: {
            targetTaskId: taskPackage.targetTaskId,
            taskPackageId: taskPackage.taskPackageId,
            taskPackageRef: deliveryTaskPackageRef(taskPackage.demandId, taskPackage.taskPackageId),
            taskPackageDigest: computeTaskPackageDigest(taskPackage),
        },
        route: {
            hostId: route.binding.hostId,
            windowId: route.binding.windowId,
            bindingId: route.binding.bindingId,
            bindingDigest: route.bindingDigest,
        },
        language: input.language,
        portablePrompt: facts.portablePrompt,
        promptDigest: computeDeliveryPromptDigest(facts.portablePrompt),
        fence: {
            claimId: claim.claimId,
            claimDigest: claim.claimDigest,
            expectedStreamRevision: facts.expectedStreamRevision,
        },
        preparedAt: facts.preparedAt,
    };
    try {
        if (taskPackage.workType === "test") {
            if (sources.attempt === null)
                fail("unexpected", "attempt-missing", "$request.targetTaskId");
            return createDeliveryEnvelope({
                ...shared,
                workType: "test",
                attempt: sources.attempt,
            });
        }
        return createDeliveryEnvelope({
            ...shared,
            workType: "implementation",
            ...(sources.prompt.rework === null ? {} : { rework: sources.prompt.rework }),
            ...(sources.prompt.remediation === null
                ? {}
                : { productDefectRemediation: sources.prompt.remediation }),
        });
    }
    catch (error) {
        mapRecordError(error, "$request.targetTaskId");
    }
}
function permitBody(envelope, outcome, nextProjection) {
    const { commandResult, route } = outcome;
    const stored = commandResult.commit.events[0];
    if (stored === undefined)
        fail("unexpected", "commit-empty", "$result");
    const targetTaskId = outcome.envelope.target.targetTaskId;
    const target = commandResult.aggregate.state.targetTasks.find((entry) => entry.targetTaskId === targetTaskId);
    if (target === undefined)
        fail("unexpected", "target-missing", "$result");
    return {
        schemaVersion: WAKEFLOW_DELIVERY_PUBLIC_SCHEMA_VERSION,
        demandId: envelope.demandId,
        delivery: {
            deliveryId: outcome.envelope.deliveryId,
            envelopeDigest: outcome.envelope.envelopeDigest,
            promptDigest: outcome.envelope.promptDigest,
            generation: outcome.generation,
            workType: outcome.envelope.workType,
            targetTaskId,
            windowId: outcome.envelope.route.windowId,
            phase: target.phase,
        },
        permit: {
            prompt: outcome.envelope.portablePrompt,
            hostAction: {
                effect: "send-prompt-to-window",
                hostId: route.binding.hostId,
                windowId: route.binding.windowId,
                displayTitle: route.displayTitle,
                bindingId: route.binding.bindingId,
                handleDigest: route.handleDigest,
            },
            fence: {
                claimId: outcome.fence.claimId,
                claimDigest: outcome.fence.claimDigest,
                streamRevision: stored.streamRevision,
            },
            issuedAt: outcome.issuedAt,
        },
        event: { eventId: outcome.eventId, streamRevision: stored.streamRevision },
        commit: {
            commitId: commandResult.commit.commitId,
            commitSequence: commandResult.commit.commitSequence,
            commitDigest: computeDemandEventStreamCommitDigest(commandResult.commit),
        },
        stateDigest: commandResult.aggregate.stateDigest,
        next: {
            frontier: nextProjection.frontier,
            owner: nextProjection.owner,
            suggestedTool: nextProjection.suggestedTool,
            blockers: [...nextProjection.blockers],
        },
    };
}
function prepareResult(envelope, outcome, nextProjection) {
    return admitPrepareDeliveryResult({
        kind: "WakeflowPrepareDeliveryResult",
        tool: WAKEFLOW_PREPARE_DELIVERY_PUBLIC_TOOL_NAME,
        status: outcome.commandResult.disposition,
        ...permitBody(envelope, outcome, nextProjection),
    });
}
function callbackPermitBody(envelope, outcome, nextProjection) {
    const { commandResult, route } = outcome;
    const stored = commandResult.commit.events[0];
    if (stored === undefined)
        fail("unexpected", "commit-empty", "$result");
    return {
        schemaVersion: WAKEFLOW_DELIVERY_PUBLIC_SCHEMA_VERSION,
        demandId: envelope.demandId,
        delivery: {
            deliveryId: outcome.callbackId,
            // 回调没有信封：绑定的是结果本身，这里记结果摘要。
            envelopeDigest: outcome.resultDigest,
            promptDigest: outcome.promptDigest,
            generation: outcome.generation,
            workType: "callback",
            targetTaskId: outcome.targetTaskId,
            windowId: route.binding.windowId,
            phase: outcome.phase,
        },
        permit: {
            prompt: outcome.prompt,
            hostAction: {
                effect: "send-prompt-to-window",
                hostId: route.binding.hostId,
                windowId: route.binding.windowId,
                displayTitle: route.displayTitle,
                bindingId: route.binding.bindingId,
                handleDigest: route.handleDigest,
            },
            fence: null,
            issuedAt: outcome.issuedAt,
        },
        event: { eventId: outcome.eventId, streamRevision: stored.streamRevision },
        commit: {
            commitId: commandResult.commit.commitId,
            commitSequence: commandResult.commit.commitSequence,
            commitDigest: computeDemandEventStreamCommitDigest(commandResult.commit),
        },
        stateDigest: commandResult.aggregate.stateDigest,
        next: {
            frontier: nextProjection.frontier,
            owner: nextProjection.owner,
            suggestedTool: nextProjection.suggestedTool,
            blockers: [...nextProjection.blockers],
        },
    };
}
function rearmResult(envelope, outcome, nextProjection) {
    const status = outcome.commandResult.disposition === "committed" ? "rearmed" : "idempotent";
    if (isCallbackPermit(outcome)) {
        return admitRearmDeliveryResult({
            kind: "WakeflowRearmDeliveryResult",
            tool: WAKEFLOW_REARM_DELIVERY_PUBLIC_TOOL_NAME,
            status,
            rearm: {
                kind: "callback",
                previousGeneration: outcome.generation - 1,
                generation: outcome.generation,
            },
            ...callbackPermitBody(envelope, outcome, nextProjection),
        });
    }
    return admitRearmDeliveryResult({
        kind: "WakeflowRearmDeliveryResult",
        tool: WAKEFLOW_REARM_DELIVERY_PUBLIC_TOOL_NAME,
        status,
        rearm: {
            kind: "target",
            previousGeneration: outcome.generation - 1,
            generation: outcome.generation,
        },
        ...permitBody(envelope, outcome, nextProjection),
    });
}
/** 执行一次 `wakeflow_prepare_delivery`。 */
export async function executePrepareDeliveryRequest(facade, value, options = {}) {
    return runAppendCommand({
        tool: WAKEFLOW_PREPARE_DELIVERY_PUBLIC_TOOL_NAME,
        parseRequest: (raw) => {
            const request = parsePrepareDeliveryRequest(raw);
            return Object.freeze({
                envelope: Object.freeze({
                    root: request.root,
                    demandId: request.demandId,
                    idempotencyKey: request.idempotencyKey,
                    expectedStreamRevision: request.expectedStreamRevision,
                }),
                input: Object.freeze({
                    targetTaskId: request.targetTaskId,
                    authored: request.authored,
                    language: request.language ?? "en",
                }),
            });
        },
        open: (workspaceRoot, envelope) => openContext(workspaceRoot, envelope, facade, options),
        close: closeContext,
        privateValues: (context) => [context.authority.ledgerRoot.absolutePath],
        execute: (context, input, binding) => afterMutationRefresh(context.workspaceRoot, context.options.signal, () => executePrepare(context, input, binding)),
        next,
        result: prepareResult,
    }, value, commandShellExecutionOptions(options.durability));
}
async function sessionRecords(context, sessionId, since) {
    const inventory = await readHostHookObservations(context.workspaceRoot, context.facade.hostId, { sessionId, since }, signalOptions(context.options.signal));
    return inventory.records.map((record) => Object.freeze({
        recordId: record.recordId,
        promptDigest: record.promptDigest,
        recordedAt: record.recordedAt,
        event: record.event,
    }));
}
function outcomeDraft(input, target, decision) {
    if (!decision.accepted)
        rejectWith([decision.blocker], "$request.attempt");
    const attemptDigest = input.attempt.evidenceDigest ?? null;
    const readback = input.readback ?? { status: "unavailable" };
    try {
        return createDeliveryOutcome({
            deliveryId: target.currentDelivery.deliveryId,
            generation: target.currentDelivery.generation,
            fence: {
                claimId: target.currentDelivery.fence.claimId,
                claimDigest: target.currentDelivery.fence.claimDigest,
            },
            disposition: decision.disposition,
            attempt: {
                status: input.attempt.status,
                evidenceDigest: attemptDigest,
            },
            readback: {
                status: readback.status,
                evidenceDigest: (readback.evidenceDigest ?? null),
            },
            evidence: {
                kind: decision.evidenceKind,
                hookRecordId: decision.hookRecordId,
                rationale: decision.rationale,
            },
            observedAt: input.observedAt,
        });
    }
    catch (error) {
        mapRecordError(error, "$request.attempt");
    }
}
function replayOutcome(context, envelope, bound, binding) {
    if (bound.idempotency?.requestDigest !== binding.requestDigest) {
        fail("idempotency-mismatch", "request-digest", "$request.idempotencyKey");
    }
    const { stored, event } = committedEvent({ commit: bound }, "delivery.delivery-outcome-recorded");
    if (event.eventType !== "delivery.delivery-outcome-recorded") {
        fail("unexpected", "commit-kind", "$result");
    }
    return Object.freeze({
        commandResult: Object.freeze({
            disposition: "idempotent",
            commit: bound,
            aggregate: context.authority.loaded.aggregate,
        }),
        outcome: event.data.outcome,
        targetTaskId: envelope.target.targetTaskId,
        workType: envelope.workType,
        eventId: stored.eventId,
    });
}
function assertOutcomeRecordable(target, claimDigest) {
    if (target.currentDelivery.fence.claimDigest !== claimDigest) {
        fail("precondition-failed", "fence-mismatch", "$request.claimDigest");
    }
    const currentlyIndeterminate = target.phase === "host-effect-indeterminate" ||
        target.phase === "test-host-effect-indeterminate";
    if (!currentlyIndeterminate &&
        target.phase !== "delivery-prepared" &&
        target.phase !== "test-delivery-prepared") {
        rejectWith([`target-phase:${target.phase}`], "$request.deliveryId");
    }
    return currentlyIndeterminate;
}
function decideOutcome(context, input, envelope, records, currentlyIndeterminate) {
    const resolution = input.resolution;
    const landing = records.filter((record) => record.event === "user-prompt-submit");
    return deriveDeliveryDisposition({
        sendReturnProvesLanding: sendReturnProvesLanding(context.facade.resourceProfile),
        attempt: {
            status: input.attempt.status,
            evidenceDigest: (input.attempt.evidenceDigest ?? null),
        },
        readback: {
            status: input.readback?.status ?? "unavailable",
            evidenceDigest: (input.readback?.evidenceDigest ?? null),
        },
        landingRecords: landing,
        expectedPromptDigest: envelope.promptDigest,
        resolution: resolution === undefined
            ? null
            : {
                disposition: resolution.disposition,
                hookRecordId: resolution.hookRecordId ?? null,
                rationale: resolution.rationale,
            },
        // 显式解决引用的证据必须是落地记录本身，与自动判定同一标准。
        resolutionRecordFound: resolution?.hookRecordId !== undefined &&
            landing.some((record) => record.recordId === resolution.hookRecordId),
        currentlyIndeterminate,
    });
}
async function executeOutcome(context, input, binding) {
    const { authority, options } = context;
    const repository = new DemandEventSourcingRepository(authority.demandRoot);
    const bound = await boundCommit(repository, binding, options.signal);
    if (bound !== null) {
        // 重放不要求投递仍是当前投递：目标可能已换到更新的信封，身份从被重放投递的信封取。
        const replayedEnvelope = await loadEnvelope(repository, input.deliveryId, options.signal);
        const replayed = replayOutcome(context, replayedEnvelope, bound, binding);
        // 追加已提交而释放未完成的裂缝由重放路径补做；助手对缺失或已易主的声明无事可做。
        if (replayed.outcome.claimHandling === "release-authorized") {
            await releaseClaimFor(context, replayedEnvelope.route.windowId, replayed.outcome.fence);
        }
        return replayed;
    }
    const target = deliveryTargetOf(context, input.deliveryId);
    assertFreshRevision(context, binding);
    const currentlyIndeterminate = assertOutcomeRecordable(target, input.claimDigest);
    const envelope = await loadEnvelope(repository, input.deliveryId, options.signal);
    const route = await loadRoute(context, envelope.route.windowId);
    const records = await sessionRecords(context, route.binding.handle.value, envelope.preparedAt);
    const decision = decideOutcome(context, input, envelope, records, currentlyIndeterminate);
    if (!decision.accepted) {
        const blockers = [decision.blocker];
        if (decision.blocker === "landing-evidence-missing" &&
            (await silenceExceededFor(repository, { deliveryId: input.deliveryId, generation: target.currentDelivery.generation }, input.observedAt, options.signal))) {
            blockers.push("landing-silence-exceeded");
        }
        rejectWith(blockers, "$request.attempt");
    }
    const outcome = outcomeDraft(input, target, decision);
    const command = parseDemandEventSourcingCommand({
        commandType: "delivery.record-delivery-outcome",
        commandVersion: 1,
        eventId: deriveDurableId("demand-event", "record-delivery-outcome", authority.loaded.identity.demandId, binding.idempotencyKey),
        outcome,
    });
    const commandResult = await appendCommand(repository, command, binding, options.signal);
    const committed = committedEvent(commandResult, "delivery.delivery-outcome-recorded");
    if (outcome.claimHandling === "release-authorized") {
        await releaseClaimFor(context, route.binding.windowId, outcome.fence);
    }
    return Object.freeze({
        commandResult,
        outcome,
        targetTaskId: target.targetTaskId,
        workType: target.workType === "test" ? "test" : "implementation",
        eventId: committed.stored.eventId,
    });
}
/** 只释放仍属于本次投递的声明；缺失或已易主（例如已被 rearm 重取）都不是错误。 */
async function releaseClaimFor(context, windowId, fence) {
    await releaseWorkClaimIfHeld(context.workspaceRoot, windowId, fence, signalOptions(context.options.signal));
}
async function silenceExceededFor(repository, delivery, now, signal) {
    try {
        const outcomes = await repository.findDeliveryOutcomeRecordedEvents(delivery.deliveryId, signalOptions(signal));
        // 静默从本代第一次 indeterminate 起算；更早一代被解决并 rearm 之后不再计入。
        const first = outcomes.find((entry) => entry.event.data.outcome.generation === delivery.generation &&
            entry.event.data.outcome.disposition === "indeterminate");
        return first !== undefined && landingSilenceExceeded(first.event.recordedAt, now);
    }
    catch (error) {
        mapRepositoryError(error);
    }
}
const OUTCOME_PHASE_SUFFIX = Object.freeze({
    accepted: "accepted",
    indeterminate: "indeterminate",
    "rejected-before-send": "rejected",
});
function outcomeResult(envelope, outcome, nextProjection) {
    const { commandResult } = outcome;
    const stored = commandResult.commit.events[0];
    if (stored === undefined)
        fail("unexpected", "commit-empty", "$result");
    // phase 取自结局本身：重放时目标可能已换到更新的信封，结果仍要与首次记录一致。
    const phase = `${outcome.workType === "test" ? "test-" : ""}host-effect-${OUTCOME_PHASE_SUFFIX[outcome.outcome.disposition]}`;
    const blockers = [...nextProjection.blockers];
    if (outcome.outcome.disposition === "indeterminate")
        blockers.push("landing-evidence-missing");
    return admitRecordDeliveryOutcomeResult({
        kind: "WakeflowRecordDeliveryOutcomeResult",
        schemaVersion: WAKEFLOW_DELIVERY_PUBLIC_SCHEMA_VERSION,
        tool: WAKEFLOW_RECORD_DELIVERY_OUTCOME_PUBLIC_TOOL_NAME,
        status: commandResult.disposition === "committed" ? "recorded" : "idempotent",
        demandId: envelope.demandId,
        outcome: {
            deliveryId: outcome.outcome.deliveryId,
            generation: outcome.outcome.generation,
            disposition: outcome.outcome.disposition,
            evidenceKind: outcome.outcome.evidence.kind,
            hookRecordId: outcome.outcome.evidence.hookRecordId,
            claimHandling: outcome.outcome.claimHandling,
            observedAt: outcome.outcome.observedAt,
            outcomeDigest: outcome.outcome.outcomeDigest,
        },
        target: { targetTaskId: outcome.targetTaskId, workType: outcome.workType, phase },
        event: { eventId: outcome.eventId, streamRevision: stored.streamRevision },
        commit: {
            commitId: commandResult.commit.commitId,
            commitSequence: commandResult.commit.commitSequence,
            commitDigest: computeDemandEventStreamCommitDigest(commandResult.commit),
        },
        stateDigest: commandResult.aggregate.stateDigest,
        next: {
            frontier: nextProjection.frontier,
            owner: nextProjection.owner,
            suggestedTool: nextProjection.suggestedTool,
            blockers,
        },
    });
}
/** 执行一次 `wakeflow_record_delivery_outcome`。 */
export async function executeRecordDeliveryOutcomeRequest(facade, value, options = {}) {
    return runAppendCommand({
        tool: WAKEFLOW_RECORD_DELIVERY_OUTCOME_PUBLIC_TOOL_NAME,
        parseRequest: (raw) => {
            const request = parseRecordDeliveryOutcomeRequest(raw);
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
                    attempt: request.attempt,
                    readback: request.readback,
                    resolution: request.resolution,
                    observedAt: parseInstant(request.observedAt, "$request.observedAt"),
                }),
            });
        },
        open: (workspaceRoot, envelope) => openContext(workspaceRoot, envelope, facade, options),
        close: closeContext,
        privateValues: (context) => [context.authority.ledgerRoot.absolutePath],
        execute: (context, input, binding) => afterMutationRefresh(context.workspaceRoot, context.options.signal, () => executeOutcome(context, input, binding)),
        next,
        result: outcomeResult,
    }, value, commandShellExecutionOptions(options.durability));
}
/** 回调 id 命中某个已回报结果的当前回调即走回调分支；否则按投递 id 查找。 */
function callbackTargetOf(context, callbackId) {
    const target = context.authority.loaded.aggregate.state.targetTasks.find((entry) => (entry.phase === "result-reported" || entry.phase === "test-result-reported") &&
        entry.currentDelivery.targetResult.callback.callbackId === callbackId);
    return target ?? null;
}
async function replayCallbackReissue(context, commandResult) {
    const stored = commandResult.commit.events[0];
    if (stored === undefined)
        fail("precondition-failed", "commit-empty", "$request.idempotencyKey");
    const event = upcastDemandEventSourcingStoredEvent(stored);
    if (event.eventType !== "result.callback-reissued") {
        fail("precondition-failed", "commit-kind", "$request.idempotencyKey");
    }
    const reissue = event.data.reissue;
    const target = callbackTargetOf(context, reissue.callbackId);
    if (target === null)
        fail("precondition-failed", "callback-phase", "$request.deliveryId");
    const located = await loadResultEvent(context, target.currentDelivery.fence.claimId);
    const route = await loadRoute(context, reissue.controllerWindowId);
    return Object.freeze({
        kind: "callback",
        commandResult: Object.freeze({ disposition: "idempotent", ...commandResult }),
        targetTaskId: target.targetTaskId,
        workType: target.workType === "test" ? "test" : "implementation",
        phase: target.phase,
        callbackId: reissue.callbackId,
        resultDigest: target.currentDelivery.targetResult.resultDigest,
        prompt: located.callback.portablePrompt,
        promptDigest: reissue.promptDigest,
        route,
        generation: reissue.generation,
        issuedAt: reissue.issuedAt,
        eventId: stored.eventId,
    });
}
async function loadResultEvent(context, claimId) {
    const repository = new DemandEventSourcingRepository(context.authority.demandRoot);
    try {
        const located = await repository.findTargetResultRecordedEvent(claimId, signalOptions(context.options.signal));
        if (located === null)
            fail("precondition-failed", "result-missing", "$request.deliveryId");
        return located.event.data;
    }
    catch (error) {
        mapRepositoryError(error);
    }
}
/**
 * 回调重发（§13.87 D1）：只在 silent（签发后超过静默阈值仍无落地记录）时允许；不取声明，
 * 按当前 Controller 绑定重算目标（绑定已换即旧代际作废），代际加一，上限三次。
 */
async function executeCallbackReissue(context, target, binding) {
    const { authority, options } = context;
    const callback = target.currentDelivery.targetResult.callback;
    if (callback.generation >= TARGET_RESULT_CALLBACK_GENERATION_LIMIT) {
        rejectWith([`callback-limit:${callback.generation}`], "$request.deliveryId");
    }
    const route = await loadRoute(context, callback.controllerWindowId);
    const now = nowFrom(options);
    const records = await sessionRecords(context, route.binding.handle.value, callback.issuedAt);
    const status = deriveTargetResultCallbackStatus({
        issuedAt: callback.issuedAt,
        promptDigest: callback.promptDigest,
        landingRecords: records,
        acknowledged: false,
        now,
        silenceMilliseconds: TARGET_RESULT_CALLBACK_SILENCE_MILLISECONDS,
    });
    if (status.status !== "silent")
        rejectWith([`callback-${status.status}`], "$request.deliveryId");
    const located = await loadResultEvent(context, target.currentDelivery.fence.claimId);
    let reissue;
    try {
        reissue = parseTargetResultCallbackReissue({
            targetResultId: target.currentDelivery.targetResult.targetResultId,
            callbackId: callback.callbackId,
            previousGeneration: callback.generation,
            generation: callback.generation + 1,
            controllerWindowId: callback.controllerWindowId,
            bindingId: route.binding.bindingId,
            bindingDigest: route.bindingDigest,
            promptDigest: callback.promptDigest,
            issuedAt: now,
        });
    }
    catch (error) {
        mapRecordError(error, "$request.deliveryId");
    }
    const demandId = authority.loaded.identity.demandId;
    const command = parseDemandEventSourcingCommand({
        commandType: "result.reissue-callback",
        commandVersion: 1,
        eventId: deriveDurableId("demand-event", "reissue-callback", demandId, binding.idempotencyKey),
        reissue,
    });
    const repository = new DemandEventSourcingRepository(authority.demandRoot);
    const commandResult = await appendCommand(repository, command, binding, options.signal);
    if (commandResult.disposition === "idempotent")
        return replayCallbackReissue(context, commandResult);
    const stored = commandResult.commit.events[0];
    if (stored === undefined)
        fail("unexpected", "commit-empty", "$result");
    return Object.freeze({
        kind: "callback",
        commandResult,
        targetTaskId: target.targetTaskId,
        workType: target.workType === "test" ? "test" : "implementation",
        phase: target.phase,
        callbackId: callback.callbackId,
        resultDigest: target.currentDelivery.targetResult.resultDigest,
        prompt: located.callback.portablePrompt,
        promptDigest: callback.promptDigest,
        route,
        generation: reissue.generation,
        issuedAt: now,
        eventId: stored.eventId,
    });
}
async function executeRearm(context, input, binding) {
    const { authority, options } = context;
    const repository = new DemandEventSourcingRepository(authority.demandRoot);
    const bound = await boundCommit(repository, binding, options.signal);
    if (bound !== null) {
        if (bound.idempotency?.requestDigest !== binding.requestDigest) {
            fail("idempotency-mismatch", "request-digest", "$request.idempotencyKey");
        }
        const replayed = { commit: bound, aggregate: authority.loaded.aggregate };
        return bound.events[0].eventType === "result.callback-reissued"
            ? replayCallbackReissue(context, replayed)
            : replayPermit(context, replayed, "delivery.delivery-rearmed");
    }
    assertFreshRevision(context, binding);
    const callbackTarget = callbackTargetOf(context, input.deliveryId);
    if (callbackTarget !== null)
        return executeCallbackReissue(context, callbackTarget, binding);
    const target = deliveryTargetOf(context, input.deliveryId);
    const blockers = deriveRearmBlockers({
        phase: target.phase,
        generation: target.currentDelivery.generation,
    });
    if (blockers.length > 0)
        rejectWith(blockers, "$request.deliveryId");
    if (!("outcome" in target.currentDelivery)) {
        fail("precondition-failed", "outcome-missing", "$request.deliveryId");
    }
    const currentOutcome = target.currentDelivery.outcome;
    const current = target.currentDelivery;
    const envelope = await loadEnvelope(repository, input.deliveryId, options.signal);
    const route = await loadRoute(context, envelope.route.windowId);
    if (route.binding.bindingId !== envelope.route.bindingId) {
        fail("precondition-failed", "binding-changed", "$request.deliveryId");
    }
    const demandId = authority.loaded.identity.demandId;
    const claimId = deriveWorkClaimId("rearm-delivery", demandId, binding.idempotencyKey);
    const now = nowFrom(options);
    const generation = current.generation + 1;
    const taken = await takeClaim(context, route, { demandId, targetTaskId: target.targetTaskId, deliveryId: envelope.deliveryId, generation }, claimId, now);
    try {
        let rearm;
        try {
            rearm = createDeliveryRearm({
                deliveryId: envelope.deliveryId,
                previousGeneration: current.generation,
                generation,
                previousFence: { claimId: current.fence.claimId, claimDigest: current.fence.claimDigest },
                rejectedOutcomeDigest: currentOutcome.outcomeDigest,
                fence: {
                    claimId: taken.claim.claimId,
                    claimDigest: taken.claim.claimDigest,
                    expectedStreamRevision: binding.expectedStreamRevision,
                },
                rearmedAt: now,
            });
        }
        catch (error) {
            mapRecordError(error, "$request.deliveryId");
        }
        const command = parseDemandEventSourcingCommand({
            commandType: "delivery.rearm-delivery",
            commandVersion: 1,
            eventId: deriveDurableId("demand-event", "rearm-delivery", demandId, binding.idempotencyKey),
            rearm,
        });
        const commandResult = await appendCommand(repository, command, binding, options.signal);
        if (commandResult.disposition === "idempotent") {
            return replayPermit(context, commandResult, "delivery.delivery-rearmed");
        }
        return Object.freeze({
            commandResult,
            envelope,
            route,
            generation,
            fence: Object.freeze({ claimId: taken.claim.claimId, claimDigest: taken.claim.claimDigest }),
            issuedAt: now,
            eventId: committedEvent(commandResult, "delivery.delivery-rearmed").stored.eventId,
        });
    }
    catch (error) {
        if (taken.created)
            await releaseQuietly(context, taken.claim);
        throw error;
    }
}
/** 执行一次 `wakeflow_rearm_delivery`。 */
export async function executeRearmDeliveryRequest(facade, value, options = {}) {
    return runAppendCommand({
        tool: WAKEFLOW_REARM_DELIVERY_PUBLIC_TOOL_NAME,
        parseRequest: (raw) => {
            const request = parseRearmDeliveryRequest(raw);
            return Object.freeze({
                envelope: Object.freeze({
                    root: request.root,
                    demandId: request.demandId,
                    idempotencyKey: request.idempotencyKey,
                    expectedStreamRevision: request.expectedStreamRevision,
                }),
                input: Object.freeze({ deliveryId: request.deliveryId }),
            });
        },
        open: (workspaceRoot, envelope) => openContext(workspaceRoot, envelope, facade, options),
        close: closeContext,
        privateValues: (context) => [context.authority.ledgerRoot.absolutePath],
        execute: (context, input, binding) => afterMutationRefresh(context.workspaceRoot, context.options.signal, () => executeRearm(context, input, binding)),
        next,
        result: rearmResult,
    }, value, commandShellExecutionOptions(options.durability));
}
