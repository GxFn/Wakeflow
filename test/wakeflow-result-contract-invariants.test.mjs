import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as authority from "../core/scripts/lib/wakeflow-target-result-authority.mjs";
import * as artifacts from "../core/scripts/lib/wakeflow-demand-artifact-records.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("TargetResult authority is state-selected and owned by the v3 artifact surface", () => {
  assert.equal(typeof authority.loadTargetResultAuthoritySnapshot, "function");
  assert.equal(typeof authority.buildTargetResultAuthoritySnapshotFromLoaded, "function");
  assert.equal(typeof artifacts.validateTargetResultArtifact, "function");
  assert.equal(typeof artifacts.targetResultArtifactDigest, "undefined");
  assert.equal(typeof artifacts.demandArtifactDigest, "function");
});

test("legacy local result, review, status, and trace writers are absent from every edition", () => {
  const retired = [
    "scripts/lib/wakeflow-legacy-local-result-recording-command.mjs",
    "scripts/lib/wakeflow-result-contract.mjs",
    "scripts/lib/wakeflow-result-recording-commands.mjs",
    "scripts/lib/wakeflow-review-commands.mjs",
    "scripts/lib/wakeflow-state-results.mjs",
    "scripts/lib/wakeflow-trace-spine-command.mjs",
  ];
  for (const root of ["core", "plugins/codex-wakeflow", "plugins/claude-code-wakeflow"]) {
    for (const relativePath of retired) {
      assert.equal(existsSync(path.join(repositoryRoot, root, relativePath)), false, `${root}/${relativePath}`);
    }
  }
});
