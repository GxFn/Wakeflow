/**
 * Level 1 (component): 读写作用域在一次性根上的行为——共享者并存、等待中的写者关上门并等在场的共享者走完、
 * 准入前检查在门内执行、失败与中止不留下持有、持有者被强杀之后不需要清理（ADR-0017，ADR-0033 决定 4）。
 * "别的进程"用真实子进程表示，所以带负载敏感标签。
 */
import { deepEqual, equal, rejects } from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  RootedReadWriteScopeError,
  withRootedReadWriteScope,
} from "../../../src/foundation/filesystem/rooted-read-write-scope.js";
import { loadSensitive } from "../../support/load-sensitive.js";

const LOCKS = Object.freeze({
  gate: parsePortableResourcePath("admission/gate.lock"),
  scope: parsePortableResourcePath("admission/scope.lock"),
});
const SHORT = { acquireTimeoutMilliseconds: 200 } as const;

async function fixture(t: TestContext): Promise<RootedDirectory> {
  const directory = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-rw-scope-")));
  mkdirSync(path.join(directory, "admission"), { mode: 0o700 });
  const root = await RootedDirectory.open(directory);
  t.after(async () => {
    await root.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return root;
}

function scopeError(reason: RootedReadWriteScopeError["reason"]) {
  return (error: unknown) => error instanceof RootedReadWriteScopeError && error.reason === reason;
}

async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (predicate()) return;
    await delay(5);
  }
  throw new Error("condition was not reached");
}

/** 一个停在作用域里的持有者：`release` 让它走完。 */
function parked(root: RootedDirectory, mode: "shared" | "exclusive") {
  let release: () => void = () => undefined;
  let entered = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const done = withRootedReadWriteScope(root, LOCKS, mode, async () => {
    entered = true;
    await gate;
  });
  return { done, release, isInside: () => entered };
}

/** 真实子进程以共享方式停在作用域里；返回时它已经在里面。 */
async function holdSharedInChildProcess(t: TestContext, root: RootedDirectory) {
  const script = fileURLToPath(
    new URL("../../support/read-write-scope-holder.js", import.meta.url),
  );
  const child = spawn(process.execPath, [script, root.absolutePath], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  t.after(() => {
    child.kill("SIGKILL");
  });
  await once(child.stdout, "data");
  return {
    async kill() {
      child.kill("SIGKILL");
      await once(child, "exit");
    },
  };
}

test("共享者并存；等待中的写者关上门：新的共享者进不来，在场的共享者走完之后写者才进去", async (t) => {
  const root = await fixture(t);
  const first = parked(root, "shared");
  const second = parked(root, "shared");
  await until(() => first.isInside() && second.isInside());

  const order: string[] = [];
  const writer = withRootedReadWriteScope(root, LOCKS, "exclusive", async () => {
    order.push("writer");
  });
  // 写者已经拿着门在等：这之后来的共享者排在它后面。
  await delay(60);
  const late = withRootedReadWriteScope(root, LOCKS, "shared", async () => {
    order.push("late-reader");
  });
  await delay(60);
  deepEqual(order, [], "nobody enters while the first readers are inside");

  first.release();
  await delay(60);
  deepEqual(order, [], "the writer waits for every reader that was already inside");
  second.release();
  await Promise.all([first.done, second.done, writer, late]);
  deepEqual(order, ["writer", "late-reader"]);
});

test("写者在里面时共享者与另一个写者都等到超时；它走完之后都进得去", async (t) => {
  const root = await fixture(t);
  const writer = parked(root, "exclusive");
  await until(() => writer.isInside());
  await rejects(
    withRootedReadWriteScope(root, LOCKS, "shared", async () => undefined, SHORT),
    scopeError("timeout"),
  );
  await rejects(
    withRootedReadWriteScope(root, LOCKS, "exclusive", async () => undefined, SHORT),
    scopeError("timeout"),
  );
  writer.release();
  await writer.done;
  equal(await withRootedReadWriteScope(root, LOCKS, "shared", async () => "in", SHORT), "in");
  equal(await withRootedReadWriteScope(root, LOCKS, "exclusive", async () => "in", SHORT), "in");
});

test("准入前检查在门内执行：它抛错时不进入作用域、错误原样上抛、什么都不留下持有", async (t) => {
  const root = await fixture(t);
  const refusal = new Error("reservation");
  let entered = false;
  for (const mode of ["shared", "exclusive"] as const) {
    await rejects(
      withRootedReadWriteScope(
        root,
        LOCKS,
        mode,
        async () => {
          entered = true;
        },
        {
          beforeEnter: async () => {
            throw refusal;
          },
        },
      ),
      (error: unknown) => error === refusal,
    );
  }
  equal(entered, false);
  // 门与作用域都已放开：下一个写者立刻进得去。
  equal(
    await withRootedReadWriteScope(root, LOCKS, "exclusive", async () => "next", SHORT),
    "next",
  );
});

test("操作抛错与中止：持有照样放开；已经中止的信号不进入", async (t) => {
  const root = await fixture(t);
  const failure = new Error("operation failed");
  await rejects(
    withRootedReadWriteScope(root, LOCKS, "shared", async () => {
      throw failure;
    }),
    (error: unknown) => error === failure,
  );
  const aborted = new AbortController();
  aborted.abort();
  await rejects(
    withRootedReadWriteScope(root, LOCKS, "exclusive", async () => undefined, {
      signal: aborted.signal,
    }),
    scopeError("aborted"),
  );
  // 等待途中被中止：写者在里面，共享者等着，信号一到就以 aborted 收场。
  const writer = parked(root, "exclusive");
  await until(() => writer.isInside());
  const waiting = new AbortController();
  const reader = withRootedReadWriteScope(root, LOCKS, "shared", async () => undefined, {
    signal: waiting.signal,
  });
  await delay(40);
  waiting.abort();
  await rejects(reader, scopeError("aborted"));
  writer.release();
  await writer.done;
  equal(
    await withRootedReadWriteScope(root, LOCKS, "exclusive", async () => "free", SHORT),
    "free",
  );
});

test("共享持有者被强杀：写者不需要任何清理就进得去；目录里始终只有那两个锁文件", async (t) => {
  if (loadSensitive(t, "a real child process holds the shared scope and is killed")) return;
  const root = await fixture(t);
  const holder = await holdSharedInChildProcess(t, root);
  await rejects(
    withRootedReadWriteScope(root, LOCKS, "exclusive", async () => undefined, SHORT),
    scopeError("timeout"),
  );
  // 活着的共享者不挡别的共享者。
  equal(await withRootedReadWriteScope(root, LOCKS, "shared", async () => "also", SHORT), "also");
  await holder.kill();
  equal(await withRootedReadWriteScope(root, LOCKS, "exclusive", async () => "in", SHORT), "in");
  deepEqual(readdirSync(path.join(root.absolutePath, "admission")).sort(), [
    "gate.lock",
    "scope.lock",
  ]);
});

test("输入不对与目录不在：模式、选项不认识报 input；锁目录不在报 unsafe", async (t) => {
  const root = await fixture(t);
  await rejects(
    withRootedReadWriteScope(root, LOCKS, "upgrade" as "shared", async () => undefined),
    scopeError("input"),
  );
  await rejects(
    withRootedReadWriteScope(root, LOCKS, "shared", async () => undefined, {
      unknown: true,
    } as never),
    scopeError("input"),
  );
  const missing = Object.freeze({
    gate: parsePortableResourcePath("absent/gate.lock"),
    scope: parsePortableResourcePath("absent/scope.lock"),
  });
  await rejects(
    withRootedReadWriteScope(root, missing, "shared", async () => undefined),
    scopeError("unsafe"),
  );
});
