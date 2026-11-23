import { deepEqual } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
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

/**
 * 级别 2（能力），真实进程：快照扫点（1.4.1 第 1 段清单 2.4 第 2 步），完成一个 Demand 并归档。
 *
 * 子进程经真实 MCP 入口一次调用完成已接受的 Demand（终态事件追加、归档、看板锁 L4、pod 变更锁 L5、投影锁 L3、
 * 终态移除 Demand 根），每经过一次变更接缝拷一份快照（`tests/support/snapshot-sweep-process.ts`）；本进程逐份
 * 摆回原处，跑只读的 `wakeflow_status{demandId}` 与下一条变更命令——Demand 根还在就再完成一次；已归档（或再完成
 * 一次之后归档了）就从归档 continue（pod 变更锁、看板锁、归档读取），留下的死锁由它清——归为 healed、signposted-recovery、
 * status-named-recovery、unsignposted-recovery 或 stuck（`snapshot-sweep-harness.ts`）。场景的恢复调用是完成的
 * `mode: recover`（`operationId` 为 Demand id），只在什么都没点名时从重新摆回的快照试。再完成一次是不带计划摘要的直接应用：门不过时它以预览的形状交回阻塞项，扫点把它记为
 * `apply-blocked`，不算成功。
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
 * 发布；序号是前一次接缝调用的序号加一位小数，例如归档候选里写完并同步、整棵候选还没改名的成员）。不同步
 * 内容的写入没有这样的点（Demand 的流索引与事件快照的暂存，例如 19 与 24 那两处），快照集之外的文件也没有。中间的
 * 状态——内容写了一半、写完还没改权限位，以及 `locks` 范围里内容同步之后的那一刻——不摆回。不覆盖的：递归
 * 删除整棵目录树是一次接缝调用（终态删掉改名之后的退役根就是），删到一半的样子挂不到；快照只在接缝调用或那次内容
 * 同步成功之后取，进程死在一次系统调用中途不在内；掉电之后的盘面另由 `all` 范围生成（局限见
 * `snapshot-sweep-powerloss.ts` 的文件头）。工作区的 `.git` 与产品检出不在快照集里，各份快照共用（`snapshot-sweep-copy.ts`）。
 */

useDisposableDurability();

/**
 * 显式表：1.4.1 段 1b 之后的样子。表按 `all` 范围写，`locks` 范围只取摆回过的序号；改过存储路径之后的
 * 重钉办法见 `snapshot-sweep-harness.ts` 的 `WAKEFLOW_SNAPSHOT_SWEEP_DUMP`。
 */

/**
 * 没有任何公开调用治得好的快照：没有。段 1b 之前卡住的 19、20、24（根的清点不认 `index/` 与 `snapshots/` 里死写者
 * 的暂存与成对的目标）现在清点放行，落在下面“被拒绝点了名”的那一段里。
 */
const STUCK_ON_TODAY: readonly SnapshotSweepStuckRow[] = [];

/**
 * 被拒绝点了名、照点名的恢复走通的快照：`[序号, 出口]`；两跳的出口用 `>` 连起来。
 *
 * 16、16.1：终态事件的追加候选还在，根打不开；再完成以 `recovery-required/append-candidates-pending` 被拒，
 * `details.tool` 点着维护，reconcile 收掉候选之后再完成照常做完。17：候选刚链接进 `commits/`，reconcile 之后
 * 再完成以 `lifecycle-journal-pending` 被拒、点着完成的 recover，两跳。18–63：终态事件已提交、生命周期日志
 * 还在（归档、看板收尾没做完），再完成以 `recovery-required/lifecycle-journal-pending` 被拒，`details.tool` 是
 * `wakeflow_complete_demand`、`details.operationId` 是这个 Demand，照它 recover 一跳治好，之后从归档 continue
 * 成功。段 1b 之前这些点没有任何拒绝或 status 指向这条路。
 *
 * 64 起根已经改名退役（64 是改名，65 是删退役根）：根不在自己的名字下，跟进直接从归档 continue，它先清掉
 * 退役根再放回根，一轮治好，所以不在这张表里。
 */
const SIGNPOSTED_RECOVERY_ON_TODAY: readonly (readonly [number, string])[] = [
  ...[16, 16.1].map((index) => [index, "maintenance:reconcile"] as const),
  ...[17].map(
    (index) => [index, "maintenance:reconcile>wakeflow_complete_demand:recover"] as const,
  ),
  ...[
    ...snapshotSweepSpan(18, 63),
    ...[40.1, 41.1, 42.1, 43.1, 44.1, 45.1, 46.1, 47.1, 48.1, 49.1],
    ...[50.1, 51.1, 52.1, 53.1, 54.1, 55.1, 56.1, 58.1, 61.1],
  ].map((index) => [index, "wakeflow_complete_demand:recover"] as const),
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
        ...snapshotSweepSpan(5, 15),
        ...snapshotSweepSpan(18, 90),
        ...[9.1, 13.1, 40.1, 41.1, 42.1, 43.1, 44.1, 45.1, 46.1, 47.1],
        ...[48.1, 49.1, 50.1, 51.1, 52.1, 53.1, 54.1, 55.1, 56.1, 58.1],
        ...[61.1, 67.1, 70.1, 73.1, 76.1, 80.1, 83.1, 85.1],
      ],
    ],
  ]);

/** 治好之后仍留着的恢复记录（退役根、恢复用的暂存根、日志、发布标记、发布暂存树）：`[序号, 路径]`。 */
const RECOVERY_RESIDUE_ON_TODAY: readonly (readonly [number, string])[] = [];

/** 治好之后 Demand 根的三个目录里仍留着的原子暂存：`[路径, 个数, 序号]`。 */
const STAGE_RESIDUE_ON_TODAY: readonly (readonly [number, string, number])[] = [];

/**
 * 掉电的盘面（只在 `all` 范围生成）：`[归类, 位置…]`，位置是“第几步之后的第几次目录同步”。终态事件的
 * 提交落盘之前的位置（到 15~1）一轮治好：那时日志若已落盘，只是一份没有生效的意图，再完成一次照常做。
 * 17~1 到 63~1（终态事件已落盘、根还没退役）照拒绝点名的 recover 走通；64~1 起（改名退役已经落盘）一轮
 * 治好。没有卡住的，也没有治好之后留下恢复记录的。
 */
const POWER_LOSS_ON_TODAY: readonly (readonly [string, string])[] = snapshotSweepPowerLossRows([
  [
    "healed",
    [
      ..."7~1 8~1 12~1 14~1 15~1 64~1 65~1 66~1 71~1 72~1".split(" "),
      ..."74~1 75~1 77~1 78~1 79~1 84~1 86~1 87~1 88~1 90~1".split(" "),
      ..."91~1".split(" "),
    ],
  ],
  [
    "signposted:wakeflow_complete_demand:recover",
    [
      ..."17~1 18~1 27~1 56~1 56~2 56~3 56~4 56~5 56~6 56~7".split(" "),
      ..."56~8 56~9 56~10 56~11 56~12 57~1 62~1 63~1".split(" "),
    ],
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
    ...snapshotSweepSpan(0, 11),
    ...snapshotSweepSpan(16, 18),
    24,
    ...snapshotSweepSpan(57, 60),
    ...snapshotSweepSpan(62, 69),
    71,
    72,
    ...snapshotSweepSpan(78, 82),
    ...snapshotSweepSpan(89, 91),
  ],
  all: snapshotSweepAllPoints(
    91,
    [
      1.1, 4.1, 9.1, 13.1, 16.1, 40.1, 41.1, 42.1, 43.1, 44.1, 45.1, 46.1, 47.1, 48.1, 49.1, 50.1,
      51.1, 52.1, 53.1, 54.1, 55.1, 56.1, 58.1, 61.1, 67.1, 70.1, 73.1, 76.1, 80.1, 83.1, 85.1,
    ],
  ),
};

/** 在工作区根上建一个空的 Git 仓库（安静、不读全局的默认分支设置）。 */
function initializeSweepGitRepository(root: string): void {
  const initialized = spawnSync("git", ["-c", "init.defaultBranch=main", "init", "--quiet"], {
    cwd: root,
    encoding: "utf8",
    shell: false,
  });
  if (initialized.status !== 0) throw new Error("Cannot initialize the sweep workspace Git.");
}

test("快照扫点：完成 Demand 的每一步之后进程死亡，下一条 status 与再完成或 continue 照常完成或走点名的出口", {
  // `all` 范围摆回一百多份、卡住的点还要各试两条没有路标的路，十几分钟；`locks` 范围约两分钟。
  timeout: 1_800_000,
}, async (t) => {
  if (loadSensitive(t, "a real MCP child process and one restore per seam call")) return;
  const fixture = await createAcceptedDemandCompletionWorkspaceFixture();
  t.after(() => cleanupAcceptedDemandCompletionWorkspaceFixture(fixture));
  const root = realpathSync(fixture.workspacePath);
  // 夹具工作区不是 Git 仓库，reconcile 会一律停在 `gitignore-git-repository`；托管 `.gitignore` 的检查只要
  // 工作区根上有 `.git`（`src/workspace/managed-integration/wakeflow-gitignore-inspection.ts` 的
  // `assertGitRepositoryRoot`），不要提交。`.git` 不在快照集里，各份快照共用。
  initializeSweepGitRepository(root);
  const demandId = fixture.demandId;
  const complete = {
    name: WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME,
    arguments: { root, mode: "apply", demandId },
  };
  const demandRootExists = () =>
    existsSync(path.join(root, ...demandFinalRootRef(demandId).split("/")));
  const report = await runSnapshotSweep(t, {
    name: "demand-complete",
    set: { workspace: root, ledger: ledgerRootOf(root) },
    calls: [complete],
    statusArguments: { root, demandId },
    demandId: () => demandId,
    // 跟进只看 Demand 根在不在，不看序号，所以掉电的盘面也能跑。
    powerLoss: true,
    // 段 1b 改过的每条恢复路线的代表点（都不挨着锁操作，缺省范围不列就不摆回）：终态事件的追加候选
    // （16、17）、终态日志还在（18）、缓存目录里成对的暂存（24）、根改名退役与删退役根（64、65）。
    routePoints: [16, 17, 18, 24, 64, 65],
    // continue 成功之后同一份摆回上不会再跑这条跟进（扫点只再看 status），所以它不必记得 continue 过。
    async followUp(invoke): Promise<SnapshotSweepOutcome> {
      if (demandRootExists()) {
        const completed = await invoke(complete);
        // 终态事件提交之后再完成一次不进 pod 变更锁、也不进看板锁；Demand 根还在就到此为止。
        if (!completed.ok || demandRootExists()) return completed;
      }
      // 已归档：从归档 continue，它在 pod 变更锁 L5 里认领看板（L4），留下的死锁由它清。
      return previewThenApply(invoke, {
        name: WAKEFLOW_DEMAND_CONTINUATION_PUBLIC_TOOL_NAME,
        arguments: {
          root,
          demandId,
          action: "continue",
          continuation: { kind: "optimization", summary: "Sweep follow-up." },
        },
      });
    },
    recover: () => ({
      name: WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME,
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
