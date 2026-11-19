# Windows and pods

Read this when you are launching or retiring a window (step 1), refreshing windows after a
plugin update, or creating or closing a pod (step 13). It is Controller depth;
the immediate goal, the reading order and the boundaries are in `SKILL.md`.
On Claude Code the window transport decides the host steps: the steps below
name both, and `references/desktop-transport.md` details desktop sessions;
their steps are in `references/desktop-flow.md`.

## Step 1 - Windows and bindings

A logical window is a role plus a root: `controller`, `design`, `test`, and one
`product` window per repository. Its identity is the typed id in the config; the
display name is decoration and never says which window something belongs to. A
binding maps that logical window to the host handle you observed after launching
it; bindings live in the private local runtime, never in a public result.

Before the first launch: run the published helper's `preflight` - `node .wakeflow-local/runtime/hosts/claude-code/operations/assets/tmux.mjs preflight` under the tmux transport, `node .wakeflow-local/runtime/hosts/claude-code/operations/assets/desktop.mjs preflight` under desktop sessions - and read its result. Under the tmux transport read `sessionProven` and `insideTmux`. `sessionProven: true` means this session's own session-start record exists: it is the tmux Controller window, so register it with `self` (pipe your own window's inspect result in). `sessionProven: false` or `null` means this session started before the workspace's hooks existed - every first run, inside tmux or not: it only bootstraps and must never register itself or mark its pane. `launch` the Controller window's own intent so a fresh Controller starts inside the configured tmux session, launch every other window with `--wait 0` (its result says `hook.sessionStart: pending` only because it did not wait; the record usually lands within seconds), give the user the exact command the helper printed - `attach` when they are outside tmux, `switch` when this session already runs inside it - and register each window from the observation you kept, in launch order, without waiting for the user. A registration refused `hook-evidence-missing` means that window has not started: it is still showing its trust dialog (a directory the user has not trusted yet, or a repository with its own settings) or is still starting. A trusted directory shows no dialog, so never send the user to look for one: name the windows that are waiting, ask them to accept the dialog where one is shown (`Ctrl-b n` moves to the next window) and to keep this session open until you have registered the windows, and register those windows again when they say so; then run `mark --all` once every window is registered, show the handover card from `references/first-run.md`, and tell the user to continue in the tmux Controller and close this session with `/exit`. A window that a setup session started but never registered (it was closed too early) is still running: `launch` it as below and the helper adopts it instead of opening a second one (`adopted: true`); register that observation as usual. If adoption is refused (`adopt-unproven`, `window-ambiguous`, `window-present-not-claude`), never open a second window and never `teardown` from inside tmux: tell the user which window it is and what the refusal's `hint` asks of them - exit `claude` there with `/exit` (in all but one of the windows, for `window-ambiguous`), or close a window that runs something else with `Ctrl-b &` and then `y` - and `launch` again once they have. An unproven window that still shows its trust dialog only needs that dialog accepted. The user never sets tmux up by hand: you do it and tell them the one thing to run or press. If a bootstrap has to be redone before any window was registered, `teardown` kills that tmux session; with registered windows it refuses unless `--force`. Under desktop sessions `preflight` reports `desktop.appRunning` (when false, ask the user to start the Claude desktop app, sign in with their subscription and say when it is up, then run it again; `launch` refuses `desktop-unavailable` until then), `script.available` (the pseudo-terminal wrapper; `script-unavailable` otherwise) and the same `sessionProven`: a setup session running in the app is unproven and likewise never the Controller. Right after the fresh-initialize apply its permission classifier may refuse the helper, because the allow rules were written after it started: never try to work around a classifier refusal - start a new session in the workspace root (with `start_session` when the host offers it, otherwise ask the user to open one) that initializes Wakeflow there and continues the window launches. `launch` the Controller window's intent first, then every other window, one helper call each: `launch` waits for the session-start record itself and each session appears in the app's sidebar when it returns, so register each window from the observation you kept as soon as its call returns, then set its permission mode with the desktop `set_session_permission_mode` tool to `"auto"` (the user approves the card once per folder) and its title with the desktop `set_session_title` tool. `not-trusted` means Claude Code has no trust record for that window's `trustRoot` - the workspace root, whose record covers the surfaces inside it, or a product repository; opening a folder in the desktop app does not always write it, so the root can be among them. Do not stop there: launch the remaining windows, then name every distinct `trustRoot` to the user in one question and say that Claude Code will load that folder's own settings and hooks once it is trusted. After their yes run `trust --window <windowId> --user-agreed` once per `trustRoot` - it opens that folder in the desktop app, which records the trust - and `launch` the refused windows again; a user who would rather do it themselves opens each folder in the desktop app (a new session there) or runs `claude` in a terminal there and accepts the trust dialog. Never pass `--user-agreed` without their word. There is no adoption on this transport: a window that was launched but never registered is archived with the user's authorization and launched again. When every window is registered, file the sessions into one sidebar group named after the program with the desktop `create_group` and `move_sessions` tools, show the handover card from `references/first-run.md` and tell the user to continue in the Controller session in the sidebar and to archive this one. The three-step launch, the other subcommands and the refusal codes are in `references/desktop-transport.md`.

Permissions are explicit: Wakeflow pre-approves only its own tools, per role, and its helper -
at the roots it writes and on every window it launches - never a shell-wide rule or a
parent-directory grant. Do not launch into a root that `legacyResidue` lists with `broad-permission`
or `additional-directories` until the user has deleted those entries or chosen to keep them.

Launching and registering:

1. Take the window id from the maintenance or pod result, then call
   `wakeflow_register_window_binding` with `inspect` for its current launch
   intent and execution instructions. Its role root is the assigned work
   location; the host instructions separately determine the chat's startup root.
2. Launch it by host means: pipe the intent (the `launchIntent` that `wakeflow_register_window_binding` inspect returns, or the maintenance result's entry for that window) into the published helper's `launch`, run from the workspace root: `node .wakeflow-local/runtime/hosts/claude-code/operations/assets/tmux.mjs launch --window <windowId>` under the tmux transport, `node .wakeflow-local/runtime/hosts/claude-code/operations/assets/desktop.mjs launch --window <windowId>` under desktop sessions. The workspace's transport is `hosts.claude-code.windowTransport` (`tmux` unless the config says `desktop`); maintenance publishes only that transport's helper and `wakeflow_status` lists it under `hostAssets`. Make every helper call its own Bash command with literal arguments - no shell loop, variable or chain of helper calls: only such a plain call matches the helper's allow rule, and anything else stops at a permission prompt the user has to answer. Either helper starts `claude` with the intent's parameters, waits for the session-start hook record of the session it started and prints the creation observation with `observationFile`, a reference to it: pass that object as the registration's `observation` instead of copying the observation out (a helper result's `closureFile` and a liveness `observationFile` go the same way into `closure` and `evidence.liveness`). The window starts with `--allowedTools` for its role's Wakeflow tools and the helper, in the permission mode from step 0. A Design, Test or product window also starts with deny rules (`--disallowedTools`) for edits to the paths Wakeflow manages - `.wakeflow-local`, `.wakeflow-active`, `wakeflow.config.json`, the root's two Claude settings files and the ledger - and the result's `writeDeny` counts them: `unexpressed` above 0 means that many of those paths got no rule (the path has characters a rule cannot spell, or the config names no ledger root), so tell the user. The rules stop the host's edit tools and the file commands it recognizes, not every process, and under desktop sessions they do not outlive the takeover into the app (the desktop helper's result says `afterTakeover: "not-carried"`). On both transports the plugin's own `PreToolUse` hook also refuses the edit tools (`Edit`, `Write`, `NotebookEdit`) on those paths once the session is bound as a Design, Test or product window; it does not read shell commands and lets a call through whenever it cannot tell (an unbound session, an unreadable config): never tell the user a window cannot write there. The workspace root's `.claude/settings.json` carries those two rules, Design and Test carry only their role's tools, and a product repository's `.claude/settings.json` is never written, so a trust dialog for a Wakeflow-written root lists only those rules. Entries it lists beyond them - `Bash(git *)`, `Bash(node *)`, `Bash(tmux *)`, a `..` directory - are 0.9.x residue (`broad-permission`, `additional-directories`) or the repository's own settings: accepting activates them, so the user deletes or confirms them before you launch, never you. Under the tmux transport the helper opens the window in the tmux session the intent names and generates the session id itself. After each registration run `mark --window <windowId>` so the tmux window carries the five Wakeflow options; `panes` prints the tmux-panes observation and `close --window <windowId>` the closure evidence a decommission needs. When a registered window's pane is gone but its session should continue (tmux restarted, pane closed by mistake), pipe the inspect result into `resume --window <windowId>`: it starts `claude --resume` with the bound session in a new pane and prints the observation for the binding tool's `relocate`, which keeps the binding and records the new pane; then `mark` again. `launch` and `resume` refuse while the located pane is still alive (`locator-live`; a live window on an older plugin is restarted with `resume --in-place`, as the plugin-update steps say), and report `resume-exited` / `launch-exited` when `claude` quit before its SessionStart hook: a session that never held a conversation cannot be resumed, so launch a fresh window instead. Both wait up to `--wait <seconds>` (default 20, at most 120) for that hook record; `hook.sessionStart: pending` with a live pane leaves startup unproven: inspect hook execution, keep the observation, register or relocate with it once the record exists, and pass a longer `--wait` next time. Under desktop sessions the helper starts the session in the background with `claude --bg` (the host assigns the session id; the intent carries no `--session-id`), lets its first turn finish, stops it and reopens it in the desktop app's Code tab with `claude --desktop --resume`, waits for that session's session-start record and prints the observation with `desktop.sessionId` (`local_` plus the session id) for registration; it waits `--wait <seconds>` (default 120) for the first turn and `--wait-session-start <seconds>` (default 30) for the record, refuses `locator-live` while the window's recorded session is still in the sidebar and `not-trusted` for a folder without Claude Code's trust record (the refusal's `trustRoot` is the folder that needs it: collect the distinct ones, ask the user once, and with their agreement run `trust --window <windowId> --user-agreed` once per `trustRoot` and `launch` the refused windows again; a user who declines opens that folder in the desktop app or runs `claude` there and accepts the trust dialog). After each registration set the session's permission mode with the desktop `set_session_permission_mode` tool to `"auto"` (the app reapplies the folder's remembered mode when it takes the session over; the user approves its card once per folder) and its title with the desktop `set_session_title` tool; liveness is the desktop-sessions observation built from the desktop `list_sessions` tool, the helper's `sessions` is only the process view; a session is resumed by sending it a message, so relocate does not apply, and it is closed with the desktop `archive_session` tool only on the user's authorization - never with `claude rm`. The steps for that transport are in `references/desktop-flow.md`; the refusal codes and what to tell the user are in `references/desktop-transport.md`. A helper refusal this text does not explain - an unfamiliar `reason`, or `reason: unexpected` with an `errorName` - is relayed to the user verbatim with its `hint`, `detail` and `causeCode`; then stop: do not retry it, do not edit files, do not read the helper's source.
3. Observe the handle the host reports for the window you just started.
4. Call `wakeflow_register_window_binding` to register it. Registration needs
   a real `session-start` hook record for that session at the startup root the
   host instructions require; project membership is a separate host
   observation, a hook record does not prove sidebar placement. A refusal for
   want of that record means the window did not start, started elsewhere, or
   the host's hook channel is not trusted yet - check the README's install
   steps before you retry.
5. Replaying the same registration is idempotent and returns the first result:
   the safe response to an ambiguous launch.

Other actions on the same tool:

- **inspect** recomputes the launch intent and reports the binding, the work
  claim and the locator state. This is how you answer "is this window really
  bound" without touching anything.
- **replace** binds a new handle against the old binding. A stale digest is
  refused; re-inspect and replace against what is current.
- **relocate** keeps the binding and records where a resumed session now
  lives: same handle, new host coordinates, same CAS on the binding. It is the
  record for a window whose process died while its session should go on (the
  launch step says whether and how this host brings one back); a held work
  claim does not block it. Use replace only when the session itself is gone.
- **decommission** retires a window with its pre-close, close-result and
  post-close evidence. Use it when a window is genuinely gone, not to silence
  an inconvenient state. On Claude Code the tmux helper's `close` kills
  nothing when the pane no longer carries its Wakeflow marks (after a tmux
  server restart, say) and reports `closeResult: unknown`; decommission then
  goes to the manual host gate. Under desktop sessions the close is the
  user-authorized `archive_session` (`references/desktop-flow.md`).
- **release-claim** force-releases an expired or orphaned work claim. Use it
  only when you have established that the holding window is gone. A live claim
  is protecting someone's work.

Wakeflow never opens, inspects or closes a window. Every one of those actions
is yours, and the binding tool only records what you observed.

## Hook history

Hook records are private facts. New records use UTC-day and digest-prefix
partitions; older flat records stay readable in place and status aggregates
every observed record. `observation-query-incomplete` means an incomplete
query, never that a delivery did not land; `observation-query-unavailable`,
directory races and unreadable partitions mean unavailable, not an empty
channel. Unknown entries stay visible as skipped; a damaged shard can need
manual diagnosis. Retirement is best effort in bounded batches, never drops
records to fit a count limit, and keeps the 30-day age boundary.

## After a plugin update

`runtime` describes the MCP server serving this call. A changed manifest at
its own path produces `server-outdated` / `runtime-artifact-outdated`; a missing
manifest produces `manifest-unavailable` / `runtime-artifact-unavailable`.
Inspect the installation and reload this server before it performs maintenance.
The owner named in `next` comes from the host profile: `controller` where this
Controller can restart its own window in place through the host procedure
below, `user` where only an application restart reloads the server.
These checks do not identify the host-selected sibling installation.

The serving MCP rejects mutations while its own manifest has changed or is
unavailable; reads and previews remain available.

A session may keep the tool definitions it loaded before the update, in this
window and in any peer window, and loading a tool again may not replace
them; a fresh or compacted session holds the new ones. The server checks the
current contract, so go by the skill and references you read again: a refusal
naming a member you sent (`additional:<member>`) or a member your definition
lacks is this mismatch, not a fault in the workspace.

A window's `lastObservation.observerManifestDigest` identifies the hook observer
only. SessionStart can occur on resume or compaction; Stop also does not prove
that the window's MCP or instructions reloaded. Each bound window's `runtime`
therefore carries one of three states. `stale` means its latest `session-start`
record was written by an observer older than the installed artifact: that
session started under the previous plugin and has not restarted since. Where you
restart windows, strict verification counts these as `windows-stale:<n>`, fails the
`runtime-artifact` gate and names `window-artifact-stale` in `next`. Status `nextActions` routes
each stale window, so do not probe them: `stale-window-resume` (its session holds a prompt record:
restart it in place) or `stale-window-relaunch` (it never conversed: close, launch, `replace`, `mark`).
Where the host restarts a session on its next turn they are `windows-refresh-pending:<n>` on a passing gate.
`unverified` means the host adapter has no such evidence either way (Codex
sessions, or a session-start record without an observer digest); verification
reports `window-runtime-unverified:<n>` as information on a passing gate, never
as a failure. Keep that limitation explicit: do not fabricate records, rebind,
or repeatedly restart windows to clear it, and do not treat `unverified` as a
blanket prerequisite for unrelated actions.

A window's `attention` says whether the host is waiting for the user there:
`needed` when the bound session's latest hook record is a Claude Code
`Notification` other than an idle prompt (`notificationType` names the cause),
`none` once a later record superseded it, `null` without a binding or any
record. Tell the user which window needs them; their action there clears it, no
tool does. On Claude Code the hooks also mark a bound window's name in the
window list where the host has one: green `+` working, red `?` waiting for
you, nothing when idle (`mark` sets that format): a hint, never evidence; a
desktop session shows only the app's own markers.

A registered window's `launchIntent` says whether it still runs with the launch
parameters recorded at its handshake: `current`, or `drifted` with `changes`
naming each value that differs (an empty list: its root, pod, title or the host
profile moved; `comparison: "config"` is an older binding compared by the whole
config digest). `session` shows the model and permission mode the host reported.
Only a replacing handshake renews the record; no gate fails on it, never rebind for it.

Order: this server first, then the published host assets, then the peer windows. Once this server is current and verify fails `host-settings-assets` (status then lists `workspace-maintenance` ahead of the stale windows), preview and apply reconcile before you restart or launch any peer: where a published helper starts the windows, a window started by the previous artifact's helper lacks what the current one adds at launch, such as the write-deny rules - restart such a window once more after the reconcile.
Restart the stale windows with the host's procedure: under the tmux transport, if this serving MCP is outdated, first tell the user in one sentence that this window will restart in place in a few seconds and carry on by itself, then pipe your own inspect result into `node .wakeflow-local/runtime/hosts/claude-code/operations/assets/tmux.mjs resume --window <this windowId> --in-place` and end your turn. It returns at once (`self: true`, `scheduled: true`); about two seconds later this session restarts with the updated plugin and a fresh Wakeflow server - no `/mcp` reconnect is needed - and resumes by itself with a prompt to load this skill again (the copy in your context predates the update), call `wakeflow_verify` and continue where you left off. A helper installed before in-place restarts existed refuses `--in-place` as `argument-unknown`: then ask the user to run `/mcp` in this window and reconnect `wakeflow`, run a reconcile as in step 0, which installs the current helper, and start this section again. If this server is already current, skip its restart. For peer windows that verify reports as `stale` (`windows-stale:<n>`: each such session started under an older artifact), `wakeflow_status` lists one action per window: take the `stale-window-resume` ones one at a time, each only while it sits idle at an empty prompt, and pipe each one's inspect result into `resume --window <windowId> --in-place`, one helper call per Bash command. The session restarts inside its own pane on the updated plugin; the binding, coordinates and marks stay, so there is nothing to relocate or mark, and `hook.sessionStart: pending` means startup is unproven; inspect hook execution. `window-busy` means that window is working, shows a dialog or menu, or holds typed input, and `--force` does not override it: go on with the next window and retry this one once its turn has ended - a dialog, a menu or typed input waits for the user, so tell them which window it is. `resume-exited` means the process exited before startup evidence; read the refusal's `hint` and that pane before retrying. `panes-unavailable`, `pane-missing` or `pane-dead` means that window is not running at all - tmux was restarted or the pane was closed - so there is nothing to restart in place: bring it back yourself with `resume --window <windowId>` without `--in-place`, register the printed observation with `relocate` and `mark` it, as for any window whose pane is gone; it starts on the updated plugin. A `stale-window-relaunch` window (its session never conversed, so `resume` would refuse with `resume-never-conversed`) is not probed or resumed: close the old one, launch it again, register it with `replace` and `mark` it - four calls, one helper call per Bash command, each printed result kept verbatim: `close --window <windowId>` (the binding stays; this is not a decommission), `launch --window <windowId> --wait 60` with that window's current inspect result piped in, `wakeflow_register_window_binding` with `operation: "replace"`, the printed `observation` and the `expectedBindingId` / `expectedBindingDigest` the inspect returned, then `mark --window <windowId>`; never reconstruct those calls from your own session transcript or from the plugin's source. Under desktop sessions nothing restarts in place: an outdated server refuses writes (`runtime-artifact-outdated`), and the desktop app reloads the MCP server on its own within a few turns, so tell the user in one sentence that the update is being picked up, check `wakeflow_status` on your next turns until it shows the runtime artifact current, then call `wakeflow_verify` and preview and apply reconcile; if it has not reloaded after a few turns, ask the user to archive and unarchive this Controller session and message it: the message restarts its process on the current artifact. Peer windows reported `stale` are `windows-refresh-pending` on a passing gate there: the app ends an idle session's process and its next message starts it on the current artifact, so restart none and send none a message for it; a session is resumed by sending it a message, so nothing is relocated. A session that is gone (`absent` in the desktop-sessions observation: archived or deleted) is replaced, not resumed: with the user's authorization pipe its inspect result into `launch` again, register the printed observation with `replace` and set its permission mode and title; relocate does not apply on this transport. Afterwards
preview and apply reconcile for repairable workspace gates that remain. A peer's `unverified` state remains
separate from those repairs and from Controller acceptance of returned work.

## Pods

A pod is the only execution-environment abstraction: a complete window set
(controller, design, test, one product window per repository) plus one
execution location per repository. The main pod is `primary` and sits in the
main checkout; every other pod works in a worktree.

`wakeflow_pod` create:

1. Preview to derive the plan; it writes nothing. Its `advisories` name each repository whose root `package.json` reaches outside the repository by relative path (`relative-path-dependency`, with the dependency names): tell the user before applying.
2. Apply with exactly what preview returned. One config transaction registers
   the pod, its window set, and one worktree intent per repository.
3. Create each worktree by host means: a worktree pod's windows open as their own set: under the tmux transport in a tmux session named `<configured session>-<pod name>` (the launch intents carry it as `execution.tmux.sessionName`; the first `launch` into that session creates it and prints the `attach` command to give the user, and retiring the pod's last window removes the session), under desktop sessions as further sessions in the app's sidebar, titled with the display name the intent carries. The helper's `launch` prepares the worktree from a `local-head` worktree intent before it starts the product window: it creates `<repository>/.claude/worktrees/<name>` from the repository's local HEAD on branch `worktree-<name>`, reuses the checkout only when this repository's worktree list has it, and adds `.claude/worktrees/` to the repository's `.git/info/exclude`; its result says `worktreePrepared: created` or `reused`. Under the tmux transport the window then starts with `claude --worktree <name>`, which only locks that existing checkout; under desktop sessions it starts with the checkout as its working directory and never with `--worktree` - the app would claim such a checkout as its own worktree, and archiving the session or `claude rm` would delete it. The helper refuses without writing when the placement is not the repository top level (`worktree-root-not-toplevel`), when `worktree-<name>` exists without its checkout (`worktree-branch-exists`: ask the user whether to delete or rename it) or when another directory holds the path (`worktree-path-occupied`). A launch that fails after the checkout was prepared still reports `worktreePrepared` and `worktreeBranch`, so tell the user that checkout was left behind. Once the session has started, `launch` compares its hook-recorded working directory with the prepared checkout and refuses `worktree-cwd-mismatch` when the session is not working in it; have the user close that window, then launch again. Do not start such a window with a bare `claude --worktree`: without an existing checkout Claude Code creates it from the remote default branch, not from the local HEAD. Then launch that
   pod's windows using their host launch instructions and register each binding as in
   step 1. A product window in a pod is refused registration until its worktree
   is actually there and observed, and a checkout another live pod already
   holds is refused as `worktree-occupied`. Bring the pod up in this order:
   its Controller and Design windows, then every product window with its
   worktree observation, and only then its Test window - the Test window's
   launch intent lists the worktrees as attached directories, and that list is
   read from the receipts the product registrations wrote. A repository that
   depends on a sibling checkout by relative path (`file:../Name`) cannot
   resolve it inside a worktree, so its own install and tests may not run there; say so in that pod's task packages. The product windows
   need not start one by one: launch them all without waiting (`--wait 0` on
   the Claude Code tmux helper; the desktop helper returns once the session
   has started), keep each printed observation, and register them once their
   session-start records exist. A tmux launch that printed `worktreeObservation: "pending"` did not wait for the worktree record, and registering that observation is refused `worktree-receipt-required`: once the session is up, run the same `launch` again - it starts nothing, adopts the running window (`adopted: true`) and prints the complete observation to register.
4. If receipts and config disagree after an interruption, reconcile with
   recover before doing anything else.

While a pod is open, its Controller claims its own package from the shared
board; one Demand per Controller still holds. Between archiving a pod's Demand
and closing the pod, `wakeflow_status` lists the branches its accepted results
left unmerged (`source: archived`).

`wakeflow_pod` close, after the user has merged or abandoned the branch:

1. The pod's Demand must already be archived.
2. Record the branch dispositions. This is the phase that says what happened to
   the work - do not record "merged" for a branch you have not seen merged.
3. Retire the pod's windows, then remove its checkouts with the
   `git worktree remove` command the status suggests. A host may lock a
   checkout while its session runs; once that window is retired the lock is
   stale, so `git worktree unlock` it first, then remove and
   `git worktree prune`. Wakeflow never removes a checkout itself. What stays
   behind is the user's to tidy: the pod branch (`worktree-<name>`), on Claude
   Code a `.claude/worktrees/` line in each repository's `.git/info/exclude`,
   and an empty `.claude/worktrees/` directory. Suggest `git branch -d <branch>`
   for a merged branch, ask before `git branch -D` for an abandoned one, and
   say that the same pod name is refused (`worktree-branch-exists`) while that
   branch still exists.
4. Remove the pod. Closing in this order is what keeps the config and the
   worktrees from disagreeing.

## Reading the workspace

`wakeflow_status` is one observation across every domain: overall state, board
counts, active Demands with route and frontier, windows with identity, claims
and projection freshness, pods with their execution location, repository
pointer facts, hook channels, active projection freshness and the next actions.
Pass a Demand to attach its route, or its archive receipt once finished. Treat
`next actions` as the answer to "what now": it is derived from state; your
memory of the conversation is not.

`wakeflow_verify` is the strict read: each gate passes, fails or is unavailable,
and unavailable is counted apart from failure so "we could not check" is never
"it is fine". It repairs nothing. Run it before completing a Demand, when status
looks self-contradictory, and when a delivery looked sent but no evidence came -
the hook channel gate is the usual cause; the README names the host actions.

Projections are deterministic rewrites. A projection file edited by hand is no
longer overwritten but reported: not a failure to repair, the edit respected. A
window's runtime projection that is missing or stale is different - verify
names the window in its `window-runtime-projection` gate and reconcile rebuilds
it; only an unreadable one stays reported.

`hostAssets` lists the files Wakeflow published per host (on Claude Code the
window helper of the workspace's transport, `tmux.mjs` or `desktop.mjs`, and
under tmux the status line) and whether their bytes are still the artifact's.
A helper that is `drift`, `missing` or `mode` is not yours to run:
`wakeflow_prepare_delivery` refuses with `host-asset-<status>` until a
reconcile republishes it - never repair it by hand, and tell the user something rewrote the file unless the plugin was just updated (then the drift is the update).
`settings: custom` is the user's own status line.

`legacyResidue` lists what the old JavaScript plugin left behind in the
workspace root, the present repository roots and the support-surface roots:
`scope-block` (an old instruction block the product windows still read),
`broad-permission` and `additional-directories` (settings entries that let a
window run shell commands or edit the parent directory without a prompt),
`root-marker` and `ledger-directory`. They are user-owned files: report each
one with its root, path and line and let the user delete them; Wakeflow never
edits a product repository. `unreadable` counts files it could not check,
which is not an absence. A fresh initialization refuses while the workspace
root itself carries one (`fresh-legacy-residue-present`).
