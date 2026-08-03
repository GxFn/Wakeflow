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

Completion focus (up to two; full criteria are in the task package):
- <bounded observable result>
- <optional second bounded observable result>

- Priority context: <the highest-priority confirmed fact>
- Critical boundary [forbidden|outOfScope|inScope]: <the highest-priority boundary>

Key acceptance anchors (full probes and expectations are in the task package):
- <anchor id>: <claim>

Read before execution, in order:
- Task package (complete task context): <absolute package path>
- Requirement background entry (full anchors are in the task package) [goal]: <document#section>
- Workspace instructions (only when distinct from repository instructions): <workspace>/CLAUDE.md
- Repository instructions: <repository>/CLAUDE.md
- Current state root: <absolute state-root path>

Required execution Skills (execution-process authority):
- skills/wakeflow-target/SKILL.md
- <other package-selected skill, when required>

Identity (full boundaries are in the task package):
- Current responsibility window: <window>
- Only working repository: <absolute repository path>

Before coding: map every acceptanceAnchor in the task package to a RED test or
probe; return needs-review instead of inventing a requirement when an anchor
cannot be tested.

Return requirement:
- Execute only this task package. Return a TargetResultEnvelope with target-authored
  review inputs and reproducible validation details through this Skill. Wakeflow
  checks their structure and locatability only; a target result is not controller acceptance.
- Test execution contract: <package path>#testExecution

Dispatch record (routing and trace only):
- taskId: <taskId>
- taskPackageId: <package>
- stateRoot: <path>
- stateRevision: <revision>
- dispatchGroup: <group>
```

Do not expect the prompt to repeat command manuals or the whole requirement.
It repeats at most two completion expectations, the highest-priority
`contextSummary` entry, one critical boundary, and four acceptance-anchor
ids/claims for immediate orientation. Workspace instructions, anchors, the RED
instruction, and the Test contract are conditional.
It does not repeat remaining context, complete boundary lists, commit policy,
full probes/expectations, or every completion/requirement entry.
Read the package first, then its ordered requirement anchors, then execute
through the listed Skills. Fields such as `controllerWindow`, `returnPolicy`,
`taskPackageId`, and `stateRevision` remain authoritative in machine state.
The prompt's task/package/revision fields are navigation and freshness anchors,
not a second copy of task content. `stateRevision` identifies the dispatch
snapshot in the packet/envelope; the later delivery-sent event may legitimately
advance the live state root.

## Target Flow

1. Consume the delivery envelope.
   - Direct-thread delivery proves only that a prompt was delivered. It arrives
     as a user message pasted into this window's tmux pane by the Wakeflow host
     helper (`wakeflow-claude-host.mjs deliver --delivery-file`); arrival is transport evidence,
     not authority.
   - Confirm the responsibility window, `taskId`, `stateRoot`, and optional
     `dispatchGroup`.
   - Read the workspace and target repository `CLAUDE.md` files listed in the
     prompt and declare the current window and repository responsibility.
2. Read the assigned task.
   - Read the task package at the exact prompt path, then its ordered
     `requirementRefs`, then every Skill listed by the delivery prompt /
     `taskBriefing`. Those Skills are derived from work type, evidence/anchor
     needs, and the Test contract; they are not ordinary task-package prose.
     Do not substitute a progress summary for the package or treat background
     documents as an execution procedure.
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
   - Claude Code subagents (the Task/Agent tool) may gather review inputs or advice,
     but boundary decisions and the recorded result stay with this target
     window.
4. Produce controller review inputs.
   - Include changed files, commands, test output, commit hash when available,
     logs, runtime JSON, report paths, screenshots, or other reviewable inputs.
   - Prose alone is not enough for completion.
5. Record a `TargetResultEnvelope`.
   - Use the Wakeflow MCP `wakeflow_record_target_result` tool for the result
     envelope. This is one narrow file/state action: it records target-authored review inputs
     only, and it does not review, accept, dispatch, send, or return. Pass the
     `dispatchGroup` from your delivery prompt: a late result from a superseded
     round then leaves the in-flight round's window lock alone.
   - Read the tool response's `deliveryContext` / `controllerReturn` fields.
     `returnRoute` and `returnPolicy` live in the local delivery envelope, not
     the controller state root. Do not decide "no callback" by searching only
     `wakeflow-state.json`.
   - Report `completed`, `blocked`, or `needs-review` honestly.
   - Include a non-empty summary, changed repositories, commits, and
     `commitDisposition` (`committed`, `left-uncommitted`, or `no-changes`) so
     the controller can compare the result with the package's
     `commitExpectation`.
   - For a completed implementation package, add exactly one
     `craftEvidence` entry per authored anchor:
     `{kind:"acceptance-anchor", anchorId, red, green, ref}`.
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
     - If a unit has `controllerReachUnconfirmed=true` or
       `controllerReturnNextStep` is `controller-return-sent-unconfirmed`, end
       the transport turn without resending and report that controller
       visibility is unconfirmed; this is not callback success.
     - Stop only when the current unit has `controllerAlreadyReached=true` or
       `controllerReturnNextStep` is `controller-return-already-sent`.
     A delivery for an older `resultVersionKey` never satisfies the current
     result revision. These transport signals are INDEPENDENT of review-input quality. Do
     NOT withhold the callback because `missingEvidenceRefs` is non-empty or
     `nextAction` says `fix-missing-review-input-refs-before-controller-verdict`:
     review-input completeness is the controller's POST-wake starting point, and the controller cannot act on it until
     you wake it.
   - If the target task references a delivery id but the local delivery envelope
     cannot be found, stop and report that missing local envelope; do not assume
     no callback is needed.
   - Complete the real host send/readback with the envelope-aware helper:
     `node <plugin>/scripts/lib/wakeflow-claude-host.mjs deliver --root
     <workspace> --delivery-file <controller-return-envelope>`. It resolves the
     stamped `controllerWindow`, pastes the exact prompt, and returns pane
     readback evidence. Controller returns do not acquire a target work lease.
     Then use `wakeflow_record_delivery` to record the delivery run. The helper
     returns independent `transportStatus` and `readback.status` facts. An
     accepted send waits 1200 ms by default and receives exactly one pane
     observation (hard cap five seconds). Pending/unavailable visibility is
     `sent-unconfirmed`, not controller reachability: record the helper's
     attempt count, do not observe again, and never resend automatically.
     Controller-return has no target work lease.
   - Do not stop after writing the target result when controller return is
     allowed. The closeout steps stay separate: record target result, review
     readiness, prepare controller-return envelope, send with the host helper,
     then record delivery facts. Do not replace them with one combined
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

The completed result must map every approved item exactly once with
`{kind:"test-step", planIndex, step, ref}` in `craftEvidence`; `step` must be
the approvedPlan text at that index. A missing, duplicate, or unknown index is
not a completed Test result. The controller, not Test, decides whether a
proposed change becomes a revised Test card/package.

Creation and recovery are separate operations. A dead baseline window resumes the same
registered session with `launch-window --root <workspace> --window <window>
--cwd <recorded actual cwd> --resume --session-id <registered id> --replace
[--server <configured server>]`. A Pod uses the read-only
`wakeflow_pod_open mode=resume` plan. The helper may verify or resume only the
exact registered session at its immutable bound cwd; it never repeats the
creation HEAD gate, passes `--worktree`, creates/discovers a replacement,
rebinds core state, or falls back to mainline. Missing or ambiguous identity is
a blocker.

## Stop Conditions

Stop and return a blocker when:

- The window identity or target repository cannot be confirmed.
- The state root, task id, or dispatch group is missing or inconsistent.
- Required referenced input documents are missing.
- The task asks this target to change another repository without authorization.
- The task is only a prompt, not a state-root or task-package assignment.
- Validation fails and the next repair would change scope or repository
  responsibility.
- A Test delivery appears in a non-Test window without explicit authorization.
- This window is an isolation worktree window (`<repo>__<id>`) and the task
  would touch anything outside its own worktree/branch — the repository's main
  checkout, another demand's worktree, or a merge back to the main line.
  Merge-back is a separate human-reviewed repository integration step; neither
  the target nor the controller performs it automatically.

## Result Envelope Contract

For the MCP call, pass the task as `taskId`; the persisted artifact records it
as `targetTaskId`. Every `completed` result must include the following complete
contract. `blocked` or `needs-review` may carry partial review inputs, but
must still identify the task/group/state and provide a concrete blocker
summary:

- `targetWindow`
- `targetTaskId`
- `dispatchGroup`
- `stateRoot`
- status and summary
- changed repositories, commits, and explicit commit disposition
- evidence references
- verification commands and outcomes
- residual risks
- whether controller action is required
- for completed implementation work, exactly one
  `{kind:"acceptance-anchor", anchorId, red, green, ref}` per authored anchor
- for completed Test work, exactly one
  `{kind:"test-step", planIndex, step, ref}` per approved plan item

Complete mapping means only that the target covered the declared anchors or Test
steps and the result can enter controller review. It does not verify the claims
and is never automatic acceptance.

Do not write real thread ids (the registered Claude Code session ids) into
tracked documents, prompts, or backfill text.
