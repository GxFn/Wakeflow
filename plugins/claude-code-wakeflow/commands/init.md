---
description: Initialize the current workspace as a Wakeflow control workspace (dry-run first, apply after confirmation)
---

Initialize this workspace with Wakeflow.

1. Call the `wakeflow_initialize_workspace` MCP tool with `apply: false` (plus `root`/`parent` only when the user named them). Do not pass `repositories` or `useDiscovered` on this first call.
2. Read the returned discovery facts and `agentSelectionProtocol`. Judge whether the workspace is clean (every discovered directory is clearly an intended work window) or messy.
3. For a clean workspace, propose explicit `repositories` window mappings from the discovery facts. For a messy workspace, ask the user which directories are managed windows. Never bulk-import discovered directories without confirmation.
4. Show the user the plan (windows, Design/Test mode, language, tmux server session name from `"hosts": { "claude-code": { "tmuxSession": ... } }`) and wait for confirmation before writing.
5. After confirmation, call `wakeflow_initialize_workspace` again with the confirmed `repositories` and `apply: true`.
6. Follow the returned `windowLaunchPlan` (entries are `windowMode: "tmux-resident"` with ready-made `hostLaunch` argv specs). First run the host helper `preflight` (`node <plugin>/scripts/lib/wakeflow-claude-host.mjs preflight --root <workspace>`); if tmux is missing, ask the user once for install consent, then run `brew install tmux` (retry once on a transient bottle error). Then per entry: write `createThreadPrompt` to a temp file and run the entry's `hostLaunch` launch-window argv (`launch-window --window <Name> --title <displayTitle> --cwd <repo> --prompt-file <file>`); the helper creates the tmux window running `claude --session-id <generated uuid>`, pastes the entry-sync prompt, stores the window-host binding, and returns the session id. Register each session id once via the plan's `localRegistration.argvTemplate`.
7. Report what was created and the registered windows. Stop; do not dispatch any work from initialization.

If the Wakeflow MCP server is unavailable, stop and report that the plugin surface must be reloaded or reinstalled; do not run runtime scripts directly.

$ARGUMENTS
