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
  repository. Each is an agent window you launch; Wakeflow records which is
  which.
- **Four skills** - `wakeflow-controller`, `wakeflow-design`,
  `wakeflow-target`, `wakeflow-test`. Each window loads the one for its role.
- **Pods** - a second complete window set working in its own worktree, for
  running two pieces of work at once without them colliding.

## The flow

1. In the Controller window, ask to initialize the workspace, then launch the
   windows it asks for and let the agent register them.
2. In the Design window, work out the requirement with the agent. It reads your
   code read-only, drafts the package, and shows you a one-page summary. You
   confirm it, and it is published to the board.
3. In the Controller window, the agent claims the package, plans the task,
   prepares the delivery and sends it to a product window.
4. The product window does the work, imports its report, and wakes the
   Controller.
5. The Controller reads the result and the evidence, decides, and either sends
   rework or moves on.
6. When everything is accepted, the Demand is completed and archived in one
   transaction.

You are asked to confirm twice: once on the requirement summary, and once on
the task plan when the package asks for it. Nothing is built off a requirement
you did not confirm.

## Entry points

This host ships no slash commands. Say what you want in plain words; the skill that is loaded routes it to the right tool.

Plain language works everywhere: "initialize a workspace here", "what is the
status", "keep going", "open a pod for this".

## Install

1. Install the plugin for your agent host.
2. Make sure `node` is on your `PATH`. The plugin's tool server and its
   observation hooks are started as `node`, and a shell that cannot find it
   will fail silently.
3. Complete the one-time host actions below.
4. Open your agent in the directory you want as the workspace and say
   "initialize a Wakeflow workspace". The directory must be a Git repository
   of its own (run `git init` there first; Wakeflow verifies its `.gitignore`
   block through Git and reports `gitignore-git-repository` otherwise) and
   must not be a product repository root.

Wakeflow keeps a managed block inside the workspace's `AGENTS.md`.
That block belongs to Wakeflow; everything outside it is yours. A product
repository or an externally owned Design/Test surface gets the same kind of
block in its own `AGENTS.md` only when its config entry opts in with
`instructionManagement: managed-block`; otherwise Wakeflow never writes there.

## One-time host actions after install

Open `/hooks` and trust Wakeflow's four hooks after reviewing them by their
definition hash. Until you do, all four are skipped: no session is observed, so no
window can be registered and no delivery can be shown to have landed. If a plugin
update changes the hook definition bytes, Codex asks you to trust them again -
under a normal update `/hooks` should show nothing of Wakeflow's waiting for review.

Both hosts, and the usual reason something is silently missing:

- `node` must be on the `PATH` your agent host launches with - the same
  assumption the tool server configuration makes.
- When `wakeflow_verify` reports its `host-hook-channel` gate as `absent` or
  `records-0`, check the actions above first. That gate is how Wakeflow knows
  a window really received what was sent to it; without the observation
  records, a delivery can look sent and produce no evidence, and Wakeflow will
  correctly refuse to call it accepted.

## Checking that it works

Ask for the status. `wakeflow_status` reads every domain at once and names the
next action; `wakeflow_verify` is the strict read, where each gate passes,
fails, or is reported as unavailable. Unavailable is counted separately from
failure on purpose: "we could not check" is never reported as "it is fine".

## What Wakeflow will not do

- Accept work on your behalf. Acceptance is a decision your Controller agent
  records, in its own words, against evidence you can re-read.
- Report a send as delivered without the observation record that proves it
  landed.
- Overwrite a projection file you edited by hand.
- Change a published requirement record. Corrections are new packages.
- Put a credential, a private handle or an absolute local path into a public
  result.
