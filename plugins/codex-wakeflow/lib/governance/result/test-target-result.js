import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { parseTaskPackage, TaskPackageError, } from "../tasking/task-package.js";
import { assertDeliveryEnvelopeMatchesTaskPackage, DeliveryEnvelopeError, parseDeliveryEnvelope, } from "../delivery/delivery-envelope.js";
import { assertTestExecutionAttemptMatchesPackage, TestExecutionAttemptError, } from "../testing/test-execution-attempt.js";
import { parseTestTargetResultReport, TestTargetResultReportError, } from "./test-target-result-report.js";
import { assertDeliveryBindingFollowsEnvelope, ImplementationTargetResultError, } from "./implementation-target-result.js";
import { parseTargetResult, TargetResultError, targetResultIdForClaim, } from "./target-result.js";
const ERROR_MESSAGES = {
    "task-package": "Test Target Result requires a valid Test TaskPackage.",
    envelope: "Test Target Result requires a valid test Delivery Envelope.",
    delivery: "Test Target Result requires an accepted or indeterminate delivery generation.",
    report: "Test Target Result requires a valid Test Report.",
    relation: "Test Target Result sources are inconsistent.",
};
/** Test Result来源闭合失败时的稳定错误。 */
export class TestTargetResultError extends Error {
    name = "TestTargetResultError";
    code = "wakeflow-test-target-result";
    reason;
    constructor(reason) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
    }
}
function fail(reason) {
    throw new TestTargetResultError(reason);
}
/**
 * Report 的每一步都属于合同并落在本次尝试的范围内（重跑可只跑失败子集）；
 * `completed` 必须覆盖范围内的每个 stepId 恰一次。
 */
function assertReportMatchesContract(report, taskPackage, scope) {
    // 重跑范围已由 assertTestExecutionAttemptMatchesPackage 证明属于合同。
    const scopedIds = scope === null ? new Set(taskPackage.testContract.steps.map((step) => step.stepId)) : new Set(scope);
    const seen = new Set();
    for (const step of report.steps) {
        if (!scopedIds.has(step.stepId) || seen.has(step.stepId))
            fail("relation");
        seen.add(step.stepId);
    }
    if (report.outcome === "completed" && seen.size !== scopedIds.size) {
        fail("relation");
    }
}
export function createTestTargetResult(input) {
    let taskPackage;
    let envelope;
    let report;
    try {
        taskPackage = parseTaskPackage(input.taskPackage);
    }
    catch (error) {
        if (error instanceof TaskPackageError)
            fail("task-package");
        throw error;
    }
    if (taskPackage.workType !== "test")
        fail("task-package");
    try {
        envelope = parseDeliveryEnvelope(input.envelope);
        assertDeliveryEnvelopeMatchesTaskPackage(envelope, taskPackage);
    }
    catch (error) {
        if (error instanceof DeliveryEnvelopeError)
            fail("envelope");
        throw error;
    }
    if (envelope.workType !== "test")
        fail("envelope");
    try {
        assertTestExecutionAttemptMatchesPackage(envelope.attempt, taskPackage);
    }
    catch (error) {
        if (error instanceof TestExecutionAttemptError)
            fail("envelope");
        throw error;
    }
    try {
        report = parseTestTargetResultReport(input.report);
    }
    catch (error) {
        if (error instanceof TestTargetResultReportError)
            fail("report");
        throw error;
    }
    try {
        assertDeliveryBindingFollowsEnvelope(envelope, input.delivery);
    }
    catch (error) {
        if (error instanceof ImplementationTargetResultError && error.reason === "delivery") {
            fail("delivery");
        }
        throw error;
    }
    const attempt = envelope.attempt;
    const stepIds = attempt.mode === "rerun" ? attempt.rerunSource.stepIds : null;
    assertReportMatchesContract(report, taskPackage, stepIds);
    const basis = {
        kind: "WakeflowTargetResult",
        schemaVersion: 1,
        workType: "test",
        targetResultId: targetResultIdForClaim(input.delivery.fence.claimId),
        programId: taskPackage.programId,
        demandId: taskPackage.demandId,
        targetTaskId: taskPackage.targetTaskId,
        deliveryId: envelope.deliveryId,
        taskPackage: Object.freeze({
            taskPackageId: taskPackage.taskPackageId,
            ref: envelope.target.taskPackageRef,
            digest: envelope.target.taskPackageDigest,
        }),
        assignment: taskPackage.assignment,
        delivery: Object.freeze({
            generation: input.delivery.generation,
            fence: Object.freeze({
                claimId: input.delivery.fence.claimId,
                claimDigest: input.delivery.fence.claimDigest,
            }),
            outcomeDigest: input.delivery.outcomeDigest,
            disposition: input.delivery.disposition,
            readbackStatus: input.delivery.readbackStatus,
            observedAt: input.delivery.observedAt,
        }),
        testExecution: Object.freeze({
            testAttemptId: attempt.testAttemptId,
            ordinal: attempt.ordinal,
            stepIds,
        }),
        report,
    };
    let result;
    try {
        result = parseTargetResult({
            ...basis,
            resultDigest: computeCanonicalJsonSha256Digest(basis),
        });
    }
    catch (error) {
        if (error instanceof TargetResultError)
            fail("relation");
        throw error;
    }
    if (result.workType !== "test")
        fail("relation");
    return result;
}
