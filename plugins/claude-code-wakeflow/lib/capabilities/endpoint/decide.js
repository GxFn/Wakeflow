function reject(code, reason, path) {
    return Object.freeze({ accepted: false, code, reason, path });
}
/**
 * 跨窗口句柄唯一性：句柄已被别的窗口持有即冲突。服务层在锁外用加载快照路由（早拒绝），进锁后用重读的
 * inventory 再算一次——锁外读只用于路由，锁内重读才用于决定（open-items W1）。
 */
export function rejectForeignHandleOwner(handleOwners, handleValue, windowId) {
    const owner = handleOwners.get(handleValue);
    if (owner !== undefined && owner !== windowId) {
        return reject("precondition-failed", "handle-conflict", "$request.observation.handle");
    }
    return null;
}
function admitCreation(state, observation, windowId) {
    if (observation.launchIntentDigest !== state.launchIntentDigest) {
        return reject("precondition-failed", "launch-intent-drift", "$request.observation.launchIntentDigest");
    }
    // 定位子按传输二选一（ADR-0025 D3）：带了别的传输的、或缺了本传输的，端口已经给出原因与字段。
    if (observation.locatorRefusal !== null) {
        return reject("invalid-request", observation.locatorRefusal.reason, observation.locatorRefusal.path);
    }
    if (state.worktreeRequired && !observation.hasWorktreeObservation) {
        return reject("invalid-request", "worktree-receipt-required", "$request.observation.worktree");
    }
    if (!state.startedSessions.has(observation.handleValue)) {
        return reject("precondition-failed", "hook-evidence-missing", "$request.observation.handle");
    }
    return rejectForeignHandleOwner(state.handleOwners, observation.handleValue, windowId);
}
function assertBindingExpectation(state, expectedBindingId, expectedBindingDigest) {
    if (state.binding === null)
        return reject("not-found", "binding-absent", "$request.windowId");
    if (state.binding.bindingId !== expectedBindingId ||
        state.binding.bindingDigest !== expectedBindingDigest) {
        return reject("precondition-failed", "binding-drift", "$request.expectedBindingDigest");
    }
    return null;
}
/** 端点确定不在了（传输端口的结论）；对不上定位或没有观察时什么也证明不了，两个判断都是假。 */
function absent(liveness) {
    return liveness.presence === "absent";
}
function alive(liveness) {
    return liveness.presence === "alive";
}
function decideDecommission(state, command) {
    const expectation = assertBindingExpectation(state, command.expectedBindingId, command.expectedBindingDigest);
    if (expectation !== null)
        return expectation;
    if (state.claim !== null)
        return reject("precondition-failed", "claim-held", "$request.windowId");
    if (command.closeResult === "failed" || alive(command.postClose)) {
        return reject("precondition-failed", "closure-blocked", "$request.closure");
    }
    const sessionEnded = state.binding !== null && state.endedSessions.has(state.binding.handleValue);
    // 机器核实需要一个有定位子的传输（它的清单证明端点已不在）加上 session-end 记录。
    const machineVerified = state.hasLocator &&
        command.closeResult === "closed" &&
        absent(command.postClose) &&
        (alive(command.preClose) || absent(command.preClose)) &&
        sessionEnded;
    return Object.freeze({
        accepted: true,
        operation: "decommission",
        disposition: "decommissioned",
        verification: machineVerified ? "machine-verified" : "manual-host-gate",
    });
}
function decideReleaseClaim(state, command) {
    if (state.claim === null)
        return reject("not-found", "claim-absent", "$request.windowId");
    if (state.claim.claimDigest !== command.expectedClaimDigest) {
        return reject("precondition-failed", "claim-drift", "$request.expectedClaimDigest");
    }
    const holderEnded = state.binding !== null && state.endedSessions.has(state.binding.handleValue);
    if (!(state.claim.expired || holderEnded || absent(command.liveness))) {
        return reject("precondition-failed", "claim-active", "$request.evidence");
    }
    return Object.freeze({
        accepted: true,
        operation: "release-claim",
        disposition: "claim-released",
    });
}
function decideRegister(state, command, windowId) {
    const admission = admitCreation(state, command.observation, windowId);
    if (admission !== null)
        return admission;
    if (state.binding === null) {
        return Object.freeze({ accepted: true, operation: "register", disposition: "registered" });
    }
    if (state.binding.handleValue === command.observation.handleValue) {
        return Object.freeze({ accepted: true, operation: "register", disposition: "replayed" });
    }
    return reject("precondition-failed", "handle-conflict", "$request.observation.handle");
}
function decideReplace(state, command, windowId) {
    const expectation = assertBindingExpectation(state, command.expectedBindingId, command.expectedBindingDigest);
    if (expectation !== null)
        return expectation;
    if (state.claim !== null)
        return reject("precondition-failed", "claim-held", "$request.windowId");
    if (state.binding?.handleValue === command.observation.handleValue) {
        return reject("precondition-failed", "handle-unchanged", "$request.observation.handle");
    }
    const admission = admitCreation(state, command.observation, windowId);
    if (admission !== null)
        return admission;
    return Object.freeze({ accepted: true, operation: "replace", disposition: "replaced" });
}
/**
 * relocate：会话没变、位置变了（宿主 resume 之后换了 pane）。绑定 CAS 与 register 同样的准入（意图、定位、
 * hook 证据）之外，句柄必须与当前绑定相同，并且这种传输得有位置可换：有定位子却没有可换位置的传输报
 * relocate-not-applicable（ADR-0025 D3），没有定位子的报 locator-provider。持有中的工作声明不阻塞——
 * 同一会话继续工作。
 */
function decideRelocate(state, command, windowId) {
    const expectation = assertBindingExpectation(state, command.expectedBindingId, command.expectedBindingDigest);
    if (expectation !== null)
        return expectation;
    if (state.relocation === "not-applicable") {
        return reject("precondition-failed", "relocate-not-applicable", "$request.operation");
    }
    if (state.relocation !== "supported") {
        return reject("precondition-failed", "locator-provider", "$request.operation");
    }
    if (state.binding?.handleValue !== command.observation.handleValue) {
        return reject("precondition-failed", "handle-changed", "$request.observation.handle");
    }
    const admission = admitCreation(state, command.observation, windowId);
    if (admission !== null)
        return admission;
    return Object.freeze({ accepted: true, operation: "relocate", disposition: "relocated" });
}
/** 一个命令在当前端点状态下的结局。 */
export function decideEndpointCommand(windowId, state, command) {
    if (!state.windowKnown)
        return reject("not-found", "window-unknown", "$request.windowId");
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
