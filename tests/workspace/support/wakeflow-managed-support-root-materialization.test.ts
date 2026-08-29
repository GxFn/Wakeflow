import { equal } from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import {
  computeWakeflowConfigV3Digest,
  parseWakeflowConfigV3,
} from "../../../src/configuration/wakeflow-config-v3.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  codexWorkspaceHostResourceProfile,
} from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import {
  createWakeflowManagedSupportResourceCatalog,
} from "../../../src/workspace/support/wakeflow-managed-support-resource-catalog.js";
import {
  materializeWakeflowManagedSupportRoot,
  WakeflowManagedSupportRootMaterializationError,
  type WakeflowManagedSupportRootMaterializationErrorReason,
} from "../../../src/workspace/support/wakeflow-managed-support-root-materialization.js";
import {
  createMinimalWakeflowConfigV3,
} from "../../configuration/wakeflow-config-v3.fixture.js";

const DESIGN_ID = "surface_33333333-3333-4333-8333-333333333333";

async function fixture(t: TestContext) {
  const container = realpathSync(mkdtempSync(path.join(
    os.tmpdir(),
    "wakeflow-managed-support-root-",
  )));
  const workspacePath = path.join(container, "Workspace");
  mkdirSync(workspacePath, { mode: 0o755 });
  const root = await RootedDirectory.open(workspacePath);
  t.after(async () => {
    await root.close();
    rmSync(container, { recursive: true, force: true });
  });
  return Object.freeze({ container, workspacePath, root });
}

function request(configValue: unknown) {
  const config = parseWakeflowConfigV3(configValue);
  const catalog = createWakeflowManagedSupportResourceCatalog(
    config,
    codexWorkspaceHostResourceProfile,
  );
  return Object.freeze({
    config,
    expectedConfigDigest: computeWakeflowConfigV3Digest(config),
    profile: codexWorkspaceHostResourceProfile,
    expectedCatalogDigest: catalog.catalogDigest,
    surfaceId: DESIGN_ID,
  });
}

async function expectRootError(
  action: () => Promise<unknown>,
  reason: WakeflowManagedSupportRootMaterializationErrorReason,
  pathValue: string,
): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof WakeflowManagedSupportRootMaterializationError, true);
  if (caught instanceof WakeflowManagedSupportRootMaterializationError) {
    equal(caught.code, "wakeflow-managed-support-root-materialization");
    equal(caught.reason, reason);
    equal(caught.path, pathValue);
  }
}

test("managed Support root materializes child and sibling Config placements", async (t) => {
  const childFixture = await fixture(t);
  const childConfig = createMinimalWakeflowConfigV3();
  const created = await materializeWakeflowManagedSupportRoot(
    childFixture.root,
    request(childConfig),
  );
  equal(created.disposition, "created");
  equal(statSync(path.join(childFixture.workspacePath, "Design")).mode & 0o777, 0o755);
  const current = await materializeWakeflowManagedSupportRoot(
    childFixture.root,
    request(childConfig),
  );
  equal(current.disposition, "existing");

  const siblingFixture = await fixture(t);
  const siblingConfig = createMinimalWakeflowConfigV3();
  const surfaces = (siblingConfig.topology as {
    supportSurfaces: Record<string, unknown>[];
  }).supportSurfaces;
  const design = surfaces[0];
  if (design === undefined) throw new Error("Expected Design surface.");
  design.path = "../Design";
  const sibling = await materializeWakeflowManagedSupportRoot(
    siblingFixture.root,
    request(siblingConfig),
  );
  equal(sibling.disposition, "created");
  equal(statSync(path.join(siblingFixture.container, "Design")).mode & 0o777, 0o755);
});

test("managed Support root rejects external ownership and existing mode drift", async (t) => {
  const externalFixture = await fixture(t);
  const external = createMinimalWakeflowConfigV3();
  const externalSurface = (external.topology as {
    supportSurfaces: Record<string, unknown>[];
  }).supportSurfaces[0];
  if (externalSurface === undefined) throw new Error("Expected surface.");
  externalSurface.ownership = "external-owned";
  externalSurface.instructionManagement = "managed-block";
  const externalModel = parseWakeflowConfigV3(external);
  const emptyCatalog = createWakeflowManagedSupportResourceCatalog(
    externalModel,
    codexWorkspaceHostResourceProfile,
  );
  await expectRootError(
    () => materializeWakeflowManagedSupportRoot(externalFixture.root, {
      config: externalModel,
      expectedConfigDigest: computeWakeflowConfigV3Digest(externalModel),
      profile: codexWorkspaceHostResourceProfile,
      expectedCatalogDigest: emptyCatalog.catalogDigest,
      surfaceId: DESIGN_ID,
    }),
    "surface",
    "$request.surfaceId",
  );

  const driftFixture = await fixture(t);
  mkdirSync(path.join(driftFixture.workspacePath, "Design"), { mode: 0o755 });
  chmodSync(path.join(driftFixture.workspacePath, "Design"), 0o700);
  await expectRootError(
    () => materializeWakeflowManagedSupportRoot(
      driftFixture.root,
      request(createMinimalWakeflowConfigV3()),
    ),
    "root-policy",
    "$root",
  );
});
