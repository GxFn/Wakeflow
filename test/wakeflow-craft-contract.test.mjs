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
const deliveryScript = path.join(workspaceRoot, "scripts/wakeflow-delivery.mjs");

function makeRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-craft-"));
  mkdirSync(root, { recursive: true });
  return root;
}

function run(args) {
  return runSync(process.execPath, [script, ...args], { cwd: workspaceRoot, encoding: "utf8" });
}

function runDelivery(args) {
  return runSync(process.execPath, [deliveryScript, ...args], { cwd: workspaceRoot, encoding: "utf8" });
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

test("W-craft-2: the wake prompt activates the craft skill exactly when a contract is present", () => {
  // With a contract -> the prompt lists the craft skill in the required process layer.
  const withC = seedContractedTask("ACT-YES");
  const prepared = runDelivery([
    "prepare-dispatch-from-state", "--root", withC.root, "--state-root", withC.stateRootRel,
    "--target-task-id", "GATE-TASK", "--write", "--compact", "--json",
  ]);
  assert.equal(prepared.status, 0, prepared.stderr || prepared.stdout);
  assert.match(JSON.parse(prepared.stdout).prompt, /Required execution Skills[\s\S]*- skills\/wakeflow-target-craft\/SKILL\.md/,
    "contract present -> wake prompt points at the craft skill");

  // Without a contract -> zero traces (reminder-first).
  const { root, stateRootRel } = initRoot("ACT-NO");
  run([
    "add-task-package", "--root", root, "--state-root", stateRootRel,
    "--task-package-id", "PLAIN", "--summary", "pkg",
    "--target-window", "WinA", "--target-task-id", "PLAIN-TASK", "--target-summary", "do",
    "--write", "--json",
  ]);
  const plain = runDelivery([
    "prepare-dispatch-from-state", "--root", root, "--state-root", stateRootRel,
    "--target-task-id", "PLAIN-TASK", "--write", "--compact", "--json",
  ]);
  assert.equal(plain.status, 0, plain.stderr || plain.stdout);
  assert.doesNotMatch(JSON.parse(plain.stdout).prompt, /skills\/wakeflow-target-craft\/SKILL\.md/, "no contract -> no craft line in the prompt");
});

test("W-craft-2: add-task-package reminds when a dispatchable package lacks a contract (never a gate)", () => {
  const { root, stateRootRel } = initRoot("REMIND-ADD");
  const bare = run([
    "add-task-package", "--root", root, "--state-root", stateRootRel,
    "--task-package-id", "BARE", "--summary", "pkg",
    "--target-window", "WinA", "--target-task-id", "BARE-TASK", "--target-summary", "do",
    "--write", "--json",
  ]);
  assert.equal(bare.status, 0, "reminder never blocks");
  assert.match(JSON.parse(bare.stdout).evidenceContractReminder, /dormant/i, "absent contract -> reminder");

  const withC = run([
    "add-task-package", "--root", root, "--state-root", stateRootRel,
    "--task-package-id", "WITHC", "--summary", "pkg",
    "--evidence-contract", JSON.stringify({ required: [{ kind: "tests" }] }),
    "--target-window", "WinB", "--target-task-id", "WITHC-TASK", "--target-summary", "do",
    "--write", "--json",
  ]);
  assert.equal("evidenceContractReminder" in JSON.parse(withC.stdout), false, "contract present -> zero trace");
});

test("W-craft-2: recurringProblem reminder appears at prepare-dispatch after two reworks", () => {
  const { root, stateRootRel } = initRoot("RECUR");
  run([
    "add-task-package", "--root", root, "--state-root", stateRootRel,
    "--task-package-id", "R-PKG", "--summary", "pkg",
    "--target-window", "WinA", "--target-task-id", "R-TASK", "--target-summary", "do",
    "--write", "--json",
  ]);
  writeEvidence(root, stateRootRel, "notes.md");
  // Real rework protocol per round: result -> reduce -> decide rework -> RE-DISPATCH
  // (prepare + record sent). Skipping the re-dispatch leaves the task pending its
  // rework decision and reduce refuses a candidate — that refusal is the protocol,
  // so the test walks the honest loop.
  for (let round = 1; round <= 2; round += 1) {
    const imp = run([
      "import-target-result", "--root", root, "--state-root", stateRootRel,
      "--target-task-id", "R-TASK", "--target-window", "WinA", "--status", "completed",
      ...(round > 1 ? ["--dispatch-group", `rework-${round - 1}`] : []),
      "--evidence-ref", "notes.md", "--write", "--json",
    ]);
    assert.equal(imp.status, 0, imp.stderr || imp.stdout);
    const red = run(["reduce-results", "--root", root, "--state-root", stateRootRel, "--write", "--json"]);
    assert.equal(red.status, 0, red.stderr || red.stdout);
    const cand = JSON.parse(red.stdout).candidateId;
    assert.ok(cand, `round ${round} reduce produced a candidate`);
    const dec = run([
      "decide-review", "--root", root, "--state-root", stateRootRel,
      "--candidate-id", cand, "--decision", "rework", "--reason", `round ${round} not good enough`,
      "--write", "--json",
    ]);
    assert.equal(dec.status, 0, dec.stderr || dec.stdout);
    if (round < 2) {
      // Same-id packets are revision-pinned (idempotency); a rework re-dispatch is a
      // NEW dispatch group in the real protocol, so each round uses its own group.
      const prep = runDelivery([
        "prepare-dispatch-from-state", "--root", root, "--state-root", stateRootRel,
        "--target-task-id", "R-TASK", "--group", `rework-${round}`, "--write", "--compact", "--json",
      ]);
      assert.equal(prep.status, 0, prep.stderr || prep.stdout);
      const deliveryFile = JSON.parse(prep.stdout).deliveryFile;
      const rec = runDelivery([
        "record-delivery-run", "--root", root, "--delivery-file", deliveryFile,
        "--status", "sent", "--readback-ok", "true", "--evidence", "test-run readback",
        "--write", "--compact", "--json",
      ]);
      assert.equal(rec.status, 0, rec.stderr || rec.stdout);
    }
  }
  const prepared = runDelivery([
    "prepare-dispatch-from-state", "--root", root, "--state-root", stateRootRel,
    "--target-task-id", "R-TASK", "--group", "rework-final", "--write", "--compact", "--json",
  ]);
  assert.equal(prepared.status, 0, prepared.stderr || prepared.stdout);
  const payload = JSON.parse(prepared.stdout);
  assert.match(payload.recurringProblemReminder, /reworked 2 times|recurringProblem/,
    "two reworks -> the dispatch payload carries the stop-point-fixing reminder");
  assert.match(payload.recurringProblemReminder, /root-cause-note/, "the reminder asks for a root-cause-note entry");
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

  const pack = runDelivery(["review-pack", "--root", root, "--state-root", stateRootRel, "--json"]);
  assert.equal(pack.status, 0, pack.stderr || pack.stdout);
  const review = JSON.parse(pack.stdout).reviewPack;
  assert.equal(review.gates.controllerReviewReady, false, "review pack agrees with the reducer before mutation");
  assert.equal(review.gates.craftEvidenceRepairRequired, true);
  assert.equal(review.nextAction, "fix-required-craft-evidence-before-controller-verdict");
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
