# Claude Code Window Automation Design

Status: implemented with one scope change (2026-06-11). The shipped model is
TERMINAL-ONLY: tmux-resident windows for every Wakeflow window including the
controller; desktop modes were dropped entirely and headless resume is a
recovery path, not a mode. The storage layout moved to the dual-host design in
`dual-host-workspace-storage.md`. The research facts below remain the
verification record.

Codex gives Wakeflow a fully automated window lifecycle: `create_thread` creates
a child window, `set_thread_title` names it, and `send_message_to_thread`
delivers envelopes — all controller-driven, no human clicks. This document
records what Claude Code actually supports today (each fact verified by direct
testing, not assumed), and the design that reaches Codex-grade automation on
Claude Code.

## Verified Facts

| # | Fact | Evidence |
| --- | --- | --- |
| F1 | `claude -p --session-id <uuid>` pre-assigns a session id; the JSON result echoes the same id. | Spike: assigned `68f17449-...`, result `session_id` identical. |
| F2 | `claude -p --resume <id>` REUSES the same session id by default; `--fork-session` is the opt-in fork. | Spike: resumed `68f17449-...`, result `session_id` identical; `--help` documents `--fork-session` as "create a new session ID instead of reusing". |
| F3 | Session transcripts are one `<sessionId>.jsonl` per session under `~/.claude/projects/<dashed-cwd>/`, shared by CLI and desktop, and resume appends to the same file (context continuity verified). | Spike transcript contained both turns. |
| F4 | The desktop session-message tool (`send_message`) ALWAYS prompts the user for confirmation and is unavailable in unsupervised mode. | Tool contract: "not to orchestrate background work". |
| F5 | Desktop sessions carry `local_*` ids in `list_sessions`; those ids do not map programmatically to on-disk session uuids, and CLI-created sessions do not appear in the desktop session list. | `local_b0db946b...` has no matching jsonl; spike session absent from `list_sessions`. |
| F6 | There is no supported API to create a desktop window/session programmatically. The `claude://` URL scheme exists on Claude.app but has no documented session-create capability. | Tool inventory + Info.plist. |
| F7 | tmux is not preinstalled but IS auto-installable: `brew install tmux` succeeded unattended on the reference machine (tmux 3.6b). One real-world wrinkle: the first install attempt failed on a transient Homebrew bottle error and the immediate retry succeeded, so the preflight must retry once before falling back. The send/readback plumbing (`new-session` / `send-keys -l` / `capture-pane`) is verified working. | Live install + plumbing test, 2026-06-11. |
| F8 | Typing into a busy interactive Claude Code session queues the message for the next turn (the input box accepts queued messages). | Claude Code interactive behavior. |
| F9 | Session persistence layout (CLI 2.1.x): the flat `~/.claude/projects/<dashed-cwd>/<sessionId>.jsonl` is written LAZILY and may stay tiny (a few KB) while the session is fully alive and resumable; the durable per-session data lives in the sibling DIRECTORY `<sessionId>/` (`subagents/`, `tool-results/` — one file per large tool result, MCP calls included, which doubles as an audit log). A small registered-id jsonl therefore does NOT mean registry drift or lost context: resume restores the full conversation. Any transcript-based audit must scan the session directory as well, not just the jsonl. Verified by live self-test: a resumed window answered turns while neither jsonl in its project dir changed size; `tool-results/` carried the MCP evidence. | Live fleet audit, 2026-06-12. |
| F10 | `wakeflow_review_pack` is dual-role by design: controller review preparation AND a target window's read-only self-check of its OWN dispatch group before a controller-return (the wakeflow-target skill instructs exactly this). An audit that classifies review_pack as controller-only will raise false positives on perfectly compliant target windows. | Usage audit + skill text, 2026-06-12. |

Consequences: desktop windows can be *watched* but neither created nor driven
programmatically (F4, F5, F6). Full automation must be built on CLI sessions
(F1, F2, F3). A visible resident window experience is still achievable by
hosting CLI sessions inside tmux and attaching real terminal windows to them.

## Window Modes (final)

| Mode | Window form | Create | Send | Watch / intervene | Automation grade |
| --- | --- | --- | --- | --- | --- |
| `tmux-resident` (flagship) | Live interactive `claude` session in a tmux window, one per Wakeflow window | `tmux new-window -c <cwd> "claude --session-id <uuid>"` | `tmux` paste-buffer + Enter into the target pane | `tmux attach`, or a real terminal window opened on the pane (Terminal/iTerm2; iTerm2 `tmux -CC` renders native windows) | Full, bidirectional |
| `headless-resume` (baseline) | Durable on-disk session, no live process between dispatches | `claude -p --session-id <uuid> "<entry-sync prompt>" --output-format json` | `claude -p --resume <uuid> "<envelope>" --output-format json` as a background task | `claude --resume <uuid>` interactively when no dispatch is in flight; transcript jsonl any time | Full, dispatch-scoped |
| `desktop-supervised` (review surface) | Claude Code desktop window | spawn_task chips: the controller emits one chip per window (cwd = repo, first prompt = window-identity wakeup); the user clicks each chip (verified in practice) | `send_message` with per-message user confirmation (F4) | native | Semi: one click per window create, one click per send |

Both automated modes share one registry record: the pre-assigned session uuid
is the Wakeflow `threadId`. Because of F2 the id is STABLE — no re-registration
after dispatches. `tmux-resident` additionally records the tmux target.

A window can move between the two automated modes freely: kill the tmux pane
and the same uuid keeps working via headless resume; start a tmux pane with
`claude --resume <uuid>` and the headless window becomes resident. One id, two
transports. The only rule is exclusivity: never headless-resume a session while
a live pane holds it (the per-window dispatch lock enforces this).

## Initialization Flow (Codex parity)

`wakeflow_initialize_workspace` keeps its contract. The `windowLaunchPlan`
gains per-entry executable specs so the controller agent can run the whole
launch unattended:

1. Controller generates one uuid per window entry (`uuidgen`).
2. Per entry, create the window:
   - `tmux-resident`: ensure server/session (`tmux new-session -d -s wakeflow`),
     then `tmux new-window -t wakeflow -n <Window> -c <cwd> 'claude --session-id <uuid>'`,
     then paste the entry-sync prompt (`createThreadPrompt`) into the pane.
     Optionally open a visible terminal window attached to that pane
     (`osascript` Terminal `do script "tmux attach -t wakeflow:<Window>"`,
     or iTerm2 `tmux -CC`).
   - `headless-resume`: run `claude -p --session-id <uuid>
     "<createThreadPrompt>" --output-format json` in `<cwd>` as a background
     task; the JSON result is the creation evidence.
3. Register each uuid once with the existing local registration command
   (`initialize --thread <Window>=<uuid> --write`). Stable thereafter (F2).
4. displayTitle: tmux window names carry it in `tmux-resident`; desktop title
   reset is not required (profile already sets `requiresHostTitleReset: false`).

This is the direct analog of the Codex `create_thread` → `set_thread_title` →
register loop, with the uuid chosen by the controller instead of returned by
the host.

## Delivery Flow

- `tmux-resident`: write the envelope prompt to a temp file, `tmux load-buffer`
  + `tmux paste-buffer -t wakeflow:<Window>` + `send-keys Enter`. Multiline-safe,
  quoting-safe. If the target is mid-turn the message queues (F8). Readback =
  `tmux capture-pane` tail plus the transcript jsonl gaining the delivered
  prompt; record both via `wakeflow_record_delivery`.
- `headless-resume`: `claude -p --resume <uuid> "<envelope>" --output-format
  json` as a background Bash task. Task completion wakes the controller; the
  JSON result is the readback evidence. Controller-return envelopes use the
  same transport toward the controller window's session.
- Both modes require the per-window dispatch lock (one in-flight delivery per
  window) before sending; headless mode additionally treats "background task
  exited but no TargetResultEnvelope" as a stalled delivery to review.

## Implementation Plan

1. Core (one extension point, codex byte-stable): `windowLaunchPlanPayload`
   spreads `hostProfile.launch.entryExtras?.(entry, context)` into each
   `windows[]` item. The codex profile does not define `entryExtras`, so the
   codex payload is unchanged.
2. Claude host profile: `entryExtras` emits per-entry `windowMode` defaults and
   ready-to-run command specs (`tmuxCreate`, `headlessCreate`, `attach`,
   `registerArgv`); `launch.workflowSteps` rewritten to reference them;
   `initializeApplyNextAction` updated.
3. New host-layer transport helper `scripts/lib/wakeflow-claude-host.mjs`
   (claude artifact only, outside the core runtime whitelist): subcommands
   `launch-window`, `send`, `readback`, `attach-window` wrapping tmux/claude
   invocations with safe quoting and JSON output. The agent invokes it
   explicitly and records evidence; Wakeflow still never sends on its own.
4. Registry: claude registration record gains optional `tmuxTarget` and
   `windowMode` fields (additive; normalize tolerates absence).
5. workspace.config.json: `deliveryMode` values become `tmux-resident`,
   `headless-resume`, `desktop-supervised` (old `desktop-session` reads as
   `desktop-supervised`). Send adapters updated to the same trio.
6. Per-window dispatch lock in the delivery store (blocks concurrent sends to
   one window; required for headless, advisory for tmux).
7. Skills/commands/README updates: wakeflow-controller dispatch steps,
   wakeflow-governance launch bullets, `/wakeflow:init` and `/wakeflow:dispatch`
   command text, plugin READMEs, reference docs (`direct-thread-window-config`,
   `wakeflow-delivery`, `window-dispatch`).
8. Tests: launch-plan entryExtras shape (codex absent / claude present),
   claude-host helper quoting unit tests, registry round-trip with tmuxTarget,
   adapter trio mapping, lock behavior; plus a gated-by-environment manual
   spike script for live tmux verification.

## Permissions for Unattended Targets

Headless and tmux targets cannot answer permission prompts mid-task. The
decision stays with the user, recorded per repository:

- preferred: per-repo `.claude/settings.json` allowlists;
- alternative: `--permission-mode acceptEdits` (or `dontAsk`) recorded in the
  window's launch spec;
- never chosen silently by Wakeflow.

## Known Limits

- Desktop windows remain a human-confirmed surface: chip-based creation needs
  one click per window (F6), sends need one confirmation each (F4), and there
  is no id bridge to CLI sessions (F5). Chip-spawned sessions also run in
  isolated worktrees by default; windows that must commit directly to a live
  branch are created manually in local mode. Revisit if the desktop app ships
  a session-create/send API.
- The hybrid topology keeps full automation with a desktop cockpit: the
  controller runs as a desktop window, while target windows are CLI sessions
  (tmux-resident or headless-resume). The controller's `claude -p` / tmux
  dispatches go through Bash, which IS allowlistable — no per-send
  confirmation. Only desktop-to-desktop messaging is gated.
- tmux preflight in the launch plan: tmux present -> resident mode available;
  missing + Homebrew present -> ask the user ONCE, then `brew install tmux`
  (retry once on transient brew errors; verified working); missing + no brew ->
  fall back to `headless-resume` with a manual install note. Wakeflow never
  installs system software silently; the consent and outcome are recorded in
  the workspace config.
- F2 (stable resume ids) is version-verified on 2.1.173; the launch plan keeps
  instructing agents to compare the result `session_id` against the registry as
  cheap drift insurance.
