import {
  equal,
} from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  publishWakeflowConfigAuthority,
} from "../../src/configuration/wakeflow-config-authority-publication.js";
import {
  replaceWakeflowConfigAuthority,
  WakeflowConfigAuthorityReplacementError,
  WAKEFLOW_CONFIG_AUTHORITY_LOCK_REF,
  type WakeflowConfigAuthorityReplacementErrorReason,
} from "../../src/configuration/wakeflow-config-authority-replacement.js";
import {
  recoverWakeflowConfigAuthorityReplacement,
} from "../../src/configuration/wakeflow-config-authority-replacement-recovery.js";
import {
  readWakeflowConfigAuthoritySnapshot,
  WAKEFLOW_CONFIG_FILE_REF,
} from "../../src/configuration/wakeflow-config-authority-snapshot.js";
import {
  computeWakeflowConfigV3Digest,
  parseWakeflowConfigV3,
} from "../../src/configuration/wakeflow-config-v3.js";
import { renderWakeflowConfigV3 } from "../../src/configuration/wakeflow-config-v3-document.js";
import { computeSha256Digest } from "../../src/foundation/crypto/sha256.js";
import {
  createFileCandidateDurably,
} from "../../src/foundation/filesystem/durable-file-candidate.js";
import {
  issueDurableAtomicFileStageAddress,
  releaseDurableAtomicFileStageAddress,
} from "../../src/foundation/filesystem/durable-atomic-file-stage-address.js";
import { durableAtomicFileStageRefForTest } from "../foundation/filesystem/durable-atomic-file-test-support.js";
import { rootedExclusiveFileLockRecordTextForTest } from "../foundation/filesystem/rooted-exclusive-file-lock-test-support.js";
import { RootedDirectory } from "../../src/foundation/filesystem/rooted-directory.js";
import { withRootedExclusiveFileLock } from "../../src/foundation/filesystem/rooted-exclusive-file-lock.js";
import { encodeUtf8 } from "../../src/foundation/text/utf8.js";
import { createMinimalWakeflowConfigV3 } from "./wakeflow-config-v3.fixture.js";

interface WorkspaceFixture {
  readonly temporaryRoot: string;
  readonly workspaceRoot: string;
  readonly configPath: string;
  readonly lockPath: string;
}

function createWorkspace(): WorkspaceFixture {
  const temporaryRoot = realpathSync(mkdtempSync(path.join(
    os.tmpdir(),
    "wakeflow-config-replacement-",
  )));
  const workspaceRoot = path.join(temporaryRoot, "WakeflowProgram");
  mkdirSync(workspaceRoot, { mode: 0o755 });
  mkdirSync(path.join(temporaryRoot, "ProductA"), { mode: 0o755 });
  mkdirSync(path.join(temporaryRoot, "wakeflow-ledger"), { mode: 0o755 });
  return {
    temporaryRoot,
    workspaceRoot,
    configPath: path.join(workspaceRoot, "wakeflow.config.json"),
    lockPath: path.join(workspaceRoot, WAKEFLOW_CONFIG_AUTHORITY_LOCK_REF),
  };
}

function changedConfig(displayName: string): Record<string, unknown> {
  const value = createMinimalWakeflowConfigV3();
  (value.program as Record<string, unknown>).displayName = displayName;
  return value;
}

async function expectReplacementError(
  action: () => unknown | Promise<unknown>,
  reason: WakeflowConfigAuthorityReplacementErrorReason,
): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof WakeflowConfigAuthorityReplacementError)) {
    throw new Error("Expected WakeflowConfigAuthorityReplacementError.");
  }
  equal(caught.code, "wakeflow-config-authority-replacement");
  equal(caught.reason, reason);
}

function writeInactiveLock(lockPath: string): void {
  writeFileSync(lockPath, rootedExclusiveFileLockRecordTextForTest({
    tokenUuid: "11111111-1111-4111-8111-111111111111",
  }), { mode: 0o600 });
}

test("Config authority replacement 在exact source下替换并支持旧请求幂等重试", async () => {
  const fixture = createWorkspace();
  const root = await RootedDirectory.open(fixture.workspaceRoot);
  try {
    const source = await publishWakeflowConfigAuthority(
      root,
      createMinimalWakeflowConfigV3(),
    );
    const desired = changedConfig("Changed Program");
    const replaced = await replaceWakeflowConfigAuthority(
      root,
      desired,
      source.authority,
    );

    equal(replaced.disposition, "replaced");
    equal(replaced.effect?.publication, "replaced");
    equal(replaced.source.configDigest, source.authority.configDigest);
    equal(
      replaced.authority.configDigest,
      computeWakeflowConfigV3Digest(parseWakeflowConfigV3(desired)),
    );
    equal(replaced.authority.source.node.permissionBits, 0o644);
    equal(replaced.authority.source.node.linkCount, 1n);
    equal(existsSync(fixture.lockPath), false);

    const retried = await replaceWakeflowConfigAuthority(
      root,
      desired,
      source.authority,
    );
    equal(retried.disposition, "current");
    equal(retried.effect, null);
    equal(retried.source.configDigest, replaced.authority.configDigest);
    equal(retried.authority, retried.source);
  } finally {
    await root.close();
    rmSync(fixture.temporaryRoot, { recursive: true, force: true });
  }
});

test("Config authority replacement 拒绝stale、跨root与program identity变化", async () => {
  const firstFixture = createWorkspace();
  const firstRoot = await RootedDirectory.open(firstFixture.workspaceRoot);
  const secondFixture = createWorkspace();
  const secondRoot = await RootedDirectory.open(secondFixture.workspaceRoot);
  try {
    const firstSource = await publishWakeflowConfigAuthority(
      firstRoot,
      createMinimalWakeflowConfigV3(),
    );
    const secondSource = await publishWakeflowConfigAuthority(
      secondRoot,
      createMinimalWakeflowConfigV3(),
    );
    const firstDesired = changedConfig("First replacement");
    await replaceWakeflowConfigAuthority(
      firstRoot,
      firstDesired,
      firstSource.authority,
    );
    const before = readFileSync(firstFixture.configPath, "utf8");

    await expectReplacementError(
      () => replaceWakeflowConfigAuthority(
        firstRoot,
        changedConfig("Stale overwrite"),
        firstSource.authority,
      ),
      "conflict",
    );
    equal(readFileSync(firstFixture.configPath, "utf8"), before);

    await expectReplacementError(
      () => replaceWakeflowConfigAuthority(
        firstRoot,
        changedConfig("Cross root"),
        secondSource.authority,
      ),
      "conflict",
    );
    equal(readFileSync(firstFixture.configPath, "utf8"), before);

    const current = await readWakeflowConfigAuthoritySnapshot(firstRoot);
    const changedProgram = changedConfig("Changed identity");
    (changedProgram.program as Record<string, unknown>).programId =
      "program_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await expectReplacementError(
      () => replaceWakeflowConfigAuthority(
        firstRoot,
        changedProgram,
        current,
      ),
      "program-identity",
    );
    equal(readFileSync(firstFixture.configPath, "utf8"), before);
  } finally {
    await firstRoot.close();
    await secondRoot.close();
    rmSync(firstFixture.temporaryRoot, { recursive: true, force: true });
    rmSync(secondFixture.temporaryRoot, { recursive: true, force: true });
  }
});

test("Config authority replacement 通过专属锁串行并发writer", async () => {
  const fixture = createWorkspace();
  const root = await RootedDirectory.open(fixture.workspaceRoot);
  try {
    const source = await publishWakeflowConfigAuthority(
      root,
      createMinimalWakeflowConfigV3(),
    );
    const first = changedConfig("Concurrent A");
    const second = changedConfig("Concurrent B");
    const outcomes = await Promise.allSettled([
      replaceWakeflowConfigAuthority(root, first, source.authority),
      replaceWakeflowConfigAuthority(root, second, source.authority),
    ]);
    const fulfilled = outcomes.filter(
      (outcome): outcome is PromiseFulfilledResult<Awaited<
        ReturnType<typeof replaceWakeflowConfigAuthority>
      >> => outcome.status === "fulfilled",
    );
    const rejected = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
    );
    equal(fulfilled.length, 1);
    equal(fulfilled[0]?.value.disposition, "replaced");
    equal(rejected.length, 1);
    equal(
      rejected[0]?.reason instanceof WakeflowConfigAuthorityReplacementError,
      true,
    );
    equal(
      (rejected[0]?.reason as WakeflowConfigAuthorityReplacementError).reason,
      "conflict",
    );
    const current = await readWakeflowConfigAuthoritySnapshot(root);
    equal(
      new Set([
        computeWakeflowConfigV3Digest(parseWakeflowConfigV3(first)),
        computeWakeflowConfigV3Digest(parseWakeflowConfigV3(second)),
      ]).has(current.configDigest),
      true,
    );
    equal(existsSync(fixture.lockPath), false);
  } finally {
    await root.close();
    rmSync(fixture.temporaryRoot, { recursive: true, force: true });
  }
});

test("Config authority replacement 拒绝不满足P1的current source", async () => {
  const fixture = createWorkspace();
  const root = await RootedDirectory.open(fixture.workspaceRoot);
  try {
    const source = await publishWakeflowConfigAuthority(
      root,
      createMinimalWakeflowConfigV3(),
    );
    chmodSync(fixture.configPath, 0o600);
    const before = readFileSync(fixture.configPath, "utf8");
    await expectReplacementError(
      () => replaceWakeflowConfigAuthority(
        root,
        changedConfig("Must not replace unsafe source"),
        source.authority,
      ),
      "source-policy",
    );
    equal(readFileSync(fixture.configPath, "utf8"), before);
    equal(existsSync(fixture.lockPath), false);
  } finally {
    await root.close();
    rmSync(fixture.temporaryRoot, { recursive: true, force: true });
  }
});

test("Config replacement recovery 只接纳同一desired stage并前向完成", async () => {
  const fixture = createWorkspace();
  const root = await RootedDirectory.open(fixture.workspaceRoot);
  try {
    const source = await publishWakeflowConfigAuthority(
      root,
      createMinimalWakeflowConfigV3(),
    );
    const desired = changedConfig("Recovered replacement");
    const desiredBytes = encodeUtf8(renderWakeflowConfigV3(desired));
    const address = issueDurableAtomicFileStageAddress(
      "replace",
      WAKEFLOW_CONFIG_FILE_REF,
      computeSha256Digest(desiredBytes),
      0o644,
    );
    const stageRef = durableAtomicFileStageRefForTest(
      WAKEFLOW_CONFIG_FILE_REF,
      address,
    );
    try {
      await createFileCandidateDurably(root, stageRef, desiredBytes, {
        mode: 0o644,
      });
    } finally {
      releaseDurableAtomicFileStageAddress(address);
    }
    writeInactiveLock(fixture.lockPath);

    const recovered = await recoverWakeflowConfigAuthorityReplacement(
      root,
      desired,
      source.authority,
    );
    equal(recovered.disposition, "replaced");
    equal(existsSync(fixture.lockPath), false);
    equal(
      existsSync(path.join(fixture.workspaceRoot, ...stageRef.split("/"))),
      false,
    );
    equal(
      recovered.authority.configDigest,
      computeWakeflowConfigV3Digest(parseWakeflowConfigV3(desired)),
    );
  } finally {
    await root.close();
    rmSync(fixture.temporaryRoot, { recursive: true, force: true });
  }
});

test("Config replacement recovery 保留不同desired的lock与stage现场", async () => {
  const fixture = createWorkspace();
  const root = await RootedDirectory.open(fixture.workspaceRoot);
  try {
    const source = await publishWakeflowConfigAuthority(
      root,
      createMinimalWakeflowConfigV3(),
    );
    const desired = changedConfig("Requested replacement");
    const otherBytes = encodeUtf8(renderWakeflowConfigV3(
      changedConfig("Other replacement"),
    ));
    const address = issueDurableAtomicFileStageAddress(
      "replace",
      WAKEFLOW_CONFIG_FILE_REF,
      computeSha256Digest(otherBytes),
      0o644,
    );
    const stageRef = durableAtomicFileStageRefForTest(
      WAKEFLOW_CONFIG_FILE_REF,
      address,
    );
    try {
      await createFileCandidateDurably(root, stageRef, otherBytes, {
        mode: 0o644,
      });
    } finally {
      releaseDurableAtomicFileStageAddress(address);
    }
    writeInactiveLock(fixture.lockPath);

    await expectReplacementError(
      () => recoverWakeflowConfigAuthorityReplacement(
        root,
        desired,
        source.authority,
      ),
      "recovery-required",
    );
    equal(existsSync(fixture.lockPath), true);
    equal(
      existsSync(path.join(fixture.workspaceRoot, ...stageRef.split("/"))),
      true,
    );
    equal(
      readFileSync(fixture.configPath, "utf8"),
      renderWakeflowConfigV3(createMinimalWakeflowConfigV3()),
    );
  } finally {
    await root.close();
    rmSync(fixture.temporaryRoot, { recursive: true, force: true });
  }
});

test("Config replacement recovery 区分无残留与active lock", async () => {
  const fixture = createWorkspace();
  const root = await RootedDirectory.open(fixture.workspaceRoot);
  let releaseHolder: (() => void) | undefined;
  let holder: Promise<void> | undefined;
  const holderGate = new Promise<void>((resolve) => { releaseHolder = resolve; });
  let markStarted: (() => void) | undefined;
  const holderStarted = new Promise<void>((resolve) => { markStarted = resolve; });
  try {
    const source = await publishWakeflowConfigAuthority(
      root,
      createMinimalWakeflowConfigV3(),
    );
    const desired = changedConfig("Recovery state distinction");
    await expectReplacementError(
      () => recoverWakeflowConfigAuthorityReplacement(
        root,
        desired,
        source.authority,
      ),
      "recovery-not-required",
    );

    holder = withRootedExclusiveFileLock(
      root,
      WAKEFLOW_CONFIG_AUTHORITY_LOCK_REF,
      async () => {
        markStarted?.();
        await holderGate;
      },
    );
    await holderStarted;
    await expectReplacementError(
      () => recoverWakeflowConfigAuthorityReplacement(
        root,
        desired,
        source.authority,
      ),
      "recovery-required",
    );
    equal(existsSync(fixture.lockPath), true);
    releaseHolder?.();
    await holder;
    equal(existsSync(fixture.lockPath), false);
  } finally {
    releaseHolder?.();
    await holder?.catch(() => undefined);
    await root.close();
    rmSync(fixture.temporaryRoot, { recursive: true, force: true });
  }
});
