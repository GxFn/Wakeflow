/**
 * Claude Code host send adapters for Wakeflow direct-thread delivery.
 *
 * A Wakeflow "thread id" on this host is a Claude Code session id. Two
 * transports deliver an envelope prompt to a registered window session:
 *
 * - desktop-session: the controller sends the envelope prompt to the target
 *   Claude Code desktop session with the session message tool.
 * - headless-resume: the controller resumes the target session as a background
 *   task with `claude -p --resume <sessionId> "<envelope prompt>"
 *   --output-format json`. The JSON result is the readback evidence; its
 *   session_id must be re-registered when it differs, because resumed Claude
 *   Code sessions can fork to a new session id.
 *
 * The auto adapter is the default: it tells the sender to prefer the open
 * desktop session and fall back to headless resume. workspace.config.json may
 * pin one transport with "deliveryMode": "desktop-session" | "headless-resume".
 */

const FORBIDDEN_CONCLUSIONS = [
  "host-send-adapter-is-controller-acceptance",
  "host-send-adapter-reads-product-files",
  "host-send-adapter-creates-target-result",
];

export const claudeDesktopSessionAdapter = {
  kind: "WakeflowHostSendAdapter",
  version: 1,
  adapterId: "claude-desktop-session",
  hostTool: "claude-desktop session message tool (send to the registered target session)",
  sideEffect: "host-session-message",
  inputAuthority: "delivery-envelope",
  readbackRequired: true,
  storesThreadIds: false,
  forbiddenConclusions: FORBIDDEN_CONCLUSIONS,
};

export const claudeHeadlessResumeAdapter = {
  kind: "WakeflowHostSendAdapter",
  version: 1,
  adapterId: "claude-headless-resume",
  hostTool: "claude -p --resume <sessionId> \"<envelope prompt>\" --output-format json (background task)",
  sideEffect: "host-session-message",
  inputAuthority: "delivery-envelope",
  readbackRequired: true,
  storesThreadIds: false,
  forbiddenConclusions: FORBIDDEN_CONCLUSIONS,
};

export const claudeSessionAutoAdapter = {
  kind: "WakeflowHostSendAdapter",
  version: 1,
  adapterId: "claude-session-auto",
  hostTool: "prefer the open Claude Code desktop session message tool; otherwise resume headless with claude -p --resume <sessionId>",
  sideEffect: "host-session-message",
  inputAuthority: "delivery-envelope",
  readbackRequired: true,
  storesThreadIds: false,
  forbiddenConclusions: FORBIDDEN_CONCLUSIONS,
};

export function adapterForDeliveryMode(deliveryMode) {
  if (deliveryMode === "desktop-session") return claudeDesktopSessionAdapter;
  if (deliveryMode === "headless-resume") return claudeHeadlessResumeAdapter;
  return claudeSessionAutoAdapter;
}

export function buildHostSendResumeStep(delivery, adapter = claudeSessionAutoAdapter) {
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
    instruction: "Read the delivery envelope prompt and send it to the registered target Claude Code session (desktop message tool, or headless claude -p --resume as a background task); do not edit product files from this resume step.",
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
    after: "Only after host send succeeds and readback evidence exists, record delivery evidence with the observed evidence text. For headless-resume sends, include the result session_id in the evidence and re-register it when it changed.",
  };
}

export function buildHostSendResumeSteps(deliveries, adapter = claudeSessionAutoAdapter) {
  return deliveries.flatMap((delivery) => [
    buildHostSendResumeStep(delivery, adapter),
    buildRecordDeliveryRunResumeStep(delivery),
  ]);
}
