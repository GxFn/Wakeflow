# Wakeflow Unified Intake & Create Convergence — Requirement Design

> Generated 2026-06-21; requirement design for user confirmation, not executed work.
> Grounded in the current implementation (file:line refs are the as-is source of truth).

## 1. Goal

Collapse the Design→controller intake path into **one unified surface** with **one
create operation**, and remove status bookkeeping that nobody should maintain:

- **One surface** — the controller's global TODO board is the single place. Design
  *delivers* ready requirements into it; the controller reads and claims from it.
  The separate Design handoff board (with its 9-value status column) is retired.
- **Design is stateless** — Design freely maintains its own requirement documents and,
  when ready, *delivers* (append-only). Design never records or mutates a lifecycle
  status, and the controller never calls an MCP tool just to update a status.
- **One create** — `wakeflow_create_demand` replaces the four-call create sequence
  (`init_demand` + `intake_design_handoff` + `add_task` + `adopt_demand_host`) and
  consumes the TODO row in the same call.
- **`autoClaim` is an immutable delivery property**, not a status — set once by Design
  at delivery time; decides unattended auto-claim vs. controller-confirmed claim.

Non-goal: changing the **demand execution state machine**. The state root's `state`
(`intake → planned → … → completed → archived`) and per-task statuses stay exactly as
they are — that is the stable stage machine the controller relies on, and it is a
*different* concern from the Design intake list.

## 2. Current state (as-is)

Three surfaces and two status vocabularies are glued together:

- **Design handoff board** `.wakeflow-active/current/design-handoff-board.md` — 14
  columns, inline template `wakeflow-setup.mjs:1255-1264`. Status column =
  `allowedStatuses` (9): `draft, ready-for-workspace, controller-claimable,
  accepted-by-workspace, needs-design, paused, archived, research, absorbed-by-codex-loop`
  (`wakeflow-import-design-handoffs.mjs:13-23`). `import-design-handoffs.mjs` validates
  rows and writes a read-only inbox projection (`:430-501`).
- **Global TODO board** `.wakeflow-active/current/global-todo-board.md` — 10 columns
  `ID | Status | Type | Priority | Owner | Item / Goal | Affects… | Dependency / Trigger |
  Recommended Window | Current Mount` (`wakeflow-archive-todo.mjs:188`,
  `next-work.mjs:380-390`). The controller's scheduling backlog.
- **Demand state root** `wakeflow-state.json` — demand `state` machine
  `intake→planned→waiting-results→review-ready/needs-rework/blocked→completed→archived`
  (pinned by `wakeflow-state-schema.test.mjs`); per-task `status` plain strings
  (`"pending"`…) set by `wakeflow-state.mjs`. The `wakeflowStates` module
  (`wakeflow-status-machine.mjs`) feeds **board/TODO classification + progress
  rendering only** — the reducer does not import it.

**The four create tools** (`wakeflow-mcp-tools.mjs`): `init_demand`→`wakeflow-state init`
(hardcoded `--write`, `:645`), `add_task`→`wakeflow-state add-task-package` (hardcoded
`--write`, `:662`, first mutating command claims `controllerHost`), `intake_design_handoff`
→`wakeflow-intake design-handoff` (evidence-only, attaches `intake/design-handoff-*.json`,
**does not mutate state**, `intake.mjs:203-285`), `adopt_demand_host`→`wakeflow-state
adopt-demand-host` (host field only).

**The claim path**: `wakeflow_claim_next`→`wakeflow-demand-sequence.mjs claim-from-design`
(`:651-794`) — init-only, synthesizes goal/completion from linked Design docs, and
**writes `accepted-by-workspace` back to the Design board** via
`wakeflow-design-board.mjs updateDesignHandoffStatus` (`:758-766`, CAS-guarded on the
prior status). `wakeflow_next_work`→`wakeflow-next-work.mjs` scans the design board +
global TODO + active demands; `controllerClaimable = Status==="controller-claimable" &&
blockers.length===0` (`:325`). A second, CLI-only `claim-next` manifest path
(`:503-588`) is unreachable from MCP.

### Why this is the pain
- The 9-value status is **co-maintained by Design and the controller** (the controller
  writes `accepted-by-workspace` back). That is the status-update churn to delete.
- The board schema is **re-parsed in 3 places** (`import-design-handoffs`, `next-work`,
  `design-board`) and its column headers are hardcoded in ≥4 (`setup:1263`,
  `import:24-36`, `next-work:285-288`, `check-layout`, plus test fixtures).
- Creating a demand is **four MCP calls** with inconsistent write semantics (init/add
  hardcode `--write`; intake/adopt gate on `apply`).

## 3. Target model

```
Design (stateless)                 Unified surface = global TODO        Controller (stateful)
──────────────────                 ──────────────────────────────       ─────────────────────
maintain requirement docs   ──►    wakeflow_deliver (append-only)
   freely, no status               row: ID, Type, autoClaim, Priority,
when ready → deliver               docs(OriginalPlan, ReqDesign), Item
                                          │  read: wakeflow_view scope=todo
                                          ▼
                                   wakeflow_create_demand (or claim_next
                                   for unattended autoClaim rows)   ──►   state root enters
                                   = init + attach docs + initial         the demand state
                                     task packages + adopt host           machine (unchanged)
                                   + CONSUME the row (side effect)
```

Two layers, two different things:

| Layer | Carrier | State | Owner |
|---|---|---|---|
| Intake list | global TODO row | none beyond `pending → consumed` (consume = side effect of create) | Design appends; controller consumes |
| Execution | `wakeflow-state.json` | full `state` machine + per-task status (unchanged) | controller |

## 4. Concrete design

### 4.1 Unified surface = the global TODO board (extended)
Reuse the existing board; add two columns and define a deliverable row.

New `## Global TODO` columns (additive): `Auto Claim` (`yes`/`no`, immutable once
delivered) and `Documents` (links to Original Plan + Requirement Design for
requirement-type rows). A delivered row:

| Field | Meaning |
|---|---|
| `ID` | design key `<topic>-YYYY-MM-DD` (kept, `designKeyPattern`) |
| `Type` | `requirement` \| `bug` \| `supplement` \| `research` (existing `Type` column) |
| `Auto Claim` | `yes` = Design+user authorize unattended auto-claim; `no` = controller confirms first |
| `Priority` | existing |
| `Documents` | Original Plan + Requirement Design (required for `requirement`+`Auto Claim=yes`; **not** required for `bug`/`supplement`) |
| `Item / Goal` | existing |
| `Demand` | empty while `pending`; set to the demand state-root path at consume time (the deliver→demand→archive trace link) |
| `Status` | minimal: `pending` (delivered, unclaimed). On claim the row is **consumed** (moved to `## Completed TODOs…`, the existing archive-todo path) with `Demand` filled. No other transitions. |

Claimability invariants (validated at deliver + re-checked at claim, replacing the
`import-design-handoffs` per-status block):
- `Auto Claim=yes` + `Type=requirement` ⇒ must link Original Plan + Requirement Design,
  and those docs must carry `Design Key: <ID>` (the existing provenance check,
  `import:140-143`,`235-265`). A not-fully-designed requirement cannot satisfy this, so
  it cannot be delivered as auto-claimable — by design.
- `Type=bug`/`supplement` ⇒ exempt from the requirement-ready invariants (lightweight).

### 4.2 Design delivery — `wakeflow_deliver` (new, append-only)
The one controller-surface write Design may perform. Append a row to the global TODO;
**cannot** edit or re-status existing rows.

```
wakeflow_deliver {
  root, type ("requirement"|"bug"|"supplement"|"research"),
  designKey, title, item,
  autoClaim (bool, default false),
  originalPlan?, requirementDesign?,   // links; required when requirement + autoClaim
  priority?, recommendedWindow?, mainlineRelation?,
  apply (dry-run default)
}
```
Backend: a new `append-todo` subcommand on a TODO writer (extend `wakeflow-archive-todo.mjs`
or a new `wakeflow-todo.mjs`) that validates the invariants and appends one `pending` row.
Refuses if `ID` already present. Design boundary relaxes from "no TODO writes" to
"append-only deliver" — Design still cannot edit, claim, status, or schedule.

### 4.3 Create — `wakeflow_create_demand` (new, replaces 4 tools)
One call = `init` + attach Design docs as intake evidence + initial task packages +
adopt host + **consume the TODO row**.

```
wakeflow_create_demand {
  root,
  // from a delivered row (preferred):
  todoId?,                 // = the row ID; reads row + linked docs, synthesizes
                           //   goal/completionDefinition/stagePlan from the docs
                           //   (same as claim-from-design today, demand-sequence:736-744)
  // or inline (controller-authored demand, no TODO row):
  demandKey?, title?, goal?, completionDefinition?, stagePlan?,
  initialTaskPackages? [ {taskPackageId, summary, targetWindow, targetTaskId, sourceRef?} ],
  language?, stateRoot?,
  apply (dry-run default)   // fixes the init/add hardcoded-write inconsistency
}
```
Backend orchestration (one script, e.g. `wakeflow-demand-sequence create-demand`, reusing
existing reducers — no new state semantics):
1. `wakeflow-state init` (writes the 5 state-root files; demand enters `state:"intake"`).
2. For each initial task package → `wakeflow-state add-task-package` (also claims
   `controllerHost` on first call — so a separate adopt is unnecessary).
3. If `todoId`: write `intake/design-handoff-<slug>.json` evidence (reuse
   `wakeflow-intake design-handoff` logic, minus the board-status dependency).
4. `wakeflow-render-progress --write`.
5. **Consume**: move the TODO row to `## Completed TODOs…` with `Demand: <stateRoot>`
   filled (existing archive-todo mechanism) — a side effect, not a status-update call,
   and not a write to any Design board.

`adopt_demand_host` is no longer a standalone tool (host is claimed by step 2; transfer
remains available via the underlying `wakeflow-state adopt-demand-host` for the rare
recovery case, but off the MCP surface — or kept as a low-priority tool; see §7-Q3).

### 4.4 Claim — `wakeflow_claim_next` (re-pointed) + `wakeflow_view scope=todo`
- `wakeflow_view scope=todo` — read the unified pending list (replaces `next_work`'s
  read role; folds into the existing `wakeflow_view` tool from the 29→23 convergence).
- `wakeflow_claim_next` — unattended: read the TODO, select rows with `Auto Claim=yes`
  and no blockers; init at most one via the `create_demand` path. Replaces
  `claim-from-design`'s design-board scan/validate/write-back with TODO-row logic.
  **No board write-back** — consume is the only side effect.
- `wakeflow_next_work` — retired (its design+todo scan and `controllerClaimable` logic
  fold into `view scope=todo` reading `Auto Claim`).

### 4.5 Archival & closed-loop completeness
One design key `<ID>` threads the whole loop, so every stage is traceable and both
layers archive through the **existing** archive tools — no new archival mechanism.

Full lifecycle (two layers, one key):
```
deliver → TODO `pending` → claim (create_demand: consume row + init demand <ID>)
        → execute (demand state machine) → completed / cancelled / paused
        → archive demand (state root → committed ledger)
```

- **Consume ≠ complete.** At claim the TODO row leaves `pending` and is recorded as
  *consumed* with `Demand: <stateRoot>`. Completion is the demand's own lifecycle, not
  re-tracked on the TODO. Consumed rows accumulate in `## Completed TODOs…` and archive
  via `wakeflow_archive target=todo` (`wakeflow-archive-todo.mjs`, unchanged).
- **Demand archival unchanged.** A completed demand archives via
  `wakeflow_archive target=demand` (state root → committed ledger, P1-0 redaction guard).
  Because `demandKey === <ID>` and `intake/design-handoff-<slug>.json` records the origin,
  the archived demand is traceable back to its delivery.
- **Bidirectional trace.** consumed row → `Demand: <stateRoot>`; demand `demandKey` +
  intake evidence → origin delivery. One key, both directions, from deliver to ledger.
- **Un-claimed deliveries (dismiss).** A `pending` row the controller will not pursue
  (stale/superseded) is dismissed via the TODO archival path (moved to completed with a
  `dismissed` note) — a controller backlog action, not a Design status. Design, being
  append-only, supersedes by delivering a new row.
- **Non-terminal demands.** A demand ending `paused`/`cancelled`/`blocked` stays in that
  state in the state root; its consumed TODO row stays consumed (no TODO churn). Such a
  demand still archives through the existing demand-archive path.

Net loop closes with the two existing archive targets (`demand`, `todo`) + `prune_runtime`
for transport — the only addition is the `Demand` trace link on the consumed row.

## 5. Retirement list
- **Design handoff board** `design-handoff-board.md` + its 9-status enum + the inline
  `designBoardTemplate()` (`setup:1255-1264`) + the inbox projection.
- **`wakeflow-import-design-handoffs.mjs`** board validation/write-back — the
  design-key provenance + ready invariants move into `deliver`/`create_demand`.
- **Board write-back** `wakeflow-design-board.mjs updateDesignHandoffStatus` +
  `claim-from-design`'s `accepted-by-workspace` transition.
- **MCP tools**: `wakeflow_init_demand`, `wakeflow_intake_design_handoff`,
  `wakeflow_add_task`, `wakeflow_adopt_demand_host`, `wakeflow_next_work` → removed
  (backends survive as internal `create_demand` steps).
- **Dead CLI `claim-next` manifest path** (`demand-sequence.mjs:503-588`,
  `ControllerDemandSequenceManifest`) — retire.
- NET tools after this + the new two: `23 − 5 + {create_demand, deliver} = 20`.

## 6. Migration phases (safe ordering — no back-compat per "early stage")
1. **Surface + deliver (additive).** Extend the global TODO schema (`Auto Claim`,
   `Documents`); add `wakeflow_deliver` + its backend + tests. Nothing removed yet;
   both boards coexist for one phase only.
2. **Create.** Add `wakeflow_create_demand` (+ backend orchestrator) and re-point
   `wakeflow_claim_next` at the TODO; add `view scope=todo`. Tests for the converged
   create + TODO-driven claim.
3. **Retire.** Delete the Design handoff board path, `import-design-handoffs` board
   logic, the board write-back, the 5 removed MCP tools, the dead `claim-next` manifest.
   Update in lock-step: `HOST_VISIBLE_PRIORITY_TOOLS` (drop `init_demand`/`add_task`, add
   `create_demand`), `wakeflow-runtime.mjs` allow-list (drop orphaned scripts), the
   `wakeflow-validate.mjs:219-238` expected-tool list, `wakeflow-smoke.mjs` (swap the
   init+add probe for a create_demand probe), and every gated test (§ map Area 7).
4. **Guidance.** Update Design `design-handoff` skill + `Design/CLAUDE.md` Flow
   (deliver-to-TODO instead of handoff-board registration), `wakeflow-governance` SKILL,
   `wakeflow-controller` SKILL, the architecture doc, and `agents-rule-map`.

## 7. Decisions made / open questions
- **Decided:** unified surface = global TODO; Design stateless + append-only `deliver`;
  `autoClaim` immutable column (Option A); demand execution state machine unchanged;
  consume = side effect (no status-update MCP).
- **Q1 — board write-back removal:** confirm the controller never needs to signal Design
  post-claim (today's `accepted-by-workspace`). Proposed: it does not — the row is
  consumed and the demand state root is the source of truth. Design sees consumption by
  the row leaving `pending`.
- **Q2 — Design boundary relaxation:** `wakeflow_deliver` lets Design append to a
  controller surface (append-only). Acceptable, or keep Design writing a Design-owned
  drop file that `create_demand` reads (preserves strict "Design writes nothing
  controller-owned")? Proposed: append-only deliver — simplest, one surface.
- **Q3 — `adopt_demand_host`:** drop from MCP entirely (host claimed by first task
  package) or keep as a low-priority recovery tool? Proposed: drop; recovery via CLI.
- **Q4 — `supplement` into an existing demand:** does a `supplement` row create a *new*
  demand or attach a task package to an existing one? Proposed: it appends a task package
  to the named demand via `create_demand` with an existing `stateRoot` — needs a small
  add-task path on create.

## 8. Risks (from the coupling scan)
- Board schema + status strings are literal in ≥4 scripts and ≥5 tests; the retire phase
  must change them together or layout/validate/surface tests fail.
- `wakeflow-state-schema.test.mjs` pins the demand `state` enum exactly — do **not** let
  the TODO-row vocabulary leak into it; they stay separate.
- Event-type strings (`state.initialized`, `task-package.added`, …) are an implicit
  replay/audit contract — `create_demand` must emit the same events its sub-steps do.
- `wakeflow_init_demand`/`add_task` hardcode `--write`; `create_demand` introduces a
  proper `apply` gate — confirm no caller relied on the implicit write.
