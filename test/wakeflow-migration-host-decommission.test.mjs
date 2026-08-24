import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { hostProfile as codexProfile } from "../plugins/codex-wakeflow/scripts/lib/wakeflow-host-profile.mjs";
import { hostProfile as claudeProfile } from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-host-profile.mjs";
import {
  WAKEFLOW_CODEX_MIGRATION_DECOMMISSION_HOST_ID,
  WakeflowCodexMigrationDecommissionError,
  inspectCodexMigrationDecommissionPlan,
  inspectCodexMigrationDecommissionRecovery,
  recordCodexMigrationDecommissionOutcome,
  wakeflowMigrationDecommissionHostAdapter as codexMigrationDecommissionHostAdapter,
} from "../plugins/codex-wakeflow/scripts/lib/wakeflow-codex-migration-decommission.mjs";
import {
  WAKEFLOW_CLAUDE_MIGRATION_DECOMMISSION_HOST_ID,
  WakeflowClaudeMigrationDecommissionError,
  inspectClaudeMigrationDecommissionPlan,
  recordClaudeMigrationDecommissionOutcome,
  recordClaudeMigrationDecommissionRecoveryOutcome,
  wakeflowMigrationDecommissionHostAdapter as claudeMigrationDecommissionHostAdapter,
} from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-migration-decommission.mjs";
import {
  assertMigrationHostDecommissionOutcomeAgainstPlan,
  assertMigrationHostDecommissionPlanAgainstMigrationPlan,
  WAKEFLOW_MIGRATION_HOST_DECOMMISSION_ASSESSMENT_KIND,
  WAKEFLOW_MIGRATION_HOST_DECOMMISSION_OUTCOME_KIND,
  WAKEFLOW_MIGRATION_HOST_DECOMMISSION_PLAN_KIND,
  WAKEFLOW_MIGRATION_HOST_DECOMMISSION_SCHEMA_VERSION,
  WakeflowMigrationHostDecommissionError,
  assessMigrationHostDecommission,
  createMigrationHostDecommissionOutcome,
  migrationHostDecommissionCanonicalBytes,
  validateMigrationHostDecommissionAssessment,
  validateMigrationHostDecommissionOutcome,
  validateMigrationHostDecommissionPlan,
} from "../core/scripts/lib/wakeflow-migration-host-decommission.mjs";
import {
  canonicalJsonDigest,
  canonicalJsonDigestHex,
} from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import {
  createMigrationFixturePlan,
} from "./support/wakeflow-migration-v3-fixture.mjs";
import { materializeWakeflowRetiredArchiveOutput } from "./support/wakeflow-retired-writer-fixture.mjs";
import { loadWakeflowHistoricalArtifactIdentity } from "./support/wakeflow-historical-artifact.mjs";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "..");
const CODEX_ARTIFACT = path.join(REPOSITORY_ROOT, "plugins/codex-wakeflow");
const CLAUDE_ARTIFACT = path.join(REPOSITORY_ROOT, "plugins/claude-code-wakeflow");

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function treeSnapshot(root) {
  const entries = [];
  function walk(file, ref) {
    const stat = lstatSync(file);
    const type = stat.isDirectory() ? "directory" : stat.isFile() ? "file" : stat.isSymbolicLink() ? "symlink" : "special";
    entries.push({
      digest: type === "file" ? sha256(readFileSync(file)) : null,
      mode: stat.mode & 0o777,
      ref,
      size: stat.size,
      type,
    });
    if (type === "directory") {
      for (const name of readdirSync(file).sort()) walk(path.join(file, name), ref ? `${ref}/${name}` : name);
    }
  }
  walk(root, "");
  return entries;
}

function materialize(t, host, scenarios = []) {
  const sandbox = mkdtempSync(path.join(os.tmpdir(), `wakeflow-t07-${host}-`));
  t.after(() => rmSync(sandbox, { recursive: true, force: true }));
  const origin = path.join(REPOSITORY_ROOT, `test/fixtures/legacy-origins/${host}-0.9.6-70d79d72`);
  cpSync(path.join(origin, "static/shared-setup"), sandbox, { recursive: true });
  for (const scenario of scenarios) {
    cpSync(path.join(origin, `scenarios/${scenario}/output`), sandbox, { recursive: true });
  }
  if (scenarios.some((scenario) => ["pod-open", "pod-closed"].includes(scenario))) {
    rehydratePodScenarioDigests(realpathSync(path.join(sandbox, "WakeflowFixture")), host);
  }
  return {
    sandbox,
    workspaceRoot: realpathSync(path.join(sandbox, "WakeflowFixture")),
  };
}

function migrationPlan(t, { artifactRoot, hostProfile, workspaceRoot }) {
  return createMigrationFixturePlan({
    bootstrapArtifactRoot: artifactRoot,
    hostProfile,
    legacyOwnerArtifact: loadWakeflowHistoricalArtifactIdentity({ host: hostProfile.hostId }),
    onCleanup: (cleanup) => t.after(cleanup),
    workspaceRoot,
  });
}

function assertDeepFrozen(value) {
  if (!value || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

function coherentClaudeWindowHost(workspaceRoot) {
  const hostFile = path.join(
    workspaceRoot,
    ".wakeflow-local/wakeflow-delivery/hosts/claude-code/window-host/ProductWindow.json",
  );
  const registryFile = path.join(
    workspaceRoot,
    ".wakeflow-local/wakeflow-delivery/hosts/claude-code/thread-registry/ProductWindow.json",
  );
  const host = JSON.parse(readFileSync(hostFile, "utf8"));
  const registry = JSON.parse(readFileSync(registryFile, "utf8"));
  host.bindingId = registry.bindingId;
  host.threadId = registry.threadId;
  host.hostReceipt.bindingId = registry.bindingId;
  writeFileSync(hostFile, `${JSON.stringify(host, null, 2)}\n`);
  rmSync(path.join(
    workspaceRoot,
    ".wakeflow-local/wakeflow-delivery/locks/ProductWindow.json",
  ), { force: true });
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function rehydratePodScenarioDigests(workspaceRoot, host) {
  const hostRoot = path.join(
    workspaceRoot,
    ".wakeflow-local/wakeflow-delivery/hosts",
    host,
  );
  const bindingsRoot = path.join(hostRoot, "pod-bindings");
  const bindings = new Map();
  for (const podName of readdirSync(bindingsRoot)) {
    const podRoot = path.join(bindingsRoot, podName);
    for (const name of readdirSync(podRoot).filter((entry) => entry.endsWith(".json"))) {
      const file = path.join(podRoot, name);
      const binding = readJson(file);
      binding.receiptDigest = canonicalJsonDigestHex(binding.receipt);
      writeJson(file, binding);
      bindings.set(`${binding.podId}\0${binding.windowName}`, binding);
    }
  }
  const operationsRoot = path.join(hostRoot, "pod-operations");
  for (const name of readdirSync(operationsRoot).filter((entry) => entry.endsWith(".json"))) {
    const file = path.join(operationsRoot, name);
    const operation = readJson(file);
    operation.intentDigest = canonicalJsonDigestHex(operation.intent);
    if (operation.receipt) operation.receiptDigest = canonicalJsonDigestHex(operation.receipt);
    if (operation.operationType === "launch") {
      const binding = bindings.get(`${operation.podId}\0${operation.windowName}`);
      assert.ok(binding, `missing retired Pod binding for ${operation.operationId}`);
      operation.bindingId = binding.bindingId;
      operation.receiptDigest = binding.receiptDigest;
    }
    writeJson(file, operation);
  }
}

function copyJson(workspaceRoot, fromRef, toRef, mutate = (value) => value) {
  const value = readJson(path.join(workspaceRoot, fromRef));
  writeJson(path.join(workspaceRoot, toRef), mutate(value));
}

function resignArtifact(value, digestField) {
  const unsigned = { ...value };
  delete unsigned[digestField];
  value[digestField] = canonicalJsonDigest(unsigned);
  return value;
}

function resignHostOutcome(value) {
  for (const entry of value.subjectOutcomes) resignArtifact(entry, "outcomeDigest");
  const counts = {
    blocked: value.subjectOutcomes.filter((entry) => entry.status === "blocked").length,
    machine: value.subjectOutcomes.filter((entry) => entry.status === "machine-verified").length,
    manual: value.subjectOutcomes.filter((entry) => entry.status === "manual-host-gate").length,
    none: value.subjectOutcomes.filter((entry) => entry.status === "not-applicable").length,
  };
  value.summary = {
    blockedCount: counts.blocked,
    machineVerifiedCount: counts.machine,
    manualHostGateCount: counts.manual,
    notApplicableCount: counts.none,
    status: counts.blocked > 0
      ? "blocked"
      : counts.manual > 0
        ? "manual-host-gate"
        : counts.machine > 0
          ? "machine-verified"
          : "not-applicable",
    subjectCount: value.subjectOutcomes.length,
  };
  return resignArtifact(value, "outcomeDigest");
}

function archiveClosedPod(workspaceRoot) {
  materializeWakeflowRetiredArchiveOutput({
    disposableRoot: path.dirname(workspaceRoot),
    workspaceRoot,
    scenarioId: "pod-closed",
  });
}

test("M6-T07 exposes migration-only shared and host-specific decommission contracts", () => {
  assert.equal(WAKEFLOW_MIGRATION_HOST_DECOMMISSION_PLAN_KIND, "WakeflowMigrationHostDecommissionPlan");
  assert.equal(WAKEFLOW_MIGRATION_HOST_DECOMMISSION_OUTCOME_KIND, "WakeflowMigrationHostDecommissionOutcome");
  assert.equal(WAKEFLOW_MIGRATION_HOST_DECOMMISSION_ASSESSMENT_KIND, "WakeflowMigrationHostDecommissionAssessment");
  assert.equal(WAKEFLOW_MIGRATION_HOST_DECOMMISSION_SCHEMA_VERSION, 1);
  assert.equal(WAKEFLOW_CODEX_MIGRATION_DECOMMISSION_HOST_ID, "codex");
  assert.equal(WAKEFLOW_CLAUDE_MIGRATION_DECOMMISSION_HOST_ID, "claude-code");
  assert.equal(codexProfile.artifact.migrationDecommissionHostFile, "scripts/lib/wakeflow-codex-migration-decommission.mjs");
  assert.equal(claudeProfile.artifact.migrationDecommissionHostFile, "scripts/lib/wakeflow-claude-migration-decommission.mjs");
  for (const [hostId, adapter, inspect] of [
    ["codex", codexMigrationDecommissionHostAdapter, inspectCodexMigrationDecommissionPlan],
    ["claude-code", claudeMigrationDecommissionHostAdapter, inspectClaudeMigrationDecommissionPlan],
  ]) {
    assert.equal(Object.isFrozen(adapter), true);
    assert.deepEqual(Object.keys(adapter).sort(), ["hostId", "inspect"]);
    assert.equal(adapter.hostId, hostId);
    assert.equal(adapter.inspect, inspect);
  }
});

test("Codex freezes exact registered and unregistered sources but always remains a manual host gate", (t) => {
  const fixture = materialize(t, "codex", ["identity-registered"]);
  const before = treeSnapshot(fixture.sandbox);
  const sourcePlan = migrationPlan(t, {
    artifactRoot: CODEX_ARTIFACT,
    hostProfile: codexProfile,
    workspaceRoot: fixture.workspaceRoot,
  });
  const plan = inspectCodexMigrationDecommissionPlan({
    migrationPlan: sourcePlan,
    workspaceRoot: fixture.workspaceRoot,
  });

  assert.equal(plan.status, "ready");
  assert.equal(plan.subjects.length, 4);
  assert.equal(plan.subjects.filter((subject) => subject.effect === "archive").length, 1);
  assert.equal(plan.subjects.filter((subject) => subject.effect === "none").length, 3);
  assert.equal(plan.coverage.sourceIds.length, 5);
  assert.deepEqual(validateMigrationHostDecommissionPlan(plan), plan);
  assertDeepFrozen(plan);
  assert.deepEqual(treeSnapshot(fixture.sandbox), before);

  const archive = plan.subjects.find((subject) => subject.effect === "archive");
  const outcome = recordCodexMigrationDecommissionOutcome({
    migrationPlan: sourcePlan,
    observations: [{ status: "archived", subjectId: archive.subjectId }],
    plan,
    workspaceRoot: fixture.workspaceRoot,
  });
  assert.equal(outcome.summary.status, "manual-host-gate");
  assert.equal(outcome.summary.manualHostGateCount, 1);
  assert.equal(outcome.subjectOutcomes.find((entry) => entry.subjectId === archive.subjectId).proof, "archive-observed");
  assert.equal(JSON.stringify(outcome).includes("ProductWindow"), false);
  assert.equal(JSON.stringify(outcome).includes("@wakeflow-scenario-thread"), false);
  assert.deepEqual(validateMigrationHostDecommissionOutcome(outcome), outcome);
  assert.equal(migrationHostDecommissionCanonicalBytes(outcome).at(-1), 0x0a);
  assert.equal(inspectCodexMigrationDecommissionRecovery({
    migrationPlan: sourcePlan,
    plan,
    workspaceRoot: fixture.workspaceRoot,
  }).status, "manual-host-gate");
  assert.throws(
    () => recordCodexMigrationDecommissionOutcome({
      migrationPlan: sourcePlan,
      observations: [{ acknowledged: true, status: "archived", subjectId: archive.subjectId }],
      plan,
      workspaceRoot: fixture.workspaceRoot,
    }),
    (error) => error instanceof WakeflowCodexMigrationDecommissionError
      && error.code === "wakeflow-codex-migration-decommission-contract",
  );

  let observationGetterCalls = 0;
  const getterObservations = [];
  Object.defineProperty(getterObservations, "0", {
    enumerable: true,
    get() {
      observationGetterCalls += 1;
      return { status: "not-attempted", subjectId: archive.subjectId };
    },
  });
  assert.throws(
    () => recordCodexMigrationDecommissionOutcome({
      migrationPlan: sourcePlan,
      observations: getterObservations,
      plan,
      workspaceRoot: fixture.workspaceRoot,
    }),
    (error) => error instanceof WakeflowCodexMigrationDecommissionError
      && error.code === "wakeflow-codex-migration-decommission-contract",
  );
  assert.equal(observationGetterCalls, 0);
});

test("Claude requires one coherent registry/config/window-host subject and exact close plus absence", (t) => {
  const fixture = materialize(t, "claude-code", ["identity-registered", "claude-window-operation"]);
  coherentClaudeWindowHost(fixture.workspaceRoot);
  const before = treeSnapshot(fixture.sandbox);
  const sourcePlan = migrationPlan(t, {
    artifactRoot: CLAUDE_ARTIFACT,
    hostProfile: claudeProfile,
    workspaceRoot: fixture.workspaceRoot,
  });
  const plan = inspectClaudeMigrationDecommissionPlan({
    migrationPlan: sourcePlan,
    workspaceRoot: fixture.workspaceRoot,
  });

  assert.equal(plan.status, "ready");
  assert.equal(plan.subjects.length, 4);
  assert.equal(plan.subjects.filter((subject) => subject.effect === "close").length, 1);
  assert.equal(plan.coverage.sourceIds.length, 6);
  assertDeepFrozen(plan);
  assert.deepEqual(treeSnapshot(fixture.sandbox), before);
  const close = plan.subjects.find((subject) => subject.effect === "close");
  const exactObservation = {
    closeStatus: "succeeded",
    effectCheckpoint: "completed",
    postCloseAttempts: 2,
    postCloseStatus: "absent",
    preCloseStatus: "live",
    subjectId: close.subjectId,
  };
  const outcome = recordClaudeMigrationDecommissionOutcome({
    migrationPlan: sourcePlan,
    observations: [exactObservation],
    plan,
    workspaceRoot: fixture.workspaceRoot,
  });
  assert.equal(outcome.summary.status, "machine-verified");
  assert.equal(outcome.summary.machineVerifiedCount, 1);
  assert.equal(outcome.subjectOutcomes.find((entry) => entry.subjectId === close.subjectId).proof, "exact-post-close-absence");
  assert.equal(JSON.stringify(outcome).includes("ProductWindow"), false);
  assert.equal(JSON.stringify(outcome).includes("@wakeflow-scenario-session"), false);

  const recovery = recordClaudeMigrationDecommissionRecoveryOutcome({
    migrationPlan: sourcePlan,
    observations: [exactObservation],
    plan,
    workspaceRoot: fixture.workspaceRoot,
  });
  assert.deepEqual(recovery, outcome);
  const assessment = assessMigrationHostDecommission({
    migrationPlan: sourcePlan,
    outcomes: [outcome],
    plans: [plan],
  });
  assert.equal(assessment.summary.status, "satisfied");
  assert.equal(assessment.summary.decommissionSatisfied, true);
  assert.deepEqual(validateMigrationHostDecommissionAssessment(assessment), assessment);
  assert.throws(
    () => assessMigrationHostDecommission({ migrationPlan: sourcePlan, outcomes: [outcome], plans: [] }),
    (error) => error instanceof WakeflowMigrationHostDecommissionError
      && error.code === "wakeflow-migration-host-decommission-coverage",
  );
});

test("Claude missing/ambiguous close evidence remains blocked and no current v3 locator is fabricated", (t) => {
  const fixture = materialize(t, "claude-code", ["identity-registered", "claude-window-operation"]);
  coherentClaudeWindowHost(fixture.workspaceRoot);
  const sourcePlan = migrationPlan(t, {
    artifactRoot: CLAUDE_ARTIFACT,
    hostProfile: claudeProfile,
    workspaceRoot: fixture.workspaceRoot,
  });
  const plan = inspectClaudeMigrationDecommissionPlan({ migrationPlan: sourcePlan, workspaceRoot: fixture.workspaceRoot });
  const close = plan.subjects.find((subject) => subject.effect === "close");
  const outcome = recordClaudeMigrationDecommissionOutcome({
    migrationPlan: sourcePlan,
    observations: [{
      closeStatus: "not-attempted",
      effectCheckpoint: "not-started",
      postCloseAttempts: 0,
      postCloseStatus: "not-attempted",
      preCloseStatus: "missing",
      subjectId: close.subjectId,
    }],
    plan,
    workspaceRoot: fixture.workspaceRoot,
  });
  const blocked = outcome.subjectOutcomes.find((entry) => entry.subjectId === close.subjectId);
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.reasonCode, "claude-preclose-missing");
  assert.equal(JSON.stringify(plan).includes("locator_"), false);
  assert.equal(JSON.stringify(plan).includes("binding_"), false);
  assert.equal(assessMigrationHostDecommission({
    migrationPlan: sourcePlan,
    outcomes: [outcome],
    plans: [plan],
  }).summary.status, "blocked");
});

test("Claude registry without exact legacy window-host is a blocked subject, not an inferred close target", (t) => {
  const fixture = materialize(t, "claude-code", ["identity-registered"]);
  const sourcePlan = migrationPlan(t, {
    artifactRoot: CLAUDE_ARTIFACT,
    hostProfile: claudeProfile,
    workspaceRoot: fixture.workspaceRoot,
  });
  const plan = inspectClaudeMigrationDecommissionPlan({ migrationPlan: sourcePlan, workspaceRoot: fixture.workspaceRoot });
  const close = plan.subjects.find((subject) => subject.effect === "close");
  assert.equal(plan.status, "blocked");
  assert.ok(close.blockerCodes.includes("migration-claude-window-host-missing"));
  const outcome = recordClaudeMigrationDecommissionOutcome({
    migrationPlan: sourcePlan,
    observations: [],
    plan,
    workspaceRoot: fixture.workspaceRoot,
  });
  assert.equal(outcome.summary.status, "blocked");
});

test("known historical flat Codex fallback collapses when matching and conflicts when semantics differ", (t) => {
  const fixture = materialize(t, "codex", ["identity-registered"]);
  const oldOrigin = path.join(
    REPOSITORY_ROOT,
    "test/fixtures/legacy-origins/codex-0.1.2-58eb3bcf/static/shared-setup/WakeflowFixture/.workspace-local/wakeflow-delivery/window-config",
  );
  const flatConfigRoot = path.join(
    fixture.workspaceRoot,
    ".workspace-local/wakeflow-delivery/window-config",
  );
  mkdirSync(flatConfigRoot, { recursive: true });
  cpSync(path.join(oldOrigin, "Design.json"), path.join(flatConfigRoot, "Design.json"));
  const duplicateSourcePlan = migrationPlan(t, {
    artifactRoot: CODEX_ARTIFACT,
    hostProfile: codexProfile,
    workspaceRoot: fixture.workspaceRoot,
  });
  const duplicatePlan = inspectCodexMigrationDecommissionPlan({
    migrationPlan: duplicateSourcePlan,
    workspaceRoot: fixture.workspaceRoot,
  });
  assert.equal(duplicatePlan.status, "ready");
  assert.equal(duplicatePlan.coverage.sourceIds.length, 6);
  assert.equal(duplicatePlan.subjects.length, 4);
  assert.ok(duplicatePlan.subjects.some((subject) => (
    subject.effect === "none" && subject.sourceIds.length === 2
  )));

  cpSync(path.join(oldOrigin, "ProductWindow.json"), path.join(flatConfigRoot, "ProductWindow.json"));
  const conflictSourcePlan = migrationPlan(t, {
    artifactRoot: CODEX_ARTIFACT,
    hostProfile: codexProfile,
    workspaceRoot: fixture.workspaceRoot,
  });
  const conflictPlan = inspectCodexMigrationDecommissionPlan({
    migrationPlan: conflictSourcePlan,
    workspaceRoot: fixture.workspaceRoot,
  });
  assert.equal(conflictPlan.status, "blocked");
  assert.ok(conflictPlan.subjects.some((subject) => (
    subject.blockerCodes.includes("migration-codex-window-config-conflict")
  )));
});

test("an unsupported relocated flat source remains unknown coverage instead of being adopted by Codex", (t) => {
  const fixture = materialize(t, "codex", ["identity-registered"]);
  copyJson(
    fixture.workspaceRoot,
    ".wakeflow-local/wakeflow-delivery/hosts/codex/thread-registry/ProductWindow.json",
    ".wakeflow-local/wakeflow-delivery/thread-registry/ProductWindow.json",
  );
  const sourcePlan = migrationPlan(t, {
    artifactRoot: CODEX_ARTIFACT,
    hostProfile: codexProfile,
    workspaceRoot: fixture.workspaceRoot,
  });
  assert.deepEqual(
    sourcePlan.payload.decommissionCoverage.map((entry) => entry.hostId).sort(),
    ["codex", "unknown"],
  );
  const plan = inspectCodexMigrationDecommissionPlan({
    migrationPlan: sourcePlan,
    workspaceRoot: fixture.workspaceRoot,
  });
  const archive = plan.subjects.find((subject) => subject.effect === "archive");
  const outcome = recordCodexMigrationDecommissionOutcome({
    migrationPlan: sourcePlan,
    observations: [{ status: "archived", subjectId: archive.subjectId }],
    plan,
    workspaceRoot: fixture.workspaceRoot,
  });
  const assessment = assessMigrationHostDecommission({
    migrationPlan: sourcePlan,
    outcomes: [outcome],
    plans: [plan],
  });
  assert.equal(assessment.summary.status, "blocked");
  assert.equal(assessment.coverage.find((entry) => entry.hostId === "unknown").status, "missing");
});

test("one Codex handle reused across semantic windows blocks every affected subject", (t) => {
  const fixture = materialize(t, "codex", ["identity-registered"]);
  const hostRoot = path.join(
    fixture.workspaceRoot,
    ".wakeflow-local/wakeflow-delivery/hosts/codex",
  );
  const productRegistration = readJson(path.join(hostRoot, "thread-registry/ProductWindow.json"));
  const testConfigFile = path.join(hostRoot, "window-config/Test.json");
  const testConfig = readJson(testConfigFile);
  const testBindingId = "@wakeflow-reused-handle-test-binding";
  writeJson(testConfigFile, {
    ...testConfig,
    threadBindingId: testBindingId,
    threadRegistered: true,
  });
  writeJson(path.join(hostRoot, "thread-registry/Test.json"), {
    ...productRegistration,
    bindingId: testBindingId,
    windowName: "Test",
  });
  const sourcePlan = migrationPlan(t, {
    artifactRoot: CODEX_ARTIFACT,
    hostProfile: codexProfile,
    workspaceRoot: fixture.workspaceRoot,
  });
  const plan = inspectCodexMigrationDecommissionPlan({
    migrationPlan: sourcePlan,
    workspaceRoot: fixture.workspaceRoot,
  });
  assert.equal(plan.status, "blocked");
  assert.equal(plan.subjects.filter((subject) => (
    subject.blockerCodes.includes("migration-codex-handle-reused-across-windows")
  )).length, 2);
});

test("Claude rejects a window-host tuple that no longer matches its exact registry", (t) => {
  const fixture = materialize(t, "claude-code", ["identity-registered", "claude-window-operation"]);
  coherentClaudeWindowHost(fixture.workspaceRoot);
  const hostFile = path.join(
    fixture.workspaceRoot,
    ".wakeflow-local/wakeflow-delivery/hosts/claude-code/window-host/ProductWindow.json",
  );
  const host = readJson(hostFile);
  writeJson(hostFile, {
    ...host,
    bindingId: "@wakeflow-mismatched-binding",
    hostReceipt: {
      ...host.hostReceipt,
      bindingId: "@wakeflow-mismatched-binding",
    },
  });
  const sourcePlan = migrationPlan(t, {
    artifactRoot: CLAUDE_ARTIFACT,
    hostProfile: claudeProfile,
    workspaceRoot: fixture.workspaceRoot,
  });
  const plan = inspectClaudeMigrationDecommissionPlan({
    migrationPlan: sourcePlan,
    workspaceRoot: fixture.workspaceRoot,
  });
  assert.equal(plan.status, "blocked");
  assert.ok(plan.subjects.some((subject) => (
    subject.blockerCodes.includes("migration-claude-window-host-registration-mismatch")
  )));
});

test("Claude helper runtime residue stays blocked for a later journaled owner effect", (t) => {
  const fixture = materialize(t, "claude-code", []);
  const residue = path.join(
    fixture.workspaceRoot,
    ".wakeflow-local/wakeflow-delivery/hosts/claude-code/paste-ProductWindow.lock",
  );
  writeJson(residue, { owner: "@wakeflow-legacy-helper" });
  const sourcePlan = migrationPlan(t, {
    artifactRoot: CLAUDE_ARTIFACT,
    hostProfile: claudeProfile,
    workspaceRoot: fixture.workspaceRoot,
  });
  const plan = inspectClaudeMigrationDecommissionPlan({
    migrationPlan: sourcePlan,
    workspaceRoot: fixture.workspaceRoot,
  });
  assert.equal(plan.status, "blocked");
  assert.ok(plan.blockerCodes.includes("migration-claude-runtime-residue-requires-owner-effect"));
  assert.equal(JSON.stringify(plan).includes("ProductWindow"), false);
  assert.equal(JSON.stringify(plan).includes("legacy-helper"), false);
});

test("a drained Pod retained-resource follow-up remains an exact T08 prerequisite", (t) => {
  const fixture = materialize(t, "codex", ["pod-closed"]);
  archiveClosedPod(fixture.workspaceRoot);
  const sourcePlan = migrationPlan(t, {
    artifactRoot: CODEX_ARTIFACT,
    hostProfile: codexProfile,
    workspaceRoot: fixture.workspaceRoot,
  });
  assert.equal(sourcePlan.payload.ownerDrain.summary.status, "drained-with-host-followup");
  const resourceDependencies = sourcePlan.payload.dependencies.filter((dependency) => (
    dependency.code === "migration-host-decommission-resource-proof-required"
  ));
  assert.ok(resourceDependencies.length > 0);
  const plan = inspectCodexMigrationDecommissionPlan({
    migrationPlan: sourcePlan,
    workspaceRoot: fixture.workspaceRoot,
  });
  assert.equal(plan.status, "blocked");
  assert.deepEqual(
    plan.resourceFollowupDependencyIds,
    resourceDependencies.map((dependency) => dependency.dependencyId).sort(),
  );
  assert.ok(plan.blockerCodes.includes("migration-host-resource-followup-unresolved"));
  const archiveSubjects = plan.subjects.filter((subject) => (
    subject.effect === "archive" && subject.state === "ready"
  ));
  const outcome = recordCodexMigrationDecommissionOutcome({
    migrationPlan: sourcePlan,
    observations: archiveSubjects.map((subject) => ({
      status: "not-attempted",
      subjectId: subject.subjectId,
    })),
    plan,
    workspaceRoot: fixture.workspaceRoot,
  });
  assert.equal(assessMigrationHostDecommission({
    migrationPlan: sourcePlan,
    outcomes: [outcome],
    plans: [plan],
  }).summary.status, "blocked");
});

test("host source readers reject a symlink race surface without following it", (t) => {
  const fixture = materialize(t, "codex", ["identity-registered"]);
  const registry = path.join(
    fixture.workspaceRoot,
    ".wakeflow-local/wakeflow-delivery/hosts/codex/thread-registry/ProductWindow.json",
  );
  const target = path.join(fixture.workspaceRoot, "private-registry-target.json");
  writeFileSync(target, readFileSync(registry));
  rmSync(registry);
  symlinkSync(target, registry);
  const sourcePlan = migrationPlan(t, {
    artifactRoot: CODEX_ARTIFACT,
    hostProfile: codexProfile,
    workspaceRoot: fixture.workspaceRoot,
  });
  assert.throws(
    () => inspectCodexMigrationDecommissionPlan({
      migrationPlan: sourcePlan,
      workspaceRoot: fixture.workspaceRoot,
    }),
    (error) => error instanceof WakeflowCodexMigrationDecommissionError
      && error.code === "wakeflow-codex-migration-decommission-source",
  );
});

test("source drift, plan tampering, and missing coverage fail before any host outcome", (t) => {
  const fixture = materialize(t, "codex", ["identity-registered"]);
  const sourcePlan = migrationPlan(t, {
    artifactRoot: CODEX_ARTIFACT,
    hostProfile: codexProfile,
    workspaceRoot: fixture.workspaceRoot,
  });
  const plan = inspectCodexMigrationDecommissionPlan({ migrationPlan: sourcePlan, workspaceRoot: fixture.workspaceRoot });
  const tampered = structuredClone(plan);
  tampered.subjects[0].subjectDigest = `sha256:${"f".repeat(64)}`;
  assert.throws(
    () => validateMigrationHostDecommissionPlan(tampered),
    (error) => error instanceof WakeflowMigrationHostDecommissionError,
  );

  const registry = path.join(
    fixture.workspaceRoot,
    ".wakeflow-local/wakeflow-delivery/hosts/codex/thread-registry/ProductWindow.json",
  );
  writeFileSync(registry, `${readFileSync(registry, "utf8")} `);
  assert.throws(
    () => inspectCodexMigrationDecommissionPlan({ migrationPlan: sourcePlan, workspaceRoot: fixture.workspaceRoot }),
    (error) => error instanceof WakeflowCodexMigrationDecommissionError
      && error.code === "wakeflow-codex-migration-decommission-stale",
  );
});

test("portable assessment reports a missing host outcome rather than trusting a plan digest", (t) => {
  const fixture = materialize(t, "codex", ["identity-registered"]);
  const sourcePlan = migrationPlan(t, {
    artifactRoot: CODEX_ARTIFACT,
    hostProfile: codexProfile,
    workspaceRoot: fixture.workspaceRoot,
  });
  const plan = inspectCodexMigrationDecommissionPlan({
    migrationPlan: sourcePlan,
    workspaceRoot: fixture.workspaceRoot,
  });
  const assessment = assessMigrationHostDecommission({
    migrationPlan: sourcePlan,
    outcomes: [],
    plans: [plan],
  });
  assert.equal(assessment.summary.status, "blocked");
  assert.equal(assessment.summary.blockedCount, 1);
  assert.equal(assessment.coverage[0].status, "missing");
  assert.equal(assessment.coverage[0].outcomeDigest, null);
  assert.equal(assessment.coverage[0].planDigest, plan.planDigest);
});

test("shared decommission codecs reject behavioral arrays and dispatch getters", (t) => {
  const fixture = materialize(t, "codex", ["identity-registered"]);
  const sourcePlan = migrationPlan(t, {
    artifactRoot: CODEX_ARTIFACT,
    hostProfile: codexProfile,
    workspaceRoot: fixture.workspaceRoot,
  });
  const plan = inspectCodexMigrationDecommissionPlan({
    migrationPlan: sourcePlan,
    workspaceRoot: fixture.workspaceRoot,
  });
  const behavioralArray = structuredClone(plan);
  Object.defineProperty(behavioralArray.subjects, "hidden", {
    enumerable: false,
    value: "must-not-be-ignored",
  });
  assert.throws(
    () => validateMigrationHostDecommissionPlan(behavioralArray),
    (error) => error instanceof WakeflowMigrationHostDecommissionError
      && error.code === "wakeflow-migration-host-decommission-contract",
  );

  let getterCalls = 0;
  const behavioralArtifact = {};
  Object.defineProperty(behavioralArtifact, "artifactKind", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return WAKEFLOW_MIGRATION_HOST_DECOMMISSION_PLAN_KIND;
    },
  });
  assert.throws(
    () => migrationHostDecommissionCanonicalBytes(behavioralArtifact),
    (error) => error instanceof WakeflowMigrationHostDecommissionError,
  );
  assert.equal(getterCalls, 0);

  const nonCanonicalText = structuredClone(plan);
  nonCanonicalText.blockerCodes = ["migration-e\u0301vidence-invalid"];
  nonCanonicalText.status = "blocked";
  resignArtifact(nonCanonicalText, "planDigest");
  assert.throws(
    () => validateMigrationHostDecommissionPlan(nonCanonicalText),
    (error) => error instanceof WakeflowMigrationHostDecommissionError,
  );

  const byteOversizedText = structuredClone(plan);
  byteOversizedText.blockerCodes = ["证".repeat(200)];
  byteOversizedText.status = "blocked";
  resignArtifact(byteOversizedText, "planDigest");
  assert.throws(
    () => validateMigrationHostDecommissionPlan(byteOversizedText),
    (error) => error instanceof WakeflowMigrationHostDecommissionError,
  );

  const archive = plan.subjects.find((subject) => subject.effect === "archive");
  const outcome = recordCodexMigrationDecommissionOutcome({
    migrationPlan: sourcePlan,
    observations: [{ status: "not-attempted", subjectId: archive.subjectId }],
    plan,
    workspaceRoot: fixture.workspaceRoot,
  });
  const rawSubjectOutcomes = outcome.subjectOutcomes.map((entry) => ({
    effectStatus: entry.effectStatus,
    evidenceDigest: entry.evidenceDigest,
    postCloseAttempts: entry.postCloseAttempts,
    proof: entry.proof,
    reasonCode: entry.reasonCode,
    status: entry.status,
    subjectId: entry.subjectId,
  }));
  let subjectGetterCalls = 0;
  const behavioralSubject = { ...rawSubjectOutcomes[0] };
  delete behavioralSubject.subjectId;
  Object.defineProperty(behavioralSubject, "subjectId", {
    enumerable: true,
    get() {
      subjectGetterCalls += 1;
      return rawSubjectOutcomes[0].subjectId;
    },
  });
  rawSubjectOutcomes[0] = behavioralSubject;
  assert.throws(
    () => createMigrationHostDecommissionOutcome({ plan, subjectOutcomes: rawSubjectOutcomes }),
    (error) => error instanceof WakeflowMigrationHostDecommissionError,
  );
  assert.equal(subjectGetterCalls, 0);
});

test("migration-plan owner drain blocker cannot be removed by re-signing", (t) => {
  const fixture = materialize(t, "codex", ["identity-registered", "pod-open"]);
  const sourcePlan = migrationPlan(t, {
    artifactRoot: CODEX_ARTIFACT,
    hostProfile: codexProfile,
    workspaceRoot: fixture.workspaceRoot,
  });
  assert.equal(sourcePlan.payload.ownerDrain.summary.ownerDrainSatisfied, false);
  const plan = inspectCodexMigrationDecommissionPlan({
    migrationPlan: sourcePlan,
    workspaceRoot: fixture.workspaceRoot,
  });
  assert.ok(plan.blockerCodes.includes("migration-legacy-owner-drain-not-satisfied"));

  const tampered = structuredClone(plan);
  tampered.blockerCodes = tampered.blockerCodes.filter((code) => (
    code !== "migration-legacy-owner-drain-not-satisfied"
  ));
  tampered.status = tampered.blockerCodes.length === 0 ? "ready" : "blocked";
  resignArtifact(tampered, "planDigest");
  assert.deepEqual(validateMigrationHostDecommissionPlan(tampered), tampered);
  assert.throws(
    () => assertMigrationHostDecommissionPlanAgainstMigrationPlan({
      migrationPlan: sourcePlan,
      plan: tampered,
    }),
    (error) => error instanceof WakeflowMigrationHostDecommissionError
      && error.code === "wakeflow-migration-host-decommission-stale",
  );
});

test("a blocked subject cannot be re-signed as machine verified", (t) => {
  const fixture = materialize(t, "claude-code", ["identity-registered"]);
  const sourcePlan = migrationPlan(t, {
    artifactRoot: CLAUDE_ARTIFACT,
    hostProfile: claudeProfile,
    workspaceRoot: fixture.workspaceRoot,
  });
  const plan = inspectClaudeMigrationDecommissionPlan({
    migrationPlan: sourcePlan,
    workspaceRoot: fixture.workspaceRoot,
  });
  const outcome = recordClaudeMigrationDecommissionOutcome({
    migrationPlan: sourcePlan,
    observations: [],
    plan,
    workspaceRoot: fixture.workspaceRoot,
  });
  const tampered = structuredClone(outcome);
  const close = tampered.subjectOutcomes.find((entry) => entry.effect === "close");
  assert.equal(close.status, "blocked");
  Object.assign(close, {
    effectStatus: "succeeded",
    postCloseAttempts: 1,
    proof: "exact-post-close-absence",
    reasonCode: null,
    status: "machine-verified",
  });
  resignHostOutcome(tampered);
  assert.deepEqual(validateMigrationHostDecommissionOutcome(tampered), tampered);
  assert.throws(
    () => assertMigrationHostDecommissionOutcomeAgainstPlan({ outcome: tampered, plan }),
    (error) => error instanceof WakeflowMigrationHostDecommissionError
      && error.code === "wakeflow-migration-host-decommission-stale",
  );

  const incomplete = structuredClone(outcome);
  incomplete.subjectOutcomes.pop();
  resignHostOutcome(incomplete);
  assert.deepEqual(validateMigrationHostDecommissionOutcome(incomplete), incomplete);
  assert.throws(
    () => assertMigrationHostDecommissionOutcomeAgainstPlan({ outcome: incomplete, plan }),
    (error) => error instanceof WakeflowMigrationHostDecommissionError
      && error.code === "wakeflow-migration-host-decommission-stale",
  );
});

test("portable assessment preserves the I3 host and status matrix", (t) => {
  const fixture = materialize(t, "claude-code", ["identity-registered", "claude-window-operation"]);
  coherentClaudeWindowHost(fixture.workspaceRoot);
  const sourcePlan = migrationPlan(t, {
    artifactRoot: CLAUDE_ARTIFACT,
    hostProfile: claudeProfile,
    workspaceRoot: fixture.workspaceRoot,
  });
  const plan = inspectClaudeMigrationDecommissionPlan({
    migrationPlan: sourcePlan,
    workspaceRoot: fixture.workspaceRoot,
  });
  const close = plan.subjects.find((subject) => subject.effect === "close");
  const outcome = recordClaudeMigrationDecommissionOutcome({
    migrationPlan: sourcePlan,
    observations: [{
      closeStatus: "succeeded",
      effectCheckpoint: "completed",
      postCloseAttempts: 1,
      postCloseStatus: "absent",
      preCloseStatus: "live",
      subjectId: close.subjectId,
    }],
    plan,
    workspaceRoot: fixture.workspaceRoot,
  });
  const assessment = assessMigrationHostDecommission({
    migrationPlan: sourcePlan,
    outcomes: [outcome],
    plans: [plan],
  });
  const tampered = structuredClone(assessment);
  tampered.coverage[0].hostId = "codex";
  tampered.coverage[0].coverageId = canonicalJsonDigest({
    evidenceDigest: null,
    hostId: "codex",
    sourceIds: tampered.coverage[0].sourceIds,
    status: "required",
  });
  resignArtifact(tampered, "assessmentDigest");
  assert.throws(
    () => validateMigrationHostDecommissionAssessment(tampered),
    (error) => error instanceof WakeflowMigrationHostDecommissionError
      && error.code === "wakeflow-migration-host-decommission-assessment",
  );
});

test("host outcome adapters reject behavioral observation arrays before accepting evidence", (t) => {
  const codexFixture = materialize(t, "codex", ["identity-registered"]);
  const codexMigrationPlan = migrationPlan(t, {
    artifactRoot: CODEX_ARTIFACT,
    hostProfile: codexProfile,
    workspaceRoot: codexFixture.workspaceRoot,
  });
  const codexPlan = inspectCodexMigrationDecommissionPlan({
    migrationPlan: codexMigrationPlan,
    workspaceRoot: codexFixture.workspaceRoot,
  });
  const archive = codexPlan.subjects.find((subject) => subject.effect === "archive");
  const codexObservations = [{ status: "not-attempted", subjectId: archive.subjectId }];
  Object.defineProperty(codexObservations, "hidden", {
    enumerable: false,
    value: "must-not-be-ignored",
  });
  assert.throws(
    () => recordCodexMigrationDecommissionOutcome({
      migrationPlan: codexMigrationPlan,
      observations: codexObservations,
      plan: codexPlan,
      workspaceRoot: codexFixture.workspaceRoot,
    }),
    (error) => error instanceof WakeflowCodexMigrationDecommissionError
      && error.code === "wakeflow-codex-migration-decommission-contract",
  );

  const claudeFixture = materialize(t, "claude-code", ["identity-registered", "claude-window-operation"]);
  coherentClaudeWindowHost(claudeFixture.workspaceRoot);
  const claudeMigrationPlan = migrationPlan(t, {
    artifactRoot: CLAUDE_ARTIFACT,
    hostProfile: claudeProfile,
    workspaceRoot: claudeFixture.workspaceRoot,
  });
  const claudePlan = inspectClaudeMigrationDecommissionPlan({
    migrationPlan: claudeMigrationPlan,
    workspaceRoot: claudeFixture.workspaceRoot,
  });
  const close = claudePlan.subjects.find((subject) => subject.effect === "close");
  const claudeObservations = [{
    closeStatus: "not-attempted",
    effectCheckpoint: "not-started",
    postCloseAttempts: 0,
    postCloseStatus: "not-attempted",
    preCloseStatus: "live",
    subjectId: close.subjectId,
  }];
  Object.defineProperty(claudeObservations, Symbol("hidden"), {
    enumerable: false,
    value: "must-not-be-ignored",
  });
  assert.throws(
    () => recordClaudeMigrationDecommissionOutcome({
      migrationPlan: claudeMigrationPlan,
      observations: claudeObservations,
      plan: claudePlan,
      workspaceRoot: claudeFixture.workspaceRoot,
    }),
    (error) => error instanceof WakeflowClaudeMigrationDecommissionError
      && error.code === "wakeflow-claude-migration-decommission-contract",
  );
});

test("Claude window-host receipt must close over its top-level registration facts", (t) => {
  const fixture = materialize(t, "claude-code", ["identity-registered", "claude-window-operation"]);
  coherentClaudeWindowHost(fixture.workspaceRoot);
  const hostFile = path.join(
    fixture.workspaceRoot,
    ".wakeflow-local/wakeflow-delivery/hosts/claude-code/window-host/ProductWindow.json",
  );
  const host = readJson(hostFile);
  writeJson(hostFile, {
    ...host,
    hostReceipt: {
      ...host.hostReceipt,
      bindingId: "@wakeflow-stale-receipt-binding",
    },
  });
  const sourcePlan = migrationPlan(t, {
    artifactRoot: CLAUDE_ARTIFACT,
    hostProfile: claudeProfile,
    workspaceRoot: fixture.workspaceRoot,
  });
  const plan = inspectClaudeMigrationDecommissionPlan({
    migrationPlan: sourcePlan,
    workspaceRoot: fixture.workspaceRoot,
  });
  assert.equal(plan.status, "blocked");
  assert.ok(
    plan.subjects.some((subject) => subject.blockerCodes.includes("migration-claude-window-host-missing"))
      || sourcePlan.payload.decommissionCoverage.some((entry) => entry.hostId === "unknown"),
  );
});

test("oversized host identity tokens cannot satisfy complete decommission coverage", (t) => {
  const fixture = materialize(t, "codex", ["identity-registered"]);
  const hostRoot = path.join(
    fixture.workspaceRoot,
    ".wakeflow-local/wakeflow-delivery/hosts/codex",
  );
  const registrationFile = path.join(hostRoot, "thread-registry/ProductWindow.json");
  const configFile = path.join(hostRoot, "window-config/ProductWindow.json");
  const bindingId = "证".repeat(1400);
  writeJson(registrationFile, {
    ...readJson(registrationFile),
    bindingId,
  });
  writeJson(configFile, {
    ...readJson(configFile),
    threadBindingId: bindingId,
  });
  const sourcePlan = migrationPlan(t, {
    artifactRoot: CODEX_ARTIFACT,
    hostProfile: codexProfile,
    workspaceRoot: fixture.workspaceRoot,
  });
  const plan = inspectCodexMigrationDecommissionPlan({
    migrationPlan: sourcePlan,
    workspaceRoot: fixture.workspaceRoot,
  });
  const unknownCoverage = sourcePlan.payload.decommissionCoverage.some((entry) => entry.hostId === "unknown");
  assert.ok(plan.status === "blocked" || unknownCoverage);
  const archiveSubjects = plan.subjects.filter((subject) => (
    subject.effect === "archive" && subject.state === "ready"
  ));
  const outcome = recordCodexMigrationDecommissionOutcome({
    migrationPlan: sourcePlan,
    observations: archiveSubjects.map((subject) => ({
      status: "not-attempted",
      subjectId: subject.subjectId,
    })),
    plan,
    workspaceRoot: fixture.workspaceRoot,
  });
  assert.equal(assessMigrationHostDecommission({
    migrationPlan: sourcePlan,
    outcomes: [outcome],
    plans: [plan],
  }).summary.status, "blocked");
});

test("host source readers reject malformed UTF-8 even when replacement decoding would parse", (t) => {
  const fixture = materialize(t, "codex", ["identity-registered"]);
  const registrationFile = path.join(
    fixture.workspaceRoot,
    ".wakeflow-local/wakeflow-delivery/hosts/codex/thread-registry/ProductWindow.json",
  );
  const registration = readJson(registrationFile);
  const encoded = Buffer.from(JSON.stringify({ ...registration, ignored: "XX" }), "utf8");
  const marker = encoded.indexOf(Buffer.from("XX", "utf8"));
  assert.notEqual(marker, -1);
  encoded[marker] = 0xc3;
  encoded[marker + 1] = 0x28;
  writeFileSync(registrationFile, encoded);
  const sourcePlan = migrationPlan(t, {
    artifactRoot: CODEX_ARTIFACT,
    hostProfile: codexProfile,
    workspaceRoot: fixture.workspaceRoot,
  });
  assert.throws(
    () => inspectCodexMigrationDecommissionPlan({
      migrationPlan: sourcePlan,
      workspaceRoot: fixture.workspaceRoot,
    }),
    (error) => error instanceof WakeflowCodexMigrationDecommissionError
      && error.code === "wakeflow-codex-migration-decommission-source",
  );

  const claudeFixture = materialize(t, "claude-code", ["identity-registered"]);
  const claudeRegistrationFile = path.join(
    claudeFixture.workspaceRoot,
    ".wakeflow-local/wakeflow-delivery/hosts/claude-code/thread-registry/ProductWindow.json",
  );
  const claudeRegistration = readJson(claudeRegistrationFile);
  const claudeEncoded = Buffer.from(JSON.stringify({ ...claudeRegistration, ignored: "XX" }), "utf8");
  const claudeMarker = claudeEncoded.indexOf(Buffer.from("XX", "utf8"));
  assert.notEqual(claudeMarker, -1);
  claudeEncoded[claudeMarker] = 0xc3;
  claudeEncoded[claudeMarker + 1] = 0x28;
  writeFileSync(claudeRegistrationFile, claudeEncoded);
  const claudeSourcePlan = migrationPlan(t, {
    artifactRoot: CLAUDE_ARTIFACT,
    hostProfile: claudeProfile,
    workspaceRoot: claudeFixture.workspaceRoot,
  });
  assert.throws(
    () => inspectClaudeMigrationDecommissionPlan({
      migrationPlan: claudeSourcePlan,
      workspaceRoot: claudeFixture.workspaceRoot,
    }),
    (error) => error instanceof WakeflowClaudeMigrationDecommissionError
      && error.code === "wakeflow-claude-migration-decommission-source",
  );
});
