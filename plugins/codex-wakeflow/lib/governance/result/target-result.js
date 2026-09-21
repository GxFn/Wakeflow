import { WAKEFLOW_TARGET_RESULT_SCHEMA } from "../../contracts/generated/governance/result/target-result.generated.js";
import { WAKEFLOW_IMPLEMENTATION_TARGET_RESULT_REPORT_SCHEMA } from "../../contracts/generated/governance/result/implementation-target-result-report.generated.js";
import { WAKEFLOW_GIT_OBJECT_ID_SCHEMA } from "../../contracts/generated/foundation/git-object-id.generated.js";
import { WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA } from "../../contracts/generated/foundation/portable-resource-path.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA } from "../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_UTC_INSTANT_SCHEMA } from "../../contracts/generated/foundation/utc-instant.generated.js";
import { WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA } from "../../contracts/generated/governance/ledger/ledger-authority-member-reference.generated.js";
import { WAKEFLOW_TASK_PACKAGE_SCHEMA } from "../../contracts/generated/governance/tasking/task-package.generated.js";
import { WAKEFLOW_WINDOW_HOST_BINDING_SCHEMA } from "../../contracts/generated/workspace/window-host-binding.generated.js";
import { WAKEFLOW_TEST_TARGET_RESULT_REPORT_SCHEMA } from "../../contracts/generated/governance/result/test-target-result-report.generated.js";
import { parseWakeflowDurableIdOfKind, WakeflowDurableIdError, } from "../../contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { parseSha256Digest, Sha256Error, } from "../../foundation/crypto/sha256.js";
import { DeterministicJsonDocumentError, parseDeterministicJsonDocument, renderDeterministicJsonDocument, } from "../../foundation/data/deterministic-json-document.js";
import { JsonValueError, parseJsonValue, } from "../../foundation/data/json-value.js";
import { parsePortableResourcePath, PortableResourcePathError, } from "../../foundation/filesystem/portable-resource-path.js";
import { deriveDurableId } from "../../kernel/ids.js";
import { derivedIdFromWorkClaim } from "../../kernel/work-claims.js";
import { createRuntimeJsonSchemaValidator } from "../../foundation/schema/runtime-json-schema.js";
import { parseUtcInstant, UtcInstantError, } from "../../foundation/time/utc-instant.js";
import { parseImplementationTargetResultReport, ImplementationTargetResultReportError, } from "./implementation-target-result-report.js";
import { parseTestTargetResultReport, TestTargetResultReportError, } from "./test-target-result-report.js";
/**
 * Wakeflow Governance / Result：由Wakeflow authority补齐的不可变TargetResult。
 *
 * TargetResult将Agent Report与当前TaskPackage、assignment和Host Effect Event闭合。结构完整只
 * 表示可进入Controller review，不表示结果真实、任务已接受或Demand已完成。
 */
const RESULT_KIND = "WakeflowTargetResult";
const RESULT_SCHEMA_VERSION = 1;
const ERROR_MESSAGES = {
    json: "Target Result is not passive JSON data.",
    schema: "Target Result does not satisfy its Schema.",
    identifier: "Target Result contains an invalid identity.",
    digest: "Target Result contains an invalid or inconsistent digest.",
    path: "Target Result contains an invalid portable resource path.",
    time: "Target Result contains an invalid time.",
    claim: "Target Result requires a valid delivery fence claim.",
    report: "Target Result requires a matching implementation or Test Report.",
    relation: "Target Result sources are inconsistent.",
    representation: "Target Result bytes are not deterministic.",
};
export class TargetResultError extends Error {
    name = "TargetResultError";
    code = "wakeflow-target-result";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
const validateWire = createRuntimeJsonSchemaValidator(WAKEFLOW_TARGET_RESULT_SCHEMA, [
    WAKEFLOW_GIT_OBJECT_ID_SCHEMA,
    WAKEFLOW_LEDGER_AUTHORITY_MEMBER_REFERENCE_SCHEMA,
    WAKEFLOW_PORTABLE_RESOURCE_PATH_SCHEMA,
    WAKEFLOW_SHA256_DIGEST_SCHEMA,
    WAKEFLOW_IMPLEMENTATION_TARGET_RESULT_REPORT_SCHEMA,
    WAKEFLOW_TEST_TARGET_RESULT_REPORT_SCHEMA,
    WAKEFLOW_TASK_PACKAGE_SCHEMA,
    WAKEFLOW_UTC_INSTANT_SCHEMA,
    WAKEFLOW_WINDOW_HOST_BINDING_SCHEMA,
]);
function fail(reason, path) {
    throw new TargetResultError(reason, path);
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
function resourcePath(value, path) {
    try {
        return parsePortableResourcePath(value, path);
    }
    catch (error) {
        if (error instanceof PortableResourcePathError)
            fail("path", path);
        throw error;
    }
}
function instant(value, path) {
    try {
        return parseUtcInstant(value, path);
    }
    catch (error) {
        if (error instanceof UtcInstantError)
            fail("time", path);
        throw error;
    }
}
function resultBasis(value) {
    return value.workType === "test"
        ? Object.freeze({
            kind: RESULT_KIND,
            schemaVersion: RESULT_SCHEMA_VERSION,
            workType: "test",
            targetResultId: value.targetResultId,
            programId: value.programId,
            demandId: value.demandId,
            targetTaskId: value.targetTaskId,
            deliveryId: value.deliveryId,
            taskPackage: value.taskPackage,
            assignment: value.assignment,
            delivery: value.delivery,
            testExecution: value.testExecution,
            report: value.report,
        })
        : Object.freeze({
            kind: RESULT_KIND,
            schemaVersion: RESULT_SCHEMA_VERSION,
            workType: "implementation",
            targetResultId: value.targetResultId,
            programId: value.programId,
            demandId: value.demandId,
            targetTaskId: value.targetTaskId,
            deliveryId: value.deliveryId,
            taskPackage: value.taskPackage,
            assignment: value.assignment,
            delivery: value.delivery,
            report: value.report,
        });
}
export function parseTargetResult(value) {
    let json;
    try {
        json = parseJsonValue(value, "$result");
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
        kind: RESULT_KIND,
        schemaVersion: RESULT_SCHEMA_VERSION,
        workType: wire.workType,
        targetResultId: id(wire.targetResultId, "target-result", "$/targetResultId"),
        programId: id(wire.programId, "program", "$/programId"),
        demandId: id(wire.demandId, "demand", "$/demandId"),
        targetTaskId: id(wire.targetTaskId, "target-task", "$/targetTaskId"),
        deliveryId: id(wire.deliveryId, "target-delivery", "$/deliveryId"),
        taskPackage: Object.freeze({
            taskPackageId: id(wire.taskPackage.taskPackageId, "task-package", "$/taskPackage/taskPackageId"),
            ref: resourcePath(wire.taskPackage.ref, "$/taskPackage/ref"),
            digest: digest(wire.taskPackage.digest, "$/taskPackage/digest"),
        }),
        delivery: Object.freeze({
            generation: wire.delivery.generation,
            fence: Object.freeze({
                claimId: id(wire.delivery.fence.claimId, "work-claim", "$/delivery/fence/claimId"),
                claimDigest: digest(wire.delivery.fence.claimDigest, "$/delivery/fence/claimDigest"),
            }),
            outcomeDigest: digest(wire.delivery.outcomeDigest, "$/delivery/outcomeDigest"),
            disposition: wire.delivery.disposition,
            readbackStatus: wire.delivery.readbackStatus,
            observedAt: instant(wire.delivery.observedAt, "$/delivery/observedAt"),
        }),
    };
    let basis;
    if (wire.workType === "implementation") {
        let report;
        try {
            report = parseImplementationTargetResultReport(wire.report);
        }
        catch (error) {
            if (error instanceof ImplementationTargetResultReportError) {
                fail("report", "$/report");
            }
            throw error;
        }
        if (!("repositoryId" in wire.assignment)) {
            fail("schema", "$/assignment/repositoryId");
        }
        basis = resultBasis({
            ...common,
            workType: "implementation",
            assignment: Object.freeze({
                repositoryId: id(wire.assignment.repositoryId, "repository", "$/assignment/repositoryId"),
                windowId: id(wire.assignment.windowId, "window", "$/assignment/windowId"),
            }),
            report,
        });
    }
    else {
        let report;
        try {
            report = parseTestTargetResultReport(wire.report);
        }
        catch (error) {
            if (error instanceof TestTargetResultReportError) {
                fail("report", "$/report");
            }
            throw error;
        }
        if (wire.testExecution === undefined) {
            fail("schema", "$/testExecution");
        }
        basis = resultBasis({
            ...common,
            workType: "test",
            assignment: Object.freeze({
                windowId: id(wire.assignment.windowId, "window", "$/assignment/windowId"),
            }),
            testExecution: Object.freeze({
                testAttemptId: id(wire.testExecution.testAttemptId, "test-attempt", "$/testExecution/testAttemptId"),
                ordinal: wire.testExecution.ordinal,
                stepIds: wire.testExecution.stepIds === null
                    ? null
                    : Object.freeze([...wire.testExecution.stepIds]),
            }),
            report,
        });
    }
    if (targetResultIdForClaim(basis.delivery.fence.claimId) !== basis.targetResultId) {
        fail("relation", "$result");
    }
    // reportedAt 是Report来源时钟给出的审计事实；Result与Host Effect的因果关系
    // 由exact identity、Observation摘要、Event引用和Aggregate CAS闭合，不由墙钟排序推断。
    const resultDigest = digest(wire.resultDigest, "$/resultDigest");
    if (computeCanonicalJsonSha256Digest(basis) !== resultDigest) {
        fail("digest", "$/resultDigest");
    }
    return Object.freeze({ ...basis, resultDigest });
}
/** 结果身份由围栏声明的 UUID 派生：一个声明代际至多一份结果。 */
export function targetResultIdForClaim(claimId) {
    return derivedIdFromWorkClaim("target-result", claimId);
}
/** 结果事件与提交的身份由同一声明派生，重放自然命中同一提交。 */
export function targetResultRecordedEventIdFromResult(resultValue) {
    const result = parseTargetResult(resultValue);
    return deriveDurableId("demand-event", "target-result", result.delivery.fence.claimId);
}
export function targetResultRecordedCommitIdFromResult(resultValue) {
    const result = parseTargetResult(resultValue);
    return deriveDurableId("demand-event-commit", "target-result", result.delivery.fence.claimId);
}
export function renderTargetResult(value) {
    return renderDeterministicJsonDocument(parseTargetResult(value), "$result");
}
export function parseTargetResultDocument(textValue) {
    let json;
    try {
        json = parseDeterministicJsonDocument(textValue, "$result");
    }
    catch (error) {
        if (error instanceof DeterministicJsonDocumentError) {
            fail("representation", "$result");
        }
        throw error;
    }
    const result = parseTargetResult(json);
    if (renderTargetResult(result) !== textValue) {
        fail("representation", "$result");
    }
    return result;
}
export function targetResultOutcome(value) {
    return parseTargetResult(value).report.outcome;
}
