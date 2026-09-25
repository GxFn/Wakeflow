import { WAKEFLOW_TEST_EXECUTION_ATTEMPT_SCHEMA } from "../../contracts/generated/governance/testing/test-execution-attempt.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../contracts/generated/foundation/sha256-digest.generated.js";
import { parseWakeflowDurableIdOfKind, WakeflowDurableIdError, } from "../../contracts/identity/wakeflow-durable-id.js";
import { parseSha256Digest, Sha256Error, } from "../../foundation/crypto/sha256.js";
import { JsonValueError, parseJsonValue, } from "../../foundation/data/json-value.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import { computeTaskPackageDigest, parseTaskPackage, TaskPackageError, } from "../tasking/task-package.js";
/**
 * Wakeflow Governance / Testing：一次Controller授权的逻辑Test执行attempt。
 *
 * Initial与rerun attempt都表示一次Controller授权的真实Test执行，并绑定 test 任务包
 * 的身份与摘要（测试合同就在包里，ADR-0012 D4）。它与host-send attempt严格分离：同一
 * 投递的 rearm 不创建新Test attempt。环境setup字段是Test执行前必须落实的指令，不是
 * 完成回执，也不授权Wakeflow直接操作环境。
 */
const ATTEMPT_KIND = "WakeflowTestExecutionAttempt";
const ATTEMPT_SCHEMA_VERSION = 1;
const ERROR_MESSAGES = {
    json: "Test execution attempt is not passive JSON data.",
    schema: "Test execution attempt does not satisfy its Schema.",
    identifier: "Test execution attempt contains an invalid typed identity.",
    digest: "Test execution attempt contains an invalid digest.",
    "task-package": "Test execution attempt requires a valid test TaskPackage.",
    relation: "Test execution attempt does not match its test TaskPackage.",
};
/** Test execution attempt准入或来源闭合失败时的稳定错误。 */
export class TestExecutionAttemptError extends Error {
    name = "TestExecutionAttemptError";
    code = "wakeflow-test-execution-attempt";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
const validateWire = createRuntimeJsonSchemaValidator(WAKEFLOW_TEST_EXECUTION_ATTEMPT_SCHEMA, [WAKEFLOW_SHA256_DIGEST_SCHEMA]);
function fail(reason, path) {
    throw new TestExecutionAttemptError(reason, path);
}
function id(value, kind, path) {
    try {
        return parseWakeflowDurableIdOfKind(value, kind, path);
    }
    catch (error) {
        if (error instanceof WakeflowDurableIdError)
            fail("identifier", path);
        throw error;
    }
}
function digest(value, path) {
    try {
        return parseSha256Digest(value, path);
    }
    catch (error) {
        if (error instanceof Sha256Error)
            fail("digest", path);
        throw error;
    }
}
function setupDirective(policy, mode) {
    return policy === "reuse-existing" ||
        (policy === "fresh-once" && mode === "rerun")
        ? "reuse-confirmed-environment"
        : "prepare-fresh-environment";
}
function testPackage(value) {
    let taskPackage;
    try {
        taskPackage = parseTaskPackage(value);
    }
    catch (error) {
        if (error instanceof TaskPackageError)
            fail("task-package", "$taskPackage");
        throw error;
    }
    if (taskPackage.workType !== "test")
        fail("task-package", "$taskPackage");
    return taskPackage;
}
/** 解析并冻结Test execution attempt。 */
export function parseTestExecutionAttempt(value) {
    let json;
    try {
        json = parseJsonValue(value, "$attempt");
    }
    catch (error) {
        if (error instanceof JsonValueError)
            fail("json", error.path);
        throw error;
    }
    const validated = validateWire(json);
    if (!validated.ok)
        fail("schema", validated.path);
    const wire = validated.value;
    const common = {
        kind: ATTEMPT_KIND,
        schemaVersion: ATTEMPT_SCHEMA_VERSION,
        testAttemptId: id(wire.testAttemptId, "test-attempt", "$/testAttemptId"),
        targetTaskId: id(wire.targetTaskId, "target-task", "$/targetTaskId"),
        contract: Object.freeze({
            taskPackageId: id(wire.contract.taskPackageId, "task-package", "$/contract/taskPackageId"),
            taskPackageDigest: digest(wire.contract.taskPackageDigest, "$/contract/taskPackageDigest"),
        }),
        environmentSetup: Object.freeze({
            policy: wire.environmentSetup.policy,
            directive: wire.environmentSetup.directive,
        }),
    };
    if (wire.mode === "initial") {
        return Object.freeze({
            ...common,
            ordinal: 1,
            mode: "initial",
        });
    }
    if (wire.rerunSource === undefined)
        fail("schema", "$/rerunSource");
    const scopedStepIds = wire.rerunSource.stepIds === null ? null : Object.freeze([...wire.rerunSource.stepIds]);
    const rerunSource = Object.freeze({
        stepIds: scopedStepIds,
        previousAttemptId: id(wire.rerunSource.previousAttemptId, "test-attempt", "$/rerunSource/previousAttemptId"),
        previousResult: Object.freeze({
            targetResultId: id(wire.rerunSource.previousResult.targetResultId, "target-result", "$/rerunSource/previousResult/targetResultId"),
            resultDigest: digest(wire.rerunSource.previousResult.resultDigest, "$/rerunSource/previousResult/resultDigest"),
        }),
        reviewDecision: Object.freeze({
            targetReviewDecisionId: id(wire.rerunSource.reviewDecision.targetReviewDecisionId, "target-review-decision", "$/rerunSource/reviewDecision/targetReviewDecisionId"),
            decisionDigest: digest(wire.rerunSource.reviewDecision.decisionDigest, "$/rerunSource/reviewDecision/decisionDigest"),
        }),
    });
    if (rerunSource.previousAttemptId === common.testAttemptId) {
        fail("relation", "$/rerunSource/previousAttemptId");
    }
    return Object.freeze({
        ...common,
        ordinal: wire.ordinal,
        mode: "rerun",
        rerunSource,
    });
}
function attemptContract(taskPackage) {
    return Object.freeze({
        taskPackageId: taskPackage.taskPackageId,
        taskPackageDigest: computeTaskPackageDigest(taskPackage),
    });
}
/** 从一份已准入 test 任务包创建首个逻辑attempt。 */
export function createInitialTestExecutionAttempt(input) {
    const taskPackage = testPackage(input.taskPackage);
    const policy = taskPackage.testContract.setupPolicy;
    return parseTestExecutionAttempt({
        kind: ATTEMPT_KIND,
        schemaVersion: ATTEMPT_SCHEMA_VERSION,
        testAttemptId: input.testAttemptId,
        targetTaskId: taskPackage.targetTaskId,
        contract: attemptContract(taskPackage),
        ordinal: 1,
        mode: "initial",
        environmentSetup: {
            policy,
            directive: setupDirective(policy, "initial"),
        },
    });
}
/** 从上一attempt和已验证的Result/Decision tuple创建下一次真实rerun。 */
export function createRerunTestExecutionAttempt(input) {
    const previousAttempt = parseTestExecutionAttempt(input.previousAttempt);
    const taskPackage = testPackage(input.taskPackage);
    assertTestExecutionAttemptMatchesPackage(previousAttempt, taskPackage);
    const ordinal = previousAttempt.ordinal + 1;
    if (ordinal > taskPackage.testContract.maxAttempts)
        fail("relation", "$/ordinal");
    const policy = taskPackage.testContract.setupPolicy;
    const attempt = parseTestExecutionAttempt({
        kind: ATTEMPT_KIND,
        schemaVersion: ATTEMPT_SCHEMA_VERSION,
        testAttemptId: input.testAttemptId,
        targetTaskId: taskPackage.targetTaskId,
        contract: attemptContract(taskPackage),
        ordinal,
        mode: "rerun",
        environmentSetup: {
            policy,
            directive: setupDirective(policy, "rerun"),
        },
        rerunSource: {
            previousAttemptId: previousAttempt.testAttemptId,
            previousResult: input.previousResult,
            reviewDecision: input.reviewDecision,
            stepIds: input.stepIds,
        },
    });
    if (attempt.mode !== "rerun")
        fail("relation", "$/mode");
    return attempt;
}
/** 复验attempt仍绑定同一 test 任务包（身份、摘要、设置策略与尝试预算）。 */
export function assertTestExecutionAttemptMatchesPackage(attemptValue, taskPackageValue) {
    const attempt = parseTestExecutionAttempt(attemptValue);
    const taskPackage = testPackage(taskPackageValue);
    const contract = attemptContract(taskPackage);
    const policy = taskPackage.testContract.setupPolicy;
    const contractStepIds = new Set(taskPackage.testContract.steps.map((step) => step.stepId));
    if (attempt.targetTaskId !== taskPackage.targetTaskId ||
        attempt.contract.taskPackageId !== contract.taskPackageId ||
        attempt.contract.taskPackageDigest !== contract.taskPackageDigest ||
        attempt.environmentSetup.policy !== policy ||
        attempt.environmentSetup.directive !== setupDirective(policy, attempt.mode) ||
        attempt.ordinal > taskPackage.testContract.maxAttempts ||
        (attempt.mode === "rerun" &&
            attempt.rerunSource.stepIds !== null &&
            attempt.rerunSource.stepIds.some((stepId) => !contractStepIds.has(stepId)))) {
        fail("relation", "$attempt");
    }
}
/** 复验rerun紧接上一attempt且没有跨越或分叉lineage。 */
export function assertRerunTestExecutionAttemptFollows(rerunValue, previousValue) {
    const rerun = parseTestExecutionAttempt(rerunValue);
    const previous = parseTestExecutionAttempt(previousValue);
    if (rerun.mode !== "rerun" ||
        rerun.ordinal !== previous.ordinal + 1 ||
        rerun.targetTaskId !== previous.targetTaskId ||
        rerun.contract.taskPackageId !== previous.contract.taskPackageId ||
        rerun.contract.taskPackageDigest !== previous.contract.taskPackageDigest ||
        rerun.rerunSource.previousAttemptId !== previous.testAttemptId) {
        fail("relation", "$attempt");
    }
}
