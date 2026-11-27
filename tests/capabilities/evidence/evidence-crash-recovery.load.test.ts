import { deepEqual, equal, ok } from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { executeRecordEvidenceRequest } from "../../../src/capabilities/evidence/service.js";
import {
  executeStatusRequest,
  executeVerifyRequest,
} from "../../../src/capabilities/observation/service.js";
import { executeCodexWakeflowMaintenance } from "../../../src/entrypoints/codex-wakeflow-maintenance.js";
import { isWakeflowError } from "../../../src/kernel/error.js";
import {
  cleanupManagedEvidenceCapturePlanningWorkspaceFixture,
  createManagedEvidenceCapturePlanningWorkspaceFixture,
  fileSelection,
} from "../../governance/evidence-publication/managed-evidence-capture-planning-service.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import { loadSensitive } from "../../support/load-sensitive.js";
import { startSyncCrashProcess } from "../../support/sync-crash-process.js";
import { CODEX_OBSERVATION_FACADE } from "../observation/observation-facade.fixture.js";

/**
 * 级别 2（能力），真实进程：证据记录的 apply 在各个落盘点被 SIGKILL（open-items L10，§13.293）。
 *
 * 证据没有扫点文件，被打断之后的指路此前只有"拒绝长什么样"的测试。这里起一个真实的 MCP 服务，在 apply
 * 进行到 Demand 根里第 N 次落盘时杀掉它，然后只跟着 status 点名的工具收场——点的是维护就先对账（事件
 * 追加的候选由它结算），点的是 `wakeflow_record_evidence` 就 recover——之后同一份选择再 apply 要么记下、
 * 要么已经记下，verify 的证据完整性门通过。逐点往后扫，直到 apply 在屏障之前就完成为止。
 *
 * 这份扫点第一次跑就找出两条死路（日志、暂存树的清单各自"已链接、创建暂存还没删"的那一刻，recover 自己
 * 读不下去）和一处接管（服务停在屏障上、还活着，另一个进程的 recover 把这次记录接过去做完）。前者改成
 * recover 先结算死暂存；后者改成记录与 recover 共用一把锁——这里在服务还活着的时候调 recover，必须被
 * 拒绝为可重试的冲突。
 */

// 本进程里的夹具、收场与重做不付 fsync；被杀的是另起的真实 MCP 进程，它照生产的耐久性落盘。
useDisposableDurability();

const SELECTION = fileSelection("artifacts/test-run/logs/report.txt");
const MAXIMUM_POINTS = 64;

type Outcome = Awaited<ReturnType<typeof executeRecordEvidenceRequest>>;

/** 调用的结局：成功时是处置，被拒时是 `code/reason`（可重试的带 `!`）。 */
async function settled(call: Promise<Outcome>): Promise<string> {
  try {
    const result = await call;
    if (result.kind !== "WakeflowRecordEvidenceMutation") throw new Error("Expected a mutation.");
    return result.disposition;
  } catch (error: unknown) {
    if (isWakeflowError(error)) {
      return `${error.code}/${error.reason}${error.retryable ? "!" : ""}`;
    }
    throw error;
  }
}

/** 跟着 status 点名的工具走，直到这个 Demand 不再是待恢复；返回走过的工具。 */
async function followStatus(root: string, demandId: string): Promise<readonly string[]> {
  const route: string[] = [];
  for (let step = 0; step < 4; step += 1) {
    const { next } = await executeStatusRequest(CODEX_OBSERVATION_FACADE, { root, demandId });
    if (next.frontier !== "demand-recovery") return route;
    route.push(`${next.suggestedTool}:${next.blockers.join(",")}`);
    if (next.suggestedTool === "wakeflow_maintain_workspace") {
      const request = { root, action: "reconcile", request: {} } as const;
      const preview = await executeCodexWakeflowMaintenance({ ...request, mode: "preview" });
      if (preview.mode !== "preview" || preview.planDigest === null) {
        throw new Error("Expected a ready recovery plan from reconcile.");
      }
      await executeCodexWakeflowMaintenance({
        ...request,
        mode: "apply",
        planDigest: preview.planDigest,
      });
    } else {
      equal(next.suggestedTool, "wakeflow_record_evidence");
      const recovered = await settled(
        executeRecordEvidenceRequest({ root, demandId, mode: "recover" }),
      );
      ok(["healthy", "recovered", "retired"].includes(recovered), recovered);
    }
  }
  throw new Error(`status still names demand-recovery after: ${route.join(" -> ")}`);
}

test("证据 apply 在 Demand 根里的每一次落盘之后被杀：跟着 status 点名的工具收场，之后同一份选择记得下；服务还活着时 recover 被拒", {
  timeout: 600_000,
}, async (t) => {
  if (loadSensitive(t, "a real MCP process is killed at each durable point of an evidence apply")) {
    return;
  }
  const seen: string[] = [];
  let refusedWhileRunning = 0;
  for (let occurrence = 1; occurrence <= MAXIMUM_POINTS; occurrence += 1) {
    const fixture = await createManagedEvidenceCapturePlanningWorkspaceFixture();
    const root = fixture.publication.workspacePath;
    const request = { root, demandId: fixture.demandId };
    const child = await startSyncCrashProcess(
      path.join(fixture.publication.fixtureRoot, "barrier"),
      `/${fixture.demandId}`,
      occurrence,
    );
    try {
      const call = child.client.callTool({
        name: "wakeflow_record_evidence",
        arguments: { ...request, mode: "apply", selection: SELECTION },
      });
      call.catch(() => undefined);
      if (!(await child.paused(call))) {
        // apply 在第 `occurrence` 次落盘之前就做完了：扫到头了。
        equal((await call).isError, undefined);
        break;
      }
      // 服务停在屏障上、还活着：这是一次还在跑的记录。每隔几个点试一次，免得每个点都等满锁的预算。
      // recover 要么被锁挡住，要么（记录已经出了锁、只剩刷新页面）发现没有东西要恢复；绝不接管。
      if (occurrence % 4 === 2) {
        const whileRunning = await settled(
          executeRecordEvidenceRequest({ ...request, mode: "recover" }),
        );
        ok(
          ["concurrency-conflict/evidence-lock-timeout!", "healthy"].includes(whileRunning),
          `point ${occurrence}: ${whileRunning}`,
        );
        if (whileRunning !== "healthy") refusedWhileRunning += 1;
      }
      child.crash();
      const route = await followStatus(root, fixture.demandId);
      const again = await settled(
        executeRecordEvidenceRequest({ ...request, mode: "apply", selection: SELECTION }),
      );
      seen.push(`${occurrence}: ${route.join(" -> ") || "(nothing pending)"} => ${again}`);
      ok(["recorded", "already-recorded"].includes(again), seen.at(-1));
      // 夹具不是完整初始化的工作区（本地布局等门本来就不过），这里只看与证据和 Demand 根有关的门。
      const verified = await executeVerifyRequest(CODEX_OBSERVATION_FACADE, { root });
      deepEqual(
        verified.gates
          .filter((gate) =>
            ["evidence-integrity", "demand-root-audit", "append-candidates-clear"].includes(
              gate.name,
            ),
          )
          .map((gate) => `${gate.name}:${gate.status}`),
        ["append-candidates-clear:pass", "demand-root-audit:pass", "evidence-integrity:pass"],
        seen.at(-1),
      );
    } finally {
      await child.close();
      await cleanupManagedEvidenceCapturePlanningWorkspaceFixture(fixture);
    }
  }
  t.diagnostic(seen.join("\n"));
  ok(seen.length >= 8, "the sweep crossed the durable points of an evidence apply");
  ok(seen.length < MAXIMUM_POINTS, "the sweep reached the end of the apply");
  ok(refusedWhileRunning >= 2, "a recover was refused while the apply held the lock");
});
