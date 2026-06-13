---
description: Prepare and send one Wakeflow delivery to a target window session (controller only)
argument-hint: [target-task-id]
---

Run one controller dispatch step. Use the wakeflow-controller skill as the operating manual; this command only sequences the loop.

1. Confirm this session is the controller window and read the active state root. If `$ARGUMENTS` names a target task id, use it; otherwise pick the next eligible task from `wakeflow_next_work` and confirm it advances the active demand.
2. Call `wakeflow_prepare_delivery` with `direction: "target"` for the selected task. Never invent envelope content; the state root is the authority.
3. Send it in ONE step with the host helper: `node <plugin>/scripts/lib/wakeflow-claude-host.mjs deliver --root <workspace> --delivery-file <deliveryFile from the prepare payload>`. The helper reads the envelope from disk (prompt, target window, delivery id), writes its own temp prompt file, enforces the shared per-window delivery lock, pastes via a tmux buffer, and returns compact pane readback evidence (`readback.paneTail`). A mid-turn target simply queues the message for its next turn. (The lower-level `send --window --prompt-file` form remains for custom prompts.)
4. Call `wakeflow_record_delivery` with the observed readback evidence (default host method `wakeflow-claude-host send`). Prepare/record payloads are compact by default — ids, file paths, and the prompt; pass `verbose: true` only when the full envelope echo is genuinely needed (the artifacts are always on disk).
5. The in-flight delivery is tracked by the shared lock and by `wakeflow-claude-host window-status`; a quiet in-flight target may have no visible tmux badge. End the dispatch turn after the delivery run is recorded as `status=sent` with `readback.ok=true` — nothing else to arm. The wake-up is the target's controller-return delivery; the always-on activity monitor only lights the green running badge while a pane is active and flips the tab to green `+` when the result lands. Silence is never auto-judged: whether a quiet window is stalled is the controller's call, made when it chooses to look (window-status / the dispatch group / pane readback). Do not poll, sleep, arm per-dispatch watchers, or pre-review results in the same turn. (`wait-results` remains available solely as an explicit synchronous wait for scripted flows.)

Stop instead of dispatching when the demand is complete, blocked, review-ready, or lacks evidence, or when no registered session exists for the target window.

Lock notes: the shared per-window delivery lock is acquired automatically when
the envelope is written and released when the matching target result is
recorded; a fresh lock from the OTHER host fails the dispatch closed, while a
same-host lock that belongs to this very delivery is normal and not a warning.
A stale or ownerless lock is released with the dry-run-first recovery command
`release-window-lock --window <name> --write` (MCP: `wakeflow_release_window_lock`);
releasing another host's fresh lock must be a deliberate controller decision.
