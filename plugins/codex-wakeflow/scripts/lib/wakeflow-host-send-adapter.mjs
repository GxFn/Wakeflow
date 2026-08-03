export const codexThreadReadbackPolicy = Object.freeze({
  maxReadAttempts: 1,
  observationDelayMs: 1_200,
  maxWaitMs: 5_000,
  observation: "one-read-after-send",
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
    instruction: "Read the canonical delivery envelope and use its stamped targetThread.threadRegistryFile under .wakeflow-local/wakeflow-delivery/ to resolve the registered thread; never guess a registry path. Send the exact prompt once through send_message_to_thread and inspect the returned value, not merely the fact that the tool call returned. An error or error-looking response such as Invalid URL is rejected-before-send, never accepted. After explicit host acceptance, wait 1200 ms (hard cap 5 seconds) and call read_thread exactly once for the exact new turn. Visible matching content is confirmed; missing content is pending; an unavailable read is unavailable. Do not retry read_thread and never resend the prompt.",
  };
}

export function buildRecordDeliveryRunResumeStep(delivery) {
  return {
    kind: "record-delivery-run",
    tool: "wakeflow_record_delivery",
    arguments: {
      deliveryFile: delivery.file,
    },
    after: "Classify the actual host result before recording. Explicit host acceptance uses status=sent and transportStatus=accepted; a definite pre-send error uses status=failed and transportStatus=rejected-before-send; an indeterminate outcome uses status=failed and transportStatus=ambiguous. Always supply the one observation's readbackStatus, readbackAttempts (1 after a read, 0 only when no read was possible), and evidence/error. accepted+pending/unavailable is sent-unconfirmed: preserve the lease, do not claim controllerAlreadyReached, do not read again, and never resend automatically.",
  };
}

export function buildHostSendResumeSteps(deliveries, adapter = codexAppThreadHostAdapter) {
  return deliveries.flatMap((delivery) => [
    buildHostSendResumeStep(delivery, adapter),
    buildRecordDeliveryRunResumeStep(delivery),
  ]);
}
