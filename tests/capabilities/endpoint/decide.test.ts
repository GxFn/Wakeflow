import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  decideEndpointCommand,
  type EndpointCommand,
  type EndpointState,
} from "../../../src/capabilities/endpoint/decide.js";
import {
  classifyTmuxPanes,
  type TmuxLocator,
  type TmuxPaneObservation,
} from "../../../src/capabilities/endpoint/pane-classification.js";

const WINDOW = "window_55555555-5555-4555-8555-555555555555";
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
    binding: null,
    claim: null,
    handleOwners: new Map(),
    startedSessions: new Set(["session-a", "session-b"]),
    endedSessions: new Set(),
    ...overrides,
  };
}

const register = (handleValue: string, hasTmuxCoordinates = false): EndpointCommand => ({
  operation: "register",
  observation: { handleValue, launchIntentDigest: INTENT, hasTmuxCoordinates },
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
  equal(
    decideEndpointCommand(WINDOW, state({ binding: BINDING }), register("session-b")).accepted,
    false,
  );
  const drift = decideEndpointCommand(WINDOW, state(), {
    operation: "register",
    observation: {
      handleValue: "session-a",
      launchIntentDigest: `sha256:${"9".repeat(64)}`,
      hasTmuxCoordinates: false,
    },
  });
  equal(drift.accepted === false && drift.reason, "launch-intent-drift");
  const noHook = decideEndpointCommand(WINDOW, state(), register("session-unseen"));
  equal(noHook.accepted === false && noHook.reason, "hook-evidence-missing");
  const elsewhere = decideEndpointCommand(
    WINDOW,
    state({
      handleOwners: new Map([["session-a", "window_66666666-6666-4666-8666-666666666666"]]),
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

test("replace：CAS 旧绑定、拒绝持有声明与未变句柄，接受新句柄", () => {
  const replace = (handleValue: string, digest = BINDING.bindingDigest): EndpointCommand => ({
    operation: "replace",
    observation: { handleValue, launchIntentDigest: INTENT, hasTmuxCoordinates: false },
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
