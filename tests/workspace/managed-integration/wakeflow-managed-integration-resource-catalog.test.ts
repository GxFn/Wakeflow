import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  admitWakeflowResourceOperation,
  WakeflowResourceProcessingContractError,
} from "../../../src/foundation/resource/resource-processing-contract.js";
import {
  WAKEFLOW_GITIGNORE_REF,
  WAKEFLOW_MANAGED_INTEGRATION_STATIC_RESOURCE_CATALOG,
  WAKEFLOW_WORKSPACE_IGNORE_RESOURCE_DECLARATION,
} from "../../../src/workspace/managed-integration/wakeflow-managed-integration-resource-catalog.js";

function assertDeepFrozen(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

test("Managed Integration Catalog gives .gitignore one exact resource policy", () => {
  deepEqual(WAKEFLOW_WORKSPACE_IGNORE_RESOURCE_DECLARATION, {
    kind: "WakeflowWorkspaceResourceDeclaration",
    declarationId: "workspace.ignore-integration",
    family: "workspace",
    ownerId: "workspace-ignore-integration",
    scope: "host-neutral",
    placement: {
      root: { kind: "workspace" },
      relativePath: WAKEFLOW_GITIGNORE_REF,
    },
    tracking: {
      disposition: "tracked",
      privacy: "shareable",
    },
    nodePolicy: {
      kind: "file",
      mode: "0644",
      linkPolicy: "single-link",
      executablePolicy: "forbidden",
    },
    processing: {
      kind: "resource",
      role: "managed-integration-text",
      allowedMutationRecipes: ["exact-source-recompose"],
      recoveryStrategy: "recompose-owned-content",
    },
  });
  // 重组 `.gitignore` 的锁在工作区的锁目录里（ADR-0033），不是这张目录里的一项资源。
  deepEqual(WAKEFLOW_MANAGED_INTEGRATION_STATIC_RESOURCE_CATALOG, [
    WAKEFLOW_WORKSPACE_IGNORE_RESOURCE_DECLARATION,
  ]);
  assertDeepFrozen(WAKEFLOW_MANAGED_INTEGRATION_STATIC_RESOURCE_CATALOG);
  deepEqual(
    admitWakeflowResourceOperation(
      WAKEFLOW_WORKSPACE_IGNORE_RESOURCE_DECLARATION.processing,
      "exact-source-recompose",
    ),
    {
      kind: "resource-mutation",
      role: "managed-integration-text",
      recipe: "exact-source-recompose",
    },
  );

  let caught: unknown;
  try {
    admitWakeflowResourceOperation(
      WAKEFLOW_WORKSPACE_IGNORE_RESOURCE_DECLARATION.processing,
      "deterministic-rewrite",
    );
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof WakeflowResourceProcessingContractError, true);
});
