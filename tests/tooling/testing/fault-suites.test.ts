import { deepEqual, equal, ok, rejects } from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { runToolingCli } from "../../../tooling/cli.js";
import { listFaultSuites } from "../../../tooling/testing/fault-suites.js";

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
