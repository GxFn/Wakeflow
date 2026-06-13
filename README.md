<div align="center">

# Wakeflow

Unattended control loops for multi-window agent work.

[English](README.md) | [Simplified Chinese](README.zh-CN.md)

Wakeflow turns a local Codex or Claude Code workspace into a disciplined
controller system: one controller window, focused repository windows, explicit
state roots, compact direct-thread or direct-session delivery, and
evidence-based acceptance.

</div>

---

- [Why Wakeflow](#why-wakeflow)
- [Architecture](#architecture)
- [Install Wakeflow](#install-wakeflow)
- [Initialize A Workspace](#initialize-a-workspace)
- [What Wakeflow Creates](#what-wakeflow-creates)
- [Automation Semantics](#automation-semantics)
- [MCP Capability Surface](#mcp-capability-surface)
- [Runtime And Ledger Boundaries](#runtime-and-ledger-boundaries)
- [Dual-Host Workspaces](#dual-host-workspaces)
- [Marketplace Release](#marketplace-release)
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
- **Compact delivery**: direct-thread prompts wake the right window with a small
  envelope; the state root and skills hold the task details.
- **Evidence before acceptance**: target backfill is input, not a conclusion.
  The controller still reviews raw evidence before completing work.
- **Local-first runtime**: real thread ids live only in the local thread
  registry; window config is a derived sendability view, and active state stays
  out of tracked source.

Wakeflow is not a command launcher with nicer names. It is a reusable workflow
capability for keeping multi-window agent work legible, bounded, and resumable.

## Architecture

Wakeflow is three layers working together: a window fleet you can see, a
closed loop that moves the work, and a disk layout that survives restarts.
Both editions — Codex and Claude Code — run the same shared core; only the
transport differs (Codex host thread tools vs a tmux send helper).

### Layer 1 — the fleet (what you see)

Every Wakeflow window is a long-lived agent session pinned to one
responsibility. On Claude Code the fleet lives in one tmux session with live
status badges; on Codex the windows are host threads.

| Window | Role | Default reasoning effort (Claude Code) |
| --- | --- | --- |
| Controller | owns goals, dispatch, evidence review, acceptance | `max` |
| Design | clarifies requirements, compares options, prepares handoffs | `xhigh` |
| Repo windows | implement inside exactly one repository | `xhigh` |
| Test | real-scenario verification the repos cannot self-run | `xhigh` |

### Layer 2 — the loop (how work moves)

Work is organized into demands: one demand = one goal = one state root on
disk. Every demand moves through the same closed loop:

```text
 1 init       controller creates the demand state root            (unclaimed)
 2 claim      the first driving command binds it to ONE platform  (codex | claude)
 3 add task   a task package names the target window and scope
 4 dispatch   envelope written -> window LOCKED -> prompt delivered
 5 work       the target window executes inside its repository boundary
 6 result     TargetResultEnvelope lands with evidence refs -> lock released
 7 review     controller reads RAW evidence, then accepts / reworks / blocks
 8 complete   only when every task is accepted and no blockers remain
```

Two rules keep the loop honest: **prompts wake, state instructs** (the
delivered prompt only names window, task id, and state root; the task
definition lives in the state root and skills), and **backfill is input, not
acceptance** (the controller reviews raw evidence before any decision; a
blocked decision is always recoverable once new evidence arrives).

### Layer 3 — the ground (what's on disk)

```text
<workspace>/
  workspace.config.json          windows, roles, per-host knobs      committed
  AGENTS.md / CLAUDE.md          per-host controller gates           committed
  wakeflow-ledger/               durable designs, records, archives  committed
  .workspace-active/             demand state roots (layer 2)        local
  .workspace-local/wakeflow-delivery/                                local
    dispatch-packets/  delivery-envelopes/  delivery-runs/    transport records
    target-results/                                           evidence envelopes
    locks/                       one in-flight delivery per window, cross-host
    hosts/codex/                 codex thread registry  (host-scoped)
    hosts/claude-code/           claude session registry + tmux bindings
```

Rule of thumb: **business truth is host-neutral and shared; transport handles
are host-scoped and never leave `.workspace-local/`.**

### Who decides what (trust model)

Scripts and MCP tools create, validate, and record machine data; they never
accept work, widen scope, or decide product behavior. Target windows execute
exactly their dispatched package. The controller is the only acceptance
authority, and the user owns product decisions.

### Dual-host coexistence

One workspace may run both editions side by side: demands bind to one platform
at claim time (machine-enforced on every driving command), the shared
per-window lock serializes deliveries across hosts, and ownership moves only
through the explicit, audited `adopt-demand-host` transfer.

## Install Wakeflow

Wakeflow uses the same two-layer marketplace shape as Lark Remote: the
repository root is the development workspace, and the installable plugin
artifacts live under `plugins/`. The repository ships two host editions built
from one shared core:

| Host | Artifact | Catalog |
| --- | --- | --- |
| Codex | `plugins/codex-wakeflow/` | `.agents/plugins/marketplace.json` |
| Claude Code | `plugins/claude-code-wakeflow/` | `.claude-plugin/marketplace.json` |

Install the Claude Code edition from inside Claude Code:

```text
/plugin marketplace add GxFn/Wakeflow
/plugin install wakeflow@gxfn
```

The Claude Code edition is terminal-only: every Wakeflow window (controller
included) is a tmux-resident interactive `claude` session in the `wakeflow`
tmux server session, and a Wakeflow thread id is the window's Claude Code
session id (stable across resumes). See
[plugins/claude-code-wakeflow/README.md](plugins/claude-code-wakeflow/README.md)
for the full Claude Code guide.

Install the public Codex plugin artifact:

```bash
npx codex-marketplace add GxFn/Wakeflow/plugins/codex-wakeflow --plugin
```

For a pinned release after the matching tag exists:

```bash
npx codex-marketplace add https://github.com/GxFn/Wakeflow/tree/v0.5.5/plugins/codex-wakeflow --plugin
```

If the Codex dialog separates source, ref, and sparse path, use the repository
URL, the desired ref, and `plugins/codex-wakeflow` as the sparse path.

For local development, register this checkout as its own local marketplace:

```toml
[marketplaces.gxfn]
source_type = "local"
source = "/absolute/path/to/Wakeflow"

[plugins."wakeflow@gxfn"]
enabled = true

[plugins."wakeflow@gxfn".mcp_servers.wakeflow]
default_tools_approval_mode = "approve"
```

Wakeflow does not require an aggregate marketplace repository. A separate
catalog can still list Wakeflow for brand discovery, but that is not part of
the primary install or release path.

## Initialize A Workspace

Wakeflow is installed as a Codex or Claude Code plugin. A target workspace
does not need to contain Wakeflow source code. The expected target shape is:

```text
MyWorkspace/
  AGENTS.md or CLAUDE.md
  workspace.config.json
  .workspace-active/          # ignored active controller state
  .workspace-local/           # ignored thread registry and derived runtime
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

1. Codex calls `wakeflow_initialize_workspace` with `apply: false`.
2. Wakeflow returns directory facts and an `agentSelectionProtocol`.
3. Codex judges whether the workspace is clean or messy from those facts and
   user context.
4. For a clean workspace, Codex calls the tool again with explicit
   `repositories` mappings for the intended work windows.
5. For a messy workspace, Codex asks which directories are managed windows
   before writing. It must not use a broad discovered-directory import.
6. After user confirmation, Codex calls `wakeflow_initialize_workspace` with
   `apply: true`.
7. Codex creates the returned Codex threads, resets each thread title to the
   returned `displayTitle`, and passes each real thread id once to Wakeflow's
   local registration command. The thread registry is the only thread-id
   authority; window config is refreshed as a derived view.

In the Claude Code edition, the same preview/apply contract is used. The
returned launch plan is materialized by the tmux host helper instead of Codex
`create_thread`: each window is launched as an interactive `claude` session,
and the returned Claude Code session id is registered as the Wakeflow thread
id.

Design and Test are fresh support surfaces by default. Existing similarly named
directories such as `<Product>Design` or `<Product>Test` are treated as ordinary
directory facts unless the user explicitly maps them as Design/Test.

Wakeflow supports localized initialization. Pass `language: "zh"` for Chinese
workspaces, `language: "en"` for English workspaces, or `language: "auto"` when
there is no clear preference. Generated thread titles keep the window name at
the front so the important repository name remains visible in narrow sidebars.
New state-root progress documents and subsequent Unified Status renders also
use the selected interface language.

Controller and child windows can use Codex or Claude Code subagents to speed
up bounded code search, log triage, test localization, and evidence summaries.
Subagent output is evidence or advice only; controller review, dispatch, state
writes, and repository boundaries remain with the Wakeflow window that owns the
task.

## What Wakeflow Creates

Initialization writes only the surfaces needed for the confirmed workspace
boundary:

| Surface | Purpose |
| --- | --- |
| `AGENTS.md` | Parent controller gates and durable boundaries. |
| Child `AGENTS.md` access cards | Per-window responsibility and read paths. |
| `workspace.config.json` | Managed windows, repository paths, roles, and default language. |
| `.workspace-active/` | Active state roots, current indexes, progress docs, TODO projections, intake, and test cards. |
| `.workspace-local/` | Thread registry, direct-thread runtime, local overrides, and derived window config. |
| `wakeflow-ledger/` | Long-term project coordination records and archives. |
| `Design/` | Internal requirement-design workspace when no external Design repository is mapped. |
| `Test/` | Internal test coordination workspace when no external Test repository is mapped. |

Wakeflow also synchronizes `.gitignore` so only `.workspace-active/` and
`.workspace-local/` remain local runtime directories. It does not add product
repositories, Design/Test folders, ledgers, `.DS_Store`, or other user
workspace noise to `.gitignore`.

## Automation Semantics

Wakeflow automation is direct-thread delivery plus explicit result return.

Core rules:

- Real thread ids live only in the host-scoped local thread registry under
  `.workspace-local/wakeflow-delivery/hosts/<host>/thread-registry/`
  (`codex` or `claude-code`).
- Window config is derived from `workspace.config.json` plus thread-registry
  presence; it is not a second thread-id or window-semantics authority.
- Delivery prompts remain compact and human-readable.
- The host sends prompts through its transport boundary: Codex thread tools for
  Codex, and the tmux host helper for Claude Code. Wakeflow records the send
  and readback evidence.
- `group-ready` waits for the expected target results before a controller
  return.
- `per-target` can wake the controller once per target while still preserving a
  group snapshot.
- After a real send is recorded as sent with readback evidence, the controller
  turn stops. It does not sleep or poll in the same turn.
- Keep-live support is runtime assistance only. It is not task logic, transport
  authority, or acceptance evidence.
- Demand creation is host-neutral: `wakeflow_init_demand` writes
  `controllerHost: null`, so Codex and Claude Code can both create or import
  demand material without taking ownership.
- The first real driving command claims the demand for its platform by writing
  `controllerHost: "codex"` or `controllerHost: "claude-code"`.
- After a demand is owned by one host, the other host fails closed on
  controller mutations and dispatch preparation unless ownership is explicitly
  transferred with `--adopt-host`.
- `wakeflow_status` exposes demand ownership under `dualHost.demandOwnership`
  so mixed-host controllers can see which platform owns active work before
  acting.

Automation stops on final completion, hard gates, user stop, no eligible work,
missing evidence, blocked state, or any condition that requires controller or
user judgment.

## MCP Capability Surface

Wakeflow exposes only stable outer workflow contracts as MCP tools. Runtime
scripts remain the internal implementation and test surface; they are not
public tools just because they exist. A target closeout uses the same
direct-thread delivery model as controller dispatch: prepare an envelope, send
the prompt with the host thread tool, then record the delivery run.

Primary tool groups:

| Need | MCP tools |
| --- | --- |
| Setup and workspace discovery | `wakeflow_initialize_workspace` |
| Demand and task state | `wakeflow_status`, `wakeflow_init_demand`, `wakeflow_add_task`, `wakeflow_next_work` |
| Delivery and returns | `wakeflow_prepare_delivery`, `wakeflow_record_delivery` |
| Results and review | `wakeflow_record_target_result`, `wakeflow_review_pack`, `wakeflow_reduce_results`, `wakeflow_decide_review`, `wakeflow_complete_demand` |
| Design and Test intake | `wakeflow_intake_design_handoff`, `wakeflow_intake_test_card` |
| Archive, maintenance, and verification | `wakeflow_archive_todo`, `wakeflow_archive_workspace_docs`, `wakeflow_verify`, `wakeflow_trace_spine` |

Public MCP tools are for outer agent workflows. Target closeout is deliberately
split: record a target result, review readiness, prepare a controller-return
envelope when policy allows, send through the active host transport, and record
delivery evidence. Controller review stays split as review pack, result
reduction, and explicit decision; result reduction only creates a review
candidate and is not acceptance. Do not collapse those steps into a single
target-window MCP tool. Internal steps such as archive summary refresh internals,
keep-live state, and script backend execution stay inside Wakeflow JS/runtime
scripts and skills. Public archive MCP tools wrap only controller-approved TODO
or workspace document archive flows; they do not make acceptance decisions or
send host messages.

Wakeflow declares MCP tool annotations for every public tool: read-only tools
are marked read-only, write tools are local, non-destructive, and closed-world.
Codex approval policy is still controlled by the user's Codex config. For a
trusted local Wakeflow installation, the matching Codex server policy is:

```toml
[plugins."wakeflow@gxfn".mcp_servers.wakeflow]
default_tools_approval_mode = "approve"
```

## Runtime And Ledger Boundaries

Wakeflow keeps source, active runtime, and durable records separate:

| Path | Boundary |
| --- | --- |
| `skills/` | Reusable operating instructions installed with the plugin. |
| `scripts/` | Runtime implementation and validation scripts packaged by the plugin. |
| `templates/wakeflow-template-bundle.json` | Bundled starter state, Design/Test, and ledger skeletons expanded during setup. |
| `.workspace-active/` | Current active work in a target workspace; ignored by Git. |
| `.workspace-local/` | Machine-local thread registry, derived runtime views, and local state; ignored by Git. |
| `wakeflow-ledger/` | Project-specific durable records outside reusable Wakeflow source. |

The source repository tracks reusable Wakeflow capability. Product code,
project-specific active state, real thread ids, and derived local runtime
artifacts do not belong in Wakeflow source.

## Dual-Host Workspaces

One workspace may run the Codex and Claude Code Wakeflow editions side by
side. Shared business state stays host-neutral: `.workspace-active/`,
`wakeflow-ledger/`, and the shared delivery spine under
`.workspace-local/wakeflow-delivery/` (`dispatch-packets/`,
`dispatch-groups/`, `delivery-envelopes/`, `delivery-runs/`,
`target-results/`, and shared `locks/`).

Host-scoped runtime is separated per host:

- `.workspace-local/wakeflow-delivery/hosts/codex/{thread-registry,window-config,keep-live}/`
- `.workspace-local/wakeflow-delivery/hosts/claude-code/{thread-registry,window-config,window-host,keep-live}/`

`AGENTS.md` (Codex) and `CLAUDE.md` (Claude Code) may coexist at the
workspace and child roots. Each demand still has exactly one controller host:
creation is neutral, the first driving command claims ownership, non-owning
hosts fail closed, and `--adopt-host` is the explicit transfer mechanism.

## Marketplace Release

Wakeflow is packaged as a dual-host plugin source repository. The public
source of truth is:

```text
https://github.com/GxFn/Wakeflow.git
```

The repository carries separate host catalogs:

- `.agents/plugins/marketplace.json` points the Codex plugin entry at
  `./plugins/codex-wakeflow`.
- `.claude-plugin/marketplace.json` points the Claude Code plugin entry at
  `./plugins/claude-code-wakeflow`.

Publishing Wakeflow means tagging the repository and submitting the correct
nested artifact for the target host, not the development workspace root.

Before publishing a release tag:

1. Run `npm test` from this repository.
2. Run the host-specific plugin manifest validators where available.
3. Confirm `plugins/codex-wakeflow/.codex-plugin/plugin.json` has no more than
   three starter prompts.
4. Confirm both host catalogs point only at their nested plugin artifacts.
5. Confirm runtime scripts and installed skills contain no project-specific
   default controller names, product overlays, local paths, or private thread
   ids.
6. Tag the exact commit that the host marketplace should install.

## Working In This Repository

Use this repository to develop the Wakeflow plugin itself.

```sh
npm run sync:core    # copy core/ into both plugin artifacts
npm run check:core   # fail when an artifact drifts from core/
npm run validate     # codex artifact validation
npm run validate:claude
npm run smoke        # codex artifact smoke
npm run smoke:claude
npm run test:wakeflow
npm test             # check:core + both validates + both smokes + tests
```

Shared-core rule: host-neutral runtime files live in `core/` and are synced
into both artifacts with `tools/sync-core.mjs`; edit them in `core/`, never in
an artifact copy. Host-specific files (host profile, host artifact checks,
host send adapter, manifests, READMEs, memory-file template, skills, template
bundle) live only inside each artifact. `npm run check:core` keeps the copies
honest.

The split between shared business state and host-scoped runtime for
workspaces that run both editions is specified in
[docs/dual-host-workspace-storage.md](docs/dual-host-workspace-storage.md).

Common source areas:

| Path | Purpose |
| --- | --- |
| `core/` | Host-neutral runtime source of truth synced into both artifacts. |
| `tools/sync-core.mjs` | Core sync and drift check (`--check`). |
| `plugins/codex-wakeflow/.codex-plugin/plugin.json` | Codex plugin manifest and MCP wiring. |
| `plugins/claude-code-wakeflow/.claude-plugin/plugin.json` | Claude Code plugin manifest and MCP wiring. |
| `plugins/claude-code-wakeflow/scripts/lib/wakeflow-host-profile.mjs` | Claude Code host profile (tmux window model, CLAUDE.md, session vocabulary). |
| `plugins/codex-wakeflow/mcp/server.cjs` | Standalone MCP server entrypoint with no `node_modules` dependency. |
| `plugins/codex-wakeflow/bin/wakeflow-mcp.mjs` | Compatibility wrapper for the MCP server entrypoint. |
| `plugins/codex-wakeflow/scripts/` | Setup, state, delivery, intake, archive, validation, and CLI runtime shipped with the plugin. |
| `plugins/codex-wakeflow/skills/` | Controller, target, governance, and validation operating manuals shipped with the plugin. |
| `plugins/codex-wakeflow/templates/wakeflow-template-bundle.json` | Installed workspace starter documents and support surfaces, bundled for marketplace scan size. |
| `plugins/codex-wakeflow/assets/` | Marketplace and plugin presentation assets. |
| `test/` | Development-only regression tests kept outside the marketplace scan surface. |
| `docs/` | Development planning and architecture notes kept outside the plugin artifact. |

Detailed command references live in [scripts/README.md](plugins/codex-wakeflow/scripts/README.md).
The top-level README explains the system model; the script README is the
operator manual.

## Design Principles

1. **Judgment stays visible**: script output, status rows, and target backfill
   are evidence, not acceptance.
2. **One demand, one state root**: JSON state and Markdown progress surfaces
   stay tied to the same demand.
3. **Prompts wake, state instructs**: prompts should be compact; task detail
   belongs in state roots, task packages, and installed skills.
4. **Repository boundaries matter**: each window owns its source, tests,
   commits, and evidence.
5. **Automation moves work, not authority**: direct-thread delivery proves that
   a prompt was sent, not that the result is complete.
6. **Local runtime stays local**: real thread ids stay only in the local thread
   registry, and active runtime state never enters tracked documentation.
7. **Fresh support windows by default**: Design and Test are created as clear
   Wakeflow support surfaces unless the user explicitly maps existing ones.

Wakeflow exists to make unattended multi-window work safe to resume, easy to
inspect, and hard to fake.
