import { deepEqual, equal, throws } from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  decideDemandEventSourcingCommand,
  evolveDemandEventSourcingState,
} from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-decider.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import {
  computeDemandAggregateStateDigest,
  currentTestTargetsOf,
  parseDemandAggregateState,
  type DemandAggregateState,
} from "../../../src/governance/demand/model/demand-aggregate-state.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import {
  cleanupControllerTestReviewDecisionServiceFixture,
  createControllerTestReviewDecisionServiceFixture,
  decideFixtureTest,
} from "../review/controller-test-review-decision-service.fixture.js";

const CONTINUED_EVENT_ID = "demand-event_18181818-1818-4818-8818-181818181818";
const RECORDED_AT = "2026-09-25T12:00:00.000Z";
const CONTINUATION = Object.freeze({
  kind: "optimization",
  summary: "Tighten the focused checks.",
  archiveRef: "archive/demands/fixture",
  archiveManifestDigest: `sha256:${"a".repeat(64)}`,
  previousStreamRevision: 2,
});

/** 已接受一个 test 目标的真实环境 Demand，按完成转换的结果标成 completed。 */
async function completedStateWithAcceptedTest(): Promise<Readonly<DemandAggregateState>> {
  const fixture = await createControllerTestReviewDecisionServiceFixture();
  try {
    const accepted = await decideFixtureTest(fixture);
    equal(accepted.target.phase, "test-accepted");
    const demandRoot = await RootedDirectory.open(
      path.join(fixture.workspacePath, ...demandFinalRootRef(fixture.demandId).split("/")),
    );
    try {
      const loaded = await new DemandEventSourcingRepository(demandRoot).load();
      if (loaded === null) throw new Error("demand stream missing");
      return parseDemandAggregateState({ ...loaded.aggregate.state, lifecycle: "completed" });
    } finally {
      await demandRoot.close();
    }
  } finally {
    await cleanupControllerTestReviewDecisionServiceFixture(fixture);
  }
}

function continuedEvent(state: Readonly<DemandAggregateState>, data: Readonly<object>) {
  return {
    eventId: CONTINUED_EVENT_ID,
    demandId: state.demandId,
    recordedAt: RECORDED_AT,
    eventType: "lifecycle.demand-continued",
    data,
  };
}

test("续接边界随事件持久化：旧形状的续接事件重放得到与当时完全相同的状态与摘要，新事件携带续接前的 test 目标", async () => {
  const completed = await completedStateWithAcceptedTest();
  const testTargetIds = completed.targetTasks
    .filter((target) => target.workType === "test")
    .map((target) => target.targetTaskId);
  equal(testTargetIds.length, 1);

  // 早期写入的事件没有历史字段：重放结果就是修复前归约器产生的状态，存量摘要不变。
  const replayed = evolveDemandEventSourcingState(
    completed,
    continuedEvent(completed, { continuation: CONTINUATION }),
  );
  const historicalShape = parseDemandAggregateState({
    ...completed,
    lifecycle: "active",
    continuation: { eventId: CONTINUED_EVENT_ID, kind: "optimization", planningRequired: true },
  });
  deepEqual(replayed, historicalShape);
  equal(
    computeDemandAggregateStateDigest(replayed),
    computeDemandAggregateStateDigest(historicalShape),
  );
  equal(replayed.continuation?.historicalTestTargetIds, undefined);

  // 续接决策从续接前状态算出边界并写进事件；归约器只照抄事件携带的边界。
  const decided = decideDemandEventSourcingCommand(completed, {
    commandType: "lifecycle.continue-demand",
    commandVersion: 1,
    eventId: CONTINUED_EVENT_ID,
    demandId: completed.demandId,
    recordedAt: RECORDED_AT,
    continuation: CONTINUATION,
  });
  const event = decided[0];
  if (event?.eventType !== "lifecycle.demand-continued") throw new Error("continued event missing");
  deepEqual(event.data.historicalTestTargetIds, testTargetIds);
  const continued = evolveDemandEventSourcingState(completed, event);
  deepEqual(continued.continuation?.historicalTestTargetIds, testTargetIds);
  deepEqual(currentTestTargetsOf(continued), []);

  // 事件携带的边界必须恰好是续接前的 test 目标集合。
  throws(() =>
    evolveDemandEventSourcingState(
      completed,
      continuedEvent(completed, {
        continuation: CONTINUATION,
        historicalTestTargetIds: ["target-task_19191919-1919-4919-8919-191919191919"],
      }),
    ),
  );
});
