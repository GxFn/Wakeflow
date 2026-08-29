import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
} from "../../../src/foundation/identity/wakeflow-durable-id.js";
import {
  admitWakeflowResourceOperation,
  type WakeflowResourceProcessingContract,
  WakeflowResourceProcessingContractError,
} from "../../../src/foundation/resource/resource-processing-contract.js";
import type {
  WakeflowWorkspaceResourceNodePolicy,
} from "../../../src/workspace/workspace-resource-declaration.js";
import {
  parseDemandEventCommitSequence,
  DemandEventSourcingAggregateError,
} from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-aggregate.js";
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
} from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-paths.js";
import {
  demandFinalPublicationMarkerRef,
  demandFinalRootRef,
  DEMAND_PUBLICATION_LOCKS_ROOT_REF,
  DEMAND_PUBLICATION_ROOT_REF,
  DEMAND_PUBLICATION_STAGES_ROOT_REF,
  DEMAND_PUBLICATION_TRANSACTIONS_ROOT_REF,
  demandPublicationLockRef,
  demandPublicationStageRef,
  demandPublicationTransactionRef,
} from "../../../src/governance/demand/publication/demand-publication-paths.js";
import {
  createDemandEventSourcingSnapshotResourceDeclaration,
  createDemandEventSourcingResourceCatalog,
  createDemandEventStreamCommitResourceDeclaration,
  WAKEFLOW_DEMAND_STATIC_RESOURCE_CATALOG,
} from "../../../src/governance/demand/demand-resource-catalog.js";

const DEMAND_ID = parseWakeflowDurableIdOfKind(
  "demand_11111111-1111-4111-8111-111111111111",
  "demand",
);
const COMMIT_SEQUENCE = parseDemandEventCommitSequence(1);

function assertDeepFrozen(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

function modeOf(nodePolicy: Readonly<WakeflowWorkspaceResourceNodePolicy>): string {
  return nodePolicy.kind === "tree" ? nodePolicy.rootMode : nodePolicy.mode;
}

function processingOf(
  processing: Readonly<WakeflowResourceProcessingContract>,
): string {
  return processing.kind === "directory-container"
    ? `directory-container:${processing.materializationRecipe}`
    : `${processing.role}:${processing.allowedMutationRecipes.join("+")}`;
}

test("Demand static resource catalog closes only publication directories", () => {
  deepEqual(
    WAKEFLOW_DEMAND_STATIC_RESOURCE_CATALOG.map((entry) => ({
      declarationId: entry.declarationId,
      ownerId: entry.ownerId,
      relativePath: entry.placement.relativePath,
    })),
    [
      {
        declarationId: "demand.publication.root",
        ownerId: "demand-publication",
        relativePath: DEMAND_PUBLICATION_ROOT_REF,
      },
      {
        declarationId: "demand.publication.stages-root",
        ownerId: "demand-publication",
        relativePath: DEMAND_PUBLICATION_STAGES_ROOT_REF,
      },
      {
        declarationId: "demand.publication.transactions-root",
        ownerId: "demand-publication",
        relativePath: DEMAND_PUBLICATION_TRANSACTIONS_ROOT_REF,
      },
      {
        declarationId: "demand.publication.locks-root",
        ownerId: "demand-publication",
        relativePath: DEMAND_PUBLICATION_LOCKS_ROOT_REF,
      },
    ],
  );
  equal(WAKEFLOW_DEMAND_STATIC_RESOURCE_CATALOG.length, 4);
  for (const entry of WAKEFLOW_DEMAND_STATIC_RESOURCE_CATALOG) {
    equal(
      entry.family === "demand"
      && entry.scope === "host-neutral"
      && entry.tracking.disposition === "ignored"
      && entry.tracking.privacy === "runtime-private",
      true,
    );
    deepEqual(entry.nodePolicy, {
      kind: "directory",
      mode: "0700",
      symlinkPolicy: "reject",
      existingModePolicy: "observe-without-change",
    });
    deepEqual(entry.processing, {
      kind: "directory-container",
      materializationRecipe: "materialize-directory",
      existingDirectoryPolicy: "observe-without-mode-change",
      collisionPolicy: "reject-non-directory",
      descendantAuthority: "separate-declaration-required",
      recoveryStrategy: "report-only",
    });
  }
  assertDeepFrozen(WAKEFLOW_DEMAND_STATIC_RESOURCE_CATALOG);
});

test("Demand concrete catalog binds one Event Sourcing aggregate without stages", () => {
  const rootRef = demandFinalRootRef(DEMAND_ID);
  const prefix = `demand.event-sourcing.${DEMAND_ID}`;
  const catalog = createDemandEventSourcingResourceCatalog(DEMAND_ID);

  deepEqual(
    catalog.map((entry) => ({
      declarationId: entry.declarationId,
      ownerId: entry.ownerId,
      relativePath: entry.placement.relativePath,
      mode: modeOf(entry.nodePolicy),
      processing: processingOf(entry.processing),
    })),
    [
      {
        declarationId: `${prefix}.root`,
        ownerId: "demand-event-sourcing",
        relativePath: rootRef,
        mode: "0700",
        processing: "directory-container:exact-directory-publish",
      },
      {
        declarationId: `${prefix}.identity`,
        ownerId: "demand-event-sourcing",
        relativePath: `${rootRef}/${DEMAND_EVENT_SOURCING_IDENTITY_REF}`,
        mode: "0600",
        processing: "immutable-fact:exclusive-create",
      },
      {
        declarationId: `${prefix}.authority`,
        ownerId: "demand-event-sourcing",
        relativePath: `${rootRef}/${DEMAND_EVENT_SOURCING_AUTHORITY_REF}`,
        mode: "0600",
        processing: "immutable-fact:exclusive-create",
      },
      {
        declarationId: `${prefix}.event-sourcing-root`,
        ownerId: "demand-event-sourcing",
        relativePath: `${rootRef}/${DEMAND_EVENT_SOURCING_ROOT_REF}`,
        mode: "0700",
        processing: "directory-container:materialize-directory",
      },
      {
        declarationId: `${prefix}.commits-root`,
        ownerId: "demand-event-sourcing",
        relativePath: `${rootRef}/${DEMAND_EVENT_STREAM_COMMITS_ROOT_REF}`,
        mode: "0700",
        processing: "directory-container:materialize-directory",
      },
      {
        declarationId: `${prefix}.snapshots-root`,
        ownerId: "demand-event-sourcing",
        relativePath: `${rootRef}/${DEMAND_EVENT_SOURCING_SNAPSHOTS_ROOT_REF}`,
        mode: "0700",
        processing: "directory-container:materialize-directory",
      },
      {
        declarationId: `${prefix}.append-candidates-root`,
        ownerId: "demand-event-sourcing",
        relativePath: `${rootRef}/${DEMAND_EVENT_APPEND_CANDIDATES_ROOT_REF}`,
        mode: "0700",
        processing: "directory-container:materialize-directory",
      },
      {
        declarationId: `${prefix}.artifacts-root`,
        ownerId: "demand-event-sourcing",
        relativePath: `${rootRef}/${DEMAND_EVENT_SOURCING_ARTIFACTS_ROOT_REF}`,
        mode: "0700",
        processing: "directory-container:materialize-directory",
      },
      {
        declarationId: `${prefix}.transactions-root`,
        ownerId: "demand-event-sourcing",
        relativePath: `${rootRef}/${DEMAND_EVENT_SOURCING_TRANSACTIONS_ROOT_REF}`,
        mode: "0700",
        processing: "directory-container:materialize-directory",
      },
      {
        declarationId: `${prefix}.publication-marker`,
        ownerId: "demand-publication",
        relativePath: demandFinalPublicationMarkerRef(DEMAND_ID),
        mode: "0600",
        processing: "transaction-artifact:exact-retire",
      },
      {
        declarationId: `${prefix}.publication-transaction`,
        ownerId: "demand-publication",
        relativePath: demandPublicationTransactionRef(DEMAND_ID),
        mode: "0600",
        processing: "transaction-artifact:exclusive-create+exact-retire",
      },
      {
        declarationId: `${prefix}.publication-lock`,
        ownerId: "demand-publication",
        relativePath: demandPublicationLockRef(DEMAND_ID),
        mode: "0600",
        processing: "transaction-artifact:exclusive-create+exact-retire",
      },
    ],
  );
  equal(catalog.length, 12);
  equal(
    catalog.every((entry) =>
      entry.family === "demand"
      && entry.scope === "host-neutral"
      && entry.tracking.disposition === "ignored"
      && entry.tracking.privacy === "runtime-private"),
    true,
  );
  equal(
    catalog.some((entry) =>
      entry.placement.relativePath === demandPublicationStageRef(DEMAND_ID)),
    false,
  );
  equal(
    catalog.some((entry) =>
      entry.placement.relativePath?.startsWith(
        `${rootRef}/${DEMAND_EVENT_APPEND_CANDIDATES_ROOT_REF}/`,
      ) === true),
    false,
  );
  assertDeepFrozen(catalog);
  deepEqual(createDemandEventSourcingResourceCatalog(DEMAND_ID), catalog);

  const publicationMarker = catalog[9];
  deepEqual(
    admitWakeflowResourceOperation(
      publicationMarker.processing,
      "exact-retire",
    ),
    {
      kind: "resource-mutation",
      role: "transaction-artifact",
      recipe: "exact-retire",
    },
  );
  let directMarkerCreation: unknown;
  try {
    admitWakeflowResourceOperation(
      publicationMarker.processing,
      "exclusive-create",
    );
  } catch (error: unknown) {
    directMarkerCreation = error;
  }
  equal(
    directMarkerCreation instanceof WakeflowResourceProcessingContractError,
    true,
  );

  let caught: unknown;
  try {
    createDemandEventSourcingResourceCatalog("invalid-demand-id");
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof WakeflowDurableIdError, true);
});

test("Demand commit and snapshot declarations keep authority and checkpoint distinct", () => {
  const rootRef = demandFinalRootRef(DEMAND_ID);
  const prefix = `demand.event-sourcing.${DEMAND_ID}`;
  const commit = createDemandEventStreamCommitResourceDeclaration(
    DEMAND_ID,
    COMMIT_SEQUENCE,
  );
  const snapshot = createDemandEventSourcingSnapshotResourceDeclaration(
    DEMAND_ID,
    COMMIT_SEQUENCE,
  );

  deepEqual(
    [commit, snapshot].map((entry) => ({
      declarationId: entry.declarationId,
      relativePath: entry.placement.relativePath,
      processing: entry.processing,
    })),
    [
      {
        declarationId: `${prefix}.commit-1`,
        relativePath: `${rootRef}/${demandEventStreamCommitRef(COMMIT_SEQUENCE)}`,
        processing: {
          kind: "resource",
          role: "immutable-fact",
          allowedMutationRecipes: ["exclusive-create"],
          recoveryStrategy: "exact-idempotent-retry",
        },
      },
      {
        declarationId: `${prefix}.snapshot-1`,
        relativePath: `${rootRef}/${demandEventSourcingSnapshotRef(COMMIT_SEQUENCE)}`,
        processing: {
          kind: "resource",
          role: "derived-checkpoint",
          allowedMutationRecipes: ["exclusive-create"],
          recoveryStrategy: "rebuild-from-authority",
        },
      },
    ],
  );
  for (const entry of [commit, snapshot]) {
    equal(entry.kind, "WakeflowWorkspaceResourceDeclaration");
    equal(entry.family, "demand");
    equal(entry.ownerId, "demand-event-sourcing");
    equal(entry.scope, "host-neutral");
    deepEqual(entry.tracking, {
      disposition: "ignored",
      privacy: "runtime-private",
    });
    deepEqual(entry.nodePolicy, {
      kind: "file",
      mode: "0600",
      linkPolicy: "single-link",
      executablePolicy: "forbidden",
    });
  }
  assertDeepFrozen(commit);
  assertDeepFrozen(snapshot);
  deepEqual(
    admitWakeflowResourceOperation(commit.processing, "exclusive-create"),
    {
      kind: "resource-mutation",
      role: "immutable-fact",
      recipe: "exclusive-create",
    },
  );
  deepEqual(
    admitWakeflowResourceOperation(snapshot.processing, "exclusive-create"),
    {
      kind: "resource-mutation",
      role: "derived-checkpoint",
      recipe: "exclusive-create",
    },
  );

  let rejectedOperation: unknown;
  try {
    admitWakeflowResourceOperation(
      snapshot.processing,
      "deterministic-rewrite",
    );
  } catch (error: unknown) {
    rejectedOperation = error;
  }
  equal(
    rejectedOperation instanceof WakeflowResourceProcessingContractError,
    true,
  );

  let invalidSequence: unknown;
  try {
    createDemandEventStreamCommitResourceDeclaration(DEMAND_ID, 0);
  } catch (error: unknown) {
    invalidSequence = error;
  }
  equal(invalidSequence instanceof DemandEventSourcingAggregateError, true);
  if (invalidSequence instanceof DemandEventSourcingAggregateError) {
    equal(invalidSequence.reason, "position");
    equal(invalidSequence.path, "$commitSequence");
  }
  deepEqual(
    createDemandEventSourcingSnapshotResourceDeclaration(
      DEMAND_ID,
      COMMIT_SEQUENCE,
    ),
    snapshot,
  );
});
