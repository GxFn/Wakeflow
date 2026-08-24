import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repoRootUrl = new URL("../", import.meta.url);
const pluginRootUrl = new URL("../plugins/claude-code-wakeflow/", import.meta.url);
const marketplaceUrl = new URL("../.claude-plugin/marketplace.json", import.meta.url);

const bundledPluginEntries = [
  ".claude-plugin",
  ".mcp.json",
  "CLAUDE.md",
  "LICENSE",
  "README.md",
  "README.zh-CN.md",
  "assets",
  "bin",
  "commands",
  "lib",
  "mcp",
  "package.json",
  "schemas",
  "scripts",
  "skills",
  "templates",
  "wakeflow.config.example.json",
  "wakeflow.config.json",
];

const forbiddenPluginEntries = [
  ".agents",
  ".codex-plugin",
  "AGENTS.md",
  "agents",
  "docs",
  "node_modules",
  "test",
];

test("claude plugin artifact ships the expected top-level entries", async () => {
  const entries = await fs.readdir(pluginRootUrl);
  for (const expected of bundledPluginEntries) {
    assert.ok(entries.includes(expected), `claude plugin artifact must include ${expected}`);
  }
  for (const forbidden of forbiddenPluginEntries) {
    assert.ok(!entries.includes(forbidden), `claude plugin artifact must not include ${forbidden}`);
  }
});

test("claude plugin manifest is wired for Claude Code", async () => {
  const manifest = JSON.parse(await fs.readFile(new URL(".claude-plugin/plugin.json", pluginRootUrl), "utf8"));
  assert.equal(manifest.name, "wakeflow");
  assert.equal(manifest.mcpServers, "./.mcp.json");
  assert.ok(manifest.keywords.includes("unattended"));
  assert.match(manifest.description, /immutable target results/);
  assert.match(manifest.description, /independent Test validation/);
  assert.match(manifest.description, /evidence alone does not close a task/);
  assert.doesNotMatch(manifest.description, /only on reviewable evidence/i);

  const mcp = JSON.parse(await fs.readFile(new URL(".mcp.json", pluginRootUrl), "utf8"));
  const server = mcp.mcpServers?.wakeflow;
  assert.ok(server, ".mcp.json must expose mcpServers.wakeflow");
  assert.equal(server.command, "${CLAUDE_PLUGIN_ROOT}/bin/wakeflow-mcp");
  assert.deepEqual(server.args, []);
  assert.equal(server.cwd, undefined, "claude MCP wiring must not rely on cwd");
});

test("repo-level claude marketplace lists the nested claude plugin artifact", async () => {
  const marketplace = JSON.parse(await fs.readFile(marketplaceUrl, "utf8"));
  assert.equal(marketplace.name, "gxfn");
  assert.ok(marketplace.owner?.name);
  const entry = (marketplace.plugins ?? []).find((plugin) => plugin?.name === "wakeflow");
  assert.ok(entry, "marketplace must include wakeflow");
  const manifest = JSON.parse(await fs.readFile(new URL(".claude-plugin/plugin.json", pluginRootUrl), "utf8"));
  assert.equal(entry.description, manifest.description, "marketplace description must match the Claude plugin manifest");
  const source = typeof entry.source === "string" ? entry.source : entry.source?.source;
  assert.equal(source, "./plugins/claude-code-wakeflow");
  const resolved = path.resolve(new URL(".", repoRootUrl).pathname, source);
  assert.equal(resolved, new URL(".", pluginRootUrl).pathname.replace(/\/$/, ""));
});

test("claude slash commands exist with frontmatter descriptions", async () => {
  for (const command of ["init.md", "status.md", "dispatch.md", "review.md"]) {
    const text = await fs.readFile(new URL(`commands/${command}`, pluginRootUrl), "utf8");
    assert.match(text, /^---\n[\s\S]*?description:\s*\S[\s\S]*?\n---/, `${command} needs frontmatter description`);
  }
});

test("claude artifact ships generated assets, shared Skills, public v3 domains, transport, identity, leases, and runtime projections", async () => {
  for (const relative of [
    "templates/wakeflow-asset-bundle.json",
    "skills/wakeflow-controller/SKILL.md",
    "skills/wakeflow-target/SKILL.md",
    "skills/wakeflow-governance/SKILL.md",
    "skills/wakeflow-target-craft/SKILL.md",
    "skills/wakeflow-design/SKILL.md",
    "skills/wakeflow-test/SKILL.md",
    "schemas/wakeflow-demand-artifacts/pod-design-handoff.schema.json",
    "schemas/wakeflow-demand-artifacts/pod-design-request.schema.json",
    "schemas/wakeflow-demand-artifacts/review-candidate.schema.json",
    "schemas/wakeflow-demand-artifacts/target-result.schema.json",
    "schemas/wakeflow-demand-artifacts/task-package.schema.json",
    "schemas/wakeflow-demand-artifacts/test-card.schema.json",
    "scripts/lib/wakeflow-demand-artifact-records.mjs",
    "scripts/lib/wakeflow-demand-artifact-service.mjs",
    "scripts/lib/wakeflow-target-result-authority.mjs",
    "scripts/lib/wakeflow-config-v3-snapshot.mjs",
    "scripts/lib/wakeflow-active-identity-lock.mjs",
    "scripts/lib/wakeflow-active-projection-lock.mjs",
    "scripts/lib/wakeflow-active-projector.mjs",
    "schemas/wakeflow-business-archive/archive-transaction.schema.json",
    "schemas/wakeflow-business-archive/business-summary.schema.json",
    "schemas/wakeflow-business-archive/todo-history.schema.json",
    "schemas/wakeflow-business-archive/transport-summary.schema.json",
    "scripts/lib/wakeflow-business-archive-records.mjs",
    "scripts/lib/wakeflow-business-archive-service.mjs",
    "schemas/wakeflow-demand-evidence/evidence.schema.json",
    "scripts/lib/wakeflow-evidence-importer.mjs",
    "scripts/lib/wakeflow-evidence-records.mjs",
    "scripts/lib/wakeflow-evidence-tree.mjs",
    "schemas/wakeflow-window-identity/window-binding.schema.json",
    "schemas/wakeflow-window-identity/host-decommission-result.schema.json",
    "scripts/lib/wakeflow-window-binding-records.mjs",
    "scripts/lib/wakeflow-window-binding-service.mjs",
    "scripts/lib/wakeflow-host-decommission-result.mjs",
    "scripts/lib/wakeflow-claude-decommission.mjs",
    "scripts/lib/wakeflow-migration-host-decommission.mjs",
    "scripts/lib/wakeflow-claude-migration-decommission.mjs",
    "scripts/lib/wakeflow-claude-migration-effect.mjs",
    "scripts/lib/wakeflow-host-activation-gate.mjs",
    "scripts/lib/wakeflow-host-activation-scope.mjs",
    "scripts/lib/wakeflow-claude-activation-scope.mjs",
    "schemas/wakeflow-coordination/window-lease.schema.json",
    "scripts/lib/wakeflow-window-lease-records.mjs",
    "scripts/lib/wakeflow-window-lease-service.mjs",
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
    "scripts/lib/wakeflow-claude-pod-host.mjs",
    "schemas/wakeflow-claude-host/window-locator.schema.json",
    "schemas/wakeflow-claude-host/activity-monitor-manager-lock.schema.json",
    "schemas/wakeflow-claude-host/activity-monitor-process.schema.json",
    "scripts/lib/wakeflow-claude-activity.mjs",
    "scripts/lib/wakeflow-claude-host.mjs",
    "scripts/lib/wakeflow-claude-lifecycle.mjs",
    "scripts/lib/wakeflow-claude-locator.mjs",
    "scripts/lib/wakeflow-claude-settings.mjs",
    "scripts/lib/wakeflow-claude-transport.mjs",
    "schemas/wakeflow-keep-live/control.schema.json",
    "schemas/wakeflow-keep-live/lease.schema.json",
    "schemas/wakeflow-keep-live/manager-lock.schema.json",
    "schemas/wakeflow-keep-live/process.schema.json",
    "scripts/lib/wakeflow-keep-live-records.mjs",
    "scripts/lib/wakeflow-keep-live-service.mjs",
    "scripts/lib/wakeflow-process-identity.mjs",
    "schemas/wakeflow-delivery/delivery-envelope.schema.json",
    "schemas/wakeflow-delivery/delivery-run.schema.json",
    "schemas/wakeflow-delivery/dispatch-group.schema.json",
    "schemas/wakeflow-delivery/dispatch-packet.schema.json",
    "schemas/wakeflow-maintenance/transport-retention-plan.schema.json",
    "schemas/wakeflow-maintenance/local-preservation-plan.schema.json",
    "schemas/wakeflow-maintenance/local-preservation.schema.json",
    "schemas/wakeflow-maintenance/workspace-maintenance-plan.schema.json",
    "scripts/lib/wakeflow-preservation.mjs",
    "scripts/lib/wakeflow-artifact-tree-identity.mjs",
    "scripts/data/wakeflow-legacy-classifier-catalog.json",
    "scripts/lib/wakeflow-legacy-classifier.mjs",
    "scripts/lib/wakeflow-migration-inventory.mjs",
    "scripts/lib/wakeflow-legacy-owner-drain.mjs",
    "schemas/wakeflow-business-archive/legacy-evidence-summary.schema.json",
    "schemas/wakeflow-business-archive/legacy-source-descriptor.schema.json",
    "schemas/wakeflow-business-archive/legacy-transport-summary.schema.json",
    "schemas/wakeflow-ledger/archive-manifest.schema.json",
    "schemas/wakeflow-maintenance/legacy-archive-transform-plan.schema.json",
    "scripts/lib/wakeflow-ledger-records.mjs",
    "scripts/lib/wakeflow-legacy-archive-records.mjs",
    "scripts/lib/wakeflow-legacy-archive-transform.mjs",
    "scripts/lib/wakeflow-migration-plan.mjs",
    "bin/wakeflow-bootstrap",
    "schemas/wakeflow-maintenance/maintenance-transaction.schema.json",
    "schemas/wakeflow-maintenance/recovery-claim.schema.json",
    "schemas/wakeflow-maintenance/workspace-mutation-lock.schema.json",
    "scripts/lib/wakeflow-migration-apply.mjs",
    "scripts/lib/wakeflow-migration-config-owner.mjs",
    "scripts/lib/wakeflow-migration-production.mjs",
    "scripts/lib/wakeflow-workspace-mutation.mjs",
    "scripts/wakeflow-bootstrap.mjs",
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
    "scripts/lib/wakeflow-maintenance-action-runtime.mjs",
    "scripts/lib/wakeflow-maintenance-coordinator.mjs",
    "scripts/lib/wakeflow-maintenance-plan.mjs",
    "scripts/lib/wakeflow-observability-v3.mjs",
    "scripts/lib/wakeflow-public-v3-runtime.mjs",
    "scripts/lib/wakeflow-reconcile.mjs",
    "scripts/lib/wakeflow-reconfigure.mjs",
    "scripts/lib/wakeflow-support-materialization.mjs",
    "scripts/lib/wakeflow-support-surface-owner.mjs",
    "scripts/lib/wakeflow-tracked-materialization.mjs",
    "lib/wakeflow-mcp-tools.mjs",
    "scripts/wakeflow-smoke.mjs",
    "scripts/wakeflow-setup.mjs",
    "scripts/wakeflow-validate.mjs",
    "scripts/lib/wakeflow-delivery-orchestration.mjs",
    "scripts/lib/wakeflow-demand-lifecycle-orchestration.mjs",
    "scripts/lib/wakeflow-result-review-orchestration.mjs",
    "scripts/lib/wakeflow-transport-retention.mjs",
    "scripts/lib/wakeflow-transport-records.mjs",
    "scripts/lib/wakeflow-transport-store.mjs",
    "schemas/wakeflow-window-runtime/window-runtime.schema.json",
    "scripts/lib/wakeflow-window-runtime-projector.mjs",
    "scripts/lib/wakeflow-window-runtime-records.mjs",
  ]) {
    assert.equal((await fs.lstat(new URL(relative, pluginRootUrl))).isFile(), true, `${relative} must ship`);
  }
  await assert.rejects(fs.lstat(new URL("template-sources", pluginRootUrl)), { code: "ENOENT" });
  for (const relative of [
    "templates/wakeflow-template-bundle.json",
    "lib/wakeflow-mcp-tools-v3-candidate.mjs",
    "scripts/wakeflow-smoke-v3-candidate.mjs",
    "scripts/wakeflow-setup-v3-candidate.mjs",
    "scripts/wakeflow-validate-v3-candidate.mjs",
  ]) await assert.rejects(fs.lstat(new URL(relative, pluginRootUrl)), { code: "ENOENT" });
  await assert.rejects(
    fs.lstat(new URL("scripts/lib/wakeflow-codex-decommission.mjs", pluginRootUrl)),
    { code: "ENOENT" },
  );
  await assert.rejects(
    fs.lstat(new URL("scripts/lib/wakeflow-codex-migration-decommission.mjs", pluginRootUrl)),
    { code: "ENOENT" },
  );
  await assert.rejects(
    fs.lstat(new URL("scripts/lib/wakeflow-codex-migration-effect.mjs", pluginRootUrl)),
    { code: "ENOENT" },
  );
  await assert.rejects(
    fs.lstat(new URL("scripts/lib/wakeflow-codex-activation-scope.mjs", pluginRootUrl)),
    { code: "ENOENT" },
  );
});
