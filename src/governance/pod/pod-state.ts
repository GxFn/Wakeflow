import type { WakeflowConfigPod } from "../../configuration/wakeflow-config-v3.js";

/**
 * Wakeflow Governance / Pod：pod 状态的纯派生（ADR-0010 D6，gate-log §13.91 D3）。
 *
 * 状态不落盘：由配置里的 lifecycle 加窗口绑定与 worktree 回执派生。pod 切片与观察切片共用
 * 这一份，切片之间不互相引用。
 */

export type PodState = "creating" | "ready" | "closing" | "closed";

export interface PodReceiptFact {
  readonly repositoryId: string;
  readonly windowId: string;
  readonly bindingId: string;
  readonly checkoutPresent: boolean;
}

export interface PodStateInput {
  readonly pod: Readonly<Pick<WakeflowConfigPod, "placement" | "lifecycle" | "worktrees">>;
  readonly windowIds: readonly string[];
  /** 已登记窗口 → 当前绑定标识。 */
  readonly bindingIdByWindowId: ReadonlyMap<string, string>;
  readonly receipts: readonly PodReceiptFact[];
}

function worktreeReady(input: Readonly<PodStateInput>): boolean {
  return input.pod.worktrees.every((worktree) => {
    const receipt = input.receipts.find((entry) => entry.repositoryId === worktree.repositoryId);
    return (
      receipt?.checkoutPresent === true &&
      receipt.bindingId === input.bindingIdByWindowId.get(worktree.windowId)
    );
  });
}

/**
 * 状态不落盘：open 且全部窗口已绑定、每个 worktree 回执与当前绑定同代且检出仍在即 ready，
 * 否则 creating；closing 且没有绑定、没有仍在的检出即 closed，否则 closing。
 */
export function derivePodState(input: Readonly<PodStateInput>): PodState {
  const bound = input.windowIds.filter((windowId) => input.bindingIdByWindowId.has(windowId));
  if (input.pod.lifecycle === "closing") {
    const checkouts = input.receipts.some((receipt) => receipt.checkoutPresent);
    return bound.length === 0 && !checkouts ? "closed" : "closing";
  }
  return bound.length === input.windowIds.length && worktreeReady(input) ? "ready" : "creating";
}
