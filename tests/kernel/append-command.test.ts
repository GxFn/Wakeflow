import { deepEqual, equal, rejects } from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import type { RootedDirectory } from "../../src/foundation/filesystem/rooted-directory.js";
import {
  runAppendCommand,
  type AppendCommandBinding,
  type AppendCommandEnvelope,
} from "../../src/kernel/append-command.js";
import { isWakeflowError } from "../../src/kernel/error.js";
import { deriveDemandCommitId } from "../../src/kernel/ids.js";

function fixture(t: TestContext): string {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-append-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

interface Context {
  readonly workspaceRoot: RootedDirectory;
}

function spec(seen: AppendCommandBinding[]) {
  return {
    tool: "wakeflow_append_test",
    parseRequest: (value: unknown) => {
      const record = value as AppendCommandEnvelope & { readonly body: string };
      return {
        envelope: {
          root: record.root,
          demandId: record.demandId,
          idempotencyKey: record.idempotencyKey,
          expectedStreamRevision: record.expectedStreamRevision,
        },
        input: record.body,
      };
    },
    open: async (workspaceRoot: RootedDirectory): Promise<Context> => ({ workspaceRoot }),
    close: async () => {},
    execute: async (_context: Context, input: string, binding: AppendCommandBinding) => {
      seen.push(binding);
      return { appended: input };
    },
    next: async () => ({
      frontier: "next-step",
      owner: "controller" as const,
      suggestedTool: "wakeflow_next",
      blockers: [],
    }),
    result: (envelope: AppendCommandEnvelope, outcome: { appended: string }, next: unknown) => ({
      demandId: envelope.demandId,
      appended: outcome.appended,
      next,
    }),
  };
}

test("append command 由幂等键派生 commitId 并把 next 交给结果", async (t) => {
  const root = fixture(t);
  const seen: AppendCommandBinding[] = [];
  const request = {
    root,
    demandId: "demand-1",
    idempotencyKey: "append-1",
    expectedStreamRevision: 3,
    body: "record",
  };
  const result = await runAppendCommand(spec(seen), request);
  deepEqual(result, {
    demandId: "demand-1",
    appended: "record",
    next: {
      frontier: "next-step",
      owner: "controller",
      suggestedTool: "wakeflow_next",
      blockers: [],
    },
  });
  equal(seen.length, 1);
  equal(seen[0]?.commitId, deriveDemandCommitId("demand-1", "append-1"));
  equal(seen[0]?.expectedStreamRevision, 3);
  equal(seen[0]?.idempotencyKey, "append-1");
  // 同一请求再来一次得到同一 commitId；根不同不影响摘要与身份。
  await runAppendCommand(spec(seen), request);
  equal(seen[1]?.commitId, seen[0]?.commitId);
  equal(seen[1]?.requestDigest, seen[0]?.requestDigest);
});

test("append command 在打开根之前拒绝非法幂等键与修订", async (t) => {
  const root = fixture(t);
  const seen: AppendCommandBinding[] = [];
  for (const [patch, path] of [
    [{ idempotencyKey: "bad key" }, "$request.idempotencyKey"],
    [{ expectedStreamRevision: -1 }, "$request.expectedStreamRevision"],
    [{ expectedStreamRevision: 1.5 }, "$request.expectedStreamRevision"],
  ] as const) {
    await rejects(
      runAppendCommand(spec(seen), {
        root,
        demandId: "demand-1",
        idempotencyKey: "ok-1",
        expectedStreamRevision: 0,
        body: "x",
        ...patch,
      }),
      (error: unknown) =>
        isWakeflowError(error) && error.code === "invalid-request" && error.path === path,
    );
  }
  equal(seen.length, 0);
});
