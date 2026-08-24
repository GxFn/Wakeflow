import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
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

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const authorityModule = "../core/scripts/lib/wakeflow-target-result-authority.mjs";
const artifactServiceModule = "../core/scripts/lib/wakeflow-demand-artifact-service.mjs";
const stateServiceModule = "../core/scripts/lib/wakeflow-demand-state-service.mjs";

const IDS = Object.freeze({
  program: "program_11111111-1111-4111-8111-111111111111",
  demand: "demand_22222222-2222-4222-8222-222222222222",
  repository: "repository_22222222-2222-4222-8222-222222222222",
  window: "window_88888888-8888-4888-8888-888888888888",
  taskPackage: "task-package_66666666-6666-4666-8666-666666666666",
  targetTask: "target-task_77777777-7777-4777-8777-777777777777",
  targetResult: "target-result_88888888-8888-4888-8888-888888888888",
  correctedResult: "target-result_89898989-8989-4989-8989-898989898989",
  historicalResult: "target-result_8a8a8a8a-8a8a-4a8a-8a8a-8a8a8a8a8a8a",
  orphanResult: "target-result_8b8b8b8b-8b8b-4b8b-8b8b-8b8b8b8b8b8b",
  reviewCandidate: "review-candidate_99999999-9999-4999-8999-999999999999",
});

const configFixture = JSON.parse(readFileSync(
  path.join(repositoryRoot, "test/fixtures/wakeflow-config-v3/valid-minimal.json"),
  "utf8",
));

function byteDigest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function writeCanonical(file, value) {
  writeFileSync(file, `${canonicalJson(value)}\n`, { mode: 0o600 });
  if (process.platform !== "win32") chmodSync(file, 0o600);
}

function initialArtifactState() {
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

async function makeFixture() {
  const {
    createLedgerMemberReference,
    createLedgerRecord,
    loadLedgerRecord,
  } = await import("../core/scripts/lib/wakeflow-ledger-records.mjs");
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-target-result-authority-"));
  const ledgerRoot = path.join(root, "ledger");
  mkdirSync(path.join(ledgerRoot, "requirement-designs"), { recursive: true, mode: 0o700 });
  const roles = [
    "original-plan",
    "requirement-design",
    "code-facts",
    "landing-plan",
    "non-goals",
    "user-confirmation",
    "test-environment",
  ];
  const documents = roles.map((role, index) => {
    const memberPath = `${String(index + 1).padStart(2, "0")}-${role}.md`;
    const content = `# ${role}\n`;
    return {
      role,
      path: memberPath,
      mediaType: "text/markdown",
      digest: byteDigest(content),
      content,
    };
  });
  const requirementId = "requirement_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const createdLedger = createLedgerRecord({
    ledgerRoot,
    expectedProgramId: IDS.program,
    record: {
      schemaVersion: 1,
      artifactKind: "wakeflow-requirement-record",
      requirementId,
      programId: IDS.program,
      title: "T07 TargetResult authority integration",
      status: "confirmed",
      relatedDemandIds: [IDS.demand],
      documents: documents.map(({ content: _content, ...document }) => document),
    },
    memberContents: Object.fromEntries(documents.map((document) => [document.path, document.content])),
  });
  const loadedLedger = loadLedgerRecord({
    ledgerRoot,
    root: createdLedger.root,
    expectedFamily: "requirement",
    expectedProgramId: IDS.program,
  });
  const authorityRefs = documents.map((document) => createLedgerMemberReference(loadedLedger, document.path));
  const demand = {
    schemaVersion: 1,
    artifactKind: "wakeflow-demand",
    programId: IDS.program,
    demandId: IDS.demand,
    createdAt: "2026-08-07T02:00:00.000Z",
    title: "T07 TargetResult authority integration",
    goal: "Read only the exact TargetResult tuples selected by candidate state.",
    completionDefinition: "Local transport results cannot affect candidate result authority.",
    demandType: "requirement",
    source: {
      artifactKind: "wakeflow-todo-lineage-ref",
      schemaVersion: 1,
      boardRef: ".wakeflow-active/current/global-todo-board.md",
      todoId: "TODO-M2-T07-AUTHORITY",
      intakeRowDigest: `sha256:${"b".repeat(64)}`,
    },
    executionPlacement: { mode: "main" },
  };
  const environmentRef = authorityRefs.find((entry) => entry.role === "test-environment");
  const authority = {
    schemaVersion: 1,
    artifactKind: "wakeflow-demand-authority",
    demandId: IDS.demand,
    demandRef: "demand.json",
    demandDigest: canonicalJsonDigest(demand),
    entryMode: "design-delivery",
    authorityRefs,
    testDecision: {
      mode: "real-environment",
      summary: "Use the exact confirmed real-environment strategy.",
      environmentSpecRef: environmentRef.memberRef,
    },
  };
  const initialEvent = {
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: "event-initial-authority-0001",
    demandId: IDS.demand,
    createdAt: demand.createdAt,
    actor: "controller",
    command: "init",
    type: "state.initialized",
    previousRevision: 0,
    nextRevision: 1,
    from: null,
    to: "intake",
    reason: "initialize strict T07 candidate demand",
    decisionSummary: "Publish exact demand identity and frozen authority.",
    changedArtifacts: [
      { artifactKind: "wakeflow-demand", ref: "demand.json", digest: canonicalJsonDigest(demand) },
      { artifactKind: "wakeflow-demand-authority", ref: "demand-authority.json", digest: canonicalJsonDigest(authority) },
    ],
  };
  const state = {
    schemaVersion: 1,
    artifactKind: "wakeflow-state",
    programId: IDS.program,
    demandId: IDS.demand,
    demandRef: "demand.json",
    demandDigest: canonicalJsonDigest(demand),
    demandAuthorityRef: "demand-authority.json",
    demandAuthorityDigest: canonicalJsonDigest(authority),
    revision: 1,
    state: "intake",
    stateReason: initialEvent.reason,
    updatedAt: initialEvent.createdAt,
    lastEvent: {
      eventId: initialEvent.eventId,
      eventDigest: canonicalJsonDigest(initialEvent),
    },
    ...initialArtifactState(),
  };
  const stateRoot = path.join(root, IDS.demand);
  for (const directory of [
    stateRoot,
    path.join(stateRoot, "task-packages"),
    path.join(stateRoot, "target-results"),
    path.join(stateRoot, "review-candidates"),
    path.join(stateRoot, "test-cards"),
    path.join(stateRoot, "evidence"),
    path.join(stateRoot, "transactions"),
  ]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") chmodSync(directory, 0o700);
  }
  writeCanonical(path.join(stateRoot, "demand.json"), demand);
  writeCanonical(path.join(stateRoot, "demand-authority.json"), authority);
  writeCanonical(path.join(stateRoot, "wakeflow-state.json"), state);
  writeFileSync(
    path.join(stateRoot, "controller-events.jsonl"),
    `${canonicalJson(initialEvent)}\n`,
    { mode: 0o600 },
  );
  return {
    root,
    stateRoot,
    ledgerRoot,
    demand,
    authority,
    goalRef: authorityRefs.find((entry) => entry.role === "original-plan"),
    config: structuredClone(configFixture),
  };
}

async function currentStack(fixture) {
  const { loadDemandCoreRecordsWithArtifactClosure } = await import(stateServiceModule);
  return loadDemandCoreRecordsWithArtifactClosure({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
}

function expectedPrevious(stack) {
  return { revision: stack.state.revision, stateDigest: stack.digests.state };
}

function artifactTransition(eventId, createdAt) {
  return {
    eventId,
    createdAt,
    reason: `commit ${eventId}`,
    decisionSummary: `Bind the exact immutable artifact for ${eventId}.`,
  };
}

function taskPackageRecord(fixture) {
  return {
    schemaVersion: 1,
    artifactKind: "wakeflow-task-package",
    programId: IDS.program,
    demandId: IDS.demand,
    demandRef: "demand.json",
    demandDigest: canonicalJsonDigest(fixture.demand),
    createdAt: "2026-08-07T03:01:00.000Z",
    demandAuthorityRef: "demand-authority.json",
    demandAuthorityDigest: canonicalJsonDigest(fixture.authority),
    taskPackageId: IDS.taskPackage,
    targetTaskId: IDS.targetTask,
    windowId: IDS.window,
    repositoryId: IDS.repository,
    workType: "implementation",
    objective: "Implement the bounded target change.",
    confirmedContext: ["The controller confirmed this exact execution context."],
    requirementRefs: [{
      role: "goal",
      ref: fixture.goalRef.memberRef,
      digest: fixture.goalRef.memberDigest,
      anchor: "original-plan",
    }],
    boundaries: {
      inScope: ["Only the assigned target change."],
      outOfScope: ["Unrelated repositories and demands."],
      forbidden: ["Do not mutate controller authority."],
    },
    completionExpectations: ["Return one strict TargetResult."],
    dependsOnTargetTaskIds: [],
    commitExpectation: "leave-uncommitted",
    acceptanceAnchors: [{
      anchorId: "A1",
      claim: "The target behavior exists.",
      probe: "Run the focused test.",
      expected: "The focused test passes.",
    }],
    reviewInputContract: {
      requiredKinds: ["test-output"],
      requiredAcceptanceAnchorIds: ["A1"],
    },
  };
}

function targetResultRecord(fixture, stack, taskPackage, {
  targetResultId = IDS.targetResult,
  createdAt = "2026-08-07T03:03:00.000Z",
  outcome = "completed",
  supersedes = null,
} = {}) {
  return {
    schemaVersion: 1,
    artifactKind: "wakeflow-target-result",
    programId: IDS.program,
    demandId: IDS.demand,
    demandRef: "demand.json",
    demandDigest: canonicalJsonDigest(fixture.demand),
    createdAt,
    targetResultId,
    targetTaskId: IDS.targetTask,
    taskPackage: {
      taskPackageId: taskPackage.taskPackageId,
      ref: `task-packages/${taskPackage.taskPackageId}.json`,
      digest: canonicalJsonDigest(taskPackage),
    },
    assignment: {
      windowId: IDS.window,
      repositoryId: IDS.repository,
    },
    observedState: {
      revision: stack.state.revision,
      eventId: stack.state.lastEvent.eventId,
      eventDigest: stack.state.lastEvent.eventDigest,
    },
    transport: {
      group: {
        id: "group-1",
        ref: "transport/groups/group-1.json",
        digest: `sha256:${"3".repeat(64)}`,
      },
      envelope: {
        id: "envelope-1",
        ref: "transport/envelopes/envelope-1.json",
        digest: `sha256:${"4".repeat(64)}`,
      },
    },
    outcome,
    summary: outcome === "blocked"
      ? "The target returned an explicit blocker for Controller review."
      : "The assigned change and focused verification completed.",
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
    verification: ["Focused test passed."],
    risks: outcome === "blocked" ? ["Controller action is required."] : [],
    craftMapping: [{
      kind: "acceptance-anchor",
      anchorId: "A1",
      evidenceRefs: [{
        ref: "evidence/test-output.txt",
        digest: `sha256:${"5".repeat(64)}`,
      }],
    }],
    ...(supersedes ? { supersedes } : {}),
  };
}

function reviewCandidateRecord(fixture, stack, result) {
  const results = [{
    targetTaskId: IDS.targetTask,
    targetResultId: result.targetResultId,
    ref: `target-results/${IDS.targetTask}/${result.targetResultId}.json`,
    digest: canonicalJsonDigest(result),
    outcome: result.outcome,
  }];
  return {
    schemaVersion: 1,
    artifactKind: "wakeflow-review-candidate",
    programId: IDS.program,
    demandId: IDS.demand,
    demandRef: "demand.json",
    demandDigest: canonicalJsonDigest(fixture.demand),
    createdAt: "2026-08-07T03:06:00.000Z",
    reviewCandidateId: IDS.reviewCandidate,
    fromState: {
      revision: stack.state.revision,
      stateDigest: stack.digests.state,
      eventId: stack.state.lastEvent.eventId,
      eventDigest: stack.state.lastEvent.eventDigest,
    },
    reviewScope: {
      targetTaskIds: [IDS.targetTask],
      excludedTargetTaskIds: [],
    },
    results,
    resultSetDigest: canonicalJsonDigest(results),
    readyTargetTaskIds: result.outcome === "blocked" ? [] : [IDS.targetTask],
    blockedTargetTaskIds: result.outcome === "blocked" ? [IDS.targetTask] : [],
    missingTargetTaskIds: [],
    allowedDecisions: ["accept", "blocked", "redesign", "rework"],
    structuralGaps: [],
  };
}

async function commitTaskLifecycle(fixture, lifecycleStatus, {
  eventId,
  createdAt,
  stateName = lifecycleStatus,
  command = `set-${lifecycleStatus}`,
  type = `target-task.${lifecycleStatus}`,
  clearReview = false,
  closePackage = false,
} = {}) {
  const stack = await currentStack(fixture);
  const event = {
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId,
    demandId: IDS.demand,
    createdAt,
    actor: "controller",
    command,
    type,
    previousRevision: stack.state.revision,
    nextRevision: stack.state.revision + 1,
    from: stack.state.state,
    to: stateName,
    reason: `Move the exact target task to ${lifecycleStatus} for the T07 authority fixture.`,
    decisionSummary: `The Controller selected lifecycle ${lifecycleStatus}.`,
    changedArtifacts: [],
  };
  const nextState = structuredClone(stack.state);
  nextState.revision = event.nextRevision;
  nextState.state = event.to;
  nextState.stateReason = event.reason;
  nextState.updatedAt = event.createdAt;
  nextState.lastEvent = {
    eventId: event.eventId,
    eventDigest: canonicalJsonDigest(event),
  };
  nextState.targetTasks.find((entry) => entry.targetTaskId === IDS.targetTask).lifecycleStatus = lifecycleStatus;
  if (closePackage) {
    nextState.taskPackages.find((entry) => entry.taskPackageId === IDS.taskPackage).lifecycleStatus = "closed";
  }
  if (clearReview) nextState.review = initialArtifactState().review;
  // M3 owns the eventual candidate dispatch/review-decision service. Until
  // that exists, mirror the established T05 integration fixture: publish one
  // schema-valid event/state prerequisite, then exercise the real T05
  // package/result/review writers and the T07 reader against that strict
  // stack. T07 must not invent an ordinary transition that T04 forbids from
  // changing artifact-owned targetTasks.
  writeFileSync(
    path.join(fixture.stateRoot, "controller-events.jsonl"),
    `${stack.events.map((entry) => canonicalJson(entry)).join("\n")}\n${canonicalJson(event)}\n`,
    { mode: 0o600 },
  );
  writeCanonical(path.join(fixture.stateRoot, "wakeflow-state.json"), nextState);
  return currentStack(fixture);
}

async function createDispatchedTask(fixture) {
  const { createTaskPackageArtifact } = await import(artifactServiceModule);
  const taskPackage = taskPackageRecord(fixture);
  let stack = await currentStack(fixture);
  createTaskPackageArtifact({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    config: fixture.config,
    expectedPrevious: expectedPrevious(stack),
    artifact: taskPackage,
    transition: artifactTransition("event-task-package-created-0002", taskPackage.createdAt),
  });
  stack = await commitTaskLifecycle(fixture, "dispatched", {
    eventId: "event-target-dispatched-0003",
    createdAt: "2026-08-07T03:02:00.000Z",
    command: "dispatch-target",
    type: "target-task.dispatched",
  });
  return { taskPackage, stack };
}

async function recordResult(fixture, taskPackage, {
  targetResultId = IDS.targetResult,
  createdAt = "2026-08-07T03:03:00.000Z",
  outcome = "completed",
  selection = "current",
  supersedes = null,
} = {}) {
  const { recordTargetResultArtifact } = await import(artifactServiceModule);
  const stack = await currentStack(fixture);
  const result = targetResultRecord(fixture, stack, taskPackage, {
    targetResultId,
    createdAt,
    outcome,
    supersedes,
  });
  recordTargetResultArtifact({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    config: fixture.config,
    expectedPrevious: expectedPrevious(stack),
    artifact: result,
    transition: artifactTransition(`event-${targetResultId}`, createdAt),
    selection,
  });
  return { result, stack: await currentStack(fixture) };
}

async function createCurrentResultFixture({ outcome = "completed" } = {}) {
  const fixture = await makeFixture();
  const { taskPackage } = await createDispatchedTask(fixture);
  const { result } = await recordResult(fixture, taskPackage, { outcome });
  return { fixture, taskPackage, result };
}

async function createPendingReview(fixture, result) {
  const { createReviewCandidateArtifact } = await import(artifactServiceModule);
  const stack = await currentStack(fixture);
  const candidate = reviewCandidateRecord(fixture, stack, result);
  createReviewCandidateArtifact({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    expectedPrevious: expectedPrevious(stack),
    artifact: candidate,
    transition: artifactTransition("event-review-candidate-created-0005", candidate.createdAt),
  });
  return candidate;
}

function loadSnapshot(authority, fixture) {
  return authority.loadTargetResultAuthoritySnapshot({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
}

function exactKeys(value, expected, label) {
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), label);
}

function assertSnapshotHeader(snapshot, fixture, stack) {
  exactKeys(snapshot, [
    "schemaVersion",
    "kind",
    "demand",
    "state",
    "artifacts",
    "targetTasks",
    "review",
  ], "snapshot top-level shape");
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.kind, "WakeflowTargetResultAuthoritySnapshot");
  exactKeys(snapshot.demand, ["programId", "demandId", "ref", "digest"], "demand tuple shape");
  assert.deepEqual(snapshot.demand, {
    programId: IDS.program,
    demandId: IDS.demand,
    ref: "demand.json",
    digest: canonicalJsonDigest(fixture.demand),
  });
  exactKeys(snapshot.state, ["revision", "digest", "eventId", "eventDigest"], "state tuple shape");
  assert.deepEqual(snapshot.state, {
    revision: stack.state.revision,
    digest: stack.digests.state,
    eventId: stack.state.lastEvent.eventId,
    eventDigest: stack.state.lastEvent.eventDigest,
  });
  exactKeys(snapshot.review, ["current", "pending"], "review shape");
  exactKeys(snapshot.review.current, [
    "ready",
    "blocked",
    "missing",
    "closed",
    "results",
    "resultSetDigest",
  ], "current review classification shape");
}

function assertArtifactEntry(entry, record, lifecycleStatus) {
  const ref = `target-results/${record.targetTaskId}/${record.targetResultId}.json`;
  exactKeys(entry, [
    "targetTaskId",
    "targetResultId",
    "ref",
    "digest",
    "lifecycleStatus",
    "record",
  ], "TargetResult authority artifact shape");
  assert.deepEqual(entry, {
    targetTaskId: record.targetTaskId,
    targetResultId: record.targetResultId,
    ref,
    digest: canonicalJsonDigest(record),
    lifecycleStatus,
    record,
  });
}

function assertReview(snapshot, {
  ready = [],
  blocked = [],
  missing = [],
  closed = [],
  results = [],
} = {}) {
  const normalizedResults = results.map((record) => ({
    targetTaskId: record.targetTaskId,
    targetResultId: record.targetResultId,
    ref: `target-results/${record.targetTaskId}/${record.targetResultId}.json`,
    digest: canonicalJsonDigest(record),
    outcome: record.outcome,
  }));
  assert.deepEqual(snapshot.review.current, {
    ready,
    blocked,
    missing,
    closed,
    results: normalizedResults,
    resultSetDigest: canonicalJsonDigest(normalizedResults),
  });
}

function assertDeepFrozen(value, label = "$", seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true, `${label} must be frozen`);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertDeepFrozen(entry, `${label}/${index}`, seen));
    return;
  }
  for (const [key, entry] of Object.entries(value)) assertDeepFrozen(entry, `${label}/${key}`, seen);
}

function visit(value, callback, valuePath = "$") {
  if (!value || typeof value !== "object") {
    callback(value, valuePath);
    return;
  }
  callback(value, valuePath);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => visit(entry, callback, `${valuePath}/${index}`));
    return;
  }
  for (const [key, entry] of Object.entries(value)) visit(entry, callback, `${valuePath}/${key}`);
}

function treeSnapshot(root) {
  const entries = [];
  function walk(directory, relativeDirectory = "") {
    for (const name of readdirSync(directory).sort()) {
      const file = path.join(directory, name);
      const relativeFile = path.posix.join(relativeDirectory.split(path.sep).join("/"), name);
      const stat = lstatSync(file);
      if (stat.isSymbolicLink()) {
        entries.push({ path: relativeFile, type: "symlink", target: readlinkSync(file) });
      } else if (stat.isDirectory()) {
        entries.push({ path: `${relativeFile}/`, type: "directory", mode: stat.mode & 0o777 });
        walk(file, relativeFile);
      } else {
        entries.push({
          path: relativeFile,
          type: "file",
          mode: stat.mode & 0o777,
          digest: byteDigest(readFileSync(file)),
        });
      }
    }
  }
  walk(root);
  return entries;
}

function resultFile(fixture, record) {
  return path.join(
    fixture.stateRoot,
    "target-results",
    record.targetTaskId,
    `${record.targetResultId}.json`,
  );
}

test("T07 RED fixture reaches a real T04/T05 immutable TargetResult state", async (t) => {
  const { fixture, result } = await createCurrentResultFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const stack = await currentStack(fixture);
  const targetTask = stack.state.targetTasks.find((entry) => entry.targetTaskId === IDS.targetTask);
  const resultTuple = stack.state.targetResults.find((entry) => entry.targetResultId === result.targetResultId);

  assert.equal(stack.state.revision, 4);
  assert.equal(targetTask.lifecycleStatus, "review-ready");
  assert.deepEqual(targetTask.currentResult, {
    targetResultId: result.targetResultId,
    ref: `target-results/${IDS.targetTask}/${result.targetResultId}.json`,
    digest: canonicalJsonDigest(result),
  });
  assert.deepEqual(resultTuple, {
    targetResultId: result.targetResultId,
    targetTaskId: IDS.targetTask,
    ref: `target-results/${IDS.targetTask}/${result.targetResultId}.json`,
    digest: canonicalJsonDigest(result),
    lifecycleStatus: "current",
  });
});

test("T07 candidate TargetResult authority is one exact state-selected, local-independent snapshot", async (t) => {
  const authority = await import(authorityModule);
  assert.deepEqual(Object.keys(authority).sort(), [
    "WakeflowTargetResultAuthorityError",
    "buildTargetResultAuthoritySnapshotFromLoaded",
    "loadTargetResultAuthoritySnapshot",
  ]);

  await t.test("public options reject accessors, hidden fields, and symbols without executing them", async (t) => {
    const fixture = await makeFixture();
    t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
    let getterCalls = 0;
    const accessorOptions = {
      expectedProgramId: IDS.program,
      ledgerRoot: fixture.ledgerRoot,
    };
    Object.defineProperty(accessorOptions, "stateRoot", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return fixture.stateRoot;
      },
    });
    assert.throws(
      () => authority.loadTargetResultAuthoritySnapshot(accessorOptions),
      (error) => error?.code === "wakeflow-target-result-authority-input",
    );
    assert.equal(getterCalls, 0);

    for (const options of [
      (() => {
        const value = {
          stateRoot: fixture.stateRoot,
          expectedProgramId: IDS.program,
          ledgerRoot: fixture.ledgerRoot,
        };
        Object.defineProperty(value, "hidden", { value: true, enumerable: false });
        return value;
      })(),
      {
        stateRoot: fixture.stateRoot,
        expectedProgramId: IDS.program,
        ledgerRoot: fixture.ledgerRoot,
        [Symbol("hidden")]: true,
      },
    ]) {
      assert.throws(
        () => authority.loadTargetResultAuthoritySnapshot(options),
        (error) => error?.code === "wakeflow-target-result-authority-input",
      );
    }
  });

  await t.test("locked composition rejects top-level and nested accessors without executing them", async (t) => {
    const { fixture } = await createCurrentResultFixture();
    t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
    const loaded = await currentStack(fixture);

    let topLevelGetterCalls = 0;
    const topLevelAccessor = { ...loaded };
    Object.defineProperty(topLevelAccessor, "state", {
      enumerable: true,
      get() {
        topLevelGetterCalls += 1;
        return loaded.state;
      },
    });
    assert.throws(
      () => authority.buildTargetResultAuthoritySnapshotFromLoaded(topLevelAccessor),
      (error) => error?.code === "wakeflow-target-result-authority-loaded",
    );
    assert.equal(topLevelGetterCalls, 0);

    let nestedGetterCalls = 0;
    const nestedState = { ...loaded.state };
    Object.defineProperty(nestedState, "revision", {
      enumerable: true,
      get() {
        nestedGetterCalls += 1;
        return loaded.state.revision;
      },
    });
    assert.throws(
      () => authority.buildTargetResultAuthoritySnapshotFromLoaded({
        ...loaded,
        state: nestedState,
      }),
      (error) => error?.code === "wakeflow-target-result-authority-loaded",
    );
    assert.equal(nestedGetterCalls, 0);
  });

  await t.test("authority canonical ordering never delegates to locale collation", () => {
    const source = readFileSync(
      path.join(repositoryRoot, "core/scripts/lib/wakeflow-target-result-authority.mjs"),
      "utf8",
    );
    assert.doesNotMatch(source, /\.localeCompare\(/u);
  });

  await t.test("locked composition rejects values that are not one strict loaded demand-core snapshot", () => {
    for (const invalid of [
      undefined,
      null,
      [],
      {},
      {
        demand: {},
        state: {},
        events: [],
        digests: {},
        paths: {},
      },
    ]) {
      assert.throws(
        () => authority.buildTargetResultAuthoritySnapshotFromLoaded(invalid),
        (error) => {
          assert.equal(error instanceof authority.WakeflowTargetResultAuthorityError, true);
          assert.equal(error.name, "WakeflowTargetResultAuthorityError");
          assert.equal(error.code, "wakeflow-target-result-authority-loaded");
          assert.deepEqual(error.details, {});
          assert.equal(Object.isFrozen(error.details), true);
          assert.equal(Object.hasOwn(error, "cause"), false);
          return true;
        },
      );
    }
  });

  await t.test("locked composition is byte-for-byte equivalent to the public strict loader", async (t) => {
    const fixture = await makeFixture();
    t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
    const { taskPackage } = await createDispatchedTask(fixture);
    const first = (await recordResult(fixture, taskPackage)).result;
    const corrected = (await recordResult(fixture, taskPackage, {
      targetResultId: IDS.correctedResult,
      createdAt: "2026-08-07T03:04:00.000Z",
      supersedes: {
        targetResultId: first.targetResultId,
        ref: `target-results/${first.targetTaskId}/${first.targetResultId}.json`,
        digest: canonicalJsonDigest(first),
      },
    })).result;
    await recordResult(fixture, taskPackage, {
      targetResultId: IDS.historicalResult,
      createdAt: "2026-08-07T03:05:00.000Z",
      selection: "historical",
    });
    await createPendingReview(fixture, corrected);
    const loaded = await currentStack(fixture);
    const before = treeSnapshot(fixture.root);

    const composed = authority.buildTargetResultAuthoritySnapshotFromLoaded(loaded);
    const publicSnapshot = loadSnapshot(authority, fixture);

    assert.deepEqual(composed, publicSnapshot);
    assert.equal(canonicalJson(composed), canonicalJson(publicSnapshot));
    assertDeepFrozen(composed);
    assert.deepEqual(treeSnapshot(fixture.root), before);
  });

  await t.test("locked composition accepts the exact BusinessArchive recovery loader extension", async (t) => {
    const fixture = await makeFixture();
    t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
    const loaded = await currentStack(fixture);
    const ordinary = authority.buildTargetResultAuthoritySnapshotFromLoaded(loaded);
    const recovery = authority.buildTargetResultAuthoritySnapshotFromLoaded({
      ...loaded,
      journal: {
        schemaVersion: 1,
        artifactKind: "wakeflow-business-archive-transaction",
      },
    });
    assert.deepEqual(recovery, ordinary);

    let getterCalls = 0;
    const accessorRecovery = { ...loaded };
    Object.defineProperty(accessorRecovery, "journal", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return {};
      },
    });
    assert.throws(
      () => authority.buildTargetResultAuthoritySnapshotFromLoaded(accessorRecovery),
      (error) => error?.code === "wakeflow-target-result-authority-loaded",
    );
    assert.equal(getterCalls, 0);
  });

  await t.test("current correction and late history preserve all immutable artifacts but select only the exact current tuple", async (t) => {
    const fixture = await makeFixture();
    t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
    const { taskPackage } = await createDispatchedTask(fixture);
    const first = (await recordResult(fixture, taskPackage)).result;
    const corrected = (await recordResult(fixture, taskPackage, {
      targetResultId: IDS.correctedResult,
      createdAt: "2026-08-07T03:04:00.000Z",
      supersedes: {
        targetResultId: first.targetResultId,
        ref: `target-results/${first.targetTaskId}/${first.targetResultId}.json`,
        digest: canonicalJsonDigest(first),
      },
    })).result;
    const historical = (await recordResult(fixture, taskPackage, {
      targetResultId: IDS.historicalResult,
      createdAt: "2026-08-07T03:05:00.000Z",
      selection: "historical",
    })).result;
    const stack = await currentStack(fixture);
    const snapshot = loadSnapshot(authority, fixture);

    assertSnapshotHeader(snapshot, fixture, stack);
    assert.deepEqual(snapshot.artifacts.map((entry) => entry.targetResultId), [
      IDS.targetResult,
      IDS.correctedResult,
      IDS.historicalResult,
    ].sort());
    const byId = new Map(snapshot.artifacts.map((entry) => [entry.targetResultId, entry]));
    assertArtifactEntry(byId.get(first.targetResultId), first, "historical");
    assertArtifactEntry(byId.get(corrected.targetResultId), corrected, "current");
    assertArtifactEntry(byId.get(historical.targetResultId), historical, "historical");
    assert.deepEqual(snapshot.targetTasks, [{
      targetTaskId: IDS.targetTask,
      lifecycleStatus: "review-ready",
      currentResult: {
        targetResultId: corrected.targetResultId,
        ref: `target-results/${IDS.targetTask}/${corrected.targetResultId}.json`,
        digest: canonicalJsonDigest(corrected),
      },
    }]);
    assertReview(snapshot, { ready: [IDS.targetTask], results: [corrected] });
    assert.equal(snapshot.review.pending, null);
    assert.equal(readFileSync(resultFile(fixture, first), "utf8"), `${canonicalJson(first)}\n`);
  });

  await t.test("review classification and resultSetDigest derive from lifecycle plus exact selected result", async (t) => {
    const readyFixture = await createCurrentResultFixture();
    const blockedFixture = await createCurrentResultFixture({ outcome: "blocked" });
    const missingFixture = await makeFixture();
    await createDispatchedTask(missingFixture);
    t.after(() => {
      rmSync(readyFixture.fixture.root, { recursive: true, force: true });
      rmSync(blockedFixture.fixture.root, { recursive: true, force: true });
      rmSync(missingFixture.root, { recursive: true, force: true });
    });

    const ready = loadSnapshot(authority, readyFixture.fixture);
    assertReview(ready, { ready: [IDS.targetTask], results: [readyFixture.result] });
    const blocked = loadSnapshot(authority, blockedFixture.fixture);
    assertReview(blocked, { blocked: [IDS.targetTask], results: [blockedFixture.result] });
    const missing = loadSnapshot(authority, missingFixture);
    assertReview(missing, { missing: [IDS.targetTask] });
    assert.equal(missing.review.current.resultSetDigest, canonicalJsonDigest([]));
  });

  await t.test("needs-rework retains immutable current history but review classifies the task as missing", async (t) => {
    const { fixture, result } = await createCurrentResultFixture();
    t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
    await createPendingReview(fixture, result);
    await commitTaskLifecycle(fixture, "needs-rework", {
      eventId: "event-review-rework-requested-0006",
      createdAt: "2026-08-07T03:07:00.000Z",
      stateName: "needs-rework",
      command: "request-review-rework",
      type: "review.rework-requested",
      clearReview: true,
    });

    const snapshot = loadSnapshot(authority, fixture);
    assert.equal(snapshot.artifacts.length, 1);
    assert.equal(snapshot.targetTasks[0].currentResult.targetResultId, result.targetResultId);
    assertReview(snapshot, { missing: [IDS.targetTask] });
    assert.equal(snapshot.review.pending, null);
  });

  await t.test("accepted lifecycle is closed even though its immutable current result remains available", async (t) => {
    const { fixture, result } = await createCurrentResultFixture();
    t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
    await createPendingReview(fixture, result);
    await commitTaskLifecycle(fixture, "accepted", {
      eventId: "event-review-accepted-0006",
      createdAt: "2026-08-07T03:07:00.000Z",
      stateName: "planned",
      command: "accept-review-candidate",
      type: "review.accepted",
      clearReview: true,
      closePackage: true,
    });

    const snapshot = loadSnapshot(authority, fixture);
    assert.equal(snapshot.artifacts.length, 1);
    assertReview(snapshot, { closed: [IDS.targetTask] });
  });

  await t.test("pending review candidate is exact-loaded by its state ref and digest", async (t) => {
    const { fixture, result } = await createCurrentResultFixture();
    t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
    const candidate = await createPendingReview(fixture, result);
    const snapshot = loadSnapshot(authority, fixture);

    exactKeys(snapshot.review.pending, ["reviewCandidateId", "ref", "digest", "record"]);
    assert.deepEqual(snapshot.review.pending, {
      reviewCandidateId: candidate.reviewCandidateId,
      ref: `review-candidates/${candidate.reviewCandidateId}.json`,
      digest: canonicalJsonDigest(candidate),
      record: candidate,
    });
    assertReview(snapshot, { ready: [IDS.targetTask], results: [result] });

    const pendingFile = path.join(
      fixture.stateRoot,
      "review-candidates",
      `${candidate.reviewCandidateId}.json`,
    );
    const tampered = structuredClone(candidate);
    tampered.structuralGaps = ["tampered pending review input"];
    writeCanonical(pendingFile, tampered);
    assert.throws(() => loadSnapshot(authority, fixture));
  });

  await t.test("conflicting and local-only TargetResult files never enter candidate authority", async (t) => {
    const { fixture, result } = await createCurrentResultFixture();
    const localOnlyFixture = await makeFixture();
    await createDispatchedTask(localOnlyFixture);
    t.after(() => {
      rmSync(fixture.root, { recursive: true, force: true });
      rmSync(localOnlyFixture.root, { recursive: true, force: true });
    });
    const before = loadSnapshot(authority, fixture);
    const localDir = path.join(fixture.root, ".wakeflow-local", "wakeflow-delivery", "target-results");
    mkdirSync(localDir, { recursive: true });
    writeCanonical(path.join(localDir, "conflicting-result.json"), {
      kind: "TargetResultEnvelope",
      resultId: result.targetResultId,
      targetWindow: "legacy-window",
      taskId: IDS.targetTask,
      status: "blocked",
      summary: "This local transport claim must not mask state authority.",
    });
    assert.deepEqual(loadSnapshot(authority, fixture), before);

    const localOnlyDir = path.join(
      localOnlyFixture.root,
      ".wakeflow-local",
      "wakeflow-delivery",
      "target-results",
    );
    mkdirSync(localOnlyDir, { recursive: true });
    writeCanonical(path.join(localOnlyDir, "local-only.json"), {
      kind: "TargetResultEnvelope",
      resultId: "target-result-local-only",
      taskId: IDS.targetTask,
      status: "completed",
    });
    const localOnly = loadSnapshot(authority, localOnlyFixture);
    assert.deepEqual(localOnly.artifacts, []);
    assert.equal(localOnly.targetTasks[0].currentResult, null);
    assertReview(localOnly, { missing: [IDS.targetTask] });
  });

  await t.test("orphan result bytes are diagnostic residue and cannot acquire current or historical authority", async (t) => {
    const { fixture, taskPackage, result } = await createCurrentResultFixture();
    t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
    const stack = await currentStack(fixture);
    const orphan = targetResultRecord(fixture, stack, taskPackage, {
      targetResultId: IDS.orphanResult,
      createdAt: "2026-08-07T03:09:00.000Z",
    });
    writeCanonical(resultFile(fixture, orphan), orphan);

    const snapshot = loadSnapshot(authority, fixture);
    assert.deepEqual(snapshot.artifacts.map((entry) => entry.targetResultId), [result.targetResultId]);
    assert.equal(snapshot.targetTasks[0].currentResult.targetResultId, result.targetResultId);
    assertReview(snapshot, { ready: [IDS.targetTask], results: [result] });
  });

  await t.test("flat, legacy history, and wrong-task orphan paths never become authority selectors", async (t) => {
    const { fixture, taskPackage, result } = await createCurrentResultFixture();
    t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
    const stack = await currentStack(fixture);
    const orphan = targetResultRecord(fixture, stack, taskPackage, {
      targetResultId: IDS.orphanResult,
      createdAt: "2026-08-07T03:09:00.000Z",
    });
    const historyDirectory = path.join(fixture.stateRoot, "target-results", "history");
    const wrongTaskDirectory = path.join(
      fixture.stateRoot,
      "target-results",
      "target-task_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    for (const directory of [historyDirectory, wrongTaskDirectory]) {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      if (process.platform !== "win32") chmodSync(directory, 0o700);
    }
    writeCanonical(
      path.join(fixture.stateRoot, "target-results", `${orphan.targetResultId}.json`),
      orphan,
    );
    writeCanonical(path.join(historyDirectory, `${orphan.targetResultId}.json`), orphan);
    writeCanonical(path.join(wrongTaskDirectory, `${orphan.targetResultId}.json`), orphan);

    const snapshot = loadSnapshot(authority, fixture);
    assert.deepEqual(snapshot.artifacts.map((entry) => entry.targetResultId), [result.targetResultId]);
    assert.equal(snapshot.targetTasks[0].currentResult.targetResultId, result.targetResultId);
    assertReview(snapshot, { ready: [IDS.targetTask], results: [result] });
  });

  await t.test("a committed historical TargetResult cannot disappear from state inventory", async (t) => {
    const fixture = await makeFixture();
    t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
    const { taskPackage } = await createDispatchedTask(fixture);
    const first = (await recordResult(fixture, taskPackage)).result;
    await recordResult(fixture, taskPackage, {
      targetResultId: IDS.correctedResult,
      createdAt: "2026-08-07T03:04:00.000Z",
      supersedes: {
        targetResultId: first.targetResultId,
        ref: `target-results/${first.targetTaskId}/${first.targetResultId}.json`,
        digest: canonicalJsonDigest(first),
      },
    });
    const stateFile = path.join(fixture.stateRoot, "wakeflow-state.json");
    const state = JSON.parse(readFileSync(stateFile, "utf8"));
    state.targetResults = state.targetResults.filter(
      (entry) => entry.targetResultId !== first.targetResultId,
    );
    writeCanonical(stateFile, state);

    await assert.doesNotReject(currentStack(fixture));
    assert.throws(
      () => loadSnapshot(authority, fixture),
      (error) => (
        error?.name === "WakeflowTargetResultAuthorityError"
        && error?.code === "wakeflow-target-result-authority-closure"
      ),
    );
  });

  await t.test("tamper, missing file, unsafe mode, symlink, hardlink, and pending journal all fail closed", async (t) => {
    await t.test("tampered canonical bytes", async (t) => {
      const { fixture, result } = await createCurrentResultFixture();
      t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
      const changed = structuredClone(result);
      changed.summary = "Different canonical bytes under one committed result tuple.";
      writeCanonical(resultFile(fixture, result), changed);
      assert.throws(() => loadSnapshot(authority, fixture));
    });

    await t.test("missing exact result", async (t) => {
      const { fixture, result } = await createCurrentResultFixture();
      t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
      unlinkSync(resultFile(fixture, result));
      assert.throws(
        () => loadSnapshot(authority, fixture),
        (error) => {
          assert.equal(error instanceof authority.WakeflowTargetResultAuthorityError, true);
          assert.equal(error.message.includes(fixture.root), false);
          assert.equal(JSON.stringify(error.details).includes(fixture.root), false);
          assert.equal(Object.hasOwn(error, "cause"), false);
          return true;
        },
      );
    });

    await t.test("unsafe result mode", { skip: process.platform === "win32" }, async (t) => {
      const { fixture, result } = await createCurrentResultFixture();
      t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
      chmodSync(resultFile(fixture, result), 0o644);
      assert.throws(() => loadSnapshot(authority, fixture));
    });

    await t.test("symlink at exact result ref", async (t) => {
      const { fixture, result } = await createCurrentResultFixture();
      t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
      const exact = resultFile(fixture, result);
      const backup = path.join(fixture.root, "symlink-target-result.json");
      renameSync(exact, backup);
      symlinkSync(backup, exact);
      assert.throws(() => loadSnapshot(authority, fixture));
    });

    await t.test("hardlink count greater than one", async (t) => {
      const { fixture, result } = await createCurrentResultFixture();
      t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
      linkSync(resultFile(fixture, result), path.join(fixture.root, "hardlinked-result.json"));
      assert.throws(() => loadSnapshot(authority, fixture));
    });

    await t.test("pending state transition journal", async (t) => {
      const { fixture } = await createCurrentResultFixture();
      t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
      writeCanonical(path.join(fixture.stateRoot, "transactions", "state-transition.json"), {
        artifactKind: "pending-untrusted-state-transition",
      });
      assert.throws(() => loadSnapshot(authority, fixture));
    });
  });

  await t.test("snapshot is recursively frozen, runtime-root-free, byte-free, and leaves the filesystem unchanged", async (t) => {
    const { fixture } = await createCurrentResultFixture();
    t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
    const before = treeSnapshot(fixture.root);
    const snapshot = loadSnapshot(authority, fixture);
    const after = treeSnapshot(fixture.root);

    assert.deepEqual(after, before);
    assertDeepFrozen(snapshot);
    assert.throws(() => snapshot.artifacts.push(null), TypeError);
    const forbiddenKeys = new Set(["bytes", "file", "stateRoot", "ledgerRoot"]);
    visit(snapshot, (value, valuePath) => {
      const key = valuePath.split("/").at(-1);
      assert.equal(forbiddenKeys.has(key), false, `${valuePath} is a private runtime field`);
      if (typeof value !== "string") return;
      // Immutable TargetResult human text is returned exactly and is not a
      // redaction surface. T07 must not add or expose its own runtime roots.
      assert.equal(value.includes(fixture.root), false, `${valuePath} leaks the fixture root`);
    });
    assert.equal(JSON.stringify(snapshot).includes(fixture.root), false);
  });

  await t.test("corrupt and symlinked legacy-local result residue is outside candidate authority", async (t) => {
    const { fixture, result } = await createCurrentResultFixture();
    t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
    const before = loadSnapshot(authority, fixture);
    const localDirectory = path.join(
      fixture.root,
      ".wakeflow-local",
      "wakeflow-delivery",
      "target-results",
    );
    mkdirSync(localDirectory, { recursive: true });
    writeFileSync(path.join(localDirectory, "corrupt.json"), "{not-json\n");
    symlinkSync(resultFile(fixture, result), path.join(localDirectory, "linked.json"));

    assert.deepEqual(loadSnapshot(authority, fixture), before);
  });
});

test("the v3 MCP routes target-result authority while retired state, result, review, status, and trace routes are absent", () => {
  const retiredFiles = [
    "core/scripts/wakeflow-state.mjs",
    "core/scripts/wakeflow-delivery.mjs",
    "core/scripts/lib/wakeflow-result-recording-commands.mjs",
    "core/scripts/lib/wakeflow-delivery-run-recording-command.mjs",
    "core/scripts/lib/wakeflow-legacy-local-result-recording-command.mjs",
    "core/scripts/lib/wakeflow-review-commands.mjs",
    "core/scripts/lib/wakeflow-delivery-status-command.mjs",
    "core/scripts/lib/wakeflow-trace-spine-command.mjs",
    "plugins/codex-wakeflow/scripts/wakeflow-state.mjs",
    "plugins/codex-wakeflow/scripts/wakeflow-delivery.mjs",
    "plugins/claude-code-wakeflow/scripts/wakeflow-state.mjs",
    "plugins/claude-code-wakeflow/scripts/wakeflow-delivery.mjs",
  ];
  for (const relative of retiredFiles) {
    assert.equal(existsSync(path.join(repositoryRoot, relative)), false, relative);
  }

  const mcp = readFileSync(path.join(repositoryRoot, "core/lib/wakeflow-mcp-tools.mjs"), "utf8");
  assert.match(mcp, /name: "wakeflow_record_target_result"[\s\S]*?operations: \["import"\]/u);
  const facade = readFileSync(
    path.join(repositoryRoot, "plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-host.mjs"),
    "utf8",
  );
  assert.doesNotMatch(facade, /wakeflow-(?:result-recording-commands|review-commands|state-results)\.mjs/u);
});
