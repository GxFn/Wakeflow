import type { WakeflowErrorCode } from "../../contracts/vocabulary/wakeflow-error-code.js";
import type { DesktopSessionStatus } from "./desktop-session-classification.js";
import type { TmuxPaneStatus } from "./pane-classification.js";

/**
 * Wakeflow Capabilities / Endpoint：执行端点的纯决定（能力卡 2，ADR-0009）。
 *
 * 状态由服务层一次加载后交进来；这里只回答"这个命令在当前状态下是什么结局"。
 * 不读文件、不看时钟（当前时刻由调用方作为状态的一部分传入）、不认识宿主 SDK。
 * 定位子提供者是宿主 profile 推导出的值（ADR-0025 D2）：tmux 要坐标、desktop 要桌面会话 id、none 两者都不看。
 */

export type EndpointLocatorProvider = "tmux" | "desktop" | "none";

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
  /** worktree pod 的产品窗口：登记与换代必须带 worktree 观察（ADR-0010 D4）。 */
  readonly worktreeRequired: boolean;
  readonly binding: EndpointBindingState | null;
  readonly claim: EndpointClaimState | null;
  /** 句柄值到已绑定窗口的映射，用于跨窗口唯一性。 */
  readonly handleOwners: ReadonlyMap<string, string>;
  /** 有 `session-start` hook 记录且 cwd 与宿主规定的启动根一致的会话标识。 */
  readonly startedSessions: ReadonlySet<string>;
  /**
   * 已结束的会话标识：最新的 `session-end` 记录晚于该会话最新的 `session-start`（open-items W4）。
   * resume 让同一会话再次 `session-start`，之前的 end 就不再算结束。
   */
  readonly endedSessions: ReadonlySet<string>;
}

export interface EndpointCreationObservation {
  readonly handleValue: string;
  readonly launchIntentDigest: string;
  /** 观察带了 tmux 坐标（tmux 传输的定位子）。 */
  readonly hasTmuxCoordinates: boolean;
  /** 观察带了桌面会话 id（桌面传输的定位子，ADR-0025 D3）。 */
  readonly hasDesktopSession: boolean;
  readonly hasWorktreeObservation: boolean;
}

export type ClosureLiveness =
  | Readonly<{ readonly kind: "tmux-panes"; readonly status: TmuxPaneStatus | "no-locator" }>
  | Readonly<{
      readonly kind: "desktop-sessions";
      readonly status: DesktopSessionStatus | "no-locator";
    }>
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
      /** 同一会话换了 pane（resume 之后）：绑定不变，只换定位器代际（§13.125）。 */
      readonly operation: "relocate";
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
      readonly operation: "relocate";
      readonly disposition: "relocated";
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

/**
 * 跨窗口句柄唯一性：句柄已被别的窗口持有即冲突。服务层在锁外用加载快照路由（早拒绝），进锁后用重读的
 * inventory 再算一次——锁外读只用于路由，锁内重读才用于决定（open-items W1）。
 */
export function rejectForeignHandleOwner(
  handleOwners: ReadonlyMap<string, string>,
  handleValue: string,
  windowId: string,
): EndpointRejection | null {
  const owner = handleOwners.get(handleValue);
  if (owner !== undefined && owner !== windowId) {
    return reject("precondition-failed", "handle-conflict", "$request.observation.handle");
  }
  return null;
}

/**
 * 定位子按传输二选一（ADR-0025 D3）：带了另一种传输的定位子先报 locator-kind-mismatch（指向多余的那个字段），
 * 再看本传输的定位子在不在；没有定位子的宿主（项目聊天）两者都不看。
 */
function admitLocator(
  state: EndpointState,
  observation: EndpointCreationObservation,
): EndpointRejection | null {
  switch (state.locatorProvider) {
    case "tmux":
      if (observation.hasDesktopSession) {
        return reject("invalid-request", "locator-kind-mismatch", "$request.observation.desktop");
      }
      if (!observation.hasTmuxCoordinates) {
        return reject("invalid-request", "tmux-coordinates-required", "$request.observation.tmux");
      }
      return null;
    case "desktop":
      if (observation.hasTmuxCoordinates) {
        return reject("invalid-request", "locator-kind-mismatch", "$request.observation.tmux");
      }
      if (!observation.hasDesktopSession) {
        return reject(
          "invalid-request",
          "desktop-session-required",
          "$request.observation.desktop",
        );
      }
      return null;
    case "none":
      return null;
  }
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
  const locator = admitLocator(state, observation);
  if (locator !== null) return locator;
  if (state.worktreeRequired && !observation.hasWorktreeObservation) {
    return reject("invalid-request", "worktree-receipt-required", "$request.observation.worktree");
  }
  if (!state.startedSessions.has(observation.handleValue)) {
    return reject("precondition-failed", "hook-evidence-missing", "$request.observation.handle");
  }
  return rejectForeignHandleOwner(state.handleOwners, observation.handleValue, windowId);
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

/** 端点确定不在了：pane 没了或已死、桌面会话不在清单里、Codex 线程已归档。`no-locator` 什么也证明不了。 */
function absent(liveness: ClosureLiveness): boolean {
  return (
    (liveness.kind === "tmux-panes" &&
      (liveness.status === "missing" || liveness.status === "pane-dead")) ||
    (liveness.kind === "desktop-sessions" && liveness.status === "absent") ||
    (liveness.kind === "codex-thread" && liveness.status === "archived")
  );
}

function alive(liveness: ClosureLiveness): boolean {
  return (
    (liveness.kind === "tmux-panes" && liveness.status === "live") ||
    (liveness.kind === "desktop-sessions" &&
      (liveness.status === "present-busy" || liveness.status === "present-idle")) ||
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
  // 机器核实需要一个有定位子的传输（pane 清单或桌面会话清单证明端点已不在）加上 session-end 记录。
  const machineVerified =
    state.locatorProvider !== "none" &&
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

/**
 * relocate：会话没变、pane 变了（宿主 resume 之后）。绑定 CAS 与 register 同样的准入（意图、坐标、
 * hook 证据）之外，句柄必须与当前绑定相同，只有 tmux 定位器的宿主才有 pane 可换：桌面会话发消息即续、
 * 没有可换的坐标，报 relocate-not-applicable（ADR-0025 D3）；没有定位子的宿主报 locator-provider。
 * 持有中的工作声明不阻塞——同一会话继续工作。
 */
function decideRelocate(
  state: EndpointState,
  command: Extract<EndpointCommand, { readonly operation: "relocate" }>,
  windowId: string,
): EndpointDecision {
  const expectation = assertBindingExpectation(
    state,
    command.expectedBindingId,
    command.expectedBindingDigest,
  );
  if (expectation !== null) return expectation;
  if (state.locatorProvider === "desktop") {
    return reject("precondition-failed", "relocate-not-applicable", "$request.operation");
  }
  if (state.locatorProvider !== "tmux") {
    return reject("precondition-failed", "locator-provider", "$request.operation");
  }
  if (state.binding?.handleValue !== command.observation.handleValue) {
    return reject("precondition-failed", "handle-changed", "$request.observation.handle");
  }
  const admission = admitCreation(state, command.observation, windowId);
  if (admission !== null) return admission;
  return Object.freeze({ accepted: true, operation: "relocate", disposition: "relocated" });
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
    case "relocate":
      return decideRelocate(state, command, windowId);
    case "replace":
      return decideReplace(state, command, windowId);
    case "decommission":
      return decideDecommission(state, command);
    case "release-claim":
      return decideReleaseClaim(state, command);
  }
}
