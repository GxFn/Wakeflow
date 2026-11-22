import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
import { filesystemMutation } from "../../src/foundation/filesystem/filesystem-mutation.js";
import { RootedDirectory } from "../../src/foundation/filesystem/rooted-directory.js";
import { RootedResourceParentHandle } from "../../src/foundation/filesystem/rooted-resource-parent-handle.js";
import { countFsyncs } from "../foundation/filesystem/fsync-count-probe.js";

/**
 * 锁族经生产包装走一个周期时的同步与目录项事件（1.4.1 第 1 段清单 2.1 节；七类锁按重排计划第 3 节路丙）。
 *
 * 计数表（tests/foundation/filesystem/durability-class-counts.test.ts）里锁的行直接调原语、档位写在测试里；
 * 一个生产包装不再传轻档、或给权威的锁传了轻档，那里看不见。这里给经包装调用的测试一副记录：在真实
 * 同步的根上数一次操作的 `fsync`（与其中目录句柄上的次数），并按先后记下它的目录项变化与同步：
 * - `create d/x`：排他新建一个文件（原子写的暂存）；`content d/x`：对这样新建的文件同步内容；
 * - `link d/x`、`unlink d/x`、`rename d/x`（新名）、`mkdir d/x`、`rmdir d/x`、`remove-tree d/x`：经接缝
 *   `filesystemMutation` 的目录项变化；
 * - `sync d/`：对父目录 d 的同步（`RootedResourceParentHandle`）。
 * 路径相对根（根下一层写 `./x`），原子写的暂存名写成 `<stage>`，读者租约写成 `reader-<uuid>.lock`。
 *
 * 计数补丁是进程全局的：用这副记录的文件顺序执行用例，计数期间不跑别的会同步的工作；接缝与父目录
 * 句柄上的 mock 随测试上下文结束还原。
 */

/** 一次操作的同步次数与按先后的事件。 */
export interface DurabilityTrace {
  readonly syncCount: number;
  readonly directorySyncCount: number;
  readonly events: readonly string[];
}

export type DurabilityTracer = (run: () => Promise<unknown>) => Promise<Readonly<DurabilityTrace>>;

/** 锁的获取档：`light` 是 L1–L7 的轻档（链接前只同步内容），`default` 是缺省的权威档。 */
export type LockDurabilityLevel = "light" | "default";

const STAGE_PREFIX = ".wakeflow-atomic-";
const READER_LEASE = /^reader-[0-9a-f-]{36}\.lock$/u;

/** 正在计数时收集事件；计数之外（用例的准备与收尾）为 null，不记。 */
let recorded: string[] | null = null;

function fileLabel(base: string, absolute: string): string {
  const relative = path.relative(base, absolute);
  const name = path.basename(relative);
  const shown = name.startsWith(STAGE_PREFIX)
    ? "<stage>"
    : READER_LEASE.test(name)
      ? "reader-<uuid>.lock"
      : name;
  return `${path.dirname(relative)}/${shown}`;
}

/** 让这个句柄上的内容同步先记一笔，再转调原型上（计数期间是计数补丁）的同步。 */
function traceContentSync(handle: FileHandle, label: string): void {
  const prototype = Object.getPrototypeOf(handle) as { sync: (this: FileHandle) => Promise<void> };
  Object.defineProperty(handle, "sync", {
    configurable: true,
    value: async () => {
      recorded?.push(`content ${label}`);
      return prototype.sync.call(handle);
    },
  });
}

/** 在接缝与父目录句柄上装记录（随 `t` 结束还原），返回"数一次操作"的函数。 */
export function traceDurability(t: TestContext, base: string): DurabilityTracer {
  const mutation = { ...filesystemMutation };
  const record = (verb: string, target: string) =>
    recorded?.push(`${verb} ${fileLabel(base, target)}`);
  t.mock.method(
    filesystemMutation,
    "openExclusive",
    async (target: string, flags: number, mode: number) => {
      const handle = await mutation.openExclusive(target, flags, mode);
      if (recorded !== null) {
        record("create", target);
        traceContentSync(handle, fileLabel(base, target));
      }
      return handle;
    },
  );
  t.mock.method(filesystemMutation, "link", async (existingPath: string, newPath: string) => {
    await mutation.link(existingPath, newPath);
    record("link", newPath);
  });
  t.mock.method(filesystemMutation, "unlink", async (target: string) => {
    await mutation.unlink(target);
    record("unlink", target);
  });
  t.mock.method(filesystemMutation, "rename", async (oldPath: string, newPath: string) => {
    await mutation.rename(oldPath, newPath);
    record("rename", newPath);
  });
  t.mock.method(
    filesystemMutation,
    "mkdir",
    async (target: string, options: { readonly mode: number; readonly recursive: false }) => {
      await mutation.mkdir(target, options);
      record("mkdir", target);
    },
  );
  t.mock.method(filesystemMutation, "rmdir", async (target: string) => {
    await mutation.rmdir(target);
    record("rmdir", target);
  });
  t.mock.method(filesystemMutation, "removeTree", async (target: string) => {
    await mutation.removeTree(target);
    record("remove-tree", target);
  });
  const sync = RootedResourceParentHandle.prototype.sync;
  t.mock.method(
    RootedResourceParentHandle.prototype,
    "sync",
    async function (this: RootedResourceParentHandle) {
      const directory = path.relative(base, path.dirname(this.resourceAbsolutePath)) || ".";
      recorded?.push(`sync ${directory}/`);
      return sync.call(this);
    },
  );
  return async (run) => {
    const events: string[] = [];
    recorded = events;
    try {
      const counted = await countFsyncs(run);
      return Object.freeze({
        syncCount: counted.syncCount,
        directorySyncCount: counted.directorySyncCount,
        events: Object.freeze([...events]),
      });
    } finally {
      recorded = null;
    }
  };
}

/** 一个一次性目录与在它上面以真实同步（`fsync`）打开的根；随 `t` 结束关闭并删除。 */
export async function durableDisposableRoot(
  t: TestContext,
  prefix: string,
): Promise<Readonly<{ base: string; root: RootedDirectory }>> {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
  const root = await RootedDirectory.open(base, "$root", { durability: "fsync" });
  t.after(async () => {
    await root.close();
    rmSync(base, { recursive: true, force: true });
  });
  return Object.freeze({ base, root });
}

function lockLabels(lock: string): Readonly<{ lock: string; stage: string; parent: string }> {
  const directory = path.posix.dirname(lock);
  return {
    lock: `${directory}/${path.posix.basename(lock)}`,
    stage: `${directory}/<stage>`,
    parent: `sync ${directory}/`,
  };
}

/**
 * 获取一把锁的事件：新建暂存并同步内容、链接成锁、删掉暂存；缺省档另在链接之后与删暂存之后各同步
 * 一次父目录（轻档 1 次同步，缺省档 3 次）。
 */
export function lockAcquisitionEvents(lock: string, level: LockDurabilityLevel): string[] {
  const { lock: linked, stage, parent } = lockLabels(lock);
  return level === "light"
    ? [`create ${stage}`, `content ${stage}`, `link ${linked}`, `unlink ${stage}`]
    : [`create ${stage}`, `content ${stage}`, `link ${linked}`, parent, `unlink ${stage}`, parent];
}

/** 释放一把锁的事件：删锁之后同步父目录，两档一样（1 次同步）。 */
export function lockReleaseEvents(lock: string): string[] {
  const { lock: linked, parent } = lockLabels(lock);
  return [`unlink ${linked}`, parent];
}

/** 临界区为空时一个完整周期的事件：轻档 2 次同步（1 次在目录上），缺省档 4 次（3 次在目录上）。 */
export function lockCycleEvents(lock: string, level: LockDurabilityLevel): string[] {
  return [...lockAcquisitionEvents(lock, level), ...lockReleaseEvents(lock)];
}
