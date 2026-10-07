import { deepEqual, equal, ok, rejects, throws } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { runToolingCli } from "../../../tooling/cli.js";
import { proposeTestDurations } from "../../../tooling/testing/test-duration-report.js";
import { exportCiVerification, verifyCiBundle } from "../../../tooling/verification/export-ci.js";
import { sha256 } from "../../../tooling/verification/files.js";
import { captureVerificationInput } from "../../../tooling/verification/input-identity.js";
import { runLoggedCommand } from "../../../tooling/verification/process.js";
import { verifyRepository } from "../../../tooling/verification/verify.js";

const RUNNER = fileURLToPath(
  new URL("../../../tooling/testing/run-typescript-tests.js", import.meta.url),
);

function fixture(t: TestContext, body = "test('ok',()=>{});", testScript = "node driver.mjs") {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-verification-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "tests"));
  mkdirSync(path.join(root, ".build/tests"), { recursive: true });
  writeFileSync(path.join(root, ".gitignore"), ".build/\n");
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "verification-fixture",
      version: "0.0.0",
      private: true,
      type: "module",
      scripts: {
        test: testScript,
        "build:check": "node noop.mjs",
        "smoke:artifacts": "node noop.mjs",
      },
    }),
  );
  writeFileSync(
    path.join(root, "driver.mjs"),
    `import {spawnSync} from 'node:child_process';const r=spawnSync(process.execPath,[${JSON.stringify(RUNNER)}],{stdio:'inherit',env:process.env});process.exitCode=r.status??1;\n`,
  );
  writeFileSync(path.join(root, "noop.mjs"), "// no effect\n");
  writeFileSync(path.join(root, "tracked.txt"), "initial\n");
  writeFileSync(path.join(root, "tests/case.test.ts"), "// declared fixture source\n");
  writeFileSync(
    path.join(root, ".build/tests/case.test.js"),
    `import {test} from 'node:test';import fs from 'node:fs';${body}\n`,
  );
  const git = (args: string[]) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    equal(result.status, 0, "Disposable Git fixture setup failed.");
  };
  git(["init", "--quiet"]);
  git(["add", "."]);
  git([
    "-c",
    "user.name=Wakeflow fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "-c",
    `core.hooksPath=${path.join(root, ".git/empty-hooks")}`,
    "commit",
    "-qm",
    "fixture",
  ]);
  return root;
}

test("verification records a real child test run with source identity and durable private logs", async (t) => {
  const root = fixture(t);
  const result = await verifyRepository(root, { profile: "gate", files: [], concurrency: "1" });
  equal(result.status, "passed");
  equal(result.exitCode, 0);
  equal(result.counts?.tests, 1);
  const receipt = JSON.parse(readFileSync(path.join(root, result.receipt), "utf8"));
  equal(receipt.status, "passed");
  equal(receipt.inputsUnchanged, true);
  equal(receipt.privacy, "private-local-evidence");
  deepEqual(receipt.tests.selectedFiles, ["tests/case.test.ts"]);
  equal(receipt.stages.length, 1);
  equal(existsSync(path.join(root, receipt.stages[0].stdout.path)), true);
  equal(receipt.stages[0].exitCode, 0);
  const summaryFile = path.join(root, ".build/summary.json");
  writeFileSync(summaryFile, JSON.stringify(result));
  receipt.privateToken = "synthetic-private-token-must-not-export";
  receipt.environment.HOME = root;
  const recordedEventsFile = path.join(root, path.dirname(result.receipt), "test-events.jsonl");
  const rows = readFileSync(recordedEventsFile, "utf8")
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
  for (const row of rows) if (row.counts !== undefined) row.counts[receipt.privateToken] = 1;
  writeFileSync(recordedEventsFile, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  receipt.testEvidence.events.digest = sha256(readFileSync(recordedEventsFile));
  receipt.tests.counts[receipt.privateToken] = 1;
  writeFileSync(path.join(root, result.receipt), JSON.stringify(receipt));
  const exported = exportCiVerification(root, summaryFile);
  const publicBytes = readFileSync(path.join(root, exported.directory, "report.json"), "utf8");
  equal(publicBytes.includes(root), false);
  equal(publicBytes.includes(receipt.privateToken), false);
  equal(JSON.parse(publicBytes).tests.counts.tests, 1);
  equal(JSON.parse(publicBytes).tests.files[0].file, "tests/case.test.ts");
  equal(
    JSON.parse(publicBytes).modelTests.seed,
    Number(process.env.WAKEFLOW_MODEL_SEED ?? "20261003"),
  );
  equal(verifyCiBundle(path.join(root, exported.directory)).integrity, "matched");
  writeFileSync(path.join(root, exported.directory, "report.json"), `${publicBytes}\n`);
  throws(() => verifyCiBundle(path.join(root, exported.directory)), /digest mismatch/u);
  writeFileSync(path.join(root, exported.directory, "report.json"), publicBytes);
  equal(JSON.parse(publicBytes).source, "unsigned-local-verification-receipt");
  receipt.stages[0].exitCode = 1;
  writeFileSync(path.join(root, result.receipt), JSON.stringify(receipt));
  throws(() => exportCiVerification(root, summaryFile), /Incomplete verification/u);
  receipt.status = "failed";
  writeFileSync(path.join(root, result.receipt), JSON.stringify(receipt));
  writeFileSync(summaryFile, JSON.stringify({ ...result, status: "failed" }));
  equal(exportCiVerification(root, summaryFile).verificationStatus, "failed");
  receipt.status = "passed";
  receipt.stages[0].exitCode = 0;
  writeFileSync(path.join(root, result.receipt), JSON.stringify(receipt));
  writeFileSync(summaryFile, JSON.stringify(result));
  const proposal = proposeTestDurations(root, path.join(root, result.receipt));
  deepEqual(Object.keys(proposal.durationsMs), ["tests/case.test.ts"]);
  equal(proposal.measurement.files, 1);
  const events = path.join(root, path.dirname(result.receipt), "test-events.jsonl");
  writeFileSync(events, `${readFileSync(events, "utf8")}\n`);
  throws(() => proposeTestDurations(root, path.join(root, result.receipt)), /digest changed/u);
  throws(() => exportCiVerification(root, summaryFile), /differs from its receipt/u);
});

test("an already cancelled verification never runs its command and still leaves an interrupted receipt", async (t) => {
  const root = fixture(
    t,
    "test('must not run',()=>{fs.writeFileSync('tracked.txt','unexpected')});",
  );
  const controller = new AbortController();
  controller.abort();
  const result = await verifyRepository(root, {
    profile: "gate",
    files: [],
    signal: controller.signal,
  });
  equal(result.status, "interrupted");
  equal(result.exitCode, 130);
  equal(readFileSync(path.join(root, "tracked.txt"), "utf8"), "initial\n");
  const receipt = JSON.parse(readFileSync(path.join(root, result.receipt), "utf8"));
  equal(receipt.status, "interrupted");
  equal(typeof receipt.finishedAt, "string");
  throws(() => proposeTestDurations(root, path.join(root, result.receipt)), /full-gate/u);
});

test("child failure, absent test evidence and changed source all prevent green receipts", async (t) => {
  for (const [name, body, script, status, reason] of [
    ["failed", "test('fail',()=>{throw Error('synthetic')});", "node driver.mjs", "failed", "exit"],
    ["missing-events", "", "node noop.mjs", "unavailable", "test-record-unavailable"],
    [
      "changed-input",
      "test('edit',()=>{fs.writeFileSync('tracked.txt','changed')});",
      "node driver.mjs",
      "unavailable",
      "verification-input-changed",
    ],
  ] as const) {
    await t.test(name, async (t) => {
      const root = fixture(t, body, script);
      const result = await verifyRepository(root, { profile: "gate", files: [], concurrency: "1" });
      equal(result.status, status);
      equal(result.reason, reason);
      equal(result.exitCode !== 0, true);
      const receipt = JSON.parse(readFileSync(path.join(root, result.receipt), "utf8"));
      equal(receipt.status, status);
      equal(typeof receipt.finishedAt, "string");
    });
  }
});

test("source identity includes untracked and deleted inputs, excludes build outputs and refuses symlink parents", (t) => {
  const root = fixture(t);
  const beforeWorkflow = captureVerificationInput(root);
  mkdirSync(path.join(root, ".github/workflows"), { recursive: true });
  writeFileSync(path.join(root, ".github/workflows/check.yml"), "name: fixture\n");
  ok(captureVerificationInput(root).digest !== beforeWorkflow.digest);
  const first = captureVerificationInput(root);
  writeFileSync(path.join(root, ".build/log.txt"), "not a source input");
  equal(captureVerificationInput(root).digest, first.digest);
  writeFileSync(path.join(root, "tests/new.test.ts"), "new input");
  equal(captureVerificationInput(root).digest === first.digest, false);
  rmSync(path.join(root, "tests/new.test.ts"));
  rmSync(path.join(root, "tracked.txt"));
  equal(captureVerificationInput(root).digest === first.digest, false);
  rmSync(path.join(root, "tests"), { recursive: true });
  symlinkSync(path.join(root, ".build/tests"), path.join(root, "tests"));
  throws(() => captureVerificationInput(root), /Unsafe input parent|Symlink/u);
});

test("CLI rejects scope-changing and ambiguous arguments before executing a command", async () => {
  for (const args of [
    ["verify", "gate", "--files", "tests/a.test.ts"],
    ["verify", "quick"],
    ["verify", "artifact", "--concurrency", "2"],
    ["doctor", "env", "--installed", "anywhere"],
    ["doctor", "artifact"],
    ["doctor", "artifact", "--candidate", "a", "--candidate", "b"],
    ["verify", "gate", "--unknown", "value"],
  ])
    await rejects(runToolingCli(args, process.cwd()), /Invalid command/u);
});

test("abort terminates the owned descendant even if it ignores SIGTERM", {
  timeout: 15_000,
}, async (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX process-group scenario.");
    return;
  }
  const root = fixture(t);
  const pidFile = path.join(root, ".build/child.pid");
  const heartbeat = path.join(root, ".build/heartbeat");
  const childCode = `const fs=require('node:fs');process.on('SIGTERM',()=>{});fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>fs.writeFileSync(${JSON.stringify(heartbeat)},String(Date.now())),10);`;
  const parentCode = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'ignore'});setInterval(()=>{},1000);`;
  const controller = new AbortController();
  const pending = runLoggedCommand(
    root,
    { executable: process.execPath, args: ["-e", parentCode] },
    { stdout: path.join(root, ".build/out.log"), stderr: path.join(root, ".build/err.log") },
    { env: process.env, signal: controller.signal, timeoutMs: 10_000 },
  );
  const deadline = performance.now() + 8000;
  while (!existsSync(heartbeat)) {
    if (performance.now() > deadline) {
      controller.abort();
      await pending;
      throw new Error("Child did not reach checkpoint.");
    }
    await delay(20);
  }
  const pid = Number(readFileSync(pidFile, "utf8"));
  t.after(() => {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already terminated */
    }
  });
  controller.abort();
  const result = await pending;
  equal(result.status, "interrupted");
  equal(result.reason, "cancelled");
  await delay(100);
  const stoppedAt = readFileSync(heartbeat, "utf8");
  await delay(100);
  equal(readFileSync(heartbeat, "utf8"), stoppedAt);
});
