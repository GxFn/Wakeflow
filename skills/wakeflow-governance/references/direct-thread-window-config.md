# Direct Thread Window Config Reference

## Purpose

Direct-thread delivery needs a local mapping from logical Wakeflow window names
to real Codex thread ids. That mapping is local runtime state, not tracked
project documentation.

## Storage

Store real thread ids only under `.workspace-local/`, for example in the local
thread registry written by Wakeflow setup or host-controlled tooling.

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

## Window Record Shape

Records should describe:

- logical window name;
- repository path;
- role;
- whether it may receive delivery;
- delivery role, such as controller, target, Design, or Test;
- local thread id reference stored in ignored runtime state;
- last validation/readback evidence when available.

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
