/**
 * Wakeflow Contracts / Vocabulary：封闭的稳定错误码表（ADR-0013 决定 D）。
 *
 * 错误码描述"失败的类别"，不描述失败的位置；位置由 `WakeflowError.path` 给出，
 * 细节由 `reason` 给出。新增类别只能在这里追加，消费者以 `never` 守卫穷尽。
 */
export const WAKEFLOW_ERROR_CODES = Object.freeze([
    /** 请求不是被动 JSON、不满足 Schema，或字段值非法。 */
    "invalid-request",
    /** 超过 `kernel/limits` 表中的某个上限。 */
    "capacity-exceeded",
    /** 隐私扫描命中凭证、未列白的绝对路径或裸 UUID。 */
    "privacy-violation",
    /** 公共输出含私有值、超限或不满足结果 Schema。 */
    "output-boundary",
    /** 工作区根不是已规范化的真实目录，或与请求不一致。 */
    "root-invalid",
    /** 目标记录、流或资源不存在。 */
    "not-found",
    /** 业务前置条件不满足，例如状态不允许该命令。 */
    "precondition-failed",
    /** 乐观并发失败：期望修订与当前修订不一致。 */
    "concurrency-conflict",
    /** 同一幂等键携带了不同的请求参数。 */
    "idempotency-mismatch",
    /** 文件系统或子系统 I/O 失败，未泄漏路径。 */
    "io-failure",
    /** 事务已越过检查点，需要用同一计划显式恢复。 */
    "recovery-required",
    /** 未归类的内部错误，永不携带原始消息。 */
    "unexpected",
]);
const ERROR_CODE_SET = new Set(WAKEFLOW_ERROR_CODES);
export function isWakeflowErrorCode(value) {
    return typeof value === "string" && ERROR_CODE_SET.has(value);
}
