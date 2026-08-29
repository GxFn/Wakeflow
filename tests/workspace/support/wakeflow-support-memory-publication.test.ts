import { deepEqual, equal } from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import {
  computeWakeflowConfigV3Digest,
  parseWakeflowConfigV3,
} from "../../../src/configuration/wakeflow-config-v3.js";
import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import {
  durableAtomicFileStageRef,
  issueDurableAtomicFileStageAddress,
  releaseDurableAtomicFileStageAddress,
} from "../../../src/foundation/filesystem/durable-atomic-file-stage-address.js";
import {
  createFileCandidateDurably,
} from "../../../src/foundation/filesystem/durable-file-candidate.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  codexWorkspaceHostResourceProfile,
} from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import {
  createWakeflowManagedSupportResourceCatalog,
} from "../../../src/workspace/support/wakeflow-managed-support-resource-catalog.js";
import {
  materializeWakeflowManagedSupportRoot,
} from "../../../src/workspace/support/wakeflow-managed-support-root-materialization.js";
import {
  createWakeflowSupportMemoryAuthority,
} from "../../../src/workspace/support/wakeflow-support-memory-authority.js";
import {
  publishWakeflowSupportMemory,
  WakeflowSupportMemoryPublicationError,
  type WakeflowSupportMemoryPublicationErrorReason,
} from "../../../src/workspace/support/wakeflow-support-memory-publication.js";
import {
  recoverWakeflowSupportMemory,
} from "../../../src/workspace/support/wakeflow-support-memory-recovery.js";
import {
  createMinimalWakeflowConfigV3,
} from "../../configuration/wakeflow-config-v3.fixture.js";

const DESIGN_ID = "surface_33333333-3333-4333-8333-333333333333";

async function fixture(t: TestContext) {
  const container = realpathSync(mkdtempSync(path.join(
    os.tmpdir(),
    "wakeflow-support-memory-publication-",
  )));
  const workspacePath = path.join(container, "Workspace");
  mkdirSync(workspacePath, { mode: 0o755 });
  const workspaceRoot = await RootedDirectory.open(workspacePath);
  const desired = config("en");
  const catalog = createWakeflowManagedSupportResourceCatalog(
    desired,
    codexWorkspaceHostResourceProfile,
  );
  await materializeWakeflowManagedSupportRoot(workspaceRoot, {
    config: desired,
    expectedConfigDigest: computeWakeflowConfigV3Digest(desired),
    profile: codexWorkspaceHostResourceProfile,
    expectedCatalogDigest: catalog.catalogDigest,
    surfaceId: DESIGN_ID,
  });
  const supportPath = path.join(workspacePath, "Design");
  const supportRoot = await RootedDirectory.open(supportPath);
  t.after(async () => {
    await supportRoot.close();
    await workspaceRoot.close();
    rmSync(container, { recursive: true, force: true });
  });
  return Object.freeze({
    workspacePath,
    supportPath,
    memoryPath: path.join(supportPath, "AGENTS.md"),
    workspaceRoot,
    supportRoot,
  });
}

function config(language: "en" | "zh-Hans") {
  const value = createMinimalWakeflowConfigV3();
  (value.presentation as Record<string, unknown>).language = language;
  return parseWakeflowConfigV3(value);
}

function request(
  currentConfig: ReturnType<typeof config> | null,
  desiredConfig: ReturnType<typeof config>,
) {
  const catalog = createWakeflowManagedSupportResourceCatalog(
    desiredConfig,
    codexWorkspaceHostResourceProfile,
  );
  return Object.freeze({
    currentConfig,
    expectedCurrentConfigDigest: currentConfig === null
      ? null
      : computeWakeflowConfigV3Digest(currentConfig),
    desiredConfig,
    expectedDesiredConfigDigest: computeWakeflowConfigV3Digest(desiredConfig),
    profile: codexWorkspaceHostResourceProfile,
    expectedCatalogDigest: catalog.catalogDigest,
    surfaceId: DESIGN_ID,
  });
}

async function expectPublicationError(
  action: () => Promise<unknown>,
  reason: WakeflowSupportMemoryPublicationErrorReason,
  pathValue: string,
): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof WakeflowSupportMemoryPublicationError, true);
  if (caught instanceof WakeflowSupportMemoryPublicationError) {
    equal(caught.code, "wakeflow-support-memory-publication");
    equal(caught.reason, reason);
    equal(caught.path, pathValue);
  }
}

test("Support memory publication atomically creates once and stays current", async (t) => {
  const workspace = await fixture(t);
  const desired = config("en");
  const operation = request(null, desired);
  const created = await publishWakeflowSupportMemory(
    workspace.workspaceRoot,
    workspace.supportRoot,
    operation,
  );
  equal(created.disposition, "created");
  equal(created.effect?.publication, "created");
  equal(created.inspection.status, "current");
  equal(statSync(workspace.memoryPath).mode & 0o777, 0o644);
  const bytes = readFileSync(workspace.memoryPath);
  const node = statSync(workspace.memoryPath, { bigint: true });

  const current = await publishWakeflowSupportMemory(
    workspace.workspaceRoot,
    workspace.supportRoot,
    operation,
  );
  equal(current.disposition, "current");
  equal(current.effect, null);
  deepEqual(readFileSync(workspace.memoryPath), bytes);
  equal(statSync(workspace.memoryPath, { bigint: true }).ino, node.ino);
});

test("Support memory publication replaces only an admitted prior language", async (t) => {
  const workspace = await fixture(t);
  const current = config("en");
  const desired = config("zh-Hans");
  const currentAuthority = createWakeflowSupportMemoryAuthority(
    current,
    codexWorkspaceHostResourceProfile,
    DESIGN_ID,
  );
  writeFileSync(workspace.memoryPath, currentAuthority.body, { mode: 0o644 });
  const sourceDigest = computeSha256Digest(readFileSync(workspace.memoryPath));

  const replaced = await publishWakeflowSupportMemory(
    workspace.workspaceRoot,
    workspace.supportRoot,
    request(current, desired),
  );
  equal(replaced.disposition, "replaced");
  equal(replaced.effect?.publication, "replaced");
  if (replaced.effect?.publication === "replaced") {
    equal(replaced.effect.previous.digest, sourceDigest);
  }
  equal(readFileSync(workspace.memoryPath, "utf8").includes(
    "Wakeflow Design 支持窗口",
  ), true);
});

test("Support memory publication preserves unknown whole-file bytes", async (t) => {
  const workspace = await fixture(t);
  const desired = config("en");
  const unknown = Buffer.from("# User-owned unknown file\n");
  writeFileSync(workspace.memoryPath, unknown, { mode: 0o644 });
  await expectPublicationError(
    () => publishWakeflowSupportMemory(
      workspace.workspaceRoot,
      workspace.supportRoot,
      request(desired, desired),
    ),
    "source-invalid",
    "$source",
  );
  deepEqual(readFileSync(workspace.memoryPath), unknown);
  equal(readdirSync(workspace.supportPath).some((name) => (
    name.startsWith(".wakeflow-atomic-")
  )), false);
});

test("Support memory recovery retires an inactive stage and republishes", async (t) => {
  const workspace = await fixture(t);
  const current = config("en");
  const desired = config("zh-Hans");
  const currentAuthority = createWakeflowSupportMemoryAuthority(
    current,
    codexWorkspaceHostResourceProfile,
    DESIGN_ID,
  );
  const desiredAuthority = createWakeflowSupportMemoryAuthority(
    desired,
    codexWorkspaceHostResourceProfile,
    DESIGN_ID,
  );
  writeFileSync(workspace.memoryPath, currentAuthority.body, { mode: 0o644 });
  const desiredBytes = Buffer.from(desiredAuthority.body);
  const address = issueDurableAtomicFileStageAddress(
    "replace",
    "AGENTS.md",
    computeSha256Digest(desiredBytes),
    0o644,
  );
  const stageRef = durableAtomicFileStageRef("AGENTS.md", address);
  let released = false;
  try {
    await createFileCandidateDurably(
      workspace.supportRoot,
      stageRef,
      desiredBytes,
      { mode: 0o644 },
    );
    releaseDurableAtomicFileStageAddress(address);
    released = true;

    const recovered = await recoverWakeflowSupportMemory(
      workspace.workspaceRoot,
      workspace.supportRoot,
      request(current, desired),
    );
    equal(recovered.disposition, "recovered");
    equal(recovered.stageRecovery.retiredStageCount, 1);
    equal(recovered.publication.disposition, "replaced");
    equal(existsSync(path.join(workspace.supportPath, stageRef)), false);
    equal(readFileSync(workspace.memoryPath, "utf8"), desiredAuthority.body);
  } finally {
    if (!released) releaseDurableAtomicFileStageAddress(address);
  }
});
