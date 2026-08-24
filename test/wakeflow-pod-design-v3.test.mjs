import assert from "node:assert/strict";
import test from "node:test";

import { canonicalJsonDigest } from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import * as demandArtifacts from "../core/scripts/lib/wakeflow-demand-artifact-records.mjs";
import * as demandCore from "../core/scripts/lib/wakeflow-demand-core-records.mjs";
import * as identifiers from "../core/scripts/lib/wakeflow-identifiers.mjs";

const IDS = Object.freeze({
  program: "program_41000000-0000-4000-8000-000000000001",
  demand: "demand_41000000-0000-4000-8000-000000000002",
  pod: "pod_41000000-0000-4000-8000-000000000003",
  request: "pod-design-request_41000000-0000-4000-8000-000000000004",
  handoff: "pod-design-handoff_41000000-0000-4000-8000-000000000005",
  repository: "repository_41000000-0000-4000-8000-000000000006",
  responsibilityWindow: "window_41000000-0000-4000-8000-000000000007",
  controllerWindow: "window_41000000-0000-4000-8000-000000000011",
  designWindow: "window_41000000-0000-4000-8000-000000000012",
  testWindow: "window_41000000-0000-4000-8000-000000000013",
  confirmation: "confirmation_41000000-0000-4000-8000-000000000014",
});

const CREATED_AT = "2026-08-09T04:00:00.000Z";
const DEMAND_DIGEST = `sha256:${"1".repeat(64)}`;
const AUTHORITY_DIGEST = `sha256:${"2".repeat(64)}`;
const REQUIREMENT_DIGEST = `sha256:${"3".repeat(64)}`;

function requestArtifact(overrides = {}) {
  return {
    schemaVersion: 1,
    artifactKind: "wakeflow-pod-design-request",
    podDesignRequestId: IDS.request,
    programId: IDS.program,
    demandId: IDS.demand,
    demandRef: "demand.json",
    demandDigest: DEMAND_DIGEST,
    podId: IDS.pod,
    requestType: "initial-design",
    demandType: "requirement",
    originalGoal: "Define the exact isolated implementation landing plan.",
    completionDefinition: "Every selected repository has one bounded product scope.",
    requirementRefs: [{
      role: "goal",
      ref: "requirement-designs/req/goal.md",
      digest: REQUIREMENT_DIGEST,
      anchor: "goal",
    }],
    nonGoals: ["Do not materialize host resources."],
    decisionsRequired: ["Confirm repository coverage."],
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function handoffArtifact(request, overrides = {}) {
  const requestIdentity = demandArtifacts.demandArtifactIdentity(request);
  return {
    schemaVersion: 1,
    artifactKind: "wakeflow-pod-design-handoff",
    podDesignHandoffId: IDS.handoff,
    programId: IDS.program,
    demandId: IDS.demand,
    demandRef: "demand.json",
    demandDigest: DEMAND_DIGEST,
    podId: IDS.pod,
    designRequest: {
      podDesignRequestId: IDS.request,
      ref: requestIdentity.ref,
      digest: requestIdentity.digest,
    },
    demandAuthority: {
      ref: "demand-authority.json",
      digest: AUTHORITY_DIGEST,
    },
    preservesOriginalGoal: true,
    requirementRefs: request.requirementRefs,
    designIntent: "Land one isolated product slice in the selected repository.",
    landingPlan: [{
      repositoryId: IDS.repository,
      responsibilityWindowId: IDS.responsibilityWindow,
      workScope: "Implement and verify the confirmed product slice.",
    }],
    testDecision: {
      mode: "controller-only",
      summary: "Run focused repository tests in the isolated product worktree.",
    },
    nonGoals: request.nonGoals,
    risks: ["The expected base HEAD may become stale before materialization."],
    createdAt: CREATED_AT,
    ...overrides,
  };
}

test("M4-T02b admits program-generated Pod Design request and handoff IDs", () => {
  assert.equal(identifiers.assertWakeflowId(IDS.request, "pod-design-request"), IDS.request);
  assert.equal(identifiers.assertWakeflowId(IDS.handoff, "pod-design-handoff"), IDS.handoff);
  assert.equal(identifiers.WAKEFLOW_ID_TYPES.includes("pod-design-request"), true);
  assert.equal(identifiers.WAKEFLOW_ID_TYPES.includes("pod-design-handoff"), true);
});

test("portable Pod Design request and handoff are strict demand artifacts with independent identities", () => {
  assert.equal(typeof demandArtifacts.validatePodDesignRequestArtifact, "function");
  assert.equal(typeof demandArtifacts.validatePodDesignHandoffArtifact, "function");
  const request = demandArtifacts.validatePodDesignRequestArtifact(requestArtifact());
  const requestIdentity = demandArtifacts.demandArtifactIdentity(request);
  assert.deepEqual(requestIdentity, {
    artifactKind: "wakeflow-pod-design-request",
    artifactId: IDS.request,
    ref: `pod/design-requests/${IDS.request}.json`,
    digest: canonicalJsonDigest(request),
  });

  const handoff = demandArtifacts.validatePodDesignHandoffArtifact(handoffArtifact(request));
  assert.deepEqual(demandArtifacts.demandArtifactIdentity(handoff), {
    artifactKind: "wakeflow-pod-design-handoff",
    artifactId: IDS.handoff,
    ref: `pod/design-handoffs/${IDS.handoff}.json`,
    digest: canonicalJsonDigest(handoff),
  });
  assert.equal(Object.isFrozen(request), true);
  assert.equal(Object.isFrozen(handoff.landingPlan), true);
});

test("Pod Design artifacts reject semantic/path leakage and noncanonical landing coverage", () => {
  assert.throws(
    () => demandArtifacts.validatePodDesignRequestArtifact(requestArtifact({
      designWindowName: "Design__semantic-pod",
    })),
    (error) => error?.code === "wakeflow-demand-artifact-unknown-field",
  );
  const request = demandArtifacts.validatePodDesignRequestArtifact(requestArtifact());
  assert.throws(
    () => demandArtifacts.validatePodDesignHandoffArtifact(handoffArtifact(request, {
      landingPlan: [
        {
          repositoryId: IDS.repository,
          responsibilityWindowId: IDS.responsibilityWindow,
          workScope: "First duplicate.",
        },
        {
          repositoryId: IDS.repository,
          responsibilityWindowId: "window_41000000-0000-4000-8000-000000000008",
          workScope: "Second duplicate.",
        },
      ],
    })),
    (error) => error?.code === "wakeflow-demand-artifact-array",
  );
  assert.throws(
    () => demandArtifacts.validatePodDesignHandoffArtifact(handoffArtifact(request, {
      repositoryRoot: "/private/product",
    })),
    (error) => error?.code === "wakeflow-demand-artifact-unknown-field",
  );
});

function demandRecord() {
  return {
    schemaVersion: 1,
    artifactKind: "wakeflow-demand",
    programId: IDS.program,
    demandId: IDS.demand,
    createdAt: CREATED_AT,
    title: "Pod Design authority",
    goal: "Define the exact isolated implementation landing plan.",
    completionDefinition: "Every selected repository has one bounded product scope.",
    demandType: "requirement",
    source: {
      artifactKind: "wakeflow-todo-lineage-ref",
      schemaVersion: 1,
      boardRef: ".wakeflow-active/current/global-todo-board.md",
      todoId: "TODO-M4-T02B",
      intakeRowDigest: `sha256:${"4".repeat(64)}`,
    },
    executionPlacement: {
      mode: "isolated",
      authorizationRef: {
        schemaVersion: 1,
        artifactKind: "wakeflow-ledger-member-ref",
        family: "confirmation",
        recordId: IDS.confirmation,
        recordRef: `goal-stage-confirmation/${IDS.confirmation}/record.json`,
        recordDigest: `sha256:${"5".repeat(64)}`,
        memberRef: `goal-stage-confirmation/${IDS.confirmation}/authorization.md`,
        memberDigest: `sha256:${"6".repeat(64)}`,
        role: "user-confirmation",
      },
    },
  };
}

function boundControlWindow(role, windowId, ordinal) {
  const launchOperationId = `pod-launch_41000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`;
  const materializationEventId = `pod-materialization-event_41000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`;
  return {
    windowId,
    role,
    launchOperationId,
    bindingId: `binding_41000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`,
    launchIntent: {
      ref: `.wakeflow-local/runtime/hosts/codex/evidence/pods/${IDS.pod}/launch-intents/${launchOperationId}.json`,
      digest: `sha256:${String(ordinal).repeat(64)}`,
    },
    status: "bound",
    materializationFinalEvent: {
      eventId: materializationEventId,
      ref: `.wakeflow-local/runtime/hosts/codex/evidence/pods/${IDS.pod}/materialization/${launchOperationId}/events/${materializationEventId}.json`,
      digest: `sha256:${"d".repeat(64)}`,
    },
    identityBindingDigest: `sha256:${"e".repeat(64)}`,
    creationReceipt: {
      ref: `.wakeflow-local/runtime/hosts/codex/evidence/pods/${IDS.pod}/bindings/${windowId}/creation-receipt.json`,
      digest: `sha256:${"f".repeat(64)}`,
    },
  };
}

function controlReadyState(demand) {
  return demandCore.validateDemandStateRecord({
    schemaVersion: 1,
    artifactKind: "wakeflow-state",
    programId: demand.programId,
    demandId: demand.demandId,
    demandRef: "demand.json",
    demandDigest: canonicalJsonDigest(demand),
    revision: 3,
    state: "planned",
    stateReason: "Pod control members are bound.",
    updatedAt: "2026-08-09T04:00:02.000Z",
    lastEvent: {
      eventId: "event-pod-control-ready-0003",
      eventDigest: `sha256:${"a".repeat(64)}`,
    },
    taskPackages: [],
    targetTasks: [],
    targetResults: [],
    testCards: [],
    evidence: [],
    review: {
      status: "idle",
      readyTargetTaskIds: [],
      blockedTargetTaskIds: [],
      missingTargetTaskIds: [],
    },
    pod: {
      podId: IDS.pod,
      hostId: "codex",
      placementAuthorizationDigest: canonicalJsonDigest(demand.executionPlacement.authorizationRef),
      scope: {
        ref: `.wakeflow-local/runtime/hosts/codex/evidence/pods/${IDS.pod}/pod-scope.json`,
        digest: `sha256:${"b".repeat(64)}`,
      },
      phase: "control-ready",
      windows: [
        boundControlWindow("controller", IDS.controllerWindow, 1),
        boundControlWindow("design", IDS.designWindow, 2),
        boundControlWindow("test", IDS.testWindow, 3),
      ].sort((left, right) => left.windowId.localeCompare(right.windowId)),
    },
  });
}

test("Pod Design request is one Pod-owned artifact transition from control-ready to designing", () => {
  const demand = demandCore.validateDemandRecord(demandRecord());
  const previousState = controlReadyState(demand);
  const request = demandArtifacts.validatePodDesignRequestArtifact(requestArtifact({
    demandDigest: canonicalJsonDigest(demand),
    originalGoal: demand.goal,
    completionDefinition: demand.completionDefinition,
    createdAt: "2026-08-09T04:00:03.000Z",
  }));
  const identity = demandArtifacts.demandArtifactIdentity(request);
  const nextPod = {
    ...previousState.pod,
    phase: "designing",
    designRequest: {
      podDesignRequestId: IDS.request,
      ref: identity.ref,
      digest: identity.digest,
    },
  };
  const event = demandCore.validateControllerEventRecord({
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: "event-pod-design-request-0004",
    demandId: IDS.demand,
    createdAt: request.createdAt,
    actor: "controller",
    command: "record-pod-design-request",
    type: "pod.design-request-recorded",
    previousRevision: previousState.revision,
    nextRevision: previousState.revision + 1,
    from: previousState.state,
    to: previousState.state,
    reason: "Record the exact Pod Design input.",
    decisionSummary: "Begin Design from one frozen request.",
    changedArtifacts: [identity],
    podTransition: {
      podId: IDS.pod,
      action: "record-design-request",
      podDesignRequestId: IDS.request,
      previousPodDigest: canonicalJsonDigest(previousState.pod),
      nextPodDigest: canonicalJsonDigest(nextPod),
    },
  });
  const nextState = demandCore.validateDemandStateRecord({
    ...previousState,
    revision: event.nextRevision,
    stateReason: event.reason,
    updatedAt: event.createdAt,
    lastEvent: { eventId: event.eventId, eventDigest: canonicalJsonDigest(event) },
    pod: nextPod,
  });
  assert.doesNotThrow(() => demandCore.validateStateTransitionRecord({
    schemaVersion: 1,
    artifactKind: "wakeflow-state-transition",
    demandId: IDS.demand,
    command: event.command,
    createdAt: event.createdAt,
    expectedPreviousRevision: previousState.revision,
    expectedPreviousStateDigest: canonicalJsonDigest(previousState),
    previousState,
    nextEvent: event,
    nextEventDigest: canonicalJsonDigest(event),
    nextState,
    nextStateDigest: canonicalJsonDigest(nextState),
    artifactWrites: [{ ...identity, value: request }],
  }, { demand, currentState: previousState }));
});

test("handoff selector cannot appear without its exact request selector", () => {
  const demand = demandCore.validateDemandRecord(demandRecord());
  const state = structuredClone(controlReadyState(demand));
  state.pod.phase = "creating-products";
  state.pod.designHandoff = {
    podDesignHandoffId: IDS.handoff,
    ref: `pod/design-handoffs/${IDS.handoff}.json`,
    digest: `sha256:${"c".repeat(64)}`,
  };
  assert.throws(
    () => demandCore.validateDemandStateRecord(state),
    (error) => error?.code === "wakeflow-demand-core-pod-state",
  );
});
