import { deepEqual, equal } from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { inspectDemandEventSourcingRootInventory } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-root-inventory.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { TaskPackageProjectionStore } from "../../../src/governance/tasking/task-package-projection-store.js";
import { FIXTURE_REQUIREMENT_MARKDOWN } from "../../governance/ledger/requirement-package.fixture.js";
import {
  cleanupTargetTaskPlanningWorkspaceFixture,
  createTargetTaskPlanningWorkspaceFixture,
  planFixtureTargetTask,
  type TargetTaskPlanningWorkspaceFixture,
} from "../../governance/tasking/target-task-planning-service.fixture.js";

/**
 * 自定义 Unicode 章节锚点的接受面：需求包正文带 "## 性能约束" 时，任务包引用该锚点
 * 被接受并原样记录（拒绝面见 service.test.ts 的 section-anchor-unknown 用例）。
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

test("需求包含自定义 Unicode 章节 性能约束 时，引用该锚点的任务包被接受并记录锚点", async () => {
  const fixture = await createTargetTaskPlanningWorkspaceFixture({
    requirementMarkdown: `${FIXTURE_REQUIREMENT_MARKDOWN}\n## 性能约束\n\n响应在 200ms 内。\n`,
  });
  try {
    const before = await withDemandRoot(
      fixture,
      async (root) => (await inspectDemandEventSourcingRootInventory(root)).commitCount,
    );
    const draft = fixture.request.taskPackage;
    if (draft.workType !== "implementation") throw new Error("Expected an implementation draft.");
    const committed = await planFixtureTargetTask(fixture, {
      taskPackage: { ...draft, sectionAnchors: ["性能约束"] },
    });
    equal(committed.status, "committed");
    equal(committed.event.streamRevision, before + 1);
    const after = await withDemandRoot(
      fixture,
      async (root) => (await inspectDemandEventSourcingRootInventory(root)).commitCount,
    );
    equal(after, before + 1);
    const taskPackage = await withDemandRoot(
      fixture,
      async (root) =>
        (
          await new TaskPackageProjectionStore(root).load(committed.targetTask.taskPackageId, {
            expectedTaskPackageDigest: parseSha256Digest(
              committed.taskPackageProjection.taskPackageDigest,
            ),
          })
        ).taskPackage,
    );
    if (taskPackage.workType !== "implementation")
      throw new Error("Expected an implementation package.");
    deepEqual(taskPackage.sectionAnchors, ["性能约束"]);
  } finally {
    await cleanupTargetTaskPlanningWorkspaceFixture(fixture);
  }
});
