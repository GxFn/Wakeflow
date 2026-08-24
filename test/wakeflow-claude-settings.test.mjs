import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  claudeStatuslineAssetContent,
  claudeStatuslineAssetRef,
  claudeStatuslineCommand,
  createClaudeSettingsAssetsMutationParticipant,
  inspectClaudeSettingsAssets,
  inspectClaudeStatuslineAssetRuntime,
  planClaudeSettingsAssets,
  planClaudeSettingsAssetsMaintenance,
  validateClaudeSettingsAssetsMaintenancePlan,
  validateClaudeSettingsAssetsPlan,
} from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-settings.mjs";
import {
  recoverWakeflowWorkspaceMutation,
  runWakeflowMaintenanceMutation,
} from "../plugins/claude-code-wakeflow/scripts/lib/wakeflow-workspace-mutation.mjs";
import { canonicalJsonDigest } from "../core/scripts/lib/wakeflow-canonical-json.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const claudeRoot = path.join(repositoryRoot, "plugins/claude-code-wakeflow");
const codexRoot = path.join(repositoryRoot, "plugins/codex-wakeflow");
const moduleFile = path.join(
  claudeRoot,
  "scripts/lib/wakeflow-claude-settings.mjs",
);
const mutationFile = path.join(
  claudeRoot,
  "scripts/lib/wakeflow-workspace-mutation.mjs",
);
const canonicalFile = path.join(
  repositoryRoot,
  "core/scripts/lib/wakeflow-canonical-json.mjs",
);
const configFixtureFile = path.join(
  repositoryRoot,
  "test/fixtures/wakeflow-config-v3/valid-minimal.json",
);

const IDS = Object.freeze({
  program: "program_11111111-1111-4111-8111-111111111111",
  repository: "repository_22222222-2222-4222-8222-222222222222",
  controllerWindow: "window_55555555-5555-4555-8555-555555555555",
  controllerBinding: "binding_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  controllerSession: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
});

const SETTINGS_EXPORTS = Object.freeze([
  "WAKEFLOW_CLAUDE_PORTABLE_ALLOW_RULES",
  "WAKEFLOW_CLAUDE_SETTINGS_HOST_ID",
  "WAKEFLOW_CLAUDE_SETTINGS_MAINTENANCE_KIND",
  "WAKEFLOW_CLAUDE_SETTINGS_MAINTENANCE_SCHEMA_ID",
  "WAKEFLOW_CLAUDE_SETTINGS_MAINTENANCE_SCHEMA_VERSION",
  "WAKEFLOW_CLAUDE_SETTINGS_SCHEMA_VERSION",
  "WakeflowClaudeSettingsError",
  "claudeStatuslineAssetContent",
  "claudeStatuslineAssetRef",
  "claudeStatuslineCommand",
  "createClaudeSettingsAssetsMutationParticipant",
  "inspectClaudeSettingsAssets",
  "inspectClaudeStatuslineAssetRuntime",
  "planClaudeSettingsAssets",
  "planClaudeSettingsAssetsMaintenance",
  "validateClaudeSettingsAssetsMaintenancePlan",
  "validateClaudeSettingsAssetsPlan",
  "wakeflowHostSettingsAssetsAdapter",
]);

function ensureDirectory(root, ref, mode = 0o700) {
  let current = root;
  for (const segment of ref.split("/")) {
    current = path.join(current, segment);
    if (!existsSync(current)) mkdirSync(current, { mode });
    if (process.platform !== "win32") chmodSync(current, mode);
  }
  return current;
}

function runGit(root, args) {
  const result = spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    shell: false,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function initializeGitRoot(root, { ignored = true } = {}) {
  runGit(root, ["init", "--quiet"]);
  if (ignored) {
    writeFileSync(path.join(root, ".gitignore"), ".claude/settings.local.json\n");
  }
}

function writeJson(file, value, mode = 0o600) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode });
  if (process.platform !== "win32") chmodSync(file, mode);
}

function createFixture(t, {
  ignored = true,
  mutateConfig = null,
  workspaceName = "Program",
} = {}) {
  const base = mkdtempSync(path.join(os.tmpdir(), "wakeflow-claude-settings-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const workspaceRoot = path.join(base, workspaceName);
  const productRoot = path.join(base, "ProductA");
  const designRoot = path.join(workspaceRoot, "Design");
  const testRoot = path.join(workspaceRoot, "Test");
  for (const root of [workspaceRoot, productRoot, designRoot, testRoot]) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") chmodSync(root, 0o700);
  }
  const config = JSON.parse(readFileSync(configFixtureFile, "utf8"));
  if (mutateConfig) mutateConfig(config);
  writeJson(path.join(workspaceRoot, "wakeflow.config.json"), config);
  ensureDirectory(workspaceRoot, ".wakeflow-local/runtime/maintenance/transactions");
  ensureDirectory(
    workspaceRoot,
    ".wakeflow-local/runtime/hosts/claude-code/operations/assets",
  );
  for (const root of [workspaceRoot, productRoot, designRoot, testRoot]) {
    initializeGitRoot(root, { ignored });
  }
  return {
    base,
    workspaceRoot,
    productRoot,
    designRoot,
    testRoot,
    config,
  };
}

function planInput(fixture, authorizedRepositoryIds = [IDS.repository]) {
  return {
    workspaceRoot: fixture.workspaceRoot,
    authorizedRepositoryIds,
  };
}

function rootInspection(plan, rootKind, rootId) {
  return plan.roots.find((entry) => entry.rootKind === rootKind && entry.rootId === rootId);
}

test("M4-T09 exposes one Claude-only settings/assets owner", async () => {
  await access(moduleFile);
  const settings = await import(pathToFileURL(moduleFile).href);
  assert.deepEqual(Object.keys(settings).sort(), [...SETTINGS_EXPORTS].sort());
  assert.equal(settings.WAKEFLOW_CLAUDE_SETTINGS_HOST_ID, "claude-code");
  assert.equal(settings.WAKEFLOW_CLAUDE_SETTINGS_SCHEMA_VERSION, 1);
  assert.deepEqual(settings.WAKEFLOW_CLAUDE_PORTABLE_ALLOW_RULES, [
    "mcp__plugin_wakeflow_wakeflow",
    "Bash(node *)",
    "Bash(tmux *)",
    "Bash(git *)",
  ]);
  assert.equal(Object.isFrozen(settings.wakeflowHostSettingsAssetsAdapter), true);
  assert.deepEqual(
    Object.keys(settings.wakeflowHostSettingsAssetsAdapter).sort(),
    ["createMutationParticipant", "hostId", "planMaintenance"],
  );
  assert.equal(settings.wakeflowHostSettingsAssetsAdapter.hostId, "claude-code");
  assert.equal(
    settings.wakeflowHostSettingsAssetsAdapter.planMaintenance,
    settings.planClaudeSettingsAssetsMaintenance,
  );
  assert.equal(
    settings.wakeflowHostSettingsAssetsAdapter.createMutationParticipant,
    settings.createClaudeSettingsAssetsMutationParticipant,
  );

  await assert.rejects(
    access(path.join(codexRoot, "scripts/lib/wakeflow-claude-settings.mjs")),
    { code: "ENOENT" },
  );
});

test("statusline asset is deterministic, explicit-root, runnable, and handle-redacted", (t) => {
  const fixture = createFixture(t, { workspaceName: "Program owner's space" });
  const content = claudeStatuslineAssetContent();
  assert.equal(claudeStatuslineAssetRef(), ".wakeflow-local/runtime/hosts/claude-code/operations/assets/statusline.mjs");
  assert.match(content, /wakeflow-statusline-schema: 1/u);
  assert.match(content, /wakeflow-statusline-template: 1/u);
  assert.doesNotMatch(content, /import\.meta\.url|trackedConfigFile/u);
  assert.equal(content.includes(fixture.workspaceRoot), false);
  assert.equal(content.includes(IDS.controllerSession), false);

  const command = claudeStatuslineCommand({ workspaceRoot: fixture.workspaceRoot });
  assert.match(command, /--wakeflow-statusline-v1 --workspace-root-base64/u);
  assert.match(command, /operations\/assets\/statusline\.mjs/u);
  assert.equal(
    command.includes(Buffer.from(fixture.workspaceRoot, "utf8").toString("base64url")),
    true,
    "the machine-local command carries the explicit workspace root argument",
  );

  const assetFile = path.join(fixture.workspaceRoot, ...claudeStatuslineAssetRef().split("/"));
  writeFileSync(assetFile, content, { mode: 0o600 });
  if (process.platform !== "win32") chmodSync(assetFile, 0o600);
  const bindingRoot = ensureDirectory(
    fixture.workspaceRoot,
    ".wakeflow-local/runtime/hosts/claude-code/identity/window-bindings",
  );
  writeJson(path.join(bindingRoot, `${IDS.controllerWindow}.json`), {
    kind: "wakeflow-window-binding",
    schemaVersion: 1,
    programId: IDS.program,
    hostId: "claude-code",
    windowId: IDS.controllerWindow,
    bindingId: IDS.controllerBinding,
    handle: { kind: "claude-session", value: IDS.controllerSession },
    registeredAt: "2026-08-09T12:00:00.000Z",
  });

  const registered = inspectClaudeStatuslineAssetRuntime({
    workspaceRoot: fixture.workspaceRoot,
    source: "installed",
    stdin: JSON.stringify({
      session_id: IDS.controllerSession,
      model: { display_name: "Claude Opus" },
      workspace: { current_dir: fixture.productRoot },
    }),
  });
  assert.equal(registered.output, "Claude Opus · Controller");
  assert.equal(registered.output.includes(IDS.controllerSession), false);

  if (process.platform !== "win32") {
    const shellRuntime = spawnSync("/bin/sh", ["-c", command], {
      cwd: fixture.workspaceRoot,
      encoding: "utf8",
      input: JSON.stringify({
        session_id: IDS.controllerSession,
        model: { display_name: "Claude Opus" },
        workspace: { current_dir: fixture.productRoot },
      }),
      shell: false,
      timeout: 5_000,
      maxBuffer: 16 * 1024,
    });
    assert.equal(shellRuntime.status, 0, shellRuntime.stderr);
    assert.equal(shellRuntime.stderr, "");
    assert.equal(shellRuntime.stdout, "Claude Opus · Controller\n");
  }

  const scratch = path.join(fixture.workspaceRoot, "Scratch");
  mkdirSync(scratch);
  const unregistered = inspectClaudeStatuslineAssetRuntime({
    workspaceRoot: fixture.workspaceRoot,
    source: "installed",
    stdin: JSON.stringify({
      session_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      model: { id: "claude-sonnet" },
      workspace: { current_dir: scratch },
    }),
    cwd: scratch,
  });
  assert.equal(unregistered.output, "claude-sonnet · Scratch");

  const invalid = inspectClaudeStatuslineAssetRuntime({
    workspaceRoot: fixture.workspaceRoot,
    source: "installed",
    stdin: "not-json",
  });
  assert.equal(invalid.output, "model? · Program owner's space");

  if (process.platform !== "win32") {
    const bindingFile = path.join(bindingRoot, `${IDS.controllerWindow}.json`);
    const externalBinding = path.join(fixture.base, "external-binding.json");
    writeFileSync(externalBinding, readFileSync(bindingFile));
    rmSync(bindingFile);
    symlinkSync(externalBinding, bindingFile);
    const symlinked = inspectClaudeStatuslineAssetRuntime({
      workspaceRoot: fixture.workspaceRoot,
      source: "installed",
      stdin: JSON.stringify({
        session_id: IDS.controllerSession,
        model: { display_name: "Claude Opus" },
        workspace: { current_dir: fixture.productRoot },
      }),
    });
    assert.equal(symlinked.output, "Claude Opus · ProductA");
  }
});

test("public settings inputs reject behavioral arrays and non-absolute roots without executing getters", (t) => {
  const fixture = createFixture(t);
  let getterHits = 0;
  const behavioralIds = [IDS.repository];
  Object.defineProperty(behavioralIds, "0", {
    enumerable: true,
    configurable: true,
    get() {
      getterHits += 1;
      return IDS.repository;
    },
  });
  assert.throws(
    () => planClaudeSettingsAssets({
      workspaceRoot: fixture.workspaceRoot,
      authorizedRepositoryIds: behavioralIds,
    }),
    { code: "wakeflow-claude-settings-contract" },
  );
  assert.equal(getterHits, 0);
  assert.throws(
    () => planClaudeSettingsAssets({
      workspaceRoot: ".",
      authorizedRepositoryIds: [],
    }),
    { code: "wakeflow-claude-settings-contract" },
  );
});

test("plan is read-only, deterministic, deep-frozen, and covers every explicitly eligible root", (t) => {
  const fixture = createFixture(t);
  const before = readFileSync(path.join(fixture.workspaceRoot, "wakeflow.config.json"), "utf8");
  const first = planClaudeSettingsAssets(planInput(fixture));
  const second = planClaudeSettingsAssets(planInput(fixture));
  assert.deepEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.operations), true);
  assert.equal(validateClaudeSettingsAssetsPlan(first).planDigest, first.planDigest);
  assert.equal(first.blockers.length, 0);
  assert.equal(first.operations.length, 13, "asset plus directory/portable/local for four eligible roots");
  assert.equal(readFileSync(path.join(fixture.workspaceRoot, "wakeflow.config.json"), "utf8"), before);
  assert.equal(existsSync(path.join(fixture.workspaceRoot, ".claude")), false);
  assert.equal(existsSync(path.join(fixture.productRoot, ".claude")), false);

  const inspection = inspectClaudeSettingsAssets(planInput(fixture));
  assert.equal(inspection.status, "needs-reconcile");
  assert.equal(inspection.planDigest, first.planDigest);
  assert.equal(JSON.stringify(inspection).includes(fixture.workspaceRoot), false);
  assert.equal(JSON.stringify(inspection).includes("sourceIdentity"), false);
});

test("I5 authorization is exact by repositoryId and never inferred from topology or instruction policy", (t) => {
  const fixture = createFixture(t);
  const unlisted = planClaudeSettingsAssets(planInput(fixture, []));
  const product = rootInspection(unlisted, "repository", IDS.repository);
  assert.equal(product.authorization, "not-authorized");
  assert.equal(product.writerEligible, false);
  assert.equal(
    unlisted.operations.some((entry) => entry.root.rootKind === "repository"),
    false,
  );
  assert.ok(unlisted.diagnostics.some((entry) => entry.startsWith(`repository:${IDS.repository}:writer-not-authorized`)));

  const authorized = planClaudeSettingsAssets(planInput(fixture));
  assert.equal(rootInspection(authorized, "repository", IDS.repository).authorization, "explicit-repository");
  assert.equal(
    authorized.operations.some((entry) => entry.root.rootKind === "repository"),
    true,
  );
  assert.throws(
    () => planClaudeSettingsAssets(planInput(fixture, [IDS.repository, IDS.repository])),
    { code: "wakeflow-claude-settings-authorization" },
  );
  assert.throws(
    () => planClaudeSettingsAssets(planInput(fixture, ["repository_99999999-9999-4999-8999-999999999999"])),
    { code: "wakeflow-claude-settings-authorization" },
  );

  const externalFixture = createFixture(t, {
    mutateConfig(config) {
      config.topology.supportSurfaces[0].ownership = "external-owned";
      config.topology.supportSurfaces[0].instructionManagement = "managed-block";
    },
  });
  const external = planClaudeSettingsAssets(planInput(externalFixture));
  const externalDesign = rootInspection(
    external,
    "support-surface",
    externalFixture.config.topology.supportSurfaces[0].surfaceId,
  );
  assert.equal(externalDesign.authorization, "external-owned");
  assert.equal(externalDesign.writerEligible, false);
  assert.equal(
    external.operations.some((entry) => (
      entry.root.rootKind === "support-surface"
      && entry.root.rootId === externalDesign.rootId
    )),
    false,
  );
});

test("portable merge preserves user keys and non-Wakeflow allow order while converging only managed entries", (t) => {
  const fixture = createFixture(t);
  const settingsDir = path.join(fixture.productRoot, ".claude");
  mkdirSync(settingsDir, { mode: 0o700 });
  writeJson(path.join(settingsDir, "settings.json"), {
    theme: { name: "owner-theme", nested: true },
    permissions: {
      deny: ["Bash(rm *)"],
      allow: [
        "Read",
        "Bash(node *)",
        "Write",
        "Bash(node *)",
      ],
    },
  }, 0o644);
  const plan = planClaudeSettingsAssets(planInput(fixture));
  const operation = plan.operations.find((entry) => (
    entry.root.rootKind === "repository" && entry.component === "portable-settings"
  ));
  const desired = JSON.parse(operation.desired.content);
  assert.deepEqual(desired.theme, { name: "owner-theme", nested: true });
  assert.deepEqual(desired.permissions.deny, ["Bash(rm *)"]);
  assert.deepEqual(desired.permissions.allow, [
    "Read",
    "Bash(node *)",
    "Write",
    "mcp__plugin_wakeflow_wakeflow",
    "Bash(tmux *)",
    "Bash(git *)",
  ]);
});

test("custom statusline is preserved, legacy exact local signature upgrades, and conflicting signatures block", (t) => {
  const customFixture = createFixture(t);
  const customDir = path.join(customFixture.workspaceRoot, ".claude");
  mkdirSync(customDir, { mode: 0o700 });
  writeJson(path.join(customDir, "settings.local.json"), {
    userKey: "keep",
    statusLine: { type: "command", command: "my-custom-statusline --compact" },
  }, 0o644);
  const custom = planClaudeSettingsAssets(planInput(customFixture));
  const customRoot = rootInspection(custom, "program", IDS.program);
  assert.equal(customRoot.local.status, "custom/unmanaged");
  assert.equal(custom.blockers.length, 0);
  assert.equal(
    custom.operations.some((entry) => entry.root.rootKind === "program" && entry.component === "local-settings"),
    false,
  );

  const legacyFixture = createFixture(t);
  const legacyDir = path.join(legacyFixture.workspaceRoot, ".claude");
  mkdirSync(legacyDir, { mode: 0o700 });
  writeJson(path.join(legacyDir, "settings.local.json"), {
    userKey: "keep",
    statusLine: {
      type: "command",
      command: `node "${path.join(legacyFixture.workspaceRoot, ".wakeflow-local/wakeflow-statusline.mjs")}"`,
    },
  }, 0o644);
  const legacy = planClaudeSettingsAssets(planInput(legacyFixture));
  const legacyOperation = legacy.operations.find((entry) => (
    entry.root.rootKind === "program" && entry.component === "local-settings"
  ));
  assert.equal(rootInspection(legacy, "program", IDS.program).local.status, "managed-drift");
  assert.equal(JSON.parse(legacyOperation.desired.content).userKey, "keep");
  assert.equal(
    JSON.parse(legacyOperation.desired.content).statusLine.command,
    claudeStatuslineCommand({ workspaceRoot: legacyFixture.workspaceRoot }),
  );

  const conflictFixture = createFixture(t);
  const conflictDir = path.join(conflictFixture.workspaceRoot, ".claude");
  mkdirSync(conflictDir, { mode: 0o700 });
  writeJson(path.join(conflictDir, "settings.local.json"), {
    statusLine: {
      type: "command",
      command: `node ${path.join(conflictFixture.workspaceRoot, claudeStatuslineAssetRef())} && echo unsafe`,
    },
  }, 0o644);
  const conflict = planClaudeSettingsAssets(planInput(conflictFixture));
  assert.equal(rootInspection(conflict, "program", IDS.program).local.status, "conflict");
  assert.ok(conflict.blockers.some((entry) => entry.includes("wakeflow-statusline-signature-conflict")));
});

test("local settings require real ignored and untracked Git evidence", (t) => {
  const notIgnoredFixture = createFixture(t, { ignored: false });
  const notIgnored = planClaudeSettingsAssets(planInput(notIgnoredFixture));
  assert.equal(rootInspection(notIgnored, "program", IDS.program).local.ignore.status, "not-ignored");
  assert.ok(notIgnored.blockers.some((entry) => entry.endsWith(":local-settings-not-ignored")));

  const trackedFixture = createFixture(t);
  const trackedDir = path.join(trackedFixture.workspaceRoot, ".claude");
  mkdirSync(trackedDir, { mode: 0o700 });
  writeJson(path.join(trackedDir, "settings.local.json"), {
    statusLine: {
      type: "command",
      command: claudeStatuslineCommand({ workspaceRoot: trackedFixture.workspaceRoot }),
    },
  }, 0o644);
  runGit(trackedFixture.workspaceRoot, ["add", "--force", LOCAL_SETTINGS_REF_FOR_TEST]);
  const tracked = planClaudeSettingsAssets(planInput(trackedFixture));
  assert.equal(rootInspection(tracked, "program", IDS.program).local.ignore.status, "tracked");
  assert.ok(tracked.blockers.some((entry) => entry.endsWith(":local-settings-tracked")));
});

test("Git ignore evidence is not redirected by inherited GIT environment", (t) => {
  const fixture = createFixture(t);
  const priorGitDir = process.env.GIT_DIR;
  const priorGitWorkTree = process.env.GIT_WORK_TREE;
  process.env.GIT_DIR = path.join(fixture.base, "missing-git-dir");
  process.env.GIT_WORK_TREE = path.join(fixture.base, "missing-work-tree");
  try {
    const plan = planClaudeSettingsAssets(planInput(fixture));
    assert.equal(rootInspection(plan, "program", IDS.program).local.ignore.status, "ignored");
  } finally {
    if (priorGitDir === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = priorGitDir;
    if (priorGitWorkTree === undefined) delete process.env.GIT_WORK_TREE;
    else process.env.GIT_WORK_TREE = priorGitWorkTree;
  }
});

test("invalid UTF-8 settings and a raced non-private settings directory fail closed", (t) => {
  const invalidFixture = createFixture(t);
  const invalidDir = path.join(invalidFixture.workspaceRoot, ".claude");
  mkdirSync(invalidDir, { mode: 0o700 });
  writeFileSync(path.join(invalidDir, "settings.json"), Buffer.from([0xc3, 0x28]));
  const invalid = planClaudeSettingsAssets(planInput(invalidFixture));
  assert.equal(rootInspection(invalid, "program", IDS.program).portable.status, "unsafe");
  assert.ok(invalid.blockers.some((entry) => entry.endsWith(":invalid-utf8")));

  if (process.platform !== "win32") {
    const racedFixture = createFixture(t);
    const input = { ...planInput(racedFixture), action: "reconcile" };
    const confirmed = planClaudeSettingsAssetsMaintenance(input);
    mkdirSync(path.join(racedFixture.workspaceRoot, ".claude"), { mode: 0o755 });
    chmodSync(path.join(racedFixture.workspaceRoot, ".claude"), 0o755);
    assert.throws(
      () => createClaudeSettingsAssetsMutationParticipant({
        ...input,
        confirmedPlan: confirmed,
      }),
      { code: "wakeflow-claude-settings-maintenance-residue" },
    );
    assert.equal(statSync(path.join(racedFixture.workspaceRoot, ".claude")).mode & 0o777, 0o755);
  }
});

test("maintenance participant rejects a stale repositoryId-to-root mapping before any host-surface write", (t) => {
  const fixture = createFixture(t);
  const input = { ...planInput(fixture), action: "reconcile" };
  const confirmed = planClaudeSettingsAssetsMaintenance(input);
  const replacementRoot = path.join(fixture.base, "ProductB");
  mkdirSync(replacementRoot, { mode: 0o700 });
  if (process.platform !== "win32") chmodSync(replacementRoot, 0o700);
  initializeGitRoot(replacementRoot);
  fixture.config.topology.repositories[0].path = "../ProductB";
  writeJson(path.join(fixture.workspaceRoot, "wakeflow.config.json"), fixture.config);

  assert.throws(
    () => createClaudeSettingsAssetsMutationParticipant({
      ...input,
      confirmedPlan: confirmed,
    }),
    { code: "wakeflow-claude-settings-authorization" },
  );
  assert.equal(existsSync(path.join(fixture.productRoot, ".claude")), false);
  assert.equal(existsSync(path.join(replacementRoot, ".claude")), false);
});

const LOCAL_SETTINGS_REF_FOR_TEST = ".claude/settings.local.json";

test("legacy broad portable grants and portable Wakeflow statusline remain migration-only", (t) => {
  const fixture = createFixture(t);
  const settingsDir = path.join(fixture.workspaceRoot, ".claude");
  mkdirSync(settingsDir, { mode: 0o700 });
  const original = {
    ownerKey: "keep",
    statusLine: {
      type: "command",
      command: `node "${path.join(fixture.workspaceRoot, ".wakeflow-local/wakeflow-statusline.mjs")}"`,
    },
    permissions: {
      allow: [],
      additionalDirectories: [fixture.workspaceRoot],
    },
  };
  writeJson(path.join(settingsDir, "settings.json"), original, 0o644);
  const plan = planClaudeSettingsAssets(planInput(fixture));
  assert.equal(rootInspection(plan, "program", IDS.program).portable.status, "migration-required");
  assert.ok(plan.blockers.some((entry) => entry.includes("legacy-broad-additional-directory")));
  assert.deepEqual(JSON.parse(readFileSync(path.join(settingsDir, "settings.json"), "utf8")), original);
});

test("Claude settings maintenance wrapper is redacted, transactional, and converges to zero steps", async (t) => {
  const fixture = createFixture(t);
  const input = {
    ...planInput(fixture),
    action: "reconcile",
  };
  const plan = planClaudeSettingsAssetsMaintenance(input);
  assert.equal(validateClaudeSettingsAssetsMaintenancePlan(plan).payload.status, "ready");
  assert.equal(plan.payload.operations.length > 0, true);
  assert.equal(plan.payload.steps.length, plan.payload.operations.length);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(JSON.stringify(plan).includes(fixture.workspaceRoot), false);
  assert.equal(JSON.stringify(plan).includes("sourceIdentity"), false);
  assert.equal(JSON.stringify(plan).includes("desiredContent"), false);
  assert.throws(
    () => createClaudeSettingsAssetsMutationParticipant({
      ...input,
      authorizedRepositoryIds: [],
      confirmedPlan: plan,
    }),
    { code: "wakeflow-claude-settings-plan-stale" },
  );
  const participant = createClaudeSettingsAssetsMutationParticipant({
    ...input,
    confirmedPlan: plan,
  });
  const result = await runWakeflowMaintenanceMutation({
    workspaceRoot: fixture.workspaceRoot,
    action: "reconcile",
    operationKind: "claude-settings-assets",
    domainOwner: "host-settings-assets-owner",
    confirmedPlan: plan,
    planDigest: canonicalJsonDigest(plan),
    validatePlan: participant.validatePlan,
    deriveCurrentPlan: participant.deriveCurrentPlan,
    deriveTerminalClosure: participant.deriveTerminalClosure,
    stepHandlers: participant.stepHandlers,
  });
  assert.equal(result.status, "completed");
  const current = planClaudeSettingsAssetsMaintenance(input);
  assert.equal(current.payload.status, "ready");
  assert.equal(current.payload.operations.length, 0);
  assert.equal(current.payload.steps.length, 0);
  assert.equal(planClaudeSettingsAssets(planInput(fixture)).operations.length, 0);
  for (const root of [fixture.workspaceRoot, fixture.designRoot, fixture.testRoot, fixture.productRoot]) {
    const portable = JSON.parse(readFileSync(path.join(root, ".claude/settings.json"), "utf8"));
    const local = JSON.parse(readFileSync(path.join(root, ".claude/settings.local.json"), "utf8"));
    assert.deepEqual(portable.permissions.allow, [
      "mcp__plugin_wakeflow_wakeflow",
      "Bash(node *)",
      "Bash(tmux *)",
      "Bash(git *)",
    ]);
    assert.equal(local.statusLine.command, claudeStatuslineCommand({ workspaceRoot: fixture.workspaceRoot }));
  }
  const asset = statSync(path.join(fixture.workspaceRoot, ...claudeStatuslineAssetRef().split("/")));
  if (process.platform !== "win32") assert.equal(asset.mode & 0o777, 0o600);
});

test("maintenance plan validation derives component semantics instead of trusting a resigned payload", (t) => {
  const fixture = createFixture(t);
  const plan = planClaudeSettingsAssetsMaintenance({
    ...planInput(fixture),
    action: "reconcile",
  });
  for (const mutate of [
    (candidate) => { candidate.payload.operations[0].reasonCode = "forged-reason"; },
    (candidate) => { candidate.payload.operations[0].classification = "managed-stale-known"; },
    (candidate) => { candidate.payload.operations[0].resourceRef = "targets/forged"; },
  ]) {
    const forged = structuredClone(plan);
    mutate(forged);
    assert.throws(
      () => validateClaudeSettingsAssetsMaintenancePlan(forged),
      { code: "wakeflow-claude-settings-maintenance-plan" },
    );
  }
});

test("maintenance participant callbacks project passive arguments and brand context before field access", (t) => {
  const fixture = createFixture(t);
  const input = { ...planInput(fixture), action: "reconcile" };
  const plan = planClaudeSettingsAssetsMaintenance(input);
  const participant = createClaudeSettingsAssetsMutationParticipant({
    ...input,
    confirmedPlan: plan,
  });

  let argumentGetterHits = 0;
  const behavioralArguments = {};
  Object.defineProperty(behavioralArguments, "plan", {
    enumerable: true,
    get() {
      argumentGetterHits += 1;
      return plan;
    },
  });
  assert.throws(
    () => participant.validatePlan(behavioralArguments),
    { code: "wakeflow-claude-settings-contract" },
  );
  assert.equal(argumentGetterHits, 0);

  let contextGetterHits = 0;
  const forgedContext = {};
  Object.defineProperty(forgedContext, "recoveryGeneration", {
    enumerable: true,
    get() {
      contextGetterHits += 1;
      return 1;
    },
  });
  assert.throws(
    () => participant.deriveCurrentPlan({ context: forgedContext }),
    { code: "wakeflow-claude-settings-mutation" },
  );
  assert.equal(contextGetterHits, 0);

  const firstHandler = participant.stepHandlers[plan.payload.steps[0].stepId];
  let stepGetterHits = 0;
  const behavioralStepArguments = {};
  Object.defineProperty(behavioralStepArguments, "context", {
    enumerable: true,
    get() {
      stepGetterHits += 1;
      return forgedContext;
    },
  });
  assert.throws(
    () => firstHandler.prepare(behavioralStepArguments),
    { code: "wakeflow-claude-settings-contract" },
  );
  assert.equal(stepGetterHits, 0);
});

test("Claude settings maintenance recovers prepare, commit, and terminal cleanup boundaries", {
  skip: !new Set(["darwin", "linux"]).has(process.platform)
    ? "M3 process-identity recovery is supported on Darwin and Linux"
    : false,
  timeout: 120_000,
}, async (t) => {
  for (const boundary of ["prepare", "commit", "cleanup"]) {
    await t.test(boundary, { timeout: 40_000 }, async (subtest) => {
      const fixture = createFixture(subtest);
      const input = { ...planInput(fixture), action: "reconcile" };
      const childSource = `
        const owner = await import(${JSON.stringify(pathToFileURL(moduleFile).href)});
        const manager = await import(${JSON.stringify(pathToFileURL(mutationFile).href)});
        const canonical = await import(${JSON.stringify(pathToFileURL(canonicalFile).href)});
        const input = ${JSON.stringify(input)};
        const plan = owner.planClaudeSettingsAssetsMaintenance(input);
        const participant = owner.createClaudeSettingsAssetsMutationParticipant({ ...input, confirmedPlan: plan });
        const fileSteps = plan.payload.steps.filter((step) => step.staging !== null);
        const step = ${JSON.stringify(boundary)} === "cleanup" ? fileSteps.at(-1) : fileSteps[0];
        const real = participant.stepHandlers[step.stepId];
        const stepHandlers = { ...participant.stepHandlers, [step.stepId]: { ...real,
          ${boundary}(...args) { real.${boundary}(...args); process.kill(process.pid, "SIGKILL"); },
        } };
        await manager.runWakeflowMaintenanceMutation({
          workspaceRoot: input.workspaceRoot,
          action: input.action,
          operationKind: "claude-settings-assets",
          domainOwner: "host-settings-assets-owner",
          confirmedPlan: plan,
          planDigest: canonical.canonicalJsonDigest(plan),
          validatePlan: participant.validatePlan,
          deriveCurrentPlan: participant.deriveCurrentPlan,
          deriveTerminalClosure: participant.deriveTerminalClosure,
          stepHandlers,
        });
      `;
      const child = spawn(process.execPath, ["--input-type=module", "-e", childSource], {
        stdio: ["ignore", "ignore", "pipe"],
      });
      let childError = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => { childError += chunk; });
      const [exitCode, signal] = await once(child, "exit");
      assert.equal(exitCode, null, childError);
      assert.equal(signal, "SIGKILL", childError);

      const transactionRoot = path.join(
        fixture.workspaceRoot,
        ".wakeflow-local/runtime/maintenance/transactions",
      );
      const journalName = readdirSync(transactionRoot).find((name) => (
        /^workspace-mutation_[0-9a-f-]+\.json$/u.test(name)
      ));
      assert.equal(typeof journalName, "string");
      const operationId = journalName.slice(0, -".json".length);
      const durablePlan = JSON.parse(readFileSync(path.join(transactionRoot, journalName), "utf8")).plan;
      const participant = createClaudeSettingsAssetsMutationParticipant({
        ...input,
        confirmedPlan: durablePlan,
      });
      const recovered = await recoverWakeflowWorkspaceMutation({
        workspaceRoot: fixture.workspaceRoot,
        operationId,
        confirmedPlan: durablePlan,
        planDigest: canonicalJsonDigest(durablePlan),
        validatePlan: participant.validatePlan,
        deriveCurrentPlan: participant.deriveCurrentPlan,
        deriveTerminalClosure: participant.deriveTerminalClosure,
        stepHandlers: participant.stepHandlers,
      });
      assert.equal(
        recovered.status,
        boundary === "cleanup" ? "terminal-cleanup-recovered" : "recovered",
      );
      const current = planClaudeSettingsAssetsMaintenance(input);
      assert.equal(current.payload.operations.length, 0);
      assert.equal(current.payload.steps.length, 0);
      for (const operation of durablePlan.payload.operations) {
        const root = operation.root.configuredPath === "."
          ? fixture.workspaceRoot
          : path.resolve(fixture.workspaceRoot, operation.root.configuredPath);
        const final = path.resolve(root, operation.ref);
        assert.equal(existsSync(final), true);
        if (operation.stageRef !== null) {
          assert.equal(statSync(final).nlink, 1);
          assert.equal(existsSync(path.resolve(root, operation.stageRef)), false);
        }
      }
      assert.deepEqual(readdirSync(transactionRoot), []);
    });
  }
});
