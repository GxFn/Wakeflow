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
2. Confirm the user goal, completion definition, remaining gap, first blocker,
   current demand status, and eligible target tasks.
3. If the demand is complete, blocked, paused, archived, review-ready, or lacks
   evidence, stop instead of preparing another package.
4. Create or select a task package only when it advances the confirmed goal.
5. Build a dispatch packet from the state root.
6. Build a delivery envelope.
7. Send the envelope prompt through the Codex host thread tool exactly as stored
   in the envelope.
8. Read back the host send evidence and record the delivery run.
9. End the dispatch turn.

## Review Target Results

1. Import or locate target result envelopes for the dispatch group.
2. Run group review against the state root.
3. Check for missing, blocked, or ready targets.
4. Pull raw evidence before deciding.
5. Decide explicitly:
   - accept target result,
   - request rework,
   - mark blocked,
   - wait for missing targets,
   - complete the demand,
   - or create the next eligible package.
6. Record the decision in controller state before dispatching follow-up work.

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
- A target window, repository, upstream dependency, or real thread id is
  missing.
- The next action would change scope, delete capability, downgrade capability,
  or make a product decision without user confirmation.
- A target result lacks reviewable evidence.
- The controller is about to poll/wait for targets after a send was recorded.
- There are no eligible tasks.

## Verification

Use the smallest verification that covers the changed surface. For Wakeflow
script or automation changes, prefer:

- `node scripts/wakeflow-verify.mjs`
- `node scripts/wakeflow-verify.mjs --with-script-tests`
- `node scripts/wakeflow-check-scripts.mjs --json`
- `node scripts/wakeflow-smoke.mjs`
- `npm test`

Script output is evidence, not acceptance.
