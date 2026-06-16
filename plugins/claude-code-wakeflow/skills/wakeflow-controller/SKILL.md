---
name: wakeflow-controller
description: Use when Wakeflow total control starts or resumes Wakeflow Delivery Loop in Claude Code, reviews target result envelopes, creates dispatch packets, builds delivery envelopes, sends deliveries to tmux-resident window sessions with the wakeflow-claude-host helper, decides acceptance / rework / block / next wave, or stops unattended automation.
---

# Wakeflow Controller

Use this skill only from the controller window. `CLAUDE.md` owns hard judgment;
this skill owns the mechanical loop steps.

## Purpose

Wakeflow Delivery Loop lets the controller fan out work to target window
sessions, receive compact result envelopes, review raw evidence, and decide the
next package. It does not replace planning, scope control, or acceptance.

Direct-thread dispatch is the normal transport; on Claude Code a Wakeflow
thread id is the window's Claude Code session id, generated at launch and
stable across resumes. Every Wakeflow window (the controller included) is a
tmux-resident interactive `claude` session inside the workspace tmux server
session. In explicitly enabled unattended mode, keep reviewing results, pulling
evidence, deciding, planning next eligible packages, and dispatching until
final completion, a hard gate, explicit user stop, missing evidence that needs
human judgment, or no eligible TODO remains.

After a delivery is sent, read back, and recorded as `status=sent` with
`readback.ok=true`, the controller dispatch turn is complete. Do not keep the
turn open with `sleep`, repeated result review, repeated session reads, or
manual polling. The target returns later through a `TargetResultEnvelope` and,
if policy allows, a controller-return delivery sent to the controller's own
tmux window. The activity monitor flips the tab to done when the result lands (lock released). Silence is never auto-judged: a long quiet spell may be a legitimate long tool call, so whether a window is stalled is the CONTROLLER'S judgment, made when it chooses to inspect (window-status, pane readback, the dispatch group). Do not arm per-dispatch watchers; `wait-results` exists only as an explicit synchronous wait for scripted flows (pure observation, no side effects).

## Source Practices For Acceptance

Controller acceptance adapts these mature review and evidence practices:

- `code-reviewer`: understand intent first, then review correctness, safety,
  maintainability, performance, and tests; large changes start with entrypoints
  and high-risk files; findings must be actionable with why and scope.
- `senior-qa`: optimize confidence per unit effort, choose test layers by risk,
  and treat flakiness as evidence degradation rather than success.
- SRE evidence practice: separate symptoms, causes, black-box evidence, and
  white-box evidence; logs, probes, and scripts are inputs, not conclusions.

The controller must preserve these practices while applying Wakeflow's stricter
authority boundary: target window sessions, Test, Design, scripts, Claude Code
subagents (the Task/Agent tool), and MCP tools provide review inputs only.
Only the controller can accept, request rework, block, wait, complete a demand,
archive, or create the next package.

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

1. Read `CLAUDE.md`, the active workspace index/status, and the current state
   root or controller document.
2. Confirm the user goal, fully read original plan / requirement design
   decisions, completion definition, remaining gap, first blocker, current
   demand status, and eligible target tasks.
3. State the safe operation, recovery boundary, and one-sentence plan before
   using tools, editing files, dispatching, accepting, archiving, or deleting.
4. If the demand is complete, blocked, paused, archived, review-ready, or lacks
   evidence, stop instead of preparing another package.
5. Create or select a task package only when it advances the confirmed goal.
6. Build a dispatch packet from the state root.
7. Build a delivery envelope.
8. Send the envelope prompt exactly as stored in the envelope with the tmux
   host helper in ONE step:
   `node <plugin>/scripts/lib/wakeflow-claude-host.mjs deliver --root <workspace>
   --delivery-file <deliveryFile from the prepare payload>` — it reads the
   envelope from disk, writes its own temp prompt file, sends, and returns
   compact readback. (The lower-level `send --window --prompt-file` form
   remains for custom prompts.) The
   helper enforces the shared per-window delivery lock
   (`.workspace-local/wakeflow-delivery/locks/<window>.json`, one in-flight
   delivery per window across hosts), pastes the prompt into the target's tmux
   pane via a tmux buffer (multiline-safe), and returns pane readback evidence
   (`readback.paneTail`). If the target window is mid-turn, the pasted message
   queues in its input and is processed next turn; that is fine. (Claude Code
   desktop windows are not an automation transport.)
9. Read back the helper send evidence and record the delivery run with
   `wakeflow_record_delivery` (default host method `wakeflow-claude-host send`).
10. End the dispatch turn. The controller-return delivery is the wake-up, and
   the activity monitor only updates live/done tab indicators; it never judges
   quiet windows as stalled or wakes anyone. Do not arm a per-dispatch watcher.

Recovery is not a delivery mode: when a target's tmux window is dead, finish or
relaunch the same session interactively with `launch-window --resume --session-id` (headless `claude -p` bills the separate Agent SDK credit from 2026-06-15); legacy form `claude -p --resume <registered session
id>` (the session id is stable), then relaunch the resident window with
`launch-window --replace --session-id <same id>` before the next delivery.

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
   - Are tests or probes at the right seam, and did they cover the behavior that
     matters?
   - If adding a TODO, follow-up, or next package, is it authorized by the
     original requirement decisions rather than inferred from residual code,
     existing tests, target backfill, or implementation leftovers?
   - Is the remaining gap a product-code defect, or a non-bug mismatch between
     the current effect and the user's intended outcome?
   - Is any remaining risk a blocker, a follow-up, or a user/controller
     decision?
   - Which TODOs close, remain, or need to be added?
7. Decide explicitly:
   - accept target result,
   - request rework,
   - route a non-bug outcome mismatch to Design redesign instead of product
     rework,
   - mark blocked,
   - wait for missing targets,
   - complete the demand,
   - or create the next eligible package.
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

## Group Policies

- `group-ready`: wait until every expected target is ready or a blocker makes
  the group impossible. Then return once to the controller.
- `per-target`: return when a target result arrives, still with group context.
- Empty target groups are not completion evidence.
- A single target result is not group completion unless the group expected only
  that target.

## Stop Conditions

Stop instead of dispatching when:

- The user goal or completion definition is unclear.
- Required evidence is missing or unreadable.
- The state root is not current or cannot be trusted.
- The controller is reacting to a keyword, familiar command shape, script hint,
  or urgency before naming the safe operation, recovery boundary, explicit
  plan, and smallest valid next step.
- A target window session, repository, upstream dependency, or real thread id
  (the registered Claude Code session id) is missing.
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
- The evidence shows a non-bug outcome mismatch that needs requirement or
  option redesign; pause implementation redispatch and route the next package
  to Design instead of bouncing point fixes between product windows.
- A completed result would leave TODO/backlog, archive state, or current status
  inconsistent.
- The controller is about to poll/wait for targets after a send was recorded
  (the controller-return delivery and the activity-monitor sentinel are the
  wake-ups; in-turn waiting is never allowed).
- There are no eligible tasks.

## Verification

Use the smallest verification that covers the changed surface. For Wakeflow
total-control work in an installed workspace, use MCP tools instead of direct
runtime scripts:

- `wakeflow_verify` for overall Wakeflow verification. Use `scriptTests: true`
  only when the change is Wakeflow source/plugin script maintenance.
- `wakeflow_status` for repository, state-root, and delivery-loop orientation.
- `wakeflow_next_work` for after-completion candidate scans.
- `wakeflow_archive_workspace_docs` and `wakeflow_archive_todo` for archive
  dry-runs or applies.
- `wakeflow_init_demand`, `wakeflow_add_task`, `wakeflow_complete_demand`,
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
