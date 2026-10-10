import { equal, ok } from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import {
  RootedDirectoryTreeRemovalError,
  removeRootedDirectoryTree,
} from "../../../src/foundation/filesystem/rooted-directory-tree-removal.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";

async function fixture(t: TestContext): Promise<{ root: RootedDirectory; directory: string; outside: string }> {
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
  const root = await RootedDirectory.open(directory);
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
  if (!(caught instanceof RootedDirectoryTreeRemovalError)) throw new Error("Expected RootedDirectoryTreeRemovalError.");
  equal(caught.code, "wakeflow-rooted-directory-tree-removal");
  equal(caught.reason, reason);
  return caught;
}

test("删除根内一整棵目录树；缺失按选项报 not-found 或返回 absent；文件与链接不是目录树", async (t) => {
  const { root, directory, outside } = await fixture(t);
  equal(await removeRootedDirectoryTree(root, parsePortableResourcePath("tree")), "removed");
  equal(existsSync(path.join(directory, "tree")), false);
  await expectError(() => removeRootedDirectoryTree(root, parsePortableResourcePath("tree")), "not-found");
  equal(await removeRootedDirectoryTree(root, parsePortableResourcePath("tree"), { missing: "ignore" }), "absent");
  await expectError(() => removeRootedDirectoryTree(root, parsePortableResourcePath("file.txt")), "not-directory");
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
    () => removeRootedDirectoryTree(root, parsePortableResourcePath("file.txt"), { signal: controller.signal }),
    "aborted",
  );
  await expectError(() => removeRootedDirectoryTree(root, parsePortableResourcePath("x"), { missing: "maybe" as never }), "input");
});
