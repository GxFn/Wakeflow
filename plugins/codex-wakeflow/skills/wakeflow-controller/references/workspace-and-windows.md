# Workspace, windows and pods

Read this when you are initializing or reconfiguring the workspace (step 0),
launching or retiring a window (step 1), refreshing windows after a plugin
update, or creating or closing a pod (step 13). It is Controller depth; the
immediate goal, the reading order and the boundaries are in `SKILL.md`.

## What the workspace is

A Wakeflow workspace is a controller directory that must not be a product
repository root. It holds the config, the active state, the local runtime, and
the managed block inside `AGENTS.md`. The ledger is the durable
record root; the Design and Test surfaces are where drafts and harnesses live.
Everything else - the product repositories - Wakeflow only points at. A
repository or an externally owned surface whose config entry says
`instructionManagement: managed-block` additionally carries a Wakeflow managed
block in its own `AGENTS.md`; reconcile maintains that block and
refuses to overwrite a block someone edited by hand.

Config authority is total: `wakeflow.config.json` belongs to Wakeflow as a
whole file. Do not hand-edit it, and do not treat a value you remember as
current. Read it back through a tool.

## Step 0 - Maintenance

`wakeflow_maintain_workspace` runs one transaction in one of three intents:

- **fresh-initialize** - a new workspace in an empty or non-workspace
  directory that is itself a Git repository (when it is not, run `git init`
  there yourself once the user agrees; the preview reports
  `gitignore-git-repository` until it is).
- **reconfigure** - a declared difference against an existing config. Layout
  identity is immutable: the program id and the ledger root cannot move, the
  support surfaces cannot change, and a change to the pod set is not a
  reconfigure. Those refusals are structural, not advisory - route the user to
  the right operation instead of retrying. What does change here: the display
  name, description and language, the host launch preferences under `hosts` -
  the model and reasoning effort by role, Claude Code's permission mode, and
  the tmux container names - which the next launch intents pick up without
  touching any window, and one kind of layout change: adding a product
  repository. Send the
  current config with the new repository entry and one new `product` window
  for it in the primary pod appended, each with a fresh id (`repository_` or
  `window_` followed by a new lowercase UUID v4). The repository's root must
  already exist and be its own Git repository: a linked worktree of another
  repository is refused as `reconfigure-repository-root-worktree`, and a path
  that is, contains or sits inside an already configured repository (a
  symlink alias included) as `reconfigure-repository-root-duplicate`; more
  than one new window for it is refused as
  `reconfigure-window-addition-unsupported`. The apply writes the config, the new
  window's runtime projection and the managed blocks in one transaction; then
  launch and register the new window as in step 1. Removing or changing an
  existing repository or window is refused, and so is adding a repository
  while a worktree pod is open, because that pod would lack it. That last
  refusal is an `invalid-request` error with reason `desired-config`,
  `details.configReason: topology` and a path into the pod's entry - tell the
  user to close the pod first rather than rewriting the config.
- **reconcile** - bring a workspace back to what its descriptor implies. On a
  healthy workspace this is a no-op that writes nothing, which makes it a safe
  thing to run when you are unsure. It repairs only what Wakeflow owns: a
  missing active layout or board, missing ledger containers, missing host
  capability directories, a missing support surface root or its `drafts/`,
  `harnesses/` and `fixtures/` scaffold, Wakeflow's managed blocks and memory
  files, a missing or stale window runtime projection (recomputed from the
  config and the window's current binding), and a missing host runtime or
  maintenance protocol root, even when the whole `.wakeflow-local` directory
  is gone. It also takes back private modes: when a directory or file under
  `.wakeflow-local` or `.wakeflow-active` has only drifted wider than 0700 /
  0600 in a safe way - for example after a `chmod -R go+rX` - the reconcile
  preview's plan is a `WakeflowPrivateModeConvergencePlan` (counts and the
  areas involved) instead of the usual steps. Apply it, then preview
  reconcile again. A private node another user owns, that group or others
  can write, or that is a symlink is reported as `private-mode-unsafe:<area>`
  and never touched, and the other intents refuse with `private-mode-drift`
  until reconcile has run. `wakeflow_verify` names the same areas in its
  `local-layout` gate. A hand-edited block, a foreign file sitting where a
  Wakeflow directory belongs, or an unreadable projection is reported as a
  blocker and never overwritten.

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
`product` window per repository. The identity is the typed id in the config;
the display name is decoration and must never be used to infer which window
something belongs to.

A binding maps that logical window to the host handle you observed after
launching it. Bindings live in the private local runtime and never appear in a
public result.

Before the first launch: reuse the current chat as Controller only when its outer workspace project membership and workspace-root SessionStart are established. A source-maintenance chat in another project is not that Controller. With the user's existing authorization, create the Controller in the workspace project first, verify and register it, then handle the other roles in that same project. Do not ask again for authorization already given. If this chat is not that Controller, tell the user which chat is and continue there instead of running the Controller flow from here.

Launching and registering:

1. Take the window id from the maintenance or pod result, then call
   `wakeflow_register_window_binding` with `inspect` for its current launch
   intent and execution instructions. Its role root is the assigned work
   location; the host instructions separately determine the chat's startup root.
2. Launch it by host means: use list_projects to resolve the existing outer workspace project by canonical path and host, then create_thread with target.type project, that projectId, and environment.type local for every role. Never register role directories as projects or substitute projectless chats or codex exec sessions. The chat starts in the workspace root; the role's execution root is separate and must be stated in its startup prompt with windowId, role skill, scope and return pointer. Read the execution root's instructions explicitly and use it as command workdir. Retain the creation result and wait for a ready threadId; clientThreadId is not a binding handle. Read back project membership and actual startup before registration. If the list omits a newly created chat, use direct UI confirmation and disclose that limitation; cwd and title alone do not prove project membership. A missing project or unavailable creation tool is a blocker, not permission for an external fallback. Do not retry creation after an ambiguous result until you establish whether the first chat exists. Keep requested role chats visible; archive only when the user authorizes retiring them. A thread is never moved into a new process, so relocate does not apply on this host; replace a gone thread only with an authorized new chat in the same outer project.
3. Observe the handle the host reports for the window you just started.
4. Call `wakeflow_register_window_binding` to register it. Registration
   requires a real `session-start` hook record for that session at the startup
   root required by the host instructions. Project membership is a separate
   host observation; a hook record does not prove sidebar placement.
   If registration is refused for want of that record, the window either did
   not start, started somewhere else, or the host's hook channel is not
   trusted yet - check the install steps in the README before you retry.
5. Replaying the same registration is idempotent and returns the first result.
   That is the safe response to an ambiguous launch.

Other actions on the same tool:

- **inspect** recomputes the launch intent and reports the binding, the work
  claim and the locator state. This is how you answer "is this window really
  bound" without touching anything.
- **replace** binds a new handle against the old binding. A stale digest is
  refused; re-inspect and replace against what is current.
- **relocate** keeps the binding and records where a resumed session now
  lives: the same handle, new host coordinates, the same CAS on the binding.
  It is the record for a window whose process died while its session should
  go on; the launch step above says whether and how this host brings such a
  session back. A held work claim does not block relocate: the same session
  keeps its work. Use replace only when the session itself is gone.
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
partitions; older flat records remain readable in place. The reader pages
through history and status aggregates all observed records. An incomplete
query raises `observation-query-incomplete`; do not infer that a delivery never
landed from it. Unreadable candidate evidence raises `observation-query-unavailable`.
Directory races or unreadable partitions are unavailable,
not an empty channel. Unknown entries remain visible as skipped and are not
automatically removed. A damaged shard can still require manual diagnosis.
Retirement is best effort in bounded batches; it never removes records merely
to make a count limit fit, and the existing 30-day age boundary remains.

## Workspace format baseline

The current workspace format is the first supported baseline. Initialize a new,
empty workspace with `fresh-initialize`; local formats from earlier development
builds are not read or migrated by this version.

`reconfigure` changes intent within the current format. `reconcile` repairs its
owned resources, and `recover` resumes an interrupted current-format operation.
These are normal maintenance, not format-upgrade or data-conversion tools.

If a root has an unsupported configuration or layout, preserve it and choose a
separate fresh workspace. Never change version headers, delete old authority, or
reuse old bindings to make it appear initialized. `writer-protocol-unsupported`
means this runtime cannot write that format; it does not offer an upgrade path.

## After a plugin update

`runtime` describes the MCP server serving this call. A changed manifest at
its own path produces `server-outdated` / `runtime-artifact-outdated`; a missing
manifest produces `manifest-unavailable` / `runtime-artifact-unavailable`.
Inspect the installation and reload this server before it performs maintenance.
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

Restart the stale windows with the host's procedure: when this serving MCP is outdated, ask the user to restart the Codex app and resume this existing chat before maintenance: only an app restart reloads Wakeflow's MCP server; resuming or continuing a chat does not. A peer window that verify reports as `stale` (its session started under an older artifact) is refreshed the same way - the user restarts the app once and resumes that existing chat through the host; `unverified` peers carry no such evidence and are left alone. Replace its binding only when the old chat is gone and the user authorizes a replacement chat. A missing hook alone does not justify creating or rebinding a chat. After this
server is current, preview and apply reconcile for repairable workspace gates
such as host-settings-assets. A peer's `unverified` state remains separate from
those repairs and from Controller acceptance of returned work.

## Interrupted writes and cancellation

`reconcile` can first return a `WakeflowDemandRuntimeRecoveryPlan` for known
event append residues. Its preview is read-only. Apply rechecks the plan and
owner facts, retires uncommitted candidates or settles already linked commits,
and preserves committed event bytes. Re-preview afterwards for ordinary layout
maintenance. `demand-candidates-busy:<demandId>` means the writer may still be
active; wait and inspect again. Unknown owners, unknown files and changed
resources are not permission to force cleanup.

Board and projection writers retire a proven inactive lock before retrying their
own operation. A lock with a live or unknown owner is still protected. A pending
Demand publication or lifecycle journal continues to reserve its pod after the
process exits; finish that operation's documented recovery before claiming a
different requirement or closing the pod.

Cancelling a tool call stops work before its next commit point. A disconnected
or cancelled response does not prove that nothing was committed. Inspect the
stored outcome and reuse the original idempotency key for an append retry. Do
not resend a host delivery solely because its response was interrupted.

## Pods

A pod is the only execution-environment abstraction: a complete window set
(controller, design, test, one product window per repository) plus one
execution location per repository. The main pod is `primary` and sits in the
main checkout; every other pod works in a worktree.

`wakeflow_pod` create:

1. Preview to derive the plan; it writes nothing.
2. Apply with exactly what preview returned. One config transaction registers
   the pod, its window set, and one worktree intent per repository.
3. Create each worktree by host means: create a linked checkout from the configured product repository's local HEAD using git worktree add with the suggested branch name and an available checkout path inside the Wakeflow workspace root, beside it in the same outer directory, or inside that product repository - registration refuses a checkout anywhere else. Keep the role chat in the same outer project using a local environment: create_thread's worktree environment targets the project's primary repository. Pass the assigned checkout in the startup prompt and record worktree.executionRoot from pwd there along with git worktree list --porcelain and git rev-parse --git-common-dir. Wakeflow verifies the checkout's repository and pointer files independently of the chat's SessionStart. Then launch that
   pod's windows using their host launch instructions and register each binding as in
   step 1. A product window in a pod is refused registration until its worktree
   is actually there and observed, and a checkout another live pod already
   holds is refused as `worktree-occupied`. Bring the pod up in this order:
   its Controller and Design windows, then every product window with its
   worktree observation, and only then its Test window - the Test window's
   launch intent lists the worktrees as attached directories, and that list is
   read from the receipts the product registrations wrote. The product windows
   need not start one by one: launch them all without waiting (`--wait 0` on
   Claude Code), keep each printed observation, and register them once their
   session-start records exist.
4. If receipts and config disagree after an interruption, reconcile with
   recover before doing anything else.

While a pod is open, its Controller claims its own requirement package from the
shared board. One Demand per pod Controller still holds; a pod does not let one
Controller run two Demands.

Between archiving a pod's Demand and closing the pod, `wakeflow_status` keeps
listing the branches that Demand's accepted results left unmerged, with
`source: archived`, so the user can see what still waits for a merge or an
abandon decision.

`wakeflow_pod` close, after the user has merged or abandoned the branch:

1. The pod's Demand must already be archived.
2. Record the branch dispositions. This is the phase that says what happened to
   the work - do not record "merged" for a branch you have not seen merged.
3. Retire the pod's windows, then remove its checkouts with the
   `git worktree remove` command the status suggests. A host may lock a
   checkout while its session runs; once that window is retired the lock is
   stale, so `git worktree unlock` it first, then remove and
   `git worktree prune`. Wakeflow never removes a checkout itself.
4. Remove the pod. Closing in this order is what keeps the config and the
   worktrees from disagreeing.

## Reading the workspace

`wakeflow_status` is one observation across every domain: overall state, board
counts, active Demands with their route and frontier, windows with their
identity, claims and runtime projection freshness, pods with their execution
location, repository pointer facts, hook channels, active projection freshness
and the next actions. Pass a Demand
to attach that Demand's route, or its archive receipt if it is finished. Treat
its `next actions` as the authoritative answer to "what now" - it is derived
from state, and your memory of the conversation is not.

`wakeflow_verify` is the strict read. Each gate passes, fails, or is
unavailable, and unavailable is counted separately from failure precisely so
that "we could not check" is never reported as "it is fine". It repairs
nothing. Run it before completing a Demand, whenever status looks
self-contradictory, and whenever a delivery looked sent but no evidence
arrived - the hook channel gate is the usual cause and the README names the
one-time host actions that fix it.

Projections are deterministic rewrites. If a projection file has been edited by
hand, Wakeflow stops overwriting it and reports it rather than destroying the
edit. That is not a failure to repair; it is the edit being respected. A
window's runtime projection that is missing or stale is different: verify names
the window in its `window-runtime-projection` gate and reconcile rebuilds it;
only an unreadable one stays reported.
