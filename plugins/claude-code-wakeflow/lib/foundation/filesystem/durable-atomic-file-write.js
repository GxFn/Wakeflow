import { lstat } from "node:fs/promises";
import { readNodeSystemErrorCode } from "../node/node-system-error.js";
import { assertDurableAtomicFileStageCurrent, closeDurableAtomicFileStageHandle, createExclusiveDurableAtomicFileStage, prepareDurableAtomicFileStage, recoverDurableAtomicFileStagesBeforeWrite, releaseDurableAtomicFileStage, unlinkOwnedDurableAtomicFileStage, } from "./durable-atomic-file-stage-io.js";
import { assertDurableAtomicFileTargetAbsent, assertDurableAtomicFileTargetParentCurrent, assertExpectedDurableAtomicFileTarget, closeDurableAtomicFileTargetParent, inspectCommittedDurableAtomicFileTarget, openDurableAtomicFileTargetParent, syncDurableAtomicFileTargetParent, } from "./durable-atomic-file-target-io.js";
import { assertDurableAtomicFileNotAborted, assertDurableAtomicFileRoot, DurableAtomicFileWriteError, failDurableAtomicFileWrite as fail, parseDurableAtomicFileCreateOptions, parseDurableAtomicFileReplaceOptions, snapshotDurableAtomicFileInputBytes, } from "./durable-atomic-file-write-contract.js";
import { createFileNodeSnapshot, sameFileNodeSnapshot, } from "./file-node-snapshot.js";
import { filesystemMutation } from "./filesystem-mutation.js";
/**
 * Wakeflow Foundation / Filesystem：单个完整字节文件的耐久原子发布门面。
 *
 * 本模块独占“创建时建立硬链接”和“替换时执行重命名”两个提交点，并编排相邻合同、
 * 自描述暂存文件 I/O、目标预期和父目录持久性。子模块不公开第二套写入器；调用方
 * 仍只使用本模块的创建和替换 API。
 *
 * 创建（`fsync` 级别）恰好三次同步，可见步骤与父目录同步的顺序固定：写暂存、同步暂存内容、
 * 硬链接到目标、同步父目录、删暂存、同步父目录。替换恰好两次：写暂存、同步暂存内容、
 * 在当前目标仍与调用方读到的预期一致时重命名、同步父目录。替换在建暂存之前先做一次廉价预检
 * （对目标一次 `lstat`，与预期里的节点快照比较，不读内容、不算摘要），过时的预期在这里失败时
 * 磁盘上什么都不留（拒绝之前先复验父目录，父目录被换走报 `parent-changed`）；完整的预期比较（摘要）只做一次，紧挨重命名，是唯一的发布条件。
 * 两者都不把写下的字节读回来比对，提交之后的复验只比较句柄、路径名与目标上的节点身份。
 * 必须守住的不变量：`fsync` 级别下，旁边没有暂存的目标，它的目录项已经同步过——暂存只在
 * 链接之后那次父目录同步完成以后才删。本层不创建父目录、不解释业务权威事实，也不替代
 * 领域互斥锁或恢复意图记录。
 *
 * `target-exists` 在 `fsync` 级别意味着“目标的目录项已经落盘”：有的调用方把它读作成功
 * （同一份记录已经在了）。目标旁边若还有另一个写入者的暂存（它链接之后、第一次父目录同步
 * 之前被杀，或仍在运行、或写入前的恢复因并发枚举报忙而跳过了它），这个目录项可能还没同步过。
 * 所以创建在三处报 `target-exists` 之前（第一次与第二次“目标不存在”检查、链接的 `EEXIST`）
 * 各先同步一次目标的父目录：目录同步让此前该目录里的全部目录项变化落盘，含对方的链接，而对方
 * 在链接之前已经同步过暂存内容。这次同步只在本次写入自己的有效级别会同步父目录时发生（`fsync`），
 * `content-only`、`none` 与 `none` 的根都不同步，那里的 `target-exists` 只说明“名字在”。保证的
 * 范围只是目标自己的父目录、且只对链接之前同步过内容的目标（`fsync` 与 `content-only` 的写入者）
 * 成立，不涉及任何祖先目录的目录项。这次同步失败时调用方拿不到 `target-exists`：同步调用失败报
 * `durability-failure`，同步前后父目录身份变了报 `parent-changed`，两者都按失败处理（读作成功的
 * 调用方因此报错重试；`fsync` 级别的锁在竞争窗口里会报获取失败而不是“被占用”）。成功路径不多同步：
 * 上面的三次与两次不变。
 *
 * 是否真正执行 `fsync` 的权威是根的持久化级别：`root.durability` 为 `none` 时，
 * 经由该根的创建与替换都不同步。创建的逐次选项 `durability` 只能往下收：`content-only`
 * 在链接之前同步暂存内容、一次父目录都不同步（恰好一次，供能自行退役的锁与租约使用），
 * `none` 一次都不同步（供可重建的派生检查点使用）；两者取更弱的一档，逐次选项无法把一个
 * `none` 的根抬回 `fsync`。替换没有逐次选项（档表第 0 节：锁不替换），永远按 `fsync` 请求、
 * 只由根收窄。上面"旁边没有暂存的目标已经同步过目录项"的不变量只对 `fsync` 级别成立。
 *
 * 逐次选项只管本次发布协议本身（暂存内容、链接、删暂存前后的父目录同步）。写入之前对同一
 * 目标遗留暂存的恢复不看逐次选项，只跟随根的级别：`fsync` 的根上，即使本次是 `content-only`
 * 或 `none`，退役一个中断留下的暂存仍可能同步一次父目录；上面"恰好一次"与"零次"的计数只在
 * 旁边没有可退役的遗留暂存时成立。
 *
 * 失败时本次自己的暂存（尚未提交）会被删掉并同步父目录。清理再失败时，主错误优先（例如替换在
 * 暂存写好之后才发现预期已过时，调用方仍看到 `expectation-changed`）；唯一的例外是主错误为
 * `target-exists`：读作成功的调用方不能把一次没做成的清理当成功吞掉，所以调用方看到的是清理
 * 失败本身（`stage-cleanup-failure`，或清理那次父目录同步的 `durability-failure` / `parent-changed`）。
 */
/** 报 `target-exists` 之前，本次写入的有效级别会同步父目录时先同步一次；失败时抛同步自己的错误。 */
async function settleExistingTargetBeforeReport(parent, syncParent) {
    if (syncParent)
        await syncDurableAtomicFileTargetParent(parent);
}
/** 创建前的“目标不存在”检查；目标已在时先按级别同步父目录，再报 `target-exists`。 */
async function assertCreateTargetAbsent(parent, syncParent) {
    try {
        await assertDurableAtomicFileTargetAbsent(parent);
    }
    catch (error) {
        if (error instanceof DurableAtomicFileWriteError && error.reason === "target-exists") {
            await settleExistingTargetBeforeReport(parent, syncParent);
        }
        throw error;
    }
}
/**
 * 替换在建暂存之前的廉价预检：对目标一次 `lstat`，与预期里的节点快照比较。它只能拒绝、不能放行：
 * 通过之后紧挨重命名的完整比较仍会再读一遍目标并比较摘要。
 *
 * 裸 `lstat` 走路径名、不复验父目录；父目录被换走时它看见的是别处的节点（或 `ENOENT`、`ENOTDIR`）。
 * 所以拒绝之前先复验父目录：父目录已经不是打开的那一个时报 `parent-changed`，与其余各步一致；
 * 这次复验只发生在拒绝路径上。
 */
async function assertExpectedTargetNodeUnchanged(parent, expected) {
    let current = null;
    let cause;
    try {
        current = createFileNodeSnapshot(await lstat(parent.resourceAbsolutePath, { bigint: true }), "$resourcePath");
    }
    catch (error) {
        cause = error;
    }
    if (current !== null && sameFileNodeSnapshot(current, expected.node))
        return;
    await assertDurableAtomicFileTargetParentCurrent(parent);
    if (current !== null || readNodeSystemErrorCode(cause) === "ENOENT") {
        fail("expectation-changed", "$resourcePath", cause);
    }
    fail("expectation-read-failure", "$resourcePath", cause);
}
async function performWrite(root, resourcePath, input, mode, signal, publication, expected, requested) {
    const durability = root.durability === "none" ? "none" : requested;
    const syncContent = durability !== "none";
    const syncParent = durability === "fsync";
    const parent = await openDurableAtomicFileTargetParent(root, resourcePath);
    let openStage;
    let stage;
    let stagePathOwned = false;
    let committed = false;
    let primaryError;
    let result;
    try {
        await recoverDurableAtomicFileStagesBeforeWrite(root, resourcePath, signal);
        assertDurableAtomicFileNotAborted(signal);
        if (publication === "created") {
            await assertCreateTargetAbsent(parent, syncParent);
        }
        else if (expected !== null) {
            await assertExpectedTargetNodeUnchanged(parent, expected);
        }
        openStage = await createExclusiveDurableAtomicFileStage(parent, publication === "created" ? "create" : "replace", resourcePath, input.digest, mode);
        stagePathOwned = true;
        stage = await prepareDurableAtomicFileStage(openStage, input, mode, signal, syncContent);
        await assertDurableAtomicFileTargetParentCurrent(parent);
        await assertDurableAtomicFileStageCurrent(stage);
        assertDurableAtomicFileNotAborted(signal);
        if (publication === "created") {
            await assertCreateTargetAbsent(parent, syncParent);
        }
        else if (expected !== null) {
            // 替换唯一的一次完整比较：紧挨着重命名，当前目标仍是调用方读到的那一份才发布。
            await assertExpectedDurableAtomicFileTarget(root, resourcePath, expected, signal);
        }
        await assertDurableAtomicFileTargetParentCurrent(parent);
        await assertDurableAtomicFileStageCurrent(stage);
        assertDurableAtomicFileNotAborted(signal);
        let finalNode;
        if (publication === "created") {
            try {
                await filesystemMutation.link(stage.physicalPath, parent.resourceAbsolutePath);
            }
            catch (error) {
                if (readNodeSystemErrorCode(error) === "EEXIST") {
                    await settleExistingTargetBeforeReport(parent, syncParent);
                    fail("target-exists", "$resourcePath", error);
                }
                fail("publish-failure", "$resourcePath", error);
            }
            committed = true;
            const linkedNode = await inspectCommittedDurableAtomicFileTarget(parent, stage, input, mode, 2n);
            // 先让双链接对的目录项落盘，再删暂存：目标旁边没有暂存，就说明目标的目录项已经同步过；
            // 后续清理中断时，暂存文件恢复仍可前向结算。
            if (syncParent)
                await syncDurableAtomicFileTargetParent(parent);
            await assertDurableAtomicFileTargetParentCurrent(parent);
            const durableLinkedNode = await inspectCommittedDurableAtomicFileTarget(parent, stage, input, mode, 2n);
            if (!sameFileNodeSnapshot(linkedNode, durableLinkedNode)) {
                fail("commit-uncertain", "$resourcePath");
            }
            await unlinkOwnedDurableAtomicFileStage(stage);
            stagePathOwned = false;
            if (syncParent)
                await syncDurableAtomicFileTargetParent(parent);
            await assertDurableAtomicFileTargetParentCurrent(parent);
            finalNode = await inspectCommittedDurableAtomicFileTarget(parent, stage, input, mode, 1n);
        }
        else {
            try {
                await filesystemMutation.rename(stage.physicalPath, parent.resourceAbsolutePath);
            }
            catch (cause) {
                fail("publish-failure", "$resourcePath", cause);
            }
            committed = true;
            stagePathOwned = false;
            const committedNode = await inspectCommittedDurableAtomicFileTarget(parent, stage, input, mode, 1n);
            if (syncParent)
                await syncDurableAtomicFileTargetParent(parent);
            await assertDurableAtomicFileTargetParentCurrent(parent);
            finalNode = await inspectCommittedDurableAtomicFileTarget(parent, stage, input, mode, 1n);
            if (!sameFileNodeSnapshot(committedNode, finalNode)) {
                fail("commit-uncertain", "$resourcePath");
            }
        }
        result = Object.freeze({
            resourcePath,
            publication,
            node: finalNode,
            byteCount: input.byteCount,
            digest: input.digest,
        });
    }
    catch (error) {
        primaryError = error;
    }
    if (openStage !== undefined && stagePathOwned && !committed) {
        try {
            await unlinkOwnedDurableAtomicFileStage(openStage);
            if (syncParent)
                await syncDurableAtomicFileTargetParent(parent);
            stagePathOwned = false;
        }
        catch (error) {
            // 清理失败不得盖住更早的主错误（例如替换在暂存写好之后才发现预期已过时）；
            // 主错误是 `target-exists` 时例外：有的调用方把它读作成功，清理失败必须让它看见。
            if (primaryError === undefined ||
                (primaryError instanceof DurableAtomicFileWriteError &&
                    primaryError.reason === "target-exists")) {
                primaryError = error;
            }
        }
    }
    if (openStage !== undefined) {
        const closeError = await closeDurableAtomicFileStageHandle(openStage.handle);
        if (primaryError === undefined && closeError !== undefined) {
            primaryError = closeError;
        }
        const releaseError = releaseDurableAtomicFileStage(openStage);
        if (primaryError === undefined && releaseError !== undefined) {
            primaryError = releaseError;
        }
    }
    const parentCloseError = await closeDurableAtomicFileTargetParent(parent);
    if (primaryError === undefined && parentCloseError !== undefined) {
        primaryError = parentCloseError;
    }
    if (primaryError !== undefined)
        throw primaryError;
    if (committed !== true || result === undefined) {
        fail("commit-uncertain", "$resourcePath");
    }
    return result;
}
/** 耐久创建一个此前不存在的完整字节文件。 */
export async function createFileAtomically(root, resourcePath, bytes, options) {
    assertDurableAtomicFileRoot(root);
    const parsed = parseDurableAtomicFileCreateOptions(options);
    const input = snapshotDurableAtomicFileInputBytes(bytes);
    assertDurableAtomicFileNotAborted(parsed.signal);
    return performWrite(root, resourcePath, input, parsed.mode, parsed.signal, "created", null, parsed.durability);
}
/** 耐久替换一个仍匹配完整前序 StableFileSource 的完整字节文件。 */
export async function replaceFileAtomically(root, resourcePath, bytes, options) {
    assertDurableAtomicFileRoot(root);
    const parsed = parseDurableAtomicFileReplaceOptions(options);
    if (parsed.expected.resourcePath !== resourcePath) {
        fail("input", "$options.expected.resourcePath");
    }
    const input = snapshotDurableAtomicFileInputBytes(bytes);
    assertDurableAtomicFileNotAborted(parsed.signal);
    const result = await performWrite(root, resourcePath, input, parsed.mode, parsed.signal, "replaced", parsed.expected, 
    // 替换永远按 `fsync` 请求，级别只由根收窄；这里没有可转发的逐次豁免。
    "fsync");
    return Object.freeze({ ...result, previous: parsed.expected });
}
export { DurableAtomicFileWriteError, } from "./durable-atomic-file-write-contract.js";
