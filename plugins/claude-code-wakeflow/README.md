<div align="center">

# Wakeflow for Claude Code

A disciplined control loop for multi-window agent work — every step traced, every result proven.

[English](README.md) | [Simplified Chinese](README.zh-CN.md)

Wakeflow turns a local Claude Code workspace into a disciplined controller
system: one controller window, focused repository windows, explicit state
roots, compact delivery envelopes, and evidence-based acceptance. The controller runs this as a closed loop — plan, dispatch, collect evidence, review, decide, repeat — and records every step, so the whole run is auditable after the fact.

</div>

---

- [Why Wakeflow](#why-wakeflow)
- [Architecture](#architecture)
- [Install Wakeflow](#install-wakeflow)
- [Quick Start](#quick-start)
- [Security & System Impact](#security--system-impact)
- [Window Model](#window-model)
- [One Vocabulary Across Hosts](#one-vocabulary-across-hosts)
- [Initialize A Workspace](#initialize-a-workspace)
- [What Wakeflow Creates](#what-wakeflow-creates)
- [Automation Semantics](#automation-semantics)
- [MCP Capability Surface](#mcp-capability-surface)
- [Runtime And Ledger Boundaries](#runtime-and-ledger-boundaries)
- [Dual-Host Workspaces](#dual-host-workspaces)
- [Working In This Repository](#working-in-this-repository)
- [Design Principles](#design-principles)

## Why Wakeflow

Large agent-assisted work rarely lives in one repository or one conversation.
A single goal may require a controller, product repositories, a design window,
and a real-scenario test window. Without a shared operating model, the work
degrades into scattered prompts, copied status tables, unclear ownership, and
unfinished evidence review.

Wakeflow provides the missing control layer:

- **Controller-first judgment**: the parent workspace owns goals, boundaries,
  dispatch decisions, acceptance, TODO routing, and archive decisions.
- **One state root per demand**: task packages, target results, review
  candidates, decisions, and progress projections stay tied to the same demand.
- **Focused child windows**: each repository window works only inside its
  configured responsibility boundary.
- **Compact delivery**: delivery prompts wake the right window with a small
  envelope; the state root and skills hold the task details.
- **Evidence before acceptance**: target backfill is input, not a conclusion.
  The controller still reviews raw evidence before completing work.
- **Local-first runtime**: real session ids live only in the local thread
  registry; window config is a derived sendability view, and active state stays
  out of tracked source.

Wakeflow is not a command launcher with nicer names. It is a reusable workflow
capability for keeping multi-window agent work legible, bounded, and resumable.

## Architecture

Wakeflow is three layers working together: a window fleet you can see, a
closed loop that moves the work, and a disk layout that survives restarts.

### Layer 1 — the fleet (what you see)

One tmux session holds the whole operation. Every window is a long-lived
interactive Claude Code session pinned to one responsibility, and the status
bar tells you who is doing what at a glance:

```text
[wakeflow]  1:Design   >> 2:Controller   3:RepoA  +  4:RepoB   5:Test   6:zsh
            idle      green = executing  idle    result       idle    yours,
                      a turn right now           ready for            untouched
                                                 review
```

| Badge | Meaning |
| --- | --- |
| green `>>` block | the window is executing a turn right now (live activity monitor) |
| green `+` | a result arrived and is ready for controller review |
| no badge | idle, or a delivery quietly in flight (the fleet's normal state; `window-status` reports the machine states when needed) |

| Window | Role | Default reasoning effort |
| --- | --- | --- |
| Controller | owns goals, dispatch, evidence review, acceptance | `max` |
| Design | clarifies requirements, redesigns non-bug outcome mismatches, prepares handoffs | `xhigh` |
| Repo windows | implement inside exactly one repository | `xhigh` |
| Test | real-scenario verification the repos cannot self-run | `xhigh` |

Inside every pane a seeded statusline shows the live serving model and the
window identity (`Fable 5 . RepoA`) in plain text. Windows survive reboots:
the same session resumes with its full conversation.

### Layer 2 — the loop (how work moves)

Work is organized into demands: one demand = one goal = one state root on
disk. Every demand moves through the same closed loop:

```text
 1 init       controller creates the demand state root            (unclaimed)
 2 claim      the first driving command binds it to ONE platform  (codex | claude)
 3 add task   a task package names the target window and scope
 4 dispatch   envelope written -> window LOCKED -> prompt pasted into the pane
 5 work       the target window executes inside its repository boundary
 6 result     TargetResultEnvelope lands with evidence refs -> lock released
 7 review     controller reads RAW evidence, then accepts / reworks / blocks
 8 complete   only when every task is accepted and no blockers remain
```

Two rules keep the loop honest:

- **Prompts wake, state instructs.** The pasted prompt only names the window,
  task id, and state root; the task definition lives in the state root and the
  installed skills. A lost prompt loses nothing.
- **Backfill is input, not acceptance.** A target's self-report never closes
  work. The controller reviews the raw evidence (commits, command output,
  reports) before recording a decision, and a blocked decision is always
  recoverable: new evidence reopens review.

### Layer 3 — the ground (what's on disk)

```text
<workspace>/
  wakeflow.config.json          windows, roles, model/effort pins   committed
  CLAUDE.md  (+ one per repo)    controller gates / access cards     committed
  .claude/settings.json          portable allow rules, relative refs committed
  .claude/settings.local.json    machine-local statusline command    never committed
  wakeflow-ledger/               durable designs, records, archives  committed
  .wakeflow-active/             demand state roots (layer 2 lives here)   local
  .wakeflow-local/wakeflow-delivery/                                      local
    dispatch-packets/  delivery-envelopes/  delivery-runs/   transport records
    target-results/                                          evidence envelopes
    locks/                       one in-flight delivery per window, cross-host
    hosts/codex/                 codex session registry (host-scoped)
    hosts/claude-code/           claude session registry + tmux bindings
```

Rule of thumb: **business truth is host-neutral and shared; transport handles
are host-scoped and never leave `.wakeflow-local/`.** Session ids never
appear in tracked files, prompts, or backfill text.

### Who decides what (trust model)

- Scripts and MCP tools create, validate, and record machine data; they never
  accept work, widen scope, or decide product behavior.
- Target windows execute exactly their dispatched package and report evidence.
- The controller is the only acceptance authority.
- The user owns product decisions. `bypassPermissions` is never a silent
  default: it is recorded in `wakeflow.config.json` only after an explicit
  yes, and that recorded consent is what authorizes unattended boot dialogs.

### Dual-host coexistence

The same workspace can run the Codex edition and the Claude Code edition side
by side. Demands bind to one platform at claim time (machine-enforced on every
driving command), the shared per-window lock serializes deliveries across
hosts, and ownership moves only through an explicit, audited
`adopt-demand-host` transfer.

## Install Wakeflow

> Platform support: macOS-first. The tmux fleet and `brew` preflight are
> exercised daily on macOS; the tmux core should work on Linux but is not yet
> verified there. Entering the fleet is always the same printed instruction:
> open a new terminal and run `tmux attach -t <session>`.


The repository root is the development workspace, and the installable Claude
Code plugin artifact lives in `plugins/claude-code-wakeflow/`. Install it from
inside Claude Code:

```text
/plugin marketplace add GxFn/Wakeflow
/plugin install wakeflow@gxfn
```

For local development, add this checkout as a local marketplace instead:

```text
/plugin marketplace add /absolute/path/to/Wakeflow
/plugin install wakeflow@gxfn
```

The plugin ships four coordinated surfaces:

| Surface | Contents |
| --- | --- |
| MCP server | `.mcp.json` starts `node ${CLAUDE_PLUGIN_ROOT}/mcp/server.cjs`, a standalone server with no `node_modules` dependency. |
| Skills | `wakeflow-controller`, `wakeflow-target`, and `wakeflow-governance` operating manuals. |
| Slash commands | `/wakeflow:init`, `/wakeflow:check`, `/wakeflow:windows`, `/wakeflow:status`, `/wakeflow:dispatch`, `/wakeflow:review`, and `/wakeflow:unattended`. |
| Host transport helper | `scripts/lib/wakeflow-claude-host.mjs`. Fleet: `preflight`, `ensure-server`, `launch-window`, `launch-all`, `replace-all`, `retitle`, `arrange-windows`, `attach-window`, `window-status`, `check-workspace`. Delivery: `deliver` (primary), `send`, `readback`, `release-lock`, `wait-results`, `activity-monitor`. Policy: `seed-permissions`, `set-unattended`, `stamp-runtime`. Cross-demand: `stream-open/close/list`, `pod-open/close/list`. |

The helper requires tmux. Initialization runs `preflight`, which installs tmux
with `brew install tmux` after one explicit user consent when it is missing,
retrying once on transient bottle errors.

## Quick Start

Three steps from install to a running fleet, then a command cheat sheet.

1. **Initialize** (once per workspace) — in Claude Code, from the workspace directory:
   ```text
   /wakeflow:init
   ```
   Preview the plan, confirm, and Wakeflow writes the config + access cards, launches every window, and registers it. Already initialized? `init` stops on purpose — use `/wakeflow:windows <name> --replace` for a stale window, or re-run only on an explicit reset.
2. **Enter the workspace** — open a NEW terminal window or tab, `cd` into the workspace, and run (substitute your `hosts.claude-code.tmuxSession`):
   ```text
   tmux attach -t wakeflow
   ```
3. **Start work** — give the controller window a demand, or run `/wakeflow:dispatch`.

### Command cheat sheet

| Command | What it does | When |
| --- | --- | --- |
| `/wakeflow:init` | Scaffold the workspace, then launch + register every window (first time only) | A brand-new workspace |
| `/wakeflow:windows` | Read-only status table of every window (registered? alive? mode?) | "What is the fleet doing?" |
| `/wakeflow:windows all` | Resume/relaunch every configured window with the SAME session ids (context intact) | After a reboot or a plugin upgrade |
| `/wakeflow:windows <name>` | Resume one window | One window died |
| `/wakeflow:windows <name> --replace` | Rebuild one window with a fresh session | A window is stale / context-heavy |
| `/wakeflow:status` | Demands, eligible work, deliveries, window readiness | Before dispatching |
| `/wakeflow:dispatch` | Prepare and send one delivery to a target window | Hand work to a window |
| `/wakeflow:review` | Review a target's raw evidence, record accept / rework / blocked | A result came back |
| `/wakeflow:unattended on|off` | Toggle the work windows' permission mode | Switch hands-off ↔ prompted |
| `/wakeflow:check` | Health-check an existing workspace, converge stale or missing surfaces | After an upgrade |

Mnemonic: **`init` builds it, `windows all` powers it on, `windows` just takes a look.**

## Security & System Impact

Wakeflow is a powerful local automation plugin. Before installing, understand exactly what it does on your machine — none of it is hidden:

- **Runs a local MCP server** (`node mcp/server.cjs`): a standalone, dependency-free Node process. It reads/writes workspace state files; it makes no network calls of its own.
- **Spawns tmux sessions and interactive `claude` windows**: the controller and each work window are real `claude` CLI sessions living in one tmux session. Wakeflow creates, resumes, replaces, and arranges them via the bundled host helper.
- **Runs these shell commands**: `node`, `tmux`, `git`, and `brew` — the last only to `brew install tmux` once, after a single explicit consent, when tmux is missing.
- **Permission model — safe by default**: work windows ship with `acceptEdits` (Claude Code still prompts before risky actions). Fully unattended `bypassPermissions` (no prompts) is **opt-in only**: a workspace enables it explicitly via `/wakeflow:unattended on`, that choice is recorded in `wakeflow.config.json`, and only that recorded consent lets the helper auto-confirm the boot dialog. The safety boundary in unattended mode is the repository worktree, the `CLAUDE.md` gates, and the Wakeflow state machine.
- **Local-first, no telemetry**: real session/thread ids live only under `.wakeflow-local/` and are never written to tracked files, prompts, or sent anywhere. Demands, evidence, and ledgers stay in your workspace.
- **Platform**: macOS-first (tmux + `brew` + iTerm2). The tmux core should work on Linux but is not yet verified there.

You remain in control: scripts and MCP tools create, validate, and record machine data — they never accept work, widen scope, or decide product behavior. The controller is the only acceptance authority, and product decisions are yours.

## Window Model

Window transport is the key Claude Code difference, and the Claude Code
edition is terminal-only. Every Wakeflow window (controller included) is a
tmux-resident interactive `claude` session. The default fleet lives in one
tmux server session named `wakeflow`; each demand pod (below) adds its own
`wakeflow-<pod>` session beside it. The session name is configurable in
`wakeflow.config.json`:

```json
{
  "hosts": {
    "claude-code": {
      "tmuxSession": "wakeflow"
    }
  }
}
```

A Wakeflow thread id is the window's Claude Code session id, which stays
stable across resumes. Desktop windows are not an automation transport. The
envelope, evidence, and review contracts are unchanged from the shared
Wakeflow model.

**Launch.** Initialization runs the helper's `preflight` (tmux install with
consent when missing), then `launch-window` for each planned window: the
helper creates a tmux window running `claude --session-id`, pastes the
entry-sync prompt, sets the `displayTitle` as the tmux window name, and
returns the session id, which is registered once in the local thread
registry.

**Dispatch.** The primary transport is one step: `deliver --delivery-file
<envelope.json>` reads the prepared envelope, renders the prompt, resolves the
target window itself, enforces the shared per-window delivery lock, pastes
through a tmux buffer, and returns pane readback evidence; the agent records
it with `wakeflow_record_delivery`. (`send --window <target> --prompt-file
<file>` remains the low-level path for custom prompts.) Target windows
controller-return the same way toward the controller window — for pod demands
the envelope's stamped `controllerWindow` routes the return to the pod's own
controller. `wait-results --group <id>` is available only for explicit
synchronous waits in scripted flows; normal dispatch does not arm it.

**Recovery.** When a tmux window dies, the registered session id remains the
thread id: relaunch the SAME session interactively with `launch-window --resume --session-id <registered id> --replace` (same id; subscription pool). Headless `claude -p --resume` is a last resort that bills the separate Agent SDK credit from 2026-06-15; if used, then
`launch-window --replace` with that id.

**Watching.** Open a new terminal window/tab and run `tmux attach -t
<session>` (default `wakeflow`); the helper's `attach-window --window <name>`
prints this exact instruction for a window. That single command is the
supported path — no programmatic tab-opening or alternative attach variants.

**Unattended permissions.** Work windows ship with `acceptEdits`; the
fleet-wide mode lives in `hosts.claude-code.permissionMode` and changes only
through an explicit, recorded decision (`/wakeflow:unattended on|off`, or the
helper's `set-unattended`). Only that recorded `bypassPermissions` consent lets
the helper auto-confirm the boot dialog. Per-repository
`.claude/settings.json` allowlists still compose with whichever mode is
recorded.

## Demand Pods (multi-demand parallelism)

Parallelism exists ONLY at the demand level. Within one demand each repository
runs exactly ONE window with ONE combined task package (the window
self-sequences its items); across demands, up to `maxActiveDemands` (default
2, `wakeflow.config.json`) demands run side by side as pods:

- One demand = one execution pod. The persistent fleet is pod 0 and uses the
  main checkouts. Demand 2..N gets its own `Controller__<pod>`, per-repo
  isolation worktree windows (`<repo>__<pod>` on branch
  `<demandKey>/<pod>`), `Test__<pod>`, and tmux session; every window in that
  isolation pod stays on its ONE worktree set and never uses a main checkout.
  Pods are mutually unaware.
- Open/resume/close with the helper: `pod-open --demand-key <key> --repos
  <a,b>` (idempotent — re-run resumes dead windows from the registry),
  `pod-list` (the one global view), `pod-close` after archive.
- The pod controller claims its demand itself (`wakeflow_create_demand` with
  `controllerWindow: "Controller__<pod>"`), so every controller-return routes
  to the pod, not the default controller.
- Close order: `complete-demand` → `stream-close` each repo window → archive
  → `pod-close`. Surviving branches land on
  `wakeflow-ledger/workspace/pending-merges.md`; merge-back is human-reviewed
  and decentralized — no controller merges pod branches.
- `maxStreamsPerRepo` bounds how many pods may hold isolation worktrees on
  one repository; claiming past `maxActiveDemands` fails closed.

## One Vocabulary Across Hosts

Wakeflow keeps one machine vocabulary across host editions. A "thread id" in
registries, payload fields, and CLI flags is the Claude Code session id,
stable across resumes; no field is renamed per host. The per-window rules file is `CLAUDE.md`, which
Claude Code auto-loads when the session starts, so each window reads its own
gates and access card without extra prompting.

## Initialize A Workspace

Wakeflow is installed as a Claude Code plugin. A target workspace does not
need to contain Wakeflow source code. The expected target shape is:

```text
MyWorkspace/
  CLAUDE.md
  wakeflow.config.json
  .wakeflow-active/          # ignored active controller state
  .wakeflow-local/           # ignored thread registry and derived runtime
  wakeflow-ledger/            # durable project coordination records
  ProductRepo/
  CoreRepo/
  Design/                     # default internal requirement-design surface
  Test/                       # default internal test coordination surface
```

The simplest user prompt is:

```text
Use Wakeflow to initialize the current workspace.
Preview the plan first and wait for my confirmation before writing.
```

The operating flow is:

1. Claude Code calls `wakeflow_initialize_workspace` with `apply: false`.
2. Wakeflow returns directory facts and an `agentSelectionProtocol`.
3. Claude Code judges whether the workspace is clean or messy from those facts
   and user context.
4. For a clean workspace, Claude Code calls the tool again with explicit
   `repositories` mappings for the intended work windows.
5. For a messy workspace, Claude Code asks which directories are managed
   windows before writing. It must not use a broad discovered-directory
   import.
6. After user confirmation for a fresh workspace, Claude Code calls
   `wakeflow_initialize_workspace` with `apply: true`.
7. Claude Code runs the host helper: `preflight` first, then `launch-window`
   for each window in the returned launch plan. Each launch creates a tmux
   window running `claude --session-id`, pastes the entry-sync prompt, sets
   the `displayTitle` as the tmux window name, and returns the session id.
   Claude Code calls `wakeflow_register_window` once per returned
   `hostLaunch.sessionId`; the tool updates the local registry and derived
   window config without exposing the id.

For an already initialized workspace, `wakeflow_initialize_workspace` is not a
general refresh button. It may write only after the user explicitly requests a
reset initialization; the apply call must set `resetInitialization: true`, pass
explicit `repositories`, reconfirm Design/Test mode, and must not use
`useDiscovered`. Heavy or stale tmux windows use the replacement commands
instead.

Command responsibilities stay separate:

| Need | Command | Responsibility |
| --- | --- | --- |
| First-time setup | `wakeflow_initialize_workspace` | Discover, confirm, write workspace config/docs/support surfaces, and return the full launch plan. |
| Explicit reset setup | `wakeflow_initialize_workspace` with `resetInitialization: true` | Reconfirm work directories, clean stale managed window cards/runtime for removed windows, and rewrite setup surfaces. |
| One heavy/stale window | `wakeflow_replace_windows` (pass `window`) | Return one replacement launch entry with a `wakeflow_register_window` call template; no workspace docs refresh. |
| Several heavy/stale windows | `wakeflow_replace_windows` | Return only the requested replacement entries and registration call templates; no unrelated window rewrites. |

Design and Test are fresh support surfaces by default. Existing similarly
named directories such as `<Product>Design` or `<Product>Test` are treated as
ordinary directory facts unless the user explicitly maps them as Design/Test.

Wakeflow supports localized initialization. Pass `language: "zh"` for Chinese
workspaces, `language: "en"` for English workspaces, or `language: "auto"`
when there is no clear preference. Generated session titles keep the window
name at the front so the important repository name remains visible in narrow
sidebars. New state-root progress documents and subsequent Unified Status
renders also use the selected interface language.

Controller and child windows can use Claude Code subagents to speed up bounded
code search, log triage, test localization, and evidence summaries. Subagent
output is evidence or advice only; controller review, dispatch, state writes,
and repository boundaries remain with the Wakeflow window that owns the task.

## What Wakeflow Creates

Initialization writes only the surfaces needed for the confirmed workspace
boundary:

| Surface | Purpose |
| --- | --- |
| `CLAUDE.md` | Parent controller gates and durable boundaries. |
| Child `CLAUDE.md` access cards | Per-window responsibility and read paths. |
| `wakeflow.config.json` | Managed windows, repository paths, roles, host transport settings such as the tmux session name, and default language. |
| `.wakeflow-active/` | Active state roots, current indexes, progress docs, TODO projections, intake, and test cards. |
| `.wakeflow-local/` | Thread registry, delivery runtime, local overrides, and derived window config. |
| `wakeflow-ledger/` | Long-term project coordination records and archives. |
| `Design/` | Internal requirement-design workspace when no external Design repository is mapped. |
| `Test/` | Internal test coordination workspace when no external Test repository is mapped. |

Wakeflow also synchronizes `.gitignore` so only `.wakeflow-active/` and
`.wakeflow-local/` remain local runtime directories. It does not add product
repositories, Design/Test folders, ledgers, `.DS_Store`, or other user
workspace noise to `.gitignore`.

## Automation Semantics

Wakeflow automation is direct session delivery plus explicit result return.

Core rules:

- Real session ids live only in
  `.wakeflow-local/wakeflow-delivery/hosts/claude-code/thread-registry/`.
- Window config is derived from `wakeflow.config.json` plus thread-registry
  presence; it is not a second session-id or window-semantics authority.
- Delivery prompts remain compact and human-readable.
- The controller sends a prepared envelope in one step with the host helper
  (`deliver --delivery-file <envelope.json>`; `send --window --prompt-file` is
  the low-level custom-prompt path); the helper enforces the shared per-window
  delivery lock, pastes through a tmux buffer, and returns pane readback
  evidence that the agent records with `wakeflow_record_delivery`.
- Targets controller-return through the same helper send toward the
  controller window; `wait-results --group <id>` is available only for explicit
  synchronous waits in scripted flows.
- `group-ready` waits for the expected target results before a controller
  return.
- `per-target` can wake the controller once per target while still preserving
  a group snapshot.
- After a real send is recorded as sent with readback evidence, the controller
  turn stops. It does not sleep or poll in the same turn.
- Keep-live support is runtime assistance only. It is not task logic,
  transport authority, or acceptance evidence.

Automation stops on final completion, hard gates, user stop, no eligible work,
missing evidence, blocked state, or any condition that requires controller or
user judgment.

## MCP Capability Surface

Wakeflow exposes only stable outer workflow contracts as MCP tools, and the
tool names are identical to the Codex edition. Runtime scripts remain the
internal implementation and test surface; they are not public tools just
because they exist. A target closeout uses the same delivery model as
controller dispatch: prepare an envelope, send the prompt through the tmux
host helper, then record the delivery run.

Primary tool groups:

| Need | MCP tools |
| --- | --- |
| Setup and workspace discovery | `wakeflow_initialize_workspace` |
| Responsibility window replacement | `wakeflow_replace_windows` (one via `window`, many via `windows`) |
| Demand and task state | `wakeflow_status`, `wakeflow_create_demand`, `wakeflow_claim_next`, `wakeflow_add_task`, `wakeflow_next_work`, `wakeflow_render_progress` |
| Delivery and returns | `wakeflow_prepare_delivery`, `wakeflow_record_delivery` |
| Results and review | `wakeflow_record_target_result`, `wakeflow_review_pack`, `wakeflow_reduce_results`, `wakeflow_decide_review`, `wakeflow_complete_demand` |
| Design and Test intake | `wakeflow_deliver`, `wakeflow_intake_test_card` |
| Archive, maintenance, and verification | `wakeflow_archive` (target demand/todo/docs), `wakeflow_prune_runtime`, `wakeflow_verify`, `wakeflow_view` (scope trace) |
| Host ownership and locks | `wakeflow_adopt_demand_host`, `wakeflow_release_window_lock` |

Public MCP tools are for outer agent workflows. Target closeout is
deliberately split: record a target result, review readiness, prepare a
controller-return envelope when policy allows, send through the tmux host
helper, and record delivery evidence. Controller review stays split as review
pack, result reduction, and explicit decision; result reduction only creates a
review candidate and is not acceptance. Do not collapse those steps into a
single target-window MCP tool. Internal steps such as archive summary refresh
internals, keep-live state, and script backend execution stay inside Wakeflow
runtime scripts and skills. Public archive MCP tools wrap only
controller-approved TODO or workspace document archive flows; they do not make
acceptance decisions or send host messages.

Wakeflow declares MCP tool annotations for every public tool: read-only tools
are marked read-only, write tools are local, non-destructive, and
closed-world. Tool approval is still controlled by the user's Claude Code
permission settings; a trusted local installation can allowlist the
`wakeflow` MCP server in `.claude/settings.json`.

## Runtime And Ledger Boundaries

Wakeflow keeps source, active runtime, and durable records separate:

| Path | Boundary |
| --- | --- |
| `skills/` | Reusable operating instructions installed with the plugin. |
| `scripts/` | Runtime implementation and validation scripts packaged by the plugin. |
| `templates/wakeflow-template-bundle.json` | Bundled starter state, Design/Test, and ledger skeletons expanded during setup. |
| `.wakeflow-active/` | Current active work in a target workspace; ignored by Git. |
| `.wakeflow-local/` | Machine-local thread registry, derived runtime views, and local state; ignored by Git. |
| `wakeflow-ledger/` | Project-specific durable records outside reusable Wakeflow source. |

The source repository tracks reusable Wakeflow capability. Product code,
project-specific active state, real session ids, and derived local runtime
artifacts do not belong in Wakeflow source.

## Dual-Host Workspaces

One workspace may run the Codex and Claude Code Wakeflow editions side by
side. Shared business state stays host-neutral: `.wakeflow-active/`,
`wakeflow-ledger/`, and the delivery state under
`.wakeflow-local/wakeflow-delivery/` (`dispatch-packets/`,
`dispatch-groups/`, `delivery-envelopes/`, `delivery-runs/`,
`target-results/`), plus the shared `locks/` directory that enforces one
in-flight delivery per window across hosts.

Host-scoped runtime is separated per host:

- `.wakeflow-local/wakeflow-delivery/hosts/codex/{thread-registry,window-config,keep-live}/`
- `.wakeflow-local/wakeflow-delivery/hosts/claude-code/{thread-registry,window-config,window-host,keep-live}/`

`AGENTS.md` (Codex) and `CLAUDE.md` (Claude Code) coexist at the workspace
and child roots, and each demand has exactly one controller across hosts.
Demand creation is host-neutral (`controllerHost: null`); the first real
driving command claims ownership for `codex` or `claude-code`; non-owning
hosts fail closed on controller mutations and dispatch preparation; and
`--adopt-host` is the explicit transfer mechanism. `wakeflow_status` exposes
the current mapping under `dualHost.demandOwnership`.

## Working In This Repository

Use the repository root to develop the Wakeflow plugin itself:

```sh
npm run validate
npm run smoke
npm run test:wakeflow
npm test
```

Common source areas inside this plugin artifact:

| Path | Purpose |
| --- | --- |
| `.claude-plugin/plugin.json` | Plugin manifest with the MCP server reference. |
| `.mcp.json` | MCP server wiring (`node ${CLAUDE_PLUGIN_ROOT}/mcp/server.cjs`). |
| `mcp/server.cjs` | Standalone MCP server entrypoint with no `node_modules` dependency. |
| `lib/` | MCP tool definitions, runtime helpers, process and trace support. |
| `scripts/` | Setup, state, delivery, intake, archive, validation, and CLI runtime shipped with the plugin. |
| `skills/` | Controller, target, and governance operating manuals shipped with the plugin. |
| `commands/` | Slash command definitions for `/wakeflow:*`. |
| `templates/wakeflow-template-bundle.json` | Installed workspace starter documents and support surfaces, bundled for marketplace scan size. |
| `assets/` | Marketplace and plugin presentation assets. |

The repository root README explains the shared architecture; this README is
the Claude Code edition manual.

## Design Principles

1. **Judgment stays visible**: script output, status rows, and target backfill
   are evidence, not acceptance.
2. **One demand, one state root**: JSON state and Markdown progress surfaces
   stay tied to the same demand.
3. **Prompts wake, state instructs**: prompts should be compact; task detail
   belongs in state roots, task packages, and installed skills.
4. **Repository boundaries matter**: each window owns its source, tests,
   commits, and evidence.
5. **Automation moves work, not authority**: delivery proves that a prompt was
   sent, not that the result is complete.
6. **Local runtime stays local**: real session ids stay only in the local
   thread registry, and active runtime state never enters tracked
   documentation.
7. **Fresh support windows by default**: Design and Test are created as clear
   Wakeflow support surfaces unless the user explicitly maps existing ones.

Wakeflow exists to make multi-window agent work safe to resume, easy to
inspect, and hard to fake.
