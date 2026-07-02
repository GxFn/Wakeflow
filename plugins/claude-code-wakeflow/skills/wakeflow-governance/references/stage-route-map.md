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
No writes beyond notes. Exit gate: a one-sentence goal the user recognizes.

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
5. Delivery: `wakeflow_deliver` (append-only TODO row; requirement + autoClaim
   requires the linked Original Plan + Requirement Design).

## S2 — Claim & Plan (owner: controller)
`wakeflow_next_work` → `wakeflow_claim_next` / `wakeflow_create_demand`
(taskPackages carry designIntent) → `wakeflow_render_progress`.
**Entry check:** the controller verifies the Design exit gate is complete. Any
missing item = route back to Design (redesign lane) — do NOT patch the gap by
reading code and deciding alone. Exit gate: state root + task packages + wave
plan (which windows/streams, producer/consumer order).

## S3 — Dispatch & Execute (owners: controller dispatches, targets execute)
`wakeflow_prepare_delivery` (author the objective; intent check against
designIntent) → host `deliver` (lock, readback) → `wakeflow_record_delivery`
→ target works in its repo/worktree → `wakeflow_record_target_result`.
WITHIN one demand each repo runs exactly ONE window with ONE combined task
package (the window self-sequences its items; never two simultaneous tasks to
one window inside a demand). Isolation worktree windows
(`stream-open/close/list`) are for CROSS-DEMAND repo isolation only.
Exit gate: results with evidence refs for the wave.

## S4 — Review & Decide (owner: controller — the ONLY acceptance authority)
`wakeflow_review_pack` (intent triple: designIntent / objective / result) →
`wakeflow_reduce_results` → `wakeflow_decide_review`
(accept / rework / redesign / blocked). Raw evidence before any decision.
Non-bug outcome mismatch = redesign lane back to S1, never point-fix loops.

## S5 — Test (conditional; owner: Test window executes, controller composes)
Runs only when S1's Test decision said yes. The controller builds the card
with `wakeflow_intake_test_card`, copying the S1 Test Environment Spec into
`realScenarioConditions` (+ `allowedOperations`/`forbiddenOperations`/
`evidenceRequired`), then dispatches it like any target task.
**Test only tests**: it never chooses environments, invents config values,
fixes product code, or widens scope. A card whose environment block is missing
or ambiguous = immediate blocker back to the controller; the controller
resolves it from the Requirement Design or the user — never by guessing.
Results return to S4 review.

## S6 — Integrate & Close (owner: controller)
Merge accepted stream branches (controller decision, before `stream-close`) →
`wakeflow_complete_demand` (all accepted, zero blockers, evidence) →
`wakeflow_archive` (redaction gate; refuses while streams are open) →
TODO rollup / `wakeflow_prune_runtime`.

## Capability-to-stage classification

| Stage | MCP tools | Host commands | Skills/prose |
| --- | --- | --- | --- |
| S0 | `wakeflow_status` | `check-workspace`, `window-status` | CLAUDE.md posture |
| S1 | `wakeflow_deliver` | — | Design support surface docs |
| S2 | `wakeflow_next_work`, `wakeflow_claim_next`, `wakeflow_create_demand`, `wakeflow_add_task`, `wakeflow_render_progress` | — | governance TODO intake |
| S3 | `wakeflow_prepare_delivery`, `wakeflow_record_delivery`, `wakeflow_record_target_result`, `wakeflow_release_window_lock` | `deliver`, `send`, `stream-open/close/list`, `launch-*`, `replace-all` | controller dispatch + target skill |
| S4 | `wakeflow_review_pack`, `wakeflow_reduce_results`, `wakeflow_decide_review`, `wakeflow_view` | `readback`, `wait-results` | controller acceptance practices |
| S5 | `wakeflow_intake_test_card` | (dispatch = S3 transport) | testing-validation reference |
| S6 | `wakeflow_complete_demand`, `wakeflow_archive`, `wakeflow_prune_runtime`, `wakeflow_adopt_demand_host` | `stream-close`, `arrange-windows` | ledger reference |
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
