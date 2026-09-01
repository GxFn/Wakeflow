import { deepEqual, equal, rejects } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import {
  computeWakeflowConfigV3Digest,
  parseWakeflowConfigV3,
} from "../../../src/configuration/wakeflow-config-v3.js";
import { publishWakeflowConfigAuthority } from "../../../src/configuration/wakeflow-config-authority-publication.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { LedgerAuthorityStore } from "../../../src/governance/ledger/ledger-authority-store.js";
import { initializeFreshTodoCollection } from "../../../src/governance/todo/todo-collection-initialization.js";
import { claudeCodeWorkspaceHostResourceProfile } from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { recomposeWakeflowWorkspaceGitignore } from "../../../src/workspace/managed-integration/wakeflow-gitignore-recomposition.js";
import { recomposeWakeflowProgramInstruction } from "../../../src/workspace/managed-integration/wakeflow-program-instruction-recomposition.js";
import { createWakeflowWorkspaceStaticResourceMatrix } from "../../../src/workspace/wakeflow-workspace-static-resource-matrix.js";
import { materializeWakeflowSharedCoordinationLayout } from "../../../src/workspace/wakeflow-shared-coordination-layout.js";
import {
  previewWakeflowStaticMaterialization,
  WakeflowStaticMaterializationPreviewError,
} from "../../../src/workspace/maintenance/wakeflow-static-materialization-preview.js";
import { publishWakeflowActiveWorkspaceProjection } from "../../../src/workspace/active/wakeflow-active-workspace-projection-publication.js";
import { createWakeflowManagedSupportResourceCatalog } from "../../../src/workspace/support/wakeflow-managed-support-resource-catalog.js";
import { materializeWakeflowManagedSupportRoot } from "../../../src/workspace/support/wakeflow-managed-support-root-materialization.js";
import { publishWakeflowSupportMemory } from "../../../src/workspace/support/wakeflow-support-memory-publication.js";
import { createMinimalWakeflowConfigV3 } from "../../configuration/wakeflow-config-v3.fixture.js";

const PROFILES = Object.freeze([
  codexWorkspaceHostResourceProfile,
  claudeCodeWorkspaceHostResourceProfile,
]);

async function fixture(t: TestContext) {
  const absolutePath = realpathSync(
    mkdtempSync(
      path.join(os.tmpdir(), "wakeflow-static-materialization-preview-"),
    ),
  );
  const initialized = spawnSync("git", ["init", "--quiet"], {
    cwd: absolutePath,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (initialized.status !== 0) {
    throw new Error("Disposable Git repository initialization failed.");
  }
  const root = await RootedDirectory.open(absolutePath);
  t.after(async () => {
    await root.close();
    rmSync(absolutePath, { recursive: true, force: true });
  });
  return Object.freeze({ absolutePath, root });
}

function desiredConfig(language: "en" | "zh-Hans" = "en") {
  const value = createMinimalWakeflowConfigV3();
  (value.presentation as Record<string, unknown>).language = language;
  (value.storage as Record<string, unknown>).ledgerRoot = "Ledger";
  return parseWakeflowConfigV3(value);
}

function request(
  action: "fresh-initialize" | "reconfigure" | "reconcile",
  desired: unknown | null,
) {
  return Object.freeze({
    action,
    desiredConfig: desired,
    currentHostProfile: codexWorkspaceHostResourceProfile,
    hostProfiles: PROFILES,
  });
}

function materializeCoreProtocol(root: string): void {
  mkdirSync(path.join(root, ".wakeflow-active", "current"), {
    mode: 0o700,
    recursive: true,
  });
  mkdirSync(
    path.join(
      root,
      ".wakeflow-local",
      "runtime",
      "maintenance",
      "transactions",
    ),
    { mode: 0o700, recursive: true },
  );
  for (const relative of [
    ".wakeflow-active",
    ".wakeflow-active/current",
    ".wakeflow-local",
    ".wakeflow-local/runtime",
    ".wakeflow-local/runtime/maintenance",
    ".wakeflow-local/runtime/maintenance/transactions",
  ]) {
    // recursive mkdir 受进程 umask 影响；测试显式恢复协议 mode。
    const candidate = path.join(root, ...relative.split("/"));
    chmodSync(candidate, 0o700);
  }
}

async function installCurrentStaticSurface(
  fixtureValue: Awaited<ReturnType<typeof fixture>>,
  config: ReturnType<typeof desiredConfig>,
): Promise<void> {
  materializeCoreProtocol(fixtureValue.absolutePath);
  await materializeWakeflowSharedCoordinationLayout(fixtureValue.root, {
    mode: "ensure",
  });
  await initializeFreshTodoCollection(fixtureValue.root, {
    recoveringFreshCollection: false,
  });
  await publishWakeflowActiveWorkspaceProjection(
    fixtureValue.root,
    {
      desiredConfig: config,
      expectedDesiredConfigDigest: computeWakeflowConfigV3Digest(config),
    },
    { recoveringAffectedPublication: false },
  );
  const matrix = createWakeflowWorkspaceStaticResourceMatrix(
    codexWorkspaceHostResourceProfile,
  );
  mkdirSync(path.join(fixtureValue.absolutePath, "Ledger"), { mode: 0o755 });
  chmodSync(path.join(fixtureValue.absolutePath, "Ledger"), 0o755);
  const ledgerRoot = await RootedDirectory.open(
    path.join(fixtureValue.absolutePath, "Ledger"),
  );
  try {
    await new LedgerAuthorityStore(ledgerRoot).initialize({
      freshLedger: true,
    });
  } finally {
    await ledgerRoot.close();
  }
  const catalog = createWakeflowManagedSupportResourceCatalog(
    config,
    codexWorkspaceHostResourceProfile,
  );
  for (const surface of config.topology.supportSurfaces) {
    if (surface.ownership !== "wakeflow-managed") continue;
    await materializeWakeflowManagedSupportRoot(fixtureValue.root, {
      config,
      expectedConfigDigest: computeWakeflowConfigV3Digest(config),
      profile: codexWorkspaceHostResourceProfile,
      expectedCatalogDigest: catalog.catalogDigest,
      surfaceId: surface.surfaceId,
    });
    const supportPath = path.resolve(
      fixtureValue.absolutePath,
      ...surface.path.split("/"),
    );
    const supportRoot = await RootedDirectory.open(supportPath);
    try {
      await publishWakeflowSupportMemory(fixtureValue.root, supportRoot, {
        currentConfig: null,
        expectedCurrentConfigDigest: null,
        desiredConfig: config,
        expectedDesiredConfigDigest: computeWakeflowConfigV3Digest(config),
        profile: codexWorkspaceHostResourceProfile,
        expectedCatalogDigest: catalog.catalogDigest,
        surfaceId: surface.surfaceId,
      });
    } finally {
      await supportRoot.close();
    }
  }
  await recomposeWakeflowWorkspaceGitignore(fixtureValue.root, {
    matrix,
    expectedMatrixDigest: matrix.matrixDigest,
    hostProfiles: PROFILES,
  });
  await recomposeWakeflowProgramInstruction(fixtureValue.root, {
    matrix,
    expectedMatrixDigest: matrix.matrixDigest,
    profile: codexWorkspaceHostResourceProfile,
    currentConfig: null,
    expectedCurrentConfigDigest: null,
    desiredConfig: config,
    expectedDesiredConfigDigest: computeWakeflowConfigV3Digest(config),
  });
  await publishWakeflowConfigAuthority(fixtureValue.root, config);
}

test("fresh static preview is deterministic, ordered and strictly read-only", async (t) => {
  const workspace = await fixture(t);
  const before = readdirSync(workspace.absolutePath).sort();
  const desired = desiredConfig();
  const preview = await previewWakeflowStaticMaterialization(
    workspace.root,
    request("fresh-initialize", desired),
  );

  equal(preview.executionBoundary, "preview-only");
  equal(preview.status, "ready");
  deepEqual(preview.blockerCodes, []);
  deepEqual(
    preview.steps.map((entry) => entry.kind),
    [
      "materialize-local-protocol",
      "materialize-shared-coordination-layout",
      "materialize-active-layout",
      "initialize-todo-collection",
      "publish-fresh-active-workspace-projection",
      "materialize-ledger-layout",
      "publish-unregistered-window-runtime",
      "materialize-host-capability-layout",
      "materialize-support-root",
      "materialize-support-root",
      "recompose-gitignore",
      "recompose-program-instruction",
      "publish-support-memory",
      "publish-support-memory",
      "publish-config",
    ],
  );
  const configStep = preview.steps.at(-1);
  const activeProjectionStep = preview.steps.find(
    (entry) => entry.kind === "publish-fresh-active-workspace-projection",
  );
  deepEqual(activeProjectionStep?.dependsOn, ["active:todo-collection"]);
  equal(configStep?.kind, "publish-config");
  equal(configStep?.dependsOn.length, 14);
  equal(/^sha256:[0-9a-f]{64}$/u.test(preview.planDigest), true);
  deepEqual(
    await previewWakeflowStaticMaterialization(
      workspace.root,
      request("fresh-initialize", desired),
    ),
    preview,
  );
  deepEqual(readdirSync(workspace.absolutePath).sort(), before);
  equal(
    existsSync(path.join(workspace.absolutePath, "wakeflow.config.json")),
    false,
  );
});

test("static preview preserves cancellation as an operation outcome", async (t) => {
  const workspace = await fixture(t);
  const controller = new AbortController();
  controller.abort();
  await rejects(
    previewWakeflowStaticMaterialization(workspace.root, {
      ...request("fresh-initialize", desiredConfig()),
      signal: controller.signal,
    }),
    (error: unknown) =>
      error instanceof WakeflowStaticMaterializationPreviewError &&
      error.reason === "aborted",
  );
});

test("fresh static preview blocks even an empty pre-existing managed Support root", async (t) => {
  const workspace = await fixture(t);
  mkdirSync(path.join(workspace.absolutePath, "Design"), { mode: 0o755 });
  const preview = await previewWakeflowStaticMaterialization(
    workspace.root,
    request("fresh-initialize", desiredConfig()),
  );
  equal(preview.status, "blocked");
  equal(preview.blockerCodes.includes("fresh-support-root-present"), true);
  equal(
    preview.steps.some(
      (entry) =>
        entry.stepId ===
        "support-root:surface_33333333-3333-4333-8333-333333333333",
    ),
    false,
  );
  equal(
    existsSync(path.join(workspace.absolutePath, "Design", "AGENTS.md")),
    false,
  );
});

test("fresh static preview never adopts a pre-existing Ledger root", async (t) => {
  const workspace = await fixture(t);
  mkdirSync(path.join(workspace.absolutePath, "Ledger"), { mode: 0o755 });
  const preview = await previewWakeflowStaticMaterialization(
    workspace.root,
    request("fresh-initialize", desiredConfig()),
  );
  equal(preview.status, "blocked");
  equal(preview.blockerCodes.includes("fresh-ledger-root-present"), true);
  equal(
    preview.steps.some((entry) => entry.kind === "materialize-ledger-layout"),
    false,
  );
});

test("placement-stable reconfigure plans derived files before Config activation", async (t) => {
  const workspace = await fixture(t);
  const current = desiredConfig("en");
  await installCurrentStaticSurface(workspace, current);
  const desired = desiredConfig("zh-Hans");
  const preview = await previewWakeflowStaticMaterialization(
    workspace.root,
    request("reconfigure", desired),
  );
  equal(preview.status, "ready");
  deepEqual(
    preview.steps.map((entry) => entry.kind),
    [
      "publish-fresh-active-workspace-projection",
      "recompose-program-instruction",
      "publish-support-memory",
      "publish-support-memory",
      "publish-config",
    ],
  );
  const configStep = preview.steps.at(-1);
  equal(configStep?.kind, "publish-config");
  deepEqual(
    configStep?.dependsOn,
    preview.steps.slice(0, -1).map((entry) => entry.stepId),
  );

  const reconciled = await previewWakeflowStaticMaterialization(
    workspace.root,
    request("reconcile", null),
  );
  equal(reconciled.status, "ready");
  deepEqual(reconciled.steps, []);
  equal(reconciled.currentConfigDigest, reconciled.desiredConfigDigest);

  const moved = createMinimalWakeflowConfigV3();
  (moved.storage as Record<string, unknown>).ledgerRoot = "Ledger";
  const design = (
    moved.topology as {
      supportSurfaces: Record<string, unknown>[];
    }
  ).supportSurfaces[0];
  if (design === undefined) throw new Error("Expected Design surface.");
  design.path = "DesignMoved";
  const blocked = await previewWakeflowStaticMaterialization(
    workspace.root,
    request("reconfigure", parseWakeflowConfigV3(moved)),
  );
  equal(blocked.status, "blocked");
  equal(
    blocked.blockerCodes.includes("reconfigure-layout-change-unsupported"),
    true,
  );

  chmodSync(path.join(workspace.absolutePath, "Ledger", "transactions"), 0o755);
  const driftedLedger = await previewWakeflowStaticMaterialization(
    workspace.root,
    request("reconcile", null),
  );
  equal(driftedLedger.status, "blocked");
  equal(driftedLedger.blockerCodes.includes("ledger-layout-conflict"), true);
  chmodSync(path.join(workspace.absolutePath, "Ledger", "transactions"), 0o700);

  rmSync(path.join(workspace.absolutePath, "Ledger"), {
    recursive: true,
    force: true,
  });
  const missingLedger = await previewWakeflowStaticMaterialization(
    workspace.root,
    request("reconcile", null),
  );
  equal(missingLedger.status, "blocked");
  equal(missingLedger.blockerCodes.includes("ledger-root-missing"), true);
});
