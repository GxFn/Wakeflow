import { deepEqual, equal } from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { planClaudeCodePortableSettingsComposition } from "../../../src/hosts/claude-code/claude-code-portable-settings-composition.js";
import { publishClaudeCodePortableSettings } from "../../../src/hosts/claude-code/claude-code-portable-settings-publication.js";
import { WAKEFLOW_CLAUDE_CODE_TMUX_PERMISSION_RULE } from "../../../src/hosts/claude-code/claude-code-tmux-asset.js";
import { claudeCodeWorkspaceHostResourceProfile } from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { createMinimalWakeflowConfig } from "../../configuration/wakeflow-config.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";

useDisposableDurability();

/**
 * Claude portable settings 的多根零写组合（能力卡 1 §1.1 / §1.4 宿主差异，gate-log §13.117 D5）。
 * 1 级组件测试（目录缺省 2 级）：只在一次性根上做只读检查与计划，不进维护事务。覆盖 fresh 的
 * planned-missing 根、external-owned 面的排除、节点政策与旧宽泛规则的 blocker，以及 reconcile 对
 * 被删受管根的 planned-missing create（open-items W5 / CR-H6）。
 */

async function fixture(t: TestContext) {
  const absolutePath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-claude-settings-composition-"));
  const root = await RootedDirectory.open(absolutePath);
  t.after(async () => {
    await root.close();
    rmSync(absolutePath, { recursive: true, force: true });
  });
  return Object.freeze({ absolutePath, root });
}

function config() {
  const value = createMinimalWakeflowConfig();
  (value.storage as Record<string, unknown>).ledgerRoot = "Ledger";
  const repositories = (
    value.topology as {
      repositories: Record<string, unknown>[];
    }
  ).repositories;
  const repository = repositories[0];
  if (repository === undefined) throw new Error("Expected repository.");
  repository.path = "ProductA";
  return value;
}

function request(action: "fresh-initialize" | "reconfigure" | "reconcile", configValue: unknown) {
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
  deepEqual(
    plan.roots.map((entry) => ({
      kind: entry.root.rootKind,
      placement: entry.root.configuredPlacement,
      status: entry.placementStatus,
    })),
    [
      {
        kind: "program",
        placement: ".",
        status: "present",
      },
      {
        kind: "support-surface",
        placement: "Design",
        status: "planned-missing",
      },
      {
        kind: "support-surface",
        placement: "Test",
        status: "planned-missing",
      },
    ],
  );
  equal(JSON.stringify(plan).includes(value.absolutePath), false);
  deepEqual(readdirSync(value.absolutePath), before);

  const blocked = await planClaudeCodePortableSettingsComposition(
    value.root,
    request("reconfigure", config()),
  );
  equal(blocked.status, "blocked");
  equal(blocked.blockerCodes.length, 2);
});

test("reconcile with a deleted managed Design root plans the rules into the root maintenance rebuilds first, instead of blocking", async (t) => {
  const value = await fixture(t);
  // 只有 Test 根在：Design 根是用户误删或移走的受管根（open-items W5 / CR-H6）。
  mkdirSync(path.join(value.absolutePath, "Test"), { mode: 0o755 });
  const plan = await planClaudeCodePortableSettingsComposition(
    value.root,
    request("reconcile", config()),
  );
  equal(plan.status, "ready");
  deepEqual(plan.blockerCodes, []);
  deepEqual(
    plan.roots.map((entry) => ({
      placement: entry.root.configuredPlacement,
      status: entry.placementStatus,
      settings: entry.settingsStatus,
      reason: entry.transitionReason,
    })),
    [
      { placement: ".", status: "present", settings: "create", reason: null },
      { placement: "Design", status: "planned-missing", settings: "create", reason: null },
      { placement: "Test", status: "present", settings: "create", reason: null },
    ],
  );
  const design = plan.operations.find((entry) => entry.root.configuredPlacement === "Design");
  if (design === undefined) throw new Error("Expected a Design operation.");
  equal(design.action, "create");
  equal(design.sourceDigest, null);
  // 规则指向将被重建的根：与 fresh-initialize 为同一缺席根计划的操作逐字段相同（同一 authority、根与规则）。
  const fresh = await planClaudeCodePortableSettingsComposition(
    value.root,
    request("fresh-initialize", config()),
  );
  deepEqual(
    design,
    fresh.operations.find((entry) => entry.root.configuredPlacement === "Design"),
  );
  // reconfigure 不放开：缺根仍是 support-root-missing（先 reconcile 修根，再改配置）。
  const reconfigure = await planClaudeCodePortableSettingsComposition(
    value.root,
    request("reconfigure", config()),
  );
  equal(reconfigure.status, "blocked");
  deepEqual(reconfigure.blockerCodes, [`support-root-missing:${design.root.rootId}`]);
  equal(JSON.stringify(plan).includes(value.absolutePath), false);
});

test("composition reads present roots, excludes external Support, and never leaks bytes", async (t) => {
  const value = await fixture(t);
  mkdirSync(path.join(value.absolutePath, "Design"), { mode: 0o755 });
  mkdirSync(path.join(value.absolutePath, "Test"), { mode: 0o755 });
  await publishClaudeCodePortableSettings(value.root);
  const source = path.join(value.absolutePath, ".claude", "settings.json");
  // 工作区根拥有两条规则（§13.117 D5）：两条都在时 program 根才是 current。
  const currentText = `{\n  "secret-user-key": "do-not-project",\n  "permissions": {\n    "allow": ["mcp__plugin_wakeflow_wakeflow", ${JSON.stringify(WAKEFLOW_CLAUDE_CODE_TMUX_PERMISSION_RULE)}]\n  }\n}\n`;
  writeFileSync(source, currentText, { mode: 0o644 });

  const valueWithExternal = config();
  const surfaces = (
    valueWithExternal.topology as {
      supportSurfaces: Record<string, unknown>[];
    }
  ).supportSurfaces;
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
  equal(
    plan.roots.some((entry) => entry.root.configuredPlacement === "Design"),
    false,
  );
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
  const legacy = '{"permissions":{"allow":["Bash(git *)"]}}\n';
  writeFileSync(path.join(value.absolutePath, "Design", ".claude", "settings.json"), legacy, {
    mode: 0o644,
  });
  const plan = await planClaudeCodePortableSettingsComposition(
    value.root,
    request("reconcile", config()),
  );
  equal(plan.status, "blocked");
  equal(
    plan.blockerCodes.some((entry) => entry.includes("legacy-broad-permission-present")),
    true,
  );
  equal(
    readFileSync(path.join(value.absolutePath, "Design", ".claude", "settings.json"), "utf8"),
    legacy,
  );
});

test("a settings.json outside the Wakeflow node policy becomes a blocker, not a failure", async (t) => {
  const value = await fixture(t);
  for (const directory of [".", "Design", "Test"]) {
    mkdirSync(path.join(value.absolutePath, directory, ".claude"), {
      mode: 0o755,
      recursive: true,
    });
  }
  const userText = '{"permissions":{"allow":[]}}\n';
  for (const directory of [".", "Design"]) {
    const source = path.join(value.absolutePath, directory, ".claude", "settings.json");
    writeFileSync(source, userText);
    chmodSync(source, 0o600);
  }
  const plan = await planClaudeCodePortableSettingsComposition(
    value.root,
    request("reconcile", config()),
  );
  equal(plan.status, "blocked");
  const policyBlockers = plan.blockerCodes.filter((entry) => entry.endsWith(":source-policy"));
  equal(policyBlockers.length, 2);
  equal(
    policyBlockers.some((entry) => entry.startsWith("settings-blocked:program:")),
    true,
  );
  equal(
    policyBlockers.some((entry) => entry.startsWith("settings-blocked:support-surface:")),
    true,
  );
  deepEqual(
    plan.roots.map((entry) => entry.settingsStatus),
    ["blocked", "blocked", "create"],
  );
  equal(readFileSync(path.join(value.absolutePath, ".claude", "settings.json"), "utf8"), userText);
});
