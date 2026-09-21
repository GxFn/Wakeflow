import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { expectedClaudeMarketplaceEntry } from "../../tooling/artifacts/plugin-metadata.js";
import { checkWakeflowReleaseConsistency } from "../../tooling/release/check-release-consistency.js";

/**
 * 场景 `card-10/release-consistency`（能力卡 10 Q5–Q7）：五源一致、新序列、Node 24 引擎、
 * 清单可发布、main、干净树、标签在 HEAD、本地 origin/main 与 HEAD 同一提交。它不经 MCP，
 * 所以以 tooling 测试形式接线：在一次性 Git 仓库里摆出五个版本源，逐道门制造不一致。
 */

const VERSION = "1.0.0";
const ENGINES = ">=24.19.0 <25";
const ALL_GATES = Object.freeze({
  requireMain: true,
  requireClean: true,
  requireTag: true,
  requireRemote: true,
  nodeVersion: "24.19.0",
});

interface FixtureOverrides {
  readonly releaseVersion?: string;
  readonly codexPackageVersion?: string;
  readonly claudeManifestVersion?: string;
  readonly marketplaceVersion?: string;
  readonly pluginEngines?: string;
  readonly releaseEligible?: boolean;
  /** 清单里额外列出、但不写进磁盘也不进 Git 的路径。 */
  readonly untrackedManifestPath?: string;
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function git(root: string, ...args: readonly string[]): string {
  const result = spawnSync(
    "git",
    ["-c", "user.name=wakeflow", "-c", "user.email=wakeflow@example.invalid", ...args],
    {
      cwd: root,
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
      shell: false,
      windowsHide: true,
      timeout: 30_000,
    },
  );
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

function writeSources(root: string, overrides: FixtureOverrides): void {
  const version = overrides.releaseVersion ?? VERSION;
  const engines = overrides.pluginEngines ?? ENGINES;
  mkdirSync(path.join(root, "assets", "release"), { recursive: true });
  writeFileSync(
    path.join(root, "assets", "release", "version.json"),
    json({ kind: "WakeflowReleaseVersion", schemaVersion: 1, version }),
  );
  writeFileSync(
    path.join(root, "package.json"),
    json({ name: "wakeflow-repo", version: "0.0.0", engines: { node: ENGINES } }),
  );
  for (const [directory, manifestDirectory, packageVersion, manifestVersion] of [
    ["codex-wakeflow", ".codex-plugin", overrides.codexPackageVersion ?? version, version],
    ["claude-code-wakeflow", ".claude-plugin", version, overrides.claudeManifestVersion ?? version],
  ] as const) {
    const pluginRoot = path.join(root, "plugins", directory);
    mkdirSync(path.join(pluginRoot, manifestDirectory), { recursive: true });
    writeFileSync(
      path.join(pluginRoot, "package.json"),
      json({ name: directory, version: packageVersion, engines: { node: engines } }),
    );
    writeFileSync(
      path.join(pluginRoot, manifestDirectory, "plugin.json"),
      json({ name: "wakeflow", version: manifestVersion }),
    );
    writeFileSync(
      path.join(pluginRoot, "artifact-manifest.json"),
      json({
        kind: "WakeflowPluginArtifactManifest",
        schemaVersion: 1,
        version,
        releaseEligible: overrides.releaseEligible ?? true,
        files:
          overrides.untrackedManifestPath === undefined
            ? []
            : [
                {
                  path: overrides.untrackedManifestPath,
                  bytes: 0,
                  sha256: "sha256:0",
                  mode: "0644",
                },
              ],
      }),
    );
  }
  mkdirSync(path.join(root, ".claude-plugin"), { recursive: true });
  writeFileSync(
    path.join(root, ".claude-plugin", "marketplace.json"),
    json({
      name: "gxfn",
      plugins: [expectedClaudeMarketplaceEntry(overrides.marketplaceVersion ?? version)],
    }),
  );
}

/** 一次性 Git 仓库：五个版本源、一次提交、标签在 HEAD、本地 origin/main 指向 HEAD。 */
function repositoryFixture(t: TestContext, overrides: FixtureOverrides = {}): string {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-release-check-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeSources(root, overrides);
  git(root, "init", "--quiet", "--initial-branch=main");
  git(root, "add", "--all");
  git(root, "commit", "--quiet", "--message", "release fixture");
  git(root, "tag", `v${overrides.releaseVersion ?? VERSION}`);
  git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
  return root;
}

function expectReleaseErrorCode(code: string): (error: unknown) => true {
  return (error: unknown): true => {
    ok(error instanceof Error, "抛出的必须是 Error");
    equal(error.name, "ReleaseCheckError");
    equal((error as { readonly code?: unknown }).code, code);
    return true;
  };
}

test("五源一致、新序列、引擎与清单合格、标签在 HEAD、本地远端同步的 main 干净树通过全部门", (t) => {
  const root = repositoryFixture(t);
  const result = checkWakeflowReleaseConsistency(root, ALL_GATES);
  equal(result.version, VERSION);
  deepEqual(
    result.sources.map((source) => source.label),
    [
      "codex package",
      "codex plugin manifest",
      "claude package",
      "claude plugin manifest",
      "claude marketplace",
    ],
  );
  ok(result.sources.every((source) => source.version === VERSION));
  equal(result.enginesNode, ENGINES);
  equal(result.git.branch, "main");
  equal(result.git.clean, true);
  equal(result.git.tag, `v${VERSION}`);
  equal(result.git.remote, git(root, "rev-parse", "HEAD").trim());
});

test("任一版本源漂移、主版本号为 0、引擎不一致、运行时不在范围、清单不可发布，各以稳定错误码拒绝", (t) => {
  throws(
    () => checkWakeflowReleaseConsistency(repositoryFixture(t, { codexPackageVersion: "1.0.1" })),
    expectReleaseErrorCode("wakeflow-release-version-drift"),
  );
  throws(
    () => checkWakeflowReleaseConsistency(repositoryFixture(t, { claudeManifestVersion: "1.0.1" })),
    expectReleaseErrorCode("wakeflow-release-version-drift"),
  );
  throws(
    () => checkWakeflowReleaseConsistency(repositoryFixture(t, { marketplaceVersion: "0.9.6" })),
    expectReleaseErrorCode("wakeflow-release-version-drift"),
  );
  throws(
    () => checkWakeflowReleaseConsistency(repositoryFixture(t, { releaseVersion: "0.9.7" })),
    expectReleaseErrorCode("wakeflow-release-series"),
  );
  throws(
    () => checkWakeflowReleaseConsistency(repositoryFixture(t, { pluginEngines: ">=20" })),
    expectReleaseErrorCode("wakeflow-release-engines"),
  );
  throws(
    () => checkWakeflowReleaseConsistency(repositoryFixture(t), { nodeVersion: "22.12.0" }),
    expectReleaseErrorCode("wakeflow-release-node"),
  );
  throws(
    () => checkWakeflowReleaseConsistency(repositoryFixture(t), { nodeVersion: "25.0.0" }),
    expectReleaseErrorCode("wakeflow-release-node"),
  );
  throws(
    () => checkWakeflowReleaseConsistency(repositoryFixture(t, { releaseEligible: false })),
    expectReleaseErrorCode("wakeflow-release-manifest"),
  );
  // 清单列出的路径没进 Git（被忽略或忘了 add）：干净树证明不了这一点，所以单独一道门。
  throws(
    () =>
      checkWakeflowReleaseConsistency(
        repositoryFixture(t, { untrackedManifestPath: "node_modules/ghost/dist/index.js" }),
      ),
    expectReleaseErrorCode("wakeflow-release-untracked"),
  );
});

test("Git 门各自独立：非 main 分支、脏树、标签不在 HEAD、本地 origin/main 落后各以稳定错误码拒绝", (t) => {
  const onBranch = repositoryFixture(t);
  git(onBranch, "checkout", "--quiet", "-b", "release-candidate");
  throws(
    () => checkWakeflowReleaseConsistency(onBranch, { requireMain: true }),
    expectReleaseErrorCode("wakeflow-release-branch"),
  );
  checkWakeflowReleaseConsistency(onBranch, {
    requireClean: true,
    requireTag: true,
    requireRemote: true,
  });

  const dirty = repositoryFixture(t);
  writeFileSync(path.join(dirty, "stray.txt"), "untracked\n");
  throws(
    () => checkWakeflowReleaseConsistency(dirty, { requireClean: true }),
    expectReleaseErrorCode("wakeflow-release-dirty"),
  );

  const untagged = repositoryFixture(t);
  git(untagged, "tag", "--delete", `v${VERSION}`);
  throws(
    () => checkWakeflowReleaseConsistency(untagged, { requireTag: true }),
    expectReleaseErrorCode("wakeflow-release-tag"),
  );

  const behind = repositoryFixture(t);
  writeFileSync(path.join(behind, "CHANGES.md"), "second commit\n");
  git(behind, "add", "--all");
  git(behind, "commit", "--quiet", "--message", "second");
  throws(
    () => checkWakeflowReleaseConsistency(behind, { requireRemote: true }),
    expectReleaseErrorCode("wakeflow-release-remote"),
  );
  git(behind, "update-ref", "refs/remotes/origin/main", "HEAD");
  git(behind, "tag", "--force", `v${VERSION}`, "HEAD");
  checkWakeflowReleaseConsistency(behind, ALL_GATES);
});
