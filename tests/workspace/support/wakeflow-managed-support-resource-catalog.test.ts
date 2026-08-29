import { deepEqual, equal, notEqual } from "node:assert/strict";
import { test } from "node:test";

import {
  claudeCodeWorkspaceHostResourceProfile,
} from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import {
  codexWorkspaceHostResourceProfile,
} from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import {
  createWakeflowManagedSupportResourceCatalog,
  WakeflowManagedSupportResourceCatalogError,
} from "../../../src/workspace/support/wakeflow-managed-support-resource-catalog.js";
import {
  createMinimalWakeflowConfigV3,
} from "../../configuration/wakeflow-config-v3.fixture.js";

function assertDeepFrozen(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

function summary(catalog: ReturnType<
  typeof createWakeflowManagedSupportResourceCatalog
>) {
  return catalog.declarations.map((entry) => ({
    declarationId: entry.declarationId,
    ownerId: entry.ownerId,
    scope: entry.scope,
    placement: entry.placement,
    mode: entry.nodePolicy.kind === "tree"
      ? entry.nodePolicy.rootMode
      : entry.nodePolicy.mode,
    processing: entry.processing.kind === "directory-container"
      ? entry.processing.materializationRecipe
      : `${entry.processing.role}:${entry.processing.allowedMutationRecipes.join("+")}`,
  }));
}

test("managed Support catalog binds two topology surfaces to the current host", () => {
  const config = createMinimalWakeflowConfigV3();
  const codex = createWakeflowManagedSupportResourceCatalog(
    config,
    codexWorkspaceHostResourceProfile,
  );
  deepEqual(summary(codex), [
    {
      declarationId:
        "support.surface_33333333-3333-4333-8333-333333333333.instruction.codex",
      ownerId: "support-memory",
      scope: "current-host",
      placement: {
        root: {
          kind: "support-surface",
          surfaceId: "surface_33333333-3333-4333-8333-333333333333",
        },
        relativePath: "AGENTS.md",
      },
      mode: "0644",
      processing: "derived-projection:deterministic-rewrite",
    },
    {
      declarationId:
        "support.surface_33333333-3333-4333-8333-333333333333.root",
      ownerId: "support-surface-layout",
      scope: "host-neutral",
      placement: {
        root: {
          kind: "support-surface",
          surfaceId: "surface_33333333-3333-4333-8333-333333333333",
        },
        relativePath: null,
      },
      mode: "0755",
      processing: "materialize-directory",
    },
    {
      declarationId:
        "support.surface_44444444-4444-4444-8444-444444444444.instruction.codex",
      ownerId: "support-memory",
      scope: "current-host",
      placement: {
        root: {
          kind: "support-surface",
          surfaceId: "surface_44444444-4444-4444-8444-444444444444",
        },
        relativePath: "AGENTS.md",
      },
      mode: "0644",
      processing: "derived-projection:deterministic-rewrite",
    },
    {
      declarationId:
        "support.surface_44444444-4444-4444-8444-444444444444.root",
      ownerId: "support-surface-layout",
      scope: "host-neutral",
      placement: {
        root: {
          kind: "support-surface",
          surfaceId: "surface_44444444-4444-4444-8444-444444444444",
        },
        relativePath: null,
      },
      mode: "0755",
      processing: "materialize-directory",
    },
  ]);
  equal(/^sha256:[0-9a-f]{64}$/u.test(codex.catalogDigest), true);
  assertDeepFrozen(codex);
  deepEqual(
    createWakeflowManagedSupportResourceCatalog(
      config,
      codexWorkspaceHostResourceProfile,
    ),
    codex,
  );

  const claude = createWakeflowManagedSupportResourceCatalog(
    config,
    claudeCodeWorkspaceHostResourceProfile,
  );
  equal(
    claude.declarations.filter((entry) => (
      entry.ownerId === "support-memory"
    )).every((entry) => entry.placement.relativePath === "CLAUDE.md"),
    true,
  );
  equal(claude.configDigest, codex.configDigest);
  notEqual(claude.catalogDigest, codex.catalogDigest);
});

test("managed Support catalog excludes every external-owned surface", () => {
  const config = createMinimalWakeflowConfigV3();
  const surfaces = (config.topology as {
    supportSurfaces: Record<string, unknown>[];
  }).supportSurfaces;
  for (const [index, surface] of surfaces.entries()) {
    surface.ownership = "external-owned";
    surface.instructionManagement = index === 0
      ? "managed-block"
      : "owner-managed";
  }
  const catalog = createWakeflowManagedSupportResourceCatalog(
    config,
    codexWorkspaceHostResourceProfile,
  );
  deepEqual(catalog.declarations, []);
  assertDeepFrozen(catalog);

  let trapCalls = 0;
  const proxy = new Proxy(createMinimalWakeflowConfigV3(), {
    ownKeys: () => {
      trapCalls += 1;
      return [];
    },
  });
  let caught: unknown;
  try {
    createWakeflowManagedSupportResourceCatalog(
      proxy,
      codexWorkspaceHostResourceProfile,
    );
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof WakeflowManagedSupportResourceCatalogError, true);
  equal(trapCalls, 0);
});
