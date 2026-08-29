import {
  computeDurableAtomicFileStageTargetDigest,
  hasDurableAtomicFileStagePrefix,
  parseDurableAtomicFileStageFileName,
  readDurableAtomicFileStageOwnerState,
  DurableAtomicFileStageAddressError,
} from "../foundation/filesystem/durable-atomic-file-stage-address.js";
import {
  DURABLE_ATOMIC_FILE_STAGE_MAXIMUM_ENTRIES,
} from "../foundation/filesystem/durable-atomic-file-stage-recovery.js";
import { RootedDirectory } from "../foundation/filesystem/rooted-directory.js";
import {
  inspectRootedExclusiveFileLock,
  retireRootedExclusiveFileLockResidue,
  RootedExclusiveFileLockError,
} from "../foundation/filesystem/rooted-exclusive-file-lock.js";
import {
  readStableRootDirectory,
  StableDirectoryReadError,
} from "../foundation/filesystem/stable-directory-read.js";
import { WAKEFLOW_CONFIG_AUTHORITY_FILE_MODE } from "./wakeflow-config-authority-publication.js";
import { WAKEFLOW_CONFIG_FILE_REF } from "./wakeflow-config-authority-snapshot.js";
import {
  replaceWakeflowConfigAuthority,
} from "./wakeflow-config-authority-replacement.js";
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
  parseWakeflowConfigAuthorityRecoveryOptions,
  prepareWakeflowConfigAuthorityDesired,
  readCurrentWakeflowConfigAuthority,
  WAKEFLOW_CONFIG_AUTHORITY_LOCK_REF,
  type ParsedWakeflowConfigAuthorityExpectation,
  type PreparedWakeflowConfigAuthorityDesired,
  type WakeflowConfigAuthorityReplacementRecoveryOptions,
  type WakeflowConfigAuthorityReplacementRecoveryReceipt,
} from "./wakeflow-config-authority-replacement-contract.js";

/**
 * Wakeflow Configuration：非活动 Config 替换残留的显式恢复。
 *
 * 本模块不会在获取旧锁后直接继续执行副作用。它先证明当前配置仍与调用方预期或目标
 * 配置一致，再稳定枚举 Workspace 根目录，确认所有原子暂存文件只属于同一次 Config
 * 替换或该锁文件自身的创建。随后，模块精确退休旧锁并重新进入正常替换流程。任何
 * 无法完整证明归属和状态的现场都会保持原样，并返回“需要恢复”。
 */

async function inspectRecoveryStages(
  root: RootedDirectory,
  desiredSourceDigest: PreparedWakeflowConfigAuthorityDesired["sourceDigest"],
  expectedUserId: bigint,
  signal: AbortSignal | undefined,
): Promise<void> {
  let directory;
  try {
    directory = await readStableRootDirectory(root, {
      maximumEntries: DURABLE_ATOMIC_FILE_STAGE_MAXIMUM_ENTRIES,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error: unknown) {
    if (error instanceof StableDirectoryReadError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "root-scope") fail("root-scope", "$root");
      fail("recovery-required", "$stages");
    }
    fail("recovery-required", "$stages");
  }
  const configTargetDigest = computeDurableAtomicFileStageTargetDigest(
    WAKEFLOW_CONFIG_FILE_REF,
  );
  const lockTargetDigest = computeDurableAtomicFileStageTargetDigest(
    WAKEFLOW_CONFIG_AUTHORITY_LOCK_REF,
  );
  for (const entry of directory.entries) {
    if (!hasDurableAtomicFileStagePrefix(entry.name)) continue;
    let address;
    try {
      address = parseDurableAtomicFileStageFileName(entry.name);
    } catch (error: unknown) {
      if (error instanceof DurableAtomicFileStageAddressError) {
        fail("recovery-required", "$stages");
      }
      fail("recovery-required", "$stages");
    }
    if (readDurableAtomicFileStageOwnerState(address) !== "inactive") {
      fail("recovery-required", "$stages");
    }
    if (
      entry.node.kind !== "file"
      || entry.node.userId !== expectedUserId
      || (entry.node.permissionBits !== 0o600
        && entry.node.permissionBits !== address.mode)
    ) {
      fail("recovery-required", "$stages");
    }
    if (address.targetResourcePathDigest === configTargetDigest) {
      if (
        address.operation !== "replace"
        || address.inputDigest !== desiredSourceDigest
        || address.mode !== WAKEFLOW_CONFIG_AUTHORITY_FILE_MODE
        || entry.node.linkCount !== 1n
      ) {
        fail("recovery-required", "$stages");
      }
    } else if (address.targetResourcePathDigest === lockTargetDigest) {
      if (
        address.operation !== "create"
        || address.mode !== 0o600
        || (entry.node.linkCount !== 1n && entry.node.linkCount !== 2n)
      ) {
        fail("recovery-required", "$stages");
      }
    } else {
      fail("recovery-required", "$stages");
    }
  }
}

function currentIsRecoverable(
  root: RootedDirectory,
  current: Awaited<ReturnType<typeof readCurrentWakeflowConfigAuthority>>,
  expected: Readonly<ParsedWakeflowConfigAuthorityExpectation>,
  desired: Readonly<PreparedWakeflowConfigAuthorityDesired>,
): boolean {
  return current.configDigest === desired.configDigest
    || matchesWakeflowConfigAuthorityExpectation(root, current, expected);
}

/**
 * 显式退役可证明安全的非活动 Config 锁与暂存资源前缀，再重新执行正常替换流程。
 * 不存在残留、职责所有者仍在活动或状态未知、目标不同的暂存文件，以及第三方暂存
 * 文件都会被拒绝并原样保留。
 */
export async function recoverWakeflowConfigAuthorityReplacement(
  root: RootedDirectory,
  desiredModelValue: unknown,
  expectedSnapshotValue: unknown,
  options?: WakeflowConfigAuthorityReplacementRecoveryOptions,
): Promise<Readonly<WakeflowConfigAuthorityReplacementRecoveryReceipt>> {
  assertWakeflowConfigAuthorityRoot(root);
  const parsed = parseWakeflowConfigAuthorityRecoveryOptions(options);
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

  let observation;
  try {
    observation = await inspectRootedExclusiveFileLock(
      root,
      WAKEFLOW_CONFIG_AUTHORITY_LOCK_REF,
    );
  } catch (error: unknown) {
    if (error instanceof RootedExclusiveFileLockError) {
      mapWakeflowConfigAuthorityLockError(error, false);
    }
    fail("recovery-required", "$lock");
  }
  if (observation.status === "absent") {
    fail("recovery-not-required", "$lock");
  }
  if (observation.ownerState !== "inactive") {
    fail("recovery-required", "$lock");
  }

  const current = await readCurrentWakeflowConfigAuthority(
    root,
    parsed.signal,
    false,
  );
  assertWakeflowConfigAuthoritySourcePolicy(current, expectedUserId);
  if (!currentIsRecoverable(root, current, expected, desired)) {
    fail("conflict", "$source");
  }
  if (
    current.configDigest !== desired.configDigest
    && current.model.program.programId !== desired.model.program.programId
  ) {
    fail("program-identity", "$/program/programId");
  }
  await inspectRecoveryStages(
    root,
    desired.sourceDigest,
    expectedUserId,
    parsed.signal,
  );
  assertWakeflowConfigAuthorityNotAborted(parsed.signal);

  try {
    await retireRootedExclusiveFileLockResidue(
      root,
      WAKEFLOW_CONFIG_AUTHORITY_LOCK_REF,
      observation,
      { relatedTargetResourcePaths: [WAKEFLOW_CONFIG_FILE_REF] },
    );
  } catch (error: unknown) {
    if (error instanceof RootedExclusiveFileLockError) {
      mapWakeflowConfigAuthorityLockError(error, false);
    }
    fail("recovery-required", "$lock");
  }

  const replacement = await replaceWakeflowConfigAuthority(
    root,
    desired.model,
    expectedSnapshotValue,
    parsed.signal === undefined ? undefined : { signal: parsed.signal },
  );
  return Object.freeze({
    disposition: "recovered" as const,
    replacement,
  });
}

export {
  type WakeflowConfigAuthorityReplacementRecoveryOptions,
  type WakeflowConfigAuthorityReplacementRecoveryReceipt,
} from "./wakeflow-config-authority-replacement-contract.js";
