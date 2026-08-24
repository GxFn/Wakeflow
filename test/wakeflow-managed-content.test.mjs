import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  chmodSync,
  existsSync,
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

import {
  parseWakeflowConfigV3,
  serializeWakeflowConfigV3,
} from "../core/scripts/lib/wakeflow-config-v3.mjs";
import { canonicalJsonDigest } from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import { runWakeflowMaintenanceMutation } from "../core/scripts/lib/wakeflow-workspace-mutation.mjs";
import { hostProfile as codexProfile } from "../plugins/codex-wakeflow/scripts/lib/wakeflow-host-profile.mjs";
import { hostProfile as claudeProfile } from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-host-profile.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureValue = JSON.parse(readFileSync(
  path.join(repositoryRoot, "test/fixtures/wakeflow-config-v3/valid-minimal.json"),
  "utf8",
));
const managedContentUrl = pathToFileURL(path.join(
  repositoryRoot,
  "core/scripts/lib/wakeflow-managed-content.mjs",
)).href;
const mutationUrl = pathToFileURL(path.join(
  repositoryRoot,
  "core/scripts/lib/wakeflow-workspace-mutation.mjs",
)).href;
const canonicalUrl = pathToFileURL(path.join(
  repositoryRoot,
  "core/scripts/lib/wakeflow-canonical-json.mjs",
)).href;

let managedContent = null;
let managedContentImportError = null;
try {
  managedContent = await import(managedContentUrl);
} catch (error) {
  managedContentImportError = error;
}

function parsed(mutator = null) {
  const value = structuredClone(fixtureValue);
  mutator?.(value);
  return parseWakeflowConfigV3(value);
}

function api(name) {
  assert.ifError(managedContentImportError);
  assert.equal(typeof managedContent?.[name], "function", `${name} must be implemented`);
  return managedContent[name];
}

function prepareWorkspace(t, model = parsed()) {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-managed-content-"));
  const workspaceRoot = path.join(fixtureRoot, "Program");
  mkdirSync(workspaceRoot, { recursive: true, mode: 0o700 });
  for (const configured of [
    ...model.topology.repositories.map((entry) => entry.path),
    ...model.topology.supportSurfaces.map((entry) => entry.path),
    model.storage.ledgerRoot,
  ]) mkdirSync(path.resolve(workspaceRoot, configured), { recursive: true, mode: 0o700 });
  writeFileSync(
    path.join(workspaceRoot, "wakeflow.config.json"),
    serializeWakeflowConfigV3(model),
    { mode: 0o644 },
  );
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  return { workspaceRoot, model };
}

async function applyManagedPlan({ workspaceRoot, input, confirmedPlan }) {
  const participant = api("createWakeflowManagedContentMutationParticipant")({
    ...input,
    confirmedPlan,
  });
  return runWakeflowMaintenanceMutation({
    workspaceRoot,
    action: input.action,
    operationKind: "managed-content",
    domainOwner: "managed-content-owner",
    confirmedPlan,
    planDigest: canonicalJsonDigest(confirmedPlan),
    validatePlan: participant.validatePlan,
    deriveCurrentPlan: participant.deriveCurrentPlan,
    deriveTerminalClosure: participant.deriveTerminalClosure,
    stepHandlers: participant.stepHandlers,
  });
}

test("T06 exposes one internal managed-content owner without changing public-v2", () => {
  assert.ifError(managedContentImportError);
  assert.equal(
    managedContent.WAKEFLOW_MANAGED_CONTENT_SCHEMA_ID,
    "urn:wakeflow:internal:managed-content-plan:v1",
  );
  assert.equal(managedContent.WAKEFLOW_MANAGED_CONTENT_KIND, "WakeflowManagedContentPlan");
  assert.equal(managedContent.WAKEFLOW_MANAGED_CONTENT_SCHEMA_VERSION, 1);
  assert.equal(typeof managedContent.WakeflowManagedContentError, "function");
  for (const name of [
    "planWakeflowManagedContent",
    "projectWakeflowManagedContentMaintenance",
    "validateWakeflowManagedContentPlan",
    "createWakeflowManagedContentMutationParticipant",
  ]) assert.equal(typeof managedContent[name], "function", `${name} must be implemented`);
});

test("T06 owner plan projects both real owners into the shared maintenance graph", (t) => {
  const { workspaceRoot, model } = prepareWorkspace(t);
  const ownerPlan = api("planWakeflowManagedContent")({
    workspaceRoot,
    action: "reconcile",
    sourceModel: model,
    desiredModel: model,
    hostProfile: codexProfile,
    authorizedRepositoryIds: [],
  });
  const projection = api("projectWakeflowManagedContentMaintenance")({
    plan: ownerPlan,
    transactionOffset: 3,
  });
  assert.deepEqual(
    projection.components.map((entry) => [entry.componentId, entry.owner]),
    [
      ["ignore", "ignore-manager"],
      ["managed-memory", "instruction-renderer"],
    ],
  );
  assert.equal(projection.filesystemActions.every((entry) => (
    entry.componentId === (entry.owner === "ignore-manager" ? "ignore" : "managed-memory")
  )), true);
  assert.deepEqual(
    projection.steps.map((entry) => entry.ordinal),
    ownerPlan.payload.steps.map((_, index) => index + 3),
  );
  assert.deepEqual(
    projection.filesystemActions
      .filter((entry) => entry.stepId !== null)
      .sort((left, right) => left.commitOrder - right.commitOrder)
      .map((entry) => entry.commitOrder),
    ownerPlan.payload.steps.map((_, index) => index + 3),
  );
  assert.equal(Object.isFrozen(projection), true);
  assert.equal(JSON.stringify(projection).includes(workspaceRoot), false);
});

test("T06 candidate rule model has strict program and repository renderers", async () => {
  const ruleModel = await import("../core/scripts/lib/wakeflow-rule-model.mjs");
  assert.equal(typeof ruleModel.renderProgramMemoryCandidate, "function");
  assert.equal(typeof ruleModel.renderRepositoryMemoryCandidate, "function");

  const model = parsed((value) => {
    value.topology.repositories[0].instructionManagement = "managed-block";
  });
  const controller = model.topology.windows.find((entry) => entry.role === "controller");
  const repository = model.topology.repositories[0];
  const windows = model.topology.windows.filter((entry) => (
    entry.role === "product" && entry.root.repositoryId === repository.repositoryId
  ));
  const program = ruleModel.renderProgramMemoryCandidate({
    program: model.program,
    controllerWindowId: controller.windowId,
    host: {
      hostId: codexProfile.hostId,
      hostName: codexProfile.hostName,
      memoryFile: codexProfile.memoryFile,
    },
    paths: {
      config: "wakeflow.config.json",
      activeIndex: ".wakeflow-active/index.md",
      activeStatus: ".wakeflow-active/current/workspace-current-status.md",
      activeCurrent: ".wakeflow-active/current",
      localRoot: ".wakeflow-local",
      ledgerRecordMap: `${model.storage.ledgerRoot}/workspace/workspace-record-map.md`,
    },
  });
  const card = ruleModel.renderRepositoryMemoryCandidate({
    programId: model.program.programId,
    repository,
    windows,
    host: {
      hostId: codexProfile.hostId,
      hostName: codexProfile.hostName,
      memoryFile: codexProfile.memoryFile,
    },
    paths: {
      programMemory: codexProfile.memoryFile,
      activeIndex: ".wakeflow-active/index.md",
      activeStatus: ".wakeflow-active/current/workspace-current-status.md",
      localRoot: ".wakeflow-local",
      ledgerRecordMap: `${model.storage.ledgerRoot}/workspace/workspace-record-map.md`,
    },
  });
  assert.equal(program.kind, "WakeflowProgramMemory");
  assert.equal(card.kind, "WakeflowRepositoryMemory");
  assert.match(program.content, new RegExp(model.program.programId, "u"));
  assert.match(card.content, new RegExp(repository.repositoryId, "u"));
  assert.equal(card.content.includes("window ledger"), false);
  assert.equal(card.content.includes("test-exchange"), false);
});

test("T06 rule renderers expose only current v3 contracts and reject behavioral data", async () => {
  const ruleModel = await import("../core/scripts/lib/wakeflow-rule-model.mjs");
  assert.deepEqual(Object.keys(ruleModel).sort(), [
    "WakeflowRuleModelError",
    "renderProgramMemoryCandidate",
    "renderRepositoryMemoryCandidate",
    "renderSupportRoleMemoryCandidate",
  ]);

  const model = parsed((value) => {
    value.topology.repositories[0].instructionManagement = "managed-block";
  });
  const controller = model.topology.windows.find((entry) => entry.role === "controller");
  const repository = model.topology.repositories[0];
  const windows = model.topology.windows.filter((entry) => (
    entry.role === "product" && entry.root.repositoryId === repository.repositoryId
  ));
  const programInput = {
    program: model.program,
    controllerWindowId: controller.windowId,
    host: {
      hostId: codexProfile.hostId,
      hostName: codexProfile.hostName,
      memoryFile: codexProfile.memoryFile,
    },
    paths: {
      config: "wakeflow.config.json",
      activeIndex: ".wakeflow-active/index.md",
      activeStatus: ".wakeflow-active/current/workspace-current-status.md",
      activeCurrent: ".wakeflow-active/current",
      localRoot: ".wakeflow-local",
      ledgerRecordMap: `${model.storage.ledgerRoot}/workspace/workspace-record-map.md`,
    },
  };

  let topLevelGetterCalls = 0;
  const behavioral = { ...programInput };
  Object.defineProperty(behavioral, "program", {
    enumerable: true,
    get() {
      topLevelGetterCalls += 1;
      return model.program;
    },
  });
  assert.throws(
    () => ruleModel.renderProgramMemoryCandidate(behavioral),
    (error) => error?.code === "wakeflow-rule-model-type",
  );
  assert.equal(topLevelGetterCalls, 0);

  const hidden = { ...programInput };
  Object.defineProperty(hidden, "authority", { value: "forged", enumerable: false });
  assert.throws(
    () => ruleModel.renderProgramMemoryCandidate(hidden),
    (error) => error?.code === "wakeflow-rule-model-unknown",
  );

  const decoratedWindows = [...windows];
  Object.setPrototypeOf(decoratedWindows, Object.create(Array.prototype));
  assert.throws(
    () => ruleModel.renderRepositoryMemoryCandidate({
      programId: model.program.programId,
      repository,
      windows: decoratedWindows,
      host: programInput.host,
      paths: {
        programMemory: codexProfile.memoryFile,
        activeIndex: ".wakeflow-active/index.md",
        activeStatus: ".wakeflow-active/current/workspace-current-status.md",
        localRoot: ".wakeflow-local",
        ledgerRecordMap: `${model.storage.ledgerRoot}/workspace/workspace-record-map.md`,
      },
    }),
    (error) => error?.code === "wakeflow-rule-model-window",
  );

  const encoded = ruleModel.renderProgramMemoryCandidate({
    ...programInput,
    program: {
      ...model.program,
      displayName: "Program [link](https://example.test) <tag>",
      description: "Literal `instruction`",
    },
    paths: {
      ...programInput.paths,
      ledgerRecordMap: "wakeflow-ledger/`records`/map.md",
    },
  });
  assert.equal(encoded.content.includes("[link](https://example.test)"), false);
  assert.equal(encoded.content.includes("<tag>"), false);
  assert.equal(
    encoded.content.includes("Program \\[link\\]\\(https://example\\.test\\) &lt;tag&gt;"),
    true,
  );
  assert.match(encoded.content, /`` wakeflow-ledger\/`records`\/map\.md ``/u);
});

test("T06 managed-content preview is closed, deterministic, deep-frozen, and read-only", (t) => {
  const { workspaceRoot, model } = prepareWorkspace(t);
  const before = readFileSync(path.join(workspaceRoot, "wakeflow.config.json"));
  const input = {
    workspaceRoot,
    action: "reconcile",
    sourceModel: model,
    desiredModel: model,
    hostProfile: codexProfile,
    authorizedRepositoryIds: [],
  };
  const first = api("planWakeflowManagedContent")(input);
  const second = api("planWakeflowManagedContent")(input);
  assert.deepEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.payload.operations), true);
  assert.equal(first.payload.action, "reconcile");
  assert.equal(JSON.stringify(first).includes(workspaceRoot), false);
  assert.deepEqual(readFileSync(path.join(workspaceRoot, "wakeflow.config.json")), before);
  assert.throws(
    () => api("planWakeflowManagedContent")({ ...input, desiredContent: "forged" }),
    (error) => error.code === "wakeflow-managed-content-input",
  );
});

test("T06 managed-content input and host facade admission execute no accessors", (t) => {
  const { workspaceRoot, model } = prepareWorkspace(t);
  const base = {
    workspaceRoot,
    action: "reconcile",
    sourceModel: model,
    desiredModel: model,
    hostProfile: codexProfile,
    authorizedRepositoryIds: [],
  };

  let actionReads = 0;
  const behavioralInput = { ...base };
  Object.defineProperty(behavioralInput, "action", {
    enumerable: true,
    get() {
      actionReads += 1;
      return "reconcile";
    },
  });
  assert.throws(() => api("planWakeflowManagedContent")(behavioralInput));
  assert.equal(actionReads, 0, "planning input accessors must be rejected before execution");

  let hostNameReads = 0;
  const behavioralHost = { ...codexProfile };
  Object.defineProperty(behavioralHost, "hostName", {
    enumerable: true,
    get() {
      hostNameReads += 1;
      return "Codex";
    },
  });
  assert.throws(() => api("planWakeflowManagedContent")({ ...base, hostProfile: behavioralHost }));
  assert.equal(hostNameReads, 0, "host presentation accessors must be rejected before execution");

  const repositoryId = model.topology.repositories[0].repositoryId;
  let repositoryReads = 0;
  const behavioralRepositories = [];
  Object.defineProperty(behavioralRepositories, "0", {
    enumerable: true,
    configurable: true,
    get() {
      repositoryReads += 1;
      return repositoryId;
    },
  });
  behavioralRepositories.length = 1;
  assert.throws(() => api("planWakeflowManagedContent")({
    ...base,
    authorizedRepositoryIds: behavioralRepositories,
  }));
  assert.equal(repositoryReads, 0, "authorization arrays must reject accessors without execution");

  assert.throws(
    () => api("planWakeflowManagedContent")({ ...base, workspaceRoot: "relative-workspace" }),
    (error) => error?.code === "wakeflow-managed-content-input",
  );
});

test("T06 standalone plan codec rejects semantically forged operations", (t) => {
  const { workspaceRoot, model } = prepareWorkspace(t);
  const plan = api("planWakeflowManagedContent")({
    workspaceRoot,
    action: "reconcile",
    sourceModel: model,
    desiredModel: model,
    hostProfile: codexProfile,
    authorizedRepositoryIds: [],
  });
  const physicalIndex = plan.payload.operations.findIndex((entry) => (
    ["create-managed", "update-managed", "remove-managed-block"].includes(entry.action)
  ));
  const memoryIndex = plan.payload.operations.findIndex((entry) => entry.component.kind !== "ignore");
  assert.notEqual(physicalIndex, -1);
  assert.notEqual(memoryIndex, -1);

  const forgedPlans = [];
  const forgedReason = structuredClone(plan);
  forgedReason.payload.operations[physicalIndex].reasonCode = "managed-content-current";
  forgedPlans.push(forgedReason);
  const forgedAction = structuredClone(plan);
  forgedAction.payload.operations[physicalIndex].action = "update-managed";
  forgedPlans.push(forgedAction);
  const forgedOwner = structuredClone(plan);
  forgedOwner.payload.operations[memoryIndex].owner = "ignore-manager";
  forgedPlans.push(forgedOwner);
  const forgedRoot = structuredClone(plan);
  forgedRoot.payload.operations[physicalIndex].root.configuredPath = "forged-root";
  forgedPlans.push(forgedRoot);
  const forgedStage = structuredClone(plan);
  const forgedOperation = forgedStage.payload.operations[physicalIndex];
  forgedOperation.stageRef = ".forged-managed.stage";
  const forgedStep = forgedStage.payload.steps.find((entry) => entry.stepId === forgedOperation.operationId);
  forgedStep.staging.ref = path.posix.join(
    path.posix.dirname(forgedOperation.resourceRef),
    forgedOperation.stageRef,
  );
  forgedPlans.push(forgedStage);

  for (const forged of forgedPlans) {
    assert.throws(
      () => api("validateWakeflowManagedContentPlan")(forged),
      (error) => error?.code === "wakeflow-managed-content-plan",
    );
  }
});

test("T06 managed-content participant callbacks execute no argument accessors", (t) => {
  const { workspaceRoot, model } = prepareWorkspace(t);
  const input = {
    workspaceRoot,
    action: "reconcile",
    sourceModel: model,
    desiredModel: model,
    hostProfile: codexProfile,
    authorizedRepositoryIds: [],
  };
  const confirmedPlan = api("planWakeflowManagedContent")(input);
  const participant = api("createWakeflowManagedContentMutationParticipant")({
    ...input,
    confirmedPlan,
  });

  let planReads = 0;
  const planArgs = {};
  Object.defineProperty(planArgs, "plan", {
    enumerable: true,
    get() {
      planReads += 1;
      return confirmedPlan;
    },
  });
  assert.throws(() => participant.validatePlan(planArgs));
  assert.equal(planReads, 0, "participant plan arguments must reject accessors without execution");

  const [firstStep] = confirmedPlan.payload.steps;
  assert.ok(firstStep, "fixture must expose a physical managed-content step");
  let contextReads = 0;
  const boundaryArgs = {};
  Object.defineProperty(boundaryArgs, "context", {
    enumerable: true,
    get() {
      contextReads += 1;
      return null;
    },
  });
  assert.throws(() => participant.stepHandlers[firstStep.stepId].observe(boundaryArgs));
  assert.equal(contextReads, 0, "step boundary arguments must reject accessors without execution");
});

test("T06 managed roots reject an intermediate symlink before owner planning", (t) => {
  const model = parsed((value) => {
    const design = value.topology.supportSurfaces.find((entry) => entry.capability === "design");
    design.path = "nested/Design";
  });
  const { workspaceRoot } = prepareWorkspace(t, model);
  const nested = path.join(workspaceRoot, "nested");
  const outside = path.join(path.dirname(workspaceRoot), "outside");
  rmSync(nested, { recursive: true, force: true });
  mkdirSync(path.join(outside, "Design"), { recursive: true, mode: 0o755 });
  symlinkSync(outside, nested, "dir");

  assert.throws(
    () => api("planWakeflowManagedContent")({
      workspaceRoot,
      action: "reconcile",
      sourceModel: model,
      desiredModel: model,
      hostProfile: codexProfile,
      authorizedRepositoryIds: [],
    }),
    (error) => error?.code === "wakeflow-layout-symlink",
  );
  assert.equal(existsSync(path.join(outside, "Design", codexProfile.memoryFile)), false);
});

test("T06 managed-content planning rejects a model outside current config authority", (t) => {
  const { workspaceRoot } = prepareWorkspace(t);
  const unrelated = parsed((value) => {
    value.program.displayName = "Uncommitted model";
  });
  assert.throws(
    () => api("planWakeflowManagedContent")({
      workspaceRoot,
      action: "reconcile",
      sourceModel: unrelated,
      desiredModel: unrelated,
      hostProfile: codexProfile,
      authorizedRepositoryIds: [],
    }),
    (error) => error.code === "wakeflow-managed-content-config",
  );
  assert.equal(existsSync(path.join(workspaceRoot, codexProfile.memoryFile)), false);
  assert.equal(existsSync(path.join(workspaceRoot, ".gitignore")), false);
});

test("T06 participant rejects a forged operation root before filesystem use", (t) => {
  const { workspaceRoot, model } = prepareWorkspace(t);
  const input = {
    workspaceRoot,
    action: "reconcile",
    sourceModel: model,
    desiredModel: model,
    hostProfile: codexProfile,
    authorizedRepositoryIds: [],
  };
  const forged = structuredClone(api("planWakeflowManagedContent")(input));
  forged.payload.operations[0].root.configuredPath = "../../forged-root";
  assert.throws(
    () => api("createWakeflowManagedContentMutationParticipant")({
      ...input,
      confirmedPlan: forged,
    }),
    (error) => error.code === "wakeflow-managed-content-plan",
  );
  assert.equal(existsSync(path.resolve(workspaceRoot, "../../forged-root")), false);
});

test("T06 managed-content participant preserves owner bytes and closes create/update stages", async (t) => {
  const { workspaceRoot, model } = prepareWorkspace(t);
  const programMemory = path.join(workspaceRoot, codexProfile.memoryFile);
  const ignore = path.join(workspaceRoot, ".gitignore");
  const ownerMemory = "# Program owner notes\n\nKeep this byte-for-byte.\n";
  const ownerIgnore = "node_modules/\n";
  writeFileSync(programMemory, ownerMemory, { mode: 0o644 });
  writeFileSync(ignore, ownerIgnore, { mode: 0o644 });
  const input = {
    workspaceRoot,
    action: "reconcile",
    sourceModel: model,
    desiredModel: model,
    hostProfile: codexProfile,
    authorizedRepositoryIds: [],
  };
  const confirmedPlan = api("planWakeflowManagedContent")(input);
  assert.equal(confirmedPlan.payload.status, "ready");
  assert.equal(confirmedPlan.payload.steps.length, 4);
  assert.equal(
    confirmedPlan.payload.operations.find((entry) => entry.component.kind === "program-memory").action,
    "update-managed",
  );
  const participant = api("createWakeflowManagedContentMutationParticipant")({
    ...input,
    confirmedPlan,
  });
  const applied = await runWakeflowMaintenanceMutation({
    workspaceRoot,
    action: "reconcile",
    operationKind: "managed-content",
    domainOwner: "managed-content-owner",
    confirmedPlan,
    planDigest: canonicalJsonDigest(confirmedPlan),
    validatePlan: participant.validatePlan,
    deriveCurrentPlan: participant.deriveCurrentPlan,
    deriveTerminalClosure: participant.deriveTerminalClosure,
    stepHandlers: participant.stepHandlers,
  });
  assert.equal(applied.status, "completed");
  const memoryBytes = readFileSync(programMemory, "utf8");
  const ignoreBytes = readFileSync(ignore, "utf8");
  assert.equal(memoryBytes.startsWith(ownerMemory), true);
  assert.equal(ignoreBytes.startsWith(ownerIgnore), true);
  assert.match(memoryBytes, /wakeflow:managed-content:v1:begin component=program-memory/u);
  assert.match(ignoreBytes, /wakeflow:managed-content:v1:begin component=ignore/u);
  assert.equal(readFileSync(path.join(workspaceRoot, "Design", codexProfile.memoryFile), "utf8").includes(
    "component=support-memory",
  ), true);
  assert.equal(readFileSync(path.join(workspaceRoot, "Test", codexProfile.memoryFile), "utf8").includes(
    "component=support-memory",
  ), true);
  assert.deepEqual(
    readFileSync(programMemory, "utf8").slice(0, ownerMemory.length),
    ownerMemory,
  );
  assert.deepEqual(
    readdirSync(path.join(workspaceRoot, ".wakeflow-local", "runtime", "maintenance", "transactions")),
    [],
  );
});

test("T06 exact managed output replans to zero steps and modified markers fail closed", async (t) => {
  const { workspaceRoot, model } = prepareWorkspace(t);
  const input = {
    workspaceRoot,
    action: "reconcile",
    sourceModel: model,
    desiredModel: model,
    hostProfile: codexProfile,
    authorizedRepositoryIds: [],
  };
  const first = api("planWakeflowManagedContent")(input);
  const participant = api("createWakeflowManagedContentMutationParticipant")({ ...input, confirmedPlan: first });
  await runWakeflowMaintenanceMutation({
    workspaceRoot,
    action: "reconcile",
    operationKind: "managed-content",
    domainOwner: "managed-content-owner",
    confirmedPlan: first,
    planDigest: canonicalJsonDigest(first),
    validatePlan: participant.validatePlan,
    deriveCurrentPlan: participant.deriveCurrentPlan,
    deriveTerminalClosure: participant.deriveTerminalClosure,
    stepHandlers: participant.stepHandlers,
  });
  const current = api("planWakeflowManagedContent")(input);
  assert.equal(current.payload.status, "ready");
  assert.equal(current.payload.steps.length, 0);
  assert.equal(current.payload.operations.every((entry) => entry.action === "current"), true);

  const programMemory = path.join(workspaceRoot, codexProfile.memoryFile);
  const tampered = readFileSync(programMemory, "utf8").replace("## Wakeflow Program Contract", "## Modified Contract");
  writeFileSync(programMemory, tampered, { mode: 0o644 });
  const blocked = api("planWakeflowManagedContent")(input);
  const operation = blocked.payload.operations.find((entry) => entry.component.kind === "program-memory");
  assert.equal(blocked.payload.status, "blocked");
  assert.equal(operation.classification, "managed-modified");
  assert.equal(operation.action, "blocked");
  assert.equal(operation.reasonCode, "managed-marker-content-modified");
});

test("T07 fresh initialization rejects current and stale-known Wakeflow managed footprints", async (t) => {
  const { workspaceRoot, model } = prepareWorkspace(t);
  const reconcileInput = {
    workspaceRoot,
    action: "reconcile",
    sourceModel: model,
    desiredModel: model,
    hostProfile: codexProfile,
    authorizedRepositoryIds: [],
  };
  await applyManagedPlan({
    workspaceRoot,
    input: reconcileInput,
    confirmedPlan: api("planWakeflowManagedContent")(reconcileInput),
  });
  const freshInput = {
    workspaceRoot,
    action: "fresh-initialize",
    sourceModel: null,
    desiredModel: model,
    hostProfile: codexProfile,
    authorizedRepositoryIds: [],
  };
  const current = api("planWakeflowManagedContent")(freshInput);
  const currentMemory = current.payload.operations.find((entry) => (
    entry.component.kind === "program-memory"
  ));
  assert.equal(current.payload.status, "blocked");
  assert.equal(currentMemory.classification, "managed-current");
  assert.equal(currentMemory.action, "blocked");
  assert.equal(currentMemory.target, null);
  assert.equal(currentMemory.reasonCode, "fresh-managed-footprint-present");

  chmodSync(path.join(workspaceRoot, codexProfile.memoryFile), 0o600);
  const stale = api("planWakeflowManagedContent")(freshInput);
  const staleMemory = stale.payload.operations.find((entry) => (
    entry.component.kind === "program-memory"
  ));
  assert.equal(stale.payload.status, "blocked");
  assert.equal(staleMemory.classification, "managed-stale-known");
  assert.equal(staleMemory.action, "blocked");
  assert.equal(staleMemory.target, null);
  assert.equal(staleMemory.reasonCode, "fresh-managed-footprint-present");
  assert.throws(
    () => api("createWakeflowManagedContentMutationParticipant")({
      ...freshInput,
      confirmedPlan: stale,
    }),
    (error) => error.code === "wakeflow-managed-content-blocked",
  );
});

test("T06 duplicate, orphan, and reversed managed markers fail closed", async (t) => {
  const { workspaceRoot, model } = prepareWorkspace(t);
  const input = {
    workspaceRoot,
    action: "reconcile",
    sourceModel: model,
    desiredModel: model,
    hostProfile: codexProfile,
    authorizedRepositoryIds: [],
  };
  const initial = api("planWakeflowManagedContent")(input);
  await applyManagedPlan({ workspaceRoot, input, confirmedPlan: initial });
  const programMemory = path.join(workspaceRoot, codexProfile.memoryFile);
  const valid = readFileSync(programMemory, "utf8");
  const begin = valid.match(/<!-- wakeflow:managed-content:v1:begin[^\n]+ -->/u)?.[0];
  const end = valid.match(/<!-- wakeflow:managed-content:v1:end[^\n]+ -->/u)?.[0];
  assert.ok(begin && end);
  for (const current of [
    {
      name: "duplicate",
      bytes: `${valid}${valid}`,
      code: "managed-marker-malformed",
    },
    {
      name: "orphan",
      bytes: valid.replace(`${end}\n`, ""),
      code: "managed-marker-malformed",
    },
    {
      name: "reversed",
      bytes: valid.replace(begin, "__WAKEFLOW_BEGIN__").replace(end, begin).replace("__WAKEFLOW_BEGIN__", end),
      code: "managed-marker-pair-invalid",
    },
  ]) {
    writeFileSync(programMemory, current.bytes, { mode: 0o644 });
    const plan = api("planWakeflowManagedContent")(input);
    const operation = plan.payload.operations.find((entry) => entry.component.kind === "program-memory");
    assert.equal(plan.payload.status, "blocked", current.name);
    assert.equal(operation.action, "blocked", current.name);
    assert.equal(operation.reasonCode, current.code, current.name);
    writeFileSync(programMemory, valid, { mode: 0o644 });
  }
});

test("T06 external managed-block is writable while owner-managed support stays zero-write", (t) => {
  const { workspaceRoot, model } = prepareWorkspace(t, parsed((value) => {
    value.topology.supportSurfaces[0].ownership = "external-owned";
    value.topology.supportSurfaces[0].instructionManagement = "managed-block";
    value.topology.supportSurfaces[1].ownership = "external-owned";
    value.topology.supportSurfaces[1].instructionManagement = "owner-managed";
  }));
  const plan = api("planWakeflowManagedContent")({
    workspaceRoot,
    action: "reconcile",
    sourceModel: model,
    desiredModel: model,
    hostProfile: codexProfile,
    authorizedRepositoryIds: [],
  });
  const designId = model.topology.supportSurfaces[0].surfaceId;
  const testId = model.topology.supportSurfaces[1].surfaceId;
  const design = plan.payload.operations.find((entry) => entry.root.rootId === designId);
  assert.equal(design.component.kind, "support-memory");
  assert.equal(design.ownership, "managed-block");
  assert.equal(design.action, "create-managed");
  assert.equal(plan.payload.operations.some((entry) => entry.root.rootId === testId), false);
});

test("T06 reconfigure removes only an exact obsolete repository block", async (t) => {
  const { workspaceRoot, model } = prepareWorkspace(t, parsed((value) => {
    value.topology.repositories[0].instructionManagement = "managed-block";
  }));
  const repository = model.topology.repositories[0];
  const repositoryMemory = path.resolve(workspaceRoot, repository.path, codexProfile.memoryFile);
  const ownerBytes = "# Repository owner rules\n\nKeep this exactly.\n";
  writeFileSync(repositoryMemory, ownerBytes, { mode: 0o644 });
  const initialInput = {
    workspaceRoot,
    action: "reconcile",
    sourceModel: model,
    desiredModel: model,
    hostProfile: codexProfile,
    authorizedRepositoryIds: [],
  };
  await applyManagedPlan({
    workspaceRoot,
    input: initialInput,
    confirmedPlan: api("planWakeflowManagedContent")(initialInput),
  });
  const desiredModel = parseWakeflowConfigV3({
    ...structuredClone(model),
    topology: {
      ...structuredClone(model.topology),
      repositories: model.topology.repositories.map((entry) => ({
        ...structuredClone(entry),
        instructionManagement: "owner-managed",
      })),
    },
  });
  const input = {
    workspaceRoot,
    action: "reconfigure",
    sourceModel: model,
    desiredModel,
    hostProfile: codexProfile,
    authorizedRepositoryIds: [],
  };
  const plan = api("planWakeflowManagedContent")(input);
  const removal = plan.payload.operations.find((entry) => entry.root.rootId === repository.repositoryId);
  assert.equal(removal.action, "remove-managed-block");
  await applyManagedPlan({ workspaceRoot, input, confirmedPlan: plan });
  assert.equal(readFileSync(repositoryMemory, "utf8"), ownerBytes);
});

test("T06 participant rejects a raced source before publishing any managed stage", async (t) => {
  const { workspaceRoot, model } = prepareWorkspace(t);
  const input = {
    workspaceRoot,
    action: "reconcile",
    sourceModel: model,
    desiredModel: model,
    hostProfile: codexProfile,
    authorizedRepositoryIds: [],
  };
  const confirmedPlan = api("planWakeflowManagedContent")(input);
  const participant = api("createWakeflowManagedContentMutationParticipant")({
    ...input,
    confirmedPlan,
  });
  const programMemory = path.join(workspaceRoot, codexProfile.memoryFile);
  writeFileSync(programMemory, "raced owner bytes\n", { mode: 0o644 });
  await assert.rejects(
    runWakeflowMaintenanceMutation({
      workspaceRoot,
      action: "reconcile",
      operationKind: "managed-content",
      domainOwner: "managed-content-owner",
      confirmedPlan,
      planDigest: canonicalJsonDigest(confirmedPlan),
      validatePlan: participant.validatePlan,
      deriveCurrentPlan: participant.deriveCurrentPlan,
      deriveTerminalClosure: participant.deriveTerminalClosure,
      stepHandlers: participant.stepHandlers,
    }),
    /(?:blocked|illegal|plan|residue|recovery|stale)/iu,
  );
  assert.equal(readFileSync(programMemory, "utf8"), "raced owner bytes\n");
  assert.equal(
    confirmedPlan.payload.operations.some((operation) => (
      operation.stageRef !== null
      && existsSync(path.resolve(workspaceRoot, operation.root.configuredPath, operation.stageRef))
    )),
    false,
  );
});

test("T06 managed-content owner recovers prepare, commit, and terminal cleanup boundaries", {
  skip: !new Set(["darwin", "linux"]).has(process.platform)
    ? "M3 process-identity recovery is supported on Darwin and Linux"
    : false,
  timeout: 90_000,
}, async (t) => {
  for (const boundary of ["prepare", "commit", "cleanup"]) {
    await t.test(boundary, { timeout: 30_000 }, async (subtest) => {
      const { workspaceRoot, model } = prepareWorkspace(subtest);
      const childSource = `
        const owner = await import(${JSON.stringify(managedContentUrl)});
        const manager = await import(${JSON.stringify(mutationUrl)});
        const canonical = await import(${JSON.stringify(canonicalUrl)});
        const workspaceRoot = ${JSON.stringify(workspaceRoot)};
        const model = ${JSON.stringify(model)};
        const hostProfile = ${JSON.stringify(codexProfile)};
        const input = {
          workspaceRoot,
          action: "reconcile",
          sourceModel: model,
          desiredModel: model,
          hostProfile,
          authorizedRepositoryIds: [],
        };
        const plan = owner.planWakeflowManagedContent(input);
        const participant = owner.createWakeflowManagedContentMutationParticipant({ ...input, confirmedPlan: plan });
        const step = ${JSON.stringify(boundary)} === "cleanup" ? plan.payload.steps.at(-1) : plan.payload.steps[0];
        const real = participant.stepHandlers[step.stepId];
        const stepHandlers = { ...participant.stepHandlers, [step.stepId]: { ...real,
          ${boundary}(...args) { real.${boundary}(...args); process.kill(process.pid, "SIGKILL"); },
        } };
        await manager.runWakeflowMaintenanceMutation({
          workspaceRoot,
          action: "reconcile",
          operationKind: "managed-content",
          domainOwner: "managed-content-owner",
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
      const durablePlan = JSON.parse(readFileSync(path.join(transactionRoot, journalName), "utf8")).plan;
      const input = {
        workspaceRoot,
        action: "reconcile",
        sourceModel: model,
        desiredModel: model,
        hostProfile: codexProfile,
        authorizedRepositoryIds: [],
      };
      const participant = api("createWakeflowManagedContentMutationParticipant")({
        ...input,
        confirmedPlan: durablePlan,
      });
      const recovered = await (await import(mutationUrl)).recoverWakeflowWorkspaceMutation({
        workspaceRoot,
        operationId,
        confirmedPlan: durablePlan,
        planDigest: canonicalJsonDigest(durablePlan),
        validatePlan: participant.validatePlan,
        deriveCurrentPlan: participant.deriveCurrentPlan,
        deriveTerminalClosure: participant.deriveTerminalClosure,
        stepHandlers: participant.stepHandlers,
      });
      assert.equal(
        recovered.status,
        boundary === "cleanup" ? "terminal-cleanup-recovered" : "recovered",
      );
      const current = api("planWakeflowManagedContent")(input);
      assert.equal(current.payload.steps.length, 0);
      for (const operation of durablePlan.payload.operations) {
        const final = path.resolve(workspaceRoot, operation.root.configuredPath, operation.ref);
        assert.equal(existsSync(final), true);
        assert.equal(lstatSync(final).nlink, 1);
        assert.equal(
          readdirSync(path.dirname(final)).some((name) => name === operation.stageRef),
          false,
        );
      }
      assert.deepEqual(readdirSync(transactionRoot), []);
    });
  }
});

test("T06 repository memory is one managed component for all durable windows", (t) => {
  const { workspaceRoot, model } = prepareWorkspace(t, parsed((value) => {
    value.topology.repositories[0].instructionManagement = "managed-block";
    value.topology.windows.push({
      windowId: "window_99999999-9999-4999-8999-999999999999",
      role: "product",
      displayName: "Product A Secondary",
      root: {
        kind: "repository",
        repositoryId: value.topology.repositories[0].repositoryId,
      },
    });
  }));
  const plan = api("planWakeflowManagedContent")({
    workspaceRoot,
    action: "reconcile",
    sourceModel: model,
    desiredModel: model,
    hostProfile: codexProfile,
    authorizedRepositoryIds: [],
  });
  const repositoryOperations = plan.payload.operations.filter((entry) => (
    entry.component.kind === "repository-memory"
  ));
  assert.equal(repositoryOperations.length, 1);
  assert.equal(repositoryOperations[0].action, "create-managed");
  assert.equal(
    plan.payload.operations.filter((entry) => entry.root.kind === "repository").length,
    1,
  );
});

test("T06 owner-managed repositories stay zero-write and internal whole files reject user content", (t) => {
  const { workspaceRoot, model } = prepareWorkspace(t);
  writeFileSync(path.join(workspaceRoot, "Design", codexProfile.memoryFile), "user Design rules\n", {
    mode: 0o644,
  });
  const plan = api("planWakeflowManagedContent")({
    workspaceRoot,
    action: "reconcile",
    sourceModel: model,
    desiredModel: model,
    hostProfile: codexProfile,
    authorizedRepositoryIds: [],
  });
  assert.equal(plan.payload.operations.some((entry) => entry.root.kind === "repository"), false);
  const design = plan.payload.operations.find((entry) => (
    entry.component.kind === "support-memory" && entry.root.configuredPath === "Design"
  ));
  assert.equal(design.ownership, "managed-whole-file");
  assert.equal(design.classification, "user-owned");
  assert.equal(design.action, "blocked");
  assert.equal(design.reasonCode, "managed-whole-file-user-content");
});

test("T06 user-owned effective ignore rules are preserved while contradictory rules block", (t) => {
  const { workspaceRoot, model } = prepareWorkspace(t);
  const ignore = path.join(workspaceRoot, ".gitignore");
  writeFileSync(ignore, ".wakeflow-active/\n.wakeflow-local/\n", { mode: 0o644 });
  assert.equal(spawnSync("git", ["init", "-q"], { cwd: workspaceRoot }).status, 0);
  const input = {
    workspaceRoot,
    action: "reconcile",
    sourceModel: model,
    desiredModel: model,
    hostProfile: codexProfile,
    authorizedRepositoryIds: [],
  };
  const satisfied = api("planWakeflowManagedContent")(input);
  const first = satisfied.payload.operations.find((entry) => entry.component.kind === "ignore");
  assert.equal(first.action, "preserve");
  assert.equal(first.reasonCode, "ignore-satisfied-user-owned");

  writeFileSync(ignore, ".wakeflow-active/\n.wakeflow-local/\n!.wakeflow-local/\n", { mode: 0o644 });
  const blocked = api("planWakeflowManagedContent")(input);
  const second = blocked.payload.operations.find((entry) => entry.component.kind === "ignore");
  assert.equal(second.action, "blocked");
  assert.equal(second.reasonCode, "ignore-related-rule-conflict");
});

test("T06 Claude settings owner exposes a maintenance participant without adding a Codex surface", async () => {
  const claude = await import(
    "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-settings.mjs"
  );
  assert.equal(typeof claude.planClaudeSettingsAssetsMaintenance, "function");
  assert.equal(typeof claude.createClaudeSettingsAssetsMutationParticipant, "function");
  assert.equal(claudeProfile.capabilities.settings.applicable, true);
  assert.equal(codexProfile.capabilities.settings.applicable, false);
  await assert.rejects(
    import("../plugins/codex-wakeflow/scripts/lib/wakeflow-claude-settings.mjs"),
    (error) => error?.code === "ERR_MODULE_NOT_FOUND",
  );
});
