/**
 * Wakeflow Governance / Demand Event Sourcing：逻辑事件流修订号词汇。
 *
 * 逻辑事件修订号与物理提交槽位都从 1 开始且必须连续。修订号 0 只表示追加操作预期
 * 事件流为空，不会出现在持久化事件中；`commitSequence`独立计数一次命令提交。
 */
const ERROR_MESSAGES = {
    "stream-revision": "Demand event stream revision must be a positive safe integer.",
    "commit-sequence": "Demand event commit sequence must be a positive safe integer.",
};
export class DemandEventStreamPositionError extends Error {
    name = "DemandEventStreamPositionError";
    code = "wakeflow-demand-event-stream-position";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function parsePositivePosition(value, reason, path) {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new DemandEventStreamPositionError(reason, path);
    }
    return value;
}
export function parseDemandEventStreamRevision(value, path = "$streamRevision") {
    return parsePositivePosition(value, "stream-revision", path);
}
export function parseDemandEventCommitSequence(value, path = "$commitSequence") {
    return parsePositivePosition(value, "commit-sequence", path);
}
