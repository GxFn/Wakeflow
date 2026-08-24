#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync as runSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const workspaceRoot = path.join(repositoryRoot, "plugins/codex-wakeflow");
const claudeWorkspaceRoot = path.join(repositoryRoot, "plugins/claude-code-wakeflow");
const coreRoot = path.join(repositoryRoot, "core");
const validateScript = path.join(workspaceRoot, "scripts/wakeflow-validate.mjs");
const claudeValidateScript = path.join(
  claudeWorkspaceRoot,
  "scripts/wakeflow-validate.mjs",
);
const publicV3SchemaId = "https://raw.githubusercontent.com/GxFn/Wakeflow/main/core/schemas/wakeflow-config.schema.json";
const retiredCandidateSchemaId = "urn:wakeflow:internal:config:v3-candidate";
const demandArtifactContractFiles = [
  "schemas/wakeflow-demand-artifacts/pod-design-handoff.schema.json",
  "schemas/wakeflow-demand-artifacts/pod-design-request.schema.json",
  "schemas/wakeflow-demand-artifacts/review-candidate.schema.json",
  "schemas/wakeflow-demand-artifacts/target-result.schema.json",
  "schemas/wakeflow-demand-artifacts/task-package.schema.json",
  "schemas/wakeflow-demand-artifacts/test-card.schema.json",
  "scripts/lib/wakeflow-demand-artifact-records.mjs",
  "scripts/lib/wakeflow-demand-artifact-service.mjs",
  "scripts/lib/wakeflow-target-result-authority.mjs",
];
const evidenceContractFiles = [
  "schemas/wakeflow-demand-evidence/evidence.schema.json",
  "scripts/lib/wakeflow-evidence-importer.mjs",
  "scripts/lib/wakeflow-evidence-records.mjs",
  "scripts/lib/wakeflow-evidence-tree.mjs",
];
const activeProjectionContractFiles = [
  "scripts/lib/wakeflow-active-projector.mjs",
  "scripts/lib/wakeflow-config-v3-snapshot.mjs",
];
const activeCoordinationContractFiles = [
  "scripts/lib/wakeflow-active-identity-lock.mjs",
  "scripts/lib/wakeflow-active-projection-lock.mjs",
];
const businessArchiveContractFiles = [
  "schemas/wakeflow-business-archive/archive-transaction.schema.json",
  "schemas/wakeflow-business-archive/business-summary.schema.json",
  "schemas/wakeflow-business-archive/todo-history.schema.json",
  "schemas/wakeflow-business-archive/transport-summary.schema.json",
  "scripts/lib/wakeflow-business-archive-records.mjs",
  "scripts/lib/wakeflow-business-archive-service.mjs",
];
const windowBindingContractFiles = [
  "schemas/wakeflow-window-identity/window-binding.schema.json",
  "scripts/lib/wakeflow-window-binding-records.mjs",
  "scripts/lib/wakeflow-window-binding-service.mjs",
];
const windowCoordinationLeaseContractFiles = [
  "schemas/wakeflow-coordination/window-lease.schema.json",
  "scripts/lib/wakeflow-window-lease-records.mjs",
  "scripts/lib/wakeflow-window-lease-service.mjs",
];
const keepLiveContractFiles = [
  "schemas/wakeflow-keep-live/control.schema.json",
  "schemas/wakeflow-keep-live/lease.schema.json",
  "schemas/wakeflow-keep-live/manager-lock.schema.json",
  "schemas/wakeflow-keep-live/process.schema.json",
  "scripts/lib/wakeflow-keep-live-records.mjs",
  "scripts/lib/wakeflow-keep-live-service.mjs",
  "scripts/lib/wakeflow-process-identity.mjs",
];
const transportSchemaContracts = [
  {
    file: "schemas/wakeflow-delivery/dispatch-group.schema.json",
    id: "urn:wakeflow:internal:delivery:dispatch-group:v1",
    artifactKinds: ["wakeflow-dispatch-group"],
  },
  {
    file: "schemas/wakeflow-delivery/dispatch-packet.schema.json",
    id: "urn:wakeflow:internal:delivery:dispatch-packet:v1",
    artifactKinds: ["wakeflow-controller-dispatch-packet"],
  },
  {
    file: "schemas/wakeflow-delivery/delivery-envelope.schema.json",
    id: "urn:wakeflow:internal:delivery:delivery-envelope:v1",
    artifactKinds: [
      "wakeflow-controller-return-envelope",
      "wakeflow-target-delivery-envelope",
    ],
  },
  {
    file: "schemas/wakeflow-delivery/delivery-run.schema.json",
    id: "urn:wakeflow:internal:delivery:delivery-run:v1",
    artifactKinds: ["wakeflow-direct-thread-delivery-run"],
  },
];
const transportContractFiles = [
  ...transportSchemaContracts.map(({ file }) => file),
  "schemas/wakeflow-maintenance/transport-retention-plan.schema.json",
  "scripts/lib/wakeflow-delivery-orchestration.mjs",
  "scripts/lib/wakeflow-result-review-orchestration.mjs",
  "scripts/lib/wakeflow-transport-retention.mjs",
  "scripts/lib/wakeflow-transport-records.mjs",
  "scripts/lib/wakeflow-transport-store.mjs",
];
const preservationContractFiles = [
  "schemas/wakeflow-maintenance/local-preservation-plan.schema.json",
  "schemas/wakeflow-maintenance/local-preservation.schema.json",
  "scripts/lib/wakeflow-preservation.mjs",
];
const legacyClassifierContractFiles = [
  "scripts/data/wakeflow-legacy-classifier-catalog.json",
  "scripts/lib/wakeflow-legacy-classifier.mjs",
];
const migrationInventoryContractFiles = [
  "scripts/lib/wakeflow-migration-inventory.mjs",
];
const legacyOwnerDrainContractFiles = [
  "scripts/lib/wakeflow-legacy-owner-drain.mjs",
];
const legacyArchiveContractFiles = [
  "schemas/wakeflow-business-archive/legacy-evidence-summary.schema.json",
  "schemas/wakeflow-business-archive/legacy-source-descriptor.schema.json",
  "schemas/wakeflow-business-archive/legacy-transport-summary.schema.json",
  "schemas/wakeflow-ledger/archive-manifest.schema.json",
  "schemas/wakeflow-maintenance/legacy-archive-transform-plan.schema.json",
  "scripts/lib/wakeflow-ledger-records.mjs",
  "scripts/lib/wakeflow-legacy-archive-records.mjs",
  "scripts/lib/wakeflow-legacy-archive-transform.mjs",
];
const migrationPlanContractFiles = [
  "scripts/lib/wakeflow-migration-plan.mjs",
];
const migrationHostDecommissionContractFiles = [
  "scripts/lib/wakeflow-migration-host-decommission.mjs",
];
const maintenanceSurfaceContractFiles = [
  "lib/wakeflow-mcp-tools.mjs",
  "scripts/lib/wakeflow-maintenance-action-runtime.mjs",
  "scripts/lib/wakeflow-maintenance-coordinator.mjs",
  "scripts/lib/wakeflow-public-v3-runtime.mjs",
  "scripts/wakeflow-cli.mjs",
  "scripts/wakeflow-setup.mjs",
  "scripts/wakeflow-smoke.mjs",
  "scripts/wakeflow-validate.mjs",
];
const windowRuntimeContractFiles = [
  "schemas/wakeflow-window-runtime/window-runtime.schema.json",
  "scripts/lib/wakeflow-window-runtime-projector.mjs",
  "scripts/lib/wakeflow-window-runtime-records.mjs",
];
const businessArchiveReferenceSchemaFiles = [
  "schemas/wakeflow-demand-core/controller-event.schema.json",
  "schemas/wakeflow-demand-core/wakeflow-state.schema.json",
  "schemas/wakeflow-ledger/archive-manifest.schema.json",
];

function run(root) {
  return runSync(process.execPath, [validateScript, "--root", root], {
    cwd: workspaceRoot,
    encoding: "utf8",
  });
}

function runClaude(root) {
  return runSync(process.execPath, [claudeValidateScript, "--root", root], {
    cwd: claudeWorkspaceRoot,
    encoding: "utf8",
  });
}

function parseOutput(result) {
  return JSON.parse(result.status === 0 ? result.stdout : result.stderr);
}

function makeFixture(sourceRoot = workspaceRoot) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-validate-"));
  for (const entry of [
    sourceRoot === claudeWorkspaceRoot ? ".claude-plugin" : ".codex-plugin",
    "assets",
    "bin",
    ...(sourceRoot === claudeWorkspaceRoot ? ["commands"] : []),
    "lib",
    "mcp",
    "schemas",
    "scripts",
    "skills",
    "templates",
  ]) {
    cpSync(path.join(sourceRoot, entry), path.join(root, entry), {
      recursive: true,
      filter: (source) => !source.includes(`${path.sep}node_modules${path.sep}`),
    });
  }
  for (const file of [
    ".mcp.json",
    sourceRoot === claudeWorkspaceRoot ? "CLAUDE.md" : "AGENTS.md",
    "LICENSE",
    "README.md",
    "README.zh-CN.md",
    "package.json",
    "wakeflow.config.example.json",
    "wakeflow.config.json",
  ]) {
    cpSync(path.join(sourceRoot, file), path.join(root, file));
  }
  return root;
}

function installCanonicalCandidateValidator(root) {
  for (const relative of [
    "schemas/wakeflow-config.schema.json",
    "scripts/wakeflow-validate.mjs",
    "scripts/lib/wakeflow-canonical-json.mjs",
    "scripts/lib/wakeflow-config-v3.mjs",
    "scripts/lib/wakeflow-demand-core-records.mjs",
    "scripts/lib/wakeflow-demand-state-service.mjs",
    "scripts/lib/wakeflow-host-capability.mjs",
    "scripts/lib/wakeflow-identifiers.mjs",
    "scripts/lib/wakeflow-ledger-records.mjs",
    "scripts/lib/wakeflow-template-renderer.mjs",
    ...demandArtifactContractFiles,
    ...evidenceContractFiles,
    ...activeProjectionContractFiles,
    ...activeCoordinationContractFiles,
    ...businessArchiveContractFiles,
    ...windowBindingContractFiles,
    ...windowCoordinationLeaseContractFiles,
    ...keepLiveContractFiles,
    ...transportContractFiles,
    ...preservationContractFiles,
    ...legacyClassifierContractFiles,
    ...migrationInventoryContractFiles,
    ...legacyOwnerDrainContractFiles,
    ...legacyArchiveContractFiles,
    ...migrationPlanContractFiles,
    ...migrationHostDecommissionContractFiles,
    ...maintenanceSurfaceContractFiles,
    ...windowRuntimeContractFiles,
    ...businessArchiveReferenceSchemaFiles,
  ]) {
    const destination = path.join(root, relative);
    mkdirSync(path.dirname(destination), { recursive: true });
    cpSync(path.join(coreRoot, relative), destination);
  }
  const manifestPath = path.join(root, "scripts/wakeflow-core-manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.files = [...new Set([
    ...manifest.files,
    ...demandArtifactContractFiles,
    ...evidenceContractFiles,
    ...activeProjectionContractFiles,
    ...activeCoordinationContractFiles,
    ...businessArchiveContractFiles,
    ...windowBindingContractFiles,
    ...windowCoordinationLeaseContractFiles,
    ...keepLiveContractFiles,
    ...transportContractFiles,
    ...preservationContractFiles,
    ...legacyClassifierContractFiles,
    ...migrationInventoryContractFiles,
    ...legacyOwnerDrainContractFiles,
    ...legacyArchiveContractFiles,
    ...migrationPlanContractFiles,
    ...migrationHostDecommissionContractFiles,
    ...maintenanceSurfaceContractFiles,
    ...windowRuntimeContractFiles,
  ])].sort();
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function makeCanonicalCandidateFixture(sourceRoot = workspaceRoot) {
  const root = makeFixture(sourceRoot);
  installCanonicalCandidateValidator(root);
  return root;
}

function runCanonicalCandidateValidator(root) {
  return runSync(process.execPath, [path.join(root, "scripts/wakeflow-validate.mjs"), "--root", root], {
    cwd: root,
    encoding: "utf8",
  });
}

function mutateJson(file, mutate) {
  const payload = JSON.parse(readFileSync(file, "utf8"));
  mutate(payload);
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
}

function mutateText(file, mutate) {
  writeFileSync(file, mutate(readFileSync(file, "utf8")));
}

test("passes for the repository plugin surface", () => {
  const result = run(workspaceRoot);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = parseOutput(result);
  assert.equal(payload.ok, true);
  assert.ok(payload.checked.requiredFiles > 30);
  assert.equal(payload.checked.runtimeScripts, 4);
  assert.ok(payload.checked.skills >= 3);
});

test("canonical validator requires the host artifact check seam in both synced editions", () => {
  for (const sourceRoot of [workspaceRoot, claudeWorkspaceRoot]) {
    const root = makeCanonicalCandidateFixture(sourceRoot);
    try {
      rmSync(path.join(root, "scripts/lib/wakeflow-host-artifact-checks.mjs"));
      const result = runCanonicalCandidateValidator(root);
      assert.notEqual(result.status, 0, sourceRoot);
      assert.match(
        result.stderr,
        /missing file: scripts\/lib\/wakeflow-host-artifact-checks\.mjs/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("canonical validator does not misclassify a host-check dependency failure as core dev mode", () => {
  for (const sourceRoot of [workspaceRoot, claudeWorkspaceRoot]) {
    const root = makeCanonicalCandidateFixture(sourceRoot);
    try {
      mutateText(
        path.join(root, "scripts/lib/wakeflow-host-artifact-checks.mjs"),
        (text) => `${text}\nimport "./missing-host-check-dependency.mjs";\n`,
      );
      const result = runCanonicalCandidateValidator(root);
      assert.notEqual(result.status, 0, sourceRoot);
      assert.match(
        result.stderr,
        /failed to load scripts\/lib\/wakeflow-host-artifact-checks\.mjs/u,
      );
      assert.doesNotMatch(result.stderr, /host-artifact checks skipped/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("canonical validator rejects missing files named by the shared core manifest", () => {
  const root = makeCanonicalCandidateFixture();
  try {
    mutateJson(path.join(root, "scripts/wakeflow-core-manifest.json"), (payload) => {
      payload.files.push("scripts/lib/wakeflow-ghost-contract.mjs");
      payload.files.sort();
    });
    const result = runCanonicalCandidateValidator(root);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /core manifest entry must be a real packaged file: scripts\/lib\/wakeflow-ghost-contract\.mjs/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("canonical validator requires and pins the Claude-only locator contract", () => {
  const missingRoot = makeCanonicalCandidateFixture(claudeWorkspaceRoot);
  try {
    rmSync(path.join(missingRoot, "schemas/wakeflow-claude-host/window-locator.schema.json"));
    const result = runCanonicalCandidateValidator(missingRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing file: schemas\/wakeflow-claude-host\/window-locator\.schema\.json/u);
  } finally {
    rmSync(missingRoot, { recursive: true, force: true });
  }

  const schemaRoot = makeCanonicalCandidateFixture(claudeWorkspaceRoot);
  try {
    mutateJson(path.join(schemaRoot, "schemas/wakeflow-claude-host/window-locator.schema.json"), (payload) => {
      payload.$id = "urn:wakeflow:internal:claude-window-locator:drifted:v1";
      payload.additionalProperties = true;
      payload.properties.kind.const = "DriftedClaudeWindowLocator";
    });
    const result = runCanonicalCandidateValidator(schemaRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /window-locator\.schema\.json \$id must be urn:wakeflow:internal:claude-window-locator:v1/u);
    assert.match(result.stderr, /window-locator\.schema\.json root must be a strict object/u);
    assert.match(result.stderr, /window-locator\.schema\.json kind property must require WakeflowClaudeWindowLocator/u);
  } finally {
    rmSync(schemaRoot, { recursive: true, force: true });
  }

  const moduleRoot = makeCanonicalCandidateFixture(claudeWorkspaceRoot);
  try {
    mutateText(path.join(moduleRoot, "scripts/lib/wakeflow-claude-locator.mjs"), (text) => (
      `${text}\nexport const unexpectedLocatorSurface = true;\n`
    ));
    const result = runCanonicalCandidateValidator(moduleRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /wakeflow-claude-locator\.mjs exports must be exactly:/u);
  } finally {
    rmSync(moduleRoot, { recursive: true, force: true });
  }
});

test("canonical validator keeps the Claude locator behind the current lifecycle owner", () => {
  const root = makeCanonicalCandidateFixture(claudeWorkspaceRoot);
  try {
    mutateText(path.join(root, "scripts/lib/wakeflow-claude-host.mjs"), (text) => (
      `${text}\nimport "./wakeflow-claude-locator.mjs";\n`
    ));
    const result = runCanonicalCandidateValidator(root);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /wakeflow-claude-host\.mjs must reach the Claude locator only through current lifecycle\/transport owners/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("canonical validator requires and pins the current Claude lifecycle and thin facade", () => {
  const missingRoot = makeCanonicalCandidateFixture(claudeWorkspaceRoot);
  try {
    rmSync(path.join(missingRoot, "scripts/lib/wakeflow-claude-lifecycle.mjs"));
    const result = runCanonicalCandidateValidator(missingRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing file: scripts\/lib\/wakeflow-claude-lifecycle\.mjs/u);
  } finally {
    rmSync(missingRoot, { recursive: true, force: true });
  }

  const lifecycleRoot = makeCanonicalCandidateFixture(claudeWorkspaceRoot);
  try {
    mutateText(path.join(lifecycleRoot, "scripts/lib/wakeflow-claude-lifecycle.mjs"), (text) => (
      `${text}\nexport const unexpectedLifecycleSurface = true;\n`
    ));
    const result = runCanonicalCandidateValidator(lifecycleRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /wakeflow-claude-lifecycle\.mjs exports must be exactly:/u);
  } finally {
    rmSync(lifecycleRoot, { recursive: true, force: true });
  }

  const facadeRoot = makeCanonicalCandidateFixture(claudeWorkspaceRoot);
  try {
    mutateText(path.join(facadeRoot, "scripts/lib/wakeflow-claude-host.mjs"), (text) => (
      `${text}\nexport const unexpectedFacadeSurface = true;\n`
    ));
    const result = runCanonicalCandidateValidator(facadeRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /wakeflow-claude-host\.mjs exports must be exactly:/u);
  } finally {
    rmSync(facadeRoot, { recursive: true, force: true });
  }
});

test("canonical validator requires and pins the Claude-only settings/assets contract", () => {
  const missingRoot = makeCanonicalCandidateFixture(claudeWorkspaceRoot);
  try {
    rmSync(path.join(missingRoot, "scripts/lib/wakeflow-claude-settings.mjs"));
    const result = runCanonicalCandidateValidator(missingRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing file: scripts\/lib\/wakeflow-claude-settings\.mjs/u);
  } finally {
    rmSync(missingRoot, { recursive: true, force: true });
  }

  const surfaceRoot = makeCanonicalCandidateFixture(claudeWorkspaceRoot);
  try {
    mutateText(path.join(surfaceRoot, "scripts/lib/wakeflow-claude-settings.mjs"), (text) => (
      `${text}\nexport const unexpectedClaudeSettingsSurface = true;\n`
    ));
    const result = runCanonicalCandidateValidator(surfaceRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /wakeflow-claude-settings\.mjs exports must be exactly:/u);
  } finally {
    rmSync(surfaceRoot, { recursive: true, force: true });
  }

  const constantsRoot = makeCanonicalCandidateFixture(claudeWorkspaceRoot);
  try {
    mutateText(path.join(constantsRoot, "scripts/lib/wakeflow-claude-settings.mjs"), (text) => (
      text
        .replace(
          'export const WAKEFLOW_CLAUDE_SETTINGS_HOST_ID = "claude-code";',
          'export const WAKEFLOW_CLAUDE_SETTINGS_HOST_ID = "drifted-host";',
        )
        .replace(
          "export const WAKEFLOW_CLAUDE_SETTINGS_SCHEMA_VERSION = 1;",
          "export const WAKEFLOW_CLAUDE_SETTINGS_SCHEMA_VERSION = 2;",
        )
    ));
    const result = runCanonicalCandidateValidator(constantsRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /WAKEFLOW_CLAUDE_SETTINGS_HOST_ID must match the host profile/u);
    assert.match(result.stderr, /WAKEFLOW_CLAUDE_SETTINGS_SCHEMA_VERSION must remain 1/u);
  } finally {
    rmSync(constantsRoot, { recursive: true, force: true });
  }

  const adapterRoot = makeCanonicalCandidateFixture(claudeWorkspaceRoot);
  try {
    mutateText(path.join(adapterRoot, "scripts/lib/wakeflow-claude-settings.mjs"), (text) => (
      text.replace(
        "  hostId: WAKEFLOW_CLAUDE_SETTINGS_HOST_ID,",
        '  hostId: "drifted-host",',
      )
    ));
    const result = runCanonicalCandidateValidator(adapterRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must expose the exact generic settings\/assets maintenance adapter/u);
  } finally {
    rmSync(adapterRoot, { recursive: true, force: true });
  }
});

test("canonical validator requires facade routing and keeps settings/assets out of migration-only code", () => {
  const root = makeCanonicalCandidateFixture(claudeWorkspaceRoot);
  try {
    mutateText(path.join(root, "scripts/lib/wakeflow-claude-host.mjs"), (text) => (
      text.replace('from "./wakeflow-claude-settings.mjs";', 'from "./wakeflow-claude-activity.mjs";')
    ));
    mutateText(path.join(root, "scripts/lib/wakeflow-claude-settings.mjs"), (text) => (
      `${text}\nimport "./wakeflow-migration-plan.mjs";\n`
    ));
    const result = runCanonicalCandidateValidator(root);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /wakeflow-claude-host\.mjs must route through current owner wakeflow-claude-settings\.mjs/u,
    );
    assert.match(
      result.stderr,
      /normal runtime graph reaches migration-only file: scripts\/lib\/wakeflow-migration-plan\.mjs/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("canonical validator requires and pins the Claude-only host transport contract", () => {
  const missingRoot = makeCanonicalCandidateFixture(claudeWorkspaceRoot);
  try {
    rmSync(path.join(missingRoot, "scripts/lib/wakeflow-claude-transport.mjs"));
    const result = runCanonicalCandidateValidator(missingRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing file: scripts\/lib\/wakeflow-claude-transport\.mjs/u);
  } finally {
    rmSync(missingRoot, { recursive: true, force: true });
  }

  const surfaceRoot = makeCanonicalCandidateFixture(claudeWorkspaceRoot);
  try {
    mutateText(path.join(surfaceRoot, "scripts/lib/wakeflow-claude-transport.mjs"), (text) => (
      `${text}\nexport const unexpectedClaudeTransportSurface = true;\n`
    ));
    const result = runCanonicalCandidateValidator(surfaceRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /wakeflow-claude-transport\.mjs exports must be exactly:/u);
  } finally {
    rmSync(surfaceRoot, { recursive: true, force: true });
  }

  const constantsRoot = makeCanonicalCandidateFixture(claudeWorkspaceRoot);
  try {
    mutateText(path.join(constantsRoot, "scripts/lib/wakeflow-claude-transport.mjs"), (text) => (
      text
        .replace(
          'export const WAKEFLOW_CLAUDE_TRANSPORT_HOST_ID = "claude-code";',
          'export const WAKEFLOW_CLAUDE_TRANSPORT_HOST_ID = "drifted-host";',
        )
        .replace(
          "export const WAKEFLOW_CLAUDE_TRANSPORT_SCHEMA_VERSION = 1;",
          "export const WAKEFLOW_CLAUDE_TRANSPORT_SCHEMA_VERSION = 2;",
        )
    ));
    const result = runCanonicalCandidateValidator(constantsRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /WAKEFLOW_CLAUDE_TRANSPORT_HOST_ID must match the host profile/u);
    assert.match(result.stderr, /WAKEFLOW_CLAUDE_TRANSPORT_SCHEMA_VERSION must remain 1/u);
  } finally {
    rmSync(constantsRoot, { recursive: true, force: true });
  }
});

test("canonical validator enforces the M7A retired-file and migrator import firewall", () => {
  const retiredRoot = makeCanonicalCandidateFixture(claudeWorkspaceRoot);
  try {
    writeFileSync(
      path.join(retiredRoot, "scripts/lib/wakeflow-host-send-adapter.mjs"),
      "export const retiredHostSendAdapter = true;\n",
    );
    const result = runCanonicalCandidateValidator(retiredRoot);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /retired normal-runtime file remains: scripts\/lib\/wakeflow-host-send-adapter\.mjs/u,
    );
  } finally {
    rmSync(retiredRoot, { recursive: true, force: true });
  }

  const normalRoot = makeCanonicalCandidateFixture(claudeWorkspaceRoot);
  try {
    mutateText(path.join(normalRoot, "scripts/lib/wakeflow-claude-transport.mjs"), (text) => (
      `${text}\nimport "./wakeflow-migration-plan.mjs";\n`
    ));
    const result = runCanonicalCandidateValidator(normalRoot);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /normal runtime graph reaches migration-only file: scripts\/lib\/wakeflow-migration-plan\.mjs/u,
    );
  } finally {
    rmSync(normalRoot, { recursive: true, force: true });
  }

  const bootstrapRoot = makeCanonicalCandidateFixture();
  try {
    mutateText(path.join(bootstrapRoot, "scripts/wakeflow-bootstrap.mjs"), (text) => (
      text.replace(
        'from "./lib/wakeflow-migration-production.mjs";',
        'from "./lib/wakeflow-public-v3-runtime.mjs";',
      )
    ));
    const result = runCanonicalCandidateValidator(bootstrapRoot);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /explicit bootstrap graph is missing migration-only file: scripts\/lib\/wakeflow-migration-production\.mjs/u,
    );
  } finally {
    rmSync(bootstrapRoot, { recursive: true, force: true });
  }
});

test("fails when the MCP config points at a missing launcher", () => {
  const root = makeFixture();
  try {
    mutateJson(path.join(root, ".mcp.json"), (payload) => {
      payload.mcpServers.wakeflow.command = "./bin/missing-wakeflow-mcp";
    });
    const result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /wakeflow MCP command must use \.\/bin\/wakeflow-mcp/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails when the MCP config does not launch from the plugin root", () => {
  const root = makeFixture();
  try {
    mutateJson(path.join(root, ".mcp.json"), (payload) => {
      delete payload.mcpServers.wakeflow.cwd;
    });
    const result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /wakeflow MCP cwd must be \./);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects obsolete host-injected default workspace roots in both MCP editions", () => {
  for (const [sourceRoot, runValidator] of [
    [workspaceRoot, run],
    [claudeWorkspaceRoot, runClaude],
  ]) {
    const root = makeFixture(sourceRoot);
    try {
      mutateJson(path.join(root, ".mcp.json"), (payload) => {
        payload.mcpServers.wakeflow.env = {
          WAKEFLOW_DEFAULT_ROOT: "${CLAUDE_PROJECT_DIR}",
        };
      });
      const result = runValidator(root);
      assert.notEqual(result.status, 0, sourceRoot);
      assert.match(
        result.stderr,
        /must not inject a default workspace root; public requests carry explicit root/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("rejects symlinked MCP configs named by either host manifest", () => {
  for (const [sourceRoot, runValidator] of [
    [workspaceRoot, run],
    [claudeWorkspaceRoot, runClaude],
  ]) {
    const root = makeFixture(sourceRoot);
    try {
      const mcpFile = path.join(root, ".mcp.json");
      const linkedFile = path.join(root, "mcp-linked.json");
      writeFileSync(linkedFile, readFileSync(mcpFile));
      rmSync(mcpFile);
      symlinkSync("mcp-linked.json", mcpFile);
      const result = runValidator(root);
      assert.notEqual(result.status, 0, sourceRoot);
      assert.match(result.stderr, /plugin manifest points to an invalid path: \.\/\.mcp\.json: expected a real file/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("fails when an MCP tool declaration is missing annotations", () => {
  const root = makeFixture();
  try {
    mutateText(path.join(root, "lib/wakeflow-mcp-tools.mjs"), (text) => {
      return text.replace("    annotations: writeAnnotations(title, true, { readOnly, destructive }),\n", "");
    });
    const result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /MCP tool wakeflow_status must declare annotations/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails when an MCP destructive annotation drifts from the exact tool matrix", () => {
  const root = makeFixture();
  try {
    mutateText(path.join(root, "lib/wakeflow-mcp-tools.mjs"), (text) => {
      return text.replace(
        '  annotations: writeAnnotations("Maintain Wakeflow Workspace", true, { destructive: true }),\n',
        '  annotations: writeAnnotations("Maintain Wakeflow Workspace", true),\n',
      );
    });
    const result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /MCP tool wakeflow_maintain_workspace must declare destructiveHint=true/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails when a public runtime whitelist script is absent from the package", () => {
  const root = makeFixture();
  try {
    rmSync(path.join(root, "scripts/wakeflow-cli.mjs"), { force: true });
    const result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing file: scripts\/wakeflow-cli\.mjs/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails when a plugin skill surface is missing", () => {
  const root = makeFixture();
  try {
    rmSync(path.join(root, "skills/wakeflow-target/SKILL.md"), { force: true });
    const result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing file: skills\/wakeflow-target\/SKILL\.md/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails when the new Design or Test plugin capability is missing", () => {
  for (const skill of ["wakeflow-design", "wakeflow-test"]) {
    const root = makeFixture();
    try {
      rmSync(path.join(root, `skills/${skill}/SKILL.md`), { force: true });
      const result = run(root);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, new RegExp(`missing file: skills/${skill}/SKILL\\.md`));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("fails when Skill frontmatter identity drifts from its directory", () => {
  const root = makeFixture();
  try {
    mutateText(path.join(root, "skills/wakeflow-design/SKILL.md"), (text) => (
      text.replace("name: wakeflow-design", "name: wakeflow-design-drifted")
    ));
    const result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /frontmatter name wakeflow-design-drifted must match directory wakeflow-design/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails closed on missing, traversing, and orphan Skill resources", () => {
  const scenarios = [
    {
      mutate(root) { rmSync(path.join(root, "skills/wakeflow-test/references/risk-strategy.md")); },
      expected: /missing Skill link target: references\/risk-strategy\.md/u,
    },
    {
      mutate(root) {
        mutateText(path.join(root, "skills/wakeflow-design/SKILL.md"), (text) => (
          `${text}\n[Cross-package](../wakeflow-target/SKILL.md)\n`
        ));
      },
      expected: /non-canonical or traversing Skill link/u,
    },
    {
      mutate(root) {
        writeFileSync(path.join(root, "skills/wakeflow-design/references/orphan.md"), "# Orphan\n");
      },
      expected: /orphan Skill resource/u,
    },
    {
      mutate(root) {
        mutateText(path.join(root, "skills/wakeflow-design/SKILL.md"), (text) => (
          `${text}\n[Escaping reference][escape]\n\n[escape]: ../../outside.md\n`
        ));
      },
      expected: /non-canonical or traversing Skill link: \.\.\/\.\.\/outside\.md/u,
    },
    {
      mutate(root) {
        mutateText(path.join(root, "skills/wakeflow-test/SKILL.md"), (text) => (
          `${text}\n[Missing reference][missing]\n\n[missing]: references/missing.md\n`
        ));
      },
      expected: /missing Skill link target: references\/missing\.md/u,
    },
  ];
  for (const scenario of scenarios) {
    const root = makeCanonicalCandidateFixture();
    try {
      scenario.mutate(root);
      const result = run(root);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, scenario.expected);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("fails closed on symlinked Skill roots and directories without SKILL.md", () => {
  const root = makeCanonicalCandidateFixture();
  try {
    const designRoot = path.join(root, "skills/wakeflow-design");
    rmSync(designRoot, { recursive: true, force: true });
    symlinkSync(path.join(workspaceRoot, "skills/wakeflow-design"), designRoot, "dir");
    mkdirSync(path.join(root, "skills/placeholder"));
    const result = runCanonicalCandidateValidator(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /skills\/wakeflow-design must be a real Skill directory and not a symlink/u);
    assert.match(result.stderr, /skills\/placeholder\/SKILL\.md is missing from the Skill package/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("requires and validates the strict Wakeflow asset bundle", () => {
  const missingRoot = makeFixture();
  try {
    rmSync(path.join(missingRoot, "templates/wakeflow-asset-bundle.json"));
    const result = run(missingRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing file: templates\/wakeflow-asset-bundle\.json/u);
  } finally {
    rmSync(missingRoot, { recursive: true, force: true });
  }

  const corruptRoot = makeFixture();
  try {
    mutateJson(path.join(corruptRoot, "templates/wakeflow-asset-bundle.json"), (payload) => {
      payload.assets["progress.demand.en"].content += "tampered\n";
    });
    const result = run(corruptRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /invalid Wakeflow asset bundle: wakeflow-template-entry-digest/u);
  } finally {
    rmSync(corruptRoot, { recursive: true, force: true });
  }
});

test("fails when package metadata is still private", () => {
  const root = makeFixture();
  try {
    mutateJson(path.join(root, "package.json"), (payload) => {
      payload.private = true;
    });
    const result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /package\.json must not be private/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails when package metadata omits the schema release surface", () => {
  for (const sourceRoot of [workspaceRoot, claudeWorkspaceRoot]) {
    const root = makeCanonicalCandidateFixture(sourceRoot);
    try {
      mutateJson(path.join(root, "package.json"), (payload) => {
        payload.files = payload.files.filter((entry) => entry !== "schemas/");
      });
      const result = runCanonicalCandidateValidator(root);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /package files must include schemas\//u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("fails when the shipped public v3 config contains a derived legacy field", () => {
  const root = makeFixture();
  try {
    mutateJson(path.join(root, "wakeflow.config.json"), (payload) => {
      payload.dispatchWindows = ["duplicate-view"];
    });
    const result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /does not satisfy the public v3 contract.*dispatchWindows/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("canonical validator accepts the public v3 contract for both actual host profiles", () => {
  for (const sourceRoot of [workspaceRoot, claudeWorkspaceRoot]) {
    const root = makeCanonicalCandidateFixture(sourceRoot);
    try {
      const result = runCanonicalCandidateValidator(root);
      assert.equal(result.status, 0, result.stderr || result.stdout);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("canonical validator requires the sole public schema and its canonical identifier", () => {
  const missingRoot = makeCanonicalCandidateFixture();
  try {
    rmSync(path.join(missingRoot, "schemas/wakeflow-config.schema.json"));
    const result = runCanonicalCandidateValidator(missingRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing file: schemas\/wakeflow-config\.schema\.json/);
  } finally {
    rmSync(missingRoot, { recursive: true, force: true });
  }

  const wrongIdRoot = makeCanonicalCandidateFixture();
  try {
    mutateJson(path.join(wrongIdRoot, "schemas/wakeflow-config.schema.json"), (payload) => {
      payload.$id = "urn:wakeflow:internal:config:v3-wrong";
    });
    const result = runCanonicalCandidateValidator(wrongIdRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`public schema \\$id must be ${publicV3SchemaId}`));
  } finally {
    rmSync(wrongIdRoot, { recursive: true, force: true });
  }

  const coordinatedDriftRoot = makeCanonicalCandidateFixture();
  try {
    mutateText(path.join(coordinatedDriftRoot, "scripts/lib/wakeflow-config-v3.mjs"), (text) => {
      return text.replaceAll(publicV3SchemaId, "urn:wakeflow:internal:config:v3-drifted");
    });
    mutateJson(path.join(coordinatedDriftRoot, "schemas/wakeflow-config.schema.json"), (payload) => {
      payload.$id = "urn:wakeflow:internal:config:v3-drifted";
    });
    const result = runCanonicalCandidateValidator(coordinatedDriftRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`public schema identifier constant must remain ${publicV3SchemaId}`));
  } finally {
    rmSync(coordinatedDriftRoot, { recursive: true, force: true });
  }
});

test("canonical validator pins the public v3 root strictness and discriminator constants", () => {
  const mutations = [
    {
      mutate(payload) { payload.$schema = "https://json-schema.org/draft/2019-09/schema"; },
      expected: /public schema must use https:\/\/json-schema\.org\/draft\/2020-12\/schema/,
    },
    {
      mutate(payload) { payload.type = "array"; },
      expected: /public schema root must be a strict object/,
    },
    {
      mutate(payload) { payload.additionalProperties = true; },
      expected: /public schema root must be a strict object/,
    },
    {
      mutate(payload) { payload.properties.$schema.const = "urn:wakeflow:internal:config:v3-wrong"; },
      expected: new RegExp(`public schema \\$schema property must require ${publicV3SchemaId}`),
    },
    {
      mutate(payload) { payload.properties.schemaVersion.const = 4; },
      expected: /public schema schemaVersion property must require 3/,
    },
    {
      mutate(payload) { payload.required = payload.required.filter((field) => field !== "schemaVersion"); },
      expected: /public schema root must require schemaVersion/,
    },
  ];

  for (const [index, scenario] of mutations.entries()) {
    const root = makeCanonicalCandidateFixture();
    try {
      mutateJson(path.join(root, "schemas/wakeflow-config.schema.json"), scenario.mutate);
      const result = runCanonicalCandidateValidator(root);
      assert.notEqual(result.status, 0, `mutation ${index} must be rejected`);
      assert.match(result.stderr, scenario.expected);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("canonical validator requires every candidate demand-artifact schema and module", () => {
  for (const relative of demandArtifactContractFiles) {
    const root = makeCanonicalCandidateFixture();
    try {
      rmSync(path.join(root, relative));
      const result = runCanonicalCandidateValidator(root);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, new RegExp(`missing file: ${relative.replaceAll(".", "\\.")}`));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("canonical validator pins candidate demand-artifact schema identity, closure, and references", () => {
  const schemaFile = "schemas/wakeflow-demand-artifacts/task-package.schema.json";
  const scenarios = [
    {
      mutate(payload) { payload.$schema = "https://json-schema.org/draft/2019-09/schema"; },
      expected: /task-package\.schema\.json must use https:\/\/json-schema\.org\/draft\/2020-12\/schema/u,
    },
    {
      mutate(payload) { payload.$id = "urn:wakeflow:internal:demand-artifacts:wrong:v1"; },
      expected: /task-package\.schema\.json \$id must be urn:wakeflow:internal:demand-artifacts:task-package:v1/u,
    },
    {
      mutate(payload) { payload.additionalProperties = true; },
      expected: /task-package\.schema\.json root must be a strict object with additionalProperties=false/u,
    },
    {
      mutate(payload) { payload.properties.artifactKind.const = "wakeflow-wrong"; },
      expected: /task-package\.schema\.json artifactKind property must require wakeflow-task-package/u,
    },
    {
      mutate(payload) { payload.properties.schemaVersion.const = 2; },
      expected: /task-package\.schema\.json schemaVersion property must require 1/u,
    },
    {
      mutate(payload) { payload.properties.programId.$ref = "#/$defs/missingProgramId"; },
      expected: /task-package\.schema\.json has unresolved \$ref #\/\$defs\/missingProgramId/u,
    },
  ];
  for (const scenario of scenarios) {
    const root = makeCanonicalCandidateFixture();
    try {
      mutateJson(path.join(root, schemaFile), scenario.mutate);
      const result = runCanonicalCandidateValidator(root);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, scenario.expected);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("canonical validator pins candidate demand-artifact exports and core-manifest membership", () => {
  const extraExportRoot = makeCanonicalCandidateFixture();
  try {
    mutateText(
      path.join(extraExportRoot, "scripts/lib/wakeflow-demand-artifact-records.mjs"),
      (text) => `${text}\nexport const unexpectedDemandArtifactExport = true;\n`,
    );
    const result = runCanonicalCandidateValidator(extraExportRoot);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /scripts\/lib\/wakeflow-demand-artifact-records\.mjs exports must be exactly:/u,
    );
  } finally {
    rmSync(extraExportRoot, { recursive: true, force: true });
  }

  const missingExportRoot = makeCanonicalCandidateFixture();
  try {
    mutateText(
      path.join(missingExportRoot, "scripts/lib/wakeflow-demand-artifact-records.mjs"),
      (text) => text.replace(
        "export function validateTaskPackageArtifact(value)",
        "function validateTaskPackageArtifact(value)",
      ),
    );
    const result = runCanonicalCandidateValidator(missingExportRoot);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /scripts\/lib\/wakeflow-demand-artifact-records\.mjs must export validateTaskPackageArtifact/u,
    );
  } finally {
    rmSync(missingExportRoot, { recursive: true, force: true });
  }

  for (const scenario of [
    {
      source: "export function loadTargetResultAuthoritySnapshot() {}\n",
      missingExport: "WakeflowTargetResultAuthorityError",
    },
    {
      source: "export class WakeflowTargetResultAuthorityError extends Error {}\n",
      missingExport: "loadTargetResultAuthoritySnapshot",
    },
  ]) {
    const missingAuthorityExportRoot = makeCanonicalCandidateFixture();
    try {
      writeFileSync(
        path.join(missingAuthorityExportRoot, "scripts/lib/wakeflow-target-result-authority.mjs"),
        scenario.source,
      );
      const result = runCanonicalCandidateValidator(missingAuthorityExportRoot);
      assert.notEqual(result.status, 0);
      assert.match(
        result.stderr,
        new RegExp(`scripts/lib/wakeflow-target-result-authority\\.mjs must export ${scenario.missingExport}`),
      );
    } finally {
      rmSync(missingAuthorityExportRoot, { recursive: true, force: true });
    }
  }

  const missingManifestEntryRoot = makeCanonicalCandidateFixture();
  try {
    mutateJson(path.join(missingManifestEntryRoot, "scripts/wakeflow-core-manifest.json"), (payload) => {
      payload.files = payload.files.filter((file) => file !== demandArtifactContractFiles[0]);
    });
    const result = runCanonicalCandidateValidator(missingManifestEntryRoot);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      new RegExp(`core manifest must include ${demandArtifactContractFiles[0].replaceAll(".", "\\.")}`),
    );
  } finally {
    rmSync(missingManifestEntryRoot, { recursive: true, force: true });
  }

  const unorderedManifestRoot = makeCanonicalCandidateFixture();
  try {
    mutateJson(path.join(unorderedManifestRoot, "scripts/wakeflow-core-manifest.json"), (payload) => {
      payload.files.reverse();
    });
    const result = runCanonicalCandidateValidator(unorderedManifestRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /core manifest files must use canonical lexical order/u);
  } finally {
    rmSync(unorderedManifestRoot, { recursive: true, force: true });
  }
});

test("canonical validator requires every managed-evidence schema and module", () => {
  const root = makeCanonicalCandidateFixture();
  try {
    for (const relative of evidenceContractFiles) rmSync(path.join(root, relative));
    const result = runCanonicalCandidateValidator(root);
    assert.notEqual(result.status, 0);
    for (const relative of evidenceContractFiles) {
      assert.match(result.stderr, new RegExp(`missing file: ${relative.replaceAll(".", "\\.")}`));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("canonical validator pins the managed-evidence schema identity, closure, and references", () => {
  const schemaFile = "schemas/wakeflow-demand-evidence/evidence.schema.json";
  const scenarios = [
    {
      mutate(payload) { payload.$id = "urn:wakeflow:internal:demand-evidence:wrong:v1"; },
      expected: /evidence\.schema\.json \$id must be urn:wakeflow:internal:demand-evidence:evidence:v1/u,
    },
    {
      mutate(payload) { payload.additionalProperties = true; },
      expected: /evidence\.schema\.json root must be a strict object with additionalProperties=false/u,
    },
    {
      mutate(payload) { payload.properties.artifactKind.const = "wakeflow-wrong"; },
      expected: /evidence\.schema\.json artifactKind property must require wakeflow-evidence/u,
    },
    {
      mutate(payload) { payload.properties.programId.$ref = "#\/$defs/missingProgramId"; },
      expected: /evidence\.schema\.json has unresolved \$ref #\/\$defs\/missingProgramId/u,
    },
  ];
  for (const scenario of scenarios) {
    const root = makeCanonicalCandidateFixture();
    try {
      mutateJson(path.join(root, schemaFile), scenario.mutate);
      const result = runCanonicalCandidateValidator(root);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, scenario.expected);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("canonical validator pins managed-evidence exports and core-manifest membership", () => {
  const extraExportRoot = makeCanonicalCandidateFixture();
  try {
    mutateText(
      path.join(extraExportRoot, "scripts/lib/wakeflow-evidence-records.mjs"),
      (text) => `${text}\nexport const unexpectedEvidenceExport = true;\n`,
    );
    const result = runCanonicalCandidateValidator(extraExportRoot);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /scripts\/lib\/wakeflow-evidence-records\.mjs exports must be exactly:/u,
    );
  } finally {
    rmSync(extraExportRoot, { recursive: true, force: true });
  }

  const missingExportRoot = makeCanonicalCandidateFixture();
  try {
    mutateText(
      path.join(missingExportRoot, "scripts/lib/wakeflow-evidence-importer.mjs"),
      (text) => text.replace(
        "export function recoverManagedEvidenceImport(runtimeContext = {})",
        "function recoverManagedEvidenceImport(runtimeContext = {})",
      ),
    );
    const result = runCanonicalCandidateValidator(missingExportRoot);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /scripts\/lib\/wakeflow-evidence-importer\.mjs must export recoverManagedEvidenceImport/u,
    );
  } finally {
    rmSync(missingExportRoot, { recursive: true, force: true });
  }

  const missingManifestEntryRoot = makeCanonicalCandidateFixture();
  try {
    mutateJson(path.join(missingManifestEntryRoot, "scripts/wakeflow-core-manifest.json"), (payload) => {
      payload.files = payload.files.filter((file) => file !== evidenceContractFiles[0]);
    });
    const result = runCanonicalCandidateValidator(missingManifestEntryRoot);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /core manifest must include schemas\/wakeflow-demand-evidence\/evidence\.schema\.json/u,
    );
  } finally {
    rmSync(missingManifestEntryRoot, { recursive: true, force: true });
  }
});

test("canonical validator requires both active-projection candidate modules", () => {
  for (const relative of activeProjectionContractFiles) {
    const root = makeCanonicalCandidateFixture();
    try {
      rmSync(path.join(root, relative));
      const result = runCanonicalCandidateValidator(root);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, new RegExp(`missing file: ${relative.replaceAll(".", "\\.")}`));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("canonical validator pins every active-projection export and core-manifest membership", () => {
  const contracts = [
    {
      file: "scripts/lib/wakeflow-config-v3-snapshot.mjs",
      statements: {
        WAKEFLOW_CONFIG_V3_SNAPSHOT_SCHEMA_VERSION: "export const WAKEFLOW_CONFIG_V3_SNAPSHOT_SCHEMA_VERSION = 1;",
        WakeflowConfigV3SnapshotError: "export class WakeflowConfigV3SnapshotError extends Error {}",
        loadWakeflowConfigV3Snapshot: "export function loadWakeflowConfigV3Snapshot() {}",
      },
    },
    {
      file: "scripts/lib/wakeflow-active-projector.mjs",
      statements: {
        WAKEFLOW_ACTIVE_PROJECTOR_SCHEMA_VERSION: "export const WAKEFLOW_ACTIVE_PROJECTOR_SCHEMA_VERSION = 1;",
        WakeflowActiveProjectorError: "export class WakeflowActiveProjectorError extends Error {}",
        inspectWakeflowActiveProjection: "export function inspectWakeflowActiveProjection() {}",
        rebuildWakeflowActiveProjection: "export function rebuildWakeflowActiveProjection() {}",
      },
    },
  ];
  for (const contract of contracts) {
    for (const missingExport of Object.keys(contract.statements)) {
      const root = makeCanonicalCandidateFixture();
      try {
        writeFileSync(
          path.join(root, contract.file),
          `${Object.entries(contract.statements)
            .filter(([name]) => name !== missingExport)
            .map(([, statement]) => statement)
            .join("\n")}\n`,
        );
        const result = runCanonicalCandidateValidator(root);
        assert.notEqual(result.status, 0);
        assert.match(
          result.stderr,
          new RegExp(`${contract.file.replaceAll(".", "\\.")} must export ${missingExport}`),
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
    const extraExportRoot = makeCanonicalCandidateFixture();
    try {
      writeFileSync(
        path.join(extraExportRoot, contract.file),
        `${Object.values(contract.statements).join("\n")}\nexport const inventedProjectionAuthority = true;\n`,
      );
      const result = runCanonicalCandidateValidator(extraExportRoot);
      assert.notEqual(result.status, 0);
      assert.match(
        result.stderr,
        new RegExp(`${contract.file.replaceAll(".", "\\.")} exports must be exactly:`),
      );
    } finally {
      rmSync(extraExportRoot, { recursive: true, force: true });
    }
  }

  const missingManifestEntryRoot = makeCanonicalCandidateFixture();
  try {
    mutateJson(path.join(missingManifestEntryRoot, "scripts/wakeflow-core-manifest.json"), (payload) => {
      payload.files = payload.files.filter((file) => file !== activeProjectionContractFiles[0]);
    });
    const result = runCanonicalCandidateValidator(missingManifestEntryRoot);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /core manifest must include scripts\/lib\/wakeflow-active-projector\.mjs/u,
    );
  } finally {
    rmSync(missingManifestEntryRoot, { recursive: true, force: true });
  }
});

test("canonical validator requires active coordination and business archive contracts", () => {
  for (const relative of [...activeCoordinationContractFiles, ...businessArchiveContractFiles]) {
    const root = makeCanonicalCandidateFixture();
    try {
      rmSync(path.join(root, relative));
      const result = runCanonicalCandidateValidator(root);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, new RegExp(`missing file: ${relative.replaceAll(".", "\\.")}`));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("canonical validator pins business archive schema identity, references, exports, and manifest", () => {
  for (const scenario of [
    {
      file: "schemas/wakeflow-business-archive/business-summary.schema.json",
      mutate(payload) { payload.$id = "urn:wakeflow:internal:business-archive:wrong:v1"; },
      expected: /business-summary\.schema\.json \$id must be urn:wakeflow:internal:business-archive:summary:v1/u,
    },
    {
      file: "schemas/wakeflow-business-archive/transport-summary.schema.json",
      mutate(payload) { payload.properties.artifactKind.const = "wakeflow-business-archive-transport-drifted"; },
      expected: /transport-summary\.schema\.json artifactKind property must require wakeflow-business-archive-transport-summary/u,
    },
    {
      file: "schemas/wakeflow-business-archive/todo-history.schema.json",
      mutate(payload) { payload.additionalProperties = true; },
      expected: /todo-history\.schema\.json root must be a strict object with additionalProperties=false/u,
    },
    {
      file: "schemas/wakeflow-business-archive/archive-transaction.schema.json",
      mutate(payload) { payload.$defs.plan.properties.archiveEvent.$ref = "urn:wakeflow:internal:demand-core:missing:v1"; },
      expected: /archive-transaction\.schema\.json has unresolved \$ref urn:wakeflow:internal:demand-core:missing:v1/u,
    },
  ]) {
    const root = makeCanonicalCandidateFixture();
    try {
      mutateJson(path.join(root, scenario.file), scenario.mutate);
      const result = runCanonicalCandidateValidator(root);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, scenario.expected);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  const serviceRoot = makeCanonicalCandidateFixture();
  try {
    mutateText(
      path.join(serviceRoot, "scripts/lib/wakeflow-business-archive-service.mjs"),
      (text) => `${text}\nexport const inventedArchiveAuthority = true;\n`,
    );
    const result = runCanonicalCandidateValidator(serviceRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /wakeflow-business-archive-service\.mjs exports must be exactly:/u);
  } finally {
    rmSync(serviceRoot, { recursive: true, force: true });
  }

  const manifestRoot = makeCanonicalCandidateFixture();
  try {
    mutateJson(path.join(manifestRoot, "scripts/wakeflow-core-manifest.json"), (payload) => {
      payload.files = payload.files.filter((file) => file !== businessArchiveContractFiles[0]);
    });
    const result = runCanonicalCandidateValidator(manifestRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /core manifest must include schemas\/wakeflow-business-archive\/archive-transaction\.schema\.json/u);
  } finally {
    rmSync(manifestRoot, { recursive: true, force: true });
  }
});

test("canonical validator pins active coordination lock exports", () => {
  const root = makeCanonicalCandidateFixture();
  try {
    writeFileSync(
      path.join(root, "scripts/lib/wakeflow-active-identity-lock.mjs"),
      "export const WAKEFLOW_ACTIVE_IDENTITY_LOCK_REF = '.wakeflow-active/current.identity-lock';\nexport const inventedLock = true;\n",
    );
    const result = runCanonicalCandidateValidator(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /wakeflow-active-identity-lock\.mjs exports must be exactly:/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("canonical validator requires every window-binding candidate file independently", () => {
  for (const relative of windowBindingContractFiles) {
    const root = makeCanonicalCandidateFixture();
    try {
      rmSync(path.join(root, relative));
      const result = runCanonicalCandidateValidator(root);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, new RegExp(`missing file: ${relative.replaceAll(".", "\\.")}`));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("canonical validator pins the window-binding schema identity and strict discriminators", () => {
  const schemaFile = "schemas/wakeflow-window-identity/window-binding.schema.json";
  const scenarios = [
    {
      mutate(payload) { payload.$schema = "https://json-schema.org/draft/2019-09/schema"; },
      expected: /window-binding\.schema\.json must use https:\/\/json-schema\.org\/draft\/2020-12\/schema/u,
    },
    {
      mutate(payload) { payload.$id = "urn:wakeflow:internal:window-identity:wrong:v1"; },
      expected: /window-binding\.schema\.json \$id must be urn:wakeflow:internal:window-identity:binding:v1/u,
    },
    {
      mutate(payload) { payload.additionalProperties = true; },
      expected: /window-binding\.schema\.json root must be a strict object with additionalProperties=false/u,
    },
    {
      mutate(payload) { payload.properties.kind.const = "wakeflow-window-binding-drifted"; },
      expected: /window-binding\.schema\.json kind property must require wakeflow-window-binding/u,
    },
    {
      mutate(payload) { payload.properties.schemaVersion.const = 2; },
      expected: /window-binding\.schema\.json schemaVersion property must require 1/u,
    },
    {
      mutate(payload) { payload.required = payload.required.filter((field) => field !== "kind"); },
      expected: /window-binding\.schema\.json root must require kind/u,
    },
    {
      mutate(payload) { payload.properties.handle.properties.kind.$ref = "#/$defs/missingOpaqueToken"; },
      expected: /window-binding\.schema\.json has unresolved \$ref #\/\$defs\/missingOpaqueToken/u,
    },
  ];
  for (const scenario of scenarios) {
    const root = makeCanonicalCandidateFixture();
    try {
      mutateJson(path.join(root, schemaFile), scenario.mutate);
      const result = runCanonicalCandidateValidator(root);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, scenario.expected);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("canonical validator pins window-binding records and service exact exports", () => {
  for (const relative of windowBindingContractFiles.filter((file) => file.endsWith(".mjs"))) {
    const root = makeCanonicalCandidateFixture();
    try {
      mutateText(
        path.join(root, relative),
        (text) => `${text}\nexport const inventedWindowBindingAuthority = true;\n`,
      );
      const result = runCanonicalCandidateValidator(root);
      assert.notEqual(result.status, 0);
      assert.match(
        result.stderr,
        new RegExp(`${relative.replaceAll(".", "\\.")} exports must be exactly:`),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("canonical validator pins window-binding record constants and manifest membership", () => {
  const recordsRoot = makeCanonicalCandidateFixture();
  try {
    mutateText(
      path.join(recordsRoot, "scripts/lib/wakeflow-window-binding-records.mjs"),
      (text) => text.replace(
        'export const WAKEFLOW_WINDOW_BINDING_KIND = "wakeflow-window-binding";',
        'export const WAKEFLOW_WINDOW_BINDING_KIND = "wakeflow-window-binding-drifted";',
      ),
    );
    const result = runCanonicalCandidateValidator(recordsRoot);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /wakeflow-window-binding-records\.mjs kind must remain wakeflow-window-binding/u,
    );
  } finally {
    rmSync(recordsRoot, { recursive: true, force: true });
  }

  const manifestRoot = makeCanonicalCandidateFixture();
  try {
    mutateJson(path.join(manifestRoot, "scripts/wakeflow-core-manifest.json"), (payload) => {
      payload.files = payload.files.filter((file) => file !== windowBindingContractFiles[0]);
    });
    const result = runCanonicalCandidateValidator(manifestRoot);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /core manifest must include schemas\/wakeflow-window-identity\/window-binding\.schema\.json/u,
    );
  } finally {
    rmSync(manifestRoot, { recursive: true, force: true });
  }
});

test("canonical validator requires every window coordination lease candidate file independently", () => {
  for (const relative of windowCoordinationLeaseContractFiles) {
    const root = makeCanonicalCandidateFixture();
    try {
      rmSync(path.join(root, relative));
      const result = runCanonicalCandidateValidator(root);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, new RegExp(`missing file: ${relative.replaceAll(".", "\\.")}`));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("canonical validator pins the window coordination lease schema identity", () => {
  const schemaFile = "schemas/wakeflow-coordination/window-lease.schema.json";
  const scenarios = [
    {
      mutate(payload) { payload.$schema = "https://json-schema.org/draft/2019-09/schema"; },
      expected: /window-lease\.schema\.json must use https:\/\/json-schema\.org\/draft\/2020-12\/schema/u,
    },
    {
      mutate(payload) { payload.$id = "urn:wakeflow:internal:coordination:wrong:v1"; },
      expected: /window-lease\.schema\.json \$id must be urn:wakeflow:internal:coordination:window-lease:v1/u,
    },
    {
      mutate(payload) { payload.additionalProperties = true; },
      expected: /window-lease\.schema\.json root must be a strict object with additionalProperties=false/u,
    },
    {
      mutate(payload) { payload.properties.kind.const = "wakeflow-window-lease-drifted"; },
      expected: /window-lease\.schema\.json kind property must require wakeflow-window-coordination-lease/u,
    },
    {
      mutate(payload) { payload.properties.schemaVersion.const = 2; },
      expected: /window-lease\.schema\.json schemaVersion property must require 1/u,
    },
    {
      mutate(payload) { payload.required = payload.required.filter((field) => field !== "kind"); },
      expected: /window-lease\.schema\.json root must require kind/u,
    },
    {
      mutate(payload) { payload.properties.programId = { $ref: "#/$defs/missingProgramId" }; },
      expected: /window-lease\.schema\.json has unresolved \$ref #\/\$defs\/missingProgramId/u,
    },
  ];
  for (const scenario of scenarios) {
    const root = makeCanonicalCandidateFixture();
    try {
      mutateJson(path.join(root, schemaFile), scenario.mutate);
      const result = runCanonicalCandidateValidator(root);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, scenario.expected);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("canonical validator pins window coordination lease exact exports and manifest membership", () => {
  for (const relative of windowCoordinationLeaseContractFiles.filter((file) => file.endsWith(".mjs"))) {
    const root = makeCanonicalCandidateFixture();
    try {
      mutateText(
        path.join(root, relative),
        (text) => `${text}\nexport const inventedWindowLeaseAuthority = true;\n`,
      );
      const result = runCanonicalCandidateValidator(root);
      assert.notEqual(result.status, 0);
      assert.match(
        result.stderr,
        new RegExp(`${relative.replaceAll(".", "\\.")} exports must be exactly:`),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  const manifestRoot = makeCanonicalCandidateFixture();
  try {
    mutateJson(path.join(manifestRoot, "scripts/wakeflow-core-manifest.json"), (payload) => {
      payload.files = payload.files.filter(
        (file) => file !== windowCoordinationLeaseContractFiles[0],
      );
    });
    const result = runCanonicalCandidateValidator(manifestRoot);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /core manifest must include schemas\/wakeflow-coordination\/window-lease\.schema\.json/u,
    );
  } finally {
    rmSync(manifestRoot, { recursive: true, force: true });
  }
});

test("canonical validator keeps the window coordination lease owner free of retired dependencies", () => {
  const candidateRoot = makeCanonicalCandidateFixture();
  try {
    mutateText(
      path.join(candidateRoot, "scripts/lib/wakeflow-window-lease-service.mjs"),
      (text) => `${text}\nimport "./wakeflow-delivery-store.mjs";\n`,
    );
    const result = runCanonicalCandidateValidator(candidateRoot);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /wakeflow-window-lease-service\.mjs must not import frozen public-v2 dependency wakeflow-delivery-store\.mjs/u,
    );
  } finally {
    rmSync(candidateRoot, { recursive: true, force: true });
  }
});

test("canonical validator requires every keep-live candidate file independently", () => {
  for (const relative of keepLiveContractFiles) {
    const root = makeCanonicalCandidateFixture();
    try {
      rmSync(path.join(root, relative));
      const result = runCanonicalCandidateValidator(root);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, new RegExp(`missing file: ${relative.replaceAll(".", "\\.")}`));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("canonical validator pins keep-live schema identity, kind, closure, and references", () => {
  const root = makeCanonicalCandidateFixture();
  try {
    mutateJson(path.join(root, "schemas/wakeflow-keep-live/lease.schema.json"), (payload) => {
      payload.$schema = "https://json-schema.org/draft/2019-09/schema";
      payload.$id = "urn:wakeflow:internal:keep-live:lease:drifted:v1";
      payload.additionalProperties = true;
      payload.properties.schemaVersion.const = 2;
      payload.properties.artifactKind.const = "wakeflow-keep-live-lease-drifted";
      payload.required = payload.required.filter((field) => field !== "artifactKind");
      payload.properties.programId = { $ref: "#/$defs/missingProgramId" };
    });
    const result = runCanonicalCandidateValidator(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /lease\.schema\.json must use https:\/\/json-schema\.org\/draft\/2020-12\/schema/u);
    assert.match(result.stderr, /lease\.schema\.json \$id must be urn:wakeflow:internal:keep-live:lease:v1/u);
    assert.match(result.stderr, /lease\.schema\.json root must be a strict object with additionalProperties=false/u);
    assert.match(result.stderr, /lease\.schema\.json schemaVersion property must require 1/u);
    assert.match(result.stderr, /lease\.schema\.json artifactKind property must require wakeflow-keep-live-lease/u);
    assert.match(result.stderr, /lease\.schema\.json root must require artifactKind/u);
    assert.match(result.stderr, /lease\.schema\.json has unresolved \$ref #\/\$defs\/missingProgramId/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("canonical validator pins keep-live exact exports, kinds, and manifest membership", () => {
  for (const relative of keepLiveContractFiles.filter((file) => file.endsWith(".mjs"))) {
    const root = makeCanonicalCandidateFixture();
    try {
      mutateText(
        path.join(root, relative),
        (text) => `${text}\nexport const inventedKeepLiveAuthority = true;\n`,
      );
      const result = runCanonicalCandidateValidator(root);
      assert.notEqual(result.status, 0);
      assert.match(
        result.stderr,
        new RegExp(`${relative.replaceAll(".", "\\.")} exports must be exactly:`),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  const kindsRoot = makeCanonicalCandidateFixture();
  try {
    mutateText(
      path.join(kindsRoot, "scripts/lib/wakeflow-keep-live-records.mjs"),
      (text) => text.replace(
        'export const WAKEFLOW_KEEP_LIVE_LEASE_KIND = "wakeflow-keep-live-lease";',
        'export const WAKEFLOW_KEEP_LIVE_LEASE_KIND = "wakeflow-keep-live-lease-drifted";',
      ),
    );
    const result = runCanonicalCandidateValidator(kindsRoot);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /wakeflow-keep-live-records\.mjs WAKEFLOW_KEEP_LIVE_LEASE_KIND must remain wakeflow-keep-live-lease/u,
    );
  } finally {
    rmSync(kindsRoot, { recursive: true, force: true });
  }

  const manifestRoot = makeCanonicalCandidateFixture();
  try {
    mutateJson(path.join(manifestRoot, "scripts/wakeflow-core-manifest.json"), (payload) => {
      payload.files = payload.files.filter((file) => !keepLiveContractFiles.includes(file));
    });
    const result = runCanonicalCandidateValidator(manifestRoot);
    assert.notEqual(result.status, 0);
    for (const relative of keepLiveContractFiles) {
      assert.match(
        result.stderr,
        new RegExp(`core manifest must include ${relative.replaceAll(".", "\\.")}`),
      );
    }
  } finally {
    rmSync(manifestRoot, { recursive: true, force: true });
  }
});

test("canonical validator keeps the keep-live owner free of retired dependencies", () => {
  const candidateRoot = makeCanonicalCandidateFixture();
  try {
    mutateText(
      path.join(candidateRoot, "scripts/lib/wakeflow-keep-live-service.mjs"),
      (text) => `${text}\nimport "./wakeflow-keep-live.mjs";\n`,
    );
    const result = runCanonicalCandidateValidator(candidateRoot);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /wakeflow-keep-live-service\.mjs must not import frozen public-v2 dependency wakeflow-keep-live\.mjs/u,
    );
  } finally {
    rmSync(candidateRoot, { recursive: true, force: true });
  }
});

test("canonical validator accepts the exact transport candidate contract", () => {
  const root = makeCanonicalCandidateFixture();
  try {
    const result = runCanonicalCandidateValidator(root);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("canonical validator requires every transport candidate file independently", () => {
  for (const relative of transportContractFiles) {
    const root = makeCanonicalCandidateFixture();
    try {
      rmSync(path.join(root, relative));
      const result = runCanonicalCandidateValidator(root);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, new RegExp(`missing file: ${relative.replaceAll(".", "\\.")}`));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("canonical validator pins all transport schema identities, kinds, and versions", () => {
  const root = makeCanonicalCandidateFixture();
  try {
    for (const contract of transportSchemaContracts) {
      mutateJson(path.join(root, contract.file), (payload) => {
        payload.$id = `${contract.id}:drifted`;
        payload.properties.schemaVersion.const = 2;
        if (typeof payload.properties.artifactKind.const === "string") {
          payload.properties.artifactKind.const = `${contract.artifactKinds[0]}-drifted`;
        } else {
          payload.properties.artifactKind.enum = [...contract.artifactKinds].reverse();
        }
      });
    }
    const result = runCanonicalCandidateValidator(root);
    assert.notEqual(result.status, 0);
    for (const contract of transportSchemaContracts) {
      const escapedFile = contract.file.replaceAll(".", "\\.");
      assert.match(result.stderr, new RegExp(`${escapedFile} \\$id must be ${contract.id}`));
      assert.match(result.stderr, new RegExp(`${escapedFile} schemaVersion property must require 1`));
      assert.match(
        result.stderr,
        new RegExp(
          `${escapedFile} artifactKind contract must be exactly: ${contract.artifactKinds.join(", ")}`,
        ),
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  const structuralRoot = makeCanonicalCandidateFixture();
  try {
    mutateJson(
      path.join(structuralRoot, "schemas/wakeflow-delivery/dispatch-group.schema.json"),
      (payload) => { payload.additionalProperties = true; },
    );
    mutateJson(
      path.join(structuralRoot, "schemas/wakeflow-delivery/delivery-run.schema.json"),
      (payload) => { payload.properties.programId = { $ref: "#/$defs/missingProgramId" }; },
    );
    const result = runCanonicalCandidateValidator(structuralRoot);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /dispatch-group\.schema\.json root must be a strict object with additionalProperties=false/u,
    );
    assert.match(
      result.stderr,
      /delivery-run\.schema\.json has unresolved \$ref #\/\$defs\/missingProgramId/u,
    );
  } finally {
    rmSync(structuralRoot, { recursive: true, force: true });
  }
});

test("canonical validator pins the archive-gated transport retention plan schema", () => {
  const root = makeCanonicalCandidateFixture();
  const relative = "schemas/wakeflow-maintenance/transport-retention-plan.schema.json";
  try {
    mutateJson(path.join(root, relative), (payload) => {
      payload.$id = "urn:wakeflow:internal:maintenance:transport-retention-plan:drifted:v1";
      payload.properties.schemaId.const = "urn:wakeflow:internal:maintenance:wrong:v1";
      payload.$defs.payload.properties.schemaVersion.const = 2;
      payload.$defs.payload.properties.artifactKind.const = "wakeflow-transport-retention-plan-drifted";
      payload.$defs.archiveVerified.additionalProperties = true;
    });
    const result = runCanonicalCandidateValidator(root);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /transport-retention-plan\.schema\.json \$id must be urn:wakeflow:internal:maintenance:transport-retention-plan:v1/u,
    );
    assert.match(
      result.stderr,
      /transport-retention-plan\.schema\.json schemaId property must require its exact \$id/u,
    );
    assert.match(
      result.stderr,
      /transport-retention-plan\.schema\.json payload schemaVersion must require 1/u,
    );
    assert.match(
      result.stderr,
      /transport-retention-plan\.schema\.json payload artifactKind must require wakeflow-transport-retention-plan/u,
    );
    assert.match(
      result.stderr,
      /transport-retention-plan\.schema\.json object schema at #\/\$defs\/archiveVerified must set additionalProperties=false/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("canonical validator pins every transport root required field and nested object closure", () => {
  const requiredRoot = makeCanonicalCandidateFixture();
  try {
    for (const contract of transportSchemaContracts) {
      mutateJson(path.join(requiredRoot, contract.file), (payload) => {
        payload.required = payload.required.slice(0, -1);
      });
    }
    const result = runCanonicalCandidateValidator(requiredRoot);
    assert.notEqual(result.status, 0);
    for (const contract of transportSchemaContracts) {
      assert.match(
        result.stderr,
        new RegExp(
          `${contract.file.replaceAll(".", "\\.")} root required contract must be exactly:`,
        ),
      );
    }
  } finally {
    rmSync(requiredRoot, { recursive: true, force: true });
  }

  const nestedRoot = makeCanonicalCandidateFixture();
  try {
    const nestedObjects = [
      ["schemas/wakeflow-delivery/dispatch-group.schema.json", "member"],
      ["schemas/wakeflow-delivery/dispatch-packet.schema.json", "taskBriefing"],
      ["schemas/wakeflow-delivery/delivery-envelope.schema.json", "transportPolicy"],
      ["schemas/wakeflow-delivery/delivery-run.schema.json", "readback"],
    ];
    for (const [relative, definition] of nestedObjects) {
      mutateJson(path.join(nestedRoot, relative), (payload) => {
        payload.$defs[definition].additionalProperties = true;
      });
    }
    const result = runCanonicalCandidateValidator(nestedRoot);
    assert.notEqual(result.status, 0);
    for (const [relative, definition] of nestedObjects) {
      assert.match(
        result.stderr,
        new RegExp(
          `${relative.replaceAll(".", "\\.")} object schema at #/\\$defs/${definition} must set additionalProperties=false`,
        ),
      );
    }
  } finally {
    rmSync(nestedRoot, { recursive: true, force: true });
  }
});

test("canonical validator pins transport records, store, delivery, and result-review exact exports", () => {
  for (const relative of transportContractFiles.filter((file) => file.endsWith(".mjs"))) {
    const root = makeCanonicalCandidateFixture();
    try {
      mutateText(
        path.join(root, relative),
        (text) => `${text}\nexport const inventedTransportAuthority = true;\n`,
      );
      const result = runCanonicalCandidateValidator(root);
      assert.notEqual(result.status, 0);
      assert.match(
        result.stderr,
        new RegExp(`${relative.replaceAll(".", "\\.")} exports must be exactly:`),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("canonical validator pins transport record constants and manifest membership", () => {
  const recordsRoot = makeCanonicalCandidateFixture();
  try {
    mutateText(
      path.join(recordsRoot, "scripts/lib/wakeflow-transport-records.mjs"),
      (text) => text
        .replace(
          "export const WAKEFLOW_TRANSPORT_SCHEMA_VERSION = 1;",
          "export const WAKEFLOW_TRANSPORT_SCHEMA_VERSION = 2;",
        )
        .replace(
          'export const WAKEFLOW_DISPATCH_GROUP_KIND = "wakeflow-dispatch-group";',
          'export const WAKEFLOW_DISPATCH_GROUP_KIND = "wakeflow-dispatch-group-drifted";',
        ),
    );
    const result = runCanonicalCandidateValidator(recordsRoot);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /wakeflow-transport-records\.mjs schema version must remain 1/u,
    );
    assert.match(
      result.stderr,
      /wakeflow-transport-records\.mjs kinds for schemas\/wakeflow-delivery\/dispatch-group\.schema\.json must match its exact schema contract/u,
    );
  } finally {
    rmSync(recordsRoot, { recursive: true, force: true });
  }

  const manifestRoot = makeCanonicalCandidateFixture();
  try {
    mutateJson(path.join(manifestRoot, "scripts/wakeflow-core-manifest.json"), (payload) => {
      payload.files = payload.files.filter((file) => !transportContractFiles.includes(file));
    });
    const result = runCanonicalCandidateValidator(manifestRoot);
    assert.notEqual(result.status, 0);
    for (const relative of transportContractFiles) {
      assert.match(
        result.stderr,
        new RegExp(`core manifest must include ${relative.replaceAll(".", "\\.")}`),
      );
    }
  } finally {
    rmSync(manifestRoot, { recursive: true, force: true });
  }
});

test("canonical validator requires the retired runtime dispatcher and trace facade to stay absent", () => {
  const publicRoot = makeCanonicalCandidateFixture();
  try {
    const retiredFiles = [
      "lib/wakeflow-runtime.mjs",
      "lib/wakeflow-trace.mjs",
    ];
    for (const relative of retiredFiles) {
      writeFileSync(path.join(publicRoot, relative), "export const unexpectedlyRestored = true;\n");
    }
    const result = runCanonicalCandidateValidator(publicRoot);
    assert.notEqual(result.status, 0);
    for (const relative of retiredFiles) {
      assert.match(
        result.stderr,
        new RegExp(`retired normal-runtime file remains: ${relative.replaceAll(".", "\\.")}`),
      );
    }
  } finally {
    rmSync(publicRoot, { recursive: true, force: true });
  }

  const candidateRoot = makeCanonicalCandidateFixture();
  try {
    mutateText(
      path.join(candidateRoot, "scripts/lib/wakeflow-transport-store.mjs"),
      (text) => `${text}\nimport "./wakeflow-delivery-store.mjs";\nimport "./wakeflow-config.mjs";\n`,
    );
    mutateText(
      path.join(candidateRoot, "scripts/lib/wakeflow-transport-retention.mjs"),
      (text) => `${text}\nimport "./wakeflow-delivery-store.mjs";\n`,
    );
    mutateText(
      path.join(candidateRoot, "scripts/lib/wakeflow-delivery-orchestration.mjs"),
      (text) => `${text}\nimport "./wakeflow-delivery-store.mjs";\n`,
    );
    mutateText(
      path.join(candidateRoot, "scripts/lib/wakeflow-result-review-orchestration.mjs"),
      (text) => `${text}\nimport "./wakeflow-controller-return.mjs";\n`,
    );
    const result = runCanonicalCandidateValidator(candidateRoot);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /wakeflow-transport-store\.mjs must not import frozen public-v2 dependency wakeflow-delivery-store\.mjs/u,
    );
    assert.match(
      result.stderr,
      /wakeflow-transport-store\.mjs must not import frozen public-v2 dependency wakeflow-config\.mjs/u,
    );
    assert.match(
      result.stderr,
      /wakeflow-transport-retention\.mjs must not import frozen public-v2 dependency wakeflow-delivery-store\.mjs/u,
    );
    assert.match(
      result.stderr,
      /wakeflow-delivery-orchestration\.mjs must not import frozen public-v2 dependency wakeflow-delivery-store\.mjs/u,
    );
    assert.match(
      result.stderr,
      /wakeflow-result-review-orchestration\.mjs must not import frozen public-v2 dependency wakeflow-controller-return\.mjs/u,
    );
  } finally {
    rmSync(candidateRoot, { recursive: true, force: true });
  }
});

test("canonical validator requires every preservation candidate file independently", () => {
  for (const relative of preservationContractFiles) {
    const root = makeCanonicalCandidateFixture();
    try {
      rmSync(path.join(root, relative));
      const result = runCanonicalCandidateValidator(root);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, new RegExp(`missing file: ${relative.replaceAll(".", "\\.")}`));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("canonical validator pins preservation schema identity, closure, and cross-schema references", () => {
  const scenarios = [
    {
      file: "schemas/wakeflow-maintenance/local-preservation.schema.json",
      mutate(payload) { payload.$id = "urn:wakeflow:internal:audit:wrong:v1"; },
      expected: /local-preservation\.schema\.json \$id must be urn:wakeflow:internal:audit:local-preservation:v1/u,
    },
    {
      file: "schemas/wakeflow-maintenance/local-preservation.schema.json",
      mutate(payload) { payload.$defs.source.additionalProperties = true; },
      expected: /local-preservation\.schema\.json object schema at #\/\$defs\/source must set additionalProperties=false/u,
    },
    {
      file: "schemas/wakeflow-maintenance/local-preservation-plan.schema.json",
      mutate(payload) { payload.properties.schemaId.const = "urn:wakeflow:internal:maintenance:wrong:v1"; },
      expected: /local-preservation-plan\.schema\.json schemaId property must require its exact \$id/u,
    },
    {
      file: "schemas/wakeflow-maintenance/local-preservation-plan.schema.json",
      mutate(payload) { payload.$defs.payload.properties.artifactKind.const = "wakeflow-wrong"; },
      expected: /local-preservation-plan\.schema\.json payload artifactKind must require wakeflow-local-preservation-plan/u,
    },
    {
      file: "schemas/wakeflow-maintenance/local-preservation-plan.schema.json",
      mutate(payload) {
        payload.$defs.payload.properties.manifest.oneOf[1].$ref = "urn:wakeflow:internal:audit:missing:v1";
      },
      expected: /local-preservation-plan\.schema\.json has unresolved \$ref urn:wakeflow:internal:audit:missing:v1/u,
    },
  ];
  for (const scenario of scenarios) {
    const root = makeCanonicalCandidateFixture();
    try {
      mutateJson(path.join(root, scenario.file), scenario.mutate);
      const result = runCanonicalCandidateValidator(root);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, scenario.expected);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("canonical validator pins preservation exact exports and core-manifest membership", () => {
  const exportRoot = makeCanonicalCandidateFixture();
  try {
    mutateText(
      path.join(exportRoot, "scripts/lib/wakeflow-preservation.mjs"),
      (text) => `${text}\nexport const inventedPreservationAuthority = true;\n`,
    );
    const result = runCanonicalCandidateValidator(exportRoot);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /scripts\/lib\/wakeflow-preservation\.mjs exports must be exactly:/u,
    );
  } finally {
    rmSync(exportRoot, { recursive: true, force: true });
  }

  const manifestRoot = makeCanonicalCandidateFixture();
  try {
    mutateJson(path.join(manifestRoot, "scripts/wakeflow-core-manifest.json"), (payload) => {
      payload.files = payload.files.filter((file) => !preservationContractFiles.includes(file));
    });
    const result = runCanonicalCandidateValidator(manifestRoot);
    assert.notEqual(result.status, 0);
    for (const relative of preservationContractFiles) {
      assert.match(
        result.stderr,
        new RegExp(`core manifest must include ${relative.replaceAll(".", "\\.")}`),
      );
    }
  } finally {
    rmSync(manifestRoot, { recursive: true, force: true });
  }
});

test("canonical validator keeps the preservation owner free of retired dependencies", () => {
  const candidateRoot = makeCanonicalCandidateFixture();
  try {
    mutateText(
      path.join(candidateRoot, "scripts/lib/wakeflow-preservation.mjs"),
      (text) => `${text}\nimport "./wakeflow-storage-map.mjs";\n`,
    );
    const result = runCanonicalCandidateValidator(candidateRoot);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /wakeflow-preservation\.mjs must not import frozen public-v2 dependency wakeflow-storage-map\.mjs/u,
    );
  } finally {
    rmSync(candidateRoot, { recursive: true, force: true });
  }
});

test("canonical validator requires the legacy classifier module and packaged catalog independently", () => {
  for (const relative of legacyClassifierContractFiles) {
    const root = makeCanonicalCandidateFixture();
    try {
      rmSync(path.join(root, relative));
      const result = runCanonicalCandidateValidator(root);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, new RegExp(`missing file: ${relative.replaceAll(".", "\\.")}`));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("canonical validator pins legacy classifier exports, catalog identity, and manifest membership", () => {
  const exportRoot = makeCanonicalCandidateFixture();
  try {
    mutateText(
      path.join(exportRoot, "scripts/lib/wakeflow-legacy-classifier.mjs"),
      (text) => `${text}\nexport const inventedLegacyClassifierAuthority = true;\n`,
    );
    const result = runCanonicalCandidateValidator(exportRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /wakeflow-legacy-classifier\.mjs exports must be exactly:/u);
  } finally {
    rmSync(exportRoot, { recursive: true, force: true });
  }

  const catalogRoot = makeCanonicalCandidateFixture();
  try {
    mutateJson(
      path.join(catalogRoot, "scripts/data/wakeflow-legacy-classifier-catalog.json"),
      (payload) => { payload.catalogDigest = `sha256:${"0".repeat(64)}`; },
    );
    const result = runCanonicalCandidateValidator(catalogRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /catalog digest does not match its canonical payload/u);
  } finally {
    rmSync(catalogRoot, { recursive: true, force: true });
  }

  const manifestRoot = makeCanonicalCandidateFixture();
  try {
    mutateJson(path.join(manifestRoot, "scripts/wakeflow-core-manifest.json"), (payload) => {
      payload.files = payload.files.filter((file) => !legacyClassifierContractFiles.includes(file));
    });
    const result = runCanonicalCandidateValidator(manifestRoot);
    assert.notEqual(result.status, 0);
    for (const relative of legacyClassifierContractFiles) {
      assert.match(
        result.stderr,
        new RegExp(`core manifest must include ${relative.replaceAll(".", "\\.")}`),
      );
    }
  } finally {
    rmSync(manifestRoot, { recursive: true, force: true });
  }
});

test("canonical validator keeps the legacy classifier behind the public-v2 import fence", () => {
  const publicRoot = makeCanonicalCandidateFixture();
  try {
    mutateText(
      path.join(publicRoot, "lib/wakeflow-mcp-tools.mjs"),
      (text) => `${text}\nimport "../scripts/lib/wakeflow-legacy-classifier.mjs";\n`,
    );
    const result = runCanonicalCandidateValidator(publicRoot);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /lib\/wakeflow-mcp-tools\.mjs must not import migration-only dependency wakeflow-legacy-classifier\.mjs/u,
    );
  } finally {
    rmSync(publicRoot, { recursive: true, force: true });
  }

  const candidateRoot = makeCanonicalCandidateFixture();
  try {
    mutateText(
      path.join(candidateRoot, "scripts/lib/wakeflow-legacy-classifier.mjs"),
      (text) => `${text}\nimport "./wakeflow-config.mjs";\n`,
    );
    const result = runCanonicalCandidateValidator(candidateRoot);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /wakeflow-legacy-classifier\.mjs must not import frozen public-v2 dependency wakeflow-config\.mjs/u,
    );
  } finally {
    rmSync(candidateRoot, { recursive: true, force: true });
  }
});

test("canonical validator pins the migration inventory export, manifest, and public-v2 import fence", () => {
  const exportRoot = makeCanonicalCandidateFixture();
  try {
    mutateText(
      path.join(exportRoot, "scripts/lib/wakeflow-migration-inventory.mjs"),
      (text) => `${text}\nexport const inventedMigrationInventoryAuthority = true;\n`,
    );
    const result = runCanonicalCandidateValidator(exportRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /wakeflow-migration-inventory\.mjs exports must be exactly:/u);
  } finally {
    rmSync(exportRoot, { recursive: true, force: true });
  }

  const manifestRoot = makeCanonicalCandidateFixture();
  try {
    mutateJson(path.join(manifestRoot, "scripts/wakeflow-core-manifest.json"), (payload) => {
      payload.files = payload.files.filter((file) => !migrationInventoryContractFiles.includes(file));
    });
    const result = runCanonicalCandidateValidator(manifestRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /core manifest must include scripts\/lib\/wakeflow-migration-inventory\.mjs/u);
  } finally {
    rmSync(manifestRoot, { recursive: true, force: true });
  }

  const publicRoot = makeCanonicalCandidateFixture();
  try {
    mutateText(
      path.join(publicRoot, "lib/wakeflow-mcp-tools.mjs"),
      (text) => `${text}\nimport "../scripts/lib/wakeflow-migration-inventory.mjs";\n`,
    );
    const result = runCanonicalCandidateValidator(publicRoot);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /lib\/wakeflow-mcp-tools\.mjs must not import migration-only dependency wakeflow-migration-inventory\.mjs/u,
    );
  } finally {
    rmSync(publicRoot, { recursive: true, force: true });
  }

  const candidateRoot = makeCanonicalCandidateFixture();
  try {
    mutateText(
      path.join(candidateRoot, "scripts/lib/wakeflow-migration-inventory.mjs"),
      (text) => `${text}\nimport "./wakeflow-config.mjs";\n`,
    );
    const result = runCanonicalCandidateValidator(candidateRoot);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /wakeflow-migration-inventory\.mjs must not import frozen public-v2 dependency wakeflow-config\.mjs/u,
    );
  } finally {
    rmSync(candidateRoot, { recursive: true, force: true });
  }
});

test("canonical validator pins owner-drain exports, packaging, and dependency direction", () => {
  const contractRoot = makeCanonicalCandidateFixture();
  try {
    mutateText(
      path.join(contractRoot, "scripts/lib/wakeflow-legacy-owner-drain.mjs"),
      (text) => `${text}\nexport const inventedOwnerDrainAuthority = true;\n`,
    );
    mutateJson(path.join(contractRoot, "scripts/wakeflow-core-manifest.json"), (payload) => {
      payload.files = payload.files.filter((file) => !legacyOwnerDrainContractFiles.includes(file));
    });
    const result = runCanonicalCandidateValidator(contractRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /wakeflow-legacy-owner-drain\.mjs exports must be exactly:/u);
    assert.match(result.stderr, /core manifest must include scripts\/lib\/wakeflow-legacy-owner-drain\.mjs/u);
  } finally {
    rmSync(contractRoot, { recursive: true, force: true });
  }

  const fenceRoot = makeCanonicalCandidateFixture();
  try {
    mutateText(
      path.join(fenceRoot, "lib/wakeflow-mcp-tools.mjs"),
      (text) => `${text}\nimport "../scripts/lib/wakeflow-legacy-owner-drain.mjs";\n`,
    );
    mutateText(
      path.join(fenceRoot, "scripts/lib/wakeflow-legacy-owner-drain.mjs"),
      (text) => `${text}\nimport "./wakeflow-config.mjs";\nimport "./wakeflow-migration-plan.mjs";\n`,
    );
    const result = runCanonicalCandidateValidator(fenceRoot);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /lib\/wakeflow-mcp-tools\.mjs must not import migration-only dependency wakeflow-legacy-owner-drain\.mjs/u,
    );
    assert.match(
      result.stderr,
      /wakeflow-legacy-owner-drain\.mjs must not import frozen public-v2 dependency wakeflow-config\.mjs/u,
    );
    assert.match(
      result.stderr,
      /wakeflow-legacy-owner-drain\.mjs must remain owner-drain evidence and not import wakeflow-migration-plan\.mjs/u,
    );
  } finally {
    rmSync(fenceRoot, { recursive: true, force: true });
  }

  const directionRoot = makeCanonicalCandidateFixture();
  try {
    mutateText(
      path.join(directionRoot, "scripts/lib/wakeflow-migration-inventory.mjs"),
      (text) => `${text}\nimport "./wakeflow-legacy-owner-drain.mjs";\n`,
    );
    mutateText(
      path.join(directionRoot, "scripts/lib/wakeflow-migration-plan.mjs"),
      (text) => text.replace(
        'from "./wakeflow-legacy-owner-drain.mjs";',
        'from "./wakeflow-canonical-json.mjs";',
      ),
    );
    const result = runCanonicalCandidateValidator(directionRoot);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /wakeflow-migration-inventory\.mjs must remain an upstream evidence producer and not import wakeflow-legacy-owner-drain\.mjs/u,
    );
    assert.match(
      result.stderr,
      /wakeflow-migration-plan\.mjs must consume wakeflow-legacy-owner-drain\.mjs/u,
    );
  } finally {
    rmSync(directionRoot, { recursive: true, force: true });
  }
});

test("canonical validator pins the migration plan export, manifest, and two-way import fence", () => {
  const exportRoot = makeCanonicalCandidateFixture();
  try {
    mutateText(
      path.join(exportRoot, "scripts/lib/wakeflow-migration-plan.mjs"),
      (text) => `${text}\nexport const inventedMigrationPlanAuthority = true;\n`,
    );
    const result = runCanonicalCandidateValidator(exportRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /wakeflow-migration-plan\.mjs exports must be exactly:/u);
  } finally {
    rmSync(exportRoot, { recursive: true, force: true });
  }

  const manifestRoot = makeCanonicalCandidateFixture();
  try {
    mutateJson(path.join(manifestRoot, "scripts/wakeflow-core-manifest.json"), (payload) => {
      payload.files = payload.files.filter((file) => !migrationPlanContractFiles.includes(file));
    });
    const result = runCanonicalCandidateValidator(manifestRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /core manifest must include scripts\/lib\/wakeflow-migration-plan\.mjs/u);
  } finally {
    rmSync(manifestRoot, { recursive: true, force: true });
  }

  const publicRoot = makeCanonicalCandidateFixture();
  try {
    mutateText(
      path.join(publicRoot, "lib/wakeflow-mcp-tools.mjs"),
      (text) => `${text}\nimport "../scripts/lib/wakeflow-migration-plan.mjs";\n`,
    );
    const result = runCanonicalCandidateValidator(publicRoot);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /lib\/wakeflow-mcp-tools\.mjs must not import migration-only dependency wakeflow-migration-plan\.mjs/u,
    );
  } finally {
    rmSync(publicRoot, { recursive: true, force: true });
  }

  const candidateRoot = makeCanonicalCandidateFixture();
  try {
    mutateText(
      path.join(candidateRoot, "scripts/lib/wakeflow-migration-plan.mjs"),
      (text) => `${text}\nimport "./wakeflow-config.mjs";\n`,
    );
    const result = runCanonicalCandidateValidator(candidateRoot);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /wakeflow-migration-plan\.mjs must not import frozen public-v2 dependency wakeflow-config\.mjs/u,
    );
  } finally {
    rmSync(candidateRoot, { recursive: true, force: true });
  }

  const inventoryRoot = makeCanonicalCandidateFixture();
  try {
    mutateText(
      path.join(inventoryRoot, "scripts/lib/wakeflow-migration-inventory.mjs"),
      (text) => `${text}\nimport "./wakeflow-migration-plan.mjs";\n`,
    );
    const result = runCanonicalCandidateValidator(inventoryRoot);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /wakeflow-migration-inventory\.mjs must remain an inventory producer and not import wakeflow-migration-plan\.mjs/u,
    );
  } finally {
    rmSync(inventoryRoot, { recursive: true, force: true });
  }
});

test("canonical validator pins legacy archive schemas, exports, packaging, and owner direction", () => {
  const contractRoot = makeCanonicalCandidateFixture();
  try {
    mutateText(
      path.join(contractRoot, "scripts/lib/wakeflow-legacy-archive-records.mjs"),
      (text) => `${text}\nexport const inventedLegacyArchiveCodec = true;\n`,
    );
    mutateText(
      path.join(contractRoot, "scripts/lib/wakeflow-legacy-archive-transform.mjs"),
      (text) => `${text}\nexport const inventedLegacyArchiveOwner = true;\n`,
    );
    mutateJson(path.join(contractRoot, "scripts/wakeflow-core-manifest.json"), (payload) => {
      payload.files = payload.files.filter((file) => !legacyArchiveContractFiles.includes(file));
    });
    const result = runCanonicalCandidateValidator(contractRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /wakeflow-legacy-archive-records\.mjs exports must be exactly:/u);
    assert.match(result.stderr, /wakeflow-legacy-archive-transform\.mjs exports must be exactly:/u);
    assert.match(
      result.stderr,
      /core manifest must include schemas\/wakeflow-maintenance\/legacy-archive-transform-plan\.schema\.json/u,
    );
  } finally {
    rmSync(contractRoot, { recursive: true, force: true });
  }

  const schemaRoot = makeCanonicalCandidateFixture();
  try {
    mutateJson(
      path.join(schemaRoot, "schemas/wakeflow-maintenance/legacy-archive-transform-plan.schema.json"),
      (payload) => {
        payload.$defs.sourceAuthority.required = payload.$defs.sourceAuthority.required
          .filter((field) => field !== "sourceIds");
        payload.$defs.sourceAuthority.properties.sourceIds.minItems = 0;
      },
    );
    const result = runCanonicalCandidateValidator(schemaRoot);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /legacy archive transform source authority must require exact T06 sourceIds/u,
    );
  } finally {
    rmSync(schemaRoot, { recursive: true, force: true });
  }

  const fenceRoot = makeCanonicalCandidateFixture();
  try {
    mutateText(
      path.join(fenceRoot, "lib/wakeflow-mcp-tools.mjs"),
      (text) => `${text}\nimport "../scripts/lib/wakeflow-legacy-archive-transform.mjs";\n`,
    );
    mutateText(
      path.join(fenceRoot, "scripts/lib/wakeflow-migration-plan.mjs"),
      (text) => `${text}\nimport "./wakeflow-legacy-archive-transform.mjs";\n`,
    );
    const result = runCanonicalCandidateValidator(fenceRoot);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /lib\/wakeflow-mcp-tools\.mjs must not import migration-only dependency wakeflow-legacy-archive-transform\.mjs/u,
    );
    assert.match(
      result.stderr,
      /wakeflow-migration-plan\.mjs must remain upstream of legacy archive transform and not import wakeflow-legacy-archive-transform\.mjs/u,
    );
  } finally {
    rmSync(fenceRoot, { recursive: true, force: true });
  }
});

test("canonical validator pins migration-only host decommission exports and packaging", () => {
  const sharedRoot = makeCanonicalCandidateFixture();
  try {
    mutateText(
      path.join(sharedRoot, "scripts/lib/wakeflow-migration-host-decommission.mjs"),
      (text) => `${text}\nexport const inventedMigrationHostDecommissionAuthority = true;\n`,
    );
    const result = runCanonicalCandidateValidator(sharedRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /wakeflow-migration-host-decommission\.mjs exports must be exactly:/u);
  } finally {
    rmSync(sharedRoot, { recursive: true, force: true });
  }

  const hostRoot = makeCanonicalCandidateFixture();
  try {
    mutateText(
      path.join(hostRoot, "scripts/lib/wakeflow-codex-migration-decommission.mjs"),
      (text) => `${text}\nexport const inventedCodexMigrationDecommissionAuthority = true;\n`,
    );
    const result = runCanonicalCandidateValidator(hostRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /wakeflow-codex-migration-decommission\.mjs exports must be exactly:/u);
  } finally {
    rmSync(hostRoot, { recursive: true, force: true });
  }

  const manifestRoot = makeCanonicalCandidateFixture();
  try {
    mutateJson(path.join(manifestRoot, "scripts/wakeflow-core-manifest.json"), (payload) => {
      payload.files = payload.files.filter((file) => !migrationHostDecommissionContractFiles.includes(file));
    });
    const result = runCanonicalCandidateValidator(manifestRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /core manifest must include scripts\/lib\/wakeflow-migration-host-decommission\.mjs/u);
  } finally {
    rmSync(manifestRoot, { recursive: true, force: true });
  }
});

test("canonical validator keeps migration host decommission behind its T07 dependency fences", () => {
  const root = makeCanonicalCandidateFixture();
  try {
    mutateText(
      path.join(root, "lib/wakeflow-mcp-tools.mjs"),
      (text) => `${text}\nimport "../scripts/lib/wakeflow-migration-host-decommission.mjs";\nimport "../scripts/lib/wakeflow-codex-migration-decommission.mjs";\n`,
    );
    mutateText(
      path.join(root, "scripts/lib/wakeflow-migration-host-decommission.mjs"),
      (text) => `${text}\nimport "./wakeflow-config.mjs";\n`,
    );
    mutateText(
      path.join(root, "scripts/lib/wakeflow-codex-migration-decommission.mjs"),
      (text) => `${text}\nimport "./wakeflow-codex-decommission.mjs";\n`,
    );
    mutateText(
      path.join(root, "scripts/lib/wakeflow-migration-plan.mjs"),
      (text) => `${text}\nimport "./wakeflow-migration-host-decommission.mjs";\n`,
    );
    const result = runCanonicalCandidateValidator(root);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /lib\/wakeflow-mcp-tools\.mjs must not import migration-only dependency wakeflow-migration-host-decommission\.mjs/u,
    );
    assert.match(
      result.stderr,
      /lib\/wakeflow-mcp-tools\.mjs must not import migration-only dependency wakeflow-codex-migration-decommission\.mjs/u,
    );
    assert.match(
      result.stderr,
      /wakeflow-migration-host-decommission\.mjs must not import frozen public-v2 dependency wakeflow-config\.mjs/u,
    );
    assert.match(
      result.stderr,
      /wakeflow-codex-migration-decommission\.mjs must not import wakeflow-codex-decommission\.mjs/u,
    );
    assert.match(
      result.stderr,
      /wakeflow-migration-plan\.mjs must remain upstream of migration host decommission and not import wakeflow-migration-host-decommission\.mjs/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("canonical validator accepts the exact window-runtime candidate contract", () => {
  const root = makeCanonicalCandidateFixture();
  try {
    const result = runCanonicalCandidateValidator(root);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("canonical validator requires every window-runtime candidate file independently", () => {
  for (const relative of windowRuntimeContractFiles) {
    const root = makeCanonicalCandidateFixture();
    try {
      rmSync(path.join(root, relative));
      const result = runCanonicalCandidateValidator(root);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, new RegExp(`missing file: ${relative.replaceAll(".", "\\.")}`));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("canonical validator pins the window-runtime schema identity and strict discriminators", () => {
  const schemaFile = "schemas/wakeflow-window-runtime/window-runtime.schema.json";
  const scenarios = [
    {
      mutate(payload) { payload.$schema = "https://json-schema.org/draft/2019-09/schema"; },
      expected: /window-runtime\.schema\.json must use https:\/\/json-schema\.org\/draft\/2020-12\/schema/u,
    },
    {
      mutate(payload) { payload.$id = "urn:wakeflow:internal:window-runtime:wrong:v1"; },
      expected: /window-runtime\.schema\.json \$id must be urn:wakeflow:internal:window-runtime:projection:v1/u,
    },
    {
      mutate(payload) { payload.additionalProperties = true; },
      expected: /window-runtime\.schema\.json root must be a strict object with additionalProperties=false/u,
    },
    {
      mutate(payload) { payload.properties.kind.const = "wakeflow-window-runtime-drifted"; },
      expected: /window-runtime\.schema\.json kind property must require wakeflow-window-runtime-projection/u,
    },
    {
      mutate(payload) { payload.properties.schemaVersion.const = 2; },
      expected: /window-runtime\.schema\.json schemaVersion property must require 1/u,
    },
    {
      mutate(payload) { payload.required = payload.required.filter((field) => field !== "kind"); },
      expected: /window-runtime\.schema\.json root must require kind/u,
    },
    {
      mutate(payload) { payload.properties.programId = { $ref: "#/$defs/missingProgramId" }; },
      expected: /window-runtime\.schema\.json has unresolved \$ref #\/\$defs\/missingProgramId/u,
    },
  ];
  for (const scenario of scenarios) {
    const root = makeCanonicalCandidateFixture();
    try {
      mutateJson(path.join(root, schemaFile), scenario.mutate);
      const result = runCanonicalCandidateValidator(root);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, scenario.expected);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("canonical validator pins window-runtime records and projector exact exports", () => {
  for (const relative of windowRuntimeContractFiles.filter((file) => file.endsWith(".mjs"))) {
    const root = makeCanonicalCandidateFixture();
    try {
      mutateText(
        path.join(root, relative),
        (text) => `${text}\nexport const inventedWindowRuntimeAuthority = true;\n`,
      );
      const result = runCanonicalCandidateValidator(root);
      assert.notEqual(result.status, 0);
      assert.match(
        result.stderr,
        new RegExp(`${relative.replaceAll(".", "\\.")} exports must be exactly:`),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("canonical validator pins window-runtime record constants and manifest membership", () => {
  const recordsRoot = makeCanonicalCandidateFixture();
  try {
    mutateText(
      path.join(recordsRoot, "scripts/lib/wakeflow-window-runtime-records.mjs"),
      (text) => text.replace(
        'export const WAKEFLOW_WINDOW_RUNTIME_KIND = "wakeflow-window-runtime-projection";',
        'export const WAKEFLOW_WINDOW_RUNTIME_KIND = "wakeflow-window-runtime-drifted";',
      ),
    );
    const result = runCanonicalCandidateValidator(recordsRoot);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /wakeflow-window-runtime-records\.mjs kind must remain wakeflow-window-runtime-projection/u,
    );
  } finally {
    rmSync(recordsRoot, { recursive: true, force: true });
  }

  const manifestRoot = makeCanonicalCandidateFixture();
  try {
    mutateJson(path.join(manifestRoot, "scripts/wakeflow-core-manifest.json"), (payload) => {
      payload.files = payload.files.filter((file) => file !== windowRuntimeContractFiles[0]);
    });
    const result = runCanonicalCandidateValidator(manifestRoot);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /core manifest must include schemas\/wakeflow-window-runtime\/window-runtime\.schema\.json/u,
    );
  } finally {
    rmSync(manifestRoot, { recursive: true, force: true });
  }
});

test("canonical validator keeps the window-runtime owner free of retired dependencies", () => {
  const candidateRoot = makeCanonicalCandidateFixture();
  try {
    mutateText(
      path.join(candidateRoot, "scripts/lib/wakeflow-window-runtime-projector.mjs"),
      (text) => `${text}\nimport "./wakeflow-thread-registry.mjs";\n`,
    );
    const result = runCanonicalCandidateValidator(candidateRoot);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /wakeflow-window-runtime-projector\.mjs must not import frozen public-v2 dependency wakeflow-thread-registry\.mjs/u,
    );
  } finally {
    rmSync(candidateRoot, { recursive: true, force: true });
  }
});

test("canonical validator requires and freezes the complete public v3 maintenance surface", () => {
  for (const relative of maintenanceSurfaceContractFiles) {
    const root = makeCanonicalCandidateFixture();
    try {
      rmSync(path.join(root, relative));
      const result = run(root);
      assert.notEqual(result.status, 0);
      assert.match(
        result.stderr,
        new RegExp(`missing file: ${relative.replaceAll(".", "\\.")}`),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  const surfaceRoot = makeCanonicalCandidateFixture();
  try {
    mutateText(
      path.join(surfaceRoot, "scripts/lib/wakeflow-maintenance-action-runtime.mjs"),
      (text) => `${text}\nexport const unexpectedMaintenanceRuntimeSurface = true;\n`,
    );
    mutateText(
      path.join(surfaceRoot, "lib/wakeflow-mcp-tools.mjs"),
      (text) => text.replace("  name: MAINTENANCE_TOOL,", '  name: "wakeflow_drifted_workspace",'),
    );
    const result = runCanonicalCandidateValidator(surfaceRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /wakeflow-maintenance-action-runtime\.mjs exports must be exactly:/u);
    assert.match(result.stderr, /tools must be the exact ordered 31-tool public v3 surface/u);
  } finally {
    rmSync(surfaceRoot, { recursive: true, force: true });
  }

  const manifestRoot = makeCanonicalCandidateFixture();
  try {
    mutateJson(path.join(manifestRoot, "scripts/wakeflow-core-manifest.json"), (payload) => {
      payload.files = payload.files.filter((file) => file !== maintenanceSurfaceContractFiles[0]);
    });
    const result = runCanonicalCandidateValidator(manifestRoot);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /core manifest must include lib\/wakeflow-mcp-tools\.mjs/u,
    );
  } finally {
    rmSync(manifestRoot, { recursive: true, force: true });
  }
});

test("canonical validator rejects every retired candidate entrypoint after public cutover", () => {
  const root = makeCanonicalCandidateFixture();
  try {
    writeFileSync(path.join(root, "lib/wakeflow-mcp-tools-v3-candidate.mjs"), "export const retired = true;\n");
    const result = runCanonicalCandidateValidator(root);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /retired public candidate file remains: lib\/wakeflow-mcp-tools-v3-candidate\.mjs/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("canonical validator rejects an actual host profile that violates the capability contract", () => {
  const root = makeCanonicalCandidateFixture();
  try {
    mutateText(path.join(root, "scripts/lib/wakeflow-host-profile.mjs"), (text) => {
      return text.replace('    identity: { applicable: true, realization: "current" },\n', "");
    });
    const result = runCanonicalCandidateValidator(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /host profile does not satisfy the capability contract.*missing capability identity/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("canonical validator requires the actual host profile to stay frozen and minimal", () => {
  const root = makeCanonicalCandidateFixture();
  try {
    mutateText(path.join(root, "scripts/lib/wakeflow-host-profile.mjs"), (text) => {
      return text
        .replace("export const hostProfile = deepFreeze({", "export const hostProfile = ({")
        .replace('  hostName: "Codex",\n', '  hostName: "Codex",\n  decisionOwner: "retired-owner",\n');
    });
    const result = runCanonicalCandidateValidator(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /host profile and every data subtree must be frozen/u);
    assert.match(result.stderr, /host profile must not retain unused field decisionOwner/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("canonical validator keeps the public schema, defaults, and normal runtime free of the retired internal URN", () => {
  const root = makeCanonicalCandidateFixture();
  try {
    mutateJson(path.join(root, "schemas/wakeflow-config.schema.json"), (payload) => {
      payload.description = retiredCandidateSchemaId;
    });
    mutateJson(path.join(root, "wakeflow.config.example.json"), (payload) => {
      payload.$schema = retiredCandidateSchemaId;
    });
    mutateText(path.join(root, "scripts/lib/wakeflow-config-v3.mjs"), (text) => {
      return `${text}\n// ${retiredCandidateSchemaId}\n`;
    });
    const result = runCanonicalCandidateValidator(root);
    assert.notEqual(result.status, 0);
    for (const file of [
      "schemas/wakeflow-config.schema.json",
      "wakeflow.config.example.json",
      "scripts/lib/wakeflow-config-v3.mjs",
    ]) {
      assert.match(result.stderr, new RegExp(`${file.replaceAll(".", "\\.")} must not reference the retired internal config candidate schema`));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("canonical validator pins the normal runtime and sole public schema to v3", () => {
  const root = makeCanonicalCandidateFixture();
  try {
    mutateText(path.join(root, "scripts/lib/wakeflow-config-v3.mjs"), (text) => {
      return text.replace("export const WAKEFLOW_CONFIG_V3_VERSION = 3;", "export const WAKEFLOW_CONFIG_V3_VERSION = 2;");
    });
    mutateJson(path.join(root, "schemas/wakeflow-config.schema.json"), (payload) => {
      payload.properties.schemaVersion.const = 2;
    });
    const result = runCanonicalCandidateValidator(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /normal runtime config schema version must be v3 \(3\), found 2/);
    assert.match(result.stderr, /public config schema must require schemaVersion 3/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails when the retired v2 template bundle is reintroduced", () => {
  const root = makeFixture();
  try {
    writeFileSync(path.join(root, "templates/wakeflow-template-bundle.json"), "{}\n");
    const result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /retired public candidate file remains: templates\/wakeflow-template-bundle\.json/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails when plugin starter prompts exceed the Codex UI limit", () => {
  const root = makeFixture();
  try {
    mutateJson(path.join(root, ".codex-plugin/plugin.json"), (payload) => {
      payload.interface.defaultPrompt.push("Run Wakeflow control status");
    });
    const result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /defaultPrompt must contain at most 3 prompts/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails when project-specific names leak into reusable runtime text", () => {
  const root = makeFixture();
  try {
    mkdirSync(path.join(root, "docs"), { recursive: true });
    writeFileSync(path.join(root, "docs/bad.md"), "# Bad\n\nAlembicWorkspace should not be a reusable default.\n");
    const result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /project-specific token AlembicWorkspace remains in docs\/bad\.md/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails when non-English project text is introduced", () => {
  const root = makeFixture();
  try {
    mkdirSync(path.join(root, "docs"), { recursive: true });
    writeFileSync(path.join(root, "docs/bad.md"), `# Bad\n\n${"\u4e2d\u6587\u5185\u5bb9"}\n`);
    const result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /non-English Han text remains in docs\/bad\.md/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("allows the localized Chinese README", () => {
  const root = makeFixture();
  try {
    writeFileSync(path.join(root, "README.zh-CN.md"), `# Wakeflow\n\n${"\u4e2d\u6587\u8bf4\u660e\uff1a\u53ef\u672c\u5730\u5316\u3002"}\n`);
    const result = run(root);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("allows admitted localized review comments but rejects localized runtime text", () => {
  const root = makeFixture();
  try {
    const baseline = run(root);
    assert.equal(baseline.status, 0, baseline.stderr || baseline.stdout);

    for (const relative of [
      "bin/wakeflow-bootstrap",
      "lib/wakeflow-mcp-tools.mjs",
      "mcp/server.cjs",
      "scripts/lib/wakeflow-active-foundation.mjs",
      "scripts/lib/wakeflow-artifact-tree-identity.mjs",
      "scripts/lib/wakeflow-atomic-write.mjs",
      "scripts/lib/wakeflow-canonical-json.mjs",
      "scripts/lib/wakeflow-codex-migration-decommission.mjs",
      "scripts/lib/wakeflow-codex-migration-effect.mjs",
      "scripts/lib/wakeflow-config-v3.mjs",
      "scripts/lib/wakeflow-config-v3-owner.mjs",
      "scripts/lib/wakeflow-config-v3-snapshot.mjs",
      "scripts/lib/wakeflow-config-v3-transition-authority.mjs",
      "scripts/lib/wakeflow-demand-layout.mjs",
      "scripts/lib/wakeflow-codex-activation-scope.mjs",
      "scripts/lib/wakeflow-codex-decommission.mjs",
      "scripts/lib/wakeflow-host-activation-gate.mjs",
      "scripts/lib/wakeflow-host-activation-scope.mjs",
      "scripts/lib/wakeflow-host-capability.mjs",
      "scripts/lib/wakeflow-host-decommission-result.mjs",
      "scripts/lib/wakeflow-host-artifact-checks.mjs",
      "scripts/lib/wakeflow-host-profile.mjs",
      "scripts/lib/wakeflow-host-settings-assets-owner.mjs",
      "scripts/lib/wakeflow-identifiers.mjs",
      "scripts/lib/wakeflow-layout-descriptor.mjs",
      "scripts/lib/wakeflow-local-layout-inspection.mjs",
      "scripts/lib/wakeflow-local-layout-realization.mjs",
      "scripts/lib/wakeflow-local-layout.mjs",
      "scripts/lib/wakeflow-fresh-initialize.mjs",
      "scripts/lib/wakeflow-fs-safety.mjs",
      "scripts/lib/wakeflow-maintenance-action-composition.mjs",
      "scripts/lib/wakeflow-maintenance-action-runtime.mjs",
      "scripts/lib/wakeflow-maintenance-coordinator.mjs",
      "scripts/lib/wakeflow-maintenance-plan.mjs",
      "scripts/lib/wakeflow-managed-content.mjs",
      "scripts/lib/wakeflow-migration-apply.mjs",
      "scripts/lib/wakeflow-migration-config-owner.mjs",
      "scripts/lib/wakeflow-migration-host-decommission.mjs",
      "scripts/lib/wakeflow-migration-plan.mjs",
      "scripts/lib/wakeflow-migration-production.mjs",
      "scripts/lib/wakeflow-legacy-archive-records.mjs",
      "scripts/lib/wakeflow-legacy-archive-transform.mjs",
      "scripts/lib/wakeflow-legacy-owner-drain.mjs",
      "scripts/lib/wakeflow-observability-v3.mjs",
      "scripts/lib/wakeflow-public-v3-runtime.mjs",
      "scripts/lib/wakeflow-reconcile.mjs",
      "scripts/lib/wakeflow-reconfigure.mjs",
      "scripts/lib/wakeflow-state-lock.mjs",
      "scripts/lib/wakeflow-support-materialization.mjs",
      "scripts/lib/wakeflow-support-surface-owner.mjs",
      "scripts/lib/wakeflow-template-renderer.mjs",
      "scripts/lib/wakeflow-todo-table.mjs",
      "scripts/lib/wakeflow-tracked-materialization.mjs",
      "scripts/lib/wakeflow-workspace-mutation.mjs",
      "scripts/wakeflow-bootstrap.mjs",
      "scripts/wakeflow-cli.mjs",
      "scripts/wakeflow-setup.mjs",
      "scripts/wakeflow-smoke.mjs",
      "scripts/wakeflow-validate.mjs",
    ]) {
      const file = path.join(root, relative);
      const source = readFileSync(file, "utf8");
      writeFileSync(
        file,
        `${source}\nconst localizedRuntimeLeak = "${"\u4e2d\u6587\u8fd0\u884c\u65f6"}";\n`,
      );
      const result = run(root);
      assert.notEqual(result.status, 0, relative);
      assert.match(
        result.stderr,
        new RegExp(`non-English Han text remains in ${relative.replaceAll(".", "\\.")}`),
      );
      writeFileSync(file, source);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("allows Claude host review comments but rejects localized runtime text", () => {
  const root = makeFixture(claudeWorkspaceRoot);
  try {
    const baseline = runClaude(root);
    assert.equal(baseline.status, 0, baseline.stderr || baseline.stdout);
    for (const relative of [
      "scripts/lib/wakeflow-claude-activity.mjs",
      "scripts/lib/wakeflow-claude-host.mjs",
      "scripts/lib/wakeflow-claude-activation-scope.mjs",
      "scripts/lib/wakeflow-claude-decommission.mjs",
      "scripts/lib/wakeflow-claude-lifecycle.mjs",
      "scripts/lib/wakeflow-claude-locator.mjs",
      "scripts/lib/wakeflow-claude-settings.mjs",
      "scripts/lib/wakeflow-claude-transport.mjs",
      "scripts/lib/wakeflow-host-artifact-checks.mjs",
    ]) {
      const file = path.join(root, relative);
      const source = readFileSync(file, "utf8");
      writeFileSync(
        file,
        `${source}\nconst localizedRuntimeLeak = "${"\u4e2d\u6587\u8fd0\u884c\u65f6"}";\n`,
      );
      const result = runClaude(root);
      assert.notEqual(result.status, 0, relative);
      assert.match(
        result.stderr,
        new RegExp(`non-English Han text remains in ${relative.replaceAll(".", "\\.")}`),
      );
      writeFileSync(file, source);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("localized comment admission does not hide code on a multiplication continuation line", () => {
  const root = makeFixture();
  try {
    mutateText(
      path.join(root, "scripts/lib/wakeflow-config-v3-snapshot.mjs"),
      (text) => `${text}\nconst localizedRuntimeLeak = 1\n  * "${"\u4e2d\u6587\u8fd0\u884c\u65f6"}";\n`,
    );
    const result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /non-English Han text remains in scripts\/lib\/wakeflow-config-v3-snapshot\.mjs/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ignores local runtime text while validating the reusable plugin package", () => {
  const root = makeFixture();
  try {
    mkdirSync(path.join(root, ".wakeflow-active/current"), { recursive: true });
    mkdirSync(path.join(root, ".wakeflow-local"), { recursive: true });
    writeFileSync(
      path.join(root, ".wakeflow-active/current/local.md"),
      `# Local\n\n${"\u4e2d\u6587\u8fd0\u884c\u6001"}\n`,
    );
    writeFileSync(path.join(root, ".wakeflow-local/local.json"), JSON.stringify({ note: "\u672c\u5730" }));
    const result = run(root);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
