import { runCommandShell } from "./command-shell.js";
import { fail } from "./error.js";
import { deriveDemandCommitId, parseIdempotencyKey } from "./ids.js";
const NO_NEXT = Object.freeze({
    frontier: null,
    owner: "none",
    suggestedTool: null,
    blockers: Object.freeze([]),
});
/**
 * 请求没有给观察到的流修订时，切片在信封里放的值。已发布的 Demand 流修订从 1 起，0 不可能是一次真实的
 * 观察，所以拿它当"没有给"（ADR-0029 决定 3）。
 */
export const UNOBSERVED_STREAM_REVISION = 0;
/**
 * 调用方没有给流修订时按当前修订追加；给了就原样保留，由切片照旧核对（1.4 第 5 段 5b，ADR-0031）。
 * 守住这次追加的是幂等键、聚合自己的阶段规则与提交时对流修订的核对——两次写入不会互相覆盖；少掉的
 * 只是"调用方上一次看过之后别人写过就一律拒绝"。
 */
export function bindAppendAtCurrentRevision(binding, currentStreamRevision) {
    return binding.expectedStreamRevision === UNOBSERVED_STREAM_REVISION
        ? Object.freeze({ ...binding, expectedStreamRevision: currentStreamRevision })
        : binding;
}
/** 执行一个追加型公共命令；`options` 是注入的执行选项，不是请求的一部分。 */
export async function runAppendCommand(spec, value, options = {}) {
    return runCommandShell({ ...spec, scope: () => "shared" }, value, (binding) => {
        parseIdempotencyKey(binding.envelope.idempotencyKey, "$request.idempotencyKey");
        if (!Number.isSafeInteger(binding.envelope.expectedStreamRevision) ||
            binding.envelope.expectedStreamRevision < 0) {
            fail("invalid-request", "expected-stream-revision", "$request.expectedStreamRevision");
        }
    }, async (context, shell) => {
        const { envelope } = shell;
        const idempotencyKey = parseIdempotencyKey(envelope.idempotencyKey, "$request.idempotencyKey");
        const binding = Object.freeze({
            commitId: deriveDemandCommitId(envelope.demandId, idempotencyKey),
            idempotencyKey,
            requestDigest: shell.requestDigest,
            expectedStreamRevision: envelope.expectedStreamRevision,
        });
        const outcome = await spec.execute(context, shell.input, binding);
        const next = spec.next === undefined ? NO_NEXT : await spec.next(context, outcome);
        return spec.result(envelope, outcome, next);
    }, options);
}
