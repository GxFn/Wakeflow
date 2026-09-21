import { deepEqual, equal, ok } from "node:assert/strict";
import { lstatSync, rmSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { buildWakeflowPluginArtifacts } from "../../tooling/artifacts/build-plugin-artifacts.js";
import { smokeWakeflowPluginArtifacts } from "../../tooling/artifacts/smoke-plugin-artifacts.js";

const OUTPUT_RELATIVE = ".build/test-artifacts/smoke-candidate";

/**
 * 冒烟对候选制品运行（能力卡 10 Q8 的五幕加 hook 一幕），入口 `npm run smoke:candidate`。
 * 它不在 `npm test` 里（§13.101 D10 之 (a)，2026-09-20 用户确认）：committed 制品的冒烟由
 * `npm run smoke:artifacts` 在交付前独立跑，门里再对候选跑一遍是重复，且它 43 秒的磁盘争用
 * 把整条门拖慢一到两成。文件名用 `.manual.ts`，runner 只收 `.test.ts`，所以不会被自动派发。
 */
test("插件制品搬到仓库之外后跑通冒烟：工具目录、fresh 初始化、reconcile no-op、status 与 verify、pod 预览零写、hook 落地", {
  timeout: 180_000,
}, async (t) => {
  const output = path.join(process.cwd(), OUTPUT_RELATIVE);
  t.after(() => {
    const stat = lstatSync(output, { throwIfNoEntry: false });
    if (stat !== undefined && !stat.isSymbolicLink() && stat.isDirectory()) {
      rmSync(output, { recursive: true, force: false });
    }
  });
  await buildWakeflowPluginArtifacts(process.cwd(), { outputRoot: OUTPUT_RELATIVE });
  const result = await smokeWakeflowPluginArtifacts(process.cwd(), {
    artifactsRoot: OUTPUT_RELATIVE,
  });
  equal(result.kind, "WakeflowPluginArtifactsSmokeResult");
  deepEqual(
    result.artifacts.map((artifact) => artifact.hostId),
    ["codex", "claude-code"],
  );
  for (const artifact of result.artifacts) {
    equal(artifact.acts.tools, 20, artifact.hostId);
    equal(artifact.acts.freshInitialize, "completed", artifact.hostId);
    equal(artifact.acts.reconcile, "no-op", artifact.hostId);
    ok(artifact.acts.status.length > 0, artifact.hostId);
    equal(artifact.acts.verify, "ok", artifact.hostId);
    equal(artifact.acts.podCreatePreview, "ready", artifact.hostId);
    equal(artifact.acts.hookObserver, "landed", artifact.hostId);
  }
});
