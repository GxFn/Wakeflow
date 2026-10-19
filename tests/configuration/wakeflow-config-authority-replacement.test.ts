import { equal } from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  computeWakeflowConfigDigest,
  parseWakeflowConfig,
} from "../../src/configuration/wakeflow-config.js";
import { publishWakeflowConfigAuthority } from "../../src/configuration/wakeflow-config-authority-publication.js";
import {
  replaceWakeflowConfigAuthority,
  WAKEFLOW_CONFIG_AUTHORITY_LOCK_REF,
  WakeflowConfigAuthorityReplacementError,
  type WakeflowConfigAuthorityReplacementErrorReason,
} from "../../src/configuration/wakeflow-config-authority-replacement.js";
import { readWakeflowConfigAuthoritySnapshot } from "../../src/configuration/wakeflow-config-authority-snapshot.js";
import { RootedDirectory } from "../../src/foundation/filesystem/rooted-directory.js";
import { createMinimalWakeflowConfig } from "./wakeflow-config.fixture.js";

interface WorkspaceFixture {
  readonly temporaryRoot: string;
  readonly workspaceRoot: string;
  readonly configPath: string;
  readonly lockPath: string;
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
    lockPath: path.join(workspaceRoot, WAKEFLOW_CONFIG_AUTHORITY_LOCK_REF),
  };
}

function changedConfig(displayName: string): Record<string, unknown> {
  const value = createMinimalWakeflowConfig();
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

test("Config authority replacement 在exact source下替换并支持旧请求幂等重试", async () => {
  const fixture = createWorkspace();
  const root = await RootedDirectory.open(fixture.workspaceRoot);
  try {
    const source = await publishWakeflowConfigAuthority(root, createMinimalWakeflowConfig());
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
    equal(existsSync(fixture.lockPath), false);

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

test("Config authority replacement 拒绝stale、跨root与program identity变化", async () => {
  const firstFixture = createWorkspace();
  const firstRoot = await RootedDirectory.open(firstFixture.workspaceRoot);
  const secondFixture = createWorkspace();
  const secondRoot = await RootedDirectory.open(secondFixture.workspaceRoot);
  try {
    const firstSource = await publishWakeflowConfigAuthority(
      firstRoot,
      createMinimalWakeflowConfig(),
    );
    const secondSource = await publishWakeflowConfigAuthority(
      secondRoot,
      createMinimalWakeflowConfig(),
    );
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
    const changedProgram = changedConfig("Changed identity");
    (changedProgram.program as Record<string, unknown>).programId =
      "program_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
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
    const source = await publishWakeflowConfigAuthority(root, createMinimalWakeflowConfig());
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
    const source = await publishWakeflowConfigAuthority(root, createMinimalWakeflowConfig());
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
    equal(existsSync(fixture.lockPath), false);
  } finally {
    await root.close();
    rmSync(fixture.temporaryRoot, { recursive: true, force: true });
  }
});
