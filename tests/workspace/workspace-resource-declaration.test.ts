import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  parseWakeflowWorkspaceResourceDeclaration,
  WAKEFLOW_WORKSPACE_RESOURCE_FAMILIES,
  WakeflowWorkspaceResourceDeclarationError,
  type WakeflowWorkspaceResourceDeclarationErrorReason,
} from "../../src/workspace/workspace-resource-declaration.js";

function assertDeepFrozen(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

function expectWorkspaceResourceDeclarationError(
  action: () => unknown,
  reason: WakeflowWorkspaceResourceDeclarationErrorReason,
  path: string,
): WakeflowWorkspaceResourceDeclarationError {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof WakeflowWorkspaceResourceDeclarationError)) {
    throw new Error("Expected WakeflowWorkspaceResourceDeclarationError.");
  }
  equal(caught.code, "wakeflow-workspace-resource-declaration");
  equal(caught.reason, reason);
  equal(caught.path, path);
  return caught;
}

function configDeclaration(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    kind: "WakeflowWorkspaceResourceDeclaration",
    declarationId: "workspace.config-authority",
    family: "workspace",
    ownerId: "config-authority",
    scope: "host-neutral",
    placement: {
      root: { kind: "workspace" },
      relativePath: "wakeflow.config.json",
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
    ...overrides,
  };
}

test("workspace resource declaration binds complete logical resource facts", () => {
  deepEqual(WAKEFLOW_WORKSPACE_RESOURCE_FAMILIES, [
    "workspace",
    "active",
    "local-core",
    "maintenance",
    "transport",
    "coordination",
    "audit",
    "demand",
    "host-runtime",
    "ledger",
    "support",
    "repository",
  ]);

  const configInput: Record<string, unknown> = {
    kind: "WakeflowWorkspaceResourceDeclaration",
    declarationId: "workspace.config-authority",
    family: "workspace",
    ownerId: "config-authority",
    scope: "host-neutral",
    placement: {
      root: { kind: "workspace" },
      relativePath: "wakeflow.config.json",
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
  };
  const config = parseWakeflowWorkspaceResourceDeclaration(configInput);
  deepEqual(config, configInput);
  assertDeepFrozen(config);

  const placement = configInput.placement as Record<string, unknown>;
  const root = placement.root as Record<string, unknown>;
  const tracking = configInput.tracking as Record<string, unknown>;
  const nodePolicy = configInput.nodePolicy as Record<string, unknown>;
  const processing = configInput.processing as Record<string, unknown>;
  const recipes = processing.allowedMutationRecipes;
  root.kind = "ledger";
  placement.relativePath = "changed.json";
  tracking.disposition = "ignored";
  nodePolicy.mode = "0600";
  if (Array.isArray(recipes)) recipes[0] = "no-write";

  deepEqual(config.placement, {
    root: { kind: "workspace" },
    relativePath: "wakeflow.config.json",
  });
  deepEqual(config.tracking, {
    disposition: "tracked",
    privacy: "shareable",
  });
  deepEqual(config.nodePolicy, {
    kind: "file",
    mode: "0644",
    linkPolicy: "single-link",
    executablePolicy: "forbidden",
  });
  equal(config.processing.kind, "resource");
  if (config.processing.kind === "resource") {
    deepEqual(config.processing.allowedMutationRecipes, [
      "exclusive-create",
      "exact-source-replace",
    ]);
  }

  const repository = parseWakeflowWorkspaceResourceDeclaration({
    kind: "WakeflowWorkspaceResourceDeclaration",
    declarationId:
      "repository.repository_22222222-2222-4222-8222-222222222222.root",
    family: "repository",
    ownerId: "repository-owner",
    scope: "host-neutral",
    placement: {
      root: {
        kind: "repository",
        repositoryId:
          "repository_22222222-2222-4222-8222-222222222222",
      },
      relativePath: null,
    },
    tracking: {
      disposition: "owner-defined",
      privacy: "shareable",
    },
    nodePolicy: {
      kind: "directory",
      mode: "owner-defined",
      symlinkPolicy: "reject",
      existingModePolicy: "observe-without-change",
    },
    processing: {
      kind: "resource",
      role: "external-reference",
      allowedMutationRecipes: ["no-write"],
      recoveryStrategy: "report-only",
    },
  });
  equal(repository.placement.root.kind, "repository");
  if (repository.placement.root.kind === "repository") {
    equal(
      repository.placement.root.repositoryId,
      "repository_22222222-2222-4222-8222-222222222222",
    );
  }
  equal(repository.placement.relativePath, null);
  assertDeepFrozen(repository);

  const localRoot = parseWakeflowWorkspaceResourceDeclaration({
    kind: "WakeflowWorkspaceResourceDeclaration",
    declarationId: "local-core.root",
    family: "local-core",
    ownerId: "workspace-layout",
    scope: "host-neutral",
    placement: {
      root: { kind: "workspace" },
      relativePath: ".wakeflow-local",
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
  equal(localRoot.nodePolicy.kind, "directory");
  equal(localRoot.processing.kind, "directory-container");
  assertDeepFrozen(localRoot);
});

test("workspace resource declaration rejects open and invalid logical data", () => {
  expectWorkspaceResourceDeclarationError(
    () => parseWakeflowWorkspaceResourceDeclaration(configDeclaration({
      unexpected: true,
    })),
    "shape",
    "$/unexpected",
  );

  const placementWithOpenRoot = {
    root: { kind: "workspace", repositoryId: "not-applicable" },
    relativePath: "wakeflow.config.json",
  };
  expectWorkspaceResourceDeclarationError(
    () => parseWakeflowWorkspaceResourceDeclaration(configDeclaration({
      placement: placementWithOpenRoot,
    })),
    "shape",
    "$/placement/root/repositoryId",
  );
  expectWorkspaceResourceDeclarationError(
    () => parseWakeflowWorkspaceResourceDeclaration(configDeclaration({
      tracking: {
        disposition: "tracked",
        privacy: "shareable",
        inferred: true,
      },
    })),
    "shape",
    "$/tracking/inferred",
  );
  expectWorkspaceResourceDeclarationError(
    () => parseWakeflowWorkspaceResourceDeclaration(configDeclaration({
      nodePolicy: {
        kind: "file",
        mode: "0644",
        linkPolicy: "single-link",
        executablePolicy: "forbidden",
        chmodExisting: true,
      },
    })),
    "shape",
    "$/nodePolicy/chmodExisting",
  );

  for (const [field, value, reason, path] of [
    ["declarationId", "Workspace", "identity", "$/declarationId"],
    ["ownerId", "config_authority", "owner", "$/ownerId"],
    ["family", "unknown", "family", "$/family"],
    ["scope", "all-hosts", "scope", "$/scope"],
  ] as const) {
    expectWorkspaceResourceDeclarationError(
      () => parseWakeflowWorkspaceResourceDeclaration(configDeclaration({
        [field]: value,
      })),
      reason,
      path,
    );
  }

  expectWorkspaceResourceDeclarationError(
    () => parseWakeflowWorkspaceResourceDeclaration(configDeclaration({
      placement: {
        root: {
          kind: "repository",
          repositoryId: "surface_33333333-3333-4333-8333-333333333333",
        },
        relativePath: null,
      },
    })),
    "placement",
    "$/placement/root/repositoryId",
  );
  expectWorkspaceResourceDeclarationError(
    () => parseWakeflowWorkspaceResourceDeclaration(configDeclaration({
      placement: {
        root: { kind: "workspace" },
        relativePath: "../outside",
      },
    })),
    "placement",
    "$/placement/relativePath",
  );
  expectWorkspaceResourceDeclarationError(
    () => parseWakeflowWorkspaceResourceDeclaration(configDeclaration({
      placement: {
        root: { kind: "workspace" },
        relativePath: null,
      },
    })),
    "placement",
    "$/placement/relativePath",
  );
  expectWorkspaceResourceDeclarationError(
    () => parseWakeflowWorkspaceResourceDeclaration(configDeclaration({
      processing: {
        kind: "resource",
        role: "mutable-snapshot",
        allowedMutationRecipes: ["no-write"],
        recoveryStrategy: "owner-forward-recovery",
      },
    })),
    "processing",
    "$/processing/allowedMutationRecipes/0",
  );

  let trapCalls = 0;
  const proxy = new Proxy(configDeclaration(), {
    get: () => {
      trapCalls += 1;
      return undefined;
    },
    getOwnPropertyDescriptor: () => {
      trapCalls += 1;
      return undefined;
    },
    getPrototypeOf: () => {
      trapCalls += 1;
      return Object.prototype;
    },
    ownKeys: () => {
      trapCalls += 1;
      return [];
    },
  });
  expectWorkspaceResourceDeclarationError(
    () => parseWakeflowWorkspaceResourceDeclaration(proxy),
    "input",
    "$",
  );
  equal(trapCalls, 0);
});

test("workspace resource declaration rejects incompatible resource facts", () => {
  const mutableProcessing = {
    kind: "resource",
    role: "mutable-snapshot",
    allowedMutationRecipes: [
      "exclusive-create",
      "exact-source-replace",
    ],
    recoveryStrategy: "owner-forward-recovery",
  };
  const file0644 = {
    kind: "file",
    mode: "0644",
    linkPolicy: "single-link",
    executablePolicy: "forbidden",
  };

  for (const [overrides, path] of [
    [{
      nodePolicy: {
        kind: "directory",
        mode: "0755",
        symlinkPolicy: "reject",
        existingModePolicy: "observe-without-change",
      },
    }, "$/nodePolicy/kind"],
    [{
      processing: {
        kind: "resource",
        role: "manifested-tree",
        allowedMutationRecipes: ["tree-publish-or-move"],
        recoveryStrategy: "manifest-closure",
      },
    }, "$/nodePolicy/kind"],
    [{
      processing: {
        kind: "directory-container",
        materializationRecipe: "materialize-directory",
        existingDirectoryPolicy: "observe-without-mode-change",
        collisionPolicy: "reject-non-directory",
        descendantAuthority: "separate-declaration-required",
        recoveryStrategy: "report-only",
      },
    }, "$/nodePolicy/kind"],
    [{
      nodePolicy: {
        ...file0644,
        mode: "0600",
      },
    }, "$/nodePolicy/mode"],
    [{
      tracking: {
        disposition: "tracked",
        privacy: "runtime-private",
      },
    }, "$/tracking/privacy"],
    [{
      tracking: {
        disposition: "owner-defined",
        privacy: "shareable",
      },
    }, "$/nodePolicy/mode"],
    [{
      family: "ledger",
    }, "$/placement/root/kind"],
    [{
      family: "active",
      placement: {
        root: { kind: "ledger" },
        relativePath: "active.json",
      },
    }, "$/placement/root/kind"],
  ] as const) {
    expectWorkspaceResourceDeclarationError(
      () => parseWakeflowWorkspaceResourceDeclaration(configDeclaration({
        processing: mutableProcessing,
        nodePolicy: file0644,
        ...overrides,
      })),
      "compatibility",
      path,
    );
  }

  expectWorkspaceResourceDeclarationError(
    () => parseWakeflowWorkspaceResourceDeclaration({
      kind: "WakeflowWorkspaceResourceDeclaration",
      declarationId: "ledger.root-file",
      family: "ledger",
      ownerId: "ledger-authority",
      scope: "host-neutral",
      placement: {
        root: { kind: "ledger" },
        relativePath: null,
      },
      tracking: {
        disposition: "tracked",
        privacy: "shareable",
      },
      nodePolicy: file0644,
      processing: {
        kind: "resource",
        role: "immutable-fact",
        allowedMutationRecipes: ["exclusive-create"],
        recoveryStrategy: "exact-idempotent-retry",
      },
    }),
    "compatibility",
    "$/placement/relativePath",
  );

  const executableAsset = parseWakeflowWorkspaceResourceDeclaration({
    ...configDeclaration(),
    declarationId: "host-runtime.statusline-asset",
    family: "host-runtime",
    ownerId: "host-assets",
    scope: "current-host",
    placement: {
      root: { kind: "workspace" },
      relativePath: ".wakeflow-local/runtime/hosts/claude-code/statusline.mjs",
    },
    tracking: {
      disposition: "ignored",
      privacy: "runtime-private",
    },
    nodePolicy: {
      kind: "file",
      mode: "0700",
      linkPolicy: "single-link",
      executablePolicy: "profile-declared",
    },
    processing: {
      kind: "resource",
      role: "derived-projection",
      allowedMutationRecipes: ["deterministic-rewrite"],
      recoveryStrategy: "rebuild-from-authority",
    },
  });
  equal(executableAsset.nodePolicy.kind, "file");
  if (executableAsset.nodePolicy.kind === "file") {
    equal(executableAsset.nodePolicy.mode, "0700");
    equal(executableAsset.nodePolicy.executablePolicy, "profile-declared");
  }
});
