# Desktop sessions: the window transport in the Claude desktop app

Read this on Claude Code when the workspace's `hosts.claude-code.windowTransport`
is `desktop`: `wakeflow_status` then lists `desktop.mjs` under `hostAssets`
and the launch intents `wakeflow_register_window_binding` returns carry
`execution.kind: claude-code-desktop`. It is Controller depth for one
transport - what it is, its prerequisites, the helper and its refusals; step 1, the host effect of step 8, the callback, closing a
window, pods and the refresh after a plugin update are in `references/desktop-flow.md`. Everything that does not
depend on the transport stays in `references/workspace-maintenance.md` and `references/windows-and-pods.md`, and
the boundaries are in `SKILL.md`. A workspace on the tmux transport never
reads this file: the two transports are equals, one is chosen per workspace
at the first run, and nothing here is a reason to prefer either. A
`reconfigure` can switch the transport when no Demand is active and no
worktree pod is open; afterwards every window is unregistered, and you
relaunch and register each one with the new transport's helper. Sessions
of the old transport that remain (tmux panes or sidebar sessions) are the
user's to close or archive; name them, do not retire them yourself.

## What the transport is

- Every logical window is one session in the desktop app's Code tab, listed
  in its sidebar under the title the launch intent carries. There is no tmux
  session, no pane and no status line; the sidebar's own markers show whether
  a session is working, has unread output or waits for its user.
- Identity is unchanged: the handle is the hook's session id, the one every
  hook record carries. The desktop id `local_<session id>` is only the
  locator, recorded as `desktop.sessionId` in the creation observation
  exactly as the helper printed it; Wakeflow never derives it from the handle.
- Liveness is the `desktop-sessions` observation you build from the desktop
  `list_sessions` tool - the sidebar's own list, called with a `limit` that
  covers every session (64, the observation's cap): one row per session it
  returns, `sessionId` its id without the `local_` prefix, `desktopSessionId`
  its `local_` id verbatim (always; a session the app created is matched only
  by it), `status` `busy` while it is running and `idle` otherwise, and its
  `archived` flag as the tool reports it. A session whose
  process ended after its turn is still in the sidebar and still present; an
  archived or deleted session is absent. Wakeflow classifies each bound window
  as present and busy, present and idle, or absent; you never judge liveness
  yourself. The helper's `sessions` is only the process view.
- Wakeflow still sends nothing. The helper does the three-step launch, prints
  its process view and waits for landing records; it never sends a prompt,
  never renames, archives or deletes a session, and never runs `claude rm`.
  Listing, sending, setting the mode, titling, grouping and archiving are
  your own calls of the desktop app's session tools, each kept exactly as it
  returned.
- Landing is proven the same way as everywhere: by the target session's
  `user-prompt-submit` hook record whose prompt digest equals the permit's.
  The app's messaging hands the hook the raw prompt, so no unwrapping is
  needed and the rule in `references/planning-and-delivery.md` is unchanged.

## One-time prerequisites (the user's)

The helper and the app can do nothing about these; tell the user which one is
missing, in one sentence, and wait for their word:

- The Claude desktop app is running and signed in with a Claude subscription
  (`claude --desktop` refuses an API-key login). `preflight` and `launch`
  report `desktop-unavailable` otherwise.
- The pseudo-terminal wrapper `script` is on the `PATH` the helper runs with;
  `claude --desktop` refuses redirected output without it
  (`script-unavailable`).
- Claude Code trusts the workspace root and every product repository. Trust
  is a record per repository root in Claude Code's own project list: the
  workspace root's record covers the Design and Test surfaces inside it, a
  Git repository nested in it needs its own. Opening a folder in the desktop
  app does not always write the record, so the root can lack it too. Where
  it is missing `launch` reports `not-trusted` with `trustRoot`, the folder
  that needs the record: collect the refusals, ask the user once about each
  distinct `trustRoot`, and with their agreement record the trust with
  `trust` (below). Trusting a folder is their decision: never open one with
  `claude --desktop` yourself and never pass `--user-agreed` without their
  word. A user who declines opens each folder in the desktop app, or runs
  `claude` in a terminal there, and accepts the dialog.
- One approval per folder for the `auto` permission mode. The helper starts
  the background session in the configured mode, but the app applies the
  folder's remembered mode once it takes the session over, so you set `auto`
  again right after registration (Step 1). The app may show one approval card
  for that; the user approves it once and the folder remembers it. A session
  left on another mode stops for permission prompts and holds cross-session
  messages for approval.

## The helper and its five subcommands

The helper is `desktop.mjs`, published by maintenance under
`.wakeflow-local/runtime/hosts/claude-code/operations/assets/` with an allow
rule exact to its path. Run it from the workspace root as
`node .wakeflow-local/runtime/hosts/claude-code/operations/assets/desktop.mjs
<subcommand>`; from a product or surface window, prefix the path with the
workspace root you were given with `--add-dir`. Every call is its own Bash
command with literal arguments and prints exactly one line of JSON.

### `preflight`

Reports `node` (path, version, whether it is in the supported range),
`claude` (version and install form), `script.available`,
`desktop.appRunning` with `processTable` (`available` or `unavailable`), and
`sessionProven` - whether this session's own session-start record exists.
A setup session is never proven and only bootstraps.

### `launch --window <windowId> [--wait <seconds>] [--wait-session-start <seconds>] [--force]`

Stdin is the inspect result (or its `launchIntent`). The helper checks the
intent (its `execution.kind` must be `claude-code-desktop`; `--session-id`,
`--worktree`, `--bg`, `--resume`, `--name`, `--allowedTools` and `--disallowedTools` must not
be in its arguments - the helper adds what it needs), refuses `locator-live`
while the window's recorded desktop session is still in the sidebar (`--force`
opens a second one anyway; archive or use the live one instead), and then
takes three steps in the intent's root:

1. `claude --bg "<startup prompt>" --name "<title>" <intent arguments>
   --allowedTools <the role's Wakeflow rules and this helper>` (and the managed-path deny rules). The
   startup prompt is fixed: it names the role, the window id and title, says the
   working directory is the execution root, and asks the session to load
   nothing and reply only `ok`; the first real prompt is yours, sent later.
   The host assigns the session id, which the helper reads back from the
   `--bg` output and the session list. It polls that list until the first turn is `done`, up to
   `--wait` seconds (default 120).
2. `claude stop <id>` - a session that is still running cannot be reopened.
3. `claude --desktop --resume <id>` inside a pseudo-terminal, which opens the
   session in the desktop app's Code tab. The helper then waits up to
   `--wait-session-start` seconds (default 30) for a new session-start record
   of that session.

The result carries `observation` (`handle`, `desktop.sessionId`, and for a
worktree pod's product window the git worktree facts) with `observationFile`,
the reference you pass as the registration's `observation`, `created: launched`,
`hook: { sessionStart: "observed" }`, `window` (title and cwd relative to the
workspace root), `background` (the short id, the first turn's state, whether the stop
succeeded), `writeDeny` (rule counts) and `worktreePrepared`. A refusal after the checkout was
prepared still carries `worktreePrepared` and `worktreeBranch`.

### `trust --window <windowId> --user-agreed`

Stdin is the inspect result, as for `launch`. It opens the window's
`trustRoot` in the desktop app with a bare `claude --desktop`, which records
Claude Code's trust for that repository root - no further dialog on the
current app version - and starts no session; one call per distinct
`trustRoot` is enough. Without `--user-agreed` it refuses `consent-required`:
the flag states that the user agreed to trust the folders you named. Success
only says the folder was opened; `launch` the refused windows again - a
second `not-trusted` means the user has to open that folder themselves.

### `sessions`

Prints the process view: one row per session that has a live process, with
the session id, `busy` or `idle`, and the cwd, name and pid it reports, at
most 64 rows (`truncated` says when the list was longer). It is not the
liveness observation: a desktop session's process ends some time after its
turn while the session stays in the sidebar, so a session missing here may
still be present. Use it to see which sessions run right now, for example
while a launch is in progress; liveness for
`wakeflow_register_window_binding` comes from `list_sessions` ("What the
transport is").

### `landing --window <windowId> --prompt-ref <promptRef> [--wait-landing <seconds>]`

Waits up to `--wait-landing` seconds (default 3) for the bound session's
`user-prompt-submit` record of that permit and prints `landed: true` with
`match` (`digest`: the text arrived unchanged; `identity`: the permit id was found in text the host altered), `recordId` and `recordedAt`, or `landed: false`.
It never sends. Use it after every send, and before any second send.

## Refusals and what to tell the user

| `reason` | What it means | What you do |
| --- | --- | --- |
| `not-trusted` | `claude --bg` refused because Claude Code has no trust record for the window's repository root (the refusal's `trustRoot`; `cwd` is the window's folder). | Go on with the other windows, then ask the user once about every distinct `trustRoot`; after their yes `trust --window <windowId> --user-agreed` once per `trustRoot` and `launch` the refused windows again. A user who declines opens that folder in the desktop app (a new session there) or runs `claude` in a terminal there and accepts the trust dialog. |
| `consent-required` | `trust` was called without `--user-agreed`. | Ask the user about the folders first; the flag follows their agreement, never precedes it. |
| `trust-open-failed` | `claude --desktop` did not report opening the folder (`checkout-missing`: a pod window's checkout does not exist yet - `launch` it first). | Ask the user to open that folder in the desktop app and accept the trust dialog. |
| `desktop-unavailable` | The app is not running or not signed in (`stage` says whether at preflight or at the reopen step; the stopped background session keeps its conversation). | Ask the user to start the desktop app and sign in; `launch` again when they say it is up. |
| `script-unavailable` | The pseudo-terminal wrapper `script` is not on the `PATH`. | Tell the user; it is part of macOS, so the `PATH` the host launches with is what to fix. |
| `launch-first-turn-timeout` | The first turn did not finish within `--wait`; the helper stopped the background session. | `launch` again, with a longer `--wait` when the machine is slow. |
| `launch-first-turn-failed` | The first turn ended in a failed state (`state` names it, such as `failed` or `stopped`). | Tell the user which window and state; `launch` again only once the cause is clear. |
| `desktop-resume-refused` | The reopen step did not report `Opening session`: the session was still running or never conversed. | Relay the `detail`; `launch` again. Never try `--resume` yourself. |
| `desktop-session-start-missing` | The app opened the session but no new session-start record arrived in `--wait-session-start`. The refusal carries the handle and `desktop.sessionId`. | Check the sidebar and the `host-hook-channel` gate; if the session is there and the hook channel is healthy, `launch` again with a longer `--wait-session-start`. |
| `locator-live` | The window's recorded desktop session is still in the sidebar. | Send to it or, with the user's authorization, archive it first; `--force` only when the user wants a second session on purpose. |
| `worktree-cwd-mismatch` | The pod window did not start in the prepared checkout. | With the user's authorization archive that session, then `launch` again. |
| `intent-invalid` | The piped intent is not a usable desktop launch intent; `field` names the part (`execution` for another `execution.kind`, `arguments` with the forbidden `argument`, `cwd`, `role`, `worktree`). | Pipe the current inspect result for that window again; a tmux intent here means the workspace's transport is not `desktop` - read `hostAssets` before going on. |
| `prompt-position` | The helper's own check that the startup prompt precedes every variadic argument failed. | Relay it verbatim; it is a helper defect, not something to work around. |
| `worktree-*` and the other codes shared with the tmux helper | Same meaning as in `references/windows-and-pods.md`. | Same action. |

`wakeflow_register_window_binding` refuses on its own side too:
`desktop-session-required` when a register or replace observation lacks
`desktop.sessionId` (register the helper's `observationFile`, never a
hand-built one), `locator-kind-mismatch` when it carries tmux coordinates in
a desktop workspace, and `relocate-not-applicable` for `relocate`.

A refusal this table does not explain - an unfamiliar `reason`, or
`reason: unexpected` with an `errorName` - is relayed to the user verbatim
with its `hint`, `detail` and `causeCode`; then stop: do not retry it, do not
edit files, do not read the helper's source.

## What this transport does not have

No status line and no window-list marks (`statuslineAsset` is empty under
this transport; `hostAssets` lists only `desktop.mjs`); no `resume`,
`self`, `mark`, `panes`, `deliver`, `nudge`, `close` or `teardown`
subcommands and no `relocate` - the desktop app's session tools and the
sidebar take their place; no adoption of a session another process started;
no in-place restart after a plugin update. These are differences of
environment, not of rank: the tmux transport has what tmux offers, this one
has what the desktop app offers, and both are maintained together.
