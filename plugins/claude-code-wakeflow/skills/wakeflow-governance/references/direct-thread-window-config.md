# Direct Thread Window Config Reference

## Purpose

Direct-thread delivery needs a local mapping from logical Wakeflow window names
to real thread ids (each thread id is a Claude Code session id). That mapping is
local runtime state, not tracked project documentation.

## Storage

Store real thread ids only in the host-scoped local thread registry under
`.workspace-local/wakeflow-delivery/hosts/claude-code/thread-registry/` (the
Codex plugin keeps its twin under
`.workspace-local/wakeflow-delivery/hosts/codex/thread-registry/`). Wakeflow
setup or host-controlled tooling should pass each real thread id to one local
registration command; agents must not hand-write multiple runtime files. A
thread id is the window's Claude Code session id, generated at launch and
stable across resumes; it is registered once.

The host helper `launch-window` also stores a window-host binding at
`.workspace-local/wakeflow-delivery/hosts/claude-code/window-host/<window>.json`
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
the compact prompt. The agent performs the real send with the host helper:
write the prompt to a temp file, then run
`node <plugin>/scripts/lib/wakeflow-claude-host.mjs send --root <workspace>
--window <target> --prompt-file <file> [--delivery-id <id>]`. The helper
enforces the shared per-window delivery lock
(`.workspace-local/wakeflow-delivery/locks/<window>.json`, one in-flight
delivery per window across both hosts), pastes the prompt into the target's
tmux pane via a tmux buffer (multiline-safe), and returns pane readback
evidence (`readback.paneTail`). Wakeflow then records the send/readback result
with `record-delivery-run`. If the target window is mid-turn, the pasted
message queues in its input and is processed next turn.

If the lock is held or the window-host binding is missing, fail closed and
return to controller judgment. Do not create a hidden schedule, heartbeat, or
fallback delivery route. Recovery is not a mode: a dead window's session is
finished or recovered by interactive relaunch (`launch-window --resume`; headless `claude -p` bills the separate Agent SDK credit from 2026-06-15) with `claude --resume <registered session
id>`, then relaunched with `launch-window --replace --session-id <same id>`.

## Controller Return

Controller return uses the dispatch group's stored `controllerWindow`, not a
global default controller. This allows multiple controllers to run in parallel.
The controller is itself a tmux-resident window, so the return uses the same
helper `send` (and the controller window's shared delivery lock). The visible
return prompt should include only state root, dispatch group, trigger,
non-empty exceptional targets, and the controller skill.
