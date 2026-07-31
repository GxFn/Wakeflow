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

For a Pod launch, journal the exact launch correlation with
`wakeflow_pod_record event=materialization`. The Claude helper returns the final
session id synchronously; it has no Codex `clientThreadId` pending state and no
temporary request id belongs in the registry.

## Registry Record Shape

Thread-registry records should contain only:

- logical window name;
- real thread id;
- opaque binding id when the window belongs to a Pod;
- registration / verification timestamps.

Do not store window role, display title, cwd, responsibility root, dispatchable
state, or delivery policy in the registry.

Pod cwd/Git facts live separately under
`hosts/claude-code/pod-bindings/<pod-id>/`, keyed by launch correlation and
binding id. Product dispatch reads that verified receipt; derived
`window-config`, `window-host`, and the logical window suffix are never a Pod
cwd authority. Pod Test dispatch also requires the matching validated
`direct-multi-root` access receipt; a binding alone does not prove Test can
read every product worktree.

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
records it with the public MCP tool `wakeflow_record_delivery` — see
[references/wakeflow-delivery.md](wakeflow-delivery.md) (Send Boundary) for the helper
command, the cross-host target work lease, fail-closed concurrent target
delivery, and recovery/relaunch.

Transport-specific: if the lock is held or the window-host binding is missing, fail
closed and return to controller judgment. Do not create a hidden schedule, heartbeat,
or fallback delivery route.

## Controller Return

Controller return uses the dispatch group's stored `controllerWindow`, not a
global default controller. Mainline has its controller; each explicitly
authorized Pod has an independent `Controller__<pod>` that is the sole
acceptance authority for that demand. The controller is itself a tmux-resident
window, so the return uses envelope-aware `deliver --delivery-file`; the controller window takes
NO target work lease (returns queue naturally in its input box, and concurrent
pastes are serialized by the controller paste mutex). The visible return
prompt follows the controller-return prompt shape in
[references/wakeflow-delivery.md](wakeflow-delivery.md) (Prompt Rules).
