import { ManagedEvidenceCapturePlanningService } from "./managed-evidence-capture-planning-service.js";
import { deriveManagedEvidenceEventIdentity } from "./managed-evidence-event-identity.js";
import { ManagedEvidencePublicationApplicationService } from "./managed-evidence-publication-application-service.js";
import { computeManagedEvidencePublicationTransactionDigest, createManagedEvidencePublicationTransaction, } from "./managed-evidence-publication-transaction.js";
export async function recordManagedCommitEvidence(workspaceRoot, demandId, source, options = {}) {
    const { commitOid } = source;
    const preview = await new ManagedEvidenceCapturePlanningService(workspaceRoot).preview(demandId, { kind: "commit", source: { kind: "commit", ...source }, contentReview: "reject" }, {
        ...(options.clock === undefined ? {} : { clock: options.clock }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
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
    await new ManagedEvidencePublicationApplicationService(workspaceRoot).apply(transaction, computeManagedEvidencePublicationTransactionDigest(transaction), {
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        writer: options.writer ?? null,
    });
    return Object.freeze({ status: "recorded", commitOid, evidenceId });
}
