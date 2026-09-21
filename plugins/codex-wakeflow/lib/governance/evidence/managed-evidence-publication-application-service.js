import { types } from "node:util";
import { readWakeflowConfigAuthoritySnapshot, WakeflowConfigAuthoritySnapshotError, } from "../../configuration/wakeflow-config-authority-snapshot.js";
import { parseWakeflowDurableIdOfKind, WakeflowDurableIdError, } from "../../contracts/identity/wakeflow-durable-id.js";
import { parseSha256Digest, Sha256Error, } from "../../foundation/crypto/sha256.js";
import { parsePlainRecord, PassiveOwnDataError, } from "../../foundation/data/passive-own-data.js";
import { RootedDirectory, RootedDirectoryError, } from "../../foundation/filesystem/rooted-directory.js";
import { assertDemandOperationConfigCurrent, closeDemandOperationAuthorityContext, openDemandOperationAuthorityContext, openDemandOperationRoot, DemandOperationAuthorityContextError, } from "../demand/demand-operation-authority-context.js";
import {} from "../demand/event-sourcing/demand-event-sourcing-aggregate.js";
import { openConfiguredManagedEvidenceSourceRoot, ManagedEvidenceConfiguredSourceRootError, } from "./managed-evidence-configured-source-root.js";
import { materializeManagedEvidencePublicationStage, ManagedEvidencePublicationStageMaterializationError, } from "./managed-evidence-publication-stage-materializer.js";
import { createManagedEvidencePublicationTransactionJournal, loadManagedEvidencePublicationTransaction, ManagedEvidencePublicationTransactionStoreError, } from "./managed-evidence-publication-transaction-store.js";
import { appendManagedEvidencePublicationEvent, completeManagedEvidencePublicationTransaction, findManagedEvidencePublicationCommit, loadCurrentManagedEvidencePublicationTransaction, loadManagedEvidencePublicationHealthyAuthority, loadManagedEvidencePublicationTransactionAuthority, retireStaleManagedEvidencePublicationTransaction, ManagedEvidencePublicationTransactionSettlementError, } from "./managed-evidence-publication-transaction-settlement.js";
import { computeManagedEvidencePublicationTransactionDigest, parseManagedEvidencePublicationTransaction, ManagedEvidencePublicationTransactionError, } from "./managed-evidence-publication-transaction.js";
const ERROR_MESSAGES = {
    input: "Managed evidence publication application input is invalid.",
    transaction: "Managed evidence publication transaction is invalid.",
    config: "Managed evidence publication Config no longer matches its plan.",
    demand: "Managed evidence publication Demand no longer matches its plan.",
    "source-root": "Managed evidence publication source root is invalid.",
    journal: "Managed evidence publication journal is unavailable or conflicting.",
    stage: "Managed evidence publication stage could not be completed safely.",
    "event-sourcing": "Managed evidence publication Event append is invalid or conflicting.",
    final: "Managed evidence publication final record could not be completed safely.",
    closure: "Managed evidence publication could not prove its Demand root closure.",
    aborted: "Managed evidence publication application was aborted.",
    "recovery-required": "Managed evidence publication requires explicit recovery.",
    "operation-failure": "Managed evidence publication application failed.",
};
/** Application无法证明无副作用、可恢复或已完成状态时的稳定、脱敏错误。 */
export class ManagedEvidencePublicationApplicationServiceError extends Error {
    name = "ManagedEvidencePublicationApplicationServiceError";
    code = "wakeflow-managed-evidence-publication-application-service";
    reason;
    causeCode;
    causeReason;
    publicationAuthority;
    constructor(reason, causeCode = null, causeReason = null, publicationAuthority = "unknown") {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.causeCode = causeCode;
        this.causeReason = causeReason;
        this.publicationAuthority = publicationAuthority;
    }
}
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
    throw new ManagedEvidencePublicationApplicationServiceError(reason, ownString(cause, "code"), ownString(cause, "reason"));
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
    if (Object.keys(record).some((key) => key !== "signal") ||
        (record.signal !== undefined &&
            (typeof record.signal !== "object" ||
                record.signal === null ||
                types.isProxy(record.signal) ||
                !(record.signal instanceof AbortSignal)))) {
        fail("input");
    }
    return Object.freeze({ signal: record.signal });
}
function assertNotAborted(signal) {
    if (signal?.aborted === true)
        fail("aborted");
}
function parseApplyInput(transactionValue, transactionDigestValue) {
    let transaction;
    let transactionDigest;
    try {
        transaction = parseManagedEvidencePublicationTransaction(transactionValue);
        transactionDigest = parseSha256Digest(transactionDigestValue, "$transactionDigest");
    }
    catch (error) {
        if (error instanceof ManagedEvidencePublicationTransactionError ||
            error instanceof Sha256Error) {
            fail("transaction", error);
        }
        throw error;
    }
    if (computeManagedEvidencePublicationTransactionDigest(transaction) !==
        transactionDigest) {
        fail("transaction");
    }
    return Object.freeze({ transaction, transactionDigest });
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
function sameExpectedAggregate(aggregate, transaction) {
    const expected = transaction.demandEventSourcingAppend;
    return (aggregate.streamRevision === expected.expectedStreamRevision &&
        aggregate.stateDigest === expected.expectedStateDigest &&
        aggregate.lastEvent.eventId === expected.expectedLastEventId &&
        aggregate.lastEventDigest === expected.expectedLastEventDigest);
}
function sameConfigRelation(config, transaction) {
    const manifest = transaction.manifest;
    return (config.configDigest === manifest.recordedBy.configDigest &&
        config.model.program.programId === manifest.programId &&
        config.indexes.controllerWindow.windowId === manifest.recordedBy.windowId);
}
function assertConfigRelation(config, transaction) {
    if (!sameConfigRelation(config, transaction))
        fail("config");
}
function assertHealthyBaseline(context, transaction) {
    const manifest = transaction.manifest;
    assertConfigRelation(context.config, transaction);
    if (context.loaded.identity.programId !== manifest.programId ||
        context.loaded.identity.demandId !== manifest.demandId ||
        context.loaded.authorityDigest !== manifest.demandAuthorityDigest ||
        context.loaded.aggregate.state.lifecycle !== "active" ||
        !sameExpectedAggregate(context.loaded.aggregate, transaction)) {
        fail("demand");
    }
}
function mapContextError(error) {
    if (error.reason === "aborted")
        fail("aborted", error);
    if (error.reason === "config" || error.reason === "stale-config") {
        fail("config", error);
    }
    if (error.reason === "root")
        fail("demand", error);
    fail("demand", error);
}
function mapStoreError(error) {
    if (error.reason === "aborted")
        fail("aborted", error);
    if (error.reason === "transaction-exists")
        fail("recovery-required", error);
    if (error.reason === "recovery-required") {
        fail("recovery-required", error);
    }
    fail("journal", error);
}
function settlementFailure(error) {
    return new ManagedEvidencePublicationApplicationServiceError(error.reason, error.code, error.reason);
}
function contextualizeFailure(error, publicationAuthority) {
    const mapped = error instanceof ManagedEvidencePublicationTransactionSettlementError
        ? settlementFailure(error)
        : error;
    if (mapped instanceof ManagedEvidencePublicationApplicationServiceError) {
        return new ManagedEvidencePublicationApplicationServiceError(mapped.reason, mapped.causeCode, mapped.causeReason, publicationAuthority);
    }
    return mapped;
}
async function assertConfigCurrent(workspaceRoot, config, signal) {
    try {
        await assertDemandOperationConfigCurrent(workspaceRoot, config, signal);
    }
    catch (error) {
        if (error instanceof DemandOperationAuthorityContextError) {
            mapContextError(error);
        }
        throw error;
    }
}
/** 引用类来源没有物理根：payload 是来源投影，由 Manifest 重建。 */
async function openSourceRoot(workspaceRoot, config, transaction) {
    const source = transaction.manifest.source;
    if (source.kind !== "managed-path")
        return null;
    try {
        return await openConfiguredManagedEvidenceSourceRoot(workspaceRoot, config, source);
    }
    catch (error) {
        if (error instanceof ManagedEvidenceConfiguredSourceRootError) {
            fail("source-root", error);
        }
        throw error;
    }
}
async function closeSourceRoot(root) {
    try {
        await root.close();
    }
    catch (error) {
        if (error instanceof RootedDirectoryError)
            fail("source-root", error);
        throw error;
    }
}
async function materializeStage(sourceRoot, demandRoot, transaction, signal) {
    try {
        await materializeManagedEvidencePublicationStage(sourceRoot, demandRoot, transaction, signal === undefined ? undefined : { signal });
    }
    catch (error) {
        if (error instanceof ManagedEvidencePublicationStageMaterializationError) {
            if (error.reason === "aborted")
                fail("aborted", error);
            if (error.reason === "recovery-required") {
                fail("recovery-required", error);
            }
            fail("stage", error);
        }
        throw error;
    }
}
async function readConfig(workspaceRoot, signal) {
    try {
        return await readWakeflowConfigAuthoritySnapshot(workspaceRoot, signal === undefined ? undefined : { signal });
    }
    catch (error) {
        if (error instanceof WakeflowConfigAuthoritySnapshotError) {
            if (error.reason === "aborted")
                fail("aborted", error);
            fail("config", error);
        }
        throw error;
    }
}
async function openRecoveryRoots(workspaceRoot, demandId, signal) {
    const config = await readConfig(workspaceRoot, signal);
    let ledgerRoot;
    let demandRoot;
    try {
        ledgerRoot = await RootedDirectory.open(config.ledgerRoot, "$ledgerRoot");
        if (ledgerRoot.absolutePath !== config.ledgerRoot)
            fail("config");
        demandRoot = await openDemandOperationRoot(workspaceRoot, demandId);
        return Object.freeze({ config, demandRoot, ledgerRoot });
    }
    catch (error) {
        if (demandRoot !== undefined) {
            try {
                await demandRoot.close();
            }
            catch {
                // 首个根关系错误优先。
            }
        }
        if (ledgerRoot !== undefined) {
            try {
                await ledgerRoot.close();
            }
            catch {
                // 首个根关系错误优先。
            }
        }
        if (error instanceof ManagedEvidencePublicationApplicationServiceError) {
            throw error;
        }
        if (error instanceof DemandOperationAuthorityContextError) {
            mapContextError(error);
        }
        if (error instanceof RootedDirectoryError)
            fail("demand", error);
        throw error;
    }
}
async function closeRecoveryRoots(roots) {
    let failure;
    try {
        await roots.demandRoot.close();
    }
    catch (error) {
        failure = error;
    }
    try {
        await roots.ledgerRoot.close();
    }
    catch (error) {
        if (failure === undefined)
            failure = error;
    }
    if (failure !== undefined)
        fail("demand", failure);
}
export class ManagedEvidencePublicationApplicationService {
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
    /** 应用一份exact Transaction；现存journal始终转交显式recover。 */
    async apply(transactionValue, transactionDigestValue, optionsValue = {}) {
        const options = parseOptions(optionsValue);
        assertNotAborted(options.signal);
        const { transaction, transactionDigest } = parseApplyInput(transactionValue, transactionDigestValue);
        let context;
        let sourceRoot;
        let result;
        let publicationAuthority = "unchanged";
        let failure;
        try {
            try {
                context = await openDemandOperationAuthorityContext(this.#workspaceRoot, transaction.manifest.demandId, options.signal);
            }
            catch (error) {
                if (error instanceof DemandOperationAuthorityContextError) {
                    mapContextError(error);
                }
                throw error;
            }
            try {
                assertHealthyBaseline(context, transaction);
            }
            catch (error) {
                if (error instanceof ManagedEvidencePublicationApplicationServiceError &&
                    (error.reason === "config" || error.reason === "demand")) {
                    const completion = await loadCurrentManagedEvidencePublicationTransaction(context.demandRoot, context.ledgerRoot, transaction, transactionDigest, options.signal);
                    result = Object.freeze({
                        disposition: "completed",
                        transaction,
                        transactionDigest,
                        ...completion,
                    });
                    publicationAuthority = "current";
                }
                else {
                    throw error;
                }
            }
            if (result === undefined) {
                await assertConfigCurrent(this.#workspaceRoot, context.config, options.signal);
                sourceRoot = await openSourceRoot(this.#workspaceRoot, context.config, transaction);
                let stored;
                try {
                    stored = await createManagedEvidencePublicationTransactionJournal(context.demandRoot, transaction, options.signal === undefined
                        ? undefined
                        : { signal: options.signal });
                }
                catch (error) {
                    if (error instanceof ManagedEvidencePublicationTransactionStoreError) {
                        mapStoreError(error);
                    }
                    throw error;
                }
                publicationAuthority = "recoverable";
                if (stored.transactionDigest !== transactionDigest)
                    fail("transaction");
                await materializeStage(sourceRoot, context.demandRoot, transaction, options.signal);
                if (sourceRoot !== null)
                    await closeSourceRoot(sourceRoot);
                sourceRoot = undefined;
                const event = await appendManagedEvidencePublicationEvent(context.demandRoot, transaction, options.signal);
                const completion = await completeManagedEvidencePublicationTransaction(context.demandRoot, context.ledgerRoot, stored, event.disposition, options.signal);
                result = Object.freeze({
                    disposition: "completed",
                    transaction: stored.transaction,
                    transactionDigest: stored.transactionDigest,
                    ...completion,
                });
                publicationAuthority = "current";
            }
        }
        catch (error) {
            failure = contextualizeFailure(error, publicationAuthority);
        }
        if (sourceRoot !== undefined && sourceRoot !== null) {
            try {
                await closeSourceRoot(sourceRoot);
            }
            catch (error) {
                if (failure === undefined) {
                    failure = contextualizeFailure(error, publicationAuthority);
                }
            }
        }
        if (context !== undefined) {
            try {
                await closeDemandOperationAuthorityContext(context);
            }
            catch (error) {
                if (failure === undefined) {
                    failure = error instanceof DemandOperationAuthorityContextError
                        ? new ManagedEvidencePublicationApplicationServiceError(error.reason === "aborted" ? "aborted" : "demand", error.code, error.reason, publicationAuthority)
                        : error;
                }
            }
        }
        if (failure !== undefined)
            throw failure;
        if (result === undefined)
            fail("operation-failure");
        return result;
    }
    /**
     * 恢复固定journal：目标Commit存在时前向完成；Commit缺失且CAS已过期时安全退休。
     */
    async recover(demandIdValue, optionsValue = {}) {
        const options = parseOptions(optionsValue);
        assertNotAborted(options.signal);
        const demandId = parseDemandId(demandIdValue);
        let roots;
        let sourceRoot;
        let result;
        let publicationAuthority = "unknown";
        let failure;
        try {
            roots = await openRecoveryRoots(this.#workspaceRoot, demandId, options.signal);
            let stored;
            try {
                stored = await loadManagedEvidencePublicationTransaction(roots.demandRoot, options.signal === undefined ? undefined : { signal: options.signal });
            }
            catch (error) {
                if (error instanceof ManagedEvidencePublicationTransactionStoreError) {
                    mapStoreError(error);
                }
                throw error;
            }
            if (stored === null) {
                await assertConfigCurrent(this.#workspaceRoot, roots.config, options.signal);
                const loaded = await loadManagedEvidencePublicationHealthyAuthority(roots.demandRoot, roots.ledgerRoot, options.signal);
                result = Object.freeze({
                    disposition: "healthy",
                    loaded,
                });
                publicationAuthority = "current";
            }
            else {
                publicationAuthority = "recoverable";
                if (stored.transaction.manifest.demandId !== demandId)
                    fail("journal");
                const authority = await loadManagedEvidencePublicationTransactionAuthority(roots.demandRoot, roots.ledgerRoot, options.signal);
                if (authority.inventory.managedEvidence.publication
                    ?.transactionDigest !== stored.transactionDigest) {
                    fail("closure");
                }
                await assertConfigCurrent(this.#workspaceRoot, roots.config, options.signal);
                const existing = await findManagedEvidencePublicationCommit(roots.demandRoot, stored.transaction, options.signal);
                const targetSelector = authority.aggregate.state.managedEvidence?.find((selector) => selector.evidenceId === stored.transaction.manifest.evidenceId);
                const physicalState = authority.inventory.managedEvidence.publication?.physicalState;
                if (existing === null && targetSelector !== undefined) {
                    // Event selector存在却找不到Transaction绑定的Commit，不能把stage当作可回滚事实。
                    fail("recovery-required");
                }
                if (existing !== null) {
                    const completion = await completeManagedEvidencePublicationTransaction(roots.demandRoot, roots.ledgerRoot, stored, "existing", options.signal);
                    result = Object.freeze({
                        disposition: "completed",
                        transaction: stored.transaction,
                        transactionDigest: stored.transactionDigest,
                        ...completion,
                    });
                    publicationAuthority = "current";
                }
                else if (!sameExpectedAggregate(authority.aggregate, stored.transaction) ||
                    (physicalState !== "stage-complete" &&
                        !sameConfigRelation(roots.config, stored.transaction))) {
                    const retirement = await retireStaleManagedEvidencePublicationTransaction(roots.demandRoot, roots.ledgerRoot, stored, options.signal);
                    result = Object.freeze({
                        disposition: "retired-stale",
                        transaction: stored.transaction,
                        transactionDigest: stored.transactionDigest,
                        ...retirement,
                    });
                    publicationAuthority = "unchanged";
                }
                else {
                    if (physicalState !== "stage-complete") {
                        sourceRoot = await openSourceRoot(this.#workspaceRoot, roots.config, stored.transaction);
                        await materializeStage(sourceRoot, roots.demandRoot, stored.transaction, options.signal);
                        if (sourceRoot !== null)
                            await closeSourceRoot(sourceRoot);
                        sourceRoot = undefined;
                    }
                    const event = await appendManagedEvidencePublicationEvent(roots.demandRoot, stored.transaction, options.signal);
                    const completion = await completeManagedEvidencePublicationTransaction(roots.demandRoot, roots.ledgerRoot, stored, event.disposition, options.signal);
                    result = Object.freeze({
                        disposition: "completed",
                        transaction: stored.transaction,
                        transactionDigest: stored.transactionDigest,
                        ...completion,
                    });
                    publicationAuthority = "current";
                }
            }
        }
        catch (error) {
            failure = contextualizeFailure(error, publicationAuthority);
        }
        if (sourceRoot !== undefined && sourceRoot !== null) {
            try {
                await closeSourceRoot(sourceRoot);
            }
            catch (error) {
                if (failure === undefined) {
                    failure = contextualizeFailure(error, publicationAuthority);
                }
            }
        }
        if (roots !== undefined) {
            try {
                await closeRecoveryRoots(roots);
            }
            catch (error) {
                if (failure === undefined) {
                    failure = contextualizeFailure(error, publicationAuthority);
                }
            }
        }
        if (failure !== undefined)
            throw failure;
        if (result === undefined)
            fail("operation-failure");
        return result;
    }
}
