import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = Object.freeze([
  Object.freeze({ hostId: "codex", root: "plugins/codex-wakeflow" }),
  Object.freeze({ hostId: "claude-code", root: "plugins/claude-code-wakeflow" }),
]);
const publicScripts = Object.freeze([
  "scripts/wakeflow-validate.mjs",
  "scripts/wakeflow-smoke.mjs",
  "scripts/wakeflow-setup.mjs",
  "scripts/wakeflow-cli.mjs",
]);
const removedCandidateFiles = Object.freeze([
  "lib/wakeflow-mcp-tools-v3-candidate.mjs",
  "schemas/wakeflow-config-v3.schema.json",
  "scripts/wakeflow-validate-v3-candidate.mjs",
  "scripts/wakeflow-smoke-v3-candidate.mjs",
  "scripts/wakeflow-setup-v3-candidate.mjs",
  "templates/wakeflow-template-bundle.json",
]);

function json(relative) {
  return JSON.parse(readFileSync(path.join(repositoryRoot, relative), "utf8"));
}

function spawnArtifact(artifactRoot, relative, { env = {}, nodeArgs = [] } = {}) {
  const cwd = path.join(repositoryRoot, artifactRoot);
  return spawnSync(process.execPath, [...nodeArgs, relative], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
    shell: false,
    timeout: 180_000,
  });
}

function run(artifactRoot, relative, { allowArtifactRoot = false, env = {} } = {}) {
  const result = spawnArtifact(artifactRoot, relative, { env });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stderr, "");
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true, result.stdout);
  if (!allowArtifactRoot) assert.equal(result.stdout.includes(repositoryRoot), false);
  assert.doesNotMatch(result.stdout, /v3-candidate|candidate-(?:smoke|validate)/u);
  return payload;
}

function createSmokeSandbox(label) {
  const root = mkdtempSync(path.join(os.tmpdir(), `wakeflow-${label}-`));
  const temp = path.join(root, "tmp");
  mkdirSync(temp);
  return { root, temp };
}

function tempEnvironment(temp, extra = {}) {
  return { TMPDIR: temp, TMP: temp, TEMP: temp, ...extra };
}

function dataImport(source) {
  return `data:text/javascript,${encodeURIComponent(source)}`;
}

function assertSmokeFailure(result, hostId, code, privateValues = []) {
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.equal(result.stderr, "");
  const payload = JSON.parse(result.stdout);
  assert.deepEqual(payload, { ok: false, hostId, error: { code } });
  for (const value of privateValues) assert.equal(result.stdout.includes(value), false);
  return payload;
}

test("T10 publishes only the normal v3 validation, smoke, setup, and CLI artifact gates", async () => {
  for (const relative of publicScripts) {
    assert.equal(existsSync(path.join(repositoryRoot, "core", relative)), true, `core/${relative}`);
  }
  for (const relative of removedCandidateFiles) {
    assert.equal(existsSync(path.join(repositoryRoot, "core", relative)), false, `core/${relative}`);
  }

  const rootPackage = json("package.json");
  assert.equal(rootPackage.scripts.validate, "npm --workspace wakeflow run validate");
  assert.equal(rootPackage.scripts["validate:claude"], "npm --workspace claude-code-wakeflow run validate");
  assert.equal(rootPackage.scripts.smoke, "npm --workspace wakeflow run smoke");
  assert.equal(rootPackage.scripts["smoke:claude"], "npm --workspace claude-code-wakeflow run smoke");
  assert.equal(Object.keys(rootPackage.scripts).some((name) => name.includes("candidate")), false);

  for (const artifact of artifacts) {
    const manifest = json(`${artifact.root}/package.json`);
    assert.equal(manifest.scripts.validate, "node scripts/wakeflow-validate.mjs");
    assert.equal(manifest.scripts.smoke, "node scripts/wakeflow-smoke.mjs");
    assert.equal(Object.keys(manifest.scripts).some((name) => name.includes("candidate")), false);
    const coreManifest = json(`${artifact.root}/scripts/wakeflow-core-manifest.json`);
    for (const relative of publicScripts) {
      assert.equal(existsSync(path.join(repositoryRoot, artifact.root, relative)), true, `${artifact.root}/${relative}`);
      assert.equal(coreManifest.files.includes(relative), true, relative);
    }
    assert.equal(coreManifest.files.includes("lib/wakeflow-mcp-tools.mjs"), true);
    assert.equal(coreManifest.files.includes("scripts/lib/wakeflow-public-v3-runtime.mjs"), true);
    assert.equal(existsSync(path.join(repositoryRoot, artifact.root, "templates/wakeflow-asset-bundle.json")), true);
    for (const relative of removedCandidateFiles) {
      assert.equal(existsSync(path.join(repositoryRoot, artifact.root, relative)), false, `${artifact.root}/${relative}`);
      assert.equal(coreManifest.files.includes(relative), false, relative);
    }

    const validation = run(artifact.root, "scripts/wakeflow-validate.mjs", { allowArtifactRoot: true });
    assert.equal(Number.isSafeInteger(validation.checked.requiredFiles), true);
    assert.equal(validation.checked.requiredFiles > publicScripts.length, true);
    assert.equal(validation.checked.runtimeScripts, 4);
    assert.equal(validation.checked.skills, 6);
    const sandbox = createSmokeSandbox(`${artifact.hostId}-smoke-gate`);
    const forbiddenGitDir = path.join(sandbox.root, "outside.git");
    try {
      const smoke = run(artifact.root, "scripts/wakeflow-smoke.mjs", {
        env: tempEnvironment(sandbox.temp, { GIT_DIR: forbiddenGitDir }),
      });
      assert.equal(smoke.hostId, artifact.hostId);
      assert.deepEqual(smoke.checked, {
        freshApply: true,
        previewZeroWrite: true,
        productZeroWrite: true,
        reconcileNoOp: true,
        targetTree: true,
        verificationGates: 15,
      });
      assert.equal(existsSync(forbiddenGitDir), false, "smoke must not honor an inherited GIT_DIR");
      assert.deepEqual(readdirSync(sandbox.temp), [], "successful smoke must remove its disposable root");
    } finally {
      rmSync(sandbox.root, { recursive: true, force: true });
    }
  }

  const owner = await import("../core/scripts/lib/wakeflow-host-settings-assets-owner.mjs");
  assert.equal(typeof owner.loadWakeflowHostSettingsAssetsAdapter, "function");
});

test("T10 smoke includes Git metadata in preview zero-write evidence", () => {
  const sandbox = createSmokeSandbox("git-metadata-evidence");
  const preload = dataImport(`
    import childProcess from "node:child_process";
    import fs from "node:fs";
    import path from "node:path";
    import { syncBuiltinESMExports } from "node:module";
    const original = childProcess.spawnSync;
    childProcess.spawnSync = (...args) => {
      const result = original(...args);
      try {
        const request = JSON.parse(args[2]?.input ?? "null");
        if (request?.action === "fresh-initialize" && request?.mode === "preview") {
          fs.appendFileSync(path.join(request.root, ".git", "description"), "preview mutation\\n");
        }
      } catch {}
      return result;
    };
    syncBuiltinESMExports();
  `);
  try {
    const result = spawnArtifact("plugins/codex-wakeflow", "scripts/wakeflow-smoke.mjs", {
      env: tempEnvironment(sandbox.temp),
      nodeArgs: ["--import", preload],
    });
    assertSmokeFailure(result, "codex", "fresh-preview-wrote", [sandbox.root]);
    assert.deepEqual(readdirSync(sandbox.temp), []);
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true });
  }
});

test("T10 smoke rejects private sibling-ledger paths in parsed setup output", () => {
  const sandbox = createSmokeSandbox("private-setup-output");
  const preload = dataImport(`
    import childProcess from "node:child_process";
    import path from "node:path";
    import { syncBuiltinESMExports } from "node:module";
    const original = childProcess.spawnSync;
    childProcess.spawnSync = (...args) => {
      const result = original(...args);
      try {
        const request = JSON.parse(args[2]?.input ?? "null");
        if (request?.action === "fresh-initialize" && request?.mode === "preview" && result.status === 0) {
          const payload = JSON.parse(result.stdout);
          payload.injectedLedgerPath = path.resolve(request.root, "../wakeflow-ledger");
          result.stdout = JSON.stringify(payload);
        }
      } catch {}
      return result;
    };
    syncBuiltinESMExports();
  `);
  try {
    const result = spawnArtifact("plugins/codex-wakeflow", "scripts/wakeflow-smoke.mjs", {
      env: tempEnvironment(sandbox.temp),
      nodeArgs: ["--import", preload],
    });
    assertSmokeFailure(result, "codex", "public-output-private-path", [sandbox.root]);
    assert.deepEqual(readdirSync(sandbox.temp), []);
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true });
  }
});

test("T10 smoke keeps temporary-root creation and cleanup failures structured", async (t) => {
  await t.test("creation failure", () => {
    const sandbox = createSmokeSandbox("temp-creation-failure");
    const missingTemp = path.join(sandbox.root, "missing");
    try {
      const result = spawnArtifact("plugins/codex-wakeflow", "scripts/wakeflow-smoke.mjs", {
        env: tempEnvironment(missingTemp),
      });
      assertSmokeFailure(result, "codex", "public-smoke-failed", [missingTemp]);
    } finally {
      rmSync(sandbox.root, { recursive: true, force: true });
    }
  });

  await t.test("cleanup failure", () => {
    const sandbox = createSmokeSandbox("temp-cleanup-failure");
    const privatePath = "/private/wakeflow-cleanup-path";
    const preload = dataImport(`
      import fs from "node:fs";
      import { syncBuiltinESMExports } from "node:module";
      fs.rmSync = () => {
        const error = new Error(${JSON.stringify(privatePath)});
        error.code = "PRIVATE_CLEANUP_CODE";
        throw error;
      };
      syncBuiltinESMExports();
    `);
    try {
      const result = spawnArtifact("plugins/codex-wakeflow", "scripts/wakeflow-smoke.mjs", {
        env: tempEnvironment(sandbox.temp),
        nodeArgs: ["--import", preload],
      });
      assertSmokeFailure(result, "codex", "public-smoke-cleanup-failed", [privatePath, sandbox.root]);
      assert.equal(readdirSync(sandbox.temp).length, 1, "injected cleanup failure must leave evidence for the parent test to remove");
    } finally {
      rmSync(sandbox.root, { recursive: true, force: true });
    }
  });
});
