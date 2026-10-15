import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import {
  derivePrepareBlockers,
  deriveRearmBlockers,
} from "../../../src/capabilities/delivery/decide.js";
import {
  WAKEFLOW_IMPLEMENTATION_TARGET_PHASE_RULES,
  WAKEFLOW_IMPLEMENTATION_TARGET_PHASES,
  WAKEFLOW_TEST_TARGET_PHASE_RULES,
  WAKEFLOW_TEST_TARGET_PHASES,
  type WakeflowImplementationTargetPhase,
  type WakeflowTestPostAcceptanceStage,
  type WakeflowTestTargetPhase,
  wakeflowRearmablePhase,
  wakeflowTargetPhaseAdmission,
} from "../../../src/contracts/vocabulary/wakeflow-target-phases.js";
import {
  type DemandControllerImplementationTargetPhase,
  type DemandControllerPostAcceptanceStageStatus,
  resolveDemandControllerImplementationFrontierDescriptor,
} from "../../../src/governance/controller/demand-controller-route.js";
import { DELIVERY_REARM_LIMIT } from "../../../src/governance/delivery/delivery-rearm.js";
import type { DemandTargetTaskState } from "../../../src/governance/demand/model/demand-aggregate-state.js";

type AggregateImplementationPhase = Exclude<
  DemandTargetTaskState,
  { readonly workType: "test" }
>["phase"];
type AggregateTestPhase = Extract<DemandTargetTaskState, { readonly workType: "test" }>["phase"];

/**
 * 类型层面的同一性（open-items L1）：阶段表的两个联合必须与聚合的阶段联合、Route 的实现阶段联合逐字相等，
 * 测试侧的 stage 名必须是 Post-Acceptance 的 stage status；多一个或少一个阶段都在这里编译失败。
 */
const PHASE_TYPE_COVERAGE = {
  implementationMatchesAggregate: true,
  implementationMatchesRoute: true,
  testMatchesAggregate: true,
  stagesArePostAcceptanceStatuses: true,
} as const satisfies Readonly<{
  readonly implementationMatchesAggregate: [
    Exclude<AggregateImplementationPhase, WakeflowImplementationTargetPhase>,
    Exclude<WakeflowImplementationTargetPhase, AggregateImplementationPhase>,
  ] extends [never, never]
    ? true
    : false;
  readonly implementationMatchesRoute: [
    Exclude<DemandControllerImplementationTargetPhase, WakeflowImplementationTargetPhase>,
    Exclude<WakeflowImplementationTargetPhase, DemandControllerImplementationTargetPhase>,
  ] extends [never, never]
    ? true
    : false;
  readonly testMatchesAggregate: [
    Exclude<AggregateTestPhase, WakeflowTestTargetPhase>,
    Exclude<WakeflowTestTargetPhase, AggregateTestPhase>,
  ] extends [never, never]
    ? true
    : false;
  readonly stagesArePostAcceptanceStatuses: Exclude<
    WakeflowTestPostAcceptanceStage,
    DemandControllerPostAcceptanceStageStatus
  > extends never
    ? true
    : false;
}>;

test("Target 阶段表与聚合、Route 的阶段联合同一，每个阶段恰有一条规则（L1）", () => {
  deepEqual(PHASE_TYPE_COVERAGE, {
    implementationMatchesAggregate: true,
    implementationMatchesRoute: true,
    testMatchesAggregate: true,
    stagesArePostAcceptanceStatuses: true,
  });
  deepEqual(
    [...Object.keys(WAKEFLOW_IMPLEMENTATION_TARGET_PHASE_RULES)].sort(),
    [...WAKEFLOW_IMPLEMENTATION_TARGET_PHASES].sort(),
  );
  deepEqual(
    [...Object.keys(WAKEFLOW_TEST_TARGET_PHASE_RULES)].sort(),
    [...WAKEFLOW_TEST_TARGET_PHASES].sort(),
  );
  equal(Object.isFrozen(WAKEFLOW_IMPLEMENTATION_TARGET_PHASE_RULES), true);
  equal(Object.isFrozen(WAKEFLOW_TEST_TARGET_PHASE_RULES), true);
  // 原型键不是阶段。
  equal(wakeflowTargetPhaseAdmission("implementation", "constructor"), null);
  equal(wakeflowTargetPhaseAdmission("test", "__proto__"), null);
  equal(wakeflowTargetPhaseAdmission("implementation", "test-delivery-prepared"), null);
});

test("Route 的实现前沿与 decide 的准备 / rearm 许可都从同一张表派生，而不是各自编码（L1）", () => {
  for (const phase of WAKEFLOW_IMPLEMENTATION_TARGET_PHASES) {
    const rule = WAKEFLOW_IMPLEMENTATION_TARGET_PHASE_RULES[phase];
    const descriptor = resolveDemandControllerImplementationFrontierDescriptor(phase);
    deepEqual(descriptor, rule.frontier === null ? null : { scope: "target", ...rule.frontier });
    if (descriptor !== null) equal(Object.isFrozen(descriptor), true);
    checkAdmission("implementation", phase, rule);
  }
  for (const phase of WAKEFLOW_TEST_TARGET_PHASES) {
    checkAdmission("test", phase, WAKEFLOW_TEST_TARGET_PHASE_RULES[phase]);
  }
  // 另一种工作类型的阶段在这边不是阶段：实现阶段不能当测试目标准备，反之亦然。
  deepEqual(derivePrepareBlockers({ workType: "test", phase: "rework-requested", generation: 1 }), [
    "target-phase:rework-requested",
  ]);
  deepEqual(
    derivePrepareBlockers({
      workType: "implementation",
      phase: "test-another-attempt-requested",
      generation: 1,
    }),
    ["target-phase:test-another-attempt-requested"],
  );
  equal(wakeflowRearmablePhase("delivery-prepared"), false);
  equal(wakeflowRearmablePhase("nonsense"), false);
});

function checkAdmission(
  workType: "implementation" | "test",
  phase: string,
  rule: Readonly<{
    readonly prepare: "yes" | "after-rearm-exhausted" | "no";
    readonly rearm: boolean;
  }>,
): void {
  const fresh = derivePrepareBlockers({ workType, phase, generation: null });
  const withinLimit = derivePrepareBlockers({ workType, phase, generation: 1 });
  const exhausted = derivePrepareBlockers({
    workType,
    phase,
    generation: DELIVERY_REARM_LIMIT + 1,
  });
  switch (rule.prepare) {
    case "yes":
      deepEqual([fresh, withinLimit, exhausted], [[], [], []], `${workType}/${phase}`);
      break;
    case "after-rearm-exhausted":
      deepEqual(fresh, [], `${workType}/${phase} without a generation`);
      deepEqual(withinLimit, ["rearm-available:1"], `${workType}/${phase} within the limit`);
      deepEqual(exhausted, [], `${workType}/${phase} after the limit`);
      break;
    case "no":
      deepEqual(
        [fresh, withinLimit, exhausted],
        [[`target-phase:${phase}`], [`target-phase:${phase}`], [`target-phase:${phase}`]],
        `${workType}/${phase}`,
      );
      break;
  }
  const rearm = deriveRearmBlockers({ phase, generation: 1 });
  deepEqual(rearm, rule.rearm ? [] : [`target-phase:${phase}`], `${workType}/${phase} rearm`);
  equal(wakeflowRearmablePhase(phase), rule.rearm);
}
