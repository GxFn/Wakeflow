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
- **Local-first runtime**: raw session ids live only in typed host-local window
  bindings; redacted window-runtime files are projections, and active state
  stays out of tracked source.

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
| no badge | idle, or a delivery quietly in flight (strict status and typed host projections report machine facts when needed) |

| Window | Role | Default reasoning effort |
| --- | --- | --- |
| Controller | owns goals, dispatch, independent validation, acceptance | `max` |
| Design | clarifies requirements, redesigns non-bug outcome mismatches, prepares handoffs | `xhigh` |
| Repo windows | implement inside exactly one repository | `xhigh` |
| Test | after controller validation, explores only the approved real-environment boundary for hidden bugs | `xhigh` |

Inside every pane a seeded statusline shows the live serving model and the
window identity in plain text. tmux windows do not survive a machine reboot.
Fresh and replacement setup return host-neutral launch intents; only the v3
Claude activation owner may materialize them and register the resulting exact
session handle. Pod inspection is separate:
`operation=inspect-materialization` observes only an existing exact binding at
its recorded cwd, while current product/main HEAD and dirty state remain
observations rather than recovery gates.

### Layer 2 — the loop (how work moves)

Work is organized into demands: one demand = one goal = one state root on
disk. Every demand moves through the same closed loop:

```text
 1 create     public create publishes the demand root + authority  (unclaimed)
 2 claim      exact TODO claim or explicit create binds controller (codex | claude)
 3 add task   a task package freezes target context and requirement anchors
 4 dispatch   preview -> digest-matched apply -> LOCK -> prompt pasted
 5 work       the target window executes inside its repository boundary
 6 result     strict TargetResult lands with typed evidence locators -> lock released
 7 review     controller inspects inputs + independently validates, then decides
 8 complete   active required tasks accepted, replacement lineage valid, no blocker
```

These rules keep the loop honest:

- **One demand authority, regardless of who creates it.** Design is the default
  author for substantial new product behavior; the controller may create
  bounded or already-documented work directly only with the same proportional
  anchored inputs. Whenever any TaskPackage will be needed, the initial
  `wakeflow_create_demand` publication includes them as
  `demand-authority.json`; public v3 cannot add authority later. A no-authority
  demand therefore cannot later acquire a TaskPackage. `Auto Claim` changes
  claim timing only.
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
  exact `replacesTargetTask` task/package tuple after the Design handoff.
  Accepting that replacement
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
  .wakeflow-active/current/<demandId>/                                   local
    demand/state/events/task-packages/results/review/evidence       active authority
  .wakeflow-local/                                                     local
    audit/preserved/<preservationId>/                              typed audit holds
    runtime/maintenance/transactions/                              mutation journals
    runtime/shared/{coordination,transport}/                       leases + transport
    runtime/hosts/<host>/{identity,projections,evidence,operations}/ host runtime
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

The same workspace can run both editions side by side. Demand/business
authority stays host-neutral; the exact current binding and transport lineage
select the host for each operation, while shared typed leases serialize target
delivery. There is no public demand-host transfer state machine. Unknown or
host-wide activation coverage remains behind a manual host gate.

## Install Wakeflow

> Platform support: the Claude host seam is macOS-first and tmux-backed. A
> terminal attachment is an operator observation only; it is never binding,
> delivery, close, or recovery authority. Legacy helper preflight and socket
> fields are not public-v3 configuration or execution contracts.


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
| Claude host seam | `scripts/lib/wakeflow-claude-host.mjs` is the current closed v3 facade. Its exact commands delegate lifecycle, transport, settings/activity, Pod, activation-scope, and decommission to typed owners; it owns no second registry or transport state. |

## Quick Start

Three steps to initialize and inspect the strict v3 core. Host activation is a
separate seam and must never be simulated with legacy runtime files.

1. **Initialize** (once per workspace) — in Claude Code, from the workspace directory:
   ```text
   /wakeflow:init
   ```
   Preview the complete explicit selection, confirm the exact plan/digest, and
   apply. There is no discovery/reset alias. Existing v3 workspaces use
   reconfigure or reconcile; legacy workspaces use the separately authorized
   unregistered bootstrap.
2. **Inspect** — run `/wakeflow:check` and `/wakeflow:status`; both are
   read-only projections from strict v3 authority.
3. **Activate only through the v3 host seam** — initialization returns
   host-neutral `launchIntents`. Route each through the facade's exact
   `launch-window` command and register only its final session handle. If the
   host effect or receipt is unavailable, report the intent and stop; retired
   public-v2 commands are not aliases.

### Command cheat sheet

| Command | What it does | When |
| --- | --- | --- |
| `/wakeflow:init` | Preview/confirm/apply fresh v3 initialization | A brand-new workspace |
| `/wakeflow:windows` | Inspect typed bindings and redacted runtime projections | Identity/runtime orientation |
| `/wakeflow:windows <window-id> replace` | Plan one exact replacement; host effect remains separate | A stale responsibility window |
| `/wakeflow:windows <window-id> decommission` | Apply only after exact close + absence evidence | Verified Claude closure |
| `/wakeflow:status` | Demands, eligible work, deliveries, window readiness | Before dispatching |
| `/wakeflow:dispatch` | Preview/apply/claim, then require the fenced v3 host adapter and record outcome | Hand work to a bound window |
| `/wakeflow:review` | Inspect strict current results, independently validate, then create/decide one candidate | A result came back |
| `/wakeflow:unattended on|off` | Preview a desired-model policy change; unknown/host-wide activation blocks `on` | Switch hands-off ↔ prompted |
| `/wakeflow:check` | Read-only strict v3 verification | After a change or upgrade |

## Security & System Impact

Wakeflow is a powerful local automation plugin. Before installing, understand exactly what it does on your machine — none of it is hidden:

- **Runs a local MCP server** (`bin/wakeflow-mcp`): the dependency-free launcher selects Node.js 20+ and starts `mcp/server.cjs`. The server reads/writes workspace state files; it makes no network calls of its own.
- **Host effects are separate**: the public core plans and records typed facts;
  it does not claim to launch/paste/close a Claude session. The packaged v3
  facade delegates those effects to host owners with exact mutex/receipt
  contracts.
- **Permission model**: unattended mode is opt-in and additionally gated by
  activation coverage. `unknown` or `host-wide` coverage blocks unattended
  activation; Wakeflow does not add a machine-global workspace registry.
- **Local-first, no telemetry**: raw session handles and locators stay only in
  the host-local typed binding/operation tree. They are never written to
  tracked files, prompts, transport, or portable archives.

You remain in control: scripts and MCP tools create, validate, and record
machine data; they never choose acceptance, widen scope, or decide product
behavior on their own. They only persist an explicit controller decision. The
controller is the acceptance authority, and product decisions are yours.

## Window Model

Claude identity is a typed host-local binding keyed by stable `windowId`. The
raw session handle is private; the public window-runtime projection is
redacted and regenerable. A semantic title, tmux pane, cwd, or legacy
thread-registry/window-host file is not identity authority.

**Launch.** Fresh initialization and replacement produce host-neutral intents.
The facade's `launch-window` owner performs the physical session effect and
`wakeflow_register_window operation=register` records the final handle. If the
effect or receipt cannot be established, the intent remains blocked; retired
public-v2 files must not be written as a substitute binding.

**Dispatch.** Target delivery is
`target-preview → target-apply → target-claim → fenced host effect →
target-outcome`. The shared typed lease is acquired by claim, not by apply.
The v3 adapter holds a stable-window mutex across validation, paste, and at
most one bounded readback. Accepted, ambiguous, or sent-unconfirmed transport
is not resent. Controller return uses
`controller-preview/controller-apply/controller-pre-send`, takes no target
lease, and records a separate outcome.

**Recovery and close.** Creation, inspection, replacement, and decommission
are separate owner operations. Pod inspection uses
`wakeflow_pod_open operation=inspect-materialization` and never recreates or
discovers a worktree. Claude closure is machine-verifiable only after exact
close and an absence probe both succeed.

**Unattended activation.** The desired permission mode is tracked in strict
config, but applying a config change is not host activation. Only exact
per-workspace activation coverage may proceed unattended. Unknown or host-wide
coverage stays blocked; no machine-global workspace registry is created.

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
- Core `wakeflow_pod_open operation=launch-preview/launch-apply` freezes
  host-neutral first-materialization operations. The v3 Claude Pod adapter may
  execute only those canonical pending/unbound operations: three distinct
  control sessions and native `claude --worktree` product sessions from exact
  repository roots. It never nests Claude's `--tmux` or grants the whole
  workspace with a default `--add-dir`.
- `wakeflow_pod_record operation=record-materialization` journals the exact
  launch correlation and observed host result. Claude returns a final session
  id synchronously; it has no Codex `clientThreadId` pending state, and no
  temporary request id belongs in typed identity.
- Register only the final Claude session id, then verify pane cwd, Git common
  dir, base HEAD, and `mainCheckout=false` with `wakeflow_pod_bind`. All three
  control bindings produce `control-ready`; the Pod Design handoff plus all
  product bindings produce `execution-ready`.
- The Pod's single Design generation stays between `Controller__<pod>` and
  `Design__<pod>`.
  Freeze the controller request with
  `wakeflow_pod_plan operation=design-request`, then record its exact
  `PodDesignHandoffEnvelope` with `wakeflow_pod_record operation=design-handoff`; neither
  step creates a second global TODO. The current implementation does not persist a second
  Pod Design generation, so later supplement/redesign is an explicit
  capability blocker.
- Before Pod Test dispatch, run `wakeflow_pod_plan operation=test-access-plan` and record
  the independent Test session's exact probe through
  `wakeflow_pod_record operation=test-access-receipt`. Only `validated` +
  `direct-multi-root` coverage of every active product binding opens dispatch.
  Unsupported multi-root access remains blocked; no main-checkout, product-
  window, or unverified per-repository-executor fallback is implemented.
- A repeated launch apply may materialize only canonical operations that are
  still pending and unbound. `operation=inspect-materialization` contains only already-bound
  operations: it verifies or resumes the exact session at the recorded actual
  cwd, and never creates a missing session, passes `--worktree`, or rebinds it.
- Core `wakeflow_pod_plan operation=close-intent` emits a host-close intent.
  The v3 adapter closes the exact tmux/Claude session, performs the bounded
  absence probe, and reports worktree disposition; record the observation and
  receipt with `wakeflow_pod_record operation=close-observe/close-receipt`.
  Logical binding close, session close, and Claude/user-owned physical worktree
  cleanup remain separate facts.

## One Vocabulary Across Hosts

Wakeflow keeps one machine vocabulary across host editions. A "thread id" in
typed binding records, payload fields, and CLI flags is the Claude Code session id,
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

1. Claude Code builds one explicit selection split into `program`, `topology`,
   `storage`, `governance`, and `hosts`, with request-local `selectionKey`
   links. Wakeflow allocates the durable typed IDs.
2. Claude Code calls `wakeflow_maintain_workspace` with
   `action: "fresh-initialize"`, `mode: "preview"`, and that closed selection.
   Preview is read-only.
3. Claude Code reviews the blockers, exact `confirmedActionPlan`, returned
   `confirmedActionPlanDigest`, and `launchIntents`. Legacy or unclear ownership
   stays blocked instead of being broadly imported.
4. After user confirmation, Claude Code calls the same tool with
   `mode: "apply"`, the exact confirmed plan, and its returned digest.
5. The facade's `launch-window` owner may execute only those exact retained
   `launchIntents`. It keeps the raw session handle private, registers the final
   handle with `wakeflow_register_window operation=register`, and refreshes the
   redacted runtime projection. If the exact host effect or receipt is
   unavailable, activation stops with the intents still pending; retired
   public-v2 files must not be written as substitute runtime facts. Unknown or
   host-wide activation coverage also remains behind the manual host gate.

An initialized v3 workspace is never refreshed by replaying fresh setup. Use
`action: "reconfigure"` for an intentional complete desired-model change and
`action: "reconcile"` to restore managed bytes or projections from current v3
authority; both are preview-before-apply. Heavy or stale tmux windows use the
replacement command. Explicit legacy migration is available only through the
exact artifact's unregistered `bin/wakeflow-bootstrap`, never normal MCP/CLI.

Command responsibilities stay separate:

| Need | Command | Responsibility |
| --- | --- | --- |
| First-time setup | `wakeflow_maintain_workspace`, action `fresh-initialize` | Preview one explicit selection, then atomically apply the exact confirmed owner plan. |
| Intentional model change | `wakeflow_maintain_workspace`, action `reconfigure` | Preview a complete desired v3 model and apply only the reviewed delta. |
| Repair from current authority | `wakeflow_maintain_workspace`, action `reconcile` | Rebuild managed bytes/projections without changing the desired model. |
| One heavy/stale window | `wakeflow_replace_windows` (pass `window`) | Return one replacement launch entry with a `wakeflow_register_window` call template; no workspace docs refresh. |
| Several heavy/stale windows | `wakeflow_replace_windows` | Return only the requested replacement entries and registration call templates; no unrelated window rewrites. |

Design and Test are fresh support surfaces by default. Existing similarly
named directories such as `<Product>Design` or `<Product>Test` are treated as
ordinary directory facts unless the user explicitly maps them as Design/Test.

Wakeflow supports localized initialization. Pass `language: "zh"` for Chinese
workspaces, `language: "en"` for English workspaces, or `language: "auto"`
when there is no clear preference. Generated session titles keep the window
name at the front so the important repository name remains visible in narrow
sidebars. New and regenerated demand-progress projections also use the selected
interface language.

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
| `wakeflow.config.json` | Typed program identity plus topology, storage, governance, and host policy. |
| `.wakeflow-active/` | Current demand/business authority, immutable artifacts/events, TODO authority, and progress projections. |
| `.wakeflow-local/` | Typed audit holds plus shared/host runtime: bindings, leases, transport, Pod evidence, keep-live data, projections, and mutation journals. |
| `wakeflow-ledger/` | Durable program indexes and portable whole-demand BusinessArchives. |
| `Design/` | Internal requirement-design workspace when no external Design repository is mapped. |
| `Test/` | Internal test coordination workspace when no external Test repository is mapped. |

Wakeflow also synchronizes `.gitignore` so only `.wakeflow-active/` and
`.wakeflow-local/` remain local runtime directories. It does not add product
repositories, Design/Test folders, ledgers, `.DS_Store`, or other user
workspace noise to `.gitignore`.

## Automation Semantics

Wakeflow automation is direct session delivery plus explicit result return.

Core rules:

- Raw session ids live only in typed records under
  `.wakeflow-local/runtime/hosts/claude-code/identity/window-bindings/`.
- Window-runtime files under `projections/` are redacted derived views; they
  are not identity, handle, or topology authority.
- Delivery prompts remain compact and human-readable.
- Target delivery is
  `target-preview → target-apply → target-claim → fenced host effect →
  target-outcome`. Apply writes only immutable transport; claim acquires the
  shared exact-window lease immediately before the physical effect. The v3
  Claude adapter holds the stable-window mutex across revalidation, paste, and
  at most one bounded readback. The agent records the observation with
  `wakeflow_record_delivery operation=target-outcome`; that recorder is not the
  effect fence.
- Controller return uses `controller-preview`, `controller-apply`, and
  `controller-pre-send`, then the fenced host effect and
  `operation=controller-outcome`. It takes no target work lease and has no
  polling or synchronous-wait compatibility route.
- `group-ready` waits for the expected target results before a controller
  return.
- `per-target` can wake the controller once per target while still preserving
  a group snapshot.
- The adapter makes one bounded pane observation. Only `confirmed` proves the
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
controller dispatch: prepare the exact envelope, execute the fenced v3 host
effect, then record the delivery run.

Primary tool groups:

| Need | MCP tools |
| --- | --- |
| Workspace maintenance and window identity | `wakeflow_maintain_workspace`, `wakeflow_replace_windows`, `wakeflow_register_window` |
| Demand and task state | `wakeflow_status`, `wakeflow_create_demand`, `wakeflow_claim_next`, `wakeflow_add_task`, `wakeflow_continue_demand`, `wakeflow_recover_state_transition`, `wakeflow_cancel_demand` |
| Candidate scan and explicit Pod lifecycle | `wakeflow_next_work`, `wakeflow_pod_open`, `wakeflow_pod_bind`, `wakeflow_pod_plan` (design-request, test-access-plan/inspect, close-intent/inspect), `wakeflow_pod_record` (record-materialization, design-handoff, test-access-observe/receipt, close-observe/receipt) |
| Delivery and returns | `wakeflow_prepare_delivery`, `wakeflow_record_delivery` |
| Results and review | `wakeflow_record_target_result`, `wakeflow_review_pack`, `wakeflow_reduce_results`, `wakeflow_decide_review`, `wakeflow_complete_demand` |
| Design and Test intake | `wakeflow_deliver`, `wakeflow_intake_test_card` |
| Evidence, archive, views, storage, and verification | `wakeflow_record_evidence`, `wakeflow_archive`, `wakeflow_view`, `wakeflow_storage_preserve`, `wakeflow_prune_runtime`, `wakeflow_verify` |
| Exact target lease release | `wakeflow_release_window_lock` |

Public MCP tools are for outer agent workflows. Target closeout is
deliberately split: record a target result, review readiness, prepare a
controller-return envelope when policy allows, execute the fenced v3 host
effect, and record delivery facts. Controller review stays split as review
pack, result reduction, and explicit decision; result reduction only creates a
review candidate and is not acceptance. Do not collapse those steps into a
single target-window MCP tool. Internal keep-live state and backend execution
stay inside Wakeflow runtime owners and skills. `wakeflow_archive` has only
`preview/apply/inspect/recover`: it creates one portable whole-demand
`BusinessArchive` after lifecycle, Pod-close, transport, and privacy gates
close. The old TODO/docs/sanitize subroutes are not public v3 compatibility
aliases. `wakeflow_storage_preserve` separately owns typed machine-local audit
holds through inspect/preview/apply/recover; preserved bytes never become
business-state authority. None of these tools makes acceptance decisions or
sends host messages.

All routed v3 tools use the same closed envelope: `root`, an optional typed
`demandId`, an exact `operation`, and an operation-specific `request`.
Workspace/state/config/ledger paths are derived and cannot be overridden by the
caller. Host effects belong to typed owners reached through the closed v3
Claude facade; retired public-v2 commands are neither MCP aliases nor v3
effect seams.

Wakeflow declares MCP tool annotations for every public tool. Read-only and
open-world hints match the public boundary, while `destructiveHint` follows the
strongest operation a tool can perform (maintenance, replacement, release,
archive, preservation, Pod decommission, and prune are destructive-capable).
Annotations are client hints, not authorization. Tool approval is still controlled by the user's Claude Code
permission settings; a trusted local installation can allowlist the
`wakeflow` MCP server in `.claude/settings.json`.

## Runtime And Ledger Boundaries

Wakeflow keeps source, active runtime, and durable records separate:

| Path | Boundary |
| --- | --- |
| `skills/` | Reusable operating instructions installed with the plugin. |
| `scripts/` | Runtime implementation and validation scripts packaged by the plugin. |
| `templates/wakeflow-asset-bundle.json` | Generated carrier for the two canonical localized demand-progress assets authored under `core/template-sources/`. |
| `.wakeflow-active/` | Current active work in a target workspace; ignored by Git. |
| `.wakeflow-local/` | Machine-local audit preservation plus shared/host runtime authority and projections: bindings, leases, transport, Pod evidence, keep-live state, and maintenance journals; ignored by Git. |
| `wakeflow-ledger/` | Project-specific durable records outside reusable Wakeflow source. |

The source repository tracks reusable Wakeflow capability. Product code,
project-specific active state, real session ids, and derived local runtime
artifacts do not belong in Wakeflow source.

## Dual-Host Workspaces

One workspace may run the Codex and Claude Code Wakeflow editions side by
side. Shared business state stays host-neutral in `.wakeflow-active/` and
`wakeflow-ledger/`; shared coordination and transport live under
`.wakeflow-local/runtime/shared/{coordination,transport}/`.

Host-scoped runtime is separated per host:

- `.wakeflow-local/runtime/hosts/codex/{identity,projections,evidence,operations}/`
- `.wakeflow-local/runtime/hosts/claude-code/{identity,projections,evidence,operations}/`

`AGENTS.md` (Codex) and `CLAUDE.md` (Claude Code) coexist at workspace and
child roots. Each physical operation uses the exact current binding and strict
transport ancestry; shared leases prevent cross-host target overlap, and there
is no demand-host adoption alias.

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
| `../../core/template-sources/` | Canonical authoring source for the two localized demand-progress projection assets. |
| `templates/wakeflow-asset-bundle.json` | Deterministically generated install carrier for those templates; never hand-edited. |
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
6. **Local runtime stays local**: raw session ids stay only in host-local
   typed bindings, and active runtime state never enters tracked
   documentation.
7. **Fresh support windows by default**: Design and Test are created as clear
   Wakeflow support surfaces unless the user explicitly maps existing ones.

Wakeflow exists to make multi-window agent work safe to resume, easy to
inspect, and hard to accept without controller review.
