import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  WAKEFLOW_MAINTENANCE_STATIC_RESOURCE_CATALOG,
} from "../../../src/workspace/maintenance/wakeflow-maintenance-resource-catalog.js";

function assertDeepFrozen(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

test("Maintenance catalog closes Local bootstrap chain and one gate", () => {
  deepEqual(WAKEFLOW_MAINTENANCE_STATIC_RESOURCE_CATALOG.map((entry) => ({
    declarationId: entry.declarationId,
    family: entry.family,
    ownerId: entry.ownerId,
    path: entry.placement.relativePath,
    mode: entry.nodePolicy.kind === "tree"
      ? entry.nodePolicy.rootMode
      : entry.nodePolicy.mode,
    processing: entry.processing.kind === "directory-container"
      ? entry.processing.materializationRecipe
      : `${entry.processing.role}:${entry.processing.allowedMutationRecipes.join("+")}`,
  })), [
    {
      declarationId: "local.root",
      family: "local-core",
      ownerId: "maintenance-bootstrap",
      path: ".wakeflow-local",
      mode: "0700",
      processing: "materialize-directory",
    },
    {
      declarationId: "local.runtime-root",
      family: "local-core",
      ownerId: "maintenance-bootstrap",
      path: ".wakeflow-local/runtime",
      mode: "0700",
      processing: "materialize-directory",
    },
    {
      declarationId: "maintenance.root",
      family: "maintenance",
      ownerId: "workspace-maintenance",
      path: ".wakeflow-local/runtime/maintenance",
      mode: "0700",
      processing: "materialize-directory",
    },
    {
      declarationId: "maintenance.transactions-root",
      family: "maintenance",
      ownerId: "workspace-maintenance",
      path: ".wakeflow-local/runtime/maintenance/transactions",
      mode: "0700",
      processing: "materialize-directory",
    },
    {
      declarationId: "maintenance.gate",
      family: "maintenance",
      ownerId: "workspace-maintenance",
      path: ".wakeflow-local/runtime/maintenance.lock",
      mode: "0600",
      processing: "transaction-artifact:exclusive-create+exact-retire",
    },
  ]);
  equal(new Set(WAKEFLOW_MAINTENANCE_STATIC_RESOURCE_CATALOG.map(
    (entry) => entry.declarationId,
  )).size, 5);
  assertDeepFrozen(WAKEFLOW_MAINTENANCE_STATIC_RESOURCE_CATALOG);
});
