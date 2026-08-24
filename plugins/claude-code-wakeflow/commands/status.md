---
description: Show read-only Wakeflow v3 workspace status and next-work authority
---

1. Call `wakeflow_status operation=inspect` with the workspace root and closed
   language request.
2. When next-work orientation is requested, also call
   `wakeflow_next_work operation=inspect`. It is read-only and never implicitly
   selects or claims a TODO row.
3. Summarize strict config/authority status, active demands, current review or
   transport blockers, exact binding readiness, and eligible TODO facts.
4. Corrupt or incomplete authority yields no next action. Never infer readiness
   from a title, tmux pane, legacy registry, local result file, or count of
   active demands.
5. Stop after reporting; do not dispatch, claim, accept, repair, or mutate.

$ARGUMENTS
