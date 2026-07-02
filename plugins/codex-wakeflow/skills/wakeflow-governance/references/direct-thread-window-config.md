# Direct Thread Window Config Reference

## Purpose

Direct-thread delivery needs a local mapping from logical Wakeflow window names
to real Codex thread ids. That mapping is local runtime state, not tracked
project documentation.

## Storage

Store real thread ids only in the local thread registry under
`.wakeflow-local/wakeflow-delivery/hosts/codex/thread-registry/`. Wakeflow
setup or host-controlled tooling should pass each real thread id to one local
registration command; agents must not hand-write multiple runtime files.
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

The host thread tool performs the real send; the send/readback boundary and the
"stop the controller turn once sent and readback-ok" rule live in
[references/wakeflow-delivery.md](wakeflow-delivery.md) (Send Boundary).

Transport-specific: if the target is busy or unavailable and no host-level queued
send is supported, fail closed and return to controller judgment. Do not create a
hidden schedule, heartbeat, or fallback delivery route.

## Controller Return

Controller return uses the dispatch group's stored `controllerWindow`, not a
global default controller — routing is per-group, but the workspace runs ONE
controller (the single acceptance authority, across every active demand);
returns are thread messages that become the controller's subsequent turns. The
visible return prompt follows the controller-return prompt shape in
[references/wakeflow-delivery.md](wakeflow-delivery.md) (Prompt Rules).
