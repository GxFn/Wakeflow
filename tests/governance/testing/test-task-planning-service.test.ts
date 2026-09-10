import { deepEqual, equal, rejects } from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { parseWakeflowConfigV3 } from "../../../src/configuration/wakeflow-config-v3.js";
import { renderWakeflowConfigV3 } from "../../../src/configuration/wakeflow-config-v3-document.js";
import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { readDemandPostAcceptanceRoute } from "../../../src/governance/review/demand-post-acceptance-route.js";
import { taskPackageProjectionRef } from "../../../src/governance/tasking/task-package-projection-paths.js";
import { TaskPackageProjectionStore } from "../../../src/governance/tasking/task-package-projection-store.js";
import { isWakeflowError } from "../../../src/kernel/error.js";
import { createMinimalWakeflowConfigV3 } from "../../configuration/wakeflow-config-v3.fixture.js";
import {
  cleanupTestCardPlanningWorkspaceFixture,
  createTestCardPlanningWorkspaceFixture,
} from "./test-card-planning-service.fixture.js";
import {
  cleanupTestTaskPlanningWorkspaceFixture,
  createTestTaskPlanningWorkspaceFixture,
  planFixtureTestTask,
} from "./test-task-planning-service.fixture.js";

/**
 * test 任务包经 tasking 切片规划：从测试卡派生、投影落盘、路由前进到测试投递规划、
 * 同键重放幂等；并发相同请求收敛为一个事件；没有测试卡时拒绝。
 */

const ROLLED_BACK_TEST_TASK_CREATED_AT = parseUtcInstant("2026-08-29T12:19:00.000Z");
const TEST_TASK_EXPECTED_REVISION = 7;

async function withDemandRoot<Result>(
  workspacePath: string,
  demandId: string,
  use: (root: RootedDirectory) => Promise<Result>,
): Promise<Result> {
  const root = await RootedDirectory.open(
    path.join(workspacePath, ...demandFinalRootRef(demandId).split("/")),
  );
  try {
    return await use(root);
  } finally {
    await root.close();
  }
}

async function streamRevision(workspacePath: string, demandId: string): Promise<number> {
  return withDemandRoot(
    workspacePath,
    demandId,
    async (root) => (await new DemandEventSourcingRepository(root).audit()).aggregate.streamRevision,
  );
}

function rewriteConfig(workspacePath: string): void {
  const value = createMinimalWakeflowConfigV3();
  const program = value.program as Record<string, unknown>;
  program.displayName = "Changed after Test Task planning";
  writeFileSync(
    path.join(workspacePath, "wakeflow.config.json"),
    renderWakeflowConfigV3(parseWakeflowConfigV3(value)),
    { mode: 0o644 },
  );
}

test("test 任务包从测试卡派生、投影落盘、路由前进，同键重放不看后来的配置", async () => {
  const fixture = await createTestTaskPlanningWorkspaceFixture();
  try {
    const demandId = fixture.demandId;
    equal(await streamRevision(fixture.workspacePath, demandId), TEST_TASK_EXPECTED_REVISION);
    const planned = await planFixtureTestTask(fixture, TEST_TASK_EXPECTED_REVISION, {
      clock: () => ROLLED_BACK_TEST_TASK_CREATED_AT,
    });
    equal(planned.status, "committed");
    equal(planned.targetTask.workType, "test");
    if (planned.targetTask.workType !== "test") throw new Error("Expected a test target.");
    equal(planned.targetTask.targetTaskId, fixture.testCard.targetTaskId);
    equal(planned.targetTask.windowId, fixture.testCard.testWindowId);
    deepEqual(
      { ...planned.targetTask.testCard },
      { testCardId: fixture.testCard.testCardId, testCardDigest: fixture.testCard.testCardDigest },
    );
    equal(planned.taskPackageProjection.disposition, "created");
    equal(planned.next.frontier, "test-delivery-planning");
    const projectionPath = path.join(
      fixture.workspacePath,
      ...demandFinalRootRef(demandId).split("/"),
      ...taskPackageProjectionRef(planned.targetTask.taskPackageId).split("/"),
    );
    equal(existsSync(projectionPath), true);
    const taskPackage = await withDemandRoot(fixture.workspacePath, demandId, async (root) =>
      (
        await new TaskPackageProjectionStore(root).load(planned.targetTask.taskPackageId, {
          expectedTaskPackageDigest: parseSha256Digest(planned.taskPackageProjection.taskPackageDigest),
        })
      ).taskPackage,
    );
    if (taskPackage.workType !== "test") throw new Error("Expected a test TaskPackage.");
    equal(taskPackage.createdAt, ROLLED_BACK_TEST_TASK_CREATED_AT);
    equal(taskPackage.objective, fixture.testCard.question);
    deepEqual(taskPackage.acceptanceAnchors, []);
    deepEqual(
      taskPackage.selectedAuthorityRefs.map((reference) => reference.memberRef),
      [
        ...fixture.testCard.testBasisAuthorities.map((reference) => reference.memberRef),
        fixture.testCard.environmentAuthority.memberRef,
      ].sort(),
    );
    const route = await readDemandPostAcceptanceRoute(fixture.workspaceRoot, demandId);
    equal(route.nextStage.status, "test-delivery-planning");
    if (route.nextStage.status !== "test-delivery-planning") throw new Error("Expected test delivery planning.");
    equal(route.nextStage.testTask.taskPackageId, taskPackage.taskPackageId);

    rewriteConfig(fixture.workspacePath);
    const replayed = await planFixtureTestTask(fixture, TEST_TASK_EXPECTED_REVISION, {
      clock: () => ROLLED_BACK_TEST_TASK_CREATED_AT,
    });
    equal(replayed.status, "idempotent");
    equal(replayed.taskPackageProjection.disposition, "current");
    equal(await streamRevision(fixture.workspacePath, demandId), TEST_TASK_EXPECTED_REVISION + 1);
  } finally {
    await cleanupTestTaskPlanningWorkspaceFixture(fixture);
  }
});

test("并发相同 test 规划收敛为一个事件，随后同键重放为 idempotent", async () => {
  const fixture = await createTestTaskPlanningWorkspaceFixture();
  try {
    const settled = await Promise.allSettled([
      planFixtureTestTask(fixture, TEST_TASK_EXPECTED_REVISION),
      planFixtureTestTask(fixture, TEST_TASK_EXPECTED_REVISION),
    ]);
    equal(
      settled.some((entry) => entry.status === "fulfilled" && entry.value.status === "committed"),
      true,
    );
    equal((await planFixtureTestTask(fixture, TEST_TASK_EXPECTED_REVISION)).status, "idempotent");
    equal(await streamRevision(fixture.workspacePath, fixture.demandId), TEST_TASK_EXPECTED_REVISION + 1);
  } finally {
    await cleanupTestTaskPlanningWorkspaceFixture(fixture);
  }
});

test("没有测试卡时 test 规划被拒绝，且不追加事件", async () => {
  const withoutCard = await createTestCardPlanningWorkspaceFixture();
  try {
    const before = await streamRevision(withoutCard.workspacePath, withoutCard.demandId);
    await rejects(
      planFixtureTestTask(withoutCard, before),
      (error: unknown) =>
        isWakeflowError(error) &&
        error.code === "precondition-failed" &&
        error.reason === "test-authority",
    );
    equal(await streamRevision(withoutCard.workspacePath, withoutCard.demandId), before);
  } finally {
    await cleanupTestCardPlanningWorkspaceFixture(withoutCard);
  }
});
