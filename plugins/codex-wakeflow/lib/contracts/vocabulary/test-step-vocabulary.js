/**
 * Wakeflow Contracts / Vocabulary：测试逐步记录的判定与失败分类词汇（ADR-0012 D4）。
 *
 * 判定由 Test 窗口逐步给出，整体判定由 Wakeflow 派生；失败分类决定机器路由：
 * product-defect 走授权返工，harness-defect、flaky、missing-evidence 再来一次，
 * environment 进入 blocked，out-of-scope 只记录，needs-decision 升级给用户。
 */
export const TEST_STEP_VERDICTS = Object.freeze([
    "pass",
    "fail",
    "blocked",
    "cannot-conclude",
]);
export const TEST_FAILURE_CLASSIFICATIONS = Object.freeze([
    "product-defect",
    "harness-defect",
    "environment",
    "flaky",
    "missing-evidence",
    "out-of-scope",
    "needs-decision",
]);
export const TEST_FAILURE_OWNERS = Object.freeze([
    "implementation",
    "test",
    "environment",
    "user",
]);
/** 允许 Test 任务再来一次的分类；其余分类各有自己的出口。 */
export const RERUNNABLE_TEST_FAILURE_CLASSIFICATIONS = Object.freeze(["harness-defect", "flaky", "missing-evidence"]);
const VERDICT_SET = new Set(TEST_STEP_VERDICTS);
const CLASSIFICATION_SET = new Set(TEST_FAILURE_CLASSIFICATIONS);
const OWNER_SET = new Set(TEST_FAILURE_OWNERS);
export function isTestStepVerdict(value) {
    return typeof value === "string" && VERDICT_SET.has(value);
}
export function isTestFailureClassification(value) {
    return typeof value === "string" && CLASSIFICATION_SET.has(value);
}
export function isTestFailureOwner(value) {
    return typeof value === "string" && OWNER_SET.has(value);
}
