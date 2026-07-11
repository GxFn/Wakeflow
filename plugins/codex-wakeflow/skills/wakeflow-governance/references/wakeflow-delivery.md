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

Variables:
- currentWindow: <window>
- taskId: <taskId>
- stateRoot: <path>
- dispatchGroup: <group>
- skill: skills/wakeflow-target/SKILL.md
```

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
- A blocker makes a `group-ready` callback ready even while sibling results are
  missing. The return carries both blocked and missing targets so the
  controller can stop, wait, cancel, or re-dispatch deliberately.
- Each `(state root, dispatch group, target window, target task)` has one
  current result. Corrections require explicit supersession; prior values move
  to `target-results/superseded/` with bidirectional lineage.

Research-only packets carry an `executionContract` plus a captured
`repositorySnapshot`. Targets compare HEAD and cleanliness before work and
again before return. Immutable-baseline drift is a blocker, not a comparable
completed result.

## Thread Id Boundary

Real thread ids live only in `.wakeflow-local/`. They must not appear in
tracked documents, prompts, GitHub, or backfill text. The full storage path and
never-write-to list live in
[references/direct-thread-window-config.md](direct-thread-window-config.md) (Storage).
