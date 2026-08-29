import { equal } from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import {
  durableAtomicFileStageRef,
  issueDurableAtomicFileStageAddress,
  releaseDurableAtomicFileStageAddress,
} from "../../../src/foundation/filesystem/durable-atomic-file-stage-address.js";
import {
  createFileCandidateDurably,
} from "../../../src/foundation/filesystem/durable-file-candidate.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";
import {
  claudeCodeWorkspaceHostResourceProfile,
} from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import {
  planClaudeCodePortableSettingsComposition,
} from "../../../src/hosts/claude-code/claude-code-portable-settings-composition.js";
import {
  executeClaudeCodePortableSettingsOperation,
  ClaudeCodePortableSettingsOperationExecutionError,
  type ClaudeCodePortableSettingsOperationExecutionErrorReason,
} from "../../../src/hosts/claude-code/claude-code-portable-settings-operation-executor.js";
import {
  CLAUDE_CODE_PORTABLE_SETTINGS_REF,
} from "../../../src/hosts/claude-code/claude-code-portable-settings-publication.js";
import {
  planClaudeCodePortableSettingsTransition,
} from "../../../src/hosts/claude-code/claude-code-portable-settings-transition.js";
import {
  createMinimalWakeflowConfigV3,
} from "../../configuration/wakeflow-config-v3.fixture.js";

async function fixture(t: TestContext) {
  const absolutePath = mkdtempSync(path.join(
    os.tmpdir(),
    "wakeflow-claude-settings-operation-",
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

function planRequest(configValue: unknown) {
  return Object.freeze({
    action: "fresh-initialize" as const,
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

test("single operation executes once and only recovery accepts committed target", async (t) => {
  const value = await fixture(t);
  const configValue = config();
  const plan = await planClaudeCodePortableSettingsComposition(
    value.root,
    planRequest(configValue),
  );
  const operation = plan.operations.find((entry) => (
    entry.root.rootKind === "program"
  ));
  if (operation === undefined) throw new Error("Expected Program operation.");
  const created = await executeClaudeCodePortableSettingsOperation(
    value.root,
    executeRequest(configValue, operation, false),
  );
  equal(created.disposition, "created");
  const file = path.join(value.absolutePath, ".claude", "settings.json");
  const inode = lstatSync(file, { bigint: true }).ino;

  await expectExecutionError(
    () => executeClaudeCodePortableSettingsOperation(
      value.root,
      executeRequest(configValue, operation, false),
    ),
    "source-stale",
  );
  const recovered = await executeClaudeCodePortableSettingsOperation(
    value.root,
    executeRequest(configValue, operation, true),
  );
  equal(recovered.disposition, "current");
  equal(lstatSync(file, { bigint: true }).ino, inode);
});

test("Fresh Support operation remains valid after its planned root is materialized", async (t) => {
  const value = await fixture(t);
  const configValue = config();
  const plan = await planClaudeCodePortableSettingsComposition(
    value.root,
    planRequest(configValue),
  );
  const operation = plan.operations.find((entry) => (
    entry.root.configuredPlacement === "Design"
  ));
  if (operation === undefined) throw new Error("Expected Design operation.");
  mkdirSync(path.join(value.absolutePath, "Design"), { mode: 0o755 });
  const executed = await executeClaudeCodePortableSettingsOperation(
    value.root,
    executeRequest(configValue, operation, false),
  );
  equal(executed.disposition, "created");
  equal(readFileSync(
    path.join(value.absolutePath, "Design", ".claude", "settings.json"),
    "utf8",
  ).includes("mcp__plugin_wakeflow_wakeflow"), true);
});

test("affected recovery retires an inactive candidate stage before publishing", async (t) => {
  const value = await fixture(t);
  const configValue = config();
  const plan = await planClaudeCodePortableSettingsComposition(
    value.root,
    planRequest(configValue),
  );
  const operation = plan.operations.find((entry) => (
    entry.root.rootKind === "program"
  ));
  if (operation === undefined) throw new Error("Expected Program operation.");
  mkdirSync(path.join(value.absolutePath, ".claude"), { mode: 0o755 });
  const transition = planClaudeCodePortableSettingsTransition(null);
  if (transition.desiredText === null) throw new Error("Expected desired settings.");
  const bytes = encodeUtf8(transition.desiredText);
  const address = issueDurableAtomicFileStageAddress(
    "create",
    CLAUDE_CODE_PORTABLE_SETTINGS_REF,
    computeSha256Digest(bytes),
    0o644,
  );
  const stageRef = durableAtomicFileStageRef(
    CLAUDE_CODE_PORTABLE_SETTINGS_REF,
    address,
  );
  let released = false;
  try {
    await createFileCandidateDurably(value.root, stageRef, bytes, {
      mode: 0o644,
    });
    releaseDurableAtomicFileStageAddress(address);
    released = true;
    const stagePath = path.join(value.absolutePath, ...stageRef.split("/"));
    equal(existsSync(stagePath), true);
    const recovered = await executeClaudeCodePortableSettingsOperation(
      value.root,
      executeRequest(configValue, operation, true),
    );
    equal(recovered.disposition, "created");
    equal(existsSync(stagePath), false);
    equal(existsSync(path.join(
      value.absolutePath,
      ".claude",
      "settings.json",
    )), true);
  } finally {
    if (!released) releaseDurableAtomicFileStageAddress(address);
  }
});

test("source, authority, and operation drift fail before mutation", async (t) => {
  const value = await fixture(t);
  const configValue = config();
  const sourceDirectory = path.join(value.absolutePath, ".claude");
  mkdirSync(sourceDirectory, { mode: 0o755 });
  const sourceFile = path.join(sourceDirectory, "settings.json");
  writeFileSync(sourceFile, "{\"theme\":\"dark\"}\n", { mode: 0o644 });
  const plan = await planClaudeCodePortableSettingsComposition(
    value.root,
    planRequest(configValue),
  );
  const operation = plan.operations.find((entry) => (
    entry.root.rootKind === "program"
  ));
  if (operation === undefined) throw new Error("Expected Program operation.");

  const changedSource = "{\"theme\":\"light\"}\n";
  writeFileSync(sourceFile, changedSource, { mode: 0o644 });
  await expectExecutionError(
    () => executeClaudeCodePortableSettingsOperation(
      value.root,
      executeRequest(configValue, operation, false),
    ),
    "source-stale",
  );
  equal(readFileSync(sourceFile, "utf8"), changedSource);

  const changedConfig = config();
  (changedConfig.presentation as Record<string, unknown>).language = "zh-Hans";
  await expectExecutionError(
    () => executeClaudeCodePortableSettingsOperation(
      value.root,
      executeRequest(changedConfig, operation, false),
    ),
    "authority-changed",
  );
  equal(readFileSync(sourceFile, "utf8"), changedSource);

  const forged = {
    ...operation,
    targetDigest: `sha256:${"0".repeat(64)}`,
  };
  await expectExecutionError(
    () => executeClaudeCodePortableSettingsOperation(
      value.root,
      executeRequest(configValue, forged, false),
    ),
    "operation",
  );
  equal(readFileSync(sourceFile, "utf8"), changedSource);
});
