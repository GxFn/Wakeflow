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
- <bounded observable result>

Read before execution, in order:
- Task package (complete task context): <absolute package path>
- Requirement background entry (full anchors are in the task package) [goal]: <document#section>
- Repository instructions: <repository>/CLAUDE.md

Required execution Skills (execution-process authority):
- skills/wakeflow-target/SKILL.md

Identity (full boundaries are in the task package):
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
task package. The prompt likewise shows only the first two ordered completion
expectations and one original requirement entry; complete context, requirement
anchors, boundaries, commit policy, and completion criteria remain in the task
package. Target prepare previews this exact prompt and readiness without
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
field exactly to the host send transport.

## Send Boundary

Scripts build envelopes and record evidence. The agent performs the real send
with the tmux host helper — primary path, one step:
`node <plugin>/scripts/lib/wakeflow-claude-host.mjs deliver --root <workspace>
--delivery-file <envelope.json>`. It reads the prepared envelope, renders the
prompt, resolves the target window (pod demands route controller-returns via
the envelope's stamped `controllerWindow`), and needs no temp file. For custom
prompts outside an envelope, the low-level path remains: write the prompt to a
temp file, then `send --root <workspace> --window <target> --prompt-file
<file> [--delivery-id <id>]`. Either way the helper
enforces the shared per-window delivery lock
(`.wakeflow-local/wakeflow-delivery/locks/<window>.json`, one in-flight
delivery per window across hosts), pastes via a tmux buffer (multiline-safe),
and returns pane readback evidence. The send evidence is `readback.paneTail`
plus the recorded delivery run (`wakeflow_record_delivery`, default host
method `wakeflow-claude-host send`). A mid-turn target queues the pasted
message for its next turn.

Every Wakeflow window (controller included) is a tmux-resident interactive
`claude` session, so a controller return uses the same helper `send` aimed at
the dispatch group's stored controller window, recorded the same way.

Once send/readback is recorded as sent and readback-ok, stop the controller
turn; do not poll for target completion. The wake-up is the target's
controller-return delivery, and the activity monitor flips the delivered window's tab to done when the result lands (lock released); silence is never auto-judged — whether a quiet window is stalled is the controller's judgment, made when it chooses to inspect. `wait-results
--group <id> [--target <w>...] [--timeout-sec N]` remains available as an
EXPLICIT synchronous wait for scripted flows only (pure observation, no lock
or glyph side effects); it is not a default dispatch step. Recovery is not a
mode: when a tmux window dies, the registered session id remains the thread
id — relaunch the SAME session interactively with `launch-window --resume
--session-id <registered id> --replace` (subscription pool, same id).
Headless `claude -p --resume` is a last resort: from 2026-06-15 it bills the
separate Agent SDK credit. (Claude Code desktop windows are not an automation
transport.)

## Result Review

Review always happens against the dispatch group and state root. A single target
result is not group completion unless the group expected only that target.

- `group-ready` waits for all expected targets or a blocker.
- `per-target` may return after each target, but still carries group context.
- Missing evidence blocks acceptance.

## Thread Id Boundary

Real thread ids (Claude Code session ids) live only in `.wakeflow-local/`. They
must not appear in tracked documents, prompts, GitHub, or backfill text. The full
storage path and never-write-to list live in
[references/direct-thread-window-config.md](direct-thread-window-config.md) (Storage).
