#!/usr/bin/env node

// H-3 (architecture deep-dive §6.3 / roadmap Phase 3): the LLM-native contract layer —
// agentNext on every command payload, forbiddenConclusions on durable artifacts — is a
// SOFT guardrail for the reading agent. Its EXISTENCE must be pinned by a hard test, or
// a refactor can silently strip the first layer of the defense-in-depth. This lint runs
// one full demand chain and asserts the contract fields at each hop.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runSync } from "../plugins/codex-wakeflow/lib/wakeflow-process.mjs";
import test from "node:test";

const pluginRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../plugins/codex-wakeflow");
const stateScript = path.join(pluginRoot, "scripts/wakeflow-state.mjs");
const deliveryScript = path.join(pluginRoot, "scripts/wakeflow-delivery.mjs");

function run(script, args) {
  return runSync(process.execPath, [script, ...args], { cwd: pluginRoot, encoding: "utf8" });
}

function parseOk(result, label) {
  assert.equal(result.status, 0, `${label}: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

function assertAgentNext(payload, label) {
  assert.equal(typeof payload.agentNext, "string", `${label} payload carries agentNext`);
  assert.ok(payload.agentNext.trim().length > 0, `${label} agentNext is non-empty`);
}

test("H-3: every chain hop carries agentNext; durable artifacts carry forbiddenConclusions", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-llmlint-"));
  mkdirSync(root, { recursive: true });

  const init = parseOk(run(stateScript, ["init", "--root", root, "--demand-key", "LINT-DK", "--title", "Lint", "--write", "--json"]), "init");
  assertAgentNext(init, "init");
  const stateRoot = path.join(root, init.stateRoot);

  const added = parseOk(run(stateScript, [
    "add-task-package", "--root", root, "--state-root", stateRoot,
    "--task-package-id", "tp-l", "--summary", "lint", "--target-window", "WinL",
    "--write", "--json",
  ]), "add-task-package");
  assertAgentNext(added, "add-task-package");

  const prepared = parseOk(run(deliveryScript, [
    "prepare-dispatch-from-state", "--root", root, "--state-root", stateRoot,
    "--target-task-id", "tp-l__WinL", "--write", "--compact", "--json",
  ]), "prepare-dispatch");
  assertAgentNext(prepared, "prepare-dispatch");

  writeFileSync(path.join(stateRoot, "notes.md"), "evidence\n");
  const imported = parseOk(run(stateScript, [
    "import-target-result", "--root", root, "--state-root", stateRoot,
    "--target-task-id", "tp-l__WinL", "--target-window", "WinL", "--status", "completed",
    "--evidence-ref", "notes.md", "--write", "--json",
  ]), "import-target-result");
  assertAgentNext(imported, "import-target-result");

  // Durable artifact: the target result must carry its anti-overreach guardrail.
  const resultsDir = path.join(stateRoot, "target-results");
  const resultFile = readdirSync(resultsDir).find((name) => name.endsWith(".json"));
  const result = JSON.parse(readFileSync(path.join(resultsDir, resultFile), "utf8"));
  assert.ok(Array.isArray(result.forbiddenConclusions) && result.forbiddenConclusions.length > 0,
    "target-result artifact carries forbiddenConclusions");

  const reduced = parseOk(run(stateScript, ["reduce-results", "--root", root, "--state-root", stateRoot, "--write", "--json"]), "reduce-results");
  assertAgentNext(reduced, "reduce-results");

  // Durable artifact: the transition candidate must forbid being read as acceptance.
  const candidatesDir = path.join(stateRoot, "transition-candidates");
  const candidateFile = readdirSync(candidatesDir).find((name) => name.endsWith(".json"));
  const candidate = JSON.parse(readFileSync(path.join(candidatesDir, candidateFile), "utf8"));
  assert.ok(Array.isArray(candidate.forbiddenConclusions), "transition-candidate carries forbiddenConclusions");
  assert.ok(candidate.forbiddenConclusions.includes("transition-candidate-is-acceptance"),
    "candidate forbids being read as acceptance");

  const decided = parseOk(run(stateScript, [
    "decide-review", "--root", root, "--state-root", stateRoot,
    "--candidate-id", candidate.candidateId, "--decision", "accept", "--reason", "lint chain",
    "--write", "--json",
  ]), "decide-review");
  assertAgentNext(decided, "decide-review");
});
