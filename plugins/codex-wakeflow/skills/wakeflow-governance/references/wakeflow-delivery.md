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

## Prompt Rules

Target prompts stay compact:

```text
Continue current window task: <currentWindow> / <taskId>.

Current objective (the task package is authoritative):
- <one-line objective>

Completion expectations:
- <bounded observable result>

Read before execution, in order:
- Task package (complete task context): <absolute package path>
- Requirement background anchor [goal]: <document#section>
- Repository instructions: <repository>/AGENTS.md

Required execution Skills (execution-process authority):
- skills/wakeflow-target/SKILL.md

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

When the task package carries `acceptanceAnchors`, the prompt includes only
their ids/claims and tells the target to map each full package anchor to a RED
test/probe before implementation. Full probe/expected content remains in the
task package. Target prepare previews this exact prompt and readiness without
writing; `apply=true` freezes the packet/envelope only after controller review
and requires the preview's `previewDigest` as `expectedPreviewDigest`. That
digest covers the complete prepared dispatch, not only the task package.

Controller-return prompts stay compact:

```text
Continue controller review: <window> backfill.

Variables:
- stateRoot: <path>
- dispatchGroup: <group>
- trigger: <window/task>
- blockedTargets: <only when non-empty>
- missingTargets: <only when non-empty>
- skill: skills/wakeflow-controller/SKILL.md
```

Do not wrap prompts in XML/JSON/delegation tags. Pass the envelope `prompt`
field exactly to the host send tool.

## Send Boundary

Scripts build envelopes and record evidence. The Codex host tool performs the
real send. Once send/readback is recorded as sent and readback-ok, stop the
controller turn; do not poll for target completion.

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
