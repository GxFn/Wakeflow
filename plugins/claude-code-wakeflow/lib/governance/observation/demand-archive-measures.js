/**
 * Wakeflow Governance / Observation：一个已归档 Demand 的三个度量（1.4 开发计划第 1 节）。
 *
 * 从归档负载里的事件算，纯函数、不读盘。口径与维护者工具 `wf metrics archive` 相同（测试用同一份归档
 * 交叉核对两边的数）：手写字节数只含归档里原样存着的任务包文字与评审决定文字；评审阶段是结果导入到针对
 * 它的决定。Controller 一侧的调用数归档里量不出来——读取（status、inspect）不留记录——页面给的是
 * 留下记录的步数（事件提交数）与其中由目标窗口导入结果的那几次。
 */
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function recordAt(value, key) {
    const member = isRecord(value) ? value[key] : undefined;
    return isRecord(member) ? member : {};
}
function stringAt(value, key) {
    const member = isRecord(value) ? value[key] : undefined;
    return typeof member === "string" ? member : "";
}
function listAt(value, key) {
    const member = isRecord(value) ? value[key] : undefined;
    return Array.isArray(member) ? member : [];
}
const ENCODER = new TextEncoder();
/** UTF-8 字节数；不成对的代理按替换字符计，与维护者工具的算法一致，所以不走会拒绝它们的严格编码。 */
function bytesOf(texts) {
    let total = 0;
    for (const text of texts) {
        if (typeof text === "string")
            total += ENCODER.encode(text).byteLength;
    }
    return total;
}
function median(values) {
    if (values.length === 0)
        return null;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    const upper = sorted[middle] ?? 0;
    if (sorted.length % 2 === 1)
        return upper;
    return ((sorted[middle - 1] ?? 0) + upper) / 2;
}
function secondsBetween(earlier, later) {
    const from = Date.parse(earlier);
    const to = Date.parse(later);
    if (Number.isNaN(from) || Number.isNaN(to) || to < from)
        return null;
    return Math.round((to - from) / 1000);
}
/** 任务包里由 Controller 写的文字：目标、已确认的上下文、边界三段、完成预期、锚点的三句话。 */
function taskPackageAuthoredBytes(data) {
    const taskPackage = recordAt(data, "taskPackage");
    const boundaries = recordAt(taskPackage, "boundaries");
    const anchors = listAt(taskPackage, "acceptanceAnchors").flatMap((anchor) => [
        stringAt(anchor, "claim"),
        stringAt(anchor, "probe"),
        stringAt(anchor, "expected"),
    ]);
    return bytesOf([
        stringAt(taskPackage, "objective"),
        ...listAt(taskPackage, "confirmedContext"),
        ...listAt(boundaries, "inScope"),
        ...listAt(boundaries, "outOfScope"),
        ...listAt(boundaries, "forbidden"),
        ...listAt(taskPackage, "completionExpectations"),
        ...anchors,
    ]);
}
/** 评审决定里由 Controller 写的文字：理由、独立检查的做法与观察、阻塞原因、剩余风险。 */
function decisionAuthoredBytes(decision) {
    const checks = listAt(decision, "independentChecks").flatMap((check) => [
        stringAt(check, "method"),
        stringAt(check, "observation"),
    ]);
    return bytesOf([
        stringAt(decision, "rationale"),
        ...checks,
        ...listAt(decision, "blockingReasons"),
        ...listAt(decision, "residualRisks"),
    ]);
}
/** 评审阶段的时长：结果导入到针对这份结果的决定。 */
function reviewSeconds(events) {
    const resultAt = new Map();
    const seconds = [];
    for (const event of events) {
        if (event.eventType === "result.target-result-recorded") {
            resultAt.set(stringAt(recordAt(event.data, "result"), "targetResultId"), event.recordedAt);
        }
        if (event.eventType !== "review.target-result-decided")
            continue;
        const reviewed = recordAt(recordAt(event.data, "decision"), "reviewed");
        const started = resultAt.get(stringAt(reviewed, "targetResultId"));
        const elapsed = started === undefined ? null : secondsBetween(started, event.recordedAt);
        if (elapsed !== null)
            seconds.push(elapsed);
    }
    return seconds;
}
function countOf(events, eventType) {
    return events.filter((event) => event.eventType === eventType).length;
}
/** 一份归档的度量；`eventCommits` 是负载里事件提交文件的个数。 */
export function measureDemandArchiveEvents(events, eventCommits) {
    let packageBytes = 0;
    let decisionBytes = 0;
    for (const event of events) {
        if (event.eventType === "tasking.target-task-planned") {
            packageBytes += taskPackageAuthoredBytes(event.data);
        }
        if (event.eventType === "review.target-result-decided") {
            decisionBytes += decisionAuthoredBytes(recordAt(event.data, "decision"));
        }
    }
    const targets = countOf(events, "tasking.target-task-planned");
    const review = reviewSeconds(events);
    return Object.freeze({
        eventCommits,
        resultImports: countOf(events, "result.target-result-recorded"),
        targets,
        authoredBytes: Object.freeze({
            total: packageBytes + decisionBytes,
            taskPackages: packageBytes,
            decisions: decisionBytes,
            perTarget: targets === 0 ? 0 : Math.round((packageBytes + decisionBytes) / targets),
        }),
        reviewSeconds: Object.freeze({ values: Object.freeze(review), median: median(review) }),
    });
}
