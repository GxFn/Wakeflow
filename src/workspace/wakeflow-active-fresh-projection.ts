import {
  computeWakeflowConfigV3Digest,
  type WakeflowConfigV3Model,
} from "../configuration/wakeflow-config-v3.js";
import type { Sha256Digest } from "../foundation/crypto/sha256.js";
import {
  computeActiveProjectionSetDigest,
  freshActiveProjectionFacts,
  renderActiveProjectionFiles,
  type ActiveProjectionFile,
} from "../kernel/active-projection.js";

/**
 * Wakeflow Workspace / Active：Fresh 初始化写入的两份工作区投影。
 *
 * 事实只来自 desired Config：程序、语言、配置摘要与配置里的 pod；没有 Demand，看板为空。
 * 之后的每次 Demand 或 pod 变更由治理层的投影刷新按观察重算并 CAS 重写。
 */

export interface WakeflowFreshActiveProjection {
  readonly files: readonly Readonly<ActiveProjectionFile>[];
  readonly authorityDigest: Sha256Digest;
}

/** 从 desired Config 渲染 fresh 工作区的投影文件集与其确定性摘要。 */
export function renderWakeflowFreshActiveProjection(
  model: WakeflowConfigV3Model,
): Readonly<WakeflowFreshActiveProjection> {
  const repositoryNames = new Map<string, string>();
  for (const repository of model.topology.repositories) {
    repositoryNames.set(repository.repositoryId, repository.displayName);
  }
  const files = renderActiveProjectionFiles(
    freshActiveProjectionFacts({
      language: model.presentation.language,
      program: {
        programId: model.program.programId,
        displayName: model.program.displayName,
      },
      configDigest: computeWakeflowConfigV3Digest(model),
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
    }),
  );
  return Object.freeze({ files, authorityDigest: computeActiveProjectionSetDigest(files) });
}
