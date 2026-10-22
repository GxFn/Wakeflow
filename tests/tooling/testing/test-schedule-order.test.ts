import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os, { availableParallelism } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  loadTestDurations,
  orderTestSourcesByCost,
  planTestLanes,
  TEST_DURATION_TABLE_PATH,
} from "../../../tooling/testing/run-typescript-tests.js";
import { inspectTestRecording } from "../../../tooling/testing/test-recording.js";
import { loadSensitive } from "../../support/load-sensitive.js";

function temporaryRoot(after: (cleanup: () => void) => void): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-test-schedule-"));
  after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function writeTable(root: string, body: string): void {
  mkdirSync(path.join(root, "tooling", "testing"), { recursive: true });
  writeFileSync(path.join(root, ...TEST_DURATION_TABLE_PATH.split("/")), body);
}

test("排程顺序：已知耗时降序，未知文件排在最前，同一档按路径升序", () => {
  const durations = new Map([
    ["tests/b/slow.test.ts", 90_000],
    ["tests/a/medium.test.ts", 1_000],
    ["tests/z/medium.test.ts", 1_000],
    ["tests/a/fast.test.ts", 1],
    ["tests/removed/gone.test.ts", 50_000],
  ]);
  const selected = [
    "tests/a/fast.test.ts",
    "tests/a/medium.test.ts",
    "tests/b/slow.test.ts",
    "tests/z/medium.test.ts",
    "tests/z/unknown.test.ts",
    "tests/a/unknown.test.ts",
  ];

  deepEqual(orderTestSourcesByCost(selected, durations), [
    // 未知耗时优先派发，彼此之间按路径升序。
    "tests/a/unknown.test.ts",
    "tests/z/unknown.test.ts",
    // 已知耗时降序；1000ms 的两个文件同档，由路径升序决定先后。
    "tests/b/slow.test.ts",
    "tests/a/medium.test.ts",
    "tests/z/medium.test.ts",
    "tests/a/fast.test.ts",
  ]);
});

test("排程顺序对同一输入确定，且不增删任何被选中的文件", () => {
  const durations = new Map([
    ["tests/one.test.ts", 5],
    ["tests/two.test.ts", 5],
    ["tests/three.test.ts", 7],
  ]);
  const selected = ["tests/two.test.ts", "tests/unknown.test.ts", "tests/three.test.ts"];

  const first = orderTestSourcesByCost(selected, durations);
  const second = orderTestSourcesByCost([...selected].reverse(), durations);
  deepEqual(first, second);
  deepEqual([...first].sort(), [...selected].sort());
  deepEqual(orderTestSourcesByCost([], durations), []);

  // 耗时表整体缺席时全部文件都未知，顺序退回改动之前的路径升序。
  deepEqual(orderTestSourcesByCost(selected, new Map()), [...selected].sort());
});

test("耗时表缺席即全部未知；表存在但键值非法时立即失败", (t) => {
  const root = temporaryRoot((cleanup) => t.after(cleanup));
  deepEqual([...loadTestDurations(root).entries()], []);

  writeTable(root, '{"durationsMs":{"tests/ok.test.ts":12}}');
  deepEqual([...loadTestDurations(root).entries()], [["tests/ok.test.ts", 12]]);

  writeTable(root, "{not json");
  throws(() => loadTestDurations(root), /not valid JSON/u);

  writeTable(root, '{"durationsMs":[]}');
  throws(() => loadTestDurations(root), /durationsMs object/u);

  writeTable(root, `{"durationsMs":{"${path.join(root, "tests/x.test.ts")}":12}}`);
  throws(() => loadTestDurations(root), /repository-relative/u);

  writeTable(root, '{"durationsMs":{"tests/../secret.test.ts":12}}');
  throws(() => loadTestDurations(root), /repository-relative/u);

  writeTable(root, '{"durationsMs":{"src/not-a-test.ts":12}}');
  throws(() => loadTestDurations(root), /repository-relative/u);

  writeTable(root, '{"durationsMs":{"tests/ok.test.ts":-1}}');
  throws(() => loadTestDurations(root), /non-negative integer/u);

  writeTable(root, '{"durationsMs":{"tests/ok.test.ts":"12"}}');
  throws(() => loadTestDurations(root), /non-negative integer/u);
});

test("耗时表必须是普通文件：symlink 顶替时失败", (t) => {
  const root = temporaryRoot((cleanup) => t.after(cleanup));
  const elsewhere = path.join(root, "elsewhere.json");
  writeFileSync(elsewhere, '{"durationsMs":{}}');
  mkdirSync(path.join(root, "tooling", "testing"), { recursive: true });
  symlinkSync(elsewhere, path.join(root, ...TEST_DURATION_TABLE_PATH.split("/")));

  throws(() => loadTestDurations(root), /one regular file/u);
});

test("签入的耗时表可被加载，且每一条都是当前仓库相对测试路径", () => {
  const durations = loadTestDurations(process.cwd());
  ok(durations.size > 0);
  for (const [key, value] of durations) {
    ok(key.startsWith("tests/") && key.endsWith(".test.ts"), key);
    ok(Number.isSafeInteger(value) && value >= 0, key);
    ok(statSync(path.join(process.cwd(), key), { throwIfNoEntry: false })?.isFile() === true, key);
  }
  // 最长的文件（端到端场景链，每宿主一个文件）必须有记录，否则整个 longest-first 排程失去意义。
  ok(durations.has("tests/scenarios/wakeflow-scenario-acceptance-codex.test.ts"));
  ok(durations.has("tests/scenarios/wakeflow-scenario-acceptance-claude-code.test.ts"));
});

test("实际Node进程按耗时队列执行文件，终端与事件记录保持同一选择", () => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-dispatch-order-")));
  try {
    mkdirSync(path.join(root, "tests"));
    mkdirSync(path.join(root, ".build/tests"), { recursive: true });
    mkdirSync(path.join(root, ".build/verification"), { mode: 0o700 });
    writeFileSync(path.join(root, "package.json"), '{"type":"module"}\n');
    for (const name of ["a-fast", "z-slow"]) {
      writeFileSync(path.join(root, `tests/${name}.test.ts`), "// selected source fixture\n");
      writeFileSync(
        path.join(root, `.build/tests/${name}.test.js`),
        `import {test} from 'node:test'; import {appendFileSync} from 'node:fs'; test('${name}',()=>appendFileSync('execution-order.txt','${name}\\n'));\n`,
      );
    }
    writeTable(
      root,
      JSON.stringify({ durationsMs: { "tests/a-fast.test.ts": 1, "tests/z-slow.test.ts": 1000 } }),
    );
    const runner = fileURLToPath(
      new URL("../../../tooling/testing/run-typescript-tests.js", import.meta.url),
    );
    for (const recorded of [false, true]) {
      writeFileSync(path.join(root, "execution-order.txt"), "");
      const env: NodeJS.ProcessEnv = { ...process.env, WAKEFLOW_TEST_CONCURRENCY: "1" };
      delete env.NODE_TEST_CONTEXT;
      delete env.WAKEFLOW_TEST_RECORD_DIR;
      const directory = path.join(root, ".build/verification/run-order");
      if (recorded) {
        mkdirSync(directory, { mode: 0o700 });
        env.WAKEFLOW_TEST_RECORD_DIR = directory;
      }
      const result = spawnSync(process.execPath, [runner], {
        cwd: root,
        env,
        encoding: "utf8",
        shell: false,
        timeout: 15_000,
      });
      ok(result.status === 0, result.stderr);
      deepEqual(readFileSync(path.join(root, "execution-order.txt"), "utf8").trim().split("\n"), [
        "z-slow",
        "a-fast",
      ]);
      if (recorded) {
        const record = inspectTestRecording(directory);
        ok(record.complete && record.passed);
        deepEqual(record.selectedFiles, ["tests/z-slow.test.ts", "tests/a-fast.test.ts"]);
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/** 一个把生命周期写进共享日志的测试文件：`start` 立即写，可选地等一段墙钟后写 `end`。 */
function loggingTest(name: string, waitMs: number): string {
  return [
    "import {test} from 'node:test'; import {appendFileSync} from 'node:fs';",
    `test('${name}', async () => {`,
    `  appendFileSync('execution-order.txt', '${name}-start\\n');`,
    waitMs > 0 ? `  await new Promise((resolve) => setTimeout(resolve, ${waitMs}));` : "",
    `  appendFileSync('execution-order.txt', '${name}-end\\n');`,
    "});",
    "",
  ].join("\n");
}

test("实际 Node 进程按道运行：链与隔离文件立即开始，其余文件等隔离道结束，终端与记录只有一份运行尾部", (t) => {
  if (
    loadSensitive(
      t,
      "spawns the runner with four real test processes and asserts their relative timing",
    )
  )
    return;
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-lane-order-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "tests/scenarios"), { recursive: true });
  mkdirSync(path.join(root, "tests/support"), { recursive: true });
  mkdirSync(path.join(root, ".build/tests/scenarios"), { recursive: true });
  mkdirSync(path.join(root, ".build/verification"), { mode: 0o700 });
  writeFileSync(path.join(root, "package.json"), '{"type":"module"}\n');
  // 源文件只给静态图看：slow 经导入链到达负载敏感标签，其余文件不到。
  writeFileSync(path.join(root, "tests/support/load-sensitive.ts"), "export const tag = 1;\n");
  writeFileSync(
    path.join(root, "tests/slow.test.ts"),
    'import { tag } from "./support/load-sensitive.js";\n',
  );
  for (const name of ["scenarios/chain", "a", "b"]) {
    writeFileSync(path.join(root, `tests/${name}.test.ts`), "// source fixture\n");
  }
  writeFileSync(path.join(root, ".build/tests/scenarios/chain.test.js"), loggingTest("chain", 300));
  writeFileSync(path.join(root, ".build/tests/slow.test.js"), loggingTest("isolated", 800));
  writeFileSync(path.join(root, ".build/tests/a.test.js"), loggingTest("normal-a", 0));
  writeFileSync(path.join(root, ".build/tests/b.test.js"), loggingTest("normal-b", 0));
  writeTable(
    root,
    JSON.stringify({
      durationsMs: {
        "tests/scenarios/chain.test.ts": 1000,
        "tests/slow.test.ts": 500,
        "tests/a.test.ts": 10,
        "tests/b.test.ts": 5,
      },
    }),
  );
  writeFileSync(path.join(root, "execution-order.txt"), "");
  const budget = Math.min(8, availableParallelism());
  const directory = path.join(root, ".build/verification/run-lanes");
  mkdirSync(directory, { mode: 0o700 });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    WAKEFLOW_TEST_CONCURRENCY: String(budget),
    WAKEFLOW_TEST_RECORD_DIR: directory,
  };
  delete env.NODE_TEST_CONTEXT;
  const runner = fileURLToPath(
    new URL("../../../tooling/testing/run-typescript-tests.js", import.meta.url),
  );
  const result = spawnSync(process.execPath, [runner], {
    cwd: root,
    env,
    encoding: "utf8",
    shell: false,
    timeout: 60_000,
  });
  ok(result.status === 0, result.stderr);

  const selected = [
    "tests/scenarios/chain.test.ts",
    "tests/slow.test.ts",
    "tests/a.test.ts",
    "tests/b.test.ts",
  ];
  const record = inspectTestRecording(directory);
  ok(record.complete && record.passed);
  equal(record.counts.tests, 4);
  equal(record.concurrency, budget);
  deepEqual(record.selectedFiles, selected);
  // 记录里的道计划就是纯函数对同一清单、同一预算给出的计划。
  const expected = planTestLanes(selected, budget, new Set(["tests/slow.test.ts"]));
  deepEqual(record.lanes, expected);
  // 四个文件各报了一次文件汇总；运行尾部只合成一份（终端的 ℹ tests 行只出现一次）。
  equal(record.fileResults.length, 4);
  equal((result.stdout.match(/tests 4\n/gu) ?? []).length, 1);
  equal(result.stdout.includes("tests 1\n"), false);
  ok(result.stderr.includes(`budget ${budget}, lanes `), result.stderr);

  const log = readFileSync(path.join(root, "execution-order.txt"), "utf8").trim().split("\n");
  deepEqual([...log].sort(), [
    "chain-end",
    "chain-start",
    "isolated-end",
    "isolated-start",
    "normal-a-end",
    "normal-a-start",
    "normal-b-end",
    "normal-b-start",
  ]);
  if (expected.length === 3) {
    ok(result.stderr.includes("lanes chain=1@1 isolated=1@1 normal=2@"), result.stderr);
    const isolatedEnd = log.indexOf("isolated-end");
    // 链道立即开始：它的 start 在隔离文件 800 毫秒的等待结束之前。
    ok(log.indexOf("chain-start") < isolatedEnd, log.join(" "));
    // 其余道等隔离道结束：两个 normal 文件都在 isolated-end 之后才开始。
    ok(log.indexOf("normal-a-start") > isolatedEnd, log.join(" "));
    ok(log.indexOf("normal-b-start") > isolatedEnd, log.join(" "));
  } else {
    // 预算不足时是单道：计划只有一条 all 道，记录与终端的其余断言已在上面成立。
    deepEqual(
      expected.map((lane) => lane.name),
      ["all"],
    );
  }
});
