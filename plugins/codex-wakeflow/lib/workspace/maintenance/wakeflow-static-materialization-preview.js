import { types } from "node:util";
import { computeWakeflowConfigDigest, } from "../../configuration/wakeflow-config.js";
import { readWakeflowConfigAuthoritySnapshot, WAKEFLOW_CONFIG_FILE_REF, WakeflowConfigAuthoritySnapshotError, } from "../../configuration/wakeflow-config-authority-snapshot.js";
import { validateWakeflowConfigRootPlacements, WakeflowConfigRootPlacementError, } from "../../configuration/wakeflow-config-root-placement.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { RootedDirectory, RootedDirectoryError, } from "../../foundation/filesystem/rooted-directory.js";
import { LEDGER_AUTHORITY_LAYOUT_DIGEST } from "../../governance/ledger/ledger-authority-layout.js";
import { LedgerAuthorityStore, LedgerAuthorityStoreError, } from "../../governance/ledger/ledger-authority-store.js";
import { WakeflowError } from "../../kernel/error.js";
import { REQUIREMENT_BOARD_ROOT_REF } from "../../kernel/layout.js";
import { REQUIREMENT_BOARD_INITIALIZATION_AUTHORITY_DIGEST } from "../../kernel/requirement-board.js";
import { compileWakeflowHostCapabilityLayoutAuthority, WakeflowHostCapabilityLayoutAuthorityError, } from "../host-runtime/wakeflow-host-capability-layout-authority.js";
import { inspectWakeflowHostCapabilityLayout, WakeflowHostCapabilityLayoutMaterializationError, } from "../host-runtime/wakeflow-host-capability-layout-materialization.js";
import { listWakeflowExternalInstructionTargets, wakeflowExternalInstructionPlacementKey, wakeflowExternalInstructionTargetKey, } from "../managed-integration/wakeflow-external-instruction-body-authority.js";
import { inspectWakeflowExternalInstruction, WakeflowExternalInstructionInspectionError, } from "../managed-integration/wakeflow-external-instruction-inspection.js";
import { inspectWakeflowWorkspaceGitignore, WakeflowGitignoreInspectionError, } from "../managed-integration/wakeflow-gitignore-inspection.js";
import { inspectWakeflowManagedBlockFile, WakeflowManagedBlockFileError, } from "../managed-integration/wakeflow-managed-block-file.js";
import { inspectWakeflowProgramInstruction, WakeflowProgramInstructionInspectionError, } from "../managed-integration/wakeflow-program-instruction-inspection.js";
import { createWakeflowSupportGitignoreBodyAuthority, WAKEFLOW_SUPPORT_GITIGNORE_FILE_NAME, } from "../managed-integration/wakeflow-support-gitignore-body-authority.js";
import { createWakeflowManagedSupportResourceCatalog } from "../support/wakeflow-managed-support-resource-catalog.js";
import { inspectWakeflowManagedSupportRoot, WakeflowManagedSupportRootMaterializationError, } from "../support/wakeflow-managed-support-root-materialization.js";
import { createWakeflowSupportMemoryAuthority } from "../support/wakeflow-support-memory-authority.js";
import { inspectWakeflowSupportMemory, WakeflowSupportMemoryInspectionError, } from "../support/wakeflow-support-memory-inspection.js";
import { renderWakeflowFreshActiveProjection } from "../wakeflow-active-fresh-projection.js";
import { WAKEFLOW_ACTIVE_LAYOUT_AUTHORITY_DIGEST } from "../wakeflow-active-static-resource-catalog.js";
import { inspectWakeflowSharedCoordinationLayout, WAKEFLOW_SHARED_COORDINATION_LAYOUT_AUTHORITY_DIGEST, WakeflowSharedCoordinationLayoutError, } from "../wakeflow-shared-coordination-layout.js";
import { createWakeflowWorkspaceStaticResourceMatrix } from "../wakeflow-workspace-static-resource-matrix.js";
import { WakeflowWindowRuntimeDesiredTopologyError } from "../window-runtime/wakeflow-window-runtime-desired-topology.js";
import { compileWakeflowFreshWindowRuntimeAuthority, WakeflowFreshWindowRuntimeAuthorityError, } from "../window-runtime/wakeflow-window-runtime-fresh-authority.js";
import { WakeflowMaintenanceGateError, wakeflowMaintenanceCoreInspectionForGateContext, } from "./wakeflow-maintenance-gate.js";
import { WAKEFLOW_LOCAL_ROOT_RESOURCE_DECLARATION, WAKEFLOW_MAINTENANCE_ROOT_RESOURCE_DECLARATION, WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_RESOURCE_DECLARATION, WAKEFLOW_RUNTIME_ROOT_RESOURCE_DECLARATION, } from "./wakeflow-maintenance-resource-catalog.js";
import { computeWakeflowStaticMaterializationPreviewDigest, failWakeflowStaticMaterializationPreview as fail, parseWakeflowStaticMaterializationPreview, parseWakeflowStaticMaterializationPreviewRequest, } from "./wakeflow-static-materialization-preview-contract.js";
import { inspectWakeflowWorkspaceCoreLayout, WakeflowWorkspaceCoreLayoutInspectionError, } from "./wakeflow-workspace-core-layout-inspection.js";
function assertNotAborted(signal) {
    if (signal?.aborted === true)
        fail("aborted", "$signal");
}
async function configResourceExists(root) {
    try {
        await root.inspectExistingResource(WAKEFLOW_CONFIG_FILE_REF, "$config");
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
async function currentSnapshot(root, signal) {
    if (!(await configResourceExists(root)))
        return null;
    try {
        return await readWakeflowConfigAuthoritySnapshot(root, signal === undefined ? undefined : { signal });
    }
    catch (error) {
        if (error instanceof WakeflowConfigAuthoritySnapshotError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            return null;
        }
        throw error;
    }
}
async function desiredPlacements(root, model) {
    try {
        return await validateWakeflowConfigRootPlacements(root, model);
    }
    catch (error) {
        if (error instanceof WakeflowConfigRootPlacementError)
            return null;
        throw error;
    }
}
function sameSemanticSection(left, right) {
    return (computeCanonicalJsonSha256Digest(left) ===
        computeCanonicalJsonSha256Digest(right));
}
function resourceDigest(value) {
    return computeCanonicalJsonSha256Digest(value);
}
function step(value) {
    return Object.freeze({
        ...value,
        dependsOn: Object.freeze([...value.dependsOn]),
    });
}
function addBlocker(blockers, code) {
    blockers.add(code);
}
function placementFor(report, surfaceId) {
    return (report.roots.find((entry) => entry.key === `support.${surfaceId}.root`) ??
        null);
}
function ledgerPlacement(report) {
    return report.roots.find((entry) => entry.key === "ledger.root") ?? null;
}
async function inspectLedgerParticipant(request, report, blockers, steps) {
    assertNotAborted(request.signal);
    const placement = ledgerPlacement(report);
    if (placement === null) {
        addBlocker(blockers, "ledger-placement-unavailable");
        return;
    }
    if (request.action === "fresh-initialize") {
        if (placement.state !== "missing") {
            addBlocker(blockers, "fresh-ledger-root-present");
            return;
        }
        steps.push(step({
            stepId: "ledger:layout",
            kind: "materialize-ledger-layout",
            ownerId: "ledger-layout",
            targetKey: "ledger.root",
            sourceDigest: null,
            targetDigest: LEDGER_AUTHORITY_LAYOUT_DIGEST,
            dependsOn: [],
        }));
        return;
    }
    // ledger 根或它的固定容器缺失时由维护补齐（能力卡 1 §1.4 的 ledger 目录修复）；冲突只报告。
    const repairStep = (sourceDigest) => step({
        stepId: "ledger:layout",
        kind: "materialize-ledger-layout",
        ownerId: "ledger-layout",
        targetKey: "ledger.root",
        sourceDigest,
        targetDigest: LEDGER_AUTHORITY_LAYOUT_DIGEST,
        dependsOn: [],
    });
    if (placement.state !== "present") {
        steps.push(repairStep(null));
        return;
    }
    let root;
    try {
        root = await RootedDirectory.open(placement.absolutePath, "$ledgerRoot");
    }
    catch {
        addBlocker(blockers, "ledger-root-unavailable");
        return;
    }
    try {
        const inspection = await new LedgerAuthorityStore(root).inspectLayout(request.signal === undefined ? undefined : { signal: request.signal });
        if (inspection.status === "incomplete") {
            steps.push(repairStep(inspection.observationDigest));
        }
        else if (inspection.status !== "current") {
            addBlocker(blockers, `ledger-layout-${inspection.status}`);
        }
    }
    catch (error) {
        if (error instanceof LedgerAuthorityStoreError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            addBlocker(blockers, `ledger-layout-${error.reason}`);
        }
        else {
            throw error;
        }
    }
    finally {
        try {
            await root.close();
        }
        catch {
            addBlocker(blockers, "ledger-root-close-failure");
        }
    }
}
function supportGitignoreStep(surfaceId, authority, sourceDigest, dependsOn) {
    return step({
        stepId: `support-gitignore:${surfaceId}`,
        kind: "recompose-support-gitignore",
        ownerId: "workspace-ignore-integration",
        targetKey: surfaceId,
        sourceDigest,
        targetDigest: authority.authorityDigest,
        dependsOn: [...dependsOn],
    });
}
/** 支撑面根里 `.gitignore` 托管块的只读检查；用户改动或未知正文只报告。 */
async function inspectSupportGitignore(supportRoot, request, authority, surfaceId, dependsOn, blockers, steps) {
    try {
        const inspected = await inspectWakeflowManagedBlockFile(supportRoot, {
            resourcePath: WAKEFLOW_SUPPORT_GITIGNORE_FILE_NAME,
            currentTargets: [authority.envelopeTarget],
            desiredTarget: authority.envelopeTarget,
            ...(request.signal === undefined ? {} : { signal: request.signal }),
        });
        if (inspected.status === "recompose-required") {
            steps.push(supportGitignoreStep(surfaceId, authority, inspected.source?.digest ?? null, dependsOn));
        }
    }
    catch (error) {
        if (error instanceof WakeflowManagedBlockFileError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            addBlocker(blockers, `support-gitignore-${error.reason}`);
        }
        else {
            throw error;
        }
    }
}
async function inspectSupportMemories(root, request, current, desired, report, blockers, steps) {
    const catalog = createWakeflowManagedSupportResourceCatalog(desired, request.currentHostProfile);
    const supportIgnore = createWakeflowSupportGitignoreBodyAuthority(request.hostProfiles);
    for (const surface of desired.topology.supportSurfaces) {
        assertNotAborted(request.signal);
        if (surface.ownership !== "wakeflow-managed")
            continue;
        const placement = placementFor(report, surface.surfaceId);
        if (placement === null) {
            addBlocker(blockers, "support-placement-unavailable");
            continue;
        }
        const rootStepId = `support-root:${surface.surfaceId}`;
        if (request.action === "fresh-initialize") {
            if (placement.state !== "missing") {
                addBlocker(blockers, "fresh-support-root-present");
                continue;
            }
            const declaration = catalog.declarations.find((entry) => entry.declarationId === `support.${surface.surfaceId}.root`);
            if (declaration === undefined) {
                addBlocker(blockers, "support-catalog-incomplete");
                continue;
            }
            steps.push(step({
                stepId: rootStepId,
                kind: "materialize-support-root",
                ownerId: "support-surface-layout",
                targetKey: surface.surfaceId,
                sourceDigest: null,
                targetDigest: resourceDigest(declaration),
                dependsOn: [],
            }));
            const authority = createWakeflowSupportMemoryAuthority(desired, request.currentHostProfile, surface.surfaceId);
            steps.push(step({
                stepId: `support-memory:${surface.surfaceId}`,
                kind: "publish-support-memory",
                ownerId: "support-memory",
                targetKey: `${surface.surfaceId}:${request.currentHostProfile.hostId}`,
                sourceDigest: null,
                targetDigest: authority.authorityDigest,
                dependsOn: [rootStepId],
            }));
            if (supportIgnore !== null) {
                steps.push(supportGitignoreStep(surface.surfaceId, supportIgnore, null, [rootStepId]));
            }
            continue;
        }
        // 根缺失或 scaffold 目录缺失时由维护补齐（能力卡 1 §1.4 的支撑面目录修复）；冲突只报告。
        let rootInspection;
        try {
            rootInspection = await inspectWakeflowManagedSupportRoot(root, {
                config: desired,
                expectedConfigDigest: computeWakeflowConfigDigest(desired),
                profile: request.currentHostProfile,
                expectedCatalogDigest: catalog.catalogDigest,
                surfaceId: surface.surfaceId,
                ...(request.signal === undefined ? {} : { signal: request.signal }),
            });
        }
        catch (error) {
            if (error instanceof WakeflowManagedSupportRootMaterializationError) {
                if (error.reason === "aborted")
                    fail("aborted", "$signal");
                addBlocker(blockers, "support-root-unavailable");
                continue;
            }
            throw error;
        }
        if (rootInspection.status === "conflict") {
            addBlocker(blockers, "support-root-conflict");
            continue;
        }
        const rootStepIds = [];
        if (rootInspection.status !== "current") {
            rootStepIds.push(rootStepId);
            const declaration = catalog.declarations.find((entry) => entry.declarationId === `support.${surface.surfaceId}.root`);
            if (declaration === undefined) {
                addBlocker(blockers, "support-catalog-incomplete");
                continue;
            }
            steps.push(step({
                stepId: rootStepId,
                kind: "materialize-support-root",
                ownerId: "support-surface-layout",
                targetKey: surface.surfaceId,
                sourceDigest: rootInspection.observationDigest,
                targetDigest: resourceDigest(declaration),
                dependsOn: [],
            }));
        }
        if (rootInspection.status === "absent") {
            const authority = createWakeflowSupportMemoryAuthority(desired, request.currentHostProfile, surface.surfaceId);
            steps.push(step({
                stepId: `support-memory:${surface.surfaceId}`,
                kind: "publish-support-memory",
                ownerId: "support-memory",
                targetKey: `${surface.surfaceId}:${request.currentHostProfile.hostId}`,
                sourceDigest: null,
                targetDigest: authority.authorityDigest,
                dependsOn: rootStepIds,
            }));
            if (supportIgnore !== null) {
                steps.push(supportGitignoreStep(surface.surfaceId, supportIgnore, null, rootStepIds));
            }
            continue;
        }
        let supportRoot;
        try {
            supportRoot = await RootedDirectory.open(placement.absolutePath);
        }
        catch {
            addBlocker(blockers, "support-root-unavailable");
            continue;
        }
        try {
            const inspected = await inspectWakeflowSupportMemory(root, supportRoot, {
                currentConfig: current,
                expectedCurrentConfigDigest: current === null ? null : computeWakeflowConfigDigest(current),
                desiredConfig: desired,
                expectedDesiredConfigDigest: computeWakeflowConfigDigest(desired),
                profile: request.currentHostProfile,
                expectedCatalogDigest: catalog.catalogDigest,
                surfaceId: surface.surfaceId,
                ...(request.signal === undefined ? {} : { signal: request.signal }),
            });
            if (inspected.status === "publication-required") {
                steps.push(step({
                    stepId: `support-memory:${surface.surfaceId}`,
                    kind: "publish-support-memory",
                    ownerId: "support-memory",
                    targetKey: `${surface.surfaceId}:${request.currentHostProfile.hostId}`,
                    sourceDigest: inspected.source?.digest ?? null,
                    targetDigest: inspected.desiredAuthority.authorityDigest,
                    dependsOn: rootStepIds,
                }));
            }
            if (supportIgnore !== null) {
                await inspectSupportGitignore(supportRoot, request, supportIgnore, surface.surfaceId, rootStepIds, blockers, steps);
            }
        }
        catch (error) {
            if (error instanceof WakeflowSupportMemoryInspectionError) {
                if (error.reason === "aborted")
                    fail("aborted", "$signal");
                addBlocker(blockers, `support-memory-${error.reason}`);
            }
            else {
                throw error;
            }
        }
        finally {
            try {
                await supportRoot.close();
            }
            catch {
                addBlocker(blockers, "support-root-close-failure");
            }
        }
    }
}
async function inspectExternalInstructions(root, request, current, desired, report, blockers, steps) {
    for (const target of listWakeflowExternalInstructionTargets(desired)) {
        assertNotAborted(request.signal);
        const placement = report.roots.find((entry) => entry.key === wakeflowExternalInstructionPlacementKey(target)) ?? null;
        if (placement === null) {
            addBlocker(blockers, "external-instruction-placement-unavailable");
            continue;
        }
        // 外部根由所有者创建；Wakeflow 只在已存在的根里维护托管块。
        if (placement.state !== "present") {
            addBlocker(blockers, "external-instruction-root-missing");
            continue;
        }
        let externalRoot;
        try {
            externalRoot = await RootedDirectory.open(placement.absolutePath, "$externalRoot", { durability: root.durability });
        }
        catch {
            addBlocker(blockers, "external-instruction-root-unavailable");
            continue;
        }
        try {
            const inspected = await inspectWakeflowExternalInstruction(externalRoot, {
                profile: request.currentHostProfile,
                target,
                currentConfig: current,
                expectedCurrentConfigDigest: current === null ? null : computeWakeflowConfigDigest(current),
                desiredConfig: desired,
                expectedDesiredConfigDigest: computeWakeflowConfigDigest(desired),
                ...(request.signal === undefined ? {} : { signal: request.signal }),
            });
            if (inspected.status === "recompose-required") {
                const targetId = target.kind === "repository" ? target.repositoryId : target.surfaceId;
                steps.push(step({
                    stepId: `integration:external-instruction:${targetId}`,
                    kind: "recompose-external-instruction",
                    ownerId: "host-instruction-integration",
                    targetKey: wakeflowExternalInstructionTargetKey(target),
                    sourceDigest: inspected.source?.digest ?? null,
                    targetDigest: inspected.desiredAuthority.authorityDigest,
                    dependsOn: [],
                }));
            }
        }
        catch (error) {
            if (error instanceof WakeflowExternalInstructionInspectionError) {
                if (error.reason === "aborted")
                    fail("aborted", "$signal");
                addBlocker(blockers, `external-instruction-${error.reason}`);
            }
            else {
                throw error;
            }
        }
        finally {
            try {
                await externalRoot.close();
            }
            catch {
                addBlocker(blockers, "external-instruction-root-close-failure");
            }
        }
    }
}
async function requirementBoardRootAbsent(root) {
    try {
        await root.inspectExistingResource(REQUIREMENT_BOARD_ROOT_REF, "$board");
        return false;
    }
    catch (error) {
        if (error instanceof RootedDirectoryError &&
            error.reason === "resource-not-found") {
            return true;
        }
        if (error instanceof RootedDirectoryError)
            fail("root-scope", "$root");
        throw error;
    }
}
/** 需求看板目录缺失时由维护重建空看板（能力卡 1 §1.4 的 TODO 板修复）；存在即不触碰。 */
async function planRequirementBoardRepair(root, request, blockers, steps) {
    assertNotAborted(request.signal);
    if (blockers.has("active-layout-unavailable"))
        return;
    if (!(await requirementBoardRootAbsent(root)))
        return;
    steps.push(step({
        stepId: "active:requirement-board",
        kind: "initialize-requirement-board",
        ownerId: "requirement-board",
        targetKey: "active.board",
        sourceDigest: null,
        targetDigest: REQUIREMENT_BOARD_INITIALIZATION_AUTHORITY_DIGEST,
        dependsOn: steps.some((entry) => entry.stepId === "core:active-layout")
            ? ["core:active-layout"]
            : [],
    }));
}
/**
 * 当前宿主 capability 目录缺失时由维护 ensure 补齐；宿主运行时根尚未发布或前缀冲突时
 * 只报告（能力卡 1 §1.4：窗口投影 stale 与 missing 作为 blocker 显式报告）。
 */
/** 维护协议根的四个目录：fresh 与对账修复共用同一步骤，物理创建由 gate 的引导完成。 */
function localProtocolStep(core) {
    return step({
        stepId: "core:local-protocol",
        kind: "materialize-local-protocol",
        ownerId: "maintenance-bootstrap",
        targetKey: "local-protocol",
        sourceDigest: core.local.protocolDigest,
        targetDigest: resourceDigest([
            WAKEFLOW_LOCAL_ROOT_RESOURCE_DECLARATION,
            WAKEFLOW_RUNTIME_ROOT_RESOURCE_DECLARATION,
            WAKEFLOW_MAINTENANCE_ROOT_RESOURCE_DECLARATION,
            WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_RESOURCE_DECLARATION,
        ]),
        dependsOn: [],
    });
}
async function planHostCapabilityLayoutRepair(root, request, desired, blockers, steps) {
    assertNotAborted(request.signal);
    let authorityDigest;
    try {
        const authority = compileWakeflowHostCapabilityLayoutAuthority(request.currentHostProfile);
        if (authority.declarations.length === 0)
            return;
        authorityDigest = authority.authorityDigest;
    }
    catch (error) {
        if (error instanceof WakeflowHostCapabilityLayoutAuthorityError) {
            addBlocker(blockers, `host-capability-layout-${error.reason}`);
            return;
        }
        throw error;
    }
    let inspection;
    try {
        inspection = await inspectWakeflowHostCapabilityLayout(root, request.currentHostProfile, request.signal === undefined ? {} : { signal: request.signal });
    }
    catch (error) {
        if (error instanceof WakeflowHostCapabilityLayoutMaterializationError) {
            if (error.reason === "aborted")
                fail("aborted", "$signal");
            addBlocker(blockers, `host-capability-layout-${error.reason}`);
            return;
        }
        throw error;
    }
    if (inspection.status === "current")
        return;
    if (inspection.status === "conflict") {
        addBlocker(blockers, "host-capability-layout-conflict");
        return;
    }
    const dependsOn = [];
    if (inspection.status === "prerequisite-missing") {
        // 宿主运行时根缺失由对账重建（§13.114 D2）：先补目录骨架与未登记投影，capability 目录依赖它；
        // 仍有 Binding 的窗口由宿主 capability 的逐窗口操作在同一事务里重建 registered 投影。
        if (desired === null) {
            addBlocker(blockers, "window-runtime-missing");
            return;
        }
        const windowRuntime = compileWakeflowFreshWindowRuntimeAuthority(desired, request.currentHostProfile);
        steps.push(step({
            stepId: "host:window-runtime",
            kind: "publish-unregistered-window-runtime",
            ownerId: "window-runtime-projection",
            targetKey: request.currentHostProfile.hostId,
            sourceDigest: null,
            targetDigest: windowRuntime.authorityDigest,
            dependsOn: [],
        }));
        dependsOn.push("host:window-runtime");
    }
    steps.push(step({
        stepId: "host:capability-layout",
        kind: "materialize-host-capability-layout",
        ownerId: "host-capability-layout",
        targetKey: request.currentHostProfile.hostId,
        sourceDigest: inspection.status === "prerequisite-missing" ? null : inspection.observationDigest,
        targetDigest: authorityDigest,
        dependsOn,
    }));
}
function planFreshActiveWorkspaceProjection(request, desired, blockers, steps) {
    assertNotAborted(request.signal);
    // 只有 fresh 初始化写投影；之后的投影由观察切片按 Demand 与 pod 变更重算（§13.94 D5），
    // reconfigure 与 reconcile 的 apply 结束后由工作区切片触发一次刷新，preview 不再检查它。
    if (request.action !== "fresh-initialize")
        return;
    let authorityDigest;
    try {
        authorityDigest = renderWakeflowFreshActiveProjection(desired).authorityDigest;
    }
    catch (error) {
        if (error instanceof WakeflowError) {
            addBlocker(blockers, `active-workspace-projection-${error.reason}`);
            return;
        }
        throw error;
    }
    steps.push(step({
        stepId: "active:workspace-projection",
        kind: "publish-fresh-active-workspace-projection",
        ownerId: "active-workspace-projection",
        targetKey: "active.workspace-projection",
        sourceDigest: null,
        targetDigest: authorityDigest,
        dependsOn: ["active:requirement-board"],
    }));
}
/** 构建当前已实现静态 owner 的零写入物化预览。 */
export async function previewWakeflowStaticMaterialization(rootValue, requestValue, optionsValue = {}) {
    if (typeof rootValue !== "object" ||
        rootValue === null ||
        types.isProxy(rootValue) ||
        !(rootValue instanceof RootedDirectory)) {
        fail("input", "$root");
    }
    const request = parseWakeflowStaticMaterializationPreviewRequest(requestValue);
    if (typeof optionsValue !== "object" ||
        optionsValue === null ||
        types.isProxy(optionsValue) ||
        Object.keys(optionsValue).some((key) => key !== "gateContext")) {
        fail("input", "$options");
    }
    assertNotAborted(request.signal);
    const matrix = createWakeflowWorkspaceStaticResourceMatrix(request.currentHostProfile);
    let core;
    if (optionsValue.gateContext === undefined) {
        try {
            core = await inspectWakeflowWorkspaceCoreLayout(rootValue, request.signal === undefined ? {} : { signal: request.signal });
        }
        catch (error) {
            if (error instanceof WakeflowWorkspaceCoreLayoutInspectionError) {
                if (error.reason === "aborted")
                    fail("aborted", "$signal");
                fail("inspection", "$coreLayout");
            }
            throw error;
        }
    }
    else {
        try {
            core = wakeflowMaintenanceCoreInspectionForGateContext(optionsValue.gateContext, rootValue);
        }
        catch (error) {
            if (error instanceof WakeflowMaintenanceGateError) {
                fail("input", "$options.gateContext");
            }
            throw error;
        }
    }
    const blockers = new Set();
    const steps = [];
    const current = await currentSnapshot(rootValue, request.signal);
    assertNotAborted(request.signal);
    let desired = request.desiredConfig;
    if (request.action === "fresh-initialize") {
        if (current !== null || (await configResourceExists(rootValue))) {
            addBlocker(blockers, "fresh-config-present");
        }
        if (core.active.status !== "absent") {
            addBlocker(blockers, "fresh-active-not-absent");
        }
        if (!core.local.freshCompatible) {
            addBlocker(blockers, "fresh-local-not-bootstrap-prefix");
        }
    }
    else {
        if (current === null)
            addBlocker(blockers, "current-config-unavailable");
        // 活动布局缺失或不完整由维护 ensure 补齐（能力卡 1 §1.4 自动修复）；节点政策冲突只报告。
        if (core.active.status === "absent" || core.active.status === "incomplete") {
            steps.push(step({
                stepId: "core:active-layout",
                kind: "materialize-active-layout",
                ownerId: "active-layout",
                targetKey: "active.layout",
                sourceDigest: core.active.nodeDigest,
                targetDigest: WAKEFLOW_ACTIVE_LAYOUT_AUTHORITY_DIGEST,
                dependsOn: [],
            }));
        }
        else if (core.active.status !== "present") {
            addBlocker(blockers, "active-layout-unavailable");
        }
        if (core.local.status === "absent" || core.local.status === "bootstrap-prefix") {
            // 维护协议根缺失由对账重建（§13.114 D2）：gate 以 repair 模式引导，步骤只核对结果。
            steps.push(localProtocolStep(core));
        }
        else if (core.local.status !== "idle") {
            addBlocker(blockers, `maintenance-protocol-${core.local.status}`);
        }
    }
    if (request.action === "reconcile")
        desired = current?.model ?? null;
    if (desired === null)
        addBlocker(blockers, "desired-config-unavailable");
    if (request.action === "reconfigure" &&
        current !== null &&
        desired !== null) {
        if (current.model.program.programId !== desired.program.programId) {
            addBlocker(blockers, "reconfigure-program-identity-change");
        }
        if (!sameSemanticSection(current.model.topology, desired.topology) ||
            !sameSemanticSection(current.model.storage, desired.storage) ||
            !sameSemanticSection(current.model.hosts, desired.hosts)) {
            addBlocker(blockers, "reconfigure-layout-change-unsupported");
        }
        // pod 记录只由 wakeflow_pod 的配置事务改写（ADR-0010 D6）。
        if (!sameSemanticSection(current.model.pods, desired.pods)) {
            addBlocker(blockers, "reconfigure-pods-change-unsupported");
        }
    }
    let placements = null;
    if (desired !== null) {
        placements = await desiredPlacements(rootValue, desired);
        if (placements === null)
            addBlocker(blockers, "desired-placement-invalid");
        planFreshActiveWorkspaceProjection(request, desired, blockers, steps);
    }
    if (request.action === "fresh-initialize") {
        if (core.local.status !== "idle")
            steps.push(localProtocolStep(core));
        try {
            const shared = await inspectWakeflowSharedCoordinationLayout(rootValue);
            if (shared.status !== "missing") {
                addBlocker(blockers, "fresh-shared-coordination-present");
            }
            else {
                steps.push(step({
                    stepId: "coordination:shared-layout",
                    kind: "materialize-shared-coordination-layout",
                    ownerId: "shared-runtime-layout",
                    targetKey: "coordination.shared-layout",
                    sourceDigest: shared.observationDigest,
                    targetDigest: WAKEFLOW_SHARED_COORDINATION_LAYOUT_AUTHORITY_DIGEST,
                    dependsOn: steps.some((entry) => entry.stepId === "core:local-protocol")
                        ? ["core:local-protocol"]
                        : [],
                }));
            }
        }
        catch (error) {
            if (error instanceof WakeflowSharedCoordinationLayoutError) {
                addBlocker(blockers, `shared-coordination-${error.reason}`);
            }
            else {
                throw error;
            }
        }
        steps.push(step({
            stepId: "core:active-layout",
            kind: "materialize-active-layout",
            ownerId: "active-layout",
            targetKey: "active.layout",
            sourceDigest: null,
            targetDigest: WAKEFLOW_ACTIVE_LAYOUT_AUTHORITY_DIGEST,
            dependsOn: [],
        }));
        steps.push(step({
            stepId: "active:requirement-board",
            kind: "initialize-requirement-board",
            ownerId: "requirement-board",
            targetKey: "active.board",
            sourceDigest: null,
            targetDigest: REQUIREMENT_BOARD_INITIALIZATION_AUTHORITY_DIGEST,
            dependsOn: ["core:active-layout"],
        }));
    }
    if (request.action !== "fresh-initialize") {
        try {
            const shared = await inspectWakeflowSharedCoordinationLayout(rootValue);
            if (shared.status !== "current") {
                steps.push(step({
                    stepId: "coordination:shared-layout",
                    kind: "materialize-shared-coordination-layout",
                    ownerId: "shared-runtime-layout",
                    targetKey: "coordination.shared-layout",
                    sourceDigest: shared.observationDigest,
                    targetDigest: WAKEFLOW_SHARED_COORDINATION_LAYOUT_AUTHORITY_DIGEST,
                    dependsOn: [],
                }));
            }
        }
        catch (error) {
            if (error instanceof WakeflowSharedCoordinationLayoutError) {
                addBlocker(blockers, `shared-coordination-${error.reason}`);
            }
            else {
                throw error;
            }
        }
        await planRequirementBoardRepair(rootValue, request, blockers, steps);
        await planHostCapabilityLayoutRepair(rootValue, request, desired, blockers, steps);
    }
    if (desired !== null && placements !== null) {
        await inspectLedgerParticipant(request, placements, blockers, steps);
        if (request.action === "fresh-initialize") {
            try {
                const windowRuntime = compileWakeflowFreshWindowRuntimeAuthority(desired, request.currentHostProfile);
                steps.push(step({
                    stepId: "host:window-runtime",
                    kind: "publish-unregistered-window-runtime",
                    ownerId: "window-runtime-projection",
                    targetKey: request.currentHostProfile.hostId,
                    sourceDigest: null,
                    targetDigest: windowRuntime.authorityDigest,
                    dependsOn: [],
                }));
                const hostCapability = compileWakeflowHostCapabilityLayoutAuthority(request.currentHostProfile);
                if (hostCapability.declarations.length > 0) {
                    steps.push(step({
                        stepId: "host:capability-layout",
                        kind: "materialize-host-capability-layout",
                        ownerId: "host-capability-layout",
                        targetKey: request.currentHostProfile.hostId,
                        sourceDigest: null,
                        targetDigest: hostCapability.authorityDigest,
                        dependsOn: ["host:window-runtime"],
                    }));
                }
            }
            catch (error) {
                if (error instanceof WakeflowHostCapabilityLayoutAuthorityError) {
                    addBlocker(blockers, `host-capability-layout-${error.reason}`);
                }
                else if (error instanceof WakeflowFreshWindowRuntimeAuthorityError ||
                    error instanceof WakeflowWindowRuntimeDesiredTopologyError) {
                    addBlocker(blockers, `window-runtime-${error.reason}`);
                }
                else {
                    throw error;
                }
            }
        }
        await inspectSupportMemories(rootValue, request, current?.model ?? null, desired, placements, blockers, steps);
        try {
            const gitignore = await inspectWakeflowWorkspaceGitignore(rootValue, {
                matrix,
                expectedMatrixDigest: matrix.matrixDigest,
                hostProfiles: request.hostProfiles,
                ...(request.signal === undefined ? {} : { signal: request.signal }),
            });
            if (gitignore.status === "recompose-required") {
                steps.push(step({
                    stepId: "integration:gitignore",
                    kind: "recompose-gitignore",
                    ownerId: "workspace-ignore-integration",
                    targetKey: "workspace.ignore-integration",
                    sourceDigest: gitignore.source?.digest ?? null,
                    targetDigest: gitignore.authority.authorityDigest,
                    dependsOn: [],
                }));
            }
        }
        catch (error) {
            if (error instanceof WakeflowGitignoreInspectionError) {
                if (error.reason === "aborted")
                    fail("aborted", "$signal");
                addBlocker(blockers, `gitignore-${error.reason}`);
            }
            else {
                throw error;
            }
        }
        try {
            const program = await inspectWakeflowProgramInstruction(rootValue, {
                matrix,
                expectedMatrixDigest: matrix.matrixDigest,
                profile: request.currentHostProfile,
                currentConfig: current?.model ?? null,
                expectedCurrentConfigDigest: current?.configDigest ?? null,
                desiredConfig: desired,
                expectedDesiredConfigDigest: computeWakeflowConfigDigest(desired),
                ...(request.signal === undefined ? {} : { signal: request.signal }),
            });
            if (program.status === "recompose-required") {
                steps.push(step({
                    stepId: "integration:program-instruction",
                    kind: "recompose-program-instruction",
                    ownerId: "host-instruction-integration",
                    targetKey: request.currentHostProfile.hostId,
                    sourceDigest: program.source?.digest ?? null,
                    targetDigest: program.desiredAuthority.authorityDigest,
                    dependsOn: [],
                }));
            }
        }
        catch (error) {
            if (error instanceof WakeflowProgramInstructionInspectionError) {
                if (error.reason === "aborted")
                    fail("aborted", "$signal");
                addBlocker(blockers, `program-instruction-${error.reason}`);
            }
            else {
                throw error;
            }
        }
        await inspectExternalInstructions(rootValue, request, current?.model ?? null, desired, placements, blockers, steps);
        const desiredConfigDigest = computeWakeflowConfigDigest(desired);
        const configChanged = current?.configDigest !== desiredConfigDigest;
        if (request.action !== "reconcile" && configChanged) {
            const prerequisiteSteps = steps.map((entry) => entry.stepId);
            steps.push(step({
                stepId: "authority:config",
                kind: "publish-config",
                ownerId: "config-authority",
                targetKey: "workspace.config-authority",
                sourceDigest: current?.configDigest ?? null,
                targetDigest: desiredConfigDigest,
                dependsOn: prerequisiteSteps,
            }));
        }
    }
    const stepRank = new Map([
        ["materialize-local-protocol", 0],
        ["materialize-shared-coordination-layout", 1],
        ["materialize-active-layout", 2],
        ["initialize-requirement-board", 3],
        ["publish-fresh-active-workspace-projection", 4],
        ["materialize-ledger-layout", 5],
        ["publish-unregistered-window-runtime", 6],
        ["materialize-host-capability-layout", 7],
        ["materialize-support-root", 8],
        ["recompose-gitignore", 9],
        ["recompose-support-gitignore", 10],
        ["recompose-program-instruction", 11],
        ["recompose-external-instruction", 12],
        ["publish-support-memory", 13],
        ["publish-config", 14],
    ]);
    const sortedBlockers = Object.freeze([...blockers].sort());
    const orderedSteps = [...steps].sort((left, right) => {
        const rank = (stepRank.get(left.kind) ?? 99) - (stepRank.get(right.kind) ?? 99);
        return rank !== 0
            ? rank
            : left.stepId < right.stepId
                ? -1
                : left.stepId > right.stepId
                    ? 1
                    : 0;
    });
    const stepPosition = new Map(orderedSteps.map((entry, index) => [entry.stepId, index]));
    const frozenSteps = Object.freeze(orderedSteps.map((entry) => step({
        ...entry,
        dependsOn: [...entry.dependsOn].sort((left, right) => (stepPosition.get(left) ?? Number.MAX_SAFE_INTEGER) -
            (stepPosition.get(right) ?? Number.MAX_SAFE_INTEGER)),
    })));
    const currentConfigDigest = current?.configDigest ?? null;
    const desiredConfigDigest = desired === null ? null : computeWakeflowConfigDigest(desired);
    assertNotAborted(request.signal);
    const plan = {
        kind: "WakeflowStaticMaterializationPreview",
        schemaVersion: 1,
        executionBoundary: "preview-only",
        action: request.action,
        status: sortedBlockers.length === 0 ? "ready" : "blocked",
        currentConfigDigest,
        desiredConfigDigest,
        matrixDigest: matrix.matrixDigest,
        coreLayoutInspectionDigest: core.inspectionDigest,
        blockerCodes: sortedBlockers,
        steps: frozenSteps,
    };
    return parseWakeflowStaticMaterializationPreview(Object.freeze({
        ...plan,
        planDigest: computeWakeflowStaticMaterializationPreviewDigest(plan),
    }));
}
export { computeWakeflowStaticMaterializationPreviewDigest, parseWakeflowStaticMaterializationPreview, WAKEFLOW_STATIC_MATERIALIZATION_ACTIONS, WakeflowStaticMaterializationPreviewError, } from "./wakeflow-static-materialization-preview-contract.js";
