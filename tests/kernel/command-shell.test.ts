import { deepEqual, equal, rejects } from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

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
