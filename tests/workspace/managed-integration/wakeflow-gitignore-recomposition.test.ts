import { deepEqual, equal } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { setImmediate as yieldEventLoop } from "node:timers/promises";

import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { hasDurableAtomicFileStagePrefix } from "../../../src/foundation/filesystem/durable-atomic-file-stage-address.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { withRootedExclusiveFileLock } from "../../../src/foundation/filesystem/rooted-exclusive-file-lock.js";
import {
  claudeCodeWorkspaceHostResourceProfile,
} from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import {
  codexWorkspaceHostResourceProfile,
} from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import {
  createWakeflowGitignoreBodyAuthority,
} from "../../../src/workspace/managed-integration/wakeflow-gitignore-body-authority.js";
import {
  recomposeWakeflowWorkspaceGitignore,
  WakeflowGitignoreRecompositionError,
  type WakeflowGitignoreRecompositionErrorReason,
} from "../../../src/workspace/managed-integration/wakeflow-gitignore-recomposition.js";
import {
  inspectWakeflowManagedTextEnvelope,
} from "../../../src/workspace/managed-integration/wakeflow-managed-text-envelope.js";
import {
  WAKEFLOW_GITIGNORE_RECOMPOSITION_LOCK_REF,
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
  initializeGit = true,
): Promise<Readonly<GitFixture>> {
  const absolutePath = mkdtempSync(path.join(
    os.tmpdir(),
    "wakeflow-gitignore-recomposition-",
  ));
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
  const created = await recomposeWakeflowWorkspaceGitignore(
    current.root,
    request(),
  );

  equal(created.disposition, "created");
  equal(created.effect?.publication, "created");
  equal(created.inspection.status, "managed-current");
  equal(created.inspection.target, null);
  equal(created.inspection.gitRuleChecks.every((entry) => entry.ignored), true);
  equal(statSync(current.gitignorePath).mode & 0o777, 0o644);
  equal(existsSync(current.lockPath), false);
  const createdBytes = readFileSync(current.gitignorePath);
  const createdNode = statSync(current.gitignorePath, { bigint: true });
  const envelope = inspectWakeflowManagedTextEnvelope(createdBytes);
  equal(envelope.kind, "managed");
  equal(
    created.inspection.authority.rules.some((rule) => (
      rule === "/.wakeflow-config-authority.lock"
    )),
    true,
  );
  equal(
    created.inspection.authority.rules.some((rule) => (
      rule === "/.wakeflow-gitignore-recomposition.lock"
    )),
    true,
  );

  const currentReceipt = await recomposeWakeflowWorkspaceGitignore(
    current.root,
    request(),
  );
  equal(currentReceipt.disposition, "current");
  equal(currentReceipt.effect, null);
  equal(currentReceipt.inspection.status, "managed-current");
  deepEqual(readFileSync(current.gitignorePath), createdBytes);
  equal(statSync(current.gitignorePath, { bigint: true }).ino, createdNode.ino);
  equal(existsSync(current.lockPath), false);
});

test("Gitignore recomposition replaces an exact source and preserves user-owned bytes", async (t) => {
  const source = "node_modules/\n# user-owned\n";
  const current = await fixture(t, source);
  const sourceDigest = computeSha256Digest(Buffer.from(source));
  const receipt = await recomposeWakeflowWorkspaceGitignore(
    current.root,
    request(),
  );

  equal(receipt.disposition, "replaced");
  equal(receipt.effect?.publication, "replaced");
  if (receipt.effect?.publication === "replaced") {
    equal(receipt.effect.previous.digest, sourceDigest);
  }
  equal(receipt.inspection.status, "managed-current");
  equal(readFileSync(current.gitignorePath, "utf8").startsWith(source), true);
  equal(existsSync(current.lockPath), false);
});

test("Gitignore recomposition leaves a satisfying user-owned file byte-exact", async (t) => {
  const authority = createWakeflowGitignoreBodyAuthority(PROFILES);
  const source = `# user authority\n${authority.body}`;
  const current = await fixture(t, source);
  const before = readFileSync(current.gitignorePath);
  const beforeNode = statSync(current.gitignorePath, { bigint: true });
  const receipt = await recomposeWakeflowWorkspaceGitignore(
    current.root,
    request(),
  );

  equal(receipt.disposition, "current");
  equal(receipt.effect, null);
  equal(receipt.inspection.status, "satisfied-user-owned");
  equal(receipt.inspection.envelope.kind, "unmanaged");
  deepEqual(readFileSync(current.gitignorePath), before);
  equal(statSync(current.gitignorePath, { bigint: true }).ino, beforeNode.ino);
  equal(existsSync(current.lockPath), false);
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
    equal(existsSync(current.lockPath), false);
  });

  await t.test("non Git repository", async (subtest) => {
    const current = await fixture(subtest, undefined, false);
    await expectRecompositionError(
      () => recomposeWakeflowWorkspaceGitignore(current.root, request()),
      "observation-failure",
      "$git",
    );
    equal(existsSync(current.lockPath), false);
  });

  await t.test("pre-aborted", async (subtest) => {
    const current = await fixture(subtest);
    const controller = new AbortController();
    controller.abort();
    await expectRecompositionError(
      () => recomposeWakeflowWorkspaceGitignore(
        current.root,
        request(),
        { signal: controller.signal },
      ),
      "aborted",
      "$signal",
    );
    equal(existsSync(current.lockPath), false);
  });

  await t.test("source CAS conflict", async (subtest) => {
    const source = `# ${"x".repeat(256 * 1024)}\n`;
    const external = Buffer.from("# external writer won\n");
    const current = await fixture(subtest, source);
    const changeAtReplaceStage = async (): Promise<boolean> => {
      for (let attempt = 0; attempt < 2_000; attempt += 1) {
        if (readdirSync(current.absolutePath).some((entry) => (
          entry.startsWith(".wakeflow-atomic-replace-")
        ))) {
          writeFileSync(current.gitignorePath, external, { mode: 0o644 });
          return true;
        }
        await yieldEventLoop();
      }
      return false;
    };
    const pending = recomposeWakeflowWorkspaceGitignore(
      current.root,
      request(),
    );
    const changing = changeAtReplaceStage();
    await expectRecompositionError(
      () => pending,
      "conflict",
      "$source",
    );
    const changed = await changing;
    equal(changed, true);
    deepEqual(readFileSync(current.gitignorePath), external);
    equal(existsSync(current.lockPath), false);
    equal(
      readdirSync(current.absolutePath).some((entry) => (
        hasDurableAtomicFileStagePrefix(entry)
      )),
      false,
    );
  });

  await t.test("lock timeout", async (subtest) => {
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
      await expectRecompositionError(
        () => recomposeWakeflowWorkspaceGitignore(
          current.root,
          request(),
          {
            acquireTimeoutMilliseconds: 30,
            retryDelayMilliseconds: 5,
          },
        ),
        "lock-timeout",
        "$lock",
      );
    } finally {
      release?.();
      await holder;
    }
    equal(existsSync(current.lockPath), false);
  });
});
