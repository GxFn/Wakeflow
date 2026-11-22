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
  previewThenApply,
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

/**
 * 级别 2（能力），真实进程：快照扫点（1.4.1 第 1 段清单 2.4 第 2 步），完成一个 Demand 并归档。
 *
 * 子进程经真实 MCP 入口一次调用完成已接受的 Demand（终态事件追加、归档、看板锁 L4、pod 变更锁 L5、投影锁 L3、
 * 终态移除 Demand 根），每经过一次变更接缝拷一份快照（`tests/support/snapshot-sweep-process.ts`）；本进程逐份
 * 摆回原处，跑只读的 `wakeflow_status{demandId}` 与下一条变更命令——Demand 根还在就再完成一次；已归档（或再完成
 * 一次之后归档了）就从归档 continue（pod 变更锁、看板锁、归档读取），留下的死锁由它清——归为 healed、
 * signposted-recovery、unsignposted-recovery 或 stuck（`snapshot-sweep-harness.ts`）。场景的恢复调用是完成的
 * `mode: recover`（`operationId` 为 Demand id）：拒绝码是 `recovery-required` 时是有路标的出口，有路标的都走不通时
 * 作为没有路标的路再试。再完成一次是不带计划摘要的直接应用：门不过时它以预览的形状交回阻塞项，扫点把它记为
 * `apply-blocked`，不算成功。
 *
 * 夹具工作区先建一个空的 Git 仓库，reconcile 才走得到它真正的结束（否则一律停在 `gitignore-git-repository`）。
 * 每一份快照上跑一轮：status、变更跟进（不管 status 的结局）、跟进成功之后再一次 status；失败时依次走有路标的
 * 出口（重试、完成的 `mode: recover`、维护的 recover、公开的 reconcile），都走不通再从重新摆回的快照试没有路标的
 * 路；治好之后查 L1–L7 的锁残留。范围见 `snapshot-sweep-harness.ts`：`locks`（缺省）摆回 L1–L7 锁操作的前后，
 * `all`（`WAKEFLOW_SNAPSHOT_SWEEP_SCOPE=all`）摆回每一份并加上内容同步之后的那些；断言见文件末尾的测试。
 *
 * 摆回的是什么：每一个暂存、候选或树成员都在两个时刻摆回——排他新建刚返回、内容还没写的空文件，以及它被
 * 链接或改名之后；`all` 范围另在经接缝排他新建的每个文件内容同步之后摆回一次（内容完整、权限位已改、还没
 * 发布；序号是前一次接缝调用的序号加一位小数，例如归档候选里写完并同步、整棵候选还没改名的成员）。不同步
 * 内容的写入没有这样的点（Demand 的流索引与事件快照的暂存，例如 19 与 24 那两处），快照集之外的文件也没有。中间的
 * 状态——内容写了一半、写完还没改权限位，以及 `locks` 范围里内容同步之后的那一刻——不摆回。不覆盖的：递归
 * 删除整棵目录树是一次接缝调用（终态移除 Demand 根就是），删到一半的样子挂不到；快照只在接缝调用或那次内容
 * 同步成功之后取，进程死在一次系统调用中途不在内；掉电后目录项与内容乱序落盘也不在内（那是第 3 步的组合
 * 状态）。工作区的 `.git` 与产品检出不在快照集里，各份快照共用（`snapshot-sweep-copy.ts`）。
 */

useDisposableDurability();

const DEMAND_ROOT = "workspace:.wakeflow-active/current/demand_<uuid>";

/**
 * 今天卡住的快照（`all` 范围；`locks` 范围里一个都没有）：没有公开调用治好它们。
 *
 * 19、20、24：终态事件追加的中途，与规划的扫点同一组残留（见 `storage-snapshot-sweep-plan.load.test.ts`）。status
 * 以 `precondition-failed/demand-inventory` 被拒（`src/capabilities/observation/service.ts:1162`）；再完成一次以
 * `precondition-failed/demand-authority-inventory` 被拒（原因理由 `inventory`）：根权威的第一次清点失败
 * （`src/governance/demand/event-sourcing/demand-event-sourcing-root-authority.ts:412`），打开 Demand 时加前缀
 * （`src/capabilities/demand/context.ts:237`），拒绝不带 `retryable`。reconcile 走到它真正的结束（两次 `completed`、
 * 一次 `no-op`），没有一次碰这些残留：Demand 运行时恢复只认追加候选
 * （`src/governance/demand/demand-runtime-recovery.ts`）。没有路标的两条路也被同一个拒绝挡下：完成的
 * `mode: recover`（`src/capabilities/demand/lifecycle.ts:1032`）在归档封好之前要打开 Demand，单独调用与 reconcile
 * 之后调用都以 `precondition-failed/demand-authority-inventory` 结束。拒绝它们的是清点
 * （`src/governance/demand/event-sourcing/demand-event-sourcing-root-inventory.ts`）：它不认 `index/` 里的空暂存名
 * （19，`:592`）、双链接的索引（20，`:208`，经 `:590`）与快照（24，`:208`，经 `:576`）。
 */
const STUCK_ON_TODAY: readonly SnapshotSweepStuckRow[] = snapshotSweepStuckRows(
  {
    status: "precondition-failed/demand-inventory",
    followUp: "precondition-failed/demand-authority-inventory<-inventory",
    routes: [
      "maintenance:reconcile:ok(completed,completed,no-op)",
      "unsignposted:wakeflow_complete_demand:recover:precondition-failed/demand-authority-inventory<-inventory",
      "unsignposted:maintenance:reconcile+wakeflow_complete_demand:recover:ok(completed,completed,no-op)+precondition-failed/demand-authority-inventory<-inventory",
    ],
    final:
      "status precondition-failed/demand-inventory; follow-up precondition-failed/demand-authority-inventory<-inventory",
  },
  [
    [19, "openExclusive", `${DEMAND_ROOT}/event-sourcing/index/.wakeflow-atomic-create-m600.tmp`],
    [20, "link", `${DEMAND_ROOT}/event-sourcing/index/0000000000000008.json`],
    [24, "link", `${DEMAND_ROOT}/event-sourcing/snapshots/0000000000000008.json`],
  ],
);

/**
 * 今天走有路标的出口才恢复的快照（`all` 范围）：`[序号, 出口]`。16（刚新建的空追加候选）、16.1（同一个候选写完
 * 并同步、还没链接进 `commits/`）：status 与再完成同上被拒，公开 reconcile 恢复追加候选（三次应用都报
 * `completed`），之后再完成照常做完、归档之后 continue 成功。
 */
const SIGNPOSTED_RECOVERY_ON_TODAY: readonly (readonly [number, string])[] = [
  [16, "maintenance:reconcile"],
  [16.1, "maintenance:reconcile"],
];

/**
 * 今天有路标的出口都走不通、走没有路标的路才恢复的快照（两个范围都断言，`locks` 只取摆回过的序号）：
 * `[序号, 路]`。上一轮这些点钉成卡住，手工试过的路现在由扫点自己走。
 *
 * 17、18、21–23、25–63（含归档候选成员写完并同步的 40.1–56.1、看板锁暂存的 58.1、看板替换暂存的 61.1）：终态
 * 事件已提交（完成的日志已写）、归档与看板收尾还没做完时进程死了。status 照常回答（17 先被清点拒绝，同 16）；
 * 再完成一次是直接应用，门以 `lifecycle:completed`（`src/capabilities/demand/decide.ts:200`）与 `route:not-ready`
 * 不过，以预览的形状交回、什么都不写（62、63 时看板已归档，另报 `package-claim:archived` 与
 * `verify:board-claim:fail`）。拒绝码不是 `recovery-required`、status 也照常，没有路标；reconcile 的应用报 `no-op`
 * （17 是三次 `completed`，收掉追加候选之后仍被门挡下）。从重新摆回的快照调用完成的 `mode: recover`，它按日志
 * 重放剩下的步骤（`src/capabilities/demand/lifecycle.ts:1032`），之后从归档 continue 成功。17 单独调用 recover 以
 * `precondition-failed/demand-authority-inventory` 被拒（追加候选刚链接进 `commits/`、还没退役，清点不认），先
 * reconcile 收掉它再 recover 才走通。
 * 这些点上 pod 变更锁（10 起）与看板锁（59–62）的死锁文件由 recover 与之后的 continue 清掉，治好之后只剩读者
 * 租约（见残留表）。
 */
const UNSIGNPOSTED_RECOVERY_ON_TODAY: readonly (readonly [number, string])[] = [
  [17, "maintenance:reconcile+wakeflow_complete_demand:recover"] as const,
  ...[
    18,
    ...[21, 22, 23],
    ...snapshotSweepSpan(25, 63),
    ...[40.1, 41.1, 42.1, 43.1, 44.1, 45.1, 46.1, 47.1, 48.1],
    ...[49.1, 50.1, 51.1, 52.1, 53.1, 54.1, 55.1, 56.1, 58.1, 61.1],
  ].map((index) => [index, "wakeflow_complete_demand:recover"] as const),
].sort(([left], [right]) => left - right);

/** 今天第一轮 status 被拒、变更跟进治好的快照（`all` 范围）：`[序号, status 的 code/reason]`。 */
const HEALED_AFTER_STATUS_REFUSAL_ON_TODAY: readonly (readonly [number, string])[] = [];

/**
 * 治好之后仍留着的 L1–L7 锁文件或锁暂存：`[路径, 个数, 序号]`（两个范围都断言，`locks` 只取摆回过的序号），是
 * 产品上的发现：子进程在 5 链接自己的读者租约（L2）、90 才删，每点留一个；死掉的读者租约只有独占获取才清
 * （排空时 `src/foundation/filesystem/rooted-read-write-scope.ts:285`），再完成、完成的 `mode: recover` 与 continue
 * 都是共享作用域。走 reconcile 治好的 16、16.1、17 没有残留（维护拿独占作用域），卡住的点不查。带小数的序号是
 * 内容同步之后的点（`all` 才有）。
 */
const LOCK_RESIDUE_ON_TODAY: readonly (readonly [number, string, number])[] =
  snapshotSweepResidueRows([
    [
      SNAPSHOT_SWEEP_READER_LEASE,
      1,
      [
        ...snapshotSweepSpan(5, 15),
        18,
        ...[21, 22, 23],
        ...snapshotSweepSpan(25, 89),
        ...[9.1, 13.1, 40.1, 41.1, 42.1, 43.1, 44.1, 45.1, 46.1, 47.1, 48.1, 49.1, 50.1],
        ...[51.1, 52.1, 53.1, 54.1, 55.1, 56.1, 58.1, 61.1, 66.1, 69.1, 72.1, 75.1, 79.1],
        ...[82.1, 84.1],
      ],
    ],
  ]);

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
  locks: [
    ...snapshotSweepSpan(0, 11),
    ...snapshotSweepSpan(57, 60),
    62,
    63,
    ...snapshotSweepSpan(65, 68),
    70,
    71,
    ...snapshotSweepSpan(77, 81),
    88,
    89,
    90,
  ],
  all: snapshotSweepAllPoints(
    90,
    [
      1.1, 4.1, 9.1, 13.1, 16.1, 40.1, 41.1, 42.1, 43.1, 44.1, 45.1, 46.1, 47.1, 48.1, 49.1, 50.1,
      51.1, 52.1, 53.1, 54.1, 55.1, 56.1, 58.1, 61.1, 66.1, 69.1, 72.1, 75.1, 79.1, 82.1, 84.1,
    ],
  ),
};

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
    unsignpostedRecoveryOf(report),
    withinSweptPoints(report, UNSIGNPOSTED_RECOVERY_ON_TODAY, ([index]) => index),
  );
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
