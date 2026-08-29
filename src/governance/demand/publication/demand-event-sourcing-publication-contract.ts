import type { PortableResourcePath } from "../../../foundation/filesystem/portable-resource-path.js";
import type { DeterministicJsonFileResult } from "../../../foundation/filesystem/deterministic-json-file.js";
import type { LoadedDemandEventSourcingRootAuthority } from "../event-sourcing/demand-event-sourcing-root-authority.js";
import type { StoredTodoCollectionItem, TodoCollectionAuthoritySnapshot } from "../../todo/todo-collection-authority.js";
import type { TodoIntakeLineageReference } from "../../todo/todo-intake-lineage.js";
import type { DemandEventSourcingPublicationTransaction } from "./demand-event-sourcing-publication-transaction.js";

/** Demand 事件溯源发布流程的稳定公共合同和错误词汇。 */

export const DEMAND_EVENT_SOURCING_PUBLICATION_DIRECTORY_MODE = 0o700;
export const DEMAND_EVENT_SOURCING_PUBLICATION_FILE_MODE = 0o600;
export const DEMAND_EVENT_SOURCING_PUBLICATION_LOCK_TIMEOUT_MILLISECONDS =
  10_000;

export interface DemandEventSourcingPublicationTodoResult {
  readonly item: Readonly<StoredTodoCollectionItem>;
  readonly lineageRef: Readonly<TodoIntakeLineageReference>;
  readonly snapshot: Readonly<TodoCollectionAuthoritySnapshot>;
}

export interface DemandEventSourcingPublicationResult {
  readonly wroteDemandRoot: boolean;
  readonly demandId: DemandEventSourcingPublicationTransaction["demandId"];
  readonly rootRef: PortableResourcePath;
  readonly todo: Readonly<DemandEventSourcingPublicationTodoResult>;
  readonly loaded: Readonly<LoadedDemandEventSourcingRootAuthority>;
}

export interface StoredDemandEventSourcingPublicationTransaction {
  readonly transaction: Readonly<DemandEventSourcingPublicationTransaction>;
  readonly source: Readonly<DeterministicJsonFileResult>;
}

export type DemandEventSourcingPublicationServiceErrorReason =
  | "input"
  | "root-scope"
  | "authority"
  | "todo-not-found"
  | "cas-mismatch"
  | "capacity"
  | "conflict"
  | "not-found"
  | "recovery-required"
  | "lock-timeout"
  | "lock-unsafe"
  | "aborted"
  | "operation-failure";

const ERROR_MESSAGES = {
  "input": "Demand Event Sourcing publication input is invalid.",
  "root-scope": "Demand Event Sourcing publication workspace root changed.",
  "authority": "Demand Event Sourcing publication authority is unresolved.",
  "todo-not-found": "Demand Event Sourcing publication TODO does not exist.",
  "cas-mismatch": "Demand Event Sourcing publication expectation is stale.",
  "capacity": "Demand Event Sourcing publication resource exceeds its byte budget.",
  "conflict": "Demand Event Sourcing publication resources conflict.",
  "not-found": "Demand Event Sourcing publication transaction does not exist.",
  "recovery-required": "Demand Event Sourcing publication requires explicit recovery.",
  "lock-timeout": "Demand Event Sourcing publication lock timed out.",
  "lock-unsafe": "Demand Event Sourcing publication lock is unsafe.",
  "aborted": "Demand Event Sourcing publication was aborted.",
  "operation-failure": "Demand Event Sourcing publication failed.",
} as const satisfies Readonly<Record<
  DemandEventSourcingPublicationServiceErrorReason,
  string
>>;

export class DemandEventSourcingPublicationServiceError extends Error {
  override readonly name = "DemandEventSourcingPublicationServiceError";
  readonly code = "wakeflow-demand-event-sourcing-publication-service" as const;
  readonly reason: DemandEventSourcingPublicationServiceErrorReason;
  readonly path: string;

  constructor(
    reason: DemandEventSourcingPublicationServiceErrorReason,
    path: string,
  ) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

export function failDemandEventSourcingPublication(
  reason: DemandEventSourcingPublicationServiceErrorReason,
  path: string,
): never {
  throw new DemandEventSourcingPublicationServiceError(reason, path);
}
