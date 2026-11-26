import { readWakeflowConfigAuthoritySnapshot } from "../../configuration/wakeflow-config-authority-snapshot.js";
import { parseWakeflowDurableIdOfKind } from "../../contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import { parseJsonValue } from "../../foundation/data/json-value.js";
import { parsePortableResourcePath } from "../../foundation/filesystem/portable-resource-path.js";
import {
  type RootedDirectory,
  RootedDirectoryError,
} from "../../foundation/filesystem/rooted-directory.js";
import { readStableResourceDirectory } from "../../foundation/filesystem/stable-directory-read.js";
import { readStrictTextFile } from "../../foundation/filesystem/strict-text-file.js";
import { fail } from "../../kernel/error.js";
import { withWorkspaceLock } from "../../kernel/workspace-locks.js";
import {
  demandLifecycleJournalRef,
  WAKEFLOW_ACTIVE_CURRENT_ROOT_REF,
} from "../../kernel/layout.js";
import { openDemandOperationRoot } from "./demand-operation-authority-context.js";
import { DEMAND_IDENTITY_MAXIMUM_BYTES } from "./event-sourcing/demand-event-sourcing-root-authority.js";
import {
  DEMAND_FILE_EVENT_STORE_FILE_MODE,
  DemandFileEventStore,
  DemandFileEventStoreError,
} from "./event-sourcing/demand-file-event-store.js";
import {
  DemandStageResidueError,
  inspectDemandStageResidue,
  retireDemandStageResidue,
} from "./event-sourcing/demand-stage-residue.js";
import { parseDemandIdentityDocument } from "./model/demand-identity.js";

/**
 * 维护只结算候选资源与原子暂存的残留，不执行领域命令，不解释或重写历史事件。`stageResidueCount` 是
 * `index/`、`snapshots/` 与 `task-packages/` 里死掉的写者留下的暂存文件数（1.4.1 段 1b）：根的清点容忍
 * 它们，清掉它们在这里。
 */
export interface DemandRuntimeRecoveryPlan {
  readonly demands: readonly Readonly<{
    demandId: string;
    candidateCount: number;
    stageResidueCount: number;
    digest: Sha256Digest;
  }>[];
  readonly blockers: readonly string[];
  readonly digest: Sha256Digest;
}

const DEMAND_NAME = /^demand_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const IDENTITY_REF = parsePortableResourcePath("identity.json");

/** 节点期望是私有 CAS 输入，只发布其摘要；不把 PID、候选文件名或机器路径发到模型。 */
function nodeValue(node: object) {
  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => [
      key,
      typeof value === "bigint" ? String(value) : value,
    ]),
  );
}

async function lifecycleJournalExists(
  workspaceRoot: RootedDirectory,
  demandId: string,
): Promise<boolean> {
  try {
    await workspaceRoot.inspectExistingResource(demandLifecycleJournalRef(demandId), "$journal");
    return true;
  } catch (error: unknown) {
    // 看不清（比如日志的位置上不是普通文件）就当作没有：调用方照旧报出这个根。
    if (error instanceof RootedDirectoryError) return false;
    throw error;
  }
}

/**
 * 一个 Demand 根里归维护结算的东西：追加候选与三个目录的暂存残留。返回 null 表示这个根不归维护管——
 * 候选目录都没有（根只剩一部分）而生命周期日志还在：续接放回的根还没补齐可重建的目录，或者 1.4.0 删到
 * 一半的残根，都由那条生命周期命令的 recover 接手。这里只看日志在不在，不解释它；没有日志时照旧报
 * `not-initialized`，不替一个来历不明的半截根做决定。
 */
async function observeDemandRuntimeResidue(
  workspaceRoot: RootedDirectory,
  root: RootedDirectory,
  demandId: string,
  options: Readonly<{ readonly signal?: AbortSignal }>,
) {
  let candidates: Awaited<ReturnType<DemandFileEventStore["inspectAppendCandidates"]>>;
  try {
    candidates = await new DemandFileEventStore(root).inspectAppendCandidates(options);
  } catch (error: unknown) {
    if (
      error instanceof DemandFileEventStoreError &&
      error.reason === "not-initialized" &&
      (await lifecycleJournalExists(workspaceRoot, demandId))
    ) {
      return null;
    }
    throw error;
  }
  try {
    const residue = await inspectDemandStageResidue(
      root,
      DEMAND_FILE_EVENT_STORE_FILE_MODE,
      options,
    );
    return { candidates, residue };
  } catch (error: unknown) {
    if (error instanceof DemandStageResidueError && error.reason === "aborted") {
      fail("io-failure", "aborted", "$signal", { cause: error });
    }
    throw error;
  }
}

type RecoveryConfig = Awaited<ReturnType<typeof readWakeflowConfigAuthoritySnapshot>>;

function isAborted(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "reason" in error && error.reason === "aborted"
  );
}

/**
 * 读这个根的身份并核对它就是这个 Demand、属于这个程序。只有暂存残留、没有候选的根读不出身份或对不上时
 * 返回 null（不归这里清，也不让预览失败：这一段之前 reconcile 根本不看这样的根）；有候选的根照旧报错。
 */
async function readRecoveryIdentity(
  root: RootedDirectory,
  demandId: string,
  config: RecoveryConfig,
  residueOnly: boolean,
  options: Readonly<{ readonly signal?: AbortSignal }>,
): Promise<Readonly<{ digest: Sha256Digest }> | null> {
  try {
    const identity = await readStrictTextFile(root, IDENTITY_REF, {
      maximumBytes: DEMAND_IDENTITY_MAXIMUM_BYTES,
      ...options,
    });
    const parsed = parseDemandIdentityDocument(identity.text);
    if (parsed.demandId !== demandId || parsed.programId !== config.model.program.programId) {
      fail("precondition-failed", "recovery-demand-identity", "$demandRoot");
    }
    return { digest: identity.digest };
  } catch (error: unknown) {
    if (!residueOnly || isAborted(error)) throw error;
    return null;
  }
}

/** 一个 Demand 的恢复条目与它的阻塞项；没有归维护结算的东西时为 null。 */
async function planDemandRecovery(
  workspaceRoot: RootedDirectory,
  root: RootedDirectory,
  demandId: string,
  config: RecoveryConfig,
  options: Readonly<{ readonly signal?: AbortSignal }>,
): Promise<Readonly<{
  entry: DemandRuntimeRecoveryPlan["demands"][number];
  blockers: readonly string[];
}> | null> {
  const observed = await observeDemandRuntimeResidue(workspaceRoot, root, demandId, options);
  if (observed === null) return null;
  const { candidates, residue } = observed;
  const blockers = [
    ...(candidates.some((candidate) => candidate.ownerState !== "inactive")
      ? [`demand-candidates-busy:${demandId}`]
      : []),
    ...(residue.activeCount > 0 ? [`demand-stage-residue-busy:${demandId}`] : []),
  ];
  // 清得掉的残留才进计划。清不掉的（写者判断不出死活、形状不认识、成对的任务包内容对不上、目录自己
  // 不对）不进计划也不挡别的维护：应用清不动它，挡在这里只会让整个工作区的 reconcile 停住；根因此打不开时
  // 由 status 与 verify 报出。
  const stageResidue = residue.retirable || blockers.length > 0 ? residue.entries : [];
  if (candidates.length === 0 && stageResidue.length === 0 && blockers.length === 0) return null;
  const identity = await readRecoveryIdentity(
    root,
    demandId,
    config,
    candidates.length === 0,
    options,
  );
  if (identity === null) return null;
  const digest = computeCanonicalJsonSha256Digest(
    parseJsonValue({
      configDigest: config.configDigest,
      identityDigest: identity.digest,
      root: nodeValue(await root.assertCurrent()),
      candidates: candidates.map(({ entry: candidate, ownerState }) => ({
        ref: candidate.resourcePath,
        node: nodeValue(candidate.node),
        ownerState,
      })),
      // 没有残留时不写这一项：只有候选的条目，它自己的摘要与这一段之前相同。（整份计划的摘要不同：
      // 每个条目多了 `stageResidueCount`，跨版本的预览要重做一次。）
      ...(stageResidue.length === 0
        ? {}
        : {
            stageResidue: stageResidue.map((stage) => ({
              ref: stage.ref,
              node: nodeValue(stage.node),
              owner: stage.owner,
            })),
          }),
    }),
  );
  return Object.freeze({
    entry: Object.freeze({
      demandId,
      candidateCount: candidates.length,
      stageResidueCount: stageResidue.length,
      digest,
    }),
    blockers: Object.freeze(blockers),
  });
}

export async function inspectDemandRuntimeRecovery(
  workspaceRoot: RootedDirectory,
  options: Readonly<{ readonly signal?: AbortSignal }> = {},
): Promise<Readonly<DemandRuntimeRecoveryPlan>> {
  const config = await readWakeflowConfigAuthoritySnapshot(workspaceRoot, options);
  const listing = await readStableResourceDirectory(
    workspaceRoot,
    WAKEFLOW_ACTIVE_CURRENT_ROOT_REF,
    {
      maximumEntries: 4096,
      ...options,
    },
  );
  const demands: Array<DemandRuntimeRecoveryPlan["demands"][number]> = [];
  const blockers: string[] = [];
  for (const entry of listing.entries) {
    if (!DEMAND_NAME.test(entry.name)) continue;
    const demandId = parseWakeflowDurableIdOfKind(entry.name, "demand");
    const root = await openDemandOperationRoot(workspaceRoot, demandId);
    try {
      const planned = await planDemandRecovery(workspaceRoot, root, demandId, config, options);
      if (planned === null) continue;
      demands.push(planned.entry);
      blockers.push(...planned.blockers);
    } finally {
      await root.close();
    }
  }
  return Object.freeze({
    demands: Object.freeze(demands),
    blockers: Object.freeze(blockers),
    digest: computeCanonicalJsonSha256Digest(parseJsonValue({ demands, blockers })),
  });
}

/** 清掉暂存残留；计划之后形状变了（清不动）按计划漂移拒绝，重新预览即可。 */
async function retireStageResidue(
  root: RootedDirectory,
  options: Readonly<{ readonly signal?: AbortSignal }>,
): Promise<number> {
  try {
    return await retireDemandStageResidue(root, DEMAND_FILE_EVENT_STORE_FILE_MODE, options);
  } catch (error: unknown) {
    if (!(error instanceof DemandStageResidueError)) throw error;
    if (error.reason === "aborted") fail("io-failure", "aborted", "$signal", { cause: error });
    fail("precondition-failed", "recovery-plan-drift", "$planDigest", { cause: error });
  }
}

export async function applyDemandRuntimeRecovery(
  workspaceRoot: RootedDirectory,
  expected: Readonly<DemandRuntimeRecoveryPlan>,
  options: Readonly<{ readonly signal?: AbortSignal }> = {},
) {
  const current = await inspectDemandRuntimeRecovery(workspaceRoot, options);
  if (current.digest !== expected.digest || current.blockers.length > 0) {
    fail("precondition-failed", "recovery-plan-drift", "$planDigest");
  }
  const recovered: Array<
    Readonly<{ demandId: string; retiredCount: number; stageResidueRetiredCount: number }>
  > = [];
  for (const demand of expected.demands) {
    const demandId = parseWakeflowDurableIdOfKind(demand.demandId, "demand");
    // 与发布服务同一把 Demand 发布锁（ADR-0033）：逐个 Demand 拿、做完就放。
    await withWorkspaceLock(
      workspaceRoot,
      "demand-publication",
      async () => {
        const fresh = await inspectDemandRuntimeRecovery(workspaceRoot, options);
        const observed = fresh.demands.find((candidate) => candidate.demandId === demandId);
        if (observed === undefined) return; // 其他恢复者已完成，按幂等结算。
        if (observed.digest !== demand.digest)
          fail("precondition-failed", "recovery-plan-drift", "$planDigest");
        const root = await openDemandOperationRoot(workspaceRoot, demandId);
        try {
          const receipt = await new DemandFileEventStore(root).recoverAppendCandidates(options);
          recovered.push(
            Object.freeze({
              demandId,
              retiredCount: receipt.retiredCount,
              // 计划里没有暂存残留的 Demand 不碰那三个目录：只收候选，和这一段之前一样。
              stageResidueRetiredCount:
                demand.stageResidueCount > 0 ? await retireStageResidue(root, options) : 0,
            }),
          );
        } finally {
          await root.close();
        }
      },
      options,
    );
  }
  return Object.freeze(recovered);
}
