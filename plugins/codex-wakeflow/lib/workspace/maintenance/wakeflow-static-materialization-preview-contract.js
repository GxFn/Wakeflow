import { types } from "node:util";
import { parseWakeflowConfig, WakeflowConfigError, } from "../../configuration/wakeflow-config.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { parseSha256Digest, Sha256Error, } from "../../foundation/crypto/sha256.js";
import { parseDenseArray, parsePlainRecord, PassiveOwnDataError, } from "../../foundation/data/passive-own-data.js";
import { createWakeflowGitignoreBodyAuthority, WakeflowGitignoreBodyAuthorityError, } from "../managed-integration/wakeflow-gitignore-body-authority.js";
import { parseWakeflowWorkspaceHostResourceProfile, WakeflowWorkspaceHostResourceProfileError, WAKEFLOW_WORKSPACE_HOST_IDS, } from "../workspace-host-resource-profile.js";
import { createWakeflowWorkspaceStaticResourceMatrix, WakeflowWorkspaceStaticResourceMatrixError, } from "../wakeflow-workspace-static-resource-matrix.js";
/** 静态物化 preview 的闭合词汇、请求准入与稳定错误合同。 */
export const WAKEFLOW_STATIC_MATERIALIZATION_ACTIONS = Object.freeze([
    "fresh-initialize",
    "reconfigure",
    "reconcile",
]);
const WAKEFLOW_STATIC_MATERIALIZATION_STEP_KINDS = Object.freeze([
    "materialize-local-protocol",
    "materialize-shared-coordination-layout",
    "materialize-active-layout",
    "initialize-requirement-board",
    "publish-fresh-active-workspace-projection",
    "materialize-ledger-layout",
    "publish-unregistered-window-runtime",
    "materialize-host-capability-layout",
    "materialize-support-root",
    "recompose-gitignore",
    "recompose-program-instruction",
    "publish-support-memory",
    "publish-config",
]);
const ERROR_MESSAGES = {
    input: "Wakeflow static materialization preview input is invalid.",
    config: "Wakeflow static materialization preview config is invalid.",
    profile: "Wakeflow static materialization preview host profiles are invalid.",
    "root-scope": "Wakeflow static materialization preview lost workspace scope.",
    inspection: "Wakeflow static materialization preview could not inspect workspace facts.",
    aborted: "Wakeflow static materialization preview was aborted.",
};
/** 静态物化 preview 构建失败的稳定、脱敏错误。 */
export class WakeflowStaticMaterializationPreviewError extends Error {
    name = "WakeflowStaticMaterializationPreviewError";
    code = "wakeflow-static-materialization-preview";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
export function failWakeflowStaticMaterializationPreview(reason, path) {
    throw new WakeflowStaticMaterializationPreviewError(reason, path);
}
/** 验证 action-specific desired Config 与完整 Host Profile 集合。 */
export function parseWakeflowStaticMaterializationPreviewRequest(value) {
    let record;
    let profileValues;
    try {
        record = parsePlainRecord(value, "$request");
        profileValues = parseDenseArray(record.hostProfiles, WAKEFLOW_WORKSPACE_HOST_IDS.length, "$request.hostProfiles");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError) {
            failWakeflowStaticMaterializationPreview("input", error.path);
        }
        throw error;
    }
    const required = [
        "action",
        "currentHostProfile",
        "desiredConfig",
        "hostProfiles",
    ];
    const expected = record.signal === undefined ? required : [...required, "signal"].sort();
    const keys = Object.keys(record).sort();
    if (keys.length !== expected.length ||
        keys.some((key, index) => key !== expected[index]) ||
        typeof record.action !== "string" ||
        !WAKEFLOW_STATIC_MATERIALIZATION_ACTIONS.includes(record.action) ||
        (record.signal !== undefined &&
            (typeof record.signal !== "object" ||
                record.signal === null ||
                types.isProxy(record.signal) ||
                !(record.signal instanceof AbortSignal)))) {
        failWakeflowStaticMaterializationPreview("input", "$request");
    }
    const action = record.action;
    if ((action === "reconcile" && record.desiredConfig !== null) ||
        (action !== "reconcile" && record.desiredConfig === null)) {
        failWakeflowStaticMaterializationPreview("input", "$request.desiredConfig");
    }
    let desiredConfig = null;
    if (record.desiredConfig !== null) {
        try {
            desiredConfig = parseWakeflowConfig(record.desiredConfig);
        }
        catch (error) {
            if (error instanceof WakeflowConfigError) {
                failWakeflowStaticMaterializationPreview("config", error.path);
            }
            throw error;
        }
    }
    let currentHostProfile;
    try {
        currentHostProfile = parseWakeflowWorkspaceHostResourceProfile(record.currentHostProfile);
    }
    catch (error) {
        if (error instanceof WakeflowWorkspaceHostResourceProfileError) {
            failWakeflowStaticMaterializationPreview("profile", "$request.currentHostProfile");
        }
        throw error;
    }
    const parsedProfiles = profileValues.map((profile, index) => {
        try {
            return parseWakeflowWorkspaceHostResourceProfile(profile);
        }
        catch (error) {
            if (error instanceof WakeflowWorkspaceHostResourceProfileError) {
                failWakeflowStaticMaterializationPreview("profile", `$request.hostProfiles/${index}`);
            }
            throw error;
        }
    });
    try {
        createWakeflowGitignoreBodyAuthority(parsedProfiles);
    }
    catch (error) {
        if (error instanceof WakeflowGitignoreBodyAuthorityError ||
            error instanceof WakeflowWorkspaceStaticResourceMatrixError) {
            failWakeflowStaticMaterializationPreview("profile", "$request.hostProfiles");
        }
        throw error;
    }
    const matching = parsedProfiles.find((profile) => profile.hostId === currentHostProfile.hostId);
    if (matching === undefined ||
        createWakeflowWorkspaceStaticResourceMatrix(matching).matrixDigest !==
            createWakeflowWorkspaceStaticResourceMatrix(currentHostProfile)
                .matrixDigest) {
        failWakeflowStaticMaterializationPreview("profile", "$request.currentHostProfile");
    }
    return Object.freeze({
        action,
        desiredConfig,
        currentHostProfile,
        hostProfiles: Object.freeze(parsedProfiles),
        signal: record.signal,
    });
}
const STEP_KIND_SET = new Set(WAKEFLOW_STATIC_MATERIALIZATION_STEP_KINDS);
const STEP_ID_PATTERN = /^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9_:-]*$/u;
const OWNER_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const BLOCKER_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const TARGET_KEY_PATTERN = /^[a-z0-9][a-z0-9_.:-]{0,255}$/u;
const MAXIMUM_STEPS = 256;
const MAXIMUM_BLOCKERS = 256;
const MAXIMUM_IDENTITY_LENGTH = 256;
function digest(value, path) {
    try {
        return parseSha256Digest(value, path);
    }
    catch (error) {
        if (error instanceof Sha256Error) {
            failWakeflowStaticMaterializationPreview("input", path);
        }
        throw error;
    }
}
function nullableDigest(value, path) {
    return value === null ? null : digest(value, path);
}
function previewDigestBasis(value) {
    return {
        ...value,
        kind: "WakeflowStaticMaterializationPreviewDigestBasis",
    };
}
/** 计算不包含自身摘要字段的 preview 语义摘要。 */
export function computeWakeflowStaticMaterializationPreviewDigest(value) {
    return computeCanonicalJsonSha256Digest(previewDigestBasis(value));
}
function parseStep(value, index) {
    let record;
    let dependencies;
    const path = `$preview.steps/${index}`;
    try {
        record = parsePlainRecord(value, path);
        dependencies = parseDenseArray(record.dependsOn, MAXIMUM_STEPS, `${path}.dependsOn`);
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError) {
            failWakeflowStaticMaterializationPreview("input", error.path);
        }
        throw error;
    }
    if (Object.keys(record).sort().join("\u0000") !==
        "dependsOn\u0000kind\u0000ownerId\u0000sourceDigest\u0000stepId\u0000targetDigest\u0000targetKey" ||
        typeof record.stepId !== "string" ||
        record.stepId.length > MAXIMUM_IDENTITY_LENGTH ||
        !record.stepId.isWellFormed() ||
        !STEP_ID_PATTERN.test(record.stepId) ||
        typeof record.kind !== "string" ||
        !STEP_KIND_SET.has(record.kind) ||
        typeof record.ownerId !== "string" ||
        record.ownerId.length > MAXIMUM_IDENTITY_LENGTH ||
        !record.ownerId.isWellFormed() ||
        !OWNER_ID_PATTERN.test(record.ownerId) ||
        typeof record.targetKey !== "string" ||
        !record.targetKey.isWellFormed() ||
        !TARGET_KEY_PATTERN.test(record.targetKey) ||
        dependencies.some((entry) => typeof entry !== "string" ||
            entry.length > MAXIMUM_IDENTITY_LENGTH ||
            !entry.isWellFormed() ||
            !STEP_ID_PATTERN.test(entry)) ||
        new Set(dependencies).size !== dependencies.length) {
        failWakeflowStaticMaterializationPreview("input", path);
    }
    return Object.freeze({
        stepId: record.stepId,
        kind: record.kind,
        ownerId: record.ownerId,
        targetKey: record.targetKey,
        sourceDigest: nullableDigest(record.sourceDigest, `${path}.sourceDigest`),
        targetDigest: digest(record.targetDigest, `${path}.targetDigest`),
        dependsOn: Object.freeze(dependencies),
    });
}
/** 重验 preview 的闭合 shape、拓扑顺序和自身摘要。 */
export function parseWakeflowStaticMaterializationPreview(value) {
    let record;
    let blockerValues;
    let stepValues;
    try {
        record = parsePlainRecord(value, "$preview");
        blockerValues = parseDenseArray(record.blockerCodes, MAXIMUM_BLOCKERS, "$preview.blockerCodes");
        stepValues = parseDenseArray(record.steps, MAXIMUM_STEPS, "$preview.steps");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError) {
            failWakeflowStaticMaterializationPreview("input", error.path);
        }
        throw error;
    }
    if (Object.keys(record).sort().join("\u0000") !==
        "action\u0000blockerCodes\u0000coreLayoutInspectionDigest\u0000currentConfigDigest\u0000desiredConfigDigest\u0000executionBoundary\u0000kind\u0000matrixDigest\u0000planDigest\u0000schemaVersion\u0000status\u0000steps" ||
        record.kind !== "WakeflowStaticMaterializationPreview" ||
        record.schemaVersion !== 1 ||
        record.executionBoundary !== "preview-only" ||
        typeof record.action !== "string" ||
        !WAKEFLOW_STATIC_MATERIALIZATION_ACTIONS.includes(record.action) ||
        (record.status !== "ready" && record.status !== "blocked") ||
        blockerValues.some((entry) => typeof entry !== "string" ||
            entry.length > MAXIMUM_IDENTITY_LENGTH ||
            !entry.isWellFormed() ||
            !BLOCKER_PATTERN.test(entry))) {
        failWakeflowStaticMaterializationPreview("input", "$preview");
    }
    const blockerCodes = Object.freeze(blockerValues);
    if (new Set(blockerCodes).size !== blockerCodes.length ||
        blockerCodes.some((entry, index) => index > 0 && (blockerCodes[index - 1] ?? "") >= entry) ||
        (record.status === "ready") !== (blockerCodes.length === 0)) {
        failWakeflowStaticMaterializationPreview("input", "$preview.blockerCodes");
    }
    const steps = Object.freeze(stepValues.map(parseStep));
    const stepPositions = new Map();
    for (const [index, entry] of steps.entries()) {
        if (stepPositions.has(entry.stepId)) {
            failWakeflowStaticMaterializationPreview("input", `$preview.steps/${index}.stepId`);
        }
        let previousPosition = -1;
        for (const dependency of entry.dependsOn) {
            const position = stepPositions.get(dependency);
            if (position === undefined || position <= previousPosition) {
                failWakeflowStaticMaterializationPreview("input", `$preview.steps/${index}.dependsOn`);
            }
            previousPosition = position;
        }
        stepPositions.set(entry.stepId, index);
    }
    const configIndexes = steps.flatMap((entry, index) => entry.kind === "publish-config" ? [index] : []);
    if (configIndexes.length > 1 ||
        (configIndexes.length === 1 &&
            (configIndexes[0] !== steps.length - 1 ||
                steps.at(-1)?.dependsOn.length !== steps.length - 1))) {
        failWakeflowStaticMaterializationPreview("input", "$preview.steps");
    }
    const action = record.action;
    const status = record.status;
    const currentConfigDigest = nullableDigest(record.currentConfigDigest, "$preview.currentConfigDigest");
    const desiredConfigDigest = nullableDigest(record.desiredConfigDigest, "$preview.desiredConfigDigest");
    if (((action === "fresh-initialize" || action === "reconfigure") &&
        desiredConfigDigest === null) ||
        (action === "reconcile" && desiredConfigDigest !== currentConfigDigest) ||
        (action === "reconcile" && configIndexes.length !== 0) ||
        (status === "ready" &&
            ((action === "fresh-initialize" && currentConfigDigest !== null) ||
                (action !== "fresh-initialize" && currentConfigDigest === null) ||
                (action !== "reconcile" &&
                    configIndexes.length !==
                        (currentConfigDigest === desiredConfigDigest ? 0 : 1))))) {
        failWakeflowStaticMaterializationPreview("input", "$preview");
    }
    const plan = Object.freeze({
        kind: "WakeflowStaticMaterializationPreview",
        schemaVersion: 1,
        executionBoundary: "preview-only",
        action,
        status,
        currentConfigDigest,
        desiredConfigDigest,
        matrixDigest: digest(record.matrixDigest, "$preview.matrixDigest"),
        coreLayoutInspectionDigest: digest(record.coreLayoutInspectionDigest, "$preview.coreLayoutInspectionDigest"),
        blockerCodes,
        steps,
    });
    const planDigest = digest(record.planDigest, "$preview.planDigest");
    if (computeWakeflowStaticMaterializationPreviewDigest(plan) !== planDigest) {
        failWakeflowStaticMaterializationPreview("input", "$preview.planDigest");
    }
    return Object.freeze({ ...plan, planDigest });
}
