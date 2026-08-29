import { types } from "node:util";

import {
  computeWakeflowConfigV3Digest,
  parseWakeflowConfigV3,
  WakeflowConfigV3Error,
  type WakeflowConfigV3Model,
} from "../../configuration/wakeflow-config-v3.js";
import {
  publishWakeflowConfigAuthority,
  WakeflowConfigAuthorityPublicationError,
} from "../../configuration/wakeflow-config-authority-publication.js";
import {
  replaceWakeflowConfigAuthority,
  WakeflowConfigAuthorityReplacementError,
} from "../../configuration/wakeflow-config-authority-replacement.js";
import {
  readWakeflowConfigAuthoritySnapshot,
  WakeflowConfigAuthoritySnapshotError,
  type WakeflowConfigAuthoritySnapshot,
} from "../../configuration/wakeflow-config-authority-snapshot.js";
import {
  validateWakeflowConfigRootPlacements,
  WakeflowConfigRootPlacementError,
} from "../../configuration/wakeflow-config-root-placement.js";
import {
  computeCanonicalJsonSha256Digest,
} from "../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import type { JsonValue } from "../../foundation/data/json-value.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import {
  materializeAbsoluteDirectoryPlacement,
  AbsoluteDirectoryMaterializationError,
} from "../../foundation/filesystem/absolute-directory-materialization.js";
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
  LEDGER_DURABLE_DIRECTORY_MODE,
} from "../../governance/ledger/ledger-authority-storage-policy.js";
import {
  initializeFreshTodoCollection,
  FreshTodoCollectionInitializationError,
} from "../../governance/todo/todo-collection-initialization.js";
import {
  TODO_COLLECTION_INITIALIZATION_AUTHORITY_DIGEST,
} from "../../governance/todo/todo-collection-initialization-authority.js";
import {
  createWakeflowGitignoreBodyAuthority,
} from "../managed-integration/wakeflow-gitignore-body-authority.js";
import {
  recomposeWakeflowWorkspaceGitignore,
  WakeflowGitignoreRecompositionError,
} from "../managed-integration/wakeflow-gitignore-recomposition.js";
import {
  createWakeflowProgramInstructionBodyAuthority,
} from "../managed-integration/wakeflow-program-instruction-body-authority.js";
import {
  recomposeWakeflowProgramInstruction,
  WakeflowProgramInstructionRecompositionError,
} from "../managed-integration/wakeflow-program-instruction-recomposition.js";
import {
  createWakeflowManagedSupportResourceCatalog,
} from "../support/wakeflow-managed-support-resource-catalog.js";
import {
  materializeWakeflowManagedSupportRoot,
  WakeflowManagedSupportRootMaterializationError,
} from "../support/wakeflow-managed-support-root-materialization.js";
import {
  createWakeflowSupportMemoryAuthority,
} from "../support/wakeflow-support-memory-authority.js";
import {
  publishWakeflowSupportMemory,
  WakeflowSupportMemoryPublicationError,
} from "../support/wakeflow-support-memory-publication.js";
import {
  createWakeflowWorkspaceStaticResourceMatrix,
} from "../wakeflow-workspace-static-resource-matrix.js";
import {
  compileWakeflowHostCapabilityLayoutAuthority,
} from "../host-runtime/wakeflow-host-capability-layout-authority.js";
import {
  materializeWakeflowHostCapabilityLayout,
  WakeflowHostCapabilityLayoutMaterializationError,
} from "../host-runtime/wakeflow-host-capability-layout-materialization.js";
import {
  compileWakeflowFreshWindowRuntimeAuthority,
} from "../window-runtime/wakeflow-window-runtime-fresh-authority.js";
import {
  publishFreshWakeflowWindowRuntime,
  WakeflowFreshWindowRuntimePublicationError,
} from "../window-runtime/wakeflow-window-runtime-fresh-publication.js";
import {
  materializeWakeflowActiveLayout,
  WakeflowActiveLayoutMaterializationError,
} from "../active/wakeflow-active-layout-materialization.js";
import {
  WAKEFLOW_ACTIVE_LAYOUT_AUTHORITY_DIGEST,
} from "../active/wakeflow-active-resource-catalog.js";
import {
  createWakeflowActiveWorkspaceFreshProjectionAuthority,
} from "../active/wakeflow-active-workspace-fresh-projection-authority.js";
import {
  publishWakeflowActiveWorkspaceProjection,
  WakeflowActiveWorkspaceProjectionPublicationError,
} from "../active/wakeflow-active-workspace-projection-publication.js";
import {
  assertWakeflowMaintenanceGateContext,
  type WakeflowMaintenanceGateContext,
} from "./wakeflow-maintenance-gate.js";
import {
  WAKEFLOW_LOCAL_ROOT_RESOURCE_DECLARATION,
  WAKEFLOW_MAINTENANCE_ROOT_RESOURCE_DECLARATION,
  WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_RESOURCE_DECLARATION,
  WAKEFLOW_RUNTIME_ROOT_RESOURCE_DECLARATION,
} from "./wakeflow-maintenance-resource-catalog.js";
import {
  inspectWakeflowWorkspaceCoreLayout,
} from "./wakeflow-workspace-core-layout-inspection.js";
import {
  parseWakeflowStaticMaterializationPreview,
  parseWakeflowStaticMaterializationPreviewRequest,
  type WakeflowStaticMaterializationPreviewRequest,
  type WakeflowStaticMaterializationStep,
} from "./wakeflow-static-materialization-preview-contract.js";

/**
 * Wakeflow Workspace / Maintenance：静态物化计划的闭合 step dispatcher。
 *
 * 每个 step 都从同一 preview/request 重算领域 authority，并只调用已经存在的 owner。
 * dispatcher 不更新 journal、不排序 step、不取得 gate，也不开放自定义 handler registry。
 * `recoveringAffectedStep` 只允许 fresh whole-owned目录接受 exact existing；普通执行仍要求
 * strict absent create。
 */

export interface WakeflowStaticMaterializationStepExecutionOptions {
  readonly sourceConfig: WakeflowConfigV3Model | null;
  readonly recoveringAffectedStep: boolean;
  readonly signal?: AbortSignal;
}

export interface WakeflowStaticMaterializationStepExecutionReceipt {
  readonly kind: "WakeflowStaticMaterializationStepExecutionReceipt";
  readonly stepId: string;
  readonly disposition: "current" | "created" | "updated";
  readonly observationDigest: Sha256Digest;
}

export type WakeflowStaticMaterializationStepExecutionErrorReason =
  | "input"
  | "gate"
  | "plan"
  | "source-config"
  | "target-authority"
  | "strict-absent"
  | "owner"
  | "root-scope"
  | "aborted";

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
} as const satisfies Readonly<Record<
  WakeflowStaticMaterializationStepExecutionErrorReason,
  string
>>;

/** 静态物化 step 执行失败的稳定、脱敏错误。 */
export class WakeflowStaticMaterializationStepExecutionError extends Error {
  override readonly name = "WakeflowStaticMaterializationStepExecutionError";
  readonly code = "wakeflow-static-materialization-step-execution" as const;
  readonly reason: WakeflowStaticMaterializationStepExecutionErrorReason;
  readonly path: string;

  constructor(
    reason: WakeflowStaticMaterializationStepExecutionErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

function fail(
  reason: WakeflowStaticMaterializationStepExecutionErrorReason,
  path: string,
): never {
  throw new WakeflowStaticMaterializationStepExecutionError(reason, path);
}

function authorityDigest(value: unknown): Sha256Digest {
  return computeCanonicalJsonSha256Digest(value as JsonValue);
}

function receipt(
  stepId: string,
  disposition: WakeflowStaticMaterializationStepExecutionReceipt["disposition"],
  value: unknown,
): Readonly<WakeflowStaticMaterializationStepExecutionReceipt> {
  return Object.freeze({
    kind: "WakeflowStaticMaterializationStepExecutionReceipt",
    stepId,
    disposition,
    observationDigest: authorityDigest(value),
  });
}

function desiredConfig(
  request: ReturnType<typeof parseWakeflowStaticMaterializationPreviewRequest>,
  sourceConfig: WakeflowConfigV3Model | null,
): WakeflowConfigV3Model {
  const desired = request.action === "reconcile"
    ? sourceConfig
    : request.desiredConfig;
  if (desired === null) fail("source-config", "$options.sourceConfig");
  return desired;
}

function assertStepTarget(
  step: Readonly<WakeflowStaticMaterializationStep>,
  actual: Sha256Digest,
): void {
  if (step.targetDigest !== actual) {
    fail("target-authority", "$step.targetDigest");
  }
}

async function optionalConfigSnapshot(
  root: RootedDirectory,
): Promise<Readonly<WakeflowConfigAuthoritySnapshot> | null> {
  try {
    return await readWakeflowConfigAuthoritySnapshot(root);
  } catch (error: unknown) {
    if (
      error instanceof WakeflowConfigAuthoritySnapshotError
      && error.reason === "source"
    ) {
      return null;
    }
    if (error instanceof WakeflowConfigAuthoritySnapshotError) {
      fail("owner", "$config");
    }
    throw error;
  }
}

async function executeLocalProtocol(
  root: RootedDirectory,
  step: Readonly<WakeflowStaticMaterializationStep>,
  signal: AbortSignal | undefined,
) {
  assertStepTarget(step, authorityDigest([
    WAKEFLOW_LOCAL_ROOT_RESOURCE_DECLARATION,
    WAKEFLOW_RUNTIME_ROOT_RESOURCE_DECLARATION,
    WAKEFLOW_MAINTENANCE_ROOT_RESOURCE_DECLARATION,
    WAKEFLOW_MAINTENANCE_TRANSACTIONS_ROOT_RESOURCE_DECLARATION,
  ]));
  const core = await inspectWakeflowWorkspaceCoreLayout(
    root,
    signal === undefined ? {} : { signal },
  );
  if (!core.local.protocolComplete || core.local.status !== "busy") {
    fail("owner", "$coreLayout.local");
  }
  return receipt(step.stepId, "current", {
    coreLayoutInspectionDigest: core.inspectionDigest,
    localProtocolDigest: core.local.protocolDigest,
  });
}

async function executeActiveLayout(
  root: RootedDirectory,
  step: Readonly<WakeflowStaticMaterializationStep>,
  recovering: boolean,
  signal: AbortSignal | undefined,
) {
  assertStepTarget(step, WAKEFLOW_ACTIVE_LAYOUT_AUTHORITY_DIGEST);
  try {
    const result = await materializeWakeflowActiveLayout(root, {
      recoveringFreshLayout: recovering,
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
  } catch (error: unknown) {
    if (error instanceof WakeflowActiveLayoutMaterializationError) {
      if (error.reason === "strict-absent") {
        fail("strict-absent", "$activeLayout");
      }
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "root-scope") fail("root-scope", "$root");
      fail("owner", "$activeLayout");
    }
    throw error;
  }
}

async function executeTodoCollectionInitialization(
  root: RootedDirectory,
  step: Readonly<WakeflowStaticMaterializationStep>,
  request: ReturnType<typeof parseWakeflowStaticMaterializationPreviewRequest>,
  recovering: boolean,
  signal: AbortSignal | undefined,
) {
  if (
    request.action !== "fresh-initialize"
    || step.targetKey !== "active.todo.collection"
  ) {
    fail("plan", "$todoCollection");
  }
  assertStepTarget(step, TODO_COLLECTION_INITIALIZATION_AUTHORITY_DIGEST);
  try {
    const result = await initializeFreshTodoCollection(root, {
      recoveringFreshCollection: recovering,
      ...(signal === undefined ? {} : { signal }),
    });
    return receipt(step.stepId, result.disposition, {
      authorityDigest: result.authorityDigest,
      collectionDigest: result.snapshot.collection.collectionDigest,
      projectionDigest: result.snapshot.projection.source?.digest ?? null,
    });
  } catch (error: unknown) {
    if (error instanceof FreshTodoCollectionInitializationError) {
      if (error.reason === "strict-absent") {
        fail("strict-absent", "$todoCollection");
      }
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "root-scope") fail("root-scope", "$root");
      fail("owner", "$todoCollection");
    }
    throw error;
  }
}

async function executeActiveWorkspaceProjection(
  root: RootedDirectory,
  step: Readonly<WakeflowStaticMaterializationStep>,
  desired: WakeflowConfigV3Model,
  recovering: boolean,
  signal: AbortSignal | undefined,
) {
  const authority = createWakeflowActiveWorkspaceFreshProjectionAuthority(
    desired,
  );
  assertStepTarget(step, authority.authorityDigest);
  try {
    const result = await publishWakeflowActiveWorkspaceProjection(
      root,
      {
        desiredConfig: desired,
        expectedDesiredConfigDigest: computeWakeflowConfigV3Digest(desired),
      },
      {
        recoveringAffectedPublication: recovering,
        ...(signal === undefined ? {} : { signal }),
      },
    );
    return receipt(step.stepId, result.disposition, {
      authorityDigest: result.inspection.authority.authorityDigest,
      observationDigest: result.inspection.observationDigest,
      files: result.inspection.targets.map((entry) => ({
        resourcePath: entry.resourcePath,
        digest: entry.currentDigest,
      })),
    });
  } catch (error: unknown) {
    if (error instanceof WakeflowActiveWorkspaceProjectionPublicationError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "root-scope") fail("root-scope", "$root");
      fail("owner", "$projection");
    }
    throw error;
  }
}

async function executeLedgerLayout(
  root: RootedDirectory,
  step: Readonly<WakeflowStaticMaterializationStep>,
  request: ReturnType<typeof parseWakeflowStaticMaterializationPreviewRequest>,
  desired: WakeflowConfigV3Model,
  recovering: boolean,
  signal: AbortSignal | undefined,
) {
  if (
    request.action !== "fresh-initialize"
    || step.targetKey !== "ledger.root"
  ) {
    fail("plan", "$ledgerRoot");
  }
  assertStepTarget(step, LEDGER_AUTHORITY_LAYOUT_DIGEST);
  let placements;
  try {
    placements = await validateWakeflowConfigRootPlacements(root, desired);
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigRootPlacementError) {
      fail("root-scope", "$ledgerRoot");
    }
    throw error;
  }
  const placement = placements.roots.find((entry) => (
    entry.key === "ledger.root"
  ));
  if (placement === undefined) fail("plan", "$ledgerRoot");

  let materialized;
  try {
    materialized = await materializeAbsoluteDirectoryPlacement(
      placement.absolutePath,
      {
        mode: LEDGER_DURABLE_DIRECTORY_MODE,
        ...(signal === undefined ? {} : { signal }),
      },
    );
  } catch (error: unknown) {
    if (error instanceof AbsoluteDirectoryMaterializationError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("owner", "$ledgerRoot");
    }
    throw error;
  }
  const finalSegment = materialized.segments.at(-1);
  if (
    finalSegment === undefined
    || (!recovering && finalSegment.disposition !== "created")
    || materialized.node.kind !== "directory"
    || materialized.node.permissionBits !== LEDGER_DURABLE_DIRECTORY_MODE
  ) {
    fail("strict-absent", "$ledgerRoot");
  }

  let ledgerRoot: RootedDirectory;
  try {
    ledgerRoot = await RootedDirectory.open(
      materialized.absolutePath,
      "$ledgerRoot",
    );
  } catch (error: unknown) {
    if (error instanceof RootedDirectoryError) fail("root-scope", "$ledgerRoot");
    throw error;
  }
  let inspection;
  let primaryError: unknown;
  try {
    const store = new LedgerAuthorityStore(ledgerRoot);
    await store.initialize({
      freshLedger: true,
      ...(signal === undefined ? {} : { signal }),
    });
    inspection = await store.inspectLayout(
      signal === undefined ? undefined : { signal },
    );
  } catch (error: unknown) {
    primaryError = error;
  }
  let closeError: unknown;
  try {
    await ledgerRoot.close();
  } catch (error: unknown) {
    closeError = error;
  }
  if (primaryError !== undefined) {
    if (primaryError instanceof LedgerAuthorityStoreError) {
      fail(
        primaryError.reason === "aborted" ? "aborted" : "owner",
        "$ledgerLayout",
      );
    }
    throw primaryError;
  }
  if (closeError !== undefined || inspection?.status !== "current") {
    fail("owner", "$ledgerLayout");
  }
  return receipt(
    step.stepId,
    finalSegment.disposition === "created" ? "created" : "current",
    {
      absolutePlacementState: placement.state,
      authorityDigest: inspection.authorityDigest,
      observationDigest: inspection.observationDigest,
    },
  );
}

async function executeUnregisteredWindowRuntime(
  root: RootedDirectory,
  step: Readonly<WakeflowStaticMaterializationStep>,
  request: ReturnType<typeof parseWakeflowStaticMaterializationPreviewRequest>,
  desired: WakeflowConfigV3Model,
  recovering: boolean,
  signal: AbortSignal | undefined,
) {
  if (
    request.action !== "fresh-initialize"
    || step.targetKey !== request.currentHostProfile.hostId
  ) {
    fail("plan", "$windowRuntime");
  }
  const authority = compileWakeflowFreshWindowRuntimeAuthority(
    desired,
    request.currentHostProfile,
  );
  assertStepTarget(step, authority.authorityDigest);
  try {
    const result = await publishFreshWakeflowWindowRuntime(
      root,
      desired,
      request.currentHostProfile,
      {
        recoveringFreshPublication: recovering,
        ...(signal === undefined ? {} : { signal }),
      },
    );
    return receipt(step.stepId, result.disposition, {
      authorityDigest: result.authorityDigest,
      projectionSetDigest: result.projectionSetDigest,
      observationDigest: result.observationDigest,
    });
  } catch (error: unknown) {
    if (error instanceof WakeflowFreshWindowRuntimePublicationError) {
      if (error.reason === "strict-absent") {
        fail("strict-absent", "$windowRuntime");
      }
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "root-scope") fail("root-scope", "$root");
      fail("owner", "$windowRuntime");
    }
    throw error;
  }
}

async function executeHostCapabilityLayout(
  root: RootedDirectory,
  step: Readonly<WakeflowStaticMaterializationStep>,
  request: ReturnType<typeof parseWakeflowStaticMaterializationPreviewRequest>,
  recovering: boolean,
  signal: AbortSignal | undefined,
) {
  if (
    request.action !== "fresh-initialize"
    || step.targetKey !== request.currentHostProfile.hostId
  ) {
    fail("plan", "$hostCapabilityLayout");
  }
  const authority = compileWakeflowHostCapabilityLayoutAuthority(
    request.currentHostProfile,
  );
  assertStepTarget(step, authority.authorityDigest);
  try {
    const result = await materializeWakeflowHostCapabilityLayout(
      root,
      request.currentHostProfile,
      {
        recoveringFreshLayout: recovering,
        ...(signal === undefined ? {} : { signal }),
      },
    );
    return receipt(step.stepId, result.disposition, {
      authorityDigest: result.authorityDigest,
      createdDirectoryCount: result.createdDirectoryCount,
      observationDigest: result.observationDigest,
    });
  } catch (error: unknown) {
    if (error instanceof WakeflowHostCapabilityLayoutMaterializationError) {
      if (error.reason === "strict-absent") {
        fail("strict-absent", "$hostCapabilityLayout");
      }
      if (error.reason === "aborted") fail("aborted", "$signal");
      if (error.reason === "root-scope") fail("root-scope", "$root");
      fail("owner", "$hostCapabilityLayout");
    }
    throw error;
  }
}

async function executeSupportRoot(
  root: RootedDirectory,
  step: Readonly<WakeflowStaticMaterializationStep>,
  request: ReturnType<typeof parseWakeflowStaticMaterializationPreviewRequest>,
  desired: WakeflowConfigV3Model,
  recovering: boolean,
  signal: AbortSignal | undefined,
) {
  const catalog = createWakeflowManagedSupportResourceCatalog(
    desired,
    request.currentHostProfile,
  );
  const declaration = catalog.declarations.find((entry) => (
    entry.declarationId === `support.${step.targetKey}.root`
  ));
  if (declaration === undefined) fail("plan", "$step.targetKey");
  assertStepTarget(step, authorityDigest(declaration));
  try {
    const result = await materializeWakeflowManagedSupportRoot(root, {
      config: desired,
      expectedConfigDigest: computeWakeflowConfigV3Digest(desired),
      profile: request.currentHostProfile,
      expectedCatalogDigest: catalog.catalogDigest,
      surfaceId: step.targetKey,
      ...(signal === undefined ? {} : { signal }),
    });
    if (result.disposition === "existing" && !recovering) {
      fail("strict-absent", "$supportRoot");
    }
    return receipt(
      step.stepId,
      result.disposition === "created" ? "created" : "current",
      {
        surfaceId: result.surfaceId,
        inodeId: result.node.inodeId.toString(),
        mode: result.node.permissionBits,
      },
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowStaticMaterializationStepExecutionError) {
      throw error;
    }
    if (error instanceof WakeflowManagedSupportRootMaterializationError) {
      fail("owner", "$supportRoot");
    }
    throw error;
  }
}

async function executeGitignore(
  root: RootedDirectory,
  step: Readonly<WakeflowStaticMaterializationStep>,
  request: ReturnType<typeof parseWakeflowStaticMaterializationPreviewRequest>,
  signal: AbortSignal | undefined,
) {
  const authority = createWakeflowGitignoreBodyAuthority(request.hostProfiles);
  assertStepTarget(step, authority.authorityDigest);
  const matrix = createWakeflowWorkspaceStaticResourceMatrix(
    request.currentHostProfile,
  );
  try {
    const result = await recomposeWakeflowWorkspaceGitignore(
      root,
      {
        matrix,
        expectedMatrixDigest: matrix.matrixDigest,
        hostProfiles: request.hostProfiles,
      },
      signal === undefined ? undefined : { signal },
    );
    return receipt(
      step.stepId,
      result.disposition === "current" ? "current" : "updated",
      {
        authorityDigest: result.inspection.authority.authorityDigest,
        sourceDigest: result.inspection.source?.digest ?? null,
      },
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowGitignoreRecompositionError) {
      fail(error.reason === "aborted" ? "aborted" : "owner", "$gitignore");
    }
    throw error;
  }
}

async function executeProgramInstruction(
  root: RootedDirectory,
  step: Readonly<WakeflowStaticMaterializationStep>,
  request: ReturnType<typeof parseWakeflowStaticMaterializationPreviewRequest>,
  sourceConfig: WakeflowConfigV3Model | null,
  desired: WakeflowConfigV3Model,
  signal: AbortSignal | undefined,
) {
  const authority = createWakeflowProgramInstructionBodyAuthority(
    desired,
    request.currentHostProfile,
  );
  assertStepTarget(step, authority.authorityDigest);
  const matrix = createWakeflowWorkspaceStaticResourceMatrix(
    request.currentHostProfile,
  );
  try {
    const result = await recomposeWakeflowProgramInstruction(
      root,
      {
        matrix,
        expectedMatrixDigest: matrix.matrixDigest,
        profile: request.currentHostProfile,
        currentConfig: sourceConfig,
        expectedCurrentConfigDigest: sourceConfig === null
          ? null
          : computeWakeflowConfigV3Digest(sourceConfig),
        desiredConfig: desired,
        expectedDesiredConfigDigest: computeWakeflowConfigV3Digest(desired),
      },
      signal === undefined ? undefined : { signal },
    );
    return receipt(
      step.stepId,
      result.disposition === "current" ? "current" : "updated",
      {
        authorityDigest: result.inspection.desiredAuthority.authorityDigest,
        sourceDigest: result.inspection.source?.digest ?? null,
      },
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowProgramInstructionRecompositionError) {
      fail(error.reason === "aborted" ? "aborted" : "owner", "$program");
    }
    throw error;
  }
}

async function executeSupportMemory(
  root: RootedDirectory,
  step: Readonly<WakeflowStaticMaterializationStep>,
  request: ReturnType<typeof parseWakeflowStaticMaterializationPreviewRequest>,
  sourceConfig: WakeflowConfigV3Model | null,
  desired: WakeflowConfigV3Model,
  signal: AbortSignal | undefined,
) {
  const separator = step.targetKey.lastIndexOf(":");
  if (separator <= 0) fail("plan", "$step.targetKey");
  const surfaceId = step.targetKey.slice(0, separator);
  if (step.targetKey.slice(separator + 1) !== request.currentHostProfile.hostId) {
    fail("plan", "$step.targetKey");
  }
  const authority = createWakeflowSupportMemoryAuthority(
    desired,
    request.currentHostProfile,
    surfaceId,
  );
  assertStepTarget(step, authority.authorityDigest);
  let placements;
  try {
    placements = await validateWakeflowConfigRootPlacements(root, desired);
  } catch (error: unknown) {
    if (error instanceof WakeflowConfigRootPlacementError) {
      fail("root-scope", "$supportRoot");
    }
    throw error;
  }
  const placement = placements.roots.find((entry) => (
    entry.key === `support.${surfaceId}.root`
  ));
  if (placement?.state !== "present") fail("root-scope", "$supportRoot");
  const supportRoot = await RootedDirectory.open(placement.absolutePath);
  try {
    const catalog = createWakeflowManagedSupportResourceCatalog(
      desired,
      request.currentHostProfile,
    );
    const result = await publishWakeflowSupportMemory(
      root,
      supportRoot,
      {
        currentConfig: sourceConfig,
        expectedCurrentConfigDigest: sourceConfig === null
          ? null
          : computeWakeflowConfigV3Digest(sourceConfig),
        desiredConfig: desired,
        expectedDesiredConfigDigest: computeWakeflowConfigV3Digest(desired),
        profile: request.currentHostProfile,
        expectedCatalogDigest: catalog.catalogDigest,
        surfaceId,
      },
      signal === undefined ? undefined : { signal },
    );
    return receipt(
      step.stepId,
      result.disposition === "current" ? "current" : "updated",
      {
        authorityDigest: result.inspection.desiredAuthority.authorityDigest,
        sourceDigest: result.inspection.source?.digest ?? null,
      },
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowSupportMemoryPublicationError) {
      fail(error.reason === "aborted" ? "aborted" : "owner", "$supportMemory");
    }
    throw error;
  } finally {
    await supportRoot.close();
  }
}

async function executeConfig(
  root: RootedDirectory,
  step: Readonly<WakeflowStaticMaterializationStep>,
  preview: ReturnType<typeof parseWakeflowStaticMaterializationPreview>,
  desired: WakeflowConfigV3Model,
  signal: AbortSignal | undefined,
) {
  const desiredDigest = computeWakeflowConfigV3Digest(desired);
  assertStepTarget(step, desiredDigest);
  const current = await optionalConfigSnapshot(root);
  if (current?.configDigest === desiredDigest) {
    return receipt(step.stepId, "current", {
      configDigest: current.configDigest,
      sourceDigest: current.source.digest,
    });
  }
  try {
    if (preview.currentConfigDigest === null) {
      if (current !== null) fail("source-config", "$config");
      const result = await publishWakeflowConfigAuthority(
        root,
        desired,
        signal === undefined ? undefined : { signal },
      );
      return receipt(step.stepId, "created", {
        configDigest: result.authority.configDigest,
        sourceDigest: result.authority.source.digest,
      });
    }
    if (current === null || current.configDigest !== preview.currentConfigDigest) {
      fail("source-config", "$config");
    }
    const result = await replaceWakeflowConfigAuthority(
      root,
      desired,
      current,
      signal === undefined ? undefined : { signal },
    );
    return receipt(
      step.stepId,
      result.disposition === "current" ? "current" : "updated",
      {
        configDigest: result.authority.configDigest,
        sourceDigest: result.authority.source.digest,
      },
    );
  } catch (error: unknown) {
    if (error instanceof WakeflowStaticMaterializationStepExecutionError) {
      throw error;
    }
    if (
      error instanceof WakeflowConfigAuthorityPublicationError
      || error instanceof WakeflowConfigAuthorityReplacementError
    ) {
      fail("owner", "$config");
    }
    throw error;
  }
}

/** 在 active maintenance gate 内执行计划中的一个 exact step。 */
export async function executeWakeflowStaticMaterializationStep(
  root: RootedDirectory,
  gateContext: Readonly<WakeflowMaintenanceGateContext>,
  previewValue: unknown,
  requestValue: WakeflowStaticMaterializationPreviewRequest,
  stepIdValue: unknown,
  options: WakeflowStaticMaterializationStepExecutionOptions,
): Promise<Readonly<WakeflowStaticMaterializationStepExecutionReceipt>> {
  try {
    assertWakeflowMaintenanceGateContext(gateContext, root);
  } catch {
    fail("gate", "$gateContext");
  }
  const preview = parseWakeflowStaticMaterializationPreview(previewValue);
  const request = parseWakeflowStaticMaterializationPreviewRequest(requestValue);
  if (typeof stepIdValue !== "string") fail("input", "$stepId");
  const step = preview.steps.find((entry) => entry.stepId === stepIdValue);
  if (step === undefined) fail("plan", "$stepId");
  let optionRecord: Readonly<Record<string, unknown>>;
  try {
    optionRecord = parsePlainRecord(options, "$options");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$options");
    throw error;
  }
  if (
    !Object.hasOwn(optionRecord, "recoveringAffectedStep")
    || !Object.hasOwn(optionRecord, "sourceConfig")
    || Object.keys(optionRecord).some((key) => (
      key !== "recoveringAffectedStep"
      && key !== "signal"
      && key !== "sourceConfig"
    ))
    || typeof optionRecord.recoveringAffectedStep !== "boolean"
    || (
      optionRecord.signal !== undefined
      && (
        typeof optionRecord.signal !== "object"
        || optionRecord.signal === null
        || types.isProxy(optionRecord.signal)
        || !(optionRecord.signal instanceof AbortSignal)
      )
    )
  ) {
    fail("input", "$options");
  }
  let sourceConfig: WakeflowConfigV3Model | null;
  if (optionRecord.sourceConfig === null) {
    sourceConfig = null;
  } else {
    try {
      sourceConfig = parseWakeflowConfigV3(optionRecord.sourceConfig);
    } catch (error: unknown) {
      if (error instanceof WakeflowConfigV3Error) {
        fail("source-config", "$options.sourceConfig");
      }
      throw error;
    }
  }
  const signal = optionRecord.signal as AbortSignal | undefined;
  const recovering = optionRecord.recoveringAffectedStep;
  if (signal?.aborted === true) fail("aborted", "$signal");
  const matrix = createWakeflowWorkspaceStaticResourceMatrix(
    request.currentHostProfile,
  );
  if (
    preview.action !== request.action
    || preview.matrixDigest !== matrix.matrixDigest
  ) {
    fail("plan", "$preview");
  }
  const desired = desiredConfig(request, sourceConfig);
  if (preview.desiredConfigDigest !== computeWakeflowConfigV3Digest(desired)) {
    fail("plan", "$preview.desiredConfigDigest");
  }
  const sourceDigest = sourceConfig === null
    ? null
    : computeWakeflowConfigV3Digest(sourceConfig);
  if (
    step.kind !== "publish-config"
    && sourceDigest !== preview.currentConfigDigest
  ) {
    fail("source-config", "$options.sourceConfig");
  }

  if (step.kind === "materialize-local-protocol") {
    return executeLocalProtocol(root, step, signal);
  }
  if (step.kind === "materialize-active-layout") {
    return executeActiveLayout(root, step, recovering, signal);
  }
  if (step.kind === "initialize-todo-collection") {
    return executeTodoCollectionInitialization(
      root,
      step,
      request,
      recovering,
      signal,
    );
  }
  if (step.kind === "publish-fresh-active-workspace-projection") {
    return executeActiveWorkspaceProjection(
      root,
      step,
      desired,
      recovering,
      signal,
    );
  }
  if (step.kind === "materialize-ledger-layout") {
    return executeLedgerLayout(
      root,
      step,
      request,
      desired,
      recovering,
      signal,
    );
  }
  if (step.kind === "publish-unregistered-window-runtime") {
    return executeUnregisteredWindowRuntime(
      root,
      step,
      request,
      desired,
      recovering,
      signal,
    );
  }
  if (step.kind === "materialize-host-capability-layout") {
    return executeHostCapabilityLayout(
      root,
      step,
      request,
      recovering,
      signal,
    );
  }
  if (step.kind === "materialize-support-root") {
    return executeSupportRoot(
      root,
      step,
      request,
      desired,
      recovering,
      signal,
    );
  }
  if (step.kind === "recompose-gitignore") {
    return executeGitignore(root, step, request, signal);
  }
  if (step.kind === "recompose-program-instruction") {
    return executeProgramInstruction(
      root,
      step,
      request,
      sourceConfig,
      desired,
      signal,
    );
  }
  if (step.kind === "publish-support-memory") {
    return executeSupportMemory(
      root,
      step,
      request,
      sourceConfig,
      desired,
      signal,
    );
  }
  return executeConfig(root, step, preview, desired, signal);
}
