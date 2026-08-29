import {
  createFileAtomically,
  replaceFileAtomically,
  DurableAtomicFileWriteError,
} from "../../foundation/filesystem/durable-atomic-file-write.js";
import {
  sameFileNodeSnapshot,
} from "../../foundation/filesystem/file-node-snapshot.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import {
  withRootedExclusiveFileLock,
  RootedExclusiveFileLockError,
} from "../../foundation/filesystem/rooted-exclusive-file-lock.js";
import type {
  StableFileSource,
} from "../../foundation/filesystem/stable-file-read.js";
import {
  inspectWakeflowProgramInstruction,
  WakeflowProgramInstructionInspectionError,
  WAKEFLOW_PROGRAM_INSTRUCTION_FILE_MODE,
  type WakeflowProgramInstructionInspection,
} from "./wakeflow-program-instruction-inspection.js";
import {
  admitWakeflowProgramInstructionLockOperations,
  assertCurrentUserWakeflowProgramInstructionRoot,
  assertWakeflowProgramInstructionRecompositionNotAborted,
  assertWakeflowProgramInstructionRecompositionRoot,
  currentWakeflowProgramInstructionRecompositionUserId,
  failWakeflowProgramInstructionRecomposition as fail,
  mapWakeflowProgramInstructionLockError,
  parseWakeflowProgramInstructionRecompositionOptions,
  parseWakeflowProgramInstructionRecompositionRequest,
  wakeflowProgramInstructionInspectionRequest,
  wakeflowProgramInstructionLockOptions,
  wakeflowProgramInstructionLockRef,
  wakeflowProgramInstructionTargetRef,
  WakeflowProgramInstructionRecompositionError,
  type ParsedWakeflowProgramInstructionRecompositionOptions,
  type WakeflowProgramInstructionRecompositionEffect,
  type WakeflowProgramInstructionRecompositionOptions,
  type WakeflowProgramInstructionRecompositionReceipt,
  type WakeflowProgramInstructionRecompositionRequest,
} from "./wakeflow-program-instruction-recomposition-contract.js";

/**
 * Wakeflow Workspace / Managed Integration：Program Instruction 的锁内 CAS owner。
 *
 * 本模块在宿主专属短锁内重新执行完整只读 inspection。候选只能由已绑定摘要的
 * current/desired Config、当前 Host Profile 和 Managed Text authority transition
 * 生成；目标不存在时原子创建，目标存在时以完整 StableFileSource 执行 CAS 替换。
 *
 * 提交后重新读取并重推导 desired authority。只有节点、摘要、权限、envelope、Config
 * 摘要和 Matrix 摘要全部闭合才返回成功；锁残留与不确定提交由显式恢复 owner 处理。
 */

async function inspectCurrent(
  root: RootedDirectory,
  request: ReturnType<
    typeof parseWakeflowProgramInstructionRecompositionRequest
  >,
  signal: AbortSignal | undefined,
  afterCommit: boolean,
): Promise<Readonly<WakeflowProgramInstructionInspection>> {
  try {
    return await inspectWakeflowProgramInstruction(
      root,
      wakeflowProgramInstructionInspectionRequest(request, signal),
    );
  } catch (error: unknown) {
    if (afterCommit) fail("commit-uncertain", "$resourcePath");
    if (error instanceof WakeflowProgramInstructionInspectionError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "unsupported-platform") {
        fail("unsupported-platform", "$root");
      }
      if (error.reason === "target-capacity") fail("capacity", "$target");
      if (
        error.reason === "input"
        || error.reason === "context"
        || error.reason === "authority"
      ) {
        fail("input", error.path);
      }
      fail("source-invalid", "$source");
    }
    fail("source-invalid", "$source");
  }
}

function mapAtomicError(error: DurableAtomicFileWriteError): never {
  if (error.reason === "input") fail("input", error.path);
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (error.reason === "capacity") fail("capacity", "$target");
  if (
    error.reason === "target-exists"
    || error.reason === "expectation-changed"
    || error.reason === "expectation-read-failure"
  ) {
    fail("conflict", "$source");
  }
  if (error.reason === "root-scope" || error.reason === "parent-changed") {
    fail("root-scope", "$root");
  }
  if (error.reason === "stage-recovery-required") {
    fail("recovery-required", "$resourcePath");
  }
  if (
    error.reason === "commit-uncertain"
    || error.reason === "durability-failure"
    || error.reason === "stage-cleanup-failure"
    || error.reason === "close-failure"
  ) {
    fail("commit-uncertain", "$resourcePath");
  }
  fail("effect-failure", "$resourcePath");
}

async function publishTarget(
  root: RootedDirectory,
  request: ReturnType<
    typeof parseWakeflowProgramInstructionRecompositionRequest
  >,
  inspection: Readonly<WakeflowProgramInstructionInspection>,
  signal: AbortSignal | undefined,
): Promise<Readonly<WakeflowProgramInstructionRecompositionEffect>> {
  const target = inspection.transition.target;
  if (inspection.status !== "recompose-required" || target === null) {
    fail("source-invalid", "$target");
  }
  const resourcePath = wakeflowProgramInstructionTargetRef(request);
  try {
    if (inspection.source === null) {
      return await createFileAtomically(root, resourcePath, target.bytes, {
        mode: WAKEFLOW_PROGRAM_INSTRUCTION_FILE_MODE,
        ...(signal === undefined ? {} : { signal }),
      });
    }
    return await replaceFileAtomically(root, resourcePath, target.bytes, {
      mode: WAKEFLOW_PROGRAM_INSTRUCTION_FILE_MODE,
      expected: inspection.source,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof DurableAtomicFileWriteError) mapAtomicError(error);
    fail("effect-failure", "$resourcePath");
  }
}

function sameSource(
  left: Readonly<StableFileSource>,
  right: Readonly<StableFileSource>,
): boolean {
  return left.resourcePath === right.resourcePath
    && left.byteCount === right.byteCount
    && left.digest === right.digest
    && sameFileNodeSnapshot(left.node, right.node);
}

function assertReadback(
  request: ReturnType<
    typeof parseWakeflowProgramInstructionRecompositionRequest
  >,
  before: Readonly<WakeflowProgramInstructionInspection>,
  effect: Readonly<WakeflowProgramInstructionRecompositionEffect>,
  after: Readonly<WakeflowProgramInstructionInspection>,
  expectedUserId: bigint,
): void {
  const target = before.transition.target;
  const source = after.source;
  if (
    before.status !== "recompose-required"
    || target === null
    || source === null
    || after.status !== "managed-current"
    || after.transition.sourceAuthority !== "desired"
    || after.transition.target !== null
    || after.context.matrixDigest !== before.context.matrixDigest
    || after.currentConfigDigest !== before.currentConfigDigest
    || after.desiredConfigDigest !== before.desiredConfigDigest
    || after.desiredAuthority.authorityDigest
      !== before.desiredAuthority.authorityDigest
    || after.desiredAuthority.bodyDigest !== before.desiredAuthority.bodyDigest
    || effect.resourcePath !== wakeflowProgramInstructionTargetRef(request)
    || effect.digest !== target.digest
    || effect.byteCount !== target.byteCount
    || effect.node.kind !== "file"
    || effect.node.permissionBits !== WAKEFLOW_PROGRAM_INSTRUCTION_FILE_MODE
    || effect.node.linkCount !== 1n
    || effect.node.userId !== expectedUserId
    || source.resourcePath !== effect.resourcePath
    || source.digest !== effect.digest
    || source.byteCount !== effect.byteCount
    || !sameFileNodeSnapshot(source.node, effect.node)
  ) {
    fail("commit-uncertain", "$resourcePath");
  }
  if (effect.publication === "created") {
    if (before.source !== null) fail("commit-uncertain", "$resourcePath");
  } else if (
    before.source === null
    || !sameSource(effect.previous, before.source)
  ) {
    fail("commit-uncertain", "$resourcePath");
  }
}

async function recomposeUnderLock(
  root: RootedDirectory,
  request: ReturnType<
    typeof parseWakeflowProgramInstructionRecompositionRequest
  >,
  options: Readonly<ParsedWakeflowProgramInstructionRecompositionOptions>,
  expectedUserId: bigint,
  markCommitted: () => void,
): Promise<Readonly<WakeflowProgramInstructionRecompositionReceipt>> {
  assertWakeflowProgramInstructionRecompositionNotAborted(options.signal);
  await assertCurrentUserWakeflowProgramInstructionRoot(root, expectedUserId);
  const before = await inspectCurrent(root, request, options.signal, false);
  if (before.status !== "recompose-required") {
    return Object.freeze({
      disposition: "current",
      effect: null,
      inspection: before,
    });
  }
  await assertCurrentUserWakeflowProgramInstructionRoot(root, expectedUserId);
  assertWakeflowProgramInstructionRecompositionNotAborted(options.signal);
  const effect = await publishTarget(root, request, before, options.signal);
  markCommitted();
  const after = await inspectCurrent(root, request, options.signal, true);
  assertReadback(request, before, effect, after, expectedUserId);
  return Object.freeze({
    disposition: effect.publication,
    effect,
    inspection: after,
  });
}

/**
 * 在宿主专属短锁内重推导并幂等创建或 CAS 替换 Program Instruction managed block。
 */
export async function recomposeWakeflowProgramInstruction(
  rootValue: RootedDirectory,
  requestValue: WakeflowProgramInstructionRecompositionRequest,
  optionsValue?: WakeflowProgramInstructionRecompositionOptions,
): Promise<Readonly<WakeflowProgramInstructionRecompositionReceipt>> {
  assertWakeflowProgramInstructionRecompositionRoot(rootValue);
  const request = parseWakeflowProgramInstructionRecompositionRequest(
    requestValue,
  );
  const options = parseWakeflowProgramInstructionRecompositionOptions(
    optionsValue,
  );
  assertWakeflowProgramInstructionRecompositionNotAborted(options.signal);
  admitWakeflowProgramInstructionLockOperations(request);
  const expectedUserId =
    currentWakeflowProgramInstructionRecompositionUserId();
  await assertCurrentUserWakeflowProgramInstructionRoot(
    rootValue,
    expectedUserId,
  );

  let committed = false;
  try {
    return await withRootedExclusiveFileLock(
      rootValue,
      wakeflowProgramInstructionLockRef(request),
      () => recomposeUnderLock(
        rootValue,
        request,
        options,
        expectedUserId,
        () => { committed = true; },
      ),
      wakeflowProgramInstructionLockOptions(options),
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowProgramInstructionRecompositionError) {
      throw error;
    }
    if (error instanceof RootedExclusiveFileLockError) {
      mapWakeflowProgramInstructionLockError(error, committed);
    }
    fail(
      committed ? "commit-uncertain" : "effect-failure",
      "$resourcePath",
    );
  }
}

export {
  WakeflowProgramInstructionRecompositionError,
  WAKEFLOW_PROGRAM_INSTRUCTION_RECOMPOSITION_LOCK_TIMEOUT_MILLISECONDS,
  type WakeflowProgramInstructionRecompositionEffect,
  type WakeflowProgramInstructionRecompositionErrorReason,
  type WakeflowProgramInstructionRecompositionOptions,
  type WakeflowProgramInstructionRecompositionReceipt,
  type WakeflowProgramInstructionRecompositionRequest,
} from "./wakeflow-program-instruction-recomposition-contract.js";
