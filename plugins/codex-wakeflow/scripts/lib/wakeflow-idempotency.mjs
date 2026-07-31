import { createHash } from "node:crypto";

function stableJson(value) {
  return JSON.stringify(value ?? null);
}

const DELIVERY_TRANSPORT_STATUSES = new Set([
  "accepted",
  "rejected-before-send",
  "ambiguous",
]);

const DELIVERY_READBACK_STATUSES = new Set([
  "confirmed",
  "pending",
  "unavailable",
]);

// Delivery runs written before transport/readback were split used
// status=sent + readback.ok=true as the single completion signal. Keep those
// artifacts readable while allowing current runs to record the two independent
// facts explicitly: whether the host accepted the send, and what the bounded
// read-only observation could see afterwards.
export function deliveryTransportStatus(run = {}) {
  if (DELIVERY_TRANSPORT_STATUSES.has(run.transportStatus)) {
    return run.transportStatus;
  }
  if (run.status === "sent" && run.readback?.ok === true) {
    return "accepted";
  }
  // Older blocked/failed records did not capture the host-send phase. Never
  // infer a proven pre-send rejection from their prose error alone.
  return "ambiguous";
}

export function deliveryReadbackStatus(run = {}) {
  if (DELIVERY_READBACK_STATUSES.has(run.readback?.status)) {
    return run.readback.status;
  }
  if (run.readback?.ok === true) return "confirmed";
  if (run.readback?.checked === true) return "pending";
  return "unavailable";
}

export function deliveryTransportAccepted(run = {}) {
  return run.status === "sent" && deliveryTransportStatus(run) === "accepted";
}

export function deliveryReadbackConfirmed(run = {}) {
  return deliveryReadbackStatus(run) === "confirmed";
}

function deliveryRunComparable(run = {}) {
  return {
    deliveryId: run.deliveryId,
    targetWindow: run.targetWindow,
    taskId: run.taskId,
    dispatchGroup: run.dispatchGroup,
    triggerTarget: run.triggerTarget,
    triggerTaskId: run.triggerTaskId,
    reviewScope: run.reviewScope,
    transport: run.transport,
    transportStatus: deliveryTransportStatus(run),
    status: run.status,
    thread: run.thread,
    hostAction: run.hostAction,
    readback: {
      status: deliveryReadbackStatus(run),
      attempts: run.readback?.attempts ?? null,
      evidence: run.readback?.evidence,
    },
    keepLive: run.keepLive,
    error: run.error,
  };
}

function targetResultComparable(result = {}) {
  return {
    targetWindow: result.targetWindow,
    taskId: result.taskId,
    dispatchGroup: result.dispatchGroup,
    status: result.status,
    summary: result.summary ?? "",
    changedRepos: result.changedRepos ?? [],
    commits: result.commits ?? [],
    commitDisposition: result.commitDisposition ?? null,
    evidenceRefs: result.evidenceRefs ?? [],
    verificationSummary: result.verificationSummary ?? [],
    riskSummary: result.riskSummary ?? [],
    craftEvidence: result.craftEvidence ?? [],
    resultMapping: result.resultMapping ?? null,
    nextSuggestion: result.nextSuggestion,
  };
}

function withoutGeneratedAt(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(withoutGeneratedAt);
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "generatedAt")
      .map(([key, nested]) => [key, withoutGeneratedAt(nested)]),
  );
}

function dispatchPacketComparable(packet = {}) {
  return {
    kind: packet.kind,
    version: packet.version,
    id: packet.id,
    targetWindow: packet.targetWindow,
    taskId: packet.taskId,
    dispatchGroup: packet.dispatchGroup,
    controllerWindow: packet.controllerWindow,
    humanContextRef: packet.humanContextRef,
    stateRef: packet.stateRef,
    objective: packet.objective,
    taskBriefing: packet.taskBriefing,
    taskPackageDigest: packet.taskPackageDigest,
    acceptanceAnchors: packet.acceptanceAnchors ?? [],
    testExecution: packet.testExecution,
    scope: packet.scope ?? [],
    outOfScope: packet.outOfScope ?? [],
    forbidden: packet.forbidden ?? [],
    evidenceRequired: packet.evidenceRequired ?? [],
    resultContract: packet.resultContract,
    returnPolicy: packet.returnPolicy,
    contextPolicy: packet.contextPolicy,
    prompt: packet.prompt,
  };
}

function deliveryEnvelopeComparable(envelope = {}) {
  return {
    kind: envelope.kind,
    version: envelope.version,
    deliveryId: envelope.deliveryId,
    sourcePacketId: envelope.sourcePacketId,
    sourcePacketDigest: envelope.sourcePacketDigest,
    targetWindow: envelope.targetWindow,
    taskId: envelope.taskId,
    dispatchGroup: envelope.dispatchGroup,
    controllerWindow: envelope.controllerWindow,
    humanContextRef: envelope.humanContextRef,
    stateRef: envelope.stateRef,
    prompt: envelope.prompt,
    returnPolicy: envelope.returnPolicy,
    returnRoute: envelope.returnRoute,
    oneShot: envelope.oneShot,
    correlationId: envelope.correlationId,
    targetThread: envelope.targetThread,
    transport: envelope.transport,
    automation: envelope.automation,
    windowConfig: withoutGeneratedAt(envelope.windowConfig),
  };
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
  );
}

export function dispatchPreparationDigest({ packet, envelope }) {
  return createHash("sha256")
    .update(JSON.stringify(stableValue({
      packet: dispatchPacketComparable(packet),
      envelope: deliveryEnvelopeComparable(envelope),
    })))
    .digest("hex");
}

export function dispatchPacketDigest(packet) {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(dispatchPacketComparable(packet))))
    .digest("hex");
}

export function deliveryRunIdempotencyKey({ deliveryId, deliveryRunId }) {
  return `delivery-run:${deliveryId}:${deliveryRunId}`;
}

export function dispatchPacketIdempotencyKey({ stateRef = {}, targetWindow, taskId, dispatchGroup = "" }) {
  return [
    "dispatch-packet",
    stateRef.stateRoot,
    stateRef.taskPackageId,
    stateRef.targetTaskId || taskId,
    stateRef.stateRevision,
    dispatchGroup,
    targetWindow,
  ].filter(Boolean).join(":");
}

export function targetResultIdempotencyKey({ targetWindow, taskId, dispatchGroup = "" }) {
  return ["target-result", dispatchGroup, targetWindow, taskId].filter(Boolean).join(":");
}

export function annotateDispatchPacketIdempotency(packet) {
  const packetDigest = dispatchPacketDigest(packet);
  return {
    ...packet,
    packetDigest,
    idempotency: {
      key: dispatchPacketIdempotencyKey(packet),
      duplicateBehavior: "return-existing-if-equivalent",
      staleRevisionBehavior: "fail-if-existing-packet-state-revision-differs",
      unsafeRetry: "same-packet-id-with-different-state-revision-or-content",
    },
  };
}

export function annotateDeliveryRunIdempotency(run) {
  return {
    ...run,
    idempotency: {
      key: deliveryRunIdempotencyKey(run),
      duplicateBehavior: "return-existing-if-equivalent",
      safeRetry: "use-a-new-delivery-run-id-for-an-additional-send-attempt",
      unsafeRetry: "same-delivery-run-id-with-different-content",
    },
  };
}

export function annotateTargetResultIdempotency(result) {
  return {
    ...result,
    idempotency: {
      key: targetResultIdempotencyKey(result),
      duplicateBehavior: "return-existing-if-equivalent",
      supersedeBehavior: "requires-explicit-supersede-result",
      unsafeRetry: "same-target-result-key-with-different-content-without-supersede",
    },
  };
}

export function sameDeliveryRunContent(left, right) {
  return stableJson(deliveryRunComparable(left)) === stableJson(deliveryRunComparable(right));
}

export function sameTargetResultContent(left, right) {
  return stableJson(targetResultComparable(left)) === stableJson(targetResultComparable(right));
}

export function sameDispatchPacketContent(left, right) {
  return stableJson(dispatchPacketComparable(left)) === stableJson(dispatchPacketComparable(right));
}

export function sameDeliveryEnvelopeContent(left, right) {
  return stableJson(deliveryEnvelopeComparable(left)) === stableJson(deliveryEnvelopeComparable(right));
}

export function buildReplaySummary({ deliveryRuns = [], targetResults = [] } = {}) {
  const runValues = deliveryRuns.filter((item) => item?.kind === "DirectThreadDeliveryRun");
  const resultValues = targetResults.filter((item) => item?.kind === "TargetResultEnvelope");
  const runsByDeliveryId = new Map();
  for (const run of runValues) {
    if (!run.deliveryId) continue;
    if (!runsByDeliveryId.has(run.deliveryId)) runsByDeliveryId.set(run.deliveryId, []);
    runsByDeliveryId.get(run.deliveryId).push(run);
  }
  const repeatedDeliveryAttempts = [...runsByDeliveryId.entries()]
    .filter(([, runs]) => runs.length > 1)
    .map(([deliveryId, runs]) => ({
      deliveryId,
      attempts: runs.length,
      sentAttempts: runs.filter((run) => deliveryTransportAccepted(run)).length,
      runIds: runs.map((run) => run.deliveryRunId).filter(Boolean),
    }));
  const missingIdempotencyKeys = [
    ...runValues
      .filter((run) => !run.idempotency?.key)
      .map((run) => ({ kind: "delivery-run", id: run.deliveryRunId || run.deliveryId })),
    ...resultValues
      .filter((result) => !result.idempotency?.key)
      .map((result) => ({ kind: "target-result", id: result.resultId || `${result.targetWindow}/${result.taskId}` })),
  ];
  const supersededTargetResults = resultValues
    .filter((result) => result.supersedes)
    .map((result) => ({
      resultId: result.resultId,
      targetWindow: result.targetWindow,
      taskId: result.taskId,
      archivedResultFile: result.supersedes.archivedResultFile,
    }));
  return {
    kind: "WakeflowReplaySummary",
    version: 1,
    status: missingIdempotencyKeys.length > 0
      ? "needs-audit"
      : repeatedDeliveryAttempts.length > 0 || supersededTargetResults.length > 0
        ? "has-replay-history"
        : "clean",
    deliveryAttemptCount: runValues.length,
    repeatedDeliveryAttemptCount: repeatedDeliveryAttempts.length,
    repeatedDeliveryAttempts,
    targetResultCount: resultValues.length,
    supersededTargetResultCount: supersededTargetResults.length,
    supersededTargetResults,
    missingIdempotencyKeyCount: missingIdempotencyKeys.length,
    missingIdempotencyKeys,
    forbiddenConclusions: [
      "replay-summary-is-controller-acceptance",
      "retry-attempt-is-new-target-work",
      "superseded-result-is-accepted-result",
    ],
  };
}

// pruneWouldBreakReplay: a delivery-run is protected from GC when its deliveryId still has a
// surviving repeated-attempt chain in the replay summary, because deleting it would break
// idempotency dup-detection for that chain. prune-runtime keeps anything this returns true for.
export function pruneWouldBreakReplay(deliveryId, replaySummary) {
  if (!deliveryId) return false;
  const protectedIds = new Set((replaySummary?.repeatedDeliveryAttempts ?? []).map((attempt) => attempt.deliveryId));
  return protectedIds.has(deliveryId);
}
