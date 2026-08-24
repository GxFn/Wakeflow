import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as observability from "../core/scripts/lib/wakeflow-observability-v3.mjs";
import * as preservation from "../core/scripts/lib/wakeflow-preservation.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("storage is a read-only projection plus explicit preservation owner", () => {
  assert.equal(typeof observability.projectWakeflowStorageView, "function");
  assert.equal(typeof preservation.inspectLocalPreservationInventory, "function");
  assert.equal(typeof preservation.planLocalPreservation, "function");
  assert.equal(typeof preservation.applyLocalPreservationPlan, "function");
});

test("storage README seeding and Markdown manifest writers are not shipped", () => {
  const retired = [
    "scripts/wakeflow-storage.mjs",
    "scripts/lib/wakeflow-storage-map.mjs",
    "templates/wakeflow-template-bundle.json",
  ];
  for (const root of ["core", "plugins/codex-wakeflow", "plugins/claude-code-wakeflow"]) {
    for (const relativePath of retired) {
      assert.equal(existsSync(path.join(repositoryRoot, root, relativePath)), false, `${root}/${relativePath}`);
    }
  }
});
