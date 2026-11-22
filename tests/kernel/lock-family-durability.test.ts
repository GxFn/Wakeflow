import { deepEqual } from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { type TestContext, test } from "node:test";
import {
  materializeActiveLayout,
  publishActiveProjection,
} from "../../src/kernel/active-projection.js";
import {
  REQUIREMENT_BOARD_ROOT_REF,
  WAKEFLOW_ACTIVE_PROJECTION_LOCK_REF,
  WORKSPACE_OPERATION_SCOPES_REF,
} from "../../src/kernel/layout.js";
import { withPodMutation } from "../../src/kernel/pod-mutation-lock.js";
import { refreshRequirementBoardIndex } from "../../src/kernel/requirement-board.js";
import { withWorkspaceOperationScope } from "../../src/kernel/workspace-operation-scope.js";
import {
  durableDisposableRoot,
  lockAcquisitionEvents,
  lockCycleEvents,
  lockReleaseEvents,
  traceDurability,
} from "../support/durability-trace.js";
import { materializeFixtureOperationScope } from "../support/workspace-operation-scope.fixture.js";

/**
 * Level 1 (component): 内核里的轻档锁族经各自的生产包装走一个周期的同步（1.4.1 第 1 段清单 2.1 节
 * L1–L5；七类锁按重排计划第 3 节路丙：获取只在链接前同步内容，释放在删锁之后同步父目录）。
 *
 * 计数表里锁的行直接调原语、档位写在测试里，一个包装不再传轻档时那里看不见；这里经包装调用，包装
 * 退回缺省档时会多出链接之后与删暂存之后的两次父目录同步，事件序列也不同。每个用例在真实同步的
 * 一次性根上先跑一遍（建锁目录、首次发布），再数第二遍：临界区是空操作或"已是当前"，计到的只有锁。
 *
 * 不调用 useDisposableDurability：本文件测的就是同步。计数补丁是进程全局的，用例顺序执行。
 */

const POD_ID = "pod_99999999-9999-4999-8999-999999999999";
const ADMISSION = WORKSPACE_OPERATION_SCOPES_REF;
const LATCH = `${ADMISSION}/latch.lock`;
const WRITER = `${ADMISSION}/writer.lock`;
const READER = `${ADMISSION}/reader-<uuid>.lock`;

/** 写者协议只认当前版本的配置；作用域的准入目录由夹具建好。 */
async function scopedWorkspace(t: TestContext) {
  const workspace = await durableDisposableRoot(t, "wakeflow-lock-family-scope-");
  materializeFixtureOperationScope(workspace.base);
  writeFileSync(
    path.join(workspace.base, "wakeflow.config.json"),
    `${JSON.stringify({ kind: "WakeflowConfig", schemaVersion: 2 }, null, 2)}\n`,
  );
  return workspace;
}

test("operation scope (L1 latch and writer, L2 reader lease) through withWorkspaceOperationScope", async (t) => {
  const { base, root } = await scopedWorkspace(t);
  const traced = traceDurability(t, base);
  const shared = await traced(() => withWorkspaceOperationScope(root, "shared", async () => {}));
  deepEqual(shared, {
    syncCount: 4,
    directorySyncCount: 2,
    events: [
      ...lockAcquisitionEvents(LATCH, "light"),
      ...lockAcquisitionEvents(READER, "light"),
      ...lockReleaseEvents(LATCH),
      ...lockReleaseEvents(READER),
    ],
  });
  const exclusive = await traced(() =>
    withWorkspaceOperationScope(root, "exclusive", async () => {}),
  );
  deepEqual(exclusive, {
    syncCount: 6,
    directorySyncCount: 3,
    events: [
      ...lockAcquisitionEvents(LATCH, "light"),
      ...lockAcquisitionEvents(WRITER, "light"),
      ...lockReleaseEvents(LATCH),
      ...lockAcquisitionEvents(LATCH, "light"),
      ...lockReleaseEvents(LATCH),
      ...lockReleaseEvents(WRITER),
    ],
  });
});

test("projection lock (L3) through publishActiveProjection with nothing to write", async (t) => {
  const { base, root } = await durableDisposableRoot(t, "wakeflow-lock-family-projection-");
  await materializeActiveLayout(root, { recovering: false });
  const render = async () => ({ files: [] });
  await publishActiveProjection(root, render);
  const trace = await traceDurability(t, base)(() => publishActiveProjection(root, render));
  deepEqual(trace, {
    syncCount: 2,
    directorySyncCount: 1,
    events: lockCycleEvents(WAKEFLOW_ACTIVE_PROJECTION_LOCK_REF, "light"),
  });
});

test("board lock (L4) through refreshRequirementBoardIndex of a current index", async (t) => {
  const { base, root } = await durableDisposableRoot(t, "wakeflow-lock-family-board-");
  await refreshRequirementBoardIndex(root);
  const trace = await traceDurability(t, base)(() => refreshRequirementBoardIndex(root));
  deepEqual(trace, {
    syncCount: 2,
    directorySyncCount: 1,
    events: lockCycleEvents(`${REQUIREMENT_BOARD_ROOT_REF}/locks/index.lock`, "light"),
  });
});

test("pod mutation lock (L5) through withPodMutation", async (t) => {
  const { base, root } = await durableDisposableRoot(t, "wakeflow-lock-family-pod-");
  await withPodMutation(root, POD_ID, async () => {});
  const trace = await traceDurability(t, base)(() => withPodMutation(root, POD_ID, async () => {}));
  deepEqual(trace, {
    syncCount: 2,
    directorySyncCount: 1,
    events: lockCycleEvents(`.wakeflow-local/runtime/pod-mutations/${POD_ID}.lock`, "light"),
  });
});
