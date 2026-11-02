import { deepEqual, equal, ok } from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  executeStatusRequest,
  executeVerifyRequest,
  type ObservationHostFacade,
} from "../../../src/capabilities/observation/service.js";
import { executeClaudeCodeWakeflowMaintenance } from "../../../src/entrypoints/claude-code-wakeflow-maintenance.js";
import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import {
  CLAUDE_CODE_DESKTOP_ASSET_DIGEST,
  CLAUDE_CODE_DESKTOP_ASSET_FILE_NAME,
  CLAUDE_CODE_DESKTOP_ASSET_REF,
  WAKEFLOW_CLAUDE_CODE_DESKTOP_PERMISSION_RULE,
} from "../../../src/hosts/claude-code/claude-code-desktop-asset.js";
import { WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE } from "../../../src/hosts/claude-code/claude-code-portable-settings-transition.js";
import {
  CLAUDE_CODE_STATUSLINE_ASSET_DIGEST,
  CLAUDE_CODE_STATUSLINE_ASSET_FILE_NAME,
  CLAUDE_CODE_STATUSLINE_ASSET_REF,
} from "../../../src/hosts/claude-code/claude-code-statusline-asset.js";
import {
  CLAUDE_CODE_LOCAL_SETTINGS_REF,
  CLAUDE_CODE_STATUSLINE_SETTINGS_KEY,
  claudeCodeStatuslineEntryIsWakeflows,
  claudeCodeStatuslineSettingsEntry,
} from "../../../src/hosts/claude-code/claude-code-statusline-settings-operation.js";
import {
  CLAUDE_CODE_TMUX_ASSET_DIGEST,
  CLAUDE_CODE_TMUX_ASSET_FILE_NAME,
  CLAUDE_CODE_TMUX_ASSET_REF,
} from "../../../src/hosts/claude-code/claude-code-tmux-asset.js";
import { claudeCodeWindowHostIdentityProfile } from "../../../src/hosts/claude-code/claude-code-window-host-identity-profile.js";
import {
  claudeCodeWorkspaceHostResourceProfile,
  claudeCodeWorkspaceHostTransportTable,
} from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { codexWindowHostIdentityProfile } from "../../../src/hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { createMinimalWakeflowFreshConfigSelection } from "../../configuration/wakeflow-fresh-config-selection.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import { runGit } from "../../support/git-fixture.js";
import { disposableRoot } from "../../support/temp-root.js";

useDisposableDurability();

/**
 * 2 级（能力）：公共维护请求按窗口传输选 profile（ADR-0025 D1、D6）。在一次性 Git 工作区上经 Claude 组合根以
 * `hosts.claude-code.windowTransport: "desktop"` 的选择 fresh-initialize：发布桌面助手而不是状态栏与 tmux 助手，
 * 工作区根放行桌面助手；reconcile 按当前配置选出同一传输、零步；reconfigure 改传输在 K2 起就绪并按新传输
 * 计划（切换的完整效果见 maintain-workspace-transport-switch.test.ts）；status 的 hostAssets 与 verify 的
 * host-settings-assets、local-layout 门按同一份桌面期望读，没有状态栏条目也通过。
 */

/** 与 Claude Code 组合根一致的观察 facade：本宿主按传输给 profile 表与资产期望表，对端 Codex 没有资产面。 */
const CLAUDE_OBSERVATION_FACADE: Readonly<ObservationHostFacade> = Object.freeze({
  hostId: "claude-code" as const,
  hosts: Object.freeze([
    Object.freeze({
      hostId: "claude-code" as const,
      resourceProfile: claudeCodeWorkspaceHostResourceProfile,
      transports: claudeCodeWorkspaceHostTransportTable,
      identityProfile: claudeCodeWindowHostIdentityProfile,
      transportAssets: Object.freeze({
        tmux: Object.freeze({
          statusline: Object.freeze({
            fileName: CLAUDE_CODE_STATUSLINE_ASSET_FILE_NAME,
            digest: CLAUDE_CODE_STATUSLINE_ASSET_DIGEST,
            settings: Object.freeze({
              path: CLAUDE_CODE_LOCAL_SETTINGS_REF,
              key: CLAUDE_CODE_STATUSLINE_SETTINGS_KEY,
              expectedEntry: claudeCodeStatuslineSettingsEntry,
              ownsEntry: claudeCodeStatuslineEntryIsWakeflows,
            }),
          }),
          companions: Object.freeze([
            Object.freeze({
              fileName: CLAUDE_CODE_TMUX_ASSET_FILE_NAME,
              digest: CLAUDE_CODE_TMUX_ASSET_DIGEST,
            }),
          ]),
        }),
        desktop: Object.freeze({
          statusline: null,
          companions: Object.freeze([
            Object.freeze({
              fileName: CLAUDE_CODE_DESKTOP_ASSET_FILE_NAME,
              digest: CLAUDE_CODE_DESKTOP_ASSET_DIGEST,
            }),
          ]),
        }),
      }),
    }),
    Object.freeze({
      hostId: "codex" as const,
      resourceProfile: codexWorkspaceHostResourceProfile,
      identityProfile: codexWindowHostIdentityProfile,
      statuslineAsset: null,
    }),
  ]),
});

function desktopSelection() {
  const value = createMinimalWakeflowFreshConfigSelection();
  (value.storage as Record<string, unknown>).ledgerRoot = "Ledger";
  (value.hosts as Record<string, unknown>)["claude-code"] = { windowTransport: "desktop" };
  return value;
}

function allowOf(root: string): readonly string[] {
  return (
    JSON.parse(readFileSync(path.join(root, ".claude", "settings.json"), "utf8")) as {
      permissions: { allow: string[] };
    }
  ).permissions.allow;
}

function operationKindsOf(plan: unknown): readonly string[] {
  const contribution = (
    plan as { hostContribution: { operations: readonly { operationKind: string }[] } | null }
  ).hostContribution;
  return (contribution?.operations ?? []).map((entry) => entry.operationKind).sort();
}

test("desktop transport through the public maintenance request: fresh publishes the desktop helper set, reconcile re-selects the same transport as a no-op, a transport-switching reconfigure previews the tmux set, and status/verify read the desktop expectation", async (t) => {
  const root = disposableRoot(t, "wakeflow-maintain-transport-");
  runGit(root, "init", "--quiet");
  const fresh = {
    root,
    action: "fresh-initialize",
    request: { selection: desktopSelection() },
  } as const;

  const preview = await executeClaudeCodeWakeflowMaintenance({ ...fresh, mode: "preview" });
  equal(preview.mode, "preview");
  equal(preview.status, "ready");
  deepEqual([...preview.blockerCodes], []);
  // 宿主贡献是桌面传输的集合：桌面助手加三条便携设置，没有状态栏资产、tmux 助手与本地设置条目（ADR-0025 D6）。
  deepEqual(operationKindsOf(preview.plan), [
    "desktop-asset",
    "portable-settings",
    "portable-settings",
    "portable-settings",
  ]);
  equal(preview.launchIntents.length, 4);
  const applied = await executeClaudeCodeWakeflowMaintenance({
    ...fresh,
    mode: "apply",
    planDigest: preview.planDigest as string,
  });
  equal(applied.status, "completed");
  const desktopAsset = path.join(root, ...CLAUDE_CODE_DESKTOP_ASSET_REF.split("/"));
  equal(statSync(desktopAsset).mode & 0o777, 0o600);
  equal(computeSha256Digest(readFileSync(desktopAsset)), CLAUDE_CODE_DESKTOP_ASSET_DIGEST);
  for (const ref of [
    CLAUDE_CODE_STATUSLINE_ASSET_REF,
    CLAUDE_CODE_TMUX_ASSET_REF,
    CLAUDE_CODE_LOCAL_SETTINGS_REF,
  ]) {
    equal(existsSync(path.join(root, ...ref.split("/"))), false, ref);
  }
  deepEqual(allowOf(root), [
    WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE,
    WAKEFLOW_CLAUDE_CODE_DESKTOP_PERMISSION_RULE,
  ]);
  const config = JSON.parse(readFileSync(path.join(root, "wakeflow.config.json"), "utf8")) as {
    hosts: Record<string, unknown>;
  };
  deepEqual(config.hosts["claude-code"], { windowTransport: "desktop" });

  // reconcile 按当前配置选出同一传输：零步、no-op，不会按缺省的 tmux 再发布状态栏与 tmux 助手。
  const reconcile = await executeClaudeCodeWakeflowMaintenance({
    root,
    action: "reconcile",
    mode: "preview",
    request: {},
  });
  equal(reconcile.status, "ready");
  deepEqual([...reconcile.blockerCodes], []);
  const reconciled = await executeClaudeCodeWakeflowMaintenance({
    root,
    action: "reconcile",
    mode: "apply",
    request: {},
    planDigest: reconcile.planDigest as string,
  });
  equal(reconciled.status, "no-op");
  for (const ref of [CLAUDE_CODE_STATUSLINE_ASSET_REF, CLAUDE_CODE_TMUX_ASSET_REF]) {
    equal(existsSync(path.join(root, ...ref.split("/"))), false, ref);
  }

  // K2 起 reconfigure 可以换传输（裁定 4）：期望配置改回 tmux 时按 tmux 的资产集合计划并带四条启动意图（只预览，
  // 下面的 status 与 verify 仍读桌面期望）；不改传输的 reconfigure 没有启动意图。
  const switching = await executeClaudeCodeWakeflowMaintenance({
    root,
    action: "reconfigure",
    mode: "preview",
    request: {
      desiredConfig: {
        ...config,
        hosts: { ...config.hosts, "claude-code": { windowTransport: "tmux" } },
      },
    },
  });
  if (switching.mode !== "preview") throw new Error("Expected a preview result.");
  equal(switching.status, "ready", JSON.stringify(switching.blockerCodes));
  const switchingKinds = operationKindsOf(switching.plan);
  for (const kind of ["tmux-asset", "statusline-asset", "statusline-settings"]) {
    ok(switchingKinds.includes(kind), kind);
  }
  equal(switchingKinds.includes("desktop-asset"), false);
  equal(switching.launchIntents.length, 4);
  const same = await executeClaudeCodeWakeflowMaintenance({
    root,
    action: "reconfigure",
    mode: "preview",
    request: { desiredConfig: config },
  });
  if (same.mode !== "preview") throw new Error("Expected a preview result.");
  equal(same.launchIntents.length, 0);

  // status 与 verify 按桌面期望读资产：助手 current、设置条目不适用，门通过且不点名；本地布局按桌面 profile 对账。
  const status = await executeStatusRequest(CLAUDE_OBSERVATION_FACADE, { root });
  deepEqual(
    status.hostAssets.map((asset) => ({ ...asset })),
    [
      { hostId: "claude-code", status: "current", settings: "not-applicable", companion: null },
      { hostId: "codex", status: "not-applicable", settings: "not-applicable", companion: null },
    ],
  );
  const verified = await executeVerifyRequest(CLAUDE_OBSERVATION_FACADE, { root });
  const gateOf = (name: string) => verified.gates.find((gate) => gate.name === name);
  equal(gateOf("host-settings-assets")?.status, "pass");
  equal(gateOf("host-settings-assets")?.code, null);
  equal(gateOf("local-layout")?.status, "pass", JSON.stringify(gateOf("local-layout")));
});
