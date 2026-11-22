/**
 * 组件级（第 1 级）：根作用域整目录树删除原语 `removeRootedDirectoryTree`。
 *
 * 只有两个调用方（Demand 根退役、pod 回执目录退役），删除的都是权威树：删除之前绑定父目录
 * 句柄，删除成功之后经它同步父目录恰好一次再返回（1.4.1 第 1 段，清单 2.1“整目录删除”）。
 * 这里在 `fsync` 根上钉住同步次数与顺序、缺失不打开父目录、删除失败只关句柄、父目录打不开
 * 是单独的 `parent-open-failure`、同步失败与同步之后的关闭失败是 `durability-failure`；
 * 每条失败路径上句柄恰好关闭一次、调用方收到第一个错误；`none` 根照常跳过 fsync。
 */
import { deepEqual, equal, ok } from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import { filesystemMutation } from "../../../src/foundation/filesystem/filesystem-mutation.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  RootedDirectoryTreeRemovalError,
  removeRootedDirectoryTree,
} from "../../../src/foundation/filesystem/rooted-directory-tree-removal.js";
import { RootedResourceParentHandle } from "../../../src/foundation/filesystem/rooted-resource-parent-handle.js";
import { countFsyncs } from "./fsync-count-probe.js";

async function fixture(
  t: TestContext,
): Promise<{ root: RootedDirectory; directory: string; outside: string }> {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-tree-removal-")));
  const directory = path.join(base, "root");
  const outside = path.join(base, "outside");
  mkdirSync(directory);
  mkdirSync(outside);
  writeFileSync(path.join(outside, "keep.txt"), "keep\n");
  mkdirSync(path.join(directory, "tree", "a"), { recursive: true });
  writeFileSync(path.join(directory, "tree", "a", "b.txt"), "b\n");
  writeFileSync(path.join(directory, "tree", "c.txt"), "c\n");
  writeFileSync(path.join(directory, "file.txt"), "f\n");
  symlinkSync(outside, path.join(directory, "link"));
  const root = await RootedDirectory.open(directory, "$root", { durability: "fsync" });
  t.after(async () => {
    await root.close();
    rmSync(base, { recursive: true, force: true });
  });
  return { root, directory, outside };
}

async function expectError(
  action: () => Promise<unknown>,
  reason: RootedDirectoryTreeRemovalError["reason"],
): Promise<RootedDirectoryTreeRemovalError> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof RootedDirectoryTreeRemovalError))
    throw new Error("Expected RootedDirectoryTreeRemovalError.");
  equal(caught.code, "wakeflow-rooted-directory-tree-removal");
  equal(caught.reason, reason);
  return caught;
}

test("删除根内一整棵目录树；缺失按选项报 not-found 或返回 absent；文件与链接不是目录树", async (t) => {
  const { root, directory, outside } = await fixture(t);
  equal(await removeRootedDirectoryTree(root, parsePortableResourcePath("tree")), "removed");
  equal(existsSync(path.join(directory, "tree")), false);
  await expectError(
    () => removeRootedDirectoryTree(root, parsePortableResourcePath("tree")),
    "not-found",
  );
  equal(
    await removeRootedDirectoryTree(root, parsePortableResourcePath("tree"), { missing: "ignore" }),
    "absent",
  );
  await expectError(
    () => removeRootedDirectoryTree(root, parsePortableResourcePath("file.txt")),
    "not-directory",
  );
  ok(existsSync(path.join(directory, "file.txt")));
  // 指向根外目录的链接：根作用域拒绝观察它，根外的东西原样留着。
  const linked = await expectError(
    () => removeRootedDirectoryTree(root, parsePortableResourcePath("link")),
    "inspection-failure",
  ).catch(() => null);
  ok(linked !== null || existsSync(path.join(outside, "keep.txt")));
  ok(existsSync(path.join(outside, "keep.txt")));
  const controller = new AbortController();
  controller.abort();
  await expectError(
    () =>
      removeRootedDirectoryTree(root, parsePortableResourcePath("file.txt"), {
        signal: controller.signal,
      }),
    "aborted",
  );
  await expectError(
    () =>
      removeRootedDirectoryTree(root, parsePortableResourcePath("x"), {
        missing: "maybe" as never,
      }),
    "input",
  );
});

test("fsync 根：一次删除恰好一次同步，落在父目录上，且在 removeTree 返回之后", {
  concurrency: false,
}, async (t) => {
  const { root, directory } = await fixture(t);
  mkdirSync(path.join(directory, "nested", "tree", "a"), { recursive: true });
  writeFileSync(path.join(directory, "nested", "tree", "a", "b.txt"), "b\n");
  writeFileSync(path.join(directory, "nested", "sibling.txt"), "s\n");

  const events: string[] = [];
  const originalRemoveTree = filesystemMutation.removeTree;
  t.mock.method(filesystemMutation, "removeTree", async (target: string) => {
    await originalRemoveTree.call(filesystemMutation, target);
    events.push(`removeTree ${path.relative(root.absolutePath, target)}`);
  });
  const originalSync = RootedResourceParentHandle.prototype.sync;
  t.mock.method(
    RootedResourceParentHandle.prototype,
    "sync",
    async function observedSync(this: RootedResourceParentHandle) {
      events.push(
        `sync ${path.relative(root.absolutePath, path.dirname(this.resourceAbsolutePath))} tree=${
          existsSync(this.resourceAbsolutePath) ? "present" : "absent"
        }`,
      );
      return originalSync.call(this);
    },
  );

  const synced = await countFsyncs(() =>
    removeRootedDirectoryTree(root, parsePortableResourcePath("nested/tree")),
  );
  equal(synced.result, "removed");
  equal(synced.syncCount, 1);
  equal(synced.directorySyncCount, 1);
  deepEqual(events, [`removeTree ${path.join("nested", "tree")}`, "sync nested tree=absent"]);
  equal(existsSync(path.join(directory, "nested", "tree")), false);
  ok(existsSync(path.join(directory, "nested", "sibling.txt")));
});

test("fsync 根：缺失且 missing ignore 时零次同步、不打开父目录", {
  concurrency: false,
}, async (t) => {
  const { root } = await fixture(t);
  const opens = t.mock.method(RootedResourceParentHandle, "open");
  const absent = await countFsyncs(() =>
    removeRootedDirectoryTree(root, parsePortableResourcePath("missing/tree"), {
      missing: "ignore",
    }),
  );
  equal(absent.result, "absent");
  equal(absent.syncCount, 0);
  equal(opens.mock.callCount(), 0);
});

test("fsync 根：removeTree 失败报 removal-failure，零次同步，父目录句柄已关闭", {
  concurrency: false,
}, async (t) => {
  const { root, directory } = await fixture(t);
  t.mock.method(filesystemMutation, "removeTree", async () => {
    throw Object.assign(new Error("injected removal failure"), { code: "EIO" });
  });
  const closes = t.mock.method(RootedResourceParentHandle.prototype, "close");
  const failed = await countFsyncs(() =>
    expectError(
      () => removeRootedDirectoryTree(root, parsePortableResourcePath("tree")),
      "removal-failure",
    ),
  );
  equal(failed.syncCount, 0);
  equal(closes.mock.callCount(), 1);
  ok(existsSync(path.join(directory, "tree", "c.txt")));
});

test("父目录句柄打不开报 parent-open-failure，不删除，树原样留着", async (t) => {
  const { root, directory } = await fixture(t);
  const removals = t.mock.method(filesystemMutation, "removeTree");
  t.mock.method(RootedResourceParentHandle, "open", async () => {
    throw Object.assign(new Error("injected parent open failure"), { code: "EACCES" });
  });
  await expectError(
    () => removeRootedDirectoryTree(root, parsePortableResourcePath("tree")),
    "parent-open-failure",
  );
  equal(removals.mock.callCount(), 0);
  ok(existsSync(path.join(directory, "tree", "a", "b.txt")));
});

/** 观察父目录句柄的关闭：先真的关闭（不泄漏描述符），按需再抛注入的关闭失败。 */
function observeParentClose(t: TestContext, failure?: Error) {
  const originalClose = RootedResourceParentHandle.prototype.close;
  return t.mock.method(
    RootedResourceParentHandle.prototype,
    "close",
    async function observedClose(this: RootedResourceParentHandle) {
      await originalClose.call(this);
      if (failure !== undefined) throw failure;
    },
  );
}

test("父目录同步失败报 durability-failure，树已经消失；句柄恰好关闭一次，cause 是同步失败", async (t) => {
  const { root, directory } = await fixture(t);
  const syncFailure = Object.assign(new Error("injected sync failure"), { code: "EIO" });
  const syncs = t.mock.method(RootedResourceParentHandle.prototype, "sync", async () => {
    throw syncFailure;
  });
  const closes = observeParentClose(t);
  const failed = await expectError(
    () => removeRootedDirectoryTree(root, parsePortableResourcePath("tree")),
    "durability-failure",
  );
  equal(failed.cause, syncFailure);
  equal(syncs.mock.callCount(), 1);
  equal(closes.mock.callCount(), 1);
  equal(existsSync(path.join(directory, "tree")), false);
});

test("同步成功之后关闭失败报 durability-failure：树已删除、父目录已同步，cause 是关闭失败", async (t) => {
  const { root, directory } = await fixture(t);
  const closeFailure = Object.assign(new Error("injected close failure"), { code: "EIO" });
  const syncs = t.mock.method(RootedResourceParentHandle.prototype, "sync");
  const closes = observeParentClose(t, closeFailure);
  const failed = await expectError(
    () => removeRootedDirectoryTree(root, parsePortableResourcePath("tree")),
    "durability-failure",
  );
  equal(failed.cause, closeFailure);
  // 消息说出发生了什么：树已删除，父目录同步或关闭失败，而不是只说"无法同步"。
  ok(failed.message.includes("removed"), failed.message);
  ok(failed.message.includes("closed"), failed.message);
  equal(syncs.mock.callCount(), 1);
  equal(closes.mock.callCount(), 1);
  equal(existsSync(path.join(directory, "tree")), false);
});

test("同步失败且关闭也失败：句柄恰好关闭一次，调用方收到第一个错误（同步失败）", async (t) => {
  const { root } = await fixture(t);
  const syncFailure = Object.assign(new Error("injected sync failure"), { code: "EIO" });
  const closeFailure = Object.assign(new Error("injected close failure"), { code: "EBADF" });
  t.mock.method(RootedResourceParentHandle.prototype, "sync", async () => {
    throw syncFailure;
  });
  const closes = observeParentClose(t, closeFailure);
  const failed = await expectError(
    () => removeRootedDirectoryTree(root, parsePortableResourcePath("tree")),
    "durability-failure",
  );
  equal(failed.cause, syncFailure);
  equal(closes.mock.callCount(), 1);
});

test("删除失败且关闭也失败：零次同步，句柄恰好关闭一次，调用方收到第一个错误（removal-failure）", async (t) => {
  const { root, directory } = await fixture(t);
  const removalFailure = Object.assign(new Error("injected removal failure"), { code: "EIO" });
  const closeFailure = Object.assign(new Error("injected close failure"), { code: "EBADF" });
  t.mock.method(filesystemMutation, "removeTree", async () => {
    throw removalFailure;
  });
  const syncs = t.mock.method(RootedResourceParentHandle.prototype, "sync");
  const closes = observeParentClose(t, closeFailure);
  const failed = await expectError(
    () => removeRootedDirectoryTree(root, parsePortableResourcePath("tree")),
    "removal-failure",
  );
  equal(failed.cause, removalFailure);
  equal(syncs.mock.callCount(), 0);
  equal(closes.mock.callCount(), 1);
  ok(existsSync(path.join(directory, "tree", "c.txt")));
});

test("none 根：照常删除并经父目录句柄收尾，同步按根的持久化级别跳过", async (t) => {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-tree-removal-none-")));
  mkdirSync(path.join(base, "tree", "a"), { recursive: true });
  const root = await RootedDirectory.open(base, "$root", { durability: "none" });
  t.after(async () => {
    await root.close();
    rmSync(base, { recursive: true, force: true });
  });
  const counted = await countFsyncs(() =>
    removeRootedDirectoryTree(root, parsePortableResourcePath("tree")),
  );
  equal(counted.result, "removed");
  equal(counted.syncCount, 0);
  equal(existsSync(path.join(base, "tree")), false);
});
