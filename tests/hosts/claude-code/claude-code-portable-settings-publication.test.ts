import { equal } from "node:assert/strict";
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  publishClaudeCodePortableSettings,
  ClaudeCodePortableSettingsPublicationError,
  type ClaudeCodePortableSettingsPublicationErrorReason,
} from "../../../src/hosts/claude-code/claude-code-portable-settings-publication.js";
import {
  WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE,
} from "../../../src/hosts/claude-code/claude-code-portable-settings-transition.js";

async function fixture(t: TestContext) {
  const absolutePath = mkdtempSync(path.join(
    os.tmpdir(),
    "wakeflow-claude-portable-settings-",
  ));
  const root = await RootedDirectory.open(absolutePath);
  t.after(async () => {
    await root.close();
    rmSync(absolutePath, { recursive: true, force: true });
  });
  return Object.freeze({ absolutePath, root });
}

async function expectPublicationError(
  action: () => Promise<unknown>,
  reason: ClaudeCodePortableSettingsPublicationErrorReason,
): Promise<ClaudeCodePortableSettingsPublicationError> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof ClaudeCodePortableSettingsPublicationError, true);
  if (!(caught instanceof ClaudeCodePortableSettingsPublicationError)) {
    throw new Error("Expected portable settings publication error.");
  }
  equal(caught.reason, reason);
  return caught;
}

test("portable settings publication creates once and remains inode-stable", async (t) => {
  const value = await fixture(t);
  const created = await publishClaudeCodePortableSettings(value.root);
  equal(created.disposition, "created");
  const directory = path.join(value.absolutePath, ".claude");
  const file = path.join(directory, "settings.json");
  equal(statSync(directory).mode & 0o777, 0o755);
  equal(statSync(file).mode & 0o777, 0o644);
  const text = readFileSync(file, "utf8");
  equal(text.includes(WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE), true);
  equal(text.includes("Bash("), false);
  const inode = lstatSync(file, { bigint: true }).ino;
  const current = await publishClaudeCodePortableSettings(value.root);
  equal(current.disposition, "current");
  equal(lstatSync(file, { bigint: true }).ino, inode);
});

test("portable settings publication minimally replaces an exact mixed-owned source", async (t) => {
  const value = await fixture(t);
  const directory = path.join(value.absolutePath, ".claude");
  mkdirSync(directory, { mode: 0o755 });
  const file = path.join(directory, "settings.json");
  const source = [
    "{",
    "\t\"theme\": \"dark\",",
    "\t\"permissions\": { \"allow\": [\"Read(./docs/**)\"] },",
    "\t\"custom\": { \"preserved\": true }",
    "}",
  ].join("\n");
  writeFileSync(file, source, { mode: 0o644 });
  chmodSync(file, 0o644);
  const inode = lstatSync(file, { bigint: true }).ino;
  const updated = await publishClaudeCodePortableSettings(value.root);
  equal(updated.disposition, "updated");
  const desired = readFileSync(file, "utf8");
  equal(desired.includes("\t\"theme\": \"dark\","), true);
  equal(desired.includes("\t\"custom\": { \"preserved\": true }"), true);
  equal(desired.includes(WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE), true);
  equal(lstatSync(file, { bigint: true }).ino === inode, false);
});

test("portable settings publication preserves blocked legacy and unsafe sources", async (t) => {
  const value = await fixture(t);
  const directory = path.join(value.absolutePath, ".claude");
  mkdirSync(directory, { mode: 0o755 });
  const file = path.join(directory, "settings.json");
  const legacy = "{\"permissions\":{\"allow\":[\"Bash(git *)\"]}}\n";
  writeFileSync(file, legacy, { mode: 0o644 });
  chmodSync(file, 0o644);
  const blocked = await expectPublicationError(
    () => publishClaudeCodePortableSettings(value.root),
    "transition-blocked",
  );
  equal(blocked.transitionReason, "legacy-broad-permission-present");
  equal(readFileSync(file, "utf8"), legacy);

  chmodSync(file, 0o600);
  await expectPublicationError(
    () => publishClaudeCodePortableSettings(value.root),
    "source-policy",
  );
  equal(readFileSync(file, "utf8"), legacy);
});
