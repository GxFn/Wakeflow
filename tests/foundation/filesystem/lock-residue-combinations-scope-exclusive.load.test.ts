import { test } from "node:test";

import { useDisposableDurability } from "../../support/disposable-durability.js";
import { loadSensitive } from "../../support/load-sensitive.js";
import { checkScopeCombinations } from "../../support/lock-residue-scope.js";

/**
 * Level 1 (component) with the deviation noted below, load-sensitive: the exclusive-entry quarter of the lock-residue combinations
 * (1.4.1 stage-1 list §1.2 item 7, §2.4 step 3, §2.5 rows 1-2; split for the per-file budget from
 * `lock-residue-combinations.load.test.ts`, shared entry in `lock-residue-combinations-scope-shared`). A
 * real child process (`tests/support/lock-residue-process.ts`) leaves dead latch, writer and reader leases
 * and their stages; exclusive entry over every mix gets through well inside the budget and leaves the area
 * empty. Real child processes and wall-clock budgets: tagged load-sensitive.
 *
 * Level deviation: `wf test levels` and the directory default put this file at 1 (component), and
 * its assertions run the primitive under test in-process on a disposable root; but the residue comes from
 * real child processes, which the testing standard's §2 table forbids at level 1 and allows only at level
 * 4. This note is the deviation record §2 asks for: the child processes only manufacture dead owners, no
 * tool is under test. Budget: as a `.load.test.ts` file it is held to `LOAD_FILE_BUDGET_MS` (360 s) in
 * `tooling/testing/test-levels.ts`, not to level 1's 20 s; the runner puts it in the load-sensitive lane.
 */

useDisposableDurability();

test("operation scope: any mix of dead latch, writer, readers and their stages lets exclusive entry through well inside the budget and clears everything", {
  timeout: 300_000,
}, async (t) => {
  if (loadSensitive(t, "a real child process leaves the residue; 108 scope entries")) return;
  await checkScopeCombinations(t, "exclusive");
});
