# Direct Thread Window Configuration

This reference defines the file contract for child-window direct thread
dispatch. It is a design and implementation guide for
`CODEX-DIRECT-THREAD-DISPATCH-2026-05-31`; it does not itself authorize
dispatch, acceptance, or product implementation.

## Principles

- Direct thread dispatch is the normal work pipeline.
- Raw Codex thread ids are local runtime state only. They must stay under
  `.workspace-local/` and must never be copied into tracked docs, prompts,
  commits, GitHub, or result text.
- `workspace.config.json` defines repository/window identity. It does not store
  thread ids or delivery runtime state.
- A child window may only execute work assigned to its configured window name
  and current dispatch packet.
- Keep-live is runtime liveness support for unattended automation mode. It is
  not delivery transport, target work, or acceptance evidence.
- Delivery success proves only that the prompt reached a thread. Total control
  still needs a `TargetResultEnvelope` and raw evidence before acceptance.
- Once delivery success and readback are recorded, the controller-side dispatch
  is complete. Total control waits for target callback and remains available
  for other concurrent workspace work.

## File Owners

| File / directory | Owner | Purpose | Tracked |
| --- | --- | --- | --- |
| `workspace.config.json` | workspace install scope | Generic repository/window map and roles. | yes |
| `.workspace-local/workspace.config.json` | local install scope | Machine-specific repository/window map override. | no |
| `.workspace-local/codex-automation-loop/thread-registry/<window>.json` | local runtime | Real Codex thread registration for one window. | no |
| `.workspace-local/codex-automation-loop/window-config/<window>.json` | local runtime | Derived child-window dispatch config, safe to regenerate from workspace config + thread registry. | no |
| `.workspace-local/codex-automation-loop/dispatch-groups/<group>.json` | total control | First-class dispatch group protocol: state ref, expected targets, controller window, and return policy. | no |
| `.workspace-local/codex-automation-loop/dispatch-packets/*.json` | total control | Controller-created work packet. | no |
| `.workspace-local/codex-automation-loop/delivery-envelopes/*.json` | total control / delivery adapter | Mechanical delivery plan that references a dispatch packet. | no |
| `.workspace-local/codex-automation-loop/delivery-runs/*.json` | delivery adapter | Actual direct-thread send attempt, readback, and failure evidence. | no |
| `.workspace-local/codex-automation-loop/target-results/*.json` | target window | Target result envelope returned to total control. | no |
| `.workspace-local/codex-automation-loop/keep-live/state.json` | delivery support | Current unattended keep-live process/state. | no |
| `.workspace-local/codex-automation-loop/stop.json` | total control | Explicit stop marker for unattended automation. | no |

## Thread Registration

One file per real Codex window:

```json
{
  "kind": "CodexWindowThreadRegistration",
  "version": 2,
  "windowName": "AlembicPlugin",
  "displayTitle": "AlembicPlugin 职责窗口",
  "deliveryRole": "target",
  "threadId": "<local-runtime-only>",
  "cwd": "/absolute/project/or/workspace/path",
  "responsibilityRoot": "/absolute/repository/or/testing/root",
  "writeBoundary": [
    "/absolute/path/that/window/may/write"
  ],
  "canonicalUse": "Stable purpose of this Codex thread.",
  "supersedesWindowNames": [],
  "registeredAt": "2026-05-31T00:00:00.000Z",
  "lastVerifiedAt": "2026-05-31T00:00:00.000Z"
}
```

Required fields:

- `windowName`: must match a configured dispatch window or explicitly allowed
  testing / design window.
- `deliveryRole`: `controller`, `target`, `test-target`, `design`, or
  `observer`. Only `controller`, `target`, and `test-target` are dispatchable.
- `threadId`: required for direct dispatch and local-only.
- `cwd`: the project cwd used by the Codex thread.
- `responsibilityRoot`: the real repository or testing responsibility root.

Compatibility:

- Existing `CodexAutomationThreadRegistration` v1 files may be read, but new
  writes should migrate to `CodexWindowThreadRegistration` v2.
- A v1 `role` value maps to v2 `deliveryRole`.
- If `cwd` and `responsibilityRoot` differ, the delivery adapter must preserve
  both; target prompts must state the window responsibility, not infer it from
  cwd alone.

## Derived Window Config

`window-config/<window>.json` is safe to regenerate. It combines local config,
repository role, thread registration, and current automation policy without
duplicating raw thread ids into tracked docs.

```json
{
  "kind": "CodexSubwindowDispatchConfig",
  "version": 1,
  "windowName": "AlembicPlugin",
  "repositoryPath": "../AlembicPlugin",
  "responsibility": "Codex MCP, skills, channel/marketplace, plugin runtime",
  "dispatchable": true,
  "threadRegistryFile": "thread-registry/AlembicPlugin.json",
  "delivery": {
    "transport": "direct-thread",
    "requireThread": true,
    "missingThread": "fail-closed",
    "readbackRequired": true
  },
  "automation": {
    "mode": "manual-or-unattended",
    "continuousWhenEnabled": true,
    "keepLive": "required-when-automation-enabled"
  },
  "result": {
    "returnRoute": "controller",
    "resultEnvelopeRequired": true
  }
}
```

No field in `window-config` may contain raw thread ids. Store only file refs or
redacted/hashes when a diagnostic needs identity continuity.

Multiple configured windows may intentionally point at the same repository path
when one physical support repo carries distinct responsibilities. Example:
`AlembicTest-IDE` and `AlembicTest` share `../AlembicTest`, but their task
boundaries differ. The generated `AGENTS.md` access card must list all window
aliases for that repository, list each window ledger, and require the target to
route by the `currentWindow` in the prompt, delivery envelope, or current plan.
Do not solve this by overwriting the same access card with alternating window
names.

Unmanaged real projects such as a protected `BiliDili` test project are skipped
by `write-agents --all --include-unmanaged` unless the caller also uses
`--include-real-project`. That flag should be reserved for an explicit
install-scope decision, not routine automation cleanup.

## Dispatch Group

`DispatchGroup` is the owner of callback policy. Do not let target windows
choose callback strategy ad hoc, and do not model it as a temporary delivery
flag.

```json
{
  "kind": "DispatchGroup",
  "version": 1,
  "groupId": "group-id",
  "stateRef": {
    "stateRoot": ".workspace-active/workspace/current/demand-key",
    "taskPackageId": "TASK-PACKAGE-ID",
    "stateRevision": 2
  },
  "humanContextRef": ".workspace-active/workspace/current/demand-key/developer-progress.md",
  "controllerWindow": "AlembicWorkspace-Aux",
  "expectedTargets": [
    {
      "targetWindow": "AlembicPlugin",
      "taskId": "TASK-ID",
      "packetId": "group-id__AlembicPlugin__TASK-ID"
    }
  ],
  "returnPolicy": {
    "mode": "group-ready"
  },
  "createdAt": "2026-05-31T00:00:00.000Z",
  "updatedAt": "2026-05-31T00:00:00.000Z"
}
```

Dispatch groups must contain `stateRef` and should carry `humanContextRef` for
the developer progress document. Groups without `stateRef` are invalid for the
current automation route.

Supported `returnPolicy.mode` values:

- `group-ready`: barrier callback. Build one controller return only after all
  expected target results exist.
- `per-target`: each target may callback once its own result exists. The
  controller return still carries the group snapshot so total control can see
  missing / blocked / remaining targets.

`controllerWindow` is fixed by the controller that creates the first dispatch
packet in the group. Later packets in the same group must use the same
controller. `build-controller-return` reads this field by default, so a group
started by controller A returns to controller A even when the workspace config's
global `controlWindow` points at a different controller.

Target result transport files are scoped by dispatch group when `--group` is
provided. This allows multiple controller windows to run parallel dispatch
loops against the same target window and task id without overwriting each
other's local result envelope. Controller-return envelopes are one-shot at the
group level: once a group has a pending or sent controller return, another
`build-controller-return` for that group must fail closed instead of creating a
duplicate wakeup.

## Delivery Envelope Changes

The code-stage `DeliveryEnvelope` should stop producing legacy schedule or
automation payloads. It should become a direct-thread plan:

```json
{
  "kind": "DeliveryEnvelope",
  "version": 2,
  "deliveryId": "delivery-...",
  "sourcePacketId": "dispatch-packet-id",
  "targetWindow": "AlembicPlugin",
  "taskId": "TASK-ID",
  "dispatchGroup": "group-id",
  "stateRef": {
    "stateRoot": ".workspace-active/workspace/current/demand-key",
    "taskPackageId": "TASK-PACKAGE-ID",
    "targetTaskId": "TASK-ID",
    "stateRevision": 2
  },
  "humanContextRef": ".workspace-active/workspace/current/demand-key/developer-progress.md",
  "prompt": "继续当前窗口任务：...",
  "returnPolicy": {
    "mode": "group-ready"
  },
  "returnRoute": "controller",
  "transport": {
    "kind": "direct-thread",
    "threadRegistryFile": "thread-registry/AlembicPlugin.json",
    "readbackRequired": true
  },
  "automation": {
    "enabled": false,
    "continuousLoop": false,
    "keepLive": false
  },
  "loopGuard": {
    "returnReason": "result-ready",
    "controllerReviewRequired": true,
    "noEligibleTaskAction": "stop-without-next-delivery",
    "repeatControllerReturnForbidden": true
  },
  "correlationId": "group-id",
  "createdAt": "2026-05-31T00:00:00.000Z"
}
```

The visible `prompt` is intentionally smaller than the envelope. Target prompts
show only `currentWindow`, `taskId`, `stateRoot`, optional `dispatchGroup`, and
the target skill path. Controller-return prompts show only `stateRoot`,
`dispatchGroup`, `trigger`, optional non-empty exception targets, and the
controller skill path. Keep `controllerWindow`, `returnPolicy`, `reviewScope`,
`groupStatus`, `demandKey`, `taskPackageId`, `stateRevision`, and
`humanContextRef` in machine JSON rather than repeating them in the prompt.

When the user explicitly enables unattended automation for the current state
root:

```json
{
  "automation": {
    "enabled": true,
    "continuousLoop": true,
    "keepLive": true,
    "keepLiveStateFile": "keep-live/state.json"
  }
}
```

Forbidden in v2 delivery envelopes:

- legacy `schedule` payloads
- `rrule`
- `codexAutomation`
- raw `targetThreadId` in default JSON output

## Controller Return Envelope

The controller-return envelope is a wakeup plan for the already registered
total-control thread. It is not a child-window next hop and it is not completed
until a matching delivery run proves host send/readback.

```json
{
  "kind": "ControllerReturnEnvelope",
  "version": 2,
  "deliveryId": "controller-return-...",
  "dispatchGroup": "group-id",
  "triggerTarget": "AlembicPlugin",
  "triggerTaskId": "TASK-ID",
  "returnPolicy": {
    "mode": "per-target"
  },
  "groupSnapshot": {
    "groupStatus": "partially-ready",
    "expectedTargets": ["AlembicPlugin", "AlembicAgent"],
    "completedTargets": ["AlembicPlugin"],
    "blockedTargets": [],
    "missingTargets": ["AlembicAgent"],
    "ready": [],
    "blocked": [],
    "missing": []
  },
  "reviewScope": "single-target",
  "returnRoute": "controller",
  "deliveryStatus": "pending-host-send"
}
```

For `group-ready`, `reviewScope` is `group` and the prompt lead is
`继续总控验收：<windowA>、<windowB> 回填。`. The dispatch group id stays in the
variables. For `per-target`, `reviewScope` is `single-target` and the prompt
lead is `继续总控验收：<triggerTarget> 回填。`. Both modes must carry the
group snapshot so the controller can distinguish one returned window from a
complete dispatch group.

The human-visible prompt should not repeat the full snapshot when it is a
happy path. Do not print `completedTargets`, and do not print
`blockedTargets: 无` or `missingTargets: 无`. Keep those details in
`groupSnapshot`; expose only non-empty exception state such as
`blockedTargets` or `remainingTargets`.

Controller-return exit logic:

- Build controller return according to the stored `DispatchGroup.controllerWindow`
  and `DispatchGroup.returnPolicy`. `group-ready` waits for every expected
  target result; `per-target` may return for the trigger target while other
  targets remain missing.
- `build-controller-return` only writes a pending controller-return envelope.
  The target must still send it to the existing registered controller thread,
  confirm readback, and record a `DirectThreadDeliveryRun` with `status="sent"`
  and `readback.ok=true`; do not create a new controller window only for
  return.
- If host thread send or readback is unavailable, record or report a blocked /
  failed delivery instead of claiming the callback happened.
- On receipt, total control reviews evidence and current TODOs. If no eligible
  next task remains, it stops without creating another delivery.
- A controller-return message must never create another controller-return for
  itself.

## Delivery Run Evidence

Every actual thread-send attempt writes a run file:

```json
{
  "kind": "DirectThreadDeliveryRun",
  "version": 1,
  "deliveryRunId": "run-...",
  "deliveryId": "delivery-...",
  "targetWindow": "AlembicPlugin",
  "transport": "direct-thread",
  "status": "sent",
  "thread": {
    "windowName": "AlembicPlugin",
    "threadIdRedacted": true,
    "threadRegistryFile": "thread-registry/AlembicPlugin.json"
  },
  "hostAction": {
    "method": "send_message_to_thread",
    "mode": "new-turn"
  },
  "readback": {
    "checked": true,
    "ok": true,
    "evidence": "host-readback-summary-or-local-tool-output"
  },
  "keepLive": {
    "enabledForRun": false,
    "stateFile": null
  },
  "createdAt": "2026-05-31T00:00:00.000Z"
}
```

Allowed `status` values:

- `sent`: host send succeeded as a normal new turn / follow-up, and readback
  evidence exists.
- `blocked`: missing thread registration, no host thread-send capability, or
  another condition that prevents direct send.
- `failed`: host send attempted but failed; include error summary.

`sent` is not acceptance. The target still must return a result envelope.
It is, however, enough to close the controller-side dispatch action for that
target. The controller should not remain in an artificial active state while it
waits.

## Keep-Live State

Keep-live is required only when unattended automation is enabled:

```json
{
  "kind": "AutomationKeepLiveState",
  "version": 1,
  "enabled": true,
  "automationRunId": "run-or-dispatch-group",
  "mechanism": "macos-caffeinate",
  "strategy": "watcher",
  "command": "caffeinate",
  "args": ["-dims", "-w", "<worker-pid>"],
  "token": "<local-token>",
  "startedAt": "2026-05-31T00:00:00.000Z",
  "pid": 12345,
  "workerPid": 12345,
  "childPid": 12346,
  "status": "running",
  "lastCheckedAt": "2026-05-31T00:00:00.000Z",
  "error": null
}
```

Keep-live failure blocks unattended reliability, not the target task itself.
Total control records it as automation readiness risk and decides whether to
continue manually.

Local keep-live uses `start-keep-live` / `stop-keep-live`. The script writes
both `keep-live/state.json` and `keep-live/control.json`; the watcher is shared
across concurrent controller runs, and `stop-loop` only releases the current
run's lease. The watcher exits after the final lease is released. `keep-live-state`
is reserved for manually proven or external keep-live evidence.

If keep-live is absent, fails, or is not needed, direct-thread dispatch can
still be complete after send/readback; the target callback is responsible for
returning the task to total control.

## Stop And Cleanup

- `stop.json` stops future unattended automation dispatch. It does not delete
  past delivery evidence.
- Stale legacy delivery envelopes with old schedule payloads should be ignored
  for new dispatch and may be archived or deleted only by total-control
  decision.
- Thread registrations are not deleted by default. Replace them only when the
  user opens a new responsibility window or explicitly changes the canonical
  thread.

## Implementation Checklist

1. Add `window-config/`, `dispatch-groups/`, and `delivery-runs/` directories
   to the local runtime initializer.
2. Extend thread registration from v1 to v2 while reading v1 as compatibility.
3. Generate `CodexSubwindowDispatchConfig` from workspace config + thread
   registry without exposing raw thread ids.
4. Change `build-delivery` / `build-controller-return` to v2 direct-thread
   envelopes, preserve `DispatchGroup.controllerWindow` /
   `DispatchGroup.returnPolicy`, and remove legacy schedule / automation
   payloads.
5. Add a delivery adapter entry that consumes v2 envelopes, calls the host
   thread-send capability, writes `DirectThreadDeliveryRun`, and fails closed
   when thread-send cannot be proven.
6. Add automation-enabled mode that loops controller review / next-wave
   dispatch until final completion, hard gate, user stop, missing evidence that
   needs human judgment, or no eligible TODO.
7. Add keep-live start/check/stop state under `keep-live/state.json` for
   automation-enabled runs.
8. Add unit tests for v1 registry compatibility, v2 redaction, missing thread
   fail-closed, direct delivery run evidence, continuous-loop stop conditions,
   and keep-live state failures.
