import { deepEqual, equal, ok, rejects } from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { runToolingCli } from "../../../tooling/cli.js";
import { listFaultSuites } from "../../../tooling/testing/fault-suites.js";

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
