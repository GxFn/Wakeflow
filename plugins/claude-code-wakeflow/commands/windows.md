---
description: Inspect or plan exact Wakeflow v3 Claude window binding changes
argument-hint: "[window-id] [replace|decommission]"
---

Manage typed Claude window identity without reading or writing private runtime
files directly.

1. Call `wakeflow_replace_windows operation=inspect` and
   `wakeflow_status operation=inspect`. Render stable window ID, role,
   responsibility, binding status, and redacted runtime status. Never display
   a raw session handle or locator.
2. With no mutation request, stop after reporting. A title, tmux pane, cwd, or
   legacy window-host record is not binding authority.
3. For replacement, require one exact typed `windowId` and call
   `wakeflow_replace_windows operation=replace` with the owner-specific closed
   request. Execute only the returned host-neutral intent through the v3 Claude
   activation owner, then call `wakeflow_register_window operation=register`
   with the final real session handle.
4. For decommission, first obtain the exact v3 close/absence evidence and call
   `operation=decommission` with the current binding tuple. Claude closure is
   machine-verifiable only after exact close and absence probe both succeed.
5. If the v3 activation/close owner is unavailable, report the blocked intent
   and stop. Do not fall back to the public-v2 helper, thread-registry,
   window-host, semantic window name, or a same-named worktree.

Pod first materialization uses `wakeflow_pod_open
operation=launch-preview/launch-apply`; existing materialization uses
`operation=inspect-materialization`. Do not route Pod identity through baseline
window replacement or recreate a worktree during inspection.

This command never dispatches task work.

$ARGUMENTS
