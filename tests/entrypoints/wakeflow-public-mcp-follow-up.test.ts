import { deepEqual, equal, rejects } from "node:assert/strict";
import { test } from "node:test";

import { executeDemandCompletionRequest } from "../../src/capabilities/demand/lifecycle.js";
import { executeImplementationReviewDecisionRequest } from "../../src/capabilities/result-review/service.js";
import { executeTargetTaskPlanningPublicRequest } from "../../src/capabilities/tasking/service.js";
import { withFollowUp } from "../../src/entrypoints/wakeflow-public-mcp-follow-up.js";
import { isWakeflowError } from "../../src/kernel/error.js";
import {
  CODEX_REVIEW_FACADE,
  cleanupControllerImplementationReviewDecisionServiceFixture,
  createControllerImplementationReviewDecisionServiceFixture,
  currentFixtureStreamRevision,
  REVIEW_DECIDED_AT,
  REVIEW_DECISION_UUID,
} from "../governance/review/controller-implementation-review-decision-service.fixture.js";
import { useDisposableDurability } from "../support/disposable-durability.js";

useDisposableDurability();

/**
 * 2 级（能力，入口层的组合）：接受上一份并续接下一份，一次调用（ADR-0029 决定 10，1.4 第 4 段）。accept 的
 * 请求带着 `thenPlan` 时，决定落账之后接着规划下一个目标；整次调用可以原样重放；规划被拒时 accept 仍然
 * 成立、拒绝随结果交回；别的决定带 `thenPlan` 在记下任何东西之前就被拒。谱系规则由规划自己把关。
 */

const CONTEXT = Object.freeze({ signal: new AbortController().signal, writer: null });

const decideThenPlan = withFollowUp(
  (value, context) =>
    executeImplementationReviewDecisionRequest(CODEX_REVIEW_FACADE, value, {
      clock: () => REVIEW_DECIDED_AT,
      uuidFactory: () => REVIEW_DECISION_UUID,
      signal: context.signal,
    }),
  { plan: executeTargetTaskPlanningPublicRequest, complete: executeDemandCompletionRequest },
);

type Fixture = Awaited<
  ReturnType<typeof createControllerImplementationReviewDecisionServiceFixture>
>;

/** 同一仓库的下一份任务包：续接刚被接受的那个目标。 */
function nextPackage(fixture: Fixture, lineage: unknown) {
  return {
    ...fixture.request.taskPackage,
    objective: "在已接受的切片上补一个只读查询",
    lineage,
  };
}

test("accept 带着 thenPlan：决定落账，下一个目标随即规划好，next 从规划继续；原样重放两步都重放", async () => {
  const fixture = await createControllerImplementationReviewDecisionServiceFixture();
  try {
    const before = await currentFixtureStreamRevision(fixture);
    const request = {
      ...fixture.decisionRequest,
      thenPlan: {
        taskPackage: nextPackage(fixture, {
          kind: "continuation",
          continuesTargetTaskId: fixture.targetTaskId,
        }),
      },
    };
    const decided = await decideThenPlan(request, CONTEXT);
    equal(decided.status, "committed");
    equal(decided.target.phase, "accepted");
    equal(decided.thenPlan?.status, "planned", JSON.stringify(decided.thenPlan));
    const planning = decided.thenPlan?.planning as {
      readonly status: string;
      readonly targetTask: { readonly targetTaskId: string; readonly lineage: unknown };
      readonly event: { readonly streamRevision: number };
      readonly next: unknown;
    };
    equal(planning.status, "committed");
    deepEqual(
      { ...(planning.targetTask.lineage as object) },
      { kind: "continuation", continuesTargetTaskId: fixture.targetTaskId },
    );
    // 下一步说的是规划之后的那一刻：准备新目标的投递。
    deepEqual(decided.next, planning.next);
    equal(decided.next.frontier, "implementation-delivery-planning");
    equal(decided.next.subject?.targetTaskId, planning.targetTask.targetTaskId);
    const after = await currentFixtureStreamRevision(fixture);
    equal(after, planning.event.streamRevision);
    equal(after > before + 1, true, "one decision commit and one planning commit");

    // 同一个键、同一个请求体：决定与规划都重放，流不再前进。
    const replayed = await decideThenPlan(request, CONTEXT);
    equal(replayed.status, "idempotent");
    equal(replayed.thenPlan?.status, "planned");
    const replayedPlanning = replayed.thenPlan?.planning as { readonly status: string } | undefined;
    equal(replayedPlanning?.status, "idempotent");
    equal(await currentFixtureStreamRevision(fixture), after);
  } finally {
    await cleanupControllerImplementationReviewDecisionServiceFixture(fixture);
  }
});

test("别的决定带 thenPlan 在记账之前被拒；规划被拒时 accept 仍然成立，拒绝随结果交回，之后用规划工具重交", async () => {
  const fixture = await createControllerImplementationReviewDecisionServiceFixture();
  try {
    const before = await currentFixtureStreamRevision(fixture);
    const withoutLineage = { taskPackage: nextPackage(fixture, null) };
    await rejects(
      decideThenPlan(
        { ...fixture.decisionRequest, decision: "rework", thenPlan: withoutLineage },
        CONTEXT,
      ),
      (error: unknown) =>
        isWakeflowError(error) &&
        error.code === "invalid-request" &&
        error.reason === "then-plan-requires-accept" &&
        error.path === "$request.thenPlan",
    );
    equal(await currentFixtureStreamRevision(fixture), before, "nothing was recorded");

    // 没有声明谱系的下一份包：规划拒绝它，但 accept 已经记下。
    const decided = await decideThenPlan(
      { ...fixture.decisionRequest, thenPlan: withoutLineage },
      CONTEXT,
    );
    equal(decided.status, "committed");
    equal(decided.target.phase, "accepted");
    equal(decided.thenPlan?.status, "refused");
    const refusal = decided.thenPlan?.error as { readonly code: string; readonly reason: string };
    equal(refusal.code, "precondition-failed", JSON.stringify(refusal));
    equal(refusal.reason, "lineage-continuation-required", JSON.stringify(refusal));
    equal("planning" in (decided.thenPlan ?? {}), false);
    // 决定自己的 next 原样保留：还没有新的目标。
    equal(decided.next.subject?.streamRevision, await currentFixtureStreamRevision(fixture));

    // 改好任务包后走规划工具本身。
    const planned = await executeTargetTaskPlanningPublicRequest(
      {
        root: fixture.workspacePath,
        demandId: fixture.demandId,
        idempotencyKey: "follow-up-plan-corrected",
        expectedStreamRevision: await currentFixtureStreamRevision(fixture),
        taskPackage: nextPackage(fixture, {
          kind: "continuation",
          continuesTargetTaskId: fixture.targetTaskId,
        }),
      },
      CONTEXT,
    );
    equal(planned.status, "committed");
  } finally {
    await cleanupControllerImplementationReviewDecisionServiceFixture(fixture);
  }
});

test("accept 带着 thenComplete：完成的预览没有阻塞项就在同一次调用里完成并归档；有阻塞项时 accept 成立、原因交回", async () => {
  const complete = await createControllerImplementationReviewDecisionServiceFixture({
    coverAllCriteria: true,
  });
  try {
    const decided = await decideThenPlan(
      { ...complete.decisionRequest, thenComplete: true },
      CONTEXT,
    );
    equal(decided.status, "committed");
    equal(decided.target.phase, "accepted");
    equal(decided.thenComplete?.status, "completed", JSON.stringify(decided.thenComplete));
    const completion = decided.thenComplete?.completion as
      | { readonly disposition: string; readonly demandId: string; readonly next: unknown }
      | undefined;
    equal(completion?.disposition, "completed");
    equal(completion?.demandId, complete.demandId);
    // 下一步从完成的结果继续：这个 Demand 已经归档，没有它的下一步了。
    deepEqual(
      JSON.parse(JSON.stringify(decided.next)),
      JSON.parse(JSON.stringify(completion?.next)),
    );
  } finally {
    await cleanupControllerImplementationReviewDecisionServiceFixture(complete);
  }

  // 需求还有一条验收标准没有被任何已接受的锚点覆盖：完成的门不放行，accept 照样记下。
  const partial = await createControllerImplementationReviewDecisionServiceFixture();
  try {
    await rejects(
      decideThenPlan(
        {
          ...partial.decisionRequest,
          thenComplete: true,
          thenPlan: { taskPackage: nextPackage(partial, null) },
        },
        CONTEXT,
      ),
      (error: unknown) =>
        isWakeflowError(error) &&
        error.code === "invalid-request" &&
        error.reason === "then-plan-and-then-complete",
    );
    await rejects(
      decideThenPlan(
        { ...partial.decisionRequest, decision: "rework", thenComplete: true },
        CONTEXT,
      ),
      (error: unknown) =>
        isWakeflowError(error) && error.reason === "then-complete-requires-accept",
    );
    const decided = await decideThenPlan(
      { ...partial.decisionRequest, thenComplete: true },
      CONTEXT,
    );
    equal(decided.status, "committed");
    equal(decided.target.phase, "accepted");
    equal(decided.thenComplete?.status, "blocked", JSON.stringify(decided.thenComplete));
    equal((decided.thenComplete?.blockers ?? []).length > 0, true);
    equal("completion" in (decided.thenComplete ?? {}), false);
    // Demand 仍在进行：流修订就是决定之后的那一刻。
    equal(decided.next.subject?.streamRevision, await currentFixtureStreamRevision(partial));
  } finally {
    await cleanupControllerImplementationReviewDecisionServiceFixture(partial);
  }
});
