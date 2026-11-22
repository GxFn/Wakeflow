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
  previewThenApply,
  runSnapshotSweep,
  SNAPSHOT_SWEEP_READER_LEASE,
  type SnapshotSweepOutcome,
  type SnapshotSweepScope,
  signpostedRecoveryOf,
  snapshotSweepAllPoints,
  snapshotSweepResidueRows,
  snapshotSweepRowDiagnostics,
  snapshotSweepSpan,
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
 * 跟进，归为 healed、signposted-recovery、unsignposted-recovery 或 stuck（`snapshot-sweep-harness.ts`）。变更跟进是
 * "同一个请求再发一次"（ADR-0031：被打断的发布靠重发做完），再撤回同一个包：记录已在时重放不进 L7 与 L4，
 * 撤回才在 L4 里改写看板状态，留下的死看板锁由它清。
 *
 * 每一份快照上跑一轮：status、变更跟进（不管 status 的结局）、跟进成功之后再一次 status；失败时依次走有路标的
 * 出口（重试、发布的 `mode: recover`、维护的 recover、公开的 reconcile），都走不通再从重新摆回的快照试没有路标的
 * 路（发布的 `mode: recover`，reconcile 之后的 `mode: recover`）；治好之后查 L1–L7 的锁残留。范围见
 * `snapshot-sweep-harness.ts`：`locks`（缺省）摆回 L1–L7 锁操作的前后，`all`（`WAKEFLOW_SNAPSHOT_SWEEP_SCOPE=all`）
 * 摆回每一份并加上内容同步之后的那些。两个范围都要求一份都不卡住，并断言走有路标的出口、走没有路标的路
 * 与留着锁残留的恰好是各自表里的那些（`locks` 只取摆回过的序号）。
 *
 * 摆回的是什么：每一个暂存、候选或树成员都在两个时刻摆回——排他新建刚返回、内容还没写的空文件，以及它被
 * 链接或改名之后；`all` 范围另在经接缝排他新建的每个文件内容同步之后摆回一次（内容完整、权限位已改、还没
 * 发布；序号是前一次接缝调用的序号加一位小数，例如 12.1）。中间的状态——内容写了一半、写完还没改权限位，
 * 以及 `locks` 范围里内容同步之后的那一刻——不摆回。不覆盖的：递归删除整棵目录树是一次接缝调用，删到一半的
 * 样子挂不到；快照只在接缝调用或那次内容同步成功之后取，进程死在一次系统调用中途不在内；掉电后目录项与
 * 内容乱序落盘也不在内（那是第 3 步的组合状态）。工作区的 `.git` 与产品检出不在快照集里，各份快照共用
 * （`snapshot-sweep-copy.ts`）。
 */

useDisposableDurability();

/*
 * 今天卡住的快照：没有（两个范围都断言卡住的表为空）。上一轮钉住的 11–14（需求记录树的暂存目录
 * `transactions/.<id>.stage` 刚 mkdir——那时它以 0700 出生、权限位还没改，现在不被 umask 收窄时直接以
 * 请求的权限位出生——或成员刚排他新建、内容为空）现在第一轮就治好：重放拿到
 * 记录锁、final 不在时，发布者把补不了的暂存整棵删掉、用这次已校验的输入重建
 * （`src/governance/ledger/ledger-record-publisher.ts` 的 `stageCandidate`）。21 改记为重试治好，见下表。
 */

/**
 * 今天走有路标的出口才恢复的快照（`all` 范围）：`[序号, 出口]`。
 * 21：看板状态文件刚从创建暂存链接出来、暂存还没退役（两个链接）时进程死了。重放照常成功；撤回在看板锁里
 * 整文件替换，写入之前先退役同一目标的遗留暂存（`src/foundation/filesystem/durable-atomic-file-write.ts:174`），
 * 目标的链接数从 2 变 1，替换的预检于是看到目标节点已不是读到的那一个（`expectation-changed`，同文件 `:147`），
 * `src/kernel/requirement-board.ts:600` 报成可重试的 `concurrency-conflict/claim-state-changed`。照信封重试一次，
 * 重读到的是退役之后的节点，撤回成功。上一轮把它钉成卡住，因为扫点从不重试。
 */
const SIGNPOSTED_RECOVERY_ON_TODAY: readonly (readonly [number, string])[] = [[21, "retry"]];

/** 今天有路标的出口都走不通、走没有路标的路才恢复的快照（`all` 范围）：没有。 */
const UNSIGNPOSTED_RECOVERY_ON_TODAY: readonly (readonly [number, string])[] = [];

/** 今天第一轮 status 被拒、变更跟进治好的快照（`all` 范围）：`[序号, status 的 code/reason]`。 */
const HEALED_AFTER_STATUS_REFUSAL_ON_TODAY: readonly (readonly [number, string])[] = [];

/**
 * 治好之后仍留着的 L1–L7 锁文件或锁暂存：`[路径, 个数, 序号]`（两个范围都断言，`locks` 只取摆回过的序号），
 * 都是产品上的发现：
 * - 读者租约（L2），每点一个：子进程在 5 链接自己的读者租约、30 才删。死掉的读者租约只有独占获取才清（排空时
 *   `src/foundation/filesystem/rooted-read-write-scope.ts:285` 经 `held` 退休失效的租约），共享获取只在租约攒到
 *   64 个时才清（同文件 `:264`）。跟进全是共享作用域，所以它留到下一次维护。带小数的序号是内容同步之后的那些
 *   点（`all` 范围才有）。
 * - 账本记录锁（L7）：15 时记录目录已改名到位、锁还拿着。重放读到已有记录就返回（`ensureRecord`，
 *   `src/capabilities/requirement/service.ts:709`），不进账本存储的锁恢复
 *   （`src/governance/ledger/ledger-record-publisher.ts:292`）；这把锁按记录标识命名、标识由内容推出，之后没有
 *   任何公开调用会再拿它，死锁文件永久留在 `transactions/` 里。释放与清理重新同步父目录（第 1 段的锁裁决）
 *   不改变这一点：被杀的进程根本没走到释放。
 */
const LOCK_RESIDUE_ON_TODAY: readonly (readonly [number, string, number])[] =
  snapshotSweepResidueRows([
    [
      SNAPSHOT_SWEEP_READER_LEASE,
      1,
      [...snapshotSweepSpan(5, 29), 8.1, 12.1, 13.1, 14.1, 17.1, 20.1, 24.1, 27.1],
    ],
    ["ledger:transactions/requirement_<uuid>.lock", 1, [15]],
  ]);

/**
 * 摆回过的序号，按范围钉住（`sweptIndicesOf`）：`locks` 是第 0 份与 L1–L7 锁操作前后的那些，`all` 是每一份加上
 * 内容同步之后带小数的那些。一轮就治好的点不在上面任何一张表里，靠这里看住它们确实摆回过。
 */
const SWEPT_POINTS_ON_TODAY: Readonly<Record<SnapshotSweepScope, readonly number[]>> = {
  locks: [
    ...snapshotSweepSpan(0, 10),
    ...snapshotSweepSpan(15, 19),
    ...snapshotSweepSpan(22, 26),
    28,
    29,
    30,
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
  });
  t.diagnostic(summarizeSnapshotSweep(report));
  for (const line of snapshotSweepRowDiagnostics(report)) t.diagnostic(line);
  deepEqual(lockFamiliesOf(report.seam), [
    "L1 operation-scope latch and writer",
    "L2 reader leases",
    "L4 board locks",
    "L7 ledger record lock",
  ]);
  deepEqual(stuckRowsOf(report), []);
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
