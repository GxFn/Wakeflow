import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import type {
  CreationObservation,
  LivenessObservation,
} from "../../../src/contracts/generated/entrypoints/wakeflow-window-host-binding-registration-request.generated.js";
import { codexWindowTransportPort } from "../../../src/hosts/codex/codex-window-transport-port.js";

/**
 * 级别 0（纯逻辑）：Codex 项目聊天的窗口传输端口（open-items L6）。
 *
 * 线程没有定位子：创建观察里的两种定位都不看，没有定位载荷，也没有可 relocate 的位置。存活只认线程状态
 * 这一种观察；别的宿主的观察什么也证明不了。
 */

const PORT = codexWindowTransportPort;
const BINDING = {
  bindingId: "window_binding_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  handleValue: "t",
};

function classify(observation: unknown) {
  return PORT.classifyLiveness({
    binding: BINDING,
    locator: null,
    observation: observation as LivenessObservation,
    hosts: {},
  });
}

test("没有定位子：创建观察的两种定位都不看，取不出定位，没有载荷编解码器，relocate 不可用", () => {
  equal(PORT.provider, "none");
  equal(PORT.hasLocator, false);
  equal(PORT.relocation, "unavailable");
  deepEqual(PORT.locatorCodecs, []);
  const observation = {
    handle: { kind: "codex-thread", value: "t" },
    launchIntentDigest: `sha256:${"1".repeat(64)}`,
    observedAt: "2026-11-16T00:00:00.000Z",
    tmux: { socketName: null, sessionName: "wakeflow", windowId: "@1", paneId: "%1" },
    desktop: { sessionId: "local_x" },
  } as CreationObservation;
  equal(PORT.admitCreationLocator(observation), null);
  equal(PORT.locatorOf(observation), null);
});

test("存活只认线程状态：active 是还在，archived 是不在了，unknown 什么也证明不了；别的观察同样证明不了", () => {
  deepEqual(classify({ kind: "codex-thread", status: "active" }), {
    kind: "codex-thread",
    status: "active",
    presence: "alive",
  });
  deepEqual(classify({ kind: "codex-thread", status: "archived" }), {
    kind: "codex-thread",
    status: "archived",
    presence: "absent",
  });
  deepEqual(classify({ kind: "codex-thread", status: "unknown" }), {
    kind: "codex-thread",
    status: "unknown",
    presence: "unknown",
  });
  deepEqual(classify({ kind: "tmux-panes", panes: [] }), {
    kind: "tmux-panes",
    status: "no-locator",
    presence: "unknown",
  });
  deepEqual(classify({ kind: "desktop-sessions", sessions: [] }), {
    kind: "desktop-sessions",
    status: "no-locator",
    presence: "unknown",
  });
  deepEqual(classify({ kind: "unobserved" }), { kind: "unobserved", presence: "unknown" });
});
