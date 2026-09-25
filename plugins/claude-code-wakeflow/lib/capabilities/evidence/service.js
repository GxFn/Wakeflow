import { readWakeflowConfigAuthoritySnapshot, WakeflowConfigAuthoritySnapshotError, } from "../../configuration/wakeflow-config-authority-snapshot.js";
import { parseWakeflowDurableIdOfKind, WakeflowDurableIdError, } from "../../contracts/identity/wakeflow-durable-id.js";
import { parseSha256Digest, Sha256Error } from "../../foundation/crypto/sha256.js";
import { buildDemandControllerRoute } from "../../governance/controller/demand-controller-route.js";
import { closeDemandOperationAuthorityContext, DemandOperationAuthorityContextError, openDemandReadAuthorityContext, } from "../../governance/demand/demand-operation-authority-context.js";
import { DemandEventSourcingRepository, DemandEventSourcingRepositoryError, } from "../../governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { ManagedEvidenceCapturePlanningService, ManagedEvidenceCapturePlanningServiceError, } from "../../governance/evidence/managed-evidence-capture-planning-service.js";
import { ManagedEvidencePublicationApplicationService, ManagedEvidencePublicationApplicationServiceError, } from "../../governance/evidence/managed-evidence-publication-application-service.js";
import { computeManagedEvidencePublicationTransactionDigest, createManagedEvidencePublicationTransaction, ManagedEvidencePublicationTransactionError, } from "../../governance/evidence/managed-evidence-publication-transaction.js";
import { DemandResultReviewSnapshotError, readDemandResultReviewSnapshot, } from "../../governance/review/demand-result-review-snapshot.js";
import { afterMutationRefresh } from "../../governance/observation/active-projection-refresh.js";
import { fail } from "../../kernel/error.js";
import { deriveNextProjection } from "../../kernel/next-projection.js";
import { runPublicationTransaction, } from "../../kernel/publication-transaction.js";
import { commandShellExecutionOptions } from "../../kernel/command-shell.js";
import { admitRecordEvidenceResult, parseRecordEvidenceRequest, WAKEFLOW_RECORD_EVIDENCE_PUBLIC_SCHEMA_VERSION, WAKEFLOW_RECORD_EVIDENCE_PUBLIC_TOOL_NAME, } from "./contract.js";
import { deriveEvidenceEventIdentity, deriveEvidencePlanDigest, evidencePlanSummary, evidencePreviewNext, } from "./decide.js";
function signalOptions(signal) {
    return signal === undefined ? {} : { signal };
}
function parseDemandId(value) {
    try {
        return parseWakeflowDurableIdOfKind(value, "demand", "$request.demandId");
    }
    catch (error) {
        if (error instanceof WakeflowDurableIdError) {
            fail("invalid-request", "demand-id", "$request.demandId", { cause: error });
        }
        throw error;
    }
}
function envelopeOf(request) {
    if (request.mode === "recover") {
        return Object.freeze({
            root: request.root,
            mode: "recover",
            planDigest: null,
            operationId: parseDemandId(request.demandId),
        });
    }
    let planDigest = null;
    if (request.planDigest !== undefined) {
        try {
            planDigest = parseSha256Digest(request.planDigest, "$request.planDigest");
        }
        catch (error) {
            if (error instanceof Sha256Error) {
                fail("invalid-request", "plan-digest", "$request.planDigest", { cause: error });
            }
            throw error;
        }
    }
    return Object.freeze({ root: request.root, mode: request.mode, planDigest, operationId: null });
}
async function openContext(root, options) {
    try {
        const snapshot = await readWakeflowConfigAuthoritySnapshot(root, signalOptions(options.signal));
        return Object.freeze({ root, snapshot, options });
    }
    catch (error) {
        if (error instanceof WakeflowConfigAuthoritySnapshotError) {
            if (error.reason === "aborted")
                fail("io-failure", "aborted", "$signal", { cause: error });
            fail("precondition-failed", "config-authority", "$request.root", { cause: error });
        }
        throw error;
    }
}
function privateValues(context) {
    const values = new Set([context.snapshot.ledgerRoot]);
    for (const entry of context.snapshot.placements.roots) {
        values.add(entry.absolutePath);
        if (entry.realPath !== null)
            values.add(entry.realPath);
    }
    return values;
}
const PLANNING_FAILURE_TABLE = Object.freeze({
    input: ["invalid-request", "selection", "$request.selection"],
    aborted: ["io-failure", "aborted", "$signal"],
    config: ["precondition-failed", "config-authority", "$request.root"],
    demand: ["precondition-failed", "demand-authority", "$request.demandId"],
    "source-root": ["precondition-failed", "source-root", "$request.selection.source"],
    source: ["precondition-failed", "source-missing", "$request.selection.source"],
    "source-type": ["precondition-failed", "source-type", "$request.selection"],
    "source-changed": ["precondition-failed", "source-changed", "$request.selection"],
    capacity: ["precondition-failed", "capacity", "$request.selection"],
    kind: ["precondition-failed", "kind", "$request.selection"],
});
function mapPlanningError(error) {
    if (error instanceof ManagedEvidenceCapturePlanningServiceError) {
        const [code, reason, path] = PLANNING_FAILURE_TABLE[error.reason] ?? [
            "unexpected",
            error.reason,
            "$request",
        ];
        fail(code, reason, path, { cause: error });
    }
    throw error;
}
function mapApplicationError(error) {
    if (error instanceof ManagedEvidencePublicationApplicationServiceError) {
        const cause = { cause: error, details: { authority: error.publicationAuthority } };
        if (error.reason === "aborted")
            fail("io-failure", "aborted", "$signal", cause);
        if (error.reason === "input" || error.reason === "transaction") {
            fail("unexpected", error.reason, "$plan", cause);
        }
        if (error.reason === "config") {
            fail("precondition-failed", "config-authority", "$request.root", cause);
        }
        if (error.reason === "demand") {
            fail("precondition-failed", "demand-authority", "$request.demandId", cause);
        }
        fail("precondition-failed", error.reason, "$request", cause);
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
function mapContextError(error) {
    if (error instanceof DemandOperationAuthorityContextError) {
        if (error.reason === "aborted")
            fail("io-failure", "aborted", "$signal", { cause: error });
        fail("precondition-failed", `demand-root-${error.reason}`, "$request.demandId", {
            cause: error,
        });
    }
    throw error;
}
async function withDemandContext(context, demandId, use) {
    let demand;
    try {
        demand = await openDemandReadAuthorityContext(context.root, demandId, context.options.signal);
    }
    catch (error) {
        mapContextError(error);
    }
    let result;
    let failure;
    let succeeded = false;
    try {
        result = await use(demand);
        succeeded = true;
    }
    catch (error) {
        failure = error;
    }
    let closeFailure;
    try {
        await closeDemandOperationAuthorityContext(demand);
    }
    catch (error) {
        closeFailure = error;
    }
    if (failure !== undefined)
        throw failure;
    if (closeFailure !== undefined) {
        fail("io-failure", "demand-root-close", "$request.demandId", { cause: closeFailure });
    }
    if (!succeeded)
        fail("unexpected", "demand-context", "$request.demandId");
    return result;
}
async function planEvidence(context, input) {
    if (input.mode === "recover")
        fail("unexpected", "plan-mode", "$request.mode");
    const demandId = parseDemandId(input.demandId);
    let preview;
    try {
        preview = await new ManagedEvidenceCapturePlanningService(context.root).preview(demandId, input.selection, {
            ...(context.options.clock === undefined ? {} : { clock: context.options.clock }),
            ...signalOptions(context.options.signal),
        });
    }
    catch (error) {
        mapPlanningError(error);
    }
    if (preview.status === "blocked") {
        return Object.freeze({
            status: "blocked",
            blockers: preview.blockers,
            plan: null,
            digest: null,
        });
    }
    return Object.freeze({
        status: "ready",
        blockers: Object.freeze([]),
        plan: Object.freeze({ capturePlan: preview.plan, recorded: preview.existing }),
        digest: deriveEvidencePlanDigest(preview.plan),
    });
}
function eventReceipt(commit, eventId) {
    const stored = commit.events.find((event) => event.eventId === eventId);
    if (stored === undefined)
        fail("unexpected", "evidence-event-missing", "$result");
    return Object.freeze({
        eventId: stored.eventId,
        streamRevision: stored.streamRevision,
        commitId: commit.commitId,
    });
}
function completionPublication(completion) {
    const manifest = completion.transaction.manifest;
    return Object.freeze({
        evidenceId: manifest.evidenceId,
        kind: manifest.kind,
        manifestDigest: manifest.manifestDigest,
        payloadArtifactDigest: manifest.payload.artifactDigest,
        event: eventReceipt(completion.commit, completion.transaction.demandEventSourcingAppend.eventId),
        stateDigest: completion.loaded.aggregate.stateDigest,
    });
}
/** 同内容已记录：从聚合摘要与派生的 Commit 身份回放收据，不再读来源也不写任何东西。 */
async function replayRecorded(context, demandId, recorded) {
    const identity = deriveEvidenceEventIdentity(recorded.evidenceId);
    return withDemandContext(context, demandId, async (demand) => {
        let commit;
        try {
            commit = await new DemandEventSourcingRepository(demand.demandRoot).findCommitById(identity.commitId, signalOptions(context.options.signal));
        }
        catch (error) {
            mapRepositoryError(error);
        }
        if (commit === null)
            fail("precondition-failed", "evidence-commit-missing", "$request");
        return Object.freeze({
            disposition: "already-recorded",
            demandId,
            publication: Object.freeze({
                evidenceId: recorded.evidenceId,
                kind: recorded.kind,
                manifestDigest: recorded.manifestDigest,
                payloadArtifactDigest: recorded.payloadArtifactDigest,
                event: eventReceipt(commit, identity.eventId),
                stateDigest: demand.loaded.aggregate.stateDigest,
            }),
        });
    });
}
async function applyEvidence(context, input, plan) {
    const demandId = parseDemandId(input.demandId);
    if (plan.recorded !== null)
        return replayRecorded(context, demandId, plan.recorded);
    const identity = deriveEvidenceEventIdentity(plan.capturePlan.manifest.evidenceId);
    let transaction;
    try {
        transaction = createManagedEvidencePublicationTransaction({
            capturePlan: plan.capturePlan,
            eventId: identity.eventId,
            commitId: identity.commitId,
        });
    }
    catch (error) {
        if (error instanceof ManagedEvidencePublicationTransactionError) {
            fail("unexpected", "transaction", "$plan", { cause: error });
        }
        throw error;
    }
    let completion;
    try {
        completion = await new ManagedEvidencePublicationApplicationService(context.root).apply(transaction, computeManagedEvidencePublicationTransactionDigest(transaction), signalOptions(context.options.signal));
    }
    catch (error) {
        mapApplicationError(error);
    }
    return Object.freeze({
        disposition: "recorded",
        demandId,
        publication: completionPublication(completion),
    });
}
async function recoverEvidence(context, operationId) {
    const demandId = parseDemandId(operationId);
    let recovered;
    try {
        recovered = await new ManagedEvidencePublicationApplicationService(context.root).recover(demandId, signalOptions(context.options.signal));
    }
    catch (error) {
        mapApplicationError(error);
    }
    if (recovered.disposition === "completed") {
        return Object.freeze({
            disposition: "recovered",
            demandId,
            publication: completionPublication(recovered),
        });
    }
    return Object.freeze({
        disposition: recovered.disposition === "retired-stale" ? "retired" : "healthy",
        demandId,
        publication: null,
    });
}
/** 提交后读取复核快照；快照错误映射为稳定的 Wakeflow 错误，而不是 unexpected。 */
async function readSnapshotForNext(context, demand) {
    try {
        return await readDemandResultReviewSnapshot(demand.demandRoot, signalOptions(context.options.signal));
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
/** 变更后的 `next` 直接来自当前 Controller 路由；证据记录本身不改变前沿。 */
async function nextAfterMutation(context, demandId) {
    return withDemandContext(context, demandId, async (demand) => {
        const snapshot = await readSnapshotForNext(context, demand);
        return deriveNextProjection(buildDemandControllerRoute(demand.loaded, snapshot));
    });
}
function assembleResult(input, phase, next) {
    const base = {
        schemaVersion: WAKEFLOW_RECORD_EVIDENCE_PUBLIC_SCHEMA_VERSION,
        tool: WAKEFLOW_RECORD_EVIDENCE_PUBLIC_TOOL_NAME,
        next,
    };
    if (phase.mode === "preview") {
        const plan = phase.planned.plan;
        return admitRecordEvidenceResult({
            kind: "WakeflowRecordEvidencePreview",
            ...base,
            mode: "preview",
            status: phase.planned.status,
            blockers: phase.planned.blockers,
            planDigest: phase.planned.digest,
            demandId: input.demandId,
            plan: plan === null ? null : evidencePlanSummary(plan.capturePlan, plan.recorded !== null),
        });
    }
    return admitRecordEvidenceResult({
        kind: "WakeflowRecordEvidenceMutation",
        ...base,
        mode: phase.mode,
        disposition: phase.outcome.disposition,
        demandId: phase.outcome.demandId,
        publication: phase.outcome.publication,
    });
}
/** 执行一次 `wakeflow_record_evidence`。 */
export async function executeRecordEvidenceRequest(value, options = {}) {
    return runPublicationTransaction({
        tool: WAKEFLOW_RECORD_EVIDENCE_PUBLIC_TOOL_NAME,
        parseRequest: (raw) => {
            const request = parseRecordEvidenceRequest(raw);
            return { envelope: envelopeOf(request), input: request };
        },
        open: (root) => openContext(root, options),
        close: async () => { },
        plan: planEvidence,
        apply: (context, input, plan) => afterMutationRefresh(context.root, context.options.signal, () => applyEvidence(context, input, plan)),
        recover: recoverEvidence,
        next: async (context, phase) => phase.mode === "preview"
            ? evidencePreviewNext(phase.planned)
            : nextAfterMutation(context, phase.outcome.demandId),
        result: (_envelope, input, phase, next) => assembleResult(input, phase, next),
        privateValues,
    }, value, commandShellExecutionOptions(options.durability));
}
