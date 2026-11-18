/**
 * Wakeflow Governance / Result：任务包之外收到的指示（ADR-0030 决定 3）。
 *
 * 使用者直接对目标窗口说话、别的会话发来消息，系统里原来没有任何记录。记录版本 2 的两类报告都带这一项：
 * 谁给的、说了什么、怎么处理的。没有收到就是空数组，不省略——"没有"也是一个要申报的事实。它是目标的自述，
 * 不是宿主观察；评审单元把它与 Wakeflow 自己的观察并排给出，判断留给 Controller。
 */
export const TARGET_RESULT_OUTSIDE_INSTRUCTION_SOURCES = Object.freeze([
    "user",
    "other-session",
    "unknown",
]);
/** followed：不改合同，照做了；declined：与任务包冲突，没有照做；escalated：停下来上报。 */
export const TARGET_RESULT_OUTSIDE_INSTRUCTION_HANDLINGS = Object.freeze([
    "followed",
    "declined",
    "escalated",
]);
const OUTSIDE_INSTRUCTIONS_MAXIMUM = 16;
function member(value, allowed, path, parsing) {
    if (typeof value !== "string" || !allowed.includes(value)) {
        parsing.fail(path);
    }
    return value;
}
export function parseTargetResultOutsideInstructions(value, path, parsing) {
    if (!Array.isArray(value) || value.length > OUTSIDE_INSTRUCTIONS_MAXIMUM)
        parsing.fail(path);
    return Object.freeze(value.map((entry, index) => {
        const entryPath = `${path}/${index}`;
        const record = parsing.record(entry, ["handling", "source", "summary"], entryPath);
        return Object.freeze({
            source: member(record.source, TARGET_RESULT_OUTSIDE_INSTRUCTION_SOURCES, `${entryPath}/source`, parsing),
            summary: parsing.text(record.summary, `${entryPath}/summary`),
            handling: member(record.handling, TARGET_RESULT_OUTSIDE_INSTRUCTION_HANDLINGS, `${entryPath}/handling`, parsing),
        });
    }));
}
