import { computeCanonicalJsonSha256Digest, } from "../../foundation/crypto/canonical-json-sha256.js";
import { parseSha256Digest, Sha256Error, } from "../../foundation/crypto/sha256.js";
import { parseJsonValue, JsonValueError, } from "../../foundation/data/json-value.js";
import { parsePlainRecord, PassiveOwnDataError, } from "../../foundation/data/passive-own-data.js";
import { parseWakeflowWorkspaceHostResourceProfile, WakeflowWorkspaceHostResourceProfileError, WAKEFLOW_WORKSPACE_HOST_IDS, } from "../workspace-host-resource-profile.js";
import { createWakeflowWorkspaceStaticResourceMatrix, } from "../wakeflow-workspace-static-resource-matrix.js";
import { parseWakeflowHostMaintenanceContribution, WakeflowHostMaintenanceContributionError, } from "./wakeflow-host-maintenance-contribution.js";
import { parseWakeflowStaticMaterializationPreview, WakeflowStaticMaterializationPreviewError, } from "./wakeflow-static-materialization-preview-contract.js";
const ERROR_MESSAGES = {
    input: "Wakeflow maintenance execution plan input is invalid.",
    host: "Wakeflow maintenance execution plan host identity is invalid.",
    "shared-preview": "Wakeflow maintenance execution plan shared preview is invalid.",
    "host-contribution": "Wakeflow maintenance execution plan host contribution is invalid.",
    matrix: "Wakeflow maintenance execution plan host profile does not match its matrix.",
    order: "Wakeflow maintenance execution plan step order is invalid.",
    digest: "Wakeflow maintenance execution plan digest is invalid.",
};
/** 聚合维护执行计划准入失败的稳定、脱敏错误。 */
export class WakeflowMaintenanceExecutionPlanError extends Error {
    name = "WakeflowMaintenanceExecutionPlanError";
    code = "wakeflow-maintenance-execution-plan";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
const HOST_ID_SET = new Set(WAKEFLOW_WORKSPACE_HOST_IDS);
const JOURNAL_MAXIMUM_STEPS = 256;
function fail(reason, path) {
    throw new WakeflowMaintenanceExecutionPlanError(reason, path);
}
function parseHostId(value, path) {
    if (typeof value !== "string" || !HOST_ID_SET.has(value)) {
        fail("host", path);
    }
    return value;
}
function parseSharedPreview(value) {
    try {
        return parseWakeflowStaticMaterializationPreview(value);
    }
    catch (error) {
        if (error instanceof WakeflowStaticMaterializationPreviewError) {
            fail("shared-preview", error.path);
        }
        throw error;
    }
}
function parseContribution(value) {
    if (value === null)
        return null;
    try {
        return parseWakeflowHostMaintenanceContribution(value);
    }
    catch (error) {
        if (error instanceof WakeflowHostMaintenanceContributionError) {
            fail("host-contribution", error.path);
        }
        throw error;
    }
}
function sharedStep(value, dependencies = value.dependsOn) {
    return Object.freeze({
        boundary: "shared-static",
        stepId: value.stepId,
        stepKind: value.kind,
        ownerId: value.ownerId,
        targetKey: value.targetKey,
        sourceDigest: value.sourceDigest,
        targetDigest: value.targetDigest,
        dependsOn: Object.freeze([...dependencies]),
    });
}
function hostStep(hostId, capabilityId, operation, dependencies) {
    return Object.freeze({
        boundary: "host-capability",
        stepId: `host-effect:${operation.operationId}`,
        hostId,
        capabilityId,
        operationId: operation.operationId,
        operationKind: operation.operationKind,
        ownerId: operation.ownerId,
        targetKey: operation.targetKey,
        sourceDigest: operation.sourceDigest,
        targetDigest: operation.targetDigest,
        payloadDigest: operation.payloadDigest,
        dependsOn: Object.freeze([...dependencies]),
    });
}
function orderedSteps(preview, contribution) {
    const config = preview.steps.find((entry) => entry.kind === "publish-config");
    const steps = preview.steps
        .filter((entry) => entry.kind !== "publish-config")
        .map((entry) => sharedStep(entry));
    if (contribution !== null) {
        for (const operation of contribution.operations) {
            const predecessor = steps.at(-1);
            const dependencies = predecessor === undefined
                ? []
                : [predecessor.stepId];
            steps.push(hostStep(contribution.hostId, contribution.capabilityId, operation, dependencies));
        }
    }
    if (config !== undefined) {
        steps.push(sharedStep(config, steps.map((entry) => entry.stepId)));
    }
    return Object.freeze(steps);
}
function combinedBlockers(preview, contribution, stepCount) {
    const blockers = new Set(preview.blockerCodes);
    if (contribution !== null) {
        for (const code of contribution.blockerCodes) {
            blockers.add(`host:${contribution.hostId}:${contribution.capabilityId}:${code}`);
        }
    }
    if (stepCount > JOURNAL_MAXIMUM_STEPS) {
        blockers.add("maintenance-step-budget-exceeded");
    }
    return Object.freeze([...blockers].sort());
}
function planDigestBasis(value) {
    return {
        ...value,
        kind: "WakeflowMaintenanceExecutionPlanDigestBasis",
    };
}
/** 计算不包含自身摘要字段的聚合执行计划语义摘要。 */
export function computeWakeflowMaintenanceExecutionPlanDigest(value) {
    return computeCanonicalJsonSha256Digest(planDigestBasis(value));
}
function buildPlan(hostId, preview, contribution) {
    if (contribution !== null && contribution.hostId !== hostId) {
        fail("host-contribution", "$plan.hostContribution.hostId");
    }
    const steps = orderedSteps(preview, contribution);
    if (new Set(steps.map((entry) => entry.stepId)).size !== steps.length) {
        fail("order", "$plan.steps");
    }
    const blockerCodes = combinedBlockers(preview, contribution, steps.length);
    const basis = Object.freeze({
        kind: "WakeflowMaintenanceExecutionPlan",
        schemaVersion: 1,
        executionBoundary: "preview-only",
        hostId,
        status: blockerCodes.length === 0 ? "ready" : "blocked",
        blockerCodes,
        sharedPreview: preview,
        hostContribution: contribution,
        steps,
    });
    return Object.freeze({
        ...basis,
        planDigest: computeWakeflowMaintenanceExecutionPlanDigest(basis),
    });
}
/**
 * 依据已确认 Host Profile 组合 shared preview 与当前宿主 contribution。
 */
export function createWakeflowMaintenanceExecutionPlan(previewValue, currentHostProfileValue, contributionValue) {
    const preview = parseSharedPreview(previewValue);
    let profile;
    try {
        profile = parseWakeflowWorkspaceHostResourceProfile(currentHostProfileValue);
    }
    catch (error) {
        if (error instanceof WakeflowWorkspaceHostResourceProfileError) {
            fail("host", error.path);
        }
        throw error;
    }
    if (createWakeflowWorkspaceStaticResourceMatrix(profile).matrixDigest
        !== preview.matrixDigest) {
        fail("matrix", "$profile");
    }
    return buildPlan(profile.hostId, preview, parseContribution(contributionValue));
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
function equivalentJson(left, right, path) {
    let leftJson;
    try {
        leftJson = parseJsonValue(left, path);
    }
    catch (error) {
        if (error instanceof JsonValueError)
            fail("input", error.path);
        throw error;
    }
    return computeCanonicalJsonSha256Digest(leftJson)
        === computeCanonicalJsonSha256Digest(right);
}
/** 把任意输入重验为可由两类已知来源唯一推导的聚合执行计划。 */
export function parseWakeflowMaintenanceExecutionPlan(value) {
    let record;
    try {
        record = parsePlainRecord(value, "$plan");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", error.path);
        throw error;
    }
    if (Object.keys(record).sort().join("\u0000")
        !== "blockerCodes\u0000executionBoundary\u0000hostContribution\u0000hostId\u0000kind\u0000planDigest\u0000schemaVersion\u0000sharedPreview\u0000status\u0000steps"
        || record.kind !== "WakeflowMaintenanceExecutionPlan"
        || record.schemaVersion !== 1
        || record.executionBoundary !== "preview-only"
        || (record.status !== "ready" && record.status !== "blocked")) {
        fail("input", "$plan");
    }
    const expected = buildPlan(parseHostId(record.hostId, "$plan.hostId"), parseSharedPreview(record.sharedPreview), parseContribution(record.hostContribution));
    if (record.status !== expected.status
        || !equivalentJson(record.blockerCodes, expected.blockerCodes, "$plan.blockerCodes")
        || !equivalentJson(record.steps, expected.steps, "$plan.steps")) {
        fail("order", "$plan");
    }
    if (digest(record.planDigest, "$plan.planDigest") !== expected.planDigest) {
        fail("digest", "$plan.planDigest");
    }
    return expected;
}
