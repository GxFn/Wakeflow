export const codexAppThreadHostAdapter = {
  kind: "WakeflowHostSendAdapter",
  version: 1,
  adapterId: "codex-app-thread",
  hostTool: "send_message_to_thread",
  sideEffect: "host-thread-message",
  inputAuthority: "delivery-envelope",
  readbackRequired: true,
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
    instruction: "Read the delivery envelope prompt and send it through the Codex host thread tool; do not edit product files from this resume step.",
  };
}

export function buildRecordDeliveryRunResumeStep(delivery) {
  return {
    kind: "record-delivery-run",
    tool: "wakeflow_record_delivery",
    arguments: {
      deliveryFile: delivery.file,
      status: "sent",
      readbackOk: true,
    },
    after: "Only after host send succeeds and readback evidence exists, record delivery evidence with the observed evidence text.",
  };
}

export function buildHostSendResumeSteps(deliveries, adapter = codexAppThreadHostAdapter) {
  return deliveries.flatMap((delivery) => [
    buildHostSendResumeStep(delivery, adapter),
    buildRecordDeliveryRunResumeStep(delivery),
  ]);
}
