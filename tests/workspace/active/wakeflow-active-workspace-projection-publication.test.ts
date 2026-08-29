import { deepEqual, equal } from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
import {
  RootedDirectory,
} from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  initializeFreshTodoCollection,
} from "../../../src/governance/todo/todo-collection-initialization.js";
import {
  materializeWakeflowActiveLayout,
} from "../../../src/workspace/active/wakeflow-active-layout-materialization.js";
import {
  WAKEFLOW_ACTIVE_PROJECTION_LOCK_REF,
  WAKEFLOW_ACTIVE_WORKSPACE_INDEX_REF,
  WAKEFLOW_ACTIVE_WORKSPACE_STATUS_REF,
} from "../../../src/workspace/active/wakeflow-active-paths.js";
import {
  createWakeflowActiveWorkspaceFreshProjectionAuthority,
} from "../../../src/workspace/active/wakeflow-active-workspace-fresh-projection-authority.js";
import {
  inspectWakeflowActiveWorkspaceProjection,
  WakeflowActiveWorkspaceProjectionInspectionError,
} from "../../../src/workspace/active/wakeflow-active-workspace-projection-inspection.js";
import {
  publishWakeflowActiveWorkspaceProjection,
} from "../../../src/workspace/active/wakeflow-active-workspace-projection-publication.js";
import {
  createMinimalWakeflowConfigV3,
} from "../../configuration/wakeflow-config-v3.fixture.js";

async function fixture(t: TestContext) {
  const absolutePath = mkdtempSync(path.join(
    os.tmpdir(),
    "wakeflow-active-workspace-projection-",
  ));
  const root = await RootedDirectory.open(absolutePath);
  await materializeWakeflowActiveLayout(root, {
    recoveringFreshLayout: false,
  });
  await initializeFreshTodoCollection(root, {
    recoveringFreshCollection: false,
  });
  t.after(async () => {
    await root.close();
    rmSync(absolutePath, { recursive: true, force: true });
  });
  return Object.freeze({ absolutePath, root });
}

function config(language: "en" | "zh-Hans" = "en") {
  const value = createMinimalWakeflowConfigV3();
  (value.presentation as Record<string, unknown>).language = language;
  return parseWakeflowConfigV3(value);
}

function request(value: ReturnType<typeof config>) {
  return Object.freeze({
    desiredConfig: value,
    expectedDesiredConfigDigest: computeWakeflowConfigV3Digest(value),
  });
}

function physical(root: string, resourcePath: string): string {
  return path.join(root, ...resourcePath.split("/"));
}

test("Fresh workspace projection publishes two files and remains inode-stable", async (t) => {
  const workspace = await fixture(t);
  const desired = config();
  const before = await inspectWakeflowActiveWorkspaceProjection(
    workspace.root,
    request(desired),
  );
  equal(before.status, "publication-required");
  deepEqual(before.targets.map((entry) => entry.status), [
    "missing",
    "missing",
  ]);

  const published = await publishWakeflowActiveWorkspaceProjection(
    workspace.root,
    request(desired),
    { recoveringAffectedPublication: false },
  );
  equal(published.disposition, "created");
  equal(published.effects.length, 2);
  const nodes = [
    WAKEFLOW_ACTIVE_WORKSPACE_INDEX_REF,
    WAKEFLOW_ACTIVE_WORKSPACE_STATUS_REF,
  ].map((entry) => statSync(physical(workspace.absolutePath, entry), {
    bigint: true,
  }));
  equal(nodes.every((entry) => Number(entry.mode & 0o777n) === 0o600), true);
  equal(existsSync(physical(
    workspace.absolutePath,
    WAKEFLOW_ACTIVE_PROJECTION_LOCK_REF,
  )), false);

  const repeated = await publishWakeflowActiveWorkspaceProjection(
    workspace.root,
    request(desired),
    { recoveringAffectedPublication: false },
  );
  equal(repeated.disposition, "current");
  equal(repeated.effects.length, 0);
  deepEqual([
    WAKEFLOW_ACTIVE_WORKSPACE_INDEX_REF,
    WAKEFLOW_ACTIVE_WORKSPACE_STATUS_REF,
  ].map((entry) => statSync(
    physical(workspace.absolutePath, entry),
    { bigint: true },
  ).ino), nodes.map((entry) => entry.ino));
});

test("projection updates only owner-marked stale bytes", async (t) => {
  const workspace = await fixture(t);
  const english = config();
  await publishWakeflowActiveWorkspaceProjection(
    workspace.root,
    request(english),
    { recoveringAffectedPublication: false },
  );
  const before = statSync(physical(
    workspace.absolutePath,
    WAKEFLOW_ACTIVE_WORKSPACE_INDEX_REF,
  ), { bigint: true });
  const chinese = config("zh-Hans");
  const updated = await publishWakeflowActiveWorkspaceProjection(
    workspace.root,
    request(chinese),
    { recoveringAffectedPublication: false },
  );
  equal(updated.disposition, "updated");
  equal(updated.effects.length, 2);
  equal(readFileSync(physical(
    workspace.absolutePath,
    WAKEFLOW_ACTIVE_WORKSPACE_INDEX_REF,
  ), "utf8").startsWith("# Wakeflow 活动工作区\n"), true);
  equal(statSync(physical(
    workspace.absolutePath,
    WAKEFLOW_ACTIVE_WORKSPACE_INDEX_REF,
  ), { bigint: true }).ino === before.ino, false);
});

test("affected recovery accepts one committed projection and creates its sibling", async (t) => {
  const workspace = await fixture(t);
  const desired = config();
  const authority = createWakeflowActiveWorkspaceFreshProjectionAuthority(
    desired,
  );
  const first = authority.files[0];
  if (first === undefined) throw new Error("Expected index authority.");
  writeFileSync(
    physical(workspace.absolutePath, first.resourcePath),
    first.bytes,
    { mode: 0o600 },
  );
  const recovered = await publishWakeflowActiveWorkspaceProjection(
    workspace.root,
    request(desired),
    { recoveringAffectedPublication: true },
  );
  equal(recovered.disposition, "created");
  equal(recovered.effects.length, 1);
  equal(recovered.inspection.status, "current");
});

test("affected recovery retires an inactive projection lock", async (t) => {
  const workspace = await fixture(t);
  const lockPath = physical(
    workspace.absolutePath,
    WAKEFLOW_ACTIVE_PROJECTION_LOCK_REF,
  );
  writeFileSync(lockPath, `${JSON.stringify({
    createdAt: "2026-08-28T00:00:00.000Z",
    kind: "WakeflowExclusiveFileLock",
    pid: 2_147_483_647,
    threadId: 0,
    token:
      "2147483647-0-11111111-1111-4111-8111-111111111111",
    version: 1,
  }, null, 2)}\n`, { mode: 0o600 });
  let normalError: unknown;
  try {
    await inspectWakeflowActiveWorkspaceProjection(
      workspace.root,
      request(config()),
    );
  } catch (error: unknown) {
    normalError = error;
  }
  equal(
    normalError instanceof WakeflowActiveWorkspaceProjectionInspectionError,
    true,
  );
  if (normalError instanceof WakeflowActiveWorkspaceProjectionInspectionError) {
    equal(normalError.reason, "lock-present");
  }
  equal(existsSync(lockPath), true);
  const recovered = await publishWakeflowActiveWorkspaceProjection(
    workspace.root,
    request(config()),
    { recoveringAffectedPublication: true },
  );
  equal(recovered.disposition, "created");
  equal(existsSync(lockPath), false);
});

test("unmanaged target or Demand residue causes zero sibling write", async (t) => {
  const unmanaged = await fixture(t);
  writeFileSync(physical(
    unmanaged.absolutePath,
    WAKEFLOW_ACTIVE_WORKSPACE_INDEX_REF,
  ), "# User file\n", { mode: 0o600 });
  let targetError: unknown;
  try {
    await publishWakeflowActiveWorkspaceProjection(
      unmanaged.root,
      request(config()),
      { recoveringAffectedPublication: false },
    );
  } catch (error: unknown) {
    targetError = error;
  }
  equal(targetError instanceof Error, true);
  equal(existsSync(physical(
    unmanaged.absolutePath,
    WAKEFLOW_ACTIVE_WORKSPACE_STATUS_REF,
  )), false);

  const demand = await fixture(t);
  mkdirSync(path.join(
    demand.absolutePath,
    ".wakeflow-active/current/demand_11111111-1111-4111-8111-111111111111",
  ), { mode: 0o700 });
  let namespaceError: unknown;
  try {
    await inspectWakeflowActiveWorkspaceProjection(
      demand.root,
      request(config()),
    );
  } catch (error: unknown) {
    namespaceError = error;
  }
  equal(
    namespaceError instanceof WakeflowActiveWorkspaceProjectionInspectionError,
    true,
  );
  if (namespaceError instanceof WakeflowActiveWorkspaceProjectionInspectionError) {
    equal(namespaceError.reason, "namespace");
  }
  equal(lstatSync(path.join(
    demand.absolutePath,
    ".wakeflow-active/current/demand_11111111-1111-4111-8111-111111111111",
  )).isDirectory(), true);
});
