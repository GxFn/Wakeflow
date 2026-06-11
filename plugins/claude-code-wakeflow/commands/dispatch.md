---
description: Prepare and send one Wakeflow delivery to a target window session (controller only)
argument-hint: [target-task-id]
---

Run one controller dispatch step. Use the wakeflow-controller skill as the operating manual; this command only sequences the loop.

1. Confirm this session is the controller window and read the active state root. If `$ARGUMENTS` names a target task id, use it; otherwise pick the next eligible task from `wakeflow_next_work` and confirm it advances the active demand.
2. Call `wakeflow_prepare_delivery` with `direction: "target"` for the selected task. Never invent envelope content; the state root is the authority.
3. Send the prepared envelope prompt to the target's tmux-resident window with the host helper: write the prompt to a temp file, then run `node <plugin>/scripts/lib/wakeflow-claude-host.mjs send --root <workspace> --window <targetWindow> --prompt-file <file> [--delivery-id <id>]`. The helper enforces the shared per-window delivery lock (`.workspace-local/wakeflow-delivery/locks/<window>.json`, one in-flight delivery per window across hosts), pastes via a tmux buffer, and returns pane readback evidence (`readback.paneTail`). A mid-turn target simply queues the message for its next turn.
4. Read back the helper evidence (`readback.paneTail`), then call `wakeflow_record_delivery` with the observed evidence (default host method `wakeflow-claude-host send`).
5. The target's tmux tab now shows a yellow > glyph (busy) until its result lands; `wakeflow-claude-host window-status` reports the same per-window states. End the dispatch turn after the delivery run is recorded as `status=sent` with `readback.ok=true`. As optional stall insurance, first start `wakeflow-claude-host.mjs wait-results --group <id> --target <window> ... [--timeout-sec N]` as a background task; it wakes the controller when all expected target results exist (releasing those windows' locks), and a timeout flags a stalled delivery to review. Do not poll, sleep, or pre-review results in the same turn.

Stop instead of dispatching when the demand is complete, blocked, review-ready, or lacks evidence, or when no registered session exists for the target window.
