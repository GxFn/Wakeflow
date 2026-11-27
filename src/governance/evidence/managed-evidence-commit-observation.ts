import type { WakeflowConfigAuthoritySnapshot } from "../../configuration/wakeflow-config-authority-snapshot.js";
import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import {
  type GitCommitObservation,
  GitCommitObservationError,
  observeGitCommit,
  observeGitCommitKind,
} from "../../foundation/git/git-commit-observation.js";
import { openConfiguredRepositoryRoot } from "./managed-evidence-configured-source-root.js";
import {
  MANAGED_EVIDENCE_COMMIT_CHANGED_PATHS_MAXIMUM,
  type ManagedEvidenceCommitObservation,
  type ManagedEvidenceCommitSelection,
} from "./managed-evidence-source-selection.js";

/**
 * Wakeflow Governance / Evidence：在一个已配置仓库的主检出里只读地观察提交（ADR-0028）。
 *
 * 同一仓库的 worktree 检出共用主检出的对象库，所以 pod 里做出的提交也在这里读得到。拿不到结论——Git
 * 不可用、超时、那个目录不是仓库——返回 null，调用方照"未观察"处理，不把它当成失败；只有取消原样抛出。
 * 仓库不在配置里、或它的根不在配置记录的位置上，抛出配置根的错误，由调用方决定怎么报。
 */

type RepositoryRef = Pick<ManagedEvidenceCommitSelection, "repositoryId" | "commitOid">;

async function inRepository<Result>(
  config: Readonly<WakeflowConfigAuthoritySnapshot>,
  source: Readonly<RepositoryRef>,
  observe: (root: RootedDirectory) => Promise<Result>,
): Promise<Result | null> {
  const root = await openConfiguredRepositoryRoot(config, source.repositoryId);
  try {
    return await observe(root);
  } catch (error: unknown) {
    if (!(error instanceof GitCommitObservationError)) throw error;
    return null;
  } finally {
    try {
      await root.close();
    } catch {
      // 观察结果或它的错误优先；这个根只被读过。
    }
  }
}

function signalOption(signal: AbortSignal | undefined): { readonly signal?: AbortSignal } {
  return signal === undefined ? {} : { signal };
}

/** 完整观察：树、父提交、改动路径、补丁摘要。 */
export function observeConfiguredRepositoryCommit(
  config: Readonly<WakeflowConfigAuthoritySnapshot>,
  source: Readonly<RepositoryRef>,
  signal: AbortSignal | undefined,
): Promise<GitCommitObservation | null> {
  return inRepository(config, source, (root) =>
    observeGitCommit(root, source.commitOid, signalOption(signal)),
  );
}

/** 只问它是不是仓库里的提交。 */
export function observeConfiguredRepositoryCommitKind(
  config: Readonly<WakeflowConfigAuthoritySnapshot>,
  source: Readonly<RepositoryRef>,
  signal: AbortSignal | undefined,
): Promise<GitCommitObservation["status"] | null> {
  return inRepository(config, source, (root) =>
    observeGitCommitKind(root, source.commitOid, signalOption(signal)),
  );
}

/** 观察到的事实进清单时的形状：改动路径只保留到清单的条数上限，总数不变。 */
export function managedEvidenceCommitObservationOf(
  observed: Extract<GitCommitObservation, { readonly status: "observed" }>,
): Readonly<ManagedEvidenceCommitObservation> {
  const changedPaths = observed.changedPaths.slice(
    0,
    MANAGED_EVIDENCE_COMMIT_CHANGED_PATHS_MAXIMUM,
  );
  return Object.freeze({
    treeOid: observed.treeOid,
    parents: observed.parents,
    changedPathCount: observed.changedPathCount,
    changedPathsTruncated: observed.changedPathCount > changedPaths.length,
    changedPaths: Object.freeze(changedPaths),
    patch: Object.freeze({ digest: observed.patch.digest, bytes: observed.patch.bytes }),
  });
}
