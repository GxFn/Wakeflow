import { deepEqual, doesNotThrow, equal, throws } from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  CHAIN_LANE_CONCURRENCY,
  compiledTypeScriptTests,
  ISOLATED_LANE_CONCURRENCY,
  LANE_MINIMUM_BUDGET,
  planTestLanes,
  resolveTestConcurrency,
} from "../../../tooling/testing/run-typescript-tests.js";

test("TypeScript test runner 从当前源文件映射 focused 输出", () => {
  const repositoryRoot = process.cwd();
  const source = "tests/workspace/window-runtime/wakeflow-window-host-binding.test.ts";
  const selected = compiledTypeScriptTests(repositoryRoot, [source]);
  equal(selected.length, 1);
  equal(
    selected[0],
    path.join(
      repositoryRoot,
      ".build/tests/workspace/window-runtime/wakeflow-window-host-binding.test.js",
    ),
  );
  throws(
    () =>
      compiledTypeScriptTests(repositoryRoot, [
        "tests/workspace/window-runtime/removed-stale.test.ts",
      ]),
    /current regular file/u,
  );
  throws(() => compiledTypeScriptTests(repositoryRoot, [source, source]), /duplicates/u);
  throws(() => compiledTypeScriptTests(repositoryRoot, ["test/legacy.test.mjs"]), /below tests/u);
  // 错误点名具体路径，批量调用时一眼看出是哪个参数写错了（§13.162）。
  throws(
    () =>
      compiledTypeScriptTests(repositoryRoot, [
        "tests/workspace/window-runtime/removed-stale.test.ts",
      ]),
    /removed-stale\.test\.ts/u,
  );
});

test("focused 值可以是 tests/ 下的目录：展开为其中全部当前测试源，空目录与越界目录被拒", (t) => {
  const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-typescript-test-runner-"));
  t.after(() => rmSync(repositoryRoot, { recursive: true, force: true }));
  for (const relative of [
    "tests/kernel/a.test.ts",
    "tests/kernel/deep/b.test.ts",
    "tests/other/c.test.ts",
  ]) {
    mkdirSync(path.dirname(path.join(repositoryRoot, relative)), { recursive: true });
    writeFileSync(path.join(repositoryRoot, relative), "");
    const compiled = path.join(repositoryRoot, ".build", relative.replace(/\.ts$/u, ".js"));
    mkdirSync(path.dirname(compiled), { recursive: true });
    writeFileSync(compiled, "");
  }
  mkdirSync(path.join(repositoryRoot, "tests/empty"));
  deepEqual(
    compiledTypeScriptTests(repositoryRoot, ["tests/kernel", "tests/other/c.test.ts"]).map((file) =>
      path.relative(repositoryRoot, file),
    ),
    [
      ".build/tests/kernel/a.test.js",
      ".build/tests/kernel/deep/b.test.js",
      ".build/tests/other/c.test.js",
    ],
  );
  throws(
    () => compiledTypeScriptTests(repositoryRoot, ["tests/empty"]),
    /holds no \.test\.ts source: tests\/empty/u,
  );
  doesNotThrow(
    () => compiledTypeScriptTests(repositoryRoot, ["tests"]),
    "the whole tests root is a valid directory value",
  );
  throws(
    () => compiledTypeScriptTests(repositoryRoot, ["tests/kernel", "tests/kernel/a.test.ts"]),
    /duplicates/u,
  );
  throws(() => compiledTypeScriptTests(repositoryRoot, ["src"]), /below tests\/: src/u);
});

test("focused test runner拒绝tests根内的symlink祖先", (t) => {
  const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-typescript-test-runner-"));
  t.after(() => rmSync(repositoryRoot, { recursive: true, force: true }));
  const testsRoot = path.join(repositoryRoot, "tests");
  const outside = path.join(repositoryRoot, "outside");
  mkdirSync(testsRoot);
  mkdirSync(outside);
  writeFileSync(path.join(outside, "escaped.test.ts"), "");
  symlinkSync(outside, path.join(testsRoot, "linked"), "dir");

  throws(
    () => compiledTypeScriptTests(repositoryRoot, ["tests/linked/escaped.test.ts"]),
    /parent chain/u,
  );
});

test("full-mode test runner never executes a stale compiled output", (t) => {
  const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-typescript-test-runner-"));
  t.after(() => rmSync(repositoryRoot, { recursive: true, force: true }));
  mkdirSync(path.join(repositoryRoot, "tests"));
  mkdirSync(path.join(repositoryRoot, ".build", "tests"), { recursive: true });
  writeFileSync(path.join(repositoryRoot, "tests", "a.test.ts"), "");
  writeFileSync(path.join(repositoryRoot, ".build", "tests", "a.test.js"), "");
  writeFileSync(path.join(repositoryRoot, ".build", "tests", "stale.test.js"), "");

  deepEqual(compiledTypeScriptTests(repositoryRoot), [
    path.join(repositoryRoot, ".build", "tests", "a.test.js"),
  ]);

  writeFileSync(path.join(repositoryRoot, "tests", "b.test.ts"), "");
  throws(() => compiledTypeScriptTests(repositoryRoot), /no regular compiled output/u);
});

test("test concurrency override changes only the worker budget and rejects invalid or excessive values", () => {
  equal(resolveTestConcurrency(undefined, 8), 8);
  equal(resolveTestConcurrency("", 8), 8);
  equal(resolveTestConcurrency("4", 8), 4);
  equal(resolveTestConcurrency("1", 8), 1);
  for (const value of ["0", "-1", "4.0", "2e0", " 4", "9", "Infinity", "9007199254740992"]) {
    throws(() => resolveTestConcurrency(value, 8), /WAKEFLOW_TEST_CONCURRENCY/u);
  }
  throws(() => resolveTestConcurrency(undefined, 0), /parallelism/u);
});

const ORDERED = [
  "tests/scenarios/wakeflow-scenario-acceptance-claude-code.test.ts",
  "tests/scenarios/wakeflow-scenario-acceptance-codex.test.ts",
  "tests/capabilities/result-review/service.test.ts",
  "tests/tooling/lab/workflow-claude-code.test.ts",
  "tests/tooling/lab/workflow-codex.test.ts",
  "tests/kernel/a.test.ts",
  "tests/foundation/filesystem/rooted-read-write-scope.test.ts",
  "tests/kernel/b.test.ts",
];
const ISOLATED = new Set([
  "tests/tooling/lab/workflow-claude-code.test.ts",
  "tests/tooling/lab/workflow-codex.test.ts",
  "tests/foundation/filesystem/rooted-read-write-scope.test.ts",
]);

test("道计划：预算足够时链道与隔离道立即开始、其余道等隔离道结束，每条道内保持传入顺序，文件不增不减", () => {
  const lanes = planTestLanes(ORDERED, 8, ISOLATED);
  deepEqual(
    lanes.map((lane) => [lane.name, lane.concurrency, lane.after]),
    [
      ["chain", CHAIN_LANE_CONCURRENCY, null],
      ["isolated", ISOLATED_LANE_CONCURRENCY, null],
      ["normal", 8 - CHAIN_LANE_CONCURRENCY, "isolated"],
    ],
  );
  deepEqual(lanes[0]?.files, ORDERED.slice(0, 2));
  deepEqual(lanes[1]?.files, [
    "tests/tooling/lab/workflow-claude-code.test.ts",
    "tests/tooling/lab/workflow-codex.test.ts",
    "tests/foundation/filesystem/rooted-read-write-scope.test.ts",
  ]);
  deepEqual(lanes[2]?.files, [
    "tests/capabilities/result-review/service.test.ts",
    "tests/kernel/a.test.ts",
    "tests/kernel/b.test.ts",
  ]);
  deepEqual([...lanes.flatMap((lane) => lane.files)].sort(), [...ORDERED].sort());
  // 预算 6 是分道的下限：其余道还剩四个 worker。
  equal(planTestLanes(ORDERED, LANE_MINIMUM_BUDGET, ISOLATED).at(-1)?.concurrency, 4);
  // 道计划对同一输入确定。
  deepEqual(planTestLanes(ORDERED, 8, ISOLATED), lanes);
});

test("道计划退回单道：预算不足、清单里没有负载敏感文件，或只有链文件", () => {
  for (const budget of [1, 2, LANE_MINIMUM_BUDGET - 1]) {
    deepEqual(planTestLanes(ORDERED, budget, ISOLATED), [
      { name: "all", concurrency: budget, after: null, files: ORDERED },
    ]);
  }
  deepEqual(planTestLanes(ORDERED, 8, new Set()), [
    { name: "all", concurrency: 8, after: null, files: ORDERED },
  ]);
  // 场景链文件即便带了标签也归链道，不算隔离文件。
  deepEqual(planTestLanes(ORDERED.slice(0, 2), 8, new Set(ORDERED.slice(0, 2))), [
    { name: "all", concurrency: 8, after: null, files: ORDERED.slice(0, 2) },
  ]);
  throws(() => planTestLanes(ORDERED, 0, ISOLATED), /lane budget/u);
});

test("道计划的边界：没有链文件时其余道用整个预算，隔离道与链道的并发不超过各自文件数，全是隔离文件时没有其余道", () => {
  const withoutChain = planTestLanes(ORDERED.slice(2), 8, ISOLATED);
  deepEqual(
    withoutChain.map((lane) => [lane.name, lane.concurrency, lane.after]),
    [
      ["isolated", ISOLATED_LANE_CONCURRENCY, null],
      ["normal", 8, "isolated"],
    ],
  );
  const oneEach = planTestLanes(
    [ORDERED[0] as string, "tests/foundation/filesystem/rooted-read-write-scope.test.ts"],
    8,
    ISOLATED,
  );
  deepEqual(
    oneEach.map((lane) => [lane.name, lane.concurrency, lane.after]),
    [
      ["chain", 1, null],
      ["isolated", 1, null],
    ],
  );
  const onlyIsolated = planTestLanes([...ISOLATED], 6, ISOLATED);
  deepEqual(
    onlyIsolated.map((lane) => [lane.name, lane.concurrency, lane.after]),
    [["isolated", ISOLATED_LANE_CONCURRENCY, null]],
  );
});
