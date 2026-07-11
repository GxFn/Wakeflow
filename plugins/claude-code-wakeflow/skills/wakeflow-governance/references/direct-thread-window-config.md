# Direct Thread Window Config Reference

## Purpose

Direct-thread delivery needs a local mapping from logical Wakeflow window names
to real thread ids (each thread id is a Claude Code session id). That mapping is
local runtime state, not tracked project documentation.

## Storage

Store real thread ids only in the host-scoped local thread registry under
`.wakeflow-local/wakeflow-delivery/hosts/claude-code/thread-registry/` (the
Codex plugin keeps its twin under
`.wakeflow-local/wakeflow-delivery/hosts/codex/thread-registry/`). Wakeflow
setup or host-controlled tooling should pass each real thread id to one local
`wakeflow_register_window` call; agents must not hand-write runtime files. The
tool updates the host-local registry and derived window config together and
redacts the real id from its output. A
thread id is the window's Claude Code session id, generated at launch and
stable across resumes; it is registered once.

The host helper `launch-window` also stores a window-host binding at
`.wakeflow-local/wakeflow-delivery/hosts/claude-code/window-host/<window>.json`
(the tmux window mapping for that Wakeflow window). The binding is host
transport runtime only; it is not a thread-id authority and not a second
window-semantics store.

Never write real thread ids to:

- tracked Markdown;
- prompts;
- GitHub;
- target result text;
- archive records;
- examples;
- fixtures.

Do not register placeholders such as `current-thread`, `unknown`, or
`<thread-id>`.

## Registry Record Shape

Thread-registry records should contain only:

- logical window name;
- real thread id;
- registration / verification timestamps.

Do not store window role, display title, cwd, responsibility root, dispatchable
state, or delivery policy in the registry.

## Derived Window Config

`window-config` files are derived runtime views. They are rebuilt from
`wakeflow.config.json`, current launch / replacement inputs, and whether a
thread-registry record exists. They may describe:

- repository path and responsibility;
- delivery role, such as controller, target, Design, or Test;
- whether the window may receive delivery;
- a local registry-file reference;
- delivery/readback requirements.

They must not contain real thread ids and must not become a second authority for
window semantics.

## Send Policy

The delivery envelope stores `targetWindow`, `stateRoot`, `dispatchGroup`, and
the compact prompt. The agent performs the real send with the tmux host helper and
records it with `record-delivery-run` — see
[references/wakeflow-delivery.md](wakeflow-delivery.md) (Send Boundary) for the helper
command, the shared per-window lock, mid-turn queueing, and recovery/relaunch.

Transport-specific: if the lock is held or the window-host binding is missing, fail
closed and return to controller judgment. Do not create a hidden schedule, heartbeat,
or fallback delivery route.

## Controller Return

Controller return uses the dispatch group's stored `controllerWindow`, not a
global default controller — routing is per-group, but the workspace runs ONE
controller (the single acceptance authority, across every active demand). The
controller is itself a tmux-resident window, so the return uses the same helper
`send`; the controller window takes NO delivery lock (returns queue naturally
in its input box, and concurrent pastes are serialized by the controller paste
mutex). The visible return prompt follows the controller-return prompt shape in
[references/wakeflow-delivery.md](wakeflow-delivery.md) (Prompt Rules).
