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
  "Each replayed kill point of a snapshot-sweep file falls in exactly one of four classes, and each file pins the points of the last three by index: healed by the first round (status, the mutating follow-up, status again; a point whose first status is refused while the follow-up still heals it is pinned in the file's healed-after-status-refusal table); healed through a signposted route (a retry when the refusal is retryable, the scenario's own recover on recovery-required - also when it only works from the restored kill point although a refusal there already pointed at it, pinned with a restored: prefix - maintenance recover on a maintenance residue, or reconcile); healed through an unsignposted route (the scenario's own recover, alone or after reconcile, from the restored kill point once every signposted route failed and no refusal pointed at that recover); or stuck, listed with the refusal that no public call gets past. A follow-up that calls nothing never counts as healing. At every point that is not stuck, the L1-L7 lock and lease files left, and the atomic stages that point at them, equal the file's pinned residue table, path and count. Each file also pins the indices it replayed in each scope. The lock-residue-combinations files assert that the next acquisition or scope entry clears every combination of dead locks, leases and create stages they leave, except dead reader leases under shared entry, and leaves live owners untouched.";

/** 扫点文件在缺省范围里断言零卡住点的写法：卡住的表整个为空，或 `locks` 范围里为空。 */
const ZERO_STUCK_IN_DEFAULT_SCOPE =
  /deepEqual\(stuckRowsOf\(report\), (?:\[\]|report\.scope === "locks" \? \[\] : STUCK_ON_TODAY)\);/u;

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
  // 不变式点名的五张表与摆回的序号，每个扫点文件都要真的断言。
  const zeroStuck: string[] = [];
  const pinnedStuck: string[] = [];
  for (const file of sweeps) {
    const source = readFileSync(path.resolve(file), "utf8");
    for (const table of [
      "stuckRowsOf",
      "signpostedRecoveryOf",
      "unsignpostedRecoveryOf",
      "healedAfterStatusRefusalOf",
      "lockResidueOf",
      "sweptIndicesOf",
    ]) {
      ok(
        new RegExp(`deepEqual\\(\\s*${table}\\(report\\),`, "u").test(source),
        `${file}: ${table}`,
      );
    }
    const scenario =
      /^tests\/capabilities\/workspace\/storage-snapshot-sweep-(.*)\.load\.test\.ts$/u.exec(
        file,
      )?.[1];
    ok(scenario !== undefined);
    (ZERO_STUCK_IN_DEFAULT_SCOPE.test(source) ? zeroStuck : pinnedStuck).push(scenario);
  }
  // 描述里点名哪些场景在缺省范围断言零卡住点、哪些断言钉住的卡住行，与文件里的断言逐一对上；没有后一类时
  // 描述里也没有那一句。
  const listed = (label: string) =>
    new RegExp(`${label}: ([a-z, ]*)\\.`, "u").exec(suite.description)?.[1]?.split(", ").sort() ??
    null;
  deepEqual(listed("zero stuck points in the default scope"), zeroStuck.sort());
  deepEqual(
    listed("pinned stuck rows in the default scope"),
    pinnedStuck.length === 0 ? null : pinnedStuck.sort(),
  );
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
