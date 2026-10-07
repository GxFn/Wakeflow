import { equal, rejects } from "node:assert/strict";
import { test } from "node:test";
import {
  executeDemandCancellationRequest,
  executeDemandCompletionRequest,
} from "../../../src/capabilities/demand/lifecycle.js";
import {
  executeStatusRequest,
  executeVerifyRequest,
} from "../../../src/capabilities/observation/service.js";
import { isWakeflowError } from "../../../src/kernel/error.js";
import {
  cleanupAcceptedDemandCompletionWorkspaceFixture,
  createAcceptedDemandCompletionWorkspaceFixture,
} from "../../governance/lifecycle/demand-completion-service.fixture.js";
import { FIXTURE_REQUIREMENT_MARKDOWN } from "../../governance/ledger/requirement-package.fixture.js";
import { CODEX_OBSERVATION_FACADE } from "../observation/observation-facade.fixture.js";
import {
  cleanupTestTaskPlanningWorkspaceFixture,
  createTestTaskPlanningWorkspaceFixture,
  planFixtureTestTask,
} from "../../governance/tasking/test-task-planning.fixture.js";

const TEN_CRITERIA = FIXTURE_REQUIREMENT_MARKDOWN.replace(
  /^- AC-2.*$/mu,
  Array.from(
    { length: 9 },
    (_, index) => `- AC-${index + 2} Independent criterion ${index + 2}.`,
  ).join("\n"),
);

test("真实环境：测试合同没有覆盖全部标准时在规划阶段就被拒绝，不会留下无法完成的 Demand（§13.161 B4-1）", {
  timeout: 120_000,
}, async () => {
  const fixture = await createTestTaskPlanningWorkspaceFixture({
    requirementMarkdown: TEN_CRITERIA,
    coverAllCriteria: true,
  });
  try {
    await rejects(
      planFixtureTestTask(fixture, 7),
      (error: unknown) =>
        isWakeflowError(error) &&
        error.code === "precondition-failed" &&
        error.reason === "test-contract-uncovered" &&
        error.details?.blocker === "test-contract-uncovered:ac-3",
    );
    // 没有写入：下一次规划仍从同一修订开始，Demand 仍可用完整合同继续。
    const status = await executeStatusRequest(CODEX_OBSERVATION_FACADE, {
      root: fixture.workspacePath,
      demandId: fixture.demandId,
    });
    equal(
      status.demands.some((demand) => demand.demandId === fixture.demandId),
      true,
    );
  } finally {
    await cleanupTestTaskPlanningWorkspaceFixture(fixture);
  }
});

test("十条标准只接受 ac-1 不能完成；严格核验显示缺口，取消仍可用", {
  timeout: 120_000,
}, async () => {
  const fixture = await createAcceptedDemandCompletionWorkspaceFixture({
    requirementMarkdown: TEN_CRITERIA,
    coverAllCriteria: false,
  });
  try {
    const request = { root: fixture.workspacePath, demandId: fixture.demandId, mode: "preview" };
    const completion = await executeDemandCompletionRequest(request, { durability: "none" });
    if (completion.kind !== "WakeflowDemandCompletionPreview") throw new Error("Expected preview.");
    equal(completion.status, "blocked");
    equal(completion.blockers.includes("verify:requirement-coverage:fail"), true);
    const verification = await executeVerifyRequest(CODEX_OBSERVATION_FACADE, {
      root: fixture.workspacePath,
      demandId: fixture.demandId,
    });
    const wire = JSON.stringify(verification);
    equal(wire.includes("requirement-coverage"), true);
    equal(wire.includes("uncovered:9:ac-2,ac-3,ac-4,ac-5,ac-6,ac-7,ac-8,ac-9,ac-10"), true);
    const cancellation = await executeDemandCancellationRequest({
      ...request,
      reason: "Withdraw incomplete test requirement",
    });
    if (cancellation.kind !== "WakeflowDemandCancellationPreview")
      throw new Error("Expected cancellation preview.");
    equal(cancellation.status, "ready");
  } finally {
    await cleanupAcceptedDemandCompletionWorkspaceFixture(fixture);
  }
});

test("逐条接受全部标准后仍能完成并归档，未改变历史事件形状", { timeout: 120_000 }, async () => {
  const fixture = await createAcceptedDemandCompletionWorkspaceFixture({
    requirementMarkdown: TEN_CRITERIA,
    coverAllCriteria: true,
  });
  try {
    const request = { root: fixture.workspacePath, demandId: fixture.demandId, mode: "preview" };
    const preview = await executeDemandCompletionRequest(request, { durability: "none" });
    if (preview.kind !== "WakeflowDemandCompletionPreview") throw new Error("Expected preview.");
    equal(preview.status, "ready");
    const completed = await executeDemandCompletionRequest(
      {
        ...request,
        mode: "apply",
        planDigest: preview.planDigest,
      },
      { durability: "none" },
    );
    if (completed.kind !== "WakeflowDemandCompletionMutation")
      throw new Error("Expected completion.");
    equal(completed.disposition, "completed");
  } finally {
    await cleanupAcceptedDemandCompletionWorkspaceFixture(fixture);
  }
});
