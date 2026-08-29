import { equal } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  linkSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import {
  createFileCandidateDurably,
} from "../../../src/foundation/filesystem/durable-file-candidate.js";
import {
  durableAtomicFileStageRef,
  issueDurableAtomicFileStageAddress,
  releaseDurableAtomicFileStageAddress,
} from "../../../src/foundation/filesystem/durable-atomic-file-stage-address.js";
import {
  parsePortableResourcePath,
} from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { withRootedExclusiveFileLock } from "../../../src/foundation/filesystem/rooted-exclusive-file-lock.js";
import {
  claudeCodeWorkspaceHostResourceProfile,
} from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import {
  codexWorkspaceHostResourceProfile,
} from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import {
  inspectWakeflowWorkspaceGitignore,
} from "../../../src/workspace/managed-integration/wakeflow-gitignore-inspection.js";
import {
  recoverWakeflowWorkspaceGitignoreRecomposition,
} from "../../../src/workspace/managed-integration/wakeflow-gitignore-recomposition-recovery.js";
import {
  WakeflowGitignoreRecompositionError,
  type WakeflowGitignoreRecompositionErrorReason,
} from "../../../src/workspace/managed-integration/wakeflow-gitignore-recomposition.js";
import {
  WAKEFLOW_GITIGNORE_RECOMPOSITION_LOCK_REF,
  WAKEFLOW_GITIGNORE_REF,
} from "../../../src/workspace/managed-integration/wakeflow-managed-integration-resource-catalog.js";
import {
  createWakeflowWorkspaceStaticResourceMatrix,
} from "../../../src/workspace/wakeflow-workspace-static-resource-matrix.js";

const PROFILES = Object.freeze([
  codexWorkspaceHostResourceProfile,
  claudeCodeWorkspaceHostResourceProfile,
]);

interface GitFixture {
  readonly absolutePath: string;
  readonly gitignorePath: string;
  readonly lockPath: string;
  readonly root: RootedDirectory;
}

async function fixture(
  t: TestContext,
  source?: string | Uint8Array,
): Promise<Readonly<GitFixture>> {
  const absolutePath = mkdtempSync(path.join(
    os.tmpdir(),
    "wakeflow-gitignore-recovery-",
  ));
  const initialized = spawnSync("git", ["init", "--quiet"], {
    cwd: absolutePath,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (initialized.status !== 0) {
    throw new Error("Disposable Git repository initialization failed.");
  }
  const gitignorePath = path.join(absolutePath, WAKEFLOW_GITIGNORE_REF);
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
    lockPath: path.join(
      absolutePath,
      WAKEFLOW_GITIGNORE_RECOMPOSITION_LOCK_REF,
    ),
    root,
  });
}

function request() {
  const matrix = createWakeflowWorkspaceStaticResourceMatrix(
    codexWorkspaceHostResourceProfile,
  );
  return Object.freeze({
    matrix,
    expectedMatrixDigest: matrix.matrixDigest,
    hostProfiles: PROFILES,
  });
}

function writeInactiveLock(lockPath: string): void {
  writeFileSync(lockPath, `${JSON.stringify({
    createdAt: "2026-08-27T10:00:00.000Z",
    kind: "WakeflowExclusiveFileLock",
    pid: 2_147_483_647,
    threadId: 0,
    token: "2147483647-0-11111111-1111-4111-8111-111111111111",
    version: 1,
  }, null, 2)}\n`, { mode: 0o600 });
}

async function expectRecoveryError(
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
    equal(caught.reason, reason);
    equal(caught.path, pathValue);
  }
}

test("Gitignore recovery retires an inactive lock and re-enters normal creation", async (t) => {
  const current = await fixture(t);
  writeInactiveLock(current.lockPath);

  const recovered = await recoverWakeflowWorkspaceGitignoreRecomposition(
    current.root,
    request(),
  );
  equal(recovered.disposition, "recovered");
  equal(/^sha256:[0-9a-f]{64}$/u.test(recovered.retiredLockDigest), true);
  equal(recovered.stageRecovery.observedStageCount, 0);
  equal(recovered.recomposition.disposition, "created");
  equal(recovered.recomposition.inspection.status, "managed-current");
  equal(existsSync(current.lockPath), false);
  equal(existsSync(current.gitignorePath), true);
});

test("Gitignore recovery rolls back an inactive single-link replace stage", async (t) => {
  const current = await fixture(t, "node_modules/\n");
  const bytes = Buffer.from("unpublished candidate");
  const address = issueDurableAtomicFileStageAddress(
    "replace",
    WAKEFLOW_GITIGNORE_REF,
    computeSha256Digest(bytes),
    0o644,
  );
  const stageRef = durableAtomicFileStageRef(WAKEFLOW_GITIGNORE_REF, address);
  let released = false;
  try {
    await createFileCandidateDurably(current.root, stageRef, bytes, {
      mode: 0o644,
    });
    releaseDurableAtomicFileStageAddress(address);
    released = true;
    writeInactiveLock(current.lockPath);

    const recovered = await recoverWakeflowWorkspaceGitignoreRecomposition(
      current.root,
      request(),
    );
    equal(recovered.stageRecovery.retiredStageCount, 1);
    equal(recovered.stageRecovery.settledTargetCount, 0);
    equal(recovered.recomposition.disposition, "replaced");
    equal(existsSync(path.join(current.absolutePath, stageRef)), false);
    equal(existsSync(current.lockPath), false);
  } finally {
    if (!released) releaseDurableAtomicFileStageAddress(address);
  }
});

test("Gitignore recovery forward-settles an exact two-link create publication", async (t) => {
  const current = await fixture(t);
  const inspected = await inspectWakeflowWorkspaceGitignore(
    current.root,
    request(),
  );
  if (inspected.target === null) throw new Error("Expected Gitignore target.");
  const target = inspected.target;
  const address = issueDurableAtomicFileStageAddress(
    "create",
    WAKEFLOW_GITIGNORE_REF,
    target.digest,
    0o644,
  );
  const stageRef = durableAtomicFileStageRef(WAKEFLOW_GITIGNORE_REF, address);
  let released = false;
  try {
    await createFileCandidateDurably(current.root, stageRef, target.bytes, {
      mode: 0o644,
    });
    linkSync(
      path.join(current.absolutePath, stageRef),
      current.gitignorePath,
    );
    releaseDurableAtomicFileStageAddress(address);
    released = true;
    writeInactiveLock(current.lockPath);

    const recovered = await recoverWakeflowWorkspaceGitignoreRecomposition(
      current.root,
      request(),
    );
    equal(recovered.stageRecovery.retiredStageCount, 1);
    equal(recovered.stageRecovery.settledTargetCount, 1);
    equal(recovered.recomposition.disposition, "current");
    equal(recovered.recomposition.inspection.status, "managed-current");
    equal(statSync(current.gitignorePath).nlink, 1);
    equal(existsSync(path.join(current.absolutePath, stageRef)), false);
    equal(existsSync(current.lockPath), false);
  } finally {
    if (!released) releaseDurableAtomicFileStageAddress(address);
  }
});

test("Gitignore recovery preserves foreign stage and distinguishes absent or active locks", async (t) => {
  await t.test("foreign stage", async (subtest) => {
    const current = await fixture(subtest);
    const foreignTarget = parsePortableResourcePath("foreign.txt");
    const bytes = Buffer.from("foreign");
    const address = issueDurableAtomicFileStageAddress(
      "replace",
      foreignTarget,
      computeSha256Digest(bytes),
      0o600,
    );
    const stageRef = durableAtomicFileStageRef(foreignTarget, address);
    let released = false;
    try {
      await createFileCandidateDurably(current.root, stageRef, bytes, {
        mode: 0o600,
      });
      releaseDurableAtomicFileStageAddress(address);
      released = true;
      writeInactiveLock(current.lockPath);

      await expectRecoveryError(
        () => recoverWakeflowWorkspaceGitignoreRecomposition(
          current.root,
          request(),
        ),
        "recovery-required",
        "$stages",
      );
      equal(existsSync(path.join(current.absolutePath, stageRef)), true);
      equal(existsSync(current.lockPath), true);
      equal(existsSync(current.gitignorePath), false);
    } finally {
      if (!released) releaseDurableAtomicFileStageAddress(address);
    }
  });

  await t.test("absent lock", async (subtest) => {
    const current = await fixture(subtest);
    await expectRecoveryError(
      () => recoverWakeflowWorkspaceGitignoreRecomposition(
        current.root,
        request(),
      ),
      "recovery-not-required",
      "$lock",
    );
  });

  await t.test("active lock", async (subtest) => {
    const current = await fixture(subtest);
    let enter: (() => void) | undefined;
    let release: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    const holder = withRootedExclusiveFileLock(
      current.root,
      WAKEFLOW_GITIGNORE_RECOMPOSITION_LOCK_REF,
      async () => {
        enter?.();
        await released;
      },
    );
    await entered;
    try {
      await expectRecoveryError(
        () => recoverWakeflowWorkspaceGitignoreRecomposition(
          current.root,
          request(),
        ),
        "recovery-required",
        "$lock",
      );
      equal(existsSync(current.lockPath), true);
    } finally {
      release?.();
      await holder;
    }
    equal(existsSync(current.lockPath), false);
  });
});
