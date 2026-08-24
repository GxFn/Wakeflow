import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as layout from "../core/scripts/lib/wakeflow-layout-descriptor.mjs";
import * as inspection from "../core/scripts/lib/wakeflow-local-layout-inspection.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("layout checks are v3 descriptor and diagnostic inspection responsibilities", () => {
  assert.equal(typeof layout.createWakeflowLayoutDescriptor, "function");
  assert.equal(typeof layout.validateWakeflowLayoutPlacements, "function");
  assert.equal(typeof inspection.inspectWakeflowLocalLayout, "function");
  assert.equal(typeof inspection.inspectWakeflowLocalLayoutForMaintenance, "undefined");
});

test("legacy layout, next-work cache, and storage CLIs are absent", () => {
  const retired = [
    "scripts/wakeflow-check-layout.mjs",
    "scripts/wakeflow-next-work.mjs",
    "scripts/wakeflow-storage.mjs",
    "scripts/lib/wakeflow-storage-map.mjs",
  ];
  for (const root of ["core", "plugins/codex-wakeflow", "plugins/claude-code-wakeflow"]) {
    for (const relativePath of retired) {
      assert.equal(existsSync(path.join(repositoryRoot, root, relativePath)), false, `${root}/${relativePath}`);
    }
  }
});
