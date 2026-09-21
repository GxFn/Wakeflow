import { deepEqual, equal } from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import { parseWakeflowConfig } from "../../../src/configuration/wakeflow-config.js";
import { materializeDirectoryPath } from "../../../src/foundation/filesystem/durable-directory-materialization.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { codexWindowHostIdentityProfile } from "../../../src/hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";
import { publishFreshWakeflowWindowRuntime } from "../../../src/workspace/window-runtime/wakeflow-window-runtime-fresh-publication.js";
import {
  executeWakeflowWindowRuntimeProjectionOperation,
  planWakeflowWindowRuntimeProjectionMaintenance,
  WakeflowWindowRuntimeProjectionMaintenanceError,
} from "../../../src/workspace/window-runtime/wakeflow-window-runtime-projection-maintenance.js";
import { createMinimalWakeflowConfig } from "../../configuration/wakeflow-config.fixture.js";

/**
 * 对账时的窗口运行投影：健康零操作；缺失或过期（合法 JSON、内容不同）各出一条操作，执行后
 * 逐字节复原；读不出的投影只报告 `window-runtime-projection-unsafe`；宿主运行时根未发布或
 * fresh 动作不出操作；执行时目标摘要与计划不符即拒绝。
 */

const CONTROLLER_WINDOW_ID = "window_55555555-5555-4555-8555-555555555555";

async function fixture(t: TestContext) {
  const absolutePath = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "wakeflow-projection-maintenance-")),
  );
  const root = await RootedDirectory.open(absolutePath);
  await materializeDirectoryPath(root, parsePortableResourcePath(".wakeflow-local/runtime"), {
    mode: 0o700,
  });
  t.after(async () => {
    await root.close();
    rmSync(absolutePath, { recursive: true, force: true });
  });
  return Object.freeze({
    absolutePath,
    root,
    projections: path.join(
      absolutePath,
      ".wakeflow-local/runtime/hosts/codex/projections/window-runtime",
    ),
  });
}

function config() {
  return parseWakeflowConfig(createMinimalWakeflowConfig());
}

function request(action: "reconcile" | "reconfigure" | "fresh-initialize") {
  return {
    action,
    config: config(),
    resourceProfile: codexWorkspaceHostResourceProfile,
    identityProfile: codexWindowHostIdentityProfile,
  };
}

test("window runtime projection maintenance repairs missing and stale projections and reports unsafe ones", async (t) => {
  const workspace = await fixture(t);
  // 宿主运行时根尚未发布：不出操作也不报告（共享预览负责 window-runtime-missing）。
  deepEqual(
    await planWakeflowWindowRuntimeProjectionMaintenance(workspace.root, request("reconcile")),
    { operations: [], blockerCodes: [] },
  );

  await publishFreshWakeflowWindowRuntime(
    workspace.root,
    config(),
    codexWorkspaceHostResourceProfile,
    { recoveringFreshPublication: false },
  );
  deepEqual(
    await planWakeflowWindowRuntimeProjectionMaintenance(workspace.root, request("reconcile")),
    { operations: [], blockerCodes: [] },
  );
  deepEqual(
    await planWakeflowWindowRuntimeProjectionMaintenance(workspace.root, request("fresh-initialize")),
    { operations: [], blockerCodes: [] },
  );

  const projectionPath = path.join(workspace.projections, `${CONTROLLER_WINDOW_ID}.json`);
  const original = readFileSync(projectionPath, "utf8");
  rmSync(projectionPath);
  const missing = await planWakeflowWindowRuntimeProjectionMaintenance(
    workspace.root,
    request("reconcile"),
  );
  deepEqual(missing.blockerCodes, []);
  equal(missing.operations.length, 1);
  const operation = missing.operations[0];
  if (operation === undefined) throw new Error("expected one operation");
  equal(operation.operationId, `window-runtime-projection:${CONTROLLER_WINDOW_ID}`);
  equal(operation.operationKind, "window-runtime-projection");
  equal(operation.targetKey, CONTROLLER_WINDOW_ID);
  equal(operation.sourceDigest, null);
  deepEqual(operation.payload, {
    windowId: CONTROLLER_WINDOW_ID,
    resourceRef: `.wakeflow-local/runtime/hosts/codex/projections/window-runtime/${CONTROLLER_WINDOW_ID}.json`,
    registered: false,
    projectionDigest: (operation.payload as { projectionDigest: string }).projectionDigest,
  });
  const created = await executeWakeflowWindowRuntimeProjectionOperation(workspace.root, {
    ...request("reconcile"),
    operationId: operation.operationId,
    targetKey: operation.targetKey,
    targetDigest: operation.targetDigest,
  });
  equal(created.disposition, "created");
  equal(readFileSync(projectionPath, "utf8"), original);
  equal(statSync(projectionPath).mode & 0o777, 0o600);
  equal(
    (await executeWakeflowWindowRuntimeProjectionOperation(workspace.root, {
      ...request("reconcile"),
      operationId: operation.operationId,
      targetKey: operation.targetKey,
      targetDigest: operation.targetDigest,
    })).disposition,
    "current",
  );

  // 过期：合法的确定性 JSON，但不是当前权威渲染。
  writeFileSync(projectionPath, original.replace("\"unregistered\"", "\"registered\""));
  const stale = await planWakeflowWindowRuntimeProjectionMaintenance(
    workspace.root,
    request("reconfigure"),
  );
  equal(stale.operations.length, 1);
  equal(stale.operations[0]?.sourceDigest === null, false);
  const updated = await executeWakeflowWindowRuntimeProjectionOperation(workspace.root, {
    ...request("reconfigure"),
    operationId: `window-runtime-projection:${CONTROLLER_WINDOW_ID}`,
    targetKey: CONTROLLER_WINDOW_ID,
    targetDigest: stale.operations[0]?.targetDigest as never,
  });
  equal(updated.disposition, "updated");
  equal(readFileSync(projectionPath, "utf8"), original);

  // 读不出：只报告，不出操作，也不覆盖。
  writeFileSync(projectionPath, "not a projection\n");
  const unsafe = await planWakeflowWindowRuntimeProjectionMaintenance(
    workspace.root,
    request("reconcile"),
  );
  deepEqual(unsafe, { operations: [], blockerCodes: ["window-runtime-projection-unsafe"] });
  equal(readFileSync(projectionPath, "utf8"), "not a projection\n");

  // 计划与当前权威不符（错误的目标摘要）即拒绝。
  let caught: unknown;
  try {
    await executeWakeflowWindowRuntimeProjectionOperation(workspace.root, {
      ...request("reconcile"),
      operationId: `window-runtime-projection:${CONTROLLER_WINDOW_ID}`,
      targetKey: CONTROLLER_WINDOW_ID,
      targetDigest: `sha256:${"0".repeat(64)}` as never,
    });
  } catch (error: unknown) {
    caught = error;
  }
  equal(caught instanceof WakeflowWindowRuntimeProjectionMaintenanceError, true);
  if (caught instanceof WakeflowWindowRuntimeProjectionMaintenanceError) {
    equal(caught.reason, "plan");
  }
});
