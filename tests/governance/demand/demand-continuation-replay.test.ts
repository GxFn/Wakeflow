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
  type DemandAggregateState,
  parseDemandAggregateState,
} from "../../../src/governance/demand/model/demand-aggregate-state.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import {
  cleanupControllerTestReviewDecisionServiceFixture,
  createControllerTestReviewDecisionServiceFixture,
  decideFixtureTest,
} from "../review/controller-test-review-decision-service.fixture.js";

useDisposableDurability();

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

test("supplement 包随 requirement-supplement 续接并入（Q7 裁决）：事件带着它，状态按并入顺序累计；不带包的续接不改这张表，别的谱系不能带，同一个包不能并入两次", async () => {
  const completed = await completedStateWithAcceptedTest();
  const supplement = (digit: string) => ({
    requirementId: `requirement_${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`,
    recordRef: `requirements/requirement_${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}/record.json`,
    recordDigest: `sha256:${digit.repeat(64)}`,
  });
  const continueWith = (state: Readonly<DemandAggregateState>, continuation: Readonly<object>) => {
    const decided = decideDemandEventSourcingCommand(state, {
      commandType: "lifecycle.continue-demand",
      commandVersion: 1,
      eventId: CONTINUED_EVENT_ID,
      demandId: state.demandId,
      recordedAt: RECORDED_AT,
      continuation,
    });
    const event = decided[0];
    if (event?.eventType !== "lifecycle.demand-continued")
      throw new Error("continued event missing");
    return { event, state: evolveDemandEventSourcingState(state, event) };
  };
  const first = continueWith(completed, {
    ...CONTINUATION,
    kind: "requirement-supplement",
    supplement: supplement("1"),
  });
  // 事件数据是无原型对象：按 JSON 形状比较。
  deepEqual(JSON.parse(JSON.stringify(first.event.data.continuation.supplement)), supplement("1"));
  deepEqual(first.state.supplements, [supplement("1")]);
  equal(first.state.continuation?.kind, "requirement-supplement");

  // 再次完成后的续接：不带包的（任何谱系）保持这张表，带新包的接在后面。
  const completedAgain = parseDemandAggregateState({ ...first.state, lifecycle: "completed" });
  deepEqual(continueWith(completedAgain, CONTINUATION).state.supplements, [supplement("1")]);
  deepEqual(
    continueWith(completedAgain, {
      ...CONTINUATION,
      kind: "requirement-supplement",
      supplement: supplement("2"),
    }).state.supplements,
    [supplement("1"), supplement("2")],
  );
  // 1.3.0 之前的 requirement-supplement 续接没有包：重放不产生这张表，状态与摘要都是当时的。
  const legacy = evolveDemandEventSourcingState(
    completed,
    continuedEvent(completed, {
      continuation: { ...CONTINUATION, kind: "requirement-supplement" },
    }),
  );
  equal(legacy.supplements, undefined);
  equal(Object.hasOwn(legacy, "supplements"), false);

  // 别的谱系不能带包；同一个包（或同一份记录）不能并入两次。
  throws(() => continueWith(completed, { ...CONTINUATION, supplement: supplement("1") }));
  throws(() =>
    continueWith(completedAgain, {
      ...CONTINUATION,
      kind: "requirement-supplement",
      supplement: supplement("1"),
    }),
  );
  throws(() =>
    continueWith(completedAgain, {
      ...CONTINUATION,
      kind: "requirement-supplement",
      supplement: { ...supplement("2"), recordDigest: supplement("1").recordDigest },
    }),
  );
});
