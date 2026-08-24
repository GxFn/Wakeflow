import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  canonicalJson,
  canonicalJsonDigest,
} from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import { inspectWakeflowActiveProjection } from "../core/scripts/lib/wakeflow-active-projector.mjs";
import {
  validateControllerEventRecord,
  validateDemandStateRecord,
  loadDemandCoreRecords,
} from "../core/scripts/lib/wakeflow-demand-core-records.mjs";
import {
  commitDemandLifecycleTransitionWhileLocked,
  commitDemandPodTransitionWhileLocked,
  freezeDemandAuthority,
} from "../core/scripts/lib/wakeflow-demand-state-service.mjs";
import {
  demandArtifactIdentity,
} from "../core/scripts/lib/wakeflow-demand-artifact-records.mjs";
import {
  inventoryDemandArtifacts,
} from "../core/scripts/lib/wakeflow-demand-artifact-service.mjs";
import {
  createLedgerMemberReference,
  createLedgerRecord,
  loadLedgerRecord,
} from "../core/scripts/lib/wakeflow-ledger-records.mjs";
import {
  createHostDecommissionResult,
} from "../core/scripts/lib/wakeflow-host-decommission-result.mjs";
import {
  createPodCreationReceiptRecord,
  createPodTestAccessReceiptRecord,
  podRecordCanonicalBytes,
  podRecordDigest,
  podRecordRef,
  WAKEFLOW_POD_CREATION_RECEIPT_KIND,
  WAKEFLOW_POD_LAUNCH_INTENT_KIND,
  WAKEFLOW_POD_SCOPE_KIND,
  WAKEFLOW_POD_TEST_ACCESS_RECEIPT_KIND,
} from "../core/scripts/lib/wakeflow-pod-records.mjs";
import * as podService from "../core/scripts/lib/wakeflow-pod-service.mjs";
import { withStateRootLock } from "../core/scripts/lib/wakeflow-state-lock.mjs";
import { parseWakeflowAssetBundle } from "../core/scripts/lib/wakeflow-template-renderer.mjs";
import { buildWakeflowAssetBundle } from "../tools/build-asset-bundle.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(repositoryRoot, "core/template-sources");
const configFixture = path.join(
  repositoryRoot,
  "test/fixtures/wakeflow-config-v3/valid-minimal.json",
);
const projectionBundle = parseWakeflowAssetBundle(buildWakeflowAssetBundle({ sourceRoot }));
const CREATED_AT = "2026-08-09T02:00:00.000Z";
const TRANSITION_AT = "2026-08-09T02:00:01.000Z";
const REQUEST_AT = "2026-08-09T02:10:00.000Z";
const AUTHORITY_AT = "2026-08-09T02:10:01.000Z";
const HANDOFF_AT = "2026-08-09T02:10:02.000Z";
const PRODUCT_AT = "2026-08-09T02:10:03.000Z";
const IDS = Object.freeze({
  program: "program_11111111-1111-4111-8111-111111111111",
  demand: "demand_22000000-0000-4000-8000-000000000001",
  pod: "pod_33000000-0000-4000-8000-000000000001",
  confirmation: "confirmation_44000000-0000-4000-8000-000000000001",
  requirement: "requirement_44000000-0000-4000-8000-000000000002",
  designRequest: "pod-design-request_44000000-0000-4000-8000-000000000003",
  designHandoff: "pod-design-handoff_44000000-0000-4000-8000-000000000004",
  controllerWindow: "window_55000000-0000-4000-8000-000000000001",
  designWindow: "window_55000000-0000-4000-8000-000000000002",
  testWindow: "window_55000000-0000-4000-8000-000000000003",
  productWindow: "window_55000000-0000-4000-8000-000000000004",
  controllerBinding: "binding_66000000-0000-4000-8000-000000000001",
  designBinding: "binding_66000000-0000-4000-8000-000000000002",
  testBinding: "binding_66000000-0000-4000-8000-000000000003",
  productBinding: "binding_66000000-0000-4000-8000-000000000004",
  controllerLaunch: "pod-launch_77000000-0000-4000-8000-000000000001",
  designLaunch: "pod-launch_77000000-0000-4000-8000-000000000002",
  testLaunch: "pod-launch_77000000-0000-4000-8000-000000000003",
  productLaunch: "pod-launch_77000000-0000-4000-8000-000000000004",
  controllerAttempt: "pod-materialization-attempt_78000000-0000-4000-8000-000000000001",
  designAttempt: "pod-materialization-attempt_78000000-0000-4000-8000-000000000002",
  designRetryAttempt: "pod-materialization-attempt_78000000-0000-4000-8000-000000000003",
  testAttempt: "pod-materialization-attempt_78000000-0000-4000-8000-000000000004",
  controllerCreating: "pod-materialization-event_79000000-0000-4000-8000-000000000001",
  controllerPending: "pod-materialization-event_79000000-0000-4000-8000-000000000002",
  controllerFinalized: "pod-materialization-event_79000000-0000-4000-8000-000000000003",
  designCreating: "pod-materialization-event_79000000-0000-4000-8000-000000000004",
  designFailed: "pod-materialization-event_79000000-0000-4000-8000-000000000005",
  designRetryCreating: "pod-materialization-event_79000000-0000-4000-8000-000000000006",
  designFinalized: "pod-materialization-event_79000000-0000-4000-8000-000000000007",
  testCreating: "pod-materialization-event_79000000-0000-4000-8000-000000000008",
  testFinalized: "pod-materialization-event_79000000-0000-4000-8000-000000000009",
  productAttempt: "pod-materialization-attempt_78000000-0000-4000-8000-000000000005",
  productCreating: "pod-materialization-event_79000000-0000-4000-8000-000000000011",
  productFinalized: "pod-materialization-event_79000000-0000-4000-8000-000000000012",
  testProbe: "pod-test-probe_7a000000-0000-4000-8000-000000000001",
  testRetryProbe: "pod-test-probe_7a000000-0000-4000-8000-000000000002",
  testThirdProbe: "pod-test-probe_7a000000-0000-4000-8000-000000000003",
  controllerClose: "pod-close_7b000000-0000-4000-8000-000000000001",
  designClose: "pod-close_7b000000-0000-4000-8000-000000000002",
  testClose: "pod-close_7b000000-0000-4000-8000-000000000003",
  productClose: "pod-close_7b000000-0000-4000-8000-000000000004",
  repository: "repository_22222222-2222-4222-8222-222222222222",
  responsibilityWindow: "window_88888888-8888-4888-8888-888888888888",
});
const PRODUCT_DIGEST = canonicalJsonDigest({
  repositoryId: IDS.repository,
  path: "ProductA",
});

function ensurePrivateDirectory(root, ref) {
  let current = root;
  for (const segment of ref.split("/")) {
    current = path.join(current, segment);
    if (!existsSync(current)) mkdirSync(current, { mode: 0o700 });
    if (process.platform !== "win32") chmodSync(current, 0o700);
  }
  return current;
}

function writeCanonical(file, value) {
  writeFileSync(file, `${canonicalJson(value)}\n`, { mode: 0o600 });
  if (process.platform !== "win32") chmodSync(file, 0o600);
}

function initialEvent(demand) {
  return {
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: "event-pod-service-initial-0001",
    demandId: demand.demandId,
    createdAt: CREATED_AT,
    actor: "controller",
    command: "init",
    type: "state.initialized",
    previousRevision: 0,
    nextRevision: 1,
    from: null,
    to: "intake",
    reason: "candidate demand initialized",
    decisionSummary: "Publish isolated demand identity.",
    changedArtifacts: [{
      artifactKind: "wakeflow-demand",
      ref: "demand.json",
      digest: canonicalJsonDigest(demand),
    }],
  };
}

function initialState(demand, event) {
  return {
    schemaVersion: 1,
    artifactKind: "wakeflow-state",
    programId: demand.programId,
    demandId: demand.demandId,
    demandRef: "demand.json",
    demandDigest: canonicalJsonDigest(demand),
    revision: 1,
    state: "intake",
    stateReason: event.reason,
    updatedAt: event.createdAt,
    lastEvent: {
      eventId: event.eventId,
      eventDigest: canonicalJsonDigest(event),
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
  };
}

function createFixture(t) {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-pod-service-v3-"));
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  const workspaceRoot = path.join(fixtureRoot, "Program");
  mkdirSync(workspaceRoot, { mode: 0o700 });
  if (process.platform !== "win32") chmodSync(workspaceRoot, 0o700);
  for (const ref of [
    ".wakeflow-active/current",
    ".wakeflow-local/runtime/maintenance/transactions",
    ".wakeflow-local/runtime/hosts/codex/evidence/pods",
    ".wakeflow-local/runtime/hosts/codex/identity/window-bindings",
  ]) ensurePrivateDirectory(workspaceRoot, ref);

  const config = JSON.parse(readFileSync(configFixture, "utf8"));
  config.storage.ledgerRoot = "Ledger";
  config.topology.repositories[0].path = "ProductA";
  config.topology.supportSurfaces[0].path = "Design";
  config.topology.supportSurfaces[1].path = "Test";
  writeFileSync(
    path.join(workspaceRoot, "wakeflow.config.json"),
    `${JSON.stringify(config, null, 2)}\n`,
    { mode: 0o600 },
  );

  const ledgerRoot = ensurePrivateDirectory(workspaceRoot, "Ledger");
  ensurePrivateDirectory(ledgerRoot, "goal-stage-confirmation");
  ensurePrivateDirectory(ledgerRoot, "requirement-designs");
  ensurePrivateDirectory(ledgerRoot, "workspace/archive");
  const memberPath = "01-user-confirmation.md";
  const memberContent = "# Pod placement authorization\n";
  const created = createLedgerRecord({
    ledgerRoot,
    expectedProgramId: IDS.program,
    record: {
      schemaVersion: 1,
      artifactKind: "wakeflow-confirmation-record",
      confirmationId: IDS.confirmation,
      programId: IDS.program,
      demandId: IDS.demand,
      title: "Authorize isolated Pod placement",
      status: "confirmed",
      documents: [{
        role: "user-confirmation",
        path: memberPath,
        mediaType: "text/markdown",
        digest: `sha256:${createHash("sha256").update(memberContent).digest("hex")}`,
      }],
    },
    memberContents: { [memberPath]: memberContent },
  });
  const confirmation = loadLedgerRecord({
    ledgerRoot,
    root: created.root,
    expectedFamily: "confirmation",
    expectedProgramId: IDS.program,
  });
  const authorizationRef = createLedgerMemberReference(confirmation, memberPath);
  const authorityDocuments = [
    "original-plan",
    "requirement-design",
    "code-facts",
    "landing-plan",
    "non-goals",
    "user-confirmation",
  ].map((role, index) => {
    const memberPath = `${String(index + 1).padStart(2, "0")}-${role}.md`;
    const content = `# ${role}\n`;
    return {
      role,
      path: memberPath,
      mediaType: "text/markdown",
      digest: `sha256:${createHash("sha256").update(content).digest("hex")}`,
      content,
    };
  });
  const createdRequirement = createLedgerRecord({
    ledgerRoot,
    expectedProgramId: IDS.program,
    record: {
      schemaVersion: 1,
      artifactKind: "wakeflow-requirement-record",
      requirementId: IDS.requirement,
      programId: IDS.program,
      title: "Pod Design proportional authority",
      status: "confirmed",
      relatedDemandIds: [IDS.demand],
      documents: authorityDocuments.map(({ content: _content, ...document }) => document),
    },
    memberContents: Object.fromEntries(
      authorityDocuments.map((document) => [document.path, document.content]),
    ),
  });
  const requirement = loadLedgerRecord({
    ledgerRoot,
    root: createdRequirement.root,
    expectedFamily: "requirement",
    expectedProgramId: IDS.program,
  });
  const authorityRefs = authorityDocuments.map((document) => (
    createLedgerMemberReference(requirement, document.path)
  ));
  const demand = {
    schemaVersion: 1,
    artifactKind: "wakeflow-demand",
    programId: IDS.program,
    demandId: IDS.demand,
    createdAt: CREATED_AT,
    title: "M4 T02 Pod service",
    goal: "Publish one state-linked Pod scope and its control launch intents.",
    completionDefinition: "The exact immutable local evidence is selected by Pod state.",
    demandType: "requirement",
    source: {
      artifactKind: "wakeflow-todo-lineage-ref",
      schemaVersion: 1,
      boardRef: ".wakeflow-active/current/global-todo-board.md",
      todoId: "TODO-M4-T02",
      intakeRowDigest: `sha256:${"b".repeat(64)}`,
    },
    executionPlacement: { mode: "isolated", authorizationRef },
  };
  const event = initialEvent(demand);
  const state = initialState(demand, event);
  const stateRoot = ensurePrivateDirectory(
    workspaceRoot,
    `.wakeflow-active/current/${IDS.demand}`,
  );
  for (const ref of [
    "task-packages",
    "target-results",
    "review-candidates",
    "test-cards",
    "evidence",
    "transactions",
    "pod/design-requests",
    "pod/design-handoffs",
  ]) ensurePrivateDirectory(stateRoot, ref);
  writeCanonical(path.join(stateRoot, "demand.json"), demand);
  writeCanonical(path.join(stateRoot, "wakeflow-state.json"), state);
  writeFileSync(
    path.join(stateRoot, "controller-events.jsonl"),
    `${canonicalJson(event)}\n`,
    { mode: 0o600 },
  );
  return {
    workspaceRoot,
    stateRoot,
    ledgerRoot,
    authorizationRef,
    authorityRefs,
    demand,
    event,
    state,
  };
}

function scope(fixture, overrides = {}) {
  return {
    kind: WAKEFLOW_POD_SCOPE_KIND,
    schemaVersion: 1,
    programId: IDS.program,
    hostId: "codex",
    podId: IDS.pod,
    demandId: IDS.demand,
    placementAuthorizationDigest: canonicalJsonDigest(fixture.authorizationRef),
    createdAt: TRANSITION_AT,
    ...overrides,
  };
}

function controlIntents(overrides = {}) {
  return [
    ["controller", IDS.controllerWindow, IDS.controllerLaunch, IDS.controllerBinding],
    ["design", IDS.designWindow, IDS.designLaunch, IDS.designBinding],
    ["test", IDS.testWindow, IDS.testLaunch, IDS.testBinding],
  ].map(([role, windowId, launchOperationId, bindingId]) => ({
    kind: WAKEFLOW_POD_LAUNCH_INTENT_KIND,
    schemaVersion: 1,
    programId: IDS.program,
    hostId: "codex",
    podId: IDS.pod,
    demandId: IDS.demand,
    windowId,
    launchOperationId,
    bindingId,
    role,
    environmentIntent: "host-local",
    createdAt: TRANSITION_AT,
    ...overrides,
  })).sort((left, right) => left.windowId.localeCompare(right.windowId));
}

function productIntent(overrides = {}) {
  return {
    kind: WAKEFLOW_POD_LAUNCH_INTENT_KIND,
    schemaVersion: 1,
    programId: IDS.program,
    hostId: "codex",
    podId: IDS.pod,
    demandId: IDS.demand,
    windowId: IDS.productWindow,
    launchOperationId: IDS.productLaunch,
    bindingId: IDS.productBinding,
    role: "product",
    repositoryId: IDS.repository,
    responsibilityWindowId: IDS.responsibilityWindow,
    repositorySourceDigest: PRODUCT_DIGEST,
    environmentIntent: "host-worktree",
    basePolicy: "local-head",
    expectedBaseHead: "1".repeat(40),
    createdAt: PRODUCT_AT,
    ...overrides,
  };
}

function planInput(fixture, overrides = {}) {
  return {
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    scope: scope(fixture),
    launchIntents: controlIntents(),
    transition: {
      eventId: "event-pod-service-initialize-0002",
      createdAt: TRANSITION_AT,
      reason: "Pod scope and exact control launch intents recorded",
      decisionSummary: "Initialize one authorized state-first Pod namespace.",
    },
    ...overrides,
  };
}

function applyInput(fixture, plan) {
  return {
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    plan,
    planDigest: plan.planDigest,
  };
}

function absoluteRef(workspaceRoot, ref) {
  return path.join(workspaceRoot, ...ref.split("/"));
}

function writeEvidencePrefix(workspaceRoot, records, count = records.length) {
  const staticRoot = absoluteRef(
    workspaceRoot,
    ".wakeflow-local/runtime/hosts/codex/evidence/pods",
  );
  const podRoot = ensurePrivateDirectory(staticRoot, IDS.pod);
  for (const ref of ["launch-intents", "materialization", "bindings", "test-access", "close"]) {
    ensurePrivateDirectory(podRoot, ref);
  }
  for (const record of records.slice(0, count)) {
    const file = absoluteRef(workspaceRoot, podRecordRef(record));
    writeFileSync(file, podRecordCanonicalBytes(record), { mode: 0o600 });
  }
}

function transitionJournal(plan) {
  return {
    schemaVersion: 1,
    artifactKind: "wakeflow-state-transition",
    demandId: plan.demandId,
    command: plan.event.command,
    createdAt: plan.event.createdAt,
    expectedPreviousRevision: plan.sourceState.revision,
    expectedPreviousStateDigest: plan.sourceStateDigest,
    previousState: plan.sourceState,
    nextEvent: plan.event,
    nextEventDigest: canonicalJsonDigest(plan.event),
    nextState: plan.nextState,
    nextStateDigest: canonicalJsonDigest(plan.nextState),
    artifactWrites: [],
  };
}

async function initializeAndBindControls(fixture) {
  const initialization = podService.planPodLaunchInitialization(planInput(fixture));
  await podService.applyPodLaunchInitializationPlan(applyInput(fixture, initialization));
  for (const [index, windowId] of [
    IDS.controllerWindow,
    IDS.designWindow,
    IDS.testWindow,
  ].entries()) {
    const loaded = loadDemandCoreRecords({
      stateRoot: fixture.stateRoot,
      expectedProgramId: IDS.program,
      ledgerRoot: fixture.ledgerRoot,
    });
    const nextPod = structuredClone(loaded.state.pod);
    const member = nextPod.windows.find((entry) => entry.windowId === windowId);
    const ordinal = index + 1;
    const materializationEventId = `pod-materialization-event_88000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`;
    member.status = "bound";
    member.materializationFinalEvent = {
      eventId: materializationEventId,
      ref: `.wakeflow-local/runtime/hosts/codex/evidence/pods/${IDS.pod}`
        + `/materialization/${member.launchOperationId}/events/${materializationEventId}.json`,
      digest: `sha256:${String(ordinal).repeat(64)}`,
    };
    member.identityBindingDigest = `sha256:${String(ordinal + 3).repeat(64)}`;
    member.creationReceipt = {
      ref: `.wakeflow-local/runtime/hosts/codex/evidence/pods/${IDS.pod}`
        + `/bindings/${member.windowId}/creation-receipt.json`,
      digest: `sha256:${String(ordinal + 6).repeat(64)}`,
    };
    nextPod.phase = ordinal === 3 ? "control-ready" : "creating-control";
    const createdAt = `2026-08-09T02:00:0${ordinal + 1}.000Z`;
    const event = validateControllerEventRecord({
      schemaVersion: 1,
      artifactKind: "wakeflow-controller-event",
      eventId: `event-pod-service-bind-000${ordinal + 2}`,
      demandId: IDS.demand,
      createdAt,
      actor: "controller",
      command: "bind-pod-window",
      type: "pod.window-bound",
      previousRevision: loaded.state.revision,
      nextRevision: loaded.state.revision + 1,
      from: loaded.state.state,
      to: loaded.state.state,
      reason: `Bind Pod control member ${ordinal}`,
      decisionSummary: "Admit exact host materialization prerequisites for the T02b fixture.",
      changedArtifacts: [],
      podTransition: {
        podId: IDS.pod,
        action: "bind-window",
        windowId,
        previousPodDigest: canonicalJsonDigest(loaded.state.pod),
        nextPodDigest: canonicalJsonDigest(nextPod),
      },
    });
    const nextState = validateDemandStateRecord({
      ...loaded.state,
      revision: event.nextRevision,
      stateReason: event.reason,
      updatedAt: event.createdAt,
      lastEvent: { eventId: event.eventId, eventDigest: canonicalJsonDigest(event) },
      pod: nextPod,
    });
    withStateRootLock(fixture.stateRoot, () => commitDemandPodTransitionWhileLocked({
      stateRoot: fixture.stateRoot,
      expectedProgramId: IDS.program,
      ledgerRoot: fixture.ledgerRoot,
      expectedPrevious: { revision: loaded.state.revision, stateDigest: loaded.digests.state },
      event,
      nextState,
    }));
  }
  return loadDemandCoreRecords({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
}

function designRequestArtifact(fixture, overrides = {}) {
  return {
    schemaVersion: 1,
    artifactKind: "wakeflow-pod-design-request",
    podDesignRequestId: IDS.designRequest,
    programId: IDS.program,
    demandId: IDS.demand,
    demandRef: "demand.json",
    demandDigest: canonicalJsonDigest(fixture.demand),
    podId: IDS.pod,
    requestType: "initial-design",
    demandType: fixture.demand.demandType,
    originalGoal: fixture.demand.goal,
    completionDefinition: fixture.demand.completionDefinition,
    requirementRefs: [],
    nonGoals: ["Do not execute host materialization in Design."],
    decisionsRequired: ["Confirm the exact repository landing set."],
    createdAt: REQUEST_AT,
    ...overrides,
  };
}

function designRequestInput(fixture, loaded, artifact = designRequestArtifact(fixture)) {
  return {
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    expectedPrevious: { revision: loaded.state.revision, stateDigest: loaded.digests.state },
    artifact,
    transition: {
      eventId: "event-pod-service-design-request-0006",
      createdAt: REQUEST_AT,
      reason: "Record the exact portable Pod Design request",
      decisionSummary: "Begin Design from one immutable request tuple.",
    },
  };
}

function freezeFixtureAuthority(fixture) {
  const loaded = loadDemandCoreRecords({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
  const authority = {
    schemaVersion: 1,
    artifactKind: "wakeflow-demand-authority",
    demandId: IDS.demand,
    demandRef: "demand.json",
    demandDigest: canonicalJsonDigest(fixture.demand),
    entryMode: "pod-design",
    authorityRefs: fixture.authorityRefs,
    testDecision: {
      mode: "controller-only",
      summary: "Run bounded repository checks in the isolated product worktree.",
    },
  };
  const authorityDigest = canonicalJsonDigest(authority);
  const event = validateControllerEventRecord({
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: "event-pod-service-authority-0007",
    demandId: IDS.demand,
    createdAt: AUTHORITY_AT,
    actor: "controller",
    command: "freeze-authority",
    type: "authority.frozen",
    previousRevision: loaded.state.revision,
    nextRevision: loaded.state.revision + 1,
    from: loaded.state.state,
    to: loaded.state.state,
    reason: "Freeze proportional Pod demand authority",
    decisionSummary: "Bind the confirmed landing and bounded Test decision.",
    changedArtifacts: [{
      artifactKind: "wakeflow-demand-authority",
      ref: "demand-authority.json",
      digest: authorityDigest,
    }],
  });
  const nextState = validateDemandStateRecord({
    ...loaded.state,
    revision: event.nextRevision,
    stateReason: event.reason,
    updatedAt: event.createdAt,
    lastEvent: { eventId: event.eventId, eventDigest: canonicalJsonDigest(event) },
    demandAuthorityRef: "demand-authority.json",
    demandAuthorityDigest: authorityDigest,
  });
  freezeDemandAuthority({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    expectedPrevious: { revision: loaded.state.revision, stateDigest: loaded.digests.state },
    authority,
    event,
    nextState,
  });
  return authority;
}

function designHandoffArtifact(fixture, request, authority, overrides = {}) {
  const requestIdentity = demandArtifactIdentity(request);
  return {
    schemaVersion: 1,
    artifactKind: "wakeflow-pod-design-handoff",
    podDesignHandoffId: IDS.designHandoff,
    programId: IDS.program,
    demandId: IDS.demand,
    demandRef: "demand.json",
    demandDigest: canonicalJsonDigest(fixture.demand),
    podId: IDS.pod,
    designRequest: {
      podDesignRequestId: IDS.designRequest,
      ref: requestIdentity.ref,
      digest: requestIdentity.digest,
    },
    demandAuthority: { ref: "demand-authority.json", digest: canonicalJsonDigest(authority) },
    preservesOriginalGoal: true,
    requirementRefs: request.requirementRefs,
    designIntent: "Land one bounded slice in the exact selected repository.",
    landingPlan: [{
      repositoryId: IDS.repository,
      responsibilityWindowId: IDS.responsibilityWindow,
      workScope: "Implement and verify the confirmed product slice.",
    }],
    testDecision: authority.testDecision,
    nonGoals: request.nonGoals,
    risks: ["The frozen base HEAD must be rechecked before materialization."],
    createdAt: HANDOFF_AT,
    ...overrides,
  };
}

function designHandoffInput(fixture, loaded, artifact) {
  return {
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    expectedPrevious: { revision: loaded.state.revision, stateDigest: loaded.digests.state },
    artifact,
    transition: {
      eventId: "event-pod-service-design-handoff-0008",
      createdAt: HANDOFF_AT,
      reason: "Record the exact portable Pod Design handoff",
      decisionSummary: "Authorize one complete repository landing set.",
    },
  };
}

function productPlanInput(fixture, overrides = {}) {
  return {
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    launchIntents: [productIntent()],
    transition: {
      eventId: "event-pod-service-products-0009",
      createdAt: PRODUCT_AT,
      reason: "Append the exact Design-authorized product members",
      decisionSummary: "Freeze one complete product launch intent set.",
    },
    ...overrides,
  };
}

async function prepareDesignHandoff(fixture) {
  const controlReady = await initializeAndBindControls(fixture);
  const request = designRequestArtifact(fixture);
  podService.recordPodDesignRequestArtifact(designRequestInput(fixture, controlReady, request));
  const authority = freezeFixtureAuthority(fixture);
  const designing = loadDemandCoreRecords({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
  const handoff = designHandoffArtifact(fixture, request, authority);
  const handoffInput = designHandoffInput(fixture, designing, handoff);
  podService.recordPodDesignHandoffArtifact(handoffInput);
  return {
    controlReady,
    request,
    authority,
    designing,
    handoff,
    handoffInput,
    loaded: loadDemandCoreRecords({
      stateRoot: fixture.stateRoot,
      expectedProgramId: IDS.program,
      ledgerRoot: fixture.ledgerRoot,
    }),
  };
}

function artifactTransitionJournal(previousState, event, nextState, artifact) {
  const identity = demandArtifactIdentity(artifact);
  return {
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
    artifactWrites: [{ ...identity, value: artifact }],
  };
}

function productTransitionJournal(plan) {
  return {
    schemaVersion: 1,
    artifactKind: "wakeflow-state-transition",
    demandId: IDS.demand,
    command: plan.event.command,
    createdAt: plan.event.createdAt,
    expectedPreviousRevision: plan.sourceState.revision,
    expectedPreviousStateDigest: plan.sourceStateDigest,
    previousState: plan.sourceState,
    nextEvent: plan.event,
    nextEventDigest: canonicalJsonDigest(plan.event),
    nextState: plan.nextState,
    nextStateDigest: canonicalJsonDigest(plan.nextState),
    artifactWrites: [],
  };
}

function podStateTransitionJournal(previousState, event, nextState) {
  return {
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
    artifactWrites: [],
  };
}

function appendEventFile(stateRoot, event) {
  const file = path.join(stateRoot, "controller-events.jsonl");
  writeFileSync(file, Buffer.concat([
    readFileSync(file),
    Buffer.from(`${canonicalJson(event)}\n`, "utf8"),
  ]), { mode: 0o600 });
}

function installExternalProductClaim(fixture, { actualCwd, gitCommonDir, head }) {
  const demandId = "demand_22000000-0000-4000-8000-000000000002";
  const podId = "pod_33000000-0000-4000-8000-000000000002";
  const confirmationId = "confirmation_44000000-0000-4000-8000-000000000012";
  const authorizationPath = "01-external-pod-authorization.md";
  const authorizationContent = "# External Pod placement authorization\n";
  const created = createLedgerRecord({
    ledgerRoot: fixture.ledgerRoot,
    expectedProgramId: IDS.program,
    record: {
      schemaVersion: 1,
      artifactKind: "wakeflow-confirmation-record",
      confirmationId,
      programId: IDS.program,
      demandId,
      title: "Authorize external isolated Pod placement",
      status: "confirmed",
      documents: [{
        role: "user-confirmation",
        path: authorizationPath,
        mediaType: "text/markdown",
        digest: `sha256:${createHash("sha256").update(authorizationContent).digest("hex")}`,
      }],
    },
    memberContents: { [authorizationPath]: authorizationContent },
  });
  const authorization = loadLedgerRecord({
    ledgerRoot: fixture.ledgerRoot,
    root: created.root,
    expectedFamily: "confirmation",
    expectedProgramId: IDS.program,
  });
  const authorizationRef = createLedgerMemberReference(authorization, authorizationPath);
  const demand = {
    ...fixture.demand,
    demandId,
    title: "External occupied product claim",
    source: {
      ...fixture.demand.source,
      todoId: "TODO-M4-T03-EXTERNAL-CLAIM",
      intakeRowDigest: `sha256:${"c".repeat(64)}`,
    },
    executionPlacement: { mode: "isolated", authorizationRef },
  };
  const event = initialEvent(demand);
  const product = {
    windowId: "window_56000000-0000-4000-8000-000000000004",
    launchOperationId: "pod-launch_77000000-0000-4000-8000-000000000104",
    bindingId: "binding_67000000-0000-4000-8000-000000000004",
    repositoryId: "repository_22222222-2222-4222-8222-222222222223",
    launchIntentDigest: `sha256:${"4".repeat(64)}`,
    materializationDigest: `sha256:${"5".repeat(64)}`,
    identityDigest: `sha256:${"6".repeat(64)}`,
  };
  const receipt = createPodCreationReceiptRecord({
    kind: WAKEFLOW_POD_CREATION_RECEIPT_KIND,
    schemaVersion: 1,
    programId: IDS.program,
    hostId: "codex",
    podId,
    demandId,
    windowId: product.windowId,
    launchOperationId: product.launchOperationId,
    bindingId: product.bindingId,
    launchIntentDigest: product.launchIntentDigest,
    materializationFinalEventDigest: product.materializationDigest,
    identityBindingDigest: product.identityDigest,
    resource: {
      kind: "git-worktree",
      actualCwd,
      gitTopLevel: actualCwd,
      gitCommonDir,
      head,
      branch: null,
      detached: true,
      mainCheckout: false,
    },
    verifiedAt: "2026-08-09T02:12:00.000Z",
  });
  const podRoot = `.wakeflow-local/runtime/hosts/codex/evidence/pods/${podId}`;
  const controlDefinitions = [
    ["controller", "window_56000000-0000-4000-8000-000000000001", "pod-launch_77000000-0000-4000-8000-000000000101", "binding_67000000-0000-4000-8000-000000000001"],
    ["design", "window_56000000-0000-4000-8000-000000000002", "pod-launch_77000000-0000-4000-8000-000000000102", "binding_67000000-0000-4000-8000-000000000002"],
    ["test", "window_56000000-0000-4000-8000-000000000003", "pod-launch_77000000-0000-4000-8000-000000000103", "binding_67000000-0000-4000-8000-000000000003"],
  ];
  const windows = controlDefinitions.map(([role, windowId, launchOperationId, bindingId], index) => ({
    windowId,
    role,
    launchOperationId,
    bindingId,
    launchIntent: {
      ref: `${podRoot}/launch-intents/${launchOperationId}.json`,
      digest: `sha256:${String(index + 1).repeat(64)}`,
    },
    status: "planned",
  }));
  windows.push({
    windowId: product.windowId,
    role: "product",
    repositoryId: product.repositoryId,
    launchOperationId: product.launchOperationId,
    bindingId: product.bindingId,
    launchIntent: {
      ref: `${podRoot}/launch-intents/${product.launchOperationId}.json`,
      digest: product.launchIntentDigest,
    },
    status: "bound",
    materializationFinalEvent: {
      eventId: "pod-materialization-event_79000000-0000-4000-8000-000000000104",
      ref: `${podRoot}/materialization/${product.launchOperationId}/events/`
        + "pod-materialization-event_79000000-0000-4000-8000-000000000104.json",
      digest: product.materializationDigest,
    },
    identityBindingDigest: product.identityDigest,
    creationReceipt: { ref: podRecordRef(receipt), digest: podRecordDigest(receipt) },
    resourceClaimStatus: "active",
  });
  const pod = {
    podId,
    hostId: "codex",
    placementAuthorizationDigest: canonicalJsonDigest(authorizationRef),
    scope: { ref: `${podRoot}/pod-scope.json`, digest: `sha256:${"7".repeat(64)}` },
    phase: "creating-control",
    windows,
  };
  const podEvent = validateControllerEventRecord({
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: "event-pod-external-claim-0002",
    demandId,
    createdAt: "2026-08-09T02:12:01.000Z",
    actor: "controller",
    command: "initialize-pod",
    type: "pod.initialized",
    previousRevision: 1,
    nextRevision: 2,
    from: "intake",
    to: "intake",
    reason: "Select the external occupied Pod claim fixture",
    decisionSummary: "Expose one exact active product resource claim.",
    changedArtifacts: [],
    podTransition: {
      podId,
      action: "initialize",
      previousPodDigest: null,
      nextPodDigest: canonicalJsonDigest(pod),
    },
  });
  const state = validateDemandStateRecord({
    ...initialState(demand, event),
    revision: 2,
    stateReason: podEvent.reason,
    updatedAt: podEvent.createdAt,
    lastEvent: {
      eventId: podEvent.eventId,
      eventDigest: canonicalJsonDigest(podEvent),
    },
    pod,
  });
  const stateRoot = ensurePrivateDirectory(
    fixture.workspaceRoot,
    `.wakeflow-active/current/${demandId}`,
  );
  for (const ref of [
    "task-packages",
    "target-results",
    "review-candidates",
    "test-cards",
    "evidence",
    "transactions",
    "pod/design-requests",
    "pod/design-handoffs",
  ]) ensurePrivateDirectory(stateRoot, ref);
  writeCanonical(path.join(stateRoot, "demand.json"), demand);
  writeCanonical(path.join(stateRoot, "wakeflow-state.json"), state);
  writeFileSync(
    path.join(stateRoot, "controller-events.jsonl"),
    `${canonicalJson(event)}\n${canonicalJson(podEvent)}\n`,
    { mode: 0o600 },
  );
  for (const ref of ["launch-intents", "materialization", "bindings", "test-access", "close"]) {
    ensurePrivateDirectory(fixture.workspaceRoot, `${podRoot}/${ref}`);
  }
  ensurePrivateDirectory(fixture.workspaceRoot, `${podRoot}/bindings/${product.windowId}`);
  writeFileSync(
    absoluteRef(fixture.workspaceRoot, podRecordRef(receipt)),
    podRecordCanonicalBytes(receipt),
    { mode: 0o600 },
  );
  return loadDemandCoreRecords({
    stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
}

test("M4-T05 exposes the admitted Pod lifecycle through close acknowledgement", () => {
  assert.deepEqual(Object.keys(podService).sort(), [
    "WakeflowPodServiceError",
    "applyPodLaunchInitializationPlan",
    "applyPodProductLaunchAppendPlan",
    "decommissionClosedPodWindowBinding",
    "inspectPodClose",
    "inspectPodCloseFromLoadedWhileLocked",
    "inspectPodEvidenceInventory",
    "inspectPodEvidenceInventoryForLayout",
    "inspectPodTestAccess",
    "inspectPodWindowMaterialization",
    "observePodCloseIntent",
    "observePodTestAccessPlan",
    "planPodLaunchInitialization",
    "planPodProductLaunchAppend",
    "planPodWindowMaterialization",
    "recordPodCloseIntent",
    "recordPodCloseReceipt",
    "recordPodCreationReceipt",
    "recordPodDesignHandoffArtifact",
    "recordPodDesignRequestArtifact",
    "recordPodMaterializationEvent",
    "recordPodTestAccessPlan",
    "recordPodTestAccessReceipt",
  ]);
});

function materializationInput(fixture, {
  windowId,
  attemptId,
  eventId,
  expectedPreviousEventDigest,
  status,
  observedAt,
  hostRequestId,
  failure,
  retryAuthorizationDigest,
}) {
  return {
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    windowId,
    attemptId,
    eventId,
    expectedPreviousEventDigest,
    status,
    observedAt,
    ...(hostRequestId === undefined ? {} : { hostRequestId }),
    ...(failure === undefined ? {} : { failure }),
    ...(retryAuthorizationDigest === undefined ? {} : { retryAuthorizationDigest }),
  };
}

async function initializeAndCreateControls(fixture) {
  const initialization = podService.planPodLaunchInitialization(planInput(fixture));
  await podService.applyPodLaunchInitializationPlan(applyInput(fixture, initialization));
  const controls = [
    {
      windowId: IDS.controllerWindow,
      attemptId: IDS.controllerAttempt,
      creatingId: IDS.controllerCreating,
      finalizedId: IDS.controllerFinalized,
      handle: "a1000000-0000-4000-8000-000000000001",
      minute: "03",
      label: "controller",
    },
    {
      windowId: IDS.designWindow,
      attemptId: IDS.designAttempt,
      creatingId: IDS.designCreating,
      finalizedId: IDS.designFinalized,
      handle: "a2000000-0000-4000-8000-000000000002",
      minute: "04",
      label: "design",
    },
    {
      windowId: IDS.testWindow,
      attemptId: IDS.testAttempt,
      creatingId: IDS.testCreating,
      finalizedId: IDS.testFinalized,
      handle: "a3000000-0000-4000-8000-000000000003",
      minute: "05",
      label: "test",
    },
  ];
  for (const [index, control] of controls.entries()) {
    const creating = await podService.recordPodMaterializationEvent(materializationInput(fixture, {
      windowId: control.windowId,
      attemptId: control.attemptId,
      eventId: control.creatingId,
      expectedPreviousEventDigest: null,
      status: "creating",
      observedAt: `2026-08-09T02:${control.minute}:00.000Z`,
    }));
    const finalized = await podService.recordPodMaterializationEvent(materializationInput(fixture, {
      windowId: control.windowId,
      attemptId: control.attemptId,
      eventId: control.finalizedId,
      expectedPreviousEventDigest: creating.materialization.tail.digest,
      status: "finalized",
      observedAt: `2026-08-09T02:${control.minute}:01.000Z`,
    }));
    const loaded = loadDemandCoreRecords({
      stateRoot: fixture.stateRoot,
      expectedProgramId: IDS.program,
      ledgerRoot: fixture.ledgerRoot,
    });
    await podService.recordPodCreationReceipt({
      workspaceRoot: fixture.workspaceRoot,
      stateRoot: fixture.stateRoot,
      expectedProgramId: IDS.program,
      windowId: control.windowId,
      expectedPrevious: { revision: loaded.state.revision, stateDigest: loaded.digests.state },
      expectedFinalEventDigest: finalized.materialization.tail.digest,
      handle: { kind: "codex-thread", value: control.handle },
      observation: {
        actualCwd: realpathSync.native(fixture.workspaceRoot),
        verifiedAt: `2026-08-09T02:${control.minute}:02.000Z`,
      },
      transition: {
        eventId: `event-pod-real-bind-${control.label}-000${index + 3}`,
        createdAt: `2026-08-09T02:${control.minute}:03.000Z`,
        reason: `Verify and bind the exact ${control.label} Pod creation`,
        decisionSummary: `Select the finalized ${control.label} identity and creation receipt.`,
      },
    });
  }
  return loadDemandCoreRecords({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
}

async function initializeExecutionReadyPod(fixture) {
  const repository = path.join(fixture.workspaceRoot, "ProductA");
  mkdirSync(repository, { mode: 0o700 });
  execFileSync("git", ["-C", repository, "init", "-b", "main"], { stdio: "ignore" });
  execFileSync("git", ["-C", repository, "config", "user.email", "wakeflow@example.invalid"]);
  execFileSync("git", ["-C", repository, "config", "user.name", "Wakeflow Test"]);
  writeFileSync(path.join(repository, "product.txt"), "base\n");
  execFileSync("git", ["-C", repository, "add", "product.txt"]);
  execFileSync("git", ["-C", repository, "commit", "-m", "base"], { stdio: "ignore" });
  const baseHead = execFileSync("git", ["-C", repository, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();

  const controls = await initializeAndCreateControls(fixture);
  const request = designRequestArtifact(fixture);
  podService.recordPodDesignRequestArtifact(designRequestInput(fixture, controls, request));
  const authority = freezeFixtureAuthority(fixture);
  let loaded = loadDemandCoreRecords({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
  const handoff = designHandoffArtifact(fixture, request, authority);
  podService.recordPodDesignHandoffArtifact(designHandoffInput(fixture, loaded, handoff));
  const productPlan = podService.planPodProductLaunchAppend(productPlanInput(fixture, {
    launchIntents: [productIntent({ expectedBaseHead: baseHead })],
  }));
  await podService.applyPodProductLaunchAppendPlan(applyInput(fixture, productPlan));
  const creating = await podService.recordPodMaterializationEvent(materializationInput(fixture, {
    windowId: IDS.productWindow,
    attemptId: IDS.productAttempt,
    eventId: IDS.productCreating,
    expectedPreviousEventDigest: null,
    status: "creating",
    observedAt: "2026-08-09T02:20:00.000Z",
  }));
  const finalized = await podService.recordPodMaterializationEvent(materializationInput(fixture, {
    windowId: IDS.productWindow,
    attemptId: IDS.productAttempt,
    eventId: IDS.productFinalized,
    expectedPreviousEventDigest: creating.materialization.tail.digest,
    status: "finalized",
    observedAt: "2026-08-09T02:20:01.000Z",
  }));
  const worktree = path.join(fixture.workspaceRoot, "PodProductA");
  execFileSync("git", ["-C", repository, "worktree", "add", "--detach", worktree, baseHead], {
    stdio: "ignore",
  });
  loaded = loadDemandCoreRecords({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
  await podService.recordPodCreationReceipt({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    windowId: IDS.productWindow,
    expectedPrevious: { revision: loaded.state.revision, stateDigest: loaded.digests.state },
    expectedFinalEventDigest: finalized.materialization.tail.digest,
    handle: { kind: "codex-thread", value: "a4000000-0000-4000-8000-000000000004" },
    observation: {
      actualCwd: realpathSync.native(worktree),
      verifiedAt: "2026-08-09T02:20:02.000Z",
    },
    transition: {
      eventId: "event-pod-test-fixture-product-bound-0010",
      createdAt: "2026-08-09T02:20:03.000Z",
      reason: "Verify and bind the product used by the Test access fixture",
      decisionSummary: "Close the exact product creation chain before probing access.",
    },
  });
  loaded = loadDemandCoreRecords({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
  assert.equal(loaded.state.pod.phase, "execution-ready");
  return {
    repository,
    worktree: realpathSync.native(worktree),
    baseHead,
    loaded,
  };
}

function testAccessPlanInput(fixture, loaded, probeId, overrides = {}) {
  return {
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    probeId,
    expectedPrevious: { revision: loaded.state.revision, stateDigest: loaded.digests.state },
    transition: {
      eventId: probeId === IDS.testProbe
        ? "event-pod-test-access-planned-0011"
        : probeId === IDS.testRetryProbe
          ? "event-pod-test-access-retry-0013"
          : "event-pod-test-access-third-0015",
      createdAt: probeId === IDS.testProbe
        ? "2026-08-09T02:21:00.000Z"
        : probeId === IDS.testRetryProbe
          ? "2026-08-09T02:23:00.000Z"
          : "2026-08-09T02:25:00.000Z",
      reason: "Freeze one exact independent Test multi-root probe",
      decisionSummary: "Select only the current Test identity and product creation receipts.",
    },
    ...overrides,
  };
}

function testAccessReceiptInput(fixture, loaded, observation, eventOrdinal, createdAt) {
  return {
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    probeId: observation.probeId,
    expectedPrevious: { revision: loaded.state.revision, stateDigest: loaded.digests.state },
    observation,
    transition: {
      eventId: `event-pod-test-access-recorded-${eventOrdinal}`,
      createdAt,
      reason: "Record the exact redacted Test access observation",
      decisionSummary: "Derive the access gate from current identity and Git evidence.",
    },
  };
}

function currentPodStack(fixture) {
  return loadDemandCoreRecords({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
}

function terminalizePodDemand(fixture, terminal = "completed") {
  const loaded = currentPodStack(fixture);
  const createdAt = "2026-08-09T03:00:00.000Z";
  const event = validateControllerEventRecord({
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: terminal === "completed"
      ? "event-pod-close-terminal-completed-0100"
      : "event-pod-close-terminal-cancelled-0100",
    demandId: IDS.demand,
    createdAt,
    actor: "controller",
    command: terminal === "completed" ? "complete-demand" : "cancel-demand",
    type: `demand.${terminal}`,
    previousRevision: loaded.state.revision,
    nextRevision: loaded.state.revision + 1,
    from: loaded.state.state,
    to: terminal,
    reason: `Select the exact ${terminal} demand before Pod teardown`,
    decisionSummary: "Demand lifecycle settles before any Pod close evidence is admitted.",
    changedArtifacts: [],
    lifecycleTransition: { action: terminal === "completed" ? "complete" : "cancel" },
  });
  const nextState = validateDemandStateRecord({
    ...loaded.state,
    revision: event.nextRevision,
    state: terminal,
    stateReason: event.reason,
    updatedAt: event.createdAt,
    lastEvent: { eventId: event.eventId, eventDigest: canonicalJsonDigest(event) },
  });
  withStateRootLock(fixture.stateRoot, () => commitDemandLifecycleTransitionWhileLocked({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    expectedPrevious: { revision: loaded.state.revision, stateDigest: loaded.digests.state },
    event,
    nextState,
  }));
  return currentPodStack(fixture);
}

function closeIntentInput(fixture, loaded, windowId, closeOperationId, ordinal) {
  return {
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    windowId,
    closeOperationId,
    expectedPrevious: { revision: loaded.state.revision, stateDigest: loaded.digests.state },
    transition: {
      eventId: `event-pod-close-intent-${String(ordinal).padStart(4, "0")}`,
      createdAt: `2026-08-09T03:${String(ordinal).padStart(2, "0")}:00.000Z`,
      reason: `Freeze exact Pod close intent ${ordinal}`,
      decisionSummary: "Select one state member before any physical host close is observed.",
    },
  };
}

function closeReceiptInput(
  fixture,
  loaded,
  planned,
  ordinal,
  { observationKind = "unmaterialized-not-found", worktreeStatus = "not-applicable" } = {},
) {
  const confirmedAt = `2026-08-09T03:${String(ordinal).padStart(2, "0")}:01.000Z`;
  const member = loaded.state.pod.windows.find((entry) => entry.windowId === planned.windowId);
  const observation = observationKind === "codex-archive"
    ? {
        kind: "host-result",
        hostResult: createHostDecommissionResult({
          programId: IDS.program,
          hostId: "codex",
          windowId: planned.windowId,
          binding: {
            bindingId: member.bindingId,
            digest: member.identityBindingDigest,
          },
          subjectDigest: planned.intent.digest,
          status: "manual-host-gate",
          hostAction: { kind: "archive", status: "succeeded" },
          session: {
            status: "archived",
            proof: "archive-observed",
            postCloseAttempts: 0,
          },
          locator: null,
          routingRevocation: "pending-state-acknowledgement",
          locatorDisposition: "not-applicable",
          manualAction: {
            required: true,
            action: "stop-or-archive-window-and-confirm",
            acknowledgement: "machine-cannot-prove-future-inactivity",
          },
          reasonCode: "codex-archive-observed-not-termination-proof",
          observedAt: confirmedAt,
        }),
        worktreeStatus,
      }
    : {
        kind: "unmaterialized-not-found",
        worktreeStatus,
        confirmedAt,
      };
  return {
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    windowId: planned.windowId,
    closeOperationId: planned.closeOperationId,
    expectedIntentDigest: planned.intent.digest,
    expectedPrevious: { revision: loaded.state.revision, stateDigest: loaded.digests.state },
    observation,
    transition: {
      eventId: `event-pod-close-receipt-${String(ordinal).padStart(4, "0")}`,
      createdAt: `2026-08-09T03:${String(ordinal).padStart(2, "0")}:02.000Z`,
      reason: `Record exact Pod close receipt ${ordinal}`,
      decisionSummary: "Acknowledge only an exact host proof result or a never-materialized absence.",
    },
  };
}

test("T03 keeps one strict append-only materialization chain and redacts transient host IDs", async (t) => {
  const fixture = createFixture(t);
  const initialization = podService.planPodLaunchInitialization(planInput(fixture));
  await podService.applyPodLaunchInitializationPlan(applyInput(fixture, initialization));

  const initial = podService.inspectPodWindowMaterialization({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    windowId: IDS.controllerWindow,
  });
  assert.equal(initial.status, "empty");
  assert.equal(podService.planPodWindowMaterialization({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    windowId: IDS.controllerWindow,
  }).mode, "record-creating");

  const creating = await podService.recordPodMaterializationEvent(materializationInput(fixture, {
    windowId: IDS.controllerWindow,
    attemptId: IDS.controllerAttempt,
    eventId: IDS.controllerCreating,
    expectedPreviousEventDigest: null,
    status: "creating",
    observedAt: "2026-08-09T02:01:00.000Z",
  }));
  assert.equal(creating.status, "recorded");
  assert.equal(creating.materialization.status, "creating");
  assert.equal(podService.planPodWindowMaterialization({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    windowId: IDS.controllerWindow,
  }).mode, "host-create");

  const rawRequestId = "client-thread-id-must-never-persist";
  const pending = await podService.recordPodMaterializationEvent(materializationInput(fixture, {
    windowId: IDS.controllerWindow,
    attemptId: IDS.controllerAttempt,
    eventId: IDS.controllerPending,
    expectedPreviousEventDigest: creating.materialization.tail.digest,
    status: "pending",
    observedAt: "2026-08-09T02:01:01.000Z",
    hostRequestId: rawRequestId,
  }));
  assert.equal(pending.materialization.status, "pending");
  assert.equal(JSON.stringify(pending).includes(rawRequestId), false);
  assert.equal(
    readFileSync(absoluteRef(fixture.workspaceRoot, pending.materialization.tail.ref), "utf8").includes(rawRequestId),
    false,
  );
  assert.equal(podService.planPodWindowMaterialization({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    windowId: IDS.controllerWindow,
  }).mode, "host-recovery");

  const finalized = await podService.recordPodMaterializationEvent(materializationInput(fixture, {
    windowId: IDS.controllerWindow,
    attemptId: IDS.controllerAttempt,
    eventId: IDS.controllerFinalized,
    expectedPreviousEventDigest: pending.materialization.tail.digest,
    status: "finalized",
    observedAt: "2026-08-09T02:01:02.000Z",
  }));
  assert.equal(finalized.materialization.status, "finalized");
  assert.equal(finalized.materialization.eventCount, 3);
  assert.equal(podService.planPodWindowMaterialization({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    windowId: IDS.controllerWindow,
  }).mode, "record-creation");

  const eventDirectory = path.dirname(absoluteRef(fixture.workspaceRoot, finalized.materialization.tail.ref));
  const before = readdirSync(eventDirectory).sort();
  await assert.rejects(
    () => podService.recordPodMaterializationEvent(materializationInput(fixture, {
      windowId: IDS.controllerWindow,
      attemptId: IDS.controllerAttempt,
      eventId: "pod-materialization-event_79000000-0000-4000-8000-000000000010",
      expectedPreviousEventDigest: creating.materialization.tail.digest,
      status: "failed",
      observedAt: "2026-08-09T02:01:03.000Z",
      failure: { code: "host-create-failed", detail: "private transient failure" },
    })),
    /finalized|previous|terminal|chain|materialization/iu,
  );
  assert.deepEqual(readdirSync(eventDirectory).sort(), before);
});

test("T03 preserves failed attempts and requires an authorized fresh attempt", async (t) => {
  const fixture = createFixture(t);
  const initialization = podService.planPodLaunchInitialization(planInput(fixture));
  await podService.applyPodLaunchInitializationPlan(applyInput(fixture, initialization));
  const creating = await podService.recordPodMaterializationEvent(materializationInput(fixture, {
    windowId: IDS.designWindow,
    attemptId: IDS.designAttempt,
    eventId: IDS.designCreating,
    expectedPreviousEventDigest: null,
    status: "creating",
    observedAt: "2026-08-09T02:02:00.000Z",
  }));
  const failed = await podService.recordPodMaterializationEvent(materializationInput(fixture, {
    windowId: IDS.designWindow,
    attemptId: IDS.designAttempt,
    eventId: IDS.designFailed,
    expectedPreviousEventDigest: creating.materialization.tail.digest,
    status: "failed",
    observedAt: "2026-08-09T02:02:01.000Z",
    failure: { code: "host-create-failed", detail: "redacted-at-core" },
  }));
  await assert.rejects(
    () => podService.recordPodMaterializationEvent(materializationInput(fixture, {
      windowId: IDS.designWindow,
      attemptId: IDS.designRetryAttempt,
      eventId: IDS.designRetryCreating,
      expectedPreviousEventDigest: failed.materialization.tail.digest,
      status: "creating",
      observedAt: "2026-08-09T02:02:02.000Z",
    })),
    /retry|authorization|materialization/iu,
  );
  const retry = await podService.recordPodMaterializationEvent(materializationInput(fixture, {
    windowId: IDS.designWindow,
    attemptId: IDS.designRetryAttempt,
    eventId: IDS.designRetryCreating,
    expectedPreviousEventDigest: failed.materialization.tail.digest,
    status: "creating",
    observedAt: "2026-08-09T02:02:02.000Z",
    retryAuthorizationDigest: `sha256:${"9".repeat(64)}`,
  }));
  const finalized = await podService.recordPodMaterializationEvent(materializationInput(fixture, {
    windowId: IDS.designWindow,
    attemptId: IDS.designRetryAttempt,
    eventId: IDS.designFinalized,
    expectedPreviousEventDigest: retry.materialization.tail.digest,
    status: "finalized",
    observedAt: "2026-08-09T02:02:03.000Z",
  }));
  assert.equal(finalized.materialization.attemptCount, 2);
  assert.equal(finalized.materialization.eventCount, 4);
  assert.deepEqual(finalized.materialization.attempts.map((entry) => entry.status), ["failed", "finalized"]);
});

test("T03 registers only a finalized Pod identity, creates the core receipt, then binds state", async (t) => {
  const fixture = createFixture(t);
  const initialization = podService.planPodLaunchInitialization(planInput(fixture));
  await podService.applyPodLaunchInitializationPlan(applyInput(fixture, initialization));
  let loaded = loadDemandCoreRecords({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
  const rawHandle = "a1000000-0000-4000-8000-000000000001";
  const transition = {
    eventId: "event-pod-bind-controller-0003",
    createdAt: "2026-08-09T02:03:03.000Z",
    reason: "Finalized controller creation was verified",
    decisionSummary: "Bind the exact preauthorized controller identity and receipt.",
  };
  await assert.rejects(
    () => podService.recordPodCreationReceipt({
      workspaceRoot: fixture.workspaceRoot,
      stateRoot: fixture.stateRoot,
      expectedProgramId: IDS.program,
      windowId: IDS.controllerWindow,
      expectedPrevious: { revision: loaded.state.revision, stateDigest: loaded.digests.state },
      expectedFinalEventDigest: `sha256:${"f".repeat(64)}`,
      handle: { kind: "codex-thread", value: rawHandle },
      observation: {
        actualCwd: realpathSync.native(fixture.workspaceRoot),
        verifiedAt: "2026-08-09T02:03:02.000Z",
      },
      transition,
    }),
    /finalized|materialization|chain/iu,
  );
  const creating = await podService.recordPodMaterializationEvent(materializationInput(fixture, {
    windowId: IDS.controllerWindow,
    attemptId: IDS.controllerAttempt,
    eventId: IDS.controllerCreating,
    expectedPreviousEventDigest: null,
    status: "creating",
    observedAt: "2026-08-09T02:03:00.000Z",
  }));
  const finalized = await podService.recordPodMaterializationEvent(materializationInput(fixture, {
    windowId: IDS.controllerWindow,
    attemptId: IDS.controllerAttempt,
    eventId: IDS.controllerFinalized,
    expectedPreviousEventDigest: creating.materialization.tail.digest,
    status: "finalized",
    observedAt: "2026-08-09T02:03:01.000Z",
  }));
  loaded = loadDemandCoreRecords({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
  const input = {
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    windowId: IDS.controllerWindow,
    expectedPrevious: { revision: loaded.state.revision, stateDigest: loaded.digests.state },
    expectedFinalEventDigest: finalized.materialization.tail.digest,
    handle: { kind: "codex-thread", value: rawHandle },
    observation: {
      actualCwd: realpathSync.native(fixture.workspaceRoot),
      verifiedAt: "2026-08-09T02:03:02.000Z",
    },
    transition,
  };
  const recorded = await podService.recordPodCreationReceipt(input);
  assert.equal(recorded.status, "bound");
  assert.equal(JSON.stringify(recorded).includes(rawHandle), false);
  loaded = loadDemandCoreRecords({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
  const member = loaded.state.pod.windows.find((entry) => entry.windowId === IDS.controllerWindow);
  assert.equal(member.status, "bound");
  assert.equal(member.bindingId, IDS.controllerBinding);
  assert.equal(member.materializationFinalEvent.digest, finalized.materialization.tail.digest);
  assert.equal(loaded.state.pod.phase, "creating-control");
  const receiptBytes = readFileSync(absoluteRef(fixture.workspaceRoot, member.creationReceipt.ref), "utf8");
  assert.equal(receiptBytes.includes(rawHandle), false);
  const bindingFile = absoluteRef(
    fixture.workspaceRoot,
    `.wakeflow-local/runtime/hosts/codex/identity/window-bindings/${IDS.controllerWindow}.json`,
  );
  assert.equal(JSON.parse(readFileSync(bindingFile, "utf8")).handle.value, rawHandle);
  const beforeReplay = readFileSync(path.join(fixture.stateRoot, "wakeflow-state.json"));
  assert.equal((await podService.recordPodCreationReceipt(input)).status, "replayed");
  assert.deepEqual(readFileSync(path.join(fixture.stateRoot, "wakeflow-state.json")), beforeReplay);
  await assert.rejects(
    () => podService.recordPodCreationReceipt({
      ...input,
      handle: { kind: "codex-thread", value: "afffffff-ffff-4fff-8fff-ffffffffffff" },
    }),
    /handle|identity|conflict/iu,
  );
  assert.equal(
    existsSync(path.join(fixture.workspaceRoot, ".wakeflow-local/runtime/maintenance.lock")),
    false,
  );
});

test("T03 creation receipt forward-recovers every state journal boundary", async (t) => {
  for (const boundary of ["journal-only", "event-written", "state-written"]) {
    await t.test(boundary, async (t) => {
      const fixture = createFixture(t);
      const initialization = podService.planPodLaunchInitialization(planInput(fixture));
      await podService.applyPodLaunchInitializationPlan(applyInput(fixture, initialization));
      const creating = await podService.recordPodMaterializationEvent(materializationInput(fixture, {
        windowId: IDS.controllerWindow,
        attemptId: IDS.controllerAttempt,
        eventId: IDS.controllerCreating,
        expectedPreviousEventDigest: null,
        status: "creating",
        observedAt: "2026-08-09T02:06:00.000Z",
      }));
      const finalized = await podService.recordPodMaterializationEvent(materializationInput(fixture, {
        windowId: IDS.controllerWindow,
        attemptId: IDS.controllerAttempt,
        eventId: IDS.controllerFinalized,
        expectedPreviousEventDigest: creating.materialization.tail.digest,
        status: "finalized",
        observedAt: "2026-08-09T02:06:01.000Z",
      }));
      const previous = loadDemandCoreRecords({
        stateRoot: fixture.stateRoot,
        expectedProgramId: IDS.program,
        ledgerRoot: fixture.ledgerRoot,
      });
      const input = {
        workspaceRoot: fixture.workspaceRoot,
        stateRoot: fixture.stateRoot,
        expectedProgramId: IDS.program,
        windowId: IDS.controllerWindow,
        expectedPrevious: { revision: previous.state.revision, stateDigest: previous.digests.state },
        expectedFinalEventDigest: finalized.materialization.tail.digest,
        handle: { kind: "codex-thread", value: "a6000000-0000-4000-8000-000000000006" },
        observation: {
          actualCwd: realpathSync.native(fixture.workspaceRoot),
          verifiedAt: "2026-08-09T02:06:02.000Z",
        },
        transition: {
          eventId: "event-pod-bind-controller-recovery-0003",
          createdAt: "2026-08-09T02:06:03.000Z",
          reason: "Recover the exact finalized controller creation",
          decisionSummary: "Forward-replay only the admitted identity and receipt transition.",
        },
      };
      await podService.recordPodCreationReceipt(input);
      const committed = loadDemandCoreRecords({
        stateRoot: fixture.stateRoot,
        expectedProgramId: IDS.program,
        ledgerRoot: fixture.ledgerRoot,
      });
      const event = committed.events.at(-1);
      const journal = podStateTransitionJournal(previous.state, event, committed.state);
      writeFileSync(
        path.join(fixture.stateRoot, "controller-events.jsonl"),
        `${previous.events.map((entry) => canonicalJson(entry)).join("\n")}\n`,
        { mode: 0o600 },
      );
      writeCanonical(path.join(fixture.stateRoot, "wakeflow-state.json"), previous.state);
      writeCanonical(path.join(fixture.stateRoot, "transactions/state-transition.json"), journal);
      if (["event-written", "state-written"].includes(boundary)) appendEventFile(fixture.stateRoot, event);
      if (boundary === "state-written") {
        writeCanonical(path.join(fixture.stateRoot, "wakeflow-state.json"), committed.state);
      }
      const recovered = await podService.recordPodCreationReceipt(input);
      assert.equal(recovered.status, "recovered");
      assert.deepEqual(readdirSync(path.join(fixture.stateRoot, "transactions")), []);
      const closed = loadDemandCoreRecords({
        stateRoot: fixture.stateRoot,
        expectedProgramId: IDS.program,
        ledgerRoot: fixture.ledgerRoot,
      });
      assert.equal(closed.digests.state, committed.digests.state);
    });
  }
});

test("T03 state-selected bound evidence must close materialization, receipt, and identity", async (t) => {
  const fixture = createFixture(t);
  const loaded = await initializeAndCreateControls(fixture);
  const controller = loaded.state.pod.windows.find((entry) => entry.windowId === IDS.controllerWindow);
  unlinkSync(absoluteRef(fixture.workspaceRoot, controller.creationReceipt.ref));
  assert.throws(
    () => podService.inspectPodWindowMaterialization({
      workspaceRoot: fixture.workspaceRoot,
      stateRoot: fixture.stateRoot,
      expectedProgramId: IDS.program,
      windowId: IDS.designWindow,
    }),
    /authority|receipt|evidence|damaged/iu,
  );
});

test("T03 re-probes one non-main product worktree and activates it only after receipt commit", async (t) => {
  const fixture = createFixture(t);
  const repository = path.join(fixture.workspaceRoot, "ProductA");
  mkdirSync(repository, { mode: 0o700 });
  execFileSync("git", ["-C", repository, "init", "-b", "main"], { stdio: "ignore" });
  execFileSync("git", ["-C", repository, "config", "user.email", "wakeflow@example.invalid"]);
  execFileSync("git", ["-C", repository, "config", "user.name", "Wakeflow Test"]);
  writeFileSync(path.join(repository, "product.txt"), "base\n");
  execFileSync("git", ["-C", repository, "add", "product.txt"]);
  execFileSync("git", ["-C", repository, "commit", "-m", "base"], { stdio: "ignore" });
  const head = execFileSync("git", ["-C", repository, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();

  const controlReady = await initializeAndCreateControls(fixture);
  assert.equal(controlReady.state.pod.phase, "control-ready");
  const request = designRequestArtifact(fixture);
  podService.recordPodDesignRequestArtifact(designRequestInput(fixture, controlReady, request));
  const authorityRecord = freezeFixtureAuthority(fixture);
  let loaded = loadDemandCoreRecords({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
  const handoff = designHandoffArtifact(fixture, request, authorityRecord);
  podService.recordPodDesignHandoffArtifact(designHandoffInput(fixture, loaded, handoff));
  const productPlan = podService.planPodProductLaunchAppend(productPlanInput(fixture, {
    launchIntents: [productIntent({ expectedBaseHead: head })],
  }));
  await podService.applyPodProductLaunchAppendPlan(applyInput(fixture, productPlan));
  const hostPlan = podService.planPodWindowMaterialization({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    windowId: IDS.productWindow,
  });
  assert.equal(hostPlan.mode, "record-creating");
  assert.equal(hostPlan.operation.repositoryRoot, realpathSync.native(repository));
  assert.equal(hostPlan.operation.expectedBaseHead, head);

  const creating = await podService.recordPodMaterializationEvent(materializationInput(fixture, {
    windowId: IDS.productWindow,
    attemptId: IDS.productAttempt,
    eventId: IDS.productCreating,
    expectedPreviousEventDigest: null,
    status: "creating",
    observedAt: "2026-08-09T02:11:00.000Z",
  }));
  const finalized = await podService.recordPodMaterializationEvent(materializationInput(fixture, {
    windowId: IDS.productWindow,
    attemptId: IDS.productAttempt,
    eventId: IDS.productFinalized,
    expectedPreviousEventDigest: creating.materialization.tail.digest,
    status: "finalized",
    observedAt: "2026-08-09T02:11:01.000Z",
  }));
  const worktree = path.join(fixture.workspaceRoot, "PodProductA");
  execFileSync("git", ["-C", repository, "worktree", "add", "--detach", worktree, head], {
    stdio: "ignore",
  });
  loaded = loadDemandCoreRecords({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
  const receiptInput = {
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    windowId: IDS.productWindow,
    expectedPrevious: { revision: loaded.state.revision, stateDigest: loaded.digests.state },
    expectedFinalEventDigest: finalized.materialization.tail.digest,
    handle: { kind: "codex-thread", value: "a4000000-0000-4000-8000-000000000004" },
    observation: {
      actualCwd: realpathSync.native(repository),
      verifiedAt: "2026-08-09T02:11:02.000Z",
    },
    transition: {
      eventId: "event-pod-real-bind-product-0010",
      createdAt: "2026-08-09T02:11:03.000Z",
      reason: "Verify and bind the exact product Pod creation",
      decisionSummary: "Activate only the non-main worktree at the frozen base HEAD.",
    },
  };
  await assert.rejects(
    () => podService.recordPodCreationReceipt(receiptInput),
    /non-main|worktree|creation|resource/iu,
  );
  const identityFile = absoluteRef(
    fixture.workspaceRoot,
    `.wakeflow-local/runtime/hosts/codex/identity/window-bindings/${IDS.productWindow}.json`,
  );
  assert.equal(existsSync(identityFile), true, "exact identity prefix is recoverable after probe failure");
  const result = await podService.recordPodCreationReceipt({
    ...receiptInput,
    observation: {
      ...receiptInput.observation,
      actualCwd: realpathSync.native(worktree),
    },
  });
  assert.equal(result.status, "bound");
  loaded = loadDemandCoreRecords({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
  const product = loaded.state.pod.windows.find((entry) => entry.windowId === IDS.productWindow);
  assert.equal(product.status, "bound");
  assert.equal(product.resourceClaimStatus, "active");
  assert.equal(loaded.state.pod.phase, "execution-ready");
  const receipt = JSON.parse(readFileSync(absoluteRef(fixture.workspaceRoot, product.creationReceipt.ref), "utf8"));
  assert.equal(receipt.resource.kind, "git-worktree");
  assert.equal(receipt.resource.actualCwd, realpathSync.native(worktree));
  assert.equal(receipt.resource.gitCommonDir, realpathSync.native(path.join(repository, ".git")));
  assert.equal(receipt.resource.head, head);
  assert.equal(podService.planPodWindowMaterialization({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    windowId: IDS.productWindow,
  }).mode, "bound");
});

test("T03 rejects a worktree occupied by another current Pod before identity registration", async (t) => {
  const fixture = createFixture(t);
  const repository = path.join(fixture.workspaceRoot, "ProductA");
  mkdirSync(repository, { mode: 0o700 });
  execFileSync("git", ["-C", repository, "init", "-b", "main"], { stdio: "ignore" });
  execFileSync("git", ["-C", repository, "config", "user.email", "wakeflow@example.invalid"]);
  execFileSync("git", ["-C", repository, "config", "user.name", "Wakeflow Test"]);
  writeFileSync(path.join(repository, "product.txt"), "base\n");
  execFileSync("git", ["-C", repository, "add", "product.txt"]);
  execFileSync("git", ["-C", repository, "commit", "-m", "base"], { stdio: "ignore" });
  const head = execFileSync("git", ["-C", repository, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const controls = await initializeAndCreateControls(fixture);
  const request = designRequestArtifact(fixture);
  podService.recordPodDesignRequestArtifact(designRequestInput(fixture, controls, request));
  const authority = freezeFixtureAuthority(fixture);
  let loaded = loadDemandCoreRecords({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
  const handoff = designHandoffArtifact(fixture, request, authority);
  podService.recordPodDesignHandoffArtifact(designHandoffInput(fixture, loaded, handoff));
  const productPlan = podService.planPodProductLaunchAppend(productPlanInput(fixture, {
    launchIntents: [productIntent({ expectedBaseHead: head })],
  }));
  await podService.applyPodProductLaunchAppendPlan(applyInput(fixture, productPlan));
  const creating = await podService.recordPodMaterializationEvent(materializationInput(fixture, {
    windowId: IDS.productWindow,
    attemptId: IDS.productAttempt,
    eventId: IDS.productCreating,
    expectedPreviousEventDigest: null,
    status: "creating",
    observedAt: "2026-08-09T02:13:00.000Z",
  }));
  const finalized = await podService.recordPodMaterializationEvent(materializationInput(fixture, {
    windowId: IDS.productWindow,
    attemptId: IDS.productAttempt,
    eventId: IDS.productFinalized,
    expectedPreviousEventDigest: creating.materialization.tail.digest,
    status: "finalized",
    observedAt: "2026-08-09T02:13:01.000Z",
  }));
  const worktree = path.join(fixture.workspaceRoot, "PodProductA");
  execFileSync("git", ["-C", repository, "worktree", "add", "--detach", worktree, head], {
    stdio: "ignore",
  });
  const actualCwd = realpathSync.native(worktree);
  installExternalProductClaim(fixture, {
    actualCwd,
    gitCommonDir: realpathSync.native(path.join(repository, ".git")),
    head,
  });
  loaded = loadDemandCoreRecords({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
  await assert.rejects(
    () => podService.recordPodCreationReceipt({
      workspaceRoot: fixture.workspaceRoot,
      stateRoot: fixture.stateRoot,
      expectedProgramId: IDS.program,
      windowId: IDS.productWindow,
      expectedPrevious: { revision: loaded.state.revision, stateDigest: loaded.digests.state },
      expectedFinalEventDigest: finalized.materialization.tail.digest,
      handle: { kind: "codex-thread", value: "a5000000-0000-4000-8000-000000000005" },
      observation: {
        actualCwd,
        verifiedAt: "2026-08-09T02:13:02.000Z",
      },
      transition: {
        eventId: "event-pod-bind-product-conflict-0010",
        createdAt: "2026-08-09T02:13:03.000Z",
        reason: "Reject an already occupied product resource",
        decisionSummary: "Do not register identity for a conflicting current Pod claim.",
      },
    }),
    /occupied|resource|claim|conflict/iu,
  );
  assert.equal(existsSync(absoluteRef(
    fixture.workspaceRoot,
    `.wakeflow-local/runtime/hosts/codex/identity/window-bindings/${IDS.productWindow}.json`,
  )), false);
  const unchanged = loadDemandCoreRecords({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
  assert.equal(
    unchanged.state.pod.windows.find((entry) => entry.windowId === IDS.productWindow).status,
    "planned",
  );
});

test("T04 freezes one private-root plan, accepts a changed product HEAD, and closes live preflight", async (t) => {
  const fixture = createFixture(t);
  const ready = await initializeExecutionReadyPod(fixture);
  const planned = await podService.recordPodTestAccessPlan(testAccessPlanInput(
    fixture,
    ready.loaded,
    IDS.testProbe,
  ));
  assert.equal(planned.status, "planned");
  assert.equal(planned.testAccessStatus, "pending");
  assert.equal(canonicalJson(planned).includes(ready.worktree), false);
  const planFile = absoluteRef(fixture.workspaceRoot, planned.plan.ref);
  const plan = JSON.parse(readFileSync(planFile, "utf8"));
  assert.equal(plan.targets[0].actualRoot, ready.worktree);
  assert.equal(Object.hasOwn(plan.targets[0], "expectedHead"), false);

  writeFileSync(path.join(ready.worktree, "product.txt"), "base\nimplementation\n");
  execFileSync("git", ["-C", ready.worktree, "add", "product.txt"]);
  execFileSync("git", ["-C", ready.worktree, "commit", "-m", "implementation"], {
    stdio: "ignore",
  });
  const implementationHead = execFileSync("git", ["-C", ready.worktree, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  assert.notEqual(implementationHead, ready.baseHead);

  const observation = podService.observePodTestAccessPlan({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    probeId: IDS.testProbe,
    expectedPlanDigest: planned.plan.digest,
    observedAt: "2026-08-09T02:21:01.000Z",
  });
  assert.equal(observation.targetObservations[0].currentHead, implementationHead);
  assert.equal(canonicalJson(observation).includes(ready.worktree), false);
  let loaded = loadDemandCoreRecords({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
  const receiptInput = testAccessReceiptInput(
    fixture,
    loaded,
    observation,
    "0012",
    "2026-08-09T02:21:02.000Z",
  );
  const receipt = createPodTestAccessReceiptRecord({
    kind: WAKEFLOW_POD_TEST_ACCESS_RECEIPT_KIND,
    schemaVersion: 1,
    programId: observation.programId,
    hostId: observation.hostId,
    podId: observation.podId,
    demandId: observation.demandId,
    probeId: observation.probeId,
    planDigest: observation.planDigest,
    bindingSetDigest: observation.bindingSetDigest,
    observerBindingId: observation.observerBindingId,
    observerIdentityBindingDigest: observation.observerIdentityBindingDigest,
    status: "validated",
    capability: "direct-multi-root",
    targetObservations: observation.targetObservations,
    observedAt: observation.observedAt,
    recordedAt: receiptInput.transition.createdAt,
  });
  const receiptFile = absoluteRef(fixture.workspaceRoot, podRecordRef(receipt));
  writeFileSync(receiptFile, podRecordCanonicalBytes(receipt), { mode: 0o600 });
  const recorded = await podService.recordPodTestAccessReceipt(receiptInput);
  assert.equal(recorded.status, "recorded");
  assert.equal(recorded.outcome, "validated");
  assert.deepEqual(readFileSync(receiptFile), podRecordCanonicalBytes(receipt));
  assert.equal(readFileSync(receiptFile, "utf8").includes(ready.worktree), false);
  const current = podService.inspectPodTestAccess({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
  });
  assert.equal(current.status, "validated");
  assert.equal(current.authorityEligible, true);
  assert.deepEqual(current.blockingReasons, []);

  unlinkSync(receiptFile);
  const damaged = podService.inspectPodTestAccess({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
  });
  assert.equal(damaged.authorityEligible, false);
  assert.equal(damaged.blockingReasons.length > 0, true);
  assert.equal(canonicalJson(damaged).includes(ready.worktree), false);
  await assert.rejects(
    () => podService.recordPodTestAccessReceipt(receiptInput),
    /authority|receipt|evidence|missing|damaged/iu,
  );
  assert.equal(existsSync(receiptFile), false, "ordinary replay must not refill state-linked evidence");
  loaded = loadDemandCoreRecords({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
  assert.equal(loaded.state.pod.testAccess.status, "validated");
});

test("T04 preserves a blocked attempt and requires a fresh explicit retry probe", async (t) => {
  const fixture = createFixture(t);
  const ready = await initializeExecutionReadyPod(fixture);
  const first = await podService.recordPodTestAccessPlan(testAccessPlanInput(
    fixture,
    ready.loaded,
    IDS.testProbe,
  ));
  const firstObservation = podService.observePodTestAccessPlan({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    probeId: IDS.testProbe,
    expectedPlanDigest: first.plan.digest,
    observedAt: "2026-08-09T02:21:01.000Z",
  });
  const unsupported = {
    ...firstObservation,
    targetObservations: [],
    failureCode: "capability-unsupported",
  };
  let loaded = loadDemandCoreRecords({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
  const blocked = await podService.recordPodTestAccessReceipt(testAccessReceiptInput(
    fixture,
    loaded,
    unsupported,
    "0012",
    "2026-08-09T02:21:02.000Z",
  ));
  assert.equal(blocked.outcome, "blocked");
  assert.equal(blocked.reasonCode, "capability-unsupported");
  loaded = loadDemandCoreRecords({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
  assert.equal(loaded.state.pod.phase, "blocked");
  assert.equal(loaded.state.pod.testAccess.attempt, 1);

  const retry = await podService.recordPodTestAccessPlan(testAccessPlanInput(
    fixture,
    loaded,
    IDS.testRetryProbe,
  ));
  assert.equal(retry.status, "planned");
  assert.equal(retry.attempt, 2);
  assert.equal(retry.previousProbeId, IDS.testProbe);
  assert.equal(existsSync(absoluteRef(fixture.workspaceRoot, first.plan.ref)), true);
  assert.equal(existsSync(absoluteRef(fixture.workspaceRoot, blocked.receipt.ref)), true);
  loaded = loadDemandCoreRecords({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
  assert.equal(loaded.state.pod.phase, "retryable");
  assert.equal(loaded.state.pod.testAccess.status, "pending");
  assert.equal(loaded.state.pod.testAccess.previousProbeId, IDS.testProbe);

  const retryObservation = podService.observePodTestAccessPlan({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    probeId: IDS.testRetryProbe,
    expectedPlanDigest: retry.plan.digest,
    observedAt: "2026-08-09T02:23:01.000Z",
  });
  const settled = await podService.recordPodTestAccessReceipt(testAccessReceiptInput(
    fixture,
    loaded,
    retryObservation,
    "0014",
    "2026-08-09T02:23:02.000Z",
  ));
  assert.equal(settled.outcome, "validated");
  loaded = loadDemandCoreRecords({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
  assert.equal(loaded.state.pod.phase, "execution-ready");
  assert.equal(loaded.state.pod.testAccess.attempt, 2);
  await assert.rejects(
    () => podService.recordPodTestAccessPlan(testAccessPlanInput(
      fixture,
      loaded,
      IDS.testThirdProbe,
    )),
    /validated|current|retry|replace|Test access/iu,
  );
  assert.equal(existsSync(absoluteRef(
    fixture.workspaceRoot,
    `.wakeflow-local/runtime/hosts/codex/evidence/pods/${IDS.pod}`
      + `/test-access/${IDS.testThirdProbe}/plan.json`,
  )), false);
});

test("T04 derives Git mismatch from raw observations and rejects caller-owned verdict fields", async (t) => {
  const fixture = createFixture(t);
  const ready = await initializeExecutionReadyPod(fixture);
  const planned = await podService.recordPodTestAccessPlan(testAccessPlanInput(
    fixture,
    ready.loaded,
    IDS.testProbe,
  ));
  const observed = podService.observePodTestAccessPlan({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    probeId: IDS.testProbe,
    expectedPlanDigest: planned.plan.digest,
    observedAt: "2026-08-09T02:21:01.000Z",
  });
  const mismatched = {
    ...observed,
    targetObservations: observed.targetObservations.map((entry) => ({
      ...entry,
      observedGitCommonDirDigest: `sha256:${"0".repeat(64)}`,
    })),
  };
  const loaded = loadDemandCoreRecords({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
  const input = testAccessReceiptInput(
    fixture,
    loaded,
    mismatched,
    "0012",
    "2026-08-09T02:21:02.000Z",
  );
  await assert.rejects(
    () => podService.recordPodTestAccessReceipt({
      ...input,
      observation: { ...mismatched, status: "validated" },
    }),
    /field|contract|observation|Test access/iu,
  );
  const recorded = await podService.recordPodTestAccessReceipt(input);
  assert.equal(recorded.outcome, "blocked");
  assert.equal(recorded.reasonCode, "git-identity-mismatch");
  const receipt = JSON.parse(readFileSync(
    absoluteRef(fixture.workspaceRoot, recorded.receipt.ref),
    "utf8",
  ));
  assert.equal(receipt.status, "blocked");
  assert.equal(receipt.reasonCode, "git-identity-mismatch");
  const { reasonCode: _reasonCode, ...receiptWithoutReason } = receipt;
  assert.throws(
    () => createPodTestAccessReceiptRecord({
      ...receiptWithoutReason,
      status: "validated",
      targetObservations: [],
    }),
    /field|reason|target|validated|observation/iu,
  );
});

test("T04 resumes an evidence-first Test access plan and every M2 commit boundary", async (t) => {
  for (const boundary of ["evidence-written", "journal-only", "event-written", "state-written"]) {
    await t.test(boundary, async (t) => {
      const fixture = createFixture(t);
      const ready = await initializeExecutionReadyPod(fixture);
      const input = testAccessPlanInput(fixture, ready.loaded, IDS.testProbe);
      const stateFile = path.join(fixture.stateRoot, "wakeflow-state.json");
      const eventsFile = path.join(fixture.stateRoot, "controller-events.jsonl");
      const beforeState = JSON.parse(readFileSync(stateFile, "utf8"));
      const beforeEvents = readFileSync(eventsFile);

      const committed = await podService.recordPodTestAccessPlan(input);
      const planFile = absoluteRef(fixture.workspaceRoot, committed.plan.ref);
      const planBytes = readFileSync(planFile);
      const after = loadDemandCoreRecords({
        stateRoot: fixture.stateRoot,
        expectedProgramId: IDS.program,
        ledgerRoot: fixture.ledgerRoot,
      });
      const event = after.events.at(-1);

      writeCanonical(stateFile, beforeState);
      writeFileSync(eventsFile, beforeEvents, { mode: 0o600 });
      if (boundary !== "evidence-written") {
        writeCanonical(
          path.join(fixture.stateRoot, "transactions/state-transition.json"),
          podStateTransitionJournal(beforeState, event, after.state),
        );
      }
      if (["event-written", "state-written"].includes(boundary)) {
        appendEventFile(fixture.stateRoot, event);
      }
      if (boundary === "state-written") writeCanonical(stateFile, after.state);

      const recovered = await podService.recordPodTestAccessPlan(input);
      assert.equal(recovered.status, boundary === "evidence-written" ? "planned" : "recovered");
      assert.deepEqual(readFileSync(planFile), planBytes);
      const closed = loadDemandCoreRecords({
        stateRoot: fixture.stateRoot,
        expectedProgramId: IDS.program,
        ledgerRoot: fixture.ledgerRoot,
      });
      assert.deepEqual(closed.state, after.state);
      assert.deepEqual(readdirSync(path.join(fixture.stateRoot, "transactions")), []);
    });
  }
});

test("T04 forward-recovers the exact Test access receipt at every M2 commit boundary", async (t) => {
  for (const boundary of ["journal-only", "event-written", "state-written"]) {
    await t.test(boundary, async (t) => {
      const fixture = createFixture(t);
      const ready = await initializeExecutionReadyPod(fixture);
      const planned = await podService.recordPodTestAccessPlan(testAccessPlanInput(
        fixture,
        ready.loaded,
        IDS.testProbe,
      ));
      const observation = podService.observePodTestAccessPlan({
        workspaceRoot: fixture.workspaceRoot,
        stateRoot: fixture.stateRoot,
        expectedProgramId: IDS.program,
        probeId: IDS.testProbe,
        expectedPlanDigest: planned.plan.digest,
        observedAt: "2026-08-09T02:21:01.000Z",
      });
      const pending = loadDemandCoreRecords({
        stateRoot: fixture.stateRoot,
        expectedProgramId: IDS.program,
        ledgerRoot: fixture.ledgerRoot,
      });
      const input = testAccessReceiptInput(
        fixture,
        pending,
        observation,
        "0012",
        "2026-08-09T02:21:02.000Z",
      );
      const stateFile = path.join(fixture.stateRoot, "wakeflow-state.json");
      const eventsFile = path.join(fixture.stateRoot, "controller-events.jsonl");
      const beforeState = JSON.parse(readFileSync(stateFile, "utf8"));
      const beforeEvents = readFileSync(eventsFile);

      const committed = await podService.recordPodTestAccessReceipt(input);
      const receiptFile = absoluteRef(fixture.workspaceRoot, committed.receipt.ref);
      const receiptBytes = readFileSync(receiptFile);
      const after = loadDemandCoreRecords({
        stateRoot: fixture.stateRoot,
        expectedProgramId: IDS.program,
        ledgerRoot: fixture.ledgerRoot,
      });
      const event = after.events.at(-1);

      writeCanonical(stateFile, beforeState);
      writeFileSync(eventsFile, beforeEvents, { mode: 0o600 });
      writeCanonical(
        path.join(fixture.stateRoot, "transactions/state-transition.json"),
        podStateTransitionJournal(beforeState, event, after.state),
      );
      if (["event-written", "state-written"].includes(boundary)) {
        appendEventFile(fixture.stateRoot, event);
      }
      if (boundary === "state-written") writeCanonical(stateFile, after.state);

      const recovered = await podService.recordPodTestAccessReceipt(input);
      assert.equal(recovered.status, "recovered");
      assert.deepEqual(readFileSync(receiptFile), receiptBytes);
      const closed = loadDemandCoreRecords({
        stateRoot: fixture.stateRoot,
        expectedProgramId: IDS.program,
        ledgerRoot: fixture.ledgerRoot,
      });
      assert.deepEqual(closed.state, after.state);
      assert.deepEqual(readdirSync(path.join(fixture.stateRoot, "transactions")), []);
    });
  }
});

test("T04 never refills a missing state-selected Test access plan", async (t) => {
  const fixture = createFixture(t);
  const ready = await initializeExecutionReadyPod(fixture);
  const input = testAccessPlanInput(fixture, ready.loaded, IDS.testProbe);
  const planned = await podService.recordPodTestAccessPlan(input);
  const planFile = absoluteRef(fixture.workspaceRoot, planned.plan.ref);
  unlinkSync(planFile);
  await assert.rejects(
    () => podService.recordPodTestAccessPlan(input),
    /authority|plan|evidence|missing|damaged/iu,
  );
  assert.equal(existsSync(planFile), false);
});

test("M4-T12 keeps Codex archive behind the manual host gate and rejects legacy caller-asserted close status", async (t) => {
  const fixture = createFixture(t);
  const ready = await initializeExecutionReadyPod(fixture);
  let loaded = terminalizePodDemand(fixture, "completed");

  const productIntentInput = closeIntentInput(
    fixture,
    loaded,
    IDS.productWindow,
    IDS.productClose,
    1,
  );
  const productPlan = await podService.recordPodCloseIntent(productIntentInput);
  assert.equal(productPlan.status, "planned");
  assert.equal(productPlan.memberStatus, "closing");
  assert.equal(productPlan.requiresHostOperationFence, true);
  const productIntentRecord = JSON.parse(readFileSync(
    absoluteRef(fixture.workspaceRoot, productPlan.intent.ref),
    "utf8",
  ));
  assert.equal(productIntentRecord.creationReceiptDigest, loaded.state.pod.windows.find(
    (entry) => entry.windowId === IDS.productWindow,
  ).creationReceipt.digest);

  loaded = currentPodStack(fixture);
  const manualInput = closeReceiptInput(fixture, loaded, productPlan, 1, {
    observationKind: "codex-archive",
    worktreeStatus: "retained",
  });
  const legacyInput = {
    ...manualInput,
    observation: {
      sessionStatus: "closed",
      worktreeStatus: "retained",
      confirmedAt: "2026-08-09T03:01:01.000Z",
    },
  };
  assert.throws(
    () => podService.observePodCloseIntent({
      workspaceRoot: legacyInput.workspaceRoot,
      stateRoot: legacyInput.stateRoot,
      expectedProgramId: legacyInput.expectedProgramId,
      windowId: legacyInput.windowId,
      closeOperationId: legacyInput.closeOperationId,
      expectedIntentDigest: legacyInput.expectedIntentDigest,
      observation: legacyInput.observation,
    }),
    /discriminated|kind|contract|observation/iu,
  );
  const manual = podService.observePodCloseIntent({
    workspaceRoot: manualInput.workspaceRoot,
    stateRoot: manualInput.stateRoot,
    expectedProgramId: manualInput.expectedProgramId,
    windowId: manualInput.windowId,
    closeOperationId: manualInput.closeOperationId,
    expectedIntentDigest: manualInput.expectedIntentDigest,
    observation: manualInput.observation,
  });
  assert.equal(manual.status, "manual-host-gate");
  assert.equal(manual.verificationStatus, "manual-host-gate");
  assert.equal(manual.sessionStatus, "archived");
  assert.equal(manual.receiptWritable, false);
  assert.throws(
    () => podService.observePodCloseIntent({
      workspaceRoot: manualInput.workspaceRoot,
      stateRoot: manualInput.stateRoot,
      expectedProgramId: manualInput.expectedProgramId,
      windowId: manualInput.windowId,
      closeOperationId: manualInput.closeOperationId,
      expectedIntentDigest: manualInput.expectedIntentDigest,
      observation: {
        ...manualInput.observation,
        hostResult: {
          ...manualInput.observation.hostResult,
          subjectDigest: `sha256:${"d".repeat(64)}`,
        },
      },
    }),
    /host.*result|intent|subject|binding/iu,
  );
  await assert.rejects(
    () => podService.recordPodCloseReceipt(manualInput),
    /manual|host.*gate|close/iu,
  );
  assert.equal(existsSync(absoluteRef(
    fixture.workspaceRoot,
    `.wakeflow-local/runtime/hosts/codex/evidence/pods/${IDS.pod}`
      + `/close/${IDS.productClose}/receipt.json`,
  )), false);

  const identityFile = absoluteRef(
    fixture.workspaceRoot,
    `.wakeflow-local/runtime/hosts/codex/identity/window-bindings/${IDS.productWindow}.json`,
  );
  assert.equal(existsSync(identityFile), true);
  assert.equal(existsSync(ready.worktree), true, "manual gate never deletes the host-owned worktree");
  loaded = currentPodStack(fixture);
  assert.equal(loaded.state.state, "completed");
  assert.equal(loaded.state.pod.phase, "closing");
  assert.equal(loaded.state.pod.windows.find(
    (entry) => entry.windowId === IDS.productWindow,
  ).status, "closing");
  const inspection = podService.inspectPodClose({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
  });
  assert.equal(inspection.status, "closing");
  assert.equal(inspection.archiveEligible, false);
  assert.equal(canonicalJson(inspection).includes(ready.worktree), false);
});

test("M4-T05 admits not-found only for an unmaterialized member and derives released without inventing worktree ownership", async (t) => {
  const fixture = createFixture(t);
  const controls = await initializeAndCreateControls(fixture);
  const request = designRequestArtifact(fixture);
  podService.recordPodDesignRequestArtifact(designRequestInput(fixture, controls, request));
  const authority = freezeFixtureAuthority(fixture);
  let loaded = currentPodStack(fixture);
  const handoff = designHandoffArtifact(fixture, request, authority);
  podService.recordPodDesignHandoffArtifact(designHandoffInput(fixture, loaded, handoff));
  const productAppend = podService.planPodProductLaunchAppend(productPlanInput(fixture));
  await podService.applyPodProductLaunchAppendPlan(applyInput(fixture, productAppend));
  loaded = terminalizePodDemand(fixture, "cancelled");

  const productPlan = await podService.recordPodCloseIntent(closeIntentInput(
    fixture,
    loaded,
    IDS.productWindow,
    IDS.productClose,
    1,
  ));
  const intentRecord = JSON.parse(readFileSync(
    absoluteRef(fixture.workspaceRoot, productPlan.intent.ref),
    "utf8",
  ));
  assert.equal(Object.hasOwn(intentRecord, "creationReceiptDigest"), false);
  loaded = currentPodStack(fixture);
  const productReceipt = await podService.recordPodCloseReceipt(closeReceiptInput(
    fixture,
    loaded,
    productPlan,
    1,
    { observationKind: "unmaterialized-not-found", worktreeStatus: "not-applicable" },
  ));
  assert.equal(productReceipt.resourceClaimStatus, "released");
  assert.equal(existsSync(path.join(fixture.workspaceRoot, "PodProductA")), false);

  loaded = currentPodStack(fixture);
  const controllerPlan = await podService.recordPodCloseIntent(closeIntentInput(
    fixture,
    loaded,
    IDS.controllerWindow,
    IDS.controllerClose,
    2,
  ));
  loaded = currentPodStack(fixture);
  const invalidNotFound = closeReceiptInput(
    fixture,
    loaded,
    controllerPlan,
    2,
    { observationKind: "unmaterialized-not-found", worktreeStatus: "not-applicable" },
  );
  assert.throws(
    () => podService.observePodCloseIntent({
      workspaceRoot: invalidNotFound.workspaceRoot,
      stateRoot: invalidNotFound.stateRoot,
      expectedProgramId: invalidNotFound.expectedProgramId,
      windowId: invalidNotFound.windowId,
      closeOperationId: invalidNotFound.closeOperationId,
      expectedIntentDigest: invalidNotFound.expectedIntentDigest,
      observation: invalidNotFound.observation,
    }),
    /not-found|materialized|identity|close/iu,
  );
  assert.equal(currentPodStack(fixture).state.pod.windows.find(
    (entry) => entry.windowId === IDS.controllerWindow,
  ).status, "closing");
});

test("M4-T05 forward-recovers close intent and receipt across evidence-first and every M2 journal boundary", async (t) => {
  for (const operation of ["intent", "receipt"]) {
    for (const boundary of ["evidence-only", "journal-only", "event-written", "state-written"]) {
      await t.test(`${operation}-${boundary}`, async (t) => {
        const fixture = createFixture(t);
        const initialization = podService.planPodLaunchInitialization(planInput(fixture));
        await podService.applyPodLaunchInitializationPlan(applyInput(fixture, initialization));
        let loaded = terminalizePodDemand(fixture, "cancelled");
        const intentInput = closeIntentInput(
          fixture,
          loaded,
          IDS.controllerWindow,
          IDS.controllerClose,
          1,
        );
        if (operation === "intent") {
          const previous = loaded;
          await podService.recordPodCloseIntent(intentInput);
          const committed = currentPodStack(fixture);
          const event = committed.events.at(-1);
          const journal = podStateTransitionJournal(previous.state, event, committed.state);
          writeFileSync(
            path.join(fixture.stateRoot, "controller-events.jsonl"),
            `${previous.events.map((entry) => canonicalJson(entry)).join("\n")}\n`,
            { mode: 0o600 },
          );
          writeCanonical(path.join(fixture.stateRoot, "wakeflow-state.json"), previous.state);
          if (boundary !== "evidence-only") {
            writeCanonical(path.join(fixture.stateRoot, "transactions/state-transition.json"), journal);
          }
          if (["event-written", "state-written"].includes(boundary)) appendEventFile(fixture.stateRoot, event);
          if (boundary === "state-written") {
            writeCanonical(path.join(fixture.stateRoot, "wakeflow-state.json"), committed.state);
          }
          const recovered = await podService.recordPodCloseIntent(intentInput);
          assert.equal(recovered.status, boundary === "evidence-only" ? "planned" : "recovered");
          assert.equal(currentPodStack(fixture).digests.state, committed.digests.state);
        } else {
          const planned = await podService.recordPodCloseIntent(intentInput);
          loaded = currentPodStack(fixture);
          const receiptInput = closeReceiptInput(
            fixture,
            loaded,
            planned,
            2,
            { observationKind: "unmaterialized-not-found", worktreeStatus: "not-applicable" },
          );
          const previous = loaded;
          await podService.recordPodCloseReceipt(receiptInput);
          const committed = currentPodStack(fixture);
          const event = committed.events.at(-1);
          const journal = podStateTransitionJournal(previous.state, event, committed.state);
          writeFileSync(
            path.join(fixture.stateRoot, "controller-events.jsonl"),
            `${previous.events.map((entry) => canonicalJson(entry)).join("\n")}\n`,
            { mode: 0o600 },
          );
          writeCanonical(path.join(fixture.stateRoot, "wakeflow-state.json"), previous.state);
          if (boundary !== "evidence-only") {
            writeCanonical(path.join(fixture.stateRoot, "transactions/state-transition.json"), journal);
          }
          if (["event-written", "state-written"].includes(boundary)) appendEventFile(fixture.stateRoot, event);
          if (boundary === "state-written") {
            writeCanonical(path.join(fixture.stateRoot, "wakeflow-state.json"), committed.state);
          }
          const recovered = await podService.recordPodCloseReceipt(receiptInput);
          assert.equal(recovered.status, boundary === "evidence-only" ? "recorded" : "recovered");
          assert.equal(currentPodStack(fixture).digests.state, committed.digests.state);
        }
        assert.deepEqual(readdirSync(path.join(fixture.stateRoot, "transactions")), []);
      });
    }
  }
});

test("M4-T05 never recreates missing state-selected close evidence", async (t) => {
  const fixture = createFixture(t);
  const initialization = podService.planPodLaunchInitialization(planInput(fixture));
  await podService.applyPodLaunchInitializationPlan(applyInput(fixture, initialization));
  const loaded = terminalizePodDemand(fixture, "cancelled");
  const input = closeIntentInput(
    fixture,
    loaded,
    IDS.controllerWindow,
    IDS.controllerClose,
    1,
  );
  const planned = await podService.recordPodCloseIntent(input);
  unlinkSync(absoluteRef(fixture.workspaceRoot, planned.intent.ref));
  await assert.rejects(
    () => podService.recordPodCloseIntent(input),
    /authority|intent|evidence|missing|damaged/iu,
  );
  assert.equal(existsSync(absoluteRef(fixture.workspaceRoot, planned.intent.ref)), false);
});

test("T02b records request, authority-bound handoff, and one exact product append", async (t) => {
  const fixture = createFixture(t);
  const controlReady = await initializeAndBindControls(fixture);
  assert.equal(controlReady.state.pod.phase, "control-ready");

  const request = designRequestArtifact(fixture);
  const requestInput = designRequestInput(fixture, controlReady, request);
  const requestResult = podService.recordPodDesignRequestArtifact(requestInput);
  assert.equal(requestResult.status, "recorded");
  let loaded = loadDemandCoreRecords({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
  assert.equal(loaded.state.pod.phase, "designing");
  assert.equal(loaded.state.pod.designRequest.podDesignRequestId, IDS.designRequest);
  const requestStateBytes = readFileSync(path.join(fixture.stateRoot, "wakeflow-state.json"));
  assert.equal(podService.recordPodDesignRequestArtifact(requestInput).status, "replayed");
  assert.deepEqual(readFileSync(path.join(fixture.stateRoot, "wakeflow-state.json")), requestStateBytes);

  const authority = freezeFixtureAuthority(fixture);
  loaded = loadDemandCoreRecords({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
  const handoff = designHandoffArtifact(fixture, request, authority);
  const handoffInput = designHandoffInput(fixture, loaded, handoff);
  const handoffResult = podService.recordPodDesignHandoffArtifact(handoffInput);
  assert.equal(handoffResult.status, "recorded");
  loaded = loadDemandCoreRecords({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
  assert.equal(loaded.state.pod.phase, "creating-products");
  assert.equal(loaded.state.pod.designHandoff.podDesignHandoffId, IDS.designHandoff);
  const handoffStateBytes = readFileSync(path.join(fixture.stateRoot, "wakeflow-state.json"));
  assert.equal(podService.recordPodDesignHandoffArtifact(handoffInput).status, "replayed");
  assert.deepEqual(readFileSync(path.join(fixture.stateRoot, "wakeflow-state.json")), handoffStateBytes);

  const artifactInventory = inventoryDemandArtifacts({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
  assert.equal(artifactInventory.status, "healthy", JSON.stringify(artifactInventory, null, 2));
  assert.deepEqual(
    artifactInventory.entries
      .filter((entry) => entry.artifactKind.startsWith("wakeflow-pod-design-"))
      .map((entry) => entry.artifactKind)
      .sort(),
    ["wakeflow-pod-design-handoff", "wakeflow-pod-design-request"],
  );

  const projected = inspectWakeflowActiveProjection({
    workspaceRoot: fixture.workspaceRoot,
    bundle: projectionBundle,
    language: "zh",
  });
  assert.equal(projected.axes.sourceHealth, "complete");
  assert.equal(projected.axes.storageHealth, "healthy", JSON.stringify(projected, null, 2));
  assert.equal(projected.storageInventory.status, "observed");
  const projectionInventory = new Map(projected.storageInventory.entries.map((entry) => [entry.key, entry]));
  assert.deepEqual(projectionInventory.get("event.demand.pod.design-request"), {
    key: "event.demand.pod.design-request",
    count: 1,
    health: "current",
  });
  assert.deepEqual(projectionInventory.get("event.demand.pod.design-handoff"), {
    key: "event.demand.pod.design-handoff",
    count: 1,
    health: "current",
  });

  const scopeFile = absoluteRef(
    fixture.workspaceRoot,
    `.wakeflow-local/runtime/hosts/codex/evidence/pods/${IDS.pod}/pod-scope.json`,
  );
  const scopeBytes = readFileSync(scopeFile);
  const productPlan = podService.planPodProductLaunchAppend(productPlanInput(fixture));
  assert.equal(productPlan.mode, "append");
  assert.equal(Object.isFrozen(productPlan), true);
  const productResult = await podService.applyPodProductLaunchAppendPlan({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    plan: productPlan,
    planDigest: productPlan.planDigest,
  });
  assert.equal(productResult.status, "appended");
  loaded = loadDemandCoreRecords({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
  const product = loaded.state.pod.windows.find((entry) => entry.role === "product");
  assert.equal(product.repositoryId, IDS.repository);
  assert.equal(product.status, "planned");
  assert.equal(product.resourceClaimStatus, "reserved");
  assert.deepEqual(readFileSync(scopeFile), scopeBytes, "product append cannot rewrite immutable scope");

  const replayPlan = podService.planPodProductLaunchAppend(productPlanInput(fixture));
  assert.equal(replayPlan.mode, "replay");
  const beforeReplay = readFileSync(path.join(fixture.stateRoot, "wakeflow-state.json"));
  const replay = await podService.applyPodProductLaunchAppendPlan({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    plan: replayPlan,
    planDigest: replayPlan.planDigest,
  });
  assert.equal(replay.status, "replayed");
  assert.deepEqual(readFileSync(path.join(fixture.stateRoot, "wakeflow-state.json")), beforeReplay);
});

test("T02b rejects a handoff responsibility window outside its repository before writing", async (t) => {
  const fixture = createFixture(t);
  const controlReady = await initializeAndBindControls(fixture);
  const request = designRequestArtifact(fixture);
  podService.recordPodDesignRequestArtifact(designRequestInput(fixture, controlReady, request));
  const authority = freezeFixtureAuthority(fixture);
  const loaded = loadDemandCoreRecords({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
  const invalid = designHandoffArtifact(fixture, request, authority, {
    landingPlan: [{
      repositoryId: IDS.repository,
      responsibilityWindowId: "window_77777777-7777-4777-8777-777777777777",
      workScope: "Invalid Test-window landing.",
    }],
  });
  assert.throws(
    () => podService.recordPodDesignHandoffArtifact(designHandoffInput(fixture, loaded, invalid)),
    (error) => error?.code === "wakeflow-pod-service-design-landing",
  );
  assert.deepEqual(readdirSync(path.join(fixture.stateRoot, "pod/design-handoffs")), []);
});

test("T02b request recording forward-recovers all four artifact transaction boundaries", async (t) => {
  const sourceFixture = createFixture(t);
  const sourcePrevious = await initializeAndBindControls(sourceFixture);
  const artifact = designRequestArtifact(sourceFixture);
  const sourceInput = designRequestInput(sourceFixture, sourcePrevious, artifact);
  podService.recordPodDesignRequestArtifact(sourceInput);
  const sourceCommitted = loadDemandCoreRecords({
    stateRoot: sourceFixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: sourceFixture.ledgerRoot,
  });
  const event = sourceCommitted.events.at(-1);
  const journal = artifactTransitionJournal(sourcePrevious.state, event, sourceCommitted.state, artifact);

  for (const boundary of ["journal-only", "artifact-written", "event-written", "state-written"]) {
    await t.test(boundary, async (t) => {
      const fixture = createFixture(t);
      const previous = await initializeAndBindControls(fixture);
      assert.equal(previous.digests.state, canonicalJsonDigest(sourcePrevious.state));
      writeCanonical(path.join(fixture.stateRoot, "transactions/state-transition.json"), journal);
      if (boundary !== "journal-only") {
        const identity = demandArtifactIdentity(artifact);
        writeCanonical(absoluteRef(fixture.stateRoot, identity.ref), artifact);
      }
      if (["event-written", "state-written"].includes(boundary)) appendEventFile(fixture.stateRoot, event);
      if (boundary === "state-written") {
        writeCanonical(path.join(fixture.stateRoot, "wakeflow-state.json"), sourceCommitted.state);
      }
      const result = podService.recordPodDesignRequestArtifact(
        designRequestInput(fixture, previous, artifact),
      );
      assert.equal(result.status, "recovered");
      assert.deepEqual(readdirSync(path.join(fixture.stateRoot, "transactions")), []);
    });
  }
});

test("T02b handoff recording forward-recovers all four artifact transaction boundaries", async (t) => {
  const sourceFixture = createFixture(t);
  const sourceControl = await initializeAndBindControls(sourceFixture);
  const request = designRequestArtifact(sourceFixture);
  podService.recordPodDesignRequestArtifact(designRequestInput(sourceFixture, sourceControl, request));
  const authority = freezeFixtureAuthority(sourceFixture);
  const sourcePrevious = loadDemandCoreRecords({
    stateRoot: sourceFixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: sourceFixture.ledgerRoot,
  });
  const artifact = designHandoffArtifact(sourceFixture, request, authority);
  podService.recordPodDesignHandoffArtifact(
    designHandoffInput(sourceFixture, sourcePrevious, artifact),
  );
  const sourceCommitted = loadDemandCoreRecords({
    stateRoot: sourceFixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: sourceFixture.ledgerRoot,
  });
  const event = sourceCommitted.events.at(-1);
  const journal = artifactTransitionJournal(sourcePrevious.state, event, sourceCommitted.state, artifact);

  for (const boundary of ["journal-only", "artifact-written", "event-written", "state-written"]) {
    await t.test(boundary, async (t) => {
      const fixture = createFixture(t);
      const controlReady = await initializeAndBindControls(fixture);
      podService.recordPodDesignRequestArtifact(designRequestInput(fixture, controlReady, request));
      freezeFixtureAuthority(fixture);
      const previous = loadDemandCoreRecords({
        stateRoot: fixture.stateRoot,
        expectedProgramId: IDS.program,
        ledgerRoot: fixture.ledgerRoot,
      });
      assert.equal(previous.digests.state, canonicalJsonDigest(sourcePrevious.state));
      writeCanonical(path.join(fixture.stateRoot, "transactions/state-transition.json"), journal);
      if (boundary !== "journal-only") {
        const identity = demandArtifactIdentity(artifact);
        writeCanonical(absoluteRef(fixture.stateRoot, identity.ref), artifact);
      }
      if (["event-written", "state-written"].includes(boundary)) appendEventFile(fixture.stateRoot, event);
      if (boundary === "state-written") {
        writeCanonical(path.join(fixture.stateRoot, "wakeflow-state.json"), sourceCommitted.state);
      }
      const result = podService.recordPodDesignHandoffArtifact(
        designHandoffInput(fixture, previous, artifact),
      );
      assert.equal(result.status, "recovered");
      assert.deepEqual(readdirSync(path.join(fixture.stateRoot, "transactions")), []);
    });
  }
});

test("T02b product append rejects stale prefix plans, releases the gate, and resumes from exact bytes", async (t) => {
  const fixture = createFixture(t);
  await prepareDesignHandoff(fixture);
  const input = productPlanInput(fixture);
  const stale = podService.planPodProductLaunchAppend(input);
  const product = input.launchIntents[0];
  writeFileSync(
    absoluteRef(fixture.workspaceRoot, podRecordRef(product)),
    podRecordCanonicalBytes(product),
    { mode: 0o600 },
  );
  await assert.rejects(
    () => podService.applyPodProductLaunchAppendPlan({
      workspaceRoot: fixture.workspaceRoot,
      stateRoot: fixture.stateRoot,
      expectedProgramId: IDS.program,
      plan: stale,
      planDigest: stale.planDigest,
    }),
    (error) => (
      error?.code === "wakeflow-pod-service-product-apply"
      && error?.cause?.code === "wakeflow-mutation-callback-failed"
      && error?.cause?.cause?.code === "wakeflow-pod-service-stale-plan"
    ),
  );
  assert.equal(
    existsSync(path.join(fixture.workspaceRoot, ".wakeflow-local/runtime/maintenance.lock")),
    false,
  );
  const resumed = podService.planPodProductLaunchAppend(input);
  assert.equal(resumed.evidencePrefix, "complete");
  const result = await podService.applyPodProductLaunchAppendPlan({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    plan: resumed,
    planDigest: resumed.planDigest,
  });
  assert.equal(result.status, "appended");
});

test("T02b product planning fails closed before handoff and on config-source digest drift", async (t) => {
  const beforeHandoff = createFixture(t);
  await initializeAndBindControls(beforeHandoff);
  assert.throws(
    () => podService.planPodProductLaunchAppend(productPlanInput(beforeHandoff)),
    (error) => error?.code === "wakeflow-pod-service-product-gate",
  );

  const fixture = createFixture(t);
  await prepareDesignHandoff(fixture);
  assert.throws(
    () => podService.planPodProductLaunchAppend(productPlanInput(fixture, {
      launchIntents: [productIntent({ repositorySourceDigest: `sha256:${"f".repeat(64)}` })],
    })),
    (error) => error?.code === "wakeflow-pod-service-product-authority",
  );
  assert.equal(
    existsSync(absoluteRef(
      fixture.workspaceRoot,
      `.wakeflow-local/runtime/hosts/codex/evidence/pods/${IDS.pod}`
        + `/launch-intents/${IDS.productLaunch}.json`,
    )),
    false,
  );
});

test("T02b product append forward-recovers exact local evidence plus every state journal boundary", async (t) => {
  for (const boundary of ["journal-only", "event-written", "state-written"]) {
    await t.test(boundary, async (t) => {
      const fixture = createFixture(t);
      await prepareDesignHandoff(fixture);
      const plan = podService.planPodProductLaunchAppend(productPlanInput(fixture));
      for (const intent of plan.launchIntents) {
        writeFileSync(
          absoluteRef(fixture.workspaceRoot, intent.ref),
          podRecordCanonicalBytes(intent.record),
          { mode: 0o600 },
        );
      }
      writeCanonical(
        path.join(fixture.stateRoot, "transactions/state-transition.json"),
        productTransitionJournal(plan),
      );
      if (["event-written", "state-written"].includes(boundary)) appendEventFile(fixture.stateRoot, plan.event);
      if (boundary === "state-written") {
        writeCanonical(path.join(fixture.stateRoot, "wakeflow-state.json"), plan.nextState);
      }
      const result = await podService.applyPodProductLaunchAppendPlan({
        workspaceRoot: fixture.workspaceRoot,
        stateRoot: fixture.stateRoot,
        expectedProgramId: IDS.program,
        plan,
        planDigest: plan.planDigest,
      });
      assert.equal(result.status, "recovered");
      assert.deepEqual(readdirSync(path.join(fixture.stateRoot, "transactions")), []);
    });
  }
});

test("plan is deeply frozen and read-only; product membership remains closed until T02b", (t) => {
  const fixture = createFixture(t);
  const before = readdirSync(path.join(
    fixture.workspaceRoot,
    ".wakeflow-local/runtime/hosts/codex/evidence/pods",
  ));
  const plan = podService.planPodLaunchInitialization(planInput(fixture));
  assert.equal(plan.kind, "WakeflowPodLaunchInitializationPlan");
  assert.equal(plan.mode, "initialize");
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.launchIntents), true);
  assert.deepEqual(readdirSync(path.join(
    fixture.workspaceRoot,
    ".wakeflow-local/runtime/hosts/codex/evidence/pods",
  )), before);

  assert.throws(
    () => podService.planPodLaunchInitialization(planInput(fixture, {
      launchIntents: [...controlIntents(), productIntent()]
        .sort((left, right) => left.windowId.localeCompare(right.windowId)),
    })),
    (error) => error?.code === "wakeflow-pod-service-product-admission-pending",
  );
  assert.deepEqual(readdirSync(path.join(
    fixture.workspaceRoot,
    ".wakeflow-local/runtime/hosts/codex/evidence/pods",
  )), before);
});

test("apply create-once publishes the exact Pod tree, links state last, and exact replay is zero-write", async (t) => {
  const fixture = createFixture(t);
  const plan = podService.planPodLaunchInitialization(planInput(fixture));
  const result = await podService.applyPodLaunchInitializationPlan(applyInput(fixture, plan));
  assert.equal(result.status, "initialized");
  assert.equal(result.revision, 2);
  const podRoot = absoluteRef(fixture.workspaceRoot, plan.scope.ref.replace(/\/pod-scope\.json$/u, ""));
  assert.deepEqual(readdirSync(podRoot).sort(), [
    "bindings",
    "close",
    "launch-intents",
    "materialization",
    "pod-scope.json",
    "test-access",
  ]);
  assert.equal(lstatSync(path.join(podRoot, "pod-scope.json")).mode & 0o777, 0o600);
  for (const directory of ["bindings", "close", "launch-intents", "materialization", "test-access"]) {
    assert.equal(lstatSync(path.join(podRoot, directory)).mode & 0o777, 0o700);
  }
  const loaded = loadDemandCoreRecords({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
  assert.equal(loaded.state.pod.phase, "reserved");
  assert.deepEqual(loaded.state.pod.windows.map((entry) => entry.role).sort(), [
    "controller",
    "design",
    "test",
  ]);
  assert.equal(loaded.state.pod.scope.digest, podRecordDigest(scope(fixture)));

  const beforeState = readFileSync(path.join(fixture.stateRoot, "wakeflow-state.json"));
  const replayPlan = podService.planPodLaunchInitialization(planInput(fixture));
  assert.equal(replayPlan.mode, "replay");
  const replay = await podService.applyPodLaunchInitializationPlan(applyInput(fixture, replayPlan));
  assert.equal(replay.status, "replayed");
  assert.equal(replay.revision, 2);
  assert.deepEqual(readFileSync(path.join(fixture.stateRoot, "wakeflow-state.json")), beforeState);

  const inventory = podService.inspectPodEvidenceInventory({
    workspaceRoot: fixture.workspaceRoot,
    expectedProgramId: IDS.program,
    hostId: "codex",
  });
  assert.equal(inventory.status, "current");
  assert.equal(inventory.pods.length, 1);
  assert.equal(inventory.pods[0].linkage, "structural-current");
});

test("an exact partial unlinked prefix resumes, while conflicting immutable bytes fail closed", async (t) => {
  const fixture = createFixture(t);
  const input = planInput(fixture);
  const records = [input.scope, ...input.launchIntents];
  writeEvidencePrefix(fixture.workspaceRoot, records, 2);
  const partial = podService.inspectPodEvidenceInventory({
    workspaceRoot: fixture.workspaceRoot,
    expectedProgramId: IDS.program,
    hostId: "codex",
  });
  assert.equal(partial.pods[0].linkage, "structural-prefix");
  const plan = podService.planPodLaunchInitialization(input);
  const result = await podService.applyPodLaunchInitializationPlan(applyInput(fixture, plan));
  assert.equal(result.status, "initialized");
  for (const record of records) {
    assert.deepEqual(
      readFileSync(absoluteRef(fixture.workspaceRoot, podRecordRef(record))),
      podRecordCanonicalBytes(record),
    );
  }

  const conflictFixture = createFixture(t);
  const conflictInput = planInput(conflictFixture);
  writeEvidencePrefix(conflictFixture.workspaceRoot, [
    { ...conflictInput.scope, createdAt: "2026-08-09T02:00:00.500Z" },
  ]);
  assert.throws(
    () => podService.planPodLaunchInitialization(conflictInput),
    (error) => error?.code === "wakeflow-pod-service-evidence-conflict",
  );
});

test("apply rejects a stale inventory plan without retaining the workspace gate, then a replan resumes", async (t) => {
  const fixture = createFixture(t);
  const input = planInput(fixture);
  const stalePlan = podService.planPodLaunchInitialization(input);
  writeEvidencePrefix(fixture.workspaceRoot, [input.scope], 1);

  await assert.rejects(
    () => podService.applyPodLaunchInitializationPlan(applyInput(fixture, stalePlan)),
    (error) => (
      error?.code === "wakeflow-pod-service-apply"
      && error?.cause?.code === "wakeflow-mutation-callback-failed"
      && error?.cause?.cause?.code === "wakeflow-pod-service-stale-plan"
    ),
  );
  assert.equal(
    existsSync(path.join(fixture.workspaceRoot, ".wakeflow-local/runtime/maintenance.lock")),
    false,
    "safe exact-prefix failure must release the workspace mutation gate",
  );
  const replanned = podService.planPodLaunchInitialization(input);
  assert.equal(replanned.evidencePrefix, "prefix");
  const result = await podService.applyPodLaunchInitializationPlan(applyInput(fixture, replanned));
  assert.equal(result.status, "initialized");
});

test("an unrelated Pod prefix does not stale the exact target-Pod plan", async (t) => {
  const fixture = createFixture(t);
  const input = planInput(fixture);
  const plan = podService.planPodLaunchInitialization(input);
  ensurePrivateDirectory(
    fixture.workspaceRoot,
    ".wakeflow-local/runtime/hosts/codex/evidence/pods/"
      + "pod_33000000-0000-4000-8000-000000000099",
  );
  const result = await podService.applyPodLaunchInitializationPlan(applyInput(fixture, plan));
  assert.equal(result.status, "initialized");
});

test("inventory and planning reject an unknown nested Pod directory without deleting residue", (t) => {
  const fixture = createFixture(t);
  const input = planInput(fixture);
  writeEvidencePrefix(fixture.workspaceRoot, [input.scope], 1);
  const unknownRef = `.wakeflow-local/runtime/hosts/codex/evidence/pods/${IDS.pod}`
    + "/materialization/not-a-launch";
  ensurePrivateDirectory(fixture.workspaceRoot, unknownRef);

  const inventory = podService.inspectPodEvidenceInventory({
    workspaceRoot: fixture.workspaceRoot,
    expectedProgramId: IDS.program,
    hostId: "codex",
  });
  assert.equal(inventory.status, "degraded");
  assert.equal(inventory.pods[0].linkage, "structural-invalid");
  assert.ok(inventory.issues.some((entry) => (
    entry.code === "wakeflow-pod-service-evidence-unknown" && entry.ref === unknownRef
  )));
  assert.throws(
    () => podService.planPodLaunchInitialization(input),
    (error) => error?.code === "wakeflow-pod-service-evidence-conflict",
  );
  assert.equal(existsSync(absoluteRef(fixture.workspaceRoot, unknownRef)), true);
});

test("state-selected evidence loss is authority damage and retry never recreates it", async (t) => {
  const fixture = createFixture(t);
  const input = planInput(fixture);
  const plan = podService.planPodLaunchInitialization(input);
  await podService.applyPodLaunchInitializationPlan(applyInput(fixture, plan));
  const missing = absoluteRef(fixture.workspaceRoot, podRecordRef(input.launchIntents[0]));
  unlinkSync(missing);
  assert.throws(
    () => podService.planPodLaunchInitialization(input),
    (error) => error?.code === "wakeflow-pod-service-authority-damaged",
  );
  assert.equal(existsSync(missing), false);
});

test("the service forward-recovers its exact Pod journal at every M2 commit boundary", async (t) => {
  for (const boundary of ["journal-only", "event-written", "state-written"]) {
    await t.test(boundary, async (t) => {
      const fixture = createFixture(t);
      const input = planInput(fixture);
      const plan = podService.planPodLaunchInitialization(input);
      writeEvidencePrefix(fixture.workspaceRoot, [input.scope, ...input.launchIntents]);
      writeCanonical(
        path.join(fixture.stateRoot, "transactions/state-transition.json"),
        transitionJournal(plan),
      );
      if (boundary !== "journal-only") {
        writeFileSync(
          path.join(fixture.stateRoot, "controller-events.jsonl"),
          `${canonicalJson(fixture.event)}\n${canonicalJson(plan.event)}\n`,
          { mode: 0o600 },
        );
      }
      if (boundary === "state-written") {
        writeCanonical(path.join(fixture.stateRoot, "wakeflow-state.json"), plan.nextState);
      }
      const result = await podService.applyPodLaunchInitializationPlan(applyInput(fixture, plan));
      assert.equal(result.status, "recovered");
      const loaded = loadDemandCoreRecords({
        stateRoot: fixture.stateRoot,
        expectedProgramId: IDS.program,
        ledgerRoot: fixture.ledgerRoot,
      });
      assert.deepEqual(loaded.state, plan.nextState);
      assert.deepEqual(readdirSync(path.join(fixture.stateRoot, "transactions")), []);
    });
  }
});

test("Pod service rejects behavioral nested arrays and plans without executing accessors", async (t) => {
  const fixture = createFixture(t);

  let launchSlotReads = 0;
  const launchIntents = controlIntents();
  const firstIntent = launchIntents[0];
  Object.defineProperty(launchIntents, "0", {
    enumerable: true,
    configurable: true,
    get() {
      launchSlotReads += 1;
      return firstIntent;
    },
  });
  assert.throws(
    () => podService.planPodLaunchInitialization(planInput(fixture, { launchIntents })),
    (error) => error?.code === "wakeflow-pod-service-contract",
  );
  assert.equal(launchSlotReads, 0);

  let productSlotReads = 0;
  const productIntents = [productIntent()];
  const product = productIntents[0];
  Object.defineProperty(productIntents, "0", {
    enumerable: true,
    configurable: true,
    get() {
      productSlotReads += 1;
      return product;
    },
  });
  assert.throws(
    () => podService.planPodProductLaunchAppend(productPlanInput(fixture, {
      launchIntents: productIntents,
    })),
    (error) => error?.code === "wakeflow-pod-service-contract",
  );
  assert.equal(productSlotReads, 0);

  const plan = podService.planPodLaunchInitialization(planInput(fixture));
  let planScopeReads = 0;
  const behavioralPlan = { ...plan };
  Object.defineProperty(behavioralPlan, "scope", {
    enumerable: true,
    configurable: true,
    get() {
      planScopeReads += 1;
      return plan.scope;
    },
  });
  await assert.rejects(
    () => podService.applyPodLaunchInitializationPlan({
      ...applyInput(fixture, plan),
      plan: behavioralPlan,
    }),
    (error) => error?.code === "wakeflow-pod-service-contract",
  );
  assert.equal(planScopeReads, 0);
});

test("Pod Test and close observations reject behavioral discriminators and arrays without execution", async (t) => {
  const fixture = createFixture(t);
  const digestValue = `sha256:${"a".repeat(64)}`;

  let targetSlotReads = 0;
  const targetObservations = [{
    windowId: IDS.productWindow,
    repositoryId: IDS.repository,
    bindingId: IDS.productBinding,
    creationReceiptDigest: digestValue,
    accessResult: "unreadable",
  }];
  const firstTarget = targetObservations[0];
  Object.defineProperty(targetObservations, "0", {
    enumerable: true,
    configurable: true,
    get() {
      targetSlotReads += 1;
      return firstTarget;
    },
  });
  await assert.rejects(
    () => podService.recordPodTestAccessReceipt({
      workspaceRoot: fixture.workspaceRoot,
      stateRoot: fixture.stateRoot,
      expectedProgramId: IDS.program,
      probeId: IDS.testProbe,
      expectedPrevious: { revision: 1, stateDigest: canonicalJsonDigest(fixture.state) },
      observation: {
        kind: "WakeflowPodTestAccessObservation",
        schemaVersion: 1,
        programId: IDS.program,
        hostId: "codex",
        podId: IDS.pod,
        demandId: IDS.demand,
        probeId: IDS.testProbe,
        planDigest: digestValue,
        bindingSetDigest: digestValue,
        observerBindingId: IDS.testBinding,
        observerIdentityBindingDigest: digestValue,
        targetObservations,
        observedAt: "2026-08-09T02:21:01.000Z",
      },
      transition: {
        eventId: "event-pod-passive-observation-0001",
        createdAt: "2026-08-09T02:21:02.000Z",
        reason: "Reject a behavioral Test observation",
        decisionSummary: "No accessor may participate in Pod evidence admission.",
      },
    }),
    (error) => error?.code === "wakeflow-pod-service-contract",
  );
  assert.equal(targetSlotReads, 0);

  let closeKindReads = 0;
  const observation = {
    worktreeStatus: "not-applicable",
    confirmedAt: "2026-08-09T03:01:01.000Z",
  };
  Object.defineProperty(observation, "kind", {
    enumerable: true,
    configurable: true,
    get() {
      closeKindReads += 1;
      return "unmaterialized-not-found";
    },
  });
  await assert.rejects(
    () => podService.recordPodCloseReceipt({
      workspaceRoot: fixture.workspaceRoot,
      stateRoot: fixture.stateRoot,
      expectedProgramId: IDS.program,
      windowId: IDS.controllerWindow,
      closeOperationId: IDS.controllerClose,
      expectedIntentDigest: digestValue,
      expectedPrevious: { revision: 1, stateDigest: canonicalJsonDigest(fixture.state) },
      observation,
      transition: {
        eventId: "event-pod-passive-close-0001",
        createdAt: "2026-08-09T03:01:02.000Z",
        reason: "Reject a behavioral close observation",
        decisionSummary: "No discriminator getter may choose a close proof branch.",
      },
    }),
    (error) => error?.code === "wakeflow-pod-service-contract",
  );
  assert.equal(closeKindReads, 0);

  let loadedDemandReads = 0;
  const behavioralLoaded = { ...currentPodStack(fixture) };
  const demand = behavioralLoaded.demand;
  Object.defineProperty(behavioralLoaded, "demand", {
    enumerable: true,
    configurable: true,
    get() {
      loadedDemandReads += 1;
      return demand;
    },
  });
  assert.throws(
    () => podService.inspectPodCloseFromLoadedWhileLocked({
      workspaceRoot: fixture.workspaceRoot,
      stateRoot: fixture.stateRoot,
      expectedProgramId: IDS.program,
      loaded: behavioralLoaded,
    }),
    (error) => error?.code === "wakeflow-pod-service-contract",
  );
  assert.equal(loadedDemandReads, 0);
});

test("current service replaces every retired public-v2 Pod entrypoint", () => {
  for (const relative of [
    "core/scripts/wakeflow-pod.mjs",
    "core/scripts/lib/wakeflow-pod-runtime.mjs",
  ]) {
    assert.equal(existsSync(path.join(repositoryRoot, relative)), false, relative);
  }
  assert.equal(existsSync(path.join(repositoryRoot, "core/scripts/lib/wakeflow-pod-service.mjs")), true);
});
