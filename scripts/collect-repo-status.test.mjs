#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const workspaceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const collectScript = path.join(workspaceRoot, "scripts/collect-repo-status.mjs");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    ...options,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}

test("porcelain status preserves leading-space unstaged markers", () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "control-workspace-status-"));
  const repoPath = path.join(fixtureRoot, "SampleRepo");

  run("git", ["init", "SampleRepo"], { cwd: fixtureRoot });
  run("git", ["config", "user.email", "codex@example.invalid"], { cwd: repoPath });
  run("git", ["config", "user.name", "Codex"], { cwd: repoPath });

  writeFileSync(path.join(repoPath, "tracked.txt"), "one\n");
  run("git", ["add", "tracked.txt"], { cwd: repoPath });
  run("git", ["commit", "-m", "initial"], { cwd: repoPath });

  writeFileSync(path.join(repoPath, "tracked.txt"), "two\n");
  writeFileSync(path.join(repoPath, "untracked.txt"), "new\n");
  writeFileSync(
    path.join(fixtureRoot, "workspace.config.json"),
    JSON.stringify({
      workspaceName: "FixtureWorkspace",
      allowMissingRepos: false,
      repoNames: ["SampleRepo"],
      repositories: [
        {
          windowName: "SampleRepo",
          path: "SampleRepo",
          role: "Fixture repository",
        },
      ],
    }),
  );

  const result = run("node", [collectScript, "--json"], { cwd: fixtureRoot });
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.repos.length, 1);
  assert.equal(payload.repos[0].staged, 0);
  assert.equal(payload.repos[0].unstaged, 1);
  assert.equal(payload.repos[0].untracked, 1);

  run("git", ["add", "tracked.txt"], { cwd: repoPath });
  const stagedResult = run("node", [collectScript, "--json"], { cwd: fixtureRoot });
  const stagedPayload = JSON.parse(stagedResult.stdout);
  assert.equal(stagedPayload.repos[0].staged, 1);
  assert.equal(stagedPayload.repos[0].unstaged, 0);
  assert.equal(stagedPayload.repos[0].untracked, 1);
});
