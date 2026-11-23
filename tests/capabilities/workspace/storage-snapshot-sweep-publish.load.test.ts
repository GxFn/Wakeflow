import { deepEqual } from "node:assert/strict";
import { test } from "node:test";

import { WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME } from "../../../src/capabilities/requirement/contract.js";
import { executeRequirementPublicationRequest } from "../../../src/capabilities/requirement/service.js";
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
import {
  freshSnapshotSweepWorkspace,
  snapshotSweepConfirmedAt,
  snapshotSweepPackage,
} from "../../support/snapshot-sweep-workspaces.js";

/**
 * 级别 2（能力），真实进程：快照扫点（1.4.1 第 1 段清单 2.4 第 2 步），发布一份需求包。
 *
 * 子进程经真实 MCP 入口做一次发布的 apply（账本记录锁 L7、看板锁 L4、需求记录树的暂存与改名），每经过一次
 * 变更接缝拷一份快照（`tests/support/snapshot-sweep-process.ts`）；本进程逐份摆回原处，跑只读的 status 与变更
 * 跟进，归为 healed、signposted-recovery、
 * status-named-recovery、unsignposted-recovery 或 stuck（`snapshot-sweep-harness.ts`）。变更跟进是
 * "同一个请求再发一次"（ADR-0031：被打断的发布靠重发做完），再撤回同一个包：记录已在时重放不进 L7 与 L4，
 * 撤回才在 L4 里改写看板状态，留下的死看板锁由它清。
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
 * 发布；序号是前一次接缝调用的序号加一位小数，例如 12.1）。中间的状态——内容写了一半、写完还没改权限位，
 * 以及 `locks` 范围里内容同步之后的那一刻——不摆回。不覆盖的：递归删除整棵目录树是一次接缝调用，删到一半的
 * 样子挂不到；快照只在接缝调用或那次内容同步成功之后取，进程死在一次系统调用中途不在内。掉电之后的
 * 盘面另由 `all` 范围生成（局限见 `snapshot-sweep-powerloss.ts` 的文件头）。工作区的 `.git` 与产品检出不在快照集里，各份快照共用
 * （`snapshot-sweep-copy.ts`）。
 */

useDisposableDurability();

/**
 * 显式表：1.4.1 段 1b 之后的样子。表按 `all` 范围写，`locks` 范围只取摆回过的序号；改过存储路径之后的
 * 重钉办法见 `snapshot-sweep-harness.ts` 的 `WAKEFLOW_SNAPSHOT_SWEEP_DUMP`。
 */

/** 没有任何公开调用治得好的快照（`all` 范围；`locks` 范围里一个都不许有）。 */
const STUCK_ON_TODAY: readonly SnapshotSweepStuckRow[] = [];

/**
 * 被拒绝点了名、照点名的恢复走通的快照：`[序号, 出口]`。21：看板认领状态文件刚链接出来、创建暂存还没退役；
 * 重发以可重试的 `concurrency-conflict/claim-state-changed` 被拒，照信封重试一次就过（L10）。
 */
const SIGNPOSTED_RECOVERY_ON_TODAY: readonly (readonly [number, string])[] = [
  ...[21].map((index) => [index, "retry"] as const),
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
 * 15：账本记录锁。记录发布完、锁还没删进程死了；同一条记录不再发布，没有人再拿它（L10）。
 */
const LOCK_RESIDUE_ON_TODAY: readonly (readonly [number, string, number])[] =
  snapshotSweepResidueRows([
    [
      SNAPSHOT_SWEEP_READER_LEASE,
      1,
      [...snapshotSweepSpan(5, 29), ...[8.1, 12.1, 13.1, 14.1, 17.1, 20.1, 24.1, 27.1]],
    ],
    ["ledger:transactions/requirement_<uuid>.lock", 1, [15]],
  ]);

/** 治好之后仍留着的恢复记录（退役根、恢复用的暂存根、日志、发布标记、发布暂存树）：`[序号, 路径]`。 */
const RECOVERY_RESIDUE_ON_TODAY: readonly (readonly [number, string])[] = [];

/** 治好之后 Demand 根的三个目录里仍留着的原子暂存：`[路径, 个数, 序号]`。 */
const STAGE_RESIDUE_ON_TODAY: readonly (readonly [number, string, number])[] = [];

/** 掉电的盘面（只在 `all` 范围生成）：`[归类, 位置…]`，位置是“第几步之后的第几次目录同步”。 */
const POWER_LOSS_ON_TODAY: readonly (readonly [string, string])[] = snapshotSweepPowerLossRows([
  ["healed", "7~1 14~1 15~1 15~2 16~1 22~1 23~1 28~1 29~1 30~1".split(" ")],
  ["signposted:retry", "21~1".split(" ")],
]);

/**
 * 掉电的盘面治好之后仍留着的锁，读者租约之外的：`[位置, 路径, 个数]`。15~2 与被杀的第 15 点是同一件事。
 */
const POWER_LOSS_LOCK_RESIDUE_ON_TODAY: readonly (readonly [string, string, number])[] = [
  ["15~2", "ledger:transactions/requirement_<uuid>.lock", 1],
];

/** 掉电的盘面治好之后仍留着的恢复记录：`[位置, 路径]`。 */
const POWER_LOSS_RECOVERY_RESIDUE_ON_TODAY: readonly (readonly [string, string])[] = [];

/**
 * 摆回过的序号，按范围钉住（`sweptIndicesOf`）：`locks` 是对照点、L1–L7 锁操作前后的那些与场景另列的路线
 * 代表点（`routePoints`），`all` 是每一份加上内容同步之后带小数的那些。一轮就治好的点不在上面任何一张表里，靠这里看住它们确实摆回过。
 */
const SWEPT_POINTS_ON_TODAY: Readonly<Record<SnapshotSweepScope, readonly number[]>> = {
  locks: [
    ...snapshotSweepSpan(0, 10),
    ...snapshotSweepSpan(15, 19),
    ...snapshotSweepSpan(22, 26),
    ...snapshotSweepSpan(28, 30),
  ],
  all: snapshotSweepAllPoints(30, [1.1, 4.1, 8.1, 12.1, 13.1, 14.1, 17.1, 20.1, 24.1, 27.1]),
};

test("快照扫点：发布需求包的每一步之后进程死亡，下一条 status 与同一个发布请求照常完成或走点名的出口", {
  timeout: 300_000,
}, async (t) => {
  if (loadSensitive(t, "a real MCP child process and one restore per seam call")) return;
  const workspace = await freshSnapshotSweepWorkspace(t);
  const root = workspace.root;
  const request = {
    root,
    action: "publish",
    package: snapshotSweepPackage(workspace, snapshotSweepConfirmedAt()),
  };
  const ready = await executeRequirementPublicationRequest({ ...request, mode: "preview" });
  if (
    ready.kind !== "WakeflowRequirementPublicationPreview" ||
    ready.planDigest === null ||
    typeof ready.requirementId !== "string"
  )
    throw new Error("Expected a ready publication preview.");
  const requirementId = ready.requirementId;
  const apply = {
    name: WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME,
    arguments: { ...request, mode: "apply", planDigest: ready.planDigest },
  };
  const report = await runSnapshotSweep(t, {
    name: "requirement-publish",
    set: { workspace: root, ledger: ledgerRootOf(root) },
    calls: [apply],
    statusArguments: { root },
    async followUp(invoke): Promise<SnapshotSweepOutcome> {
      const replayed = await invoke(apply);
      if (!replayed.ok) return replayed;
      // 记录已在时重放不进账本记录锁、也不进看板锁（`src/capabilities/requirement/service.ts` 的 `ensureRecord`
      // 与 `ensureClaimState` 读到已有的就返回），所以再撤回同一个包：撤回在看板锁 L4 里改写状态文件。
      // 同一份摆回上撤回成功之后扫点不再跑这条跟进（见驱动的文件头），所以这里每次都撤回。
      const receipt = replayed.value.package as { stateDigest: string };
      return previewThenApply(invoke, {
        name: WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME,
        arguments: {
          root,
          action: "withdraw",
          requirementId,
          expectedStateDigest: receipt.stateDigest,
          reason: "快照扫点跟进",
        },
      });
    },
    recover: () => ({
      name: WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME,
      arguments: { root, mode: "recover", operationId: requirementId },
    }),
    // 跟进按盘面上看到的状态走（重放，再撤回），不看序号，所以掉电的盘面也能跑。
    powerLoss: true,
  });
  t.diagnostic(summarizeSnapshotSweep(report));
  for (const line of snapshotSweepRowDiagnostics(report)) t.diagnostic(line);
  deepEqual(lockFamiliesOf(report.seam), [
    "L1 operation-scope latch and writer",
    "L2 reader leases",
    "L4 board locks",
    "L7 ledger record lock",
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
