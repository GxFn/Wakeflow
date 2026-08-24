import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  canonicalJson,
  canonicalJsonDigest,
} from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import {
  applyDemandLifecycleTransitionPlan,
  planDemandLifecycleTransition,
  recoverDemandLifecycleTransition,
} from "../core/scripts/lib/wakeflow-demand-lifecycle-orchestration.mjs";
import {
  commitDemandStateTransition,
} from "../core/scripts/lib/wakeflow-demand-state-service.mjs";
import {
  inspectWindowBindingInventory,
} from "../core/scripts/lib/wakeflow-window-binding-service.mjs";
import {
  acquireWindowCoordinationLease,
} from "../core/scripts/lib/wakeflow-window-lease-service.mjs";
import {
  inspectWakeflowWorkspaceMutation,
} from "../core/scripts/lib/wakeflow-workspace-mutation.mjs";
import {
  createIntegrationFixture,
  INTEGRATION_IDS,
  integrationDeterministicId,
  loadIntegrationStack,
  privateTreeSnapshot,
  timestampAfter,
  writePrivateCanonical,
} from "./support/wakeflow-delivery-v3-fixture.mjs";

function transition(stack, suffix = "cancel") {
  return {
    eventId: `event-demand-lifecycle-${suffix}-${stack.state.revision + 1}`,
    createdAt: timestampAfter(stack.state.updatedAt),
    reason: "Stop the disposable demand while preserving every immutable business fact.",
    decisionSummary: "Cancel only current lifecycle authority and release only exact current leases.",
  };
}

function planInput(fixture, stack, action = "cancel", suffix = action) {
  return {
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    action,
    transition: transition(stack, suffix),
  };
}

function applyInput(fixture, plan) {
  return {
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    plan,
    planDigest: plan.planDigest,
  };
}

function withCurrentPlanDigest(value) {
  const unsigned = structuredClone(value);
  delete unsigned.planDigest;
  return {
    ...unsigned,
    planDigest: canonicalJsonDigest(unsigned),
  };
}

function assertDeepFrozen(value, valuePath = "$") {
  if (!value || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true, `${valuePath} must be frozen`);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertDeepFrozen(entry, `${valuePath}/${index}`));
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    assertDeepFrozen(entry, `${valuePath}/${key}`);
  }
}

function stateJournal(stack, plan) {
  return {
    schemaVersion: 1,
    artifactKind: "wakeflow-state-transition",
    demandId: plan.demandId,
    command: plan.event.command,
    createdAt: plan.event.createdAt,
    expectedPreviousRevision: plan.sourceState.revision,
    expectedPreviousStateDigest: plan.sourceState.digest,
    previousState: stack.state,
    nextEvent: plan.event,
    nextEventDigest: canonicalJsonDigest(plan.event),
    nextState: plan.nextState,
    nextStateDigest: canonicalJsonDigest(plan.nextState),
    artifactWrites: [],
  };
}

test("lifecycle cancel preview is portable, deterministic, deep-frozen, and zero-write", async (t) => {
  const fixture = await createIntegrationFixture(t);
  const stack = loadIntegrationStack(fixture);
  const before = privateTreeSnapshot(fixture.workspaceRoot);
  const input = planInput(fixture, stack);
  const plan = planDemandLifecycleTransition(input);
  const replayedPreview = planDemandLifecycleTransition(input);

  assert.deepEqual(plan, replayedPreview);
  assert.deepEqual(privateTreeSnapshot(fixture.workspaceRoot), before);
  assert.equal(plan.kind, "WakeflowDemandLifecyclePlan");
  assert.equal(plan.action, "cancel");
  assert.equal(plan.event.command, "cancel-demand");
  assert.deepEqual(plan.event.lifecycleTransition, { action: "cancel" });
  assert.equal(plan.nextState.state, "cancelled");
  assert.equal(plan.nextState.targetTasks[0].lifecycleStatus, "cancelled");
  assert.equal(plan.nextState.taskPackages[0].lifecycleStatus, "closed");
  assert.deepEqual(plan.leaseReleases, []);
  assert.equal(plan.planDigest, canonicalJsonDigest((() => {
    const unsigned = structuredClone(plan);
    delete unsigned.planDigest;
    return unsigned;
  })()));
  assert.equal(canonicalJson(plan).includes(fixture.workspaceRoot), false);
  assert.equal(canonicalJson(plan).includes(fixture.stateRoot), false);
  assertDeepFrozen(plan);
});

test("lifecycle apply commits one exact terminal event and exact replay is zero-write", async (t) => {
  const fixture = await createIntegrationFixture(t);
  const stack = loadIntegrationStack(fixture);
  const plan = planDemandLifecycleTransition(planInput(fixture, stack));
  const applied = await applyDemandLifecycleTransitionPlan(applyInput(fixture, plan));

  assert.equal(applied.status, "applied");
  assert.equal(applied.action, "cancel");
  assert.equal(applied.releasedLeaseCount, 0);
  const after = loadIntegrationStack(fixture);
  assert.deepEqual(after.events.at(-1), plan.event);
  assert.deepEqual(after.state, plan.nextState);
  assert.deepEqual(readdirSync(path.join(fixture.stateRoot, "transactions")), []);
  const beforeReplay = privateTreeSnapshot(fixture.workspaceRoot);
  const replay = await applyDemandLifecycleTransitionPlan(applyInput(fixture, plan));
  assert.equal(replay.status, "replayed");
  assert.deepEqual(privateTreeSnapshot(fixture.workspaceRoot), beforeReplay);
});

test("cancellation releases only the exact state-bound coordination lease after terminal commit", async (t) => {
  const fixture = await createIntegrationFixture(t);
  const delivery = await import("../core/scripts/lib/wakeflow-delivery-orchestration.mjs");
  let stack = loadIntegrationStack(fixture);
  const deliveryPlan = delivery.planTargetDelivery({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targets: [{
      targetTaskId: INTEGRATION_IDS.targetTask,
      prompt: "Prepare one disposable delivery so cancellation has an exact lease to release.",
      contextPolicy: "assumed-current",
      automationRequested: false,
    }],
    returnPolicy: { mode: "group-ready" },
    createdAt: timestampAfter(stack.state.updatedAt, new Date().toISOString()),
  });
  await delivery.applyTargetDeliveryPlan({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    plan: deliveryPlan,
    planDigest: deliveryPlan.planDigest,
  });
  stack = loadIntegrationStack(fixture);
  const currentDelivery = stack.state.targetTasks[0].currentDelivery;
  const leaseFile = path.resolve(fixture.workspaceRoot, ...currentDelivery.lease.ref.split("/"));
  assert.equal(existsSync(leaseFile), true);

  const plan = planDemandLifecycleTransition(planInput(fixture, stack, "cancel", "leased"));
  assert.deepEqual(plan.leaseReleases, [{
    windowId: stack.state.targetTasks[0].windowId,
    leaseId: currentDelivery.lease.leaseId,
    deliveryId: currentDelivery.envelope.deliveryId,
    bindingId: JSON.parse(readFileSync(leaseFile, "utf8")).bindingId,
    leaseDigest: currentDelivery.lease.digest,
  }]);
  const result = await applyDemandLifecycleTransitionPlan(applyInput(fixture, plan));
  assert.equal(result.releasedLeaseCount, 1);
  assert.equal(existsSync(leaseFile), false);
  const closed = loadIntegrationStack(fixture);
  assert.equal(closed.state.state, "cancelled");
  assert.deepEqual(closed.state.targetTasks[0].currentDelivery, currentDelivery);
});

test("completion rejects open work and apply rejects state drift without lifecycle writes", async (t) => {
  const fixture = await createIntegrationFixture(t);
  let stack = loadIntegrationStack(fixture);
  assert.throws(
    () => planDemandLifecycleTransition(planInput(fixture, stack, "complete")),
    (error) => error?.code === "wakeflow-demand-lifecycle-complete",
  );
  const cancelPlan = planDemandLifecycleTransition(planInput(fixture, stack, "cancel", "stale"));
  const event = {
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: `event-demand-lifecycle-drift-${stack.state.revision + 1}`,
    demandId: INTEGRATION_IDS.demand,
    createdAt: timestampAfter(stack.state.updatedAt),
    actor: "controller",
    command: "pause-demand",
    type: "state.paused",
    previousRevision: stack.state.revision,
    nextRevision: stack.state.revision + 1,
    from: stack.state.state,
    to: "blocked",
    reason: "Introduce one exact competing state transition.",
    decisionSummary: "The confirmed lifecycle plan must become stale.",
    changedArtifacts: [],
  };
  const nextState = structuredClone(stack.state);
  nextState.revision = event.nextRevision;
  nextState.state = event.to;
  nextState.stateReason = event.reason;
  nextState.updatedAt = event.createdAt;
  nextState.lastEvent = { eventId: event.eventId, eventDigest: canonicalJsonDigest(event) };
  commitDemandStateTransition({
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    expectedPrevious: { revision: stack.state.revision, stateDigest: stack.digests.state },
    event,
    nextState,
  });
  stack = loadIntegrationStack(fixture);
  const before = privateTreeSnapshot(fixture.workspaceRoot);
  await assert.rejects(
    applyDemandLifecycleTransitionPlan(applyInput(fixture, cancelPlan)),
    (error) => /stale-plan/u.test(error?.code ?? "") || /apply/u.test(error?.code ?? ""),
  );
  assert.equal(loadIntegrationStack(fixture).state.revision, stack.state.revision);
  assert.deepEqual(privateTreeSnapshot(fixture.workspaceRoot), before);
});

test("lifecycle recovery forward-completes the exact journal and refuses substituted intent", async (t) => {
  const fixture = await createIntegrationFixture(t);
  const stack = loadIntegrationStack(fixture);
  const plan = planDemandLifecycleTransition(planInput(fixture, stack, "cancel", "recover"));
  const journalPath = path.join(fixture.stateRoot, "transactions", "state-transition.json");
  writePrivateCanonical(journalPath, stateJournal(stack, plan));
  const recovered = await recoverDemandLifecycleTransition(applyInput(fixture, plan));
  assert.equal(recovered.status, "recovered");
  assert.deepEqual(loadIntegrationStack(fixture).state, plan.nextState);
  assert.equal(existsSync(journalPath), false);

  const conflictingFixture = await createIntegrationFixture(t);
  const conflictingStack = loadIntegrationStack(conflictingFixture);
  const confirmed = planDemandLifecycleTransition(
    planInput(conflictingFixture, conflictingStack, "cancel", "confirmed"),
  );
  const substituted = structuredClone(confirmed);
  substituted.event.eventId = "event-demand-lifecycle-substituted";
  substituted.event.lifecycleTransition = { action: "cancel" };
  substituted.nextState.lastEvent.eventId = substituted.event.eventId;
  substituted.nextState.lastEvent.eventDigest = canonicalJsonDigest(substituted.event);
  const conflictingJournal = stateJournal(conflictingStack, substituted);
  writePrivateCanonical(
    path.join(conflictingFixture.stateRoot, "transactions", "state-transition.json"),
    conflictingJournal,
  );
  const before = readFileSync(
    path.join(conflictingFixture.stateRoot, "transactions", "state-transition.json"),
  );
  await assert.rejects(
    recoverDemandLifecycleTransition(applyInput(conflictingFixture, confirmed)),
    (error) => /recovery/u.test(error?.code ?? ""),
  );
  assert.deepEqual(
    readFileSync(path.join(conflictingFixture.stateRoot, "transactions", "state-transition.json")),
    before,
  );
});

test("lifecycle apply and recovery reject nested accessors without executing them", async (t) => {
  const fixture = await createIntegrationFixture(t);
  const stack = loadIntegrationStack(fixture);
  const plan = planDemandLifecycleTransition(planInput(fixture, stack));

  for (const operation of [applyDemandLifecycleTransitionPlan, recoverDemandLifecycleTransition]) {
    let accessorReads = 0;
    const hostileReleases = [];
    Object.defineProperty(hostileReleases, "0", {
      enumerable: true,
      get() {
        accessorReads += 1;
        return {
          windowId: INTEGRATION_IDS.productWindow,
          leaseId: "lease_41414141-4141-4141-8141-414141414141",
          deliveryId: "delivery-hostile-accessor",
          bindingId: INTEGRATION_IDS.binding,
          leaseDigest: `sha256:${"4".repeat(64)}`,
        };
      },
    });
    hostileReleases.length = 1;
    const hostilePlan = structuredClone(plan);
    hostilePlan.leaseReleases = hostileReleases;

    await assert.rejects(
      operation(applyInput(fixture, hostilePlan)),
      (error) => /wakeflow-demand-lifecycle-(?:contract|plan)/u.test(error?.code ?? ""),
    );
    assert.equal(accessorReads, 0);
  }
});

test("lifecycle plan codec rejects a self-digested cross-field action alias before mutation", async (t) => {
  const fixture = await createIntegrationFixture(t);
  const stack = loadIntegrationStack(fixture);
  const plan = planDemandLifecycleTransition(planInput(fixture, stack));
  const aliased = withCurrentPlanDigest({
    ...structuredClone(plan),
    action: "complete",
  });
  const before = privateTreeSnapshot(fixture.workspaceRoot);

  await assert.rejects(
    applyDemandLifecycleTransitionPlan(applyInput(fixture, aliased)),
    (error) => error?.code === "wakeflow-demand-lifecycle-plan",
  );
  assert.deepEqual(privateTreeSnapshot(fixture.workspaceRoot), before);
});

test("terminal lifecycle replay cannot release a lease owned by another demand", async (t) => {
  const fixture = await createIntegrationFixture(t, { secondProduct: true });
  const binding = inspectWindowBindingInventory({ workspaceRoot: fixture.workspaceRoot })
    .bindings
    .find((entry) => entry.windowId === INTEGRATION_IDS.productWindowTwo);
  assert.ok(binding);
  const foreignLease = await acquireWindowCoordinationLease({
    workspaceRoot: fixture.workspaceRoot,
    windowId: binding.windowId,
    demandId: integrationDeterministicId("demand", "foreign lifecycle replay demand"),
    targetTaskId: integrationDeterministicId("target-task", "foreign lifecycle replay task"),
    groupId: "dispatch-group-foreign-lifecycle-replay",
    groupDigest: `sha256:${"5".repeat(64)}`,
    deliveryId: "delivery-foreign-lifecycle-replay",
    envelopeDigest: `sha256:${"6".repeat(64)}`,
    bindingId: binding.bindingId,
    identityBindingDigest: binding.identityBindingDigest,
  });
  const foreignLeasePath = path.resolve(
    fixture.workspaceRoot,
    ...foreignLease.leaseRef.split("/"),
  );

  const stack = loadIntegrationStack(fixture);
  const plan = planDemandLifecycleTransition(planInput(fixture, stack));
  assert.deepEqual(plan.leaseReleases, []);
  await applyDemandLifecycleTransitionPlan(applyInput(fixture, plan));
  assert.equal(existsSync(foreignLeasePath), true);

  const forgedReplay = withCurrentPlanDigest({
    ...structuredClone(plan),
    leaseReleases: [{
      windowId: foreignLease.lease.windowId,
      leaseId: foreignLease.lease.leaseId,
      deliveryId: foreignLease.lease.deliveryId,
      bindingId: foreignLease.lease.bindingId,
      leaseDigest: foreignLease.lease.leaseDigest,
    }],
  });
  await assert.rejects(
    applyDemandLifecycleTransitionPlan(applyInput(fixture, forgedReplay)),
    (error) => /wakeflow-demand-lifecycle-(?:lease|plan|apply)/u.test(error?.code ?? ""),
  );
  assert.equal(existsSync(foreignLeasePath), true);
  assert.equal(inspectWakeflowWorkspaceMutation({ workspaceRoot: fixture.workspaceRoot }).state, "idle");
});
