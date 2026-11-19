import { deepEqual } from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import { RootedDirectory } from "../../src/foundation/filesystem/rooted-directory.js";
import { listHelperNudgeRecords } from "../../src/kernel/helper-observation-file.js";
import { hostHelperObservationsRootRef } from "../../src/kernel/layout.js";
import { useDisposableDurability } from "../support/disposable-durability.js";

useDisposableDurability();

/**
 * 1 级（组件）：助手推过续跑短句留下的记录的读回（open-items H13，1.4 第 4 段）。它只用来把目标会话里的
 * 一条 prompt 认作"Controller 推的那一句"：目录不在、文件读不出、形状不对都当作没有那一条——少认一条，
 * 那条 prompt 就被算成任务包之外来的，评审者看得见；绝不因为它让导入失败。只认本宿主目录里名字带
 * `-nudge-` 的文件，别的观察文件不读。
 */

const WINDOW = "window_11111111-1111-4111-8111-111111111111";
const OTHER_WINDOW = "window_22222222-2222-4222-8222-222222222222";
const DIGEST = `sha256:${"a".repeat(64)}`;

async function fixture(t: TestContext): Promise<{ root: RootedDirectory; directory: string }> {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-nudge-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = await RootedDirectory.open(base);
  t.after(() => root.close());
  return {
    root,
    directory: path.join(base, ...hostHelperObservationsRootRef("claude-code").split("/")),
  };
}

function nudge(windowId: string, sentAt: string): string {
  return `${JSON.stringify({ kind: "WakeflowWindowNudge", windowId, textDigest: DIGEST, sentAt })}\n`;
}

test("没有观察目录就是没有记录；有记录时新的在前，只读名字带 -nudge- 的文件", async (t) => {
  const { root, directory } = await fixture(t);
  deepEqual(await listHelperNudgeRecords(root, "claude-code"), []);

  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const write = (name: string, text: string) =>
    writeFileSync(path.join(directory, name), text, { mode: 0o600 });
  write(
    "20261117T000500000Z-nudge-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json",
    nudge(WINDOW, "2026-11-17T00:05:00.000Z"),
  );
  write(
    "20261117T000800000Z-nudge-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.json",
    nudge(OTHER_WINDOW, "2026-11-17T00:08:00.000Z"),
  );
  // 别的观察（登记、结局）不是续跑记录，哪怕内容长得像。
  write(
    "20261117T000900000Z-outcome-cccccccc-cccc-4ccc-8ccc-cccccccccccc.json",
    nudge(WINDOW, "2026-11-17T00:09:00.000Z"),
  );
  // 形状不对、不是 JSON、是目录：各当作没有那一条。
  write(
    "20261117T001000000Z-nudge-dddddddd-dddd-4ddd-8ddd-dddddddddddd.json",
    `${JSON.stringify({ kind: "WakeflowWindowNudge", windowId: "not-a-window", textDigest: DIGEST, sentAt: "2026-11-17T00:10:00.000Z" })}\n`,
  );
  write("20261117T001100000Z-nudge-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.json", "{");
  mkdirSync(
    path.join(directory, "20261117T001200000Z-nudge-ffffffff-ffff-4fff-8fff-ffffffffffff.json"),
  );

  deepEqual(await listHelperNudgeRecords(root, "claude-code"), [
    { windowId: OTHER_WINDOW, textDigest: DIGEST, sentAt: "2026-11-17T00:08:00.000Z" },
    { windowId: WINDOW, textDigest: DIGEST, sentAt: "2026-11-17T00:05:00.000Z" },
  ]);
  // 另一个宿主的目录是另一回事。
  deepEqual(await listHelperNudgeRecords(root, "codex"), []);
});
