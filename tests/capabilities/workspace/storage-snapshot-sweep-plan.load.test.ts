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
  powerLossLockResidueOf,
  powerLossRecoveryResidueOf,
  powerLossVerdictsOf,
  recoveryResidueOf,
  runSnapshotSweep,
  signpostedRecoveryOf,
  SNAPSHOT_SWEEP_READER_LEASE,
  snapshotSweepAllPoints,
  type SnapshotSweepOutcome,
  snapshotSweepResidueRows,
  snapshotSweepRowDiagnostics,
  type SnapshotSweepScope,
  snapshotSweepSpan,
  type SnapshotSweepStuckRow,
  stageResidueOf,
  statusNamedRecoveryOf,
  statusUnnamedOf,
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
 * `wakeflow_status{demandId}`、一条变更跟进、再一次 status，归为 healed、signposted-recovery、
 * status-named-recovery、unsignposted-recovery 或 stuck（`snapshot-sweep-harness.ts`）。
 * 变更跟进按快照在提交之前还是之后分开：事件链接进 `commits/` 之前，同一个
 * 请求、同一个幂等键再发一次，它要做完这次规划；链接之后重放只会返回第一次的结果、不追加，所以改发一份声明
 * `replacement` 的新任务包（场景链规划之后的同一步），它要在同一个 Demand 上真的追加一个新事件。规划没有
 * `mode: recover`，场景不提供恢复调用。
 *
 * 夹具工作区先建一个空的 Git 仓库，reconcile 才走得到它真正的结束（否则一律停在 `gitignore-git-repository`）。
 * 每一份快照上跑一轮：status、变更跟进（不管 status 的结局）、跟进成功之后再一次 status；失败时只跟被点名的
 * 恢复，最多三跳——可重试的拒绝重试一次，`recovery-required` 的拒绝照 `details.tool` 与 `details.operationId`
 * 走，status 点了名的照 status 走（`snapshot-sweep-harness.ts`）。什么都没点名时才从重新摆回的快照试没有路标的
 * 路，试通的一律记作没有路标；1.4.1 段 1b 之后每个扫点文件都断言没有这样的点。治好之后查 L1–L7 的锁残留、
 * 留下的恢复记录与 Demand 根三个目录里的暂存。范围见 `snapshot-sweep-harness.ts`：`locks`（缺省）摆回 L1–L7
 * 锁操作的前后，要求一份都不卡住；`all`（`WAKEFLOW_SNAPSHOT_SWEEP_SCOPE=all`）摆回每一份并加上内容同步之后的
 * 那些，场景开了的话另跑掉电的盘面（`snapshot-sweep-powerloss.ts`）。显式表按 `all` 范围写，`locks` 只取摆回过
 * 的序号；断言见文件末尾的测试。
 *
 * 摆回的是什么：每一个暂存、候选或树成员都在两个时刻摆回——排他新建刚返回、内容还没写的空文件，以及它被
 * 链接或改名之后；`all` 范围另在经接缝排他新建的每个文件内容同步之后摆回一次（内容完整、权限位已改、还没
 * 发布；序号是前一次接缝调用的序号加一位小数，例如 8.1 是写完并同步、还没链接进 `commits/` 的追加候选）。
 * 中间的状态——内容写了一半、写完还没改权限位，以及 `locks` 范围里内容同步之后的那一刻——不摆回；不同步内容
 * 的写入（这里的索引与快照暂存）也就没有那一份。不覆盖的：递归删除整棵目录树是一次接缝调用，删到一半的样子
 * 挂不到；快照只在接缝调用或那次内容同步成功之后取，进程死在一次系统调用中途不在内；掉电之后的盘面这个场景
 * 没有开（它的跟进按序号分支）。工作区的 `.git` 与产品检出不在快照集里，各份快照共用
 * （`snapshot-sweep-copy.ts`）。
 */

useDisposableDurability();

/**
 * 显式表：1.4.1 段 1b 之后的样子。表按 `all` 范围写，`locks` 范围只取摆回过的序号；改过存储路径之后的
 * 重钉办法见 `snapshot-sweep-harness.ts` 的 `WAKEFLOW_SNAPSHOT_SWEEP_DUMP`。
 */

/**
 * 没有任何公开调用治得好的快照：没有。段 1b 之前卡住的 11、12、15、17、17.1、18（`index/`、`snapshots/` 与
 * `task-packages/` 里死写者的暂存与成对的目标）现在清点放行，一轮治好；暂存留到下一次 reconcile 清
 * （见下面的暂存残留表）。
 */
const STUCK_ON_TODAY: readonly SnapshotSweepStuckRow[] = [];

/** 被拒绝点了名、照点名的恢复走通的快照：`[序号, 出口]`；两跳的出口用 `>` 连起来。 */
const SIGNPOSTED_RECOVERY_ON_TODAY: readonly (readonly [number, string])[] = [];

/**
 * 拒绝没有点名、只有 status 点了名，照它走通的快照：`[序号, 出口]`。8、8.1、9：规划事件的追加候选还在，
 * 根打不开；规划工具的拒绝不带出口，status 的 `nextActions` 里有一条 `demand-recovery` 点着这个 Demand 与
 * 维护工具，reconcile 收掉候选之后规划照常做完。
 */
const STATUS_NAMED_RECOVERY_ON_TODAY: readonly (readonly [number, string])[] = [
  ...[8, 8.1, 9].map((index) => [index, "maintenance:reconcile"] as const),
].sort(([left], [right]) => left - right);

/** 第一跳由拒绝点了名、而第一轮的 status 没有点着同一条工具的快照：`[序号, 出口]`。 */
const STATUS_UNNAMED_ON_TODAY: readonly (readonly [number, string])[] = [];

/** 第一轮 status 被拒、变更跟进治好的快照：`[序号, status 的 code/reason]`。 */
const HEALED_AFTER_STATUS_REFUSAL_ON_TODAY: readonly (readonly [number, string])[] = [];

/**
 * 治好之后仍留着的 L1–L7 锁文件或锁暂存：`[路径, 个数, 序号]`，是产品上的发现。子进程自己的读者租约（L2）从
 * 链接出来到它删掉之间每点留一个：死掉的读者租约只有独占获取才清，这里的跟进与恢复都是共享作用域（L10）。
 * 走 reconcile 治好的点没有残留（维护拿独占作用域）。
 */
const LOCK_RESIDUE_ON_TODAY: readonly (readonly [number, string, number])[] =
  snapshotSweepResidueRows([
    [
      SNAPSHOT_SWEEP_READER_LEASE,
      1,
      [
        ...snapshotSweepSpan(5, 7),
        ...snapshotSweepSpan(10, 37),
        ...[17.1, 20.1, 25.1, 28.1, 31.1, 34.1],
      ],
    ],
  ]);

/** 治好之后仍留着的恢复记录（退役根、恢复用的暂存根、日志、发布标记、发布暂存树）：`[序号, 路径]`。 */
const RECOVERY_RESIDUE_ON_TODAY: readonly (readonly [number, string])[] = [];

/**
 * 治好之后 Demand 根的三个目录里仍留着的原子暂存：`[路径, 个数, 序号]`。清点容忍死写者的暂存，不删；
 * 成对的目标照常被读（索引与快照）或由同目标的下一次写入结算（任务包）。清掉它们的是 reconcile
 * （`stageResidueCount`），见 `demand-runtime-recovery.test.ts`。
 */
const STAGE_RESIDUE_ON_TODAY: readonly (readonly [number, string, number])[] =
  snapshotSweepResidueRows([
    [
      "workspace:.wakeflow-active/current/demand_<uuid>/event-sourcing/index/.wakeflow-atomic-create-m600.tmp",
      1,
      [11, 12],
    ],
    [
      "workspace:.wakeflow-active/current/demand_<uuid>/event-sourcing/snapshots/.wakeflow-atomic-create-m600.tmp",
      1,
      [14, 15],
    ],
    [
      "workspace:.wakeflow-active/current/demand_<uuid>/artifacts/task-packages/.wakeflow-atomic-create-m600.tmp",
      1,
      [17, 17.1, 18],
    ],
  ]);

/** 掉电的盘面（只在 `all` 范围生成）：`[归类, 位置…]`，位置是“第几步之后的第几次目录同步”。 */
const POWER_LOSS_ON_TODAY: readonly (readonly [string, string])[] = [];

/** 掉电的盘面治好之后仍留着的锁，读者租约之外的：`[位置, 路径, 个数]`。 */
const POWER_LOSS_LOCK_RESIDUE_ON_TODAY: readonly (readonly [string, string, number])[] = [];

/** 掉电的盘面治好之后仍留着的恢复记录：`[位置, 路径]`。 */
const POWER_LOSS_RECOVERY_RESIDUE_ON_TODAY: readonly (readonly [string, string])[] = [];

/**
 * 摆回过的序号，按范围钉住（`sweptIndicesOf`）：`locks` 是对照点、L1–L7 锁操作前后的那些与场景另列的路线
 * 代表点（`routePoints`），`all` 是每一份加上内容同步之后带小数的那些。一轮就治好的点不在上面任何一张表里，靠这里看住它们确实摆回过。
 */
const SWEPT_POINTS_ON_TODAY: Readonly<Record<SnapshotSweepScope, readonly number[]>> = {
  locks: [
    ...snapshotSweepSpan(0, 8),
    11,
    12,
    15,
    ...snapshotSweepSpan(17, 22),
    ...snapshotSweepSpan(36, 38),
  ],
  all: snapshotSweepAllPoints(38, [1.1, 4.1, 8.1, 17.1, 20.1, 25.1, 28.1, 31.1, 34.1]),
};

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
    demandId: () => demandId,
    // 段 1b 改过的恢复路线的代表点（都不挨着锁操作，缺省范围不列就不摆回）：规划事件的追加候选——只有
    // status 点名（8），以及 `index/`、`snapshots/`、`task-packages/` 里死写者的暂存与成对的目标——段 1b
    // 之前卡住的点（11、12、15、17、18）。
    routePoints: [8, 11, 12, 15, 17, 18],
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
  deepEqual(
    statusNamedRecoveryOf(report),
    withinSweptPoints(report, STATUS_NAMED_RECOVERY_ON_TODAY, ([index]) => index),
  );
  deepEqual(
    statusUnnamedOf(report),
    withinSweptPoints(report, STATUS_UNNAMED_ON_TODAY, ([index]) => index),
  );
  // 段 1b 的结论：能恢复的快照都有路标（拒绝或 status 点了名）；出现一个没有路标的就是回退。
  deepEqual(unsignpostedRecoveryOf(report), []);
  deepEqual(
    healedAfterStatusRefusalOf(report),
    withinSweptPoints(report, HEALED_AFTER_STATUS_REFUSAL_ON_TODAY, ([index]) => index),
  );
  deepEqual(
    lockResidueOf(report),
    withinSweptPoints(report, LOCK_RESIDUE_ON_TODAY, ([index]) => index),
  );
  deepEqual(
    recoveryResidueOf(report),
    withinSweptPoints(report, RECOVERY_RESIDUE_ON_TODAY, ([index]) => index),
  );
  deepEqual(
    stageResidueOf(report),
    withinSweptPoints(report, STAGE_RESIDUE_ON_TODAY, ([index]) => index),
  );
  // 掉电的盘面只在 `all` 范围生成。读者租约（L2）每个位置至多留一个——子进程自己的那个，死读者租约只有
  // 独占获取才清（L10）；多出来就是跟进自己漏了租约。别的锁按显式表。
  deepEqual(powerLossVerdictsOf(report), report.scope === "all" ? POWER_LOSS_ON_TODAY : []);
  deepEqual(
    powerLossLockResidueOf(report).filter(
      ([, entry, count]) => entry === SNAPSHOT_SWEEP_READER_LEASE && count > 1,
    ),
    [],
  );
  deepEqual(
    powerLossLockResidueOf(report).filter(([, entry]) => entry !== SNAPSHOT_SWEEP_READER_LEASE),
    report.scope === "all" ? POWER_LOSS_LOCK_RESIDUE_ON_TODAY : [],
  );
  deepEqual(
    powerLossRecoveryResidueOf(report),
    report.scope === "all" ? POWER_LOSS_RECOVERY_RESIDUE_ON_TODAY : [],
  );
  // 放在最后：前面的表先各自比对，摆回的点对不上时再报这一条。
  deepEqual(sweptIndicesOf(report), SWEPT_POINTS_ON_TODAY[report.scope]);
});
