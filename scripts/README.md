# Workspace Scripts

This directory stores ControlWorkspace-owned scripts for coordination,
verification, documentation maintenance, and cross-repository guardrails.

Scripts in this directory should:

- operate from the workspace root unless documented otherwise;
- avoid secrets, tokens, local absolute paths, and network access by default;
- avoid writing into child source repositories unless the user has confirmed an
  install-scope `AGENTS.md` write or an active controller state root assigns the
  work;
- report clear pass/fail evidence that can be pasted into workspace docs;
- when used by automation, finish with an explicit agent-facing completion cue.
  JSON output should expose `scriptComplete: true` and `agentNext`; text output
  should end with a concise `Agent next:` line. The cue is not a verdict.

Node CLI exit policy:

- Prefer setting `process.exitCode` and letting the event loop drain instead of
  calling `process.exit()` after printing important stdout / stderr.
- Reserve direct `process.exit()` for explicit worker processes after cleanup.
- `check-script-docs.mjs` enforces this policy.
- Long-running background helpers must avoid holding the short-lived CLI open:
  spawn them with ignored stdio, detach only when they intentionally outlive the
  command, call `unref()`, and provide a local stop marker.

Human-facing document policy:

- Users should normally read only the goal / stage confirmation document and the
  single developer progress document for the active controller state root.
- Repeated status surfaces, generated inboxes, format anchors, archive maps, and
  script verification notes should stay script-owned and short.

Script-readable document format:

- New demands start from a controller state root created by
  `controller-state.mjs init`.
- The root contains machine-owned `demand.json`, `controller-state.json`,
  `controller-events.jsonl`, `intake/*.json`, `test-cards/*.json`,
  `task-packages/*.json`, `target-results/*.json`,
  `transition-candidates/*.json`, and one developer-readable
  `developer-progress.md`.
- `developer-progress.md` is not state authority. Scripts may update only its
  `<!-- unified-status:start -->` block via `render-progress-doc.mjs`; task
  packages, backfill summaries, and decisions are append-only timestamped
  sections managed by `append-progress-log.mjs`.
- Design handoff inboxes, test exchange docs, current indexes, archive maps, and
  compact summaries are evidence surfaces; keep them concise and link back to
  the active progress document rather than duplicating it. Design/Test machine
  intake for an active demand belongs under that demand's state root.

Current scripts:

- `workspace-control.mjs`: command-style aggregator for common control-center
  workflows. It maps friendly subcommands such as `status`, `verify`, `sync`,
  `design`, `intake`, `runtime`, `install`, `scripts`, `loop`, and `next-work`
  onto the current scripts without replacing their dry-run / write gates. Use
  `--print` to inspect the exact commands before running them.
- `controller-state.mjs`: state-root manager. `init` creates a per-demand
  machine directory from `templates/control-state-machine/`; `add-task-package`
  writes task package JSON and moves an intake / rework demand back to
  `planned`; `import-target-result` stores result evidence; `reduce-results`
  creates review candidates; `decide-review` records explicit total-control
  judgment; `complete-demand` records the final completion transition after
  accepted task evidence. It does not dispatch work or parse Markdown as state.
- `render-progress-doc.mjs`: reads a state root, rebuilds `projection.json`, and
  replaces only the `Unified Status` marker block inside
  `developer-progress.md`.
- `append-progress-log.mjs`: appends timestamped task-package, backfill, or
  decision entries to allowed developer-readable sections while leaving machine
  state and `Unified Status` untouched.
- `codex-automation-loop.mjs`: state-root-only automation transport manager. It
  registers threads, builds window configs, prepares dispatch packets from
  state roots, builds delivery envelopes, records delivery-run evidence, records
  target result envelopes, reviews group readiness, builds controller-return
  envelopes, manages keep-live state, and writes stop markers. It does not read
  current plan Markdown as authority, create old Codex automations, send host
  thread messages, or accept evidence. `prepare-dispatch-from-state` fails
  closed for completed / archived / paused demands, review-ready demands that
  still need a controller decision, blocked demands, and target tasks that are
  already accepted, completed, or blocked. Group-scoped target result files
  keep concurrent controller runs from overwriting each other, and
  `build-controller-return` fails closed when a dispatch group already has a
  pending or sent controller-return envelope. After a direct-thread delivery run
  is recorded as sent/readback-ok, its agent cue must close the controller
  dispatch turn; it must not tell total control to sleep, poll, or wait in place
  for target results.
- `demand-sequence.mjs`: ordered independent-demand runner. It reads a tracked
  machine manifest whose items point at standard developer demand documents,
  validates each document has exactly one `Unified Status` marker plus the
  append-only sections, claims at most one next demand by creating its ignored
  controller state root and initial task package, and syncs the state-root
  `Unified Status` back into the demand document. It does not dispatch, send
  thread messages, accept evidence, or complete demands.
- `control-intake.mjs`: state-root intake bridge for Design and Test surfaces.
  `design-handoff` validates a formal Design board row and writes
  `intake/design-handoff-*.json`; `test-card` writes a complete pre-test
  boundary machine card under `test-cards/*.json`. It does not mutate
  `controller-state.json`, create dispatches, accept Design handoffs, accept
  test results, or complete demands.
- `control-workspace-install.mjs`: sibling-directory installation helper. It
  can run the full `initialize` workflow for discovery, user-confirmed
  `workspace.config.json` generation, root `AGENTS.md` unpacking, child-window
  access-card sync, internal or external Design/Test support templates, and
  local-only window / thread runtime registration. It also exposes the narrower
  subcommands for discovery, prompts, access profiles, same-repository window
  aliases such as `AlembicTest-IDE` / `AlembicTest`, real-project protection,
  and ledger path inspection.
- `collect-repo-status.mjs`: summarizes branch, HEAD, dirty state, upstream,
  ahead / behind counts, untracked files, and latest commit for each configured
  child repository.
- `check-workspace-boundary.mjs`: verifies that child source repositories and
  local noise files are not tracked by the workspace Git repository.
- `check-repository-residue.mjs`: scans configured child repositories for local
  runtime residue such as `.asd/`, `.cursor/skills`, and `.agents/skills`.
  It is read-only by default; use `--fix` only after confirming generated
  workspace pollution.
- `check-runtime-residue.mjs`: read-only check for BaseWindow daemon, Dashboard
  dev server, and Codex MCP process residue. Use `--strict` only when clean
  runtime surface is required.
- `check-script-docs.mjs`: verifies that every top-level `scripts/*.mjs` file is
  represented in this README, that test scripts appear in workspace script-test
  instructions, that normal CLI scripts do not call direct `process.exit()`, and
  that `verify-control-center.mjs --with-script-tests` runs all `*.test.mjs`
  files.
- `verify-control-center.mjs`: one-command control-center verification. It runs
  workspace boundary, repository residue, repo status, workspace docs, script
  docs, current layout, `git diff --check`, optional runtime residue, and
  optional workspace script tests.
- `verify-workspace-docs.mjs`: checks the workspace index, active state-root
  references, required sections, Markdown links, and completed document
  references.
- `check-workspace-current-layout.mjs`: verifies that short-term workspace docs
  live under `.workspace-active/workspace/current/`, that the current index
  target points there, and that active docs/scripts/templates do not reference
  old root-level short-term paths.
- `archive-workspace-docs.mjs`: dry-run by default; moves completed workspace
  control documents into `../workspace-ledger/workspace/archive/YYYY-MM/<topic>/`,
  rewrites relative links, updates index rows, and refreshes the record map when
  `--apply` is provided.
- `compact-workspace-index.mjs`: dry-run by default; compacts historical rows
  from `.workspace-active/workspace/index.md` into archive topic manifests and
  updates the workspace record map.
- `archive-global-todo-board.mjs`: dry-run by default; moves completed global
  TODO rows and old sync records from the active TODO board to archive.
- `next-control-work.mjs`: read-only by default; scans the configured Design
  handoff board and global TODO board for controller-ready candidates after a
  demand completes. It never creates a current plan, accepts evidence,
  dispatches windows, or changes TODO / Design status.
- `import-design-handoffs.mjs`: imports the configured DesignWindow handoff
  board into the active Design inbox and validates ready rows. It supports
  forward-compatible enum columns while keeping old board prose readable.
- `generate-archive-topic-summaries.mjs`: dry-run by default; creates or
  refreshes archive `index.md` summary files.

Workspace script tests:

Run them through `node scripts/workspace-control.mjs scripts --tests`. The
current set is `archive-global-todo-board.test.mjs`,
`codex-automation-loop.test.mjs`, `collect-repo-status.test.mjs`,
`controller-state.test.mjs`, `control-state-machine-route-fixtures.test.mjs`,
`control-intake.test.mjs`, `demand-sequence.test.mjs`,
`check-repository-residue.test.mjs`, `check-script-docs.test.mjs`,
`control-workspace-install.test.mjs`, `import-design-handoffs.test.mjs`,
`next-control-work.test.mjs`, and
`workspace-control.test.mjs`.

## Common Routes

Use `workspace-control.mjs` as the short entrypoint for ordinary work, then fall
back to the named script only when a narrower check is needed. For the full
command catalog and selection table, read
`skills/control-workspace-governance/references/script-pipeline.md`.

| Need | Command |
| --- | --- |
| Current repo / closed-loop health | `node scripts/workspace-control.mjs status` |
| Full control-center verification | `node scripts/workspace-control.mjs verify` |
| Render a controller state-root progress doc | `node scripts/workspace-control.mjs sync --state-root <state-root> --write` |
| Design handoff discovery / validation | `node scripts/workspace-control.mjs design --id <DESIGN-KEY> --json` |
| Attach Design/Test machine intake to a state root | `node scripts/workspace-control.mjs intake <design-handoff|test-card> ... --state-root <state-root>` |
| Script docs plus script tests | `node scripts/workspace-control.mjs scripts --tests` |
| Runtime residue read-only check | `node scripts/workspace-control.mjs runtime` |
| Codex Automation Closed Loop commands | `node scripts/workspace-control.mjs loop <subcommand> ...` |
| Ordered independent demand sequence | `node scripts/workspace-control.mjs sequence <status|claim-next|sync-doc> --root .. --manifest <manifest.json> ...` |
| Scan next controller-ready candidate | `node scripts/workspace-control.mjs next-work --after-completion --json` |
| Focus a named Design/TODO candidate | `node scripts/workspace-control.mjs next-work --id <DESIGN-KEY> --json` |
| Sibling install / child AGENTS scope writes | `node scripts/workspace-control.mjs install <subcommand> ...` |
| Child window access profile view | `node scripts/workspace-control.mjs install access-profiles --json` |
| One-shot workspace initialization | `node scripts/workspace-control.mjs install initialize --repo BaseWindow=../MyApp --internal-design --internal-test --write --json` |

Run write/apply commands only after the active state root or user request
authorizes the write. Use `--print` on `workspace-control.mjs` when you want to
inspect the underlying script calls before execution.

Real-project test scripts, when an external `TestWindow` exists, live under that
repository's `scripts/` directory so the control workspace root `scripts/`
directory stays focused on governance. Test boundaries for an active demand are
machine cards under that demand's state root; `test-exchange.md` is only a
short human exchange/projection surface when needed.
