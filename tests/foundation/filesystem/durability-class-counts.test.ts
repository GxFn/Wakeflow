import { deepEqual } from "node:assert/strict";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { computeDurableAtomicFileStageTargetDigest } from "../../../src/foundation/filesystem/durable-atomic-file-stage-address.js";
import {
  createFileAtomically,
  replaceFileAtomically,
} from "../../../src/foundation/filesystem/durable-atomic-file-write.js";
import { createDirectoryAtomically } from "../../../src/foundation/filesystem/durable-directory-materialization.js";
import { unlinkRegularFileExactly } from "../../../src/foundation/filesystem/exact-regular-file-unlink.js";
import { filesystemMutation } from "../../../src/foundation/filesystem/filesystem-mutation.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  acquireRootedExclusiveFileLock,
  inspectRootedExclusiveFileLock,
  type RootedExclusiveFileLockDurability,
  retireRootedExclusiveFileLockResidue,
} from "../../../src/foundation/filesystem/rooted-exclusive-file-lock.js";
import {
  type RootedReadWriteMode,
  withRootedReadWriteScope,
} from "../../../src/foundation/filesystem/rooted-read-write-scope.js";
import { RootedResourceParentHandle } from "../../../src/foundation/filesystem/rooted-resource-parent-handle.js";
import { readStableFileDigest } from "../../../src/foundation/filesystem/stable-file-read.js";
import { parseByteCount } from "../../../src/foundation/numeric/byte-count.js";
import { countFsyncs } from "./fsync-count-probe.js";
import { rootedExclusiveFileLockRecordTextForTest } from "./rooted-exclusive-file-lock-test-support.js";

/**
 * Level 1 (component): 两档持久性的同步次数表，一处写全（1.4.1 第 1 段清单 2.1、2.2 节；七类锁按
 * 重排计划第 3 节路丙）。
 *
 * 每一行在真实同步的根上（不调用 useDisposableDurability）数一次操作发出的 `fsync` 与其中目录句柄
 * 上的次数。权威档：原子新建 3（暂存内容；链接之后父目录；删暂存之后父目录）、原子替换 2（暂存内容；
 * 重命名之后父目录）、精确删除 1（父目录）、单独新建一个目录 1（父目录）。锁只在获取时分档，释放与
 * 失效锁的退休不分档、都在删掉锁文件之后同步父目录：默认锁（L8 到 L12）一个周期 4（新建 3、释放 1），
 * 轻档锁（L1 到 L7）一个周期 2（链接之前的内容 1、释放时的父目录 1）；退休一把失效锁 1（父目录），
 * 双链接的失效锁 4（结算锁文件的内容与父目录 2、退役暂存 1、删锁 1）。操作作用域的进出由闩锁周期加
 * 租约周期组成：共享 = 闩锁 2 + 读者租约 2 = 4；独占 = 准入闩锁 2 + 写者锁 2 + 排空闩锁 2 = 6。
 *
 * 锁与作用域的行另外按先后记下接缝 `filesystemMutation` 上的链接与删除、以及父目录同步，钉住每次释放
 * 与退休的父目录同步都在删掉锁文件之后：这次同步也让同一周期此前在该目录里的链接与删暂存一起落盘。
 * 前几行在各原语自己的测试里也钉过；这里把整张表放在一处，改任何一档原语的定义都会在这里同时看见。
 *
 * 锁的四行直接调锁原语、档位写在测试里，钉的是原语的两档，不是哪一族取哪一档；作用域两行经读写
 * 作用域原语。各锁族经自己的生产包装取的档（L1–L7 轻档、L8–L12 缺省档）由 tests/kernel、
 * tests/governance、tests/configuration 与 tests/workspace 下的 lock-family-durability.test.ts 钉住，
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
const AREA = parsePortableResourcePath("admission");
const READER_LEASE = /^reader-[0-9a-f-]{36}\.lock$/u;

/** 正在计数时收集事件；计数之外（行的准备与收尾）为 null，不记。 */
let recorded: string[] | null = null;

/** 相对根的路径；暂存名与读者租约名带随机部分，换成固定的占位。 */
function labelOf(base: string, absolute: string): string {
  const relative = path.relative(base, absolute);
  const name = path.basename(relative);
  const label = name.startsWith(".wakeflow-atomic-")
    ? "<stage>"
    : READER_LEASE.test(name)
      ? "reader-<uuid>.lock"
      : name;
  return `${path.dirname(relative)}/${label}`;
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

function lockCycle(durability: RootedExclusiveFileLockDurability): CountRow["run"] {
  return async (root) => async () => {
    const lease = await acquireRootedExclusiveFileLock(root, LOCK, { durability });
    await lease.release();
  };
}

/**
 * 失效锁的退休。记录里没有档位，退休也不分档，所以一行代表 L1 到 L12 全部。`linkedStage` 时持有者
 * 死在锁已链接、创建暂存尚未退役的那一刻（open-items B9）：暂存名与 foundation 签发的同形（目标摘要、
 * 内容摘要、权限位、已死的属主），退休先结算并退役它，再删锁。
 */
function deadLockRetirement(linkedStage: boolean): CountRow["run"] {
  return async (root, base) => {
    const text = rootedExclusiveFileLockRecordTextForTest({
      tokenUuid: "55555555-5555-4555-8555-555555555555",
    });
    writeFileSync(path.join(base, LOCK), text, { mode: 0o600 });
    if (linkedStage) {
      const hex = (digest: string) => digest.slice("sha256:".length);
      const stageName = `.wakeflow-atomic-v1-create-${hex(
        computeDurableAtomicFileStageTargetDigest(LOCK),
      )}-${hex(computeSha256Digest(new TextEncoder().encode(text)))}-m600__2147483647-0-77777777-7777-4777-8777-777777777777.tmp`;
      linkSync(path.join(base, LOCK), path.join(base, "state", stageName));
    }
    const observed = await inspectRootedExclusiveFileLock(root, LOCK);
    if (
      observed.status !== "held" ||
      observed.ownerState !== "inactive" ||
      observed.node.linkCount !== (linkedStage ? 2n : 1n)
    ) {
      throw new Error("Expected an inactive lock residue with the planned link count.");
    }
    return () => retireRootedExclusiveFileLockResidue(root, LOCK, observed);
  };
}

function scopeCycle(mode: RootedReadWriteMode): CountRow["run"] {
  return async (root, base) => {
    mkdirSync(path.join(base, AREA), { mode: 0o700 });
    return () => withRootedReadWriteScope(root, AREA, mode, async () => "entered");
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
    name: "default lock cycle, primitive (the L8-L12 level: create 3 + release 1)",
    syncCount: 4,
    directorySyncCount: 3,
    sequence: [
      "link state/record.lock",
      "sync state/",
      "unlink state/<stage>",
      "sync state/",
      "unlink state/record.lock",
      "sync state/",
    ],
    run: lockCycle("fsync"),
  },
  {
    name: "light lock cycle, primitive (the L1-L7 level: content 1 + release 1)",
    syncCount: 2,
    directorySyncCount: 1,
    sequence: [
      "link state/record.lock",
      "unlink state/<stage>",
      "unlink state/record.lock",
      "sync state/",
    ],
    run: lockCycle("content-only"),
  },
  {
    name: "dead lock retirement (every family L1-L12: unlink 1)",
    syncCount: 1,
    directorySyncCount: 1,
    sequence: ["unlink state/record.lock", "sync state/"],
    run: deadLockRetirement(false),
  },
  {
    name: "dead two-link lock retirement (settle 2 + retire stage 1 + unlink 1)",
    syncCount: 4,
    directorySyncCount: 3,
    sequence: [
      "sync state/",
      "unlink state/<stage>",
      "sync state/",
      "unlink state/record.lock",
      "sync state/",
    ],
    run: deadLockRetirement(true),
  },
  {
    name: "shared operation scope enter and leave (latch 2 + reader lease 2)",
    syncCount: 4,
    directorySyncCount: 2,
    sequence: [
      "link admission/latch.lock",
      "unlink admission/<stage>",
      "link admission/reader-<uuid>.lock",
      "unlink admission/<stage>",
      "unlink admission/latch.lock",
      "sync admission/",
      "unlink admission/reader-<uuid>.lock",
      "sync admission/",
    ],
    run: scopeCycle("shared"),
  },
  {
    name: "exclusive operation scope enter and leave (latch 2 + writer 2 + drain latch 2)",
    syncCount: 6,
    directorySyncCount: 3,
    sequence: [
      "link admission/latch.lock",
      "unlink admission/<stage>",
      "link admission/writer.lock",
      "unlink admission/<stage>",
      "unlink admission/latch.lock",
      "sync admission/",
      "link admission/latch.lock",
      "unlink admission/<stage>",
      "unlink admission/latch.lock",
      "sync admission/",
      "unlink admission/writer.lock",
      "sync admission/",
    ],
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
