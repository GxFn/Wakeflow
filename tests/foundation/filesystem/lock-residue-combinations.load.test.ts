import { deepEqual, equal } from "node:assert/strict";
import { chmodSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { hasDurableAtomicFileStagePrefix } from "../../../src/foundation/filesystem/durable-atomic-file-stage-address.js";
import {
  type PortableResourcePath,
  parsePortableResourcePath,
} from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  inspectRootedExclusiveFileLock,
  retireRootedExclusiveFileLockResidue,
  withRootedExclusiveFileLock,
} from "../../../src/foundation/filesystem/rooted-exclusive-file-lock.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import { loadSensitive } from "../../support/load-sensitive.js";
import {
  belongsTo,
  describe,
  LOCK_STATES,
  lockJobs,
  pool,
  produceResidue,
  type ResidueJob,
  snapshot,
} from "../../support/lock-residue-process.js";
import { disposableRoot } from "../../support/temp-root.js";

/**
 * Level 1 (component) with the deviation noted below, load-sensitive: dead locks and dead create stages in any combination are cleared
 * by the next acquisition (1.4.1 stage-1 list §1.2 item 7, §2.4 step 3, §2.5 rows 1-2; the operation-scope
 * cases are `lock-residue-combinations-scope-shared` and `-scope-exclusive`, split off for the per-file
 * budget). Every leftover is real: a child process
 * (`tests/support/lock-residue-process.ts`) drives the lock primitive, stops selected creations after
 * `openExclusive` or after `link`, reports ready and is killed, so each owner is a dead process. The
 * production caller pattern (inspect, retire an inactive owner, acquire) runs on lock A next to lock B
 * and requires B's files untouched. A live lock owner, a live creator of A beside A's dead owner, and an
 * unrecognized stage-named entry beside a dead lock all leave A and those entries untouched. Real child
 * processes and wall-clock budgets: tagged load-sensitive.
 *
 * Level deviation: `wf test levels` and the directory default put this file at 1 (component), and
 * its assertions run the primitive under test in-process on a disposable root; but the residue comes from
 * real child processes, which the testing standard's §2 table forbids at level 1 and allows only at level
 * 4. This note is the deviation record §2 asks for: the child processes only manufacture dead owners, no
 * tool is under test. Budget: as a `.load.test.ts` file it is held to `LOAD_FILE_BUDGET_MS` (360 s) in
 * `tooling/testing/test-levels.ts`, not to level 1's 20 s; the runner puts it in the load-sensitive lane.
 */

useDisposableDurability();

/** 生产调用方的模式（pod 变更锁、看板锁、Demand 发布锁、账本记录锁）：观察、属主已死就退役、获取。 */
async function acquireLikeProduction(
  root: RootedDirectory,
  ref: PortableResourcePath,
  timeoutMilliseconds = 2_000,
): Promise<void> {
  const lock = await inspectRootedExclusiveFileLock(root, ref);
  if (lock.status === "held" && lock.ownerState === "inactive") {
    await retireRootedExclusiveFileLockResidue(root, ref, lock);
  }
  await withRootedExclusiveFileLock(root, ref, async () => {}, {
    acquireTimeoutMilliseconds: timeoutMilliseconds,
  });
}

/** 走一遍生产模式，返回失败的 `名字/原因`；成功时返回 undefined。 */
async function attemptLikeProduction(
  root: RootedDirectory,
  ref: PortableResourcePath,
  timeoutMilliseconds: number,
): Promise<string | undefined> {
  try {
    await acquireLikeProduction(root, ref, timeoutMilliseconds);
  } catch (error: unknown) {
    return describe(error);
  }
  return undefined;
}

test("two locks in one directory: any mix of dead locks and dead stages of A and B is cleared by the production pattern, A first without touching B, then B", {
  timeout: 120_000,
}, async (t) => {
  if (loadSensitive(t, "a real child process leaves the residue; 36 combinations")) return;
  const base = disposableRoot(t, "wakeflow-lock-residue-");
  const combinations: {
    label: string;
    directory: string;
  }[] = [];
  const jobs: ResidueJob[] = [];
  let index = 0;
  for (const a of LOCK_STATES) {
    for (const aUnlinked of [false, true]) {
      for (const b of LOCK_STATES) {
        for (const bUnlinked of [false, true]) {
          const directory = `pair-${index}`;
          index += 1;
          mkdirSync(path.join(base, directory));
          combinations.push({
            label: `A=${a}${aUnlinked ? "+unlinked-stage" : ""} B=${b}${bUnlinked ? "+unlinked-stage" : ""}`,
            directory,
          });
          jobs.push(...lockJobs(directory, "A.lock", a, aUnlinked));
          jobs.push(...lockJobs(directory, "B.lock", b, bUnlinked));
        }
      }
    }
  }
  const producer = await produceResidue(t, base, jobs);
  await producer.kill();
  const root = await RootedDirectory.open(base);
  t.after(() => root.close());
  const failures: string[] = [];
  await pool(combinations, 4, async ({ label, directory }) => {
    const physical = path.join(base, directory);
    const before = snapshot(physical);
    const bBefore = Object.fromEntries(
      Object.entries(before).filter(([name]) => belongsTo(name, directory, "B.lock")),
    );
    try {
      await acquireLikeProduction(root, parsePortableResourcePath(`${directory}/A.lock`));
    } catch (error: unknown) {
      failures.push(`${label}: acquiring A: ${describe(error)}`);
      return;
    }
    const afterA = snapshot(physical);
    try {
      deepEqual(afterA, bBefore);
    } catch {
      failures.push(`${label}: after A the directory is not exactly B's files as they were`);
      return;
    }
    try {
      await acquireLikeProduction(root, parsePortableResourcePath(`${directory}/B.lock`));
    } catch (error: unknown) {
      failures.push(`${label}: acquiring B: ${describe(error)}`);
      return;
    }
    const afterB = readdirSync(physical);
    if (afterB.length !== 0) failures.push(`${label}: after B left ${afterB.length} entries`);
  });
  deepEqual(failures, []);
});

test("two locks in one directory: a live owner of A and B is never retired, and their files stay untouched", {
  timeout: 60_000,
}, async (t) => {
  if (loadSensitive(t, "a live child process holds the locks; wall-clock acquire timeouts")) return;
  const base = disposableRoot(t, "wakeflow-lock-live-");
  mkdirSync(path.join(base, "pair"));
  await produceResidue(t, base, [
    ...lockJobs("pair", "A.lock", "dead", true),
    ...lockJobs("pair", "B.lock", "dead-linked", true),
  ]);
  const root = await RootedDirectory.open(base);
  t.after(() => root.close());
  const physical = path.join(base, "pair");
  const before = snapshot(physical);
  for (const name of ["A.lock", "B.lock"]) {
    const ref = parsePortableResourcePath(`pair/${name}`);
    const observed = await inspectRootedExclusiveFileLock(root, ref);
    equal(observed.status === "held" && observed.ownerState, "active");
    equal(await attemptLikeProduction(root, ref, 300), "RootedExclusiveFileLockError/timeout");
  }
  deepEqual(snapshot(physical), before);
});

test("dead owner of A while a live process is creating A: retirement refuses with residue-changed and A plus the live stage stay untouched", {
  timeout: 60_000,
}, async (t) => {
  if (loadSensitive(t, "two real child processes, one killed and one kept alive")) return;
  const base = disposableRoot(t, "wakeflow-lock-live-creator-");
  mkdirSync(path.join(base, "pair"));
  // 活着的创建者必须先停在 openExclusive 之后：锁已在场时，获取在新建之前就会因目标存在而等待。
  await produceResidue(t, base, [{ path: "pair/A.lock", kind: "stop-open" }]);
  const owner = await produceResidue(t, base, [{ path: "pair/A.lock", kind: "hold" }]);
  await owner.kill();
  const root = await RootedDirectory.open(base);
  t.after(() => root.close());
  const physical = path.join(base, "pair");
  const before = snapshot(physical);
  deepEqual(
    Object.keys(before)
      .map((name) => (hasDurableAtomicFileStagePrefix(name) ? "stage" : name))
      .sort(),
    ["A.lock", "stage"],
  );
  const ref = parsePortableResourcePath("pair/A.lock");
  const observed = await inspectRootedExclusiveFileLock(root, ref);
  equal(observed.status === "held" && observed.ownerState, "inactive");
  equal(
    await attemptLikeProduction(root, ref, 300),
    "RootedExclusiveFileLockError/residue-changed",
  );
  deepEqual(snapshot(physical), before);
});

test("an unrecognized stage-named entry beside a dead lock fails the retirement closed: the lock and the entry stay untouched", {
  timeout: 60_000,
}, async (t) => {
  if (loadSensitive(t, "a real child process leaves the dead lock")) return;
  const base = disposableRoot(t, "wakeflow-lock-unrecognized-");
  mkdirSync(path.join(base, "pair"));
  // 先留下 A 的一份未链接暂存与一把死锁，再把暂存改成错误模式：名字合法，节点不合策略。
  const producer = await produceResidue(t, base, lockJobs("pair", "A.lock", "dead", true));
  await producer.kill();
  const physical = path.join(base, "pair");
  const stageName = readdirSync(physical).find((name) => hasDurableAtomicFileStagePrefix(name));
  if (stageName === undefined) throw new Error("the producer left no stage");
  chmodSync(path.join(physical, stageName), 0o644);
  const root = await RootedDirectory.open(base);
  t.after(() => root.close());
  const before = snapshot(physical);
  deepEqual(Object.keys(before), ["A.lock", stageName].sort());
  const ref = parsePortableResourcePath("pair/A.lock");
  const observed = await inspectRootedExclusiveFileLock(root, ref);
  equal(observed.status === "held" && observed.ownerState, "inactive");
  equal(
    await attemptLikeProduction(root, ref, 300),
    "RootedExclusiveFileLockError/residue-changed",
  );
  deepEqual(snapshot(physical), before);
});

/**
 * 跨目标：A 的死锁旁边是另一个目标 B 的一份死暂存，被改成错误模式（0644）后不可识别。按目标匹配的写前
 * 恢复对不可识别条目按整个父目录计数，不论它名义上属于哪个目标，所以 A 的退休同样以 residue-changed
 * 失败，A 与 B 的那个条目原样保留。代码里没有任何路径会删这样的条目：退休与写前恢复只计数；维护用的
 * 严格恢复（`recoverDurableAtomicFileStagesInDirectory`/`ForTargets`）遇到它以 `inventory` 拒绝；
 * `wakeflow_maintain_workspace` 的 `WakeflowHookStageResiduePlan` 只退役 hook 目录里的畸形暂存
 * （open-items B13）。锁目录里的这种条目留给人判断后手工删除，删掉之后 A 的退休才能结算。
 */
test("an unrecognizable dead stage of another target B beside a dead lock A fails A's retirement with residue-changed: A and B's entry stay untouched", {
  timeout: 60_000,
}, async (t) => {
  if (loadSensitive(t, "a real child process leaves the dead lock and the dead stage")) return;
  const base = disposableRoot(t, "wakeflow-lock-cross-target-");
  mkdirSync(path.join(base, "pair"));
  // B 的未链接暂存必须先造（lockJobs 的顺序）；A 只留一把死锁，没有自己的暂存。
  const producer = await produceResidue(t, base, [
    ...lockJobs("pair", "B.lock", "absent", true),
    ...lockJobs("pair", "A.lock", "dead", false),
  ]);
  await producer.kill();
  const physical = path.join(base, "pair");
  const stageNames = readdirSync(physical).filter((name) => hasDurableAtomicFileStagePrefix(name));
  equal(stageNames.length, 1);
  const stageName = stageNames[0] as string;
  equal(belongsTo(stageName, "pair", "B.lock"), true);
  equal(belongsTo(stageName, "pair", "A.lock"), false);
  chmodSync(path.join(physical, stageName), 0o644);
  const root = await RootedDirectory.open(base);
  t.after(() => root.close());
  const before = snapshot(physical);
  deepEqual(Object.keys(before), ["A.lock", stageName].sort());
  const ref = parsePortableResourcePath("pair/A.lock");
  const observed = await inspectRootedExclusiveFileLock(root, ref);
  equal(observed.status === "held" && observed.ownerState, "inactive");
  equal(
    await attemptLikeProduction(root, ref, 300),
    "RootedExclusiveFileLockError/residue-changed",
  );
  deepEqual(snapshot(physical), before);
  // 人判断之后手工删掉那个条目，A 的下一次生产模式照常退休并获取，目录清空。
  unlinkSync(path.join(physical, stageName));
  equal(await attemptLikeProduction(root, ref, 300), undefined);
  deepEqual(readdirSync(physical), []);
});
