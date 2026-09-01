import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import type { WakeflowDurableId } from "../../contracts/identity/wakeflow-durable-id.js";
import {
  inspectWindowWorkClaim,
  WindowWorkClaimStoreError,
} from "../delivery/window-work-claim-store.js";
import type { DemandOperationAuthorityContext } from "../demand/demand-operation-authority-context.js";
import {
  DemandEventSourcingRepository,
  DemandEventSourcingRepositoryError,
  type AuditedDemandTargetResultHistory,
} from "../demand/event-sourcing/demand-event-sourcing-repository.js";
import type { DemandType } from "../demand/model/demand-identity.js";
import type { LedgerAuthorityMemberReference } from "../ledger/ledger-authority-store.js";
import type { ControllerProductDefectRemediationAuthorization } from "../review/controller-product-defect-remediation-authorization.js";
import {
  buildDemandPostAcceptanceRoute,
  DemandPostAcceptanceRouteError,
} from "../review/demand-post-acceptance-route.js";
import {
  buildDemandResultReviewSnapshotFromHistory,
  DemandResultReviewSnapshotError,
} from "../review/demand-result-review-snapshot.js";
import type {
  TestCardBasisAuthorities,
  TestCardRouteSource,
} from "./test-card.js";
import {
  parseTestCardGenerationSource,
  TestCardGenerationSourceError,
  type TestCardGenerationSource,
} from "./test-card-generation-source.js";

/** TestCard Planning对real-environment Route、Config Test Window和WorkClaim的组合准入。 */

const TEST_BASIS_ROLES = Object.freeze({
  requirement: Object.freeze(["requirement-design"] as const),
  bug: Object.freeze(["reproduction", "scope"] as const),
  supplement: Object.freeze([
    "requirement-design",
    "requirement-delta",
  ] as const),
  research: Object.freeze([] as const),
}) satisfies Readonly<
  Record<DemandType, readonly LedgerAuthorityMemberReference["role"][]>
>;

export interface TestCardPlanningSources {
  readonly routeSource: Readonly<TestCardRouteSource>;
  readonly generationSource: Readonly<TestCardGenerationSource>;
  readonly generationAuthorization?: Readonly<ControllerProductDefectRemediationAuthorization>;
  readonly requirementGoal: string;
  readonly testWindowId: DemandOperationAuthorityContext["config"]["indexes"]["testWindow"]["windowId"];
}

export type TestCardPlanningAuthorityErrorReason =
  | "route"
  | "placement"
  | "claim"
  | "test-basis"
  | "generation-source"
  | "aborted"
  | "operation-failure";

const ERROR_MESSAGES = {
  route: "TestCard Planning real-environment route is not admitted.",
  placement: "TestCard Planning currently requires main execution placement.",
  claim: "TestCard Planning cannot retain a product window WorkClaim.",
  "test-basis": "TestCard Planning Test Basis Authority is not admitted.",
  "generation-source":
    "TestCard Planning generation lineage is invalid or ambiguous.",
  aborted: "TestCard Planning authority loading was aborted.",
  "operation-failure": "TestCard Planning authority loading failed.",
} as const satisfies Readonly<
  Record<TestCardPlanningAuthorityErrorReason, string>
>;

export class TestCardPlanningAuthorityError extends Error {
  override readonly name = "TestCardPlanningAuthorityError";
  readonly code = "wakeflow-test-card-planning-authority" as const;
  readonly reason: TestCardPlanningAuthorityErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;

  constructor(
    reason: TestCardPlanningAuthorityErrorReason,
    causeCode: string | null = null,
    causeReason: string | null = null,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.causeCode = causeCode;
    this.causeReason = causeReason;
  }
}

function ownString(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined &&
    Object.hasOwn(descriptor, "value") &&
    typeof descriptor.value === "string"
    ? descriptor.value
    : null;
}

function fail(
  reason: TestCardPlanningAuthorityErrorReason,
  cause?: unknown,
): never {
  throw new TestCardPlanningAuthorityError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
  );
}

/** 按Demand类型恢复完整、非空且稳定有序的Test Basis Authority集合。 */
export function deriveTestCardBasisAuthorities(
  demandType: DemandType,
  authorityRefs: readonly Readonly<LedgerAuthorityMemberReference>[],
): TestCardBasisAuthorities {
  const roles: readonly LedgerAuthorityMemberReference["role"][] =
    TEST_BASIS_ROLES[demandType];
  if (roles.length === 0) fail("test-basis");
  const candidates = authorityRefs
    .filter((reference) => roles.includes(reference.role))
    .sort((left, right) =>
      left.memberRef < right.memberRef
        ? -1
        : left.memberRef > right.memberRef
          ? 1
          : 0,
    );
  if (
    roles.some(
      (role) => !candidates.some((reference) => reference.role === role),
    )
  ) {
    fail("test-basis");
  }
  const first = candidates[0];
  if (first === undefined) fail("test-basis");
  return Object.freeze([first, ...candidates.slice(1)]);
}

async function assertNoProductClaims(
  workspaceRoot: RootedDirectory,
  windowIds: readonly WakeflowDurableId<"window">[],
  signal: AbortSignal | undefined,
): Promise<void> {
  for (const windowId of [...new Set(windowIds)].sort()) {
    try {
      const inspected = await inspectWindowWorkClaim(
        workspaceRoot,
        windowId,
        signal === undefined ? {} : { signal },
      );
      if (inspected.status !== "absent") fail("claim");
    } catch (error: unknown) {
      if (error instanceof TestCardPlanningAuthorityError) throw error;
      if (error instanceof WindowWorkClaimStoreError) {
        if (error.reason === "aborted") fail("aborted", error);
        fail("claim", error);
      }
      throw error;
    }
  }
}

function testCardGenerationAuthority(
  history: Readonly<AuditedDemandTargetResultHistory>,
): Readonly<{
  readonly generationSource: Readonly<TestCardGenerationSource>;
  readonly generationAuthorization?: Readonly<ControllerProductDefectRemediationAuthorization>;
}> {
  const testTargets = history.aggregate.state.targetTasks.filter(
    (target) => target.workType === "test",
  );
  const pendingTestRetest = history.aggregate.state.pendingTestRetest;
  if (testTargets.length === 0) {
    if (
      pendingTestRetest !== undefined ||
      history.testCards.length !== 0 ||
      history.productDefectRemediationAuthorizations.length !== 0
    ) {
      fail("generation-source");
    }
    return Object.freeze({
      generationSource: Object.freeze({ kind: "initial" as const }),
    });
  }
  if (pendingTestRetest === undefined) fail("generation-source");
  const candidates = history.productDefectRemediationAuthorizations.filter(
    (source) => {
      const authorization = source.authorization;
      return (
        authorization.productDefectRemediationId ===
          pendingTestRetest.productDefectRemediation
            .productDefectRemediationId &&
        authorization.authorizationDigest ===
          pendingTestRetest.productDefectRemediation.authorizationDigest &&
        authorization.source.testCard.testCardId ===
          pendingTestRetest.previousTestCard.testCardId &&
        authorization.source.testCard.testCardDigest ===
          pendingTestRetest.previousTestCard.testCardDigest &&
        authorization.source.testReviewDecision.targetReviewDecisionId ===
          pendingTestRetest.testReviewDecision.targetReviewDecisionId &&
        authorization.source.testReviewDecision.decisionDigest ===
          pendingTestRetest.testReviewDecision.decisionDigest
      );
    },
  );
  const source = candidates[0];
  if (
    candidates.length !== 1 ||
    source === undefined ||
    history.testCards.some(
      (card) =>
        card.generationSource.kind === "product-defect-retest" &&
        card.generationSource.productDefectRemediation
          .productDefectRemediationId ===
          pendingTestRetest.productDefectRemediation.productDefectRemediationId,
    )
  ) {
    fail("generation-source");
  }
  return Object.freeze({
    generationSource: pendingTestRetest,
    generationAuthorization: source.authorization,
  });
}

/** Apply幂等路径从Event history恢复retest Command所需的完整Authorization。 */
export async function loadTestCardPlanningGenerationAuthorizationFromEventHistory(
  repository: DemandEventSourcingRepository,
  generationSourceValue: unknown,
  signal: AbortSignal | undefined,
): Promise<
  Readonly<ControllerProductDefectRemediationAuthorization> | undefined
> {
  let generationSource: Readonly<TestCardGenerationSource>;
  try {
    generationSource = parseTestCardGenerationSource(generationSourceValue);
  } catch (error: unknown) {
    if (error instanceof TestCardGenerationSourceError) {
      fail("generation-source", error);
    }
    throw error;
  }
  if (generationSource.kind === "initial") return undefined;
  try {
    const history = await repository.auditTargetResultHistory(
      signal === undefined ? undefined : { signal },
    );
    const source = history.productDefectRemediationAuthorizations.find(
      (entry) =>
        entry.authorization.productDefectRemediationId ===
        generationSource.productDefectRemediation.productDefectRemediationId,
    );
    const authorization = source?.authorization;
    if (
      authorization === undefined ||
      authorization.authorizationDigest !==
        generationSource.productDefectRemediation.authorizationDigest ||
      authorization.source.testCard.testCardId !==
        generationSource.previousTestCard.testCardId ||
      authorization.source.testCard.testCardDigest !==
        generationSource.previousTestCard.testCardDigest ||
      authorization.source.testReviewDecision.targetReviewDecisionId !==
        generationSource.testReviewDecision.targetReviewDecisionId ||
      authorization.source.testReviewDecision.decisionDigest !==
        generationSource.testReviewDecision.decisionDigest
    ) {
      fail("generation-source");
    }
    return authorization;
  } catch (error: unknown) {
    if (error instanceof TestCardPlanningAuthorityError) throw error;
    if (error instanceof DemandEventSourcingRepositoryError) {
      if (error.reason === "aborted") fail("aborted", error);
      fail("generation-source", error);
    }
    throw error;
  }
}

export async function loadTestCardPlanningSources(
  workspaceRoot: RootedDirectory,
  context: Readonly<DemandOperationAuthorityContext>,
  signal: AbortSignal | undefined,
): Promise<Readonly<TestCardPlanningSources>> {
  if (context.loaded.identity.executionPlacement.mode !== "main") {
    fail("placement");
  }
  try {
    const history = await new DemandEventSourcingRepository(
      context.demandRoot,
    ).auditTargetResultHistory(signal === undefined ? undefined : { signal });
    if (
      history.aggregate.streamRevision !==
        context.loaded.aggregate.streamRevision ||
      history.aggregate.stateDigest !== context.loaded.aggregate.stateDigest
    ) {
      fail("route");
    }
    const snapshot = buildDemandResultReviewSnapshotFromHistory(history);
    const route = buildDemandPostAcceptanceRoute(context.loaded, snapshot);
    if (route.nextStage.status !== "real-environment-test-planning") {
      fail("route");
    }
    await assertNoProductClaims(
      workspaceRoot,
      route.acceptedTargets.map((target) => target.windowId),
      signal,
    );
    const testBasisAuthorities = deriveTestCardBasisAuthorities(
      context.loaded.identity.demandType,
      context.loaded.authority.authorityRefs,
    );
    const first = route.acceptedTargets[0];
    if (first === undefined) fail("route");
    const implementationBaselines: TestCardRouteSource["implementationBaselines"] =
      Object.freeze([first, ...route.acceptedTargets.slice(1)]);
    return Object.freeze({
      routeSource: Object.freeze({
        programId: route.programId,
        demandId: route.demandId,
        demandAuthorityDigest: route.authorityDigest,
        environmentAuthority: route.nextStage.testEnvironmentAuthority,
        testBasisAuthorities,
        postAcceptanceRouteDigest: route.routeDigest,
        reviewSnapshotDigest: route.reviewSnapshotDigest,
        streamRevision: route.observedEventStream.streamRevision,
        stateDigest: route.observedEventStream.stateDigest,
        lastEventId: route.observedEventStream.lastEventId,
        lastEventDigest: route.observedEventStream.lastEventDigest,
        implementationBaselines,
      }),
      ...testCardGenerationAuthority(history),
      requirementGoal: context.loaded.identity.goal,
      testWindowId: context.config.indexes.testWindow.windowId,
    });
  } catch (error: unknown) {
    if (error instanceof TestCardPlanningAuthorityError) throw error;
    if (error instanceof DemandResultReviewSnapshotError) {
      if (error.reason === "aborted") fail("aborted", error);
      fail("route", error);
    }
    if (error instanceof DemandPostAcceptanceRouteError) {
      fail("route", error);
    }
    if (error instanceof DemandEventSourcingRepositoryError) {
      if (error.reason === "aborted") fail("aborted", error);
      fail("generation-source", error);
    }
    throw error;
  }
}
