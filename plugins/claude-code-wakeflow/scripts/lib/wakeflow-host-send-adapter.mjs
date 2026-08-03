/**
 * Claude Code host send adapters for Wakeflow direct-thread delivery.
 *
 * Terminal-only model: every Wakeflow window is a tmux-resident interactive
 * `claude` session, and a Wakeflow "thread id" is that session's Claude Code
 * session id. The primary transport pastes the envelope prompt into the
 * registered tmux window through the host helper
 * (scripts/lib/wakeflow-claude-host.mjs deliver), which also maintains the shared
 * per-window target work lease and returns pane readback evidence. The normal
 * adapter consumes the prepared delivery envelope through `deliver`; agents do
 * not reconstruct a prompt file or target window themselves.
 *
 * Dead-window recovery: a baseline window relaunches the SAME registered
 * session with its recorded root/cwd/server fields. A Pod uses the read-only
 * wakeflow_pod_open mode=resume plan, which verifies the immutable binding and
 * reopens the exact session/cwd without re-running the creation HEAD gate.
 * Headless resume is a baseline-only last resort and is never a Pod recovery path.
 */

export const claudePaneReadbackPolicy = Object.freeze({
  maxReadAttempts: 1,
  observationDelayMs: 1_200,
  maxWaitMs: 5_000,
  observation: "one-pane-read-after-paste",
  resendOnRetry: false,
});

const FORBIDDEN_CONCLUSIONS = [
  "host-send-adapter-is-controller-acceptance",
  "host-send-adapter-reads-product-files",
  "host-send-adapter-creates-target-result",
];

export const claudeTmuxResidentAdapter = {
  kind: "WakeflowHostSendAdapter",
  version: 1,
  adapterId: "claude-tmux-resident",
  hostTool: "wakeflow-claude-host deliver --root <workspace-root> --delivery-file <delivery file>",
  sideEffect: "host-session-message",
  inputAuthority: "delivery-envelope",
  readbackRequired: true,
  readbackPolicy: claudePaneReadbackPolicy,
  storesThreadIds: false,
  forbiddenConclusions: FORBIDDEN_CONCLUSIONS,
};

export const claudeHeadlessRecoveryAdapter = {
  kind: "WakeflowHostSendAdapter",
  version: 1,
  adapterId: "claude-headless-recovery",
  hostTool: "baseline-only last resort when interactive relaunch is impossible: claude -p --resume <registered session id> \"<delivery envelope prompt>\" --output-format json; never use for a Pod window",
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
  const instruction = adapter.adapterId === "claude-headless-recovery"
    ? "Use this adapter only for a baseline window after proving interactive recovery is unavailable. Read the prepared delivery envelope, resume the same registered Claude session once with its exact prompt, preserve the raw JSON response as readback evidence, and never use this path for a Pod window."
    : `Run wakeflow-claude-host deliver --root <workspace-root> --delivery-file ${delivery.file} exactly once; the helper reads the canonical envelope, resolves ${delivery.targetWindow}, pastes its prompt once, waits 1200 ms by default (hard cap 5 seconds), and performs exactly one pane observation. Do not reconstruct a prompt file, call the low-level send path, repeat readback, or paste the prompt again.`;
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
    instruction,
  };
}

export function buildRecordDeliveryRunResumeStep(delivery) {
  return {
    kind: "record-delivery-run",
    tool: "wakeflow_record_delivery",
    arguments: {
      deliveryFile: delivery.file,
    },
    after: "Copy the helper's explicit transportStatus and single readback.status/attemptCount into wakeflow_record_delivery; do not infer success from process completion. accepted uses status=sent, rejected-before-send or ambiguous uses status=failed with the actual error. accepted+pending/unavailable is sent-unconfirmed: preserve the lease, do not claim controllerAlreadyReached, do not observe again, and never resend automatically.",
  };
}

export function buildHostSendResumeSteps(deliveries, adapter = claudeTmuxResidentAdapter) {
  return deliveries.flatMap((delivery) => [
    buildHostSendResumeStep(delivery, adapter),
    buildRecordDeliveryRunResumeStep(delivery),
  ]);
}
