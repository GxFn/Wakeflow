import { deepEqual, equal } from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  claudeCodeWorkspaceHostResourceProfile,
} from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import {
  planClaudeCodePortableSettingsComposition,
} from "../../../src/hosts/claude-code/claude-code-portable-settings-composition.js";
import {
  publishClaudeCodePortableSettings,
} from "../../../src/hosts/claude-code/claude-code-portable-settings-publication.js";
import {
  createMinimalWakeflowConfigV3,
} from "../../configuration/wakeflow-config-v3.fixture.js";

async function fixture(t: TestContext) {
  const absolutePath = mkdtempSync(path.join(
    os.tmpdir(),
    "wakeflow-claude-settings-composition-",
  ));
  const root = await RootedDirectory.open(absolutePath);
  t.after(async () => {
    await root.close();
    rmSync(absolutePath, { recursive: true, force: true });
  });
  return Object.freeze({ absolutePath, root });
}

function config() {
  const value = createMinimalWakeflowConfigV3();
  (value.storage as Record<string, unknown>).ledgerRoot = "Ledger";
  const repositories = (value.topology as {
    repositories: Record<string, unknown>[];
  }).repositories;
  const repository = repositories[0];
  if (repository === undefined) throw new Error("Expected repository.");
  repository.path = "ProductA";
  return value;
}

function request(
  action: "fresh-initialize" | "reconfigure" | "reconcile",
  configValue: unknown,
) {
  return Object.freeze({
    action,
    config: configValue,
    profile: claudeCodeWorkspaceHostResourceProfile,
  });
}

test("Fresh Claude composition plans Program and managed Support roots without writes", async (t) => {
  const value = await fixture(t);
  const before = readdirSync(value.absolutePath);
  const plan = await planClaudeCodePortableSettingsComposition(
    value.root,
    request("fresh-initialize", config()),
  );
  equal(plan.status, "ready");
  equal(plan.roots.length, 3);
  equal(plan.operations.length, 3);
  deepEqual(plan.roots.map((entry) => ({
    kind: entry.root.rootKind,
    placement: entry.root.configuredPlacement,
    status: entry.placementStatus,
  })), [{
    kind: "program",
    placement: ".",
    status: "present",
  }, {
    kind: "support-surface",
    placement: "Design",
    status: "planned-missing",
  }, {
    kind: "support-surface",
    placement: "Test",
    status: "planned-missing",
  }]);
  equal(JSON.stringify(plan).includes(value.absolutePath), false);
  deepEqual(readdirSync(value.absolutePath), before);

  const blocked = await planClaudeCodePortableSettingsComposition(
    value.root,
    request("reconfigure", config()),
  );
  equal(blocked.status, "blocked");
  equal(blocked.blockerCodes.length, 2);
});

test("composition reads present roots, excludes external Support, and never leaks bytes", async (t) => {
  const value = await fixture(t);
  mkdirSync(path.join(value.absolutePath, "Design"), { mode: 0o755 });
  mkdirSync(path.join(value.absolutePath, "Test"), { mode: 0o755 });
  await publishClaudeCodePortableSettings(value.root);
  const source = path.join(value.absolutePath, ".claude", "settings.json");
  const currentText = "{\n  \"secret-user-key\": \"do-not-project\",\n  \"permissions\": {\n    \"allow\": [\"mcp__plugin_wakeflow_wakeflow\"]\n  }\n}\n";
  writeFileSync(source, currentText, { mode: 0o644 });

  const valueWithExternal = config();
  const surfaces = (valueWithExternal.topology as {
    supportSurfaces: Record<string, unknown>[];
  }).supportSurfaces;
  const design = surfaces[0];
  if (design === undefined) throw new Error("Expected Design surface.");
  design.ownership = "external-owned";
  design.instructionManagement = "owner-managed";

  const plan = await planClaudeCodePortableSettingsComposition(
    value.root,
    request("reconcile", valueWithExternal),
  );
  equal(plan.status, "ready");
  equal(plan.roots.length, 2);
  equal(plan.roots.some((entry) => (
    entry.root.configuredPlacement === "Design"
  )), false);
  equal(plan.operations.length, 1);
  equal(JSON.stringify(plan).includes("do-not-project"), false);
});

test("one blocked managed Support source blocks composition without touching other roots", async (t) => {
  const value = await fixture(t);
  for (const directory of ["Design", "Test"]) {
    mkdirSync(path.join(value.absolutePath, directory, ".claude"), {
      mode: 0o755,
      recursive: true,
    });
  }
  const legacy = "{\"permissions\":{\"allow\":[\"Bash(git *)\"]}}\n";
  writeFileSync(
    path.join(value.absolutePath, "Design", ".claude", "settings.json"),
    legacy,
    { mode: 0o644 },
  );
  const plan = await planClaudeCodePortableSettingsComposition(
    value.root,
    request("reconcile", config()),
  );
  equal(plan.status, "blocked");
  equal(plan.blockerCodes.some((entry) => (
    entry.includes("legacy-broad-permission-present")
  )), true);
  equal(readFileSync(
    path.join(value.absolutePath, "Design", ".claude", "settings.json"),
    "utf8",
  ), legacy);
});
