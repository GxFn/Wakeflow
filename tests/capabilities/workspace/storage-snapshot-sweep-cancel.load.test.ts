import { deepEqual } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  WAKEFLOW_DEMAND_CANCELLATION_PUBLIC_TOOL_NAME,
  WAKEFLOW_DEMAND_CREATION_PUBLIC_TOOL_NAME,
} from "../../../src/capabilities/demand/contract.js";
import { WAKEFLOW_STATUS_PUBLIC_TOOL_NAME } from "../../../src/capabilities/observation/contract.js";
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
import { publishSecondSnapshotSweepPackage } from "../../support/snapshot-sweep-workspaces.js";

/**
 * 级别 2（能力），真实进程：快照扫点（1.4.1 段 1b 的证明工具），取消一个 Demand 并归档。
 *
 * 子进程经真实 MCP 入口先预览、再带着预览的计划摘要应用取消（取消的事件追加、归档、看板锁 L4、pod 变更锁
 * L5、投影锁 L3、终态移除 Demand 根）；只有应用那一次调用的接缝点摆回，预览是铺垫。变更跟进：Demand 根还在
 * 就再取消一次（预览加应用）；根不在了，就从夹具另发布的第二份需求包在同一个 pod 上新建一个 Demand——取消掉
 * 的 Demand 不能再继续，而新建要拿 pod 变更锁、发布锁、看板锁与投影锁，并且只有待恢复的取消日志不再占着
 * pod 时才成功。场景的恢复调用是取消的 `mode: recover`（`operationId` 为 Demand id）。
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
 * 被拒绝点了名、照点名的恢复走通的快照：`[序号, 出口]`；两跳的出口用 `>` 连起来。与完成的扫点同形：
 * 16、16.1 是追加候选（`append-candidates-pending`，点着维护）；17 是 reconcile 之后再点取消的 recover；
 * 18–63 是终态事件已提交、日志还在，再取消以 `lifecycle-journal-pending` 被拒并点着 `wakeflow_cancel_demand`。
 */
const SIGNPOSTED_RECOVERY_ON_TODAY: readonly (readonly [number, string])[] = [
  ...[16, 16.1].map((index) => [index, "maintenance:reconcile"] as const),
  ...[17].map((index) => [index, "maintenance:reconcile>wakeflow_cancel_demand:recover"] as const),
  ...[
    ...snapshotSweepSpan(18, 63),
    ...[40.1, 41.1, 42.1, 43.1, 44.1, 45.1, 46.1, 47.1, 48.1, 49.1],
    ...[50.1, 51.1, 52.1, 53.1, 54.1, 55.1, 56.1, 58.1, 61.1],
  ].map((index) => [index, "wakeflow_cancel_demand:recover"] as const),
].sort(([left], [right]) => left - right);

/**
 * 拒绝没有点名、只有 status 点了名，照它走通的快照：`[序号, 出口]`。64、65：根已经改名退役（64）或退役根
 * 已删（65），日志还在。根不在，跟进是在同一个 pod 上从第二份需求包新建 Demand，它被日志的占用挡住
 * （`pod-busy`，这个拒绝不带出口）；带着 Demand 标识问的 status 的 `next` 是 `demand-recovery`、点着取消的
 * recover，照它走通之后新建成功。
 */
const STATUS_NAMED_RECOVERY_ON_TODAY: readonly (readonly [number, string])[] = [
  ...[64, 65].map((index) => [index, "wakeflow_cancel_demand:recover"] as const),
].sort(([left], [right]) => left - right);

/** 第一跳由拒绝点了名、而第一轮的 status 没有点着同一条工具的快照：`[序号, 出口]`。 */
const STATUS_UNNAMED_ON_TODAY: readonly (readonly [number, string])[] = [];

/** 第一轮 status 被拒、变更跟进治好的快照：`[序号, status 的 code/reason]`。 */
const HEALED_AFTER_STATUS_REFUSAL_ON_TODAY: readonly (readonly [number, string])[] = [];

/**
 * 治好之后仍留着的 L1–L7 锁文件或锁暂存：`[路径, 个数, 序号]`，是产品上的发现。子进程自己的读者租约（L2）从
 * 链接出来到它删掉之间每点留一个：死掉的读者租约只有独占获取才清，这里的跟进与恢复都是共享作用域（L10）。
 * 走 reconcile 治好的点没有残留（维护拿独占作用域）。
 * 62：第一份需求包的认领状态锁。持有者死在认领状态改写之后；recover 见认领已经结算就不再进这把锁，之后
 * 新建用的是第二份需求包，没有人再拿它（按记录命名的锁没人再拿，L10）。
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
    ["workspace:.wakeflow-active/current/board/locks/requirement_<uuid>.lock", 1, [62]],
  ]);

/** 治好之后仍留着的恢复记录（退役根、恢复用的暂存根、日志、发布标记、发布暂存树）：`[序号, 路径]`。 */
const RECOVERY_RESIDUE_ON_TODAY: readonly (readonly [number, string])[] = [];

/** 治好之后 Demand 根的三个目录里仍留着的原子暂存：`[路径, 个数, 序号]`。 */
const STAGE_RESIDUE_ON_TODAY: readonly (readonly [number, string, number])[] = [];

/**
 * 掉电的盘面（只在 `all` 范围生成）：`[归类, 位置…]`。与完成的扫点同形：到 15~1 一轮治好，17~1 到 63~1 照
 * 拒绝点名的 recover 走通；64~1、65~1 与被杀的 64、65 一样只有 status 点了名；66~1 起一轮治好。没有卡住的，
 * 也没有治好之后留下恢复记录的。
 */
const POWER_LOSS_ON_TODAY: readonly (readonly [string, string])[] = snapshotSweepPowerLossRows([
  [
    "healed",
    [
      ..."7~1 8~1 12~1 14~1 15~1 66~1 71~1 72~1 74~1 75~1".split(" "),
      ..."77~1 78~1 79~1 84~1 86~1 87~1 88~1 90~1 91~1".split(" "),
    ],
  ],
  [
    "signposted:wakeflow_cancel_demand:recover",
    [
      ..."17~1 18~1 27~1 56~1 56~2 56~3 56~4 56~5 56~6 56~7".split(" "),
      ..."56~8 56~9 56~10 56~11 56~12 57~1 62~1 63~1".split(" "),
    ],
  ],
  ["status-named:wakeflow_cancel_demand:recover", "64~1 65~1".split(" ")],
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
    16,
    18,
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

function initializeSweepGitRepository(root: string): void {
  const initialized = spawnSync("git", ["-c", "init.defaultBranch=main", "init", "--quiet"], {
    cwd: root,
    encoding: "utf8",
    shell: false,
  });
  if (initialized.status !== 0) throw new Error("Cannot initialize the sweep workspace Git.");
}

test("快照扫点：取消 Demand 的每一步之后进程死亡或掉电，下一条 status 与再取消或 continue 照常完成或走点名的出口", {
  timeout: 1_800_000,
}, async (t) => {
  if (loadSensitive(t, "a real MCP child process and one restore per seam call")) return;
  const fixture = await createAcceptedDemandCompletionWorkspaceFixture();
  t.after(() => cleanupAcceptedDemandCompletionWorkspaceFixture(fixture));
  const root = realpathSync(fixture.workspacePath);
  // reconcile 要工作区根上有 `.git` 才走得到它真正的结束；`.git` 不在快照集里，各份快照共用。
  initializeSweepGitRepository(root);
  const demandId = fixture.demandId;
  // 第二份需求包在子进程启动之前发布：它在每一份快照里都在。
  const secondRequirementId = await publishSecondSnapshotSweepPackage(root);
  const demandRootExists = () =>
    existsSync(path.join(root, ...demandFinalRootRef(demandId).split("/")));
  const cancel = {
    name: WAKEFLOW_DEMAND_CANCELLATION_PUBLIC_TOOL_NAME,
    arguments: { root, demandId, reason: "快照扫点：取消" },
  };
  const report = await runSnapshotSweep(t, {
    name: "demand-cancel",
    set: { workspace: root, ledger: ledgerRootOf(root) },
    calls: [
      { name: cancel.name, arguments: { ...cancel.arguments, mode: "preview" } },
      ([preview]) => ({
        name: cancel.name,
        arguments: { ...cancel.arguments, mode: "apply", planDigest: preview?.planDigest },
      }),
    ],
    sweepFromCall: 1,
    statusArguments: { root, demandId },
    demandId: () => demandId,
    powerLoss: true,
    // 段 1b 改过的每条恢复路线的代表点（都不挨着锁操作，缺省范围不列就不摆回）：终态事件的追加候选
    // （16）、终态日志还在（18）、根改名退役与删退役根——只有 status 点名的那两点（64、65）。
    routePoints: [16, 18, 64, 65],
    async followUp(invoke): Promise<SnapshotSweepOutcome> {
      if (demandRootExists()) {
        const cancelled = await previewThenApply(invoke, cancel);
        if (!cancelled.ok) return cancelled;
        if (demandRootExists()) {
          return {
            ok: false,
            code: "follow-up-incomplete",
            reason: "demand-root-present",
            details: {},
          };
        }
      }
      // 新建只看日志还占不占着 pod；第一份需求包的认领有没有结算要另查：看板上不能还有认领中的包。
      const board = await invoke({ name: WAKEFLOW_STATUS_PUBLIC_TOOL_NAME, arguments: { root } });
      if (!board.ok) return board;
      const claimed = (board.value.board as { counts?: { claimed?: unknown } } | undefined)?.counts
        ?.claimed;
      if (claimed !== 0) {
        return {
          ok: false,
          code: "follow-up-incomplete",
          reason: "package-claim-unsettled",
          details: {},
        };
      }
      return invoke({
        name: WAKEFLOW_DEMAND_CREATION_PUBLIC_TOOL_NAME,
        arguments: {
          root,
          mode: "apply",
          requirementId: secondRequirementId,
          demand: {
            title: "快照扫点：取消之后",
            goal: "取消留下的锁与日志不挡住同一个 pod 上的下一个 Demand。",
            completionDefinition: "新建成功。",
          },
        },
      });
    },
    recover: () => ({
      name: WAKEFLOW_DEMAND_CANCELLATION_PUBLIC_TOOL_NAME,
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
