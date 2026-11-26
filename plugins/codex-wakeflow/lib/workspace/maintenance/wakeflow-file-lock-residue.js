import { ExactRegularFileUnlinkError, unlinkRegularFileExactly, } from "../../foundation/filesystem/exact-regular-file-unlink.js";
import { parsePortableResourcePath, } from "../../foundation/filesystem/portable-resource-path.js";
import { RootedDirectoryError, } from "../../foundation/filesystem/rooted-directory.js";
import { RootedDirectoryTreeRemovalError, removeRootedDirectoryTree, } from "../../foundation/filesystem/rooted-directory-tree-removal.js";
import { signalOptions } from "../../foundation/node/abort-signal.js";
import { WAKEFLOW_WORKSPACE_HOST_IDS } from "../workspace-host-resource-profile.js";
/**
 * Wakeflow Workspace / Maintenance：文件锁版本（1.4.3 及之前）留下的锁目录与锁文件（ADR-0033 决定 10）。
 *
 * 那些版本的锁是"创建即持有、删除即释放"的文件，散在工作区各处；这一版的锁都在
 * `.wakeflow-local/runtime/locks/`，下面这些路径没有人再读。更新之后第一次做成的维护在门内把它们删掉，
 * 不判断旧持有者是否还活着——更新只在没有在途调用时做（ADR-0026）。路径写成字面量：它们记的是旧版本
 * 写过什么，不跟着今天的布局常量走。
 *
 * 账本事务目录里按记录命名的旧锁文件不在这里：账本根不一定在工作区根下，那种文件只在一次发布被强杀后
 * 才留下，也没有读者会被它挡住。
 *
 * 这个模块只活一个版本：1.4.4 之后的版本删掉它与它的调用。
 */
const ref = (value) => parsePortableResourcePath(value, "$layout");
/** 每个文件锁版本的工作区都有的准入目录。它在，清理就还没有做完；所以最后才删它。 */
const MARKER_REF = ref(".wakeflow-local/runtime/operation-admission");
const DIRECTORY_REFS = Object.freeze([
    ref(".wakeflow-local/runtime/pod-mutations"),
    ref(".wakeflow-active/current/board/locks"),
    ref(".wakeflow-active/current/demand-publication/locks"),
]);
/** 只在持有者被强杀之后才会留下的锁文件。 */
const FILE_REFS = Object.freeze([
    ref(".wakeflow-local/runtime/maintenance.lock"),
    ref(".wakeflow-active/projector.lock"),
    ref(".wakeflow-config-authority.lock"),
    ref(".wakeflow-gitignore-recomposition.lock"),
    ...WAKEFLOW_WORKSPACE_HOST_IDS.flatMap((hostId) => [
        ref(`.wakeflow-program-instruction-${hostId}.lock`),
        ref(`.wakeflow-local/runtime/hosts/${hostId}/identity/window-bindings/.registration.lock`),
    ]),
]);
/** `resourcePath` 上的节点；不在（连同它的某一级父目录不在）时是 null。 */
async function nodeOrNull(root, resourcePath) {
    try {
        return (await root.inspectExistingResource(resourcePath, "$residue")).node;
    }
    catch (error) {
        if (error instanceof RootedDirectoryError && error.reason === "resource-not-found")
            return null;
        throw error;
    }
}
/**
 * 删掉文件锁版本留下的锁目录与锁文件。尽力而为：哪一步删不掉就停在那里，记号还在，下一次维护接着做；
 * 清完之后每次维护只多一次查看。调用方持有维护的门。
 */
export async function retireWakeflowFileLockResidue(root, signal) {
    const removeTree = (resourcePath) => removeRootedDirectoryTree(root, resourcePath, { missing: "ignore", ...signalOptions(signal) });
    try {
        if ((await nodeOrNull(root, MARKER_REF)) === null)
            return;
        for (const directory of DIRECTORY_REFS)
            await removeTree(directory);
        for (const file of FILE_REFS) {
            const node = await nodeOrNull(root, file);
            if (node?.kind !== "file")
                continue;
            await unlinkRegularFileExactly(root, file, { expectedNode: node, ...signalOptions(signal) });
        }
        await removeTree(MARKER_REF);
    }
    catch (error) {
        if (error instanceof RootedDirectoryError ||
            error instanceof RootedDirectoryTreeRemovalError ||
            error instanceof ExactRegularFileUnlinkError) {
            return;
        }
        throw error;
    }
}
