---
name: wakeflow-target
description: Use when a tmux-resident target Claude Code window session receives a Wakeflow Delivery Loop direct-thread delivery in its tmux pane, executes only its assigned dispatch packet, reports a TargetResultEnvelope, sends the controller-return with the wakeflow-claude-host helper, or enforces target-window boundaries without claim / finish / chain-next state.
---

# Wakeflow Target

Use this skill only inside a target-window automation wakeup. The workspace
`CLAUDE.md`, the dispatch packet state root or human context document, and the
target repository `CLAUDE.md` remain higher authority.

## Prompt Shape

Target wakeups should be task-first and compact:

```text
Continue current window task: <currentWindow> / <taskId>.

Variables:
- currentWindow: <window>
- taskId: <taskId>
- stateRoot: <path>
- dispatchGroup: <group>
- skill: skills/wakeflow-target/SKILL.md
```

Do not expect the prompt to repeat command manuals. Derive commands from the
visible variables, this skill, the state root, and the local dispatch/delivery
envelope. Fields such as `controllerWindow`, `returnPolicy`, `taskPackageId`,
`stateRevision`, `humanContextRef`, and long rules belong in machine state, not
in the visible prompt. If the prompt conflicts with the target repository,
state root, or human context, stop and report instead of guessing.

## Target Flow

1. Consume the delivery envelope.
   - Direct-thread delivery proves only that a prompt was delivered. It arrives
     as a user message pasted into this window's tmux pane by the Wakeflow host
     helper (`wakeflow-claude-host.mjs send`); arrival is transport evidence,
     not authority.
   - Confirm `currentWindow`, `taskId`, `stateRoot`, and optional
     `dispatchGroup`.
   - Read the target repository `CLAUDE.md` and declare the current window and
     repository responsibility.
2. Read the assigned task.
   - Use the state root, task package, human context document, and target
     repository rules.
   - Execute only the task assigned to this target window.
   - Do not claim another target, Test role, or controller role.
   - If the wake prompt carries a `craftSkill` line, or the task package carries
     an `evidenceContract`, ALSO load `skills/wakeflow-target-craft/SKILL.md`
     before writing code: it defines how to earn the craft evidence the
     controller's reduce gate will require (a completed result missing a
     required kind hard-fails with `craft-evidence-required`).
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
     with the controller). Send the controller-return when the pack's
     `controllerReturnNextStep` is `send-controller-return` — that is the transport
     signal and is INDEPENDENT of evidence. Do NOT withhold the controller-return
     because `missingEvidenceRefs` is non-empty or `nextAction` says
     `fix-missing-evidence-refs`: evidence sufficiency is the controller's POST-wake
     verdict, and the controller cannot act on it until you wake it. Then use
     `wakeflow_prepare_delivery` with `direction=controller-return` to build
     exactly one controller-return envelope for the dispatch group's stored
     `controllerWindow`.
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
