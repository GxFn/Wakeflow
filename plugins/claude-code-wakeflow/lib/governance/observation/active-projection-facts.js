import { inspectActiveProjectionTargets, renderActiveProjectionFiles, } from "../../kernel/active-projection.js";
import { WakeflowError } from "../../kernel/error.js";
import { deriveNextProjection } from "../../kernel/next-projection.js";
import { repositoryBranchesComplete } from "./repository-pointer-observation.js";
function progressOf(targets) {
    const implementation = targets.filter((target) => target.workType !== "test" && target.phase !== "superseded");
    const tests = targets.filter((target) => target.workType === "test");
    return Object.freeze({
        implementationTargets: implementation.length,
        implementationAccepted: implementation.filter((target) => target.phase === "accepted").length,
        deliveriesInFlight: targets.filter((target) => target.phase.includes("delivery-prepared") || target.phase.includes("host-effect-")).length,
        resultsAwaitingReview: targets.filter((target) => target.phase.endsWith("result-reported")).length,
        testTargets: tests.length,
        testAccepted: tests.filter((target) => target.phase === "test-accepted").length,
    });
}
/** 尖端等于仓库当前所在分支的尖端才算已合并；正检出在该分支上或分离头时无法判定，保留。 */
function mergedIntoCurrentBranch(repository, branch, tip) {
    return repository.branch !== null && repository.branch !== branch && tip === repository.head;
}
/**
 * 仓库已观察时该条目是否已经了结。分支清单读不全就什么都不能断定：缺席不等于删除，而在场的
 * 尖端也可能是 `packed-refs` 里的过期备份（松散引用才是权威，而它正是读不出的那一个），拿它
 * 判"已合并"会把未合并的分支悄悄删掉。读全之后，分支不在即已删除，分支还在就看尖端是否等于
 * 当前分支尖端。
 */
function resolvedAway(repository, branch, tip) {
    if (!repository.branchesComplete)
        return false;
    if (tip === undefined)
        return true;
    return mergedIntoCurrentBranch(repository, branch, tip);
}
/**
 * 已接受实现结果里带分支与提交、且分支仍未合并的条目（§13.94 D2）：分支引用仍在仓库，且尖端
 * 不等于仓库当前所在分支的尖端。没有对象图不能判祖先，"尖端等于当前分支尖端"是唯一可用的已合并
 * 判定；分支已删除即不再列出。仓库未观察、或分支清单读不全时都无法核对，条目保留且
 * `repositoryObserved` 为 false——读不出引用绝不能让未合并的分支悄悄消失。
 */
export function acceptedBranchFacts(demandId, snapshot, repositories) {
    const facts = [];
    for (const target of snapshot.targets) {
        if (target.status !== "review-decided" || target.phase !== "accepted")
            continue;
        const report = target.targetResult.report;
        if (report.kind !== "WakeflowImplementationTargetResultReport")
            continue;
        const change = report.repositoryChange;
        const commit = change.commits.at(-1);
        if (change.branch === null || commit === undefined)
            continue;
        const repository = repositories?.get(change.repositoryId);
        const tip = repository?.tips.get(change.branch);
        if (repository !== undefined && resolvedAway(repository, change.branch, tip))
            continue;
        facts.push(Object.freeze({
            demandId,
            targetTaskId: target.targetTaskId,
            repositoryId: change.repositoryId,
            branch: change.branch,
            commit: commit.value,
            acceptedAt: target.reviewDecision.decidedAt,
            // 核对过 = 分支清单读全了，并且在里面真的看见了这个分支尖端。
            repositoryObserved: repository !== undefined && repository.branchesComplete && tip !== undefined,
        }));
    }
    return Object.freeze(facts);
}
function repositoryBranchTips(observation) {
    if (observation.repositories.status !== "observed" || observation.repositories.value === null) {
        return null;
    }
    const map = new Map();
    for (const repository of observation.repositories.value) {
        if (repository.status !== "observed")
            continue;
        map.set(repository.repositoryId, Object.freeze({
            head: repository.head,
            branch: repository.branch,
            tips: new Map(repository.branches.map((branch) => [branch.name, branch.tip])),
            branchesComplete: repositoryBranchesComplete(repository),
        }));
    }
    return map;
}
/** 全部活动 Demand 的未合并已接受分支：status 的 `unmergedAccepted` 与投影的同名段都取这一份。 */
export function unmergedAcceptedFacts(observation) {
    const repositories = repositoryBranchTips(observation);
    return Object.freeze((observation.demands.value ?? []).flatMap((demand) => demand.reviewSnapshot === null
        ? []
        : [...acceptedBranchFacts(demand.demandId, demand.reviewSnapshot, repositories)]));
}
function demandFacts(demand, podName) {
    if (demand.loaded === null || demand.route === null || demand.reviewSnapshot === null)
        return null;
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
        targets: Object.freeze(state.targetTasks.map((target) => Object.freeze({
            targetTaskId: target.targetTaskId,
            workType: target.workType === "test" ? "test" : "implementation",
            phase: target.phase,
            repositoryId: target.workType === "test" ? null : target.repositoryId,
            windowId: target.windowId,
        }))),
        lastEventId: demand.reviewSnapshot.eventStream.lastEventId,
        awaitingDecision: state.awaitingDecision?.issue ?? null,
        evidenceCount: state.managedEvidence?.length ?? 0,
    });
}
/**
 * pod 的"本地运行时"部分：由绑定派生的 `state`，以及检出目录此刻在不在磁盘上。两者都不受
 * 任何 Wakeflow 变更控制——工作区外的一次 `git worktree remove` 就能改变 `checkoutPresent`，
 * 而它不触发刷新，进了指纹就让投影永久 stale（§13.96 对 `overall` 与看板计数的同一裁决）。
 * 投影只认回执本身是否存在；live 的检出状态由全作用域的 `wakeflow_status` 报告。
 */
function projectionScopePods(observed) {
    const pods = observed.value;
    if (pods === null)
        return observed;
    return Object.freeze({
        ...observed,
        value: Object.freeze(pods.map((pod) => Object.freeze({
            ...pod,
            state: null,
            receipts: Object.freeze(pod.receipts.map((entry) => Object.freeze({ ...entry, checkoutPresent: true }))),
        }))),
    });
}
/**
 * 投影事实只从 projection 作用域的域派生：变更之后的刷新只读这些域，而 status 与 verify 用
 * full 作用域观察；两边必须算出同一份指纹，否则每次 status 都会把投影判成 stale。宿主域
 * （绑定、hook 通道、资产、仓库指针）与 pod 的本地运行时部分是"本地运行时"，指纹有意忽略
 * （§13.94 D5）。
 */
function projectionScopeOf(observation) {
    const pods = projectionScopePods(observation.pods);
    if (observation.scope === "projection")
        return Object.freeze({ ...observation, pods });
    return Object.freeze({
        ...observation,
        scope: "projection",
        bindings: Object.freeze([]),
        hooks: Object.freeze([]),
        assets: Object.freeze([]),
        repositories: Object.freeze({
            status: "unavailable",
            issue: "scope:projection",
            value: null,
        }),
        pods,
    });
}
/**
 * 退休证据：demands 域本身观察到、且其中每个 Demand 都读得出，这一轮才算把活动 Demand
 * 看全。事实里的 `demands` 已经丢掉了读不出的 Demand，不能当活动集合用（读失败会让在用的
 * 页面看起来"不活动"）。
 */
function demandEvidenceOf(observation) {
    const demands = observation.demands.value;
    return Object.freeze({
        observed: observation.demands.status === "observed"
            && demands !== null
            && demands.every((demand) => demand.status === "observed"),
        activeDemandIds: Object.freeze((demands ?? []).map((demand) => demand.demandId).sort()),
    });
}
/** 从观察记录建立投影事实；读不出的 Demand 不进投影（status 单独报告它）。 */
export function buildActiveProjectionFacts(input) {
    const observation = projectionScopeOf(input);
    const model = observation.snapshot.model;
    const repositoryNames = new Map();
    for (const repository of model.topology.repositories) {
        repositoryNames.set(repository.repositoryId, repository.displayName);
    }
    const podNames = new Map();
    for (const pod of model.pods)
        podNames.set(pod.podId, pod.name);
    const pods = observation.pods.value ?? [];
    return Object.freeze({
        language: model.presentation.language,
        program: Object.freeze({
            programId: model.program.programId,
            displayName: model.program.displayName,
        }),
        configDigest: observation.configDigest,
        pods: Object.freeze(model.pods.map((pod) => {
            const observed = pods.find((entry) => entry.pod.podId === pod.podId);
            return Object.freeze({
                podId: pod.podId,
                name: pod.name,
                placement: pod.placement,
                lifecycle: pod.lifecycle,
                activeDemandId: observed?.activeDemandId ?? null,
                worktrees: Object.freeze(pod.worktrees.map((worktree) => {
                    const receipt = observed?.receipts.find((entry) => entry.receipt.repositoryId === worktree.repositoryId);
                    return Object.freeze({
                        repositoryId: worktree.repositoryId,
                        repositoryName: repositoryNames.get(worktree.repositoryId) ?? worktree.repositoryId,
                        // 检出目录此刻在不在已由 projectionScopeOf 归一化掉：这里只看回执有没有。
                        receipt: receipt === undefined ? "absent" : "present",
                    });
                })),
            });
        })),
        unmergedAccepted: Object.freeze(unmergedAcceptedFacts(observation).map((fact) => Object.freeze({
            demandId: fact.demandId,
            targetTaskId: fact.targetTaskId,
            repositoryId: fact.repositoryId,
            branch: fact.branch,
            commit: fact.commit,
        }))),
        demands: Object.freeze((observation.demands.value ?? [])
            .map((demand) => demandFacts(demand, podNames.get(demand.loaded?.identity.podId ?? "") ?? "?"))
            .filter((facts) => facts !== null)
            .sort((left, right) => left.demandId.localeCompare(right.demandId))),
        activeDemands: demandEvidenceOf(observation),
    });
}
/**
 * 投影目标的分类：按同一份观察渲染目标文件，再零写检查磁盘。读不出只让该域 unavailable，
 * 中止照常上抛。放在这里而不是观察模块，是为了让"观察 → 事实 → 目标"保持单向依赖。
 */
export async function observeProjectionTargets(root, observation, signal) {
    try {
        const files = renderActiveProjectionFiles(buildActiveProjectionFacts(observation));
        const targets = await inspectActiveProjectionTargets(root, files, signal === undefined ? {} : { signal });
        return Object.freeze({ status: "observed", issue: null, value: targets });
    }
    catch (error) {
        if (!(error instanceof WakeflowError) || error.reason === "aborted")
            throw error;
        return Object.freeze({
            status: "unavailable",
            issue: `projection:${error.reason}`,
            value: null,
        });
    }
}
