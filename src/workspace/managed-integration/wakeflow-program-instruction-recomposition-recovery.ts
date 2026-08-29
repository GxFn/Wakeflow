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
  inspectWakeflowProgramInstruction,
  WakeflowProgramInstructionInspectionError,
} from "./wakeflow-program-instruction-inspection.js";
import {
  admitWakeflowProgramInstructionLockOperations,
  assertCurrentUserWakeflowProgramInstructionRoot,
  assertWakeflowProgramInstructionRecompositionNotAborted,
  assertWakeflowProgramInstructionRecompositionRoot,
  currentWakeflowProgramInstructionRecompositionUserId,
  failWakeflowProgramInstructionRecomposition as fail,
  mapWakeflowProgramInstructionLockError,
  parseWakeflowProgramInstructionRecompositionRecoveryOptions,
  parseWakeflowProgramInstructionRecompositionRequest,
  wakeflowProgramInstructionInspectionRequest,
  wakeflowProgramInstructionLockRef,
  wakeflowProgramInstructionTargetRef,
  type WakeflowProgramInstructionRecompositionRecoveryOptions,
  type WakeflowProgramInstructionRecompositionRecoveryReceipt,
  type WakeflowProgramInstructionRecompositionRequest,
} from "./wakeflow-program-instruction-recomposition-contract.js";
import {
  recomposeWakeflowProgramInstruction,
} from "./wakeflow-program-instruction-recomposition.js";

/**
 * Wakeflow Workspace / Managed Integration：Program Instruction 非活动锁残留恢复。
 *
 * 恢复只接受可证明不活动的精确宿主锁，并把 Foundation stage 范围关闭到该宿主的
 * instruction target 与专属 lock。stage 结算后重新执行 current/desired inspection；
 * 只有正文仍可安全保持或重组时才退休旧锁，再重新进入正常锁内 owner。
 *
 * 本模块不按时间戳猜测失效，不覆盖未知 managed body，也不在旧锁保护下继续提交。
 */

async function recoverAdmittedStages(
  root: RootedDirectory,
  request: ReturnType<
    typeof parseWakeflowProgramInstructionRecompositionRequest
  >,
  signal: AbortSignal | undefined,
): Promise<Readonly<DurableAtomicFileStageRecoveryReceipt>> {
  try {
    const receipt = await recoverDurableAtomicFileStagesForTargets(
      root,
      Object.freeze([
        wakeflowProgramInstructionTargetRef(request),
        wakeflowProgramInstructionLockRef(request),
      ]),
      signal === undefined ? undefined : { signal },
    );
    if (receipt.activeStageCount !== 0 || receipt.unknownStageCount !== 0) {
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
  request: ReturnType<
    typeof parseWakeflowProgramInstructionRecompositionRequest
  >,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    await inspectWakeflowProgramInstruction(
      root,
      wakeflowProgramInstructionInspectionRequest(request, signal),
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowProgramInstructionInspectionError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "unsupported-platform") {
        fail("unsupported-platform", "$root");
      }
      if (error.reason === "target-capacity") fail("capacity", "$target");
      if (error.reason === "source-capacity") fail("capacity", "$source");
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

/** 退休安全锁与 stage 残留，然后重新执行正常 Program Instruction 重组。 */
export async function recoverWakeflowProgramInstructionRecomposition(
  rootValue: RootedDirectory,
  requestValue: WakeflowProgramInstructionRecompositionRequest,
  optionsValue?: WakeflowProgramInstructionRecompositionRecoveryOptions,
): Promise<Readonly<WakeflowProgramInstructionRecompositionRecoveryReceipt>> {
  assertWakeflowProgramInstructionRecompositionRoot(rootValue);
  const options =
    parseWakeflowProgramInstructionRecompositionRecoveryOptions(optionsValue);
  assertWakeflowProgramInstructionRecompositionNotAborted(options.signal);
  const request = parseWakeflowProgramInstructionRecompositionRequest(
    requestValue,
  );
  admitWakeflowProgramInstructionLockOperations(request);
  const expectedUserId =
    currentWakeflowProgramInstructionRecompositionUserId();
  await assertCurrentUserWakeflowProgramInstructionRoot(
    rootValue,
    expectedUserId,
  );
  const lockRef = wakeflowProgramInstructionLockRef(request);
  const targetRef = wakeflowProgramInstructionTargetRef(request);

  let observation;
  try {
    observation = await inspectRootedExclusiveFileLock(rootValue, lockRef);
  } catch (error: unknown) {
    if (error instanceof RootedExclusiveFileLockError) {
      mapWakeflowProgramInstructionLockError(error, false);
    }
    fail("recovery-required", "$lock");
  }
  if (observation.status === "absent") {
    fail("recovery-not-required", "$lock");
  }
  if (observation.ownerState !== "inactive") {
    fail("recovery-required", "$lock");
  }

  const stageRecovery = await recoverAdmittedStages(
    rootValue,
    request,
    options.signal,
  );
  assertWakeflowProgramInstructionRecompositionNotAborted(options.signal);
  await assertCurrentUserWakeflowProgramInstructionRoot(
    rootValue,
    expectedUserId,
  );
  await assertRecoverableCurrent(rootValue, request, options.signal);
  assertWakeflowProgramInstructionRecompositionNotAborted(options.signal);

  try {
    await retireRootedExclusiveFileLockResidue(
      rootValue,
      lockRef,
      observation,
      { relatedTargetResourcePaths: [targetRef] },
    );
  } catch (error: unknown) {
    if (error instanceof RootedExclusiveFileLockError) {
      mapWakeflowProgramInstructionLockError(error, false);
    }
    fail("recovery-required", "$lock");
  }

  const recomposition = await recomposeWakeflowProgramInstruction(
    rootValue,
    {
      matrix: request.matrix,
      expectedMatrixDigest: request.expectedMatrixDigest,
      profile: request.profile,
      currentConfig: request.currentConfig,
      expectedCurrentConfigDigest: request.currentConfigDigest,
      desiredConfig: request.desiredConfig,
      expectedDesiredConfigDigest: request.desiredConfigDigest,
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
  WakeflowProgramInstructionRecompositionRecoveryOptions,
  WakeflowProgramInstructionRecompositionRecoveryReceipt,
} from "./wakeflow-program-instruction-recomposition-contract.js";
