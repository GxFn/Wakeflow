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
  previewThenApply,
  runSnapshotSweep,
  type SnapshotSweepScope,
  type SnapshotSweepStuckRow,
  signpostedRecoveryOf,
  snapshotSweepAllPoints,
  snapshotSweepRowDiagnostics,
  snapshotSweepSpan,
  snapshotSweepStuckRows,
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
 * status 和再一次 reconfigure，归为 healed、signposted-recovery、unsignposted-recovery 或 stuck
 * （`snapshot-sweep-harness.ts`）。维护的 recover 要 status 给出的操作 id，已经在有路标的出口里；场景不另提供
 * 恢复调用，没有"没有路标的路"可试。
 *
 * 每一份快照上跑一轮：status、变更跟进（不管 status 的结局）、跟进成功之后再一次 status；失败时依次走有路标的
 * 出口（重试、维护的 recover、公开的 reconcile）；治好之后查 L1–L7 的锁残留（再一次 reconfigure 拿独占作用域，
 * 死掉的读者租约在排空时退休，今天没有残留）。范围见 `snapshot-sweep-harness.ts`：`locks`（缺省）摆回 L1–L7 锁
 * 操作的前后，要求一份都不卡住；`all`（`WAKEFLOW_SNAPSHOT_SWEEP_SCOPE=all`）摆回每一份并加上内容同步之后的那些，
 * 断言卡住的恰好是显式表里的那些、走出口的恰好是出口表里的那些；以后的修复让表变短。
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
 * 今天卡住的快照（`all` 范围）：工作区根上的两把权威锁在进程死后留在原处，没有失效持有者的清理（第 1 段清单 2.5 节
 * "配置、`.gitignore` 重组、程序指令重组三把锁"一行，已登记）。status 照常回答；再一次 reconfigure 的预览以
 * `maintenance-protocol-recovery-required` 被阻塞（维护门残留，
 * `src/workspace/maintenance/wakeflow-static-materialization-preview.ts:1188`），维护的 recover 在碰到这把锁的那一步
 * 等满 10 秒后超时（程序指令锁 `src/workspace/managed-integration/wakeflow-program-instruction-recomposition-contract.ts:316`，
 * 配置权威锁 `src/configuration/wakeflow-config-authority-replacement-contract.ts:510`），事务把步骤失败报成 `step`
 * （`src/workspace/maintenance/wakeflow-maintenance-execution-transaction.ts:530`），公共工具报 `io-failure/step`
 * （原因理由也是 `step`，不带 `retryable`）；reconcile 的预览同样被维护门残留阻塞。场景不另提供恢复调用，没有
 * 公开调用治好它们。
 * 19–22：程序指令锁 `.wakeflow-program-instruction-codex.lock` 已链接，直到 `AGENTS.md` 改名之后还在（21.1 是
 * `AGENTS.md` 的替换暂存写完并同步、还没改名的那一刻，结局与 21 相同；22 时新的
 * `AGENTS.md` 已经落地，预览另报 `program-instruction-unknown-managed-body`）；35–37：配置权威锁
 * `.wakeflow-config-authority.lock` 已链接（这时各支持面的 `AGENTS.md` 已改写，预览另报
 * `support-memory-unadmitted-source`；37.1 是配置的替换暂存写完并同步、还没改名的那一刻，结局与 37 相同）；38：配置已经改名，recover 走完，再一次 reconfigure 的 apply 照样卡在这把锁上。
 */
const STUCK_ON_TODAY: readonly SnapshotSweepStuckRow[] = [
  ...snapshotSweepStuckRows(
    {
      status: "ok",
      followUp: "preview-blocked/maintenance-protocol-recovery-required",
      routes: [
        "maintenance:recover:io-failure/step<-step",
        "maintenance:reconcile:preview-blocked/maintenance-protocol-recovery-required",
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
        "maintenance:recover:io-failure/step<-step",
        "maintenance:reconcile:preview-blocked/maintenance-protocol-recovery-required,program-instruction-unknown-managed-body",
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
        "maintenance:recover:io-failure/step<-step",
        "maintenance:reconcile:preview-blocked/maintenance-protocol-recovery-required,program-instruction-unknown-managed-body,support-memory-unadmitted-source",
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
        "maintenance:recover:ok",
        "maintenance:reconcile:preview-blocked/maintenance-protocol-recovery-required,program-instruction-unknown-managed-body,support-memory-unadmitted-source",
      ],
      final: "status ok; follow-up io-failure/step<-step",
    },
    [[38, "rename", "workspace:wakeflow.config.json"]],
  ),
];

/**
 * 今天走有路标的出口才恢复的快照（`all` 范围）：`[序号, 出口]`。所有点上 status 都照常回答，再一次 reconfigure 的
 * 预览以维护门残留被阻塞。status 列出可恢复的维护操作（事务意图已落地）时维护的 recover 治好它；没有时（意图还
 * 没链接，或已经退役）公开 reconcile 收掉维护门。1–15：维护门与独占作用域（L1）拿着、意图还没落地；16–18、
 * 23–34、39–41：意图在；42、43：意图已退役，写者锁与维护门还在。带小数的序号是同一段里某个文件写完并同步、
 * 还没发布的那一刻（`all` 才有），结局与所在的段相同。
 */
const SIGNPOSTED_RECOVERY_ON_TODAY: readonly (readonly [number, string])[] = [
  ...[1, 1.1, 2, 3, 4, 4.1, 5, 6, 7, 7.1, 8, 9, 10, 11, 11.1, 12, 13, 14, 15, 15.1].map(
    (index) => [index, "maintenance:reconcile"] as const,
  ),
  ...[16, 17, 18, 18.1, 23, 24, 24.1, 25, 26, 26.1, 27, 28, 28.1, 29, 30, 30.1].map(
    (index) => [index, "maintenance:recover"] as const,
  ),
  ...[31, 32, 32.1, 33, 34, 34.1, 39, 40, 40.1, 41].map(
    (index) => [index, "maintenance:recover"] as const,
  ),
  [42, "maintenance:reconcile"],
  [43, "maintenance:reconcile"],
];

/** 今天第一轮 status 被拒、变更跟进治好的快照（`all` 范围）：`[序号, status 的 code/reason]`。 */
const HEALED_AFTER_STATUS_REFUSAL_ON_TODAY: readonly (readonly [number, string])[] = [];

/** 治好之后仍留着的 L1–L7 锁文件或锁暂存：`[序号, 路径, 个数]`。今天没有。 */
const LOCK_RESIDUE_ON_TODAY: readonly (readonly [number, string, number])[] = [];

function desiredConfig(root: string, displayName: string): Record<string, unknown> {
  const config = JSON.parse(readFileSync(path.join(root, "wakeflow.config.json"), "utf8")) as {
    program: { displayName: string };
  };
  config.program.displayName = displayName;
  return config;
}

/**
 * 摆回过的序号，按范围钉住（`sweptIndicesOf`）：`locks` 是第 0 份与 L1–L7 锁操作前后的那些，`all` 是每一份加上
 * 内容同步之后带小数的那些。一轮就治好的点不在上面任何一张表里，靠这里看住它们确实摆回过。
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
  // 维护的 recover 要 status 给出的操作 id，已经是有路标的出口；场景不另提供恢复调用，没有"没有路标的路"可试。
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
