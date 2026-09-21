import { deepEqual, equal } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
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
 * 能力级 given-when-then：managed-block 仓库与 external-owned managed-block 支撑面在
 * fresh apply 时得到托管块（已有文件追加、缺失文件新建），reconcile 零步；删除托管文件
 * 后 reconcile 只重建它；受管区域内的用户改动让 reconcile 阻塞而不是覆盖。
 */

interface Fixture {
  readonly parent: string;
  readonly workspace: string;
  readonly repositoryInstruction: string;
  readonly designInstruction: string;
}

async function fixture(t: TestContext): Promise<Readonly<Fixture>> {
  const parent = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-maintain-external-")));
  const workspace = path.join(parent, "workspace");
  mkdirSync(workspace, { mode: 0o755 });
  mkdirSync(path.join(parent, "ProductA"), { mode: 0o755 });
  mkdirSync(path.join(parent, "ProductDesign"), { mode: 0o755 });
  const initialized = spawnSync("git", ["init", "--quiet"], {
    cwd: workspace,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (initialized.status !== 0) throw new Error("Cannot initialize fixture Git.");
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  return Object.freeze({
    parent,
    workspace,
    repositoryInstruction: path.join(parent, "ProductA", "AGENTS.md"),
    designInstruction: path.join(parent, "ProductDesign", "AGENTS.md"),
  });
}

function selection() {
  const value = createMinimalWakeflowFreshConfigSelection();
  (value.storage as Record<string, unknown>).ledgerRoot = "Ledger";
  const topology = value.topology as {
    repositories: Record<string, unknown>[];
    supportSurfaces: Record<string, unknown>[];
  };
  const repository = topology.repositories[0] as Record<string, unknown>;
  repository.instructionManagement = "managed-block";
  repository.description = "Product source responsibility root.";
  const design = topology.supportSurfaces.find(
    (entry) => entry.selectionKey === "design",
  ) as Record<string, unknown>;
  design.ownership = "external-owned";
  design.path = "../ProductDesign";
  design.instructionManagement = "managed-block";
  return value;
}

function stepKinds(result: { plan?: unknown }): readonly string[] {
  const plan = result.plan as { steps?: readonly { stepKind?: string }[] } | null;
  return (plan?.steps ?? []).map((step) => step.stepKind ?? "<host-step>");
}

const OWNER_TEXT = "# Product A\n\nLocal engineering rules stay exactly as written.\n";
const REPOSITORY_MARKER =
  "<!-- wakeflow:managed-content:v1:begin component=repository-instruction owner=host-instruction-integration";
const SURFACE_MARKER =
  "<!-- wakeflow:managed-content:v1:begin component=support-instruction owner=host-instruction-integration";

test("maintain_workspace writes managed blocks into managed-block repositories and external-owned surfaces, then reconciles them", async (t) => {
  const roots = await fixture(t);
  writeFileSync(roots.repositoryInstruction, OWNER_TEXT, { mode: 0o644 });
  const fresh = {
    root: roots.workspace,
    action: "fresh-initialize",
    request: { selection: selection() },
  } as const;

  const preview = await executeCodexWakeflowMaintenance({ ...fresh, mode: "preview" });
  equal(preview.status, "ready");
  const kinds = stepKinds(preview);
  equal(kinds.filter((kind) => kind === "recompose-external-instruction").length, 2);
  equal(
    kinds.indexOf("recompose-program-instruction") <
      kinds.indexOf("recompose-external-instruction"),
    true,
  );
  equal(
    kinds.lastIndexOf("recompose-external-instruction") < kinds.indexOf("publish-support-memory"),
    true,
  );
  equal(readFileSync(roots.repositoryInstruction, "utf8"), OWNER_TEXT, "preview must not write");
  equal(existsSync(roots.designInstruction), false, "preview must not write");
  equal(JSON.stringify(preview).includes(roots.parent), false);

  const applied = await executeCodexWakeflowMaintenance({
    ...fresh,
    mode: "apply",
    planDigest: preview.planDigest as string,
  });
  equal(applied.status, "completed");
  equal(JSON.stringify(applied).includes(roots.parent), false);
  const repositoryText = readFileSync(roots.repositoryInstruction, "utf8");
  equal(repositoryText.startsWith(OWNER_TEXT), true);
  equal(repositoryText.includes(REPOSITORY_MARKER), true);
  equal(repositoryText.includes("## Wakeflow Repository Instructions"), true);
  equal(repositoryText.includes('`"Product source responsibility root."`'), true);
  equal(statSync(roots.repositoryInstruction).mode & 0o777, 0o644);
  const designText = readFileSync(roots.designInstruction, "utf8");
  equal(designText.startsWith(SURFACE_MARKER), true);
  equal(designText.includes("## Wakeflow Design Support Instructions"), true);
  equal(statSync(roots.designInstruction).mode & 0o777, 0o644);
  // external-owned 面不得得到 Wakeflow scaffold；Wakeflow 管理的 Test 面照常物化。
  equal(existsSync(path.join(roots.parent, "ProductDesign", "drafts")), false);
  equal(existsSync(path.join(roots.workspace, "Test", "AGENTS.md")), true);

  const reconcile = await executeCodexWakeflowMaintenance({
    root: roots.workspace,
    action: "reconcile",
    mode: "preview",
    request: {},
  });
  equal(reconcile.status, "ready");
  deepEqual(stepKinds(reconcile), []);
  const reconciled = await executeCodexWakeflowMaintenance({
    root: roots.workspace,
    action: "reconcile",
    mode: "apply",
    request: {},
    planDigest: reconcile.planDigest as string,
  });
  equal(reconciled.status, "no-op");

  // 托管文件被删除：reconcile 只重建这一个托管块。
  rmSync(roots.designInstruction);
  const repair = await executeCodexWakeflowMaintenance({
    root: roots.workspace,
    action: "reconcile",
    mode: "preview",
    request: {},
  });
  equal(repair.status, "ready");
  deepEqual(stepKinds(repair), ["recompose-external-instruction"]);
  const repaired = await executeCodexWakeflowMaintenance({
    root: roots.workspace,
    action: "reconcile",
    mode: "apply",
    request: {},
    planDigest: repair.planDigest as string,
  });
  equal(repaired.status, "completed");
  equal(readFileSync(roots.designInstruction, "utf8"), designText);
  equal(readFileSync(roots.repositoryInstruction, "utf8"), repositoryText);

  // 受管区域内的用户改动破坏了 envelope 摘要：阻塞，不覆盖。
  const tampered = repositoryText.replace(
    "### Safety boundary",
    "### Safety boundary (edited by the owner)",
  );
  writeFileSync(roots.repositoryInstruction, tampered);
  const blocked = await executeCodexWakeflowMaintenance({
    root: roots.workspace,
    action: "reconcile",
    mode: "preview",
    request: {},
  });
  equal(blocked.status, "blocked");
  deepEqual([...blocked.next.blockers], ["external-instruction-envelope"]);
  equal(readFileSync(roots.repositoryInstruction, "utf8"), tampered);
});

test("maintain_workspace blocks a managed-block repository whose root does not exist yet", async (t) => {
  const roots = await fixture(t);
  rmSync(path.join(roots.parent, "ProductA"), { recursive: true, force: true });
  const preview = await executeCodexWakeflowMaintenance({
    root: roots.workspace,
    action: "fresh-initialize",
    mode: "preview",
    request: { selection: selection() },
  });
  equal(preview.status, "blocked");
  equal(preview.next.blockers.includes("external-instruction-root-missing"), true);
  equal(existsSync(roots.designInstruction), false);
});
