import { equal, rejects } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  BUILD_LOCK_RELATIVE,
  BUILD_LOCK_TOKEN_VARIABLE,
  BuildLockError,
  withBuildLock,
} from "../../tooling/build-lock.js";

const WRAPPER = fileURLToPath(new URL("../../../tooling/build-lock.mjs", import.meta.url));

function fixture(t: TestContext): string {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-build-lock-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function lockDirectory(root: string): string {
  return path.join(root, ...BUILD_LOCK_RELATIVE.split("/"));
}

test("构建锁串行化同一仓库的持锁执行：第二个等待第一个释放，目录在释放后消失", async (t) => {
  const root = fixture(t);
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
  const root = fixture(t);
  mkdirSync(lockDirectory(root), { recursive: true });
  writeFileSync(
    path.join(lockDirectory(root), "owner.json"),
    `${JSON.stringify({ pid: 2_147_483_647, token: "stale", command: "gone" })}\n`,
  );
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
    (error: unknown) => error instanceof BuildLockError && error.code === "build-lock-busy",
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

test("npm run locked 的包装脚本：子进程拿到令牌、退出码原样透传、锁在退出后释放；锁被占用时按预算退出 75", async (t) => {
  const root = fixture(t);
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
  const observed = JSON.parse(
    spawnSync(
      process.execPath,
      ["-e", `process.stdout.write(require("node:fs").readFileSync("probe.json","utf8"))`],
      {
        cwd: root,
        encoding: "utf8",
      },
    ).stdout,
  ) as { token: string | null; locked: boolean };
  equal(typeof observed.token, "string");
  equal(observed.locked, true);
  equal(existsSync(lockDirectory(root)), false);

  const release = Promise.withResolvers<void>();
  const holder = withBuildLock(root, "holder", async () => {
    await release.promise;
  });
  await delay(100);
  const busy = spawnSync(process.execPath, [WRAPPER, process.execPath, "-e", "process.exit(0)"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, WAKEFLOW_BUILD_LOCK_TIMEOUT_SECONDS: "1" },
  });
  equal(busy.status, 75, busy.stderr);
  release.resolve();
  await holder;
});
