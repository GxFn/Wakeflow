---
description: Turn unattended (prompt-free) mode for the work windows on or off, then reopen them
argument-hint: [on|off]
---

Change the permission mode of this workspace's tmux work windows. Unattended (`bypassPermissions`) removes per-action permission prompts so dispatch flows run without clicks; the windows stay bounded by repository worktrees, `CLAUDE.md` gates, and the Wakeflow state machine. Wakeflow work windows ship with the safe `acceptEdits` default; this command is how a workspace opts the whole fleet into hands-off `bypassPermissions` (or back), as a deliberate, recorded, reversible decision. The recorded `bypassPermissions` is the consent the helper relies on to auto-confirm the boot dialog.

1. Resolve the target mode from `$ARGUMENTS`: `on` -> `bypassPermissions`, `off` -> `acceptEdits`. If absent, read the current `hosts.claude-code.permissionMode` and ask the user which mode they want.
2. If turning unattended ON, get the user's EXPLICIT confirmation first (AskUserQuestion): state plainly that work windows will run with no permission prompts, and that the safety boundary becomes the repo worktree + CLAUDE.md gates + state machine rather than per-action approval. Do not proceed without a clear yes. If turning OFF, no extra consent is needed.
3. Record the choice: `node <plugin>/scripts/lib/wakeflow-claude-host.mjs set-unattended --root <workspace> --mode <mode> --write`. The reported `restart` list shows live windows plus `targetLeaseActive`, `activityState`, and a backward-compatible `inFlight` alias. `inFlight` means only “fresh target work lease”; it does not prove whether a Controller, Pod Controller, manual, or review turn is running.
4. Reopen baseline windows so they pick up the new mode. For each live baseline
   window only when `targetLeaseActive=false` and live activity is not
   `running`; if activity is uncertain, skip it. Then resume-restart the same session with
   `launch-window --root <workspace> --resume --session-id <registered id>
   --window <name> --title <displayTitle> --cwd <recorded actual cwd> --replace
   [--server <configured server>]`. Do not auto-restart Pod windows. For any Pod
   window, request a read-only `wakeflow_pod_open mode=resume` plan and verify or
   resume only its exact registered session at the recorded cwd. Current
   product/main HEAD and dirty state are observations, not recovery gates. If
   identity is missing or ambiguous, skip and report it; never create, rebind,
   or fall back to mainline.
5. Run `arrange-windows`. Then report: previous mode, new mode, restarted
   baseline windows, and every window skipped for a target lease, live
   activity, uncertainty, or a Pod identity blocker. To enter the
   workspace, use `tmux attach -t <server>` when no `tmuxSocket` is configured,
   otherwise `tmux -L <tmuxSocket> attach -t <server>`.

The recorded `permissionMode` is honored on every future first launch and `--resume` cold-start restart. The helper only auto-confirms the boot bypass-consent dialog when this mode is `bypassPermissions` — the recorded choice is the prior consent.
