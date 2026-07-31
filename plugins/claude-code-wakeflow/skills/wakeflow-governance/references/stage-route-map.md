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
`wakeflow_pod_open`, and ask the helper to create the three independent
control sessions. Journal each launch correlation with
`wakeflow_pod_record_materialization`; the helper returns the final Claude
session synchronously and has no Codex `clientThreadId` pending state.
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
5. Delivery: mainline Design uses `wakeflow_deliver` (append-only TODO row;
   requirement + autoClaim requires the linked Original Plan + Requirement
   Design). A Pod controller freezes the anchored request with
   `wakeflow_pod_prepare_design_request`; Pod Design returns the matching
   `PodDesignHandoffEnvelope`, which the Pod controller records with
   `wakeflow_pod_record_design_handoff`. Neither step creates a second global
   TODO for the same demand.

## S2 — Claim & Plan (owner: controller)
`wakeflow_next_work` → `wakeflow_claim_next` / `wakeflow_create_demand`
(taskPackages carry designIntent) → `wakeflow_render_progress`.
**Entry check:** the controller verifies the Design exit gate is complete. Any
missing item = route back to Design (redesign lane) — do NOT patch the gap by
reading code and deciding alone. Mainline is the default: if another mainline
demand is active, ordinary and Auto Claim work waits without creating state or
host resources. A Pod is valid only with its existing explicit authorization.
After Pod Design freezes repository coverage, the helper creates each product
session from the exact repository with native `claude --worktree`; verified
bindings advance the Pod to `execution-ready`. Exit gate: state root + task
packages + wave plan.

## S3 — Dispatch & Execute (owners: controller dispatches, targets execute)
`wakeflow_prepare_delivery` (author the objective; intent check against
designIntent) → host `deliver` (lock, readback) → `wakeflow_record_delivery`
→ target works in its repo/worktree → `wakeflow_record_target_result`.
WITHIN one demand each repo runs exactly ONE window with ONE combined task
package (the window self-sequences its items; never two simultaneous tasks to
one window inside a demand). Pod product windows exist only inside an
explicitly authorized Pod and use Claude-created native worktrees. Dispatch is
forbidden before `execution-ready`; Wakeflow never creates or deletes those
worktrees.
Exit gate: results with evidence refs for the wave.

## S4 — Review & Decide (owner: controller — the ONLY acceptance authority)
`wakeflow_review_pack` (intent triple: designIntent / objective / result) →
`wakeflow_reduce_results` → `wakeflow_decide_review`
(accept / rework / redesign / blocked). Raw evidence before any decision.
Non-bug outcome mismatch = redesign lane back to S1, never point-fix loops.
For a Pod, redesign must never return to mainline Design. Version 0.9.1 cannot
persist a second frozen Pod Design request/handoff generation, so the demand
stays blocked as a capability gap instead of overwriting its recorded Design generation.
Exit to S5 only after every active required non-Test target is accepted and the
controller has recorded its concrete validation in the Test card's
`controllerSelfChecks`. A Test-only reproduction or environment diagnostic
may enter S5 after the controller establishes that current scope.

## S5 — Test (conditional; owner: Test window executes, controller composes)
Runs only when S1's Test decision said yes AND S4's functional acceptance gate
passed. For a Pod, first run `wakeflow_pod_prepare_test_access` from the
controller, execute that exact host-local probe from the independent Test
session, and record it with `wakeflow_pod_record_test_access`. Only validated
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
return to S4, where the controller compares the step-to-anchor map against the
same contract before accepting evidence or authoring follow-up work.

## S6 — Integrate & Close (owner: controller)
`wakeflow_complete_demand` (all accepted, zero blockers, evidence) →
core `wakeflow_pod_close` for a Pod (generate a host-close plan) → helper
closes sessions and reports worktree disposition → record every
`wakeflow_pod_record_close_receipt` → `wakeflow_archive` (redaction gate) →
TODO rollup / `wakeflow_prune_runtime`. Logical binding close, tmux/session
close, and Claude physical worktree cleanup remain separate facts.

Before archive, a verified same-demand gap may return from S6 to S2 only through
`wakeflow_continue_demand`: it records the bug/supplement/authorized-optimization
authority and the first package atomically while retaining the earlier completion
event. Archived history never returns; independent follow-up scope starts at S0/S1
as a new demand.

## Capability-to-stage classification

| Stage | MCP tools | Host commands | Skills/prose |
| --- | --- | --- | --- |
| S0 | `wakeflow_status`, explicit-Pod `wakeflow_create_demand`, `wakeflow_pod_open`, `wakeflow_pod_record_materialization`, `wakeflow_pod_bind` | `check-workspace`, Pod control `pod-open` | CLAUDE.md posture |
| S1 | mainline `wakeflow_deliver`; Pod `wakeflow_pod_prepare_design_request`, `wakeflow_pod_record_design_handoff` | Pod Design `deliver` | Design support surface docs |
| S2 | `wakeflow_next_work`, `wakeflow_claim_next`, `wakeflow_create_demand`, `wakeflow_add_task`, `wakeflow_continue_demand`, `wakeflow_render_progress`, Pod `wakeflow_pod_record_materialization`, `wakeflow_pod_bind` | Pod product: `mode=create` materializes only canonical pending/unbound operations; `mode=resume` verifies or resumes the exact bound session/cwd and treats HEAD/dirty as observations | governance TODO intake |
| S3 | `wakeflow_prepare_delivery`, `wakeflow_record_delivery`, `wakeflow_record_target_result`, `wakeflow_release_window_lock` | `deliver`, `send` | controller dispatch + target skill |
| S4 | `wakeflow_review_pack`, `wakeflow_reduce_results`, `wakeflow_decide_review`, `wakeflow_view` | `readback`, `wait-results` | controller acceptance practices |
| S5 | `wakeflow_pod_prepare_test_access`, `wakeflow_pod_record_test_access`, `wakeflow_intake_test_card` | exact Pod Test multi-root probe; dispatch = S3 transport | testing-validation reference |
| S6 | `wakeflow_complete_demand`, `wakeflow_pod_close`, `wakeflow_pod_record_close_receipt`, `wakeflow_archive`, `wakeflow_prune_runtime`, `wakeflow_adopt_demand_host` | `pod-close`, `arrange-windows` | ledger reference |
| Cross | `wakeflow_initialize_workspace`, `wakeflow_replace_windows`, `wakeflow_verify` | `preflight`, `seed-permissions`, `stamp-runtime`, `set-unattended` | this map |

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
