import { createWakeflowDurableId, } from "../contracts/identity/wakeflow-durable-id.js";
import { deriveUuidV4, parseUuidV4, UuidV4Error } from "../foundation/identity/uuid-v4.js";
import { fail } from "./error.js";
/**
 * Wakeflow Kernel / Ids：确定性 typed id 派生（ADR-0005、节点评估 C7）。
 *
 * 同一命名空间与同一输入永远得到同一个 UUID，因此重试不会造出第二个身份；
 * 输出仍满足 UUID v4 的版本位与变体位，与随机分配的 id 共用同一形状。
 * 这里取代了旧代码里六份互不相同的 `uuidFrom`。
 */
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;
export function parseIdempotencyKey(value, path = "$idempotencyKey") {
    if (typeof value !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
        fail("invalid-request", "idempotency-key", path);
    }
    return value;
}
/** 由命名空间与若干片段派生一个稳定的 UUID v4 形状字符串（Foundation 原语的内核门面）。 */
export function deterministicUuidV4(namespace, ...parts) {
    try {
        return deriveUuidV4(namespace, ...parts);
    }
    catch (error) {
        if (error instanceof UuidV4Error) {
            fail("invalid-request", "uuid-derivation", "$namespace", { cause: error });
        }
        throw error;
    }
}
/** 派生一个 typed durable id；同一种类、命名空间与片段总得到同一个 id。 */
export function deriveDurableId(kind, namespace, ...parts) {
    return createWakeflowDurableId(kind, parseUuidV4(deterministicUuidV4(`${kind}:${namespace}`, ...parts), "$uuid"));
}
/** 追加命令的 commitId 由 Demand 与客户端幂等键派生，重试自然命中同一提交。 */
export function deriveDemandCommitId(demandId, idempotencyKey) {
    return deriveDurableId("demand-event-commit", "append-command", demandId, idempotencyKey);
}
