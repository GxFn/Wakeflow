/**
 * Claude Code host send adapters for Wakeflow direct-thread delivery.
 *
 * Terminal-only model: every Wakeflow window is a tmux-resident interactive
 * `claude` session, and a Wakeflow "thread id" is that session's Claude Code
 * session id. The primary transport pastes the envelope prompt into the
 * registered tmux window through the host helper
 * (scripts/lib/wakeflow-claude-host.mjs send), which also maintains the shared
 * per-window delivery lock and returns pane readback evidence.
 *
 * Headless resume is NOT a window mode: it is the recovery transport when a
 * tmux window died. The session id is stable across resumes, so recovering
 * with `claude -p --resume <sessionId>` and relaunching the tmux window with
 * the same id keeps the registry valid.
 */

const FORBIDDEN_CONCLUSIONS = [
  "host-send-adapter-is-controller-acceptance",
  "host-send-adapter-reads-product-files",
  "host-send-adapter-creates-target-result",
];

export const claudeTmuxResidentAdapter = {
  kind: "WakeflowHostSendAdapter",
  version: 1,
  adapterId: "claude-tmux-resident",
  hostTool: "wakeflow-claude-host send --window <target> --prompt-file <envelope prompt file>",
  sideEffect: "host-session-message",
  inputAuthority: "delivery-envelope",
  readbackRequired: true,
  storesThreadIds: false,
  forbiddenConclusions: FORBIDDEN_CONCLUSIONS,
};

export const claudeHeadlessRecoveryAdapter = {
  kind: "WakeflowHostSendAdapter",
  version: 1,
  adapterId: "claude-headless-recovery",
  hostTool: "claude -p --resume <sessionId> \"<envelope prompt>\" --output-format json (recovery only, when the tmux window is dead)",
  sideEffect: "host-session-message",
  inputAuthority: "delivery-envelope",
  readbackRequired: true,
  storesThreadIds: false,
  forbiddenConclusions: FORBIDDEN_CONCLUSIONS,
};

export function adapterForWindowMode(windowMode) {
  if (windowMode === "headless-recovery") return claudeHeadlessRecoveryAdapter;
  return claudeTmuxResidentAdapter;
}

export function buildHostSendResumeStep(delivery, adapter = claudeTmuxResidentAdapter) {
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
    instruction: "Write the delivery envelope prompt to a temp file and send it into the registered tmux-resident window with the wakeflow-claude-host send command; do not edit product files from this resume step. If the tmux window is dead, recover the same session headless (claude -p --resume <registered session id>) and relaunch the window before or after the send.",
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
    after: "Only after the helper send succeeds and pane readback evidence exists, record delivery evidence with the observed evidence text (include the helper's paneTail snippet or the recovery JSON result).",
  };
}

export function buildHostSendResumeSteps(deliveries, adapter = claudeTmuxResidentAdapter) {
  return deliveries.flatMap((delivery) => [
    buildHostSendResumeStep(delivery, adapter),
    buildRecordDeliveryRunResumeStep(delivery),
  ]);
}
