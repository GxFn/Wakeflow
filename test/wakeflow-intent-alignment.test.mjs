#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Guards W2 (next-phase roadmap Phase 2): intent alignment is two sentences
// side-by-side at two judgment moments — never a score, never a gate. Zero
// traces when designIntent is absent; gates are byte-identical either way;
// replay ignores designIntent (it is outside the idempotency comparable).

const pluginRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../plugins/codex-wakeflow");
const stateScript = path.join(pluginRoot, "scripts/wakeflow-state.mjs");
const deliveryScript = path.join(pluginRoot, "scripts/wakeflow-delivery.mjs");

const DESIGN_INTENT = "Refactor the parser into a two-pass pipeline reusing the tokenizer";
const OBJECTIVE = "Have RepoA land the two-pass parser refactor behind the existing CLI flag";

function run(script, args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8", shell: false });
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function makeConfiguredRoot(prefix = "wakeflow-intent-") {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  mkdirSync(path.join(root, "RepoA"), { recursive: true });
  writeFileSync(path.join(root, "wakeflow.config.json"), `${JSON.stringify({
    controllerWindow: "Controller",
    repositories: [
      { windowName: "RepoA", path: "RepoA", role: "fixture implementation" },
    ],
  }, null, 2)}\n`);
  const registered = run(deliveryScript, [
    "register-thread",
    "--root", root,
    "--window", "RepoA",
    "--thread-id", "00000000-0000-4000-8000-000000000001",
    "--write",
    "--json",
  ]);
  assert.equal(registered.status, 0, registered.stderr || registered.stdout);
  return root;
}

function makeDemand({ withIntent }) {
  const root = makeConfiguredRoot();
  const init = run(stateScript, ["init", "--root", root, "--demand-key", "INTENT-DK", "--title", "Intent Fixture", "--write", "--json"]);
  assert.equal(init.status, 0, init.stderr || init.stdout);
  const stateRoot = path.join(root, JSON.parse(init.stdout).stateRoot);
  const addArgs = [
    "add-task-package", "--root", root, "--state-root", stateRoot,
    "--task-package-id", "tp-a", "--summary", "Parser refactor", "--target-window", "RepoA",
    ...(withIntent ? ["--design-intent", DESIGN_INTENT] : []),
    "--write", "--json",
  ];
  const added = run(stateScript, addArgs);
  assert.equal(added.status, 0, added.stderr || added.stdout);
  return { root, stateRoot };
}

function prepare(root, stateRoot, { objective } = {}) {
  return run(deliveryScript, [
    "prepare-dispatch-from-state", "--root", root, "--state-root", stateRoot,
    "--target-task-id", "tp-a__RepoA",
    ...(objective ? ["--objective", objective] : []),
    "--write", "--compact", "--json",
  ]);
}

test("designIntent persists on the task package and rides the packet beside the authored objective", () => {
  const { root, stateRoot } = makeDemand({ withIntent: true });
  const pkg = readJson(path.join(stateRoot, "task-packages", "tp-a.json"));
  assert.equal(pkg.designIntent, DESIGN_INTENT);
  const state = readJson(path.join(stateRoot, "wakeflow-state.json"));
  assert.equal(state.taskPackages[0].designIntent, DESIGN_INTENT);

  const prepared = prepare(root, stateRoot, { objective: OBJECTIVE });
  assert.equal(prepared.status, 0, prepared.stderr || prepared.stdout);
  const payload = JSON.parse(prepared.stdout);
  // dispatch-time judgment moment: both sentences in the SAME payload + reminder
  assert.equal(payload.designIntent, DESIGN_INTENT);
  assert.equal(payload.objective, OBJECTIVE);
  assert.match(payload.agentNext, /Intent check/);

  const packet = readJson(path.join(root, payload.packetFile));
  assert.equal(packet.designIntent, DESIGN_INTENT);
  assert.equal(packet.objective, OBJECTIVE);
});

test("re-preparing at the same revision replays idempotently — designIntent stays outside the comparable", () => {
  const { root, stateRoot } = makeDemand({ withIntent: true });
  assert.equal(prepare(root, stateRoot, { objective: OBJECTIVE }).status, 0);
  const replay = prepare(root, stateRoot, { objective: OBJECTIVE });
  assert.equal(replay.status, 0, replay.stderr || replay.stdout);
  assert.equal(JSON.parse(replay.stdout).idempotentReplay, true);
});

test("without designIntent the whole chain leaves zero traces", () => {
  const { root, stateRoot } = makeDemand({ withIntent: false });
  const prepared = prepare(root, stateRoot, { objective: OBJECTIVE });
  assert.equal(prepared.status, 0, prepared.stderr || prepared.stdout);
  const payload = JSON.parse(prepared.stdout);
  assert.equal("designIntent" in payload, false);
  assert.doesNotMatch(payload.agentNext ?? "", /Intent check/);

  const imported = run(stateScript, [
    "import-target-result", "--root", root, "--state-root", stateRoot,
    "--target-task-id", "tp-a__RepoA", "--target-window", "RepoA", "--status", "completed",
    "--summary", "Parser refactor fixture completed.", "--write", "--json",
  ]);
  assert.equal(imported.status, 0, imported.stderr || imported.stdout);
  const pack = JSON.parse(run(deliveryScript, ["review-pack", "--root", root, "--state-root", stateRoot, "--json"]).stdout);
  assert.equal("intentCheck" in pack.reviewPack, false);
  const entry = pack.reviewPack.targetResults.find((item) => item.taskId === "tp-a__RepoA");
  assert.equal("designIntent" in entry, false);
  assert.equal(entry.objective, OBJECTIVE, "objective still rides the pack (F2) even without designIntent");
  assert.equal(entry.objectiveSource, "dispatch-packet");
});

test("B2: review pack surfaces craftCheck when a task declares advisory craft inputs (never a gate)", () => {
  const root = makeConfiguredRoot("wakeflow-craftcheck-");
  const init = run(stateScript, ["init", "--root", root, "--demand-key", "CRAFTCHECK-DK", "--title", "CraftCheck", "--write", "--json"]);
  assert.equal(init.status, 0, init.stderr || init.stdout);
  const stateRoot = path.join(root, JSON.parse(init.stdout).stateRoot);
  const contract = JSON.stringify({ version: 1, required: [{ kind: "tests", verify: "self-attested" }], advisory: [{ kind: "self-review" }, { kind: "test-first" }] });
  const added = run(stateScript, [
    "add-task-package", "--root", root, "--state-root", stateRoot,
    "--task-package-id", "tp-a", "--summary", "Craft task", "--target-window", "RepoA",
    "--evidence-contract", contract, "--write", "--json",
  ]);
  assert.equal(added.status, 0, added.stderr || added.stdout);
  assert.equal(prepare(root, stateRoot, { objective: OBJECTIVE }).status, 0);
  const imported = run(stateScript, [
    "import-target-result", "--root", root, "--state-root", stateRoot,
    "--target-task-id", "tp-a__RepoA", "--target-window", "RepoA", "--status", "completed",
    "--craft-evidence", JSON.stringify([{ kind: "tests", value: "ok" }]), "--write", "--json",
  ]);
  assert.equal(imported.status, 0, imported.stderr || imported.stdout);

  const pack = JSON.parse(run(deliveryScript, ["review-pack", "--root", root, "--state-root", stateRoot, "--json"]).stdout).reviewPack;
  assert.match(pack.craftCheck, /advisory craft inputs/i, "craftCheck surfaces when advisory kinds are declared");
  assert.match(pack.craftCheck, /not a gate/i, "craftCheck states it is a reminder, not a gate");
  const entry = pack.targetResults.find((item) => item.taskId === "tp-a__RepoA");
  assert.deepEqual(entry.advisoryCraftKinds, ["self-review", "test-first"], "the entry lists the advisory craft kinds");
  // The pack must ECHO the result's typed craft evidence: verify modes like
  // controller-rerun are the controller's acceptance-time action, and it needs the
  // data in the pack to perform them.
  assert.equal(entry.craftEvidence?.[0]?.kind, "tests", "the entry echoes the result's craftEvidence for acceptance-time re-runs");
});

test("B2: no craftCheck when the task declares no advisory craft inputs (zero trace)", () => {
  const { root, stateRoot } = makeDemand({ withIntent: false });
  assert.equal(prepare(root, stateRoot, { objective: OBJECTIVE }).status, 0);
  const imported = run(stateScript, [
    "import-target-result", "--root", root, "--state-root", stateRoot,
    "--target-task-id", "tp-a__RepoA", "--target-window", "RepoA", "--status", "completed",
    "--summary", "Parser refactor fixture completed.", "--write", "--json",
  ]);
  assert.equal(imported.status, 0, imported.stderr || imported.stdout);
  const pack = JSON.parse(run(deliveryScript, ["review-pack", "--root", root, "--state-root", stateRoot, "--json"]).stdout).reviewPack;
  assert.equal("craftCheck" in pack, false, "no craftCheck without advisory craft kinds");
  const entry = pack.targetResults.find((item) => item.taskId === "tp-a__RepoA");
  assert.equal("advisoryCraftKinds" in entry, false, "no advisoryCraftKinds field without a contract");
});

test("one corrupt packet file never takes down the state-root review pack", () => {
  const { root, stateRoot } = makeDemand({ withIntent: true });
  assert.equal(prepare(root, stateRoot, { objective: OBJECTIVE }).status, 0);
  const imported = run(stateScript, [
    "import-target-result", "--root", root, "--state-root", stateRoot,
    "--target-task-id", "tp-a__RepoA", "--target-window", "RepoA", "--status", "completed",
    "--summary", "Parser refactor fixture completed.", "--write", "--json",
  ]);
  assert.equal(imported.status, 0, imported.stderr || imported.stdout);
  const packetsDir = path.join(root, ".wakeflow-local/wakeflow-delivery/dispatch-packets");
  writeFileSync(path.join(packetsDir, "zz-corrupt.json"), "{ this is not json");

  const pack = run(deliveryScript, ["review-pack", "--root", root, "--state-root", stateRoot, "--json"]);
  assert.equal(pack.status, 0, pack.stderr || pack.stdout);
  const entry = JSON.parse(pack.stdout).reviewPack.targetResults.find((item) => item.taskId === "tp-a__RepoA");
  assert.equal(entry.designIntent, DESIGN_INTENT, "intent enrichment must survive a corrupt neighbor packet");
});

test("review packs show the intent triple side by side and gates stay byte-identical", () => {
  const withIntent = makeDemand({ withIntent: true });
  const without = makeDemand({ withIntent: false });
  for (const fixture of [withIntent, without]) {
    assert.equal(prepare(fixture.root, fixture.stateRoot, { objective: OBJECTIVE }).status, 0);
    const imported = run(stateScript, [
      "import-target-result", "--root", fixture.root, "--state-root", fixture.stateRoot,
      "--target-task-id", "tp-a__RepoA", "--target-window", "RepoA", "--status", "completed",
      "--summary", "Parser refactor fixture completed.", "--write", "--json",
    ]);
    assert.equal(imported.status, 0, imported.stderr || imported.stdout);
  }

  const packOf = (fixture) => JSON.parse(
    run(deliveryScript, ["review-pack", "--root", fixture.root, "--state-root", fixture.stateRoot, "--json"]).stdout,
  ).reviewPack;
  const packWith = packOf(withIntent);
  const packWithout = packOf(without);

  // review-time judgment moment: the triple sits on the entry, the reminder on the pack
  const entry = packWith.targetResults.find((item) => item.taskId === "tp-a__RepoA");
  assert.equal(entry.designIntent, DESIGN_INTENT);
  assert.equal(entry.objective, OBJECTIVE);
  assert.match(packWith.intentCheck, /requirement review/);
  assert.match(packWith.intentCheck, /redesign/);

  // the reminder is advisory ONLY: gates must not know designIntent exists
  assert.deepEqual(packWith.gates, packWithout.gates, "gates must be identical with and without designIntent");

  // group-scope pack (the second builder) carries the same triple + reminder
  const groupPack = JSON.parse(
    run(deliveryScript, ["review-pack", "--root", withIntent.root, "--group", "tp-a", "--json"]).stdout,
  ).reviewPack;
  const groupEntry = groupPack.targetResults.find((item) => item.taskId === "tp-a__RepoA");
  assert.equal(groupEntry.designIntent, DESIGN_INTENT);
  assert.equal(groupEntry.objective, OBJECTIVE);
  assert.match(groupPack.intentCheck, /requirement review/);
});
