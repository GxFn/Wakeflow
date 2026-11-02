import { equal, rejects } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import {
  executeWindowBindingRequest,
  type WindowBindingHostFacade,
} from "../../../src/capabilities/endpoint/service.js";
import { executeClaudeCodeWakeflowMaintenance } from "../../../src/entrypoints/claude-code-wakeflow-maintenance.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { claudeCodeWindowHostIdentityProfile } from "../../../src/hosts/claude-code/claude-code-window-host-identity-profile.js";
import { renderClaudeCodeWindowLaunchInstructions } from "../../../src/hosts/claude-code/claude-code-window-launch-instructions.js";
import { claudeCodeDesktopWorkspaceHostResourceProfile } from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { WakeflowError } from "../../../src/kernel/error.js";
import { writeHostHookObservation } from "../../../src/kernel/hook-observations.js";
import { createMinimalWakeflowFreshConfigSelection } from "../../configuration/wakeflow-fresh-config-selection.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";

useDisposableDurability();

/**
 * 桌面传输的存活观察（第 2 级，能力；ADR-0025 D3，open-items X17，gate-log §13.223 L18）：`desktop-sessions`
 * 的行取自桌面的 `list_sessions`。界面建的会话（Controller 自己）句柄与桌面 id 不同，按定位器的桌面 id 匹配；
 * 进程已空闲退出、仍在侧栏的会话是在场的，退役因此被挡住；归档之后的行（或清单里没有它）才是缺席，
 * 加上 session-end 记录即机器核实。
 */

const CLAUDE_DESKTOP: WindowBindingHostFacade = {
  hostId: "claude-code",
  resourceProfile: claudeCodeDesktopWorkspaceHostResourceProfile,
  identityProfile: claudeCodeWindowHostIdentityProfile,
  renderLaunchInstructions: renderClaudeCodeWindowLaunchInstructions,
};
const HANDLE = "3d3d3d3d-3d3d-4d3d-8d3d-3d3d3d3d3d3d";
const DESKTOP_UUID = "a803a7ae-e8b8-4399-aa21-6c6536f77744";
const DESKTOP_ID = `local_${DESKTOP_UUID}`;

interface Intent {
  readonly windowId: string;
  readonly root: { readonly configuredPlacement: string };
}

async function fixture(t: TestContext) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-desktop-liveness-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  if (spawnSync("git", ["init", "--quiet"], { cwd: root, shell: false }).status !== 0)
    throw new Error("Cannot initialize fixture Git.");
  const selection = createMinimalWakeflowFreshConfigSelection();
  (selection.storage as Record<string, unknown>).ledgerRoot = "Ledger";
  const request = { root, action: "fresh-initialize", request: { selection } } as const;
  const preview = await executeClaudeCodeWakeflowMaintenance({ ...request, mode: "preview" });
  if (preview.mode !== "preview" || preview.planDigest === null)
    throw new Error("Expected a ready Fresh plan.");
  await executeClaudeCodeWakeflowMaintenance({
    ...request,
    mode: "apply",
    planDigest: preview.planDigest,
  });
  const rooted = await RootedDirectory.open(root);
  t.after(() => rooted.close());
  const intent = (preview.launchIntents as unknown as readonly Intent[])[0];
  if (intent === undefined) throw new Error("Expected a launch intent.");
  return { root, rooted, intent };
}

/** 一行 `list_sessions` 按合同映射（去前缀的 UUID、原样的桌面 id、isRunning → busy、isArchived → archived）。 */
function listRow(isRunning: boolean, isArchived: boolean) {
  return {
    sessionId: DESKTOP_UUID,
    desktopSessionId: DESKTOP_ID,
    status: isRunning ? "busy" : "idle",
    archived: isArchived,
    cwd: null,
    name: "Controller",
  };
}

test("list_sessions 行：界面建的会话按桌面 id 匹配，空闲退出仍在侧栏的会话挡住退役，归档后的行加 session-end 即机器核实", {
  timeout: 60_000,
}, async (t) => {
  const { root, rooted, intent } = await fixture(t);
  const cwd = path.resolve(root, intent.root.configuredPlacement);
  const clock = () => parseUtcInstant("2026-11-01T10:00:00.000Z");
  // 意图摘要按门面选出的桌面 profile 重算：取 inspect 的结果，不取 fresh 预览（按配置的缺省传输）里的。
  const inspected = await executeWindowBindingRequest(
    CLAUDE_DESKTOP,
    { root, operation: "inspect", windowId: intent.windowId },
    { clock },
  );
  if (inspected.kind !== "WakeflowWindowBindingInspection")
    throw new Error("Expected an inspection.");
  await writeHostHookObservation(rooted, {
    hostId: "claude-code",
    event: "session-start",
    sessionId: HANDLE,
    cwd,
    recordedAt: parseUtcInstant("2026-11-01T09:58:00.000Z"),
  });
  const registered = await executeWindowBindingRequest(
    CLAUDE_DESKTOP,
    {
      root,
      operation: "register",
      windowId: intent.windowId,
      observation: {
        handle: { kind: "claude-session", value: HANDLE },
        launchIntentDigest: inspected.launchIntent.intentDigest,
        observedAt: "2026-11-01T09:59:00.000Z",
        desktop: { sessionId: DESKTOP_ID },
      },
    },
    { clock },
  );
  if (registered.kind !== "WakeflowWindowBindingMutation" || registered.binding === null)
    throw new Error("Expected a mutation.");
  const decommission = (postClose: unknown) =>
    executeWindowBindingRequest(
      CLAUDE_DESKTOP,
      {
        root,
        operation: "decommission",
        windowId: intent.windowId,
        expectedBindingId: registered.binding?.bindingId,
        expectedBindingDigest: registered.binding?.bindingDigest,
        closure: {
          preClose: { kind: "desktop-sessions", sessions: [listRow(false, false)] },
          closeResult: { status: "closed" },
          postClose,
        },
      },
      { clock },
    );
  await rejects(
    decommission({ kind: "desktop-sessions", sessions: [listRow(false, false)] }),
    (error: unknown) =>
      error instanceof WakeflowError &&
      `${error.code}/${error.reason}` === "precondition-failed/closure-blocked",
    "a session whose process ended but is still in the sidebar is present",
  );
  await writeHostHookObservation(rooted, {
    hostId: "claude-code",
    event: "session-end",
    sessionId: HANDLE,
    cwd,
    recordedAt: parseUtcInstant("2026-11-01T10:01:00.000Z"),
  });
  const verified = await decommission({
    kind: "desktop-sessions",
    sessions: [listRow(false, true)],
  });
  if (verified.kind !== "WakeflowWindowBindingMutation") throw new Error("Expected a mutation.");
  equal(verified.disposition, "decommissioned");
  equal(verified.verification, "machine-verified");
});
