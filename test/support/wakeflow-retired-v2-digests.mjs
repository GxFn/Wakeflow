import { createHash } from "node:crypto";

// Test-only codec for rehydrating normalized historical fixture bytes. It is
// intentionally outside product source and exposes no writer or runtime API.
function withoutGeneratedAt(value) {
  if (Array.isArray(value)) return value.map(withoutGeneratedAt);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "generatedAt")
      .map(([key, nested]) => [key, withoutGeneratedAt(nested)]),
  );
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
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

function digest(value) {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

export function retiredV2DispatchPacketDigest(packet) {
  return digest(dispatchPacketComparable(packet));
}

export function retiredV2DispatchPreparationDigest({ packet, envelope }) {
  return digest({
    packet: dispatchPacketComparable(packet),
    envelope: deliveryEnvelopeComparable(envelope),
  });
}
