import { equal } from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import {
  observeWorktreeCheckout,
  type PodWorktreeReceipt,
} from "../../src/kernel/pod-worktree-receipts.js";
import { useDisposableDurability } from "../support/disposable-durability.js";

useDisposableDurability();

function receiptAt(checkout: string): Readonly<PodWorktreeReceipt> {
  return { path: checkout } as unknown as Readonly<PodWorktreeReceipt>;
}

function fixture(t: TestContext): string {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-checkout-observation-")));
  t.after(() => {
    chmodSync(path.join(base, "sealed"), 0o700);
    rmSync(base, { recursive: true, force: true });
  });
  return base;
}

test("检出观察三态（G7）：在且带 .git 指针为 present，目录或指针不在为 absent，无法观察为 unknown", async (t) => {
  const base = fixture(t);
  const checkout = path.join(base, "checkout");
  mkdirSync(checkout);
  writeFileSync(path.join(checkout, ".git"), "gitdir: ../main/.git/worktrees/checkout\n");
  equal(await observeWorktreeCheckout(receiptAt(checkout)), "present");
  equal(await observeWorktreeCheckout(receiptAt(path.join(base, "missing"))), "absent");
  mkdirSync(path.join(base, "no-pointer"));
  equal(await observeWorktreeCheckout(receiptAt(path.join(base, "no-pointer"))), "absent");
  mkdirSync(path.join(base, "dir-pointer", ".git"), { recursive: true });
  equal(await observeWorktreeCheckout(receiptAt(path.join(base, "dir-pointer"))), "absent");
  equal(await observeWorktreeCheckout(receiptAt("relative/not-absolute")), "absent");
  mkdirSync(path.join(base, "sealed", "checkout"), { recursive: true });
  writeFileSync(path.join(base, "sealed", "checkout", ".git"), "gitdir: x\n");
  chmodSync(path.join(base, "sealed"), 0o000);
  if (typeof process.getuid === "function" && process.getuid() === 0) return;
  equal(await observeWorktreeCheckout(receiptAt(path.join(base, "sealed", "checkout"))), "unknown");
});
