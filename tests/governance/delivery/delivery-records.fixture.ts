import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  computeDeliveryPromptDigest,
  createDeliveryEnvelope,
  deliveryTaskPackageRef,
  type DeliveryEnvelope,
  type TargetDeliveryProductDefectRemediationContext,
  type TargetDeliveryReworkContext,
} from "../../../src/governance/delivery/delivery-envelope.js";
import {
  createDeliveryOutcome,
  type DeliveryAttemptStatus,
  type DeliveryDisposition,
  type DeliveryEvidenceKind,
  type DeliveryOutcome,
  type DeliveryReadbackStatus,
} from "../../../src/governance/delivery/delivery-outcome.js";
import {
  createDeliveryRearm,
  type DeliveryRearm,
} from "../../../src/governance/delivery/delivery-rearm.js";
import { computeTaskPackageDigest } from "../../../src/governance/tasking/task-package.js";
import { createWorkClaim, type WorkClaim } from "../../../src/kernel/work-claims.js";
import { parseWakeflowWindowHostBindingId } from "../../../src/workspace/window-runtime/wakeflow-window-host-binding-id.js";
import {
  createTaskPackageFixture,
  TARGET_TASK_ID,
  TASKING_DEMAND_ID,
  TASKING_WINDOW_ID,
} from "../tasking/task-package.fixture.js";

/**
 * 投递切片的纯记录夹具：信封、工作声明、结局与 rearm。与旧 intent/claim/observation
 * 夹具同位，供聚合、决策器、升级器、结果与评审测试复用。
 */

export const DELIVERY_ID = parseWakeflowDurableIdOfKind(
  "target-delivery_88888888-8888-4888-8888-888888888888",
  "target-delivery",
);
export const DELIVERY_CLAIM_ID = parseWakeflowDurableIdOfKind(
  "work-claim_11111111-1111-4111-8111-111111111111",
  "work-claim",
);
export const OTHER_DELIVERY_CLAIM_ID = parseWakeflowDurableIdOfKind(
  "work-claim_22222222-2222-4222-8222-222222222222",
  "work-claim",
);
export const THIRD_DELIVERY_CLAIM_ID = parseWakeflowDurableIdOfKind(
  "work-claim_33333333-3333-4333-8333-333333333333",
  "work-claim",
);
const FOURTH_DELIVERY_CLAIM_ID = parseWakeflowDurableIdOfKind(
  "work-claim_44444444-4444-4444-8444-444444444444",
  "work-claim",
);
export const DELIVERY_BINDING_ID = parseWakeflowWindowHostBindingId(
  "window_binding_99999999-9999-4999-8999-999999999999",
);
export const DELIVERY_BINDING_DIGEST = parseSha256Digest(`sha256:${"9".repeat(64)}`);
export const DELIVERY_CLAIMED_AT = parseUtcInstant("2026-08-29T09:57:00.000Z");
export const DELIVERY_PREPARED_AT = parseUtcInstant("2026-08-29T09:59:00.000Z");
export const DELIVERY_OUTCOME_OBSERVED_AT = parseUtcInstant("2026-08-29T10:01:00.000Z");
export const DELIVERY_REARMED_AT = parseUtcInstant("2026-08-29T10:02:00.000Z");
export const DELIVERY_EXPECTED_STREAM_REVISION = 2;
export const DELIVERY_PORTABLE_PROMPT =
  "# Wakeflow delivery\n\nGoal: implement the confirmed slice.\n\nReturn: wakeflow_import_target_result.";
export const DELIVERY_PROMPT_DIGEST = computeDeliveryPromptDigest(DELIVERY_PORTABLE_PROMPT);

export interface WorkClaimFixtureOptions {
  readonly claimId?: WorkClaim["claimId"];
  readonly generation?: number;
  readonly deliveryId?: WorkClaim["holder"]["deliveryId"];
  readonly targetTaskId?: WorkClaim["holder"]["targetTaskId"];
  readonly claimedAt?: WorkClaim["claimedAt"];
}

export function createWorkClaimFixture(
  options: WorkClaimFixtureOptions = {},
): Readonly<WorkClaim> {
  return createWorkClaim({
    claimId: options.claimId ?? DELIVERY_CLAIM_ID,
    hostId: "codex",
    windowId: TASKING_WINDOW_ID,
    bindingId: DELIVERY_BINDING_ID,
    holder: {
      demandId: TASKING_DEMAND_ID,
      targetTaskId: options.targetTaskId ?? TARGET_TASK_ID,
      deliveryId: options.deliveryId ?? DELIVERY_ID,
      generation: options.generation ?? 1,
    },
    claimedAt: options.claimedAt ?? DELIVERY_CLAIMED_AT,
  });
}

export interface DeliveryEnvelopeFixtureOptions {
  readonly claim?: Readonly<WorkClaim>;
  readonly expectedStreamRevision?: number;
  readonly deliveryId?: DeliveryEnvelope["deliveryId"];
  readonly rework?: Readonly<TargetDeliveryReworkContext>;
  readonly productDefectRemediation?: Readonly<TargetDeliveryProductDefectRemediationContext>;
  readonly portablePrompt?: string;
  readonly preparedAt?: DeliveryEnvelope["preparedAt"];
}

export function createDeliveryEnvelopeFixture(
  options: DeliveryEnvelopeFixtureOptions = {},
): Readonly<DeliveryEnvelope> {
  const claim = options.claim ?? createWorkClaimFixture();
  const taskPackage = createTaskPackageFixture();
  const portablePrompt = options.portablePrompt ?? DELIVERY_PORTABLE_PROMPT;
  return createDeliveryEnvelope({
    deliveryId: options.deliveryId ?? claim.holder.deliveryId,
    programId: taskPackage.programId,
    configDigest: taskPackage.configDigest,
    demandId: taskPackage.demandId,
    target: {
      targetTaskId: taskPackage.targetTaskId,
      taskPackageId: taskPackage.taskPackageId,
      taskPackageRef: deliveryTaskPackageRef(taskPackage.demandId, taskPackage.taskPackageId),
      taskPackageDigest: computeTaskPackageDigest(taskPackage),
    },
    route: {
      hostId: "codex",
      windowId: taskPackage.assignment.windowId,
      bindingId: DELIVERY_BINDING_ID,
      bindingDigest: DELIVERY_BINDING_DIGEST,
    },
    language: "zh-Hans",
    workType: "implementation",
    portablePrompt,
    promptDigest: computeDeliveryPromptDigest(portablePrompt),
    fence: {
      claimId: claim.claimId,
      claimDigest: claim.claimDigest,
      expectedStreamRevision: options.expectedStreamRevision ?? DELIVERY_EXPECTED_STREAM_REVISION,
    },
    preparedAt: options.preparedAt ?? DELIVERY_PREPARED_AT,
    ...(options.rework === undefined ? {} : { rework: options.rework }),
    ...(options.productDefectRemediation === undefined
      ? {}
      : { productDefectRemediation: options.productDefectRemediation }),
  });
}

export interface DeliveryOutcomeFixtureOptions {
  readonly envelope?: Readonly<DeliveryEnvelope>;
  readonly claim?: Readonly<WorkClaim>;
  readonly generation?: number;
  readonly disposition?: DeliveryDisposition;
  readonly attemptStatus?: DeliveryAttemptStatus;
  readonly readbackStatus?: DeliveryReadbackStatus;
  readonly evidenceKind?: DeliveryEvidenceKind;
  readonly hookRecordId?: string | null;
  readonly observedAt?: DeliveryOutcome["observedAt"];
}

/** 缺省是 hook 记录证明的 accepted 结局；rejected 与 indeterminate 由选项切换。 */
export function createDeliveryOutcomeFixture(
  options: DeliveryOutcomeFixtureOptions = {},
): Readonly<DeliveryOutcome> {
  const claim = options.claim ?? createWorkClaimFixture();
  const envelope = options.envelope ?? createDeliveryEnvelopeFixture({ claim });
  const disposition = options.disposition ?? "accepted";
  const evidenceKind =
    options.evidenceKind ??
    (disposition === "accepted" ? "hook-record" : "agent-declaration");
  const attemptStatus =
    options.attemptStatus ??
    (disposition === "rejected-before-send" ? "failed-before-send" : "sent");
  const readbackStatus = options.readbackStatus ?? "pending";
  const hookRecordId =
    options.hookRecordId === undefined
      ? evidenceKind === "hook-record"
        ? "hook-record-fixture-1"
        : null
      : options.hookRecordId;
  return createDeliveryOutcome({
    deliveryId: envelope.deliveryId,
    generation: options.generation ?? claim.holder.generation,
    fence: { claimId: claim.claimId, claimDigest: claim.claimDigest },
    disposition,
    attempt: {
      status: attemptStatus,
      evidenceDigest: attemptStatus === "sent" ? parseSha256Digest(`sha256:${"a".repeat(64)}`) : null,
    },
    readback: {
      status: readbackStatus,
      evidenceDigest:
        readbackStatus === "unavailable" ? null : parseSha256Digest(`sha256:${"d".repeat(64)}`),
    },
    evidence: {
      kind: evidenceKind,
      hookRecordId,
      rationale: evidenceKind === "controller-resolution" ? "Controller 已核对目标会话记录。" : null,
    },
    observedAt: options.observedAt ?? DELIVERY_OUTCOME_OBSERVED_AT,
  });
}

export interface DeliveryRearmFixtureOptions {
  readonly newClaim?: Readonly<WorkClaim>;
  readonly expectedStreamRevision?: number;
  readonly rearmedAt?: DeliveryRearm["rearmedAt"];
}

/** 从 rejected 结局 rearm 到下一代际：新声明缺省是同持有者的第二把声明。 */
export function createDeliveryRearmFixture(
  envelope: Readonly<DeliveryEnvelope>,
  rejectedOutcome: Readonly<DeliveryOutcome>,
  options: DeliveryRearmFixtureOptions = {},
): Readonly<DeliveryRearm> {
  const generation = rejectedOutcome.generation + 1;
  const newClaim =
    options.newClaim ??
    createWorkClaimFixture({
      claimId:
        generation === 2
          ? OTHER_DELIVERY_CLAIM_ID
          : generation === 3
            ? THIRD_DELIVERY_CLAIM_ID
            : FOURTH_DELIVERY_CLAIM_ID,
      generation,
      deliveryId: envelope.deliveryId,
    });
  return createDeliveryRearm({
    deliveryId: envelope.deliveryId,
    previousGeneration: rejectedOutcome.generation,
    generation,
    previousFence: {
      claimId: rejectedOutcome.fence.claimId,
      claimDigest: rejectedOutcome.fence.claimDigest,
    },
    rejectedOutcomeDigest: rejectedOutcome.outcomeDigest,
    fence: {
      claimId: newClaim.claimId,
      claimDigest: newClaim.claimDigest,
      expectedStreamRevision:
        options.expectedStreamRevision ?? envelope.fence.expectedStreamRevision + 2,
    },
    rearmedAt: options.rearmedAt ?? DELIVERY_REARMED_AT,
  });
}
