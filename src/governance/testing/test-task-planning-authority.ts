import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import { canonicalizeJson } from "../../foundation/data/canonical-json.js";
import {
  inspectWindowWorkClaim,
  WindowWorkClaimStoreError,
} from "../delivery/window-work-claim-store.js";
import type { DemandOperationAuthorityContext } from "../demand/demand-operation-authority-context.js";
import {
  DemandEventSourcingRepository,
  DemandEventSourcingRepositoryError,
} from "../demand/event-sourcing/demand-event-sourcing-repository.js";
import {
  buildDemandPostAcceptanceRoute,
  DemandPostAcceptanceRouteError,
} from "../review/demand-post-acceptance-route.js";
import {
  readDemandResultReviewSnapshot,
  DemandResultReviewSnapshotError,
} from "../review/demand-result-review-snapshot.js";
import type { TestTaskPackage } from "../tasking/task-package.js";
import type { TestCard } from "./test-card.js";
import {
  assertTestTaskPackageMatchesTestCard,
  TestTaskPackageError,
} from "./test-task-package.js";

/** Test Task Planning对TestCard Event、Config Test窗口和产品Claim的组合准入。 */

export interface TestTaskPlanningSources {
  readonly testCard: Readonly<TestCard>;
}

export type TestTaskPlanningAuthorityErrorReason =
  | "placement"
  | "route"
  | "test-card"
  | "config"
  | "authority"
  | "claim"
  | "task-package"
  | "aborted";

const ERROR_MESSAGES = {
  placement: "Test Task Planning currently requires main placement.",
  route: "Test Task Planning route is not admitted.",
  "test-card": "Test Task Planning TestCard Event is invalid.",
  config: "Test Task Planning Config Test window is invalid.",
  authority: "Test Task Planning Authority references are invalid.",
  claim: "Test Task Planning cannot retain a product WorkClaim.",
  "task-package":
    "Test Task Planning TaskPackage is not the TestCard projection.",
  aborted: "Test Task Planning authority loading was aborted.",
} as const satisfies Readonly<
  Record<TestTaskPlanningAuthorityErrorReason, string>
>;

export class TestTaskPlanningAuthorityError extends Error {
  override readonly name = "TestTaskPlanningAuthorityError";
  readonly code = "wakeflow-test-task-planning-authority" as const;
  readonly reason: TestTaskPlanningAuthorityErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;

  constructor(
    reason: TestTaskPlanningAuthorityErrorReason,
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
  reason: TestTaskPlanningAuthorityErrorReason,
  cause?: unknown,
): never {
  throw new TestTaskPlanningAuthorityError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
  );
}

function authorityContains(
  context: Readonly<DemandOperationAuthorityContext>,
  reference: unknown,
): boolean {
  const expected = canonicalizeJson(reference, "$expectedAuthorityReference");
  return context.loaded.authority.authorityRefs.some(
    (candidate) =>
      canonicalizeJson(candidate, "$authorityReference") === expected,
  );
}

async function assertProductClaimsAbsent(
  workspaceRoot: RootedDirectory,
  testCard: Readonly<TestCard>,
  signal: AbortSignal | undefined,
): Promise<void> {
  for (const windowId of [
    ...new Set(
      testCard.implementationBaselines.map((baseline) => baseline.windowId),
    ),
  ].sort()) {
    try {
      const claim = await inspectWindowWorkClaim(
        workspaceRoot,
        windowId,
        signal === undefined ? {} : { signal },
      );
      if (claim.status !== "absent") fail("claim");
    } catch (error: unknown) {
      if (error instanceof TestTaskPlanningAuthorityError) throw error;
      if (error instanceof WindowWorkClaimStoreError) {
        if (error.reason === "aborted") fail("aborted", error);
        fail("claim", error);
      }
      throw error;
    }
  }
}

export async function loadTestTaskPlanningSources(
  workspaceRoot: RootedDirectory,
  context: Readonly<DemandOperationAuthorityContext>,
  signal: AbortSignal | undefined,
): Promise<Readonly<TestTaskPlanningSources>> {
  if (context.loaded.identity.executionPlacement.mode !== "main") {
    fail("placement");
  }
  try {
    const snapshot = await readDemandResultReviewSnapshot(
      context.demandRoot,
      signal === undefined ? undefined : { signal },
    );
    const route = buildDemandPostAcceptanceRoute(context.loaded, snapshot);
    if (route.nextStage.status !== "test-task-planning") fail("route");
    const located = await new DemandEventSourcingRepository(
      context.demandRoot,
    ).findTestCardCreatedEvent(
      route.nextStage.testCard.testCardId,
      signal === undefined ? undefined : { signal },
    );
    if (located === null) fail("test-card");
    const testCard = located.event.data.testCard;
    if (
      testCard.testCardDigest !== route.nextStage.testCard.testCardDigest ||
      testCard.targetTaskId !== route.nextStage.testCard.targetTaskId ||
      testCard.testWindowId !== route.nextStage.testCard.testWindowId ||
      context.config.indexes.testWindow.windowId !== testCard.testWindowId ||
      context.config.indexes.testWindow.role !== "test"
    ) {
      fail("config");
    }
    if (
      !authorityContains(context, testCard.environmentAuthority) ||
      !testCard.testBasisAuthorities.every((reference) =>
        authorityContains(context, reference),
      )
    ) {
      fail("authority");
    }
    if (
      canonicalizeJson(
        testCard.implementationBaselines,
        "$testCardBaselines",
      ) !== canonicalizeJson(route.acceptedTargets, "$acceptedTargets")
    ) {
      fail("test-card");
    }
    await assertProductClaimsAbsent(workspaceRoot, testCard, signal);
    return Object.freeze({ testCard });
  } catch (error: unknown) {
    if (error instanceof TestTaskPlanningAuthorityError) throw error;
    if (error instanceof DemandResultReviewSnapshotError) {
      if (error.reason === "aborted") fail("aborted", error);
      fail("route", error);
    }
    if (error instanceof DemandPostAcceptanceRouteError) {
      fail("route", error);
    }
    if (error instanceof DemandEventSourcingRepositoryError) {
      if (error.reason === "aborted") fail("aborted", error);
      fail("test-card", error);
    }
    throw error;
  }
}

export function assertTestTaskPlanningPackage(
  context: Readonly<DemandOperationAuthorityContext>,
  taskPackage: Readonly<TestTaskPackage>,
  testCard: Readonly<TestCard>,
): void {
  if (
    context.loaded.identity.programId !== taskPackage.programId ||
    context.loaded.identity.demandId !== taskPackage.demandId ||
    context.loaded.authorityDigest !== taskPackage.demandAuthorityDigest ||
    context.config.configDigest !== taskPackage.configDigest ||
    context.config.indexes.testWindow.windowId !==
      taskPackage.assignment.windowId ||
    !taskPackage.selectedAuthorityRefs.every((reference) =>
      authorityContains(context, reference),
    )
  ) {
    fail("authority");
  }
  try {
    assertTestTaskPackageMatchesTestCard(taskPackage, testCard);
  } catch (error: unknown) {
    if (error instanceof TestTaskPackageError) fail("task-package", error);
    throw error;
  }
}
