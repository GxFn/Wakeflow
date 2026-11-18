import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import { deriveNextProjection, NEXT_FRONTIER_TABLE } from "../../src/kernel/next-projection.js";

test("next projection 按路由第一前沿派生责任方与建议工具", () => {
  deepEqual(
    deriveNextProjection({
      disposition: "advancing",
      frontiers: [{ kind: "implementation-delivery-planning" }, { kind: "test-task-planning" }],
      blockers: [],
    }),
    {
      frontier: "implementation-delivery-planning",
      owner: "controller",
      suggestedTool: "wakeflow_prepare_delivery",
      blockers: [],
    },
  );
  deepEqual(
    deriveNextProjection({
      disposition: "advancing",
      frontiers: [{ kind: "implementation-target-result-import" }],
      blockers: [],
    }),
    {
      frontier: "implementation-target-result-import",
      owner: "target",
      suggestedTool: "wakeflow_import_target_result",
      blockers: [],
    },
  );
  // 阻塞时保留前沿与责任方，但不建议工具；阻塞原因原样列出。
  deepEqual(
    deriveNextProjection({
      disposition: "blocked",
      frontiers: [{ kind: "implementation-result-review" }],
      blockers: [{ kind: "review-blocked" }, { kind: "config-drift" }],
    }),
    {
      frontier: "implementation-result-review",
      owner: "controller",
      suggestedTool: null,
      blockers: ["review-blocked", "config-drift"],
    },
  );
  // 未登记的前沿归 Controller 且不建议工具；阻塞时归用户。
  equal(
    deriveNextProjection({
      disposition: "advancing",
      frontiers: [{ kind: "unknown-kind" }],
      blockers: [],
    }).owner,
    "controller",
  );
  equal(
    deriveNextProjection({
      disposition: "blocked",
      frontiers: [{ kind: "unknown-kind" }],
      blockers: [],
    }).owner,
    "user",
  );
  // 终态或没有前沿：无前沿、无责任方。
  deepEqual(
    deriveNextProjection({
      disposition: "terminal",
      frontiers: [{ kind: "demand-completion-preflight" }],
      blockers: [],
    }),
    { frontier: null, owner: "none", suggestedTool: null, blockers: [] },
  );
  deepEqual(deriveNextProjection({ disposition: "advancing", frontiers: [], blockers: [] }), {
    frontier: null,
    owner: "none",
    suggestedTool: null,
    blockers: [],
  });
  equal(
    Object.isFrozen(
      deriveNextProjection({ disposition: "advancing", frontiers: [], blockers: [] }),
    ),
    true,
  );
});

test("next frontier 表只指向登记的公共工具名或 null", () => {
  for (const [kind, route] of Object.entries(NEXT_FRONTIER_TABLE)) {
    equal(/^[a-z][a-z0-9-]+$/u.test(kind), true, kind);
    equal(route.tool === null || /^wakeflow_[a-z0-9_]+$/u.test(route.tool), true, kind);
    equal(["controller", "target", "test", "user", "none"].includes(route.owner), true, kind);
  }
});

test("next 带上后续调用要用的标识（ADR-0029 决定 6）：Demand 路由给出 demandId 与流修订，目标前沿加上目标与投递；终态与非 Demand 路由没有", () => {
  const route = {
    demandId: "demand_11111111-1111-4111-8111-111111111111",
    observedEventStream: { streamRevision: 7 },
    blockers: [],
  };
  deepEqual(
    deriveNextProjection({
      ...route,
      disposition: "work-available",
      frontiers: [
        {
          kind: "implementation-host-effect-rearm",
          target: { targetTaskId: "target-task_22222222-2222-4222-8222-222222222222" },
          deliveryId: "target-delivery_33333333-3333-4333-8333-333333333333",
        },
      ],
    }).subject,
    {
      demandId: route.demandId,
      streamRevision: 7,
      targetTaskId: "target-task_22222222-2222-4222-8222-222222222222",
      deliveryId: "target-delivery_33333333-3333-4333-8333-333333333333",
    },
  );
  // Demand 级前沿只有 Demand 与流修订；阻塞与等待用户时标识仍在。
  for (const disposition of ["work-available", "blocked", "awaiting-decision"]) {
    deepEqual(
      deriveNextProjection({
        ...route,
        disposition,
        frontiers: [{ kind: "demand-completion-preflight" }],
      }).subject,
      { demandId: route.demandId, streamRevision: 7 },
      disposition,
    );
  }
  equal(
    "subject" in
      deriveNextProjection({
        ...route,
        disposition: "terminal",
        frontiers: [{ kind: "demand-completion-preflight" }],
      }),
    false,
  );
  equal(
    "subject" in
      deriveNextProjection({
        disposition: "work-available",
        frontiers: [{ kind: "pod-window-registration" }],
        blockers: [],
      }),
    false,
  );
});
