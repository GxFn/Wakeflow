import type { DemandTargetTaskState } from "../demand/model/demand-aggregate-state.js";
import type { DemandResultReviewSnapshot } from "../review/demand-result-review-snapshot.js";
import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import type { UtcInstant } from "../../foundation/time/utc-instant.js";
import {
  inspectActiveProjectionTargets,
  renderActiveProjectionFiles,
  type ActiveProjectionDemandFacts,
  type ActiveProjectionFacts,
  type ActiveProjectionProgressFacts,
  type ActiveProjectionTargetInspection,
  type ActiveProjectionUnmergedFacts,
} from "../../kernel/active-projection.js";
import { WakeflowError } from "../../kernel/error.js";
import { deriveNextProjection } from "../../kernel/next-projection.js";
import type {
  ObservedDemand,
  ObservedDomain,
  WorkspaceObservation,
} from "./workspace-observation.js";

/**
 * Wakeflow Governance / Observation：把观察记录压成内核投影事实（gate-log §13.94 D5）。
 *
 * 事实只含标识、显示名与摘要，没有路径与句柄；活动投影与 status 的 `unmergedAccepted`
 * 都从这里取。分支是否合并只在 full 作用域里按仓库指针核对；projection 作用域全部列出。
 */

export interface AcceptedBranchFact extends ActiveProjectionUnmergedFacts {
  /** 评审决定的 decidedAt。 */
  readonly acceptedAt: UtcInstant;
  /** 是否按仓库指针核对过（分支仍在且未合并）；仓库未观察时为 false，条目保留。 */
  readonly repositoryObserved: boolean;
}

/** 一个仓库的指针事实：当前 HEAD 解析到的提交与每个分支的尖端。 */
export interface RepositoryBranchTips {
  readonly head: string | null;
  /** HEAD 所在分支；分离头为 null。 */
  readonly branch: string | null;
  readonly tips: ReadonlyMap<string, string>;
}

function progressOf(targets: readonly Readonly<DemandTargetTaskState>[]): ActiveProjectionProgressFacts {
  const implementation = targets.filter(
    (target) => target.workType !== "test" && target.phase !== "superseded",
  );
  const tests = targets.filter((target) => target.workType === "test");
  return Object.freeze({
    implementationTargets: implementation.length,
    implementationAccepted: implementation.filter((target) => target.phase === "accepted").length,
    deliveriesInFlight: targets.filter(
      (target) => target.phase.includes("delivery-prepared") || target.phase.includes("host-effect-"),
    ).length,
    resultsAwaitingReview: targets.filter((target) => target.phase.endsWith("result-reported")).length,
    testTargets: tests.length,
    testAccepted: tests.filter((target) => target.phase === "test-accepted").length,
  });
}

/** 尖端等于仓库当前所在分支的尖端才算已合并；正检出在该分支上或分离头时无法判定，保留。 */
function mergedIntoCurrentBranch(
  repository: Readonly<RepositoryBranchTips>,
  branch: string,
  tip: string,
): boolean {
  return repository.branch !== null && repository.branch !== branch && tip === repository.head;
}

/**
 * 已接受实现结果里带分支与提交、且分支仍未合并的条目（§13.94 D2）：分支引用仍在仓库，且尖端
 * 不等于仓库当前所在分支的尖端。没有对象图不能判祖先，"尖端等于当前分支尖端"是唯一可用的已合并
 * 判定；分支已删除即不再列出。仓库未观察时无法核对，条目保留且 `repositoryObserved` 为 false。
 */
export function acceptedBranchFacts(
  demandId: string,
  snapshot: Readonly<DemandResultReviewSnapshot>,
  repositories: ReadonlyMap<string, Readonly<RepositoryBranchTips>> | null,
): readonly Readonly<AcceptedBranchFact>[] {
  const facts: Readonly<AcceptedBranchFact>[] = [];
  for (const target of snapshot.targets) {
    if (target.status !== "review-decided" || target.phase !== "accepted") continue;
    const report = target.targetResult.report;
    if (report.kind !== "WakeflowImplementationTargetResultReport") continue;
    const change = report.repositoryChange;
    const commit = change.commits.at(-1);
    if (change.branch === null || commit === undefined) continue;
    const repository = repositories?.get(change.repositoryId);
    const tip = repository?.tips.get(change.branch);
    if (
      repository !== undefined
      && (tip === undefined || mergedIntoCurrentBranch(repository, change.branch, tip))
    ) {
      continue;
    }
    facts.push(
      Object.freeze({
        demandId,
        targetTaskId: target.targetTaskId,
        repositoryId: change.repositoryId,
        branch: change.branch,
        commit: commit.value,
        acceptedAt: target.reviewDecision.decidedAt,
        repositoryObserved: repository !== undefined,
      }),
    );
  }
  return Object.freeze(facts);
}

function repositoryBranchTips(
  observation: Readonly<WorkspaceObservation>,
): ReadonlyMap<string, Readonly<RepositoryBranchTips>> | null {
  if (observation.repositories.status !== "observed" || observation.repositories.value === null) {
    return null;
  }
  const map = new Map<string, Readonly<RepositoryBranchTips>>();
  for (const repository of observation.repositories.value) {
    if (repository.status !== "observed") continue;
    map.set(
      repository.repositoryId,
      Object.freeze({
        head: repository.head,
        branch: repository.branch,
        tips: new Map(repository.branches.map((branch) => [branch.name, branch.tip] as const)),
      }),
    );
  }
  return map;
}

/** 全部活动 Demand 的未合并已接受分支：status 的 `unmergedAccepted` 与投影的同名段都取这一份。 */
export function unmergedAcceptedFacts(
  observation: Readonly<WorkspaceObservation>,
): readonly Readonly<AcceptedBranchFact>[] {
  const repositories = repositoryBranchTips(observation);
  return Object.freeze(
    (observation.demands.value ?? []).flatMap((demand) =>
      demand.reviewSnapshot === null
        ? []
        : [...acceptedBranchFacts(demand.demandId, demand.reviewSnapshot, repositories)],
    ),
  );
}

function demandFacts(
  demand: Readonly<ObservedDemand>,
  podName: string,
): Readonly<ActiveProjectionDemandFacts> | null {
  if (demand.loaded === null || demand.route === null || demand.reviewSnapshot === null) return null;
  const state = demand.loaded.aggregate.state;
  const next = deriveNextProjection(demand.route);
  return Object.freeze({
    demandId: demand.demandId,
    title: demand.loaded.identity.title,
    demandType: demand.loaded.identity.demandType,
    podId: demand.loaded.identity.podId,
    podName,
    lifecycle: state.lifecycle,
    streamRevision: demand.loaded.aggregate.streamRevision,
    stateDigest: demand.loaded.aggregate.stateDigest,
    reviewSnapshotDigest: demand.reviewSnapshot.snapshotDigest,
    route: Object.freeze({
      disposition: demand.route.disposition,
      frontier: next.frontier,
      owner: next.owner,
      suggestedTool: next.suggestedTool,
      blockers: next.blockers,
    }),
    progress: progressOf(state.targetTasks),
    targets: Object.freeze(
      state.targetTasks.map((target) =>
        Object.freeze({
          targetTaskId: target.targetTaskId,
          workType: target.workType === "test" ? ("test" as const) : ("implementation" as const),
          phase: target.phase,
          repositoryId: target.workType === "test" ? null : target.repositoryId,
          windowId: target.windowId,
        }),
      ),
    ),
    lastEventId: demand.reviewSnapshot.eventStream.lastEventId,
    awaitingDecision: state.awaitingDecision?.issue ?? null,
    evidenceCount: state.managedEvidence?.length ?? 0,
  });
}

/**
 * 投影事实只从 projection 作用域的域派生：变更之后的刷新只读这些域，而 status 与 verify 用
 * full 作用域观察；两边必须算出同一份指纹，否则每次 status 都会把投影判成 stale。宿主域
 * （绑定、hook 通道、资产、仓库指针）与由绑定派生的 pod 状态是"本地运行时"，指纹有意忽略
 * （§13.94 D5）。
 */
function projectionScopeOf(
  observation: Readonly<WorkspaceObservation>,
): Readonly<WorkspaceObservation> {
  if (observation.scope === "projection") return observation;
  const pods = observation.pods.value;
  return Object.freeze({
    ...observation,
    scope: "projection" as const,
    bindings: Object.freeze([]),
    hooks: Object.freeze([]),
    assets: Object.freeze([]),
    repositories: Object.freeze({
      status: "unavailable" as const,
      issue: "scope:projection",
      value: null,
    }),
    pods:
      pods === null
        ? observation.pods
        : Object.freeze({
            ...observation.pods,
            value: Object.freeze(pods.map((pod) => Object.freeze({ ...pod, state: null }))),
          }),
  });
}

/** 从观察记录建立投影事实；读不出的 Demand 不进投影（status 单独报告它）。 */
export function buildActiveProjectionFacts(
  input: Readonly<WorkspaceObservation>,
): Readonly<ActiveProjectionFacts> {
  const observation = projectionScopeOf(input);
  const model = observation.snapshot.model;
  const repositoryNames = new Map<string, string>();
  for (const repository of model.topology.repositories) {
    repositoryNames.set(repository.repositoryId, repository.displayName);
  }
  const podNames = new Map<string, string>();
  for (const pod of model.pods) podNames.set(pod.podId, pod.name);
  const pods = observation.pods.value ?? [];
  return Object.freeze({
    language: model.presentation.language,
    program: Object.freeze({
      programId: model.program.programId,
      displayName: model.program.displayName,
    }),
    configDigest: observation.configDigest,
    pods: Object.freeze(
      model.pods.map((pod) => {
        const observed = pods.find((entry) => entry.pod.podId === pod.podId);
        return Object.freeze({
          podId: pod.podId,
          name: pod.name,
          placement: pod.placement,
          lifecycle: pod.lifecycle,
          activeDemandId: observed?.activeDemandId ?? null,
          worktrees: Object.freeze(
            pod.worktrees.map((worktree) => {
              const receipt = observed?.receipts.find(
                (entry) => entry.receipt.repositoryId === worktree.repositoryId,
              );
              return Object.freeze({
                repositoryId: worktree.repositoryId,
                repositoryName: repositoryNames.get(worktree.repositoryId) ?? worktree.repositoryId,
                receipt:
                  receipt === undefined
                    ? ("absent" as const)
                    : receipt.checkoutPresent
                      ? ("present" as const)
                      : ("checkout-missing" as const),
              });
            }),
          ),
        });
      }),
    ),
    unmergedAccepted: Object.freeze(
      unmergedAcceptedFacts(observation).map((fact) =>
        Object.freeze({
          demandId: fact.demandId,
          targetTaskId: fact.targetTaskId,
          repositoryId: fact.repositoryId,
          branch: fact.branch,
          commit: fact.commit,
        }),
      ),
    ),
    demands: Object.freeze(
      (observation.demands.value ?? [])
        .map((demand) => demandFacts(demand, podNames.get(demand.loaded?.identity.podId ?? "") ?? "?"))
        .filter((facts): facts is Readonly<ActiveProjectionDemandFacts> => facts !== null)
        .sort((left, right) => left.demandId.localeCompare(right.demandId)),
    ),
  });
}

/**
 * 投影目标的分类：按同一份观察渲染目标文件，再零写检查磁盘。读不出只让该域 unavailable，
 * 中止照常上抛。放在这里而不是观察模块，是为了让"观察 → 事实 → 目标"保持单向依赖。
 */
export async function observeProjectionTargets(
  root: RootedDirectory,
  observation: Readonly<WorkspaceObservation>,
  signal: AbortSignal | undefined,
): Promise<ObservedDomain<readonly Readonly<ActiveProjectionTargetInspection>[]>> {
  try {
    const files = renderActiveProjectionFiles(buildActiveProjectionFacts(observation));
    const targets = await inspectActiveProjectionTargets(
      root,
      files,
      signal === undefined ? {} : { signal },
    );
    return Object.freeze({ status: "observed" as const, issue: null, value: targets });
  } catch (error: unknown) {
    if (!(error instanceof WakeflowError) || error.reason === "aborted") throw error;
    return Object.freeze({
      status: "unavailable" as const,
      issue: `projection:${error.reason}`,
      value: null,
    });
  }
}
