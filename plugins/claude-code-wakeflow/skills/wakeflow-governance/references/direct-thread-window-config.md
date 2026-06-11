# Direct Thread Window Config Reference

## Purpose

Direct-thread delivery needs a local mapping from logical Wakeflow window names
to real thread ids (each thread id is a Claude Code session id). That mapping is
local runtime state, not tracked project documentation.

## Storage

Store real thread ids only in the local thread registry under
`.workspace-local/wakeflow-delivery/thread-registry/`. Wakeflow setup or
host-controlled tooling should pass each real thread id to one local
registration command; agents must not hand-write multiple runtime files.

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
the compact prompt. The Claude Code host transport performs the real send. In
desktop-session mode, the controller sends the envelope prompt to the registered
target desktop session with the session message tool. In headless-resume mode,
the controller resumes the target session with
`claude -p --resume <sessionId> "<prompt>" --output-format json` as a background
task; the JSON result is the readback evidence. A resumed session can fork to a
new session_id; re-register the new id before the next send.
`workspace.config.json` may pin one transport with
`"deliveryMode": "desktop-session" | "headless-resume"`. Wakeflow then records
the send/readback result with `record-delivery-run`.

If the target is busy or unavailable and no host-level queued send is supported,
fail closed and return to controller judgment. Do not create a hidden schedule,
heartbeat, or fallback delivery route.

## Controller Return

Controller return uses the dispatch group's stored `controllerWindow`, not a
global default controller. This allows multiple controllers to run in parallel.
The visible return prompt should include only state root, dispatch group,
trigger, non-empty exceptional targets, and the controller skill.
