/**
 * 1 级（组件）：portable settings CAS owner 这一个模块在一次性根上的真实读写——创建、精确替换、
 * 幂等复用、blocked/unsafe 源的保留，以及 expectedSourceDigest 作为调用方确认过的 CAS 基底，
 * 不等就在建目录和写入之前以 source-changed 拒绝（open-items W6 / CR-H7）。
 * 目录缺省是 2 级；本文件不经能力服务或维护事务，只测发布器自身，所以按定义归 1 级。
 */
import { equal } from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";
import {
  ClaudeCodePortableSettingsPublicationError,
  type ClaudeCodePortableSettingsPublicationErrorReason,
  inspectClaudeCodePortableSettings,
  publishClaudeCodePortableSettings,
} from "../../../src/hosts/claude-code/claude-code-portable-settings-publication.js";
import { WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE } from "../../../src/hosts/claude-code/claude-code-portable-settings-transition.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";

useDisposableDurability();

async function fixture(t: TestContext) {
  const absolutePath = mkdtempSync(path.join(os.tmpdir(), "wakeflow-claude-portable-settings-"));
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
    '\t"theme": "dark",',
    '\t"permissions": { "allow": ["Read(./docs/**)"] },',
    '\t"custom": { "preserved": true }',
    "}",
  ].join("\n");
  writeFileSync(file, source, { mode: 0o644 });
  chmodSync(file, 0o644);
  const inode = lstatSync(file, { bigint: true }).ino;
  const updated = await publishClaudeCodePortableSettings(value.root);
  equal(updated.disposition, "updated");
  const desired = readFileSync(file, "utf8");
  equal(desired.includes('\t"theme": "dark",'), true);
  equal(desired.includes('\t"custom": { "preserved": true }'), true);
  equal(desired.includes(WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE), true);
  equal(lstatSync(file, { bigint: true }).ino === inode, false);
});

test("portable settings publication preserves blocked legacy and unsafe sources", async (t) => {
  const value = await fixture(t);
  const directory = path.join(value.absolutePath, ".claude");
  mkdirSync(directory, { mode: 0o755 });
  const file = path.join(directory, "settings.json");
  const legacy = '{"permissions":{"allow":["Bash(git *)"]}}\n';
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

test("publication with expectedSourceDigest null creates only an absent source and refuses a present one before any write", async (t) => {
  const value = await fixture(t);
  const directory = path.join(value.absolutePath, ".claude");
  const file = path.join(directory, "settings.json");
  const source = '{"theme":"dark"}\n';
  const sourceDigest = computeSha256Digest(encodeUtf8(source));
  // 期望一份具体的源而文件不存在：连目录都不建。
  await expectPublicationError(
    () => publishClaudeCodePortableSettings(value.root, { expectedSourceDigest: sourceDigest }),
    "source-changed",
  );
  equal(existsSync(directory), false);
  const created = await publishClaudeCodePortableSettings(value.root, {
    expectedSourceDigest: null,
  });
  equal(created.disposition, "created");
  equal(created.sourceDigest, null);
  // 期望不存在而用户已经放了文件：拒绝且不写。
  writeFileSync(file, source, { mode: 0o644 });
  chmodSync(file, 0o644);
  await expectPublicationError(
    () => publishClaudeCodePortableSettings(value.root, { expectedSourceDigest: null }),
    "source-changed",
  );
  equal(readFileSync(file, "utf8"), source);
});

test("publication with expectedSourceDigest replaces only the exact source and refuses a drifted or already-published one", async (t) => {
  const value = await fixture(t);
  const directory = path.join(value.absolutePath, ".claude");
  mkdirSync(directory, { mode: 0o755 });
  const file = path.join(directory, "settings.json");
  const source = '{"theme":"dark"}\n';
  writeFileSync(file, source, { mode: 0o644 });
  chmodSync(file, 0o644);
  // 期望的是另一份源：拒绝且不写。
  const driftedDigest = computeSha256Digest(encodeUtf8('{"theme":"light"}\n'));
  await expectPublicationError(
    () => publishClaudeCodePortableSettings(value.root, { expectedSourceDigest: driftedDigest }),
    "source-changed",
  );
  equal(readFileSync(file, "utf8"), source);
  const sourceDigest = computeSha256Digest(encodeUtf8(source));
  const updated = await publishClaudeCodePortableSettings(value.root, {
    expectedSourceDigest: sourceDigest,
  });
  equal(updated.disposition, "updated");
  equal(updated.sourceDigest, sourceDigest);
  const published = readFileSync(file, "utf8");
  equal(published.includes(WAKEFLOW_CLAUDE_CODE_MCP_PERMISSION_RULE), true);
  // 旧期望对已发布的源不再成立：即使 transition 已是 current 也拒绝。
  await expectPublicationError(
    () => publishClaudeCodePortableSettings(value.root, { expectedSourceDigest: sourceDigest }),
    "source-changed",
  );
  equal(readFileSync(file, "utf8"), published);
  const current = await publishClaudeCodePortableSettings(value.root, {
    expectedSourceDigest: updated.targetDigest,
  });
  equal(current.disposition, "current");
  equal(current.sourceDigest, updated.targetDigest);
});

test("expectedSourceDigest is publish-only input and must be a digest or null", async (t) => {
  const value = await fixture(t);
  const malformed = { expectedSourceDigest: "sha256:not-a-digest" } as never;
  await expectPublicationError(
    () => publishClaudeCodePortableSettings(value.root, malformed),
    "input",
  );
  await expectPublicationError(
    () => inspectClaudeCodePortableSettings(value.root, { expectedSourceDigest: null } as never),
    "input",
  );
  equal(existsSync(path.join(value.absolutePath, ".claude")), false);
});
