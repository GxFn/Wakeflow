import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";

import type {
  CreationObservation,
  LivenessObservation,
} from "../../../src/contracts/generated/entrypoints/wakeflow-window-host-binding-registration-request.generated.js";
import { classifyDesktopSessions } from "../../../src/hosts/claude-code/claude-code-desktop-session-classification.js";
import {
  classifyTmuxPanes,
  type TmuxLocator,
  type TmuxPaneObservation,
} from "../../../src/hosts/claude-code/claude-code-tmux-pane-classification.js";
import {
  claudeCodeDesktopSessionIdOf,
  claudeCodeDesktopWindowTransportPort,
  claudeCodeTmuxWindowTransportPort,
} from "../../../src/hosts/claude-code/claude-code-window-transport-ports.js";
import type {
  WakeflowWindowLivenessInput,
  WakeflowWindowLocator,
} from "../../../src/workspace/host-runtime/wakeflow-window-transport-port.js";

/**
 * 级别 0（纯逻辑）：Claude Code 两种窗口传输的端口（open-items L6；ADR-0025 D2、D3）。
 *
 * 执行端点切片只调用端口，所以"哪种传输要哪种定位子、定位载荷长什么样、一份存活观察说明了什么"都钉在
 * 这里：tmux 与桌面各一份，同形。两种传输的载荷编解码器两份端口都带着——工作区换过传输之后，上一种传输
 * 留下的记录仍然读得回，只是对当前传输不算数。文件末尾是两个分类器自己的固定顺序（原在 endpoint 的测试里）。
 */

const WINDOW = "window_55555555-5555-4555-8555-555555555555";
const BINDING = {
  bindingId: "window_binding_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  handleValue: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
};
const DESKTOP_SESSION_ID = "local_9a9a9a9a-9a9a-4a9a-8a9a-9a9a9a9a9a9a";
const TMUX = claudeCodeTmuxWindowTransportPort;
const DESKTOP = claudeCodeDesktopWindowTransportPort;

function creation(
  parts: Partial<Pick<CreationObservation, "tmux" | "desktop">>,
): CreationObservation {
  return {
    handle: { kind: "claude-session", value: BINDING.handleValue },
    launchIntentDigest: `sha256:${"1".repeat(64)}`,
    observedAt: "2026-11-16T00:00:00.000Z",
    ...parts,
  };
}

const COORDINATES = { socketName: null, sessionName: "wakeflow", windowId: "@3", paneId: "%7" };

function locator(provider: "tmux" | "desktop"): WakeflowWindowLocator {
  return {
    programId: "p",
    hostId: "claude-code",
    windowId: WINDOW,
    bindingId: BINDING.bindingId,
    locatorId: "loc-1",
    provider,
    payload: provider === "tmux" ? COORDINATES : { sessionId: DESKTOP_SESSION_ID },
  };
}

function pane(overrides: Partial<TmuxPaneObservation> = {}): TmuxPaneObservation {
  return {
    ...COORDINATES,
    paneWindowId: "@3",
    paneDead: false,
    currentCommand: "claude",
    options: {
      programId: "p",
      hostId: "claude-code",
      windowId: WINDOW,
      bindingId: BINDING.bindingId,
      locatorId: "loc-1",
    },
    ...overrides,
  };
}

function panes(...rows: TmuxPaneObservation[]): LivenessObservation {
  return { kind: "tmux-panes", panes: rows } as LivenessObservation;
}

function sessions(
  ...rows: {
    sessionId: string;
    desktopSessionId?: string;
    status: "busy" | "idle";
    archived?: boolean;
  }[]
): LivenessObservation {
  return { kind: "desktop-sessions", sessions: rows } as LivenessObservation;
}

function input(
  observation: LivenessObservation,
  overrides: Partial<WakeflowWindowLivenessInput> = {},
): WakeflowWindowLivenessInput {
  return { binding: BINDING, locator: locator("tmux"), observation, hosts: {}, ...overrides };
}

test("两份端口的身份：传输名、有定位子；tmux 可以 relocate，桌面没有可换的位置", () => {
  equal(TMUX.provider, "tmux");
  equal(TMUX.hasLocator, true);
  equal(TMUX.relocation, "supported");
  equal(DESKTOP.provider, "desktop");
  equal(DESKTOP.hasLocator, true);
  equal(DESKTOP.relocation, "not-applicable");
  // 两种传输的载荷两份端口都认得：换过传输的工作区里，上一种记录仍读得回。
  deepEqual(
    TMUX.locatorCodecs.map((codec) => codec.provider),
    ["tmux", "desktop"],
  );
  equal(DESKTOP.locatorCodecs, TMUX.locatorCodecs);
});

test("创建观察的定位子按传输二选一（ADR-0025 D3）：带了另一种的先报 locator-kind-mismatch 并指向多余的字段，再看本传输的在不在", () => {
  const tmux = { tmux: COORDINATES };
  const desktop = { desktop: { sessionId: DESKTOP_SESSION_ID } };
  equal(TMUX.admitCreationLocator(creation(tmux)), null);
  deepEqual(TMUX.admitCreationLocator(creation({})), {
    reason: "tmux-coordinates-required",
    path: "$request.observation.tmux",
  });
  deepEqual(TMUX.admitCreationLocator(creation({ ...tmux, ...desktop })), {
    reason: "locator-kind-mismatch",
    path: "$request.observation.desktop",
  });
  deepEqual(TMUX.admitCreationLocator(creation(desktop)), {
    reason: "locator-kind-mismatch",
    path: "$request.observation.desktop",
  });
  equal(DESKTOP.admitCreationLocator(creation(desktop)), null);
  deepEqual(DESKTOP.admitCreationLocator(creation({})), {
    reason: "desktop-session-required",
    path: "$request.observation.desktop",
  });
  deepEqual(DESKTOP.admitCreationLocator(creation({ ...tmux, ...desktop })), {
    reason: "locator-kind-mismatch",
    path: "$request.observation.tmux",
  });
  deepEqual(DESKTOP.admitCreationLocator(creation(tmux)), {
    reason: "locator-kind-mismatch",
    path: "$request.observation.tmux",
  });
});

test("定位从创建观察里取出：tmux 是四个坐标，桌面是会话 id；观察没带本传输的定位时为 null", () => {
  deepEqual(TMUX.locatorOf(creation({ tmux: { ...COORDINATES, socketName: "wf" } })), {
    provider: "tmux",
    payload: { socketName: "wf", sessionName: "wakeflow", windowId: "@3", paneId: "%7" },
  });
  equal(TMUX.locatorOf(creation({ desktop: { sessionId: DESKTOP_SESSION_ID } })), null);
  deepEqual(DESKTOP.locatorOf(creation({ desktop: { sessionId: DESKTOP_SESSION_ID } })), {
    provider: "desktop",
    payload: { sessionId: DESKTOP_SESSION_ID },
  });
  equal(DESKTOP.locatorOf(creation({ tmux: COORDINATES })), null);
});

test("定位载荷的编解码：形状不对时按字段路径报；代际标识的派生输入与 1.3.0 相同（旧记录靠它读回）", () => {
  const [tmuxCodec, desktopCodec] = TMUX.locatorCodecs;
  if (tmuxCodec === undefined || desktopCodec === undefined) throw new Error("codecs");
  class Invalid extends Error {}
  const invalid = (path: string): never => {
    throw new Invalid(path);
  };
  deepEqual(tmuxCodec.parsePayload({ ...COORDINATES, extra: 1 }, invalid), COORDINATES);
  deepEqual(Object.keys(tmuxCodec.parsePayload(COORDINATES, invalid)), [
    "socketName",
    "sessionName",
    "windowId",
    "paneId",
  ]);
  for (const [value, path] of [
    [null, "$locator"],
    [[], "$locator"],
    [{ ...COORDINATES, socketName: "" }, "$locator.tmux.socketName"],
    [{ ...COORDINATES, sessionName: 1 }, "$locator.tmux.sessionName"],
    [{ ...COORDINATES, windowId: "" }, "$locator.tmux.windowId"],
    [{ ...COORDINATES, paneId: "x".repeat(257) }, "$locator.tmux.paneId"],
  ] as const) {
    throws(
      () => tmuxCodec.parsePayload(value, invalid),
      (error: unknown) => error instanceof Invalid && error.message === path,
      path,
    );
  }
  deepEqual(desktopCodec.parsePayload({ sessionId: DESKTOP_SESSION_ID }, invalid), {
    sessionId: DESKTOP_SESSION_ID,
  });
  throws(
    () => desktopCodec.parsePayload({ sessionId: "" }, invalid),
    (error: unknown) => error instanceof Invalid && error.message === "$locator.desktop.sessionId",
  );
  throws(
    () => desktopCodec.parsePayload("local_x", invalid),
    (error: unknown) => error instanceof Invalid && error.message === "$locator",
  );
  // 派生输入：默认 socket 记成空串；顺序是 socket、session、window、pane。
  deepEqual(tmuxCodec.identitySeed(COORDINATES), {
    namespace: "wakeflow-window-locator",
    parts: ["", "wakeflow", "@3", "%7"],
  });
  deepEqual(tmuxCodec.identitySeed({ ...COORDINATES, socketName: "wf" }).parts, [
    "wf",
    "wakeflow",
    "@3",
    "%7",
  ]);
  deepEqual(desktopCodec.identitySeed({ sessionId: DESKTOP_SESSION_ID }), {
    namespace: "wakeflow-window-locator-desktop",
    parts: [DESKTOP_SESSION_ID],
  });
});

test("tmux 的存活结论：live 是还在，pane 没了或已死是不在了，其余状态什么也证明不了；配置的 socket 参与判定", () => {
  deepEqual(TMUX.classifyLiveness(input(panes(pane()))), {
    kind: "tmux-panes",
    status: "live",
    presence: "alive",
  });
  deepEqual(TMUX.classifyLiveness(input(panes())), {
    kind: "tmux-panes",
    status: "missing",
    presence: "absent",
  });
  deepEqual(TMUX.classifyLiveness(input(panes(pane({ paneDead: true })))), {
    kind: "tmux-panes",
    status: "pane-dead",
    presence: "absent",
  });
  for (const [row, status] of [
    [pane({ currentCommand: "zsh" }), "process-mismatch"],
    [pane({ paneWindowId: "@4" }), "pane-window-mismatch"],
  ] as const) {
    deepEqual(TMUX.classifyLiveness(input(panes(row))), {
      kind: "tmux-panes",
      status,
      presence: "unknown",
    });
  }
  // 定位器指向别的绑定、或配置换了 socket：对不上，什么也证明不了。
  equal(
    TMUX.classifyLiveness(
      input(panes(pane()), { binding: { ...BINDING, bindingId: "window_binding_other" } }),
    ).status,
    "binding-mismatch",
  );
  deepEqual(
    TMUX.classifyLiveness(
      input(panes(pane()), { hosts: { "claude-code": { tmux: { socketName: "wf" } } } }),
    ),
    { kind: "tmux-panes", status: "host-context-drift", presence: "unknown" },
  );
  equal(
    TMUX.classifyLiveness(input(panes(pane()), { hosts: { "claude-code": { tmux: {} } } })).status,
    "live",
    "no declared socket is the default socket",
  );
});

test("桌面的存活结论：在清单里（忙或闲）是还在，不在清单里是不在了；句柄或定位里的桌面 id 任一匹配都算", () => {
  const desktop = (observation: LivenessObservation) =>
    DESKTOP.classifyLiveness(input(observation, { locator: locator("desktop") }));
  deepEqual(desktop(sessions({ sessionId: BINDING.handleValue, status: "idle" })), {
    kind: "desktop-sessions",
    status: "present-idle",
    presence: "alive",
  });
  deepEqual(desktop(sessions({ sessionId: BINDING.handleValue, status: "busy" })), {
    kind: "desktop-sessions",
    status: "present-busy",
    presence: "alive",
  });
  // 界面建的会话：行里的会话 id 与句柄不同，只能按定位器记下的桌面 id 对上（X17）。
  equal(
    desktop(
      sessions({
        sessionId: "1e1e1e1e-1e1e-4e1e-8e1e-1e1e1e1e1e1e",
        desktopSessionId: DESKTOP_SESSION_ID,
        status: "idle",
      }),
    ).status,
    "present-idle",
  );
  deepEqual(desktop(sessions()), {
    kind: "desktop-sessions",
    status: "absent",
    presence: "absent",
  });
  equal(
    desktop(sessions({ sessionId: BINDING.handleValue, status: "idle", archived: true })).presence,
    "absent",
    "an archived row is not present",
  );
});

test("不是本传输的观察、另一种传输留下的定位、没有绑定：都什么也证明不了", () => {
  const nothing = (kind: string) => ({ kind, status: "no-locator", presence: "unknown" });
  const tmuxRows = panes(pane());
  const desktopRows = sessions({ sessionId: BINDING.handleValue, status: "idle" });
  const thread = { kind: "codex-thread", status: "archived" } as LivenessObservation;
  // 观察的种类不是本传输的。Codex 线程的状态对 Claude 的窗口不算证据——归档了也不说明这个窗口不在了。
  deepEqual(TMUX.classifyLiveness(input(desktopRows)), nothing("desktop-sessions"));
  deepEqual(TMUX.classifyLiveness(input(thread)), nothing("codex-thread"));
  deepEqual(
    DESKTOP.classifyLiveness(input(tmuxRows, { locator: locator("desktop") })),
    nothing("tmux-panes"),
  );
  deepEqual(
    DESKTOP.classifyLiveness(input(thread, { locator: locator("desktop") })),
    nothing("codex-thread"),
  );
  // 定位记录是另一种传输留下的（工作区换过传输）。
  deepEqual(
    TMUX.classifyLiveness(input(tmuxRows, { locator: locator("desktop") })),
    nothing("tmux-panes"),
  );
  deepEqual(
    DESKTOP.classifyLiveness(input(desktopRows, { locator: locator("tmux") })),
    nothing("desktop-sessions"),
  );
  // 没有定位记录，或没有绑定。
  deepEqual(TMUX.classifyLiveness(input(tmuxRows, { locator: null })), nothing("tmux-panes"));
  deepEqual(
    DESKTOP.classifyLiveness(input(desktopRows, { locator: locator("desktop"), binding: null })),
    nothing("desktop-sessions"),
  );
  // 没有观察就是没有观察。
  const unobserved = { kind: "unobserved" } as LivenessObservation;
  deepEqual(TMUX.classifyLiveness(input(unobserved)), { kind: "unobserved", presence: "unknown" });
  deepEqual(DESKTOP.classifyLiveness(input(unobserved)), {
    kind: "unobserved",
    presence: "unknown",
  });
});

test("定位记录里的桌面会话 id：只有桌面记录给得出", () => {
  equal(claudeCodeDesktopSessionIdOf(locator("desktop")), DESKTOP_SESSION_ID);
  equal(claudeCodeDesktopSessionIdOf(locator("tmux")), null);
  equal(claudeCodeDesktopSessionIdOf(null), null);
});

test("tmux pane 分类按固定顺序判定，只有 live 可派发", () => {
  const locator: TmuxLocator = {
    socketName: null,
    sessionName: "wakeflow",
    windowId: "@3",
    paneId: "%7",
    identity: {
      programId: "p",
      hostId: "claude-code",
      windowId: WINDOW,
      bindingId: BINDING.bindingId,
      locatorId: "loc-1",
    },
  };
  const pane = (overrides: Partial<TmuxPaneObservation> = {}): TmuxPaneObservation => ({
    socketName: null,
    sessionName: "wakeflow",
    windowId: "@3",
    paneId: "%7",
    paneWindowId: "@3",
    paneDead: false,
    currentCommand: "claude",
    options: {
      programId: "p",
      hostId: "claude-code",
      windowId: WINDOW,
      bindingId: BINDING.bindingId,
      locatorId: "loc-1",
    },
    ...overrides,
  });
  const expectation = { bindingId: BINDING.bindingId, socketName: null };
  equal(classifyTmuxPanes(locator, expectation, [pane()]), "live");
  equal(
    classifyTmuxPanes(locator, { ...expectation, bindingId: "other" }, [pane()]),
    "binding-mismatch",
  );
  equal(
    classifyTmuxPanes(locator, { ...expectation, socketName: "s" }, [pane()]),
    "host-context-drift",
  );
  equal(classifyTmuxPanes(locator, expectation, []), "missing");
  equal(classifyTmuxPanes(locator, expectation, [pane(), pane({ paneId: "%8" })]), "duplicate");
  equal(
    classifyTmuxPanes(locator, expectation, [
      pane({ paneId: "%8", options: { ...pane().options } }),
    ]),
    "coordinate-mismatch",
  );
  equal(
    classifyTmuxPanes(locator, expectation, [pane({ paneWindowId: "@4" })]),
    "pane-window-mismatch",
  );
  equal(classifyTmuxPanes(locator, expectation, [pane({ paneDead: true })]), "pane-dead");
  equal(
    classifyTmuxPanes(locator, expectation, [pane({ currentCommand: "zsh" })]),
    "process-mismatch",
  );
  equal(
    classifyTmuxPanes(locator, expectation, [
      pane({ options: { ...pane().options, locatorId: "loc-2", bindingId: BINDING.bindingId } }),
    ]),
    "metadata-mismatch",
  );
});

test("桌面会话清单分类：句柄在清单里按 busy / idle 分 present-busy / present-idle，不在即 absent；同 id 多行有一行 busy 即 busy；cwd、name、pid 不参与（ADR-0025 D3）", () => {
  const sessions = [
    {
      sessionId: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
      status: "idle" as const,
      cwd: "/somewhere/else",
      name: "Controller",
      pid: 4242,
    },
    { sessionId: "1e1e1e1e-1e1e-4e1e-8e1e-1e1e1e1e1e1e", status: "busy" as const },
  ];
  equal(
    classifyDesktopSessions(
      { sessionId: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f", desktopSessionId: null },
      sessions,
    ),
    "present-idle",
  );
  equal(
    classifyDesktopSessions(
      { sessionId: "1e1e1e1e-1e1e-4e1e-8e1e-1e1e1e1e1e1e", desktopSessionId: null },
      sessions,
    ),
    "present-busy",
  );
  equal(
    classifyDesktopSessions(
      { sessionId: "2d2d2d2d-2d2d-4d2d-8d2d-2d2d2d2d2d2d", desktopSessionId: null },
      sessions,
    ),
    "absent",
  );
  equal(
    classifyDesktopSessions(
      { sessionId: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f", desktopSessionId: null },
      [],
    ),
    "absent",
  );
  equal(
    classifyDesktopSessions(
      { sessionId: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f", desktopSessionId: null },
      [...sessions, { sessionId: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f", status: "busy" }],
    ),
    "present-busy",
  );
  // 桌面 id（local_ 前缀）不是句柄：清单里只有原始会话 id 才算匹配。
  equal(
    classifyDesktopSessions(
      { sessionId: "local_0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f", desktopSessionId: null },
      sessions,
    ),
    "absent",
  );
});
