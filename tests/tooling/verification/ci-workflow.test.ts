import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseDocument } from "yaml";
import { modelTestOptions } from "../../../tooling/testing/model-options.js";

function object(value: unknown): Record<string, unknown> {
  ok(typeof value === "object" && value !== null && !Array.isArray(value));
  return value as Record<string, unknown>;
}

test("CI retains separate platform/profile results, pins actions and uploads only sanitized report files", () => {
  const yaml = readFileSync(".github/workflows/verify.yml", "utf8");
  const document = parseDocument(yaml, { uniqueKeys: true });
  deepEqual(document.errors, []);
  const workflow = object(document.toJSON());
  deepEqual(workflow.permissions, { contents: "read" });
  deepEqual(Object.keys(object(workflow.on)).sort(), ["pull_request", "push", "workflow_dispatch"]);
  const job = object(object(workflow.jobs).verify);
  const strategy = object(job.strategy);
  equal(strategy["fail-fast"], false);
  deepEqual(object(strategy.matrix).profile, ["gate", "artifact"]);
  deepEqual(object(strategy.matrix).os, ["ubuntu-24.04", "macos-15"]);
  ok(Array.isArray(job.steps));
  const steps = job.steps.map(object);
  for (const step of steps.filter((step) => step.uses !== undefined))
    ok(/^actions\/[a-z-]+@[a-f0-9]{40}$/u.test(String(step.uses)));
  const checkout = steps.find((step) => String(step.uses).startsWith("actions/checkout@"));
  equal(object(checkout?.with)["persist-credentials"], false);
  const upload = steps.find((step) => String(step.uses).startsWith("actions/upload-artifact@"));
  // 上传的只有脱敏报告与模型反例（§13.169：模型名、seed、numRuns、fast-check path 与缩减反例，无环境或路径）。
  deepEqual(String(object(upload?.with).path).trim().split("\n"), [
    ".build/ci/report-*/report.json",
    ".build/ci/report-*/manifest.json",
    ".build/model/*.json",
  ]);
  equal(object(upload?.with)["if-no-files-found"], "error");
  const run = steps.map((step) => step.run ?? "").join("\n");
  ok(run.includes('wf -- verify "$WAKEFLOW_PROFILE"'));
  ok(run.includes("wf -- ci export --summary .build/ci-private/summary.json"));
  equal(/(?:live attempt|create_thread|release:check|npm publish|install:check)/u.test(run), false);
  // 模型种子按运行号轮换，反例因此可回放；本地默认种子不受影响。
  const verifyStep = steps.find((step) =>
    String(step.run ?? "").includes('wf -- verify "$WAKEFLOW_PROFILE"'),
  );
  equal(object(verifyStep?.env).WAKEFLOW_MODEL_SEED, "${{ github.run_number }}");
  equal(object(verifyStep?.env).WAKEFLOW_TEST_CONCURRENCY, "2");

  // handoff 作业：完整历史检出、同样钉死的 action、只跑只读交接检查。
  const handoff = object(object(workflow.jobs).handoff);
  ok(Array.isArray(handoff.steps));
  const handoffSteps = handoff.steps.map(object);
  for (const step of handoffSteps.filter((step) => step.uses !== undefined))
    ok(/^actions\/[a-z-]+@[a-f0-9]{40}$/u.test(String(step.uses)));
  const handoffCheckout = handoffSteps.find((step) =>
    String(step.uses).startsWith("actions/checkout@"),
  );
  equal(object(handoffCheckout?.with)["persist-credentials"], false);
  equal(object(handoffCheckout?.with)["fetch-depth"], 0);
  const handoffRun = handoffSteps.map((step) => step.run ?? "").join("\n");
  ok(handoffRun.includes("wf -- handoff"));
  equal(
    /(?:live attempt|create_thread|release:check|npm publish|install:check)/u.test(handoffRun),
    false,
  );
});

test("model options are bounded, reproducible and reject malformed replay requests", () => {
  deepEqual(modelTestOptions({}), { seed: 20261003, numRuns: 200 });
  equal(modelTestOptions({ WAKEFLOW_MODEL_REPLAY_PATH: "A+/:/" }).replayPath, "A+/:/");
  deepEqual(
    modelTestOptions({
      WAKEFLOW_MODEL_SEED: "-123",
      WAKEFLOW_MODEL_RUNS: "10",
      WAKEFLOW_MODEL_PATH: "12:0:3",
      WAKEFLOW_MODEL_REPLAY_PATH: "AAAAABAAE:VF",
    }),
    { seed: -123, numRuns: 10, path: "12:0:3", replayPath: "AAAAABAAE:VF" },
  );
  for (const input of [
    { WAKEFLOW_MODEL_SEED: "NaN" },
    { WAKEFLOW_MODEL_SEED: "2147483648" },
    { WAKEFLOW_MODEL_RUNS: "0" },
    { WAKEFLOW_MODEL_RUNS: "1001" },
    { WAKEFLOW_MODEL_PATH: "../private" },
    { WAKEFLOW_MODEL_REPLAY_PATH: "\nextra" },
  ])
    throws(() => modelTestOptions(input));
});
