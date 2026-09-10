import { deepEqual, equal, rejects } from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { inspectDemandEventSourcingRootInventory } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-root-inventory.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { TaskPackageProjectionStore } from "../../../src/governance/tasking/task-package-projection-store.js";
import { isWakeflowError } from "../../../src/kernel/error.js";
import {
  cleanupTargetTaskPlanningWorkspaceFixture,
  createTargetTaskPlanningWorkspaceFixture,
  planFixtureTargetTask,
  PLANNING_RECORDED_AT,
  type TargetTaskPlanningWorkspaceFixture,
} from "../../governance/tasking/target-task-planning-service.fixture.js";

/**
 * tasking 切片效果：一次追加、同键重放、同键异请求、过期修订、私有路径、非法键；
 * 发明的锚点、错误的记录摘要、未知章节锚点与错误拓扑被拒；replacement 让旧目标
 * superseded；需求包要求用户审阅时缺确认被拒、带确认写入包。
 */

async function withDemandRoot<Result>(
  fixture: Readonly<TargetTaskPlanningWorkspaceFixture>,
  use: (root: RootedDirectory) => Promise<Result>,
): Promise<Result> {
  const root = await RootedDirectory.open(
    path.join(fixture.workspacePath, ...demandFinalRootRef(fixture.request.demandId).split("/")),
  );
  try {
    return await use(root);
  } finally {
    await root.close();
  }
}

async function commitCount(fixture: Readonly<TargetTaskPlanningWorkspaceFixture>): Promise<number> {
  return withDemandRoot(
    fixture,
    async (root) => (await inspectDemandEventSourcingRootInventory(root)).commitCount,
  );
}

function implementationDraft(fixture: Readonly<TargetTaskPlanningWorkspaceFixture>) {
  const taskPackage = fixture.request.taskPackage;
  if (taskPackage.workType !== "implementation")
    throw new Error("Expected an implementation draft.");
  return taskPackage;
}

function rejectedWith(reason: string, code = "precondition-failed") {
  return (error: unknown) =>
    isWakeflowError(error) && error.code === code && error.reason === reason;
}

async function loadPackage(
  fixture: Readonly<TargetTaskPlanningWorkspaceFixture>,
  taskPackageId: string,
  digest: string,
) {
  return withDemandRoot(
    fixture,
    async (root) =>
      (
        await new TaskPackageProjectionStore(root).load(taskPackageId, {
          expectedTaskPackageDigest: parseSha256Digest(digest),
        })
      ).taskPackage,
  );
}

test("plan_target_task 一次调用追加规划事件并返回 next；重放、异请求、过期修订、隐私各有结局", async () => {
  const fixture = await createTargetTaskPlanningWorkspaceFixture();
  try {
    const before = await commitCount(fixture);
    await rejects(
      planFixtureTargetTask(fixture, {
        idempotencyKey: "plan-stale",
        expectedStreamRevision: before - 1,
      }),
      (error: unknown) =>
        isWakeflowError(error) &&
        error.code === "concurrency-conflict" &&
        error.path === "$request.expectedStreamRevision",
    );
    const committed = await planFixtureTargetTask(fixture);
    equal(committed.status, "committed");
    equal(committed.event.streamRevision, before + 1);
    equal(committed.targetTask.phase, "planned");
    if (committed.targetTask.workType !== "implementation")
      throw new Error("expected implementation");
    equal(committed.targetTask.lineage, null);
    equal(committed.taskPackageProjection.disposition, "created");
    equal(committed.next.frontier, "implementation-delivery-planning");
    equal(committed.next.suggestedTool, "wakeflow_prepare_implementation_delivery");
    equal(JSON.stringify(committed).includes(fixture.workspacePath), false);
    equal(await commitCount(fixture), before + 1);

    const replayed = await planFixtureTargetTask(fixture);
    equal(replayed.status, "idempotent");
    equal(replayed.event.eventId, committed.event.eventId);
    equal(replayed.taskPackageProjection.disposition, "current");

    const draft = implementationDraft(fixture);
    await rejects(
      planFixtureTargetTask(fixture, { taskPackage: { ...draft, objective: "改了目标" } }),
      rejectedWith("request-digest", "idempotency-mismatch"),
    );
    await rejects(
      planFixtureTargetTask(fixture, {
        idempotencyKey: "plan-private",
        expectedStreamRevision: before + 1,
        taskPackage: { ...draft, objective: `见 ${fixture.workspacePath}/notes.md` },
      }),
      (error: unknown) => isWakeflowError(error) && error.code === "privacy-violation",
    );
    await rejects(
      planFixtureTargetTask(fixture, { idempotencyKey: "bad key!" }),
      (error: unknown) => isWakeflowError(error) && error.code === "invalid-request",
    );
    equal(await commitCount(fixture), before + 1);
  } finally {
    await cleanupTargetTaskPlanningWorkspaceFixture(fixture);
  }
});

test("发明的锚点、错误的记录摘要、未知章节锚点、错误拓扑与多余的审阅确认都在追加前被拒", async () => {
  const fixture = await createTargetTaskPlanningWorkspaceFixture();
  try {
    const draft = implementationDraft(fixture);
    const [first] = draft.acceptanceAnchors;
    if (first === undefined) throw new Error("expected an anchor");
    const before = await commitCount(fixture);
    await rejects(
      planFixtureTargetTask(fixture, {
        taskPackage: {
          ...draft,
          acceptanceAnchors: [
            { ...first, requirementRef: { ...first.requirementRef, itemId: "ac-9" } },
          ],
        },
      }),
      rejectedWith("anchor-item-unknown"),
    );
    await rejects(
      planFixtureTargetTask(fixture, {
        taskPackage: {
          ...draft,
          acceptanceAnchors: [
            {
              ...first,
              requirementRef: { ...first.requirementRef, recordDigest: `sha256:${"f".repeat(64)}` },
            },
          ],
        },
      }),
      rejectedWith("anchor-record-drift"),
    );
    await rejects(
      planFixtureTargetTask(fixture, {
        taskPackage: { ...draft, sectionAnchors: ["goal", "missing-section"] },
      }),
      rejectedWith("section-anchor-unknown"),
    );
    await rejects(
      planFixtureTargetTask(fixture, {
        taskPackage: {
          ...draft,
          assignment: {
            ...draft.assignment,
            windowId: "window_00000000-0000-4000-8000-000000000000",
          },
        },
      }),
      rejectedWith("window-unknown"),
    );
    await rejects(
      planFixtureTargetTask(fixture, { planReview: { confirmedAt: "2026-09-09T10:00:00.000Z" } }),
      rejectedWith("task-plan-review-not-requested"),
    );
    equal(await commitCount(fixture), before);
  } finally {
    await cleanupTargetTaskPlanningWorkspaceFixture(fixture);
  }
});

test("同仓库第二个包必须声明 replacement：旧目标进入 superseded，路由只剩新目标", async () => {
  const fixture = await createTargetTaskPlanningWorkspaceFixture();
  try {
    const first = await planFixtureTargetTask(fixture);
    const draft = implementationDraft(fixture);
    await rejects(
      planFixtureTargetTask(fixture, {
        idempotencyKey: "plan-2",
        expectedStreamRevision: first.event.streamRevision,
        taskPackage: { ...draft, objective: "换一个更小的切片" },
      }),
      rejectedWith("lineage-replacement-required"),
    );
    const replacement = await planFixtureTargetTask(fixture, {
      idempotencyKey: "plan-2",
      expectedStreamRevision: first.event.streamRevision,
      taskPackage: {
        ...draft,
        objective: "换一个更小的切片",
        lineage: { kind: "replacement", replacesTargetTaskId: first.targetTask.targetTaskId },
      },
    });
    equal(replacement.status, "committed");
    if (replacement.targetTask.workType !== "implementation")
      throw new Error("expected implementation");
    deepEqual(
      { ...replacement.targetTask.lineage },
      {
        kind: "replacement",
        replacesTargetTaskId: first.targetTask.targetTaskId,
      },
    );
    equal(replacement.next.frontier, "implementation-delivery-planning");
    const targets = await withDemandRoot(fixture, async (root) => {
      const loaded = await new DemandEventSourcingRepository(root).load();
      if (loaded === null) throw new Error("expected an aggregate");
      return loaded.aggregate.state.targetTasks;
    });
    const superseded = targets.find(
      (target) => target.targetTaskId === first.targetTask.targetTaskId,
    );
    equal(superseded?.phase, "superseded");
    equal(
      superseded?.phase === "superseded" ? superseded.supersededByTargetTaskId : null,
      replacement.targetTask.targetTaskId,
    );
    equal(
      targets.find((target) => target.targetTaskId === replacement.targetTask.targetTaskId)?.phase,
      "planned",
    );
    const taskPackage = await loadPackage(
      fixture,
      replacement.targetTask.taskPackageId,
      replacement.taskPackageProjection.taskPackageDigest,
    );
    if (taskPackage.workType !== "implementation")
      throw new Error("expected implementation package");
    deepEqual(taskPackage.planReview, { reviewer: "controller" });
    equal(taskPackage.acceptanceAnchors[0]?.requirementRef.itemId, "ac-1");
  } finally {
    await cleanupTargetTaskPlanningWorkspaceFixture(fixture);
  }
});

test("需求包要求用户审阅任务清单时：缺确认被拒，带确认写入任务包", async () => {
  const fixture = await createTargetTaskPlanningWorkspaceFixture({ taskPlanReview: "user" });
  try {
    await rejects(planFixtureTargetTask(fixture), rejectedWith("task-plan-review-required"));
    const reviewed = await planFixtureTargetTask(fixture, {
      planReview: { confirmedAt: PLANNING_RECORDED_AT },
    });
    equal(reviewed.status, "committed");
    const taskPackage = await loadPackage(
      fixture,
      reviewed.targetTask.taskPackageId,
      reviewed.taskPackageProjection.taskPackageDigest,
    );
    if (taskPackage.workType !== "implementation")
      throw new Error("expected implementation package");
    deepEqual(taskPackage.planReview, { reviewer: "user", confirmedAt: PLANNING_RECORDED_AT });
  } finally {
    await cleanupTargetTaskPlanningWorkspaceFixture(fixture);
  }
});
