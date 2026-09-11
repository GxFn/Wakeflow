import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  deriveCloseCompleteBlockers,
  deriveCloseRequestBlockers,
  deriveCreateBlockers,
  derivePodId,
  derivePodState,
  derivePodWindows,
  derivePodWorktrees,
  podMutationNext,
  podPreviewNext,
} from "../../../src/capabilities/pod/decide.js";
import {
  buildWakeflowConfigV3Indexes,
  parseWakeflowConfigV3,
} from "../../../src/configuration/wakeflow-config-v3.js";
import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { createMinimalWakeflowConfigV3 } from "../../configuration/wakeflow-config-v3.fixture.js";

/**
 * pod 切片的纯决定（§13.91 D1 到 D3、D6）：身份与窗口集派生、状态派生、创建与两段关闭的阻塞项、next。
 */

const PROGRAM_ID = "program_11111111-1111-4111-8111-111111111111";
const REPOSITORY_ID = parseWakeflowDurableIdOfKind(
  "repository_22222222-2222-4222-8222-222222222222",
  "repository",
);

function primaryScope() {
  const model = parseWakeflowConfigV3(createMinimalWakeflowConfigV3());
  return { model, indexes: buildWakeflowConfigV3Indexes(model) };
}

test("podId 由程序与幂等键派生；窗口集从 primary 模板派生且显示名带 pod 名前缀", () => {
  const podId = derivePodId(PROGRAM_ID, "key-1");
  equal(podId, derivePodId(PROGRAM_ID, "key-1"));
  equal(podId === derivePodId(PROGRAM_ID, "key-2"), false);
  equal(podId.startsWith("pod_"), true);
  const { indexes } = primaryScope();
  const windows = derivePodWindows(
    indexes.primaryPod,
    [REPOSITORY_ID],
    podId,
    "feature-x",
    PROGRAM_ID,
  );
  deepEqual(
    windows.map((window) => [window.role, window.displayName, window.podId === podId]),
    [
      ["controller", "feature-x · Controller", true],
      ["design", "feature-x · Design", true],
      ["test", "feature-x · Test", true],
      ["product", "feature-x · Product A", true],
    ],
  );
  equal(new Set(windows.map((window) => window.windowId)).size, 4);
  deepEqual(
    derivePodWindows(indexes.primaryPod, [REPOSITORY_ID], podId, "feature-x", PROGRAM_ID).map(
      (window) => window.windowId,
    ),
    windows.map((window) => window.windowId),
    "window identity is stable for the same pod",
  );
  const worktrees = derivePodWorktrees(windows, "feature-x");
  deepEqual(worktrees, [
    {
      repositoryId: REPOSITORY_ID,
      windowId: windows[3]?.windowId,
      suggestedName: "wakeflow-feature-x",
    },
  ]);
});

test("创建阻塞项：main 保留、存活重名、无仓库；同键重放跳过重名", () => {
  deepEqual(
    deriveCreateBlockers({ name: "main", liveNames: ["main"], repositoryCount: 1, replay: false }),
    ["name-reserved:main", "name-taken"],
  );
  deepEqual(
    deriveCreateBlockers({
      name: "x",
      liveNames: ["main", "x"],
      repositoryCount: 0,
      replay: false,
    }),
    ["name-taken", "repository-unavailable"],
  );
  deepEqual(
    deriveCreateBlockers({ name: "x", liveNames: ["main", "x"], repositoryCount: 1, replay: true }),
    [],
  );
});

test("状态派生：open 下全部绑定且回执同代检出仍在才 ready；closing 下无绑定无检出即 closed", () => {
  const pod = {
    placement: "worktree" as const,
    lifecycle: "open" as const,
    worktrees: [{ repositoryId: REPOSITORY_ID, windowId: "w4", suggestedName: "wakeflow-x" }],
  } as never;
  const windowIds = ["w1", "w2", "w3", "w4"];
  const bound = new Map([
    ["w1", "b1"],
    ["w2", "b2"],
    ["w3", "b3"],
    ["w4", "b4"],
  ]);
  const receipt = {
    repositoryId: REPOSITORY_ID,
    windowId: "w4",
    bindingId: "b4",
    checkoutPresent: true,
  };
  equal(
    derivePodState({ pod, windowIds, bindingIdByWindowId: bound, receipts: [receipt] }),
    "ready",
  );
  equal(
    derivePodState({
      pod,
      windowIds,
      bindingIdByWindowId: new Map([["w1", "b1"]]),
      receipts: [receipt],
    }),
    "creating",
  );
  equal(
    derivePodState({
      pod,
      windowIds,
      bindingIdByWindowId: bound,
      receipts: [{ ...receipt, bindingId: "stale" }],
    }),
    "creating",
  );
  equal(
    derivePodState({
      pod,
      windowIds,
      bindingIdByWindowId: bound,
      receipts: [{ ...receipt, checkoutPresent: false }],
    }),
    "creating",
  );
  const closing = { ...(pod as object), lifecycle: "closing" as const } as never;
  equal(
    derivePodState({ pod: closing, windowIds, bindingIdByWindowId: bound, receipts: [receipt] }),
    "closing",
  );
  equal(
    derivePodState({
      pod: closing,
      windowIds,
      bindingIdByWindowId: new Map(),
      receipts: [{ ...receipt, checkoutPresent: false }],
    }),
    "closed",
  );
  equal(
    derivePodState({ pod: closing, windowIds, bindingIdByWindowId: new Map(), receipts: [] }),
    "closed",
  );
});

test("两段关闭的阻塞项与 next：primary 不可关，活动 Demand 与缺失处置阻第一段，绑定与检出阻第二段", () => {
  deepEqual(
    deriveCloseRequestBlockers({
      placement: "primary",
      activeDemandId: "demand_11111111-1111-4111-8111-111111111111",
      registeredRepositoryIds: [REPOSITORY_ID],
      dispositions: [{ repositoryId: "repository_99999999-9999-4999-8999-999999999999" }],
      knownRepositoryIds: [REPOSITORY_ID],
    }),
    [
      "pod-primary",
      "demand-active:demand_11111111-1111-4111-8111-111111111111",
      `branch-disposition-missing:${REPOSITORY_ID}`,
      "branch-disposition-unknown:repository_99999999-9999-4999-8999-999999999999",
    ],
  );
  deepEqual(
    deriveCloseRequestBlockers({
      placement: "worktree",
      activeDemandId: null,
      registeredRepositoryIds: [],
      dispositions: [],
      knownRepositoryIds: [REPOSITORY_ID],
    }),
    [],
  );
  deepEqual(
    deriveCloseCompleteBlockers({
      boundWindowIds: ["w1"],
      presentCheckoutRepositoryIds: [REPOSITORY_ID],
    }),
    ["window-bound:w1", `worktree-present:${REPOSITORY_ID}`],
  );
  equal(podPreviewNext("create", { status: "ready", blockers: [] }).frontier, "pod-create-apply");
  equal(
    podPreviewNext("close-request", { status: "ready", blockers: [] }).frontier,
    "pod-close-apply",
  );
  deepEqual(
    podPreviewNext("close-complete", { status: "blocked", blockers: ["window-bound:w1"] }),
    {
      frontier: null,
      owner: "controller",
      suggestedTool: null,
      blockers: ["window-bound:w1"],
    },
  );
  const creating = podMutationNext({
    state: "creating",
    unboundWindowIds: ["w2"],
    boundWindowIds: ["w1"],
    missingReceiptRepositoryIds: [REPOSITORY_ID],
    presentCheckoutRepositoryIds: [],
  });
  deepEqual(creating, {
    frontier: "pod-window-registration",
    owner: "controller",
    suggestedTool: "wakeflow_register_window_binding",
    blockers: ["w2", `worktree-receipt-missing:${REPOSITORY_ID}`],
  });
  equal(
    podMutationNext({
      state: "closing",
      unboundWindowIds: [],
      boundWindowIds: ["w1"],
      missingReceiptRepositoryIds: [],
      presentCheckoutRepositoryIds: [REPOSITORY_ID],
    }).frontier,
    "pod-window-decommission",
  );
  equal(
    podMutationNext({
      state: "closing",
      unboundWindowIds: [],
      boundWindowIds: [],
      missingReceiptRepositoryIds: [],
      presentCheckoutRepositoryIds: [REPOSITORY_ID],
    }).frontier,
    "pod-worktree-disposal",
  );
  equal(
    podMutationNext({
      state: "closing",
      unboundWindowIds: [],
      boundWindowIds: [],
      missingReceiptRepositoryIds: [],
      presentCheckoutRepositoryIds: [],
    }).frontier,
    "pod-close-apply",
  );
  equal(
    podMutationNext({
      state: "ready",
      unboundWindowIds: [],
      boundWindowIds: [],
      missingReceiptRepositoryIds: [],
      presentCheckoutRepositoryIds: [],
    }).frontier,
    null,
  );
});
