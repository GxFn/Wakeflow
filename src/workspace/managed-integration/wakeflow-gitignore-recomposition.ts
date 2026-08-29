import {
  createFileAtomically,
  replaceFileAtomically,
  DurableAtomicFileWriteError,
} from "../../foundation/filesystem/durable-atomic-file-write.js";
import { sameFileNodeSnapshot } from "../../foundation/filesystem/file-node-snapshot.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import {
  withRootedExclusiveFileLock,
  RootedExclusiveFileLockError,
} from "../../foundation/filesystem/rooted-exclusive-file-lock.js";
import type { StableFileSource } from "../../foundation/filesystem/stable-file-read.js";
import {
  inspectWakeflowWorkspaceGitignore,
  WakeflowGitignoreInspectionError,
  type WakeflowGitignoreInspection,
} from "./wakeflow-gitignore-inspection.js";
import {
  admitWakeflowGitignoreRecompositionLockOperations,
  assertCurrentUserWakeflowGitignoreRecompositionRoot,
  assertWakeflowGitignoreRecompositionNotAborted,
  assertWakeflowGitignoreRecompositionRoot,
  currentWakeflowGitignoreRecompositionUserId,
  failWakeflowGitignoreRecomposition as fail,
  mapWakeflowGitignoreRecompositionLockError,
  parseWakeflowGitignoreRecompositionOptions,
  parseWakeflowGitignoreRecompositionRequest,
  wakeflowGitignoreInspectionRequest,
  wakeflowGitignoreRecompositionLockOptions,
  WakeflowGitignoreRecompositionError,
  WAKEFLOW_GITIGNORE_FILE_MODE,
  type ParsedWakeflowGitignoreRecompositionOptions,
  type ParsedWakeflowGitignoreRecompositionRequest,
  type WakeflowGitignoreRecompositionEffect,
  type WakeflowGitignoreRecompositionOptions,
  type WakeflowGitignoreRecompositionReceipt,
  type WakeflowGitignoreRecompositionRequest,
} from "./wakeflow-gitignore-recomposition-contract.js";
import {
  WAKEFLOW_GITIGNORE_RECOMPOSITION_LOCK_REF,
  WAKEFLOW_GITIGNORE_REF,
} from "./wakeflow-managed-integration-resource-catalog.js";

/**
 * Wakeflow Workspace / Managed Integration：根 `.gitignore` 的锁内精确重组 owner。
 *
 * 本模块取得短生命周期文件锁并重新执行完整 inspection。只有 inspection 生成且已由
 * 隔离 Git worktree 验证的候选，才能按“目标不存在时原子创建”或“完整
 * StableFileSource 仍匹配时原子替换”发布。提交后再次稳定读取和运行 Git，成功回执
 * 才证明最终节点、摘要、managed envelope 与规则语义全部一致。
 *
 * 输入、矩阵、Host Profile、根策略、锁 recipe 和公共错误由相邻 contract 唯一解释。
 * 本 owner 不删除用户正文、不把 user-owned 满足状态改写为 managed 状态，也不自动
 * 退休崩溃锁残留；锁残留和不确定提交由显式恢复职责所有者处理。
 */

async function inspectCurrent(
  root: RootedDirectory,
  request: Readonly<ParsedWakeflowGitignoreRecompositionRequest>,
  signal: AbortSignal | undefined,
  afterCommit: boolean,
): Promise<Readonly<WakeflowGitignoreInspection>> {
  try {
    return await inspectWakeflowWorkspaceGitignore(
      root,
      wakeflowGitignoreInspectionRequest(request, signal),
    );
  } catch (error: unknown) {
    if (afterCommit) fail("commit-uncertain", "$resourcePath");
    if (error instanceof WakeflowGitignoreInspectionError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "target-capacity") fail("capacity", "$target");
      if (
        error.reason === "input"
        || error.reason === "context"
        || error.reason === "authority"
      ) {
        fail("input", error.path);
      }
      if (error.reason === "git") {
        fail("observation-failure", "$git");
      }
      fail("source-invalid", "$source");
    }
    fail("observation-failure", "$git");
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
  if (
    error.reason === "root-scope"
    || error.reason === "parent-changed"
  ) {
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
  inspection: Readonly<WakeflowGitignoreInspection>,
  signal: AbortSignal | undefined,
): Promise<Readonly<WakeflowGitignoreRecompositionEffect>> {
  const target = inspection.target;
  if (
    inspection.status !== "recompose-required"
    || target === null
    || inspection.targetGitRuleChecks === null
    || inspection.targetGitRuleChecks.some((entry) => !entry.ignored)
  ) {
    fail("source-invalid", "$target");
  }
  try {
    if (inspection.source === null) {
      return await createFileAtomically(
        root,
        WAKEFLOW_GITIGNORE_REF,
        target.bytes,
        {
          mode: WAKEFLOW_GITIGNORE_FILE_MODE,
          ...(signal === undefined ? {} : { signal }),
        },
      );
    }
    return await replaceFileAtomically(
      root,
      WAKEFLOW_GITIGNORE_REF,
      target.bytes,
      {
        mode: WAKEFLOW_GITIGNORE_FILE_MODE,
        expected: inspection.source,
        ...(signal === undefined ? {} : { signal }),
      },
    );
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
  before: Readonly<WakeflowGitignoreInspection>,
  effect: Readonly<WakeflowGitignoreRecompositionEffect>,
  after: Readonly<WakeflowGitignoreInspection>,
  expectedUserId: bigint,
): void {
  const target = before.target;
  const source = after.source;
  if (
    before.status !== "recompose-required"
    || target === null
    || before.targetGitRuleChecks === null
    || before.targetGitRuleChecks.some((entry) => !entry.ignored)
    || source === null
    || after.status !== "managed-current"
    || after.target !== null
    || after.targetGitRuleChecks !== null
    || after.gitRuleChecks.some((entry) => !entry.ignored)
    || after.envelope.kind !== "managed"
    || after.context.matrixDigest !== before.context.matrixDigest
    || after.authority.authorityDigest !== before.authority.authorityDigest
    || after.authority.bodyDigest !== before.authority.bodyDigest
    || effect.resourcePath !== WAKEFLOW_GITIGNORE_REF
    || effect.digest !== target.digest
    || effect.byteCount !== target.byteCount
    || effect.node.kind !== "file"
    || effect.node.permissionBits !== WAKEFLOW_GITIGNORE_FILE_MODE
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
  request: Readonly<ParsedWakeflowGitignoreRecompositionRequest>,
  options: Readonly<ParsedWakeflowGitignoreRecompositionOptions>,
  expectedUserId: bigint,
  markCommitted: () => void,
): Promise<Readonly<WakeflowGitignoreRecompositionReceipt>> {
  assertWakeflowGitignoreRecompositionNotAborted(options.signal);
  await assertCurrentUserWakeflowGitignoreRecompositionRoot(
    root,
    expectedUserId,
  );
  const before = await inspectCurrent(root, request, options.signal, false);
  if (before.status !== "recompose-required") {
    return Object.freeze({
      disposition: "current",
      effect: null,
      inspection: before,
    });
  }
  await assertCurrentUserWakeflowGitignoreRecompositionRoot(
    root,
    expectedUserId,
  );
  assertWakeflowGitignoreRecompositionNotAborted(options.signal);
  const effect = await publishTarget(root, before, options.signal);
  markCommitted();
  const after = await inspectCurrent(root, request, options.signal, true);
  assertReadback(before, effect, after, expectedUserId);
  return Object.freeze({
    disposition: effect.publication,
    effect,
    inspection: after,
  });
}

/**
 * 在 Gitignore 专属短锁内重推导当前目标，并执行幂等 current、原子创建或 CAS 替换。
 */
export async function recomposeWakeflowWorkspaceGitignore(
  rootValue: RootedDirectory,
  requestValue: WakeflowGitignoreRecompositionRequest,
  optionsValue?: WakeflowGitignoreRecompositionOptions,
): Promise<Readonly<WakeflowGitignoreRecompositionReceipt>> {
  assertWakeflowGitignoreRecompositionRoot(rootValue);
  const request = parseWakeflowGitignoreRecompositionRequest(requestValue);
  const options = parseWakeflowGitignoreRecompositionOptions(optionsValue);
  assertWakeflowGitignoreRecompositionNotAborted(options.signal);
  admitWakeflowGitignoreRecompositionLockOperations(request);
  const expectedUserId = currentWakeflowGitignoreRecompositionUserId();
  await assertCurrentUserWakeflowGitignoreRecompositionRoot(
    rootValue,
    expectedUserId,
  );

  let committed = false;
  try {
    return await withRootedExclusiveFileLock(
      rootValue,
      WAKEFLOW_GITIGNORE_RECOMPOSITION_LOCK_REF,
      () => recomposeUnderLock(
        rootValue,
        request,
        options,
        expectedUserId,
        () => { committed = true; },
      ),
      wakeflowGitignoreRecompositionLockOptions(options),
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowGitignoreRecompositionError) throw error;
    if (error instanceof RootedExclusiveFileLockError) {
      mapWakeflowGitignoreRecompositionLockError(error, committed);
    }
    fail(committed ? "commit-uncertain" : "effect-failure", "$resourcePath");
  }
}

export {
  WakeflowGitignoreRecompositionError,
  WAKEFLOW_GITIGNORE_FILE_MODE,
  WAKEFLOW_GITIGNORE_RECOMPOSITION_LOCK_TIMEOUT_MILLISECONDS,
  type WakeflowGitignoreRecompositionEffect,
  type WakeflowGitignoreRecompositionErrorReason,
  type WakeflowGitignoreRecompositionOptions,
  type WakeflowGitignoreRecompositionReceipt,
  type WakeflowGitignoreRecompositionRequest,
} from "./wakeflow-gitignore-recomposition-contract.js";
