# Wakeflow Delivery Reference

## Concepts

- `ControllerDispatchPacket`: a machine packet created from state-root task
  packages.
- `DeliveryEnvelope`: the prompt and transport metadata for a target window.
- `DirectThreadDeliveryRun`: evidence that the Codex host send/readback
  happened.
- `TargetResultEnvelope`: the target's structured result and evidence refs.
- `ReviewPack`: controller-side aggregation of target results.
- `ControllerReturn`: a delivery envelope that wakes the originating controller
  when policy allows.

For a Pod product target, delivery readiness also requires
`podProvisioning.phase=execution-ready` and a verified host-scoped binding.
For Pod Test, those facts are not enough: the exact current binding set must
also have `podProvisioning.testAccess.status=validated` with
`capability=direct-multi-root`. Unsupported access blocks delivery without a
main-checkout, product-window, or unverified per-repository-executor fallback.
The envelope may reference the logical binding but must not copy the real
thread id or infer cwd from static config, a window suffix, or the parent
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
- Workspace instructions: <workspace>/AGENTS.md
- Repository instructions: <repository>/AGENTS.md
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
- Execute only this task package. Return a TargetResultEnvelope with verifiable
  evidence. A target result is not controller acceptance.
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
field exactly to the host send tool.

## Send Boundary

Applied envelope preparation stores the envelope and reserves the shared
per-window target work lease with that delivery id, covering the prepare-to-send
gap. The Codex host tool performs the real send against that same lease;
controller-return delivery takes no target work lease. If the send is accepted
but the new turn is not visible yet, retry
only readback within a bounded attempt/time budget; never resend while
confirming that accepted send. Record accepted transport as `status=sent` with
the actual independent readback status (`confirmed`, `pending`, or
`unavailable`). Pending visibility is observation for Agent judgment, not a
send failure or strict gate. Then stop the controller turn; do not poll for
target completion.

## Result Review

Review always happens against the dispatch group and state root. A single target
result is not group completion unless the group expected only that target.

- `group-ready` waits for all expected targets or a blocker.
- `per-target` may return after each target, but still carries group context.
- Missing evidence blocks acceptance.

## Thread Id Boundary

Real thread ids live only in `.wakeflow-local/`. They must not appear in
tracked documents, prompts, GitHub, or backfill text. The full storage path and
never-write-to list live in
[references/direct-thread-window-config.md](direct-thread-window-config.md) (Storage).
