---
name: wakeflow-controller
description: Use when Wakeflow total control starts or resumes Wakeflow Delivery Loop, reviews strict TargetResult records, creates dispatch packets, builds delivery envelopes, decides acceptance / rework / block / next wave, or stops unattended automation.
---

# Wakeflow Controller

Use this skill only from the controller window. `AGENTS.md` owns hard judgment;
this skill owns the mechanical loop steps.

## Purpose

Wakeflow Delivery Loop lets the controller fan out work to target windows,
receive strict TargetResult records, inspect target-authored review inputs, run
independent checks, and decide the next package. It does not replace planning,
scope control, validation, or acceptance.

Direct-thread dispatch is the normal transport. In explicitly enabled
unattended mode, keep reviewing results, inspecting inputs, validating, deciding, planning
next eligible packages, and dispatching until final completion, a hard gate,
explicit user stop, missing review inputs that need human judgment, or no eligible
TODO remains.

After the host effect, record its exact outcome through
`wakeflow_record_delivery operation=target-outcome`. Transport and bounded
readback remain separate facts; `pending` or `unavailable` never authorizes a
resend or lease release. The controller dispatch turn is then complete. Do not keep the
turn open with `sleep`, repeated result review, repeated thread reads, or manual
polling. The target returns later through one strict
`wakeflow-target-result` TargetResult and, if policy allows, a
controller-return delivery.

## Source Practices For Acceptance

**Iron Law: NO ACCEPTANCE UNTIL THE CONTROLLER HAS PERSONALLY ESTABLISHED THE INTENDED BEHAVIOR FROM FRESH RAW INPUTS AND INDEPENDENT CHECKS.** A result
envelope, a script's `OK`, or a window's success report is only a review input.
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
| Target task done | the VCS diff inspected and relevant behavior independently checked this turn | the envelope says "done" |
| Behavior delivered | the controller reproduced or directly inspected the user-visible behavior | a connection / empty API / static mock exists |
| Demand complete | line-by-line vs the requirement design + non-goals | all tasks marked done |
| Ready for Test | existing non-Test targets accepted + controllerSelfChecks recorded | hoping Test will establish correctness |

## Demand Creation Authority

Default substantial new product behavior to the Design window. Total control
may still create a bounded bug, supplement, research demand, or an already
documented requirement directly when doing so avoids pointless handoff and it
can cite the same proportional inputs Design would have supplied. This is
flexibility, not a second requirement format.

Whenever either entry path will need a TaskPackage, it publishes one immutable
`demand-authority.json` with the initial demand creation:

- `requirement`: Original Plan, Requirement Design, code facts, landing plan,
  non-goals, user-confirmation ledger, and Test decision;
- `bug`: reproduction, bounded scope, non-goals, and Test decision;
- `supplement`: existing Requirement Design, explicit delta, user confirmation,
  and Test decision;
- `research`: research question and boundaries; no implementation package.

Every reference is a workspace-relative Markdown anchor. A real-environment
Test decision also names the exact `test-environment` anchor. `Auto Claim`
authorizes unattended claiming only; it never supplies missing requirement
authority. Public v3 can publish a demand with `authority: null`, but no public
operation can add authority afterward and `wakeflow_add_task` requires the
exact frozen authority tuple for every TaskPackage. Therefore, whenever a
TaskPackage will be needed, include the complete authority in the initial
`wakeflow_create_demand` preview/apply publication. Do not manufacture missing
anchors to make the machine gate pass; route the gap to Design or the user.

**Red Flag — a third point-fix on the same task.** Only when the retained event
history actually proves two prior controller rework decisions should the next
move require a new root-cause hypothesis or a non-bug-mismatch route to Design
redesign. Current v3 state has no `reworkCount` or `recurringProblem` field, so
never infer this brake from an absent counter.

## Controller Return Prompt Shape

Controller return prompts should be compact:

```text
Continue controller review: <windowA>, <windowB> backfill.

Review context:
- stateRoot: <path>
- dispatchGroup: <group>
- trigger: <window/task>
- blockedTargets: <only when non-empty>
- remainingTargets: <only when non-empty>
- pendingDispatchTargets: <only when non-empty>

Required execution Skill:
- skills/wakeflow-controller/SKILL.md
```

Do not expose empty `blockedTargets`, `remainingTargets`, or
`pendingDispatchTargets`; keep full group details in machine state.

## Start Or Resume A Dispatch

1. Read `AGENTS.md`, the active workspace index/status, and the current state
   root or controller document.
2. Confirm the user goal, fully read original plan / requirement design
   decisions, completion definition, remaining gap, first blocker, current
   demand status, and eligible target tasks.
3. State the safe operation, recovery boundary, and one-sentence plan before
   using tools, editing files, dispatching, accepting, archiving, or deleting.
   If a tool returns `state-transition-recovery-required`, stop the original
   operation and call `wakeflow_recover_state_transition` with the exact
   `generic` or `lifecycle` operation and recovery tuple named by the failure.
   Re-read state after recovery before deciding whether the original operation
   is still needed. Never make another state writer recover it implicitly.
4. If the demand is blocked, cancelled, archived, review-ready, or lacks
   required review inputs, stop instead of preparing another package. If it is completed,
   classify the new fact before acting: same-demand continuation, independent
   follow-up, or no work. Never call `wakeflow_add_task` against completed state.
5. Create or select a task package only when it advances the confirmed goal.
   New packages must record the complete dispatch context once: `workType`,
   one observable `objective`, a short ordered `confirmedContext`, anchored
   `requirementRefs`, `boundaries` (`inScope`, `outOfScope`, `forbidden`),
   `completionExpectations` ordered most important first, explicit
   `dependsOnTargetTaskIds`, `acceptanceAnchors`, and `reviewInputContract`.
   Every non-Test package also carries `repositoryId` and `commitExpectation`;
   a Test package carries one exact `testCard` tuple and neither repository
   field. The prompt is a compact briefing generated from this
   package: it surfaces the objective, at most the first two completion
   expectations, one highest-priority context fact, one critical boundary, up
   to four acceptance-anchor ids/claims, and the ordered document/Skill
   navigation. The package retains every context fact, requirement anchor,
   boundary, completion condition, probe, and policy. Do not defer these
   decisions to the target or re-author them during dispatch.
   Order each boundary list most important first. The compact prompt surfaces
   only the first available boundary in `forbidden → outOfScope → inScope`
   order, so its first entry must be the one the target cannot safely miss.
   For implementation work, author a small `acceptanceAnchors` list from the
   confirmed requirement: each entry names `{anchorId, claim, probe, expected}` that
   the target can turn into a RED check before coding. Do not invent anchors
   from implementation leftovers; if the required behavior cannot be stated as
   a probe, the package is not ready. Documentation and research packages keep
   the required `acceptanceAnchors` field as an empty array.
6. For a Test package, first confirm every active required non-Test target is
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
7. Call `wakeflow_prepare_delivery operation=target-preview`. Review the
   readiness, briefing, exact typed repository/window identity, anchors,
   dependencies, prompt, plan, and digest. Preview is zero-write.
8. If correct, call `operation=target-apply` with the exact confirmed plan and
   digest. This creates the immutable group, packet, and envelope only; it does
   not acquire the host-effect lease or send anything. Any drift requires a new
   preview.
9. Immediately before the host effect call
   `wakeflow_prepare_delivery operation=target-claim` with the exact current
   binding/envelope tuple. Do not send if claim fails or reports stale state.
10. Send the stored prompt through the Codex host thread tool under its
    operation fence. Inspect the actual result and make at most one bounded
    `read_thread` observation. Error-like output is rejected-before-send;
    accepted transport with missing visibility is sent-unconfirmed, not a
    reason to observe again or resend.
11. Record the exact fact with `wakeflow_record_delivery
    operation=target-outcome`, then end the dispatch turn. That recorder is not
    the host-effect fence. Only an explicit rejected-before-send rearm may open
    another attempt.

## Review Target Results

1. Import or locate strict TargetResult artifacts for the dispatch group.
2. Run group review against the state root.
3. Check for missing, blocked, or ready targets.
4. Inspect the target-authored materials and plan fresh independent checks before deciding.
5. Review acceptance inputs:
   - full original plan / requirement design, including explicit decisions,
     non-goals, and forbidden shortcuts;
   - original user goal and completion definition;
   - current state root and task package;
   - dispatch group and target identity;
   - current strict TargetResult artifact;
   - target-authored paths, commits, commands, reports, logs, screenshots,
     runtime JSON, probes, or Test materials;
   - product repository rules and relevant Design/Test artifacts;
   - TODO/backlog implications.
6. Check acceptance questions:
   - Do my fresh independent checks establish the intended user/system
     behavior, rather than merely confirm that a target-reported script ran?
   - Are inputs, outputs, state/data changes, call chains, real consumers,
     failure paths, and edge cases covered enough for this task scope?
   - Did the target stay inside its assigned window/repository and task package?
   - For every authored acceptance anchor, where is the target's RED/GREEN
     mapping, and what fresh independent probe did I run against the claim?
   - Are tests or probes at the right seam, and did they cover the behavior that
     matters?
   - For a non-Test target, have I personally established functional
     completeness and correctness without relying on a future Test run?
   - For a Test target, do its materials only explore the approved real
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
     (`wakeflow_decide_review operation=decide`, decision `rework`);
   - **redesign** — a non-bug mismatch, or a small requirement-level fix that is Design's
     job and not a code defect: `wakeflow_decide_review operation=decide` with
     decision `redesign` parks the task as `needs-rework` without inventing a
     redesign counter. Mainline may use its stateless Design delivery and then
     add a full-context replacement whose exact `replacesTargetTask` tuple is
     `{targetTaskId,taskPackageRef,taskPackageDigest}`. A Pod must stay in its own Design lane;
     because the current implementation supports only one frozen Pod Design request/handoff
     generation, a redesign may use that sole generation only before any
     request exists; a different second request remains blocked rather than
     falling back to mainline Design or overwriting the recorded handoff;
   - **blocked** — a hard blocker that needs a human;
   - wait for missing targets, complete the demand, or create the next eligible package.
   - **History brake:** if exact controller events prove two prior rework
     decisions for this task, do not plain-rework it again without a new
     root-cause hypothesis; choose redesign when the mismatch is not a code
     defect. Escalate repeated requirement-level uncertainty to the user based
     on inspected history, never on fictional count fields.
8. Record the decision in controller state before dispatching follow-up work.

## Acceptance Decision Format

Use this shape when recording or reporting controller acceptance:

```markdown
## Controller Acceptance

- User goal:
- Scope reviewed:
- Original requirement authority:
- Target/window:
- Target inputs inspected:
- Independent checks run:
- Implementation reality:
- Validation result:
- Blockers:
- Missing review inputs:
- Residual risks:
- TODO/backlog rollup:
- Decision:
- Next action:
```

`Decision` must be one of:

- `accept-target-result`
- `request-rework`
- `request-redesign`
- `mark-blocked`
- `wait-for-missing-target`
- `needs-user-decision`
- `complete-demand`
- `archive-completed-work`
- `create-next-package`

Never use `accepted` as a shorthand unless the independent checks, scope, and
TODO rollup are already stated.

## Target Craft Inputs At Acceptance

Every TaskPackage carries `reviewInputContract`. The machinery checks structural
closure, not truth; validation and judgment remain yours:

- A completed TargetResult must provide an `evidenceLocators` entry for every
  package `requiredKinds` value. Each locator is exactly `{kind,ref,digest}`.
  Blocked or needs-review results may be partial, but must remain honest.
- For a completed non-Test result, `craftMapping` contains exactly one
  `{kind:"acceptance-anchor",anchorId,evidenceRefs:[{ref,digest}]}` per package
  anchor. For a completed Test result, it contains each approved plan step once
  and in order as `{kind:"test-step",planIndex,step,ref}`. Mapping completeness
  is review readiness, not proof.
- Independently inspect or rerun the referenced evidence. A locator proves only
  which bytes the target cited; it does not prove the claim or run repository
  commands for the controller.
- A product result has exactly one `repositoryChanges` entry for its assigned
  repository, with `{repositoryId,disposition,commits}` consistent with the
  package's `commitExpectation`; a Test result has an empty array. The result
  contract does not carry a changed-files list, so inspect the cited VCS diff
  and evidence directly.
- Read `verification`, `risks`, the summary, and exact prior review events. A
  corrected result may use the strict `supersedes` tuple, but current v3 exposes
  no rework/redesign counters or advisory craft taxonomy.

## Group Policies

- `group-ready`: wait until every expected target is ready or a blocker makes
  the group impossible. Then return once to the controller.
- `per-target`: return when a target result arrives, still with group context.
- Empty target groups are not grounds for completion.
- A single target result is not group completion unless the group expected only
  that target.

## One Window Per Repo Within A Demand

- WITHIN one demand, each repository has one active task lineage at a time and
  each target task binds one immutable TaskPackage. A package objective may
  describe coherent ordered steps, but the schema has no `items` collection.
  More work for the same repository arrives only through an exact replacement
  or completed-lineage continuation after the current lineage closes, never as
  a parallel target task.
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
- Immediately before each host create call, record launch progress through
  `wakeflow_pod_record operation=record-materialization`. If Codex returns `clientThreadId`,
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
- The Pod's single Design generation uses
  `wakeflow_pod_plan operation=design-request → PodDesignRequest →
  PodDesignHandoffEnvelope → wakeflow_pod_record operation=design-handoff`; the frozen
  request supplies exact lineage and cannot be replaced by a different
  request. Wakeflow does not yet persist multiple Pod Design generations:
  if a later supplement or redesign needs a new request/handoff, stop with a
  capability blocker. Never overwrite the frozen request, route the Pod
  through the mainline Design window, or create a duplicate global TODO.
- Before Pod Test dispatch, call `wakeflow_pod_plan operation=test-access-plan`, execute
  that exact host-local probe from `Test__<pod>`, and record the redacted
  receipt with `wakeflow_pod_record operation=test-access-receipt`. Only validated
  `direct-multi-root` access across all active product bindings opens dispatch.
  Unsupported access stays blocked; a verifiable per-repository executor is
  not currently implemented.
- Test ENVIRONMENTS may be physical singletons even though Test windows are
  per-pod: an exclusive environment (per the S1 Test Environment Spec) is a
  cross-pod serial resource — confirm no other pod is using it before
  dispatching the card.
- Close starts with `wakeflow_pod_plan operation=close-intent`; the Agent may
  archive/handoff the exact Codex thread and pass that result only through
  `wakeflow_pod_record operation=close-observe`. Codex archival always reduces
  to `manual-host-gate`, so it cannot write `close-receipt`, close the logical
  binding, archive the demand, or prune transport. Stop at that gate unless a
  separate authorized owner resolves the exact instance. Physical Codex
  worktree GC remains a separate host fact.
- `wakeflow_pod_open operation=inspect-materialization` plus
  `wakeflow_pod_plan operation=test-access-inspect/close-inspect` read the
  relevant Pod facts. They never guess identity from a path or overlay.
- Cancelling instead of finishing: `wakeflow_cancel_demand` stops an
  in-flight demand WITHOUT pretending completion — no acceptance, result
  history stays, open tasks keep their last honest status. A cancelled Pod
  still faces the same close proof and manual-host-gate before archive.

## Completed Demand Continuations

- Completion is an accepted checkpoint, not permission to rewrite history. If
  a completed but unarchived demand later has a verified bug inside its
  original completion definition, a confirmed supplement to that definition,
  or an explicitly authorized optimization that the user says belongs to the
  same demand, use `wakeflow_continue_demand operation=create`.
- Read the original plan / Requirement Design, accepted result history, and
  controller validation record first. Submit one complete new TaskPackage with
  `continuation:{kind,previousTaskPackageId,ref,digest,reason}`, where `kind` is
  exactly `verified-bug`, `requirement-supplement`, or `optimization`. It must
  extend the exact accepted/closed lineage head for the same repository,
  window, and work type; all prior tasks/packages must already be closed and
  the predecessor cannot already have a continuation child. The operation
  retains the earlier `demand.completed` event and returns state to `planned`;
  it does not dispatch or accept anything. The demand must pass normal review
  and `wakeflow_complete_demand` again.
- Do not split the operation into a manual state edit followed by
  `wakeflow_add_task`, and do not create a temporary demand/pod to work around
  the terminal-state guard. If the operation fails, the completed state must
  remain unchanged.
- Archived demand roots are immutable to workflow continuation. Public v3 has
  no sanitize or reopen target. A polluted legacy archive is explicit-migration
  input and must not be hand-edited. Independently scoped optimization, backlog
  work, or anything discovered after archive goes through the normal TODO /
  `wakeflow_create_demand` path with an explicit reference to the prior demand;
  never move or edit archived authority back into current state.

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
- No scores, no gates: intent alignment never blocks anything;
  controller-validated acceptance stays the only verdict.

## Stage Gates (route map: wakeflow-governance/references/stage-route-map.md)

- Before the FIRST implementation dispatch of a demand, verify the frozen
  demand authority AT THE DEMAND'S SCALE: full six-role contract for a requirement; a bug
  needs reproduction + scope + non-goals + Test decision (no Original Plan
  ceremony); a supplement needs a delta against the existing Requirement
  Design; research never gets an implementation dispatch. Any missing item
  remains S1 and routes to its actual owner (Design or user). Total control may
  author an inline authority only for bounded/already-documented work whose
  anchors already exist; never invent a gate artifact to pass.
- Before adding or dispatching a Test package, verify every active required non-Test
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

- Archive one completed/cancelled demand with `wakeflow_archive
  operation=preview`, review the portable whole-demand plan and privacy
  blockers, then use `operation=apply` only with the exact confirmed plan and
  digest. `inspect` is read-only and `recover` resumes only the named owner.
- Public v3 has no docs/TODO/sanitize archive target. A polluted legacy archive
  is explicit-migration input; never hand-edit it or move it back into current
  authority.
- In an idle moment, use `wakeflow_view operation=storage` for orientation.
  Legacy/unknown/preserved entries never authorize cleanup by themselves.
- An unknown local tree routes to the user. For an explicitly selected keeper,
  use `wakeflow_storage_preserve operation=preview`, then apply only the exact
  confirmed plan. Never invent another holding location or auto-delete.
- Release a preservation only through `operation=preview-release` followed by
  exact apply/recover. `wakeflow_prune_runtime` owns only whole-demand transport
  retention through preview/apply/recover after BusinessArchive and lease
  closure; audit preservation is not a prune target.

## Stop Conditions

Stop instead of dispatching when:

- The user goal or completion definition is unclear.
- The proportional demand authority is incomplete for a new demand's first implementation
  dispatch, or a Test dispatch leaves an existing non-Test target unaccepted,
  omits the controller's self-checks, or lacks its confirmed environment block.
- Required review inputs are missing or unreadable.
- The state root is not current or cannot be trusted.
- The controller is reacting to a keyword, familiar command shape, script hint,
  or urgency before naming the safe operation, recovery boundary, explicit
  plan, and smallest valid next step.
- A target window, repository, upstream dependency, or real thread id is
  missing.
- The next action would change scope, delete capability, downgrade capability,
  or make a product decision without user confirmation.
- The next action would add a TODO, follow-up requirement, task package, or
  scope expansion from code facts, test output, target backfill, implementation
  leftovers, or residual fields without first reading the full original plan /
  requirement design and confirming that the addition stays inside the original
  decisions and non-goals.
- A target result lacks reviewable inputs.
- Review inputs are only target prose, superficial script output, or status-table
  motion.
- Test says its result is acceptable but the controller has not inspected the
  named materials and run its own relevant probe.
- The result is only an empty interface, static mock, unused adapter, type-only
  contract, unreachable route, or documentation motion without a real consumer
  and validation path.
- Test exposed a product defect after the owning repository lineage was already
  accepted. Preserve the exact Test evidence and stop: current public v3 cannot
  reopen that lineage or add its same-demand fix before completion. Do not
  rework the Test task as a product repair or complete a known-defective demand
  merely to unlock continuation.
- Controller validation establishes a non-bug outcome mismatch, or a small requirement-level fix that is
  Design's job and not a code defect: `wakeflow_decide_review operation=decide`
  with decision `redesign` parks the affected task as `needs-rework` instead of
  bouncing point fixes between product windows.
  For a mainline demand, surface the redesign to the stateless mainline Design window with
  `wakeflow_deliver`; after the corrected requirement returns, add a full-context replacement
  package to the SAME demand with `replacesTargetTask` bound to the parked
  target's exact task/package tuple. Do
  not create a new demand or re-dispatch the old task. For a Pod demand, do not use mainline
  Design: Wakeflow cannot create a second frozen Pod Design generation, so keep the
  demand blocked and report that capability gap rather than overwriting the recorded handoff.
  Accepting a valid replacement marks the old task/package `superseded`; the
  parked demand's event history remains intact.
- A completed result would leave TODO/backlog, archive state, or current status
  inconsistent.
- The controller is about to poll/wait for targets after a send was recorded.
- There are no eligible tasks.

## Verification

Use the smallest verification that covers the changed surface. For Wakeflow
total-control work in an installed workspace, use MCP tools instead of direct
runtime scripts:

- `wakeflow_verify operation=inspect` for the strict workspace verdict.
- `wakeflow_status operation=inspect` for current v3 orientation.
- `wakeflow_next_work operation=inspect` for TODO authority inspection.
- `wakeflow_archive operation=preview/apply/inspect/recover` for one portable
  whole-demand BusinessArchive.
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

- `npm run validate`
- `npm run validate:claude`
- `npm run smoke`
- `npm run smoke:claude`
- `npm run check:core`
- `npm test`

Script output is a review input, not acceptance.

- Use `wakeflow_release_window_lock operation=release` only when the owning
  operation explicitly returns the exact current binding/lease/delivery CAS
  tuple. Never release by semantic window name, omit identity, infer rejection
  from prose, or delete a lease file. Accepted, ambiguous, and
  sent-unconfirmed target effects retain their authority until the proper
  result/rearm/lifecycle owner closes it.
