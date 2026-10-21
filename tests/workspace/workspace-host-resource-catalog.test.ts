import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import type { WakeflowResourceProcessingContract } from "../../src/foundation/resource/resource-processing-contract.js";
import { claudeCodeWorkspaceHostResourceProfile } from "../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { createWakeflowWorkspaceHostResourceCatalog } from "../../src/workspace/workspace-host-resource-catalog.js";
import {
  parseWakeflowWorkspaceHostResourceProfile,
  WakeflowWorkspaceHostResourceProfileError,
} from "../../src/workspace/workspace-host-resource-profile.js";
import type { WakeflowWorkspaceResourceNodePolicy } from "../../src/workspace/workspace-resource-declaration.js";

function assertDeepFrozen(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

function modeOf(nodePolicy: Readonly<WakeflowWorkspaceResourceNodePolicy>): string {
  return nodePolicy.kind === "tree" ? nodePolicy.rootMode : nodePolicy.mode;
}

function processingOf(processing: Readonly<WakeflowResourceProcessingContract>): string {
  return processing.kind === "directory-container"
    ? `directory-container:${processing.materializationRecipe}`
    : `${processing.role}:${processing.allowedMutationRecipes.join("+")}`;
}

test("Codex Host Resource Catalog contains only its static profile surfaces", () => {
  const catalog = createWakeflowWorkspaceHostResourceCatalog(codexWorkspaceHostResourceProfile);
  deepEqual(
    catalog.map((entry) => ({
      declarationId: entry.declarationId,
      ownerId: entry.ownerId,
      relativePath: entry.placement.relativePath,
      tracking: `${entry.tracking.disposition}:${entry.tracking.privacy}`,
      mode: modeOf(entry.nodePolicy),
      processing: processingOf(entry.processing),
    })),
    [
      {
        declarationId: "host-runtime.codex.root",
        ownerId: "host-runtime-layout",
        relativePath: ".wakeflow-local/runtime/hosts/codex",
        tracking: "ignored:runtime-private",
        mode: "0700",
        processing: "directory-container:materialize-directory",
      },
      {
        declarationId: "host-runtime.codex.identity-root",
        ownerId: "host-runtime-layout",
        relativePath: ".wakeflow-local/runtime/hosts/codex/identity",
        tracking: "ignored:runtime-private",
        mode: "0700",
        processing: "directory-container:materialize-directory",
      },
      {
        declarationId: "host-runtime.codex.projections-root",
        ownerId: "host-runtime-layout",
        relativePath: ".wakeflow-local/runtime/hosts/codex/projections",
        tracking: "ignored:runtime-private",
        mode: "0700",
        processing: "directory-container:materialize-directory",
      },
      {
        declarationId: "host-runtime.codex.instruction",
        ownerId: "host-instruction-integration",
        relativePath: "AGENTS.md",
        tracking: "tracked:shareable",
        mode: "0644",
        processing: "managed-integration-text:exact-source-recompose",
      },
      {
        declarationId: "host-runtime.codex.instruction-lock",
        ownerId: "host-instruction-integration",
        relativePath: ".wakeflow-program-instruction-codex.lock",
        tracking: "ignored:runtime-private",
        mode: "0600",
        processing: "transaction-artifact:exclusive-create+exact-retire",
      },
      {
        declarationId: "host-runtime.codex.window-runtime-projections-root",
        ownerId: "window-runtime-projection",
        relativePath: ".wakeflow-local/runtime/hosts/codex/projections/window-runtime",
        tracking: "ignored:runtime-private",
        mode: "0700",
        processing: "directory-container:materialize-directory",
      },
      {
        declarationId: "host-runtime.codex.window-identity-root",
        ownerId: "window-host-binding",
        relativePath: ".wakeflow-local/runtime/hosts/codex/identity/window-bindings",
        tracking: "ignored:runtime-private",
        mode: "0700",
        processing: "directory-container:materialize-directory",
      },
      {
        declarationId: "host-runtime.codex.window-identity-lock",
        ownerId: "window-host-binding",
        relativePath:
          ".wakeflow-local/runtime/hosts/codex/identity/window-bindings/.registration.lock",
        tracking: "ignored:runtime-private",
        mode: "0600",
        processing: "transaction-artifact:exclusive-create+exact-retire",
      },
      {
        declarationId: "host-runtime.codex.pod-receipts-root",
        ownerId: "pod-receipts",
        relativePath: ".wakeflow-local/runtime/hosts/codex/pods",
        tracking: "ignored:runtime-private",
        mode: "0700",
        processing: "directory-container:materialize-directory",
      },
    ],
  );
  // 复审 J5：Codex 没有 operations 表面，也不再声明无人使用的 keep-live 目录。
  equal(catalog.length, 9);
  equal(
    catalog.every(
      (entry) =>
        entry.family === "host-runtime" &&
        entry.scope === "current-host" &&
        !entry.placement.relativePath?.includes("{"),
    ),
    true,
  );
  assertDeepFrozen(catalog);
  deepEqual(createWakeflowWorkspaceHostResourceCatalog(codexWorkspaceHostResourceProfile), catalog);

  let invalidProfile: unknown;
  try {
    createWakeflowWorkspaceHostResourceCatalog({});
  } catch (error: unknown) {
    invalidProfile = error;
  }
  equal(invalidProfile instanceof WakeflowWorkspaceHostResourceProfileError, true);
});

test("optional Host resources are compiled from profile values without host branches", () => {
  const catalog = createWakeflowWorkspaceHostResourceCatalog(
    claudeCodeWorkspaceHostResourceProfile,
  );
  deepEqual(
    catalog.map((entry) => ({
      declarationId: entry.declarationId,
      ownerId: entry.ownerId,
      relativePath: entry.placement.relativePath,
      tracking: `${entry.tracking.disposition}:${entry.tracking.privacy}`,
      mode: modeOf(entry.nodePolicy),
      processing: processingOf(entry.processing),
    })),
    [
      {
        declarationId: "host-runtime.claude-code.root",
        ownerId: "host-runtime-layout",
        relativePath: ".wakeflow-local/runtime/hosts/claude-code",
        tracking: "ignored:runtime-private",
        mode: "0700",
        processing: "directory-container:materialize-directory",
      },
      {
        declarationId: "host-runtime.claude-code.identity-root",
        ownerId: "host-runtime-layout",
        relativePath: ".wakeflow-local/runtime/hosts/claude-code/identity",
        tracking: "ignored:runtime-private",
        mode: "0700",
        processing: "directory-container:materialize-directory",
      },
      {
        declarationId: "host-runtime.claude-code.projections-root",
        ownerId: "host-runtime-layout",
        relativePath: ".wakeflow-local/runtime/hosts/claude-code/projections",
        tracking: "ignored:runtime-private",
        mode: "0700",
        processing: "directory-container:materialize-directory",
      },
      {
        declarationId: "host-runtime.claude-code.instruction",
        ownerId: "host-instruction-integration",
        relativePath: "CLAUDE.md",
        tracking: "tracked:shareable",
        mode: "0644",
        processing: "managed-integration-text:exact-source-recompose",
      },
      {
        declarationId: "host-runtime.claude-code.instruction-lock",
        ownerId: "host-instruction-integration",
        relativePath: ".wakeflow-program-instruction-claude-code.lock",
        tracking: "ignored:runtime-private",
        mode: "0600",
        processing: "transaction-artifact:exclusive-create+exact-retire",
      },
      {
        declarationId: "host-runtime.claude-code.window-runtime-projections-root",
        ownerId: "window-runtime-projection",
        relativePath: ".wakeflow-local/runtime/hosts/claude-code/projections/window-runtime",
        tracking: "ignored:runtime-private",
        mode: "0700",
        processing: "directory-container:materialize-directory",
      },
      {
        declarationId: "host-runtime.claude-code.window-identity-root",
        ownerId: "window-host-binding",
        relativePath: ".wakeflow-local/runtime/hosts/claude-code/identity/window-bindings",
        tracking: "ignored:runtime-private",
        mode: "0700",
        processing: "directory-container:materialize-directory",
      },
      {
        declarationId: "host-runtime.claude-code.window-identity-lock",
        ownerId: "window-host-binding",
        relativePath:
          ".wakeflow-local/runtime/hosts/claude-code/identity/window-bindings/.registration.lock",
        tracking: "ignored:runtime-private",
        mode: "0600",
        processing: "transaction-artifact:exclusive-create+exact-retire",
      },
      {
        declarationId: "host-runtime.claude-code.pod-receipts-root",
        ownerId: "pod-receipts",
        relativePath: ".wakeflow-local/runtime/hosts/claude-code/pods",
        tracking: "ignored:runtime-private",
        mode: "0700",
        processing: "directory-container:materialize-directory",
      },
      {
        declarationId: "host-runtime.claude-code.operations-root",
        ownerId: "host-runtime-layout",
        relativePath: ".wakeflow-local/runtime/hosts/claude-code/operations",
        tracking: "ignored:runtime-private",
        mode: "0700",
        processing: "directory-container:materialize-directory",
      },
      {
        declarationId: "host-runtime.claude-code.window-locators-root",
        ownerId: "window-locator",
        relativePath: ".wakeflow-local/runtime/hosts/claude-code/identity/window-locators",
        tracking: "ignored:runtime-private",
        mode: "0700",
        processing: "directory-container:materialize-directory",
      },
      {
        declarationId: "host-runtime.claude-code.settings-portable",
        ownerId: "host-settings-integration",
        relativePath: ".claude/settings.json",
        tracking: "tracked:shareable",
        mode: "0644",
        processing: "managed-integration-text:exact-source-recompose",
      },
      {
        declarationId: "host-runtime.claude-code.settings-local",
        ownerId: "host-settings-integration",
        relativePath: ".claude/settings.local.json",
        tracking: "ignored:runtime-private",
        mode: "0600",
        processing: "managed-integration-text:exact-source-recompose",
      },
      {
        declarationId: "host-runtime.claude-code.statusline-assets-root",
        ownerId: "host-statusline",
        relativePath: ".wakeflow-local/runtime/hosts/claude-code/operations/assets",
        tracking: "ignored:runtime-private",
        mode: "0700",
        processing: "directory-container:materialize-directory",
      },
      {
        declarationId: "host-runtime.claude-code.statusline-asset",
        ownerId: "host-statusline",
        relativePath: ".wakeflow-local/runtime/hosts/claude-code/operations/assets/statusline.mjs",
        tracking: "ignored:runtime-private",
        mode: "0600",
        processing: "derived-projection:deterministic-rewrite",
      },
      {
        declarationId: "host-runtime.claude-code.tmux-asset",
        ownerId: "host-tmux",
        relativePath: ".wakeflow-local/runtime/hosts/claude-code/operations/assets/tmux.mjs",
        tracking: "ignored:runtime-private",
        mode: "0600",
        processing: "derived-projection:deterministic-rewrite",
      },
    ],
  );
  // 复审 J5：定位器声明在真实目录 identity 下；activity-monitor 与 temp/prompts 不再声明。
  equal(catalog.length, 16);
  const statusline = catalog[14];
  equal(statusline?.nodePolicy.kind, "file");
  if (statusline?.nodePolicy.kind === "file") {
    equal(statusline.nodePolicy.executablePolicy, "forbidden");
  }
  equal(
    catalog.every(
      (entry) =>
        entry.nodePolicy.kind !== "file" || entry.nodePolicy.executablePolicy === "forbidden",
    ),
    true,
  );
  equal(
    catalog.every((entry) => !entry.placement.relativePath?.includes("{")),
    true,
  );
  assertDeepFrozen(catalog);

  const capabilityIndependentCodex = parseWakeflowWorkspaceHostResourceProfile({
    kind: "WakeflowWorkspaceHostResourceProfile",
    hostId: "codex",
    runtimeDirectoryName: "codex",
    instructionFileName: "CUSTOM.md",
    surfaces: {
      windowIdentity: false,
      podReceipts: false,
      worktree: {
        launch: "git-worktree",
        attachedDirectories: "prompt-path",
      },
      windowLocator: true,
      settingsIntegration: {
        portablePath: ".tool/settings.json",
        localPath: ".tool/settings.local.json",
      },
      statuslineAsset: { fileName: "statusline.mjs" },
      tmuxAsset: null,
      runtimeStaleness: "unverified",
      runtimeRefresh: "user-app-restart",
    },
    launch: { kind: "project-thread" },
  });
  deepEqual(
    createWakeflowWorkspaceHostResourceCatalog(capabilityIndependentCodex).map(
      (entry) => entry.declarationId,
    ),
    [
      "host-runtime.codex.root",
      "host-runtime.codex.identity-root",
      "host-runtime.codex.projections-root",
      "host-runtime.codex.instruction",
      "host-runtime.codex.instruction-lock",
      "host-runtime.codex.window-runtime-projections-root",
      "host-runtime.codex.operations-root",
      "host-runtime.codex.window-locators-root",
      "host-runtime.codex.settings-portable",
      "host-runtime.codex.settings-local",
      "host-runtime.codex.statusline-assets-root",
      "host-runtime.codex.statusline-asset",
    ],
  );
});
