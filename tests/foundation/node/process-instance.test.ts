import { deepEqual, equal, rejects, throws } from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import { computeCanonicalJsonSha256Digest } from "../../../src/foundation/crypto/canonical-json-sha256.js";
import {
  observePidOwnerSync,
  observeProcessInstance,
  parseProcessHolderLine,
  recordedProcessIsInactive,
} from "../../../src/foundation/node/process-instance.js";
import { loadSensitive } from "../../support/load-sensitive.js";

test("process birth observations are stable, and PID replacement needs positive evidence", async () => {
  const one = await observeProcessInstance(process.pid);
  const two = await observeProcessInstance(process.pid);
  equal(one.state, "active");
  equal(two.birthDigest, one.birthDigest);
  const old = computeCanonicalJsonSha256Digest({ birth: "old" });
  const current = computeCanonicalJsonSha256Digest({ birth: "new" });
  equal(recordedProcessIsInactive(old, { state: "active", birthDigest: current }), true);
  equal(recordedProcessIsInactive(old, { state: "unknown", birthDigest: current }), true);
  equal(recordedProcessIsInactive(old, { state: "active", birthDigest: old }), false);
  equal(recordedProcessIsInactive(old, { state: "unknown", birthDigest: null }), false);
  equal(recordedProcessIsInactive(null, { state: "active", birthDigest: current }), false);
  equal(recordedProcessIsInactive(null, { state: "inactive", birthDigest: null }), true);
  await rejects(observeProcessInstance(-1), TypeError);
});

test("ps holder lines parse to the owner and a UTC start instant; anything else is not a holder", () => {
  deepEqual(parseProcessHolderLine("  501 Mon Nov  9 21:12:00 2026\n"), {
    userId: 501,
    startedAtMs: Date.UTC(2026, 10, 9, 21, 12, 0),
  });
  deepEqual(parseProcessHolderLine("0 Sat Jan 31 00:00:59 2026"), {
    userId: 0,
    startedAtMs: Date.UTC(2026, 0, 31, 0, 0, 59),
  });
  for (const line of ["", "501", "501 Mon Foo  9 21:12:00 2026", "x Mon Nov  9 21:12:00 2026"]) {
    equal(parseProcessHolderLine(line), null, line);
  }
});

test("a pid-only owner is gone when no process holds the pid, when the holder belongs to another user, or when the holder started after the residue was last written（open-items B7）", async (t) => {
  if (loadSensitive(t, "real child processes and one real ps read")) return;
  const uid = BigInt(process.getuid?.() ?? 0);
  const now = Date.now();
  const aged = { userId: uid, modifiedAtNanoseconds: BigInt(now - 10 * 60_000) * 1_000_000n };
  const fresh = { userId: uid, modifiedAtNanoseconds: BigInt(now) * 1_000_000n };
  const holder = (startedAtMs: number, userId = Number(uid)) => {
    let reads = 0;
    return {
      reads: () => reads,
      readHolder: () => {
        reads += 1;
        return { userId, startedAtMs };
      },
    };
  };

  // 没有进程占着这个 pid：不看别的。
  const exited = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await once(exited, "exit");
  if (exited.pid === undefined) throw new Error("child had no pid");
  equal(observePidOwnerSync(exited.pid, aged, holder(now)), "inactive");

  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  t.after(() => child.kill("SIGKILL"));
  if (child.pid === undefined) throw new Error("child had no pid");
  // 没有节点事实：就是 kill(pid, 0)。
  equal(observePidOwnerSync(child.pid), "active");
  // 刚写过的暂存：能发信号的进程就是活着的所有者，不去读 ps（争用路径不起子进程）。
  const untouched = holder(now);
  equal(observePidOwnerSync(child.pid, fresh, untouched), "active");
  equal(untouched.reads(), 0);
  // 放了十分钟的残留：占着这个 pid 的进程在最后一次写它之后才启动——不是创建者。
  equal(observePidOwnerSync(child.pid, aged, holder(now - 60_000)), "inactive");
  // 在最后一次写它之前就已经在运行：可能就是创建者，照旧是 active；启动时刻只到秒，留两秒余量。
  equal(observePidOwnerSync(child.pid, aged, holder(now - 20 * 60_000)), "active");
  equal(observePidOwnerSync(child.pid, aged, holder(now - 10 * 60_000 + 1_500)), "active");
  // 属主不同：不是创建者，新旧都一样。
  equal(
    observePidOwnerSync(child.pid, aged, holder(now - 20 * 60_000, Number(uid) + 1)),
    "inactive",
  );
  // 读不出占着它的进程：维持原来的回答。
  equal(observePidOwnerSync(child.pid, aged, { readHolder: () => null }), "active");
  // 真实的 ps：子进程刚启动，残留十分钟前就写完了。
  equal(observePidOwnerSync(child.pid, aged), "inactive");
  // 残留是"一分钟后"写的（时钟拨到十分钟后去看）：子进程那时已经在运行。
  equal(
    observePidOwnerSync(
      child.pid,
      { userId: uid, modifiedAtNanoseconds: BigInt(now + 60_000) * 1_000_000n },
      { now: () => now + 10 * 60_000 },
    ),
    "active",
  );

  // 发不了信号的进程（pid 1 属于 root）：属主不同即不是创建者；读不出、或同属主（沙箱里的 EPERM）仍是 unknown。
  if (uid !== 0n) {
    equal(observePidOwnerSync(1, fresh, holder(0, 0)), "inactive");
    equal(observePidOwnerSync(1, fresh, { readHolder: () => null }), "unknown");
    equal(observePidOwnerSync(1, fresh, holder(0)), "unknown");
    equal(observePidOwnerSync(1), "unknown");
    equal(observePidOwnerSync(1, fresh), "inactive", "the real ps shows pid 1 belongs to root");
  }
  throws(() => observePidOwnerSync(0), TypeError);
});
