import { computeSha256Digest } from "../foundation/crypto/sha256.js";
import { encodeUtf8 } from "../foundation/text/utf8.js";
import { fail, toWakeflowError } from "../kernel/error.js";
function recordOf(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value
        : null;
}
/** 请求里的后续一步；两样都没带即 null。形状不对的交给决定自己的 Schema 去拒绝。 */
function followUpOf(value) {
    const request = recordOf(value);
    if (request === null || typeof request.idempotencyKey !== "string")
        return null;
    const thenPlan = recordOf(request.thenPlan);
    const complete = request.thenComplete === true;
    if (thenPlan === null && !complete)
        return null;
    return Object.freeze({
        root: request.root,
        demandId: request.demandId,
        idempotencyKey: request.idempotencyKey,
        decision: request.decision,
        plan: thenPlan === null
            ? null
            : Object.freeze({ taskPackage: thenPlan.taskPackage, planReview: thenPlan.planReview }),
        complete,
    });
}
/** 在记下任何东西之前拒绝说不通的组合。 */
function assertFollowUp(followUp) {
    if (followUp.plan !== null && followUp.complete) {
        fail("invalid-request", "then-plan-and-then-complete", "$request.thenComplete");
    }
    if (followUp.decision !== "accept") {
        fail("invalid-request", followUp.complete ? "then-complete-requires-accept" : "then-plan-requires-accept", followUp.complete ? "$request.thenComplete" : "$request.thenPlan");
    }
}
/** 规划这一步的幂等键：由决定的键派生，长度固定，所以同一次调用重放时两步都重放。 */
function followUpIdempotencyKey(decisionKey) {
    const digest = computeSha256Digest(encodeUtf8(decisionKey, "$request.idempotencyKey"));
    return `then-plan.${digest.slice("sha256:".length, "sha256:".length + 40)}`;
}
/**
 * 规划所依据的流修订：决定事件自己的修订。accept 的那次提交只有这一个事件，所以它就是决定落账之后的
 * 那一刻；取它而不取结果里 `next` 的修订，是因为重放时 `next` 说的是现在——规划的请求必须与第一次
 * 逐字节相同，幂等重放才认它。两步之间若有别的窗口先提交了，规划以修订不符被拒并随结果交回。
 */
function revisionAfter(decided) {
    return decided.event.streamRevision;
}
/** 第二步的已归类拒绝随结果交回；取消与没人认领的错误（编程错误的出口）照常上抛。 */
function refusalOf(error, context, path) {
    if (context.signal.aborted)
        throw error;
    const failure = toWakeflowError(error, path);
    if (failure.code === "unexpected")
        throw error;
    return failure.toPublicDetails();
}
async function planNext(decided, followUp, plan, context) {
    try {
        const planning = await plan({
            root: followUp.root,
            demandId: followUp.demandId,
            idempotencyKey: followUpIdempotencyKey(followUp.idempotencyKey),
            expectedStreamRevision: revisionAfter(decided),
            taskPackage: followUp.plan?.taskPackage,
            ...(followUp.plan?.planReview === undefined
                ? {}
                : { planReview: followUp.plan.planReview }),
        }, context);
        // 下一步从规划的结果继续：决定自己的 `next` 说的是规划之前的那一刻。
        return Object.freeze({
            ...decided,
            next: planning.next,
            thenPlan: Object.freeze({ status: "planned", planning }),
        });
    }
    catch (error) {
        return Object.freeze({
            ...decided,
            thenPlan: Object.freeze({
                status: "refused",
                error: refusalOf(error, context, "$request.thenPlan"),
            }),
        });
    }
}
async function completeNow(decided, followUp, complete, context) {
    try {
        const request = { root: followUp.root, demandId: followUp.demandId };
        const preview = await complete({ ...request, mode: "preview" }, context);
        if (preview.kind !== "WakeflowDemandCompletionPreview") {
            fail("unexpected", "completion-preview", "$request.thenComplete");
        }
        if (preview.status !== "ready" || preview.planDigest === null) {
            // 还有别的目标没做完、还缺证据……完成的门说了算；accept 已经记下，next 仍是决定给出的那一步。
            return Object.freeze({
                ...decided,
                thenComplete: Object.freeze({ status: "blocked", blockers: preview.blockers }),
            });
        }
        const completion = await complete({ ...request, mode: "apply", planDigest: preview.planDigest }, context);
        return Object.freeze({
            ...decided,
            next: completion.next,
            thenComplete: Object.freeze({ status: "completed", completion }),
        });
    }
    catch (error) {
        return Object.freeze({
            ...decided,
            thenComplete: Object.freeze({
                status: "refused",
                error: refusalOf(error, context, "$request.thenComplete"),
            }),
        });
    }
}
export function withFollowUp(decide, executors) {
    return async (value, context) => {
        const followUp = followUpOf(value);
        if (followUp !== null)
            assertFollowUp(followUp);
        const decided = await decide(value, context);
        if (followUp === null)
            return decided;
        return followUp.plan !== null
            ? planNext(decided, followUp, executors.plan, context)
            : completeNow(decided, followUp, executors.complete, context);
    };
}
