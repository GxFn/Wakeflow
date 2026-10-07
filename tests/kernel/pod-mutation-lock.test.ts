import { equal, rejects } from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { RootedDirectory } from "../../src/foundation/filesystem/rooted-directory.js";
import { WakeflowError } from "../../src/kernel/error.js";
import { withPodMutation } from "../../src/kernel/pod-mutation-lock.js";

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

test("pod 互斥区：正常进入并释放；不安全的锁记录按不可重试冲突拒绝（§13.161 F6）", async (t) => {
  const f = await fixture(t);
  let entered = 0;
  equal(await withPodMutation(f.root, POD_ID, async () => ++entered), 1);
  equal(entered, 1);
  const lockDirectory = path.join(f.base, ".wakeflow-local", "runtime", "pod-mutations");
  mkdirSync(lockDirectory, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(lockDirectory, `${POD_ID}.lock`), "not a lock record", { mode: 0o600 });
  await rejects(
    withPodMutation(f.root, POD_ID, async () => ++entered),
    (error: unknown) =>
      error instanceof WakeflowError &&
      error.code === "concurrency-conflict" &&
      error.reason === "pod-lock-unsafe-lock" &&
      error.retryable === false,
  );
  equal(entered, 1);
  // 中止在进入之前被观察到：io-failure/aborted，而不是冲突。
  await rejects(
    withPodMutation(f.root, POD_ID, async () => ++entered, AbortSignal.abort()),
    (error: unknown) =>
      error instanceof WakeflowError && error.code === "io-failure" && error.reason === "aborted",
  );
  equal(entered, 1);
});
