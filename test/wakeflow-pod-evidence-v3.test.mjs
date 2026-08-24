import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

import {
  canonicalJson,
  canonicalJsonDigest,
} from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import {
  loadDemandCoreRecords,
  validateControllerEventRecord,
  validateDemandCoreStack,
  validateDemandStateRecord,
  validateStateTransitionRecord,
} from "../core/scripts/lib/wakeflow-demand-core-records.mjs";
import {
  commitDemandPodTransitionWhileLocked,
  commitDemandStateTransition,
  recoverDemandPodTransitionWhileLocked,
  recoverDemandStateTransition,
} from "../core/scripts/lib/wakeflow-demand-state-service.mjs";
import * as podRecords from "../core/scripts/lib/wakeflow-pod-records.mjs";
import {
  createLedgerMemberReference,
  createLedgerRecord,
  loadLedgerRecord,
} from "../core/scripts/lib/wakeflow-ledger-records.mjs";
import { withStateRootLock } from "../core/scripts/lib/wakeflow-state-lock.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IDS = Object.freeze({
  program: "program_11111111-1111-4111-8111-111111111111",
  demand: "demand_22222222-2222-4222-8222-222222222222",
  pod: "pod_33333333-3333-4333-8333-333333333333",
  controllerWindow: "window_44444444-4444-4444-8444-444444444444",
  testWindow: "window_55555555-5555-4555-8555-555555555555",
  productWindow: "window_66666666-6666-4666-8666-666666666666",
  repository: "repository_77777777-7777-4777-8777-777777777777",
  controllerBinding: "binding_88888888-8888-4888-8888-888888888888",
  testBinding: "binding_99999999-9999-4999-8999-999999999999",
  productBinding: "binding_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  launch: "pod-launch_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  attempt: "pod-materialization-attempt_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  materializationEvent: "pod-materialization-event_dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  observation: "pod-resume-observation_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  probe: "pod-test-probe_ffffffff-ffff-4fff-8fff-ffffffffffff",
  close: "pod-close_01234567-89ab-4cde-8fab-0123456789ab",
  confirmation: "confirmation_13572468-2468-4ace-8ace-135724681357",
  controllerLaunch: "pod-launch_10000000-0000-4000-8000-000000000001",
  designLaunch: "pod-launch_10000000-0000-4000-8000-000000000002",
  testLaunch: "pod-launch_10000000-0000-4000-8000-000000000003",
  designWindow: "window_10000000-0000-4000-8000-000000000004",
  designBinding: "binding_10000000-0000-4000-8000-000000000005",
  designRequest: "pod-design-request_10000000-0000-4000-8000-000000000006",
  designHandoff: "pod-design-handoff_10000000-0000-4000-8000-000000000007",
});
const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;
const DIGEST_C = `sha256:${"c".repeat(64)}`;
const DIGEST_D = `sha256:${"d".repeat(64)}`;
const CREATED_AT = "2026-08-09T01:02:03.000Z";

function commonIdentity() {
  return {
    programId: IDS.program,
    hostId: "codex",
    podId: IDS.pod,
    demandId: IDS.demand,
  };
}

function scopeRecord() {
  return {
    kind: podRecords.WAKEFLOW_POD_SCOPE_KIND,
    schemaVersion: 1,
    ...commonIdentity(),
    placementAuthorizationDigest: DIGEST_A,
    createdAt: CREATED_AT,
  };
}

function productLaunchIntent() {
  return {
    kind: podRecords.WAKEFLOW_POD_LAUNCH_INTENT_KIND,
    schemaVersion: 1,
    ...commonIdentity(),
    windowId: IDS.productWindow,
    launchOperationId: IDS.launch,
    bindingId: IDS.productBinding,
    role: "product",
    repositoryId: IDS.repository,
    repositorySourceDigest: DIGEST_A,
    environmentIntent: "host-worktree",
    basePolicy: "local-head",
    expectedBaseHead: "1".repeat(40),
    createdAt: CREATED_AT,
  };
}

function testPlanInput() {
  const value = {
    kind: podRecords.WAKEFLOW_POD_TEST_ACCESS_PLAN_KIND,
    schemaVersion: 1,
    ...commonIdentity(),
    probeId: IDS.probe,
    attempt: 1,
    probeType: "direct-multi-root",
    bindingSetDigest: DIGEST_A,
    observer: {
      windowId: IDS.testWindow,
      bindingId: IDS.testBinding,
      identityBindingDigest: DIGEST_B,
      creationReceiptDigest: DIGEST_C,
    },
    targets: [{
      windowId: IDS.productWindow,
      repositoryId: IDS.repository,
      bindingId: IDS.productBinding,
      identityBindingDigest: DIGEST_B,
      creationReceiptDigest: DIGEST_C,
      actualRoot: "/private/wakeflow/product-a",
      expectedRootDigest: DIGEST_A,
      expectedGitTopLevelDigest: DIGEST_B,
      expectedGitCommonDirDigest: DIGEST_C,
    }],
    createdAt: CREATED_AT,
  };
  value.bindingSetDigest = podRecords.podTestAccessBindingSetDigest(value);
  return value;
}

function placementAuthorizationRef() {
  return {
    schemaVersion: 1,
    artifactKind: "wakeflow-ledger-member-ref",
    family: "confirmation",
    recordId: IDS.confirmation,
    recordRef: `goal-stage-confirmation/${IDS.confirmation}/record.json`,
    recordDigest: DIGEST_A,
    memberRef: `goal-stage-confirmation/${IDS.confirmation}/01-user-confirmation.md`,
    memberDigest: DIGEST_B,
    role: "user-confirmation",
  };
}

function demandRecord(authorizationRef = placementAuthorizationRef()) {
  return {
    schemaVersion: 1,
    artifactKind: "wakeflow-demand",
    programId: IDS.program,
    demandId: IDS.demand,
    createdAt: CREATED_AT,
    title: "M4 Pod state candidate",
    goal: "Prove state-first Pod authority.",
    completionDefinition: "Pod identity and evidence references are exact.",
    demandType: "requirement",
    source: {
      artifactKind: "wakeflow-todo-lineage-ref",
      schemaVersion: 1,
      boardRef: ".wakeflow-active/current/global-todo-board.md",
      todoId: "TODO-M4-T01",
      intakeRowDigest: DIGEST_C,
    },
    executionPlacement: {
      mode: "isolated",
      authorizationRef,
    },
  };
}

function emptyArtifactState() {
  return {
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

function initialEvent(demand = demandRecord()) {
  return {
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: "event-pod-initial-0001",
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

function stateRecord({ demand = demandRecord(), event = initialEvent(demand), pod } = {}) {
  return {
    schemaVersion: 1,
    artifactKind: "wakeflow-state",
    programId: demand.programId,
    demandId: demand.demandId,
    demandRef: "demand.json",
    demandDigest: canonicalJsonDigest(demand),
    revision: event.nextRevision,
    state: event.to,
    stateReason: event.reason,
    updatedAt: event.createdAt,
    lastEvent: {
      eventId: event.eventId,
      eventDigest: canonicalJsonDigest(event),
    },
    ...emptyArtifactState(),
    ...(pod === undefined ? {} : { pod }),
  };
}

function podWindow({ windowId, role, launchOperationId, bindingId }) {
  return {
    windowId,
    role,
    launchOperationId,
    bindingId,
    launchIntent: {
      ref: `.wakeflow-local/runtime/hosts/codex/evidence/pods/${IDS.pod}/launch-intents/${launchOperationId}.json`,
      digest: DIGEST_A,
    },
    status: "planned",
  };
}

function podState(authorizationRef = placementAuthorizationRef()) {
  const windows = [
    podWindow({
      windowId: IDS.designWindow,
      role: "design",
      launchOperationId: IDS.designLaunch,
      bindingId: IDS.designBinding,
    }),
    podWindow({
      windowId: IDS.controllerWindow,
      role: "controller",
      launchOperationId: IDS.controllerLaunch,
      bindingId: IDS.controllerBinding,
    }),
    podWindow({
      windowId: IDS.testWindow,
      role: "test",
      launchOperationId: IDS.testLaunch,
      bindingId: IDS.testBinding,
    }),
  ].sort((left, right) => left.windowId.localeCompare(right.windowId));
  return {
    podId: IDS.pod,
    hostId: "codex",
    placementAuthorizationDigest: canonicalJsonDigest(authorizationRef),
    scope: {
      ref: `.wakeflow-local/runtime/hosts/codex/evidence/pods/${IDS.pod}/pod-scope.json`,
      digest: DIGEST_A,
    },
    phase: "reserved",
    windows,
  };
}

function podStateWithProduct(authorizationRef = placementAuthorizationRef()) {
  const pod = structuredClone(podState(authorizationRef));
  const root = `.wakeflow-local/runtime/hosts/codex/evidence/pods/${IDS.pod}`;
  pod.windows.push({
    windowId: IDS.productWindow,
    role: "product",
    launchOperationId: IDS.launch,
    bindingId: IDS.productBinding,
    launchIntent: {
      ref: `${root}/launch-intents/${IDS.launch}.json`,
      digest: DIGEST_A,
    },
    status: "planned",
    repositoryId: IDS.repository,
    resourceClaimStatus: "reserved",
  });
  pod.windows.sort((left, right) => left.windowId.localeCompare(right.windowId));
  return pod;
}

function boundPodState(authorizationRef = placementAuthorizationRef()) {
  const pod = podStateWithProduct(authorizationRef);
  const root = `.wakeflow-local/runtime/hosts/codex/evidence/pods/${IDS.pod}`;
  pod.phase = "execution-ready";
  pod.designRequest = {
    podDesignRequestId: IDS.designRequest,
    ref: `pod/design-requests/${IDS.designRequest}.json`,
    digest: DIGEST_A,
  };
  pod.designHandoff = {
    podDesignHandoffId: IDS.designHandoff,
    ref: `pod/design-handoffs/${IDS.designHandoff}.json`,
    digest: DIGEST_B,
  };
  pod.windows = pod.windows.map((entry) => ({
    ...entry,
    status: "bound",
    materializationFinalEvent: {
      eventId: IDS.materializationEvent,
      ref: `${root}/materialization/${entry.launchOperationId}/events/${IDS.materializationEvent}.json`,
      digest: DIGEST_B,
    },
    identityBindingDigest: DIGEST_C,
    creationReceipt: {
      ref: `${root}/bindings/${entry.windowId}/creation-receipt.json`,
      digest: DIGEST_D,
    },
    ...(entry.role === "product" ? { resourceClaimStatus: "active" } : {}),
  }));
  return pod;
}

function podBindingSetDigest(pod) {
  const observer = pod.windows.find((entry) => entry.role === "test");
  const targets = pod.windows.filter((entry) => entry.role === "product");
  return canonicalJsonDigest({
    observer: {
      windowId: observer.windowId,
      bindingId: observer.bindingId,
      identityBindingDigest: observer.identityBindingDigest,
      creationReceiptDigest: observer.creationReceipt.digest,
    },
    targets: targets.map((target) => ({
      windowId: target.windowId,
      repositoryId: target.repositoryId,
      bindingId: target.bindingId,
      identityBindingDigest: target.identityBindingDigest,
      creationReceiptDigest: target.creationReceipt.digest,
    })),
  });
}

function podInitializeEvent(pod = podState()) {
  return {
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: "event-pod-initialize-0002",
    demandId: IDS.demand,
    createdAt: "2026-08-09T01:02:04.000Z",
    actor: "controller",
    command: "initialize-pod",
    type: "pod.initialized",
    previousRevision: 1,
    nextRevision: 2,
    from: "intake",
    to: "intake",
    reason: "Pod scope and control membership authorized",
    decisionSummary: "Initialize exact state-first Pod authority.",
    changedArtifacts: [],
    podTransition: {
      podId: IDS.pod,
      action: "initialize",
      previousPodDigest: null,
      nextPodDigest: canonicalJsonDigest(pod),
    },
  };
}

function writeCanonical(file, value) {
  writeFileSync(file, `${canonicalJson(value)}\n`, { mode: 0o600 });
}

function makePublishedPodStateRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-pod-evidence-v3-"));
  const ledgerRoot = path.join(root, "ledger");
  mkdirSync(path.join(ledgerRoot, "goal-stage-confirmation"), { recursive: true, mode: 0o755 });
  mkdirSync(path.join(ledgerRoot, "requirement-designs"), { recursive: true, mode: 0o755 });
  mkdirSync(path.join(ledgerRoot, "workspace", "archive"), { recursive: true, mode: 0o755 });
  const memberPath = "01-user-confirmation.md";
  const memberContent = "# Pod placement authorization\n";
  const confirmation = {
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
  };
  const created = createLedgerRecord({
    ledgerRoot,
    expectedProgramId: IDS.program,
    record: confirmation,
    memberContents: { [memberPath]: memberContent },
  });
  const loadedConfirmation = loadLedgerRecord({
    ledgerRoot,
    root: created.root,
    expectedFamily: "confirmation",
    expectedProgramId: IDS.program,
  });
  const authorizationRef = createLedgerMemberReference(loadedConfirmation, memberPath);
  const stateRoot = path.join(root, IDS.demand);
  mkdirSync(path.join(stateRoot, "transactions"), { recursive: true, mode: 0o700 });
  mkdirSync(path.join(stateRoot, "evidence"), { recursive: true, mode: 0o700 });
  const demand = demandRecord(authorizationRef);
  const event = initialEvent(demand);
  const state = stateRecord({ demand, event });
  writeCanonical(path.join(stateRoot, "demand.json"), demand);
  writeCanonical(path.join(stateRoot, "wakeflow-state.json"), state);
  writeFileSync(
    path.join(stateRoot, "controller-events.jsonl"),
    `${canonicalJson(event)}\n`,
    { mode: 0o600 },
  );
  return { stateRoot, ledgerRoot, authorizationRef, demand, event, state };
}

function podTransitionFixture(fixture) {
  const pod = podState(fixture.authorizationRef);
  const event = podInitializeEvent(pod);
  const nextState = stateRecord({ demand: fixture.demand, event, pod });
  const journal = {
    schemaVersion: 1,
    artifactKind: "wakeflow-state-transition",
    demandId: IDS.demand,
    command: event.command,
    createdAt: event.createdAt,
    expectedPreviousRevision: fixture.state.revision,
    expectedPreviousStateDigest: canonicalJsonDigest(fixture.state),
    previousState: fixture.state,
    nextEvent: event,
    nextEventDigest: canonicalJsonDigest(event),
    nextState,
    nextStateDigest: canonicalJsonDigest(nextState),
    artifactWrites: [],
  };
  return { pod, event, nextState, journal };
}

test("M4-T01 exposes the shared Pod record owner and its closed schema family", () => {
  const required = [
    "core/scripts/lib/wakeflow-pod-records.mjs",
    "core/schemas/wakeflow-pod/pod-scope.schema.json",
    "core/schemas/wakeflow-pod/launch-intent.schema.json",
    "core/schemas/wakeflow-pod/materialization-event.schema.json",
    "core/schemas/wakeflow-pod/creation-receipt.schema.json",
    "core/schemas/wakeflow-pod/resume-observation.schema.json",
    "core/schemas/wakeflow-pod/test-access-plan.schema.json",
    "core/schemas/wakeflow-pod/test-access-receipt.schema.json",
    "core/schemas/wakeflow-pod/close-intent.schema.json",
    "core/schemas/wakeflow-pod/close-receipt.schema.json",
  ];
  assert.deepEqual(
    required.filter((relative) => !existsSync(path.join(repositoryRoot, relative))),
    [],
  );

  for (const relative of required.filter((entry) => entry.endsWith(".json"))) {
    const schema = JSON.parse(readFileSync(path.join(repositoryRoot, relative), "utf8"));
    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
    assert.equal(schema.type, "object");
    assert.equal(schema.additionalProperties, false);
    assert.match(schema.$id, /^urn:wakeflow:internal:pod:/u);
  }
});

test("every runtime-accepted Pod record exemplar satisfies its matching closed JSON schema", () => {
  const materialization = {
    kind: podRecords.WAKEFLOW_POD_MATERIALIZATION_EVENT_KIND,
    schemaVersion: 1,
    programId: IDS.program,
    hostId: "codex",
    podId: IDS.pod,
    windowId: IDS.productWindow,
    launchOperationId: IDS.launch,
    attemptId: IDS.attempt,
    eventId: IDS.materializationEvent,
    previousEventDigest: null,
    status: "creating",
    observedAt: CREATED_AT,
  };
  const creation = {
    kind: podRecords.WAKEFLOW_POD_CREATION_RECEIPT_KIND,
    schemaVersion: 1,
    ...commonIdentity(),
    windowId: IDS.productWindow,
    launchOperationId: IDS.launch,
    bindingId: IDS.productBinding,
    launchIntentDigest: DIGEST_A,
    materializationFinalEventDigest: DIGEST_B,
    identityBindingDigest: DIGEST_C,
    resource: {
      kind: "git-worktree",
      actualCwd: "/private/wakeflow/product-a",
      gitTopLevel: "/private/wakeflow/product-a",
      gitCommonDir: "/private/wakeflow/repository/.git",
      head: "1".repeat(40),
      branch: null,
      detached: true,
      mainCheckout: false,
    },
    verifiedAt: CREATED_AT,
  };
  const resume = {
    kind: podRecords.WAKEFLOW_POD_RESUME_OBSERVATION_KIND,
    schemaVersion: 1,
    ...commonIdentity(),
    windowId: IDS.productWindow,
    observationId: IDS.observation,
    bindingId: IDS.productBinding,
    creationReceiptDigest: DIGEST_A,
    identityBindingDigest: DIGEST_B,
    liveness: "live",
    cwdMatch: true,
    currentHead: "2".repeat(40),
    branch: null,
    detached: true,
    dirty: false,
    observedAt: CREATED_AT,
  };
  const plan = testPlanInput();
  const testReceipt = {
    kind: podRecords.WAKEFLOW_POD_TEST_ACCESS_RECEIPT_KIND,
    schemaVersion: 1,
    ...commonIdentity(),
    probeId: IDS.probe,
    planDigest: podRecords.podRecordDigest(plan),
    bindingSetDigest: plan.bindingSetDigest,
    observerBindingId: IDS.testBinding,
    observerIdentityBindingDigest: DIGEST_B,
    status: "validated",
    capability: "direct-multi-root",
    targetObservations: [{
      windowId: IDS.productWindow,
      repositoryId: IDS.repository,
      bindingId: IDS.productBinding,
      creationReceiptDigest: DIGEST_C,
      accessResult: "readable",
      observedRootDigest: DIGEST_A,
      observedGitTopLevelDigest: DIGEST_B,
      observedGitCommonDirDigest: DIGEST_C,
      currentHead: "3".repeat(40),
    }],
    observedAt: CREATED_AT,
    recordedAt: "2026-08-09T01:02:04.000Z",
  };
  const closeIntent = {
    kind: podRecords.WAKEFLOW_POD_CLOSE_INTENT_KIND,
    schemaVersion: 1,
    ...commonIdentity(),
    windowId: IDS.productWindow,
    launchOperationId: IDS.launch,
    bindingId: IDS.productBinding,
    closeOperationId: IDS.close,
    role: "product",
    creationReceiptDigest: DIGEST_A,
    sessionIntent: "close",
    worktreeReportingPolicy: "observe-only",
    createdAt: CREATED_AT,
  };
  const recordsBySchema = new Map([
    ["pod-scope.schema.json", scopeRecord()],
    ["launch-intent.schema.json", productLaunchIntent()],
    ["materialization-event.schema.json", materialization],
    ["creation-receipt.schema.json", creation],
    ["resume-observation.schema.json", resume],
    ["test-access-plan.schema.json", plan],
    ["test-access-receipt.schema.json", testReceipt],
    ["close-intent.schema.json", closeIntent],
    ["close-receipt.schema.json", {
      kind: podRecords.WAKEFLOW_POD_CLOSE_RECEIPT_KIND,
      schemaVersion: 1,
      ...commonIdentity(),
      hostId: "claude-code",
      windowId: IDS.productWindow,
      closeOperationId: IDS.close,
      bindingId: IDS.productBinding,
      closeIntentDigest: podRecords.podRecordDigest(closeIntent),
      verificationStatus: "machine-verified",
      hostResultDigest: DIGEST_B,
      sessionStatus: "closed",
      worktreeStatus: "retained",
      confirmedAt: CREATED_AT,
      recordedAt: "2026-08-09T01:02:04.000Z",
    }],
  ]);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  for (const [file, input] of recordsBySchema) {
    const record = podRecords.validatePodRecord(input);
    const schema = JSON.parse(readFileSync(
      path.join(repositoryRoot, "core", "schemas", "wakeflow-pod", file),
      "utf8",
    ));
    const validate = ajv.compile(schema);
    assert.equal(validate(record), true, `${file}: ${JSON.stringify(validate.errors)}`);
    assert.equal(validate({ ...record, unowned: true }), false, `${file} must reject unknown fields`);
  }
});

test("Pod scope is create-once shaped, canonical, deeply frozen, and contains no mutable or semantic authority", () => {
  const scope = podRecords.createPodScopeRecord(scopeRecord());
  assert.equal(Object.isFrozen(scope), true);
  assert.equal(
    podRecords.podRecordRef(scope),
    `.wakeflow-local/runtime/hosts/codex/evidence/pods/${IDS.pod}/pod-scope.json`,
  );
  assert.equal(podRecords.podRecordDigest(scope), canonicalJsonDigest(scope));
  assert.equal(podRecords.podRecordCanonicalBytes(scope).at(-1), 0x0a);
  for (const forbidden of [
    "phase",
    "windowName",
    "operationIds",
    "stateRootRelative",
    "updatedAt",
    "rawHandle",
  ]) {
    assert.throws(
      () => podRecords.createPodScopeRecord({ ...scopeRecord(), [forbidden]: "forbidden" }),
      (error) => error?.code === "wakeflow-pod-record-fields",
    );
  }
});

test("launch intent separates product repository identity from control members and rejects host execution extras", () => {
  const product = podRecords.createPodLaunchIntentRecord(productLaunchIntent());
  assert.equal(
    podRecords.podRecordRef(product),
    `.wakeflow-local/runtime/hosts/codex/evidence/pods/${IDS.pod}/launch-intents/${IDS.launch}.json`,
  );
  const control = podRecords.createPodLaunchIntentRecord({
    kind: podRecords.WAKEFLOW_POD_LAUNCH_INTENT_KIND,
    schemaVersion: 1,
    ...commonIdentity(),
    windowId: IDS.controllerWindow,
    launchOperationId: IDS.launch,
    bindingId: IDS.controllerBinding,
    role: "controller",
    environmentIntent: "host-local",
    createdAt: CREATED_AT,
  });
  assert.equal(control.role, "controller");
  assert.throws(
    () => podRecords.createPodLaunchIntentRecord({ ...productLaunchIntent(), createPrompt: "secret" }),
    (error) => error?.code === "wakeflow-pod-record-fields",
  );
  assert.throws(
    () => podRecords.createPodLaunchIntentRecord({ ...productLaunchIntent(), environmentIntent: "host-local" }),
    (error) => error?.code === "wakeflow-pod-record-launch-product",
  );
  assert.throws(
    () => podRecords.createPodLaunchIntentRecord({
      ...control,
      repositoryId: IDS.repository,
    }),
    (error) => error?.code === "wakeflow-pod-record-launch-control",
  );
});

test("materialization events retain append-only attempt identity and closed status-specific fields", () => {
  const creating = podRecords.createPodMaterializationEventRecord({
    kind: podRecords.WAKEFLOW_POD_MATERIALIZATION_EVENT_KIND,
    schemaVersion: 1,
    programId: IDS.program,
    hostId: "codex",
    podId: IDS.pod,
    windowId: IDS.productWindow,
    launchOperationId: IDS.launch,
    attemptId: IDS.attempt,
    eventId: IDS.materializationEvent,
    previousEventDigest: null,
    status: "creating",
    observedAt: CREATED_AT,
  });
  assert.match(podRecords.podRecordRef(creating), /\/materialization\/pod-launch_.*\/events\/pod-materialization-event_.*\.json$/u);
  assert.throws(
    () => podRecords.createPodMaterializationEventRecord({
      ...creating,
      status: "pending",
    }),
    (error) => error?.code === "wakeflow-pod-record-materialization-fields",
  );
  const failed = podRecords.createPodMaterializationEventRecord({
    ...creating,
    status: "failed",
    failureCode: "host-create-failed",
  });
  assert.equal(failed.failureCode, "host-create-failed");
});

test("creation and resume records bind exact identity digests without copying a host handle", () => {
  const creation = podRecords.createPodCreationReceiptRecord({
    kind: podRecords.WAKEFLOW_POD_CREATION_RECEIPT_KIND,
    schemaVersion: 1,
    ...commonIdentity(),
    windowId: IDS.productWindow,
    launchOperationId: IDS.launch,
    bindingId: IDS.productBinding,
    launchIntentDigest: DIGEST_A,
    materializationFinalEventDigest: DIGEST_B,
    identityBindingDigest: DIGEST_C,
    resource: {
      kind: "git-worktree",
      actualCwd: "/private/wakeflow/product-a",
      gitTopLevel: "/private/wakeflow/product-a",
      gitCommonDir: "/private/wakeflow/repository/.git",
      head: "1".repeat(40),
      branch: null,
      detached: true,
      mainCheckout: false,
    },
    verifiedAt: CREATED_AT,
  });
  assert.equal(podRecords.podRecordRef(creation).endsWith("/creation-receipt.json"), true);
  assert.equal(JSON.stringify(creation).includes("thread"), false);
  assert.throws(
    () => podRecords.createPodCreationReceiptRecord({ ...creation, rawHandle: "secret" }),
    (error) => error?.code === "wakeflow-pod-record-fields",
  );
  const resume = podRecords.createPodResumeObservationRecord({
    kind: podRecords.WAKEFLOW_POD_RESUME_OBSERVATION_KIND,
    schemaVersion: 1,
    ...commonIdentity(),
    windowId: IDS.productWindow,
    observationId: IDS.observation,
    bindingId: IDS.productBinding,
    creationReceiptDigest: DIGEST_A,
    identityBindingDigest: DIGEST_B,
    liveness: "live",
    cwdMatch: true,
    currentHead: "2".repeat(40),
    branch: null,
    detached: true,
    dirty: false,
    observedAt: CREATED_AT,
  });
  assert.match(podRecords.podRecordRef(resume), /\/resume-observations\//u);
});

test("Test access plan freezes the stable binding set while receipt remains redacted and status-discriminated", () => {
  const plan = podRecords.createPodTestAccessPlanRecord(testPlanInput());
  assert.equal(plan.bindingSetDigest, podRecords.podTestAccessBindingSetDigest(plan));
  assert.equal(podRecords.podRecordRef(plan).endsWith(`/${IDS.probe}/plan.json`), true);
  assert.throws(
    () => podRecords.createPodTestAccessPlanRecord({ ...plan, bindingSetDigest: DIGEST_D }),
    (error) => error?.code === "wakeflow-pod-record-test-binding-set",
  );
  const receipt = podRecords.createPodTestAccessReceiptRecord({
    kind: podRecords.WAKEFLOW_POD_TEST_ACCESS_RECEIPT_KIND,
    schemaVersion: 1,
    ...commonIdentity(),
    probeId: IDS.probe,
    planDigest: podRecords.podRecordDigest(plan),
    bindingSetDigest: plan.bindingSetDigest,
    observerBindingId: IDS.testBinding,
    observerIdentityBindingDigest: DIGEST_B,
    status: "validated",
    capability: "direct-multi-root",
    targetObservations: [{
      windowId: IDS.productWindow,
      repositoryId: IDS.repository,
      bindingId: IDS.productBinding,
      creationReceiptDigest: DIGEST_C,
      accessResult: "readable",
      observedRootDigest: DIGEST_A,
      observedGitTopLevelDigest: DIGEST_B,
      observedGitCommonDirDigest: DIGEST_C,
      currentHead: "3".repeat(40),
    }],
    observedAt: CREATED_AT,
    recordedAt: "2026-08-09T01:02:04.000Z",
  });
  assert.equal(podRecords.podRecordRef(receipt).endsWith(`/${IDS.probe}/receipt.json`), true);
  assert.equal(JSON.stringify(receipt).includes("actualRoot"), false);
  assert.throws(
    () => podRecords.createPodTestAccessReceiptRecord({
      ...receipt,
      status: "blocked",
    }),
    (error) => error?.code === "wakeflow-pod-record-test-status",
  );
});

test("Pod Test record arrays reject accessors, hidden authority, symbols, and sparse slots without execution", () => {
  const target = testPlanInput().targets[0];
  let getterCalls = 0;
  const accessorTargets = [];
  Object.defineProperty(accessorTargets, "0", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return target;
    },
  });
  accessorTargets.length = 1;
  assert.throws(
    () => podRecords.createPodTestAccessPlanRecord({
      ...testPlanInput(),
      targets: accessorTargets,
    }),
    (error) => error?.code === "wakeflow-pod-record-shape",
  );
  assert.equal(getterCalls, 0);

  for (const property of ["hiddenAuthority", Symbol("array-authority")]) {
    const plan = testPlanInput();
    Object.defineProperty(plan.targets, property, {
      value: "smuggled",
      enumerable: typeof property === "symbol",
    });
    assert.throws(
      () => podRecords.createPodTestAccessPlanRecord(plan),
      (error) => error?.code === "wakeflow-pod-record-shape",
    );
  }

  const sparseObservations = new Array(1);
  assert.throws(
    () => podRecords.createPodTestAccessReceiptRecord({
      kind: podRecords.WAKEFLOW_POD_TEST_ACCESS_RECEIPT_KIND,
      schemaVersion: 1,
      ...commonIdentity(),
      probeId: IDS.probe,
      planDigest: DIGEST_A,
      bindingSetDigest: DIGEST_B,
      observerBindingId: IDS.testBinding,
      observerIdentityBindingDigest: DIGEST_C,
      status: "blocked",
      capability: "direct-multi-root",
      targetObservations: sparseObservations,
      reasonCode: "probe-execution-failed",
      observedAt: CREATED_AT,
      recordedAt: CREATED_AT,
    }),
    (error) => error?.code === "wakeflow-pod-record-shape",
  );
});

test("close intent and receipt bind machine proof while keeping host-owned worktree outcomes independent", () => {
  const intent = podRecords.createPodCloseIntentRecord({
    kind: podRecords.WAKEFLOW_POD_CLOSE_INTENT_KIND,
    schemaVersion: 1,
    ...commonIdentity(),
    windowId: IDS.productWindow,
    launchOperationId: IDS.launch,
    bindingId: IDS.productBinding,
    closeOperationId: IDS.close,
    role: "product",
    creationReceiptDigest: DIGEST_A,
    sessionIntent: "close",
    worktreeReportingPolicy: "observe-only",
    createdAt: CREATED_AT,
  });
  const receipt = podRecords.createPodCloseReceiptRecord({
    kind: podRecords.WAKEFLOW_POD_CLOSE_RECEIPT_KIND,
    schemaVersion: 1,
    ...commonIdentity(),
    hostId: "claude-code",
    windowId: IDS.productWindow,
    closeOperationId: IDS.close,
    bindingId: IDS.productBinding,
    closeIntentDigest: podRecords.podRecordDigest(intent),
    verificationStatus: "machine-verified",
    hostResultDigest: DIGEST_B,
    sessionStatus: "closed",
    worktreeStatus: "retained",
    confirmedAt: CREATED_AT,
    recordedAt: "2026-08-09T01:02:04.000Z",
  });
  assert.equal(podRecords.podRecordRef(intent).endsWith(`/${IDS.close}/intent.json`), true);
  assert.equal(podRecords.podRecordRef(receipt).endsWith(`/${IDS.close}/receipt.json`), true);
  assert.equal(receipt.verificationStatus, "machine-verified");
  assert.equal(receipt.hostResultDigest, DIGEST_B);
  assert.equal(receipt.worktreeStatus, "retained");
  assert.throws(
    () => podRecords.createPodCloseReceiptRecord({
      ...receipt,
      verificationStatus: "unmaterialized-not-found",
      sessionStatus: "not-found",
    }),
    /verification|host.*result|unmaterialized/iu,
  );
});

test("candidate state owns typed Pod membership while local tuples remain inert evidence references", () => {
  const pod = podState();
  const event = podInitializeEvent(pod);
  const state = stateRecord({ event, pod });
  const validated = validateDemandStateRecord(state);
  assert.equal(validated.pod.podId, IDS.pod);
  assert.equal(validated.pod.windows.length, 3);
  assert.equal(Object.isFrozen(validated.pod), true);

  const unsorted = structuredClone(state);
  unsorted.pod.windows.reverse();
  assert.throws(
    () => validateDemandStateRecord(unsorted),
    (error) => error?.code === "wakeflow-demand-core-pod-order",
  );
  const forgedSemanticMember = structuredClone(state);
  forgedSemanticMember.pod.windows[0].windowName = "Design__semantic";
  assert.throws(
    () => validateDemandStateRecord(forgedSemanticMember),
    (error) => error?.code === "wakeflow-demand-core-unknown-field",
  );
});

test("Pod state closes product claims, bound evidence, and Test access discriminated unions", () => {
  const boundPod = boundPodState();
  const bindingSetDigest = podBindingSetDigest(boundPod);
  const pending = {
    probeId: IDS.probe,
    attempt: 1,
    status: "pending",
    bindingSetDigest,
    productBindingCount: 1,
    plan: {
      ref: `.wakeflow-local/runtime/hosts/codex/evidence/pods/${IDS.pod}/test-access/${IDS.probe}/plan.json`,
      digest: DIGEST_A,
    },
    plannedAt: CREATED_AT,
  };
  const pendingState = stateRecord({ pod: { ...boundPod, testAccess: pending } });
  assert.equal(validateDemandStateRecord(pendingState).pod.testAccess.status, "pending");

  const validated = {
    ...pending,
    status: "validated",
    receipt: {
      ref: `.wakeflow-local/runtime/hosts/codex/evidence/pods/${IDS.pod}/test-access/${IDS.probe}/receipt.json`,
      digest: DIGEST_B,
    },
    capability: "direct-multi-root",
    observedAt: CREATED_AT,
    recordedAt: "2026-08-09T01:02:04.000Z",
  };
  assert.equal(
    validateDemandStateRecord(stateRecord({ pod: { ...boundPod, testAccess: validated } })).pod.testAccess.status,
    "validated",
  );
  const blocked = {
    ...pending,
    status: "blocked",
    receipt: validated.receipt,
    reasonCode: "probe-execution-failed",
    observedAt: CREATED_AT,
    recordedAt: "2026-08-09T01:02:04.000Z",
  };
  const blockedPod = { ...boundPod, phase: "blocked", testAccess: blocked };
  assert.equal(validateDemandStateRecord(stateRecord({ pod: blockedPod })).pod.testAccess.reasonCode, "probe-execution-failed");

  assert.throws(
    () => validateDemandStateRecord(stateRecord({
      pod: { ...boundPod, testAccess: { ...pending, receipt: validated.receipt } },
    })),
    (error) => error?.code === "wakeflow-demand-core-unknown-field",
  );
  assert.throws(
    () => validateDemandStateRecord(stateRecord({
      pod: { ...boundPod, testAccess: { ...validated, capability: "unsupported" } },
    })),
    (error) => error?.code === "wakeflow-demand-core-pod-state",
  );
  assert.throws(
    () => validateDemandStateRecord(stateRecord({
      pod: { ...boundPod, testAccess: { ...pending, bindingSetDigest: DIGEST_A } },
    })),
    (error) => error?.code === "wakeflow-demand-core-pod-state",
  );

  const missingProductClaim = podStateWithProduct();
  delete missingProductClaim.windows.find((entry) => entry.role === "product").resourceClaimStatus;
  assert.throws(
    () => validateDemandStateRecord(stateRecord({ pod: missingProductClaim })),
    (error) => error?.code === "wakeflow-demand-core-pod-state",
  );
  const incompleteBound = boundPodState();
  delete incompleteBound.windows.find((entry) => entry.role === "product").creationReceipt;
  assert.throws(
    () => validateDemandStateRecord(stateRecord({ pod: incompleteBound })),
    (error) => error?.code === "wakeflow-demand-core-pod-state",
  );
});

test("Pod authority requires isolated placement and one exact placement authorization digest", () => {
  const demand = {
    ...demandRecord(),
    executionPlacement: { mode: "main" },
  };
  const firstEvent = initialEvent(demand);
  const pod = podState();
  const event = podInitializeEvent(pod);
  const state = stateRecord({ demand, event, pod });
  assert.throws(
    () => validateDemandCoreStack({ demand, state, events: [firstEvent, event] }),
    (error) => error?.code === "wakeflow-demand-core-pod-placement",
  );

  const isolatedDemand = demandRecord();
  const isolatedFirstEvent = initialEvent(isolatedDemand);
  const forgedPod = { ...podState(), placementAuthorizationDigest: DIGEST_D };
  const forgedEvent = podInitializeEvent(forgedPod);
  const forgedState = stateRecord({ demand: isolatedDemand, event: forgedEvent, pod: forgedPod });
  assert.throws(
    () => validateDemandCoreStack({
      demand: isolatedDemand,
      state: forgedState,
      events: [isolatedFirstEvent, forgedEvent],
    }),
    (error) => error?.code === "wakeflow-demand-core-pod-placement",
  );
});

test("only the dedicated Pod event seam may change Pod authority and the event digest chain closes the final state", () => {
  const demand = demandRecord();
  const firstEvent = initialEvent(demand);
  const previousState = stateRecord({ demand, event: firstEvent });
  const pod = podState();
  const event = podInitializeEvent(pod);
  const nextState = stateRecord({ demand, event, pod });
  const transition = {
    schemaVersion: 1,
    artifactKind: "wakeflow-state-transition",
    demandId: IDS.demand,
    command: event.command,
    createdAt: event.createdAt,
    expectedPreviousRevision: 1,
    expectedPreviousStateDigest: canonicalJsonDigest(previousState),
    previousState,
    nextEvent: event,
    nextEventDigest: canonicalJsonDigest(event),
    nextState,
    nextStateDigest: canonicalJsonDigest(nextState),
    artifactWrites: [],
  };
  assert.equal(validateControllerEventRecord(event).podTransition.action, "initialize");
  assert.equal(validateStateTransitionRecord(transition, { demand }).nextState.pod.podId, IDS.pod);
  assert.equal(validateDemandCoreStack({
    demand,
    state: nextState,
    events: [firstEvent, event],
  }).state.pod.phase, "reserved");

  const genericEvent = structuredClone(event);
  genericEvent.command = "continue-demand";
  genericEvent.type = "state.transitioned";
  delete genericEvent.podTransition;
  const genericNext = stateRecord({ demand, event: genericEvent, pod });
  assert.throws(
    () => validateStateTransitionRecord({
      ...transition,
      command: genericEvent.command,
      nextEvent: genericEvent,
      nextEventDigest: canonicalJsonDigest(genericEvent),
      nextState: genericNext,
      nextStateDigest: canonicalJsonDigest(genericNext),
    }, { demand }),
    (error) => error?.code === "wakeflow-demand-core-pod-owner",
  );

  const businessChangingEvent = structuredClone(event);
  businessChangingEvent.to = "planned";
  const businessChangingState = stateRecord({
    demand,
    event: businessChangingEvent,
    pod,
  });
  assert.throws(
    () => validateStateTransitionRecord({
      ...transition,
      nextEvent: businessChangingEvent,
      nextEventDigest: canonicalJsonDigest(businessChangingEvent),
      nextState: businessChangingState,
      nextStateDigest: canonicalJsonDigest(businessChangingState),
    }, { demand }),
    (error) => error?.code === "wakeflow-demand-core-pod-owner",
  );
});

test("Pod bind and Test settlement deltas preserve their deterministic phase and frozen plan", () => {
  const demand = demandRecord();
  const previousPod = podState();
  const previousEvent = podInitializeEvent(previousPod);
  const previousState = stateRecord({ demand, event: previousEvent, pod: previousPod });
  const nextPod = structuredClone(previousPod);
  const selected = nextPod.windows.find((entry) => entry.role === "controller");
  const podRoot = `.wakeflow-local/runtime/hosts/codex/evidence/pods/${IDS.pod}`;
  selected.status = "bound";
  selected.materializationFinalEvent = {
    eventId: IDS.materializationEvent,
    ref: `${podRoot}/materialization/${selected.launchOperationId}/events/${IDS.materializationEvent}.json`,
    digest: DIGEST_B,
  };
  selected.identityBindingDigest = DIGEST_C;
  selected.creationReceipt = {
    ref: `${podRoot}/bindings/${selected.windowId}/creation-receipt.json`,
    digest: DIGEST_D,
  };
  nextPod.phase = "control-ready";
  const bindEvent = {
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: "event-pod-bind-forged-phase-0003",
    demandId: IDS.demand,
    createdAt: "2026-08-09T01:02:05.000Z",
    actor: "controller",
    command: "bind-pod-window",
    type: "pod.window-bound",
    previousRevision: 2,
    nextRevision: 3,
    from: "intake",
    to: "intake",
    reason: "bind one control member",
    decisionSummary: "The derived phase must reflect the remaining planned controls.",
    changedArtifacts: [],
    podTransition: {
      podId: IDS.pod,
      action: "bind-window",
      previousPodDigest: canonicalJsonDigest(previousPod),
      nextPodDigest: canonicalJsonDigest(nextPod),
      windowId: selected.windowId,
    },
  };
  const bindState = stateRecord({ demand, event: bindEvent, pod: nextPod });
  assert.throws(
    () => validateStateTransitionRecord({
      schemaVersion: 1,
      artifactKind: "wakeflow-state-transition",
      demandId: IDS.demand,
      command: bindEvent.command,
      createdAt: bindEvent.createdAt,
      expectedPreviousRevision: previousState.revision,
      expectedPreviousStateDigest: canonicalJsonDigest(previousState),
      previousState,
      nextEvent: bindEvent,
      nextEventDigest: canonicalJsonDigest(bindEvent),
      nextState: bindState,
      nextStateDigest: canonicalJsonDigest(bindState),
      artifactWrites: [],
    }, { demand }),
    (error) => error?.code === "wakeflow-demand-core-pod-transition",
  );

  const boundPod = boundPodState();
  const pendingAccess = {
    probeId: IDS.probe,
    attempt: 1,
    status: "pending",
    bindingSetDigest: podBindingSetDigest(boundPod),
    productBindingCount: 1,
    plan: { ref: `${podRoot}/test-access/${IDS.probe}/plan.json`, digest: DIGEST_A },
    plannedAt: CREATED_AT,
  };
  boundPod.testAccess = pendingAccess;
  const accessPreviousEvent = podInitializeEvent(boundPod);
  const accessPreviousState = stateRecord({ demand, event: accessPreviousEvent, pod: boundPod });
  const settledPod = structuredClone(boundPod);
  settledPod.testAccess = {
    ...settledPod.testAccess,
    status: "validated",
    plan: { ...settledPod.testAccess.plan, digest: DIGEST_B },
    receipt: { ref: `${podRoot}/test-access/${IDS.probe}/receipt.json`, digest: DIGEST_C },
    capability: "direct-multi-root",
    observedAt: "2026-08-09T01:02:04.000Z",
    recordedAt: "2026-08-09T01:02:05.000Z",
  };
  const settleEvent = {
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: "event-pod-settle-forged-plan-0003",
    demandId: IDS.demand,
    createdAt: "2026-08-09T01:02:05.000Z",
    actor: "controller",
    command: "record-pod-test-access",
    type: "pod.test-access-recorded",
    previousRevision: 2,
    nextRevision: 3,
    from: "intake",
    to: "intake",
    reason: "settle the exact Test access probe",
    decisionSummary: "Receipt settlement cannot rewrite the selected plan.",
    changedArtifacts: [],
    podTransition: {
      podId: IDS.pod,
      action: "settle-test-access",
      previousPodDigest: canonicalJsonDigest(boundPod),
      nextPodDigest: canonicalJsonDigest(settledPod),
      probeId: IDS.probe,
    },
  };
  const settledState = stateRecord({ demand, event: settleEvent, pod: settledPod });
  assert.throws(
    () => validateStateTransitionRecord({
      schemaVersion: 1,
      artifactKind: "wakeflow-state-transition",
      demandId: IDS.demand,
      command: settleEvent.command,
      createdAt: settleEvent.createdAt,
      expectedPreviousRevision: accessPreviousState.revision,
      expectedPreviousStateDigest: canonicalJsonDigest(accessPreviousState),
      previousState: accessPreviousState,
      nextEvent: settleEvent,
      nextEventDigest: canonicalJsonDigest(settleEvent),
      nextState: settledState,
      nextStateDigest: canonicalJsonDigest(settledState),
      artifactWrites: [],
    }, { demand }),
    (error) => error?.code === "wakeflow-demand-core-pod-transition",
  );
});

test("the locked Pod writer commits the exact state/event pair while the generic writer refuses ownership", () => {
  const fixture = makePublishedPodStateRoot();
  const transition = podTransitionFixture(fixture);
  const args = {
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    expectedPrevious: {
      revision: fixture.state.revision,
      stateDigest: canonicalJsonDigest(fixture.state),
    },
    event: transition.event,
    nextState: transition.nextState,
  };
  assert.throws(
    () => commitDemandStateTransition(args),
    (error) => error?.code === "wakeflow-demand-state-pod-owner",
  );
  assert.deepEqual(readdirSync(path.join(fixture.stateRoot, "transactions")), []);

  withStateRootLock(fixture.stateRoot, () => {
    commitDemandPodTransitionWhileLocked(args);
  });
  const loaded = loadDemandCoreRecords({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
  assert.equal(loaded.state.revision, 2);
  assert.deepEqual(loaded.events, [fixture.event, transition.event]);
  assert.deepEqual(loaded.state, transition.nextState);
  assert.deepEqual(readdirSync(path.join(fixture.stateRoot, "transactions")), []);
});

test("Pod recovery owns journal-only, event-written, and state-written forward completion", () => {
  for (const boundary of ["journal-only", "event-written", "state-written"]) {
    const fixture = makePublishedPodStateRoot();
    const transition = podTransitionFixture(fixture);
    writeCanonical(
      path.join(fixture.stateRoot, "transactions", "state-transition.json"),
      transition.journal,
    );
    if (boundary !== "journal-only") {
      writeFileSync(
        path.join(fixture.stateRoot, "controller-events.jsonl"),
        `${canonicalJson(fixture.event)}\n${canonicalJson(transition.event)}\n`,
        { mode: 0o600 },
      );
    }
    if (boundary === "state-written") {
      writeCanonical(path.join(fixture.stateRoot, "wakeflow-state.json"), transition.nextState);
    }

    if (boundary === "journal-only") {
      assert.throws(
        () => recoverDemandStateTransition({
          stateRoot: fixture.stateRoot,
          expectedProgramId: IDS.program,
          ledgerRoot: fixture.ledgerRoot,
        }),
        (error) => error?.code === "wakeflow-demand-state-recovery-conflict",
      );
      assert.equal(
        existsSync(path.join(fixture.stateRoot, "transactions", "state-transition.json")),
        true,
      );
    }

    let admissionCalls = 0;
    const recovered = withStateRootLock(fixture.stateRoot, () => (
      recoverDemandPodTransitionWhileLocked({
        stateRoot: fixture.stateRoot,
        expectedProgramId: IDS.program,
        ledgerRoot: fixture.ledgerRoot,
        admitRecoveryWhileLocked: ({ journal, podTransition }) => {
          admissionCalls += 1;
          assert.equal(journal.nextStateDigest, canonicalJsonDigest(transition.nextState));
          assert.deepEqual(podTransition, transition.event.podTransition);
          return Object.freeze({ admitted: true });
        },
      })
    ));
    assert.equal(recovered.status, "recovered", boundary);
    assert.equal(admissionCalls, 1, boundary);
    const loaded = loadDemandCoreRecords({
      stateRoot: fixture.stateRoot,
      expectedProgramId: IDS.program,
      ledgerRoot: fixture.ledgerRoot,
    });
    assert.deepEqual(loaded.events, [fixture.event, transition.event], boundary);
    assert.deepEqual(loaded.state, transition.nextState, boundary);
    assert.deepEqual(readdirSync(path.join(fixture.stateRoot, "transactions")), [], boundary);
  }
});

test("M4 current records replace the retired public-v2 Pod call graph", () => {
  for (const relative of [
    "core/scripts/wakeflow-pod.mjs",
    "core/scripts/lib/wakeflow-pod-runtime.mjs",
  ]) {
    assert.equal(existsSync(path.join(repositoryRoot, relative)), false, relative);
  }
  assert.equal(existsSync(path.join(repositoryRoot, "core/scripts/lib/wakeflow-pod-records.mjs")), true);
});
