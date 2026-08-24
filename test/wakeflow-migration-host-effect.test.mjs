import assert from "node:assert/strict";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { hostProfile as codexProfile } from "../plugins/codex-wakeflow/scripts/lib/wakeflow-host-profile.mjs";
import { hostProfile as claudeProfile } from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-host-profile.mjs";
import {
  WAKEFLOW_CODEX_MIGRATION_EFFECT_HOST_ID,
  WAKEFLOW_CODEX_MIGRATION_EFFECT_PLAN_SCHEMA_ID,
  WAKEFLOW_CODEX_MIGRATION_EFFECT_SCHEMA_VERSION,
  WakeflowCodexMigrationEffectError,
  createCodexMigrationHostEffectParticipant,
  planCodexMigrationHostEffects,
} from "../plugins/codex-wakeflow/scripts/lib/wakeflow-codex-migration-effect.mjs";
import {
  inspectCodexMigrationDecommissionPlan,
  recordCodexMigrationDecommissionOutcome,
} from "../plugins/codex-wakeflow/scripts/lib/wakeflow-codex-migration-decommission.mjs";
import {
  WAKEFLOW_CLAUDE_MIGRATION_EFFECT_HOST_ID,
  WAKEFLOW_CLAUDE_MIGRATION_EFFECT_PLAN_SCHEMA_ID,
  WAKEFLOW_CLAUDE_MIGRATION_EFFECT_SCHEMA_VERSION,
  createClaudeMigrationHostEffectParticipant,
  planClaudeMigrationHostEffects,
} from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-migration-effect.mjs";
import {
  inspectClaudeMigrationDecommissionPlan,
  recordClaudeMigrationDecommissionOutcome,
} from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-migration-decommission.mjs";
import {
  createWakeflowMigrationManualAcknowledgement,
  planWakeflowMigrationApply,
} from "../core/scripts/lib/wakeflow-migration-apply.mjs";
import {
  canonicalJsonDigest,
} from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import {
  createMigrationApplyPhaseFixtures,
} from "./support/wakeflow-migration-apply-fixture.mjs";
import {
  createMigrationFixturePlan,
} from "./support/wakeflow-migration-v3-fixture.mjs";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "..");
const CODEX_ARTIFACT = path.join(REPOSITORY_ROOT, "plugins/codex-wakeflow");
const CLAUDE_ARTIFACT = path.join(REPOSITORY_ROOT, "plugins/claude-code-wakeflow");
const EVIDENCE_DIGEST = canonicalJsonDigest({ fixture: "host-effect-evidence" });

function materialize(t, host, scenarios) {
  const sandbox = mkdtempSync(path.join(os.tmpdir(), `wakeflow-t08-effect-${host}-`));
  t.after(() => rmSync(sandbox, { recursive: true, force: true }));
  const origin = path.join(
    REPOSITORY_ROOT,
    `test/fixtures/legacy-origins/${host}-0.9.6-70d79d72`,
  );
  cpSync(path.join(origin, "static/shared-setup"), sandbox, { recursive: true });
  for (const scenario of scenarios) {
    cpSync(path.join(origin, `scenarios/${scenario}/output`), sandbox, { recursive: true });
  }
  return realpathSync(path.join(sandbox, "WakeflowFixture"));
}

function migrationPlan(t, { artifactRoot, hostProfile, workspaceRoot }) {
  return createMigrationFixturePlan({
    bootstrapArtifactRoot: artifactRoot,
    legacyOwnerArtifactRoot: artifactRoot,
    hostProfile,
    onCleanup: (cleanup) => t.after(cleanup),
    workspaceRoot,
  });
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
}

function callbackArgs(snapshot, step, records = {}) {
  return { plan: snapshot.snapshot, step, ...records };
}

function portableEffectRecord(step, checkpoint, result, outcome, ordinal = 0) {
  return {
    stepId: step.stepId,
    ordinal,
    effectKind: step.effectKind,
    intentDigest: step.intentDigest,
    checkpoint,
    result,
    outcome,
  };
}

function resignOwnerRecord(record, payload) {
  return {
    ...record,
    payload,
    recordDigest: canonicalJsonDigest({ schemaId: record.schemaId, payload }),
  };
}

test("M6-T08 host effect owners expose only bounded host-specific planning and participant seams", () => {
  assert.equal(WAKEFLOW_CODEX_MIGRATION_EFFECT_HOST_ID, "codex");
  assert.equal(WAKEFLOW_CODEX_MIGRATION_EFFECT_SCHEMA_VERSION, 1);
  assert.equal(
    WAKEFLOW_CODEX_MIGRATION_EFFECT_PLAN_SCHEMA_ID,
    "urn:wakeflow:internal:codex-migration-host-effect-plan:v1",
  );
  assert.equal(WAKEFLOW_CLAUDE_MIGRATION_EFFECT_HOST_ID, "claude-code");
  assert.equal(WAKEFLOW_CLAUDE_MIGRATION_EFFECT_SCHEMA_VERSION, 1);
  assert.equal(
    WAKEFLOW_CLAUDE_MIGRATION_EFFECT_PLAN_SCHEMA_ID,
    "urn:wakeflow:internal:claude-migration-host-effect-plan:v1",
  );
  assert.equal(typeof planCodexMigrationHostEffects, "function");
  assert.equal(typeof createCodexMigrationHostEffectParticipant, "function");
  assert.equal(typeof planClaudeMigrationHostEffects, "function");
  assert.equal(typeof createClaudeMigrationHostEffectParticipant, "function");
  assert.equal(
    codexProfile.artifact.migrationEffectHostFile,
    "scripts/lib/wakeflow-codex-migration-effect.mjs",
  );
  assert.equal(
    claudeProfile.artifact.migrationEffectHostFile,
    "scripts/lib/wakeflow-claude-migration-effect.mjs",
  );
});

test("Codex requires exact archived observation plus per-subject manual acknowledgement and never resends during recovery", async (t) => {
  const workspaceRoot = materialize(t, "codex", ["identity-registered"]);
  const sourcePlan = migrationPlan(t, {
    artifactRoot: CODEX_ARTIFACT,
    hostProfile: codexProfile,
    workspaceRoot,
  });
  const hostPlan = inspectCodexMigrationDecommissionPlan({ migrationPlan: sourcePlan, workspaceRoot });
  const snapshot = planCodexMigrationHostEffects({ workspaceRoot, migrationPlan: sourcePlan, hostPlan });
  const archive = hostPlan.subjects.find((subject) => subject.effect === "archive");
  const acknowledgement = createWakeflowMigrationManualAcknowledgement({
    migrationPlan: sourcePlan,
    hostPlan,
    subjectId: archive.subjectId,
  });
  assert.equal(snapshot.snapshot.payload.steps.length, 1);
  assert.equal(JSON.stringify(snapshot).includes("ProductWindow"), false);
  assert.equal(JSON.stringify(snapshot).includes("@wakeflow-scenario-thread"), false);

  const calls = { preflight: 0, archive: 0, recover: 0 };
  const owner = createCodexMigrationHostEffectParticipant({
    workspaceRoot,
    migrationPlan: sourcePlan,
    hostPlan,
    hostEffectSnapshot: snapshot,
    manualAcknowledgements: [acknowledgement],
    adapter: {
      async preflight() {
        calls.preflight += 1;
        return { status: "ready", evidenceDigest: EVIDENCE_DIGEST };
      },
      async archive() {
        calls.archive += 1;
        return { status: "archived", evidenceDigest: EVIDENCE_DIGEST };
      },
      async recover() {
        calls.recover += 1;
        return { status: "archived", evidenceDigest: EVIDENCE_DIGEST };
      },
    },
  });
  const step = snapshot.snapshot.payload.steps[0];
  const handler = owner.participant.stepHandlers[step.stepId];
  const checkpoint = await handler.prepareEffect(callbackArgs(snapshot, step));
  await assert.rejects(
    handler.performEffect(callbackArgs(snapshot, step, {
      checkpoint: resignOwnerRecord(checkpoint, {
        ...checkpoint.payload,
        evidenceDigest: null,
      }),
    })),
    (error) => error?.code === "wakeflow-codex-migration-effect-record",
  );
  assert.equal(calls.archive, 0);
  const result = await handler.performEffect(callbackArgs(snapshot, step, { checkpoint }));
  const outcome = await handler.observeEffect(callbackArgs(snapshot, step, { checkpoint, result }));
  assert.equal(outcome.payload.status, "manual-host-gate-acknowledged");
  assert.deepEqual(await handler.assertEffectOutcome({ checkpoint, result, outcome }), { admitted: true });
  const effectRecord = portableEffectRecord(step, checkpoint, result, outcome);
  const closure = await owner.participant.deriveTerminalClosure({
    planDigest: owner.snapshotDigest,
    effectRecords: [effectRecord],
  });
  assert.equal(closure.planDigest, owner.snapshotDigest);
  assert.equal(closure.closureDigests.length, 1);
  await assert.rejects(
    owner.participant.deriveTerminalClosure({
      planDigest: owner.snapshotDigest,
      effectRecords: [effectRecord, effectRecord],
    }),
    (error) => error?.code === "wakeflow-codex-migration-effect-closure",
  );
  await assert.rejects(
    handler.validateEffectOutcome({
      checkpoint: { ...checkpoint, payload: { ...checkpoint.payload, preflightStatus: "ambiguous" } },
      result,
      record: outcome,
    }),
    (error) => error?.code === "wakeflow-codex-migration-effect-record",
  );
  assert.deepEqual(calls, { preflight: 1, archive: 1, recover: 0 });

  const recovered = await handler.recoverEffect(callbackArgs(snapshot, step, { checkpoint }));
  const recoveredOutcome = await handler.observeEffect(callbackArgs(snapshot, step, {
    checkpoint,
    result: recovered,
  }));
  assert.equal(recoveredOutcome.payload.status, "manual-host-gate-acknowledged");
  assert.deepEqual(calls, { preflight: 1, archive: 1, recover: 1 });
  assert.equal(recordCodexMigrationDecommissionOutcome({
    migrationPlan: sourcePlan,
    observations: [{ status: "archived", subjectId: archive.subjectId }],
    plan: hostPlan,
    workspaceRoot,
  }).summary.status, "manual-host-gate");

  const registry = path.join(
    workspaceRoot,
    ".wakeflow-local/wakeflow-delivery/hosts/codex/thread-registry/ProductWindow.json",
  );
  writeFileSync(registry, `${readFileSync(registry, "utf8")} `);
  await assert.rejects(
    handler.prepareEffect(callbackArgs(snapshot, step)),
    (error) => error instanceof WakeflowCodexMigrationEffectError
      && error.code === "wakeflow-codex-migration-effect-stale",
  );
  assert.equal(calls.preflight, 1);
});

test("host effect snapshots bind into the aggregate apply plan but cannot erase unrelated T05 blockers", (t) => {
  const workspaceRoot = materialize(t, "codex", ["identity-registered"]);
  const sourcePlan = migrationPlan(t, {
    artifactRoot: CODEX_ARTIFACT,
    hostProfile: codexProfile,
    workspaceRoot,
  });
  const hostPlan = inspectCodexMigrationDecommissionPlan({ migrationPlan: sourcePlan, workspaceRoot });
  const snapshot = planCodexMigrationHostEffects({ workspaceRoot, migrationPlan: sourcePlan, hostPlan });
  const archive = hostPlan.subjects.find((subject) => subject.effect === "archive");
  const acknowledgement = createWakeflowMigrationManualAcknowledgement({
    migrationPlan: sourcePlan,
    hostPlan,
    subjectId: archive.subjectId,
  });
  const phases = createMigrationApplyPhaseFixtures(sourcePlan).snapshots;
  const plan = planWakeflowMigrationApply({
    migrationPlan: sourcePlan,
    hostPlans: [hostPlan],
    hostEffectSnapshots: [snapshot],
    manualAcknowledgements: [acknowledgement],
    phaseSnapshots: phases,
  });
  assert.equal(plan.payload.hostEffectSnapshots.length, 1);
  assert.equal(plan.payload.steps[0].stepKind, "owner-effect");
  assert.equal(plan.payload.status, "blocked");
  assert.ok(plan.payload.issues.some((entry) => (
    entry.code === "migration-apply-upstream-manual-unit-unresolved"
  )));
});

test("Claude admits only close succeeded plus bounded exact absence; recovery absence never becomes close proof", async (t) => {
  const workspaceRoot = materialize(t, "claude-code", [
    "identity-registered",
    "claude-window-operation",
  ]);
  coherentClaudeWindowHost(workspaceRoot);
  const sourcePlan = migrationPlan(t, {
    artifactRoot: CLAUDE_ARTIFACT,
    hostProfile: claudeProfile,
    workspaceRoot,
  });
  const hostPlan = inspectClaudeMigrationDecommissionPlan({ migrationPlan: sourcePlan, workspaceRoot });
  const snapshot = planClaudeMigrationHostEffects({ workspaceRoot, migrationPlan: sourcePlan, hostPlan });
  assert.equal(snapshot.snapshot.payload.steps.length, 1);
  assert.equal(JSON.stringify(snapshot).includes("ProductWindow"), false);
  assert.equal(JSON.stringify(snapshot).includes("@wakeflow-scenario-session"), false);
  const calls = { preflight: 0, close: 0, recover: 0, postClose: 0 };
  const owner = createClaudeMigrationHostEffectParticipant({
    workspaceRoot,
    migrationPlan: sourcePlan,
    hostPlan,
    hostEffectSnapshot: snapshot,
    adapter: {
      async preflight() {
        calls.preflight += 1;
        return { status: "live", evidenceDigest: EVIDENCE_DIGEST };
      },
      async close() {
        calls.close += 1;
        return { status: "succeeded", evidenceDigest: EVIDENCE_DIGEST };
      },
      async recover() {
        calls.recover += 1;
        return { status: "absent", evidenceDigest: EVIDENCE_DIGEST };
      },
      async postClose() {
        calls.postClose += 1;
        return { status: "absent", attempts: 2, evidenceDigest: EVIDENCE_DIGEST };
      },
    },
  });
  const step = snapshot.snapshot.payload.steps[0];
  const handler = owner.participant.stepHandlers[step.stepId];
  const checkpoint = await handler.prepareEffect(callbackArgs(snapshot, step));
  await assert.rejects(
    handler.performEffect(callbackArgs(snapshot, step, {
      checkpoint: resignOwnerRecord(checkpoint, {
        ...checkpoint.payload,
        evidenceDigest: null,
      }),
    })),
    (error) => error?.code === "wakeflow-claude-migration-effect-record",
  );
  assert.equal(calls.close, 0);
  const result = await handler.performEffect(callbackArgs(snapshot, step, { checkpoint }));
  await assert.rejects(
    handler.observeEffect(callbackArgs(snapshot, step, {
      checkpoint,
      result: resignOwnerRecord(result, {
        ...result.payload,
        evidenceDigest: null,
      }),
    })),
    (error) => error?.code === "wakeflow-claude-migration-effect-record",
  );
  assert.equal(calls.postClose, 0);
  const outcome = await handler.observeEffect(callbackArgs(snapshot, step, { checkpoint, result }));
  assert.equal(outcome.payload.status, "machine-verified");
  assert.equal(outcome.payload.effectCheckpoint, "completed");
  assert.deepEqual(await handler.assertEffectOutcome({ checkpoint, result, outcome }), { admitted: true });
  const effectRecord = portableEffectRecord(step, checkpoint, result, outcome);
  const closure = await owner.participant.deriveTerminalClosure({
    planDigest: owner.snapshotDigest,
    effectRecords: [effectRecord],
  });
  assert.equal(closure.planDigest, owner.snapshotDigest);
  assert.equal(closure.closureDigests.length, 1);
  await assert.rejects(
    owner.participant.deriveTerminalClosure({
      planDigest: owner.snapshotDigest,
      effectRecords: [effectRecord, effectRecord],
    }),
    (error) => error?.code === "wakeflow-claude-migration-effect-closure",
  );
  assert.deepEqual(calls, { preflight: 1, close: 1, recover: 0, postClose: 1 });

  const closeSubject = hostPlan.subjects.find((subject) => subject.effect === "close");
  assert.equal(recordClaudeMigrationDecommissionOutcome({
    migrationPlan: sourcePlan,
    observations: [{
      closeStatus: "succeeded",
      effectCheckpoint: "completed",
      postCloseAttempts: 2,
      postCloseStatus: "absent",
      preCloseStatus: "live",
      subjectId: closeSubject.subjectId,
    }],
    plan: hostPlan,
    workspaceRoot,
  }).summary.status, "machine-verified");

  const recovered = await handler.recoverEffect(callbackArgs(snapshot, step, { checkpoint }));
  const recoveredOutcome = await handler.observeEffect(callbackArgs(snapshot, step, {
    checkpoint,
    result: recovered,
  }));
  assert.equal(recoveredOutcome.payload.status, "blocked");
  assert.equal(recoveredOutcome.payload.effectCheckpoint, "started");
  assert.equal(recoveredOutcome.payload.reasonCode, "claude-close-unconfirmed-after-recovery");
  assert.deepEqual(
    await handler.assertEffectOutcome({ checkpoint, result: recovered, outcome: recoveredOutcome }),
    { admitted: false },
  );
  assert.deepEqual(calls, { preflight: 1, close: 1, recover: 1, postClose: 2 });
});

test("Codex effect admission snapshots callbacks and rejects behavioral acknowledgement or closure input", async (t) => {
  const workspaceRoot = materialize(t, "codex", ["identity-registered"]);
  const sourcePlan = migrationPlan(t, {
    artifactRoot: CODEX_ARTIFACT,
    hostProfile: codexProfile,
    workspaceRoot,
  });
  const hostPlan = inspectCodexMigrationDecommissionPlan({ migrationPlan: sourcePlan, workspaceRoot });
  const snapshot = planCodexMigrationHostEffects({ workspaceRoot, migrationPlan: sourcePlan, hostPlan });
  const archiveSubject = hostPlan.subjects.find((subject) => subject.effect === "archive");
  const acknowledgement = createWakeflowMigrationManualAcknowledgement({
    migrationPlan: sourcePlan,
    hostPlan,
    subjectId: archiveSubject.subjectId,
  });

  let acknowledgementReads = 0;
  const behavioralAcknowledgements = [];
  Object.defineProperty(behavioralAcknowledgements, "0", {
    enumerable: true,
    get() {
      acknowledgementReads += 1;
      return acknowledgement;
    },
  });
  behavioralAcknowledgements.length = 1;
  assert.throws(
    () => createCodexMigrationHostEffectParticipant({
      workspaceRoot,
      migrationPlan: sourcePlan,
      hostPlan,
      hostEffectSnapshot: snapshot,
      manualAcknowledgements: behavioralAcknowledgements,
      adapter: {
        async preflight() { return { status: "ready", evidenceDigest: EVIDENCE_DIGEST }; },
        async archive() { return { status: "archived", evidenceDigest: EVIDENCE_DIGEST }; },
        async recover() { return { status: "archived", evidenceDigest: EVIDENCE_DIGEST }; },
      },
    }),
    (error) => error?.code === "wakeflow-codex-migration-effect-contract",
  );
  assert.equal(acknowledgementReads, 0);

  const calls = { original: 0, replacement: 0 };
  const adapter = {
    async preflight() {
      calls.original += 1;
      return { status: "ready", evidenceDigest: EVIDENCE_DIGEST };
    },
    async archive() {
      calls.original += 1;
      return { status: "archived", evidenceDigest: EVIDENCE_DIGEST };
    },
    async recover() {
      calls.original += 1;
      return { status: "archived", evidenceDigest: EVIDENCE_DIGEST };
    },
  };
  const owner = createCodexMigrationHostEffectParticipant({
    workspaceRoot,
    migrationPlan: sourcePlan,
    hostPlan,
    hostEffectSnapshot: snapshot,
    manualAcknowledgements: [acknowledgement],
    adapter,
  });
  adapter.preflight = async () => {
    calls.replacement += 1;
    return { status: "ambiguous", evidenceDigest: EVIDENCE_DIGEST };
  };
  adapter.archive = async () => {
    calls.replacement += 1;
    return { status: "failed", evidenceDigest: EVIDENCE_DIGEST };
  };

  const step = snapshot.snapshot.payload.steps[0];
  const handler = owner.participant.stepHandlers[step.stepId];
  let argumentReads = 0;
  const behavioralArgs = { step };
  Object.defineProperty(behavioralArgs, "plan", {
    enumerable: true,
    get() {
      argumentReads += 1;
      return snapshot.snapshot;
    },
  });
  await assert.rejects(
    handler.prepareEffect(behavioralArgs),
    (error) => error?.code === "wakeflow-codex-migration-effect-callback",
  );
  assert.equal(argumentReads, 0);

  const checkpoint = await handler.prepareEffect(callbackArgs(snapshot, step));
  const result = await handler.performEffect(callbackArgs(snapshot, step, { checkpoint }));
  const outcome = await handler.observeEffect(callbackArgs(snapshot, step, { checkpoint, result }));
  assert.equal(outcome.payload.status, "manual-host-gate-acknowledged");
  assert.deepEqual(calls, { original: 2, replacement: 0 });
  const effectRecord = portableEffectRecord(step, checkpoint, result, outcome, step.ordinal);

  let recordReads = 0;
  const behavioralRecord = { ...effectRecord };
  Object.defineProperty(behavioralRecord, "stepId", {
    enumerable: true,
    get() {
      recordReads += 1;
      return step.stepId;
    },
  });
  await assert.rejects(
    owner.participant.deriveTerminalClosure({
      planDigest: owner.snapshotDigest,
      effectRecords: [behavioralRecord],
    }),
    (error) => error?.code === "wakeflow-codex-migration-effect-closure",
  );
  assert.equal(recordReads, 0);
});

test("Claude effect admission snapshots callbacks and requires evidence for machine verification", async (t) => {
  const workspaceRoot = materialize(t, "claude-code", [
    "identity-registered",
    "claude-window-operation",
  ]);
  coherentClaudeWindowHost(workspaceRoot);
  const sourcePlan = migrationPlan(t, {
    artifactRoot: CLAUDE_ARTIFACT,
    hostProfile: claudeProfile,
    workspaceRoot,
  });
  const hostPlan = inspectClaudeMigrationDecommissionPlan({ migrationPlan: sourcePlan, workspaceRoot });
  const snapshot = planClaudeMigrationHostEffects({ workspaceRoot, migrationPlan: sourcePlan, hostPlan });
  const calls = { original: 0, replacement: 0 };
  const adapter = {
    async preflight() {
      calls.original += 1;
      return { status: "live", evidenceDigest: EVIDENCE_DIGEST };
    },
    async close() {
      calls.original += 1;
      return { status: "succeeded", evidenceDigest: EVIDENCE_DIGEST };
    },
    async recover() {
      calls.original += 1;
      return { status: "absent", evidenceDigest: EVIDENCE_DIGEST };
    },
    async postClose() {
      calls.original += 1;
      return { status: "absent", attempts: 1, evidenceDigest: EVIDENCE_DIGEST };
    },
  };
  const owner = createClaudeMigrationHostEffectParticipant({
    workspaceRoot,
    migrationPlan: sourcePlan,
    hostPlan,
    hostEffectSnapshot: snapshot,
    adapter,
  });
  adapter.close = async () => {
    calls.replacement += 1;
    return { status: "failed", evidenceDigest: EVIDENCE_DIGEST };
  };
  adapter.postClose = async () => {
    calls.replacement += 1;
    return { status: "present", attempts: 1, evidenceDigest: EVIDENCE_DIGEST };
  };
  const step = snapshot.snapshot.payload.steps[0];
  const handler = owner.participant.stepHandlers[step.stepId];
  const checkpoint = await handler.prepareEffect(callbackArgs(snapshot, step));
  const result = await handler.performEffect(callbackArgs(snapshot, step, { checkpoint }));
  const outcome = await handler.observeEffect(callbackArgs(snapshot, step, { checkpoint, result }));
  assert.equal(outcome.payload.status, "machine-verified");
  assert.deepEqual(calls, { original: 3, replacement: 0 });

  const noEvidenceOwner = createClaudeMigrationHostEffectParticipant({
    workspaceRoot,
    migrationPlan: sourcePlan,
    hostPlan,
    hostEffectSnapshot: snapshot,
    adapter: {
      async preflight() { return { status: "live", evidenceDigest: null }; },
      async close() { return { status: "succeeded", evidenceDigest: null }; },
      async recover() { return { status: "absent", evidenceDigest: null }; },
      async postClose() { return { status: "absent", attempts: 1, evidenceDigest: null }; },
    },
  });
  const noEvidenceHandler = noEvidenceOwner.participant.stepHandlers[step.stepId];
  await assert.rejects(
    noEvidenceHandler.prepareEffect(callbackArgs(snapshot, step)),
    (error) => error?.code === "wakeflow-claude-migration-effect-adapter",
  );
});
