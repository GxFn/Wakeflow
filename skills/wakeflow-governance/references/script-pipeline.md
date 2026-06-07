# Workspace Script Pipeline

Use this reference when auditing Wakeflow scripts, choosing validation
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
  state in `wakeflow-state.json`, events in JSONL, task packages and target
  results as JSON, and render only the `Unified Status` block inside
  `developer-progress.md`. Do not hand-author explanatory status strings as the
  source of truth.

## Default Command Set

- Aggregated command surface:
  `node scripts/wakeflow-cli.mjs status`
  `node scripts/wakeflow-cli.mjs status --json`
  `node scripts/wakeflow-cli.mjs verify`
  `node scripts/wakeflow-cli.mjs sync --state-root <state-root> --write`
  `node scripts/wakeflow-cli.mjs scripts --tests`
  `node scripts/wakeflow-cli.mjs loop status --json`
  `node scripts/wakeflow-cli.mjs next-work --after-completion --json`
  `node scripts/wakeflow-cli.mjs next-work --id <DESIGN-KEY> --json`
  `node scripts/wakeflow-cli.mjs intake design-handoff --state-root <state-root> --design-key <DESIGN-KEY> --write --json`
  `node scripts/wakeflow-cli.mjs intake test-card --state-root <state-root> --test-id <id> --target-window <window> ... --write --json`
  `node scripts/wakeflow-cli.mjs loop build-delivery --write --json`
  `node scripts/wakeflow-cli.mjs loop review-results --json`
  `node scripts/wakeflow-state.mjs init --write --json`
  `node scripts/wakeflow-state.mjs add-task-package --write --json`
  `node scripts/wakeflow-state.mjs import-target-result --write --json`
  `node scripts/wakeflow-state.mjs reduce-results --write --json`
  `node scripts/wakeflow-state.mjs decide-review --write --json`
  `node scripts/wakeflow-state.mjs complete-demand --write --json`
  `node scripts/wakeflow-delivery.mjs prepare-dispatch-from-state --write --json`
  `node scripts/wakeflow-delivery.mjs review-pack --json`
- General pre-acceptance:
  `node scripts/wakeflow-verify.mjs`
- Design formal handoff intake:
  `node scripts/wakeflow-import-design-handoffs.mjs --write`
  `node scripts/wakeflow-import-design-handoffs.mjs --id <DESIGN-KEY> --json`
- Design/Test state-root intake:
  `node scripts/wakeflow-intake.mjs design-handoff --state-root <state-root> --design-key <DESIGN-KEY> --write --json`
  `node scripts/wakeflow-intake.mjs test-card --state-root <state-root> --test-id <id> --target-window <window> ... --write --json`
- Runtime residue inspection:
  `node scripts/wakeflow-check-runtime.mjs`
  `node scripts/wakeflow-verify.mjs --with-runtime`
- Script maintenance:
  `node scripts/wakeflow-check-scripts.mjs`
  `node scripts/wakeflow-verify.mjs --with-script-tests`

## Script Selection

| Need | Primary script | Notes |
| --- | --- | --- |
| Choose a common Wakeflow workflow without memorizing script flags | `wakeflow-cli.mjs` | Aggregates existing scripts only; it does not replace total-control decisions or bypass write/apply gates. Use `--print` before unfamiliar flows. |
| Know child repo branches, dirty state, and commits | `wakeflow-repo-status.mjs` | Read-only; useful before acceptance or cross-repo planning. |
| Ensure workspace git tracks only workspace files | `wakeflow-check-boundary.mjs` | Read-only guard against accidentally tracking child repos or local noise. |
| Validate workspace docs and links | `verify-workspace-docs.mjs` | Use `--all-workspace` through `wakeflow-verify`. |
| Validate current docs stay under `.workspace-active/workspace/current/` and remain readable by downstream scripts | `wakeflow-check-layout.mjs` | Read-only layout and current-doc contract guard. |
| Import formal Design handoff board into workspace inbox | `wakeflow-import-design-handoffs.mjs --write` | Discovers and validates ready rows, not a global TODO or execution plan. |
| Attach an accepted Design source to an active demand | `wakeflow-intake.mjs design-handoff` | Writes `intake/design-handoff-*.json` under the state root after total-control judgment. It validates the Design board row but does not accept the handoff, add TODO, or change controller state. |
| Create a Test boundary card for an active demand | `wakeflow-intake.mjs test-card` | Writes `test-cards/*.json` under the state root. It requires the full pre-test boundary gate and does not dispatch Test or accept test evidence. |
| Archive completed Wakeflow docs and shrink historical indexes | `wakeflow-archive-docs.mjs`, `wakeflow-compact-index.mjs`, `wakeflow-archive-todo.mjs`, `wakeflow-archive-summaries.mjs` | Dry-run first; apply only after current status no longer points at the archived item. |
| Keep script catalog and tests from drifting | `wakeflow-check-scripts.mjs` | Runs inside `wakeflow-verify`; add tests to `--with-script-tests`. |
| Manage the controller state root | `wakeflow-state.mjs`, `wakeflow-render-progress.mjs`, `wakeflow-progress-log.mjs` | Default route for execution surfaces. `wakeflow-state` owns machine state, review candidates, explicit review decisions, and final completion transitions; `wakeflow-render-progress` updates only the generated Unified Status block; `wakeflow-progress-log` appends human-readable entries without changing state. |
| Manage Wakeflow Delivery Loop contracts | `wakeflow-delivery.mjs`, `wakeflow-cli.mjs loop ...` | Runtime files stay under ignored `.workspace-local/wakeflow-delivery/`; the script derives packets and envelopes from the state root, then writes dispatch packets, groups, envelopes, delivery runs, review packs, controller-return envelopes, stop markers, and thread registry files in the local delivery runtime. It never sends host thread messages, accepts evidence, selects TODOs, or writes product repositories. |
| Scan next controller-ready demand after completion | `wakeflow-next-work.mjs`, `wakeflow-cli.mjs next-work ...` | Read-only by default. It combines Design ready handoffs and global TODO candidates into a ranked candidate list, but never creates a current plan, accepts a candidate, dispatches windows, or changes Design / TODO state. Use `--id <DESIGN-KEY>` when the user names a specific ready demand. |
| Reduce repeated controller dispatch preparation | `wakeflow-delivery.mjs prepare-dispatch-from-state` | Use only after total control has chosen an eligible target task inside the controller state root. It writes a derived window config, dispatch packet, dispatch group, and delivery envelope in one step, then stops before host thread send. It fails closed for terminal / paused / blocked / review-ready demands and accepted / completed / blocked target tasks. |
| Reduce repeated callback review setup | `wakeflow-delivery.mjs review-pack` | Read-only. It wraps `review-results` with target result evidence pointers, delivery-run status, and controller-return status so total control can pull raw evidence without manually opening every local envelope first. It is not an acceptance verdict. Empty state-root target lists return `no-target-tasks`, not review-ready. |
| Manage direct-thread child-window config and delivery evidence | `wakeflow-delivery.mjs register-thread`, `build-window-config`, `record-delivery-run`, `keep-live-state` | `register-thread` writes only the local thread registry. Child-window config is a derived runtime view from workspace config plus registry presence; delivery-run evidence and keep-live state stay under ignored local runtime. They describe sendability and transport evidence only; total control still owns the state root, delivery decision, evidence pull, and acceptance verdict. |

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
3. Keep the test list in `wakeflow-verify.mjs --with-script-tests`
   aligned with actual `*.test.mjs` files.
4. Run `node scripts/wakeflow-check-scripts.mjs`.
5. Run `node scripts/wakeflow-verify.mjs --with-script-tests` when the
   change affects more than README text.

When adding or changing a document format:

1. Update the script-readable format notes in `scripts/README.md` only when the
   script contract changes.
2. Update the relevant template in `templates/`.
3. Run the focused state-root tests for the affected route.
4. Run `node scripts/wakeflow-verify.mjs --with-script-tests` when the
   active state root or dispatch boundary is affected.
