import { deepEqual, equal, rejects } from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { threadId } from "node:worker_threads";
import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { parseDemandEventCommitSequence } from "../../../src/governance/demand/event-sourcing/demand-event-stream-position.js";
import { executeCodexWakeflowMaintenance } from "../../../src/entrypoints/codex-wakeflow-maintenance.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import { demandEventAppendCandidateRef } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-paths.js";
import {
  cleanupTargetTaskPlanningWorkspaceFixture,
  createTargetTaskPlanningWorkspaceFixture,
  planFixtureTargetTask,
} from "../../governance/tasking/target-task-planning-service.fixture.js";
import { startAppendCrashProcess } from "../../support/append-crash-process.js";

async function preparePrivateModes(root: string) {
  const request = { root, mode: "preview", action: "reconcile", request: {} };
  const preview = await executeCodexWakeflowMaintenance(request);
  if (preview.mode !== "preview" || preview.planDigest === null)
    throw new Error("Expected fixture mode convergence.");
  await executeCodexWakeflowMaintenance({
    ...request,
    mode: "apply",
    planDigest: preview.planDigest,
  });
}

for (const point of ["candidate", "linked"] as const) {
  test(`真实 MCP 在 ${point} 落盘后死亡：只读预览、公开 reconcile 恢复、原请求幂等继续`, {
    timeout: 40_000,
  }, async () => {
    const fixture = await createTargetTaskPlanningWorkspaceFixture({ freshBaseline: true });
    await preparePrivateModes(fixture.workspacePath);
    const server = await startAppendCrashProcess(path.join(fixture.fixtureRoot, "barrier"), point);
    const demandPath = path.join(
      fixture.workspacePath,
      demandFinalRootRef(fixture.request.demandId),
    );
    const candidates = path.join(demandPath, "event-sourcing/append-candidates");
    const commits = path.join(demandPath, "event-sourcing/commits");
    try {
      const interrupted = rejects(
        server.client.callTool({
          name: "wakeflow_plan_target_task",
          arguments: {
            root: fixture.workspacePath,
            ...fixture.request,
            idempotencyKey: "crash-plan",
            expectedStreamRevision: 1,
          },
        }),
      );
      await server.paused();
      const candidateNames = readdirSync(candidates);
      const before = new Map(
        readdirSync(commits).map((name) => [name, readFileSync(path.join(commits, name))]),
      );
      const request = {
        root: fixture.workspacePath,
        mode: "preview",
        action: "reconcile",
        request: {},
      };
      const busy = await executeCodexWakeflowMaintenance(request);
      if (busy.mode !== "preview") throw new Error("Expected preview.");
      equal(busy.status, "blocked");
      equal(
        busy.blockerCodes.some((code) => code.startsWith("demand-candidates-busy:")),
        true,
      );
      deepEqual(readdirSync(candidates), candidateNames);
      server.crash();
      await interrupted;
      const preview = await executeCodexWakeflowMaintenance(request);
      if (preview.mode !== "preview" || preview.planDigest === null)
        throw new Error("Expected recovery preview.");
      equal(preview.status, "ready");
      deepEqual(readdirSync(candidates), candidateNames);
      equal(JSON.stringify(preview).includes(fixture.fixtureRoot), false);
      const recovered = await executeCodexWakeflowMaintenance({
        ...request,
        mode: "apply",
        planDigest: preview.planDigest,
      });
      equal(recovered.status, "completed");
      deepEqual(readdirSync(candidates), []);
      for (const [name, bytes] of before) deepEqual(readFileSync(path.join(commits, name)), bytes);
      const result = await planFixtureTargetTask(fixture, { idempotencyKey: "crash-plan" });
      equal(result.status, point === "linked" ? "idempotent" : "committed");
      equal(readdirSync(commits).length, 2);
    } finally {
      await server.close();
      await cleanupTargetTaskPlanningWorkspaceFixture(fixture);
    }
  });
}

test("reconcile 不删除无法归属的候选条目", async () => {
  const fixture = await createTargetTaskPlanningWorkspaceFixture({ freshBaseline: true });
  await preparePrivateModes(fixture.workspacePath);
  const stray = path.join(
    fixture.workspacePath,
    demandFinalRootRef(fixture.request.demandId),
    "event-sourcing/append-candidates/unknown",
  );
  try {
    writeFileSync(stray, "preserve me\n", { mode: 0o600 });
    const result = await executeCodexWakeflowMaintenance({
      root: fixture.workspacePath,
      mode: "preview",
      action: "reconcile",
      request: {},
    });
    if (result.mode !== "preview") throw new Error("Expected preview.");
    equal(result.status, "blocked");
    equal(existsSync(stray), true);
    equal(readFileSync(stray, "utf8"), "preserve me\n");
  } finally {
    await cleanupTargetTaskPlanningWorkspaceFixture(fixture);
  }
});

test("reconcile 沿用身份合同的字节预算，恢复合法大身份下的半写候选", {
  timeout: 120_000,
}, async () => {
  const fixture = await createTargetTaskPlanningWorkspaceFixture({
    identityText: "验".repeat(16_000),
  });
  await preparePrivateModes(fixture.workspacePath);
  const root = path.join(fixture.workspacePath, demandFinalRootRef(fixture.request.demandId));
  const candidate = path.join(
    root,
    demandEventAppendCandidateRef(
      parseDemandEventCommitSequence(2),
      parseWakeflowDurableIdOfKind(
        "demand-event-commit_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "demand-event-commit",
      ),
      `${process.pid}-${threadId}-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`,
    ),
  );
  try {
    equal(readFileSync(path.join(root, "identity.json")).length > 128 * 1024, true);
    writeFileSync(candidate, "{partial\n", { mode: 0o600 });
    const request = {
      root: fixture.workspacePath,
      mode: "preview",
      action: "reconcile",
      request: {},
    };
    const preview = await executeCodexWakeflowMaintenance(request);
    if (preview.mode !== "preview" || preview.planDigest === null)
      throw new Error("Expected recovery preview.");
    equal(preview.status, "ready");
    await executeCodexWakeflowMaintenance({
      ...request,
      mode: "apply",
      planDigest: preview.planDigest,
    });
    equal(existsSync(candidate), false);
    equal(readdirSync(path.join(root, "event-sourcing/commits")).length, 1);
  } finally {
    await cleanupTargetTaskPlanningWorkspaceFixture(fixture);
  }
});
