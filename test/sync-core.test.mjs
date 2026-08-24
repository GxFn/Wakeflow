import assert from "node:assert/strict";
import { spawnSync as runSync } from "node:child_process";
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const script = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../tools/sync-core.mjs");
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
const demandLifecycleContractFiles = [
  "schemas/wakeflow-demand-core/controller-event.schema.json",
  "schemas/wakeflow-demand-core/wakeflow-state.schema.json",
  "scripts/lib/wakeflow-demand-core-records.mjs",
  "scripts/lib/wakeflow-demand-lifecycle-orchestration.mjs",
  "scripts/lib/wakeflow-demand-state-service.mjs",
];
const evidenceContractFiles = [
  "schemas/wakeflow-demand-evidence/evidence.schema.json",
  "scripts/lib/wakeflow-evidence-importer.mjs",
  "scripts/lib/wakeflow-evidence-records.mjs",
  "scripts/lib/wakeflow-evidence-tree.mjs",
];
const activeProjectionContractFiles = [
  "scripts/lib/wakeflow-active-identity-lock.mjs",
  "scripts/lib/wakeflow-active-projection-lock.mjs",
  "scripts/lib/wakeflow-active-projector.mjs",
  "scripts/lib/wakeflow-config-v3-snapshot.mjs",
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
const hostDecommissionContractFiles = [
  "schemas/wakeflow-window-identity/host-decommission-result.schema.json",
  "scripts/lib/wakeflow-host-decommission-result.mjs",
];
const hostActivationScopeContractFiles = [
  "scripts/lib/wakeflow-host-activation-gate.mjs",
  "scripts/lib/wakeflow-host-activation-scope.mjs",
];
const windowCoordinationLeaseContractFiles = [
  "schemas/wakeflow-coordination/window-lease.schema.json",
  "scripts/lib/wakeflow-window-lease-records.mjs",
  "scripts/lib/wakeflow-window-lease-service.mjs",
];
const podContractFiles = [
  "schemas/wakeflow-pod/close-intent.schema.json",
  "schemas/wakeflow-pod/close-receipt.schema.json",
  "schemas/wakeflow-pod/creation-receipt.schema.json",
  "schemas/wakeflow-pod/launch-intent.schema.json",
  "schemas/wakeflow-pod/materialization-event.schema.json",
  "schemas/wakeflow-pod/pod-scope.schema.json",
  "schemas/wakeflow-pod/resume-observation.schema.json",
  "schemas/wakeflow-pod/test-access-plan.schema.json",
  "schemas/wakeflow-pod/test-access-receipt.schema.json",
  "scripts/lib/wakeflow-pod-records.mjs",
  "scripts/lib/wakeflow-pod-service.mjs",
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
const transportContractFiles = [
  "schemas/wakeflow-delivery/delivery-envelope.schema.json",
  "schemas/wakeflow-delivery/delivery-run.schema.json",
  "schemas/wakeflow-delivery/dispatch-group.schema.json",
  "schemas/wakeflow-delivery/dispatch-packet.schema.json",
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
const artifactTreeIdentityContractFiles = [
  "scripts/lib/wakeflow-artifact-tree-identity.mjs",
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
const migrationApplyContractFiles = [
  "bin/wakeflow-bootstrap",
  "schemas/wakeflow-maintenance/maintenance-transaction.schema.json",
  "schemas/wakeflow-maintenance/recovery-claim.schema.json",
  "schemas/wakeflow-maintenance/workspace-mutation-lock.schema.json",
  "scripts/lib/wakeflow-migration-apply.mjs",
  "scripts/lib/wakeflow-migration-config-owner.mjs",
  "scripts/lib/wakeflow-migration-production.mjs",
  "scripts/lib/wakeflow-workspace-mutation.mjs",
  "scripts/wakeflow-bootstrap.mjs",
];
const maintenancePlanContractFiles = [
  "schemas/wakeflow-maintenance/workspace-maintenance-plan.schema.json",
  "scripts/lib/wakeflow-active-foundation.mjs",
  "scripts/lib/wakeflow-config-v3-owner.mjs",
  "scripts/lib/wakeflow-config-v3-transition-authority.mjs",
  "scripts/lib/wakeflow-fresh-initialize.mjs",
  "scripts/lib/wakeflow-host-settings-assets-owner.mjs",
  "scripts/lib/wakeflow-ledger-materialization.mjs",
  "scripts/lib/wakeflow-ledger-projector.mjs",
  "scripts/lib/wakeflow-local-layout-inspection.mjs",
  "scripts/lib/wakeflow-local-layout-realization.mjs",
  "scripts/lib/wakeflow-managed-content.mjs",
  "scripts/lib/wakeflow-maintenance-action-composition.mjs",
  "scripts/lib/wakeflow-maintenance-plan.mjs",
  "scripts/lib/wakeflow-observability-v3.mjs",
  "scripts/lib/wakeflow-reconcile.mjs",
  "scripts/lib/wakeflow-reconfigure.mjs",
  "scripts/lib/wakeflow-support-materialization.mjs",
  "scripts/lib/wakeflow-support-surface-owner.mjs",
  "scripts/lib/wakeflow-tracked-materialization.mjs",
];
const publicV3SurfaceContractFiles = [
  "lib/wakeflow-mcp-tools.mjs",
  "scripts/lib/wakeflow-maintenance-action-runtime.mjs",
  "scripts/lib/wakeflow-maintenance-coordinator.mjs",
  "scripts/lib/wakeflow-public-v3-runtime.mjs",
  "scripts/wakeflow-cli.mjs",
  "scripts/wakeflow-setup.mjs",
  "scripts/wakeflow-smoke.mjs",
  "scripts/wakeflow-validate.mjs",
];
const sharedContractFiles = [
  ...demandArtifactContractFiles,
  ...demandLifecycleContractFiles,
  ...evidenceContractFiles,
  ...activeProjectionContractFiles,
  ...businessArchiveContractFiles,
  ...windowBindingContractFiles,
  ...hostDecommissionContractFiles,
  ...hostActivationScopeContractFiles,
  ...windowCoordinationLeaseContractFiles,
  ...podContractFiles,
  ...keepLiveContractFiles,
  ...transportContractFiles,
  ...preservationContractFiles,
  ...artifactTreeIdentityContractFiles,
  ...legacyClassifierContractFiles,
  ...migrationInventoryContractFiles,
  ...legacyOwnerDrainContractFiles,
  ...legacyArchiveContractFiles,
  ...migrationPlanContractFiles,
  ...migrationHostDecommissionContractFiles,
  ...migrationApplyContractFiles,
  ...maintenancePlanContractFiles,
  ...publicV3SurfaceContractFiles,
].sort();

const commonHostFiles = [
  ".mcp.json",
  "README.md",
  "README.zh-CN.md",
  "package.json",
  "scripts/README.md",
  "scripts/lib/wakeflow-host-profile.mjs",
  "scripts/lib/wakeflow-host-artifact-checks.mjs",
  "skills/wakeflow-controller/SKILL.md",
  "skills/wakeflow-target/SKILL.md",
  "skills/wakeflow-governance/SKILL.md",
];

function write(file, content = "") {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function makeFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-sync-core-"));
  write(path.join(root, "core/scripts/shared.mjs"), "export const current = true;\n");
  for (const relative of sharedContractFiles) {
    write(
      path.join(root, "core", relative),
      relative.endsWith(".json") ? "{}\n" : `export const fixture = ${JSON.stringify(relative)};\n`,
    );
  }
  const demandInputs = {
    authority: "string",
    completionDefinition: "string",
    currentState: "string",
    demand: "string",
    events: "string",
    goal: "string",
    projectionMarker: "string",
    source: "string",
    title: "string",
  };
  const demandTemplate = Object.keys(demandInputs).map((key) => `{{${key}}}`).join("\n");
  write(path.join(root, "core/template-sources/progress/demand-progress.template.md"), `${demandTemplate}\n`);
  write(path.join(root, "core/template-sources/progress/demand-progress.zh-CN.template.md"), `${demandTemplate}\n`);
  write(path.join(root, "core/template-sources/manifest.json"), `${JSON.stringify({
    schemaVersion: 1,
    artifactKind: "wakeflow-template-sources",
    source: "core/template-sources",
    assets: [
      {
        id: "progress.demand.en",
        kind: "projection-template",
        owner: "demand-projector",
        consumers: ["wakeflow-demand-document-builder"],
        source: "progress/demand-progress.template.md",
        input: demandInputs,
      },
      {
        id: "progress.demand.zh-CN",
        kind: "projection-template",
        owner: "demand-projector",
        consumers: ["wakeflow-demand-document-builder"],
        source: "progress/demand-progress.zh-CN.template.md",
        input: demandInputs,
      },
    ],
  }, null, 2)}\n`);
  for (const [target, manifest, memory] of [
    ["plugins/codex-wakeflow", ".codex-plugin/plugin.json", "AGENTS.md"],
    ["plugins/claude-code-wakeflow", ".claude-plugin/plugin.json", "CLAUDE.md"],
  ]) {
    const targetRoot = path.join(root, target);
    for (const relative of [...commonHostFiles, manifest, memory]) write(path.join(targetRoot, relative), "{}\n");
    write(path.join(targetRoot, "scripts/shared.mjs"), "export const current = true;\n");
    write(path.join(targetRoot, "scripts/wakeflow-obsolete.mjs"), "stale\n");
    write(path.join(targetRoot, "host-only.txt"), "preserve\n");
    write(path.join(targetRoot, "scripts/wakeflow-core-manifest.json"), JSON.stringify({
      schemaVersion: 1,
      source: "core",
      files: ["scripts/wakeflow-obsolete.mjs", "scripts/shared.mjs"],
    }));
  }
  write(
    path.join(root, "plugins/codex-wakeflow/scripts/lib/wakeflow-codex-decommission.mjs"),
    "export const hostOnlyCodexDecommission = true;\n",
  );
  write(
    path.join(root, "plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-decommission.mjs"),
    "export const hostOnlyClaudeDecommission = true;\n",
  );
  write(
    path.join(root, "plugins/codex-wakeflow/scripts/lib/wakeflow-codex-migration-decommission.mjs"),
    "export const hostOnlyCodexMigrationDecommission = true;\n",
  );
  write(
    path.join(root, "plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-migration-decommission.mjs"),
    "export const hostOnlyClaudeMigrationDecommission = true;\n",
  );
  write(
    path.join(root, "plugins/codex-wakeflow/scripts/lib/wakeflow-codex-migration-effect.mjs"),
    "export const hostOnlyCodexMigrationEffect = true;\n",
  );
  write(
    path.join(root, "plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-migration-effect.mjs"),
    "export const hostOnlyClaudeMigrationEffect = true;\n",
  );
  write(
    path.join(root, "plugins/codex-wakeflow/scripts/lib/wakeflow-codex-activation-scope.mjs"),
    "export const hostOnlyCodexActivationScope = true;\n",
  );
  write(
    path.join(root, "plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-activation-scope.mjs"),
    "export const hostOnlyClaudeActivationScope = true;\n",
  );
  write(
    path.join(root, "plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-transport.mjs"),
    "export const hostOnlyTransport = true;\n",
  );
  write(
    path.join(root, "plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-settings.mjs"),
    "export const hostOnlySettings = true;\n",
  );
  write(
    path.join(root, "plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-activity.mjs"),
    "export const hostOnlyActivity = true;\n",
  );
  write(
    path.join(root, "plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-host.mjs"),
    "export const hostOnlyFacade = true;\n",
  );
  write(
    path.join(root, "plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-lifecycle.mjs"),
    "export const hostOnlyLifecycle = true;\n",
  );
  write(
    path.join(root, "plugins/claude-code-wakeflow/schemas/wakeflow-claude-host/activity-monitor-process.schema.json"),
    "{\"hostOnlyProcess\":true}\n",
  );
  write(
    path.join(root, "plugins/claude-code-wakeflow/schemas/wakeflow-claude-host/activity-monitor-manager-lock.schema.json"),
    "{\"hostOnlyLock\":true}\n",
  );
  return root;
}

function run(root, extra = []) {
  return runSync(process.execPath, [script, "--repo-root", root, ...extra], {
    cwd: root,
    encoding: "utf8",
  });
}

test("sync-core detects and removes only stale core-managed files", () => {
  const root = makeFixture();
  const before = run(root, ["--check"]);
  assert.notEqual(before.status, 0);
  assert.match(before.stderr, /scripts\/wakeflow-obsolete\.mjs is a stale core-managed file/);

  const sync = run(root);
  assert.equal(sync.status, 0, sync.stderr || sync.stdout);
  for (const target of ["plugins/codex-wakeflow", "plugins/claude-code-wakeflow"]) {
    assert.equal(existsSync(path.join(root, target, "scripts/wakeflow-obsolete.mjs")), false);
    assert.equal(readFileSync(path.join(root, target, "host-only.txt"), "utf8"), "preserve\n");
    const manifest = JSON.parse(readFileSync(path.join(root, target, "scripts/wakeflow-core-manifest.json"), "utf8"));
    assert.deepEqual(manifest.files, [...sharedContractFiles, "scripts/shared.mjs"].sort());
    for (const relative of sharedContractFiles) {
      assert.equal(
        readFileSync(path.join(root, target, relative), "utf8"),
        readFileSync(path.join(root, "core", relative), "utf8"),
        relative,
      );
    }
    assert.equal(existsSync(path.join(root, target, "template-sources")), false);
    const assetBundle = JSON.parse(readFileSync(path.join(root, target, "templates/wakeflow-asset-bundle.json"), "utf8"));
    assert.deepEqual(Object.keys(assetBundle.assets), ["progress.demand.en", "progress.demand.zh-CN"]);
  }
  assert.equal(
    readFileSync(
      path.join(root, "plugins/codex-wakeflow/scripts/lib/wakeflow-codex-decommission.mjs"),
      "utf8",
    ),
    "export const hostOnlyCodexDecommission = true;\n",
  );
  assert.equal(
    existsSync(path.join(root, "plugins/claude-code-wakeflow/scripts/lib/wakeflow-codex-decommission.mjs")),
    false,
  );
  assert.equal(
    readFileSync(
      path.join(root, "plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-decommission.mjs"),
      "utf8",
    ),
    "export const hostOnlyClaudeDecommission = true;\n",
  );
  assert.equal(
    existsSync(path.join(root, "plugins/codex-wakeflow/scripts/lib/wakeflow-claude-decommission.mjs")),
    false,
  );
  assert.equal(
    readFileSync(
      path.join(root, "plugins/codex-wakeflow/scripts/lib/wakeflow-codex-migration-decommission.mjs"),
      "utf8",
    ),
    "export const hostOnlyCodexMigrationDecommission = true;\n",
  );
  assert.equal(
    existsSync(path.join(root, "plugins/claude-code-wakeflow/scripts/lib/wakeflow-codex-migration-decommission.mjs")),
    false,
  );
  assert.equal(
    readFileSync(
      path.join(root, "plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-migration-decommission.mjs"),
      "utf8",
    ),
    "export const hostOnlyClaudeMigrationDecommission = true;\n",
  );
  assert.equal(
    existsSync(path.join(root, "plugins/codex-wakeflow/scripts/lib/wakeflow-claude-migration-decommission.mjs")),
    false,
  );
  assert.equal(
    readFileSync(
      path.join(root, "plugins/codex-wakeflow/scripts/lib/wakeflow-codex-migration-effect.mjs"),
      "utf8",
    ),
    "export const hostOnlyCodexMigrationEffect = true;\n",
  );
  assert.equal(
    existsSync(path.join(root, "plugins/claude-code-wakeflow/scripts/lib/wakeflow-codex-migration-effect.mjs")),
    false,
  );
  assert.equal(
    readFileSync(
      path.join(root, "plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-migration-effect.mjs"),
      "utf8",
    ),
    "export const hostOnlyClaudeMigrationEffect = true;\n",
  );
  assert.equal(
    existsSync(path.join(root, "plugins/codex-wakeflow/scripts/lib/wakeflow-claude-migration-effect.mjs")),
    false,
  );
  assert.equal(
    readFileSync(
      path.join(root, "plugins/codex-wakeflow/scripts/lib/wakeflow-codex-activation-scope.mjs"),
      "utf8",
    ),
    "export const hostOnlyCodexActivationScope = true;\n",
  );
  assert.equal(
    existsSync(path.join(root, "plugins/claude-code-wakeflow/scripts/lib/wakeflow-codex-activation-scope.mjs")),
    false,
  );
  assert.equal(
    readFileSync(
      path.join(root, "plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-activation-scope.mjs"),
      "utf8",
    ),
    "export const hostOnlyClaudeActivationScope = true;\n",
  );
  assert.equal(
    existsSync(path.join(root, "plugins/codex-wakeflow/scripts/lib/wakeflow-claude-activation-scope.mjs")),
    false,
  );
  assert.equal(
    readFileSync(
      path.join(root, "plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-transport.mjs"),
      "utf8",
    ),
    "export const hostOnlyTransport = true;\n",
  );
  assert.equal(
    existsSync(path.join(root, "plugins/codex-wakeflow/scripts/lib/wakeflow-claude-transport.mjs")),
    false,
  );
  assert.equal(
    readFileSync(
      path.join(root, "plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-settings.mjs"),
      "utf8",
    ),
    "export const hostOnlySettings = true;\n",
  );
  assert.equal(
    existsSync(path.join(root, "plugins/codex-wakeflow/scripts/lib/wakeflow-claude-settings.mjs")),
    false,
  );
  for (const [relative, expected] of [
    ["scripts/lib/wakeflow-claude-activity.mjs", "export const hostOnlyActivity = true;\n"],
    ["scripts/lib/wakeflow-claude-host.mjs", "export const hostOnlyFacade = true;\n"],
    ["scripts/lib/wakeflow-claude-lifecycle.mjs", "export const hostOnlyLifecycle = true;\n"],
    ["schemas/wakeflow-claude-host/activity-monitor-process.schema.json", "{\"hostOnlyProcess\":true}\n"],
    ["schemas/wakeflow-claude-host/activity-monitor-manager-lock.schema.json", "{\"hostOnlyLock\":true}\n"],
  ]) {
    assert.equal(
      readFileSync(path.join(root, "plugins/claude-code-wakeflow", relative), "utf8"),
      expected,
    );
    assert.equal(existsSync(path.join(root, "plugins/codex-wakeflow", relative)), false);
  }

  assert.equal(
    readFileSync(path.join(root, "plugins/codex-wakeflow/templates/wakeflow-asset-bundle.json"), "utf8"),
    readFileSync(path.join(root, "plugins/claude-code-wakeflow/templates/wakeflow-asset-bundle.json"), "utf8"),
  );

  const after = run(root, ["--check"]);
  assert.equal(after.status, 0, after.stderr || after.stdout);

  write(path.join(root, "plugins/codex-wakeflow/templates/wakeflow-asset-bundle.json"), "{}\n");
  const drift = run(root, ["--check"]);
  assert.notEqual(drift.status, 0);
  assert.match(drift.stderr, /wakeflow-asset-bundle\.json drifts from core\/template-sources/);
});

test("sync-core detects nested shared artifact drift and non-canonical managed manifests", () => {
  const root = makeFixture();
  const sync = run(root);
  assert.equal(sync.status, 0, sync.stderr || sync.stdout);

  write(
    path.join(root, "plugins/codex-wakeflow/schemas/wakeflow-demand-artifacts/task-package.schema.json"),
    "{\"drifted\":true}\n",
  );
  write(
    path.join(root, "plugins/codex-wakeflow/schemas/wakeflow-delivery/delivery-run.schema.json"),
    "{\"drifted\":true}\n",
  );
  const claudeManifestPath = path.join(root, "plugins/claude-code-wakeflow/scripts/wakeflow-core-manifest.json");
  const claudeManifest = JSON.parse(readFileSync(claudeManifestPath, "utf8"));
  claudeManifest.files.reverse();
  write(claudeManifestPath, `${JSON.stringify(claudeManifest, null, 2)}\n`);

  const check = run(root, ["--check"]);
  assert.notEqual(check.status, 0);
  assert.match(check.stderr, /task-package\.schema\.json drifts from core\/schemas\/wakeflow-demand-artifacts/u);
  assert.match(check.stderr, /delivery-run\.schema\.json drifts from core\/schemas\/wakeflow-delivery/u);
  assert.match(check.stderr, /wakeflow-core-manifest\.json does not match the current core file set/u);
});

test("sync-core rejects unknown or duplicate command-line options", () => {
  const root = makeFixture();
  for (const extra of [["--unknown"], ["--check", "--check"], ["--repo-root"]]) {
    const result = runSync(process.execPath, [script, ...extra], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(result.status, 64, result.stderr || result.stdout);
    assert.match(result.stderr, /wakeflow-sync-core-argv/u);
  }
});

test("sync-core refuses symbolic-link sources and linked artifact destinations", () => {
  const sourceFixture = makeFixture();
  const outsideSource = path.join(sourceFixture, "outside-source.mjs");
  write(outsideSource, "export const outside = true;\n");
  symlinkSync(outsideSource, path.join(sourceFixture, "core/lib/wakeflow-linked.mjs"));
  const sourceResult = run(sourceFixture, ["--check"]);
  assert.notEqual(sourceResult.status, 0);
  assert.match(sourceResult.stderr, /core\/lib\/wakeflow-linked\.mjs cannot be a symbolic link/u);

  const destinationFixture = makeFixture();
  const initial = run(destinationFixture);
  assert.equal(initial.status, 0, initial.stderr || initial.stdout);
  const sentinel = path.join(destinationFixture, "outside-sentinel.mjs");
  write(sentinel, "do not replace\n");

  const symlinkedDestination = path.join(
    destinationFixture,
    "plugins/codex-wakeflow/scripts/shared.mjs",
  );
  unlinkSync(symlinkedDestination);
  symlinkSync(sentinel, symlinkedDestination);

  const hardlinkedDestination = path.join(
    destinationFixture,
    "plugins/claude-code-wakeflow/scripts/shared.mjs",
  );
  unlinkSync(hardlinkedDestination);
  linkSync(sentinel, hardlinkedDestination);

  const result = run(destinationFixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /regular non-symlink single-link file/u);
  assert.equal(readFileSync(sentinel, "utf8"), "do not replace\n");
  assert.equal(lstatSync(symlinkedDestination).isSymbolicLink(), true);
  assert.equal(lstatSync(hardlinkedDestination).nlink, 2);
});

test("sync-core never trusts a poisoned manifest to delete host-owned files", () => {
  const root = makeFixture();
  const targetRoot = path.join(root, "plugins/codex-wakeflow");
  write(path.join(targetRoot, "scripts/wakeflow-core-manifest.json"), `${JSON.stringify({
    schemaVersion: 1,
    source: "core",
    files: [
      "README.md",
      "host-only.txt",
      "scripts/shared.mjs",
      "scripts/wakeflow-obsolete.mjs",
    ],
  })}\n`);

  const result = run(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /README\.md is protected from stale-manifest deletion/u);
  assert.match(result.stderr, /host-only\.txt is protected from stale-manifest deletion/u);
  assert.equal(readFileSync(path.join(targetRoot, "README.md"), "utf8"), "{}\n");
  assert.equal(readFileSync(path.join(targetRoot, "host-only.txt"), "utf8"), "preserve\n");
  assert.equal(existsSync(path.join(targetRoot, "scripts/wakeflow-obsolete.mjs")), false);
});
