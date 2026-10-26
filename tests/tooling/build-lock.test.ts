/**
 * 第 4 级（tooling）：`tooling/build-lock.ts` 与 `tooling/build-lock.mjs` 共用的仓库构建锁目录协议——
 * 串行化、同令牌重入、预算用完报 build-lock-busy（包装脚本退出 75），以及陈旧声明的回收（gate-log
 * §13.161）。回收的两处缺陷各有正反用例：open-items W24（T1，两个等待者读到同一个死 owner 时一方删掉
 * 另一方刚建立的活锁）与 W25（T2，owner 写入失败或无主目录让锁再也回收不了）。交错与写入失败通过
 * `syncBuiltinESMExports` 替换 `node:fs` 的 writeFileSync 注入，不在实现里留测试钩子。包装脚本用真实
 * 子进程跑一个 `node -e` 探针，墙钟等待都在 1 秒内，与文件里其余用例一起留在常规道。
 */
import { equal, rejects } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs, {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  BUILD_LOCK_RELATIVE,
  BUILD_LOCK_TOKEN_VARIABLE,
  BuildLockError,
  withBuildLock,
} from "../../tooling/build-lock.js";
import { disposableRoot } from "../support/temp-root.js";

const WRAPPER = fileURLToPath(new URL("../../../tooling/build-lock.mjs", import.meta.url));
const DEAD_OWNER = `${JSON.stringify({ pid: 2_147_483_647, token: "stale", command: "gone" })}\n`;

type WriteFileSync = typeof fs.writeFileSync;

function lockDirectory(root: string): string {
  return path.join(root, ...BUILD_LOCK_RELATIVE.split("/"));
}

function busy(error: unknown): boolean {
  return error instanceof BuildLockError && error.code === "build-lock-busy";
}

/** 把目录的 mtime 拨到一分钟前：一个声明者死在 mkdir 与写 owner 之间后留下的无主目录。 */
function abandon(directory: string): void {
  const seconds = (Date.now() - 60_000) / 1000;
  utimesSync(directory, seconds, seconds);
}

/**
 * 在 `run` 期间把 `node:fs` 的 writeFileSync 换成 `patched`：构建锁模块的具名导入是内建模块的活绑定，
 * 经 `syncBuiltinESMExports` 同步；结束后恢复原函数并再同步一次。
 */
async function withPatchedWriteFileSync<Result>(
  patched: WriteFileSync,
  run: () => Promise<Result>,
): Promise<Result> {
  const mutable = fs as { writeFileSync: WriteFileSync };
  const original = mutable.writeFileSync;
  mutable.writeFileSync = patched;
  syncBuiltinESMExports();
  try {
    return await run();
  } finally {
    mutable.writeFileSync = original;
    syncBuiltinESMExports();
  }
}

test("构建锁串行化同一仓库的持锁执行：第二个等待第一个释放，目录在释放后消失", async (t) => {
  const root = disposableRoot(t, "wakeflow-build-lock-");
  const order: string[] = [];
  const release = Promise.withResolvers<void>();
  const first = withBuildLock(root, "first", async () => {
    order.push("first-entered");
    equal(existsSync(path.join(lockDirectory(root), "owner.json")), true);
    await release.promise;
    order.push("first-leaving");
  });
  await delay(100);
  const second = withBuildLock(root, "second", async () => {
    order.push("second-entered");
  });
  await delay(300);
  equal(order.includes("second-entered"), false, "the second body must wait for the first");
  release.resolve();
  await Promise.all([first, second]);
  equal(order.join(","), "first-entered,first-leaving,second-entered");
  equal(existsSync(lockDirectory(root)), false);
});

test("已退出进程的陈旧声明被移除；活着的持有者在预算内等不到就报 build-lock-busy；同令牌重入", async (t) => {
  const root = disposableRoot(t, "wakeflow-build-lock-");
  mkdirSync(lockDirectory(root), { recursive: true });
  writeFileSync(path.join(lockDirectory(root), "owner.json"), DEAD_OWNER);
  equal(await withBuildLock(root, "after-stale", async () => "entered"), "entered");
  const release = Promise.withResolvers<void>();
  let heldToken = "";
  const holder = withBuildLock(root, "holder", async (token) => {
    heldToken = token;
    await release.promise;
  });
  await delay(100);
  await rejects(
    withBuildLock(root, "waiter", async () => "never", { timeoutMs: 400 }),
    busy,
  );
  const previous = process.env[BUILD_LOCK_TOKEN_VARIABLE];
  process.env[BUILD_LOCK_TOKEN_VARIABLE] = heldToken;
  try {
    equal(
      await withBuildLock(root, "nested", async () => "re-entered", { timeoutMs: 400 }),
      "re-entered",
    );
  } finally {
    if (previous === undefined) delete process.env[BUILD_LOCK_TOKEN_VARIABLE];
    else process.env[BUILD_LOCK_TOKEN_VARIABLE] = previous;
  }
  equal(
    existsSync(lockDirectory(root)),
    true,
    "the nested call must not release the holder's claim",
  );
  release.resolve();
  await holder;
  equal(existsSync(lockDirectory(root)), false);
});

test("陈旧回收的交错（W24/T1）：读到死 owner 后另一方抢先回收并写入新 owner，后来者撤回标记继续等待，不删新活锁", async (t) => {
  const root = disposableRoot(t, "wakeflow-build-lock-");
  const directory = lockDirectory(root);
  const ownerFile = path.join(directory, "owner.json");
  mkdirSync(directory, { recursive: true });
  writeFileSync(ownerFile, DEAD_OWNER);
  const live = `${JSON.stringify({ pid: process.pid, token: "other-reclaimer", command: "other" })}\n`;
  const original = fs.writeFileSync;
  let interleaved = 0;
  await withPatchedWriteFileSync(
    (...args: Parameters<WriteFileSync>) => {
      if (String(args[0]) === path.join(directory, "reclaim") && interleaved === 0) {
        interleaved += 1;
        // 另一方在后来者读完死 owner 之后、动手之前完成了回收并重新声明。
        rmSync(directory, { recursive: true, force: true });
        mkdirSync(directory, { mode: 0o700 });
        original(ownerFile, live, { mode: 0o600 });
      }
      return original(...args);
    },
    async () => {
      await rejects(
        withBuildLock(root, "latecomer", async () => "never", { timeoutMs: 400 }),
        busy,
      );
    },
  );
  equal(interleaved, 1);
  equal(readFileSync(ownerFile, "utf8"), live, "the other party's live claim must survive");
  equal(existsSync(path.join(directory, "reclaim")), false, "the latecomer withdraws its marker");
});

test("别人正在回收（reclaim 标记已在）时不动手：等到预算用完报 build-lock-busy，死 owner 与标记都原样保留", async (t) => {
  const root = disposableRoot(t, "wakeflow-build-lock-");
  const directory = lockDirectory(root);
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, "owner.json"), DEAD_OWNER);
  const marker = `${JSON.stringify({ pid: process.pid, token: "someone-else", startedAt: "2026-01-01T00:00:00.000Z" })}\n`;
  writeFileSync(path.join(directory, "reclaim"), marker);
  await rejects(
    withBuildLock(root, "waiter", async () => "never", { timeoutMs: 400 }),
    busy,
  );
  equal(readFileSync(path.join(directory, "owner.json"), "utf8"), DEAD_OWNER);
  equal(readFileSync(path.join(directory, "reclaim"), "utf8"), marker);
});

test("写 owner 失败（W25/T2）：撤掉自己刚建的目录并原样抛出写入错误，下一次声明不会对着无主目录干等", async (t) => {
  const root = disposableRoot(t, "wakeflow-build-lock-");
  const directory = lockDirectory(root);
  const injected = new Error("owner.json: ENOSPC (injected)");
  const original = fs.writeFileSync;
  let entered = 0;
  await withPatchedWriteFileSync(
    (...args: Parameters<WriteFileSync>) => {
      if (String(args[0]) === path.join(directory, "owner.json")) throw injected;
      return original(...args);
    },
    async () => {
      await rejects(
        withBuildLock(root, "failing-claim", async () => {
          entered += 1;
        }),
        (error: unknown) => error === injected,
      );
    },
  );
  equal(entered, 0);
  equal(existsSync(directory), false, "a claim that never got its owner must not linger");
  equal(
    await withBuildLock(root, "next-claim", async () => "entered", { timeoutMs: 400 }),
    "entered",
  );
});

test("无主声明目录（W25/T2）：年轻的当作正在写 owner，预算用完报 build-lock-busy 且不动它；超过 10 秒的视为陈旧，回收后声明成功", async (t) => {
  const root = disposableRoot(t, "wakeflow-build-lock-");
  const directory = lockDirectory(root);
  mkdirSync(directory, { recursive: true });
  await rejects(
    withBuildLock(root, "young", async () => "never", { timeoutMs: 400 }),
    busy,
  );
  equal(
    existsSync(directory),
    true,
    "a young claim without owner belongs to a claimant still writing",
  );
  equal(existsSync(path.join(directory, "reclaim")), false);
  abandon(directory);
  equal(await withBuildLock(root, "after-abandoned", async () => "entered"), "entered");
  equal(existsSync(directory), false);
});

test("npm run locked 的包装脚本：子进程拿到令牌、退出码原样透传、锁在退出后释放；锁被占用时按预算退出 75", async (t) => {
  const root = disposableRoot(t, "wakeflow-build-lock-");
  const probe = spawnSync(
    process.execPath,
    [
      WRAPPER,
      "--",
      process.execPath,
      "-e",
      `const fs=require("node:fs");fs.writeFileSync("probe.json",JSON.stringify({token:process.env.${BUILD_LOCK_TOKEN_VARIABLE}??null,locked:fs.existsSync(${JSON.stringify(lockDirectory(root))})}));process.exit(3)`,
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, WAKEFLOW_BUILD_LOCK_TIMEOUT_SECONDS: "5" },
    },
  );
  equal(probe.status, 3, probe.stderr);
  const observed = JSON.parse(readFileSync(path.join(root, "probe.json"), "utf8")) as {
    token: string | null;
    locked: boolean;
  };
  equal(typeof observed.token, "string");
  equal(observed.locked, true);
  equal(existsSync(lockDirectory(root)), false);

  const release = Promise.withResolvers<void>();
  const holder = withBuildLock(root, "holder", async () => {
    await release.promise;
  });
  await delay(100);
  const busyRun = spawnSync(
    process.execPath,
    [WRAPPER, process.execPath, "-e", "process.exit(0)"],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, WAKEFLOW_BUILD_LOCK_TIMEOUT_SECONDS: "1" },
    },
  );
  equal(busyRun.status, 75, busyRun.stderr);
  release.resolve();
  await holder;
});

test("包装脚本同样回收超过 10 秒的无主目录再把锁交给子进程；别人的回收标记在时按预算退出 75 且不动声明", async (t) => {
  const root = disposableRoot(t, "wakeflow-build-lock-");
  const directory = lockDirectory(root);
  mkdirSync(directory, { recursive: true });
  abandon(directory);
  const probe = spawnSync(
    process.execPath,
    [
      WRAPPER,
      "--",
      process.execPath,
      "-e",
      `const fs=require("node:fs");fs.writeFileSync("probe.json",JSON.stringify({locked:fs.existsSync(${JSON.stringify(path.join(directory, "owner.json"))})}));process.exit(3)`,
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, WAKEFLOW_BUILD_LOCK_TIMEOUT_SECONDS: "5" },
    },
  );
  equal(probe.status, 3, probe.stderr);
  equal(probe.stderr.includes("build lock: removing claim without owner"), true, probe.stderr);
  const observed = JSON.parse(readFileSync(path.join(root, "probe.json"), "utf8")) as {
    locked: boolean;
  };
  equal(observed.locked, true, "the wrapper's own claim carries an owner");
  equal(existsSync(directory), false);

  mkdirSync(directory);
  writeFileSync(path.join(directory, "owner.json"), DEAD_OWNER);
  writeFileSync(path.join(directory, "reclaim"), "{}\n");
  const busyRun = spawnSync(
    process.execPath,
    [WRAPPER, process.execPath, "-e", "process.exit(0)"],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, WAKEFLOW_BUILD_LOCK_TIMEOUT_SECONDS: "1" },
    },
  );
  equal(busyRun.status, 75, busyRun.stderr);
  equal(readFileSync(path.join(directory, "owner.json"), "utf8"), DEAD_OWNER);
  equal(existsSync(path.join(directory, "reclaim")), true);
});
