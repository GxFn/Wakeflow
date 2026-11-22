import { deepEqual } from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import type { TestContext } from "node:test";

import { parsePortableResourcePath } from "../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../src/foundation/filesystem/rooted-directory.js";
import {
  type RootedReadWriteMode,
  withRootedReadWriteScope,
} from "../../src/foundation/filesystem/rooted-read-write-scope.js";
import {
  describe,
  LOCK_STATES,
  type LockState,
  lockJobs,
  pool,
  produceResidue,
  type ResidueJob,
} from "./lock-residue-process.js";
import { disposableRoot } from "./temp-root.js";

/**
 * 操作作用域的锁残留组合（1.4.1 第 1 段清单 §1.2 第 7 项）：闩锁、写者锁与读者租约及其暂存的
 * 各种死残留由 `lock-residue-process.ts` 的子进程留下，`checkScopeCombinations` 对一种准入模式
 * 跑全部组合。两种模式分在两个测试文件里，各自留在 1 级的单文件预算内。不含 `test()`。
 */

export type ReaderState = "none" | "one" | "one-linked" | "three";
// 组合的取舍（文件预算）：三个读者里最后一个停在链接之后，所以"three"同时给出死租约与两链接的读者暂存；
// 闩锁自己的未链接暂存只随"all"出现——单独出现时今天的代码就能清（获取闩锁的写前恢复）。
const READER_STATES: readonly ReaderState[] = ["none", "one", "three"];
export type UnlinkedStages = "none" | "latch" | "writer" | "reader" | "all";
const UNLINKED_STAGES: readonly UnlinkedStages[] = ["none", "writer", "reader", "all"];

function readerName(): string {
  return `reader-${randomUUID()}.lock`;
}

interface ScopeCombination {
  readonly label: string;
  readonly area: string;
  readonly readers: readonly string[];
}

export function scopeJobs(
  area: string,
  latch: LockState,
  writer: LockState,
  readers: ReaderState,
  unlinked: UnlinkedStages,
): { jobs: ResidueJob[]; readerNames: string[] } {
  const jobs: ResidueJob[] = [];
  const readerNames: string[] = [];
  const unlinkedOf = (kind: UnlinkedStages) => unlinked === kind || unlinked === "all";
  jobs.push(...lockJobs(area, "latch.lock", latch, unlinkedOf("latch")));
  jobs.push(...lockJobs(area, "writer.lock", writer, unlinkedOf("writer")));
  // 读者租约的未链接暂存属于一个从未链接成功的读者，它的名字不会再出现。
  if (unlinkedOf("reader")) jobs.push({ path: `${area}/${readerName()}`, kind: "stop-open" });
  const count = readers === "none" ? 0 : readers === "three" ? 3 : 1;
  for (let index = 0; index < count; index += 1) {
    const name = readerName();
    readerNames.push(name);
    const linked = (readers === "one-linked" || readers === "three") && index === count - 1;
    jobs.push({ path: `${area}/${name}`, kind: linked ? "stop-link" : "hold" });
  }
  return { jobs, readerNames };
}

const SCOPE_BUDGET_MILLISECONDS = 5_000;

/**
 * 留下全部组合的死残留，再以 mode 逐个准入：每次都要远在预算内通过，并清掉准入负责的东西；
 * 共享准入只在读者租约堆到阈值时才清死读者，它负责的是闩锁、写者锁与所有死暂存。
 */
export async function checkScopeCombinations(
  t: TestContext,
  mode: RootedReadWriteMode,
): Promise<void> {
  const base = disposableRoot(t, `wakeflow-scope-residue-${mode}-`);
  const combinations: ScopeCombination[] = [];
  const jobs: ResidueJob[] = [];
  let index = 0;
  for (const latch of LOCK_STATES) {
    for (const writer of LOCK_STATES) {
      for (const readers of READER_STATES) {
        for (const unlinked of UNLINKED_STAGES) {
          const area = `scope-${index}`;
          index += 1;
          mkdirSync(path.join(base, area), { mode: 0o700 });
          const produced = scopeJobs(area, latch, writer, readers, unlinked);
          jobs.push(...produced.jobs);
          combinations.push({
            label: `${mode}: latch=${latch} writer=${writer} readers=${readers} unlinked-stages=${unlinked}`,
            area,
            readers: produced.readerNames,
          });
        }
      }
    }
  }
  const producer = await produceResidue(t, base, jobs);
  await producer.kill();
  const root = await RootedDirectory.open(base);
  t.after(() => root.close());
  const failures: string[] = [];
  let slowest = 0;
  await pool(combinations, 4, async ({ label, area, readers }) => {
    const physical = path.join(base, area);
    const started = performance.now();
    try {
      await withRootedReadWriteScope(root, parsePortableResourcePath(area), mode, async () => {}, {
        acquireTimeoutMilliseconds: SCOPE_BUDGET_MILLISECONDS,
      });
    } catch (error: unknown) {
      failures.push(`${label}: ${describe(error)}`);
      return;
    }
    const elapsed = performance.now() - started;
    slowest = Math.max(slowest, elapsed);
    if (elapsed > SCOPE_BUDGET_MILLISECONDS / 2) {
      failures.push(`${label}: entry took ${Math.round(elapsed)} ms`);
    }
    const expected = mode === "shared" ? [...readers].sort() : [];
    const remaining = readdirSync(physical).sort();
    try {
      deepEqual(remaining, expected);
    } catch {
      failures.push(`${label}: left ${JSON.stringify(remaining.map((name) => name.slice(0, 24)))}`);
    }
  });
  t.diagnostic(
    `slowest entry ${Math.round(slowest)} ms of a ${SCOPE_BUDGET_MILLISECONDS} ms budget`,
  );
  deepEqual(failures, []);
}
