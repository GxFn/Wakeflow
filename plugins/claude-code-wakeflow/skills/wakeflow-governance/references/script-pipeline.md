# Workspace Script Pipeline

Use this reference when maintaining Wakeflow source/runtime scripts, auditing
script contracts, or deciding whether a workflow should become a script.

Installed workspace controllers must use Wakeflow MCP tools as their command
surface. Do not copy Node command examples from this reference into total
control, do not call plugin-cache scripts directly, and do not infer runtime
script parameters. If the required MCP tool is unavailable, stop and report the
plugin-surface blocker instead of falling back to a script path.

## Boundaries

- Workspace scripts are governance tools. They may read workspace docs, inspect
  child repository git status, validate links, maintain the global TODO board,
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

## Installed Controller MCP Surface

Use these MCP tools for normal installed-workspace control:

| Need | MCP tool |
| --- | --- |
| Setup and window registration | `wakeflow_initialize_workspace`, `wakeflow_replace_windows`, `wakeflow_register_window` |
| Demand/status lifecycle | `wakeflow_status`, `wakeflow_create_demand`, `wakeflow_claim_next`, `wakeflow_add_task`, `wakeflow_continue_demand`, `wakeflow_recover_state_transition`, `wakeflow_cancel_demand` |
| Candidate scan and explicit Pod lifecycle | `wakeflow_next_work`, `wakeflow_pod_open`, `wakeflow_pod_bind`, `wakeflow_pod_plan` (action design-request/test-access/close), `wakeflow_pod_record` (event materialization/design-handoff/test-access/close-receipt) |
| Delivery transport | `wakeflow_prepare_delivery`, `wakeflow_record_delivery` |
| Results, review, and completion | `wakeflow_record_target_result`, `wakeflow_review_pack`, `wakeflow_reduce_results`, `wakeflow_decide_review`, `wakeflow_complete_demand` |
| Design and Test intake | `wakeflow_deliver`, `wakeflow_intake_test_card` |
| Archive, views, maintenance, verification | `wakeflow_archive` (including target=sanitize-demand), `wakeflow_view` (including scope=progress/pods), `wakeflow_storage_preserve`, `wakeflow_prune_runtime`, `wakeflow_verify` |
| Host ownership and target work leases | `wakeflow_adopt_demand_host`, `wakeflow_release_window_lock` |

## Source Runtime Command Set

The commands below are backend/source-maintenance examples for the Wakeflow
repository. They are not the installed controller command surface.

- Aggregated command surface:
  `node scripts/wakeflow-cli.mjs status`
  `node scripts/wakeflow-cli.mjs status --json`
  `node scripts/wakeflow-cli.mjs verify`
  `node scripts/wakeflow-cli.mjs sync --state-root <state-root> --write`
  `node scripts/wakeflow-cli.mjs scripts --tests`
  `node scripts/wakeflow-cli.mjs loop status --json`
  `node scripts/wakeflow-cli.mjs next-work --after-completion --json`
  `node scripts/wakeflow-cli.mjs next-work --id <design-key> --json`
  `node scripts/wakeflow-cli.mjs intake test-card --state-root <state-root> --test-id <id> --target-window <window> ... --write --json`
  `node scripts/wakeflow-cli.mjs loop build-delivery --write --json`
  `node scripts/wakeflow-cli.mjs loop review-results --json`
  `node scripts/wakeflow-state.mjs init --write --json`
  `node scripts/wakeflow-state.mjs add-task-package --write --json`
  `node scripts/wakeflow-state.mjs import-target-result --write --json`
  `node scripts/wakeflow-state.mjs reduce-results --write --json`
  `node scripts/wakeflow-state.mjs decide-review --write --json`
  `node scripts/wakeflow-state.mjs complete-demand --write --json`
  `node scripts/wakeflow-state.mjs archive-demand --redact --write --json`
  `node scripts/wakeflow-state.mjs sanitize-archive --state-root <archived-root> --reason <text> --write --json`
  `node scripts/wakeflow-delivery.mjs prepare-dispatch-from-state --write --json`
  `node scripts/wakeflow-delivery.mjs review-pack --json`
- General pre-acceptance:
  `node scripts/wakeflow-verify.mjs`
- Test state-root intake:
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
| Validate current docs stay under `.wakeflow-active/current/` and remain readable by downstream scripts | `wakeflow-check-layout.mjs` | Read-only layout and current-doc contract guard. |
| Create a Test boundary card for an active demand | `wakeflow-intake.mjs test-card` | Writes `test-cards/*.json` under the state root. It requires the full pre-test boundary gate and does not dispatch Test or accept test evidence. |
| Archive completed Wakeflow docs and shrink historical indexes | MCP: `wakeflow_archive` (target=docs / target=todo); backend scripts: `wakeflow-archive-docs.mjs`, `wakeflow-archive-todo.mjs`, `wakeflow-archive-summaries.mjs` | Use MCP for normal controller archive flows. Dry-run first; apply only after current status no longer points at the archived item. |
| Keep script catalog and tests from drifting | `wakeflow-check-scripts.mjs` | Runs inside `wakeflow-verify`; add tests to `--with-script-tests`. |
| Manage the controller state root | `wakeflow-state.mjs`, `wakeflow-render-progress.mjs` | Default route for execution surfaces. `wakeflow-state` owns machine state, review candidates, explicit review decisions, final completion, privacy-guarded demand archive, and the bounded `sanitize-archive` amendment for an existing archived root; `wakeflow-render-progress` updates only the generated Unified Status block. |
| Manage Wakeflow Delivery Loop contracts | `wakeflow-delivery.mjs`, `wakeflow-cli.mjs loop ...` | Runtime files stay under ignored `.wakeflow-local/wakeflow-delivery/`; the script derives packets and envelopes from the state root, then writes dispatch packets, groups, envelopes, delivery runs, review packs, controller-return envelopes, stop markers, and thread registry files (registered thread ids are Claude Code session ids) in the local delivery runtime. The script never performs the host send; the agent runs envelope-aware `wakeflow-claude-host deliver --delivery-file` against the target's tmux-resident window. It also never accepts results, selects TODOs, or writes product repositories. |
| Scan next controller-ready demand after completion | `wakeflow-next-work.mjs`, `wakeflow-cli.mjs next-work ...` | Read-only by default. It ranks controller-ready rows on the global TODO board (including rows Design delivered via `wakeflow_deliver`) into a candidate list, but never creates a current plan, accepts a candidate, dispatches windows, or changes TODO board state. Use `--id <design-key>` when the user names a specific ready demand. |
| Reduce repeated controller dispatch preparation | `wakeflow-delivery.mjs prepare-dispatch-from-state` | Use only after total control has chosen an eligible target task inside the controller state root. It writes a derived window config, dispatch packet, dispatch group, and delivery envelope in one step, then stops before the host send (the agent runs `wakeflow-claude-host deliver --delivery-file`). It fails closed for terminal / paused / blocked / review-ready demands and accepted / completed / blocked target tasks. |
| Reduce repeated callback review setup | `wakeflow-delivery.mjs review-pack` | Read-only. It wraps `review-results` with target-authored claims, artifact pointers, structural gaps, delivery-run status, and controller-return status so total control can inspect review inputs without manually opening every local envelope first. It does not verify truth and is not an acceptance verdict. Empty state-root target lists return `no-target-tasks`, not review-ready. |
| Manage direct-thread child-window config and delivery facts | `wakeflow-delivery.mjs register-thread`, `build-window-config`, `record-delivery-run`, `keep-live-state` | `register-thread` writes the host-local registry and refreshes its derived window config in one operation, but only an explicit `entrySyncStatus=ready` makes a new handle dispatchable; pending/failed remain registered facts. Delivery-run facts and keep-live state stay under ignored local runtime. They describe sendability and transport observations only; total control still owns the state root, delivery decision, target-input inspection, independent validation, and acceptance verdict. |

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
2. Update the relevant template entry in `templates/wakeflow-template-bundle.json`.
3. Run the focused state-root tests for the affected route.
4. Run `node scripts/wakeflow-verify.mjs --with-script-tests` when the
   active state root or dispatch boundary is affected.
