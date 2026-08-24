import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadWakeflowConfigV3Snapshot } from "../core/scripts/lib/wakeflow-config-v3-snapshot.mjs";
import { inspectWakeflowMigrationInventory } from "../core/scripts/lib/wakeflow-migration-inventory.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const legacyConfigFixture = path.join(
  repositoryRoot,
  "test/fixtures/legacy-origins/codex-0.1.2-58eb3bcf/static/shared-setup/WakeflowFixture/workspace.config.json",
);

test("normal config authority no longer ships the legacy loader", () => {
  for (const root of [
    "core",
    "plugins/codex-wakeflow",
    "plugins/claude-code-wakeflow",
  ]) {
    assert.equal(
      existsSync(path.join(repositoryRoot, root, "scripts/lib/wakeflow-config.mjs")),
      false,
      root,
    );
  }
});

test("a legacy config filename is invisible to normal v3 loading and visible to explicit migration", (t) => {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-config-name-"));
  t.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  const legacyBytes = readFileSync(legacyConfigFixture);
  writeFileSync(path.join(workspaceRoot, "workspace.config.json"), legacyBytes, { mode: 0o600 });
  const before = readdirSync(workspaceRoot).sort();

  assert.throws(
    () => loadWakeflowConfigV3Snapshot({ workspaceRoot }),
    (error) => error?.code === "wakeflow-config-v3-snapshot-source",
  );
  assert.equal(existsSync(path.join(workspaceRoot, "wakeflow.config.json")), false);

  const inventory = inspectWakeflowMigrationInventory({ workspaceRoot });
  assert.ok(inventory.sources.some((source) => source.path === "workspace.config.json"));
  assert.ok(inventory.configSources.some((source) => (
    source.classification.artifact.kind === "wakeflow-config-flat-v1"
  )));
  assert.deepEqual(readdirSync(workspaceRoot).sort(), before);
});
