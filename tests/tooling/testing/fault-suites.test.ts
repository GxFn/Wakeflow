import { deepEqual, equal, ok, rejects } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { runToolingCli } from "../../../tooling/cli.js";
import { listFaultSuites } from "../../../tooling/testing/fault-suites.js";
import {
  countSnapshotSweepResidue,
  type SnapshotSweepReport,
  snapshotSweepAllPoints,
  withinSweptPoints,
} from "../../support/snapshot-sweep-harness.js";

/**
 * 级别 4（维护者工具）：`wf fault list|run` 的套件目录只选仓库里已有的测试文件，不自称覆盖原生宿主或统一的 fsync。
 */

test("fault matrix selects existing source regressions and never claims native or uniform fsync coverage", async () => {
  const catalog = listFaultSuites();
  equal(catalog.nativeHostAcceptance, "unverified");
  equal(catalog.autoRetry, false);
  equal(catalog.durability, "existing-test-specific-contracts-unchanged");
  for (const suite of catalog.suites) {
    ok(suite.invariant.length > 0);
    for (const file of suite.files)
      ok(file.startsWith("tests/") && file.endsWith(".test.ts") && existsSync(path.resolve(file)));
  }
  deepEqual(await runToolingCli(["fault", "list"], process.cwd()), catalog);
  await rejects(
    runToolingCli(["fault", "run", "--suite", "made-up"], process.cwd()),
    /Invalid command arguments/u,
  );
});

/** 不变式的原文：按扫点与锁残留组合测试真正断言的写，改断言就要改这里（与套件目录逐字相同）。 */
const STORAGE_SWEEP_INVARIANT =
  "Each replayed kill point of a snapshot-sweep file falls in exactly one of five classes: healed by the first round (status, the mutating follow-up, status again, and that last status names no recovery; a point whose first status is refused while the follow-up still heals it is pinned in the file's healed-after-status-refusal table); healed by following named recoveries only, at most three hops - a retry when the refusal is retryable, the tool a recovery-required refusal names in details.tool with the id it gives (details.operationId, or details.demandId for the evidence tool; it must be the scenario's declared Demand), or for the maintenance tool its recover or reconcile (signposted, pinned by index with its route); healed the same way where at least one hop was named only by a status result - maintenance first: a recoverable maintenance residue or a maintenance protocol left in recovery-required; then next naming demand-recovery (it counts only when status was asked with the Demand id) or a nextActions entry naming it for the Demand (status-named, pinned by index); healed only by a route nothing named, tried from the restored kill point (unsignposted: every file asserts there is none); or stuck, pinned with the refusal that no public call gets past and asserted empty in the default scope. A follow-up that calls nothing never counts as healing. Each file also pins the points whose first hop a refusal named while the first status did not name the same tool. At every point that is not stuck, each file pins what is left after healing: by index, path and count the L1-L7 lock and lease files and the atomic stages that point at them; by index and path the recovery records (a renamed-away root, a restore candidate, the lifecycle journal, the publication marker, the publication stage tree); by index, path and count the atomic stages in the Demand root's index, snapshot and task-package directories. Each file also pins the indices it replayed in each scope, and in the full scope the class of one power-loss state per directory sync that covers a new entry change, with at most one reader lease, the locks other than reader leases and the recovery records left after healing it. The lock-residue-combinations files assert that the next acquisition or scope entry clears every combination of dead locks, leases and create stages they leave, except dead reader leases under shared entry, and leaves live owners untouched.";

/**
 * 每个扫点文件末尾那一段断言的全文（去掉注释、空白与多行写法的尾逗号之后）：从卡住的表到摆回的序号，
 * 一条不多一条不少，右边就是这里写的那一项。注释掉的、被范围条件包住的、或自己比自己的断言都对不上。
 */
const SWEEP_ASSERTIONS: readonly string[] = [
  'deepEqual(stuckRowsOf(report), report.scope === "locks" ? [] : STUCK_ON_TODAY);',
  "deepEqual(signpostedRecoveryOf(report), withinSweptPoints(report, SIGNPOSTED_RECOVERY_ON_TODAY, ([index]) => index));",
  "deepEqual(statusNamedRecoveryOf(report), withinSweptPoints(report, STATUS_NAMED_RECOVERY_ON_TODAY, ([index]) => index));",
  "deepEqual(statusUnnamedOf(report), withinSweptPoints(report, STATUS_UNNAMED_ON_TODAY, ([index]) => index));",
  "deepEqual(unsignpostedRecoveryOf(report), []);",
  "deepEqual(healedAfterStatusRefusalOf(report), withinSweptPoints(report, HEALED_AFTER_STATUS_REFUSAL_ON_TODAY, ([index]) => index));",
  "deepEqual(lockResidueOf(report), withinSweptPoints(report, LOCK_RESIDUE_ON_TODAY, ([index]) => index));",
  "deepEqual(recoveryResidueOf(report), withinSweptPoints(report, RECOVERY_RESIDUE_ON_TODAY, ([index]) => index));",
  "deepEqual(stageResidueOf(report), withinSweptPoints(report, STAGE_RESIDUE_ON_TODAY, ([index]) => index));",
  'deepEqual(powerLossVerdictsOf(report), report.scope === "all" ? POWER_LOSS_ON_TODAY : []);',
  "deepEqual(powerLossLockResidueOf(report).filter(([, entry, count]) => entry === SNAPSHOT_SWEEP_READER_LEASE && count > 1), []);",
  'deepEqual(powerLossLockResidueOf(report).filter(([, entry]) => entry !== SNAPSHOT_SWEEP_READER_LEASE), report.scope === "all" ? POWER_LOSS_LOCK_RESIDUE_ON_TODAY : []);',
  'deepEqual(powerLossRecoveryResidueOf(report), report.scope === "all" ? POWER_LOSS_RECOVERY_RESIDUE_ON_TODAY : []);',
  "deepEqual(sweptIndicesOf(report), SWEPT_POINTS_ON_TODAY[report.scope]);",
  "});",
];

/** 去掉整行注释、全部空白与多行写法里收尾的逗号：只留下可以逐字比较的代码。 */
function compactCode(source: string): string {
  return source
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("")
    .replace(/\s+/gu, "")
    .replace(/,(?=[)\]])/gu, "");
}

const SWEEP_ASSERTIONS_START = "\n  deepEqual(stuckRowsOf(report)";

test("storage-sweep suite lists every snapshot-sweep and lock-residue file, names the full-sweep variable and states exactly what the files assert", () => {
  const suite = listFaultSuites().suites.find((entry) => entry.name === "storage-sweep");
  ok(suite !== undefined && "description" in suite);
  const present = (directory: string, pattern: RegExp) =>
    readdirSync(path.resolve(directory))
      .filter((name) => pattern.test(name))
      .map((name) => `${directory}/${name}`);
  const sweeps = present(
    "tests/capabilities/workspace",
    /^storage-snapshot-sweep-.*\.load\.test\.ts$/u,
  ).sort();
  deepEqual(
    [...suite.files].sort(),
    [
      ...sweeps,
      ...present("tests/foundation/filesystem", /^lock-residue-combinations.*\.load\.test\.ts$/u),
    ].sort(),
  );
  ok(suite.description.includes("WAKEFLOW_SNAPSHOT_SWEEP_SCOPE=all"));
  equal(suite.invariant, STORAGE_SWEEP_INVARIANT);
  // 不变式点名的每一张表与摆回的序号，每个扫点文件都要真的断言：文件末尾那一段逐字就是上面的清单。
  const zeroStuck: string[] = [];
  const expected = compactCode(SWEEP_ASSERTIONS.join("\n"));
  for (const file of sweeps) {
    const source = readFileSync(path.resolve(file), "utf8");
    const start = source.indexOf(SWEEP_ASSERTIONS_START);
    ok(start > 0 && source.indexOf(SWEEP_ASSERTIONS_START, start + 1) === -1, file);
    equal(compactCode(source.slice(start)), expected, file);
    const scenario =
      /^tests\/capabilities\/workspace\/storage-snapshot-sweep-(.*)\.load\.test\.ts$/u.exec(
        file,
      )?.[1];
    ok(scenario !== undefined);
    // 清单里卡住的表在 `locks` 范围里为空：每个场景都在"缺省范围零卡住点"之列。哪个文件改成钉住的行，
    // 上面的逐字比较先失败，那时这里与描述要一起改。
    zeroStuck.push(scenario);
  }
  // 描述里点名哪些场景在缺省范围断言零卡住点，与文件里的断言逐一对上；没有钉住卡住行的场景，描述里
  // 也没有那一句。
  const listed = (label: string) =>
    new RegExp(`${label}: ([a-z, ]*)\\.`, "u").exec(suite.description)?.[1]?.split(", ").sort() ??
    null;
  deepEqual(listed("zero stuck points in the default scope"), zeroStuck.sort());
  equal(listed("pinned stuck rows in the default scope"), null);
});

test("the sweep's helpers: residue is counted per normalized path, full-scope tables are not filtered", () => {
  // 两个死读者租约规范化成同一个名字：个数是 2，不合并成一项；锁的创建暂存另算一行。
  const reader = "workspace:.wakeflow-local/runtime/operation-admission/reader-";
  deepEqual(
    countSnapshotSweepResidue([
      `${reader}11111111-1111-4111-8111-111111111111.lock`,
      `${reader}22222222-2222-4222-8222-222222222222.lock`,
      "workspace:.wakeflow-active/projector.lock",
    ]),
    [
      ["workspace:.wakeflow-active/projector.lock", 1],
      [`${reader}<uuid>.lock`, 2],
    ],
  );
  deepEqual(snapshotSweepAllPoints(3, [2.1, 1.1]), [0, 1, 1.1, 2, 2.1, 3]);
  // 钉住的行所在的点没有摆回：`locks` 范围把它滤掉，`all` 范围原样留下，于是与报告对不上。
  const swept = (scope: SnapshotSweepReport["scope"]) =>
    ({ scope, points: [{ index: 0 }, { index: 2 }] }) as unknown as SnapshotSweepReport;
  const rows = [[2, "a"] as const, [2.1, "b"] as const];
  deepEqual(
    withinSweptPoints(swept("locks"), rows, ([index]) => index),
    [[2, "a"]],
  );
  deepEqual(
    withinSweptPoints(swept("all"), rows, ([index]) => index),
    rows,
  );
});
