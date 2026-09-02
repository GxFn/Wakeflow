import { deepEqual, equal, match, notEqual, throws } from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { parseSha256Digest } from "../../src/foundation/crypto/sha256.js";
import { RootedDirectory } from "../../src/foundation/filesystem/rooted-directory.js";

import {
  createWakeflowPublicMcpServer,
  WakeflowPublicMcpServerConfigurationError,
} from "../../src/entrypoints/wakeflow-public-mcp-server.js";
import { createCodexWakeflowMcpServer } from "../../src/entrypoints/codex-wakeflow-mcp.js";
import { createClaudeCodeWakeflowMcpServer } from "../../src/entrypoints/claude-code-wakeflow-mcp.js";
import {
  WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
  WakeflowMaintenancePublicContractError,
} from "../../src/workspace/maintenance/wakeflow-maintenance-public-contract.js";
import type { WakeflowMaintenancePublicResult } from "../../src/workspace/maintenance/wakeflow-maintenance-public-coordinator.js";
import { WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME } from "../../src/workspace/window-runtime/wakeflow-window-host-binding-public-contract.js";
import type { WakeflowWindowHostBindingPublicResult } from "../../src/workspace/window-runtime/wakeflow-window-host-binding-public-coordinator.js";
import { WakeflowWindowHostBindingPublicCoordinatorError } from "../../src/workspace/window-runtime/wakeflow-window-host-binding-public-coordinator.js";
import { WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME } from "../../src/governance/tasking/target-task-planning-public-contract.js";
import {
  executeTargetTaskPlanningPublicRequest,
  TargetTaskPlanningPublicCoordinatorError,
  type TargetTaskPlanningPublicResult,
} from "../../src/governance/tasking/target-task-planning-public-coordinator.js";
import {
  computeTargetTaskPlanningPlanDigest,
  createTargetTaskPlanningPlan,
} from "../../src/governance/tasking/target-task-planning-plan.js";
import {
  createTaskPackageFixture,
  taskPackageDraft,
  TASKING_DEMAND_ID,
} from "../governance/tasking/task-package.fixture.js";
import { parseWakeflowDurableIdOfKind } from "../../src/contracts/identity/wakeflow-durable-id.js";
import {
  cleanupTargetTaskPlanningWorkspaceFixture,
  createTargetTaskPlanningWorkspaceFixture,
  planningUuidFactory,
  PLANNING_RECORDED_AT,
} from "../governance/tasking/target-task-planning-service.fixture.js";
import { WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME } from "../../src/governance/controller/demand-controller-route-public-contract.js";
import { DemandEventSourcingRepository } from "../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { demandFinalRootRef } from "../../src/governance/demand/publication/demand-publication-paths.js";
import { WAKEFLOW_DEMAND_PUBLICATION_PUBLIC_TOOL_NAME } from "../../src/governance/demand/publication/demand-publication-public-contract.js";
import type { DemandPublicationPublicResult } from "../../src/governance/demand/publication/demand-publication-public-coordinator.js";
import {
  executeDemandControllerRoutePublicRequest,
  DemandControllerRoutePublicCoordinatorError,
  type DemandControllerRoutePublicResult,
} from "../../src/governance/controller/demand-controller-route-public-coordinator.js";
import { WAKEFLOW_TARGET_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME } from "../../src/governance/delivery/target-delivery-preparation-public-contract.js";
import {
  TargetDeliveryPreparationPublicCoordinatorError,
  type TargetDeliveryPreparationPublicResult,
} from "../../src/governance/delivery/target-delivery-preparation-public-coordinator.js";
import {
  computeTargetDeliveryPreparationPlanDigest,
  createTargetDeliveryPreparationPlan,
} from "../../src/governance/delivery/target-delivery-preparation-plan.js";
import { windowWorkClaimRef } from "../../src/governance/delivery/window-work-claim-resource-catalog.js";
import { createTargetDeliveryIntentFixture } from "../governance/delivery/target-delivery-intent.fixture.js";
import {
  cleanupTargetDeliveryPreparationWorkspaceFixture,
  createTargetDeliveryPreparationWorkspaceFixture,
} from "../governance/delivery/target-delivery-preparation-service.fixture.js";
import { WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_PUBLIC_TOOL_NAME } from "../../src/governance/delivery/target-host-effect-claim-public-contract.js";
import {
  TargetHostEffectClaimPublicCoordinatorError,
  type TargetHostEffectClaimPublicResult,
} from "../../src/governance/delivery/target-host-effect-claim-public-coordinator.js";
import { WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_PUBLIC_TOOL_NAME } from "../../src/governance/delivery/target-host-effect-outcome-public-contract.js";
import {
  TargetHostEffectOutcomePublicCoordinatorError,
  type TargetHostEffectOutcomePublicResult,
} from "../../src/governance/delivery/target-host-effect-outcome-public-coordinator.js";
import { WAKEFLOW_TARGET_HOST_EFFECT_REARM_PUBLIC_TOOL_NAME } from "../../src/governance/delivery/target-host-effect-rearm-public-contract.js";
import {
  TargetHostEffectRearmPublicCoordinatorError,
  type TargetHostEffectRearmPublicResult,
} from "../../src/governance/delivery/target-host-effect-rearm-public-coordinator.js";
import { WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME } from "../../src/governance/result/target-result-import-public-contract.js";
import {
  TargetResultImportPublicCoordinatorError,
  type TargetResultImportPublicResult,
} from "../../src/governance/result/target-result-import-public-coordinator.js";
import { WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME } from "../../src/governance/review/target-result-review-inspection-public-contract.js";
import {
  TargetResultReviewInspectionPublicCoordinatorError,
  type TargetResultReviewInspectionPublicResult,
} from "../../src/governance/review/target-result-review-inspection-public-coordinator.js";
import { WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME } from "../../src/governance/review/controller-implementation-review-decision-public-contract.js";
import {
  ControllerImplementationReviewDecisionPublicCoordinatorError,
  type ControllerImplementationReviewDecisionPublicResult,
} from "../../src/governance/review/controller-implementation-review-decision-public-coordinator.js";
import { WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_PUBLIC_TOOL_NAME } from "../../src/governance/review/controller-test-review-decision-public-contract.js";
import type { ControllerTestReviewDecisionPublicResult } from "../../src/governance/review/controller-test-review-decision-public-coordinator.js";
import { WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_PUBLIC_TOOL_NAME } from "../../src/governance/review/controller-product-defect-remediation-public-contract.js";
import type { ControllerProductDefectRemediationPublicResult } from "../../src/governance/review/controller-product-defect-remediation-public-coordinator.js";
import { WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME } from "../../src/governance/lifecycle/demand-completion-public-contract.js";
import {
  DemandCompletionPublicCoordinatorError,
  type DemandCompletionPublicResult,
} from "../../src/governance/lifecycle/demand-completion-public-coordinator.js";
import { WAKEFLOW_TARGET_RESULT_REVIEW_RESUME_PUBLIC_TOOL_NAME } from "../../src/governance/review/target-result-review-resume-public-contract.js";
import type { TargetResultReviewResumePublicResult } from "../../src/governance/review/target-result-review-resume-public-coordinator.js";
import { WAKEFLOW_TEST_CARD_PLANNING_PUBLIC_TOOL_NAME } from "../../src/governance/testing/test-card-planning-public-contract.js";
import type { TestCardPlanningPublicResult } from "../../src/governance/testing/test-card-planning-public-coordinator.js";
import { WAKEFLOW_TEST_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME } from "../../src/governance/testing/test-delivery-preparation-public-contract.js";
import type { TestDeliveryPreparationPublicResult } from "../../src/governance/testing/test-delivery-preparation-public-coordinator.js";
import {
  cleanupTargetHostEffectClaimWorkspaceFixture,
  createTargetHostEffectClaimWorkspaceFixture,
} from "../governance/delivery/target-host-effect-claim-service.fixture.js";
import { createTargetResultFixture } from "../governance/result/target-result.fixture.js";
import { createImplementationTargetResultReportContentFixture } from "../governance/result/implementation-target-result-report.fixture.js";
import type { TaskPackage } from "../../src/governance/tasking/task-package.js";
import { createWindowWorkClaimFixture } from "../governance/delivery/window-work-claim.fixture.js";
import { createTargetDeliveryHostEffectObservationFixture } from "../governance/delivery/target-delivery-host-effect-observation.fixture.js";
import { createTargetHostEffectRearmFixture } from "../governance/delivery/target-host-effect-rearm.fixture.js";
import {
  controllerImplementationReviewDecisionInput,
  createControllerImplementationReviewDecisionFixture,
} from "../governance/review/controller-implementation-review-decision.fixture.js";
import {
  cleanupControllerImplementationReviewDecisionServiceFixture,
  createControllerImplementationReviewDecisionServiceFixture,
} from "../governance/review/controller-implementation-review-decision-service.fixture.js";
import {
  cleanupControllerTestReviewDecisionServiceFixture,
  createControllerTestReviewDecisionServiceFixture,
} from "../governance/review/controller-test-review-decision-service.fixture.js";
import {
  cleanupTestCardPlanningWorkspaceFixture,
  createTestCardPlanningWorkspaceFixture,
} from "../governance/testing/test-card-planning-service.fixture.js";
import {
  cleanupTestDeliveryPreparationWorkspaceFixture,
  createTestDeliveryPreparationWorkspaceFixture,
} from "../governance/testing/test-delivery-preparation-service.fixture.js";
import {
  connectWakeflowMcpServerForTest,
  connectWakeflowMcpTestClient as connect,
  wakeflowMcpTextContent as textContent,
} from "./wakeflow-public-mcp-server.fixture.js";

/** 公共MCP聚焦测试共用的合法占位摘要。 */
const ZERO_DIGEST = parseSha256Digest(`sha256:${"0".repeat(64)}`);
const WINDOW_ID = "window_11111111-1111-4111-8111-111111111111";
const BINDING_ID = "window_binding_22222222-2222-4222-8222-222222222222";
const CLAIM_DELIVERY_ID =
  "target-delivery_33333333-3333-4333-8333-333333333333";
const CLAIM_ID = "window_work_claim_44444444-4444-4444-8444-444444444444";
const CLAIM_EVENT_ID = "demand-event_55555555-5555-4555-8555-555555555555";
const CLAIM_COMMIT_ID =
  "demand-event-commit_66666666-6666-4666-8666-666666666666";
const OUTCOME_EVENT_ID = "demand-event_44444444-4444-4444-8444-444444444444";
const OUTCOME_COMMIT_ID =
  "demand-event-commit_44444444-4444-4444-8444-444444444444";
const RESULT_EVENT_ID = "demand-event_77777777-7777-4777-8777-777777777777";
const RESULT_COMMIT_ID =
  "demand-event-commit_88888888-8888-4888-8888-888888888888";
const REARM_EVENT_ID = "demand-event_99999999-9999-4999-8999-999999999999";
const REARM_COMMIT_ID =
  "demand-event-commit_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REVIEW_EVENT_ID = "demand-event_dededede-dede-4ded-8ded-dededededede";
const REVIEW_COMMIT_ID =
  "demand-event-commit_dededede-dede-4ded-8ded-dededededede";

function previewResult(): Readonly<WakeflowMaintenancePublicResult> {
  return Object.freeze({
    kind: "WakeflowMaintenancePublicPreviewResult",
    schemaVersion: 1,
    tool: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
    hostId: "codex",
    mode: "preview",
    action: "reconcile",
    status: "blocked",
    blockerCodes: Object.freeze(["example-blocker"]),
    confirmation: null,
    confirmationDigest: null,
    freshConfigCompilation: null,
    launchIntents: [] as const,
    launchSetDigest: null,
  });
}

function mutationResult(): Readonly<WakeflowMaintenancePublicResult> {
  return Object.freeze({
    kind: "WakeflowMaintenancePublicMutationResult",
    schemaVersion: 1,
    tool: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
    hostId: "codex",
    mode: "apply",
    action: "reconcile",
    status: "no-op",
    operationId: null,
    planDigest: ZERO_DIGEST,
    stepReceipts: Object.freeze([]),
    confirmationDigest: ZERO_DIGEST,
    launchIntents: Object.freeze([]),
    launchSetDigest: null,
  });
}

function bindingResult(): Readonly<WakeflowWindowHostBindingPublicResult> {
  return Object.freeze({
    kind: "WakeflowWindowHostBindingRegistrationResult",
    schemaVersion: 1,
    tool: WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
    hostId: "codex",
    windowId: WINDOW_ID as WakeflowWindowHostBindingPublicResult["windowId"],
    disposition: "registered",
    binding: Object.freeze({
      bindingId:
        BINDING_ID as WakeflowWindowHostBindingPublicResult["binding"]["bindingId"],
      bindingRef:
        `.wakeflow-local/runtime/hosts/codex/identity/window-bindings/${WINDOW_ID}.json` as WakeflowWindowHostBindingPublicResult["binding"]["bindingRef"],
      registeredAt:
        "2026-08-28T10:00:01.000Z" as WakeflowWindowHostBindingPublicResult["binding"]["registeredAt"],
      source: Object.freeze({
        kind: "agent-host-create-result" as const,
        launchIntentDigest:
          ZERO_DIGEST as WakeflowWindowHostBindingPublicResult["binding"]["source"]["launchIntentDigest"],
        observedAt:
          "2026-08-28T10:00:00.000Z" as WakeflowWindowHostBindingPublicResult["binding"]["source"]["observedAt"],
      }),
    }),
    projection: Object.freeze({
      resourceRef:
        `.wakeflow-local/runtime/hosts/codex/projections/window-runtime/${WINDOW_ID}.json` as WakeflowWindowHostBindingPublicResult["projection"]["resourceRef"],
      projectionDigest:
        ZERO_DIGEST as WakeflowWindowHostBindingPublicResult["projection"]["projectionDigest"],
      documentDigest:
        ZERO_DIGEST as WakeflowWindowHostBindingPublicResult["projection"]["documentDigest"],
    }),
  });
}

function planningPreviewResult(): Readonly<TargetTaskPlanningPublicResult> {
  const plan = createTargetTaskPlanningPlan({
    demandId: TASKING_DEMAND_ID,
    expectedStreamRevision: 1,
    commitId: parseWakeflowDurableIdOfKind(
      "demand-event-commit_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "demand-event-commit",
    ),
    eventId: parseWakeflowDurableIdOfKind(
      "demand-event_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "demand-event",
    ),
    taskPackage: createTaskPackageFixture(),
  });
  return Object.freeze({
    kind: "WakeflowTargetTaskPlanningPreviewResult",
    schemaVersion: 1,
    tool: WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME,
    mode: "preview",
    status: "ready",
    plan,
    planDigest: computeTargetTaskPlanningPlanDigest(plan),
  }) as unknown as Readonly<TargetTaskPlanningPublicResult>;
}

function demandRouteResult(): Readonly<DemandControllerRoutePublicResult> {
  const taskPackage = createTaskPackageFixture();
  return Object.freeze({
    kind: "WakeflowDemandControllerRouteInspectionResult",
    schemaVersion: 1,
    tool: WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
    status: "current",
    route: Object.freeze({
      kind: "WakeflowDemandControllerRoute",
      schemaVersion: 1,
      programId: taskPackage.programId,
      demandId: taskPackage.demandId,
      demandType: "requirement",
      lifecycle: "active",
      authorityDigest: taskPackage.demandAuthorityDigest,
      observedEventStream: Object.freeze({
        streamRevision: 1,
        stateDigest: ZERO_DIGEST,
        lastEventId: "demand-event_56565656-5656-4656-8656-565656565656",
        lastEventDigest: ZERO_DIGEST,
      }),
      reviewSnapshotDigest: ZERO_DIGEST,
      disposition: "work-available",
      frontiers: Object.freeze([
        Object.freeze({
          scope: "demand",
          kind: "implementation-task-planning",
          owner: "target-task-planning",
        }),
      ]),
      blockers: Object.freeze([]),
      routeDigest: ZERO_DIGEST,
    }),
  }) as unknown as Readonly<DemandControllerRoutePublicResult>;
}

function deliveryPreparationPreviewResult(): Readonly<TargetDeliveryPreparationPublicResult> {
  const intent = createTargetDeliveryIntentFixture();
  const plan = createTargetDeliveryPreparationPlan({
    demandId: intent.demandId,
    targetTaskId: intent.target.targetTaskId,
    expectedStreamRevision: 2,
    commitId: parseWakeflowDurableIdOfKind(
      "demand-event-commit_34343434-3434-4434-8434-343434343434",
      "demand-event-commit",
    ),
    eventId: parseWakeflowDurableIdOfKind(
      "demand-event_45454545-4545-4454-8454-454545454545",
      "demand-event",
    ),
    intent,
  });
  return Object.freeze({
    kind: "WakeflowTargetDeliveryPreparationPreviewResult",
    schemaVersion: 1,
    tool: WAKEFLOW_TARGET_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME,
    mode: "preview",
    status: "ready",
    plan,
    planDigest: computeTargetDeliveryPreparationPlanDigest(plan),
  }) as unknown as Readonly<TargetDeliveryPreparationPublicResult>;
}

function deliveryPreparationPreviewRequest() {
  const preview = deliveryPreparationPreviewResult();
  if (preview.mode !== "preview") {
    throw new Error("Expected a Delivery Preparation preview fixture.");
  }
  return {
    root: "/workspace",
    mode: "preview" as const,
    demandId: preview.plan.demandId,
    targetTaskId: preview.plan.targetTaskId,
  };
}

function hostEffectClaimReplayResult(): Readonly<TargetHostEffectClaimPublicResult> {
  const taskPackage = createTaskPackageFixture();
  return Object.freeze({
    kind: "WakeflowTargetHostEffectClaimResult",
    schemaVersion: 1,
    tool: WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_PUBLIC_TOOL_NAME,
    status: "already-claimed",
    disposition: "idempotent",
    claimAuthority: "current",
    eventAuthority: "current",
    claim: Object.freeze({
      claimId: CLAIM_ID,
      claimRef: `.wakeflow-local/runtime/shared/coordination/window-work-claims/${WINDOW_ID}.json`,
      claimDigest: ZERO_DIGEST,
      claimedAt: "2026-09-01T10:00:01.000Z",
      target: Object.freeze({
        workType: "implementation",
        demandId: taskPackage.demandId,
        targetTaskId: taskPackage.targetTaskId,
        targetDeliveryId: CLAIM_DELIVERY_ID,
        intentDigest: ZERO_DIGEST,
      }),
      route: Object.freeze({
        hostId: "codex",
        windowId: WINDOW_ID,
        bindingId: BINDING_ID,
      }),
    }),
    event: Object.freeze({
      eventId: CLAIM_EVENT_ID,
      streamRevision: 4,
    }),
    commit: Object.freeze({
      commitId: CLAIM_COMMIT_ID,
      commitSequence: 4,
      commitDigest: ZERO_DIGEST,
    }),
    stateDigest: ZERO_DIGEST,
    action: null,
  }) as unknown as Readonly<TargetHostEffectClaimPublicResult>;
}

function hostEffectClaimRequest() {
  const taskPackage = createTaskPackageFixture();
  if (taskPackage.workType !== "implementation") {
    throw new Error("Expected an implementation TaskPackage fixture.");
  }
  return {
    root: "/workspace",
    workType: "implementation" as const,
    demandId: taskPackage.demandId,
    targetTaskId: taskPackage.targetTaskId,
    targetDeliveryId: CLAIM_DELIVERY_ID,
    intentDigest: ZERO_DIGEST,
    observation: {
      kind: "WakeflowAgentHostWindowObservation",
      schemaVersion: 1,
      source: "agent-host-inspection-result",
      hostId: "codex",
      windowId: WINDOW_ID,
      bindingId: BINDING_ID,
      handle: {
        kind: "codex-thread",
        value: "private-target-host-handle",
      },
      attestedRoot: {
        status: "matches-configured-root",
        logicalRoot: {
          kind: "repository",
          repositoryId: taskPackage.assignment.repositoryId,
        },
        configuredPlacement: "Product",
      },
      observedAt: "2026-09-01T10:00:00.000Z",
    },
  } as const;
}

function hostEffectOutcomeResult(): Readonly<TargetHostEffectOutcomePublicResult> {
  const taskPackage = createTaskPackageFixture();
  return Object.freeze({
    kind: "WakeflowTargetHostEffectOutcomeResult",
    schemaVersion: 1,
    tool: WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_PUBLIC_TOOL_NAME,
    status: "already-recorded",
    disposition: "idempotent",
    effectDisposition: "accepted",
    claimHandling: "retain",
    claimAuthority: "current",
    eventAuthority: "current",
    target: Object.freeze({
      workType: "implementation",
      demandId: taskPackage.demandId,
      targetTaskId: taskPackage.targetTaskId,
      targetDeliveryId: CLAIM_DELIVERY_ID,
    }),
    claim: Object.freeze({
      actionId: CLAIM_ID,
      claimDigest: ZERO_DIGEST,
    }),
    observation: Object.freeze({
      kind: "WakeflowTargetHostEffectObservationSummary",
      schemaVersion: 1,
      source: "agent-host-effect-observation",
      attempt: Object.freeze({
        status: "accepted",
        evidenceDigest: ZERO_DIGEST,
      }),
      readback: Object.freeze({
        status: "pending",
        evidenceDigest: ZERO_DIGEST,
      }),
      observedAt: "2026-09-01T10:00:02.000Z",
      observationDigest: ZERO_DIGEST,
    }),
    event: Object.freeze({
      eventId: OUTCOME_EVENT_ID,
      streamRevision: 5,
    }),
    commit: Object.freeze({
      commitId: OUTCOME_COMMIT_ID,
      commitSequence: 5,
      commitDigest: ZERO_DIGEST,
    }),
    stateDigest: ZERO_DIGEST,
  }) as unknown as Readonly<TargetHostEffectOutcomePublicResult>;
}

function hostEffectOutcomeRequest() {
  const taskPackage = createTaskPackageFixture();
  return {
    root: "/workspace",
    demandId: taskPackage.demandId,
    actionId: CLAIM_ID,
    claimDigest: ZERO_DIGEST,
    attempt: {
      status: "accepted" as const,
      evidence: { transport: "accepted" },
    },
    readback: {
      status: "pending" as const,
      evidence: { visible: false },
    },
    observedAt: "2026-09-01T10:00:02.000Z",
  } as const;
}

function hostEffectRearmResult(): Readonly<TargetHostEffectRearmPublicResult> {
  const claim = createWindowWorkClaimFixture();
  const observation = createTargetDeliveryHostEffectObservationFixture({
    claim,
    attemptStatus: "rejected-before-effect",
    readbackStatus: "unavailable",
  });
  return Object.freeze({
    kind: "WakeflowTargetHostEffectRearmResult",
    schemaVersion: 1,
    tool: WAKEFLOW_TARGET_HOST_EFFECT_REARM_PUBLIC_TOOL_NAME,
    status: "already-rearmed",
    disposition: "idempotent",
    claimAuthority: "released",
    eventAuthority: "current",
    rearm: createTargetHostEffectRearmFixture(claim, observation),
    event: Object.freeze({
      eventId: REARM_EVENT_ID,
      streamRevision: 6,
    }),
    commit: Object.freeze({
      commitId: REARM_COMMIT_ID,
      commitSequence: 6,
      commitDigest: ZERO_DIGEST,
    }),
    stateDigest: ZERO_DIGEST,
  }) as unknown as Readonly<TargetHostEffectRearmPublicResult>;
}

function hostEffectRearmRequest() {
  const result = hostEffectRearmResult();
  return {
    root: "/workspace",
    demandId: result.rearm.target.demandId,
    actionId: result.rearm.rejectedAttempt.claimId,
    observationDigest: result.rearm.rejectedAttempt.observationDigest,
  } as const;
}

function targetResultImportResult(): Readonly<TargetResultImportPublicResult> {
  return Object.freeze({
    kind: "WakeflowTargetResultImportResult",
    schemaVersion: 1,
    tool: WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME,
    status: "already-recorded",
    disposition: "idempotent",
    claimAuthority: "released",
    eventAuthority: "current",
    result: createTargetResultFixture(),
    event: Object.freeze({
      eventId: RESULT_EVENT_ID,
      streamRevision: 6,
    }),
    commit: Object.freeze({
      commitId: RESULT_COMMIT_ID,
      commitSequence: 6,
      commitDigest: ZERO_DIGEST,
    }),
    stateDigest: ZERO_DIGEST,
  }) as unknown as Readonly<TargetResultImportPublicResult>;
}

function targetResultImportRequest() {
  const result = createTargetResultFixture();
  return {
    root: "/workspace",
    demandId: result.demandId,
    actionId: result.hostEffect.actionId,
    observationDigest: result.hostEffect.observationDigest,
    report: {
      workType: "implementation" as const,
      content: createImplementationTargetResultReportContentFixture(),
    },
  } as const;
}

function targetResultReviewInspectionResult(): Readonly<TargetResultReviewInspectionPublicResult> {
  const taskPackage = createTaskPackageFixture();
  const result = createTargetResultFixture();
  const sourceEvent = Object.freeze({
    eventId: RESULT_EVENT_ID,
    eventDigest: ZERO_DIGEST,
    streamRevision: 6,
  });
  return Object.freeze({
    kind: "WakeflowTargetResultReviewInspectionResult",
    schemaVersion: 1,
    tool: WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME,
    status: "current",
    demand: Object.freeze({
      demandId: taskPackage.demandId,
      lifecycle: "active",
    }),
    eventStream: Object.freeze({
      commitSequence: 6,
      streamRevision: 6,
      lastCommitDigest: ZERO_DIGEST,
      lastEventId: RESULT_EVENT_ID,
      lastEventDigest: ZERO_DIGEST,
      stateDigest: ZERO_DIGEST,
    }),
    snapshotDigest: ZERO_DIGEST,
    reviewUnit: Object.freeze({
      status: "reported",
      workType: "implementation",
      targetTaskId: taskPackage.targetTaskId,
      outcome: result.report.outcome,
      taskPackageSourceEvent: sourceEvent,
      taskPackage,
      targetResultSourceEvent: sourceEvent,
      targetResult: result,
      priorReviewHistory: Object.freeze([]),
      reviewUnitDigest: ZERO_DIGEST,
    }),
  }) as unknown as Readonly<TargetResultReviewInspectionPublicResult>;
}

function targetResultReviewInspectionRequest() {
  const result = targetResultReviewInspectionResult();
  return {
    root: "/workspace",
    demandId: result.demand.demandId,
    targetTaskId: result.reviewUnit.targetTaskId,
  } as const;
}

function implementationReviewDecisionResult(): Readonly<ControllerImplementationReviewDecisionPublicResult> {
  return Object.freeze({
    kind: "WakeflowControllerImplementationReviewDecisionResult",
    schemaVersion: 1,
    tool: WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME,
    status: "already-decided",
    disposition: "idempotent",
    eventAuthority: "current",
    decision: createControllerImplementationReviewDecisionFixture(),
    event: Object.freeze({
      eventId: REVIEW_EVENT_ID,
      streamRevision: 9,
    }),
    commit: Object.freeze({
      commitId: REVIEW_COMMIT_ID,
      commitSequence: 9,
      commitDigest: ZERO_DIGEST,
    }),
    stateDigest: ZERO_DIGEST,
  }) as unknown as Readonly<ControllerImplementationReviewDecisionPublicResult>;
}

function implementationReviewDecisionRequest() {
  const inspection = targetResultReviewInspectionResult();
  const judgment = controllerImplementationReviewDecisionInput();
  return {
    root: "/workspace",
    demandId: inspection.demand.demandId,
    targetResultId: inspection.reviewUnit.targetResult.targetResultId,
    snapshotDigest: inspection.snapshotDigest,
    reviewUnitDigest: inspection.reviewUnit.reviewUnitDigest,
    decision: judgment.decision,
    assessment: judgment.assessment,
    independentChecks: judgment.independentChecks,
    rationale: judgment.rationale,
    blockingReasons: judgment.blockingReasons,
    residualRisks: judgment.residualRisks,
  } as const;
}

async function taskPackageForTargetDelivery(
  workspacePath: string,
  demandId: string,
  targetDeliveryId: string,
): Promise<Readonly<TaskPackage>> {
  const demandRoot = await RootedDirectory.open(
    path.join(workspacePath, ...demandFinalRootRef(demandId).split("/")),
  );
  try {
    const repository = new DemandEventSourcingRepository(demandRoot);
    const prepared =
      await repository.findTargetDeliveryPreparedEvent(targetDeliveryId);
    if (prepared === null) {
      throw new Error("Expected Target Delivery Prepared Event.");
    }
    const planned = await repository.findTargetTaskPlannedEvent(
      prepared.event.data.intent.target.taskPackageId,
    );
    if (planned === null) {
      throw new Error("Expected Target Task Planned Event.");
    }
    return planned.event.data.taskPackage;
  } finally {
    await demandRoot.close();
  }
}

function planningPreviewRequest() {
  const draft = taskPackageDraft();
  return {
    root: "/workspace",
    mode: "preview" as const,
    demandId: TASKING_DEMAND_ID,
    taskPackage: {
      assignment: draft.assignment,
      workType: draft.workType,
      objective: draft.objective,
      confirmedContext: draft.confirmedContext,
      selectedAuthorityMemberRefs: draft.selectedAuthorityRefs.map(
        (reference) => reference.memberRef,
      ),
      boundaries: draft.boundaries,
      completionExpectations: draft.completionExpectations,
      commitExpectation: draft.commitExpectation,
      acceptanceAnchors: draft.acceptanceAnchors,
    },
  };
}

test("MCP composition拒绝Proxy executor与额外配置字段", () => {
  const executeMaintenance = async () => previewResult();
  const inspectDemandRoute = async () => demandRouteResult();
  const inspectTargetResultReview = async () =>
    targetResultReviewInspectionResult();
  const planTargetTask = async () => planningPreviewResult();
  const prepareImplementationDelivery = async () =>
    deliveryPreparationPreviewResult();
  const prepareTestDelivery = async (): Promise<
    Readonly<TestDeliveryPreparationPublicResult>
  > => {
    throw new Error(
      "Test Delivery Preparation executor was not expected in this test.",
    );
  };
  const claimTargetHostEffect = async () => hostEffectClaimReplayResult();
  const completeDemand = async (): Promise<
    Readonly<DemandCompletionPublicResult>
  > => {
    throw new Error(
      "Demand Completion executor was not expected in this test.",
    );
  };
  const createDemand = async (): Promise<
    Readonly<DemandPublicationPublicResult>
  > => {
    throw new Error(
      "Demand Publication executor was not expected in this test.",
    );
  };
  const resumeTargetResultReview = async (): Promise<
    Readonly<TargetResultReviewResumePublicResult>
  > => {
    throw new Error("Review Resume executor was not expected in this test.");
  };
  const planTestCard = async (): Promise<
    Readonly<TestCardPlanningPublicResult>
  > => {
    throw new Error(
      "TestCard Planning executor was not expected in this test.",
    );
  };
  const recordTargetHostEffectOutcome = async () => hostEffectOutcomeResult();
  const rearmTargetHostEffect = async () => hostEffectRearmResult();
  const importTargetResult = async () => targetResultImportResult();
  const recordControllerImplementationReviewDecision = async () =>
    implementationReviewDecisionResult();
  const recordControllerTestReviewDecision = async (): Promise<
    Readonly<ControllerTestReviewDecisionPublicResult>
  > => {
    throw new Error(
      "Controller Test Review Decision executor was not expected in this test.",
    );
  };
  const authorizeProductDefectRemediation = async (): Promise<
    Readonly<ControllerProductDefectRemediationPublicResult>
  > => {
    throw new Error(
      "Controller Product Defect Remediation executor was not expected in this test.",
    );
  };
  const registerWindowHostBinding = async () => bindingResult();
  const valid = Object.freeze({
    serverName: "wakeflow-test",
    serverVersion: "1.0.0-test",
    authorizeProductDefectRemediation,
    claimTargetHostEffect,
    completeDemand,
    createDemand,
    executeMaintenance,
    importTargetResult,
    inspectDemandRoute,
    inspectTargetResultReview,
    planTargetTask,
    planTestCard,
    prepareImplementationDelivery,
    prepareTestDelivery,
    rearmTargetHostEffect,
    recordControllerImplementationReviewDecision,
    recordControllerTestReviewDecision,
    recordTargetHostEffectOutcome,
    registerWindowHostBinding,
    resumeTargetResultReview,
  });
  const proxyCases = Object.freeze([
    ["executeMaintenance", "maintenance-executor"],
    ["completeDemand", "demand-completion-executor"],
    ["createDemand", "demand-publication-executor"],
    ["resumeTargetResultReview", "target-result-review-resume-executor"],
    ["registerWindowHostBinding", "window-host-binding-executor"],
    ["claimTargetHostEffect", "target-host-effect-claim-executor"],
    ["inspectDemandRoute", "demand-controller-route-executor"],
    ["planTargetTask", "target-task-planning-executor"],
    ["planTestCard", "test-card-planning-executor"],
    ["prepareImplementationDelivery", "target-delivery-preparation-executor"],
    ["prepareTestDelivery", "test-delivery-preparation-executor"],
    ["recordTargetHostEffectOutcome", "target-host-effect-outcome-executor"],
    ["rearmTargetHostEffect", "target-host-effect-rearm-executor"],
    ["importTargetResult", "target-result-import-executor"],
    ["inspectTargetResultReview", "target-result-review-inspection-executor"],
    [
      "recordControllerImplementationReviewDecision",
      "controller-implementation-review-decision-executor",
    ],
    [
      "recordControllerTestReviewDecision",
      "controller-test-review-decision-executor",
    ],
    [
      "authorizeProductDefectRemediation",
      "controller-product-defect-remediation-executor",
    ],
  ] as const);
  for (const [field, reason] of proxyCases) {
    const executor = valid[field];
    throws(
      () =>
        createWakeflowPublicMcpServer({
          ...valid,
          [field]: new Proxy(executor, {}),
        }),
      (error: unknown) =>
        error instanceof WakeflowPublicMcpServerConfigurationError &&
        error.reason === reason,
    );
  }
  throws(
    () =>
      createWakeflowPublicMcpServer({
        ...valid,
        extra: true,
      } as never),
    (error: unknown) =>
      error instanceof WakeflowPublicMcpServerConfigurationError &&
      error.reason === "options",
  );
});

test("官方 MCP server 只发布十八个已有真实 owner 的 Schema 工具", async (t) => {
  const calls: unknown[] = [];
  const expected = previewResult();
  const client = await connect(t, {
    executeMaintenance: async (request) => {
      calls.push(request);
      return expected;
    },
  });

  const listed = await client.listTools();
  equal(listed.tools.length, 18);
  const tool = listed.tools.find(
    (entry) => entry.name === WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
  );
  equal(tool?.name, WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME);
  equal(
    tool?.inputSchema.$id,
    "urn:wakeflow:entrypoints:maintenance-public-request:v1",
  );
  equal(
    tool?.outputSchema?.$id,
    "urn:wakeflow:entrypoints:maintenance-public-result:v1",
  );
  equal(tool?.annotations?.readOnlyHint, false);
  equal(tool?.annotations?.openWorldHint, false);

  const request = {
    root: "/workspace",
    action: "reconcile",
    mode: "preview",
    request: {},
  } as const;
  const result = await client.callTool({
    name: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
    arguments: request,
  });
  equal(result.isError, undefined);
  deepEqual(result.structuredContent, expected);
  deepEqual(JSON.parse(textContent(result)), expected);
  deepEqual(calls, [request]);

  const publicationTool = listed.tools.find(
    (entry) => entry.name === WAKEFLOW_DEMAND_PUBLICATION_PUBLIC_TOOL_NAME,
  );
  equal(
    publicationTool?.inputSchema.$id,
    "urn:wakeflow:entrypoints:demand-publication-request:v1",
  );
  equal(
    publicationTool?.outputSchema?.$id,
    "urn:wakeflow:entrypoints:demand-publication-result:v1",
  );
  equal(publicationTool?.annotations?.readOnlyHint, false);
  equal(publicationTool?.annotations?.destructiveHint, true);
  equal(publicationTool?.annotations?.idempotentHint, true);
  equal(publicationTool?.annotations?.openWorldHint, false);
  equal(
    publicationTool?.description?.includes("performs no host effect"),
    true,
  );
  equal(
    JSON.stringify(publicationTool?.inputSchema).includes('"$ref":"urn:'),
    false,
  );
  equal(
    JSON.stringify(publicationTool?.outputSchema).includes('"$ref":"urn:'),
    false,
  );

  const completionTool = listed.tools.find(
    (entry) => entry.name === WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME,
  );
  equal(
    completionTool?.inputSchema.$id,
    "urn:wakeflow:entrypoints:demand-completion-request:v1",
  );
  equal(
    completionTool?.outputSchema?.$id,
    "urn:wakeflow:entrypoints:demand-completion-result:v1",
  );
  equal(completionTool?.annotations?.readOnlyHint, false);
  equal(completionTool?.annotations?.destructiveHint, true);
  equal(completionTool?.annotations?.idempotentHint, true);
  equal(completionTool?.annotations?.openWorldHint, false);
  equal(
    completionTool?.description?.includes("Completion is not Archive"),
    true,
  );
  equal(
    JSON.stringify(completionTool?.inputSchema).includes('"$ref":"urn:'),
    false,
  );
  equal(
    JSON.stringify(completionTool?.outputSchema).includes('"$ref":"urn:'),
    false,
  );

  const resumeTool = listed.tools.find(
    (entry) =>
      entry.name === WAKEFLOW_TARGET_RESULT_REVIEW_RESUME_PUBLIC_TOOL_NAME,
  );
  equal(
    resumeTool?.inputSchema.$id,
    "urn:wakeflow:entrypoints:target-result-review-resume-request:v1",
  );
  equal(
    resumeTool?.outputSchema?.$id,
    "urn:wakeflow:entrypoints:target-result-review-resume-result:v1",
  );
  equal(resumeTool?.annotations?.readOnlyHint, false);
  equal(resumeTool?.annotations?.destructiveHint, false);
  equal(resumeTool?.annotations?.idempotentHint, true);
  equal(resumeTool?.annotations?.openWorldHint, false);
  equal(resumeTool?.description?.includes("runs no checks"), true);
  equal(resumeTool?.description?.includes("grants no accept"), true);
  equal(
    JSON.stringify(resumeTool?.inputSchema).includes('"$ref":"urn:'),
    false,
  );
  equal(
    JSON.stringify(resumeTool?.outputSchema).includes('"$ref":"urn:'),
    false,
  );

  const testCardTool = listed.tools.find(
    (entry) => entry.name === WAKEFLOW_TEST_CARD_PLANNING_PUBLIC_TOOL_NAME,
  );
  equal(
    testCardTool?.inputSchema.$id,
    "urn:wakeflow:entrypoints:test-card-planning-request:v1",
  );
  equal(
    testCardTool?.outputSchema?.$id,
    "urn:wakeflow:entrypoints:test-card-planning-result:v1",
  );
  equal(testCardTool?.annotations?.readOnlyHint, false);
  equal(testCardTool?.annotations?.destructiveHint, false);
  equal(testCardTool?.annotations?.idempotentHint, true);
  equal(testCardTool?.annotations?.openWorldHint, false);
  equal(testCardTool?.description?.includes("creates no Test Task"), true);
  equal(testCardTool?.description?.includes("runs no Test"), true);
  equal(
    JSON.stringify(testCardTool?.inputSchema).includes('"$ref":"urn:'),
    false,
  );
  equal(
    JSON.stringify(testCardTool?.outputSchema).includes('"$ref":"urn:'),
    false,
  );

  const testDeliveryTool = listed.tools.find(
    (entry) =>
      entry.name === WAKEFLOW_TEST_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME,
  );
  equal(
    testDeliveryTool?.inputSchema.$id,
    "urn:wakeflow:entrypoints:test-delivery-preparation-request:v1",
  );
  equal(
    testDeliveryTool?.outputSchema?.$id,
    "urn:wakeflow:entrypoints:test-delivery-preparation-result:v1",
  );
  equal(testDeliveryTool?.annotations?.readOnlyHint, false);
  equal(testDeliveryTool?.annotations?.destructiveHint, false);
  equal(testDeliveryTool?.annotations?.idempotentHint, true);
  equal(testDeliveryTool?.annotations?.openWorldHint, false);
  equal(
    testDeliveryTool?.description?.includes(
      "derives initial, rerun, or replacement mode",
    ),
    true,
  );
  equal(
    testDeliveryTool?.description?.includes("creates no Dispatch Packet"),
    true,
  );
  equal(
    JSON.stringify(testDeliveryTool?.inputSchema).includes('"$ref":"urn:'),
    false,
  );
  equal(
    JSON.stringify(testDeliveryTool?.outputSchema).includes('"$ref":"urn:'),
    false,
  );

  const testDecisionTool = listed.tools.find(
    (entry) =>
      entry.name === WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_PUBLIC_TOOL_NAME,
  );
  equal(
    testDecisionTool?.inputSchema.$id,
    "urn:wakeflow:entrypoints:controller-test-review-decision-request:v1",
  );
  equal(
    testDecisionTool?.outputSchema?.$id,
    "urn:wakeflow:entrypoints:controller-test-review-decision-result:v1",
  );
  equal(testDecisionTool?.annotations?.readOnlyHint, false);
  equal(testDecisionTool?.annotations?.destructiveHint, true);
  equal(testDecisionTool?.annotations?.idempotentHint, true);
  equal(testDecisionTool?.annotations?.openWorldHint, false);
  equal(testDecisionTool?.description?.includes("does not run checks"), true);
  equal(
    testDecisionTool?.description?.includes("create another attempt"),
    true,
  );
  equal(
    JSON.stringify(testDecisionTool?.inputSchema).includes('"$ref":"urn:'),
    false,
  );
  equal(
    JSON.stringify(testDecisionTool?.outputSchema).includes('"$ref":"urn:'),
    false,
  );

  const remediationTool = listed.tools.find(
    (entry) =>
      entry.name ===
      WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_PUBLIC_TOOL_NAME,
  );
  equal(
    remediationTool?.inputSchema.$id,
    "urn:wakeflow:entrypoints:controller-product-defect-remediation-request:v1",
  );
  equal(
    remediationTool?.outputSchema?.$id,
    "urn:wakeflow:entrypoints:controller-product-defect-remediation-result:v1",
  );
  equal(remediationTool?.annotations?.readOnlyHint, false);
  equal(remediationTool?.annotations?.destructiveHint, true);
  equal(remediationTool?.annotations?.idempotentHint, true);
  equal(remediationTool?.annotations?.openWorldHint, false);
  equal(
    remediationTool?.description?.includes("does not create Delivery"),
    true,
  );
  equal(
    remediationTool?.description?.includes("let Test modify product code"),
    true,
  );
  equal(
    JSON.stringify(remediationTool?.inputSchema).includes('"$ref":"urn:'),
    false,
  );
  equal(
    JSON.stringify(remediationTool?.outputSchema).includes('"$ref":"urn:'),
    false,
  );
});

test("Codex与Claude Code composition root发布同一十八工具集合", async () => {
  const listedNames: string[][] = [];
  for (const createServer of [
    createCodexWakeflowMcpServer,
    createClaudeCodeWakeflowMcpServer,
  ]) {
    const server = createServer("1.0.0-test");
    const { client, close } = await connectWakeflowMcpServerForTest(server);
    try {
      listedNames.push(
        (await client.listTools()).tools.map((entry) => entry.name).sort(),
      );
    } finally {
      await close();
    }
  }
  deepEqual(listedNames[0], listedNames[1]);
  deepEqual(
    listedNames[0],
    [
      WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
      WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
      WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME,
      WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME,
      WAKEFLOW_TARGET_RESULT_REVIEW_RESUME_PUBLIC_TOOL_NAME,
      WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME,
      WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_PUBLIC_TOOL_NAME,
      WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_PUBLIC_TOOL_NAME,
      WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME,
      WAKEFLOW_DEMAND_PUBLICATION_PUBLIC_TOOL_NAME,
      WAKEFLOW_TARGET_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME,
      WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_PUBLIC_TOOL_NAME,
      WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_PUBLIC_TOOL_NAME,
      WAKEFLOW_TARGET_HOST_EFFECT_REARM_PUBLIC_TOOL_NAME,
      WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME,
      WAKEFLOW_TEST_CARD_PLANNING_PUBLIC_TOOL_NAME,
      WAKEFLOW_TEST_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME,
      WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
    ].sort(),
  );
});

test("Codex MCP完成真实TestCard与Test Task preview/apply/retry并推进到Test Delivery", async () => {
  const fixture = await createTestCardPlanningWorkspaceFixture();
  const server = createCodexWakeflowMcpServer("1.0.0-test");
  const { client, close } = await connectWakeflowMcpServerForTest(server);
  try {
    const before = await client.callTool({
      name: WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        demandId: fixture.intent.demandId,
      },
    });
    equal(before.isError, undefined, textContent(before));
    equal(
      (
        before.structuredContent as {
          route: { frontiers: Array<{ kind: string }> };
        }
      ).route.frontiers[0]?.kind,
      "test-card-planning",
    );

    const invalid = await client.callTool({
      name: WAKEFLOW_TEST_CARD_PLANNING_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        mode: "preview",
        demandId: fixture.intent.demandId,
        testCard: fixture.testCardContent,
        strategyAuthorityMemberRef: "legacy/strategy.md",
      },
    });
    equal(invalid.isError, true);
    match(textContent(invalid), /Input validation error/u);

    const privateCard = await client.callTool({
      name: WAKEFLOW_TEST_CARD_PLANNING_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        mode: "preview",
        demandId: fixture.intent.demandId,
        testCard: {
          ...fixture.testCardContent,
          controllerSelfChecks: [
            `Controller inspected ${fixture.workspacePath}`,
          ],
        },
      },
    });
    equal(privateCard.isError, true);
    const privateEnvelope = JSON.parse(textContent(privateCard)) as {
      readonly tool: string;
      readonly error: {
        readonly reason: string;
        readonly eventAuthority: string;
      };
    };
    equal(privateEnvelope.tool, WAKEFLOW_TEST_CARD_PLANNING_PUBLIC_TOOL_NAME);
    equal(privateEnvelope.error.reason, "privacy");
    equal(privateEnvelope.error.eventAuthority, "unchanged");
    equal(textContent(privateCard).includes(fixture.workspacePath), false);

    const previewCall = await client.callTool({
      name: WAKEFLOW_TEST_CARD_PLANNING_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        mode: "preview",
        demandId: fixture.intent.demandId,
        testCard: fixture.testCardContent,
      },
    });
    equal(previewCall.isError, undefined, textContent(previewCall));
    equal(textContent(previewCall).includes(fixture.workspacePath), false);
    const preview = previewCall.structuredContent as {
      readonly plan: {
        readonly testCard: {
          readonly testCardId: string;
          readonly testBasisAuthorities: Array<{ role: string }>;
        };
      };
      readonly planDigest: string;
    };
    deepEqual(
      preview.plan.testCard.testBasisAuthorities.map(
        (reference) => reference.role,
      ),
      ["requirement-design"],
    );

    const applyArguments = {
      root: fixture.workspacePath,
      mode: "apply",
      plan: preview.plan,
      planDigest: preview.planDigest,
    } as const;
    const appliedCall = await client.callTool({
      name: WAKEFLOW_TEST_CARD_PLANNING_PUBLIC_TOOL_NAME,
      arguments: applyArguments,
    });
    equal(appliedCall.isError, undefined, textContent(appliedCall));
    const applied = appliedCall.structuredContent as {
      readonly status: string;
      readonly disposition: string;
      readonly testCard: { readonly testCardId: string };
      readonly event: { readonly eventId: string };
    };
    equal(applied.status, "created");
    equal(applied.disposition, "committed");
    equal(applied.testCard.testCardId, preview.plan.testCard.testCardId);
    equal(textContent(appliedCall).includes(fixture.workspacePath), false);

    const after = await client.callTool({
      name: WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        demandId: fixture.intent.demandId,
      },
    });
    equal(after.isError, undefined, textContent(after));
    equal(
      (
        after.structuredContent as {
          route: { frontiers: Array<{ kind: string }> };
        }
      ).route.frontiers[0]?.kind,
      "test-task-planning",
    );

    const replayedCall = await client.callTool({
      name: WAKEFLOW_TEST_CARD_PLANNING_PUBLIC_TOOL_NAME,
      arguments: applyArguments,
    });
    equal(replayedCall.isError, undefined, textContent(replayedCall));
    const replayed = replayedCall.structuredContent as {
      readonly status: string;
      readonly disposition: string;
      readonly event: { readonly eventId: string };
    };
    equal(replayed.status, "already-created");
    equal(replayed.disposition, "idempotent");
    equal(replayed.event.eventId, applied.event.eventId);

    const taskPreviewCall = await client.callTool({
      name: WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        mode: "preview",
        demandId: fixture.intent.demandId,
        taskPackage: { workType: "test" },
      },
    });
    equal(taskPreviewCall.isError, undefined, textContent(taskPreviewCall));
    const taskPreview = taskPreviewCall.structuredContent as {
      readonly plan: {
        readonly taskPackage: {
          readonly workType: string;
          readonly testCard: { readonly testCardId: string };
        };
      };
      readonly planDigest: string;
    };
    equal(taskPreview.plan.taskPackage.workType, "test");
    equal(
      taskPreview.plan.taskPackage.testCard.testCardId,
      applied.testCard.testCardId,
    );
    const taskApplyArguments = {
      root: fixture.workspacePath,
      mode: "apply",
      plan: taskPreview.plan,
      planDigest: taskPreview.planDigest,
    } as const;
    const taskAppliedCall = await client.callTool({
      name: WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME,
      arguments: taskApplyArguments,
    });
    equal(taskAppliedCall.isError, undefined, textContent(taskAppliedCall));
    const taskApplied = taskAppliedCall.structuredContent as {
      readonly disposition: string;
      readonly targetTask: {
        readonly workType: string;
        readonly phase: string;
        readonly testCard: { readonly testCardId: string };
      };
      readonly event: { readonly eventId: string };
    };
    equal(taskApplied.disposition, "committed");
    equal(taskApplied.targetTask.workType, "test");
    equal(taskApplied.targetTask.phase, "planned");
    equal(
      taskApplied.targetTask.testCard.testCardId,
      applied.testCard.testCardId,
    );
    const afterTask = await client.callTool({
      name: WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        demandId: fixture.intent.demandId,
      },
    });
    equal(afterTask.isError, undefined, textContent(afterTask));
    equal(
      (
        afterTask.structuredContent as {
          route: { frontiers: Array<{ kind: string }> };
        }
      ).route.frontiers[0]?.kind,
      "test-delivery-planning",
    );
    const taskReplayedCall = await client.callTool({
      name: WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME,
      arguments: taskApplyArguments,
    });
    equal(taskReplayedCall.isError, undefined, textContent(taskReplayedCall));
    const taskReplayed = taskReplayedCall.structuredContent as {
      readonly disposition: string;
      readonly targetTask: { readonly phase: string };
      readonly event: { readonly eventId: string };
    };
    equal(taskReplayed.disposition, "idempotent");
    equal(taskReplayed.targetTask.phase, "planned");
    equal(taskReplayed.event.eventId, taskApplied.event.eventId);
  } finally {
    await close();
    await cleanupTestCardPlanningWorkspaceFixture(fixture);
  }
});

test("Demand Controller Route MCP保持只读Schema、structured result与SDK前置准入", async (t) => {
  const calls: unknown[] = [];
  const expected = demandRouteResult();
  const client = await connect(t, {
    inspectDemandRoute: async (request) => {
      calls.push(request);
      return expected;
    },
  });
  const listed = await client.listTools();
  const tool = listed.tools.find(
    (entry) => entry.name === WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
  );
  equal(
    tool?.inputSchema.$id,
    "urn:wakeflow:entrypoints:demand-controller-route-request:v1",
  );
  equal(
    tool?.outputSchema?.$id,
    "urn:wakeflow:entrypoints:demand-controller-route-result:v1",
  );
  equal(tool?.annotations?.readOnlyHint, true);
  equal(tool?.annotations?.destructiveHint, false);
  equal(tool?.annotations?.idempotentHint, true);
  equal(tool?.annotations?.openWorldHint, false);
  equal(JSON.stringify(tool?.inputSchema).includes('"$ref":"urn:'), false);
  equal(JSON.stringify(tool?.outputSchema).includes('"$ref":"urn:'), false);

  const request = {
    root: "/workspace",
    demandId: TASKING_DEMAND_ID,
  } as const;
  const rejected = await client.callTool({
    name: WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
    arguments: { ...request, unownedField: true },
  });
  equal(rejected.isError, true);
  match(textContent(rejected), /Input validation error/u);
  equal(calls.length, 0);

  const result = await client.callTool({
    name: WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
    arguments: request,
  });
  equal(result.isError, undefined);
  deepEqual(result.structuredContent, expected);
  deepEqual(JSON.parse(textContent(result)), expected);
  deepEqual(calls, [request]);
});

test("official MCP Client读取真实Demand Controller Route且不回显workspace root", async (t) => {
  const fixture = await createTargetTaskPlanningWorkspaceFixture();
  try {
    const client = await connect(t, {
      inspectDemandRoute: executeDemandControllerRoutePublicRequest,
    });
    const result = await client.callTool({
      name: WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        demandId: fixture.request.demandId,
      },
    });
    equal(result.isError, undefined);
    equal(textContent(result).includes(fixture.workspacePath), false);
    const structured = result.structuredContent as {
      readonly route: {
        readonly frontiers: readonly { readonly kind: string }[];
      };
    };
    equal(structured.route.frontiers[0]?.kind, "implementation-task-planning");
  } finally {
    await cleanupTargetTaskPlanningWorkspaceFixture(fixture);
  }
});

test("Target Task Planning MCP exposes Implementation/Test schemas and additive idempotency", async (t) => {
  const calls: unknown[] = [];
  const expected = planningPreviewResult();
  const client = await connect(t, {
    planTargetTask: async (request) => {
      calls.push(request);
      return expected;
    },
  });
  const listed = await client.listTools();
  const tool = listed.tools.find(
    (entry) => entry.name === WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME,
  );
  equal(
    tool?.inputSchema.$id,
    "urn:wakeflow:entrypoints:target-task-planning-request:v1",
  );
  equal(
    tool?.outputSchema?.$id,
    "urn:wakeflow:entrypoints:target-task-planning-result:v1",
  );
  equal(tool?.annotations?.readOnlyHint, false);
  equal(tool?.annotations?.destructiveHint, false);
  equal(tool?.annotations?.idempotentHint, true);
  equal(tool?.annotations?.openWorldHint, false);
  equal(JSON.stringify(tool?.inputSchema).includes('"$ref":"urn:'), false);
  equal(JSON.stringify(tool?.outputSchema).includes('"$ref":"urn:'), false);
  equal(tool?.description?.includes("workType=test"), true);
  equal(tool?.description?.includes("current frozen TestCard"), true);

  const request = planningPreviewRequest();
  const result = await client.callTool({
    name: WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME,
    arguments: request,
  });
  equal(result.isError, undefined);
  deepEqual(result.structuredContent, expected);
  deepEqual(JSON.parse(textContent(result)), expected);
  deepEqual(calls, [request]);
});

test("official MCP Client completes a real Target Task Planning preview/apply/retry", async (t) => {
  const fixture = await createTargetTaskPlanningWorkspaceFixture();
  try {
    const client = await connect(t, {
      planTargetTask: (request) =>
        executeTargetTaskPlanningPublicRequest(request, {
          preview: {
            clock: () => PLANNING_RECORDED_AT,
            uuidFactory: planningUuidFactory(),
          },
        }),
    });
    const privateEcho = await client.callTool({
      name: WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        mode: "preview",
        demandId: fixture.request.demandId,
        taskPackage: {
          ...fixture.request.taskPackage,
          objective: `Do not echo ${fixture.workspacePath}/private`,
        },
      },
    });
    equal(privateEcho.isError, true);
    equal(textContent(privateEcho).includes(fixture.workspacePath), false);

    const previewCall = await client.callTool({
      name: WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        mode: "preview",
        demandId: fixture.request.demandId,
        taskPackage: fixture.request.taskPackage,
      },
    });
    equal(previewCall.isError, undefined);
    equal(textContent(previewCall).includes(fixture.workspacePath), false);
    const preview = previewCall.structuredContent as {
      readonly plan: unknown;
      readonly planDigest: string;
    };
    const applyArguments = {
      root: fixture.workspacePath,
      mode: "apply",
      plan: preview.plan,
      planDigest: preview.planDigest,
    } as const;
    const applied = await client.callTool({
      name: WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME,
      arguments: applyArguments,
    });
    equal(applied.isError, undefined);
    equal(textContent(applied).includes(fixture.workspacePath), false);
    equal(
      (applied.structuredContent as { disposition: string }).disposition,
      "committed",
    );
    const replayed = await client.callTool({
      name: WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME,
      arguments: applyArguments,
    });
    equal(replayed.isError, undefined);
    equal(
      (replayed.structuredContent as { disposition: string }).disposition,
      "idempotent",
    );
  } finally {
    await cleanupTargetTaskPlanningWorkspaceFixture(fixture);
  }
});

test("official SDK rejects Target Task Planning extensions before its owner", async (t) => {
  let calls = 0;
  const client = await connect(t, {
    planTargetTask: async () => {
      calls += 1;
      return planningPreviewResult();
    },
  });
  const result = await client.callTool({
    name: WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME,
    arguments: {
      ...planningPreviewRequest(),
      unownedField: true,
    },
  });
  equal(result.isError, true);
  match(textContent(result), /Input validation error/u);
  equal(calls, 0);
  const expandedTestRequest = await client.callTool({
    name: WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME,
    arguments: {
      root: "/workspace",
      mode: "preview",
      demandId: TASKING_DEMAND_ID,
      taskPackage: {
        workType: "test",
        objective: "Caller must not author Test Task content",
      },
    },
  });
  equal(expandedTestRequest.isError, true);
  match(textContent(expandedTestRequest), /Input validation error/u);
  equal(calls, 0);
});

test("Implementation Delivery Preparation MCP公开精确Schema且不跨越Claim边界", async (t) => {
  const calls: unknown[] = [];
  const expected = deliveryPreparationPreviewResult();
  const client = await connect(t, {
    prepareImplementationDelivery: async (request) => {
      calls.push(request);
      return expected;
    },
  });
  const listed = await client.listTools();
  const tool = listed.tools.find(
    (entry) =>
      entry.name === WAKEFLOW_TARGET_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME,
  );
  equal(
    tool?.inputSchema.$id,
    "urn:wakeflow:entrypoints:target-delivery-preparation-request:v1",
  );
  equal(
    tool?.outputSchema?.$id,
    "urn:wakeflow:entrypoints:target-delivery-preparation-result:v1",
  );
  equal(tool?.annotations?.readOnlyHint, false);
  equal(tool?.annotations?.destructiveHint, false);
  equal(tool?.annotations?.idempotentHint, true);
  equal(tool?.annotations?.openWorldHint, false);
  equal(JSON.stringify(tool?.inputSchema).includes('"$ref":"urn:'), false);
  equal(JSON.stringify(tool?.outputSchema).includes('"$ref":"urn:'), false);
  equal(tool?.description?.includes("never creates a WindowWorkClaim"), true);

  const request = deliveryPreparationPreviewRequest();
  const rejected = await client.callTool({
    name: WAKEFLOW_TARGET_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME,
    arguments: { ...request, hostAction: "send" },
  });
  equal(rejected.isError, true);
  match(textContent(rejected), /Input validation error/u);
  equal(calls.length, 0);

  const result = await client.callTool({
    name: WAKEFLOW_TARGET_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME,
    arguments: request,
  });
  equal(result.isError, undefined);
  deepEqual(result.structuredContent, expected);
  deepEqual(JSON.parse(textContent(result)), expected);
  deepEqual(calls, [request]);
});

test("Codex MCP完成真实Preparation preview/apply/retry并把Route推进到Claim", async () => {
  const fixture = await createTargetDeliveryPreparationWorkspaceFixture();
  const server = createCodexWakeflowMcpServer("1.0.0-test");
  const { client, close } = await connectWakeflowMcpServerForTest(server);
  try {
    const before = await client.callTool({
      name: WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        demandId: fixture.request.demandId,
      },
    });
    equal(before.isError, undefined);
    equal(
      (
        before.structuredContent as {
          route: { frontiers: { kind: string }[] };
        }
      ).route.frontiers[0]?.kind,
      "implementation-delivery-planning",
    );

    const previewCall = await client.callTool({
      name: WAKEFLOW_TARGET_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        mode: "preview",
        demandId: fixture.request.demandId,
        targetTaskId: fixture.targetTaskId,
      },
    });
    equal(previewCall.isError, undefined);
    equal(textContent(previewCall).includes(fixture.workspacePath), false);
    equal(textContent(previewCall).includes(fixture.rawHandle), false);
    const preview = previewCall.structuredContent as {
      readonly plan: {
        readonly intent: {
          readonly route: { readonly windowId: string };
        };
      };
      readonly planDigest: string;
    };
    const claimPath = path.join(
      fixture.workspacePath,
      ...windowWorkClaimRef(preview.plan.intent.route.windowId).split("/"),
    );
    equal(existsSync(claimPath), false);

    const applyArguments = {
      root: fixture.workspacePath,
      mode: "apply",
      plan: preview.plan,
      planDigest: preview.planDigest,
    } as const;
    const applied = await client.callTool({
      name: WAKEFLOW_TARGET_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME,
      arguments: applyArguments,
    });
    equal(applied.isError, undefined);
    equal(
      (applied.structuredContent as { disposition: string }).disposition,
      "committed",
    );
    equal(textContent(applied).includes(fixture.workspacePath), false);
    equal(textContent(applied).includes(fixture.rawHandle), false);
    equal(existsSync(claimPath), false);

    const after = await client.callTool({
      name: WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        demandId: fixture.request.demandId,
      },
    });
    equal(after.isError, undefined);
    equal(
      (
        after.structuredContent as {
          route: { frontiers: { kind: string }[] };
        }
      ).route.frontiers[0]?.kind,
      "implementation-host-effect-claim",
    );

    const replayed = await client.callTool({
      name: WAKEFLOW_TARGET_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME,
      arguments: applyArguments,
    });
    equal(replayed.isError, undefined);
    equal(
      (replayed.structuredContent as { disposition: string }).disposition,
      "idempotent",
    );
    equal(existsSync(claimPath), false);
  } finally {
    await close();
    await cleanupTargetDeliveryPreparationWorkspaceFixture(fixture);
  }
});

test("Codex MCP完成真实Test Delivery preview/apply/retry并推进到Host Effect Claim", async () => {
  const fixture = await createTestDeliveryPreparationWorkspaceFixture();
  const server = createCodexWakeflowMcpServer("1.0.0-test");
  const { client, close } = await connectWakeflowMcpServerForTest(server);
  try {
    const before = await client.callTool({
      name: WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        demandId: fixture.testDeliveryRequest.demandId,
      },
    });
    equal(before.isError, undefined, textContent(before));
    equal(
      (
        before.structuredContent as {
          route: { frontiers: Array<{ kind: string }> };
        }
      ).route.frontiers[0]?.kind,
      "test-delivery-planning",
    );

    const privateMissingRoot = path.join(
      fixture.workspacePath,
      "missing-private-test-delivery",
    );
    const missing = await client.callTool({
      name: WAKEFLOW_TEST_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME,
      arguments: {
        root: privateMissingRoot,
        mode: "preview",
        demandId: fixture.testDeliveryRequest.demandId,
        targetTaskId: fixture.testDeliveryRequest.targetTaskId,
      },
    });
    equal(missing.isError, true);
    deepEqual(JSON.parse(textContent(missing)), {
      error: {
        causeCode: "wakeflow-rooted-directory",
        causeReason: "root-not-found",
        code: "wakeflow-test-delivery-preparation-public-coordinator",
        eventAuthority: "unchanged",
        reason: "root",
      },
      kind: "WakeflowMcpError",
      schemaVersion: 1,
      status: "error",
      tool: WAKEFLOW_TEST_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME,
    });
    equal(textContent(missing).includes(privateMissingRoot), false);

    const previewCall = await client.callTool({
      name: WAKEFLOW_TEST_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        mode: "preview",
        demandId: fixture.testDeliveryRequest.demandId,
        targetTaskId: fixture.testDeliveryRequest.targetTaskId,
      },
    });
    equal(previewCall.isError, undefined, textContent(previewCall));
    equal(textContent(previewCall).includes(fixture.workspacePath), false);
    equal(textContent(previewCall).includes(fixture.testRawHandle), false);
    const preview = previewCall.structuredContent as {
      readonly plan: {
        readonly intent: {
          readonly attempt: {
            readonly mode: string;
            readonly ordinal: number;
          };
          readonly route: { readonly windowId: string };
        };
      };
      readonly planDigest: string;
    };
    equal(preview.plan.intent.attempt.mode, "initial");
    equal(preview.plan.intent.attempt.ordinal, 1);
    equal(Object.hasOwn(preview.plan.intent, "packet"), false);
    equal(Object.hasOwn(preview.plan.intent, "workClaim"), false);
    const claimPath = path.join(
      fixture.workspacePath,
      ...windowWorkClaimRef(preview.plan.intent.route.windowId).split("/"),
    );
    equal(existsSync(claimPath), false);

    const applyArguments = {
      root: fixture.workspacePath,
      mode: "apply",
      plan: preview.plan,
      planDigest: preview.planDigest,
    } as const;
    const appliedCall = await client.callTool({
      name: WAKEFLOW_TEST_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME,
      arguments: applyArguments,
    });
    equal(appliedCall.isError, undefined, textContent(appliedCall));
    const applied = appliedCall.structuredContent as {
      readonly disposition: string;
      readonly testDelivery: {
        readonly workType: string;
        readonly authorizationKind: string;
        readonly phase: string;
      };
      readonly event: { readonly eventId: string };
      readonly stateDigest: string;
    };
    equal(applied.disposition, "committed");
    equal(applied.testDelivery.workType, "test");
    equal(applied.testDelivery.authorizationKind, "initial");
    equal(applied.testDelivery.phase, "test-delivery-prepared");
    equal(textContent(appliedCall).includes(fixture.workspacePath), false);
    equal(textContent(appliedCall).includes(fixture.testRawHandle), false);
    equal(existsSync(claimPath), false);

    const after = await client.callTool({
      name: WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        demandId: fixture.testDeliveryRequest.demandId,
      },
    });
    equal(after.isError, undefined, textContent(after));
    equal(
      (
        after.structuredContent as {
          route: { frontiers: Array<{ kind: string }> };
        }
      ).route.frontiers[0]?.kind,
      "test-host-effect-claim",
    );

    const replayedCall = await client.callTool({
      name: WAKEFLOW_TEST_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME,
      arguments: applyArguments,
    });
    equal(replayedCall.isError, undefined, textContent(replayedCall));
    const replayed = replayedCall.structuredContent as typeof applied;
    equal(replayed.disposition, "idempotent");
    equal(replayed.event.eventId, applied.event.eventId);
    equal(replayed.stateDigest, applied.stateDigest);
    equal(existsSync(claimPath), false);
  } finally {
    await close();
    await cleanupTestDeliveryPreparationWorkspaceFixture(fixture);
  }
});

test("Target Host Effect Claim MCP公开共享Schema与一次性Action风险语义", async (t) => {
  const calls: unknown[] = [];
  const expected = hostEffectClaimReplayResult();
  const client = await connect(t, {
    claimTargetHostEffect: async (request) => {
      calls.push(request);
      return expected;
    },
  });
  const listed = await client.listTools();
  const tool = listed.tools.find(
    (entry) =>
      entry.name === WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_PUBLIC_TOOL_NAME,
  );
  equal(
    tool?.inputSchema.$id,
    "urn:wakeflow:entrypoints:target-host-effect-claim-request:v1",
  );
  equal(
    tool?.outputSchema?.$id,
    "urn:wakeflow:entrypoints:target-host-effect-claim-result:v1",
  );
  equal(tool?.annotations?.readOnlyHint, false);
  equal(tool?.annotations?.destructiveHint, false);
  equal(tool?.annotations?.idempotentHint, true);
  equal(tool?.annotations?.openWorldHint, false);
  equal(JSON.stringify(tool?.inputSchema).includes('"$ref":"urn:'), false);
  equal(JSON.stringify(tool?.outputSchema).includes('"$ref":"urn:'), false);
  equal(tool?.description?.includes("action=null"), true);
  equal(
    tool?.description?.includes(
      WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_PUBLIC_TOOL_NAME,
    ),
    true,
  );

  const request = hostEffectClaimRequest();
  const rejected = await client.callTool({
    name: WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_PUBLIC_TOOL_NAME,
    arguments: { ...request, sendNow: true },
  });
  equal(rejected.isError, true);
  match(textContent(rejected), /Input validation error/u);
  equal(
    textContent(rejected).includes(request.observation.handle.value),
    false,
  );
  equal(calls.length, 0);

  const result = await client.callTool({
    name: WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_PUBLIC_TOOL_NAME,
    arguments: request,
  });
  equal(result.isError, undefined);
  deepEqual(result.structuredContent, expected);
  deepEqual(JSON.parse(textContent(result)), expected);
  deepEqual(calls, [request]);
});

test("Target Host Effect Outcome MCP公开最小selector、双轴关系与保守风险注解", async (t) => {
  const calls: unknown[] = [];
  const expected = hostEffectOutcomeResult();
  const client = await connect(t, {
    recordTargetHostEffectOutcome: async (request) => {
      calls.push(request);
      return expected;
    },
  });
  const listed = await client.listTools();
  const tool = listed.tools.find(
    (entry) =>
      entry.name === WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_PUBLIC_TOOL_NAME,
  );
  equal(
    tool?.inputSchema.$id,
    "urn:wakeflow:entrypoints:target-host-effect-outcome-request:v1",
  );
  equal(
    tool?.outputSchema?.$id,
    "urn:wakeflow:entrypoints:target-host-effect-outcome-result:v1",
  );
  equal(tool?.annotations?.readOnlyHint, false);
  equal(tool?.annotations?.destructiveHint, true);
  equal(tool?.annotations?.idempotentHint, true);
  equal(tool?.annotations?.openWorldHint, false);
  equal(JSON.stringify(tool?.inputSchema).includes('"$ref":"urn:'), false);
  equal(JSON.stringify(tool?.outputSchema).includes('"$ref":"urn:'), false);
  equal(tool?.description?.includes("never performs or retries"), true);

  const request = hostEffectOutcomeRequest();
  const rejected = await client.callTool({
    name: WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_PUBLIC_TOOL_NAME,
    arguments: { ...request, sendAgain: true },
  });
  equal(rejected.isError, true);
  match(textContent(rejected), /Input validation error/u);
  equal(textContent(rejected).includes("accepted"), false);
  equal(calls.length, 0);

  const result = await client.callTool({
    name: WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_PUBLIC_TOOL_NAME,
    arguments: request,
  });
  equal(result.isError, undefined);
  deepEqual(result.structuredContent, expected);
  deepEqual(JSON.parse(textContent(result)), expected);
  deepEqual(calls, [request]);
});

test("Target Host Effect Rearm MCP只追加授权Event且不返回Action", async (t) => {
  const calls: unknown[] = [];
  const expected = hostEffectRearmResult();
  const client = await connect(t, {
    rearmTargetHostEffect: async (request) => {
      calls.push(request);
      return expected;
    },
  });
  const listed = await client.listTools();
  const tool = listed.tools.find(
    (entry) =>
      entry.name === WAKEFLOW_TARGET_HOST_EFFECT_REARM_PUBLIC_TOOL_NAME,
  );
  equal(
    tool?.inputSchema.$id,
    "urn:wakeflow:entrypoints:target-host-effect-rearm-request:v1",
  );
  equal(
    tool?.outputSchema?.$id,
    "urn:wakeflow:entrypoints:target-host-effect-rearm-result:v1",
  );
  equal(tool?.annotations?.readOnlyHint, false);
  equal(tool?.annotations?.destructiveHint, false);
  equal(tool?.annotations?.idempotentHint, true);
  equal(tool?.annotations?.openWorldHint, false);
  equal(JSON.stringify(tool?.inputSchema).includes('"$ref":"urn:'), false);
  equal(JSON.stringify(tool?.outputSchema).includes('"$ref":"urn:'), false);
  equal(tool?.description?.includes("never performs the Host effect"), true);
  equal(tool?.description?.includes("Test replacement Delivery"), true);

  const request = hostEffectRearmRequest();
  const rejected = await client.callTool({
    name: WAKEFLOW_TARGET_HOST_EFFECT_REARM_PUBLIC_TOOL_NAME,
    arguments: { ...request, targetTaskId: expected.rearm.target.targetTaskId },
  });
  equal(rejected.isError, true);
  match(textContent(rejected), /Input validation error/u);
  equal(calls.length, 0);

  const result = await client.callTool({
    name: WAKEFLOW_TARGET_HOST_EFFECT_REARM_PUBLIC_TOOL_NAME,
    arguments: request,
  });
  equal(result.isError, undefined);
  deepEqual(result.structuredContent, expected);
  deepEqual(JSON.parse(textContent(result)), expected);
  equal(Object.hasOwn(result.structuredContent ?? {}, "action"), false);
  deepEqual(calls, [request]);
});

test("TargetResult Import MCP公开Report-only输入且不产生Controller acceptance", async (t) => {
  const calls: unknown[] = [];
  const expected = targetResultImportResult();
  const client = await connect(t, {
    importTargetResult: async (request) => {
      calls.push(request);
      return expected;
    },
  });
  const listed = await client.listTools();
  const tool = listed.tools.find(
    (entry) => entry.name === WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME,
  );
  equal(
    tool?.inputSchema.$id,
    "urn:wakeflow:entrypoints:target-result-import-request:v1",
  );
  equal(
    tool?.outputSchema?.$id,
    "urn:wakeflow:entrypoints:target-result-import-result:v1",
  );
  equal(tool?.annotations?.readOnlyHint, false);
  equal(tool?.annotations?.destructiveHint, true);
  equal(tool?.annotations?.idempotentHint, true);
  equal(tool?.annotations?.openWorldHint, false);
  equal(JSON.stringify(tool?.inputSchema).includes('"$ref":"urn:'), false);
  equal(JSON.stringify(tool?.outputSchema).includes('"$ref":"urn:'), false);
  equal(tool?.description?.includes("review input only"), true);

  const request = targetResultImportRequest();
  const rejected = await client.callTool({
    name: WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME,
    arguments: { ...request, controllerAccepted: true },
  });
  equal(rejected.isError, true);
  match(textContent(rejected), /Input validation error/u);
  equal(calls.length, 0);

  const result = await client.callTool({
    name: WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME,
    arguments: request,
  });
  equal(result.isError, undefined);
  deepEqual(result.structuredContent, expected);
  deepEqual(JSON.parse(textContent(result)), expected);
  deepEqual(calls, [request]);
});

test("Target Result Review Inspector MCP只返回当前reported或blocked审查输入", async (t) => {
  const calls: unknown[] = [];
  const expected = targetResultReviewInspectionResult();
  const client = await connect(t, {
    inspectTargetResultReview: async (request) => {
      calls.push(request);
      return expected;
    },
  });
  const listed = await client.listTools();
  const tool = listed.tools.find(
    (entry) =>
      entry.name === WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME,
  );
  equal(
    tool?.inputSchema.$id,
    "urn:wakeflow:entrypoints:target-result-review-inspection-request:v1",
  );
  equal(
    tool?.outputSchema?.$id,
    "urn:wakeflow:entrypoints:target-result-review-inspection-result:v1",
  );
  equal(tool?.annotations?.readOnlyHint, true);
  equal(tool?.annotations?.destructiveHint, false);
  equal(tool?.annotations?.idempotentHint, true);
  equal(tool?.annotations?.openWorldHint, false);
  equal(tool?.description?.includes("review input only"), true);
  equal(tool?.description?.includes("creates no Resume"), true);
  equal(tool?.description?.includes("Controller acceptance"), true);

  const request = targetResultReviewInspectionRequest();
  const rejected = await client.callTool({
    name: WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME,
    arguments: { ...request, decision: "accept" },
  });
  equal(rejected.isError, true);
  match(textContent(rejected), /Input validation error/u);
  equal(calls.length, 0);

  const result = await client.callTool({
    name: WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME,
    arguments: request,
  });
  equal(result.isError, undefined);
  deepEqual(result.structuredContent, expected);
  deepEqual(JSON.parse(textContent(result)), expected);
  equal(Object.hasOwn(result.structuredContent ?? {}, "decision"), false);
  deepEqual(calls, [request]);
});

test("Controller Implementation Review Decision MCP明确拥有唯一acceptance authority", async (t) => {
  const calls: unknown[] = [];
  const expected = implementationReviewDecisionResult();
  const client = await connect(t, {
    recordControllerImplementationReviewDecision: async (request) => {
      calls.push(request);
      return expected;
    },
  });
  const listed = await client.listTools();
  const tool = listed.tools.find(
    (entry) =>
      entry.name ===
      WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME,
  );
  equal(
    tool?.inputSchema.$id,
    "urn:wakeflow:entrypoints:controller-implementation-review-decision-request:v1",
  );
  equal(
    tool?.outputSchema?.$id,
    "urn:wakeflow:entrypoints:controller-implementation-review-decision-result:v1",
  );
  equal(tool?.annotations?.readOnlyHint, false);
  equal(tool?.annotations?.destructiveHint, true);
  equal(tool?.annotations?.idempotentHint, true);
  equal(tool?.annotations?.openWorldHint, false);
  equal(tool?.description?.includes("does not run checks"), true);
  equal(
    tool?.description?.includes(
      "only implementation Target acceptance authority",
    ),
    true,
  );

  const request = implementationReviewDecisionRequest();
  const rejected = await client.callTool({
    name: WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME,
    arguments: {
      ...request,
      targetTaskId: createTaskPackageFixture().targetTaskId,
    },
  });
  equal(rejected.isError, true);
  match(textContent(rejected), /Input validation error/u);
  equal(calls.length, 0);

  const result = await client.callTool({
    name: WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME,
    arguments: request,
  });
  equal(result.isError, undefined);
  deepEqual(result.structuredContent, expected);
  deepEqual(JSON.parse(textContent(result)), expected);
  deepEqual(calls, [request]);
});

test("Codex MCP闭合Test产品缺陷Decision与Remediation Authorization", async () => {
  const fixture = await createControllerTestReviewDecisionServiceFixture();
  const server = createCodexWakeflowMcpServer("1.0.0-test");
  const { client, close } = await connectWakeflowMcpServerForTest(server);
  try {
    const inspectionCall = await client.callTool({
      name: WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        demandId: fixture.testClaimRequest.demandId,
        targetTaskId: fixture.testTargetTaskId,
      },
    });
    equal(inspectionCall.isError, undefined, textContent(inspectionCall));
    const inspection = inspectionCall.structuredContent as {
      readonly snapshotDigest: string;
      readonly reviewUnit: {
        readonly status: string;
        readonly workType: string;
        readonly reviewUnitDigest: string;
        readonly targetResult: { readonly targetResultId: string };
      };
    };
    equal(inspection.reviewUnit.status, "reported");
    equal(inspection.reviewUnit.workType, "test");

    const testDecisionRequest = {
      root: fixture.workspacePath,
      demandId: fixture.testClaimRequest.demandId,
      targetResultId: inspection.reviewUnit.targetResult.targetResultId,
      snapshotDigest: inspection.snapshotDigest,
      reviewUnitDigest: inspection.reviewUnit.reviewUnitDigest,
      decision: "escalate-product-defect" as const,
      assessment: {
        conclusion: "defect-observed" as const,
        evidenceSufficiency: "sufficient" as const,
      },
      independentChecks: [
        {
          checkId: "controller-product-defect",
          method: "复验真实环境Evidence并定位产品行为偏差。",
          outcome: "failed" as const,
          observation: "冻结实现基线在批准场景中稳定复现产品缺陷。",
        },
      ],
      rationale: "当前Test代际已充分证明产品缺陷。",
      blockingReasons: [],
      residualRisks: ["修复后仍需创建新TestCard。"],
    };
    const rejectedTestDecision = await client.callTool({
      name: WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_PUBLIC_TOOL_NAME,
      arguments: {
        ...testDecisionRequest,
        targetTaskId: fixture.testTargetTaskId,
      },
    });
    equal(rejectedTestDecision.isError, true);
    match(textContent(rejectedTestDecision), /Input validation error/u);

    const testDecisionCall = await client.callTool({
      name: WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_PUBLIC_TOOL_NAME,
      arguments: testDecisionRequest,
    });
    equal(testDecisionCall.isError, undefined, textContent(testDecisionCall));
    const testDecision = testDecisionCall.structuredContent as {
      readonly status: string;
      readonly eventAuthority: string;
      readonly decision: {
        readonly targetReviewDecisionId: string;
        readonly decision: string;
      };
      readonly event: { readonly eventId: string };
    };
    equal(testDecision.status, "decided");
    equal(testDecision.eventAuthority, "current");
    equal(testDecision.decision.decision, "escalate-product-defect");

    const conflictingTestDecision = await client.callTool({
      name: WAKEFLOW_CONTROLLER_TEST_REVIEW_DECISION_PUBLIC_TOOL_NAME,
      arguments: {
        ...testDecisionRequest,
        rationale: "试图覆盖同一Test Result的既有Decision。",
      },
    });
    equal(conflictingTestDecision.isError, true);
    const testDecisionError = JSON.parse(
      textContent(conflictingTestDecision),
    ) as { error: Record<string, unknown> };
    deepEqual(testDecisionError.error, {
      causeCode: "wakeflow-controller-test-review-decision-service",
      causeReason: "state",
      code: "wakeflow-controller-test-review-decision-public-coordinator",
      eventAuthority: "current",
      reason: "decision",
    });
    equal(
      textContent(conflictingTestDecision).includes(
        "试图覆盖同一Test Result的既有Decision。",
      ),
      false,
    );

    const defectRouteCall = await client.callTool({
      name: WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        demandId: fixture.testClaimRequest.demandId,
      },
    });
    equal(defectRouteCall.isError, undefined, textContent(defectRouteCall));
    const defectRoute = defectRouteCall.structuredContent as {
      readonly route: {
        readonly postAcceptanceRouteDigest?: string;
        readonly frontiers: readonly { readonly kind: string }[];
      };
    };
    equal(
      defectRoute.route.frontiers[0]?.kind,
      "product-defect-remediation-authorization",
    );
    const postAcceptanceRouteDigest =
      defectRoute.route.postAcceptanceRouteDigest;
    if (postAcceptanceRouteDigest === undefined) {
      throw new Error("Expected product-defect route digest.");
    }
    const baseline = fixture.testCard.implementationBaselines[0];
    if (baseline === undefined) throw new Error("Expected product baseline.");
    const remediationRequest = {
      root: fixture.workspacePath,
      demandId: fixture.testClaimRequest.demandId,
      testReviewDecisionId: testDecision.decision.targetReviewDecisionId,
      postAcceptanceRouteDigest,
      affectedTargets: [
        {
          targetTaskId: baseline.targetTaskId,
          failedCheckIds: ["controller-product-defect"],
          correctionObjective: "在原TaskPackage边界内修复已复现产品缺陷。",
        },
      ],
      authorizationRationale: "缺陷已映射到唯一产品Target及原包边界。",
    };
    const rejectedRemediation = await client.callTool({
      name: WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_PUBLIC_TOOL_NAME,
      arguments: {
        ...remediationRequest,
        testTargetTaskId: fixture.testTargetTaskId,
      },
    });
    equal(rejectedRemediation.isError, true);
    match(textContent(rejectedRemediation), /Input validation error/u);

    const remediationCall = await client.callTool({
      name: WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_PUBLIC_TOOL_NAME,
      arguments: remediationRequest,
    });
    equal(remediationCall.isError, undefined, textContent(remediationCall));
    const remediation = remediationCall.structuredContent as {
      readonly status: string;
      readonly disposition: string;
      readonly eventAuthority: string;
      readonly authorization: {
        readonly productDefectRemediationId: string;
        readonly boundary: string;
        readonly affectedTargets: readonly {
          readonly baseline: { readonly targetTaskId: string };
        }[];
      };
      readonly event: { readonly eventId: string };
    };
    equal(remediation.status, "authorized");
    equal(remediation.disposition, "committed");
    equal(remediation.eventAuthority, "current");
    equal(remediation.authorization.boundary, "existing-task-packages-only");
    equal(
      remediation.authorization.affectedTargets[0]?.baseline.targetTaskId,
      baseline.targetTaskId,
    );

    const replayedRemediation = await client.callTool({
      name: WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_PUBLIC_TOOL_NAME,
      arguments: remediationRequest,
    });
    equal(
      replayedRemediation.isError,
      undefined,
      textContent(replayedRemediation),
    );
    const replayed = replayedRemediation.structuredContent as {
      readonly status: string;
      readonly authorization: {
        readonly productDefectRemediationId: string;
      };
      readonly event: { readonly eventId: string };
    };
    equal(replayed.status, "already-authorized");
    equal(
      replayed.authorization.productDefectRemediationId,
      remediation.authorization.productDefectRemediationId,
    );
    equal(replayed.event.eventId, remediation.event.eventId);

    const conflictingRemediation = await client.callTool({
      name: WAKEFLOW_CONTROLLER_PRODUCT_DEFECT_REMEDIATION_PUBLIC_TOOL_NAME,
      arguments: {
        ...remediationRequest,
        authorizationRationale: "试图覆盖同一Test Decision的既有授权。",
      },
    });
    equal(conflictingRemediation.isError, true);
    const remediationError = JSON.parse(
      textContent(conflictingRemediation),
    ) as { error: Record<string, unknown> };
    deepEqual(remediationError.error, {
      causeCode: "wakeflow-controller-product-defect-remediation-service",
      causeReason: "state",
      code: "wakeflow-controller-product-defect-remediation-public-coordinator",
      eventAuthority: "current",
      reason: "remediation",
    });
    equal(
      textContent(conflictingRemediation).includes(
        "试图覆盖同一Test Decision的既有授权。",
      ),
      false,
    );

    const reworkRouteCall = await client.callTool({
      name: WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        demandId: fixture.testClaimRequest.demandId,
      },
    });
    equal(reworkRouteCall.isError, undefined, textContent(reworkRouteCall));
    const reworkRoute = reworkRouteCall.structuredContent as {
      readonly route: {
        readonly frontiers: readonly {
          readonly scope: string;
          readonly kind: string;
          readonly target?: { readonly targetTaskId: string };
        }[];
      };
    };
    equal(
      reworkRoute.route.frontiers[0]?.kind,
      "implementation-delivery-planning",
    );
    equal(
      reworkRoute.route.frontiers[0]?.target?.targetTaskId,
      baseline.targetTaskId,
    );
    equal(textContent(remediationCall).includes(fixture.workspacePath), false);
    equal(textContent(remediationCall).includes(fixture.testRawHandle), false);
  } finally {
    await close();
    await cleanupControllerTestReviewDecisionServiceFixture(fixture);
  }
});

test("Codex MCP完成真实Claim、Outcome、TargetResult、Controller Review与Completion且不执行宿主发送", async () => {
  const fixture = await createTargetHostEffectClaimWorkspaceFixture();
  const server = createCodexWakeflowMcpServer("1.0.0-test");
  const { client, close } = await connectWakeflowMcpServerForTest(server);
  try {
    const before = await client.callTool({
      name: WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        demandId: fixture.claimRequest.demandId,
      },
    });
    equal(before.isError, undefined);
    equal(
      (
        before.structuredContent as {
          route: { frontiers: { kind: string }[] };
        }
      ).route.frontiers[0]?.kind,
      "implementation-host-effect-claim",
    );

    const request = {
      root: fixture.workspacePath,
      ...fixture.claimRequest,
      observation: {
        ...fixture.claimRequest.observation,
        observedAt: new Date().toISOString(),
      },
    } as const;
    const issuedCall = await client.callTool({
      name: WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_PUBLIC_TOOL_NAME,
      arguments: request,
    });
    equal(issuedCall.isError, undefined);
    const issued = issuedCall.structuredContent as {
      readonly status: string;
      readonly claim: {
        readonly claimId: string;
        readonly claimDigest: string;
        readonly route: { readonly windowId: string };
      };
      readonly action: null | {
        readonly effect: string;
        readonly prompt: string;
        readonly issuedAt: string;
      };
    };
    equal(issued.status, "issued");
    equal(issued.action?.effect, "send-message-to-observed-target-window");
    equal(issued.action?.prompt.includes(fixture.workspacePath), true);
    if (issued.action === null) {
      throw new Error("Expected one host action for the issued Claim.");
    }
    equal(textContent(issuedCall).includes(fixture.rawHandle), false);
    const claimPath = path.join(
      fixture.workspacePath,
      ...windowWorkClaimRef(issued.claim.route.windowId).split("/"),
    );
    equal(existsSync(claimPath), true);

    const after = await client.callTool({
      name: WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        demandId: fixture.claimRequest.demandId,
      },
    });
    equal(after.isError, undefined);
    equal(
      (
        after.structuredContent as {
          route: { frontiers: { kind: string }[] };
        }
      ).route.frontiers[0]?.kind,
      "implementation-host-effect-execution",
    );

    const replayedCall = await client.callTool({
      name: WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_PUBLIC_TOOL_NAME,
      arguments: request,
    });
    equal(replayedCall.isError, undefined);
    const replayed = replayedCall.structuredContent as {
      readonly status: string;
      readonly action: unknown;
      readonly claim: { readonly claimId: string };
    };
    equal(replayed.status, "already-claimed");
    equal(replayed.action, null);
    equal(replayed.claim.claimId, issued.claim.claimId);
    equal(textContent(replayedCall).includes(fixture.workspacePath), false);
    equal(textContent(replayedCall).includes(fixture.rawHandle), false);

    const outcomeRequest = {
      root: fixture.workspacePath,
      demandId: fixture.claimRequest.demandId,
      actionId: issued.claim.claimId,
      claimDigest: issued.claim.claimDigest,
      attempt: {
        status: "accepted" as const,
        evidence: { sourceTestHostResult: "accepted" },
      },
      readback: {
        status: "pending" as const,
        evidence: { sourceTestVisible: false },
      },
      observedAt: new Date(
        Math.max(Date.now(), Date.parse(issued.action.issuedAt) + 1),
      ).toISOString(),
    };
    const outcomeCall = await client.callTool({
      name: WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_PUBLIC_TOOL_NAME,
      arguments: outcomeRequest,
    });
    equal(outcomeCall.isError, undefined);
    const outcome = outcomeCall.structuredContent as {
      readonly status: string;
      readonly effectDisposition: string;
      readonly claimAuthority: string;
      readonly observation: { readonly observationDigest: string };
      readonly event: { readonly eventId: string };
    };
    equal(outcome.status, "recorded");
    equal(outcome.effectDisposition, "accepted");
    equal(outcome.claimAuthority, "current");
    equal(textContent(outcomeCall).includes(fixture.workspacePath), false);
    equal(textContent(outcomeCall).includes(fixture.rawHandle), false);
    equal(textContent(outcomeCall).includes("sourceTestHostResult"), false);

    const afterOutcome = await client.callTool({
      name: WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        demandId: fixture.claimRequest.demandId,
      },
    });
    equal(afterOutcome.isError, undefined);
    equal(
      (
        afterOutcome.structuredContent as {
          route: { frontiers: { kind: string }[] };
        }
      ).route.frontiers[0]?.kind,
      "implementation-target-result-import",
    );

    const replayedOutcomeCall = await client.callTool({
      name: WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_PUBLIC_TOOL_NAME,
      arguments: outcomeRequest,
    });
    equal(replayedOutcomeCall.isError, undefined);
    const replayedOutcome = replayedOutcomeCall.structuredContent as {
      readonly status: string;
      readonly observation: { readonly observationDigest: string };
      readonly event: { readonly eventId: string };
    };
    equal(replayedOutcome.status, "already-recorded");
    equal(
      replayedOutcome.observation.observationDigest,
      outcome.observation.observationDigest,
    );
    equal(replayedOutcome.event.eventId, outcome.event.eventId);

    const taskPackage = await taskPackageForTargetDelivery(
      fixture.workspacePath,
      fixture.intent.demandId,
      fixture.intent.targetDeliveryId,
    );
    const resultRequest = {
      root: fixture.workspacePath,
      demandId: fixture.intent.demandId,
      actionId: issued.claim.claimId,
      observationDigest: outcome.observation.observationDigest,
      report: {
        workType: "implementation" as const,
        content:
          createImplementationTargetResultReportContentFixture(taskPackage),
      },
    };
    const importedCall = await client.callTool({
      name: WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME,
      arguments: resultRequest,
    });
    equal(importedCall.isError, undefined, textContent(importedCall));
    const imported = importedCall.structuredContent as {
      readonly status: string;
      readonly disposition: string;
      readonly claimAuthority: string;
      readonly eventAuthority: string;
      readonly result: {
        readonly workType: string;
        readonly demandId: string;
        readonly targetDeliveryId: string;
        readonly hostEffect: {
          readonly actionId: string;
          readonly observationDigest: string;
        };
        readonly report: { readonly outcome: string };
        readonly resultDigest: string;
      };
      readonly event: { readonly eventId: string };
    };
    equal(imported.status, "recorded");
    equal(imported.disposition, "committed");
    equal(imported.claimAuthority, "released");
    equal(imported.eventAuthority, "current");
    equal(imported.result.workType, "implementation");
    equal(imported.result.demandId, fixture.intent.demandId);
    equal(imported.result.targetDeliveryId, fixture.intent.targetDeliveryId);
    equal(imported.result.hostEffect.actionId, issued.claim.claimId);
    equal(
      imported.result.hostEffect.observationDigest,
      outcome.observation.observationDigest,
    );
    equal(imported.result.report.outcome, "completed");
    equal(existsSync(claimPath), false);
    equal(textContent(importedCall).includes(fixture.workspacePath), false);
    equal(textContent(importedCall).includes(fixture.rawHandle), false);

    const afterResult = await client.callTool({
      name: WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        demandId: fixture.claimRequest.demandId,
      },
    });
    equal(afterResult.isError, undefined);
    equal(
      (
        afterResult.structuredContent as {
          route: { frontiers: { kind: string }[] };
        }
      ).route.frontiers[0]?.kind,
      "implementation-result-review",
    );

    const replayedResultCall = await client.callTool({
      name: WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME,
      arguments: resultRequest,
    });
    equal(
      replayedResultCall.isError,
      undefined,
      textContent(replayedResultCall),
    );
    const replayedResult = replayedResultCall.structuredContent as {
      readonly status: string;
      readonly result: { readonly resultDigest: string };
      readonly event: { readonly eventId: string };
    };
    equal(replayedResult.status, "already-recorded");
    equal(replayedResult.result.resultDigest, imported.result.resultDigest);
    equal(replayedResult.event.eventId, imported.event.eventId);
    equal(existsSync(claimPath), false);

    const inspectionRequest = {
      root: fixture.workspacePath,
      demandId: fixture.intent.demandId,
      targetTaskId: fixture.intent.target.targetTaskId,
    };
    const inspectionCall = await client.callTool({
      name: WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME,
      arguments: inspectionRequest,
    });
    equal(inspectionCall.isError, undefined, textContent(inspectionCall));
    const inspection = inspectionCall.structuredContent as {
      readonly snapshotDigest: string;
      readonly reviewUnit: {
        readonly workType: string;
        readonly reviewUnitDigest: string;
        readonly targetResult: {
          readonly targetResultId: string;
          readonly resultDigest: string;
        };
      };
    };
    equal(inspection.reviewUnit.workType, "implementation");
    equal(
      inspection.reviewUnit.targetResult.resultDigest,
      imported.result.resultDigest,
    );
    equal(Object.hasOwn(inspection, "decision"), false);
    equal(textContent(inspectionCall).includes(fixture.workspacePath), false);

    const judgment = controllerImplementationReviewDecisionInput("accept");
    const decisionRequest = {
      root: fixture.workspacePath,
      demandId: fixture.intent.demandId,
      targetResultId: inspection.reviewUnit.targetResult.targetResultId,
      snapshotDigest: inspection.snapshotDigest,
      reviewUnitDigest: inspection.reviewUnit.reviewUnitDigest,
      decision: judgment.decision,
      assessment: judgment.assessment,
      independentChecks: judgment.independentChecks,
      rationale: judgment.rationale,
      blockingReasons: judgment.blockingReasons,
      residualRisks: judgment.residualRisks,
    };
    const decisionCall = await client.callTool({
      name: WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME,
      arguments: decisionRequest,
    });
    equal(decisionCall.isError, undefined, textContent(decisionCall));
    const decision = decisionCall.structuredContent as {
      readonly status: string;
      readonly eventAuthority: string;
      readonly decision: {
        readonly decision: string;
        readonly targetReviewDecisionId: string;
        readonly decisionDigest: string;
      };
      readonly event: { readonly eventId: string };
    };
    equal(decision.status, "decided");
    equal(decision.eventAuthority, "current");
    equal(decision.decision.decision, "accept");
    equal(textContent(decisionCall).includes(fixture.workspacePath), false);
    equal(textContent(decisionCall).includes(fixture.rawHandle), false);

    const afterDecision = await client.callTool({
      name: WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        demandId: fixture.intent.demandId,
      },
    });
    equal(afterDecision.isError, undefined);
    equal(
      (
        afterDecision.structuredContent as {
          route: { frontiers: { kind: string }[] };
        }
      ).route.frontiers[0]?.kind,
      "demand-completion-preflight",
    );

    const replayedDecisionCall = await client.callTool({
      name: WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME,
      arguments: decisionRequest,
    });
    equal(
      replayedDecisionCall.isError,
      undefined,
      textContent(replayedDecisionCall),
    );
    const replayedDecision = replayedDecisionCall.structuredContent as {
      readonly status: string;
      readonly decision: { readonly targetReviewDecisionId: string };
      readonly event: { readonly eventId: string };
    };
    equal(replayedDecision.status, "already-decided");
    equal(
      replayedDecision.decision.targetReviewDecisionId,
      decision.decision.targetReviewDecisionId,
    );
    equal(replayedDecision.event.eventId, decision.event.eventId);

    const completionPreviewCall = await client.callTool({
      name: WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        mode: "preview",
        demandId: fixture.intent.demandId,
      },
    });
    equal(
      completionPreviewCall.isError,
      undefined,
      textContent(completionPreviewCall),
    );
    const completionPreview = completionPreviewCall.structuredContent as {
      readonly mode: string;
      readonly status: string;
      readonly plan: Readonly<Record<string, unknown>> & {
        readonly demandId: string;
      };
      readonly planDigest: string;
    };
    equal(completionPreview.mode, "preview");
    equal(completionPreview.status, "ready");
    equal(completionPreview.plan.demandId, fixture.intent.demandId);
    equal(
      textContent(completionPreviewCall).includes(fixture.workspacePath),
      false,
    );
    equal(
      textContent(completionPreviewCall).includes(fixture.rawHandle),
      false,
    );

    const completionApplyRequest = {
      root: fixture.workspacePath,
      mode: "apply",
      plan: completionPreview.plan,
      planDigest: completionPreview.planDigest,
    } as const;
    const completionCall = await client.callTool({
      name: WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME,
      arguments: completionApplyRequest,
    });
    equal(completionCall.isError, undefined, textContent(completionCall));
    const completion = completionCall.structuredContent as {
      readonly status: string;
      readonly disposition: string;
      readonly eventAuthority: string;
      readonly completion: {
        readonly demandId: string;
        readonly testingMode: string;
      };
      readonly event: { readonly eventId: string };
      readonly stateDigest: string;
    };
    equal(completion.status, "completed");
    equal(completion.disposition, "committed");
    equal(completion.eventAuthority, "current");
    equal(completion.completion.demandId, fixture.intent.demandId);
    equal(completion.completion.testingMode, "controller-only");
    equal(textContent(completionCall).includes(fixture.workspacePath), false);
    equal(textContent(completionCall).includes(fixture.rawHandle), false);

    const terminalRouteCall = await client.callTool({
      name: WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        demandId: fixture.intent.demandId,
      },
    });
    equal(terminalRouteCall.isError, undefined, textContent(terminalRouteCall));
    const terminalRoute = terminalRouteCall.structuredContent as {
      readonly route: {
        readonly lifecycle: string;
        readonly disposition: string;
        readonly frontiers: readonly unknown[];
      };
    };
    equal(terminalRoute.route.lifecycle, "completed");
    equal(terminalRoute.route.disposition, "terminal");
    equal(terminalRoute.route.frontiers.length, 0);

    const replayedCompletionCall = await client.callTool({
      name: WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME,
      arguments: completionApplyRequest,
    });
    equal(
      replayedCompletionCall.isError,
      undefined,
      textContent(replayedCompletionCall),
    );
    const replayedCompletion = replayedCompletionCall.structuredContent as {
      readonly status: string;
      readonly disposition: string;
      readonly event: { readonly eventId: string };
      readonly stateDigest: string;
    };
    equal(replayedCompletion.status, "already-completed");
    equal(replayedCompletion.disposition, "idempotent");
    equal(replayedCompletion.event.eventId, completion.event.eventId);
    equal(replayedCompletion.stateDigest, completion.stateDigest);
  } finally {
    await close();
    await cleanupTargetHostEffectClaimWorkspaceFixture(fixture);
  }
});

test("Codex MCP从blocked inspection经Resume进入第二代Decision", async () => {
  const fixture =
    await createControllerImplementationReviewDecisionServiceFixture();
  const server = createCodexWakeflowMcpServer("1.0.0-test");
  const { client, close } = await connectWakeflowMcpServerForTest(server);
  try {
    const inspectionRequest = {
      root: fixture.workspacePath,
      demandId: fixture.intent.demandId,
      targetTaskId: fixture.intent.target.targetTaskId,
    } as const;
    const reportedCall = await client.callTool({
      name: WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME,
      arguments: inspectionRequest,
    });
    equal(reportedCall.isError, undefined, textContent(reportedCall));
    const reported = reportedCall.structuredContent as {
      readonly snapshotDigest: string;
      readonly reviewUnit: {
        readonly status: string;
        readonly reviewUnitDigest: string;
        readonly targetResult: { readonly targetResultId: string };
      };
    };
    equal(reported.reviewUnit.status, "reported");

    const blockedJudgment =
      controllerImplementationReviewDecisionInput("blocked");
    const blockedCall = await client.callTool({
      name: WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        demandId: fixture.intent.demandId,
        targetResultId: reported.reviewUnit.targetResult.targetResultId,
        snapshotDigest: reported.snapshotDigest,
        reviewUnitDigest: reported.reviewUnit.reviewUnitDigest,
        decision: blockedJudgment.decision,
        assessment: blockedJudgment.assessment,
        independentChecks: blockedJudgment.independentChecks,
        rationale: blockedJudgment.rationale,
        blockingReasons: blockedJudgment.blockingReasons,
        residualRisks: blockedJudgment.residualRisks,
      },
    });
    equal(blockedCall.isError, undefined, textContent(blockedCall));
    const blocked = blockedCall.structuredContent as {
      readonly decision: {
        readonly targetReviewDecisionId: string;
        readonly decision: string;
      };
    };
    equal(blocked.decision.decision, "blocked");

    const routeCall = await client.callTool({
      name: WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        demandId: fixture.intent.demandId,
      },
    });
    equal(routeCall.isError, undefined, textContent(routeCall));
    equal(
      (
        routeCall.structuredContent as {
          route: { frontiers: { kind: string }[] };
        }
      ).route.frontiers[0]?.kind,
      "implementation-review-resume",
    );

    const blockedInspectionCall = await client.callTool({
      name: WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME,
      arguments: inspectionRequest,
    });
    equal(
      blockedInspectionCall.isError,
      undefined,
      textContent(blockedInspectionCall),
    );
    const blockedInspection = blockedInspectionCall.structuredContent as {
      readonly eventStream: {
        readonly streamRevision: number;
        readonly stateDigest: string;
      };
      readonly reviewUnit: {
        readonly status: string;
        readonly currentBlockedDecision: {
          readonly decision: {
            readonly targetReviewDecisionId: string;
            readonly decision: string;
          };
        };
      };
    };
    equal(blockedInspection.reviewUnit.status, "review-blocked");
    equal(
      blockedInspection.reviewUnit.currentBlockedDecision.decision
        .targetReviewDecisionId,
      blocked.decision.targetReviewDecisionId,
    );

    const resumeRequest = {
      root: fixture.workspacePath,
      demandId: fixture.intent.demandId,
      targetTaskId: fixture.intent.target.targetTaskId,
      expectedBlockedState: {
        streamRevision: blockedInspection.eventStream.streamRevision,
        stateDigest: blockedInspection.eventStream.stateDigest,
      },
      resolutionSummary: "用户已补充缺失决定，Controller可以重新执行独立审查。",
    } as const;
    const staleCall = await client.callTool({
      name: WAKEFLOW_TARGET_RESULT_REVIEW_RESUME_PUBLIC_TOOL_NAME,
      arguments: {
        ...resumeRequest,
        expectedBlockedState: {
          ...resumeRequest.expectedBlockedState,
          stateDigest: `sha256:${"0".repeat(64)}`,
        },
      },
    });
    equal(staleCall.isError, true);
    deepEqual(JSON.parse(textContent(staleCall)), {
      error: {
        causeCode: "wakeflow-controller-target-review-resume-service",
        causeReason: "review-snapshot",
        code: "wakeflow-target-result-review-resume-public-coordinator",
        eventAuthority: "unchanged",
        reason: "resume",
      },
      kind: "WakeflowMcpError",
      schemaVersion: 1,
      status: "error",
      tool: WAKEFLOW_TARGET_RESULT_REVIEW_RESUME_PUBLIC_TOOL_NAME,
    });
    equal(textContent(staleCall).includes(fixture.workspacePath), false);

    const resumedCall = await client.callTool({
      name: WAKEFLOW_TARGET_RESULT_REVIEW_RESUME_PUBLIC_TOOL_NAME,
      arguments: resumeRequest,
    });
    equal(resumedCall.isError, undefined, textContent(resumedCall));
    const resumed = resumedCall.structuredContent as {
      readonly status: string;
      readonly disposition: string;
      readonly eventAuthority: string;
      readonly resume: {
        readonly targetReviewResumeId: string;
        readonly blockedDecision: {
          readonly targetReviewDecisionId: string;
        };
      };
      readonly event: { readonly eventId: string };
    };
    equal(resumed.status, "resumed");
    equal(resumed.disposition, "committed");
    equal(resumed.eventAuthority, "current");
    equal(
      resumed.resume.blockedDecision.targetReviewDecisionId,
      blocked.decision.targetReviewDecisionId,
    );
    equal(textContent(resumedCall).includes(fixture.workspacePath), false);
    equal(textContent(resumedCall).includes(fixture.rawHandle), false);

    const reopenedCall = await client.callTool({
      name: WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME,
      arguments: inspectionRequest,
    });
    equal(reopenedCall.isError, undefined, textContent(reopenedCall));
    const reopened = reopenedCall.structuredContent as {
      readonly snapshotDigest: string;
      readonly reviewUnit: {
        readonly status: string;
        readonly reviewUnitDigest: string;
        readonly targetResult: { readonly targetResultId: string };
        readonly priorReviewHistory: { readonly kind: string }[];
      };
    };
    equal(reopened.reviewUnit.status, "reported");
    deepEqual(
      reopened.reviewUnit.priorReviewHistory.map((entry) => entry.kind),
      ["decision", "resume"],
    );

    const acceptJudgment =
      controllerImplementationReviewDecisionInput("accept");
    const acceptedCall = await client.callTool({
      name: WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        demandId: fixture.intent.demandId,
        targetResultId: reopened.reviewUnit.targetResult.targetResultId,
        snapshotDigest: reopened.snapshotDigest,
        reviewUnitDigest: reopened.reviewUnit.reviewUnitDigest,
        decision: acceptJudgment.decision,
        assessment: acceptJudgment.assessment,
        independentChecks: acceptJudgment.independentChecks,
        rationale: acceptJudgment.rationale,
        blockingReasons: acceptJudgment.blockingReasons,
        residualRisks: acceptJudgment.residualRisks,
      },
    });
    equal(acceptedCall.isError, undefined, textContent(acceptedCall));
    equal(
      (
        acceptedCall.structuredContent as {
          decision: { decision: string };
        }
      ).decision.decision,
      "accept",
    );

    const replayedCall = await client.callTool({
      name: WAKEFLOW_TARGET_RESULT_REVIEW_RESUME_PUBLIC_TOOL_NAME,
      arguments: resumeRequest,
    });
    equal(replayedCall.isError, undefined, textContent(replayedCall));
    const replayed = replayedCall.structuredContent as {
      readonly status: string;
      readonly resume: { readonly targetReviewResumeId: string };
      readonly event: { readonly eventId: string };
    };
    equal(replayed.status, "already-resumed");
    equal(
      replayed.resume.targetReviewResumeId,
      resumed.resume.targetReviewResumeId,
    );
    equal(replayed.event.eventId, resumed.event.eventId);
  } finally {
    await close();
    await cleanupControllerImplementationReviewDecisionServiceFixture(fixture);
  }
});

test("Codex MCP显式Rearm rejected尾部后只准入fresh Claim", async () => {
  const fixture = await createTargetHostEffectClaimWorkspaceFixture();
  const server = createCodexWakeflowMcpServer("1.0.0-test");
  const { client, close } = await connectWakeflowMcpServerForTest(server);
  try {
    const claimRequest = {
      root: fixture.workspacePath,
      ...fixture.claimRequest,
      observation: {
        ...fixture.claimRequest.observation,
        observedAt: new Date().toISOString(),
      },
    } as const;
    const claimedCall = await client.callTool({
      name: WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_PUBLIC_TOOL_NAME,
      arguments: claimRequest,
    });
    equal(claimedCall.isError, undefined, textContent(claimedCall));
    const claimed = claimedCall.structuredContent as {
      readonly status: string;
      readonly claim: {
        readonly claimId: string;
        readonly claimDigest: string;
        readonly route: { readonly windowId: string };
      };
      readonly action: null | { readonly issuedAt: string };
    };
    equal(claimed.status, "issued");
    if (claimed.action === null) {
      throw new Error("Expected first one-shot Agent Host Action.");
    }
    const claimPath = path.join(
      fixture.workspacePath,
      ...windowWorkClaimRef(claimed.claim.route.windowId).split("/"),
    );
    equal(existsSync(claimPath), true);

    const outcomeRequest = {
      root: fixture.workspacePath,
      demandId: fixture.intent.demandId,
      actionId: claimed.claim.claimId,
      claimDigest: claimed.claim.claimDigest,
      attempt: {
        status: "rejected-before-effect" as const,
        evidence: { hostRejectedBeforeEffect: true },
      },
      readback: { status: "unavailable" as const },
      observedAt: new Date(
        Math.max(Date.now(), Date.parse(claimed.action.issuedAt) + 1),
      ).toISOString(),
    };
    const outcomeCall = await client.callTool({
      name: WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_PUBLIC_TOOL_NAME,
      arguments: outcomeRequest,
    });
    equal(outcomeCall.isError, undefined, textContent(outcomeCall));
    const outcome = outcomeCall.structuredContent as {
      readonly effectDisposition: string;
      readonly claimAuthority: string;
      readonly observation: {
        readonly observationDigest: string;
        readonly observedAt: string;
      };
    };
    equal(outcome.effectDisposition, "rejected-before-effect");
    equal(outcome.claimAuthority, "released");
    equal(existsSync(claimPath), false);

    const beforeRearm = await client.callTool({
      name: WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        demandId: fixture.intent.demandId,
      },
    });
    equal(beforeRearm.isError, undefined);
    equal(
      (
        beforeRearm.structuredContent as {
          route: { frontiers: { kind: string }[] };
        }
      ).route.frontiers[0]?.kind,
      "implementation-host-effect-rearm",
    );

    const rearmRequest = {
      root: fixture.workspacePath,
      demandId: fixture.intent.demandId,
      actionId: claimed.claim.claimId,
      observationDigest: outcome.observation.observationDigest,
    };
    const rearmedCall = await client.callTool({
      name: WAKEFLOW_TARGET_HOST_EFFECT_REARM_PUBLIC_TOOL_NAME,
      arguments: rearmRequest,
    });
    equal(rearmedCall.isError, undefined, textContent(rearmedCall));
    const rearmed = rearmedCall.structuredContent as {
      readonly status: string;
      readonly claimAuthority: string;
      readonly eventAuthority: string;
      readonly rearm: {
        readonly rearmedAt: string;
        readonly rearmDigest: string;
      };
      readonly event: { readonly eventId: string };
    };
    equal(rearmed.status, "rearmed");
    equal(rearmed.claimAuthority, "released");
    equal(rearmed.eventAuthority, "current");
    equal(Object.hasOwn(rearmed, "action"), false);
    equal(existsSync(claimPath), false);
    equal(textContent(rearmedCall).includes(fixture.workspacePath), false);
    equal(textContent(rearmedCall).includes(fixture.rawHandle), false);

    const afterRearm = await client.callTool({
      name: WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
      arguments: {
        root: fixture.workspacePath,
        demandId: fixture.intent.demandId,
      },
    });
    equal(afterRearm.isError, undefined);
    equal(
      (
        afterRearm.structuredContent as {
          route: { frontiers: { kind: string }[] };
        }
      ).route.frontiers[0]?.kind,
      "implementation-host-effect-claim",
    );

    const nextClaimCall = await client.callTool({
      name: WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_PUBLIC_TOOL_NAME,
      arguments: {
        ...claimRequest,
        observation: {
          ...claimRequest.observation,
          observedAt: new Date(
            Math.max(Date.now(), Date.parse(rearmed.rearm.rearmedAt) + 1),
          ).toISOString(),
        },
      },
    });
    equal(nextClaimCall.isError, undefined, textContent(nextClaimCall));
    const nextClaim = nextClaimCall.structuredContent as {
      readonly status: string;
      readonly claim: { readonly claimId: string };
      readonly action: unknown;
    };
    equal(nextClaim.status, "issued");
    notEqual(nextClaim.claim.claimId, claimed.claim.claimId);
    equal(nextClaim.action === null, false);
    equal(existsSync(claimPath), true);

    const replayedCall = await client.callTool({
      name: WAKEFLOW_TARGET_HOST_EFFECT_REARM_PUBLIC_TOOL_NAME,
      arguments: rearmRequest,
    });
    equal(replayedCall.isError, undefined, textContent(replayedCall));
    const replayed = replayedCall.structuredContent as {
      readonly status: string;
      readonly rearm: { readonly rearmDigest: string };
      readonly event: { readonly eventId: string };
    };
    equal(replayed.status, "already-rearmed");
    equal(replayed.rearm.rearmDigest, rearmed.rearm.rearmDigest);
    equal(replayed.event.eventId, rearmed.event.eventId);
  } finally {
    await close();
    await cleanupTargetHostEffectClaimWorkspaceFixture(fixture);
  }
});

test("Claim MCP保留双authority错误且不回显root或raw handle", async (t) => {
  const client = await connect(t, {
    claimTargetHostEffect: async () => {
      throw new TargetHostEffectClaimPublicCoordinatorError(
        "claim",
        "wakeflow-window-work-claim-store",
        "write",
        "current",
        "unknown",
      );
    },
  });
  const request = {
    ...hostEffectClaimRequest(),
    root: "/workspace/private-claim",
  } as const;
  const result = await client.callTool({
    name: WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_PUBLIC_TOOL_NAME,
    arguments: request,
  });
  equal(result.isError, true);
  deepEqual(JSON.parse(textContent(result)), {
    error: {
      causeCode: "wakeflow-window-work-claim-store",
      causeReason: "write",
      claimAuthority: "current",
      code: "wakeflow-target-host-effect-claim-public-coordinator",
      eventAuthority: "unknown",
      reason: "claim",
    },
    kind: "WakeflowMcpError",
    schemaVersion: 1,
    status: "error",
    tool: WAKEFLOW_TARGET_HOST_EFFECT_CLAIM_PUBLIC_TOOL_NAME,
  });
  equal(textContent(result).includes(request.root), false);
  equal(textContent(result).includes(request.observation.handle.value), false);
  equal(textContent(result).includes("stack"), false);
});

test("Outcome MCP保留released/current错误权威且不回显root或Evidence", async (t) => {
  const client = await connect(t, {
    recordTargetHostEffectOutcome: async () => {
      throw new TargetHostEffectOutcomePublicCoordinatorError(
        "outcome",
        "wakeflow-window-work-claim-store",
        "claim",
        "released",
        "current",
      );
    },
  });
  const request = {
    ...hostEffectOutcomeRequest(),
    root: "/workspace/private-outcome",
    attempt: {
      status: "accepted" as const,
      evidence: { private: "outcome-evidence-must-not-echo" },
    },
  } as const;
  const result = await client.callTool({
    name: WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_PUBLIC_TOOL_NAME,
    arguments: request,
  });
  equal(result.isError, true);
  deepEqual(JSON.parse(textContent(result)), {
    error: {
      causeCode: "wakeflow-window-work-claim-store",
      causeReason: "claim",
      claimAuthority: "released",
      code: "wakeflow-target-host-effect-outcome-public-coordinator",
      eventAuthority: "current",
      reason: "outcome",
    },
    kind: "WakeflowMcpError",
    schemaVersion: 1,
    status: "error",
    tool: WAKEFLOW_TARGET_HOST_EFFECT_OUTCOME_PUBLIC_TOOL_NAME,
  });
  equal(textContent(result).includes(request.root), false);
  equal(textContent(result).includes("outcome-evidence-must-not-echo"), false);
  equal(textContent(result).includes("stack"), false);
});

test("Rearm MCP保留current Event错误权威且不回显root", async (t) => {
  const client = await connect(t, {
    rearmTargetHostEffect: async () => {
      throw new TargetHostEffectRearmPublicCoordinatorError(
        "rearm",
        "wakeflow-target-host-effect-rearm-service",
        "state",
        "current",
      );
    },
  });
  const request = {
    ...hostEffectRearmRequest(),
    root: "/workspace/private-rearm",
  } as const;
  const result = await client.callTool({
    name: WAKEFLOW_TARGET_HOST_EFFECT_REARM_PUBLIC_TOOL_NAME,
    arguments: request,
  });
  equal(result.isError, true);
  deepEqual(JSON.parse(textContent(result)), {
    error: {
      causeCode: "wakeflow-target-host-effect-rearm-service",
      causeReason: "state",
      code: "wakeflow-target-host-effect-rearm-public-coordinator",
      eventAuthority: "current",
      reason: "rearm",
    },
    kind: "WakeflowMcpError",
    schemaVersion: 1,
    status: "error",
    tool: WAKEFLOW_TARGET_HOST_EFFECT_REARM_PUBLIC_TOOL_NAME,
  });
  equal(textContent(result).includes(request.root), false);
  equal(textContent(result).includes("stack"), false);
});

test("TargetResult Import MCP保留current/released错误权威且不回显root或Report", async (t) => {
  const client = await connect(t, {
    importTargetResult: async () => {
      throw new TargetResultImportPublicCoordinatorError(
        "result-import",
        "wakeflow-window-work-claim-store",
        "claim",
        "current",
        "released",
      );
    },
  });
  const privateReportMarker = "target-report-must-not-echo";
  const request = targetResultImportRequest();
  const privateRequest = {
    ...request,
    root: "/workspace/private-result",
    report: {
      ...request.report,
      content: {
        ...request.report.content,
        summary: privateReportMarker,
      },
    },
  } as const;
  const result = await client.callTool({
    name: WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME,
    arguments: privateRequest,
  });
  equal(result.isError, true);
  deepEqual(JSON.parse(textContent(result)), {
    error: {
      causeCode: "wakeflow-window-work-claim-store",
      causeReason: "claim",
      claimAuthority: "released",
      code: "wakeflow-target-result-import-public-coordinator",
      eventAuthority: "current",
      reason: "result-import",
    },
    kind: "WakeflowMcpError",
    schemaVersion: 1,
    status: "error",
    tool: WAKEFLOW_TARGET_RESULT_IMPORT_PUBLIC_TOOL_NAME,
  });
  equal(textContent(result).includes(privateRequest.root), false);
  equal(textContent(result).includes(privateReportMarker), false);
  equal(textContent(result).includes("stack"), false);
});

test("Review Inspector MCP只公开稳定inspection错误且不回显root", async (t) => {
  const client = await connect(t, {
    inspectTargetResultReview: async () => {
      throw new TargetResultReviewInspectionPublicCoordinatorError(
        "inspection",
        "wakeflow-demand-result-review-snapshot",
        "stream",
      );
    },
  });
  const request = {
    ...targetResultReviewInspectionRequest(),
    root: "/workspace/private-review-inspection",
  } as const;
  const result = await client.callTool({
    name: WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME,
    arguments: request,
  });
  equal(result.isError, true);
  deepEqual(JSON.parse(textContent(result)), {
    error: {
      causeCode: "wakeflow-demand-result-review-snapshot",
      causeReason: "stream",
      code: "wakeflow-target-result-review-inspection-public-coordinator",
      reason: "inspection",
    },
    kind: "WakeflowMcpError",
    schemaVersion: 1,
    status: "error",
    tool: WAKEFLOW_TARGET_RESULT_REVIEW_INSPECTION_PUBLIC_TOOL_NAME,
  });
  equal(textContent(result).includes(request.root), false);
  equal(textContent(result).includes("stack"), false);
});

test("Implementation Decision MCP保留current Event错误权威且不回显判断文本", async (t) => {
  const client = await connect(t, {
    recordControllerImplementationReviewDecision: async () => {
      throw new ControllerImplementationReviewDecisionPublicCoordinatorError(
        "decision",
        "wakeflow-controller-implementation-review-decision-service",
        "state",
        "current",
      );
    },
  });
  const privateMarker = "private-controller-judgment-must-not-echo";
  const request = {
    ...implementationReviewDecisionRequest(),
    root: "/workspace/private-review-decision",
    rationale: privateMarker,
  } as const;
  const result = await client.callTool({
    name: WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME,
    arguments: request,
  });
  equal(result.isError, true);
  deepEqual(JSON.parse(textContent(result)), {
    error: {
      causeCode: "wakeflow-controller-implementation-review-decision-service",
      causeReason: "state",
      code: "wakeflow-controller-implementation-review-decision-public-coordinator",
      eventAuthority: "current",
      reason: "decision",
    },
    kind: "WakeflowMcpError",
    schemaVersion: 1,
    status: "error",
    tool: WAKEFLOW_CONTROLLER_IMPLEMENTATION_REVIEW_DECISION_PUBLIC_TOOL_NAME,
  });
  equal(textContent(result).includes(request.root), false);
  equal(textContent(result).includes(privateMarker), false);
  equal(textContent(result).includes("stack"), false);
});

test("Demand Completion MCP只公开稳定终态错误且不回显root", async (t) => {
  const client = await connect(t, {
    completeDemand: async () => {
      throw new DemandCompletionPublicCoordinatorError(
        "preview",
        "wakeflow-demand-completion-service",
        "route",
        "unchanged",
      );
    },
  });
  const request = {
    root: "/workspace/private-completion",
    mode: "preview",
    demandId: TASKING_DEMAND_ID,
  } as const;
  const result = await client.callTool({
    name: WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME,
    arguments: request,
  });
  equal(result.isError, true);
  deepEqual(JSON.parse(textContent(result)), {
    error: {
      causeCode: "wakeflow-demand-completion-service",
      causeReason: "route",
      code: "wakeflow-demand-completion-public-coordinator",
      eventAuthority: "unchanged",
      reason: "preview",
    },
    kind: "WakeflowMcpError",
    schemaVersion: 1,
    status: "error",
    tool: WAKEFLOW_DEMAND_COMPLETION_PUBLIC_TOOL_NAME,
  });
  equal(textContent(result).includes(request.root), false);
  equal(textContent(result).includes("stack"), false);
});

test("Maintenance MCP Schema接受领域统一的算法前缀摘要", async (t) => {
  const calls: unknown[] = [];
  const expected = mutationResult();
  const client = await connect(t, {
    executeMaintenance: async (request) => {
      calls.push(request);
      return expected;
    },
  });
  const request = {
    root: "/workspace",
    mode: "apply",
    confirmation: { kind: "ExampleConfirmation" },
    confirmationDigest: ZERO_DIGEST,
  } as const;
  const result = await client.callTool({
    name: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
    arguments: request,
  });
  equal(result.isError, undefined);
  deepEqual(result.structuredContent, expected);
  deepEqual(calls, [request]);
});

test("Maintenance MCP输出Schema拒绝不可能的preview字段关系", async (t) => {
  const invalid = {
    ...previewResult(),
    status: "ready",
    blockerCodes: [],
  } as unknown as WakeflowMaintenancePublicResult;
  const client = await connect(t, {
    executeMaintenance: async () => invalid,
  });
  const result = await client.callTool({
    name: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
    arguments: {
      root: "/workspace",
      action: "reconcile",
      mode: "preview",
      request: {},
    },
  });
  equal(result.isError, true);
  match(textContent(result), /Output validation error/u);
});

test("Window Host Binding 工具保持 Agent effect 与私有 handle 边界", async (t) => {
  const observations: unknown[] = [];
  const expected = bindingResult();
  const client = await connect(t, {
    registerWindowHostBinding: async (request) => {
      observations.push(request);
      return expected;
    },
  });
  const listed = await client.listTools();
  const tool = listed.tools.find(
    (entry) => entry.name === WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
  );
  equal(
    tool?.inputSchema.$id,
    "urn:wakeflow:entrypoints:window-host-binding-registration-request:v1",
  );
  equal(JSON.stringify(tool?.outputSchema).includes('"$ref":"urn:'), false);
  equal(tool?.annotations?.idempotentHint, true);

  const request = {
    root: "/workspace",
    observation: {
      kind: "WakeflowAgentHostWindowCreationObservation",
      schemaVersion: 1,
      source: "agent-host-create-result",
      hostId: "codex",
      windowId: WINDOW_ID,
      launchIntentDigest: ZERO_DIGEST,
      handle: {
        kind: "codex-thread",
        value: "opaque-host-thread-id",
      },
      observedAt: "2026-08-28T10:00:00.000Z",
    },
  } as const;
  const result = await client.callTool({
    name: WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
    arguments: request,
  });
  equal(result.isError, undefined);
  deepEqual(result.structuredContent, expected);
  equal(textContent(result).includes("opaque-host-thread-id"), false);
  deepEqual(observations, [request]);
});

test("Window Host Binding输出Schema拒绝越界资源引用", async (t) => {
  const baseline = bindingResult();
  const invalid = {
    ...baseline,
    binding: {
      ...baseline.binding,
      bindingRef: "../outside.json",
    },
  } as unknown as WakeflowWindowHostBindingPublicResult;
  const client = await connect(t, {
    registerWindowHostBinding: async () => invalid,
  });
  const result = await client.callTool({
    name: WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
    arguments: {
      root: "/workspace",
      observation: {
        kind: "WakeflowAgentHostWindowCreationObservation",
        schemaVersion: 1,
        source: "agent-host-create-result",
        hostId: "codex",
        windowId: WINDOW_ID,
        launchIntentDigest: ZERO_DIGEST,
        handle: { kind: "codex-thread", value: "opaque-host-thread-id" },
        observedAt: "2026-08-28T10:00:00.000Z",
      },
    },
  });
  equal(result.isError, true);
  match(textContent(result), /Output validation error/u);
});

test("官方 SDK 在进入 Maintenance owner 前拒绝额外字段", async (t) => {
  let calls = 0;
  const client = await connect(t, {
    executeMaintenance: async () => {
      calls += 1;
      return previewResult();
    },
  });

  const result = await client.callTool({
    name: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
    arguments: {
      root: "/workspace",
      action: "reconcile",
      mode: "preview",
      request: {},
      unownedField: true,
    },
  });
  equal(result.isError, true);
  match(textContent(result), /Input validation error/u);
  equal(calls, 0);
});

test("MCP 错误结果只公开稳定的领域错误字段", async (t) => {
  const client = await connect(t, {
    executeMaintenance: async () => {
      throw new WakeflowMaintenancePublicContractError("shape", "$request");
    },
  });

  const result = await client.callTool({
    name: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
    arguments: {
      root: "/workspace",
      action: "reconcile",
      mode: "preview",
      request: {},
    },
  });
  equal(result.isError, true);
  deepEqual(JSON.parse(textContent(result)), {
    error: {
      code: "wakeflow-maintenance-public-contract",
      path: "$request",
      reason: "shape",
    },
    kind: "WakeflowMcpError",
    schemaVersion: 1,
    status: "error",
    tool: WAKEFLOW_MAINTENANCE_PUBLIC_TOOL_NAME,
  });
  equal(textContent(result).includes(ZERO_DIGEST), false);
  equal(textContent(result).includes("stack"), false);
});

test("Demand Route MCP只公开稳定route cause且不回显请求root", async (t) => {
  const client = await connect(t, {
    inspectDemandRoute: async () => {
      throw new DemandControllerRoutePublicCoordinatorError(
        "route",
        "wakeflow-demand-operation-authority-context",
        "demand-authority",
      );
    },
  });
  const privateRoot = "/workspace/private-demand-route";
  const result = await client.callTool({
    name: WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
    arguments: {
      root: privateRoot,
      demandId: TASKING_DEMAND_ID,
    },
  });
  equal(result.isError, true);
  deepEqual(JSON.parse(textContent(result)), {
    error: {
      causeCode: "wakeflow-demand-operation-authority-context",
      causeReason: "demand-authority",
      code: "wakeflow-demand-controller-route-public-coordinator",
      reason: "route",
    },
    kind: "WakeflowMcpError",
    schemaVersion: 1,
    status: "error",
    tool: WAKEFLOW_DEMAND_CONTROLLER_ROUTE_PUBLIC_TOOL_NAME,
  });
  equal(textContent(result).includes(privateRoot), false);
});

test("MCP 显式保留 Binding commit unknown 而不伪装回滚", async (t) => {
  const client = await connect(t, {
    registerWindowHostBinding: async () => {
      throw new WakeflowWindowHostBindingPublicCoordinatorError(
        "registration",
        "wakeflow-window-host-binding-store",
        "write",
        "unknown",
      );
    },
  });
  const result = await client.callTool({
    name: WAKEFLOW_WINDOW_HOST_BINDING_PUBLIC_TOOL_NAME,
    arguments: {
      root: "/workspace",
      observation: {
        kind: "WakeflowAgentHostWindowCreationObservation",
        schemaVersion: 1,
        source: "agent-host-create-result",
        hostId: "codex",
        windowId: WINDOW_ID,
        launchIntentDigest: ZERO_DIGEST,
        handle: { kind: "codex-thread", value: "private-value" },
        observedAt: "2026-08-28T10:00:00.000Z",
      },
    },
  });
  equal(result.isError, true);
  const envelope = JSON.parse(textContent(result)) as {
    readonly error: {
      readonly bindingAuthority: string;
      readonly causeReason: string;
    };
  };
  equal(envelope.error.bindingAuthority, "unknown");
  equal(envelope.error.causeReason, "write");
  equal(textContent(result).includes("private-value"), false);
});

test("MCP 显式保留 Planning event authority current", async (t) => {
  const client = await connect(t, {
    planTargetTask: async () => {
      throw new TargetTaskPlanningPublicCoordinatorError(
        "apply",
        "wakeflow-task-package-projection-store",
        "conflict",
        "current",
      );
    },
  });
  const result = await client.callTool({
    name: WAKEFLOW_TARGET_TASK_PLANNING_PUBLIC_TOOL_NAME,
    arguments: planningPreviewRequest(),
  });
  equal(result.isError, true);
  const envelope = JSON.parse(textContent(result)) as {
    readonly error: {
      readonly eventAuthority: string;
      readonly causeReason: string;
    };
  };
  equal(envelope.error.eventAuthority, "current");
  equal(envelope.error.causeReason, "conflict");
});

test("MCP保留Preparation event authority且不回显请求root", async (t) => {
  const client = await connect(t, {
    prepareImplementationDelivery: async () => {
      throw new TargetDeliveryPreparationPublicCoordinatorError(
        "apply",
        "wakeflow-demand-file-event-store",
        "write",
        "unknown",
      );
    },
  });
  const privateRoot = "/workspace/private-preparation";
  const result = await client.callTool({
    name: WAKEFLOW_TARGET_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME,
    arguments: {
      ...deliveryPreparationPreviewRequest(),
      root: privateRoot,
    },
  });
  equal(result.isError, true);
  deepEqual(JSON.parse(textContent(result)), {
    error: {
      causeCode: "wakeflow-demand-file-event-store",
      causeReason: "write",
      code: "wakeflow-target-delivery-preparation-public-coordinator",
      eventAuthority: "unknown",
      reason: "apply",
    },
    kind: "WakeflowMcpError",
    schemaVersion: 1,
    status: "error",
    tool: WAKEFLOW_TARGET_DELIVERY_PREPARATION_PUBLIC_TOOL_NAME,
  });
  equal(textContent(result).includes(privateRoot), false);
  equal(textContent(result).includes("stack"), false);
});
