import { equal } from "node:assert/strict";
import { test } from "node:test";

import {
  classifyDesktopSessions,
  type DesktopSessionObservation,
} from "../../../src/capabilities/endpoint/desktop-session-classification.js";

/**
 * 桌面会话分类（第 0 级，纯逻辑；ADR-0025 D3，open-items X17）：行取自桌面的 `list_sessions`，会话在侧栏里
 * （未归档）就在场——进程空闲退出（`isRunning: false`，映射为 idle）不再被判 absent；按句柄或定位器的桌面 id
 * 匹配，界面建的会话两者不同也能对上；归档行不算在场。
 */

const HELPER_SESSION = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
const UI_HANDLE = "1e1e1e1e-1e1e-4e1e-8e1e-1e1e1e1e1e1e";
const UI_DESKTOP_UUID = "2d2d2d2d-2d2d-4d2d-8d2d-2d2d2d2d2d2d";

/** 一行 `list_sessions` 按合同映射：去前缀的 UUID、原样的桌面 id、isRunning → busy、isArchived → archived。 */
function row(
  uuid: string,
  isRunning: boolean,
  isArchived = false,
): Readonly<DesktopSessionObservation> {
  return {
    sessionId: uuid,
    desktopSessionId: `local_${uuid}`,
    status: isRunning ? "busy" : "idle",
    archived: isArchived,
    cwd: "/workspace/Alembic",
    name: "Alembic",
  };
}

test("list_sessions 的行：进程已结束但仍在侧栏的会话是 present-idle，运行中是 present-busy，没有行或只有归档行是 absent", () => {
  const helper = { sessionId: HELPER_SESSION, desktopSessionId: `local_${HELPER_SESSION}` };
  equal(classifyDesktopSessions(helper, [row(HELPER_SESSION, false)]), "present-idle");
  equal(classifyDesktopSessions(helper, [row(HELPER_SESSION, true)]), "present-busy");
  equal(classifyDesktopSessions(helper, [row(HELPER_SESSION, false, true)]), "absent");
  equal(classifyDesktopSessions(helper, [row(UI_DESKTOP_UUID, true)]), "absent");
  equal(classifyDesktopSessions(helper, []), "absent");
  // 助手的 sessions（进程视图）没有桌面 id 与归档位：按句柄匹配，缺省即未归档。
  equal(
    classifyDesktopSessions(helper, [{ sessionId: HELPER_SESSION, status: "busy" }]),
    "present-busy",
  );
});

test("界面建的会话（Controller 自己）句柄与桌面 id 不同：只按定位器的桌面 id 对上；没有定位器的桌面 id 时对不上", () => {
  const rows = [row(UI_DESKTOP_UUID, false)];
  equal(
    classifyDesktopSessions(
      { sessionId: UI_HANDLE, desktopSessionId: `local_${UI_DESKTOP_UUID}` },
      rows,
    ),
    "present-idle",
  );
  equal(classifyDesktopSessions({ sessionId: UI_HANDLE, desktopSessionId: null }, rows), "absent");
  equal(
    classifyDesktopSessions(
      { sessionId: UI_HANDLE, desktopSessionId: `local_${UI_DESKTOP_UUID}` },
      [row(UI_DESKTOP_UUID, false, true)],
    ),
    "absent",
  );
});
