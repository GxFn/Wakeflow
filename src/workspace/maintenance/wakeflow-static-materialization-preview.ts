import { types } from "node:util";

import {
  computeWakeflowConfigV3Digest,
  type WakeflowConfigV3Model,
} from "../../configuration/wakeflow-config-v3.js";
import {
  readWakeflowConfigAuthoritySnapshot,
  WakeflowConfigAuthoritySnapshotError,
  WAKEFLOW_CONFIG_FILE_REF,
  type WakeflowConfigAuthoritySnapshot,
} from "../../configuration/wakeflow-config-authority-snapshot.js";
import {
  validateWakeflowConfigRootPlacements,
  WakeflowConfigRootPlacementError,
  type WakeflowConfigRootPlacementReport,
} from "../../configuration/wakeflow-config-root-placement.js";
import {
  computeCanonicalJsonSha256Digest,
} from "../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import type { JsonValue } from "../../foundation/data/json-value.js";
import {
  RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import {
  LEDGER_AUTHORITY_LAYOUT_DIGEST,
} from "../../governance/ledger/ledger-authority-layout.js";
import {
  LedgerAuthorityStore,
  LedgerAuthorityStoreError,
} from "../../governance/ledger/ledger-authority-store.js";
import {
  TODO_COLLECTION_INITIALIZATION_AUTHORITY_DIGEST,
} from "../../governance/todo/todo-collection-initialization-authority.js";
import {
  compileWakeflowFreshWindowRuntimeAuthority,
  WakeflowFreshWindowRuntimeAuthorityError,
} from "../window-runtime/wakeflow-window-runtime-fresh-authority.js";
import {
  WakeflowWindowRuntimeDesiredTopologyError,
} from "../window-runtime/wakeflow-window-runtime-desired-topology.js";
import {
  compileWakeflowHostCapabilityLayoutAuthority,
  WakeflowHostCapabilityLayoutAuthorityError,
} from "../host-runtime/wakeflow-host-capability-layout-authority.js";
import {
  inspectWakeflowWorkspaceGitignore,
  WakeflowGitignoreInspectionError,
} from "../managed-integration/wakeflow-gitignore-inspection.js";
import {
  inspectWakeflowProgramInstruction,
  WakeflowProgramInstructionInspectionError,
} from "../managed-integration/wakeflow-program-instruction-inspection.js";
import {
  createWakeflowManagedSupportResourceCatalog,
} from "../support/wakeflow-managed-support-resource-catalog.js";
import {
  createWakeflowSupportMemoryAuthority,
} from "../support/wakeflow-support-memory-authority.js";
import {
  inspectWakeflowSupportMemory,
  WakeflowSupportMemoryInspectionError,
} from "../support/wakeflow-support-memory-inspection.js";
import {
  createWakeflowWorkspaceStaticResourceMatrix,
} from "../wakeflow-workspace-static-resource-matrix.js";
import {
  inspectWakeflowWorkspaceCoreLayout,
  type WakeflowWorkspaceCoreLayoutInspection,
} from "./wakeflow-workspace-core-layout-inspection.js";
import {
  WAKEFLOW_ACTIVE_LAYOUT_AUTHORITY_DIGEST,
} from "../active/wakeflow-active-resource-catalog.js";
import {
  createWakeflowActiveWorkspaceFreshProjectionAuthority,
  WakeflowActiveWorkspaceFreshProjectionAuthorityError,
} from "../active/wakeflow-active-workspace-fresh-projection-authority.js";
import {
  inspectWakeflowActiveWorkspaceProjection,
  WakeflowActiveWorkspaceProjectionInspectionError,
} from "../active/wakeflow-active-workspace-projection-inspection.js";
import {
  WAKEFLOW_LOCAL_ROOT_RESOURCE_DECLARATION,
  WAKEFLOW_MAINTENANCE_ROOT_RESOURCE_DECLARATION,
  WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_RESOURCE_DECLARATION,
  WAKEFLOW_RUNTIME_ROOT_RESOURCE_DECLARATION,
} from "./wakeflow-maintenance-resource-catalog.js";
import {
  computeWakeflowStaticMaterializationPreviewDigest,
  failWakeflowStaticMaterializationPreview as fail,
  parseWakeflowStaticMaterializationPreviewRequest,
  type ParsedWakeflowStaticMaterializationPreviewRequest,
  type WakeflowStaticMaterializationPreview,
  type WakeflowStaticMaterializationPreviewRequest,
  type WakeflowStaticMaterializationStep,
  type WakeflowStaticMaterializationStepKind,
} from "./wakeflow-static-materialization-preview-contract.js";

/**
 * Wakeflow Workspace / Maintenance：当前静态 owner 集合的 preview-only 物化计划。
 *
 * 本计划组合 Core Layout、Config、Gitignore、Program Instruction 与 Wakeflow-managed
 * Support roots/memory 的真实只读 inspection。它不创建 maintenance journal、不写文件，
 * 且 `executionBoundary` 永远为 `preview-only`，不能直接作为公共 apply 授权。
 *
 * fresh 强制 Config/Active/受管Support roots absent，只允许 exact Local bootstrap-prefix；
 * placement-stable reconfigure 暂只允许 program/presentation/governance 语义变化；reconcile
 * 使用当前 Config。所有写步骤按“布局 → integration → whole-file → Config激活”排序。
 */

async function configResourceExists(root: RootedDirectory): Promise<boolean> {
  try {
    await root.inspectExistingResource(WAKEFLOW_CONFIG_FILE_REF, "$config");
    return true;
  } catch (error: unknown) {
    if (
      error instanceof RootedDirectoryError
      && error.reason === "resource-not-found"
    ) {
      return false;
    }
    if (error instanceof RootedDirectoryError) fail("root-scope", "$root");
    throw error;
  }
}

async function currentSnapshot(
  root: RootedDirectory,
  signal: AbortSignal | undefined,
): Promise<Readonly<WakeflowConfigAuthoritySnapshot> | null> {
  if (!(await configResourceExists(root))) return null;
  try {
    return await readWakeflowConfigAuthoritySnapshot(
      root,
      signal === undefined ? undefined : { signal },
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigAuthoritySnapshotError) return null;
    throw error;
  }
}

async function desiredPlacements(
  root: RootedDirectory,
  model: WakeflowConfigV3Model,
): Promise<Readonly<WakeflowConfigRootPlacementReport> | null> {
  try {
    return await validateWakeflowConfigRootPlacements(root, model);
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigRootPlacementError) return null;
    throw error;
  }
}

function sameSemanticSection(left: unknown, right: unknown): boolean {
  return computeCanonicalJsonSha256Digest(left as JsonValue)
    === computeCanonicalJsonSha256Digest(right as JsonValue);
}

function resourceDigest(value: unknown): Sha256Digest {
  return computeCanonicalJsonSha256Digest(value as JsonValue);
}

function step(
  value: WakeflowStaticMaterializationStep,
): Readonly<WakeflowStaticMaterializationStep> {
  return Object.freeze({ ...value, dependsOn: Object.freeze([...value.dependsOn]) });
}

function addBlocker(blockers: Set<string>, code: string): void {
  blockers.add(code);
}

function placementFor(
  report: Readonly<WakeflowConfigRootPlacementReport>,
  surfaceId: string,
) {
  return report.roots.find((entry) => (
    entry.key === `support.${surfaceId}.root`
  )) ?? null;
}

function ledgerPlacement(
  report: Readonly<WakeflowConfigRootPlacementReport>,
) {
  return report.roots.find((entry) => entry.key === "ledger.root") ?? null;
}

async function inspectLedgerParticipant(
  request: Readonly<ParsedWakeflowStaticMaterializationPreviewRequest>,
  report: Readonly<WakeflowConfigRootPlacementReport>,
  blockers: Set<string>,
  steps: WakeflowStaticMaterializationStep[],
): Promise<void> {
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
  if (placement.state !== "present") {
    addBlocker(blockers, "ledger-root-missing");
    return;
  }
  let root: RootedDirectory;
  try {
    root = await RootedDirectory.open(placement.absolutePath, "$ledgerRoot");
  } catch {
    addBlocker(blockers, "ledger-root-unavailable");
    return;
  }
  try {
    const inspection = await new LedgerAuthorityStore(root).inspectLayout(
      request.signal === undefined ? undefined : { signal: request.signal },
    );
    if (inspection.status !== "current") {
      addBlocker(blockers, `ledger-layout-${inspection.status}`);
    }
  } catch (error: unknown) {
    if (error instanceof LedgerAuthorityStoreError) {
      addBlocker(blockers, `ledger-layout-${error.reason}`);
    } else {
      throw error;
    }
  } finally {
    try {
      await root.close();
    } catch {
      addBlocker(blockers, "ledger-root-close-failure");
    }
  }
}

async function inspectSupportMemories(
  root: RootedDirectory,
  request: Readonly<ParsedWakeflowStaticMaterializationPreviewRequest>,
  current: WakeflowConfigV3Model | null,
  desired: WakeflowConfigV3Model,
  report: Readonly<WakeflowConfigRootPlacementReport>,
  blockers: Set<string>,
  steps: WakeflowStaticMaterializationStep[],
): Promise<void> {
  const catalog = createWakeflowManagedSupportResourceCatalog(
    desired,
    request.currentHostProfile,
  );
  for (const surface of desired.topology.supportSurfaces) {
    if (surface.ownership !== "wakeflow-managed") continue;
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
      const declaration = catalog.declarations.find((entry) => (
        entry.declarationId === `support.${surface.surfaceId}.root`
      ));
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
      const authority = createWakeflowSupportMemoryAuthority(
        desired,
        request.currentHostProfile,
        surface.surfaceId,
      );
      steps.push(step({
        stepId: `support-memory:${surface.surfaceId}`,
        kind: "publish-support-memory",
        ownerId: "support-memory",
        targetKey: `${surface.surfaceId}:${request.currentHostProfile.hostId}`,
        sourceDigest: null,
        targetDigest: authority.authorityDigest,
        dependsOn: [rootStepId],
      }));
      continue;
    }
    if (placement.state !== "present") {
      addBlocker(blockers, "support-root-missing");
      continue;
    }
    let supportRoot: RootedDirectory;
    try {
      supportRoot = await RootedDirectory.open(placement.absolutePath);
    } catch {
      addBlocker(blockers, "support-root-unavailable");
      continue;
    }
    try {
      const inspected = await inspectWakeflowSupportMemory(
        root,
        supportRoot,
        {
          currentConfig: current,
          expectedCurrentConfigDigest: current === null
            ? null
            : computeWakeflowConfigV3Digest(current),
          desiredConfig: desired,
          expectedDesiredConfigDigest: computeWakeflowConfigV3Digest(desired),
          profile: request.currentHostProfile,
          expectedCatalogDigest: catalog.catalogDigest,
          surfaceId: surface.surfaceId,
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        },
      );
      if (inspected.status === "publication-required") {
        steps.push(step({
          stepId: `support-memory:${surface.surfaceId}`,
          kind: "publish-support-memory",
          ownerId: "support-memory",
          targetKey: `${surface.surfaceId}:${request.currentHostProfile.hostId}`,
          sourceDigest: inspected.source?.digest ?? null,
          targetDigest: inspected.desiredAuthority.authorityDigest,
          dependsOn: [],
        }));
      }
    } catch (error: unknown) {
      if (error instanceof WakeflowSupportMemoryInspectionError) {
        addBlocker(blockers, `support-memory-${error.reason}`);
      } else {
        throw error;
      }
    } finally {
      await supportRoot.close();
    }
  }
}

async function inspectActiveWorkspaceProjectionParticipant(
  root: RootedDirectory,
  request: Readonly<ParsedWakeflowStaticMaterializationPreviewRequest>,
  desired: WakeflowConfigV3Model,
  blockers: Set<string>,
  steps: WakeflowStaticMaterializationStep[],
): Promise<void> {
  let authority;
  try {
    authority = createWakeflowActiveWorkspaceFreshProjectionAuthority(desired);
  } catch (error: unknown) {
    if (error instanceof WakeflowActiveWorkspaceFreshProjectionAuthorityError) {
      addBlocker(blockers, `active-workspace-projection-${error.reason}`);
      return;
    }
    throw error;
  }
  if (request.action === "fresh-initialize") {
    steps.push(step({
      stepId: "active:workspace-projection",
      kind: "publish-fresh-active-workspace-projection",
      ownerId: "active-workspace-projection",
      targetKey: "active.workspace-projection",
      sourceDigest: null,
      targetDigest: authority.authorityDigest,
      dependsOn: ["active:todo-collection"],
    }));
    return;
  }
  try {
    const inspection = await inspectWakeflowActiveWorkspaceProjection(
      root,
      {
        desiredConfig: desired,
        expectedDesiredConfigDigest: computeWakeflowConfigV3Digest(desired),
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      },
    );
    if (inspection.status === "publication-required") {
      steps.push(step({
        stepId: "active:workspace-projection",
        kind: "publish-fresh-active-workspace-projection",
        ownerId: "active-workspace-projection",
        targetKey: "active.workspace-projection",
        sourceDigest: inspection.observationDigest,
        targetDigest: authority.authorityDigest,
        dependsOn: [],
      }));
    }
  } catch (error: unknown) {
    if (error instanceof WakeflowActiveWorkspaceProjectionInspectionError) {
      addBlocker(blockers, `active-workspace-projection-${error.reason}`);
      return;
    }
    throw error;
  }
}

/** 构建当前已实现静态 owner 的零写入物化预览。 */
export async function previewWakeflowStaticMaterialization(
  rootValue: RootedDirectory,
  requestValue: WakeflowStaticMaterializationPreviewRequest,
): Promise<Readonly<WakeflowStaticMaterializationPreview>> {
  if (
    typeof rootValue !== "object"
    || rootValue === null
    || types.isProxy(rootValue)
    || !(rootValue instanceof RootedDirectory)
  ) {
    fail("input", "$root");
  }
  const request = parseWakeflowStaticMaterializationPreviewRequest(
    requestValue,
  );
  if (request.signal?.aborted === true) fail("aborted", "$signal");
  const matrix = createWakeflowWorkspaceStaticResourceMatrix(
    request.currentHostProfile,
  );
  let core: Readonly<WakeflowWorkspaceCoreLayoutInspection>;
  try {
    core = await inspectWakeflowWorkspaceCoreLayout(
      rootValue,
      request.signal === undefined ? {} : { signal: request.signal },
    );
  } catch {
    fail("inspection", "$coreLayout");
  }
  const blockers = new Set<string>();
  const steps: WakeflowStaticMaterializationStep[] = [];
  const current = await currentSnapshot(rootValue, request.signal);
  let desired = request.desiredConfig;

  if (request.action === "fresh-initialize") {
    if (current !== null || await configResourceExists(rootValue)) {
      addBlocker(blockers, "fresh-config-present");
    }
    if (core.active.status !== "absent") {
      addBlocker(blockers, "fresh-active-not-absent");
    }
    if (!core.local.freshCompatible) {
      addBlocker(blockers, "fresh-local-not-bootstrap-prefix");
    }
  } else {
    if (current === null) addBlocker(blockers, "current-config-unavailable");
    if (core.active.status !== "present") {
      addBlocker(blockers, "active-layout-unavailable");
    }
    if (core.local.status !== "idle") {
      addBlocker(blockers, `maintenance-protocol-${core.local.status}`);
    }
  }
  if (request.action === "reconcile") desired = current?.model ?? null;
  if (desired === null) addBlocker(blockers, "desired-config-unavailable");

  if (
    request.action === "reconfigure"
    && current !== null
    && desired !== null
  ) {
    if (current.model.program.programId !== desired.program.programId) {
      addBlocker(blockers, "reconfigure-program-identity-change");
    }
    if (
      !sameSemanticSection(current.model.topology, desired.topology)
      || !sameSemanticSection(current.model.storage, desired.storage)
      || !sameSemanticSection(current.model.hosts, desired.hosts)
    ) {
      addBlocker(blockers, "reconfigure-layout-change-unsupported");
    }
  }

  let placements: Readonly<WakeflowConfigRootPlacementReport> | null = null;
  if (desired !== null) {
    placements = await desiredPlacements(rootValue, desired);
    if (placements === null) addBlocker(blockers, "desired-placement-invalid");
    await inspectActiveWorkspaceProjectionParticipant(
      rootValue,
      request,
      desired,
      blockers,
      steps,
    );
  }

  if (request.action === "fresh-initialize") {
    if (core.local.status !== "idle") {
      const localDeclarations = [
        WAKEFLOW_LOCAL_ROOT_RESOURCE_DECLARATION,
        WAKEFLOW_RUNTIME_ROOT_RESOURCE_DECLARATION,
        WAKEFLOW_MAINTENANCE_ROOT_RESOURCE_DECLARATION,
        WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_RESOURCE_DECLARATION,
      ];
      steps.push(step({
        stepId: "core:local-protocol",
        kind: "materialize-local-protocol",
        ownerId: "maintenance-bootstrap",
        targetKey: "local-protocol",
        sourceDigest: core.local.protocolDigest,
        targetDigest: resourceDigest(localDeclarations),
        dependsOn: [],
      }));
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
      stepId: "active:todo-collection",
      kind: "initialize-todo-collection",
      ownerId: "todo-collection",
      targetKey: "active.todo.collection",
      sourceDigest: null,
      targetDigest: TODO_COLLECTION_INITIALIZATION_AUTHORITY_DIGEST,
      dependsOn: ["core:active-layout"],
    }));
  }

  if (desired !== null && placements !== null) {
    await inspectLedgerParticipant(request, placements, blockers, steps);

    if (request.action === "fresh-initialize") {
      try {
        const windowRuntime = compileWakeflowFreshWindowRuntimeAuthority(
          desired,
          request.currentHostProfile,
        );
        steps.push(step({
          stepId: "host:window-runtime",
          kind: "publish-unregistered-window-runtime",
          ownerId: "window-runtime-projection",
          targetKey: request.currentHostProfile.hostId,
          sourceDigest: null,
          targetDigest: windowRuntime.authorityDigest,
          dependsOn: [],
        }));
        const hostCapability = compileWakeflowHostCapabilityLayoutAuthority(
          request.currentHostProfile,
        );
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
      } catch (error: unknown) {
        if (error instanceof WakeflowHostCapabilityLayoutAuthorityError) {
          addBlocker(blockers, `host-capability-layout-${error.reason}`);
        } else if (
          error instanceof WakeflowFreshWindowRuntimeAuthorityError
          || error instanceof WakeflowWindowRuntimeDesiredTopologyError
        ) {
          addBlocker(blockers, `window-runtime-${error.reason}`);
        } else {
          throw error;
        }
      }
    }

    await inspectSupportMemories(
      rootValue,
      request,
      current?.model ?? null,
      desired,
      placements,
      blockers,
      steps,
    );

    try {
      const gitignore = await inspectWakeflowWorkspaceGitignore(
        rootValue,
        {
          matrix,
          expectedMatrixDigest: matrix.matrixDigest,
          hostProfiles: request.hostProfiles,
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        },
      );
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
    } catch (error: unknown) {
      if (error instanceof WakeflowGitignoreInspectionError) {
        addBlocker(blockers, `gitignore-${error.reason}`);
      } else {
        throw error;
      }
    }

    try {
      const program = await inspectWakeflowProgramInstruction(
        rootValue,
        {
          matrix,
          expectedMatrixDigest: matrix.matrixDigest,
          profile: request.currentHostProfile,
          currentConfig: current?.model ?? null,
          expectedCurrentConfigDigest: current?.configDigest ?? null,
          desiredConfig: desired,
          expectedDesiredConfigDigest: computeWakeflowConfigV3Digest(desired),
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        },
      );
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
    } catch (error: unknown) {
      if (error instanceof WakeflowProgramInstructionInspectionError) {
        addBlocker(blockers, `program-instruction-${error.reason}`);
      } else {
        throw error;
      }
    }

    const desiredConfigDigest = computeWakeflowConfigV3Digest(desired);
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

  const stepRank = new Map<WakeflowStaticMaterializationStepKind, number>([
    ["materialize-local-protocol", 0],
    ["materialize-active-layout", 1],
    ["initialize-todo-collection", 2],
    ["publish-fresh-active-workspace-projection", 3],
    ["materialize-ledger-layout", 4],
    ["publish-unregistered-window-runtime", 5],
    ["materialize-host-capability-layout", 6],
    ["materialize-support-root", 7],
    ["recompose-gitignore", 8],
    ["recompose-program-instruction", 9],
    ["publish-support-memory", 10],
    ["publish-config", 11],
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
  const stepPosition = new Map(orderedSteps.map((entry, index) => (
    [entry.stepId, index] as const
  )));
  const frozenSteps = Object.freeze(orderedSteps.map((entry) => step({
    ...entry,
    dependsOn: [...entry.dependsOn].sort((left, right) => (
      (stepPosition.get(left) ?? Number.MAX_SAFE_INTEGER)
      - (stepPosition.get(right) ?? Number.MAX_SAFE_INTEGER)
    )),
  })));
  const currentConfigDigest = current?.configDigest ?? null;
  const desiredConfigDigest = desired === null
    ? null
    : computeWakeflowConfigV3Digest(desired);
  const plan = {
    kind: "WakeflowStaticMaterializationPreview" as const,
    schemaVersion: 1 as const,
    executionBoundary: "preview-only" as const,
    action: request.action,
    status: sortedBlockers.length === 0 ? "ready" as const : "blocked" as const,
    currentConfigDigest,
    desiredConfigDigest,
    matrixDigest: matrix.matrixDigest,
    coreLayoutInspectionDigest: core.inspectionDigest,
    blockerCodes: sortedBlockers,
    steps: frozenSteps,
  };
  return Object.freeze({
    ...plan,
    planDigest: computeWakeflowStaticMaterializationPreviewDigest(plan),
  });
}

export {
  WAKEFLOW_STATIC_MATERIALIZATION_ACTIONS,
  WakeflowStaticMaterializationPreviewError,
  computeWakeflowStaticMaterializationPreviewDigest,
  parseWakeflowStaticMaterializationPreview,
  type WakeflowStaticMaterializationAction,
  type WakeflowStaticMaterializationPreview,
  type WakeflowStaticMaterializationPreviewErrorReason,
  type WakeflowStaticMaterializationPreviewRequest,
  type WakeflowStaticMaterializationStep,
  type WakeflowStaticMaterializationStepKind,
} from "./wakeflow-static-materialization-preview-contract.js";
