import { deepEqual, equal, notEqual } from "node:assert/strict";
import { test } from "node:test";

import { parseWakeflowConfig } from "../../../src/configuration/wakeflow-config.js";
import { computeCanonicalJsonSha256Digest } from "../../../src/foundation/crypto/canonical-json-sha256.js";
import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";
import { claudeCodeWorkspaceHostResourceProfile } from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import {
  createWakeflowExternalInstructionBodyAuthority,
  listWakeflowExternalInstructionTargets,
  parseWakeflowExternalInstructionTarget,
  wakeflowExternalInstructionPlacementKey,
  wakeflowExternalInstructionTargetKey,
  WakeflowExternalInstructionBodyAuthorityError,
  type WakeflowExternalInstructionBodyAuthorityErrorReason,
} from "../../../src/workspace/managed-integration/wakeflow-external-instruction-body-authority.js";
import {
  inspectWakeflowManagedTextEnvelope,
  recomposeWakeflowManagedTextEnvelope,
  WAKEFLOW_MANAGED_TEXT_MARKER_PREFIX,
} from "../../../src/workspace/managed-integration/wakeflow-managed-text-envelope.js";
import { createMinimalWakeflowConfig } from "../../configuration/wakeflow-config.fixture.js";
import {
  createManagedBlockWakeflowConfig,
  EXTERNAL_DESIGN_SURFACE_ID,
  EXTERNAL_DESIGN_SURFACE_TARGET,
  MANAGED_BLOCK_REPOSITORY_ID,
  MANAGED_BLOCK_REPOSITORY_TARGET,
  SECOND_PRODUCT_WINDOW_ID,
} from "./wakeflow-external-instruction.fixture.js";

/**
 * 外部根托管块正文权威：managed-block 仓库与 external-owned 支撑面各一份正文，只引用
 * primary pod 的持久窗口；owner-managed 与 wakeflow-managed 的根不产生 target。
 */

function assertDeepFrozen(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

function expectAuthorityError(
  action: () => unknown,
  reason: WakeflowExternalInstructionBodyAuthorityErrorReason,
  path?: string,
): void {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof WakeflowExternalInstructionBodyAuthorityError, true);
  if (caught instanceof WakeflowExternalInstructionBodyAuthorityError) {
    equal(caught.code, "wakeflow-external-instruction-body-authority");
    equal(caught.reason, reason);
    if (path !== undefined) equal(caught.path, path);
  }
}

test("external instruction targets list only managed-block repositories and external-owned managed-block surfaces", () => {
  deepEqual(listWakeflowExternalInstructionTargets(createMinimalWakeflowConfig()), []);
  const targets = listWakeflowExternalInstructionTargets(
    createManagedBlockWakeflowConfig(),
  );
  deepEqual(targets, [MANAGED_BLOCK_REPOSITORY_TARGET, EXTERNAL_DESIGN_SURFACE_TARGET]);
  assertDeepFrozen(targets);
  deepEqual(
    targets.map(wakeflowExternalInstructionTargetKey),
    [
      `repository:${MANAGED_BLOCK_REPOSITORY_ID}`,
      `support-surface:${EXTERNAL_DESIGN_SURFACE_ID}`,
    ],
  );
  deepEqual(
    targets.map(wakeflowExternalInstructionPlacementKey),
    [
      `repository.${MANAGED_BLOCK_REPOSITORY_ID}.root`,
      `support.${EXTERNAL_DESIGN_SURFACE_ID}.root`,
    ],
  );
  deepEqual(
    parseWakeflowExternalInstructionTarget(MANAGED_BLOCK_REPOSITORY_TARGET),
    MANAGED_BLOCK_REPOSITORY_TARGET,
  );
  expectAuthorityError(
    () => parseWakeflowExternalInstructionTarget({ kind: "repository" }),
    "input",
    "$target",
  );
  expectAuthorityError(
    () => parseWakeflowExternalInstructionTarget({
      kind: "support-surface",
      surfaceId: MANAGED_BLOCK_REPOSITORY_ID,
    }),
    "input",
    "$target.surfaceId",
  );
});

test("repository instruction authority renders deterministic English content from the primary pod", () => {
  const config = createManagedBlockWakeflowConfig();
  const authority = createWakeflowExternalInstructionBodyAuthority(
    config,
    codexWorkspaceHostResourceProfile,
    MANAGED_BLOCK_REPOSITORY_TARGET,
  );
  equal(authority.kind, "WakeflowExternalInstructionBodyAuthority");
  equal(authority.schemaVersion, 1);
  equal(authority.hostId, "codex");
  equal(authority.instructionFileName, "AGENTS.md");
  equal(authority.language, "en");
  equal(authority.targetKey, `repository:${MANAGED_BLOCK_REPOSITORY_ID}`);
  deepEqual(authority.target, MANAGED_BLOCK_REPOSITORY_TARGET);
  deepEqual(authority.windowIds, [
    "window_88888888-8888-4888-8888-888888888888",
    SECOND_PRODUCT_WINDOW_ID,
  ]);
  for (const expected of [
    "## Wakeflow Repository Instructions\n",
    "### Stable identity",
    "### Durable responsibility windows",
    "### Exact assignment rule",
    "### Repository boundary",
    "### Safety boundary",
    `\`"${MANAGED_BLOCK_REPOSITORY_ID}"\``,
    "`\"Product source responsibility root.\"`",
    "- `\"window_88888888-8888-4888-8888-888888888888\"`: `\"Product A\"`\n",
    `- \`"${SECOND_PRODUCT_WINDOW_ID}"\`: \`"Product A docs"\` (\`"Documentation lane."\`)\n`,
    "`\".wakeflow-active/\"`",
    "`\".wakeflow-local/\"`",
  ]) {
    equal(authority.body.includes(expected), true, expected);
  }
  equal(
    authority.body.indexOf("window_88888888")
      < authority.body.indexOf(SECOND_PRODUCT_WINDOW_ID),
    true,
  );
  equal(authority.body.includes(WAKEFLOW_MANAGED_TEXT_MARKER_PREFIX), false);
  equal(authority.body.endsWith("\n"), true);
  equal(authority.body.endsWith("\n\n"), false);
  equal(authority.bodyDigest, computeSha256Digest(encodeUtf8(authority.body)));
  equal(
    authority.authorityDigest,
    computeCanonicalJsonSha256Digest({
      kind: "WakeflowExternalInstructionBodyAuthorityDigestBasis",
      schemaVersion: 1,
      programId: "program_11111111-1111-4111-8111-111111111111",
      targetKey: authority.targetKey,
      hostId: "codex",
      instructionFileName: "AGENTS.md",
      language: "en",
      windowIds: [...authority.windowIds],
      bodyDigest: authority.bodyDigest,
    }),
  );
  deepEqual(authority.envelopeTarget, {
    component: "repository-instruction",
    owner: "host-instruction-integration",
    body: authority.body,
  });
  assertDeepFrozen(authority);

  const envelope = recomposeWakeflowManagedTextEnvelope(
    new Uint8Array(),
    authority.envelopeTarget,
  );
  const inspected = inspectWakeflowManagedTextEnvelope(envelope.bytes);
  equal(inspected.kind, "managed");
  if (inspected.kind === "managed") {
    equal(inspected.component, "repository-instruction");
    equal(inspected.body, authority.body);
  }

  const claude = createWakeflowExternalInstructionBodyAuthority(
    config,
    claudeCodeWorkspaceHostResourceProfile,
    MANAGED_BLOCK_REPOSITORY_TARGET,
  );
  equal(claude.instructionFileName, "CLAUDE.md");
  notEqual(claude.authorityDigest, authority.authorityDigest);
  deepEqual(
    createWakeflowExternalInstructionBodyAuthority(
      parseWakeflowConfig(config),
      codexWorkspaceHostResourceProfile,
      MANAGED_BLOCK_REPOSITORY_TARGET,
    ),
    authority,
  );
});

test("pod records outside the primary pod do not change the repository instruction authority", () => {
  const before = createWakeflowExternalInstructionBodyAuthority(
    createManagedBlockWakeflowConfig(),
    codexWorkspaceHostResourceProfile,
    MANAGED_BLOCK_REPOSITORY_TARGET,
  );
  const withPod = createManagedBlockWakeflowConfig();
  const topology = withPod.topology as { windows: Record<string, unknown>[] };
  const podId = "pod_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const windowIds = {
    controller: "window_c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1",
    design: "window_c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2",
    test: "window_c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3",
    product: "window_c4c4c4c4-c4c4-4c4c-8c4c-c4c4c4c4c4c4",
  };
  topology.windows.push(
    {
      windowId: windowIds.controller,
      podId,
      role: "controller",
      displayName: "Controller",
      root: { kind: "program" },
    },
    {
      windowId: windowIds.design,
      podId,
      role: "design",
      displayName: "Design",
      root: { kind: "support-surface", surfaceId: EXTERNAL_DESIGN_SURFACE_ID },
    },
    {
      windowId: windowIds.test,
      podId,
      role: "test",
      displayName: "Test",
      root: {
        kind: "support-surface",
        surfaceId: "surface_44444444-4444-4444-8444-444444444444",
      },
    },
    {
      windowId: windowIds.product,
      podId,
      role: "product",
      displayName: "Product A (feature)",
      root: { kind: "repository", repositoryId: MANAGED_BLOCK_REPOSITORY_ID },
    },
  );
  (withPod.pods as Record<string, unknown>[]).push({
    podId,
    name: "feature",
    placement: "worktree",
    lifecycle: "open",
    worktrees: [
      {
        repositoryId: MANAGED_BLOCK_REPOSITORY_ID,
        windowId: windowIds.product,
        suggestedName: "wakeflow-feature",
      },
    ],
    closing: null,
  });
  const after = createWakeflowExternalInstructionBodyAuthority(
    withPod,
    codexWorkspaceHostResourceProfile,
    MANAGED_BLOCK_REPOSITORY_TARGET,
  );
  equal(after.authorityDigest, before.authorityDigest);
  equal(after.body, before.body);
  equal(after.body.includes(windowIds.product), false);
  const surface = createWakeflowExternalInstructionBodyAuthority(
    withPod,
    codexWorkspaceHostResourceProfile,
    EXTERNAL_DESIGN_SURFACE_TARGET,
  );
  deepEqual(surface.windowIds, ["window_66666666-6666-4666-8666-666666666666"]);
});

test("external support surface instruction authority renders the Design role for the primary window", () => {
  const authority = createWakeflowExternalInstructionBodyAuthority(
    createManagedBlockWakeflowConfig(),
    codexWorkspaceHostResourceProfile,
    EXTERNAL_DESIGN_SURFACE_TARGET,
  );
  equal(authority.targetKey, `support-surface:${EXTERNAL_DESIGN_SURFACE_ID}`);
  deepEqual(authority.windowIds, ["window_66666666-6666-4666-8666-666666666666"]);
  for (const expected of [
    "## Wakeflow Design Support Instructions\n",
    "### Stable identity",
    "### Authority boundary",
    "### Design role",
    "### Surface boundary",
    "### Safety boundary",
    `\`"${EXTERNAL_DESIGN_SURFACE_ID}"\``,
    "`\"Externally owned design space.\"`",
    "`\"window_66666666-6666-4666-8666-666666666666\"`",
    "`wakeflow-design`",
  ]) {
    equal(authority.body.includes(expected), true, expected);
  }
  equal(authority.body.includes("### Test role"), false);
  deepEqual(authority.envelopeTarget, {
    component: "support-instruction",
    owner: "host-instruction-integration",
    body: authority.body,
  });
  assertDeepFrozen(authority);
});

test("external instruction authority renders Simplified Chinese only from the persisted language", () => {
  const repository = createWakeflowExternalInstructionBodyAuthority(
    createManagedBlockWakeflowConfig("zh-Hans"),
    claudeCodeWorkspaceHostResourceProfile,
    MANAGED_BLOCK_REPOSITORY_TARGET,
  );
  equal(repository.language, "zh-Hans");
  for (const expected of [
    "## Wakeflow 仓库指令\n",
    "### 稳定身份",
    "### 持久职责窗口",
    "### 精确分配规则",
    "### 仓库边界",
    "### 安全边界",
    "`\"CLAUDE.md\"`",
  ]) {
    equal(repository.body.includes(expected), true, expected);
  }
  const surface = createWakeflowExternalInstructionBodyAuthority(
    createManagedBlockWakeflowConfig("zh-Hans"),
    claudeCodeWorkspaceHostResourceProfile,
    EXTERNAL_DESIGN_SURFACE_TARGET,
  );
  for (const expected of [
    "## Wakeflow Design 支持指令\n",
    "### 权威边界",
    "### Design 职责",
    "### 支撑面边界",
    "### 安全边界",
  ]) {
    equal(surface.body.includes(expected), true, expected);
  }
  notEqual(
    repository.authorityDigest,
    createWakeflowExternalInstructionBodyAuthority(
      createManagedBlockWakeflowConfig("en"),
      claudeCodeWorkspaceHostResourceProfile,
      MANAGED_BLOCK_REPOSITORY_TARGET,
    ).authorityDigest,
  );
});

test("external instruction authority rejects targets outside the managed-block policy", () => {
  const ownerManaged = createMinimalWakeflowConfig();
  expectAuthorityError(
    () => createWakeflowExternalInstructionBodyAuthority(
      ownerManaged,
      codexWorkspaceHostResourceProfile,
      MANAGED_BLOCK_REPOSITORY_TARGET,
    ),
    "target",
    "$target.repositoryId",
  );
  expectAuthorityError(
    () => createWakeflowExternalInstructionBodyAuthority(
      ownerManaged,
      codexWorkspaceHostResourceProfile,
      EXTERNAL_DESIGN_SURFACE_TARGET,
    ),
    "target",
    "$target.surfaceId",
  );
  expectAuthorityError(
    () => createWakeflowExternalInstructionBodyAuthority(
      createManagedBlockWakeflowConfig(),
      codexWorkspaceHostResourceProfile,
      {
        kind: "repository",
        repositoryId: "repository_dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      },
    ),
    "target",
    "$target.repositoryId",
  );
  expectAuthorityError(
    () => createWakeflowExternalInstructionBodyAuthority(
      createManagedBlockWakeflowConfig(),
      codexWorkspaceHostResourceProfile,
      { kind: "surface", surfaceId: EXTERNAL_DESIGN_SURFACE_ID },
    ),
    "input",
    "$target",
  );
  expectAuthorityError(
    () => createWakeflowExternalInstructionBodyAuthority(
      { kind: "WakeflowConfig" },
      codexWorkspaceHostResourceProfile,
      MANAGED_BLOCK_REPOSITORY_TARGET,
    ),
    "config",
  );
  expectAuthorityError(
    () => createWakeflowExternalInstructionBodyAuthority(
      createManagedBlockWakeflowConfig(),
      { hostId: "codex" },
      MANAGED_BLOCK_REPOSITORY_TARGET,
    ),
    "profile",
  );
});
