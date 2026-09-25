import { RootedDirectory, RootedDirectoryError, } from "../../foundation/filesystem/rooted-directory.js";
import { WakeflowError } from "../../kernel/error.js";
import { listPodWorktreeReceiptsAnyHost } from "../../kernel/pod-worktree-receipts.js";
const ERROR_MESSAGES = {
    placement: "Managed evidence source root has no current Config placement.",
    "root-scope": "Managed evidence source root differs from its Config placement.",
};
/** 逻辑source root无法闭合到当前Config物理根时的稳定错误。 */
export class ManagedEvidenceConfiguredSourceRootError extends Error {
    name = "ManagedEvidenceConfiguredSourceRootError";
    code = "wakeflow-managed-evidence-configured-source-root";
    reason;
    constructor(reason) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
    }
}
function fail(reason) {
    throw new ManagedEvidenceConfiguredSourceRootError(reason);
}
function selectedRootKey(root) {
    return root.kind === "repository"
        ? `repository.${root.repositoryId}.root`
        : `support.${root.surfaceId}.root`;
}
function sourcePlacement(config, root) {
    const entityExists = root.kind === "repository"
        ? config.indexes.repositoryById[root.repositoryId] !== undefined
        : config.indexes.surfaceById[root.surfaceId] !== undefined;
    if (!entityExists)
        fail("placement");
    const placement = config.placements.roots.find((entry) => entry.key === selectedRootKey(root));
    if (placement === undefined ||
        placement.state !== "present" ||
        placement.realPath === null) {
        fail("placement");
    }
    return placement;
}
/** 回执读取失败归为placement；取消以内核 aborted 错误原样浮出，由调用方映射。 */
async function listReceipts(workspaceRoot, podId, signal) {
    try {
        return await listPodWorktreeReceiptsAnyHost(workspaceRoot, podId, signal === undefined ? {} : { signal });
    }
    catch (error) {
        if (error instanceof WakeflowError && error.reason === "aborted")
            throw error;
        if (signal?.aborted === true)
            throw error;
        fail("placement");
    }
}
/** worktree 检出：pod 与仓库都在配置里，回执存在，且打开后的根等于回执路径。 */
async function openPodWorktreeRoot(workspaceRoot, config, root, signal) {
    const pod = config.indexes.podById[root.podId];
    if (pod === undefined || !pod.worktrees.some((entry) => entry.repositoryId === root.repositoryId)) {
        fail("placement");
    }
    const receipt = (await listReceipts(workspaceRoot, root.podId, signal)).find((entry) => entry.repositoryId === root.repositoryId);
    if (receipt === undefined)
        fail("placement");
    let opened;
    try {
        opened = await RootedDirectory.open(receipt.path, "$sourceRoot");
        if (opened.absolutePath !== receipt.path)
            fail("root-scope");
        return opened;
    }
    catch (error) {
        if (opened !== undefined) {
            try {
                await opened.close();
            }
            catch {
                // 首个根关系错误优先。
            }
        }
        if (error instanceof ManagedEvidenceConfiguredSourceRootError)
            throw error;
        if (error instanceof RootedDirectoryError)
            fail("root-scope");
        throw error;
    }
}
/** 打开并持有Manifest逻辑source对应的当前Config物理根。 */
export async function openConfiguredManagedEvidenceSourceRoot(workspaceRoot, config, source, options = {}) {
    if (source.root.kind === "pod-worktree") {
        return openPodWorktreeRoot(workspaceRoot, config, source.root, options.signal);
    }
    const placement = sourcePlacement(config, source.root);
    let root;
    try {
        root = await RootedDirectory.open(placement.absolutePath, "$sourceRoot");
        if (root.absolutePath !== placement.realPath)
            fail("root-scope");
        return root;
    }
    catch (error) {
        if (root !== undefined) {
            try {
                await root.close();
            }
            catch {
                // 首个placement或根关系错误优先。
            }
        }
        if (error instanceof ManagedEvidenceConfiguredSourceRootError)
            throw error;
        if (error instanceof RootedDirectoryError)
            fail("root-scope");
        throw error;
    }
}
