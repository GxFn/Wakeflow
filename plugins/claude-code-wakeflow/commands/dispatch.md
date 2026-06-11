---
description: Prepare and send one Wakeflow delivery to a target window session (controller only)
argument-hint: [target-task-id]
---

Run one controller dispatch step. Use the wakeflow-controller skill as the operating manual; this command only sequences the loop.

1. Confirm this session is the controller window and read the active state root. If `$ARGUMENTS` names a target task id, use it; otherwise pick the next eligible task from `wakeflow_next_work` and confirm it advances the active demand.
2. Call `wakeflow_prepare_delivery` with `direction: "target"` for the selected task. Never invent envelope content; the state root is the authority.
3. Send the prepared envelope prompt to the registered target window session using the workspace delivery mode:
   - `desktop-session`: send the prompt to the target Claude Code desktop session with the session message tool.
   - `headless-resume`: run `claude -p --resume <sessionId> "<envelope prompt>" --output-format json` as a background task in the target cwd.
4. Read back the send evidence, then call `wakeflow_record_delivery` with the observed evidence. For headless sends include the result `session_id` in the evidence and re-register it if it changed.
5. End the dispatch turn after the delivery run is recorded as `status=sent` with `readback.ok=true`. Do not poll, sleep, or pre-review results in the same turn.

Stop instead of dispatching when the demand is complete, blocked, review-ready, or lacks evidence, or when no registered session exists for the target window.
