# Workspace Script Pipeline

Use this reference when maintaining Wakeflow source/runtime scripts, auditing
script contracts, or deciding whether a workflow should become a script.

Installed workspace controllers must use Wakeflow MCP tools as their command
surface. Do not copy Node command examples from this reference into total
control, do not call plugin-cache scripts directly, and do not infer runtime
script parameters. If the required MCP tool is unavailable, stop and report the
plugin-surface blocker instead of falling back to a script path.

## Boundaries

- Packaged top-level scripts are bounded public, maintenance, migration,
  validation, or smoke facades. Domain mutations remain owned by typed v3
  services under `scripts/lib/`; a facade must not become a parallel owner.
- Runtime facades must not implement product features, write into child source
  repositories, edit real test projects, require secrets, depend on network
  access by default, or hide a total-control decision behind automation.
- Write-capable public operations require their exact typed operation and
  preview/apply authority. Explicit migration remains isolated behind the
  unregistered bootstrap launcher and is never a normal fallback.
- Keep user-facing docs scarce: the goal / stage confirmation document and the
  single developer progress document are the main reading surface. Generated
  indexes, inboxes, status mirrors, archive summaries, and script format notes
  should stay script-owned and concise.
- State-machine surfaces must be script-driven. Control flows store machine
  state in `wakeflow-state.json`, events in JSONL, and task packages and target
  results as JSON. The demand document owner regenerates the complete
  `developer-progress.md` projection from those facts and the localized asset;
  no hand-authored Markdown block is source of truth.

## Canonical Asset Ownership

- The two localized demand-progress projection assets are authored only in
  `core/template-sources/`. Rebuild their generated
  `templates/wakeflow-asset-bundle.json` copies through `npm run sync:core`,
  then verify through `npm run check:core`; never edit an artifact bundle or
  reverse-source core content from an installed copy.
- Active index/current-status projections, global TODO content, ledger indexes,
  and root/repository/Design/Test memory are not template-source assets. Their
  domain owners — the workspace projector, TODO service, ledger projectors, and
  rule model — generate and update them under their own state/evidence gates.
- The retired `templates/wakeflow-template-bundle.json` is not a compatibility
  surface. Do not recreate it or source content from it; the only install
  carrier is the generated `templates/wakeflow-asset-bundle.json`.

## Installed Controller MCP Surface

Use these MCP tools for normal installed-workspace control:

| Need | MCP tool |
| --- | --- |
| Workspace maintenance and window identity | `wakeflow_maintain_workspace`, `wakeflow_replace_windows`, `wakeflow_register_window` |
| Demand/status lifecycle | `wakeflow_status`, `wakeflow_create_demand`, `wakeflow_claim_next`, `wakeflow_add_task`, `wakeflow_continue_demand`, `wakeflow_recover_state_transition`, `wakeflow_cancel_demand` |
| Candidate scan and explicit Pod lifecycle | `wakeflow_next_work`, `wakeflow_pod_open`, `wakeflow_pod_bind`, `wakeflow_pod_plan` (design-request, test-access-plan/inspect, close-intent/inspect), `wakeflow_pod_record` (record-materialization, design-handoff, test-access-observe/receipt, close-observe/receipt) |
| Delivery transport | `wakeflow_prepare_delivery`, `wakeflow_record_delivery` |
| Results, review, and completion | `wakeflow_record_target_result`, `wakeflow_review_pack`, `wakeflow_reduce_results`, `wakeflow_decide_review`, `wakeflow_complete_demand` |
| Design and Test intake | `wakeflow_deliver`, `wakeflow_intake_test_card` |
| Evidence, archive, views, storage, verification | `wakeflow_record_evidence`, `wakeflow_archive`, `wakeflow_view`, `wakeflow_storage_preserve`, `wakeflow_prune_runtime`, `wakeflow_verify` |
| Exact target lease release | `wakeflow_release_window_lock` |

## Source Runtime Command Set

The commands below are backend/source-maintenance entrypoints for the Wakeflow
repository. They are not substitutes for an installed controller's MCP surface.

- `wakeflow-cli.mjs` is the exact public 31-tool CLI mirror. It accepts only
  `--request-stdin --json` and one bounded JSON object on stdin:
  `{"tool":"wakeflow_verify","arguments":{"root":"<workspace>","operation":"inspect","request":{}}}`.
- `wakeflow-setup.mjs` is the maintenance-only stdin backend for
  `wakeflow_maintain_workspace`. It accepts the same exact flags and one
  maintenance request; it has no legacy subcommands or discovery/reset aliases.
- `bin/wakeflow-bootstrap` is an unregistered, zero-argv explicit-migration
  launcher. Use it only from the exact installed artifact the user selected;
  it reads one bounded request from stdin and is never a normal CLI/MCP route.
- `wakeflow-validate.mjs` validates the exact public v3 exports, packaging,
  schemas, Skills, and import fences. `wakeflow-smoke.mjs` executes a disposable
  fresh-initialize preview/apply/reconcile plus observability smoke through the
  final public backend.
- Retired writer source is not shipped. Migration tests consume checked-in,
  digest-verified historical output fixtures; production migration code only
  parses and transforms classified legacy material through the bootstrap graph.

## Route Selection

| Need | Primary route | Notes |
| --- | --- | --- |
| Invoke one public tool outside MCP for source verification | `wakeflow-cli.mjs` | Exact bounded stdin mirror of the public 31-tool surface; no subcommand aliases or caller-supplied internal paths. |
| Initialize, reconfigure, or reconcile a workspace | MCP: `wakeflow_maintain_workspace` | Routes through the maintenance-only backend; migration is rejected. |
| Migrate one explicitly selected legacy workspace | `bin/wakeflow-bootstrap` | Zero argv, bounded stdin, preview/apply/recover only; never a package command or MCP route. |
| Inspect workspace health | MCP: `wakeflow_verify operation=inspect` | Read-only strict verdict; it does not authorize repairs. |
| Create a Test boundary card for an active demand | MCP: `wakeflow_intake_test_card operation=create` | Writes one exact authority-bound TestCard. It does not dispatch Test or accept test evidence. |
| Archive one closed demand | MCP: `wakeflow_archive` (`preview/apply/inspect/recover`) | Creates one portable whole-demand BusinessArchive; no secondary docs/TODO archive writer exists. |
| Manage demand state and review | MCP: `wakeflow_create_demand`, `wakeflow_add_task`, `wakeflow_reduce_results`, `wakeflow_decide_review`, lifecycle/recovery tools | Each call routes to one typed v3 owner. Generic transitions cannot forge review/lifecycle changes, and lifecycle preview/apply/recover remains separate from archive. |
| Manage Wakeflow Delivery Loop contracts | MCP: `wakeflow_prepare_delivery`, `wakeflow_record_delivery`, `wakeflow_record_target_result`, `wakeflow_review_pack` | Exact target preview/apply/claim/rearm and Controller preview/apply/pre-send are separate from the host effect. Current group/packet/envelope/run records live under `.wakeflow-local/runtime/shared/transport/demands/<demandId>/`; results stay in demand authority. |
| Inspect and publish the next controller-ready demand | MCP: `wakeflow_next_work operation=inspect`, then `wakeflow_create_demand` | Inspection is read-only. The create owner publishes the root first and atomically claims an exact linked TODO row. Standalone `wakeflow_claim_next` is only a row CAS and is not a demand initializer. |
| Inspect callback/review readiness | MCP: `wakeflow_review_pack operation=group/trace` | The group operation builds a strict deterministic review snapshot; trace is evidence-only. Neither verifies truth nor decides acceptance. |
| Manage direct-thread identity and delivery facts | MCP: `wakeflow_register_window`, `wakeflow_replace_windows`, `wakeflow_record_delivery` | Typed binding is identity authority, window-runtime is a redacted projection, and the exact shared lease serializes target effects. Raw handles are never returned or copied into transport. |

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
3. Make shared changes in `core/`, then run `npm run sync:core` and `npm run
   check:core`; do not maintain generated shared artifact copies independently.
4. Run both artifact validators and the relevant smoke/focused tests.
5. Run `npm test` before declaring the source tree release-ready.

When adding or changing a document format:

1. Update the script-readable format notes in `scripts/README.md` only when the
   script contract changes.
2. Update the canonical source under `core/template-sources/` when one of the
   two localized demand-progress assets changes; other documents stay with their
   domain owner rather than entering the asset bundle.
3. Run `npm run sync:core` and `npm run check:core` so both generated asset
   bundles and shared runtime copies are verified.
4. Run the focused owner tests, both artifact validators/smokes, and the full
   repository gate when the active-state or dispatch boundary is affected.
