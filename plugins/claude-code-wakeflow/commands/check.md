---
description: Read-only verification of an existing strict Wakeflow v3 workspace
---

1. Call `wakeflow_verify operation=inspect`. This is the strict workspace
   verdict.
2. When detail is useful, call `wakeflow_view operation=verification`,
   `operation=config`, or `operation=storage`. Live status is a separate
   `wakeflow_status operation=inspect` projection; `wakeflow_view` has no
   `status` operation. These reads never repair state.
3. Report authority blockers separately from diagnostic details. A corrupt or
   legacy item cannot contribute readiness or a next action.
4. Stop after reporting. Do not run initialization, reconfigure, reconcile,
   migration, replacement, deletion, delivery, or host effects.

The public-v2 Claude `check-workspace` collector and legacy registry/window-host
files are migration/diagnostic source only, not an independent v3 health
verdict.

$ARGUMENTS
