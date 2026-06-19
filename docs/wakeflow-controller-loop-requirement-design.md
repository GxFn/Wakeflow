# Wakeflow Controller-Loop Unified Requirement Design

> Generated 2026-06-19; requirement design for user confirmation, not executed work.

This document consolidates the five user-stated requirements with the two previously
organized planning artifacts — `docs/wakeflow-upgrade-plan.md` (the P-item upgrade plan)
and `docs/wakeflow-state-flow-capability-assessment.md` (the G-item capability
assessment) — into one coherent requirement design across seven requirement areas
(RA1–RA7). Every claim is grounded at `file:line` against the core edition
(`core/` is the byte-identity source of truth; `tools/sync-core.mjs` copies each
`core/` file into both `plugins/codex-wakeflow` and `plugins/claude-code-wakeflow`,
and `npm run check:core` fails on any drift). Baseline verified this session:
`tools/sync-core.mjs --check` is green (63 core files, both editions identical) and
`node --test test/*.test.mjs` reports 215/215 passing — this is the green bar every
area must preserve.

This is a PROPOSAL. Nothing here is executed work. Where adversarial feasibility
verification flagged a conflict or a needs-adjustment, the correction is reflected
below rather than papered over; six of the seven areas carry a verifier
needs-adjustment that gates "sound."

**Path-grounding note (verified this session).** Two file families below are cited by
SHORT name and must be resolved to their real on-disk paths before any edit:
1. **Schemas** live under `core/schemas/wakeflow-state-machine/` — e.g. the citations
   `wakeflow-state.schema.json`, `projection.schema.json`,
   `controller-event.schema.json`, `transition-candidate.schema.json` are
   `core/schemas/wakeflow-state-machine/<file>` (NOT repo-root or `core/`-root). The
   cited line numbers match those files. They sync byte-identical into both editions.
2. **Library modules** split across two dirs: `core/lib/` holds ONLY
   `wakeflow-mcp-tools.mjs`, `wakeflow-runtime.mjs`, `wakeflow-process.mjs`,
   `wakeflow-trace.mjs`; ALL the `*-commands.mjs`, `*-store.mjs`, `*-status-command.mjs`,
   `*-summary.mjs`, `*-idempotency.mjs`, `*-host-profile.mjs`, `*-trace-spine-command.mjs`
   and the new `wakeflow-redaction.mjs` live under `core/scripts/lib/`. Where a touchpoint
   writes a bare `lib/wakeflow-…-commands.mjs` it means `core/scripts/lib/…`; the
   `core/lib/…` citations (mcp-tools, runtime) are correct as written.
Many per-area `file:line` offsets are accurate to within a few lines (line drift from
edits since capture); re-grep the named symbol, do not trust the absolute line blindly.

---

## 1. Background and observed problems

Two prior documents already mapped Wakeflow's state-flow capability:

- **`wakeflow-upgrade-plan.md`** enumerated P0/P1/P2 items (F-numbered findings) with
  resolved decisions (schema is reference-only/no Ajv; both editions stay
  byte-identical; version bumps are user-controlled; the delivery-script
  `record-target-result` has a live consumer and stays; `wakeflow-compact-index.mjs`
  is retired; archived roots move into the committed `wakeflow-ledger` behind a new
  P1-0 thread-id redaction prerequisite). It sequenced work into Waves A–F.
- **`wakeflow-state-flow-capability-assessment.md`** answered seven capability
  questions (Q1–Q7) and surfaced gaps G1–G11, several flagged
  NEEDS-USER-CONFIRMATION because they change the controller's autonomy boundary or
  add new surfaces.

In practice, an installed unattended controller exposed concrete pain that the user
restated as five load-bearing requirements:

1. **Design-gated self-claim** — "only a requirement the Design window has confirmed
   as deliverable-to-the-controller gets added to the auto-claim TODO." The
   controller has no MCP-reachable self-claim chain, and the one ledger it would scan
   keys eligibility off a free-text Status cell.
2. **Unified state + handling-count observability** — "unified management of state +
   handling-counts (chuli-cishu) across execution / acceptance / test /
   requirement-supplementation, visible to the controller for decisions." Today there
   are no per-task counters and no single rollup fusing the four evidence surfaces;
   `test-cards/` and `intake/` are write-only.
3. **State-flow robustness** — "clarify the flow, guarantee atomicity, make state
   transitions stable and UNIQUE, and handle error cases." Multi-file commits are
   non-transactional, two authorities own the same lock-release transition, and error
   handling is incomplete (no spawn error handler, no SIGKILL, no silent-window
   signal, irreversible `completed`).
4. **Per-window fast discovery** — "sub-windows often spend a long time finding their
   own files and task area — keep solving this." No single cheap call returns a
   window's tasks plus its exact file paths.
5. **Agent-navigable, linkable records** — "all our docs and records may be consulted
   by Agents at any time — ensure our documents are easy to consult and to link."
   `projection.json` pre-flattens its richest fields to lossy strings; state roots
   have no index; there is no focused sub-doc generator; intra-record links are
   unchecked.

The remaining two areas absorb the upgrade-plan/assessment debt the user did not
restate verbatim but which the plan already resolved: lifecycle GC + committed
archival (RA6), and dead-code retirement + contract hardening (RA7).

The deeper structural problems behind all seven:

- The MCP boundary deliberately hides runtime scripts, so capabilities that exist
  CLI-only (the demand-sequence claim chain, withRuntime/strictRuntime verify flags)
  are unreachable by an installed controller.
- Counters and structured slices do not exist; the controller reconstructs history by
  hand from `controller-events.jsonl` and by opening write-only `test-cards/`/`intake/`.
- Non-transactional commits, dual transition authorities, and missing error handling
  are survivable by a human operator but corrosive to an unattended loop.
- The two gitignored storage tiers grow unbounded and are re-parsed on every status
  call; completed demands are never archived.
- Doc/contract drift (lossy projections, dead scripts still in allow-lists, a wrong
  state enum) erodes trust in records an agent consults blindly.

---

## 2. Scope map — full union coverage

The table shows every requirement area, the user requirement it carries, the
upgrade-plan P-items and assessment G-items it absorbs, and the net-new work. Nothing
from the user list, the upgrade plan, or the assessment is dropped.

| Area | User requirement | Upgrade-plan P-items / F-findings | Assessment G-items / Q | Net-new vs prior docs |
|------|------------------|-----------------------------------|------------------------|-----------------------|
| **RA1** Design-gated controller auto-claim | #1 (Design-confirmed deliverable → auto-claim; gate moves to Design, not removed) | (none — respects §6 guardrails + resolved decision 3) | G1 (no MCP self-claim, Q2), G2 (markdown free-text Status, Q1) | Net-new capability the assessment flagged as requiring its own intake |
| **RA2** Unified state + handling-counts | #2 (unified state + chuli-cishu visible to controller) | Q4 count/rollup building blocks | G8 / Q4 (no per-task counts; no fused rollup; `test-cards/`+`intake/` write-only) | Persist-at-write counters + fused task-ledger reader |
| **RA3** State-flow robustness | #3 (clarity, atomicity, unique/stable transitions, error handling) | P2-7/F41, P1-5/F25, P2-10/F26, P1-1/F38, P2-8/F42, P2-9/F20, P2-5/F18 | F9, G3, G4, G5, G6 (all NEEDS-CONFIRM) | Single-commit ordering + shared lock helper + reopen + staleness signal |
| **RA4** Per-window fast discovery | #4 (sub-windows find their files/tasks fast) | (none) | G10 / Q6 (no convenient per-window task pull) | `wakeflow_window_view` orientation card |
| **RA5** Agent-navigable / linkable records | #5 (records easy to consult and link) | F4/F15 (partial — schema in validate) | G9 (lossy projection, Q5), G11 (no card/brief/generator, Q7) | structured `slices` + state-root `index.md` + `focus-doc` + anchor checking |
| **RA6** Lifecycle GC + committed archival | (derived from plan §4/§7) | P1-3/F32, P1-4/F33, P1-0 (redaction prereq), P2-3/F35, P2-4/F36 | G4 (terminal lifecycle), G7 (archived enum becomes written) | `prune-runtime`, `archive-demand`, redaction guard |
| **RA7** Dead-code retirement + contract hardening | (derived from plan resolved decisions) | P2-1/F13/F1, P2-2/F11/F40, P2-11/F10, P2-12/F14, P2-13/F8, P1-6/F45, P2-6/F19, F17/F39, P1-7/F51, F52, F53 | Q3 (enum drift) | allow-list↔caller cross-check + version-parity + lock tests + core-rooted-import guard |

One-liner per area (for the user, plain English):

- **RA1** — Add a typed `controller-claimable` status only Design can set, and a new
  `wakeflow_claim_next` MCP tool that does an init-only claim from it; the
  confirmation gate moves to Design authority, it is not removed.
- **RA2** — Persist `dispatchCount`/`reworkCount` on each task and derive
  `retestCount`/`supplementCount` at read; expose one fused `wakeflow_task_ledger`
  rollup (and inline counts in status/review-pack/projection) that no longer drops
  accepted-task history.
- **RA3** — Flip every multi-file commit to state-last, unify lock-release to one
  authority, and complete error handling (spawn handler, SIGKILL, staleness signal,
  guarded reopen, re-read guard, sticky-rework clear).
- **RA4** — Add `wakeflow_window_view`: one cheap read-only call returns a window's
  tasks plus its exact file areas across both storage tiers.
- **RA5** — Add structured `projection.slices`, a generated `<state-root>/index.md`,
  a `focus-doc` per-window/per-phase generator, and anchor-aware link checking.
- **RA6** — Add `prune-runtime` (bounded GC) and `archive-demand` (move accepted roots
  into the committed ledger), both dry-run-default and hard-gated behind a thread-id
  redaction guard.
- **RA7** — Retire three dead surfaces, add an allow-list↔caller cross-check, a
  version-parity test, the enum fix, the missing lock tests, and a `core/`-rooted
  dev-import guard (P2-12).

**Explicitly deferred / not silently dropped.** For union honesty, the upgrade-plan and
assessment items NOT carried as active work in any RA above are recorded here as
deliberate deferrals, not omissions:

- **P1-2 / F24 (keep-live lease lifecycle / lease-scoped auto-stop).** A P1 with a
  visible behavior change. Deferred — it is named as a NON-GOAL in RA3 and RA6 because
  lease-scoped auto-stop must not be folded into the state-flow or GC waves (sibling
  groups may still need keep-live; "silence is never auto-judged"). It remains its own
  confirmation-gated item; the minimal safe step (surface active lease ids in status) and
  the lease-scoped auto-stop both stay OUT of this proposal pending a separate decision.
- **F12 (document `wakeflow-cli` as a dev aggregator / trim MCP-duplicated subcommands)**
  and **F46 (Codex marketplace artifact-check asymmetry).** Upgrade-plan Wave F,
  lower-priority / medium-confidence, each NEEDS-USER-CONFIRMATION. Deferred — RA7 retires
  only the high-confidence dead surfaces; these two need their own confirm before any edit.
- **F16 (delivery `register-thread`/`build-window-config`/`build-delivery` vestigial
  paths).** Explicitly a NON-GOAL of RA7 — confirm no Codex/manual-repair consumer first.
- **The 33 observation / by-design findings** (F5–F8, F15, F21–F23, F27–F31, F37, F43,
  F44, F48–F50, etc.) are NOT action items per the upgrade plan (they record that an edge
  case was checked and is sound), so they are correctly absent from the RA work.

---

## 3. Per-area requirement design

Every area lands in `core/` only (host-neutral), syncs byte-identical to both
editions, and keeps the 215-test bar green. Per-edition memory/skill files
(`CLAUDE.md`, `AGENTS.md`, `scripts/README.md`, `README*.md`, skill references,
`package.json`) are NOT under `core/`, are NOT byte-identical across editions, and are
only existence-checked by `check:core` — so any edit to them must be applied per
edition and verified by a grep gate, not by `check:core`.

---

### RA1 — Design-gated controller auto-claim

**Requirement (user authority).** "only a requirement the Design window has confirmed
as deliverable-to-the-controller gets added to the auto-claim TODO." Auto-claim
eligibility must key off a Design-window-owned typed status, not free text; the
confirmation gate moves to Design authority, it is not removed.

**Current state (verified).** Two coupled gaps. (G1) The only real init+add chain is
`wakeflow-demand-sequence.mjs claim-next` (`claimItem` chains init +
add-task-package + render-progress, `core/scripts/wakeflow-demand-sequence.mjs:399-455`),
which is CLI-only and CLAUDE.md-forbidden for the installed controller and absent from
`wakeflow-mcp-tools.mjs` (grep-confirmed). `wakeflow_next_work` is advisory only — its
`--write` path (`core/scripts/wakeflow-next-work.mjs:415-419`) just dumps candidate
JSON. (G2) TODO eligibility hinges on a free-text Status regex
(`wakeflow-next-work.mjs:289`). The Design source already enforces a typed gate:
`parseDesignCandidates` (`:178-240`) requires `Status==='ready-for-workspace'` (`:204`),
`userConfirmationStatus` in `{confirmed,not-required}` (`:215`), and linked
original-plan + requirement-design docs that exist (`:218-221`), setting
`recommendedWindow=controllerWindow` (`:234`). The import validator's
`allowedStatuses` Set (`wakeflow-import-design-handoffs.mjs:13-22`) is the typed Design
lifecycle. `wakeflow-demand-sequence` is already in the runtime allow-list
(`wakeflow-runtime.mjs:33`), so only the MCP wrapper is missing.

**Landing design.** (1) Design sets a NEW typed terminal Status `controller-claimable`
(a stricter sibling of `ready-for-workspace`) on a handoff-board row that already
satisfies every ready-row invariant plus design-key provenance. (2) Add it to
`allowedStatuses` (`:13-22`) and fire the ready-row invariant block (`:199-222`) for it
too. (3) `parseDesignCandidates` emits a NEW boolean `controllerClaimable` (true only
for zero-blocker `controller-claimable` rows). (4) NEW MCP tool `wakeflow_claim_next`
runs dry-run by default (picks the single `controllerClaimable` candidate, returns a
`wouldClaim` payload) and on `apply:true` fail-closed re-validates the gate, then runs a
manifest-free init. (5) The init chain is NOT `claimItem` (see verifier correction
below) — it calls the reusable `runControllerState('init')` + `runRenderProgressDoc`
primitives directly, init-only, never dispatching or accepting.

**Data-model / schema changes.** No state-machine schema change (respects resolved
decision 3 — schema reference-only). The typing lives in the import validator's
`allowedStatuses` Set + ready-row block, exactly where `ready-for-workspace` is typed
today. Additive fields: `controllerClaimable:boolean` on the next-work design candidate
and on `summarizeTargetEntry`.

**New / changed commands and tools.** NEW CLI subcommand
`wakeflow-demand-sequence.mjs claim-from-design --design-key … [--write]`
(manifest-free single-demand init). NEW MCP tool `wakeflow_claim_next
{root?, designKey?, stateRoot?, board?, apply?}` — the single new host-reachable
surface, added to both the tool-definitions array and the handlers map in
`core/lib/wakeflow-mcp-tools.mjs`. CHANGED (additive only): next-work `--source design`
and import `--id` report `controllerClaimable`.

**Exact touchpoints.** `wakeflow-import-design-handoffs.mjs:13-22, :199-222, :374-396`;
`wakeflow-next-work.mjs:204, :227-240`; `wakeflow-mcp-tools.mjs` (new def near the
`wakeflow_next_work` def + handler region, apply→`--write` exactly like
`wakeflow_next_work`); new `claim-from-design` subcommand in
`wakeflow-demand-sequence.mjs` near `:484-568`; per-edition `CLAUDE.md`/`AGENTS.md`
Confirmation-Gates section (one rule: the controller may auto-claim ONLY from a
Design-set `controller-claimable` row; dispatch/acceptance gates stay intact).

**End-to-end flow.** Design confirms a deliverable → sets `controller-claimable` →
controller `wakeflow_claim_next` (dry-run) returns the single candidate → `apply:true`
re-validates fail-closed and inits one state root → controller proceeds with normal
confirmed dispatch (a separate step).

**Edge cases.** Two+ claimable rows → dry-run ambiguous, apply requires explicit
`designKey` (never auto-pick). Row downgraded between scan and apply → import re-validate
fails closed (TOCTOU guard, mirrors `commandClaimNext:500-513`). `demandKey` collision
→ refuse an existing active demand. No task packages → init-only (the gate is not
weakened into auto-dispatch).

**Test plan.** Import tests (claimable validates / missing-link fails / key-mismatch
fails); next-work tests (one claimable → `controllerClaimable:true`; ready-for-workspace
→ `false`); demand-sequence `claim-from-design` (dry-run no write / `--write` one root,
no task package, no dispatch / re-run on active refuses); MCP-tools test (registered;
apply omitted → no `--write`; apply:true threads `--write`; fail-closed re-validation);
`npm run check:core` + full `npm test` (215 bar).

**Completion definition.** Design can set `controller-claimable`; it validates with the
same (never weaker) invariants as ready-for-workspace + design-key provenance;
next-work emits `controllerClaimable` only for zero-blocker claimable rows;
`wakeflow_claim_next` does an init-only claim of exactly one demand, dry-run by default,
fail-closed re-validating at apply, never dispatching/accepting; free-text TODO rows can
no longer drive auto-claim through this tool; the moved gate is documented per edition;
`check:core` green and full `npm test` green with new tests.

**Non-goals.** No auto-dispatch/auto-accept; no typed-JSON backlog DB; no runtime Ajv;
no weakening of any existing tool/status/gate; no claiming from a free-text TODO row;
no auto-pick among multiple rows; no version bump.

**Dependencies.** Independent of Waves A–F in code, but should land after/alongside
P2-13 (RA7 allow-list↔caller cross-check) so the new handler registers as a legitimate
caller. Reuses (without modifying) init + render-progress, import validation, the
next-work scanner. **User confirmation is a hard prerequisite** (changes the controller
autonomy boundary).

**Risks.** Exposes an auto-init chain CLAUDE.md currently forbids — defensible only
because eligibility is Design-gated; a user-confirmed decision. Authority is a ROLE
convention, not a code-enforced ACL. `goal/completionDefinition/stagePlan` derivation
has no existing extraction path (see verifier risk below).

**Feasibility note — NEEDS-ADJUSTMENT.** Direction sound; most touchpoints accurate.
Three corrections gate "sound":
1. Risk #6's rationale is factually WRONG: `commandInit` is host-neutral
   (`controllerHost:null`, `core/scripts/wakeflow-state.mjs:451-453`, verified this
   session) and does NOT call `ensureDemandHostOwnership`. This is BENIGN for init-only
   claim (ownership correctly stays unclaimed until a later driving command), but an
   implementer must NOT "verify against init and then add a gate" — none belongs there.
2. The `CLAUDE.md`/`AGENTS.md` "byte-identical" framing is WRONG: those files are not
   under `core/` (verified — `find core` returns none), differ today by ~126 lines, and
   are only existence-checked. The rule must be applied per edition with
   edition-appropriate terminology; `check:core` will not catch an omission. (This
   already answers confirmation Q5: hand-maintained per edition.)
3. The touchpoint citing `claimItem` `399-455` as reusable primitives is imprecise:
   `claimItem` hard-requires a manifest `developerDoc` via `syncDeveloperDoc`
   (`:448 → :337-346`, verified). Only `runControllerState('init')` +
   `runRenderProgressDoc` are reusable; `claimItem`/`syncDeveloperDoc`/
   `initialTaskPackagesFor` must NOT be invoked.

   Two RISKY items need a decision before build: (a) `goal/completionDefinition/
   stagePlan` are NOT board columns today (import `requiredColumns` `:23-35`) and there
   is no doc-parser, so init would get thin values unless new board columns are added or
   a parser is built; (b) apply-time import `--id` aggregates validation issues across
   ALL board rows, so the fail-closed re-validation is board-wide, not single-row.

---

### RA2 — Unified state + handling-count observability

**Requirement (user authority).** "unified management of state + handling-counts
(chuli-cishu) across execution / acceptance / test / requirement-supplementation,
visible to the controller for decisions." Absorbs G8/Q4.

**Current state (verified).** The target-task object
(`core/scripts/wakeflow-state.mjs:635-646`) carries only
`{targetTaskId, taskPackageId, targetWindow, summary, status, createdAt}` — no counters.
`decide-review` (`:1214-1220`) overwrites `{status, reviewDecision}` and never
increments; a rework cycle creates a NEW timestamped result file
(`:836-851`). Execution+acceptance live on `state.targetTasks[]`; test-cards live in
`<state-root>/test-cards/`, design-handoffs in `<state-root>/intake/` — both
write-only (grep-confirmed: no reader in any status/review/reduce/trace path).
`buildStateRootReviewPack` (`core/scripts/lib/wakeflow-review-commands.mjs:356-393`)
filters via `controllerReviewScope` to OPEN tasks, DROPPING accepted-task history. The
durable `review.decided` event (`:1265-1284`) carries `reason/evidenceRefs/stateRevision`
but NOT `targetTaskIds`. The `targetTasks` schema item is untyped
(`wakeflow-state.schema.json:58`), so counter fields need ZERO schema change.

**Landing design.** PRIMARY-COUNTER DECISION = persist-at-write (grounded: the durable
event carries no `targetTaskIds`, so derived-from-events cannot reliably attribute
rework). New `counts={dispatchCount, reworkCount, retestCount, supplementCount}` on each
task. `dispatchCount`/`reworkCount` are PERSISTED inside existing sanctioned writes;
`retestCount`/`supplementCount` are DERIVED-at-read from file cardinality (so intake
never writes `wakeflow-state` — respecting the `design-intake-updates-wakeflow-state`
(`intake.mjs:256`) and `test-card-updates-wakeflow-state` (`:359`) forbidden-conclusion
gates). UNIFIED ROLLUP = new read-only `buildTaskLedger` producing a
`WakeflowTaskLedger` joining execution status + acceptance decision + persisted counts +
derived counts + test-card/supplement status + latest result, scanning ALL targetTasks
(no review-scope filter, so accepted history is preserved) plus an `eventsReconcile`
cross-check (`driftDetected` advisory).

**Data-model / schema changes.** `targetTasks[].counts` (no schema edit needed). No new
top-level state key, no new event type, no new file format. In-memory `WakeflowTaskLedger`
(read-only output only).

**New / changed commands and tools.** NEW read-only command
`wakeflow-delivery.mjs task-ledger --state-root … [--task-id] [--target-window] [--json]`
(recommended home — it already imports `buildStateRootReviewPack`). CHANGED additive
output: `review-pack` gains per-task counts + `acceptedTaskHistory[]`;
`render-progress` projection gains `taskCounts`; status gains a demand-level counts
rollup. NEW read-only MCP tool `wakeflow_task_ledger`.

**Exact touchpoints.** `wakeflow-state.mjs:635-646` (seed counts), `:1214-1220`
(rework-branch increment); `lib/wakeflow-result-recording-commands.mjs:143-156`
(dispatchCount increment, AFTER the already-sent early-return `:114-129`);
`lib/wakeflow-review-commands.mjs:356-393` (+ new `buildTaskLedger` export, reuse
`latestStateRootResultsByTargetTask:114-123`); `wakeflow-delivery.mjs:491, :810-863`
(new `task-ledger` case); `wakeflow-render-progress.mjs:262-274` (taskCounts);
`core/lib/wakeflow-mcp-tools.mjs` (new tool + handler).

**Edge cases.** Idempotent replay → increment sits after the already-sent guard (no
double-count). Accepted-task history preserved by scanning all tasks. Unlinked test card
(testId not an existing targetTaskId, `intake.mjs:346`) → reported but not per-task
attributed. `supplementCount` is demand-level (design-handoff has no per-task id).
Legacy roots → nullish defaults; `eventsReconcile` recomputes.

**Test plan.** dispatch → `dispatchCount===1`; replay → stays 1; rework →
`reworkCount===1`, re-dispatch → `dispatchCount===2`, accept → frozen + present in
ledger; new `wakeflow-task-ledger.test.mjs` (join fixtures); legacy-root reconcile;
review-pack `acceptedTaskHistory` non-empty after accept; projection `taskCounts`;
`check:core` + full `npm test`.

**Completion definition.** From one read-only `wakeflow_task_ledger` call (and inline in
review-pack/status/projection) the controller sees, for every task INCLUDING accepted
ones, execution status, acceptance decision, test-card status, supplement status, and
four counts — without hand-reconstructing from events or opening `test-cards/`/`intake/`.
`dispatchCount`/`reworkCount` persisted inside sanctioned writes; `retestCount`/
`supplementCount` derived; intake write-boundary preserved; accepted history no longer
dropped; `check:core` green, 215 bar green.

**Non-goals.** No intake→state writes; no Ajv; no new transition/terminal state/reopen;
no version bump; counts are decision evidence, NOT a completion gate; latest-by-createdAt
selection unchanged.

**Dependencies.** Soft: Wave C P2-3 (superseded results) would make selection cleaner but
is not required. Coordinate with daemon-removal only if it touches
`result-recording-commands.mjs` or the mcp-tools lists.

**Risks.** Counter correctness on the replay path (mitigated by placing the increment
after the already-sent guard + an explicit test). Derived counts depend on file
cardinality joins. `eventsReconcile` for rework is best-effort (events carry no
`targetTaskIds`). Four output surfaces to keep consistent — mitigated by routing all
through one `buildTaskLedger`.

**Feasibility note — NEEDS-ADJUSTMENT.** Every counter/site/schema fact verified and
holds; persist-at-write is correctly grounded. Two adjustments:
1. The `wakeflow_status` counts-rollup surface CANNOT be added in `wakeflow-cli status`
   — `buildStatus` (`core/scripts/wakeflow-cli.mjs:135-151`) is demand-agnostic (only
   `--json`/`--root`). It must be injected into
   `wakeflow-delivery-status-command.mjs` and bubble up via `closedLoopStatus`, and is
   per-state-root-within-a-workspace-aggregation, not single-demand.
2. The "allow-list arrays at `:542,:550`" is really ONE visibility-priority array
   (`HOST_VISIBLE_PRIORITY_TOOLS`, `core/lib/wakeflow-mcp-tools.mjs:541-554`); adding the
   new read-only tool there is OPTIONAL, not required. Minor: the
   "comma-joined strings" characterization conflates the doc TEMPLATE with the named
   `projection.unifiedStatus` object — additive `taskCounts` is still safe.

---

### RA3 — State-flow robustness: transactional commit, unique/stable transitions, error handling

**Requirement (user authority, verbatim).** "clarify the flow, guarantee atomicity, make
state transitions stable and UNIQUE, and handle error cases." Absorbs P2-7/F41, P1-5/F25
+ P2-10/F26, P1-1/F38, P2-8/F42, P2-9/F20, P2-5/F18, and assessment F9, G3, G4, G5, G6.

**Current state (verified).** ATOMICITY — `atomicWrite` (temp+rename,
`wakeflow-state.mjs:278-288`), `appendJsonLine` (`:332-337`); every multi-file reducer
writes `state.json` BEFORE events (state-first, WRONG): reduce-results `:1129-1135`,
decide-review `:1287-1289`, complete-demand `:1388-1391`, plus the delivery send path
`markStateRootDeliverySent` (`result-recording-commands.mjs:221-222`).
UNIQUE TRANSITIONS — dual lock-release: thorough run-scan
(`result-recording-commands.mjs:472-516`) vs narrow inline match
(`wakeflow-state.mjs:903-918`); both resolve the same lock file. ERROR HANDLING —
`spawnNode` (`core/lib/wakeflow-runtime.mjs:117-152`) has no `child.on('error')`; timeout
sends SIGTERM only; `classifyErrorCode` (`:207-222`) maps null exitCode to
process-exit-nonzero; `complete-demand` (`:1323`) has no reverse; reducers read state once
and write without re-read; same-host lock is advisory (`dispatch-commands.mjs:219-221`).
State enum (`wakeflow-state.schema.json:32-47`) omits `dispatched`, lists never-written
values.

**Landing design (three pillars).** PILLAR 1 ATOMICITY — flip `state.json` LAST at every
multi-file commit via a shared `commitStateTransition` helper (secondaries → event →
state.json), so a crash leaves a harmless extra event, never a missing-event audit gap;
add read-time tolerance for a pre-commit trailing event. PILLAR 2 UNIQUE/STABLE — one
shared `releaseWindowLockForResult` in `delivery-store.mjs` called by both paths (delete
the inline narrow match); keep BOTH `record-target-result` entrypoints (resolved decision
6 — live claude-host consumer) and document the seam; G5: make `dispatched` handling in
add-task-package explicit. PILLAR 3 ERROR HANDLING — spawn `child.on('error')` →
`runtime-spawn-failed` (retryable); SIGKILL escalation making `timeoutMs` a hard cap; a
delivery-staleness SIGNAL keyed on `sentAt` age (controller still judges); a guarded
`reopen-demand` (completed→planned|needs-rework, requires `--reason` + `--evidence-ref`);
reducer re-read guard; sticky-rework clear.

**Data-model / schema changes.** No new top-level state fields. New event type
`demand.reopened`; `task-package.added` gains optional `addedDuringState`. Enum corrected
(add `dispatched`, drop the 4 pure-vestige values) — reference-only, no Ajv. `sentAt`
surfaced into status output (derived from existing `run.createdAt`). Optional
`--stale-after-minutes` / `--unattended` (default current behavior).

**New / changed commands and tools.** NEW `wakeflow-state reopen-demand
--state-root --reason --evidence-ref [--as-rework] [--write]`; NEW MCP tool
`wakeflow_reopen_demand`. CHANGED: add-task-package explicit `dispatched` semantics;
optional `--stale-after-minutes`; optional `--unattended` fail-closed same-host lock;
staleness surfaces in existing runtime-health output (no new tool).

**Exact touchpoints.** `wakeflow-state.mjs:278-337` (helper), the commit sites listed
above, `:903-918` (delete inline lock-release), `:610-634` (G5), `:1214-1220` (P2-5),
`:1323-1391, :1505-1534` (reopen), `:607/989/1179/1332` (re-read guard);
`result-recording-commands.mjs:166, :221-222, :371, :472-516`;
`lib/wakeflow-delivery-store.mjs:133-182` (shared helper); `wakeflow-runtime.mjs:117-152,
:207-235`; `lib/wakeflow-delivery-status-command.mjs:74-99, :154-171`;
`lib/wakeflow-runtime-summary.mjs:24-43, :258-269, :354-362`;
`lib/wakeflow-dispatch-commands.mjs:219-221`; mcp-tools (reopen tool — see corrected line
offsets below); `core/schemas/wakeflow-state-machine/wakeflow-state.schema.json:32-47`;
`wakeflow-smoke.mjs` spawn guard.

**Edge cases.** Crash at `state.json` rename → temp unlinked, secondaries+event durable.
Reopen of an archived root must honor the P1-0 redaction gate (cross-wave). Lock
unification must not over/under-release. Same-host fail-closed must not break a legitimate
same-`deliveryId` readback retry (the `deliveryId !== resolvedDeliveryId` guard
distinguishes). Staleness threshold 0/absent → no signal.

**Test plan.** Crash-injection (extra event, revision not advanced, read tolerance); lock
unification on BOTH paths; G5; spawn-error → `runtime-spawn-failed`; SIGKILL; staleness
signal; reopen (+ refuses on non-completed / missing evidence); reducer re-read conflict;
sticky-rework; same-host fail-closed under flag; full regression.

**Completion definition.** Every multi-file commit flips `state.json` last (crash-test
proven); exactly one lock-release authority; both record entrypoints documented as
distinct seams with only the shared lock-release unified; spawn handler + SIGKILL +
staleness signal + guarded reopen + reducer re-read + complete failed/blocked/error/
timeout/stale classification; all gated changes user-confirmed first; enum reference-only;
`check:core` byte-identical; 215 bar green.

**Non-goals.** No Ajv; do not retire the delivery-script `record-target-result`; do not
auto-judge a silent window; no blanket same-host fail-closed in attended mode; no GC/
archival/keep-live/version-parity here; no version bump.

**Dependencies.** Wave B lock helper before P2-10 folds in; P2-7 transactional commit
sequences LAST within Wave E; reopen shares terminal-state lifecycle with P1-4 archival +
P1-0 redaction. All NEEDS-CONFIRM items require user go-ahead.

**Risks.** P2-7 reordering touches every reducer (run full suite + crash test). Lock
unification can over/under-release. Reopen interacts with redaction gate. Staleness
threshold tuning.

**Feasibility note — NEEDS-ADJUSTMENT.** Baseline verified green; all structural facts
confirmed. Required adjustments:
1. The P2-5 sticky-rework touchpoint is wrong: `import-target-result` does NOT mutate
   `state.targetTasks` (test "stores result evidence without changing controller state"),
   so it cannot clear `reviewDecision` at `:1214-1220` (that is the decide-review WRITE
   site that SETS it). Land the clear where the stale field is read or where the task
   transitions back.
2. Lock-release is NOT a strict superset: the delivery-side run-scan gates on
   `windowLockFresh` (`:477`, fresh-only); the state-side inline path has no freshness
   gate (releases stale too). Pick one freshness policy deliberately and add a stale-lock
   test.
3. Lock-path identity holds only at the default `--state-dir`; a custom override diverges
   from the state-script's hardcoded path. Pin the shared helper to the same root or the
   "one file" guarantee breaks.
4. Sequence the P2-9 re-read/conflict check at the TOP of each commit (before
   secondaries+event), not "immediately before state.json," to avoid orphan secondaries
   on abort.
5. Soften the Pillar-1 "phantom replay" justification — there is no event-replay reader;
   the real win is closing the audit gap, and read-time tolerance is defensive-only.
6. G5 "keep dispatched" is ALREADY current behavior (`:632-634`); the actual change is
   only the additive `stateReason`/`addedDuringState`.
7. The MCP reopen-tool touchpoint line offsets are off — def near `:273`, handler near
   `:757`, tool list near `:549` (structure is fine).

---

### RA4 — Per-window fast file/task discovery (`wakeflow_window_view`)

**Requirement (user authority).** "sub-windows often spend a long time finding their own
files and task area — keep solving this." Absorbs G10/Q6.

**Current state (verified).** No single cheap call returns a window's tasks plus its file
areas. Discovery is push-by-prompt (`formatTargetPrompt`,
`wakeflow-window-runtime.mjs:79-104` — emits identity, not the task list), heavyweight
trace-spine (`wakeflow-trace-spine-command.mjs:164-168`, the reusable 3-line filter inside
a full evidence scan), or `buildWindowDispatchConfig`
(`wakeflow-thread-registry.mjs:37-85`, ZERO task data, ZERO file paths). `state.windows[]`
(`wakeflow-state.mjs:1420-1442`) carries only bare ID lists. Per-window file areas span
two tiers — state-root (`task-packages/`, `target-results/`) and transport-runtime
(`.workspace-local/wakeflow-delivery/{dispatch-packets,target-results,delivery-envelopes,
delivery-runs}` + `hosts/<hostDirName>/{thread-registry,window-config}`).

**Landing design.** PHASE 1 (recommended, no schema change): new read-only MCP tool
`wakeflow_window_view{stateRoot, window}` → `wakeflow-state window-view` subcommand that
filters `state.targetTasks` by `targetWindow` (inlining the trace-spine kernel), joins
taskPackages, reads the `state.windows[]` rollup (advisory only), and computes per-window
file areas across both tiers as workspace-relative paths, reading
`hostProfile.runtime.hostDirName` at RUNTIME (so `core/` bytes stay identical while paths
resolve per edition). No write, no revision bump, no event, no host-ownership claim.

**Data-model / schema changes.** Phase 1: NONE (derived read-only `WindowOrientationCard`).
Phase 2 (optional, separately gated): materialize a per-window slice on `state.windows[]`.

**New / changed commands and tools.** NEW read-only subcommand
`wakeflow-state window-view --state-root --window [--json]`; NEW read-only MCP tool
`wakeflow_window_view`.

**Exact touchpoints.** new `commandWindowView()` + a case at
`wakeflow-state.mjs:1505-1534` (reuse `stateRootFromArg:317-330`, `slug:94-99`,
`hostProfile:15`); tool def + handler in `core/lib/wakeflow-mcp-tools.mjs` (readOnly
annotation); cite the trace-spine kernel `:164-168` (no edit — do not couple).

**Card shape.** `{ok, window, stateRoot, windowState (advisory rollup),
tasks:[{targetTaskId, taskPackageId, status, reviewDecision?, summary}], taskPackages:[…],
counts:{open,total}, fileAreas:{stateRoot, taskPackagesDir, stateRootResultsDir, myResults,
transport:{dispatchPacketsDir, transportResultsDir, deliveryEnvelopesDir, deliveryRunsDir},
host:{threadRegistryFile, windowConfigFile}}}` — all paths workspace-relative.

**Edge cases.** Zero tasks → `tasks:[]` but populated `fileAreas`. Window absent from
`state.windows[]` → derive from `targetTasks` (authoritative); rollup is advisory.
State-root vs transport `target-results` are TWO distinct dirs — label distinctly. Dispatch-
packet exact filename only derivable when `dispatchGroup` is known — emit dir + note,
never fabricate. Read `hostProfile.runtime.hostDirName`, never hardcode.

**Test plan.** window-A/window-B isolation; zero-task; host-correct path against
`hostProfile.runtime.hostDirName`; read-only invariant (revision + event count unchanged);
MCP shape; full bar.

**Completion definition.** One cheap read-only call returns the window's task list
(filtered from `targetTasks`, grouped under taskPackage summaries) AND its exact file areas
across both tiers, with no state write, no revision bump, no event, no ownership claim.

**Non-goals.** No self-claim/gate weakening; no per-task counters (surfaced only if RA2
adds them); no phase slicing or sub-doc generator (RA5); no change to push-by-prompt; no
Ajv.

**Dependencies.** SOFT on RA2 (counts surface automatically once they exist; do NOT block).
Phase-2 materialization separately confirmed. No GC/archival dependency.

**Risks.** `state.windows[]` rollup can be stale (treat `targetTasks` as authoritative).
Transport path-construction drift vs the store dir map (mitigate with a pinning test or a
shared dir-name helper). Dispatch-packet filename non-derivable without `dispatchGroup`.

**Feasibility note — NEEDS-ADJUSTMENT.** No hard conflict; Phase 1 writes nothing so it
cannot break replay/lost-update/revision/ownership gates; the two touched files are
byte-identical synced today. Adjustments:
1. The test-plan location is wrong: there is no `core/test/` dir; the test file is
   `test/wakeflow-state.test.mjs` (repo root) and runs the CODEX plugin copy. Place it
   there and prove claude host-correctness via the byte-identical `smoke:claude` path, not
   via a "claude edition resolves under core tests" claim.
2. The edge-case fabrication rule must ALSO apply to transport `target-results` (same
   composite-id filenames via `resultFileFor`), not only dispatch-packets — emit dir+note
   or read `targetTask.delivery.dispatchGroup` and only emit exact filenames when present.
3. The sync-exclusion characterization is imprecise: cite `tools/sync-core.mjs`;
   `HOST_LOCAL_CORE_FILES = {wakeflow-host-profile.mjs}` is the not-copied set,
   `HOST_CONTRACT_FILES` is the broader host-rendered (non-identical) set. The load-bearing
   conclusion (both touched files are in NEITHER set → byte-identical) still holds.
4. Phase-2 framing over-states the schema cost: `windows` items have no inner
   `additionalProperties:false`, so adding per-entry keys needs no schema edit; the real
   cost is reducer-consistency + state size. Gate phase 2 on that, still confirm.

---

### RA5 — Agent-navigable and linkable documents and records

**Requirement (user authority).** "all our docs and records may be consulted by Agents at
any time — ensure our documents are easy to consult and to link." Absorbs G9/Q5 and
G11/Q7 (all NEEDS-CONFIRM).

**Current state (verified).** `projection.json` pre-flattens its richest fields to lossy
strings: `summarizeItems:191-194`, `summarizeWindows:196-199`, `summarizeBlockers:201-204`,
called at `:242-248`, projection built `:254-275`; init-time mirror at
`wakeflow-state.mjs:516-537`. `projection.schema.json` exists in all 3 editions, top-level
`additionalProperties:false` (so a new field needs a schema edit). State roots have NO
`index.md` (layout `wakeflow-state.mjs:424-561`). Distillation pattern to reuse:
`commandPrepareDispatchFromState` (`dispatch-commands.mjs:353-520`). The link checker skips
`#anchor` targets (`verify-workspace-docs.mjs:53-55`) and `stripMarkdownLinkTarget:41-43`
removes fragments before existence checks; `linkFiles` scope is `workspaceDocsDir`, which
already contains state roots under `--all-workspace`.

**Landing design (four additive parts).** PART 1 (G9): emit a NEW top-level
`projection.slices` object (arrays-of-objects for windows/taskPackages/targetTasks/blockers/
decisionsRequired) ALONGSIDE the existing lossy strings (additive, backward compatible).
PART 2: write a generated `<state-root>/index.md` linking every sub-file/sub-dir with
relative links + stable anchors, regenerated on every render (idempotent). PART 3: new
read-only `focus-doc` subcommand (reusing the dispatch distillation pattern) emitting
`focus/window-<slug>.{md,json}` and `focus/phase-<slug>.md`; dry-run-default. PART 4: extend
`verify-workspace-docs` to validate intra-doc anchors against generated heading slugs and
descend into state-root index/focus docs.

**Data-model / schema changes.** `projection.json` gains optional top-level `slices` (typed
objects, ADDITIVE — lossy strings retained). New generated `<state-root>/index.md` and
`<state-root>/focus/` (regenerable, never state authority). `projection.schema.json` gains
`slices` (mandatory because top-level `additionalProperties:false`). No `wakeflow-state.json`
shape change.

**New / changed commands and tools.** NEW `wakeflow-state focus-doc --state-root
(--window | --phase) [--write]` (dry-run default); NEW MCP `wakeflow_focus_doc`. CHANGED:
`render-progress` emits `slices` + writes `index.md` under `--write`;
`verify-workspace-docs` validates anchors + state-root docs.

**Exact touchpoints.** `wakeflow-render-progress.mjs:191-204, :254-275` (slices + index);
`wakeflow-state.mjs:516-537, :547-561` (mirror + init index) + new focus-doc subcommand;
`core/schemas/wakeflow-state-machine/projection.schema.json:6-24` (add slices);
`verify-workspace-docs.mjs:53-65, :141-160,
:274-276` (anchors); `core/lib/wakeflow-mcp-tools.mjs` (focus_doc def+handler);
`wakeflow-validate.mjs:34-61` (list projection + controller-event schemas — F4/F15).

**Edge cases.** `slices` additive (consumers reading strings unaffected). Index/slices ride
the render-progress ownership gate (`:299-301`) + lost-update re-check (`:304-309`), built
from the same pre-write state (revision-consistent). Empty demand → empty arrays. Anchor
collisions → `-2` suffix. Generated state-root docs live in gitignored `.workspace-active`
and honor the P1-0 redaction rule; NOT promoted to `wakeflow-ledger` by this area.

**Test plan.** slices arrays-of-objects (strings retained); index links resolve + idempotent;
focus-doc window dry-run/`--write`; focus-doc phase; linkability (broken link + dangling
anchor both reported); schema validates with slices + byte-identical; MCP read-only +
apply; full regression.

**Completion definition.** An agent can extract a per-window/per-package slice as
structured JSON without parsing `wakeflow-state.json`; open a generated `index.md` with
resolving anchors; request one consolidated card/brief via `wakeflow_focus_doc`; rely on
`verify-workspace-docs` to prove relative links AND anchors. Additive, byte-identical,
215 bar green; no gate weakened, no capability deleted.

**Non-goals.** Do not remove the lossy strings; do not add a per-task `stageId` here (G11(a)
is separate — `--phase` reads existing `activeStageId` opportunistically); do not promote
generated docs to the committed ledger; no Ajv; do not build on the retiring
`wakeflow-compact-index.mjs`; focus docs are never state authority.

**Dependencies.** `projection.schema.json` edit lands in `core/` and syncs before/with the
slices change. Per-phase brief quality depends on a future per-task `stageId` (G11(a)) — ship
`--window` now, `--phase` best-effort on `activeStageId`.

**Risks.** `projection.json` growth (slices carry only id/status/membership fields). Schema
must be byte-identical (edit core only). Anchor checking is new behavior (could surface
pre-existing broken anchors — land as a warning first). Generator mistaken for state
authority (stamp header + `sourceRevision`). Index idempotency (deterministic ordering).

**Feasibility note — NEEDS-ADJUSTMENT.** All 13 touchpoints verified and hold; no conflict
with ownership/lost-update/byte-identity. Adjustments:
1. PART 4 anchor-resolution is the real risk: there is NO existing heading-slug generator
   (the only `slug()` does not lowercase or strip markdown), and turning off the
   unconditional `#`-skip changes a standing checker contract. The design's own mitigation
   (build a kebab slugifier, scope strict checks to GENERATED docs first, land as a WARNING)
   must be treated as MANDATORY — a live scan found only ONE anchor link workspace-wide, so a
   hard gate buys almost nothing while risking surprise breakage.
2. Document the latent edge that a `--state-root` placed under `projectLedgerRoot` escapes
   `--all-workspace` scope (no live case today).
3. The render-progress ownership gate means `index.md` is only regenerable by the OWNING
   host — the completion definition silently depends on the owner having rendered recently.
4. `wakeflow-compact-index.mjs` retirement is a planned decision NOT yet enforced in code
   (still allow-listed); the non-goal is sound but must not silently depend on its removal.

---

### RA6 — Lifecycle GC + committed archival (prune-runtime, archive-demand, redaction guard)

**Requirement (derived authority).** Upgrade-plan §4 (P1-3/F32, P1-4/F33, P2-3/F35,
P2-4/F36) and §7 resolved decisions: §7.2 archived roots move into the committed
`wakeflow-ledger`; the new P1-0 thread-id redaction audit must prove ZERO real session/
thread ids before any state-root content is committed (implement P1-0 FIRST; P1-4 does not
land until it passes).

**Current state (verified).** The transport store
(`core/scripts/lib/wakeflow-delivery-store.mjs`) exposes only `removeWindowLock:167` as a
remove API (no `removePacket/removeRun/removeResult/removeEnvelope`); `supersededResultFileFor:230`
and `resultFileFor:225` already exist. `buildRuntimeSummary`
(`delivery-status-command.mjs:245-249`) lists all five transport dirs every call.
`complete-demand` (`wakeflow-state.mjs:1323-1418`) flips state to `completed` and leaves the
root in `.workspace-active`. Rework orphans: `import-target-result:836-851` auto-timestamps a
new `tr-…` file and leaves the prior flat file. Archived read-guards already fail-close
(`:610, :822, :991`). The archive template is `wakeflow-archive-docs.mjs` (dry-run default,
moves files, rewrites index, refuses dirs/non-`.md`). Committed tier:
`config.mjs:15 projectLedgerRoot='../wakeflow-ledger'`. Redaction primitives exist
(`window-runtime.mjs:125, :149-155` `<redacted>`; `validateThreadId:30-40`).

**Landing design.** (1) PRUNE-RUNTIME (P1-3, folds P2-3/P2-4): new dry-run-default
`wakeflow-delivery prune-runtime` removing only fully-terminal artifacts, gated by a
`pruneWouldBreakReplay` check so an in-flight idempotency replay can never be broken; folds
P2-3 (move flat orphans to `superseded/`) and P2-4 (unlink retired-window registry files
keyed strictly off config-removal). (2) P1-0 REDACTION GUARD (blocks P1-4): new
`core/scripts/lib/wakeflow-redaction.mjs` `scanStateRootForRealIds` that REFUSES on any
non-placeholder real id, redacting only into a COPY under `--redact`, recording
`redactedFields`. (3) ARCHIVE-DEMAND (P1-4): new `wakeflow-state archive-demand` that
refuses unless `state==='completed'`, runs the P1-0 guard as a hard precondition, writes
`state:'archived'` + a `demand.archived` event BEFORE the move, relocates the guard-cleaned
root into the committed ledger, rewrites the active index, and verifies no dangling
delivery-envelope references the old path.

**Data-model / schema changes.** No new task fields. New event type `demand.archived`
(schema-complete — see verifier note). New committed ledger location
`<projectLedgerRoot>/workspace/archive/<month>/<topic>/<slug>/` + an `archive-manifest.json`
recording `{demandKey, archivedAt, redactedFields[], sourceStateRoot, reason}`. Prune is
delete-only on the gitignored tier (no schema). `archived` is already in the enum.

**New / changed commands and tools.** NEW `wakeflow-delivery prune-runtime [--before]
[--keep-last] [--state-root…] [--write]`; NEW `wakeflow-state archive-demand --state-root
--reason [--redact] [--write]`; NEW MCP tools `wakeflow_prune_runtime`,
`wakeflow_archive_demand` (both dry-run default; archive exposes no force-skip of the
redaction guard).

**Exact touchpoints.** `delivery-store.mjs:167-274` (new remove/move/superseded helpers);
`wakeflow-delivery.mjs:230-243, :808-868` (prune command); `wakeflow-idempotency.mjs:167-222`
(new `pruneWouldBreakReplay`); NEW `lib/wakeflow-redaction.mjs`;
`wakeflow-state.mjs:836-851, :1323-1418, :1504-1534` (archive-demand + route rework collision
through superseded); `wakeflow-archive-docs.mjs:178-491` (extract a reusable mover —
see correction); `wakeflow-setup.mjs:2181-2206` (extract retired-window cleanup, carry the
legacy-registry branch); `core/lib/wakeflow-mcp-tools.mjs` (two new tools).

**Edge cases.** In-flight replay → refuse to delete a run/result still in a surviving
`repeatedDeliveryAttempts` chain. Real id in `controller-events.jsonl` evidenceRefs → refuse
(no auto-redact). Absent envelope ref → treated as clean. Retired-window prune must not
unlink a still-configured window. Two-host transport is SHARED (see correction). Index row
already hand-edited/missing → still move, report not-rewritten.

**Test plan.** prune dry-run (zero deletions) vs `--write` (only accepted-group removed,
replay-chain retained, dup still detected on survivors); `--keep-last`/`--before`
intersection; P2-4 retired-window unlink; P2-3 superseded; new `wakeflow-redaction.test.mjs`
(refuse on real UUID, redact-into-copy, placeholder passes); P1-4 archive dry-run→`--write`
(state archived, event appended, relocated, manifest written, index rewritten, no dangling
ref; REFUSES on planted real id without `--redact`); full bar.

**Completion definition.** `wakeflow_prune_runtime` removes only fully-accepted/superseded
artifacts + retired-window files with a `pruneWouldBreakReplay` gate (test-asserted dup
still detected on survivors); the state-script rework path no longer leaves flat orphans;
the redaction guard refuses on any non-placeholder real id; `wakeflow_archive_demand` writes
`archived`, relocates the cleaned root into the committed ledger, writes a manifest, refuses
unless `completed` AND the audit passes — P1-4 cannot land before P1-0; dry-run defaults
hold; `check:core` green, 215 bar + new test green. **NEEDS-USER-CONFIRMATION: this commits
state-root content to git for the first time and adds two MCP surfaces.**

**Non-goals.** No keep-live change (P1-2); no shared lock-helper extraction here (P1-5);
no enum-drift correction (P2-6); no Ajv; no reopen/reversal (RA3 owns G4); no transport
index/query API; no auto-archive on complete.

**Dependencies.** P1-0 guard must land/pass BEFORE archive-demand (hard gate); prune-runtime
should land first so terminal transport is cleared before archive verifies no dangling
reference; reuses (without changing semantics) `buildReplaySummary` and the archive-docs
mover; shares the transport tier with P1-5/P2-10 (coordinate lock handling);
`host-profile.handleId` id-shapes must be confirmed per edition.

**Risks.** Over-prune (mitigated by the replay gate + dry-run + accepted-group scope —
HIGH-attention). Committing redacted content is irreversible once pushed — refuse-by-default,
redact-into-copy-only, mandatory human audit before `--write` (single most safety-critical
part). Moving a root changes `--state-root` resolution (pre-move dangling-reference check).
Retired-window prune over a mis-synced config. Extracting the archive-docs mover risks
regressing the existing archive. Slug empty-fallback divergence.

**Feasibility note — NEEDS-ADJUSTMENT.** Most touchpoints real and located. Three load-bearing
corrections:
1. The redaction guard's central premise is FALSE: persisted delivery envelopes do NOT embed
   raw `threadId` — `dispatch-commands.mjs:240-246` and `controller-return.mjs:98-104` build
   `targetThread` with only `{windowName, threadIdRedacted:true, threadRegistryFile}`. The
   ONLY raw id lives in `hosts/<host>/thread-registry/<window>.json`, OUTSIDE the state-root
   tree and never moved by archive-demand. Re-scope the guard to free-text anomaly scanning
   of state-root files (this actually LOWERS leak risk and strengthens the commit-to-git
   posture); drop the false "envelopes carry raw ids" justification (keep an envelope scan
   only as defense-in-depth that normally finds nothing).
2. The scanner's real-id regex source does NOT exist: `host-profile.handleId` contains only
   `{placeholders, realIdRequirement}` (no regex/UUID/shape field). A new id-shape field must
   be ADDED to BOTH per-edition host-profiles (the one `HOST_LOCAL_CORE_FILES` member);
   `check:core` will NOT cross-check it, so per-edition tests are mandatory.
3. `archive-docs`'s mover CANNOT relocate a directory tree (it refuses dirs and is `.md`-only,
   `:171`); archive-demand needs a NEW recursive directory mover, not an extraction.
   Secondary: cross-host transport is SHARED (not per-host) so prune must honor both hosts'
   locks/runs; the `demand.archived` event must be schema-complete
   (`controller-event.schema.json` `additionalProperties:false`, 11 required fields — mirror
   `complete-demand` at `wakeflow-state.mjs:1366-1386`); `ensureInsideAllowedRoots` is a local
   `wakeflow-state.mjs:224` function (not shared — extract first); the setup legacy-registry
   branch must be carried into the store helper.

---

### RA7 — Dead-code retirement + contract hardening

**Requirement (derived authority).** Upgrade-plan resolved decisions + the P-item table:
retire the three dead capabilities, add the allow-list↔caller cross-check, add the
equality-only version-parity test, fix the enum reference-only, expose
withRuntime/strictRuntime on MCP, and add the additive lock tests. Every deletion is
NEEDS-USER-CONFIRMATION; the design preserves those gates and asks for sign-off.

**Current state (verified).** DEAD SURFACES: (a) `wakeflow-compact-index.mjs` exists; its
sole CODE reference is the allow-list entry `core/lib/wakeflow-runtime.mjs:29` (no MCP/CLI/
spawn caller). (b) Literal `--require-todo`/`--require-task-packages` lines ship at
`plugins/claude-code-wakeflow/CLAUDE.md:521,523` and `plugins/codex-wakeflow/AGENTS.md:505,507`;
verify never reads them. (c) `bin/wakeflow-mcp.mjs` is a 3-line shim pinned alive only by
`wakeflow-validate.mjs:42`; the real entrypoint is `mcp/server.cjs`. GUARD GAP:
`wakeflow-check-scripts.mjs` is a README-documentation checker only. VERSION PARITY: five
fields all `0.5.8`. ENUM: `wakeflow-state.schema.json:32-47` omits the written `dispatched`,
lists never-written values; no Ajv. VERIFY MCP SURFACE: `wakeflow_verify`
(`mcp-tools.mjs:528-534`) exposes only `{root, scriptTests}` though the CLI fully supports
withRuntime/strictRuntime. LOCK-TEST GAPS: state-script lock-release (F51), dispatch
cross-host fail-closed (`dispatch-commands.mjs:216-217`, F52), TTL self-heal (F53) untested.
CORE-ROOTED DEV IMPORT (P2-12/F14, verified-as-deferred-debt): running
`wakeflow-validate.mjs` / delivery directly from `core/` crashes with
`ERR_MODULE_NOT_FOUND` because only `scripts/lib/wakeflow-host-profile.mjs` is the
`HOST_LOCAL_CORE_FILES` member (`tools/sync-core.mjs:59-60`); the other host-rendered
imports resolve only inside a synced edition. This is a maintainer-ergonomics defect, not
a runtime defect (both synced editions run clean), so it is additive and Wave-A-class.

**Landing design.** Wave A (additive, no behavior change) FIRST: the allow-list↔caller
cross-check, version-parity test, enum fix, verify-surface expose, the three lock tests,
and the P2-12 core-rooted-import guard (a clear "run from a synced edition" error or a
sync-excluded dev stub — NOT a new copied core file, so `check:core` count stays 63) —
so the new guards are in place before Wave F (the confirmation-gated deletions). After
user sign-off, retire compact-index (file + allow-list + both `scripts/README.md` + both
skill `script-pipeline.md` lines), the `--require-*` lines (both memory files), and the bin
shim (core/bin + both editions/bin + validate requiredFiles + all README tables including
repo-root). After every change: `sync:core`, `check:core`, `npm test`.

**Data-model / schema changes.** `.state` enum reference-only: ADD `dispatched`; REMOVE the
four pure-vestige values `idle`, `designing`, `needs-confirmation`, `dispatching` (zero
connection to `state.state` — never written and never a `state.state` read-guard). SAFETY
CAVEAT: KEEP `accepting` and `paused` in the `state` enum — they are never written but ARE
referenced by live `state.state` read-guards (`wakeflow-state.mjs:613` checks
`state==="accepting"`; `:610/:822/:991` check `paused`), so removing them would desync the
guards from the enum. This edit touches ONLY the `state` enum in
`core/schemas/wakeflow-state-machine/wakeflow-state.schema.json`; `accepting` also lives as
the `candidateState` value (`:1045`, a SEPARATE unbound field) and `needs-confirmation` in
the Design-handoff enum (`wakeflow-import-design-handoffs.mjs:37`, verified live) — do NOT
grep-and-delete these strings repo-wide. (IMPLEMENTED in Wave 0: the enum is now the 11
values {intake, planned, dispatched, waiting-results, review-ready, accepting, needs-rework,
blocked, paused, completed, archived}, guarded by `test/wakeflow-state-schema.test.mjs`. The
earlier draft erroneously swapped `idle`↔`accepting` in the removal list; corrected here.)

**New / changed commands and tools.** No new CLI subcommands. `wakeflow_verify` gains
`withRuntime` + `strictRuntime` boolean inputs.

**Exact touchpoints.** `wakeflow-check-scripts.mjs` (new cross-check near `:140`);
`wakeflow-runtime.mjs:29` (delete allow-list entry); `wakeflow-compact-index.mjs` (delete);
both editions' `scripts/README.md` (compact-index line) and both editions' skill
`script-pipeline.md:103` (see correction); both editions' memory files (`--require-*` lines);
`core/bin/wakeflow-mcp.mjs` (delete) + `wakeflow-validate.mjs:42` + all README tables
including repo-root (see correction);
`core/schemas/wakeflow-state-machine/wakeflow-state.schema.json:32-47` (enum);
`core/lib/wakeflow-mcp-tools.mjs:528-534, :932-937` (verify surface).

**Test plan.** Cross-check unit test (orphan flagged / caller not flagged / exception set not
flagged / pre-deletion flags compact-index / post-deletion clean); version-parity test (five
fields equal, equality-only, no write path); enum-shape test; verify-surface test; F51
state-script lock-release; F52 dispatch cross-host fail-closed; F53 TTL self-heal; P2-12
core-rooted-import guard (running `wakeflow-validate.mjs` from `core/` gives a clear
run-from-a-synced-edition message or runs against a dev stub, and `check:core` is unaffected
— still 63 core files); per-edition grep gates (`--require-`, compact-index,
`wakeflow-mcp.mjs`); full regression.

**Completion definition.** All deletions have explicit user sign-off with named-replacement +
import-scan evidence; the cross-check exists and demonstrably flagged compact-index
pre-deletion; the version-parity test asserts equality only; the enum contains `dispatched`,
omits the 4 never-written values, byte-identical, no Ajv; `wakeflow_verify` exposes and
forwards withRuntime/strictRuntime; the new lock tests pass; the P2-12 core-rooted run no
longer crashes with a bare `ERR_MODULE_NOT_FOUND` and `check:core` count is unchanged;
`check:core` + full `npm test` green.

**Non-goals.** Do not implement real `--require-*` flags; no Ajv; no version bump (parity
asserts equality only); do not wire compact-index into archive; do not touch the codex
`.agents/plugins/marketplace.json` version, the catalog `metadata.version:1.0.0`, or the root
`package.json:0.0.0`; do not reorganize the scripts seam; do not retire the delivery
register-thread/build-window-config vestigial paths (F16, separate); do not change the
`package.json` bin entry (already targets `mcp/server.cjs`).

**Dependencies.** Wave A before Wave F (so the cross-check catches compact-index first); the
compact-index allow-list removal must land WITH the file + both `scripts/README.md` edits;
user sign-off on each deletion is a hard precondition; a repo-wide grep for the 4 removed enum
values must complete clean before the enum edit.

**Risks.** compact-index deletion ordering (file + allow-list + both README lines atomic, or
verify breaks mid-flight). The cross-check must correctly classify dev-only passthrough
entrypoints. Version-parity test must read the marketplace version from the right file.
Memory/README/skill edits are per-edition (grep gates required). Enum value removal needs the
grep to distinguish three enum namespaces. Empty `bin/` after shim removal.

**Feasibility note — NEEDS-ADJUSTMENT.** Deletions correctly evidenced; additive items sound.
Four corrections required before landing:
1. The F8 cross-check's caller-surface model is too narrow and will FALSE-POSITIVE on ~7 live
   allow-list entries (`wakeflow-progress-log` called via `runWakeflowRuntime` from
   `wakeflow-intake.mjs:249`; `validate`/`smoke` via `package.json` scripts;
   `check-repository-residue/-boundary/-layout` + `verify-workspace-docs` via `path.join`
   spawns in `wakeflow-verify.mjs:24,29,55,64`). The check must scan `runWakeflowRuntime` in
   ALL runtime scripts + `package.json` scripts + `wakeflow-verify.mjs` spawns, or widen the
   exception set — else verify fails closed on landing.
2. compact-index has a MISSED per-edition skill touchpoint at both
   `skills/wakeflow-governance/references/script-pipeline.md:103` (the design's "zero skill
   refs" claim is FALSE). Add it and extend the grep gate to `plugins/*/skills/**/*.md`.
3. The version-parity 5th-field path is WRONG: the field is at repo-root
   `.claude-plugin/marketplace.json:16` (plugins[0].version), NOT under
   `plugins/claude-code-wakeflow/` (that file does not exist); the same file's
   `metadata.version:1.0.0` must be EXCLUDED. The codex `.agents/plugins/marketplace.json`
   has no plugin version, so a naive both-marketplaces assertion crashes.
4. bin-shim removal misses repo-root `README.md:478` and `README.zh-CN.md:421` rows (outside
   the `plugins/*` grep scope). Add them and broaden the grep.

   Enum safety nuance: removal is safe ONLY because `candidateState`
   (`transition-candidate.schema.json:12`) is an unbound free string; `accepting` survives as
   4 live read-guard/candidate literals (`state.mjs:613/1045`, `intake.mjs:289`,
   `dispatch-commands.mjs:338`) and `needs-confirmation` is a SEPARATE Design-handoff enum
   (`import-design-handoffs.mjs:37`, test-asserted). The pre-landing grep must distinguish the
   three enum namespaces. (The verify-surface and bin-shim-removal touchpoints verified
   sound.)

---

## 4. Cross-area sequencing — dependency-ordered waves

All seven areas land in `core/` only, keep both editions byte-identical, and hold the 215
bar. Sequencing respects the verified dependencies and the upgrade-plan Wave model.

**Wave 0 — additive guards + reference fixes (independent, no behavior change).**
- RA7 Wave A: allow-list↔caller cross-check (with the WIDENED caller-surface from the
  correction), version-parity test, enum reference-only fix, verify-surface expose, F51/F52/F53
  lock tests, P2-12 core-rooted-import guard. Landing the cross-check FIRST lets it
  demonstrably flag compact-index before deletion and registers RA1's future handler as a
  legitimate caller.

**Wave 1 — read-only observability (mostly independent; can parallelize after Wave 0).**
- RA2 counters + `wakeflow_task_ledger`. (RA2 `dispatchCount`/`reworkCount` feed RA4's card
  and RA5's slices once they exist — so RA2 should precede the points where those areas surface
  counts, but neither RA4 nor RA5 BLOCKS on RA2: both ship with status-derived counts.)
- RA4 `wakeflow_window_view` (Phase 1, derived, no schema change). Soft-depends on RA2 for
  per-task counts; do NOT block.
- RA5 structured slices + index + focus-doc + anchor-check-as-WARNING. Depends on the
  `projection.schema.json` edit landing in the same wave.

**Wave 2 — state-flow robustness (the structural core; sequence carefully).**
- RA3 by pillar: the shared lock helper (Pillar 2, Wave B) lands BEFORE the P2-10 state-only
  case folds in; the spawn/SIGKILL/classification (Pillar 3, Wave A-class) is independent; the
  transactional commit reordering (Pillar 1, P2-7) sequences LAST because it touches every
  reducer; the staleness signal complements the in-flight surfacing. RA3's
  unify-lock-release/unify-transitions should precede RA6 GC so the transport tier has one
  lock authority before prune-runtime reasons about locks.

**Wave 3 — lifecycle GC + committed archival (gated, sequenced last).**
- RA6: prune-runtime (P1-3, folds P2-3/P2-4) FIRST so terminal transport is cleared; then the
  P1-0 redaction guard MUST land and pass; only then archive-demand (P1-4). RA6 archival is
  hard-gated by the P1-0 redaction prerequisite. RA3's `reopen-demand` (G4) and RA6's
  `archive-demand` share the terminal-state lifecycle and the P1-0 gate — coordinate so reopen
  does not bypass redaction.

**Cross-cutting invariants for every wave.** Every `core/` change keeps both editions
byte-identical (`check:core` green) and the 215 tests green; per-edition memory/skill/README
edits use grep gates (not `check:core`); no version field is bumped; no owned capability is
deleted without a named replacement + import-scan.

**Independent areas.** RA1 (Design-gated claim) is independent of Waves 0–3 in code terms but
should land after/alongside the RA7 cross-check; it is otherwise self-contained. RA4 Phase 1
and RA5 PART 1–3 are independent of each other. RA7 Wave A is independent of everything; RA7
Wave F (deletions) depends on Wave A + user sign-off.

---

## 5. Governance and guardrails

Confirmation gates and standing boundaries that apply across the proposal:

- **RA1 moves a confirmation gate to Design authority.** A Design-confirmed
  `controller-claimable` row becomes auto-claimable via `wakeflow_claim_next`; the gate is
  MOVED, not removed, and dispatch/acceptance gates stay intact. This changes the controller
  autonomy boundary and is the single load-bearing user decision. Authority is a ROLE
  convention, not a code-enforced ACL — hard enforcement is additional scope. CRITICAL: the
  claim does NOT bypass per-demand user confirmation — `controller-claimable` can only be
  validly set on a row whose `userConfirmationStatus` is already `confirmed` or `not-required`
  (the same `readyConfirmationStatuses` invariant `ready-for-workspace` enforces today,
  verified in `wakeflow-import-design-handoffs.mjs`). The tool auto-claims an
  already-user-confirmed, Design-typed demand into init only; it never self-authorizes an
  unconfirmed demand, never auto-picks among multiple rows, and never auto-dispatches.
- **RA6 redaction is a hard prerequisite.** No state-root content is committed to git until the
  P1-0 redaction guard proves ZERO real session/thread ids (refuse-by-default,
  redact-into-copy-only, mandatory human audit before `--write`). P1-4 cannot land before P1-0.
  Real thread ids live only in `.workspace-local`; they must never enter tracked docs, GitHub,
  prompts, or backfill.
- **Do not delete owned capabilities without a named replacement + import-scan.** Every RA7
  deletion carries import-scan evidence and a named real entrypoint
  (compact-index → archive flow retired with zero callers; bin shim → `mcp/server.cjs`;
  `--require-*` → unimplemented). External deletion still requires a clean import scan, a
  connected replacement, and representative checks.
- **Version bumps are user-controlled.** No area bumps any version field; RA7's version-parity
  test asserts equality only, with no write path.
- **Byte-identity.** Every `core/` change must pass `check:core` and stay byte-identical across
  both editions. Per-edition memory/skill/README files are existence-checked only, so their
  edits are guarded by per-edition grep gates, not `check:core`.
- **Schema is reference-only.** No area adds runtime Ajv; enum/shape edits are documentation
  corrections.
- **Counts and metrics are not gates.** RA2 handling-counts are decision evidence, never a
  completion proof; RA3's staleness is a SIGNAL feeding controller judgment, never an
  auto-fail; "silence is never auto-judged."

---

## 6. Confirmation questions before execution

Per area, the concrete decisions still required.

**RA1.** (1) Confirm MOVING the original-plan/requirement-design gate to Design via a typed
`controller-claimable` status (the load-bearing autonomy-boundary decision)? (2) New distinct
status value vs `ready-for-workspace` + an explicit boolean column? (3) Role convention
sufficient, or code-enforced authority (additional scope)? (4) Claim init-only (recommended)
or also seed initial task packages? (5) Where do `goal/completionDefinition/stagePlan` come
from — new explicit board columns (recommended; none exist today) or a fragile doc-parser?
(Note: the `CLAUDE.md`/`AGENTS.md` edit-point question is already answered — those files are
hand-maintained per edition, not core-templated.)

**RA2.** (1) Confirm persist-at-write for `dispatchCount`/`reworkCount` + derived-at-read for
`retestCount`/`supplementCount`? (2) `supplementCount` surfaced per-task via `demandKey` join,
or only at the demand rollup? (3) New `wakeflow_task_ledger` tool (recommended) vs folding the
rollup into `wakeflow_review_pack` with no new tool? (4) Extend the durable `review.decided`
event to carry `targetTaskIds` (exact event-derived rework audit, larger scope)? (5) Optional
documentary schema edit, or leave schemas untouched (no change needed)?

**RA3.** (1) `reopen-demand`: completed→planned by default (+ optional `--as-rework`), honoring
the P1-0 redaction gate for any archived root? (2) Same-host fail-closed only under an explicit
unattended flag/env? (3) Delivery-staleness default age (e.g. 30 min) — status arg,
workspace-config, or both? (Stays a SIGNAL.) (4) `dispatched`+add: demand STAYS `dispatched`
(documented mid-flight)? (5) Enum reference-only correction, no Ajv? (6) Both record-target-result
entrypoints stay (resolved decision 6), only the shared lock-release unified?

**RA4.** (1) Ship Phase 1 only (derived card, no schema change) and defer the Phase-2
materialized slice? (2) Top-level `wakeflow_window_view` tool (+ priority list) vs a `--window`
mode on an existing tool? (3) Status-derived counts now (per-task counts via RA2 later) or a
minimal `reworkCount` immediately (larger scope)? (4) Emit BOTH file-area tiers (confirm
breadth) vs a state-root-only card? (5) Pin transport paths with a test vs extract dir-name
constants into a shared helper?

**RA5.** (1) Additive `projection.slices` (keep lossy strings) vs replace (breaking)? (2)
`wakeflow_focus_doc` as an MCP tool now vs CLI-only first? (3) Per-phase brief: `--window` now +
`--phase` best-effort on `activeStageId`, or sequence behind G11(a)'s per-task `stageId`? (4)
Anchor checking as a non-blocking WARNING first (recommended) vs a hard gate? (5) Confirm
generated state-root docs stay in gitignored `.workspace-active` (not committed by this area)?

**RA6.** (1) Confirm the committed archive location
`<projectLedgerRoot>/workspace/archive/<month>/<topic>/<slug>/` vs a separate top-level ledger
dir? (2) Redaction policy on a real id inside `evidenceRefs`: refuse-and-require-human
(proposed) vs allow `--redact` with a partial audit-chain break? (3) prune-runtime requires an
explicit `--state-root` list vs defaults to scanning all `current/` roots? (4) Default
retention when neither `--before` nor `--keep-last` is given: prune ALL terminal artifacts
(proposed) vs require a bound? (5) Should the two new MCP tools be host-visible on the installed
controller, or CLI/source-only? (6) Should archive-demand fold a record-map entry the way
archive-docs does? (Plus: confirm the corrected redaction scope — free-text anomaly scanning,
since envelopes/state are id-free by construction — and that a new id-shape field is added per
edition to `host-profile.handleId`.)

**RA7.** (1) Confirm retiring (deleting) `wakeflow-compact-index.mjs` entirely (file +
allow-list + both `scripts/README.md` + both skill `script-pipeline.md:103` lines)? (2) Confirm
deleting the `--require-*` lines from both memory files (vs implementing real flags) — generic
MCP-verify line or full removal? (3) Confirm removing the bin shim + validate entry + all README
rows (including repo-root); should the `package.json` `files` glob `bin/` entry stay or go? (4)
Confirm the enum fix reference-only, no Ajv? (5) Confirm exposing withRuntime/strictRuntime on
the `wakeflow_verify` MCP schema? (6) Confirm the version-parity test asserts equality ONLY
across the five fields (codex `.codex-plugin/plugin.json`, codex package.json, claude
`.claude-plugin/plugin.json`, claude package.json, and `.claude-plugin/marketplace.json:16`
`plugins[0].version` — EXCLUDING the catalog `metadata.version:1.0.0` and the codex
`.agents/plugins/marketplace.json`, which carries no plugin version), never auto-bumping? (7)
P2-12: fix the `core/`-rooted dev-import crash via a clear run-from-a-synced-edition error
(recommended, zero new core file), or via sync-excluded dev stubs — or leave it deferred?

---

*End of unified requirement design. Proposal for user confirmation; not executed work.*
