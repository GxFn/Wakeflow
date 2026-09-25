import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";

import {
  computePayloadTreeDigest,
  demandWindowIds,
  deriveContinueBlockers,
  deriveCreationBlockers,
  deriveDecisionBlockers,
  deriveDemandCreationIds,
  deriveLifecycleIds,
  deriveTerminalBlockers,
  isArchivePayloadPath,
  payloadPrivacyBlockers,
  pendingReviewTargets,
} from "../../../src/capabilities/demand/decide.js";
import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  DEMAND_REWORK_ESCALATION_THRESHOLD,
  DemandEventSourcingDecisionError,
  decideDemandEventSourcingCommand,
  evolveDemandEventSourcingState,
} from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-decider.js";
import {
  computeDemandAggregateStateDigest,
  parseDemandAggregateState,
  type DemandAggregateState,
} from "../../../src/governance/demand/model/demand-aggregate-state.js";
import { deriveNextProjection } from "../../../src/kernel/next-projection.js";
import {
  createDeliveryEnvelopeFixture,
  createDeliveryOutcomeFixture,
  createWorkClaimFixture,
} from "../../governance/delivery/delivery-records.fixture.js";
import {
  createTargetResultCallbackFixture,
  createTargetResultFixture,
} from "../../governance/result/target-result.fixture.js";
import { createControllerImplementationReviewDecisionForState } from "../../governance/review/controller-implementation-review-decision.fixture.js";
import {
  createTaskPackageFixture,
  TASKING_AUTHORITY_DIGEST,
  TASKING_DEMAND_ID,
} from "../../governance/tasking/task-package.fixture.js";

/**
 * demand 切片纯决定：标识派生、归档负载筛选、凭证扫描、阻塞项派生；
 * 决定器侧：第三次 rework 刹车附带升级事件、用户回答清除升级、续接回到 active。
 */

const REQUIREMENT_ID = "requirement_11111111-1111-4111-8111-111111111111";
const DIGEST_A = parseSha256Digest(`sha256:${"a".repeat(64)}`);
const DIGEST_B = parseSha256Digest(`sha256:${"b".repeat(64)}`);
const AT = parseUtcInstance("2026-09-04T10:00:00.000Z");

function parseUtcInstance(value: string) {
  return parseUtcInstant(value);
}

function eventId(hex: string) {
  return parseWakeflowDurableIdOfKind(`demand-event_${hex}`, "demand-event");
}

test("标识由来源确定性派生：同一认领状态同一 Demand，动作与修订号区分生命周期事件", () => {
  const first = deriveDemandCreationIds(REQUIREMENT_ID, DIGEST_A);
  deepEqual(deriveDemandCreationIds(REQUIREMENT_ID, DIGEST_A), first);
  equal(deriveDemandCreationIds(REQUIREMENT_ID, DIGEST_B).demandId === first.demandId, false);
  equal(first.demandId.startsWith("demand_"), true);
  equal(first.eventId.startsWith("demand-event_"), true);
  equal(first.commitId.startsWith("demand-event-commit_"), true);
  const complete = deriveLifecycleIds(first.demandId, "complete", 7);
  deepEqual(deriveLifecycleIds(first.demandId, "complete", 7), complete);
  equal(deriveLifecycleIds(first.demandId, "cancel", 7).eventId === complete.eventId, false);
  equal(deriveLifecycleIds(first.demandId, "complete", 8).commitId === complete.commitId, false);
});

test("归档负载排除可重建检查点，树摘要与顺序无关，只有凭证类命中阻塞", () => {
  equal(isArchivePayloadPath("event-sourcing/commits/0000000001.json"), true);
  equal(isArchivePayloadPath("identity.json"), true);
  equal(isArchivePayloadPath("event-sourcing/snapshots/0000000001.json"), false);
  equal(isArchivePayloadPath("event-sourcing/index/0000000001.json"), false);
  equal(isArchivePayloadPath("event-sourcing/append-candidates"), false);
  const files = [
    { resourcePath: parsePortableResourcePath("identity.json"), byteCount: 10, digest: DIGEST_A },
    { resourcePath: parsePortableResourcePath("authority.json"), byteCount: 20, digest: DIGEST_B },
  ];
  equal(computePayloadTreeDigest(files), computePayloadTreeDigest([...files].reverse()));
  deepEqual(
    payloadPrivacyBlockers([
      { resourcePath: "artifacts/a.md", text: "see /Users/someone/private and demand_x\n" },
      { resourcePath: "artifacts/b.md", text: "token = abcdefgh12345678\n" },
    ]),
    ["payload-privacy:artifacts/b.md:1:credential-assignment"],
  );
});

test("阻塞项派生：完成看路由与门，取消看待评审，continue 看归档结果，认领看看板", () => {
  const claim = {
    status: "claimed" as const,
    claim: { demandId: "demand_00000000-0000-4000-8000-000000000000", claimedAt: AT },
    archive: null,
  } as unknown as Parameters<typeof deriveTerminalBlockers>[0]["claim"];
  const passing = [
    { gate: "config-authority", status: "pass" as const, detail: null },
    { gate: "board-claim", status: "unavailable" as const, detail: "io" },
  ];
  deepEqual(
    deriveTerminalBlockers({
      action: "complete",
      lifecycle: "active",
      awaitingDecision: true,
      postAcceptanceStage: "not-ready",
      demandId: "demand_00000000-0000-4000-8000-000000000000",
      claim,
      pendingReviews: ["target-task_1"],
      gates: passing,
      payloadBlockers: ["payload-privacy:x:1:private-key"],
      archiveConflict: true,
    }),
    [
      "awaiting-decision",
      "route:not-ready",
      "verify:board-claim:unavailable",
      "payload-privacy:x:1:private-key",
      "archive-conflict",
    ],
  );
  deepEqual(
    deriveTerminalBlockers({
      action: "cancel",
      lifecycle: "completed",
      awaitingDecision: false,
      postAcceptanceStage: "not-ready",
      demandId: "demand_ffffffff-ffff-4fff-8fff-ffffffffffff",
      claim,
      pendingReviews: ["target-task_1"],
      gates: [],
      payloadBlockers: [],
      archiveConflict: false,
    }),
    ["lifecycle:completed", "pending-review:target-task_1", "package-claim:claimed"],
  );
  deepEqual(
    deriveContinueBlockers({
      rootPresent: true,
      archiveOutcome: "cancelled",
      demandId: "demand_00000000-0000-4000-8000-000000000000",
      claim: null,
      otherActiveDemandId: "demand_11111111-1111-4111-8111-111111111111",
    }),
    [
      "demand-root-present",
      "archive-outcome:cancelled",
      "package-unknown",
      "pod-busy:demand_11111111-1111-4111-8111-111111111111",
    ],
  );
  const archivedClaim = {
    status: "archived",
    archive: { demandId: "demand_00000000-0000-4000-8000-000000000000" },
  } as unknown as Parameters<typeof deriveContinueBlockers>[0]["claim"];
  const archivedContinue = {
    rootPresent: false,
    archiveOutcome: "completed",
    demandId: "demand_00000000-0000-4000-8000-000000000000",
    claim: archivedClaim,
    otherActiveDemandId: null,
    archivedPodId: "pod_00000000-0000-4000-8000-000000000000",
  } as const;
  deepEqual(deriveContinueBlockers({ ...archivedContinue, pod: null }), [
    "pod-unknown:pod_00000000-0000-4000-8000-000000000000",
  ]);
  deepEqual(
    deriveContinueBlockers({
      ...archivedContinue,
      pod: { podId: "pod_00000000-0000-4000-8000-000000000000", lifecycle: "closing" },
    }),
    ["pod-closing:pod_00000000-0000-4000-8000-000000000000"],
  );
  deepEqual(
    deriveContinueBlockers({
      rootPresent: false,
      archiveOutcome: "completed",
      demandId: "demand_00000000-0000-4000-8000-000000000000",
      claim: {
        status: "archived",
        demandType: "research",
        archive: { demandId: "demand_00000000-0000-4000-8000-000000000000" },
      } as unknown as Parameters<typeof deriveContinueBlockers>[0]["claim"],
      otherActiveDemandId: null,
    }),
    ["demand-type:research"],
  );
  deepEqual(
    deriveDecisionBlockers({ rootPresent: true, lifecycle: "active", awaitingDecision: false }),
    ["no-escalation-pending"],
  );
  deepEqual(
    deriveCreationBlockers({
      claim: { status: "parked" } as unknown as Parameters<
        typeof deriveCreationBlockers
      >[0]["claim"],
      programMatches: false,
      recordMatches: true,
      pod: {
        podId: "pod_99999999-9999-4999-8999-999999999999",
        lifecycle: "closing",
        activeDemandId: "demand_11111111-1111-4111-8111-111111111111",
      },
      requestedPodId: "pod_99999999-9999-4999-8999-999999999999",
    }),
    [
      "package-claim:parked",
      "package-program",
      "pod-closing:pod_99999999-9999-4999-8999-999999999999",
      "pod-busy:demand_11111111-1111-4111-8111-111111111111",
    ],
  );
  deepEqual(
    deriveCreationBlockers({
      claim: { status: "pending" } as unknown as Parameters<
        typeof deriveCreationBlockers
      >[0]["claim"],
      programMatches: true,
      recordMatches: true,
      pod: null,
      requestedPodId: "pod_00000000-0000-4000-8000-000000000000",
    }),
    ["pod-unknown:pod_00000000-0000-4000-8000-000000000000"],
  );
});

/** 纯链：发布 → 规划 → 投递 → 认领 → 观察 → 结果，得到一个 result-reported 的实现目标。 */
function reportedState() {
  const [published] = decideDemandEventSourcingCommand(null, {
    commandType: "publication.publish-demand",
    commandVersion: 1,
    demandId: TASKING_DEMAND_ID,
    eventId: eventId("22222222-2222-4222-8222-222222222222"),
    recordedAt: parseUtcInstant("2026-08-26T10:00:00.000Z"),
    identityDigest: DIGEST_A,
    authorityDigest: TASKING_AUTHORITY_DIGEST,
  });
  const active = evolveDemandEventSourcingState(null, published);
  const taskPackage = createTaskPackageFixture();
  const [planned] = decideDemandEventSourcingCommand(active, {
    commandType: "tasking.plan-target-task",
    commandVersion: 1,
    eventId: eventId("33333333-3333-4333-8333-333333333333"),
    taskPackage,
  });
  const tasking = evolveDemandEventSourcingState(active, planned);
  const claim = createWorkClaimFixture();
  const envelope = createDeliveryEnvelopeFixture({ claim });
  const [prepared] = decideDemandEventSourcingCommand(tasking, {
    commandType: "delivery.prepare-delivery",
    commandVersion: 1,
    eventId: eventId("88888888-8888-4888-8888-888888888888"),
    envelope,
    taskPackage,
  });
  const deliveryPrepared = evolveDemandEventSourcingState(tasking, prepared);
  const outcome = createDeliveryOutcomeFixture({ claim, envelope });
  const [observed] = decideDemandEventSourcingCommand(deliveryPrepared, {
    commandType: "delivery.record-delivery-outcome",
    commandVersion: 1,
    eventId: eventId("a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1"),
    outcome,
  });
  const hostEffectObserved = evolveDemandEventSourcingState(deliveryPrepared, observed);
  const targetResult = createTargetResultFixture({ claim, envelope, outcome });
  const [resultEvent] = decideDemandEventSourcingCommand(hostEffectObserved, {
    commandType: "result.record-target-result",
    commandVersion: 1,
    result: targetResult,
    callback: createTargetResultCallbackFixture(targetResult),
    evidenceResolution: [],
  });
  return { state: evolveDemandEventSourcingState(hostEffectObserved, resultEvent), targetResult };
}

function reworkCountOf(state: Readonly<DemandAggregateState>): number | undefined {
  const target = state.targetTasks[0];
  return target === undefined || target.workType === "test" ? undefined : target.reworkCount;
}

function withReworkCount(state: Readonly<DemandAggregateState>, reworkCount: number) {
  return parseDemandAggregateState({
    ...state,
    targetTasks: state.targetTasks.map((target) => ({ ...target, reworkCount })),
  });
}

test("第三次 rework 刹车：同一提交附带升级事件，路由 awaiting-decision，用户回答后清除", () => {
  const { state: reported, targetResult } = reportedState();
  equal(demandWindowIds(reported).length, 1);
  deepEqual(pendingReviewTargets(reported), [reported.targetTasks[0]?.targetTaskId]);

  const secondRework = withReworkCount(reported, DEMAND_REWORK_ESCALATION_THRESHOLD - 2);
  const decision = createControllerImplementationReviewDecisionForState(
    computeDemandAggregateStateDigest(secondRework),
    "rework",
    8,
    targetResult,
  );
  const events = decideDemandEventSourcingCommand(secondRework, {
    commandType: "review.decide-target-result",
    commandVersion: 1,
    decision,
  });
  equal(events.length, 1, "below the threshold no escalation is attached");
  const reworked = evolveDemandEventSourcingState(secondRework, events[0]);
  equal(reworkCountOf(reworked), DEMAND_REWORK_ESCALATION_THRESHOLD - 1);

  const atThreshold = withReworkCount(reported, DEMAND_REWORK_ESCALATION_THRESHOLD - 1);
  const brakeDecision = createControllerImplementationReviewDecisionForState(
    computeDemandAggregateStateDigest(atThreshold),
    "rework",
    8,
    targetResult,
  );
  const braked = decideDemandEventSourcingCommand(atThreshold, {
    commandType: "review.decide-target-result",
    commandVersion: 1,
    decision: brakeDecision,
  });
  equal(braked.length, 2);
  const escalated = braked[1];
  equal(escalated?.eventType, "lifecycle.demand-escalated");
  if (escalated?.eventType !== "lifecycle.demand-escalated") throw new Error("expected escalation");
  equal(escalated.data.escalation.source.kind, "rework-brake");
  equal(escalated.data.escalation.options.length, 3);
  let state = evolveDemandEventSourcingState(atThreshold, braked[0]);
  state = evolveDemandEventSourcingState(state, escalated);
  equal(state.awaitingDecision?.escalationEventId, escalated.eventId);
  equal(reworkCountOf(state), DEMAND_REWORK_ESCALATION_THRESHOLD);

  const [recorded] = decideDemandEventSourcingCommand(state, {
    commandType: "lifecycle.record-decision",
    commandVersion: 1,
    demandId: TASKING_DEMAND_ID,
    eventId: eventId("44444444-4444-4444-8444-444444444444"),
    recordedAt: AT,
    decision: {
      escalationEventId: escalated.eventId,
      text: "Accept the current result with the recorded residual risks.",
      chosenOption: "Accept the current result with the recorded residual risks.",
    },
  });
  equal(recorded.eventType, "lifecycle.decision-recorded");
  const decided = evolveDemandEventSourcingState(state, recorded);
  equal(decided.awaitingDecision, undefined);
  equal(decided.lifecycle, "active");
});

test("续接：已完成状态回到 active 并要求先规划；活动状态不能续接", () => {
  const { state: reported, targetResult } = reportedState();
  const [acceptedEvent] = decideDemandEventSourcingCommand(reported, {
    commandType: "review.decide-target-result",
    commandVersion: 1,
    decision: createControllerImplementationReviewDecisionForState(
      computeDemandAggregateStateDigest(reported),
      "accept",
      8,
      targetResult,
    ),
  });
  const accepted = evolveDemandEventSourcingState(reported, acceptedEvent);
  const completedLike = parseDemandAggregateState({ ...accepted, lifecycle: "completed" });
  const [continued] = decideDemandEventSourcingCommand(completedLike, {
    commandType: "lifecycle.continue-demand",
    commandVersion: 1,
    demandId: TASKING_DEMAND_ID,
    eventId: eventId("55555555-5555-4555-8555-555555555555"),
    recordedAt: AT,
    continuation: {
      kind: "optimization",
      summary: "Tighten the focused checks after the first delivery.",
      archiveRef: "archives/demand_x/0000000009",
      archiveManifestDigest: DIGEST_A,
      previousStreamRevision: 9,
    },
  });
  equal(continued.eventType, "lifecycle.demand-continued");
  const reopened = evolveDemandEventSourcingState(completedLike, continued);
  equal(reopened.lifecycle, "active");
  equal(reopened.continuation?.planningRequired, true);
  throws(
    () =>
      decideDemandEventSourcingCommand(reported, {
        commandType: "lifecycle.continue-demand",
        commandVersion: 1,
        demandId: TASKING_DEMAND_ID,
        eventId: eventId("77777777-7777-4777-8777-777777777777"),
        recordedAt: AT,
        continuation: {
          kind: "verified-bug",
          summary: "x",
          archiveRef: "archives/demand_x/0000000009",
          archiveManifestDigest: DIGEST_A,
          previousStreamRevision: 9,
        },
      }),
    (error: unknown) => {
      ok(error instanceof DemandEventSourcingDecisionError);
      equal(error.reason, "transition");
      equal(error.path, "$state/lifecycle");
      return true;
    },
  );
});

test("等待用户决策的路由把下一步交给用户并建议 wakeflow_continue_demand", () => {
  const next = deriveNextProjection({
    disposition: "awaiting-decision",
    frontiers: [{ kind: "decision-required" }],
    blockers: [{ kind: "awaiting-decision" }],
  });
  equal(next.owner, "user");
  equal(next.suggestedTool, "wakeflow_continue_demand");
});
