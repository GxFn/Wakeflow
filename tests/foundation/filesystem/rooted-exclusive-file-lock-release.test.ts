import { deepEqual, equal, rejects } from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  RootedExclusiveFileLockError,
  setRootedExclusiveFileLockReleaseFailureReporter,
  withRootedExclusiveFileLock,
} from "../../../src/foundation/filesystem/rooted-exclusive-file-lock.js";

async function fixture(t: TestContext): Promise<{ root: RootedDirectory; directory: string }> {
  const directory = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-lock-release-")));
  mkdirSync(path.join(directory, "locks"), { mode: 0o700 });
  const root = await RootedDirectory.open(directory, "$root", { durability: "none" });
  t.after(async () => {
    setRootedExclusiveFileLockReleaseFailureReporter(null);
    await root.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { root, directory };
}

test("临界区成功后释放失败：没有报告者仍抛 release-failure；有报告者时结果照常返回、残留交给报告者（B10）", async (t) => {
  const { root, directory } = await fixture(t);
  const lockPath = parsePortableResourcePath("locks/board.lock");
  const vanish = () => unlinkSync(path.join(directory, "locks", "board.lock"));
  await rejects(
    withRootedExclusiveFileLock(root, lockPath, async () => {
      vanish();
      return "committed";
    }),
    (error: unknown) =>
      error instanceof RootedExclusiveFileLockError && error.reason === "release-failure",
  );
  const reports: string[] = [];
  setRootedExclusiveFileLockReleaseFailureReporter((failure) => {
    reports.push(`${failure.lockPath}:${failure.error.reason}`);
    throw new Error("a throwing reporter must not change the outcome");
  });
  equal(
    await withRootedExclusiveFileLock(root, lockPath, async () => {
      vanish();
      return "committed";
    }),
    "committed",
  );
  deepEqual(reports, ["locks/board.lock:release-failure"]);
  // 临界区失败时操作的错误才是结局，释放失败只报告。
  await rejects(
    withRootedExclusiveFileLock(root, lockPath, async () => {
      vanish();
      throw new Error("operation failed");
    }),
    /operation failed/u,
  );
  deepEqual(reports, ["locks/board.lock:release-failure", "locks/board.lock:release-failure"]);
  // 正常释放不报告。
  equal(await withRootedExclusiveFileLock(root, lockPath, async () => "clean"), "clean");
  equal(reports.length, 2);
});
