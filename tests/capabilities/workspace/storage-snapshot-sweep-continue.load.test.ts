import { deepEqual } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  WAKEFLOW_DEMAND_CANCELLATION_PUBLIC_TOOL_NAME,
  WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME,
  WAKEFLOW_DEMAND_CONTINUATION_PUBLIC_TOOL_NAME,
} from "../../../src/capabilities/demand/contract.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import {
  cleanupAcceptedDemandCompletionWorkspaceFixture,
  createAcceptedDemandCompletionWorkspaceFixture,
} from "../../governance/lifecycle/demand-completion-service.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import { loadSensitive } from "../../support/load-sensitive.js";
import {
  healedAfterStatusRefusalOf,
  ledgerRootOf,
  lockResidueOf,
  powerLossLockResidueOf,
  powerLossRecoveryResidueOf,
  powerLossVerdictsOf,
  previewThenApply,
  recoveryResidueOf,
  runSnapshotSweep,
  signpostedRecoveryOf,
  SNAPSHOT_SWEEP_READER_LEASE,
  type SnapshotSweepOutcome,
  snapshotSweepPowerLossRows,
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

/**
 * 级别 2（能力），真实进程：快照扫点（1.4.1 段 1b 的证明工具），继续一个已归档的 Demand。
 *
 * 子进程经真实 MCP 入口先完成这个 Demand（铺垫，完成的扫点文件已经扫过）、预览继续，再带着预览的计划摘要
 * 应用继续（从归档恢复 Demand 根、追加继续的事件、重新认领看板、删日志）；只有应用继续那一次调用的接缝点
 * 摆回。变更跟进：Demand 根不在就再继续一次（预览加应用）；根在就取消它（取消在 pod 变更锁里改写看板认领，
 * 留下的死锁由它清）。场景的恢复调用是继续的 `mode: recover`（`operationId` 为 Demand id）。
 *
 * 每一份快照上跑一轮：status、变更跟进（不管 status 的结局）、跟进成功之后再一次 status；失败时只跟被点名的
 * 恢复（`snapshot-sweep-harness.ts`）。`all` 范围另跑掉电的盘面（`snapshot-sweep-powerloss.ts`）：跟进只看盘面
 * 上 Demand 根在不在，不看序号。范围、摆回的是什么与不覆盖的，见完成 Demand 的扫点文件
 * （`storage-snapshot-sweep-complete.load.test.ts`）的文件头，这里相同。
 */

useDisposableDurability();

/**
 * 显式表：1.4.1 段 1b 之后的样子。表按 `all` 范围写，`locks` 范围只取摆回过的序号；改过存储路径之后的
 * 重钉办法见 `snapshot-sweep-harness.ts` 的 `WAKEFLOW_SNAPSHOT_SWEEP_DUMP`。
 */

/** 没有任何公开调用治得好的快照（`all` 范围；`locks` 范围里一个都不许有）。 */
const STUCK_ON_TODAY: readonly SnapshotSweepStuckRow[] = [];

/**
 * 被拒绝点了名、照点名的恢复走通的快照：`[序号, 出口]`；两跳的出口用 `>` 连起来。131–135、138–148：根已经
 * 放回原位、续接的日志还在（事件没追加，或追加了而认领还没回来），再继续以
 * `recovery-required/lifecycle-journal-pending` 被拒并点着 `wakeflow_continue_demand` 的 recover，一跳治好。
 * 136、136.1、137：续接事件的追加候选还在，先被 `append-candidates-pending` 点到维护，reconcile 之后再点
 * 续接的 recover。根放回之前被杀的点（105–130）一轮治好：再继续一次，自己改写日志、另建一棵候选树，
 * 并清掉上一次建到一半留下的那棵（所以下面的恢复记录残留表是空的）。
 */
const SIGNPOSTED_RECOVERY_ON_TODAY: readonly (readonly [number, string])[] = [
  ...[...snapshotSweepSpan(131, 135), ...snapshotSweepSpan(138, 148), ...[145.1, 148.1]].map(
    (index) => [index, "wakeflow_continue_demand:recover"] as const,
  ),
  ...[136, 136.1, 137].map(
    (index) => [index, "maintenance:reconcile>wakeflow_continue_demand:recover"] as const,
  ),
].sort(([left], [right]) => left - right);

/** 拒绝没有点名、只有 status 点了名，照它走通的快照：`[序号, 出口]`。 */
const STATUS_NAMED_RECOVERY_ON_TODAY: readonly (readonly [number, string])[] = [];

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
        ...snapshotSweepSpan(96, 135),
        ...snapshotSweepSpan(138, 173),
        ...[99.1, 102.1, 116.1, 117.1, 118.1, 119.1, 120.1, 121.1, 122.1, 123.1],
        ...[124.1, 125.1, 126.1, 127.1, 128.1, 129.1, 130.1, 145.1, 148.1, 152.1],
        ...[155.1, 159.1, 163.1, 165.1, 167.1, 170.1],
      ],
    ],
  ]);

/** 治好之后仍留着的恢复记录（退役根、恢复用的暂存根、日志、发布标记、发布暂存树）：`[序号, 路径]`。 */
const RECOVERY_RESIDUE_ON_TODAY: readonly (readonly [number, string])[] = [];

/** 治好之后 Demand 根的三个目录里仍留着的原子暂存：`[路径, 个数, 序号]`。 */
const STAGE_RESIDUE_ON_TODAY: readonly (readonly [number, string, number])[] = [];

/**
 * 掉电的盘面（只在 `all` 范围生成）：`[归类, 位置…]`。130~1 到 130~11 是候选树发布之前逐个目录的同步，一轮
 * 治好；131~1 到 138~1（根的名字已经落盘、日志还在）照拒绝点名的 recover 走通；149~1 起（日志已删）一轮
 * 治好。没有卡住的。
 */
const POWER_LOSS_ON_TODAY: readonly (readonly [string, string])[] = snapshotSweepPowerLossRows([
  [
    "healed",
    [
      ..."98~1 103~1 104~1 130~1 130~2 130~3 130~4 130~5 130~6 130~7".split(" "),
      ..."130~8 130~9 130~10 130~11 149~1 150~1 151~1 156~1 157~1 158~1".split(" "),
      ..."162~1 164~1 166~1 168~1 169~1 171~1 172~1 173~1 174~1".split(" "),
    ],
  ],
  [
    "signposted:wakeflow_continue_demand:recover",
    "131~1 132~1 133~1 134~1 135~1 137~1 138~1".split(" "),
  ],
]);

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
    ...snapshotSweepSpan(91, 101),
    105,
    131,
    136,
    ...snapshotSweepSpan(144, 147),
    ...snapshotSweepSpan(149, 154),
    ...snapshotSweepSpan(156, 161),
    ...snapshotSweepSpan(172, 174),
  ],
  all: [
    ...snapshotSweepSpan(91, 174),
    ...[92.1, 95.1, 99.1, 102.1, 116.1, 117.1, 118.1, 119.1, 120.1, 121.1],
    ...[122.1, 123.1, 124.1, 125.1, 126.1, 127.1, 128.1, 129.1, 130.1, 136.1],
    ...[145.1, 148.1, 152.1, 155.1, 159.1, 163.1, 165.1, 167.1, 170.1],
  ].sort((left, right) => left - right),
};

function initializeSweepGitRepository(root: string): void {
  const initialized = spawnSync("git", ["-c", "init.defaultBranch=main", "init", "--quiet"], {
    cwd: root,
    encoding: "utf8",
    shell: false,
  });
  if (initialized.status !== 0) throw new Error("Cannot initialize the sweep workspace Git.");
}

test("快照扫点：继续 Demand 的每一步之后进程死亡或掉电，下一条 status 与再继续或取消照常完成或走点名的出口", {
  timeout: 1_800_000,
}, async (t) => {
  if (loadSensitive(t, "a real MCP child process and one restore per seam call")) return;
  const fixture = await createAcceptedDemandCompletionWorkspaceFixture();
  t.after(() => cleanupAcceptedDemandCompletionWorkspaceFixture(fixture));
  const root = realpathSync(fixture.workspacePath);
  // reconcile 要工作区根上有 `.git` 才走得到它真正的结束；`.git` 不在快照集里，各份快照共用。
  initializeSweepGitRepository(root);
  const demandId = fixture.demandId;
  const demandRootExists = () =>
    existsSync(path.join(root, ...demandFinalRootRef(demandId).split("/")));
  const proceed = {
    name: WAKEFLOW_DEMAND_CONTINUATION_PUBLIC_TOOL_NAME,
    arguments: {
      root,
      demandId,
      action: "continue",
      continuation: { kind: "optimization", summary: "Sweep follow-up." },
    },
  };
  const report = await runSnapshotSweep(t, {
    name: "demand-continue",
    set: { workspace: root, ledger: ledgerRootOf(root) },
    calls: [
      {
        name: WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME,
        arguments: { root, mode: "apply", demandId },
      },
      { name: proceed.name, arguments: { ...proceed.arguments, mode: "preview" } },
      ([, preview]) => ({
        name: proceed.name,
        arguments: { ...proceed.arguments, mode: "apply", planDigest: preview?.planDigest },
      }),
    ],
    sweepFromCall: 2,
    // 段 1b 改过的每条恢复路线的代表点（都不挨着锁操作，缺省范围不列就不摆回）：根放回之前、候选树建到
    // 一半（105）、根已放回而日志还在（131）、续接事件的追加候选（136）。
    routePoints: [105, 131, 136],
    statusArguments: { root, demandId },
    demandId: () => demandId,
    powerLoss: true,
    async followUp(invoke): Promise<SnapshotSweepOutcome> {
      if (!demandRootExists()) {
        const continued = await previewThenApply(invoke, proceed);
        if (!continued.ok) return continued;
        if (!demandRootExists()) {
          return {
            ok: false,
            code: "follow-up-incomplete",
            reason: "demand-root-absent",
            details: {},
          };
        }
      }
      return previewThenApply(invoke, {
        name: WAKEFLOW_DEMAND_CANCELLATION_PUBLIC_TOOL_NAME,
        arguments: { root, demandId, reason: "快照扫点跟进" },
      });
    },
    recover: () => ({
      name: WAKEFLOW_DEMAND_CONTINUATION_PUBLIC_TOOL_NAME,
      arguments: { root, mode: "recover", operationId: demandId },
    }),
  });
  t.diagnostic(summarizeSnapshotSweep(report));
  for (const line of snapshotSweepRowDiagnostics(report)) t.diagnostic(line);
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
