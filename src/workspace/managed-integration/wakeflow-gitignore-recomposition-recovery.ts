import {
  recoverDurableAtomicFileStagesForTargets,
  DurableAtomicFileStageRecoveryError,
  type DurableAtomicFileStageRecoveryReceipt,
} from "../../foundation/filesystem/durable-atomic-file-stage-recovery.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import {
  inspectRootedExclusiveFileLock,
  retireRootedExclusiveFileLockResidue,
  RootedExclusiveFileLockError,
} from "../../foundation/filesystem/rooted-exclusive-file-lock.js";
import {
  inspectWakeflowWorkspaceGitignore,
  WakeflowGitignoreInspectionError,
} from "./wakeflow-gitignore-inspection.js";
import {
  admitWakeflowGitignoreRecompositionLockOperations,
  assertCurrentUserWakeflowGitignoreRecompositionRoot,
  assertWakeflowGitignoreRecompositionNotAborted,
  assertWakeflowGitignoreRecompositionRoot,
  currentWakeflowGitignoreRecompositionUserId,
  failWakeflowGitignoreRecomposition as fail,
  mapWakeflowGitignoreRecompositionLockError,
  parseWakeflowGitignoreRecompositionRecoveryOptions,
  parseWakeflowGitignoreRecompositionRequest,
  wakeflowGitignoreInspectionRequest,
  type WakeflowGitignoreRecompositionRecoveryOptions,
  type WakeflowGitignoreRecompositionRecoveryReceipt,
  type WakeflowGitignoreRecompositionRequest,
} from "./wakeflow-gitignore-recomposition-contract.js";
import {
  recomposeWakeflowWorkspaceGitignore,
} from "./wakeflow-gitignore-recomposition.js";
import {
  WAKEFLOW_GITIGNORE_RECOMPOSITION_LOCK_REF,
  WAKEFLOW_GITIGNORE_REF,
} from "./wakeflow-managed-integration-resource-catalog.js";

/**
 * Wakeflow Workspace / Managed Integration：Gitignore 非活动锁残留的显式恢复。
 *
 * 恢复先证明锁持有者已经不活动，再把 Foundation stage 恢复范围关闭到 `.gitignore`
 * 与该锁两个同级目标。任何其他目标、非法保留名称、不安全节点、活动或未知 stage 都会
 * 保留现场并拒绝恢复。允许的单链接 stage 只是非权威候选，可精确退休；双链接 create
 * stage 必须先由 Foundation 证明目标为同一 inode、摘要与权限位，完成耐久性结算后才
 * 退休 stage 名称。
 *
 * stage 闭合后，本模块重新执行只读 inspection。只有当前目标能够安全保持或重组时，
 * 才退休精确旧锁并重新进入正常 recomposition；它不会根据时间戳猜测锁失效，也不会
 * 在旧锁保护下直接继续提交。
 */

async function recoverAdmittedStages(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<Readonly<DurableAtomicFileStageRecoveryReceipt>> {
  try {
    const receipt = await recoverDurableAtomicFileStagesForTargets(
      root,
      Object.freeze([
        WAKEFLOW_GITIGNORE_REF,
        WAKEFLOW_GITIGNORE_RECOMPOSITION_LOCK_REF,
      ]),
      signal === undefined ? undefined : { signal },
    );
    if (
      receipt.activeStageCount !== 0
      || receipt.unknownStageCount !== 0
    ) {
      fail("recovery-required", "$stages");
    }
    return receipt;
  } catch (error: unknown) {
    if (error instanceof DurableAtomicFileStageRecoveryError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "root-scope") fail("root-scope", "$root");
      fail("recovery-required", "$stages");
    }
    throw error;
  }
}

async function assertRecoverableCurrent(
  root: RootedDirectory,
  request: ReturnType<typeof parseWakeflowGitignoreRecompositionRequest>,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    await inspectWakeflowWorkspaceGitignore(
      root,
      wakeflowGitignoreInspectionRequest(request, signal),
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowGitignoreInspectionError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "target-capacity") fail("capacity", "$target");
      if (error.reason === "git") fail("observation-failure", "$git");
      if (
        error.reason === "input"
        || error.reason === "context"
        || error.reason === "authority"
      ) {
        fail("input", error.path);
      }
      fail("recovery-required", "$source");
    }
    fail("recovery-required", "$source");
  }
}

/**
 * 退休可证明安全的 Gitignore 锁与 stage 残留，然后重新执行正常锁内重组。
 */
export async function recoverWakeflowWorkspaceGitignoreRecomposition(
  rootValue: RootedDirectory,
  requestValue: WakeflowGitignoreRecompositionRequest,
  optionsValue?: WakeflowGitignoreRecompositionRecoveryOptions,
): Promise<Readonly<WakeflowGitignoreRecompositionRecoveryReceipt>> {
  assertWakeflowGitignoreRecompositionRoot(rootValue);
  const request = parseWakeflowGitignoreRecompositionRequest(requestValue);
  const options = parseWakeflowGitignoreRecompositionRecoveryOptions(
    optionsValue,
  );
  assertWakeflowGitignoreRecompositionNotAborted(options.signal);
  admitWakeflowGitignoreRecompositionLockOperations(request);
  const expectedUserId = currentWakeflowGitignoreRecompositionUserId();
  await assertCurrentUserWakeflowGitignoreRecompositionRoot(
    rootValue,
    expectedUserId,
  );

  let observation;
  try {
    observation = await inspectRootedExclusiveFileLock(
      rootValue,
      WAKEFLOW_GITIGNORE_RECOMPOSITION_LOCK_REF,
    );
  } catch (error: unknown) {
    if (error instanceof RootedExclusiveFileLockError) {
      mapWakeflowGitignoreRecompositionLockError(error, false);
    }
    fail("recovery-required", "$lock");
  }
  if (observation.status === "absent") {
    fail("recovery-not-required", "$lock");
  }
  if (observation.ownerState !== "inactive") {
    fail("recovery-required", "$lock");
  }

  const stageRecovery = await recoverAdmittedStages(rootValue, options.signal);
  assertWakeflowGitignoreRecompositionNotAborted(options.signal);
  await assertCurrentUserWakeflowGitignoreRecompositionRoot(
    rootValue,
    expectedUserId,
  );
  await assertRecoverableCurrent(rootValue, request, options.signal);
  assertWakeflowGitignoreRecompositionNotAborted(options.signal);

  try {
    await retireRootedExclusiveFileLockResidue(
      rootValue,
      WAKEFLOW_GITIGNORE_RECOMPOSITION_LOCK_REF,
      observation,
      { relatedTargetResourcePaths: [WAKEFLOW_GITIGNORE_REF] },
    );
  } catch (error: unknown) {
    if (error instanceof RootedExclusiveFileLockError) {
      mapWakeflowGitignoreRecompositionLockError(error, false);
    }
    fail("recovery-required", "$lock");
  }

  const recomposition = await recomposeWakeflowWorkspaceGitignore(
    rootValue,
    {
      matrix: request.matrix,
      expectedMatrixDigest: request.expectedMatrixDigest,
      hostProfiles: request.hostProfiles,
    },
    options.signal === undefined ? undefined : { signal: options.signal },
  );
  return Object.freeze({
    disposition: "recovered",
    retiredLockDigest: observation.digest,
    stageRecovery,
    recomposition,
  });
}

export type {
  WakeflowGitignoreRecompositionRecoveryOptions,
  WakeflowGitignoreRecompositionRecoveryReceipt,
} from "./wakeflow-gitignore-recomposition-contract.js";
