import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { canonicalJson } from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import {
  parseWakeflowConfigV3,
  serializeWakeflowConfigV3,
} from "../core/scripts/lib/wakeflow-config-v3.mjs";
import { hostProfile } from "../core/scripts/lib/wakeflow-host-profile.mjs";
import {
  inspectWakeflowObservabilityV3,
  projectWakeflowConfigView,
  projectWakeflowStatus,
  projectWakeflowStorageView,
  verifyWakeflowWorkspaceV3,
} from "../core/scripts/lib/wakeflow-observability-v3.mjs";
import { parseWakeflowAssetBundle } from "../core/scripts/lib/wakeflow-template-renderer.mjs";
import { buildWakeflowAssetBundle } from "../tools/build-asset-bundle.mjs";
import { hostProfile as claudeHostProfile } from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-host-profile.mjs";
import {
  wakeflowHostSettingsAssetsAdapter,
} from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-settings.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundle = parseWakeflowAssetBundle(buildWakeflowAssetBundle({
  sourceRoot: path.join(repositoryRoot, "core/template-sources"),
}));
const fixture = JSON.parse(readFileSync(
  path.join(repositoryRoot, "test/fixtures/wakeflow-config-v3/valid-minimal.json"),
  "utf8",
));

function workspace(t) {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-observability-v3-"));
  const workspaceRoot = path.join(fixtureRoot, "Program");
  mkdirSync(workspaceRoot, { mode: 0o700 });
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  return workspaceRoot;
}

function statTuple(file) {
  const stat = lstatSync(file, { bigint: true });
  return {
    type: stat.isSymbolicLink()
      ? "symlink"
      : stat.isDirectory()
        ? "directory"
        : stat.isFile()
          ? "file"
          : "other",
    mode: Number(stat.mode & 0o777n),
    size: String(stat.size),
    mtimeNs: String(stat.mtimeNs),
    ctimeNs: String(stat.ctimeNs),
  };
}

function snapshotTree(root) {
  const result = {};
  function visit(current, ref) {
    result[ref || "."] = statTuple(current);
    if (result[ref || "."].type !== "directory") return;
    for (const name of readdirSync(current).sort()) {
      visit(path.join(current, name), ref ? `${ref}/${name}` : name);
    }
  }
  visit(root, "");
  return result;
}

function observationInput(workspaceRoot) {
  return {
    workspaceRoot,
    hostProfile,
    bundle,
    language: "zh",
    hostSettingsAssetsAdapter: null,
  };
}

function projections(observation) {
  return {
    config: projectWakeflowConfigView({ observation }),
    storage: projectWakeflowStorageView({ observation }),
    status: projectWakeflowStatus({ observation }),
    verification: verifyWakeflowWorkspaceV3({ observation }),
  };
}

function assertPrivateDataAbsent(value, workspaceRoot, extra = []) {
  const encoded = canonicalJson(value);
  assert.equal(encoded.includes(workspaceRoot), false);
  for (const secret of extra) assert.equal(encoded.includes(secret), false, secret);
  assert.doesNotMatch(encoded, /(?:"pid"|"socket"|"rawHandle"|"prompt"|"argv")\s*:/iu);
}

test("T08 observability reports uninitialized, legacy, and invalid config without fallback or writes", (t) => {
  const workspaceRoot = workspace(t);

  let before = snapshotTree(workspaceRoot);
  let observation = inspectWakeflowObservabilityV3(observationInput(workspaceRoot));
  let result = projections(observation);
  assert.equal(result.config.status, "uninitialized");
  assert.equal(result.storage.status, "unavailable");
  assert.equal(result.status.overall, "uninitialized");
  assert.equal(result.verification.ok, false);
  assert.deepEqual(snapshotTree(workspaceRoot), before);
  assertPrivateDataAbsent({ observation, result }, workspaceRoot);

  const configFile = path.join(workspaceRoot, "wakeflow.config.json");
  writeFileSync(configFile, '{"schemaVersion":2,"workspaceName":"legacy-secret-name"}\n', { mode: 0o644 });
  chmodSync(configFile, 0o644);
  before = snapshotTree(workspaceRoot);
  observation = inspectWakeflowObservabilityV3(observationInput(workspaceRoot));
  result = projections(observation);
  assert.equal(result.config.status, "migration-required");
  assert.equal(result.config.migration.sourceSchemaVersion, 2);
  assert.match(result.config.sourceDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(result.status.overall, "migration-required");
  assert.equal(result.verification.ok, false);
  assert.deepEqual(snapshotTree(workspaceRoot), before);
  assertPrivateDataAbsent({ observation, result }, workspaceRoot, ["legacy-secret-name"]);

  writeFileSync(configFile, '{"kind":"WakeflowConfig","schemaVersion":3,"secret":"never-return-me"}\n', { mode: 0o644 });
  chmodSync(configFile, 0o644);
  before = snapshotTree(workspaceRoot);
  observation = inspectWakeflowObservabilityV3(observationInput(workspaceRoot));
  result = projections(observation);
  assert.equal(result.config.status, "invalid");
  assert.match(result.config.sourceDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(result.config.diagnostics.length > 0, true);
  assert.equal(result.status.overall, "degraded");
  assert.equal(result.verification.ok, false);
  assert.deepEqual(snapshotTree(workspaceRoot), before);
  assertPrivateDataAbsent({ observation, result }, workspaceRoot, ["never-return-me"]);
});

test("T08 valid projections are deterministic, bounded, private, read-only, and issued-only", (t) => {
  const workspaceRoot = workspace(t);
  const secretSocket = "private-socket-never-return-me";
  const candidate = structuredClone(fixture);
  candidate.hosts["claude-code"] = {
    tmux: {
      sessionName: "private-session-never-return-me",
      socketName: secretSocket,
    },
  };
  const model = parseWakeflowConfigV3(candidate);
  writeFileSync(
    path.join(workspaceRoot, "wakeflow.config.json"),
    serializeWakeflowConfigV3(model),
    { mode: 0o644 },
  );
  chmodSync(path.join(workspaceRoot, "wakeflow.config.json"), 0o644);
  const productRoot = path.resolve(workspaceRoot, model.topology.repositories[0].path);
  mkdirSync(productRoot, { recursive: true, mode: 0o700 });
  // 文件存在不是产品宿主面授权；observability 没有维护请求里的显式授权集合。
  writeFileSync(path.join(productRoot, ".gitignore"), "user-owned\n", { mode: 0o644 });
  execFileSync("git", ["init", "-q"], { cwd: productRoot, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Wakeflow Test"], { cwd: productRoot });
  execFileSync("git", ["config", "user.email", "wakeflow-test@example.invalid"], { cwd: productRoot });
  execFileSync("git", ["config", "commit.gpgSign", "false"], { cwd: productRoot });
  execFileSync("git", ["add", ".gitignore"], { cwd: productRoot });
  execFileSync("git", ["commit", "-q", "-m", "fixture"], { cwd: productRoot, stdio: "ignore" });
  const privateProductFilename = "private-product-change-never-return-me.txt";
  writeFileSync(path.join(productRoot, privateProductFilename), "uncommitted\n", { mode: 0o644 });

  const before = snapshotTree(workspaceRoot);
  const first = inspectWakeflowObservabilityV3(observationInput(workspaceRoot));
  const firstResult = projections(first);
  const second = inspectWakeflowObservabilityV3(observationInput(workspaceRoot));
  const secondResult = projections(second);

  assert.deepEqual(secondResult, firstResult);
  assert.equal(second.observationDigest, first.observationDigest);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(firstResult.config), true);
  assert.equal(Object.isFrozen(firstResult.storage), true);
  assert.equal(Object.isFrozen(firstResult.status), true);
  assert.equal(Object.isFrozen(firstResult.verification), true);
  assert.equal(firstResult.config.status, "valid");
  assert.equal(firstResult.config.program.programId, model.program.programId);
  assert.equal(firstResult.config.topology.repositories.length, model.topology.repositories.length);
  assert.equal(firstResult.config.topology.windows.length, model.topology.windows.length);
  assert.equal(firstResult.config.fixedProtocolRoots.includes(".wakeflow-local"), true);
  assert.equal(firstResult.storage.status, "observed");
  assert.equal(firstResult.storage.items.length > 0, true);
  assert.equal(firstResult.storage.forbiddenConclusions.includes(
    "storage-health-authorizes-repair-or-deletion",
  ), true);
  assert.equal(firstResult.status.overall, "blocked");
  const repositoryStatus = firstResult.status.domains.repositories.items[0];
  assert.equal(repositoryStatus.git.status, "dirty");
  assert.equal(repositoryStatus.git.dirty, true);
  assert.equal(repositoryStatus.git.changeRecordCount, 1);
  assert.equal(repositoryStatus.git.upstreamStatus, "none");
  assert.equal(firstResult.status.nextActions.some((entry) => (
    entry.reason === "repository-git-dirty"
    && entry.subject?.value === model.topology.repositories[0].repositoryId
  )), true);
  assert.equal(firstResult.verification.ok, false);
  assert.equal(firstResult.verification.gates.length > 0, true);
  assert.deepEqual(snapshotTree(workspaceRoot), before);
  assertPrivateDataAbsent({ first, firstResult }, workspaceRoot, [
    secretSocket,
    "private-session-never-return-me",
    privateProductFilename,
  ]);

  const claudeObservation = inspectWakeflowObservabilityV3({
    workspaceRoot,
    hostProfile: claudeHostProfile,
    bundle,
    language: "zh",
    hostSettingsAssetsAdapter: wakeflowHostSettingsAssetsAdapter,
  });
  const claudeResult = projections(claudeObservation);
  assert.equal(claudeResult.config.runtimeProfile.hostId, "claude-code");
  assert.equal(claudeResult.storage.hostId, "claude-code");
  assert.equal(claudeResult.status.overall, "blocked");
  assert.equal(claudeResult.verification.ok, false);
  const storageItems = new Map(claudeResult.storage.items.map((entry) => [entry.key, entry]));
  // mixed-owned 只改变 Wakeflow 的编辑边界，不改变 tracked 文件的公开敏感度。
  for (const key of ["workspace.gitignore", "workspace.settings.portable"]) {
    assert.equal(storageItems.get(key)?.sensitivity, "public", `${key} sensitivity`);
  }
  // archive journal、sidecar 与 tombstone 都只能由 archive owner 处理；storage
  // projection 不得把它们说成 demand-create 或 generic reconcile 表面。
  for (const key of [
    "event.demand.transaction.archive",
    "event.demand.archive.intent",
    "event.demand.archive.tombstone",
  ]) {
    assert.deepEqual(
      {
        owner: storageItems.get(key)?.owner,
        class: storageItems.get(key)?.class,
        createTrigger: storageItems.get(key)?.createTrigger,
        lifecycle: storageItems.get(key)?.lifecycle,
        ownerAction: storageItems.get(key)?.ownerAction,
      },
      {
        owner: "archive-service",
        class: "operation",
        createTrigger: "archive",
        lifecycle: "explicit-release",
        ownerAction: "inspect-owner-operation",
      },
      `${key} archive semantics`,
    );
  }
  for (const key of [
    "event.maintenance.lock-publisher-stage",
    "event.maintenance.publisher-stage",
    "event.maintenance.transaction-stage",
    "event.demand.publication.stage",
    "event.demand.evidence.stage",
  ]) {
    assert.deepEqual(
      {
        class: storageItems.get(key)?.class,
        lifecycle: storageItems.get(key)?.lifecycle,
        ownerAction: storageItems.get(key)?.ownerAction,
      },
      {
        class: "operation",
        lifecycle: "explicit-release",
        ownerAction: "inspect-owner-operation",
      },
      `${key} transaction residue semantics`,
    );
  }
  assert.equal(storageItems.get("event.coordination.window-lease")?.class, "operation");
  assert.equal(storageItems.get("event.coordination.window-lease")?.createTrigger, "delivery-admission");
  assert.equal(storageItems.get("event.demand.controller-events")?.lifecycle, "append-only");
  assert.equal(storageItems.get("event.demand.task-package")?.lifecycle, "immutable");
  const productGitignore = storageItems.get(`repository.${model.topology.repositories[0].repositoryId}.gitignore`);
  assert.equal(productGitignore?.applicability.status, "not-applicable");
  assert.deepEqual(productGitignore?.actual, { state: "not-applicable" });
  assert.equal(productGitignore?.health, "not-applicable");
  assert.deepEqual(snapshotTree(workspaceRoot), before);
  assertPrivateDataAbsent({ claudeObservation, claudeResult }, workspaceRoot, [
    secretSocket,
    "private-session-never-return-me",
    privateProductFilename,
  ]);

  const forged = structuredClone(first);
  for (const project of [
    projectWakeflowConfigView,
    projectWakeflowStorageView,
    projectWakeflowStatus,
    verifyWakeflowWorkspaceV3,
  ]) {
    assert.throws(() => project({ observation: forged }), /observation|authority|issued/iu);
  }
});

test("T10 observability requires the exact settings/assets adapter applicability for its host", (t) => {
  const workspaceRoot = workspace(t);
  assert.throws(
    () => inspectWakeflowObservabilityV3({
      workspaceRoot,
      hostProfile,
      bundle,
      language: "zh",
      hostSettingsAssetsAdapter: wakeflowHostSettingsAssetsAdapter,
    }),
    /adapter|applicab|host/iu,
  );
  assert.throws(
    () => inspectWakeflowObservabilityV3({
      workspaceRoot,
      hostProfile: claudeHostProfile,
      bundle,
      language: "zh",
      hostSettingsAssetsAdapter: null,
    }),
    /adapter|applicab|host/iu,
  );
  const observation = inspectWakeflowObservabilityV3({
    workspaceRoot,
    hostProfile: claudeHostProfile,
    bundle,
    language: "zh",
    hostSettingsAssetsAdapter: wakeflowHostSettingsAssetsAdapter,
  });
  assert.equal(projectWakeflowConfigView({ observation }).status, "uninitialized");
});

test("T08 observability has no retired reader or writer dependency", () => {
  const moduleName = "wakeflow-observability-v3.mjs";
  const candidateSource = readFileSync(
    path.join(repositoryRoot, "core/scripts/lib", moduleName),
    "utf8",
  );
  assert.doesNotMatch(
    candidateSource,
    /wakeflow-(?:storage-map|storage|status|verify|check-layout|cli|setup)\.mjs/u,
  );
  for (const relative of [
    "core/scripts/lib/wakeflow-storage-map.mjs",
    "core/scripts/wakeflow-check-layout.mjs",
    "core/scripts/wakeflow-storage.mjs",
    "core/scripts/wakeflow-verify.mjs",
  ]) {
    assert.equal(existsSync(path.join(repositoryRoot, relative)), false, relative);
  }
});
