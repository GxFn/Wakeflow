import { deepEqual, equal } from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  computeWakeflowConfigDigest,
  parseWakeflowConfig,
  type WakeflowConfigModel,
} from "../../src/configuration/wakeflow-config.js";
import { publishWakeflowConfigAuthority } from "../../src/configuration/wakeflow-config-authority-publication.js";
import {
  replaceWakeflowConfigAuthority,
  WakeflowConfigAuthorityReplacementError,
} from "../../src/configuration/wakeflow-config-authority-replacement.js";
import type { WakeflowConfigAuthorityReplacementErrorReason } from "../../src/configuration/wakeflow-config-authority-replacement-contract.js";
import {
  readWakeflowConfigAuthoritySnapshot,
  WAKEFLOW_CONFIG_FILE_REF,
} from "../../src/configuration/wakeflow-config-authority-snapshot.js";
import { computeSha256Digest } from "../../src/foundation/crypto/sha256.js";
import {
  issueDurableAtomicFileStageAddress,
  releaseDurableAtomicFileStageAddress,
} from "../../src/foundation/filesystem/durable-atomic-file-stage-address.js";
import { RootedDirectory } from "../../src/foundation/filesystem/rooted-directory.js";
import { useDisposableDurability } from "../support/disposable-durability.js";
import { createMinimalWakeflowConfig } from "./wakeflow-config.fixture.js";

useDisposableDurability();

interface WorkspaceFixture {
  readonly temporaryRoot: string;
  readonly workspaceRoot: string;
  readonly configPath: string;
}

/** 工作区根上名字以 `.lock` 结尾的文件：配置的锁在私有的锁目录里（ADR-0033），根上应当一个都没有。 */
function rootLockFiles(fixture: WorkspaceFixture): readonly string[] {
  return readdirSync(fixture.workspaceRoot).filter((name) => name.endsWith(".lock"));
}

function createWorkspace(): WorkspaceFixture {
  const temporaryRoot = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "wakeflow-config-replacement-")),
  );
  const workspaceRoot = path.join(temporaryRoot, "WakeflowProgram");
  mkdirSync(workspaceRoot, { mode: 0o755 });
  mkdirSync(path.join(temporaryRoot, "ProductA"), { mode: 0o755 });
  mkdirSync(path.join(temporaryRoot, "wakeflow-ledger"), { mode: 0o755 });
  return {
    temporaryRoot,
    workspaceRoot,
    configPath: path.join(workspaceRoot, "wakeflow.config.json"),
  };
}

function changedConfig(displayName: string, programId?: string): WakeflowConfigModel {
  const value = createMinimalWakeflowConfig();
  (value.program as Record<string, unknown>).displayName = displayName;
  if (programId !== undefined) (value.program as Record<string, unknown>).programId = programId;
  return parseWakeflowConfig(value);
}

function minimalConfig(): WakeflowConfigModel {
  return parseWakeflowConfig(createMinimalWakeflowConfig());
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

test("Config authority replacement 在exact source下替换并支持旧请求幂等重试", async () => {
  const fixture = createWorkspace();
  const root = await RootedDirectory.open(fixture.workspaceRoot);
  try {
    const source = await publishWakeflowConfigAuthority(root, minimalConfig());
    const desired = changedConfig("Changed Program");
    const replaced = await replaceWakeflowConfigAuthority(root, desired, source.authority);

    equal(replaced.disposition, "replaced");
    equal(replaced.effect?.publication, "replaced");
    equal(replaced.source.configDigest, source.authority.configDigest);
    equal(
      replaced.authority.configDigest,
      computeWakeflowConfigDigest(parseWakeflowConfig(desired)),
    );
    equal(replaced.authority.source.node.permissionBits, 0o644);
    equal(replaced.authority.source.node.linkCount, 1n);
    deepEqual(rootLockFiles(fixture), []);

    const retried = await replaceWakeflowConfigAuthority(root, desired, source.authority);
    equal(retried.disposition, "current");
    equal(retried.effect, null);
    equal(retried.source.configDigest, replaced.authority.configDigest);
    equal(retried.authority, retried.source);
  } finally {
    await root.close();
    rmSync(fixture.temporaryRoot, { recursive: true, force: true });
  }
});

test("Config authority replacement 先结算配置文件的死暂存，然后照常替换（ADR-0033 决定 6）", async () => {
  const fixture = createWorkspace();
  const root = await RootedDirectory.open(fixture.workspaceRoot);
  try {
    const source = await publishWakeflowConfigAuthority(root, minimalConfig());
    // 上一个替换配置的进程死在写到一半：内核已经收走它的锁，它替换用的暂存还留着。
    const bytes = Buffer.from("{}\n");
    const stage = issueDurableAtomicFileStageAddress(
      "replace",
      WAKEFLOW_CONFIG_FILE_REF,
      computeSha256Digest(bytes),
      0o644,
    );
    releaseDurableAtomicFileStageAddress(stage);
    const stagePath = path.join(fixture.workspaceRoot, stage.fileName);
    writeFileSync(stagePath, bytes, { mode: 0o644 });

    const replaced = await replaceWakeflowConfigAuthority(
      root,
      changedConfig("After A Dead Holder"),
      source.authority,
    );
    equal(replaced.disposition, "replaced");
    equal(existsSync(stagePath), false);
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
    const firstSource = await publishWakeflowConfigAuthority(firstRoot, minimalConfig());
    const secondSource = await publishWakeflowConfigAuthority(secondRoot, minimalConfig());
    const firstDesired = changedConfig("First replacement");
    await replaceWakeflowConfigAuthority(firstRoot, firstDesired, firstSource.authority);
    const before = readFileSync(firstFixture.configPath, "utf8");

    await expectReplacementError(
      () =>
        replaceWakeflowConfigAuthority(
          firstRoot,
          changedConfig("Stale overwrite"),
          firstSource.authority,
        ),
      "conflict",
    );
    equal(readFileSync(firstFixture.configPath, "utf8"), before);

    await expectReplacementError(
      () =>
        replaceWakeflowConfigAuthority(
          firstRoot,
          changedConfig("Cross root"),
          secondSource.authority,
        ),
      "conflict",
    );
    equal(readFileSync(firstFixture.configPath, "utf8"), before);

    const current = await readWakeflowConfigAuthoritySnapshot(firstRoot);
    const changedProgram = changedConfig(
      "Changed identity",
      "program_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    await expectReplacementError(
      () => replaceWakeflowConfigAuthority(firstRoot, changedProgram, current),
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
    const source = await publishWakeflowConfigAuthority(root, minimalConfig());
    const first = changedConfig("Concurrent A");
    const second = changedConfig("Concurrent B");
    const outcomes = await Promise.allSettled([
      replaceWakeflowConfigAuthority(root, first, source.authority),
      replaceWakeflowConfigAuthority(root, second, source.authority),
    ]);
    const fulfilled = outcomes.filter(
      (
        outcome,
      ): outcome is PromiseFulfilledResult<
        Awaited<ReturnType<typeof replaceWakeflowConfigAuthority>>
      > => outcome.status === "fulfilled",
    );
    const rejected = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
    );
    equal(fulfilled.length, 1);
    equal(fulfilled[0]?.value.disposition, "replaced");
    equal(rejected.length, 1);
    equal(rejected[0]?.reason instanceof WakeflowConfigAuthorityReplacementError, true);
    equal(
      // biome-ignore lint/correctness/noUnsafeOptionalChaining: 上一断言已保证 rejected[0] 存在
      (rejected[0]?.reason as WakeflowConfigAuthorityReplacementError).reason,
      "conflict",
    );
    const current = await readWakeflowConfigAuthoritySnapshot(root);
    equal(
      new Set([
        computeWakeflowConfigDigest(parseWakeflowConfig(first)),
        computeWakeflowConfigDigest(parseWakeflowConfig(second)),
      ]).has(current.configDigest),
      true,
    );
  } finally {
    await root.close();
    rmSync(fixture.temporaryRoot, { recursive: true, force: true });
  }
});

test("Config authority replacement 拒绝不满足P1的current source", async () => {
  const fixture = createWorkspace();
  const root = await RootedDirectory.open(fixture.workspaceRoot);
  try {
    const source = await publishWakeflowConfigAuthority(root, minimalConfig());
    chmodSync(fixture.configPath, 0o600);
    const before = readFileSync(fixture.configPath, "utf8");
    await expectReplacementError(
      () =>
        replaceWakeflowConfigAuthority(
          root,
          changedConfig("Must not replace unsafe source"),
          source.authority,
        ),
      "source-policy",
    );
    equal(readFileSync(fixture.configPath, "utf8"), before);
  } finally {
    await root.close();
    rmSync(fixture.temporaryRoot, { recursive: true, force: true });
  }
});
