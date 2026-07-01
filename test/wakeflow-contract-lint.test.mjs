#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Guards H-3 (O-wave): the LLM-facing soft guardrails are soft ONLY in force,
// never in presence. Every state-machine command payload must carry agentNext,
// every controller event must carry forbiddenConclusions + allowedWrites +
// stateRevision, and every durable review artifact (target result, transition
// candidate) must carry forbiddenConclusions. A future output that overrides
// agentNext (as intent alignment does) must keep the field populated.

const pluginRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../plugins/codex-wakeflow");
const stateScript = path.join(pluginRoot, "scripts/wakeflow-state.mjs");

function run(args) {
  const result = spawnSync(process.execPath, [stateScript, ...args], { encoding: "utf8", shell: false });
  assert.equal(result.status, 0, `${args[0]}: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

test("every state-machine payload carries agentNext; every durable artifact carries its guardrails", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-lint-"));
  mkdirSync(root, { recursive: true });
  const payloads = [];

  payloads.push(run(["init", "--root", root, "--demand-key", "LINT-DK", "--title", "Contract Lint", "--write", "--json"]));
  const stateRoot = path.join(root, ".wakeflow-active/current/LINT-DK");
  payloads.push(run([
    "add-task-package", "--root", root, "--state-root", stateRoot,
    "--task-package-id", "tp-a", "--summary", "Lint probe", "--target-window", "RepoA", "--write", "--json",
  ]));
  payloads.push(run([
    "import-target-result", "--root", root, "--state-root", stateRoot,
    "--target-task-id", "tp-a__RepoA", "--target-window", "RepoA", "--status", "completed", "--write", "--json",
  ]));
  const reduced = run(["reduce-results", "--root", root, "--state-root", stateRoot, "--write", "--json"]);
  payloads.push(reduced);
  payloads.push(run([
    "decide-review", "--root", root, "--state-root", stateRoot,
    "--candidate-id", reduced.candidateId, "--decision", "accept", "--reason", "lint fixture", "--write", "--json",
  ]));
  payloads.push(run([
    "complete-demand", "--root", root, "--state-root", stateRoot,
    "--reason", "lint fixture complete", "--evidence-ref", "controller-events.jsonl", "--write", "--json",
  ]));

  for (const payload of payloads) {
    assert.equal(typeof payload.agentNext, "string", `${payload.command} must carry agentNext`);
    assert.ok(payload.agentNext.trim().length > 0, `${payload.command} agentNext must be non-empty`);
  }

  const events = readFileSync(path.join(stateRoot, "controller-events.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.ok(events.length >= 5, "the fixture loop must produce a full event trail");
  for (const event of events) {
    assert.ok(Array.isArray(event.forbiddenConclusions) && event.forbiddenConclusions.length > 0, `event ${event.type} must carry forbiddenConclusions`);
    assert.ok(Array.isArray(event.allowedWrites) && event.allowedWrites.length > 0, `event ${event.type} must carry allowedWrites`);
    assert.ok(Number.isInteger(event.stateRevision) && event.stateRevision >= 1, `event ${event.type} must carry stateRevision`);
  }

  for (const [dir, label] of [["target-results", "target result"], ["transition-candidates", "transition candidate"]]) {
    const files = readdirSync(path.join(stateRoot, dir)).filter((name) => name.endsWith(".json"));
    assert.ok(files.length > 0, `fixture must produce at least one ${label}`);
    for (const file of files) {
      const artifact = JSON.parse(readFileSync(path.join(stateRoot, dir, file), "utf8"));
      assert.ok(
        Array.isArray(artifact.forbiddenConclusions) && artifact.forbiddenConclusions.length > 0,
        `${label} ${file} must carry forbiddenConclusions`,
      );
    }
  }
});
