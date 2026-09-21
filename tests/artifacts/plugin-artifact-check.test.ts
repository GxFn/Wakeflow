import { deepEqual, equal, ok, rejects } from "node:assert/strict";
import {
  appendFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { buildWakeflowPluginArtifacts } from "../../tooling/artifacts/build-plugin-artifacts.js";
import {
  checkWakeflowPluginArtifacts,
  CLAUDE_MARKETPLACE_PATH,
  CODEX_MARKETPLACE_PATH,
  jsonStructurallyEqual,
} from "../../tooling/artifacts/check-plugin-artifacts.js";
import {
  expectedClaudeMarketplaceEntry,
  expectedCodexMarketplaceEntry,
  readReleaseVersion,
} from "../../tooling/artifacts/plugin-metadata.js";

const COMMITTED_RELATIVE = ".build/test-artifacts/check-committed";
const CANDIDATE_RELATIVE = ".build/test-artifacts/check-candidate";

function removeBuildDirectory(relative: string): void {
  const absolute = path.join(process.cwd(), relative);
  const stat = lstatSync(absolute, { throwIfNoEntry: false });
  if (stat !== undefined && !stat.isSymbolicLink() && stat.isDirectory()) {
    rmSync(absolute, { recursive: true, force: false });
  }
}

/** 一份"已提交"的制品：用构建器写到 `.build/` 下的一个根，模拟 `plugins/`。 */
async function committedFixture(t: TestContext): Promise<string> {
  t.after(() => {
    removeBuildDirectory(COMMITTED_RELATIVE);
    removeBuildDirectory(CANDIDATE_RELATIVE);
  });
  await buildWakeflowPluginArtifacts(process.cwd(), { outputRoot: COMMITTED_RELATIVE });
  return path.join(process.cwd(), COMMITTED_RELATIVE);
}

/** 两份 marketplace 文件的手写外壳：目录元数据加恰好一个 `wakeflow` 条目，键序故意与元数据不同。 */
function marketplaceFixture(t: TestContext, claudeVersion: string): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-marketplace-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const claudeEntry = expectedClaudeMarketplaceEntry(claudeVersion);
  const reorderedClaude = Object.fromEntries(Object.entries(claudeEntry).reverse());
  mkdirSync(path.join(root, ".claude-plugin"), { recursive: true });
  writeFileSync(
    path.join(root, CLAUDE_MARKETPLACE_PATH),
    `${JSON.stringify(
      {
        name: "gxfn",
        owner: { name: "GxFn", url: "https://github.com/GxFn" },
        metadata: { description: "GxFn plugin catalog", version: "1.0.0" },
        plugins: [reorderedClaude],
      },
      null,
      2,
    )}\n`,
  );
  mkdirSync(path.join(root, ".agents", "plugins"), { recursive: true });
  writeFileSync(
    path.join(root, CODEX_MARKETPLACE_PATH),
    `${JSON.stringify(
      {
        name: "gxfn",
        interface: { displayName: "GxFn" },
        plugins: [expectedCodexMarketplaceEntry()],
      },
      null,
      2,
    )}\n`,
  );
  return root;
}

function expectCheckErrorCode(code: string): (error: unknown) => true {
  return (error: unknown): true => {
    ok(error instanceof Error, "抛出的必须是 Error");
    equal(error.name, "PluginArtifactCheckError");
    equal((error as { readonly code?: unknown }).code, code);
    return true;
  };
}

async function check(marketplaceRoot: string) {
  return checkWakeflowPluginArtifacts(process.cwd(), {
    committedRoot: COMMITTED_RELATIVE,
    candidateRoot: CANDIDATE_RELATIVE,
    marketplaceRoot,
  });
}

test("committed 制品与源码重建逐字节一致、marketplace 条目与元数据结构相等时校验通过（D2、D6）", async (t) => {
  await committedFixture(t);
  const release = readReleaseVersion(process.cwd());
  const result = await check(marketplaceFixture(t, release.version));
  equal(result.kind, "WakeflowPluginArtifactsCheckResult");
  equal(result.version, release.version);
  equal(result.releaseEligible, true);
  deepEqual(
    result.artifacts.map((artifact) => artifact.directory),
    ["codex-wakeflow", "claude-code-wakeflow"],
  );
  for (const artifact of result.artifacts) ok(artifact.fileCount > 400, artifact.directory);
  deepEqual(result.marketplaces, { claude: "ok", codex: "ok" });
});

test("committed 制品的任何手工改动都被拒绝：改字节是 drift，清单外文件是 extra，缺文件是 missing；marketplace 版本落后是 marketplace", async (t) => {
  const release = readReleaseVersion(process.cwd());
  const marketplaceRoot = marketplaceFixture(t, release.version);

  const committed = await committedFixture(t);
  appendFileSync(path.join(committed, "codex-wakeflow", "README.md"), "\n<!-- edited -->\n");
  await rejects(check(marketplaceRoot), expectCheckErrorCode("wakeflow-artifact-check-drift"));

  await buildWakeflowPluginArtifacts(process.cwd(), { outputRoot: COMMITTED_RELATIVE });
  writeFileSync(path.join(committed, "claude-code-wakeflow", "extra.txt"), "stray\n");
  await rejects(check(marketplaceRoot), expectCheckErrorCode("wakeflow-artifact-check-extra"));

  await buildWakeflowPluginArtifacts(process.cwd(), { outputRoot: COMMITTED_RELATIVE });
  unlinkSync(path.join(committed, "codex-wakeflow", "LICENSE"));
  await rejects(check(marketplaceRoot), expectCheckErrorCode("wakeflow-artifact-check-missing"));

  await buildWakeflowPluginArtifacts(process.cwd(), { outputRoot: COMMITTED_RELATIVE });
  await rejects(
    check(marketplaceFixture(t, "0.9.6")),
    expectCheckErrorCode("wakeflow-artifact-check-marketplace"),
  );
});

test("结构相等忽略键序但不忽略值、数组顺序或多余键", () => {
  equal(jsonStructurallyEqual({ a: 1, b: [1, { c: "x" }] }, { b: [1, { c: "x" }], a: 1 }), true);
  equal(jsonStructurallyEqual({ a: 1 }, { a: 1, b: 2 }), false);
  equal(jsonStructurallyEqual([1, 2], [2, 1]), false);
  equal(jsonStructurallyEqual({ a: null }, { a: undefined }), false);
  equal(jsonStructurallyEqual("1", 1), false);
});
