# Workspace, windows and pods

Read this when you are initializing or reconfiguring the workspace (step 0),
launching or retiring a window (step 1), or creating or closing a pod
(step 13). It is Controller depth; the immediate goal, the reading order and
the boundaries are in `SKILL.md`.

## What the workspace is

A Wakeflow workspace is a controller directory that must not be a product
repository root. It holds the config, the active state, the local runtime, and
the managed block inside `CLAUDE.md`. The ledger is the durable
record root; the Design and Test surfaces are where drafts and harnesses live.
Everything else - the product repositories - Wakeflow only points at. A
repository or an externally owned surface whose config entry says
`instructionManagement: managed-block` additionally carries a Wakeflow managed
block in its own `CLAUDE.md`; reconcile maintains that block and
refuses to overwrite a block someone edited by hand.

Config authority is total: `wakeflow.config.json` belongs to Wakeflow as a
whole file. Do not hand-edit it, and do not treat a value you remember as
current. Read it back through a tool.

## Step 0 - Maintenance

`wakeflow_maintain_workspace` runs one transaction in one of three intents:

- **fresh-initialize** - a new workspace in an empty or non-workspace
  directory that is itself a Git repository (`git init` first; the preview
  reports `gitignore-git-repository` until it is).
- **reconfigure** - a declared difference against an existing config. Layout
  identity is immutable: the program id and the ledger root cannot move, the
  topology (repositories, surfaces, windows) is refused as a layout change,
  and a change to the pod set is not a reconfigure. Those refusals are
  structural, not advisory - route the user to the right operation instead of
  retrying. What does change here: the display name, description and
  language, and the host launch preferences under `hosts` - the model,
  reasoning effort and permission mode by role, and the tmux container names -
  which the next launch intents pick up without touching any window.
- **reconcile** - bring a workspace back to what its descriptor implies. On a
  healthy workspace this is a no-op that writes nothing, which makes it a safe
  thing to run when you are unsure. It repairs only what Wakeflow owns: a
  missing active layout or board, missing ledger containers, missing host
  capability directories, a missing support surface root or its `drafts/`,
  `harnesses/` and `fixtures/` scaffold, Wakeflow's managed blocks and memory
  files, a missing or stale window runtime projection (recomputed from the
  config and the window's current binding), and a missing host runtime or
  maintenance protocol root, even when the whole `.wakeflow-local` directory
  is gone. A hand-edited block, a foreign file sitting where a Wakeflow
  directory belongs, or an unreadable projection is reported as a blocker and
  never overwritten.

Procedure, every time:

1. Gather the user's choices in plain conversation first. Repositories, the
   surfaces, the storage root and the program's own description are decisions,
   not defaults for you to pick. A model, reasoning effort or permission mode
   the user wants for a role belongs in the selection's `hosts` block, keyed
   by host and role: `hosts.<host>.launch.modelByRole.<role or default>`,
   `reasoningEffortByRole` likewise, and `permissionMode` for Claude Code.
2. Preview. It writes nothing and returns the plan, its blockers and the launch
   intents the plan would produce.
3. Show the user the plan and every blocker. A blocker is a fact about their
   directory, so quote it rather than paraphrasing it away.
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

Before the first launch: run `node .wakeflow-local/runtime/hosts/claude-code/operations/assets/tmux.mjs preflight` and read `insideTmux`. When it is true this session is the Controller: register it with `self` (pipe your own window's inspect result in). When it is false this session only bootstraps and must not register itself: `launch` the Controller window's own intent too, so a fresh Controller starts inside the tmux session the helper creates, launch every other window with `--wait 0`, then give the user the exact `attach` command the helper printed, ask them to accept the trust dialog in every window (`Ctrl-b n` moves to the next one) and to tell you when that is done; only then register each window from the observations you kept, run `mark --all`, and tell the user to continue in the tmux Controller and close this session. The user never sets tmux up by hand: you do it and tell them the one thing to run or press.

Launching and registering:

1. Take the launch intent from the maintenance or pod result: it names the
   role, the root and the launch parameters.
2. Launch it by host means: pipe the intent (the `launchIntent` that `wakeflow_register_window_binding` inspect returns, or the maintenance result's entry for that window) into the tmux helper, run from the workspace root: `node .wakeflow-local/runtime/hosts/claude-code/operations/assets/tmux.mjs launch --window <windowId>`. The helper opens the tmux window at the intent's root, starts `claude` with the listed parameters and a fresh session id, waits for the session-start hook record, and prints the creation observation to register verbatim. After each registration run `mark --window <windowId>` so the tmux window carries the five Wakeflow options; `panes` prints the tmux-panes observation, and `close --window <windowId>` prints the closure evidence a decommission needs.
3. Observe the handle the host reports for the window you just started.
4. Call `wakeflow_register_window_binding` to register it. Registration
   requires a real `session-start` hook record for that session and that root.
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
- **decommission** retires a window with its pre-close, close-result and
  post-close evidence. Use it when a window is genuinely gone, not to silence
  an inconvenient state.
- **release-claim** force-releases an expired or orphaned work claim. Use it
  only when you have established that the holding window is gone. A live claim
  is protecting someone's work.

Wakeflow never opens, inspects or closes a window. Every one of those actions
is yours, and the binding tool only records what you observed.

## Pods

A pod is the only execution-environment abstraction: a complete window set
(controller, design, test, one product window per repository) plus one
execution location per repository. The main pod is `primary` and sits in the
main checkout; every other pod works in a worktree.

`wakeflow_pod` create:

1. Preview to derive the plan; it writes nothing.
2. Apply with exactly what preview returned. One config transaction registers
   the pod, its window set, and one worktree intent per repository.
3. Create each worktree by host means: run `git worktree add` yourself at the path the intent names, or let the host make it by starting that window with `claude --worktree <name>`, which puts the checkout on branch `worktree-<name>`. Then launch that
   pod's windows in their worktree roots and register each binding as in
   step 1. A product window in a pod is refused registration until its worktree
   is actually there and observed.
4. If receipts and config disagree after an interruption, reconcile with
   recover before doing anything else.

While a pod is open, its Controller claims its own requirement package from the
shared board. One Demand per pod Controller still holds; a pod does not let one
Controller run two Demands.

`wakeflow_pod` close, after the user has merged or abandoned the branch:

1. The pod's Demand must already be archived.
2. Record the branch dispositions. This is the phase that says what happened to
   the work - do not record "merged" for a branch you have not seen merged.
3. Retire the pod's windows and remove its checkouts.
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
