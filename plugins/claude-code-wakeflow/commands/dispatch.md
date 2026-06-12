---
description: Prepare and send one Wakeflow delivery to a target window session (controller only)
argument-hint: [target-task-id]
---

Run one controller dispatch step. Use the wakeflow-controller skill as the operating manual; this command only sequences the loop.

1. Confirm this session is the controller window and read the active state root. If `$ARGUMENTS` names a target task id, use it; otherwise pick the next eligible task from `wakeflow_next_work` and confirm it advances the active demand.
2. Call `wakeflow_prepare_delivery` with `direction: "target"` for the selected task. Never invent envelope content; the state root is the authority.
3. Send the prepared envelope prompt to the target's tmux-resident window with the host helper: write the prompt to a temp file, then run `node <plugin>/scripts/lib/wakeflow-claude-host.mjs send --root <workspace> --window <targetWindow> --prompt-file <file> [--delivery-id <id>]`. The helper enforces the shared per-window delivery lock (`.workspace-local/wakeflow-delivery/locks/<window>.json`, one in-flight delivery per window across hosts), pastes via a tmux buffer, and returns pane readback evidence (`readback.paneTail`). A mid-turn target simply queues the message for its next turn.
4. Read back the helper evidence (`readback.paneTail`), then call `wakeflow_record_delivery` with the observed evidence (default host method `wakeflow-claude-host send`).
5. The target's tmux tab now shows a yellow > badge (busy) until its result lands; `wakeflow-claude-host window-status` reports the same per-window states. End the dispatch turn after the delivery run is recorded as `status=sent` with `readback.ok=true` — nothing else to arm. The wake-up is the target's controller-return delivery; the always-on activity-monitor sentinel flips the tab to done when the result lands, marks it stalled after ~3 minutes of silence, and nudges the controller once for a stall. Do not poll, sleep, arm per-dispatch watchers, or pre-review results in the same turn. (`wait-results` remains available solely as an explicit synchronous wait for scripted flows.)

Stop instead of dispatching when the demand is complete, blocked, review-ready, or lacks evidence, or when no registered session exists for the target window.

Lock notes: the shared per-window delivery lock is acquired automatically when
the envelope is written and released when the matching target result is
recorded; a fresh lock from the OTHER host fails the dispatch closed, while a
same-host lock that belongs to this very delivery is normal and not a warning.
A stalled or ownerless lock is released with the dry-run-first recovery command
`release-window-lock --window <name> --write` (MCP: `wakeflow_release_window_lock`);
releasing another host's fresh lock must be a deliberate controller decision.
