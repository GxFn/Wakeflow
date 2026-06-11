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
 * Dead-window recovery: relaunch the SAME session interactively with
 * launch-window --resume (the session id is stable, the registry stays valid,
 * and interactive sessions stay on the subscription pool). Headless
 * `claude -p --resume` is a last resort only: from 2026-06-15 `claude -p`
 * bills the separate Agent SDK credit at API rates.
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
  hostTool: "wakeflow-claude-host send --window <target> --prompt-file <envelope prompt file> --delivery-id <delivery id>",
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
  hostTool: "last resort when no interactive relaunch is possible: claude -p --resume <sessionId> \"<envelope prompt>\" --output-format json (bills the separate Agent SDK credit from 2026-06-15; prefer launch-window --resume + send)",
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
    instruction: `Write the delivery envelope prompt to a temp file and send it into the registered tmux-resident window with wakeflow-claude-host send --window ${delivery.targetWindow} --prompt-file <temp file> --delivery-id ${delivery.deliveryId}; do not edit product files from this resume step. If the tmux window is dead, relaunch the SAME session interactively (launch-window --resume --session-id <registered id> --replace) and resend with the same --delivery-id; avoid headless claude -p, which bills the separate Agent SDK credit from 2026-06-15.`,
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
