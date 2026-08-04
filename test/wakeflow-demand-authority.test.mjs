import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runSync } from "../plugins/codex-wakeflow/lib/wakeflow-process.mjs";
import {
  assertDemandAuthorityReady,
  demandAuthorityDigest,
  demandAuthorityReadiness,
} from "../plugins/codex-wakeflow/scripts/lib/wakeflow-demand-authority.mjs";

const pluginRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../plugins/codex-wakeflow",
);
const stateScript = path.join(pluginRoot, "scripts/wakeflow-state.mjs");

function makeRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-authority-"));
  writeFileSync(path.join(root, "authority.md"), [
    "# Demand authority",
    "",
    "## Original plan",
    "## Requirement design",
    "## Code facts",
    "## Landing plan",
    "## Non goals",
    "## User confirmation",
    "## Reproduction",
    "## Scope",
    "## Requirement delta",
    "## Research question",
    "## Boundaries",
    "## Test environment",
    "",
  ].join("\n"));
  return root;
}

function run(root, args) {
  return runSync(process.execPath, [stateScript, ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function authorityRef(role) {
  return { role, ref: `authority.md#${role}` };
}

function authorityFor(demandKey, demandType, {
  entryMode = "controller-inline",
  testMode = demandType === "research" ? "not-applicable" : "controller-only",
} = {}) {
  const roles = {
    requirement: [
      "original-plan",
      "requirement-design",
      "code-facts",
      "landing-plan",
      "non-goals",
      "user-confirmation",
    ],
    bug: ["reproduction", "scope", "non-goals"],
    supplement: ["requirement-design", "requirement-delta", "user-confirmation"],
    research: ["research-question", "boundaries"],
  }[demandType];
  return {
    demandKey,
    demandType,
    entryMode,
    authorityRefs: roles.map(authorityRef),
    testDecision: {
      mode: testMode,
      summary: testMode === "not-applicable"
        ? "Read-only research; no implementation or environment test."
        : "Controller reruns the bounded product checks.",
    },
  };
}

function implementationArgs({ root, stateRoot, packageId, taskId, authority = null }) {
  return [
    "add-task-package",
    "--root", root,
    "--state-root", stateRoot,
    "--task-package-id", packageId,
    "--summary", "Implement the bounded correction.",
    "--target-window", "WinA",
    "--target-task-id", taskId,
    "--work-type", "implementation",
    "--objective", "Implement only the confirmed bug scope.",
    "--context-summary", JSON.stringify(["The reproduction and boundaries are already confirmed."]),
    "--requirement-refs", JSON.stringify([{ role: "goal", ref: "authority.md#scope" }]),
    "--boundaries", JSON.stringify({
      inScope: ["The confirmed bug scope."],
      outOfScope: ["Unrelated behavior."],
      forbidden: ["Invent new requirements."],
    }),
    "--completion-expectations", JSON.stringify(["The acceptance probe passes."]),
    "--depends-on-task-ids", "[]",
    "--commit-expectation", "leave-uncommitted",
    "--acceptance-anchors", JSON.stringify([{
      id: "AC-BUG-1",
      claim: "The confirmed defect is corrected.",
      probe: "Run the controller-authored regression probe.",
      expected: "The probe passes without widening scope.",
    }]),
    ...(authority ? ["--demand-authority", JSON.stringify(authority)] : []),
    "--write",
    "--json",
  ];
}

test("demand authority readiness is proportional to each demand type", () => {
  const root = makeRoot();
  for (const demandType of ["requirement", "bug", "supplement", "research"]) {
    const authority = authorityFor(`AUTH-${demandType}`, demandType);
    const readiness = demandAuthorityReadiness(authority, { workspaceRoot: root });
    assert.equal(readiness.ready, true, readiness.errors.join("\n"));
    assert.equal(readiness.authority.demandType, demandType);
    assert.match(readiness.digest, /^[a-f0-9]{64}$/);
  }

  const realEnvironment = authorityFor("AUTH-REAL", "bug", { testMode: "real-environment" });
  let readiness = demandAuthorityReadiness(realEnvironment, { workspaceRoot: root });
  assert.equal(readiness.ready, false);
  assert.match(readiness.errors.join("\n"), /environmentSpecRef/);
  assert.match(readiness.errors.join("\n"), /role=test-environment/);

  realEnvironment.authorityRefs.push(authorityRef("test-environment"));
  realEnvironment.testDecision.environmentSpecRef = "authority.md#test-environment";
  readiness = demandAuthorityReadiness(realEnvironment, { workspaceRoot: root });
  assert.equal(readiness.ready, true, readiness.errors.join("\n"));

  assert.throws(
    () => assertDemandAuthorityReady({
      ...authorityFor("AUTH-RESEARCH", "research"),
      testDecision: { mode: "controller-only", summary: "Invalid implementation-like testing." },
    }, { workspaceRoot: root }),
    /research authority requires testDecision\.mode=not-applicable/,
  );
  assert.throws(
    () => assertDemandAuthorityReady(authorityFor("AUTH-MODE", "bug"), {
      workspaceRoot: root,
      demandKey: "AUTH-MODE",
      demandType: "bug",
      entryMode: "design-delivery",
    }),
    /entryMode must equal design-delivery/,
  );
  assert.throws(
    () => assertDemandAuthorityReady({
      ...authorityFor("AUTH-VERSION", "bug"),
      schemaVersion: 2,
    }, { workspaceRoot: root }),
    /schemaVersion must be 1/,
  );
});

test("the first typed implementation freezes one immutable authority atomically", () => {
  const root = makeRoot();
  const demandKey = "AUTH-FREEZE";
  const init = run(root, [
    "init",
    "--root", root,
    "--demand-key", demandKey,
    "--demand-type", "bug",
    "--title", "Authority freeze",
    "--write",
    "--json",
  ]);
  assert.equal(init.status, 0, init.stderr || init.stdout);
  const stateRoot = JSON.parse(init.stdout).stateRoot;
  const stateFile = path.join(root, stateRoot, "wakeflow-state.json");
  const authorityFile = path.join(root, stateRoot, "demand-authority.json");
  const firstPackageFile = path.join(root, stateRoot, "task-packages/pkg-1.json");
  const initialState = readJson(stateFile);

  const missing = run(root, implementationArgs({
    root,
    stateRoot,
    packageId: "PKG-1",
    taskId: "TASK-1",
  }));
  assert.notEqual(missing.status, 0);
  assert.match(missing.stdout + missing.stderr, /first implementation package requires --demand-authority/);
  assert.deepEqual(readJson(stateFile), initialState, "failed intake must not advance state");
  assert.equal(existsSync(authorityFile), false, "failed intake must not publish partial authority");
  assert.equal(existsSync(firstPackageFile), false, "failed intake must not publish a task package");

  const authority = authorityFor(demandKey, "bug");
  const added = run(root, implementationArgs({
    root,
    stateRoot,
    packageId: "PKG-1",
    taskId: "TASK-1",
    authority,
  }));
  assert.equal(added.status, 0, added.stderr || added.stdout);
  const payload = JSON.parse(added.stdout);
  assert.equal(payload.demandAuthorityFrozen, true);
  assert.equal(payload.demandType, "bug");
  assert.equal(existsSync(firstPackageFile), true);
  assert.deepEqual(readJson(authorityFile), assertDemandAuthorityReady(authority, { workspaceRoot: root }).authority);
  const frozenState = readJson(stateFile);
  assert.equal(frozenState.demandType, "bug");
  assert.equal(frozenState.demandAuthorityRef, "demand-authority.json");
  assert.equal(
    frozenState.demandAuthorityDigest,
    demandAuthorityDigest(assertDemandAuthorityReady(authority, { workspaceRoot: root }).authority),
  );
  assert.equal(frozenState.revision, initialState.revision + 1);

  const drifted = {
    ...authority,
    testDecision: { ...authority.testDecision, summary: "Silently widened after freeze." },
  };
  const drift = run(root, implementationArgs({
    root,
    stateRoot,
    packageId: "PKG-2",
    taskId: "TASK-2",
    authority: drifted,
  }));
  assert.notEqual(drift.status, 0);
  assert.match(drift.stdout + drift.stderr, /immutable after it is frozen/);
  assert.deepEqual(readJson(stateFile), frozenState, "authority drift must not advance state");
  assert.equal(existsSync(path.join(root, stateRoot, "task-packages/pkg-2.json")), false);
  assert.deepEqual(readJson(authorityFile), assertDemandAuthorityReady(authority, { workspaceRoot: root }).authority);

  writeFileSync(
    authorityFile,
    `${JSON.stringify(assertDemandAuthorityReady(drifted, { workspaceRoot: root }).authority, null, 2)}\n`,
  );
  const tampered = run(root, implementationArgs({
    root,
    stateRoot,
    packageId: "PKG-3",
    taskId: "TASK-3",
  }));
  assert.notEqual(tampered.status, 0);
  assert.match(tampered.stdout + tampered.stderr, /digest must equal the frozen state digest/);
  assert.deepEqual(readJson(stateFile), frozenState, "file tampering must not advance state");
  assert.equal(existsSync(path.join(root, stateRoot, "task-packages/pkg-3.json")), false);
});

test("an unreferenced authority file is corruption, not authority to overwrite", () => {
  const root = makeRoot();
  const demandKey = "AUTH-ORPHAN";
  const init = run(root, [
    "init",
    "--root", root,
    "--demand-key", demandKey,
    "--demand-type", "bug",
    "--title", "Orphan authority",
    "--write",
    "--json",
  ]);
  assert.equal(init.status, 0, init.stderr || init.stdout);
  const stateRoot = JSON.parse(init.stdout).stateRoot;
  const stateFile = path.join(root, stateRoot, "wakeflow-state.json");
  const authorityFile = path.join(root, stateRoot, "demand-authority.json");
  const initialState = readJson(stateFile);
  writeFileSync(authorityFile, `${JSON.stringify(authorityFor(demandKey, "bug"), null, 2)}\n`);

  const result = run(root, implementationArgs({
    root,
    stateRoot,
    packageId: "PKG-ORPHAN",
    taskId: "TASK-ORPHAN",
    authority: authorityFor(demandKey, "bug"),
  }));
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /unreferenced demand-authority\.json already exists/);
  assert.deepEqual(readJson(stateFile), initialState);
  assert.equal(existsSync(path.join(root, stateRoot, "task-packages/pkg-orphan.json")), false);
});
