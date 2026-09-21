import { WAKEFLOW_CONFIG_SCHEMA, } from "../../contracts/generated/configuration/wakeflow-config.generated.js";
import { WAKEFLOW_SHA256_DIGEST_SCHEMA, } from "../../contracts/generated/foundation/sha256-digest.generated.js";
import { WAKEFLOW_MAINTENANCE_EXECUTION_INTENT_SCHEMA, } from "../../contracts/generated/workspace/maintenance-execution-intent.generated.js";
import { createWakeflowConfigDocumentValue, } from "../../configuration/wakeflow-config-document.js";
import { computeWakeflowConfigDigest, parseWakeflowConfig, WakeflowConfigError, } from "../../configuration/wakeflow-config.js";
import { computeCanonicalJsonSha256Digest, } from "../../foundation/crypto/canonical-json-sha256.js";
import { DeterministicJsonDocumentError, parseDeterministicJsonDocument, renderDeterministicJsonDocument, } from "../../foundation/data/deterministic-json-document.js";
import { JsonValueError, parseJsonValue, } from "../../foundation/data/json-value.js";
import { createRuntimeJsonSchemaValidator, } from "../../foundation/schema/runtime-json-schema.js";
import { parseWakeflowWorkspaceResourceDeclaration, } from "../workspace-resource-declaration.js";
import { parseWakeflowHostMaintenanceContribution, WakeflowHostMaintenanceContributionError, } from "./wakeflow-host-maintenance-contribution.js";
import { createWakeflowMaintenanceExecutionPlan, parseWakeflowMaintenanceExecutionPlan, WakeflowMaintenanceExecutionPlanError, } from "./wakeflow-maintenance-execution-plan.js";
import { parseWakeflowMaintenanceOperationId, WakeflowMaintenanceOperationIdError, wakeflowMaintenanceIntentRef, } from "./wakeflow-maintenance-operation-id.js";
import { parseWakeflowStaticMaterializationPreview, parseWakeflowStaticMaterializationPreviewRequest, WakeflowStaticMaterializationPreviewError, } from "./wakeflow-static-materialization-preview-contract.js";
/**
 * Wakeflow Workspace / Maintenance：可在进程重启后重建 exact execution 的不可变意图。
 *
 * Intent 保存规范化 desired Config、完整 Host Profile 集合、shared preview 与宿主
 * contribution；聚合 steps 始终重新推导，不重复持久化。它不保存源文件正文、绝对
 * 路径、凭据、PID、锁 token、时间戳或可变 checkpoint。
 */
export const WAKEFLOW_MAINTENANCE_EXECUTION_INTENT_ARTIFACT_KIND = "wakeflow-maintenance-execution-intent";
export const WAKEFLOW_MAINTENANCE_EXECUTION_INTENT_SCHEMA_VERSION = 1;
const ERROR_MESSAGES = {
    input: "Wakeflow maintenance execution intent input is invalid.",
    json: "Wakeflow maintenance execution intent is not passive JSON data.",
    schema: "Wakeflow maintenance execution intent does not satisfy its Schema.",
    operation: "Wakeflow maintenance execution intent operation identity is invalid.",
    config: "Wakeflow maintenance execution intent desired Config is invalid.",
    request: "Wakeflow maintenance execution intent Host Profile request is invalid.",
    plan: "Wakeflow maintenance execution intent plan sources are invalid.",
    relation: "Wakeflow maintenance execution intent fields are inconsistent.",
    representation: "Wakeflow maintenance execution intent representation is invalid.",
};
/** Maintenance execution intent 准入失败的稳定、脱敏错误。 */
export class WakeflowMaintenanceExecutionIntentError extends Error {
    name = "WakeflowMaintenanceExecutionIntentError";
    code = "wakeflow-maintenance-execution-intent";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
const validateWire = createRuntimeJsonSchemaValidator(WAKEFLOW_MAINTENANCE_EXECUTION_INTENT_SCHEMA, [WAKEFLOW_CONFIG_SCHEMA, WAKEFLOW_SHA256_DIGEST_SCHEMA]);
function fail(reason, path) {
    throw new WakeflowMaintenanceExecutionIntentError(reason, path);
}
function normalizeConfig(value) {
    try {
        return parseWakeflowConfig(value);
    }
    catch (error) {
        if (error instanceof WakeflowConfigError)
            fail("config", error.path);
        throw error;
    }
}
function normalizeOperationId(value) {
    try {
        return parseWakeflowMaintenanceOperationId(value, "$/operationId");
    }
    catch (error) {
        if (error instanceof WakeflowMaintenanceOperationIdError) {
            fail("operation", "$/operationId");
        }
        throw error;
    }
}
function normalizePreview(value) {
    try {
        return parseWakeflowStaticMaterializationPreview(value);
    }
    catch (error) {
        if (error instanceof WakeflowStaticMaterializationPreviewError) {
            fail("plan", error.path);
        }
        throw error;
    }
}
function normalizeContribution(value) {
    if (value === null)
        return null;
    try {
        return parseWakeflowHostMaintenanceContribution(value);
    }
    catch (error) {
        if (error instanceof WakeflowHostMaintenanceContributionError) {
            fail("plan", "$/hostContribution");
        }
        throw error;
    }
}
function normalizedRequest(preview, desiredConfig, currentHostProfileValue, hostProfileValues) {
    try {
        return parseWakeflowStaticMaterializationPreviewRequest({
            action: preview.action,
            desiredConfig: preview.action === "reconcile" ? null : desiredConfig,
            currentHostProfile: currentHostProfileValue,
            hostProfiles: hostProfileValues,
        });
    }
    catch (error) {
        if (error instanceof WakeflowStaticMaterializationPreviewError) {
            fail("request", "$/hostProfiles");
        }
        throw error;
    }
}
function sortedProfiles(values) {
    // Intent v1把当时完整的两宿主集合写入恢复格式；扩展集合必须新建版本并迁移。
    const sorted = [...values].sort((left, right) => (left.hostId < right.hostId ? -1 : left.hostId > right.hostId ? 1 : 0));
    if (sorted.length !== 2 || sorted[0] === undefined || sorted[1] === undefined) {
        fail("request", "$/hostProfiles");
    }
    return Object.freeze([sorted[0], sorted[1]]);
}
function normalize(wire) {
    const operationId = normalizeOperationId(wire.operationId);
    const desiredConfig = normalizeConfig(wire.desiredConfig);
    const sharedPreview = normalizePreview(wire.sharedPreview);
    const hostContribution = normalizeContribution(wire.hostContribution);
    const request = normalizedRequest(sharedPreview, desiredConfig, wire.currentHostProfile, wire.hostProfiles);
    const hostProfiles = sortedProfiles(request.hostProfiles);
    const currentHostProfile = request.currentHostProfile;
    let plan;
    try {
        plan = createWakeflowMaintenanceExecutionPlan(sharedPreview, currentHostProfile, hostContribution);
    }
    catch (error) {
        if (error instanceof WakeflowMaintenanceExecutionPlanError) {
            fail("plan", error.path);
        }
        throw error;
    }
    if (plan.status !== "ready"
        || plan.steps.length === 0
        || plan.planDigest !== wire.planDigest
        || sharedPreview.desiredConfigDigest
            !== computeWakeflowConfigDigest(desiredConfig)) {
        fail("relation", "$intent");
    }
    const intent = Object.freeze({
        artifactKind: WAKEFLOW_MAINTENANCE_EXECUTION_INTENT_ARTIFACT_KIND,
        schemaVersion: WAKEFLOW_MAINTENANCE_EXECUTION_INTENT_SCHEMA_VERSION,
        operationId,
        desiredConfig,
        currentHostProfile,
        hostProfiles,
        sharedPreview,
        hostContribution,
        planDigest: plan.planDigest,
    });
    return Object.freeze({ intent, plan });
}
function intentRepresentation(intent) {
    return parseJsonValue({
        artifactKind: intent.artifactKind,
        schemaVersion: intent.schemaVersion,
        operationId: intent.operationId,
        desiredConfig: createWakeflowConfigDocumentValue(intent.desiredConfig),
        currentHostProfile: intent.currentHostProfile,
        hostProfiles: intent.hostProfiles,
        sharedPreview: intent.sharedPreview,
        hostContribution: intent.hostContribution,
        planDigest: intent.planDigest,
    }, "$intent");
}
function parseWakeflowMaintenanceExecutionIntentWithPlan(value) {
    let json;
    try {
        json = parseJsonValue(value, "$intent");
    }
    catch (error) {
        if (error instanceof JsonValueError)
            fail("json", error.path);
        throw error;
    }
    const validated = validateWire(json);
    if (!validated.ok)
        fail("schema", validated.path);
    return normalize(validated.value);
}
/** 将任意 JSON 值准入为字段关系已经闭合的 immutable execution intent。 */
export function parseWakeflowMaintenanceExecutionIntent(value) {
    return parseWakeflowMaintenanceExecutionIntentWithPlan(value).intent;
}
/**
 * 从已确认计划、原preview请求与resolved desired Config创建恢复意图。
 */
export function createWakeflowMaintenanceExecutionIntent(operationIdValue, planValue, requestValue, desiredConfigValue) {
    let plan;
    try {
        plan = parseWakeflowMaintenanceExecutionPlan(planValue);
    }
    catch (error) {
        if (error instanceof WakeflowMaintenanceExecutionPlanError) {
            fail("plan", error.path);
        }
        throw error;
    }
    let request;
    try {
        request = parseWakeflowStaticMaterializationPreviewRequest(requestValue);
    }
    catch (error) {
        if (error instanceof WakeflowStaticMaterializationPreviewError) {
            fail("request", "$request");
        }
        throw error;
    }
    const desiredConfig = normalizeConfig(desiredConfigValue);
    if (request.action !== plan.sharedPreview.action
        || request.currentHostProfile.hostId !== plan.hostId
        || (request.action !== "reconcile"
            && request.desiredConfig !== null
            && computeWakeflowConfigDigest(request.desiredConfig)
                !== computeWakeflowConfigDigest(desiredConfig))) {
        fail("relation", "$request");
    }
    return parseWakeflowMaintenanceExecutionIntent({
        artifactKind: WAKEFLOW_MAINTENANCE_EXECUTION_INTENT_ARTIFACT_KIND,
        schemaVersion: WAKEFLOW_MAINTENANCE_EXECUTION_INTENT_SCHEMA_VERSION,
        operationId: operationIdValue,
        desiredConfig: createWakeflowConfigDocumentValue(desiredConfig),
        currentHostProfile: request.currentHostProfile,
        hostProfiles: sortedProfiles(request.hostProfiles),
        sharedPreview: plan.sharedPreview,
        hostContribution: plan.hostContribution,
        planDigest: plan.planDigest,
    });
}
/** 一次准入并重建恢复执行所需的exact plan与无signal request。 */
export function reconstructWakeflowMaintenanceExecutionFromIntent(value) {
    const normalized = parseWakeflowMaintenanceExecutionIntentWithPlan(value);
    const intent = normalized.intent;
    return Object.freeze({
        plan: normalized.plan,
        request: Object.freeze({
            action: intent.sharedPreview.action,
            desiredConfig: intent.sharedPreview.action === "reconcile"
                ? null
                : intent.desiredConfig,
            currentHostProfile: intent.currentHostProfile,
            hostProfiles: intent.hostProfiles,
        }),
    });
}
/** 计算immutable intent的语义摘要，供mutable journal绑定。 */
export function computeWakeflowMaintenanceExecutionIntentDigest(value) {
    return computeCanonicalJsonSha256Digest(intentRepresentation(parseWakeflowMaintenanceExecutionIntent(value)));
}
/** 渲染唯一确定性格式化JSON表示。 */
export function renderWakeflowMaintenanceExecutionIntent(value) {
    return renderDeterministicJsonDocument(intentRepresentation(parseWakeflowMaintenanceExecutionIntent(value)), "$intent");
}
/** 解析磁盘intent并拒绝任何表示漂移。 */
export function parseWakeflowMaintenanceExecutionIntentDocument(text) {
    let json;
    try {
        json = parseDeterministicJsonDocument(text, "$intent");
    }
    catch (error) {
        if (error instanceof DeterministicJsonDocumentError) {
            fail("representation", error.path);
        }
        throw error;
    }
    const intent = parseWakeflowMaintenanceExecutionIntent(json);
    if (renderWakeflowMaintenanceExecutionIntent(intent) !== text) {
        fail("representation", "$intent");
    }
    return intent;
}
/** 为一个operation生成exact intent动态资源声明。 */
export function createWakeflowMaintenanceIntentResourceDeclaration(operationIdValue) {
    const operationId = parseWakeflowMaintenanceOperationId(operationIdValue);
    return parseWakeflowWorkspaceResourceDeclaration({
        kind: "WakeflowWorkspaceResourceDeclaration",
        declarationId: `maintenance.transaction-intent.${operationId}`,
        family: "maintenance",
        ownerId: "workspace-maintenance",
        scope: "host-neutral",
        placement: {
            root: { kind: "workspace" },
            relativePath: wakeflowMaintenanceIntentRef(operationId),
        },
        tracking: { disposition: "ignored", privacy: "runtime-private" },
        nodePolicy: {
            kind: "file",
            mode: "0600",
            linkPolicy: "single-link",
            executablePolicy: "forbidden",
        },
        processing: {
            kind: "resource",
            role: "transaction-artifact",
            allowedMutationRecipes: ["exclusive-create", "exact-retire"],
            recoveryStrategy: "owner-transaction-recovery",
        },
    });
}
