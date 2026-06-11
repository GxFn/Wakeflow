# Wakeflow Delivery Reference

## Concepts

- `ControllerDispatchPacket`: a machine packet created from state-root task
  packages.
- `DeliveryEnvelope`: the prompt and transport metadata for a target window.
- `DirectThreadDeliveryRun`: evidence that the Claude Code host send/readback
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
field exactly to the host send transport.

## Send Boundary

Scripts build envelopes and record evidence. The Claude Code host transport
performs the real send, in one of two modes:

- desktop-session: send the envelope prompt to the registered target desktop
  session with the session message tool.
- headless-resume: resume the target session with
  `claude -p --resume <sessionId> "<prompt>" --output-format json` as a
  background task; the JSON result is the readback evidence. A resumed session
  can fork to a new session_id, which must be re-registered in the thread
  registry before the next send.

`workspace.config.json` may pin one transport with
`"deliveryMode": "desktop-session" | "headless-resume"`. Once send/readback is
recorded as sent and readback-ok, stop the controller turn; do not poll for
target completion.

## Result Review

Review always happens against the dispatch group and state root. A single target
result is not group completion unless the group expected only that target.

- `group-ready` waits for all expected targets or a blocker.
- `per-target` may return after each target, but still carries group context.
- Missing evidence blocks acceptance.

## Thread Id Boundary

Real thread ids (Claude Code session ids) live only in `.workspace-local/`. They
must not appear in tracked documents, prompts, GitHub, or backfill text.
