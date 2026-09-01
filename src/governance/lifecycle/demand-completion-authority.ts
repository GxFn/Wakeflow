import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import {
  inspectWindowWorkClaim,
  WindowWorkClaimStoreError,
} from "../delivery/window-work-claim-store.js";
import type { DemandOperationAuthorityContext } from "../demand/demand-operation-authority-context.js";
import { demandFinalRootRef } from "../demand/publication/demand-publication-paths.js";
import {
  inspectTodoItems,
  TodoCollectionServiceError,
} from "../todo/todo-collection-service.js";
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
  DemandCompletionRouteSource,
  DemandCompletionTodoSource,
} from "./demand-completion.js";

/**
 * Wakeflow Governance / Lifecycle：Demand Completion对Route、TODO和WorkClaim的组合准入。
 *
 * 本模块只读当前组合Authority。TODO必须继续以claimed状态精确挂载到Demand，所有accepted
 * 产品窗口和real-environment Test窗口必须没有WorkClaim；TODO归档和宿主关闭仍属于后续owner。
 */

export interface DemandCompletionSources {
  readonly route: Readonly<DemandPostAcceptanceRoute>;
  readonly routeSource: Readonly<DemandCompletionRouteSource>;
  readonly controllerWindowId: DemandOperationAuthorityContext["config"]["indexes"]["controllerWindow"]["windowId"];
  readonly todoSource: Readonly<DemandCompletionTodoSource>;
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
  "route" | "todo" | "claim" | "aborted" | "operation-failure";

const ERROR_MESSAGES = {
  route: "Demand Completion post-acceptance route is not admitted.",
  todo: "Demand Completion TODO authority is invalid or stale.",
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

async function loadTodoSource(
  workspaceRoot: RootedDirectory,
  context: Readonly<DemandOperationAuthorityContext>,
  signal: AbortSignal | undefined,
): Promise<Readonly<DemandCompletionTodoSource>> {
  try {
    const snapshot = await inspectTodoItems(workspaceRoot, signal);
    const item = snapshot.items.find(
      (candidate) => candidate.todoId === context.loaded.identity.source.todoId,
    );
    if (
      item === undefined ||
      item.intakeSource.resourcePath !==
        context.loaded.identity.source.intakeRef ||
      item.intakeDigest !== context.loaded.identity.source.intakeDigest ||
      item.intake.testingDecision.mode !==
        context.loaded.authority.testingDecision.mode ||
      item.intake.testingDecision.summary !==
        context.loaded.authority.testingDecision.summary ||
      item.state.status !== "claimed" ||
      item.state.mount === null ||
      item.state.mount.demandId !== context.loaded.identity.demandId ||
      item.state.mount.stateRootRef !==
        demandFinalRootRef(context.loaded.identity.demandId) ||
      item.state.mount.identityDigest !== context.loaded.identityDigest
    ) {
      fail("todo");
    }
    return Object.freeze({
      todoId: item.todoId,
      intakeRef: item.intakeSource.resourcePath,
      intakeDigest: item.intakeDigest,
      stateRevision: item.state.revision,
      stateDigest: item.stateDigest,
    });
  } catch (error: unknown) {
    if (error instanceof DemandCompletionAuthorityError) throw error;
    if (error instanceof TodoCollectionServiceError) {
      if (error.reason === "aborted") fail("aborted", error);
      fail("todo", error);
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

/** 加载Completion preview/apply需要的当前Route、Controller、TODO和Claim事实。 */
export async function loadDemandCompletionSources(
  workspaceRoot: RootedDirectory,
  context: Readonly<DemandOperationAuthorityContext>,
  signal: AbortSignal | undefined,
): Promise<Readonly<DemandCompletionSources>> {
  const route = await loadRoute(context, signal);
  const todoSource = await loadTodoSource(workspaceRoot, context, signal);
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
    todoSource,
  });
}
