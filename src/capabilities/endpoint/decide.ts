import type { WakeflowErrorCode } from "../../contracts/vocabulary/wakeflow-error-code.js";
import type { TmuxPaneStatus } from "./pane-classification.js";

/**
 * Wakeflow Capabilities / Endpoint：执行端点的纯决定（能力卡 2，ADR-0009）。
 *
 * 状态由服务层一次加载后交进来；这里只回答"这个命令在当前状态下是什么结局"。
 * 不读文件、不看时钟（当前时刻由调用方作为状态的一部分传入）、不认识宿主 SDK。
 */

export type EndpointLocatorProvider = "tmux" | "none";

export interface EndpointBindingState {
  readonly bindingId: string;
  readonly bindingDigest: string;
  readonly handleValue: string;
  readonly launchIntentDigest: string;
}

export interface EndpointClaimState {
  readonly claimId: string;
  readonly claimDigest: string;
  readonly expired: boolean;
}

export interface EndpointState {
  readonly windowKnown: boolean;
  readonly launchIntentDigest: string;
  readonly locatorProvider: EndpointLocatorProvider;
  readonly binding: EndpointBindingState | null;
  readonly claim: EndpointClaimState | null;
  /** 句柄值到已绑定窗口的映射，用于跨窗口唯一性。 */
  readonly handleOwners: ReadonlyMap<string, string>;
  /** 有 `session-start` hook 记录且 cwd 与本窗口根一致的会话标识。 */
  readonly startedSessions: ReadonlySet<string>;
  /** 有 `session-end` hook 记录的会话标识。 */
  readonly endedSessions: ReadonlySet<string>;
}

export interface EndpointCreationObservation {
  readonly handleValue: string;
  readonly launchIntentDigest: string;
  readonly hasTmuxCoordinates: boolean;
}

export type ClosureLiveness =
  | Readonly<{ readonly kind: "tmux-panes"; readonly status: TmuxPaneStatus | "no-locator" }>
  | Readonly<{ readonly kind: "codex-thread"; readonly status: "active" | "archived" | "unknown" }>
  | Readonly<{ readonly kind: "unobserved" }>;

export type EndpointCommand =
  | Readonly<{ readonly operation: "register"; readonly observation: EndpointCreationObservation }>
  | Readonly<{
      readonly operation: "replace";
      readonly observation: EndpointCreationObservation;
      readonly expectedBindingId: string;
      readonly expectedBindingDigest: string;
    }>
  | Readonly<{
      readonly operation: "decommission";
      readonly expectedBindingId: string;
      readonly expectedBindingDigest: string;
      readonly preClose: ClosureLiveness;
      readonly closeResult: "closed" | "failed" | "unknown";
      readonly postClose: ClosureLiveness;
    }>
  | Readonly<{
      readonly operation: "release-claim";
      readonly expectedClaimDigest: string;
      readonly liveness: ClosureLiveness;
    }>;

export type EndpointRejection = Readonly<{
  readonly accepted: false;
  readonly code: WakeflowErrorCode;
  readonly reason: string;
  readonly path: string;
}>;

export type EndpointDecision =
  | Readonly<{
      readonly accepted: true;
      readonly operation: "register";
      readonly disposition: "registered" | "replayed";
    }>
  | Readonly<{
      readonly accepted: true;
      readonly operation: "replace";
      readonly disposition: "replaced";
    }>
  | Readonly<{
      readonly accepted: true;
      readonly operation: "decommission";
      readonly disposition: "decommissioned";
      readonly verification: "machine-verified" | "manual-host-gate";
    }>
  | Readonly<{
      readonly accepted: true;
      readonly operation: "release-claim";
      readonly disposition: "claim-released";
    }>
  | EndpointRejection;

function reject(code: WakeflowErrorCode, reason: string, path: string): EndpointRejection {
  return Object.freeze({ accepted: false, code, reason, path });
}

function admitCreation(
  state: EndpointState,
  observation: EndpointCreationObservation,
  windowId: string,
): EndpointRejection | null {
  if (observation.launchIntentDigest !== state.launchIntentDigest) {
    return reject(
      "precondition-failed",
      "launch-intent-drift",
      "$request.observation.launchIntentDigest",
    );
  }
  if (state.locatorProvider === "tmux" && !observation.hasTmuxCoordinates) {
    return reject("invalid-request", "tmux-coordinates-required", "$request.observation.tmux");
  }
  if (!state.startedSessions.has(observation.handleValue)) {
    return reject("precondition-failed", "hook-evidence-missing", "$request.observation.handle");
  }
  const owner = state.handleOwners.get(observation.handleValue);
  if (owner !== undefined && owner !== windowId) {
    return reject("precondition-failed", "handle-conflict", "$request.observation.handle");
  }
  return null;
}

function assertBindingExpectation(
  state: EndpointState,
  expectedBindingId: string,
  expectedBindingDigest: string,
): EndpointRejection | null {
  if (state.binding === null) return reject("not-found", "binding-absent", "$request.windowId");
  if (
    state.binding.bindingId !== expectedBindingId ||
    state.binding.bindingDigest !== expectedBindingDigest
  ) {
    return reject("precondition-failed", "binding-drift", "$request.expectedBindingDigest");
  }
  return null;
}

function absent(liveness: ClosureLiveness): boolean {
  return (
    (liveness.kind === "tmux-panes" &&
      (liveness.status === "missing" || liveness.status === "pane-dead")) ||
    (liveness.kind === "codex-thread" && liveness.status === "archived")
  );
}

function alive(liveness: ClosureLiveness): boolean {
  return (
    (liveness.kind === "tmux-panes" && liveness.status === "live") ||
    (liveness.kind === "codex-thread" && liveness.status === "active")
  );
}

function decideDecommission(
  state: EndpointState,
  command: Extract<EndpointCommand, { readonly operation: "decommission" }>,
): EndpointDecision {
  const expectation = assertBindingExpectation(
    state,
    command.expectedBindingId,
    command.expectedBindingDigest,
  );
  if (expectation !== null) return expectation;
  if (state.claim !== null) return reject("precondition-failed", "claim-held", "$request.windowId");
  if (command.closeResult === "failed" || alive(command.postClose)) {
    return reject("precondition-failed", "closure-blocked", "$request.closure");
  }
  const sessionEnded = state.binding !== null && state.endedSessions.has(state.binding.handleValue);
  const machineVerified =
    state.locatorProvider === "tmux" &&
    command.closeResult === "closed" &&
    absent(command.postClose) &&
    (alive(command.preClose) || absent(command.preClose)) &&
    sessionEnded;
  return Object.freeze({
    accepted: true,
    operation: "decommission" as const,
    disposition: "decommissioned" as const,
    verification: machineVerified ? ("machine-verified" as const) : ("manual-host-gate" as const),
  });
}

function decideReleaseClaim(
  state: EndpointState,
  command: Extract<EndpointCommand, { readonly operation: "release-claim" }>,
): EndpointDecision {
  if (state.claim === null) return reject("not-found", "claim-absent", "$request.windowId");
  if (state.claim.claimDigest !== command.expectedClaimDigest) {
    return reject("precondition-failed", "claim-drift", "$request.expectedClaimDigest");
  }
  const holderEnded = state.binding !== null && state.endedSessions.has(state.binding.handleValue);
  if (!(state.claim.expired || holderEnded || absent(command.liveness))) {
    return reject("precondition-failed", "claim-active", "$request.evidence");
  }
  return Object.freeze({
    accepted: true,
    operation: "release-claim" as const,
    disposition: "claim-released" as const,
  });
}

function decideRegister(
  state: EndpointState,
  command: Extract<EndpointCommand, { readonly operation: "register" }>,
  windowId: string,
): EndpointDecision {
  const admission = admitCreation(state, command.observation, windowId);
  if (admission !== null) return admission;
  if (state.binding === null) {
    return Object.freeze({ accepted: true, operation: "register", disposition: "registered" });
  }
  if (state.binding.handleValue === command.observation.handleValue) {
    return Object.freeze({ accepted: true, operation: "register", disposition: "replayed" });
  }
  return reject("precondition-failed", "handle-conflict", "$request.observation.handle");
}

function decideReplace(
  state: EndpointState,
  command: Extract<EndpointCommand, { readonly operation: "replace" }>,
  windowId: string,
): EndpointDecision {
  const expectation = assertBindingExpectation(
    state,
    command.expectedBindingId,
    command.expectedBindingDigest,
  );
  if (expectation !== null) return expectation;
  if (state.claim !== null) return reject("precondition-failed", "claim-held", "$request.windowId");
  if (state.binding?.handleValue === command.observation.handleValue) {
    return reject("precondition-failed", "handle-unchanged", "$request.observation.handle");
  }
  const admission = admitCreation(state, command.observation, windowId);
  if (admission !== null) return admission;
  return Object.freeze({ accepted: true, operation: "replace", disposition: "replaced" });
}

/** 一个命令在当前端点状态下的结局。 */
export function decideEndpointCommand(
  windowId: string,
  state: EndpointState,
  command: EndpointCommand,
): EndpointDecision {
  if (!state.windowKnown) return reject("not-found", "window-unknown", "$request.windowId");
  switch (command.operation) {
    case "register":
      return decideRegister(state, command, windowId);
    case "replace":
      return decideReplace(state, command, windowId);
    case "decommission":
      return decideDecommission(state, command);
    case "release-claim":
      return decideReleaseClaim(state, command);
  }
}
