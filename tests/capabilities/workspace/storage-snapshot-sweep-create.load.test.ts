import { deepEqual } from "node:assert/strict";
import { test } from "node:test";

import {
  WAKEFLOW_DEMAND_CANCELLATION_PUBLIC_TOOL_NAME,
  WAKEFLOW_DEMAND_CREATION_PUBLIC_TOOL_NAME,
} from "../../../src/capabilities/demand/contract.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import { loadSensitive } from "../../support/load-sensitive.js";
import {
  demandIdIn,
  healedAfterStatusRefusalOf,
  ledgerRootOf,
  lockFamiliesOf,
  lockResidueOf,
  powerLossLockResidueOf,
  powerLossRecoveryResidueOf,
  powerLossVerdictsOf,
  previewThenApply,
  recoveryResidueOf,
  runSnapshotSweep,
  signpostedRecoveryOf,
  SNAPSHOT_SWEEP_READER_LEASE,
  snapshotSweepAllPoints,
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
import { publishedSnapshotSweepWorkspace } from "../../support/snapshot-sweep-workspaces.js";

/**
 * 级别 2（能力），真实进程：快照扫点（1.4.1 第 1 段清单 2.4 第 2 步），认领需求包创建 Demand。
 *
 * 子进程经真实 MCP 入口做一次创建的 apply（Demand 发布锁 L6、pod 变更锁 L5、看板锁 L4、投影锁 L3、Demand 根
 * 的暂存树与改名），每经过一次变更接缝拷一份快照（`tests/support/snapshot-sweep-process.ts`）；本进程逐份摆回
 * 原处，跑只读的 status 与变更跟进，归为 healed、signposted-recovery、
 * status-named-recovery、unsignposted-recovery 或 stuck
 * （`snapshot-sweep-harness.ts`）。变更跟进是"同一个请求再发一次"（ADR-0031：被打断的创建靠重发做完），再撤销
 * 这个 Demand：看板认领写好之后重发是被门挡下的直接应用（`apply-blocked/package-claim:claimed,…`，扫点把它当作
 * 创建已越过认领），不再进 L5、L6、L4 与 L3，撤销才在 L5 里改写看板（L4 与看板索引锁）并刷新投影（L3），留下的
 * 死锁由它清。场景的恢复调用是创建的 `mode: recover`（`operationId` 为 Demand id），只在什么都没点名时从
 * 重新摆回的快照试。
 *
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
 * 发布；序号是前一次接缝调用的序号加一位小数，例如 21.1 是暂存树里写完并同步、还没链接的发布标记）。中间的
 * 状态——内容写了一半、写完还没改权限位，以及 `locks` 范围里内容同步之后的那一刻——不摆回；不同步内容的写入
 * （暂存树里的索引暂存）也就没有那一份。不覆盖的：递归删除整棵目录树是一次接缝调用，删到一半的样子挂不到；
 * 快照只在接缝调用或那次内容同步成功之后取，进程死在一次系统调用中途不在内；掉电之后的盘面另由 `all`
 * 范围生成（局限见 `snapshot-sweep-powerloss.ts` 的文件头）。工作区的 `.git` 与产品检出不在快照集里，各份快照共用
 * （`snapshot-sweep-copy.ts`）。
 */

useDisposableDurability();

/**
 * 显式表：1.4.1 段 1b 之后的样子。表按 `all` 范围写，`locks` 范围只取摆回过的序号；改过存储路径之后的
 * 重钉办法见 `snapshot-sweep-harness.ts` 的 `WAKEFLOW_SNAPSHOT_SWEEP_DUMP`。
 */

/**
 * 没有任何公开调用治得好的快照：没有。段 1b 之前卡住的 22、32、35、40、41（发布暂存树里成对的标记、身份、
 * 权威文件与索引目录里的暂存）现在由同一个创建请求的重入结算掉，一轮治好。
 */
const STUCK_ON_TODAY: readonly SnapshotSweepStuckRow[] = [];

/**
 * 被拒绝点了名、照点名的恢复走通的快照：`[序号, 出口]`。51–58：Demand 根已经改名生效、看板认领在写或已写、
 * 发布标记还在。重发创建被门挡下（需求包已认领），接着的撤销以 `recovery-required/demand-publication` 被拒，
 * `details.tool` 是 `wakeflow_create_demand`、`details.operationId` 是这个 Demand；照它 recover 之后撤销成功。
 * 段 1b 之前这条路没有任何拒绝或 status 指向。
 */
const SIGNPOSTED_RECOVERY_ON_TODAY: readonly (readonly [number, string])[] = [
  ...[...snapshotSweepSpan(51, 58), ...[53.1, 56.1]].map(
    (index) => [index, "wakeflow_create_demand:recover"] as const,
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
 * 59：Demand 发布锁。发布标记删掉之后进程死了，这个 Demand 不再有发布，没有人再拿这把锁（L10）。
 */
const LOCK_RESIDUE_ON_TODAY: readonly (readonly [number, string, number])[] =
  snapshotSweepResidueRows([
    [
      SNAPSHOT_SWEEP_READER_LEASE,
      1,
      [
        ...snapshotSweepSpan(5, 77),
        ...[9.1, 16.1, 21.1, 31.1, 34.1, 37.1, 47.1, 50.1, 53.1, 56.1],
        ...[62.1, 67.1, 69.1, 71.1, 74.1],
      ],
    ],
    ["workspace:.wakeflow-active/current/demand-publication/locks/demand_<uuid>.lock", 1, [59]],
  ]);

/** 治好之后仍留着的恢复记录（退役根、恢复用的暂存根、日志、发布标记、发布暂存树）：`[序号, 路径]`。 */
const RECOVERY_RESIDUE_ON_TODAY: readonly (readonly [number, string])[] = [];

/** 治好之后 Demand 根的三个目录里仍留着的原子暂存：`[路径, 个数, 序号]`。 */
const STAGE_RESIDUE_ON_TODAY: readonly (readonly [number, string, number])[] = [];

/**
 * 掉电的盘面（只在 `all` 范围生成）：`[归类, 位置…]`。51~1、52~1、57~1、58~1 与同一段的被杀点一样照撤销的
 * 拒绝点名的 recover 走通；其余一轮治好，含段 1b 之前卡住的 22~1、32~1、35~1。
 */
const POWER_LOSS_ON_TODAY: readonly (readonly [string, string])[] = snapshotSweepPowerLossRows([
  [
    "healed",
    [
      ..."7~1 8~1 12~1 13~1 14~1 15~1 19~1 20~1 22~1 23~1".split(" "),
      ..."24~1 25~1 26~1 27~1 28~1 29~1 30~1 32~1 33~1 35~1".split(" "),
      ..."36~1 38~1 39~1 46~1 46~2 59~1 60~1 61~1 65~1 66~1".split(" "),
      ..."68~1 70~1 72~1 73~1 75~1 76~1 77~1 78~1".split(" "),
    ],
  ],
  ["signposted:wakeflow_create_demand:recover", "51~1 52~1 57~1 58~1".split(" ")],
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
    ...snapshotSweepSpan(0, 11),
    ...snapshotSweepSpan(15, 18),
    22,
    32,
    35,
    40,
    41,
    ...snapshotSweepSpan(46, 49),
    ...snapshotSweepSpan(51, 55),
    ...snapshotSweepSpan(57, 64),
    ...snapshotSweepSpan(76, 78),
  ],
  all: snapshotSweepAllPoints(
    78,
    [
      1.1, 4.1, 9.1, 16.1, 21.1, 31.1, 34.1, 37.1, 47.1, 50.1, 53.1, 56.1, 62.1, 67.1, 69.1, 71.1,
      74.1,
    ],
  ),
};

test("快照扫点：认领需求包创建 Demand 的每一步之后进程死亡，下一条 status 与同一个创建请求照常完成或走点名的出口", {
  timeout: 900_000,
}, async (t) => {
  if (loadSensitive(t, "a real MCP child process and one restore per seam call")) return;
  const { workspace, requirementId } = await publishedSnapshotSweepWorkspace(t);
  const root = workspace.root;
  const create = {
    name: WAKEFLOW_DEMAND_CREATION_PUBLIC_TOOL_NAME,
    arguments: {
      root,
      mode: "apply",
      requirementId,
      demand: {
        title: "快照扫点",
        goal: "每一份快照之后的下一条命令照常完成。",
        completionDefinition: "没有卡住的快照。",
      },
    },
  };
  let demandId = "";
  const report = await runSnapshotSweep(t, {
    name: "demand-create",
    set: { workspace: root, ledger: ledgerRootOf(root) },
    calls: [create],
    onChildDone: (results) => {
      demandId = demandIdIn(results[0]);
    },
    statusArguments: { root },
    // 子进程做完才知道新建的 Demand 是哪一个；扫点开始时读。
    demandId: () => demandId,
    // 跟进按盘面上看到的状态走（重放创建，再撤销），不看序号，所以掉电的盘面也能跑。
    powerLoss: true,
    // 段 1b 改过的恢复路线的代表点（都不挨着锁操作，缺省范围不列就不摆回）：发布暂存树里成对的标记、
    // 身份、权威文件与索引目录里的暂存——段 1b 之前卡住的五个点。根已改名、标记还在的那一段（51 起）
    // 挨着看板锁，本来就在缺省范围里。
    routePoints: [22, 32, 35, 40, 41],
    // 撤销成功之后同一份摆回上不会再跑这条跟进（扫点只再看 status），所以它不必记得撤销过。
    async followUp(invoke): Promise<SnapshotSweepOutcome> {
      const replayed = await invoke(create);
      // 看板认领写好之后，重发是被门挡下的直接应用（`apply-blocked/package-claim:claimed,…`，创建做完之后的
      // 最后一份快照也是这样）：创建已经越过认领，接着撤销。别的拒绝就是这一轮的失败。
      const claimed =
        !replayed.ok &&
        replayed.code === "apply-blocked" &&
        replayed.reason.split(",").includes("package-claim:claimed");
      if (!replayed.ok && !claimed) return replayed;
      // 认领之后重放不进 pod 变更锁、发布锁、看板锁与投影锁，所以再撤销这个 Demand：撤销在 pod 变更锁 L5 里
      // 改写看板认领（L4 与看板索引锁），之后刷新投影（L3）。
      return previewThenApply(invoke, {
        name: WAKEFLOW_DEMAND_CANCELLATION_PUBLIC_TOOL_NAME,
        arguments: { root, demandId, reason: "快照扫点跟进" },
      });
    },
    recover: () => ({
      name: WAKEFLOW_DEMAND_CREATION_PUBLIC_TOOL_NAME,
      arguments: { root, mode: "recover", operationId: demandId },
    }),
  });
  t.diagnostic(summarizeSnapshotSweep(report));
  for (const line of snapshotSweepRowDiagnostics(report)) t.diagnostic(line);
  deepEqual(lockFamiliesOf(report.seam), [
    "L1 operation-scope latch and writer",
    "L2 reader leases",
    "L3 projector lock",
    "L4 board locks",
    "L5 pod mutation lock",
    "L6 Demand publication lock",
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
