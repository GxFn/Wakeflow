import { deepEqual, equal, rejects } from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { executeTargetTaskPlanningPublicRequest } from "../../../src/capabilities/tasking/plan-target-task.js";
import { inspectDemandEventSourcingRootInventory } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-root-inventory.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { isWakeflowError } from "../../../src/kernel/error.js";
import {
  cleanupTargetTaskPlanningWorkspaceFixture,
  createTargetTaskPlanningWorkspaceFixture,
  PLANNING_RECORDED_AT,
} from "../../governance/tasking/target-task-planning-service.fixture.js";

/**
 * 追加型切片的 given-when-then：同一工作区上一次成功追加、同键重放、同键异请求、
 * 过期修订、请求含私有路径，五种结局各一条。
 */

async function commitCount(workspacePath: string, demandId: string): Promise<number> {
  const root = await RootedDirectory.open(
    path.join(workspacePath, ...demandFinalRootRef(demandId).split("/")),
  );
  try {
    return (await inspectDemandEventSourcingRootInventory(root)).commitCount;
  } finally {
    await root.close();
  }
}

test("plan_target_task 一次调用追加规划事件并返回 next", async () => {
  const fixture = await createTargetTaskPlanningWorkspaceFixture();
  try {
    const demandId = fixture.request.demandId;
    const before = await commitCount(fixture.workspacePath, demandId);
    const request = {
      root: fixture.workspacePath,
      demandId,
      idempotencyKey: "plan-1",
      expectedStreamRevision: before,
      taskPackage: fixture.request.taskPackage,
    };
    const options = { clock: () => PLANNING_RECORDED_AT };
    await rejects(
      executeTargetTaskPlanningPublicRequest(
        { ...request, idempotencyKey: "plan-stale", expectedStreamRevision: before - 1 },
        options,
      ),
      (error: unknown) =>
        isWakeflowError(error) &&
        error.code === "concurrency-conflict" &&
        error.path === "$request.expectedStreamRevision",
    );
    equal(await commitCount(fixture.workspacePath, demandId), before);
    const committed = await executeTargetTaskPlanningPublicRequest(request, options);
    equal(committed.status, "committed");
    equal(committed.kind, "WakeflowTargetTaskPlanningResult");
    equal(committed.demandId, demandId);
    equal(committed.event.streamRevision, before + 1);
    equal(committed.commit.commitSequence, before + 1);
    equal(committed.targetTask.phase, "planned");
    equal(committed.targetTask.workType, "implementation");
    equal(committed.taskPackageProjection.disposition, "created");
    equal(committed.next.frontier, "implementation-delivery-planning");
    equal(committed.next.owner, "controller");
    equal(committed.next.suggestedTool, "wakeflow_prepare_implementation_delivery");
    deepEqual(committed.next.blockers, []);
    equal(JSON.stringify(committed).includes(fixture.workspacePath), false);
    equal(await commitCount(fixture.workspacePath, demandId), before + 1);

    const replayed = await executeTargetTaskPlanningPublicRequest(request, options);
    equal(replayed.status, "idempotent");
    equal(replayed.event.eventId, committed.event.eventId);
    equal(replayed.commit.commitId, committed.commit.commitId);
    equal(replayed.stateDigest, committed.stateDigest);
    equal(replayed.taskPackageProjection.disposition, "current");
    equal(await commitCount(fixture.workspacePath, demandId), before + 1);

    await rejects(
      executeTargetTaskPlanningPublicRequest(
        { ...request, taskPackage: { ...request.taskPackage, objective: "改了目标" } },
        options,
      ),
      (error: unknown) =>
        isWakeflowError(error) &&
        error.code === "idempotency-mismatch" &&
        error.path === "$request.idempotencyKey",
    );
    await rejects(
      executeTargetTaskPlanningPublicRequest(
        {
          ...request,
          idempotencyKey: "plan-3",
          expectedStreamRevision: before + 1,
          taskPackage: {
            ...request.taskPackage,
            objective: `见 ${fixture.workspacePath}/notes.md`,
          },
        },
        options,
      ),
      (error: unknown) =>
        isWakeflowError(error) && error.code === "privacy-violation",
    );
    await rejects(
      executeTargetTaskPlanningPublicRequest({ ...request, idempotencyKey: "bad key!" }),
      (error: unknown) =>
        isWakeflowError(error) && error.code === "invalid-request",
    );
    equal(await commitCount(fixture.workspacePath, demandId), before + 1);
  } finally {
    await cleanupTargetTaskPlanningWorkspaceFixture(fixture);
  }
});
