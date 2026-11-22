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
import { publishedSnapshotSweepWorkspace } from "../../support/snapshot-sweep-workspaces.js";

/**
 * 级别 2（能力），真实进程：快照扫点（1.4.1 第 1 段清单 2.4 第 2 步），认领需求包创建 Demand。
 *
 * 子进程经真实 MCP 入口做一次创建的 apply（Demand 发布锁 L6、pod 变更锁 L5、看板锁 L4、投影锁 L3、Demand 根
 * 的暂存树与改名），每经过一次变更接缝拷一份快照（`tests/support/snapshot-sweep-process.ts`）；本进程逐份摆回
 * 原处，跑只读的 status 与变更跟进，归为 healed、signposted-recovery、unsignposted-recovery 或 stuck
 * （`snapshot-sweep-harness.ts`）。变更跟进是"同一个请求再发一次"（ADR-0031：被打断的创建靠重发做完），再撤销
 * 这个 Demand：看板认领写好之后重发是被门挡下的直接应用（`apply-blocked/package-claim:claimed,…`，扫点把它当作
 * 创建已越过认领），不再进 L5、L6、L4 与 L3，撤销才在 L5 里改写看板（L4 与看板索引锁）并刷新投影（L3），留下的
 * 死锁由它清。场景的恢复调用是创建的 `mode: recover`（`operationId` 为 Demand id）：拒绝码是 `recovery-required`
 * 时是有路标的出口，有路标的都走不通时作为没有路标的路再试。
 *
 * 每一份快照上跑一轮：status、变更跟进（不管 status 的结局）、跟进成功之后再一次 status；失败时依次走有路标的
 * 出口（重试、创建的 `mode: recover`、维护的 recover、公开的 reconcile），都走不通再从重新摆回的快照试没有路标的
 * 路；治好之后查 L1–L7 的锁残留。范围见 `snapshot-sweep-harness.ts`：`locks`（缺省）摆回 L1–L7 锁操作的前后，
 * 要求一份都不卡住；`all`（`WAKEFLOW_SNAPSHOT_SWEEP_SCOPE=all`）摆回每一份并加上内容同步之后的那些，断言卡住的
 * 恰好是显式表里的那些；两个范围都断言走有路标的出口、走没有路标的路与留着锁残留的恰好是各自表里的那些
 * （`locks` 只取摆回过的序号）。
 *
 * 摆回的是什么：每一个暂存、候选或树成员都在两个时刻摆回——排他新建刚返回、内容还没写的空文件，以及它被
 * 链接或改名之后；`all` 范围另在经接缝排他新建的每个文件内容同步之后摆回一次（内容完整、权限位已改、还没
 * 发布；序号是前一次接缝调用的序号加一位小数，例如 21.1 是暂存树里写完并同步、还没链接的发布标记）。中间的
 * 状态——内容写了一半、写完还没改权限位，以及 `locks` 范围里内容同步之后的那一刻——不摆回；不同步内容的写入
 * （暂存树里的索引暂存）也就没有那一份。不覆盖的：递归删除整棵目录树是一次接缝调用，删到一半的样子挂不到；
 * 快照只在接缝调用或那次内容同步成功之后取，进程死在一次系统调用中途不在内；掉电后目录项与内容乱序落盘也
 * 不在内（那是第 3 步的组合状态）。工作区的 `.git` 与产品检出不在快照集里，各份快照共用
 * （`snapshot-sweep-copy.ts`）。
 */

useDisposableDurability();

const STAGE_ROOT = "workspace:.wakeflow-active/current/demand-publication/stages/demand_<uuid>";

/**
 * 今天卡住的快照（`all` 范围；`locks` 范围里一个都没有）：没有公开调用治好它们。status 照常回答；同一个创建
 * 请求重发以 `precondition-failed/publication-conflict` 被拒（原因理由 `conflict`：发布存储报 `conflict`，
 * `src/capabilities/demand/service.ts:357` 加前缀），拒绝不带 `retryable`；拒绝码不是 `recovery-required`，没有
 * 路标指向创建的 `mode: recover`；reconcile 的应用报 `no-op`，不认这些暂存树。没有路标的两条路也走不通：从重新
 * 摆回的快照单独调用创建的 `mode: recover`，它重放同一次发布（`applyPublication`），以同一个拒绝结束；reconcile
 * 仍是 `no-op`，于是不再调用 recover。拒绝它们的检查：
 * 22、32、35、41：暂存树里的一个文件刚链接、它的创建暂存还没退役（两个链接），发布存储的节点检查只收一个
 * 链接（`src/governance/demand/publication/demand-event-sourcing-publication-storage.ts:138`，`:141` 报 `conflict`）；
 * 40：暂存树的 `event-sourcing/index/` 里有一个刚排他新建的空暂存（索引写入不同步内容，所以没有 40.1）：补齐暂存树
 * 时它不被认（按代码阅读，未逐行复现：暂存树的清点
 * `src/governance/demand/event-sourcing/demand-event-sourcing-root-inventory.ts:592`，由
 * `src/governance/demand/publication/demand-event-sourcing-publication-stage.ts:146` 调用，或事件存储读索引时），
 * `mapStageError`（同文件 `:75`）把它报成 `conflict`。
 * 暂存树里同一批文件写完并同步、还没链接的那一刻（21.1、31.1、34.1）不卡：那时只有一个链接的死暂存，重发照常
 * 做完。
 */
const STUCK_ON_TODAY: readonly SnapshotSweepStuckRow[] = snapshotSweepStuckRows(
  {
    status: "ok",
    followUp: "precondition-failed/publication-conflict<-conflict",
    routes: [
      "maintenance:reconcile:not-completed/no-op",
      "unsignposted:wakeflow_create_demand:recover:precondition-failed/publication-conflict<-conflict",
      "unsignposted:maintenance:reconcile+wakeflow_create_demand:recover:not-completed/no-op",
    ],
    final: "status ok; follow-up precondition-failed/publication-conflict<-conflict",
  },
  [
    [22, "link", `${STAGE_ROOT}/transactions/publication.json`],
    [32, "link", `${STAGE_ROOT}/identity.json`],
    [35, "link", `${STAGE_ROOT}/authority.json`],
    [40, "openExclusive", `${STAGE_ROOT}/event-sourcing/index/.wakeflow-atomic-create-m600.tmp`],
    [41, "link", `${STAGE_ROOT}/event-sourcing/index/0000000000000001.json`],
  ],
);

/** 今天走有路标的出口才恢复的快照（`all` 范围）：没有。 */
const SIGNPOSTED_RECOVERY_ON_TODAY: readonly (readonly [number, string])[] = [];

/**
 * 今天有路标的出口都走不通、走没有路标的路才恢复的快照（两个范围都断言，`locks` 只取摆回过的序号）：
 * `[序号, 路]`。51–58（含 53.1 看板索引锁的创建暂存、56.1 看板 `index.md` 的替换暂存，各自写完并同步之后）：
 * Demand 根已改名到位、看板认领已写好，Demand 根里的发布标记 `transactions/publication.json` 还没删（59 才删）
 * 时进程死了。status 照常回答，重发被门挡下（认领已写好）；撤销以 `precondition-failed/demand-authority-inventory`
 * 被拒（原因理由 `inventory`）：Demand 根清点在健康阶段只收空的 `transactions/`
 * （`src/governance/demand/event-sourcing/demand-event-sourcing-root-inventory.ts:523`），打开 Demand 时加前缀
 * （`src/capabilities/demand/context.ts:237`）。拒绝码不是 `recovery-required`、status 也照常，没有路标；reconcile 的
 * 应用报 `no-op`。从重新摆回的快照单独调用创建的 `mode: recover`（`operationId` 为 Demand id）收尾发布、删掉标记，
 * 之后的撤销成功。
 */
const UNSIGNPOSTED_RECOVERY_ON_TODAY: readonly (readonly [number, string])[] = [
  51, 52, 53, 53.1, 54, 55, 56, 56.1, 57, 58,
].map((index) => [index, "wakeflow_create_demand:recover"] as const);

/** 今天第一轮 status 被拒、变更跟进治好的快照（`all` 范围）：`[序号, status 的 code/reason]`。 */
const HEALED_AFTER_STATUS_REFUSAL_ON_TODAY: readonly (readonly [number, string])[] = [];

/**
 * 治好之后仍留着的 L1–L7 锁文件或锁暂存：`[路径, 个数, 序号]`（两个范围都断言，`locks` 只取摆回过的序号），
 * 都是产品上的发现：
 * - 读者租约（L2），每点一个：子进程在 5 链接自己的读者租约、78 才删；死掉的读者租约只有独占获取才清（排空时
 *   `src/foundation/filesystem/rooted-read-write-scope.ts:285`），跟进与创建的 `mode: recover` 都是共享作用域。
 *   卡住的点不查。带小数的序号是内容同步之后的点（`all` 才有）。
 * - Demand 发布锁（L6）：59 时发布标记已删、锁还拿着。之后只有同一个 Demand 的发布与创建恢复会清这把锁
 *   （`src/governance/demand/publication/demand-event-sourcing-publication-service.ts:362`、`:505`），标记已删时
 *   两者都不会再走到（重发被门挡下；恢复读不到标记，在取锁之前以 `not-found` 结束，同文件 `:502`，按代码阅读）；
 *   撤销不拿它。死锁文件永久留下；释放重新同步父目录不改变这一点，被杀的进程没走到释放。51–58 走创建的
 *   `mode: recover` 治好之后没有这把锁：恢复先清掉死锁再收尾。
 */
const LOCK_RESIDUE_ON_TODAY: readonly (readonly [number, string, number])[] =
  snapshotSweepResidueRows([
    [
      SNAPSHOT_SWEEP_READER_LEASE,
      1,
      [
        ...snapshotSweepSpan(5, 21),
        ...snapshotSweepSpan(23, 31),
        33,
        34,
        ...snapshotSweepSpan(36, 39),
        ...snapshotSweepSpan(42, 77),
        ...[9.1, 16.1, 21.1, 31.1, 34.1, 37.1, 47.1, 50.1, 53.1, 56.1],
        ...[62.1, 67.1, 69.1, 71.1, 74.1],
      ],
    ],
    ["workspace:.wakeflow-active/current/demand-publication/locks/demand_<uuid>.lock", 1, [59]],
  ]);

/**
 * 摆回过的序号，按范围钉住（`sweptIndicesOf`）：`locks` 是第 0 份与 L1–L7 锁操作前后的那些，`all` 是每一份加上
 * 内容同步之后带小数的那些。一轮就治好的点不在上面任何一张表里，靠这里看住它们确实摆回过。
 */
const SWEPT_POINTS_ON_TODAY: Readonly<Record<SnapshotSweepScope, readonly number[]>> = {
  locks: [
    ...snapshotSweepSpan(0, 11),
    ...snapshotSweepSpan(15, 18),
    ...snapshotSweepSpan(46, 49),
    ...snapshotSweepSpan(51, 55),
    ...snapshotSweepSpan(57, 64),
    76,
    77,
    78,
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
  timeout: 300_000,
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
