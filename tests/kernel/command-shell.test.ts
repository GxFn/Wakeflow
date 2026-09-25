import { deepEqual, equal, rejects } from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import type { RootedDirectory } from "../../src/foundation/filesystem/rooted-directory.js";
import { runCommandShell } from "../../src/kernel/command-shell.js";
import { isWakeflowError } from "../../src/kernel/error.js";

/**
 * 三种调用形状共用的外壳：请求解析、去根摘要与隐私、根、上下文、结果脱敏、关闭。
 * 用一个假切片规格验证每一步的结局，不触碰任何领域代码。
 */

function fixture(t: TestContext): string {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-shell-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

interface Envelope {
  readonly root: string;
  readonly note: string;
}

interface Context {
  readonly workspaceRoot: RootedDirectory;
  closed: boolean;
}

function spec(trace: string[]) {
  return {
    tool: "wakeflow_shell_test",
    parseRequest: (value: unknown) => {
      const record = value as { root: string; note: string };
      trace.push("parse");
      return { envelope: { root: record.root, note: record.note }, input: record.note };
    },
    open: async (workspaceRoot: RootedDirectory, _envelope: Envelope): Promise<Context> => {
      trace.push("open");
      return { workspaceRoot, closed: false };
    },
    close: async (context: Context) => {
      trace.push("close");
      context.closed = true;
    },
    privateValues: () => ["secret-handle-9"],
  };
}

test("command shell 依次解析、准入、打开、执行、脱敏并关闭", async (t) => {
  const root = fixture(t);
  const trace: string[] = [];
  const result = await runCommandShell<
    Envelope,
    string,
    Context,
    { echoed: string; digest: string }
  >(
    spec(trace),
    { root, note: "hello" },
    (binding) => {
      trace.push("admit");
      deepEqual(binding.payload, { note: "hello" });
      equal(binding.envelope.root, root);
    },
    async (context, binding) => {
      trace.push("body");
      equal(context.closed, false);
      equal(binding.workspaceRoot.absolutePath, root);
      return { echoed: binding.input, digest: binding.requestDigest };
    },
  );
  equal(result.echoed, "hello");
  equal(result.digest.startsWith("sha256:"), true);
  deepEqual(trace, ["parse", "admit", "open", "body", "close"]);
});

test("command shell 在边界拒绝私有路径、私有句柄、无效根，并把陌生异常收敛为 unexpected", async (t) => {
  const root = fixture(t);
  const trace: string[] = [];
  const noop = () => {};
  await rejects(
    runCommandShell<Envelope, string, Context, unknown>(
      spec(trace),
      { root, note: `${root}/x` },
      noop,
      async () => ({}),
    ),
    (error: unknown) => isWakeflowError(error) && error.code === "privacy-violation",
  );
  equal(trace.includes("open"), false, "private request must not open a context");
  await rejects(
    runCommandShell<Envelope, string, Context, unknown>(
      spec(trace),
      { root, note: "leak" },
      noop,
      async () => ({ handle: "secret-handle-9" }),
    ),
    (error: unknown) => isWakeflowError(error) && error.code === "output-boundary",
  );
  equal(trace.at(-1), "close", "context is closed even when the result is rejected");
  await rejects(
    runCommandShell<Envelope, string, Context, unknown>(
      spec(trace),
      { root: path.join(root, "missing"), note: "x" },
      noop,
      async () => ({}),
    ),
    (error: unknown) => isWakeflowError(error) && error.code === "root-invalid",
  );
  await rejects(
    runCommandShell<Envelope, string, Context, unknown>(
      spec(trace),
      { root, note: "boom" },
      noop,
      async () => {
        throw new Error(`${root}/private message`);
      },
    ),
    (error: unknown) =>
      isWakeflowError(error) && error.code === "unexpected" && !error.message.includes(root),
  );
  await rejects(
    runCommandShell<Envelope, string, Context, unknown>(
      spec(trace),
      "not-json-object",
      noop,
      async () => ({}),
    ),
    (error: unknown) => isWakeflowError(error) && error.code === "invalid-request",
  );
});

/**
 * 持久化级别是注入值，不是线上字段。这两条回归各盯一半：外壳按注入值打开工作区根，
 * 缺省就是生产的 `fsync`；请求里哪怕出现同名字段也不改变级别，公共 Schema 里也没有它。
 */
test("持久化级别只由注入的执行选项决定，缺省是 fsync，请求里的同名字段不起作用", async (t) => {
  const root = fixture(t);
  const trace: string[] = [];
  const levels: string[] = [];
  const observe = {
    ...spec(trace),
    open: async (workspaceRoot: RootedDirectory): Promise<Context> => {
      levels.push(workspaceRoot.durability);
      return { workspaceRoot, closed: false };
    },
  };
  const body = async () => ({});
  await runCommandShell<Envelope, string, Context, unknown>(
    observe,
    { root, note: "a" },
    () => {},
    body,
  );
  await runCommandShell<Envelope, string, Context, unknown>(
    observe,
    { root, note: "b", durability: "none" },
    () => {},
    body,
  );
  await runCommandShell<Envelope, string, Context, unknown>(
    observe,
    { root, note: "c" },
    () => {},
    body,
    { durability: "none" },
  );
  deepEqual(levels, ["fsync", "fsync", "none"]);
});

test("请求隐私扫描可按字段路径豁免（§13.128）：豁免字段里的根路径放行，别处的仍拒绝", async (t) => {
  const root = fixture(t);
  const run = (exempt: readonly string[], payload: Record<string, unknown>) =>
    runCommandShell<Envelope, string, Context, { ok: true }>(
      { ...spec([]), requestPrivacyExemptPaths: exempt },
      { root, note: "n", ...payload },
      () => {},
      async () => ({ ok: true as const }),
      { durability: "none" },
    );
  const leaking = { observation: { worktree: { porcelain: `worktree ${root}/x\nHEAD 0\n` } } };
  deepEqual(await run(["observation.worktree"], leaking), { ok: true });
  await rejects(
    run([], leaking),
    (error: unknown) => isWakeflowError(error) && error.code === "privacy-violation",
  );
  // 豁免只盖住那一个字段：同一路径之外的根路径照样拒绝。
  await rejects(
    run(["observation.worktree"], { ...leaking, note2: `${root}/elsewhere` }),
    (error: unknown) => isWakeflowError(error) && error.code === "privacy-violation",
  );
});
