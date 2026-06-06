#!/usr/bin/env node

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runControlRuntime } from "../lib/control-runtime.mjs";

const root = mkdtempSync(path.join(tmpdir(), "wakeflow-smoke-"));

const init = await runControlRuntime({
  script: "controller-state",
  args: [
    "init",
    "--root", root,
    "--demand-key", "smoke",
    "--title", "Smoke",
    "--goal", "Check Wakeflow full controller runtime.",
    "--completion-definition", "Review reaches review-ready after a target result.",
    "--stage-plan", "Initialize, add a task package, prepare delivery, import result, reduce review.",
    "--write",
    "--json",
  ],
});
assertOk(init, "controller-state init");
const stateRoot = init.parsedJson?.stateRoot;
if (!stateRoot) throw new Error("controller-state init did not return a stateRoot");

assertOk(await runControlRuntime({
  script: "controller-state",
  args: [
    "add-task-package",
    "--root", root,
    "--state-root", stateRoot,
    "--task-package-id", "SMOKE-P1",
    "--summary", "Check full delivery intent generation.",
    "--target-window", "Target",
    "--target-task-id", "SMOKE-T1",
    "--target-summary", "Return smoke evidence.",
    "--write",
    "--json",
  ],
}), "controller-state add-task-package");

const delivery = await runControlRuntime({
  script: "codex-automation-loop",
  args: [
    "prepare-dispatch-from-state",
    "--root", root,
    "--state-root", stateRoot,
    "--target-task-id", "SMOKE-T1",
    "--group", "SMOKE-G1",
    "--write",
    "--json",
  ],
});
assertOk(delivery, "codex-automation-loop prepare-dispatch-from-state");
if (!delivery.parsedJson?.envelope?.prompt?.includes("SMOKE-T1")) {
  throw new Error("delivery envelope prompt did not include the target task id");
}

assertOk(await runControlRuntime({
  script: "controller-state",
  args: [
    "import-target-result",
    "--root", root,
    "--state-root", stateRoot,
    "--target-task-id", "SMOKE-T1",
    "--target-window", "Target",
    "--status", "completed",
    "--summary", "Smoke result.",
    "--evidence-ref", "smoke:evidence",
    "--write",
    "--json",
  ],
}), "controller-state import-target-result");

const reviewed = await runControlRuntime({
  script: "controller-state",
  args: ["reduce-results", "--root", root, "--state-root", stateRoot, "--write", "--json"],
});
assertOk(reviewed, "controller-state reduce-results");
if (reviewed.parsedJson?.nextState !== "review-ready" && reviewed.parsedJson?.review?.status !== "ready") {
  throw new Error("review reduction did not reach review-ready");
}

const controlStatus = await runControlRuntime({
  script: "workspace-control",
  args: ["--print", "status"],
  timeoutMs: 30000,
});
if (!controlStatus.ok || !controlStatus.stdout.includes("collect-repo-status.mjs")) {
  throw new Error("embedded runtime did not print status route");
}

console.log(JSON.stringify({ ok: true, root, stateRoot, controlRuntime: "ok" }, null, 2));

function assertOk(result, label) {
  if (!result.ok) {
    throw new Error(`${label} failed: ${result.stderr || result.stdout}`);
  }
}
