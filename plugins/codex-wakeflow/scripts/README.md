# Workspace Scripts

This directory stores Wakeflow-owned scripts for coordination,
verification, documentation maintenance, and cross-repository guardrails.

This is the backend/source-maintenance catalog. Installed workspace
controllers use Wakeflow MCP tools and skills; they should not infer script
paths or flags from this file.

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
  sections written by the state commands' own timeline appends.
- Test exchange docs, the global TODO board, current indexes, archive maps, and
  compact summaries are evidence surfaces; keep them concise and link back to
  the active progress document rather than duplicating it. Design/Test machine
  intake for an active demand belongs under that demand's state root.

Current scripts:

- `wakeflow-cli.mjs`: command-style aggregator for common Wakeflow
  workflows. It maps friendly subcommands such as `status`, `verify`, `sync`,
  `intake`, `runtime`, `install`, `scripts`, `loop`, and `next-work`
  onto the current scripts without replacing their dry-run / write gates. Use
  `--print` to inspect the exact commands before running them.
- `wakeflow-state.mjs`: state-root manager. `init` creates a per-demand
  machine directory from `templates/wakeflow-template-bundle.json` and records
  an immutable demand type plus optional `demand-authority.json`;
  `add-task-package` atomically freezes a complete proportional authority with
  the first typed implementation package when the root began as a draft, then
  validates and writes optional controller-authored
  `{id,claim,probe,expected}` acceptance anchors with the task package, then
  moves an intake / rework demand back to `planned`; `import-target-result`
  stores target-authored result inputs; `reduce-results`
  creates review candidates; `decide-review` records explicit total-control
  judgment; `complete-demand` records the final completion transition after
  explicit controller acceptance decisions; `archive-demand` scans real IDs and user/workspace
  absolute paths before and after staging; `sanitize-archive` applies the same
  guard to one existing archived ledger root while preserving the original.
  It does not dispatch work or parse Markdown as state.
- `wakeflow-demand-sequence.mjs`, `wakeflow-todo.mjs`, and
  `wakeflow-next-work.mjs`: Design delivery and controller-inline creation share
  one demand-authority contract. TODO `Documents`/`Testing Decision` columns are
  projections of that contract; `Auto Claim` affects claiming only.
- `wakeflow-render-progress.mjs`: reads a state root, rebuilds `projection.json`, and
  replaces only the `Unified Status` marker block inside
  `developer-progress.md`.
- `wakeflow-delivery.mjs`: state-root-backed local transport manager. It
  registers real thread ids in the local thread registry, derives window
  configs from workspace config plus registry presence, prepares dispatch
  packets from state roots, builds delivery envelopes, records delivery-run
  facts, records target-authored result envelopes, reviews group readiness, builds
  controller-return envelopes, manages keep-live state, and writes stop
  markers. It does not read current plan Markdown as authority, create legacy
  automation jobs, send host thread messages, verify target truth, or accept results. Runtime
  packets, envelopes, delivery runs, review packs, and thread registry files
  stay under ignored `.wakeflow-local/wakeflow-delivery/` unless an explicit
  state directory is provided.
  `prepare-dispatch-from-state` fails closed for completed / archived / cancelled
  demands, review-ready demands that
  still need a controller decision, blocked demands, and target tasks that are
  already accepted, completed, or blocked. Group-scoped target result files
  keep concurrent controller runs from overwriting each other, and
  `build-controller-return` enforces the dispatch group's return policy:
  `group-ready` permits one pending/accepted controller-return for the dispatch group,
  while `per-target` permits one pending/accepted controller-return per
  trigger target/task pair. Delivery recording requires explicit transport,
  readback status, and attempt count. Only confirmed readback means the
  destination was reached; accepted transport with pending/unavailable
  readback is `sent-unconfirmed`, closes the transport turn, and must not be
  retried or resent automatically. Re-recording the same delivery run or identical target result is an
  idempotent replay and must not advance state again; changed target results
  require explicit `--supersede-result`, which archives the previous envelope
  under local delivery runtime before replacing it. `status` includes a compact
  runtime health block for artifact errors, host-send readiness, review queues,
  controller-return callback readiness, missing target results, stale state-root
  projections, and replay audit issues. Its resume plan separates failed /
  blocked delivery runs, pending host sends, callback-envelope creation,
  target-input inspection, wait-for-result, and pending dispatch as different next
  actions. `review-results`, `review-pack`, and `status` expose a
  `callbackPlan`: `group-ready` waits for all sent target results before one
  group callback, while `per-target` can produce one independent callback per
  completed or blocked target/task and still tracks later siblings. Failed
  delivery commands include a stable `errorCode` plus diagnostics so MCP callers
  can distinguish stale revisions, duplicate callbacks, missing results,
  review-input gaps, thread registration issues, and boundary violations without
  parsing prose.
  `trace-spine` is a read-only evidence lookup that can start from a state root,
  dispatch group, delivery, target, or target result and report the matching
  demand / task package / dispatch / delivery / result / controller-event chain
  without sending messages or making an acceptance decision. Resume plans expose
  a `WakeflowHostSendAdapter` descriptor for Codex app thread dispatch; the
  adapter consumes delivery envelopes, requires one bounded read-only
  observation, records `confirmed` / `pending` / `unavailable`, and never makes
  confirmed visibility a send gate, stores real thread ids, or performs
  controller acceptance.
- `wakeflow-demand-sequence.mjs`: TODO-board claim/create runner. `create-demand`
  inits a demand state root (adopting this host), adds any initial task
  packages, renders the progress doc, and consumes the originating TODO row;
  `claim-todo` auto-claims the single controller-claimable row (Auto Claim =
  yes and eligible) or an explicitly named eligible row by delegating to
  `create-demand`. Ordinary/Auto Claim work is mainline-only and waits while
  mainline is busy. Pod placement requires an explicit authorization anchor;
  active-demand counts never create or reject a Pod. It does not dispatch,
  send session messages, accept evidence, or complete demands.
- `wakeflow-pod.mjs`: host-neutral Pod plan/bind/design-handoff/close/list
  runner. An explicit Pod has independent Controller, Design, Test, and product
  sessions. `open` records launch operations only; it performs no Git or host
  create action. The Agent uses exact Codex projects and
  `create_thread(environment=worktree)` for products, then `bind` verifies
  final-handle cwd/Git receipts. `record-design-handoff` plus every product
  binding publishes `execution-ready`. `close` emits host-close operations and
  `record-close-receipt` closes logical bindings without claiming physical
  worktree deletion. It never dispatches, accepts results, merges, or manages
  Git worktrees.
- `wakeflow-intake.mjs`: state-root intake bridge for the Test surface.
  `test-card` writes a complete pre-test
  boundary machine card under `test-cards/*.json`. It does not mutate
  `wakeflow-state.json`, create dispatches, accept Design handoffs, accept
  test results, or complete demands.
- `wakeflow-setup.mjs`: sibling-directory installation helper. It
  can run the full `initialize` workflow for discovery, user-confirmed
  `wakeflow.config.json` generation, root `AGENTS.md` unpacking, child-window
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
  live under `.wakeflow-active/current/`, that the current index
  target points there, that starter/current tables still match downstream
  readers such as `wakeflow-next-work.mjs`, and that active docs/scripts/templates
  do not reference old root-level short-term paths.
- `wakeflow-archive-docs.mjs`: dry-run by default; moves completed Wakeflow
  documents into `../wakeflow-ledger/workspace/archive/YYYY-MM/<topic>/`,
  rewrites relative links, updates index rows, and refreshes the record map when
  `--apply` is provided.
- `wakeflow-archive-todo.mjs`: dry-run by default; moves completed global
  TODO rows and old sync records from the active TODO board to archive.
- Normal controller archive flows should call the public MCP wrapper
  `wakeflow_archive` (target demand/todo/docs/sanitize-demand). Historical
  demand archives with privacy findings use `target=sanitize-demand`; it
  cannot target active or
  arbitrary directories. The raw
  scripts remain the backend/fallback surface and preserve the same dry-run /
  explicit-apply semantics.
- `wakeflow-next-work.mjs`: read-only by default; scans the configured Design
  handoff board and global TODO board for controller-ready candidates after a
  demand completes. It lifecycle-blocks Design rows whose demand state root is
  already active, completed, or archived, so stale rows cannot be claimed again.
  It never creates a current plan, accepts results, dispatches windows, or
  changes TODO / Design status.
- `wakeflow-todo.mjs`: dry-run by default; `deliver` appends one Design-ready item
  (requirement / bug / supplement / research) to the global TODO board as a
  `pending-claim` row after validating its complete proportional
  `demandAuthority`, setting the immutable Auto Claim property once. Append-only:
  it never edits or re-statuses an existing row. Auto Claim changes unattended
  claim timing only; it never weakens the authority required for that demand type.
- `wakeflow-storage.mjs`: read-only `map` is the local-storage projection
  (`wakeflow_view scope=storage`): every known tree under
  `.wakeflow-active/`, `.wakeflow-local/`, and the ledger with class
  (authority/projection/transport/evidence/handles/preserved), size, and age,
  plus legacy residue, unknown trees, and aging `preserved/` entries.
  `seed-readmes --write` converges the in-place orientation READMEs;
  `preserve --source --reason --write` is the backend for the public
  dry-run-first `wakeflow_storage_preserve` MCP rescue tool (relocates into
  `.wakeflow-local/preserved/<date>-<reason>/` with a MANIFEST.md);
  `prune-preserved [--apply]` lists/deletes preserved entries
  past `preservedRetentionDays` (default 30). It never auto-deletes legacy or
  unknown trees — those route to the user.
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

Use `wakeflow-cli.mjs` as the short entrypoint for backend/source-maintenance
work, then fall back to the named script only when a narrower check is needed. For the full
command catalog and selection table, read
`skills/wakeflow-governance/references/script-pipeline.md`.

| Need | Command |
| --- | --- |
| Current repo / closed-loop health | `node scripts/wakeflow-cli.mjs status` |
| Full Wakeflow verification | `node scripts/wakeflow-cli.mjs verify` |
| Render a controller state-root progress doc | `node scripts/wakeflow-cli.mjs sync --state-root <state-root> --write` |
| Attach Test machine intake to a state root | `node scripts/wakeflow-cli.mjs intake test-card ... --state-root <state-root>` |
| Script docs plus script tests | `node scripts/wakeflow-cli.mjs scripts --tests` |
| Runtime residue read-only check | `node scripts/wakeflow-cli.mjs runtime` |
| Wakeflow Delivery Loop commands | `node scripts/wakeflow-cli.mjs loop <subcommand> ...` |
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
