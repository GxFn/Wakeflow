import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";

import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import {
  admitWakeflowResourceOperation,
  WakeflowResourceProcessingContractError,
} from "../../../src/foundation/resource/resource-processing-contract.js";
import { demandFinalRootRef } from "../../../src/governance/demand/publication/demand-publication-paths.js";
import {
  createManagedEvidenceResourceCatalog,
  MANAGED_EVIDENCE_RESOURCE_OWNER_ID,
} from "../../../src/governance/evidence/managed-evidence-resource-catalog.js";
import {
  managedEvidenceManifestRef,
  managedEvidencePayloadRootRef,
  managedEvidencePublicationStageRef,
  managedEvidenceRecordAddress,
  managedEvidenceRecordRootRef,
  MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_REF,
  MANAGED_EVIDENCE_ROOT_REF,
  parseManagedEvidenceRecordDirectoryName,
  parseManagedEvidenceStageDirectoryName,
  ManagedEvidenceResourcePathError,
  type ManagedEvidenceResourcePathErrorReason,
} from "../../../src/governance/evidence/managed-evidence-resource-paths.js";

const DEMAND_ID = parseWakeflowDurableIdOfKind(
  "demand_11111111-1111-4111-8111-111111111111",
  "demand",
);
const EVIDENCE_ID = parseWakeflowDurableIdOfKind(
  "evidence_22222222-2222-4222-8222-222222222222",
  "evidence",
);
const ANOTHER_EVIDENCE_ID = parseWakeflowDurableIdOfKind(
  "evidence_33333333-3333-4333-8333-333333333333",
  "evidence",
);

function expectPathError(
  action: () => unknown,
  reason: ManagedEvidenceResourcePathErrorReason,
): void {
  throws(
    action,
    (error: unknown) =>
      error instanceof ManagedEvidenceResourcePathError &&
      error.reason === reason,
  );
}

function assertDeepFrozen(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

test("Managed Evidence路径把final、payload、stage与Demand级journal明确分离", () => {
  const address = managedEvidenceRecordAddress(EVIDENCE_ID);
  deepEqual(address, {
    evidenceId: EVIDENCE_ID,
    directoryName: EVIDENCE_ID,
    recordRootRef: `artifacts/managed-evidence/${EVIDENCE_ID}`,
    manifestRef: `artifacts/managed-evidence/${EVIDENCE_ID}/manifest.json`,
    payloadRootRef: `artifacts/managed-evidence/${EVIDENCE_ID}/payload`,
  });
  equal(MANAGED_EVIDENCE_ROOT_REF, "artifacts/managed-evidence");
  equal(managedEvidenceRecordRootRef(EVIDENCE_ID), address.recordRootRef);
  equal(managedEvidenceManifestRef(EVIDENCE_ID), address.manifestRef);
  equal(managedEvidencePayloadRootRef(EVIDENCE_ID), address.payloadRootRef);
  equal(
    managedEvidencePublicationStageRef(EVIDENCE_ID),
    `artifacts/managed-evidence/.${EVIDENCE_ID}.wakeflow-stage`,
  );
  equal(
    MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_REF,
    "transactions/managed-evidence-publication.json",
  );
  deepEqual(parseManagedEvidenceRecordDirectoryName(EVIDENCE_ID), address);
  deepEqual(
    parseManagedEvidenceStageDirectoryName(`.${EVIDENCE_ID}.wakeflow-stage`),
    {
      evidenceId: EVIDENCE_ID,
      directoryName: `.${EVIDENCE_ID}.wakeflow-stage`,
      stageRootRef: managedEvidencePublicationStageRef(EVIDENCE_ID),
    },
  );
  assertDeepFrozen(address);
});

test("Managed Evidence路径拒绝别名、其他ID类型和宽松stage后缀", () => {
  expectPathError(
    () => managedEvidenceRecordAddress("evidence-not-a-uuid"),
    "identifier",
  );
  for (const value of [
    `${EVIDENCE_ID}.json`,
    `.${EVIDENCE_ID}.wakeflow-stage`,
    DEMAND_ID,
    EVIDENCE_ID.toUpperCase(),
  ]) {
    expectPathError(
      () => parseManagedEvidenceRecordDirectoryName(value),
      "record-directory-name",
    );
  }
  for (const value of [
    EVIDENCE_ID,
    `.${EVIDENCE_ID}.stage`,
    `${EVIDENCE_ID}.wakeflow-stage`,
    `.${DEMAND_ID}.wakeflow-stage`,
  ]) {
    expectPathError(
      () => parseManagedEvidenceStageDirectoryName(value),
      "stage-directory-name",
    );
  }
});

test("Managed Evidence资源目录区分容器、Manifest闭合final tree与事务journal", () => {
  const demandRoot = demandFinalRootRef(DEMAND_ID);
  const catalog = createManagedEvidenceResourceCatalog(DEMAND_ID, EVIDENCE_ID);
  deepEqual(
    catalog.map((entry) => ({
      declarationId: entry.declarationId,
      ownerId: entry.ownerId,
      relativePath: entry.placement.relativePath,
      nodePolicy: entry.nodePolicy,
      processing: entry.processing,
    })),
    [
      {
        declarationId: `demand.managed-evidence.${DEMAND_ID}.root`,
        ownerId: MANAGED_EVIDENCE_RESOURCE_OWNER_ID,
        relativePath: `${demandRoot}/${MANAGED_EVIDENCE_ROOT_REF}`,
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
      },
      {
        declarationId: `demand.managed-evidence.${DEMAND_ID}.record.${EVIDENCE_ID}`,
        ownerId: MANAGED_EVIDENCE_RESOURCE_OWNER_ID,
        relativePath: `${demandRoot}/${managedEvidenceRecordRootRef(EVIDENCE_ID)}`,
        nodePolicy: {
          kind: "tree",
          rootMode: "0700",
          symlinkPolicy: "reject",
          executablePolicy: "manifest-declared",
        },
        processing: {
          kind: "resource",
          role: "manifested-tree",
          allowedMutationRecipes: ["tree-publish-or-move"],
          recoveryStrategy: "manifest-closure",
        },
      },
      {
        declarationId: `demand.managed-evidence.${DEMAND_ID}.transaction`,
        ownerId: MANAGED_EVIDENCE_RESOURCE_OWNER_ID,
        relativePath: `${demandRoot}/${MANAGED_EVIDENCE_PUBLICATION_TRANSACTION_REF}`,
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
      },
    ],
  );
  equal(
    catalog.every(
      (entry) =>
        entry.family === "demand" &&
        entry.scope === "host-neutral" &&
        entry.tracking.disposition === "ignored" &&
        entry.tracking.privacy === "runtime-private",
    ),
    true,
  );
  equal(
    catalog.some(
      (entry) =>
        entry.placement.relativePath?.includes(".wakeflow-stage") === true,
    ),
    false,
  );
  assertDeepFrozen(catalog);

  deepEqual(
    admitWakeflowResourceOperation(
      catalog[0].processing,
      "materialize-directory",
    ),
    { kind: "directory-materialization", recipe: "materialize-directory" },
  );
  deepEqual(
    admitWakeflowResourceOperation(
      catalog[1].processing,
      "tree-publish-or-move",
    ),
    {
      kind: "resource-mutation",
      role: "manifested-tree",
      recipe: "tree-publish-or-move",
    },
  );
  deepEqual(
    admitWakeflowResourceOperation(catalog[2].processing, "exclusive-create"),
    {
      kind: "resource-mutation",
      role: "transaction-artifact",
      recipe: "exclusive-create",
    },
  );
  deepEqual(
    admitWakeflowResourceOperation(catalog[2].processing, "exact-retire"),
    {
      kind: "resource-mutation",
      role: "transaction-artifact",
      recipe: "exact-retire",
    },
  );
  throws(
    () => admitWakeflowResourceOperation(catalog[1].processing, "exact-retire"),
    WakeflowResourceProcessingContractError,
  );
});

test("不同Evidence拥有不同final/stage，但共享一个Demand事务槽位", () => {
  const first = createManagedEvidenceResourceCatalog(DEMAND_ID, EVIDENCE_ID);
  const second = createManagedEvidenceResourceCatalog(
    DEMAND_ID,
    ANOTHER_EVIDENCE_ID,
  );
  equal(first[0].placement.relativePath, second[0].placement.relativePath);
  equal(first[2].declarationId, second[2].declarationId);
  equal(first[2].placement.relativePath, second[2].placement.relativePath);
  equal(
    first[1].placement.relativePath === second[1].placement.relativePath,
    false,
  );
  equal(
    managedEvidencePublicationStageRef(EVIDENCE_ID) ===
      managedEvidencePublicationStageRef(ANOTHER_EVIDENCE_ID),
    false,
  );
});
