import { computeWakeflowConfigDigest, } from "../configuration/wakeflow-config.js";
import { computeActiveProjectionSetDigest, freshActiveProjectionFacts, renderActiveProjectionFiles, } from "../kernel/active-projection.js";
/** 从 desired Config 渲染 fresh 工作区的投影文件集与其确定性摘要。 */
export function renderWakeflowFreshActiveProjection(model) {
    const repositoryNames = new Map();
    for (const repository of model.topology.repositories) {
        repositoryNames.set(repository.repositoryId, repository.displayName);
    }
    const files = renderActiveProjectionFiles(freshActiveProjectionFacts({
        language: model.presentation.language,
        program: {
            programId: model.program.programId,
            displayName: model.program.displayName,
        },
        configDigest: computeWakeflowConfigDigest(model),
        pods: model.pods.map((pod) => ({
            podId: pod.podId,
            name: pod.name,
            placement: pod.placement,
            lifecycle: pod.lifecycle,
            worktrees: pod.worktrees.map((worktree) => ({
                repositoryId: worktree.repositoryId,
                repositoryName: repositoryNames.get(worktree.repositoryId) ?? worktree.repositoryId,
            })),
        })),
    }));
    return Object.freeze({ files, authorityDigest: computeActiveProjectionSetDigest(files) });
}
