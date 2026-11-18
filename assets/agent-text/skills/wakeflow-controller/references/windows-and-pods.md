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

Before the first launch: {{windowBootstrap}}

Permissions are explicit: Wakeflow pre-approves only its own tools, per role, and its helper -
at the roots it writes and on every window it launches - never a shell-wide rule or a
parent-directory grant. Do not launch into a root that `legacyResidue` lists with `broad-permission`
or `additional-directories` until the user has deleted those entries or chosen to keep them.

Launching and registering:

1. Take the window id from the maintenance or pod result, then call
   `wakeflow_register_window_binding` with `inspect` for its current launch
   intent and execution instructions. Its role root is the assigned work
   location; the host instructions separately determine the chat's startup root.
2. Launch it by host means: {{windowLaunch}}
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
Restart the stale windows with the host's procedure: {{windowResume}} Afterwards
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
3. Create each worktree by host means: {{worktreeLaunch}} Then launch that
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
