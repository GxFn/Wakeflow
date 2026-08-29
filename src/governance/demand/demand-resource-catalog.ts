import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import {
  parseWakeflowDurableIdOfKind,
  type WakeflowDurableId,
} from "../../foundation/identity/wakeflow-durable-id.js";
import {
  parseWakeflowWorkspaceResourceDeclaration,
  type WakeflowWorkspaceResourceDeclaration,
} from "../../workspace/workspace-resource-declaration.js";
import {
  parseDemandEventCommitSequence,
  type DemandEventCommitSequence,
} from "./event-sourcing/demand-event-sourcing-aggregate.js";
import {
  demandEventSourcingSnapshotRef,
  demandEventStreamCommitRef,
  DEMAND_EVENT_APPEND_CANDIDATES_ROOT_REF,
  DEMAND_EVENT_SOURCING_ARTIFACTS_ROOT_REF,
  DEMAND_EVENT_SOURCING_AUTHORITY_REF,
  DEMAND_EVENT_SOURCING_IDENTITY_REF,
  DEMAND_EVENT_SOURCING_ROOT_REF,
  DEMAND_EVENT_SOURCING_SNAPSHOTS_ROOT_REF,
  DEMAND_EVENT_SOURCING_TRANSACTIONS_ROOT_REF,
  DEMAND_EVENT_STREAM_COMMITS_ROOT_REF,
} from "./event-sourcing/demand-event-sourcing-paths.js";
import {
  demandFinalPublicationMarkerRef,
  demandFinalRootRef,
  DEMAND_PUBLICATION_LOCKS_ROOT_REF,
  DEMAND_PUBLICATION_ROOT_REF,
  DEMAND_PUBLICATION_STAGES_ROOT_REF,
  DEMAND_PUBLICATION_TRANSACTIONS_ROOT_REF,
  demandPublicationLockRef,
  demandPublicationTransactionRef,
} from "./publication/demand-publication-paths.js";

/**
 * Wakeflow Governance / Demand：Demand Event Sourcing 职责所有者的资源目录。
 *
 * 静态目录只登记 Workspace 级发布流程长期使用的目录。具体 Demand、提交和检查点由
 * 类型化工厂生成；操作期暂存文件和观察到的文件系统清单不在本模块中注册。
 */

const DEMAND_PUBLICATION_OWNER_ID = "demand-publication" as const;
const DEMAND_EVENT_SOURCING_OWNER_ID = "demand-event-sourcing" as const;

function privateDirectoryDeclaration(
  declarationId: string,
  ownerId: string,
  relativePath: PortableResourcePath,
): Readonly<WakeflowWorkspaceResourceDeclaration> {
  return parseWakeflowWorkspaceResourceDeclaration({
    kind: "WakeflowWorkspaceResourceDeclaration",
    declarationId,
    family: "demand",
    ownerId,
    scope: "host-neutral",
    placement: {
      root: { kind: "workspace" },
      relativePath,
    },
    tracking: {
      disposition: "ignored",
      privacy: "runtime-private",
    },
    nodePolicy: {
      kind: "directory",
      mode: "0700",
      symlinkPolicy: "reject",
      existingModePolicy: "observe-without-change",
    },
    processing: {
      kind: "directory-container",
      materializationRecipe: "materialize-directory",
      existingDirectoryPolicy: "observe-without-mode-change",
      collisionPolicy: "reject-non-directory",
      descendantAuthority: "separate-declaration-required",
      recoveryStrategy: "report-only",
    },
  });
}

function privateFileDeclaration(
  declarationId: string,
  ownerId: string,
  relativePath: PortableResourcePath,
  processing: unknown,
): Readonly<WakeflowWorkspaceResourceDeclaration> {
  return parseWakeflowWorkspaceResourceDeclaration({
    kind: "WakeflowWorkspaceResourceDeclaration",
    declarationId,
    family: "demand",
    ownerId,
    scope: "host-neutral",
    placement: {
      root: { kind: "workspace" },
      relativePath,
    },
    tracking: {
      disposition: "ignored",
      privacy: "runtime-private",
    },
    nodePolicy: {
      kind: "file",
      mode: "0600",
      linkPolicy: "single-link",
      executablePolicy: "forbidden",
    },
    processing,
  });
}

function parseDemandId(value: unknown): WakeflowDurableId<"demand"> {
  return parseWakeflowDurableIdOfKind(value, "demand", "$demandId");
}

function demandChildRef(
  demandId: WakeflowDurableId<"demand">,
  localRef: PortableResourcePath,
): PortableResourcePath {
  return parsePortableResourcePath(
    `${demandFinalRootRef(demandId)}/${localRef}`,
  );
}

function exactAggregateRootDeclaration(
  declarationId: string,
  relativePath: PortableResourcePath,
): Readonly<WakeflowWorkspaceResourceDeclaration> {
  return parseWakeflowWorkspaceResourceDeclaration({
    kind: "WakeflowWorkspaceResourceDeclaration",
    declarationId,
    family: "demand",
    ownerId: DEMAND_EVENT_SOURCING_OWNER_ID,
    scope: "host-neutral",
    placement: {
      root: { kind: "workspace" },
      relativePath,
    },
    tracking: {
      disposition: "ignored",
      privacy: "runtime-private",
    },
    nodePolicy: {
      kind: "directory",
      mode: "0700",
      symlinkPolicy: "reject",
      existingModePolicy: "observe-without-change",
    },
    processing: {
      kind: "directory-container",
      materializationRecipe: "exact-directory-publish",
      existingDirectoryPolicy: "owner-validate-existing-target",
      collisionPolicy: "reject-unowned-target",
      descendantAuthority: "separate-declaration-required",
      recoveryStrategy: "owner-forward-recovery",
    },
  });
}

export const DEMAND_PUBLICATION_ROOT_RESOURCE_DECLARATION =
  privateDirectoryDeclaration(
    "demand.publication.root",
    DEMAND_PUBLICATION_OWNER_ID,
    DEMAND_PUBLICATION_ROOT_REF,
  );

export const DEMAND_PUBLICATION_STAGES_ROOT_RESOURCE_DECLARATION =
  privateDirectoryDeclaration(
    "demand.publication.stages-root",
    DEMAND_PUBLICATION_OWNER_ID,
    DEMAND_PUBLICATION_STAGES_ROOT_REF,
  );

export const DEMAND_PUBLICATION_TRANSACTIONS_ROOT_RESOURCE_DECLARATION =
  privateDirectoryDeclaration(
    "demand.publication.transactions-root",
    DEMAND_PUBLICATION_OWNER_ID,
    DEMAND_PUBLICATION_TRANSACTIONS_ROOT_REF,
  );

export const DEMAND_PUBLICATION_LOCKS_ROOT_RESOURCE_DECLARATION =
  privateDirectoryDeclaration(
    "demand.publication.locks-root",
    DEMAND_PUBLICATION_OWNER_ID,
    DEMAND_PUBLICATION_LOCKS_ROOT_REF,
  );

/** Demand 发布职责所有者的确定性静态资源目录。 */
export const WAKEFLOW_DEMAND_STATIC_RESOURCE_CATALOG = Object.freeze([
  DEMAND_PUBLICATION_ROOT_RESOURCE_DECLARATION,
  DEMAND_PUBLICATION_STAGES_ROOT_RESOURCE_DECLARATION,
  DEMAND_PUBLICATION_TRANSACTIONS_ROOT_RESOURCE_DECLARATION,
  DEMAND_PUBLICATION_LOCKS_ROOT_RESOURCE_DECLARATION,
]) satisfies readonly Readonly<WakeflowWorkspaceResourceDeclaration>[];

export type DemandEventSourcingResourceCatalog = readonly [
  Readonly<WakeflowWorkspaceResourceDeclaration>,
  Readonly<WakeflowWorkspaceResourceDeclaration>,
  Readonly<WakeflowWorkspaceResourceDeclaration>,
  Readonly<WakeflowWorkspaceResourceDeclaration>,
  Readonly<WakeflowWorkspaceResourceDeclaration>,
  Readonly<WakeflowWorkspaceResourceDeclaration>,
  Readonly<WakeflowWorkspaceResourceDeclaration>,
  Readonly<WakeflowWorkspaceResourceDeclaration>,
  Readonly<WakeflowWorkspaceResourceDeclaration>,
  Readonly<WakeflowWorkspaceResourceDeclaration>,
  Readonly<WakeflowWorkspaceResourceDeclaration>,
  Readonly<WakeflowWorkspaceResourceDeclaration>,
];

/**
 * 为一个已验证的 Demand ID 生成最终 Event Sourcing Aggregate 及其稳定发布协调资源。
 *
 * `stages/<demandId>`、append candidate 文件和 Foundation 原子暂存文件只属于具体操作，
 * 不会作为长期资源实例加入返回目录。
 */
export function createDemandEventSourcingResourceCatalog(
  value: unknown,
): DemandEventSourcingResourceCatalog {
  const demandId = parseDemandId(value);
  const prefix = `demand.event-sourcing.${demandId}`;
  const rootRef = demandFinalRootRef(demandId);
  const immutableFactProcessing = {
    kind: "resource",
    role: "immutable-fact",
    allowedMutationRecipes: ["exclusive-create"],
    recoveryStrategy: "exact-idempotent-retry",
  } as const;
  const transactionProcessing = {
    kind: "resource",
    role: "transaction-artifact",
    allowedMutationRecipes: ["exclusive-create", "exact-retire"],
    recoveryStrategy: "owner-transaction-recovery",
  } as const;
  const publishedMarkerProcessing = {
    kind: "resource",
    role: "transaction-artifact",
    allowedMutationRecipes: ["exact-retire"],
    recoveryStrategy: "owner-transaction-recovery",
  } as const;

  return Object.freeze([
    exactAggregateRootDeclaration(`${prefix}.root`, rootRef),
    privateFileDeclaration(
      `${prefix}.identity`,
      DEMAND_EVENT_SOURCING_OWNER_ID,
      demandChildRef(demandId, DEMAND_EVENT_SOURCING_IDENTITY_REF),
      immutableFactProcessing,
    ),
    privateFileDeclaration(
      `${prefix}.authority`,
      DEMAND_EVENT_SOURCING_OWNER_ID,
      demandChildRef(demandId, DEMAND_EVENT_SOURCING_AUTHORITY_REF),
      immutableFactProcessing,
    ),
    privateDirectoryDeclaration(
      `${prefix}.event-sourcing-root`,
      DEMAND_EVENT_SOURCING_OWNER_ID,
      demandChildRef(demandId, DEMAND_EVENT_SOURCING_ROOT_REF),
    ),
    privateDirectoryDeclaration(
      `${prefix}.commits-root`,
      DEMAND_EVENT_SOURCING_OWNER_ID,
      demandChildRef(demandId, DEMAND_EVENT_STREAM_COMMITS_ROOT_REF),
    ),
    privateDirectoryDeclaration(
      `${prefix}.snapshots-root`,
      DEMAND_EVENT_SOURCING_OWNER_ID,
      demandChildRef(demandId, DEMAND_EVENT_SOURCING_SNAPSHOTS_ROOT_REF),
    ),
    privateDirectoryDeclaration(
      `${prefix}.append-candidates-root`,
      DEMAND_EVENT_SOURCING_OWNER_ID,
      demandChildRef(demandId, DEMAND_EVENT_APPEND_CANDIDATES_ROOT_REF),
    ),
    privateDirectoryDeclaration(
      `${prefix}.artifacts-root`,
      DEMAND_EVENT_SOURCING_OWNER_ID,
      demandChildRef(demandId, DEMAND_EVENT_SOURCING_ARTIFACTS_ROOT_REF),
    ),
    privateDirectoryDeclaration(
      `${prefix}.transactions-root`,
      DEMAND_EVENT_SOURCING_OWNER_ID,
      demandChildRef(demandId, DEMAND_EVENT_SOURCING_TRANSACTIONS_ROOT_REF),
    ),
    privateFileDeclaration(
      `${prefix}.publication-marker`,
      DEMAND_PUBLICATION_OWNER_ID,
      demandFinalPublicationMarkerRef(demandId),
      publishedMarkerProcessing,
    ),
    privateFileDeclaration(
      `${prefix}.publication-transaction`,
      DEMAND_PUBLICATION_OWNER_ID,
      demandPublicationTransactionRef(demandId),
      transactionProcessing,
    ),
    privateFileDeclaration(
      `${prefix}.publication-lock`,
      DEMAND_PUBLICATION_OWNER_ID,
      demandPublicationLockRef(demandId),
      transactionProcessing,
    ),
  ]);
}

/** 为一个物理事件流槽位生成不可变权威提交声明。 */
export function createDemandEventStreamCommitResourceDeclaration(
  demandValue: unknown,
  commitSequenceValue: unknown,
): Readonly<WakeflowWorkspaceResourceDeclaration> {
  const demandId = parseDemandId(demandValue);
  const commitSequence = parseDemandEventCommitSequence(
    commitSequenceValue,
    "$commitSequence",
  );
  return privateFileDeclaration(
    `demand.event-sourcing.${demandId}.commit-${commitSequence}`,
    DEMAND_EVENT_SOURCING_OWNER_ID,
    demandChildRef(demandId, demandEventStreamCommitRef(commitSequence)),
    {
      kind: "resource",
      role: "immutable-fact",
      allowedMutationRecipes: ["exclusive-create"],
      recoveryStrategy: "exact-idempotent-retry",
    },
  );
}

/**
 * 为一个锚定提交槽位生成可重建检查点声明。
 * Snapshot 与权威 Commit 共用序号词汇，但不会取得事件事实角色或覆写能力。
 */
export function createDemandEventSourcingSnapshotResourceDeclaration(
  demandValue: unknown,
  commitSequenceValue: unknown,
): Readonly<WakeflowWorkspaceResourceDeclaration> {
  const demandId = parseDemandId(demandValue);
  const commitSequence: DemandEventCommitSequence =
    parseDemandEventCommitSequence(commitSequenceValue, "$commitSequence");
  return privateFileDeclaration(
    `demand.event-sourcing.${demandId}.snapshot-${commitSequence}`,
    DEMAND_EVENT_SOURCING_OWNER_ID,
    demandChildRef(demandId, demandEventSourcingSnapshotRef(commitSequence)),
    {
      kind: "resource",
      role: "derived-checkpoint",
      allowedMutationRecipes: ["exclusive-create"],
      recoveryStrategy: "rebuild-from-authority",
    },
  );
}
