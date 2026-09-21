import { deepEqual, equal } from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";
import { claudeCodeWorkspaceHostResourceProfile } from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import {
  inspectWakeflowManagedBlockFile,
  recomposeWakeflowManagedBlockFile,
  WakeflowManagedBlockFileError,
  type WakeflowManagedBlockFileErrorReason,
} from "../../../src/workspace/managed-integration/wakeflow-managed-block-file.js";
import { recomposeWakeflowManagedTextEnvelope } from "../../../src/workspace/managed-integration/wakeflow-managed-text-envelope.js";
import {
  createWakeflowSupportGitignoreBodyAuthority,
  WAKEFLOW_SUPPORT_GITIGNORE_FILE_NAME,
} from "../../../src/workspace/managed-integration/wakeflow-support-gitignore-body-authority.js";

/**
 * 支撑面 `.gitignore` 托管块：正文只含各宿主的本机设置路径，根锚定；托管块文件的机械
 * owner 在任意根里新建（0644）、追加保留所有者权限位、相同即 current、未知或被改的托管
 * 正文只报告。
 */

const PROFILES = Object.freeze([
  codexWorkspaceHostResourceProfile,
  claudeCodeWorkspaceHostResourceProfile,
]);

async function fixture(t: TestContext) {
  const absolutePath = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "wakeflow-support-gitignore-")),
  );
  const root = await RootedDirectory.open(absolutePath);
  t.after(async () => {
    await root.close();
    rmSync(absolutePath, { recursive: true, force: true });
  });
  return Object.freeze({ absolutePath, root, gitignore: path.join(absolutePath, ".gitignore") });
}

async function expectBlockFileError(
  action: () => Promise<unknown>,
  reason: WakeflowManagedBlockFileErrorReason,
  pathValue: string,
): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof WakeflowManagedBlockFileError, true);
  if (caught instanceof WakeflowManagedBlockFileError) {
    equal(caught.code, "wakeflow-managed-block-file");
    equal(caught.reason, reason);
    equal(caught.path, pathValue);
  }
}

function request(authority: NonNullable<ReturnType<typeof createWakeflowSupportGitignoreBodyAuthority>>) {
  return {
    resourcePath: WAKEFLOW_SUPPORT_GITIGNORE_FILE_NAME,
    currentTargets: [authority.envelopeTarget],
    desiredTarget: authority.envelopeTarget,
  };
}

test("support gitignore authority lists only the hosts' local settings paths, root-anchored", () => {
  const authority = createWakeflowSupportGitignoreBodyAuthority(PROFILES);
  equal(authority !== null, true);
  if (authority === null) return;
  deepEqual([...authority.hostIds], ["codex", "claude-code"]);
  deepEqual([...authority.rules], ["/.claude/settings.local.json"]);
  equal(authority.body, "/.claude/settings.local.json\n");
  equal(authority.bodyDigest, computeSha256Digest(encodeUtf8(authority.body)));
  deepEqual(authority.envelopeTarget, {
    component: "support-ignore",
    owner: "workspace-ignore-integration",
    body: authority.body,
  });
  equal(Object.isFrozen(authority), true);
  deepEqual(createWakeflowSupportGitignoreBodyAuthority(PROFILES), authority);

  const codexOnly = createWakeflowSupportGitignoreBodyAuthority([
    codexWorkspaceHostResourceProfile,
    { ...claudeCodeWorkspaceHostResourceProfile, surfaces: {
      ...claudeCodeWorkspaceHostResourceProfile.surfaces,
      settingsIntegration: null,
      statuslineAsset: null,
    } },
  ]);
  equal(codexOnly, null);
});

test("managed block file creates, appends, stays current and refuses edited or foreign blocks", async (t) => {
  const authority = createWakeflowSupportGitignoreBodyAuthority(PROFILES);
  if (authority === null) throw new Error("expected an authority");
  const fresh = await fixture(t);
  const absent = await inspectWakeflowManagedBlockFile(fresh.root, request(authority));
  equal(absent.status, "recompose-required");
  equal(absent.source, null);
  equal(existsSync(fresh.gitignore), false, "inspection must not write");

  const created = await recomposeWakeflowManagedBlockFile(
    fresh.root,
    request(authority),
    { createMode: 0o644 },
  );
  equal(created.disposition, "created");
  equal(statSync(fresh.gitignore).mode & 0o777, 0o644);
  deepEqual(
    readFileSync(fresh.gitignore),
    Buffer.from(recomposeWakeflowManagedTextEnvelope(new Uint8Array(), authority.envelopeTarget).bytes),
  );
  equal(
    (await recomposeWakeflowManagedBlockFile(fresh.root, request(authority), { createMode: 0o644 }))
      .disposition,
    "current",
  );

  const owned = await fixture(t);
  writeFileSync(owned.gitignore, "node_modules/\n*.log\n", { mode: 0o664 });
  chmodSync(owned.gitignore, 0o664);
  const replaced = await recomposeWakeflowManagedBlockFile(
    owned.root,
    request(authority),
    { createMode: 0o644 },
  );
  equal(replaced.disposition, "replaced");
  equal(statSync(owned.gitignore).mode & 0o777, 0o664);
  const text = readFileSync(owned.gitignore, "utf8");
  equal(text.startsWith("node_modules/\n*.log\n"), true);
  equal(text.includes("component=support-ignore owner=workspace-ignore-integration"), true);
  equal(text.includes("/.claude/settings.local.json"), true);

  // 受管区域内的手改破坏 envelope 摘要：只报告。
  writeFileSync(owned.gitignore, text.replace("/.claude/settings.local.json", "/.claude/settings.local.json\n/extra"));
  await expectBlockFileError(
    () => inspectWakeflowManagedBlockFile(owned.root, request(authority)),
    "envelope",
    "$source",
  );

  // 自洽但不是已准入渲染的托管正文：未知正文，只报告。
  const foreign = recomposeWakeflowManagedTextEnvelope(
    Buffer.from("# owner\n"),
    { ...authority.envelopeTarget, body: "/.claude/settings.local.json\n/other\n" },
  ).bytes;
  writeFileSync(owned.gitignore, foreign);
  await expectBlockFileError(
    () => recomposeWakeflowManagedBlockFile(owned.root, request(authority), { createMode: 0o644 }),
    "unknown-managed-body",
    "$source",
  );
  deepEqual(readFileSync(owned.gitignore), Buffer.from(foreign));

  const controller = new AbortController();
  controller.abort();
  const cancelled = await fixture(t);
  await expectBlockFileError(
    () => recomposeWakeflowManagedBlockFile(
      cancelled.root,
      { ...request(authority), signal: controller.signal },
      { createMode: 0o644 },
    ),
    "aborted",
    "$signal",
  );
  equal(existsSync(cancelled.gitignore), false);
});
