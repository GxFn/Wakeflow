import { equal, rejects } from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { RootedDirectory } from "../../src/foundation/filesystem/rooted-directory.js";
import { OperationAbortedError } from "../../src/foundation/node/abort-signal.js";
import { WakeflowError } from "../../src/kernel/error.js";
import { withPodMutation } from "../../src/kernel/pod-mutation-lock.js";
import { useDisposableDurability } from "../support/disposable-durability.js";

useDisposableDurability();

const POD_ID = "pod_99999999-9999-4999-8999-999999999999";

async function fixture(t: TestContext) {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-pod-lock-")));
  const root = await RootedDirectory.open(base, "$root", { durability: "none" });
  t.after(async () => {
    await root.close();
    rmSync(base, { recursive: true, force: true });
  });
  return { base, root };
}

test("pod 互斥区：正常进入并释放；锁的路径上不是普通文件时按不可重试冲突拒绝（§13.161 F6）", async (t) => {
  const f = await fixture(t);
  let entered = 0;
  equal(await withPodMutation(f.root, POD_ID, async () => ++entered), 1);
  equal(entered, 1);
  const lockPath = path.join(f.base, ".wakeflow-local", "runtime", "locks", "pod-mutation.lock");
  rmSync(lockPath);
  mkdirSync(lockPath, { mode: 0o700 });
  await rejects(
    withPodMutation(f.root, POD_ID, async () => ++entered),
    (error: unknown) =>
      error instanceof WakeflowError &&
      error.code === "concurrency-conflict" &&
      error.reason === "pod-lock-unsafe-lock" &&
      error.retryable === false,
  );
  equal(entered, 1);
  // 中止在进入之前被观察到：是中止，而不是冲突。
  await rejects(
    withPodMutation(f.root, POD_ID, async () => ++entered, AbortSignal.abort()),
    OperationAbortedError,
  );
  equal(entered, 1);
});
