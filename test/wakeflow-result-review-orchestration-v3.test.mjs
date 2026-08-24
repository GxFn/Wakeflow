import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { canonicalJsonDigest } from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import {
  applyTargetDeliveryPlan,
  claimTargetDelivery,
  planTargetDelivery,
  recordTargetDeliveryOutcome,
} from "../core/scripts/lib/wakeflow-delivery-orchestration.mjs";
import { createTaskPackageArtifact } from "../core/scripts/lib/wakeflow-demand-artifact-service.mjs";
import {
  INTEGRATION_IDS,
  createIntegrationFixture,
  loadIntegrationStack,
  privateTreeSnapshot,
  timestampAfter,
} from "./support/wakeflow-delivery-v3-fixture.mjs";
import { inspectTransportDemandAuthority } from "../core/scripts/lib/wakeflow-transport-store.mjs";
import {
  inspectWindowCoordinationLeaseInventory,
} from "../core/scripts/lib/wakeflow-window-lease-service.mjs";
import { replaceWindowBinding } from "../core/scripts/lib/wakeflow-window-binding-service.mjs";

const orchestrationModuleUrl = new URL(
  "../core/scripts/lib/wakeflow-result-review-orchestration.mjs",
  import.meta.url,
);

const EXPECTED_EXPORTS = Object.freeze([
  "WakeflowResultReviewOrchestrationError",
  "applyControllerReturnDeliveryPlan",
  "createDispatchGroupReviewCandidate",
  "decideDispatchGroupReviewCandidate",
  "inspectControllerReturnPreSend",
  "inspectDemandResultReviewTrace",
  "inspectDispatchGroupReview",
  "planControllerReturnDelivery",
  "recordControllerReturnOutcome",
  "recordTargetResultFromTransport",
]);

const RESULT_IDS = Object.freeze({
  first: "target-result_41414141-4141-4141-8141-414141414141",
  correction: "target-result_42424242-4242-4242-8242-424242424242",
  late: "target-result_45454545-4545-4545-8545-454545454545",
  rejectedNewRound: "target-result_46464646-4646-4646-8646-464646464646",
  groupFirst: "target-result_50505050-5050-4050-8050-505050505050",
  groupSecond: "target-result_51515151-5151-4151-8151-515151515151",
  earlyBlocked: "target-result_66666666-6666-4666-8666-666666666666",
});
const REVIEW_IDS = Object.freeze({
  candidate: "review-candidate_43434343-4343-4343-8343-434343434343",
  multi: "review-candidate_52525252-5252-4252-8252-525252525252",
});
const RETURN_IDS = Object.freeze({
  delivery: "delivery_47474747-4747-4747-8747-474747474747",
  run: "delivery-run_48484848-4848-4848-8848-484848484848",
  rejectedDelivery: "delivery_58585858-5858-4858-8858-585858585858",
  rejectedRun: "delivery-run_59595959-5959-4959-8959-595959595959",
  conflictingRun: "delivery-run_60606060-6060-4060-8060-606060606060",
});
const REPLACEMENT_IDS = Object.freeze({
  firstPackage: "task-package_53535353-5353-4353-8353-535353535353",
  firstTask: "target-task_54545454-5454-4454-8454-545454545454",
  secondPackage: "task-package_56565656-5656-4656-8656-565656565656",
  secondTask: "target-task_57575757-5757-4757-8757-575757575757",
});

async function createSettledProductDelivery(t, {
  transportStatus = "accepted",
  readbackStatus = "confirmed",
} = {}) {
  const fixture = await createIntegrationFixture(t);
  const source = loadIntegrationStack(fixture);
  const plan = planTargetDelivery({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targets: [{
      targetTaskId: INTEGRATION_IDS.targetTask,
      prompt: "Execute the disposable T08 result/review task and return its exact envelope.",
      contextPolicy: "assumed-current",
      automationRequested: false,
    }],
    returnPolicy: { mode: "group-ready" },
    createdAt: timestampAfter(source.state.updatedAt, new Date().toISOString()),
  });
  const applied = await applyTargetDeliveryPlan({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    plan,
    planDigest: plan.planDigest,
  });
  const claimInput = {
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targetTaskId: INTEGRATION_IDS.targetTask,
    deliveryId: applied.members[0].envelope.deliveryId,
    sendGeneration: 1,
  };
  const permit = await claimTargetDelivery(claimInput);
  const claimed = loadIntegrationStack(fixture);
  const leaseFile = path.resolve(fixture.workspaceRoot, ...permit.lease.ref.split("/"));
  const lease = JSON.parse(readFileSync(leaseFile, "utf8"));
  const readback = readbackStatus === "confirmed"
    ? {
      status: "confirmed",
      attempts: 1,
      evidence: [{ kind: "thread-turn-visible", digest: `sha256:${"c".repeat(64)}` }],
    }
    : { status: readbackStatus, attempts: 1, evidence: [] };
  const outcome = {
    hostMethod: "send-message",
    hostMode: "direct-thread",
    transportStatus,
    readback,
    createdAt: timestampAfter(claimed.state.updatedAt, lease.acquiredAt),
  };
  const recorded = await recordTargetDeliveryOutcome({ ...claimInput, outcome });
  return { fixture, plan, applied, permit, leaseFile, recorded };
}

function buildProductResult(fixture, stack, {
  targetResultId = RESULT_IDS.first,
  targetTaskId = INTEGRATION_IDS.targetTask,
  supersedes = null,
  outcome = "completed",
  transport = null,
} = {}) {
  const task = stack.state.targetTasks.find(
    (entry) => entry.targetTaskId === targetTaskId,
  );
  const taskPackage = targetTaskId === INTEGRATION_IDS.targetTaskTwo
    ? fixture.packageRecordTwo
    : fixture.packageRecord;
  const evidence = {
    kind: "test-output",
    ref: `evidence/${targetResultId}.txt`,
    digest: `sha256:${(targetResultId === RESULT_IDS.first ? "d" : "e").repeat(64)}`,
  };
  return {
    schemaVersion: 1,
    artifactKind: "wakeflow-target-result",
    programId: INTEGRATION_IDS.program,
    demandId: INTEGRATION_IDS.demand,
    demandRef: "demand.json",
    demandDigest: canonicalJsonDigest(fixture.demand),
    createdAt: timestampAfter(stack.state.updatedAt),
    targetResultId,
    targetTaskId,
    taskPackage: {
      taskPackageId: taskPackage.taskPackageId,
      ref: `task-packages/${taskPackage.taskPackageId}.json`,
      digest: canonicalJsonDigest(taskPackage),
    },
    assignment: {
      windowId: taskPackage.windowId,
      repositoryId: taskPackage.repositoryId,
    },
    observedState: {
      revision: stack.state.revision,
      eventId: stack.state.lastEvent.eventId,
      eventDigest: stack.state.lastEvent.eventDigest,
    },
    transport: transport ?? {
      group: {
        id: task.currentDelivery.group.groupId,
        ref: task.currentDelivery.group.ref,
        digest: task.currentDelivery.group.digest,
      },
      envelope: {
        id: task.currentDelivery.envelope.deliveryId,
        ref: task.currentDelivery.envelope.ref,
        digest: task.currentDelivery.envelope.digest,
      },
    },
    outcome,
    summary: outcome === "blocked"
      ? "The target is blocked by one exact reviewable constraint."
      : "The exact disposable product task and focused verification completed.",
    repositoryChanges: [{
      repositoryId: taskPackage.repositoryId,
      disposition: "left-uncommitted",
      commits: [],
    }],
    evidenceLocators: [evidence],
    verification: ["The focused disposable verification completed."],
    risks: [],
    craftMapping: [{
      kind: "acceptance-anchor",
      anchorId: "A1",
      evidenceRefs: [{ ref: evidence.ref, digest: evidence.digest }],
    }],
    ...(supersedes ? { supersedes } : {}),
  };
}

function resultTransition(result) {
  return {
    eventId: `event-t08-${result.targetResultId}`,
    createdAt: result.createdAt,
    reason: "Import the exact target-authored result from settled transport authority.",
    decisionSummary: "Select the immutable result round and release only its matching lease.",
  };
}

async function createAppliedControllerReturn(t, deliveryId) {
  const settled = await createSettledProductDelivery(t);
  const orchestration = await import(orchestrationModuleUrl.href);
  let stack = loadIntegrationStack(settled.fixture);
  const result = buildProductResult(settled.fixture, stack);
  await orchestration.recordTargetResultFromTransport({
    workspaceRoot: settled.fixture.workspaceRoot,
    stateRoot: settled.fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    artifact: result,
    transition: resultTransition(result),
  });
  stack = loadIntegrationStack(settled.fixture);
  const groupId = stack.state.targetTasks[0].currentDelivery.group.groupId;
  const plan = orchestration.planControllerReturnDelivery({
    workspaceRoot: settled.fixture.workspaceRoot,
    stateRoot: settled.fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    groupId,
    deliveryId,
    createdAt: timestampAfter(stack.state.updatedAt),
  });
  await orchestration.applyControllerReturnDeliveryPlan({
    workspaceRoot: settled.fixture.workspaceRoot,
    stateRoot: settled.fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    plan,
    planDigest: plan.planDigest,
  });
  return { settled, orchestration, stack, groupId, plan };
}

test("M3-T08 candidate exposes only the result/review/return orchestration boundary", async () => {
  const orchestration = await import(orchestrationModuleUrl.href);
  assert.deepEqual(Object.keys(orchestration).sort(), [...EXPECTED_EXPORTS].sort());

  const source = readFileSync(fileURLToPath(orchestrationModuleUrl), "utf8");
  for (const frozenPublicModule of [
    "wakeflow-controller-return.mjs",
    "wakeflow-dispatch-group-review.mjs",
    "wakeflow-return-policy.mjs",
    "wakeflow-review-pack.mjs",
    "wakeflow-runtime-summary.mjs",
  ]) {
    assert.equal(
      source.includes(frozenPublicModule),
      false,
      `internal T08 candidate must not import frozen public-v2 ${frozenPublicModule}`,
    );
  }

  const transition = {
    eventId: "event-r25-passive-input",
    createdAt: "2026-08-24T00:00:00.000Z",
    reason: "Reject active input before reading any caller-owned field.",
    decisionSummary: "Keep result-review admission behavior-free.",
  };
  const groupId = "dispatch-group_61616161-6161-4161-8161-616161616161";
  const cases = [
    {
      name: "recordTargetResultFromTransport",
      async: true,
      field: "artifact",
      returned: {},
      input: {
        workspaceRoot: "/not-read",
        stateRoot: "/not-read",
        expectedProgramId: INTEGRATION_IDS.program,
        transition,
      },
    },
    ...[
      "inspectDispatchGroupReview",
      "inspectDemandResultReviewTrace",
    ].map((name) => ({
      name,
      async: false,
      field: "workspaceRoot",
      returned: "/not-read",
      input: {
        stateRoot: "/not-read",
        expectedProgramId: INTEGRATION_IDS.program,
        groupId,
      },
    })),
    {
      name: "createDispatchGroupReviewCandidate",
      async: true,
      field: "workspaceRoot",
      returned: "/not-read",
      input: {
        stateRoot: "/not-read",
        expectedProgramId: INTEGRATION_IDS.program,
        groupId,
        reviewCandidateId: REVIEW_IDS.candidate,
        transition,
      },
    },
    {
      name: "decideDispatchGroupReviewCandidate",
      async: true,
      field: "workspaceRoot",
      returned: "/not-read",
      input: {
        stateRoot: "/not-read",
        expectedProgramId: INTEGRATION_IDS.program,
        groupId,
        reviewCandidateId: REVIEW_IDS.candidate,
        decision: "accept",
        transition,
      },
    },
    {
      name: "planControllerReturnDelivery",
      async: false,
      field: "workspaceRoot",
      returned: "/not-read",
      input: {
        stateRoot: "/not-read",
        expectedProgramId: INTEGRATION_IDS.program,
        groupId,
        deliveryId: RETURN_IDS.delivery,
        createdAt: transition.createdAt,
      },
    },
    {
      name: "applyControllerReturnDeliveryPlan",
      async: true,
      field: "plan",
      returned: {},
      input: {
        workspaceRoot: "/not-read",
        stateRoot: "/not-read",
        expectedProgramId: INTEGRATION_IDS.program,
        planDigest: `sha256:${"a".repeat(64)}`,
      },
    },
    {
      name: "inspectControllerReturnPreSend",
      async: false,
      field: "workspaceRoot",
      returned: "/not-read",
      input: {
        stateRoot: "/not-read",
        expectedProgramId: INTEGRATION_IDS.program,
        deliveryId: RETURN_IDS.delivery,
      },
    },
    {
      name: "recordControllerReturnOutcome",
      async: true,
      field: "outcome",
      returned: {
        hostMethod: "send-message",
        hostMode: "direct-thread",
        transportStatus: "accepted",
        readback: { status: "confirmed", attempts: 1, evidence: [] },
        createdAt: transition.createdAt,
      },
      input: {
        workspaceRoot: "/not-read",
        stateRoot: "/not-read",
        expectedProgramId: INTEGRATION_IDS.program,
        deliveryId: RETURN_IDS.delivery,
        runId: RETURN_IDS.run,
      },
    },
  ];
  for (const entry of cases) {
    let getterCalls = 0;
    const input = { ...entry.input };
    Object.defineProperty(input, entry.field, {
      enumerable: true,
      get() {
        getterCalls += 1;
        return entry.returned;
      },
    });
    const predicate = (error) => error?.code === "wakeflow-result-review-contract";
    if (entry.async) {
      await assert.rejects(() => orchestration[entry.name](input), predicate, entry.name);
    } else {
      assert.throws(() => orchestration[entry.name](input), predicate, entry.name);
    }
    assert.equal(getterCalls, 0, `${entry.name} must not execute its accessor`);
  }

  for (const input of [
    (() => {
      const value = {
        workspaceRoot: "/not-read",
        stateRoot: "/not-read",
        expectedProgramId: INTEGRATION_IDS.program,
        groupId,
      };
      Object.defineProperty(value, "hidden", { value: true, enumerable: false });
      return value;
    })(),
    {
      workspaceRoot: "/not-read",
      stateRoot: "/not-read",
      expectedProgramId: INTEGRATION_IDS.program,
      groupId,
      [Symbol("hidden")]: true,
    },
  ]) {
    assert.throws(
      () => orchestration.inspectDispatchGroupReview(input),
      (error) => error?.code === "wakeflow-result-review-contract",
    );
  }
  assert.doesNotMatch(source, /\.localeCompare\(/u);
});

test("M3-T08 imports a settled current result, releases its exact lease last, and replays without a revision", async (t) => {
  const settled = await createSettledProductDelivery(t);
  const orchestration = await import(orchestrationModuleUrl.href);
  const before = loadIntegrationStack(settled.fixture);
  const result = buildProductResult(settled.fixture, before);
  assert.equal(existsSync(settled.leaseFile), true);

  const recorded = await orchestration.recordTargetResultFromTransport({
    workspaceRoot: settled.fixture.workspaceRoot,
    stateRoot: settled.fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    artifact: result,
    transition: resultTransition(result),
  });
  assert.equal(recorded.status, "recorded");
  assert.equal(recorded.disposition, "current");
  assert.equal(recorded.roundRelation, "first-current");
  assert.equal(recorded.leaseStatus, "released");
  assert.equal(existsSync(settled.leaseFile), false);

  const after = loadIntegrationStack(settled.fixture);
  assert.equal(after.state.revision, before.state.revision + 1);
  assert.equal(after.state.targetTasks[0].lifecycleStatus, "review-ready");
  assert.equal(after.state.targetTasks[0].currentResult.targetResultId, result.targetResultId);

  const replayed = await orchestration.recordTargetResultFromTransport({
    workspaceRoot: settled.fixture.workspaceRoot,
    stateRoot: settled.fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    artifact: result,
    transition: resultTransition(result),
  });
  assert.equal(replayed.status, "replayed");
  assert.equal(replayed.leaseStatus, "already-released");
  assert.equal(loadIntegrationStack(settled.fixture).state.revision, after.state.revision);

  const review = orchestration.inspectDispatchGroupReview({
    workspaceRoot: settled.fixture.workspaceRoot,
    stateRoot: settled.fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    groupId: before.state.targetTasks[0].currentDelivery.group.groupId,
  });
  assert.equal(review.members[0].status, "ready");
  assert.equal(review.classification.reviewEligible, true);
  assert.equal(review.results[0].targetResultId, result.targetResultId);
  assert.equal(Object.isFrozen(review), true);
  assert.equal(Object.isFrozen(review.members[0]), true);

  const trace = orchestration.inspectDemandResultReviewTrace({
    workspaceRoot: settled.fixture.workspaceRoot,
    stateRoot: settled.fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    mode: "strict",
  });
  assert.equal(trace.authorityEligible, true);
  assert.equal(trace.results[0].targetResultId, result.targetResultId);
  assert.equal(trace.groups[0].group.groupId, review.group.groupId);
  assert.equal(Object.isFrozen(trace), true);
  const diagnostic = orchestration.inspectDemandResultReviewTrace({
    workspaceRoot: settled.fixture.workspaceRoot,
    stateRoot: settled.fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    mode: "diagnostic",
  });
  assert.equal(diagnostic.authorityEligible, false);
  assert.equal(diagnostic.nextAction, null);
});

test("M3-T08 imports one real Test-attempt result only through its exact TestCard authorization", async (t) => {
  const fixture = await createIntegrationFixture(t, { testTarget: true });
  const orchestration = await import(orchestrationModuleUrl.href);
  let stack = loadIntegrationStack(fixture);
  const plan = planTargetDelivery({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targets: [{
      targetTaskId: INTEGRATION_IDS.testTargetTask,
      prompt: "Execute the exact disposable TestCard through its first logical attempt.",
      contextPolicy: "force-refresh",
      automationRequested: false,
    }],
    returnPolicy: { mode: "per-target" },
    createdAt: timestampAfter(stack.state.updatedAt),
  });
  const applied = await applyTargetDeliveryPlan({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    plan,
    planDigest: plan.planDigest,
  });
  const claimInput = {
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targetTaskId: INTEGRATION_IDS.testTargetTask,
    deliveryId: applied.members[0].envelope.deliveryId,
    sendGeneration: 1,
  };
  const permit = await claimTargetDelivery(claimInput);
  stack = loadIntegrationStack(fixture);
  const leaseFile = path.resolve(fixture.workspaceRoot, ...permit.lease.ref.split("/"));
  const lease = JSON.parse(readFileSync(leaseFile, "utf8"));
  await recordTargetDeliveryOutcome({
    ...claimInput,
    outcome: {
      hostMethod: "send-message",
      hostMode: "direct-thread",
      transportStatus: "accepted",
      readback: {
        status: "confirmed",
        attempts: 1,
        evidence: [{ kind: "thread-turn-visible", digest: `sha256:${"7".repeat(64)}` }],
      },
      createdAt: timestampAfter(stack.state.updatedAt, lease.acquiredAt),
    },
  });
  stack = loadIntegrationStack(fixture);
  const task = stack.state.targetTasks.find(
    (entry) => entry.targetTaskId === INTEGRATION_IDS.testTargetTask,
  );
  const evidence = {
    kind: "test-step",
    ref: `evidence/${INTEGRATION_IDS.testResult}.txt`,
    digest: `sha256:${"8".repeat(64)}`,
  };
  const result = {
    schemaVersion: 1,
    artifactKind: "wakeflow-target-result",
    programId: INTEGRATION_IDS.program,
    demandId: INTEGRATION_IDS.demand,
    demandRef: "demand.json",
    demandDigest: canonicalJsonDigest(fixture.demand),
    createdAt: timestampAfter(stack.state.updatedAt),
    targetResultId: INTEGRATION_IDS.testResult,
    targetTaskId: INTEGRATION_IDS.testTargetTask,
    taskPackage: {
      taskPackageId: fixture.packageRecord.taskPackageId,
      ref: `task-packages/${fixture.packageRecord.taskPackageId}.json`,
      digest: canonicalJsonDigest(fixture.packageRecord),
    },
    assignment: { windowId: INTEGRATION_IDS.testWindow },
    observedState: {
      revision: stack.state.revision,
      eventId: stack.state.lastEvent.eventId,
      eventDigest: stack.state.lastEvent.eventDigest,
    },
    transport: {
      group: {
        id: task.currentDelivery.group.groupId,
        ref: task.currentDelivery.group.ref,
        digest: task.currentDelivery.group.digest,
      },
      envelope: {
        id: task.currentDelivery.envelope.deliveryId,
        ref: task.currentDelivery.envelope.ref,
        digest: task.currentDelivery.envelope.digest,
      },
    },
    outcome: "completed",
    summary: "The exact disposable Test attempt completed with portable evidence.",
    repositoryChanges: [],
    evidenceLocators: [evidence],
    verification: ["The approved disposable Test step completed."],
    risks: [],
    craftMapping: [{
      kind: "test-step",
      planIndex: 0,
      step: fixture.cardRecord.executionContract.approvedPlan[0],
      ref: evidence.ref,
    }],
  };
  const recorded = await orchestration.recordTargetResultFromTransport({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    artifact: result,
    transition: resultTransition(result),
  });
  assert.equal(recorded.disposition, "current");
  assert.equal(recorded.leaseStatus, "released");
  assert.equal(existsSync(leaseFile), false);
  stack = loadIntegrationStack(fixture);
  const closedTask = stack.state.targetTasks.find(
    (entry) => entry.targetTaskId === INTEGRATION_IDS.testTargetTask,
  );
  assert.equal(closedTask.currentResult.targetResultId, INTEGRATION_IDS.testResult);
  assert.equal(closedTask.testAttempts.length, 1);
  assert.equal(
    closedTask.currentDelivery.testAttemptId,
    closedTask.testAttempts[0].testAttemptId,
  );
});

test("M3-T08 creates one exact group candidate and commits Controller acceptance as a separate review event", async (t) => {
  const settled = await createSettledProductDelivery(t);
  const orchestration = await import(orchestrationModuleUrl.href);
  let stack = loadIntegrationStack(settled.fixture);
  const result = buildProductResult(settled.fixture, stack);
  await orchestration.recordTargetResultFromTransport({
    workspaceRoot: settled.fixture.workspaceRoot,
    stateRoot: settled.fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    artifact: result,
    transition: resultTransition(result),
  });
  stack = loadIntegrationStack(settled.fixture);
  const taskBeforeReview = structuredClone(stack.state.targetTasks[0]);
  const groupId = taskBeforeReview.currentDelivery.group.groupId;
  const candidateTransition = {
    eventId: "event-t08-review-candidate-0001",
    createdAt: timestampAfter(stack.state.updatedAt),
    reason: "Freeze the complete exact dispatch-group review proposal.",
    decisionSummary: "The reducer proposes but does not decide the target result.",
  };
  const candidate = await orchestration.createDispatchGroupReviewCandidate({
    workspaceRoot: settled.fixture.workspaceRoot,
    stateRoot: settled.fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    groupId,
    reviewCandidateId: REVIEW_IDS.candidate,
    transition: candidateTransition,
  });
  assert.equal(candidate.status, "created");
  assert.deepEqual(candidate.allowedDecisions, ["accept", "blocked", "redesign", "rework"]);
  stack = loadIntegrationStack(settled.fixture);
  assert.equal(stack.state.review.status, "pending");
  assert.equal(stack.state.review.pendingCandidate.reviewCandidateId, REVIEW_IDS.candidate);
  const candidateRevision = stack.state.revision;
  const candidateReplay = await orchestration.createDispatchGroupReviewCandidate({
    workspaceRoot: settled.fixture.workspaceRoot,
    stateRoot: settled.fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    groupId,
    reviewCandidateId: REVIEW_IDS.candidate,
    transition: candidateTransition,
  });
  assert.equal(candidateReplay.status, "replayed");
  assert.equal(loadIntegrationStack(settled.fixture).state.revision, candidateRevision);

  const decisionTransition = {
    eventId: "event-t08-review-decision-0001",
    createdAt: timestampAfter(stack.state.updatedAt),
    reason: "Accept the exact nonblocked review candidate.",
    decisionSummary: "Close only this package while retaining immutable result and delivery lineage.",
  };
  const decided = await orchestration.decideDispatchGroupReviewCandidate({
    workspaceRoot: settled.fixture.workspaceRoot,
    stateRoot: settled.fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    groupId,
    reviewCandidateId: REVIEW_IDS.candidate,
    decision: "accept",
    transition: decisionTransition,
  });
  assert.equal(decided.status, "decided");
  assert.equal(decided.decision, "accept");
  const accepted = loadIntegrationStack(settled.fixture);
  assert.equal(accepted.state.state, "planned");
  assert.equal(accepted.state.review.status, "idle");
  assert.equal(accepted.state.targetTasks[0].lifecycleStatus, "accepted");
  assert.equal(accepted.state.taskPackages[0].lifecycleStatus, "closed");
  assert.deepEqual(accepted.state.targetTasks[0].currentResult, taskBeforeReview.currentResult);
  assert.deepEqual(accepted.state.targetTasks[0].currentDelivery, taskBeforeReview.currentDelivery);
  const closedReview = orchestration.inspectDispatchGroupReview({
    workspaceRoot: settled.fixture.workspaceRoot,
    stateRoot: settled.fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    groupId,
  });
  assert.equal(closedReview.members[0].status, "closed");
  assert.deepEqual(closedReview.classification.callbackUnits, []);

  const replayed = await orchestration.decideDispatchGroupReviewCandidate({
    workspaceRoot: settled.fixture.workspaceRoot,
    stateRoot: settled.fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    groupId,
    reviewCandidateId: REVIEW_IDS.candidate,
    decision: "accept",
    transition: decisionTransition,
  });
  assert.equal(replayed.status, "replayed");
  assert.equal(loadIntegrationStack(settled.fixture).state.revision, accepted.state.revision);
});

test("M3-T08 treats a rework envelope as a new round, forbids cross-round supersedes, and keeps late results historical", async (t) => {
  const settled = await createSettledProductDelivery(t);
  const orchestration = await import(orchestrationModuleUrl.href);
  let stack = loadIntegrationStack(settled.fixture);
  const firstResult = buildProductResult(settled.fixture, stack);
  const firstRecorded = await orchestration.recordTargetResultFromTransport({
    workspaceRoot: settled.fixture.workspaceRoot,
    stateRoot: settled.fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    artifact: firstResult,
    transition: resultTransition(firstResult),
  });
  const firstTransport = structuredClone(firstResult.transport);
  stack = loadIntegrationStack(settled.fixture);
  const firstGroupId = stack.state.targetTasks[0].currentDelivery.group.groupId;
  await orchestration.createDispatchGroupReviewCandidate({
    workspaceRoot: settled.fixture.workspaceRoot,
    stateRoot: settled.fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    groupId: firstGroupId,
    reviewCandidateId: REVIEW_IDS.candidate,
    transition: {
      eventId: "event-t08-new-round-candidate",
      createdAt: timestampAfter(stack.state.updatedAt),
      reason: "Freeze the first-round result before requesting rework.",
      decisionSummary: "The next delivery must remain a distinct result round.",
    },
  });
  stack = loadIntegrationStack(settled.fixture);
  await orchestration.decideDispatchGroupReviewCandidate({
    workspaceRoot: settled.fixture.workspaceRoot,
    stateRoot: settled.fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    groupId: firstGroupId,
    reviewCandidateId: REVIEW_IDS.candidate,
    decision: "rework",
    transition: {
      eventId: "event-t08-new-round-rework",
      createdAt: timestampAfter(stack.state.updatedAt),
      reason: "Request a bounded new implementation round.",
      decisionSummary: "Retain the first result while authorizing a distinct envelope.",
    },
  });
  stack = loadIntegrationStack(settled.fixture);
  assert.equal(stack.state.targetTasks[0].lifecycleStatus, "needs-rework");
  assert.equal(stack.state.targetTasks[0].currentResult.targetResultId, RESULT_IDS.first);

  const secondPlan = planTargetDelivery({
    workspaceRoot: settled.fixture.workspaceRoot,
    stateRoot: settled.fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targets: [{
      targetTaskId: INTEGRATION_IDS.targetTask,
      prompt: "Execute the confirmed rework without treating the prior result as a correction.",
      contextPolicy: "force-refresh",
      automationRequested: false,
    }],
    returnPolicy: { mode: "group-ready" },
    createdAt: timestampAfter(stack.state.updatedAt),
  });
  const secondApplied = await applyTargetDeliveryPlan({
    workspaceRoot: settled.fixture.workspaceRoot,
    stateRoot: settled.fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    plan: secondPlan,
    planDigest: secondPlan.planDigest,
  });
  const secondClaim = {
    workspaceRoot: settled.fixture.workspaceRoot,
    stateRoot: settled.fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targetTaskId: INTEGRATION_IDS.targetTask,
    deliveryId: secondApplied.members[0].envelope.deliveryId,
    sendGeneration: 1,
  };
  const secondPermit = await claimTargetDelivery(secondClaim);
  stack = loadIntegrationStack(settled.fixture);
  const secondLeaseFile = path.resolve(
    settled.fixture.workspaceRoot,
    ...secondPermit.lease.ref.split("/"),
  );
  const secondLease = JSON.parse(readFileSync(secondLeaseFile, "utf8"));
  await recordTargetDeliveryOutcome({
    ...secondClaim,
    outcome: {
      hostMethod: "send-message",
      hostMode: "direct-thread",
      transportStatus: "accepted",
      readback: {
        status: "confirmed",
        attempts: 1,
        evidence: [{ kind: "thread-turn-visible", digest: `sha256:${"f".repeat(64)}` }],
      },
      createdAt: timestampAfter(stack.state.updatedAt, secondLease.acquiredAt),
    },
  });
  stack = loadIntegrationStack(settled.fixture);
  assert.notEqual(stack.state.targetTasks[0].currentDelivery.group.groupId, firstGroupId);

  const wrongCrossRound = buildProductResult(settled.fixture, stack, {
    targetResultId: RESULT_IDS.rejectedNewRound,
    supersedes: {
      targetResultId: RESULT_IDS.first,
      ref: firstRecorded.artifact.ref,
      digest: firstRecorded.artifact.digest,
    },
  });
  const beforeWrong = stack.state.revision;
  await assert.rejects(
    orchestration.recordTargetResultFromTransport({
      workspaceRoot: settled.fixture.workspaceRoot,
      stateRoot: settled.fixture.stateRoot,
      expectedProgramId: INTEGRATION_IDS.program,
      artifact: wrongCrossRound,
      transition: resultTransition(wrongCrossRound),
    }),
    /new delivery-envelope round|supersede|failed closed/iu,
  );
  assert.equal(loadIntegrationStack(settled.fixture).state.revision, beforeWrong);
  assert.equal(existsSync(secondLeaseFile), true);

  stack = loadIntegrationStack(settled.fixture);
  const secondResult = buildProductResult(settled.fixture, stack, {
    targetResultId: RESULT_IDS.correction,
  });
  const secondRecorded = await orchestration.recordTargetResultFromTransport({
    workspaceRoot: settled.fixture.workspaceRoot,
    stateRoot: settled.fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    artifact: secondResult,
    transition: resultTransition(secondResult),
  });
  assert.equal(secondRecorded.roundRelation, "new-envelope-round");
  assert.equal(secondRecorded.leaseStatus, "released");
  assert.equal(existsSync(secondLeaseFile), false);
  stack = loadIntegrationStack(settled.fixture);
  assert.equal(stack.state.targetTasks[0].currentResult.targetResultId, RESULT_IDS.correction);
  assert.equal(
    stack.state.targetResults.find((entry) => entry.targetResultId === RESULT_IDS.first).lifecycleStatus,
    "historical",
  );

  const late = buildProductResult(settled.fixture, stack, {
    targetResultId: RESULT_IDS.late,
    transport: firstTransport,
  });
  const lateRecorded = await orchestration.recordTargetResultFromTransport({
    workspaceRoot: settled.fixture.workspaceRoot,
    stateRoot: settled.fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    artifact: late,
    transition: resultTransition(late),
  });
  assert.equal(lateRecorded.disposition, "historical");
  assert.equal(lateRecorded.roundRelation, "late-envelope");
  assert.equal(lateRecorded.leaseStatus, "not-applicable");
  stack = loadIntegrationStack(settled.fixture);
  assert.equal(stack.state.targetTasks[0].currentResult.targetResultId, RESULT_IDS.correction);
  assert.equal(
    stack.state.targetResults.find((entry) => entry.targetResultId === RESULT_IDS.late).lifecycleStatus,
    "historical",
  );

  const replayedFirst = await orchestration.recordTargetResultFromTransport({
    workspaceRoot: settled.fixture.workspaceRoot,
    stateRoot: settled.fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    artifact: firstResult,
    transition: resultTransition(firstResult),
  });
  assert.equal(replayedFirst.status, "replayed");
  assert.equal(replayedFirst.roundRelation, "exact-replay");
  assert.equal(replayedFirst.leaseStatus, "not-applicable");
});

test("M3-T08 preserves one multi-target redesign decision while each exact replacement package is created", async (t) => {
  const fixture = await createIntegrationFixture(t, { secondProduct: true });
  const orchestration = await import(orchestrationModuleUrl.href);
  let stack = loadIntegrationStack(fixture);
  const plan = planTargetDelivery({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targets: [{
      targetTaskId: INTEGRATION_IDS.targetTask,
      prompt: "Execute the first exact multi-target redesign prerequisite.",
      contextPolicy: "assumed-current",
      automationRequested: false,
    }, {
      targetTaskId: INTEGRATION_IDS.targetTaskTwo,
      prompt: "Execute the second exact multi-target redesign prerequisite.",
      contextPolicy: "assumed-current",
      automationRequested: false,
    }],
    returnPolicy: { mode: "group-ready" },
    createdAt: timestampAfter(stack.state.updatedAt),
  });
  const applied = await applyTargetDeliveryPlan({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    plan,
    planDigest: plan.planDigest,
  });
  for (const member of applied.members) {
    const claimInput = {
      workspaceRoot: fixture.workspaceRoot,
      stateRoot: fixture.stateRoot,
      expectedProgramId: INTEGRATION_IDS.program,
      targetTaskId: member.targetTaskId,
      deliveryId: member.envelope.deliveryId,
      sendGeneration: 1,
    };
    const permit = await claimTargetDelivery(claimInput);
    stack = loadIntegrationStack(fixture);
    const lease = JSON.parse(readFileSync(path.resolve(
      fixture.workspaceRoot,
      ...permit.lease.ref.split("/"),
    ), "utf8"));
    await recordTargetDeliveryOutcome({
      ...claimInput,
      outcome: {
        hostMethod: "send-message",
        hostMode: "direct-thread",
        transportStatus: "accepted",
        readback: {
          status: "confirmed",
          attempts: 1,
          evidence: [{
            kind: "thread-turn-visible",
            digest: member.targetTaskId === INTEGRATION_IDS.targetTask
              ? `sha256:${"a".repeat(64)}`
              : `sha256:${"b".repeat(64)}`,
          }],
        },
        createdAt: timestampAfter(stack.state.updatedAt, lease.acquiredAt),
      },
    });
  }

  for (const [targetTaskId, targetResultId] of [
    [INTEGRATION_IDS.targetTask, RESULT_IDS.groupFirst],
    [INTEGRATION_IDS.targetTaskTwo, RESULT_IDS.groupSecond],
  ]) {
    stack = loadIntegrationStack(fixture);
    const result = buildProductResult(fixture, stack, { targetTaskId, targetResultId });
    await orchestration.recordTargetResultFromTransport({
      workspaceRoot: fixture.workspaceRoot,
      stateRoot: fixture.stateRoot,
      expectedProgramId: INTEGRATION_IDS.program,
      artifact: result,
      transition: resultTransition(result),
    });
  }
  stack = loadIntegrationStack(fixture);
  const groupId = stack.state.targetTasks.find(
    (entry) => entry.targetTaskId === INTEGRATION_IDS.targetTask,
  ).currentDelivery.group.groupId;
  const candidateTransition = {
    eventId: "event-t08-multi-redesign-candidate",
    createdAt: timestampAfter(stack.state.updatedAt),
    reason: "Freeze both exact current group results for one redesign decision.",
    decisionSummary: "The decision scope remains valid until both named originals receive successors.",
  };
  await orchestration.createDispatchGroupReviewCandidate({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    groupId,
    reviewCandidateId: REVIEW_IDS.multi,
    transition: candidateTransition,
  });
  stack = loadIntegrationStack(fixture);
  await orchestration.decideDispatchGroupReviewCandidate({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    groupId,
    reviewCandidateId: REVIEW_IDS.multi,
    decision: "redesign",
    transition: {
      eventId: "event-t08-multi-redesign-decision",
      createdAt: timestampAfter(stack.state.updatedAt),
      reason: "Authorize exact same-repository successors for both scoped product tasks.",
      decisionSummary: "Do not make the second successor depend on the first successor event being the tail.",
    },
  });
  stack = loadIntegrationStack(fixture);
  assert.deepEqual(
    stack.state.targetTasks.map((entry) => entry.lifecycleStatus),
    ["needs-rework", "needs-rework"],
  );

  const originals = [{
    record: fixture.packageRecord,
    oldTargetTaskId: INTEGRATION_IDS.targetTask,
    taskPackageId: REPLACEMENT_IDS.firstPackage,
    targetTaskId: REPLACEMENT_IDS.firstTask,
  }, {
    record: fixture.packageRecordTwo,
    oldTargetTaskId: INTEGRATION_IDS.targetTaskTwo,
    taskPackageId: REPLACEMENT_IDS.secondPackage,
    targetTaskId: REPLACEMENT_IDS.secondTask,
  }];
  for (const [index, replacementSource] of originals.entries()) {
    stack = loadIntegrationStack(fixture);
    const replacement = {
      ...structuredClone(replacementSource.record),
      createdAt: timestampAfter(stack.state.updatedAt),
      taskPackageId: replacementSource.taskPackageId,
      targetTaskId: replacementSource.targetTaskId,
      objective: `Implement exact redesign successor ${index + 1}.`,
      replacesTargetTask: {
        targetTaskId: replacementSource.oldTargetTaskId,
        taskPackageRef: `task-packages/${replacementSource.record.taskPackageId}.json`,
        taskPackageDigest: canonicalJsonDigest(replacementSource.record),
      },
    };
    createTaskPackageArtifact({
      stateRoot: fixture.stateRoot,
      expectedProgramId: INTEGRATION_IDS.program,
      ledgerRoot: fixture.ledgerRoot,
      config: fixture.config,
      expectedPrevious: {
        revision: stack.state.revision,
        stateDigest: stack.digests.state,
      },
      artifact: replacement,
      transition: {
        eventId: `event-t08-multi-redesign-replacement-${index + 1}`,
        createdAt: replacement.createdAt,
        reason: `Create exact redesign successor ${index + 1}.`,
        decisionSummary: "Consume only the matching original task from the prior multi-target decision.",
      },
    });
    const afterReplacement = loadIntegrationStack(fixture);
    assert.equal(afterReplacement.state.state, "planned");
  }
  stack = loadIntegrationStack(fixture);
  assert.equal(
    stack.state.targetTasks.find((entry) => entry.targetTaskId === INTEGRATION_IDS.targetTask).lifecycleStatus,
    "superseded",
  );
  assert.equal(
    stack.state.targetTasks.find((entry) => entry.targetTaskId === INTEGRATION_IDS.targetTaskTwo).lifecycleStatus,
    "superseded",
  );
  assert.equal(
    stack.events.filter((event) => event.type === "review.redesign-requested").length,
    1,
  );
});

test("M3-T08 wakes a group-ready Controller for one blocker without pretending the group is review-complete", async (t) => {
  const fixture = await createIntegrationFixture(t, { secondProduct: true });
  const orchestration = await import(orchestrationModuleUrl.href);
  let stack = loadIntegrationStack(fixture);
  const plan = planTargetDelivery({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targets: [INTEGRATION_IDS.targetTask, INTEGRATION_IDS.targetTaskTwo].map(
      (targetTaskId) => ({
        targetTaskId,
        prompt: `Execute blocker-aware group member ${targetTaskId}.`,
        contextPolicy: "assumed-current",
        automationRequested: false,
      }),
    ),
    returnPolicy: { mode: "group-ready" },
    createdAt: timestampAfter(stack.state.updatedAt),
  });
  const applied = await applyTargetDeliveryPlan({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    plan,
    planDigest: plan.planDigest,
  });
  const first = applied.members.find(
    (entry) => entry.targetTaskId === INTEGRATION_IDS.targetTask,
  );
  const claimInput = {
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    targetTaskId: first.targetTaskId,
    deliveryId: first.envelope.deliveryId,
    sendGeneration: 1,
  };
  const permit = await claimTargetDelivery(claimInput);
  stack = loadIntegrationStack(fixture);
  const lease = JSON.parse(readFileSync(path.resolve(
    fixture.workspaceRoot,
    ...permit.lease.ref.split("/"),
  ), "utf8"));
  await recordTargetDeliveryOutcome({
    ...claimInput,
    outcome: {
      hostMethod: "send-message",
      hostMode: "direct-thread",
      transportStatus: "accepted",
      readback: {
        status: "confirmed",
        attempts: 1,
        evidence: [{ kind: "thread-turn-visible", digest: `sha256:${"6".repeat(64)}` }],
      },
      createdAt: timestampAfter(stack.state.updatedAt, lease.acquiredAt),
    },
  });
  stack = loadIntegrationStack(fixture);
  const blocked = buildProductResult(fixture, stack, {
    targetResultId: RESULT_IDS.earlyBlocked,
    outcome: "blocked",
  });
  await orchestration.recordTargetResultFromTransport({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    artifact: blocked,
    transition: resultTransition(blocked),
  });
  const review = orchestration.inspectDispatchGroupReview({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    groupId: applied.group.groupId,
  });
  assert.equal(review.classification.reviewEligible, false);
  assert.deepEqual(review.classification.blockedTargetTaskIds, [INTEGRATION_IDS.targetTask]);
  assert.equal(review.classification.incompleteTargetTaskIds.length, 1);
  assert.deepEqual(review.classification.callbackUnits[0].targetTaskIds, [INTEGRATION_IDS.targetTask]);

  const returnPlan = orchestration.planControllerReturnDelivery({
    workspaceRoot: fixture.workspaceRoot,
    stateRoot: fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    groupId: applied.group.groupId,
    deliveryId: "delivery_67676767-6767-4767-8767-676767676767",
    createdAt: timestampAfter(loadIntegrationStack(fixture).state.updatedAt),
  });
  assert.deepEqual(returnPlan.unit.targetTaskIds, [INTEGRATION_IDS.targetTask]);
  await assert.rejects(
    orchestration.createDispatchGroupReviewCandidate({
      workspaceRoot: fixture.workspaceRoot,
      stateRoot: fixture.stateRoot,
      expectedProgramId: INTEGRATION_IDS.program,
      groupId: applied.group.groupId,
      reviewCandidateId: "review-candidate_68686868-6868-4868-8868-686868686868",
      transition: {
        eventId: "event-t08-early-blocked-candidate",
        createdAt: returnPlan.envelope.createdAt,
        reason: "Do not reduce a blocker callback as a complete group candidate.",
        decisionSummary: "The unsent sibling remains outside a final review decision.",
      },
    }),
    /requires every current group member|review-complete|failed closed/iu,
  );
});

test("M3-T08 plans a redacted Controller return without writes and records only one immutable transport run", async (t) => {
  const settled = await createSettledProductDelivery(t);
  const orchestration = await import(orchestrationModuleUrl.href);
  let stack = loadIntegrationStack(settled.fixture);
  const result = buildProductResult(settled.fixture, stack);
  await orchestration.recordTargetResultFromTransport({
    workspaceRoot: settled.fixture.workspaceRoot,
    stateRoot: settled.fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    artifact: result,
    transition: resultTransition(result),
  });
  stack = loadIntegrationStack(settled.fixture);
  const groupId = stack.state.targetTasks[0].currentDelivery.group.groupId;
  const planInput = {
    workspaceRoot: settled.fixture.workspaceRoot,
    stateRoot: settled.fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    groupId,
    deliveryId: RETURN_IDS.delivery,
    createdAt: timestampAfter(stack.state.updatedAt),
  };
  const beforePlanTree = privateTreeSnapshot(settled.fixture.workspaceRoot);
  const plan = orchestration.planControllerReturnDelivery(planInput);
  assert.deepEqual(privateTreeSnapshot(settled.fixture.workspaceRoot), beforePlanTree);
  assert.equal(plan.envelope.windowId, INTEGRATION_IDS.controllerWindow);
  assert.equal(plan.envelope.bindingId, INTEGRATION_IDS.controllerBinding);
  assert.equal(plan.envelope.observedLease, undefined);
  assert.equal(JSON.stringify(plan).includes(INTEGRATION_IDS.controllerHandle), false);
  assert.equal(Object.isFrozen(plan), true);

  const beforeApplyState = structuredClone(stack.state);
  const beforeApplyEvents = structuredClone(stack.events);
  const beforeApplyTransport = inspectTransportDemandAuthority({
    workspaceRoot: settled.fixture.workspaceRoot,
    programId: INTEGRATION_IDS.program,
    demandId: INTEGRATION_IDS.demand,
  });
  const beforeApplyLeases = inspectWindowCoordinationLeaseInventory({
    workspaceRoot: settled.fixture.workspaceRoot,
  });
  const applied = await orchestration.applyControllerReturnDeliveryPlan({
    workspaceRoot: settled.fixture.workspaceRoot,
    stateRoot: settled.fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    plan,
    planDigest: plan.planDigest,
  });
  assert.equal(applied.status, "created");
  stack = loadIntegrationStack(settled.fixture);
  assert.deepEqual(stack.state, beforeApplyState);
  assert.deepEqual(stack.events, beforeApplyEvents);
  const afterApplyTransport = inspectTransportDemandAuthority({
    workspaceRoot: settled.fixture.workspaceRoot,
    programId: INTEGRATION_IDS.program,
    demandId: INTEGRATION_IDS.demand,
  });
  assert.equal(afterApplyTransport.entries.envelopes.length, beforeApplyTransport.entries.envelopes.length + 1);
  assert.equal(afterApplyTransport.entries.runs.length, beforeApplyTransport.entries.runs.length);
  assert.equal(
    inspectWindowCoordinationLeaseInventory({ workspaceRoot: settled.fixture.workspaceRoot }).inventoryDigest,
    beforeApplyLeases.inventoryDigest,
  );
  const applyReplay = await orchestration.applyControllerReturnDeliveryPlan({
    workspaceRoot: settled.fixture.workspaceRoot,
    stateRoot: settled.fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    plan,
    planDigest: plan.planDigest,
  });
  assert.equal(applyReplay.status, "replayed");
  assert.equal(
    inspectTransportDemandAuthority({
      workspaceRoot: settled.fixture.workspaceRoot,
      programId: INTEGRATION_IDS.program,
      demandId: INTEGRATION_IDS.demand,
    }).entries.envelopes.length,
    afterApplyTransport.entries.envelopes.length,
  );

  const preSend = orchestration.inspectControllerReturnPreSend({
    workspaceRoot: settled.fixture.workspaceRoot,
    stateRoot: settled.fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    deliveryId: RETURN_IDS.delivery,
  });
  assert.equal(preSend.status, "ready");
  assert.equal(preSend.requiresHostOperationFence, true);
  assert.equal(JSON.stringify(preSend).includes(INTEGRATION_IDS.controllerHandle), false);

  const outcomeInput = {
    workspaceRoot: settled.fixture.workspaceRoot,
    stateRoot: settled.fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    deliveryId: RETURN_IDS.delivery,
    runId: RETURN_IDS.run,
    outcome: {
      hostMethod: "send-message",
      hostMode: "direct-thread",
      transportStatus: "accepted",
      readback: {
        status: "confirmed",
        attempts: 1,
        evidence: [{ kind: "thread-turn-visible", digest: `sha256:${"9".repeat(64)}` }],
      },
      createdAt: timestampAfter(plan.envelope.createdAt),
    },
  };
  const recorded = await orchestration.recordControllerReturnOutcome(outcomeInput);
  assert.equal(recorded.status, "recorded");
  assert.equal(loadIntegrationStack(settled.fixture).state.revision, beforeApplyState.revision);
  assert.equal(
    inspectWindowCoordinationLeaseInventory({ workspaceRoot: settled.fixture.workspaceRoot }).inventoryDigest,
    beforeApplyLeases.inventoryDigest,
  );
  const afterOutcomeTransport = inspectTransportDemandAuthority({
    workspaceRoot: settled.fixture.workspaceRoot,
    programId: INTEGRATION_IDS.program,
    demandId: INTEGRATION_IDS.demand,
  });
  assert.equal(afterOutcomeTransport.entries.runs.length, beforeApplyTransport.entries.runs.length + 1);

  const replayed = await orchestration.recordControllerReturnOutcome(outcomeInput);
  assert.equal(replayed.status, "replayed");
  assert.equal(
    inspectTransportDemandAuthority({
      workspaceRoot: settled.fixture.workspaceRoot,
      programId: INTEGRATION_IDS.program,
      demandId: INTEGRATION_IDS.demand,
    }).entries.runs.length,
    afterOutcomeTransport.entries.runs.length,
  );
  assert.equal(
    orchestration.inspectControllerReturnPreSend({
      workspaceRoot: settled.fixture.workspaceRoot,
      stateRoot: settled.fixture.stateRoot,
      expectedProgramId: INTEGRATION_IDS.program,
      deliveryId: RETURN_IDS.delivery,
    }).status,
    "already-sent",
  );
  await assert.rejects(
    Promise.resolve().then(() => orchestration.planControllerReturnDelivery({
      ...planInput,
      deliveryId: "delivery_49494949-4949-4949-8949-494949494949",
      createdAt: timestampAfter(outcomeInput.outcome.createdAt),
    })),
    /already has an accepted|already-sent|failed closed/iu,
  );
});

test("M3-T08 leaves a rejected Controller return at explicit-rearm-required without inventing a retry", async (t) => {
  const prepared = await createAppliedControllerReturn(t, RETURN_IDS.rejectedDelivery);
  const { settled, orchestration, stack, groupId, plan } = prepared;
  const beforeState = structuredClone(stack.state);
  const beforeLeases = inspectWindowCoordinationLeaseInventory({
    workspaceRoot: settled.fixture.workspaceRoot,
  });
  const outcomeInput = {
    workspaceRoot: settled.fixture.workspaceRoot,
    stateRoot: settled.fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    deliveryId: RETURN_IDS.rejectedDelivery,
    runId: RETURN_IDS.rejectedRun,
    outcome: {
      hostMethod: "send-message",
      hostMode: "direct-thread",
      transportStatus: "rejected-before-send",
      readback: { status: "unavailable", attempts: 0, evidence: [] },
      error: {
        code: "controller-return-send-rejected",
        message: "The host rejected the callback before any physical effect.",
      },
      createdAt: timestampAfter(plan.envelope.createdAt),
    },
  };
  const rejected = await orchestration.recordControllerReturnOutcome(outcomeInput);
  assert.equal(rejected.transportStatus, "rejected-before-send");
  assert.equal(
    orchestration.inspectControllerReturnPreSend({
      workspaceRoot: settled.fixture.workspaceRoot,
      stateRoot: settled.fixture.stateRoot,
      expectedProgramId: INTEGRATION_IDS.program,
      deliveryId: RETURN_IDS.rejectedDelivery,
    }).status,
    "explicit-rearm-required",
  );
  assert.deepEqual(loadIntegrationStack(settled.fixture).state, beforeState);
  assert.equal(
    inspectWindowCoordinationLeaseInventory({ workspaceRoot: settled.fixture.workspaceRoot }).inventoryDigest,
    beforeLeases.inventoryDigest,
  );
  assert.equal(
    (await orchestration.recordControllerReturnOutcome(outcomeInput)).status,
    "replayed",
  );
  await assert.rejects(
    orchestration.recordControllerReturnOutcome({
      ...outcomeInput,
      runId: RETURN_IDS.conflictingRun,
    }),
    /already has a different immutable run|already-sent|failed closed/iu,
  );
  await assert.rejects(
    Promise.resolve().then(() => orchestration.planControllerReturnDelivery({
      workspaceRoot: settled.fixture.workspaceRoot,
      stateRoot: settled.fixture.stateRoot,
      expectedProgramId: INTEGRATION_IDS.program,
      groupId,
      deliveryId: "delivery_61616161-6161-4161-8161-616161616161",
      createdAt: timestampAfter(outcomeInput.outcome.createdAt),
    })),
    /rearm authority|rearm-required|failed closed/iu,
  );
});

test("M3-T08 invalidates an unsent Controller envelope after exact binding replacement", async (t) => {
  const prepared = await createAppliedControllerReturn(
    t,
    "delivery_63636363-6363-4363-8363-636363636363",
  );
  const { settled, orchestration, groupId, plan } = prepared;
  const replacement = await replaceWindowBinding({
    workspaceRoot: settled.fixture.workspaceRoot,
    windowId: INTEGRATION_IDS.controllerWindow,
    handle: { kind: "codex-thread", value: "64646464-6464-4464-8464-646464646464" },
    expectedBindingId: plan.binding.bindingId,
    expectedBindingDigest: plan.binding.identityBindingDigest,
  });
  await assert.rejects(
    Promise.resolve().then(() => orchestration.inspectControllerReturnPreSend({
      workspaceRoot: settled.fixture.workspaceRoot,
      stateRoot: settled.fixture.stateRoot,
      expectedProgramId: INTEGRATION_IDS.program,
      deliveryId: plan.envelope.deliveryId,
    })),
    /binding is no longer current|stale|failed closed/iu,
  );
  const successor = orchestration.planControllerReturnDelivery({
    workspaceRoot: settled.fixture.workspaceRoot,
    stateRoot: settled.fixture.stateRoot,
    expectedProgramId: INTEGRATION_IDS.program,
    groupId,
    deliveryId: "delivery_65656565-6565-4565-8565-656565656565",
    createdAt: timestampAfter(plan.envelope.createdAt),
  });
  assert.equal(successor.binding.bindingId, replacement.bindingId);
  assert.equal(successor.binding.identityBindingDigest, replacement.identityBindingDigest);
  assert.notEqual(successor.envelope.envelopeDigest, plan.envelope.envelopeDigest);
});
