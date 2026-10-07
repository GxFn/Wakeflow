import { parseWakeflowDurableIdOfKind, WakeflowDurableIdError, } from "../../../contracts/identity/wakeflow-durable-id.js";
import { RootedDirectory, RootedDirectoryError, } from "../../../foundation/filesystem/rooted-directory.js";
import { readStrictTextFile, StrictTextFileError } from "../../../foundation/filesystem/strict-text-file.js";
import { StableFileReadError } from "../../../foundation/filesystem/stable-file-read.js";
import { DurableAtomicFileStageAddressError, hasDurableAtomicFileStagePrefix, parseDurableAtomicFileStageFileName, readDurableAtomicFileStageOwnerState, } from "../../../foundation/filesystem/durable-atomic-file-stage-address.js";
import { fail } from "../../../kernel/error.js";
import { listRequirementClaimStates, } from "../../../kernel/requirement-board.js";
import { DemandIdentityError, parseDemandIdentityDocument } from "../model/demand-identity.js";
import { DEMAND_EVENT_SOURCING_IDENTITY_REF } from "../event-sourcing/demand-event-sourcing-paths.js";
import { DEMAND_IDENTITY_MAXIMUM_BYTES } from "../event-sourcing/demand-event-sourcing-root-authority.js";
import { closeDemandOperationRoot, DemandOperationAuthorityContextError, openDemandOperationRoot, } from "../demand-operation-authority-context.js";
import { readWakeflowConfigAuthoritySnapshot } from "../../../configuration/wakeflow-config-authority-snapshot.js";
import { parsePortableResourcePath } from "../../../foundation/filesystem/portable-resource-path.js";
import { readStableResourceDirectory, StableDirectoryReadError } from "../../../foundation/filesystem/stable-directory-read.js";
import { DEMAND_LIFECYCLE_JOURNALS_ROOT_REF } from "../../../kernel/layout.js";
import { locateLatestDemandArchive } from "../../observation/demand-archive-locator.js";
import { readPublicationTransactionAt } from "./demand-event-sourcing-publication-storage.js";
import { DEMAND_PUBLICATION_TRANSACTIONS_ROOT_REF } from "./demand-publication-paths.js";
import { DemandEventSourcingRepository, DemandEventSourcingRepositoryError, } from "../event-sourcing/demand-event-sourcing-repository.js";
import { demandFinalRootRef } from "./demand-publication-paths.js";
/**
 * Wakeflow Governance / Demand：活动 Demand 守卫（ADR-0011 D7，按 ADR-0010 D3 收窄到 pod）。
 *
 * 一个 pod 同一时刻只推进一个 Demand：看板上 `claimed` 的包若其 Demand 根存在、身份记录
 * 的 pod 等于目标 pod 且聚合未到终态，即为该 pod 的活动 Demand。根无法证明终态时同样视为
 * 活动。preview 与 apply 都检查。
 */
async function resourceExists(root, ref) {
    try {
        await root.inspectExistingResource(ref);
        return true;
    }
    catch (error) {
        if (error instanceof RootedDirectoryError &&
            error.reason === "resource-not-found") {
            return false;
        }
        if (error instanceof RootedDirectoryError) {
            fail("io-failure", "demand-root-inspect", "$demandRoot", { cause: error });
        }
        throw error;
    }
}
/**
 * 身份记录的 pod；读不到或不合法时返回 null，调用方把它当作活动（不能证明属于别的 pod）。
 * 中止照常上抛。
 */
async function identityPodId(demandRoot, signal) {
    try {
        const read = await readStrictTextFile(demandRoot, DEMAND_EVENT_SOURCING_IDENTITY_REF, {
            maximumBytes: DEMAND_IDENTITY_MAXIMUM_BYTES,
            ...(signal === undefined ? {} : { signal }),
        });
        return parseDemandIdentityDocument(read.text).podId;
    }
    catch (error) {
        if (error instanceof StableFileReadError) {
            if (error.reason === "aborted")
                throw error;
            return null;
        }
        if (error instanceof StrictTextFileError || error instanceof DemandIdentityError)
            return null;
        throw error;
    }
}
/** 一个已认领包对应的 Demand 根存在、属于目标 pod 且聚合未到终态即为该 pod 的活动 Demand。 */
export async function demandIsActive(root, state, signal, podId = null) {
    if (state.claim === null)
        return false;
    let demandId;
    try {
        demandId = parseWakeflowDurableIdOfKind(state.claim.demandId, "demand");
    }
    catch (error) {
        if (error instanceof WakeflowDurableIdError) {
            fail("precondition-failed", "claim-demand-id", "$board", { cause: error });
        }
        throw error;
    }
    if (!(await resourceExists(root, demandFinalRootRef(demandId))))
        return false;
    let demandRoot;
    try {
        demandRoot = await openDemandOperationRoot(root, demandId);
    }
    catch (error) {
        if (error instanceof DemandOperationAuthorityContextError)
            return true;
        throw error;
    }
    let active = true;
    let failure;
    try {
        const loaded = await new DemandEventSourcingRepository(demandRoot).load(signal === undefined ? undefined : { signal });
        if (loaded !== null) {
            const lifecycle = loaded.aggregate.state.lifecycle;
            active = lifecycle !== "completed" && lifecycle !== "cancelled";
            if (active && podId !== null) {
                const ownerPodId = await identityPodId(demandRoot, signal);
                active = ownerPodId === null || ownerPodId === podId;
            }
        }
    }
    catch (error) {
        if ((error instanceof DemandEventSourcingRepositoryError ||
            error instanceof StableFileReadError) &&
            error.reason === "aborted") {
            failure = error;
        }
    }
    try {
        await closeDemandOperationRoot(demandRoot);
    }
    catch (error) {
        if (failure === undefined)
            failure = error;
    }
    if (failure !== undefined) {
        if (failure instanceof DemandEventSourcingRepositoryError ||
            failure instanceof StableFileReadError) {
            fail("io-failure", "aborted", "$signal", { cause: failure });
        }
        if (failure instanceof DemandOperationAuthorityContextError) {
            fail("io-failure", "demand-root-close", "$demandRoot", { cause: failure });
        }
        throw failure;
    }
    return active;
}
/**
 * 目标 pod 已有活动 Demand 时拒绝再认领任何需求包（`pod-busy`，details 带占用的 demandId）；
 * `excluding` 让 continue 忽略自己；`podId` 为 null 时退回全局守卫。
 */
export async function assertNoActiveDemand(root, signal, excluding = null, podId = null) {
    await assertNoPendingPodMutation(root, signal, excluding, podId);
    const states = (await listRequirementClaimStates(root, signal)).states;
    for (const state of states) {
        // 看板关系保证 claimed 必有 claim；这里收窄一次，让 details 的 demandId 总是存在。
        if (state.status !== "claimed" || state.claim === null)
            continue;
        if (state.claim.demandId === excluding)
            continue;
        if (await demandIsActive(root, state, signal, podId)) {
            fail("precondition-failed", "pod-busy", "$board", {
                details: { demandId: state.claim.demandId },
            });
        }
    }
}
/** 活动根或最近归档中的 pod 身份；旧或损坏数据无法定位时返回 null，守卫保持保守。 */
export async function readDemandPodId(root, demandId, signal) {
    const id = parseWakeflowDurableIdOfKind(demandId, "demand");
    if (await resourceExists(root, demandFinalRootRef(id))) {
        const demandRoot = await openDemandOperationRoot(root, id);
        try {
            return await identityPodId(demandRoot, signal);
        }
        finally {
            await closeDemandOperationRoot(demandRoot);
        }
    }
    const options = signal === undefined ? {} : { signal };
    const config = await readWakeflowConfigAuthoritySnapshot(root, options);
    const ledger = await RootedDirectory.open(config.ledgerRoot, "$ledgerRoot", { durability: root.durability });
    try {
        return (await locateLatestDemandArchive(ledger, demandId, signal))?.podId ?? null;
    }
    finally {
        await ledger.close();
    }
}
async function pendingEntries(root, ref, signal) {
    try {
        return (await readStableResourceDirectory(root, parsePortableResourcePath(ref), {
            maximumEntries: 4096, ...(signal === undefined ? {} : { signal }),
        })).entries;
    }
    catch (error) {
        if (error instanceof StableDirectoryReadError && error.reason === "not-found")
            return [];
        throw error;
    }
}
/**
 * 目录里 foundation 自己的原子暂存文件不是发布意图（§13.161 B3-2）：活着的写者正在落一个事务，
 * 按可重试冲突让调用方稍后再来；死写者留下的暂存由下一次同目标写入回收，守卫跳过且不删除；
 * 所有者未知时仍按残留保守拒绝。
 */
function isDeadWriterStage(name, scope) {
    if (!hasDurableAtomicFileStagePrefix(name))
        return false;
    let stage;
    try {
        stage = parseDurableAtomicFileStageFileName(name);
    }
    catch (error) {
        if (error instanceof DurableAtomicFileStageAddressError)
            return false;
        throw error;
    }
    const owner = readDurableAtomicFileStageOwnerState(stage);
    if (owner === "active") {
        fail("concurrency-conflict", `${scope}-in-flight`, "$board", { retryable: true });
    }
    return owner === "inactive";
}
/** 崩溃释放进程锁不代表业务已结清：已有发布意图和生命周期日志继续保留 pod 占用。 */
async function assertNoPendingPodMutation(root, signal, excluding, podId) {
    for (const entry of await pendingEntries(root, DEMAND_PUBLICATION_TRANSACTIONS_ROOT_REF, signal)) {
        if (!/^demand_[0-9a-f-]+\.json$/u.test(entry.name)) {
            if (isDeadWriterStage(entry.name, "pod-publication"))
                continue;
            fail("precondition-failed", "pod-publication-residue", "$pod");
        }
        const id = parseWakeflowDurableIdOfKind(entry.name.slice(0, -5), "demand");
        if (id === excluding)
            continue;
        const stored = await readPublicationTransactionAt(root, entry.resourcePath, entry.node, signal);
        if (stored.transaction.demandId !== id)
            fail("precondition-failed", "pod-publication-residue", "$pod");
        if (podId === null || stored.transaction.identity.podId === podId) {
            fail("precondition-failed", "pod-busy", "$board", { details: { demandId: id } });
        }
    }
    for (const entry of await pendingEntries(root, DEMAND_LIFECYCLE_JOURNALS_ROOT_REF, signal)) {
        if (!/^demand_[0-9a-f-]+\.json$/u.test(entry.name)) {
            if (isDeadWriterStage(entry.name, "pod-lifecycle"))
                continue;
            fail("precondition-failed", "pod-lifecycle-residue", "$pod");
        }
        const id = parseWakeflowDurableIdOfKind(entry.name.slice(0, -5), "demand");
        if (id === excluding)
            continue;
        const ownerPodId = await readDemandPodId(root, id, signal);
        if (podId === null || ownerPodId === null || ownerPodId === podId) {
            fail("precondition-failed", "pod-busy", "$board", { details: { demandId: id } });
        }
    }
}
