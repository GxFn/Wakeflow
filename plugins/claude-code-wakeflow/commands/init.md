---
description: Initialize the current workspace as a Wakeflow control workspace (dry-run first, apply after confirmation)
---

Initialize this workspace with Wakeflow.

1. Call the `wakeflow_initialize_workspace` MCP tool with `apply: false` (plus `root`/`parent` only when the user named them). Do not pass `repositories` or `useDiscovered` on this first call.
2. Read the returned discovery facts and `agentSelectionProtocol`. Judge whether the workspace is clean (every discovered directory is clearly an intended work window) or messy.
3. For a clean workspace, propose explicit `repositories` window mappings from the discovery facts. For a messy workspace, ask the user which directories are managed windows. Never bulk-import discovered directories without confirmation.
4. Show the user the plan (windows, Design/Test mode, language, deliveryMode preference: `desktop-session` or `headless-resume`) and wait for confirmation before writing.
5. After confirmation, call `wakeflow_initialize_workspace` again with the confirmed `repositories` and `apply: true`.
6. Follow the returned `windowLaunchPlan`: create each window session per the chosen delivery mode (desktop: open a Claude Code window at the entry cwd and send `createThreadPrompt` as the first message; headless: run `claude -p "<createThreadPrompt>" --output-format json` in the entry cwd), then register each real session id once via the plan's `localRegistration.argvTemplate`.
7. Report what was created and the registered windows. Stop; do not dispatch any work from initialization.

If the Wakeflow MCP server is unavailable, stop and report that the plugin surface must be reloaded or reinstalled; do not run runtime scripts directly.

$ARGUMENTS
