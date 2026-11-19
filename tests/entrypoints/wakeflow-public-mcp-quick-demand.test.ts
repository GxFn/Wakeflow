import { deepEqual, equal, notEqual, ok, rejects } from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { executePrepareDeliveryRequest } from "../../src/capabilities/delivery/service.js";
import { executeDemandCompletionRequest } from "../../src/capabilities/demand/lifecycle.js";
import { executeDemandCreationRequest } from "../../src/capabilities/demand/service.js";
import { executeStatusRequest } from "../../src/capabilities/observation/service.js";
import { executeBoardInspectionRequest } from "../../src/capabilities/requirement/service.js";
import { executeTargetTaskPlanningPublicRequest } from "../../src/capabilities/tasking/service.js";
import { createQuickDemandExecutor } from "../../src/entrypoints/wakeflow-public-mcp-quick-demand.js";
import { isWakeflowError } from "../../src/kernel/error.js";
import { CODEX_OBSERVATION_FACADE } from "../capabilities/observation/observation-facade.fixture.js";
import { CODEX_DELIVERY_FACADE } from "../governance/delivery/delivery-workspace.fixture.js";
import {
  cleanupAcceptedDemandCompletionWorkspaceFixture,
  createAcceptedDemandCompletionWorkspaceFixture,
} from "../governance/lifecycle/demand-completion-service.fixture.js";
import { PLANNING_REPOSITORY_ID } from "../governance/tasking/target-task-planning-service.fixture.js";
import { useDisposableDurability } from "../support/disposable-durability.js";

/** 公共结果是无原型的 JSON 快照：比较前落成普通对象。 */
function plain(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

useDisposableDurability();

/**
 * 2 级（能力，入口层的组合）：快速 Demand（ADR-0029 决定 9，open-items K9，1.4 第 4 段）。一句话加一个仓库：
 * 预览零写并给出生成的两份文档；确认之后一次调用走完发布、认领、规划、准备投递，回来的是可以直接发送的
 * 投递许可。限制是结构性的（工作区空闲、仓库在配置里）；计划与确认的内容不符被拒；原样重放不产生第二份。
 */

const CONTEXT = Object.freeze({ signal: new AbortController().signal, writer: null });
const CONFIRMED_AT = "2026-11-18T08:00:00.000Z";

const quickDemand = createQuickDemandExecutor({
  inspectBoard: executeBoardInspectionRequest,
  createDemand: executeDemandCreationRequest,
  planTargetTask: executeTargetTaskPlanningPublicRequest,
  prepareDelivery: (value, context) =>
    executePrepareDeliveryRequest(CODEX_DELIVERY_FACADE, value, { signal: context.signal }),
});

type Fixture = Awaited<ReturnType<typeof createAcceptedDemandCompletionWorkspaceFixture>>;

/** 把夹具里那个已接受的 Demand 完成并归档：留下一个窗口都已登记、此刻空闲的工作区。 */
async function archiveFixtureDemand(fixture: Fixture): Promise<void> {
  const request = { root: fixture.workspacePath, demandId: fixture.demandId };
  const preview = await executeDemandCompletionRequest({ ...request, mode: "preview" });
  if (preview.kind !== "WakeflowDemandCompletionPreview" || preview.planDigest === null) {
    throw new Error("Expected a ready completion preview.");
  }
  await executeDemandCompletionRequest({
    ...request,
    mode: "apply",
    planDigest: preview.planDigest,
  });
}

function quickRequest(fixture: Fixture, overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    root: fixture.workspacePath,
    mode: "preview",
    repositoryId: PLANNING_REPOSITORY_ID,
    title: "README 加一行安装说明",
    request: "在 README 的开头加一行安装命令。\n# 这一行不是标题",
    doneWhen: ["README 开头有一行安装命令", "别的文件没有改动"],
    ...overrides,
  };
}

test("预览零写并给出生成的需求包；工作区正忙、仓库不在配置里各是阻塞项；确认之后一次调用走完四步，重放不产生第二份", {
  timeout: 180_000,
}, async () => {
  const fixture = await createAcceptedDemandCompletionWorkspaceFixture({ coverAllCriteria: true });
  try {
    // 夹具的 Demand 还在进行：主 pod 正忙，快速 Demand 不可用。
    const busy = await quickDemand(quickRequest(fixture), CONTEXT);
    if (busy.kind !== "WakeflowQuickDemandPreview") throw new Error("Expected a preview.");
    equal(busy.status, "blocked");
    equal(busy.planDigest, null);
    deepEqual(busy.blockers, [`pod-busy:${fixture.demandId}`]);
    equal(busy.next.owner, "controller");

    await archiveFixtureDemand(fixture);
    const ledger = path.join(fixture.fixtureRoot, "wakeflow-ledger", "requirements");
    const packagesBefore = readdirSync(ledger).sort();

    const unknown = await quickDemand(
      quickRequest(fixture, {
        repositoryId: "repository_99999999-9999-4999-8999-999999999999",
      }),
      CONTEXT,
    );
    if (unknown.kind !== "WakeflowQuickDemandPreview") throw new Error("Expected a preview.");
    deepEqual(unknown.blockers, ["repository-unknown"]);

    const preview = await quickDemand(quickRequest(fixture), CONTEXT);
    if (preview.kind !== "WakeflowQuickDemandPreview") throw new Error("Expected a preview.");
    equal(preview.status, "ready", JSON.stringify(preview.blockers));
    equal(preview.next.owner, "user");
    equal(preview.next.suggestedTool, "wakeflow_quick_demand");
    deepEqual(plain(preview.summary.criteria), [
      { itemId: "ac-1", text: "README 开头有一行安装命令" },
      { itemId: "ac-2", text: "别的文件没有改动" },
    ]);
    deepEqual(preview.summary.steps, ["publish", "claim", "plan", "prepare"]);
    // 生成的需求文档只有固定的那几个章节：一句话里以 # 开头的行被转义，没有变成章节。
    const headings = preview.summary.requirement.split("\n").filter((line) => line.startsWith("#"));
    equal(headings.length, 6, preview.summary.requirement);
    ok(preview.summary.requirement.includes("\n\\# 这一行不是标题\n"));
    ok(preview.summary.requirement.includes("- AC-2 别的文件没有改动"));
    ok(preview.summary.landing.includes("controller-only"));
    // 预览没有发布任何东西：账本里的需求包还是原来那些。
    deepEqual(readdirSync(ledger).sort(), packagesBefore);

    // 没有确认、或确认的不是这份计划：拒绝，什么都不写。
    await rejects(
      quickDemand(
        quickRequest(fixture, { mode: "apply", planDigest: preview.planDigest }),
        CONTEXT,
      ),
      (error: unknown) => isWakeflowError(error) && error.code === "invalid-request",
    );
    await rejects(
      quickDemand(
        quickRequest(fixture, {
          mode: "apply",
          planDigest: preview.planDigest,
          confirmation: { confirmedAt: CONFIRMED_AT },
          title: "换了一个标题",
        }),
        CONTEXT,
      ),
      (error: unknown) => isWakeflowError(error) && error.reason === "plan-drift",
    );

    const apply = quickRequest(fixture, {
      mode: "apply",
      planDigest: preview.planDigest,
      confirmation: { confirmedAt: CONFIRMED_AT },
    });
    const applied = await quickDemand(apply, CONTEXT);
    if (applied.kind !== "WakeflowQuickDemandMutation") throw new Error("Expected a mutation.");
    equal(applied.status, "prepared", JSON.stringify(applied.steps));
    equal(applied.stoppedAt, null);
    deepEqual(
      applied.steps.map((entry) => [entry.step, entry.status]),
      [
        ["publish", "published"],
        ["claim", "created"],
        ["plan", "committed"],
        ["prepare", "committed"],
      ],
    );
    notEqual(applied.demandId, fixture.demandId);
    const delivery = applied.delivery as {
      readonly permit: { readonly prompt: string };
      readonly next: unknown;
    };
    ok(delivery.permit.prompt.includes("在 README 的开头加一行安装命令。"), delivery.permit.prompt);
    deepEqual(plain(applied.next), plain(delivery.next));
    // 需求仍然是一份两个文档的需求包，就在账本里；Demand 是普通的 Demand。
    const packageRoot = path.join(ledger, applied.requirementId ?? "");
    equal(
      readFileSync(path.join(packageRoot, "requirement.md"), "utf8"),
      preview.summary.requirement,
    );
    equal(readFileSync(path.join(packageRoot, "landing.md"), "utf8"), preview.summary.landing);
    const status = await executeStatusRequest(CODEX_OBSERVATION_FACADE, {
      root: fixture.workspacePath,
      demandId: applied.demandId ?? "",
    });
    // 投递已经准备好：路由停在"把许可发出去并记下结局"这一步。
    equal(status.route?.disposition, "work-available");
    equal(status.next.subject?.targetTaskId, applied.targetTaskId);

    // 同一次确认原样重放：每一步都重放，不产生第二份需求包、第二个 Demand 或第二份投递。
    const replayed = await quickDemand(apply, CONTEXT);
    if (replayed.kind !== "WakeflowQuickDemandMutation") throw new Error("Expected a mutation.");
    equal(replayed.status, "prepared", JSON.stringify(replayed.steps));
    equal(replayed.requirementId, applied.requirementId);
    equal(replayed.demandId, applied.demandId);
    equal(replayed.targetTaskId, applied.targetTaskId);
    deepEqual(
      replayed.steps.map((entry) => entry.status),
      ["current", "current", "idempotent", "idempotent"],
    );
  } finally {
    await cleanupAcceptedDemandCompletionWorkspaceFixture(fixture);
  }
});
