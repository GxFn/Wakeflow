import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import { deriveDurableId } from "../../kernel/ids.js";
import { WAKEFLOW_RECORD_EVIDENCE_PUBLIC_TOOL_NAME } from "./contract.js";
/** 计划摘要不含 `capturedAt` 与 CAS 预期：时间在 apply 时取钟，流位置在 apply 时取当前聚合。 */
export function deriveEvidencePlanDigest(plan) {
    const basis = {
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
/** 同一 Evidence 永远得到同一 Event 与 Commit 身份：重复 apply 在事件流上自然幂等。 */
export function deriveEvidenceEventIdentity(evidenceId) {
    return Object.freeze({
        eventId: deriveDurableId("demand-event", "managed-evidence-recorded", evidenceId),
        commitId: deriveDurableId("demand-event-commit", "managed-evidence-recorded", evidenceId),
    });
}
export function findRecordedEvidence(summaries, evidenceId) {
    return summaries?.find((entry) => entry.evidenceId === evidenceId) ?? null;
}
/** preview 结果里的计划投影：身份、来源投影、负载摘要与计数，不回显整棵 tree manifest。 */
export function evidencePlanSummary(plan, recorded) {
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
export function evidencePreviewNext(planned) {
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
