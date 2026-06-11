---
description: Initialize the current workspace as a Wakeflow control workspace (dry-run first, apply after confirmation)
---

Initialize this workspace with Wakeflow.

1. Call the `wakeflow_initialize_workspace` MCP tool with `apply: false` (plus `root`/`parent` only when the user named them). Do not pass `repositories` or `useDiscovered` on this first call.
2. Read the returned discovery facts and `agentSelectionProtocol`. Judge whether the workspace is clean (every discovered directory is clearly an intended work window) or messy.
3. For a clean workspace, propose explicit `repositories` window mappings from the discovery facts. For a messy workspace, ask the user which directories are managed windows. Never bulk-import discovered directories without confirmation.
4. Show the user the plan (windows, Design/Test mode, language, tmux server session name from `"hosts": { "claude-code": { "tmuxSession": ... } }`) and wait for confirmation before writing.
5. After confirmation, call `wakeflow_initialize_workspace` again with the confirmed `repositories` and `apply: true`.
6. Seed automation allowlists BEFORE launching any window: `node <plugin>/scripts/lib/wakeflow-claude-host.mjs seed-permissions --root <workspace> --write` (merges wakeflow MCP + node/tmux/git Bash rules plus the workspace root as an additional directory into each repo's .claude/settings.json).
7. Ask the user which permission mode the work windows should use (AskUserQuestion): `acceptEdits` (default — prompts before risky actions) or `bypassPermissions` (fully unattended, no prompts; safety boundary becomes repo worktree + CLAUDE.md gates + state machine). Only record `bypassPermissions` on an explicit yes. Persist it: `wakeflow-claude-host set-unattended --root <workspace> --mode <choice> --write`. Also confirm the per-role reasoning effort (default `hosts.claude-code.effortByRole`: controller `max`, workers `high`); the controller does the deep judgment, workers run lighter. Record any change in `workspace.config.json` before launching.
8. Follow the returned `windowLaunchPlan` (entries are `windowMode: "tmux-resident"` with ready-made `hostLaunch` argv specs). First run the host helper `preflight` (`node <plugin>/scripts/lib/wakeflow-claude-host.mjs preflight --root <workspace>`); if tmux is missing, ask the user once for install consent, then run `brew install tmux` (retry once on a transient bottle error). Then per entry: write `createThreadPrompt` to a temp file and run the entry's `hostLaunch` launch-window argv (`launch-window --window <Name> --title <displayTitle> --cwd <repo> --prompt-file <file>`); the helper creates the tmux window running `claude --session-id <generated uuid>`, pastes the entry-sync prompt, stores the window-host binding, and returns the session id. Register each session id once via the plan's `localRegistration.argvTemplate`.
9. Arrange the window bar: `node <plugin>/scripts/lib/wakeflow-claude-host.mjs arrange-windows --root <workspace>` (short tabs and the canonical order: Design, controller, products, Test; unmanaged windows trail).
10. Offer to enter the workspace with `attach-window --window <controller> --open-tab` (opens a new tab in the current terminal app running tmux attach). Report what was created and the registered windows. Stop; do not dispatch any work from initialization.

Note on unattended permissions: windows launch under `workspace.config.json` `hosts.claude-code.permissionMode` (default `acceptEdits`; set `bypassPermissions` for fully prompt-free unattended windows, which the helper auto-confirms at boot) and `hosts.claude-code.claudeArgs` (extra claude flags, e.g. `["--effort", "max"]`). Both apply to first launch and to `--resume` cold-start restarts.

If the Wakeflow MCP server is unavailable, stop and report that the plugin surface must be reloaded or reinstalled; do not run runtime scripts directly.

$ARGUMENTS
