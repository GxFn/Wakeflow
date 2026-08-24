import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  withFileLock,
} from "../core/scripts/lib/wakeflow-state-lock.mjs";

test("withFileLock creates private lock bytes independent of the process umask", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-lock-mode-"));
  const lockFile = path.join(root, "state.lock");
  const previousUmask = process.umask(0o777);
  try {
    withFileLock(lockFile, () => {
      assert.equal(lstatSync(lockFile).mode & 0o777, 0o600);
    });
  } finally {
    process.umask(previousUmask);
  }
  assert.equal(existsSync(lockFile), false);
});

test("withFileLock rejects a dangling lock symlink without retrying forever", {
  skip: process.platform === "win32" ? "file symlink creation is not reliably available on Windows" : false,
}, () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-lock-symlink-"));
  const lockFile = path.join(root, "state.lock");
  symlinkSync(path.join(root, "missing-target"), lockFile);
  const startedAt = Date.now();
  assert.throws(
    () => withFileLock(lockFile, () => assert.fail("unsafe lock must not be acquired"), {
      acquireTimeoutMs: 50,
    }),
    (error) => {
      assert.equal(error?.code, "WAKEFLOW_STATE_LOCK_UNSAFE");
      assert.equal(error?.path, lockFile);
      return true;
    },
  );
  assert.ok(Date.now() - startedAt < 500, "unsafe lock rejection must be bounded");
});

test("withFileLock bounds a non-finite holder age without deleting the lock", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-lock-invalid-age-"));
  const lockFile = path.join(root, "state.lock");
  writeFileSync(lockFile, `${JSON.stringify({
    kind: "WakeflowStateLock",
    version: 1,
    pid: process.pid,
    token: "malformed-age-holder",
    createdAt: "not-a-date",
  })}\n`, { mode: 0o600 });
  const startedAt = Date.now();
  assert.throws(
    () => withFileLock(lockFile, () => assert.fail("malformed lock must not be acquired"), {
      acquireTimeoutMs: 50,
    }),
    (error) => {
      assert.equal(error?.code, "WAKEFLOW_STATE_LOCK_TIMEOUT");
      return true;
    },
  );
  assert.ok(Date.now() - startedAt < 500, "non-finite lock age must honor the acquisition deadline");
  assert.equal(existsSync(lockFile), true, "unreadable ownership is fail-closed, not stale-broken");
});

test("withFileLock preserves the vanished-holder retry and acquires the replacement lock", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-lock-vanish-"));
  const lockFile = path.join(root, "state.lock");
  writeFileSync(lockFile, `${JSON.stringify({
    kind: "WakeflowStateLock",
    version: 1,
    pid: process.pid,
    token: "vanishing-holder",
    createdAt: new Date().toISOString(),
  })}\n`, { mode: 0o600 });
  const remover = spawn(process.execPath, [
    "-e",
    "setTimeout(() => require('node:fs').unlinkSync(process.argv[1]), 75)",
    lockFile,
  ], { stdio: "ignore" });
  const removerExit = once(remover, "exit");

  const result = withFileLock(lockFile, () => "acquired-after-vanish", {
    acquireTimeoutMs: 1500,
  });
  const [exitCode] = await removerExit;
  assert.equal(exitCode, 0);
  assert.equal(result, "acquired-after-vanish");
  assert.equal(existsSync(lockFile), false, "the acquired replacement lock is released by its owner");
});

test("withFileLock rejects decorated options without executing accessors or creating a lock", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-lock-options-"));
  const lockFile = path.join(root, "state.lock");
  let getterCalls = 0;
  const options = {};
  Object.defineProperty(options, "acquireTimeoutMs", {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error("lock option getter must not execute");
    },
  });
  assert.throws(
    () => withFileLock(lockFile, () => "unreachable", options),
    (error) => error?.code === "WAKEFLOW_STATE_LOCK_INPUT",
  );
  assert.equal(getterCalls, 0);
  assert.equal(existsSync(lockFile), false);
});

test("withFileLock rejects asynchronous critical sections instead of releasing their lock early", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-lock-async-"));
  const lockFile = path.join(root, "state.lock");
  assert.throws(
    () => withFileLock(lockFile, async () => "not synchronously guarded"),
    (error) => error?.code === "WAKEFLOW_STATE_LOCK_INPUT",
  );
  assert.equal(existsSync(lockFile), false);

  assert.throws(
    () => withFileLock(lockFile, () => Promise.resolve("also asynchronous")),
    (error) => error?.code === "WAKEFLOW_STATE_LOCK_INPUT",
  );
  assert.equal(existsSync(lockFile), false);
});

test("withFileLock rejects an oversized holder record without allocating or parsing it", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-lock-oversized-"));
  const lockFile = path.join(root, "state.lock");
  writeFileSync(lockFile, "x".repeat(4097), { mode: 0o600 });
  assert.throws(
    () => withFileLock(lockFile, () => assert.fail("oversized lock must not be acquired"), {
      acquireTimeoutMs: 50,
    }),
    (error) => error?.code === "WAKEFLOW_STATE_LOCK_UNSAFE",
  );
  assert.equal(existsSync(lockFile), true);
});

test("withFileLock reports a stale break only after unlink and preserves an onWarn replacement", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-lock-warning-order-"));
  const lockFile = path.join(root, "state.lock");
  const staleAt = new Date(Date.now() - 60_000);
  writeFileSync(lockFile, `${JSON.stringify({
    kind: "WakeflowStateLock",
    version: 1,
    pid: 2_147_483_647,
    token: "2147483647-old-deadlock",
    createdAt: staleAt.toISOString(),
  })}\n`, { mode: 0o600 });
  utimesSync(lockFile, staleAt, staleAt);
  let warningObservedAbsent = null;
  let warnings = 0;
  assert.throws(
    () => withFileLock(lockFile, () => assert.fail("replacement owner must retain the lock"), {
      acquireTimeoutMs: 75,
      staleMs: 1,
      onWarn: () => {
        warnings += 1;
        warningObservedAbsent = !existsSync(lockFile);
        if (warningObservedAbsent) {
          writeFileSync(lockFile, `${JSON.stringify({
            kind: "WakeflowStateLock",
            version: 1,
            pid: process.pid,
            token: `${process.pid}-replacement-abcdefgh`,
            createdAt: new Date().toISOString(),
          })}\n`, { mode: 0o600 });
        }
      },
    }),
    (error) => error?.code === "WAKEFLOW_STATE_LOCK_TIMEOUT",
  );
  assert.equal(warnings, 1);
  assert.equal(warningObservedAbsent, true);
  assert.equal(existsSync(lockFile), true);
});
