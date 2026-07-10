---
name: wakeflow-target
description: Use when a target Codex window receives a Wakeflow Delivery Loop direct-thread delivery, executes only its assigned dispatch packet, reports a TargetResultEnvelope, or enforces target-window boundaries without claim / finish / chain-next state.
---

# Wakeflow Target

Use this skill only inside a target-window automation wakeup. The workspace
`AGENTS.md`, the dispatch packet state root or human context document, and the
target repository `AGENTS.md` remain higher authority.

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
   - Direct-thread delivery proves only that a prompt was delivered.
   - Confirm `currentWindow`, `taskId`, `stateRoot`, and optional
     `dispatchGroup`.
   - Read the target repository `AGENTS.md` and declare the current window and
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
3. Work inside repository boundaries.
   - Change only files permitted by the task and repository rules.
   - Keep commits, tests, and evidence scoped to the owning repository.
   - If another repository must change first, stop and backfill a blocker.
4. Produce evidence.
   - Include changed files, commands, test output, commit hash when available,
     logs, runtime JSON, report paths, screenshots, or other reviewable
     evidence.
   - Prose alone is not enough for completion.
5. Record a `TargetResultEnvelope`.
   - Use the Wakeflow MCP `wakeflow_record_target_result` tool for the result
     envelope. This is one narrow file/state action: it records target evidence
     only, and it does not review, accept, dispatch, send, or return.
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
   - Complete the real host send/readback with the same host thread tool used
     for controller-to-target delivery. The prepared envelope intentionally
     redacts the thread handle: read its `targetThread.threadRegistryFile`
     under `.wakeflow-local/wakeflow-delivery/`, load the registered `threadId`,
     call `send_message_to_thread`, and confirm the exact new turn with
     `read_thread`. Then use `wakeflow_record_delivery` to record the delivery
     run. Do not guess thread object keys or expose the id in tracked files.
   - Do not stop after writing the target result when controller return is
     allowed. The closeout steps stay separate: record target result, review
     readiness, prepare controller-return envelope, send with the host thread
     tool, then record delivery evidence. Do not replace them with one combined
     target-window tool or duplicate the target result into another local result
     store.

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

Do not write real thread ids into tracked documents, prompts, or backfill text.
