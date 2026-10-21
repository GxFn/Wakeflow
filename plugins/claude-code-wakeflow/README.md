# Wakeflow

Wakeflow turns "I want this built" into a traceable line of work: a requirement
package, a Demand, task packages, deliveries, results, reviews, and an archive
that still makes sense months later.

It is local and closed-world. Wakeflow holds state, evidence and history; your
agent holds judgment and performs every effect on your machine. Wakeflow never
opens a window, never sends a prompt, and never edits your product
repositories.

## What you get

- **A workspace** - a controller directory, separate from your product
  repositories, holding the configuration, the active state and the durable
  ledger.
- **Four window roles** - controller, design, test, and one product window per
  repository. Each is an agent window the Controller launches for you; Wakeflow
  records which is which.
- **Four skills** - `wakeflow-controller`, `wakeflow-design`,
  `wakeflow-target`, `wakeflow-test`. Each window loads the one for its role.
- **Pods** - a second complete window set working in its own worktree (and,
  on Claude Code, in its own tmux session), for running two pieces of work at
  once without them colliding.

## First run

1. Install the plugin, start your agent host in the directory that will be
   the workspace, and ask it to initialize a Wakeflow workspace here. That
   session is the setup session: it asks you a few questions (program name,
   repositories, where the ledger goes), previews the plan, and applies it
   when you say so.
2. It then opens every window itself - Controller, Design, one per product
   repository, Test - and tells you the one thing only you do at each point:
   the command that brings you to those windows, and the trust dialog to
   accept in each.
3. It ends with a handover card: what each window is for, how to move between
   them, how to come back later, and what to do first - go to the Design
   window and describe your first requirement. Then you close the setup
   session; the Controller window is the Controller from now on.

## Daily use

1. In the Design window, work out a requirement with the agent. It reads your
   code read-only, drafts the package, and shows you a one-page summary. You
   confirm it, and it is published to the board.
2. In the Controller window, the agent claims the package, plans the task,
   prepares the delivery and sends it to a product window.
3. The product window does the work, imports its report, and wakes the
   Controller.
4. The Controller reads the result and the evidence, decides, and either sends
   rework or moves on.
5. When everything is accepted, the Demand is completed and archived in one
   transaction.

You are asked to confirm twice: once on the requirement summary, and once on
the task plan when the package asks for it. Nothing is built off a requirement
you did not confirm. Ask the Controller what is next whenever you are unsure;
an idle workspace answers with the Design window and a new requirement.

## Entry points

`/wakeflow:init` sets up or repairs the workspace, `/wakeflow:status` reports where it stands, `/wakeflow:next` takes the next step on the active Demand, and `/wakeflow:pod` creates or closes a pod. Claude Code always namespaces plugin commands, so the `wakeflow:` prefix is part of the name.

Plain language works everywhere: "initialize a workspace here", "what is the
status", "keep going", "open a pod for this".

## Install

1. Install the plugin for your agent host.
2. Make sure your agent host can start `node`: on the `PATH` it launches
   with, or the runtime the host itself supplies (Codex desktop). The plugin's
   tool server and its observation hooks are started as `node`, and a host
   that cannot find it fails silently. Wakeflow needs Node 24.19 or later
   below 25 (other versions are refused with one line on stderr before
   anything runs), `git`, and on Claude Code `tmux`; it supports macOS only
   (a local file system): Linux and Windows are not supported. Claude Code may
   be the native binary or the npm-installed `claude` script: both are recognized.
3. Complete the one-time host actions below.
4. Open your agent in the directory you want as the workspace and say
   "initialize a Wakeflow workspace". The directory must be a Git repository
   of its own (when it is not, the agent offers to run `git init` there for
   you; Wakeflow verifies its `.gitignore` block through Git and reports
   `gitignore-git-repository` otherwise) and must not be a product repository
   root.

Wakeflow keeps a managed block inside the workspace's `CLAUDE.md`.
That block belongs to Wakeflow; everything outside it is yours. A product
repository or an externally owned Design/Test surface gets the same kind of
block in its own `CLAUDE.md` only when its config entry opts in with
`instructionManagement: managed-block`; otherwise Wakeflow never writes there.
While a pod is open, the Controller's host actions also touch each product
repository: a linked checkout for the pod (on Claude Code under the
repository's `.claude/worktrees/`, with a matching line in `.git/info/exclude`)
on the pod's `worktree-<name>` branch. Closing the pod removes the checkout;
the branch and the exclude line stay until you delete them.

## Workspace baseline

This version supports the current workspace format as its first baseline.
Start in a fresh workspace; local files and layouts from earlier development
builds are not upgraded. Keep those folders separately if you need their history.
Normal configuration changes, reconciliation, and recovery of interrupted work
remain available within the current format.

## One-time host actions after install

The first time you start Claude Code in the workspace directory, accept the
workspace trust dialog. Without it neither the plugin's hooks nor the status line
run, so no session is observed and no delivery can be shown to have landed.
`wakeflow_maintain_workspace` writes the status line command into `settings.local.json`
at the workspace root and at the Design and Test surfaces; that entry belongs to Wakeflow
and is kept current. A `statusLine` you configured yourself (one without Wakeflow's
marker) is left alone and shows as `custom` in `wakeflow_status`; that window then has
no Wakeflow label.

You never set tmux up by hand. Start `claude` in the workspace directory and run
`/wakeflow:init`: the Controller creates the tmux session and every window itself through
the helper maintenance installs at
`.wakeflow-local/runtime/hosts/claude-code/operations/assets/tmux.mjs`, tells you the exact
`tmux attach` command once the windows are up (a worktree pod gets its own session,
`<session>-<pod name>`, with its own attach command), and which trust dialogs to accept. It
delivers prompts through the same helper. Maintenance also writes precise allow rules for
that helper and the Wakeflow MCP tools into the workspace root's `.claude/settings.json`,
and every window the helper launches or resumes is started with those two tools allowed,
so product and test windows do not stop at a permission prompt for them either; nothing
broader such as `Bash(tmux *)` is written. A trust dialog for a root Wakeflow wrote
therefore lists only those rules; `Bash(git *)`, `Bash(node *)`, `Bash(tmux *)` or a `..`
directory in that list is 0.9.x residue or the repository's own settings: delete or review
it before accepting, because accepting activates it.

By default every window the helper launches runs in Claude Code's `auto` permission mode:
Claude Code reviews routine actions itself instead of asking you. A window may still ask
you a one-time question the first time, for example whether to allow reads outside its
working directories; the Controller tells you which window is asking. If your account has
no auto mode, ask the Controller to set `hosts.claude-code.launch.permissionMode` to
`acceptEdits` through maintenance; the windows then stop for a permission prompt on
commands.

Both hosts, and the usual reason something is silently missing:

- `node` must be reachable by your agent host - on the `PATH` it launches
  with, or as the runtime it supplies - the same assumption the tool server
  configuration makes.
- When `wakeflow_verify` reports its `host-hook-channel` gate as `absent` or
  `records-0`, check the actions above first. That gate is how Wakeflow knows
  a window really received what was sent to it; without the observation
  records, a delivery can look sent and produce no evidence, and Wakeflow will
  correctly refuse to call it accepted.

## Updating

Updating is two host actions and one Wakeflow read. Refresh the marketplace catalog
with `/plugin marketplace update gxfn` (from a shell: `claude plugin marketplace update
gxfn`), then update the plugin: in a session open `/plugin`, pick Wakeflow under
Installed and choose Update now; from a shell, `claude plugin update wakeflow@gxfn`.
Claude Code replaces the installed copy only when the plugin's manifest version
changed, and every Wakeflow release changes it. Running sessions keep the old hooks and
MCP server until `/reload-plugins` or a new session, so the Controller's
`wakeflow_status` then reports `runtime-artifact-outdated` for its own server and
`windows-stale:<n>` for peer windows started under the previous artifact; the
Controller refreshes them itself through the tmux helper (its skill section "After a
plugin update"). Expect `wakeflow_verify` to pass `runtime-artifact` again once no
window is stale; `unverified` is not a failure.

Within the supported workspace baseline an update needs no workspace migration;
`wakeflow_status` after the update names what is left to do (an outdated server,
stale windows, host assets that `reconcile` repairs). A workspace initialized by
Wakeflow 0.9.x is different: this version refuses it
(`fresh-legacy-residue-present`) and `wakeflow_status` lists the leftovers under
`legacyResidue` - `<!-- wakeflow:scope:start -->` blocks in the instruction
files, broad `Bash(node *)`, `Bash(tmux *)` or `Bash(git *)` rules and the `..`
additional directory in `.claude/settings*.json`, the `workspace.config.json`,
`.workspace-active` and `.wakeflow-publish` root markers, `.wakeflow-stage*`,
`.wakeflow-maintenance-*` and `.wakeflow-create-stage-*` directories, and a
`wakeflow-ledger` directory. Archive or remove them by hand, then initialize
again; 0.9.x Demand history is not migrated. A product repository that an 0.9.x
workspace used carries the same `.claude/settings.json` rules and scope block;
`wakeflow_status` lists them per repository root, and they are deleted before a
window is launched there.

## Checking that it works

Ask for the status. `wakeflow_status` reads every domain at once and names the
next action; `wakeflow_verify` is the strict read, where each gate passes,
fails, or is reported as unavailable. Unavailable is counted separately from
failure on purpose: "we could not check" is never reported as "it is fine".

## What it touches on your machine

- It runs entirely on your machine: a tool server over stdio and the
  observation hooks, both started as `node` by your agent host. It makes no
  network call, sends no telemetry and needs no account.
- Inside the workspace it writes `wakeflow.config.json`, `.wakeflow-active/`,
  `.wakeflow-local/` (runtime state, hook records and the host assets it
  publishes), the ledger directory you chose, the Design and Test surfaces it
  manages, and the managed blocks in `CLAUDE.md` and `.gitignore`.
- Host settings, where the host has them (Claude Code): precise allow rules
  for its own tools and helper in `.claude/settings.json` at the workspace
  root and the managed Design and Test surfaces, and the status line entry in
  `.claude/settings.local.json` in the same three places. Nothing broader, and
  nothing in a product repository.
- Product repositories are read by Design and changed only by a product
  window doing a delivered task; the managed block appears only where the
  repository opted in; a pod adds the linked checkout described under Install.
- Windows, sessions and prompts are host effects your Controller agent
  performs through the host, visible as its own commands; Wakeflow's process
  never performs one.

## What Wakeflow will not do

- Accept work on your behalf. Acceptance is a decision your Controller agent
  records, in its own words, against evidence you can re-read.
- Report a send as delivered without the observation record that proves it
  landed.
- Overwrite a projection file you edited by hand.
- Change a published requirement record. Corrections are new packages.
- Put a credential, a private handle or an absolute local path into a public
  result.
