import { types } from "node:util";
import { computeWakeflowConfigDigest, parseWakeflowConfig, WakeflowConfigError, } from "../../configuration/wakeflow-config.js";
import { publishWakeflowConfigAuthority, WakeflowConfigAuthorityPublicationError, } from "../../configuration/wakeflow-config-authority-publication.js";
import { replaceWakeflowConfigAuthority, WakeflowConfigAuthorityReplacementError, } from "../../configuration/wakeflow-config-authority-replacement.js";
import { readWakeflowConfigAuthoritySnapshot, WakeflowConfigAuthoritySnapshotError, } from "../../configuration/wakeflow-config-authority-snapshot.js";
import { validateWakeflowConfigRootPlacements, WakeflowConfigRootPlacementError, } from "../../configuration/wakeflow-config-root-placement.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { parsePlainRecord, PassiveOwnDataError, } from "../../foundation/data/passive-own-data.js";
import { materializeAbsoluteDirectoryPlacement, AbsoluteDirectoryMaterializationError, } from "../../foundation/filesystem/absolute-directory-materialization.js";
import { RootedDirectory, RootedDirectoryError, } from "../../foundation/filesystem/rooted-directory.js";
import { LEDGER_AUTHORITY_LAYOUT_DIGEST } from "../../governance/ledger/ledger-authority-layout.js";
import { LedgerAuthorityStore, LedgerAuthorityStoreError, } from "../../governance/ledger/ledger-authority-store.js";
import { LEDGER_DURABLE_DIRECTORY_MODE } from "../../governance/ledger/ledger-authority-storage-policy.js";
import { isWakeflowError } from "../../kernel/error.js";
import { REQUIREMENT_BOARD_ROOT_REF } from "../../kernel/layout.js";
import { listRequirementClaimStates, materializeRequirementBoardRoot, publishRequirementBoardIndex, } from "../../kernel/requirement-board.js";
import { createWakeflowExternalInstructionBodyAuthority, listWakeflowExternalInstructionTargets, wakeflowExternalInstructionPlacementKey, wakeflowExternalInstructionTargetKey, WakeflowExternalInstructionBodyAuthorityError, } from "../managed-integration/wakeflow-external-instruction-body-authority.js";
import { recomposeWakeflowExternalInstruction, WakeflowExternalInstructionRecompositionError, } from "../managed-integration/wakeflow-external-instruction-recomposition.js";
import { createWakeflowGitignoreBodyAuthority } from "../managed-integration/wakeflow-gitignore-body-authority.js";
import { recomposeWakeflowManagedBlockFile, WakeflowManagedBlockFileError, } from "../managed-integration/wakeflow-managed-block-file.js";
import { createWakeflowSupportGitignoreBodyAuthority, WAKEFLOW_SUPPORT_GITIGNORE_FILE_NAME, } from "../managed-integration/wakeflow-support-gitignore-body-authority.js";
import { recomposeWakeflowWorkspaceGitignore, WakeflowGitignoreRecompositionError, } from "../managed-integration/wakeflow-gitignore-recomposition.js";
import { createWakeflowProgramInstructionBodyAuthority } from "../managed-integration/wakeflow-program-instruction-body-authority.js";
import { recomposeWakeflowProgramInstruction, WakeflowProgramInstructionRecompositionError, } from "../managed-integration/wakeflow-program-instruction-recomposition.js";
import { createWakeflowManagedSupportResourceCatalog } from "../support/wakeflow-managed-support-resource-catalog.js";
import { materializeWakeflowManagedSupportRoot, WakeflowManagedSupportRootMaterializationError, } from "../support/wakeflow-managed-support-root-materialization.js";
import { createWakeflowSupportMemoryAuthority } from "../support/wakeflow-support-memory-authority.js";
import { publishWakeflowSupportMemory, WakeflowSupportMemoryPublicationError, } from "../support/wakeflow-support-memory-publication.js";
import { createWakeflowWorkspaceStaticResourceMatrix } from "../wakeflow-workspace-static-resource-matrix.js";
import { materializeWakeflowSharedCoordinationLayout, WAKEFLOW_SHARED_COORDINATION_LAYOUT_AUTHORITY_DIGEST, WakeflowSharedCoordinationLayoutError, } from "../wakeflow-shared-coordination-layout.js";
import { compileWakeflowHostCapabilityLayoutAuthority } from "../host-runtime/wakeflow-host-capability-layout-authority.js";
import { ensureWakeflowHostCapabilityLayout, materializeWakeflowHostCapabilityLayout, WakeflowHostCapabilityLayoutMaterializationError, } from "../host-runtime/wakeflow-host-capability-layout-materialization.js";
import { compileWakeflowFreshWindowRuntimeAuthority } from "../window-runtime/wakeflow-window-runtime-fresh-authority.js";
import { publishFreshWakeflowWindowRuntime, WakeflowFreshWindowRuntimePublicationError, } from "../window-runtime/wakeflow-window-runtime-fresh-publication.js";
import { materializeActiveLayout, publishActiveProjection, } from "../../kernel/active-projection.js";
import { WakeflowError } from "../../kernel/error.js";
import { REQUIREMENT_BOARD_INITIALIZATION_AUTHORITY_DIGEST } from "../../kernel/requirement-board.js";
import { WAKEFLOW_ACTIVE_LAYOUT_AUTHORITY_DIGEST } from "../wakeflow-active-static-resource-catalog.js";
import { renderWakeflowFreshActiveProjection } from "../wakeflow-active-fresh-projection.js";
import { assertWakeflowMaintenanceGateContext, WakeflowMaintenanceGateError, } from "./wakeflow-maintenance-gate.js";
import { WAKEFLOW_LOCAL_ROOT_RESOURCE_DECLARATION, WAKEFLOW_MAINTENANCE_ROOT_RESOURCE_DECLARATION, WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_RESOURCE_DECLARATION, WAKEFLOW_RUNTIME_ROOT_RESOURCE_DECLARATION, } from "./wakeflow-maintenance-resource-catalog.js";
import { inspectWakeflowWorkspaceCoreLayout, WakeflowWorkspaceCoreLayoutInspectionError, } from "./wakeflow-workspace-core-layout-inspection.js";
import { parseWakeflowStaticMaterializationPreview, parseWakeflowStaticMaterializationPreviewRequest, WakeflowStaticMaterializationPreviewError, } from "./wakeflow-static-materialization-preview-contract.js";
/**
 * Wakeflow Workspace / Maintenance：静态物化计划的闭合 step dispatcher。
 *
 * 每个 step 都从同一 preview/request 重算领域 authority，并只调用已经存在的 owner。
 * dispatcher 不更新 journal、不排序 step、不取得 gate，也不开放自定义 handler registry。
 * `recoveringAffectedStep` 只允许 fresh whole-owned目录接受 exact existing；普通执行仍要求
 * strict absent create。
 */
/** 新建的支撑面 `.gitignore` 与工作区根的一样是可分享的 tracked 文件。 */
const WAKEFLOW_SUPPORT_GITIGNORE_FILE_MODE = 0o644;
const ERROR_MESSAGES = {
    input: "Wakeflow static materialization step input is invalid.",
    gate: "Wakeflow static materialization step requires the active gate.",
    plan: "Wakeflow static materialization step is not in the confirmed preview.",
    "source-config": "Wakeflow static materialization source Config is inconsistent.",
    "target-authority": "Wakeflow static materialization target authority changed.",
    "strict-absent": "Wakeflow fresh whole-owned target was not created exclusively.",
    owner: "Wakeflow static materialization domain owner failed.",
    "root-scope": "Wakeflow static materialization lost its root scope.",
    aborted: "Wakeflow static materialization step was aborted.",
};
/** 静态物化 step 执行失败的稳定、脱敏错误。 */
export class WakeflowStaticMaterializationStepExecutionError extends Error {
    name = "WakeflowStaticMaterializationStepExecutionError";
    code = "wakeflow-static-materialization-step-execution";
    reason;
    path;
    constructor(reason, path) {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
    }
}
function fail(reason, path) {
    throw new WakeflowStaticMaterializationStepExecutionError(reason, path);
}
function parseExecutionOptions(value) {
    let record;
    try {
        record = parsePlainRecord(value, "$options");
    }
    catch (error) {
        if (error instanceof PassiveOwnDataError)
            fail("input", "$options");
        throw error;
    }
    if (!Object.hasOwn(record, "recoveringAffectedStep") ||
        !Object.hasOwn(record, "sourceConfig") ||
        Object.keys(record).some((key) => key !== "recoveringAffectedStep" &&
            key !== "signal" &&
            key !== "sourceConfig") ||
        typeof record.recoveringAffectedStep !== "boolean" ||
        (record.signal !== undefined &&
            (typeof record.signal !== "object" ||
                record.signal === null ||
                types.isProxy(record.signal) ||
                !(record.signal instanceof AbortSignal)))) {
        fail("input", "$options");
    }
    let sourceConfig;
    if (record.sourceConfig === null) {
        sourceConfig = null;
    }
    else {
        try {
            sourceConfig = parseWakeflowConfig(record.sourceConfig);
        }
        catch (error) {
            if (error instanceof WakeflowConfigError) {
                fail("source-config", "$options.sourceConfig");
            }
            throw error;
        }
    }
    const signal = record.signal;
    if (signal?.aborted === true)
        fail("aborted", "$signal");
    return Object.freeze({
        sourceConfig,
        recoveringAffectedStep: record.recoveringAffectedStep,
        signal,
    });
}
function authorityDigest(value) {
    return computeCanonicalJsonSha256Digest(value);
}
function receipt(stepId, disposition, value) {
    return Object.freeze({
        stepId,
        disposition,
        observationDigest: authorityDigest(value),
    });
}
function desiredConfig(request, sourceConfig) {
    const desired = request.action === "reconcile" ? sourceConfig : request.desiredConfig;
    if (desired === null)
        fail("source-config", "$options.sourceConfig");
    return desired;
}
function assertStepTarget(step, actual) {
    if (step.targetDigest !== actual) {
        fail("target-authority", "$step.targetDigest");
    }
}
async function optionalConfigSnapshot(root, signal) {
    try {
        return await readWakeflowConfigAuthoritySnapshot(root, signal === undefined ? undefined : { signal });
    }
    catch (error) {
        if (error instanceof WakeflowConfigAuthoritySnapshotError &&
            error.reason === "source") {
            return null;
        }
        if (error instanceof WakeflowConfigAuthoritySnapshotError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            fail("owner", "$config");
        }
        throw error;
    }
}
async function executeLocalProtocol(root, step, signal) {
    assertStepTarget(step, authorityDigest([
        WAKEFLOW_LOCAL_ROOT_RESOURCE_DECLARATION,
        WAKEFLOW_RUNTIME_ROOT_RESOURCE_DECLARATION,
        WAKEFLOW_MAINTENANCE_ROOT_RESOURCE_DECLARATION,
        WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_RESOURCE_DECLARATION,
    ]));
    let core;
    try {
        core = await inspectWakeflowWorkspaceCoreLayout(root, signal === undefined ? {} : { signal });
    }
    catch (error) {
        if (error instanceof WakeflowWorkspaceCoreLayoutInspectionError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            if (error.reason === "root-scope")
                fail("root-scope", "$root");
            fail("owner", "$coreLayout.local");
        }
        throw error;
    }
    if (!core.local.protocolComplete || core.local.status !== "busy") {
        fail("owner", "$coreLayout.local");
    }
    return receipt(step.stepId, "current", {
        coreLayoutInspectionDigest: core.inspectionDigest,
        localProtocolDigest: core.local.protocolDigest,
    });
}
async function executeActiveLayout(root, step, recovering, signal) {
    assertStepTarget(step, WAKEFLOW_ACTIVE_LAYOUT_AUTHORITY_DIGEST);
    try {
        const result = await materializeActiveLayout(root, {
            recovering,
            ...(signal === undefined ? {} : { signal }),
        });
        return receipt(step.stepId, result.disposition, {
            authorityDigest: WAKEFLOW_ACTIVE_LAYOUT_AUTHORITY_DIGEST,
            entries: result.entries.map((entry) => ({
                resourcePath: entry.resourcePath,
                disposition: entry.disposition,
                inodeId: entry.node.inodeId.toString(),
                mode: entry.node.permissionBits,
            })),
        });
    }
    catch (error) {
        if (error instanceof WakeflowError) {
            if (error.reason === "active-layout-exists") {
                fail("strict-absent", "$activeLayout");
            }
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            if (error.reason === "active-layout-root-scope")
                fail("root-scope", "$root");
            fail("owner", "$activeLayout");
        }
        throw error;
    }
}
async function executeSharedCoordinationLayout(root, step, action, recovering, signal) {
    assertStepTarget(step, WAKEFLOW_SHARED_COORDINATION_LAYOUT_AUTHORITY_DIGEST);
    try {
        const result = await materializeWakeflowSharedCoordinationLayout(root, {
            mode: action === "fresh-initialize"
                ? recovering
                    ? "recover"
                    : "fresh"
                : "ensure",
            ...(signal === undefined ? {} : { signal }),
        });
        return receipt(step.stepId, result.disposition, {
            authorityDigest: result.authorityDigest,
            createdDirectoryCount: result.createdDirectoryCount,
            observationDigest: result.observationDigest,
        });
    }
    catch (error) {
        if (error instanceof WakeflowSharedCoordinationLayoutError) {
            if (error.reason === "strict-absent") {
                fail("strict-absent", "$sharedCoordinationLayout");
            }
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            if (error.reason === "root-scope")
                fail("root-scope", "$root");
            fail("owner", "$sharedCoordinationLayout");
        }
        throw error;
    }
}
async function requirementBoardRootExists(root) {
    try {
        await root.inspectExistingResource(REQUIREMENT_BOARD_ROOT_REF, "$board");
        return true;
    }
    catch (error) {
        if (error instanceof RootedDirectoryError &&
            error.reason === "resource-not-found") {
            return false;
        }
        if (error instanceof RootedDirectoryError)
            fail("root-scope", "$root");
        throw error;
    }
}
/**
 * Fresh 初始化把需求看板目录与空索引交给内核 owner。普通执行要求看板目录严格不存在；
 * affected-step 恢复只接受没有任何认领状态与未知条目的空看板，索引由内核确定性重写。
 */
async function executeRequirementBoardInitialization(root, step, recovering, signal) {
    if (step.targetKey !== "active.board")
        fail("plan", "$board");
    assertStepTarget(step, REQUIREMENT_BOARD_INITIALIZATION_AUTHORITY_DIGEST);
    // 非 fresh 动作只在预览观察到看板缺失时才计划本步；apply 时看板已出现即为漂移。
    const existed = await requirementBoardRootExists(root);
    if (existed && !recovering)
        fail("strict-absent", "$board");
    try {
        if (existed) {
            const listing = await listRequirementClaimStates(root, signal);
            if (listing.states.length !== 0 || listing.skipped !== 0) {
                fail("owner", "$board");
            }
        }
        await materializeRequirementBoardRoot(root, signal);
        const indexDigest = await publishRequirementBoardIndex(root, [], signal);
        return receipt(step.stepId, existed ? "current" : "created", {
            authorityDigest: REQUIREMENT_BOARD_INITIALIZATION_AUTHORITY_DIGEST,
            indexDigest,
        });
    }
    catch (error) {
        if (error instanceof WakeflowStaticMaterializationStepExecutionError) {
            throw error;
        }
        if (isWakeflowError(error)) {
            if (error.reason.endsWith("-aborted"))
                fail("aborted", "$signal");
            if (error.reason.endsWith("-root-scope"))
                fail("root-scope", "$root");
            fail("owner", "$board");
        }
        throw error;
    }
}
async function executeActiveWorkspaceProjection(root, step, desired, recovering, signal) {
    const projection = renderWakeflowFreshActiveProjection(desired);
    assertStepTarget(step, projection.authorityDigest);
    try {
        const result = await publishActiveProjection(root, projection.files, {
            recovering,
            ...(signal === undefined ? {} : { signal }),
        });
        // fresh 工作区里的目标只能是缺失或本 owner 写过的；任何 unsafe 都是 owner 失败。
        if (result.disposition === "unsafe")
            fail("owner", "$projection");
        return receipt(step.stepId, result.disposition, {
            authorityDigest: projection.authorityDigest,
            observationDigest: result.observationDigest,
            files: result.targets.map((entry) => ({
                resourcePath: entry.resourcePath,
                digest: entry.currentDigest,
            })),
        });
    }
    catch (error) {
        if (error instanceof WakeflowError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            if (error.reason === "projection-root-scope")
                fail("root-scope", "$root");
            fail("owner", "$projection");
        }
        throw error;
    }
}
async function executeLedgerLayout(root, step, request, desired, recovering, signal) {
    if (step.targetKey !== "ledger.root")
        fail("plan", "$ledgerRoot");
    assertStepTarget(step, LEDGER_AUTHORITY_LAYOUT_DIGEST);
    // fresh 要求根严格不存在；reconcile/reconfigure 的修复接受已有根并只补齐缺失容器。
    const ensure = recovering || request.action !== "fresh-initialize";
    let placements;
    try {
        placements = await validateWakeflowConfigRootPlacements(root, desired);
    }
    catch (error) {
        if (error instanceof WakeflowConfigRootPlacementError) {
            fail("root-scope", "$ledgerRoot");
        }
        throw error;
    }
    const placement = placements.roots.find((entry) => entry.key === "ledger.root");
    if (placement === undefined)
        fail("plan", "$ledgerRoot");
    let materialized;
    try {
        materialized = await materializeAbsoluteDirectoryPlacement(placement.absolutePath, {
            mode: LEDGER_DURABLE_DIRECTORY_MODE,
            ...(signal === undefined ? {} : { signal }),
        });
    }
    catch (error) {
        if (error instanceof AbsoluteDirectoryMaterializationError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            fail("owner", "$ledgerRoot");
        }
        throw error;
    }
    const finalSegment = materialized.segments.at(-1);
    if (finalSegment === undefined ||
        (!ensure && finalSegment.disposition !== "created") ||
        materialized.node.kind !== "directory" ||
        materialized.node.permissionBits !== LEDGER_DURABLE_DIRECTORY_MODE) {
        fail("strict-absent", "$ledgerRoot");
    }
    let ledgerRoot;
    try {
        ledgerRoot = await RootedDirectory.open(materialized.absolutePath, "$ledgerRoot");
    }
    catch (error) {
        if (error instanceof RootedDirectoryError)
            fail("root-scope", "$ledgerRoot");
        throw error;
    }
    let inspection;
    let primaryError;
    try {
        const store = new LedgerAuthorityStore(ledgerRoot);
        await store.initialize({
            freshLedger: true,
            ...(signal === undefined ? {} : { signal }),
        });
        inspection = await store.inspectLayout(signal === undefined ? undefined : { signal });
    }
    catch (error) {
        primaryError = error;
    }
    let closeError;
    try {
        await ledgerRoot.close();
    }
    catch (error) {
        closeError = error;
    }
    if (primaryError !== undefined) {
        if (primaryError instanceof LedgerAuthorityStoreError) {
            fail(primaryError.reason === "aborted" ? "aborted" : "owner", "$ledgerLayout");
        }
        throw primaryError;
    }
    if (closeError !== undefined || inspection?.status !== "current") {
        fail("owner", "$ledgerLayout");
    }
    return receipt(step.stepId, finalSegment.disposition === "created" ? "created" : "current", {
        absolutePlacementState: placement.state,
        authorityDigest: inspection.authorityDigest,
        observationDigest: inspection.observationDigest,
    });
}
async function executeUnregisteredWindowRuntime(root, step, request, desired, recovering, signal) {
    if (request.action !== "fresh-initialize" ||
        step.targetKey !== request.currentHostProfile.hostId) {
        fail("plan", "$windowRuntime");
    }
    const authority = compileWakeflowFreshWindowRuntimeAuthority(desired, request.currentHostProfile);
    assertStepTarget(step, authority.authorityDigest);
    try {
        const result = await publishFreshWakeflowWindowRuntime(root, desired, request.currentHostProfile, {
            recoveringFreshPublication: recovering,
            ...(signal === undefined ? {} : { signal }),
        });
        return receipt(step.stepId, result.disposition, {
            authorityDigest: result.authorityDigest,
            projectionSetDigest: result.projectionSetDigest,
            observationDigest: result.observationDigest,
        });
    }
    catch (error) {
        if (error instanceof WakeflowFreshWindowRuntimePublicationError) {
            if (error.reason === "strict-absent") {
                fail("strict-absent", "$windowRuntime");
            }
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            if (error.reason === "root-scope")
                fail("root-scope", "$root");
            fail("owner", "$windowRuntime");
        }
        throw error;
    }
}
async function executeHostCapabilityLayout(root, step, request, recovering, signal) {
    if (step.targetKey !== request.currentHostProfile.hostId) {
        fail("plan", "$hostCapabilityLayout");
    }
    const authority = compileWakeflowHostCapabilityLayoutAuthority(request.currentHostProfile);
    assertStepTarget(step, authority.authorityDigest);
    try {
        // fresh 要求全部目标不存在（恢复时接受 exact 空前缀）；reconcile/reconfigure 的修复只补齐
        // 缺失目录、不枚举运行中的内容。
        const result = request.action === "fresh-initialize"
            ? await materializeWakeflowHostCapabilityLayout(root, request.currentHostProfile, {
                recoveringFreshLayout: recovering,
                ...(signal === undefined ? {} : { signal }),
            })
            : await ensureWakeflowHostCapabilityLayout(root, request.currentHostProfile, signal === undefined ? {} : { signal });
        return receipt(step.stepId, result.disposition, {
            authorityDigest: result.authorityDigest,
            createdDirectoryCount: result.createdDirectoryCount,
            observationDigest: result.observationDigest,
        });
    }
    catch (error) {
        if (error instanceof WakeflowHostCapabilityLayoutMaterializationError) {
            if (error.reason === "strict-absent") {
                fail("strict-absent", "$hostCapabilityLayout");
            }
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            if (error.reason === "root-scope")
                fail("root-scope", "$root");
            fail("owner", "$hostCapabilityLayout");
        }
        throw error;
    }
}
async function executeSupportRoot(root, step, request, desired, recovering, signal) {
    const catalog = createWakeflowManagedSupportResourceCatalog(desired, request.currentHostProfile);
    const declaration = catalog.declarations.find((entry) => entry.declarationId === `support.${step.targetKey}.root`);
    if (declaration === undefined)
        fail("plan", "$step.targetKey");
    assertStepTarget(step, authorityDigest(declaration));
    try {
        const result = await materializeWakeflowManagedSupportRoot(root, {
            config: desired,
            expectedConfigDigest: computeWakeflowConfigDigest(desired),
            profile: request.currentHostProfile,
            expectedCatalogDigest: catalog.catalogDigest,
            surfaceId: step.targetKey,
            ...(signal === undefined ? {} : { signal }),
        });
        // fresh 要求根严格不存在；reconcile/reconfigure 的修复接受已有根并只补齐 scaffold。
        if (result.disposition === "existing" &&
            !recovering &&
            request.action === "fresh-initialize") {
            fail("strict-absent", "$supportRoot");
        }
        return receipt(step.stepId, result.disposition === "created" ? "created" : "current", {
            surfaceId: result.surfaceId,
            inodeId: result.node.inodeId.toString(),
            mode: result.node.permissionBits,
        });
    }
    catch (error) {
        if (error instanceof WakeflowStaticMaterializationStepExecutionError) {
            throw error;
        }
        if (error instanceof WakeflowManagedSupportRootMaterializationError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            fail("owner", "$supportRoot");
        }
        throw error;
    }
}
async function executeGitignore(root, step, request, signal) {
    const authority = createWakeflowGitignoreBodyAuthority(request.hostProfiles);
    assertStepTarget(step, authority.authorityDigest);
    const matrix = createWakeflowWorkspaceStaticResourceMatrix(request.currentHostProfile);
    try {
        const result = await recomposeWakeflowWorkspaceGitignore(root, {
            matrix,
            expectedMatrixDigest: matrix.matrixDigest,
            hostProfiles: request.hostProfiles,
        }, signal === undefined ? undefined : { signal });
        return receipt(step.stepId, result.disposition === "current" ? "current" : "updated", {
            authorityDigest: result.inspection.authority.authorityDigest,
            sourceDigest: result.inspection.source?.digest ?? null,
        });
    }
    catch (error) {
        if (error instanceof WakeflowGitignoreRecompositionError) {
            fail(error.reason === "aborted" ? "aborted" : "owner", "$gitignore");
        }
        throw error;
    }
}
async function executeProgramInstruction(root, step, request, sourceConfig, desired, signal) {
    const authority = createWakeflowProgramInstructionBodyAuthority(desired, request.currentHostProfile);
    assertStepTarget(step, authority.authorityDigest);
    const matrix = createWakeflowWorkspaceStaticResourceMatrix(request.currentHostProfile);
    try {
        const result = await recomposeWakeflowProgramInstruction(root, {
            matrix,
            expectedMatrixDigest: matrix.matrixDigest,
            profile: request.currentHostProfile,
            currentConfig: sourceConfig,
            expectedCurrentConfigDigest: sourceConfig === null
                ? null
                : computeWakeflowConfigDigest(sourceConfig),
            desiredConfig: desired,
            expectedDesiredConfigDigest: computeWakeflowConfigDigest(desired),
        }, signal === undefined ? undefined : { signal });
        return receipt(step.stepId, result.disposition === "current" ? "current" : "updated", {
            authorityDigest: result.inspection.desiredAuthority.authorityDigest,
            sourceDigest: result.inspection.source?.digest ?? null,
        });
    }
    catch (error) {
        if (error instanceof WakeflowProgramInstructionRecompositionError) {
            fail(error.reason === "aborted" ? "aborted" : "owner", "$program");
        }
        throw error;
    }
}
async function executeExternalInstruction(root, step, request, sourceConfig, desired, signal) {
    const target = listWakeflowExternalInstructionTargets(desired).find((candidate) => wakeflowExternalInstructionTargetKey(candidate) === step.targetKey);
    if (target === undefined)
        fail("plan", "$step.targetKey");
    let authorityDigest;
    try {
        authorityDigest = createWakeflowExternalInstructionBodyAuthority(desired, request.currentHostProfile, target).authorityDigest;
    }
    catch (error) {
        if (error instanceof WakeflowExternalInstructionBodyAuthorityError) {
            fail("owner", "$externalInstruction");
        }
        throw error;
    }
    assertStepTarget(step, authorityDigest);
    let placements;
    try {
        placements = await validateWakeflowConfigRootPlacements(root, desired);
    }
    catch (error) {
        if (error instanceof WakeflowConfigRootPlacementError) {
            fail("root-scope", "$externalRoot");
        }
        throw error;
    }
    const placement = placements.roots.find((entry) => entry.key === wakeflowExternalInstructionPlacementKey(target));
    if (placement?.state !== "present")
        fail("root-scope", "$externalRoot");
    let externalRoot;
    try {
        externalRoot = await RootedDirectory.open(placement.absolutePath, "$externalRoot", { durability: root.durability });
    }
    catch (error) {
        if (error instanceof RootedDirectoryError) {
            fail("root-scope", "$externalRoot");
        }
        throw error;
    }
    let result;
    let primaryError;
    try {
        result = await recomposeWakeflowExternalInstruction(externalRoot, {
            profile: request.currentHostProfile,
            target,
            currentConfig: sourceConfig,
            expectedCurrentConfigDigest: sourceConfig === null
                ? null
                : computeWakeflowConfigDigest(sourceConfig),
            desiredConfig: desired,
            expectedDesiredConfigDigest: computeWakeflowConfigDigest(desired),
        }, signal === undefined ? undefined : { signal });
    }
    catch (error) {
        primaryError = error;
    }
    let closeError;
    try {
        await externalRoot.close();
    }
    catch (error) {
        closeError = error;
    }
    if (primaryError !== undefined) {
        if (primaryError instanceof WakeflowExternalInstructionRecompositionError) {
            fail(primaryError.reason === "aborted" ? "aborted" : "owner", "$externalInstruction");
        }
        throw primaryError;
    }
    if (closeError !== undefined || result === undefined) {
        fail("owner", "$externalRoot");
    }
    return receipt(step.stepId, result.disposition === "current" ? "current" : "updated", {
        authorityDigest: result.inspection.desiredAuthority.authorityDigest,
        sourceDigest: result.inspection.source?.digest ?? null,
    });
}
async function executeSupportGitignore(root, step, request, desired, signal) {
    const authority = createWakeflowSupportGitignoreBodyAuthority(request.hostProfiles);
    if (authority === null)
        fail("plan", "$step.kind");
    assertStepTarget(step, authority.authorityDigest);
    const surface = desired.topology.supportSurfaces.find((entry) => entry.surfaceId === step.targetKey &&
        entry.ownership === "wakeflow-managed");
    if (surface === undefined)
        fail("plan", "$step.targetKey");
    let placements;
    try {
        placements = await validateWakeflowConfigRootPlacements(root, desired);
    }
    catch (error) {
        if (error instanceof WakeflowConfigRootPlacementError) {
            fail("root-scope", "$supportRoot");
        }
        throw error;
    }
    const placement = placements.roots.find((entry) => entry.key === `support.${surface.surfaceId}.root`);
    if (placement?.state !== "present")
        fail("root-scope", "$supportRoot");
    let supportRoot;
    try {
        supportRoot = await RootedDirectory.open(placement.absolutePath, "$supportRoot", { durability: root.durability });
    }
    catch (error) {
        if (error instanceof RootedDirectoryError) {
            fail("root-scope", "$supportRoot");
        }
        throw error;
    }
    let result;
    let primaryError;
    try {
        result = await recomposeWakeflowManagedBlockFile(supportRoot, {
            resourcePath: WAKEFLOW_SUPPORT_GITIGNORE_FILE_NAME,
            currentTargets: [authority.envelopeTarget],
            desiredTarget: authority.envelopeTarget,
            ...(signal === undefined ? {} : { signal }),
        }, { createMode: WAKEFLOW_SUPPORT_GITIGNORE_FILE_MODE });
    }
    catch (error) {
        primaryError = error;
    }
    let closeError;
    try {
        await supportRoot.close();
    }
    catch (error) {
        closeError = error;
    }
    if (primaryError !== undefined) {
        if (primaryError instanceof WakeflowManagedBlockFileError) {
            fail(primaryError.reason === "aborted" ? "aborted" : "owner", "$supportGitignore");
        }
        throw primaryError;
    }
    if (closeError !== undefined || result === undefined) {
        fail("owner", "$supportRoot");
    }
    return receipt(step.stepId, result.disposition === "current" ? "current" : "updated", {
        authorityDigest: authority.authorityDigest,
        sourceDigest: result.inspection.source?.digest ?? null,
    });
}
async function executeSupportMemory(root, step, request, sourceConfig, desired, signal) {
    const separator = step.targetKey.lastIndexOf(":");
    if (separator <= 0)
        fail("plan", "$step.targetKey");
    const surfaceId = step.targetKey.slice(0, separator);
    if (step.targetKey.slice(separator + 1) !== request.currentHostProfile.hostId) {
        fail("plan", "$step.targetKey");
    }
    const authority = createWakeflowSupportMemoryAuthority(desired, request.currentHostProfile, surfaceId);
    assertStepTarget(step, authority.authorityDigest);
    let placements;
    try {
        placements = await validateWakeflowConfigRootPlacements(root, desired);
    }
    catch (error) {
        if (error instanceof WakeflowConfigRootPlacementError) {
            fail("root-scope", "$supportRoot");
        }
        throw error;
    }
    const placement = placements.roots.find((entry) => entry.key === `support.${surfaceId}.root`);
    if (placement?.state !== "present")
        fail("root-scope", "$supportRoot");
    let supportRoot;
    try {
        supportRoot = await RootedDirectory.open(placement.absolutePath);
    }
    catch (error) {
        if (error instanceof RootedDirectoryError) {
            fail("root-scope", "$supportRoot");
        }
        throw error;
    }
    let result;
    let primaryError;
    try {
        const catalog = createWakeflowManagedSupportResourceCatalog(desired, request.currentHostProfile);
        result = await publishWakeflowSupportMemory(root, supportRoot, {
            currentConfig: sourceConfig,
            expectedCurrentConfigDigest: sourceConfig === null
                ? null
                : computeWakeflowConfigDigest(sourceConfig),
            desiredConfig: desired,
            expectedDesiredConfigDigest: computeWakeflowConfigDigest(desired),
            profile: request.currentHostProfile,
            expectedCatalogDigest: catalog.catalogDigest,
            surfaceId,
        }, signal === undefined ? undefined : { signal });
    }
    catch (error) {
        primaryError = error;
    }
    let closeError;
    try {
        await supportRoot.close();
    }
    catch (error) {
        closeError = error;
    }
    if (primaryError !== undefined) {
        if (primaryError instanceof WakeflowSupportMemoryPublicationError) {
            fail(primaryError.reason === "aborted" ? "aborted" : "owner", "$supportMemory");
        }
        throw primaryError;
    }
    if (closeError !== undefined || result === undefined) {
        fail("owner", "$supportRoot");
    }
    return receipt(step.stepId, result.disposition === "current" ? "current" : "updated", {
        authorityDigest: result.inspection.desiredAuthority.authorityDigest,
        sourceDigest: result.inspection.source?.digest ?? null,
    });
}
async function executeConfig(root, step, preview, desired, signal) {
    const desiredDigest = computeWakeflowConfigDigest(desired);
    assertStepTarget(step, desiredDigest);
    const current = await optionalConfigSnapshot(root, signal);
    if (current?.configDigest === desiredDigest) {
        return receipt(step.stepId, "current", {
            configDigest: current.configDigest,
            sourceDigest: current.source.digest,
        });
    }
    try {
        if (preview.currentConfigDigest === null) {
            if (current !== null)
                fail("source-config", "$config");
            const result = await publishWakeflowConfigAuthority(root, desired, signal === undefined ? undefined : { signal });
            return receipt(step.stepId, "created", {
                configDigest: result.authority.configDigest,
                sourceDigest: result.authority.source.digest,
            });
        }
        if (current === null ||
            current.configDigest !== preview.currentConfigDigest) {
            fail("source-config", "$config");
        }
        const result = await replaceWakeflowConfigAuthority(root, desired, current, signal === undefined ? undefined : { signal });
        return receipt(step.stepId, result.disposition === "current" ? "current" : "updated", {
            configDigest: result.authority.configDigest,
            sourceDigest: result.authority.source.digest,
        });
    }
    catch (error) {
        if (error instanceof WakeflowStaticMaterializationStepExecutionError) {
            throw error;
        }
        if (error instanceof WakeflowConfigAuthorityPublicationError ||
            error instanceof WakeflowConfigAuthorityReplacementError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            if (error.reason === "root-scope")
                fail("root-scope", "$root");
            fail("owner", "$config");
        }
        throw error;
    }
}
/** 在 active maintenance gate 内执行计划中的一个 exact step。 */
export async function executeWakeflowStaticMaterializationStep(root, gateContext, previewValue, requestValue, stepIdValue, options) {
    try {
        assertWakeflowMaintenanceGateContext(gateContext, root);
    }
    catch (error) {
        if (error instanceof WakeflowMaintenanceGateError) {
            fail("gate", "$gateContext");
        }
        throw error;
    }
    const parsedOptions = parseExecutionOptions(options);
    let preview;
    try {
        preview = parseWakeflowStaticMaterializationPreview(previewValue);
    }
    catch (error) {
        if (error instanceof WakeflowStaticMaterializationPreviewError) {
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
            fail("input", error.path);
        }
        throw error;
    }
    if (typeof stepIdValue !== "string" ||
        stepIdValue.length > 256 ||
        !stepIdValue.isWellFormed()) {
        fail("input", "$stepId");
    }
    const step = preview.steps.find((entry) => entry.stepId === stepIdValue);
    if (step === undefined)
        fail("plan", "$stepId");
    if (preview.status !== "ready")
        fail("plan", "$preview.status");
    const { sourceConfig, signal } = parsedOptions;
    const recovering = parsedOptions.recoveringAffectedStep;
    const matrix = createWakeflowWorkspaceStaticResourceMatrix(request.currentHostProfile);
    if (preview.action !== request.action ||
        preview.matrixDigest !== matrix.matrixDigest) {
        fail("plan", "$preview");
    }
    const desired = desiredConfig(request, sourceConfig);
    if (preview.desiredConfigDigest !== computeWakeflowConfigDigest(desired)) {
        fail("plan", "$preview.desiredConfigDigest");
    }
    const sourceDigest = sourceConfig === null ? null : computeWakeflowConfigDigest(sourceConfig);
    if (step.kind !== "publish-config" &&
        sourceDigest !== preview.currentConfigDigest) {
        fail("source-config", "$options.sourceConfig");
    }
    if (step.kind === "materialize-local-protocol") {
        return executeLocalProtocol(root, step, signal);
    }
    if (step.kind === "materialize-shared-coordination-layout") {
        return executeSharedCoordinationLayout(root, step, request.action, recovering, signal);
    }
    if (step.kind === "materialize-active-layout") {
        // reconcile/reconfigure 的活动布局修复以幂等 ensure 执行；fresh 仍要求严格不存在。
        return executeActiveLayout(root, step, recovering || request.action !== "fresh-initialize", signal);
    }
    if (step.kind === "initialize-requirement-board") {
        return executeRequirementBoardInitialization(root, step, recovering, signal);
    }
    if (step.kind === "publish-fresh-active-workspace-projection") {
        return executeActiveWorkspaceProjection(root, step, desired, recovering, signal);
    }
    if (step.kind === "materialize-ledger-layout") {
        return executeLedgerLayout(root, step, request, desired, recovering, signal);
    }
    if (step.kind === "publish-unregistered-window-runtime") {
        return executeUnregisteredWindowRuntime(root, step, request, desired, recovering, signal);
    }
    if (step.kind === "materialize-host-capability-layout") {
        return executeHostCapabilityLayout(root, step, request, recovering, signal);
    }
    if (step.kind === "materialize-support-root") {
        return executeSupportRoot(root, step, request, desired, recovering, signal);
    }
    if (step.kind === "recompose-gitignore") {
        return executeGitignore(root, step, request, signal);
    }
    if (step.kind === "recompose-support-gitignore") {
        return executeSupportGitignore(root, step, request, desired, signal);
    }
    if (step.kind === "recompose-program-instruction") {
        return executeProgramInstruction(root, step, request, sourceConfig, desired, signal);
    }
    if (step.kind === "recompose-external-instruction") {
        return executeExternalInstruction(root, step, request, sourceConfig, desired, signal);
    }
    if (step.kind === "publish-support-memory") {
        return executeSupportMemory(root, step, request, sourceConfig, desired, signal);
    }
    if (step.kind === "publish-config") {
        return executeConfig(root, step, preview, desired, signal);
    }
    const unsupportedKind = step.kind;
    return fail("plan", `$step.kind:${unsupportedKind}`);
}
