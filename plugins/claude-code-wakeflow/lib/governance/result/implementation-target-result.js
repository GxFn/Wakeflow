import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { parseTaskPackage, TaskPackageError, } from "../tasking/task-package.js";
import { assertDeliveryEnvelopeMatchesTaskPackage, DeliveryEnvelopeError, parseDeliveryEnvelope, } from "../delivery/delivery-envelope.js";
import { parseImplementationTargetResultReport, ImplementationTargetResultReportError, } from "./implementation-target-result-report.js";
import { parseTargetResult, TargetResultError, targetResultIdForClaim, } from "./target-result.js";
const ERROR_MESSAGES = {
    "task-package": "Implementation Target Result requires a valid implementation TaskPackage.",
    envelope: "Implementation Target Result requires a valid Delivery Envelope.",
    delivery: "Implementation Target Result requires an accepted or indeterminate delivery generation.",
    report: "Implementation Target Result requires a valid implementation Report.",
    relation: "Implementation Target Result sources are inconsistent.",
};
/** implementation来源闭合失败时的稳定错误。 */
export class ImplementationTargetResultError extends Error {
    name = "ImplementationTargetResultError";
    code = "wakeflow-implementation-target-result";
    reason;
    constructor(reason) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
    }
}
function fail(reason) {
    throw new ImplementationTargetResultError(reason);
}
function assertReportMatchesTaskPackage(report, taskPackage) {
    if (report.repositoryChange.repositoryId !== taskPackage.assignment.repositoryId) {
        fail("relation");
    }
    const expectedAnchors = taskPackage.acceptanceAnchors.map((anchor) => anchor.anchorId);
    const actualAnchors = report.anchorEvidence.map((entry) => entry.anchorId);
    if (actualAnchors.some((anchorId) => !expectedAnchors.includes(anchorId)) ||
        (report.outcome === "completed" &&
            (actualAnchors.length !== expectedAnchors.length ||
                expectedAnchors.some((anchorId) => !actualAnchors.includes(anchorId)))) ||
        (report.outcome === "completed" &&
            taskPackage.commitExpectation === "commit" &&
            report.repositoryChange.disposition !== "committed") ||
        (report.outcome === "completed" &&
            taskPackage.commitExpectation === "leave-uncommitted" &&
            report.repositoryChange.disposition === "committed")) {
        fail("relation");
    }
}
/** 初代际的围栏必须就是信封里的围栏；后续代际的围栏由 rearm 事件与聚合转换证明。 */
export function assertDeliveryBindingFollowsEnvelope(envelope, delivery) {
    if (delivery.generation < 1 ||
        (delivery.generation === 1 &&
            (delivery.fence.claimId !== envelope.fence.claimId ||
                delivery.fence.claimDigest !== envelope.fence.claimDigest))) {
        fail("delivery");
    }
}
export function createImplementationTargetResult(input) {
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
    if (taskPackage.workType !== "implementation")
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
    if (envelope.workType !== "implementation")
        fail("envelope");
    try {
        report = parseImplementationTargetResultReport(input.report);
    }
    catch (error) {
        if (error instanceof ImplementationTargetResultReportError)
            fail("report");
        throw error;
    }
    assertDeliveryBindingFollowsEnvelope(envelope, input.delivery);
    assertReportMatchesTaskPackage(report, taskPackage);
    const basis = {
        kind: "WakeflowTargetResult",
        schemaVersion: 1,
        workType: "implementation",
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
    if (result.workType !== "implementation")
        fail("relation");
    return result;
}
