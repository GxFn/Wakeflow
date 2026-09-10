import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import { deriveNextProjection, NEXT_FRONTIER_TABLE } from "../../src/kernel/next-projection.js";

test("next projection 按路由第一前沿派生责任方与建议工具", () => {
  deepEqual(
    deriveNextProjection({
      disposition: "advancing",
      frontiers: [{ kind: "implementation-delivery-planning" }, { kind: "test-card-planning" }],
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
