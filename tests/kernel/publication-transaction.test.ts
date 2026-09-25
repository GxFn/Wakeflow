import { deepEqual, equal, rejects } from "node:assert/strict";
import { mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import type { Sha256Digest } from "../../src/foundation/crypto/sha256.js";
import type { RootedDirectory } from "../../src/foundation/filesystem/rooted-directory.js";
import { isWakeflowError } from "../../src/kernel/error.js";
import {
  runPublicationTransaction,
  type PublicationTransactionEnvelope,
  type PublicationTransactionPhase,
} from "../../src/kernel/publication-transaction.js";

function fixture(t: TestContext): string {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-effect-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

const READY_DIGEST = `sha256:${"a".repeat(64)}` as Sha256Digest;

interface Context {
  readonly workspaceRoot: RootedDirectory;
}

type Plan = { readonly steps: readonly string[] };
type Outcome = { readonly status: string; readonly operationId: string | null };

function spec(trace: string[], planStatus: "ready" | "blocked" = "ready") {
  return {
    tool: "wakeflow_effect_test",
    parseRequest: (value: unknown) => {
      const record = value as {
        root: string;
        mode: PublicationTransactionEnvelope["mode"];
        planDigest?: Sha256Digest;
        operationId?: string;
      };
      return {
        envelope: {
          root: record.root,
          mode: record.mode,
          planDigest: record.planDigest ?? null,
          operationId: record.operationId ?? null,
        },
        input: "selection",
      };
    },
    open: async (workspaceRoot: RootedDirectory): Promise<Context> => ({ workspaceRoot }),
    close: async () => {
      trace.push("close");
    },
    plan: async () => {
      trace.push("plan");
      return planStatus === "ready"
        ? {
            status: "ready" as const,
            blockers: [],
            plan: { steps: ["a", "b"] },
            digest: READY_DIGEST,
          }
        : { status: "blocked" as const, blockers: ["not-a-workspace"], plan: null, digest: null };
    },
    apply: async (_context: Context, _input: string, plan: Plan): Promise<Outcome> => {
      trace.push(`apply:${plan.steps.join("")}`);
      return { status: "completed", operationId: "op-1" };
    },
    recover: async (_context: Context, operationId: string): Promise<Outcome> => {
      trace.push(`recover:${operationId}`);
      return { status: "recovered", operationId };
    },
    result: (
      envelope: PublicationTransactionEnvelope,
      _input: string,
      phase: PublicationTransactionPhase<Plan, Outcome>,
      next: unknown,
    ) => ({
      mode: envelope.mode,
      status: phase.mode === "preview" ? phase.planned.status : phase.outcome.status,
      planDigest: phase.mode === "preview" ? phase.planned.digest : envelope.planDigest,
      next,
    }),
  };
}

test("publication transaction：preview 零写出摘要，apply 重算比对，recover 只凭操作标识", async (t) => {
  const root = fixture(t);
  const trace: string[] = [];
  const preview = await runPublicationTransaction(spec(trace), { root, mode: "preview" });
  deepEqual(preview, {
    mode: "preview",
    status: "ready",
    planDigest: READY_DIGEST,
    next: { frontier: null, owner: "none", suggestedTool: null, blockers: [] },
  });
  deepEqual(trace, ["plan", "close"]);
  deepEqual(readdirSync(root), [], "preview 不在根下留下任何文件");

  const applied = await runPublicationTransaction(spec(trace), {
    root,
    mode: "apply",
    planDigest: READY_DIGEST,
  });
  equal(applied.status, "completed");
  deepEqual(trace.slice(2), ["plan", "apply:ab", "close"]);

  const recovered = await runPublicationTransaction(spec(trace), {
    root,
    mode: "recover",
    operationId: "op-1",
  });
  equal(recovered.status, "recovered");
  deepEqual(trace.slice(5), ["recover:op-1", "close"]);
});

test("publication transaction 拒绝摘要漂移、阻塞计划与不匹配模式的信封", async (t) => {
  const root = fixture(t);
  const trace: string[] = [];
  await rejects(
    runPublicationTransaction(spec(trace), {
      root,
      mode: "apply",
      planDigest: `sha256:${"b".repeat(64)}`,
    }),
    (error: unknown) =>
      isWakeflowError(error) &&
      error.code === "precondition-failed" &&
      error.reason === "plan-drift" &&
      error.path === "$request.planDigest",
  );
  equal(trace.includes("apply:ab"), false);
  await rejects(
    runPublicationTransaction(spec(trace, "blocked"), {
      root,
      mode: "apply",
      planDigest: READY_DIGEST,
    }),
    (error: unknown) =>
      isWakeflowError(error) &&
      error.code === "precondition-failed" &&
      error.reason === "plan-blocked",
  );
  const blockedPreview = await runPublicationTransaction(spec(trace, "blocked"), {
    root,
    mode: "preview",
  });
  equal(blockedPreview.status, "blocked");
  equal(blockedPreview.planDigest, null);
  for (const [request, reason] of [
    [{ root, mode: "apply" }, "plan-digest-required"],
    [{ root, mode: "preview", planDigest: READY_DIGEST }, "plan-digest-unexpected"],
    [{ root, mode: "recover" }, "operation-id-required"],
    [{ root, mode: "preview", operationId: "op-1" }, "operation-id-unexpected"],
  ] as const) {
    await rejects(
      runPublicationTransaction(spec(trace), request),
      (error: unknown) =>
        isWakeflowError(error) && error.code === "invalid-request" && error.reason === reason,
    );
  }
});
