import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { parseJsonValue } from "../../foundation/data/json-value.js";
import { RootedDirectoryError, } from "../../foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../foundation/time/utc-instant.js";
import { computeDemandEventStreamCommitDigest } from "../../governance/demand/event-sourcing/demand-event-stream-commit.js";
import { createDemandAuthority, DemandAuthorityError, } from "../../governance/demand/model/demand-authority.js";
import { createDemandIdentity, DemandIdentityError, } from "../../governance/demand/model/demand-identity.js";
import { parseRequirementLineageReference, RequirementLineageError, } from "../../governance/demand/model/requirement-lineage.js";
import { assertNoActiveDemand } from "../../governance/demand/publication/demand-active-guard.js";
import { DemandEventSourcingPublicationServiceError } from "../../governance/demand/publication/demand-event-sourcing-publication-contract.js";
import { publishDemandFromPackage, recoverDemandPublication, } from "../../governance/demand/publication/demand-event-sourcing-publication-service.js";
import { createDemandEventSourcingPublicationTransaction, DemandEventSourcingPublicationTransactionError, } from "../../governance/demand/publication/demand-event-sourcing-publication-transaction.js";
import { demandFinalRootRef } from "../../governance/demand/publication/demand-publication-paths.js";
import { createLedgerAuthorityMemberReference } from "../../governance/ledger/ledger-authority-reader.js";
import { LedgerAuthorityStoreError, } from "../../governance/ledger/ledger-authority-store.js";
import { afterMutationRefresh } from "../../governance/observation/active-projection-refresh.js";
import { commandShellExecutionOptions } from "../../kernel/command-shell.js";
import { fail, WakeflowError } from "../../kernel/error.js";
import { runPublicationTransaction, } from "../../kernel/publication-transaction.js";
import { readRequirementClaimState } from "../../kernel/requirement-board.js";
import { closeSliceContext, nextAfterMutation, now, openSliceContext, parseDemandId, previewNext, signalOptions, } from "./context.js";
import { admitDemandCreationResult, parseDemandCreationRequest, WAKEFLOW_DEMAND_CREATION_PUBLIC_TOOL_NAME, WAKEFLOW_DEMAND_PUBLIC_SCHEMA_VERSION, } from "./contract.js";
import { deriveCreationBlockers, deriveDemandCreationIds } from "./decide.js";
/** 预演身份与权威关系用的固定时间；不发布。 */
const DRAFT_INSTANT = parseUtcInstant("2000-01-01T00:00:00.000Z");
async function loadPackage(context, requirementId) {
    try {
        return await context.store.loadRequirement(requirementId, signalOptions(context.signal));
    }
    catch (error) {
        if (error instanceof LedgerAuthorityStoreError) {
            if (error.reason === "not-found")
                return null;
            if (error.reason === "aborted")
                fail("io-failure", "aborted", "$signal", { cause: error });
            fail("io-failure", `ledger-${error.reason}`, "$ledger", { cause: error });
        }
        throw error;
    }
}
/**
 * ADR-0011 D7 按 ADR-0010 D3 收窄：一个 pod 同一时刻只推进一个 Demand。返回该 pod 上
 * 另一个活动 Demand 的标识，没有即 null；`excluding` 让 continue 忽略自己。
 */
export async function activeDemandOnPod(context, podId, excluding) {
    try {
        await assertNoActiveDemand(context.root, context.signal, excluding, podId);
        return null;
    }
    catch (error) {
        if (error instanceof WakeflowError && error.reason === "pod-busy") {
            // 守卫保证 details 带占用者；没有就不是这里能解释的错误，原样上抛。
            const demandId = error.details?.demandId;
            if (demandId !== undefined)
                return demandId;
        }
        throw error;
    }
}
/** 请求缺省指向 primary pod；配置里不存在的 podId 在阻塞项里报出，不在这里抛。 */
function requestedPod(context, podId) {
    const requestedPodId = podId ?? context.snapshot.indexes.primaryPod.pod.podId;
    const pod = Object.hasOwn(context.snapshot.indexes.podById, requestedPodId)
        ? context.snapshot.indexes.podById[requestedPodId]
        : undefined;
    return Object.freeze({ requestedPodId, pod: pod ?? null });
}
function buildIdentityAndAuthority(context, demand, loaded, demandId, createdAt, podId) {
    try {
        const lineage = parseRequirementLineageReference({
            artifactKind: "wakeflow-requirement-lineage",
            schemaVersion: 1,
            requirementId: loaded.record.requirementId,
            recordRef: loaded.recordRef,
            recordDigest: loaded.recordDigest,
        });
        const identity = createDemandIdentity({
            programId: context.snapshot.model.program.programId,
            demandId,
            title: demand.title,
            goal: demand.goal,
            completionDefinition: demand.completionDefinition,
            demandType: loaded.record.demandType,
            source: lineage,
            podId,
        }, { clock: () => createdAt });
        const authority = createDemandAuthority(identity, {
            authorityRefs: loaded.documents.map((document) => createLedgerAuthorityMemberReference(loaded, document.path)),
            testingDecision: {
                mode: loaded.record.testingDecision.mode,
                summary: loaded.record.testingDecision.summary,
                environmentMemberRef: null,
            },
        });
        return Object.freeze({ identity, authority });
    }
    catch (error) {
        if (error instanceof DemandIdentityError ||
            error instanceof DemandAuthorityError ||
            error instanceof RequirementLineageError ||
            error instanceof LedgerAuthorityStoreError) {
            fail("precondition-failed", `authority-${error.reason}`, "$request.demand", { cause: error });
        }
        throw error;
    }
}
async function demandRootExists(root, demandId) {
    try {
        await root.inspectExistingResource(demandFinalRootRef(demandId), "$demandRoot");
        return true;
    }
    catch (error) {
        if (error instanceof RootedDirectoryError && error.reason === "resource-not-found")
            return false;
        if (error instanceof RootedDirectoryError) {
            fail("io-failure", `demand-root-${error.reason}`, "$demandRoot", { cause: error });
        }
        throw error;
    }
}
function blocked(blockers) {
    return Object.freeze({ status: "blocked", blockers, plan: null, digest: null });
}
async function planCreate(context, input, facts) {
    const claim = await readRequirementClaimState(context.root, input.requirementId, context.signal);
    const loaded = claim === null ? null : await loadPackage(context, input.requirementId);
    const programId = context.snapshot.model.program.programId;
    const { requestedPodId, pod } = requestedPod(context, input.podId);
    const blockers = [
        ...deriveCreationBlockers({
            claim: claim?.state ?? null,
            programMatches: loaded !== null && loaded.record.programId === programId,
            recordMatches: loaded !== null &&
                claim !== null &&
                loaded.recordDigest === claim.state.recordDigest &&
                loaded.record.programId === claim.state.programId,
            pod: pod === null
                ? null
                : {
                    podId: pod.podId,
                    lifecycle: pod.lifecycle,
                    activeDemandId: await activeDemandOnPod(context, pod.podId, null),
                },
            requestedPodId,
        }),
    ];
    if (claim === null || loaded === null)
        return blocked(blockers);
    const ids = deriveDemandCreationIds(input.requirementId, claim.digest);
    facts.demandId = ids.demandId;
    const demand = Object.freeze({
        title: input.demand.title,
        goal: input.demand.goal,
        completionDefinition: input.demand.completionDefinition,
    });
    try {
        buildIdentityAndAuthority(context, demand, loaded, ids.demandId, DRAFT_INSTANT, requestedPodId);
    }
    catch (error) {
        if (error instanceof WakeflowError)
            blockers.push(error.reason);
        else
            throw error;
    }
    if (await demandRootExists(context.root, ids.demandId))
        blockers.push("demand-root-exists");
    if (blockers.length > 0)
        return blocked(Object.freeze(blockers));
    const plan = Object.freeze({
        action: "create",
        requirementId: input.requirementId,
        expectedClaimStateDigest: claim.digest,
        recordDigest: loaded.recordDigest,
        demandId: ids.demandId,
        eventId: ids.eventId,
        commitId: ids.commitId,
        demand,
        podId: requestedPodId,
        configDigest: context.snapshot.configDigest,
    });
    return Object.freeze({
        status: "ready",
        blockers: Object.freeze([]),
        plan,
        digest: computeCanonicalJsonSha256Digest(parseJsonValue(plan, "$plan")),
    });
}
function mapPublicationError(error) {
    if (error instanceof DemandEventSourcingPublicationServiceError) {
        switch (error.reason) {
            case "aborted":
                fail("io-failure", "aborted", "$signal", { cause: error });
                break;
            case "cas-mismatch":
            case "lock-timeout":
                fail("concurrency-conflict", `publication-${error.reason}`, "$board", {
                    cause: error,
                    retryable: true,
                });
                break;
            case "recovery-required":
                fail("recovery-required", "demand-publication", "$demandRoot", { cause: error });
                break;
            case "conflict":
            case "package-not-found":
            case "authority":
                fail("precondition-failed", `publication-${error.reason}`, "$request", { cause: error });
                break;
            default:
                fail("io-failure", `publication-${error.reason}`, "$demandRoot", { cause: error });
        }
    }
    throw error;
}
function publicationReceipt(publication) {
    const commit = publication.loaded.firstCommit;
    const event = commit.events[0];
    const claim = publication.claim.state;
    if (commit.commitSequence !== 1 ||
        commit.lastStreamRevision !== 1 ||
        event.eventType !== "publication.demand-published" ||
        claim.status !== "claimed" ||
        claim.claim === null ||
        claim.claim.demandId !== publication.demandId) {
        fail("unexpected", "publication-receipt", "$demandRoot");
    }
    return Object.freeze({
        demandId: publication.demandId,
        identityDigest: publication.loaded.identityDigest,
        authorityDigest: publication.loaded.authorityDigest,
        commandDigest: commit.commandDigest,
        event: Object.freeze({ eventId: event.eventId, streamRevision: 1 }),
        commit: Object.freeze({
            commitId: commit.commitId,
            commitSequence: 1,
            commitDigest: computeDemandEventStreamCommitDigest(commit),
        }),
        stateDigest: event.resultingStateDigest,
        claim: Object.freeze({
            requirementId: claim.requirementId,
            stateRevision: claim.revision,
            stateDigest: publication.claim.digest,
        }),
    });
}
async function applyCreate(context, plan) {
    const loaded = await loadPackage(context, plan.requirementId);
    if (loaded === null)
        fail("precondition-failed", "package-record-absent", "$ledger");
    const at = now(context);
    const { identity, authority } = buildIdentityAndAuthority(context, plan.demand, loaded, plan.demandId, at, plan.podId);
    const transactionInput = {
        identity,
        authority,
        eventId: plan.eventId,
        commitId: plan.commitId,
        recordedAt: at,
        expectedClaimStateDigest: plan.expectedClaimStateDigest,
    };
    try {
        // 发布服务自己重建事务；这里先过一遍编解码，把关系错误报成前置条件而不是 I/O。
        createDemandEventSourcingPublicationTransaction(transactionInput);
    }
    catch (error) {
        if (error instanceof DemandEventSourcingPublicationTransactionError) {
            fail("precondition-failed", `transaction-${error.reason}`, "$plan", { cause: error });
        }
        throw error;
    }
    let publication;
    try {
        publication = await publishDemandFromPackage(context.root, context.store, transactionInput, signalOptions(context.signal));
    }
    catch (error) {
        mapPublicationError(error);
    }
    return Object.freeze({
        disposition: publication.wroteDemandRoot ? "created" : "current",
        demandId: publication.demandId,
        publication: publicationReceipt(publication),
    });
}
async function recoverCreate(context, operationId) {
    const demandId = parseDemandId(operationId, "$request.operationId");
    let publication;
    try {
        publication = await recoverDemandPublication(context.root, context.store, demandId, signalOptions(context.signal));
    }
    catch (error) {
        if (error instanceof DemandEventSourcingPublicationServiceError &&
            error.reason === "not-found") {
            fail("not-found", "publication-absent", "$request.operationId", { cause: error });
        }
        mapPublicationError(error);
    }
    return Object.freeze({
        disposition: "recovered",
        demandId,
        publication: publicationReceipt(publication),
    });
}
function assembleCreateResult(envelope, input, phase, next, facts) {
    const base = {
        schemaVersion: WAKEFLOW_DEMAND_PUBLIC_SCHEMA_VERSION,
        tool: WAKEFLOW_DEMAND_CREATION_PUBLIC_TOOL_NAME,
        next,
    };
    if (phase.mode === "preview") {
        if (input.mode === "recover")
            fail("unexpected", "preview-mode", "$request.mode");
        return admitDemandCreationResult({
            ...base,
            kind: "WakeflowDemandCreationPreview",
            mode: "preview",
            status: phase.planned.status,
            blockers: phase.planned.blockers,
            planDigest: phase.planned.digest,
            demandId: facts.demandId,
            requirementId: input.requirementId,
        });
    }
    return admitDemandCreationResult({
        ...base,
        kind: "WakeflowDemandCreationMutation",
        mode: envelope.mode,
        disposition: phase.outcome.disposition,
        publication: phase.outcome.publication,
    });
}
function creationEnvelope(request) {
    if (request.mode === "recover") {
        return {
            root: request.root,
            mode: "recover",
            planDigest: null,
            operationId: request.operationId,
        };
    }
    return {
        root: request.root,
        mode: request.mode,
        planDigest: request.mode === "apply" ? (request.planDigest ?? null) : null,
        operationId: null,
    };
}
/** 执行一次 `wakeflow_create_demand`。 */
export async function executeDemandCreationRequest(value, options = {}) {
    const facts = { demandId: null };
    return runPublicationTransaction({
        tool: WAKEFLOW_DEMAND_CREATION_PUBLIC_TOOL_NAME,
        parseRequest: (raw) => {
            const request = parseDemandCreationRequest(raw);
            return { envelope: creationEnvelope(request), input: request };
        },
        open: (root) => openSliceContext(root, options),
        close: closeSliceContext,
        plan: (context, input) => {
            if (input.mode === "recover")
                fail("unexpected", "plan-mode", "$request.mode");
            return planCreate(context, input, facts);
        },
        apply: (context, _input, plan) => afterMutationRefresh(context.root, context.signal, () => applyCreate(context, plan)),
        recover: (context, operationId) => recoverCreate(context, operationId),
        next: async (context, phase) => phase.mode === "preview"
            ? previewNext(WAKEFLOW_DEMAND_CREATION_PUBLIC_TOOL_NAME, "demand-creation-apply", phase.planned)
            : nextAfterMutation(context, phase.outcome.demandId),
        result: (envelope, input, phase, next) => assembleCreateResult(envelope, input, phase, next, facts),
        privateValues: (context) => [context.snapshot.ledgerRoot, context.ledgerRoot.absolutePath],
    }, value, commandShellExecutionOptions(options.durability));
}
