import { equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { executeDemandCompletionRequest } from "../../../src/capabilities/demand/lifecycle.js";
import { executeRecordEvidenceRequest } from "../../../src/capabilities/evidence/service.js";
import {
  cleanupTargetTaskPlanningWorkspaceFixture,
  createTargetTaskPlanningWorkspaceFixture,
  PLANNING_RECORDED_AT,
  PLANNING_REPOSITORY_ID,
  planFixtureTargetTask,
} from "../../governance/tasking/target-task-planning-service.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";

useDisposableDurability();

/**
 * required-evidence 门（R4，§13.210，2 级）：任务包声明的证据种类缺席时，完成预览列出
 * `verify:required-evidence:fail`；记下该种类的受管证据后这条消失；没有任何包声明时不设此门。
 * 取消跳过它的规则在 `tests/capabilities/demand/decide.test.ts` 的纯决定里。
 */

const OPTIONS = { clock: () => PLANNING_RECORDED_AT, durability: "none" as const };

async function completionBlockers(root: string, demandId: string): Promise<readonly string[]> {
  const preview = await executeDemandCompletionRequest(
    { root, demandId, mode: "preview" },
    OPTIONS,
  );
  if (preview.kind !== "WakeflowDemandCompletionPreview") {
    throw new Error("Expected a completion preview.");
  }
  return preview.blockers;
}

function requiredEvidenceBlockers(blockers: readonly string[]): readonly string[] {
  return blockers.filter((blocker) => blocker.startsWith("verify:required-evidence"));
}

test("声明 commit 证据的实现包让完成预览报 required-evidence 失败，记录一条 commit 证据后这道门通过", {
  timeout: 120_000,
}, async () => {
  const fixture = await createTargetTaskPlanningWorkspaceFixture();
  try {
    const root = fixture.workspacePath;
    const demandId = fixture.request.demandId;
    // 还没有包：没有这道门。
    equal(requiredEvidenceBlockers(await completionBlockers(root, demandId)).length, 0);
    await planFixtureTargetTask(fixture, {
      taskPackage: { ...fixture.request.taskPackage, requiredEvidenceKinds: ["commit"] },
    });
    equal(
      requiredEvidenceBlockers(await completionBlockers(root, demandId)).join(","),
      ["verify:required-evidence:fail"].join(","),
    );

    const selection = {
      kind: "commit",
      source: { kind: "commit", repositoryId: PLANNING_REPOSITORY_ID, commitOid: "b".repeat(40) },
      contentReview: "reject",
    } as const;
    const previewed = await executeRecordEvidenceRequest(
      { root, demandId, selection, mode: "preview" },
      OPTIONS,
    );
    if (previewed.kind !== "WakeflowRecordEvidencePreview" || previewed.planDigest === null) {
      throw new Error(`Expected a ready evidence plan: ${JSON.stringify(previewed)}`);
    }
    const recorded = await executeRecordEvidenceRequest(
      { root, demandId, selection, mode: "apply", planDigest: previewed.planDigest },
      OPTIONS,
    );
    equal(recorded.kind, "WakeflowRecordEvidenceMutation");
    const after = await completionBlockers(root, demandId);
    equal(requiredEvidenceBlockers(after).length, 0, after.join(","));
    // 其余阻塞（目标尚未接受）仍在：这道门只管证据种类。
    ok(after.length > 0);
  } finally {
    await cleanupTargetTaskPlanningWorkspaceFixture(fixture);
  }
});
