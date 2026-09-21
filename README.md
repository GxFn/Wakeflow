<div align="center">

# Wakeflow

A disciplined control loop for multi-window agent work — every step traced, every result reviewable.

[English](README.md) | [简体中文](README.zh-CN.md)

</div>

---

Wakeflow turns "I want this built" into a traceable line of work: a requirement
package, a Demand, task packages, deliveries, results, reviews, and an archive
that still makes sense months later.

It is local and closed-world. Wakeflow holds state, evidence and history; your
agent holds judgment and performs every effect on your machine. Wakeflow never
opens a window, never sends a prompt, and never edits your product
repositories.

It ships as one plugin in two host editions — Codex and Claude Code — built
from a single TypeScript source.

- [What you get](#what-you-get)
- [How a piece of work flows](#how-a-piece-of-work-flows)
- [Install](#install)
- [Initialize a workspace](#initialize-a-workspace)
- [The tool surface](#the-tool-surface)
- [Two hosts, one model](#two-hosts-one-model)
- [Working in this repository](#working-in-this-repository)
- [Releasing](#releasing)
- [Design principles](#design-principles)

## What you get

- **A workspace** — a controller directory, separate from your product
  repositories, holding the configuration, the active state and the durable
  ledger.
- **Four window roles** — controller, design, test, and one product window per
  repository. Each is an agent window you launch; Wakeflow records which is
  which.
- **Four skills** — `wakeflow-controller`, `wakeflow-design`,
  `wakeflow-target`, `wakeflow-test`. Each window loads the one for its role.
- **Twenty MCP tools** — every state change is a preview-then-apply or an
  append-only call with a stable result shape; reads never write.
- **Pods** — a second complete window set working in its own worktree, for
  running two pieces of work at once without them colliding.
- **Evidence you can re-read** — deliveries are proven by the host's own hook
  observations, results are immutable records, and every accept, rework or
  escalation is a decision written in the Controller's words.

## How a piece of work flows

1. In the Controller window, ask to initialize the workspace, then launch the
   windows it asks for and let the agent register them.
2. In the Design window, work out the requirement with the agent. It reads your
   code read-only, drafts the package, and shows you a one-page summary. You
   confirm it, and it is published to the board.
3. In the Controller window, the agent claims the package, plans the task,
   prepares the delivery and sends it to a product window.
4. The product window does the work, imports its report, and wakes the
   Controller.
5. The Controller reads the result and the evidence, decides, and either sends
   rework or moves on. When the requirement asks for real-environment testing,
   a Test window runs the contract and the Controller reviews that too.
6. When everything is accepted, the Demand is completed and archived in one
   transaction.

You are asked to confirm twice: once on the requirement summary, and once on
the task plan when the package asks for it. Nothing is built off a requirement
you did not confirm.

## Install

Requirements on the machine that runs the agent host:

- Node.js 24 (`>=24.19.0 <25`) on the `PATH` the host launches with. The tool
  server and the observation hooks are started as `node`; a shell that cannot
  find it fails silently.
- `git`.
- For the Claude Code edition, `tmux`: the fleet lives in tmux windows.

The repository root is the development workspace; the installable plugins are
the two generated directories under `plugins/`:

| Host | Artifact | Catalog |
| --- | --- | --- |
| Codex | `plugins/codex-wakeflow/` | `.agents/plugins/marketplace.json` |
| Claude Code | `plugins/claude-code-wakeflow/` | `.claude-plugin/marketplace.json` |

Claude Code, from inside Claude Code:

```text
/plugin marketplace add GxFn/Wakeflow
/plugin install wakeflow@gxfn
```

Codex:

```bash
npx codex-marketplace add GxFn/Wakeflow/plugins/codex-wakeflow --plugin
```

For local development, register this checkout as its own marketplace in your
Codex configuration:

```toml
[marketplaces.gxfn]
source_type = "local"
source = "/absolute/path/to/Wakeflow"

[plugins."wakeflow@gxfn"]
enabled = true
```

Each artifact carries its own runtime dependency closure under `node_modules/`;
nothing has to be installed after the plugin is placed.

### One-time host actions after install

**Codex.** Open `/hooks` and trust Wakeflow's four hooks after reviewing them by
their definition hash. Until you do, all four are skipped: no session is
observed, so no window can be registered and no delivery can be shown to have
landed. If a plugin update changes the hook definition bytes, Codex asks you to
trust them again.

**Claude Code.** The first time you start Claude Code in the workspace
directory, accept the workspace trust dialog. Without it neither the plugin's
hooks nor the status line run. `wakeflow_maintain_workspace` writes the status
line command into a managed block in `.claude/settings.local.json`; that block
belongs to Wakeflow.

When `wakeflow_verify` reports its `host-hook-channel` gate as `absent` or
`records-0`, check these actions first. That gate is how Wakeflow knows a window
really received what was sent to it.

## Initialize a workspace

Open your agent in the directory you want as the workspace — it must not be a
product repository root — and say "initialize a Wakeflow workspace". The agent
previews the plan, asks you to confirm the selection, then applies it. What
appears:

| Path | Owner | Purpose |
| --- | --- | --- |
| `wakeflow.config.json` | Wakeflow, tracked | Program identity, topology (repositories, support surfaces, windows, pods), ledger root, governance, host preferences. Only `fresh-initialize` and `reconfigure` write it. |
| `.wakeflow-active/` | Wakeflow, ignored | Active state: `index.md`, `current/workspace-current-status.md`, per-Demand roots and progress projections, the requirement board. |
| `.wakeflow-local/` | Wakeflow, ignored | Host-private runtime: window bindings (the only place a real session or thread id lives), hook observations, pod receipts, maintenance journals. |
| `../wakeflow-ledger/` (configurable) | Wakeflow, tracked | Requirement package records and Demand archives. |
| `Design/`, `Test/` | Wakeflow-managed or external | The support surfaces the Design and Test windows work in. |
| `AGENTS.md` / `CLAUDE.md` | Yours, with a managed block | Wakeflow keeps one block in the workspace instruction file; everything outside it is yours. |

Reconcile (`wakeflow_maintain_workspace` with `reconcile`) repairs Wakeflow-owned
files and reports drift; it never changes the configuration, registers a
window, or deletes something it does not own.

## The tool surface

Twenty public MCP tools. Effect tools run as `preview` then `apply` against the
previewed plan digest; append tools take an idempotency key and replay cleanly;
read tools never write.

| Area | Tools |
| --- | --- |
| Workspace | `wakeflow_maintain_workspace` — fresh-initialize, reconfigure, reconcile |
| Windows | `wakeflow_register_window_binding` — inspect a launch intent, register a handshake, replace a window, release a work claim |
| Requirements | `wakeflow_publish_requirement` — preview the summary, publish to the board; `wakeflow_inspect_board` |
| Demand | `wakeflow_create_demand` (claiming a package creates the Demand), `wakeflow_complete_demand` (complete and archive in one transaction), `wakeflow_cancel_demand`, `wakeflow_continue_demand` (continue an archived Demand, or record the user's answer to an escalation) |
| Tasks and delivery | `wakeflow_plan_target_task` (implementation and test packages), `wakeflow_prepare_delivery` (one call: envelope, prompt, work claim and send permit), `wakeflow_record_delivery_outcome`, `wakeflow_rearm_delivery` |
| Results and review | `wakeflow_import_target_result`, `wakeflow_inspect_target_result_review`, `wakeflow_record_implementation_review_decision`, `wakeflow_record_test_review_decision` |
| Evidence | `wakeflow_record_evidence` — managed paths, hook observations, links, commits |
| Pods | `wakeflow_pod` — create, inspect, recover, close |
| Observation | `wakeflow_status` (one observation of every domain, plus the next action), `wakeflow_verify` (thirteen gates that pass, fail, or are reported unavailable) |

Unavailable is counted separately from failure on purpose: "we could not check"
is never reported as "it is fine".

## Two hosts, one model

The state roots, the ledger, the tools, the skills and the evidence shapes are
identical on both hosts. The differences are the host's own facts:

| | Codex | Claude Code |
| --- | --- | --- |
| A window is | a Codex thread rooted at the window's directory | a tmux window running `claude` |
| Delivery is | one send into the target thread | one paste into the target pane, then one capture |
| Landing evidence | the thread send's return, or the target session's `UserPromptSubmit` hook record | the target session's `UserPromptSubmit` hook record |
| Hooks | `hooks/hooks.json`, trusted once in `/hooks` | `hooks/hooks.json`, run after workspace trust |
| Worktrees for pods | `git worktree add`, branch created before results are imported | `git worktree add` or `claude --worktree <name>` |
| Extras | — | four slash commands, a status line |

## Working in this repository

Everything hand-written is TypeScript under `src/`, `tooling/` and `tests/`;
`plugins/` is generated and never edited by hand.

| Path | Purpose |
| --- | --- |
| `src/` | The runtime, in six layers: `foundation` → `contracts` → `kernel` → `capabilities` / `governance` / `configuration` / `workspace` → `hosts` → `entrypoints`. Dependency direction is enforced. |
| `src/contracts/schemas/` | The portable JSON Schemas; `src/contracts/generated/` is derived from them and checked for drift. |
| `src/hosts/<host>/` | Everything Codex- or Claude-specific: profiles, hook fragment, agent-text value table, maintenance execution. |
| `assets/agent-text/` | The single source of the skills, commands and READMEs shipped in both artifacts; host differences are six placeholders filled by each host's profile. |
| `assets/brand/`, `assets/release/version.json` | Brand assets and the single release version input. |
| `tooling/` | Build, codegen, architecture, test and release tooling. |
| `tests/` | Unit, capability, host, artifact and scenario tests; `tests/scenarios/` runs twenty end-to-end scenarios through the public tools in a disposable workspace. |
| `plugins/` | The two generated plugin artifacts. Rebuild them; do not edit them. |
| `docs/` | The development documentation system; start at `docs/README.md`. |

```sh
npm test                       # typecheck, architecture rules, lint, format, knip, tests, schema drift, artifact check
npm run scenario:acceptance    # the twenty end-to-end scenarios only
npm run build:artifacts        # build both artifacts into .build/artifacts (candidates)
npm run build:artifacts:committed  # rebuild plugins/ from source
npm run build:check            # rebuild and compare against plugins/ byte for byte
npm run smoke:artifacts        # copy plugins/* outside the repository and run them
npm run release:check          # strict post-commit release gate
```

Repository maintenance rules for agents working here live in `AGENTS.md` and
`CLAUDE.md` at the root.

## Releasing

1. Set the version in `assets/release/version.json` and in the `wakeflow` entry
   of `.claude-plugin/marketplace.json`.
2. `npm run build:artifacts:committed`, then `npm test` (which includes
   `build:check`) and `npm run smoke:artifacts`.
3. Commit, push to `main`, tag `v<version>`.
4. `npm run release:check` — five version sources agree, the tree is clean, the
   tag is at `HEAD`, local `origin/main` is at `HEAD`, and the gate itself ran on
   Node 24.

## Design principles

1. **Judgment stays visible**: tool output, status rows and target reports are
   review inputs, not acceptance.
2. **One Demand, one state root**: events, packages, results, decisions and
   projections stay tied to the same Demand.
3. **Prompts brief, packages contextualize, skills execute**: a delivery prompt
   carries the goal, the focus and the boundary; the task package owns the
   context; the skill owns the procedure.
4. **Repository boundaries matter**: each window owns its source, tests,
   commits and reports.
5. **Automation moves work, not authority**: a send is proven by an observation
   record, and a result is complete only when the Controller says so.
6. **Local runtime stays local**: real session and thread ids live only in the
   host-private runtime directory and never enter a public result.
7. **Nothing is silently fine**: an unavailable check is reported as
   unavailable, a hand-edited projection is left alone, and a workspace that
   already carries Wakeflow markers is refused rather than migrated.
