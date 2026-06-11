---
description: Turn unattended (prompt-free) mode for the work windows on or off, then reopen them
argument-hint: [on|off]
---

Change the permission mode of this workspace's tmux work windows. Unattended (`bypassPermissions`) removes per-action permission prompts so dispatch flows run without clicks; the windows stay bounded by repository worktrees, `CLAUDE.md` gates, and the Wakeflow state machine. This is a deliberate, recorded, reversible decision — never a silent default.

1. Resolve the target mode from `$ARGUMENTS`: `on` -> `bypassPermissions`, `off` -> `acceptEdits`. If absent, read the current `hosts.claude-code.permissionMode` and ask the user which mode they want.
2. If turning unattended ON, get the user's EXPLICIT confirmation first (AskUserQuestion): state plainly that work windows will run with no permission prompts, and that the safety boundary becomes the repo worktree + CLAUDE.md gates + state machine rather than per-action approval. Do not proceed without a clear yes. If turning OFF, no extra consent is needed.
3. Record the choice: `node <plugin>/scripts/lib/wakeflow-claude-host.mjs set-unattended --root <workspace> --mode <mode> --write`. The reported `restart` list shows which live windows need a resume-restart and which are mid-turn (`inFlight`).
4. Reopen the windows so they pick up the new mode. For each live window that is NOT `inFlight`, resume-restart it (same session id, context preserved): `launch-window --resume --session-id <registered id> --window <name> --title <displayTitle> --cwd <repo> --replace`. Skip `inFlight` windows and report them — they must finish their current turn first; rerun this command for them later.
5. Run `arrange-windows`; offer to upgrade the current terminal into the workspace with `attach-window --window <controller> --open-tab` (new tab in the current terminal app). Then report: previous mode, new mode, restarted windows, and any windows skipped because they were mid-turn.

The recorded `permissionMode` is honored on every future first launch and `--resume` cold-start restart. The helper only auto-confirms the boot bypass-consent dialog when this mode is `bypassPermissions` — the recorded choice is the prior consent.
