# Stage Route Map — who runs, in what order, behind which gates

One demand travels S0→S6. Every stage has an OWNER, required INPUTS, and an
EXIT GATE. Gates are FIRST-ENTRY conditions, not one-way doors: rework
(S4→S3), redesign (S4→S1), and wave iteration (S3⇄S4) are the loop working as
designed, and re-entry never re-runs an already-satisfied gate. The controller
never guesses a missing input — it routes the gap back to the owning stage
(the three escalation lanes at the bottom).

**Proportionality — the gate scales with the demand type** (smallest matching
flow, never ritual compliance):

| Type | S1 gate |
| --- | --- |
| requirement | full five-item exit gate below |
| bug | reproduction + scope/affected windows + non-goals + Test decision; no Original Plan ceremony |
| supplement | delta against the EXISTING Requirement Design (must not reverse its decisions/non-goals) + confirmation of any new open question |
| research | no implementation dispatch at all — findings return as evidence, S1 restarts if they spawn a requirement |

Faking a gate artifact to pass is worse than routing back: it stamps
unexamined work as designed.

## S0 — Intake (owner: controller, with the user)
User goal captured; orientation read (`CLAUDE.md`, active index, current status).
A normal demand stays on the mainline and writes no execution state yet.
Missing/unhealthy required mainline identity returns `mainline-unavailable`
before demand/TODO mutation and routes to mainline repair; it never authorizes
a Pod. If and only if the user explicitly authorizes a Pod, the controller may create
its minimal canonical `state=intake` root, record
`selection=explicit-user-pod` plus `authorizationRef`, run core
`wakeflow_pod_open operation=launch-preview/launch-apply`, and pass only those
canonical operations to the current host facade's `pod-materialize` owner. Journal each launch
correlation and observed result with
`wakeflow_pod_record operation=record-materialization`; Claude returns the
final session synchronously and has no Codex `clientThreadId` pending state.
If the exact host effect or receipt is unavailable, stop with materialization
pending; retired helper commands cannot create a substitute binding.
`control-ready` requires verified Controller/Design/Test receipts. Exit gate:
a one-sentence goal the user recognizes and, for a Pod, a `control-ready`
state root.

## S1 — Design (owner: Design window) — THE stage that prevents "review code and just start"
Design turns the goal into an executable requirement BEFORE any implementation
dispatch. Inputs: the S0 goal + REAL code facts (Design reads the repositories,
or asks the controller for bounded read-only investigation — never guesses
current behavior).

**Design exit gate — ALL FIVE, none survive into execution unresolved:**
1. **Original Plan** (goal, scope, priorities).
2. **Requirement Design** containing: (a) *code-fact reconciliation* — affected
   repos/files/entry points and their CURRENT real behavior, verified against
   source, not assumed; (b) *landing plan* — per-window task breakdown with one
   `designIntent` sentence per task package; (c) *non-goals*.
3. **User-confirmation ledger** — every open product question ASKED and the
   user's answer RECORDED. An unanswered question blocks delivery; execution
   stages never re-open or improvise product decisions.
4. **Test decision** — is real-scenario Test needed? If yes, a **Test
   Environment Spec**: environment name/endpoints, required env vars and
   config values, accounts/credentials location (reference, never the secret),
   data fixtures, allowed operations, reset/cleanup steps. Confirmed with the
   user HERE, not after implementation.
5. Delivery: mainline Design uses `wakeflow_deliver` to append one exact
   13-column TODO row under the current board digest. The row carries canonical
   document links and an immutable Auto Claim choice; append validates shape and
   board CAS, not document resolution or demand authority. A Pod controller freezes the anchored request with
   `wakeflow_pod_plan operation=design-request`; Pod Design returns the matching
   `PodDesignHandoffEnvelope`, which the Pod controller records with
   `wakeflow_pod_record operation=design-handoff`. Neither step creates a second global
   TODO for the same demand.

## S2 — Claim & Plan (owner: controller)
`wakeflow_next_work` → `wakeflow_create_demand` (root-first publication plus
exact linked TODO claim) → `wakeflow_add_task` (TaskPackages may carry
`designIntent`) → `wakeflow_status operation=inspect`.
**Entry check:** the controller verifies the proportional demand authority.
Design is the default author for substantial new behavior; the controller may
create bounded/already-documented work inline only by citing the same anchored
inputs. Any missing item stays S1 and routes to Design/user — do not invent the
gap. If any TaskPackage will be needed, the controller must resolve the
submitted references and include `demand-authority.json` in the initial demand
publication; public v3 cannot add it afterward. Mainline is the default: if another mainline
demand is active, ordinary and Auto Claim work waits without creating state or
host resources. A Pod is valid only with its existing explicit authorization.
After Pod Design freezes repository coverage, the current host facade's
`pod-materialize` owner may execute the exact pending/unbound product operation from its repository root
with native `claude --worktree`; verified typed bindings advance the Pod to
`execution-ready`. Exit gate: state root + task packages + wave plan.

## S3 — Dispatch & Execute (owners: controller dispatches, targets execute)
`wakeflow_prepare_delivery operation=target-preview` → exact
`operation=target-apply` → immediate `operation=target-claim` → facade
`target-delivery` effect with at most one bounded readback →
`wakeflow_record_delivery operation=target-outcome` → target works in its
repo/worktree → `wakeflow_record_target_result operation=import`.
WITHIN one demand each repository has one active task lineage at a time and
each target task binds one immutable TaskPackage; replacement or continuation
creates the next lineage member only after its exact gate. Pod product windows exist only inside an
explicitly authorized Pod and use Claude-created native worktrees. Dispatch is
forbidden before `execution-ready`; Wakeflow never creates or deletes those
worktrees.
Exit gate: target results with the required declared review-input refs for the wave.

## S4 — Review & Decide (owner: controller — the ONLY acceptance authority)
`wakeflow_review_pack` (intent triple: designIntent / objective / result) →
`wakeflow_reduce_results` → `wakeflow_decide_review`
(accept / rework / redesign / blocked). Inspect target inputs and run fresh
independent checks before any decision.
Non-bug outcome mismatch = redesign lane back to S1, never point-fix loops.
For a Pod, redesign must never return to mainline Design. The current implementation cannot
persist a second frozen Pod Design request/handoff generation, so the demand
stays blocked as a capability gap instead of overwriting its recorded Design generation.
Exit to S5 only after every active required non-Test target is accepted and the
controller has recorded its concrete validation in the Test card's
`controllerSelfChecks`. A Test-only reproduction or environment diagnostic
may enter S5 after the controller establishes that current scope.

## S5 — Test (conditional; owner: Test window executes, controller composes)
Runs only when S1's Test decision said yes AND S4's functional acceptance gate
passed. For a Pod, first run `wakeflow_pod_plan operation=test-access-plan` from the
controller, execute that exact host-local probe from the independent Test
session, and record it with `wakeflow_pod_record operation=test-access-receipt`. Only validated
`direct-multi-root` coverage of every active product binding opens Test
dispatch. Unsupported access stays blocked; no main-checkout/product-window
fallback exists, and no per-repository executor is claimed as implemented.
The controller then builds the card
with `wakeflow_intake_test_card`, copying the S1 Test Environment Spec into
`realScenarioConditions` (+ `allowedOperations`/`forbiddenOperations`/
`evidenceRequired`) and recording `controllerSelfChecks`, then
dispatches it like any target task. Test explores hidden bugs in the approved
real environment; it does not establish feature completeness or correctness.
**Test only tests**: it never chooses environments, invents config values,
fixes product code, or widens scope. A card whose environment block is missing
or ambiguous = immediate blocker back to the controller; the controller
resolves it from the Requirement Design or the user — never by guessing.
The card also freezes the demand goal, approved Test plan, allowed Test skills,
setup policy, and attempt bound. Test may elaborate only mapped operational
steps; unmapped goals/gates/methods return blocked before execution. Results
return to S4, where the controller compares the ordered `test-step` craft
mappings against the same contract and independently validates the claimed
meaning. If Test exposes a product defect after that repository lineage is
already accepted, current public v3 cannot reopen it or add a same-demand fix
before completion; S4 preserves the evidence and remains blocked rather than
reworking Test or completing known-defective work.

## S6 — Integrate & Close (owner: controller)
`wakeflow_complete_demand operation=preview/apply` (all accepted, zero
blockers, evidence) → core `wakeflow_pod_plan operation=close-intent` for a Pod
→ facade `decommission-execute` closes the exact session and performs the bounded absence probe →
record `wakeflow_pod_record operation=close-observe/close-receipt` → close the
exact typed binding → `wakeflow_archive operation=preview/apply` (portable
whole-demand privacy gate) → `wakeflow_prune_runtime`. Logical binding close,
tmux/session close, and Claude physical worktree cleanup remain separate facts.

Before archive, a verified same-demand gap may return from S6 to S2 only through
`wakeflow_continue_demand`: it records the bug/supplement/authorized-optimization
authority and the first package atomically while retaining the earlier completion
event. Archived history never returns; independent follow-up scope starts at S0/S1
as a new demand.

## Capability-to-stage classification

| Stage | MCP tools | Host seam | Skills/prose |
| --- | --- | --- | --- |
| S0 | `wakeflow_status operation=inspect`, explicit-Pod `wakeflow_create_demand`, `wakeflow_pod_open operation=launch-preview/launch-apply`, `wakeflow_pod_record operation=record-materialization`, `wakeflow_pod_bind` | facade `launch-window`/`pod-materialize` executes only exact canonical intents; missing host proof means blocked | CLAUDE.md posture |
| S1 | mainline `wakeflow_deliver`; Pod `wakeflow_pod_plan operation=design-request`, `wakeflow_pod_record operation=design-handoff` | facade `target-delivery` only after typed preparation | Design support surface docs |
| S2 | `wakeflow_next_work`, `wakeflow_claim_next`, `wakeflow_create_demand`, `wakeflow_add_task`, `wakeflow_continue_demand`, `wakeflow_status operation=inspect`, Pod `wakeflow_pod_record operation=record-materialization`, `wakeflow_pod_bind` | facade `pod-materialize` handles only canonical pending/unbound operations; `inspect-materialization` observes only the exact bound session/cwd and treats HEAD/dirty as observations | governance TODO intake |
| S3 | `wakeflow_prepare_delivery`, `wakeflow_record_delivery`, `wakeflow_record_target_result`, `wakeflow_release_window_lock` | stable-window mutex covers validation → paste → one bounded readback | controller dispatch + target skill |
| S4 | `wakeflow_review_pack`, `wakeflow_reduce_results`, `wakeflow_decide_review`, `wakeflow_view` | no polling or synchronous wait route | controller acceptance practices |
| S5 | `wakeflow_pod_plan operation=test-access-plan`, `wakeflow_pod_record operation=test-access-receipt`, `wakeflow_intake_test_card` | exact Pod Test multi-root probe; dispatch = S3 transport | testing-validation reference |
| S6 | `wakeflow_complete_demand`, `wakeflow_pod_plan operation=close-intent`, `wakeflow_pod_record operation=close-observe/close-receipt`, `wakeflow_archive`, `wakeflow_prune_runtime` | facade decommission owner requires exact close + bounded absence; physical worktree cleanup stays Claude/user-owned | ledger reference |
| Cross | `wakeflow_maintain_workspace`, `wakeflow_replace_windows`, `wakeflow_verify` | facade settings/assets and activation-scope owners; unknown/host-wide coverage blocks unattended | this map |

## The three escalation lanes (a missing input is NEVER guessed)

1. **Requirement/option gap** (what should the product do?) → redesign lane to
   Design (S1); implementation pauses.
2. **Product decision gap** (only the user can choose) → ask the user; record
   the answer in the confirmation ledger before resuming.
3. **Fact gap** (what does the code/environment actually do?) → bounded
   read-only investigation (controller self-check or subagent evidence), then
   back into the owning stage's artifact.

Controller test-environment authority: the controller DECIDES which confirmed
environment a test card uses (from the S1 spec), the user CONFIRMS it at S1,
Test only EXECUTES it. Three different verbs, three different owners.
