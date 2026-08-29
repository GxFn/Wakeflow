import { equal } from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import {
  validateWakeflowConfigRootPlacements,
  WakeflowConfigRootPlacementError,
} from "../../src/configuration/wakeflow-config-root-placement.js";
import { parseWakeflowConfigV3 } from "../../src/configuration/wakeflow-config-v3.js";
import { RootedDirectory } from "../../src/foundation/filesystem/rooted-directory.js";
import { createMinimalWakeflowConfigV3 } from "./wakeflow-config-v3.fixture.js";

async function fixture(t: TestContext): Promise<Readonly<{
  root: RootedDirectory;
  rootPath: string;
}>> {
  const rootPath = mkdtempSync(path.join(
    os.tmpdir(),
    "wakeflow-config-root-placement-",
  ));
  const root = await RootedDirectory.open(rootPath);
  t.after(async () => {
    await root.close();
    rmSync(rootPath, { recursive: true, force: true });
  });
  return Object.freeze({ root, rootPath });
}

function placementModel(overlap = false) {
  const value = createMinimalWakeflowConfigV3();
  const topology = value.topology as {
    repositories: Record<string, unknown>[];
    supportSurfaces: Record<string, unknown>[];
  };
  (value.storage as Record<string, unknown>).ledgerRoot = "Ledger";
  topology.repositories[0]!.path = "Repositories/ProductA";
  topology.supportSurfaces[0]!.path = overlap ? "Shared" : "Support/Design";
  topology.supportSurfaces[1]!.path = overlap
    ? "shared/child"
    : "Support/Test";
  return parseWakeflowConfigV3(value);
}

test("Config root placement records one stable ancestor for missing roots", async (t) => {
  const current = await fixture(t);
  const report = await validateWakeflowConfigRootPlacements(
    current.root,
    placementModel(),
  );

  equal(report.workspaceRoot, current.root.absolutePath);
  equal(report.roots.length, 6);
  equal(report.missingRootKeys.length, 6);
  equal(report.roots.every((entry) => entry.state === "missing"), true);
});

test("Config root placement rejects portable case-folded containment", async (t) => {
  const current = await fixture(t);
  let caught: unknown;
  try {
    await validateWakeflowConfigRootPlacements(
      current.root,
      placementModel(true),
    );
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof WakeflowConfigRootPlacementError, true);
  if (caught instanceof WakeflowConfigRootPlacementError) {
    equal(caught.reason, "lexical-overlap");
  }
});
