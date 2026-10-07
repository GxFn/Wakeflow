import { deepEqual, equal, ok, throws } from "node:assert/strict";
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
import { fileURLToPath } from "node:url";
import {
  inspectTestRecording,
  prepareTestRecording,
} from "../../../tooling/testing/test-recording.js";
import { runLoggedCommand } from "../../../tooling/verification/process.js";

const RUNNER = fileURLToPath(
  new URL("../../../tooling/testing/run-typescript-tests.js", import.meta.url),
);

function fixture(t: TestContext, body: string) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-test-recording-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "tests"));
  mkdirSync(path.join(root, ".build/tests"), { recursive: true });
  mkdirSync(path.join(root, ".build/verification"), { mode: 0o700 });
  const directory = mkdtempSync(path.join(root, ".build/verification/run-"));
  writeFileSync(path.join(root, "package.json"), '{"type":"module"}\n');
  writeFileSync(path.join(root, "tests/case.test.ts"), "// source fixture\n");
  writeFileSync(
    path.join(root, ".build/tests/case.test.js"),
    `import {test} from 'node:test';${body}\n`,
  );
  writeFileSync(path.join(root, ".build/tests/stale.test.js"), "throw Error('must not run');\n");
  return { root, directory };
}

async function executeFixture(f: { root: string; directory: string }) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    WAKEFLOW_TEST_RECORD_DIR: f.directory,
    WAKEFLOW_TEST_CONCURRENCY: "1",
  };
  delete env.NODE_TEST_CONTEXT;
  return runLoggedCommand(
    f.root,
    { executable: process.execPath, args: [RUNNER] },
    {
      stdout: path.join(f.root, ".build/stdout.log"),
      stderr: path.join(f.root, ".build/stderr.log"),
    },
    { env, timeoutMs: 15_000 },
  );
}

test("real Node events preserve pass, failure, skip and cancellation without executing stale output", async (t) => {
  for (const [name, body, count] of [
    ["passed", "test('nested', async(t)=>{await t.test('child',()=>{})});", "passed"],
    ["failed", "test('failure',()=>{throw Error('synthetic failure')});", "failed"],
    ["skipped", "test.skip('skip',()=>{});", "skipped"],
    ["cancelled", "test('pending',{timeout:20},()=>new Promise(()=>{}));", "cancelled"],
  ] as const) {
    await t.test(name, async (t) => {
      const f = fixture(t, body);
      const child = await executeFixture(f);
      equal(child.reason, "exit");
      const record = inspectTestRecording(f.directory);
      deepEqual(record.selectedFiles, ["tests/case.test.ts"]);
      equal(record.complete, true);
      equal(record.passed, name === "passed");
      equal(record.counts[count] > 0, true);
      equal(child.exitCode === 0, name === "passed" || name === "skipped");
    });
  }
});

test("truncated or inconsistent event evidence cannot become a passing test record", async (t) => {
  const f = fixture(t, "test('ok',()=>{});");
  equal((await executeFixture(f)).exitCode, 0);
  const file = path.join(f.directory, "test-events.jsonl");
  const original = readFileSync(file, "utf8");
  const events = original
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  writeFileSync(
    file,
    `${events
      .slice(0, -1)
      .map((event) => JSON.stringify(event))
      .join("\n")}\n`,
  );
  equal(inspectTestRecording(f.directory).passed, false);
  writeFileSync(file, original);
  const duplicatedHeader = [events[0], events[0], ...events.slice(1)];
  writeFileSync(file, `${duplicatedHeader.map((event) => JSON.stringify(event)).join("\n")}\n`);
  throws(() => inspectTestRecording(f.directory), /concatenated/u);
  writeFileSync(file, original);
  const summary = events.find((event) => event.type === "summary" && event.scope === "file");
  if (summary === undefined) throw new Error("Missing file summary.");
  summary.success = false;
  writeFileSync(file, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
  equal(inspectTestRecording(f.directory).passed, false);
  writeFileSync(file, original.slice(0, 20));
  throws(() => inspectTestRecording(f.directory));
});

test("recording rejects output outside the private run directory and never overwrites evidence", (t) => {
  const f = fixture(t, "");
  throws(() => prepareTestRecording(f.root, f.root, [], 1), /run directory/u);
  prepareTestRecording(f.root, f.directory, [path.join(f.root, ".build/tests/case.test.js")], 1);
  const selection = readFileSync(path.join(f.directory, "test-selection.json"));
  throws(() => prepareTestRecording(f.root, f.directory, [], 1));
  deepEqual(readFileSync(path.join(f.directory, "test-selection.json")), selection);
});

test("cancelling the programmatic runner stops its real test child and cannot leave a passing recording", {
  timeout: 15_000,
}, async (t) => {
  const f = fixture(
    t,
    "import {writeFileSync} from 'node:fs';test('pending',()=>{writeFileSync('started.json',JSON.stringify({pid:process.pid}));return new Promise(()=>{setInterval(()=>{},1000)});});",
  );
  const controller = new AbortController();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    WAKEFLOW_TEST_RECORD_DIR: f.directory,
    WAKEFLOW_TEST_CONCURRENCY: "1",
  };
  delete env.NODE_TEST_CONTEXT;
  const pending = runLoggedCommand(
    f.root,
    { executable: process.execPath, args: [RUNNER] },
    {
      stdout: path.join(f.root, ".build/stdout.log"),
      stderr: path.join(f.root, ".build/stderr.log"),
    },
    { env, timeoutMs: 10_000, signal: controller.signal },
  );
  const checkpoint = path.join(f.root, "started.json");
  const deadline = Date.now() + 5000;
  while (!existsSync(checkpoint) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 20));
  ok(existsSync(checkpoint));
  const { pid } = JSON.parse(readFileSync(checkpoint, "utf8"));
  controller.abort();
  const result = await pending;
  equal(result.reason, "cancelled");
  let alive = true;
  try {
    process.kill(pid, 0);
  } catch {
    alive = false;
  }
  equal(alive, false);
  let passed = false;
  try {
    passed = inspectTestRecording(f.directory).passed;
  } catch {
    /* Incomplete cancellation evidence is unavailable, never passing. */
  }
  equal(passed, false);
});
