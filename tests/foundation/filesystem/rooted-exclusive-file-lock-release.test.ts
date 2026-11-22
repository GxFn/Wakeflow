import { deepEqual, equal, rejects } from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import { filesystemMutation } from "../../../src/foundation/filesystem/filesystem-mutation.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  RootedExclusiveFileLockError,
  type RootedExclusiveFileLockOptions,
  setRootedExclusiveFileLockReleaseFailureReporter,
  withRootedExclusiveFileLock,
} from "../../../src/foundation/filesystem/rooted-exclusive-file-lock.js";

/**
 * Level 1 (component): 独占文件锁的释放竞态（technical-debt B10；1.4.1 第 1 段清单 2.2 节）。
 *
 * 释放只删自己获取的那个节点：临界区里锁被删掉、被别人换成另一份、或在删除之后立刻有后继者
 * 写进同名路径，释放都不得碰别人的文件。同一组用例跑两遍：默认档在 `none` 的根上（只看协议，
 * 不看同步）；轻档（获取时 `durability: "content-only"`，L1 到 L7）在真实同步的根上。释放不分档，
 * 两档都在删除之后同步父目录（重排计划第 3 节路丙）；轻档这一遍让那次父目录同步真的发生，钉住
 * 它在删除与结算之间不改变竞态的结局。
 */

interface ReleaseClass {
  readonly name: string;
  readonly rootDurability: "fsync" | "none";
  readonly options: RootedExclusiveFileLockOptions | undefined;
}

const RELEASE_CLASSES: readonly ReleaseClass[] = [
  { name: "默认档", rootDurability: "none", options: undefined },
  { name: "轻档 content-only", rootDurability: "fsync", options: { durability: "content-only" } },
];

async function fixture(
  t: TestContext,
  rootDurability: "fsync" | "none",
): Promise<{ root: RootedDirectory; directory: string }> {
  const directory = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-lock-release-")));
  mkdirSync(path.join(directory, "locks"), { mode: 0o700 });
  const root = await RootedDirectory.open(directory, "$root", { durability: rootDurability });
  t.after(async () => {
    setRootedExclusiveFileLockReleaseFailureReporter(null);
    await root.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { root, directory };
}

for (const releaseClass of RELEASE_CLASSES) {
  test(`${releaseClass.name}：临界区成功后释放失败：没有报告者仍抛 release-failure；有报告者时结果照常返回、残留交给报告者（B10）`, async (t) => {
    const { root, directory } = await fixture(t, releaseClass.rootDurability);
    const lockPath = parsePortableResourcePath("locks/board.lock");
    const lockFile = path.join(directory, "locks", "board.lock");
    const vanish = () => unlinkSync(lockFile);
    const withLock = <Result>(operation: () => Promise<Result>) =>
      withRootedExclusiveFileLock(root, lockPath, operation, releaseClass.options);
    await rejects(
      withLock(async () => {
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
      await withLock(async () => {
        vanish();
        return "committed";
      }),
      "committed",
    );
    deepEqual(reports, ["locks/board.lock:release-failure"]);
    // 临界区失败时操作的错误才是结局，释放失败只报告。
    await rejects(
      withLock(async () => {
        vanish();
        throw new Error("operation failed");
      }),
      /operation failed/u,
    );
    deepEqual(reports, ["locks/board.lock:release-failure", "locks/board.lock:release-failure"]);

    // 临界区里锁被换成另一份（不同的节点）：释放认不出自己的节点，报告 release-failure，
    // 替换者原样留在原处。
    equal(
      await withLock(async () => {
        vanish();
        writeFileSync(lockFile, "replacement", { mode: 0o600 });
        return "committed";
      }),
      "committed",
    );
    equal(reports.length, 3);
    equal(readFileSync(lockFile, "utf8"), "replacement");
    unlinkSync(lockFile);

    // 释放删掉自己的节点之后、结算之前，后继者写进同名路径：释放照常完成、不报告，
    // 后继者原样留在原处。
    const originalUnlink = filesystemMutation.unlink;
    let successorWritten = false;
    const mocked = t.mock.method(filesystemMutation, "unlink", async (candidate: string) => {
      await originalUnlink.call(filesystemMutation, candidate);
      if (!successorWritten && candidate === lockFile) {
        successorWritten = true;
        writeFileSync(lockFile, "successor", { mode: 0o600 });
      }
    });
    try {
      equal(await withLock(async () => "committed"), "committed");
    } finally {
      mocked.mock.restore();
    }
    equal(successorWritten, true);
    equal(reports.length, 3);
    equal(readFileSync(lockFile, "utf8"), "successor");
    unlinkSync(lockFile);

    // 正常释放不报告。
    equal(await withLock(async () => "clean"), "clean");
    equal(reports.length, 3);
  });
}
