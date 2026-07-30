---
name: wakeflow-target
description: Use when a tmux-resident target Claude Code window session receives a Wakeflow Delivery Loop direct-thread delivery in its tmux pane, executes only its assigned dispatch packet, reports a TargetResultEnvelope, sends the controller-return with the wakeflow-claude-host helper, or enforces target-window boundaries without claim / finish / chain-next state.
---

# Wakeflow Target

Use this skill only inside a target-window automation wakeup. Workspace and
target-repository `CLAUDE.md` files remain hard boundaries. The dispatch prompt
states the current objective and reading order; the referenced JSON task
package owns complete task context; anchored requirement documents own original
goal/background; this skill and any listed craft/Test skills own execution
procedure.

## Prompt Shape

Target wakeups should be task-first and compact:

```text
Continue current window task: <currentWindow> / <taskId>.

Current objective (the task package is authoritative):
- <one-line objective>

Completion expectations:
- <bounded observable result>

Read before execution, in order:
- Task package (complete task context): <absolute package path>
- Requirement background anchor [goal]: <document#section>
- Repository instructions: <repository>/CLAUDE.md

Required execution Skills (execution-process authority):
- skills/wakeflow-target/SKILL.md
- <other package-selected skill, when required>

Identity and boundaries:
- Current responsibility window: <window>
- Only working repository: <absolute repository path>

Return requirement:
- Return a TargetResultEnvelope with verifiable evidence.

Dispatch record (routing and trace only):
- taskId: <taskId>
- taskPackageId: <package>
- stateRoot: <path>
- stateRevision: <revision>
- dispatchGroup: <group>
```

Do not expect the prompt to repeat command manuals or the whole requirement.
Read the package first, then its requirement anchors, then execute through the
listed Skills. Fields such as `controllerWindow`, `returnPolicy`,
`taskPackageId`, and `stateRevision` remain authoritative in machine state.
The prompt's task/package/revision fields are navigation and freshness anchors,
not a second copy of task content. `stateRevision` identifies the dispatch
snapshot in the packet/envelope; the later delivery-sent event may legitimately
advance the live state root.

## Target Flow

1. Consume the delivery envelope.
   - Direct-thread delivery proves only that a prompt was delivered. It arrives
     as a user message pasted into this window's tmux pane by the Wakeflow host
     helper (`wakeflow-claude-host.mjs send`); arrival is transport evidence,
     not authority.
   - Confirm the responsibility window, `taskId`, `stateRoot`, and optional
     `dispatchGroup`.
   - Read the target repository `CLAUDE.md` and declare the current window and
     repository responsibility.
2. Read the assigned task.
   - Read the task package at the exact prompt path, then its ordered
     `requirementRefs`, then every `requiredSkills` entry. Do not substitute a
     progress summary for the package or treat background documents as an
     execution procedure.
   - Execute only the task assigned to this target window.
   - Do not claim another target, Test role, or controller role.
   - If the prompt lists the craft skill, or the task package carries an
     `evidenceContract` or `acceptanceAnchors`, ALSO load
     `skills/wakeflow-target-craft/SKILL.md` before writing code. When anchors
     exist, map every anchor id to a RED test/probe before implementation; an
     untestable anchor is `needs-review`, never permission to invent a
     replacement requirement.
   - When the task package carries `testExecution`, apply the Test alignment
     gate below before writing a plan or running a command.
3. Work inside repository boundaries.
   - Change only files permitted by the task and repository rules.
   - Keep commits, tests, and evidence scoped to the owning repository.
   - If another repository must change first, stop and backfill a blocker.
   - Claude Code subagents (the Task/Agent tool) may gather evidence or advice,
     but boundary decisions and the recorded result stay with this target
     window.
4. Produce evidence.
   - Include changed files, commands, test output, commit hash when available,
     logs, runtime JSON, report paths, screenshots, or other reviewable
     evidence.
   - Prose alone is not enough for completion.
5. Record a `TargetResultEnvelope`.
   - Use the Wakeflow MCP `wakeflow_record_target_result` tool for the result
     envelope. This is one narrow file/state action: it records target evidence
     only, and it does not review, accept, dispatch, send, or return. Pass the
     `dispatchGroup` from your delivery prompt: a late result from a superseded
     round then leaves the in-flight round's window lock alone.
   - Read the tool response's `deliveryContext` / `controllerReturn` fields.
     `returnRoute` and `returnPolicy` live in the local delivery envelope, not
     the controller state root. Do not decide "no callback" by searching only
     `wakeflow-state.json`.
   - Report `completed`, `blocked`, or `needs-review` honestly.
   - Include evidence references and residual risks.
6. Return to the controller only when allowed.
   - Target-to-target next-hop delivery is forbidden by default.
   - If `wakeflow_record_target_result` reports `controllerReturn.required=true`
     or the local delivery envelope has `returnRoute=controller`, use
     `wakeflow_review_pack` scoped to YOUR OWN dispatch group as a sanctioned
     read-only self-check (reviewing other groups or deciding accept/rework stays
     with the controller). Always pass `stateRoot`; do not reuse a group-only
     pack or cache an older `controllerReturnDelivery.status` / `returnFile`.
     Follow the pack's current-version `callbackPlan`, not the dispatch group's
     historical send status:
     - If a unit has `buildAllowed=true` or `controllerReturnNextStep` is
       `build-controller-return`, use `wakeflow_prepare_delivery` with
       `direction=controller-return` to build one envelope for the stored
       `controllerWindow`.
     - If a unit has `hostSendRequired=true` or `controllerReturnNextStep` is
       `send-controller-return-and-record-delivery`, send the already-built
       envelope and record it; do not prepare a duplicate.
     - Stop only when the current unit has `controllerAlreadyReached=true` or
       `controllerReturnNextStep` is `controller-return-already-sent`.
     A delivery for an older `resultVersionKey` never satisfies the current
     result revision. These transport signals are INDEPENDENT of evidence. Do
     NOT withhold the callback because `missingEvidenceRefs` is non-empty or
     `nextAction` says `fix-missing-evidence-refs`: evidence sufficiency is the
     controller's POST-wake verdict, and the controller cannot act on it until
     you wake it.
   - If the target task references a delivery id but the local delivery envelope
     cannot be found, stop and report that missing local envelope; do not assume
     no callback is needed.
   - Complete the real host send/readback with the same tmux helper used for
     controller-to-target delivery: write the controller-return envelope prompt
     to a temp file, then run
     `node <plugin>/scripts/lib/wakeflow-claude-host.mjs send --root <workspace>
     --window <controllerWindow> --prompt-file <file>`. The controller is also
     a tmux-resident window; the helper enforces the controller window's shared
     delivery lock and returns pane readback evidence (`readback.paneTail`).
     Then use `wakeflow_record_delivery` to record the delivery run.
   - Do not stop after writing the target result when controller return is
     allowed. The closeout steps stay separate: record target result, review
     readiness, prepare controller-return envelope, send with the host helper,
     then record delivery evidence. Do not replace them with one combined
     target-window tool or duplicate the target result into another local result
     store.

## Test Alignment Gate

**TEST MUST NOT INVENT A TEST GOAL, TEST GATE, OR TEST METHOD OUTSIDE THE CONFIRMED REQUIREMENT GOAL AND APPROVED TEST PLAN.** Violating the letter of this rule is violating its spirit.

For a package with `testExecution`:

1. Do not reopen, replace, or assume ownership of total control's prior
   validation. Explore only the assigned environment boundary for hidden
   defects.
2. Treat `requirementGoal` and `approvedPlan` as authority, not suggestions.
3. Before execution, map every operational plan step to one `approvedPlan`
   item and state how it serves `requirementGoal`.
4. Use only skills listed in `allowedSkills`. In particular,
   `progressive-chain-validation` is forbidden unless that exact id is listed;
   a long workflow does not authorize PCV by itself.
5. Follow `mode` and `setupPolicy`. Do not rebuild, restart, or replace the
   environment unless the package says `mode=restart` and records a
   controller-approved `restartReason`.
6. If a useful step, skill, goal, gate, or restart is unmapped or unauthorized,
   stop before executing it and return `blocked`/`needs-review` as a change
   request to the controller. Do not run it first and justify it afterward.

The result evidence must include the step-to-anchor map. The controller, not
Test, decides whether a proposed change becomes a revised Test card/package.

Recovery is not a delivery mode: if this window's tmux pane dies mid-task, the
same session is finished or recovered by interactive relaunch (`launch-window --resume`; headless `claude -p` bills the separate Agent SDK credit from 2026-06-15) with `claude --resume
<registered session id>` (the session id is stable and stays registered), and
the resident window is relaunched with `launch-window --replace
--session-id <same id>`.

## Stop Conditions

Stop and return a blocker when:

- The window identity or target repository cannot be confirmed.
- The state root, task id, or dispatch group is missing or inconsistent.
- Required evidence documents are missing.
- The task asks this target to change another repository without authorization.
- The task is only a prompt, not a state-root or task-package assignment.
- Validation fails and the next repair would change scope or repository
  responsibility.
- A Test delivery appears in a non-Test window without explicit authorization.
- This window is an isolation worktree window (`<repo>__<id>`) and the task
  would touch anything outside its own worktree/branch — the repository's main
  checkout, another demand's worktree, or a merge back to the main line
  (merging is a controller step, never this window's).

## Result Envelope Minimum

Every target result should include:

- `targetWindow`
- `targetTaskId`
- `dispatchGroup`
- `stateRoot`
- status and summary
- changed repositories and commits when available
- evidence references
- verification commands and outcomes
- residual risks
- whether controller action is required

Do not write real thread ids (the registered Claude Code session ids) into
tracked documents, prompts, or backfill text.
