import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  WAKEFLOW_HOST_ACTIVATION_SCOPE_KIND,
  WAKEFLOW_HOST_ACTIVATION_SCOPE_SCHEMA_VERSION,
  validateHostActivationScopeObservation,
} from "../core/scripts/lib/wakeflow-host-activation-scope.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const gateModulePath = path.join(
  repositoryRoot,
  "core/scripts/lib/wakeflow-host-activation-gate.mjs",
);
const ROOT_A = "/portable-fixture/workspace-a";
const ROOT_B = "/portable-fixture/workspace-b";
const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;
const DIGEST_C = `sha256:${"c".repeat(64)}`;
const OBSERVED_AT = "2026-08-11T12:00:00.000Z";

const EXPECTED_EXPORTS = Object.freeze([
  "HOST_ACTIVATION_GATE_STATUSES",
  "WAKEFLOW_HOST_ACTIVATION_GATE_SCHEMA_VERSION",
  "WAKEFLOW_HOST_ACTIVATION_REPORT_KIND",
  "WAKEFLOW_WORKSPACE_ACTIVATION_SUBJECT_KIND",
  "WAKEFLOW_WORKSPACE_CUTOVER_OBSERVATION_KIND",
  "WakeflowHostActivationGateError",
  "createWakeflowWorkspaceActivationSubjectDigest",
  "createWakeflowWorkspaceCutoverObservation",
  "evaluateWakeflowHostActivationGate",
  "hostActivationReportDigest",
  "validateWakeflowHostActivationReport",
]);

async function loadGate() {
  return import(pathToFileURL(gateModulePath).href);
}

function scopeObservation({
  workspaceSubjectDigest,
  scope,
  hostId = "claude-code",
} = {}) {
  const exact = scope === "per-workspace" || scope === "host-wide";
  return validateHostActivationScopeObservation({
    kind: WAKEFLOW_HOST_ACTIVATION_SCOPE_KIND,
    schemaVersion: WAKEFLOW_HOST_ACTIVATION_SCOPE_SCHEMA_VERSION,
    hostId,
    pluginId: "wakeflow@gxfn",
    workspaceSubjectDigest,
    scope,
    evidence: exact
      ? {
          kind: "exact-host-installation-observation",
          digest: DIGEST_A,
          reasonCode: scope === "per-workspace"
            ? "workspace-scoped-installation-observed"
            : "host-wide-installation-observed",
        }
      : {
          kind: "host-observation-unavailable",
          digest: null,
          reasonCode: "host-observation-unavailable",
        },
    unattendedEligibility: scope === "per-workspace"
      ? "m6-evaluation-required"
      : "forbidden",
    observedAt: OBSERVED_AT,
  });
}

function cutover(gate, workspaceSubjectDigest, status = "v3-ready", evidenceDigest = DIGEST_B) {
  return gate.createWakeflowWorkspaceCutoverObservation({
    workspaceSubjectDigest,
    status,
    evidenceDigest,
  });
}

function manualCoverage(workspaceCutovers, {
  disposition = "known-set-complete",
  acknowledgementDigest = DIGEST_C,
} = {}) {
  return { disposition, acknowledgementDigest, workspaceCutovers };
}

test("M6-T11 ships one exact shared activation gate owner", async () => {
  assert.equal(existsSync(gateModulePath), true);
  const gate = await loadGate();
  assert.deepEqual(Object.keys(gate).sort(), [...EXPECTED_EXPORTS].sort());
  assert.equal(gate.WAKEFLOW_HOST_ACTIVATION_GATE_SCHEMA_VERSION, 1);
  assert.equal(gate.WAKEFLOW_WORKSPACE_ACTIVATION_SUBJECT_KIND, "WakeflowWorkspaceActivationSubject");
  assert.equal(gate.WAKEFLOW_WORKSPACE_CUTOVER_OBSERVATION_KIND, "WakeflowWorkspaceCutoverObservation");
  assert.equal(gate.WAKEFLOW_HOST_ACTIVATION_REPORT_KIND, "WakeflowHostActivationReport");
  assert.deepEqual(gate.HOST_ACTIVATION_GATE_STATUSES, ["blocked", "manual-host-gate", "ready"]);
  assert.equal(Object.isFrozen(gate.HOST_ACTIVATION_GATE_STATUSES), true);
});

test("M6-T11 derives an opaque domain-separated workspace subject without filesystem discovery", async () => {
  const gate = await loadGate();
  const first = gate.createWakeflowWorkspaceActivationSubjectDigest({ workspaceRoot: ROOT_A });
  const replay = gate.createWakeflowWorkspaceActivationSubjectDigest({ workspaceRoot: ROOT_A });
  const another = gate.createWakeflowWorkspaceActivationSubjectDigest({ workspaceRoot: ROOT_B });
  assert.match(first, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(replay, first);
  assert.notEqual(another, first);
  assert.equal(first.includes(ROOT_A), false);
  assert.throws(
    () => gate.createWakeflowWorkspaceActivationSubjectDigest({ workspaceRoot: "relative/root" }),
    (error) => error?.code === "wakeflow-host-activation-gate-root",
  );
  assert.throws(
    () => gate.createWakeflowWorkspaceActivationSubjectDigest({
      workspaceRoot: ROOT_A,
      workspaceRegistry: [ROOT_B],
    }),
    (error) => error?.code === "wakeflow-host-activation-gate-contract",
  );
  const source = readFileSync(gateModulePath, "utf8");
  assert.doesNotMatch(source, /node:fs|readdir|glob|workspace[-_ ]registry/iu);
});

test("M6-T11 requires exact current cutover before per-workspace scope becomes machine-ready", async () => {
  const gate = await loadGate();
  const workspaceSubjectDigest = gate.createWakeflowWorkspaceActivationSubjectDigest({
    workspaceRoot: ROOT_A,
  });
  const observation = scopeObservation({ workspaceSubjectDigest, scope: "per-workspace" });
  const pending = gate.evaluateWakeflowHostActivationGate({
    scopeObservation: observation,
    currentCutover: cutover(gate, workspaceSubjectDigest, "pending"),
    manualCoverage: null,
  });
  assert.equal(pending.status, "blocked");
  assert.equal(pending.activationDisposition, "do-not-activate");
  assert.equal(pending.unattendedEligibility, "forbidden");
  assert.deepEqual(pending.reasonCodes, ["workspace-cutover-incomplete"]);

  const ready = gate.evaluateWakeflowHostActivationGate({
    scopeObservation: observation,
    currentCutover: cutover(gate, workspaceSubjectDigest),
    manualCoverage: null,
  });
  assert.equal(ready.status, "ready");
  assert.equal(ready.activationDisposition, "machine-ready");
  assert.equal(ready.unattendedEligibility, "eligible");
  assert.deepEqual(ready.reasonCodes, []);
  assert.equal(ready.scope, "per-workspace");
  assert.equal(ready.workspaceSubjectDigest, workspaceSubjectDigest);
  assert.equal(ready.coverage.status, "not-required");
  assert.equal(ready.coverage.knownWorkspaceCount, 0);
  assert.equal(ready.coverage.knownWorkspaceSetDigest, null);
  assert.equal(Object.isFrozen(ready), true);
  assert.equal(Object.isFrozen(ready.currentCutover), true);
  assert.equal(Object.isFrozen(ready.coverage), true);
  assert.deepEqual(gate.validateWakeflowHostActivationReport(ready), ready);
  assert.equal(gate.hostActivationReportDigest(ready), gate.hostActivationReportDigest(ready));

  const otherSubject = gate.createWakeflowWorkspaceActivationSubjectDigest({ workspaceRoot: ROOT_B });
  assert.throws(
    () => gate.evaluateWakeflowHostActivationGate({
      scopeObservation: observation,
      currentCutover: cutover(gate, otherSubject),
      manualCoverage: null,
    }),
    (error) => error?.code === "wakeflow-host-activation-gate-subject",
  );
});

test("M6-T11 keeps host-wide activation manual even after an explicit known-set decision", async () => {
  const gate = await loadGate();
  const currentSubject = gate.createWakeflowWorkspaceActivationSubjectDigest({ workspaceRoot: ROOT_A });
  const otherSubject = gate.createWakeflowWorkspaceActivationSubjectDigest({ workspaceRoot: ROOT_B });
  const observation = scopeObservation({ workspaceSubjectDigest: currentSubject, scope: "host-wide" });
  const current = cutover(gate, currentSubject);
  const other = cutover(gate, otherSubject, "v3-ready", DIGEST_C);
  const blocked = gate.evaluateWakeflowHostActivationGate({
    scopeObservation: observation,
    currentCutover: current,
    manualCoverage: null,
  });
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.unattendedEligibility, "forbidden");
  assert.deepEqual(blocked.reasonCodes, ["host-wide-coverage-acknowledgement-required"]);

  const acknowledged = gate.evaluateWakeflowHostActivationGate({
    scopeObservation: observation,
    currentCutover: current,
    manualCoverage: manualCoverage([other, current]),
  });
  const reversed = gate.evaluateWakeflowHostActivationGate({
    scopeObservation: observation,
    currentCutover: current,
    manualCoverage: manualCoverage([current, other]),
  });
  assert.equal(acknowledged.status, "manual-host-gate");
  assert.equal(acknowledged.activationDisposition, "manual-only");
  assert.equal(acknowledged.unattendedEligibility, "forbidden");
  assert.deepEqual(acknowledged.reasonCodes, ["host-wide-manual-coverage-acknowledged"]);
  assert.equal(acknowledged.coverage.status, "manual-acknowledged");
  assert.equal(acknowledged.coverage.disposition, "known-set-complete");
  assert.equal(acknowledged.coverage.knownWorkspaceCount, 2);
  assert.equal(acknowledged.coverage.knownWorkspaceSetDigest, reversed.coverage.knownWorkspaceSetDigest);
  assert.equal(gate.hostActivationReportDigest(acknowledged), gate.hostActivationReportDigest(reversed));
  assert.equal(JSON.stringify(acknowledged).includes(otherSubject), false);
});

test("M6-T11 accepts unlisted migration-required risk only as an external manual coverage decision", async () => {
  const gate = await loadGate();
  const currentSubject = gate.createWakeflowWorkspaceActivationSubjectDigest({ workspaceRoot: ROOT_A });
  const otherSubject = gate.createWakeflowWorkspaceActivationSubjectDigest({ workspaceRoot: ROOT_B });
  const observation = scopeObservation({ workspaceSubjectDigest: currentSubject, scope: "host-wide" });
  const current = cutover(gate, currentSubject);
  const legacy = cutover(gate, otherSubject, "migration-required", DIGEST_C);

  assert.throws(
    () => gate.evaluateWakeflowHostActivationGate({
      scopeObservation: observation,
      currentCutover: current,
      manualCoverage: manualCoverage([current, legacy]),
    }),
    (error) => error?.code === "wakeflow-host-activation-gate-coverage",
  );

  const accepted = gate.evaluateWakeflowHostActivationGate({
    scopeObservation: observation,
    currentCutover: current,
    manualCoverage: manualCoverage([legacy, current], {
      disposition: "accept-unlisted-migration-required",
    }),
  });
  assert.equal(accepted.status, "manual-host-gate");
  assert.equal(accepted.unattendedEligibility, "forbidden");
  assert.equal(accepted.coverage.disposition, "accept-unlisted-migration-required");
  assert.equal(accepted.coverage.knownWorkspaceCount, 2);
});

test("M6-T11 unknown scope never becomes unattended authority", async () => {
  const gate = await loadGate();
  const currentSubject = gate.createWakeflowWorkspaceActivationSubjectDigest({ workspaceRoot: ROOT_A });
  const observation = scopeObservation({
    workspaceSubjectDigest: currentSubject,
    scope: "unknown",
    hostId: "codex",
  });
  const current = cutover(gate, currentSubject);
  const blocked = gate.evaluateWakeflowHostActivationGate({
    scopeObservation: observation,
    currentCutover: current,
    manualCoverage: null,
  });
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.unattendedEligibility, "forbidden");
  assert.deepEqual(blocked.reasonCodes, [
    "activation-scope-unknown",
    "unknown-scope-coverage-acknowledgement-required",
  ]);

  const manual = gate.evaluateWakeflowHostActivationGate({
    scopeObservation: observation,
    currentCutover: current,
    manualCoverage: manualCoverage([current]),
  });
  assert.equal(manual.status, "manual-host-gate");
  assert.equal(manual.activationDisposition, "manual-only");
  assert.equal(manual.unattendedEligibility, "forbidden");
  assert.deepEqual(manual.reasonCodes, [
    "activation-scope-unknown",
    "unknown-scope-manual-coverage-acknowledged",
  ]);
  assert.throws(
    () => gate.evaluateWakeflowHostActivationGate({
      scopeObservation: observation,
      currentCutover: current,
      manualCoverage: {
        ...manualCoverage([current]),
        scope: "per-workspace",
      },
    }),
    (error) => error?.code === "wakeflow-host-activation-gate-contract",
  );
});

test("M6-T11 rejects authority hidden outside dense coverage and reason slots", async () => {
  const gate = await loadGate();
  const currentSubject = gate.createWakeflowWorkspaceActivationSubjectDigest({ workspaceRoot: ROOT_A });
  const observation = scopeObservation({ workspaceSubjectDigest: currentSubject, scope: "unknown" });
  const current = cutover(gate, currentSubject);

  for (const decorate of [
    (array) => Object.defineProperty(array, "authority", {
      value: "per-workspace",
      enumerable: false,
    }),
    (array) => {
      array[Symbol("authority")] = "per-workspace";
      return array;
    },
    (array) => Object.setPrototypeOf(array, { map: Array.prototype.map }),
  ]) {
    const workspaceCutovers = decorate([current]);
    assert.throws(
      () => gate.evaluateWakeflowHostActivationGate({
        scopeObservation: observation,
        currentCutover: current,
        manualCoverage: manualCoverage(workspaceCutovers),
      }),
      (error) => error?.code === "wakeflow-host-activation-gate-contract",
    );
  }

  const report = gate.evaluateWakeflowHostActivationGate({
    scopeObservation: observation,
    currentCutover: current,
    manualCoverage: null,
  });
  const reasonCodes = [...report.reasonCodes];
  Object.defineProperty(reasonCodes, "authority", { value: "ready", enumerable: false });
  assert.throws(
    () => gate.validateWakeflowHostActivationReport({ ...report, reasonCodes }),
    (error) => error?.code === "wakeflow-host-activation-gate-contract",
  );
});
