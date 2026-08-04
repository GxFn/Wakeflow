# Direct Thread Window Config Reference

## Purpose

Direct-thread delivery needs a local mapping from logical Wakeflow window names
to real Codex thread ids. That mapping is local runtime state, not tracked
project documentation.

## Storage

Store real thread ids only in the local thread registry under
`.wakeflow-local/wakeflow-delivery/hosts/codex/thread-registry/`. Wakeflow
setup or host-controlled tooling should make one bounded entry-sync observation
without automatic resend, then pass each real thread id and its explicit
`entrySyncStatus` (`ready`, `pending`, or `failed`) to
`wakeflow_register_window`; agents must not hand-write runtime files. Only a
visible expected reply is `ready`, and only ready registrations are
dispatchable. A later manual recovery reuses the same handle and promotes its
status with another explicit registration. The
tool updates the host-local registry and derived window config together and
redacts the real id from its output.
Records in the legacy `.wakeflow-local/wakeflow-delivery/thread-registry/`
location are still read as a fallback while new registrations write the
host-scoped path, and the shared `.wakeflow-local/wakeflow-delivery/locks/`
directory enforces one in-flight target delivery per window across hosts.
Controller returns do not take that target work lease.

Version-3 records remain dispatch-compatible during migration, but runtime
health reports them as `legacy-assumed-ready` attention rather than explicit
entry-sync proof. Observe the existing destination once and re-register the
same handle as `ready`; do not resend automatically or replace the handle.

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

For a Pod launch, call `wakeflow_pod_record event=materialization` immediately
before the one Codex create call. If Codex returns `clientThreadId`, record it
as pending (the runtime persists only its digest), then call bounded
`list_threads(limit=50)` and match the exact launch-correlation marker in
`preview`. A host-supported `query` may narrow the list but is never required.
Zero or multiple matches cannot finalize. Never register that temporary id or
issue a blind second create; register only the uniquely matched final
`threadId`.

## Registry Record Shape

New records separate `threadRegistered` from `threadReady`. They store
`entrySyncStatus`, `entrySyncCheckedAt`, and set `lastVerifiedAt` only for
`ready`. Version-3 records without this field remain readable as
`legacy-assumed-ready`; newly created records never infer readiness.

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

The host thread tool performs the real send; the accepted-transport/readback
boundary and the "stop the controller turn once accepted transport plus the
actual independent readback status are recorded" rule live in
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
