import { equal } from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { hrtime } from "node:process";
import { test } from "node:test";
import { threadId } from "node:worker_threads";

import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  inspectRootedExclusiveFileLock,
  retireRootedExclusiveFileLockResidue,
  RootedExclusiveFileLockError,
  withRootedExclusiveFileLock,
  type RootedExclusiveFileLockErrorReason,
} from "../../../src/foundation/filesystem/rooted-exclusive-file-lock.js";

async function expectLockError(
  action: () => unknown | Promise<unknown>,
  reason: RootedExclusiveFileLockErrorReason,
): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof RootedExclusiveFileLockError)) {
    throw new Error("Expected RootedExclusiveFileLockError.");
  }
  equal(caught.reason, reason);
}

test("concurrent async critical sections are serialized and lock residue is removed", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-exclusive-lock-"));
  mkdirSync(path.join(rootPath, "state"));
  const root = await RootedDirectory.open(rootPath);
  const lockPath = parsePortableResourcePath("state/board.lock");
  let active = 0;
  let maximumActive = 0;
  let completed = 0;
  try {
    await Promise.all(Array.from({ length: 8 }, async () => (
      withRootedExclusiveFileLock(root, lockPath, async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise<void>((resolve) => setTimeout(resolve, 2));
        completed += 1;
        active -= 1;
      })
    )));
    equal(maximumActive, 1);
    equal(completed, 8);
    equal(await root.inspectExistingResource(lockPath).catch(() => null), null);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("operation failure still releases the exact owned lock", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-lock-failure-"));
  mkdirSync(path.join(rootPath, "state"));
  const root = await RootedDirectory.open(rootPath);
  const lockPath = parsePortableResourcePath("state/board.lock");
  try {
    const privateError = new Error("operation failed");
    let caught: unknown;
    try {
      await withRootedExclusiveFileLock(root, lockPath, () => {
        throw privateError;
      });
    } catch (error: unknown) {
      caught = error;
    }
    equal(caught, privateError);
    let rejectedUndefined = false;
    try {
      await withRootedExclusiveFileLock(root, lockPath, () => {
        throw undefined;
      });
    } catch {
      rejectedUndefined = true;
    }
    equal(rejectedUndefined, true);
    equal(
      await withRootedExclusiveFileLock(root, lockPath, () => "available"),
      "available",
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("an internal owner may correlate the lock token with an operation UUID", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-lock-correlation-"));
  mkdirSync(path.join(rootPath, "state"));
  const root = await RootedDirectory.open(rootPath);
  const lockPath = parsePortableResourcePath("state/board.lock");
  const uuid = "11111111-1111-4111-8111-111111111111";
  try {
    await withRootedExclusiveFileLock(
      root,
      lockPath,
      async () => {
        const observed = await inspectRootedExclusiveFileLock(root, lockPath);
        equal(observed.status, "held");
        if (observed.status === "held") {
          equal(observed.record.token.endsWith(`-${uuid}`), true);
        }
      },
      { tokenUuidFactory: () => uuid },
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("an invalid correlation UUID factory is mapped to lock acquisition failure", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-lock-correlation-error-"));
  mkdirSync(path.join(rootPath, "state"));
  const root = await RootedDirectory.open(rootPath);
  const lockPath = parsePortableResourcePath("state/board.lock");
  try {
    await expectLockError(
      () => withRootedExclusiveFileLock(
        root,
        lockPath,
        () => undefined,
        { tokenUuidFactory: () => "invalid" },
      ),
      "acquire-failure",
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("a held or crash-residue lock times out without automatic deletion", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-lock-timeout-"));
  mkdirSync(path.join(rootPath, "state"));
  const root = await RootedDirectory.open(rootPath);
  const lockPath = parsePortableResourcePath("state/board.lock");
  let releaseHolder: (() => void) | undefined;
  let markStarted: (() => void) | undefined;
  const holderGate = new Promise<void>((resolve) => { releaseHolder = resolve; });
  const holderStarted = new Promise<void>((resolve) => { markStarted = resolve; });
  try {
    const holder = withRootedExclusiveFileLock(root, lockPath, () => {
      markStarted?.();
      return holderGate;
    });
    await holderStarted;
    const observed = await inspectRootedExclusiveFileLock(root, lockPath);
    equal(observed.status, "held");
    if (observed.status === "held") {
      equal(observed.record.pid, process.pid);
      equal(observed.record.threadId, threadId);
      equal(observed.ownerState, "active");
      await expectLockError(
        () => retireRootedExclusiveFileLockResidue(root, lockPath, observed),
        "owner-active",
      );
    }
    await expectLockError(
      () => withRootedExclusiveFileLock(
        root,
        lockPath,
        () => undefined,
        { acquireTimeoutMilliseconds: 20, retryDelayMilliseconds: 5 },
      ),
      "timeout",
    );
    const longRetryStartedAt = hrtime.bigint();
    await expectLockError(
      () => withRootedExclusiveFileLock(
        root,
        lockPath,
        () => undefined,
        { acquireTimeoutMilliseconds: 20, retryDelayMilliseconds: 1_000 },
      ),
      "timeout",
    );
    const longRetryElapsedMilliseconds = Number(
      (hrtime.bigint() - longRetryStartedAt) / 1_000_000n,
    );
    equal(longRetryElapsedMilliseconds < 500, true);
    releaseHolder?.();
    await holder;
  } finally {
    releaseHolder?.();
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("explicit recovery retires an exact inactive-owner residue", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-lock-residue-"));
  mkdirSync(path.join(rootPath, "state"));
  const physicalLock = path.join(rootPath, "state", "board.lock");
  writeFileSync(physicalLock, `${JSON.stringify({
    createdAt: "2026-08-26T09:00:00.000Z",
    kind: "WakeflowExclusiveFileLock",
    pid: 2_147_483_647,
    threadId: 0,
    token: "2147483647-0-11111111-1111-4111-8111-111111111111",
    version: 1,
  }, null, 2)}\n`, { mode: 0o600 });
  const root = await RootedDirectory.open(rootPath);
  const lockPath = parsePortableResourcePath("state/board.lock");
  try {
    const observed = await inspectRootedExclusiveFileLock(root, lockPath);
    equal(observed.status, "held");
    if (observed.status !== "held") throw new Error("Expected held lock.");
    equal(observed.ownerState, "inactive");
    await retireRootedExclusiveFileLockResidue(root, lockPath, observed);
    equal(existsSync(physicalLock), false);
    equal((await inspectRootedExclusiveFileLock(root, lockPath)).status, "absent");

    writeFileSync(physicalLock, `${JSON.stringify({
      createdAt: "2026-08-26T09:00:01.000Z",
      kind: "WakeflowExclusiveFileLock",
      pid: process.pid,
      threadId,
      token: `${process.pid}-${threadId}-22222222-2222-4222-8222-222222222222`,
      version: 1,
    }, null, 2)}\n`, { mode: 0o600 });
    const sameThreadResidue = await inspectRootedExclusiveFileLock(
      root,
      lockPath,
    );
    equal(sameThreadResidue.status, "held");
    if (sameThreadResidue.status !== "held") {
      throw new Error("Expected same-thread residue.");
    }
    equal(sameThreadResidue.ownerState, "inactive");
    await retireRootedExclusiveFileLockResidue(
      root,
      lockPath,
      sameThreadResidue,
    );
    equal(existsSync(physicalLock), false);
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("unsafe lock nodes and decorated options fail closed", async () => {
  const rootPath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-lock-unsafe-"));
  mkdirSync(path.join(rootPath, "state"));
  symlinkSync("missing", path.join(rootPath, "state", "board.lock"));
  const root = await RootedDirectory.open(rootPath);
  const lockPath = parsePortableResourcePath("state/board.lock");
  try {
    await expectLockError(
      () => withRootedExclusiveFileLock(
        root,
        lockPath,
        () => undefined,
        { acquireTimeoutMilliseconds: 10, retryDelayMilliseconds: 1 },
      ),
      "unsafe-lock",
    );
    await expectLockError(
      () => withRootedExclusiveFileLock(
        root,
        lockPath,
        () => undefined,
        null as never,
      ),
      "input",
    );
  } finally {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  }
});
