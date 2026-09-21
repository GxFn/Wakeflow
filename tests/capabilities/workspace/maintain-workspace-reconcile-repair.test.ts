import { deepEqual, equal } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { executeCodexWakeflowMaintenance } from "../../../src/entrypoints/codex-wakeflow-maintenance.js";
import { createMinimalWakeflowFreshConfigSelection } from "../../configuration/wakeflow-fresh-config-selection.fixture.js";

/**
 * 能力级 given-when-then（能力卡 1 §1.4 自动修复）：fresh 之后删掉 Wakeflow 拥有的静态目录
 * ——支撑面 scaffold、宿主 capability 目录、活动布局与看板、ledger 固定容器——reconcile 只补齐
 * 它们，apply 后再次 reconcile 零步；scaffold 位置被文件占用时只报告不覆盖。
 */

async function fixture(t: TestContext): Promise<string> {
  const absolutePath = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "wakeflow-maintain-repair-")),
  );
  const initialized = spawnSync("git", ["init", "--quiet"], {
    cwd: absolutePath,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (initialized.status !== 0) throw new Error("Cannot initialize fixture Git.");
  t.after(() => rmSync(absolutePath, { recursive: true, force: true }));
  return absolutePath;
}

function selection() {
  const value = createMinimalWakeflowFreshConfigSelection();
  (value.storage as Record<string, unknown>).ledgerRoot = "Ledger";
  return value;
}

function stepKinds(result: { plan?: unknown }): readonly string[] {
  const plan = result.plan as { steps?: readonly { stepKind?: string }[] } | null;
  return (plan?.steps ?? []).map((step) => step.stepKind ?? "<host-step>");
}

async function reconcilePreview(root: string) {
  return executeCodexWakeflowMaintenance({
    root,
    action: "reconcile",
    mode: "preview",
    request: {},
  });
}

test("maintain_workspace reconcile repairs missing Wakeflow-owned static directories and stays no-op afterwards", async (t) => {
  const root = await fixture(t);
  const fresh = { root, action: "fresh-initialize", request: { selection: selection() } } as const;
  const preview = await executeCodexWakeflowMaintenance({ ...fresh, mode: "preview" });
  equal(preview.status, "ready");
  const applied = await executeCodexWakeflowMaintenance({
    ...fresh,
    mode: "apply",
    planDigest: preview.planDigest as string,
  });
  equal(applied.status, "completed");

  const drafts = path.join(root, "Design", "drafts");
  const harnesses = path.join(root, "Test", "harnesses");
  const fixtures = path.join(root, "Test", "fixtures");
  const leases = path.join(
    root,
    ".wakeflow-local",
    "runtime",
    "hosts",
    "codex",
    "operations",
    "keep-live",
    "leases",
  );
  const boardIndex = path.join(root, ".wakeflow-active", "current", "board", "index.md");
  const archives = path.join(root, "Ledger", "archives");
  for (const directory of [drafts, harnesses, fixtures, leases, archives]) {
    equal(statSync(directory).isDirectory(), true, `fresh must create ${path.basename(directory)}`);
  }
  equal(existsSync(boardIndex), true);
  equal(statSync(drafts).mode & 0o777, 0o755);
  // Wakeflow 管理的支撑面根各有一份只含宿主本机设置路径的 .gitignore 托管块。
  const designIgnore = path.join(root, "Design", ".gitignore");
  const designIgnoreText = readFileSync(designIgnore, "utf8");
  equal(
    designIgnoreText.includes("component=support-ignore owner=workspace-ignore-integration"),
    true,
  );
  equal(designIgnoreText.includes("/.claude/settings.local.json"), true);
  equal(existsSync(path.join(root, "Test", ".gitignore")), true);

  // 健康工作区：零步。
  const healthy = await reconcilePreview(root);
  equal(healthy.status, "ready");
  deepEqual(stepKinds(healthy), []);

  rmSync(drafts, { recursive: true });
  rmSync(harnesses, { recursive: true });
  rmSync(leases, { recursive: true });
  rmSync(path.join(root, ".wakeflow-active", "current"), { recursive: true });
  rmSync(archives, { recursive: true });
  rmSync(designIgnore);
  const repair = await reconcilePreview(root);
  equal(repair.status, "ready");
  deepEqual([...repair.next.blockers], []);
  deepEqual(stepKinds(repair), [
    "materialize-active-layout",
    "initialize-requirement-board",
    "materialize-ledger-layout",
    "materialize-host-capability-layout",
    "materialize-support-root",
    "materialize-support-root",
    "recompose-support-gitignore",
  ]);
  equal(existsSync(drafts), false, "preview must not write");
  equal(existsSync(designIgnore), false, "preview must not write");

  const repaired = await executeCodexWakeflowMaintenance({
    root,
    action: "reconcile",
    mode: "apply",
    request: {},
    planDigest: repair.planDigest as string,
  });
  equal(repaired.status, "completed");
  for (const directory of [drafts, harnesses, fixtures, leases, archives]) {
    equal(
      statSync(directory).isDirectory(),
      true,
      `reconcile must restore ${path.basename(directory)}`,
    );
    equal(statSync(directory).mode & 0o777, directory === leases ? 0o700 : 0o755);
  }
  equal(existsSync(boardIndex), true);
  equal(readFileSync(designIgnore, "utf8"), designIgnoreText);
  equal(
    readFileSync(path.join(root, "wakeflow.config.json"), "utf8").includes('"programId"'),
    true,
  );

  const again = await reconcilePreview(root);
  equal(again.status, "ready");
  deepEqual(stepKinds(again), []);
  const noop = await executeCodexWakeflowMaintenance({
    root,
    action: "reconcile",
    mode: "apply",
    request: {},
    planDigest: again.planDigest as string,
  });
  equal(noop.status, "no-op");

  // 支撑面 .gitignore 托管块被手改：只报告，不覆盖。
  writeFileSync(
    designIgnore,
    designIgnoreText.replace(
      "/.claude/settings.local.json",
      "/.claude/settings.local.json\n/edited",
    ),
  );
  const tampered = await reconcilePreview(root);
  equal(tampered.status, "blocked");
  equal(tampered.next.blockers.includes("support-gitignore-envelope"), true);
  writeFileSync(designIgnore, designIgnoreText);

  // scaffold 位置被普通文件占用：只报告，不覆盖。
  rmSync(drafts, { recursive: true });
  writeFileSync(drafts, "not a directory\n");
  const conflict = await reconcilePreview(root);
  equal(conflict.status, "blocked");
  equal(conflict.next.blockers.includes("support-root-conflict"), true);
  equal(readFileSync(drafts, "utf8"), "not a directory\n");
});

test("maintain_workspace reconcile rebuilds a missing ledger root but only reports a missing host runtime root", async (t) => {
  const root = await fixture(t);
  const fresh = { root, action: "fresh-initialize", request: { selection: selection() } } as const;
  const preview = await executeCodexWakeflowMaintenance({ ...fresh, mode: "preview" });
  await executeCodexWakeflowMaintenance({
    ...fresh,
    mode: "apply",
    planDigest: preview.planDigest as string,
  });

  rmSync(path.join(root, "Ledger"), { recursive: true });
  const missingLedger = await reconcilePreview(root);
  equal(missingLedger.status, "ready");
  deepEqual(stepKinds(missingLedger), ["materialize-ledger-layout"]);
  const rebuilt = await executeCodexWakeflowMaintenance({
    root,
    action: "reconcile",
    mode: "apply",
    request: {},
    planDigest: missingLedger.planDigest as string,
  });
  equal(rebuilt.status, "completed");
  for (const container of ["requirements", "transactions", "archives"]) {
    equal(statSync(path.join(root, "Ledger", container)).isDirectory(), true);
  }

  rmSync(path.join(root, ".wakeflow-local", "runtime", "hosts"), { recursive: true });
  const missingRuntime = await reconcilePreview(root);
  equal(missingRuntime.status, "blocked");
  equal(missingRuntime.next.blockers.includes("window-runtime-missing"), true);
  equal(existsSync(path.join(root, ".wakeflow-local", "runtime", "hosts")), false);
});
