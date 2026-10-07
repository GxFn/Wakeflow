import { equal, ok, rejects } from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { runToolingCli } from "../../../tooling/cli.js";
import { createLab, disposeLab, inspectLab } from "../../../tooling/lab/lab.js";
import { BUSINESS_SCENARIOS } from "../../../tooling/lab/workflow-context.js";

function fixture(t: TestContext) {
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

for (const host of ["codex", "claude-code"]) {
  for (const scenario of BUSINESS_SCENARIOS) {
    test(`fresh ${host} ${scenario} experiment executes products, archives evidence, then seals cleanup ownership`, {
      timeout: 240_000,
    }, async (t) => {
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

function intercept(t: TestContext, observe: (args: Parameters<Client["callTool"]>[0]) => void) {
  const original = Client.prototype.callTool;
  t.mock.method(
    Client.prototype,
    "callTool",
    async function (this: Client, ...args: Parameters<Client["callTool"]>) {
      const result = await Reflect.apply(original, this, args);
      observe(args[0]);
      return result;
    },
  );
}

test("a cancelled mutating experiment retains evidence and never authorizes inventory disposal or resume", {
  timeout: 90_000,
}, async (t) => {
  const { repository, root, candidate } = fixture(t);
  const controller = new AbortController();
  intercept(t, (request) => {
    if (request.name === "wakeflow_publish_requirement" && request.arguments?.mode === "apply")
      controller.abort();
  });
  const result = await createLab(repository, root, candidate, controller.signal, "single-product");
  equal(result.status, "interrupted");
  equal(existsSync(root), true);
  const receipt = JSON.parse(readFileSync(path.join(repository, result.receipt), "utf8"));
  equal(receipt.cleanup, "retained-for-manual-inspection");
  const directory = path.dirname(path.join(repository, result.receipt));
  equal(existsSync(path.join(directory, "resources.json")), false);
  equal(existsSync(path.join(directory, "operation.lock")), false);
  await rejects(disposeLab(repository, result.id));
  await rejects(
    createLab(repository, root, candidate, undefined, "single-product"),
    /lab-root-already-exists/,
  );
});

test("changed product bytes prevent fixture acceptance even when import returned success", {
  timeout: 120_000,
}, async (t) => {
  const { repository, root, candidate } = fixture(t);
  intercept(t, (request) => {
    if (request.name === "wakeflow_import_target_result")
      writeFileSync(
        path.join(root, "Alpha/summarize.mjs"),
        "export const summarize = () => ({count: 0, total: 0});\n",
      );
  });
  const result = await createLab(repository, root, candidate, undefined, "single-product");
  equal(result.status, "failed");
  equal(result.reason, "lab-product-bytes-changed");
  const receipt = JSON.parse(readFileSync(path.join(repository, result.receipt), "utf8"));
  equal(
    receipt.observations.some(
      (entry: { tool: string }) => entry.tool === "wakeflow_record_implementation_review_decision",
    ),
    false,
  );
  equal(
    existsSync(path.join(path.dirname(path.join(repository, result.receipt)), "resources.json")),
    false,
  );
});

test("worktree cleanup refuses a newly introduced file and preserves the checkout", {
  timeout: 240_000,
}, async (t) => {
  const { repository, root, candidate } = fixture(t);
  let injected = false;
  intercept(t, (request) => {
    const intent = request.arguments?.intent as { kind?: string } | undefined;
    if (
      !injected &&
      request.name === "wakeflow_pod" &&
      request.arguments?.mode === "apply" &&
      intent?.kind === "close"
    ) {
      writeFileSync(path.join(root, "Worktree-Alpha/user-note.txt"), "preserve unknown work");
      injected = true;
    }
  });
  const result = await createLab(repository, root, candidate, undefined, "worktree");
  equal(injected, true);
  equal(result.status, "failed");
  equal(result.reason, "lab-worktree-unknown-resource");
  equal(
    readFileSync(path.join(root, "Worktree-Alpha/user-note.txt"), "utf8"),
    "preserve unknown work",
  );
  ok(existsSync(path.join(root, "Worktree-Alpha/.git")));
  await rejects(disposeLab(repository, result.id));
});

test("business CLI refuses unknown scenarios and mixing existing IDs with fresh roots before writing", async (t) => {
  const { repository, root, candidate } = fixture(t);
  for (const args of [
    ["lab", "run", "--scenario", "unknown", "--dir", root, "--candidate", candidate],
    [
      "lab",
      "run",
      "--scenario",
      "single-product",
      "--id",
      "lab-existing",
      "--dir",
      root,
      "--candidate",
      candidate,
    ],
    ["lab", "run", "--scenario", "single-product", "--candidate", candidate],
  ])
    await rejects(runToolingCli(args, repository));
  equal(existsSync(root), false);
  equal(existsSync(path.join(repository, ".build")), false);
});
