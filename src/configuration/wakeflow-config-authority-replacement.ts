import {
  replaceFileAtomically,
  DurableAtomicFileWriteError,
  type DurableAtomicFileReplaceResult,
} from "../foundation/filesystem/durable-atomic-file-write.js";
import { sameFileNodeSnapshot } from "../foundation/filesystem/file-node-snapshot.js";
import { RootedDirectory } from "../foundation/filesystem/rooted-directory.js";
import {
  withRootedExclusiveFileLock,
  RootedExclusiveFileLockError,
} from "../foundation/filesystem/rooted-exclusive-file-lock.js";
import { WAKEFLOW_CONFIG_AUTHORITY_FILE_MODE } from "./wakeflow-config-authority-publication.js";
import {
  WAKEFLOW_CONFIG_FILE_REF,
  type WakeflowConfigAuthoritySnapshot,
} from "./wakeflow-config-authority-snapshot.js";
import {
  assertCurrentUserWakeflowConfigAuthorityRoot,
  assertWakeflowConfigAuthorityDesiredPlacements,
  assertWakeflowConfigAuthorityNotAborted,
  assertWakeflowConfigAuthorityRoot,
  assertWakeflowConfigAuthoritySourcePolicy,
  currentWakeflowConfigAuthorityUserId,
  failWakeflowConfigAuthorityReplacement as fail,
  mapWakeflowConfigAuthorityLockError,
  matchesWakeflowConfigAuthorityExpectation,
  parseWakeflowConfigAuthorityExpectation,
  parseWakeflowConfigAuthorityReplacementOptions,
  prepareWakeflowConfigAuthorityDesired,
  readCurrentWakeflowConfigAuthority,
  sameWakeflowConfigAuthoritySource,
  wakeflowConfigAuthorityLockOptions,
  WakeflowConfigAuthorityReplacementError,
  WAKEFLOW_CONFIG_AUTHORITY_LOCK_REF,
  type ParsedWakeflowConfigAuthorityExpectation,
  type ParsedWakeflowConfigAuthorityReplacementOptions,
  type PreparedWakeflowConfigAuthorityDesired,
  type WakeflowConfigAuthorityReplacementOptions,
  type WakeflowConfigAuthorityReplacementReceipt,
} from "./wakeflow-config-authority-replacement-contract.js";

/**
 * Wakeflow Configuration：Config 权威记录的正常读取、幂等判断与条件替换路径。
 *
 * 本模块只在 Config 专属短锁内重新读取当前权威记录、判断当前值是否已经等于目标值、
 * 核对调用方的源资源预期，并调用 Foundation 原子替换能力。输入准入、P1 源资源策略
 * 和稳定错误由相邻合同负责；非活动残留的显式处置由替换恢复模块负责。
 */

function mapAtomicReplaceError(error: DurableAtomicFileWriteError): never {
  if (error.reason === "input") fail("input", error.path);
  if (error.reason === "aborted") fail("aborted", "$signal");
  if (error.reason === "capacity") fail("capacity", "$config");
  if (
    error.reason === "expectation-changed"
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
  if (
    error.reason === "commit-uncertain"
    || error.reason === "durability-failure"
    || error.reason === "stage-cleanup-failure"
    || error.reason === "close-failure"
  ) {
    fail("commit-uncertain", "$resourcePath");
  }
  if (error.reason === "stage-recovery-required") {
    fail("recovery-required", "$resourcePath");
  }
  fail("replacement-failure", "$resourcePath");
}

async function replaceCurrentBytes(
  root: RootedDirectory,
  current: Readonly<WakeflowConfigAuthoritySnapshot>,
  desired: Readonly<PreparedWakeflowConfigAuthorityDesired>,
  signal: AbortSignal | undefined,
): Promise<Readonly<DurableAtomicFileReplaceResult>> {
  try {
    return await replaceFileAtomically(
      root,
      WAKEFLOW_CONFIG_FILE_REF,
      desired.bytes,
      {
        mode: WAKEFLOW_CONFIG_AUTHORITY_FILE_MODE,
        expected: current.source,
        ...(signal === undefined ? {} : { signal }),
      },
    );
  } catch (error: unknown) {
    if (error instanceof DurableAtomicFileWriteError) {
      mapAtomicReplaceError(error);
    }
    fail("replacement-failure", "$resourcePath");
  }
}

function assertReplacementReadback(
  source: Readonly<WakeflowConfigAuthoritySnapshot>,
  effect: Readonly<DurableAtomicFileReplaceResult>,
  authority: Readonly<WakeflowConfigAuthoritySnapshot>,
  desired: Readonly<PreparedWakeflowConfigAuthorityDesired>,
  expectedUserId: bigint,
): void {
  if (
    effect.resourcePath !== WAKEFLOW_CONFIG_FILE_REF
    || effect.digest !== desired.sourceDigest
    || !sameWakeflowConfigAuthoritySource(effect.previous, source.source)
    || effect.node.kind !== "file"
    || effect.node.permissionBits !== WAKEFLOW_CONFIG_AUTHORITY_FILE_MODE
    || effect.node.linkCount !== 1n
    || effect.node.userId !== expectedUserId
    || authority.source.resourcePath !== effect.resourcePath
    || authority.source.digest !== effect.digest
    || authority.source.byteCount !== effect.byteCount
    || !sameFileNodeSnapshot(authority.source.node, effect.node)
    || authority.configDigest !== desired.configDigest
  ) {
    fail("commit-uncertain", "$resourcePath");
  }
}

async function replaceUnderLock(
  root: RootedDirectory,
  desired: Readonly<PreparedWakeflowConfigAuthorityDesired>,
  expected: Readonly<ParsedWakeflowConfigAuthorityExpectation>,
  options: Readonly<ParsedWakeflowConfigAuthorityReplacementOptions>,
  expectedUserId: bigint,
  markCommitted: () => void,
): Promise<Readonly<WakeflowConfigAuthorityReplacementReceipt>> {
  assertWakeflowConfigAuthorityNotAborted(options.signal);
  await assertCurrentUserWakeflowConfigAuthorityRoot(root, expectedUserId);
  const current = await readCurrentWakeflowConfigAuthority(
    root,
    options.signal,
    false,
  );
  assertWakeflowConfigAuthoritySourcePolicy(current, expectedUserId);

  // 当前值已经等于期望值时，按旧请求的幂等回读处理；不再要求旧源资源仍是当前值。
  if (current.configDigest === desired.configDigest) {
    return Object.freeze({
      disposition: "current" as const,
      source: current,
      effect: null,
      authority: current,
    });
  }
  if (!matchesWakeflowConfigAuthorityExpectation(root, current, expected)) {
    fail("conflict", "$expected");
  }
  if (current.model.program.programId !== desired.model.program.programId) {
    fail("program-identity", "$/program/programId");
  }

  // 前置检查到取得锁之间，配置位置可能变化；执行副作用前必须在锁内重新验证。
  await assertWakeflowConfigAuthorityDesiredPlacements(root, desired.model);
  await assertCurrentUserWakeflowConfigAuthorityRoot(root, expectedUserId);
  assertWakeflowConfigAuthorityNotAborted(options.signal);

  const effect = await replaceCurrentBytes(
    root,
    current,
    desired,
    options.signal,
  );
  markCommitted();
  const authority = await readCurrentWakeflowConfigAuthority(
    root,
    options.signal,
    true,
  );
  assertReplacementReadback(
    current,
    effect,
    authority,
    desired,
    expectedUserId,
  );
  return Object.freeze({
    disposition: "replaced" as const,
    source: current,
    effect,
    authority,
  });
}

/** 在 Config 专属短锁内执行当前值检查、幂等判断和基于精确源预期的替换。 */
export async function replaceWakeflowConfigAuthority(
  root: RootedDirectory,
  desiredModelValue: unknown,
  expectedSnapshotValue: unknown,
  options?: WakeflowConfigAuthorityReplacementOptions,
): Promise<Readonly<WakeflowConfigAuthorityReplacementReceipt>> {
  assertWakeflowConfigAuthorityRoot(root);
  const parsed = parseWakeflowConfigAuthorityReplacementOptions(options);
  assertWakeflowConfigAuthorityNotAborted(parsed.signal);
  const expectedUserId = currentWakeflowConfigAuthorityUserId();
  const desired = prepareWakeflowConfigAuthorityDesired(desiredModelValue);
  const expected = parseWakeflowConfigAuthorityExpectation(
    expectedSnapshotValue,
    expectedUserId,
  );
  if (expected.workspaceRoot !== root.absolutePath) {
    fail("conflict", "$expected.workspaceRoot");
  }
  if (desired.model.program.programId !== expected.programId) {
    fail("program-identity", "$/program/programId");
  }
  await assertCurrentUserWakeflowConfigAuthorityRoot(root, expectedUserId);
  await assertWakeflowConfigAuthorityDesiredPlacements(root, desired.model);
  assertWakeflowConfigAuthorityNotAborted(parsed.signal);

  let committed = false;
  try {
    return await withRootedExclusiveFileLock(
      root,
      WAKEFLOW_CONFIG_AUTHORITY_LOCK_REF,
      () => replaceUnderLock(
        root,
        desired,
        expected,
        parsed,
        expectedUserId,
        () => { committed = true; },
      ),
      wakeflowConfigAuthorityLockOptions(parsed),
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigAuthorityReplacementError) throw error;
    if (error instanceof RootedExclusiveFileLockError) {
      mapWakeflowConfigAuthorityLockError(error, committed);
    }
    fail(
      committed ? "commit-uncertain" : "replacement-failure",
      "$resourcePath",
    );
  }
}

export {
  WakeflowConfigAuthorityReplacementError,
  WAKEFLOW_CONFIG_AUTHORITY_LOCK_REF,
  WAKEFLOW_CONFIG_AUTHORITY_LOCK_TIMEOUT_MILLISECONDS,
  type WakeflowConfigAuthorityReplacementErrorReason,
  type WakeflowConfigAuthorityReplacementOptions,
  type WakeflowConfigAuthorityReplacementReceipt,
} from "./wakeflow-config-authority-replacement-contract.js";
