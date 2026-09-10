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
] as const);

export type TestStepVerdict = (typeof TEST_STEP_VERDICTS)[number];

export const TEST_FAILURE_CLASSIFICATIONS = Object.freeze([
  "product-defect",
  "harness-defect",
  "environment",
  "flaky",
  "missing-evidence",
  "out-of-scope",
  "needs-decision",
] as const);

export type TestFailureClassification = (typeof TEST_FAILURE_CLASSIFICATIONS)[number];

export const TEST_FAILURE_OWNERS = Object.freeze([
  "implementation",
  "test",
  "environment",
  "user",
] as const);

export type TestFailureOwner = (typeof TEST_FAILURE_OWNERS)[number];

/** 允许 Test 任务再来一次的分类；其余分类各有自己的出口。 */
export const RERUNNABLE_TEST_FAILURE_CLASSIFICATIONS: readonly TestFailureClassification[] =
  Object.freeze(["harness-defect", "flaky", "missing-evidence"]);

const VERDICT_SET: ReadonlySet<string> = new Set(TEST_STEP_VERDICTS);
const CLASSIFICATION_SET: ReadonlySet<string> = new Set(TEST_FAILURE_CLASSIFICATIONS);
const OWNER_SET: ReadonlySet<string> = new Set(TEST_FAILURE_OWNERS);

export function isTestStepVerdict(value: unknown): value is TestStepVerdict {
  return typeof value === "string" && VERDICT_SET.has(value);
}

export function isTestFailureClassification(value: unknown): value is TestFailureClassification {
  return typeof value === "string" && CLASSIFICATION_SET.has(value);
}

export function isTestFailureOwner(value: unknown): value is TestFailureOwner {
  return typeof value === "string" && OWNER_SET.has(value);
}
