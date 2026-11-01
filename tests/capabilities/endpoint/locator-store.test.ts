import { deepEqual, equal, rejects } from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
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
import { useDisposableDurability } from "../../support/disposable-durability.js";

useDisposableDurability();

/**
 * 定位器存储（第 1 级，组件；能力卡 2.3，ADR-0025 D3）：tmux 与桌面两种 provider 的记录在一次性根目录上写入、
 * 读回与整体替换；私有定位器文件损坏、registeredAt 非法、hostId 与读取方不符、provider 未知或缺少该
 * provider 的对象时，读取一律以 invalid-request/locator-record 失败，locatorId 与内容不符以 locator-record-id
 * 失败，而不是让基础层错误以 unexpected 逃出。
 */

const WINDOW_ID = "controller";
const DESKTOP_SESSION_ID = "local_0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";

function locator(hostId: WakeflowHostId): Readonly<WindowLocatorRecord> {
  return createWindowLocatorRecord({
    programId: "program-1",
    hostId,
    windowId: WINDOW_ID,
    bindingId: "binding-1",
    provider: "tmux",
    tmux: { socketName: null, sessionName: "wakeflow", windowId: "@1", paneId: "%1" },
    registeredAt: parseUtcInstant("2026-09-04T10:00:00.000Z"),
  });
}

function desktopLocator(
  hostId: WakeflowHostId,
  sessionId = DESKTOP_SESSION_ID,
): Readonly<WindowLocatorRecord> {
  return createWindowLocatorRecord({
    programId: "program-1",
    hostId,
    windowId: WINDOW_ID,
    bindingId: "binding-1",
    provider: "desktop",
    desktop: { sessionId },
    registeredAt: parseUtcInstant("2026-09-04T10:00:00.000Z"),
  });
}

/** 先写入一个合法的 claude-code 定位器，返回其文件的绝对路径与根目录句柄。 */
async function fixture(
  t: TestContext,
  record: Readonly<WindowLocatorRecord> = locator("claude-code"),
): Promise<{ readonly rooted: RootedDirectory; readonly file: string }> {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wakeflow-locator-store-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const rooted = await RootedDirectory.open(root);
  t.after(() => rooted.close());
  const ref = await writeWindowLocator(rooted, record, undefined);
  return { rooted, file: path.join(root, ref) };
}

async function expectLocatorFailure(rooted: RootedDirectory, reason: string): Promise<void> {
  await rejects(
    readWindowLocator(rooted, "claude-code", WINDOW_ID, undefined),
    (error: unknown) => {
      if (!(error instanceof WakeflowError)) return false;
      equal(`${error.code}/${error.reason}`, `invalid-request/${reason}`);
      return true;
    },
  );
}

test("定位器文件不是合法 JSON 时读取以 invalid-request/locator-record 失败", async (t) => {
  const { rooted, file } = await fixture(t);
  writeFileSync(file, "{not json\n");
  await expectLocatorFailure(rooted, "locator-record");
});

test("定位器 registeredAt 非法时读取以 invalid-request/locator-record 失败", async (t) => {
  const { rooted, file } = await fixture(t);
  const record = { ...locator("claude-code"), registeredAt: "not-an-instant" };
  writeFileSync(file, renderDeterministicJsonDocument(record));
  await expectLocatorFailure(rooted, "locator-record");
});

test("定位器 hostId 与读取方不符时读取以 invalid-request/locator-record 失败", async (t) => {
  const { rooted, file } = await fixture(t);
  writeFileSync(file, renderDeterministicJsonDocument(locator("codex")));
  await expectLocatorFailure(rooted, "locator-record");
});

test("定位器文件不以单个 LF 结尾时读取以 invalid-request/locator-record 失败（§13.131 审查）", async (t) => {
  const { rooted, file } = await fixture(t);
  writeFileSync(file, "{not json");
  await expectLocatorFailure(rooted, "locator-record");
});

test("tmux 定位器记录读回与写入相等：provider tmux、四元组坐标、没有 desktop 对象（ADR-0025 之前的记录形状不变）", async (t) => {
  const { rooted, file } = await fixture(t);
  const written = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  equal(written.provider, "tmux");
  deepEqual(written.tmux, {
    socketName: null,
    sessionName: "wakeflow",
    windowId: "@1",
    paneId: "%1",
  });
  equal("desktop" in written, false);
  deepEqual(
    await readWindowLocator(rooted, "claude-code", WINDOW_ID, undefined),
    locator("claude-code"),
  );
});

test("桌面定位器记录：provider desktop 与 desktop.sessionId 落盘、没有 tmux 对象、文件 0600，读回与写入相等（ADR-0025 D3）", async (t) => {
  const record = desktopLocator("claude-code");
  const { rooted, file } = await fixture(t, record);
  equal(statSync(file).mode & 0o777, 0o600);
  const written = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  equal(written.kind, "WakeflowWindowLocator");
  equal(written.provider, "desktop");
  deepEqual(written.desktop, { sessionId: DESKTOP_SESSION_ID });
  equal("tmux" in written, false);
  equal(written.locatorId, record.locatorId);
  deepEqual(await readWindowLocator(rooted, "claude-code", WINDOW_ID, undefined), record);
});

test("定位器代际随位置派生：同一绑定换桌面会话得到新的 locatorId，桌面与 tmux 记录的代际互不相同", () => {
  const first = desktopLocator("claude-code");
  const second = desktopLocator("claude-code", "local_1e1e1e1e-1e1e-4e1e-8e1e-1e1e1e1e1e1e");
  equal(first.locatorId === second.locatorId, false);
  equal(first.locatorId === locator("claude-code").locatorId, false);
  deepEqual(desktopLocator("claude-code"), first, "derivation is deterministic");
});

test("同一窗口的定位器从 tmux 换成桌面时整体替换：读回的是桌面记录", async (t) => {
  const { rooted, file } = await fixture(t);
  await writeWindowLocator(rooted, desktopLocator("claude-code"), undefined);
  const written = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  equal(written.provider, "desktop");
  equal("tmux" in written, false);
  deepEqual(
    await readWindowLocator(rooted, "claude-code", WINDOW_ID, undefined),
    desktopLocator("claude-code"),
  );
});

test("provider 未知、桌面记录缺 desktop 对象或 sessionId、tmux 记录缺 tmux 对象时读取以 invalid-request/locator-record 失败", async (t) => {
  const { rooted, file } = await fixture(t);
  writeFileSync(
    file,
    renderDeterministicJsonDocument({ ...desktopLocator("claude-code"), provider: "sidebar" }),
  );
  await expectLocatorFailure(rooted, "locator-record");
  const { desktop: _desktop, ...withoutDesktop } = desktopLocator("claude-code") as Record<
    string,
    unknown
  >;
  writeFileSync(file, renderDeterministicJsonDocument(withoutDesktop));
  await expectLocatorFailure(rooted, "locator-record");
  writeFileSync(
    file,
    renderDeterministicJsonDocument({ ...desktopLocator("claude-code"), desktop: {} }),
  );
  await expectLocatorFailure(rooted, "locator-record");
  const { tmux: _tmux, ...withoutTmux } = locator("claude-code") as Record<string, unknown>;
  writeFileSync(file, renderDeterministicJsonDocument(withoutTmux));
  await expectLocatorFailure(rooted, "locator-record");
});

test("locatorId 与记录内容不符时读取以 invalid-request/locator-record-id 失败（两种 provider）", async (t) => {
  const { rooted, file } = await fixture(t);
  writeFileSync(
    file,
    renderDeterministicJsonDocument({
      ...desktopLocator("claude-code"),
      desktop: { sessionId: "local_1e1e1e1e-1e1e-4e1e-8e1e-1e1e1e1e1e1e" },
    }),
  );
  await expectLocatorFailure(rooted, "locator-record-id");
  writeFileSync(
    file,
    renderDeterministicJsonDocument({
      ...locator("claude-code"),
      tmux: { socketName: null, sessionName: "wakeflow", windowId: "@2", paneId: "%2" },
    }),
  );
  await expectLocatorFailure(rooted, "locator-record-id");
});
