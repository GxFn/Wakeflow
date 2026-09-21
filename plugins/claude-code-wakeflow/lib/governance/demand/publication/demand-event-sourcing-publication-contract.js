/** Demand 事件溯源发布流程的稳定公共合同和错误词汇。 */
export const DEMAND_EVENT_SOURCING_PUBLICATION_DIRECTORY_MODE = 0o700;
export const DEMAND_EVENT_SOURCING_PUBLICATION_FILE_MODE = 0o600;
export const DEMAND_EVENT_SOURCING_PUBLICATION_LOCK_TIMEOUT_MILLISECONDS = 10_000;
const ERROR_MESSAGES = {
    "input": "Demand Event Sourcing publication input is invalid.",
    "root-scope": "Demand Event Sourcing publication workspace root changed.",
    "authority": "Demand Event Sourcing publication authority is unresolved.",
    "package-not-found": "Demand Event Sourcing publication requirement package is not on the board.",
    "cas-mismatch": "Demand Event Sourcing publication expectation is stale.",
    "capacity": "Demand Event Sourcing publication resource exceeds its byte budget.",
    "conflict": "Demand Event Sourcing publication resources conflict.",
    "not-found": "Demand Event Sourcing publication transaction does not exist.",
    "recovery-required": "Demand Event Sourcing publication requires explicit recovery.",
    "lock-timeout": "Demand Event Sourcing publication lock timed out.",
    "lock-unsafe": "Demand Event Sourcing publication lock is unsafe.",
    "aborted": "Demand Event Sourcing publication was aborted.",
    "operation-failure": "Demand Event Sourcing publication failed.",
};
export class DemandEventSourcingPublicationServiceError extends Error {
    name = "DemandEventSourcingPublicationServiceError";
    code = "wakeflow-demand-event-sourcing-publication-service";
    reason;
    path;
    publicationAuthority;
    constructor(reason, path, publicationAuthority = "unknown") {
        super(ERROR_MESSAGES[reason]);
        this.reason = reason;
        this.path = path;
        this.publicationAuthority = publicationAuthority;
    }
}
export function failDemandEventSourcingPublication(reason, path, publicationAuthority = "unknown") {
    throw new DemandEventSourcingPublicationServiceError(reason, path, publicationAuthority);
}
