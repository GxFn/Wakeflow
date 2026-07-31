export const codexThreadReadbackPolicy = Object.freeze({
  maxReadAttempts: 3,
  maxWaitMs: 5_000,
  retryWhen: [
    "latest-turn-in-progress-without-visible-items",
    "sent-prompt-not-yet-visible",
  ],
  resendOnRetry: false,
});

export const codexAppThreadHostAdapter = {
  kind: "WakeflowHostSendAdapter",
  version: 1,
  adapterId: "codex-app-thread",
  hostTool: "send_message_to_thread",
  sideEffect: "host-thread-message",
  inputAuthority: "delivery-envelope",
  readbackRequired: true,
  readbackPolicy: codexThreadReadbackPolicy,
  storesThreadIds: false,
  forbiddenConclusions: [
    "host-send-adapter-is-controller-acceptance",
    "host-send-adapter-reads-product-files",
    "host-send-adapter-creates-target-result",
  ],
};

export function buildHostSendResumeStep(delivery, adapter = codexAppThreadHostAdapter) {
  return {
    kind: "host-send",
    adapter,
    hostTool: adapter.hostTool,
    deliveryFile: delivery.file,
    deliveryId: delivery.deliveryId,
    deliveryKind: delivery.kind,
    targetWindow: delivery.targetWindow,
    taskId: delivery.taskId,
    dispatchGroup: delivery.dispatchGroup,
    sourceTrace: delivery.wakeflowTrace,
    instruction: "Read the delivery envelope prompt and send it exactly once through send_message_to_thread; do not edit product files from this resume step. After the send succeeds, confirm it with read_thread. A newly created in-progress turn with no visible items, or a turn where the sent prompt is not visible yet, is inconclusive rather than failed: retry read_thread only, for at most 3 total reads and at most 5 seconds. Never resend the prompt during readback confirmation.",
  };
}

export function buildRecordDeliveryRunResumeStep(delivery) {
  return {
    kind: "record-delivery-run",
    tool: "wakeflow_record_delivery",
    arguments: {
      deliveryFile: delivery.file,
      status: "sent",
      transportStatus: "accepted",
    },
    after: "A successful send_message_to_thread call is accepted transport. Perform the bounded read_thread observation, then add the actual readbackStatus (confirmed|pending|unavailable), readbackAttempts, and evidence. Pending visibility is still sent: record it, preserve the lease, and let the Agent decide whether to inspect again or wait. Never resend from readback uncertainty.",
  };
}

export function buildHostSendResumeSteps(deliveries, adapter = codexAppThreadHostAdapter) {
  return deliveries.flatMap((delivery) => [
    buildHostSendResumeStep(delivery, adapter),
    buildRecordDeliveryRunResumeStep(delivery),
  ]);
}
