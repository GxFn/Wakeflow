import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { TestContext } from "node:test";

import { executeRequirementPublicationRequest } from "../../src/capabilities/requirement/service.js";
import { parseWakeflowConfig } from "../../src/configuration/wakeflow-config.js";
import { executeCodexWakeflowMaintenance } from "../../src/entrypoints/codex-wakeflow-maintenance.js";
import { createMinimalWakeflowFreshConfigSelection } from "../configuration/wakeflow-fresh-config-selection.fixture.js";
import {
  FIXTURE_LANDING_MARKDOWN,
  FIXTURE_REQUIREMENT_MARKDOWN,
} from "../governance/ledger/requirement-package.fixture.js";
import { createPreparedWorkspaceStore } from "./prepared-workspace.js";

/**
 * 快照扫点用的一次性工作区：经公共维护入口 fresh-initialize 的工作区（账本根在工作区里的 `Ledger`，
 * 设计面的草稿目录已建好），以及在它之上已经发布了一份需求包的工作区。基线每个测试进程只建一次，
 * 每个场景复制一份（`prepared-workspace.ts`）。
 */

export interface SnapshotSweepFreshWorkspace {
  readonly root: string;
  readonly designSurfaceId: string;
  readonly designWindowId: string;
}

interface FreshFacts {
  readonly designSurfaceId: string;
  readonly designRelativePath: string;
  readonly designWindowId: string;
}

const freshStore = createPreparedWorkspaceStore<undefined, Readonly<FreshFacts>>({
  prefix: "wakeflow-snapshot-sweep-fresh-",
  keyOf: () => "fresh",
  build: async (fixtureRoot) => {
    const initialized = spawnSync("git", ["init", "--quiet"], {
      cwd: fixtureRoot,
      encoding: "utf8",
      shell: false,
    });
    if (initialized.status !== 0) throw new Error("Cannot initialize fixture Git.");
    const selection = createMinimalWakeflowFreshConfigSelection();
    (selection.storage as Record<string, unknown>).ledgerRoot = "Ledger";
    const request = { root: fixtureRoot, action: "fresh-initialize", request: { selection } };
    const preview = await executeCodexWakeflowMaintenance({ ...request, mode: "preview" });
    if (preview.mode !== "preview" || preview.planDigest === null)
      throw new Error("Expected a ready Fresh plan.");
    await executeCodexWakeflowMaintenance({
      ...request,
      mode: "apply",
      planDigest: preview.planDigest,
    });
    const config = parseWakeflowConfig(
      JSON.parse(readFileSync(path.join(fixtureRoot, "wakeflow.config.json"), "utf8")),
    );
    const design = config.topology.supportSurfaces.find(
      (surface) => surface.capability === "design",
    );
    const designWindow = config.topology.windows.find((window) => window.role === "design");
    if (design === undefined || designWindow === undefined)
      throw new Error("Fresh config lacks a design surface.");
    const drafts = path.join(fixtureRoot, design.path, "drafts");
    mkdirSync(drafts, { recursive: true });
    writeFileSync(path.join(drafts, "requirement.md"), FIXTURE_REQUIREMENT_MARKDOWN, {
      mode: 0o644,
    });
    writeFileSync(path.join(drafts, "landing.md"), FIXTURE_LANDING_MARKDOWN, { mode: 0o644 });
    return Object.freeze({
      designSurfaceId: design.surfaceId,
      designRelativePath: design.path,
      designWindowId: designWindow.windowId,
    });
  },
});

/** 一份已初始化、草稿已写好的工作区副本。 */
export async function freshSnapshotSweepWorkspace(
  t: TestContext,
): Promise<SnapshotSweepFreshWorkspace> {
  const prepared = await freshStore.materialize(undefined);
  t.after(() => rmSync(prepared.fixtureRoot, { recursive: true, force: true }));
  return Object.freeze({
    root: realpathSync(prepared.fixtureRoot),
    designSurfaceId: prepared.facts.designSurfaceId,
    designWindowId: prepared.facts.designWindowId,
  });
}

/** 确认时刻取现在之前一分钟：子进程用真实时钟。 */
export function snapshotSweepConfirmedAt(): string {
  return new Date(Date.now() - 60_000).toISOString();
}

/** 发布请求里的需求包（不含模式与摘要）。 */
export function snapshotSweepPackage(
  workspace: Readonly<SnapshotSweepFreshWorkspace>,
  confirmedAt: string,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    designSurfaceId: workspace.designSurfaceId,
    title: "快照扫点需求",
    demandType: "requirement",
    priority: "P1",
    originWindowId: workspace.designWindowId,
    testingDecision: { mode: "controller-only", summary: "聚焦测试加场景验收。" },
    requirementPath: "drafts/requirement.md",
    landingPath: "drafts/landing.md",
    confirmation: { confirmedAt },
  });
}

/** 在一份新副本上经切片发布需求包，返回副本与需求包 id。 */
export async function publishedSnapshotSweepWorkspace(
  t: TestContext,
): Promise<Readonly<{ workspace: SnapshotSweepFreshWorkspace; requirementId: string }>> {
  const workspace = await freshSnapshotSweepWorkspace(t);
  const request = {
    root: workspace.root,
    mode: "preview",
    action: "publish",
    package: snapshotSweepPackage(workspace, snapshotSweepConfirmedAt()),
  };
  const ready = await executeRequirementPublicationRequest(request);
  if (ready.kind !== "WakeflowRequirementPublicationPreview" || ready.planDigest === null)
    throw new Error("Expected a ready publication preview.");
  const applied = await executeRequirementPublicationRequest({
    ...request,
    mode: "apply",
    planDigest: ready.planDigest,
  });
  if (applied.kind !== "WakeflowRequirementPublicationMutation")
    throw new Error("Expected a publication.");
  return Object.freeze({ workspace, requirementId: applied.package.requirementId });
}
