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
at the first run, and nothing here is a reason to prefer either. A
`reconfigure` can switch the transport when no Demand is active and no
worktree pod is open; afterwards every window is unregistered, and you
relaunch and register each one with the new transport's helper. Sessions
of the old transport that remain (tmux panes or sidebar sessions) are the
user's to close or archive; name them, do not retire them yourself.

## What the transport is

- Every logical window is one session in the desktop app's Code tab, listed
  in its sidebar under the title the launch intent carries. There is no tmux
  session, no pane and no status line; the sidebar's own markers show whether
  a session is working, has unread output or waits for its user.
- Identity is unchanged: the handle is the hook's session id, the one every
  hook record carries. The desktop id `local_<session id>` is only the
  locator, recorded as `desktop.sessionId` in the creation observation
  exactly as the helper printed it; Wakeflow never derives it from the handle.
- Liveness is the `desktop-sessions` observation you build from the desktop
  `list_sessions` tool - the sidebar's own list, called with a `limit` that
  covers every session (64, the observation's cap): one row per session it
  returns, `sessionId` its id without the `local_` prefix, `desktopSessionId`
  its `local_` id verbatim (always; a session the app created is matched only
  by it), `status` `busy` while it is running and `idle` otherwise, and its
  `archived` flag as the tool reports it. A session whose
  process ended after its turn is still in the sidebar and still present; an
  archived or deleted session is absent. Wakeflow classifies each bound window
  as present and busy, present and idle, or absent; you never judge liveness
  yourself. The helper's `sessions` is only the process view.
- Wakeflow still sends nothing. The helper does the three-step launch, prints
  its process view and waits for landing records; it never sends a prompt,
  never renames, archives or deletes a session, and never runs `claude rm`.
  Listing, sending, setting the mode, titling, grouping and archiving are
  your own calls of the desktop app's session tools, each kept exactly as it
  returned.
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
  surfaces, every product repository - is trusted. Trust is a record per
  folder in Claude Code's own project list. The user writes it by opening the
  folder in the desktop app (a new session there) or by running `claude` in a
  terminal there, and accepting the trust dialog. `claude --desktop <folder>`
  writes the same record without a dialog, so never run it on a folder the
  user has not been told about: trusting a folder is their decision. `launch`
  reports `not-trusted` for a folder without the record and names it.
- One approval per folder for the `auto` permission mode. The helper starts
  the background session in the configured mode, but the app applies the
  folder's remembered mode once it takes the session over, so you set `auto`
  again right after registration (Step 1). The app may show one approval card
  for that; the user approves it once and the folder remembers it. A session
  left on another mode stops for permission prompts and holds cross-session
  messages for approval.

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

Prints the process view: one row per session that has a live process, with
the session id, `busy` or `idle`, and the cwd, name and pid it reports, at
most 64 rows (`truncated` says when the list was longer). It is not the
liveness observation: a desktop session's process ends some time after its
turn while the session stays in the sidebar, so a session missing here may
still be present. Use it to see which sessions run right now, for example
while a launch is in progress; liveness for
`wakeflow_register_window_binding` comes from `list_sessions` ("What the
transport is").

### `landing --window <windowId> --prompt-digest <sha256:…> [--wait-landing <seconds>]`

Waits up to `--wait-landing` seconds (default 3) for a `user-prompt-submit`
record of the bound session whose prompt digest equals the one given and
prints `landed: true` with `recordId` and `recordedAt`, or `landed: false`.
It never sends. Use it after every send, and before any second send.

## Refusals and what to tell the user

| `reason` | What it means | What you do |
| --- | --- | --- |
| `not-trusted` | `claude --bg` refused because Claude Code has no trust record for the folder. | Name the folder (the refusal's `cwd`) and ask the user to open it in the desktop app (a new session there) or run `claude` in a terminal there, and accept the trust dialog; `launch` again when they say so. Never open it with `claude --desktop` yourself. |
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
   other window after it. Right after the fresh-initialize apply, the setup
   session's permission classifier may refuse the helper: the allow rules
   were written after that session started, so it never loaded them. Never
   work around a classifier refusal - no other command form, no run on the
   user's behalf. Start a new session in the workspace root (with
   `start_session` when the host offers it, otherwise ask the user to open
   one there) whose first prompt asks it to initialize Wakeflow here - on the
   existing workspace that previews reconcile and continues with step 1 - and
   continue the window launches from that session. Its `preflight` may
   report it proven, but on this transport only a session `launch` started
   is a window, so it still launches the Controller window first.
2. For each window: inspect, pipe the result into `launch --window
   <windowId>`, one call per Bash command. `launch` returns only after the
   session-start record exists, so register that window from the printed
   `observation` as soon as the call returns, before launching the next one
   or in launch order afterwards - never wait for the user between windows
   unless a refusal names them.
3. Right after each registration call the desktop
   `set_session_permission_mode` tool with the window's `desktop.sessionId`
   and `"auto"`: the app applied the folder's remembered mode when it took
   the session over. The app may show one approval card; the user approves
   it once per folder and the folder remembers it. Then, when the sidebar
   title differs from the intent's (`window.name` in the launch result), set
   it with the desktop `set_session_title` tool; the title is decoration that
   keeps the sidebar readable, never evidence. When the app asks to confirm a
   rename, that is a one-time question for the user.
4. There is no adoption on this transport. A window that a setup session
   launched but never registered keeps its observation only in that session:
   when that session is gone, ask the user to authorize archiving the stray
   session, then `launch` and register again.
5. When every window is registered, file the sessions into the program's
   sidebar group ("Pods"), show the handover card from
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
   until the user answers there (a mode other than `auto` is the usual
   cause). That is not a failed send: the message lands when they answer.
   Tell the user which window is asking.
5. `permission-mode-mismatch:<windowId>` means the landing record shows that
   window in another permission mode than `auto`. The delivery landed and the
   window works, but it will stop for permission prompts and hold
   cross-session messages for approval. The
   one-time fix is step 3 of Step 1: `set_session_permission_mode` with its
   `desktop.sessionId` and `"auto"`, the user approving the card once for
   that folder. The blocker is not stored and `wakeflow_status` does not show
   it: each outcome derives it again from the landing record it cites, so the
   next delivery to that window reports it gone or still there.

The tmux helper's `deliver`, `nudge` and `panes` do not exist here; the
`desktop-sessions` observation from `list_sessions` is the liveness lookup
when a delivery stays silent.

## The callback

A product, Design or Test window returns its wake-controller callback by
sending the callback permit's prompt to the Controller's desktop session id
with the `SendMessage` tool, once, and passes that tool's return unchanged as
`attempt.sendReturn`. The delivery prompt's return section names that id as
`- controller desktop session: local_<id>`; Wakeflow renders it, so your
three paragraphs carry no desktop id, and you never derive one from a hook
session id. The hook record still decides landing: a callback sent elsewhere
never lands in the Controller session.

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
  sidebar; `list_sessions` then reports it archived, which Wakeflow
  classifies as absent. Never archive a pod's window while the pod is open,
  and never run `claude rm` on any Wakeflow session - it deletes checkouts
  the app believes it owns.
- **Replace** a session that is absent (archived or deleted): with the user's
  authorization pipe the window's inspect result into `launch` again,
  register the printed observation with `operation: "replace"` and the
  `expectedBindingId` / `expectedBindingDigest` the inspect returned, then set
  its permission mode and title as in Step 1. A **decommission** records the
  `desktop-sessions` observation built from `list_sessions` before and after
  the archive as its `preClose` and `postClose` evidence;
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
- The pod's sessions are titled with the pod-prefixed display names the
  intents carry. Once a pod's windows are registered, file their sessions
  into one sidebar group with the desktop `create_group` and `move_sessions`
  tools: `<program>` for the primary pod, `<program> · <pod>` for a worktree
  pod (the program's display name and the pod name). A group is a projection
  for the user's eye: losing or renaming it changes no Wakeflow state, and
  after a reconcile you recreate a missing group the same way.
- Bring the pod up in the order `references/workspace-and-windows.md` gives
  (Controller and Design, then every product window with its worktree
  observation, then Test). Product windows may be launched one after another
  without waiting for the user; each `launch` waits for its own record.
- Closing the pod retires its windows by `archive_session` - only after the
  Demand is archived and the branch dispositions are recorded - and then
  removes the checkouts with the `git worktree remove` command the status
  suggests, as the pods section of `references/workspace-and-windows.md` says.

## After a plugin update

`runtime-artifact-outdated` means this session's Wakeflow server predates
the installed plugin, and an outdated server refuses writes. On this
transport the desktop app reloads the MCP server on its own within a few
turns: tell the user in one sentence that the update is being picked up,
and check `wakeflow_status` on your next turns until it shows the runtime
artifact current. Then call `wakeflow_verify`, and preview and apply
reconcile for the gates it names (`host-settings-assets`, the helper's own
bytes). If the server has not reloaded after a few turns, ask the user to
archive and unarchive this Controller session, then message it: that message
restarts its process on the current artifact (a session whose process already
ended restarts the same way on its next message, with no archive). Nothing is
relocated.

Peer windows that started under the older plugin show `runtime: stale`, and
`wakeflow_verify` reports them as `windows-refresh-pending:<n>` on a passing
gate: the app ends an idle session's process after about half an hour, and the
session's next message then starts it on the current artifact. Restart none of
them and send none a message to clear the state; status lists no action for
them. Before a delivery to such a window, run `sessions`: when its process is
still listed, tell the user and, with their authorization, archive and
unarchive that session so the delivery starts a fresh process.

## What this transport does not have

No status line and no window-list marks (`statuslineAsset` is empty under
this transport; `hostAssets` lists only `desktop.mjs`); no `resume`,
`self`, `mark`, `panes`, `deliver`, `nudge`, `close` or `teardown`
subcommands and no `relocate` - the desktop app's session tools and the
sidebar take their place; no adoption of a session another process started;
no in-place restart after a plugin update. These are differences of
environment, not of rank: the tmux transport has what tmux offers, this one
has what the desktop app offers, and both are maintained together.
