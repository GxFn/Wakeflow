import { deepEqual } from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import {
  createFileAtomically,
  replaceFileAtomically,
} from "../../../src/foundation/filesystem/durable-atomic-file-write.js";
import { createDirectoryAtomically } from "../../../src/foundation/filesystem/durable-directory-materialization.js";
import { unlinkRegularFileExactly } from "../../../src/foundation/filesystem/exact-regular-file-unlink.js";
import { filesystemMutation } from "../../../src/foundation/filesystem/filesystem-mutation.js";
import { withKernelFileLock } from "../../../src/foundation/filesystem/kernel-file-lock.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  type RootedReadWriteMode,
  withRootedReadWriteScope,
} from "../../../src/foundation/filesystem/rooted-read-write-scope.js";
import { RootedResourceParentHandle } from "../../../src/foundation/filesystem/rooted-resource-parent-handle.js";
import { readStableFileDigest } from "../../../src/foundation/filesystem/stable-file-read.js";
import { parseByteCount } from "../../../src/foundation/numeric/byte-count.js";
import { countFsyncs } from "./fsync-count-probe.js";

/**
 * Level 1 (component): 持久性的同步次数表，一处写全（1.4.1 第 1 段清单 2.1、2.2 节；ADR-0033）。
 *
 * 每一行在真实同步的根上（不调用 useDisposableDurability）数一次操作发出的 `fsync` 与其中目录句柄
 * 上的次数。权威档：原子新建 3（暂存内容；链接之后父目录；删暂存之后父目录）、原子替换 2（暂存内容；
 * 重命名之后父目录）、精确删除 1（父目录）、单独新建一个目录 1（父目录）。
 *
 * 锁与操作作用域不同步任何东西，也不在目录里链接或删除任何东西：互斥是内核咨询锁，磁盘上没有需要落盘
 * 的状态（ADR-0033 决定 11）。1.4.2 之前一次共享作用域的进出是 4 次同步、独占是 6 次。这三行另外钉住
 * 计数期间接缝上没有一次链接、删除或父目录同步。
 *
 * 前几行在各原语自己的测试里也钉过；这里把整张表放在一处，改任何一档原语的定义都会在这里同时看见。
 * 降档的调用点由 durability-downgrade-registry.test.ts 按调用点登记。
 *
 * 计数补丁是进程全局的，所以本文件的用例顺序执行，计数期间不跑别的会同步的工作。
 */

interface CountRow {
  readonly name: string;
  readonly syncCount: number;
  readonly directorySyncCount: number;
  /** 计数期间的链接、删除与父目录同步，按发生的先后；只给锁与作用域的行。 */
  readonly sequence?: readonly string[];
  readonly run: (root: RootedDirectory, base: string) => Promise<() => Promise<unknown>>;
}

const BYTES = Buffer.from("durability-class", "utf8");
const FILE = parsePortableResourcePath("state/record.json");
const LOCK = parsePortableResourcePath("state/record.lock");
const SCOPE_LOCKS = Object.freeze({
  gate: parsePortableResourcePath("admission/gate.lock"),
  scope: parsePortableResourcePath("admission/scope.lock"),
});

/** 正在计数时收集事件；计数之外（行的准备与收尾）为 null，不记。 */
let recorded: string[] | null = null;

/** 相对根的路径；暂存名带随机部分，换成固定的占位。 */
function labelOf(base: string, absolute: string): string {
  const relative = path.relative(base, absolute);
  const name = path.basename(relative);
  return `${path.dirname(relative)}/${name.startsWith(".wakeflow-atomic-") ? "<stage>" : name}`;
}

/** 在接缝的链接、删除与父目录句柄的同步上记事件；mock 随子测试结束还原。 */
function recordSequence(t: TestContext, base: string): void {
  const link = filesystemMutation.link;
  const unlink = filesystemMutation.unlink;
  const sync = RootedResourceParentHandle.prototype.sync;
  t.mock.method(filesystemMutation, "link", async (existingPath: string, newPath: string) => {
    await link.call(filesystemMutation, existingPath, newPath);
    recorded?.push(`link ${labelOf(base, newPath)}`);
  });
  t.mock.method(filesystemMutation, "unlink", async (target: string) => {
    await unlink.call(filesystemMutation, target);
    recorded?.push(`unlink ${labelOf(base, target)}`);
  });
  t.mock.method(
    RootedResourceParentHandle.prototype,
    "sync",
    async function (this: RootedResourceParentHandle) {
      recorded?.push(`sync ${path.relative(base, path.dirname(this.resourceAbsolutePath))}/`);
      return sync.call(this);
    },
  );
}

function scopeCycle(mode: RootedReadWriteMode): CountRow["run"] {
  return async (root, base) => {
    mkdirSync(path.join(base, "admission"), { mode: 0o700 });
    return () => withRootedReadWriteScope(root, SCOPE_LOCKS, mode, async () => "entered");
  };
}

const ROWS: readonly CountRow[] = [
  {
    name: "atomic create (authoritative)",
    syncCount: 3,
    directorySyncCount: 2,
    run: async (root) => () => createFileAtomically(root, FILE, BYTES, { mode: 0o600 }),
  },
  {
    name: "atomic replace (authoritative)",
    syncCount: 2,
    directorySyncCount: 1,
    run: async (root) => {
      await createFileAtomically(root, FILE, Buffer.from("before", "utf8"), { mode: 0o600 });
      const expected = await readStableFileDigest(root, FILE, {
        maximumBytes: parseByteCount(1024),
      });
      return () => replaceFileAtomically(root, FILE, BYTES, { mode: 0o600, expected });
    },
  },
  {
    name: "exact unlink (authoritative)",
    syncCount: 1,
    directorySyncCount: 1,
    run: async (root) => {
      await createFileAtomically(root, FILE, BYTES, { mode: 0o600 });
      const { node } = await root.inspectExistingResource(FILE);
      return () => unlinkRegularFileExactly(root, FILE, { expectedNode: node });
    },
  },
  {
    name: "standalone new directory (authoritative)",
    syncCount: 1,
    directorySyncCount: 1,
    run: async (root) => () =>
      createDirectoryAtomically(root, parsePortableResourcePath("state/fresh"), { mode: 0o700 }),
  },
  {
    name: "atomic create content-only (light lock file)",
    syncCount: 1,
    directorySyncCount: 0,
    run: async (root) => () =>
      createFileAtomically(root, FILE, BYTES, { mode: 0o600, durability: "content-only" }),
  },
  {
    name: "exact unlink none (best-effort deletions that were unsynced before 1.4.1)",
    syncCount: 0,
    directorySyncCount: 0,
    run: async (root) => {
      await createFileAtomically(root, FILE, BYTES, { mode: 0o600 });
      const { node } = await root.inspectExistingResource(FILE);
      return () => unlinkRegularFileExactly(root, FILE, { expectedNode: node, durability: "none" });
    },
  },
  {
    name: "kernel lock cycle (acquire and release; nothing reaches the disk)",
    syncCount: 0,
    directorySyncCount: 0,
    sequence: [],
    run: async (root) => () => withKernelFileLock(root, LOCK, "exclusive", async () => "held"),
  },
  {
    name: "shared operation scope enter and leave",
    syncCount: 0,
    directorySyncCount: 0,
    sequence: [],
    run: scopeCycle("shared"),
  },
  {
    name: "exclusive operation scope enter and leave",
    syncCount: 0,
    directorySyncCount: 0,
    sequence: [],
    run: scopeCycle("exclusive"),
  },
];

test("each durability class issues the fsync calls its table row states", {
  concurrency: false,
}, async (t) => {
  for (const row of ROWS) {
    await t.test(row.name, { concurrency: false }, async (t) => {
      const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-durability-class-")));
      mkdirSync(path.join(base, "state"), { mode: 0o700 });
      const root = await RootedDirectory.open(base, "$root", { durability: "fsync" });
      recordSequence(t, base);
      try {
        const operation = await row.run(root, base);
        const sequence: string[] = [];
        recorded = sequence;
        const counted = await countFsyncs(operation);
        recorded = null;
        deepEqual(
          { syncCount: counted.syncCount, directorySyncCount: counted.directorySyncCount },
          { syncCount: row.syncCount, directorySyncCount: row.directorySyncCount },
        );
        if (row.sequence !== undefined) deepEqual(sequence, row.sequence);
        // 每一行结束时不留暂存：减少的只是同步，不是清理。文件与锁的行在 `state/` 下工作，
        // 两个作用域行在 `admission/` 及其下的闩锁与租约目录里工作，所以整棵根递归地查。
        const leftovers = readdirSync(base, { recursive: true, encoding: "utf8" }).filter(
          (relative) => path.basename(relative).startsWith(".wakeflow-atomic-"),
        );
        deepEqual(leftovers, []);
      } finally {
        recorded = null;
        await root.close();
        rmSync(base, { recursive: true, force: true });
      }
    });
  }
});
