import { equal, ok, rejects } from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { createLab, disposeLab } from "../../../tooling/lab/lab.js";
import { loadSensitive } from "../../support/load-sensitive.js";
import { fixture } from "./workflow-matrix.fixture.js";

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
  if (loadSensitive(t, "lab CLI with real product sessions against a built artifact")) return;
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
  if (loadSensitive(t, "lab CLI with real product sessions against a built artifact")) return;
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
  if (loadSensitive(t, "lab CLI with real product sessions against a built artifact")) return;
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
