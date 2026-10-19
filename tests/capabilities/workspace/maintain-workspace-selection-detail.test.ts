import { equal, rejects } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import { executeCodexWakeflowMaintenance } from "../../../src/entrypoints/codex-wakeflow-maintenance.js";
import { isWakeflowError } from "../../../src/kernel/error.js";
import { createMinimalWakeflowFreshConfigSelection } from "../../configuration/wakeflow-fresh-config-selection.fixture.js";

/**
 * §13.181 F-L1-6：fresh-initialize 的 selection 被拒时，公共错误要点名位置与规则（`details.at`、
 * `details.selection`），Agent 不必猜也不必读实现。现场第一次 L1 的 Controller 正是卡在"三次预览都只回
 * `$request.request.selection`、没有 details"。
 */

function workspace(t: TestContext): string {
  const parent = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-selection-detail-")));
  const root = path.join(parent, "workspace");
  mkdirSync(root, { mode: 0o755 });
  mkdirSync(path.join(parent, "ProductA"), { mode: 0o755 });
  const initialized = spawnSync("git", ["init", "--quiet"], {
    cwd: root,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (initialized.status !== 0) throw new Error("Cannot initialize fixture Git.");
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  return root;
}

function refusal(
  reason: "schema" | "selection",
  expected: Readonly<Record<string, string>>,
  path = "$request.request.selection",
) {
  return (error: unknown): boolean => {
    if (!isWakeflowError(error)) return false;
    equal(error.code, "invalid-request");
    equal(error.reason, reason);
    equal(error.path, path);
    for (const [key, value] of Object.entries(expected)) equal(error.details?.[key], value);
    return true;
  };
}

test("a refused fresh selection names the failing part and rule in details（§13.181 F-L1-6）", async (t) => {
  const root = workspace(t);
  const preview = (selection: unknown) =>
    executeCodexWakeflowMaintenance({
      root,
      action: "fresh-initialize",
      mode: "preview",
      request: { selection },
    });
  // 顶层少了 storage：请求 Schema 先于编译器拒绝，details.schema 点名缺的属性。
  const { storage: _storage, ...withoutStorage } = createMinimalWakeflowFreshConfigSelection();
  // Schema 层的路径沿用 Ajv 的斜杠形式（`$request/request/selection`），编译器层用点号；两者并存是既有约定。
  await rejects(
    preview(withoutStorage),
    refusal("schema", { schema: "required:storage" }, "$request/request/selection"),
  );
  // 窗口指向不存在的仓库键：Schema 放行，编译器以 reference 拒绝，details.at 指到那扇窗口的 root/selectionKey。
  const dangling = createMinimalWakeflowFreshConfigSelection();
  const windows = (dangling.topology as { windows: Record<string, unknown>[] }).windows;
  const product = windows.find((entry) => entry.role === "product") as Record<string, unknown>;
  product.root = { kind: "repository", selectionKey: "missing-repository" };
  await rejects(
    preview(dangling),
    refusal("selection", {
      selection: "reference",
      at: `topology.windows.${windows.indexOf(product)}.root.selectionKey`,
    }),
  );
});
