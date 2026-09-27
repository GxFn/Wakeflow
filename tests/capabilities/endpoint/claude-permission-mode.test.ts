import { equal } from "node:assert/strict";
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
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { claudeCodeWindowHostIdentityProfile } from "../../../src/hosts/claude-code/claude-code-window-host-identity-profile.js";
import { claudeCodeWorkspaceHostResourceProfile } from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { createMinimalWakeflowFreshConfigSelection } from "../../configuration/wakeflow-fresh-config-selection.fixture.js";

/**
 * Claude Code 启动意图的权限模式（用户裁决 Q4，gate-log §13.134）：配置未声明时按宿主
 * Profile 的缺省 auto 渲染 `--permission-mode auto`；配置显式声明的模式原样进入启动参数。
 * 账本在工作区之外时每个窗口都带 `--add-dir <workspace root>/<账本>`（§13.133 F11）。
 */

const CLAUDE: WindowBindingHostFacade = {
  hostId: "claude-code",
  resourceProfile: claudeCodeWorkspaceHostResourceProfile,
  identityProfile: claudeCodeWindowHostIdentityProfile,
};

/** 一次性工作区经 Fresh 初始化后 inspect 第一个窗口，返回它的启动参数。 */
async function launchArguments(
  t: TestContext,
  hosts: Record<string, unknown>,
  ledgerOutside: boolean,
): Promise<readonly string[]> {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-permission-mode-")));
  const ledgerRoot = ledgerOutside ? `../${path.basename(root)}-ledger` : "Ledger";
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    if (ledgerOutside) rmSync(path.resolve(root, ledgerRoot), { recursive: true, force: true });
  });
  const initialized = spawnSync("git", ["init", "--quiet"], {
    cwd: root,
    encoding: "utf8",
    shell: false,
  });
  if (initialized.status !== 0) throw new Error("Cannot initialize fixture Git.");
  const selection = createMinimalWakeflowFreshConfigSelection();
  (selection.storage as Record<string, unknown>).ledgerRoot = ledgerRoot;
  (selection as Record<string, unknown>).hosts = hosts;
  const preview = await executeClaudeCodeWakeflowMaintenance({
    root,
    action: "fresh-initialize",
    mode: "preview",
    request: { selection },
  });
  if (preview.mode !== "preview" || preview.planDigest === null)
    throw new Error("Expected a ready Fresh plan.");
  await executeClaudeCodeWakeflowMaintenance({
    root,
    action: "fresh-initialize",
    mode: "apply",
    request: { selection },
    planDigest: preview.planDigest,
  });
  const intent = (preview.launchIntents as unknown as readonly { windowId: string }[])[0];
  if (intent === undefined) throw new Error("Expected a launch intent.");
  const inspected = await executeWindowBindingRequest(
    CLAUDE,
    { root, operation: "inspect", windowId: intent.windowId },
    { clock: () => parseUtcInstant("2026-09-26T10:00:00.000Z") },
  );
  if (inspected.kind !== "WakeflowWindowBindingInspection")
    throw new Error("Expected an inspection.");
  const execution = inspected.launchIntent.execution as {
    readonly kind: string;
    readonly arguments: readonly string[];
  };
  equal(execution.kind, "claude-code");
  return execution.arguments;
}

function permissionMode(arguments_: readonly string[]): string | undefined {
  const flag = arguments_.indexOf("--permission-mode");
  equal(flag >= 0, true);
  equal(arguments_.filter((entry) => entry === "--permission-mode").length, 1);
  return arguments_[flag + 1];
}

/** `--add-dir` 后面跟着的目录，按出现顺序。 */
function addedDirectories(arguments_: readonly string[]): readonly string[] {
  return arguments_.flatMap((entry, index) =>
    entry === "--add-dir" ? [arguments_[index + 1] ?? ""] : [],
  );
}

test("Claude Code：配置未声明 permissionMode 时启动参数取宿主缺省 --permission-mode auto", {
  timeout: 60_000,
}, async (t) => {
  const arguments_ = await launchArguments(t, {}, true);
  equal(permissionMode(arguments_), "auto");
  // 账本在工作区之外：窗口按占位符带上账本目录，由助手换成绝对路径。
  const ledger = addedDirectories(arguments_).filter((entry) => entry.endsWith("-ledger"));
  equal(ledger.length, 1);
  equal(ledger[0]?.startsWith("<workspace root>/../wakeflow-permission-mode-"), true, ledger[0]);
});

test("Claude Code：配置显式声明的 acceptEdits 原样进入启动参数，不被缺省 auto 覆盖", {
  timeout: 60_000,
}, async (t) => {
  const arguments_ = await launchArguments(
    t,
    { "claude-code": { launch: { permissionMode: "acceptEdits" } } },
    false,
  );
  equal(permissionMode(arguments_), "acceptEdits");
  // 账本在工作区之内：工作区根已经覆盖它，不再单独加。
  equal(
    addedDirectories(arguments_).some((entry) => entry.includes("Ledger")),
    false,
  );
});
