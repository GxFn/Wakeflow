# Desktop sessions: the steps on this transport

Read this on Claude Code when the workspace's `hosts.claude-code.windowTransport`
is `desktop` and you are at step 1, at the host effect of step 8, handling the
callback, closing a window, working with a pod or refreshing after a plugin
update. What the transport is, its prerequisites, the helper's subcommands and
its refusals are in `references/desktop-transport.md`; everything that does
not depend on the transport stays in `references/windows-and-pods.md` and
`references/planning-and-delivery.md`, and the boundaries are in `SKILL.md`.

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
   `observationFile` as soon as the call returns, before launching the next one
   or in launch order afterwards - never wait for the user between windows
   unless a refusal names them. `not-trusted` does not stop the round: launch
   the remaining windows first, then name every distinct `trustRoot` to the
   user in one question - say that Claude Code will load that folder's own
   settings and hooks once it is trusted - and after their yes run
   `trust --window <windowId> --user-agreed` once per `trustRoot` and
   `launch` the refused windows again.
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
`--allowedTools` for its role's Wakeflow tools and the helper itself, and outside the Controller
with the managed-path deny rules (those do not outlive step 3's takeover - the app restarts the session with its own arguments; from then on the plugin's `PreToolUse` hook refuses the edit tools on those paths once the window is bound, and shell commands are not checked); the
settings rules maintenance writes are unchanged, and a product repository's `.claude/settings.json` is never written.

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
   Never reconstruct the prompt from the conversation. Every backslash in
   the file is a literal character and must arrive as one.
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
   <windowId> --prompt-ref <the permit's promptRef>` - with
   `--wait-landing <seconds>` after a `queued` send - and then record the
   outcome: the window may finish and try to import within a minute, and its
   import is refused until the outcome is recorded. It reads the record
   Wakeflow reads: `landed: true` means the outcome will be accepted;
   `match: "identity"` (evidence kind `hook-record-identity`) adds that the
   host altered the text on the way - tell the user which delivery, send
   nothing again: the window works from the task package. `landed: false`
   means indeterminate, resolved exactly as `references/planning-and-delivery.md`
   says - wait, run `landing` again later, and resolve only on evidence (a
   `recordId` is the `hookRecordId` a resolution cites). A `latestPrompt`
   beside it is that session's newest prompt, under another digest and
   without the permit id: when its `recordedAt` is your send, the text
   arrived cut short or mangled - never send it again, resolve on that
   record. No screen readback here: the outcome carries no `readback`.
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
   that folder. The entry reads that window's last record, so it can be stale: when the host's reply shows the session already in `auto`, change nothing - its next record clears the entry. When the host refuses the call, do not retry or work around it: ask the user to switch that session to auto themselves. `wakeflow_status` shows the same fact without a delivery: the
   window's `session.permissionMode` and a `permission-mode-mismatch` entry in
   `nextActions`, both gone once a later record reports the launch mode.

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
  that window. Under the `auto` permission mode the host may still refuse that call (and `unarchive_session`) after the user agreed in the conversation: do not retry or look for another way - ask the user to archive (and, for a restart, restore) that session in the sidebar themselves, then go on from the observation. Archiving stops the process and removes the session from the
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
  after a reconcile you recreate a missing group the same way. When the app
  or this session's permission classifier refuses a grouping call, do not
  retry it another way: leave the sessions ungrouped and tell the user.
- Bring the pod up in the order `references/windows-and-pods.md` gives
  (Controller and Design, then every product window with its worktree
  observation, then Test). Product windows may be launched one after another
  without waiting for the user; each `launch` waits for its own record.
- Closing the pod retires its windows by `archive_session` - only after the
  Demand is archived and the branch dispositions are recorded - and then
  removes the checkouts with the `git worktree remove` command the status
  suggests, as the pods section of `references/windows-and-pods.md` says.

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
