import { deepEqual, equal } from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import {
  computeWakeflowConfigDigest,
  parseWakeflowConfig,
} from "../../../src/configuration/wakeflow-config.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  codexWorkspaceHostResourceProfile,
} from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import {
  createWakeflowManagedSupportResourceCatalog,
} from "../../../src/workspace/support/wakeflow-managed-support-resource-catalog.js";
import {
  inspectWakeflowManagedSupportRoot,
  materializeWakeflowManagedSupportRoot,
  WakeflowManagedSupportRootMaterializationError,
  type WakeflowManagedSupportRootMaterializationErrorReason,
} from "../../../src/workspace/support/wakeflow-managed-support-root-materialization.js";
import {
  createMinimalWakeflowConfig,
} from "../../configuration/wakeflow-config.fixture.js";

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
  const config = parseWakeflowConfig(configValue);
  const catalog = createWakeflowManagedSupportResourceCatalog(
    config,
    codexWorkspaceHostResourceProfile,
  );
  return Object.freeze({
    config,
    expectedConfigDigest: computeWakeflowConfigDigest(config),
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
  const childConfig = createMinimalWakeflowConfig();
  const absent = await inspectWakeflowManagedSupportRoot(
    childFixture.root,
    request(childConfig),
  );
  equal(absent.status, "absent");
  equal(absent.placementState, "missing");
  deepEqual(absent.scaffold, [{ relativePath: "drafts", status: "absent" }]);
  equal(existsSync(path.join(childFixture.workspacePath, "Design")), false, "inspection must not write");

  const created = await materializeWakeflowManagedSupportRoot(
    childFixture.root,
    request(childConfig),
  );
  equal(created.disposition, "created");
  equal(created.rootDisposition, "created");
  deepEqual(created.scaffold, [{ relativePath: "drafts", disposition: "created" }]);
  equal(statSync(path.join(childFixture.workspacePath, "Design")).mode & 0o777, 0o755);
  equal(statSync(path.join(childFixture.workspacePath, "Design", "drafts")).mode & 0o777, 0o755);
  const current = await materializeWakeflowManagedSupportRoot(
    childFixture.root,
    request(childConfig),
  );
  equal(current.disposition, "existing");
  equal(current.rootDisposition, "existing");
  deepEqual(current.scaffold, [{ relativePath: "drafts", disposition: "existing" }]);
  equal(
    (await inspectWakeflowManagedSupportRoot(childFixture.root, request(childConfig))).status,
    "current",
  );

  // scaffold 目录被删：检查报 incomplete，物化只补目录并保留其余内容。
  writeFileSync(path.join(childFixture.workspacePath, "Design", "notes.md"), "keep\n");
  rmSync(path.join(childFixture.workspacePath, "Design", "drafts"), { recursive: true });
  const incomplete = await inspectWakeflowManagedSupportRoot(
    childFixture.root,
    request(childConfig),
  );
  equal(incomplete.status, "incomplete");
  deepEqual(incomplete.scaffold, [{ relativePath: "drafts", status: "absent" }]);
  const repaired = await materializeWakeflowManagedSupportRoot(
    childFixture.root,
    request(childConfig),
  );
  equal(repaired.disposition, "created");
  // 根已存在只补 scaffold：fresh-initialize 的严格不存在检查读的是 rootDisposition。
  equal(repaired.rootDisposition, "existing");
  deepEqual(repaired.scaffold, [{ relativePath: "drafts", disposition: "created" }]);
  equal(existsSync(path.join(childFixture.workspacePath, "Design", "notes.md")), true);

  // scaffold 位置被普通文件占用：检查报 conflict，物化拒绝而不是覆盖。
  rmSync(path.join(childFixture.workspacePath, "Design", "drafts"), { recursive: true });
  writeFileSync(path.join(childFixture.workspacePath, "Design", "drafts"), "not a directory\n");
  equal(
    (await inspectWakeflowManagedSupportRoot(childFixture.root, request(childConfig))).status,
    "conflict",
  );
  await expectRootError(
    () => materializeWakeflowManagedSupportRoot(childFixture.root, request(childConfig)),
    "effect",
    "$supportRoot/drafts",
  );

  const testConfig = createMinimalWakeflowConfig();
  const testFixture = await fixture(t);
  const testRoot = await materializeWakeflowManagedSupportRoot(testFixture.root, {
    ...request(testConfig),
    surfaceId: "surface_44444444-4444-4444-8444-444444444444",
  });
  deepEqual(testRoot.scaffold, [
    { relativePath: "fixtures", disposition: "created" },
    { relativePath: "harnesses", disposition: "created" },
  ]);
  equal(existsSync(path.join(testFixture.workspacePath, "Test", "harnesses")), true);
  equal(existsSync(path.join(testFixture.workspacePath, "Test", "fixtures")), true);

  const siblingFixture = await fixture(t);
  const siblingConfig = createMinimalWakeflowConfig();
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
  const external = createMinimalWakeflowConfig();
  const externalSurface = (external.topology as {
    supportSurfaces: Record<string, unknown>[];
  }).supportSurfaces[0];
  if (externalSurface === undefined) throw new Error("Expected surface.");
  externalSurface.ownership = "external-owned";
  externalSurface.instructionManagement = "managed-block";
  const externalModel = parseWakeflowConfig(external);
  const emptyCatalog = createWakeflowManagedSupportResourceCatalog(
    externalModel,
    codexWorkspaceHostResourceProfile,
  );
  await expectRootError(
    () => materializeWakeflowManagedSupportRoot(externalFixture.root, {
      config: externalModel,
      expectedConfigDigest: computeWakeflowConfigDigest(externalModel),
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
      request(createMinimalWakeflowConfig()),
    ),
    "root-policy",
    "$root",
  );
});
