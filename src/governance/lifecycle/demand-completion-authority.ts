import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import {
  inspectWindowWorkClaim,
  WindowWorkClaimStoreError,
} from "../delivery/window-work-claim-store.js";
import type { DemandOperationAuthorityContext } from "../demand/demand-operation-authority-context.js";
import { WakeflowError } from "../../kernel/error.js";
import { readRequirementClaimState } from "../../kernel/requirement-board.js";
import {
  buildDemandPostAcceptanceRoute,
  type DemandPostAcceptanceRoute,
  type DemandPostAcceptanceNextStage,
} from "../review/demand-post-acceptance-route.js";
import {
  readDemandResultReviewSnapshot,
  DemandResultReviewSnapshotError,
} from "../review/demand-result-review-snapshot.js";
import type {
  DemandCompletionPackageSource,
  DemandCompletionRouteSource,
} from "./demand-completion.js";

/**
 * Wakeflow Governance / Lifecycle：Demand Completion对Route、看板认领和WorkClaim的组合准入。
 *
 * 本模块只读当前组合Authority。需求包必须仍以claimed状态由本Demand认领，所有accepted
 * 产品窗口和real-environment Test窗口必须没有WorkClaim；看板归档和宿主关闭仍属于后续owner。
 */

export interface DemandCompletionSources {
  readonly route: Readonly<DemandPostAcceptanceRoute>;
  readonly routeSource: Readonly<DemandCompletionRouteSource>;
  readonly controllerWindowId: DemandOperationAuthorityContext["config"]["indexes"]["controllerWindow"]["windowId"];
  readonly packageSource: Readonly<DemandCompletionPackageSource>;
}

type CompletionPreflightNextStage = Extract<
  DemandPostAcceptanceNextStage,
  { readonly status: "completion-preflight" }
>;

type DemandCompletionPreflightRoute = Omit<
  DemandPostAcceptanceRoute,
  "nextStage"
> & {
  readonly nextStage: Readonly<CompletionPreflightNextStage>;
};

export type DemandCompletionAuthorityErrorReason =
  "route" | "package" | "claim" | "aborted" | "operation-failure";

const ERROR_MESSAGES = {
  route: "Demand Completion post-acceptance route is not admitted.",
  package: "Demand Completion requirement package claim is invalid or stale.",
  claim: "Demand Completion cannot retain a participating window WorkClaim.",
  aborted: "Demand Completion authority loading was aborted.",
  "operation-failure": "Demand Completion authority loading failed.",
} as const satisfies Readonly<
  Record<DemandCompletionAuthorityErrorReason, string>
>;

/** Completion组合来源不闭合时的稳定错误。 */
export class DemandCompletionAuthorityError extends Error {
  override readonly name = "DemandCompletionAuthorityError";
  readonly code = "wakeflow-demand-completion-authority" as const;
  readonly reason: DemandCompletionAuthorityErrorReason;
  readonly causeCode: string | null;
  readonly causeReason: string | null;

  constructor(
    reason: DemandCompletionAuthorityErrorReason,
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
  reason: DemandCompletionAuthorityErrorReason,
  cause?: unknown,
): never {
  throw new DemandCompletionAuthorityError(
    reason,
    ownString(cause, "code"),
    ownString(cause, "reason"),
  );
}

async function loadRoute(
  context: Readonly<DemandOperationAuthorityContext>,
  signal: AbortSignal | undefined,
): Promise<Readonly<DemandCompletionPreflightRoute>> {
  try {
    const snapshot = await readDemandResultReviewSnapshot(
      context.demandRoot,
      signal === undefined ? undefined : { signal },
    );
    const route = buildDemandPostAcceptanceRoute(context.loaded, snapshot);
    if (
      route.nextStage.status !== "completion-preflight" ||
      route.nextStage.testingClosure.mode !==
        context.loaded.authority.testingDecision.mode
    ) {
      fail("route");
    }
    return route as Readonly<DemandCompletionPreflightRoute>;
  } catch (error: unknown) {
    if (error instanceof DemandCompletionAuthorityError) throw error;
    if (error instanceof DemandResultReviewSnapshotError) {
      if (error.reason === "aborted") fail("aborted", error);
      fail("route", error);
    }
    throw error;
  }
}

/** 需求包必须仍由本Demand认领；Completion只读取看板，归档留给后续owner。 */
async function loadPackageSource(
  workspaceRoot: RootedDirectory,
  context: Readonly<DemandOperationAuthorityContext>,
  signal: AbortSignal | undefined,
): Promise<Readonly<DemandCompletionPackageSource>> {
  const lineage = context.loaded.identity.source;
  try {
    const source = await readRequirementClaimState(
      workspaceRoot,
      lineage.requirementId,
      signal,
    );
    if (
      source === null ||
      source.state.programId !== context.loaded.identity.programId ||
      source.state.recordDigest !== lineage.recordDigest ||
      source.state.demandType !== context.loaded.identity.demandType ||
      source.state.status !== "claimed" ||
      source.state.claim === null ||
      source.state.claim.demandId !== context.loaded.identity.demandId
    ) {
      fail("package");
    }
    return Object.freeze({
      requirementId: lineage.requirementId,
      recordRef: lineage.recordRef,
      recordDigest: lineage.recordDigest,
      claimStateRevision: source.state.revision,
      claimStateDigest: source.digest,
    });
  } catch (error: unknown) {
    if (error instanceof DemandCompletionAuthorityError) throw error;
    if (error instanceof WakeflowError) {
      if (error.reason.endsWith("-aborted")) fail("aborted", error);
      fail("package", error);
    }
    throw error;
  }
}

async function assertNoWindowWorkClaims(
  workspaceRoot: RootedDirectory,
  route: Readonly<DemandCompletionPreflightRoute>,
  signal: AbortSignal | undefined,
): Promise<void> {
  const windowIds = [
    ...new Set(
      route.acceptedTargets
        .map((target) => target.windowId)
        .concat(
          route.nextStage.testingClosure.mode === "real-environment"
            ? [route.nextStage.testingClosure.testReview.testWindowId]
            : [],
        ),
    ),
  ].sort();
  for (const windowId of windowIds) {
    try {
      const result = await inspectWindowWorkClaim(
        workspaceRoot,
        windowId,
        signal === undefined ? {} : { signal },
      );
      if (result.status !== "absent") fail("claim");
    } catch (error: unknown) {
      if (error instanceof DemandCompletionAuthorityError) throw error;
      if (error instanceof WindowWorkClaimStoreError) {
        if (error.reason === "aborted") fail("aborted", error);
        fail("claim", error);
      }
      throw error;
    }
  }
}

/** 加载Completion preview/apply需要的当前Route、Controller、需求包认领和Claim事实。 */
export async function loadDemandCompletionSources(
  workspaceRoot: RootedDirectory,
  context: Readonly<DemandOperationAuthorityContext>,
  signal: AbortSignal | undefined,
): Promise<Readonly<DemandCompletionSources>> {
  const route = await loadRoute(context, signal);
  const packageSource = await loadPackageSource(workspaceRoot, context, signal);
  await assertNoWindowWorkClaims(workspaceRoot, route, signal);
  return Object.freeze({
    route,
    routeSource: Object.freeze({
      status: "completion-preflight" as const,
      testingClosure: Object.freeze({
        mode: route.nextStage.testingClosure.mode,
      }),
      programId: route.programId,
      demandId: route.demandId,
      authorityDigest: route.authorityDigest,
      routeDigest: route.routeDigest,
      reviewSnapshotDigest: route.reviewSnapshotDigest,
      observedState: route.observedEventStream,
    }),
    controllerWindowId: context.config.indexes.controllerWindow.windowId,
    packageSource,
  });
}
