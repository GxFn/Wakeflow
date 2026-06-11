# Direct Thread Window Config Reference

## Purpose

Direct-thread delivery needs a local mapping from logical Wakeflow window names
to real Codex thread ids. That mapping is local runtime state, not tracked
project documentation.

## Storage

Store real thread ids only in the local thread registry under
`.workspace-local/wakeflow-delivery/hosts/codex/thread-registry/`. Wakeflow
setup or host-controlled tooling should pass each real thread id to one local
registration command; agents must not hand-write multiple runtime files.
Records in the legacy `.workspace-local/wakeflow-delivery/thread-registry/`
location are still read as a fallback while new registrations write the
host-scoped path, and the shared `.workspace-local/wakeflow-delivery/locks/`
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
`workspace.config.json`, current launch / replacement inputs, and whether a
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
the compact prompt. The host thread tool performs the real send. Wakeflow then
records the send/readback result with `record-delivery-run`.

If the target is busy or unavailable and no host-level queued send is supported,
fail closed and return to controller judgment. Do not create a hidden schedule,
heartbeat, or fallback delivery route.

## Controller Return

Controller return uses the dispatch group's stored `controllerWindow`, not a
global default controller. This allows multiple controllers to run in parallel.
The visible return prompt should include only state root, dispatch group,
trigger, non-empty exceptional targets, and the controller skill.
