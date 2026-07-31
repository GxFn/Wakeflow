---
description: Initialize the current workspace as a Wakeflow control workspace (dry-run first, apply after confirmation)
---

Initialize this workspace with Wakeflow.

1. Call the `wakeflow_initialize_workspace` MCP tool with `apply: false` (plus `root`/`parent` only when the user named them). Do not pass `repositories` or `useDiscovered` on this first call.
2. Read the returned discovery facts and `agentSelectionProtocol`. Judge whether the workspace is clean (every discovered directory is clearly an intended work window) or messy.
3. For a clean workspace, propose explicit `repositories` window mappings from the discovery facts. For a messy workspace, ask the user which directories are managed windows. Never bulk-import discovered directories without confirmation.
4. Show the user the plan (windows, Design/Test mode, language, tmux server session name from `"hosts": { "claude-code": { "tmuxSession": ... } }`) and wait for confirmation before writing.
5. If the workspace is already initialized, stop unless the user explicitly says to reset initialization. Do not use init to refresh stale or context-heavy windows; use `/wakeflow:windows <window> --replace` or the `wakeflow_replace_windows` MCP tool.
6. After confirmation for a fresh workspace, call `wakeflow_initialize_workspace` again with the confirmed `repositories` and `apply: true`. After explicit reset confirmation for an already initialized workspace, call the same tool with `apply: true`, `resetInitialization: true`, explicit `repositories`, and the selected Design/Test mode; never pass `useDiscovered` during reset.
7. Seed both settings layers BEFORE launching any window: `node <plugin>/scripts/lib/wakeflow-claude-host.mjs seed-permissions --root <workspace> --write` — portable allow rules (wakeflow MCP + node/tmux/git Bash) and a RELATIVE parent-directory reference go into each repo's committed .claude/settings.json; the machine-local statusline goes into .claude/settings.local.json (never committed).
8. Ask the user which permission mode the work windows should use (AskUserQuestion), presenting `acceptEdits` as the recommended default (prompts before risky actions) and `bypassPermissions` as the fully-unattended option (no prompts; the safety boundary becomes the repo worktree + CLAUDE.md gates + the state machine). Only record `bypassPermissions` on an explicit yes. The whole fleet can be switched to bypass at any time AFTER init with `/wakeflow:unattended on` (then `/wakeflow:windows all`), so the safe default loses nothing. Persist the choice: `wakeflow-claude-host set-unattended --root <workspace> --mode <choice> --write`. Also confirm the per-role reasoning effort (default `hosts.claude-code.effortByRole`: controller `max`, workers `xhigh`); the controller does the deep judgment, workers run lighter. Then ask which MODEL the windows should run (AskUserQuestion): "Inherit my settings default" (no pin; recommended when unsure) or a specific model id the user names (recorded as `hosts.claude-code.modelByRole`, e.g. `{"default": "<model-id>"}` — optionally a different id for `controller`). Pinned windows always launch on that model instead of the settings default; every pane's statusline shows the live serving model so the user can verify at a glance. Record any change in `wakeflow.config.json` before launching.
9. Follow the returned `windowLaunchPlan` (entries are `windowMode: "tmux-resident"` with ready-made `hostLaunch` argv specs). First run the host helper `preflight` (`node <plugin>/scripts/lib/wakeflow-claude-host.mjs preflight --root <workspace>`); if tmux is missing, ask the user once for install consent, then run `brew install tmux` (retry once on a transient bottle error). Then per entry: write `createThreadPrompt` to a temp file and run the entry's `hostLaunch` launch-window argv (`launch-window --window <Name> --title <displayTitle> --cwd <repo> --prompt-file <file>`); the helper creates the tmux window running `claude --session-id <generated uuid>`, pastes the entry-sync prompt, stores the window-host binding, and returns the session id. Call `wakeflow_register_window` once with that `hostLaunch.sessionId` and the entry's `localRegistration.callTemplate`.
10. Arrange the window bar: `node <plugin>/scripts/lib/wakeflow-claude-host.mjs arrange-windows --root <workspace>` (short tabs and the canonical order: Design, controller, products, Test; unmanaged windows trail).
11. Tell the user how to enter the workspace, in one clear instruction: open a
    NEW terminal window or tab, cd into this workspace, and run `tmux attach -t
    <server>` when `hosts.claude-code.tmuxSocket` is unset, otherwise `tmux -L
    <tmuxSocket> attach -t <server>`. Substitute the real configured values; do
    not offer programmatic tab-opening. Report what was created and the
    registered windows. Stop; do not dispatch any work from initialization.

Note on unattended permissions: windows launch under `wakeflow.config.json` `hosts.claude-code.permissionMode` (default `acceptEdits` — prompts before risky actions; switch the whole fleet to fully prompt-free `bypassPermissions` with `/wakeflow:unattended on`, which the helper then auto-confirms at boot) and `hosts.claude-code.claudeArgs` (extra claude flags, e.g. `["--effort", "max"]`). Both apply to first launch and to `--resume` cold-start restarts.

If the Wakeflow MCP server is unavailable, stop and report that the plugin surface must be reloaded or reinstalled; do not run runtime scripts directly.

$ARGUMENTS
