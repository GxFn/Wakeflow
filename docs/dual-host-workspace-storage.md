# Dual-Host Workspace Storage

Status: accepted design (2026-06-11). Supersedes the desktop sections of
`claude-code-window-automation-design.md`: Wakeflow on Claude Code is
terminal-only (tmux-resident windows, including the controller). One workspace
may have BOTH the Codex plugin and the Claude Code plugin installed at the same
time; this document defines how local storage keeps that safe.

## Principle

Split by *what the data is*, not by who wrote it:

- **Business state is host-neutral and shared.** A demand, its state root, task
  packages, target results, and ledger records describe the work itself. Both
  plugins run the same shared-core state machine on the same schemas, so they
  read and write the same files. Business records never contain host window
  handles (the existing redaction rule already guarantees this).
- **Transport runtime is host-scoped.** Window handles (Codex thread ids,
  Claude Code session ids), derived window configs, tmux bindings, and
  keep-live state describe *how one host reaches its windows*. Each host owns a
  private subtree and never reads another host's.

## Layout

```text
<workspace>/
  AGENTS.md                      # Codex controller gates  (owned by the Codex plugin)
  CLAUDE.md                      # Claude Code controller gates (owned by the Claude plugin)
  workspace.config.json          # SHARED workspace truth; per-host blocks under "hosts"
  .workspace-active/             # SHARED business state: demands, state roots, task
                                 # packages, progress docs, TODO projections, intake,
                                 # test cards. No host handles, no host branching.
  wakeflow-ledger/               # SHARED durable records and archives.
  <Repo>/AGENTS.md + CLAUDE.md   # child access cards; each host owns its file.
  .workspace-local/
    workspace.config.json        # optional local override (shared mechanism)
    wakeflow-delivery/
      dispatch-packets/          # SHARED dispatch packets
      dispatch-groups/           # SHARED dispatch group snapshots
      delivery-envelopes/        # SHARED dispatch envelopes (each records its transport)
      delivery-runs/             # SHARED send/readback evidence
      target-results/            # SHARED TargetResultEnvelopes (+ superseded/)
      locks/                     # SHARED per-window in-flight markers (advisory)
      hosts/
        codex/
          thread-registry/       # Codex thread ids        (one <window>.json each)
          window-config/         # derived sendability view (regenerable)
          keep-live/             # keep-live runtime state
        claude-code/
          thread-registry/       # Claude Code session uuids (same record schema,
                                 # kind=ClaudeWindowSessionRegistration)
          window-config/
          window-host/           # tmux bindings: server session, window_id, title
          keep-live/
```

## Ownership And Coexistence Rules

| Surface | Owner | Rule |
| --- | --- | --- |
| `.workspace-active/`, `wakeflow-ledger/`, `dispatch-packets/`, `dispatch-groups/`, `delivery-envelopes/`, `delivery-runs/`, `target-results/` | shared | Single truth for the work. Records carry per-record transport evidence (e.g. `hostAction.method`), never host-global branching. |
| `workspace.config.json` | shared | Windows, repositories, roles, language are host-neutral. Host-specific knobs live under `"hosts": { "codex": {...}, "claude-code": { "tmuxSession": "wakeflow" } }`. A host reads only its own block. |
| `hosts/<host>/thread-registry/` | per host | The same window name may be registered on both hosts (a Codex thread AND a Claude tmux session for `RepoA`). Registration records keep their host `kind`. |
| `hosts/<host>/window-config/` | per host | Derived view; regenerated from workspace config + that host's registry. Never migrated, never shared. |
| `hosts/claude-code/window-host/` | claude | tmux `window_id` bindings so renames (displayTitle) never break targeting. |
| `locks/` | shared | One in-flight delivery per WINDOW across hosts. A lock names `{windowName, host, deliveryId, createdAt, expiresAt}`. Enforced in shared core: acquired at envelope write (prepare/build), refreshed on record-delivery-run (sent), fail-closed at dispatch on a fresh other-host lock, released by the matching record-target-result; recovery via `release-window-lock`. The Claude helper additionally guards tmux sends. |
| Root and child memory files | per host | `AGENTS.md` and `CLAUDE.md` coexist; each plugin's `sync-root-agents` / `write-agents` touches only its own file. Gate content stays in lockstep because both templates live in this repository. |
| `.gitignore` sync | shared | Both plugins ensure the same two entries (`.workspace-active/`, `.workspace-local/`); idempotent in either order. |

## Concurrency Rules

1. **One controller per demand, across hosts.** Demand CREATION is
   host-neutral and decoupled: either platform may `init` a demand
   (`controllerHost: null`). The platform binding happens at CLAIM time — the
   first driving command (add-task-package and every later mutating state
   command) stamps the current host into `controllerHost`. From then on it is
   machine-enforced: mutating state commands (add-task-package,
   import-target-result, reduce-results, decide-review, complete-demand),
   `prepare-dispatch-from-state`, and the delivery-sent state advance all fail
   closed on the non-owning host. Transfer is explicit only: `--adopt-host`
   (MCP: `adoptHost`) re-stamps ownership and is recorded in the command
   payload. Pre-feature demands (no `controllerHost` field) follow the same
   first-claim rule. Visibility: the status payload's `dualHost` block lists
   every host registration, all fresh `locks/`, and `demandOwnership` (each
   active demand's `controllerHost`, `null` = unclaimed), so a controller sees
   the other host's presence, in-flight deliveries, and demand ownership before
   acting.
2. **One in-flight delivery per window, across hosts** (the `locks/` rule).
   Two hosts dispatching different tasks into the same repository working tree
   concurrently is the real hazard dual-install creates. ENFORCEMENT (generic,
   shared core — identical on both hosts): the lock `locks/<window>.json`
   `{windowName, host, deliveryId, createdAt, expiresAt}` is ACQUIRED when the
   delivery envelope is written (`prepare-dispatch-from-state` /
   `build-delivery`), so it covers the whole build -> host send -> record
   window even where the host send itself has no wakeflow hook (codex thread
   tools). `record-delivery-run` (sent) refreshes it; the dispatch path fails
   closed on a fresh OTHER-host lock and warns on a same-host lock that is not
   this delivery's own; `record-target-result` releases it when the result
   answers the locked delivery. Recovery: `release-window-lock` (MCP:
   `wakeflow_release_window_lock`), dry-run by default. The Claude transport
   helper additionally re-checks at tmux send time and via `wait-results`,
   treating its own delivery id as a non-event.
3. **Handles never leak across hosts.** A Codex envelope must never instruct a
   Claude send and vice versa; envelopes record their transport and the
   registry file they used (`hosts/<host>/thread-registry/...` paths make this
   self-evident in evidence). This invariant IS enforced: all shared business
   records carry `threadIdRedacted: true` and a registry-file path, never a raw
   handle.

## Codex Legacy Migration

Existing Codex workspaces store the registry at
`.workspace-local/wakeflow-delivery/thread-registry/` (pre-dual-host layout).

- Reads fall back: resolve `hosts/codex/thread-registry/<window>.json` first,
  then the legacy `thread-registry/<window>.json`.
- Writes always target the new host-scoped path.
- `wakeflow_verify` reports remaining legacy registry files with a one-line
  move instruction; no silent migration of user runtime.
- `window-config/` and `keep-live/` need no fallback (derived/ephemeral —
  regenerated on the next registration or run).

## What This Means For Each Plugin

- Shared core: the delivery store derives `registry`, `windowConfig`, and
  `keepLive` directories from `hostProfile.runtime.hostDirName`; `locks/` and
  the legacy read-fallback live in the same store. Nothing else in core knows
  about hosts.
- Codex plugin: `hostProfile.runtime = { hostDirName: "codex", legacyRegistryFallback: true }`.
  Behavior otherwise unchanged; existing workspaces keep working through the
  read fallback.
- Claude Code plugin: `hostProfile.runtime = { hostDirName: "claude-code", legacyRegistryFallback: false }`.
  The tmux transport helper additionally maintains `window-host/` bindings and
  honors `locks/`.
