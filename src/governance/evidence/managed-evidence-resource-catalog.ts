import {
  parseWakeflowDurableIdOfKind,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import {
  parseWakeflowWorkspaceResourceDeclaration,
  type WakeflowWorkspaceResourceDeclaration,
} from "../../workspace/workspace-resource-declaration.js";
import { demandFinalRootRef } from "../demand/publication/demand-publication-paths.js";
import {
  managedEvidenceRecordRootRef,
  MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_REF,
  MANAGED_EVIDENCE_ROOT_REF,
} from "./managed-evidence-resource-paths.js";

/**
 * Wakeflow Governance / Evidence：Managed Evidence资源的领域所有权声明。
 *
 * 容器只管理目录结构；一份最终Evidence记录是由Manifest闭合的不可变私有树；
 * Demand级publication journal是唯一允许创建和精确退休的事务资源。未发布stage
 * 只属于一次具体journal，不作为长期资源实例登记。
 */

export const MANAGED_EVIDENCE_RESOURCE_OWNER_ID =
  "demand-managed-evidence" as const;

type ManagedEvidenceResourceCatalog = readonly [
  Readonly<WakeflowWorkspaceResourceDeclaration>,
  Readonly<WakeflowWorkspaceResourceDeclaration>,
  Readonly<WakeflowWorkspaceResourceDeclaration>,
];

function demandId(value: unknown): WakeflowDurableId<"demand"> {
  return parseWakeflowDurableIdOfKind(value, "demand", "$demandId");
}

function evidenceId(value: unknown): WakeflowDurableId<"evidence"> {
  return parseWakeflowDurableIdOfKind(value, "evidence", "$evidenceId");
}

function demandChildRef(
  demand: WakeflowDurableId<"demand">,
  localRef: PortableResourcePath,
): PortableResourcePath {
  return parsePortableResourcePath(`${demandFinalRootRef(demand)}/${localRef}`);
}

function commonDeclaration(
  declarationId: string,
  relativePath: PortableResourcePath,
  nodePolicy: unknown,
  processing: unknown,
): Readonly<WakeflowWorkspaceResourceDeclaration> {
  return parseWakeflowWorkspaceResourceDeclaration({
    kind: "WakeflowWorkspaceResourceDeclaration",
    declarationId,
    family: "demand",
    ownerId: MANAGED_EVIDENCE_RESOURCE_OWNER_ID,
    scope: "host-neutral",
    placement: {
      root: { kind: "workspace" },
      relativePath,
    },
    tracking: {
      disposition: "ignored",
      privacy: "runtime-private",
    },
    nodePolicy,
    processing,
  });
}

/** 一份Demand可选Managed Evidence容器的目录声明。 */
export function createManagedEvidenceRootResourceDeclaration(
  demandValue: unknown,
): Readonly<WakeflowWorkspaceResourceDeclaration> {
  const demand = demandId(demandValue);
  return commonDeclaration(
    `demand.managed-evidence.${demand}.root`,
    demandChildRef(demand, MANAGED_EVIDENCE_ROOT_REF),
    {
      kind: "directory",
      mode: "0700",
      symlinkPolicy: "reject",
      existingModePolicy: "observe-without-change",
    },
    {
      kind: "directory-container",
      materializationRecipe: "materialize-directory",
      existingDirectoryPolicy: "observe-without-mode-change",
      collisionPolicy: "reject-non-directory",
      descendantAuthority: "separate-declaration-required",
      recoveryStrategy: "report-only",
    },
  );
}

/** 一份完整Managed Evidence final record的Manifest闭合树声明。 */
export function createManagedEvidenceRecordResourceDeclaration(
  demandValue: unknown,
  evidenceValue: unknown,
): Readonly<WakeflowWorkspaceResourceDeclaration> {
  const demand = demandId(demandValue);
  const evidence = evidenceId(evidenceValue);
  return commonDeclaration(
    `demand.managed-evidence.${demand}.record.${evidence}`,
    demandChildRef(demand, managedEvidenceRecordRootRef(evidence)),
    {
      kind: "tree",
      rootMode: "0700",
      symlinkPolicy: "reject",
      executablePolicy: "manifest-declared",
    },
    {
      kind: "resource",
      role: "manifested-tree",
      allowedMutationRecipes: ["tree-publish-or-move"],
      recoveryStrategy: "manifest-closure",
    },
  );
}

/** 同一Demand一次只允许一份Managed Evidence publication journal。 */
export function createManagedEvidencePublicationTransactionResourceDeclaration(
  demandValue: unknown,
): Readonly<WakeflowWorkspaceResourceDeclaration> {
  const demand = demandId(demandValue);
  return commonDeclaration(
    `demand.managed-evidence.${demand}.transaction`,
    demandChildRef(demand, MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_REF),
    {
      kind: "file",
      mode: "0600",
      linkPolicy: "single-link",
      executablePolicy: "forbidden",
    },
    {
      kind: "resource",
      role: "transaction-artifact",
      allowedMutationRecipes: ["exclusive-create", "exact-retire"],
      recoveryStrategy: "owner-transaction-recovery",
    },
  );
}

/** 组合一次Evidence事务需要的容器、final tree与journal声明。 */
export function createManagedEvidenceResourceCatalog(
  demandValue: unknown,
  evidenceValue: unknown,
): ManagedEvidenceResourceCatalog {
  const demand = demandId(demandValue);
  const evidence = evidenceId(evidenceValue);
  return Object.freeze([
    createManagedEvidenceRootResourceDeclaration(demand),
    createManagedEvidenceRecordResourceDeclaration(demand, evidence),
    createManagedEvidencePublicationTransactionResourceDeclaration(demand),
  ]);
}
