import { deepEqual, equal, rejects } from "node:assert/strict";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { triageFlakyTests } from "../../../tooling/testing/flaky.js";

/** 假的聚焦脚本：按计数文件交替通过与失败。 */
function fixture(t: TestContext): string {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-flaky-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, ".gitignore"), ".build/\n");
  writeFileSync(
    path.join(root, "package.json"),
    `${JSON.stringify({ name: "flaky-fixture", version: "0.0.0", private: true, type: "module", scripts: { "test:typescript:focused": "node focused.mjs" } })}\n`,
  );
  writeFileSync(
    path.join(root, "focused.mjs"),
    [
      'import { existsSync, readFileSync, writeFileSync } from "node:fs";',
      'const count = existsSync("count.txt") ? Number(readFileSync("count.txt", "utf8")) + 1 : 1;',
      'writeFileSync("count.txt", String(count));',
      "process.exit(count % 2 === 0 ? 1 : 0);",
    ].join("\n"),
  );
  return root;
}

test("flaky 分诊：重复运行记录每次结果，混合结果标为 flaky 且非零退出，日志留在 .build/flaky 下", {
  timeout: 60_000,
}, async (t) => {
  const root = fixture(t);
  const triage = await triageFlakyTests(root, { files: ["tests/x.test.ts"], runs: "3" });
  equal(triage.kind, "WakeflowFlakyTriage");
  deepEqual(
    triage.runs.map((run) => run.status),
    ["passed", "failed", "passed"],
  );
  equal(triage.passes, 2);
  equal(triage.failures, 1);
  equal(triage.flaky, true);
  equal(triage.status, "failed");
  equal(triage.exitCode, 1);
  equal(existsSync(path.join(root, triage.logs, "triage.json")), true);
  equal(existsSync(path.join(root, triage.logs, "02.stdout.log")), true);
  await rejects(triageFlakyTests(root, { files: ["tests/x.test.ts"], runs: "0" }), /1 to 20/u);
  await rejects(triageFlakyTests(root, { files: [], runs: "2" }), /at least one/u);
});

test("flaky 分诊：一次全部通过按 passed；预先取消按 unavailable 且不运行", {
  timeout: 60_000,
}, async (t) => {
  const root = fixture(t);
  const single = await triageFlakyTests(root, { files: ["tests/x.test.ts"], runs: "1" });
  equal(single.status, "passed");
  equal(single.flaky, false);
  const controller = new AbortController();
  controller.abort();
  await rejects(
    triageFlakyTests(root, { files: ["tests/x.test.ts"], runs: "2", signal: controller.signal }),
    /build-lock-aborted|aborted/u,
  );
});
