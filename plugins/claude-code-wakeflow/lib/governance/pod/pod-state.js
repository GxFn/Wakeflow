function worktreeReady(input) {
    return input.pod.worktrees.every((worktree) => {
        const receipt = input.receipts.find((entry) => entry.repositoryId === worktree.repositoryId);
        return (receipt?.checkoutPresent === true &&
            receipt.bindingId === input.bindingIdByWindowId.get(worktree.windowId));
    });
}
/**
 * 状态不落盘：open 且全部窗口已绑定、每个 worktree 回执与当前绑定同代且检出仍在即 ready，
 * 否则 creating；closing 且没有绑定、没有仍在的检出即 closed，否则 closing。
 */
export function derivePodState(input) {
    const bound = input.windowIds.filter((windowId) => input.bindingIdByWindowId.has(windowId));
    if (input.pod.lifecycle === "closing") {
        const checkouts = input.receipts.some((receipt) => receipt.checkoutPresent);
        return bound.length === 0 && !checkouts ? "closed" : "closing";
    }
    return bound.length === input.windowIds.length && worktreeReady(input) ? "ready" : "creating";
}
