/**
 * 2 级（能力）：退出路径的 portable settings（ADR-0024 `remove-portable-settings-rules`）在一次性根上的
 * 完整效果——detach-workspace 对程序根与托管支撑面计划精确删除（缺根无可删、读不出即
 * `detach-settings-unreadable:<targetKey>`、无条目即 current）、detach-repository 计划为空，以及 remove
 * 操作的 executor：只执行一次、只有 affected 恢复接受已删目标、两次读取之间的漂移在写前以 source-stale
 * 拒绝且不写、种类与负载不一致的伪造操作被拒绝。
 */
import { deepEqual, equal } from "node:assert/strict";
import {
  chmodSync,
  existsSync,
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

import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";
import {
  CLAUDE_CODE_PORTABLE_SETTINGS_REMOVAL_BLOCKER,
  CLAUDE_CODE_PORTABLE_SETTINGS_REMOVAL_OPERATION_KIND,
  claudeCodePortableSettingsRemovalTargetKey,
  planClaudeCodePortableSettingsComposition,
} from "../../../src/hosts/claude-code/claude-code-portable-settings-composition.js";
import {
  ClaudeCodePortableSettingsOperationExecutionError,
  type ClaudeCodePortableSettingsOperationExecutionErrorReason,
  executeClaudeCodePortableSettingsOperation,
} from "../../../src/hosts/claude-code/claude-code-portable-settings-operation-executor.js";
import {
  CLAUDE_CODE_SETTINGS_DIRECTORY_REF,
  ClaudeCodePortableSettingsPublicationError,
  inspectClaudeCodePortableSettings,
  publishClaudeCodePortableSettings,
} from "../../../src/hosts/claude-code/claude-code-portable-settings-publication.js";
import {
  claudeCodePortableSettingsRemovedRulesFor,
  claudeCodePortableSettingsRulesFor,
  WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE,
} from "../../../src/hosts/claude-code/claude-code-portable-settings-transition.js";
import { WAKEFLOW_CLAUDE_CODE_TMUX_PERMISSION_RULE } from "../../../src/hosts/claude-code/claude-code-tmux-asset.js";
import { claudeCodeWorkspaceHostResourceProfile } from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { createMinimalWakeflowConfig } from "../../configuration/wakeflow-config.fixture.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";

useDisposableDurability();

async function fixture(t: TestContext) {
  const absolutePath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-claude-settings-removal-"));
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
  const repositories = (value.topology as { repositories: Record<string, unknown>[] }).repositories;
  const repository = repositories[0];
  if (repository === undefined) throw new Error("Expected repository.");
  repository.path = "ProductA";
  return value;
}

function surfaceIds(configValue: ReturnType<typeof config>): readonly [string, string] {
  const surfaces = (configValue.topology as { supportSurfaces: { surfaceId: string }[] })
    .supportSurfaces;
  const [design, testSurface] = surfaces;
  if (design === undefined || testSurface === undefined) {
    throw new Error("The fixture config declares two support surfaces.");
  }
  return [design.surfaceId, testSurface.surfaceId];
}

function detachRequest(action: "detach-workspace" | "detach-repository", configValue: unknown) {
  return Object.freeze({
    action,
    config: configValue,
    profile: claudeCodeWorkspaceHostResourceProfile,
  });
}

function executeRequest(
  configValue: unknown,
  operation: unknown,
  recoveringAffectedOperation: boolean,
) {
  return Object.freeze({
    config: configValue,
    profile: claudeCodeWorkspaceHostResourceProfile,
    operation,
    recoveringAffectedOperation,
  });
}

function writeSettings(directory: string, text: string): string {
  mkdirSync(path.join(directory, ".claude"), { mode: 0o755, recursive: true });
  const file = path.join(directory, ".claude", "settings.json");
  writeFileSync(file, text, { mode: 0o644 });
  chmodSync(file, 0o644);
  return file;
}

function allowOf(file: string): readonly string[] {
  return (JSON.parse(readFileSync(file, "utf8")) as { permissions: { allow: string[] } })
    .permissions.allow;
}

async function expectExecutionError(
  action: () => Promise<unknown>,
  reason: ClaudeCodePortableSettingsOperationExecutionErrorReason,
): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof ClaudeCodePortableSettingsOperationExecutionError, true);
  if (caught instanceof ClaudeCodePortableSettingsOperationExecutionError) {
    equal(caught.reason, reason);
  }
}

const PROGRAM_TEXT = `${JSON.stringify(
  {
    theme: "dark",
    permissions: {
      allow: [
        "Read(./docs/**)",
        WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE,
        WAKEFLOW_CLAUDE_CODE_TMUX_PERMISSION_RULE,
      ],
    },
  },
  null,
  2,
)}\n`;

test("detach-workspace plans one remove per root that still carries Wakeflow entries, an absent surface root is nothing to remove, and no bytes or paths leak", async (t) => {
  const value = await fixture(t);
  const configValue = config();
  const [designId, testId] = surfaceIds(configValue);
  writeSettings(value.absolutePath, PROGRAM_TEXT);
  // Design 面带 Wakeflow 的角色规则加退役的整服务器规则；Test 根不在。
  writeSettings(
    path.join(value.absolutePath, "Design"),
    `${JSON.stringify(
      {
        permissions: {
          allow: [
            ...claudeCodePortableSettingsRulesFor({ rootKind: "support-surface", role: "design" }),
            WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE,
            "Bash(ls:*)",
          ],
        },
        "secret-user-key": "do-not-project",
      },
      null,
      2,
    )}\n`,
  );
  const before = readdirSync(value.absolutePath);
  const plan = await planClaudeCodePortableSettingsComposition(
    value.root,
    detachRequest("detach-workspace", configValue),
  );
  equal(plan.status, "ready");
  deepEqual(plan.blockerCodes, []);
  deepEqual(
    plan.roots.map((entry) => ({
      placement: entry.root.configuredPlacement,
      status: entry.placementStatus,
      settings: entry.settingsStatus,
    })),
    [
      { placement: ".", status: "present", settings: "update" },
      { placement: "Design", status: "present", settings: "update" },
      { placement: "Test", status: "absent", settings: "current" },
    ],
  );
  equal(plan.operations.length, 2);
  for (const operation of plan.operations) {
    equal(operation.action, "remove");
    equal(typeof operation.sourceDigest, "string", "a remove always has a confirmed source");
  }
  deepEqual(
    plan.operations.map((operation) => claudeCodePortableSettingsRemovalTargetKey(operation.root)),
    ["program", `support:${designId}`],
  );
  equal(CLAUDE_CODE_PORTABLE_SETTINGS_REMOVAL_OPERATION_KIND, "remove-portable-settings-rules");
  equal(
    plan.operations.some((operation) => operation.root.rootId === testId),
    false,
    "an absent root plans no remove",
  );
  const serialized = JSON.stringify(plan);
  equal(serialized.includes(value.absolutePath), false);
  equal(serialized.includes("do-not-project"), false);
  deepEqual(readdirSync(value.absolutePath), before, "preview writes nothing");

  // 两个根都没有 Wakeflow 条目：零操作、零阻塞，预览为空。
  writeSettings(
    value.absolutePath,
    '{\n  "theme": "dark",\n  "permissions": { "allow": ["Read(./docs/**)"] }\n}\n',
  );
  writeSettings(
    path.join(value.absolutePath, "Design"),
    '{"permissions":{"allow":["Bash(ls:*)"]}}\n',
  );
  const current = await planClaudeCodePortableSettingsComposition(
    value.root,
    detachRequest("detach-workspace", configValue),
  );
  equal(current.status, "ready");
  deepEqual(current.operations, []);
  deepEqual(
    current.roots.map((entry) => entry.settingsStatus),
    ["current", "current", "current"],
  );
});

test("detach-workspace blocks an unreadable or mistyped settings.json per root with detach-settings-unreadable:<targetKey> and still plans the other roots; a legacy broad rule does not block removal", async (t) => {
  const value = await fixture(t);
  const configValue = config();
  const [designId] = surfaceIds(configValue);
  // 程序根带旧宽泛规则加 Wakeflow 的条目：删除路径不因旧规则停下。
  writeSettings(
    value.absolutePath,
    `${JSON.stringify(
      { permissions: { allow: ["Bash(git *)", WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE] } },
      null,
      2,
    )}\n`,
  );
  writeSettings(path.join(value.absolutePath, "Design"), "[]\n");
  const testFile = writeSettings(
    path.join(value.absolutePath, "Test"),
    '{"permissions":{"allow":[]}}\n',
  );
  // Test 面的文件不合写入策略（0600）：同样是读不出，不猜。
  chmodSync(testFile, 0o600);
  const plan = await planClaudeCodePortableSettingsComposition(
    value.root,
    detachRequest("detach-workspace", configValue),
  );
  equal(plan.status, "blocked");
  deepEqual(plan.blockerCodes, [
    `${CLAUDE_CODE_PORTABLE_SETTINGS_REMOVAL_BLOCKER}:support:${designId}`,
    `${CLAUDE_CODE_PORTABLE_SETTINGS_REMOVAL_BLOCKER}:support:${surfaceIds(configValue)[1]}`,
  ]);
  equal(plan.operations.length, 1);
  equal(plan.operations[0]?.action, "remove");
  equal(plan.operations[0]?.root.rootKind, "program");
  deepEqual(
    plan.roots.map((entry) => [entry.settingsStatus, entry.transitionReason]),
    [
      ["update", null],
      ["blocked", "root-not-object"],
      ["blocked", null],
    ],
  );
});

test("detach-repository plans no settings change at all: the rules have no repository dimension", async (t) => {
  const value = await fixture(t);
  const configValue = config();
  writeSettings(value.absolutePath, PROGRAM_TEXT);
  const plan = await planClaudeCodePortableSettingsComposition(
    value.root,
    detachRequest("detach-repository", configValue),
  );
  equal(plan.status, "ready");
  equal(plan.action, "detach-repository");
  deepEqual(plan.roots, []);
  deepEqual(plan.operations, []);
  deepEqual(plan.blockerCodes, []);
  equal(
    readFileSync(path.join(value.absolutePath, ".claude", "settings.json"), "utf8"),
    PROGRAM_TEXT,
  );
});

test("a remove operation executes once at the program root and at a support root, keeps the user's entries and keys, refuses a replay with source-stale, and only affected recovery reports current", async (t) => {
  const value = await fixture(t);
  const configValue = config();
  const programFile = writeSettings(value.absolutePath, PROGRAM_TEXT);
  const designFile = writeSettings(
    path.join(value.absolutePath, "Design"),
    `${JSON.stringify(
      {
        permissions: {
          allow: [
            "Bash(ls:*)",
            ...claudeCodePortableSettingsRulesFor({ rootKind: "support-surface", role: "design" }),
          ],
        },
      },
      null,
      2,
    )}\n`,
  );
  const plan = await planClaudeCodePortableSettingsComposition(
    value.root,
    detachRequest("detach-workspace", configValue),
  );
  const program = plan.operations.find((entry) => entry.root.rootKind === "program");
  const design = plan.operations.find((entry) => entry.root.configuredPlacement === "Design");
  if (program === undefined || design === undefined) throw new Error("Expected two removes.");

  const removed = await executeClaudeCodePortableSettingsOperation(
    value.root,
    executeRequest(configValue, program, false),
  );
  equal(removed.disposition, "updated");
  equal(removed.sourceDigest, program.sourceDigest);
  equal(removed.targetDigest, program.targetDigest);
  equal(computeSha256Digest(readFileSync(programFile)), program.targetDigest);
  const programDocument = JSON.parse(readFileSync(programFile, "utf8")) as {
    theme: string;
    permissions: { allow: string[] };
  };
  equal(programDocument.theme, "dark");
  deepEqual(programDocument.permissions.allow, ["Read(./docs/**)"]);

  const designRemoved = await executeClaudeCodePortableSettingsOperation(
    value.root,
    executeRequest(configValue, design, false),
  );
  equal(designRemoved.disposition, "updated");
  deepEqual(allowOf(designFile), ["Bash(ls:*)"]);
  equal(existsSync(designFile), true, "the file stays; only the entries go");

  // 重放：源已经不是计划时的那份，常规执行拒绝；affected 恢复看到目标已提交，报 current 不写。
  await expectExecutionError(
    () =>
      executeClaudeCodePortableSettingsOperation(
        value.root,
        executeRequest(configValue, program, false),
      ),
    "source-stale",
  );
  const recovered = await executeClaudeCodePortableSettingsOperation(
    value.root,
    executeRequest(configValue, program, true),
  );
  equal(recovered.disposition, "current");
  equal(computeSha256Digest(readFileSync(programFile)), program.targetDigest);

  // 删完再预览：无操作。
  const after = await planClaudeCodePortableSettingsComposition(
    value.root,
    detachRequest("detach-workspace", configValue),
  );
  deepEqual(after.operations, []);
  equal(after.status, "ready");
});

test("source drift between the executor's inspection and the publisher's read fails source-stale before any write, and a forged action is refused as an invalid operation", async (t) => {
  const value = await fixture(t);
  const configValue = config();
  const programFile = writeSettings(value.absolutePath, PROGRAM_TEXT);
  const plan = await planClaudeCodePortableSettingsComposition(
    value.root,
    detachRequest("detach-workspace", configValue),
  );
  const program = plan.operations.find((entry) => entry.root.rootKind === "program");
  if (program === undefined) throw new Error("Expected the program remove.");

  // 交错钩子：第 1 次目录检查是 executor 自己的，第 2 次是发布器读 before；在第 2 次之前用户改了文件。
  const driftedSource = PROGRAM_TEXT.replace('"theme": "dark"', '"theme": "light"');
  const inspect = RootedDirectory.prototype.inspectExistingResource;
  let directoryInspections = 0;
  value.root.inspectExistingResource = (resourcePath, errorPath) => {
    if (resourcePath === CLAUDE_CODE_SETTINGS_DIRECTORY_REF) {
      directoryInspections += 1;
      if (directoryInspections === 2) writeFileSync(programFile, driftedSource, { mode: 0o644 });
    }
    return inspect.call(value.root, resourcePath, errorPath);
  };
  await expectExecutionError(
    () =>
      executeClaudeCodePortableSettingsOperation(
        value.root,
        executeRequest(configValue, program, false),
      ),
    "source-stale",
  );
  equal(readFileSync(programFile, "utf8"), driftedSource, "the drifted source is not merged");
  equal(directoryInspections, 2);
  deepEqual(readdirSync(path.join(value.absolutePath, ".claude")), ["settings.json"]);
  value.root.inspectExistingResource = inspect;

  // 用户改回：同一个已确认操作仍成立，收敛到它的 targetDigest。
  writeFileSync(programFile, PROGRAM_TEXT, { mode: 0o644 });
  const executed = await executeClaudeCodePortableSettingsOperation(
    value.root,
    executeRequest(configValue, program, false),
  );
  equal(executed.disposition, "updated");
  equal(computeSha256Digest(readFileSync(programFile)), program.targetDigest);

  // 伪造：把 remove 说成 update 或 create，operationDigest 不再成立。
  for (const action of ["update", "create"]) {
    await expectExecutionError(
      () =>
        executeClaudeCodePortableSettingsOperation(
          value.root,
          executeRequest(configValue, { ...program, action }, false),
        ),
      "operation",
    );
  }
});

test("the publisher's removedRules option is exclusive with the rule tables, inspects an absent root as current, and removes with the caller's confirmed source as the CAS basis", async (t) => {
  const value = await fixture(t);
  const removedRules = claudeCodePortableSettingsRemovedRulesFor({ rootKind: "program" });
  let caught: unknown;
  try {
    await inspectClaudeCodePortableSettings(value.root, {
      removedRules,
      rules: [WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE],
    });
  } catch (error: unknown) {
    caught = error;
  }
  equal(
    caught instanceof ClaudeCodePortableSettingsPublicationError && caught.reason === "input",
    true,
  );
  const absent = await inspectClaudeCodePortableSettings(value.root, { removedRules });
  equal(absent.directoryStatus, "absent");
  equal(absent.transition.status, "current");
  equal(existsSync(path.join(value.absolutePath, ".claude")), false, "inspection creates nothing");

  const file = writeSettings(value.absolutePath, PROGRAM_TEXT);
  const sourceDigest = computeSha256Digest(encodeUtf8(PROGRAM_TEXT));
  try {
    await publishClaudeCodePortableSettings(value.root, {
      removedRules,
      expectedSourceDigest: computeSha256Digest(encodeUtf8('{"theme":"light"}\n')),
    });
  } catch (error: unknown) {
    caught = error;
  }
  equal(
    caught instanceof ClaudeCodePortableSettingsPublicationError &&
      caught.reason === "source-changed",
    true,
  );
  equal(readFileSync(file, "utf8"), PROGRAM_TEXT);
  const published = await publishClaudeCodePortableSettings(value.root, {
    removedRules,
    expectedSourceDigest: sourceDigest,
  });
  equal(published.disposition, "updated");
  equal(published.sourceDigest, sourceDigest);
  deepEqual(allowOf(file), ["Read(./docs/**)"]);
  const again = await publishClaudeCodePortableSettings(value.root, {
    removedRules,
    expectedSourceDigest: published.targetDigest,
  });
  equal(again.disposition, "current");
});
