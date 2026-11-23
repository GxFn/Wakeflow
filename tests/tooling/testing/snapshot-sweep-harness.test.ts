import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import { WAKEFLOW_STATUS_PUBLIC_TOOL_NAME } from "../../../src/capabilities/observation/contract.js";
import { WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME } from "../../../src/capabilities/workspace/maintain-workspace.js";
import {
  classifySnapshotSweepPoint,
  powerLossRecoveryResidueOf,
  powerLossVerdictsOf,
  recoveryResidueOf,
  refusalNamedRecovery,
  type SnapshotSweepCall,
  type SnapshotSweepOutcome,
  type SnapshotSweepPoint,
  type SnapshotSweepReport,
  type SnapshotSweepScenario,
  signpostedRecoveryOf,
  stageResidueOf,
  snapshotSweepPowerLossRows,
  statusNamedRecovery,
  statusNamedRecoveryOf,
  statusUnnamedOf,
  unsignpostedRecoveryOf,
} from "../../support/snapshot-sweep-harness.js";

/**
 * 级别 4（维护者工具）目录下的纯逻辑用例：快照扫点的归类规则自己（1.4.1 段 1b 的证明工具），不起子进程、
 * 不碰盘——公共工具由一个按脚本回答的替身扮演。钉住的是"只跟被点名的恢复"：没有 `details.tool` 的
 * `recovery-required` 不跟；点着别的 Demand 的不跟；拒绝点名与只有 status 点名分成两类；最多三跳；
 * 拒绝点了名又可重试时先走点名的；什么都没点名时才从重新摆回的盘面试，试出来的一律算没有路标；没有
 * 调用任何工具的跟进不算治好；跟进成功而 status 还点着恢复也不算治好；维护与 Demand 的恢复都被点着时
 * 先维护；证据的 recover 带 `demandId`。
 */

const TOOL = "wakeflow_complete_demand";
const EVIDENCE_TOOL = "wakeflow_record_evidence";
const DEMAND = "demand_11111111-1111-4111-8111-111111111111";
const OTHER = "demand_22222222-2222-4222-8222-222222222222";

function refusal(
  code: string,
  reason: string,
  details: Record<string, unknown> = {},
  retryable = false,
): SnapshotSweepOutcome {
  return { ok: false, code, reason, details, retryable };
}

const OK: SnapshotSweepOutcome = { ok: true, value: {} };

/** 替身的盘面：`healed` 之后变更跟进成功；`touched` 记一次变更跟进改过盘面（重新摆回会清掉）。 */
interface FakeDisk {
  healed: boolean;
  touched: boolean;
  /** 变更跟进跑过不止一次（发生过重试）。 */
  retried: boolean;
}

interface FakeWorkspace {
  /** 变更跟进在没治好时的拒绝。 */
  followUp(disk: FakeDisk): SnapshotSweepOutcome;
  /** status 的回答（缺省：成功、什么都不点名）。 */
  status?(disk: FakeDisk): SnapshotSweepOutcome;
  /** 场景工具的 `mode: recover`（缺省：治好）。 */
  recover?(disk: FakeDisk): SnapshotSweepOutcome;
  /** 变更跟进不调用任何工具就返回它的结局。 */
  silentFollowUp?: boolean;
  /** 维护工具（缺省：预览被阻塞，什么都不做）。 */
  maintenance?(disk: FakeDisk, call: Readonly<SnapshotSweepCall>): SnapshotSweepOutcome;
}

async function classify(workspace: FakeWorkspace, demandId: string | null = DEMAND) {
  const disk: FakeDisk = { healed: false, touched: false, retried: false };
  const calls: string[] = [];
  const invoke = async (call: Readonly<SnapshotSweepCall>): Promise<SnapshotSweepOutcome> => {
    if (call.name === WAKEFLOW_STATUS_PUBLIC_TOOL_NAME) {
      return workspace.status?.(disk) ?? OK;
    }
    if (call.name === WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME) {
      calls.push(`maintenance:${String(call.arguments.mode)}`);
      return workspace.maintenance?.(disk, call) ?? { ok: true, value: { status: "blocked" } };
    }
    if (call.arguments.mode === "recover") {
      const subject = call.arguments.operationId ?? `demandId=${String(call.arguments.demandId)}`;
      calls.push(`recover:${String(subject)}`);
      if (workspace.recover !== undefined) return workspace.recover(disk);
      disk.healed = true;
      return OK;
    }
    calls.push("follow-up");
    if (disk.healed) return OK;
    const refused = workspace.followUp(disk);
    disk.retried = disk.touched;
    disk.touched = true;
    return refused;
  };
  const scenario: SnapshotSweepScenario = {
    name: "fake",
    set: { workspace: "/fake-workspace", ledger: "/fake-ledger" },
    calls: [],
    statusArguments: demandId === null ? {} : { demandId },
    followUp: (call) =>
      workspace.silentFollowUp === true
        ? Promise.resolve(workspace.followUp(disk))
        : call({ name: TOOL, arguments: { mode: "apply" } }),
    recover: () => ({ name: TOOL, arguments: { mode: "recover", operationId: DEMAND } }),
    ...(demandId === null ? {} : { demandId: () => demandId }),
  };
  let restores = 0;
  const result = await classifySnapshotSweepPoint(
    invoke,
    scenario,
    { index: 1, seam: [], childResults: [] },
    () => {
      restores += 1;
      disk.healed = false;
      disk.touched = false;
      disk.retried = false;
    },
  );
  return { ...result, calls, restores };
}

const named = (operationId: string = DEMAND) =>
  refusal("recovery-required", "lifecycle-journal-pending", { tool: TOOL, operationId });

test("点名的判定：拒绝要带工具与对得上的操作标识；status 的下一步点着这个 Demand 或维护", () => {
  deepEqual(refusalNamedRecovery(named(), DEMAND), {
    tool: TOOL,
    operationId: DEMAND,
    parameter: "operationId",
  });
  equal(refusalNamedRecovery(named(OTHER), DEMAND), null);
  equal(refusalNamedRecovery(refusal("recovery-required", "x"), DEMAND), null);
  equal(refusalNamedRecovery(refusal("recovery-required", "x", { tool: TOOL }), DEMAND), null);
  equal(refusalNamedRecovery(refusal("precondition-failed", "x", { tool: TOOL }), DEMAND), null);
  equal(refusalNamedRecovery(refusal("recovery-required", "x", { tool: "rm -rf" }), DEMAND), null);
  // 证据的 recover 认 `demandId`：拒绝在 `details.demandId` 里给它，recover 就带这个参数；也要对得上。
  const evidence = (demandId: string) =>
    refusal("recovery-required", "evidence-publication-pending", { tool: EVIDENCE_TOOL, demandId });
  deepEqual(refusalNamedRecovery(evidence(DEMAND), DEMAND), {
    tool: EVIDENCE_TOOL,
    operationId: DEMAND,
    parameter: "demandId",
  });
  equal(refusalNamedRecovery(evidence(OTHER), DEMAND), null);
  // 维护工具不带操作标识：意思是对账。
  deepEqual(
    refusalNamedRecovery(
      refusal("recovery-required", "append-candidates-pending", {
        tool: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
      }),
      DEMAND,
    ),
    { tool: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME, operationId: null, parameter: "operationId" },
  );
  const status = (value: Record<string, unknown>): SnapshotSweepOutcome => ({ ok: true, value });
  const scoped = status({ next: { frontier: "demand-recovery", suggestedTool: TOOL } });
  deepEqual(statusNamedRecovery(scoped, DEMAND, true), {
    tool: TOOL,
    operationId: DEMAND,
    parameter: "operationId",
  });
  // 不带 Demand 标识问的 status：`next` 是整个工作区的下一步，不指这个 Demand。
  equal(statusNamedRecovery(scoped, DEMAND, false), null);
  // status 只给工具名：证据的 recover 带 `demandId`，其余带 `operationId`。
  deepEqual(
    statusNamedRecovery(
      status({ next: { frontier: "demand-recovery", suggestedTool: EVIDENCE_TOOL } }),
      DEMAND,
      true,
    ),
    { tool: EVIDENCE_TOOL, operationId: DEMAND, parameter: "demandId" },
  );
  deepEqual(
    statusNamedRecovery(
      status({ nextActions: [{ reason: "demand-recovery", subject: DEMAND, tool: TOOL }] }),
      DEMAND,
    ),
    { tool: TOOL, operationId: DEMAND, parameter: "operationId" },
  );
  equal(
    statusNamedRecovery(
      status({ nextActions: [{ reason: "demand-recovery", subject: OTHER, tool: TOOL }] }),
      DEMAND,
    ),
    null,
  );
  equal(
    statusNamedRecovery(
      status({ next: { frontier: "demand-recovery", suggestedTool: "rm -rf" } }),
      DEMAND,
      true,
    ),
    null,
  );
  // 工作区的下一步里出现"维护"不算点名（对照点上它就在）；维护一栏列着可恢复的操作才算。
  equal(
    statusNamedRecovery(
      status({
        next: { frontier: "workspace-maintenance" },
        nextActions: [
          { reason: "workspace-maintenance", tool: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME },
        ],
        maintenance: { residues: [{ operationId: null, recoverable: false }] },
      }),
      DEMAND,
      true,
    ),
    null,
  );
  deepEqual(
    statusNamedRecovery(
      status({ maintenance: { residues: [{ operationId: "operation_1", recoverable: true }] } }),
      DEMAND,
    ),
    {
      tool: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
      operationId: "operation_1",
      parameter: "operationId",
    },
  );
  // 维护协议停在 recovery-required 而没有可恢复的操作：点的是维护工具、不带操作标识（走 reconcile）；
  // 协议是 idle 或别的状态时不算。
  deepEqual(
    statusNamedRecovery(
      status({ maintenance: { protocol: "recovery-required", residues: [] } }),
      DEMAND,
    ),
    { tool: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME, operationId: null, parameter: "operationId" },
  );
  deepEqual(
    statusNamedRecovery(
      status({
        maintenance: {
          protocol: "recovery-required",
          residues: [{ operationId: "operation_1", recoverable: true }],
        },
      }),
      DEMAND,
    ),
    {
      tool: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
      operationId: "operation_1",
      parameter: "operationId",
    },
  );
  // 维护与 Demand 的恢复都被点着：先维护（维护占着工作区时 Demand 的 recover 会被挡下）。
  deepEqual(
    statusNamedRecovery(
      status({
        next: { frontier: "demand-recovery", suggestedTool: TOOL },
        nextActions: [{ reason: "demand-recovery", subject: DEMAND, tool: TOOL }],
        maintenance: { protocol: "recovery-required", residues: [] },
      }),
      DEMAND,
      true,
    ),
    { tool: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME, operationId: null, parameter: "operationId" },
  );
  for (const protocol of ["idle", "busy", "conflict", "bootstrap-prefix"]) {
    equal(statusNamedRecovery(status({ maintenance: { protocol, residues: [] } }), DEMAND), null);
  }
  equal(statusNamedRecovery(refusal("precondition-failed", "demand-inventory"), DEMAND), null);
});

test("掉电盘面的显式表按归类成组写，展开之后按位置的先后排好", () => {
  deepEqual(
    snapshotSweepPowerLossRows([
      ["healed", ["7~1", "56~10", "56~2", "8~1"]],
      ["signposted:tool:recover", ["17~1", "7~2", "56~1"]],
    ]),
    [
      ["7~1", "healed"],
      ["7~2", "signposted:tool:recover"],
      ["8~1", "healed"],
      ["17~1", "signposted:tool:recover"],
      ["56~1", "signposted:tool:recover"],
      ["56~2", "healed"],
      ["56~10", "healed"],
    ],
  );
});

test("拒绝点了名：跟一跳就治好，归有路标；status 有没有也点名单独记", async () => {
  const silent = await classify({ followUp: () => named() });
  deepEqual(silent.verdict, { kind: "signposted-recovery", route: `${TOOL}:recover` });
  deepEqual(silent.routes, [`${TOOL}:recover:refusal:ok`]);
  equal(silent.statusNamed, false);
  equal(silent.restores, 0);
  const both = await classify({
    followUp: () => named(),
    status: (disk) =>
      disk.healed
        ? OK
        : { ok: true, value: { next: { frontier: "demand-recovery", suggestedTool: TOOL } } },
  });
  equal(both.verdict.kind, "signposted-recovery");
  equal(both.statusNamed, true);
});

test("跟进成功而 status 还点着恢复：不算治好，照 status 再走一跳；证据的 recover 带 demandId", async () => {
  let recovered = false;
  const result = await classify({
    // 变更跟进本身一直成功（它不碰那份没收尾的事务）。
    followUp: () => OK,
    status: () =>
      recovered
        ? OK
        : {
            ok: true,
            value: { next: { frontier: "demand-recovery", suggestedTool: EVIDENCE_TOOL } },
          },
    recover: () => {
      recovered = true;
      return OK;
    },
  });
  deepEqual(result.verdict, { kind: "status-named-recovery", route: `${EVIDENCE_TOOL}:recover` });
  deepEqual(result.routes, [`${EVIDENCE_TOOL}:recover:status:ok`]);
  deepEqual(result.calls, ["follow-up", `recover:demandId=${DEMAND}`]);
  // 定下归类的那一轮只看 status：变更跟进在前一轮已经做成。
  equal(result.skipped, true);

  const never = await classify({
    followUp: () => OK,
    status: () => ({
      ok: true,
      value: { next: { frontier: "demand-recovery", suggestedTool: TOOL } },
    }),
    recover: () => OK,
  });
  equal(never.verdict.kind, "stuck");
  if (never.verdict.kind === "stuck") equal(never.verdict.code, "status-still-names-recovery");
});

test("没有点名的 recovery-required 与点着别的 Demand 的都不跟：只有重新摆回之后试出来的路，归没有路标", async () => {
  for (const refused of [refusal("recovery-required", "demand-publication"), named(OTHER)]) {
    const result = await classify({ followUp: () => refused });
    deepEqual(result.verdict, { kind: "unsignposted-recovery", route: `${TOOL}:recover` });
    deepEqual(result.routes, [
      "unsignposted:maintenance:reconcile:preview-blocked/status-blocked",
      `unsignposted:${TOOL}:recover:ok`,
    ]);
    equal(result.statusNamed, null);
    equal(result.restores, 2);
  }
});

test("只有 status 点了名：照着走通，归 status 点名的一类", async () => {
  const result = await classify({
    followUp: () => refusal("precondition-failed", "demand-authority-inventory"),
    status: (disk) =>
      disk.healed
        ? OK
        : {
            ok: true,
            value: { nextActions: [{ reason: "demand-recovery", subject: DEMAND, tool: TOOL }] },
          },
  });
  deepEqual(result.verdict, { kind: "status-named-recovery", route: `${TOOL}:recover` });
  deepEqual(result.routes, [`${TOOL}:recover:status:ok`]);
  equal(result.statusNamed, null);
});

test("两跳：先重试，重试之后的拒绝点了名；出口名用 > 连起来", async () => {
  let attempts = 0;
  const result = await classify({
    followUp: () => {
      attempts += 1;
      return attempts === 1
        ? refusal("concurrency-conflict", "claim-state-changed", {}, true)
        : named();
    },
  });
  deepEqual(result.verdict, { kind: "signposted-recovery", route: `retry>${TOOL}:recover` });
  deepEqual(result.routes, ["retry:retry:ok", `${TOOL}:recover:refusal:ok`]);
});

test("最多三跳：恢复调用每次都说成功、拒绝每次都再点名，三跳之后停下，归卡住", async () => {
  const result = await classify({
    followUp: () => named(),
    recover: () => OK,
  });
  equal(result.verdict.kind, "stuck");
  deepEqual(result.routes.slice(0, 3), [
    `${TOOL}:recover:refusal:ok`,
    `${TOOL}:recover:refusal:ok`,
    `${TOOL}:recover:refusal:ok`,
  ]);
  // 之后从重新摆回的盘面试的三条路都记着，并且都没走通。
  deepEqual(
    result.routes.slice(3).map((route) => route.split(":")[0]),
    ["unsignposted", "unsignposted", "unsignposted"],
  );
});

test("被点名的那一跳自己被拒：记下并停止点名的阶段", async () => {
  const result = await classify({
    followUp: () => named(),
    recover: () => refusal("precondition-failed", "demand-authority-inventory"),
  });
  equal(result.verdict.kind, "stuck");
  equal(result.routes[0], `${TOOL}:recover:refusal:precondition-failed/demand-authority-inventory`);
  equal(result.routes.filter((route) => route.includes(":refusal:")).length, 1);
});

test("拒绝既点了名又可重试：先走点名的那条，不先重试", async () => {
  const result = await classify({
    followUp: () => ({ ...named(), retryable: true }) as SnapshotSweepOutcome,
    // 重试会改盘面，改过之后恢复调用就失败：先重试的话这一点治不好。
    recover: (disk) => {
      if (disk.touched && disk.retried) return refusal("precondition-failed", "stream-advanced");
      disk.healed = true;
      return OK;
    },
  });
  deepEqual(result.verdict, { kind: "signposted-recovery", route: `${TOOL}:recover` });
  deepEqual(result.routes, [`${TOOL}:recover:refusal:ok`]);
});

test("重试只试一次；第一轮的 status 被拒时它点的名也算；没有调用任何工具的跟进不算治好", async () => {
  // 每次都可重试、从不点名：重试一次之后不再重试，最后靠重新摆回之后试出来的路。
  const retried = await classify({
    followUp: () => refusal("concurrency-conflict", "claim-state-changed", {}, true),
  });
  deepEqual(retried.routes.slice(0, 2), [
    "retry:retry:ok",
    "unsignposted:maintenance:reconcile:preview-blocked/status-blocked",
  ]);
  equal(retried.verdict.kind, "unsignposted-recovery");
  // 变更跟进的拒绝没点名，第一轮被拒的 status 点了名。
  const byStatusRefusal = await classify({
    followUp: () => refusal("precondition-failed", "demand-authority-inventory"),
    status: (disk) => (disk.healed ? OK : named()),
  });
  deepEqual(byStatusRefusal.verdict, { kind: "signposted-recovery", route: `${TOOL}:recover` });
  // 跟进一个工具都没调用就返回成功：这一轮记失败，不算治好。
  const silent = await classify({ followUp: () => OK, silentFollowUp: true });
  equal(silent.followUp, "follow-up-skipped/no-call");
  equal(silent.verdict.kind === "healed", false);
});

test("被点名的是维护：带操作标识是维护的 recover；status 列着可恢复的维护操作也是，并归 status 点名", async () => {
  const byRefusal = await classify({
    followUp: () =>
      refusal("recovery-required", "maintenance-recovery-required", {
        tool: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
        operationId: "operation_1",
      }),
    maintenance: (disk, call) => {
      if (call.arguments.mode === "recover") disk.healed = true;
      return OK;
    },
  });
  deepEqual(byRefusal.verdict, { kind: "signposted-recovery", route: "maintenance:recover" });
  deepEqual(byRefusal.calls, ["follow-up", "maintenance:recover", "follow-up"]);
  const byStatus = await classify({
    followUp: () => refusal("precondition-failed", "maintenance-gate-residue"),
    status: (disk) =>
      disk.healed
        ? OK
        : {
            ok: true,
            value: {
              maintenance: { residues: [{ operationId: "operation_2", recoverable: true }] },
            },
          },
    maintenance: (disk, call) => {
      if (call.arguments.mode === "recover") disk.healed = true;
      return OK;
    },
  });
  deepEqual(byStatus.verdict, { kind: "status-named-recovery", route: "maintenance:recover" });
});

test("被点名的是维护、没有操作标识：status 没列可恢复的维护操作就走对账，再由下一次拒绝点名恢复", async () => {
  let reconciled = false;
  const result = await classify({
    followUp: () =>
      reconciled
        ? named()
        : refusal("recovery-required", "append-candidates-pending", {
            tool: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
          }),
    maintenance: (_disk, call) => {
      if (call.arguments.mode === "preview") {
        return reconciled
          ? { ok: true, value: { status: "blocked" } }
          : { ok: true, value: { status: "ready", planDigest: "sha256:plan" } };
      }
      reconciled = true;
      return { ok: true, value: { status: "completed" } };
    },
  });
  deepEqual(result.verdict, {
    kind: "signposted-recovery",
    route: `maintenance:reconcile>${TOOL}:recover`,
  });
  deepEqual(result.calls, [
    "follow-up",
    "maintenance:preview",
    "maintenance:apply",
    "maintenance:preview",
    "follow-up",
    `recover:${DEMAND}`,
    "follow-up",
  ]);
});

test("钉表的取法：三类恢复各出各的行，status 没点名的、恢复记录残留与暂存残留单列", () => {
  const point = (index: number, extra: Partial<SnapshotSweepPoint>): SnapshotSweepPoint => ({
    index,
    method: "link",
    file: "workspace:x",
    verdict: { kind: "healed" },
    status: "ok",
    followUp: "ok",
    routes: [],
    skipped: false,
    statusNamed: null,
    residue: [],
    recoveryResidue: [],
    stageResidue: [],
    milliseconds: 0,
    ...extra,
  });
  const recover = `${TOOL}:recover`;
  const report: SnapshotSweepReport = {
    scenario: "fake",
    scope: "all",
    childResults: [],
    seam: [],
    points: [
      point(0, {}),
      point(1, { verdict: { kind: "signposted-recovery", route: recover }, statusNamed: true }),
      point(2, { verdict: { kind: "signposted-recovery", route: recover }, statusNamed: false }),
      point(3, { verdict: { kind: "status-named-recovery", route: "maintenance:reconcile" } }),
      point(4, { verdict: { kind: "unsignposted-recovery", route: recover } }),
      point(5, {
        recoveryResidue: ["workspace:.wakeflow-active/current/.retire-demand_<uuid>-<uuid>"],
        stageResidue: [
          ["workspace:.wakeflow-active/current/demand_<uuid>/event-sourcing/index/s", 2],
        ],
      }),
    ],
    powerLossPoints: [
      { ...point(7, {}), label: "7~1" },
      {
        ...point(9, {
          verdict: { kind: "signposted-recovery", route: recover },
          recoveryResidue: ["workspace:.wakeflow-active/current/lifecycle/demand_<uuid>.json"],
        }),
        label: "9~2",
      },
      {
        ...point(9, {
          verdict: {
            kind: "stuck",
            step: "follow-up",
            code: "precondition-failed",
            reason: "demand-authority-inventory",
            last: "",
          },
        }),
        label: "9~3",
      },
    ],
    childMilliseconds: 0,
    sweepMilliseconds: 0,
  };
  deepEqual(powerLossVerdictsOf(report), [
    ["7~1", "healed"],
    ["9~2", `signposted:${recover}`],
    ["9~3", "stuck:precondition-failed/demand-authority-inventory"],
  ]);
  deepEqual(powerLossRecoveryResidueOf(report), [
    ["9~2", "workspace:.wakeflow-active/current/lifecycle/demand_<uuid>.json"],
  ]);
  deepEqual(signpostedRecoveryOf(report), [
    [1, recover],
    [2, recover],
  ]);
  deepEqual(statusNamedRecoveryOf(report), [[3, "maintenance:reconcile"]]);
  deepEqual(unsignpostedRecoveryOf(report), [[4, recover]]);
  deepEqual(statusUnnamedOf(report), [[2, recover]]);
  deepEqual(recoveryResidueOf(report), [
    [5, "workspace:.wakeflow-active/current/.retire-demand_<uuid>-<uuid>"],
  ]);
  deepEqual(stageResidueOf(report), [
    [5, "workspace:.wakeflow-active/current/demand_<uuid>/event-sourcing/index/s", 2],
  ]);
});
