import { deepEqual, equal, ok, rejects, throws } from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createDeliveryEnvelope } from "../../../src/governance/delivery/delivery-envelope.js";
import {
  CaptureError,
  canonicalDigest,
  readJson,
  writeExclusiveJson,
} from "../../../tooling/capture/io.js";
import {
  capturePlanDirectory,
  prepareCapture,
  readCapturePlan,
} from "../../../tooling/capture/plan.js";
import { captureAttemptFile, inspectCapture, runCapture } from "../../../tooling/capture/run.js";
import { runToolingCli } from "../../../tooling/cli.js";
import { captureFixture, fixtureGit, rerunFixture, writeJson } from "./capture.fixture.js";

test("capture freezes real portable contracts, survives removed source artifacts and preserves raw stdout/stderr", async (t) => {
  const f = captureFixture(t);
  const p = prepareCapture(f.repository, f.selectionFile);
  equal(prepareCapture(f.repository, f.selectionFile).id, p.id);
  equal(p.authorization, "not-established-by-capture");
  equal(inspectCapture(f.repository, p.id).status, "unavailable");
  rmSync(f.packageFile);
  rmSync(f.envelopeFile);
  rmSync(f.resultFile);
  const first = await runCapture(f.repository, p.id, "ts-1");
  equal(first.exitCode, 0, JSON.stringify(first));
  const dir = path.join(f.execution, first.outputFromExecutionRoot);
  deepEqual(readFileSync(path.join(dir, "stdout.log")), Buffer.from([65, 0, 255, 10]));
  equal(readFileSync(path.join(dir, "stderr.log"), "utf8"), "diagnostic\n");
  equal(await runCapture(f.repository, p.id, "ts-2").then((v) => v.exitCode), 0);
  equal(inspectCapture(f.repository, p.id).status, "matched");
  equal(inspectCapture(f.repository, p.id).controllerAcceptance, "not-performed");
  const before = readFileSync(path.join(dir, "record.json"));
  await rejects(runCapture(f.repository, p.id, "ts-1"));
  deepEqual(readFileSync(path.join(dir, "record.json")), before);
  writeFileSync(path.join(dir, "stdout.log"), "changed");
  equal(inspectCapture(f.repository, p.id).status, "unavailable");
});

test("a real linked checkout matches its committed baseline; primary fallback and other repositories refuse", async (t) => {
  const f = captureFixture(t, true);
  const p = prepareCapture(f.repository, f.selectionFile);
  equal(await runCapture(f.repository, p.id, "ts-1").then((r) => r.exitCode), 0);
  const implementation = f.selection.implementations[0];
  ok(implementation);
  implementation.checkout = "Product";
  writeJson(f.selectionFile, f.selection);
  throws(() => prepareCapture(f.repository, f.selectionFile), /capture-wrong-placement/u);
  const foreign = path.join(f.root, "Foreign");
  const foreignCheckout = path.join(f.root, "ForeignLinked");
  fixtureGit(f.root, ["clone", "--no-hardlinks", f.primary, foreign]);
  fixtureGit(foreign, ["worktree", "add", "-b", "codex/capture-fixture", foreignCheckout]);
  implementation.checkout = "ForeignLinked";
  writeJson(f.selectionFile, f.selection);
  throws(() => prepareCapture(f.repository, f.selectionFile), /capture-foreign-repository/u);
});

test("record inspection rejects inconsistent exit claims and unknown output files", async (t) => {
  const f = captureFixture(t);
  const p = prepareCapture(f.repository, f.selectionFile);
  const first = await runCapture(f.repository, p.id, "ts-1");
  await runCapture(f.repository, p.id, "ts-2");
  equal(inspectCapture(f.repository, p.id).status, "matched");
  const directory = path.join(f.execution, first.outputFromExecutionRoot);
  const file = path.join(directory, "record.json");
  const original = readFileSync(file);
  const { recordDigest: _digest, ...record } = readJson(file);
  record.settlement = { ...(record.settlement as Record<string, unknown>), exitCode: 7 };
  writeJson(file, { ...record, recordDigest: canonicalDigest(record) });
  equal(inspectCapture(f.repository, p.id).steps[0]?.code, "capture-settlement-inconsistent");
  writeFileSync(file, original);
  writeFileSync(path.join(directory, "unexpected"), "preserve");
  equal(inspectCapture(f.repository, p.id).steps[0]?.code, "capture-unknown-step-files");
  equal(readFileSync(path.join(directory, "unexpected"), "utf8"), "preserve");
});

test("output symlinks refuse before a command, and argv is never interpreted by a shell", async (t) => {
  const f = captureFixture(t);
  const destination = path.join(f.root, "Elsewhere");
  mkdirSync(destination);
  symlinkSync(destination, path.join(f.execution, "redirect"));
  writeJson(f.selectionFile, { ...f.selection, outputDirectory: "redirect/out" });
  const bad = prepareCapture(f.repository, f.selectionFile);
  await rejects(runCapture(f.repository, bad.id, "ts-1"));
  equal(existsSync(path.join(destination, "out")), false);
  writeFileSync(f.script, "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n");
  const literal = ["a b", "$(do-not-run)", "`do-not-run`", "x;y"];
  writeJson(f.selectionFile, {
    ...f.selection,
    commands: f.selection.commands.map((c) => ({ ...c, args: ["assert.mjs", ...literal] })),
  });
  const p = prepareCapture(f.repository, f.selectionFile);
  const result = await runCapture(f.repository, p.id, "ts-1");
  equal(result.exitCode, 0);
  deepEqual(
    JSON.parse(
      readFileSync(path.join(f.execution, result.outputFromExecutionRoot, "stdout.log"), "utf8"),
    ),
    literal,
  );
});

test("rerun takes only prior failing steps and rejects widening to a passing step", async (t) => {
  const f = captureFixture(t);
  const retry = rerunFixture(f);
  const p = prepareCapture(f.repository, f.selectionFile);
  deepEqual(p.stepIds, ["ts-2"]);
  await rejects(runCapture(f.repository, p.id, "ts-1"), /capture-step-outside-attempt/u);
  equal(await runCapture(f.repository, p.id, "ts-2").then((r) => r.exitCode), 0);
  equal(inspectCapture(f.repository, p.id).status, "matched");
  if (retry.envelope.workType !== "test" || retry.envelope.attempt.mode !== "rerun")
    throw new Error("fixture");
  const attempt = retry.envelope.attempt;
  const { envelopeDigest: _digest, ...body } = retry.envelope;
  const widened = createDeliveryEnvelope({
    ...body,
    attempt: { ...attempt, rerunSource: { ...attempt.rerunSource, stepIds: ["ts-1", "ts-2"] } },
  });
  writeJson(f.envelopeFile, widened);
  writeJson(f.selectionFile, {
    ...retry.selection,
    envelopeDigest: widened.envelopeDigest,
    commands: f.selection.commands,
  });
  throws(
    () => prepareCapture(f.repository, f.selectionFile),
    /capture-rerun-passing-or-unknown-step/u,
  );
});

test("stable attempt marker prevents concurrent CLI repeats across different plans and output directories", async (t) => {
  const f = captureFixture(t);
  const first = prepareCapture(f.repository, f.selectionFile);
  writeJson(f.selectionFile, { ...f.selection, outputDirectory: "fixtures/alternative" });
  const second = prepareCapture(f.repository, f.selectionFile);
  const cli = fileURLToPath(new URL("../../../tooling/cli.js", import.meta.url));
  const invoke = (id: string) =>
    promisify(execFile)(process.execPath, [cli, "capture", "run", "--id", id, "--step", "ts-1"], {
      cwd: f.repository,
      timeout: 60_000,
    });
  const results = await Promise.allSettled([invoke(first.id), invoke(second.id)]);
  equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const plan = readCapturePlan(f.repository, first.id);
  ok(existsSync(captureAttemptFile(f.repository, plan, "ts-1")));
  await rejects(runCapture(f.repository, second.id, "ts-1"));
});

test("partial markers are retained and neither run nor inspect invent a completed result", async (t) => {
  const f = captureFixture(t);
  const p = prepareCapture(f.repository, f.selectionFile);
  const plan = readCapturePlan(f.repository, p.id);
  const marker = captureAttemptFile(f.repository, plan, "ts-1");
  mkdirSync(path.dirname(marker), { recursive: true });
  writeFileSync(marker, "{partial");
  await rejects(runCapture(f.repository, p.id, "ts-1"), /capture-attempt-already-recorded/u);
  equal(readFileSync(marker, "utf8"), "{partial");
  equal(inspectCapture(f.repository, p.id).status, "unavailable");
});

test("changed harness, dirty product and same-byte file replacement refuse before running", async (t) => {
  const f = captureFixture(t);
  const p = prepareCapture(f.repository, f.selectionFile);
  const original = readFileSync(f.script);
  writeFileSync(f.script, Buffer.concat([original, Buffer.from("\n")]));
  await rejects(runCapture(f.repository, p.id, "ts-1"), /capture-harness-changed/u);
  const next = prepareCapture(f.repository, f.selectionFile);
  writeFileSync(path.join(f.checkout, "unexpected.txt"), "dirty");
  await rejects(runCapture(f.repository, next.id, "ts-1"), /capture-baseline-drift/u);
  rmSync(path.join(f.checkout, "unexpected.txt"));
  const product = path.join(f.checkout, "value.mjs");
  writeFileSync(`${product}.new`, readFileSync(product));
  renameSync(`${product}.new`, product);
  await rejects(runCapture(f.repository, next.id, "ts-1"), /capture-product-input-changed/u);
});

test("input links, duplicate JSON keys, unknown plan members and incomplete preparation refuse", (t) => {
  const f = captureFixture(t);
  const p = prepareCapture(f.repository, f.selectionFile);
  const dir = capturePlanDirectory(f.repository, p.id);
  writeFileSync(path.join(dir, "foreign"), "keep");
  throws(() => readCapturePlan(f.repository, p.id), /capture-unknown-plan-files/u);
  rmSync(path.join(dir, "foreign"));
  rmSync(path.join(dir, "ready.json"));
  throws(() => prepareCapture(f.repository, f.selectionFile));
  ok(!existsSync(path.join(dir, "ready.json")));
  writeFileSync(f.selectionFile, '{"kind":"first","kind":"second"}');
  throws(() => prepareCapture(f.repository, f.selectionFile), /capture-invalid-json/u);
  const link = path.join(f.root, "link.json");
  symlinkSync(f.packageFile, link);
  writeJson(f.selectionFile, { ...f.selection, taskPackageFile: "link.json" });
  throws(() => prepareCapture(f.repository, f.selectionFile), /capture-unsafe-or-large-file/u);
});

test("nonzero commands keep their exact bytes; timeout and output budgets never become green", async (t) => {
  for (const mode of ["failed", "timeout", "budget"] as const) {
    const f = captureFixture(t);
    const script =
      mode === "failed"
        ? "process.stderr.write('private-value\\n');process.exit(7);"
        : mode === "budget"
          ? "process.stdout.write('x'.repeat(2*1024*1024));setInterval(()=>{},1000);"
          : "setInterval(()=>{},1000);";
    writeFileSync(f.script, script);
    writeJson(f.selectionFile, {
      ...f.selection,
      commands: f.selection.commands.map((c) => ({
        ...c,
        timeoutMs: mode === "timeout" ? 50 : 1000,
        outputBudgetBytes: mode === "budget" ? 1024 : 4096,
      })),
    });
    const p = prepareCapture(f.repository, f.selectionFile);
    const r = await runCapture(f.repository, p.id, "ts-1");
    equal(r.exitCode, mode === "failed" ? 1 : 2, JSON.stringify(r));
    equal(JSON.stringify(r).includes("private-value"), false);
    const record = readJson(path.join(f.execution, r.outputFromExecutionRoot, "record.json"));
    equal(record.testVerdict, "not-assessed");
    if (mode === "budget") ok(r.issues.includes("capture-output-budget"));
    await rejects(runCapture(f.repository, p.id, "ts-1"));
  }
});

test("cancellation records interruption and later product mutation makes capture unavailable", async (t) => {
  const f = captureFixture(t);
  writeFileSync(f.script, "setInterval(()=>{},1000);");
  const p = prepareCapture(f.repository, f.selectionFile);
  const stop = new AbortController();
  setTimeout(() => stop.abort(), 250);
  const interrupted = await runCapture(f.repository, p.id, "ts-1", stop.signal);
  equal(interrupted.exitCode, 2);
  const other = captureFixture(t);
  writeFileSync(
    other.script,
    "import fs from 'node:fs';fs.appendFileSync('../Product/value.mjs','//changed');",
  );
  const q = prepareCapture(other.repository, other.selectionFile);
  const changed = await runCapture(other.repository, q.id, "ts-1");
  equal(changed.exitCode, 2);
  ok(changed.issues.includes("capture-baseline-drift"));
});

test("CLI rejects extra actions and conflicting options without granting execution authority", async (t) => {
  const f = captureFixture(t);
  await rejects(
    runToolingCli(
      ["capture", "prepare", "--input", f.selectionFile, "--step", "ts-1"],
      f.repository,
    ),
  );
  await rejects(runToolingCli(["capture", "run", "--id", "bad", "--step", "ts-1"], f.repository));
  throws(() => writeExclusiveJson(f.selectionFile, {}));
  ok(CaptureError.prototype instanceof Error);
});

test("an empty self-digested plan is not an integrity success", (t) => {
  const f = captureFixture(t);
  const original = prepareCapture(f.repository, f.selectionFile);
  const directory = capturePlanDirectory(f.repository, original.id);
  const { planDigest: _digest, ...body } = readJson(path.join(directory, "plan.json"));
  body.steps = [];
  body.selection = { ...(body.selection as Record<string, unknown>), commands: [] };
  const planDigest = canonicalDigest(body);
  const id = `capture-${planDigest.slice(7)}`;
  const forged = capturePlanDirectory(f.repository, id);
  cpSync(directory, forged, { recursive: true });
  writeJson(path.join(forged, "plan.json"), { ...body, planDigest });
  writeJson(path.join(forged, "ready.json"), { kind: "WakeflowCaptureInputsSealed", planDigest });
  throws(() => inspectCapture(f.repository, id), /capture-invalid-plan-steps/u);
});
