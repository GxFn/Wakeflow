import type { WakeflowDurableId } from "../../contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import type { LoadedDemandEventSourcingRootAuthority } from "../demand/event-sourcing/demand-event-sourcing-root-authority.js";
import type { DemandTargetTaskState } from "../demand/model/demand-aggregate-state.js";
import { DELIVERY_REARM_LIMIT } from "../delivery/delivery-rearm.js";
import {
  buildDemandPostAcceptanceRoute,
  DemandPostAcceptanceRouteError,
  type DemandPostAcceptanceNextStage,
  type DemandPostAcceptanceRoute,
} from "../review/demand-post-acceptance-route.js";
import type { DemandResultReviewSnapshot } from "../review/demand-result-review-snapshot.js";

/**
 * Wakeflow Governance / Controller：从现有领域读模型组合出的当前责任前沿。
 *
 * 本Route不拥有Aggregate转换、Review解释或Test/Completion准入。它只把已经闭合的
 * current state映射给Controller application consumer；任何写owner仍须重读并复验自己的
 * 完整Authority。Route不持久化、不执行宿主效果，也不替Controller作业务判断。
 */

const DEMAND_CONTROLLER_ROUTE_KIND = "WakeflowDemandControllerRoute" as const;
const DEMAND_CONTROLLER_ROUTE_SCHEMA_VERSION = 1 as const;

type ImplementationTargetState = Exclude<
  DemandTargetTaskState,
  { readonly workType: "test" }
>;
type TestTargetState = Extract<
  DemandTargetTaskState,
  { readonly workType: "test" }
>;

export type DemandControllerDemandFrontierCondition =
  "implementation-planning-required" | "research-completion-required";
export type DemandControllerImplementationTargetPhase =
  ImplementationTargetState["phase"];
type ReadyPostAcceptanceStage = Exclude<
  DemandPostAcceptanceNextStage,
  { readonly status: "not-ready" }
>;
export type DemandControllerPostAcceptanceStageStatus =
  ReadyPostAcceptanceStage["status"];

export interface DemandControllerImplementationTargetReference {
  readonly workType: "implementation";
  readonly targetTaskId: WakeflowDurableId<"target-task">;
  readonly taskPackageId: WakeflowDurableId<"task-package">;
  readonly taskPackageDigest: Sha256Digest;
  readonly repositoryId: WakeflowDurableId<"repository">;
  readonly windowId: WakeflowDurableId<"window">;
  readonly phase: ImplementationTargetState["phase"];
}

export interface DemandControllerTestTargetReference {
  readonly workType: "test";
  readonly targetTaskId: WakeflowDurableId<"target-task">;
  readonly taskPackageId: WakeflowDurableId<"task-package">;
  readonly taskPackageDigest: Sha256Digest;
  readonly windowId: WakeflowDurableId<"window">;
  readonly phase: TestTargetState["phase"];
}

type DemandFrontierDescriptor =
  | Readonly<{
      readonly kind: "implementation-task-planning";
      readonly owner: "target-task-planning";
    }>
  | Readonly<{
      readonly kind: "research-completion-required";
      readonly owner: "demand-lifecycle";
    }>
  | Readonly<{
      readonly kind: "demand-completion-preflight";
      readonly owner: "demand-completion";
    }>
  | Readonly<{
      readonly kind: "test-task-planning";
      readonly owner: "test-task-planning";
    }>
  | Readonly<{
      readonly kind: "decision-required";
      readonly owner: "user";
    }>;

type ImplementationFrontierDescriptor =
  | Readonly<{
      readonly kind: "implementation-delivery-planning";
      readonly owner: "target-delivery-preparation";
    }>
  | Readonly<{
      readonly kind: "implementation-host-effect-execution";
      readonly owner: "agent-host";
    }>
  | Readonly<{
      readonly kind: "implementation-target-result-import";
      readonly owner: "target-result-import";
    }>
  | Readonly<{
      readonly kind: "implementation-host-effect-rearm";
      readonly owner: "target-host-effect-rearm";
    }>
  | Readonly<{
      readonly kind: "implementation-result-review";
      readonly owner: "controller-implementation-review";
    }>
  | Readonly<{
      /** blocked 之后等待外部条件解除；解除后 Controller 带 resumption 再决定（§13.87 D4）。 */
      readonly kind: "implementation-review-blocked";
      readonly owner: "controller-implementation-review";
    }>;

type TestFrontierDescriptor =
  | Readonly<{
      readonly kind: "test-delivery-planning";
      readonly owner: "test-delivery-preparation";
    }>
  | Readonly<{
      readonly kind: "test-host-effect-execution";
      readonly owner: "agent-host";
    }>
  | Readonly<{
      readonly kind: "test-host-effect-rearm";
      readonly owner: "target-host-effect-rearm";
    }>
  | Readonly<{
      readonly kind: "test-target-result-import";
      readonly owner: "target-result-import";
    }>
  | Readonly<{
      readonly kind: "test-result-review";
      readonly owner: "controller-test-review";
    }>
  | Readonly<{
      readonly kind: "test-delivery-rerun-planning";
      readonly owner: "test-delivery-preparation";
    }>
  | Readonly<{
      readonly kind: "test-review-blocked";
      readonly owner: "controller-test-review";
    }>;

type ScopedDemandFrontierDescriptor = Readonly<
  { readonly scope: "demand" } & DemandFrontierDescriptor
>;
type ScopedImplementationFrontierDescriptor = Readonly<
  { readonly scope: "target" } & ImplementationFrontierDescriptor
>;
type ScopedTestFrontierDescriptor = Readonly<
  { readonly scope: "target" } & TestFrontierDescriptor
>;

export type DemandControllerRouteFrontier =
  | Readonly<{ readonly scope: "demand" } & DemandFrontierDescriptor>
  | Readonly<
      {
        readonly scope: "target";
        readonly target: Readonly<DemandControllerImplementationTargetReference>;
      } & ImplementationFrontierDescriptor
    >
  | Readonly<
      {
        readonly scope: "target";
        readonly target: Readonly<DemandControllerTestTargetReference>;
      } & TestFrontierDescriptor
    >;

export type DemandControllerRouteBlocker =
  | Readonly<{
      /** 评审 blocked：外部条件未解除；同一结果上的下一份决定必须带 resumption。 */
      readonly kind: "external-condition";
      readonly owner: "controller-implementation-review" | "controller-test-review";
      readonly targetTaskId: WakeflowDurableId<"target-task">;
      readonly targetReviewDecisionId: WakeflowDurableId<"target-review-decision">;
      readonly decisionDigest: Sha256Digest;
    }>
  | Readonly<{
      /** research Demand 还没有 document 类受管证据，不能完成（§13.94 D8）。 */
      readonly kind: "research-evidence-missing";
      readonly owner: "demand-lifecycle";
    }>
  | Readonly<{
      readonly kind: "awaiting-decision";
      readonly owner: "user";
      readonly escalationEventId: WakeflowDurableId<"demand-event">;
    }>;

export interface DemandControllerRoute {
  readonly kind: typeof DEMAND_CONTROLLER_ROUTE_KIND;
  readonly schemaVersion: typeof DEMAND_CONTROLLER_ROUTE_SCHEMA_VERSION;
  readonly programId: WakeflowDurableId<"program">;
  readonly demandId: WakeflowDurableId<"demand">;
  readonly demandType: LoadedDemandEventSourcingRootAuthority["identity"]["demandType"];
  readonly lifecycle: LoadedDemandEventSourcingRootAuthority["aggregate"]["state"]["lifecycle"];
  readonly authorityDigest: Sha256Digest;
  readonly observedEventStream: DemandPostAcceptanceRoute["observedEventStream"];
  readonly reviewSnapshotDigest: Sha256Digest;
  readonly postAcceptanceRouteDigest?: Sha256Digest;
  readonly disposition:
    | "work-available"
    | "blocked"
    | "terminal"
    | "awaiting-decision";
  readonly frontiers: readonly Readonly<DemandControllerRouteFrontier>[];
  readonly blockers: readonly Readonly<DemandControllerRouteBlocker>[];
  readonly routeDigest: Sha256Digest;
}

export type DemandControllerRouteErrorReason =
  "post-acceptance-route" | "relation";

const ERROR_MESSAGES = {
  "post-acceptance-route":
    "Demand Controller Route could not rebuild its Post-Acceptance source.",
  relation: "Demand Controller Route sources are inconsistent.",
} as const satisfies Readonly<Record<DemandControllerRouteErrorReason, string>>;

export class DemandControllerRouteError extends Error {
  override readonly name = "DemandControllerRouteError";
  readonly code = "wakeflow-demand-controller-route" as const;
  readonly reason: DemandControllerRouteErrorReason;

  constructor(reason: DemandControllerRouteErrorReason) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
  }
}

function fail(reason: DemandControllerRouteErrorReason): never {
  throw new DemandControllerRouteError(reason);
}

/** 把无Implementation Target的Demand条件解析为唯一Controller责任前沿。 */
export function resolveDemandControllerDemandFrontierDescriptor(
  condition: DemandControllerDemandFrontierCondition,
): ScopedDemandFrontierDescriptor {
  switch (condition) {
    case "implementation-planning-required":
      return Object.freeze({
        scope: "demand" as const,
        kind: "implementation-task-planning" as const,
        owner: "target-task-planning" as const,
      });
    case "research-completion-required":
      return Object.freeze({
        scope: "demand" as const,
        kind: "research-completion-required" as const,
        owner: "demand-lifecycle" as const,
      });
  }
}

/** 把Implementation Target phase解析为唯一Controller责任前沿。 */
export function resolveDemandControllerImplementationFrontierDescriptor(
  phase: DemandControllerImplementationTargetPhase,
): ScopedImplementationFrontierDescriptor | null {
  switch (phase) {
    case "accepted":
    case "superseded":
      return null;
    case "planned":
    case "rework-requested":
    case "product-defect-rework-requested":
      return Object.freeze({
        scope: "target" as const,
        kind: "implementation-delivery-planning" as const,
        owner: "target-delivery-preparation" as const,
      });
    case "delivery-prepared":
      return Object.freeze({
        scope: "target" as const,
        kind: "implementation-host-effect-execution" as const,
        owner: "agent-host" as const,
      });
    case "host-effect-accepted":
    case "host-effect-indeterminate":
      return Object.freeze({
        scope: "target" as const,
        kind: "implementation-target-result-import" as const,
        owner: "target-result-import" as const,
      });
    case "host-effect-rejected":
      return Object.freeze({
        scope: "target" as const,
        kind: "implementation-host-effect-rearm" as const,
        owner: "target-host-effect-rearm" as const,
      });
    case "result-reported":
    case "escalated":
      // escalated 期间由 Demand 的 awaiting-decision 前沿覆盖；回答后回到评审。
      return Object.freeze({
        scope: "target" as const,
        kind: "implementation-result-review" as const,
        owner: "controller-implementation-review" as const,
      });
    case "review-blocked":
      return Object.freeze({
        scope: "target" as const,
        kind: "implementation-review-blocked" as const,
        owner: "controller-implementation-review" as const,
      });
  }
}

/** 把已闭合Post-Acceptance stage解析为唯一Controller责任前沿。 */
export function resolveDemandControllerPostAcceptanceFrontierDescriptor(
  status: DemandControllerPostAcceptanceStageStatus,
): ScopedDemandFrontierDescriptor | ScopedTestFrontierDescriptor {
  switch (status) {
    case "completion-preflight":
      return Object.freeze({
        scope: "demand" as const,
        kind: "demand-completion-preflight" as const,
        owner: "demand-completion" as const,
      });
    case "test-task-planning":
      return Object.freeze({
        scope: "demand" as const,
        kind: "test-task-planning" as const,
        owner: "test-task-planning" as const,
      });
    case "test-delivery-planning":
      return Object.freeze({
        scope: "target" as const,
        kind: "test-delivery-planning" as const,
        owner: "test-delivery-preparation" as const,
      });
    case "test-host-effect-execution":
      return Object.freeze({
        scope: "target" as const,
        kind: "test-host-effect-execution" as const,
        owner: "agent-host" as const,
      });
    case "test-result-planning":
      return Object.freeze({
        scope: "target" as const,
        kind: "test-target-result-import" as const,
        owner: "target-result-import" as const,
      });
    case "test-result-review-planning":
    case "test-review-escalated":
      return Object.freeze({
        scope: "target" as const,
        kind: "test-result-review" as const,
        owner: "controller-test-review" as const,
      });
    case "test-another-attempt-planning":
      return Object.freeze({
        scope: "target" as const,
        kind: "test-delivery-rerun-planning" as const,
        owner: "test-delivery-preparation" as const,
      });
    case "test-review-blocked":
      return Object.freeze({
        scope: "target" as const,
        kind: "test-review-blocked" as const,
        owner: "controller-test-review" as const,
      });
    case "test-delivery-rearm-planning":
      return Object.freeze({
        scope: "target" as const,
        kind: "test-host-effect-rearm" as const,
        owner: "target-host-effect-rearm" as const,
      });
  }
}

function isImplementationTarget(
  target: Readonly<DemandTargetTaskState>,
): target is Readonly<ImplementationTargetState> {
  return target.workType !== "test";
}

function implementationTargetReference(
  target: Readonly<ImplementationTargetState>,
): Readonly<DemandControllerImplementationTargetReference> {
  return Object.freeze({
    workType: "implementation" as const,
    targetTaskId: target.targetTaskId,
    taskPackageId: target.taskPackageId,
    taskPackageDigest: target.taskPackageDigest,
    repositoryId: target.repositoryId,
    windowId: target.windowId,
    phase: target.phase,
  });
}

function testTargetReference(
  target: Readonly<TestTargetState>,
): Readonly<DemandControllerTestTargetReference> {
  return Object.freeze({
    workType: "test" as const,
    targetTaskId: target.targetTaskId,
    taskPackageId: target.taskPackageId,
    taskPackageDigest: target.taskPackageDigest,
    windowId: target.windowId,
    phase: target.phase,
  });
}

function implementationFrontier(
  target: Readonly<ImplementationTargetState>,
): Readonly<{
  readonly frontier: Readonly<DemandControllerRouteFrontier> | null;
  readonly blocker: Readonly<DemandControllerRouteBlocker> | null;
}> {
  // rearm 用尽的发送前拒绝只剩换新信封一条路：前沿回到准备，而不是指向会被拒的 rearm。
  const rearmExhausted =
    target.phase === "host-effect-rejected" &&
    target.currentDelivery.generation > DELIVERY_REARM_LIMIT;
  const descriptor = resolveDemandControllerImplementationFrontierDescriptor(
    rearmExhausted ? "planned" : target.phase,
  );
  if (descriptor === null) {
    return Object.freeze({ frontier: null, blocker: null });
  }
  const blocker =
    target.phase === "review-blocked"
      ? Object.freeze({
          kind: "external-condition" as const,
          owner: "controller-implementation-review" as const,
          targetTaskId: target.targetTaskId,
          targetReviewDecisionId:
            target.currentDelivery.reviewDecision.targetReviewDecisionId,
          decisionDigest: target.currentDelivery.reviewDecision.decisionDigest,
        })
      : null;
  return Object.freeze({
    frontier: Object.freeze({
      ...descriptor,
      target: implementationTargetReference(target),
    }),
    blocker,
  });
}

function targetTaskIdFromPostAcceptanceStage(
  stage: ReadyPostAcceptanceStage,
): WakeflowDurableId<"target-task"> | null {
  switch (stage.status) {
    case "completion-preflight":
    case "test-task-planning":
      return null;
    case "test-delivery-planning":
      return stage.testTask.targetTaskId;
    case "test-host-effect-execution":
    case "test-result-planning":
      return stage.testDelivery.targetTaskId;
    case "test-result-review-planning":
      return stage.testResult.targetTaskId;
    case "test-another-attempt-planning":
    case "test-review-blocked":
    case "test-review-escalated":
      return stage.testReview.targetTaskId;
    case "test-delivery-rearm-planning":
      return stage.rejectedDelivery.targetTaskId;
  }
}

function postAcceptanceFrontier(
  loaded: Readonly<LoadedDemandEventSourcingRootAuthority>,
  route: Readonly<DemandPostAcceptanceRoute>,
): Readonly<DemandControllerRouteFrontier> {
  const stage = route.nextStage;
  if (stage.status === "not-ready") fail("relation");
  const rearmExhausted =
    stage.status === "test-delivery-rearm-planning" &&
    stage.rejectedDelivery.generation > DELIVERY_REARM_LIMIT;
  const descriptor = resolveDemandControllerPostAcceptanceFrontierDescriptor(
    rearmExhausted ? "test-delivery-planning" : stage.status,
  );
  if (descriptor.scope === "demand") {
    return descriptor;
  }
  const targetTaskId = targetTaskIdFromPostAcceptanceStage(stage);
  const target =
    targetTaskId === null
      ? undefined
      : loaded.aggregate.state.targetTasks.find(
          (entry) =>
            entry.workType === "test" && entry.targetTaskId === targetTaskId,
        );
  if (target === undefined || target.workType !== "test") fail("relation");
  return Object.freeze({
    ...descriptor,
    target: testTargetReference(target),
  });
}

/** test-review-blocked 前沿携带外部条件阻塞项；其余 post-acceptance 前沿没有阻塞项。 */
function postAcceptanceBlocker(
  route: Readonly<DemandPostAcceptanceRoute>,
): Readonly<DemandControllerRouteBlocker> | null {
  const stage = route.nextStage;
  if (stage.status !== "test-review-blocked") return null;
  return Object.freeze({
    kind: "external-condition" as const,
    owner: "controller-test-review" as const,
    targetTaskId: stage.testReview.targetTaskId,
    targetReviewDecisionId: stage.testReview.targetReviewDecisionId,
    decisionDigest: stage.testReview.decisionDigest,
  });
}

function frontierSortKey(
  frontier: Readonly<DemandControllerRouteFrontier>,
): string {
  return frontier.scope === "demand"
    ? `0\u0000${frontier.kind}`
    : `1\u0000${frontier.target.targetTaskId}\u0000${frontier.kind}`;
}

function sortedFrontiers(
  values: readonly Readonly<DemandControllerRouteFrontier>[],
): readonly Readonly<DemandControllerRouteFrontier>[] {
  return Object.freeze(
    [...values].sort((left, right) => {
      const leftKey = frontierSortKey(left);
      const rightKey = frontierSortKey(right);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    }),
  );
}

function routeBasis(
  loaded: Readonly<LoadedDemandEventSourcingRootAuthority>,
  postAcceptanceRoute: Readonly<DemandPostAcceptanceRoute>,
): Omit<DemandControllerRoute, "routeDigest"> {
  const lifecycle = loaded.aggregate.state.lifecycle;
  const common = {
    kind: DEMAND_CONTROLLER_ROUTE_KIND,
    schemaVersion: DEMAND_CONTROLLER_ROUTE_SCHEMA_VERSION,
    programId: loaded.identity.programId,
    demandId: loaded.identity.demandId,
    demandType: loaded.identity.demandType,
    lifecycle,
    authorityDigest: loaded.authorityDigest,
    observedEventStream: postAcceptanceRoute.observedEventStream,
    reviewSnapshotDigest: postAcceptanceRoute.reviewSnapshotDigest,
  } as const;

  if (lifecycle === "cancelled" || lifecycle === "completed") {
    if (
      postAcceptanceRoute.nextStage.status !== "not-ready" ||
      postAcceptanceRoute.nextStage.reason !== `demand-${lifecycle}`
    ) {
      fail("relation");
    }
    return {
      ...common,
      disposition: "terminal",
      frontiers: Object.freeze([]),
      blockers: Object.freeze([]),
    };
  }

  const awaitingDecision = loaded.aggregate.state.awaitingDecision;
  if (awaitingDecision !== undefined) {
    return {
      ...common,
      disposition: "awaiting-decision",
      frontiers: Object.freeze([
        Object.freeze({
          scope: "demand" as const,
          kind: "decision-required" as const,
          owner: "user" as const,
        }),
      ]),
      blockers: Object.freeze([
        Object.freeze({
          kind: "awaiting-decision" as const,
          owner: "user" as const,
          escalationEventId: awaitingDecision.escalationEventId,
        }),
      ]),
    };
  }
  if (loaded.aggregate.state.continuation?.planningRequired === true) {
    // 续接后先规划新的任务包；已接受的历史目标不再构成完成前置。
    return {
      ...common,
      disposition: "work-available",
      frontiers: Object.freeze([
        resolveDemandControllerDemandFrontierDescriptor(
          "implementation-planning-required",
        ),
      ]),
      blockers: Object.freeze([]),
    };
  }

  const implementationTargets = loaded.aggregate.state.targetTasks.filter(
    isImplementationTarget,
  );
  if (implementationTargets.length === 0) {
    if (loaded.identity.demandType === "research") {
      const stage = postAcceptanceRoute.nextStage;
      const frontiers = Object.freeze([
        resolveDemandControllerDemandFrontierDescriptor("research-completion-required"),
      ]);
      if (stage.status === "completion-preflight" && stage.testingClosure.mode === "not-applicable") {
        return { ...common, disposition: "work-available", frontiers, blockers: Object.freeze([]) };
      }
      if (stage.status !== "not-ready" || stage.reason !== "research-evidence-missing") {
        fail("relation");
      }
      return {
        ...common,
        disposition: "blocked",
        frontiers,
        blockers: Object.freeze([
          Object.freeze({
            kind: "research-evidence-missing" as const,
            owner: "demand-lifecycle" as const,
          }),
        ]),
      };
    }
    if (
      postAcceptanceRoute.nextStage.status !== "not-ready" ||
      postAcceptanceRoute.nextStage.reason !== "no-target-tasks"
    ) {
      fail("relation");
    }
    return {
      ...common,
      disposition: "work-available",
      frontiers: Object.freeze([
        resolveDemandControllerDemandFrontierDescriptor(
          "implementation-planning-required",
        ),
      ]),
      blockers: Object.freeze([]),
    };
  }

  const openImplementationTargets = implementationTargets.filter(
    (target) => target.phase !== "accepted" && target.phase !== "superseded",
  );
  if (openImplementationTargets.length > 0) {
    if (
      postAcceptanceRoute.nextStage.status !== "not-ready" ||
      postAcceptanceRoute.nextStage.reason !== "targets-not-accepted"
    ) {
      fail("relation");
    }
    const frontiers: Readonly<DemandControllerRouteFrontier>[] = [];
    const blockers: Readonly<DemandControllerRouteBlocker>[] = [];
    for (const target of openImplementationTargets) {
      const mapped = implementationFrontier(target);
      if (mapped.frontier !== null) frontiers.push(mapped.frontier);
      if (mapped.blocker !== null) blockers.push(mapped.blocker);
    }
    if (frontiers.length !== openImplementationTargets.length) {
      fail("relation");
    }
    return {
      ...common,
      disposition:
        blockers.length === frontiers.length ? "blocked" : "work-available",
      frontiers: sortedFrontiers(frontiers),
      blockers: Object.freeze(blockers),
    };
  }

  if (postAcceptanceRoute.nextStage.status === "not-ready") fail("relation");
  const postAcceptanceFrontierValue = postAcceptanceFrontier(
    loaded,
    postAcceptanceRoute,
  );
  const blocker = postAcceptanceBlocker(postAcceptanceRoute);
  return {
    ...common,
    postAcceptanceRouteDigest: postAcceptanceRoute.routeDigest,
    disposition: blocker === null ? "work-available" : "blocked",
    frontiers: Object.freeze([postAcceptanceFrontierValue]),
    blockers: Object.freeze(blocker === null ? [] : [blocker]),
  };
}

/** 从同一次已验证Authority与Review Snapshot构造确定性的Controller责任Route。 */
export function buildDemandControllerRoute(
  loaded: Readonly<LoadedDemandEventSourcingRootAuthority>,
  snapshot: Readonly<DemandResultReviewSnapshot>,
): Readonly<DemandControllerRoute> {
  let postAcceptanceRoute: Readonly<DemandPostAcceptanceRoute>;
  try {
    postAcceptanceRoute = buildDemandPostAcceptanceRoute(loaded, snapshot);
  } catch (error: unknown) {
    if (error instanceof DemandPostAcceptanceRouteError) {
      fail("post-acceptance-route");
    }
    throw error;
  }
  const basis = routeBasis(loaded, postAcceptanceRoute);
  return Object.freeze({
    ...basis,
    routeDigest: computeCanonicalJsonSha256Digest(basis),
  });
}
