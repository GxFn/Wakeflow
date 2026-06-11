---
description: Health-check an existing Wakeflow workspace and converge missing or outdated Claude Code surfaces
argument-hint: [--fix]
---

Diagnose an ALREADY-INITIALIZED workspace (one that has `workspace.config.json`) and bring its Claude Code surfaces up to the installed plugin version. For first-time setup use `/wakeflow:init` instead.

1. Run the read-only diagnosis: `node <plugin>/scripts/lib/wakeflow-claude-host.mjs check-workspace --root <workspace>`. Render the gap report as a table (area, window, status, fix) plus the plugin-version stamp comparison. The legacy-codex-registry entry is informational only — never "fix" another host's runtime.
2. If there are no gaps, report healthy with the stamped version and stop.
3. If gaps exist and `$ARGUMENTS` does not contain `--fix`, stop after reporting with the proposed fix plan. Do not write anything.
4. With `--fix`, converge in this order, narrating each step:
   a. When `root-memory-file` is `unmanaged`: STOP and ask the user first — the fix replaces the existing root `CLAUDE.md` content with the managed Wakeflow gates (show its first lines). Only continue with explicit consent.
   b. Doc surfaces (root gates, window cards, Design/Test templates, gitignore): call `wakeflow_initialize_workspace` with `apply: true` and NO `repositories` argument changes — the existing `workspace.config.json` mapping is reused as-is; this is an idempotent upsert, not a re-initialization.
   c. Permission seeds: `wakeflow-claude-host seed-permissions --root <workspace> --write`.
   d. Missing `hosts.claude-code` config block: merge `{ "hosts": { "claude-code": { "tmuxSession": "wakeflow" } } }` into `workspace.config.json` (preserve all other keys).
   e. Unregistered or dead windows: converge each via the `/wakeflow:windows <window>` rules (resume registered ids; full-launch unregistered ones), then `arrange-windows`.
   f. Stamp the converged version: `wakeflow-claude-host stamp-runtime --root <workspace> --write`.
5. Re-run `check-workspace` and report the before/after gap counts. Anything still failing is a finding to surface, not to hide.

This command never deletes state, never touches Codex-owned surfaces (`AGENTS.md`, `hosts/codex/`), and never sends task deliveries.
