---
name: wakeflow-target
description: Use when a target Codex window receives a Wakeflow Delivery Loop direct-thread delivery, executes only its assigned dispatch packet, reports a TargetResultEnvelope, or enforces target-window boundaries without claim / finish / chain-next state.
---

# Wakeflow Target

Use this skill only inside a target-window automation wakeup. Workspace
`AGENTS.md`, the dispatch packet's `stateRoot` / human context document, and
the target repository `AGENTS.md` remain higher authority.

## Prompt Shape

Target wakeups should be task-first and compact:

```text
继续当前窗口任务：<currentWindow> / <taskId>。

变量：
- currentWindow: <window>
- taskId: <taskId>
- stateRoot: <path>
- dispatchGroup: <group>
- skill: skills/wakeflow-target/SKILL.md
```

Do not require the prompt to repeat command manuals. Derive commands from the
visible variables, this skill, and the local dispatch/delivery envelope. Do not
expect `controllerWindow`, `returnPolicy`, `taskPackageId`, `stateRevision`,
`humanContextRef`, or a long `rules` line in the prompt; those belong to the
state root, dispatch group, and delivery envelope. If the variables conflict
with the target repository, state root, or human context document, stop and
report instead of guessing.

## Target Flow

1. **Consume delivery**
   - Direct thread delivery is the only supported target wakeup contract.
     Treat it as prompt delivery, not as task completion evidence.
   - If no real thread id or host thread-send capability is available, stop and
     report the delivery block to total control instead of creating another
     transport route.

2. **Orient**
   - Read workspace `AGENTS.md`, workspace index/status, the dispatch packet's
     `stateRoot` `wakeflow-state.json` / `developer-progress.md`, this
     skill, and the target repository `AGENTS.md`. If a custom
     `humanContextRef` exists, read it from the delivery envelope rather than
     requiring it in the prompt.
   - State current window identity and repository responsibility.
   - If the target repository access card lists multiple window aliases for
     one physical repository, route strictly by `currentWindow` from the
     prompt / delivery envelope / current plan. Do not treat shared `AGENTS.md`
     as permission to execute a sibling window's task.
   - Do not use legacy `claim` to discover work. The dispatch packet / prompt
     is the assigned work boundary.

3. **Execute**
   - Do only the assigned task inside this window / repository boundary.
   - You may use Codex sub agents inside this same repository boundary for
     large task packages, but this window owns final review and evidence.
   - Do not handle another window's work, `Test` / configured test-window work, total-control
     acceptance, or next-wave planning.

4. **Report result envelope**
   - For state-root delivery, record the target result as machine data without
     changing controller state:

```text
node scripts/wakeflow-state.mjs import-target-result --state-root <stateRoot> --target-window <currentWindow> --target-task-id <taskId> --status completed --result-id <resultId> --evidence-ref <file-or-log> --verification "<command and result>" --risk "<risk>" --write --json
```

   - From the Wakeflow runtime root, also record the dispatch-group transport
     result when the delivery needs controller return:

```text
node scripts/wakeflow-delivery.mjs submit-result --target-window <currentWindow> --task-id <taskId> --group <dispatchGroup> --status completed --changed-repo <repo> --commit <hash> --evidence-ref <file-or-log> --verification "<command and result>" --risk "<risk>" --write --json
```

   - Use `--status blocked` for a real blocker and include `--risk` /
     `--next-suggestion` where the command supports it.
   - Use `--status needs-review` when work is partial or the total-control
     boundary needs a decision.

5. **Return to controller when ready**
   - Do not create another target-window hop.
   - If the delivery return route is `controller`, run:

```text
node scripts/wakeflow-delivery.mjs review-results --group <dispatchGroup> --json
```

   - Read `returnPolicy.mode`, `groupStatus`, `readyResults`,
     `missingResults`, `blockedResults`, and `groupSnapshot`.
   - For `returnPolicy.mode=group-ready`, build controller-return only when the
     group has all expected target results (`groupStatus=ready` or `blocked`).
     If the group is still `waiting` or `partially-ready`, stop; another target
     has not reported yet.
   - For `returnPolicy.mode=per-target`, build controller-return when this
     target's own result is present. The return prompt must still include the
     remaining / missing group snapshot so total control does not confuse a
     single result with whole-group completion.
   - If policy allows return, build one controller-return envelope. Do not
     choose the controller ad hoc; `build-controller-return` defaults to the
     dispatch group's stored `controllerWindow`, so automation started by
     controller A returns to controller A.

```text
node scripts/wakeflow-delivery.mjs build-controller-return --group <dispatchGroup> --trigger-target <currentWindow> --trigger-task-id <taskId> --return-reason result-ready --require-thread --write --json
```

   - Building the envelope is not a controller return. The return is complete
     only after the target window performs the direct-thread host send to the
     registered controller thread, confirms readback, and records the delivery
     run:

```text
node scripts/wakeflow-delivery.mjs record-delivery-run --delivery-file <controllerReturnFile> --status sent --host-method send_message_to_thread --host-mode new-turn --readback-ok true --evidence "<host send/readback evidence>" --write --json
```

   - Use the Codex host thread tool such as `send_message_to_thread` for the
     actual send. If the tool is not visible, search for the thread tool first;
     if no host thread-send capability is available, record or report a
     `blocked` / `failed` delivery instead of claiming the return happened.
   - Target result text, tracked docs, and prompts must not contain raw thread
     ids. Raw ids may be read only from ignored local runtime when passing the
     value to the host send tool.
   - This is the allowed total-control return, not a next target hop.
   - After the controller-return delivery run is recorded as sent/readback-ok,
     stop the target turn. Do not poll the controller thread or create another
     delivery to check whether total control has reviewed it.

## Boundaries

- A `TargetResultEnvelope` is a report, not acceptance.
- Target windows do not create target-window next-hop deliveries by default.
  Controller return is allowed only through `build-controller-return`, and only
  according to the dispatch group's stored `controllerWindow` and
  `returnPolicy`.
- A `ControllerReturnEnvelope` file is only a pending delivery. It is not a
  real callback until a matching `DirectThreadDeliveryRun` has status `sent`
  and `readback.ok=true`.
- Controller return only wakes total control for review. It does not authorize a
  next dispatch. If total control finds no eligible next task, it stops without
  creating another delivery.
- `Test` / configured test-window work is total-control-owned unless the state root and delivery
  envelope explicitly authorize an exception.
- If the target is an IDE / Plugin test window such as `AlembicTest-IDE`, it
  may handle assigned Codex Plugin, host MCP, local environment, installed /
  packaged runtime smoke, and IDE / direct-thread readback tests. It must not
  run BiliDili or AlembicWorkspace AI cold-start / rescan work.
- If the target is the real scenario test window such as `AlembicTest`, it may
  handle assigned BiliDili / AlembicWorkspace cold-start, rescan, AI/provider,
  Dashboard, runtime monitoring, and real project regression work. It must not
  handle Codex Plugin / host-environment smoke.
- Codex MCP reload is not a test-window repair route. Test windows may collect
  fresh MCP probe evidence only if assigned by the state root; they must not
  run AlembicPlugin reload with `--stop-mcp` / watch
  `--restart-mcp` to repair the current Codex host MCP session.
- Raw thread ids stay only in local runtime files, never in tracked docs,
  prompts, GitHub, or result text. Thread ids exposed for local direct-send
  execution must not be copied into result envelopes.
- `claim / finish / chain-next` commands are not part of this flow.
