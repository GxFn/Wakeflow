---
name: wakeflow-controller
description: Use when Wakeflow total control starts or resumes Wakeflow Delivery Loop, reviews target result envelopes, creates dispatch packets, builds delivery envelopes, decides acceptance / rework / block / next wave, or stops unattended automation.
---

# Wakeflow Controller

Use this skill only from the controller window. `AGENTS.md` owns hard judgment;
this skill owns the mechanical loop steps.

## Purpose

Wakeflow Delivery Loop lets the controller fan out work to target windows,
receive compact result envelopes, review raw evidence, and decide the next
package. It does not replace planning, scope control, or acceptance.

Direct-thread dispatch is the normal transport. In explicitly enabled
unattended mode, keep reviewing results, pulling evidence, deciding, planning
next eligible packages, and dispatching until final completion, a hard gate,
explicit user stop, missing evidence that needs human judgment, or no eligible
TODO remains.

After a delivery is sent, read back, and recorded as `status=sent` with
`readback.ok=true`, the controller dispatch turn is complete. Do not keep the
turn open with `sleep`, repeated result review, repeated thread reads, or manual
polling. The target returns later through a `TargetResultEnvelope` and, if
policy allows, a controller-return delivery.

## Source Practices For Acceptance

**Iron Law: NO ACCEPTANCE WITHOUT FRESH RAW-EVIDENCE THAT PROVES THE INTENDED BEHAVIOR.** A result
envelope, a script's `OK`, or a window's success report is a review input, never the proof.
Violating the letter of this rule is violating its spirit.

Controller acceptance adapts mature review practice — `code-reviewer` (understand intent first, then
correctness, safety, maintainability, performance, tests; start large changes at entrypoints and
high-risk files), `senior-qa` (confidence per unit effort; flakiness is evidence degradation, not
success), and SRE evidence practice (separate symptom, cause, black-box, and white-box evidence;
logs, probes, and scripts are inputs, not conclusions) — under Wakeflow's stricter authority
boundary: target windows, Test, Design, scripts, and MCP tools provide review inputs; only the
controller accepts, requests rework, blocks, waits, completes a demand, archives, or creates the
next package.

| Claim | Requires | Not sufficient |
|---|---|---|
| Target task done | the VCS diff / raw evidence reviewed this turn | the envelope says "done" |
| Behavior delivered | evidence shows the user-visible behavior | a connection / empty API / static mock exists |
| Demand complete | line-by-line vs the requirement design + non-goals | all tasks marked done |
| Ready for Test | existing non-Test targets accepted + controllerSelfChecks recorded | hoping Test will establish correctness |

**Red Flag — a third point-fix on the same task.** Two failed reworks on one task mean the next move
is a *new* root-cause hypothesis or a non-bug-mismatch route to Design redesign — not another bounce
between product windows.

## Controller Return Prompt Shape

Controller return prompts should be compact:

```text
Continue controller review: <windowA>, <windowB> backfill.

Variables:
- stateRoot: <path>
- dispatchGroup: <group>
- trigger: <window/task>
- blockedTargets: <only when non-empty>
- missingTargets: <only when non-empty>
- skill: skills/wakeflow-controller/SKILL.md
```

Do not expose empty `blockedTargets` or `missingTargets`; keep group details in
machine state.

## Start Or Resume A Dispatch

1. Read `AGENTS.md`, the active workspace index/status, and the current state
   root or controller document.
2. Confirm the user goal, fully read original plan / requirement design
   decisions, completion definition, remaining gap, first blocker, current
   demand status, and eligible target tasks.
3. State the safe operation, recovery boundary, and one-sentence plan before
   using tools, editing files, dispatching, accepting, archiving, or deleting.
   If a tool returns `state-transition-recovery-required`, stop the original
   operation, run `wakeflow_recover_state_transition` as a dry-run and then
   with `apply=true`, re-read state, and only then decide whether the original
   operation is still needed. Never make another state writer recover it
   implicitly.
4. If the demand is blocked, cancelled, archived, review-ready, or lacks
   evidence, stop instead of preparing another package. If it is completed,
   classify the new fact before acting: same-demand continuation, independent
   follow-up, or no work. Never call `wakeflow_add_task` against completed state.
5. Create or select a task package only when it advances the confirmed goal.
   New packages must record the complete dispatch context once: `workType`,
   one observable `objective`, a short ordered `contextSummary`, anchored
   `requirementRefs`, `boundaries` (`inScope`, `outOfScope`, `forbidden`),
   `completionExpectations` ordered most important first, explicit `dependsOnTaskIds`, and
   `commitExpectation`. The prompt is a compact briefing generated from this
   package: it surfaces only the first two completion expectations and one
   original requirement entry, while the package retains every context fact,
   requirement anchor, boundary, and completion condition. Do not defer these
   decisions to the target or re-author them during dispatch.
   Order each boundary list most important first. The compact prompt surfaces
   only the first available boundary in `forbidden → outOfScope → inScope`
   order, so its first entry must be the one the target cannot safely miss.
   For implementation work, author a small `acceptanceAnchors` list from the
   confirmed requirement: each entry names `{id, claim, probe, expected}` that
   the target can turn into a RED check before coding. Do not invent anchors
   from implementation leftovers; if the required behavior cannot be stated as
   a probe, the package is not ready. Doc-only and research packages may omit
   anchors.
6. For a Test package, first confirm every existing non-Test target is
   `accepted` and `controllerSelfChecks` states what you already verified and
   why the real scenario remains necessary. A Test-only reproduction or
   environment diagnostic is valid; unfinished controller validation is not.
   For any Pod product/Test dispatch, also require
   `podProvisioning.phase=execution-ready` and the target's verified
   host-scoped binding. A suffix, static config path, or prompt identity is not
   a binding. For Pod Test specifically, additionally require
   `podProvisioning.testAccess.status=validated`,
   `capability=direct-multi-root`, and exact coverage of every active product
   binding. An unsupported probe blocks dispatch; never substitute a main
   checkout, product window, or unverified per-repository executor.
7. Call `wakeflow_prepare_delivery` for the target without `apply`. Review its
   `readiness`, `taskBriefing`, repository identity, requirement anchors,
   dependency status, required Skills, and exact prompt. A preview writes no
   packet, envelope, window config, or lock.
8. If the preview is correct, call the same tool again with `apply=true`. This
   freezes the validated packet and delivery envelope; pass
   `previewDigest` back as `expectedPreviewDigest`. Do not
   override the package objective or substitute another human-context
   reference. The digest covers the package, state revision, resolved
   repository, prompt, and transport configuration; any change requires a
   fresh preview.
9. Send the envelope prompt through the Codex host thread tool exactly as stored
   in the envelope.
10. Read back the host send evidence and record the delivery run. If the send
    succeeded but the newest turn is still in progress with no visible items,
    or the sent prompt is not visible yet, treat that read as inconclusive:
    retry only the readback within the host adapter's bounded attempt/time
    budget. Never resend the prompt while confirming the same accepted send.
11. End the dispatch turn.

## Review Target Results

1. Import or locate target result envelopes for the dispatch group.
2. Run group review against the state root.
3. Check for missing, blocked, or ready targets.
4. Pull raw evidence before deciding.
5. Review acceptance inputs:
   - full original plan / requirement design, including explicit decisions,
     non-goals, and forbidden shortcuts;
   - original user goal and completion definition;
   - current state root and task package;
   - dispatch group and target identity;
   - target result envelope;
   - raw evidence paths, commits, commands, reports, logs, screenshots, runtime
     JSON, probes, or Test evidence;
   - product repository rules and relevant Design/Test artifacts;
   - TODO/backlog implications.
6. Check acceptance questions:
   - Does the evidence prove the intended user/system behavior, not only that a
     script ran?
   - Are inputs, outputs, state/data changes, call chains, real consumers,
     failure paths, and edge cases covered enough for this task scope?
   - Did the target stay inside its assigned window/repository and task package?
   - For every authored acceptance anchor, where is the target's RED/GREEN
     mapping, and what fresh independent probe did I run against the claim?
   - Are tests or probes at the right seam, and did they cover the behavior that
     matters?
   - For a non-Test target, have I personally established functional
     completeness and correctness without relying on a future Test run?
   - For a Test target, does the evidence only explore the approved real
     environment or hidden-defect boundary, without redefining completion?
   - If adding a TODO, follow-up, or next package, is it authorized by the
     original requirement decisions rather than inferred from residual code,
     existing tests, target backfill, or implementation leftovers?
   - Is the remaining gap a product-code defect, or a non-bug mismatch between
     the current effect and the user's intended outcome?
   - Is any remaining risk a blocker, a follow-up, or a user/controller
     decision?
   - Which TODOs close, remain, or need to be added?
7. Decide explicitly, two-stage (spec compliance first, then quality):
   - **accept** the target result;
   - **rework** — a product-code defect: re-dispatch the same window
     (`decide-review --decision rework`, reworkCount++);
   - **redesign** — a non-bug mismatch, or a small requirement-level fix that is Design's
     job and not a code defect: `decide-review --decision redesign` parks the task and
     routes it back to Design (redesignCount++), instead of bouncing point-fixes between
     product windows. After Design delivers the corrected requirement, add a new full-context
     implementation task in the product responsibility window with
     `replacesTargetTaskId=<parked task>`; never re-dispatch or accept the old
     redesign task as the correction;
   - **blocked** — a hard blocker that needs a human;
   - wait for missing targets, complete the demand, or create the next eligible package.
   - **Brake:** when the task-ledger shows `recurringProblem` (reworkCount ≥ 2) on a task,
     do NOT plain-rework it again — give a *new* root-cause hypothesis or choose `redesign`.
   - **Brake:** if a demand's `redesignCount` reaches 2 and the effect still misses, the
     requirement is unclear at the *user* level — escalate to the user, not another redesign round.
8. Record the decision in controller state before dispatching follow-up work.

## Acceptance Decision Format

Use this shape when recording or reporting controller acceptance:

```markdown
## Controller Acceptance

- User goal:
- Scope reviewed:
- Original requirement authority:
- Target/window:
- Evidence reviewed:
- Implementation reality:
- Validation result:
- Blockers:
- Missing evidence:
- Residual risks:
- TODO/backlog rollup:
- Decision:
- Next action:
```

`Decision` must be one of:

- `accept-target-result`
- `request-rework`
- `mark-blocked`
- `wait-for-missing-target`
- `needs-user-decision`
- `complete-demand`
- `archive-completed-work`
- `create-next-package`

Never use `accepted` as a shorthand unless the evidence, scope, and TODO rollup
are already stated.

## Craft Evidence At Acceptance

When a task package carries an `evidenceContract`, the machinery has already
hard-checked the objective half at reduce (`craft-evidence-required`: required
kinds present, declared artifacts resolve). The judgment half is yours:

- The review pack echoes each result's `craftEvidence` and a `craftCheck` /
  `advisoryCraftKinds` reminder. Entries with `verify: controller-rerun` mean
  YOU re-run them at acceptance (tests/typecheck/lint within the controller
  self-validation boundary) — the script never runs repo commands for you;
  `artifact-present` means the artifact was existence-checked only;
  `self-attested` is a claim on the audit trail, not proof.
- Read the `self-review` note: stage-1 spec compliance against designIntent,
  and — on a rework round — the point-by-point response to your previous
  rework reason. A result that silently ignores a rework point is not ready.
- `recurringProblem` (reworkCount >= 2, surfaced at prepare-dispatch and in the
  task ledger): stop redispatching point fixes — expect a `root-cause-note`,
  and prefer the root-cause re-derivation or the `redesign` route.
- A package WITHOUT a contract is not a defect (doc-only work legitimately
  skips it) — the create/add reminders exist so the omission is a decision,
  never an accident.
- For a full-context result, `resultMapping.status=complete` means every
  authored acceptance anchor or approved Test step is represented exactly
  once. It is only a review-readiness fact: independently inspect/rerun the
  evidence before accepting.
- Check `commitDisposition`, `commits`, and `changedRepos` against the task
  package's `commitExpectation`. A `resultContractGap` blocks a verdict until
  the target records a corrected result or an honest blocked/needs-review
  result.

## Group Policies

- `group-ready`: wait until every expected target is ready or a blocker makes
  the group impossible. Then return once to the controller.
- `per-target`: return when a target result arrives, still with group context.
- Empty target groups are not completion evidence.
- A single target result is not group completion unless the group expected only
  that target.

## One Window Per Repo Within A Demand

- WITHIN one demand, each repository runs exactly ONE window and receives ONE
  combined task package: list every work item for that repo in the package
  (the state root holds the detail), and the window self-sequences priorities
  and returns one evidenced result. A window is never dispatched two
  simultaneous tasks inside the same demand — more work for that repo arrives
  as the NEXT combined package after review, never as a parallel dispatch.
- Mainline work uses the configured mainline product window. A Pod product
  window (`<repo>__<pod>`) exists only after explicit user Pod authorization
  and a host-created worktree receipt. Wakeflow refuses a second active binding
  for the same `(host, demand, repo)`; it does not impose a numeric Pod or
  per-repository limit.
- Merge/integration remains a human-reviewed repository decision. Logical Pod
  close records the host's disposition; it never treats an archived thread as
  proof that Codex physically removed a worktree or branch.

## Demand Pods (explicit parallel execution, never automatic placement)

- **Default:** ordinary and Auto Claim work uses the idle, healthy mainline.
  If mainline is busy, wait. Missing/unhealthy required mainline identity
  returns `mainline-unavailable` before demand/TODO mutation; repair the
  mainline. Never infer Pod placement from another active demand or a
  `Controller__*` name.
- **Authorization:** a Pod demand must already carry
  `executionPlacement.selection=explicit-user-pod` and an auditable
  `authorizationRef`. Legacy `maxActiveDemands` / `maxStreamsPerRepo` fields
  are migration warnings only; they neither authorize nor reject a Pod.
- One Pod = independent `Controller__<pod>`, `Design__<pod>`,
  `Test__<pod>`, and one product session per selected repository. Pods are
  mutually unaware and every controller-return uses that demand's stamped
  controller window.
- `wakeflow_pod_open` is plan/reserve only. It creates host-neutral launch
  operations and no branch, worktree, thread, or dynamic repository overlay.
  For each product operation, resolve the exact saved Codex project and call
  `create_thread` with `environment.type=worktree`; never fall back to the
  workspace parent or `local`. Control roles are three distinct local threads.
- Immediately before each host create call, record `creating` through
  `wakeflow_pod_record_materialization`. If Codex returns `clientThreadId`,
  record `pending`, then call bounded `list_threads(limit=50)` and match the
  exact `launchCorrelationId` marker in each task `preview`; do not create
  again. Use `query` only when the current host schema supports it, never as a
  requirement. The temporary id is persisted only as a digest and can never
  enter the registry. Record `finalized` only when exactly one final task
  matches; zero or multiple matches stay pending/blocked.
- Register only that final real `threadId`, collect the entry-sync cwd/Git
  receipt, then call `wakeflow_pod_bind`. A prompt assertion or window-name
  suffix is not a binding. `control-ready` requires all three control
  bindings; `execution-ready` additionally requires the recorded Pod Design
  handoff and every planned product binding.
- Pod initial Design, supplement, and redesign use
  `wakeflow_pod_prepare_design_request → PodDesignRequest →
  PodDesignHandoffEnvelope → wakeflow_pod_record_design_handoff`; the frozen
  request supplies exact lineage and cannot be replaced by a different
  request. They never route through the mainline Design window or create a
  duplicate global TODO for the same demand.
- Before Pod Test dispatch, call `wakeflow_pod_prepare_test_access`, execute
  that exact host-local probe from `Test__<pod>`, and record the redacted
  receipt with `wakeflow_pod_record_test_access`. Only validated
  `direct-multi-root` access across all active product bindings opens dispatch.
  Unsupported access stays blocked; a verifiable per-repository executor is
  not currently implemented.
- Test ENVIRONMENTS may be physical singletons even though Test windows are
  per-pod: an exclusive environment (per the S1 Test Environment Spec) is a
  cross-pod serial resource — confirm no other pod is using it before
  dispatching the card.
- Close is two-stage: `wakeflow_pod_close` emits host-close operations; the
  Agent archives/handoffs the Codex threads and records each result through
  `wakeflow_pod_record_close_receipt`. Only then does Wakeflow close the
  logical binding. Physical Codex worktree GC remains a separate host fact.
- `wakeflow_pod_list` reads canonical state plus host-scoped operations and
  bindings. It never guesses identity from a path or overlay.
- Cancelling instead of finishing: `wakeflow_cancel_demand` stops an
  in-flight demand WITHOUT pretending completion — no acceptance, evidence
  stays, open tasks keep their last honest status. A cancelled Pod still needs
  the same logical close receipts before archive.

## Completed Demand Continuations

- Completion is an accepted checkpoint, not permission to rewrite history. If
  a completed but unarchived demand later has a verified bug inside its
  original completion definition, a confirmed supplement to that definition,
  or an explicitly authorized optimization that the user says belongs to the
  same demand, use `wakeflow_continue_demand`.
- Read the original plan / Requirement Design and the completion evidence
  first. Record `continuationType`, a reason that explains why this is still the
  same demand, evidence or decision references, and the first concrete target
  package in the SAME call. The operation preserves all accepted tasks and the
  earlier `demand.completed` event, then returns the state to `planned`; it does
  not dispatch or accept anything. The demand must pass normal review and
  `wakeflow_complete_demand` again.
- Do not split the operation into a manual state edit followed by
  `wakeflow_add_task`, and do not create a temporary demand/pod to work around
  the terminal-state guard. If the operation fails, the completed state must
  remain unchanged.
- Archived demand roots are immutable to workflow continuation. The only
  sanctioned in-place amendment is `wakeflow_sanitize_archive`, which may
  replace a polluted archived root with a re-scanned privacy-clean copy while
  preserving the original locally; it never reopens tasks or changes
  acceptance. Independently scoped optimization,
  backlog work, or anything discovered after archive goes through the normal
  TODO / `wakeflow_create_demand` path with an explicit reference to the prior
  demand; never move or edit the archived root back into `current/`.

## Intent Alignment

- Two flexible sides, one check: Design's `designIntent` is a sketch, not a
  contract; the controller's `objective` is today's best arrangement, not a
  transcription. Deviation is often adaptation, not error — the check turns
  unconscious drift into a conscious confirmation, nothing more.
- Dispatch moment: when the task package carries a designIntent, the prepare
  output shows it beside your objective. Authoring the objective IS the
  confirmation; make an intentional adaptation visible in its wording (author
  it at the FIRST prepare — same-revision re-prepares must not change content).
- Review moment: the review pack shows designIntent / objective / result per
  task plus one `intentCheck` line. If the delivery departs from the design
  intent without a declared adaptation, run a requirement review (Original
  Plan / Requirement Design) first; if the requirement itself must change,
  decide `redesign`. Your decide-review reason is the confirmation record.
- No scores, no gates: intent alignment never blocks anything; evidence-based
  acceptance stays the only verdict.

## Stage Gates (route map: wakeflow-governance/references/stage-route-map.md)

- Before the FIRST implementation dispatch of a demand, verify the Design exit
  gate AT THE DEMAND'S SCALE: full five-item gate for a requirement; a bug
  needs reproduction + scope + non-goals + Test decision (no Original Plan
  ceremony); a supplement needs a delta against the existing Requirement
  Design; research never gets an implementation dispatch. Any missing item
  routes back to Design — do not close the gap by reading code and deciding
  alone, and never fake a gate artifact to pass.
- Before adding or dispatching a Test package, verify every existing non-Test
  target is accepted, record the concrete controller reruns in
  `controllerSelfChecks`, and copy the Design-stage Test Environment Spec
  into the card's realScenarioConditions/allowedOperations. You DECIDE which
  confirmed environment applies; the user CONFIRMED it at Design; Test only
  EXECUTES. Never send Test hunting for env vars, endpoints, or credentials.
- A Design-stage Test Environment Spec that turns out stale at Test time is a
  product-decision gap (quick user confirm) or a controller decision WITHIN
  the confirmed spec's bounds — not a full redesign, and never Test's guess.
- A missing input is never guessed: requirement/option gap → redesign lane;
  product decision → ask the user and record it; fact gap → bounded read-only
  investigation, then back into the owning stage's artifact.

## Storage Hygiene (idle-moment habit)

- Archive a completed/cancelled demand through `wakeflow_archive` dry-run
  first. If it reports real-id or user/workspace absolute-path findings, review
  the categories and re-run with `redact: true`; the committed staging copy
  must pass the final scan and the original moves to `preserved/`.
- If a historical archived demand is already committed with those findings,
  use `wakeflow_sanitize_archive` on that exact archived state root (dry-run
  first). Never hand-edit it, move it back to `current/`, or use this repair as
  a continuation path.
- In a spare moment (no in-flight deliveries, no pending reviews), glance at
  `wakeflow_view` scope `storage`: known trees with class/size/age, legacy
  residue, unknown trees, aging `preserved/` entries. It is orientation, not
  a work queue — nothing there authorizes deletion.
- An `unknown-tree` under `.wakeflow-local/` always routes to the user. Fold
  keepers with `wakeflow-storage preserve --source <path> --reason <slug>
  --write` (the ONE sanctioned manual-rescue move; writes the manifest);
  never invent another holding location and never auto-delete.
- Aged audit holds: review each `MANIFEST.md`, then
  `wakeflow_prune_runtime target=preserved` (dry-run first) or keep with an
  updated manifest. Transport GC stays `wakeflow_prune_runtime` (default
  target).

## Stop Conditions

Stop instead of dispatching when:

- The user goal or completion definition is unclear.
- The Design exit gate is incomplete for a new demand's first implementation
  dispatch, or a Test dispatch leaves an existing non-Test target unaccepted,
  omits the controller's self-checks, or lacks its confirmed environment block.
- Required evidence is missing or unreadable.
- The state root is not current or cannot be trusted.
- The controller is reacting to a keyword, familiar command shape, script hint,
  or urgency before naming the safe operation, recovery boundary, explicit
  plan, and smallest valid next step.
- A target window, repository, upstream dependency, or real thread id is
  missing.
- The next action would change scope, delete capability, downgrade capability,
  or make a product decision without user confirmation.
- The next action would add a TODO, follow-up requirement, task package, or
  scope expansion from code facts, test output, target evidence, implementation
  leftovers, or residual fields without first reading the full original plan /
  requirement design and confirming that the addition stays inside the original
  decisions and non-goals.
- A target result lacks reviewable evidence.
- Evidence is only target prose, superficial script output, or status-table
  motion.
- Test says evidence is acceptable but the controller has not reviewed the raw
  artifacts named by Test.
- The result is only an empty interface, static mock, unused adapter, type-only
  contract, unreachable route, or documentation motion without a real consumer
  and validation path.
- The evidence shows a non-bug outcome mismatch, or a small requirement-level fix that is
  Design's job and not a code defect: `decide-review --decision redesign` parks the demand
  (needs-rework, redesignCount++) instead of bouncing point fixes between product windows.
  This reuses the normal rhythm — no new transport: surface the redesign to Design; Design
  re-examines and **delivers** the corrected requirement with `wakeflow_deliver` (its normal
  stateless path); then **resume the same demand with `add-task-package`** (a full-context
  implementation package in the product responsibility window) and set
  `replacesTargetTaskId` to the parked product task — do NOT `create_demand`
  a new one or re-dispatch the old redesign task. Accepting the replacement marks the old
  task/package `superseded`; the parked demand's history and counts carry over.
- A completed result would leave TODO/backlog, archive state, or current status
  inconsistent.
- The controller is about to poll/wait for targets after a send was recorded.
- There are no eligible tasks.

## Verification

Use the smallest verification that covers the changed surface. For Wakeflow
total-control work in an installed workspace, use MCP tools instead of direct
runtime scripts:

- `wakeflow_verify` for overall Wakeflow verification. Use `scriptTests: true`
  only when the change is Wakeflow source/plugin script maintenance.
- `wakeflow_status` for repository, state-root, and delivery-loop orientation.
- `wakeflow_next_work` for after-completion candidate scans.
- `wakeflow_archive` (target=docs / target=todo) for archive
  dry-runs or applies.
- `wakeflow_create_demand`, `wakeflow_add_task`, `wakeflow_complete_demand`,
  `wakeflow_continue_demand`,
  `wakeflow_prepare_delivery`, `wakeflow_record_delivery`,
  `wakeflow_record_target_result`, `wakeflow_review_pack`,
  `wakeflow_reduce_results`, and `wakeflow_decide_review` for state-root,
  result review, and delivery mechanics.

Do not run `node .../plugins/cache/.../wakeflow/.../scripts/*.mjs`, copy
installed runtime script paths, or infer script flags from old docs during
normal total control. If the Wakeflow MCP tool surface is unavailable, stop and
report that the plugin must be reloaded or reinstalled.

Only when the current repository is Wakeflow source and the user is maintaining
Wakeflow scripts or automation, source-repo verification may use:

- `node scripts/wakeflow-verify.mjs`
- `node scripts/wakeflow-verify.mjs --with-script-tests`
- `node scripts/wakeflow-check-scripts.mjs --json`
- `node scripts/wakeflow-smoke.mjs`
- `npm test`

Script output is evidence, not acceptance.

- Stalled or ownerless window locks (`locks/<window>.json`) are recovered with `release-window-lock --window <name> --write` (MCP: `wakeflow_release_window_lock`); dry-run first, and treat releasing another host's fresh lock as a deliberate controller decision.
