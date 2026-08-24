import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { canonicalJson, canonicalJsonDigest } from "../core/scripts/lib/wakeflow-canonical-json.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactModule = "../core/scripts/lib/wakeflow-demand-artifact-records.mjs";
const serviceModule = "../core/scripts/lib/wakeflow-demand-artifact-service.mjs";

const IDS = Object.freeze({
  program: "program_11111111-1111-4111-8111-111111111111",
  demand: "demand_22222222-2222-4222-8222-222222222222",
  repository: "repository_22222222-2222-4222-8222-222222222222",
  window: "window_88888888-8888-4888-8888-888888888888",
  testWindow: "window_77777777-7777-4777-8777-777777777777",
  taskPackage: "task-package_66666666-6666-4666-8666-666666666666",
  targetTask: "target-task_77777777-7777-4777-8777-777777777777",
  targetResult: "target-result_88888888-8888-4888-8888-888888888888",
  targetResult2: "target-result_89898989-8989-4989-8989-898989898989",
  targetResultLate: "target-result_8a8a8a8a-8a8a-4a8a-8a8a-8a8a8a8a8a8a",
  testTargetResult: "target-result_8b8b8b8b-8b8b-4b8b-8b8b-8b8b8b8b8b8b",
  reviewCandidate: "review-candidate_99999999-9999-4999-8999-999999999999",
  reviewCandidate2: "review-candidate_9a9a9a9a-9a9a-4a9a-8a9a-9a9a9a9a9a9a",
  testCard: "test-card_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  testTaskPackage: "task-package_abababab-abab-4bab-8bab-abababababab",
  testTargetTask: "target-task_acacacac-acac-4cac-8cac-acacacacacac",
  taskPackageOther: "task-package_adadadad-adad-4dad-8dad-adadadadadad",
  targetTaskOther: "target-task_aeaeaeae-aeae-4eae-8eae-aeaeaeaeaeae",
  dispatchGroup: "dispatch-group_afafafaf-afaf-4faf-8faf-afafafafafaf",
  delivery: "delivery_b0b0b0b0-b0b0-40b0-80b0-b0b0b0b0b0b0",
});
const CREATED_AT = "2026-08-07T02:03:04.000Z";
const DEMAND_DIGEST = `sha256:${"d".repeat(64)}`;
const AUTHORITY_DIGEST = `sha256:${"e".repeat(64)}`;
const configFixture = JSON.parse(readFileSync(
  path.join(repositoryRoot, "test/fixtures/wakeflow-config-v3/valid-minimal.json"),
  "utf8",
));

function visit(value, callback, valuePath = "$") {
  if (!value || typeof value !== "object") return;
  callback(value, valuePath);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => visit(entry, callback, `${valuePath}/${index}`));
    return;
  }
  for (const [key, entry] of Object.entries(value)) visit(entry, callback, `${valuePath}/${key}`);
}

function common(artifactKind) {
  return {
    schemaVersion: 1,
    artifactKind,
    programId: IDS.program,
    demandId: IDS.demand,
    demandRef: "demand.json",
    demandDigest: DEMAND_DIGEST,
    createdAt: CREATED_AT,
  };
}

function taskPackage() {
  return {
    ...common("wakeflow-task-package"),
    demandAuthorityRef: "demand-authority.json",
    demandAuthorityDigest: AUTHORITY_DIGEST,
    taskPackageId: IDS.taskPackage,
    targetTaskId: IDS.targetTask,
    windowId: IDS.window,
    repositoryId: IDS.repository,
    workType: "implementation",
    objective: "Implement the bounded target change.",
    confirmedContext: ["The controller confirmed this exact execution context."],
    requirementRefs: [{
      role: "goal",
      ref: "requirement-designs/requirement_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/01-goal.md",
      digest: `sha256:${"1".repeat(64)}`,
      anchor: "goal",
    }],
    boundaries: {
      inScope: ["Only the assigned implementation."],
      outOfScope: ["Unrelated repositories."],
      forbidden: ["Do not change controller authority."],
    },
    completionExpectations: ["Focused tests pass."],
    dependsOnTargetTaskIds: [],
    commitExpectation: "leave-uncommitted",
    acceptanceAnchors: [{
      anchorId: "A1",
      claim: "The target behavior exists.",
      probe: "Run the focused test.",
      expected: "The test passes.",
    }],
    reviewInputContract: {
      requiredKinds: ["test-output"],
      requiredAcceptanceAnchorIds: ["A1"],
    },
  };
}

function targetResult() {
  const pkg = taskPackage();
  return {
    ...common("wakeflow-target-result"),
    targetResultId: IDS.targetResult,
    targetTaskId: IDS.targetTask,
    taskPackage: {
      taskPackageId: IDS.taskPackage,
      ref: `task-packages/${IDS.taskPackage}.json`,
      digest: canonicalJsonDigest(pkg),
    },
    assignment: {
      windowId: IDS.window,
      repositoryId: IDS.repository,
    },
    observedState: {
      revision: 2,
      eventId: "event-task-package-created-0002",
      eventDigest: `sha256:${"2".repeat(64)}`,
    },
    transport: {
      group: {
        id: IDS.dispatchGroup,
        ref: `.wakeflow-local/runtime/shared/transport/demands/${IDS.demand}/groups/${IDS.dispatchGroup}.json`,
        digest: `sha256:${"3".repeat(64)}`,
      },
      envelope: {
        id: IDS.delivery,
        ref: `.wakeflow-local/runtime/shared/transport/demands/${IDS.demand}/envelopes/${IDS.delivery}.json`,
        digest: `sha256:${"4".repeat(64)}`,
      },
    },
    outcome: "completed",
    summary: "The assigned change and focused verification completed.",
    repositoryChanges: [{ repositoryId: IDS.repository, disposition: "left-uncommitted", commits: [] }],
    evidenceLocators: [{ kind: "test-output", ref: "evidence/test-output.txt", digest: `sha256:${"5".repeat(64)}` }],
    verification: ["Focused test passed."],
    risks: [],
    craftMapping: [{
      kind: "acceptance-anchor",
      anchorId: "A1",
      evidenceRefs: [{ ref: "evidence/test-output.txt", digest: `sha256:${"5".repeat(64)}` }],
    }],
  };
}

function reviewCandidate() {
  const result = targetResult();
  const resultRef = `target-results/${IDS.targetTask}/${IDS.targetResult}.json`;
  const results = [{
    targetTaskId: IDS.targetTask,
    targetResultId: IDS.targetResult,
    ref: resultRef,
    digest: canonicalJsonDigest(result),
    outcome: "completed",
  }];
  return {
    ...common("wakeflow-review-candidate"),
    reviewCandidateId: IDS.reviewCandidate,
    fromState: {
      revision: 3,
      stateDigest: `sha256:${"6".repeat(64)}`,
      eventId: "event-result-recorded-0003",
      eventDigest: `sha256:${"7".repeat(64)}`,
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
}

function testCard() {
  return {
    ...common("wakeflow-test-card"),
    testCardId: IDS.testCard,
    targetTaskId: IDS.targetTask,
    windowId: IDS.testWindow,
    demandAuthorityRef: "demand-authority.json",
    demandAuthorityDigest: `sha256:${"8".repeat(64)}`,
    strategySource: { ref: "requirement-designs/test-plan.md", digest: `sha256:${"9".repeat(64)}` },
    observedState: {
      revision: 2,
      eventId: "event-authority-frozen-0002",
      eventDigest: `sha256:${"a".repeat(64)}`,
    },
    executionContract: {
      requirementGoal: "Verify the confirmed requirement in a real environment.",
      approvedPlan: ["Run the approved real-environment scenario."],
      allowedSkills: [],
      setupPolicy: "fresh-per-attempt",
      maxAttempts: 2,
      restartConditions: ["The environment is proven contaminated."],
      changeControl: {
        testMayChangeApproach: false,
        testMayChangeGoal: false,
        testMayAddUnmappedSteps: false,
        testMayUseUnlistedSkills: false,
        route: "return-blocked-to-controller",
      },
    },
    boundaryGate: {
      question: "Does the confirmed behavior work in the approved environment?",
      objectBoundary: "Only the assigned target behavior.",
      controllerSelfChecks: ["Focused product tests already pass."],
      realScenarioConditions: ["Use a fresh approved environment."],
      successMeans: ["The observed behavior matches the requirement."],
      failureMeans: ["The observed behavior contradicts the requirement."],
      cannotConclude: ["Infrastructure is unavailable."],
      stopConditions: ["The attempt limit is reached."],
    },
    evidenceRequired: ["Portable execution summary."],
    allowedOperations: ["Operate only inside the approved Test environment."],
    forbiddenOperations: ["Do not modify product source."],
  };
}

function byteDigest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function writeCanonical(file, value) {
  writeFileSync(file, `${canonicalJson(value)}\n`, { mode: 0o600 });
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

async function makeIntegrationFixture({ testMode = "real-environment" } = {}) {
  const {
    createLedgerMemberReference,
    createLedgerRecord,
    loadLedgerRecord,
  } = await import("../core/scripts/lib/wakeflow-ledger-records.mjs");
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-demand-artifact-v3-"));
  const ledgerRoot = path.join(root, "ledger");
  mkdirSync(path.join(ledgerRoot, "requirement-designs"), { recursive: true, mode: 0o700 });
  const roles = [
    "original-plan",
    "requirement-design",
    "code-facts",
    "landing-plan",
    "non-goals",
    "user-confirmation",
    ...(testMode === "real-environment" ? ["test-environment"] : []),
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
  const ledgerRecord = {
    schemaVersion: 1,
    artifactKind: "wakeflow-requirement-record",
    requirementId,
    programId: IDS.program,
    title: "T05 immutable artifact integration authority",
    status: "confirmed",
    relatedDemandIds: [IDS.demand],
    documents: documents.map(({ content: _content, ...document }) => document),
  };
  const created = createLedgerRecord({
    ledgerRoot,
    expectedProgramId: IDS.program,
    record: ledgerRecord,
    memberContents: Object.fromEntries(documents.map((document) => [document.path, document.content])),
  });
  const loadedLedger = loadLedgerRecord({
    ledgerRoot,
    root: created.root,
    expectedFamily: "requirement",
    expectedProgramId: IDS.program,
  });
  const authorityRefs = documents.map((document) => createLedgerMemberReference(loadedLedger, document.path));
  const environmentRef = authorityRefs.find((entry) => entry.role === "test-environment") ?? null;
  const demand = {
    schemaVersion: 1,
    artifactKind: "wakeflow-demand",
    programId: IDS.program,
    demandId: IDS.demand,
    createdAt: "2026-08-07T02:00:00.000Z",
    title: "T05 immutable artifact integration",
    goal: "Exercise the exact candidate artifact transaction chain.",
    completionDefinition: "Every immutable artifact is state/event/digest closed.",
    demandType: "requirement",
    source: {
      artifactKind: "wakeflow-todo-lineage-ref",
      schemaVersion: 1,
      boardRef: ".wakeflow-active/current/global-todo-board.md",
      todoId: "TODO-M2-T05-INTEGRATION",
      intakeRowDigest: `sha256:${"b".repeat(64)}`,
    },
    executionPlacement: { mode: "main" },
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
      mode: testMode,
      summary: testMode === "real-environment"
        ? "Use the exact confirmed real-environment strategy."
        : "Controller-only verification is sufficient.",
      ...(environmentRef ? { environmentSpecRef: environmentRef.memberRef } : {}),
    },
  };
  const initialEvent = {
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: "event-initial-artifacts-0001",
    demandId: IDS.demand,
    createdAt: demand.createdAt,
    actor: "controller",
    command: "init",
    type: "state.initialized",
    previousRevision: 0,
    nextRevision: 1,
    from: null,
    to: "intake",
    reason: "initialize strict T05 integration demand",
    decisionSummary: "Publish demand identity and frozen authority before implementation work.",
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
    chmodSync(directory, 0o700);
  }
  writeCanonical(path.join(stateRoot, "demand.json"), demand);
  writeCanonical(path.join(stateRoot, "demand-authority.json"), authority);
  writeCanonical(path.join(stateRoot, "wakeflow-state.json"), state);
  writeFileSync(path.join(stateRoot, "controller-events.jsonl"), `${canonicalJson(initialEvent)}\n`, { mode: 0o600 });
  return {
    root,
    stateRoot,
    ledgerRoot,
    demand,
    authority,
    authorityRefs,
    goalRef: authorityRefs.find((entry) => entry.role === "original-plan"),
    strategyRef: authorityRefs.find((entry) => entry.role === "requirement-design"),
    environmentRef,
    config: structuredClone(configFixture),
  };
}

async function currentStack(fixture) {
  const { loadDemandCoreRecords } = await import("../core/scripts/lib/wakeflow-demand-core-records.mjs");
  return loadDemandCoreRecords({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
}

function expectedPrevious(stack) {
  return { revision: stack.state.revision, stateDigest: stack.digests.state };
}

function transition(eventId, createdAt) {
  return {
    eventId,
    createdAt,
    reason: `commit ${eventId}`,
    decisionSummary: `Bind the exact immutable artifact for ${eventId}.`,
  };
}

function integrationPackage(fixture, {
  taskPackageId = IDS.taskPackage,
  targetTaskId = IDS.targetTask,
  createdAt = "2026-08-07T03:01:00.000Z",
  workType = "implementation",
  windowId = IDS.window,
  repositoryId = IDS.repository,
  testCard: linkedTestCard = null,
} = {}) {
  return {
    ...common("wakeflow-task-package"),
    demandDigest: canonicalJsonDigest(fixture.demand),
    demandAuthorityRef: "demand-authority.json",
    demandAuthorityDigest: canonicalJsonDigest(fixture.authority),
    createdAt,
    taskPackageId,
    targetTaskId,
    windowId,
    ...(workType === "test" ? {} : { repositoryId }),
    workType,
    objective: workType === "test" ? "Execute the exact approved Test card." : "Implement the bounded target change.",
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
    ...(workType === "test" ? {} : { commitExpectation: "leave-uncommitted" }),
    acceptanceAnchors: workType === "test" ? [] : [{
      anchorId: "A1",
      claim: "The target behavior exists.",
      probe: "Run the focused test.",
      expected: "The focused test passes.",
    }],
    reviewInputContract: {
      requiredKinds: workType === "test" ? [] : ["test-output"],
      requiredAcceptanceAnchorIds: workType === "test" ? [] : ["A1"],
    },
    ...(linkedTestCard ? { testCard: linkedTestCard } : {}),
  };
}

function integrationTestCard(fixture, stack, {
  createdAt = "2026-08-07T03:05:00.000Z",
  testCardId = IDS.testCard,
  targetTaskId = IDS.testTargetTask,
} = {}) {
  return {
    ...testCard(),
    demandDigest: canonicalJsonDigest(fixture.demand),
    createdAt,
    testCardId,
    targetTaskId,
    windowId: IDS.testWindow,
    demandAuthorityDigest: canonicalJsonDigest(fixture.authority),
    executionContract: {
      ...testCard().executionContract,
      requirementGoal: fixture.demand.goal,
    },
    strategySource: {
      ref: fixture.strategyRef.memberRef,
      digest: fixture.strategyRef.memberDigest,
    },
    observedState: {
      revision: stack.state.revision,
      eventId: stack.state.lastEvent.eventId,
      eventDigest: stack.state.lastEvent.eventDigest,
    },
  };
}

function integrationResult(fixture, stack, taskPackageRecord, {
  targetResultId = IDS.targetResult,
  createdAt = "2026-08-07T03:03:00.000Z",
  supersedes = null,
  outcome = "completed",
} = {}) {
  return {
    ...targetResult(),
    demandDigest: canonicalJsonDigest(fixture.demand),
    createdAt,
    targetResultId,
    targetTaskId: taskPackageRecord.targetTaskId,
    taskPackage: {
      taskPackageId: taskPackageRecord.taskPackageId,
      ref: `task-packages/${taskPackageRecord.taskPackageId}.json`,
      digest: canonicalJsonDigest(taskPackageRecord),
    },
    assignment: {
      windowId: taskPackageRecord.windowId,
      ...(taskPackageRecord.repositoryId ? { repositoryId: taskPackageRecord.repositoryId } : {}),
    },
    observedState: {
      revision: stack.state.revision,
      eventId: stack.state.lastEvent.eventId,
      eventDigest: stack.state.lastEvent.eventDigest,
    },
    outcome,
    repositoryChanges: taskPackageRecord.repositoryId ? [{
      repositoryId: taskPackageRecord.repositoryId,
      disposition: "left-uncommitted",
      commits: [],
    }] : [],
    evidenceLocators: taskPackageRecord.workType === "test" ? [{
      kind: "test-step",
      ref: "evidence/test-step-0.txt",
      digest: `sha256:${"5".repeat(64)}`,
    }] : targetResult().evidenceLocators,
    craftMapping: taskPackageRecord.workType === "test" ? [{
      kind: "test-step",
      planIndex: 0,
      step: "Run the approved real-environment scenario.",
      ref: "evidence/test-step-0.txt",
    }] : targetResult().craftMapping,
    ...(supersedes ? { supersedes } : {}),
  };
}

function integrationReviewCandidate(fixture, stack, resultRecord, {
  reviewCandidateId = IDS.reviewCandidate,
  excludedTargetTaskIds = [],
  createdAt = "2026-08-07T03:08:00.000Z",
} = {}) {
  const results = [{
    targetTaskId: resultRecord.targetTaskId,
    targetResultId: resultRecord.targetResultId,
    ref: `target-results/${resultRecord.targetTaskId}/${resultRecord.targetResultId}.json`,
    digest: canonicalJsonDigest(resultRecord),
    outcome: resultRecord.outcome,
  }];
  return {
    ...common("wakeflow-review-candidate"),
    demandDigest: canonicalJsonDigest(fixture.demand),
    createdAt,
    reviewCandidateId,
    fromState: {
      revision: stack.state.revision,
      stateDigest: stack.digests.state,
      eventId: stack.state.lastEvent.eventId,
      eventDigest: stack.state.lastEvent.eventDigest,
    },
    reviewScope: {
      targetTaskIds: [resultRecord.targetTaskId],
      excludedTargetTaskIds: [...excludedTargetTaskIds].sort(),
    },
    results,
    resultSetDigest: canonicalJsonDigest(results),
    readyTargetTaskIds: resultRecord.outcome === "blocked" ? [] : [resultRecord.targetTaskId],
    blockedTargetTaskIds: resultRecord.outcome === "blocked" ? [resultRecord.targetTaskId] : [],
    missingTargetTaskIds: [],
    allowedDecisions: ["accept", "blocked", "redesign", "rework"],
    structuralGaps: [],
  };
}

async function simulateTargetDispatch(fixture, targetTaskId, {
  createdAt = "2026-08-07T03:02:00.000Z",
} = {}) {
  const stack = await currentStack(fixture);
  const nextRevision = stack.state.revision + 1;
  const event = {
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: `event-dispatch-${nextRevision}`,
    demandId: IDS.demand,
    createdAt,
    actor: "controller",
    command: "dispatch-target",
    type: "target-task.dispatched",
    previousRevision: stack.state.revision,
    nextRevision,
    from: stack.state.state,
    to: "dispatched",
    reason: "simulate the admitted M3 dispatch prerequisite in a test fixture",
    decisionSummary: "Dispatch the exact target task before importing its result.",
    changedArtifacts: [],
  };
  const nextState = structuredClone(stack.state);
  nextState.revision = nextRevision;
  nextState.state = event.to;
  nextState.stateReason = event.reason;
  nextState.updatedAt = createdAt;
  nextState.lastEvent = { eventId: event.eventId, eventDigest: canonicalJsonDigest(event) };
  nextState.targetTasks.find((entry) => entry.targetTaskId === targetTaskId).lifecycleStatus = "dispatched";
  writeFileSync(
    path.join(fixture.stateRoot, "controller-events.jsonl"),
    `${stack.events.map((entry) => canonicalJson(entry)).join("\n")}\n${canonicalJson(event)}\n`,
    { mode: 0o600 },
  );
  writeCanonical(path.join(fixture.stateRoot, "wakeflow-state.json"), nextState);
  return currentStack(fixture);
}

async function simulateReviewAcceptance(fixture, targetTaskIds, {
  createdAt = "2026-08-07T03:08:30.000Z",
} = {}) {
  const stack = await currentStack(fixture);
  const nextRevision = stack.state.revision + 1;
  const event = {
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: `event-review-accepted-${nextRevision}`,
    demandId: IDS.demand,
    createdAt,
    actor: "controller",
    command: "accept-review-candidate",
    type: "review.accepted",
    previousRevision: stack.state.revision,
    nextRevision,
    from: stack.state.state,
    to: "planned",
    reason: "simulate the admitted later reducer decision prerequisite in a test fixture",
    decisionSummary: "Accept the exact reviewed product result before Test task creation.",
    changedArtifacts: [],
  };
  const nextState = structuredClone(stack.state);
  nextState.revision = nextRevision;
  nextState.state = event.to;
  nextState.stateReason = event.reason;
  nextState.updatedAt = createdAt;
  nextState.lastEvent = { eventId: event.eventId, eventDigest: canonicalJsonDigest(event) };
  nextState.review = initialArtifactState().review;
  for (const targetTaskId of targetTaskIds) {
    const targetTask = nextState.targetTasks.find((entry) => entry.targetTaskId === targetTaskId);
    targetTask.lifecycleStatus = "accepted";
    const taskPackageState = nextState.taskPackages.find(
      (entry) => entry.taskPackageId === targetTask.taskPackageId,
    );
    taskPackageState.lifecycleStatus = "closed";
  }
  writeFileSync(
    path.join(fixture.stateRoot, "controller-events.jsonl"),
    `${stack.events.map((entry) => canonicalJson(entry)).join("\n")}\n${canonicalJson(event)}\n`,
    { mode: 0o600 },
  );
  writeCanonical(path.join(fixture.stateRoot, "wakeflow-state.json"), nextState);
  return currentStack(fixture);
}

async function simulateReviewRework(fixture, targetTaskId, {
  createdAt = "2026-08-07T03:08:30.000Z",
  decision = "rework",
} = {}) {
  const stack = await currentStack(fixture);
  assert.equal(stack.state.review.status, "pending");
  const pendingCandidate = stack.state.review.pendingCandidate;
  const candidate = JSON.parse(readFileSync(
    path.join(fixture.stateRoot, pendingCandidate.ref),
    "utf8",
  ));
  const targetTask = stack.state.targetTasks.find((entry) => entry.targetTaskId === targetTaskId);
  const selectedResult = JSON.parse(readFileSync(
    path.join(fixture.stateRoot, candidate.results[0].ref),
    "utf8",
  ));
  const nextReview = initialArtifactState().review;
  const nextRevision = stack.state.revision + 1;
  const event = {
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: `event-review-${decision}-${nextRevision}`,
    demandId: IDS.demand,
    createdAt,
    actor: "controller",
    command: "decide-review-candidate",
    type: `review.${decision}-requested`,
    previousRevision: stack.state.revision,
    nextRevision,
    from: stack.state.state,
    to: "needs-rework",
    reason: decision === "redesign"
      ? "simulate an explicit redesign decision authorizing replacement"
      : "simulate an ordinary rework decision without redesign authority",
    decisionSummary: decision === "redesign"
      ? "Authorize one exact replacement package for the same repository."
      : "Keep the same task and package; require a later result before review.",
    changedArtifacts: [],
    reviewDecision: {
      candidate: pendingCandidate,
      group: {
        groupId: selectedResult.transport.group.id,
        ref: selectedResult.transport.group.ref,
        digest: selectedResult.transport.group.digest,
      },
      resultSetDigest: candidate.resultSetDigest,
      decision,
      targetTaskIds: [targetTaskId],
      previousReviewDigest: canonicalJsonDigest(stack.state.review),
      nextReviewDigest: canonicalJsonDigest(nextReview),
    },
  };
  const nextState = structuredClone(stack.state);
  nextState.revision = nextRevision;
  nextState.state = event.to;
  nextState.stateReason = event.reason;
  nextState.updatedAt = createdAt;
  nextState.lastEvent = { eventId: event.eventId, eventDigest: canonicalJsonDigest(event) };
  nextState.review = nextReview;
  nextState.targetTasks.find((entry) => entry.targetTaskId === targetTaskId).lifecycleStatus = "needs-rework";
  const [{ commitDemandReviewDecisionWhileLocked }, { withStateRootLock }] = await Promise.all([
    import("../core/scripts/lib/wakeflow-demand-state-service.mjs"),
    import("../core/scripts/lib/wakeflow-state-lock.mjs"),
  ]);
  withStateRootLock(fixture.stateRoot, () => commitDemandReviewDecisionWhileLocked({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    expectedPrevious: expectedPrevious(stack),
    event,
    nextState,
  }));
  return currentStack(fixture);
}

async function simulateDemandCompletion(fixture, targetTaskIds, {
  createdAt = "2026-08-07T03:30:00.000Z",
} = {}) {
  const stack = await currentStack(fixture);
  const nextRevision = stack.state.revision + 1;
  const event = {
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: `event-demand-completed-${nextRevision}`,
    demandId: IDS.demand,
    createdAt,
    actor: "controller",
    command: "complete-demand",
    type: "demand.completed",
    previousRevision: stack.state.revision,
    nextRevision,
    from: stack.state.state,
    to: "completed",
    reason: "simulate the admitted Controller completion prerequisite in a test fixture",
    decisionSummary: "Close the accepted target lineage before an explicit continuation.",
    changedArtifacts: [],
    lifecycleTransition: { action: "complete" },
  };
  const nextState = structuredClone(stack.state);
  nextState.revision = nextRevision;
  nextState.state = event.to;
  nextState.stateReason = event.reason;
  nextState.updatedAt = createdAt;
  nextState.lastEvent = { eventId: event.eventId, eventDigest: canonicalJsonDigest(event) };
  nextState.review = initialArtifactState().review;
  for (const targetTaskId of targetTaskIds) {
    const targetTask = nextState.targetTasks.find((entry) => entry.targetTaskId === targetTaskId);
    targetTask.lifecycleStatus = "accepted";
    nextState.taskPackages.find(
      (entry) => entry.taskPackageId === targetTask.taskPackageId,
    ).lifecycleStatus = "closed";
  }
  writeFileSync(
    path.join(fixture.stateRoot, "controller-events.jsonl"),
    `${stack.events.map((entry) => canonicalJson(entry)).join("\n")}\n${canonicalJson(event)}\n`,
    { mode: 0o600 },
  );
  writeCanonical(path.join(fixture.stateRoot, "wakeflow-state.json"), nextState);
  return currentStack(fixture);
}

async function runPackageChild(args) {
  const serviceUrl = new URL(serviceModule, import.meta.url).href;
  const source = [
    `import { createTaskPackageArtifact } from ${JSON.stringify(serviceUrl)};`,
    `const args = ${JSON.stringify(args)};`,
    "try {",
    "  const result = createTaskPackageArtifact(args);",
    "  process.stdout.write(JSON.stringify({ status: 'ok', created: result.created }));",
    "} catch (error) {",
    "  process.stdout.write(JSON.stringify({ status: 'error', code: error?.code ?? null }));",
    "  process.exitCode = 2;",
    "}",
  ].join("\n");
  const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
    cwd: repositoryRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const [code] = await once(child, "exit");
  return { code, stdout, stderr, payload: JSON.parse(stdout) };
}

async function runResultChild(args) {
  const serviceUrl = new URL(serviceModule, import.meta.url).href;
  const source = [
    `import { recordTargetResultArtifact } from ${JSON.stringify(serviceUrl)};`,
    `const args = ${JSON.stringify(args)};`,
    "try {",
    "  const result = recordTargetResultArtifact(args);",
    "  process.stdout.write(JSON.stringify({ status: 'ok', created: result.created }));",
    "} catch (error) {",
    "  process.stdout.write(JSON.stringify({ status: 'error', code: error?.code ?? null }));",
    "  process.exitCode = 2;",
    "}",
  ].join("\n");
  const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
    cwd: repositoryRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const [code] = await once(child, "exit");
  return { code, stdout, stderr, payload: JSON.parse(stdout) };
}

async function buildPackageRecoveryIntent(fixture, packageOptions = {}) {
  const {
    demandArtifactIdentity,
  } = await import(artifactModule);
  const {
    validateControllerEventRecord,
    validateDemandStateRecord,
    validateStateTransitionRecord,
  } = await import("../core/scripts/lib/wakeflow-demand-core-records.mjs");
  const stack = await currentStack(fixture);
  const artifact = integrationPackage(fixture, packageOptions);
  const identity = demandArtifactIdentity(artifact);
  const event = validateControllerEventRecord({
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: `event-recovery-package-${String(stack.state.revision + 1).padStart(4, "0")}`,
    demandId: IDS.demand,
    createdAt: artifact.createdAt,
    actor: "controller",
    command: "create-task-package",
    type: "task-package.created",
    previousRevision: stack.state.revision,
    nextRevision: stack.state.revision + 1,
    from: stack.state.state,
    to: "planned",
    reason: "recover one interrupted immutable TaskPackage transaction",
    decisionSummary: "Bind the exact TaskPackage file, event, and next state.",
    changedArtifacts: [identity],
  });
  const nextState = validateDemandStateRecord({
    ...stack.state,
    revision: event.nextRevision,
    state: event.to,
    stateReason: event.reason,
    updatedAt: event.createdAt,
    lastEvent: { eventId: event.eventId, eventDigest: canonicalJsonDigest(event) },
    taskPackages: [...stack.state.taskPackages, {
      taskPackageId: artifact.taskPackageId,
      ref: identity.ref,
      digest: identity.digest,
      lifecycleStatus: "active",
    }].sort((left, right) => left.taskPackageId.localeCompare(right.taskPackageId)),
    targetTasks: [...stack.state.targetTasks, {
      targetTaskId: artifact.targetTaskId,
      taskPackageId: artifact.taskPackageId,
      windowId: artifact.windowId,
      repositoryId: artifact.repositoryId,
      lifecycleStatus: "planned",
    }].sort((left, right) => left.targetTaskId.localeCompare(right.targetTaskId)),
  });
  const journal = validateStateTransitionRecord({
    schemaVersion: 1,
    artifactKind: "wakeflow-state-transition",
    demandId: IDS.demand,
    command: event.command,
    createdAt: event.createdAt,
    expectedPreviousRevision: stack.state.revision,
    expectedPreviousStateDigest: stack.digests.state,
    previousState: stack.state,
    nextEvent: event,
    nextEventDigest: canonicalJsonDigest(event),
    nextState,
    nextStateDigest: canonicalJsonDigest(nextState),
    artifactWrites: [{ ...identity, value: artifact }],
  }, {
    demand: fixture.demand,
    currentState: stack.state,
    ledgerRoot: fixture.ledgerRoot,
  });
  return { stack, artifact, identity, event, nextState, journal };
}

async function buildResultRecoveryIntent(fixture, packageRecord) {
  const { demandArtifactIdentity } = await import(artifactModule);
  const {
    validateControllerEventRecord,
    validateDemandStateRecord,
    validateStateTransitionRecord,
  } = await import("../core/scripts/lib/wakeflow-demand-core-records.mjs");
  const stack = await currentStack(fixture);
  const artifact = integrationResult(fixture, stack, packageRecord);
  const identity = demandArtifactIdentity(artifact);
  const event = validateControllerEventRecord({
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: `event-recovery-result-${String(stack.state.revision + 1).padStart(4, "0")}`,
    demandId: IDS.demand,
    createdAt: artifact.createdAt,
    actor: "controller",
    command: "record-target-result-current",
    type: "target-result.recorded",
    previousRevision: stack.state.revision,
    nextRevision: stack.state.revision + 1,
    from: stack.state.state,
    to: stack.state.state,
    reason: "recover one interrupted immutable TargetResult transaction",
    decisionSummary: "Bind the exact nested result file, event, and current-result selection.",
    changedArtifacts: [identity],
  });
  const nextStateValue = structuredClone(stack.state);
  nextStateValue.revision = event.nextRevision;
  nextStateValue.stateReason = event.reason;
  nextStateValue.updatedAt = event.createdAt;
  nextStateValue.lastEvent = { eventId: event.eventId, eventDigest: canonicalJsonDigest(event) };
  nextStateValue.targetResults.push({
    targetResultId: artifact.targetResultId,
    targetTaskId: artifact.targetTaskId,
    ref: identity.ref,
    digest: identity.digest,
    lifecycleStatus: "current",
  });
  const targetTask = nextStateValue.targetTasks.find((entry) => entry.targetTaskId === artifact.targetTaskId);
  targetTask.currentResult = {
    targetResultId: artifact.targetResultId,
    ref: identity.ref,
    digest: identity.digest,
  };
  targetTask.lifecycleStatus = "review-ready";
  const nextState = validateDemandStateRecord(nextStateValue);
  const journal = validateStateTransitionRecord({
    schemaVersion: 1,
    artifactKind: "wakeflow-state-transition",
    demandId: IDS.demand,
    command: event.command,
    createdAt: event.createdAt,
    expectedPreviousRevision: stack.state.revision,
    expectedPreviousStateDigest: stack.digests.state,
    previousState: stack.state,
    nextEvent: event,
    nextEventDigest: canonicalJsonDigest(event),
    nextState,
    nextStateDigest: canonicalJsonDigest(nextState),
    artifactWrites: [{ ...identity, value: artifact }],
  }, {
    demand: fixture.demand,
    currentState: stack.state,
    ledgerRoot: fixture.ledgerRoot,
  });
  return { stack, artifact, identity, event, nextState, journal };
}

test("the shared typed identity domain admits demand artifacts, evidence, and T06 transport", async () => {
  const { WAKEFLOW_ID_TYPES, assertWakeflowId } = await import("../core/scripts/lib/wakeflow-identifiers.mjs");
  assert.deepEqual(WAKEFLOW_ID_TYPES, [
    "archive",
    "confirmation",
    "demand",
    "delivery",
    "delivery-run",
    "dispatch-group",
    "dispatch-packet",
    "evidence",
    "pod",
    "pod-design-handoff",
    "pod-design-request",
    "program",
    "preservation",
    "repository",
    "requirement",
    "review-candidate",
    "surface",
    "target-result",
    "target-task",
    "task-package",
    "test-attempt",
    "test-card",
    "window",
  ]);
  assert.equal(assertWakeflowId(IDS.taskPackage, "task-package"), IDS.taskPackage);
  assert.equal(assertWakeflowId(IDS.targetTask, "target-task"), IDS.targetTask);
  assert.equal(assertWakeflowId(IDS.targetResult, "target-result"), IDS.targetResult);
  assert.equal(assertWakeflowId(IDS.reviewCandidate, "review-candidate"), IDS.reviewCandidate);
  assert.equal(assertWakeflowId(IDS.testCard, "test-card"), IDS.testCard);
  assert.equal(
    assertWakeflowId("evidence_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "evidence"),
    "evidence_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  );
  assert.throws(() => assertWakeflowId("Task Package A", "task-package"));
  assert.throws(() => assertWakeflowId(IDS.targetTask, "task-package"));
});

test("the demand artifact family ships six closed schemas and excludes lifecycle mirrors", () => {
  const schemaRoot = path.join(repositoryRoot, "core/schemas/wakeflow-demand-artifacts");
  const files = readdirSync(schemaRoot).sort();
  assert.deepEqual(files, [
    "pod-design-handoff.schema.json",
    "pod-design-request.schema.json",
    "review-candidate.schema.json",
    "target-result.schema.json",
    "task-package.schema.json",
    "test-card.schema.json",
  ]);
  for (const file of files) {
    const schema = JSON.parse(readFileSync(path.join(schemaRoot, file), "utf8"));
    visit(schema, (node, nodePath) => {
      if (node.type === "object") {
        assert.equal(node.additionalProperties, false, `${file}:${nodePath}`);
      }
    });
    for (const forbidden of ["status", "currentResult", "resultRevision", "historyFile", "draft", "targetWindow", "demandKey"]) {
      assert.equal(Object.hasOwn(schema.properties, forbidden), false, `${file} cannot expose ${forbidden}`);
    }
  }
});

test("T05 strict record domain validates and derives only canonical refs", async () => {
  const records = await import(artifactModule);
  const cases = [
    [taskPackage(), records.validateTaskPackageArtifact, `task-packages/${IDS.taskPackage}.json`],
    [targetResult(), records.validateTargetResultArtifact, `target-results/${IDS.targetTask}/${IDS.targetResult}.json`],
    [reviewCandidate(), records.validateReviewCandidateArtifact, `review-candidates/${IDS.reviewCandidate}.json`],
    [testCard(), records.validateTestCardArtifact, `test-cards/${IDS.testCard}.json`],
  ];
  for (const [record, validate, expectedRef] of cases) {
    assert.deepEqual(validate(record), record);
    assert.equal(records.demandArtifactRef(record), expectedRef);
    assert.match(records.demandArtifactDigest(record), /^sha256:[0-9a-f]{64}$/u);
    assert.ok(records.demandArtifactCanonicalBytes(record).equals(Buffer.from(`${canonicalJson(record)}\n`, "utf8")));
    const widened = structuredClone(record);
    widened.status = "pending";
    assert.throws(() => validate(widened));
  }
  const wrongNestedIdentity = targetResult();
  wrongNestedIdentity.targetTaskId = IDS.taskPackage;
  assert.throws(() => records.validateTargetResultArtifact(wrongNestedIdentity));

  const testPackageRecord = taskPackage();
  testPackageRecord.workType = "test";
  delete testPackageRecord.repositoryId;
  delete testPackageRecord.commitExpectation;
  testPackageRecord.acceptanceAnchors = [];
  testPackageRecord.reviewInputContract = {
    requiredKinds: [],
    requiredAcceptanceAnchorIds: [],
  };
  testPackageRecord.testCard = {
    testCardId: IDS.testCard,
    ref: `test-cards/${IDS.testCard}.json`,
    digest: canonicalJsonDigest(testCard()),
  };
  assert.deepEqual(records.validateTaskPackageArtifact(testPackageRecord), testPackageRecord);
  testPackageRecord.commitExpectation = "leave-uncommitted";
  assert.throws(
    () => records.validateTaskPackageArtifact(testPackageRecord),
    (error) => error?.code === "wakeflow-demand-artifact-test-contract",
  );
  const productWithoutCommitContract = taskPackage();
  delete productWithoutCommitContract.commitExpectation;
  assert.throws(
    () => records.validateTaskPackageArtifact(productWithoutCommitContract),
    (error) => error?.code === "wakeflow-demand-artifact-repository",
  );

  for (const maxAttempts of [0, 11]) {
    const invalidCard = testCard();
    invalidCard.executionContract.maxAttempts = maxAttempts;
    assert.throws(() => records.validateTestCardArtifact(invalidCard));
  }
  const missingRestartCondition = testCard();
  missingRestartCondition.executionContract.restartConditions = [];
  assert.throws(
    () => records.validateTestCardArtifact(missingRestartCondition),
    (error) => error?.code === "wakeflow-demand-artifact-test-restart",
  );
});

test("T05 artifact codecs and service inputs reject accessors without executing them", async () => {
  const records = await import(artifactModule);
  const service = await import(serviceModule);
  let getterCalls = 0;

  const accessorPackage = taskPackage();
  Object.defineProperty(accessorPackage, "objective", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "forged objective";
    },
  });
  assert.throws(
    () => records.validateTaskPackageArtifact(accessorPackage),
    (error) => error?.code === "wakeflow-demand-artifact-data",
  );

  const accessorLoaderInput = { ref: `task-packages/${IDS.taskPackage}.json` };
  Object.defineProperty(accessorLoaderInput, "stateRoot", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "/tmp/forged-state-root";
    },
  });
  assert.throws(
    () => records.loadDemandArtifactByRef(accessorLoaderInput),
    (error) => error?.code === "wakeflow-demand-artifact-data",
  );

  const accessorServiceInput = {};
  Object.defineProperty(accessorServiceInput, "stateRoot", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "/tmp/forged-state-root";
    },
  });
  assert.throws(
    () => service.createTaskPackageArtifact(accessorServiceInput),
    (error) => error?.code === "wakeflow-demand-artifact-service-input",
  );

  const accessorAssignment = { repositoryId: IDS.repository, workType: "implementation" };
  Object.defineProperty(accessorAssignment, "windowId", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return IDS.window;
    },
  });
  assert.throws(
    () => service.validateDemandTaskAssignmentAgainstTopology({
      artifact: accessorAssignment,
      config: { indexes: { windowById: {} } },
    }),
    (error) => error?.code === "wakeflow-demand-artifact-service-input",
  );
  assert.equal(getterCalls, 0);
});

test("T05 candidate state stores exact summaries and events bind artifact identity", async () => {
  const { validateControllerEventRecord, validateDemandStateRecord } = await import("../core/scripts/lib/wakeflow-demand-core-records.mjs");
  const pkg = taskPackage();
  const pkgDigest = canonicalJsonDigest(pkg);
  const pkgRef = `task-packages/${IDS.taskPackage}.json`;
  const event = {
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: "event-task-package-created-0002",
    demandId: IDS.demand,
    createdAt: CREATED_AT,
    actor: "controller",
    command: "create-task-package",
    type: "task-package.created",
    previousRevision: 1,
    nextRevision: 2,
    from: "intake",
    to: "planned",
    reason: "Freeze the exact task package.",
    decisionSummary: "Create one immutable task contract.",
    changedArtifacts: [{
      artifactKind: "wakeflow-task-package",
      artifactId: IDS.taskPackage,
      ref: pkgRef,
      digest: pkgDigest,
    }],
  };
  const state = {
    schemaVersion: 1,
    artifactKind: "wakeflow-state",
    programId: IDS.program,
    demandId: IDS.demand,
    demandRef: "demand.json",
    demandDigest: DEMAND_DIGEST,
    revision: 2,
    state: "planned",
    stateReason: event.reason,
    updatedAt: CREATED_AT,
    lastEvent: { eventId: event.eventId, eventDigest: canonicalJsonDigest(event) },
    taskPackages: [{ taskPackageId: IDS.taskPackage, ref: pkgRef, digest: pkgDigest, lifecycleStatus: "active" }],
    targetTasks: [{
      targetTaskId: IDS.targetTask,
      taskPackageId: IDS.taskPackage,
      windowId: IDS.window,
      repositoryId: IDS.repository,
      lifecycleStatus: "planned",
    }],
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
  assert.deepEqual(validateControllerEventRecord(event), event);
  assert.deepEqual(validateDemandStateRecord(state), state);
  assert.equal(JSON.stringify(state).includes(pkg.objective), false, "state cannot copy package payload");
});

test("T05 layout records the nested TargetResult directory and file", async () => {
  const fixture = JSON.parse(readFileSync(path.join(repositoryRoot, "test/fixtures/wakeflow-config-v3/valid-minimal.json"), "utf8"));
  const { parseWakeflowConfigV3 } = await import("../core/scripts/lib/wakeflow-config-v3.mjs");
  const { hostProfile } = await import("../core/scripts/lib/wakeflow-host-profile.mjs");
  const { createWakeflowLayoutDescriptor, wakeflowLayoutEntry } = await import("../core/scripts/lib/wakeflow-layout-descriptor.mjs");
  const descriptor = createWakeflowLayoutDescriptor({ model: parseWakeflowConfigV3(fixture), hostProfile });
  const directory = wakeflowLayoutEntry(descriptor, "event.demand.target-results.target-task-root");
  assert.equal(directory.path, ".wakeflow-active/current/{demandId}/target-results/{targetTaskId}");
  assert.equal(directory.pathKind, "directory");
  assert.equal(directory.mode, "0700");
  assert.equal(
    wakeflowLayoutEntry(descriptor, "event.demand.target-result").path,
    ".wakeflow-active/current/{demandId}/target-results/{targetTaskId}/{targetResultId}.json",
  );
});

test("T05 service exposes four family APIs and reuses the T04 recovery manager", async () => {
  const service = await import(serviceModule);
  for (const name of [
    "createTaskPackageArtifact",
    "createTestCardArtifact",
    "recordTargetResultArtifact",
    "createReviewCandidateArtifact",
    "inventoryDemandArtifacts",
  ]) {
    assert.equal(typeof service[name], "function", name);
  }
  const state = await import("../core/scripts/lib/wakeflow-demand-state-service.mjs");
  assert.equal(typeof state.commitDemandArtifactTransition, "function");
  assert.equal(typeof state.recoverDemandStateTransition, "function");
});

test("T05 current artifact owners replace every retired public-v2 entrypoint", () => {
  const retiredFiles = [
    "core/scripts/wakeflow-state.mjs",
    "core/scripts/wakeflow-intake.mjs",
    "core/scripts/wakeflow-delivery.mjs",
    "core/scripts/wakeflow-demand-sequence.mjs",
    "core/scripts/wakeflow-render-progress.mjs",
    "plugins/codex-wakeflow/scripts/wakeflow-state.mjs",
    "plugins/codex-wakeflow/scripts/wakeflow-intake.mjs",
    "plugins/claude-code-wakeflow/scripts/wakeflow-state.mjs",
    "plugins/claude-code-wakeflow/scripts/wakeflow-intake.mjs",
  ];
  for (const relative of retiredFiles) assert.equal(existsSync(path.join(repositoryRoot, relative)), false, relative);
  assert.equal(existsSync(path.join(repositoryRoot, "core/scripts/lib/wakeflow-demand-artifact-records.mjs")), true);
  assert.equal(existsSync(path.join(repositoryRoot, "core/scripts/lib/wakeflow-demand-artifact-service.mjs")), true);
});

test("T05 TaskPackage commits one immutable file/event/state tuple and replays idempotently", async (t) => {
  const fixture = await makeIntegrationFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const {
    createTaskPackageArtifact,
    inventoryDemandArtifacts,
  } = await import(serviceModule);
  const {
    demandArtifactDigest,
    loadDemandArtifactByRef,
  } = await import(artifactModule);
  const before = await currentStack(fixture);
  const artifact = integrationPackage(fixture);
  artifact.requirementRefs.push({
    role: "evidence",
    ref: fixture.strategyRef.memberRef,
    digest: fixture.strategyRef.memberDigest,
  });
  const tx = transition("event-task-package-created-0002", artifact.createdAt);
  const args = {
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    config: fixture.config,
    expectedPrevious: expectedPrevious(before),
    artifact,
    transition: tx,
  };

  const unmanagedEvidence = structuredClone(artifact);
  unmanagedEvidence.requirementRefs.at(-1).ref = "evidence/unmanaged.txt";
  assert.throws(
    () => createTaskPackageArtifact({ ...args, artifact: unmanagedEvidence }),
    (error) => error?.code === "wakeflow-demand-artifact-service-requirement-ref",
  );
  const changedEvidenceDigest = structuredClone(artifact);
  changedEvidenceDigest.requirementRefs.at(-1).digest = `sha256:${"f".repeat(64)}`;
  assert.throws(
    () => createTaskPackageArtifact({ ...args, artifact: changedEvidenceDigest }),
    (error) => error?.code === "wakeflow-demand-artifact-service-requirement-ref",
  );
  const missingGoalAnchor = structuredClone(artifact);
  missingGoalAnchor.requirementRefs[0].anchor = "heading-that-does-not-exist";
  assert.throws(
    () => createTaskPackageArtifact({ ...args, artifact: missingGoalAnchor }),
    (error) => error?.code === "wakeflow-demand-artifact-service-requirement-anchor",
  );

  const created = createTaskPackageArtifact(args);
  assert.equal(created.created, true);
  assert.equal(created.revision, 2);
  assert.equal(created.artifact.ref, `task-packages/${IDS.taskPackage}.json`);
  const file = path.join(fixture.stateRoot, created.artifact.ref);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  const loadedArtifact = loadDemandArtifactByRef({
    stateRoot: fixture.stateRoot,
    ref: created.artifact.ref,
    digest: demandArtifactDigest(artifact),
    expectedArtifactKind: "wakeflow-task-package",
    expectedArtifactId: IDS.taskPackage,
    expectedProgramId: IDS.program,
    expectedDemandId: IDS.demand,
  });
  assert.deepEqual(loadedArtifact.record, artifact);
  assert.ok(Buffer.isBuffer(loadedArtifact.bytes));

  const after = await currentStack(fixture);
  assert.equal(after.state.revision, 2);
  assert.equal(after.events.length, 2);
  assert.deepEqual(after.state.taskPackages, [{
    taskPackageId: IDS.taskPackage,
    ref: created.artifact.ref,
    digest: created.artifact.digest,
    lifecycleStatus: "active",
  }]);
  assert.equal(after.state.targetTasks[0].targetTaskId, IDS.targetTask);
  assert.equal(JSON.stringify(after.state).includes(artifact.objective), false);

  const replay = createTaskPackageArtifact(args);
  assert.equal(replay.created, false);
  assert.equal(replay.revision, 2);
  assert.equal((await currentStack(fixture)).events.length, 2);

  const changedBytes = structuredClone(artifact);
  changedBytes.objective = "A different immutable objective.";
  assert.throws(
    () => createTaskPackageArtifact({ ...args, artifact: changedBytes }),
    (error) => error?.code === "wakeflow-demand-artifact-service-conflict",
  );
  const changedIntent = transition("event-task-package-created-another", artifact.createdAt);
  assert.throws(
    () => createTaskPackageArtifact({ ...args, transition: changedIntent }),
    (error) => error?.code === "wakeflow-demand-artifact-service-conflict",
  );

  const inventory = inventoryDemandArtifacts({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
  assert.equal(inventory.status, "healthy");
  assert.equal(inventory.entries.length, 1);
  assert.equal(inventory.entries[0].classification, "committed");
  assert.equal(existsSync(path.join(fixture.stateRoot, "transactions/state-transition.json")), false);

  mkdirSync(path.join(
    fixture.stateRoot,
    "evidence",
    "evidence_adadadad-adad-4dad-8dad-adadadadadad",
  ), { mode: 0o700 });
  const beforeClosureReplayState = readFileSync(path.join(fixture.stateRoot, "wakeflow-state.json"));
  const beforeClosureReplayEvents = readFileSync(path.join(fixture.stateRoot, "controller-events.jsonl"));
  const beforeClosureReplayArtifact = readFileSync(file);
  assert.throws(
    () => createTaskPackageArtifact(args),
    (error) => error?.code === "wakeflow-demand-state-evidence-inventory",
  );
  assert.deepEqual(
    readFileSync(path.join(fixture.stateRoot, "wakeflow-state.json")),
    beforeClosureReplayState,
  );
  assert.deepEqual(
    readFileSync(path.join(fixture.stateRoot, "controller-events.jsonl")),
    beforeClosureReplayEvents,
  );
  assert.deepEqual(readFileSync(file), beforeClosureReplayArtifact);
  assert.deepEqual(readdirSync(path.join(fixture.stateRoot, "transactions")), []);
});

test("T05 four-family chain preserves result history and closes exact review scope", async (t) => {
  const fixture = await makeIntegrationFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const {
    createReviewCandidateArtifact,
    createTaskPackageArtifact,
    createTestCardArtifact,
    inventoryDemandArtifacts,
    recordTargetResultArtifact,
  } = await import(serviceModule);
  const { demandArtifactDigest } = await import(artifactModule);

  let stack = await currentStack(fixture);
  const productPackage = integrationPackage(fixture);
  createTaskPackageArtifact({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    config: fixture.config,
    expectedPrevious: expectedPrevious(stack),
    artifact: productPackage,
    transition: transition("event-product-package-0002", productPackage.createdAt),
  });
  stack = await simulateTargetDispatch(fixture, IDS.targetTask);

  const firstResult = integrationResult(fixture, stack, productPackage);
  const firstCommit = recordTargetResultArtifact({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    config: fixture.config,
    expectedPrevious: expectedPrevious(stack),
    artifact: firstResult,
    selection: "current",
    transition: transition("event-product-result-0004", firstResult.createdAt),
  });
  const firstFile = path.join(fixture.stateRoot, firstCommit.artifact.ref);
  const firstBytes = readFileSync(firstFile);
  stack = await currentStack(fixture);
  assert.equal(stack.state.targetTasks[0].lifecycleStatus, "review-ready");

  const correctedResult = integrationResult(fixture, stack, productPackage, {
    targetResultId: IDS.targetResult2,
    createdAt: "2026-08-07T03:04:00.000Z",
    supersedes: {
      targetResultId: IDS.targetResult,
      ref: firstCommit.artifact.ref,
      digest: firstCommit.artifact.digest,
    },
  });
  recordTargetResultArtifact({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    config: fixture.config,
    expectedPrevious: expectedPrevious(stack),
    artifact: correctedResult,
    selection: "current",
    transition: transition("event-product-result-corrected-0005", correctedResult.createdAt),
  });
  assert.deepEqual(readFileSync(firstFile), firstBytes, "a correction cannot overwrite prior immutable bytes");
  stack = await currentStack(fixture);
  const productTask = stack.state.targetTasks.find((entry) => entry.targetTaskId === IDS.targetTask);
  assert.equal(productTask.currentResult.targetResultId, IDS.targetResult2);
  assert.equal(
    stack.state.targetResults.find((entry) => entry.targetResultId === IDS.targetResult).lifecycleStatus,
    "historical",
  );

  const lateHistoricalResult = integrationResult(fixture, stack, productPackage, {
    targetResultId: IDS.targetResultLate,
    createdAt: "2026-08-07T03:04:30.000Z",
  });
  recordTargetResultArtifact({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    config: fixture.config,
    expectedPrevious: expectedPrevious(stack),
    artifact: lateHistoricalResult,
    transition: transition("event-product-result-late-0006", lateHistoricalResult.createdAt),
    selection: "historical",
  });
  stack = await currentStack(fixture);
  assert.equal(
    stack.state.targetTasks.find((entry) => entry.targetTaskId === IDS.targetTask).currentResult.targetResultId,
    IDS.targetResult2,
    "a historical late result cannot replace the controller-selected current result",
  );

  const partialCandidate = integrationReviewCandidate(fixture, stack, correctedResult, {
    reviewCandidateId: IDS.reviewCandidate2,
    excludedTargetTaskIds: [IDS.testTargetTask],
    createdAt: "2026-08-07T03:06:00.000Z",
  });
  assert.throws(
    () => createReviewCandidateArtifact({
      stateRoot: fixture.stateRoot,
      expectedProgramId: IDS.program,
      ledgerRoot: fixture.ledgerRoot,
      expectedPrevious: expectedPrevious(stack),
      artifact: partialCandidate,
      transition: transition("event-partial-review-rejected", partialCandidate.createdAt),
    }),
    (error) => error?.code === "wakeflow-demand-artifact-service-review",
  );
  assert.equal((await currentStack(fixture)).state.revision, stack.state.revision);

  const wrongOutcomeCandidate = integrationReviewCandidate(fixture, stack, correctedResult, {
    reviewCandidateId: IDS.reviewCandidate2,
    createdAt: "2026-08-07T03:07:00.000Z",
  });
  wrongOutcomeCandidate.readyTargetTaskIds = [];
  wrongOutcomeCandidate.blockedTargetTaskIds = [IDS.targetTask];
  assert.throws(
    () => createReviewCandidateArtifact({
      stateRoot: fixture.stateRoot,
      expectedProgramId: IDS.program,
      ledgerRoot: fixture.ledgerRoot,
      expectedPrevious: expectedPrevious(stack),
      artifact: wrongOutcomeCandidate,
      transition: transition("event-wrong-review-outcome-rejected", wrongOutcomeCandidate.createdAt),
    }),
    (error) => error?.code === "wakeflow-demand-artifact-service-review",
  );

  const candidate = integrationReviewCandidate(fixture, stack, correctedResult);
  const candidateCommit = createReviewCandidateArtifact({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    expectedPrevious: expectedPrevious(stack),
    artifact: candidate,
    transition: transition("event-product-review-candidate", candidate.createdAt),
  });
  assert.equal(candidateCommit.created, true);
  stack = await currentStack(fixture);
  assert.equal(stack.state.review.status, "pending");
  assert.equal(stack.state.review.pendingCandidate.reviewCandidateId, IDS.reviewCandidate);
  assert.equal(stack.state.state, "review-ready");

  stack = await simulateReviewAcceptance(fixture, [IDS.targetTask]);
  const card = integrationTestCard(fixture, stack, {
    createdAt: "2026-08-07T03:09:00.000Z",
  });
  const cardCommit = createTestCardArtifact({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    config: fixture.config,
    expectedPrevious: expectedPrevious(stack),
    artifact: card,
    transition: transition("event-test-card-created", card.createdAt),
  });
  stack = await currentStack(fixture);
  const testPackage = integrationPackage(fixture, {
    taskPackageId: IDS.testTaskPackage,
    targetTaskId: IDS.testTargetTask,
    createdAt: "2026-08-07T03:10:00.000Z",
    workType: "test",
    windowId: IDS.testWindow,
    testCard: {
      testCardId: IDS.testCard,
      ref: cardCommit.artifact.ref,
      digest: cardCommit.artifact.digest,
    },
  });
  createTaskPackageArtifact({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    config: fixture.config,
    expectedPrevious: expectedPrevious(stack),
    artifact: testPackage,
    transition: transition("event-test-package-created", testPackage.createdAt),
  });
  stack = await currentStack(fixture);
  assert.equal(stack.state.review.status, "idle");
  assert.equal(
    stack.state.targetTasks.find((entry) => entry.targetTaskId === IDS.targetTask).lifecycleStatus,
    "accepted",
  );

  stack = await simulateTargetDispatch(fixture, IDS.testTargetTask, {
    createdAt: "2026-08-07T03:11:00.000Z",
  });
  const testResult = integrationResult(fixture, stack, testPackage, {
    targetResultId: IDS.testTargetResult,
    createdAt: "2026-08-07T03:12:00.000Z",
  });
  recordTargetResultArtifact({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    config: fixture.config,
    expectedPrevious: expectedPrevious(stack),
    artifact: testResult,
    selection: "current",
    transition: transition("event-test-result-recorded", testResult.createdAt),
  });
  stack = await currentStack(fixture);
  assert.equal(
    stack.state.targetTasks.find((entry) => entry.targetTaskId === IDS.testTargetTask).currentResult.targetResultId,
    IDS.testTargetResult,
  );

  const inventory = inventoryDemandArtifacts({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
  assert.equal(inventory.status, "healthy");
  assert.equal(inventory.entries.length, 8);
  assert.ok(inventory.entries.every((entry) => entry.classification === "committed"));
  assert.equal(demandArtifactDigest(card), cardCommit.artifact.digest);
});

test("T05 concurrent identical TaskPackage intent yields one create and one replay", async (t) => {
  const fixture = await makeIntegrationFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const { inventoryDemandArtifacts } = await import(serviceModule);
  const stack = await currentStack(fixture);
  const artifact = integrationPackage(fixture);
  const args = {
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    config: fixture.config,
    expectedPrevious: expectedPrevious(stack),
    artifact,
    transition: transition("event-concurrent-package-0002", artifact.createdAt),
  };
  const attempts = await Promise.all([runPackageChild(args), runPackageChild(args)]);
  assert.deepEqual(attempts.map((entry) => entry.code), [0, 0], attempts.map((entry) => entry.stderr).join("\n"));
  assert.deepEqual(attempts.map((entry) => entry.payload.created).sort(), [false, true]);
  const after = await currentStack(fixture);
  assert.equal(after.state.revision, 2);
  assert.equal(after.events.length, 2);
  const inventory = inventoryDemandArtifacts({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
  assert.equal(inventory.status, "healthy");
  assert.equal(inventory.entries.length, 1);
});

test("T05 current versus historical admission is part of exact TargetResult intent", async (t) => {
  const fixture = await makeIntegrationFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const {
    createTaskPackageArtifact,
    recordTargetResultArtifact,
  } = await import(serviceModule);
  let stack = await currentStack(fixture);
  const task = integrationPackage(fixture);
  createTaskPackageArtifact({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    config: fixture.config,
    expectedPrevious: expectedPrevious(stack),
    artifact: task,
    transition: transition("event-selection-package", task.createdAt),
  });
  stack = await simulateTargetDispatch(fixture, IDS.targetTask);
  const result = integrationResult(fixture, stack, task);
  const baseArgs = {
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    config: fixture.config,
    expectedPrevious: expectedPrevious(stack),
    artifact: result,
    transition: transition("event-selection-result", result.createdAt),
  };
  const attempts = await Promise.all([
    runResultChild({ ...baseArgs, selection: "current" }),
    runResultChild({ ...baseArgs, selection: "historical" }),
  ]);
  assert.deepEqual(attempts.map((entry) => entry.payload.status).sort(), ["error", "ok"]);
  const rejected = attempts.find((entry) => entry.payload.status === "error");
  assert.equal(rejected.payload.code, "wakeflow-demand-artifact-service-conflict");
  const finalStack = await currentStack(fixture);
  assert.equal(finalStack.state.revision, stack.state.revision + 1);
  assert.equal(finalStack.events.at(-1).type, "target-result.recorded");
  assert.ok([
    "record-target-result-current",
    "record-target-result-historical",
  ].includes(finalStack.events.at(-1).command));
  const losingSelection = finalStack.events.at(-1).command.endsWith("current")
    ? "historical"
    : "current";
  assert.throws(
    () => recordTargetResultArtifact({ ...baseArgs, selection: losingSelection }),
    (error) => error?.code === "wakeflow-demand-artifact-service-conflict",
  );
});

test("T05 completed demand reopens only through one exact same-repository continuation", async (t) => {
  const fixture = await makeIntegrationFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const {
    createTaskPackageArtifact,
  } = await import(serviceModule);
  const {
    demandArtifactDigest,
    validateTaskPackageArtifact,
  } = await import(artifactModule);
  let stack = await currentStack(fixture);
  const original = integrationPackage(fixture);
  createTaskPackageArtifact({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    config: fixture.config,
    expectedPrevious: expectedPrevious(stack),
    artifact: original,
    transition: transition("event-continuation-original", original.createdAt),
  });
  stack = await simulateDemandCompletion(fixture, [IDS.targetTask]);

  const ordinarySecondPackage = integrationPackage(fixture, {
    taskPackageId: IDS.taskPackageOther,
    targetTaskId: IDS.targetTaskOther,
    createdAt: "2026-08-07T03:31:00.000Z",
  });
  assert.throws(
    () => createTaskPackageArtifact({
      stateRoot: fixture.stateRoot,
      expectedProgramId: IDS.program,
      ledgerRoot: fixture.ledgerRoot,
      config: fixture.config,
      expectedPrevious: expectedPrevious(stack),
      artifact: ordinarySecondPackage,
      transition: transition("event-ordinary-reopen-rejected", ordinarySecondPackage.createdAt),
    }),
    (error) => error?.code === "wakeflow-demand-artifact-service-continuation",
  );

  const continuation = structuredClone(ordinarySecondPackage);
  continuation.continuation = {
    kind: "requirement-supplement",
    previousTaskPackageId: IDS.taskPackage,
    ref: `task-packages/${IDS.taskPackage}.json`,
    digest: demandArtifactDigest(original),
    reason: "The confirmed requirement gained one bounded supplement.",
  };
  const committed = createTaskPackageArtifact({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    config: fixture.config,
    expectedPrevious: expectedPrevious(stack),
    artifact: continuation,
    transition: transition("event-explicit-continuation", continuation.createdAt),
  });
  assert.equal(committed.created, true);
  stack = await currentStack(fixture);
  assert.equal(stack.state.state, "planned");
  assert.equal(stack.state.targetTasks.length, 2);
  assert.equal(
    stack.state.taskPackages.find((entry) => entry.taskPackageId === IDS.taskPackage).lifecycleStatus,
    "closed",
  );
  assert.equal(
    stack.state.taskPackages.find((entry) => entry.taskPackageId === IDS.taskPackageOther).lifecycleStatus,
    "active",
  );

  const ambiguous = structuredClone(continuation);
  ambiguous.replacesTargetTask = {
    targetTaskId: IDS.targetTask,
    taskPackageRef: `task-packages/${IDS.taskPackage}.json`,
    taskPackageDigest: demandArtifactDigest(original),
  };
  assert.throws(
    () => validateTaskPackageArtifact(ambiguous),
    (error) => error?.code === "wakeflow-demand-artifact-lineage",
  );
});

test("T05 ordinary rework reuses its task while review classifies the old current result as missing", async (t) => {
  const fixture = await makeIntegrationFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const {
    createReviewCandidateArtifact,
    createTaskPackageArtifact,
    recordTargetResultArtifact,
  } = await import(serviceModule);
  const { demandArtifactDigest } = await import(artifactModule);

  let stack = await currentStack(fixture);
  const original = integrationPackage(fixture);
  createTaskPackageArtifact({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    config: fixture.config,
    expectedPrevious: expectedPrevious(stack),
    artifact: original,
    transition: transition("event-rework-original-package", original.createdAt),
  });
  stack = await simulateTargetDispatch(fixture, IDS.targetTask);
  const result = integrationResult(fixture, stack, original);
  recordTargetResultArtifact({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    config: fixture.config,
    expectedPrevious: expectedPrevious(stack),
    artifact: result,
    selection: "current",
    transition: transition("event-rework-original-result", result.createdAt),
  });
  stack = await currentStack(fixture);
  const reworkCandidate = integrationReviewCandidate(fixture, stack, result);
  createReviewCandidateArtifact({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    expectedPrevious: expectedPrevious(stack),
    artifact: reworkCandidate,
    transition: transition("event-rework-original-candidate", reworkCandidate.createdAt),
  });
  stack = await simulateReviewRework(fixture, IDS.targetTask);

  const unauthorizedReplacement = integrationPackage(fixture, {
    taskPackageId: IDS.taskPackageOther,
    targetTaskId: IDS.targetTaskOther,
    createdAt: "2026-08-07T03:09:00.000Z",
  });
  unauthorizedReplacement.replacesTargetTask = {
    targetTaskId: IDS.targetTask,
    taskPackageRef: `task-packages/${IDS.taskPackage}.json`,
    taskPackageDigest: demandArtifactDigest(original),
  };
  assert.throws(
    () => createTaskPackageArtifact({
      stateRoot: fixture.stateRoot,
      expectedProgramId: IDS.program,
      ledgerRoot: fixture.ledgerRoot,
      config: fixture.config,
      expectedPrevious: expectedPrevious(stack),
      artifact: unauthorizedReplacement,
      transition: transition("event-ordinary-rework-cannot-redesign", unauthorizedReplacement.createdAt),
    }),
    (error) => error?.code === "wakeflow-demand-artifact-service-replacement",
  );

  const results = [];
  const candidate = {
    ...common("wakeflow-review-candidate"),
    demandDigest: canonicalJsonDigest(fixture.demand),
    createdAt: "2026-08-07T03:10:00.000Z",
    reviewCandidateId: IDS.reviewCandidate2,
    fromState: {
      revision: stack.state.revision,
      stateDigest: stack.digests.state,
      eventId: stack.state.lastEvent.eventId,
      eventDigest: stack.state.lastEvent.eventDigest,
    },
    reviewScope: { targetTaskIds: [IDS.targetTask], excludedTargetTaskIds: [] },
    results,
    resultSetDigest: canonicalJsonDigest(results),
    readyTargetTaskIds: [],
    blockedTargetTaskIds: [],
    missingTargetTaskIds: [IDS.targetTask],
    allowedDecisions: ["accept", "blocked", "redesign", "rework"],
    structuralGaps: ["The ordinary rework target has not returned a new current result."],
  };
  createReviewCandidateArtifact({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    expectedPrevious: expectedPrevious(stack),
    artifact: candidate,
    transition: transition("event-rework-missing-review", candidate.createdAt),
  });
  stack = await currentStack(fixture);
  assert.deepEqual(stack.state.review.missingTargetTaskIds, [IDS.targetTask]);
  assert.deepEqual(stack.state.review.readyTargetTaskIds, []);
});

test("T05 an explicit redesign tail authorizes one exact same-repository replacement", async (t) => {
  const fixture = await makeIntegrationFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const {
    createReviewCandidateArtifact,
    createTaskPackageArtifact,
    recordTargetResultArtifact,
  } = await import(serviceModule);
  const { demandArtifactDigest } = await import(artifactModule);

  let stack = await currentStack(fixture);
  const original = integrationPackage(fixture);
  createTaskPackageArtifact({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    config: fixture.config,
    expectedPrevious: expectedPrevious(stack),
    artifact: original,
    transition: transition("event-redesign-original-package", original.createdAt),
  });
  stack = await simulateTargetDispatch(fixture, IDS.targetTask);
  const result = integrationResult(fixture, stack, original);
  recordTargetResultArtifact({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    config: fixture.config,
    expectedPrevious: expectedPrevious(stack),
    artifact: result,
    selection: "current",
    transition: transition("event-redesign-original-result", result.createdAt),
  });
  stack = await currentStack(fixture);
  const redesignCandidate = integrationReviewCandidate(fixture, stack, result);
  createReviewCandidateArtifact({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    expectedPrevious: expectedPrevious(stack),
    artifact: redesignCandidate,
    transition: transition("event-redesign-original-candidate", redesignCandidate.createdAt),
  });
  stack = await simulateReviewRework(fixture, IDS.targetTask, { decision: "redesign" });
  const replacement = integrationPackage(fixture, {
    taskPackageId: IDS.taskPackageOther,
    targetTaskId: IDS.targetTaskOther,
    createdAt: "2026-08-07T03:09:00.000Z",
  });
  replacement.replacesTargetTask = {
    targetTaskId: IDS.targetTask,
    taskPackageRef: `task-packages/${IDS.taskPackage}.json`,
    taskPackageDigest: demandArtifactDigest(original),
  };
  createTaskPackageArtifact({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    config: fixture.config,
    expectedPrevious: expectedPrevious(stack),
    artifact: replacement,
    transition: transition("event-redesign-replacement-package", replacement.createdAt),
  });
  stack = await currentStack(fixture);
  assert.equal(stack.state.state, "planned");
  assert.equal(
    stack.state.targetTasks.find((entry) => entry.targetTaskId === IDS.targetTask).lifecycleStatus,
    "superseded",
  );
  assert.equal(
    stack.state.taskPackages.find((entry) => entry.taskPackageId === IDS.taskPackage).lifecycleStatus,
    "superseded",
  );
  assert.equal(
    stack.state.targetTasks.find((entry) => entry.targetTaskId === IDS.targetTaskOther).lifecycleStatus,
    "planned",
  );
});

test("T05 TestCard requires real-environment authority and reserves its target identity", async (t) => {
  const controllerOnly = await makeIntegrationFixture({ testMode: "controller-only" });
  const realEnvironment = await makeIntegrationFixture();
  const openProduct = await makeIntegrationFixture();
  t.after(() => {
    rmSync(controllerOnly.root, { recursive: true, force: true });
    rmSync(realEnvironment.root, { recursive: true, force: true });
    rmSync(openProduct.root, { recursive: true, force: true });
  });
  const {
    createTaskPackageArtifact,
    createTestCardArtifact,
    inventoryDemandArtifacts,
  } = await import(serviceModule);

  let stack = await currentStack(controllerOnly);
  const forbiddenCard = integrationTestCard(controllerOnly, stack);
  assert.throws(
    () => createTestCardArtifact({
      stateRoot: controllerOnly.stateRoot,
      expectedProgramId: IDS.program,
      ledgerRoot: controllerOnly.ledgerRoot,
      config: controllerOnly.config,
      expectedPrevious: expectedPrevious(stack),
      artifact: forbiddenCard,
      transition: transition("event-controller-only-card-rejected", forbiddenCard.createdAt),
    }),
    (error) => error?.code === "wakeflow-demand-artifact-service-authority",
  );
  assert.equal((await currentStack(controllerOnly)).state.revision, 1);

  stack = await currentStack(openProduct);
  const openPackage = integrationPackage(openProduct);
  createTaskPackageArtifact({
    stateRoot: openProduct.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: openProduct.ledgerRoot,
    config: openProduct.config,
    expectedPrevious: expectedPrevious(stack),
    artifact: openPackage,
    transition: transition("event-open-product-package", openPackage.createdAt),
  });
  stack = await currentStack(openProduct);
  const prematureCard = integrationTestCard(openProduct, stack);
  assert.throws(
    () => createTestCardArtifact({
      stateRoot: openProduct.stateRoot,
      expectedProgramId: IDS.program,
      ledgerRoot: openProduct.ledgerRoot,
      config: openProduct.config,
      expectedPrevious: expectedPrevious(stack),
      artifact: prematureCard,
      transition: transition("event-open-product-card-rejected", prematureCard.createdAt),
    }),
    (error) => error?.code === "wakeflow-demand-artifact-service-test-gate",
  );

  stack = await currentStack(realEnvironment);
  const staleCard = integrationTestCard(realEnvironment, stack, {
    testCardId: IDS.testCard,
    targetTaskId: IDS.testTargetTask,
  });
  staleCard.observedState.eventId = "event-not-the-tail";
  assert.throws(
    () => createTestCardArtifact({
      stateRoot: realEnvironment.stateRoot,
      expectedProgramId: IDS.program,
      ledgerRoot: realEnvironment.ledgerRoot,
      config: realEnvironment.config,
      expectedPrevious: expectedPrevious(stack),
      artifact: staleCard,
      transition: transition("event-stale-test-card-rejected", staleCard.createdAt),
    }),
    (error) => error?.code === "wakeflow-demand-artifact-service-observed-state",
  );

  const wrongGoal = integrationTestCard(realEnvironment, stack);
  wrongGoal.executionContract.requirementGoal = "A different requirement goal.";
  assert.throws(
    () => createTestCardArtifact({
      stateRoot: realEnvironment.stateRoot,
      expectedProgramId: IDS.program,
      ledgerRoot: realEnvironment.ledgerRoot,
      config: realEnvironment.config,
      expectedPrevious: expectedPrevious(stack),
      artifact: wrongGoal,
      transition: transition("event-wrong-test-goal-rejected", wrongGoal.createdAt),
    }),
    (error) => error?.code === "wakeflow-demand-artifact-service-test-goal",
  );
  const unknownSkill = integrationTestCard(realEnvironment, stack);
  unknownSkill.executionContract.allowedSkills = ["progressive-chain-validation"];
  assert.throws(
    () => createTestCardArtifact({
      stateRoot: realEnvironment.stateRoot,
      expectedProgramId: IDS.program,
      ledgerRoot: realEnvironment.ledgerRoot,
      config: realEnvironment.config,
      expectedPrevious: expectedPrevious(stack),
      artifact: unknownSkill,
      transition: transition("event-unknown-test-skill-rejected", unknownSkill.createdAt),
    }),
    (error) => error?.code === "wakeflow-demand-artifact-service-test-skill",
  );
  const changedStrategy = integrationTestCard(realEnvironment, stack);
  changedStrategy.strategySource.digest = `sha256:${"f".repeat(64)}`;
  assert.throws(
    () => createTestCardArtifact({
      stateRoot: realEnvironment.stateRoot,
      expectedProgramId: IDS.program,
      ledgerRoot: realEnvironment.ledgerRoot,
      config: realEnvironment.config,
      expectedPrevious: expectedPrevious(stack),
      artifact: changedStrategy,
      transition: transition("event-changed-test-strategy-rejected", changedStrategy.createdAt),
    }),
    (error) => error?.code === "wakeflow-demand-artifact-service-authority",
  );

  const card = integrationTestCard(realEnvironment, stack);
  createTestCardArtifact({
    stateRoot: realEnvironment.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: realEnvironment.ledgerRoot,
    config: realEnvironment.config,
    expectedPrevious: expectedPrevious(stack),
    artifact: card,
    transition: transition("event-real-environment-card-0002", card.createdAt),
  });
  stack = await currentStack(realEnvironment);
  const stealingPackage = integrationPackage(realEnvironment, {
    taskPackageId: IDS.taskPackageOther,
    targetTaskId: IDS.testTargetTask,
    createdAt: "2026-08-07T03:06:00.000Z",
  });
  assert.throws(
    () => createTaskPackageArtifact({
      stateRoot: realEnvironment.stateRoot,
      expectedProgramId: IDS.program,
      ledgerRoot: realEnvironment.ledgerRoot,
      config: realEnvironment.config,
      expectedPrevious: expectedPrevious(stack),
      artifact: stealingPackage,
      transition: transition("event-card-target-steal-rejected", stealingPackage.createdAt),
    }),
    (error) => error?.code === "wakeflow-demand-artifact-service-test-card",
  );
  assert.equal((await currentStack(realEnvironment)).state.revision, 2);
  const inventory = inventoryDemandArtifacts({
    stateRoot: realEnvironment.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: realEnvironment.ledgerRoot,
  });
  assert.equal(inventory.status, "healthy");
  assert.deepEqual(inventory.entries.map((entry) => entry.artifactKind), ["wakeflow-test-card"]);
});

test("T05 Test results map the approved plan exactly while blocked results may remain partial", async (t) => {
  const fixture = await makeIntegrationFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const {
    createTaskPackageArtifact,
    createTestCardArtifact,
    recordTargetResultArtifact,
  } = await import(serviceModule);

  let stack = await currentStack(fixture);
  const card = integrationTestCard(fixture, stack);
  const cardCommit = createTestCardArtifact({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    config: fixture.config,
    expectedPrevious: expectedPrevious(stack),
    artifact: card,
    transition: transition("event-test-contract-card", card.createdAt),
  });
  stack = await currentStack(fixture);
  const testPackageRecord = integrationPackage(fixture, {
    taskPackageId: IDS.testTaskPackage,
    targetTaskId: IDS.testTargetTask,
    workType: "test",
    windowId: IDS.testWindow,
    createdAt: "2026-08-07T03:10:00.000Z",
    testCard: {
      testCardId: IDS.testCard,
      ref: cardCommit.artifact.ref,
      digest: cardCommit.artifact.digest,
    },
  });
  createTaskPackageArtifact({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    config: fixture.config,
    expectedPrevious: expectedPrevious(stack),
    artifact: testPackageRecord,
    transition: transition("event-test-contract-package", testPackageRecord.createdAt),
  });
  stack = await simulateTargetDispatch(fixture, IDS.testTargetTask, {
    createdAt: "2026-08-07T03:11:00.000Z",
  });

  const completed = integrationResult(fixture, stack, testPackageRecord, {
    targetResultId: IDS.testTargetResult,
    createdAt: "2026-08-07T03:12:00.000Z",
  });
  const missingPlanStep = structuredClone(completed);
  missingPlanStep.craftMapping = [];
  assert.throws(
    () => recordTargetResultArtifact({
      stateRoot: fixture.stateRoot,
      expectedProgramId: IDS.program,
      ledgerRoot: fixture.ledgerRoot,
      config: fixture.config,
      expectedPrevious: expectedPrevious(stack),
      artifact: missingPlanStep,
      selection: "current",
      transition: transition("event-test-missing-plan-step", completed.createdAt),
    }),
    (error) => error?.code === "wakeflow-demand-artifact-service-craft",
  );
  const wrongPlanStep = structuredClone(completed);
  wrongPlanStep.craftMapping[0].step = "Run an unapproved scenario.";
  assert.throws(
    () => recordTargetResultArtifact({
      stateRoot: fixture.stateRoot,
      expectedProgramId: IDS.program,
      ledgerRoot: fixture.ledgerRoot,
      config: fixture.config,
      expectedPrevious: expectedPrevious(stack),
      artifact: wrongPlanStep,
      selection: "current",
      transition: transition("event-test-wrong-plan-step", completed.createdAt),
    }),
    (error) => error?.code === "wakeflow-demand-artifact-service-craft",
  );
  const undeclaredEvidence = structuredClone(completed);
  undeclaredEvidence.craftMapping[0].ref = "evidence/not-declared.txt";
  assert.throws(
    () => recordTargetResultArtifact({
      stateRoot: fixture.stateRoot,
      expectedProgramId: IDS.program,
      ledgerRoot: fixture.ledgerRoot,
      config: fixture.config,
      expectedPrevious: expectedPrevious(stack),
      artifact: undeclaredEvidence,
      selection: "current",
      transition: transition("event-test-undeclared-evidence", completed.createdAt),
    }),
    (error) => error?.code === "wakeflow-demand-artifact-service-craft",
  );

  const blocked = integrationResult(fixture, stack, testPackageRecord, {
    targetResultId: IDS.testTargetResult,
    createdAt: "2026-08-07T03:13:00.000Z",
    outcome: "blocked",
  });
  blocked.evidenceLocators = [];
  blocked.craftMapping = [];
  const blockedCommit = recordTargetResultArtifact({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    config: fixture.config,
    expectedPrevious: expectedPrevious(stack),
    artifact: blocked,
    selection: "current",
    transition: transition("event-test-blocked-partial", blocked.createdAt),
  });
  stack = await currentStack(fixture);
  assert.equal(
    stack.state.targetTasks.find((entry) => entry.targetTaskId === IDS.testTargetTask).lifecycleStatus,
    "blocked",
  );

  const invalidHistoricalCorrection = integrationResult(fixture, stack, testPackageRecord, {
    targetResultId: IDS.targetResultLate,
    createdAt: "2026-08-07T03:14:00.000Z",
    supersedes: {
      targetResultId: blocked.targetResultId,
      ref: blockedCommit.artifact.ref,
      digest: blockedCommit.artifact.digest,
    },
    outcome: "blocked",
  });
  invalidHistoricalCorrection.evidenceLocators = [];
  invalidHistoricalCorrection.craftMapping = [];
  assert.throws(
    () => recordTargetResultArtifact({
      stateRoot: fixture.stateRoot,
      expectedProgramId: IDS.program,
      ledgerRoot: fixture.ledgerRoot,
      config: fixture.config,
      expectedPrevious: expectedPrevious(stack),
      artifact: invalidHistoricalCorrection,
      transition: transition("event-test-historical-cannot-supersede-current", invalidHistoricalCorrection.createdAt),
      selection: "historical",
    }),
    (error) => error?.code === "wakeflow-demand-artifact-service-supersedes",
  );

  const corrected = integrationResult(fixture, stack, testPackageRecord, {
    targetResultId: IDS.targetResult2,
    createdAt: "2026-08-07T03:15:00.000Z",
    supersedes: {
      targetResultId: blocked.targetResultId,
      ref: blockedCommit.artifact.ref,
      digest: blockedCommit.artifact.digest,
    },
  });
  recordTargetResultArtifact({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    config: fixture.config,
    expectedPrevious: expectedPrevious(stack),
    artifact: corrected,
    selection: "current",
    transition: transition("event-test-corrected-current", corrected.createdAt),
  });
  stack = await currentStack(fixture);
  assert.equal(
    stack.state.targetTasks.find((entry) => entry.targetTaskId === IDS.testTargetTask).currentResult.targetResultId,
    IDS.targetResult2,
  );
});

test("T05 product results require complete typed inputs only for completed outcomes", async (t) => {
  const fixture = await makeIntegrationFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const {
    createTaskPackageArtifact,
    recordTargetResultArtifact,
  } = await import(serviceModule);
  let stack = await currentStack(fixture);
  const packageRecord = integrationPackage(fixture);
  createTaskPackageArtifact({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    config: fixture.config,
    expectedPrevious: expectedPrevious(stack),
    artifact: packageRecord,
    transition: transition("event-product-input-package", packageRecord.createdAt),
  });
  stack = await simulateTargetDispatch(fixture, IDS.targetTask);

  const missingRequiredKind = integrationResult(fixture, stack, packageRecord);
  missingRequiredKind.evidenceLocators = [{
    kind: "log",
    ref: "evidence/log.txt",
    digest: `sha256:${"6".repeat(64)}`,
  }];
  missingRequiredKind.craftMapping[0].evidenceRefs = [{
    ref: "evidence/log.txt",
    digest: `sha256:${"6".repeat(64)}`,
  }];
  assert.throws(
    () => recordTargetResultArtifact({
      stateRoot: fixture.stateRoot,
      expectedProgramId: IDS.program,
      ledgerRoot: fixture.ledgerRoot,
      config: fixture.config,
      expectedPrevious: expectedPrevious(stack),
      artifact: missingRequiredKind,
      selection: "current",
      transition: transition("event-product-required-kind-rejected", missingRequiredKind.createdAt),
    }),
    (error) => error?.code === "wakeflow-demand-artifact-service-review-input",
  );

  const blocked = integrationResult(fixture, stack, packageRecord, { outcome: "blocked" });
  blocked.evidenceLocators = [];
  blocked.craftMapping = [];
  recordTargetResultArtifact({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    config: fixture.config,
    expectedPrevious: expectedPrevious(stack),
    artifact: blocked,
    selection: "current",
    transition: transition("event-product-blocked-partial", blocked.createdAt),
  });
  stack = await currentStack(fixture);
  assert.equal(stack.state.targetTasks[0].lifecycleStatus, "blocked");
});

test("T05 mutation closure retains historical review artifacts after pending state is cleared", async (t) => {
  const fixture = await makeIntegrationFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const {
    createReviewCandidateArtifact,
    createTaskPackageArtifact,
    createTestCardArtifact,
    recordTargetResultArtifact,
  } = await import(serviceModule);
  let stack = await currentStack(fixture);
  const packageRecord = integrationPackage(fixture);
  createTaskPackageArtifact({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    config: fixture.config,
    expectedPrevious: expectedPrevious(stack),
    artifact: packageRecord,
    transition: transition("event-historical-review-package", packageRecord.createdAt),
  });
  stack = await simulateTargetDispatch(fixture, IDS.targetTask);
  const result = integrationResult(fixture, stack, packageRecord);
  recordTargetResultArtifact({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    config: fixture.config,
    expectedPrevious: expectedPrevious(stack),
    artifact: result,
    selection: "current",
    transition: transition("event-historical-review-result", result.createdAt),
  });
  stack = await currentStack(fixture);
  const candidate = integrationReviewCandidate(fixture, stack, result);
  const candidateCommit = createReviewCandidateArtifact({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    expectedPrevious: expectedPrevious(stack),
    artifact: candidate,
    transition: transition("event-historical-review-candidate", candidate.createdAt),
  });
  stack = await simulateReviewAcceptance(fixture, [IDS.targetTask]);
  assert.equal(stack.state.review.status, "idle");
  unlinkSync(path.join(fixture.stateRoot, candidateCommit.artifact.ref));

  const card = integrationTestCard(fixture, stack);
  assert.throws(
    () => createTestCardArtifact({
      stateRoot: fixture.stateRoot,
      expectedProgramId: IDS.program,
      ledgerRoot: fixture.ledgerRoot,
      config: fixture.config,
      expectedPrevious: expectedPrevious(stack),
      artifact: card,
      transition: transition("event-historical-review-card-blocked", card.createdAt),
    }),
    (error) => error?.code === "wakeflow-demand-state-artifact-inventory",
  );
  assert.equal(
    existsSync(path.join(fixture.stateRoot, `test-cards/${IDS.testCard}.json`)),
    false,
  );
  assert.equal(
    JSON.parse(readFileSync(path.join(fixture.stateRoot, "wakeflow-state.json"), "utf8")).revision,
    stack.state.revision,
  );
});

test("T05 capability preflight and inventory reject unsafe, staged, hardlinked, and orphan entries", async (t) => {
  const fixture = await makeIntegrationFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const {
    createTaskPackageArtifact,
    inventoryDemandArtifacts,
    recordTargetResultArtifact,
  } = await import(serviceModule);
  const { loadDemandArtifactByRef } = await import(artifactModule);
  const stack = await currentStack(fixture);
  const artifact = integrationPackage(fixture);
  const args = {
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    config: fixture.config,
    expectedPrevious: expectedPrevious(stack),
    artifact,
    transition: transition("event-safe-package-0002", artifact.createdAt),
  };
  const packageRoot = path.join(fixture.stateRoot, "task-packages");
  chmodSync(packageRoot, 0o755);
  assert.throws(
    () => createTaskPackageArtifact(args),
    (error) => error?.code === "wakeflow-demand-state-artifact-parent",
  );
  assert.equal(existsSync(path.join(fixture.stateRoot, "transactions/state-transition.json")), false);
  chmodSync(packageRoot, 0o700);

  const stageFile = path.join(packageRoot, `.${IDS.taskPackage}.json.wakeflow-stage-residue`);
  writeFileSync(stageFile, "partial", { mode: 0o600 });
  assert.throws(
    () => createTaskPackageArtifact(args),
    (error) => error?.code === "wakeflow-demand-state-artifact-stage-residue",
  );
  let inventory = inventoryDemandArtifacts({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
  assert.equal(inventory.status, "degraded");
  assert.ok(inventory.issues.some((entry) => entry.classification === "stage-residue"));
  assert.equal(existsSync(path.join(fixture.stateRoot, "transactions/state-transition.json")), false);
  unlinkSync(stageFile);

  const packageCommit = createTaskPackageArtifact(args);
  const canonicalFile = path.join(fixture.stateRoot, packageCommit.artifact.ref);
  const linkedFile = path.join(fixture.root, "hardlinked-task-package.json");
  linkSync(canonicalFile, linkedFile);
  assert.throws(
    () => loadDemandArtifactByRef({
      stateRoot: fixture.stateRoot,
      ref: packageCommit.artifact.ref,
      digest: packageCommit.artifact.digest,
      expectedArtifactKind: "wakeflow-task-package",
      expectedArtifactId: IDS.taskPackage,
    }),
    (error) => error?.code === "wakeflow-demand-artifact-file",
  );
  inventory = inventoryDemandArtifacts({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
  assert.equal(inventory.status, "degraded");
  assert.ok(inventory.issues.some((entry) => entry.ref === packageCommit.artifact.ref));
  unlinkSync(linkedFile);

  let dispatched = await simulateTargetDispatch(fixture, IDS.targetTask);
  const result = integrationResult(fixture, dispatched, artifact);
  const resultsRoot = path.join(fixture.stateRoot, "target-results");
  chmodSync(resultsRoot, 0o755);
  assert.throws(
    () => recordTargetResultArtifact({
      stateRoot: fixture.stateRoot,
      expectedProgramId: IDS.program,
      ledgerRoot: fixture.ledgerRoot,
      config: fixture.config,
      expectedPrevious: expectedPrevious(dispatched),
      artifact: result,
      selection: "current",
      transition: transition("event-result-unsafe-parent-rejected", result.createdAt),
    }),
    (error) => error?.code === "wakeflow-demand-state-artifact-parent",
  );
  assert.equal(existsSync(path.join(fixture.stateRoot, "transactions/state-transition.json")), false);
  chmodSync(resultsRoot, 0o700);
  dispatched = await currentStack(fixture);
  assert.equal(dispatched.state.revision, 3);

  const orphan = integrationPackage(fixture, {
    taskPackageId: IDS.taskPackageOther,
    targetTaskId: IDS.targetTaskOther,
    createdAt: "2026-08-07T03:09:00.000Z",
  });
  writeCanonical(path.join(packageRoot, `${IDS.taskPackageOther}.json`), orphan);
  writeFileSync(path.join(fixture.stateRoot, "review-candidates/notes.txt"), "unknown\n", { mode: 0o600 });
  inventory = inventoryDemandArtifacts({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
  assert.equal(inventory.status, "degraded");
  assert.ok(inventory.entries.some((entry) => (
    entry.artifactId === IDS.taskPackageOther && entry.classification === "orphan"
  )));
  assert.ok(inventory.issues.some((entry) => entry.classification === "orphan"));
  assert.ok(inventory.issues.some((entry) => entry.code === "wakeflow-demand-artifact-inventory-unknown-entry"));
});

test("T05 artifact transaction recovery forward-completes every process-crash boundary", async (t) => {
  const {
    inventoryDemandArtifacts,
  } = await import(serviceModule);
  const {
    recoverDemandStateTransition,
  } = await import("../core/scripts/lib/wakeflow-demand-state-service.mjs");
  for (const boundary of ["journal", "artifact", "event", "state"]) {
    await t.test(boundary, async (subtest) => {
      const fixture = await makeIntegrationFixture();
      subtest.after(() => rmSync(fixture.root, { recursive: true, force: true }));
      const intent = await buildPackageRecoveryIntent(fixture);
      const journalFile = path.join(fixture.stateRoot, "transactions/state-transition.json");
      const artifactFile = path.join(fixture.stateRoot, intent.identity.ref);
      writeCanonical(journalFile, intent.journal);
      if (["artifact", "event", "state"].includes(boundary)) {
        writeCanonical(artifactFile, intent.artifact);
      }
      if (["event", "state"].includes(boundary)) {
        writeFileSync(
          path.join(fixture.stateRoot, "controller-events.jsonl"),
          `${intent.stack.events.map((entry) => canonicalJson(entry)).join("\n")}\n${canonicalJson(intent.event)}\n`,
          { mode: 0o600 },
        );
      }
      if (boundary === "state") {
        writeCanonical(path.join(fixture.stateRoot, "wakeflow-state.json"), intent.nextState);
      }

      const recovered = recoverDemandStateTransition({
        stateRoot: fixture.stateRoot,
        expectedProgramId: IDS.program,
        ledgerRoot: fixture.ledgerRoot,
      });
      assert.equal(recovered.status, "recovered");
      assert.equal(recovered.revision, 2);
      assert.equal(recovered.artifact.artifactId, IDS.taskPackage);
      assert.equal(existsSync(journalFile), false);
      const finalStack = await currentStack(fixture);
      assert.equal(finalStack.state.revision, 2);
      assert.equal(finalStack.events.at(-1).eventId, intent.event.eventId);
      assert.deepEqual(finalStack.state, intent.nextState);
      const inventory = inventoryDemandArtifacts({
        stateRoot: fixture.stateRoot,
        expectedProgramId: IDS.program,
        ledgerRoot: fixture.ledgerRoot,
      });
      assert.equal(inventory.status, "healthy");
      assert.equal(inventory.entries.length, 1);
      assert.equal(recoverDemandStateTransition({
        stateRoot: fixture.stateRoot,
        expectedProgramId: IDS.program,
        ledgerRoot: fixture.ledgerRoot,
      }).status, "none");
    });
  }
});

test("T05 recovery accepts an exact empty TargetResult parent only before its candidate event", async (t) => {
  const fixture = await makeIntegrationFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const {
    createTaskPackageArtifact,
    inventoryDemandArtifacts,
  } = await import(serviceModule);
  const { recoverDemandStateTransition } = await import("../core/scripts/lib/wakeflow-demand-state-service.mjs");
  let stack = await currentStack(fixture);
  const packageRecord = integrationPackage(fixture);
  createTaskPackageArtifact({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    config: fixture.config,
    expectedPrevious: expectedPrevious(stack),
    artifact: packageRecord,
    transition: transition("event-empty-result-parent-package", packageRecord.createdAt),
  });
  await simulateTargetDispatch(fixture, IDS.targetTask);
  const intent = await buildResultRecoveryIntent(fixture, packageRecord);
  const targetRoot = path.join(fixture.stateRoot, "target-results", IDS.targetTask);
  mkdirSync(targetRoot, { mode: 0o700 });
  writeCanonical(
    path.join(fixture.stateRoot, "transactions/state-transition.json"),
    intent.journal,
  );

  const recovered = recoverDemandStateTransition({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
  assert.equal(recovered.status, "recovered");
  assert.equal(existsSync(path.join(fixture.stateRoot, intent.identity.ref)), true);
  assert.equal(readdirSync(targetRoot).length, 1);
  const inventory = inventoryDemandArtifacts({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  });
  assert.equal(inventory.status, "healthy");
});

test("T05 recovery preserves journal evidence when an artifact stage is ambiguous", async (t) => {
  const fixture = await makeIntegrationFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const { recoverDemandStateTransition } = await import("../core/scripts/lib/wakeflow-demand-state-service.mjs");
  const intent = await buildPackageRecoveryIntent(fixture);
  const journalFile = path.join(fixture.stateRoot, "transactions/state-transition.json");
  const stageFile = path.join(
    fixture.stateRoot,
    "task-packages",
    `.${IDS.taskPackage}.json.wakeflow-stage-ambiguous`,
  );
  writeCanonical(journalFile, intent.journal);
  writeFileSync(stageFile, "partial", { mode: 0o600 });
  assert.throws(
    () => recoverDemandStateTransition({
      stateRoot: fixture.stateRoot,
      expectedProgramId: IDS.program,
      ledgerRoot: fixture.ledgerRoot,
    }),
    (error) => error?.code === "wakeflow-demand-state-artifact-stage-residue",
  );
  assert.equal(existsSync(journalFile), true);
  assert.equal((JSON.parse(readFileSync(path.join(fixture.stateRoot, "wakeflow-state.json"), "utf8"))).revision, 1);
  unlinkSync(stageFile);
  assert.equal(recoverDemandStateTransition({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
  }).status, "recovered");
});

test("T05 recovery never recreates an artifact after its controller event is already visible", async (t) => {
  const fixture = await makeIntegrationFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const { recoverDemandStateTransition } = await import("../core/scripts/lib/wakeflow-demand-state-service.mjs");
  const intent = await buildPackageRecoveryIntent(fixture);
  const journalFile = path.join(fixture.stateRoot, "transactions/state-transition.json");
  writeCanonical(journalFile, intent.journal);
  writeFileSync(
    path.join(fixture.stateRoot, "controller-events.jsonl"),
    `${intent.stack.events.map((entry) => canonicalJson(entry)).join("\n")}\n${canonicalJson(intent.event)}\n`,
    { mode: 0o600 },
  );

  assert.throws(
    () => recoverDemandStateTransition({
      stateRoot: fixture.stateRoot,
      expectedProgramId: IDS.program,
      ledgerRoot: fixture.ledgerRoot,
    }),
    (error) => error?.code === "wakeflow-demand-state-recovery-conflict",
  );
  assert.equal(existsSync(journalFile), true);
  assert.equal(existsSync(path.join(fixture.stateRoot, intent.identity.ref)), false);
  assert.equal(
    JSON.parse(readFileSync(path.join(fixture.stateRoot, "wakeflow-state.json"), "utf8")).revision,
    1,
  );
});

test("T05 state mutation refuses to advance across a broken committed artifact closure", async (t) => {
  const fixture = await makeIntegrationFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const { createTaskPackageArtifact } = await import(serviceModule);
  const { commitDemandStateTransition } = await import("../core/scripts/lib/wakeflow-demand-state-service.mjs");

  let stack = await currentStack(fixture);
  const artifact = integrationPackage(fixture);
  const created = createTaskPackageArtifact({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    ledgerRoot: fixture.ledgerRoot,
    config: fixture.config,
    expectedPrevious: expectedPrevious(stack),
    artifact,
    transition: transition("event-closure-package-0002", artifact.createdAt),
  });
  stack = await currentStack(fixture);
  unlinkSync(path.join(fixture.stateRoot, created.artifact.ref));

  const event = {
    schemaVersion: 1,
    artifactKind: "wakeflow-controller-event",
    eventId: "event-closure-dispatch-0003",
    demandId: IDS.demand,
    createdAt: "2026-08-07T03:02:00.000Z",
    actor: "controller",
    command: "dispatch-target",
    type: "target-task.dispatched",
    previousRevision: stack.state.revision,
    nextRevision: stack.state.revision + 1,
    from: stack.state.state,
    to: "dispatched",
    reason: "exercise the committed artifact closure gate",
    decisionSummary: "Do not advance when an earlier event artifact is missing.",
    changedArtifacts: [],
  };
  const nextState = structuredClone(stack.state);
  nextState.revision = event.nextRevision;
  nextState.state = event.to;
  nextState.stateReason = event.reason;
  nextState.updatedAt = event.createdAt;
  nextState.lastEvent = { eventId: event.eventId, eventDigest: canonicalJsonDigest(event) };
  nextState.targetTasks[0].lifecycleStatus = "dispatched";

  assert.throws(
    () => commitDemandStateTransition({
      stateRoot: fixture.stateRoot,
      expectedProgramId: IDS.program,
      ledgerRoot: fixture.ledgerRoot,
      expectedPrevious: expectedPrevious(stack),
      event,
      nextState,
    }),
    (error) => error?.code === "wakeflow-demand-state-artifact-inventory",
  );
  assert.equal((await currentStack(fixture)).state.revision, stack.state.revision);
  assert.deepEqual(readdirSync(path.join(fixture.stateRoot, "transactions")), []);
});

test("T05 recovery preserves its journal when an earlier committed artifact is missing or changed", async (t) => {
  const { createTaskPackageArtifact } = await import(serviceModule);
  const { recoverDemandStateTransition } = await import("../core/scripts/lib/wakeflow-demand-state-service.mjs");

  for (const fault of ["missing", "changed"]) {
    await t.test(fault, async (subtest) => {
      const fixture = await makeIntegrationFixture();
      subtest.after(() => rmSync(fixture.root, { recursive: true, force: true }));
      const original = integrationPackage(fixture);
      let stack = await currentStack(fixture);
      const originalCommit = createTaskPackageArtifact({
        stateRoot: fixture.stateRoot,
        expectedProgramId: IDS.program,
        ledgerRoot: fixture.ledgerRoot,
        config: fixture.config,
        expectedPrevious: expectedPrevious(stack),
        artifact: original,
        transition: transition(`event-recovery-prior-${fault}`, original.createdAt),
      });
      const intent = await buildPackageRecoveryIntent(fixture, {
        taskPackageId: IDS.taskPackageOther,
        targetTaskId: IDS.targetTaskOther,
        createdAt: "2026-08-07T03:09:00.000Z",
      });
      const journalFile = path.join(fixture.stateRoot, "transactions/state-transition.json");
      writeCanonical(journalFile, intent.journal);
      const originalFile = path.join(fixture.stateRoot, originalCommit.artifact.ref);
      if (fault === "missing") {
        unlinkSync(originalFile);
      } else {
        const changed = structuredClone(original);
        changed.objective = "These bytes no longer match the committed event digest.";
        writeCanonical(originalFile, changed);
      }

      assert.throws(
        () => recoverDemandStateTransition({
          stateRoot: fixture.stateRoot,
          expectedProgramId: IDS.program,
          ledgerRoot: fixture.ledgerRoot,
        }),
        (error) => error?.code === "wakeflow-demand-state-recovery-conflict",
      );
      const visibleState = JSON.parse(readFileSync(
        path.join(fixture.stateRoot, "wakeflow-state.json"),
        "utf8",
      ));
      assert.equal(visibleState.revision, 2);
      assert.equal(existsSync(journalFile), true);
      assert.equal(existsSync(path.join(fixture.stateRoot, intent.identity.ref)), false);
    });
  }
});

test("T05 low-level inventory diagnoses duplicate identities, empty typed roots, and exact non-files", async (t) => {
  const fixture = await makeIntegrationFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const {
    demandArtifactIdentity,
    inspectDemandArtifactInventory,
  } = await import(artifactModule);

  const first = targetResult();
  const second = structuredClone(first);
  second.targetTaskId = IDS.targetTaskOther;
  second.taskPackage.taskPackageId = IDS.taskPackageOther;
  second.taskPackage.ref = `task-packages/${IDS.taskPackageOther}.json`;
  for (const record of [first, second]) {
    const taskRoot = path.join(fixture.stateRoot, "target-results", record.targetTaskId);
    mkdirSync(taskRoot, { mode: 0o700 });
    writeCanonical(path.join(taskRoot, `${record.targetResultId}.json`), record);
  }
  const emptyTargetTaskId = "target-task_afafafaf-afaf-4faf-8faf-afafafafafaf";
  mkdirSync(path.join(fixture.stateRoot, "target-results", emptyTargetTaskId), { mode: 0o700 });

  let inventory = inspectDemandArtifactInventory({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    expectedDemandId: IDS.demand,
  });
  assert.equal(inventory.status, "degraded");
  assert.ok(inventory.issues.some((issue) => (
    issue.code === "wakeflow-demand-artifact-inventory-duplicate-identity"
  )));
  assert.ok(inventory.issues.some((issue) => (
    issue.ref === `target-results/${emptyTargetTaskId}/`
    && issue.code === "wakeflow-demand-artifact-inventory-empty-target-root"
  )));

  const firstIdentity = demandArtifactIdentity(first);
  const secondIdentity = demandArtifactIdentity(second);
  assert.throws(
    () => inspectDemandArtifactInventory({
      stateRoot: fixture.stateRoot,
      expectedArtifacts: [firstIdentity, secondIdentity],
    }),
    (error) => error?.code === "wakeflow-demand-artifact-inventory",
  );

  const directoryArtifact = integrationPackage(fixture);
  const directoryIdentity = demandArtifactIdentity(directoryArtifact);
  mkdirSync(path.join(fixture.stateRoot, directoryIdentity.ref), { mode: 0o700 });
  inventory = inspectDemandArtifactInventory({
    stateRoot: fixture.stateRoot,
    expectedProgramId: IDS.program,
    expectedDemandId: IDS.demand,
    expectedArtifacts: [directoryIdentity],
  });
  assert.ok(inventory.issues.some((issue) => (
    issue.ref === directoryIdentity.ref && issue.classification === "invalid"
  )));
  assert.equal(inventory.issues.some((issue) => (
    issue.ref === directoryIdentity.ref && issue.classification === "missing"
  )), false);

  assert.throws(
    () => inspectDemandArtifactInventory({
      stateRoot: fixture.stateRoot,
      expectedProgramId: "program-not-typed",
    }),
    (error) => error?.code === "wakeflow-demand-artifact-id",
  );
  if (process.platform !== "win32") {
    chmodSync(fixture.stateRoot, 0o755);
    try {
      assert.throws(
        () => inspectDemandArtifactInventory({ stateRoot: fixture.stateRoot }),
        (error) => error?.code === "wakeflow-demand-artifact-mode",
      );
    } finally {
      chmodSync(fixture.stateRoot, 0o700);
    }
  }
});

test("T05 inventory separates capability-root failures from opaque unknown children", async (t) => {
  const fixture = await makeIntegrationFixture();
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }));
  const { inspectDemandArtifactInventory } = await import(artifactModule);
  const privateBasenames = Object.freeze({
    review: "PRIVATE_REVIEW_SESSION_PID_4242",
    taskPackage: "task-package_PRIVATE_PACKAGE_SECRET_PID_4343.json",
    targetTask: "PRIVATE_TARGET_TASK_SECRET_PID_4444",
    targetResult: "target-result_PRIVATE_RESULT_SECRET_PID_4545.json",
  });

  writeFileSync(
    path.join(fixture.stateRoot, "review-candidates", privateBasenames.review),
    "unknown\n",
    { mode: 0o600 },
  );
  writeFileSync(
    path.join(fixture.stateRoot, "task-packages", privateBasenames.taskPackage),
    "unknown\n",
    { mode: 0o600 },
  );
  writeFileSync(
    path.join(fixture.stateRoot, "target-results", privateBasenames.targetTask),
    "unknown\n",
    { mode: 0o600 },
  );
  const typedTaskRoot = path.join(fixture.stateRoot, "target-results", IDS.targetTaskOther);
  mkdirSync(typedTaskRoot, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(typedTaskRoot, privateBasenames.targetResult), "unknown\n", { mode: 0o600 });

  const first = inspectDemandArtifactInventory({ stateRoot: fixture.stateRoot });
  const second = inspectDemandArtifactInventory({ stateRoot: fixture.stateRoot });
  const unknownIssues = first.issues.filter((entry) => (
    entry.code === "wakeflow-demand-artifact-inventory-unknown-entry"
  ));
  assert.deepEqual(unknownIssues, second.issues.filter((entry) => (
    entry.code === "wakeflow-demand-artifact-inventory-unknown-entry"
  )));
  assert.equal(unknownIssues.length, 4);
  assert.ok(unknownIssues.every((entry) => (
    entry.classification === "invalid"
    && /\/unknown-sha256-[0-9a-f]{64}$/u.test(entry.ref)
  )));
  const serialized = JSON.stringify(first);
  for (const basename of Object.values(privateBasenames)) {
    assert.equal(serialized.includes(basename), false);
  }

  const reviewRoot = path.join(fixture.stateRoot, "review-candidates");
  rmSync(reviewRoot, { recursive: true, force: true });
  writeFileSync(reviewRoot, "not a capability directory\n", { mode: 0o600 });
  const rootFailure = inspectDemandArtifactInventory({ stateRoot: fixture.stateRoot });
  assert.ok(rootFailure.issues.some((entry) => (
    entry.ref === "review-candidates/"
    && entry.classification === "invalid"
    && entry.code === "wakeflow-demand-artifact-inventory-root-unsafe"
  )));
  assert.equal(rootFailure.issues.some((entry) => (
    entry.ref === "review-candidates/"
    && entry.code === "wakeflow-demand-artifact-inventory-unknown-entry"
  )), false);

  if (process.platform !== "win32") {
    const externalPodRoot = path.join(fixture.root, "external-pod");
    mkdirSync(path.join(externalPodRoot, "design-requests"), { recursive: true, mode: 0o700 });
    mkdirSync(path.join(externalPodRoot, "design-handoffs"), { recursive: true, mode: 0o700 });
    symlinkSync(externalPodRoot, path.join(fixture.stateRoot, "pod"));
    const unsafePodRoot = inspectDemandArtifactInventory({ stateRoot: fixture.stateRoot });
    assert.ok(unsafePodRoot.issues.some((entry) => (
      entry.ref === "pod/"
      && entry.classification === "invalid"
      && entry.code === "wakeflow-demand-artifact-inventory-root-unsafe"
    )));
  }
});
