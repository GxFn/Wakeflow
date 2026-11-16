import {
  type WakeflowWindowLiveness,
  type WakeflowWindowLivenessInput,
  type WakeflowWindowTransportPort,
  wakeflowWindowLivenessWithoutEvidence,
} from "../../workspace/host-runtime/wakeflow-window-transport-port.js";

/**
 * Wakeflow Host / Codex：项目聊天的窗口传输端口（open-items L6）。
 *
 * Codex 的窗口是项目里的线程：没有定位子，创建观察里的两种定位都不看，也没有可 relocate 的位置。存活只有
 * 一种证据——Agent 交回的线程状态：active 是还在，archived 是不在了，unknown 什么也证明不了。别的宿主的
 * 观察（pane 清单、桌面会话清单）在这里同样什么也证明不了。
 */

function classifyCodexLiveness(
  input: Readonly<WakeflowWindowLivenessInput>,
): Readonly<WakeflowWindowLiveness> {
  const { observation } = input;
  if (observation.kind !== "codex-thread")
    return wakeflowWindowLivenessWithoutEvidence(observation);
  const presence =
    observation.status === "active"
      ? ("alive" as const)
      : observation.status === "archived"
        ? ("absent" as const)
        : ("unknown" as const);
  return Object.freeze({ kind: "codex-thread" as const, status: observation.status, presence });
}

export const codexWindowTransportPort: Readonly<WakeflowWindowTransportPort> = Object.freeze({
  provider: "none",
  hasLocator: false,
  relocation: "unavailable" as const,
  locatorCodecs: Object.freeze([]),
  admitCreationLocator() {
    return null;
  },
  locatorOf() {
    return null;
  },
  classifyLiveness: classifyCodexLiveness,
});
