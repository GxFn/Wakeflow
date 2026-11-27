import { deepEqual, equal, rejects } from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  executeStatusRequest,
  executeVerifyRequest,
} from "../../../src/capabilities/observation/service.js";
import { executeCodexWakeflowMaintenance } from "../../../src/entrypoints/codex-wakeflow-maintenance.js";
import { renderDeterministicJsonDocument } from "../../../src/foundation/data/deterministic-json-document.js";
import { DEMAND_LIFECYCLE_JOURNAL_KIND } from "../../../src/governance/demand/demand-interruption.js";
import { WakeflowError } from "../../../src/kernel/error.js";
import {
  demandFinalRootRef,
  WORKSPACE_MAINTENANCE_TRANSACTIONS_REF,
} from "../../../src/kernel/layout.js";
import {
  cleanupTargetTaskPlanningWorkspaceFixture,
  createTargetTaskPlanningWorkspaceFixture,
} from "../../governance/tasking/target-task-planning-service.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import {
  applyCompletion,
  applyContinuation,
  type LifecycleOrderCase,
  lifecycleOrderCase,
  recoverCompletion,
  renamedTo,
} from "../demand/lifecycle-order.fixture.js";
import { CODEX_OBSERVATION_FACADE } from "./observation-facade.fixture.js";

useDisposableDurability();

/**
 * 2 级（能力）：Demand 停在被打断的事务上时，status 与 verify 的下一步指向接手的 recover（1.4.1 段 1b，
 * 清单 2.2）。
 *
 * 状态经真实的服务造出（注入一次失败，或在根里手写一份恢复记录）。钉住四处：status 的 Demand 一行与
 * `nextActions`（不带标识也看得见，含根已退役的情形）；带标识的 status 的 `next`（根读得出才带 subject）；
 * verify 的 `next` 与"还留着的日志"那道门；以及不该指路的两种——什么记录都没有的打不开照旧拒绝，
 * 终态事件没有提交的旧日志不改变前沿。
 */

function status(scenario: LifecycleOrderCase, scoped: boolean) {
  return executeStatusRequest(CODEX_OBSERVATION_FACADE, {
    root: scenario.root,
    ...(scoped ? { demandId: scenario.demandId } : {}),
  });
}

function verify(scenario: LifecycleOrderCase) {
  return executeVerifyRequest(CODEX_OBSERVATION_FACADE, { root: scenario.root });
}

/** 结果里的对象没有原型；按字段比较。 */
function plain<Entry extends object>(entries: readonly Entry[]): Entry[] {
  return entries.map((entry) => ({ ...entry }));
}

function recoveryAction(scenario: LifecycleOrderCase, tool: string) {
  return { owner: "controller", tool, reason: "demand-recovery", subject: scenario.demandId };
}

async function assertVerifyNamesRecovery(scenario: LifecycleOrderCase, tool: string) {
  const verified = await verify(scenario);
  equal(verified.ok, false);
  equal(verified.next.frontier, "demand-recovery");
  equal(verified.next.owner, "controller");
  equal(verified.next.suggestedTool, tool);
  equal(
    verified.next.blockers.includes(`demand-recovery:${scenario.demandId}`),
    true,
    verified.next.blockers.join(","),
  );
  return verified;
}

function inRoot(scenario: LifecycleOrderCase, ...segments: string[]): string {
  return path.join(scenario.workspace, ...scenario.demandRoot.split("/"), ...segments);
}

test("终态事件已提交、根还在：Demand 一行、nextActions、带标识的 next 与 verify 都指向 complete 的 recover；治好之后回到归档的读法", async (t) => {
  const scenario = await lifecycleOrderCase(t);
  scenario.failAfterRename(renamedTo(scenario.claimState));
  await rejects(applyCompletion(scenario), (error: unknown) => error instanceof WakeflowError);

  const overview = await status(scenario, false);
  const row = overview.demands.find((demand) => demand.demandId === scenario.demandId);
  equal(row?.lifecycle, "completed");
  equal(row?.frontier, "demand-recovery");
  equal(row?.owner, "controller");
  equal(row?.suggestedTool, "wakeflow_complete_demand");
  deepEqual(plain(overview.nextActions.filter((action) => action.reason === "demand-recovery")), [
    recoveryAction(scenario, "wakeflow_complete_demand"),
  ]);

  const scoped = await status(scenario, true);
  equal(scoped.route === null, false);
  equal(scoped.next.frontier, "demand-recovery");
  equal(scoped.next.suggestedTool, "wakeflow_complete_demand");
  deepEqual(scoped.next.blockers, ["lifecycle-journal-pending"]);
  equal(scoped.next.subject?.demandId, scenario.demandId);
  equal(scoped.next.subject?.streamRevision, row?.streamRevision);

  const verified = await assertVerifyNamesRecovery(scenario, "wakeflow_complete_demand");
  const journals = verified.gates.find((gate) => gate.name === "append-candidates-clear");
  equal(journals?.status, "fail");
  equal(journals?.code, `journal:${scenario.demandId}`);

  await recoverCompletion(scenario);
  const healed = await status(scenario, true);
  equal(healed.archive?.outcome, "completed");
  equal(healed.next.frontier, "demand-continuation");
  equal(
    (await status(scenario, false)).nextActions.some(
      (action) => action.reason === "demand-recovery",
    ),
    false,
  );
});

test("根已改名退役、日志还在：不带标识的 status 也给出恢复动作；带标识的给归档与恢复，不带 subject；verify 指向同一个 recover", async (t) => {
  const scenario = await lifecycleOrderCase(t);
  scenario.failNextRemoveTree((target) => target === scenario.retiredRoot);
  await rejects(applyCompletion(scenario), (error: unknown) => error instanceof WakeflowError);

  const overview = await status(scenario, false);
  equal(
    overview.demands.some((demand) => demand.demandId === scenario.demandId),
    false,
    "退役根不是活动 Demand",
  );
  deepEqual(plain(overview.nextActions.filter((action) => action.reason === "demand-recovery")), [
    recoveryAction(scenario, "wakeflow_complete_demand"),
  ]);

  const scoped = await status(scenario, true);
  equal(scoped.route, null);
  equal(scoped.archive?.outcome, "completed");
  equal(scoped.next.frontier, "demand-recovery");
  equal(scoped.next.suggestedTool, "wakeflow_complete_demand");
  equal(scoped.next.subject, undefined);

  await assertVerifyNamesRecovery(scenario, "wakeflow_complete_demand");
});

test("续接事件已追加、认领还没回来：活动 Demand 的前沿让位给 continue 的 recover，路线照给", async (t) => {
  const scenario = await lifecycleOrderCase(t);
  await applyCompletion(scenario);
  scenario.failBeforeRename((destination) => destination === scenario.claimState);
  await rejects(applyContinuation(scenario), (error: unknown) => error instanceof WakeflowError);

  const overview = await status(scenario, false);
  const row = overview.demands.find((demand) => demand.demandId === scenario.demandId);
  equal(row?.lifecycle, "active");
  equal(row?.frontier, "demand-recovery");
  equal(row?.suggestedTool, "wakeflow_continue_demand");
  deepEqual(
    plain(overview.nextActions.filter((action) => action.subject === scenario.demandId)),
    [recoveryAction(scenario, "wakeflow_continue_demand")],
    "这个 Demand 自己的前沿不应再出现",
  );

  const scoped = await status(scenario, true);
  equal(scoped.route === null, false);
  equal(scoped.next.frontier, "demand-recovery");
  equal(scoped.next.suggestedTool, "wakeflow_continue_demand");
  equal(scoped.next.subject?.demandId, scenario.demandId);

  await assertVerifyNamesRecovery(scenario, "wakeflow_continue_demand");
});

test("打不开的根：留着证据事务时带标识的 status 不再拒绝，指向证据的 recover；什么记录都没有时照旧拒绝", async (t) => {
  const scenario = await lifecycleOrderCase(t);
  writeFileSync(inRoot(scenario, "stray.txt"), "x", { mode: 0o600 });
  await rejects(
    status(scenario, true),
    (error: unknown) =>
      error instanceof WakeflowError &&
      error.code === "precondition-failed" &&
      error.reason.startsWith("demand-"),
  );
  equal(
    (await status(scenario, false)).nextActions.some(
      (action) => action.reason === "demand-recovery",
    ),
    false,
  );

  writeFileSync(inRoot(scenario, "transactions", "managed-evidence-publication.json"), "{}\n", {
    mode: 0o600,
  });
  const overview = await status(scenario, false);
  const row = overview.demands.find((demand) => demand.demandId === scenario.demandId);
  equal(row?.status, "unavailable");
  equal(row?.frontier, "demand-recovery");
  equal(row?.suggestedTool, "wakeflow_record_evidence");
  const scoped = await status(scenario, true);
  equal(scoped.route, null);
  equal(scoped.archive, null);
  equal(scoped.next.frontier, "demand-recovery");
  equal(scoped.next.suggestedTool, "wakeflow_record_evidence");
  deepEqual(scoped.next.blockers, ["evidence-publication-pending"]);
  equal(scoped.next.subject, undefined);
  await assertVerifyNamesRecovery(scenario, "wakeflow_record_evidence");
});

test("维护占着工作区（留着维护的事务文件）：verify 的下一步是维护，不点 Demand 的恢复；status 仍列出恢复动作", {
  timeout: 60_000,
}, async () => {
  // 生命周期夹具的本地协议目录不是完整布局（协议读作 conflict），这里换用布局完整的规划夹具。
  const fixture = await createTargetTaskPlanningWorkspaceFixture({ freshBaseline: true });
  try {
    const root = fixture.workspacePath;
    const reconcile = { root, mode: "preview", action: "reconcile", request: {} };
    const converge = await executeCodexWakeflowMaintenance(reconcile);
    if (converge.mode !== "preview" || converge.planDigest === null)
      throw new Error("Expected fixture mode convergence.");
    await executeCodexWakeflowMaintenance({
      ...reconcile,
      mode: "apply",
      planDigest: converge.planDigest,
    });
    const demandId = fixture.request.demandId;
    writeFileSync(
      path.join(
        root,
        ...demandFinalRootRef(demandId).split("/"),
        "transactions",
        "managed-evidence-publication.json",
      ),
      "{}\n",
      { mode: 0o600 },
    );
    const named = await executeVerifyRequest(CODEX_OBSERVATION_FACADE, { root });
    equal(named.next.frontier, "demand-recovery", JSON.stringify(named.next));
    equal(named.next.suggestedTool, "wakeflow_record_evidence");
    equal(named.next.blockers.includes(`demand-recovery:${demandId}`), true);

    // 这时任何变更（含证据的 recover）都会被操作范围的维护保留挡下：先做的是维护。
    const transactions = path.join(root, ...WORKSPACE_MAINTENANCE_TRANSACTIONS_REF.split("/"));
    mkdirSync(transactions, { recursive: true, mode: 0o700 });
    writeFileSync(path.join(transactions, "left-behind"), "x", { mode: 0o600 });
    const verified = await executeVerifyRequest(CODEX_OBSERVATION_FACADE, { root });
    equal(verified.ok, false);
    equal(verified.next.frontier, "workspace-maintenance", JSON.stringify(verified.next));
    equal(verified.next.suggestedTool, "wakeflow_maintain_workspace");
    equal(
      verified.next.blockers.some((code) => code.startsWith("demand-recovery:")),
      false,
      verified.next.blockers.join(","),
    );
    const overview = await executeStatusRequest(CODEX_OBSERVATION_FACADE, { root });
    equal(overview.overall, "maintenance");
    equal(overview.maintenance.protocol, "recovery-required");
    deepEqual(plain(overview.nextActions.filter((action) => action.reason === "demand-recovery")), [
      {
        owner: "controller",
        tool: "wakeflow_record_evidence",
        reason: "demand-recovery",
        subject: demandId,
      },
    ]);
  } finally {
    await cleanupTargetTaskPlanningWorkspaceFixture(fixture);
  }
});

test("终态事件没有提交的旧日志与读不出的日志：前沿不变，verify 不把它算作还留着的日志", async (t) => {
  const scenario = await lifecycleOrderCase(t);
  const before = await status(scenario, true);
  const journal = path.join(scenario.workspace, scenario.journal);
  mkdirSync(path.dirname(journal), { recursive: true, mode: 0o700 });
  // 一份形状完整的完成日志，计划里的终态事件不在流里：Demand 还是活动的，这份日志只是没有生效的意图。
  // 把"有日志就点名"当成规则时，这一份会被点名；读不出的那一份不会。
  const stale = renderDeterministicJsonDocument({
    kind: DEMAND_LIFECYCLE_JOURNAL_KIND,
    schemaVersion: 1,
    plan: {
      action: "complete",
      demandId: scenario.demandId,
      eventId: "demand-event_99999999-9999-4999-8999-999999999999",
    },
    planDigest: `sha256:${"9".repeat(64)}`,
    verify: null,
  });
  for (const text of [stale, "garbage\n"]) {
    writeFileSync(journal, text, { mode: 0o600 });
    const scoped = await status(scenario, true);
    equal(scoped.next.frontier, before.next.frontier);
    equal(scoped.next.frontier === "demand-recovery", false);
    const overview = await status(scenario, false);
    equal(
      overview.nextActions.some((action) => action.reason === "demand-recovery"),
      false,
    );
    equal(
      overview.demands.find((demand) => demand.demandId === scenario.demandId)?.frontier ===
        "demand-recovery",
      false,
    );
    const verified = await verify(scenario);
    equal(verified.next.frontier === "demand-recovery", false);
    equal(
      verified.next.blockers.some((code) => code.startsWith("demand-recovery:")),
      false,
    );
    equal(verified.gates.find((gate) => gate.name === "append-candidates-clear")?.status, "pass");
  }
});
