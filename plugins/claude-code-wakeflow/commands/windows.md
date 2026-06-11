---
description: List, launch, resume, or attach Wakeflow tmux windows from any session
argument-hint: [window-name]
---

Manage the workspace's tmux-resident Wakeflow windows. Use the host helper (`node <plugin>/scripts/lib/wakeflow-claude-host.mjs <command> --root <workspace>`); never invent session ids — the thread registry and window-host bindings are the only authorities.

1. Read `workspace.config.json` (configured windows and roles), `.workspace-local/wakeflow-delivery/hosts/claude-code/thread-registry/` (registered session ids), and `.workspace-local/wakeflow-delivery/hosts/claude-code/window-host/` (tmux bindings). Probe liveness with the helper `readback --window <name>` per bound window.
2. With no `$ARGUMENTS`: render a table — window, role, displayTitle, registered (yes/no), tmux window alive (yes/no) — and print the attach command (`tmux attach -t <server>`). Stop after reporting.
3. With a window name in `$ARGUMENTS`, converge that window to "alive and registered":
   - Binding exists and window alive: nothing to create; print the helper `attach-window` command (offer `--open-terminal` to pop a macOS Terminal window on it).
   - Registered but tmux window dead (or after a reboot): restore the SAME session with `launch-window --resume --session-id <registered id> --window <name> --title <displayTitle> --cwd <repo> --replace`. Do not generate a new id.
   - Configured but never registered: full first launch — write the window's entry-sync prompt to a temp file, run `launch-window --window <name> --title <displayTitle> --cwd <repo> --prompt-file <file>`, then register the returned session id with the local registration command from the launch plan (`--thread <name>=<sessionId> --write`).
   - Named window not in `workspace.config.json`: stop and report; adding a window is a workspace-scope decision for `/wakeflow:init` (replaceWindows) or the user, not this command.
4. After any launch or resume, run the helper `arrange-windows` so tabs stay short (Design=D, controller, products, Test=T) and ordered.
5. Report what changed (created / resumed / already alive) with the window id and title. This command never sends task deliveries; use `/wakeflow:dispatch` for work.
