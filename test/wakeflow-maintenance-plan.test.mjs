import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import { hostProfile } from "../core/scripts/lib/wakeflow-host-profile.mjs";
import { canonicalJsonDigest } from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import {
  parseWakeflowConfigV3,
  serializeWakeflowConfigV3,
  wakeflowConfigV3Digest,
} from "../core/scripts/lib/wakeflow-config-v3.mjs";
import { normalizeWakeflowHostCapabilityProfile } from "../core/scripts/lib/wakeflow-host-capability.mjs";
import { createWakeflowLayoutDescriptor } from "../core/scripts/lib/wakeflow-layout-descriptor.mjs";
import {
  WAKEFLOW_MAINTENANCE_PLAN_ACTIONS,
  WAKEFLOW_MAINTENANCE_PLAN_KIND,
  WAKEFLOW_MAINTENANCE_PLAN_SCHEMA_ID,
  WAKEFLOW_MAINTENANCE_PLAN_SCHEMA_VERSION,
  WakeflowMaintenancePlanError,
  createWakeflowMaintenancePlan,
  isWakeflowMaintenancePlanApplicable,
  validateWakeflowMaintenancePlan,
  wakeflowMaintenancePlanDigest,
} from "../core/scripts/lib/wakeflow-maintenance-plan.mjs";
import { runWakeflowMaintenanceMutation } from "../core/scripts/lib/wakeflow-workspace-mutation.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configFixture = JSON.parse(readFileSync(
  path.join(repositoryRoot, "test/fixtures/wakeflow-config-v3/valid-full.json"),
  "utf8",
));
const model = parseWakeflowConfigV3(configFixture);
const programId = model.program.programId;
const normalizedHost = normalizeWakeflowHostCapabilityProfile(hostProfile);
const descriptor = createWakeflowLayoutDescriptor({ model, hostProfile });
const CONFIG_REF = "wakeflow.config.json";
const CONFIG_COMPONENT = "config";
const LAYOUT_COMPONENT = "workspace-layout";
const CONFIG_ACTION = "config-write";
const ACTIVE_ACTION = "active-root-create";
const CONFIG_RESOURCE = `targets/program/${programId}/wakeflow.config.json`;
const ACTIVE_RESOURCE = `targets/program/${programId}/.wakeflow-active`;

function digestBytes(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function digestLabel(value) {
  return canonicalJsonDigest({ value });
}

function configTarget(value = model) {
  return {
    type: "file",
    mode: "0644",
    digest: digestBytes(serializeWakeflowConfigV3(value)),
  };
}

function actionRoot(kind, rootId, configuredPath, basis = "target") {
  return { kind, rootId, basis, configuredPath };
}

function entityTypeAndId(entry) {
  if (Object.hasOwn(entry, "repositoryId")) return ["repository", entry.repositoryId];
  if (Object.hasOwn(entry, "surfaceId")) return ["surface", entry.surfaceId];
  return ["window", entry.windowId];
}

function entityPlacement(type, entry) {
  if (type === "repository" || type === "surface") return entry.path;
  return null;
}

function topologyFor(action, desiredModel = model) {
  const change = action === "fresh-initialize" ? "added" : "unchanged";
  const entities = [
    ...desiredModel.topology.repositories,
    ...desiredModel.topology.supportSurfaces,
    ...desiredModel.topology.windows,
  ];
  return entities.map((entry) => {
    const [entityType, entityId] = entityTypeAndId(entry);
    const targetDigest = canonicalJsonDigest(entry);
    const targetPlacement = entityPlacement(entityType, entry);
    return {
      entityType,
      entityId,
      change,
      sourceDigest: change === "added" ? null : targetDigest,
      targetDigest,
      sourcePlacement: change === "added" ? null : targetPlacement,
      targetPlacement,
    };
  });
}

function stepFor({ actionId, resourceRef, source, target, ordinal }) {
  const isDirectory = target.type === "directory";
  return {
    stepId: actionId,
    ordinal,
    stepKind: "create-or-update",
    source: { ref: resourceRef, ...source },
    staging: isDirectory
      ? null
      : {
          ref: `${path.posix.dirname(resourceRef)}/.${path.posix.basename(resourceRef)}.wakeflow-stage`,
          ...target,
        },
    final: { ref: resourceRef, ...target },
  };
}

function baseInput(action = "fresh-initialize") {
  const fresh = action === "fresh-initialize";
  const target = configTarget();
  const currentConfig = fresh ? { type: "absent" } : target;
  const currentActive = fresh
    ? { type: "absent" }
    : { type: "directory", mode: "0755", digest: digestLabel("active-root") };
  const desiredActive = { type: "directory", mode: "0755", digest: digestLabel("active-root") };
  const physical = fresh;
  const filesystemActions = [
    {
      actionId: CONFIG_ACTION,
      componentId: CONFIG_COMPONENT,
      owner: "config-writer",
      root: actionRoot("program", programId, "."),
      ref: CONFIG_REF,
      resourceRef: CONFIG_RESOURCE,
      classification: fresh ? "managed-missing" : "managed-current",
      source: currentConfig,
      target,
      action: fresh ? "create-managed" : "current",
      authorization: { kind: fresh ? "wakeflow-owned" : "none" },
      reasonCode: fresh ? "fresh-config" : "config-current",
      stepId: physical ? CONFIG_ACTION : null,
      commitOrder: physical ? 0 : null,
    },
    {
      actionId: ACTIVE_ACTION,
      componentId: LAYOUT_COMPONENT,
      owner: "layout-manager",
      root: actionRoot("program", programId, "."),
      ref: ".wakeflow-active",
      resourceRef: ACTIVE_RESOURCE,
      classification: fresh ? "managed-missing" : "managed-current",
      source: currentActive,
      target: desiredActive,
      action: fresh ? "create-managed" : "current",
      authorization: { kind: fresh ? "wakeflow-owned" : "none" },
      reasonCode: fresh ? "fresh-active-root" : "active-root-current",
      stepId: physical ? ACTIVE_ACTION : null,
      commitOrder: physical ? 1 : null,
    },
  ];
  return {
    action,
    programId,
    host: {
      hostId: normalizedHost.hostId,
      profileDigest: canonicalJsonDigest(normalizedHost),
    },
    config: {
      disposition: fresh ? "create" : "current",
      source: currentConfig,
      sourceAuthority: fresh
        ? null
        : { programId, modelDigest: wakeflowConfigV3Digest(model) },
      desiredModel: model,
    },
    layoutDigest: descriptor.layoutDigest,
    topologyDiff: topologyFor(action),
    components: [
      {
        componentId: LAYOUT_COMPONENT,
        owner: "layout-manager",
        ownerPlanDigest: digestLabel("layout-owner-plan"),
      },
      {
        componentId: CONFIG_COMPONENT,
        owner: "config-writer",
        ownerPlanDigest: digestLabel("config-owner-plan"),
      },
    ],
    filesystemActions,
    dependencyChecks: [],
    preserved: [],
    deferredOwnerActions: [],
    blockers: [],
    steps: physical
      ? [
          stepFor({
            actionId: CONFIG_ACTION,
            resourceRef: CONFIG_RESOURCE,
            source: currentConfig,
            target,
            ordinal: 0,
          }),
          stepFor({
            actionId: ACTIVE_ACTION,
            resourceRef: ACTIVE_RESOURCE,
            source: currentActive,
            target: desiredActive,
            ordinal: 1,
          }),
        ]
      : [],
  };
}

function clone(value) {
  return structuredClone(value);
}

function expectPlanError(callback, code = null) {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof WakeflowMaintenancePlanError);
    if (code !== null) assert.equal(error.code, code);
    return true;
  });
}

test("T02 freezes one closed aggregate plan identity and the same three M5 actions", () => {
  assert.equal(WAKEFLOW_MAINTENANCE_PLAN_SCHEMA_ID, "urn:wakeflow:internal:workspace-maintenance-plan:v1");
  assert.equal(WAKEFLOW_MAINTENANCE_PLAN_KIND, "WakeflowWorkspaceMaintenancePlan");
  assert.equal(WAKEFLOW_MAINTENANCE_PLAN_SCHEMA_VERSION, 1);
  assert.deepEqual(WAKEFLOW_MAINTENANCE_PLAN_ACTIONS, [
    "fresh-initialize",
    "reconfigure",
    "reconcile",
  ]);
  assert.equal(Object.isFrozen(WAKEFLOW_MAINTENANCE_PLAN_ACTIONS), true);
  assert.equal(WAKEFLOW_MAINTENANCE_PLAN_ACTIONS.includes("explicit-migration"), false);
});

test("fresh plan is deterministic, canonical, deeply frozen, schema-valid, and externally digested", () => {
  const first = createWakeflowMaintenancePlan(baseInput());
  const second = createWakeflowMaintenancePlan(clone(baseInput()));
  assert.deepEqual(first, second);
  assert.equal(first.schemaId, WAKEFLOW_MAINTENANCE_PLAN_SCHEMA_ID);
  assert.equal(first.payload.kind, WAKEFLOW_MAINTENANCE_PLAN_KIND);
  assert.equal(first.payload.status, "ready");
  assert.equal(Object.hasOwn(first, "planDigest"), false);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.payload.config.desiredModel), true);
  assert.deepEqual(validateWakeflowMaintenancePlan(first), first);
  assert.equal(wakeflowMaintenancePlanDigest(first), canonicalJsonDigest(first));
  assert.equal(isWakeflowMaintenancePlanApplicable(first), true);

  const staleDerivedTarget = clone(first);
  staleDerivedTarget.payload.config.target.digest = digestLabel("stale-config-target");
  expectPlanError(() => validateWakeflowMaintenancePlan(staleDerivedTarget));

  const staleDerivedModelDigest = clone(first);
  staleDerivedModelDigest.payload.config.desiredModelDigest = digestLabel("stale-config-model");
  expectPlanError(() => validateWakeflowMaintenancePlan(staleDerivedModelDigest));

  const schema = JSON.parse(readFileSync(
    path.join(repositoryRoot, "core/schemas/wakeflow-maintenance/workspace-maintenance-plan.schema.json"),
    "utf8",
  ));
  const configSchema = JSON.parse(readFileSync(
    path.join(repositoryRoot, "core/schemas/wakeflow-config.schema.json"),
    "utf8",
  ));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addSchema(configSchema);
  const validateSchema = ajv.compile(schema);
  assert.equal(validateSchema(first), true, JSON.stringify(validateSchema.errors));
});

test("fresh, reconfigure, and reconcile close distinct config authority invariants", () => {
  for (const action of WAKEFLOW_MAINTENANCE_PLAN_ACTIONS) {
    const plan = createWakeflowMaintenancePlan(baseInput(action));
    assert.equal(plan.payload.action, action);
    assert.equal(plan.payload.config.disposition, action === "fresh-initialize" ? "create" : "current");
  }

  const freshWithSource = baseInput();
  freshWithSource.config.source = configTarget();
  freshWithSource.config.sourceAuthority = { programId, modelDigest: wakeflowConfigV3Digest(model) };
  expectPlanError(() => createWakeflowMaintenancePlan(freshWithSource));

  const reconcileMutation = baseInput("reconcile");
  reconcileMutation.config.disposition = "update";
  reconcileMutation.filesystemActions[0].action = "update-managed";
  expectPlanError(() => createWakeflowMaintenancePlan(reconcileMutation));

  const reconfigureNewProgram = baseInput("reconfigure");
  reconfigureNewProgram.config.sourceAuthority.programId = "program_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  expectPlanError(() => createWakeflowMaintenancePlan(reconfigureNewProgram));
});

test("topology diff covers target stable IDs and root mappings remain config-derived and portable", () => {
  const plan = createWakeflowMaintenancePlan(baseInput());
  const expectedTargetIds = [
    ...model.topology.repositories.map((entry) => entry.repositoryId),
    ...model.topology.supportSurfaces.map((entry) => entry.surfaceId),
    ...model.topology.windows.map((entry) => entry.windowId),
  ].sort();
  assert.deepEqual(
    plan.payload.topologyDiff.map((entry) => entry.entityId).sort(),
    expectedTargetIds,
  );

  const repositoryAction = clone(baseInput());
  repositoryAction.filesystemActions.push({
    actionId: "repository-memory-current",
    componentId: LAYOUT_COMPONENT,
    owner: "layout-manager",
    root: actionRoot(
      "repository",
      model.topology.repositories[0].repositoryId,
      model.topology.repositories[0].path,
    ),
    ref: "AGENTS.md",
    resourceRef: `targets/repository/${model.topology.repositories[0].repositoryId}/AGENTS.md`,
    classification: "managed-current",
    source: { type: "file", mode: "0644", digest: digestLabel("repository-memory") },
    target: { type: "file", mode: "0644", digest: digestLabel("repository-memory") },
    action: "current",
    authorization: { kind: "none" },
    reasonCode: "repository-memory-current",
    stepId: null,
    commitOrder: null,
  });
  assert.equal(createWakeflowMaintenancePlan(repositoryAction).payload.status, "ready");

  repositoryAction.filesystemActions.at(-1).authorization = {
    kind: "explicit-repository",
    repositoryId: model.topology.repositories[0].repositoryId,
  };
  assert.equal(createWakeflowMaintenancePlan(repositoryAction).payload.status, "ready");

  repositoryAction.filesystemActions.at(-1).authorization.repositoryId =
    "repository_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  expectPlanError(() => createWakeflowMaintenancePlan(repositoryAction));

  repositoryAction.filesystemActions.at(-1).root.configuredPath = "/private/machine/ProductA";
  expectPlanError(() => createWakeflowMaintenancePlan(repositoryAction));

  const missingTarget = baseInput();
  missingTarget.topologyDiff = missingTarget.topologyDiff.slice(1);
  expectPlanError(() => createWakeflowMaintenancePlan(missingTarget));
});

test("reconfigure authorizes an exact removed repository only through its source-basis topology record", () => {
  const removedRepositoryId = "repository_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const removedPath = "../RetiredProduct";
  const input = baseInput("reconfigure");
  input.topologyDiff.push({
    entityType: "repository",
    entityId: removedRepositoryId,
    change: "removed",
    sourceDigest: digestLabel("retired-repository-source"),
    targetDigest: null,
    sourcePlacement: removedPath,
    targetPlacement: null,
  });
  input.filesystemActions.push({
    actionId: "retired-repository-memory-preserve",
    componentId: LAYOUT_COMPONENT,
    owner: "layout-manager",
    root: actionRoot("repository", removedRepositoryId, removedPath, "source"),
    ref: "AGENTS.md",
    resourceRef: `targets/repository/${removedRepositoryId}/AGENTS.md`,
    classification: "user-owned",
    source: { type: "file", mode: "0644", digest: digestLabel("retired-repository-memory") },
    target: { type: "file", mode: "0644", digest: digestLabel("retired-repository-memory") },
    action: "preserve",
    authorization: { kind: "explicit-repository", repositoryId: removedRepositoryId },
    reasonCode: "removed-repository-source-preserved",
    stepId: null,
    commitOrder: null,
  });

  const plan = createWakeflowMaintenancePlan(input);
  assert.equal(plan.payload.status, "ready");
  assert.deepEqual(plan.payload.filesystemActions.at(-1).root, {
    kind: "repository",
    rootId: removedRepositoryId,
    basis: "source",
    configuredPath: removedPath,
  });

  const forgedTargetBasis = clone(input);
  forgedTargetBasis.filesystemActions.at(-1).root.basis = "target";
  expectPlanError(() => createWakeflowMaintenancePlan(forgedTargetBasis));
});

test("component ownership, action resource identity, and physical step order form one exact graph", () => {
  const input = baseInput();
  const plan = createWakeflowMaintenancePlan(input);
  assert.deepEqual(
    plan.payload.components.map((entry) => entry.componentId),
    [...plan.payload.components.map((entry) => entry.componentId)].sort(),
  );
  assert.deepEqual(plan.payload.steps.map((entry) => entry.ordinal), [0, 1]);
  for (const action of plan.payload.filesystemActions.filter((entry) => entry.stepId !== null)) {
    const step = plan.payload.steps[action.commitOrder];
    assert.equal(step.stepId, action.actionId);
    assert.equal(step.final.ref, action.resourceRef);
    assert.deepEqual(
      { type: step.final.type, mode: step.final.mode, digest: step.final.digest },
      action.target,
    );
  }

  const unknownComponent = baseInput();
  unknownComponent.filesystemActions[0].componentId = "missing-component";
  expectPlanError(() => createWakeflowMaintenancePlan(unknownComponent));

  const wrongOwner = baseInput();
  wrongOwner.filesystemActions[0].owner = "layout-manager";
  expectPlanError(() => createWakeflowMaintenancePlan(wrongOwner));

  const wrongStep = baseInput();
  wrongStep.steps[0].final.digest = digestLabel("different-target");
  expectPlanError(() => createWakeflowMaintenancePlan(wrongStep));

  const duplicateResource = baseInput();
  duplicateResource.filesystemActions[1].resourceRef = CONFIG_RESOURCE;
  expectPlanError(() => createWakeflowMaintenancePlan(duplicateResource));

  const wrongConfigResource = baseInput();
  wrongConfigResource.filesystemActions[0].resourceRef = "targets/program/config-alias.json";
  wrongConfigResource.steps[0].source.ref = "targets/program/config-alias.json";
  wrongConfigResource.steps[0].staging.ref = "targets/program/.config-alias.json.wakeflow-stage";
  wrongConfigResource.steps[0].final.ref = "targets/program/config-alias.json";
  expectPlanError(() => createWakeflowMaintenancePlan(wrongConfigResource));
});

test("dependency and blocker facts derive applicability without erasing the full preview", () => {
  const input = baseInput("reconcile");
  const subject = { kind: "program", value: programId };
  input.dependencyChecks.push({
    checkId: "no-active-maintenance-conflict",
    componentId: CONFIG_COMPONENT,
    owner: "config-writer",
    subject,
    status: "blocked",
    code: "active-owner-conflict",
    evidence: [{ kind: "authority", ref: CONFIG_REF, digest: digestLabel("authority") }],
  });
  input.blockers.push({
    blockerId: "active-owner-conflict",
    componentId: CONFIG_COMPONENT,
    owner: "config-writer",
    subject,
    code: "active-owner-conflict",
    dependencyCheckId: "no-active-maintenance-conflict",
  });
  const plan = createWakeflowMaintenancePlan(input);
  assert.equal(plan.payload.status, "blocked");
  assert.equal(isWakeflowMaintenancePlanApplicable(plan), false);
  assert.equal(plan.payload.filesystemActions.length, 2);

  const orphanBlocker = baseInput("reconcile");
  orphanBlocker.blockers = input.blockers;
  expectPlanError(() => createWakeflowMaintenancePlan(orphanBlocker));
});

test("a blocked dependency requires one exact same-code blocker", () => {
  const subject = { kind: "program", value: programId };
  const input = baseInput("reconcile");
  input.dependencyChecks.push({
    checkId: "config-authority-check",
    componentId: CONFIG_COMPONENT,
    owner: "config-writer",
    subject,
    status: "blocked",
    code: "config-authority-unproven",
    evidence: [],
  });
  input.blockers.push({
    blockerId: "config-authority-blocker",
    componentId: CONFIG_COMPONENT,
    owner: "config-writer",
    subject,
    code: "different-public-reason",
    dependencyCheckId: "config-authority-check",
  });

  expectPlanError(() => createWakeflowMaintenancePlan(input), "wakeflow-maintenance-plan-blocker");
});

test("one blocked dependency cannot be claimed by multiple blockers", () => {
  const subject = { kind: "program", value: programId };
  const input = baseInput("reconcile");
  input.dependencyChecks.push({
    checkId: "config-authority-check",
    componentId: CONFIG_COMPONENT,
    owner: "config-writer",
    subject,
    status: "blocked",
    code: "config-authority-unproven",
    evidence: [],
  });
  for (const blockerId of ["config-authority-blocker-a", "config-authority-blocker-b"]) {
    input.blockers.push({
      blockerId,
      componentId: CONFIG_COMPONENT,
      owner: "config-writer",
      subject,
      code: "config-authority-unproven",
      dependencyCheckId: "config-authority-check",
    });
  }

  expectPlanError(() => createWakeflowMaintenancePlan(input), "wakeflow-maintenance-plan-blocker");
});

test("plan has no extension pocket for raw handles, absolute roots, owner content, or inode identity", () => {
  const plan = createWakeflowMaintenancePlan(baseInput());
  const serialized = JSON.stringify(plan);
  for (const forbidden of [
    "/Users/private/workspace",
    "rawHandle",
    "sourceIdentity",
    "preservedBytes",
    "desiredContent",
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }

  for (const [field, value] of [
    ["workspaceRoot", "/Users/private/workspace"],
    ["rawHandle", "thread-secret"],
    ["preservedBytes", "owner-content"],
  ]) {
    const invalid = baseInput();
    invalid[field] = value;
    expectPlanError(() => createWakeflowMaintenancePlan(invalid));
  }

  const ownerPayload = baseInput();
  ownerPayload.components[0].ownerPayload = { desiredContent: "secret", sourceIdentity: { dev: "1" } };
  expectPlanError(() => createWakeflowMaintenancePlan(ownerPayload));
});

function syntheticManagerPlan(steps) {
  return { schemaId: "urn:wakeflow:internal:test-public-target-modes:v1", payload: { steps } };
}

function absent(ref) {
  return { ref, type: "absent" };
}

function memoryHandler(step) {
  let committed = false;
  let staged = false;
  return {
    prepare: async () => {
      if (step.staging !== null) staged = true;
    },
    observe: async () => ({
      source: committed ? step.final : step.source,
      staging: step.staging === null ? null : staged && !committed ? step.staging : absent(step.staging.ref),
      final: committed ? step.final : step.source,
    }),
    commit: async () => {
      committed = true;
      staged = false;
    },
  };
}

test("M3 transaction metadata accepts tracked 0644/0755 targets but not unsafe modes or public chmod repair", async (t) => {
  const schema = JSON.parse(readFileSync(
    path.join(repositoryRoot, "core/schemas/wakeflow-maintenance/maintenance-transaction.schema.json"),
    "utf8",
  ));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addSchema(schema);
  const validateTarget = ajv.compile({ $ref: `${schema.$id}#/$defs/targetPresentResource` });
  assert.equal(validateTarget({ ref: "tracked/file.md", type: "file", mode: "0644", digest: digestLabel("file") }), true);
  assert.equal(validateTarget({ ref: "tracked/directory", type: "directory", mode: "0755", digest: digestLabel("directory") }), true);
  assert.equal(validateTarget({ ref: "tracked/file.md", type: "file", mode: "0666", digest: digestLabel("unsafe") }), false);

  const fileStep = {
    stepId: "tracked-file",
    ordinal: 0,
    stepKind: "create-or-update",
    source: absent("tracked/file.md"),
    staging: { ref: "tracked/.file.stage", type: "file", mode: "0644", digest: digestLabel("file") },
    final: { ref: "tracked/file.md", type: "file", mode: "0644", digest: digestLabel("file") },
  };
  const directoryStep = {
    stepId: "tracked-directory",
    ordinal: 1,
    stepKind: "create-or-update",
    source: absent("tracked/directory"),
    staging: null,
    final: { ref: "tracked/directory", type: "directory", mode: "0755", digest: digestLabel("directory") },
  };
  const plan = syntheticManagerPlan([fileStep, directoryStep]);
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-maintenance-public-modes-"));
  t.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  const handlers = {
    [fileStep.stepId]: memoryHandler(fileStep),
    [directoryStep.stepId]: memoryHandler(directoryStep),
  };
  const result = await runWakeflowMaintenanceMutation({
    workspaceRoot,
    action: "fresh-initialize",
    operationKind: "workspace-maintenance-plan-test",
    domainOwner: "maintenance-plan-test",
    confirmedPlan: plan,
    planDigest: canonicalJsonDigest(plan),
    validatePlan: async () => ({ valid: true }),
    deriveCurrentPlan: async () => plan,
    deriveTerminalClosure: async () => ({
      planDigest: canonicalJsonDigest(plan),
      closureDigests: [{ name: "synthetic-public-modes", digest: digestLabel("closed") }],
    }),
    stepHandlers: handlers,
  });
  assert.equal(result.status, "completed");

  const invalidRepair = syntheticManagerPlan([{
    stepId: "public-mode-repair",
    ordinal: 0,
    stepKind: "create-or-update",
    source: { ref: "tracked/directory", type: "directory", mode: "0700", digest: digestLabel("same-node") },
    staging: null,
    final: { ref: "tracked/directory", type: "directory", mode: "0755", digest: digestLabel("same-node") },
  }]);
  const invalidRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-maintenance-public-repair-"));
  t.after(() => rmSync(invalidRoot, { recursive: true, force: true }));
  await assert.rejects(
    () => runWakeflowMaintenanceMutation({
      workspaceRoot: invalidRoot,
      action: "reconcile",
      operationKind: "workspace-maintenance-plan-test",
      domainOwner: "maintenance-plan-test",
      confirmedPlan: invalidRepair,
      planDigest: canonicalJsonDigest(invalidRepair),
      validatePlan: async () => ({ valid: true }),
      deriveCurrentPlan: async () => invalidRepair,
      deriveTerminalClosure: async () => ({
        planDigest: canonicalJsonDigest(invalidRepair),
        closureDigests: [{ name: "invalid", digest: digestLabel("invalid") }],
      }),
      stepHandlers: { "public-mode-repair": memoryHandler(invalidRepair.payload.steps[0]) },
    }),
    /(?:directory|repair|plan|mode)/iu,
  );

  const privateRepair = baseInput("reconcile");
  const privateDigest = digestLabel("private-static-directory");
  privateRepair.filesystemActions.push({
    actionId: "private-mode-repair",
    componentId: LAYOUT_COMPONENT,
    owner: "layout-manager",
    root: actionRoot("program", programId, "."),
    ref: ".wakeflow-local/static",
    resourceRef: `targets/program/${programId}/.wakeflow-local/static`,
    classification: "managed-stale-known",
    source: { type: "directory", mode: "0755", digest: privateDigest },
    target: { type: "directory", mode: "0700", digest: privateDigest },
    action: "update-managed",
    authorization: { kind: "wakeflow-owned" },
    reasonCode: "private-mode-repair",
    stepId: "private-mode-repair",
    commitOrder: 0,
  });
  privateRepair.steps.push({
    stepId: "private-mode-repair",
    ordinal: 0,
    stepKind: "create-or-update",
    source: {
      ref: `targets/program/${programId}/.wakeflow-local/static`,
      type: "directory",
      mode: "0755",
      digest: privateDigest,
    },
    staging: null,
    final: {
      ref: `targets/program/${programId}/.wakeflow-local/static`,
      type: "directory",
      mode: "0700",
      digest: privateDigest,
    },
  });
  assert.equal(createWakeflowMaintenancePlan(privateRepair).payload.status, "ready");

  privateRepair.filesystemActions.at(-1).source.mode = "0777";
  privateRepair.steps[0].source.mode = "0777";
  expectPlanError(() => createWakeflowMaintenancePlan(privateRepair));
});
