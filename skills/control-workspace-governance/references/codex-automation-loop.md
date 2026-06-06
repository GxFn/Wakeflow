# Codex Automation Closed Loop

This reference describes the automation path for ControlWorkspace. It is the
only supported closed-loop automation contract surface.

Child-window file configuration, thread registry schema, delivery-run evidence,
and keep-live state are defined in
[direct-thread-window-config.md](direct-thread-window-config.md).

## Layering

| Layer | Owns | Must not own |
| --- | --- | --- |
| Controller planning | User goal, controller state root, task package, target list, dispatch packet content, and human progress context. | Codex thread-send API details, child-window execution, acceptance without evidence, or Markdown-as-state authority. |
| Delivery adapter | Direct thread send/readback evidence and delivery log. | Markdown-plan parsing, prompt authorship, task acceptance, TODO selection, legacy automation transport, or alternate delivery behavior. |
| Target execution | Assigned task execution inside one window/repo, evidence collection, result envelope. | Other windows' work, next-wave planning, controller acceptance. |
| Controller review | Result aggregation, raw evidence pull, accept/rework/block/next-wave decision. | Blind trust in result envelopes or script statuses. |

## Commands

Use `node scripts/codex-automation-loop.mjs` from the control workspace root.

| Scenario | Command | Meaning |
| --- | --- | --- |
| Inspect local loop state | `status --json` | Counts local dispatch packets, delivery envelopes, and target results. |
| Register target thread | `register-thread --window <window> --thread-id <id> --write --json` | Stores a real Codex thread id under ignored local runtime. JSON output redacts the id. |
| Build child-window file config | `build-window-config --window <window> --require-thread --write --json` | Writes a local `CodexSubwindowDispatchConfig` with dispatchability, role, registry file reference, return route, and automation keep-live requirements. It never exposes raw thread ids. |
| Create a delivery envelope | `build-delivery --packet-file <packetFile> --require-thread --write --json` | Writes a `DeliveryEnvelope`; the delivery adapter must use direct thread dispatch. If a real thread id or host send capability is unavailable, fail closed for total-control judgment. |
| Prepare state-root dispatch mechanically | `prepare-dispatch-from-state --state-root <path> --target-task-id <task> --group <group> --controller-window <controller> --human-context-ref <path> --require-thread --write --json` | Default route for eligible new work. Reads `controller-state.json` and task-package JSON, then writes window config, dispatch packet / group, and delivery envelope with `stateRef` / `humanContextRef`. It does not read a Markdown plan as authority and stops before host thread send/readback. It fails closed for terminal / paused / blocked / review-ready demands and accepted / completed / blocked target tasks. |
| Record delivery evidence | `record-delivery-run --delivery-file <deliveryFile> --status sent --readback-ok true --evidence "<evidence>" --write --json` | Records the local host send/readback result for a delivery envelope. This is transport evidence only, not task acceptance. |
| Start keep-live watcher | `start-keep-live --automation-run-id <id> --write --json` | Starts a local macOS watcher for unattended-run keep-live support and records state/control files under ignored runtime. This is readiness support only, not delivery or acceptance. |
| Stop keep-live watcher | `stop-keep-live --automation-run-id <id> --reason "<reason>" --write --json` | Stops the local watcher through its control marker and records whether worker / child processes exited. |
| Record external keep-live state | `keep-live-state --automation-run-id <id> --status running --mechanism macos-caffeinate --pid <pid> --write --json` | Compatibility command for manually proven or external keep-live evidence. Prefer `start-keep-live` for local unattended automation. |
| Record target result | `submit-result ... --write --json` | Writes a `TargetResultEnvelope`; it is not an acceptance verdict. When `--group` is provided, the local transport result file is scoped by dispatch group so concurrent controller runs cannot overwrite each other by reusing a target window and task id. |
| Check group readiness | `review-results --group <group> --json` | Returns legacy `decision` plus structured `returnPolicy`, `groupStatus`, `readyResults`, `missingResults`, `blockedResults`, `groupSnapshot`, and `controllerReturnDeliveries`. Total control still pulls raw evidence. |
| Build controller review pack | `review-pack --group <group> --json` or `review-pack --state-root <path> --json` | Read-only wrapper around group readiness or state-root target results. It lists evidence refs, verification summaries, and review gates; it still requires total-control evidence review and verdict. |
| Build controller return | `build-controller-return --group <group> --trigger-target <window> --trigger-task-id <task> --return-reason result-ready --require-thread --write --json` | Looks up the registered controller thread from the dispatch group's stored `controllerWindow` and writes a pending `ControllerReturnEnvelope` according to the dispatch group's `returnPolicy`. The envelope includes `controllerWindow`, `triggerTarget`, `returnPolicy`, `groupSnapshot`, and `reviewScope`. This is not a completed callback until `record-delivery-run` records `status=sent` and `readback.ok=true`. If the group already has a pending or sent controller return, the command fails closed instead of creating a duplicate return. |
| Stop future delivery | `stop-loop --reason "<reason>" --write --json` | Writes an explicit local stop marker. |

## Delivery Transport Policy

The accepted direction for `CODEX-DIRECT-THREAD-DISPATCH-2026-05-31` is:

- default target fan-out and controller return: direct Codex thread delivery only;
- send as a normal new turn / follow-up and verify thread readback;
- missing real thread id or missing host send/readback capability: fail closed and return to total-control judgment;
- delivery success: transport evidence only, never task acceptance.

Direct thread dispatch is the normal work pipeline, whether the developer is
present or the run is unattended. When unattended automation is explicitly
enabled, the loop is continuous: controller review, evidence pull, acceptance
or rework decision, next task package, direct dispatch, and controller return
repeat until final completion, a hard gate, explicit user stop, missing
evidence requiring human judgment, or no eligible TODO remains.

Controller dispatch has a completion boundary. After the direct-thread send is
read back and recorded with `record-delivery-run`, total control has finished
that dispatch and should release itself for other workspace traffic. It should
not keep a synthetic working state merely to stay attached to the dispatched
task. The next touchpoint is the target window's `TargetResultEnvelope` plus a
controller-return when the stored dispatch group return policy allows it.
Do not keep the same controller turn alive with `sleep`, repeated
`review-results`, repeated `read_thread`, or manual polling just to wait for
that result. Waiting is represented by the absence of a controller-return, not
by a busy controller thread.

Controller return is a wakeup for total-control review, not an instruction to
keep looping. Return policy belongs to `DispatchGroup`, not to a target's ad-hoc
choice. `group-ready` is a barrier callback: one controller return after all
expected targets have a result. `per-target` lets any returned target wake total
control, but the return envelope still carries `groupSnapshot` so total control
can see which targets remain missing or blocked. A controller-return envelope
also carries `loopGuard`: total control may create the next dispatch only when
the controller state root still has an eligible unfinished task, target
evidence requires rework dispatch, or an approved unattended run remains inside
boundary. If no task remains, the correct action is to stop without another
delivery.

Creating a controller-return envelope is only the local return plan. The target
window must still use the host thread-send capability to send the envelope
prompt to the registered controller thread, read back the controller thread,
and record a delivery run. If host send or readback is unavailable, the target
records or reports a blocked / failed delivery and stops. `review-results`
must show `controllerReturnDelivery.status="sent"` before anyone treats the
return as a real callback.

Host thread send uses the prompt string as-is. When calling
`send_message_to_thread`, pass only the generated `envelope.prompt`; do not wrap
it in a manual `<codex_delegation>` / `<input>` envelope. The Codex host renders
the cross-thread card automatically, and manual wrappers are visible as raw XML
inside the target window.

Keep-live / keep-awake is enabled support for unattended automation runs. It is
not a delivery transport, not a target task, and not acceptance evidence; failure
to start or stop it is an automation readiness risk. Keep-live must not be used
as a reason to block total control from handling other concurrent tasks.

The current script contract owns local macOS keep-live through
`start-keep-live` / `stop-keep-live`. Keep-live is shared process support, not
owned by one controller: the watcher starts once, records active automation-run
leases in `keep-live/state.json`, and stops only when the final lease is
released. A run may claim keep-live only when the command reports an active
watcher. Otherwise mark keep-live as a readiness risk and continue using target
callback as the automation return path.

A `DeliveryEnvelope` alone is only a mechanical plan. Do not claim that a
delivery was sent unless `record-delivery-run` or equivalent host readback
evidence proves the direct-thread send.

`prepare-dispatch-from-state` is the default shortcut for the mechanical files
that precede host delivery. It reads machine state and task-package JSON, not
Markdown plan prose. It does not choose the target, call the host thread tool,
or record delivery success. After it runs, the next boundary is still the normal
host send + readback + `record-delivery-run` step.

A `ControllerReturnEnvelope` follows the same rule. It is `pending-host-send`
until a matching `DirectThreadDeliveryRun` has `status="sent"` and
`readback.ok=true`.

## Prompt Rules

- Prompt first line must describe the real task: `继续当前窗口任务：...` or
  `继续总控验收：...`.
- Prompt body carries only compact dynamic values and the skill pointer.
- Target dispatch prompts default to the script-generated multi-line `变量：`
  block: `currentWindow`, `taskId`, `stateRoot`, optional `dispatchGroup`, and
  `skill`. Do not hand-pack values into one long sentence.
- Controller-return prompts use `stateRoot`, `dispatchGroup`, `trigger`, optional
  non-empty exception targets, and `skill`.
- Do not surface `controllerWindow`, `returnPolicy`, `reviewScope`,
  `groupStatus`, `demandKey`, `taskPackageId`, `stateRevision`,
  `humanContextRef`, completed targets, or long `rules` text in the visible
  prompt. Those stay in the state root, dispatch group, delivery envelope, and
  controller-return envelope.
- `不创建下一跳` means no target-window next hop. It does not mean no
  controller return. The only allowed return is a controller-return envelope
  allowed by the dispatch group's `returnPolicy`.
- Command manuals, validation details, and troubleshooting belong in skills or
  the active state-root task package.
- The visible prompt lead must describe the real task, not an automation
  mechanism name.

## Result Review

`review-results` only answers whether result envelopes exist, which targets are
ready / missing / blocked, and whether the stored return policy permits
controller review. It never accepts the task.
When it returns a wait / missing state after a dispatch was already sent and
recorded, the total-control action is to stop the current turn and wait for a
future controller-return or explicit user/manual review input. It is not a
reason to start a local sleep / polling loop.

Use `review-pack` when the repeated local-file hopping itself becomes noise.
It keeps the same readiness decision, but lays out result files, evidence refs,
commits, verification summaries, target delivery status, and controller-return
status in one object. It remains a preparation aid, not a verdict.
If a result names path-like evidence refs and any of those paths are missing,
`review-pack` marks `missingEvidenceRefsPresent=true`,
`controllerReviewReady=false`, and the next action is to fix the evidence refs
before a controller verdict.
For state-root target results, path-like evidence refs may be relative to the
state root or to the control workspace root. Missing path refs still gate the
verdict until total control repairs or explains the evidence boundary.
If a state root has no target tasks, `review-pack --state-root` returns
`decision=no-target-tasks`, `groupStatus=empty`, and `controllerReviewReady=false`.

Total control must still inspect:

- commits or no-commit reason;
- relevant diffs;
- command output;
- runtime JSON / logs / report paths / screenshots where applicable;
- current TODO / Backlog impact.

## Removed Previous Protocol

The previous `claim / finish / chain-next` protocol is retired. Do not mix it
with dispatch packets in one active loop, and do not reintroduce compatibility
aliases unless a future user explicitly approves a migration bridge.
