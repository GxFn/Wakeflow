import type { WakeflowDurableId } from "../../contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import type { DemandManagedEvidenceSummary } from "../../governance/demand/model/demand-aggregate-state.js";
import type { ManagedEvidenceCapturePlan } from "../../governance/evidence/managed-evidence-capture-plan.js";
import type { ManagedEvidenceManifest } from "../../governance/evidence/managed-evidence-manifest.js";
import { deriveDurableId } from "../../kernel/ids.js";
import type { NextProjection } from "../../kernel/next-projection.js";
import { WAKEFLOW_RECORD_EVIDENCE_PUBLIC_TOOL_NAME } from "./contract.js";

/**
 * Wakeflow Capabilities / Evidence：记录证据的纯决定（gate-log §13.89 D1）。
 *
 * 这里没有 I/O：计划摘要只覆盖与时间无关的内容，preview 与 apply 之间只有源字节变化才是
 * 漂移；Event 与 Commit 身份从 Evidence 身份派生；preview 的计划投影只带摘要与计数。
 */

export interface EvidencePlanBasis {
  readonly demandId: WakeflowDurableId<"demand">;
  readonly kind: ManagedEvidenceManifest["kind"];
  readonly source: ManagedEvidenceManifest["source"];
  readonly payload: ManagedEvidenceManifest["payload"];
  readonly contentReview: ManagedEvidenceManifest["contentReview"];
  readonly configDigest: Sha256Digest;
  readonly demandAuthorityDigest: Sha256Digest;
}

/** 计划摘要不含 `capturedAt` 与 CAS 预期：时间在 apply 时取钟，流位置在 apply 时取当前聚合。 */
export function deriveEvidencePlanDigest(plan: Readonly<ManagedEvidenceCapturePlan>): Sha256Digest {
  const basis: EvidencePlanBasis = {
    demandId: plan.manifest.demandId,
    kind: plan.manifest.kind,
    source: plan.manifest.source,
    payload: plan.manifest.payload,
    contentReview: plan.manifest.contentReview,
    configDigest: plan.configDigest,
    demandAuthorityDigest: plan.manifest.demandAuthorityDigest,
  };
  return computeCanonicalJsonSha256Digest(basis, "$plan");
}

export interface EvidenceEventIdentity {
  readonly eventId: WakeflowDurableId<"demand-event">;
  readonly commitId: WakeflowDurableId<"demand-event-commit">;
}

/** 同一 Evidence 永远得到同一 Event 与 Commit 身份：重复 apply 在事件流上自然幂等。 */
export function deriveEvidenceEventIdentity(
  evidenceId: WakeflowDurableId<"evidence">,
): EvidenceEventIdentity {
  return Object.freeze({
    eventId: deriveDurableId("demand-event", "managed-evidence-recorded", evidenceId),
    commitId: deriveDurableId("demand-event-commit", "managed-evidence-recorded", evidenceId),
  });
}

export function findRecordedEvidence(
  summaries: readonly Readonly<DemandManagedEvidenceSummary>[] | undefined,
  evidenceId: WakeflowDurableId<"evidence">,
): Readonly<DemandManagedEvidenceSummary> | null {
  return summaries?.find((entry) => entry.evidenceId === evidenceId) ?? null;
}

/** preview 结果里的计划投影：身份、来源投影、负载摘要与计数，不回显整棵 tree manifest。 */
export function evidencePlanSummary(
  plan: Readonly<ManagedEvidenceCapturePlan>,
  recorded: boolean,
): Readonly<{
  readonly evidenceId: string;
  readonly kind: string;
  readonly source: ManagedEvidenceManifest["source"];
  readonly payload: Readonly<{
    readonly artifactDigest: string;
    readonly fileCount: number;
    readonly totalBytes: number;
  }>;
  readonly contentReview: Readonly<{
    readonly disposition: string;
    readonly opaqueFileCount: number;
    readonly privacyFindingCount: number;
  }>;
  readonly recorded: boolean;
}> {
  const manifest = plan.manifest;
  return Object.freeze({
    evidenceId: manifest.evidenceId,
    kind: manifest.kind,
    source: manifest.source,
    payload: Object.freeze({
      artifactDigest: manifest.payload.artifactDigest,
      fileCount: manifest.payload.treeManifest.fileCount,
      totalBytes: manifest.payload.treeManifest.totalBytes,
    }),
    contentReview: Object.freeze({
      disposition: manifest.contentReview.disposition,
      opaqueFileCount: manifest.contentReview.opaqueFileRefs.length,
      privacyFindingCount: manifest.contentReview.privacyFindings.length,
    }),
    recorded,
  });
}

/** preview 的 `next`：就绪指向 apply，阻塞时列出阻塞项。 */
export function evidencePreviewNext(
  planned: Readonly<{ readonly status: "ready" | "blocked"; readonly blockers: readonly string[] }>,
): NextProjection {
  return planned.status === "ready"
    ? Object.freeze({
        frontier: "evidence-record-apply",
        owner: "controller",
        suggestedTool: WAKEFLOW_RECORD_EVIDENCE_PUBLIC_TOOL_NAME,
        blockers: Object.freeze([]),
      })
    : Object.freeze({
        frontier: null,
        owner: "controller",
        suggestedTool: null,
        blockers: planned.blockers,
      });
}
