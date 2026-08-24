import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  evaluateWakeflowPackageReport,
  WAKEFLOW_RELEASE_PACKAGING_CONTRACTS,
  WAKEFLOW_RELEASE_REQUIRED_ACTIVE_PROJECTION_FILES,
  WAKEFLOW_RELEASE_REQUIRED_ARTIFACT_TREE_IDENTITY_FILES,
  WAKEFLOW_RELEASE_REQUIRED_BUSINESS_ARCHIVE_FILES,
  WAKEFLOW_RELEASE_REQUIRED_CLAUDE_ACTIVITY_FILES,
  WAKEFLOW_RELEASE_REQUIRED_CLAUDE_ACTIVATION_SCOPE_FILES,
  WAKEFLOW_RELEASE_REQUIRED_CLAUDE_DECOMMISSION_FILES,
  WAKEFLOW_RELEASE_REQUIRED_CLAUDE_MIGRATION_DECOMMISSION_FILES,
  WAKEFLOW_RELEASE_REQUIRED_CLAUDE_MIGRATION_EFFECT_FILES,
  WAKEFLOW_RELEASE_REQUIRED_CLAUDE_LOCATOR_FILES,
  WAKEFLOW_RELEASE_REQUIRED_CLAUDE_SETTINGS_FILES,
  WAKEFLOW_RELEASE_REQUIRED_CLAUDE_TRANSPORT_FILES,
  WAKEFLOW_RELEASE_REQUIRED_CODEX_ACTIVATION_SCOPE_FILES,
  WAKEFLOW_RELEASE_REQUIRED_CODEX_DECOMMISSION_FILES,
  WAKEFLOW_RELEASE_REQUIRED_CODEX_MIGRATION_DECOMMISSION_FILES,
  WAKEFLOW_RELEASE_REQUIRED_CODEX_MIGRATION_EFFECT_FILES,
  WAKEFLOW_RELEASE_REQUIRED_DEMAND_ARTIFACT_FILES,
  WAKEFLOW_RELEASE_REQUIRED_DEMAND_LIFECYCLE_FILES,
  WAKEFLOW_RELEASE_REQUIRED_EVIDENCE_FILES,
  WAKEFLOW_RELEASE_REQUIRED_KEEP_LIVE_FILES,
  WAKEFLOW_RELEASE_REQUIRED_LEGACY_ARCHIVE_FILES,
  WAKEFLOW_RELEASE_REQUIRED_LEGACY_CLASSIFIER_FILES,
  WAKEFLOW_RELEASE_REQUIRED_LEGACY_OWNER_DRAIN_FILES,
  WAKEFLOW_RELEASE_REQUIRED_HOST_DECOMMISSION_FILES,
  WAKEFLOW_RELEASE_REQUIRED_HOST_ACTIVATION_SCOPE_FILES,
  WAKEFLOW_RELEASE_REQUIRED_MAINTENANCE_PLAN_FILES,
  WAKEFLOW_RELEASE_REQUIRED_PUBLIC_V3_SURFACE_FILES,
  WAKEFLOW_RELEASE_REQUIRED_MIGRATION_INVENTORY_FILES,
  WAKEFLOW_RELEASE_REQUIRED_MIGRATION_APPLY_FILES,
  WAKEFLOW_RELEASE_REQUIRED_MIGRATION_HOST_DECOMMISSION_FILES,
  WAKEFLOW_RELEASE_REQUIRED_MIGRATION_PLAN_FILES,
  WAKEFLOW_RELEASE_REQUIRED_POD_FILES,
  WAKEFLOW_RELEASE_REQUIRED_PRESERVATION_FILES,
  WAKEFLOW_RELEASE_REQUIRED_SKILL_FILES,
  WAKEFLOW_RELEASE_REQUIRED_TRANSPORT_FILES,
  WAKEFLOW_RELEASE_REQUIRED_WINDOW_BINDING_FILES,
  WAKEFLOW_RELEASE_REQUIRED_WINDOW_COORDINATION_LEASE_FILES,
  WAKEFLOW_RELEASE_REQUIRED_WINDOW_RUNTIME_FILES,
  wakeflowReleasePackagingContract,
} from "../tools/lib/wakeflow-release-packaging-contract.mjs";

const repositoryRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function listSkillFiles(pluginRoot) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(directory, entry.name);
      assert.equal(entry.isSymbolicLink(), false, `${path.relative(pluginRoot, absolute)} must not be a symlink`);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(path.relative(pluginRoot, absolute).split(path.sep).join("/"));
      else assert.fail(`${path.relative(pluginRoot, absolute)} has an unsupported filesystem type`);
    }
  };
  visit(path.join(pluginRoot, "skills"));
  return files.sort();
}

function validReport(hostId, version = "1.2.3") {
  const contract = wakeflowReleasePackagingContract(hostId);
  return {
    name: contract.workspace,
    version,
    entryCount: contract.requiredFiles.length,
    files: contract.requiredFiles.map((file) => ({ path: file, size: 1, mode: 420 })),
  };
}

test("transition packaging contract requires the public v3 surface, Skills, domains, transport, identity, leases, runtime projections, and Claude host owners", () => {
  assert.deepEqual(WAKEFLOW_RELEASE_REQUIRED_ACTIVE_PROJECTION_FILES, [
    "scripts/lib/wakeflow-active-identity-lock.mjs",
    "scripts/lib/wakeflow-active-projection-lock.mjs",
    "scripts/lib/wakeflow-active-projector.mjs",
    "scripts/lib/wakeflow-config-v3-snapshot.mjs",
  ]);
  assert.deepEqual(WAKEFLOW_RELEASE_REQUIRED_BUSINESS_ARCHIVE_FILES, [
    "schemas/wakeflow-business-archive/archive-transaction.schema.json",
    "schemas/wakeflow-business-archive/business-summary.schema.json",
    "schemas/wakeflow-business-archive/todo-history.schema.json",
    "schemas/wakeflow-business-archive/transport-summary.schema.json",
    "scripts/lib/wakeflow-business-archive-records.mjs",
    "scripts/lib/wakeflow-business-archive-service.mjs",
  ]);
  assert.deepEqual(WAKEFLOW_RELEASE_REQUIRED_DEMAND_ARTIFACT_FILES, [
    "schemas/wakeflow-demand-artifacts/pod-design-handoff.schema.json",
    "schemas/wakeflow-demand-artifacts/pod-design-request.schema.json",
    "schemas/wakeflow-demand-artifacts/review-candidate.schema.json",
    "schemas/wakeflow-demand-artifacts/target-result.schema.json",
    "schemas/wakeflow-demand-artifacts/task-package.schema.json",
    "schemas/wakeflow-demand-artifacts/test-card.schema.json",
    "scripts/lib/wakeflow-demand-artifact-records.mjs",
    "scripts/lib/wakeflow-demand-artifact-service.mjs",
    "scripts/lib/wakeflow-target-result-authority.mjs",
  ]);
  assert.deepEqual(WAKEFLOW_RELEASE_REQUIRED_DEMAND_LIFECYCLE_FILES, [
    "schemas/wakeflow-demand-core/controller-event.schema.json",
    "schemas/wakeflow-demand-core/wakeflow-state.schema.json",
    "scripts/lib/wakeflow-demand-core-records.mjs",
    "scripts/lib/wakeflow-demand-lifecycle-orchestration.mjs",
    "scripts/lib/wakeflow-demand-state-service.mjs",
  ]);
  assert.deepEqual(WAKEFLOW_RELEASE_REQUIRED_EVIDENCE_FILES, [
    "schemas/wakeflow-demand-evidence/evidence.schema.json",
    "scripts/lib/wakeflow-evidence-importer.mjs",
    "scripts/lib/wakeflow-evidence-records.mjs",
    "scripts/lib/wakeflow-evidence-tree.mjs",
  ]);
  assert.deepEqual(WAKEFLOW_RELEASE_REQUIRED_WINDOW_BINDING_FILES, [
    "schemas/wakeflow-window-identity/window-binding.schema.json",
    "scripts/lib/wakeflow-window-binding-records.mjs",
    "scripts/lib/wakeflow-window-binding-service.mjs",
  ]);
  assert.deepEqual(WAKEFLOW_RELEASE_REQUIRED_HOST_DECOMMISSION_FILES, [
    "schemas/wakeflow-window-identity/host-decommission-result.schema.json",
    "scripts/lib/wakeflow-host-decommission-result.mjs",
  ]);
  assert.deepEqual(WAKEFLOW_RELEASE_REQUIRED_CODEX_DECOMMISSION_FILES, [
    "scripts/lib/wakeflow-codex-decommission.mjs",
  ]);
  assert.deepEqual(WAKEFLOW_RELEASE_REQUIRED_CLAUDE_DECOMMISSION_FILES, [
    "scripts/lib/wakeflow-claude-decommission.mjs",
  ]);
  assert.deepEqual(WAKEFLOW_RELEASE_REQUIRED_CODEX_MIGRATION_DECOMMISSION_FILES, [
    "scripts/lib/wakeflow-codex-migration-decommission.mjs",
  ]);
  assert.deepEqual(WAKEFLOW_RELEASE_REQUIRED_CLAUDE_MIGRATION_DECOMMISSION_FILES, [
    "scripts/lib/wakeflow-claude-migration-decommission.mjs",
  ]);
  assert.deepEqual(WAKEFLOW_RELEASE_REQUIRED_CODEX_MIGRATION_EFFECT_FILES, [
    "scripts/lib/wakeflow-codex-migration-effect.mjs",
  ]);
  assert.deepEqual(WAKEFLOW_RELEASE_REQUIRED_CLAUDE_MIGRATION_EFFECT_FILES, [
    "scripts/lib/wakeflow-claude-migration-effect.mjs",
  ]);
  assert.deepEqual(WAKEFLOW_RELEASE_REQUIRED_HOST_ACTIVATION_SCOPE_FILES, [
    "scripts/lib/wakeflow-host-activation-gate.mjs",
    "scripts/lib/wakeflow-host-activation-scope.mjs",
  ]);
  assert.deepEqual(WAKEFLOW_RELEASE_REQUIRED_CODEX_ACTIVATION_SCOPE_FILES, [
    "scripts/lib/wakeflow-codex-activation-scope.mjs",
  ]);
  assert.deepEqual(WAKEFLOW_RELEASE_REQUIRED_CLAUDE_ACTIVATION_SCOPE_FILES, [
    "scripts/lib/wakeflow-claude-activation-scope.mjs",
  ]);
  assert.deepEqual(WAKEFLOW_RELEASE_REQUIRED_WINDOW_COORDINATION_LEASE_FILES, [
    "schemas/wakeflow-coordination/window-lease.schema.json",
    "scripts/lib/wakeflow-window-lease-records.mjs",
    "scripts/lib/wakeflow-window-lease-service.mjs",
  ]);
  assert.deepEqual(WAKEFLOW_RELEASE_REQUIRED_POD_FILES, [
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
  ]);
  assert.deepEqual(WAKEFLOW_RELEASE_REQUIRED_KEEP_LIVE_FILES, [
    "schemas/wakeflow-keep-live/control.schema.json",
    "schemas/wakeflow-keep-live/lease.schema.json",
    "schemas/wakeflow-keep-live/manager-lock.schema.json",
    "schemas/wakeflow-keep-live/process.schema.json",
    "scripts/lib/wakeflow-keep-live-records.mjs",
    "scripts/lib/wakeflow-keep-live-service.mjs",
    "scripts/lib/wakeflow-process-identity.mjs",
  ]);
  assert.deepEqual(WAKEFLOW_RELEASE_REQUIRED_CLAUDE_LOCATOR_FILES, [
    "schemas/wakeflow-claude-host/window-locator.schema.json",
    "scripts/lib/wakeflow-claude-locator.mjs",
  ]);
  assert.deepEqual(WAKEFLOW_RELEASE_REQUIRED_CLAUDE_TRANSPORT_FILES, [
    "scripts/lib/wakeflow-claude-transport.mjs",
  ]);
  assert.deepEqual(WAKEFLOW_RELEASE_REQUIRED_CLAUDE_SETTINGS_FILES, [
    "scripts/lib/wakeflow-claude-settings.mjs",
  ]);
  assert.deepEqual(WAKEFLOW_RELEASE_REQUIRED_CLAUDE_ACTIVITY_FILES, [
    "schemas/wakeflow-claude-host/activity-monitor-manager-lock.schema.json",
    "schemas/wakeflow-claude-host/activity-monitor-process.schema.json",
    "scripts/lib/wakeflow-claude-activity.mjs",
  ]);
  assert.deepEqual(WAKEFLOW_RELEASE_REQUIRED_TRANSPORT_FILES, [
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
  ]);
  assert.deepEqual(WAKEFLOW_RELEASE_REQUIRED_PRESERVATION_FILES, [
    "schemas/wakeflow-maintenance/local-preservation-plan.schema.json",
    "schemas/wakeflow-maintenance/local-preservation.schema.json",
    "scripts/lib/wakeflow-preservation.mjs",
  ]);
  assert.deepEqual(WAKEFLOW_RELEASE_REQUIRED_ARTIFACT_TREE_IDENTITY_FILES, [
    "scripts/lib/wakeflow-artifact-tree-identity.mjs",
  ]);
  assert.deepEqual(WAKEFLOW_RELEASE_REQUIRED_LEGACY_CLASSIFIER_FILES, [
    "scripts/data/wakeflow-legacy-classifier-catalog.json",
    "scripts/lib/wakeflow-legacy-classifier.mjs",
  ]);
  assert.deepEqual(WAKEFLOW_RELEASE_REQUIRED_MIGRATION_INVENTORY_FILES, [
    "scripts/lib/wakeflow-migration-inventory.mjs",
  ]);
  assert.deepEqual(WAKEFLOW_RELEASE_REQUIRED_LEGACY_OWNER_DRAIN_FILES, [
    "scripts/lib/wakeflow-legacy-owner-drain.mjs",
  ]);
  assert.deepEqual(WAKEFLOW_RELEASE_REQUIRED_LEGACY_ARCHIVE_FILES, [
    "schemas/wakeflow-business-archive/legacy-evidence-summary.schema.json",
    "schemas/wakeflow-business-archive/legacy-source-descriptor.schema.json",
    "schemas/wakeflow-business-archive/legacy-transport-summary.schema.json",
    "schemas/wakeflow-ledger/archive-manifest.schema.json",
    "schemas/wakeflow-maintenance/legacy-archive-transform-plan.schema.json",
    "scripts/lib/wakeflow-ledger-records.mjs",
    "scripts/lib/wakeflow-legacy-archive-records.mjs",
    "scripts/lib/wakeflow-legacy-archive-transform.mjs",
  ]);
  assert.deepEqual(WAKEFLOW_RELEASE_REQUIRED_MIGRATION_PLAN_FILES, [
    "scripts/lib/wakeflow-migration-plan.mjs",
  ]);
  assert.deepEqual(WAKEFLOW_RELEASE_REQUIRED_MIGRATION_HOST_DECOMMISSION_FILES, [
    "scripts/lib/wakeflow-migration-host-decommission.mjs",
  ]);
  assert.deepEqual(WAKEFLOW_RELEASE_REQUIRED_MIGRATION_APPLY_FILES, [
    "bin/wakeflow-bootstrap",
    "schemas/wakeflow-maintenance/maintenance-transaction.schema.json",
    "schemas/wakeflow-maintenance/recovery-claim.schema.json",
    "schemas/wakeflow-maintenance/workspace-mutation-lock.schema.json",
    "scripts/lib/wakeflow-migration-apply.mjs",
    "scripts/lib/wakeflow-migration-config-owner.mjs",
    "scripts/lib/wakeflow-migration-production.mjs",
    "scripts/lib/wakeflow-workspace-mutation.mjs",
    "scripts/wakeflow-bootstrap.mjs",
  ]);
  assert.deepEqual(WAKEFLOW_RELEASE_REQUIRED_MAINTENANCE_PLAN_FILES, [
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
  ]);
  assert.deepEqual(WAKEFLOW_RELEASE_REQUIRED_PUBLIC_V3_SURFACE_FILES, [
    "lib/wakeflow-mcp-tools.mjs",
    "scripts/lib/wakeflow-maintenance-action-runtime.mjs",
    "scripts/lib/wakeflow-maintenance-coordinator.mjs",
    "scripts/lib/wakeflow-public-v3-runtime.mjs",
    "scripts/wakeflow-cli.mjs",
    "scripts/wakeflow-setup.mjs",
    "scripts/wakeflow-smoke.mjs",
    "scripts/wakeflow-validate.mjs",
  ]);
  assert.deepEqual(WAKEFLOW_RELEASE_REQUIRED_WINDOW_RUNTIME_FILES, [
    "schemas/wakeflow-window-runtime/window-runtime.schema.json",
    "scripts/lib/wakeflow-window-runtime-projector.mjs",
    "scripts/lib/wakeflow-window-runtime-records.mjs",
  ]);
  for (const [hostId, contract] of Object.entries(WAKEFLOW_RELEASE_PACKAGING_CONTRACTS)) {
    assert.deepEqual(contract.requiredFiles, [...contract.requiredFiles].sort());
    for (const skill of ["controller", "target", "governance", "target-craft", "design", "test"]) {
      assert.equal(contract.requiredFiles.includes(`skills/wakeflow-${skill}/SKILL.md`), true);
    }
    for (const runtimeFile of [
      "scripts/lib/wakeflow-canonical-json.mjs",
      "scripts/lib/wakeflow-template-renderer.mjs",
    ]) {
      assert.equal(contract.requiredFiles.includes(runtimeFile), true);
    }
    const podHostFile = hostId === "codex"
      ? "scripts/lib/wakeflow-codex-pod-host.mjs"
      : "scripts/lib/wakeflow-claude-pod-host.mjs";
    assert.equal(contract.requiredFiles.includes(podHostFile), true);
    for (const artifactFile of WAKEFLOW_RELEASE_REQUIRED_DEMAND_ARTIFACT_FILES) {
      assert.equal(contract.requiredFiles.includes(artifactFile), true, `${hostId} must require ${artifactFile}`);
    }
    for (const lifecycleFile of WAKEFLOW_RELEASE_REQUIRED_DEMAND_LIFECYCLE_FILES) {
      assert.equal(contract.requiredFiles.includes(lifecycleFile), true, `${hostId} must require ${lifecycleFile}`);
    }
    for (const evidenceFile of WAKEFLOW_RELEASE_REQUIRED_EVIDENCE_FILES) {
      assert.equal(contract.requiredFiles.includes(evidenceFile), true, `${hostId} must require ${evidenceFile}`);
    }
    for (const projectionFile of WAKEFLOW_RELEASE_REQUIRED_ACTIVE_PROJECTION_FILES) {
      assert.equal(contract.requiredFiles.includes(projectionFile), true, `${hostId} must require ${projectionFile}`);
    }
    for (const archiveFile of WAKEFLOW_RELEASE_REQUIRED_BUSINESS_ARCHIVE_FILES) {
      assert.equal(contract.requiredFiles.includes(archiveFile), true, `${hostId} must require ${archiveFile}`);
    }
    for (const bindingFile of WAKEFLOW_RELEASE_REQUIRED_WINDOW_BINDING_FILES) {
      assert.equal(contract.requiredFiles.includes(bindingFile), true, `${hostId} must require ${bindingFile}`);
    }
    for (const decommissionFile of WAKEFLOW_RELEASE_REQUIRED_HOST_DECOMMISSION_FILES) {
      assert.equal(contract.requiredFiles.includes(decommissionFile), true, `${hostId} must require ${decommissionFile}`);
    }
    for (const decommissionFile of WAKEFLOW_RELEASE_REQUIRED_CODEX_DECOMMISSION_FILES) {
      assert.equal(
        contract.requiredFiles.includes(decommissionFile),
        hostId === "codex",
        `${hostId} Codex decommission packaging must match host applicability for ${decommissionFile}`,
      );
    }
    for (const decommissionFile of WAKEFLOW_RELEASE_REQUIRED_CLAUDE_DECOMMISSION_FILES) {
      assert.equal(
        contract.requiredFiles.includes(decommissionFile),
        hostId === "claude-code",
        `${hostId} Claude decommission packaging must match host applicability for ${decommissionFile}`,
      );
    }
    for (const activationFile of WAKEFLOW_RELEASE_REQUIRED_HOST_ACTIVATION_SCOPE_FILES) {
      assert.equal(contract.requiredFiles.includes(activationFile), true, `${hostId} must require ${activationFile}`);
    }
    for (const activationFile of WAKEFLOW_RELEASE_REQUIRED_CODEX_ACTIVATION_SCOPE_FILES) {
      assert.equal(
        contract.requiredFiles.includes(activationFile),
        hostId === "codex",
        `${hostId} Codex activation scope packaging must match host applicability for ${activationFile}`,
      );
    }
    for (const activationFile of WAKEFLOW_RELEASE_REQUIRED_CLAUDE_ACTIVATION_SCOPE_FILES) {
      assert.equal(
        contract.requiredFiles.includes(activationFile),
        hostId === "claude-code",
        `${hostId} Claude activation scope packaging must match host applicability for ${activationFile}`,
      );
    }
    for (const leaseFile of WAKEFLOW_RELEASE_REQUIRED_WINDOW_COORDINATION_LEASE_FILES) {
      assert.equal(contract.requiredFiles.includes(leaseFile), true, `${hostId} must require ${leaseFile}`);
    }
    for (const podFile of WAKEFLOW_RELEASE_REQUIRED_POD_FILES) {
      assert.equal(contract.requiredFiles.includes(podFile), true, `${hostId} must require ${podFile}`);
    }
    for (const keepLiveFile of WAKEFLOW_RELEASE_REQUIRED_KEEP_LIVE_FILES) {
      assert.equal(contract.requiredFiles.includes(keepLiveFile), true, `${hostId} must require ${keepLiveFile}`);
    }
    for (const transportFile of WAKEFLOW_RELEASE_REQUIRED_TRANSPORT_FILES) {
      assert.equal(contract.requiredFiles.includes(transportFile), true, `${hostId} must require ${transportFile}`);
    }
    for (const preservationFile of WAKEFLOW_RELEASE_REQUIRED_PRESERVATION_FILES) {
      assert.equal(contract.requiredFiles.includes(preservationFile), true, `${hostId} must require ${preservationFile}`);
    }
    for (const identityFile of WAKEFLOW_RELEASE_REQUIRED_ARTIFACT_TREE_IDENTITY_FILES) {
      assert.equal(contract.requiredFiles.includes(identityFile), true, `${hostId} must require ${identityFile}`);
    }
    for (const classifierFile of WAKEFLOW_RELEASE_REQUIRED_LEGACY_CLASSIFIER_FILES) {
      assert.equal(contract.requiredFiles.includes(classifierFile), true, `${hostId} must require ${classifierFile}`);
    }
    for (const inventoryFile of WAKEFLOW_RELEASE_REQUIRED_MIGRATION_INVENTORY_FILES) {
      assert.equal(contract.requiredFiles.includes(inventoryFile), true, `${hostId} must require ${inventoryFile}`);
    }
    for (const drainFile of WAKEFLOW_RELEASE_REQUIRED_LEGACY_OWNER_DRAIN_FILES) {
      assert.equal(contract.requiredFiles.includes(drainFile), true, `${hostId} must require ${drainFile}`);
    }
    for (const archiveFile of WAKEFLOW_RELEASE_REQUIRED_LEGACY_ARCHIVE_FILES) {
      assert.equal(contract.requiredFiles.includes(archiveFile), true, `${hostId} must require ${archiveFile}`);
    }
    for (const migrationPlanFile of WAKEFLOW_RELEASE_REQUIRED_MIGRATION_PLAN_FILES) {
      assert.equal(contract.requiredFiles.includes(migrationPlanFile), true, `${hostId} must require ${migrationPlanFile}`);
    }
    for (const migrationApplyFile of WAKEFLOW_RELEASE_REQUIRED_MIGRATION_APPLY_FILES) {
      assert.equal(contract.requiredFiles.includes(migrationApplyFile), true, `${hostId} must require ${migrationApplyFile}`);
    }
    for (const effectFile of WAKEFLOW_RELEASE_REQUIRED_CODEX_MIGRATION_EFFECT_FILES) {
      assert.equal(
        contract.requiredFiles.includes(effectFile),
        hostId === "codex",
        `${hostId} Codex migration effect packaging must match host applicability for ${effectFile}`,
      );
    }
    for (const effectFile of WAKEFLOW_RELEASE_REQUIRED_CLAUDE_MIGRATION_EFFECT_FILES) {
      assert.equal(
        contract.requiredFiles.includes(effectFile),
        hostId === "claude-code",
        `${hostId} Claude migration effect packaging must match host applicability for ${effectFile}`,
      );
    }
    for (const maintenancePlanFile of WAKEFLOW_RELEASE_REQUIRED_MAINTENANCE_PLAN_FILES) {
      assert.equal(
        contract.requiredFiles.includes(maintenancePlanFile),
        true,
        `${hostId} must require ${maintenancePlanFile}`,
      );
    }
    for (const maintenanceSurfaceFile of WAKEFLOW_RELEASE_REQUIRED_PUBLIC_V3_SURFACE_FILES) {
      assert.equal(
        contract.requiredFiles.includes(maintenanceSurfaceFile),
        true,
        `${hostId} must require ${maintenanceSurfaceFile}`,
      );
    }
    for (const runtimeFile of WAKEFLOW_RELEASE_REQUIRED_WINDOW_RUNTIME_FILES) {
      assert.equal(contract.requiredFiles.includes(runtimeFile), true, `${hostId} must require ${runtimeFile}`);
    }
    for (const locatorFile of WAKEFLOW_RELEASE_REQUIRED_CLAUDE_LOCATOR_FILES) {
      assert.equal(
        contract.requiredFiles.includes(locatorFile),
        hostId === "claude-code",
        `${hostId} Claude locator packaging must match host applicability for ${locatorFile}`,
      );
    }
    for (const transportHostFile of WAKEFLOW_RELEASE_REQUIRED_CLAUDE_TRANSPORT_FILES) {
      assert.equal(
        contract.requiredFiles.includes(transportHostFile),
        hostId === "claude-code",
        `${hostId} Claude transport packaging must match host applicability for ${transportHostFile}`,
      );
    }
    for (const settingsHostFile of WAKEFLOW_RELEASE_REQUIRED_CLAUDE_SETTINGS_FILES) {
      assert.equal(
        contract.requiredFiles.includes(settingsHostFile),
        hostId === "claude-code",
        `${hostId} Claude settings packaging must match host applicability for ${settingsHostFile}`,
      );
    }
    for (const activityHostFile of WAKEFLOW_RELEASE_REQUIRED_CLAUDE_ACTIVITY_FILES) {
      assert.equal(
        contract.requiredFiles.includes(activityHostFile),
        hostId === "claude-code",
        `${hostId} Claude activity packaging must match host applicability for ${activityHostFile}`,
      );
    }
    assert.equal(contract.requiredFiles.includes("templates/wakeflow-asset-bundle.json"), true);
    assert.equal(contract.requiredFiles.includes("templates/wakeflow-template-bundle.json"), false);
    const result = evaluateWakeflowPackageReport({ hostId, expectedVersion: "1.2.3", report: validReport(hostId) });
    assert.equal(result.ok, true, result.issues.join("\n"));
  }
});

test("release Skill inventory equals every recursively shipped Skill resource", () => {
  for (const relative of ["plugins/codex-wakeflow", "plugins/claude-code-wakeflow"]) {
    const actual = listSkillFiles(path.join(repositoryRoot, relative));
    assert.deepEqual(actual, WAKEFLOW_RELEASE_REQUIRED_SKILL_FILES, relative);
  }
});

test("pure pack evaluator reports every missing required file", () => {
  for (const hostId of Object.keys(WAKEFLOW_RELEASE_PACKAGING_CONTRACTS)) {
    const contract = wakeflowReleasePackagingContract(hostId);
    for (const required of contract.requiredFiles) {
      const report = validReport(hostId);
      report.files = report.files.filter((entry) => entry.path !== required);
      const result = evaluateWakeflowPackageReport({ hostId, expectedVersion: "1.2.3", report });
      assert.equal(result.ok, false);
      assert.ok(result.issues.some((issue) => issue.endsWith(`pack is missing ${required}`)), required);
    }
  }
});

test("pure pack evaluator rejects version drift, invalid entries, duplicates, and authoring-source leakage", () => {
  const versionDrift = evaluateWakeflowPackageReport({
    hostId: "codex",
    expectedVersion: "1.2.3",
    report: validReport("codex", "9.9.9"),
  });
  assert.equal(versionDrift.ok, false);
  assert.match(versionDrift.issues.join("\n"), /does not match/u);

  const report = validReport("claude-code");
  report.files.push(report.files[0], { path: "template-sources/manifest.json" }, { size: 1 });
  const malformed = evaluateWakeflowPackageReport({
    hostId: "claude-code",
    expectedVersion: "1.2.3",
    report,
  });
  assert.equal(malformed.ok, false);
  assert.match(malformed.issues.join("\n"), /duplicate file paths/u);
  assert.match(malformed.issues.join("\n"), /authoring-only source/u);
  assert.match(malformed.issues.join("\n"), /invalid file entry/u);

  const inconsistentReport = validReport("codex");
  inconsistentReport.name = "another-package";
  inconsistentReport.entryCount += 2;
  inconsistentReport.files.push({ path: "../outside-package" });
  const inconsistent = evaluateWakeflowPackageReport({
    hostId: "codex",
    expectedVersion: "1.2.3",
    report: inconsistentReport,
  });
  assert.equal(inconsistent.ok, false);
  assert.match(inconsistent.issues.join("\n"), /pack name .* does not match/u);
  assert.match(inconsistent.issues.join("\n"), /entryCount does not match/u);
  assert.match(inconsistent.issues.join("\n"), /invalid file entry/u);

  const extendedArrayReport = validReport("codex");
  Object.setPrototypeOf(extendedArrayReport.files, Object.create(Array.prototype));
  const extendedArray = evaluateWakeflowPackageReport({
    hostId: "codex",
    expectedVersion: "1.2.3",
    report: extendedArrayReport,
  });
  assert.equal(extendedArray.ok, false);
  assert.match(extendedArray.issues.join("\n"), /invalid file entry/u);
});

test("pure pack evaluator never executes request, report, or file-entry accessors", () => {
  let getterCalls = 0;
  const request = {
    expectedVersion: "1.2.3",
    report: validReport("codex"),
  };
  Object.defineProperty(request, "hostId", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "codex";
    },
  });
  assert.throws(
    () => evaluateWakeflowPackageReport(request),
    /hostId must be an enumerable data property/u,
  );
  assert.equal(getterCalls, 0);

  const reportWithAccessor = validReport("codex");
  Object.defineProperty(reportWithAccessor, "files", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return [];
    },
  });
  const invalidReport = evaluateWakeflowPackageReport({
    hostId: "codex",
    expectedVersion: "1.2.3",
    report: reportWithAccessor,
  });
  assert.equal(invalidReport.ok, false);
  assert.match(invalidReport.issues.join("\n"), /pack report is missing or invalid/u);
  assert.equal(getterCalls, 0);

  const entryAccessorReport = validReport("codex");
  Object.defineProperty(entryAccessorReport.files[0], "path", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "package.json";
    },
  });
  const invalidEntry = evaluateWakeflowPackageReport({
    hostId: "codex",
    expectedVersion: "1.2.3",
    report: entryAccessorReport,
  });
  assert.equal(invalidEntry.ok, false);
  assert.match(invalidEntry.issues.join("\n"), /invalid file entry/u);
  assert.equal(getterCalls, 0);
});

test("pure pack evaluator never coerces behavioral scalar fields", () => {
  let coercionCalls = 0;
  const behavioralValue = {
    toString() {
      coercionCalls += 1;
      return "codex";
    },
    valueOf() {
      coercionCalls += 1;
      return 1;
    },
  };
  assert.throws(
    () => evaluateWakeflowPackageReport({
      hostId: behavioralValue,
      expectedVersion: "1.2.3",
      report: validReport("codex"),
    }),
    /unknown Wakeflow release packaging host/u,
  );

  const behavioralReport = validReport("codex");
  behavioralReport.name = behavioralValue;
  behavioralReport.version = behavioralValue;
  behavioralReport.entryCount = behavioralValue;
  behavioralReport.files[0].path = behavioralValue;
  const result = evaluateWakeflowPackageReport({
    hostId: "codex",
    expectedVersion: behavioralValue,
    report: behavioralReport,
  });
  assert.equal(result.ok, false);
  assert.equal(result.name, null);
  assert.equal(result.version, null);
  assert.match(result.issues.join("\n"), /no expected release version/u);
  assert.match(result.issues.join("\n"), /pack name .* does not match/u);
  assert.match(result.issues.join("\n"), /entryCount does not match/u);
  assert.match(result.issues.join("\n"), /invalid file entry/u);
  assert.equal(coercionCalls, 0);
});

test("pack contract rejects unknown hosts without running npm or Git", () => {
  assert.throws(() => wakeflowReleasePackagingContract("future-host"), /unknown Wakeflow release packaging host/u);
  for (const hostId of ["__proto__", "constructor", "toString"]) {
    assert.throws(() => wakeflowReleasePackagingContract(hostId), /unknown Wakeflow release packaging host/u);
  }
  assert.throws(
    () => evaluateWakeflowPackageReport({ hostId: "future-host", expectedVersion: "1.2.3", report: {} }),
    /unknown Wakeflow release packaging host/u,
  );
});
