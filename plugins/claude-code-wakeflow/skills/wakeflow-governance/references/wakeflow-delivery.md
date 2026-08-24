# Wakeflow Delivery Reference

## Concepts

- `ControllerDispatchPacket`: a machine packet created from state-root task
  packages.
- `DeliveryEnvelope`: the prompt and transport metadata for a target window.
- `DirectThreadDeliveryRun`: evidence that the Claude Code host send/readback
  happened.
- `TargetResult`: one strict `artifactKind:"wakeflow-target-result"` record with
  transport-bound claims and review-input locators.
- `DispatchGroupReviewSnapshot`: deterministic current-result classification;
  it is a read model, not a file, candidate, or verdict.
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

Before coding: map every package acceptance anchor to a RED test or probe; if an
anchor is untestable, return needs-review instead of inventing a requirement.

Return requirement:
- Execute only this task package. Return one strict TargetResult with reviewable
  locators and reproducible validation details. Wakeflow checks structural
  closure and exact tuples, not truth; a target result is not controller acceptance.
- Test execution contract: <dispatch packet>#testContract.executionContract

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
package, except the Test execution contract, which is frozen in the dispatch
packet. Skills are derived during briefing from work type. `wakeflow_prepare_delivery
operation=target-preview` previews this exact prompt without writing;
`operation=target-apply` freezes only the exact group, packet, and envelope
after controller review. `operation=target-claim` is a separate immediate
pre-send lease step. Every later operation must carry the exact plan/current
tuple returned by its predecessor; stale authority fails closed.

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

Applied preparation stores immutable transport only. Immediately before the
real send, `operation=target-claim` acquires the exact typed current-window
lease. The v3 Claude transport adapter must hold its stable-window operation
mutex across validation, physical paste, and at most one bounded pane
readback. Record the observed fact with `wakeflow_record_delivery
operation=target-outcome`; that recording call is not the effect fence.

Accepted or ambiguous transport, including accepted transport with
pending/unavailable readback, closes the send turn and must not be resent.
Rejected-before-send requires explicit `operation=target-rearm`; no automatic
retry exists. Controller-return delivery takes no target work lease and uses
the separate `controller-preview`, `controller-apply`, and
`controller-pre-send` checks before its host effect. Its adapter still holds
the stable-window mutex, and the result is recorded with
`operation=controller-outcome`.

Route target effects through the packaged facade's exact `target-delivery`
command and Controller returns through `controller-return`; both delegate to
the current v3 transport owner. Retired public-v2 `deliver` and registry
commands are not aliases. If the exact effect or receipt is unavailable, stop
at the prepared/pre-send artifact and report the host-operation blocker. Do
not write a legacy binding, bypass the lease, or claim a synthetic send.

## Result Review

Review always happens against the dispatch group and state root. A single target
result is not group completion unless the group expected only that target.

- `group-ready` waits for all expected targets or a blocker.
- `per-target` may return after each target, but still carries group context.
- Missing required review inputs blocks reduction. Acceptance additionally
  requires the controller's fresh independent validation.

## Handle Boundary

Real session handles live only in `.wakeflow-local/`. They must not appear in
tracked documents, prompts, GitHub, or backfill text. The identity/projection
paths and never-write-to list live in
[references/direct-thread-window-config.md](direct-thread-window-config.md).
