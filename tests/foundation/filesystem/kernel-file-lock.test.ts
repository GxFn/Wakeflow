/**
 * Level 1 (component): 内核咨询锁在一次性根上的获取、互斥、共享、持有者被强杀之后的可得性、路径被换之后
 * 的重来、重入与不安全节点（ADR-0033）。"别人持有"用真实子进程表示，所以带负载敏感标签。
 */
import { deepEqual, equal, rejects } from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import {
  isKernelFileLockHeldExclusively,
  KernelFileLockError,
  type KernelFileLockErrorReason,
  withKernelFileLock,
} from "../../../src/foundation/filesystem/kernel-file-lock.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { OperationAbortedError } from "../../../src/foundation/node/abort-signal.js";
import { holdKernelLockInChildProcess } from "../../support/kernel-lock-process.js";
import { loadSensitive } from "../../support/load-sensitive.js";

const LOCK = "locks/sample.lock";
const LOCK_REF = parsePortableResourcePath(LOCK, "$test");
const SHORT = { acquireTimeoutMilliseconds: 150, retryDelayMilliseconds: 10 } as const;

async function fixture(t: TestContext): Promise<RootedDirectory> {
  const directory = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-kernel-lock-")));
  mkdirSync(path.join(directory, "locks"), { mode: 0o700 });
  const root = await RootedDirectory.open(directory);
  t.after(async () => {
    await root.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return root;
}

function lockPath(root: RootedDirectory): string {
  return path.join(root.absolutePath, ...LOCK.split("/"));
}

function lockError(reason: KernelFileLockErrorReason) {
  return (error: unknown) => error instanceof KernelFileLockError && error.reason === reason;
}

test("独占：操作在锁内执行并返回结果；锁文件留下、是空的；目录里没有别的东西", async (t) => {
  const root = await fixture(t);
  const result = await withKernelFileLock(root, LOCK_REF, "exclusive", async () => {
    equal(await isKernelFileLockHeldExclusively(root, LOCK_REF), true);
    return "done";
  });
  equal(result, "done");
  equal(await isKernelFileLockHeldExclusively(root, LOCK_REF), false);
  equal(statSync(lockPath(root)).size, 0);
  deepEqual(readdirSync(path.dirname(lockPath(root))), ["sample.lock"]);
});

test("操作抛错时锁照样放开，错误原样上抛", async (t) => {
  const root = await fixture(t);
  const failure = new Error("operation failed");
  await rejects(
    withKernelFileLock(root, LOCK_REF, "exclusive", async () => {
      throw failure;
    }),
    (error: unknown) => error === failure,
  );
  equal(await isKernelFileLockHeldExclusively(root, LOCK_REF), false);
});

test("别的进程独占持有：独占与共享都等到超时，锁文件始终是空的；正常释放之后立刻可得", async (t) => {
  if (loadSensitive(t, "a real child process holds the lock")) return;
  const root = await fixture(t);
  const holder = await holdKernelLockInChildProcess(root.absolutePath, LOCK);
  try {
    equal(await isKernelFileLockHeldExclusively(root, LOCK_REF), true);
    for (const mode of ["exclusive", "shared"] as const) {
      await rejects(
        withKernelFileLock(root, LOCK_REF, mode, async () => undefined, SHORT),
        (error: unknown) =>
          error instanceof KernelFileLockError && error.reason === "timeout" && error.retryable,
      );
    }
    equal(statSync(lockPath(root)).size, 0);
  } finally {
    await holder.close();
  }
  equal(await withKernelFileLock(root, LOCK_REF, "exclusive", async () => 1, SHORT), 1);
});

test("持有者被强杀：下一次获取不需要任何清理，立刻拿到；磁盘上没有残留", async (t) => {
  if (loadSensitive(t, "a real child process is killed while it holds the lock")) return;
  const root = await fixture(t);
  const holder = await holdKernelLockInChildProcess(root.absolutePath, LOCK);
  await holder.crash();
  equal(await isKernelFileLockHeldExclusively(root, LOCK_REF), false);
  equal(await withKernelFileLock(root, LOCK_REF, "exclusive", async () => "next", SHORT), "next");
  deepEqual(readdirSync(path.dirname(lockPath(root))), ["sample.lock"]);
});

test("共享：与别的进程的共享持有者并存，独占要等它们走完；本进程里互不相干的两次共享也并存", async (t) => {
  if (loadSensitive(t, "a real child process holds a shared lock")) return;
  const root = await fixture(t);
  const sharer = await holdKernelLockInChildProcess(root.absolutePath, LOCK, "shared");
  try {
    equal(await withKernelFileLock(root, LOCK_REF, "shared", async () => "also", SHORT), "also");
    // 共享持有不算"被独占持有"。
    equal(await isKernelFileLockHeldExclusively(root, LOCK_REF), false);
    await rejects(
      withKernelFileLock(root, LOCK_REF, "exclusive", async () => undefined, SHORT),
      lockError("timeout"),
    );
  } finally {
    await sharer.close();
  }
  const both = await Promise.all([
    withKernelFileLock(root, LOCK_REF, "shared", async () => "a", SHORT),
    withKernelFileLock(root, LOCK_REF, "shared", async () => "b", SHORT),
  ]);
  deepEqual(both, ["a", "b"]);
});

test("本进程里互不相干的两次独占排队：后一个等前一个放开，不同时在锁内", async (t) => {
  const root = await fixture(t);
  let inside = 0;
  let overlapped = false;
  const body = async () => {
    inside += 1;
    if (inside > 1) overlapped = true;
    await new Promise((resolve) => setTimeout(resolve, 30));
    inside -= 1;
  };
  await Promise.all([
    withKernelFileLock(root, LOCK_REF, "exclusive", body),
    withKernelFileLock(root, LOCK_REF, "exclusive", body),
  ]);
  equal(overlapped, false);
});

test("同一条调用链里再次获取同一把锁是程序错误：当场报 reentered，不等到超时；另一把锁照常", async (t) => {
  const root = await fixture(t);
  const other = parsePortableResourcePath("locks/other.lock", "$test");
  await withKernelFileLock(root, LOCK_REF, "exclusive", async () => {
    await rejects(
      withKernelFileLock(root, LOCK_REF, "exclusive", async () => undefined),
      lockError("reentered"),
    );
    await rejects(
      withKernelFileLock(root, LOCK_REF, "shared", async () => undefined),
      lockError("reentered"),
    );
    equal(await withKernelFileLock(root, other, "exclusive", async () => "nested"), "nested");
  });
});

test("锁文件在等待期间被换成另一个节点：拿到旧节点的人关掉重来，最终持有的是路径上的那一个", async (t) => {
  const root = await fixture(t);
  writeFileSync(lockPath(root), "", { mode: 0o600 });
  // 持有旧节点时把路径上的文件删掉重建：此后旧节点上的锁挡不住新节点。
  await withKernelFileLock(root, LOCK_REF, "exclusive", async () => {
    unlinkSync(lockPath(root));
    writeFileSync(lockPath(root), "", { mode: 0o600 });
    // 这条调用链自己不能重入，所以用一条新的链去拿：它拿到的是新节点，核对通过。
    equal(await isKernelFileLockHeldExclusively(root, LOCK_REF), false);
  });
  // 路径被删掉、不再重建时：获取自己重新建出文件。
  unlinkSync(lockPath(root));
  equal(
    await withKernelFileLock(root, LOCK_REF, "exclusive", async () => "recreated"),
    "recreated",
  );
  equal(existsSync(lockPath(root)), true);
});

test("不安全与缺席：锁的位置上是符号链接或目录报 unsafe-lock；锁目录不在报 parent；中止报 aborted", async (t) => {
  const root = await fixture(t);
  symlinkSync(path.join(root.absolutePath, "elsewhere"), lockPath(root));
  await rejects(
    withKernelFileLock(root, LOCK_REF, "exclusive", async () => undefined),
    lockError("unsafe-lock"),
  );
  equal(
    existsSync(path.join(root.absolutePath, "elsewhere")),
    false,
    "nothing is created through it",
  );
  unlinkSync(lockPath(root));
  mkdirSync(lockPath(root));
  await rejects(
    withKernelFileLock(root, LOCK_REF, "shared", async () => undefined),
    lockError("unsafe-lock"),
  );
  await rejects(
    withKernelFileLock(
      root,
      parsePortableResourcePath("missing/sample.lock", "$test"),
      "exclusive",
      async () => undefined,
    ),
    lockError("parent"),
  );
  const controller = new AbortController();
  controller.abort();
  await rejects(
    withKernelFileLock(
      root,
      parsePortableResourcePath("locks/free.lock", "$test"),
      "exclusive",
      async () => undefined,
      {
        signal: controller.signal,
      },
    ),
    OperationAbortedError,
  );
});

test("只读地问：锁文件不在时答没有人持有，并且不创建它", async (t) => {
  const root = await fixture(t);
  equal(await isKernelFileLockHeldExclusively(root, LOCK_REF), false);
  equal(existsSync(lockPath(root)), false);
});
