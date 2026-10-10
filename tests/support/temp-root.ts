import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";

/**
 * 一次性根目录（§13.166）：系统临时目录下 `mkdtemp`，返回 realpath（macOS 的 `/var` 是
 * `/private/var` 的链接，根作用域比较的是规范路径），测试结束时整棵删除。
 */
export function disposableRoot(t: TestContext, prefix: string): string {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
