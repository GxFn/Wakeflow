# First run: initializing a workspace and handing it over

Read this only when there is no workspace here yet (step 0 is a
fresh-initialize) and during the first step 1 that follows it. From the next
session on, the daily path is `SKILL.md` plus `wakeflow_status`; nothing in
this file is repeated in daily use.

## What a first run is

A first run has three parts, and you own all of them: a conversation that
turns the user's answers into the `selection`, one maintenance transaction
that writes the workspace, and a bootstrap that opens the window set and
hands it over. The session you are running in is the setup session. It
exists to do those three things and is closed at the end. It never becomes
the Controller window: that window is launched by you, inside the host's
container, so that every window starts after the workspace's hooks exist and
can prove itself. A setup session cannot prove itself, whether or not it runs
inside the container already.

## Before the first tool call

Run the host preflight the windows reference names and read it back. A missing
or unsupported tool - `node` outside the supported range, or `tmux` or
`claude` unavailable on Claude Code - is the first thing to tell the user,
with the one thing to install; do not start the workspace conversation until
the preflight is clean. The directory must be a Git repository of its own and
must not be a product repository root; if it is not a repository yet, run
`git init` there yourself once the user agrees.

## The conversation

Ask in plain words, one topic at a time, and say what each answer changes. The
user decides; you do not pick silently.

1. Program identity: a display name and one sentence of description. They
   appear in every window title and prompt.
2. Repositories: the product repositories this workspace schedules, each as a
   path relative to the workspace root, beside it (`../Name`) or inside it
   (`Name`). Recommend `owner-managed`: Wakeflow then writes nothing into the
   repository. `managed-block` adds a Wakeflow block to the repository's
   `CLAUDE.md` that every clone sees once committed; offer it only
   when the user asks for it.
3. Surfaces: Design and Test are directories Wakeflow owns; inside the
   workspace is the default and needs no reason.
4. Storage: the ledger root, inside the workspace (`ledger`) unless the user
   wants it beside the workspace.
5. Presentation: the language of generated text, `en` or `zh-Hans`.
6. Hosts: launch preferences under `hosts`, keyed `claude-code` and `codex`:
   `hosts.<host>.launch.modelByRole` and `reasoningEffortByRole` (by role or
   `default`), Claude Code's `launch.permissionMode`, and the Claude Code tmux
   session name `hosts.claude-code.tmux.sessionName` (worktree pods open
   `<name>-<pod name>`). The empty object inherits the tested profile; mention
   it once and move on unless the user has a preference.

Build the `selection` from the tool's input schema - it spells out every part,
`hosts` included - never from another workspace's config or from plugin files.
Preview, show the plan and every blocker in the user's terms, and apply only
after they say to. A refusal names the failing field and rule: fix that field
and preview again instead of asking the user to interpret it.

## The bootstrap

After apply there are windows but nothing running. Follow "Step 1 - Windows
and bindings" in `references/workspace-and-windows.md`; its bootstrap paragraph
is the host procedure and names the host's own steps and prompts. In a first
run the setup session is never proven, so you start the Controller window
first and every other window after it, then register each window from the
observation you kept as soon as the host has started it: a window the host
starts without asking needs no word from the user. The user does at most two
things: open the host's container the way that paragraph says, and answer a
host prompt where one is shown. Only a window whose registration is refused
for a missing record is waiting on such a prompt (or still starting): name
it, wait for their word, and register it again. When every window is
registered, finish the host procedure's last step before the card.

Explain while you wait, do not only report: a host prompt that asks the user
to trust or allow something lists only what that root's own settings
pre-approve - nothing, when Wakeflow wrote the root; a product window only
ever waits for a delivery; registration proves a window by the host's own
record, which is why a window that started before the hooks existed is not
registered but started again.

## The handover card

When every window is registered and `wakeflow_status` names
`requirement-authoring` as the next action: show one card and nothing else: the tmux session name and the one command to get there (the helper's `attach` when the user is outside tmux, its `switch` when they are already inside); the windows in that session, one line each - `Controller` (where they give instructions and ask what is next), `Design` (where a requirement is written with the agent), one window per product repository (where that repository's work happens; it waits for a delivery from the Controller and is never given tasks by hand), `Test` (where the test contract runs); how to move - `Ctrl-b n` next window, `Ctrl-b p` previous, `Ctrl-b s` to pick a session, `Ctrl-b d` to detach while everything keeps running; how to read the window list - a green `●` after a window name means it is working, a red `?` means it is waiting for you, nothing means idle; the hooks write them, a hint and never evidence; long runs - keep the machine awake yourself, Wakeflow runs no background process; what to do first - switch to the Design window and describe the first requirement in plain words, come back to the Controller when Design says the package is published; how to come back later - the same `attach` command, the sessions outlive the terminal; `/wakeflow:status` in the Controller answers "what is next" from then on.

After the card, tell the user to close this setup session. Do not continue the
main flow from here: from now on the Controller window is the Controller.

## What each window is for (said once, on the card)

- Controller: the only window that moves workspace state. The user gives
  instructions here and asks what is next.
- Design: the user and the agent write one requirement package at a time;
  publishing puts it on the board for the Controller to claim.
- Product windows: one per repository. Each receives a delivery, does the
  assigned work inside its checkout, imports a report and wakes the
  Controller. The user never hands them tasks directly.
- Test: runs the frozen test contract against what the product windows
  produced and records what each step observed.

## Daily use starts here

From the second session on the Controller reads `SKILL.md` and `wakeflow_status`
and acts on the step `status` names. An idle workspace names
`requirement-authoring` with the user as owner: point them to the Design
window in one sentence. An outdated server or stale windows name the update
steps. Everything else is a Demand frontier. This file is not read again.
