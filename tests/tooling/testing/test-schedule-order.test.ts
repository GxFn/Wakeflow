import { deepEqual, ok, throws } from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  TEST_DURATION_TABLE_PATH,
  loadTestDurations,
  orderTestSourcesByCost,
} from "../../../tooling/testing/run-typescript-tests.js";

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
  // 最长的文件（端到端场景）必须有记录，否则整个 longest-first 排程失去意义。
  ok(durations.has("tests/scenarios/wakeflow-scenario-acceptance.test.ts"));
});
