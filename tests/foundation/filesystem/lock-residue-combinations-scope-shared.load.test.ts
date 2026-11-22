import { deepEqual, equal } from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { withRootedReadWriteScope } from "../../../src/foundation/filesystem/rooted-read-write-scope.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import { loadSensitive } from "../../support/load-sensitive.js";
import { describe, produceResidue, snapshot } from "../../support/lock-residue-process.js";
import { checkScopeCombinations, scopeJobs } from "../../support/lock-residue-scope.js";
import { disposableRoot } from "../../support/temp-root.js";

/**
 * Level 1 (component) with the deviation noted below, load-sensitive: the shared-entry quarter of the lock-residue combinations plus the
 * live-owner scope case (1.4.1 stage-1 list §1.2 item 7, §2.4 step 3, §2.5 rows 1-2; split for the per-file
 * budget from `lock-residue-combinations.load.test.ts`, exclusive entry in
 * `lock-residue-combinations-scope-exclusive`). A real child process (`tests/support/lock-residue-process.ts`)
 * leaves dead latch, writer and reader leases and their stages; shared entry over every mix gets through
 * well inside the budget and clears what it owns. Live latch, writer and reader owners are never retired.
 * Real child processes and wall-clock budgets: tagged load-sensitive.
 *
 * Level deviation: `wf test levels` and the directory default put this file at 1 (component), and
 * its assertions run the primitive under test in-process on a disposable root; but the residue comes from
 * real child processes, which the testing standard's §2 table forbids at level 1 and allows only at level
 * 4. This note is the deviation record §2 asks for: the child processes only manufacture dead owners, no
 * tool is under test. Budget: as a `.load.test.ts` file it is held to `LOAD_FILE_BUDGET_MS` (360 s) in
 * `tooling/testing/test-levels.ts`, not to level 1's 20 s; the runner puts it in the load-sensitive lane.
 */

useDisposableDurability();

test("operation scope: any mix of dead latch, writer, readers and their stages lets shared entry through well inside the budget and clears what entry owns", {
  timeout: 300_000,
}, async (t) => {
  if (loadSensitive(t, "a real child process leaves the residue; 108 scope entries")) return;
  await checkScopeCombinations(t, "shared");
});

test("operation scope: live latch, writer and reader owners are never retired; entry times out and their files stay untouched", {
  timeout: 60_000,
}, async (t) => {
  if (loadSensitive(t, "a live child process holds the leases; wall-clock entry budgets")) return;
  const base = disposableRoot(t, "wakeflow-scope-live-");
  const areas = {
    writer: scopeJobs("live-writer", "absent", "dead", "one-linked", "latch"),
    latch: scopeJobs("live-latch", "dead", "absent", "one", "writer"),
  };
  mkdirSync(path.join(base, "live-writer"), { mode: 0o700 });
  mkdirSync(path.join(base, "live-latch"), { mode: 0o700 });
  await produceResidue(t, base, [...areas.writer.jobs, ...areas.latch.jobs]);
  const root = await RootedDirectory.open(base);
  t.after(() => root.close());
  for (const area of ["live-writer", "live-latch"]) {
    const physical = path.join(base, area);
    const before = snapshot(physical);
    for (const mode of ["shared", "exclusive"] as const) {
      let reason: string | undefined;
      try {
        await withRootedReadWriteScope(
          root,
          parsePortableResourcePath(area),
          mode,
          async () => {},
          {
            acquireTimeoutMilliseconds: 400,
          },
        );
      } catch (error: unknown) {
        reason = describe(error);
      }
      equal(reason, "RootedReadWriteScopeError/timeout", `${area} ${mode}`);
      deepEqual(snapshot(physical), before, `${area} ${mode}`);
    }
  }
});
