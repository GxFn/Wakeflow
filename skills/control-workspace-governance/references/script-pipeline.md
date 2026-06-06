# Workspace Script Pipeline

Use this reference when auditing ControlWorkspace scripts, choosing validation
commands, refreshing Design handoff intake, or deciding whether a workflow
should become a script.

## Boundaries

- Workspace scripts are governance tools. They may read workspace docs, inspect
  child repository git status, validate links, import Design handoff ledgers,
  maintain archive docs, and manage controller state roots.
- Workspace scripts must not implement product features, write into child source
  repositories, edit real test projects, require secrets, depend on network
  access by default, or hide a total-control decision behind automation.
- Write-capable scripts must default to dry-run or explicit check mode, require
  an explicit write/apply flag, and keep writes inside workspace-owned docs
  unless the active controller state root explicitly authorizes more.
- Keep user-facing docs scarce: the goal / stage confirmation document and the
  single developer progress document are the main reading surface. Generated
  indexes, inboxes, status mirrors, archive summaries, and script format notes
  should stay script-owned and concise.
- State-machine surfaces must be script-driven. Control flows store machine
  state in `controller-state.json`, events in JSONL, task packages and target
  results as JSON, and render only the `Unified Status` block inside
  `developer-progress.md`. Do not hand-author explanatory status strings as the
  source of truth.

## Default Command Set

- Aggregated command surface:
  `node scripts/workspace-control.mjs status`
  `node scripts/workspace-control.mjs status --json`
  `node scripts/workspace-control.mjs verify`
  `node scripts/workspace-control.mjs sync --state-root <state-root> --write`
  `node scripts/workspace-control.mjs scripts --tests`
  `node scripts/workspace-control.mjs loop status --json`
  `node scripts/workspace-control.mjs next-work --after-completion --json`
  `node scripts/workspace-control.mjs next-work --id <DESIGN-KEY> --json`
  `node scripts/workspace-control.mjs intake design-handoff --state-root <state-root> --design-key <DESIGN-KEY> --write --json`
  `node scripts/workspace-control.mjs intake test-card --state-root <state-root> --test-id <id> --target-window <window> ... --write --json`
  `node scripts/workspace-control.mjs loop build-delivery --write --json`
  `node scripts/workspace-control.mjs loop review-results --json`
  `node scripts/controller-state.mjs init --write --json`
  `node scripts/controller-state.mjs add-task-package --write --json`
  `node scripts/controller-state.mjs import-target-result --write --json`
  `node scripts/controller-state.mjs reduce-results --write --json`
  `node scripts/controller-state.mjs decide-review --write --json`
  `node scripts/controller-state.mjs complete-demand --write --json`
  `node scripts/codex-automation-loop.mjs prepare-dispatch-from-state --write --json`
  `node scripts/codex-automation-loop.mjs review-pack --json`
- General pre-acceptance:
  `node scripts/verify-control-center.mjs`
- Design formal handoff intake:
  `node scripts/import-design-handoffs.mjs --write`
  `node scripts/import-design-handoffs.mjs --id <DESIGN-KEY> --json`
- Design/Test state-root intake:
  `node scripts/control-intake.mjs design-handoff --state-root <state-root> --design-key <DESIGN-KEY> --write --json`
  `node scripts/control-intake.mjs test-card --state-root <state-root> --test-id <id> --target-window <window> ... --write --json`
- Runtime residue inspection:
  `node scripts/check-runtime-residue.mjs`
  `node scripts/verify-control-center.mjs --with-runtime`
- Script maintenance:
  `node scripts/check-script-docs.mjs`
  `node scripts/verify-control-center.mjs --with-script-tests`

## Script Selection

| Need | Primary script | Notes |
| --- | --- | --- |
| Choose a common control-center workflow without memorizing script flags | `workspace-control.mjs` | Aggregates existing scripts only; it does not replace total-control decisions or bypass write/apply gates. Use `--print` before unfamiliar flows. |
| Know child repo branches, dirty state, and commits | `collect-repo-status.mjs` | Read-only; useful before acceptance or cross-repo planning. |
| Ensure workspace git tracks only workspace files | `check-workspace-boundary.mjs` | Read-only guard against accidentally tracking child repos or local noise. |
| Validate workspace docs and links | `verify-workspace-docs.mjs` | Use `--all-workspace` through `verify-control-center`. |
| Validate current docs stay under `.workspace-active/workspace/current/` | `check-workspace-current-layout.mjs` | Read-only layout guard. |
| Import formal Design handoff board into workspace inbox | `import-design-handoffs.mjs --write` | Discovers and validates ready rows, not a global TODO or execution plan. |
| Attach an accepted Design source to an active demand | `control-intake.mjs design-handoff` | Writes `intake/design-handoff-*.json` under the state root after total-control judgment. It validates the Design board row but does not accept the handoff, add TODO, or change controller state. |
| Create a TestWindow boundary card for an active demand | `control-intake.mjs test-card` | Writes `test-cards/*.json` under the state root. It requires the full pre-test boundary gate and does not dispatch TestWindow or accept test evidence. |
| Archive completed control docs and shrink historical indexes | `archive-workspace-docs.mjs`, `compact-workspace-index.mjs`, `archive-global-todo-board.mjs`, `generate-archive-topic-summaries.mjs` | Dry-run first; apply only after current status no longer points at the archived item. |
| Keep script catalog and tests from drifting | `check-script-docs.mjs` | Runs inside `verify-control-center`; add tests to `--with-script-tests`. |
| Manage the controller state root | `controller-state.mjs`, `render-progress-doc.mjs`, `append-progress-log.mjs` | Default route for execution surfaces. `controller-state` owns machine state, review candidates, explicit review decisions, and final completion transitions; `render-progress-doc` updates only the generated Unified Status block; `append-progress-log` appends human-readable entries without changing state. |
| Manage Codex Automation Closed Loop contracts | `codex-automation-loop.mjs`, `workspace-control.mjs loop ...` | Runtime files stay under ignored `.workspace-local/codex-automation-loop/`; the script creates state-root dispatch packets, delivery envelopes, target result envelopes, group readiness summaries, review packs, and stop markers. It never sends host thread messages, accepts evidence, selects TODOs, or writes product repositories. |
| Scan next controller-ready demand after completion | `next-control-work.mjs`, `workspace-control.mjs next-work ...` | Read-only by default. It combines Design ready handoffs and global TODO candidates into a ranked candidate list, but never creates a current plan, accepts a candidate, dispatches windows, or changes Design / TODO state. Use `--id <DESIGN-KEY>` when the user names a specific ready demand. |
| Reduce repeated controller dispatch preparation | `codex-automation-loop.mjs prepare-dispatch-from-state` | Use only after total control has chosen an eligible target task inside the controller state root. It writes the window config, dispatch packet, dispatch group, and delivery envelope in one step, then stops before host thread send. It fails closed for terminal / paused / blocked / review-ready demands and accepted / completed / blocked target tasks. |
| Reduce repeated callback review setup | `codex-automation-loop.mjs review-pack` | Read-only. It wraps `review-results` with target result evidence pointers, delivery-run status, and controller-return status so total control can pull raw evidence without manually opening every local envelope first. It is not an acceptance verdict. Empty state-root target lists return `no-target-tasks`, not review-ready. |
| Manage direct-thread child-window config and delivery evidence | `codex-automation-loop.mjs build-window-config`, `record-delivery-run`, `keep-live-state` | Child-window config, delivery-run evidence, and keep-live state stay under ignored local runtime. They describe sendability and transport evidence only; total control still owns the state root, delivery decision, evidence pull, and acceptance verdict. |

## When To Extract A New Script

Create or extend a workspace script when a workflow is repeated, mechanical,
evidence-producing, and bounded by existing total-control decisions. Prefer a
script over hand editing when it can prevent stale indexes, missed coverage
rows, broken links, or copy/paste drift.

Do not create a script when the work requires product design judgment,
producer / consumer sequencing, acceptance of a window backfill, TODO priority
decisions, or a real-project test action. In those cases, document the decision
first, then automate only the mechanical follow-up if it repeats.

## Maintenance Checklist

When adding, renaming, or deleting a script:

1. Update `scripts/README.md`.
2. Add, adjust, or delete focused `*.test.mjs` coverage when the script
   transforms docs, enforces safety, or protects a known workflow.
3. Keep the test list in `verify-control-center.mjs --with-script-tests`
   aligned with actual `*.test.mjs` files.
4. Run `node scripts/check-script-docs.mjs`.
5. Run `node scripts/verify-control-center.mjs --with-script-tests` when the
   change affects more than README text.

When adding or changing a document format:

1. Update the script-readable format notes in `scripts/README.md` only when the
   script contract changes.
2. Update the relevant template in `templates/`.
3. Run the focused state-root tests for the affected route.
4. Run `node scripts/verify-control-center.mjs --with-script-tests` when the
   active state root or dispatch boundary is affected.
