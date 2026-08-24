import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { hostProfile as claudeProfile } from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-host-profile.mjs";
import { hostProfile as codexProfile } from "../plugins/codex-wakeflow/scripts/lib/wakeflow-host-profile.mjs";
import { canonicalJson, canonicalJsonDigest } from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import {
  parseWakeflowConfigV3,
  readWakeflowConfigV3,
  serializeWakeflowConfigV3,
  wakeflowConfigV3Digest,
} from "../core/scripts/lib/wakeflow-config-v3.mjs";
import {
  WAKEFLOW_CONFIG_V3_OWNER_PLAN_KIND,
  WAKEFLOW_CONFIG_V3_OWNER_PLAN_SCHEMA_ID,
  WAKEFLOW_CONFIG_V3_OWNER_PLAN_SCHEMA_VERSION,
  WakeflowConfigV3OwnerError,
  createWakeflowConfigV3OwnerMutationParticipant,
  inspectWakeflowConfigV3FreshSource,
  planWakeflowConfigV3FreshOwner,
  validateWakeflowConfigV3OwnerPlan,
} from "../core/scripts/lib/wakeflow-config-v3-owner.mjs";
import {
  WAKEFLOW_FRESH_INITIALIZE_KIND,
  WAKEFLOW_FRESH_INITIALIZE_SCHEMA_VERSION,
  WakeflowFreshInitializeError,
  createWakeflowFreshDesiredModel,
  inspectWakeflowFreshLocalEligibility,
  planWakeflowFreshInitializeBackbone,
  planWakeflowMigrationMaterializationBackbone,
} from "../core/scripts/lib/wakeflow-fresh-initialize.mjs";
import { createWakeflowLayoutDescriptor } from "../core/scripts/lib/wakeflow-layout-descriptor.mjs";
import { inspectWakeflowLocalLayout } from "../core/scripts/lib/wakeflow-local-layout-inspection.mjs";
import {
  isWakeflowMaintenancePlanApplicable,
  validateWakeflowMaintenancePlan,
  wakeflowMaintenancePlanDigest,
} from "../core/scripts/lib/wakeflow-maintenance-plan.mjs";
import {
  recoverWakeflowWorkspaceMutation,
  runWakeflowMaintenanceMutation,
} from "../core/scripts/lib/wakeflow-workspace-mutation.mjs";
import { parseWakeflowAssetBundle } from "../core/scripts/lib/wakeflow-template-renderer.mjs";
import { buildWakeflowAssetBundle } from "../tools/build-asset-bundle.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assetBundle = parseWakeflowAssetBundle(buildWakeflowAssetBundle({
  sourceRoot: path.join(repositoryRoot, "core/template-sources"),
}));
const configOwnerUrl = pathToFileURL(path.join(
  repositoryRoot,
  "core/scripts/lib/wakeflow-config-v3-owner.mjs",
)).href;
const mutationUrl = pathToFileURL(path.join(
  repositoryRoot,
  "core/scripts/lib/wakeflow-workspace-mutation.mjs",
)).href;
const canonicalUrl = pathToFileURL(path.join(
  repositoryRoot,
  "core/scripts/lib/wakeflow-canonical-json.mjs",
)).href;

const UUIDS = Object.freeze([
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
  "55555555-5555-4555-8555-555555555555",
  "66666666-6666-4666-8666-666666666666",
  "77777777-7777-4777-8777-777777777777",
  "88888888-8888-4888-8888-888888888888",
]);

function selection() {
  return {
    program: {
      displayName: "Example Program",
      description: "Fresh v3 test program",
      interfaceLanguage: "zh",
    },
    topology: {
      repositories: [{
        selectionKey: "product-a",
        path: "../ProductA",
        displayName: "Product A",
        instructionManagement: "owner-managed",
      }],
      supportSurfaces: [
        {
          selectionKey: "design-surface",
          capability: "design",
          path: "Design",
          displayName: "Design",
          ownership: "wakeflow-managed",
        },
        {
          selectionKey: "test-surface",
          capability: "test",
          path: "Test",
          displayName: "Test",
          ownership: "wakeflow-managed",
        },
      ],
      windows: [
        {
          role: "controller",
          displayName: "Controller",
          root: { kind: "program" },
        },
        {
          role: "design",
          displayName: "Design",
          root: { kind: "support-surface", selectionKey: "design-surface" },
        },
        {
          role: "test",
          displayName: "Test",
          root: { kind: "support-surface", selectionKey: "test-surface" },
        },
        {
          role: "product",
          displayName: "Product A",
          root: { kind: "repository", selectionKey: "product-a" },
        },
      ],
    },
    storage: { ledgerRoot: "../wakeflow-ledger" },
    governance: {},
    hosts: {},
  };
}

function deterministicModel(input = selection()) {
  let cursor = 0;
  const model = createWakeflowFreshDesiredModel({
    selection: input,
    uuidFactory: () => UUIDS[cursor++],
  });
  assert.equal(cursor, UUIDS.length, "fresh preview must allocate every stable ID exactly once");
  return model;
}

function withTempWorkspace(t, prefix) {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  return workspaceRoot;
}

function modeString(candidate) {
  return `0${(lstatSync(candidate).mode & 0o777).toString(8).padStart(3, "0")}`;
}

function createProtocolPrefix(workspaceRoot) {
  for (const ref of [
    ".wakeflow-local",
    ".wakeflow-local/runtime",
    ".wakeflow-local/runtime/maintenance",
    ".wakeflow-local/runtime/maintenance/transactions",
  ]) {
    const candidate = path.join(workspaceRoot, ...ref.split("/"));
    mkdirSync(candidate, { recursive: true, mode: 0o700 });
    chmodSync(candidate, 0o700);
  }
}

function configMutationOptions(workspaceRoot, model, confirmedPlan, participant, stepHandlers = null) {
  return {
    workspaceRoot,
    action: "fresh-initialize",
    operationKind: "fresh-config-v3",
    domainOwner: "config-writer",
    confirmedPlan,
    planDigest: canonicalJsonDigest(confirmedPlan),
    validatePlan: participant.validatePlan,
    deriveCurrentPlan: participant.deriveCurrentPlan,
    deriveTerminalClosure: participant.deriveTerminalClosure,
    stepHandlers: stepHandlers ?? participant.stepHandlers,
  };
}

test("T03 fresh selection generates typed IDs once and never persists ephemeral selection keys", () => {
  const model = deterministicModel();
  assert.deepEqual(parseWakeflowConfigV3(model), model);
  assert.equal(Object.isFrozen(model), true);
  assert.equal(Object.isFrozen(model.topology.windows), true);
  assert.deepEqual(model.program.programId, `program_${UUIDS[0]}`);
  assert.deepEqual(model.topology.repositories[0].repositoryId, `repository_${UUIDS[1]}`);
  assert.deepEqual(
    model.topology.supportSurfaces.map((entry) => entry.surfaceId),
    [`surface_${UUIDS[2]}`, `surface_${UUIDS[3]}`],
  );
  assert.deepEqual(
    model.topology.windows.map((entry) => entry.windowId),
    UUIDS.slice(4).map((uuid) => `window_${uuid}`),
  );
  assert.equal(canonicalJson(model).includes("selectionKey"), false);
  assert.equal(model.topology.windows[1].root.surfaceId, model.topology.supportSurfaces[0].surfaceId);
  assert.equal(model.topology.windows[3].root.repositoryId, model.topology.repositories[0].repositoryId);

  const dangling = structuredClone(selection());
  dangling.topology.windows[3].root.selectionKey = "missing-repository";
  assert.throws(
    () => deterministicModel(dangling),
    (error) => error instanceof WakeflowFreshInitializeError && /selection|reference/iu.test(error.message),
  );

  const unknown = structuredClone(selection());
  unknown.workspaceRoot = "/private/machine/path";
  assert.throws(
    () => deterministicModel(unknown),
    (error) => error instanceof WakeflowFreshInitializeError && /field|contract/iu.test(error.message),
  );

  assert.throws(
    () => createWakeflowFreshDesiredModel({ selection: selection(), uuidFactory: () => UUIDS[0] }),
    /duplicate|collision/iu,
  );
});

test("T03 config owner plan is absent-only, deterministic, closed, and read-only", (t) => {
  assert.equal(WAKEFLOW_CONFIG_V3_OWNER_PLAN_SCHEMA_ID, "urn:wakeflow:internal:config-v3-owner-plan:v1");
  assert.equal(WAKEFLOW_CONFIG_V3_OWNER_PLAN_KIND, "WakeflowConfigV3OwnerPlan");
  assert.equal(WAKEFLOW_CONFIG_V3_OWNER_PLAN_SCHEMA_VERSION, 1);
  const workspaceRoot = withTempWorkspace(t, "wakeflow-config-v3-owner-plan-");
  const model = deterministicModel();
  const before = readdirSync(workspaceRoot);
  const inspection = inspectWakeflowConfigV3FreshSource({ workspaceRoot, model });
  const first = planWakeflowConfigV3FreshOwner({ workspaceRoot, model });
  const second = planWakeflowConfigV3FreshOwner({ workspaceRoot, model });

  assert.equal(inspection.classification, "absent");
  assert.deepEqual(first, second);
  assert.deepEqual(validateWakeflowConfigV3OwnerPlan(first), first);
  assert.equal(first.schemaId, WAKEFLOW_CONFIG_V3_OWNER_PLAN_SCHEMA_ID);
  assert.equal(first.payload.kind, WAKEFLOW_CONFIG_V3_OWNER_PLAN_KIND);
  assert.equal(first.payload.status, "ready");
  assert.equal(first.payload.programId, model.program.programId);
  assert.equal(first.payload.modelDigest, wakeflowConfigV3Digest(model));
  assert.equal(first.payload.steps.length, 1);
  assert.deepEqual(first.payload.steps[0].source, { ref: "wakeflow.config.json", type: "absent" });
  assert.deepEqual(
    { type: first.payload.steps[0].final.type, mode: first.payload.steps[0].final.mode },
    { type: "file", mode: "0644" },
  );
  assert.deepEqual(first.payload.steps[0].staging, {
    ref: first.payload.stageRef,
    type: "file",
    mode: "0644",
    digest: first.payload.configBytesDigest,
  });
  assert.equal(Object.isFrozen(first), true);
  assert.deepEqual(readdirSync(workspaceRoot), before, "preview must not create a config or stage");

  const forged = structuredClone(first);
  forged.payload.configBytesDigest = `sha256:${"f".repeat(64)}`;
  assert.throws(
    () => validateWakeflowConfigV3OwnerPlan(forged),
    (error) => error instanceof WakeflowConfigV3OwnerError,
  );
});

test("T03 config fresh source rejects existing, symlinked, hard-linked, and stage-residue inputs", async (t) => {
  const model = deterministicModel();
  const bytes = serializeWakeflowConfigV3(model);
  const cases = [
    {
      name: "existing",
      expected: "fresh-config-already-exists",
      arrange(root) {
        writeFileSync(path.join(root, "wakeflow.config.json"), bytes, { mode: 0o644 });
        chmodSync(path.join(root, "wakeflow.config.json"), 0o644);
      },
    },
    {
      name: "symlink",
      expected: "fresh-config-unsafe-residue",
      arrange(root) {
        const outside = path.join(root, "outside.json");
        writeFileSync(outside, bytes, { mode: 0o644 });
        symlinkSync(outside, path.join(root, "wakeflow.config.json"));
      },
    },
    {
      name: "hardlink",
      expected: "fresh-config-unsafe-residue",
      arrange(root) {
        const outside = path.join(root, "outside.json");
        writeFileSync(outside, bytes, { mode: 0o644 });
        linkSync(outside, path.join(root, "wakeflow.config.json"));
      },
    },
    {
      name: "stage",
      expected: "fresh-config-recovery-residue",
      arrange(root) {
        const ready = planWakeflowConfigV3FreshOwner({ workspaceRoot: root, model });
        writeFileSync(path.join(root, ready.payload.stageRef), bytes, { mode: 0o644 });
        chmodSync(path.join(root, ready.payload.stageRef), 0o644);
      },
    },
    {
      name: "foreign-stage",
      expected: "fresh-config-unsafe-residue",
      arrange(root) {
        const ready = planWakeflowConfigV3FreshOwner({ workspaceRoot: root, model });
        const targetDigest = ready.payload.configBytesDigest.slice("sha256:".length);
        const foreignDigest = `${targetDigest[0] === "0" ? "1" : "0"}${targetDigest.slice(1)}`;
        const foreignStageRef = `.wakeflow.config.json.${foreignDigest}.stage`;
        writeFileSync(path.join(root, foreignStageRef), bytes, { mode: 0o644 });
        chmodSync(path.join(root, foreignStageRef), 0o644);
      },
    },
  ];

  for (const current of cases) {
    await t.test(current.name, (subtest) => {
      const workspaceRoot = withTempWorkspace(subtest, `wakeflow-config-v3-owner-${current.name}-`);
      current.arrange(workspaceRoot);
      const before = readdirSync(workspaceRoot).sort();
      const plan = planWakeflowConfigV3FreshOwner({ workspaceRoot, model });
      assert.equal(plan.payload.status, "blocked");
      assert.deepEqual(plan.payload.steps, []);
      assert.ok(plan.payload.blockers.some((entry) => entry.code === current.expected));
      assert.deepEqual(readdirSync(workspaceRoot).sort(), before);
      assert.throws(
        () => createWakeflowConfigV3OwnerMutationParticipant({ workspaceRoot, model, confirmedPlan: plan }),
        /blocked|fresh/iu,
      );
    });
  }
});

test("T03 config owner commits strict pretty v3 bytes through the M3 gate with no replace path", async (t) => {
  const workspaceRoot = withTempWorkspace(t, "wakeflow-config-v3-owner-apply-");
  const model = deterministicModel();
  const confirmedPlan = planWakeflowConfigV3FreshOwner({ workspaceRoot, model });
  const participant = createWakeflowConfigV3OwnerMutationParticipant({
    workspaceRoot,
    model,
    confirmedPlan,
  });
  const result = await runWakeflowMaintenanceMutation(
    configMutationOptions(workspaceRoot, model, confirmedPlan, participant),
  );
  const configFile = path.join(workspaceRoot, "wakeflow.config.json");
  assert.equal(result.status, "completed");
  assert.equal(readFileSync(configFile, "utf8"), serializeWakeflowConfigV3(model));
  assert.equal(modeString(configFile), "0644");
  assert.equal(lstatSync(configFile).nlink, 1);
  assert.equal(existsSync(path.join(workspaceRoot, confirmedPlan.payload.stageRef)), false);
  assert.deepEqual(readWakeflowConfigV3(configFile), model);

  const second = planWakeflowConfigV3FreshOwner({ workspaceRoot, model });
  assert.equal(second.payload.status, "blocked");
  assert.ok(second.payload.blockers.some((entry) => entry.code === "fresh-config-already-exists"));
});

test("T03 config owner rejects a forged source snapshot before any domain write", async (t) => {
  const workspaceRoot = withTempWorkspace(t, "wakeflow-config-v3-owner-stale-");
  const model = deterministicModel();
  const forgedPlan = structuredClone(planWakeflowConfigV3FreshOwner({ workspaceRoot, model }));
  forgedPlan.payload.sourceInspectionDigest = `sha256:${"f".repeat(64)}`;
  const participant = createWakeflowConfigV3OwnerMutationParticipant({
    workspaceRoot,
    model,
    confirmedPlan: forgedPlan,
  });
  await assert.rejects(
    () => runWakeflowMaintenanceMutation(
      configMutationOptions(workspaceRoot, model, forgedPlan, participant),
    ),
    (error) => {
      const codes = [];
      for (let current = error; current; current = current.cause) codes.push(current.code);
      assert.ok(codes.includes("wakeflow-config-v3-owner-stale"));
      return true;
    },
  );
  assert.equal(existsSync(path.join(workspaceRoot, "wakeflow.config.json")), false);
  assert.equal(existsSync(path.join(workspaceRoot, forgedPlan.payload.stageRef)), false);
  assert.equal(existsSync(path.join(workspaceRoot, ".wakeflow-local")), false);
});

test("T03 config owner recovers exact prepare and no-replace link crash boundaries", {
  skip: !new Set(["darwin", "linux"]).has(process.platform)
    ? "M3 process-identity recovery is supported on Darwin and Linux"
    : false,
  timeout: 60_000,
}, async (t) => {
  const model = deterministicModel();
  for (const boundary of ["prepare", "commit"]) {
    await t.test(boundary, { timeout: 30_000 }, async (subtest) => {
      const workspaceRoot = withTempWorkspace(subtest, `wakeflow-config-v3-crash-${boundary}-`);
      const childSource = `
        const owner = await import(${JSON.stringify(configOwnerUrl)});
        const manager = await import(${JSON.stringify(mutationUrl)});
        const canonical = await import(${JSON.stringify(canonicalUrl)});
        const workspaceRoot = ${JSON.stringify(workspaceRoot)};
        const model = ${JSON.stringify(model)};
        const plan = owner.planWakeflowConfigV3FreshOwner({ workspaceRoot, model });
        const participant = owner.createWakeflowConfigV3OwnerMutationParticipant({ workspaceRoot, model, confirmedPlan: plan });
        const stepId = plan.payload.steps[0].stepId;
        const real = participant.stepHandlers[stepId];
        const stepHandlers = { ...participant.stepHandlers, [stepId]: { ...real,
          ${boundary}(...args) { real.${boundary}(...args); process.kill(process.pid, "SIGKILL"); },
        } };
        await manager.runWakeflowMaintenanceMutation({
          workspaceRoot,
          action: "fresh-initialize",
          operationKind: "fresh-config-v3",
          domainOwner: "config-writer",
          confirmedPlan: plan,
          planDigest: canonical.canonicalJsonDigest(plan),
          validatePlan: participant.validatePlan,
          deriveCurrentPlan: participant.deriveCurrentPlan,
          deriveTerminalClosure: participant.deriveTerminalClosure,
          stepHandlers,
        });
      `;
      const child = spawn(process.execPath, ["--input-type=module", "-e", childSource], {
        stdio: ["ignore", "ignore", "pipe"],
      });
      let childError = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => { childError += chunk; });
      const [exitCode, signal] = await once(child, "exit");
      assert.equal(exitCode, null, childError);
      assert.equal(signal, "SIGKILL", childError);

      const transactionRoot = path.join(
        workspaceRoot,
        ".wakeflow-local/runtime/maintenance/transactions",
      );
      const journalName = readdirSync(transactionRoot).find((name) => (
        /^workspace-mutation_[0-9a-f-]+\.json$/u.test(name)
      ));
      assert.equal(typeof journalName, "string");
      const operationId = journalName.slice(0, -".json".length);
      const planSourceRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-config-plan-source-"));
      subtest.after(() => rmSync(planSourceRoot, { recursive: true, force: true }));
      const confirmedPlan = planWakeflowConfigV3FreshOwner({ workspaceRoot: planSourceRoot, model });
      const durablePlan = JSON.parse(readFileSync(path.join(transactionRoot, journalName), "utf8")).plan;
      assert.deepEqual(durablePlan, confirmedPlan);
      const participant = createWakeflowConfigV3OwnerMutationParticipant({
        workspaceRoot,
        model,
        confirmedPlan: durablePlan,
      });
      const recovered = await recoverWakeflowWorkspaceMutation({
        workspaceRoot,
        operationId,
        confirmedPlan: durablePlan,
        planDigest: canonicalJsonDigest(durablePlan),
        validatePlan: participant.validatePlan,
        deriveCurrentPlan: participant.deriveCurrentPlan,
        deriveTerminalClosure: participant.deriveTerminalClosure,
        stepHandlers: participant.stepHandlers,
      });
      const configFile = path.join(workspaceRoot, "wakeflow.config.json");
      assert.equal(recovered.status, "recovered");
      assert.equal(readFileSync(configFile, "utf8"), serializeWakeflowConfigV3(model));
      assert.equal(lstatSync(configFile).nlink, 1);
      assert.equal(existsSync(path.join(workspaceRoot, durablePlan.payload.stageRef)), false);
      assert.deepEqual(readdirSync(transactionRoot), []);
    });
  }
});

test("T03 fresh local eligibility admits only absent or the exact empty M3 bootstrap prefix", async (t) => {
  const model = deterministicModel();
  for (const current of [
    { name: "absent", eligible: true, arrange() {} },
    { name: "empty-prefix", eligible: true, arrange: createProtocolPrefix },
    {
      name: "initialized-static",
      eligible: false,
      arrange(root) {
        createProtocolPrefix(root);
        const candidate = path.join(root, ".wakeflow-local/audit");
        mkdirSync(candidate, { mode: 0o700 });
        chmodSync(candidate, 0o700);
      },
    },
    {
      name: "unknown",
      eligible: false,
      arrange(root) {
        mkdirSync(path.join(root, ".wakeflow-local"), { mode: 0o700 });
        chmodSync(path.join(root, ".wakeflow-local"), 0o700);
        writeFileSync(path.join(root, ".wakeflow-local/alien.txt"), "foreign\n", { mode: 0o600 });
      },
    },
  ]) {
    await t.test(current.name, (subtest) => {
      const workspaceRoot = withTempWorkspace(subtest, `wakeflow-fresh-local-${current.name}-`);
      current.arrange(workspaceRoot);
      const descriptor = createWakeflowLayoutDescriptor({ model, hostProfile: codexProfile });
      const inspection = inspectWakeflowLocalLayout({
        workspaceRoot,
        model,
        layoutDescriptor: descriptor,
        hostProfile: codexProfile,
      });
      const eligibility = inspectWakeflowFreshLocalEligibility({ inspection });
      assert.equal(eligibility.eligible, current.eligible);
      assert.equal(Object.isFrozen(eligibility), true);
      if (current.eligible) assert.deepEqual(eligibility.blockers, []);
      else assert.ok(eligibility.blockers.length > 0);
    });
  }
});

test("T08 fresh backbone admits implemented owners and keeps host effects as redacted intents", (t) => {
  assert.equal(WAKEFLOW_FRESH_INITIALIZE_KIND, "WakeflowFreshInitializeBackbonePlan");
  assert.equal(WAKEFLOW_FRESH_INITIALIZE_SCHEMA_VERSION, 1);
  const model = deterministicModel();
  for (const hostProfile of [codexProfile, claudeProfile]) {
    const fixtureRoot = withTempWorkspace(t, `wakeflow-fresh-backbone-${hostProfile.hostId}-`);
    const workspaceRoot = path.join(fixtureRoot, "Program");
    mkdirSync(workspaceRoot, { mode: 0o700 });
    const before = readdirSync(workspaceRoot);
    const plan = planWakeflowFreshInitializeBackbone({
      workspaceRoot,
      desiredModel: model,
      hostProfile,
      bundle: assetBundle,
      language: "zh",
    });
    assert.equal(plan.kind, WAKEFLOW_FRESH_INITIALIZE_KIND);
    assert.equal(plan.schemaVersion, WAKEFLOW_FRESH_INITIALIZE_SCHEMA_VERSION);
    assert.equal(plan.action, "fresh-initialize");
    const expectedStatus = hostProfile.hostId === "claude-code" ? "blocked" : "ready";
    assert.equal(plan.status, expectedStatus);
    assert.equal(plan.hostEffectsAllowed, false);
    assert.equal(plan.programId, model.program.programId);
    assert.equal(plan.configDigest, wakeflowConfigV3Digest(model));
    assert.equal(Object.isFrozen(plan), true);
    assert.deepEqual(validateWakeflowMaintenancePlan(plan.aggregatePlan), plan.aggregatePlan);
    assert.equal(plan.aggregatePlan.payload.status, expectedStatus);
    assert.equal(isWakeflowMaintenancePlanApplicable(plan.aggregatePlan), expectedStatus === "ready");
    assert.equal(plan.aggregatePlanDigest, wakeflowMaintenancePlanDigest(plan.aggregatePlan));
    assert.ok(plan.ownerGraph.find((entry) => (
      entry.componentId === "config" && entry.availability === "available"
    )));
    assert.ok(plan.ownerGraph.find((entry) => (
      entry.componentId === "local-layout" && entry.availability === "available"
    )));
    for (const required of [
      "active-layout",
      "todo-authority",
      "active-projection",
      "window-runtime-projection",
    ]) {
      assert.ok(plan.ownerGraph.find((entry) => (
        entry.componentId === required && entry.availability === "available"
      )), `implemented fresh owner ${required} must be available`);
    }
    for (const required of ["support-surface", "ledger-layout", "ledger-projection"]) {
      assert.ok(plan.ownerGraph.find((entry) => (
        entry.componentId === required && entry.availability === "available"
      )), `implemented fresh owner ${required} must be available`);
    }
    assert.equal(
      plan.ownerGraph.find((entry) => entry.componentId === "ignore").availability,
      "available",
    );
    assert.equal(
      plan.ownerGraph.find((entry) => entry.componentId === "managed-memory").availability,
      "available",
    );
    assert.equal(
      plan.aggregatePlan.payload.filesystemActions.some((entry) => (
        entry.componentId === "ignore" || entry.componentId === "managed-memory"
      )),
      true,
    );
    assert.equal(
      plan.aggregatePlan.payload.filesystemActions.some((entry) => entry.componentId === "support-surface"),
      true,
    );
    assert.equal(
      plan.aggregatePlan.payload.filesystemActions.some((entry) => entry.componentId === "ledger-projection"),
      true,
    );
    for (const required of ["todo-authority", "active-projection", "window-runtime-projection"]) {
      assert.equal(
        plan.aggregatePlan.payload.filesystemActions.some((entry) => entry.componentId === required),
        true,
      );
    }
    assert.equal(
      plan.ownerGraph.some((entry) => entry.componentId === "host-settings-assets"),
      hostProfile.hostId === "claude-code",
    );
    assert.equal(plan.launchIntents.length, model.topology.windows.length);
    assert.deepEqual(
      plan.launchIntents.map((entry) => entry.windowId),
      model.topology.windows.map((entry) => entry.windowId).sort(),
    );
    for (const intent of plan.launchIntents) {
      assert.equal(intent.registration.windowId, intent.windowId);
      assert.equal(intent.registration.operation, "register-window-binding");
      assert.equal(intent.create.requiresHostOperation, true);
      assert.equal(intent.create.authorityEligible, false);
      assert.equal(intent.registration.authorityEligible, false);
    }
    const serialized = canonicalJson(plan);
    for (const forbidden of [
      workspaceRoot,
      "selectionKey",
      "bindingId",
      "threadId",
      "sessionId",
      "rawHandle",
    ]) assert.equal(serialized.includes(forbidden), false, `${forbidden} leaked into fresh plan`);
    assert.deepEqual(readdirSync(workspaceRoot), before, "fresh backbone preview must remain zero-write");
  }

  const reorderedCandidate = structuredClone(model);
  reorderedCandidate.topology.windows.reverse();
  const reorderedModel = parseWakeflowConfigV3(reorderedCandidate);
  assert.notDeepEqual(
    reorderedModel.topology.windows.map((entry) => entry.windowId),
    reorderedModel.topology.windows.map((entry) => entry.windowId).sort(),
    "fixture must prove launch order is independent from config presentation order",
  );
  const fixtureRoot = withTempWorkspace(t, "wakeflow-fresh-backbone-canonical-window-order-");
  const workspaceRoot = path.join(fixtureRoot, "Program");
  mkdirSync(workspaceRoot, { mode: 0o700 });
  const reorderedPlan = planWakeflowFreshInitializeBackbone({
    workspaceRoot,
    desiredModel: reorderedModel,
    hostProfile: codexProfile,
    bundle: assetBundle,
    language: "zh",
  });
  assert.deepEqual(
    reorderedPlan.launchIntents.map((entry) => entry.windowId),
    reorderedModel.topology.windows.map((entry) => entry.windowId).sort(),
  );

  const unsafeHostProfile = {
    ...codexProfile,
    hostTools: { ...codexProfile.hostTools, createWindow: "/private/bin/create-window" },
  };
  const unsafeRoot = withTempWorkspace(t, "wakeflow-fresh-backbone-unsafe-host-");
  assert.throws(
    () => planWakeflowFreshInitializeBackbone({
      workspaceRoot: unsafeRoot,
      desiredModel: model,
      hostProfile: unsafeHostProfile,
      bundle: assetBundle,
      language: "zh",
    }),
    /host profile|tool intent/iu,
  );
});

test("T08 fresh backbone rejects a create-window accessor without invoking it", (t) => {
  const model = deterministicModel();
  const workspaceRoot = withTempWorkspace(t, "wakeflow-fresh-host-tool-accessor-");
  let accessorCalls = 0;
  const accessorHostTools = {};
  Object.defineProperty(accessorHostTools, "createWindow", {
    enumerable: true,
    get() {
      accessorCalls += 1;
      return "create_thread";
    },
  });
  const accessorProfile = { ...codexProfile, hostTools: accessorHostTools };

  assert.throws(
    () => planWakeflowFreshInitializeBackbone({
      workspaceRoot,
      desiredModel: model,
      hostProfile: accessorProfile,
      bundle: assetBundle,
      language: "zh",
    }),
    /(?:host profile|tool intent|data property|accessor)/iu,
  );
  assert.equal(accessorCalls, 0);
});

test("T08 migration materialization rejects an owner snapshot accessor without invoking it", (t) => {
  const model = deterministicModel();
  const workspaceRoot = withTempWorkspace(t, "wakeflow-migration-owner-accessor-");
  let accessorCalls = 0;
  const configOwnerPlan = {};
  Object.defineProperty(configOwnerPlan, "payload", {
    enumerable: true,
    get() {
      accessorCalls += 1;
      return {};
    },
  });

  assert.throws(
    () => planWakeflowMigrationMaterializationBackbone({
      workspaceRoot,
      desiredModel: model,
      hostProfile: codexProfile,
      bundle: assetBundle,
      language: "zh",
      configOwnerPlan,
      configSourceAuthority: {
        programId: model.program.programId,
        modelDigest: `sha256:${"a".repeat(64)}`,
      },
    }),
    /(?:config owner|canonical|data property|accessor)/iu,
  );
  assert.equal(accessorCalls, 0);
});

test("T06 fresh backbone does not scan managed roots after config source rejection", (t) => {
  const workspaceRoot = withTempWorkspace(t, "wakeflow-fresh-upstream-blocked-");
  const model = deterministicModel();
  writeFileSync(path.join(workspaceRoot, "wakeflow.config.json"), "{}\n", { mode: 0o644 });
  const plan = planWakeflowFreshInitializeBackbone({
    workspaceRoot,
    desiredModel: model,
    hostProfile: codexProfile,
    bundle: assetBundle,
    language: "zh",
  });
  assert.equal(plan.aggregatePlan, null);
  assert.equal(plan.blockers.some((entry) => entry.owner === "config-writer"), true);
  assert.equal(plan.ownerGraph.find((entry) => entry.componentId === "ignore").availability, "blocked");
  assert.equal(plan.ownerGraph.find((entry) => entry.componentId === "managed-memory").availability, "blocked");
});

test("T07 fresh backbone rejects active, support, and ledger footprint without deleting or adopting it", (t) => {
  const fixtureRoot = withTempWorkspace(t, "wakeflow-fresh-foundation-footprint-");
  const workspaceRoot = path.join(fixtureRoot, "Program");
  mkdirSync(workspaceRoot, { mode: 0o700 });
  const model = deterministicModel();

  const activeRoot = path.join(workspaceRoot, ".wakeflow-active");
  mkdirSync(activeRoot, { mode: 0o700 });
  let plan = planWakeflowFreshInitializeBackbone({
    workspaceRoot,
    desiredModel: model,
    hostProfile: codexProfile,
    bundle: assetBundle,
    language: "zh",
  });
  assert.equal(plan.aggregatePlan, null);
  assert.equal(plan.blockers.some((entry) => entry.code === "fresh-active-footprint-present"), true);
  assert.equal(existsSync(activeRoot), true);

  rmSync(activeRoot, { recursive: true, force: true });
  const supportRoot = path.join(workspaceRoot, "Design");
  mkdirSync(supportRoot, { mode: 0o755 });
  plan = planWakeflowFreshInitializeBackbone({
    workspaceRoot,
    desiredModel: model,
    hostProfile: codexProfile,
    bundle: assetBundle,
    language: "zh",
  });
  assert.equal(plan.aggregatePlan.payload.status, "blocked");
  assert.equal(plan.blockers.some((entry) => entry.code === "fresh-support-root-present"), true);
  assert.equal(existsSync(supportRoot), true);

  rmSync(supportRoot, { recursive: true, force: true });
  const ledgerRoot = path.resolve(workspaceRoot, model.storage.ledgerRoot);
  mkdirSync(ledgerRoot, { mode: 0o755 });
  plan = planWakeflowFreshInitializeBackbone({
    workspaceRoot,
    desiredModel: model,
    hostProfile: codexProfile,
    bundle: assetBundle,
    language: "zh",
  });
  assert.equal(plan.aggregatePlan.payload.status, "blocked");
  assert.equal(plan.blockers.some((entry) => entry.code === "fresh-ledger-root-present"), true);
  assert.equal(existsSync(ledgerRoot), true);
});

test("T03 candidate modules remain disconnected from the frozen public-v2 initialize surface", () => {
  for (const relative of [
    "core/scripts/wakeflow-setup.mjs",
    "core/scripts/wakeflow-cli.mjs",
    "plugins/codex-wakeflow/lib/wakeflow-mcp-tools.mjs",
    "plugins/claude-code-wakeflow/lib/wakeflow-mcp-tools.mjs",
  ]) {
    const source = readFileSync(path.join(repositoryRoot, relative), "utf8");
    assert.doesNotMatch(source, /wakeflow-(?:config-v3-owner|fresh-initialize)\.mjs/u);
  }
});
