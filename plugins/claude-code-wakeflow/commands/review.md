---
description: Review Wakeflow target results with raw evidence and record an explicit controller decision
argument-hint: [dispatch-group-or-task-id]
---

Run one controller review step. Use the wakeflow-controller skill acceptance rules; target backfill is input, never a conclusion.

1. Confirm this session is the controller window. Resolve the dispatch group or task id from `$ARGUMENTS`, or from the newest result-ready group in `wakeflow_status`.
2. Call `wakeflow_review_pack` for the group/task and read the listed raw evidence (files, commits, commands, logs, reports) before judging anything. Each entry also carries the intent triple — Design's `designIntent`, the authored dispatch `objective`, and the result — plus an `intentCheck` reminder; it is advisory context for YOUR drift judgment (no scores, no gates), and a real drift routes to redesign, not a point fix.
3. When multiple target results need consolidation, call `wakeflow_reduce_results`; treat the reduction as a review candidate only.
4. Decide explicitly and record it: `wakeflow_decide_review` with accept / rework / blocked / redesign (redesign parks the task and routes a non-bug outcome mismatch back to Design), or `wakeflow_complete_demand` when the completion definition is met with evidence.
5. After recording the decision, clear transient window glyphs with `wakeflow-claude-host window-status --reconcile --root <workspace>` (green + means result-ready; reconcile returns settled windows to plain tabs).
6. Report the decision, the evidence that supports it, and the next eligible step (next package, intake, archive, or stop for user judgment).

Never accept work whose evidence only proves a script ran; the evidence must prove the intended behavior. When evidence is missing or ambiguous, choose rework or blocked and say why; when the work is valid but the outcome misses the requirement, choose redesign.
