import { deepEqual, equal, match, ok } from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type TestContext, test } from "node:test";

import {
  executeWindowBindingRequest,
  type WindowBindingHostFacade,
} from "../../../src/capabilities/endpoint/service.js";
import {
  executeStatusRequest,
  executeVerifyRequest,
  type ObservationHostFacade,
} from "../../../src/capabilities/observation/service.js";
import { parseWakeflowConfig } from "../../../src/configuration/wakeflow-config.js";
import { renderWakeflowConfig } from "../../../src/configuration/wakeflow-config-document.js";
import { createWakeflowDurableId } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { executeClaudeCodeWakeflowMaintenance } from "../../../src/entrypoints/claude-code-wakeflow-maintenance.js";
import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import type { JsonValue } from "../../../src/foundation/data/json-value.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
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
  WAKEFLOW_CLAUDE_CODE_TMUX_PERMISSION_RULE,
} from "../../../src/hosts/claude-code/claude-code-tmux-asset.js";
import { claudeCodeWindowHostIdentityProfile } from "../../../src/hosts/claude-code/claude-code-window-host-identity-profile.js";
import { renderClaudeCodeWindowLaunchInstructions } from "../../../src/hosts/claude-code/claude-code-window-launch-instructions.js";
import {
  claudeCodeWorkspaceHostResourceProfile,
  claudeCodeWorkspaceHostTransportTable,
} from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { codexWindowHostIdentityProfile } from "../../../src/hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { writeHostHookObservation } from "../../../src/kernel/hook-observations.js";
import { createMinimalWakeflowFreshConfigSelection } from "../../configuration/wakeflow-fresh-config-selection.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";
import { runGit } from "../../support/git-fixture.js";
import { disposableRoot } from "../../support/temp-root.js";

useDisposableDurability();

/**
 * 2 级（能力）：reconfigure 切换窗口传输（ADR-0025 K2，桌面适配方案第 11 节裁定 4）。一次性 Git 工作区经 Claude
 * 组合根以缺省的 tmux 传输 fresh-initialize，Controller 窗口带 tmux 坐标登记；把期望配置的
 * `hosts.claude-code.windowTransport` 改成 `desktop` 后 preview 就绪：宿主贡献退役这个窗口的登记（绑定、定位器、
 * 投影改回 unregistered），发布桌面助手、换掉工作区根的助手规则、删掉程序根与支撑面里 Wakeflow 的状态行条目，
 * 结果带新传输的四条启动意图。apply 之后 status 把每个窗口报成 unregistered、宿主资产按桌面期望 current，
 * 之后的 reconcile 零步。活动 Demand 与未关闭的 worktree pod 以 `transport-change-*` 阻塞，与退出路径同形。
 */

const CLAUDE_TMUX: WindowBindingHostFacade = {
  hostId: "claude-code",
  resourceProfile: claudeCodeWorkspaceHostResourceProfile,
  identityProfile: claudeCodeWindowHostIdentityProfile,
  renderLaunchInstructions: renderClaudeCodeWindowLaunchInstructions,
};

/** 与 Claude Code 组合根一致的观察 facade：本宿主按传输给 profile 表与资产期望表。 */
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

const SESSION_ID = "5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a";

interface LaunchIntent {
  readonly windowId: string;
  readonly intentDigest: string;
  readonly role: string;
}

interface ConfigDocument {
  readonly hosts: Record<string, unknown>;
  readonly pods: Record<string, unknown>[];
  readonly topology: { readonly windows: Record<string, unknown>[] };
}

/** 缺省 tmux 传输的 Claude 工作区（选择里没有 `hosts.claude-code`）。 */
async function tmuxWorkspace(t: TestContext): Promise<{
  readonly root: string;
  readonly intents: readonly LaunchIntent[];
}> {
  const root = disposableRoot(t, "wakeflow-transport-switch-");
  runGit(root, "init", "--quiet");
  const selection = createMinimalWakeflowFreshConfigSelection();
  (selection.storage as Record<string, unknown>).ledgerRoot = "Ledger";
  const fresh = { root, action: "fresh-initialize", request: { selection } } as const;
  const preview = await executeClaudeCodeWakeflowMaintenance({ ...fresh, mode: "preview" });
  if (preview.mode !== "preview" || preview.planDigest === null) {
    throw new Error("Expected a ready Fresh plan.");
  }
  await executeClaudeCodeWakeflowMaintenance({
    ...fresh,
    mode: "apply",
    planDigest: preview.planDigest,
  });
  return { root, intents: preview.launchIntents as unknown as readonly LaunchIntent[] };
}

function configOf(root: string): ConfigDocument {
  return JSON.parse(
    readFileSync(path.join(root, "wakeflow.config.json"), "utf8"),
  ) as ConfigDocument;
}

function desktopConfig(config: ConfigDocument) {
  return { ...config, hosts: { ...config.hosts, "claude-code": { windowTransport: "desktop" } } };
}

function file(root: string, ...segments: string[]): string {
  return path.join(root, ...segments.flatMap((segment) => segment.split("/")));
}

function operationKindsOf(plan: unknown): readonly string[] {
  const contribution = (
    plan as { hostContribution: { operations: readonly { operationKind: string }[] } | null }
  ).hostContribution;
  return (contribution?.operations ?? []).map((entry) => entry.operationKind).sort();
}

function statuslineOf(settingsFile: string): JsonValue | undefined {
  return (JSON.parse(readFileSync(settingsFile, "utf8")) as Record<string, JsonValue>)[
    CLAUDE_CODE_STATUSLINE_SETTINGS_KEY
  ];
}

test("reconfigure switches a registered tmux workspace to desktop sessions: the window's tmux registration is retired, the desktop helper set replaces the tmux one, every window reports unregistered and reconcile is then a no-op", async (t) => {
  const { root, intents } = await tmuxWorkspace(t);
  const controller = intents.find((intent) => intent.role === "controller");
  if (controller === undefined) throw new Error("Expected a Controller launch intent.");
  const rooted = await RootedDirectory.open(root);
  t.after(() => rooted.close());
  await writeHostHookObservation(rooted, {
    hostId: "claude-code",
    event: "session-start",
    sessionId: SESSION_ID,
    cwd: root,
    recordedAt: parseUtcInstant("2026-11-01T09:58:00.000Z"),
  });
  const registered = await executeWindowBindingRequest(
    CLAUDE_TMUX,
    {
      root,
      operation: "register",
      windowId: controller.windowId,
      observation: {
        handle: { kind: "claude-session", value: SESSION_ID },
        launchIntentDigest: controller.intentDigest,
        observedAt: "2026-11-01T09:59:00.000Z",
        tmux: { socketName: null, sessionName: "wakeflow", windowId: "@1", paneId: "%1" },
      },
    },
    { clock: () => parseUtcInstant("2026-11-01T10:00:00.000Z") },
  );
  equal(registered.kind, "WakeflowWindowBindingMutation");
  const runtime = ".wakeflow-local/runtime/hosts/claude-code";
  const bindingFile = file(
    root,
    runtime,
    "identity/window-bindings",
    `${controller.windowId}.json`,
  );
  const locatorFile = file(
    root,
    runtime,
    "identity/window-locators",
    `${controller.windowId}.json`,
  );
  const projectionFile = file(
    root,
    runtime,
    "projections/window-runtime",
    `${controller.windowId}.json`,
  );
  ok(existsSync(bindingFile) && existsSync(locatorFile));
  match(readFileSync(projectionFile, "utf8"), /"status": "registered"/u);
  const localSettings = file(root, CLAUDE_CODE_LOCAL_SETTINGS_REF);
  equal(claudeCodeStatuslineEntryIsWakeflows(statuslineOf(localSettings) ?? null), true);

  const switching = {
    root,
    action: "reconfigure",
    request: { desiredConfig: desktopConfig(configOf(root)) },
  } as const;
  const preview = await executeClaudeCodeWakeflowMaintenance({ ...switching, mode: "preview" });
  if (preview.mode !== "preview") throw new Error("Expected a preview result.");
  equal(preview.status, "ready", JSON.stringify(preview.blockerCodes));
  const kinds = operationKindsOf(preview.plan);
  // 新传输的资产集合加旧登记的退役：一个已登记窗口一条退役，状态行条目程序根与两个支撑面各删一条，
  // 工作区根的助手规则改写；不再有 tmux 助手、状态栏资产与状态行安装。
  equal(kinds.filter((kind) => kind === "window-transport-retirement").length, 1);
  equal(kinds.filter((kind) => kind === "remove-statusline-entry").length, 3);
  ok(kinds.includes("desktop-asset") && kinds.includes("portable-settings"));
  for (const absent of ["tmux-asset", "statusline-asset", "statusline-settings"]) {
    equal(kinds.includes(absent), false, absent);
  }
  equal(preview.launchIntents.length, 4);

  const applied = await executeClaudeCodeWakeflowMaintenance({
    ...switching,
    mode: "apply",
    planDigest: preview.planDigest as string,
  });
  if (applied.mode !== "apply") throw new Error("Expected an apply result.");
  equal(applied.status, "completed");
  equal(applied.launchIntents.length, 4);
  equal(applied.next.frontier, "window-launch");
  equal(applied.next.suggestedTool, "wakeflow_register_window_binding");

  // 旧传输的登记退役：绑定与定位器不在，投影改回 unregistered；配置里是新传输。
  equal(existsSync(bindingFile), false);
  equal(existsSync(locatorFile), false);
  match(readFileSync(projectionFile, "utf8"), /"status": "unregistered"/u);
  deepEqual(configOf(root).hosts["claude-code"], { windowTransport: "desktop" });
  // 资产集合：桌面助手在且字节正确，工作区根只放行桌面助手，程序根与支撑面都没有 Wakeflow 的状态行条目。
  equal(
    computeSha256Digest(readFileSync(file(root, CLAUDE_CODE_DESKTOP_ASSET_REF))),
    CLAUDE_CODE_DESKTOP_ASSET_DIGEST,
  );
  const allow = (
    JSON.parse(readFileSync(file(root, ".claude/settings.json"), "utf8")) as {
      permissions: { allow: string[] };
    }
  ).permissions.allow;
  deepEqual(allow, [
    WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE,
    WAKEFLOW_CLAUDE_CODE_DESKTOP_PERMISSION_RULE,
  ]);
  equal(allow.includes(WAKEFLOW_CLAUDE_CODE_TMUX_PERMISSION_RULE), false);
  for (const settingsRoot of [".", "Design", "Test"]) {
    const settingsFile = file(root, settingsRoot, CLAUDE_CODE_LOCAL_SETTINGS_REF);
    if (!existsSync(settingsFile)) continue;
    equal(statuslineOf(settingsFile), undefined, settingsRoot);
  }

  // status：每个窗口未登记（由 Controller 按新助手开窗），宿主资产按桌面期望 current。
  const status = await executeStatusRequest(CLAUDE_OBSERVATION_FACADE, { root });
  deepEqual(
    status.windows.map((window) => window.identity),
    ["unregistered", "unregistered", "unregistered", "unregistered"],
  );
  deepEqual(
    status.hostAssets.map((asset) => ({ ...asset })),
    [
      { hostId: "claude-code", status: "current", settings: "not-applicable", companion: null },
      { hostId: "codex", status: "not-applicable", settings: "not-applicable", companion: null },
    ],
  );

  // verify 按桌面期望读资产与本地布局：tmux 时期留在 `.wakeflow-local` 的助手与状态栏资产不算漂移。
  const verified = await executeVerifyRequest(CLAUDE_OBSERVATION_FACADE, { root });
  const gateOf = (name: string) => verified.gates.find((gate) => gate.name === name);
  equal(
    gateOf("host-settings-assets")?.status,
    "pass",
    JSON.stringify(gateOf("host-settings-assets")),
  );
  equal(gateOf("local-layout")?.status, "pass", JSON.stringify(gateOf("local-layout")));
  equal(
    gateOf("window-runtime-projection")?.status,
    "pass",
    JSON.stringify(gateOf("window-runtime-projection")),
  );

  // 收敛：同一传输上的 reconcile 零步。
  const reconcile = await executeClaudeCodeWakeflowMaintenance({
    root,
    action: "reconcile",
    mode: "preview",
    request: {},
  });
  if (reconcile.mode !== "preview") throw new Error("Expected a preview result.");
  equal(reconcile.status, "ready", JSON.stringify(reconcile.blockerCodes));
  const reconciled = await executeClaudeCodeWakeflowMaintenance({
    root,
    action: "reconcile",
    mode: "apply",
    request: {},
    planDigest: reconcile.planDigest as string,
  });
  equal(reconciled.status, "no-op");
});

test("reconfigure cannot switch the window transport while a Demand is active or a worktree pod is open: transport-change-demand-active and transport-change-pod-open, the same shape as detach", async (t) => {
  const { root } = await tmuxWorkspace(t);
  // 一个读不出的活动 Demand 目录按占用对待（与退出路径同一判据：不知道不放行）。
  const demandId = createWakeflowDurableId("demand");
  mkdirSync(file(root, ".wakeflow-active/current", demandId), { mode: 0o700 });
  // 把 primary pod 改成一个 worktree pod，再加一个 primary pod 承接原窗口的副本。
  const config = configOf(root) as unknown as {
    topology: { windows: Record<string, unknown>[] };
    pods: Record<string, unknown>[];
  };
  const feature = config.pods[0];
  const product = config.topology.windows.find((window) => window.role === "product");
  if (feature === undefined || product === undefined) throw new Error("fixture pod is missing");
  const featurePodId = String(feature.podId);
  Object.assign(feature, {
    name: "feature",
    placement: "worktree",
    worktrees: [
      {
        repositoryId: (product.root as { repositoryId: string }).repositoryId,
        windowId: product.windowId,
        suggestedName: "wakeflow-feature",
      },
    ],
  });
  const mainPodId = "pod_f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0";
  const copies = config.topology.windows
    .filter((window) => window.podId === featurePodId)
    .map((window, index) => ({
      ...window,
      windowId: `window_e${index}e${index}e${index}e${index}-e${index}e${index}-4e${index}e-8e${index}e-e${index}e${index}e${index}e${index}e${index}e${index}`,
      podId: mainPodId,
    }));
  config.topology.windows.push(...copies);
  config.pods.unshift({
    ...feature,
    podId: mainPodId,
    name: "main",
    placement: "primary",
    worktrees: [],
  });
  writeFileSync(
    path.join(root, "wakeflow.config.json"),
    renderWakeflowConfig(parseWakeflowConfig(config)),
  );

  const preview = await executeClaudeCodeWakeflowMaintenance({
    root,
    action: "reconfigure",
    mode: "preview",
    request: { desiredConfig: desktopConfig(configOf(root)) },
  });
  if (preview.mode !== "preview") throw new Error("Expected a preview result.");
  equal(preview.status, "blocked");
  deepEqual(
    [...preview.blockerCodes],
    [`transport-change-demand-active:${demandId}`, `transport-change-pod-open:${featurePodId}`],
  );
  equal(preview.planDigest, null);
  // 不换传输的 reconfigure 不看这些占用。
  const same = await executeClaudeCodeWakeflowMaintenance({
    root,
    action: "reconfigure",
    mode: "preview",
    request: { desiredConfig: configOf(root) },
  });
  if (same.mode !== "preview") throw new Error("Expected a preview result.");
  equal(
    same.blockerCodes.some((code) => code.startsWith("transport-change-")),
    false,
  );
});
