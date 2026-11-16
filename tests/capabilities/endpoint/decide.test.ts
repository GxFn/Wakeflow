import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  type ClosureLiveness,
  decideEndpointCommand,
  type EndpointCommand,
  type EndpointDecision,
  type EndpointState,
  rejectForeignHandleOwner,
} from "../../../src/capabilities/endpoint/decide.js";
import type { CreationObservation } from "../../../src/contracts/generated/entrypoints/wakeflow-window-host-binding-registration-request.generated.js";
import {
  claudeCodeDesktopWindowTransportPort,
  claudeCodeTmuxWindowTransportPort,
} from "../../../src/hosts/claude-code/claude-code-window-transport-ports.js";
import { codexWindowTransportPort } from "../../../src/hosts/codex/codex-window-transport-port.js";
import type { WakeflowWindowTransportPort } from "../../../src/workspace/host-runtime/wakeflow-window-transport-port.js";

/**
 * 端点纯决定（第 0 级，纯逻辑；能力卡 2 §2.2–2.4，open-items W1 与 W4，ADR-0025 D3）：register / replace /
 * relocate / decommission / release-claim 在给定端点状态下的结局，跨窗口句柄唯一性的单一判据，定位子按传输
 * 二选一的准入。状态由服务层加载后交进来，这里不读文件、不看时钟。
 *
 * 决定本身不认传输（open-items L6）：定位子的准入结论、存活观察的结论与能否 relocate 都是窗口传输端口
 * 算好的值。这里的用例仍按"哪一种传输"来写——状态与命令经下面的小适配层由三份真实端口算出来，再交给
 * `decideEndpointCommand`；端口各自的分类与载荷在 `tests/hosts` 里另测。
 */

type Provider = "tmux" | "desktop" | "none";

const PORTS: Readonly<Record<Provider, Readonly<WakeflowWindowTransportPort>>> = Object.freeze({
  tmux: claudeCodeTmuxWindowTransportPort,
  desktop: claudeCodeDesktopWindowTransportPort,
  none: codexWindowTransportPort,
});

/** 用例里的状态：用"定位子提供者"选端口，其余字段与 `EndpointState` 相同。 */
interface TestState extends Omit<EndpointState, "hasLocator" | "relocation"> {
  readonly locatorProvider: Provider;
}

/** 用例里的创建观察：带没带两种定位子，由端口判准入。 */
interface TestObservation {
  readonly handleValue: string;
  readonly launchIntentDigest: string;
  readonly hasTmuxCoordinates: boolean;
  readonly hasDesktopSession: boolean;
  readonly hasWorktreeObservation: boolean;
}

/** 用例里的存活结论：种类与传输自己的状态词；`presence` 由下面的对照表补上。 */
type TestLiveness =
  | Readonly<{
      readonly kind: "tmux-panes" | "desktop-sessions" | "codex-thread";
      readonly status: string;
    }>
  | Readonly<{ readonly kind: "unobserved" }>;

type TestCommand =
  | Readonly<{ readonly operation: "register"; readonly observation: TestObservation }>
  | Readonly<{
      readonly operation: "replace" | "relocate";
      readonly observation: TestObservation;
      readonly expectedBindingId: string;
      readonly expectedBindingDigest: string;
    }>
  | Readonly<{
      readonly operation: "decommission";
      readonly expectedBindingId: string;
      readonly expectedBindingDigest: string;
      readonly preClose: TestLiveness;
      readonly closeResult: "closed" | "failed" | "unknown";
      readonly postClose: TestLiveness;
    }>
  | Readonly<{
      readonly operation: "release-claim";
      readonly expectedClaimDigest: string;
      readonly liveness: TestLiveness;
    }>;

/** 三种传输各自"确定还在"与"确定不在了"的状态；其余状态什么也证明不了。端口测试从真实观察核对这张表。 */
const PRESENCE: Readonly<Record<string, "alive" | "absent">> = Object.freeze({
  "tmux-panes:live": "alive",
  "tmux-panes:missing": "absent",
  "tmux-panes:pane-dead": "absent",
  "desktop-sessions:present-busy": "alive",
  "desktop-sessions:present-idle": "alive",
  "desktop-sessions:absent": "absent",
  "codex-thread:active": "alive",
  "codex-thread:archived": "absent",
});

function livenessOf(liveness: TestLiveness): ClosureLiveness {
  if (liveness.kind === "unobserved") return { kind: "unobserved", presence: "unknown" };
  return { ...liveness, presence: PRESENCE[`${liveness.kind}:${liveness.status}`] ?? "unknown" };
}

function observationOf(
  port: Readonly<WakeflowWindowTransportPort>,
  observation: TestObservation,
): Extract<EndpointCommand, { readonly operation: "register" }>["observation"] {
  const wire = {
    handle: { kind: "claude-session", value: observation.handleValue },
    launchIntentDigest: observation.launchIntentDigest,
    observedAt: "2026-11-16T00:00:00.000Z",
    ...(observation.hasTmuxCoordinates
      ? { tmux: { socketName: null, sessionName: "wakeflow", windowId: "@1", paneId: "%1" } }
      : {}),
    ...(observation.hasDesktopSession
      ? { desktop: { sessionId: "local_0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f" } }
      : {}),
  } as CreationObservation;
  return {
    handleValue: observation.handleValue,
    launchIntentDigest: observation.launchIntentDigest,
    locatorRefusal: port.admitCreationLocator(wire),
    hasWorktreeObservation: observation.hasWorktreeObservation,
  };
}

function commandOf(
  port: Readonly<WakeflowWindowTransportPort>,
  command: TestCommand,
): EndpointCommand {
  switch (command.operation) {
    case "register":
      return { operation: "register", observation: observationOf(port, command.observation) };
    case "replace":
    case "relocate":
      return { ...command, observation: observationOf(port, command.observation) };
    case "decommission":
      return {
        ...command,
        preClose: livenessOf(command.preClose),
        postClose: livenessOf(command.postClose),
      };
    case "release-claim":
      return { ...command, liveness: livenessOf(command.liveness) };
  }
}

/** 由端口算出状态与命令，再交给纯决定。 */
function decide(windowId: string, current: TestState, command: TestCommand): EndpointDecision {
  const { locatorProvider, ...rest } = current;
  const port = PORTS[locatorProvider];
  return decideEndpointCommand(
    windowId,
    { ...rest, hasLocator: port.hasLocator, relocation: port.relocation },
    commandOf(port, command),
  );
}

const WINDOW = "window_55555555-5555-4555-8555-555555555555";
const OTHER_WINDOW = "window_66666666-6666-4666-8666-666666666666";
const INTENT = `sha256:${"1".repeat(64)}`;
const BINDING = {
  bindingId: "window_binding_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  bindingDigest: `sha256:${"b".repeat(64)}`,
  handleValue: "session-a",
  launchIntentDigest: INTENT,
};

function state(overrides: Partial<TestState> = {}): TestState {
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
): TestCommand => ({
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
  deepEqual(decide(WINDOW, state(), register("session-a")), {
    accepted: true,
    operation: "register",
    disposition: "registered",
  });
  deepEqual(decide(WINDOW, state({ binding: BINDING }), register("session-a")), {
    accepted: true,
    operation: "register",
    disposition: "replayed",
  });
  const conflicting = decide(WINDOW, state({ binding: BINDING }), register("session-b"));
  equal(conflicting.accepted === false && conflicting.reason, "handle-conflict");
  const drift = decide(WINDOW, state(), {
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
  const noHook = decide(WINDOW, state(), register("session-unseen"));
  equal(noHook.accepted === false && noHook.reason, "hook-evidence-missing");
  const elsewhere = decide(
    WINDOW,
    state({
      handleOwners: new Map([["session-a", OTHER_WINDOW]]),
    }),
    register("session-a"),
  );
  equal(elsewhere.accepted === false && elsewhere.reason, "handle-conflict");
  const tmuxRequired = decide(WINDOW, state({ locatorProvider: "tmux" }), register("session-a"));
  equal(tmuxRequired.accepted === false && tmuxRequired.reason, "tmux-coordinates-required");
  equal(
    decide(WINDOW, state({ locatorProvider: "tmux" }), register("session-a", true)).accepted,
    true,
  );
  const unknown = decide(WINDOW, state({ windowKnown: false }), register("session-a"));
  equal(unknown.accepted === false && unknown.code, "not-found");
});

test("定位子按传输二选一（ADR-0025 D3）：desktop 缺会话 id 报 desktop-session-required，带 tmux 坐标报 locator-kind-mismatch 指向 tmux；tmux 带桌面 id 报 locator-kind-mismatch 指向 desktop；没有定位子的宿主两者都不看", () => {
  const desktop = state({ locatorProvider: "desktop" });
  deepEqual(decide(WINDOW, desktop, register("session-a", false, false, true)), {
    accepted: true,
    operation: "register",
    disposition: "registered",
  });
  deepEqual(decide(WINDOW, desktop, register("session-a")), {
    accepted: false,
    code: "invalid-request",
    reason: "desktop-session-required",
    path: "$request.observation.desktop",
  });
  deepEqual(decide(WINDOW, desktop, register("session-a", true, false, true)), {
    accepted: false,
    code: "invalid-request",
    reason: "locator-kind-mismatch",
    path: "$request.observation.tmux",
  });
  // 只带了别的传输的定位子：先点名多余的那个字段，而不是先要缺的那个。
  const tmuxOnly = decide(WINDOW, desktop, register("session-a", true));
  equal(tmuxOnly.accepted === false && tmuxOnly.reason, "locator-kind-mismatch");
  deepEqual(
    decide(WINDOW, state({ locatorProvider: "tmux" }), register("session-a", true, false, true)),
    {
      accepted: false,
      code: "invalid-request",
      reason: "locator-kind-mismatch",
      path: "$request.observation.desktop",
    },
  );
  const desktopOnlyOnTmux = decide(
    WINDOW,
    state({ locatorProvider: "tmux" }),
    register("session-a", false, false, true),
  );
  equal(desktopOnlyOnTmux.accepted === false && desktopOnlyOnTmux.reason, "locator-kind-mismatch");
  equal(
    decide(WINDOW, state(), register("session-a", true, false, true)).accepted,
    true,
    "a host without a locator ignores both locators",
  );
  // 定位子准入在意图核对之后、worktree 与 hook 证据之前：缺桌面 id 的 replace 也在这里被拒。
  const replaceMissing = decide(
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
  const worktreeMissing = decide(
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
  const replace = (handleValue: string, digest = BINDING.bindingDigest): TestCommand => ({
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
  deepEqual(decide(WINDOW, state({ binding: BINDING }), replace("session-b")), {
    accepted: true,
    operation: "replace",
    disposition: "replaced",
  });
  const drift = decide(
    WINDOW,
    state({ binding: BINDING }),
    replace("session-b", `sha256:${"0".repeat(64)}`),
  );
  equal(drift.accepted === false && drift.reason, "binding-drift");
  const absent = decide(WINDOW, state(), replace("session-b"));
  equal(absent.accepted === false && absent.code, "not-found");
  const held = decide(
    WINDOW,
    state({ binding: BINDING, claim: { claimId: "c", claimDigest: "sha256:x", expired: false } }),
    replace("session-b"),
  );
  equal(held.accepted === false && held.reason, "claim-held");
  const unchanged = decide(WINDOW, state({ binding: BINDING }), replace("session-a"));
  equal(unchanged.accepted === false && unchanged.reason, "handle-unchanged");
});

test("relocate：同句柄换 pane，绑定 CAS，只有 tmux 定位器宿主，持有的声明不阻塞（§13.125）", () => {
  const relocate = (handleValue: string, digest = BINDING.bindingDigest): TestCommand => ({
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
  const tmuxState = (overrides: Partial<TestState> = {}) =>
    state({ binding: BINDING, locatorProvider: "tmux", ...overrides });
  deepEqual(decide(WINDOW, tmuxState(), relocate("session-a")), {
    accepted: true,
    operation: "relocate",
    disposition: "relocated",
  });
  const held = decide(
    WINDOW,
    tmuxState({ claim: { claimId: "c", claimDigest: "sha256:x", expired: false } }),
    relocate("session-a"),
  );
  equal(held.accepted, true, "a held claim keeps working in the same session");
  const changed = decide(WINDOW, tmuxState(), relocate("session-b"));
  equal(changed.accepted === false && changed.reason, "handle-changed");
  const codex = decide(WINDOW, state({ binding: BINDING }), relocate("session-a"));
  equal(codex.accepted === false && codex.reason, "locator-provider");
  const drift = decide(WINDOW, tmuxState(), relocate("session-a", `sha256:${"0".repeat(64)}`));
  equal(drift.accepted === false && drift.reason, "binding-drift");
  const noCoordinates = decide(WINDOW, tmuxState(), {
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
  const absent = decide(WINDOW, state({ locatorProvider: "tmux" }), relocate("session-a"));
  equal(absent.accepted === false && absent.code, "not-found");
});

test("relocate 在桌面传输下不适用：relocate-not-applicable——桌面会话发消息即续、没有可换的坐标；绑定期望仍先核对（ADR-0025 D3）", () => {
  const desktopState = state({ binding: BINDING, locatorProvider: "desktop" });
  const relocate: TestCommand = {
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
  deepEqual(decide(WINDOW, desktopState, relocate), {
    accepted: false,
    code: "precondition-failed",
    reason: "relocate-not-applicable",
    path: "$request.operation",
  });
  const drift = decide(WINDOW, desktopState, {
    ...relocate,
    expectedBindingDigest: `sha256:${"0".repeat(64)}`,
  });
  equal(drift.accepted === false && drift.reason, "binding-drift");
  const absent = decide(WINDOW, state({ locatorProvider: "desktop" }), relocate);
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
    decide(WINDOW, claudeState, {
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
  const noSessionEnd = decide(WINDOW, state({ binding: BINDING, locatorProvider: "tmux" }), {
    ...base,
    preClose: { kind: "tmux-panes", status: "live" },
    closeResult: "closed",
    postClose: { kind: "tmux-panes", status: "missing" },
  });
  equal(
    noSessionEnd.accepted && noSessionEnd.operation === "decommission" && noSessionEnd.verification,
    "manual-host-gate",
  );
  const codex = decide(WINDOW, state({ binding: BINDING, endedSessions: new Set(["session-a"]) }), {
    ...base,
    preClose: { kind: "codex-thread", status: "active" },
    closeResult: "closed",
    postClose: { kind: "codex-thread", status: "archived" },
  });
  equal(
    codex.accepted && codex.operation === "decommission" && codex.verification,
    "manual-host-gate",
  );
  const stillAlive = decide(WINDOW, claudeState, {
    ...base,
    preClose: { kind: "tmux-panes", status: "live" },
    closeResult: "closed",
    postClose: { kind: "tmux-panes", status: "live" },
  });
  equal(stillAlive.accepted === false && stillAlive.reason, "closure-blocked");
  const failed = decide(WINDOW, claudeState, {
    ...base,
    preClose: { kind: "unobserved" },
    closeResult: "failed",
    postClose: { kind: "unobserved" },
  });
  equal(failed.accepted === false && failed.reason, "closure-blocked");
  const held = decide(
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
  const verification = (current: TestState, preClose: TestLiveness, postClose: TestLiveness) => {
    const decision = decide(WINDOW, current, {
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
  const release = (liveness: TestLiveness) =>
    decide(WINDOW, state({ binding: BINDING, locatorProvider: "desktop", claim }), {
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
  const release = (liveness: TestLiveness): TestCommand => ({
    operation: "release-claim",
    expectedClaimDigest: claim.claimDigest,
    liveness,
  });
  const active = decide(
    WINDOW,
    state({ binding: BINDING, claim }),
    release({ kind: "tmux-panes", status: "live" }),
  );
  equal(active.accepted === false && active.reason, "claim-active");
  // 持有会话没有算作已结束（例如 end 之后又 resume 出新的 start）、声明未过期、端点未观察：仍是 claim-active（W4）。
  const resumed = decide(
    WINDOW,
    state({ binding: BINDING, claim }),
    release({ kind: "unobserved" }),
  );
  equal(resumed.accepted === false && resumed.reason, "claim-active");
  deepEqual(
    decide(
      WINDOW,
      state({ binding: BINDING, claim: { ...claim, expired: true } }),
      release({ kind: "unobserved" }),
    ),
    { accepted: true, operation: "release-claim", disposition: "claim-released" },
  );
  equal(
    decide(
      WINDOW,
      state({ binding: BINDING, claim, endedSessions: new Set(["session-a"]) }),
      release({ kind: "unobserved" }),
    ).accepted,
    true,
  );
  equal(
    decide(
      WINDOW,
      state({ binding: BINDING, claim }),
      release({ kind: "tmux-panes", status: "pane-dead" }),
    ).accepted,
    true,
  );
  const drift = decide(WINDOW, state({ binding: BINDING, claim }), {
    operation: "release-claim",
    expectedClaimDigest: `sha256:${"d".repeat(64)}`,
    liveness: { kind: "unobserved" },
  });
  equal(drift.accepted === false && drift.reason, "claim-drift");
  const none = decide(WINDOW, state({ binding: BINDING }), release({ kind: "unobserved" }));
  equal(none.accepted === false && none.code, "not-found");
});
