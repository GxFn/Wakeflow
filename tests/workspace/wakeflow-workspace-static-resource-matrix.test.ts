import { deepEqual, equal, notEqual } from "node:assert/strict";
import { test } from "node:test";

import {
  WAKEFLOW_CONFIG_AUTHORITY_RESOURCE_DECLARATION,
  WAKEFLOW_CONFIG_RESOURCE_CATALOG,
} from "../../src/configuration/wakeflow-config-resource-catalog.js";
import { claudeCodeWorkspaceHostResourceProfile } from "../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { WAKEFLOW_DEMAND_STATIC_RESOURCE_CATALOG } from "../../src/governance/demand/demand-resource-catalog.js";
import { WINDOW_WORK_CLAIM_STATIC_RESOURCE_CATALOG } from "../../src/governance/delivery/window-work-claim-resource-catalog.js";
import { WAKEFLOW_LEDGER_STATIC_RESOURCE_CATALOG } from "../../src/governance/ledger/ledger-resource-catalog.js";
import { WAKEFLOW_TODO_STATIC_RESOURCE_CATALOG } from "../../src/governance/todo/todo-resource-catalog.js";
import { WAKEFLOW_ACTIVE_STATIC_RESOURCE_CATALOG } from "../../src/workspace/active/wakeflow-active-resource-catalog.js";
import { WAKEFLOW_MANAGED_INTEGRATION_STATIC_RESOURCE_CATALOG } from "../../src/workspace/managed-integration/wakeflow-managed-integration-resource-catalog.js";
import { WAKEFLOW_MAINTENANCE_STATIC_RESOURCE_CATALOG } from "../../src/workspace/maintenance/wakeflow-maintenance-resource-catalog.js";
import { createWakeflowWorkspaceHostResourceCatalog } from "../../src/workspace/workspace-host-resource-catalog.js";
import { WAKEFLOW_HOST_RUNTIME_STATIC_RESOURCE_CATALOG } from "../../src/workspace/workspace-host-runtime-resource-catalog.js";
import { WAKEFLOW_SHARED_RUNTIME_STATIC_RESOURCE_CATALOG } from "../../src/workspace/workspace-shared-runtime-resource-catalog.js";
import { parseWakeflowWorkspaceHostResourceProfile } from "../../src/workspace/workspace-host-resource-profile.js";
import {
  createWakeflowWorkspaceStaticResourceMatrix,
  findWakeflowWorkspaceStaticResourceByDeclarationId,
  parseWakeflowWorkspaceStaticResourceMatrix,
  selectWakeflowWorkspaceStaticResourcesByFamily,
  selectWakeflowWorkspaceStaticResourcesByOwner,
  WakeflowWorkspaceStaticResourceMatrixError,
} from "../../src/workspace/wakeflow-workspace-static-resource-matrix.js";

function assertDeepFrozen(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

function sorted(values: readonly string[]): readonly string[] {
  return [...values].sort();
}

test("Static Resource Matrix explicitly composes and deterministically sorts catalogs", () => {
  const codex = createWakeflowWorkspaceStaticResourceMatrix(
    codexWorkspaceHostResourceProfile,
  );
  const claude = createWakeflowWorkspaceStaticResourceMatrix(
    claudeCodeWorkspaceHostResourceProfile,
  );
  equal(codex.kind, "WakeflowWorkspaceStaticResourceMatrix");
  equal(codex.hostId, "codex");
  equal(claude.hostId, "claude-code");
  equal(codex.declarations.length, 43);
  equal(claude.declarations.length, 51);

  const expectedSharedIds = sorted(
    [
      ...WAKEFLOW_CONFIG_RESOURCE_CATALOG,
      ...WAKEFLOW_ACTIVE_STATIC_RESOURCE_CATALOG,
      ...WAKEFLOW_TODO_STATIC_RESOURCE_CATALOG,
      ...WAKEFLOW_LEDGER_STATIC_RESOURCE_CATALOG,
      ...WAKEFLOW_DEMAND_STATIC_RESOURCE_CATALOG,
      ...WINDOW_WORK_CLAIM_STATIC_RESOURCE_CATALOG,
      ...WAKEFLOW_MANAGED_INTEGRATION_STATIC_RESOURCE_CATALOG,
      ...WAKEFLOW_MAINTENANCE_STATIC_RESOURCE_CATALOG,
      ...WAKEFLOW_HOST_RUNTIME_STATIC_RESOURCE_CATALOG,
      ...WAKEFLOW_SHARED_RUNTIME_STATIC_RESOURCE_CATALOG,
    ].map((entry) => entry.declarationId),
  );
  for (const matrix of [codex, claude]) {
    const ids = matrix.declarations.map((entry) => entry.declarationId);
    deepEqual(ids, sorted(ids));
    equal(new Set(ids).size, ids.length);
    equal(
      new Set(
        matrix.declarations.map((entry) => JSON.stringify(entry.placement)),
      ).size,
      matrix.declarations.length,
    );
    deepEqual(
      matrix.declarations
        .filter((entry) => entry.scope === "host-neutral")
        .map((entry) => entry.declarationId),
      expectedSharedIds,
    );
    equal(
      matrix.declarations.some(
        (entry) =>
          entry.declarationId.includes("demand_") ||
          entry.declarationId.includes("active.todo.item."),
      ),
      false,
    );
    equal(
      matrix.declarations.some(
        (entry) => entry.placement.relativePath?.includes("{") === true,
      ),
      false,
    );
    assertDeepFrozen(matrix);
  }

  deepEqual(
    codex.declarations
      .filter((entry) => entry.scope === "current-host")
      .map((entry) => entry.declarationId),
    sorted(
      createWakeflowWorkspaceHostResourceCatalog(
        codexWorkspaceHostResourceProfile,
      ).map((entry) => entry.declarationId),
    ),
  );
  deepEqual(
    claude.declarations
      .filter((entry) => entry.scope === "current-host")
      .map((entry) => entry.declarationId),
    sorted(
      createWakeflowWorkspaceHostResourceCatalog(
        claudeCodeWorkspaceHostResourceProfile,
      ).map((entry) => entry.declarationId),
    ),
  );
  equal(codex.sharedDigest, claude.sharedDigest);
  notEqual(codex.matrixDigest, claude.matrixDigest);
  equal(/^sha256:[0-9a-f]{64}$/u.test(codex.sharedDigest), true);
  equal(/^sha256:[0-9a-f]{64}$/u.test(codex.matrixDigest), true);
  deepEqual(
    createWakeflowWorkspaceStaticResourceMatrix(
      codexWorkspaceHostResourceProfile,
    ),
    codex,
  );
  const reparsed = parseWakeflowWorkspaceStaticResourceMatrix(codex);
  deepEqual(reparsed, codex);
  notEqual(reparsed.declarations, codex.declarations);
});

test("Static Resource Matrix rejects a duplicate logical placement", () => {
  const collidingProfile = parseWakeflowWorkspaceHostResourceProfile({
    kind: "WakeflowWorkspaceHostResourceProfile",
    hostId: "codex",
    runtimeDirectoryName: "codex",
    instructionFileName: "wakeflow.config.json",
    surfaces: {
      windowIdentity: false,
      podEvidence: false,
      keepLive: false,
      windowLocator: false,
      settingsIntegration: null,
      statuslineAsset: null,
      activityMonitor: false,
      temporaryPrompts: false,
    },
  });

  let caught: unknown;
  try {
    createWakeflowWorkspaceStaticResourceMatrix(collidingProfile);
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof WakeflowWorkspaceStaticResourceMatrixError, true);
  if (caught instanceof WakeflowWorkspaceStaticResourceMatrixError) {
    equal(caught.code, "wakeflow-workspace-static-resource-matrix");
    equal(caught.reason, "placement-collision");
    equal(caught.path, "$/declarations");
  }

  const unsafeProfiles = [
    parseWakeflowWorkspaceHostResourceProfile({
      ...collidingProfile,
      instructionFileName: "WAKEFLOW.CONFIG.JSON",
    }),
    parseWakeflowWorkspaceHostResourceProfile({
      ...collidingProfile,
      instructionFileName: ".wakeflow-local",
    }),
    parseWakeflowWorkspaceHostResourceProfile({
      ...collidingProfile,
      instructionFileName: "CUSTOM.md",
      surfaces: {
        ...collidingProfile.surfaces,
        settingsIntegration: {
          portablePath: ".Tool/settings.json",
          localPath: ".tool/settings.local.json",
        },
      },
    }),
  ];
  for (const profile of unsafeProfiles) {
    caught = undefined;
    try {
      createWakeflowWorkspaceStaticResourceMatrix(profile);
    } catch (error: unknown) {
      caught = error;
    }
    equal(caught instanceof WakeflowWorkspaceStaticResourceMatrixError, true);
    if (caught instanceof WakeflowWorkspaceStaticResourceMatrixError) {
      equal(caught.reason, "placement-collision");
    }
  }

  const valid = createWakeflowWorkspaceStaticResourceMatrix(
    codexWorkspaceHostResourceProfile,
  );
  const forged = Object.freeze({
    ...valid,
    declarations: Object.freeze(valid.declarations.slice(1)),
  });
  let forgedError: unknown;
  try {
    parseWakeflowWorkspaceStaticResourceMatrix(forged);
  } catch (error: unknown) {
    forgedError = error;
  }
  equal(
    forgedError instanceof WakeflowWorkspaceStaticResourceMatrixError,
    true,
  );
  if (forgedError instanceof WakeflowWorkspaceStaticResourceMatrixError) {
    equal(forgedError.reason, "digest");
    equal(forgedError.path, "$matrix");
  }
});

test("Static Resource Matrix exposes only narrow frozen queries", () => {
  const matrix = createWakeflowWorkspaceStaticResourceMatrix(
    codexWorkspaceHostResourceProfile,
  );
  deepEqual(
    findWakeflowWorkspaceStaticResourceByDeclarationId(
      matrix,
      "workspace.config-authority",
    ),
    WAKEFLOW_CONFIG_AUTHORITY_RESOURCE_DECLARATION,
  );
  equal(
    findWakeflowWorkspaceStaticResourceByDeclarationId(
      matrix,
      "workspace.missing",
    ),
    null,
  );

  const demand = selectWakeflowWorkspaceStaticResourcesByFamily(
    matrix,
    "demand",
  );
  deepEqual(
    demand.map((entry) => entry.declarationId),
    sorted(
      WAKEFLOW_DEMAND_STATIC_RESOURCE_CATALOG.map(
        (entry) => entry.declarationId,
      ),
    ),
  );
  equal(Object.isFrozen(demand), true);

  const configOwner = selectWakeflowWorkspaceStaticResourcesByOwner(
    matrix,
    "config-authority",
  );
  deepEqual(
    configOwner.map((entry) => entry.declarationId),
    ["workspace.config-authority", "workspace.config-authority-lock"],
  );
  equal(Object.isFrozen(configOwner), true);

  let invalidQuery: unknown;
  try {
    selectWakeflowWorkspaceStaticResourcesByFamily(matrix, "unknown-family");
  } catch (error: unknown) {
    invalidQuery = error;
  }
  equal(
    invalidQuery instanceof WakeflowWorkspaceStaticResourceMatrixError,
    true,
  );
  if (invalidQuery instanceof WakeflowWorkspaceStaticResourceMatrixError) {
    equal(invalidQuery.reason, "query");
    equal(invalidQuery.path, "$/family");
  }
});
