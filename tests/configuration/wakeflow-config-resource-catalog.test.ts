import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  admitWakeflowResourceOperation,
  WakeflowResourceProcessingContractError,
} from "../../src/foundation/resource/resource-processing-contract.js";
import {
  WAKEFLOW_CONFIG_AUTHORITY_LOCK_REF,
} from "../../src/configuration/wakeflow-config-authority-replacement-contract.js";
import {
  WAKEFLOW_CONFIG_AUTHORITY_FILE_MODE,
  WAKEFLOW_CONFIG_FILE_REF,
} from "../../src/configuration/wakeflow-config-authority-snapshot.js";
import {
  WAKEFLOW_CONFIG_AUTHORITY_LOCK_RESOURCE_DECLARATION,
  WAKEFLOW_CONFIG_AUTHORITY_RESOURCE_DECLARATION,
  WAKEFLOW_CONFIG_RESOURCE_CATALOG,
} from "../../src/configuration/wakeflow-config-resource-catalog.js";

function assertDeepFrozen(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

function expectOperationRejection(action: () => unknown): void {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof WakeflowResourceProcessingContractError)) {
    throw new Error("Expected WakeflowResourceProcessingContractError.");
  }
  equal(caught.reason, "operation");
  equal(caught.path, "$/recipe");
}

test("Config resource catalog owns only its stable authority and lock surfaces", () => {
  deepEqual(WAKEFLOW_CONFIG_AUTHORITY_RESOURCE_DECLARATION, {
    kind: "WakeflowWorkspaceResourceDeclaration",
    declarationId: "workspace.config-authority",
    family: "workspace",
    ownerId: "config-authority",
    scope: "host-neutral",
    placement: {
      root: { kind: "workspace" },
      relativePath: WAKEFLOW_CONFIG_FILE_REF,
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
      role: "mutable-snapshot",
      allowedMutationRecipes: [
        "exclusive-create",
        "exact-source-replace",
      ],
      recoveryStrategy: "owner-forward-recovery",
    },
  });
  deepEqual(WAKEFLOW_CONFIG_AUTHORITY_LOCK_RESOURCE_DECLARATION, {
    kind: "WakeflowWorkspaceResourceDeclaration",
    declarationId: "workspace.config-authority-lock",
    family: "workspace",
    ownerId: "config-authority",
    scope: "host-neutral",
    placement: {
      root: { kind: "workspace" },
      relativePath: WAKEFLOW_CONFIG_AUTHORITY_LOCK_REF,
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
    processing: {
      kind: "resource",
      role: "transaction-artifact",
      allowedMutationRecipes: [
        "exclusive-create",
        "exact-retire",
      ],
      recoveryStrategy: "owner-transaction-recovery",
    },
  });
  deepEqual(WAKEFLOW_CONFIG_RESOURCE_CATALOG, [
    WAKEFLOW_CONFIG_AUTHORITY_RESOURCE_DECLARATION,
    WAKEFLOW_CONFIG_AUTHORITY_LOCK_RESOURCE_DECLARATION,
  ]);
  assertDeepFrozen(WAKEFLOW_CONFIG_RESOURCE_CATALOG);
  if (WAKEFLOW_CONFIG_AUTHORITY_RESOURCE_DECLARATION.nodePolicy.kind !== "file") {
    throw new Error("Config authority node policy must be a file.");
  }
  equal(
    Number.parseInt(
      WAKEFLOW_CONFIG_AUTHORITY_RESOURCE_DECLARATION.nodePolicy.mode,
      8,
    ),
    WAKEFLOW_CONFIG_AUTHORITY_FILE_MODE,
  );

  equal(WAKEFLOW_CONFIG_RESOURCE_CATALOG.length, 2);
  equal(
    WAKEFLOW_CONFIG_RESOURCE_CATALOG.some((entry) =>
      entry.placement.relativePath?.startsWith(".wakeflow-atomic-") === true),
    false,
  );

  deepEqual(
    admitWakeflowResourceOperation(
      WAKEFLOW_CONFIG_AUTHORITY_RESOURCE_DECLARATION.processing,
      "exclusive-create",
    ),
    {
      kind: "resource-mutation",
      role: "mutable-snapshot",
      recipe: "exclusive-create",
    },
  );
  deepEqual(
    admitWakeflowResourceOperation(
      WAKEFLOW_CONFIG_AUTHORITY_RESOURCE_DECLARATION.processing,
      "exact-source-replace",
    ),
    {
      kind: "resource-mutation",
      role: "mutable-snapshot",
      recipe: "exact-source-replace",
    },
  );
  expectOperationRejection(() => admitWakeflowResourceOperation(
    WAKEFLOW_CONFIG_AUTHORITY_RESOURCE_DECLARATION.processing,
    "exact-retire",
  ));

  deepEqual(
    admitWakeflowResourceOperation(
      WAKEFLOW_CONFIG_AUTHORITY_LOCK_RESOURCE_DECLARATION.processing,
      "exact-retire",
    ),
    {
      kind: "resource-mutation",
      role: "transaction-artifact",
      recipe: "exact-retire",
    },
  );
  expectOperationRejection(() => admitWakeflowResourceOperation(
    WAKEFLOW_CONFIG_AUTHORITY_LOCK_RESOURCE_DECLARATION.processing,
    "exact-source-replace",
  ));
});
