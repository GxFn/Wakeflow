import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  resolveDemandControllerDemandFrontierDescriptor,
  resolveDemandControllerImplementationFrontierDescriptor,
  resolveDemandControllerPostAcceptanceFrontierDescriptor,
  type DemandControllerDemandFrontierCondition,
  type DemandControllerImplementationTargetPhase,
  type DemandControllerPostAcceptanceStageStatus,
} from "../../../src/governance/controller/demand-controller-route.js";

type ExpectedFrontier = Exclude<
  | ReturnType<typeof resolveDemandControllerDemandFrontierDescriptor>
  | ReturnType<typeof resolveDemandControllerImplementationFrontierDescriptor>
  | ReturnType<typeof resolveDemandControllerPostAcceptanceFrontierDescriptor>,
  null
>;

type FrontierMatrixRow =
  | Readonly<{
      readonly source: Readonly<{
        readonly kind: "demand";
        readonly conditions: readonly DemandControllerDemandFrontierCondition[];
      }>;
      readonly expected: ExpectedFrontier;
    }>
  | Readonly<{
      readonly source: Readonly<{
        readonly kind: "implementation";
        readonly phases: readonly Exclude<
          DemandControllerImplementationTargetPhase,
          "accepted"
        >[];
      }>;
      readonly expected: ExpectedFrontier;
    }>
  | Readonly<{
      readonly source: Readonly<{
        readonly kind: "post-acceptance";
        readonly statuses: readonly DemandControllerPostAcceptanceStageStatus[];
      }>;
      readonly expected: ExpectedFrontier;
    }>;

/**
 * Controller Route的完整轻量责任矩阵。
 *
 * 每行只表达一个公开frontier；共享同一owner的多个phase仍显式列出，避免新增phase
 * 静默继承错误责任。真实I/O、CAS与恢复行为继续由各owner纵切测试负责。
 */
const FRONTIER_MATRIX = [
  {
    source: {
      kind: "demand",
      conditions: ["implementation-planning-required"],
    },
    expected: {
      scope: "demand",
      kind: "implementation-task-planning",
      owner: "target-task-planning",
    },
  },
  {
    source: {
      kind: "demand",
      conditions: ["research-completion-required"],
    },
    expected: {
      scope: "demand",
      kind: "research-completion-required",
      owner: "demand-lifecycle",
    },
  },
  {
    source: {
      kind: "implementation",
      phases: [
        "planned",
        "rework-requested",
        "product-defect-rework-requested",
      ],
    },
    expected: {
      scope: "target",
      kind: "implementation-delivery-planning",
      owner: "target-delivery-preparation",
    },
  },
  {
    source: { kind: "implementation", phases: ["delivery-prepared"] },
    expected: {
      scope: "target",
      kind: "implementation-host-effect-claim",
      owner: "target-host-effect-claim",
    },
  },
  {
    source: { kind: "implementation", phases: ["host-effect-claimed"] },
    expected: {
      scope: "target",
      kind: "implementation-host-effect-execution",
      owner: "agent-host",
    },
  },
  {
    source: {
      kind: "implementation",
      phases: ["host-effect-accepted", "host-effect-indeterminate"],
    },
    expected: {
      scope: "target",
      kind: "implementation-target-result-import",
      owner: "target-result-import",
    },
  },
  {
    source: { kind: "implementation", phases: ["host-effect-rejected"] },
    expected: {
      scope: "target",
      kind: "implementation-host-effect-rearm",
      owner: "target-host-effect-rearm",
    },
  },
  {
    source: { kind: "implementation", phases: ["result-reported"] },
    expected: {
      scope: "target",
      kind: "implementation-result-review",
      owner: "controller-implementation-review",
    },
  },
  {
    source: { kind: "implementation", phases: ["review-blocked"] },
    expected: {
      scope: "target",
      kind: "implementation-review-resume",
      owner: "controller-target-review-resume",
    },
  },
  {
    source: { kind: "implementation", phases: ["redesign-requested"] },
    expected: {
      scope: "target",
      kind: "implementation-redesign-required",
      owner: "design",
    },
  },
  {
    source: {
      kind: "post-acceptance",
      statuses: ["completion-preflight"],
    },
    expected: {
      scope: "demand",
      kind: "demand-completion-preflight",
      owner: "demand-completion",
    },
  },
  {
    source: {
      kind: "post-acceptance",
      statuses: ["real-environment-test-planning"],
    },
    expected: {
      scope: "demand",
      kind: "test-card-planning",
      owner: "test-card-planning",
    },
  },
  {
    source: {
      kind: "post-acceptance",
      statuses: ["test-task-planning"],
    },
    expected: {
      scope: "demand",
      kind: "test-task-planning",
      owner: "test-task-planning",
    },
  },
  {
    source: {
      kind: "post-acceptance",
      statuses: ["test-delivery-planning"],
    },
    expected: {
      scope: "target",
      kind: "test-delivery-planning",
      owner: "test-delivery-preparation",
    },
  },
  {
    source: {
      kind: "post-acceptance",
      statuses: ["test-dispatch-planning"],
    },
    expected: {
      scope: "target",
      kind: "test-host-effect-claim",
      owner: "target-host-effect-claim",
    },
  },
  {
    source: {
      kind: "post-acceptance",
      statuses: ["test-host-effect-claimed"],
    },
    expected: {
      scope: "target",
      kind: "test-host-effect-execution",
      owner: "agent-host",
    },
  },
  {
    source: {
      kind: "post-acceptance",
      statuses: ["test-result-planning"],
    },
    expected: {
      scope: "target",
      kind: "test-target-result-import",
      owner: "target-result-import",
    },
  },
  {
    source: {
      kind: "post-acceptance",
      statuses: ["test-result-review-planning"],
    },
    expected: {
      scope: "target",
      kind: "test-result-review",
      owner: "controller-test-review",
    },
  },
  {
    source: {
      kind: "post-acceptance",
      statuses: ["test-another-attempt-planning"],
    },
    expected: {
      scope: "target",
      kind: "test-delivery-rerun-planning",
      owner: "test-delivery-preparation",
    },
  },
  {
    source: {
      kind: "post-acceptance",
      statuses: ["test-product-defect-escalated"],
    },
    expected: {
      scope: "target",
      kind: "product-defect-remediation-authorization",
      owner: "controller-product-defect-remediation",
    },
  },
  {
    source: {
      kind: "post-acceptance",
      statuses: ["test-review-blocked"],
    },
    expected: {
      scope: "target",
      kind: "test-review-resume",
      owner: "controller-target-review-resume",
    },
  },
  {
    source: {
      kind: "post-acceptance",
      statuses: ["test-delivery-replacement-planning"],
    },
    expected: {
      scope: "target",
      kind: "test-delivery-replacement-planning",
      owner: "test-delivery-preparation",
    },
  },
] as const satisfies readonly FrontierMatrixRow[];

type MatrixRow = (typeof FRONTIER_MATRIX)[number];
type DemandConditionInMatrix = Extract<
  MatrixRow,
  { readonly source: { readonly kind: "demand" } }
>["source"]["conditions"][number];
type ImplementationPhaseInMatrix = Extract<
  MatrixRow,
  { readonly source: { readonly kind: "implementation" } }
>["source"]["phases"][number];
type PostAcceptanceStatusInMatrix = Extract<
  MatrixRow,
  { readonly source: { readonly kind: "post-acceptance" } }
>["source"]["statuses"][number];

const MATRIX_TYPE_COVERAGE = {
  demand: true,
  implementation: true,
  postAcceptance: true,
} as const satisfies Readonly<{
  readonly demand: Exclude<
    DemandControllerDemandFrontierCondition,
    DemandConditionInMatrix
  > extends never
    ? true
    : false;
  readonly implementation: Exclude<
    Exclude<DemandControllerImplementationTargetPhase, "accepted">,
    ImplementationPhaseInMatrix
  > extends never
    ? true
    : false;
  readonly postAcceptance: Exclude<
    DemandControllerPostAcceptanceStageStatus,
    PostAcceptanceStatusInMatrix
  > extends never
    ? true
    : false;
}>;

test("Controller Route以二十二项轻量矩阵完整映射frontier、owner与phase", () => {
  equal(FRONTIER_MATRIX.length, 22);
  deepEqual(MATRIX_TYPE_COVERAGE, {
    demand: true,
    implementation: true,
    postAcceptance: true,
  });

  const frontierKinds = new Set<string>();
  for (const row of FRONTIER_MATRIX) {
    frontierKinds.add(row.expected.kind);
    switch (row.source.kind) {
      case "demand":
        for (const condition of row.source.conditions) {
          const actual =
            resolveDemandControllerDemandFrontierDescriptor(condition);
          deepEqual(actual, row.expected);
          equal(Object.isFrozen(actual), true);
        }
        break;
      case "implementation":
        for (const phase of row.source.phases) {
          const actual =
            resolveDemandControllerImplementationFrontierDescriptor(phase);
          deepEqual(actual, row.expected);
          equal(Object.isFrozen(actual), true);
        }
        break;
      case "post-acceptance":
        for (const status of row.source.statuses) {
          const actual =
            resolveDemandControllerPostAcceptanceFrontierDescriptor(status);
          deepEqual(actual, row.expected);
          equal(Object.isFrozen(actual), true);
        }
        break;
    }
  }

  equal(frontierKinds.size, 22);
  equal(
    resolveDemandControllerImplementationFrontierDescriptor("accepted"),
    null,
  );
});
