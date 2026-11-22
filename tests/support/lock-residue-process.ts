import { spawn } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { TestContext } from "node:test";

import {
  computeDurableAtomicFileStageTargetDigest,
  hasDurableAtomicFileStagePrefix,
  parseDurableAtomicFileStageFileName,
} from "../../src/foundation/filesystem/durable-atomic-file-stage-address.js";
import { RootedExclusiveFileLockError } from "../../src/foundation/filesystem/rooted-exclusive-file-lock.js";
import { RootedReadWriteScopeError } from "../../src/foundation/filesystem/rooted-read-write-scope.js";

/**
 * 锁残留组合测试的子进程夹具（1.4.1 第 1 段清单 §1.2 第 7 项）：一个真实子进程驱动锁原语，
 * 经 `filesystemMutation` 接缝把选定的新建停在 `openExclusive` 之后（未链接的暂存）或 `link`
 * 之后（锁加双链接暂存），全部就位后报告 ready 并挂起；测试杀掉它就得到属主已死的真实残留，
 * 不杀就是属主仍活动的残留。不含 `test()`。
 */

export type StopKind = "hold" | "stop-open" | "stop-link";
export interface ResidueJob {
  readonly path: string;
  readonly kind: StopKind;
}

/** 子进程：按顺序执行作业，hold 持锁不放，stop-* 在接缝处停住；全部就位后报告 ready 并挂起。 */
const CHILD_PROGRAM = `
  import { RootedDirectory } from ${JSON.stringify(new URL("../../src/foundation/filesystem/rooted-directory.js", import.meta.url).href)};
  import { filesystemMutation } from ${JSON.stringify(new URL("../../src/foundation/filesystem/filesystem-mutation.js", import.meta.url).href)};
  import { acquireRootedExclusiveFileLock } from ${JSON.stringify(new URL("../../src/foundation/filesystem/rooted-exclusive-file-lock.js", import.meta.url).href)};
  const [base, plan] = process.argv.slice(1);
  const jobs = JSON.parse(plan);
  const root = await RootedDirectory.open(base, "$root", { durability: "none" });
  let stop = null;
  let reached = null;
  const original = { openExclusive: filesystemMutation.openExclusive, link: filesystemMutation.link };
  const hang = () => { const notify = reached; stop = null; reached = null; notify(); return new Promise(() => {}); };
  filesystemMutation.openExclusive = async (...args) => {
    const handle = await original.openExclusive(...args);
    if (stop === "open") return hang();
    return handle;
  };
  filesystemMutation.link = async (...args) => {
    await original.link(...args);
    if (stop === "link") return hang();
  };
  const leases = [];
  for (const job of jobs) {
    const point = new Promise((resolve) => { reached = resolve; });
    stop = job.kind === "stop-open" ? "open" : job.kind === "stop-link" ? "link" : null;
    const acquisition = acquireRootedExclusiveFileLock(root, job.path, { acquireTimeoutMilliseconds: 10000 });
    if (job.kind === "hold") {
      leases.push(await acquisition);
    } else {
      await Promise.race([point, acquisition.then(() => { throw new Error("creation passed its stop point: " + job.path); })]);
    }
  }
  process.stdout.write("ready\\n");
  setInterval(() => {}, 1000);
`;

/** 启动残留生产者并等到它报告 ready；测试结束时总会杀掉它。kill() 让它在测试中途死去。 */
export async function produceResidue(t: TestContext, base: string, jobs: readonly ResidueJob[]) {
  const child = spawn(
    process.execPath,
    ["--input-type=module", "-e", CHILD_PROGRAM, base, JSON.stringify(jobs)],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  t.after(async () => {
    child.kill("SIGKILL");
    await exited;
  });
  await new Promise<void>((resolve, reject) => {
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.includes("ready\n")) resolve();
    });
    child.once("error", reject);
    void exited.then(() => reject(new Error(`Residue producer exited early: ${stderr}`)));
  });
  return Object.freeze({
    async kill() {
      child.kill("SIGKILL");
      await exited;
    },
  });
}

/** 目录项的完整观察：节点身份、链接数、大小、时间与内容；用来证明"原样未动"。 */
export function snapshot(directory: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of readdirSync(directory).sort()) {
    const file = path.join(directory, name);
    const stat = statSync(file, { bigint: true });
    result[name] = JSON.stringify([
      String(stat.ino),
      String(stat.nlink),
      String(stat.size),
      String(stat.mode),
      String(stat.mtimeNs),
      String(stat.ctimeNs),
      readFileSync(file).toString("base64"),
    ]);
  }
  return result;
}

/** 名字是不是这把锁本身或它的暂存。 */
export function belongsTo(name: string, directory: string, lockName: string): boolean {
  if (name === lockName) return true;
  if (!hasDurableAtomicFileStagePrefix(name)) return false;
  return (
    parseDurableAtomicFileStageFileName(name).targetResourcePathDigest ===
    computeDurableAtomicFileStageTargetDigest(`${directory}/${lockName}`)
  );
}

export function describe(error: unknown): string {
  if (error instanceof RootedExclusiveFileLockError || error instanceof RootedReadWriteScopeError) {
    return `${error.name}/${error.reason}`;
  }
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export async function pool<Item>(
  items: readonly Item[],
  width: number,
  run: (item: Item) => Promise<void>,
) {
  let next = 0;
  await Promise.all(
    Array.from({ length: width }, async () => {
      while (next < items.length) {
        const item = items[next] as Item;
        next += 1;
        await run(item);
      }
    }),
  );
}

export type LockState = "absent" | "dead" | "dead-linked";
export const LOCK_STATES: readonly LockState[] = ["absent", "dead", "dead-linked"];

export function lockJobs(directory: string, name: string, state: LockState, unlinked: boolean) {
  const lockPath = `${directory}/${name}`;
  const jobs: ResidueJob[] = [];
  // 未链接的暂存必须先造：锁已在场时，获取在新建之前就会因目标存在而等待。
  if (unlinked) jobs.push({ path: lockPath, kind: "stop-open" });
  if (state === "dead") jobs.push({ path: lockPath, kind: "hold" });
  if (state === "dead-linked") jobs.push({ path: lockPath, kind: "stop-link" });
  return jobs;
}
