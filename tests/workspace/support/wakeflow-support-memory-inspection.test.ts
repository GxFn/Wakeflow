import { deepEqual, equal } from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import {
  computeWakeflowConfigV3Digest,
  parseWakeflowConfigV3,
} from "../../../src/configuration/wakeflow-config-v3.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";
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
  inspectWakeflowSupportMemory,
  WakeflowSupportMemoryInspectionError,
  type WakeflowSupportMemoryInspectionErrorReason,
} from "../../../src/workspace/support/wakeflow-support-memory-inspection.js";
import {
  createMinimalWakeflowConfigV3,
} from "../../configuration/wakeflow-config-v3.fixture.js";

const DESIGN_ID = "surface_33333333-3333-4333-8333-333333333333";

async function fixture(t: TestContext) {
  const container = realpathSync(mkdtempSync(path.join(
    os.tmpdir(),
    "wakeflow-support-memory-inspection-",
  )));
  const workspacePath = path.join(container, "Workspace");
  mkdirSync(workspacePath, { mode: 0o755 });
  const workspaceRoot = await RootedDirectory.open(workspacePath);
  const config = parseWakeflowConfigV3(createMinimalWakeflowConfigV3());
  const catalog = createWakeflowManagedSupportResourceCatalog(
    config,
    codexWorkspaceHostResourceProfile,
  );
  await materializeWakeflowManagedSupportRoot(workspaceRoot, {
    config,
    expectedConfigDigest: computeWakeflowConfigV3Digest(config),
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

async function expectInspectionError(
  action: () => Promise<unknown>,
  reason: WakeflowSupportMemoryInspectionErrorReason,
  pathValue: string,
): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof WakeflowSupportMemoryInspectionError, true);
  if (caught instanceof WakeflowSupportMemoryInspectionError) {
    equal(caught.code, "wakeflow-support-memory-inspection");
    equal(caught.reason, reason);
    equal(caught.path, pathValue);
  }
}

test("Support memory inspection plans absent whole-file creation without writing", async (t) => {
  const workspace = await fixture(t);
  const desired = config("en");
  const inspected = await inspectWakeflowSupportMemory(
    workspace.workspaceRoot,
    workspace.supportRoot,
    request(null, desired),
  );
  equal(inspected.status, "publication-required");
  equal(inspected.source, null);
  equal(inspected.currentAuthority, null);
  equal(inspected.transition.disposition, "create-required");
  equal(inspected.operation.recipe, "deterministic-rewrite");
  equal(existsSync(workspace.memoryPath), false);
});

test("Support memory inspection admits exact language evolution and desired retry", async (t) => {
  const workspace = await fixture(t);
  const current = config("en");
  const desired = config("zh-Hans");
  const currentAuthority = createWakeflowSupportMemoryAuthority(
    current,
    codexWorkspaceHostResourceProfile,
    DESIGN_ID,
  );
  writeFileSync(workspace.memoryPath, currentAuthority.body, { mode: 0o644 });
  const operation = request(current, desired);

  const changing = await inspectWakeflowSupportMemory(
    workspace.workspaceRoot,
    workspace.supportRoot,
    operation,
  );
  equal(changing.status, "publication-required");
  equal(changing.transition.disposition, "replace-required");
  equal(changing.transition.sourceAuthority, "admitted-current");
  equal(Buffer.from(changing.transition.desiredBytes).includes(
    Buffer.from("Wakeflow Design 支持窗口"),
  ), true);

  writeFileSync(
    workspace.memoryPath,
    changing.transition.desiredBytes,
    { mode: 0o644 },
  );
  const currentInspection = await inspectWakeflowSupportMemory(
    workspace.workspaceRoot,
    workspace.supportRoot,
    operation,
  );
  equal(currentInspection.status, "current");
  equal(currentInspection.transition.sourceAuthority, "desired");
});

test("Support memory inspection rejects unknown bytes and node-policy drift", async (t) => {
  const workspace = await fixture(t);
  const desired = config("en");
  writeFileSync(workspace.memoryPath, "# User-owned unknown file\n", {
    mode: 0o644,
  });
  const before = readFileSync(workspace.memoryPath);
  await expectInspectionError(
    () => inspectWakeflowSupportMemory(
      workspace.workspaceRoot,
      workspace.supportRoot,
      request(desired, desired),
    ),
    "unadmitted-source",
    "$source",
  );
  deepEqual(readFileSync(workspace.memoryPath), before);

  const authority = createWakeflowSupportMemoryAuthority(
    desired,
    codexWorkspaceHostResourceProfile,
    DESIGN_ID,
  );
  writeFileSync(workspace.memoryPath, encodeUtf8(authority.body), {
    mode: 0o644,
  });
  chmodSync(workspace.memoryPath, 0o600);
  await expectInspectionError(
    () => inspectWakeflowSupportMemory(
      workspace.workspaceRoot,
      workspace.supportRoot,
      request(desired, desired),
    ),
    "source-policy",
    "$source",
  );
});
