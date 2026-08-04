---
description: List, launch, resume, or attach Wakeflow tmux windows, choosing the permission mode
argument-hint: "[window-name | all] [--replace]"
---

Manage the workspace's tmux-resident Wakeflow windows. Use the host helper (`node <plugin>/scripts/lib/wakeflow-claude-host.mjs <command> --root <workspace>`); never invent session ids — the thread registry and window-host bindings are the only authorities.

1. Read `wakeflow.config.json` (configured windows, roles, and `hosts.claude-code.permissionMode`), `.wakeflow-local/wakeflow-delivery/hosts/claude-code/thread-registry/` (registered session ids), and `.wakeflow-local/wakeflow-delivery/hosts/claude-code/window-host/` (tmux bindings). Probe liveness with the helper `readback --window <name>` per bound window.
2. With no `$ARGUMENTS`: render a table — window, role, displayTitle, registered (yes/no), tmux window alive (yes/no) — plus the current `permissionMode`, and print the attach command: `tmux attach -t <server>` without `tmuxSocket`, or `tmux -L <tmuxSocket> attach -t <server>` when configured. Stop after reporting; do not launch anything.
3. Before launching or resuming ANY window (i.e. when `$ARGUMENTS` is `all` or a window name), settle the permission mode first:
   - Ask the user (AskUserQuestion) which mode the work windows should run in, presenting `acceptEdits` as the recommended default (prompts before risky actions) and `bypassPermissions` as the fully-unattended option (no prompts; the safety boundary becomes the repo worktree + CLAUDE.md gates + the Wakeflow state machine). If config already records a mode, show that as the pre-selected option instead. The fleet can be switched to bypass anytime via `/wakeflow:unattended on`.
   - Skip the question only when the user already named the mode in this turn, or when simply re-confirming the recorded mode with no change.
   - Persist the choice before launching: `set-unattended --root <workspace> --mode <choice> --write`. The recorded value is the consent the helper relies on to auto-confirm the boot dialog; `acceptEdits` is always available for a user who wants per-action prompts.
4. Resolve the launch set: `all` (or no window name after the mode question when the user asked to open everything) means every configured window in canonical order (Design, controller, products, Test); otherwise the single named window. If `$ARGUMENTS` contains `--replace`, require exactly one named configured window, call `wakeflow_replace_windows` for that window (the single `window` arg routes to the same replace-window plan), run the returned `hostLaunch` with `launch-window --replace`, register the final session id, and finally helper `retitle` to `displayTitle`. This is the high-frequency path for a context-heavy or stale single window; it does not reinitialize workspace docs or touch other windows.
5. To rebuild the WHOLE fleet (or a named subset) with brand-new empty-context sessions in one robust call, use the helper `replace-all` (optionally `--window <name>` to limit it): per window it kills the old tmux window, launches a fresh session, pastes that window's entry-sync orientation prompt (who it is + read parent/repo `CLAUDE.md` + it is a Wakeflow TARGET window that waits for dispatch and never self-starts), registers the new id, and arranges — config/docs untouched. So a fleet rebuilt this way comes up oriented and registered, not as clueless generic `claude` sessions. Prefer this over a hand-written per-window loop. (Registration is written by the helper, not the window; if `wakeflow_status` reports `registeredThreadCount: 0` right after launch, it is the known false-0 — confirm by reading `hosts/<host>/thread-registry/` + a `readback`, not by re-launching.)
6. For normal non-replacement targets, converge each to "alive and registered":
   - Binding exists and window alive: nothing to create; report the socket-aware attach command from step 2.
   - Registered baseline window but tmux window dead (or after a reboot): restore the SAME session with `launch-window --root <workspace> --resume --session-id <registered id> --window <name> --title <displayTitle> --cwd <recorded actual cwd> --replace [--server <configured server>]`. Do not generate a new id. The window inherits the recorded `permissionMode` and `claudeArgs`.
   - Configured but never registered: full first launch — write the window's initialization prompt to a temp file, run `launch-window --window <name> --title <displayTitle> --cwd <repo> --prompt-file <file>`, call `wakeflow_register_window` with the returned final session id, then helper `retitle` to `displayTitle`.
   - Named window not in `wakeflow.config.json`: check the shape first. A
     `Controller__<pod>` / `Design__<pod>` / `Test__<pod>` /
     `<repo>__<pod>` window is valid only when an explicitly authorized Pod
     launch operation and host-scoped binding identify it; route it through
     `pod-open` / `pod-list` / `pod-close`, never through a derived overlay or
     the legacy-recovery-only `stream-open`. Use `wakeflow_pod_open mode=create`
     only to materialize canonical launch operations that are still pending and
     unbound. Use `mode=resume` only for already-bound operations: verify or
     resume the exact registered session at its recorded cwd, treating current
     product/main HEAD and dirty state as observations. Resume never creates or
     discovers a replacement, rebinds, or falls back to mainline. Anything else: stop and report; adding a window is
     a workspace-scope decision for `/wakeflow:init` reset initialization or
     the user, not this command.
   - Treat helper `inFlight` only as a fresh target-lease alias, not generic
     mid-turn proof. Before replacement, also inspect live activity; skip a
     `running` or uncertain Controller/manual window rather than interrupting it.
7. After any launch, resume, or replacement, run the helper `arrange-windows` so tabs stay short and ordered (Design, controller, products, Test; unmanaged windows trail).
8. Tell the user how to enter the workspace, in one clear instruction: open a
   NEW terminal window or tab, cd into this workspace, and run `tmux attach -t
   <server>` when no socket is configured, or `tmux -L <tmuxSocket> attach -t
   <server>` using the real `hosts.claude-code` values. Do not offer
   programmatic tab-opening.
9. Report what changed (created / resumed / replaced / already alive / skipped-in-flight), the resolved `permissionMode`, and the attach command. This command never sends task deliveries; use `/wakeflow:dispatch` for work.
10. Explain the live indicators when reporting: the tmux status bar marks each window only when there is a live visual signal — green `>>` block = executing a turn right now (set by the background activity monitor that `ensure-server` starts automatically), green `+` text = result ready, no mark = idle or quiet in-flight. `window-status` is the source for lock-backed `busy` / `done` state. There is deliberately NO automatic stall marking: whether a quiet window is stuck is the controller's judgment (inspect `window-status` / the dispatch group when suspicious), never a mechanical signal. Inside every pane the seeded statusline shows the live serving model and the window identity (resolved from the registered session id, so it never drifts when the agent cd's around) — plain text, no icons.
