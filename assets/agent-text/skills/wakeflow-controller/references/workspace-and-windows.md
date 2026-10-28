# Workspace, windows and pods

Read this when you are initializing, reconfiguring or detaching the workspace
(step 0), launching or retiring a window (step 1), refreshing windows after a
plugin update, or creating or closing a pod (step 13). It is Controller depth;
the immediate goal, the reading order and the boundaries are in `SKILL.md`.

## What the workspace is

A Wakeflow workspace is a controller directory that must not be a product
repository root. It holds the config, the active state, the local runtime and
the managed block inside `{{instructionFile}}`; the ledger is the durable record
root, the Design and Test surfaces are where drafts and harnesses live, and
the product repositories are only pointed at. A repository or externally owned
surface whose config entry says `instructionManagement: managed-block` also
carries a Wakeflow managed block in its own `{{instructionFile}}`; reconcile
maintains that block and refuses to overwrite one edited by hand.

Config authority is total: `wakeflow.config.json` belongs to Wakeflow as a whole
file. Never hand-edit it or trust a remembered value; read it back through a tool.

## Step 0 - Maintenance

`wakeflow_maintain_workspace` runs one transaction in one of five intents:

- **fresh-initialize** - a new workspace in an empty or non-workspace
  directory that is itself a Git repository (when it is not, run `git init`
  there yourself once the user agrees; the preview reports
  `gitignore-git-repository` until it is). The `selection` you send has six
  parts: `program` (identity and display), `presentation` (language),
  `topology` (repositories with their `instructionManagement`, support
  surfaces, windows), `storage` (ledger root), `governance`, `hosts` (launch
  preferences by host); its exact shape, `hosts` included, is the tool's input
  schema in your tool list, so build the request from that schema and never
  from plugin files on disk or another workspace's config. A refusal names
  the failing path and the rule in
  `details.schema` (`required:storage`, `additional:foo`, `type:string`,
  `enum`): fix that field and preview again. Default repositories to
  `owner-managed`; offer `managed-block` only when the user wants Wakeflow's
  bounded block in the repository's instruction file, and tell them a
  committed block is seen by every clone. `fresh-legacy-residue-present` means
  the scan found 0.9.x leftovers; the codes `fresh-legacy-residue-<kind>`
  say which (`scope-block`, `broad-permission`, `additional-directories`,
  `root-marker`, `ledger-directory`). Residue is cleaned by the user, never by
  you; a sibling `../wakeflow-ledger` directory that is another workspace's live ledger
  (it carries `archives/`, `requirements/`, `transactions/`) is not residue and
  is not reported.
- **reconfigure** - a declared difference against an existing config. Layout
  identity is immutable: the program id and the ledger root cannot move, the
  support surfaces cannot change, and a change to the pod set is not a
  reconfigure. Those refusals are structural, not advisory - route the user to
  the right operation instead of retrying. What does change here: the display
  name, description and language, the host launch preferences under `hosts` -
  the model and reasoning effort by role, Claude Code's permission mode, and
  the tmux container names - which the next launch intents pick up without
  touching any window, and one kind of layout change: adding a product
  repository. Send the current config with the new repository entry and one
  new `product` window for it in the primary pod appended, each with a fresh
  id (`repository_` or `window_` followed by a new lowercase UUID v4). The
  repository's root must already exist and be its own Git repository: a
  linked worktree of another repository is refused as
  `reconfigure-repository-root-worktree`, a path that is, contains or sits
  inside an already configured repository (a symlink alias included) as
  `reconfigure-repository-root-duplicate`, and more than one new window for
  it as `reconfigure-window-addition-unsupported`. The apply writes the
  config, the new window's runtime projection and the managed blocks in one
  transaction; then launch and register the new window as in step 1. Changing
  an existing repository or window is refused, and removing one is not a
  reconfigure either - that is the detach intent below. Adding a repository
  while a worktree pod is open is refused too, because that pod would lack
  it: an `invalid-request` error with reason `desired-config`,
  `details.configReason: topology` and a path into the pod's entry - tell the
  user to close the pod first rather than rewriting the config.
- **reconcile** - bring a workspace back to what its descriptor implies. On a
  healthy workspace it is a no-op that writes nothing, so it is safe to run
  when unsure. It repairs only what Wakeflow owns: a missing active layout or
  board, missing ledger containers, missing host capability directories, a
  missing support surface root or its `drafts/`, `harnesses/` and `fixtures/`
  scaffold, Wakeflow's managed blocks and memory files, a missing or stale
  window runtime projection (recomputed from the config and the window's
  current binding), and a missing host runtime or maintenance protocol root,
  even when the whole `.wakeflow-local` directory is gone. It also takes back
  private modes: when something under `.wakeflow-local` or `.wakeflow-active`
  has only drifted wider than 0700 / 0600 in a safe way (say after a
  `chmod -R go+rX`), the preview's plan is a `WakeflowPrivateModeConvergencePlan`
  (counts and areas) instead of the usual steps: apply it, then preview again.
  A private node another user owns, that group or others can write, or that
  is a symlink is reported as `private-mode-unsafe:<area>` and never touched,
  and the other intents refuse with `private-mode-drift` until reconcile has
  run; `wakeflow_verify` names the same areas in its `local-layout` gate. A
  hand-edited block, a foreign file where a Wakeflow directory belongs, or an
  unreadable projection is reported as a blocker and never overwritten.
- **detach-repository** `{repositoryId}` / **detach-workspace** - the exit
  path (ADR-0024). "Take repository X out of Wakeflow" or "stop using Wakeflow
  here" is this intent, never a hand deletion of Wakeflow's files; both run
  the same preview, apply and recover transaction. A repository detach removes
  Wakeflow's block from that repository's `{{instructionFile}}` (only a block
  whose body is a render Wakeflow wrote), retires its window projections and
  publishes the config without it and its primary-pod window. A workspace
  detach does that for every repository, removes the workspace `.gitignore`
  and instruction-file blocks and, where the host has settings (Claude Code), Wakeflow's allow rules
  and its own `statusLine` entry at the program root and the managed surfaces
  (the user's own stay), then renames `wakeflow.config.json` to
  `wakeflow.detached.json`. Both block while a worktree pod is open
  (`detach-pod-open:<podId>`) or a Demand is active
  (`detach-demand-active:<demandId>`): close or finish those first. A block
  whose body is unknown blocks as `detach-unknown-managed-body:<targetKey>`,
  an unreadable settings file as `detach-settings-unreadable:<root>`. Not
  touched, and listed in the result's `leftBehind`: `.wakeflow-active`,
  `.wakeflow-local`, the ledger, the support surfaces, worktree checkouts,
  branches and the plugin's hooks. Afterwards `wakeflow_status` reports
  `overall: detached` with no owner in `next`, `wakeflow_verify` does not
  fail, reconcile and reconfigure block as `workspace-detached`, and a fresh
  initialize blocks as `detached-file-present` until the user moves that file.

Procedure, every time:

1. Gather the user's choices in plain conversation first. Repositories, the
   surfaces, the storage root and the program's own description are decisions,
   not defaults for you to pick. A model or reasoning effort the user wants
   for a role belongs in the selection's `hosts` block, keyed by host and
   role: `hosts.<host>.launch.modelByRole.<role or default>`, and
   `reasoningEffortByRole` likewise. Claude Code windows launch in Claude
   Code's `auto` permission mode by default; one value,
   `hosts.claude-code.launch.permissionMode`, covers every window. A window
   may still ask a one-time question the first time, for example whether to
   allow reads outside its working directories: tell the user which window is
   asking and let them answer it there. When the user's account has no auto
   mode, set that value to `acceptEdits` with a reconfigure; the next launch
   intents carry it, and those windows then stop for permission prompts on
   commands, which the user answers the same way.
2. Preview. It writes nothing and returns the plan, its blockers and the launch
   intents the plan would produce.
3. Show the user the plan and every blocker. A blocker is a fact about their
   directory, so quote it rather than paraphrasing it away. On Claude Code,
   `settings-blocked:<root kind>:<root id>:<reason>` means that root's
   `.claude/settings.json` could not be read or merged safely (for example it
   is not mode 0644, is a link, or is larger than 1 MiB); the file is the
   user's, so tell them what to change instead of editing it.
4. Apply with exactly what that preview returned. If anything changed in
   between, preview again - a re-derived plan that no longer matches is refused
   on purpose.
5. If an apply is interrupted, finish it with recover and the operation it
   reported. Do not start a second apply over a half-finished one.

After a fresh-initialize you have a config, a ledger, the surfaces, the managed
instruction block, and the main pod's window set - but no running windows.

## Step 1 - Windows and bindings

A logical window is a role plus a root: `controller`, `design`, `test`, and one
`product` window per repository. Its identity is the typed id in the config;
the display name is decoration and never says which window something belongs
to. A binding maps that logical window to the host handle you observed after
launching it; bindings live in the private local runtime, never in a public
result.

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
  an inconvenient state. On Claude Code the helper's `close` kills nothing
  when the pane no longer carries its Wakeflow marks (for example after a
  tmux server restart) and reports `closeResult: unknown`; decommission then
  goes to the manual host gate.
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

## Workspace format baseline

The current workspace format is the first supported baseline: earlier
development builds' local formats are neither read nor migrated. `reconfigure`,
`reconcile` and `recover` work within the current format; none is a
format-upgrade or data-conversion tool. A root with an unsupported
configuration or layout is preserved as it is - choose a separate fresh
workspace, and never edit version headers, delete old authority or reuse old
bindings to make it look initialized. `writer-protocol-unsupported` means this
runtime cannot write that format and offers no upgrade path.

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
session started under the previous plugin and has not restarted since. Strict
verification counts these as `windows-stale:<n>`, fails the `runtime-artifact`
gate and names `window-artifact-stale` in `next`. `unverified` means the host
adapter has no such evidence either way (Codex sessions, or a session-start
record without an observer digest); verification reports
`window-runtime-unverified:<n>` as information on a passing gate, never as a
failure. Keep that limitation explicit: do not fabricate records, rebind, or
repeatedly restart windows to clear it, and do not treat `unverified` as a
blanket prerequisite for actions whose own contracts do not depend on it.

A window's `attention` says whether the host is waiting for the user there:
`needed` when the bound session's latest hook record is a Claude Code
`Notification` other than an idle prompt (`notificationType` names the cause),
`none` once a later record superseded it, `null` without a binding or any
record. Tell the user which window needs them; their action there clears it, no
tool does. On Claude Code the hooks also mark a bound window's name in the
window list: green `+` working, red `?` waiting for you, nothing when idle
(`mark` sets that format): a hint, never evidence.

A registered window's `launchIntent` compares the intent digest recorded at its
handshake with what the current config and host profile produce: `current` when
they agree, `drifted` when the window was launched or last resumed under an
older intent (a config or plugin change since). A relocate keeps the recorded
digest; only a replacing handshake renews it. It informs your review of that
window's launch parameters; no gate fails on it and it never justifies rebinding.

Restart the stale windows with the host's procedure: {{windowResume}} After this
server is current, preview and apply reconcile for repairable workspace gates
such as host-settings-assets. A peer's `unverified` state remains separate from
those repairs and from Controller acceptance of returned work.

When a fresh session is the only way (`resume-never-conversed`, or the user
asked for a new one), the complete sequence on Claude Code is four calls, one
helper call per Bash command, each printed result kept verbatim: `close
--window <windowId>` (the binding stays; this is not a decommission); `launch
--window <windowId> --wait 60` with that window's current inspect result piped
in; `wakeflow_register_window_binding` with `operation: "replace"`, the printed
`observation`, and the `expectedBindingId` / `expectedBindingDigest` the
inspect returned; then `mark --window <windowId>`. Never reconstruct those
calls from your own session transcript or from the plugin's source.

## Interrupted writes and cancellation

`reconcile` can first return a `WakeflowDemandRuntimeRecoveryPlan` for known
event append residues: its preview is read-only, its apply rechecks the plan
and owner facts, retires uncommitted candidates or settles already linked
commits, and preserves committed event bytes; re-preview afterwards for
ordinary layout maintenance. `demand-candidates-busy:<demandId>` means the
writer may still be active - wait and inspect again. Unknown owners, unknown
files and changed resources are not permission to force cleanup. Board and
projection writers retire a proven inactive lock before retrying; a lock with
a live or unknown owner stays protected. A pending Demand publication or
lifecycle journal keeps reserving its pod after the process exits: finish that
operation's documented recovery before claiming another requirement or closing
the pod. Cancelling a tool call stops work before its next commit point, and a
disconnected or cancelled response does not prove that nothing was committed:
inspect the stored outcome and reuse the original idempotency key for an
append retry; never resend a host delivery only because its response was
interrupted.

## Pods

A pod is the only execution-environment abstraction: a complete window set
(controller, design, test, one product window per repository) plus one
execution location per repository. The main pod is `primary` and sits in the
main checkout; every other pod works in a worktree.

`wakeflow_pod` create:

1. Preview to derive the plan; it writes nothing.
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
   resolve it inside a worktree; say so in that pod's task packages. The product windows
   need not start one by one: launch them all without waiting (`--wait 0` on
   Claude Code), keep each printed observation, and register them once their
   session-start records exist.
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

`hostAssets` lists the files Wakeflow published per host (the status line and,
on Claude Code, the tmux helper) and whether their bytes are still the
artifact's. A helper that is `drift`, `missing` or `mode` is not yours to run:
`wakeflow_prepare_delivery` refuses with `host-asset-<status>` until a reconcile
republishes it - tell the user something rewrote the file, never repair it by
hand. `settings: custom` is the user's own status line, left alone.

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
