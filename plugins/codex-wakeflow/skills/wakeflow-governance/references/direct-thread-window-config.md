# Direct Thread Window Config Reference

## Purpose

Direct-thread delivery needs a local mapping from logical Wakeflow window names
to real Codex thread ids. That mapping is local runtime state, not tracked
project documentation.

## Storage

Store real thread ids only in the local thread registry under
`.wakeflow-local/wakeflow-delivery/hosts/codex/thread-registry/`. Wakeflow
setup or host-controlled tooling should pass each real thread id to one local
`wakeflow_register_window` call; agents must not hand-write runtime files. The
tool updates the host-local registry and derived window config together and
redacts the real id from its output.
Records in the legacy `.wakeflow-local/wakeflow-delivery/thread-registry/`
location are still read as a fallback while new registrations write the
host-scoped path, and the shared `.wakeflow-local/wakeflow-delivery/locks/`
directory enforces one in-flight delivery per window across hosts.

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

For a Pod launch, call `wakeflow_pod_record_materialization` immediately
before the one Codex create call. If Codex returns `clientThreadId`, record it
as pending (the runtime persists only its digest), then call bounded
`list_threads(limit=50)` and match the exact launch-correlation marker in
`preview`. A host-supported `query` may narrow the list but is never required.
Zero or multiple matches cannot finalize. Never register that temporary id or
issue a blind second create; register only the uniquely matched final
`threadId`.

## Registry Record Shape

Thread-registry records should contain only:

- logical window name;
- real thread id;
- opaque binding id when the window belongs to a Pod;
- registration / verification timestamps.

Do not store window role, display title, cwd, responsibility root, dispatchable
state, or delivery policy in the registry.

Pod cwd/Git facts live separately under
`hosts/codex/pod-bindings/<pod-id>/`, keyed by launch correlation and binding
id. Product dispatch reads that verified receipt; derived `window-config` and
the logical window suffix are never a Pod cwd authority. Pod Test dispatch
also requires the matching validated `direct-multi-root` access receipt; a
binding alone does not prove Test can read every product worktree.

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

The host thread tool performs the real send; the send/readback boundary and the
"stop the controller turn once sent and readback-ok" rule live in
[references/wakeflow-delivery.md](wakeflow-delivery.md) (Send Boundary).

Transport-specific: if the target is busy or unavailable and no host-level queued
send is supported, fail closed and return to controller judgment. Do not create a
hidden schedule, heartbeat, or fallback delivery route.

## Controller Return

Controller return uses the dispatch group's stored `controllerWindow`, not a
global default controller. Mainline has its controller; each explicitly
authorized Pod has an independent `Controller__<pod>` that is the sole
acceptance authority for that demand. Returns are thread messages that become
that controller's subsequent turns. The visible return prompt follows the
controller-return prompt shape in
[references/wakeflow-delivery.md](wakeflow-delivery.md) (Prompt Rules).
