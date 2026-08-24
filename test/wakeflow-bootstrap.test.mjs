import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { hostProfile as codexHostProfile } from "../plugins/codex-wakeflow/scripts/lib/wakeflow-host-profile.mjs";
import { hostProfile as claudeHostProfile } from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-host-profile.mjs";
import {
  WAKEFLOW_BOOTSTRAP_ACTION,
  WAKEFLOW_BOOTSTRAP_MODES,
  WAKEFLOW_BOOTSTRAP_SCHEMA_VERSION,
  WAKEFLOW_BOOTSTRAP_STDIN_LIMIT,
  WakeflowBootstrapError,
  parseWakeflowBootstrapArgv,
  parseWakeflowBootstrapRequest,
  runWakeflowBootstrap,
  runWakeflowBootstrapStdin,
} from "../core/scripts/wakeflow-bootstrap.mjs";
import {
  runWakeflowMigrationApply,
} from "../core/scripts/lib/wakeflow-migration-apply.mjs";
import {
  canonicalJsonDigest,
} from "../core/scripts/lib/wakeflow-canonical-json.mjs";
import {
  createWakeflowWorkspaceActivationSubjectDigest,
  hostActivationReportDigest,
} from "../core/scripts/lib/wakeflow-host-activation-gate.mjs";
import {
  createWakeflowProductionMigrationParticipant,
  restoreWakeflowProductionMigrationComposition,
} from "../core/scripts/lib/wakeflow-migration-production.mjs";
import {
  loadWakeflowAssetBundle,
} from "../core/scripts/lib/wakeflow-template-renderer.mjs";
import {
  createMigrationFixturePlan,
} from "./support/wakeflow-migration-v3-fixture.mjs";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "..");
const LEGACY_CONFIG = path.join(
  REPOSITORY_ROOT,
  "test/fixtures/legacy-origins/codex-0.9.6-70d79d72/static/shared-setup/WakeflowFixture/wakeflow.config.json",
);
const HOSTS = Object.freeze([
  Object.freeze({
    hostId: "codex",
    artifactRoot: path.join(REPOSITORY_ROOT, "plugins/codex-wakeflow"),
    hostProfile: codexHostProfile,
  }),
  Object.freeze({
    hostId: "claude-code",
    artifactRoot: path.join(REPOSITORY_ROOT, "plugins/claude-code-wakeflow"),
    hostProfile: claudeHostProfile,
  }),
]);

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function workspaceSnapshot(root) {
  const entries = [];
  const visit = (directory, prefix = "") => {
    for (const name of readdirSync(directory).sort()) {
      const absolute = path.join(directory, name);
      const ref = prefix ? `${prefix}/${name}` : name;
      const stat = lstatSync(absolute);
      if (stat.isDirectory()) {
        entries.push({ ref, type: "directory", mode: stat.mode & 0o777 });
        visit(absolute, ref);
      } else {
        entries.push({ ref, type: "file", mode: stat.mode & 0o777, digest: sha256(readFileSync(absolute)) });
      }
    }
  };
  visit(root);
  return entries;
}

function migrationFixture(t, host) {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), `wakeflow-bootstrap-${host.hostId}-`)));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const workspaceRoot = path.join(base, "WakeflowFixture");
  const productRoot = path.join(base, "ProductWorkspace");
  mkdirSync(workspaceRoot, { mode: 0o755 });
  mkdirSync(productRoot, { mode: 0o755 });
  copyFileSync(LEGACY_CONFIG, path.join(workspaceRoot, "wakeflow.config.json"));
  const migrationPlan = createMigrationFixturePlan({
    bootstrapArtifactRoot: host.artifactRoot,
    hostProfile: host.hostProfile,
    legacyOwnerArtifactRoot: host.artifactRoot,
    workspaceRoot,
  });
  return { migrationPlan, productRoot, workspaceRoot };
}

function previewRequest(workspaceRoot, artifactRoot, migrationPlan) {
  return {
    schemaVersion: WAKEFLOW_BOOTSTRAP_SCHEMA_VERSION,
    root: workspaceRoot,
    action: WAKEFLOW_BOOTSTRAP_ACTION,
    mode: "preview",
    artifactContext: { legacyOwnerRoot: artifactRoot },
    request: {
      desiredModel: migrationPlan.payload.target.desiredModel,
      identityMappings: migrationPlan.payload.identityMappings,
      rootMappings: migrationPlan.payload.rootMappings,
    },
  };
}

function invoke(host, request, argv = []) {
  return spawnSync(path.join(host.artifactRoot, "bin/wakeflow-bootstrap"), argv, {
    cwd: os.tmpdir(),
    encoding: "utf8",
    input: JSON.stringify(request),
    shell: false,
  });
}

function invokeRaw(host, input) {
  return spawnSync(path.join(host.artifactRoot, "bin/wakeflow-bootstrap"), [], {
    cwd: os.tmpdir(),
    encoding: "utf8",
    input,
    shell: false,
  });
}

function assertBlockedUnknownActivation(output, workspaceRoot, cutoverStatus) {
  const workspaceSubjectDigest = createWakeflowWorkspaceActivationSubjectDigest({
    workspaceRoot,
  });
  assert.equal(output.workspaceCutover.workspaceSubjectDigest, workspaceSubjectDigest);
  assert.equal(output.workspaceCutover.status, cutoverStatus);
  assert.equal(output.activationReport.hostId, output.hostId);
  assert.equal(output.activationReport.pluginId, "wakeflow@gxfn");
  assert.equal(output.activationReport.workspaceSubjectDigest, workspaceSubjectDigest);
  assert.deepEqual(output.activationReport.currentCutover, output.workspaceCutover);
  assert.equal(output.activationReport.scope, "unknown");
  assert.equal(output.activationReport.coverage.status, "required");
  assert.equal(output.activationReport.status, "blocked");
  assert.equal(output.activationReport.activationDisposition, "do-not-activate");
  assert.equal(output.activationReport.unattendedEligibility, "forbidden");
  assert.equal(
    output.activationReport.reasonCodes.includes("activation-scope-unknown"),
    true,
  );
  assert.equal(
    output.activationReport.reasonCodes.includes("unknown-scope-coverage-acknowledgement-required"),
    true,
  );
  assert.equal(
    output.activationReport.reasonCodes.includes("workspace-cutover-incomplete"),
    cutoverStatus !== "v3-ready",
  );
  assert.equal(
    output.activationReportDigest,
    hostActivationReportDigest(output.activationReport),
  );
}

test("M6-T08 bootstrap codec is zero-argv, bounded, and closed by mode", () => {
  assert.equal(WAKEFLOW_BOOTSTRAP_SCHEMA_VERSION, 1);
  assert.equal(WAKEFLOW_BOOTSTRAP_STDIN_LIMIT, 8 * 1024 * 1024);
  assert.equal(WAKEFLOW_BOOTSTRAP_ACTION, "explicit-migration");
  assert.deepEqual(WAKEFLOW_BOOTSTRAP_MODES, ["preview", "apply", "recover"]);
  assert.equal(typeof WakeflowBootstrapError, "function");
  assert.deepEqual(parseWakeflowBootstrapArgv([]), { requestStdin: true });
  assert.throws(
    () => parseWakeflowBootstrapArgv(["--root", "/private/workspace"]),
    (error) => error?.code === "wakeflow-bootstrap-invalid-argv",
  );
  assert.equal(typeof runWakeflowBootstrap, "function");
  assert.equal(typeof runWakeflowBootstrapStdin, "function");

  const decoratedArgv = [];
  Object.defineProperty(decoratedArgv, "hidden", { value: true });
  assert.throws(
    () => parseWakeflowBootstrapArgv(decoratedArgv),
    (error) => error?.code === "wakeflow-bootstrap-invalid-argv",
  );
});

test("bootstrap stdin preserves byte views, rejects coercive chunks, and snapshots stdout before await", async () => {
  const invokeInProcess = async ({ chunks, beforeYield = null }) => {
    const primary = [];
    const diverted = [];
    const stdout = {
      write(value) {
        primary.push(value);
      },
    };
    const stdin = {
      async *[Symbol.asyncIterator]() {
        if (beforeYield !== null) beforeYield({ diverted, stdout });
        for (const chunk of chunks) yield chunk;
      },
    };
    const result = await runWakeflowBootstrapStdin({
      argv: [],
      artifactRoot: HOSTS[0].artifactRoot,
      stdin,
      stdout,
    });
    return { diverted, primary, result };
  };

  const unsupported = Buffer.from('{"mode":"unsupported"}', "utf8");
  const view = new Uint8Array(
    unsupported.buffer,
    unsupported.byteOffset,
    unsupported.byteLength,
  );
  const viewed = await invokeInProcess({ chunks: [view] });
  assert.equal(viewed.result.exitCode, 1);
  assert.equal(JSON.parse(viewed.primary.join("")).error.code, "wakeflow-bootstrap-invalid-mode");

  let coercions = 0;
  const coercive = await invokeInProcess({
    chunks: [{
      toString() {
        coercions += 1;
        return '{"mode":"unsupported"}';
      },
    }],
  });
  assert.equal(coercive.result.exitCode, 1);
  assert.equal(JSON.parse(coercive.primary.join("")).error.code, "wakeflow-bootstrap-invalid-stdin");
  assert.equal(coercions, 0);

  const snapshotted = await invokeInProcess({
    chunks: [unsupported],
    beforeYield({ diverted, stdout }) {
      stdout.write = (value) => diverted.push(value);
    },
  });
  assert.equal(snapshotted.result.exitCode, 1);
  assert.equal(JSON.parse(snapshotted.primary.join("")).error.code, "wakeflow-bootstrap-invalid-mode");
  assert.deepEqual(snapshotted.diverted, []);

  const fragmented = await invokeInProcess({
    chunks: Array.from({ length: 4097 }, () => Buffer.alloc(0)),
  });
  assert.equal(fragmented.result.exitCode, 1);
  assert.equal(
    JSON.parse(fragmented.primary.join("")).error.code,
    "wakeflow-bootstrap-stdin-too-fragmented",
  );
});

test("artifact launcher rejects invalid UTF-8 and over-budget stdin before request decoding", () => {
  const host = HOSTS[0];
  for (const [input, code] of [
    [Buffer.from([0xc3, 0x28]), "wakeflow-bootstrap-invalid-stdin"],
    [Buffer.alloc(WAKEFLOW_BOOTSTRAP_STDIN_LIMIT + 1, 0x20), "wakeflow-bootstrap-stdin-too-large"],
  ]) {
    const result = invokeRaw(host, input);
    assert.equal(result.status, 1);
    assert.equal(result.stderr, "");
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, false);
    assert.equal(output.error.code, code);
    assert.equal(result.stdout.includes(host.artifactRoot), false);
  }
});

test("each exact artifact launcher derives the same host-specific preview without writing the workspace", async (t) => {
  for (const host of HOSTS) await t.test(host.hostId, (t) => {
    const { migrationPlan, workspaceRoot } = migrationFixture(t, host);
    const request = previewRequest(workspaceRoot, host.artifactRoot, migrationPlan);
    assert.deepEqual(parseWakeflowBootstrapRequest(JSON.stringify(request)), request);
    const before = workspaceSnapshot(workspaceRoot);
    const result = invoke(host, request);
    assert.equal(result.status, 0, result.stdout);
    assert.equal(result.stderr, "");
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.hostId, host.hostId);
    assert.equal(output.action, "explicit-migration");
    assert.equal(output.mode, "preview");
    assert.equal(output.migrationPlanDigest, migrationPlan.planDigest);
    assert.deepEqual(output.migrationPlan, migrationPlan);
    assert.equal(output.applyAdmission.status, "ready");
    assert.deepEqual(output.applyAdmission.reasonCodes, []);
    assert.equal(output.confirmedPlan.payload.status, "ready");
    assert.equal(output.planDigest, canonicalJsonDigest(output.confirmedPlan));
    assertBlockedUnknownActivation(output, workspaceRoot, "pending");
    assert.equal(result.stdout.includes(workspaceRoot), false);
    assert.equal(result.stdout.includes(host.artifactRoot), false);
    assert.deepEqual(workspaceSnapshot(workspaceRoot), before);
  });
});

test("each exact artifact launcher applies its own production owner graph", async (t) => {
  for (const host of HOSTS) await t.test(host.hostId, (t) => {
    const { migrationPlan, productRoot, workspaceRoot } = migrationFixture(t, host);
    const preview = JSON.parse(invoke(
      host,
      previewRequest(workspaceRoot, host.artifactRoot, migrationPlan),
    ).stdout);
    assert.equal(preview.ok, true);
    const result = invoke(host, {
      schemaVersion: 1,
      root: workspaceRoot,
      action: "explicit-migration",
      mode: "apply",
      artifactContext: { legacyOwnerRoot: host.artifactRoot },
      confirmedPlan: preview.confirmedPlan,
      planDigest: preview.planDigest,
    });
    assert.equal(result.status, 0, result.stdout);
    assert.equal(result.stderr, "");
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.equal(output.mode, "apply");
    assert.equal(output.hostId, host.hostId);
    assert.equal(output.result.status, "completed");
    assertBlockedUnknownActivation(output, workspaceRoot, "v3-ready");
    assert.equal(result.stdout.includes(workspaceRoot), false);
    assert.equal(result.stdout.includes(host.artifactRoot), false);
    assert.equal(existsSync(path.join(workspaceRoot, ".wakeflow-active/index.md")), true);
    assert.equal(existsSync(path.join(workspaceRoot, ".wakeflow-local/runtime")), true);
    assert.equal(
      existsSync(path.join(productRoot, host.hostId === "codex" ? "AGENTS.md" : "CLAUDE.md")),
      true,
    );
    assert.equal(existsSync(path.join(workspaceRoot, ".wakeflow-local/runtime/maintenance.lock")), false);
  });
});

test("the exact bootstrap recover mode resumes its frozen production composition", async (t) => {
  const host = HOSTS[0];
  const { migrationPlan, workspaceRoot } = migrationFixture(t, host);
  const preview = JSON.parse(invoke(
    host,
    previewRequest(workspaceRoot, host.artifactRoot, migrationPlan),
  ).stdout);
  assert.equal(preview.ok, true);
  const composition = restoreWakeflowProductionMigrationComposition({
    migrationApplyPlan: preview.confirmedPlan,
  });
  const bundle = loadWakeflowAssetBundle({ wakeflowRoot: host.artifactRoot });
  const participant = createWakeflowProductionMigrationParticipant({
    workspaceRoot,
    composition,
    hostProfile: host.hostProfile,
    bundle,
    hostSettingsAssetsAdapter: null,
    admission: "apply",
    replan: () => composition,
  });
  const stepId = "migration-config-v3-replace";
  const handler = participant.stepHandlers[stepId];
  const crashing = Object.freeze({
    ...participant,
    stepHandlers: Object.freeze({
      ...participant.stepHandlers,
      [stepId]: Object.freeze({
        ...handler,
        async commit(value) {
          await handler.commit(value);
          throw new Error("simulated bootstrap process loss after config replacement");
        },
      }),
    }),
  });
  await assert.rejects(
    () => runWakeflowMigrationApply({
      workspaceRoot,
      confirmedPlan: preview.confirmedPlan,
      planDigest: preview.planDigest,
      participant: crashing,
    }),
    (error) => error?.code === "wakeflow-mutation-recovery-required",
  );
  const transactionRoot = path.join(workspaceRoot, ".wakeflow-local/runtime/maintenance/transactions");
  const journalName = readdirSync(transactionRoot).find((name) => /^workspace-mutation_[0-9a-f-]+\.json$/u.test(name));
  assert.ok(journalName);
  const journal = JSON.parse(readFileSync(path.join(transactionRoot, journalName), "utf8"));
  const recovered = invoke(host, {
    schemaVersion: 1,
    root: workspaceRoot,
    action: "explicit-migration",
    mode: "recover",
    artifactContext: { legacyOwnerRoot: host.artifactRoot },
    confirmedPlan: preview.confirmedPlan,
    planDigest: preview.planDigest,
    operationId: journal.operationId,
  });
  assert.equal(recovered.status, 0, recovered.stdout);
  assert.equal(recovered.stderr, "");
  const output = JSON.parse(recovered.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.mode, "recover");
  assert.equal(output.result.status, "recovered");
  assertBlockedUnknownActivation(output, workspaceRoot, "v3-ready");
  assert.deepEqual(readdirSync(transactionRoot), []);
  assert.equal(existsSync(path.join(workspaceRoot, ".wakeflow-active/index.md")), true);
  assert.equal(recovered.stdout.includes(workspaceRoot), false);
  assert.equal(recovered.stdout.includes(host.artifactRoot), false);
});

test("launcher rejects argv and a missing fixed sibling without disclosing artifact paths", (t) => {
  const host = HOSTS[0];
  const withArg = invoke(host, {}, ["--backend", "/private/alternate.mjs"]);
  assert.equal(withArg.status, 64);
  assert.equal(withArg.stderr, "");
  assert.equal(JSON.parse(withArg.stdout).error.code, "wakeflow-bootstrap-invalid-argv");
  assert.equal(withArg.stdout.includes(host.artifactRoot), false);

  const artifactRoot = mkdtempSync(path.join(os.tmpdir(), "wakeflow-bootstrap-missing-backend-"));
  t.after(() => rmSync(artifactRoot, { recursive: true, force: true }));
  mkdirSync(path.join(artifactRoot, "bin"), { recursive: true });
  const launcher = path.join(artifactRoot, "bin/wakeflow-bootstrap");
  copyFileSync(path.join(host.artifactRoot, "bin/wakeflow-bootstrap"), launcher);
  chmodSync(launcher, 0o755);
  const missing = spawnSync(launcher, [], { encoding: "utf8", input: "{}", shell: false });
  assert.equal(missing.status, 127);
  assert.equal(missing.stderr, "");
  assert.equal(JSON.parse(missing.stdout).error.code, "wakeflow-bootstrap-backend-missing");
  assert.equal(missing.stdout.includes(artifactRoot), false);
});

test("bootstrap backend rejects direct execution outside the fixed launcher", () => {
  const host = HOSTS[0];
  const backend = path.join(host.artifactRoot, "scripts/wakeflow-bootstrap.mjs");
  const direct = spawnSync(process.execPath, [backend], {
    cwd: os.tmpdir(),
    encoding: "utf8",
    input: "{}",
    shell: false,
  });
  assert.equal(direct.status, 1);
  assert.equal(direct.stderr, "");
  assert.equal(JSON.parse(direct.stdout).error.code, "wakeflow-bootstrap-launcher-required");
  assert.equal(direct.stdout.includes(host.artifactRoot), false);
});

test("bootstrap launcher rejects a symbolic-link backend instead of following another artifact", {
  skip: process.platform === "win32" ? "POSIX symbolic-link evidence is required" : false,
}, (t) => {
  const host = HOSTS[0];
  const artifactRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-bootstrap-linked-backend-")));
  t.after(() => rmSync(artifactRoot, { recursive: true, force: true }));
  mkdirSync(path.join(artifactRoot, "bin"), { recursive: true });
  mkdirSync(path.join(artifactRoot, "scripts"), { recursive: true });
  const launcher = path.join(artifactRoot, "bin/wakeflow-bootstrap");
  copyFileSync(path.join(host.artifactRoot, "bin/wakeflow-bootstrap"), launcher);
  chmodSync(launcher, 0o755);
  symlinkSync(
    path.join(host.artifactRoot, "scripts/wakeflow-bootstrap.mjs"),
    path.join(artifactRoot, "scripts/wakeflow-bootstrap.mjs"),
  );

  const linked = spawnSync(launcher, [], {
    cwd: os.tmpdir(),
    encoding: "utf8",
    input: "{}",
    shell: false,
  });
  assert.equal(linked.status, 127);
  assert.equal(linked.stderr, "");
  assert.equal(JSON.parse(linked.stdout).error.code, "wakeflow-bootstrap-backend-invalid");
  assert.equal(linked.stdout.includes(artifactRoot), false);
  assert.equal(linked.stdout.includes(host.artifactRoot), false);
});

test("bootstrap rejects an activation observation that belongs to another host", (t) => {
  const sourceHost = HOSTS[0];
  const tempRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-bootstrap-wrong-observation-")));
  t.after(() => rmSync(tempRoot, { recursive: true, force: true }));
  const artifactRoot = path.join(tempRoot, "codex-wakeflow");
  cpSync(sourceHost.artifactRoot, artifactRoot, { recursive: true });
  writeFileSync(
    path.join(artifactRoot, "scripts/lib/wakeflow-codex-activation-scope.mjs"),
    `import {
  WAKEFLOW_HOST_ACTIVATION_SCOPE_KIND,
  WAKEFLOW_HOST_ACTIVATION_SCOPE_SCHEMA_VERSION,
  validateHostActivationScopeObservation,
} from "./wakeflow-host-activation-scope.mjs";

export const WAKEFLOW_CODEX_ACTIVATION_SCOPE_HOST_ID = "codex";
export const WAKEFLOW_CODEX_ACTIVATION_SCOPE_PLUGIN_ID = "wakeflow@gxfn";

export async function inspectCodexHostActivationScope({ workspaceSubjectDigest }) {
  return validateHostActivationScopeObservation({
    kind: WAKEFLOW_HOST_ACTIVATION_SCOPE_KIND,
    schemaVersion: WAKEFLOW_HOST_ACTIVATION_SCOPE_SCHEMA_VERSION,
    hostId: "claude-code",
    pluginId: "wakeflow@gxfn",
    workspaceSubjectDigest,
    scope: "unknown",
    evidence: {
      kind: "host-observation-unavailable",
      digest: null,
      reasonCode: "host-observation-unavailable",
    },
    unattendedEligibility: "forbidden",
    observedAt: "2026-08-23T00:00:00.000Z",
  });
}

export const wakeflowHostActivationScopeAdapter = Object.freeze({
  hostId: WAKEFLOW_CODEX_ACTIVATION_SCOPE_HOST_ID,
  pluginId: WAKEFLOW_CODEX_ACTIVATION_SCOPE_PLUGIN_ID,
  inspect: inspectCodexHostActivationScope,
});
`,
    { mode: 0o644 },
  );
  const copiedHost = Object.freeze({
    hostId: sourceHost.hostId,
    artifactRoot,
    hostProfile: sourceHost.hostProfile,
  });
  const { migrationPlan, workspaceRoot } = migrationFixture(t, copiedHost);
  const before = workspaceSnapshot(workspaceRoot);
  const result = invoke(
    copiedHost,
    previewRequest(workspaceRoot, artifactRoot, migrationPlan),
  );
  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, false);
  assert.equal(output.error.code, "wakeflow-bootstrap-activation-observation-invalid");
  assert.equal(result.stdout.includes(workspaceRoot), false);
  assert.equal(result.stdout.includes(artifactRoot), false);
  assert.deepEqual(workspaceSnapshot(workspaceRoot), before);
});

test("shared bootstrap consumes host-neutral owner adapters without host-specific symbol maps", () => {
  const source = readFileSync(
    path.join(REPOSITORY_ROOT, "core/scripts/wakeflow-bootstrap.mjs"),
    "utf8",
  );
  for (const forbidden of [
    "EXPECTED_HOST_OWNERS",
    "EXPECTED_ACTIVATION_OWNERS",
    "inspectCodexMigrationDecommissionPlan",
    "inspectClaudeMigrationDecommissionPlan",
    "inspectCodexHostActivationScope",
    "inspectClaudeHostActivationScope",
  ]) assert.equal(source.includes(forbidden), false, `shared bootstrap contains ${forbidden}`);
  assert.equal(source.includes("wakeflowHostActivationScopeAdapter"), true);
});

test("config-only bootstrap does not load an unused host-decommission owner", (t) => {
  const sourceHost = HOSTS[0];
  const tempRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-bootstrap-unused-host-owner-")));
  t.after(() => rmSync(tempRoot, { recursive: true, force: true }));
  const artifactRoot = path.join(tempRoot, "codex-wakeflow");
  cpSync(sourceHost.artifactRoot, artifactRoot, { recursive: true });
  writeFileSync(
    path.join(artifactRoot, sourceHost.hostProfile.artifact.migrationDecommissionHostFile),
    'throw new Error("unused-host-decommission-owner-must-not-load");\n',
    { mode: 0o644 },
  );
  const copiedHost = Object.freeze({
    hostId: sourceHost.hostId,
    artifactRoot,
    hostProfile: sourceHost.hostProfile,
  });
  const { migrationPlan, workspaceRoot } = migrationFixture(t, copiedHost);
  const before = workspaceSnapshot(workspaceRoot);
  const result = invoke(
    copiedHost,
    previewRequest(workspaceRoot, artifactRoot, migrationPlan),
  );
  assert.equal(result.status, 0, result.stdout);
  assert.equal(result.stderr, "");
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.applyAdmission.status, "ready");
  assert.equal(result.stdout.includes("unused-host-decommission-owner-must-not-load"), false);
  assert.deepEqual(workspaceSnapshot(workspaceRoot), before);
});

test("production bootstrap owns the only packaged explicit-migration recovery facade", () => {
  assert.equal(existsSync(path.join(REPOSITORY_ROOT, "core/scripts/lib/wakeflow-migration-recovery.mjs")), false);
  for (const host of HOSTS) {
    assert.equal(
      existsSync(path.join(host.artifactRoot, "scripts/lib/wakeflow-migration-recovery.mjs")),
      false,
    );
  }
});

test("bootstrap rejects a workspace root that contains its loaded artifact", (t) => {
  const sourceHost = HOSTS[0];
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-bootstrap-root-overlap-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const artifactRoot = path.join(base, "WakeflowFixture");
  cpSync(sourceHost.artifactRoot, artifactRoot, { recursive: true });
  rmSync(path.join(artifactRoot, "AGENTS.md"));
  copyFileSync(LEGACY_CONFIG, path.join(artifactRoot, "wakeflow.config.json"));
  mkdirSync(path.join(base, "ProductWorkspace"), { mode: 0o755 });
  const copiedHost = Object.freeze({
    hostId: sourceHost.hostId,
    artifactRoot,
    hostProfile: sourceHost.hostProfile,
  });
  const migrationPlan = createMigrationFixturePlan({
    bootstrapArtifactRoot: artifactRoot,
    hostProfile: copiedHost.hostProfile,
    legacyOwnerArtifactRoot: artifactRoot,
    workspaceRoot: artifactRoot,
  });
  assert.equal(migrationPlan.payload.status, "ready");
  const result = invoke(
    copiedHost,
    previewRequest(artifactRoot, artifactRoot, migrationPlan),
  );
  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");
  assert.equal(JSON.parse(result.stdout).error.code, "wakeflow-bootstrap-root-overlap");
  assert.equal(result.stdout.includes(artifactRoot), false);
});

test("bootstrap rejects a configured target root that overlaps its loaded artifact", (t) => {
  const sourceHost = HOSTS[0];
  const tempRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-bootstrap-target-overlap-")));
  t.after(() => rmSync(tempRoot, { recursive: true, force: true }));
  const artifactRoot = path.join(tempRoot, "codex-wakeflow");
  cpSync(sourceHost.artifactRoot, artifactRoot, { recursive: true });
  const copiedHost = Object.freeze({
    hostId: sourceHost.hostId,
    artifactRoot,
    hostProfile: sourceHost.hostProfile,
  });
  const { migrationPlan, workspaceRoot } = migrationFixture(t, copiedHost);
  const request = previewRequest(workspaceRoot, artifactRoot, migrationPlan);
  request.request.desiredModel = structuredClone(request.request.desiredModel);
  request.request.desiredModel.topology.repositories[0].path = path
    .relative(workspaceRoot, artifactRoot)
    .split(path.sep)
    .join("/");
  const result = invoke(copiedHost, request);
  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");
  assert.equal(JSON.parse(result.stdout).error.code, "wakeflow-bootstrap-root-overlap");
  assert.equal(result.stdout.includes(workspaceRoot), false);
  assert.equal(result.stdout.includes(artifactRoot), false);
});

test("bootstrap rejects a wrong host activation owner before any workspace mutation", (t) => {
  const sourceHost = HOSTS[0];
  const tempRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-bootstrap-wrong-activation-")));
  t.after(() => rmSync(tempRoot, { recursive: true, force: true }));
  const artifactRoot = path.join(tempRoot, "codex-wakeflow");
  cpSync(sourceHost.artifactRoot, artifactRoot, { recursive: true });
  copyFileSync(
    path.join(
      HOSTS[1].artifactRoot,
      "scripts/lib/wakeflow-claude-activation-scope.mjs",
    ),
    path.join(
      artifactRoot,
      "scripts/lib/wakeflow-codex-activation-scope.mjs",
    ),
  );
  const copiedHost = Object.freeze({
    hostId: sourceHost.hostId,
    artifactRoot,
    hostProfile: sourceHost.hostProfile,
  });
  const { migrationPlan, workspaceRoot } = migrationFixture(t, copiedHost);
  const before = workspaceSnapshot(workspaceRoot);
  const result = invoke(
    copiedHost,
    previewRequest(workspaceRoot, artifactRoot, migrationPlan),
  );
  assert.equal(result.status, 1, result.stdout);
  assert.equal(result.stderr, "");
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, false);
  assert.equal(output.error.code, "wakeflow-bootstrap-activation-owner-unavailable");
  assert.equal(result.stdout.includes(workspaceRoot), false);
  assert.equal(result.stdout.includes(artifactRoot), false);
  assert.deepEqual(workspaceSnapshot(workspaceRoot), before);
});

test("bootstrap is packaged but remains absent from every normal registration surface", () => {
  for (const host of HOSTS) {
    const packageJson = JSON.parse(readFileSync(path.join(host.artifactRoot, "package.json"), "utf8"));
    assert.deepEqual(packageJson.bin, { "wakeflow-mcp": "./mcp/server.cjs" });
    for (const relative of [
      ".mcp.json",
      host.hostId === "codex" ? ".codex-plugin/plugin.json" : ".claude-plugin/plugin.json",
    ]) {
      assert.equal(readFileSync(path.join(host.artifactRoot, relative), "utf8").includes("wakeflow-bootstrap"), false);
    }
  }
  for (const relative of [
    "core/lib/wakeflow-mcp-tools.mjs",
    "core/mcp/server.cjs",
    "core/scripts/wakeflow-cli.mjs",
    "core/scripts/wakeflow-setup.mjs",
  ]) {
    const source = readFileSync(path.join(REPOSITORY_ROOT, relative), "utf8");
    for (const forbidden of [
      "wakeflow-bootstrap",
      "wakeflow-migration-apply",
      "wakeflow-migration-recovery",
      "wakeflow-legacy-classifier",
    ]) assert.equal(source.includes(forbidden), false, `${relative} imports ${forbidden}`);
  }
});
