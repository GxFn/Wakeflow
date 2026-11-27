import { deepEqual, equal, rejects } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import {
  issueDurableAtomicFileStageAddress,
  releaseDurableAtomicFileStageAddress,
} from "../../../src/foundation/filesystem/durable-atomic-file-stage-address.js";
import { acquireKernelFileLock } from "../../../src/foundation/filesystem/kernel-file-lock.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { OperationAbortedError } from "../../../src/foundation/node/abort-signal.js";
import { claudeCodeWorkspaceHostResourceProfile } from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import {
  materializeWorkspaceLocksRoot,
  workspaceLockRef,
} from "../../../src/kernel/workspace-locks.js";
import { createWakeflowGitignoreBodyAuthority } from "../../../src/workspace/managed-integration/wakeflow-gitignore-body-authority.js";
import {
  recomposeWakeflowWorkspaceGitignore,
  WakeflowGitignoreRecompositionError,
} from "../../../src/workspace/managed-integration/wakeflow-gitignore-recomposition.js";
import type { WakeflowGitignoreRecompositionErrorReason } from "../../../src/workspace/managed-integration/wakeflow-gitignore-recomposition-contract.js";
import { WAKEFLOW_GITIGNORE_REF } from "../../../src/workspace/managed-integration/wakeflow-managed-integration-resource-catalog.js";
import { inspectWakeflowManagedTextEnvelope } from "../../../src/workspace/managed-integration/wakeflow-managed-text-envelope.js";
import { createWakeflowWorkspaceStaticResourceMatrix } from "../../../src/workspace/wakeflow-workspace-static-resource-matrix.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";

useDisposableDurability();

const PROFILES = Object.freeze([
  codexWorkspaceHostResourceProfile,
  claudeCodeWorkspaceHostResourceProfile,
]);

interface GitFixture {
  readonly absolutePath: string;
  readonly gitignorePath: string;
  readonly root: RootedDirectory;
}

async function fixture(
  t: TestContext,
  source?: string | Uint8Array,
  initializeGit = true,
): Promise<Readonly<GitFixture>> {
  const absolutePath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-gitignore-recomposition-"));
  if (initializeGit) {
    const initialized = spawnSync("git", ["init", "--quiet"], {
      cwd: absolutePath,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
    });
    if (initialized.status !== 0) {
      throw new Error("Disposable Git repository initialization failed.");
    }
  }
  const gitignorePath = path.join(absolutePath, ".gitignore");
  if (source !== undefined) {
    writeFileSync(gitignorePath, source, { mode: 0o644 });
  }
  const root = await RootedDirectory.open(absolutePath);
  t.after(async () => {
    await root.close();
    rmSync(absolutePath, { recursive: true, force: true });
  });
  return Object.freeze({
    absolutePath,
    gitignorePath,
    root,
  });
}

function request() {
  const matrix = createWakeflowWorkspaceStaticResourceMatrix(codexWorkspaceHostResourceProfile);
  return Object.freeze({
    matrix,
    expectedMatrixDigest: matrix.matrixDigest,
    hostProfiles: PROFILES,
  });
}

async function expectRecompositionError(
  action: () => Promise<unknown>,
  reason: WakeflowGitignoreRecompositionErrorReason,
  pathValue: string,
): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof WakeflowGitignoreRecompositionError, true);
  if (caught instanceof WakeflowGitignoreRecompositionError) {
    equal(caught.code, "wakeflow-gitignore-recomposition");
    equal(caught.reason, reason);
    equal(caught.path, pathValue);
  }
}

test("Gitignore recomposition atomically creates once and then remains current", async (t) => {
  const current = await fixture(t);
  const created = await recomposeWakeflowWorkspaceGitignore(current.root, request());

  equal(created.disposition, "created");
  equal(created.effect?.publication, "created");
  equal(created.inspection.status, "managed-current");
  equal(created.inspection.target, null);
  equal(
    created.inspection.gitRuleChecks.every((entry) => entry.ignored),
    true,
  );
  equal(statSync(current.gitignorePath).mode & 0o777, 0o644);
  const createdBytes = readFileSync(current.gitignorePath);
  const createdNode = statSync(current.gitignorePath, { bigint: true });
  const envelope = inspectWakeflowManagedTextEnvelope(createdBytes);
  equal(envelope.kind, "managed");
  // 锁在私有的锁目录里（ADR-0033）：工作区根上没有锁文件，托管块里也就没有忽略它们的规则。
  deepEqual(
    readdirSync(current.absolutePath).filter((name) => name.endsWith(".lock")),
    [],
  );
  equal(
    created.inspection.authority.rules.some((rule) => rule.endsWith(".lock")),
    false,
  );

  const currentReceipt = await recomposeWakeflowWorkspaceGitignore(current.root, request());
  equal(currentReceipt.disposition, "current");
  equal(currentReceipt.effect, null);
  equal(currentReceipt.inspection.status, "managed-current");
  deepEqual(readFileSync(current.gitignorePath), createdBytes);
  equal(statSync(current.gitignorePath, { bigint: true }).ino, createdNode.ino);
});

test("Gitignore recomposition settles a dead writer's stage and then replaces (ADR-0033)", async (t) => {
  const current = await fixture(t, "node_modules/\n");
  // 上一个重组的进程死在写到一半：内核已经收走它的锁，它替换用的暂存还留着。
  const bytes = Buffer.from("stale\n");
  const stage = issueDurableAtomicFileStageAddress(
    "replace",
    WAKEFLOW_GITIGNORE_REF,
    computeSha256Digest(bytes),
    0o644,
  );
  releaseDurableAtomicFileStageAddress(stage);
  const stagePath = path.join(current.absolutePath, stage.fileName);
  writeFileSync(stagePath, bytes, { mode: 0o644 });

  const receipt = await recomposeWakeflowWorkspaceGitignore(current.root, request());
  equal(receipt.disposition, "replaced");
  equal(existsSync(stagePath), false);
});

test("Gitignore recomposition replaces an exact source and preserves user-owned bytes", async (t) => {
  const source = "node_modules/\n# user-owned\n";
  const current = await fixture(t, source);
  const sourceDigest = computeSha256Digest(Buffer.from(source));
  const receipt = await recomposeWakeflowWorkspaceGitignore(current.root, request());

  equal(receipt.disposition, "replaced");
  equal(receipt.effect?.publication, "replaced");
  if (receipt.effect?.publication === "replaced") {
    equal(receipt.effect.previous.digest, sourceDigest);
  }
  equal(receipt.inspection.status, "managed-current");
  equal(readFileSync(current.gitignorePath, "utf8").startsWith(source), true);
});

test("Gitignore recomposition leaves a satisfying user-owned file byte-exact", async (t) => {
  const authority = createWakeflowGitignoreBodyAuthority(PROFILES);
  const source = `# user authority\n${authority.body}`;
  const current = await fixture(t, source);
  const before = readFileSync(current.gitignorePath);
  const beforeNode = statSync(current.gitignorePath, { bigint: true });
  const receipt = await recomposeWakeflowWorkspaceGitignore(current.root, request());

  equal(receipt.disposition, "current");
  equal(receipt.effect, null);
  equal(receipt.inspection.status, "satisfied-user-owned");
  equal(receipt.inspection.envelope.kind, "unmanaged");
  deepEqual(readFileSync(current.gitignorePath), before);
  equal(statSync(current.gitignorePath, { bigint: true }).ino, beforeNode.ino);
});

test("Gitignore recomposition rejects unsafe sources and bounded lock contention", async (t) => {
  await t.test("wrong source mode", async (subtest) => {
    const current = await fixture(subtest, "node_modules/\n");
    chmodSync(current.gitignorePath, 0o600);
    await expectRecompositionError(
      () => recomposeWakeflowWorkspaceGitignore(current.root, request()),
      "source-invalid",
      "$source",
    );
  });

  await t.test("non Git repository", async (subtest) => {
    const current = await fixture(subtest, undefined, false);
    await expectRecompositionError(
      () => recomposeWakeflowWorkspaceGitignore(current.root, request()),
      "observation-failure",
      "$git",
    );
  });

  await t.test("pre-aborted", async (subtest) => {
    const current = await fixture(subtest);
    const controller = new AbortController();
    controller.abort();
    await rejects(
      () =>
        recomposeWakeflowWorkspaceGitignore(current.root, request(), { signal: controller.signal }),
      OperationAbortedError,
    );
  });

  await t.test("lock timeout", async (subtest) => {
    const current = await fixture(subtest);
    await materializeWorkspaceLocksRoot(current.root);
    const lease = await acquireKernelFileLock(
      current.root,
      workspaceLockRef("gitignore"),
      "exclusive",
    );
    try {
      await expectRecompositionError(
        () =>
          recomposeWakeflowWorkspaceGitignore(current.root, request(), {
            acquireTimeoutMilliseconds: 30,
            retryDelayMilliseconds: 5,
          }),
        "lock-timeout",
        "$lock",
      );
    } finally {
      await lease.release();
    }
  });
});
