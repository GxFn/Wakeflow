import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { equal, ok, rejects } from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { runToolingCli } from "../../../tooling/cli.js";
import { disposeLab, inspectLab } from "../../../tooling/lab/lab.js";
import { BUSINESS_SCENARIOS } from "../../../tooling/lab/workflow-context.js";
import { loadSensitive } from "../../support/load-sensitive.js";

/**
 * lab 的宿主 × 业务场景矩阵（§13.169 批次 5，open-items D9）：每个宿主一个测试文件，让 LPT 调度把两个宿主放到
 * 不同的 worker 上跑，而不是一个 786 秒的文件占住关键路径。矩阵正文在这里，`workflow-codex.test.ts` 与
 * `workflow-claude-code.test.ts` 各注册一份；其余 lab 行为测试仍在 `workflow.test.ts`。
 */

export function fixture(t: TestContext) {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-workflow-lab-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repository = path.join(base, "Reports");
  mkdirSync(repository);
  return {
    base,
    repository,
    root: path.join(base, "Lab"),
    candidate: path.join(process.cwd(), "plugins/codex-wakeflow"),
  };
}

export function registerWorkflowMatrix(host: "codex" | "claude-code"): void {
  for (const scenario of BUSINESS_SCENARIOS) {
    test(`fresh ${host} ${scenario} experiment executes products, archives evidence, then seals cleanup ownership`, {
      timeout: 240_000,
    }, async (t) => {
      if (loadSensitive(t, "lab CLI with real product sessions against a built artifact")) return;
      const { repository, root } = fixture(t);
      const result = await runToolingCli(
        [
          "lab",
          "run",
          "--scenario",
          scenario,
          "--dir",
          root,
          "--candidate",
          path.join(process.cwd(), `plugins/${host}-wakeflow`),
        ],
        repository,
      );
      ok("receipt" in result && typeof result.receipt === "string");
      const receipt = JSON.parse(readFileSync(path.join(repository, result.receipt), "utf8"));
      equal(
        result.status,
        "passed",
        JSON.stringify({ reason: receipt.reason, last: receipt.observations.slice(-2) }),
      );
      equal(receipt.business.scenario, scenario);
      equal(receipt.business.implementations, scenario === "single-product" ? 1 : 2);
      equal(receipt.business.independentTest, scenario !== "single-product");
      equal(receipt.business.nativeHostAcceptance, "unverified");
      equal(receipt.business.hostObservations, "synthetic-generated-hooks");
      ok(receipt.business.acts.includes("archive-recovery-idempotent"));
      const archiveRoot = path.join(root, "ledger", receipt.business.archive.archiveRef);
      ok(existsSync(path.join(archiveRoot, "manifest.json")));
      equal(existsSync(path.join(root, "Beta")), scenario !== "single-product");
      if (scenario === "worktree") {
        equal(existsSync(path.join(root, "Worktree-Alpha")), false);
        equal(existsSync(path.join(root, "Worktree-Beta")), false);
        ok(receipt.business.acts.includes("pod-two-stage-close"));
        ok(receipt.business.acts.includes("test-worktree-attachments-verified"));
        equal(existsSync(path.join(root, "Alpha/summarize.mjs")), false);
      } else {
        const observed = JSON.parse(
          readFileSync(path.join(root, "Alpha/verification.json"), "utf8"),
        );
        equal(observed.total, 6);
        equal(observed.count, 3);
      }
      equal(inspectLab(repository, receipt.id).status, "passed");
      const preview = await disposeLab(repository, receipt.id);
      ok("planDigest" in preview);
      writeFileSync(path.join(root, "user-note.txt"), "preserve");
      await rejects(disposeLab(repository, receipt.id, preview.planDigest), /lab-resource-drift/);
      equal(readFileSync(path.join(root, "user-note.txt"), "utf8"), "preserve");
      rmSync(path.join(root, "user-note.txt"));
      equal((await disposeLab(repository, receipt.id, preview.planDigest)).status, "passed");
      equal(existsSync(root), false);
      ok(existsSync(path.join(repository, result.receipt)));
    });
  }
}
