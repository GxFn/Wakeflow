import { deepEqual, equal, rejects } from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import {
  createWindowLocatorRecord,
  readBoundWindowLocator,
  readWindowLocator,
  retireWindowLocator,
  type WindowLocatorRecord,
  writeWindowLocator,
} from "../../../src/capabilities/endpoint/locator-store.js";
import type { WakeflowHostId } from "../../../src/contracts/vocabulary/wakeflow-host-id.js";
import { renderDeterministicJsonDocument } from "../../../src/foundation/data/deterministic-json-document.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { claudeCodeTmuxWindowTransportPort } from "../../../src/hosts/claude-code/claude-code-window-transport-ports.js";
import { WakeflowError } from "../../../src/kernel/error.js";
import { useDisposableDurability } from "../../support/disposable-durability.js";

useDisposableDurability();

/**
 * 定位器存储（第 1 级，组件；能力卡 2.3，ADR-0025 D3）：tmux 与桌面两种 provider 的记录在一次性根目录上写入、
 * 读回与整体替换；私有定位器文件损坏、registeredAt 非法、hostId 与读取方不符、provider 未知或缺少该
 * provider 的对象时，读取一律以 invalid-request/locator-record 失败，locatorId 与内容不符以 locator-record-id
 * 失败，而不是让基础层错误以 unexpected 逃出。
 *
 * 存储本身不认传输（open-items L6）：位置是一段载荷，解析与代际标识的派生输入来自宿主交来的编解码器。
 * 这里用 Claude Code 的两份（tmux 与桌面）当夹具，并钉住落盘的字节与 1.3.0 逐字节相同——已有工作区里的
 * 记录必须原样读回。
 */

/** Claude Code 认得的两种定位载荷；两份端口带的是同一组。 */
const CODECS = claudeCodeTmuxWindowTransportPort.locatorCodecs;

const WINDOW_ID = "controller";
const DESKTOP_SESSION_ID = "local_0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";

function locator(hostId: WakeflowHostId): Readonly<WindowLocatorRecord> {
  return createWindowLocatorRecord(
    {
      programId: "program-1",
      hostId,
      windowId: WINDOW_ID,
      bindingId: "binding-1",
      target: {
        provider: "tmux",
        payload: { socketName: null, sessionName: "wakeflow", windowId: "@1", paneId: "%1" },
      },
      registeredAt: parseUtcInstant("2026-09-04T10:00:00.000Z"),
    },
    CODECS,
  );
}

function desktopLocator(
  hostId: WakeflowHostId,
  sessionId = DESKTOP_SESSION_ID,
): Readonly<WindowLocatorRecord> {
  return createWindowLocatorRecord(
    {
      programId: "program-1",
      hostId,
      windowId: WINDOW_ID,
      bindingId: "binding-1",
      target: { provider: "desktop", payload: { sessionId } },
      registeredAt: parseUtcInstant("2026-09-04T10:00:00.000Z"),
    },
    CODECS,
  );
}

/** 落盘的文档形状：身份字段、`provider`、以传输名为键的载荷、登记时刻。篡改用例从它出发。 */
function documentOf(record: Readonly<WindowLocatorRecord>): Record<string, unknown> {
  const { payload, registeredAt, ...identity } = record;
  return { ...identity, [record.provider]: payload, registeredAt };
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
  const ref = await writeWindowLocator(rooted, record, CODECS, undefined);
  return { rooted, file: path.join(root, ref) };
}

async function expectLocatorFailure(rooted: RootedDirectory, reason: string): Promise<void> {
  await rejects(
    readWindowLocator(rooted, "claude-code", WINDOW_ID, CODECS, undefined),
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
  const record = { ...documentOf(locator("claude-code")), registeredAt: "not-an-instant" };
  writeFileSync(file, renderDeterministicJsonDocument(record));
  await expectLocatorFailure(rooted, "locator-record");
});

test("定位器 hostId 与读取方不符时读取以 invalid-request/locator-record 失败", async (t) => {
  const { rooted, file } = await fixture(t);
  writeFileSync(file, renderDeterministicJsonDocument(documentOf(locator("codex"))));
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
    await readWindowLocator(rooted, "claude-code", WINDOW_ID, CODECS, undefined),
    locator("claude-code"),
  );
});

test("落盘的字节与 1.3.0 逐字节相同：三份记录（默认 socket、命名 socket、桌面会话）的全文与代际标识都钉成字面量（open-items L6）", async (t) => {
  // 字面量取自 1.3.0 制品里的实现对同样输入的输出：键序、缩进、载荷的字段顺序与派生出的 locatorId。
  const expected = (locatorId: string, provider: string, payload: readonly string[]) =>
    [
      "{",
      '  "kind": "WakeflowWindowLocator",',
      '  "schemaVersion": 1,',
      `  "locatorId": "${locatorId}",`,
      '  "programId": "program-1",',
      '  "hostId": "claude-code",',
      '  "windowId": "controller",',
      '  "bindingId": "binding-1",',
      `  "provider": "${provider}",`,
      `  "${provider}": {`,
      ...payload,
      "  },",
      '  "registeredAt": "2026-09-04T10:00:00.000Z"',
      "}",
      "",
    ].join("\n");
  const tmuxPayload = (socket: string) => [
    `    "socketName": ${socket},`,
    '    "sessionName": "wakeflow",',
    '    "windowId": "@1",',
    '    "paneId": "%1"',
  ];
  const first = await fixture(t);
  equal(
    readFileSync(first.file, "utf8"),
    expected("fb5d36ee-09d5-42a3-b03a-2eb2341d62e3", "tmux", tmuxPayload("null")),
  );
  const named = createWindowLocatorRecord(
    {
      programId: "program-1",
      hostId: "claude-code",
      windowId: WINDOW_ID,
      bindingId: "binding-1",
      target: {
        provider: "tmux",
        payload: { socketName: "wf", sessionName: "wakeflow", windowId: "@1", paneId: "%1" },
      },
      registeredAt: parseUtcInstant("2026-09-04T10:00:00.000Z"),
    },
    CODECS,
  );
  const second = await fixture(t, named);
  equal(
    readFileSync(second.file, "utf8"),
    expected("69245051-fe04-4188-adce-8af80ec22bc9", "tmux", tmuxPayload('"wf"')),
  );
  const third = await fixture(t, desktopLocator("claude-code"));
  equal(
    readFileSync(third.file, "utf8"),
    expected("4ccf4bb0-d377-4b8f-b336-44a2bffe2669", "desktop", [
      `    "sessionId": "${DESKTOP_SESSION_ID}"`,
    ]),
  );
  // 1.3.0 写下的那份字节读回来就是同一条记录。
  deepEqual(
    await readWindowLocator(third.rooted, "claude-code", WINDOW_ID, CODECS, undefined),
    desktopLocator("claude-code"),
  );
});

test("按当前绑定读定位器：绑定对得上才交回；记录不在或属于另一代绑定都是 null。退役之后也是 null", async (t) => {
  const { rooted } = await fixture(t, desktopLocator("claude-code"));
  const read = (bindingId: string) =>
    readBoundWindowLocator(rooted, "claude-code", WINDOW_ID, bindingId, CODECS, undefined);
  deepEqual(await read("binding-1"), desktopLocator("claude-code"));
  equal(await read("binding-2"), null);
  equal(
    await readBoundWindowLocator(rooted, "claude-code", "other", "binding-1", CODECS, undefined),
    null,
  );
  equal(await retireWindowLocator(rooted, "claude-code", WINDOW_ID, CODECS, undefined), "retired");
  equal(await retireWindowLocator(rooted, "claude-code", WINDOW_ID, CODECS, undefined), "absent");
  equal(await read("binding-1"), null);
});

test("宿主不认得记录里的传输时与损坏的记录同样处理：没有对应编解码器的读取以 invalid-request/locator-record 失败", async (t) => {
  const { rooted } = await fixture(t);
  await rejects(
    readWindowLocator(rooted, "claude-code", WINDOW_ID, [], undefined),
    (error: unknown) =>
      error instanceof WakeflowError &&
      `${error.code}/${error.reason}` === "invalid-request/locator-record",
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
  deepEqual(await readWindowLocator(rooted, "claude-code", WINDOW_ID, CODECS, undefined), record);
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
  await writeWindowLocator(rooted, desktopLocator("claude-code"), CODECS, undefined);
  const written = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  equal(written.provider, "desktop");
  equal("tmux" in written, false);
  deepEqual(
    await readWindowLocator(rooted, "claude-code", WINDOW_ID, CODECS, undefined),
    desktopLocator("claude-code"),
  );
});

test("provider 未知、桌面记录缺 desktop 对象或 sessionId、tmux 记录缺 tmux 对象时读取以 invalid-request/locator-record 失败", async (t) => {
  const { rooted, file } = await fixture(t);
  writeFileSync(
    file,
    renderDeterministicJsonDocument({
      ...documentOf(desktopLocator("claude-code")),
      provider: "sidebar",
    }),
  );
  await expectLocatorFailure(rooted, "locator-record");
  const { desktop: _desktop, ...withoutDesktop } = documentOf(desktopLocator("claude-code"));
  writeFileSync(file, renderDeterministicJsonDocument(withoutDesktop));
  await expectLocatorFailure(rooted, "locator-record");
  writeFileSync(
    file,
    renderDeterministicJsonDocument({ ...documentOf(desktopLocator("claude-code")), desktop: {} }),
  );
  await expectLocatorFailure(rooted, "locator-record");
  const { tmux: _tmux, ...withoutTmux } = documentOf(locator("claude-code"));
  writeFileSync(file, renderDeterministicJsonDocument(withoutTmux));
  await expectLocatorFailure(rooted, "locator-record");
});

test("locatorId 与记录内容不符时读取以 invalid-request/locator-record-id 失败（两种 provider）", async (t) => {
  const { rooted, file } = await fixture(t);
  writeFileSync(
    file,
    renderDeterministicJsonDocument({
      ...documentOf(desktopLocator("claude-code")),
      desktop: { sessionId: "local_1e1e1e1e-1e1e-4e1e-8e1e-1e1e1e1e1e1e" },
    }),
  );
  await expectLocatorFailure(rooted, "locator-record-id");
  writeFileSync(
    file,
    renderDeterministicJsonDocument({
      ...documentOf(locator("claude-code")),
      tmux: { socketName: null, sessionName: "wakeflow", windowId: "@2", paneId: "%2" },
    }),
  );
  await expectLocatorFailure(rooted, "locator-record-id");
});
