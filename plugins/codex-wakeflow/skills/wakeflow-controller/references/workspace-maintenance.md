# Workspace and maintenance

Read this when you are initializing, reconfiguring or detaching the workspace
(step 0), or recovering an interrupted write. It is Controller depth;
the immediate goal, the reading order and the boundaries are in `SKILL.md`.

## What the workspace is

A Wakeflow workspace is a controller directory that must not be a product
repository root. It holds the config, the active state, the local runtime and
the managed block inside `AGENTS.md`; the ledger is the durable record
root, the Design and Test surfaces are where drafts and harnesses live, and
the product repositories are only pointed at. A repository or externally owned
surface whose config entry says `instructionManagement: managed-block` also
carries a Wakeflow managed block in its own `AGENTS.md`; reconcile
maintains that block and refuses to overwrite one edited by hand.

Config authority is total: `wakeflow.config.json` belongs to Wakeflow as a whole
file. Never hand-edit it or trust a remembered value; read it back through a tool.

## Step 0 - Maintenance

`wakeflow_maintain_workspace` runs one transaction in one of five intents:

- **fresh-initialize** - a new workspace in an empty or non-workspace directory
  that is itself a Git repository (when it is not, run `git init` there yourself
  once the user agrees; the preview reports `gitignore-git-repository` until it
  is). The `selection` you send has six parts: `program` (identity and display),
  `presentation` (language), `topology` (repositories with their
  `instructionManagement`, support surfaces, windows), `storage` (ledger root),
  `governance`, `hosts` (launch preferences by host; on Claude Code also
  `windowTransport`, `tmux` or `desktop`, the window transport chosen with the
  user at this first run - one per workspace); its exact shape, `hosts`
  included, is the tool's input schema in your tool list, so build the request
  from that schema and never from plugin files on disk or another workspace's
  config. A refusal names the failing path and the rule in `details.schema`
  (`required:storage`, `additional:foo`, `type:string`, `enum`): fix that field
  and preview again. Default repositories to `owner-managed`; offer
  `managed-block` only when the user wants Wakeflow's bounded block in the
  repository's instruction file, and tell them a committed block is seen by
  every clone. `filesystem-unsupported:<type>` / `ledger-filesystem-unsupported:<type>` means the workspace root or the ledger root is not on a local macOS volume (APFS or HFS+): locks and atomic publication are not safe there, so tell the user to choose a local path - never work around it. `fresh-legacy-residue-present` means the scan found 0.9.x
  leftovers; the codes `fresh-legacy-residue-<kind>` say which (`scope-block`,
  `broad-permission`, `additional-directories`, `root-marker`,
  `ledger-directory`). Residue is cleaned by the user, never by you; a sibling
  `../wakeflow-ledger` directory that is another workspace's live ledger (it
  carries `archives/`, `requirements/`, `transactions/`) is not residue and is
  not reported.
- **reconfigure** - a declared difference against an existing config. Layout
  identity is immutable: the program id and the ledger root cannot move, the
  support surfaces cannot change, and a change to the pod set is not a
  reconfigure. These refusals are structural: route the user to the right
  operation instead of retrying. What does change here: the display name,
  description and language, the host launch preferences under `hosts` - the
  model and reasoning effort by role, Claude Code's permission mode, and its
  tmux session name - which the next launch intents pick up without touching any
  window (the window transport is chosen at the first run; a later `reconfigure`
  can switch the transport when no Demand is active and no worktree pod is open,
  then every window is unregistered: relaunch and register each with the new
  transport's helper), and one kind of layout change: adding a product
  repository. Send the current config with the new repository entry and one new
  `product` window for it in the primary pod appended, each with a fresh id
  (`repository_` or `window_` followed by a new lowercase UUID v4). The
  repository's root must already exist and be its own Git repository: a linked
  worktree of another repository is refused as
  `reconfigure-repository-root-worktree`, a path that is, contains or sits
  inside an already configured repository (a symlink alias included) as
  `reconfigure-repository-root-duplicate`, and more than one new window for it
  as `reconfigure-window-addition-unsupported`. The apply writes the config, the
  new window's runtime projection and the managed blocks in one transaction;
  then launch and register the new window as in step 1. Changing an existing
  repository or window is refused; removing one is the detach intent below.
  Adding a repository while a worktree pod is open is refused too, because that
  pod would lack it: an `invalid-request` error with reason `desired-config`,
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
  private modes: when something under `.wakeflow-local` or `.wakeflow-active` has only drifted
  wider than 0700 / 0600 in a safe way (a `chmod -R go+rX`, a Finder `.DS_Store`), the preview's plan
  is a `WakeflowPrivateModeConvergencePlan` (counts and areas) and `next` names you as its owner: it only
  restores permission bits, so apply it without asking, then preview again; the user confirms that next plan. The same holds for a reconcile whose plan only reinstalls Wakeflow's own published files (every step a `statusline-asset`, `tmux-asset` or `desktop-asset`, the plan after a plugin update): `next.owner` is `controller`, apply it without asking and say afterwards what was reinstalled. Any other step in the plan puts the apply back with the user.
  A private node another user owns, that group or others can write, or that
  is a symlink is reported as `private-mode-unsafe:<area>` and never touched,
  and the other intents refuse with `private-mode-drift` until reconcile has
  run; `wakeflow_verify` names the same areas in its `local-layout` gate. A
  hand-edited block, a foreign file where a Wakeflow directory belongs, or an
  unreadable projection is reported as a blocker and never overwritten.
  After any apply, the no-op one included, Wakeflow re-renders the pages
  people read: the board index and the ledger's `history.md` in the workspace
  language, plus the page of every archived Demand that has none yet. So one
  reconcile after an update or a language change brings them all up to date.
- **detach-repository** `{repositoryId}` / **detach-workspace** - the exit
  path (ADR-0024). "Take repository X out of Wakeflow" or "stop using Wakeflow
  here" is this intent, never a hand deletion of Wakeflow's files; both run
  the same preview, apply and recover transaction. A repository detach removes
  Wakeflow's block from that repository's `AGENTS.md` (only a block
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
  initialize blocks as `detached-file-present`; re-enable = rename it back and reconcile.

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
   reported. Do not start a second apply over a half-finished one. `maintenance-recovery-artifact-mismatch` means the interrupted apply was written by another plugin version (`details.writerVersion`) and this one cannot finish it: tell the user to run recover once from that version, then update again - do not delete the transaction files.

After a fresh-initialize you have a config, a ledger, the surfaces, the managed
instruction block, and the main pod's window set - but no running windows.

## Workspace format baseline

The current workspace format is the first supported baseline: earlier
development builds' local formats are neither read nor migrated. `reconfigure`,
`reconcile` and `recover` work within the current format; none is a
format-upgrade or data-conversion tool. A root with an unsupported
configuration or layout is preserved as it is - choose a separate fresh
workspace, and never edit version headers, delete old authority or reuse old
bindings to make it look initialized. `config-version-unsupported` (on reads; `details.found` and `details.supported` name the two versions, and a maintenance preview lists `config-version-unsupported:<found>`) and `writer-protocol-unsupported` (on writes) both mean this
runtime does not handle that format and offers no upgrade path: tell the user to use the plugin version that wrote it, or to keep that root and its ledger as history and initialize a fresh workspace elsewhere with a ledger root of its own.

## Interrupted writes and cancellation

`reconcile` can first return a `WakeflowDemandRuntimeRecoveryPlan` for known
event append residues and for stage files a dead writer left in a Demand's
index, snapshot or task-package directory (`stageResidueCount`): its preview is
read-only, its apply rechecks the plan and owner facts, retires uncommitted
candidates or settles already linked commits, removes the dead stage files,
and preserves committed event bytes; re-preview afterwards for ordinary layout
maintenance. `demand-stage-residue-busy:<demandId>` means such a writer may
still be active - wait and preview again;
`demand-stage-residue-unknown:<demandId>` means a writer cannot be told dead
or alive - preview again later, and report it to the user if it stays. Stage
files that are not provably a dead writer's are left alone and not listed. Two more first plans work the same way. A `WakeflowMaintenanceGateResiduePlan` appears when `maintenance.protocol` is `recovery-required` and no residue is recoverable: a maintenance process died holding the gate before it recorded an operation, so there is nothing to recover; apply retires the dead gate lock and the orphan stage files, and refuses with `maintenance-gate-residue` when an owner may still be alive - wait and preview again. A `WakeflowHookStageResiduePlan` appears when verify reports `<host>:stage-residue-<n>` on the hook evidence gate: apply removes the stale stage files it counted as retirable; the directories and links it only counts as kept are the user's to remove. `<host>:write-failures-<n>:last-<UTC time>` on the same gate is information, not a failure: the hook observer could not write n records in the last seven days, most recently at that time; the incident files under `.wakeflow-local/runtime/incidents/` name the failing check (`chain[].reason` and `path`), and the code clears by itself after seven days without a new one - report it once, do not chase it every step. `demand-candidates-busy:<demandId>` means the writer may still be
active - wait and inspect again. Unknown owners, unknown files and changed
resources are not permission to force cleanup. Board and projection writers
retire a proven inactive lock before retrying; a lock with a live or unknown
owner stays protected. A pending Demand publication or lifecycle journal keeps
reserving its pod after the process exits: finish that operation's documented
recovery before claiming another requirement or closing the pod. Where that
Demand's root is in place, status names it as `demand-recovery` on that Demand
(`nextActions` gives the tool and the Demand id as `subject`; verify lists
`demand-recovery:<id>` in `next.blockers` and suggests the first one's tool,
after an outdated runtime artifact and after a pending maintenance), and a
call on that Demand is refused `recovery-required` with `details.tool` and the
id to pass (`details.operationId`; `details.demandId` for
`wakeflow_record_evidence`). `pod-busy` carries only `details.demandId`: read
status with that id. An active Demand there simply occupies the pod;
`demand-recovery` names its unfinished operation; when status does not know
that Demand, a create was cut before its root was in place - finish it with
`wakeflow_create_demand`, `mode: recover`, that id as `operationId`. Cancelling a
tool call stops work before its next commit point, and a disconnected or
cancelled response does not prove that nothing was committed: inspect the stored
outcome and reuse the original idempotency key for an append retry; never resend
a host delivery only because its response was interrupted.
