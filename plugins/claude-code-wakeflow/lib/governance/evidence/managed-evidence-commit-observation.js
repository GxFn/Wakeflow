import { GitCommitObservationError, observeGitCommit, observeGitCommitKind, } from "../../foundation/git/git-commit-observation.js";
import { openConfiguredRepositoryRoot } from "./managed-evidence-configured-source-root.js";
import { MANAGED_EVIDENCE_COMMIT_CHANGED_PATHS_MAXIMUM, } from "./managed-evidence-source-selection.js";
async function inRepository(config, source, observe) {
    const root = await openConfiguredRepositoryRoot(config, source.repositoryId);
    try {
        return await observe(root);
    }
    catch (error) {
        if (!(error instanceof GitCommitObservationError) || error.reason === "aborted")
            throw error;
        return null;
    }
    finally {
        try {
            await root.close();
        }
        catch {
            // 观察结果或它的错误优先；这个根只被读过。
        }
    }
}
function signalOption(signal) {
    return signal === undefined ? {} : { signal };
}
/** 完整观察：树、父提交、改动路径、补丁摘要。 */
export function observeConfiguredRepositoryCommit(config, source, signal) {
    return inRepository(config, source, (root) => observeGitCommit(root, source.commitOid, signalOption(signal)));
}
/** 只问它是不是仓库里的提交。 */
export function observeConfiguredRepositoryCommitKind(config, source, signal) {
    return inRepository(config, source, (root) => observeGitCommitKind(root, source.commitOid, signalOption(signal)));
}
/** 观察到的事实进清单时的形状：改动路径只保留到清单的条数上限，总数不变。 */
export function managedEvidenceCommitObservationOf(observed) {
    const changedPaths = observed.changedPaths.slice(0, MANAGED_EVIDENCE_COMMIT_CHANGED_PATHS_MAXIMUM);
    return Object.freeze({
        treeOid: observed.treeOid,
        parents: observed.parents,
        changedPathCount: observed.changedPathCount,
        changedPathsTruncated: observed.changedPathCount > changedPaths.length,
        changedPaths: Object.freeze(changedPaths),
        patch: Object.freeze({ digest: observed.patch.digest, bytes: observed.patch.bytes }),
    });
}
