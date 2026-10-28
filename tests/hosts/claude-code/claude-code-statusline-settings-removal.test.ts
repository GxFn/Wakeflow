/**
 * 2 级（能力）：退出路径的状态行条目（ADR-0024 `remove-statusline-entry`）在一次性根上的完整效果——
 * 只删所有权判定为 Wakeflow 的那一条 `statusLine`、用户自己的不碰、没有即 current、读不出即 blocker；
 * 程序根与每个 wakeflow-managed 支撑面各一条（面根缺失无可删）；执行只删一键保留其他键与顺序，已是
 * 目标字节的重放报 current 不写，源变了即 source-stale，只有 affected 恢复把已不在的文件当作已删；安装
 * 与删除的 executor 互不接受对方的负载；detach-repository 为空集。
 */
import { deepEqual, equal, ok, rejects } from "node:assert/strict";
import {
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
import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { claudeCodeStatuslineCommand } from "../../../src/hosts/claude-code/claude-code-statusline-asset.js";
import {
  CLAUDE_CODE_LOCAL_SETTINGS_REF,
  CLAUDE_CODE_STATUSLINE_REMOVAL_OPERATION_ID,
  CLAUDE_CODE_STATUSLINE_REMOVAL_OPERATION_KIND,
  CLAUDE_CODE_STATUSLINE_SETTINGS_BLOCKER,
  CLAUDE_CODE_STATUSLINE_SETTINGS_OWNER_ID,
  ClaudeCodeStatuslineSettingsOperationError,
  claudeCodeStatuslineRemovalTargetKey,
  claudeCodeStatuslineSettingsRemovalOperationId,
  claudeCodeStatuslineSettingsSurfaceBlocker,
  executeClaudeCodeStatuslineSettingsOperation,
  executeClaudeCodeStatuslineSettingsRemoval,
  planClaudeCodeStatuslineSettingsOperation,
  planClaudeCodeStatuslineSettingsRemoval,
} from "../../../src/hosts/claude-code/claude-code-statusline-settings-operation.js";
import { createMinimalWakeflowConfig } from "../../configuration/wakeflow-config.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";

useDisposableDurability();

function model() {
  const value = createMinimalWakeflowConfig();
  (value.storage as Record<string, unknown>).ledgerRoot = "Ledger";
  return parseWakeflowConfig(value);
}

async function fixture(t: TestContext) {
  const absolutePath = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "wakeflow-claude-statusline-removal-")),
  );
  const root = await RootedDirectory.open(absolutePath);
  t.after(async () => {
    await root.close();
    rmSync(absolutePath, { recursive: true, force: true });
  });
  return Object.freeze({ absolutePath, root });
}

function localSettingsPath(directory: string): string {
  return path.join(directory, ...CLAUDE_CODE_LOCAL_SETTINGS_REF.split("/"));
}

function writeLocalSettings(directory: string, document: unknown, mode = 0o600): string {
  mkdirSync(path.join(directory, ".claude"), { mode: 0o755, recursive: true });
  const file = localSettingsPath(directory);
  writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`, { mode });
  return file;
}

function wakeflowEntry(workspaceRoot: string) {
  return { type: "command", command: claudeCodeStatuslineCommand(workspaceRoot) };
}

const isStale = (error: unknown) =>
  error instanceof ClaudeCodeStatuslineSettingsOperationError && error.reason === "source-stale";
const isOperation = (error: unknown) =>
  error instanceof ClaudeCodeStatuslineSettingsOperationError && error.reason === "operation";

test("the program root plans one removal only for Wakeflow's own statusLine, executes it keeping the other keys and their order, and treats the user's entry, a missing key and a missing file as nothing to remove", async (t) => {
  const workspace = await fixture(t);
  const config = model();
  const plan = (action: "detach-workspace" | "detach-repository" = "detach-workspace") =>
    planClaudeCodeStatuslineSettingsRemoval(workspace.root, { action, config });
  const execute = (
    operation: Awaited<ReturnType<typeof plan>>["operations"][number] | undefined,
    recoveringAffectedOperation = false,
  ) => {
    if (operation === undefined) throw new Error("Expected an operation.");
    return executeClaudeCodeStatuslineSettingsRemoval(workspace.root, {
      config,
      operation: operation.payload,
      sourceDigest: operation.sourceDigest,
      targetDigest: operation.targetDigest,
      recoveringAffectedOperation,
    });
  };

  // 没有文件：无可删。
  deepEqual(await plan(), { operations: [], blockerCodes: [] });

  // 用户自己的状态行：不碰。
  const file = writeLocalSettings(workspace.absolutePath, {
    statusLine: { type: "command", command: "echo mine" },
    theme: "dark",
  });
  deepEqual(await plan(), { operations: [], blockerCodes: [] });

  // 没有这一键：无可删。
  writeLocalSettings(workspace.absolutePath, { theme: "dark" });
  deepEqual(await plan(), { operations: [], blockerCodes: [] });

  // Wakeflow 自己的条目（现行标记）夹在用户键之间：一条操作，只删这一键，其他键原位。
  writeLocalSettings(workspace.absolutePath, {
    permissions: { allow: ["Bash(ls:*)"] },
    statusLine: wakeflowEntry(workspace.absolutePath),
    theme: "dark",
  });
  const planned = await plan();
  deepEqual(planned.blockerCodes, []);
  equal(planned.operations.length, 1);
  const operation = planned.operations[0];
  equal(operation?.operationId, CLAUDE_CODE_STATUSLINE_REMOVAL_OPERATION_ID);
  equal(operation?.operationKind, CLAUDE_CODE_STATUSLINE_REMOVAL_OPERATION_KIND);
  equal(operation?.operationKind, "remove-statusline-entry");
  equal(operation?.ownerId, CLAUDE_CODE_STATUSLINE_SETTINGS_OWNER_ID);
  equal(operation?.targetKey, "statusline");
  equal(operation?.targetKey, claudeCodeStatuslineRemovalTargetKey(null));
  equal(operation?.sourceDigest, computeSha256Digest(readFileSync(file)));
  deepEqual(operation?.payload, {
    path: CLAUDE_CODE_LOCAL_SETTINGS_REF,
    key: "statusLine",
    effect: "remove",
  });
  equal((await execute(operation)).disposition, "updated");
  const rewritten = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  deepEqual(Object.keys(rewritten), ["permissions", "theme"]);
  deepEqual(rewritten, { permissions: { allow: ["Bash(ls:*)"] }, theme: "dark" });
  equal(statSync(file).mode & 0o777, 0o600);
  equal(computeSha256Digest(readFileSync(file)), operation?.targetDigest);
  deepEqual(await plan(), { operations: [], blockerCodes: [] }, "removed is current");

  // 重放：文件已是目标字节，无论是否 affected 恢复都报 current 且不写（inode 不变）——与安装路径同一规则；
  // 源真的变了才是 source-stale（下一个用例）。
  const inode = statSync(file).ino;
  equal((await execute(operation)).disposition, "current");
  equal((await execute(operation, true)).disposition, "current");
  equal(statSync(file).ino, inode);

  // 0.9.x 的资产命令也是 Wakeflow 的：删。只有这一键的文件删成 `{}`，文件本身保留。
  writeLocalSettings(workspace.absolutePath, {
    statusLine: {
      type: "command",
      command: 'node "/elsewhere/.wakeflow-local/wakeflow-statusline.mjs"',
    },
  });
  const legacy = await plan();
  equal((await execute(legacy.operations[0])).disposition, "updated");
  deepEqual(JSON.parse(readFileSync(file, "utf8")), {});

  // detach-repository 没有状态行维度；非退出动作是调用错误。
  writeLocalSettings(workspace.absolutePath, { statusLine: wakeflowEntry(workspace.absolutePath) });
  deepEqual(await plan("detach-repository"), { operations: [], blockerCodes: [] });
  await rejects(
    planClaudeCodeStatuslineSettingsRemoval(workspace.root, {
      action: "fresh-initialize",
      config,
    }),
    (error: unknown) =>
      error instanceof ClaudeCodeStatuslineSettingsOperationError &&
      error.reason === "input" &&
      error.path === "$action",
  );
});

test("removal refuses to write when the plan went stale: a replaced entry, a user's entry, or a deleted file; only affected recovery treats the vanished file as already removed", async (t) => {
  const workspace = await fixture(t);
  const config = model();
  const file = writeLocalSettings(workspace.absolutePath, {
    statusLine: wakeflowEntry(workspace.absolutePath),
    theme: "dark",
  });
  const planned = await planClaudeCodeStatuslineSettingsRemoval(workspace.root, {
    action: "detach-workspace",
    config,
  });
  const operation = planned.operations[0];
  if (operation === undefined) throw new Error("Expected an operation.");
  const execute = (recoveringAffectedOperation: boolean) =>
    executeClaudeCodeStatuslineSettingsRemoval(workspace.root, {
      config,
      operation: operation.payload,
      sourceDigest: operation.sourceDigest,
      targetDigest: operation.targetDigest,
      recoveringAffectedOperation,
    });

  // 计划后用户把条目换成自己的：两种模式都不碰它。
  const mine = { statusLine: { type: "command", command: "echo mine" }, theme: "dark" };
  writeLocalSettings(workspace.absolutePath, mine);
  await rejects(execute(false), isStale);
  await rejects(execute(true), isStale);
  deepEqual(JSON.parse(readFileSync(file, "utf8")), mine);

  // 计划后用户加了别的键：常规执行 source-stale；affected 恢复去掉 Wakeflow 的键后字节不等于计划目标，同样 source-stale。
  writeLocalSettings(workspace.absolutePath, {
    statusLine: wakeflowEntry(workspace.absolutePath),
    theme: "dark",
    model: "opus",
  });
  await rejects(execute(false), isStale);
  await rejects(execute(true), isStale);
  ok(readFileSync(file, "utf8").includes('"model": "opus"'));

  // 文件已不在：常规执行是过期计划，affected 恢复算已删（无可删）。
  rmSync(file);
  await rejects(execute(false), isStale);
  equal((await execute(true)).disposition, "current");
  equal(statSync(path.join(workspace.absolutePath, ".claude")).isDirectory(), true);
});

test("每个 wakeflow-managed 支撑面各一条删除操作（标识与 targetKey 带 surfaceId），面根缺失无可删，读不出即与安装路径同名的 blocker，执行时对照当前配置核对", async (t) => {
  const workspace = await fixture(t);
  const config = model();
  const [design, testSurface] = config.topology.supportSurfaces;
  if (design === undefined || testSurface === undefined) {
    throw new Error("The fixture config declares two support surfaces.");
  }
  const designRoot = path.join(workspace.absolutePath, design.path);
  // 工作区根读不出（不是对象）；Design 面有 Wakeflow 的条目；Test 根不在。
  writeLocalSettings(workspace.absolutePath, []);
  const designFile = writeLocalSettings(designRoot, {
    statusLine: wakeflowEntry(workspace.absolutePath),
    theme: "light",
  });
  const planned = await planClaudeCodeStatuslineSettingsRemoval(workspace.root, {
    action: "detach-workspace",
    config,
  });
  deepEqual(planned.blockerCodes, [CLAUDE_CODE_STATUSLINE_SETTINGS_BLOCKER]);
  equal(planned.operations.length, 1);
  const operation = planned.operations[0];
  equal(operation?.operationId, claudeCodeStatuslineSettingsRemovalOperationId(design.surfaceId));
  equal(operation?.targetKey, `statusline:support:${design.surfaceId}`);
  equal(
    operation?.targetKey,
    claudeCodeStatuslineRemovalTargetKey({
      surfaceId: design.surfaceId,
      configuredPlacement: design.path,
    }),
  );
  deepEqual(operation?.payload, {
    path: CLAUDE_CODE_LOCAL_SETTINGS_REF,
    key: "statusLine",
    effect: "remove",
    surface: { surfaceId: design.surfaceId, configuredPlacement: design.path },
  });

  // 支撑面文件读不出：带 surfaceId 的 blocker，别的根照常。
  writeLocalSettings(workspace.absolutePath, { statusLine: wakeflowEntry(workspace.absolutePath) });
  mkdirSync(path.join(workspace.absolutePath, testSurface.path, ".claude"), {
    mode: 0o755,
    recursive: true,
  });
  writeFileSync(
    localSettingsPath(path.join(workspace.absolutePath, testSurface.path)),
    "{ not json\n",
    {
      mode: 0o600,
    },
  );
  const partial = await planClaudeCodeStatuslineSettingsRemoval(workspace.root, {
    action: "detach-workspace",
    config,
  });
  deepEqual(partial.blockerCodes, [
    claudeCodeStatuslineSettingsSurfaceBlocker(testSurface.surfaceId),
  ]);
  deepEqual(
    partial.operations.map((entry) => entry.targetKey),
    ["statusline", `statusline:support:${design.surfaceId}`],
  );

  // 执行支撑面那一条：配置里该面不再是 wakeflow-managed 就拒绝；对照成立就只删那一键。
  if (operation === undefined) throw new Error("Expected the Design operation.");
  const foreign = createMinimalWakeflowConfig();
  const surfaces = (foreign.topology as { supportSurfaces: Record<string, unknown>[] })
    .supportSurfaces;
  const foreignDesign = surfaces[0];
  if (foreignDesign === undefined) throw new Error("Expected Design surface.");
  foreignDesign.ownership = "external-owned";
  foreignDesign.instructionManagement = "owner-managed";
  (foreign.storage as Record<string, unknown>).ledgerRoot = "Ledger";
  const request = (configValue: unknown) => ({
    config: parseWakeflowConfig(configValue),
    operation: operation.payload,
    sourceDigest: operation.sourceDigest,
    targetDigest: operation.targetDigest,
    recoveringAffectedOperation: false,
  });
  await rejects(
    executeClaudeCodeStatuslineSettingsRemoval(workspace.root, request(foreign)),
    isOperation,
  );
  deepEqual(JSON.parse(readFileSync(designFile, "utf8")), {
    statusLine: wakeflowEntry(workspace.absolutePath),
    theme: "light",
  });
  const executed = await executeClaudeCodeStatuslineSettingsRemoval(workspace.root, {
    ...request(createMinimalWakeflowConfig()),
    config,
  });
  equal(executed.disposition, "updated");
  deepEqual(JSON.parse(readFileSync(designFile, "utf8")), { theme: "light" });
  equal(statSync(designFile).mode & 0o777, 0o600);
});

test("the install executor refuses a removal payload and the removal executor refuses an install payload before touching the file", async (t) => {
  const workspace = await fixture(t);
  const config = model();
  const file = writeLocalSettings(workspace.absolutePath, {
    statusLine: wakeflowEntry("/elsewhere/workspace"),
  });
  const before = readFileSync(file, "utf8");
  const install = await planClaudeCodeStatuslineSettingsOperation(workspace.root);
  const removal = (
    await planClaudeCodeStatuslineSettingsRemoval(workspace.root, {
      action: "detach-workspace",
      config,
    })
  ).operations[0];
  if (install === null || removal === undefined) throw new Error("Expected both operations.");
  await rejects(
    executeClaudeCodeStatuslineSettingsOperation(workspace.root, {
      config,
      operation: removal.payload,
      sourceDigest: removal.sourceDigest,
      targetDigest: removal.targetDigest,
      recoveringAffectedOperation: false,
    }),
    isOperation,
  );
  await rejects(
    executeClaudeCodeStatuslineSettingsRemoval(workspace.root, {
      config,
      operation: install.payload,
      sourceDigest: install.sourceDigest,
      targetDigest: install.targetDigest,
      recoveringAffectedOperation: false,
    }),
    isOperation,
  );
  for (const forged of [
    { ...(removal.payload as Record<string, unknown>), effect: "install" },
    { path: CLAUDE_CODE_LOCAL_SETTINGS_REF, key: "statusLine", effect: "remove", extra: 1 },
  ]) {
    await rejects(
      executeClaudeCodeStatuslineSettingsRemoval(workspace.root, {
        config,
        operation: forged,
        sourceDigest: removal.sourceDigest,
        targetDigest: removal.targetDigest,
        recoveringAffectedOperation: false,
      }),
      isOperation,
    );
  }
  equal(readFileSync(file, "utf8"), before);
});
