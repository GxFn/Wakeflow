<div align="center">

# Codex Control Workspace

A local-first control plane for multi-repository Codex work: one controller,
many specialist Codex windows, explicit evidence, and direct-thread handoff
without turning scripts into the decision maker.

[中文](README.zh-CN.md)

</div>

---

- [What It Does](#what-it-does) · [Architecture](#architecture) · [Install Shape](#install-shape) · [How Work Moves](#how-work-moves) · [Automation Model](#automation-model) · [Daily Use](#daily-use) · [Repository Layout](#repository-layout) · [Design Philosophy](#design-philosophy)

## What It Does

One Codex window is good at one codebase. Real product work often spans a
plugin entrypoint, a local daemon, a shared core package, a dashboard, a design
thread, and a real-project test thread. Codex Control Workspace keeps that work
from turning into scattered chat state.

The main ideas:

- **One controller brain**: the parent workspace owns goals, boundaries,
  dispatch decisions, acceptance, TODO routing, and archive decisions.
- **One state root per demand**: machine state, task packages, target results,
  and review candidates live together instead of being spread across status
  documents.
- **One readable progress surface**: `developer-progress.md` is the human-facing
  view of the goal, stage plan, task packages, backfills, and controller
  decisions.
- **Sibling Codex windows stay specialized**: product repositories keep their
  own rules, commits, tests, and responsibility boundaries.
- **Direct-thread transport is transport only**: packets move between Codex
  windows, but the controller still reviews raw evidence before accepting work.
- **Design and Test attach to the demand**: design handoffs and real-scenario
  test cards become structured intake, not parallel state machines.
- **Local-first by default**: active state and real thread ids stay out of Git;
  long-term decisions go to a project ledger.

The result is not a bigger script runner. It is a small control surface that
keeps judgment, evidence, and ownership visible while Codex work fans out.

## Architecture

```mermaid
flowchart TD
  User["User / developer goal"] --> Controller["Controller Codex window"]
  Controller --> Gates["AGENTS.md gates<br/>goal, boundary, evidence, stop rules"]
  Controller <--> StateRoot["State root<br/>.workspace-active/..."]
  StateRoot --> Packages["Task packages"]
  Packages --> Envelopes["Delivery envelopes"]
  Local[".workspace-local<br/>thread ids, local config"] -. "lookup" .-> Envelopes
  Envelopes --> Host["Codex host thread tool<br/>send_message_to_thread"]
  Host --> Targets["Sibling Codex windows"]
  Targets --> Repos["Product repositories"]
  Targets --> Results["TargetResultEnvelope<br/>plus raw evidence refs"]
  Results --> Controller
  Controller --> Ledger["workspace-ledger<br/>long-term records"]
```

The controller is the only place that decides whether evidence is enough. The
scripts create, validate, summarize, and record machine data; they do not accept
a feature, widen scope, or choose product behavior.

## Install Shape

Do not put product repositories inside this repository. Put the reusable control
workspace next to the repositories it manages:

```text
MyWorkspace/
  AGENTS.md                  # unpacked total-control entrypoint
  codex-control-workspace/   # this reusable repository
  ProductRepo/
  CoreRepo/
  PluginRepo/
  DesignRepo/
  TestRepo/
  workspace-ledger/          # project-specific long-term records
```

`workspace.config.json` gives reusable defaults. A local installation can
override them with `.workspace-local/workspace.config.json`; that file is never
committed. `.workspace-active/` and `.workspace-local/` are runtime surfaces,
not source-controlled product state.

Recommended installation flow:

1. Ask Codex to inspect the parent folder.
2. Let it propose repository roles and window names.
3. Confirm the boundary.
4. Let it write only the managed `AGENTS.md` blocks and local runtime surfaces.

Useful first prompt:

```text
You are installing codex-control-workspace.
Read README.md, README.zh-CN.md, AGENTS.md, workspace.config.json, and scripts/README.md.
Run a read-only discovery of sibling repositories.
List proposed window names, repository roles, existing AGENTS.md status, and local surfaces that would be created.
Wait for my confirmation before writing anything.
```

## How Work Moves

The normal loop is intentionally boring:

1. The user gives a goal or a design handoff.
2. The controller defines completion, boundaries, first blocker, and eligible
   repositories.
3. A state root records the demand and creates task packages.
4. Target Codex windows receive compact direct-thread prompts.
5. Target windows work only inside their repository responsibility and return
   result envelopes with evidence references.
6. The controller reads the raw evidence, accepts or rejects the result, and
   records the decision.
7. The controller either dispatches the next eligible package, marks the demand
   blocked, stops for user judgment, or completes and archives.

Design and Test are supporting roles:

- **Design** clarifies requirements, tradeoffs, hidden goals, and handoff
  candidates. It does not become product truth until the user or controller
  accepts it.
- **Test** handles real-project, dashboard, cold-start, and runtime evidence
  that the controller or product repo cannot safely reproduce alone.

## Automation Model

Automation is direct-thread delivery plus result return. It is not a hidden
scheduler and not a replacement for review.

Core rules:

- Real Codex thread ids stay in `.workspace-local/`.
- Delivery prompts stay small and human-readable.
- The host thread tool sends the prompt; scripts only record the send/readback
  evidence.
- `group-ready` can wait for all expected target results before one controller
  callback.
- `per-target` can wake the controller for each target, still with a group
  snapshot.
- The controller stops on final completion, hard gates, user stop, no eligible
  TODO, missing evidence, or any state that forbids dispatch.

If you need every flag and command, use [scripts/README.md](scripts/README.md).
The README is meant to explain the control model, not act as a shell manual.

## Daily Use

Start by reading the active control surface and the current state root, not by
running every script. The most common helper is:

```sh
node scripts/workspace-control.mjs status
```

After that, choose the smallest action that advances the real loop:

- intake a design handoff or test card,
- create or dispatch one task package,
- import a target result,
- reduce results and make a controller decision,
- archive only after evidence and TODOs are settled.

Script families:

| Need | Script family |
| --- | --- |
| Install / sync parent and child `AGENTS.md` blocks | `control-workspace-install.mjs` |
| Create state roots, task packages, decisions, progress projections | `controller-state.mjs` |
| Record Design/Test intake | `control-intake.mjs` |
| Build delivery envelopes, review result groups, record direct-thread runs | `codex-automation-loop.mjs` |
| Daily status, verification, and printed command shortcuts | `workspace-control.mjs` |

## Repository Layout

| Path | Purpose |
| --- | --- |
| `AGENTS.md` | Source total-control instructions, unpacked to the parent workspace root. |
| `workspace.config.json` | Generic window names, repository paths, role labels, and script defaults. |
| `.workspace-active/` | Ignored project runtime: current indexes, controller state roots, progress docs, TODO projections, intake, and test cards. |
| `.workspace-local/` | Ignored local runtime: real thread ids, automation loop state, keep-live state, and local config overrides. |
| `../workspace-ledger/` | Project-specific long-term records outside the reusable repository. |
| `scripts/` | Installation, validation, ledger, state-machine, intake, automation, and control helper scripts. |
| `skills/` | Operational manuals for controller windows, target windows, testing, ledgers, and automation. |
| `templates/` | Minimal skeletons for state roots, developer progress docs, Design/Test support, and confirmations. |

## Design Philosophy

1. **Judgment stays at the controller**: script output, window backfill, TODO
   rows, and status docs are evidence, not acceptance.
2. **One demand has one machine state root**: repeated status and envelopes stay
   as JSON / JSONL, while Markdown remains readable context and evidence.
3. **Progress has one readable surface**: developers should not need to chase
   five status files to know the goal and next blocker.
4. **Automation moves work, not authority**: direct-thread delivery proves only
   that a prompt was sent, not that a task is complete.
5. **Repositories keep their boundaries**: shared contracts, plugin entrypoints,
   daemon behavior, dashboard UI, design, and testing stay in the right window.
6. **Small prompts beat command dumps**: target windows need the current task,
   state root, skill, and identity rules, not a full script manual.

Codex Control Workspace is scaffolding for disciplined multi-window work. Its
job is to make the real decision points hard to skip.
