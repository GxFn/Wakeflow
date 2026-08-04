<div align="center">

# Wakeflow for Claude Code

A disciplined control loop for multi-window agent work — every step traced, every result reviewable.

[English](README.md) | [Simplified Chinese](README.zh-CN.md)

Wakeflow turns a local Claude Code workspace into a disciplined controller
system: a controller-owned loop for each active demand, focused repository windows, explicit state
roots, compact delivery envelopes, and controller-validated acceptance. The controller runs this as a closed loop — plan, dispatch, collect review inputs, independently validate, decide, repeat — and records every step, so the whole run is auditable after the fact.

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
unfinished controller validation.

Wakeflow provides the missing control layer:

- **Controller-first judgment**: the parent workspace owns goals, boundaries,
  dispatch decisions, acceptance, TODO routing, and archive decisions.
- **One state root per demand**: task packages, target results, review
  candidates, decisions, and progress projections stay tied to the same demand.
- **Context-complete task packages**: each new package records one objective,
  anchored requirement references, boundaries, completion expectations,
  dependencies, and the repository commit decision; dispatch derives the
  required execution Skills from that package.
- **Focused child windows**: each repository window works only inside its
  configured responsibility boundary.
- **Preview-gated compact delivery**: the controller reviews the resolved
  repository, task briefing, Skills, and exact prompt before a digest-matched
  apply can write the delivery envelope.
- **Acceptance-anchored craft**: every new implementation package carries concrete
  claim/probe/expected anchors that targets map to RED checks before coding;
  the mapping is review input and the controller still validates independently.
- **Review inputs before acceptance**: target backfill, logs, paths, and test
  summaries are inputs, not conclusions. Wakeflow checks structure and path
  locatability; the controller independently validates behavior before completing work.
- **Local-first runtime**: real session ids live only in the local thread
  registry; window config is a derived sendability view, and active state stays
  out of tracked source.

Wakeflow is not a command launcher with nicer names. It is a reusable workflow
capability for keeping multi-window agent work legible, bounded, and resumable.

## Architecture

Wakeflow is three layers working together: a window fleet you can see, a
closed loop that moves the work, and a disk layout that survives restarts.

### Layer 1 — the fleet (what you see)

The baseline fleet lives in the configured tmux session; every explicitly
authorized Pod gets its own additional tmux session. Each window is an interactive Claude Code
session pinned to one responsibility, and the status
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
| Controller | owns goals, dispatch, independent validation, acceptance | `max` |
| Design | clarifies requirements, redesigns non-bug outcome mismatches, prepares handoffs | `xhigh` |
| Repo windows | implement inside exactly one repository | `xhigh` |
| Test | after controller validation, explores only the approved real-environment boundary for hidden bugs | `xhigh` |

Inside every pane a seeded statusline shows the live serving model and the
window identity in plain text. tmux windows do not survive a machine reboot.
`launch-all` and direct `launch-window --resume` apply only to the configured
baseline fleet. Pod recovery is separate: `mode=resume` verifies or resumes
only the exact bound session at its recorded cwd, while current product/main
HEAD and dirty state remain observations rather than recovery gates.

### Layer 2 — the loop (how work moves)

Work is organized into demands: one demand = one goal = one state root on
disk. Every demand moves through the same closed loop:

```text
 1 init       raw state init creates the demand root               (unclaimed)
 2 claim      public create, or first raw-state drive, binds host  (codex | claude)
 3 add task   a task package freezes target context and requirement anchors
 4 dispatch   preview -> digest-matched apply -> LOCK -> prompt pasted
 5 work       the target window executes inside its repository boundary
 6 result     TargetResultEnvelope lands with declared review-input refs -> lock released
 7 review     controller inspects inputs + independently validates, then decides
 8 complete   active required tasks accepted, replacement lineage valid, no blocker
```

These rules keep the loop honest:

- **One demand authority, regardless of who creates it.** Design is the default
  author for substantial new product behavior; the controller may create
  bounded or already-documented work directly only with the same proportional
  anchored inputs. The first implementation package freezes them once as
  `demand-authority.json`. A typed draft may precede that freeze; `Auto Claim`
  changes claim timing only.
- **Prompts brief, packages contextualize, Skills execute.** The bounded prompt
  carries objective, priority completion/context/boundary cues, reading order,
  identity, and trace. The package owns complete task context, requirement
  anchors preserve background, and Skills own procedure.
- **Backfill is input, not acceptance.** A target's self-report never closes
  work. The controller inspects target-authored materials (commits, command
  output, reports) and independently validates the relevant behavior before
  recording a decision. A blocked decision is always recoverable when new
  review inputs arrive.
- **Replacement is explicit.** Ordinary rework redispatches the same task.
  Mainline redesign preserves the rejected task, then the controller creates a new
  full-context implementation task in the product responsibility window with
  `replacesTargetTaskId` after the Design handoff. Accepting that replacement
  supersedes the old task and package.
  The current implementation freezes exactly one Design request/handoff generation per Pod;
  that sole request may be `initial-design`, `supplement`, or `redesign`. A
  different second generation remains blocked rather than overwriting it or
  falling back to mainline Design.

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
    target-results/                                          target-authored result envelopes
    locks/                       one in-flight target delivery per window, cross-host
    hosts/codex/                 codex session registry (host-scoped)
    hosts/claude-code/           claude session registry + tmux bindings
    hosts/<host>/pod-*           pod plans, operations, bindings, access receipts
```

Rule of thumb: **business truth is host-neutral and shared; transport handles
are host-scoped and never leave `.wakeflow-local/`.** Session ids never
appear in tracked files, prompts, or backfill text.

### Who decides what (trust model)

- Scripts and MCP tools create, validate, and record machine data; they never
  choose acceptance, widen scope, or decide product behavior on their own.
  They only persist an explicit controller decision.
- Target windows execute exactly their dispatched package and report review inputs.
- The controller is the only acceptance authority and must complete its own
  functional validation before Test starts. Every active/open non-Test target
  must already be accepted; canonical superseded replacement history is not an
  open target. Test follows the frozen demand goal and approved Test
  card (`controllerSelfChecks`, approved plan, allowed skills, setup policy,
  and attempt bound); it cannot invent a goal, gate, environment, skill, or
  method. progressive-chain-validation is usable only when explicitly listed.
- The user owns product decisions. `bypassPermissions` is never a silent
  default: it is recorded in `wakeflow.config.json` only after an explicit
  yes, and that recorded consent is what authorizes unattended boot dialogs.

### Dual-host coexistence

The same workspace can run the Codex edition and the Claude Code edition side
by side. Demands bind to one platform at claim time (machine-enforced on every
driving command), the shared per-window work lease serializes target
deliveries across hosts (controller returns use a separate paste mutex), and
ownership moves only through an explicit, audited
`adopt-demand-host` transfer.

## Install Wakeflow

> Platform support: macOS-first. The tmux fleet and `brew` preflight are
> exercised daily on macOS; the tmux core should work on Linux but is not yet
> verified there. Enter the fleet from a new terminal with `tmux attach -t
> <session>` when `tmuxSocket` is unset, or `tmux -L <tmuxSocket> attach -t
> <session>` when the dedicated socket is configured.


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
| MCP server | `.mcp.json` starts `${CLAUDE_PLUGIN_ROOT}/bin/wakeflow-mcp`; the launcher selects Node.js 20+ and starts the standalone `mcp/server.cjs` with no `node_modules` dependency. |
| Skills | `wakeflow-controller`, `wakeflow-target`, `wakeflow-target-craft`, and `wakeflow-governance` operating manuals. |
| Slash commands | `/wakeflow:init`, `/wakeflow:check`, `/wakeflow:windows`, `/wakeflow:status`, `/wakeflow:dispatch`, `/wakeflow:review`, and `/wakeflow:unattended`. |
| Host transport helper | `scripts/lib/wakeflow-claude-host.mjs`. Fleet: `preflight`, `ensure-server`, `launch-window`, `launch-all`, `replace-all`, `retitle`, `arrange-windows`, `window-status`, `check-workspace`. Delivery: `deliver` (primary), `send`, `readback`, `wait-results`, `activity-monitor`. Policy: `seed-permissions`, `set-unattended`, `stamp-runtime`. Explicit Pod host lifecycle: `pod-open`, `pod-close`, `pod-list` (native `claude --worktree` for products). `stream-open/close/list` is legacy recovery only, not the new Pod path. |

The helper requires tmux. `preflight` only reports availability and the
recommended install command. When tmux is missing, the initialization command
asks once for explicit user consent; Claude Code then runs `brew install tmux`
and may retry once on a transient bottle error.

## Quick Start

Three steps from install to a running fleet, then a command cheat sheet.

1. **Initialize** (once per workspace) — in Claude Code, from the workspace directory:
   ```text
   /wakeflow:init
   ```
   Preview the plan, confirm, and Wakeflow writes the config + access cards, launches every window, and registers it. Already initialized? `init` stops on purpose — use `/wakeflow:windows <name> --replace` for a stale window, or re-run only on an explicit reset.
2. **Enter the workspace** — open a NEW terminal window or tab, `cd` into the workspace, and run (substitute your `hosts.claude-code.tmuxSession`; add `-L <tmuxSocket>` before `attach` when configured):
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
| `/wakeflow:review` | Inspect target inputs, independently validate, then record accept / rework / blocked | A result came back |
| `/wakeflow:unattended on|off` | Toggle the work windows' permission mode | Switch hands-off ↔ prompted |
| `/wakeflow:check` | Health-check an existing workspace, converge stale or missing surfaces | After an upgrade |

Mnemonic: **`init` builds it, `windows all` powers it on, `windows` just takes a look.**

## Security & System Impact

Wakeflow is a powerful local automation plugin. Before installing, understand exactly what it does on your machine — none of it is hidden:

- **Runs a local MCP server** (`bin/wakeflow-mcp`): the dependency-free launcher selects Node.js 20+ and starts `mcp/server.cjs`. The server reads/writes workspace state files; it makes no network calls of its own.
- **Spawns tmux sessions and interactive `claude` windows**: the baseline fleet uses the configured tmux session; each demand pod uses another session. Wakeflow creates, resumes, replaces, and arranges these real `claude` CLI sessions via the bundled host helper.
- **Runs these shell commands**: `node`, `tmux`, `git`, and `brew` — the last only to `brew install tmux` once, after a single explicit consent, when tmux is missing.
- **Permission model — safe by default**: work windows ship with `acceptEdits` (Claude Code still prompts before risky actions). Fully unattended `bypassPermissions` (no prompts) is **opt-in only**: a workspace enables it explicitly via `/wakeflow:unattended on`, that choice is recorded in `wakeflow.config.json`, and only that recorded consent lets the helper auto-confirm the boot dialog. The safety boundary in unattended mode is the repository worktree, the `CLAUDE.md` gates, and the Wakeflow state machine.
- **Local-first, no telemetry**: real session/thread ids live only under `.wakeflow-local/` and are never written to tracked files, prompts, or sent anywhere. Demands, result inputs, and ledgers stay in your workspace.
- **Platform**: macOS-first (tmux; Homebrew is only the documented install path when tmux is missing). The tmux core should work on Linux but is not yet verified there.

You remain in control: scripts and MCP tools create, validate, and record
machine data; they never choose acceptance, widen scope, or decide product
behavior on their own. They only persist an explicit controller decision. The
controller is the acceptance authority, and product decisions are yours.

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
envelope, target-result, and review contracts are unchanged from the shared
Wakeflow model.

**Launch.** Initialization runs the helper's `preflight` (tmux install with
consent when missing), then `launch-window` for each planned window: the
helper creates a tmux window running `claude --session-id`, pastes the
entry-sync prompt, sets the `displayTitle` as the tmux window name, and
returns the session id, which is registered once in the local thread
registry.

**Dispatch.** The primary transport is one step: `deliver --delivery-file
<envelope.json>` reads the prepared envelope, renders the prompt, resolves the
target window itself, reuses/revalidates the work lease reserved by applied
envelope preparation, pastes through a tmux buffer, and returns pane readback evidence; the agent records
it with `wakeflow_record_delivery`. (`send --window <target> --prompt-file
<file> --delivery-id <id>` remains the low-level path for an explicitly
identified custom target prompt, never a controller-return.) Target windows
controller-return the same way toward the controller window — for pod demands
the envelope's stamped `controllerWindow` routes the return to the pod's own
controller without taking a target work lease. If a send is accepted before
the new pane turn is visible, only bounded readback is retried; the prompt is
never sent twice. Accepted transport is recorded as `sent`; readback is an
independent `confirmed` / `pending` / `unavailable` observation for Agent
judgment, not a send gate. A matching target result normally releases a target
work lease. For send-failure recovery, only a proven pre-send rejection may
release the exact matching lease; ambiguous outcomes preserve it. `wait-results --group
<id>` is available only for explicit
synchronous waits in scripted flows; normal dispatch does not arm it.

**Recovery.** Creation and recovery are separate. When a tmux window dies or
the machine reboots, the registered
session id remains the thread id. Relaunch a baseline conversation with
`launch-window --root <workspace> --window <window> --cwd <recorded actual cwd>
--resume --session-id <registered id> --replace [--server <configured server>]`;
use `launch-all` only for the registered baseline fleet. A Pod uses the
read-only `wakeflow_pod_open mode=resume` plan. The helper verifies a live
window or resumes only the exact registered session at the immutable bound
cwd; it never repeats the creation HEAD gate, adds `--worktree`, discovers or
creates a replacement, rebinds core state, or falls back to mainline. Missing
or ambiguous identity remains blocked. A baseline-only
`headless-recovery` send adapter exists as a last resort when interactive
relaunch is impossible; it is not the normal fleet path, records one bounded
readback observation without requiring confirmed visibility, and must never
recover a Pod window.

**Watching.** Open a new terminal window/tab and run `tmux attach -t
<session>` (default `wakeflow`) without a dedicated socket, or `tmux -L
<tmuxSocket> attach -t <session>` when configured. There is no programmatic
tab-opening path.

**Unattended permissions.** Work windows ship with `acceptEdits`; the
fleet-wide mode lives in `hosts.claude-code.permissionMode` and changes only
through an explicit, recorded decision (`/wakeflow:unattended on|off`, or the
helper's `set-unattended`). Only that recorded `bypassPermissions` consent lets
the helper auto-confirm the boot dialog. Per-repository
`.claude/settings.json` allowlists still compose with whichever mode is
recorded.

## Demand Pods (multi-demand parallelism)

Mainline is the default execution surface. If it is busy, ordinary work and
Auto Claim wait. Missing/unhealthy required mainline identity returns
`mainline-unavailable` before demand/TODO mutation and is repaired. Wakeflow
never turns a second demand into a Pod automatically. A Pod requires an
auditable, explicit user authorization and Wakeflow applies no numeric Pod or
per-repository limit.

- One Pod owns independent `Controller__<pod>`, `Design__<pod>`,
  `Test__<pod>`, and one product session per selected repository, in its own
  tmux container. Within the demand, each repository still receives one
  combined package at a time.
- Core `wakeflow_pod_open mode=create` records host-neutral first-
  materialization operations. The helper materializes them: three distinct
  control sessions and native
  `claude --worktree` product sessions from exact repository roots. It never
  nests Claude's `--tmux` or grants the whole workspace with a default
  `--add-dir`.
- `wakeflow_pod_record event=materialization` can journal the exact launch
  correlation around the helper call. Claude returns a final session id
  synchronously; it has no Codex `clientThreadId` pending state, and no
  temporary request id belongs in the registry.
- Register only the final Claude session id, then verify pane cwd, Git common
  dir, base HEAD, and `mainCheckout=false` with `wakeflow_pod_bind`. All three
  control bindings produce `control-ready`; the Pod Design handoff plus all
  product bindings produce `execution-ready`.
- The Pod's single Design generation stays between `Controller__<pod>` and
  `Design__<pod>`.
  Freeze the controller request with
  `wakeflow_pod_plan action=design-request`, then record its exact
  `PodDesignHandoffEnvelope` with `wakeflow_pod_record event=design-handoff`; neither
  step creates a second global TODO. The current implementation does not persist a second
  Pod Design generation, so later supplement/redesign is an explicit
  capability blocker.
- Before Pod Test dispatch, run `wakeflow_pod_plan action=test-access` and record
  the independent Test session's exact probe through
  `wakeflow_pod_record event=test-access`. Only `validated` +
  `direct-multi-root` coverage of every active product binding opens dispatch.
  Unsupported multi-root access remains blocked; no main-checkout, product-
  window, or unverified per-repository-executor fallback is implemented.
- Re-running `mode=create` may materialize only canonical operations that are
  still pending and unbound. `mode=resume` contains only already-bound
  operations: it verifies or resumes the exact session at the recorded actual
  cwd, and never creates a missing session, passes `--worktree`, or rebinds it.
- Core `wakeflow_pod_plan action=close` emits a host-close plan. Helper `pod-close` closes
  tmux/Claude sessions and reports worktree disposition; record each result
  with `wakeflow_pod_record event=close-receipt`. Wakeflow never runs Git worktree
  cleanup for the new Pod path.

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
   Claude Code registers each returned final session id, then runs helper
   `retitle` as the final title reset. The tool updates the local routing
   registry and derived window config without exposing the id. Wakeflow does
   not classify initialization readback or maintain a separate session-ready
   state.

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
code search, log triage, test localization, and input summaries. Subagent
output is review input or advice only; controller validation, dispatch, state writes,
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
| `.wakeflow-local/` | Thread registry, delivery runtime, host-scoped Pod operation/binding receipts, local overrides, and derived window config. |
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
  (`deliver --delivery-file <envelope.json>`; `send --window --prompt-file
  --delivery-id <id>` is the low-level custom-target-prompt path, never a
  controller-return); applied preparation reserves the shared per-window work
  lease, and target delivery reuses/revalidates it, pastes through a tmux buffer, and returns pane readback
  evidence that the agent records with `wakeflow_record_delivery`.
- Targets controller-return with envelope-aware `deliver --delivery-file`
  toward the stamped controller window without taking a target work lease;
  `wait-results --group <id>` is available only for explicit
  synchronous waits in scripted flows.
- `group-ready` waits for the expected target results before a controller
  return.
- `per-target` can wake the controller once per target while still preserving
  a group snapshot.
- The helper makes one bounded pane observation. Only `confirmed` proves the
  destination was reached; accepted transport with `pending`/`unavailable`
  readback is exposed as `sent-unconfirmed`. The turn stops without another
  pane read or automatic resend.
- Keep-live support is runtime assistance only. It is not task logic,
  transport authority, or acceptance evidence.

Automation stops on final completion, hard gates, user stop, no eligible work,
missing review inputs, blocked state, or any condition that requires controller or
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
| Setup and window registration | `wakeflow_initialize_workspace`, `wakeflow_replace_windows`, `wakeflow_register_window` |
| Demand and task state | `wakeflow_status`, `wakeflow_create_demand`, `wakeflow_claim_next`, `wakeflow_add_task`, `wakeflow_continue_demand`, `wakeflow_recover_state_transition`, `wakeflow_cancel_demand` |
| Candidate scan and explicit Pod lifecycle | `wakeflow_next_work`, `wakeflow_pod_open`, `wakeflow_pod_bind`, `wakeflow_pod_plan` (action design-request/test-access/close), `wakeflow_pod_record` (event materialization/design-handoff/test-access/close-receipt) |
| Delivery and returns | `wakeflow_prepare_delivery`, `wakeflow_record_delivery` |
| Results and review | `wakeflow_record_target_result`, `wakeflow_review_pack`, `wakeflow_reduce_results`, `wakeflow_decide_review`, `wakeflow_complete_demand` |
| Design and Test intake | `wakeflow_deliver`, `wakeflow_intake_test_card` |
| Archive, views, maintenance, and verification | `wakeflow_archive` (target demand/todo/docs/sanitize-demand), `wakeflow_view` (task-ledger/window/focus/trace/storage/progress/pods), `wakeflow_storage_preserve`, `wakeflow_prune_runtime`, `wakeflow_verify` |
| Host ownership and locks | `wakeflow_adopt_demand_host`, `wakeflow_release_window_lock` |

Public MCP tools are for outer agent workflows. Target closeout is
deliberately split: record a target result, review readiness, prepare a
controller-return envelope when policy allows, send through the tmux host
helper, and record delivery facts. Controller review stays split as review
pack, result reduction, and explicit decision; result reduction only creates a
review candidate and is not acceptance. Do not collapse those steps into a
single target-window MCP tool. Internal steps such as archive summary refresh
internals, keep-live state, and script backend execution stay inside Wakeflow
runtime scripts and skills. Public archive MCP tools wrap controller-approved
demand, TODO, and workspace-document archive flows. `wakeflow_archive`
with `target=sanitize-demand` only replaces an already archived demand with a privacy-clean copy and preserves
the original locally. `wakeflow_storage_preserve` is the dry-run-first public
route to the existing local artifact-preservation backend. With archive
redaction, opaque artifacts remain byte-for-byte in the local preserved
original while the portable archive carries a safe placeholder manifest,
unless clean opaque byte inclusion was explicitly authorized with
`allowOpaque`. A real host id inside a filename or directory name preserves that
highest sensitive file/subtree locally and represents it once at a
`redacted-id-N` portable path; matching text references use the same alias, and
path collisions still fail closed. None of these tools makes acceptance
decisions or sends host messages.

Migration note: pre-consolidation Pod stage calls now use
`wakeflow_pod_plan` for planning and `wakeflow_pod_record` for
receipts/handoffs. Progress projection uses `wakeflow_view scope=progress`,
public Pod inventory uses `wakeflow_view scope=pods`, and historical archive
repair uses `wakeflow_archive target=sanitize-demand`. The Claude helper CLI
commands `pod-open`, `pod-close`, and `pod-list` are unchanged.

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
| `.wakeflow-local/` | Machine-local thread registry, Pod operation/binding receipts, derived runtime views, and local state; ignored by Git. |
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
and child roots, and each demand has exactly one controller across hosts. The
public `wakeflow_create_demand` adopts the calling host; only raw state init
starts with `controllerHost: null` and waits for a first drive. Non-owning hosts
fail closed on controller mutations and dispatch preparation; `--adopt-host`
is the explicit transfer mechanism. `wakeflow_status` exposes
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
| `.claude-plugin/plugin.json` | Plugin metadata; its `mcpServers` field points at `.mcp.json`. |
| `.mcp.json` | MCP server wiring (`${CLAUDE_PLUGIN_ROOT}/bin/wakeflow-mcp`). |
| `bin/wakeflow-mcp` | Dependency-free MCP launcher. It honors `WAKEFLOW_NODE`, then checks `PATH` and supported local runtime locations before starting `mcp/server.cjs`. |
| `mcp/server.cjs` | Standalone MCP server entrypoint with no `node_modules` dependency. |
| `lib/` | MCP tool definitions, runtime helpers, process and trace support. |
| `scripts/` | Setup, state, delivery, intake, archive, validation, and CLI runtime shipped with the plugin. |
| `skills/` | Controller, target protocol, target craft, and governance manuals shipped with the plugin. |
| `commands/` | Slash command definitions for `/wakeflow:*`. |
| `templates/wakeflow-template-bundle.json` | Installed workspace starter documents and support surfaces, bundled for marketplace scan size. |
| `assets/` | Marketplace and plugin presentation assets. |

The repository root README explains the shared architecture; this README is
the Claude Code edition manual.

## Design Principles

1. **Judgment stays visible**: script output, status rows, and target backfill
   are review inputs, not acceptance.
2. **One demand, one state root**: JSON state and Markdown progress surfaces
   stay tied to the same demand.
3. **Prompts brief, packages contextualize, skills execute**: prompts carry
   bounded priority cues, the current target, and reading order; task packages own complete per-target
   context, requirement anchors retain original background, and installed
   skills own execution procedure.
4. **Repository boundaries matter**: each window owns its source, tests,
   commits, and review inputs.
5. **Automation moves work, not authority**: delivery proves that a prompt was
   sent, not that the result is complete.
6. **Local runtime stays local**: real session ids stay only in the local
   thread registry, and active runtime state never enters tracked
   documentation.
7. **Fresh support windows by default**: Design and Test are created as clear
   Wakeflow support surfaces unless the user explicitly maps existing ones.

Wakeflow exists to make multi-window agent work safe to resume, easy to
inspect, and hard to accept without controller review.
