# Wakeflow State-Flow Capability Assessment

> Generated 2026-06-19 from an adversarially-verified read of current source; assessment, not executed work.

This document answers seven user questions about whether Wakeflow's state flow, document
records, and dispatch surfaces are good enough to support an unattended controller. Every
verdict is grounded in source `file:line` evidence from the core edition
(`/Users/gaoxuefeng/Documents/CodexPlugin/Wakeflow/core/...`, the byte-identity source of
truth synced into both plugin editions). Where the original investigation verdict was
re-checked by an adversarial verifier, the corrected (held) verdict is used. Confidence is
stated per finding; low-confidence claims are flagged as such and never presented as fact.

Verdict badges: **EXISTS** (fully real), **PARTIAL** (real but incomplete or inconvenient),
**WEAK** (a thin/lossy/markdown-only stand-in), **MISSING** (no implementation).

---

## Q1. Do TODO/Backlog and task package (renwu-bao) exist as real features today?

**Task package: EXISTS.** **TODO/Backlog: WEAK (markdown-only convention).**

A **task package is a fully real state-machine entity** — confidence high:

- Schema requires `schemaVersion/taskPackageId/demandKey/summary/status/targetTasks`
  (`core/schemas/wakeflow-state-machine/task-package.schema.json:6`).
- The reducer `commandAddTaskPackage` (`core/scripts/wakeflow-state.mjs:596-718`) writes a
  persisted `task-packages/<id>.json` (`status:'pending'`, `targetTasks[]`), pushes into
  `state.taskPackages[]` and `state.targetTasks[]`, bumps `revision`, appends a
  `task-package.added` event to `controller-events.jsonl`, gates on demand state
  (`:610-618` forbids add while completed/archived/paused/review-ready/accepting/
  waiting-results/blocked), and calls `ensureDemandHostOwnership` (`:608`).
- It is reachable via MCP as `wakeflow_add_task` (`core/lib/wakeflow-mcp-tools.mjs:208`,
  handler `:677`).

A **TODO/Backlog is NOT a real data store** — it is a Markdown board parsed by regex/table
scripts; confidence high:

- The board paths are markdown files: `globalTodoPath =
  .workspace-active/workspace/current/global-todo-board.md`
  (`core/scripts/lib/wakeflow-config.mjs:25`) and `designHandoffBoard =
  design-handoff-board.md` (`:35`).
- Reading is regex table parsing: `parseTodoCandidates`
  (`core/scripts/wakeflow-next-work.mjs:244-309`) reads the `## Global TODO` section via
  `tableRows`/`rowObject` and column-maps `ID/Status/Priority/Recommended Window/Owner`.
- Writing/archiving is markdown rewriting: `wakeflow-archive-todo.mjs:139-238` slices
  completed rows by `isCompletedState` and rewrites the board plus an archive `.md`
  (`writeFileSync`, no JSON/DB).
- There is **no `todo` field in any state-machine schema** (verified by exhaustive grep of
  `core/schemas/wakeflow-state-machine/*.json`). Eligibility even depends on a human-typed
  `Status` string literally containing `pending automation|candidate|...`
  (`wakeflow-next-work.mjs:289`).

**Precise gap:** authority and status for TODO/Backlog live in free-form markdown cells, not
in the state machine. The task-package entity is solid; the "Backlog" it is supposed to be
drawn from is an un-typed scheduling ledger with no validation, so an automated loop's
eligibility decision is gated on a free-text string match.

---

## Q2. Can an unattended controller autonomously CLAIM an already-designed demand/TODO (self-driving)?

**PARTIAL — not through the surface an installed controller is allowed to use.** Confidence
high.

- `wakeflow_next_work` is **advisory only**. `wakeflow-next-work.mjs` computes
  `autoClaimable` (`:389`) but the `--write` path (`:415-419`) only dumps a candidate JSON to
  `.workspace-local/wakeflow-intake/wakeflow-next-work.json`. Grep confirms it contains **no**
  state-init or add-task call. Its own `agentNext` (`:408-409`) states: "Total control may
  claim the single eligible candidate by creating or updating a current plan; scripts still
  must not accept evidence or dispatch without the plan gate."
- A real auto-init+add chain **does exist** but is unreachable from MCP:
  `wakeflow-demand-sequence.mjs claim-next --write` (`claimItem :399-445` calls
  `wakeflow-state init` then `add-task-package`, driven by `commandClaimNext :484-568`). It
  requires a **pre-authored `ControllerDemandSequenceManifest`** validated for
  `goal/completionDefinition/stagePlan/developerDoc/initialTaskPackages` (`readManifest
  :116-169`, `validateDeveloperDoc :200-222`), and explicitly never dispatches or accepts
  (`:27-33`, `:558-566`).
- This chain is **NOT exposed via MCP**: exhaustive grep finds `demand-sequence` only in
  `wakeflow-cli.mjs:287/320` and the generic script map `wakeflow-runtime.mjs:33` — zero
  matches in `wakeflow-mcp-tools.mjs`. `CLAUDE.md` forbids the installed controller from
  calling raw CLI sequence paths.
- The canonical smoke chain (`wakeflow-smoke.mjs:337-369`) hand-calls `wakeflow_init_demand`
  then `wakeflow_add_task` with manually authored `goal/completionDefinition/stagePlan` and
  **no `next_work`/`claim` in between**.

**Precise gap:** nothing chains a next-work candidate into `init_demand`+`add_task` through
the MCP surface — they are three separate manual tools. The one automated init+add runner
(`demand-sequence claim-next`) still needs a human-written manifest **and** is unreachable via
MCP. So an installed unattended controller cannot self-claim a fresh designed demand without a
human authoring either the `init_demand` args or the sequence manifest. This is an
**intentional confirmation gate** (`CLAUDE.md` Confirmation Gates + the next-work plan-gate
wording), not merely absent code — a distinction that matters for any "self-driving" proposal.

---

## Q3. Is the state flow robust / inclusive / error-tolerant enough?

**PARTIAL (EXISTS for modeled states, WEAK at the silent-window / timeout boundary).**
Confidence high.

**Strong: every modeled non-happy state has a defined, tested exit.** The demand state
machine (7 reducers in `core/scripts/wakeflow-state.mjs`) writes only `intake / planned /
waiting-results / review-ready / needs-rework / blocked / completed` (+ transport-driven
`dispatched` from `result-recording-commands.mjs:166`). Exits:

- `blocked` (decide-review blocked, `:1201`) → import fresh result (`:832` allows
  non-accepted) → reduce-results → decide accept|rework clears the review-blocker
  (`:1246`). This is the single deliberate wedge and it has an **end-to-end test**
  (`test/wakeflow-state.test.mjs:1150`; full suite 21/21 pass on re-run).
- `needs-rework` → `add-task-package` lifts it to `planned` (`:632`) or `prepare-dispatch`
  re-sends (needs-rework is eligible, `dispatch-commands.mjs:341`).
- `waiting-results` → import remaining results → reduce.

**Strong: failure is classified distinctly across layers.** `summarizeRuntimeNextAction`
(`core/scripts/lib/wakeflow-runtime-summary.mjs:24-43`) priority-orders
`inspect-artifact-errors` > `inspect-delivery-failures` (status=failed) >
`review-delivery-blockers` (status=blocked). `buildRuntimeHealth` (`:54`) emits distinct codes
(artifact-errors=error, delivery-failed=error, delivery-blocked=warning), and
`buildRuntimeResumePlan` (`:271`) sets `stopRequired:true` for failures/blocks. Delivery-run
validation separates `sent` (needs `readback.ok`+evidence) from `blocked`/`failed` (need
`--error`) at `result-recording-commands.mjs:245-249`.

**Strong tolerance primitives:** idempotent replay on every write
(`result-recording-commands.mjs:114-118`, conflicting `deliveryId` fails closed `:116`),
atomic temp+rename (`delivery-store.mjs:39-50`), revision-stamped optimistic concurrency
(stale transition candidate rejected `wakeflow-state.mjs:1189`), cross-host demand-ownership
fail-closed (`dispatch-commands.mjs:206-207/359`, `result-recording-commands.mjs:101-103`),
and an advisory window lock with TTL + manual `release-window-lock` recovery including
corrupt-file removal (`wakeflow-delivery.mjs:632`).

**WEAK / unhandled modes (the real robustness gaps):**

1. **No timeout / silence detection.** A target window that receives a delivery and never
   returns parks the demand in `dispatched`/`waiting-results` **forever**, by explicit design
   ("silence is never auto-judged"). Exhaustive grep (`timeout|heartbeat|staleAfter|stalled`)
   finds only process-level pid waits in `keep-live.mjs:86,231` and a test-process timeout —
   **no per-delivery or per-window timeout/stalled classification exists**. A hung window is
   indistinguishable from a working one. This is the single biggest unattended-loop wedge.
2. **`completed` is an irreversible sink.** The reducer switch
   (`wakeflow-state.mjs:1506-1527`) has no reopen/reverse command; a premature
   `complete-demand` is unrecoverable in place.
3. **`add-task-package` does not guard `dispatched`.** The refuse-list (`:610-618`) omits
   `dispatched`, and `nextMainState` (`:632`) only lifts `intake`/`needs-rework`, so a
   mid-flight package add leaves the demand in an ambiguous `dispatched`+new-pending shape
   (unguarded but not fatal).
4. **Same-host window-lock collision is a warning, not fail-closed**
   (`dispatch-commands.mjs:219-221`), so two same-host deliveries to one window can race. (The
   per-task sent-state guard mitigates this; cross-host is fail-closed at `:216-217`.)
5. **`paused`/`archived` schema states are never written** — pure read-guards
   (`wakeflow-state.mjs:610,822,991`) with no producer. Any downstream tool expecting a
   pause/archive transition has nothing to drive it. (Corrected nuance from verification: they
   are active read-guards, not literally "dead vocabulary," but the operative fact — no
   producer for a pause/archive transition — holds.)

**Net:** the modeled flow is unusually careful (idempotent, fail-closed, atomic, tested
recovery). It is **not** robust against a silent/stalled window or a premature completion in an
unattended loop without human inspection.

---

## Q4. Is there UNIFIED management of state + handling-counts (chuli-cishu) across execution / acceptance / test / requirement-supplementation, VISIBLE to the controller?

**MISSING.** Confidence high. There is no per-task handling-count anywhere, and no single
rollup fusing execution + acceptance + test-card + design-handoff status.

**No handling-count exists.** The target-task object built at `wakeflow-state.mjs:635-646`
carries exactly `{targetTaskId, taskPackageId, targetWindow, summary, status, createdAt}`.
`decide-review` (`:1214-1220`) **overwrites** `{status, reviewDecision}` — it never
increments. The codebase's own comment confirms the design: a rework cycle creates a **new
timestamped result file** ("Default-id collision is the normal rework cycle",
`:842-846`), never a counter bump. Exhaustive grep for
`reworkcount|dispatchcount|retestcount|attemptcount|supplementcount|cishu|次数|返工` returns
nothing per-task. The only count-like fields are transport-level and point-in-time:
`repeatedDeliveryAttemptCount`/`deliveryAttemptCount` (`wakeflow-idempotency.mjs:208-209`,
keyed by `deliveryId` = resends of the *same* delivery, not rework cycles), `runCount` per
envelope (`delivery-status-command.mjs:95`), and `countBy(status)` tallies. `state.revision`
(`:630`) is one global per-demand monotonic counter, not per-task.

**No unified rollup exists.** Status is scattered and the evidence stores are write-only:

- Execution + acceptance live on `state.targetTasks[].{status, reviewDecision}`.
- Test-cards are separate files `stateRoot/test-cards/<id>.json` (`status:'draft'`,
  `wakeflow-intake.mjs:317-346`) with only a one-way `suggestedTaskPackage.targetTaskId` link.
- Design-handoff intake is a separate `stateRoot/intake/design-handoff-<key>.json`
  (`:214-262`) that carries `forbiddenConclusion: design-intake-updates-wakeflow-state`
  (`:256`) — it deliberately does NOT touch the state machine.
- The richest per-task view, `buildStateRootReviewPack`
  (`wakeflow-review-commands.mjs:356-393`), joins only
  targetTasks+results+evidenceRefs+verification+riskSummary+deliveryStatus — it does **not**
  read test-cards or intake, carries **no counts**, and filters via `controllerReviewScope`
  (`review-scope.mjs:10-28`) to **open tasks only**, dropping accepted-task history.
- Exhaustive grep confirms **no reader** of `test-cards/` or `intake/design-handoff` exists in
  any status/review/reduce/trace path — only mkdir/scaffolding paths.

**What the controller actually SEES is status-by-status, never count-by-count.**
`wakeflow_status` (`delivery-status-command.mjs:236-393`) exposes workspace/group-wide
file-count cardinality and `countBy(status)`. `review_pack` shows per-task status+evidence,
no counts. `trace_spine` coverage (`trace-spine-command.mjs:320-331`) is artifact cardinality.
The progress projection's unified-status block (`render-progress.mjs:237-253`) fuses
execution+windows+blockers+review+automation+decisions into one per-**demand** block — with
**zero counts** and rendering only `id(status)`.

**Precise gap:** to know a task was dispatched 3×, reworked 2×, tested, or supplemented, the
controller must **manually reconstruct** it from raw `controller-events.jsonl` (counting
`task-package.added`/`review.decided`/`delivery-sent` events itself) and separately open
`test-cards/` and `intake/` — none of which any status/review/trace tool joins or counts.
There is no unified count-management surface backing controller decisions.

---

## Q5. Can the current document records extract state and content well?

**PARTIAL (clean top-level JSON, WEAK sub-fields).** Confidence high.

`projection.json` is a real structured machine-readable file written separately from the human
markdown progress doc. `wakeflow-render-progress.mjs:254-275` builds
`{schemaVersion:1, demandKey, title, interfaceLanguage, sourceRevision, sourceEventId,
progressDoc, unifiedStatus{...}}` and writes it to `projection.json` (`:310`), distinct from
`developer-progress.md` (`:312`). So a consumer **can pull status as JSON without parsing the
big doc** — top-level fields (`mainState`, `sourceRevision`, `userDecisionsNeeded`) are clean
and queryable.

**Precise gap:** the `unifiedStatus` sub-fields are **lossy pre-flattened human strings, not
arrays of objects**: `windows` is a comma-joined `name(state), name(state)` string
(`summarizeWindows :196-199`); `currentTaskPackages` and `blockers`/`userDecisionsNeeded` are
likewise comma-joined (`summarizeItems :191-194`, `summarizeBlockers :201-204`). A consumer
wanting structured per-window or per-package data cannot get it from `projection.json` and must
fall back to parsing raw `wakeflow-state.json`. The projection is a status **summary**, not a
queryable structured mirror of the state.

---

## Q6. Can a given window quickly find the tasks that belong to it?

**PARTIAL — discovery is real but inconvenient and push-based.** Confidence high. There is no
single convenient "give me MY tasks" command.

Three paths exist, all requiring the whole state root:

1. **`trace-spine --target-window`** (`wakeflow-trace-spine-command.mjs:164-168`) filters
   `state.targetTasks` by `task.targetWindow === selector.targetWindow` and returns the
   matching tasks + their packages (`:289-355`). Exhaustive grep confirms this is the **sole**
   window-keyed targetTask retrieval in core. But it is a heavyweight evidence-spine scan over
   the entire demand (all packets/deliveries/results) and is framed as controller trace
   tooling, not window self-service.
2. **`state.windows[]`** (`wakeflow-state.mjs:1420-1442` `upsertWindowState`) carries
   `windowName + windowState + taskPackageIds[] + targetTaskIds[]`, but only as bare ID lists
   with a coarse rollup (`reduceWindowStates :1477-1488` collapses to
   waiting-results/blocked-result/result-ready) — no task detail, full state still loaded.
3. **`build-window-config`** (`wakeflow-window-runtime.mjs:157-173` →
   `buildWindowDispatchConfig`, `thread-registry.mjs:37-85`) returns
   identity/dispatchability (`repositoryPath/responsibility/dispatchable/threadRegistered/
   deliveryRole`) with **zero task data** (confirmed by reading the full return shape).

**Precise gap:** `window-config` has no tasks; `state.windows[]` has only ID lists + a rollup
status; `trace-spine --target-window` works but is a heavyweight controller-oriented scan. The
canonical per-window task list (`state.targetTasks` filtered by `targetWindow`) is reachable
only by loading and filtering the full state root. In practice discovery is **push-by-prompt,
not pull-by-query**: the target window learns its `taskId` from the delivery prompt
(`formatTargetPrompt :79-104` emits `currentWindow/taskId/stateRoot`) and reads state from
there. `next_work` scans the markdown "Recommended Window" ledger rows (`:274-287`), not
`state.targetTasks`, so it is not a "my tasks" pull either.

---

## Q7. Does the big per-demand document support TARGETED information retrieval and DIRECTED sub-file production?

**Targeted retrieval: PARTIAL. Directed sub-file production: WEAK (dispatch-path only).**
Confidence high.

**Slicing exists only along predefined dispatch dimensions.** `review-pack`
(`wakeflow-review-commands.mjs:672-719`) scopes to whole `--state-root` (returns all
reviewable target tasks) OR `--group`/`--task-id` (`computeReviewResults`), and buckets output
into `ready/blocked/missing/pendingDispatch` arrays (`:443-447`) — so "just blocked" is a
**derived field**, not a standalone query. `trace-spine` (`:224-235`) accepts
`--state-root/--group/--target-window/--task-id/--result-id/--delivery-id` — a genuine
selector-driven slice.

**Precise gap (retrieval):** there is **no phase/stage slice** (grep for
`--stage|--phase|stageId|phaseId` finds only `--stage-plan` as a free-text init input
`wakeflow-state.mjs:412` and `activeStageId` as a status field, never a slice selector) and
**no free-form predicate query** (e.g. "all blocked across all demands"). Every "slice"
re-scans all on-disk artifacts in memory each call (`trace-spine listJsonArtifacts :238-245`;
review-pack reads the full state root) — no indexed query, no reduced I/O.

**Directed sub-file production exists only for the dispatch path.**
`commandPrepareDispatchFromState` (`wakeflow-dispatch-commands.mjs:353-520`) reads the big
state root and emits a compact `ControllerDispatchPacket` (objective/scope/forbidden/
evidenceRequired/stateRef/navigation prompt, `:146-174`) plus a `DeliveryEnvelope`, each
written to its own file (`:462-463`); `formatTargetPrompt`
(`wakeflow-window-runtime.mjs:79-104`) is the directed per-window wakeup, and
controller-return envelopes (`commandBuildControllerReturn :522`) are a second generated
per-target sub-file.

**Precise gap (sub-file production):** exhaustive multi-pattern grep across all editions +
tests (`generateSubDoc|windowBrief|phaseBrief|per-phase|per-window|window-card|taskCard|
sliceState|stageBrief`) returns **zero** sub-doc generators. (The one `window-card` hit at
`plugins/claude-code-wakeflow/scripts/lib/wakeflow-claude-host.mjs:1209` is an unrelated
managed-CLAUDE.md access-card upsert.) `render-progress` only rewrites the single
unified-status marker block inside `developer-progress.md` (`:277-283`). Dispatch packets are
**task-scoped** (one per `--target-task-id`), so a window with N tasks gets N packets, never
one consolidated "my work" card. There is **no per-window task card, no per-phase/per-stage
brief generator, and no generic "distill state slice into a focused doc" capability.**

---

## Building blocks that already exist (primitives to reuse)

These are real, verified primitives that any gap-closing design should build on rather than
reinvent:

**Claim / scheduling (Q1, Q2):**
- `wakeflow-next-work.mjs` candidate scanner — ranks Design + TODO boards, emits
  `recommended`/`autoClaimable`/per-candidate blockers, and writes a stable candidate JSON to
  `.workspace-local/wakeflow-intake/wakeflow-next-work.json`.
- `wakeflow-demand-sequence.mjs claim-next --write` — the auto-init+add primitive (chains
  `wakeflow-state init` + `add-task-package` + render-progress for at-most-one demand from a
  manifest); the `ControllerDemandSequenceManifest` contract (`:116-222`) is already a
  structured machine-readable demand order.
- MCP `wakeflow_init_demand` + `wakeflow_add_task` handlers
  (`wakeflow-mcp-tools.mjs:661,677`) — the write tools a claim chain would invoke.

**State robustness / recovery (Q3):**
- `import-target-result` allowing fresh results on any non-accepted task
  (`wakeflow-state.mjs:832`) — the durable recovery primitive the blocked-wedge exit relies
  on; reusable for any rework/timeout-redispatch path.
- `decide-review blocked → accept|rework` clearing review-blockers (`:1246`) — the explicit
  unblock primitive; the model for an explicit `reopen` if `completed` ever needs reversal.
- Window delivery lock with TTL + `expiresAt` (`delivery-store.mjs:152`) and
  `release-window-lock` corrupt-lock recovery (`wakeflow-delivery.mjs:632`) — a stall detector
  could reuse `expiresAt`-style staleness on a delivery run's `sentAt`.
- `runtime-summary` nextAction priority ladder (`runtime-summary.mjs:24-43`) — a "stalled"
  branch keyed on delivery `sentAt` age slots in cleanly.
- Superseded-result mechanism (`result-recording-commands.mjs:445`) — supports replacing a
  stale result without losing prior evidence.

**Count / rollup substrate (Q4):**
- `controller-events.jsonl` — append-only per-revision audit written by **every** reducer
  (`wakeflow-state.mjs:172,605,988,1178,1331`), recording type/from/to/reason/stateRevision; a
  complete substrate from which per-task dispatch/rework/accept counts COULD be folded (today
  only listed by trace-spine, never aggregated).
- `buildReplaySummary` (`wakeflow-idempotency.mjs:167-222`) — already groups delivery-runs by
  `deliveryId`; extendable to group by `taskId`.
- `buildStateRootReviewPack` (`review-commands.mjs:356-393`) — the existing per-open-task join,
  the natural host for a fused rollup if it also read test-cards/intake + a count field.
- Test-card `suggestedTaskPackage.targetTaskId` and design-handoff
  `demandKey/stateRevisionObserved` (`intake.mjs:223-227,344-349`) — the join keys to fuse
  test-card and supplement status into a per-task rollup.

**Extraction / discovery / sub-files (Q5, Q6, Q7):**
- `projection.json` structured emitter (`render-progress.mjs:254-275`) — already a separate
  machine-readable JSON file; the single point to fix lossy comma-joined strings
  (`:196-199`).
- `trace-spine --target-window` selector (`trace-spine-command.mjs:164-168`) — the kernel of a
  "my tasks" per-window query.
- `state.windows[]` per-window index (`wakeflow-state.mjs:1420-1442`) — already maintains
  per-window task/package ID lists; the obvious carrier for a materialized per-window view.
- `buildWindowDispatchConfig` (`thread-registry.mjs:37-85`) — the per-window config artifact
  that is the natural home to attach a per-window task slice.
- `commandPrepareDispatchFromState` packet/envelope generator
  (`dispatch-commands.mjs:353-520`) — the existing "read big state → emit focused compact
  artifact to its own file" distillation pattern; reusable for a per-window consolidated card.
- Trace selector merge/match helpers (`trace-spine-command.mjs:55-115`) — generic
  selector-driven filtering that could back a broader slice-query API.

---

## Gaps and design directions

Each direction lists the gap, a concrete proposal reusing the primitives above, and a
confirmation flag. **NEEDS-USER-CONFIRMATION** marks anything that adds scope, changes visible
behavior, or rewires a capability — consistent with `CLAUDE.md` Confirmation Gates.

**G1 — No MCP-reachable self-claim chain (Q2).**
- Direction: add a `wakeflow_claim_next` MCP tool wrapping `wakeflow-demand-sequence.mjs
  claim-next` so the auto-init+add chain becomes reachable from an installed controller
  (today CLI-only and `CLAUDE.md`-forbidden), keeping the dry-run/`--write` split. Optionally
  teach `next-work` to synthesize a `ControllerDemandSequenceManifest` item from a Design
  handoff (it already has goal/completion via linked requirement-design docs), or teach
  `demand-sequence` to ingest a next-work candidate JSON.
- **NEEDS-USER-CONFIRMATION** — adds a new MCP surface and, if true unattended self-claim is
  desired, an explicit machine gate (e.g. candidate carries `userConfirmationStatus=confirmed`
  + originalPlan + requirementDesign present, already validated at
  `import-design-handoffs.mjs:199-222`). This deliberately weakens an intentional confirmation
  gate and must be a user decision.

**G2 — TODO/Backlog is markdown-only (Q1).**
- Direction: promote TODO/Backlog rows from free-text to a typed candidate record (or at
  least a validated schema) so eligibility no longer depends on a `Status` string match
  (`next-work.mjs:289`), reducing the chance an unattended loop mis-claims or skips a designed
  item.
- **NEEDS-USER-CONFIRMATION** — adds a new data model/store and changes how the board is
  authored.

**G3 — No silent-window / timeout detection (Q3).**
- Direction: add a delivery-staleness **signal** (not auto-judgment): `runtime-summary`
  computes `age = now − deliveryRun.sentAt` and surfaces a `delivery-stale` info/warning issue
  past a configurable threshold, feeding `nextAction = inspect-possibly-stalled-window`. Keeps
  "silence is controller judgment" while making a silent window visible in the loop.
- **NEEDS-USER-CONFIRMATION** — adds a new issue class and visible behavior.

**G4 — `completed` is irreversible (Q3).**
- Direction: add a guarded `reopen-demand` command requiring `--reason` + `--evidence-ref`,
  mirroring the `decide-review blocked → unblock` pattern, so a premature completion is
  recoverable in place rather than only via a new demand.
- **NEEDS-USER-CONFIRMATION** — adds a lifecycle transition and reverses a terminal state.

**G5 — `add-task-package` does not guard `dispatched` (Q3).**
- Direction: either add `dispatched` to the refuse-list or make `nextMainState` explicitly
  handle it, so mid-flight package additions cannot leave the demand in an ambiguous shape.
- **NEEDS-USER-CONFIRMATION** — changes reducer gating behavior.

**G6 — Same-host lock collision is advisory (Q3).**
- Direction: promote same-host window-lock collisions from warning to a confirm-or-fail gate
  in unattended mode (`dispatch-commands.mjs:219`), since the advisory warning is invisible to
  an automated loop.
- **NEEDS-USER-CONFIRMATION** — changes dispatch behavior.

**G7 — Dead `paused`/`archived` enum + 4 never-written values (Q3).**
- Direction: prune the never-written enum values or wire real producers; at minimum document
  `paused`/`archived` as read-guards-only so downstream tools don't assume a transition
  exists. (Cross-links the upgrade plan's resolved enum decision — see below.)
- **NEEDS-USER-CONFIRMATION** — schema/contract change (enforce-vs-documentary decision).

**G8 — No per-task handling-count / unified rollup (Q4).**
- Direction options, in increasing scope:
  1. A **derived** read-only command (e.g. `wakeflow-state task-ledger` or an extension of
     `wakeflow_status`) that folds `controller-events.jsonl` into per-`targetTaskId` counts
     (`dispatchedCount` from delivery-sent events, `reworkCount` from `review.decided=rework`,
     `acceptedAt`) and joins `test-cards/<id>.json` status + `intake/design-handoff-*.json` by
     `targetTaskId`/`demandKey`. No state-write change; lowest risk.
  2. **Persist** counts on the targetTask at write time (`task.dispatchCount++` in
     `markStateRootDeliverySent`, `task.reworkCount++` in the `decide-review` rework branch),
     replacing the in-place `reviewDecision` overwrite with append+counter.
  3. Extend `buildStateRootReviewPack` (and/or the unified-status projection) to also read
     `test-cards/` and `intake/` and attach `{testCardStatus, designHandoffIntakeKey,
     reworkCount, dispatchCount}`, giving the controller a true unified per-task fusion before
     every decision.
- **NEEDS-USER-CONFIRMATION** — option 1 is read-only and lowest risk; options 2–3 add durable
  state and change what the controller sees. All add scope.

**G9 — `projection.json` sub-fields are lossy (Q5).**
- Direction: emit `windows[]` (and task-packages/blockers) as arrays of objects
  `{windowName, windowState, targetTaskIds, taskPackageIds, blocked/missing counts}` alongside
  the existing flattened strings, so consumers can pull a window slice as JSON without
  re-parsing `wakeflow-state.json`. Single point to fix: `render-progress.mjs:196-199`.
- **NEEDS-USER-CONFIRMATION** — changes the projection schema/output shape.

**G10 — No convenient per-window task pull (Q6).**
- Direction: a lightweight `window-tasks --window X --state-root R` command that filters
  `state.targetTasks` by `targetWindow` and joins taskPackage summary, giving a target window a
  pull-based "what are MY tasks" path instead of relying on the pushed prompt or heavyweight
  trace-spine. Optionally materialize this into `state.windows[]` so repeated reads don't
  re-scan all artifacts.
- **NEEDS-USER-CONFIRMATION** — adds a new command/surface.

**G11 — No phase/stage slice, no consolidated sub-doc (Q7).**
- Direction: (a) to support per-phase briefs, target tasks/packages first need a stage/phase
  field, then review-pack/trace-spine selectors extended to filter on it; (b) add an on-demand
  focused-sub-document generator (per-window task card / per-phase brief) reusing the
  dispatch-packet distillation pattern (read big state → write a compact artifact to its own
  file), since today a window with N tasks gets N packets rather than one card.
- **NEEDS-USER-CONFIRMATION** — adds new schema fields, selectors, and a generator capability.

> Conservative caveat: several directions above were derived from a read of the
> MCP-reachable surface and exhaustive greps, not an exhaustive line-by-line read of every
> CLI-only subcommand. Where a primitive's exact reuse cost is uncertain (e.g. whether
> `demand-sequence` can cleanly ingest a next-work candidate), that is a design question to
> validate, not an asserted fact.

---

## Relationship to the upgrade plan

This assessment is the **state-flow / document-records** companion to
`docs/wakeflow-upgrade-plan.md` (the §3 "Four Asked Questions" + §4 prioritized plan). Several
gaps here connect directly to already-prioritized upgrade items, and the resolved decisions in
upgrade-plan §7 should govern them:

- **G3 (silent-window staleness) ↔ keep-live / lifecycle (upgrade plan P1-2 / F24, Wave D;
  §7 decision 1).** The plan's keep-live work surfaces active lease ids in `wakeflow_status`
  and lease-scoped auto-stop on terminal transition. A delivery-staleness signal is the
  natural complement — both make an otherwise-invisible in-flight state legible to the
  unattended loop, and both belong in the `runtime-summary` / status surface.

- **G4 (reopen `completed`) ↔ archival posture (upgrade plan P1-4 / F33, Wave C; §7
  decision 2).** Both touch demand terminal-state lifecycle. Note the plan's **hard
  prerequisite P1-0**: a thread-id redaction audit must prove zero real session/thread ids
  before any state-root content is committed to `wakeflow-ledger`. Any `reopen-demand` or
  archive transition must honor that redaction gate.

- **G7 (dead `paused`/`archived` + never-written enum values) ↔ upgrade plan P2-6 / F19
  (Wave E); §7 decision 3 — RESOLVED as reference-only.** The user already decided: **no
  runtime Ajv**; fix the enum as a shape/doc correction only (add `dispatched`, remove the 4
  never-written values), keeping both editions byte-identical. This assessment's G7 should be
  read as already dispositioned by that decision, not reopened.

- **G8 (per-task counts / unified rollup) ↔ transport GC (upgrade plan P1-3 / F32) +
  superseded results (P2-3 / F35), Wave C.** The rework-cycle "new result file per redispatch"
  that defeats a per-task counter (`wakeflow-state.mjs:842-846`) is the same mechanism the
  plan's GC/superseded-result work touches. A `task-ledger` rollup and the
  superseded-result/pruning work share the `controller-events.jsonl` + delivery-run substrate;
  building the rollup as a **derived read** (G8 option 1) avoids the durable-state risk the
  plan flags for GC.

- **G9 (lossy projection sub-fields) ↔ unified-status projection.** The plan does not yet carry
  a projection-schema item; G9 is a net-new direction. If pursued, it should ship as a
  schema/output-shape change confirmed alongside the plan's other documentary/schema items
  (the plan's F4/F15 already propose adding `projection.schema.json` to validate requiredFiles
  — G9's richer shape would extend that).

- **G1 / G2 / G10 / G11 (self-claim MCP chain, typed TODO store, per-window task pull,
  phase slice + sub-doc generator)** are **net-new capabilities not in the current upgrade
  plan**. They are larger scope additions (new MCP tools, new data models, new schema fields)
  and should be raised as their own requirement-design intake rather than folded into the
  upgrade plan's correctness/cleanup waves. Per upgrade-plan §6, no item is executed until the
  user confirms; these especially must go through a confirmation gate because they change the
  controller's autonomy boundary and visible behavior.

**Standing guardrails that apply to every direction here** (from upgrade-plan §6): do not
delete still-owned capabilities without a named replacement + import-scan evidence; version
bumps are user-controlled; every `core/` change must pass `npm run check:core` and keep both
editions byte-identical; and observations/by-design items must not be promoted into work
without authority.
