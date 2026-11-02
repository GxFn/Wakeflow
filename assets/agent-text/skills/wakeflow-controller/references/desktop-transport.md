# Desktop sessions: the window transport in the Claude desktop app

Read this on Claude Code when the workspace's `hosts.claude-code.windowTransport`
is `desktop`: `wakeflow_status` then lists `desktop.mjs` under `hostAssets`
and the launch intents `wakeflow_register_window_binding` returns carry
`execution.kind: claude-code-desktop`. It is Controller depth for one
transport - step 1, the host effect of step 8, the callback, closing a
window, pods and the refresh after a plugin update. Everything that does not
depend on the transport stays in `references/workspace-and-windows.md`, and
the boundaries are in `SKILL.md`. A workspace on the tmux transport never
reads this file: the two transports are equals, one is chosen per workspace
at the first run, and nothing here is a reason to prefer either.

## What the transport is

- Every logical window is one session in the desktop app's Code tab, listed
  in its sidebar under the title the launch intent carries. There is no tmux
  session, no pane and no status line; the sidebar's own markers show whether
  a session is working, has unread output or waits for its user.
- Identity is unchanged: the handle is the hook's session id, the one every
  hook record carries. The desktop id `local_<session id>` is only the
  locator, recorded as `desktop.sessionId` in the creation observation
  exactly as the helper printed it; Wakeflow never derives it from the handle.
- Liveness is the `desktop-sessions` observation the helper's `sessions`
  prints - the host's own session list. Wakeflow classifies each bound window
  as present and busy, present and idle, or absent; you never judge liveness
  from the sidebar yourself.
- Wakeflow still sends nothing. The helper does the three-step launch, prints
  the session list and waits for landing records; it never sends a prompt,
  never renames, archives or deletes a session, and never runs `claude rm`.
  Sending, titling and archiving are your own calls of the desktop app's
  session tools, each kept exactly as it returned.
- Landing is proven the same way as everywhere: by the target session's
  `user-prompt-submit` hook record whose prompt digest equals the permit's.
  The app's messaging hands the hook the raw prompt, so no unwrapping is
  needed and the rule in `references/delivery-and-review.md` is unchanged.

## One-time prerequisites (the user's)

The helper and the app can do nothing about these; tell the user which one is
missing, in one sentence, and wait for their word:

- The Claude desktop app is running and signed in with a Claude subscription
  (`claude --desktop` refuses an API-key login). `preflight` and `launch`
  report `desktop-unavailable` otherwise.
- The pseudo-terminal wrapper `script` is on the `PATH` the helper runs with;
  `claude --desktop` refuses redirected output without it
  (`script-unavailable`).
- Each folder a window starts in - the workspace root, the Design and Test
  surfaces, every product repository - has been opened once in Claude Code
  and had its trust dialog accepted. `launch` reports `not-trusted` for a
  folder that has not; the app remembers trust per folder.
- The `auto` permission mode has been picked once in each of those folders.
  The helper starts the background session in the configured mode, but the
  app applies the folder's remembered mode once it takes the session over, so
  a folder left on another mode makes that window stop for permission
  prompts and hold cross-session messages for approval. Tell the user which
  window is asking; their choice in that folder clears it, no tool does.

## The helper and its four subcommands

The helper is `desktop.mjs`, published by maintenance under
`.wakeflow-local/runtime/hosts/claude-code/operations/assets/` with an allow
rule exact to its path. Run it from the workspace root as
`node .wakeflow-local/runtime/hosts/claude-code/operations/assets/desktop.mjs
<subcommand>`; from a product or surface window, prefix the path with the
workspace root you were given with `--add-dir`. Every call is its own Bash
command with literal arguments and prints exactly one line of JSON.

### `preflight`

Reports `node` (path, version, whether it is in the supported range),
`claude` (version and install form), `script.available`,
`desktop.appRunning` with `processTable` (`available` or `unavailable`), and
`sessionProven` - whether this session's own session-start record exists.
A setup session is never proven and only bootstraps.

### `launch --window <windowId> [--wait <seconds>] [--wait-session-start <seconds>] [--force]`

Stdin is the inspect result (or its `launchIntent`). The helper checks the
intent (its `execution.kind` must be `claude-code-desktop`; `--session-id`,
`--worktree`, `--bg`, `--resume`, `--name` and `--allowedTools` must not be
in its arguments - the helper adds what it needs), refuses `locator-live`
while the window's recorded desktop session is still in the sidebar (`--force`
opens a second one anyway; archive or use the live one instead), and then
takes three steps in the intent's root:

1. `claude --bg "<startup prompt>" --name "<title>" <intent arguments>
   --allowedTools <the role's Wakeflow rules and this helper>`. The startup
   prompt is fixed: it names the role, the window id and title, says the
   working directory is the execution root, and asks the session to load
   nothing and reply only `ok`; the first real prompt is yours, sent later.
   The host assigns the session id, which the helper reads back from the
   `--bg` output and the session list. It polls that list until the first turn is `done`, up to
   `--wait` seconds (default 120).
2. `claude stop <id>` - a session that is still running cannot be reopened.
3. `claude --desktop --resume <id>` inside a pseudo-terminal, which opens the
   session in the desktop app's Code tab. The helper then waits up to
   `--wait-session-start` seconds (default 30) for a new session-start record
   of that session.

The result carries `observation` (the creation observation to register
verbatim: `handle`, `desktop.sessionId`, and for a worktree pod's product
window the git worktree facts), `created: launched`,
`hook: { sessionStart: "observed" }`, `window` (title and cwd relative to the
workspace root), `background` (the short id, the first turn's state, whether
the stop succeeded) and `worktreePrepared`. A refusal after the checkout was
prepared still carries `worktreePrepared` and `worktreeBranch`.

### `sessions`

Prints the `desktop-sessions` liveness observation: one row per session the
desktop app lists, with the session id, `busy` or `idle`, and the cwd, name
and pid it reports, at most 64 rows (`truncated` says when the list was
longer). Hand it to `wakeflow_register_window_binding` as the liveness
observation where the tool asks for one; `kind: unobserved` means the session
list was unavailable, not that every session is gone.

### `landing --window <windowId> --prompt-digest <sha256:…> [--wait-landing <seconds>]`

Waits up to `--wait-landing` seconds (default 3) for a `user-prompt-submit`
record of the bound session whose prompt digest equals the one given and
prints `landed: true` with `recordId` and `recordedAt`, or `landed: false`.
It never sends. Use it after every send, and before any second send.

## Refusals and what to tell the user

| `reason` | What it means | What you do |
| --- | --- | --- |
| `not-trusted` | `claude --bg` refused because the folder is not trusted. | Name the folder (the refusal's `cwd`); ask the user to open it in Claude Code once and accept its trust dialog, then `launch` again. |
| `desktop-unavailable` | The app is not running or not signed in (`stage` says whether at preflight or at the reopen step; the stopped background session keeps its conversation). | Ask the user to start the desktop app and sign in; `launch` again when they say it is up. |
| `script-unavailable` | The pseudo-terminal wrapper `script` is not on the `PATH`. | Tell the user; it is part of macOS, so the `PATH` the host launches with is what to fix. |
| `launch-first-turn-timeout` | The first turn did not finish within `--wait`; the helper stopped the background session. | `launch` again, with a longer `--wait` when the machine is slow. |
| `launch-first-turn-failed` | The first turn ended in a failed state (`state` names it, such as `failed` or `stopped`). | Tell the user which window and state; `launch` again only once the cause is clear. |
| `desktop-resume-refused` | The reopen step did not report `Opening session`: the session was still running or never conversed. | Relay the `detail`; `launch` again. Never try `--resume` yourself. |
| `desktop-session-start-missing` | The app opened the session but no new session-start record arrived in `--wait-session-start`. The refusal carries the handle and `desktop.sessionId`. | Check the sidebar and the `host-hook-channel` gate; if the session is there and the hook channel is healthy, `launch` again with a longer `--wait-session-start`. |
| `locator-live` | The window's recorded desktop session is still in the sidebar. | Send to it or, with the user's authorization, archive it first; `--force` only when the user wants a second session on purpose. |
| `worktree-cwd-mismatch` | The pod window did not start in the prepared checkout. | With the user's authorization archive that session, then `launch` again. |
| `intent-invalid` | The piped intent is not a usable desktop launch intent; `field` names the part (`execution` for another `execution.kind`, `arguments` with the forbidden `argument`, `cwd`, `role`, `worktree`). | Pipe the current inspect result for that window again; a tmux intent here means the workspace's transport is not `desktop` - read `hostAssets` before going on. |
| `prompt-position` | The helper's own check that the startup prompt precedes every variadic argument failed. | Relay it verbatim; it is a helper defect, not something to work around. |
| `worktree-*` and the other codes shared with the tmux helper | Same meaning as in `references/workspace-and-windows.md`. | Same action. |

`wakeflow_register_window_binding` refuses on its own side too:
`desktop-session-required` when a register or replace observation lacks
`desktop.sessionId` (register the helper's `observation` verbatim, never a
hand-built one), `locator-kind-mismatch` when it carries tmux coordinates in
a desktop workspace, and `relocate-not-applicable` for `relocate`.

A refusal this table does not explain - an unfamiliar `reason`, or
`reason: unexpected` with an `errorName` - is relayed to the user verbatim
with its `hint`, `detail` and `causeCode`; then stop: do not retry it, do not
edit files, do not read the helper's source.

## Step 1 on this transport

1. Run `preflight` and read it back. A first-run setup session - whether it
   runs in the desktop app or in a terminal - is never proven and never
   becomes the Controller; it launches the Controller window first and every
   other window after it.
2. For each window: inspect, pipe the result into `launch --window
   <windowId>`, one call per Bash command. `launch` returns only after the
   session-start record exists, so register that window from the printed
   `observation` as soon as the call returns, before launching the next one
   or in launch order afterwards - never wait for the user between windows
   unless a refusal names them.
3. After each registration set the session's title with the desktop
   `set_session_title` tool to the title in the intent (`window.name` in the
   launch result); the title is decoration that keeps the sidebar readable,
   never evidence. When the app asks to confirm a rename, that is a one-time
   question for the user.
4. There is no adoption on this transport. A window that a setup session
   launched but never registered keeps its observation only in that session:
   when that session is gone, ask the user to authorize archiving the stray
   session, then `launch` and register again.
5. When every window is registered, show the handover card from
   `references/first-run.md` and tell the user to continue in the Controller
   session in the sidebar and to archive this setup session.

Permissions are the same as under tmux: the helper starts every session with
`--allowedTools` for its role's Wakeflow tools and the helper itself; the
settings rules maintenance writes are unchanged, and a product repository's
`.claude/settings.json` is never written.

## Step 8 - delivering on this transport

1. Read the prompt from the permit's `promptRef` file and send it, once, with
   the desktop `send_message` tool to the target window's desktop id - the
   `desktop.sessionId` its `launch` printed (`local_` and its session id).
   Inspect never shows it (Wakeflow projects a locator only as present or
   absent); when that output is no longer in your context, find the session
   by its title with the desktop `list_sessions` tool. A send to the wrong
   session cannot land: landing is the bound session's record. Pass the text
   exactly as the file holds it: Wakeflow wrote it when it issued the permit,
   and the landing record's digest has to equal the permit's `promptDigest`.
   Never reconstruct the prompt from the conversation.
2. Keep what the tool returned and record it as
   `attempt: { status: "sent", sendReturn: <the return, unchanged> }` when
   you call `wakeflow_record_delivery_outcome`; Wakeflow stores only the
   digest of its canonical form. `delivered` means the session took the
   message at once; `queued` means the session was busy and takes it when its
   turn ends; a return that says the message was not sent is
   `status: "failed-before-send"` with that return - record it so, then
   re-arm with `wakeflow_rearm_delivery`. Your send return is your own report
   (`host-send-return`), never host evidence.
3. Right after the send returns, before any other step, run `landing --window
   <windowId> --prompt-digest <the permit's promptDigest>` - with
   `--wait-landing <seconds>` after a `queued` send - and then record the
   outcome: the window may finish and try to import within a minute, and its
   import is refused until the outcome is recorded. It reads the record
   Wakeflow reads: `landed: true` with its `recordId` means the outcome will
   be accepted; `landed: false` means it will be indeterminate, resolved
   exactly as `references/delivery-and-review.md` says - wait for the
   record, run `landing` again later, and resolve only on evidence (the
   `recordId` is the `hookRecordId` an accepted resolution cites). There is
   no screen readback on this transport, so the outcome carries no
   `readback`.
4. A session that shows a permission prompt or a dialog holds the message
   until the user answers there (the mode mismatch under "One-time
   prerequisites" is the usual cause). That is not a failed send: the message
   lands when they answer. Tell the user which window is asking.

The tmux helper's `deliver`, `nudge` and `panes` do not exist here; `sessions`
is the liveness lookup when a delivery stays silent.

## The callback

A product, Design or Test window returns its wake-controller callback by
sending the callback permit's prompt to the Controller's desktop session id
with the `SendMessage` tool, once, and passes that tool's return unchanged as
`attempt.sendReturn`. Neither the delivery prompt nor the callback permit
carries a desktop id - the permit's host action names the Controller window
and its title - so you supply it: read your own desktop id once per session
with the desktop `get_session` tool (`self`), never derive it from your hook
session id, and name it in the boundary paragraph of every delivery you
prepare as the session the callback goes to. The hook record still decides
landing: a callback sent elsewhere never lands in the Controller session.

A callback to a busy Controller is queued and opens a new turn when the
current one ends; to an idle Controller it starts the turn at once. That is
why the Controller needs no polling on this transport. Landing is still the
callback's `user-prompt-submit` record in the Controller session.

## Marking, closing and replacing a window

- **Mark** is `set_session_title` with the window's intent title, after
  registration and whenever the title drifted; nothing else is marked. The
  hooks' `attention` on `wakeflow_status` still says when a window waits for
  the user; the sidebar shows the app's own marker for it.
- **Resume** needs no step: sending a message to a desktop session resumes
  it. `relocate` does not apply on this transport - a session is never moved
  into another process - and `wakeflow_register_window_binding` refuses it.
- **Close** is `archive_session`, only when the user authorizes retiring
  that window. Archiving stops the process and removes the session from the
  sidebar; `sessions` then reports it absent. Never archive a pod's window
  while the pod is open, and never run `claude rm` on any Wakeflow session -
  it deletes checkouts the app believes it owns.
- **Replace** a session that is absent (archived or deleted): with the user's
  authorization pipe the window's inspect result into `launch` again,
  register the printed observation with `operation: "replace"` and the
  `expectedBindingId` / `expectedBindingDigest` the inspect returned, then set
  its title. A **decommission** records the `observation` of `sessions`
  before and after the archive as its `preClose` and `postClose` evidence;
  `closeResult.status` is `closed` when the archive tool reported success,
  `failed` when it refused, and `unknown` when you cannot tell.

## Pods

- A worktree pod's checkout is prepared by the helper's `launch` from the
  `local-head` worktree intent, exactly as under tmux
  (`<repository>/.claude/worktrees/<name>`, branch `worktree-<name>`, the
  exclude line), and the product session starts with that checkout as its
  working directory. It never starts with `--worktree`: the app would claim
  such a checkout as its own worktree, and archiving the session or
  `claude rm` would delete it.
- The pod's sessions sit in the sidebar beside the primary pod's, titled with
  the pod-prefixed display names the intents carry; Wakeflow groups nothing
  in the sidebar in this version.
- Bring the pod up in the order `references/workspace-and-windows.md` gives
  (Controller and Design, then every product window with its worktree
  observation, then Test). Product windows may be launched one after another
  without waiting for the user; each `launch` waits for its own record.
- Closing the pod retires its windows by `archive_session` - only after the
  Demand is archived and the branch dispositions are recorded - and then
  removes the checkouts with the `git worktree remove` command the status
  suggests, as the pods section of `references/workspace-and-windows.md` says.

## After a plugin update

`runtime-artifact-outdated` names `user` as the owner on this transport: only
reopening the desktop app reloads the plugin for its sessions. Tell the user
in one sentence that the update takes effect when they quit and reopen the
Claude desktop app, that every session - this one included - comes back on
the updated plugin with a fresh Wakeflow server, and that nothing needs
relocating because a session resumes when it is next messaged; then end your
turn. After the restart call `wakeflow_verify`, then preview and apply
reconcile for the gates it names (`host-settings-assets`, the helper's own
bytes). Peer windows reported `stale` clear the same way; a window that stays
`stale` after the restart has not conversed since - send it nothing to clear
a state; `wakeflow_status` names the next action.

## What this transport does not have

No status line and no window-list marks (`statuslineAsset` is empty under
this transport; `hostAssets` lists only `desktop.mjs`); no `resume`,
`self`, `mark`, `panes`, `deliver`, `nudge`, `close` or `teardown`
subcommands and no `relocate` - the desktop app's session tools and the
sidebar take their place; no adoption of a session another process started;
no in-place restart after a plugin update. These are differences of
environment, not of rank: the tmux transport has what tmux offers, this one
has what the desktop app offers, and both are maintained together.
