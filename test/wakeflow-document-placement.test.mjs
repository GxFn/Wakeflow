import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  demandAuthorityPlacementIssue,
  documentDestinationLines,
  documentPlacements,
} from "../plugins/codex-wakeflow/scripts/lib/wakeflow-document-placement.mjs";

test("one document placement registry separates demand authority, workspace history, windows, active state, and runtime", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-placement-"));
  const config = {
    projectLedgerRoot: "records",
    windowLedgerRoot: "records/windows",
    requirementDesignsDir: "records/demands",
    goalStageConfirmationDir: "records/confirmations",
    workspaceRecordMapPath: "records/workspace/map.md",
    workspaceArchiveDir: "records/workspace/archive",
    workspaceCurrentDir: ".wakeflow-active/current",
    repositories: [{ windowName: "App", path: "App" }],
  };
  const placements = documentPlacements({ workspaceRoot: root, config, windowName: "App" });
  assert.equal(placements.requirement.relativePath, "records/demands");
  assert.equal(placements.goalStage.relativePath, "records/confirmations");
  assert.equal(placements.workspaceRecord.relativePath, "records/workspace");
  assert.equal(placements.windowRecord.relativePath, "records/windows/App");
  assert.equal(placements.activeState.relativePath, ".wakeflow-active/current");
  assert.equal(placements.projection.storageClass, "projection");
  assert.equal(placements.localRuntime.relativePath, ".wakeflow-local");
  assert.equal(placements.hostState.relativePath, ".wakeflow-local/wakeflow-delivery/hosts");
  assert.equal(placements.runtimeHandle.storageClass, "handles");
  assert.equal(placements.transport.relativePath, ".wakeflow-local/wakeflow-delivery");
  assert.equal(placements.evidence.relativePath, ".wakeflow-local/wakeflow-delivery/target-results");
  assert.equal(placements.preserved.relativePath, ".wakeflow-local/preserved");

  const lines = documentDestinationLines({ workspaceRoot: root, config, windowName: "App" }).join("\n");
  assert.match(lines, /Demand definitions.*`records\/demands\/`/);
  assert.match(lines, /responsibility-specific.*`records\/windows\/App\/`/);
  assert.match(lines, /do not place demand definitions there/);
});

test("demand-authority placement accepts canonical roots and reports a window-ledger draft without invalidating legacy bytes", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-placement-authority-"));
  const config = {
    projectLedgerRoot: "ledger",
    windowLedgerRoot: "ledger/windows",
    requirementDesignsDir: "ledger/requirements",
    goalStageConfirmationDir: "ledger/confirmations",
    repositories: [],
  };
  mkdirSync(path.join(root, "ledger/requirements/D-1"), { recursive: true });
  writeFileSync(path.join(root, "ledger/requirements/D-1/design.md"), "# Design\n");
  assert.equal(demandAuthorityPlacementIssue({
    workspaceRoot: root,
    config,
    ref: "ledger/requirements/D-1/design.md#goal",
  }), null);
  assert.match(demandAuthorityPlacementIssue({
    workspaceRoot: root,
    config,
    ref: "ledger/windows/App/requirement-delta.md#goal",
  }), /outside the canonical requirement roots/);
});
