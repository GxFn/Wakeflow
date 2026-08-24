<div align="center">

# Wakeflow

A disciplined control loop for multi-window agent work — every step traced, every result reviewable.

[English](README.md) | [Simplified Chinese](README.zh-CN.md)

Wakeflow turns a local Codex or Claude Code workspace into a disciplined
controller system: a controller-owned loop for each active demand, focused repository windows, explicit
state roots, compact direct-thread or direct-session delivery, and
controller-validated acceptance. The controller runs this as a closed loop — plan, dispatch, collect review inputs, independently validate, decide, repeat — and records every step, so the whole run is auditable after the fact.

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
three questions that matter: **what was actually done, what supports the claim,
what did the controller validate, and what is still open?** Without a control layer the honest answer is a
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
  target records its RED→GREEN mapping and the controller independently validates it.
- **Focused child windows**: each repository window works only inside its
  configured responsibility boundary.
- **Preview-gated compact delivery**: the controller reviews the resolved
  repository, task briefing, Skills, and exact prompt before a digest-matched
  apply can write the direct-thread envelope.
- **Review inputs before acceptance**: target backfill, logs, paths, and test
  summaries are inputs, not conclusions. Wakeflow checks structure and path
  locatability; the controller independently validates behavior before completing work.
- **Local-first runtime**: raw thread/session handles live only in typed
  host-local window bindings; redacted window-runtime files are projections,
  and active state stays out of tracked source.

What you get, concretely:

- **Auditable** — every dispatch, delivery, result, and decision is a JSON
  artifact tied into one trace spine; `wakeflow_view operation=result-trace` replays
  who reported what, which review inputs were attached, and which decision was
  recorded at each state revision.
- **Resumable** — demands continue from their on-disk state roots. Codex
  threads and Claude Code conversations are rebound from host-local registered
  ids; after a machine reboot, Claude's tmux windows must be relaunched before
  those conversations resume. No conversation memory is state authority.
- **Hard to skip review** — reducers fail closed when required target inputs or
  declared artifact paths are missing, but they do not certify truth. "The target
  said done" is never enough; only the controller can independently validate and accept.
- **Parallel without silent branching** — mainline is always the default.
  Only explicit user authority creates a Pod with independent Controller,
  Design, Test, and product sessions; within one demand each repo stays
  strictly one-window-one-package.
- **Safe by construction** — fail-closed guards on typed identity, verified
  host bindings, leases, and archive privacy; raw session handles never leave
  their host-local binding owner.

Wakeflow is not a command launcher with nicer names. It is a reusable workflow
capability for keeping multi-window agent work legible, bounded, and resumable.

## Architecture

Wakeflow is three layers working together: a window fleet you can see, a
closed loop that moves the work, and a disk layout that survives restarts.
Both editions — Codex and Claude Code — run the same host-neutral state,
delivery, and validation core. Their manifests, memory files, window lifecycle,
and transport remain host-specific (Codex host thread tools vs the fenced v3
Claude tmux adapter).

### Layer 1 — the fleet (what you see)

Every Wakeflow window is an agent session pinned to one responsibility. The v3
Claude activation owner materializes exact launch intents into tmux sessions;
each demand Pod has its own container. On Codex the windows are host threads.

| Window | Role | Default reasoning effort (Claude Code) |
| --- | --- | --- |
| Controller | owns goals, dispatch, independent validation, acceptance | `max` |
| Design | clarifies requirements, redesigns non-bug outcome mismatches, prepares handoffs | `xhigh` |
| Repo windows | implement inside exactly one repository | `xhigh` |
| Test | after controller validation, explores only the approved real-environment boundary for hidden bugs | `xhigh` |

### Layer 2 — the loop (how work moves)

Work is organized into demands: one demand = one goal = one state root on
disk. Every demand moves through the same closed loop:

```text
 1 intake     optional Design delivery appends one exact pending TODO row
 2 publish    create-demand publishes the revision-1 root and exact initial authority
              and atomically claims its linked TODO row when present
 3 add task   a task package freezes target context and requirement anchors
 4 dispatch   preview -> digest-matched apply -> claim -> fenced host effect
 5 work       the target window executes inside its repository boundary
 6 result     one strict TargetResult lands with declared review-input refs -> lock released
 7 review     controller inspects inputs + independently validates, then decides
 8 complete   active required tasks accepted, replacement lineage valid, no blocker
```

`wakeflow_claim_next operation=claim` is only a standalone TODO-row CAS. It
does not initialize a demand, and it cannot safely precede the root-first demand
publication owner. Normal v3 creation therefore uses `wakeflow_create_demand`
to publish the root and claim the exact linked row in one recoverable operation.

Two rules keep the loop honest: **prompts brief, packages contextualize,
skills execute** (the bounded prompt carries the objective, highest-priority
completion/context/boundary cues, reading order, identity, and trace; the task
package owns complete context, requirement documents preserve background, and
Skills own procedure), and **backfill is input, not acceptance** (the
controller inspects the target's raw materials and independently validates the
relevant behavior before any decision; a blocked decision is always recoverable
once new review inputs arrive).

### Layer 3 — the ground (what's on disk)

```text
<workspace>/
  wakeflow.config.json          windows, roles, per-host knobs      committed
  AGENTS.md / CLAUDE.md          per-host controller gates           committed
  wakeflow-ledger/               durable designs, records, archives  committed
  .wakeflow-active/current/<demandId>/                              local
    demand/state/events/task-packages/results/review/evidence  active authority
  .wakeflow-local/                                                local
    audit/preserved/<preservationId>/                         typed audit holds
    runtime/maintenance/transactions/                         mutation journals
    runtime/shared/coordination/window-leases/                cross-host leases
    runtime/shared/transport/demands/<demandId>/               groups/packets/envelopes/runs
    runtime/hosts/<host>/identity/window-bindings/             private host handles
    runtime/hosts/<host>/projections/window-runtime/           redacted projections
    runtime/hosts/<host>/{evidence,operations}/                Pod/keep-live host facts
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

One workspace may run both editions side by side. Demand/business authority is
host-neutral; an exact current window binding and transport lineage select the
host for each operation, while shared typed window leases serialize target
delivery across hosts. There is no public demand-host transfer state machine.
Unknown or host-wide activation coverage blocks unattended activation instead
of being guessed or recorded in a global workspace registry.

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

The Claude Code edition uses tmux-resident interactive `claude` sessions, and a
Wakeflow thread id is the exact bound Claude Code session id. Mainline remains
the default. When the user explicitly requests a Pod, core freezes
host-neutral materialization operations; the v3 Claude Pod adapter may execute
only those exact operations, including native `claude --worktree` product
sessions, and returns typed observations/receipts. If the current facade or its
exact owner is unavailable, the operation remains blocked; retired public-v2
commands are not substitutes. Pod Test remains blocked until direct-multi-root access to every
bound product worktree is validated. `wakeflow_pod_open
operation=launch-preview/launch-apply` keeps the strict initial base gate; the
read-only `operation=inspect-materialization` later observes the immutable
binding and exact registered session/cwd without rerunning creation. Wakeflow
applies no numeric Pod limit. See
[plugins/claude-code-wakeflow/README.md](plugins/claude-code-wakeflow/README.md)
for the full Claude Code guide.

Install the public Codex plugin artifact:

```bash
npx codex-marketplace add GxFn/Wakeflow/plugins/codex-wakeflow --plugin
```

For a pinned release after the matching tag exists:

```bash
npx codex-marketplace add https://github.com/GxFn/Wakeflow/tree/v0.9.6/plugins/codex-wakeflow --plugin
```

If the Codex dialog separates source, ref, and sparse path, use the repository
URL, the desired ref, and `plugins/codex-wakeflow` as the sparse path.

The Codex edition keeps ordinary work on the initialized mainline fleet. For an
explicitly authorized Pod, `wakeflow_pod_open` emits host-neutral launch intents:
Codex creates three independent local Controller/Design/Test threads and one
`environment.type=worktree` thread from each exact saved repository project.
Wakeflow journals an asynchronous Codex create by launch correlation; a
temporary `clientThreadId` is search/recovery evidence only and can never enter
the typed final window binding. Wakeflow binds verified cwd/Git receipts and
requires a validated direct-multi-root receipt before Pod Test dispatch. Codex
owns physical worktree lifecycle, and archiving a Codex thread is not machine
proof of irreversible revocation: Pod close remains `manual-host-gate`, produces
no machine-verified close receipt, and does not authorize automatic Pod archive
or transport prune. An unavailable
mainline returns `mainline-unavailable` and is repaired rather than silently
replaced by a Pod. `wakeflow_pod_open operation=inspect-materialization` is a read-only identity and
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

> `wakeflow.config.json` is the only normal public-v3 config authority. Legacy
> names and schemas are accepted only by the explicitly invoked, unregistered
> migration bootstrap; normal MCP/CLI never falls back to them.

```text
MyWorkspace/
  AGENTS.md or CLAUDE.md
  wakeflow.config.json
  .wakeflow-active/          # ignored active controller state
  .wakeflow-local/           # ignored audit + shared/host runtime
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

1. Codex builds one explicit selection split into `program`, `topology`,
   `storage`, `governance`, and `hosts`. Repository, support-surface, and window
   entries are connected with request-local `selectionKey` values; Wakeflow
   allocates the durable typed IDs.
2. Codex calls `wakeflow_maintain_workspace` with
   `action: "fresh-initialize"`, `mode: "preview"`, and that closed selection.
   Preview is read-only.
3. Codex reviews the returned blockers, `confirmedActionPlan`,
   `confirmedActionPlanDigest`, and `launchIntents`. Any unclear legacy or
   foreign ownership remains blocked instead of being broadly imported.
4. After the user confirms the write boundary, Codex calls the same tool with
   `mode: "apply"`, the exact confirmed plan, and its returned digest.
5. After apply succeeds, Codex executes only the retained launch intents,
   resets each thread title to `displayTitle`, and calls
   `wakeflow_register_window` once for each real thread id. Raw host handles
   remain private; the host-local binding is the identity authority and window
   runtime files are projections.

An initialized v3 workspace is never refreshed by replaying fresh setup. Use
`action: "reconfigure"` for an intentional complete desired-model change and
`action: "reconcile"` to restore managed bytes or projections from current v3
authority; both are preview-before-apply. Use `wakeflow_replace_windows` only
for stale host bindings. Legacy migration is not a normal MCP/CLI action: when
explicitly requested, it uses the exact artifact's unregistered
`bin/wakeflow-bootstrap` preview/apply/recover protocol.

Command responsibilities stay separate:

| Need | Command | Responsibility |
| --- | --- | --- |
| First-time setup | `wakeflow_maintain_workspace`, action `fresh-initialize` | Preview one explicit selection, then atomically apply the exact confirmed owner plan. |
| Intentional model change | `wakeflow_maintain_workspace`, action `reconfigure` | Preview a complete desired v3 model and apply only the reviewed delta. |
| Repair from current authority | `wakeflow_maintain_workspace`, action `reconcile` | Rebuild managed bytes/projections without changing the desired model. |
| One heavy/stale window | `wakeflow_replace_windows` (pass `window`) | Return one replacement launch entry and local registration command; no workspace docs refresh. |
| Several heavy/stale windows | `wakeflow_replace_windows` | Return only the requested replacement entries and local registration commands; no unrelated window rewrites. |

In the Claude Code edition, the same preview/apply contract is used. The
returned `launchIntents` remain host-neutral until the v3 Claude activation
owner materializes them and registers each final session id. If that owner is
unavailable, activation stops; a legacy helper cannot create substitute
bindings or transport facts.

Design and Test are fresh support surfaces by default. Existing similarly named
directories such as `<Product>Design` or `<Product>Test` are treated as ordinary
directory facts unless the user explicitly maps them as Design/Test.

Wakeflow supports localized initialization. Pass `language: "zh"` for Chinese
workspaces, `language: "en"` for English workspaces, or `language: "auto"` when
there is no clear preference. Generated thread titles keep the window name at
the front so the important repository name remains visible in narrow sidebars.
New and regenerated demand-progress projections also use the selected
interface language.

Controller and child windows can use Codex or Claude Code subagents to speed
up bounded code search, log triage, test localization, and input summaries.
Subagent output is review input or advice only; controller validation, dispatch, state
writes, and repository boundaries remain with the Wakeflow window that owns the
task.

## Run Your First Demand

The loop is the same on both hosts; only how you drive it differs.

**Claude Code (slash commands):**

1. `/wakeflow:init` — build an explicit selection, preview the exact
   fresh-initialize plan, wait for confirmation, and apply it. Host-neutral
   launch intents are activated only through the v3 Claude seam; if it is
   unavailable or activation coverage is unknown/host-wide, initialization
   reports the blocker instead of writing legacy runtime facts.
2. Feed the goal to the Design window (or write the requirement yourself).
   Design clarifies it and calls `wakeflow_deliver` — the demand lands as a
   `pending-claim` row on the global TODO board. Append validates the exact row
   and board CAS; it does not resolve `Documents` or create demand authority.
   The controller may instead create bounded or already documented work
   directly, but it uses the same demand-type contract; this is not a lighter
   second format.
3. In the controller: `/wakeflow:status` to inspect the board, resolve the
   submitted references, then call `wakeflow_create_demand` preview/apply. If
   any TaskPackage will be needed, the complete authority must be part of this
   initial publication because public v3 cannot add it later. A TODO-backed
   publication claims the exact row inside the same recoverable root-first
   operation. `Auto Claim` controls unattended selection timing only; the
   standalone `wakeflow_claim_next` row mutation is not a demand initializer.
4. `/wakeflow:dispatch` — preview and apply immutable transport, acquire the
   exact lease with `target-claim`, execute the fenced host effect, and record
   every transport/readback field explicitly before ending the turn.
   The target window works inside its repository
   and its controller-return wakes the controller with result materials attached.
   If accepted transport is not visible in that observation, it is recorded as
   `sent-unconfirmed`: it prevents resend but does not claim destination
   reachability or trigger another automatic read.
5. `/wakeflow:review` — inspect the target-authored inputs, independently
   validate the relevant behavior, then record the decision: accept / rework /
   blocked / redesign.
   Ordinary rework redispatches the same task with a new dispatch group.
   Mainline redesign keeps the rejected task as history: after Design returns its
   handoff, the controller creates a new full-context implementation task in
   the product responsibility window with
   `replacesTargetTaskId`; accepting that replacement supersedes the old task
   and package explicitly.
   The current implementation gives a Pod exactly one frozen Design request/handoff generation;
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
   If Test then proves a product defect after the owning product lineage is
   already accepted, preserve the reproduction and stop with a remediation
   capability blocker: current public v3 cannot reopen that accepted lineage or
   create a same-demand product fix before completion.
7. When every active required task is accepted and replacement lineage is
   valid, use `wakeflow_complete_demand operation=preview/apply`, then
   `wakeflow_archive operation=preview/apply` to create one portable whole-
   demand `BusinessArchive` after the lifecycle, Pod-close, transport, and
   privacy gates close. Machine-local preserved bytes remain separate audit
   holds and never become archive authority.
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
| Inspect Claude windows | `/wakeflow:windows`; terminal/tmux views are operator observations, not identity authority |
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
| `wakeflow.config.json` | Typed program identity plus topology, storage, governance, and host policy. |
| `.wakeflow-active/` | Current demand/business authority, immutable artifacts/events, TODO authority, and generated progress projections. |
| `.wakeflow-local/` | Typed audit holds plus shared/host runtime: bindings, leases, transport, Pod evidence, keep-live data, projections, and mutation journals. |
| `wakeflow-ledger/` | Durable program indexes and portable whole-demand BusinessArchives. |
| `Design/` | Internal requirement-design workspace when no external Design repository is mapped. |
| `Test/` | Internal test coordination workspace when no external Test repository is mapped. |

Wakeflow also synchronizes `.gitignore` so only `.wakeflow-active/` and
`.wakeflow-local/` remain local runtime directories. It does not add product
repositories, Design/Test folders, ledgers, `.DS_Store`, or other user
workspace noise to `.gitignore`.

## Automation Semantics

Wakeflow automation is direct-thread delivery plus explicit result return.

Core rules:

- Raw thread/session handles live only in typed records under
  `.wakeflow-local/runtime/hosts/<host>/identity/window-bindings/`.
- Window-runtime files under the same host's `projections/` are redacted
  derived views; they are not identity, handle, or topology authority.
- Delivery prompts remain compact and human-readable.
- The host sends prompts through its fenced transport boundary: Codex thread
  tools for Codex and the v3 stable-window tmux adapter for Claude Code.
  Wakeflow records the send and readback evidence; a legacy helper cannot
  produce v3 transport authority.
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
- Only confirmed readback proves the destination was reached. Accepted
  transport with pending/unavailable readback is exposed as `sent-unconfirmed`;
  the turn stops without polling or automatic resend.
- Keep-live support is runtime assistance only. It is not task logic, transport
  authority, or acceptance evidence.
- Demand/business authority is host-neutral. Host choice comes from the exact
  current binding and strict group/packet/envelope chain; no caller may adopt a
  demand or override internal paths.
- Shared typed window leases serialize target effects across hosts. Historical
  envelopes/results never release a successor lease.
- Active-demand counts remain observations, not numeric admission policy.
  Ordinary work waits while mainline is busy; only explicit user authority
  creates a Pod.
- Unattended host activation requires known workspace-only coverage. Unknown or
  host-wide coverage stays behind a manual host gate; Wakeflow creates no
  global workspace registry.

Automation stops on final completion, hard gates, user stop, no eligible work,
missing review inputs, blocked state, or any condition that requires controller or
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
| Workspace maintenance and window identity | `wakeflow_maintain_workspace`, `wakeflow_replace_windows`, `wakeflow_register_window` |
| Demand and task state | `wakeflow_status`, `wakeflow_create_demand`, standalone TODO CAS `wakeflow_claim_next`, `wakeflow_add_task`, `wakeflow_continue_demand`, `wakeflow_recover_state_transition`, `wakeflow_cancel_demand` |
| Candidate scan and explicit Pod lifecycle | `wakeflow_next_work`, `wakeflow_pod_open`, `wakeflow_pod_bind`, `wakeflow_pod_plan` (design-request/test-access/close), `wakeflow_pod_record` (materialization/design-handoff/test-access/close-receipt) |
| Delivery and returns | `wakeflow_prepare_delivery`, `wakeflow_record_delivery` |
| Results and review | `wakeflow_record_target_result`, `wakeflow_review_pack`, `wakeflow_reduce_results`, `wakeflow_decide_review`, `wakeflow_complete_demand` |
| Design and Test intake | `wakeflow_deliver`, `wakeflow_intake_test_card` |
| Evidence, archive, views, storage, and verification | `wakeflow_record_evidence`, `wakeflow_archive`, `wakeflow_view`, `wakeflow_storage_preserve`, `wakeflow_prune_runtime`, `wakeflow_verify` |
| Exact target lease release | `wakeflow_release_window_lock` |

Public MCP tools are for outer agent workflows. Target closeout is deliberately
split: record a target result, review readiness, prepare a controller-return
envelope when policy allows, send through the active host transport, and record
delivery facts. Controller review stays split as review pack, result
reduction, and explicit decision; result reduction only creates a review
candidate and is not acceptance. Do not collapse those steps into a single
target-window MCP tool. Internal keep-live state and backend execution stay
inside Wakeflow runtime owners and skills. `wakeflow_archive` has only
`preview/apply/inspect/recover`: it creates one portable whole-demand
`BusinessArchive` after lifecycle, Pod-close, transport, and privacy gates
close. The old TODO/docs/sanitize subroutes are not public v3 compatibility
aliases. `wakeflow_storage_preserve` separately owns typed machine-local audit
holds through inspect/preview/apply/recover; preserved bytes never become
business-state authority. None of these tools makes acceptance decisions or
sends host messages.

Wakeflow declares MCP tool annotations for every public tool. Read-only tools
are marked read-only; all tools are closed-world and idempotent. A tool's
`destructiveHint` reflects the strongest operation it exposes, so maintenance,
replacement, exact lease release, local preservation, archive, Pod binding, and
runtime prune are correctly marked destructive-capable. An annotation is a
client hint, not write authorization. Codex approval policy is still controlled
by the user's Codex config. For a
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
| `templates/wakeflow-asset-bundle.json` | Generated carrier for the two localized demand-progress projection assets authored under `core/template-sources/`. |
| `.wakeflow-active/` | Current active work in a target workspace; ignored by Git. |
| `.wakeflow-local/` | Machine-local audit preservation plus shared/host runtime authority and projections: bindings, leases, transport, Pod evidence, keep-live state, and maintenance journals; ignored by Git. |
| `wakeflow-ledger/` | Project-specific durable records outside reusable Wakeflow source. |

The source repository tracks reusable Wakeflow capability. Product code,
project-specific active state, real thread ids, and derived local runtime
artifacts do not belong in Wakeflow source.

## Dual-Host Workspaces

One workspace may run the Codex and Claude Code Wakeflow editions side by
side. Shared business state stays host-neutral in `.wakeflow-active/` and
`wakeflow-ledger/`; shared runtime coordination and transport live under
`.wakeflow-local/runtime/shared/{coordination,transport}/`.

Host-scoped runtime is separated per host:

- `.wakeflow-local/runtime/hosts/codex/{identity,projections,evidence,operations}/`
- `.wakeflow-local/runtime/hosts/claude-code/{identity,projections,evidence,operations}/`

`AGENTS.md` (Codex) and `CLAUDE.md` (Claude Code) may coexist at workspace and
child roots. Each physical operation uses the exact current host binding and
strict transport ancestry. Shared leases prevent cross-host target overlap;
there is no demand-host adoption alias.

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

Current Pod behavior and acceptance authority are documented in
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
| `tools/build-legacy-origin-fixtures.mjs` | Preview or create one self-contained historical-origin fixture from explicitly materialized local artifact and before/after trees; request is stdin JSON and writes require `--write`. |
| `plugins/codex-wakeflow/.codex-plugin/plugin.json` | Codex plugin metadata; its `mcpServers` field points at `.mcp.json`. |
| `plugins/codex-wakeflow/.mcp.json` | Codex MCP process wiring. |
| `plugins/codex-wakeflow/bin/wakeflow-mcp` | Shared dependency-free launcher that selects Node.js 20+ without assuming the host exports `node` on `PATH`. |
| `plugins/claude-code-wakeflow/.claude-plugin/plugin.json` | Claude Code plugin metadata; its `mcpServers` field points at `.mcp.json`. |
| `plugins/claude-code-wakeflow/.mcp.json` | Claude Code MCP process wiring and workspace-root environment. |
| `plugins/claude-code-wakeflow/scripts/lib/wakeflow-host-profile.mjs` | Claude Code host profile (tmux window model, CLAUDE.md, session vocabulary). |
| `plugins/codex-wakeflow/mcp/server.cjs` | Standalone MCP server entrypoint with no `node_modules` dependency. |
| `plugins/codex-wakeflow/scripts/` | Setup, state, delivery, intake, archive, validation, and CLI runtime shipped with the plugin. |
| `plugins/codex-wakeflow/skills/` | Controller, target protocol, target craft, and governance manuals shipped with the plugin. |
| `core/template-sources/` | Canonical authoring source for the two localized demand-progress projection assets. |
| `plugins/codex-wakeflow/templates/wakeflow-asset-bundle.json` | Deterministically generated install carrier for those templates; never hand-edited. |
| `plugins/codex-wakeflow/assets/` | Marketplace and plugin presentation assets. |
| `test/` | Development-only regression tests kept outside the marketplace scan surface. |
| `docs/` | Development planning and architecture notes kept outside the plugin artifact. |

Backend/source-maintenance command references live in
[scripts/README.md](plugins/codex-wakeflow/scripts/README.md). Installed
controllers use the MCP tools and skills rather than treating raw scripts as
their operator interface.

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
5. **Automation moves work, not authority**: direct-thread delivery proves that
   a prompt was sent, not that the result is complete.
6. **Local runtime stays local**: real thread ids stay only in the local thread
   registry, and active runtime state never enters tracked documentation.
7. **Fresh support windows by default**: Design and Test are created as clear
   Wakeflow support surfaces unless the user explicitly maps existing ones.

Wakeflow exists to make multi-window agent work safe to resume, easy to
inspect, and hard to accept without controller review.
