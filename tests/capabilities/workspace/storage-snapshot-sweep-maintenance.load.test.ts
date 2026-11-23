import { deepEqual } from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME } from "../../../src/capabilities/workspace/maintain-workspace.js";
import { executeCodexWakeflowMaintenance } from "../../../src/entrypoints/codex-wakeflow-maintenance.js";
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
  snapshotSweepRowDiagnostics,
  type SnapshotSweepScope,
  snapshotSweepSpan,
  type SnapshotSweepStuckRow,
  snapshotSweepStuckRows,
  stageResidueOf,
  statusNamedRecoveryOf,
  statusUnnamedOf,
  stuckRowsOf,
  summarizeSnapshotSweep,
  sweptIndicesOf,
  unsignpostedRecoveryOf,
  withinSweptPoints,
} from "../../support/snapshot-sweep-harness.js";
import { freshSnapshotSweepWorkspace } from "../../support/snapshot-sweep-workspaces.js";

/**
 * 级别 2（能力），真实进程：快照扫点（1.4.1 第 1 段清单 2.4 第 2 步），维护的独占作用域。
 *
 * 子进程经真实 MCP 入口做一次改名的 reconfigure apply（维护门 L9 加独占的操作作用域 L1），每经过一次变更接缝
 * 就拷一份快照（`tests/support/snapshot-sweep-process.ts`）；本进程按顺序把每一份摆回原处，跑一次只读的
 * status 和再一次 reconfigure，归为 healed、signposted-recovery、
 * status-named-recovery、unsignposted-recovery 或 stuck
 * （`snapshot-sweep-harness.ts`）。维护的 recover 要 status 给出的操作 id；场景不另提供恢复调用。
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
 * 发布；序号是前一次接缝调用的序号加一位小数，例如 21.1）。中间的状态——内容写了一半、写完还没改权限位，以及
 * `locks` 范围里内容同步之后的那一刻——不摆回。不覆盖的：递归删除整棵目录树是一次接缝调用，删到一半的样子
 * 挂不到；快照只在接缝调用或那次内容同步成功之后取，所以"进程死在一次系统调用中途"不在内；掉电后目录项与
 * 内容乱序落盘也不在内（那是第 3 步的组合状态）。工作区的 `.git` 与产品检出不在快照集里，各份快照共用
 * （`snapshot-sweep-copy.ts`）。
 */

useDisposableDurability();

/**
 * 显式表：1.4.1 段 1b 之后的样子。表按 `all` 范围写，`locks` 范围只取摆回过的序号；改过存储路径之后的
 * 重钉办法见 `snapshot-sweep-harness.ts` 的 `WAKEFLOW_SNAPSHOT_SWEEP_DUMP`。
 */

/**
 * 没有任何公开调用治得好的快照（`all` 范围；`locks` 范围里一个都不许有），与段 1b 之前相同：19–22 是程序指令
 * 重组的锁与它的替换暂存，35–38 是配置权威的锁与它的替换暂存。这两把锁没有失效持有者的清理
 * （`wakeflow-program-instruction-recomposition.ts`、`wakeflow-config-authority-replacement.ts`），维护的 recover
 * 走到那一步就以 `io-failure/step` 失败（第 38 点 recover 自己过了，之后的 reconfigure 在同一处失败），
 * reconcile 的预览被维护协议挡住。不在段 1b 的范围里，登记在 L10。
 */
const STUCK_ON_TODAY: readonly SnapshotSweepStuckRow[] = [
  ...snapshotSweepStuckRows(
    {
      status: "ok",
      followUp: "preview-blocked/maintenance-protocol-recovery-required",
      routes: [
        "maintenance:recover:status:io-failure/step<-step",
        "unsignposted:maintenance:reconcile:preview-blocked/maintenance-protocol-recovery-required",
      ],
      final: "status ok; follow-up preview-blocked/maintenance-protocol-recovery-required",
    },
    [
      [19, "link", "workspace:.wakeflow-program-instruction-codex.lock"],
      [20, "unlink", "workspace:.wakeflow-atomic-create-m600.tmp"],
      [21, "openExclusive", "workspace:.wakeflow-atomic-replace-m644.tmp"],
      [21.1, "sync", "workspace:.wakeflow-atomic-replace-m644.tmp"],
    ],
  ),
  ...snapshotSweepStuckRows(
    {
      status: "ok",
      followUp:
        "preview-blocked/maintenance-protocol-recovery-required,program-instruction-unknown-managed-body",
      routes: [
        "maintenance:recover:status:io-failure/step<-step",
        "unsignposted:maintenance:reconcile:preview-blocked/maintenance-protocol-recovery-required,program-instruction-unknown-managed-body",
      ],
      final:
        "status ok; follow-up preview-blocked/maintenance-protocol-recovery-required,program-instruction-unknown-managed-body",
    },
    [[22, "rename", "workspace:AGENTS.md"]],
  ),
  ...snapshotSweepStuckRows(
    {
      status: "ok",
      followUp:
        "preview-blocked/maintenance-protocol-recovery-required,program-instruction-unknown-managed-body,support-memory-unadmitted-source",
      routes: [
        "maintenance:recover:status:io-failure/step<-step",
        "unsignposted:maintenance:reconcile:preview-blocked/maintenance-protocol-recovery-required,program-instruction-unknown-managed-body,support-memory-unadmitted-source",
      ],
      final:
        "status ok; follow-up preview-blocked/maintenance-protocol-recovery-required,program-instruction-unknown-managed-body,support-memory-unadmitted-source",
    },
    [
      [35, "link", "workspace:.wakeflow-config-authority.lock"],
      [36, "unlink", "workspace:.wakeflow-atomic-create-m600.tmp"],
      [37, "openExclusive", "workspace:.wakeflow-atomic-replace-m644.tmp"],
      [37.1, "sync", "workspace:.wakeflow-atomic-replace-m644.tmp"],
    ],
  ),
  ...snapshotSweepStuckRows(
    {
      status: "ok",
      followUp: "preview-blocked/maintenance-protocol-recovery-required",
      routes: [
        "maintenance:recover:status:ok",
        "unsignposted:maintenance:reconcile:preview-blocked/maintenance-protocol-recovery-required",
      ],
      final: "status ok; follow-up io-failure/step<-step",
    },
    [[38, "rename", "workspace:wakeflow.config.json"]],
  ),
];

/** 被拒绝点了名、照点名的恢复走通的快照：`[序号, 出口]`；两跳的出口用 `>` 连起来。 */
const SIGNPOSTED_RECOVERY_ON_TODAY: readonly (readonly [number, string])[] = [];

/**
 * 拒绝没有点名、只有 status 点了名，照它走通的快照：`[序号, 出口]`。reconfigure 的预览被维护协议挡住
 * （`maintenance-protocol-recovery-required`），这个阻塞项不带出口；status 的维护一栏说了是哪一种。
 * `maintenance:recover`：意图文件已经记下，维护一栏列着一个可恢复的操作，照它的操作标识 recover。
 * `maintenance:reconcile`：维护进程死在记下意图之前（1–15.1）或意图已经删掉之后（42、43），协议停在
 * `recovery-required` 而没有可恢复的操作；Controller 技能写明这时预览 reconcile，它给出收掉死闩的计划。
 */
const STATUS_NAMED_RECOVERY_ON_TODAY: readonly (readonly [number, string])[] = [
  ...[...snapshotSweepSpan(1, 15), 42, 43, ...[1.1, 4.1, 7.1, 11.1, 15.1]].map(
    (index) => [index, "maintenance:reconcile"] as const,
  ),
  ...[
    ...snapshotSweepSpan(16, 18),
    ...snapshotSweepSpan(23, 34),
    ...snapshotSweepSpan(39, 41),
    ...[18.1, 24.1, 26.1, 28.1, 30.1, 32.1, 34.1, 40.1],
  ].map((index) => [index, "maintenance:recover"] as const),
].sort(([left], [right]) => left - right);

/** 第一跳由拒绝点了名、而第一轮的 status 没有点着同一条工具的快照：`[序号, 出口]`。 */
const STATUS_UNNAMED_ON_TODAY: readonly (readonly [number, string])[] = [];

/** 第一轮 status 被拒、变更跟进治好的快照：`[序号, status 的 code/reason]`。 */
const HEALED_AFTER_STATUS_REFUSAL_ON_TODAY: readonly (readonly [number, string])[] = [];

/** 治好之后仍留着的 L1–L7 锁文件或锁暂存：`[路径, 个数, 序号]`。 */
const LOCK_RESIDUE_ON_TODAY: readonly (readonly [number, string, number])[] = [];

/** 治好之后仍留着的恢复记录（退役根、恢复用的暂存根、日志、发布标记、发布暂存树）：`[序号, 路径]`。 */
const RECOVERY_RESIDUE_ON_TODAY: readonly (readonly [number, string])[] = [];

/** 治好之后 Demand 根的三个目录里仍留着的原子暂存：`[路径, 个数, 序号]`。 */
const STAGE_RESIDUE_ON_TODAY: readonly (readonly [number, string, number])[] = [];

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
    0,
    ...snapshotSweepSpan(3, 14),
    ...snapshotSweepSpan(42, 54),
    ...snapshotSweepSpan(58, 64),
  ],
  all: snapshotSweepAllPoints(
    64,
    [
      1.1, 4.1, 7.1, 11.1, 15.1, 18.1, 21.1, 24.1, 26.1, 28.1, 30.1, 32.1, 34.1, 37.1, 40.1, 45.1,
      48.1, 52.1, 55.1, 57.1, 61.1,
    ],
  ),
};

function desiredConfig(root: string, displayName: string): Record<string, unknown> {
  const config = JSON.parse(readFileSync(path.join(root, "wakeflow.config.json"), "utf8")) as {
    program: { displayName: string };
  };
  config.program.displayName = displayName;
  return config;
}

test("快照扫点：reconfigure 的每一步之后进程死亡，下一条 status 与 reconfigure 照常完成或走维护出口", {
  timeout: 900_000,
}, async (t) => {
  if (loadSensitive(t, "a real MCP child process and one restore per seam call")) return;
  const workspace = await freshSnapshotSweepWorkspace(t);
  const root = workspace.root;
  const request = {
    root,
    action: "reconfigure",
    request: { desiredConfig: desiredConfig(root, "Swept") },
  } as const;
  const preview = await executeCodexWakeflowMaintenance({ ...request, mode: "preview" });
  if (preview.mode !== "preview" || preview.planDigest === null)
    throw new Error("Expected a ready reconfigure plan.");
  const report = await runSnapshotSweep(t, {
    name: "maintenance-reconfigure",
    set: { workspace: root, ledger: ledgerRootOf(root) },
    calls: [
      {
        name: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
        arguments: { ...request, mode: "apply", planDigest: preview.planDigest },
      },
    ],
    statusArguments: { root },
    followUp: (invoke, { index }) =>
      previewThenApply(invoke, {
        name: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
        arguments: {
          root,
          action: "reconfigure",
          request: { desiredConfig: desiredConfig(root, `Again ${index}`) },
        },
      }),
  });
  t.diagnostic(summarizeSnapshotSweep(report));
  for (const line of snapshotSweepRowDiagnostics(report)) t.diagnostic(line);
  deepEqual(lockFamiliesOf(report.seam), [
    "L1 operation-scope latch and writer",
    "L2 reader leases",
    "L3 projector lock",
    "L4 board locks",
    "L9 maintenance gate",
    "L10 config authority lock",
    "L12 program instruction lock",
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
