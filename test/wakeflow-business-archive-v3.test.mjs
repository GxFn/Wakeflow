import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
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
import {
  createReviewCandidateArtifact,
  createTaskPackageArtifact,
  recordTargetResultArtifact,
} from "../core/scripts/lib/wakeflow-demand-artifact-service.mjs";
import {
  parseWakeflowConfigV3,
  serializeWakeflowConfigV3,
} from "../core/scripts/lib/wakeflow-config-v3.mjs";
import {
  publishInitialDemandPublication,
} from "../core/scripts/lib/wakeflow-demand-publication-service.mjs";
import {
  commitDemandLifecycleTransitionWhileLocked,
  loadDemandCoreRecordsWithArtifactClosure,
} from "../core/scripts/lib/wakeflow-demand-state-service.mjs";
import { withStateRootLock } from "../core/scripts/lib/wakeflow-state-lock.mjs";
import {
  createLedgerMemberReference,
  createLedgerRecord,
  loadLedgerRecord,
} from "../core/scripts/lib/wakeflow-ledger-records.mjs";
import {
  WAKEFLOW_POD_LAUNCH_INTENT_KIND,
  WAKEFLOW_POD_SCOPE_KIND,
} from "../core/scripts/lib/wakeflow-pod-records.mjs";
import * as podService from "../core/scripts/lib/wakeflow-pod-service.mjs";
import {
  parseWakeflowAssetBundle,
} from "../core/scripts/lib/wakeflow-template-renderer.mjs";
import {
  buildWakeflowAssetBundle,
} from "../tools/build-asset-bundle.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configFixturePath = path.join(
  repositoryRoot,
  "test/fixtures/wakeflow-config-v3/valid-minimal.json",
);
const sourceRoot = path.join(repositoryRoot, "core/template-sources");
const serviceUrl = new URL(
  "../core/scripts/lib/wakeflow-business-archive-service.mjs",
  import.meta.url,
);
const recordsUrl = new URL(
  "../core/scripts/lib/wakeflow-business-archive-records.mjs",
  import.meta.url,
);
const schemaRoot = path.join(repositoryRoot, "core/schemas/wakeflow-business-archive");

const IDS = Object.freeze({
  program: "program_11111111-1111-4111-8111-111111111111",
  demand: "demand_22222222-2222-4222-8222-222222222222",
  requirement: "requirement_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  archive: "archive_dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  archiveOther: "archive_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  repository: "repository_22222222-2222-4222-8222-222222222222",
  window: "window_88888888-8888-4888-8888-888888888888",
  taskPackage: "task-package_66666666-6666-4666-8666-666666666666",
  targetTask: "target-task_77777777-7777-4777-8777-777777777777",
  targetResult: "target-result_88888888-8888-4888-8888-888888888888",
  reviewCandidate: "review-candidate_99999999-9999-4999-8999-999999999999",
  pod: "pod_aaaaaaaa-0000-4000-8000-000000000001",
  placementConfirmation: "confirmation_aaaaaaaa-0000-4000-8000-000000000001",
  controllerWindow: "window_55555555-5555-4555-8555-555555555555",
  designWindow: "window_66666666-6666-4666-8666-666666666666",
  testWindow: "window_77777777-7777-4777-8777-777777777777",
  controllerBinding: "binding_aaaaaaaa-0000-4000-8000-000000000001",
  designBinding: "binding_aaaaaaaa-0000-4000-8000-000000000002",
  testBinding: "binding_aaaaaaaa-0000-4000-8000-000000000003",
  controllerLaunch: "pod-launch_aaaaaaaa-0000-4000-8000-000000000001",
  designLaunch: "pod-launch_aaaaaaaa-0000-4000-8000-000000000002",
  testLaunch: "pod-launch_aaaaaaaa-0000-4000-8000-000000000003",
  controllerClose: "pod-close_aaaaaaaa-0000-4000-8000-000000000001",
  designClose: "pod-close_aaaaaaaa-0000-4000-8000-000000000002",
  testClose: "pod-close_aaaaaaaa-0000-4000-8000-000000000003",
});

const CREATED_AT = "2026-08-07T01:00:00.000Z";
const TERMINAL_AT = "2026-08-07T03:00:00.000Z";
const ARCHIVED_AT = "2026-08-07T04:00:00.000Z";
const ARCHIVE_EVENT_ID = "event-business-archive-0003";
const bundle = parseWakeflowAssetBundle(buildWakeflowAssetBundle({ sourceRoot }));

async function optionalImport(url) {
  try {
    return { module: await import(url.href), error: null };
  } catch (error) {
    return { module: null, error };
  }
}

const serviceProbe = await optionalImport(serviceUrl);
const recordsProbe = await optionalImport(recordsUrl);
const behaviorSkip = serviceProbe.error
  ? "M2-T09 candidate business archive service is intentionally RED"
  : false;

function candidateTest(name, fn) {
  test(name, { skip: behaviorSkip }, fn);
}

function digestBytes(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function writeExact(file, content, mode = 0o600) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, content, { mode });
  if (process.platform !== "win32") chmodSync(file, mode);
}

function writeCanonical(file, value) {
  writeExact(file, `${canonicalJson(value)}\n`);
}

function configuredModel() {
  const raw = JSON.parse(readFileSync(configFixturePath, "utf8"));
  raw.program.interfaceLanguage = "en";
  raw.topology.repositories[0].path = "ProductA";
  raw.topology.supportSurfaces[0].path = "Design";
  raw.topology.supportSurfaces[1].path = "Test";
  raw.storage.ledgerRoot = "Ledger";
  return parseWakeflowConfigV3(raw);
}

function relative(root, ref) {
  return path.join(root, ...ref.split("/"));
}

function treeSnapshot(root) {
  const entries = new Map();
  const visit = (directory, prefix = "") => {
    for (const entry of readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const file = path.join(directory, entry.name);
      const ref = prefix ? `${prefix}/${entry.name}` : entry.name;
      const stat = lstatSync(file);
      if (stat.isSymbolicLink()) {
        entries.set(ref, `link:${readlinkSync(file)}`);
      } else if (stat.isDirectory()) {
        entries.set(`${ref}/`, `directory:${stat.mode & 0o777}`);
        visit(file, ref);
      } else if (stat.isFile()) {
        entries.set(ref, `file:${stat.mode & 0o777}:${readFileSync(file).toString("hex")}`);
      } else {
        entries.set(ref, `special:${stat.mode & 0o170000}`);
      }
    }
  };
  visit(root);
  return Object.fromEntries(entries);
}

function walk(value, visitor, valuePath = "$") {
  visitor(value, valuePath);
  if (!value || typeof value !== "object" || Buffer.isBuffer(value)) return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walk(entry, visitor, `${valuePath}/${index}`));
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    walk(entry, visitor, `${valuePath}/${key}`);
  }
}

function assertDeepFrozen(value) {
  walk(value, (entry, valuePath) => {
    if (entry && typeof entry === "object") {
      assert.equal(Object.isFrozen(entry), true, `${valuePath} must be frozen`);
    }
  });
}

function safeErrorView(error) {
  return JSON.stringify({
    name: error?.name,
    code: error?.code,
    message: error?.message,
    details: error?.details,
  });
}

function expectArchiveError(api, operation, {
  code = /wakeflow-business-archive-/u,
  workspaceRoot = null,
  secrets = [],
} = {}) {
  assert.throws(operation, (error) => {
    assert.equal(error instanceof api.WakeflowBusinessArchiveError, true, error?.stack);
    assert.match(error.code ?? "", code);
    const view = safeErrorView(error);
    if (workspaceRoot) assert.equal(view.includes(workspaceRoot), false, view);
    for (const secret of secrets) assert.equal(view.includes(secret), false, view);
    return true;
  });
}

function authorityDocuments() {
  return [
    "code-facts",
    "landing-plan",
    "non-goals",
    "original-plan",
    "requirement-design",
    "user-confirmation",
  ].map((role, index) => {
    const memberPath = `${String(index + 1).padStart(2, "0")}-${role}.md`;
    const content = `# ${role}\n\nTyped archive fixture authority.\n`;
    return {
      role,
      path: memberPath,
      mediaType: "text/markdown",
      digest: digestBytes(content),
      content,
    };
  });
}

function makeWorkspace({
  title = "Typed business archive fixture",
  placement = "main",
} = {}) {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-business-archive-v3-"));
  const model = configuredModel();
  for (const ref of [
    ".wakeflow-active/current",
    ".wakeflow-local/runtime/maintenance/transactions",
    ".wakeflow-local/runtime/hosts/codex/evidence/pods",
    ".wakeflow-local/runtime/hosts/codex/identity/window-bindings",
    ".wakeflow-local/runtime/shared/transport/demands",
    "Design",
    "Ledger",
    "Ledger/requirement-designs",
    "Ledger/goal-stage-confirmation",
    "Ledger/workspace/archive",
    "ProductA",
    "Test",
  ]) {
    const directory = relative(workspaceRoot, ref);
    const mode = ref === "Ledger" || ref.startsWith("Ledger/") ? 0o755 : 0o700;
    mkdirSync(directory, { recursive: true, mode });
    if (process.platform !== "win32") chmodSync(directory, mode);
  }
  writeExact(
    path.join(workspaceRoot, "wakeflow.config.json"),
    serializeWakeflowConfigV3(model),
  );

  const ledgerRoot = path.join(workspaceRoot, model.storage.ledgerRoot);
  const documents = authorityDocuments();
  const created = createLedgerRecord({
    ledgerRoot,
    expectedProgramId: IDS.program,
    record: {
      schemaVersion: 1,
      artifactKind: "wakeflow-requirement-record",
      requirementId: IDS.requirement,
      programId: IDS.program,
      title: "Typed business archive authority",
      status: "confirmed",
      relatedDemandIds: [IDS.demand],
      documents: documents.map(({ content: _content, ...document }) => document),
    },
    memberContents: Object.fromEntries(
      documents.map((document) => [document.path, document.content]),
    ),
  });
  const loadedRequirement = loadLedgerRecord({
    ledgerRoot,
    root: created.root,
    expectedFamily: "requirement",
    expectedProgramId: IDS.program,
  });
  const authorityRefs = documents.map((document) => (
    createLedgerMemberReference(loadedRequirement, document.path)
  ));
  let placementAuthorizationRef = null;
  if (placement === "isolated") {
    const memberPath = "01-isolated-placement-confirmation.md";
    const content = "# Isolated placement confirmation\n\nAuthorize this disposable Pod fixture.\n";
    const createdConfirmation = createLedgerRecord({
      ledgerRoot,
      expectedProgramId: IDS.program,
      record: {
        schemaVersion: 1,
        artifactKind: "wakeflow-confirmation-record",
        confirmationId: IDS.placementConfirmation,
        programId: IDS.program,
        demandId: IDS.demand,
        title: "Authorize isolated archive fixture",
        status: "confirmed",
        documents: [{
          role: "user-confirmation",
          path: memberPath,
          mediaType: "text/markdown",
          digest: digestBytes(content),
        }],
      },
      memberContents: { [memberPath]: content },
    });
    const confirmation = loadLedgerRecord({
      ledgerRoot,
      root: createdConfirmation.root,
      expectedFamily: "confirmation",
      expectedProgramId: IDS.program,
    });
    placementAuthorizationRef = createLedgerMemberReference(confirmation, memberPath);
  }
  const demand = {
    schemaVersion: 1,
    artifactKind: "wakeflow-demand",
    programId: IDS.program,
    demandId: IDS.demand,
    createdAt: CREATED_AT,
    title,
    goal: "Freeze one strict terminal demand into the portable business ledger.",
    completionDefinition: "The archive binds exact typed authority and deletes no unsafe source.",
    demandType: "requirement",
    source: {
      schemaVersion: 1,
      artifactKind: "wakeflow-demand-ledger-source",
      memberRefs: authorityRefs,
    },
    executionPlacement: placement === "isolated"
      ? { mode: "isolated", authorizationRef: placementAuthorizationRef }
      : { mode: "main" },
  };
  const authority = {
    schemaVersion: 1,
    artifactKind: "wakeflow-demand-authority",
    demandId: IDS.demand,
    demandRef: "demand.json",
    demandDigest: canonicalJsonDigest(demand),
    entryMode: "design-delivery",
    authorityRefs,
    testDecision: {
      mode: "controller-only",
      summary: "Run only the bounded candidate business archive regression.",
    },
  };
  publishInitialDemandPublication({
    workspaceRoot,
    ledgerRoot,
    expectedProgramId: IDS.program,
    bundle,
    language: "en",
    demand,
    authority,
    initialTransition: {
      eventId: "event-business-archive-initial-0001",
      createdAt: CREATED_AT,
      reason: "publish one strict ledger-backed archive fixture",
      decisionSummary: "Publish exact demand authority before terminal admission.",
    },
    expectedTodoRow: null,
  });
  return {
    workspaceRoot,
    currentRoot: path.join(workspaceRoot, ".wakeflow-active/current"),
    ledgerRoot,
    stateRoot: path.join(workspaceRoot, ".wakeflow-active/current", IDS.demand),
    model,
    demand,
    authority,
    authorityRefs,
    placementAuthorizationRef,
  };
}

function currentStack(fixture) {
  return loadDemandCoreRecordsWithArtifactClosure({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
}

function expectedPrevious(stack) {
  return { revision: stack.state.revision, stateDigest: stack.digests.state };
}

function terminalize(fixture, state, {
  eventId = `event-demand-${state}-0002`,
  type = `demand.${state}`,
} = {}) {
  const stack = currentStack(fixture);
  const event = {
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId,
    demandId: IDS.demand,
    createdAt: TERMINAL_AT,
    actor: "controller",
    command: state === "completed" ? "complete-demand" : "cancel-demand",
    type,
    previousRevision: stack.state.revision,
    nextRevision: stack.state.revision + 1,
    from: stack.state.state,
    to: state,
    reason: `admit the exact ${state} terminal archive fixture`,
    decisionSummary: `The Controller placed the demand in ${state}.`,
    changedArtifacts: [],
    lifecycleTransition: { action: state === "completed" ? "complete" : "cancel" },
  };
  const nextState = structuredClone(stack.state);
  nextState.revision = event.nextRevision;
  nextState.state = state;
  nextState.stateReason = event.reason;
  nextState.updatedAt = event.createdAt;
  nextState.lastEvent = {
    eventId: event.eventId,
    eventDigest: canonicalJsonDigest(event),
  };
  if (type !== `demand.${state}`) {
    writeFileSync(
      path.join(fixture.stateRoot, "controller-events.jsonl"),
      `${stack.events.map((entry) => canonicalJson(entry)).join("\n")}\n${canonicalJson(event)}\n`,
      { mode: 0o600 },
    );
    writeCanonical(path.join(fixture.stateRoot, "wakeflow-state.json"), nextState);
    return { state: nextState };
  } else {
    withStateRootLock(fixture.stateRoot, () => commitDemandLifecycleTransitionWhileLocked({
      stateRoot: fixture.stateRoot,
      expectedProgramId: IDS.program,
      ledgerRoot: fixture.ledgerRoot,
      expectedPrevious: expectedPrevious(stack),
      event,
      nextState,
    }));
  }
  return currentStack(fixture);
}

async function initializeReservedArchivePod(fixture) {
  const scope = {
    kind: WAKEFLOW_POD_SCOPE_KIND,
    schemaVersion: 1,
    programId: IDS.program,
    hostId: "codex",
    podId: IDS.pod,
    demandId: IDS.demand,
    placementAuthorizationDigest: canonicalJsonDigest(fixture.placementAuthorizationRef),
    createdAt: "2026-08-07T01:10:00.000Z",
  };
  const launchIntents = [
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
    createdAt: "2026-08-07T01:10:00.000Z",
  })).sort((left, right) => left.windowId.localeCompare(right.windowId));
  const plan = podService.planPodLaunchInitialization({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    scope,
    launchIntents,
    transition: {
      eventId: "event-business-archive-pod-initialize-0002",
      createdAt: "2026-08-07T01:10:00.000Z",
      reason: "Initialize the isolated archive Pod fixture",
      decisionSummary: "Freeze only the three planned control members needed for close admission.",
    },
  });
  await podService.applyPodLaunchInitializationPlan({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    plan,
    planDigest: plan.planDigest,
  });
  return currentStack(fixture);
}

async function closeReservedArchivePodMember(
  fixture,
  windowId,
  closeOperationId,
  ordinal,
) {
  let stack = currentStack(fixture);
  const minute = String(ordinal).padStart(2, "0");
  const planned = await podService.recordPodCloseIntent({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    windowId,
    closeOperationId,
    expectedPrevious: expectedPrevious(stack),
    transition: {
      eventId: `event-business-archive-pod-close-intent-${minute}`,
      createdAt: `2026-08-07T03:${minute}:00.000Z`,
      reason: `Freeze isolated archive Pod close intent ${minute}`,
      decisionSummary: "Select one unmaterialized member for a not-found host acknowledgement.",
    },
  });
  stack = currentStack(fixture);
  return podService.recordPodCloseReceipt({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    windowId,
    closeOperationId,
    expectedIntentDigest: planned.intent.digest,
    expectedPrevious: expectedPrevious(stack),
    observation: {
      kind: "unmaterialized-not-found",
      worktreeStatus: "not-applicable",
      confirmedAt: `2026-08-07T03:${minute}:01.000Z`,
    },
    transition: {
      eventId: `event-business-archive-pod-close-receipt-${minute}`,
      createdAt: `2026-08-07T03:${minute}:02.000Z`,
      reason: `Record isolated archive Pod close receipt ${minute}`,
      decisionSummary: "Acknowledge the exact absent host session without inventing a worktree action.",
    },
  });
}

function archiveInput(fixture, overrides = {}) {
  const stack = currentStack(fixture);
  return {
    workspaceRoot: fixture.workspaceRoot,
    expectedProgramId: IDS.program,
    demandId: IDS.demand,
    archiveId: IDS.archive,
    archivedAt: ARCHIVED_AT,
    archiveEventId: ARCHIVE_EVENT_ID,
    archiveReason: "publish the exact terminal business archive",
    conclusion: "The terminal demand is closed and portable.",
    expectedPrevious: expectedPrevious(stack),
    ...overrides,
  };
}

function transition(eventId, createdAt) {
  return {
    eventId,
    createdAt,
    reason: `commit ${eventId}`,
    decisionSummary: `Bind the exact immutable artifact for ${eventId}.`,
  };
}

function taskPackage(fixture) {
  const goalRef = fixture.authorityRefs.find((entry) => entry.role === "original-plan");
  return {
    schemaVersion: 1,
    artifactKind: "wakeflow-task-package",
    programId: IDS.program,
    demandId: IDS.demand,
    demandRef: "demand.json",
    demandDigest: canonicalJsonDigest(fixture.demand),
    demandAuthorityRef: "demand-authority.json",
    demandAuthorityDigest: canonicalJsonDigest(fixture.authority),
    createdAt: "2026-08-07T02:00:00.000Z",
    taskPackageId: IDS.taskPackage,
    targetTaskId: IDS.targetTask,
    windowId: IDS.window,
    repositoryId: IDS.repository,
    workType: "implementation",
    objective: "Exercise the terminal lifecycle archive gate.",
    confirmedContext: ["The Controller confirmed this exact archive fixture."],
    requirementRefs: [{
      role: "goal",
      ref: goalRef.memberRef,
      digest: goalRef.memberDigest,
      anchor: "original-plan",
    }],
    boundaries: {
      inScope: ["Only this disposable fixture."],
      outOfScope: ["Any real workspace."],
      forbidden: ["Do not mutate external repositories."],
    },
    completionExpectations: ["Return one strict TargetResult."],
    dependsOnTargetTaskIds: [],
    commitExpectation: "leave-uncommitted",
    acceptanceAnchors: [{
      anchorId: "A1",
      claim: "The fixture result is exact.",
      probe: "Inspect the immutable result.",
      expected: "The result matches the package.",
    }],
    reviewInputContract: {
      requiredKinds: ["test-output"],
      requiredAcceptanceAnchorIds: ["A1"],
    },
  };
}

function createActivePackage(fixture) {
  const stack = currentStack(fixture);
  const artifact = taskPackage(fixture);
  createTaskPackageArtifact({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    config: fixture.model,
    expectedPrevious: expectedPrevious(stack),
    artifact,
    transition: transition("event-business-archive-package-0002", artifact.createdAt),
  });
  return artifact;
}

function simulateDispatch(fixture) {
  const stack = currentStack(fixture);
  const event = {
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: "event-business-archive-dispatch-0003",
    demandId: IDS.demand,
    createdAt: "2026-08-07T02:10:00.000Z",
    actor: "controller",
    command: "dispatch-target",
    type: "target-task.dispatched",
    previousRevision: stack.state.revision,
    nextRevision: stack.state.revision + 1,
    from: stack.state.state,
    to: "dispatched",
    reason: "dispatch the exact disposable archive fixture target",
    decisionSummary: "The Controller dispatched the immutable package.",
    changedArtifacts: [],
  };
  const nextState = structuredClone(stack.state);
  nextState.revision = event.nextRevision;
  nextState.state = event.to;
  nextState.stateReason = event.reason;
  nextState.updatedAt = event.createdAt;
  nextState.lastEvent = { eventId: event.eventId, eventDigest: canonicalJsonDigest(event) };
  nextState.targetTasks[0].lifecycleStatus = "dispatched";
  writeExact(
    path.join(fixture.stateRoot, "controller-events.jsonl"),
    `${stack.events.map((entry) => canonicalJson(entry)).join("\n")}\n${canonicalJson(event)}\n`,
  );
  writeCanonical(path.join(fixture.stateRoot, "wakeflow-state.json"), nextState);
  return currentStack(fixture);
}

function targetResult(fixture, stack, packageRecord) {
  return {
    schemaVersion: 1,
    artifactKind: "wakeflow-target-result",
    programId: IDS.program,
    demandId: IDS.demand,
    demandRef: "demand.json",
    demandDigest: canonicalJsonDigest(fixture.demand),
    createdAt: "2026-08-07T02:20:00.000Z",
    targetResultId: IDS.targetResult,
    targetTaskId: IDS.targetTask,
    taskPackage: {
      taskPackageId: IDS.taskPackage,
      ref: `task-packages/${IDS.taskPackage}.json`,
      digest: canonicalJsonDigest(packageRecord),
    },
    assignment: { windowId: IDS.window, repositoryId: IDS.repository },
    observedState: {
      revision: stack.state.revision,
      eventId: stack.state.lastEvent.eventId,
      eventDigest: stack.state.lastEvent.eventDigest,
    },
    transport: {
      group: {
        id: "group-business-archive-fixture",
        ref: "transport/groups/group-business-archive-fixture.json",
        digest: `sha256:${"3".repeat(64)}`,
      },
      envelope: {
        id: "envelope-business-archive-fixture",
        ref: "transport/envelopes/envelope-business-archive-fixture.json",
        digest: `sha256:${"4".repeat(64)}`,
      },
    },
    outcome: "completed",
    summary: "The disposable target fixture completed.",
    repositoryChanges: [{
      repositoryId: IDS.repository,
      disposition: "left-uncommitted",
      commits: [],
    }],
    evidenceLocators: [{
      kind: "test-output",
      ref: "evidence/test-output.txt",
      digest: `sha256:${"5".repeat(64)}`,
    }],
    verification: ["The bounded fixture probe passed."],
    risks: [],
    craftMapping: [{
      kind: "acceptance-anchor",
      anchorId: "A1",
      evidenceRefs: [{
        ref: "evidence/test-output.txt",
        digest: `sha256:${"5".repeat(64)}`,
      }],
    }],
  };
}

function createPendingReview(fixture) {
  const packageRecord = createActivePackage(fixture);
  let stack = simulateDispatch(fixture);
  const result = targetResult(fixture, stack, packageRecord);
  recordTargetResultArtifact({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    config: fixture.model,
    expectedPrevious: expectedPrevious(stack),
    artifact: result,
    selection: "current",
    transition: transition("event-business-archive-result-0004", result.createdAt),
  });
  stack = currentStack(fixture);
  const results = [{
    targetTaskId: IDS.targetTask,
    targetResultId: IDS.targetResult,
    ref: `target-results/${IDS.targetTask}/${IDS.targetResult}.json`,
    digest: canonicalJsonDigest(result),
    outcome: "completed",
  }];
  const candidate = {
    schemaVersion: 1,
    artifactKind: "wakeflow-review-candidate",
    programId: IDS.program,
    demandId: IDS.demand,
    demandRef: "demand.json",
    demandDigest: canonicalJsonDigest(fixture.demand),
    createdAt: "2026-08-07T02:30:00.000Z",
    reviewCandidateId: IDS.reviewCandidate,
    fromState: {
      revision: stack.state.revision,
      stateDigest: stack.digests.state,
      eventId: stack.state.lastEvent.eventId,
      eventDigest: stack.state.lastEvent.eventDigest,
    },
    reviewScope: { targetTaskIds: [IDS.targetTask], excludedTargetTaskIds: [] },
    results,
    resultSetDigest: canonicalJsonDigest(results),
    readyTargetTaskIds: [IDS.targetTask],
    blockedTargetTaskIds: [],
    missingTargetTaskIds: [],
    allowedDecisions: ["accept", "blocked", "redesign", "rework"],
    structuralGaps: [],
  };
  createReviewCandidateArtifact({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    expectedPrevious: expectedPrevious(stack),
    artifact: candidate,
    transition: transition("event-business-archive-review-0005", candidate.createdAt),
  });
}

function terminalizeAfterFixtureProgress(fixture, state = "completed") {
  const stack = currentStack(fixture);
  const event = {
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: `event-business-archive-terminal-${stack.state.revision + 1}`,
    demandId: IDS.demand,
    createdAt: TERMINAL_AT,
    actor: "controller",
    command: state === "completed" ? "complete-demand" : "cancel-demand",
    type: `demand.${state}`,
    previousRevision: stack.state.revision,
    nextRevision: stack.state.revision + 1,
    from: stack.state.state,
    to: state,
    reason: "create an intentionally incomplete terminal closure for admission testing",
    decisionSummary: "The terminal marker cannot erase pending business lifecycle facts.",
    changedArtifacts: [],
    lifecycleTransition: { action: state === "completed" ? "complete" : "cancel" },
  };
  const nextState = structuredClone(stack.state);
  nextState.revision = event.nextRevision;
  nextState.state = state;
  nextState.stateReason = event.reason;
  nextState.updatedAt = event.createdAt;
  nextState.lastEvent = { eventId: event.eventId, eventDigest: canonicalJsonDigest(event) };
  writeFileSync(
    path.join(fixture.stateRoot, "controller-events.jsonl"),
    `${stack.events.map((entry) => canonicalJson(entry)).join("\n")}\n${canonicalJson(event)}\n`,
    { mode: 0o600 },
  );
  writeCanonical(path.join(fixture.stateRoot, "wakeflow-state.json"), nextState);
}

function assertNoAbsoluteOrRawBytes(value, workspaceRoot) {
  walk(value, (entry, valuePath) => {
    assert.equal(Buffer.isBuffer(entry), false, `${valuePath} cannot expose member bytes`);
    if (typeof entry === "string") {
      assert.equal(entry.includes(workspaceRoot), false, `${valuePath} leaked workspaceRoot`);
      assert.equal(path.isAbsolute(entry), false, `${valuePath} leaked an absolute path`);
    }
    if (valuePath !== "$" && /\/(?:content|bytes|workspaceRoot|ledgerRoot|stateRoot|configPath)$/u.test(valuePath)) {
      assert.fail(`${valuePath} is not an admitted plan summary field`);
    }
  });
}

function assertPlan(plan, fixture, input, terminalState) {
  assert.match(plan.planDigest, /^sha256:[0-9a-f]{64}$/u);
  assertDeepFrozen(plan);
  assertNoAbsoluteOrRawBytes(plan, fixture.workspaceRoot);

  const { manifest, businessSummary } = plan;
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.artifactKind, "wakeflow-archive-manifest");
  assert.equal(manifest.archiveId, input.archiveId);
  assert.equal(manifest.programId, IDS.program);
  assert.equal(manifest.archiveKind, "demand");
  assert.equal(manifest.yearMonth, "2026-08");
  assert.equal(manifest.conclusion, input.conclusion);
  assert.equal(manifest.transport.status, "archived");
  assert.match(manifest.transport.inventoryDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(manifest.transport.memberRefs.length, 1);
  assert.equal(manifest.transport.memberRefs[0].ref, "transport-summary.json");
  assert.deepEqual(manifest.source, {
    kind: "demand",
    demandId: IDS.demand,
    demandRef: "payload/demand.json",
    demandDigest: digestBytes(readFileSync(path.join(fixture.stateRoot, "demand.json"))),
  });
  const memberPaths = manifest.members.map((entry) => entry.path);
  assert.deepEqual(memberPaths, [...memberPaths].sort());
  assert.equal(new Set(memberPaths).size, memberPaths.length);
  for (const required of [
    "business-summary.json",
    "payload/controller-events.jsonl",
    "payload/demand-authority.json",
    "payload/demand.json",
    "payload/wakeflow-state.json",
    "transport-summary.json",
  ]) {
    assert.equal(memberPaths.includes(required), true, required);
  }
  assert.equal(
    manifest.members.find((entry) => entry.path === "business-summary.json")?.role,
    "summary",
  );
  assert.equal(
    memberPaths.some((entry) => /(?:^|\/)(?:groups|packets|envelopes|runs)(?:\/|$)/u.test(entry)),
    false,
  );

  assert.equal(businessSummary.schemaVersion, 1);
  assert.equal(businessSummary.artifactKind, "wakeflow-business-archive-summary");
  assert.equal(businessSummary.archiveId, input.archiveId);
  assert.equal(businessSummary.programId, IDS.program);
  assert.equal(businessSummary.demandId, IDS.demand);
  assert.equal(businessSummary.terminalAdmission.state, terminalState);
  assert.equal(businessSummary.archiveTransition.to, "archived");
  assert.equal(businessSummary.archiveTransition.eventId, input.archiveEventId);
  assert.deepEqual(businessSummary.transport, manifest.transport);
  assert.equal(plan.transportSummary.sourceStatus, "missing");
  assert.equal(plan.transportSummary.inventoryDigest, manifest.transport.inventoryDigest);
  assert.deepEqual(plan.transportSummary.groups, []);
  assert.deepEqual(plan.transportSummary.packets, []);
  assert.deepEqual(plan.transportSummary.envelopes, []);
  assert.deepEqual(plan.transportSummary.runs, []);
  assert.equal(businessSummary.todo, null);

  const summaryJson = canonicalJson(businessSummary);
  for (const expectedDigest of [
    canonicalJsonDigest(fixture.demand),
    digestBytes(readFileSync(path.join(fixture.stateRoot, "demand.json"))),
    canonicalJsonDigest(fixture.authority),
    digestBytes(readFileSync(path.join(fixture.stateRoot, "demand-authority.json"))),
  ]) {
    assert.equal(
      summaryJson.includes(expectedDigest),
      true,
      `summary must distinguish canonical identity and raw member digest ${expectedDigest}`,
    );
  }
}

test("T09 service exposes only the admitted internal candidate API", () => {
  assert.equal(serviceProbe.error, null, serviceProbe.error?.stack);
  assert.deepEqual(Object.keys(serviceProbe.module).sort(), [
    "WakeflowBusinessArchiveError",
    "commitDemandBusinessArchive",
    "inspectDemandBusinessArchive",
    "planDemandBusinessArchive",
    "recoverDemandBusinessArchive",
  ]);
});

test("T09 records module exists independently from the orchestration service", () => {
  assert.equal(recordsProbe.error, null, recordsProbe.error?.stack);
  assert.equal(typeof recordsProbe.module, "object");
});

test("T09 ships closed business and migration archive schemas", () => {
  assert.equal(existsSync(schemaRoot), true, schemaRoot);
  const files = readdirSync(schemaRoot).sort();
  assert.deepEqual(files, [
    "archive-transaction.schema.json",
    "business-summary.schema.json",
    "legacy-evidence-summary.schema.json",
    "legacy-source-descriptor.schema.json",
    "legacy-transport-summary.schema.json",
    "todo-history.schema.json",
    "transport-summary.schema.json",
  ]);
  const expectedKinds = new Map([
    ["archive-transaction.schema.json", "wakeflow-business-archive-transaction"],
    ["business-summary.schema.json", "wakeflow-business-archive-summary"],
    ["legacy-evidence-summary.schema.json", null],
    ["legacy-source-descriptor.schema.json", "wakeflow-legacy-demand-archive-source"],
    ["legacy-transport-summary.schema.json", "wakeflow-legacy-archive-transport-summary"],
    ["todo-history.schema.json", "wakeflow-business-archive-todo-history"],
    ["transport-summary.schema.json", "wakeflow-business-archive-transport-summary"],
  ]);
  for (const file of files) {
    const schema = JSON.parse(readFileSync(path.join(schemaRoot, file), "utf8"));
    assert.equal(schema.type, "object", file);
    assert.equal(schema.additionalProperties, false, file);
    assert.equal(schema.properties.artifactKind?.const ?? null, expectedKinds.get(file), file);
    if (file.startsWith("legacy-")) continue;
    assert.equal(
      schema.required.includes("archiveId"),
      file !== "transport-summary.schema.json",
      file,
    );
    assert.equal(schema.required.includes("demandId"), true, file);
  }
});

test("T09 candidate remains reverse-import isolated from frozen public-v2 entrypoints", () => {
  const publicFiles = [
    "core/scripts/wakeflow-state.mjs",
    "core/scripts/wakeflow-intake.mjs",
    "core/scripts/wakeflow-delivery.mjs",
    "core/scripts/wakeflow-demand-sequence.mjs",
    "core/scripts/wakeflow-cli.mjs",
    "core/lib/wakeflow-mcp-tools.mjs",
    "plugins/codex-wakeflow/scripts/wakeflow-state.mjs",
    "plugins/codex-wakeflow/scripts/wakeflow-intake.mjs",
    "plugins/claude-code-wakeflow/scripts/wakeflow-state.mjs",
    "plugins/claude-code-wakeflow/scripts/wakeflow-intake.mjs",
  ].filter((relativeFile) => existsSync(path.join(repositoryRoot, relativeFile)));
  for (const relativeFile of publicFiles) {
    const source = readFileSync(path.join(repositoryRoot, relativeFile), "utf8");
    assert.equal(source.includes("wakeflow-business-archive-service.mjs"), false, relativeFile);
    assert.equal(source.includes("wakeflow-business-archive-records.mjs"), false, relativeFile);
  }
});

test("T09 RED fixtures are strict disposable candidate roots before the missing archive owner runs", (t) => {
  const terminal = makeWorkspace();
  const active = makeWorkspace();
  const pending = makeWorkspace();
  t.after(() => {
    for (const fixture of [terminal, active, pending]) {
      rmSync(fixture.workspaceRoot, { recursive: true, force: true });
    }
  });

  assert.equal(terminalize(terminal, "completed").state.state, "completed");
  createActivePackage(active);
  terminalizeAfterFixtureProgress(active);
  const activeStack = currentStack(active);
  assert.equal(activeStack.state.state, "completed");
  assert.notEqual(activeStack.state.taskPackages[0].lifecycleStatus, "closed");

  createPendingReview(pending);
  terminalizeAfterFixtureProgress(pending);
  const pendingStack = currentStack(pending);
  assert.equal(pendingStack.state.state, "completed");
  assert.equal(pendingStack.state.review.status, "pending");
});

candidateTest("plan archives an empty strict T06 inventory, stays zero-write, and ignores legacy transport", (t) => {
  const api = serviceProbe.module;
  for (const terminalState of ["completed", "cancelled"]) {
    const fixture = makeWorkspace();
    t.after(() => rmSync(fixture.workspaceRoot, { recursive: true, force: true }));
    terminalize(fixture, terminalState);
    const input = archiveInput(fixture, {
      archiveId: terminalState === "completed" ? IDS.archive : IDS.archiveOther,
      archiveEventId: `event-business-archive-${terminalState}-0003`,
    });
    const before = treeSnapshot(fixture.workspaceRoot);
    const first = api.planDemandBusinessArchive(input);
    assert.deepEqual(treeSnapshot(fixture.workspaceRoot), before, `${terminalState} plan wrote state`);
    assertPlan(first, fixture, input, terminalState);
    assert.deepEqual(api.planDemandBusinessArchive(input), first, `${terminalState} plan drifted`);
    assert.deepEqual(treeSnapshot(fixture.workspaceRoot), before, `${terminalState} replay wrote state`);

    writeExact(
      path.join(fixture.workspaceRoot, ".wakeflow-local/legacy-transport/groups/private.json"),
      "{\"group\":\"legacy\",\"packet\":\"legacy\",\"run\":\"legacy\"}\n",
    );
    const withLegacyTransport = treeSnapshot(fixture.workspaceRoot);
    assert.deepEqual(
      api.planDemandBusinessArchive(input),
      first,
      `${terminalState} plan must not scan legacy local transport`,
    );
    assert.deepEqual(treeSnapshot(fixture.workspaceRoot), withLegacyTransport);
  }
});

candidateTest("M4-T05 archives isolated business authority only after every state-selected Pod close receipt", async (t) => {
  const api = serviceProbe.module;
  const fixture = makeWorkspace({ placement: "isolated" });
  t.after(() => rmSync(fixture.workspaceRoot, { recursive: true, force: true }));
  await initializeReservedArchivePod(fixture);
  terminalize(fixture, "cancelled");
  await closeReservedArchivePodMember(
    fixture,
    IDS.controllerWindow,
    IDS.controllerClose,
    10,
  );
  await closeReservedArchivePodMember(
    fixture,
    IDS.designWindow,
    IDS.designClose,
    11,
  );
  let input = archiveInput(fixture);
  expectArchiveError(api, () => api.planDemandBusinessArchive(input), {
    code: /pod-close/u,
    workspaceRoot: fixture.workspaceRoot,
  });
  assert.equal(existsSync(fixture.stateRoot), true);

  await closeReservedArchivePodMember(
    fixture,
    IDS.testWindow,
    IDS.testClose,
    12,
  );
  const closed = currentStack(fixture);
  assert.equal(closed.state.state, "cancelled");
  assert.equal(closed.state.pod.phase, "closed");
  assert.equal(closed.events.at(-1).command, "record-pod-close");
  input = archiveInput(fixture);
  const before = treeSnapshot(fixture.workspaceRoot);
  const plan = api.planDemandBusinessArchive(input);
  assert.deepEqual(treeSnapshot(fixture.workspaceRoot), before, "isolated archive planning must remain zero-write");
  assert.equal(JSON.stringify(plan).includes(fixture.workspaceRoot), false);
  assert.equal(JSON.stringify(plan).includes("codex-thread"), false);
  assert.equal(plan.businessSummary.terminalAdmission.eventId, closed.state.lastEvent.eventId);
  assert.equal(plan.businessSummary.terminalAdmission.state, "cancelled");
  const committed = api.commitDemandBusinessArchive(input);
  assert.equal(committed.archiveId, IDS.archive);
  assert.equal(committed.demandId, IDS.demand);
  assert.equal(existsSync(fixture.stateRoot), false);
  assert.equal(existsSync(path.join(
    fixture.ledgerRoot,
    "workspace/archive/2026-08",
    IDS.archive,
    "payload/wakeflow-state.json",
  )), true);
});

candidateTest("plan, commit, and recovery reject widened inputs and bad typed identities before writing", (t) => {
  const api = serviceProbe.module;
  const fixture = makeWorkspace();
  t.after(() => rmSync(fixture.workspaceRoot, { recursive: true, force: true }));
  terminalize(fixture, "completed");
  const input = archiveInput(fixture);
  const before = treeSnapshot(fixture.workspaceRoot);
  const cases = [
    [() => api.planDemandBusinessArchive({ ...input, ledgerRoot: fixture.ledgerRoot }), /input/u],
    [() => api.commitDemandBusinessArchive({ ...input, stateRoot: fixture.stateRoot }), /input/u],
    [() => api.recoverDemandBusinessArchive({
      workspaceRoot: fixture.workspaceRoot,
      expectedProgramId: IDS.program,
      demandId: IDS.demand,
      archiveId: IDS.archive,
      configPath: path.join(fixture.workspaceRoot, "wakeflow.config.json"),
    }), /input/u],
    [() => api.planDemandBusinessArchive({ ...input, archiveId: "Completed demand" }), /(?:input|id)/u],
    [() => api.planDemandBusinessArchive({ ...input, archivedAt: "2026-08-07" }), /(?:input|timestamp)/u],
    [() => api.planDemandBusinessArchive({ ...input, archivedAt: "2026-02-31T04:00:00.000Z" }), /(?:input|timestamp)/u],
  ];
  for (const [operation, code] of cases) {
    expectArchiveError(api, operation, { code, workspaceRoot: fixture.workspaceRoot });
    assert.deepEqual(treeSnapshot(fixture.workspaceRoot), before);
  }
});

candidateTest("nonterminal roots and terminal states with the wrong event tail fail without residue", (t) => {
  const api = serviceProbe.module;
  const nonterminal = makeWorkspace();
  const wrongTail = makeWorkspace();
  t.after(() => {
    rmSync(nonterminal.workspaceRoot, { recursive: true, force: true });
    rmSync(wrongTail.workspaceRoot, { recursive: true, force: true });
  });
  terminalize(wrongTail, "completed", { type: "state.completed" });
  const nonterminalBefore = treeSnapshot(nonterminal.workspaceRoot);
  expectArchiveError(api, () => api.planDemandBusinessArchive(archiveInput(nonterminal)), {
    code: /terminal/u,
    workspaceRoot: nonterminal.workspaceRoot,
  });
  assert.deepEqual(treeSnapshot(nonterminal.workspaceRoot), nonterminalBefore);
  const wrongTailBefore = treeSnapshot(wrongTail.workspaceRoot);
  assert.throws(
    () => api.planDemandBusinessArchive(archiveInput(wrongTail)),
    (error) => error?.code === "wakeflow-demand-core-lifecycle-event",
  );
  assert.deepEqual(treeSnapshot(wrongTail.workspaceRoot), wrongTailBefore);
  for (const fixture of [nonterminal, wrongTail]) {
    assert.equal(readdirSync(path.join(fixture.stateRoot, "transactions")).length, 0);
  }
});

candidateTest("terminal marker cannot hide an active package or pending review", (t) => {
  const api = serviceProbe.module;
  const active = makeWorkspace();
  const pending = makeWorkspace();
  t.after(() => {
    rmSync(active.workspaceRoot, { recursive: true, force: true });
    rmSync(pending.workspaceRoot, { recursive: true, force: true });
  });

  createActivePackage(active);
  terminalizeAfterFixtureProgress(active);
  createPendingReview(pending);
  terminalizeAfterFixtureProgress(pending);
  assert.equal(currentStack(pending).state.review.status, "pending");

  for (const fixture of [active, pending]) {
    const before = treeSnapshot(fixture.workspaceRoot);
    expectArchiveError(api, () => api.planDemandBusinessArchive(archiveInput(fixture)), {
      code: /(?:terminal|closure|lifecycle|review)/u,
      workspaceRoot: fixture.workspaceRoot,
    });
    assert.deepEqual(treeSnapshot(fixture.workspaceRoot), before);
    assert.equal(readdirSync(path.join(fixture.stateRoot, "transactions")).length, 0);
  }
});

candidateTest("privacy rejection is field-aware, bounded, non-mutating, and never echoes the finding", (t) => {
  const api = serviceProbe.module;
  const fixture = makeWorkspace();
  t.after(() => rmSync(fixture.workspaceRoot, { recursive: true, force: true }));
  terminalize(fixture, "completed");
  const secret = "ghp_WakeflowBusinessArchiveSecret1234567890";
  const privatePath = "/Users/customer/private-product";
  const input = archiveInput(fixture, {
    archiveReason: `credential ${secret} from ${privatePath}`,
  });
  const before = treeSnapshot(fixture.workspaceRoot);
  expectArchiveError(api, () => api.planDemandBusinessArchive(input), {
    code: /privacy/u,
    workspaceRoot: fixture.workspaceRoot,
    secrets: [secret, privatePath],
  });
  assert.deepEqual(treeSnapshot(fixture.workspaceRoot), before);
  assert.equal(readdirSync(path.join(fixture.stateRoot, "transactions")).length, 0);
});

candidateTest("commit, exact replay, and recovery converge on one archive while conflicting identities fail closed", (t) => {
  const api = serviceProbe.module;
  const fixture = makeWorkspace();
  t.after(() => rmSync(fixture.workspaceRoot, { recursive: true, force: true }));
  terminalize(fixture, "completed");
  const input = archiveInput(fixture);

  const first = api.commitDemandBusinessArchive(input);
  assert.equal(first.archiveId, IDS.archive);
  assert.equal(first.demandId, IDS.demand);
  assert.match(first.manifestDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(existsSync(fixture.stateRoot), false);
  const archiveRoot = path.join(
    fixture.ledgerRoot,
    "workspace/archive/2026-08",
    IDS.archive,
  );
  assert.equal(existsSync(path.join(archiveRoot, "archive-manifest.json")), true);
  assert.equal(existsSync(path.join(archiveRoot, "business-summary.json")), true);
  assert.equal(existsSync(path.join(archiveRoot, "index.md")), false);

  const replay = api.commitDemandBusinessArchive(input);
  assert.equal(replay.archiveId, first.archiveId);
  assert.equal(replay.demandId, first.demandId);
  assert.equal(replay.manifestDigest, first.manifestDigest);
  const recovered = api.recoverDemandBusinessArchive({
    workspaceRoot: fixture.workspaceRoot,
    expectedProgramId: IDS.program,
    demandId: IDS.demand,
    archiveId: IDS.archive,
  });
  assert.equal(recovered.archiveId, first.archiveId);
  assert.equal(recovered.demandId, first.demandId);
  assert.equal(recovered.manifestDigest, first.manifestDigest);

  expectArchiveError(api, () => api.commitDemandBusinessArchive({
    ...input,
    conclusion: "A divergent conclusion cannot reuse one archive ID.",
  }), {
    code: /(?:conflict|replay)/u,
    workspaceRoot: fixture.workspaceRoot,
  });
  expectArchiveError(api, () => api.commitDemandBusinessArchive({
    ...input,
    archiveId: IDS.archiveOther,
  }), {
    code: /(?:conflict|unique|demand)/u,
    workspaceRoot: fixture.workspaceRoot,
  });
  assert.equal(existsSync(fixture.stateRoot), false);
  assert.equal(existsSync(path.join(fixture.ledgerRoot, "workspace/archive/2026-08", IDS.archiveOther)), false);
});
