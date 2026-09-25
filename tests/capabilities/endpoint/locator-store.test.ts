import { equal, rejects } from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import {
  createWindowLocatorRecord,
  readWindowLocator,
  type WindowLocatorRecord,
  writeWindowLocator,
} from "../../../src/capabilities/endpoint/locator-store.js";
import type { WakeflowHostId } from "../../../src/contracts/vocabulary/wakeflow-host-id.js";
import { renderDeterministicJsonDocument } from "../../../src/foundation/data/deterministic-json-document.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { WakeflowError } from "../../../src/kernel/error.js";

/**
 * 定位器存储测试：私有定位器文件损坏、registeredAt 非法、hostId 与读取方不符时，
 * 读取一律以 invalid-request/locator-record 失败，而不是让基础层错误以 unexpected 逃出。
 */

const WINDOW_ID = "controller";

function locator(hostId: WakeflowHostId): Readonly<WindowLocatorRecord> {
  return createWindowLocatorRecord({
    programId: "program-1",
    hostId,
    windowId: WINDOW_ID,
    bindingId: "binding-1",
    tmux: { socketName: null, sessionName: "wakeflow", windowId: "@1", paneId: "%1" },
    registeredAt: parseUtcInstant("2026-09-04T10:00:00.000Z"),
  });
}

/** 先写入一个合法的 claude-code 定位器，返回其文件的绝对路径与根目录句柄。 */
async function fixture(
  t: TestContext,
): Promise<{ readonly rooted: RootedDirectory; readonly file: string }> {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-locator-store-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const rooted = await RootedDirectory.open(root);
  t.after(() => rooted.close());
  const ref = await writeWindowLocator(rooted, locator("claude-code"), undefined);
  return { rooted, file: path.join(root, ref) };
}

async function expectLocatorRecordFailure(rooted: RootedDirectory): Promise<void> {
  await rejects(
    readWindowLocator(rooted, "claude-code", WINDOW_ID, undefined),
    (error: unknown) => {
      if (!(error instanceof WakeflowError)) return false;
      equal(`${error.code}/${error.reason}`, "invalid-request/locator-record");
      return true;
    },
  );
}

test("定位器文件不是合法 JSON 时读取以 invalid-request/locator-record 失败", async (t) => {
  const { rooted, file } = await fixture(t);
  writeFileSync(file, "{not json\n");
  await expectLocatorRecordFailure(rooted);
});

test("定位器 registeredAt 非法时读取以 invalid-request/locator-record 失败", async (t) => {
  const { rooted, file } = await fixture(t);
  const record = { ...locator("claude-code"), registeredAt: "not-an-instant" };
  writeFileSync(file, renderDeterministicJsonDocument(record));
  await expectLocatorRecordFailure(rooted);
});

test("定位器 hostId 与读取方不符时读取以 invalid-request/locator-record 失败", async (t) => {
  const { rooted, file } = await fixture(t);
  writeFileSync(file, renderDeterministicJsonDocument(locator("codex")));
  await expectLocatorRecordFailure(rooted);
});

test("定位器文件不以单个 LF 结尾时读取以 invalid-request/locator-record 失败（§13.131 审查）", async (t) => {
  const { rooted, file } = await fixture(t);
  writeFileSync(file, "{not json");
  await expectLocatorRecordFailure(rooted);
});
