import { deepEqual, equal, ok, throws } from "node:assert/strict";
import {
  appendFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test, type TestContext } from "node:test";

import { buildWakeflowPluginArtifacts } from "../../tooling/artifacts/build-plugin-artifacts.js";
import {
  checkMarketplaces,
  checkWakeflowPluginArtifacts,
  CLAUDE_MARKETPLACE_PATH,
  CODEX_MARKETPLACE_PATH,
  jsonStructurallyEqual,
  verifyArtifactAgainstManifest,
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

/** 一份"已提交"的制品：用构建器写到 `.build/` 下的一个根，模拟 `plugins/`；本文件只构建一次。 */
let committedBuild: Promise<string> | undefined;
function committedFixture(): Promise<string> {
  committedBuild ??= buildWakeflowPluginArtifacts(process.cwd(), {
    outputRoot: COMMITTED_RELATIVE,
  }).then(() => path.join(process.cwd(), COMMITTED_RELATIVE));
  return committedBuild;
}

after(() => {
  removeBuildDirectory(COMMITTED_RELATIVE);
  removeBuildDirectory(CANDIDATE_RELATIVE);
});

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

test("committed 制品与源码重建逐字节一致、marketplace 条目与元数据结构相等时校验通过（D2、D6）", async (t) => {
  await committedFixture();
  const release = readReleaseVersion(process.cwd());
  const result = await checkWakeflowPluginArtifacts(process.cwd(), {
    committedRoot: COMMITTED_RELATIVE,
    candidateRoot: CANDIDATE_RELATIVE,
    marketplaceRoot: marketplaceFixture(t, release.version),
  });
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

test("committed 制品的任何手工改动都被清单核对拒绝：改字节是 drift，清单外文件是 extra，缺文件是 missing；每种改动复原后再次通过", async () => {
  const committed = await committedFixture();
  const codex = path.join(committed, "codex-wakeflow");
  const claude = path.join(committed, "claude-code-wakeflow");
  const readme = path.join(codex, "README.md");
  const license = path.join(codex, "LICENSE");
  const originalReadme = readFileSync(readme);
  const originalLicense = readFileSync(license);

  appendFileSync(readme, "\n<!-- edited -->\n");
  throws(
    () => verifyArtifactAgainstManifest(codex),
    expectCheckErrorCode("wakeflow-artifact-check-drift"),
  );
  writeFileSync(readme, originalReadme);
  verifyArtifactAgainstManifest(codex);

  const stray = path.join(claude, "extra.txt");
  writeFileSync(stray, "stray\n");
  throws(
    () => verifyArtifactAgainstManifest(claude),
    expectCheckErrorCode("wakeflow-artifact-check-extra"),
  );
  unlinkSync(stray);
  verifyArtifactAgainstManifest(claude);

  unlinkSync(license);
  throws(
    () => verifyArtifactAgainstManifest(codex),
    expectCheckErrorCode("wakeflow-artifact-check-missing"),
  );
  writeFileSync(license, originalLicense, { mode: 0o644 });
  verifyArtifactAgainstManifest(codex);
});

test("marketplace 条目落后于版本输入、缺席或不止一条时以 marketplace 错误码拒绝", (t) => {
  const release = readReleaseVersion(process.cwd());
  checkMarketplaces(marketplaceFixture(t, release.version), release.version);
  throws(
    () => checkMarketplaces(marketplaceFixture(t, "0.9.6"), release.version),
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
