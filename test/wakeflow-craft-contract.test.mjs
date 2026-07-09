#!/usr/bin/env node

// W-Target (execution-craft) P2: the evidence contract (B) is additive on the
// extensible task-package / target-result envelopes. These tests pin the
// round-trip AND the "absent = zero behavior change" invariant, plus fail-closed
// on malformed JSON. The reduce/review gate itself is exercised separately.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runSync } from "../plugins/codex-wakeflow/lib/wakeflow-process.mjs";
import test from "node:test";

const workspaceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../plugins/codex-wakeflow");
const script = path.join(workspaceRoot, "scripts/wakeflow-state.mjs");

function makeRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-craft-"));
  mkdirSync(root, { recursive: true });
  return root;
}

function run(args) {
  return runSync(process.execPath, [script, ...args], { cwd: workspaceRoot, encoding: "utf8" });
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function initRoot(demandKey) {
  const root = makeRoot();
  const init = JSON.parse(run(["init", "--root", root, "--demand-key", demandKey, "--title", demandKey, "--write", "--json"]).stdout);
  return { root, stateRootRel: init.stateRoot };
}

// Make a path-like evidence ref resolve on disk so the existing evidence-repair gate
// passes and the craft gate is what these tests actually exercise.
function writeEvidence(root, stateRootRel, ref, content = "ok\n") {
  const file = path.join(root, stateRootRel, ref);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

test("W-Target: add-task-package round-trips evidenceContract; absent leaves no field", () => {
  const { root, stateRootRel } = initRoot("CRAFT-FIXTURE");
  const contract = {
    version: 1,
    required: [
      { kind: "tests", verify: "controller-rerun" },
      { kind: "change-scope", verify: "diff-within-designIntent" },
    ],
    advisory: [{ kind: "self-review" }, { kind: "test-first" }],
  };
  const add = run([
    "add-task-package", "--root", root, "--state-root", stateRootRel,
    "--task-package-id", "CRAFT-PKG", "--summary", "pkg",
    "--evidence-contract", JSON.stringify(contract),
    "--target-window", "WinA", "--target-task-id", "CRAFT-TASK", "--target-summary", "do",
    "--write", "--json",
  ]);
  assert.equal(add.status, 0, add.stderr || add.stdout);
  const pkg = readJson(path.join(root, stateRootRel, "task-packages", "craft-pkg.json"));
  assert.deepEqual(pkg.evidenceContract, contract, "evidenceContract round-trips into the task package");

  const add2 = run([
    "add-task-package", "--root", root, "--state-root", stateRootRel,
    "--task-package-id", "PLAIN-PKG", "--summary", "pkg2",
    "--target-window", "WinB", "--target-task-id", "PLAIN-TASK", "--target-summary", "do",
    "--write", "--json",
  ]);
  assert.equal(add2.status, 0, add2.stderr || add2.stdout);
  const pkg2 = readJson(path.join(root, stateRootRel, "task-packages", "plain-pkg.json"));
  assert.equal("evidenceContract" in pkg2, false, "absent contract leaves no evidenceContract field (zero behavior change)");
});

test("W-Target: import-target-result round-trips craftEvidence; absent leaves no field", () => {
  const { root, stateRootRel } = initRoot("CE-FIXTURE");
  run([
    "add-task-package", "--root", root, "--state-root", stateRootRel,
    "--task-package-id", "CE-PKG", "--summary", "pkg",
    "--target-window", "WinA", "--target-task-id", "CE-TASK", "--target-summary", "do",
    "--write", "--json",
  ]);
  const craft = [
    { kind: "tests", ref: "src/foo.test.ts", verify: "controller-rerun" },
    { kind: "self-review", value: "no blockers" },
  ];
  const imp = run([
    "import-target-result", "--root", root, "--state-root", stateRootRel,
    "--target-task-id", "CE-TASK", "--target-window", "WinA", "--status", "completed",
    "--evidence-ref", "src/foo.ts", "--craft-evidence", JSON.stringify(craft),
    "--write", "--json",
  ]);
  assert.equal(imp.status, 0, imp.stderr || imp.stdout);
  const resultId = JSON.parse(imp.stdout).resultId;
  const result = readJson(path.join(root, stateRootRel, "target-results", `${resultId}.json`));
  assert.deepEqual(result.craftEvidence, craft, "craftEvidence round-trips into the target result");

  const { root: root2, stateRootRel: rel2 } = initRoot("CE-ABSENT");
  run([
    "add-task-package", "--root", root2, "--state-root", rel2,
    "--task-package-id", "CE2-PKG", "--summary", "pkg",
    "--target-window", "WinA", "--target-task-id", "CE2-TASK", "--target-summary", "do",
    "--write", "--json",
  ]);
  const imp2 = run([
    "import-target-result", "--root", root2, "--state-root", rel2,
    "--target-task-id", "CE2-TASK", "--target-window", "WinA", "--status", "completed",
    "--evidence-ref", "src/foo.ts", "--write", "--json",
  ]);
  assert.equal(imp2.status, 0, imp2.stderr || imp2.stdout);
  const resultId2 = JSON.parse(imp2.stdout).resultId;
  const result2 = readJson(path.join(root2, rel2, "target-results", `${resultId2}.json`));
  assert.equal("craftEvidence" in result2, false, "absent craftEvidence leaves no field (zero behavior change)");
});

test("W-Target: malformed --evidence-contract JSON fails closed", () => {
  const { root, stateRootRel } = initRoot("CRAFT-BAD");
  const bad = run([
    "add-task-package", "--root", root, "--state-root", stateRootRel,
    "--task-package-id", "BAD-PKG", "--summary", "pkg",
    "--evidence-contract", "{not valid json",
    "--target-window", "WinA", "--target-task-id", "BAD-TASK", "--target-summary", "do",
    "--write", "--json",
  ]);
  assert.notEqual(bad.status, 0, "malformed --evidence-contract must fail closed, not silently drop");
});

test("W-Target: a mis-SHAPED contract fails intake instead of silently disabling the gate", () => {
  const { root, stateRootRel } = initRoot("CRAFT-SHAPE");
  // `required` as an OBJECT (not array): before the shape validator, Array.isArray
  // at reduce time turned this into "no required kinds" — a fail-open on the only
  // hard craft gate. Intake must reject it.
  const misShaped = run([
    "add-task-package", "--root", root, "--state-root", stateRootRel,
    "--task-package-id", "SHAPE-PKG", "--summary", "pkg",
    "--evidence-contract", JSON.stringify({ version: 1, required: { kind: "tests" } }),
    "--target-window", "WinA", "--target-task-id", "SHAPE-TASK", "--target-summary", "do",
    "--write", "--json",
  ]);
  assert.notEqual(misShaped.status, 0, "object-shaped required must fail intake (fail-closed)");
  assert.match(misShaped.stdout, /must be an ARRAY/i);

  const badEntry = run([
    "add-task-package", "--root", root, "--state-root", stateRootRel,
    "--task-package-id", "SHAPE-PKG2", "--summary", "pkg",
    "--evidence-contract", JSON.stringify({ required: [{ verify: "controller-rerun" }] }),
    "--target-window", "WinA", "--target-task-id", "SHAPE-TASK2", "--target-summary", "do",
    "--write", "--json",
  ]);
  assert.notEqual(badEntry.status, 0, "a required entry without a string kind must fail intake");
});

test("W-Target: junk craft-evidence entries fail import instead of landing in the durable result", () => {
  const { root, stateRootRel } = initRoot("CE-JUNK");
  run([
    "add-task-package", "--root", root, "--state-root", stateRootRel,
    "--task-package-id", "JUNK-PKG", "--summary", "pkg",
    "--target-window", "WinA", "--target-task-id", "JUNK-TASK", "--target-summary", "do",
    "--write", "--json",
  ]);
  const junk = run([
    "import-target-result", "--root", root, "--state-root", stateRootRel,
    "--target-task-id", "JUNK-TASK", "--target-window", "WinA", "--status", "completed",
    "--evidence-ref", "notes.md", "--craft-evidence", JSON.stringify(["tests", { ref: "x" }]),
    "--write", "--json",
  ]);
  assert.notEqual(junk.status, 0, "entries without an object shape + string kind must fail import");
});

const GATE_CONTRACT = {
  version: 1,
  required: [
    { kind: "tests", verify: "self-attested" },
    { kind: "change-scope", verify: "diff-within-designIntent" },
  ],
};

function seedContractedTask(demandKey) {
  const { root, stateRootRel } = initRoot(demandKey);
  run([
    "add-task-package", "--root", root, "--state-root", stateRootRel,
    "--task-package-id", "GATE-PKG", "--summary", "pkg",
    "--evidence-contract", JSON.stringify(GATE_CONTRACT),
    "--target-window", "WinA", "--target-task-id", "GATE-TASK", "--target-summary", "do",
    "--write", "--json",
  ]);
  writeEvidence(root, stateRootRel, "notes.md");
  return { root, stateRootRel };
}

test("W-Target: reduce-results hard-fails a completed result missing a required craft kind", () => {
  const { root, stateRootRel } = seedContractedTask("GATE-MISS");
  run([
    "import-target-result", "--root", root, "--state-root", stateRootRel,
    "--target-task-id", "GATE-TASK", "--target-window", "WinA", "--status", "completed",
    "--evidence-ref", "notes.md",
    "--craft-evidence", JSON.stringify([{ kind: "tests", value: "5 passed" }]),
    "--write", "--json",
  ]);
  const gated = run(["reduce-results", "--root", root, "--state-root", stateRootRel, "--write", "--json"]);
  assert.notEqual(gated.status, 0, "reduce blocks a completed result missing a required craft kind");
  assert.match(gated.stdout, /craft-evidence-required/, "reduce reports the craft gate");
});

test("W-Target: reduce-results accepts a completed result that satisfies the contract", () => {
  const { root, stateRootRel } = seedContractedTask("GATE-OK");
  run([
    "import-target-result", "--root", root, "--state-root", stateRootRel,
    "--target-task-id", "GATE-TASK", "--target-window", "WinA", "--status", "completed",
    "--evidence-ref", "notes.md",
    "--craft-evidence", JSON.stringify([
      { kind: "tests", value: "5 passed" },
      { kind: "change-scope", value: "within designIntent" },
    ]),
    "--write", "--json",
  ]);
  const ok = run(["reduce-results", "--root", root, "--state-root", stateRootRel, "--write", "--json"]);
  assert.equal(ok.status, 0, ok.stderr || ok.stdout);
});

test("W-Target: reduce-results exempts a blocked result from the craft gate", () => {
  const { root, stateRootRel } = seedContractedTask("GATE-BLOCKED");
  run([
    "import-target-result", "--root", root, "--state-root", stateRootRel,
    "--target-task-id", "GATE-TASK", "--target-window", "WinA", "--status", "blocked",
    "--evidence-ref", "notes.md", "--risk", "cannot proceed",
    "--write", "--json",
  ]);
  const reduced = run(["reduce-results", "--root", root, "--state-root", stateRootRel, "--write", "--json"]);
  assert.equal(reduced.status, 0, reduced.stderr || reduced.stdout);
  assert.doesNotMatch(reduced.stdout, /craft-evidence-required/, "blocked results are not craft-gated");
});
