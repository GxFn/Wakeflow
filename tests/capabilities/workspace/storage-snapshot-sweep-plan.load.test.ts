import { deepEqual } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { test } from "node:test";

import { WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME } from "../../../src/capabilities/tasking/contract.js";
import {
  cleanupTargetTaskPlanningWorkspaceFixture,
  createTargetTaskPlanningWorkspaceFixture,
} from "../../governance/tasking/target-task-planning-service.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import { loadSensitive } from "../../support/load-sensitive.js";
import {
  healedAfterStatusRefusalOf,
  ledgerRootOf,
  lockFamiliesOf,
  lockResidueOf,
  runSnapshotSweep,
  SNAPSHOT_SWEEP_READER_LEASE,
  type SnapshotSweepOutcome,
  type SnapshotSweepScope,
  type SnapshotSweepStuckRow,
  signpostedRecoveryOf,
  snapshotSweepAllPoints,
  snapshotSweepResidueRows,
  snapshotSweepRowDiagnostics,
  snapshotSweepSpan,
  snapshotSweepStuckRows,
  stuckRowsOf,
  summarizeSnapshotSweep,
  sweptIndicesOf,
  unsignpostedRecoveryOf,
  withinSweptPoints,
} from "../../support/snapshot-sweep-harness.js";
import type { SnapshotSweepSeamCall } from "../../support/snapshot-sweep-process.js";

/**
 * 级别 2（能力），真实进程：快照扫点（1.4.1 第 1 段清单 2.4 第 2 步），共享操作作用域里的一次 Demand 事件追加。
 *
 * 子进程经真实 MCP 入口规划一份实现任务包（读者租约 L2、闩锁 L1、事件追加、索引与快照、任务包投影、投影锁
 * L3），每经过一次变更接缝拷一份快照（`tests/support/snapshot-sweep-process.ts`）；本进程逐份摆回原处，跑只读的
 * `wakeflow_status{demandId}`、一条变更跟进、再一次 status，归为 healed、signposted-recovery、unsignposted-recovery
 * 或 stuck（`snapshot-sweep-harness.ts`）。变更跟进按快照在提交之前还是之后分开：事件链接进 `commits/` 之前，同一个
 * 请求、同一个幂等键再发一次，它要做完这次规划；链接之后重放只会返回第一次的结果、不追加，所以改发一份声明
 * `replacement` 的新任务包（场景链规划之后的同一步），它要在同一个 Demand 上真的追加一个新事件。规划没有
 * `mode: recover`，场景不提供恢复调用：有路标的出口是重试、维护的 recover 与公开的 reconcile，没有"没有路标的路"。
 *
 * 夹具工作区先建一个空的 Git 仓库，reconcile 才走得到它真正的结束（否则一律停在 `gitignore-git-repository`）。
 * 范围见 `snapshot-sweep-harness.ts`：`locks`（缺省）摆回 L1–L7 锁操作的前后，要求一份都不卡住；`all` 摆回每一份
 * 并加上内容同步之后的那些，断言卡住的恰好是显式表里的那些、走出口的恰好是出口表里的那些；两个范围都查
 * 治好之后的 L1–L7 锁残留。
 *
 * 摆回的是什么：每一个暂存、候选或树成员都在两个时刻摆回——排他新建刚返回、内容还没写的空文件，以及它被
 * 链接或改名之后；`all` 范围另在经接缝排他新建的每个文件内容同步之后摆回一次（内容完整、权限位已改、还没
 * 发布；序号是前一次接缝调用的序号加一位小数，例如 8.1 是写完并同步、还没链接进 `commits/` 的追加候选）。
 * 中间的状态——内容写了一半、写完还没改权限位，以及 `locks` 范围里内容同步之后的那一刻——不摆回；不同步内容
 * 的写入（这里的索引与快照暂存）也就没有那一份。不覆盖的：递归删除整棵目录树是一次接缝调用，删到一半的样子
 * 挂不到；快照只在接缝调用或那次内容同步成功之后取，进程死在一次系统调用中途不在内；掉电后目录项与内容乱序
 * 落盘也不在内（那是第 3 步的组合状态）。工作区的 `.git` 与产品检出不在快照集里，各份快照共用
 * （`snapshot-sweep-copy.ts`）。
 */

useDisposableDurability();

const DEMAND_ROOT = "workspace:.wakeflow-active/current/demand_<uuid>";

/**
 * 今天卡住的快照（`all` 范围），全部是事件追加之后、Demand 根清点
 * （`src/governance/demand/event-sourcing/demand-event-sourcing-root-inventory.ts`）不认的属主已死的残留：
 * - status 以 `precondition-failed/demand-inventory` 被拒（`src/capabilities/observation/service.ts:1162`，`issue`
 *   来自清点失败）；
 * - 变更跟进（提交之前重放，提交之后的替代包）以 `precondition-failed/authority-demand-authority` 被拒（原因理由
 *   `demand-authority`）：根权威的第一次清点失败
 *   （`src/governance/demand/event-sourcing/demand-event-sourcing-root-authority.ts:412`），操作权威上下文把它报成
 *   `demand-authority`（`src/governance/demand/demand-operation-authority-context.ts:199`），规划切片再加前缀
 *   （`src/capabilities/tasking/service.ts:156`）；拒绝不带 `retryable`，不重试；
 * - reconcile 走到它真正的结束：两次应用报 `completed`，第三次报 `no-op`（都在断言里）；这些应用做的是
 *   私有目录权限位与工作区 Git 仓库建好之后的收敛（回执未逐条核对），Demand 运行时恢复只认追加候选
 *   （`src/governance/demand/demand-runtime-recovery.ts`），没有一次碰这些残留。没有公开调用治好它们：status
 *   与跟进都只报清点失败，维护的 recover 没有可恢复的维护操作，规划没有 `mode: recover`。
 * 拒绝它们的是清点（`src/governance/demand/event-sourcing/demand-event-sourcing-root-inventory.ts`）：11：`index/`
 * 里的空暂存名不是提交文件名（`:592`）；12：索引刚链接、暂存未退役，双链接不合节点规则（`:208`，经 `:590`）；
 * 15：快照同样双链接（`:208`，经 `:576`；只剩暂存的 14 被容忍）；17、17.1：`artifacts/task-packages/` 里的暂存名
 * （`:511`；17.1 是内容已写完并同步的同一个暂存，结局相同）；18：双链接的任务包（`:208`，经 `:509`）。
 */
const STUCK_ON_TODAY: readonly SnapshotSweepStuckRow[] = snapshotSweepStuckRows(
  {
    status: "precondition-failed/demand-inventory",
    followUp: "precondition-failed/authority-demand-authority<-demand-authority",
    routes: ["maintenance:reconcile:ok(completed,completed,no-op)"],
    final:
      "status precondition-failed/demand-inventory; follow-up precondition-failed/authority-demand-authority<-demand-authority",
  },
  [
    [11, "openExclusive", `${DEMAND_ROOT}/event-sourcing/index/.wakeflow-atomic-create-m600.tmp`],
    [12, "link", `${DEMAND_ROOT}/event-sourcing/index/0000000000000002.json`],
    [15, "link", `${DEMAND_ROOT}/event-sourcing/snapshots/0000000000000002.json`],
    [
      17,
      "openExclusive",
      `${DEMAND_ROOT}/artifacts/task-packages/.wakeflow-atomic-create-m600.tmp`,
    ],
    [17.1, "sync", `${DEMAND_ROOT}/artifacts/task-packages/.wakeflow-atomic-create-m600.tmp`],
    [18, "link", `${DEMAND_ROOT}/artifacts/task-packages/task-package_<uuid>.json`],
  ],
);

/**
 * 今天走有路标的出口才恢复的快照（`all` 范围）：`[序号, 出口]`。8（刚新建的空追加候选）、8.1（同一个候选内容
 * 已写完并同步、还没链接进 `commits/`）、9（候选已链接到 `commits/`、还没退役）：status 与跟进同上被拒，公开
 * reconcile 三次应用都报 `completed`，其中一次恢复追加候选（与 `demand-runtime-recovery.test.ts` 的 candidate、
 * linked 两点同一条路；8 的空候选走"读不出提交就退役"一支，8.1 走"候选完整、目标不在就退役"一支，
 * `src/governance/demand/event-sourcing/demand-file-event-store.ts:507` 与 `:524`，后者此前没有快照到过），之后
 * 8、8.1 的重放做完规划、9 的替代包追加成功。
 */
const SIGNPOSTED_RECOVERY_ON_TODAY: readonly (readonly [number, string])[] = [
  [8, "maintenance:reconcile"],
  [8.1, "maintenance:reconcile"],
  [9, "maintenance:reconcile"],
];

/** 今天第一轮 status 被拒、变更跟进治好的快照（`all` 范围）：`[序号, status 的 code/reason]`。 */
const HEALED_AFTER_STATUS_REFUSAL_ON_TODAY: readonly (readonly [number, string])[] = [];

/**
 * 治好之后仍留着的 L1–L7 锁文件或锁暂存：`[路径, 个数, 序号]`（两个范围都断言，`locks` 只取摆回过的序号），
 * 是产品上的发现：子进程在 5 链接自己的读者租约（L2）、38 才删，每点留一个；死掉的读者租约只有独占获取才清
 * （排空时 `src/foundation/filesystem/rooted-read-write-scope.ts:285`），规划与替代包都是共享作用域。走 reconcile
 * 治好的 8、8.1、9 没有残留（维护拿独占作用域），卡住的点不查。带小数的序号是内容同步之后的点（`all` 才有）。
 */
const LOCK_RESIDUE_ON_TODAY: readonly (readonly [number, string, number])[] =
  snapshotSweepResidueRows([
    [
      SNAPSHOT_SWEEP_READER_LEASE,
      1,
      [5, 6, 7, 10, 13, 14, 16, ...snapshotSweepSpan(19, 37), 20.1, 25.1, 28.1, 31.1, 34.1],
    ],
  ]);

/** 事件链接进 `commits/` 的那一次接缝调用；它与之后的快照里事件已经提交。 */
function commitIndexOf(seam: readonly SnapshotSweepSeamCall[]): number {
  const commit = seam.find(
    (call) =>
      call.method === "link" &&
      call.paths.some((entry) => /\/event-sourcing\/commits\/[0-9]+\.json$/u.test(entry)),
  );
  if (commit === undefined) throw new Error("Expected the event commit link in the seam log.");
  return commit.index;
}

/** 在工作区根上建一个空的 Git 仓库（安静、不读全局的默认分支设置）。 */
function initializeSweepGitRepository(root: string): void {
  const initialized = spawnSync("git", ["-c", "init.defaultBranch=main", "init", "--quiet"], {
    cwd: root,
    encoding: "utf8",
    shell: false,
  });
  if (initialized.status !== 0) throw new Error("Cannot initialize the sweep workspace Git.");
}

/**
 * 摆回过的序号，按范围钉住（`sweptIndicesOf`）：`locks` 是第 0 份与 L1–L7 锁操作前后的那些，`all` 是每一份加上
 * 内容同步之后带小数的那些。一轮就治好的点不在上面任何一张表里，靠这里看住它们确实摆回过。
 */
const SWEPT_POINTS_ON_TODAY: Readonly<Record<SnapshotSweepScope, readonly number[]>> = {
  locks: [...snapshotSweepSpan(0, 7), ...snapshotSweepSpan(19, 22), 36, 37, 38],
  all: snapshotSweepAllPoints(38, [1.1, 4.1, 8.1, 17.1, 20.1, 25.1, 28.1, 31.1, 34.1]),
};

test("快照扫点：规划任务包的每一步之后进程死亡，下一条 status 与规划跟进照常完成或走点名的出口", {
  timeout: 600_000,
}, async (t) => {
  if (loadSensitive(t, "a real MCP child process and one restore per seam call")) return;
  const fixture = await createTargetTaskPlanningWorkspaceFixture();
  t.after(() => cleanupTargetTaskPlanningWorkspaceFixture(fixture));
  const root = realpathSync(fixture.workspacePath);
  // 夹具工作区不是 Git 仓库，reconcile 会一律停在 `gitignore-git-repository`；托管 `.gitignore` 的检查只要
  // 工作区根上有 `.git`（`src/workspace/managed-integration/wakeflow-gitignore-inspection.ts` 的
  // `assertGitRepositoryRoot`），不要提交。`.git` 不在快照集里，各份快照共用。
  initializeSweepGitRepository(root);
  const { demandId, taskPackage } = fixture.request;
  const plan = {
    name: WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME,
    arguments: {
      root,
      demandId,
      idempotencyKey: "sweep-plan",
      expectedStreamRevision: 1,
      taskPackage,
    },
  };
  const report = await runSnapshotSweep(t, {
    name: "plan-target-task",
    set: { workspace: root, ledger: ledgerRootOf(root) },
    calls: [plan],
    statusArguments: { root, demandId },
    async followUp(invoke, { index, seam, childResults }): Promise<SnapshotSweepOutcome> {
      if (index < commitIndexOf(seam)) return invoke(plan);
      const planned = childResults[0]?.targetTask as { readonly targetTaskId: string };
      const outcome = await invoke({
        name: WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME,
        arguments: {
          root,
          demandId,
          idempotencyKey: "sweep-plan-replacement",
          taskPackage: {
            ...taskPackage,
            objective: "改按更小的切片实现",
            lineage: { kind: "replacement", replacesTargetTaskId: planned.targetTaskId },
          },
        },
      });
      // 同一份摆回上替换追加成功之后扫点不再跑这条跟进（见驱动的文件头），所以不是 `committed` 就是没有追加。
      if (!outcome.ok || outcome.value.status === "committed") return outcome;
      return { ok: false, code: "no-append", reason: String(outcome.value.status), details: {} };
    },
  });
  t.diagnostic(summarizeSnapshotSweep(report));
  for (const line of snapshotSweepRowDiagnostics(report)) t.diagnostic(line);
  deepEqual(lockFamiliesOf(report.seam), [
    "L1 operation-scope latch and writer",
    "L2 reader leases",
    "L3 projector lock",
  ]);
  deepEqual(stuckRowsOf(report), report.scope === "locks" ? [] : STUCK_ON_TODAY);
  deepEqual(
    signpostedRecoveryOf(report),
    withinSweptPoints(report, SIGNPOSTED_RECOVERY_ON_TODAY, ([index]) => index),
  );
  // 规划没有 `mode: recover`，场景不提供恢复调用，所以没有"没有路标的路"可试。
  deepEqual(unsignpostedRecoveryOf(report), []);
  deepEqual(
    healedAfterStatusRefusalOf(report),
    withinSweptPoints(report, HEALED_AFTER_STATUS_REFUSAL_ON_TODAY, ([index]) => index),
  );
  deepEqual(
    lockResidueOf(report),
    withinSweptPoints(report, LOCK_RESIDUE_ON_TODAY, ([index]) => index),
  );
  // 放在最后：前面的表先各自比对，摆回的点对不上时再报这一条。
  deepEqual(sweptIndicesOf(report), SWEPT_POINTS_ON_TODAY[report.scope]);
});
