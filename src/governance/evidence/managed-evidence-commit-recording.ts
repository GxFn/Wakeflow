import type { WakeflowDurableId } from "../../contracts/identity/wakeflow-durable-id.js";
import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import type { UtcWallClock } from "../../foundation/time/wall-clock.js";
import type { DemandEventStreamCommitWriter } from "../demand/event-sourcing/demand-event-stream-commit.js";
import { ManagedEvidenceCapturePlanningService } from "./managed-evidence-capture-planning-service.js";
import { deriveManagedEvidenceEventIdentity } from "./managed-evidence-event-identity.js";
import { ManagedEvidencePublicationApplicationService } from "./managed-evidence-publication-application-service.js";
import {
  computeManagedEvidencePublicationTransactionDigest,
  createManagedEvidencePublicationTransaction,
} from "./managed-evidence-publication-transaction.js";

/**
 * Wakeflow Governance / Evidence：把一个已核实的提交记成受管证据（ADR-0028 决定 4）。
 *
 * 目标导入结果的那一次调用用它给报告里的提交各记一条证据，Controller 被唤醒时证据已经在。它走的是
 * 记录证据工具同一条路——同一份捕获规划（规划时只读地观察提交）、同一个发布事务、同一条身份派生——
 * 所以同一个提交无论由谁记、记几次，都是同一份记录。
 *
 * 只记观察到的提交：仓库里没有它、或它不是提交，返回阻塞项；拿不到结论（Git 不可用、不是仓库）
 * 不记，返回 `unobserved`，由 Controller 照旧自己核对。它不做累计容量的预检：一条提交证据只给 Demand
 * 根增加固定的几个成员，调用方按每次导入的条数上限封顶。
 */

export type ManagedCommitEvidenceRecording =
  | Readonly<{
      status: "recorded" | "already-recorded";
      commitOid: string;
      evidenceId: WakeflowDurableId<"evidence">;
    }>
  | Readonly<{ status: "blocked"; commitOid: string; blockers: readonly string[] }>
  | Readonly<{ status: "unobserved"; commitOid: string }>;

export interface ManagedCommitEvidenceRecordingOptions {
  readonly clock?: UtcWallClock;
  readonly signal?: AbortSignal;
  readonly writer?: Readonly<DemandEventStreamCommitWriter> | null;
}

export async function recordManagedCommitEvidence(
  workspaceRoot: RootedDirectory,
  demandId: WakeflowDurableId<"demand">,
  source: Readonly<{ repositoryId: WakeflowDurableId<"repository">; commitOid: string }>,
  options: ManagedCommitEvidenceRecordingOptions = {},
): Promise<ManagedCommitEvidenceRecording> {
  const { commitOid } = source;
  const preview = await new ManagedEvidenceCapturePlanningService(workspaceRoot).preview(
    demandId,
    { kind: "commit", source: { kind: "commit", ...source }, contentReview: "reject" },
    {
      ...(options.clock === undefined ? {} : { clock: options.clock }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    },
  );
  if (preview.status === "blocked") {
    return Object.freeze({ status: "blocked", commitOid, blockers: preview.blockers });
  }
  const manifest = preview.plan.manifest;
  if (manifest.source.kind !== "commit" || manifest.source.observation === undefined) {
    return Object.freeze({ status: "unobserved", commitOid });
  }
  const evidenceId = manifest.evidenceId;
  if (preview.existing !== null) {
    return Object.freeze({ status: "already-recorded", commitOid, evidenceId });
  }
  const identity = deriveManagedEvidenceEventIdentity(evidenceId);
  const transaction = createManagedEvidencePublicationTransaction({
    capturePlan: preview.plan,
    eventId: identity.eventId,
    commitId: identity.commitId,
  });
  await new ManagedEvidencePublicationApplicationService(workspaceRoot).apply(
    transaction,
    computeManagedEvidencePublicationTransactionDigest(transaction),
    {
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      writer: options.writer ?? null,
    },
  );
  return Object.freeze({ status: "recorded", commitOid, evidenceId });
}
