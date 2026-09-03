import {
  fromJsonSchema,
  type McpServer,
} from "@modelcontextprotocol/server";

import {
  WAKEFLOW_CONFIRMATION_PUBLICATION_REQUEST_SCHEMA,
  type WakeflowConfirmationPublicationRequestV1,
} from "../contracts/generated/entrypoints/wakeflow-confirmation-publication-request.generated.js";
import {
  WAKEFLOW_CONFIRMATION_PUBLICATION_RESULT_SCHEMA,
  type WakeflowConfirmationPublicationResultV1,
} from "../contracts/generated/entrypoints/wakeflow-confirmation-publication-result.generated.js";
import {
  WAKEFLOW_DEMAND_CONTROLLER_ROUTE_REQUEST_SCHEMA,
  type WakeflowDemandControllerRouteRequestV1,
} from "../contracts/generated/entrypoints/wakeflow-demand-controller-route-request.generated.js";
import {
  WAKEFLOW_DEMAND_CONTROLLER_ROUTE_RESULT_SCHEMA,
  type WakeflowDemandControllerRouteResultV1,
} from "../contracts/generated/entrypoints/wakeflow-demand-controller-route-result.generated.js";
import {
  WAKEFLOW_DEMAND_PUBLICATION_REQUEST_SCHEMA,
  type WakeflowDemandPublicationRequestV1,
} from "../contracts/generated/entrypoints/wakeflow-demand-publication-request.generated.js";
import {
  WAKEFLOW_DEMAND_PUBLICATION_RESULT_SCHEMA,
  type WakeflowDemandPublicationResultV1,
} from "../contracts/generated/entrypoints/wakeflow-demand-publication-result.generated.js";
import {
  WAKEFLOW_MANAGED_EVIDENCE_PUBLICATION_REQUEST_SCHEMA,
  type WakeflowManagedEvidencePublicationRequestV1,
} from "../contracts/generated/entrypoints/wakeflow-managed-evidence-publication-request.generated.js";
import {
  WAKEFLOW_MANAGED_EVIDENCE_PUBLICATION_RESULT_SCHEMA,
  type WakeflowManagedEvidencePublicationResultV1,
} from "../contracts/generated/entrypoints/wakeflow-managed-evidence-publication-result.generated.js";
import {
  WAKEFLOW_REQUIREMENT_PUBLICATION_REQUEST_SCHEMA,
  type WakeflowRequirementPublicationRequestV1,
} from "../contracts/generated/entrypoints/wakeflow-requirement-publication-request.generated.js";
import {
  WAKEFLOW_REQUIREMENT_PUBLICATION_RESULT_SCHEMA,
  type WakeflowRequirementPublicationResultV1,
} from "../contracts/generated/entrypoints/wakeflow-requirement-publication-result.generated.js";
import {
  WAKEFLOW_TODO_INSPECTION_REQUEST_SCHEMA,
  type WakeflowTodoInspectionRequestV1,
} from "../contracts/generated/entrypoints/wakeflow-todo-inspection-request.generated.js";
import {
  WAKEFLOW_TODO_INSPECTION_RESULT_SCHEMA,
  type WakeflowTodoInspectionResultV1,
} from "../contracts/generated/entrypoints/wakeflow-todo-inspection-result.generated.js";
import {
  WAKEFLOW_TODO_INTAKE_PUBLICATION_REQUEST_SCHEMA,
  type WakeflowTodoIntakePublicationRequestV1,
} from "../contracts/generated/entrypoints/wakeflow-todo-intake-publication-request.generated.js";
import {
  WAKEFLOW_TODO_INTAKE_PUBLICATION_RESULT_SCHEMA,
  type WakeflowTodoIntakePublicationResultV1,
} from "../contracts/generated/entrypoints/wakeflow-todo-intake-publication-result.generated.js";
import {
  DemandControllerRoutePublicContractError,
  WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
} from "../governance/controller/demand-controller-route-public-contract.js";
import {
  DemandControllerRoutePublicCoordinatorError,
  type DemandControllerRoutePublicResult,
} from "../governance/controller/demand-controller-route-public-coordinator.js";
import {
  DemandPublicationPublicContractError,
  WAKEFLOW_DEMAND_PUBLICATION_PUBLIC_TOOL_NAME,
} from "../governance/demand/publication/demand-publication-public-contract.js";
import {
  DemandPublicationPublicCoordinatorError,
  type DemandPublicationPublicResult,
} from "../governance/demand/publication/demand-publication-public-coordinator.js";
import {
  ManagedEvidencePublicContractError,
  WAKEFLOW_MANAGED_EVIDENCE_PUBLIC_TOOL_NAME,
} from "../governance/evidence/managed-evidence-public-contract.js";
import {
  ManagedEvidencePublicCoordinatorError,
  type ManagedEvidencePublicResult,
} from "../governance/evidence/managed-evidence-public-coordinator.js";
import {
  LedgerAuthorityPublicationPublicContractError,
  WAKEFLOW_CONFIRMATION_PUBLICATION_PUBLIC_TOOL_NAME,
  WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME,
  type ConfirmationPublicationPublicResult,
  type RequirementPublicationPublicResult,
} from "../governance/ledger/ledger-authority-public-contract.js";
import {
  LedgerAuthorityPublicationPublicCoordinatorError,
} from "../governance/ledger/ledger-authority-public-coordinator.js";
import {
  TodoInspectionPublicContractError,
  WAKEFLOW_TODO_INSPECTION_PUBLIC_TOOL_NAME,
  type TodoInspectionPublicResult,
} from "../governance/todo/todo-inspection-public-contract.js";
import {
  TodoInspectionPublicCoordinatorError,
} from "../governance/todo/todo-inspection-public-coordinator.js";
import {
  TodoIntakePublicationPublicContractError,
  WAKEFLOW_TODO_INTAKE_PUBLICATION_PUBLIC_TOOL_NAME,
  type TodoIntakePublicationPublicResult,
} from "../governance/todo/todo-intake-publication-public-contract.js";
import {
  TodoIntakePublicationPublicCoordinatorError,
} from "../governance/todo/todo-intake-publication-public-coordinator.js";
import {
  registerWakeflowPublicMcpTool,
  type WakeflowPublicMcpErrorDetails,
  type WakeflowPublicMcpExecutor,
} from "./wakeflow-public-mcp-tool.js";

/** Ledger、TODO、Demand、Evidence与Route公共Authority面所需的executor。 */
export interface WakeflowPublicMcpAuthorityExecutors {
  readonly createDemand: WakeflowPublicMcpExecutor<DemandPublicationPublicResult>;
  readonly inspectDemandRoute: WakeflowPublicMcpExecutor<DemandControllerRoutePublicResult>;
  readonly inspectTodo: WakeflowPublicMcpExecutor<TodoInspectionPublicResult>;
  readonly intakeTodo: WakeflowPublicMcpExecutor<TodoIntakePublicationPublicResult>;
  readonly publishConfirmation: WakeflowPublicMcpExecutor<ConfirmationPublicationPublicResult>;
  readonly publishRequirement: WakeflowPublicMcpExecutor<RequirementPublicationPublicResult>;
  readonly recordManagedEvidence: WakeflowPublicMcpExecutor<ManagedEvidencePublicResult>;
}

function ledgerAuthorityPublicationError(
  error: unknown,
): Readonly<WakeflowPublicMcpErrorDetails> | null {
  if (error instanceof LedgerAuthorityPublicationPublicContractError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      path: error.path,
    });
  }
  if (error instanceof LedgerAuthorityPublicationPublicCoordinatorError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      ...(error.causeCode === null ? {} : { causeCode: error.causeCode }),
      ...(error.causeReason === null ? {} : { causeReason: error.causeReason }),
      publicationAuthority: error.publicationAuthority,
    });
  }
  return null;
}

function demandPublicationError(
  error: unknown,
): Readonly<WakeflowPublicMcpErrorDetails> | null {
  if (error instanceof DemandPublicationPublicContractError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      path: error.path,
    });
  }
  if (error instanceof DemandPublicationPublicCoordinatorError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      ...(error.causeCode === null ? {} : { causeCode: error.causeCode }),
      ...(error.causeReason === null ? {} : { causeReason: error.causeReason }),
      publicationAuthority: error.publicationAuthority,
    });
  }
  return null;
}

function managedEvidenceError(
  error: unknown,
): Readonly<WakeflowPublicMcpErrorDetails> | null {
  if (error instanceof ManagedEvidencePublicContractError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      path: error.path,
    });
  }
  if (error instanceof ManagedEvidencePublicCoordinatorError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      ...(error.causeCode === null ? {} : { causeCode: error.causeCode }),
      ...(error.causeReason === null ? {} : { causeReason: error.causeReason }),
      publicationAuthority: error.publicationAuthority,
    });
  }
  return null;
}

function todoInspectionError(
  error: unknown,
): Readonly<WakeflowPublicMcpErrorDetails> | null {
  if (error instanceof TodoInspectionPublicContractError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      path: error.path,
    });
  }
  if (error instanceof TodoInspectionPublicCoordinatorError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      ...(error.causeCode === null ? {} : { causeCode: error.causeCode }),
      ...(error.causeReason === null ? {} : { causeReason: error.causeReason }),
    });
  }
  return null;
}

function todoIntakePublicationError(
  error: unknown,
): Readonly<WakeflowPublicMcpErrorDetails> | null {
  if (error instanceof TodoIntakePublicationPublicContractError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      path: error.path,
    });
  }
  if (error instanceof TodoIntakePublicationPublicCoordinatorError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      ...(error.causeCode === null ? {} : { causeCode: error.causeCode }),
      ...(error.causeReason === null ? {} : { causeReason: error.causeReason }),
      publicationAuthority: error.publicationAuthority,
    });
  }
  return null;
}

function demandControllerRouteError(
  error: unknown,
): Readonly<WakeflowPublicMcpErrorDetails> | null {
  if (error instanceof DemandControllerRoutePublicContractError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      path: error.path,
    });
  }
  if (error instanceof DemandControllerRoutePublicCoordinatorError) {
    return Object.freeze({
      code: error.code,
      reason: error.reason,
      ...(error.causeCode === null ? {} : { causeCode: error.causeCode }),
      ...(error.causeReason === null ? {} : { causeReason: error.causeReason }),
    });
  }
  return null;
}

/** 注册从Design/Ledger到TODO、Demand、Evidence和Route的公共Authority工具。 */
export function registerWakeflowPublicMcpAuthorityTools(
  server: McpServer,
  executors: Readonly<WakeflowPublicMcpAuthorityExecutors>,
): void {
  registerWakeflowPublicMcpTool<
    WakeflowRequirementPublicationRequestV1,
    WakeflowRequirementPublicationResultV1
  >(server, {
    name: WAKEFLOW_REQUIREMENT_PUBLICATION_PUBLIC_TOOL_NAME,
    title: "Publish Wakeflow Requirement Authority",
    description: [
      "Preview, apply, or recover one immutable Requirement authority publication from the current Design surface.",
      "Preview accepts only a title, the Design surface identity, and 1–32 role-bound Markdown member paths. Wakeflow derives Program and Requirement identities, source observations, digests, Ledger paths, and the complete publication plan.",
      "Apply accepts only the exact preview plan and digest, revalidates current source bytes, and publishes additively and idempotently. Recover uses only the exact plan plus durable intent, stage, and final state; it reports input-required when a partial stage lacks source bytes.",
      "Success returns the plan or metadata-only Requirement/member references. It exposes no Workspace or source physical path, document bytes, internal loaded record, stage, lock, or host effect.",
    ].join(" "),
    inputSchema: fromJsonSchema<WakeflowRequirementPublicationRequestV1>(
      WAKEFLOW_REQUIREMENT_PUBLICATION_REQUEST_SCHEMA,
    ),
    outputSchema: fromJsonSchema<WakeflowRequirementPublicationResultV1>(
      WAKEFLOW_REQUIREMENT_PUBLICATION_RESULT_SCHEMA,
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: executors.publishRequirement,
    mapError: ledgerAuthorityPublicationError,
  });

  registerWakeflowPublicMcpTool<
    WakeflowConfirmationPublicationRequestV1,
    WakeflowConfirmationPublicationResultV1
  >(server, {
    name: WAKEFLOW_CONFIRMATION_PUBLICATION_PUBLIC_TOOL_NAME,
    title: "Publish Wakeflow Confirmation Authority",
    description: [
      "Preview, apply, or recover one immutable pre-Demand Confirmation authority publication from the current Design surface.",
      "Preview accepts only a title, the Design surface identity, and 1–32 role-bound Markdown member paths. Wakeflow derives Program and Confirmation identities, the future isolated Demand identity, source observations, digests, Ledger paths, and the complete publication plan.",
      "Apply accepts only the exact preview plan and digest, revalidates current source bytes, and publishes additively and idempotently. Recover uses only the exact plan plus durable intent, stage, and final state; it reports input-required when a partial stage lacks source bytes.",
      "Success returns the plan or metadata-only Confirmation, future Demand, and member references. It creates no Demand and exposes no Workspace or source physical path, document bytes, internal loaded record, stage, lock, or host effect.",
    ].join(" "),
    inputSchema: fromJsonSchema<WakeflowConfirmationPublicationRequestV1>(
      WAKEFLOW_CONFIRMATION_PUBLICATION_REQUEST_SCHEMA,
    ),
    outputSchema: fromJsonSchema<WakeflowConfirmationPublicationResultV1>(
      WAKEFLOW_CONFIRMATION_PUBLICATION_RESULT_SCHEMA,
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: executors.publishConfirmation,
    mapError: ledgerAuthorityPublicationError,
  });

  registerWakeflowPublicMcpTool<
    WakeflowDemandPublicationRequestV1,
    WakeflowDemandPublicationResultV1
  >(server, {
    name: WAKEFLOW_DEMAND_PUBLICATION_PUBLIC_TOOL_NAME,
    title: "Create Wakeflow Demand",
    description: [
      "Preview, apply, or explicitly recover one TODO-backed Demand Event Sourcing publication.",
      "Preview is read-only and derives Program, Demand type, testing, complete Ledger Authority, IDs, time, paths, Event/Commit data, and TODO CAS from current authority.",
      "Apply accepts only the exact preview plan and digest. Recover accepts only a Demand ID with exact durable sidecar evidence.",
      "This tool performs no host effect and returns no machine path or complete business record; inspect the Demand Route after publication is current.",
    ].join(" "),
    inputSchema: fromJsonSchema<WakeflowDemandPublicationRequestV1>(
      WAKEFLOW_DEMAND_PUBLICATION_REQUEST_SCHEMA,
    ),
    outputSchema: fromJsonSchema<WakeflowDemandPublicationResultV1>(
      WAKEFLOW_DEMAND_PUBLICATION_RESULT_SCHEMA,
    ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: executors.createDemand,
    mapError: demandPublicationError,
  });

  registerWakeflowPublicMcpTool<
    WakeflowManagedEvidencePublicationRequestV1,
    WakeflowManagedEvidencePublicationResultV1
  >(server, {
    name: WAKEFLOW_MANAGED_EVIDENCE_PUBLIC_TOOL_NAME,
    title: "Record Wakeflow Managed Evidence",
    description: [
      "Preview, apply, or recover one immutable local Managed Evidence publication for an existing Demand.",
      "Preview accepts only the Demand identity and a configured repository/support-surface source selection. Wakeflow derives Evidence/Event/Commit identities, capture time, source digest, Manifest, record tree, CAS expectations, and transaction digest.",
      "Apply accepts only the exact preview plan and digest. Recover inspects the Demand-level durable journal and may return current, retired-stale, or healthy.",
      "Apply and recover results contain typed IDs, digests, and Event/Commit/Aggregate cursors only. They return no source path, Manifest body, payload bytes, private node, host identity, or Reader output. Preview includes the caller-selected logical source inside the confirmation plan. This tool performs no host effect.",
    ].join(" "),
    inputSchema:
      fromJsonSchema<WakeflowManagedEvidencePublicationRequestV1>(
        WAKEFLOW_MANAGED_EVIDENCE_PUBLICATION_REQUEST_SCHEMA,
      ),
    outputSchema:
      fromJsonSchema<WakeflowManagedEvidencePublicationResultV1>(
        WAKEFLOW_MANAGED_EVIDENCE_PUBLICATION_RESULT_SCHEMA,
      ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: executors.recordManagedEvidence,
    mapError: managedEvidenceError,
  });

  registerWakeflowPublicMcpTool<
    WakeflowTodoInspectionRequestV1,
    WakeflowTodoInspectionResultV1
  >(server, {
    name: WAKEFLOW_TODO_INSPECTION_PUBLIC_TOOL_NAME,
    title: "Inspect Wakeflow TODO",
    description: [
      "List one bounded page of TODO summaries or inspect one exact TODO item from the strict JSON Authority.",
      "List uses the fixed createdAt and TODO-ID order, optional observation filters, a default page size of 20, and a maximum of 100. Its opaque token binds the normalized filter and exact collection snapshot.",
      "Item returns complete business Intake with Ledger member references and a redacted State. Results expose no workspace root, file node, storage key, Board/projection content, lock, transaction, state-root ref, or mount identity digest.",
      "This tool is read-only. It does not derive eligibility, select the next item, claim work, create a TODO or Demand, repair a projection, or grant mutation authority.",
    ].join(" "),
    inputSchema: fromJsonSchema<WakeflowTodoInspectionRequestV1>(
      WAKEFLOW_TODO_INSPECTION_REQUEST_SCHEMA,
    ),
    outputSchema: fromJsonSchema<WakeflowTodoInspectionResultV1>(
      WAKEFLOW_TODO_INSPECTION_RESULT_SCHEMA,
    ),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: executors.inspectTodo,
    mapError: todoInspectionError,
  });

  registerWakeflowPublicMcpTool<
    WakeflowTodoIntakePublicationRequestV1,
    WakeflowTodoIntakePublicationResultV1
  >(server, {
    name: WAKEFLOW_TODO_INTAKE_PUBLICATION_PUBLIC_TOOL_NAME,
    title: "Intake Wakeflow TODO",
    description: [
      "Preview, apply, or recover one immutable TODO Intake and its initial State.",
      "Preview accepts only author-owned queue semantics, one current origin window, a testing decision, and selected immutable Ledger members. Wakeflow derives Program, Controller, complete member references, environment reference, TODO ID, time, Config/Collection expectations, and the complete Intake plan.",
      "Apply and recover require the exact preview plan and digest. Publication is additive and idempotent, and interrupted Collection transactions use the existing exact recovery owner.",
      "Success returns only TODO identity, initial status, and Intake/State/Collection digests. This tool creates no Demand, performs no host effect, and does not execute Auto Claim.",
    ].join(" "),
    inputSchema:
      fromJsonSchema<WakeflowTodoIntakePublicationRequestV1>(
        WAKEFLOW_TODO_INTAKE_PUBLICATION_REQUEST_SCHEMA,
      ),
    outputSchema:
      fromJsonSchema<WakeflowTodoIntakePublicationResultV1>(
        WAKEFLOW_TODO_INTAKE_PUBLICATION_RESULT_SCHEMA,
      ),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: executors.intakeTodo,
    mapError: todoIntakePublicationError,
  });

  registerWakeflowPublicMcpTool<
    WakeflowDemandControllerRouteRequestV1,
    WakeflowDemandControllerRouteResultV1
  >(server, {
    name: WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
    title: "Inspect Wakeflow Demand Route",
    description: [
      "Inspect one current, read-only Demand Controller Route from the verified Config, Demand Event Stream, Review Snapshot, and Post-Acceptance Route.",
      "The result identifies typed responsibility frontiers and capability blockers without exposing workspace paths, host handles, prompts, or full business records.",
      "This observation never authorizes a mutation, host effect, review decision, or acceptance.",
    ].join(" "),
    inputSchema: fromJsonSchema<WakeflowDemandControllerRouteRequestV1>(
      WAKEFLOW_DEMAND_CONTROLLER_ROUTE_REQUEST_SCHEMA,
    ),
    outputSchema: fromJsonSchema<WakeflowDemandControllerRouteResultV1>(
      WAKEFLOW_DEMAND_CONTROLLER_ROUTE_RESULT_SCHEMA,
    ),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: executors.inspectDemandRoute,
    mapError: demandControllerRouteError,
  });
}
