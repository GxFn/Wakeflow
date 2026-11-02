import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  decideEndpointCommand,
  type EndpointCommand,
  type EndpointState,
  rejectForeignHandleOwner,
} from "../../../src/capabilities/endpoint/decide.js";
import { classifyDesktopSessions } from "../../../src/capabilities/endpoint/desktop-session-classification.js";
import {
  classifyTmuxPanes,
  type TmuxLocator,
  type TmuxPaneObservation,
} from "../../../src/capabilities/endpoint/pane-classification.js";

/**
 * 端点纯决定（第 0 级，纯逻辑；能力卡 2 §2.2–2.4，open-items W1 与 W4，ADR-0025 D3）：register / replace /
 * relocate / decommission / release-claim 在给定端点状态下的结局，跨窗口句柄唯一性的单一判据，定位子按传输
 * 二选一的准入，tmux pane 与桌面会话清单两种分类的固定顺序。状态由服务层加载后交进来，这里不读文件、不看时钟。
 */

const WINDOW = "window_55555555-5555-4555-8555-555555555555";
const OTHER_WINDOW = "window_66666666-6666-4666-8666-666666666666";
const INTENT = `sha256:${"1".repeat(64)}`;
const BINDING = {
  bindingId: "window_binding_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  bindingDigest: `sha256:${"b".repeat(64)}`,
  handleValue: "session-a",
  launchIntentDigest: INTENT,
};

function state(overrides: Partial<EndpointState> = {}): EndpointState {
  return {
    windowKnown: true,
    launchIntentDigest: INTENT,
    locatorProvider: "none",
    worktreeRequired: false,
    binding: null,
    claim: null,
    handleOwners: new Map(),
    startedSessions: new Set(["session-a", "session-b"]),
    endedSessions: new Set(),
    ...overrides,
  };
}

const register = (
  handleValue: string,
  hasTmuxCoordinates = false,
  hasWorktreeObservation = false,
  hasDesktopSession = false,
): EndpointCommand => ({
  operation: "register",
  observation: {
    handleValue,
    launchIntentDigest: INTENT,
    hasTmuxCoordinates,
    hasDesktopSession,
    hasWorktreeObservation,
  },
});

test("register：无绑定登记、同句柄重放、异句柄冲突、意图漂移与缺 hook 证据拒绝", () => {
  deepEqual(decideEndpointCommand(WINDOW, state(), register("session-a")), {
    accepted: true,
    operation: "register",
    disposition: "registered",
  });
  deepEqual(decideEndpointCommand(WINDOW, state({ binding: BINDING }), register("session-a")), {
    accepted: true,
    operation: "register",
    disposition: "replayed",
  });
  const conflicting = decideEndpointCommand(
    WINDOW,
    state({ binding: BINDING }),
    register("session-b"),
  );
  equal(conflicting.accepted === false && conflicting.reason, "handle-conflict");
  const drift = decideEndpointCommand(WINDOW, state(), {
    operation: "register",
    observation: {
      handleValue: "session-a",
      launchIntentDigest: `sha256:${"9".repeat(64)}`,
      hasTmuxCoordinates: false,
      hasDesktopSession: false,
      hasWorktreeObservation: false,
    },
  });
  equal(drift.accepted === false && drift.reason, "launch-intent-drift");
  const noHook = decideEndpointCommand(WINDOW, state(), register("session-unseen"));
  equal(noHook.accepted === false && noHook.reason, "hook-evidence-missing");
  const elsewhere = decideEndpointCommand(
    WINDOW,
    state({
      handleOwners: new Map([["session-a", OTHER_WINDOW]]),
    }),
    register("session-a"),
  );
  equal(elsewhere.accepted === false && elsewhere.reason, "handle-conflict");
  const tmuxRequired = decideEndpointCommand(
    WINDOW,
    state({ locatorProvider: "tmux" }),
    register("session-a"),
  );
  equal(tmuxRequired.accepted === false && tmuxRequired.reason, "tmux-coordinates-required");
  equal(
    decideEndpointCommand(WINDOW, state({ locatorProvider: "tmux" }), register("session-a", true))
      .accepted,
    true,
  );
  const unknown = decideEndpointCommand(
    WINDOW,
    state({ windowKnown: false }),
    register("session-a"),
  );
  equal(unknown.accepted === false && unknown.code, "not-found");
});

test("定位子按传输二选一（ADR-0025 D3）：desktop 缺会话 id 报 desktop-session-required，带 tmux 坐标报 locator-kind-mismatch 指向 tmux；tmux 带桌面 id 报 locator-kind-mismatch 指向 desktop；没有定位子的宿主两者都不看", () => {
  const desktop = state({ locatorProvider: "desktop" });
  deepEqual(decideEndpointCommand(WINDOW, desktop, register("session-a", false, false, true)), {
    accepted: true,
    operation: "register",
    disposition: "registered",
  });
  deepEqual(decideEndpointCommand(WINDOW, desktop, register("session-a")), {
    accepted: false,
    code: "invalid-request",
    reason: "desktop-session-required",
    path: "$request.observation.desktop",
  });
  deepEqual(decideEndpointCommand(WINDOW, desktop, register("session-a", true, false, true)), {
    accepted: false,
    code: "invalid-request",
    reason: "locator-kind-mismatch",
    path: "$request.observation.tmux",
  });
  // 只带了别的传输的定位子：先点名多余的那个字段，而不是先要缺的那个。
  const tmuxOnly = decideEndpointCommand(WINDOW, desktop, register("session-a", true));
  equal(tmuxOnly.accepted === false && tmuxOnly.reason, "locator-kind-mismatch");
  deepEqual(
    decideEndpointCommand(
      WINDOW,
      state({ locatorProvider: "tmux" }),
      register("session-a", true, false, true),
    ),
    {
      accepted: false,
      code: "invalid-request",
      reason: "locator-kind-mismatch",
      path: "$request.observation.desktop",
    },
  );
  const desktopOnlyOnTmux = decideEndpointCommand(
    WINDOW,
    state({ locatorProvider: "tmux" }),
    register("session-a", false, false, true),
  );
  equal(desktopOnlyOnTmux.accepted === false && desktopOnlyOnTmux.reason, "locator-kind-mismatch");
  equal(
    decideEndpointCommand(WINDOW, state(), register("session-a", true, false, true)).accepted,
    true,
    "a host without a locator ignores both locators",
  );
  // 定位子准入在意图核对之后、worktree 与 hook 证据之前：缺桌面 id 的 replace 也在这里被拒。
  const replaceMissing = decideEndpointCommand(
    WINDOW,
    { ...desktop, binding: BINDING },
    {
      operation: "replace",
      observation: {
        handleValue: "session-b",
        launchIntentDigest: INTENT,
        hasTmuxCoordinates: false,
        hasDesktopSession: false,
        hasWorktreeObservation: false,
      },
      expectedBindingId: BINDING.bindingId,
      expectedBindingDigest: BINDING.bindingDigest,
    },
  );
  equal(replaceMissing.accepted === false && replaceMissing.reason, "desktop-session-required");
  const worktreeMissing = decideEndpointCommand(
    WINDOW,
    { ...desktop, worktreeRequired: true },
    register("session-a", false, false, true),
  );
  equal(worktreeMissing.accepted === false && worktreeMissing.reason, "worktree-receipt-required");
});

test("跨窗口句柄唯一性：别的窗口已持有即 handle-conflict，自己持有或无人持有都放行——锁外路由与锁内复验共用这一条判据（open-items W1）", () => {
  const owners = new Map([
    ["session-a", WINDOW],
    ["session-b", OTHER_WINDOW],
  ]);
  equal(rejectForeignHandleOwner(owners, "session-a", WINDOW), null);
  equal(rejectForeignHandleOwner(owners, "session-c", WINDOW), null);
  deepEqual(rejectForeignHandleOwner(owners, "session-b", WINDOW), {
    accepted: false,
    code: "precondition-failed",
    reason: "handle-conflict",
    path: "$request.observation.handle",
  });
});

test("replace：CAS 旧绑定、拒绝持有声明与未变句柄，接受新句柄", () => {
  const replace = (handleValue: string, digest = BINDING.bindingDigest): EndpointCommand => ({
    operation: "replace",
    observation: {
      handleValue,
      launchIntentDigest: INTENT,
      hasTmuxCoordinates: false,
      hasDesktopSession: false,
      hasWorktreeObservation: false,
    },
    expectedBindingId: BINDING.bindingId,
    expectedBindingDigest: digest,
  });
  deepEqual(decideEndpointCommand(WINDOW, state({ binding: BINDING }), replace("session-b")), {
    accepted: true,
    operation: "replace",
    disposition: "replaced",
  });
  const drift = decideEndpointCommand(
    WINDOW,
    state({ binding: BINDING }),
    replace("session-b", `sha256:${"0".repeat(64)}`),
  );
  equal(drift.accepted === false && drift.reason, "binding-drift");
  const absent = decideEndpointCommand(WINDOW, state(), replace("session-b"));
  equal(absent.accepted === false && absent.code, "not-found");
  const held = decideEndpointCommand(
    WINDOW,
    state({ binding: BINDING, claim: { claimId: "c", claimDigest: "sha256:x", expired: false } }),
    replace("session-b"),
  );
  equal(held.accepted === false && held.reason, "claim-held");
  const unchanged = decideEndpointCommand(
    WINDOW,
    state({ binding: BINDING }),
    replace("session-a"),
  );
  equal(unchanged.accepted === false && unchanged.reason, "handle-unchanged");
});

test("relocate：同句柄换 pane，绑定 CAS，只有 tmux 定位器宿主，持有的声明不阻塞（§13.125）", () => {
  const relocate = (handleValue: string, digest = BINDING.bindingDigest): EndpointCommand => ({
    operation: "relocate",
    observation: {
      handleValue,
      launchIntentDigest: INTENT,
      hasTmuxCoordinates: true,
      hasDesktopSession: false,
      hasWorktreeObservation: false,
    },
    expectedBindingId: BINDING.bindingId,
    expectedBindingDigest: digest,
  });
  const tmuxState = (overrides: Partial<EndpointState> = {}) =>
    state({ binding: BINDING, locatorProvider: "tmux", ...overrides });
  deepEqual(decideEndpointCommand(WINDOW, tmuxState(), relocate("session-a")), {
    accepted: true,
    operation: "relocate",
    disposition: "relocated",
  });
  const held = decideEndpointCommand(
    WINDOW,
    tmuxState({ claim: { claimId: "c", claimDigest: "sha256:x", expired: false } }),
    relocate("session-a"),
  );
  equal(held.accepted, true, "a held claim keeps working in the same session");
  const changed = decideEndpointCommand(WINDOW, tmuxState(), relocate("session-b"));
  equal(changed.accepted === false && changed.reason, "handle-changed");
  const codex = decideEndpointCommand(WINDOW, state({ binding: BINDING }), relocate("session-a"));
  equal(codex.accepted === false && codex.reason, "locator-provider");
  const drift = decideEndpointCommand(
    WINDOW,
    tmuxState(),
    relocate("session-a", `sha256:${"0".repeat(64)}`),
  );
  equal(drift.accepted === false && drift.reason, "binding-drift");
  const noCoordinates = decideEndpointCommand(WINDOW, tmuxState(), {
    operation: "relocate",
    observation: {
      handleValue: "session-a",
      launchIntentDigest: INTENT,
      hasTmuxCoordinates: false,
      hasDesktopSession: false,
      hasWorktreeObservation: false,
    },
    expectedBindingId: BINDING.bindingId,
    expectedBindingDigest: BINDING.bindingDigest,
  });
  equal(noCoordinates.accepted === false && noCoordinates.reason, "tmux-coordinates-required");
  const absent = decideEndpointCommand(
    WINDOW,
    state({ locatorProvider: "tmux" }),
    relocate("session-a"),
  );
  equal(absent.accepted === false && absent.code, "not-found");
});

test("relocate 在桌面传输下不适用：relocate-not-applicable——桌面会话发消息即续、没有可换的坐标；绑定期望仍先核对（ADR-0025 D3）", () => {
  const desktopState = state({ binding: BINDING, locatorProvider: "desktop" });
  const relocate: EndpointCommand = {
    operation: "relocate",
    observation: {
      handleValue: "session-a",
      launchIntentDigest: INTENT,
      hasTmuxCoordinates: false,
      hasDesktopSession: true,
      hasWorktreeObservation: false,
    },
    expectedBindingId: BINDING.bindingId,
    expectedBindingDigest: BINDING.bindingDigest,
  };
  deepEqual(decideEndpointCommand(WINDOW, desktopState, relocate), {
    accepted: false,
    code: "precondition-failed",
    reason: "relocate-not-applicable",
    path: "$request.operation",
  });
  const drift = decideEndpointCommand(WINDOW, desktopState, {
    ...relocate,
    expectedBindingDigest: `sha256:${"0".repeat(64)}`,
  });
  equal(drift.accepted === false && drift.reason, "binding-drift");
  const absent = decideEndpointCommand(WINDOW, state({ locatorProvider: "desktop" }), relocate);
  equal(absent.accepted === false && absent.code, "not-found");
});

test("decommission：证据分级，声明持有与关闭失败拒绝", () => {
  const base = {
    operation: "decommission" as const,
    expectedBindingId: BINDING.bindingId,
    expectedBindingDigest: BINDING.bindingDigest,
  };
  const claudeState = state({
    binding: BINDING,
    locatorProvider: "tmux",
    endedSessions: new Set(["session-a"]),
  });
  deepEqual(
    decideEndpointCommand(WINDOW, claudeState, {
      ...base,
      preClose: { kind: "tmux-panes", status: "live" },
      closeResult: "closed",
      postClose: { kind: "tmux-panes", status: "missing" },
    }),
    {
      accepted: true,
      operation: "decommission",
      disposition: "decommissioned",
      verification: "machine-verified",
    },
  );
  const noSessionEnd = decideEndpointCommand(
    WINDOW,
    state({ binding: BINDING, locatorProvider: "tmux" }),
    {
      ...base,
      preClose: { kind: "tmux-panes", status: "live" },
      closeResult: "closed",
      postClose: { kind: "tmux-panes", status: "missing" },
    },
  );
  equal(
    noSessionEnd.accepted && noSessionEnd.operation === "decommission" && noSessionEnd.verification,
    "manual-host-gate",
  );
  const codex = decideEndpointCommand(
    WINDOW,
    state({ binding: BINDING, endedSessions: new Set(["session-a"]) }),
    {
      ...base,
      preClose: { kind: "codex-thread", status: "active" },
      closeResult: "closed",
      postClose: { kind: "codex-thread", status: "archived" },
    },
  );
  equal(
    codex.accepted && codex.operation === "decommission" && codex.verification,
    "manual-host-gate",
  );
  const stillAlive = decideEndpointCommand(WINDOW, claudeState, {
    ...base,
    preClose: { kind: "tmux-panes", status: "live" },
    closeResult: "closed",
    postClose: { kind: "tmux-panes", status: "live" },
  });
  equal(stillAlive.accepted === false && stillAlive.reason, "closure-blocked");
  const failed = decideEndpointCommand(WINDOW, claudeState, {
    ...base,
    preClose: { kind: "unobserved" },
    closeResult: "failed",
    postClose: { kind: "unobserved" },
  });
  equal(failed.accepted === false && failed.reason, "closure-blocked");
  const held = decideEndpointCommand(
    WINDOW,
    state({ binding: BINDING, claim: { claimId: "c", claimDigest: "sha256:x", expired: true } }),
    {
      ...base,
      preClose: { kind: "unobserved" },
      closeResult: "closed",
      postClose: { kind: "unobserved" },
    },
  );
  equal(held.accepted === false && held.reason, "claim-held");
});

test("desktop-sessions 存活证据：present-* 阻塞关闭，absent 可关闭并与 session-end 一起机器核实，no-locator 既不算活也不算缺席（ADR-0025 D3）", () => {
  const base = {
    operation: "decommission" as const,
    expectedBindingId: BINDING.bindingId,
    expectedBindingDigest: BINDING.bindingDigest,
  };
  const ended = state({
    binding: BINDING,
    locatorProvider: "desktop",
    endedSessions: new Set(["session-a"]),
  });
  const verification = (
    current: EndpointState,
    preClose: Extract<EndpointCommand, { operation: "decommission" }>["preClose"],
    postClose: Extract<EndpointCommand, { operation: "decommission" }>["postClose"],
  ) => {
    const decision = decideEndpointCommand(WINDOW, current, {
      ...base,
      preClose,
      closeResult: "closed",
      postClose,
    });
    return decision.accepted && decision.operation === "decommission"
      ? decision.verification
      : `${decision.accepted === false && decision.reason}`;
  };
  equal(
    verification(
      ended,
      { kind: "desktop-sessions", status: "present-idle" },
      { kind: "desktop-sessions", status: "absent" },
    ),
    "machine-verified",
  );
  equal(
    verification(
      ended,
      { kind: "desktop-sessions", status: "absent" },
      { kind: "desktop-sessions", status: "absent" },
    ),
    "machine-verified",
    "a session already gone before the archive still closes with machine evidence",
  );
  equal(
    verification(
      state({ binding: BINDING, locatorProvider: "desktop" }),
      { kind: "desktop-sessions", status: "present-busy" },
      { kind: "desktop-sessions", status: "absent" },
    ),
    "manual-host-gate",
    "no session-end record yet",
  );
  equal(
    verification(
      ended,
      { kind: "desktop-sessions", status: "present-idle" },
      { kind: "desktop-sessions", status: "no-locator" },
    ),
    "manual-host-gate",
    "a list that cannot be matched against a locator proves nothing",
  );
  equal(
    verification(
      ended,
      { kind: "desktop-sessions", status: "present-idle" },
      { kind: "desktop-sessions", status: "present-busy" },
    ),
    "closure-blocked",
  );
  equal(
    verification(
      ended,
      { kind: "desktop-sessions", status: "present-idle" },
      { kind: "desktop-sessions", status: "present-idle" },
    ),
    "closure-blocked",
  );
  const claim = { claimId: "c", claimDigest: `sha256:${"c".repeat(64)}`, expired: false };
  const release = (
    liveness: Extract<EndpointCommand, { operation: "release-claim" }>["liveness"],
  ) =>
    decideEndpointCommand(WINDOW, state({ binding: BINDING, locatorProvider: "desktop", claim }), {
      operation: "release-claim",
      expectedClaimDigest: claim.claimDigest,
      liveness,
    });
  const active = release({ kind: "desktop-sessions", status: "present-idle" });
  equal(active.accepted === false && active.reason, "claim-active");
  const unmatched = release({ kind: "desktop-sessions", status: "no-locator" });
  equal(unmatched.accepted === false && unmatched.reason, "claim-active");
  equal(release({ kind: "desktop-sessions", status: "absent" }).accepted, true);
});

test("release-claim：只在过期、持有会话已结束或端点缺席时释放", () => {
  const claim = { claimId: "c", claimDigest: `sha256:${"c".repeat(64)}`, expired: false };
  const release = (
    liveness: Extract<EndpointCommand, { operation: "release-claim" }>["liveness"],
  ): EndpointCommand => ({
    operation: "release-claim",
    expectedClaimDigest: claim.claimDigest,
    liveness,
  });
  const active = decideEndpointCommand(
    WINDOW,
    state({ binding: BINDING, claim }),
    release({ kind: "tmux-panes", status: "live" }),
  );
  equal(active.accepted === false && active.reason, "claim-active");
  // 持有会话没有算作已结束（例如 end 之后又 resume 出新的 start）、声明未过期、端点未观察：仍是 claim-active（W4）。
  const resumed = decideEndpointCommand(
    WINDOW,
    state({ binding: BINDING, claim }),
    release({ kind: "unobserved" }),
  );
  equal(resumed.accepted === false && resumed.reason, "claim-active");
  deepEqual(
    decideEndpointCommand(
      WINDOW,
      state({ binding: BINDING, claim: { ...claim, expired: true } }),
      release({ kind: "unobserved" }),
    ),
    { accepted: true, operation: "release-claim", disposition: "claim-released" },
  );
  equal(
    decideEndpointCommand(
      WINDOW,
      state({ binding: BINDING, claim, endedSessions: new Set(["session-a"]) }),
      release({ kind: "unobserved" }),
    ).accepted,
    true,
  );
  equal(
    decideEndpointCommand(
      WINDOW,
      state({ binding: BINDING, claim }),
      release({ kind: "tmux-panes", status: "pane-dead" }),
    ).accepted,
    true,
  );
  const drift = decideEndpointCommand(WINDOW, state({ binding: BINDING, claim }), {
    operation: "release-claim",
    expectedClaimDigest: `sha256:${"d".repeat(64)}`,
    liveness: { kind: "unobserved" },
  });
  equal(drift.accepted === false && drift.reason, "claim-drift");
  const none = decideEndpointCommand(
    WINDOW,
    state({ binding: BINDING }),
    release({ kind: "unobserved" }),
  );
  equal(none.accepted === false && none.code, "not-found");
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
