import { deepEqual, equal, rejects } from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test, type TestContext } from "node:test";
import { threadId } from "node:worker_threads";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import {
  issueDurableAtomicFileStageAddress,
  releaseDurableAtomicFileStageAddress,
} from "../../../src/foundation/filesystem/durable-atomic-file-stage-address.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { RootedResourceParentHandle, RootedResourceParentHandleError } from "../../../src/foundation/filesystem/rooted-resource-parent-handle.js";
import { RootedExclusiveFileLockError } from "../../../src/foundation/filesystem/rooted-exclusive-file-lock.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { withRootedReadWriteScope, RootedReadWriteScopeError } from "../../../src/foundation/filesystem/rooted-read-write-scope.js";
import { rootedExclusiveFileLockRecordTextForTest } from "./rooted-exclusive-file-lock-test-support.js";

const AREA = parsePortableResourcePath("admission");
async function fixture(t: TestContext) {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-admission-")));
  mkdirSync(path.join(base, AREA), { mode: 0o700 });
  const root = await RootedDirectory.open(base);
  t.after(async () => { await root.close(); rmSync(base, { recursive: true, force: true }); });
  return { base, root, area: path.join(base, AREA) };
}

async function until(predicate: () => boolean) {
  const end = performance.now() + 5000;
  while (!predicate()) { if (performance.now() > end) throw new Error("Checkpoint timed out."); await delay(10); }
}

test("shared readers overlap; a waiting writer closes admission and drains existing readers", { timeout: 15000 }, async (t) => {
  const f = await fixture(t);
  const release = Promise.withResolvers<void>();
  const releaseWriter = Promise.withResolvers<void>();
  const events: string[] = [];
  const first = withRootedReadWriteScope(f.root, AREA, "shared", async () => { events.push("first"); await release.promise; });
  const second = withRootedReadWriteScope(f.root, AREA, "shared", async () => { events.push("second"); await release.promise; });
  await until(() => events.length === 2);
  const writer = withRootedReadWriteScope(f.root, AREA, "exclusive", async () => { events.push("writer"); await releaseWriter.promise; });
  await until(() => existsSync(path.join(f.area, "writer.lock")));
  let lateEntered = false;
  const late = withRootedReadWriteScope(f.root, AREA, "shared", async () => { lateEntered = true; events.push("late"); });
  try {
    equal(events.includes("writer"), false);
    equal(lateEntered, false);
    release.resolve(); await Promise.all([first, second]);
    await until(() => events.includes("writer"));
    equal(lateEntered, false);
    releaseWriter.resolve(); await Promise.all([writer, late]);
    deepEqual(events.slice(2), ["writer", "late"]);
    deepEqual(readdirSync(f.area), []);
  } finally { release.resolve(); releaseWriter.resolve(); await Promise.allSettled([first, second, writer, late]); }
});

test("cancellation and failed callbacks release their leases without entering a waiting reader", async (t) => {
  const f = await fixture(t);
  const entered = Promise.withResolvers<void>(); const release = Promise.withResolvers<void>();
  const writer = withRootedReadWriteScope(f.root, AREA, "exclusive", async () => { entered.resolve(); await release.promise; });
  await entered.promise;
  const signal = new AbortController(); let executed = false;
  const reader = withRootedReadWriteScope(f.root, AREA, "shared", async () => { executed = true; }, { signal: signal.signal });
  signal.abort();
  try { await rejects(reader, (e: unknown) => e instanceof RootedReadWriteScopeError && e.reason === "aborted"); equal(executed, false); }
  finally { release.resolve(); await writer; }
  await rejects(withRootedReadWriteScope(f.root, AREA, "shared", async () => { throw new Error("body-failed"); }), /body-failed/u);
  deepEqual(readdirSync(f.area), []);
});

test("a reader release during lease inspection is reobserved; a replacement with an unknown owner stays protected", { timeout: 15000 }, async (t) => {
  for (const replacement of [false, true]) {
    await t.test(replacement ? "unknown replacement" : "normal release", async (t) => {
      const f = await fixture(t);
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const reader = withRootedReadWriteScope(f.root, AREA, "shared", async () => {
        entered.resolve(); await release.promise;
      });
      await entered.promise;
      const name = readdirSync(f.area).find((name) => name.startsWith("reader-"));
      if (name === undefined) throw new Error("Missing real reader lease.");
      const ref = parsePortableResourcePath(`${AREA}/${name}`);
      const unknown = rootedExclusiveFileLockRecordTextForTest({ pid: process.pid, threadId,
        tokenUuid: "33333333-3333-4333-8333-333333333333" });
      const inspect = f.root.inspectExistingResource.bind(f.root);
      let interrupted = false;
      t.mock.method(f.root, "inspectExistingResource", async (...args: Parameters<typeof inspect>) => {
        const snapshot = await inspect(...args);
        if (!interrupted && args[0] === ref && existsSync(path.join(f.area, "writer.lock"))) {
          interrupted = true;
          release.resolve();
          await reader;
          if (replacement) writeFileSync(path.join(f.area, name), unknown, { mode: 0o600 });
        }
        return snapshot;
      });
      let writerEntered = false;
      try {
        // 未知所有者按活着等待，预算耗尽才是 recovery-required：给写者一个短预算。
        const writer = withRootedReadWriteScope(f.root, AREA, "exclusive", async () => { writerEntered = true; },
          { acquireTimeoutMilliseconds: 3000 });
        if (replacement) {
          await rejects(writer, (e: unknown) => e instanceof RootedReadWriteScopeError && e.reason === "recovery-required");
          equal(writerEntered, false);
          equal(readFileSync(path.join(f.area, name), "utf8"), unknown);
        } else {
          await writer;
          equal(writerEntered, true);
          deepEqual(readdirSync(f.area), []);
        }
        equal(interrupted, true);
      } finally {
        release.resolve(); await reader;
      }
    });
  }
});

test("latch settlement failure releases acquired admission before propagating the failure", { timeout: 15000 }, async (t) => {
  for (const [mode, releaseNumber] of [["shared", 1], ["exclusive", 1], ["exclusive", 2]] as const) {
    await t.test(`${mode} latch release ${releaseNumber}`, async (t) => {
      const f = await fixture(t);
      const originalSync = RootedResourceParentHandle.prototype.sync;
      let settlements = 0;
      let injected = false;
      let entered = false;
      t.mock.method(RootedResourceParentHandle.prototype, "sync", async function(this: RootedResourceParentHandle, ...args: Parameters<typeof originalSync>) {
        if (this.resourceAbsolutePath === path.join(f.area, "latch.lock") && !existsSync(this.resourceAbsolutePath)) {
          settlements += 1;
          if (settlements === releaseNumber) {
            injected = true;
            throw new RootedResourceParentHandleError("sync-failure", "$test");
          }
        }
        return originalSync.apply(this, args);
      });
      await rejects(withRootedReadWriteScope(f.root, AREA, mode, async () => { entered = true; }),
        (error: unknown) => error instanceof RootedExclusiveFileLockError && error.reason === "release-failure");
      equal(injected, true);
      equal(entered, false);
      deepEqual(readdirSync(f.area), []);
      t.mock.restoreAll();
      // Both admission modes must remain usable in this same live process.
      for (const nextMode of ["shared", "exclusive"] as const) {
        equal(await withRootedReadWriteScope(f.root, AREA, nextMode, async () => "entered",
          { acquireTimeoutMilliseconds: 1000 }), "entered");
      }
      deepEqual(readdirSync(f.area), []);
    });
  }
});

test("latch failure cleanup cannot remove an unknown replacement of the acquired lease", async (t) => {
  for (const mode of ["shared", "exclusive"] as const) {
    await t.test(mode, async (t) => {
      const f = await fixture(t);
      const originalSync = RootedResourceParentHandle.prototype.sync;
      const unknown = rootedExclusiveFileLockRecordTextForTest({ pid: process.pid, threadId,
        tokenUuid: "33333333-3333-4333-8333-333333333333" });
      let replacement: string | undefined;
      let entered = false;
      t.mock.method(RootedResourceParentHandle.prototype, "sync", async function(this: RootedResourceParentHandle, ...args: Parameters<typeof originalSync>) {
        if (replacement === undefined && this.resourceAbsolutePath === path.join(f.area, "latch.lock") && !existsSync(this.resourceAbsolutePath)) {
          const name = readdirSync(f.area).find((name) => name === "writer.lock" || name.startsWith("reader-"));
          if (name === undefined) throw new Error("Missing acquired lease.");
          replacement = path.join(f.area, name);
          rmSync(replacement);
          writeFileSync(replacement, unknown, { mode: 0o600 });
          throw new RootedResourceParentHandleError("sync-failure", "$test");
        }
        return originalSync.apply(this, args);
      });
      await rejects(withRootedReadWriteScope(f.root, AREA, mode, async () => { entered = true; }),
        (error: unknown) => error instanceof RootedExclusiveFileLockError && error.reason === "release-failure");
      equal(entered, false);
      if (replacement === undefined) throw new Error("Fault boundary was not reached.");
      equal(readFileSync(replacement, "utf8"), unknown);
      t.mock.restoreAll();
      await rejects(withRootedReadWriteScope(f.root, AREA, "exclusive", async () => { entered = true; }),
        (error: unknown) => error instanceof RootedReadWriteScopeError && error.reason === "recovery-required");
      equal(entered, false);
      equal(readFileSync(replacement, "utf8"), unknown);
    });
  }
});

test("unknown same-PID owners and unrecognized files stay protected", async (t) => {
  const f = await fixture(t);
  const reader = path.join(f.area, "reader-11111111-1111-4111-8111-111111111111.lock");
  const bytes = rootedExclusiveFileLockRecordTextForTest({ pid: process.pid, threadId,
    tokenUuid: "22222222-2222-4222-8222-222222222222" });
  writeFileSync(reader, bytes, { mode: 0o600 });
  // An unknown owner is waited on like a live one; the spent budget turns it into a recovery request (§13.161 F2).
  const started = performance.now();
  await rejects(withRootedReadWriteScope(f.root, AREA, "exclusive", async () => {}, { acquireTimeoutMilliseconds: 300 }),
    (e: unknown) => e instanceof RootedReadWriteScopeError && e.reason === "recovery-required");
  equal(performance.now() - started >= 250, true, "the writer must wait out its budget before asking for recovery");
  equal(readFileSync(reader, "utf8"), bytes);
  rmSync(reader);
  const unknown = path.join(f.area, "keep.txt"); writeFileSync(unknown, "keep", { mode: 0o600 });
  await rejects(withRootedReadWriteScope(f.root, AREA, "shared", async () => {}),
    (e: unknown) => e instanceof RootedReadWriteScopeError && e.reason === "unsafe");
  equal(readFileSync(unknown, "utf8"), "keep");
});

test("a killed real reader process is retired exactly before the exclusive writer enters", { timeout: 15000 }, async (t) => {
  const f = await fixture(t);
  const child = spawn(process.execPath, [fileURLToPath(new URL("../../support/read-write-scope-holder.js", import.meta.url)), f.base], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const ready = Promise.withResolvers<void>();
  child.stdout.on("data", (data: Buffer) => { if (data.toString().includes("held")) ready.resolve(); });
  child.on("error", ready.reject);
  const exit = once(child, "exit");
  t.after(() => { child.kill("SIGKILL"); });
  await ready.promise;
  equal(readdirSync(f.area).filter((name) => name.startsWith("reader-")).length, 1);
  let entered = false;
  const writer = withRootedReadWriteScope(f.root, AREA, "exclusive", async () => { entered = true; });
  try {
    await until(() => existsSync(path.join(f.area, "writer.lock")));
    equal(entered, false);
    child.kill("SIGKILL"); await exit;
    await writer;
    equal(entered, true);
    deepEqual(readdirSync(f.area), []);
  } finally { child.kill("SIGKILL"); await Promise.allSettled([exit, writer]); }
});

test("a live contender's in-flight create stage is skipped, never retired; a dead one is retired on the next admission (§13.161 F1)", async (t) => {
  const f = await fixture(t);
  const address = issueDurableAtomicFileStageAddress("create", `${AREA}/latch.lock`, `sha256:${"0".repeat(64)}`, 0o600);
  const stage = path.join(f.area, address.fileName);
  writeFileSync(stage, "", { mode: 0o600 });
  let entered = false;
  await withRootedReadWriteScope(f.root, AREA, "exclusive", async () => { entered = true; });
  equal(entered, true);
  equal(existsSync(stage), true, "an active stage must survive admission");
  releaseDurableAtomicFileStageAddress(address);
  await withRootedReadWriteScope(f.root, AREA, "shared", async () => {});
  equal(existsSync(stage), false, "a dead writer's stage is retired");
});

test("shared admission retires dead reader leases once they pile up, so shared-only workloads never hit the entry limit (§13.161 F4)", { timeout: 30000 }, async (t) => {
  const f = await fixture(t);
  for (let index = 0; index < 64; index += 1) {
    const suffix = index.toString(16).padStart(12, "0");
    const bytes = rootedExclusiveFileLockRecordTextForTest({ tokenUuid: `44444444-4444-4444-8444-${suffix}` });
    writeFileSync(path.join(f.area, `reader-44444444-4444-4444-8444-${suffix}.lock`), bytes, { mode: 0o600 });
  }
  let entered = false;
  await withRootedReadWriteScope(f.root, AREA, "shared", async () => {
    entered = true;
    equal(readdirSync(f.area).filter((name) => name.startsWith("reader-")).length, 1, "only the live reader remains");
  });
  equal(entered, true);
  deepEqual(readdirSync(f.area), []);
});
