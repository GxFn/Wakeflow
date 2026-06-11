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

Scripts build envelopes and record evidence. The agent performs the real send
with the tmux host helper: write the envelope prompt to a temp file, then run
`node <plugin>/scripts/lib/wakeflow-claude-host.mjs send --root <workspace>
--window <target> --prompt-file <file> [--delivery-id <id>]`. The helper
enforces the shared per-window delivery lock
(`.workspace-local/wakeflow-delivery/locks/<window>.json`, one in-flight
delivery per window across hosts), pastes via a tmux buffer (multiline-safe),
and returns pane readback evidence. The send evidence is `readback.paneTail`
plus the recorded delivery run (`wakeflow_record_delivery`, default host
method `wakeflow-claude-host send`). A mid-turn target queues the pasted
message for its next turn.

Every Wakeflow window (controller included) is a tmux-resident interactive
`claude` session, so a controller return uses the same helper `send` aimed at
the dispatch group's stored controller window, recorded the same way.

Once send/readback is recorded as sent and readback-ok, stop the controller
turn; do not poll for target completion. The only allowed wait is the
background `wait-results --group <id> --target <windowA> --target <windowB>
[--timeout-sec N]` watcher: it completes when all expected target result
envelopes exist (also releasing those windows' locks) and wakes the
controller; a timeout means a stalled delivery to review. Recovery is not a
mode: a dead window's session is finished or recovered headless with
`launch-window --resume --session-id <registered id> --replace (interactive; headless claude -p bills the separate Agent SDK credit from 2026-06-15)`, then relaunched with
`launch-window --replace --session-id <same id>`. (Claude Code desktop windows
are not an automation transport.)

## Result Review

Review always happens against the dispatch group and state root. A single target
result is not group completion unless the group expected only that target.

- `group-ready` waits for all expected targets or a blocker.
- `per-target` may return after each target, but still carries group context.
- Missing evidence blocks acceptance.

## Thread Id Boundary

Real thread ids (Claude Code session ids) live only in `.workspace-local/`. They
must not appear in tracked documents, prompts, GitHub, or backfill text.
