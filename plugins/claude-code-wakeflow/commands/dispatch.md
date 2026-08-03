---
description: Prepare and send one Wakeflow delivery to a target window session (controller only)
argument-hint: [target-task-id]
---

Run one controller dispatch step. Use the wakeflow-controller skill as the operating manual; this command only sequences the loop.

1. Confirm this session is a controller window and read ITS demand's state root. The mainline controller drives only the mainline demand. Every explicitly authorized Pod has an independent `Controller__<pod>` and that controller drives only the demand whose state root stamps it as `controllerWindow`. Before dispatching from a Pod, require `podProvisioning.phase=execution-ready` and a verified host binding for the target window; a planned or merely `control-ready` Pod is not dispatch-ready. If `$ARGUMENTS` names a target task id, use it; otherwise pick the next eligible task from `wakeflow_next_work` and confirm it advances this controller's demand.
2. Call `wakeflow_prepare_delivery` with `direction: "target"` for the selected task. Never invent envelope content; the state root is the authority. Its applied write stores the envelope and reserves the cross-host target work lease with that delivery id, covering the prepare-to-send gap.
3. Send it in ONE step with the host helper: `node <plugin>/scripts/lib/wakeflow-claude-host.mjs deliver --root <workspace> --delivery-file <deliveryFile from the prepare payload>`. The helper reads the envelope from disk (prompt, target window, delivery id), writes its own temp prompt file, reuses/revalidates the prepared target work lease, pastes via a tmux buffer, and returns compact pane readback observations (`readback.paneTail`, `paneChanged`, `promptEchoed`). A different fresh delivery cannot queue behind an active target lease; it fails closed. The lower-level `send --window --prompt-file --delivery-id <id>` form is only for an explicitly identified custom target prompt, never a controller-return.
4. Call `wakeflow_record_delivery` with the observed transport and readback facts (host method `wakeflow-claude-host deliver`). Prepare/record payloads are compact by default — ids, file paths, and the prompt; pass `verbose: true` only when the full envelope echo is genuinely needed (the artifacts are always on disk).
5. The in-flight delivery is tracked by the shared lock and by `wakeflow-claude-host window-status`; a quiet in-flight target may have no visible tmux badge. Record `status=sent` when transport is accepted, together with the independent readback status. Bounded readback may remain `pending` or `unavailable`; that is observation for controller judgment, never authority to resend or release the lease. End the dispatch turn after recording — nothing else to arm. The wake-up is the target's controller-return delivery; the always-on activity monitor only lights the green running badge while a pane is active and flips the tab to green `+` when the result lands. Silence is never auto-judged: whether a quiet window is stalled is the controller's call, made when it chooses to look (window-status / the dispatch group / pane readback). Do not poll, sleep, arm per-dispatch watchers, or pre-review results in the same turn. (`wait-results` remains available solely as an explicit synchronous wait for scripted flows.)

Stop instead of dispatching when the demand is complete, blocked, review-ready,
lacks required task context, or has no registered session for the target window.

Lease notes: applied envelope preparation reserves the shared per-window target
work lease; `deliver`/target `send` reuses or revalidates the same delivery id.
The matching target result releases it. A fresh lease from the OTHER host fails
the dispatch closed, while a same-host lease that belongs to this very delivery
is normal and not a warning. Controller-return delivery takes no target work lease.
A proven rejection before paste is normally released automatically by exact
delivery-id compare-and-delete during helper/recording cleanup. If manual
recovery is still needed, use the dry-run-first command
`release-window-lock --window <name> --expected-delivery-id <id> --write`
(MCP: `wakeflow_release_window_lock` with `expectedDeliveryId`). Omit the id only
for deliberate stale/corrupt recovery. Accepted, ambiguous, and readback-pending
sends retain the lease; releasing another host's fresh lock must be a deliberate
controller decision.
