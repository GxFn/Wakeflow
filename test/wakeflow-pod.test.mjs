import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as pod from "../core/scripts/lib/wakeflow-pod-service.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Pod lifecycle is owned by the v3 state-first service", () => {
  for (const name of [
    "planPodWindowMaterialization",
    "recordPodMaterializationEvent",
    "recordPodCreationReceipt",
    "recordPodCloseIntent",
    "recordPodCloseReceipt",
    "decommissionClosedPodWindowBinding",
  ]) assert.equal(typeof pod[name], "function", name);
});

test("retired Pod reservation/runtime CLIs are absent and the public facade has no script escape", () => {
  const retired = [
    "scripts/lib/wakeflow-pod-reservations.mjs",
    "scripts/lib/wakeflow-pod-runtime.mjs",
    "scripts/wakeflow-pod.mjs",
  ];
  for (const root of ["core", "plugins/codex-wakeflow", "plugins/claude-code-wakeflow"]) {
    for (const relativePath of retired) {
      assert.equal(existsSync(path.join(repositoryRoot, root, relativePath)), false, `${root}/${relativePath}`);
    }
  }
  for (const artifact of ["plugins/codex-wakeflow", "plugins/claude-code-wakeflow"]) {
    const source = readFileSync(path.join(repositoryRoot, artifact, "lib/wakeflow-mcp-tools.mjs"), "utf8");
    assert.doesNotMatch(source, /script:\s*["']wakeflow-pod["']/u, artifact);
  }
});
