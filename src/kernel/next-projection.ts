/**
 * Wakeflow Kernel / Next Projection：从 Controller 路由派生"下一步是谁、用哪个工具"
 * （ADR-0012 决定 D2）。每个变更结果都带这份投影，Controller 不必再单独查路由。
 *
 * 输入只用路由的结构形状，不依赖治理层类型；前沿到工具的映射是一张数据表。
 */

type NextOwner = "controller" | "target" | "test" | "user" | "none";

export interface NextProjection {
  readonly frontier: string | null;
  readonly owner: NextOwner;
  readonly suggestedTool: string | null;
  readonly blockers: readonly string[];
}

export interface NextProjectionRouteShape {
  readonly disposition: string;
  readonly frontiers: readonly Readonly<{ readonly kind: string }>[];
  readonly blockers: readonly Readonly<{ readonly kind: string }>[];
}

interface FrontierRoute {
  readonly owner: NextOwner;
  readonly tool: string | null;
}

/** 前沿种类 → 责任方与建议工具；未列出的种类归 Controller 且不建议工具。 */
export const NEXT_FRONTIER_TABLE: Readonly<Record<string, FrontierRoute>> = Object.freeze({
  "requirement-confirmation": {
    owner: "user",
    tool: "wakeflow_publish_requirement",
  },
  "requirement-claim": {
    owner: "controller",
    tool: "wakeflow_create_demand",
  },
  "implementation-task-planning": {
    owner: "controller",
    tool: "wakeflow_plan_target_task",
  },
  "test-task-planning": {
    owner: "controller",
    tool: "wakeflow_plan_target_task",
  },
  "implementation-delivery-planning": {
    owner: "controller",
    tool: "wakeflow_prepare_delivery",
  },
  "implementation-host-effect-execution": {
    owner: "controller",
    tool: "wakeflow_record_delivery_outcome",
  },
  "implementation-target-result-import": {
    owner: "target",
    tool: "wakeflow_import_target_result",
  },
  "implementation-host-effect-rearm": {
    owner: "controller",
    tool: "wakeflow_rearm_delivery",
  },
  "implementation-result-review": {
    owner: "controller",
    tool: "wakeflow_record_implementation_review_decision",
  },
  "implementation-review-blocked": {
    owner: "controller",
    tool: "wakeflow_record_implementation_review_decision",
  },
  "test-delivery-planning": {
    owner: "controller",
    tool: "wakeflow_prepare_delivery",
  },
  "test-host-effect-execution": {
    owner: "controller",
    tool: "wakeflow_record_delivery_outcome",
  },
  "test-host-effect-rearm": {
    owner: "controller",
    tool: "wakeflow_rearm_delivery",
  },
  "test-target-result-import": {
    owner: "test",
    tool: "wakeflow_import_target_result",
  },
  "test-result-review": {
    owner: "controller",
    tool: "wakeflow_record_test_review_decision",
  },
  "test-delivery-rerun-planning": {
    owner: "controller",
    tool: "wakeflow_prepare_delivery",
  },
  "test-review-blocked": {
    owner: "controller",
    tool: "wakeflow_record_test_review_decision",
  },
  "demand-completion-preflight": {
    owner: "controller",
    tool: "wakeflow_complete_demand",
  },
  "research-completion-required": { owner: "user", tool: null },
  "decision-required": { owner: "user", tool: "wakeflow_continue_demand" },
  "demand-continuation": {
    owner: "controller",
    tool: "wakeflow_continue_demand",
  },
});

export function deriveNextProjection(
  route: Readonly<NextProjectionRouteShape>,
): Readonly<NextProjection> {
  const blockers = Object.freeze(route.blockers.map((blocker) => blocker.kind));
  const first = route.frontiers[0];
  if (route.disposition === "terminal" || first === undefined) {
    return Object.freeze({
      frontier: null,
      owner: "none",
      suggestedTool: null,
      blockers,
    });
  }
  const mapped = NEXT_FRONTIER_TABLE[first.kind];
  if (route.disposition === "awaiting-decision") {
    return Object.freeze({
      frontier: first.kind,
      owner: "user",
      suggestedTool: mapped?.tool ?? null,
      blockers,
    });
  }
  if (route.disposition === "blocked") {
    return Object.freeze({
      frontier: first.kind,
      owner: mapped?.owner ?? "user",
      suggestedTool: null,
      blockers,
    });
  }
  return Object.freeze({
    frontier: first.kind,
    owner: mapped?.owner ?? "controller",
    suggestedTool: mapped?.tool ?? null,
    blockers,
  });
}
