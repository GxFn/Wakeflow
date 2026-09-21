function reject(code, reason, path) {
    return Object.freeze({ accepted: false, code, reason, path });
}
function admitCreation(state, observation, windowId) {
    if (observation.launchIntentDigest !== state.launchIntentDigest) {
        return reject("precondition-failed", "launch-intent-drift", "$request.observation.launchIntentDigest");
    }
    if (state.locatorProvider === "tmux" && !observation.hasTmuxCoordinates) {
        return reject("invalid-request", "tmux-coordinates-required", "$request.observation.tmux");
    }
    if (state.worktreeRequired && !observation.hasWorktreeObservation) {
        return reject("invalid-request", "worktree-receipt-required", "$request.observation.worktree");
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
function assertBindingExpectation(state, expectedBindingId, expectedBindingDigest) {
    if (state.binding === null)
        return reject("not-found", "binding-absent", "$request.windowId");
    if (state.binding.bindingId !== expectedBindingId ||
        state.binding.bindingDigest !== expectedBindingDigest) {
        return reject("precondition-failed", "binding-drift", "$request.expectedBindingDigest");
    }
    return null;
}
function absent(liveness) {
    return ((liveness.kind === "tmux-panes" &&
        (liveness.status === "missing" || liveness.status === "pane-dead")) ||
        (liveness.kind === "codex-thread" && liveness.status === "archived"));
}
function alive(liveness) {
    return ((liveness.kind === "tmux-panes" && liveness.status === "live") ||
        (liveness.kind === "codex-thread" && liveness.status === "active"));
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
    const machineVerified = state.locatorProvider === "tmux" &&
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
/** 一个命令在当前端点状态下的结局。 */
export function decideEndpointCommand(windowId, state, command) {
    if (!state.windowKnown)
        return reject("not-found", "window-unknown", "$request.windowId");
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
