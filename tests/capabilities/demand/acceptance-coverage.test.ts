import { equal } from "node:assert/strict";
import { test } from "node:test";
import {
  executeDemandCancellationRequest,
  executeDemandCompletionRequest,
} from "../../../src/capabilities/demand/lifecycle.js";
import { executeVerifyRequest } from "../../../src/capabilities/observation/service.js";
import {
  cleanupAcceptedDemandCompletionWorkspaceFixture,
  createAcceptedDemandCompletionWorkspaceFixture,
} from "../../governance/lifecycle/demand-completion-service.fixture.js";
import { FIXTURE_REQUIREMENT_MARKDOWN } from "../../governance/ledger/requirement-package.fixture.js";
import { CODEX_OBSERVATION_FACADE } from "../observation/observation-facade.fixture.js";
import {
  createControllerTestReviewDecisionServiceFixture,
  cleanupControllerTestReviewDecisionServiceFixture,
  decideFixtureTest,
} from "../../governance/review/controller-test-review-decision-service.fixture.js";

const TEN_CRITERIA = FIXTURE_REQUIREMENT_MARKDOWN.replace(
  /^- AC-2.*$/mu,
  Array.from(
    { length: 9 },
    (_, index) => `- AC-${index + 2} Independent criterion ${index + 2}.`,
  ).join("\n"),
);

test("真实环境：全部实现锚点已接受，但已通过的测试只覆盖两条标准时仍不能完成", {
  timeout: 120_000,
}, async () => {
  const fixture = await createControllerTestReviewDecisionServiceFixture({
    requirementMarkdown: TEN_CRITERIA,
    coverAllCriteria: true,
  });
  try {
    await decideFixtureTest(fixture);
    const result = await executeDemandCompletionRequest({
      root: fixture.workspacePath,
      demandId: fixture.demandId,
      mode: "preview",
    });
    if (result.kind !== "WakeflowDemandCompletionPreview") throw new Error("Expected preview.");
    equal(result.status, "blocked");
    equal(result.blockers.includes("verify:requirement-coverage:fail"), true);
    const verification = await executeVerifyRequest(CODEX_OBSERVATION_FACADE, {
      root: fixture.workspacePath,
      demandId: fixture.demandId,
    });
    equal(
      JSON.stringify(verification).includes("uncovered:8:ac-3,ac-4,ac-5,ac-6,ac-7,ac-8,ac-9,ac-10"),
      true,
    );
  } finally {
    await cleanupControllerTestReviewDecisionServiceFixture(fixture);
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
