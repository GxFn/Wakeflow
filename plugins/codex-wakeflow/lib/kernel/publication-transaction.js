import { runCommandShell, } from "./command-shell.js";
import { fail } from "./error.js";
const NO_NEXT = Object.freeze({
    frontier: null,
    owner: "none",
    suggestedTool: null,
    blockers: Object.freeze([]),
});
function admitEnvelope(binding) {
    const { mode, planDigest, operationId } = binding.envelope;
    if (mode === "apply" && planDigest === null) {
        fail("invalid-request", "plan-digest-required", "$request.planDigest");
    }
    if (mode !== "apply" && planDigest !== null) {
        fail("invalid-request", "plan-digest-unexpected", "$request.planDigest");
    }
    if (mode === "recover" && operationId === null) {
        fail("invalid-request", "operation-id-required", "$request.operationId");
    }
    if (mode !== "recover" && operationId !== null) {
        fail("invalid-request", "operation-id-unexpected", "$request.operationId");
    }
}
/** 执行一个效果型公共命令；`options` 是注入的执行选项，不是请求的一部分。 */
export async function runPublicationTransaction(spec, value, options = {}) {
    return runCommandShell(spec, value, admitEnvelope, async (context, binding) => {
        const { envelope, input } = binding;
        const phase = await runPhase(spec, context, envelope, input);
        const next = spec.next === undefined ? NO_NEXT : await spec.next(context, phase);
        return spec.result(envelope, input, phase, next);
    }, options);
}
async function runPhase(spec, context, envelope, input) {
    if (envelope.mode === "recover") {
        const operationId = envelope.operationId;
        const outcome = await spec.recover(context, operationId);
        return Object.freeze({ mode: "recover", operationId, outcome });
    }
    const planned = await spec.plan(context, input);
    if (envelope.mode === "preview") {
        return Object.freeze({ mode: "preview", planned });
    }
    if (planned.status !== "ready" || planned.plan === null || planned.digest === null) {
        fail("precondition-failed", "plan-blocked", "$request.planDigest");
    }
    if (planned.digest !== envelope.planDigest) {
        fail("precondition-failed", "plan-drift", "$request.planDigest");
    }
    const outcome = await spec.apply(context, input, planned.plan);
    return Object.freeze({ mode: "apply", planned, plan: planned.plan, outcome });
}
