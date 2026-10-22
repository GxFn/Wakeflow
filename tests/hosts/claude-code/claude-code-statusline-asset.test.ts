import { deepEqual, equal, ok, rejects } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";
import { parseWakeflowConfig } from "../../../src/configuration/wakeflow-config.js";
import { renderWakeflowConfig } from "../../../src/configuration/wakeflow-config-document.js";
import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { parseJsonValue } from "../../../src/foundation/data/json-value.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  CLAUDE_CODE_STATUSLINE_ASSET_CONTENT,
  CLAUDE_CODE_STATUSLINE_ASSET_DIGEST,
  CLAUDE_CODE_STATUSLINE_ASSET_REF,
  CLAUDE_CODE_STATUSLINE_MARKER,
  CLAUDE_CODE_STATUSLINE_ROOT_ARGUMENT,
  claudeCodeStatuslineCommand,
} from "../../../src/hosts/claude-code/claude-code-statusline-asset.js";
import {
  CLAUDE_CODE_STATUSLINE_ASSET_OPERATION_ID,
  executeClaudeCodeStatuslineAssetOperation,
  planClaudeCodeStatuslineAssetOperation,
} from "../../../src/hosts/claude-code/claude-code-statusline-asset-operation.js";
import {
  CLAUDE_CODE_LOCAL_SETTINGS_REF,
  CLAUDE_CODE_STATUSLINE_SETTINGS_OPERATION_ID,
  ClaudeCodeStatuslineSettingsOperationError,
  claudeCodeStatuslineEntryIsWakeflows,
  claudeCodeStatuslineSettingsSurfaceBlocker,
  claudeCodeStatuslineSettingsSurfaceOperationId,
  executeClaudeCodeStatuslineSettingsOperation,
  planClaudeCodeStatuslineSettingsOperation,
  planClaudeCodeStatuslineSettingsSurfaceOperations,
} from "../../../src/hosts/claude-code/claude-code-statusline-settings-operation.js";
import { claudeCodeWorkspaceHostResourceProfile } from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { wakeflowWindowHostBindingRootRef } from "../../../src/workspace/window-runtime/wakeflow-window-runtime-paths.js";
import { createMinimalWakeflowConfig } from "../../configuration/wakeflow-config.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";

useDisposableDurability();

/**
 * Claude 状态栏资产（能力卡 9 Q6，gate-log §13.94 D6）：资产由仓库测试用 node 直接执行，
 * 而不是由 Wakeflow spawn node 做 smoke。argv 取自 `claudeCodeStatuslineCommand` 的渲染结果，
 * stdin 是 Claude Code 交给状态栏的 JSON；断言恰好一行、stderr 为空、不泄露根与会话句柄。
 * 两个维护操作：资产字节与模式（0600），以及 `settings.local.json` 的 statusLine 条目（只改这一键，
 * 0600，命令带 base64url 的根所以只能进忽略的私有本地文件）。
 */

const PROGRAM_ID = "program_11111111-1111-4111-8111-111111111111";
const REPOSITORY_ID = "repository_22222222-2222-4222-8222-222222222222";
const MAIN_CONTROLLER_WINDOW_ID = "window_55555555-5555-4555-8555-555555555555";
const FEATURE_POD_ID = "pod_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FEATURE_PRODUCT_WINDOW_ID = "window_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FEATURE_WINDOW_IDS: Readonly<Record<string, string>> = Object.freeze({
  controller: "window_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  design: "window_dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  test: "window_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  product: FEATURE_PRODUCT_WINDOW_ID,
});
const MAIN_SESSION_ID = "claude-session-main-0123456789abcdef";
const FEATURE_SESSION_ID = "claude-session-feature-fedcba9876543210";
const UNKNOWN_SESSION_ID = "claude-session-unknown-0000000000000000";
const MODEL_NAME = "Opus 4.1";
/** 绑定目录从内核布局派生：资产脚本里的字面量必须与之一致，布局移动时本测试报错。 */
const BINDINGS_DIRECTORY_REF = wakeflowWindowHostBindingRootRef(
  claudeCodeWorkspaceHostResourceProfile,
);
const BINDINGS_DIRECTORY = BINDINGS_DIRECTORY_REF.split("/");
const COMMAND_PATTERN = /^node -- '((?:[^']|'\\'')*)' (\S+) (\S+) ([A-Za-z0-9_-]+)$/u;

interface DecodedCommand {
  readonly asset: string;
  readonly marker: string;
  readonly rootArgument: string;
  readonly encodedRoot: string;
}

/** 把 `claude-statusline-settings:install` 写进 settings 的命令行还原成 Claude Code 交给 node 的 argv。 */
function decodeCommand(command: string): DecodedCommand {
  const match = COMMAND_PATTERN.exec(command);
  const [, quotedAsset, marker, rootArgument, encodedRoot] = match ?? [];
  if (
    quotedAsset === undefined ||
    marker === undefined ||
    rootArgument === undefined ||
    encodedRoot === undefined
  ) {
    throw new Error("statusline command is not shaped as node -- <asset> <marker> <root>");
  }
  return Object.freeze({
    asset: quotedAsset.replace(/'\\''/gu, "'"),
    marker,
    rootArgument,
    encodedRoot,
  });
}

function nodeArgv(decoded: DecodedCommand): readonly string[] {
  return ["--", decoded.asset, decoded.marker, decoded.rootArgument, decoded.encodedRoot];
}

function base64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

/** 主 pod 之外再加一个 worktree pod：四个窗口与一条 worktree 意图，名字用于状态栏标签。 */
function configWithFeaturePod(): Record<string, unknown> {
  const value = createMinimalWakeflowConfig();
  const topology = value.topology as { windows: Record<string, unknown>[] };
  const featureWindows = topology.windows.map((window) => ({
    ...window,
    windowId: FEATURE_WINDOW_IDS[window.role as string],
    podId: FEATURE_POD_ID,
  }));
  topology.windows = [...topology.windows, ...featureWindows];
  (value.pods as unknown[]).push({
    podId: FEATURE_POD_ID,
    name: "feature-x",
    placement: "worktree",
    lifecycle: "open",
    worktrees: [
      {
        repositoryId: REPOSITORY_ID,
        windowId: FEATURE_PRODUCT_WINDOW_ID,
        suggestedName: "wakeflow-feature-x",
      },
    ],
    closing: null,
  });
  return value;
}

function temporaryDirectory(t: TestContext, prefix: string): string {
  const directory = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => {
    rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

/** 一个只有配置、资产与绑定记录的工作区：状态栏脚本只读这三样。 */
function createWorkspace(t: TestContext, config: Record<string, unknown> | null): string {
  const workspace = temporaryDirectory(t, "wakeflow-claude-statusline-");
  if (config !== null) {
    writeFileSync(path.join(workspace, "wakeflow.config.json"), renderWakeflowConfig(config), {
      mode: 0o644,
    });
  }
  const assetPath = path.join(workspace, ...CLAUDE_CODE_STATUSLINE_ASSET_REF.split("/"));
  mkdirSync(path.dirname(assetPath), { recursive: true, mode: 0o700 });
  writeFileSync(assetPath, CLAUDE_CODE_STATUSLINE_ASSET_CONTENT, { mode: 0o600 });
  return workspace;
}

function writeBinding(
  workspace: string,
  windowId: string,
  sessionId: string,
  bindingUuid: string,
): void {
  const directory = path.join(workspace, ...BINDINGS_DIRECTORY);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const record = {
    kind: "WakeflowWindowHostBinding",
    schemaVersion: 1,
    programId: PROGRAM_ID,
    hostId: "claude-code",
    windowId,
    bindingId: `window_binding_${bindingUuid}`,
    handle: { kind: "claude-session", value: sessionId },
    source: {
      kind: "agent-host-create-result",
      launchIntentDigest: `sha256:${"1".repeat(64)}`,
      observedAt: "2026-09-18T08:00:00.000Z",
    },
    registeredAt: "2026-09-18T08:00:01.000Z",
  };
  writeFileSync(path.join(directory, `${windowId}.json`), `${JSON.stringify(record, null, 2)}\n`, {
    mode: 0o600,
  });
}

function statuslineInput(sessionId: string, model: string = MODEL_NAME): string {
  return JSON.stringify({ session_id: sessionId, model: { display_name: model } });
}

interface AssetRun {
  readonly stdout: string;
  readonly stderr: string;
  readonly status: number | null;
}

/** 与 Claude Code 一样：node 进程、stdin 一段 JSON、cwd 不是工作区（根只来自 argv）。 */
function runAsset(argv: readonly string[], input: string): AssetRun {
  const result = spawnSync(process.execPath, [...argv], {
    input,
    encoding: "utf8",
    cwd: os.tmpdir(),
    shell: false,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  return Object.freeze({ stdout: result.stdout, stderr: result.stderr, status: result.status });
}

/** 恰好一行、以换行结尾、stderr 为空、退出 0，且不含任何私有值。 */
function expectSingleLine(run: AssetRun, expected: string, privateValues: readonly string[]): void {
  equal(run.status, 0, run.stderr);
  equal(run.stderr, "");
  equal(run.stdout, `${expected}\n`);
  equal(run.stdout.indexOf("\n"), run.stdout.length - 1, "exactly one line");
  for (const value of privateValues) {
    equal(run.stdout.includes(value), false, `statusline output leaked ${value}`);
  }
}

test("状态栏资产以 node 执行：main pod 窗口为「模型 · 窗口」，worktree pod 为「模型 · pod · 窗口」，未匹配会话只打印模型", (t) => {
  const workspace = createWorkspace(t, configWithFeaturePod());
  writeBinding(
    workspace,
    MAIN_CONTROLLER_WINDOW_ID,
    MAIN_SESSION_ID,
    "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
  );
  writeBinding(
    workspace,
    FEATURE_PRODUCT_WINDOW_ID,
    FEATURE_SESSION_ID,
    "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2",
  );

  // 命令行的形状本身是合同：资产路径在工作区运行时目录里，根以 base64url 显式传入。
  const decoded = decodeCommand(claudeCodeStatuslineCommand(workspace));
  equal(decoded.asset, path.join(workspace, ...CLAUDE_CODE_STATUSLINE_ASSET_REF.split("/")));
  equal(decoded.marker, CLAUDE_CODE_STATUSLINE_MARKER);
  equal(decoded.rootArgument, CLAUDE_CODE_STATUSLINE_ROOT_ARGUMENT);
  equal(Buffer.from(decoded.encodedRoot, "base64url").toString("utf8"), workspace);
  const argv = nodeArgv(decoded);
  const privateValues = [workspace, MAIN_SESSION_ID, FEATURE_SESSION_ID, UNKNOWN_SESSION_ID];

  expectSingleLine(
    runAsset(argv, statuslineInput(MAIN_SESSION_ID)),
    `${MODEL_NAME} · Controller`,
    privateValues,
  );
  expectSingleLine(
    runAsset(argv, statuslineInput(FEATURE_SESSION_ID)),
    `${MODEL_NAME} · feature-x · Product A`,
    privateValues,
  );
  expectSingleLine(runAsset(argv, statuslineInput(UNKNOWN_SESSION_ID)), MODEL_NAME, privateValues);
  // 没有 session_id 的输入同样只打印模型，不会误配任何绑定。
  expectSingleLine(
    runAsset(argv, JSON.stringify({ model: { display_name: MODEL_NAME } })),
    MODEL_NAME,
    privateValues,
  );
});

test("状态栏资产退化输入：超大 stdin、缺少标记、非绝对或未规范化的根、缺少配置都只打印模型且 stderr 为空", (t) => {
  const workspace = createWorkspace(t, configWithFeaturePod());
  writeBinding(
    workspace,
    MAIN_CONTROLLER_WINDOW_ID,
    MAIN_SESSION_ID,
    "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
  );
  const decoded = decodeCommand(claudeCodeStatuslineCommand(workspace));
  const argv = nodeArgv(decoded);
  const privateValues = [workspace, MAIN_SESSION_ID];

  // 超过 256 KiB 的 stdin 整段丢弃：连模型名都读不到，只剩缺省标签，仍是恰好一行。
  const oversized = JSON.stringify({
    session_id: MAIN_SESSION_ID,
    model: { display_name: MODEL_NAME },
    padding: "x".repeat(256 * 1024),
  });
  expectSingleLine(runAsset(argv, oversized), "Claude", privateValues);

  // 缺少标记：根不被采用，即使 base64url 根仍在 argv 里。
  expectSingleLine(
    runAsset(
      ["--", decoded.asset, decoded.rootArgument, decoded.encodedRoot],
      statuslineInput(MAIN_SESSION_ID),
    ),
    MODEL_NAME,
    privateValues,
  );

  // 非绝对根与未规范化的根（尾随斜杠）都被拒绝；根从不从 cwd 推断。
  for (const root of ["relative/workspace", `${workspace}${path.sep}`]) {
    expectSingleLine(
      runAsset(
        ["--", decoded.asset, decoded.marker, decoded.rootArgument, base64url(root)],
        statuslineInput(MAIN_SESSION_ID),
      ),
      MODEL_NAME,
      privateValues,
    );
  }

  // 根存在但没有 wakeflow.config.json：只打印模型。
  const bare = createWorkspace(t, null);
  writeBinding(
    bare,
    MAIN_CONTROLLER_WINDOW_ID,
    MAIN_SESSION_ID,
    "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
  );
  expectSingleLine(
    runAsset(
      nodeArgv(decodeCommand(claudeCodeStatuslineCommand(bare))),
      statuslineInput(MAIN_SESSION_ID),
    ),
    MODEL_NAME,
    [bare, MAIN_SESSION_ID],
  );
});

test("状态栏资产维护操作：缺失创建 0600、当前零写、字节与模式漂移替换、恢复接受已提交目标", async (t) => {
  const workspace = temporaryDirectory(t, "wakeflow-claude-statusline-operation-");
  // 资产目录 `operations/assets` 由操作自己物化；它上面的运行时目录链由静态布局提供。
  mkdirSync(
    path.join(workspace, ".wakeflow-local", "runtime", "hosts", "claude-code", "operations"),
    {
      recursive: true,
      mode: 0o700,
    },
  );
  const root = await RootedDirectory.open(workspace);
  t.after(async () => {
    await root.close();
  });
  const assetPath = path.join(workspace, ...CLAUDE_CODE_STATUSLINE_ASSET_REF.split("/"));
  const execute = (operation: unknown, recoveringAffectedOperation = false) =>
    executeClaudeCodeStatuslineAssetOperation(root, { operation, recoveringAffectedOperation });

  const planned = await planClaudeCodeStatuslineAssetOperation(root);
  ok(planned !== null, "missing asset must plan one operation");
  equal(planned.operationId, CLAUDE_CODE_STATUSLINE_ASSET_OPERATION_ID);
  equal(planned.operationKind, "statusline-asset");
  equal(planned.sourceDigest, null);
  equal(planned.targetDigest, CLAUDE_CODE_STATUSLINE_ASSET_DIGEST);

  const created = await execute(planned.payload);
  equal(created.disposition, "created");
  equal(created.targetDigest, CLAUDE_CODE_STATUSLINE_ASSET_DIGEST);
  equal(statSync(assetPath).mode & 0o777, 0o600);
  equal(statSync(path.dirname(assetPath)).mode & 0o777, 0o700);
  equal(computeSha256Digest(readFileSync(assetPath)), CLAUDE_CODE_STATUSLINE_ASSET_DIGEST);

  // 已是期望字节与模式：计划为空，重复执行报 current。
  equal(await planClaudeCodeStatuslineAssetOperation(root), null);
  equal((await execute(planned.payload)).disposition, "current");

  // 字节漂移：计划带当前摘要，执行 CAS 替换回期望字节。
  writeFileSync(assetPath, `${CLAUDE_CODE_STATUSLINE_ASSET_CONTENT}// drift\n`, { mode: 0o600 });
  const driftedBytes = await planClaudeCodeStatuslineAssetOperation(root);
  ok(driftedBytes !== null, "byte drift must plan one operation");
  equal(driftedBytes.sourceDigest, computeSha256Digest(readFileSync(assetPath)));
  equal(driftedBytes.targetDigest, CLAUDE_CODE_STATUSLINE_ASSET_DIGEST);
  equal((await execute(driftedBytes.payload)).disposition, "updated");
  equal(computeSha256Digest(readFileSync(assetPath)), CLAUDE_CODE_STATUSLINE_ASSET_DIGEST);
  equal(statSync(assetPath).mode & 0o777, 0o600);

  // 模式漂移：字节相同也不算 current，替换后回到 0600。
  chmodSync(assetPath, 0o644);
  const driftedMode = await planClaudeCodeStatuslineAssetOperation(root);
  ok(driftedMode !== null, "mode drift must plan one operation");
  equal(driftedMode.sourceDigest, CLAUDE_CODE_STATUSLINE_ASSET_DIGEST);
  equal((await execute(driftedMode.payload)).disposition, "updated");
  equal(statSync(assetPath).mode & 0o777, 0o600);

  // affected 恢复：目标已提交即 current，不再写。
  const before = statSync(assetPath);
  equal((await execute(planned.payload, true)).disposition, "current");
  equal(statSync(assetPath).ino, before.ino);
  equal(await planClaudeCodeStatuslineAssetOperation(root), null);
});

/** 支撑面用例的配置：账本放进工作区（兄弟账本会被当成遗留，§13.181），其余取最小配置。 */
function surfacesModel() {
  const value = createMinimalWakeflowConfig();
  (value.storage as Record<string, unknown>).ledgerRoot = "Ledger";
  return parseWakeflowConfig(value);
}

test("资产脚本里的绑定目录字面量等于内核布局派生的绑定根", () => {
  ok(
    CLAUDE_CODE_STATUSLINE_ASSET_CONTENT.includes(
      `const BINDINGS_DIRECTORY = "${BINDINGS_DIRECTORY_REF}";`,
    ),
    "the asset must read the bindings directory the kernel layout declares",
  );
});

test("状态栏设置维护操作：缺文件创建只含 statusLine 的 0600 文件、当前零写、其他键原位保留、漂移替换、来源变化 source-stale、非 JSON 对象 settings-unreadable、恢复接受已提交目标", async (t) => {
  const workspace = temporaryDirectory(t, "wakeflow-claude-statusline-settings-");
  const root = await RootedDirectory.open(workspace);
  t.after(async () => {
    await root.close();
  });
  const settingsPath = path.join(workspace, ...CLAUDE_CODE_LOCAL_SETTINGS_REF.split("/"));
  const expectedEntry = {
    type: "command",
    command: claudeCodeStatuslineCommand(root.absolutePath),
  };
  const execute = (
    operation: Awaited<ReturnType<typeof planClaudeCodeStatuslineSettingsOperation>>,
    recoveringAffectedOperation = false,
  ) => {
    if (operation === null) throw new Error("Expected an operation.");
    return executeClaudeCodeStatuslineSettingsOperation(root, {
      config: surfacesModel(),
      operation: operation.payload,
      sourceDigest: operation.sourceDigest,
      targetDigest: operation.targetDigest,
      recoveringAffectedOperation,
    });
  };

  // 缺文件：计划一条操作（来源 null），执行创建 0600 文件，内容只有 statusLine 一键。
  const planned = await planClaudeCodeStatuslineSettingsOperation(root);
  ok(planned !== null, "missing settings must plan one operation");
  equal(planned.operationId, CLAUDE_CODE_STATUSLINE_SETTINGS_OPERATION_ID);
  equal(planned.operationKind, "statusline-settings");
  equal(planned.sourceDigest, null);
  deepEqual(planned.payload, { path: CLAUDE_CODE_LOCAL_SETTINGS_REF, key: "statusLine" });
  equal((await execute(planned)).disposition, "created");
  equal(statSync(settingsPath).mode & 0o777, 0o600);
  deepEqual(JSON.parse(readFileSync(settingsPath, "utf8")), { statusLine: expectedEntry });
  equal(computeSha256Digest(readFileSync(settingsPath)), planned.targetDigest);
  ok(
    !expectedEntry.command.includes(`${CLAUDE_CODE_STATUSLINE_ROOT_ARGUMENT} ${root.absolutePath}`),
    "the root only travels as base64url",
  );

  // 已是期望：计划为空，重复执行报 current。
  equal(await planClaudeCodeStatuslineSettingsOperation(root), null);
  equal((await execute(planned)).disposition, "current");

  // 用户自己的状态行（复审 T31）：命令里没有 Wakeflow 的标记，维护不碰它，文件原样。
  const foreign = `${JSON.stringify(
    {
      permissions: { allow: ["Bash(ls:*)"] },
      statusLine: { type: "command", command: "echo mine" },
      theme: "dark",
    },
    null,
    2,
  )}\n`;
  writeFileSync(settingsPath, foreign, { mode: 0o644 });
  equal(await planClaudeCodeStatuslineSettingsOperation(root), null);
  equal(readFileSync(settingsPath, "utf8"), foreign);
  equal(
    claudeCodeStatuslineEntryIsWakeflows(
      parseJsonValue({ type: "command", command: "echo mine" }, "$e"),
    ),
    false,
  );
  equal(
    claudeCodeStatuslineEntryIsWakeflows(
      parseJsonValue(
        { type: "command", command: 'node "/elsewhere/.wakeflow-local/wakeflow-statusline.mjs"' },
        "$e",
      ),
    ),
    true,
    "the 0.9.x asset command is Wakeflow's and gets upgraded",
  );
  equal(claudeCodeStatuslineEntryIsWakeflows(parseJsonValue("a string", "$e")), false);

  // 用户的其他键原位保留，Wakeflow 自己的陈旧 statusLine（带标记、根不同）原位替换；键顺序不变。
  writeFileSync(
    settingsPath,
    `${JSON.stringify(
      {
        permissions: { allow: ["Bash(ls:*)"] },
        statusLine: {
          type: "command",
          command: claudeCodeStatuslineCommand("/elsewhere/workspace"),
        },
        theme: "dark",
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  const drifted = await planClaudeCodeStatuslineSettingsOperation(root);
  ok(drifted !== null, "a stale Wakeflow statusLine must plan one operation");
  equal(drifted.sourceDigest, computeSha256Digest(readFileSync(settingsPath)));
  equal((await execute(drifted)).disposition, "updated");
  const rewritten = JSON.parse(readFileSync(settingsPath, "utf8"));
  deepEqual(Object.keys(rewritten), ["permissions", "statusLine", "theme"]);
  deepEqual(rewritten, {
    permissions: { allow: ["Bash(ls:*)"] },
    statusLine: expectedEntry,
    theme: "dark",
  });
  equal(statSync(settingsPath).mode & 0o777, 0o600);

  // 模式漂移：内容相同也计划一条操作，执行后回到 0600。
  chmodSync(settingsPath, 0o644);
  const mode = await planClaudeCodeStatuslineSettingsOperation(root);
  ok(mode !== null, "mode drift must plan one operation");
  equal((await execute(mode)).disposition, "updated");
  equal(statSync(settingsPath).mode & 0o777, 0o600);
  equal(await planClaudeCodeStatuslineSettingsOperation(root), null);

  // 计划后文件被改：来源摘要不等即 source-stale，不写；affected 恢复放开来源核对，但目标字节必须
  // 仍等于计划的目标摘要，文档已变同样 source-stale。
  writeFileSync(settingsPath, `${JSON.stringify({ theme: "light" }, null, 2)}\n`, { mode: 0o600 });
  const replan = await planClaudeCodeStatuslineSettingsOperation(root);
  ok(replan !== null, "a missing key must plan one operation");
  writeFileSync(settingsPath, `${JSON.stringify({ theme: "dark" }, null, 2)}\n`, { mode: 0o600 });
  const isStale = (error: unknown) =>
    error instanceof ClaudeCodeStatuslineSettingsOperationError && error.reason === "source-stale";
  await rejects(execute(replan), isStale);
  await rejects(execute(replan, true), isStale);
  deepEqual(JSON.parse(readFileSync(settingsPath, "utf8")), { theme: "dark" });

  // 恢复时文件已是目标字节：current，不再写（inode 不变）。
  const fresh = await planClaudeCodeStatuslineSettingsOperation(root);
  ok(fresh !== null, "the dark document still lacks the key");
  equal((await execute(fresh)).disposition, "updated");
  const before = statSync(settingsPath);
  equal((await execute(fresh, true)).disposition, "current");
  equal(statSync(settingsPath).ino, before.ino);

  // 不是 JSON 对象：计划不猜，报 settings-unreadable（宿主贡献把它变成 blocker）。
  const isUnreadable = (error: unknown) =>
    error instanceof ClaudeCodeStatuslineSettingsOperationError &&
    error.reason === "settings-unreadable";
  writeFileSync(settingsPath, "[]\n", { mode: 0o600 });
  await rejects(planClaudeCodeStatuslineSettingsOperation(root), isUnreadable);
  writeFileSync(settingsPath, "{ not json\n", { mode: 0o600 });
  await rejects(planClaudeCodeStatuslineSettingsOperation(root), isUnreadable);
});

test("支撑面的状态行设置（复审 M2）：每个 wakeflow-managed 面各一条操作，条目仍由工作区根派生，面根缺失时只有 fresh-initialize 计划创建，执行时对照配置核对", async (t) => {
  const workspace = temporaryDirectory(t, "wakeflow-claude-statusline-surfaces-");
  const root = await RootedDirectory.open(workspace);
  t.after(async () => {
    await root.close();
  });
  const model = surfacesModel();
  const [design, testSurface] = model.topology.supportSurfaces;
  if (design === undefined || testSurface === undefined) {
    throw new Error("The fixture config declares two support surfaces.");
  }
  mkdirSync(path.join(workspace, design.path), { recursive: true });
  const expectedEntry = {
    type: "command",
    command: claudeCodeStatuslineCommand(root.absolutePath),
  };
  const settingsPathOf = (surfacePath: string) =>
    path.join(workspace, surfacePath, ...CLAUDE_CODE_LOCAL_SETTINGS_REF.split("/"));
  const execute = (
    operation: Readonly<{
      readonly payload: unknown;
      readonly sourceDigest: ReturnType<typeof computeSha256Digest> | null;
      readonly targetDigest: ReturnType<typeof computeSha256Digest>;
    }>,
    recoveringAffectedOperation = false,
  ) =>
    executeClaudeCodeStatuslineSettingsOperation(root, {
      config: model,
      operation: operation.payload,
      sourceDigest: operation.sourceDigest,
      targetDigest: operation.targetDigest,
      recoveringAffectedOperation,
    });
  const plan = (action: "fresh-initialize" | "reconcile") =>
    planClaudeCodeStatuslineSettingsSurfaceOperations(root, { action, config: model });

  // fresh-initialize：Design 根在（缺文件）、Test 根不在（维护会先建根）→ 两条创建，按 surfaceId 排序，
  // 标识、目标键与负载各带 surfaceId；来源都是 null。
  const fresh = await plan("fresh-initialize");
  deepEqual(fresh.blockerCodes, []);
  deepEqual(
    fresh.operations.map((operation) => operation.operationId),
    [
      claudeCodeStatuslineSettingsSurfaceOperationId(design.surfaceId),
      claudeCodeStatuslineSettingsSurfaceOperationId(testSurface.surfaceId),
    ],
  );
  deepEqual(
    fresh.operations.map((operation) => operation.targetKey),
    [
      `settings:claude-code:local-statusline:support-surface:${design.surfaceId}`,
      `settings:claude-code:local-statusline:support-surface:${testSurface.surfaceId}`,
    ],
  );
  const [designOperation, testOperation] = fresh.operations;
  ok(designOperation !== undefined && testOperation !== undefined, "two surface operations");
  deepEqual(designOperation.payload, {
    path: CLAUDE_CODE_LOCAL_SETTINGS_REF,
    key: "statusLine",
    surface: { surfaceId: design.surfaceId, configuredPlacement: design.path },
  });
  equal(designOperation.sourceDigest, null);
  equal(testOperation.sourceDigest, null);
  equal(
    designOperation.operationId > CLAUDE_CODE_STATUSLINE_SETTINGS_OPERATION_ID,
    true,
    "surface operations sort after the workspace root's",
  );

  // reconcile：Test 根不在 → 跳过（portable settings 的组合已报 support-root-missing），只剩 Design。
  deepEqual(
    (await plan("reconcile")).operations.map((operation) => operation.operationId),
    [claudeCodeStatuslineSettingsSurfaceOperationId(design.surfaceId)],
  );

  // 执行 Design：建 Design/.claude/settings.local.json（0600），条目里是工作区根，不是面根。
  const designExecuted = await execute(designOperation);
  equal(designExecuted.disposition, "created");
  equal(designExecuted.operationId, designOperation.operationId);
  equal(statSync(settingsPathOf(design.path)).mode & 0o777, 0o600);
  deepEqual(JSON.parse(readFileSync(settingsPathOf(design.path), "utf8")), {
    statusLine: expectedEntry,
  });
  equal((await execute(designOperation)).disposition, "current");

  // Test 根还不在：执行拒 placement；根建好后创建。
  const isReason = (reason: string) => (error: unknown) =>
    error instanceof ClaudeCodeStatuslineSettingsOperationError && error.reason === reason;
  await rejects(execute(testOperation), isReason("placement"));
  mkdirSync(path.join(workspace, testSurface.path), { recursive: true });
  equal((await execute(testOperation)).disposition, "created");
  deepEqual(JSON.parse(readFileSync(settingsPathOf(testSurface.path), "utf8")), {
    statusLine: expectedEntry,
  });
  deepEqual((await plan("reconcile")).operations, [], "both surfaces current: zero writes");

  // Design 里是用户自己的 statusLine：不碰；Test 不是 JSON 对象：带 surfaceId 的 blocker，不抛。
  writeFileSync(
    settingsPathOf(design.path),
    `${JSON.stringify({ statusLine: { type: "command", command: "echo mine" } }, null, 2)}\n`,
    { mode: 0o600 },
  );
  writeFileSync(settingsPathOf(testSurface.path), "[]\n", { mode: 0o600 });
  const mixed = await plan("reconcile");
  deepEqual(mixed.operations, []);
  deepEqual(mixed.blockerCodes, [
    claudeCodeStatuslineSettingsSurfaceBlocker(testSurface.surfaceId),
  ]);

  // 负载对照配置：配置里没有的面、放置不同的面都拒 operation（旧日志或篡改都写不到别处）。
  const forgedPlacement = {
    ...testOperation,
    payload: {
      path: CLAUDE_CODE_LOCAL_SETTINGS_REF,
      key: "statusLine",
      surface: { surfaceId: testSurface.surfaceId, configuredPlacement: "Elsewhere" },
    },
  };
  await rejects(execute(forgedPlacement), isReason("operation"));
  const forgedSurface = {
    ...testOperation,
    payload: {
      path: CLAUDE_CODE_LOCAL_SETTINGS_REF,
      key: "statusLine",
      surface: {
        surfaceId: "surface_99999999-9999-4999-8999-999999999999",
        configuredPlacement: testSurface.path,
      },
    },
  };
  await rejects(execute(forgedSurface), isReason("operation"));
  const extraKey = {
    ...testOperation,
    payload: {
      path: CLAUDE_CODE_LOCAL_SETTINGS_REF,
      key: "statusLine",
      surface: { surfaceId: testSurface.surfaceId, configuredPlacement: testSurface.path, x: 1 },
    },
  };
  await rejects(execute(extraKey), isReason("operation"));
  // 配置本身不合法：input。
  await rejects(
    executeClaudeCodeStatuslineSettingsOperation(root, {
      config: {} as never,
      operation: testOperation.payload,
      sourceDigest: testOperation.sourceDigest,
      targetDigest: testOperation.targetDigest,
      recoveringAffectedOperation: false,
    }),
    isReason("input"),
  );
});
