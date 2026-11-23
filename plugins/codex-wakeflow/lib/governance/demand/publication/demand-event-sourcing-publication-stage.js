import { DurableAtomicFileStageRecoveryError, recoverDurableAtomicFileStagesInDirectory, } from "../../../foundation/filesystem/durable-atomic-file-stage-recovery.js";
import { DurableDirectoryMaterializationError, materializeDirectoryPath, } from "../../../foundation/filesystem/durable-directory-materialization.js";
import { DurableResourceRenameError, renameResourceDurably, } from "../../../foundation/filesystem/durable-resource-rename.js";
import { TASK_PACKAGE_PROJECTIONS_ROOT_REF } from "../../tasking/task-package-projection-paths.js";
import { DemandEventSourcingCommandHandlerError, executeDemandEventSourcingCommand, } from "../event-sourcing/demand-event-sourcing-command-handler.js";
import { DEMAND_EVENT_SOURCING_ARTIFACTS_ROOT_REF, DEMAND_EVENT_SOURCING_AUTHORITY_REF, DEMAND_EVENT_SOURCING_IDENTITY_REF, DEMAND_EVENT_SOURCING_TRANSACTIONS_ROOT_REF, } from "../event-sourcing/demand-event-sourcing-paths.js";
import { DemandEventSourcingRepository, DemandEventSourcingRepositoryError, } from "../event-sourcing/demand-event-sourcing-repository.js";
import { DemandEventSourcingRootAuthorityError, loadDemandEventSourcingRootAuthority, } from "../event-sourcing/demand-event-sourcing-root-authority.js";
import { DemandEventSourcingRootInventoryError, inspectDemandEventSourcingRootInventory, } from "../event-sourcing/demand-event-sourcing-root-inventory.js";
import { computeDemandEventStreamCommitDigest } from "../event-sourcing/demand-event-stream-commit.js";
import { DemandFileEventSnapshotStoreError } from "../event-sourcing/demand-file-event-snapshot-store.js";
import { DemandFileEventStore, DemandFileEventStoreError, } from "../event-sourcing/demand-file-event-store.js";
import { DemandStageResidueError, retireDemandCacheStageResidue, } from "../event-sourcing/demand-stage-residue.js";
import { renderDemandAuthority } from "../model/demand-authority.js";
import { renderDemandIdentity } from "../model/demand-identity.js";
import { DEMAND_EVENT_SOURCING_PUBLICATION_DIRECTORY_MODE, DEMAND_EVENT_SOURCING_PUBLICATION_FILE_MODE, DemandEventSourcingPublicationServiceError, failDemandEventSourcingPublication as fail, } from "./demand-event-sourcing-publication-contract.js";
import { admitDemandPublicationResourceOperation, assertPrivatePublicationNode, ensureExactPublicationTextFile, ensurePublicationTransaction, openDemandPublicationRoot, publicationNodeOrNull, } from "./demand-event-sourcing-publication-storage.js";
import { DEMAND_PUBLICATION_MARKER_REF } from "./demand-publication-paths.js";
/** Demand 事件溯源根目录的暂存构建、整体重命名和最终加载。 */
function mapStageError(error) {
    if (error instanceof DemandEventSourcingPublicationServiceError)
        throw error;
    if (error instanceof DurableAtomicFileStageRecoveryError ||
        error instanceof DemandStageResidueError) {
        if (error.reason === "aborted")
            fail("aborted", "$signal");
        fail("recovery-required", "$stage");
    }
    if (error instanceof DemandFileEventStoreError ||
        error instanceof DemandFileEventSnapshotStoreError ||
        error instanceof DemandEventSourcingRepositoryError ||
        error instanceof DemandEventSourcingCommandHandlerError ||
        error instanceof DemandEventSourcingRootInventoryError) {
        if (error.reason === "aborted")
            fail("aborted", "$signal");
        fail("conflict", "$stage");
    }
    if (error instanceof DurableDirectoryMaterializationError) {
        if (error.reason === "aborted")
            fail("aborted", "$signal");
        fail("operation-failure", "$stage/directories", "unknown", error);
    }
    throw error;
}
/**
 * 在暂存根里把一个新 Demand 的全部初始内容建出来：发布标记、事件存储与三个目录、身份与权威文本、
 * 初始提交与它的快照，最后按"发布中"的口径清点一遍。每一步都可重入。
 *
 * 标记最先写（1.4 第 5 段 5a 的 B 行，ADR-0031）：它带着完整的事务，是这次创建唯一落盘的记录——
 * 暂存里只要有别的内容，就读得到它，被打断的创建据此续做。此前根外面另有一份同样的副本，已经删掉。
 *
 * 重入时先结算上一次被杀的创建留下的原子暂存（1.4.1 段 1b）：身份与权威两份文件走目录级恢复，成对的
 * 核对目标确实是写出去的那一份再退役暂存（标记的那一对在读标记之前已经这样回收过）；`index/` 与
 * `snapshots/` 是缓存，成对的连目标一起丢掉，后面的步骤会重新写出来。以前这些残留让同一个创建请求一直
 * 以冲突被拒绝。
 */
/**
 * 暂存根自己这一层（身份与权威两份文件）里死写者的原子暂存；还有活着或认不出的就不往下做。标记自己的
 * 暂存在 `transactions/` 里，进到这里之前已经由同一把发布锁里的 `readPendingPublication` 回收过。
 */
async function settlePublicationStageFiles(stageRoot, signal) {
    const receipt = await recoverDurableAtomicFileStagesInDirectory(stageRoot, null, signal === undefined ? undefined : { signal });
    if (receipt.activeStageCount !== 0 || receipt.unknownStageCount !== 0) {
        fail("recovery-required", "$stage");
    }
}
async function populateDemandPublicationStage(stageRoot, transaction, signal) {
    await materializeDirectoryPath(stageRoot, DEMAND_EVENT_SOURCING_TRANSACTIONS_ROOT_REF, {
        mode: DEMAND_EVENT_SOURCING_PUBLICATION_DIRECTORY_MODE,
        ...(signal === undefined ? {} : { signal }),
    });
    await settlePublicationStageFiles(stageRoot, signal);
    await ensurePublicationTransaction(stageRoot, DEMAND_PUBLICATION_MARKER_REF, transaction, signal);
    const eventStore = new DemandFileEventStore(stageRoot);
    await eventStore.initialize(signal === undefined ? undefined : { signal });
    for (const ref of [
        DEMAND_EVENT_SOURCING_ARTIFACTS_ROOT_REF,
        TASK_PACKAGE_PROJECTIONS_ROOT_REF,
        DEMAND_EVENT_SOURCING_TRANSACTIONS_ROOT_REF,
    ]) {
        await materializeDirectoryPath(stageRoot, ref, {
            mode: DEMAND_EVENT_SOURCING_PUBLICATION_DIRECTORY_MODE,
            ...(signal === undefined ? {} : { signal }),
        });
    }
    await ensureExactPublicationTextFile(stageRoot, DEMAND_EVENT_SOURCING_IDENTITY_REF, renderDemandIdentity(transaction.identity), 512 * 1024, signal);
    await ensureExactPublicationTextFile(stageRoot, DEMAND_EVENT_SOURCING_AUTHORITY_REF, renderDemandAuthority(transaction.authority), 1024 * 1024, signal);
    await eventStore.recoverAppendCandidates(signal === undefined ? undefined : { signal });
    await retireDemandCacheStageResidue(stageRoot, DEMAND_EVENT_SOURCING_PUBLICATION_FILE_MODE, signal === undefined ? {} : { signal });
    const repository = new DemandEventSourcingRepository(stageRoot);
    // 有意不盖写者戳（C11）：初始提交由事务用 planDemandEventStreamCommit 规划并以 initialCommitDigest
    // 绑定，戳进提交摘要链，带戳重算的摘要就对不上下面的比对；Demand 的后续提交才带戳。
    const result = await executeDemandEventSourcingCommand(repository, transaction.initialCommand, {
        commitId: transaction.initialCommit.commitId,
        expectedStreamRevision: 0,
        ...(signal === undefined ? {} : { signal }),
    });
    if (result.commandDigest !== transaction.initialCommandDigest ||
        computeDemandEventStreamCommitDigest(result.commit) !== transaction.initialCommitDigest ||
        result.aggregate.streamRevision !== 1) {
        fail("conflict", "$stage/commit");
    }
    await repository.publishSnapshot(result.aggregate, signal === undefined ? undefined : { signal });
    await inspectDemandEventSourcingRootInventory(stageRoot, {
        phase: "demand-publication",
        ...(signal === undefined ? {} : { signal }),
    });
}
export async function materializeDemandPublicationStage(workspaceRoot, transaction, signal) {
    let stageNode;
    try {
        stageNode = (await materializeDirectoryPath(workspaceRoot, transaction.stageRef, {
            mode: DEMAND_EVENT_SOURCING_PUBLICATION_DIRECTORY_MODE,
            ...(signal === undefined ? {} : { signal }),
        })).node;
    }
    catch (error) {
        mapStageError(error);
    }
    const stageRoot = await openDemandPublicationRoot(workspaceRoot, transaction.stageRef, stageNode);
    let operationError;
    try {
        await populateDemandPublicationStage(stageRoot, transaction, signal);
    }
    catch (error) {
        operationError = error;
    }
    let closeError;
    try {
        await stageRoot.close();
    }
    catch (error) {
        closeError = error;
    }
    if (operationError !== undefined)
        mapStageError(operationError);
    if (closeError !== undefined)
        fail("operation-failure", "$stage/close", "unknown", closeError);
}
export async function publishDemandStage(root, transaction, signal) {
    const stageNode = await publicationNodeOrNull(root, transaction.stageRef);
    if (stageNode === null)
        fail("conflict", "$stage");
    assertPrivatePublicationNode(stageNode, "directory", "$stage");
    admitDemandPublicationResourceOperation(transaction, transaction.finalRootRef, "exact-directory-publish");
    try {
        await renameResourceDurably(root, transaction.stageRef, transaction.finalRootRef, {
            expectedSourceNode: stageNode,
            ...(signal === undefined ? {} : { signal }),
        });
    }
    catch (error) {
        if (error instanceof DurableResourceRenameError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            if (error.reason === "commit-uncertain" ||
                error.reason === "durability-failure" ||
                error.reason === "close-failure") {
                fail("recovery-required", "$stage");
            }
            fail("conflict", "$stage");
        }
        throw error;
    }
}
/** 读回 final 失败：本模块自己的错误原样抛；根权威读不出按中止与冲突归类；其余原样抛。 */
function rethrowFinalLoadError(error) {
    if (error instanceof DemandEventSourcingPublicationServiceError) {
        throw error;
    }
    if (error instanceof DemandEventSourcingRootAuthorityError) {
        if (error.reason === "aborted")
            fail("aborted", "$signal");
        fail("conflict", "$demandRoot");
    }
    throw error;
}
export async function loadFinalDemandPublication(workspaceRoot, ledgerStore, transaction, signal) {
    const finalNode = await publicationNodeOrNull(workspaceRoot, transaction.finalRootRef);
    if (finalNode === null)
        fail("conflict", "$demandRoot");
    assertPrivatePublicationNode(finalNode, "directory", "$demandRoot");
    const demandRoot = await openDemandPublicationRoot(workspaceRoot, transaction.finalRootRef, finalNode);
    let loaded;
    let operationError;
    try {
        loaded = await loadDemandEventSourcingRootAuthority(demandRoot, ledgerStore, signal === undefined ? undefined : { signal });
        if (loaded.identityDigest !== transaction.identityDigest ||
            loaded.authorityDigest !== transaction.authorityDigest ||
            loaded.firstCommit.commitId !== transaction.initialCommit.commitId ||
            computeDemandEventStreamCommitDigest(loaded.firstCommit) !== transaction.initialCommitDigest) {
            fail("conflict", "$demandRoot");
        }
    }
    catch (error) {
        operationError = error;
    }
    let closeError;
    try {
        await demandRoot.close();
    }
    catch (error) {
        closeError = error;
    }
    if (operationError !== undefined)
        rethrowFinalLoadError(operationError);
    if (closeError !== undefined) {
        fail("operation-failure", "$demandRoot/close", "unknown", closeError);
    }
    if (loaded === undefined)
        fail("operation-failure", "$demandRoot");
    return loaded;
}
