import { runCommandShell } from "./command-shell.js";
import { fail } from "./error.js";
import { deriveDemandCommitId, parseIdempotencyKey } from "./ids.js";
const NO_NEXT = Object.freeze({
    frontier: null,
    owner: "none",
    suggestedTool: null,
    blockers: Object.freeze([]),
});
/** 执行一个追加型公共命令；`options` 是注入的执行选项，不是请求的一部分。 */
export async function runAppendCommand(spec, value, options = {}) {
    return runCommandShell(spec, value, (binding) => {
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
