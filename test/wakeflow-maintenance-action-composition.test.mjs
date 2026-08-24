import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createWakeflowActiveFoundationMutationParticipant,
} from "../core/scripts/lib/wakeflow-active-foundation.mjs";
import {
  createWakeflowActiveProjectionMutationParticipant,
} from "../core/scripts/lib/wakeflow-active-projector.mjs";
import {
  canonicalJsonDigest,
} from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import {
  createWakeflowConfigV3OwnerMutationParticipant,
  createWakeflowConfigV3ReconfigureMutationParticipant,
} from "../core/scripts/lib/wakeflow-config-v3-owner.mjs";
import {
  parseWakeflowConfigV3,
} from "../core/scripts/lib/wakeflow-config-v3.mjs";
import {
  planWakeflowFreshInitializeBackbone,
} from "../core/scripts/lib/wakeflow-fresh-initialize.mjs";
import { planWakeflowReconcileBackbone } from "../core/scripts/lib/wakeflow-reconcile.mjs";
import { planWakeflowReconfigureBackbone } from "../core/scripts/lib/wakeflow-reconfigure.mjs";
import { hostProfile } from "../core/scripts/lib/wakeflow-host-profile.mjs";
import { createWakeflowLayoutDescriptor } from "../core/scripts/lib/wakeflow-layout-descriptor.mjs";
import {
  createWakeflowLedgerMaterializationMutationParticipant,
} from "../core/scripts/lib/wakeflow-ledger-materialization.mjs";
import {
  createWakeflowLocalLayoutMutationParticipant,
} from "../core/scripts/lib/wakeflow-local-layout-realization.mjs";
import {
  WAKEFLOW_CONFIRMED_ACTION_PLAN_KIND,
  assertWakeflowMaintenanceLocalTransitionScope,
  createWakeflowMaintenanceActionMutationParticipant,
  validateWakeflowConfirmedActionPlan,
} from "../core/scripts/lib/wakeflow-maintenance-action-composition.mjs";
import {
  createWakeflowManagedContentMutationParticipant,
} from "../core/scripts/lib/wakeflow-managed-content.mjs";
import {
  inspectWakeflowObservabilityV3,
  projectWakeflowConfigView,
  projectWakeflowStatus,
  projectWakeflowStorageView,
  verifyWakeflowWorkspaceV3,
} from "../core/scripts/lib/wakeflow-observability-v3.mjs";
import {
  createWakeflowSupportSurfaceMutationParticipant,
} from "../core/scripts/lib/wakeflow-support-surface-owner.mjs";
import { parseWakeflowAssetBundle } from "../core/scripts/lib/wakeflow-template-renderer.mjs";
import { TODO_BOARD_REF } from "../core/scripts/lib/wakeflow-todo-service.mjs";
import {
  createWindowBindingRecord,
  windowBindingCanonicalBytes,
} from "../core/scripts/lib/wakeflow-window-binding-records.mjs";
import {
  createWindowRuntimeProjectionMutationParticipant,
} from "../core/scripts/lib/wakeflow-window-runtime-projector.mjs";
import { runWakeflowMaintenanceMutation } from "../core/scripts/lib/wakeflow-workspace-mutation.mjs";
import { buildWakeflowAssetBundle } from "../tools/build-asset-bundle.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundle = parseWakeflowAssetBundle(buildWakeflowAssetBundle({
  sourceRoot: path.join(repositoryRoot, "core/template-sources"),
}));
const fixture = JSON.parse(readFileSync(
  path.join(repositoryRoot, "test/fixtures/wakeflow-config-v3/valid-minimal.json"),
  "utf8",
));

function workspace(t) {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-action-composition-"));
  const workspaceRoot = path.join(fixtureRoot, "Program");
  mkdirSync(workspaceRoot, { mode: 0o700 });
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  return workspaceRoot;
}

function freshInput(workspaceRoot, desiredModel) {
  return {
    workspaceRoot,
    desiredModel,
    hostProfile,
    bundle,
    language: "zh",
    hostSettingsAssetsAdapter: null,
  };
}

function snapshotByComponent(actionPlan) {
  return new Map(actionPlan.payload.ownerSnapshots.map((entry) => [entry.componentId, entry]));
}

function ownerParticipants({
  workspaceRoot,
  desiredModel,
  actionPlan,
  action = "fresh-initialize",
  sourceModel = action === "fresh-initialize" ? null : desiredModel,
}) {
  const snapshots = snapshotByComponent(actionPlan);
  const descriptor = createWakeflowLayoutDescriptor({ model: desiredModel, hostProfile });
  const supportPlan = snapshots.get("support-surface").snapshot;
  const configParticipant = action === "fresh-initialize"
    ? createWakeflowConfigV3OwnerMutationParticipant({
        workspaceRoot,
        model: desiredModel,
        confirmedPlan: snapshots.get("config").snapshot,
      })
    : createWakeflowConfigV3ReconfigureMutationParticipant({
        workspaceRoot,
        desiredModel,
        confirmedPlan: snapshots.get("config").snapshot,
      });
  const definitions = [
    ["config", configParticipant],
    ["support-surface", createWakeflowSupportSurfaceMutationParticipant({
      workspaceRoot,
      action,
      sourceModel,
      desiredModel,
      layoutDescriptor: descriptor,
      hostProfile,
      confirmedPlan: supportPlan,
    })],
    ["ledger-layout", createWakeflowLedgerMaterializationMutationParticipant({
      workspaceRoot,
      action,
      sourceModel,
      desiredModel,
      confirmedPlan: snapshots.get("ledger-layout").snapshot,
    })],
    ["ignore", createWakeflowManagedContentMutationParticipant({
      workspaceRoot,
      action,
      sourceModel,
      desiredModel,
      hostProfile,
      authorizedRepositoryIds: [],
      plannedSupportSurfaceIds: supportPlan.payload.plannedSupportSurfaceIds,
      confirmedPlan: snapshots.get("ignore").snapshot,
    })],
    ["active-layout", createWakeflowActiveFoundationMutationParticipant({
      workspaceRoot,
      action,
      sourceModel,
      desiredModel,
      confirmedPlan: snapshots.get("active-layout").snapshot,
    })],
    ["active-projection", createWakeflowActiveProjectionMutationParticipant({
      workspaceRoot,
      action,
      sourceModel,
      desiredModel,
      bundle,
      language: "zh",
      confirmedPlan: snapshots.get("active-projection").snapshot,
    })],
    ["window-runtime-projection", createWindowRuntimeProjectionMutationParticipant({
      workspaceRoot,
      action,
      sourceModel,
      desiredModel,
      hostProfile,
      confirmedPlan: snapshots.get("window-runtime-projection").snapshot,
    })],
  ];
  if (snapshots.has("local-layout")) {
    definitions.push(["local-layout", createWakeflowLocalLayoutMutationParticipant({
      workspaceRoot,
      confirmedPlan: snapshots.get("local-layout").snapshot,
      model: desiredModel,
      layoutDescriptor: descriptor,
      hostProfile,
    })]);
  }
  return definitions.map(([componentId, participant]) => ({
    snapshotDigest: snapshots.get(componentId).snapshotDigest,
    participant,
  }));
}

function freshCompositionFixture(t) {
  const workspaceRoot = workspace(t);
  const desiredModel = parseWakeflowConfigV3(structuredClone(fixture));
  const planningInput = freshInput(workspaceRoot, desiredModel);
  const actionPlan = planWakeflowFreshInitializeBackbone(planningInput).confirmedActionPlan;
  return {
    workspaceRoot,
    actionPlan,
    participants: ownerParticipants({ workspaceRoot, desiredModel, actionPlan }),
    replan: () => planWakeflowFreshInitializeBackbone(planningInput).confirmedActionPlan,
  };
}

function replaceParticipant(participants, target, participant) {
  return participants.map((entry) => (
    entry === target ? { ...entry, participant } : entry
  ));
}

test("composition rejects an owner codec verdict accessor without invoking it", (t) => {
  const {
    workspaceRoot,
    actionPlan,
    participants,
    replan,
  } = freshCompositionFixture(t);
  const target = participants[0];
  let accessorCalls = 0;
  const participant = {
    ...target.participant,
    validatePlan() {
      const verdict = {};
      Object.defineProperty(verdict, "valid", {
        enumerable: true,
        get() {
          accessorCalls += 1;
          return true;
        },
      });
      return verdict;
    },
  };

  assert.throws(
    () => createWakeflowMaintenanceActionMutationParticipant({
      workspaceRoot,
      admission: "apply",
      confirmedActionPlan: actionPlan,
      ownerParticipants: replaceParticipant(participants, target, participant),
      replan,
    }),
    /(?:codec|verdict|data property|canonical)/iu,
  );
  assert.equal(accessorCalls, 0);
});

test("composition rejects an owner participant method accessor without invoking it", (t) => {
  const {
    workspaceRoot,
    actionPlan,
    participants,
    replan,
  } = freshCompositionFixture(t);
  const target = participants[0];
  const participant = { ...target.participant };
  const deriveCurrentPlan = participant.deriveCurrentPlan;
  delete participant.deriveCurrentPlan;
  let accessorCalls = 0;
  Object.defineProperty(participant, "deriveCurrentPlan", {
    enumerable: true,
    get() {
      accessorCalls += 1;
      return deriveCurrentPlan;
    },
  });

  assert.throws(
    () => createWakeflowMaintenanceActionMutationParticipant({
      workspaceRoot,
      admission: "apply",
      confirmedActionPlan: actionPlan,
      ownerParticipants: replaceParticipant(participants, target, participant),
      replan,
    }),
    /(?:participant|deriveCurrentPlan|data property)/iu,
  );
  assert.equal(accessorCalls, 0);
});

test("composition rejects a step-handler callback accessor without invoking it", (t) => {
  const {
    workspaceRoot,
    actionPlan,
    participants,
    replan,
  } = freshCompositionFixture(t);
  const target = participants.find((entry) => Object.keys(entry.participant.stepHandlers).length > 0);
  assert.ok(target);
  const stepId = Object.keys(target.participant.stepHandlers)[0];
  const handler = { ...target.participant.stepHandlers[stepId] };
  const observe = handler.observe;
  delete handler.observe;
  let accessorCalls = 0;
  Object.defineProperty(handler, "observe", {
    enumerable: true,
    get() {
      accessorCalls += 1;
      return observe;
    },
  });
  const participant = {
    ...target.participant,
    stepHandlers: {
      ...target.participant.stepHandlers,
      [stepId]: handler,
    },
  };

  assert.throws(
    () => createWakeflowMaintenanceActionMutationParticipant({
      workspaceRoot,
      admission: "apply",
      confirmedActionPlan: actionPlan,
      ownerParticipants: replaceParticipant(participants, target, participant),
      replan,
    }),
    /(?:handler|observe|data property)/iu,
  );
  assert.equal(accessorCalls, 0);
});

test("composition rejects symbol-keyed step-handler authority", (t) => {
  const {
    workspaceRoot,
    actionPlan,
    participants,
    replan,
  } = freshCompositionFixture(t);
  const target = participants.find((entry) => Object.keys(entry.participant.stepHandlers).length > 0);
  assert.ok(target);
  const stepHandlers = { ...target.participant.stepHandlers };
  stepHandlers[Symbol("hidden-handler-authority")] = Object.freeze({
    prepare() {},
    observe() {},
    commit() {},
  });
  const participant = { ...target.participant, stepHandlers };

  assert.throws(
    () => createWakeflowMaintenanceActionMutationParticipant({
      workspaceRoot,
      admission: "apply",
      confirmedActionPlan: actionPlan,
      ownerParticipants: replaceParticipant(participants, target, participant),
      replan,
    }),
    /(?:handler|field|symbol|coverage)/iu,
  );
});

test("composition rejects an owner observation resource accessor without invoking it", async (t) => {
  const {
    workspaceRoot,
    actionPlan,
    participants,
    replan,
  } = freshCompositionFixture(t);
  const target = participants.find((entry) => Object.keys(entry.participant.stepHandlers).length > 0);
  assert.ok(target);
  const ownerSnapshot = actionPlan.payload.ownerSnapshots.find((entry) => (
    entry.snapshotDigest === target.snapshotDigest
  ));
  const ownerStep = ownerSnapshot.snapshot.payload.steps[0];
  const stepId = ownerStep.stepId;
  let accessorCalls = 0;
  const accessorNode = (contract) => {
    if (contract === null) return null;
    const node = { ...contract };
    delete node.ref;
    Object.defineProperty(node, "ref", {
      enumerable: true,
      get() {
        accessorCalls += 1;
        return contract.ref;
      },
    });
    return node;
  };
  const participant = {
    ...target.participant,
    stepHandlers: {
      ...target.participant.stepHandlers,
      [stepId]: {
        ...target.participant.stepHandlers[stepId],
        observe: async () => ({
          source: accessorNode(ownerStep.source),
          staging: accessorNode(ownerStep.staging),
          final: accessorNode(ownerStep.final),
        }),
      },
    },
  };
  const aggregateParticipant = createWakeflowMaintenanceActionMutationParticipant({
    workspaceRoot,
    admission: "apply",
    confirmedActionPlan: actionPlan,
    ownerParticipants: replaceParticipant(participants, target, participant),
    replan,
  });

  await assert.rejects(
    () => aggregateParticipant.stepHandlers[stepId].observe({}),
    /(?:observation|canonical|accessor|data property)/iu,
  );
  assert.equal(accessorCalls, 0);
});

test("T08 confirmed action snapshots close every aggregate component and reject tampering", (t) => {
  const workspaceRoot = workspace(t);
  const desiredModel = parseWakeflowConfigV3(structuredClone(fixture));
  const backbone = planWakeflowFreshInitializeBackbone(freshInput(workspaceRoot, desiredModel));
  const actionPlan = backbone.confirmedActionPlan;

  assert.equal(actionPlan.payload.kind, WAKEFLOW_CONFIRMED_ACTION_PLAN_KIND);
  assert.deepEqual(validateWakeflowConfirmedActionPlan(actionPlan), actionPlan);
  assert.equal(Object.isFrozen(actionPlan), true);
  assert.equal(actionPlan.payload.aggregatePlanDigest, backbone.aggregatePlanDigest);
  assert.deepEqual(
    actionPlan.payload.ownerSnapshots.map((entry) => entry.componentId),
    backbone.aggregatePlan.payload.components.map((entry) => entry.componentId),
  );
  assert.equal(
    actionPlan.payload.ownerSnapshots.some((entry) => entry.componentId === "host-settings-assets"),
    false,
  );
  assert.throws(
    () => planWakeflowFreshInitializeBackbone({
      ...freshInput(workspaceRoot, desiredModel),
      hostSettingsAssetsAdapter: {},
    }),
    { code: "wakeflow-host-settings-owner-adapter" },
  );
  assert.equal(JSON.stringify(actionPlan).includes(workspaceRoot), false);

  const forged = structuredClone(actionPlan);
  forged.payload.ownerSnapshots[0].snapshot.payload.privateOperations = [];
  forged.payload.ownerSnapshots[0].snapshotDigest = canonicalJsonDigest(
    forged.payload.ownerSnapshots[0].snapshot,
  );
  assert.throws(
    () => validateWakeflowConfirmedActionPlan(forged),
    /snapshot|component|digest|action/iu,
  );
  assert.throws(
    () => assertWakeflowMaintenanceLocalTransitionScope({
      kind: "WakeflowMaintenanceLocalTransitionScope",
      schemaVersion: 1,
      aggregatePlanDigest: actionPlan.payload.aggregatePlanDigest,
      resources: [],
    }),
    /exact|issued|scope/iu,
  );
});

test("T08 one composed M3 transaction materializes the complete Codex fresh tree", async (t) => {
  const workspaceRoot = workspace(t);
  mkdirSync(path.join(path.dirname(workspaceRoot), "ProductA"), { mode: 0o755 });
  const desiredModel = parseWakeflowConfigV3(structuredClone(fixture));
  const planningInput = freshInput(workspaceRoot, desiredModel);
  const backbone = planWakeflowFreshInitializeBackbone(planningInput);
  const actionPlan = backbone.confirmedActionPlan;
  const participant = createWakeflowMaintenanceActionMutationParticipant({
    workspaceRoot,
    admission: "apply",
    confirmedActionPlan: actionPlan,
    ownerParticipants: ownerParticipants({ workspaceRoot, desiredModel, actionPlan }),
    replan: () => planWakeflowFreshInitializeBackbone(planningInput).confirmedActionPlan,
  });

  const result = await runWakeflowMaintenanceMutation({
    workspaceRoot,
    action: "fresh-initialize",
    operationKind: "fresh-initialize-v3",
    domainOwner: "maintenance-action-coordinator",
    confirmedPlan: actionPlan.payload.aggregatePlan,
    planDigest: actionPlan.payload.aggregatePlanDigest,
    validatePlan: participant.validatePlan,
    deriveCurrentPlan: participant.deriveCurrentPlan,
    deriveTerminalClosure: participant.deriveTerminalClosure,
    stepHandlers: participant.stepHandlers,
  });
  assert.equal(result.status, "completed");
  for (const ref of [
    "wakeflow.config.json",
    TODO_BOARD_REF,
    ".wakeflow-active/index.md",
    ".wakeflow-active/current/workspace-current-status.md",
  ]) assert.equal(existsSync(path.join(workspaceRoot, ...ref.split("/"))), true, ref);
  for (const operation of snapshotByComponent(actionPlan).get("window-runtime-projection").snapshot.payload.operations) {
    assert.equal(existsSync(path.join(workspaceRoot, ...operation.ref.split("/"))), true, operation.ref);
  }
  assert.equal(planWakeflowFreshInitializeBackbone(planningInput).confirmedActionPlan, null);

  const observation = inspectWakeflowObservabilityV3({
    workspaceRoot,
    hostProfile,
    bundle,
    language: "zh",
    hostSettingsAssetsAdapter: null,
  });
  const configView = projectWakeflowConfigView({ observation });
  const storageView = projectWakeflowStorageView({ observation });
  const status = projectWakeflowStatus({ observation });
  const verification = verifyWakeflowWorkspaceV3({ observation });
  assert.equal(configView.status, "valid");
  assert.equal(storageView.overall, "healthy", JSON.stringify({
    summary: storageView.summary,
    diagnostics: storageView.diagnostics,
    unhealthy: storageView.items.filter((entry) => !new Set([
      "current",
      "empty-ready",
      "not-created-yet",
      "not-applicable",
    ]).has(entry.health)).map((entry) => ({ key: entry.key, health: entry.health })),
  }));
  assert.equal(status.overall, "idle");
  assert.equal(verification.ok, true);
  assert.equal(JSON.stringify({ observation, configView, storageView, status, verification }).includes(workspaceRoot), false);

  for (const [action, replan] of [
    ["reconcile", () => planWakeflowReconcileBackbone({
      workspaceRoot,
      hostProfile,
      bundle,
      language: "zh",
    })],
    ["reconfigure", () => planWakeflowReconfigureBackbone({
      workspaceRoot,
      desiredModel,
      hostProfile,
      bundle,
      language: "zh",
    })],
  ]) {
    const backbonePlan = replan();
    assert.equal(backbonePlan.status, "ready", action);
    assert.deepEqual(
      validateWakeflowConfirmedActionPlan(backbonePlan.confirmedActionPlan),
      backbonePlan.confirmedActionPlan,
    );
    const noOpParticipant = createWakeflowMaintenanceActionMutationParticipant({
      workspaceRoot,
      admission: "apply",
      confirmedActionPlan: backbonePlan.confirmedActionPlan,
      ownerParticipants: ownerParticipants({
        workspaceRoot,
        desiredModel,
        actionPlan: backbonePlan.confirmedActionPlan,
        action,
        sourceModel: desiredModel,
      }),
      replan: () => replan().confirmedActionPlan,
    });
    const noOp = await runWakeflowMaintenanceMutation({
      workspaceRoot,
      action,
      operationKind: `${action}-v3`,
      domainOwner: "maintenance-action-coordinator",
      confirmedPlan: backbonePlan.confirmedActionPlan.payload.aggregatePlan,
      planDigest: backbonePlan.confirmedActionPlan.payload.aggregatePlanDigest,
      validatePlan: noOpParticipant.validatePlan,
      deriveCurrentPlan: noOpParticipant.deriveCurrentPlan,
      deriveTerminalClosure: noOpParticipant.deriveTerminalClosure,
      stepHandlers: noOpParticipant.stepHandlers,
    });
    assert.equal(noOp.status, "no-op", action);
  }

  const controllerWindow = desiredModel.topology.windows.find((entry) => entry.role === "controller");
  const rawHandle = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const binding = createWindowBindingRecord({
    programId: desiredModel.program.programId,
    hostId: "codex",
    windowId: controllerWindow.windowId,
    bindingId: "binding_99999999-9999-4999-8999-999999999999",
    handle: { kind: hostProfile.handleId.kind, value: rawHandle },
    registeredAt: "2026-08-09T00:00:00.000Z",
  });
  const bindingFile = path.join(
    workspaceRoot,
    ".wakeflow-local/runtime/hosts/codex/identity/window-bindings",
    `${controllerWindow.windowId}.json`,
  );
  writeFileSync(bindingFile, windowBindingCanonicalBytes(binding), { mode: 0o600 });
  chmodSync(bindingFile, 0o600);
  const identityObservation = inspectWakeflowObservabilityV3({
    workspaceRoot,
    hostProfile,
    bundle,
    language: "zh",
    hostSettingsAssetsAdapter: null,
  });
  const identityStatus = projectWakeflowStatus({ observation: identityObservation });
  const controllerIdentity = identityStatus.domains.windowIdentity.windows.find((entry) => (
    entry.windowId === controllerWindow.windowId
  ));
  assert.equal(controllerIdentity.identityStatus, "registered");
  assert.equal(controllerIdentity.bindingId, binding.bindingId);
  assert.equal(JSON.stringify(identityStatus).includes(rawHandle), false);

  const secretUnknown = "customer-token-never-return-me.txt";
  writeFileSync(
    path.join(workspaceRoot, ".wakeflow-local/runtime/shared", secretUnknown),
    "private\n",
    { mode: 0o600 },
  );
  const blockedObservation = inspectWakeflowObservabilityV3({
    workspaceRoot,
    hostProfile,
    bundle,
    language: "zh",
    hostSettingsAssetsAdapter: null,
  });
  const blockedProjection = {
    storage: projectWakeflowStorageView({ observation: blockedObservation }),
    status: projectWakeflowStatus({ observation: blockedObservation }),
    verification: verifyWakeflowWorkspaceV3({ observation: blockedObservation }),
  };
  assert.equal(blockedProjection.storage.overall, "blocked");
  assert.equal(blockedProjection.status.overall, "blocked");
  assert.equal(blockedProjection.verification.ok, false);
  assert.equal(JSON.stringify(blockedProjection).includes(secretUnknown), false);
  assert.equal(
    blockedProjection.storage.diagnostics.some((entry) => (
      entry.code === "unknown" && /^sha256:[0-9a-f]{64}$/u.test(entry.refDigest)
    )),
    true,
  );
});
