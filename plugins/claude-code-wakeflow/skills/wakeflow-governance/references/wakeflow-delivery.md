# Wakeflow Delivery Reference

## Concepts

- `ControllerDispatchPacket`: a machine packet created from state-root task
  packages.
- `DeliveryEnvelope`: the prompt and transport metadata for a target window.
- `DirectThreadDeliveryRun`: evidence that the Claude Code host send/readback
  happened.
- `TargetResultEnvelope`: the target's structured claims and review-input refs.
- `ReviewPack`: controller-side aggregation of target results and structural gaps; it does not verify truth.
- `ControllerReturn`: a delivery envelope that wakes the originating controller
  when policy allows.

For a Pod product target, delivery readiness also requires
`podProvisioning.phase=execution-ready` and a verified host-scoped binding.
For Pod Test, those facts are not enough: the exact current binding set must
also have `podProvisioning.testAccess.status=validated` with
`capability=direct-multi-root`. Unsupported access blocks delivery without a
main-checkout, product-window, or unverified per-repository-executor fallback.
The envelope may reference the logical binding but must not copy the real
session id or infer cwd from static config, a window suffix, or the parent
workspace.

## Prompt Rules

Target prompts stay compact:

```text
Continue current window task: <currentWindow> / <taskId>.

Current objective (the task package is authoritative):
- <one-line objective>

Completion focus (full criteria are in the task package):
- <up to two ordered observable results>

- Priority context: <highest-priority confirmed fact>
- Critical boundary [forbidden|outOfScope|inScope]: <highest-priority boundary>

Key acceptance anchors (full probes and expectations are in the task package):
- <up to four anchor ids/claims>

Read before execution, in order:
- Task package (complete task context): <absolute package path>
- Requirement background entry (full anchors are in the task package) [goal]: <document#section>
- Workspace instructions: <workspace>/CLAUDE.md
- Repository instructions: <repository>/CLAUDE.md
- Current state root: <absolute state-root path>

Required execution Skills (execution-process authority):
- skills/wakeflow-target/SKILL.md
- <other derived Skill, when required>

Identity (full boundaries are in the task package):
- Current responsibility window: <window>
- Only working repository: <absolute repository path>

Before coding: map every package acceptanceAnchor to a RED test or probe; if an
anchor is untestable, return needs-review instead of inventing a requirement.

Return requirement:
- Execute only this task package. Return a TargetResultEnvelope with reviewable
  inputs and reproducible validation details. Wakeflow checks structure and
  path locatability only; a target result is not controller acceptance.
- Test execution contract: <package>#testExecution

Dispatch record (routing and trace only):
- taskId: <taskId>
- taskPackageId: <package>
- stateRoot: <path>
- stateRevision: <revision>
- dispatchGroup: <group>
```

Anchor, RED, workspace, and Test lines are conditional. The prompt contains
the objective, at most two completion expectations, one priority-context fact,
one critical boundary, at most four anchor ids/claims, and one original
requirement entry. Complete context, requirement anchors, boundary lists,
commit policy, probes, Test policy, and completion criteria remain in the task
package. Skills are derived during briefing from work type, evidence/anchor
needs, and the Test contract. Target prepare previews this exact prompt without
writing; `apply=true` freezes the packet/envelope only after controller review
and requires the preview's `previewDigest` as `expectedPreviewDigest`. That
digest covers the complete prepared dispatch, not only the task package.

Controller-return prompts stay compact:

```text
Continue controller review: <window> backfill.

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

Do not wrap prompts in XML/JSON/delegation tags. Pass the envelope `prompt`
field exactly to the host send transport.

## Send Boundary

Scripts build envelopes and record delivery facts. The agent performs the real send
with the tmux host helper — primary path, one step:
`node <plugin>/scripts/lib/wakeflow-claude-host.mjs deliver --root <workspace>
--delivery-file <envelope.json>`. It reads the prepared envelope, renders the
prompt, resolves the target window (pod demands route controller-returns via
the envelope's stamped `controllerWindow`), and needs no temp file. For custom
prompts outside an envelope, the low-level path remains: write the prompt to a
temp file, then `send --root <workspace> --window <target> --prompt-file
<file> --delivery-id <id>`. This low-level form is not a controller-return
transport. For target delivery the helper enforces the
shared per-window work lease already reserved by applied envelope preparation
(`.wakeflow-local/wakeflow-delivery/locks/<window>.json`, one in-flight target
delivery per window across hosts). It reuses/revalidates the same delivery id,
pastes via a tmux buffer (multiline-safe), and returns pane readback evidence.
The send evidence is `readback.paneTail`
plus the recorded delivery run (`wakeflow_record_delivery`, host method
`wakeflow-claude-host deliver`). A different fresh delivery cannot queue behind
an active target work lease; it fails closed.

Every Wakeflow window is a tmux-resident interactive `claude` session. A
controller return uses the envelope-aware `deliver --delivery-file` path aimed
at the stamped controller window. It does not acquire a target work lease; the
helper still serializes pane paste/readback and the run is recorded normally.

If send is accepted but the new pane turn is not visible yet, retry only
readback within the fixed bounded attempt/time budget; never resend while
confirming the accepted send. Record `status=sent` from accepted transport with
the actual independent readback status (`confirmed`, `pending`, or
`unavailable`). Pending visibility is observation for Agent judgment, not a
send failure or a strict completion gate. Then stop the controller turn; do not
poll for target completion. The wake-up is the target's
controller-return delivery, and the activity monitor flips the delivered window's tab to done when the result lands (lock released); silence is never auto-judged — whether a quiet window is stalled is the controller's judgment, made when it chooses to inspect. `wait-results
--group <id> [--target <w>...] [--timeout-sec N]` remains available as an
EXPLICIT synchronous wait for scripted flows only (pure observation, no lock
or glyph side effects); it is not a default dispatch step. Creation and
recovery are separate operations. Resume a dead baseline window with
`launch-window --root <workspace>
--window <window> --cwd <recorded actual cwd> --resume --session-id
<registered id> --replace [--server <configured server>]`. A Pod instead uses
the read-only `wakeflow_pod_open mode=resume` plan. The helper verifies or
resumes only the exact registered session at the immutable bound cwd; it never
repeats the creation HEAD gate, adds `--worktree`, creates/discovers a
replacement, rebinds core state, or falls back to mainline. Missing or
ambiguous identity remains blocked. (Claude Code desktop windows are not an
automation transport.)

## Result Review

Review always happens against the dispatch group and state root. A single target
result is not group completion unless the group expected only that target.

- `group-ready` waits for all expected targets or a blocker.
- `per-target` may return after each target, but still carries group context.
- Missing required review inputs blocks reduction. Acceptance additionally
  requires the controller's fresh independent validation.

## Thread Id Boundary

Real thread ids (Claude Code session ids) live only in `.wakeflow-local/`. They
must not appear in tracked documents, prompts, GitHub, or backfill text. The full
storage path and never-write-to list live in
[references/direct-thread-window-config.md](direct-thread-window-config.md) (Storage).
