import { deriveDurableId } from "../../kernel/ids.js";
export function deriveManagedEvidenceEventIdentity(evidenceId) {
    return Object.freeze({
        eventId: deriveDurableId("demand-event", "managed-evidence-recorded", evidenceId),
        commitId: deriveDurableId("demand-event-commit", "managed-evidence-recorded", evidenceId),
    });
}
