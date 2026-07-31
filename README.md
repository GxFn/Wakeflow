<div align="center">

# Wakeflow

A disciplined control loop for multi-window agent work — every step traced, every result proven.

[English](README.md) | [Simplified Chinese](README.zh-CN.md)

Wakeflow turns a local Codex or Claude Code workspace into a disciplined
controller system: a controller-owned loop for each active demand, focused repository windows, explicit
state roots, compact direct-thread or direct-session delivery, and
evidence-based acceptance. The controller runs this as a closed loop — plan, dispatch, collect evidence, review, decide, repeat — and records every step, so the whole run is auditable after the fact.

</div>

---

- [Why Wakeflow](#why-wakeflow)
- [Architecture](#architecture)
- [Install Wakeflow](#install-wakeflow)
- [Initialize A Workspace](#initialize-a-workspace)
- [Run Your First Demand](#run-your-first-demand)
- [What Wakeflow Creates](#what-wakeflow-creates)
- [Automation Semantics](#automation-semantics)
- [MCP Capability Surface](#mcp-capability-surface)
- [Runtime And Ledger Boundaries](#runtime-and-ledger-boundaries)
- [Dual-Host Workspaces](#dual-host-workspaces)
- [Marketplace Release](#marketplace-release)
- [Working In This Repository](#working-in-this-repository)
- [Design Principles](#design-principles)

## Why Wakeflow

Hand an agent fleet a real, multi-repository goal and come back later with the
three questions that matter: **what was actually done, what evidence proves
it, and what is still open?** Without a control layer the honest answer is a
pile of scattered prompts, copied status tables, unclear ownership, and
"looks done" — work that cannot be audited, resumed, or trusted.

Wakeflow is that missing control layer — one controller window drives focused
repository windows through an explicit, machine-checked loop, and every step
leaves a verifiable artifact on disk:

- **Controller-first judgment**: the parent workspace owns goals, boundaries,
  dispatch decisions, acceptance, TODO routing, and archive decisions.
- **One state root per demand**: task packages, target results, review
  candidates, decisions, and progress projections stay tied to the same demand.
- **Context-complete task packages**: each new package records one objective,
  anchored requirement references, boundaries, completion expectations,
  dependencies, and the repository commit decision; dispatch derives the
  required execution Skills from that package.
- **Acceptance-anchored implementation**: every new implementation package
  carries at least one controller-authored claim/probe/expected anchor; the
  target proves RED→GREEN and the controller independently verifies it.
- **Focused child windows**: each repository window works only inside its
  configured responsibility boundary.
- **Preview-gated compact delivery**: the controller reviews the resolved
  repository, task briefing, Skills, and exact prompt before a digest-matched
  apply can write the direct-thread envelope.
- **Evidence before acceptance**: target backfill is input, not a conclusion.
  The controller still reviews raw evidence before completing work.
- **Local-first runtime**: real thread ids live only in the local thread
  registry; window config is a derived sendability view, and active state stays
  out of tracked source.

What you get, concretely:

- **Auditable** — every dispatch, delivery, result, and decision is a JSON
  artifact tied into one trace spine; `wakeflow_view` (scope `trace`) replays
  who did what, on which evidence, at which state revision.
- **Resumable** — demands continue from their on-disk state roots. Codex
  threads and Claude Code conversations are rebound from host-local registered
  ids; after a machine reboot, Claude's tmux windows must be relaunched before
  those conversations resume. No conversation memory is state authority.
- **Hard to fake** — acceptance requires raw evidence that the reducers verify
  on disk (missing evidence refs fail closed); "the target said done" is never
  enough, and results never accept themselves.
- **Parallel without silent branching** — mainline is always the default.
  Only explicit user authority creates a Pod with independent Controller,
  Design, Test, and product sessions; within one demand each repo stays
  strictly one-window-one-package.
- **Safe by construction** — fail-closed guards on ownership, verified host
  bindings, locks, and archive redaction; real session ids never leave the
  local registry.

Wakeflow is not a command launcher with nicer names. It is a reusable workflow
capability for keeping multi-window agent work legible, bounded, and resumable.

## Architecture

Wakeflow is three layers working together: a window fleet you can see, a
closed loop that moves the work, and a disk layout that survives restarts.
Both editions — Codex and Claude Code — run the same host-neutral state,
delivery, and validation core. Their manifests, memory files, window lifecycle,
and transport remain host-specific (Codex host thread tools vs a tmux helper).

### Layer 1 — the fleet (what you see)

Every Wakeflow window is an agent session pinned to one responsibility. On
Claude Code the baseline fleet lives in the configured tmux session and each
demand pod has its own tmux session; on Codex the windows are host threads.

| Window | Role | Default reasoning effort (Claude Code) |
| --- | --- | --- |
| Controller | owns goals, dispatch, evidence review, acceptance | `max` |
| Design | clarifies requirements, redesigns non-bug outcome mismatches, prepares handoffs | `xhigh` |
| Repo windows | implement inside exactly one repository | `xhigh` |
| Test | after controller validation, explores only the approved real-environment boundary for hidden bugs | `xhigh` |

### Layer 2 — the loop (how work moves)

Work is organized into demands: one demand = one goal = one state root on
disk. Every demand moves through the same closed loop:

```text
 1 init       raw state init creates the demand root               (unclaimed)
 2 claim      public create, or first raw-state drive, binds host  (codex | claude)
 3 add task   a task package freezes target context and requirement anchors
 4 dispatch   preview -> digest-matched apply -> LOCK -> prompt delivered
 5 work       the target window executes inside its repository boundary
 6 result     TargetResultEnvelope lands with evidence refs -> lock released
 7 review     controller reads RAW evidence, then accepts / reworks / blocks
 8 complete   active required tasks accepted, replacement lineage valid, no blocker
```

Two rules keep the loop honest: **prompts brief, packages contextualize,
skills execute** (the bounded prompt carries the objective, highest-priority
completion/context/boundary cues, reading order, identity, and trace; the task
package owns complete context, requirement documents preserve background, and
Skills own procedure), and **backfill is input, not acceptance** (the
controller reviews raw evidence before any decision; a blocked decision is
always recoverable once new evidence arrives).

### Layer 3 — the ground (what's on disk)

```text
<workspace>/
  wakeflow.config.json          windows, roles, per-host knobs      committed
  AGENTS.md / CLAUDE.md          per-host controller gates           committed
  wakeflow-ledger/               durable designs, records, archives  committed
  .wakeflow-active/             demand state roots (layer 2)        local
  .wakeflow-local/wakeflow-delivery/                                local
    dispatch-packets/  delivery-envelopes/  delivery-runs/    transport records
    target-results/                                           evidence envelopes
    locks/                       one in-flight target delivery per window, cross-host
    hosts/codex/                 codex thread registry  (host-scoped)
    hosts/claude-code/           claude session registry + tmux bindings
    hosts/<host>/pod-*           pod plans, operations, bindings, access receipts
```

Rule of thumb: **business truth is host-neutral and shared; transport handles
are host-scoped and never leave `.wakeflow-local/`.**

### Who decides what (trust model)

Scripts and MCP tools create, validate, and record machine data; they never
choose acceptance, widen scope, or decide product behavior on their own. They
only persist an explicit controller decision. Target windows execute
exactly their dispatched package. The controller is the only acceptance
authority and must establish functional correctness before Test starts. Test
cannot invent goals, methods, or completion criteria; it only investigates the
approved environment boundary. The user owns product decisions.

### Dual-host coexistence

One workspace may run both editions side by side: demands bind to one platform
at claim time (machine-enforced on every driving command), the shared
per-window work lease serializes target deliveries across hosts (controller
returns use a separate send mutex), and ownership moves only
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
included) is a tmux-resident interactive `claude` session, and a Wakeflow
thread id is the window's Claude Code session id (stable across resumes).
Mainline remains the default. When the user explicitly requests a Pod, the
helper creates an independent Controller/Design/Test/product fleet; each
product session uses Claude's native `claude --worktree`, while Wakeflow only
plans and verifies the resulting receipt. Claude returns final session ids
synchronously (there is no Codex `clientThreadId` state), and Pod Test remains
blocked until direct-multi-root access to every bound product worktree is
validated. `wakeflow_pod_open mode=create` keeps the strict initial base gate;
the read-only `mode=resume` path later verifies the immutable binding and exact
registered session/cwd without rerunning that creation gate. Wakeflow applies
no numeric Pod limit. See
[plugins/claude-code-wakeflow/README.md](plugins/claude-code-wakeflow/README.md)
for the full Claude Code guide.

Install the public Codex plugin artifact:

```bash
npx codex-marketplace add GxFn/Wakeflow/plugins/codex-wakeflow --plugin
```

For a pinned release after the matching tag exists:

```bash
npx codex-marketplace add https://github.com/GxFn/Wakeflow/tree/v0.9.2/plugins/codex-wakeflow --plugin
```

If the Codex dialog separates source, ref, and sparse path, use the repository
URL, the desired ref, and `plugins/codex-wakeflow` as the sparse path.

The Codex edition keeps ordinary work on the initialized mainline fleet. For an
explicitly authorized Pod, `wakeflow_pod_open` emits a host-neutral launch plan:
Codex creates three independent local Controller/Design/Test threads and one
`environment.type=worktree` thread from each exact saved repository project.
Wakeflow journals an asynchronous Codex create by launch correlation; a
temporary `clientThreadId` is search/recovery evidence only and can never enter
the thread registry. Wakeflow binds verified cwd/Git receipts, requires a
validated direct-multi-root receipt before Pod Test dispatch, and logically
closes the Pod; Codex owns physical worktree lifecycle. An unavailable
mainline returns `mainline-unavailable` and is repaired rather than silently
replaced by a Pod. `wakeflow_pod_open mode=resume` is a read-only identity and
current-state check for an already-bound Pod; it never creates or rebinds a
thread/worktree.

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

> Naming: `wakeflow.config.json` is the canonical config name. A pre-rename
> workspace's `workspace.config.json` keeps working (read fallback); rename it
> with `git mv workspace.config.json wakeflow.config.json` when convenient —
> `check-workspace` reminds you.

```text
MyWorkspace/
  AGENTS.md or CLAUDE.md
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

1. Codex calls `wakeflow_initialize_workspace` with `apply: false`.
2. Wakeflow returns directory facts and an `agentSelectionProtocol`.
3. Codex judges whether the workspace is clean or messy from those facts and
   user context.
4. For a clean workspace, Codex calls the tool again with explicit
   `repositories` mappings for the intended work windows.
5. For a messy workspace, Codex asks which directories are managed windows
   before writing. It must not use a broad discovered-directory import.
6. After user confirmation for a fresh workspace, Codex calls
   `wakeflow_initialize_workspace` with `apply: true`.
7. Codex creates the returned Codex threads, resets each thread title to the
   returned `displayTitle`, and passes each real thread id once to Wakeflow's
   local registration command. The thread registry is the only thread-id
   authority; window config is refreshed as a derived view.

For an already initialized workspace, `wakeflow_initialize_workspace` is not a
general refresh button. It may write only after the user explicitly requests a
reset initialization; the apply call must set `resetInitialization: true`, pass
explicit `repositories`, reconfirm Design/Test mode, and must not use
`useDiscovered`. Heavy or stale windows use the replacement commands instead.

Command responsibilities stay separate:

| Need | Command | Responsibility |
| --- | --- | --- |
| First-time setup | `wakeflow_initialize_workspace` | Discover, confirm, write workspace config/docs/support surfaces, and return the full launch plan. |
| Explicit reset setup | `wakeflow_initialize_workspace` with `resetInitialization: true` | Reconfirm work directories, clean stale managed window cards/runtime for removed windows, and rewrite setup surfaces. |
| One heavy/stale window | `wakeflow_replace_windows` (pass `window`) | Return one replacement launch entry and local registration command; no workspace docs refresh. |
| Several heavy/stale windows | `wakeflow_replace_windows` | Return only the requested replacement entries and local registration commands; no unrelated window rewrites. |

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

## Run Your First Demand

The loop is the same on both hosts; only how you drive it differs.

**Claude Code (slash commands):**

1. `/wakeflow:init` — discover the workspace, confirm scope with you, write
   config/docs, and launch the tmux fleet. Watch with `tmux attach -t wakeflow`
   on the default socket, or `tmux -L <tmuxSocket> attach -t wakeflow` when a
   dedicated socket is configured.
2. Feed the goal to the Design window (or write the requirement yourself).
   Design clarifies it and calls `wakeflow_deliver` — the demand lands as a
   `pending-claim` row on the global TODO board with its design docs linked.
3. In the controller: `/wakeflow:status` to see the board, then claim it —
   `wakeflow_claim_next` (auto-claimable rows) or `wakeflow_create_demand`
   (explicit). This inits the state root and consumes the row; the controller
   confirms the plan and task packages with you before any dispatch.
4. `/wakeflow:dispatch` — prepare one envelope, deliver it in one step, record
   the accepted transport and independent readback status, then end the turn.
   The target window works inside its repository
   and its controller-return wakes the controller with evidence attached.
   If a send is accepted before the new turn becomes visible, only readback is
   retried within a bounded budget; pending visibility remains an observation
   for Agent judgment, not a send failure or authority to send twice.
5. `/wakeflow:review` — read the raw evidence behind the result, then record
   the decision: accept / rework / blocked / redesign.
   Ordinary rework redispatches the same task with a new dispatch group.
   Mainline redesign keeps the rejected task as history: after Design returns its
   handoff, the controller creates a new full-context implementation task in
   the product responsibility window with
   `replacesTargetTaskId`; accepting that replacement supersedes the old task
   and package explicitly.
   In 0.9.2 a Pod has exactly one frozen Design request/handoff generation;
   that sole request may be `initial-design`, `supplement`, or `redesign`. A
   different second generation remains blocked rather than overwriting the
   recorded handoff or falling back to mainline Design.
6. Repeat dispatch → review until every active required non-Test task is
   accepted (or has valid superseded lineage) and the
   controller has completed its own functional validation. Only then may the
   controller add/dispatch a confirmed Test card; Test follows the frozen goal,
   approved Test plan, `controllerSelfChecks`, allowed skills, setup policy,
   and attempt bound. A Test skill such as progressive-chain-validation is
   usable only when the card names it explicitly.
7. When every active required task is accepted and replacement lineage is valid, run
   `wakeflow_complete_demand` and `wakeflow_archive` close the story into the
   ledger. Demand archive dry-run reports real-id and absolute-path findings;
   use `redact: true` to commit a re-scanned portable copy while preserving the
   original locally.
   If a verified same-scope gap appears after completion but before archive,
   `wakeflow_continue_demand` preserves that completion and adds the
   first bug/supplement/authorized-optimization package. Archived history stays
   immutable; independent follow-up work uses a new demand.

**Codex (natural prompts):** the same loop through the same MCP tools —
"Use Wakeflow to initialize this workspace", "claim the next demand",
"dispatch the next package", "review the returned results", "complete and
archive the demand".

**Daily driving (Claude Code):**

| You want | Do |
| --- | --- |
| Enter the fleet | open a terminal; use `tmux attach -t wakeflow`, or add `-L <tmuxSocket>` when configured |
| See where everything is | `/wakeflow:status` |
| Push work forward | `/wakeflow:dispatch` |
| Judge returned work | `/wakeflow:review` |
| Health check / fix a stale window | `/wakeflow:check` · `/wakeflow:windows <name> --replace` |
| Hands-off mode (recorded consent) | `/wakeflow:unattended on` |
| A demand explicitly in parallel | ask the controller to open a Pod — independent Controller, Design, Test, and host-created product worktrees |

## What Wakeflow Creates

Initialization writes only the surfaces needed for the confirmed workspace
boundary:

| Surface | Purpose |
| --- | --- |
| `AGENTS.md` | Parent controller gates and durable boundaries. |
| Child `AGENTS.md` access cards | Per-window responsibility and read paths. |
| `wakeflow.config.json` | Managed windows, repository paths, roles, and default language. |
| `.wakeflow-active/` | Active state roots, current indexes, progress docs, TODO projections, intake, and test cards. |
| `.wakeflow-local/` | Thread registry, direct-thread runtime, host-scoped Pod operation/binding receipts, local overrides, and derived window config. |
| `wakeflow-ledger/` | Long-term project coordination records and archives. |
| `Design/` | Internal requirement-design workspace when no external Design repository is mapped. |
| `Test/` | Internal test coordination workspace when no external Test repository is mapped. |

Wakeflow also synchronizes `.gitignore` so only `.wakeflow-active/` and
`.wakeflow-local/` remain local runtime directories. It does not add product
repositories, Design/Test folders, ledgers, `.DS_Store`, or other user
workspace noise to `.gitignore`.

## Automation Semantics

Wakeflow automation is direct-thread delivery plus explicit result return.

Core rules:

- Real thread ids live only in the host-scoped local thread registry under
  `.wakeflow-local/wakeflow-delivery/hosts/<host>/thread-registry/`
  (`codex` or `claude-code`).
- Window config is derived from `wakeflow.config.json` plus thread-registry
  presence; it is not a second thread-id or window-semantics authority.
- Delivery prompts remain compact and human-readable.
- The host sends prompts through its transport boundary: Codex thread tools for
  Codex, and the tmux host helper for Claude Code. Wakeflow records the send
  and readback evidence.
- Accepted transport is the send-completion fact. Readback is an independent
  `confirmed` / `pending` / `unavailable` observation; it never authorizes a
  resend. A matching target result normally releases its target work lease.
  For send-failure recovery, only a proven rejection before send may release
  the exact matching delivery lease. Ambiguous outcomes preserve it for Agent
  judgment.
- `group-ready` waits for the expected target results before a controller
  return.
- `per-target` can wake the controller once per target while still preserving a
  group snapshot.
- After accepted transport is recorded as sent with its actual readback status, the controller
  turn stops. It does not sleep or poll in the same turn.
- Keep-live support is runtime assistance only. It is not task logic, transport
  authority, or acceptance evidence.
- Raw `wakeflow-state init` is host-neutral and writes `controllerHost: null`.
  The public `wakeflow_create_demand` wrapper immediately adopts the new root
  for the calling host; an independently imported raw root remains unclaimed
  until its first driving command.
- After a demand is owned by one host, the other host fails closed on
  controller mutations and dispatch preparation unless ownership is explicitly
  transferred with `--adopt-host`.
- `activeDemands` remains an observation. It does not impose a numeric
  admission limit or automatically select Pod placement. Ordinary/Auto Claim
  work waits while mainline is busy; only an explicit user authorization
  creates a Pod.
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
| Setup and window registration | `wakeflow_initialize_workspace`, `wakeflow_replace_windows`, `wakeflow_register_window` |
| Demand and task state | `wakeflow_status`, `wakeflow_create_demand`, `wakeflow_claim_next`, `wakeflow_add_task`, `wakeflow_continue_demand`, `wakeflow_recover_state_transition`, `wakeflow_cancel_demand` |
| Candidate scan and explicit Pod lifecycle | `wakeflow_next_work`, `wakeflow_pod_open`, `wakeflow_pod_bind`, `wakeflow_pod_plan` (design-request/test-access/close), `wakeflow_pod_record` (materialization/design-handoff/test-access/close-receipt) |
| Delivery and returns | `wakeflow_prepare_delivery`, `wakeflow_record_delivery` |
| Results and review | `wakeflow_record_target_result`, `wakeflow_review_pack`, `wakeflow_reduce_results`, `wakeflow_decide_review`, `wakeflow_complete_demand` |
| Design and Test intake | `wakeflow_deliver`, `wakeflow_intake_test_card` |
| Archive, views, maintenance, and verification | `wakeflow_archive` (target demand/todo/docs/sanitize-demand), `wakeflow_view` (task-ledger/window/focus/trace/storage/progress/pods), `wakeflow_storage_preserve`, `wakeflow_prune_runtime`, `wakeflow_verify` |
| Host ownership and locks | `wakeflow_adopt_demand_host`, `wakeflow_release_window_lock` |

Public MCP tools are for outer agent workflows. Target closeout is deliberately
split: record a target result, review readiness, prepare a controller-return
envelope when policy allows, send through the active host transport, and record
delivery evidence. Controller review stays split as review pack, result
reduction, and explicit decision; result reduction only creates a review
candidate and is not acceptance. Do not collapse those steps into a single
target-window MCP tool. Internal steps such as archive summary refresh internals,
keep-live state, and script backend execution stay inside Wakeflow JS/runtime
scripts and skills. Public archive MCP tools wrap controller-approved demand,
TODO, and workspace-document archive flows. `wakeflow_archive`
`target=sanitize-demand` only replaces an already archived demand with a
privacy-clean copy and preserves the original locally.
`wakeflow_storage_preserve` is the dry-run-first public route
to the existing local evidence-preservation backend. With archive redaction,
sensitive opaque evidence remains byte-for-byte in the local preserved original
while the portable archive carries a safe placeholder manifest. None of these
tools makes acceptance decisions or sends host messages.

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
| `.wakeflow-active/` | Current active work in a target workspace; ignored by Git. |
| `.wakeflow-local/` | Machine-local thread registry, Pod operation/binding receipts, derived runtime views, and local state; ignored by Git. |
| `wakeflow-ledger/` | Project-specific durable records outside reusable Wakeflow source. |

The source repository tracks reusable Wakeflow capability. Product code,
project-specific active state, real thread ids, and derived local runtime
artifacts do not belong in Wakeflow source.

## Dual-Host Workspaces

One workspace may run the Codex and Claude Code Wakeflow editions side by
side. Shared business state stays host-neutral: `.wakeflow-active/`,
`wakeflow-ledger/`, and the shared delivery spine under
`.wakeflow-local/wakeflow-delivery/` (`dispatch-packets/`,
`dispatch-groups/`, `delivery-envelopes/`, `delivery-runs/`,
`target-results/`, and shared `locks/`).

Host-scoped runtime is separated per host:

- `.wakeflow-local/wakeflow-delivery/hosts/codex/{thread-registry,window-config,keep-live}/`
- `.wakeflow-local/wakeflow-delivery/hosts/claude-code/{thread-registry,window-config,window-host,keep-live}/`

`AGENTS.md` (Codex) and `CLAUDE.md` (Claude Code) may coexist at the
workspace and child roots. Each demand still has exactly one controller host:
public creation adopts the calling host, raw state init remains neutral until
first drive, non-owning hosts fail closed, and `--adopt-host` is the explicit
transfer mechanism.

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
2. Run `npm run release:check` after the intended version is committed, tagged,
   and reflected by the local `origin/main` tracking ref. This independently
   checks version parity, exact shared-core sync, both dry-run package surfaces,
   the `main` branch, clean worktree, tag target, and remote-tracking target.
3. Run the host-specific plugin manifest validators where available.
4. Confirm `plugins/codex-wakeflow/.codex-plugin/plugin.json` has no more than
   three starter prompts.
5. Confirm both host catalogs point only at their nested plugin artifacts.
6. Confirm runtime scripts and installed skills contain no project-specific
   default controller names, product overlays, local paths, or private thread
   ids.
7. Tag the exact commit that the host marketplace should install.

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
npm run release:check # strict, independent pre-publish consistency check
```

Shared-core rule: host-neutral runtime files live in `core/` and are synced
into both artifacts with `tools/sync-core.mjs`; edit them in `core/`, never in
an artifact copy. Host-specific files (host profile, host artifact checks,
host send adapter, manifests, READMEs, memory-file template, skills, template
bundle) live only inside each artifact. `npm run check:core` keeps the copies
honest.

Current 0.9.2 Pod behavior and acceptance authority are documented in
[docs/wakeflow-host-managed-complete-pod-requirement-design-2026-07-31.md](docs/wakeflow-host-managed-complete-pod-requirement-design-2026-07-31.md).
The non-Pod hardening history is recorded in
[docs/wakeflow-hardening-design-compliance-2026-07-30.md](docs/wakeflow-hardening-design-compliance-2026-07-30.md).
The dual-edition flow and architecture deep dive are historical v0.7.x
snapshots, retained to explain evolution rather than current commands,
tool counts, prompt shape, or Pod ownership.

Common source areas:

| Path | Purpose |
| --- | --- |
| `core/` | Host-neutral runtime source of truth synced into both artifacts. |
| `tools/sync-core.mjs` | Core sync and drift check (`--check`). |
| `plugins/codex-wakeflow/.codex-plugin/plugin.json` | Codex plugin metadata; its `mcpServers` field points at `.mcp.json`. |
| `plugins/codex-wakeflow/.mcp.json` | Codex MCP process wiring. |
| `plugins/codex-wakeflow/bin/wakeflow-mcp` | Shared dependency-free launcher that selects Node.js 20+ without assuming the host exports `node` on `PATH`. |
| `plugins/claude-code-wakeflow/.claude-plugin/plugin.json` | Claude Code plugin metadata; its `mcpServers` field points at `.mcp.json`. |
| `plugins/claude-code-wakeflow/.mcp.json` | Claude Code MCP process wiring and workspace-root environment. |
| `plugins/claude-code-wakeflow/scripts/lib/wakeflow-host-profile.mjs` | Claude Code host profile (tmux window model, CLAUDE.md, session vocabulary). |
| `plugins/codex-wakeflow/mcp/server.cjs` | Standalone MCP server entrypoint with no `node_modules` dependency. |
| `plugins/codex-wakeflow/scripts/` | Setup, state, delivery, intake, archive, validation, and CLI runtime shipped with the plugin. |
| `plugins/codex-wakeflow/skills/` | Controller, target protocol, target craft, and governance manuals shipped with the plugin. |
| `plugins/codex-wakeflow/templates/wakeflow-template-bundle.json` | Installed workspace starter documents and support surfaces, bundled for marketplace scan size. |
| `plugins/codex-wakeflow/assets/` | Marketplace and plugin presentation assets. |
| `test/` | Development-only regression tests kept outside the marketplace scan surface. |
| `docs/` | Development planning and architecture notes kept outside the plugin artifact. |

Backend/source-maintenance command references live in
[scripts/README.md](plugins/codex-wakeflow/scripts/README.md). Installed
controllers use the MCP tools and skills rather than treating raw scripts as
their operator interface.

## Design Principles

1. **Judgment stays visible**: script output, status rows, and target backfill
   are evidence, not acceptance.
2. **One demand, one state root**: JSON state and Markdown progress surfaces
   stay tied to the same demand.
3. **Prompts brief, packages contextualize, skills execute**: prompts carry
   bounded priority cues, the current target, and reading order; task packages own complete per-target
   context, requirement anchors retain original background, and installed
   skills own execution procedure.
4. **Repository boundaries matter**: each window owns its source, tests,
   commits, and evidence.
5. **Automation moves work, not authority**: direct-thread delivery proves that
   a prompt was sent, not that the result is complete.
6. **Local runtime stays local**: real thread ids stay only in the local thread
   registry, and active runtime state never enters tracked documentation.
7. **Fresh support windows by default**: Design and Test are created as clear
   Wakeflow support surfaces unless the user explicitly maps existing ones.

Wakeflow exists to make multi-window agent work safe to resume, easy to
inspect, and hard to fake.
