# Workspace Scripts

This directory stores Wakeflow-owned scripts for coordination,
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
- `wakeflow-check-scripts.mjs` enforces this policy.
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
  `wakeflow-state.mjs init`.
- The root contains machine-owned `demand.json`, `wakeflow-state.json`,
  `controller-events.jsonl`, `projection.json`, and one developer-readable
  `developer-progress.md`. Operation-specific directories such as
  `intake/`, `test-cards/`, `task-packages/`, `target-results/`, `evidence/`,
  and `transition-candidates/` are created lazily only by the command that
  writes real content there.
- `developer-progress.md` is not state authority. Scripts may update only its
  `<!-- unified-status:start -->` block via `wakeflow-render-progress.mjs`; task
  packages, backfill summaries, and decisions are append-only timestamped
  sections managed by `wakeflow-progress-log.mjs`.
- Design handoff inboxes, test exchange docs, current indexes, archive maps, and
  compact summaries are evidence surfaces; keep them concise and link back to
  the active progress document rather than duplicating it. Design/Test machine
  intake for an active demand belongs under that demand's state root.

Current scripts:

- `wakeflow-cli.mjs`: command-style aggregator for common Wakeflow
  workflows. It maps friendly subcommands such as `status`, `verify`, `sync`,
  `design`, `intake`, `runtime`, `install`, `scripts`, `loop`, and `next-work`
  onto the current scripts without replacing their dry-run / write gates. Use
  `--print` to inspect the exact commands before running them.
- `wakeflow-state.mjs`: state-root manager. `init` creates a per-demand
  machine directory from `templates/wakeflow-template-bundle.json`; `add-task-package`
  writes task package JSON and moves an intake / rework demand back to
  `planned`; `import-target-result` stores result evidence; `reduce-results`
  creates review candidates; `decide-review` records explicit total-control
  judgment; `complete-demand` records the final completion transition after
  accepted task evidence. It does not dispatch work or parse Markdown as state.
- `wakeflow-render-progress.mjs`: reads a state root, rebuilds `projection.json`, and
  replaces only the `Unified Status` marker block inside
  `developer-progress.md`.
- `wakeflow-progress-log.mjs`: appends timestamped task-package, backfill, or
  decision entries to allowed developer-readable sections while leaving machine
  state and `Unified Status` untouched.
- `wakeflow-delivery.mjs`: state-root-backed local transport manager. It
  registers real thread ids in the local thread registry, derives window
  configs from workspace config plus registry presence, prepares dispatch
  packets from state roots, builds delivery envelopes, records delivery-run
  evidence, records target result envelopes, reviews group readiness, builds
  controller-return envelopes, manages keep-live state, and writes stop
  markers. It does not read current plan Markdown as authority, create legacy
  automation jobs, send host thread messages, or accept evidence. Runtime
  packets, envelopes, delivery runs, review packs, and thread registry files
  stay under ignored `.workspace-local/wakeflow-delivery/` unless an explicit
  state directory is provided.
  `prepare-dispatch-from-state` fails closed for completed / archived / paused
  demands, review-ready demands that
  still need a controller decision, blocked demands, and target tasks that are
  already accepted, completed, or blocked. Group-scoped target result files
  keep concurrent controller runs from overwriting each other, and
  `build-controller-return` enforces the dispatch group's return policy:
  `group-ready` permits one pending/sent controller-return for the group wave,
  while `per-target` permits one pending/sent controller-return per
  trigger target/task pair. After a direct-thread delivery run is recorded as
  sent/readback-ok, its agent cue must close the controller dispatch turn; it
  must not tell total control to sleep, poll, or wait in place for target
  results. Re-recording the same delivery run or identical target result is an
  idempotent replay and must not advance state again; changed target results
  require explicit `--supersede-result`, which archives the previous envelope
  under local delivery runtime before replacing it. `status` includes a compact
  runtime health block for artifact errors, host-send readiness, review queues,
  controller-return callback readiness, missing target results, stale state-root
  projections, and replay audit issues. Its resume plan separates failed /
  blocked delivery runs, pending host sends, callback-envelope creation,
  evidence review, wait-for-result, and pending dispatch as different next
  actions. `review-results`, `review-pack`, and `status` expose a
  `callbackPlan`: `group-ready` waits for all sent target results before one
  group callback, while `per-target` can produce one independent callback per
  completed or blocked target/task and still tracks later siblings. Failed
  delivery commands include a stable `errorCode` plus diagnostics so MCP callers
  can distinguish stale revisions, duplicate callbacks, missing results,
  evidence gaps, thread registration issues, and boundary violations without
  parsing prose.
  `trace-spine` is a read-only evidence lookup that can start from a state root,
  dispatch group, delivery, target, or target result and report the matching
  demand / task package / dispatch / delivery / result / controller-event chain
  without sending messages or making an acceptance decision. Resume plans expose
  a `WakeflowHostSendAdapter` descriptor for Codex app thread dispatch; the
  adapter consumes delivery envelopes, requires readback, and never stores real
  thread ids or performs controller acceptance.
- `wakeflow-demand-sequence.mjs`: ordered independent-demand runner. It reads a tracked
  machine manifest whose items point at standard developer demand documents,
  validates each document has exactly one `Unified Status` marker plus the
  append-only sections, claims at most one next demand by creating its ignored
  controller state root and initial task package, and syncs the state-root
  `Unified Status` back into the demand document. It does not dispatch, send
  thread messages, accept evidence, or complete demands.
- `wakeflow-intake.mjs`: state-root intake bridge for Design and Test surfaces.
  `design-handoff` validates a formal Design board row and writes
  `intake/design-handoff-*.json`; `test-card` writes a complete pre-test
  boundary machine card under `test-cards/*.json`. It does not mutate
  `wakeflow-state.json`, create dispatches, accept Design handoffs, accept
  test results, or complete demands.
- `wakeflow-setup.mjs`: sibling-directory installation helper. It
  can run the full `initialize` workflow for discovery, user-confirmed
  `workspace.config.json` generation, root `AGENTS.md` unpacking, child-window
  access-card sync, internal or external Design/Test support templates, and
  local-only window / thread runtime registration. It also exposes the narrower
  subcommands for discovery, prompts, access profiles, same-repository window
  aliases such as `<Repo>-IDE` / `<Repo>`, real-project protection, and ledger
  path inspection.
  Discovery returns directory facts only; the Codex agent decides whether the
  workspace is clean enough to pass explicit repository mappings or messy enough
  to ask the user first.
- `wakeflow-repo-status.mjs`: summarizes branch, HEAD, dirty state, upstream,
  ahead / behind counts, untracked files, and latest commit for each configured
  child repository.
- `wakeflow-check-boundary.mjs`: verifies that child source repositories and
  local noise files are not tracked by the workspace Git repository.
- `wakeflow-check-repository-residue.mjs`: scans configured child repositories for local
  runtime residue such as `.asd/`, `.cursor/skills`, and `.agents/skills`.
  It is read-only by default; use `--fix` only after confirming generated
  workspace pollution.
- `wakeflow-check-runtime.mjs`: read-only check for configured runtime process
  residue. Use `--strict` only when clean runtime surface is required.
- `wakeflow-check-scripts.mjs`: verifies that every top-level `scripts/*.mjs` file is
  represented in this README and that normal CLI scripts do not call direct
  `process.exit()`. Development tests live in the repository root `test/`
  directory so the marketplace artifact does not ship test-only subprocess
  fixtures.
- `wakeflow-verify.mjs`: one-command Wakeflow verification. It runs
  workspace boundary, repository residue, repo status, workspace docs, script
  docs, current layout, `git diff --check`, optional runtime residue, and
  optional workspace script tests.
- `verify-workspace-docs.mjs`: checks the workspace index, active state-root
  references, required sections, Markdown links, and completed document
  references.
- `wakeflow-check-layout.mjs`: verifies that short-term workspace docs
  live under `.workspace-active/workspace/current/`, that the current index
  target points there, that starter/current tables still match downstream
  readers such as `wakeflow-next-work.mjs`, and that active docs/scripts/templates
  do not reference old root-level short-term paths.
- `wakeflow-archive-docs.mjs`: dry-run by default; moves completed Wakeflow
  documents into `../wakeflow-ledger/workspace/archive/YYYY-MM/<topic>/`,
  rewrites relative links, updates index rows, and refreshes the record map when
  `--apply` is provided.
- `wakeflow-compact-index.mjs`: dry-run by default; compacts historical rows
  from `.workspace-active/workspace/index.md` into archive topic manifests and
  updates the workspace record map.
- `wakeflow-archive-todo.mjs`: dry-run by default; moves completed global
  TODO rows and old sync records from the active TODO board to archive.
- Normal controller archive flows should call the public MCP wrappers
  `wakeflow_archive_todo` and `wakeflow_archive_workspace_docs`. The raw
  scripts remain the backend/fallback surface and preserve the same dry-run /
  explicit-apply semantics.
- `wakeflow-next-work.mjs`: read-only by default; scans the configured Design
  handoff board and global TODO board for controller-ready candidates after a
  demand completes. It never creates a current plan, accepts evidence,
  dispatches windows, or changes TODO / Design status.
- `wakeflow-import-design-handoffs.mjs`: imports the configured Design handoff
  board into the active Design inbox and validates ready rows. It supports
  forward-compatible enum columns while keeping old board prose readable.
- `wakeflow-archive-summaries.mjs`: dry-run by default; creates or
  refreshes archive `index.md` summary files.
- `wakeflow-smoke.mjs`: plugin-runtime smoke that exercises the controller state root,
  task package, delivery envelope, target result import, review reduction, and
  MCP tools/list + tools/call path.
- `wakeflow-validate.mjs`: repository package-shape validation for Wakeflow plugin
  assets, MCP entrypoint, core runtime scripts, templates, schemas, skills, and
  image assets.
- `wakeflow-runtime.mjs`: controlled fallback runner for Wakeflow runtime
  scripts. `list` prints the allowed backend script set; other commands run a
  named backend script through `lib/wakeflow-runtime.mjs`. Prefer named MCP
  capability tools for normal work.

Workspace script tests:

From the development repository root, run them through `npm run test:wakeflow`
or `node --test test`. The plugin CLI can also discover them in a checkout via
`node plugins/codex-wakeflow/scripts/wakeflow-cli.mjs scripts --tests`. Installed
marketplace artifacts do not include this test directory.

## Common Routes

Use `wakeflow-cli.mjs` as the short entrypoint for ordinary work, then fall
back to the named script only when a narrower check is needed. For the full
command catalog and selection table, read
`skills/wakeflow-governance/references/script-pipeline.md`.

| Need | Command |
| --- | --- |
| Current repo / closed-loop health | `node scripts/wakeflow-cli.mjs status` |
| Full Wakeflow verification | `node scripts/wakeflow-cli.mjs verify` |
| Render a controller state-root progress doc | `node scripts/wakeflow-cli.mjs sync --state-root <state-root> --write` |
| Design handoff discovery / validation | `node scripts/wakeflow-cli.mjs design --id <design-key> --json` |
| Attach Design/Test machine intake to a state root | `node scripts/wakeflow-cli.mjs intake <design-handoff|test-card> ... --state-root <state-root>` |
| Script docs plus script tests | `node scripts/wakeflow-cli.mjs scripts --tests` |
| Runtime residue read-only check | `node scripts/wakeflow-cli.mjs runtime` |
| Wakeflow Delivery Loop commands | `node scripts/wakeflow-cli.mjs loop <subcommand> ...` |
| Ordered independent demand sequence | `node scripts/wakeflow-cli.mjs sequence <status|claim-next|sync-doc> --root .. --manifest <manifest.json> ...` |
| Scan next controller-ready candidate | `node scripts/wakeflow-cli.mjs next-work --after-completion --json` |
| Focus a named Design/TODO candidate | `node scripts/wakeflow-cli.mjs next-work --id <design-key> --json` |
| Sibling install / child AGENTS scope writes | `node scripts/wakeflow-cli.mjs install <subcommand> ...` |
| Child window access profile view | `node scripts/wakeflow-cli.mjs install access-profiles --json` |
| One-shot workspace initialization | `node scripts/wakeflow-cli.mjs install initialize --repo AppWindow=../MyApp --internal-design --internal-test --write --json` |

Run write/apply commands only after the active state root or user request
authorizes the write. Use `--print` on `wakeflow-cli.mjs` when you want to
inspect the underlying script calls before execution.

Real-project test scripts, when an external Test repository exists, live under that
repository's `scripts/` directory so the Wakeflow runtime root `scripts/`
directory stays focused on governance. Test boundaries for an active demand are
machine cards under that demand's state root; `test-exchange.md` is only a
short human exchange/projection surface when needed.
