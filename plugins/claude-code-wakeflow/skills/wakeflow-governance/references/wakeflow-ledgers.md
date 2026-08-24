# Wakeflow Storage And Ledgers Reference

## One Storage View, Distinct Authorities

Use `wakeflow_view` with `operation: "storage"` for a read-only map. The view
is diagnostic: it reports known managed trees, legacy residue, unknown entries,
and preservation facts, but it never authorizes a write or deletion.

Wakeflow v3 separates four responsibilities:

- `wakeflow.config.json`: the only tracked program/topology/storage/governance/
  host desired model. It uses typed IDs; titles are presentation only.
- `.wakeflow-active/`: ignored current business authority and its human
  projections, including demand state, immutable artifacts, events, results,
  evidence, and the canonical TODO authority.
- `.wakeflow-local/`: ignored machine-local identity, coordination, transport,
  host operations/evidence, maintenance journals, and typed audit preservation.
- the configured ledger root: durable requirement designs and portable
  whole-demand BusinessArchives.

Product repositories and Design/Test support surfaces remain separate
repositories or configured support directories; they are not nested as
Wakeflow-owned local data.

Wakeflow v3 does not seed explanatory README files into these trees. Installed
behavior is defined by `CLAUDE.md`, Skills, schemas, and the responsible
program owner. A directory's presence is never authority by itself.

## `.wakeflow-local` Responsibilities

The local tree is partitioned by responsibility:

| Area | Responsibility | Important boundary |
| --- | --- | --- |
| `runtime/maintenance/transactions/` | one recoverable workspace-mutation journal | never bypass with a second maintenance state machine |
| `runtime/shared/coordination/window-leases/` | exact current target-effect leases | historical delivery/result cannot release a successor lease |
| `runtime/shared/transport/demands/<demandId>/` | immutable groups, packets, envelopes, and runs | no TargetResult duplicate store; no mtime/latest selection |
| `runtime/hosts/claude-code/identity/window-bindings/` | typed binding and private raw session handle | only binding owners write; never copy handle into transport/docs |
| `runtime/hosts/claude-code/projections/window-runtime/` | redacted regenerable runtime view | projection is not identity or config authority |
| `runtime/hosts/claude-code/evidence/` | typed Pod/host receipts | evidence does not decide business acceptance |
| `runtime/hosts/claude-code/operations/` | locator, activity, temporary prompt, and effect material | host-scoped and non-portable |
| `audit/preserved/<preservationId>/` | isolated, manifest-bound retained bytes | normal runtime never reads payload as authority |

Legacy `.wakeflow-local/wakeflow-delivery/**`, thread-registry, window-config,
window-host, local result, stop-marker, and old preservation layouts are
explicit-migration inputs only. Normal v3 code and the v3 host adapter do not
fall back to them.

## Demand Information Lifecycle

| Information | Active authority | Durable outcome |
| --- | --- | --- |
| requirement goal/design | configured ledger/support document refs pinned by the demand authority | referenced by the BusinessArchive without inventing another requirement copy |
| task/Test authority | immutable TaskPackage and TestCard artifacts plus state selectors | exact artifacts included in the whole-demand archive |
| transport | local strict group → packet → envelope → run chain | summarized by digest; eligible for whole-demand transport retention only after archive and lease closure |
| target results | immutable results plus current/historical selectors in demand state | retained in BusinessArchive; never deleted by transport GC |
| decisions/lifecycle | append-only controller events plus state snapshot | archived with exact conclusion and lineage |
| imported evidence | managed evidence manifest/payload under the active demand | privacy-checked portable archive member or explicit local preservation reference |

Human progress/status documents are projections. They help navigation but do
not override event, artifact, result, binding, transport, or config authority.

## Preservation

`wakeflow_storage_preserve` is the only normal rescue/release owner:

1. `operation=inspect` reads the typed inventory.
2. `operation=preview` creates a zero-write preservation plan for an exact
   caller-confirmed source.
3. `operation=apply` accepts only that confirmed plan/digest and publishes an
   opaque typed `preservationId` entry.
4. Release starts with `operation=preview-release`; apply/recover use the exact
   returned plan. Release is never inferred from age.

Unknown local trees always route to the user. Do not auto-delete, invent a
quarantine directory, or treat a copied payload as current authority. Preserved
payload remains isolated until the explicit release owner succeeds.

## Archive And Retention

`wakeflow_archive` owns one portable whole-demand BusinessArchive with exact
`preview`, `apply`, `inspect`, and `recover` operations. It does not expose
docs/TODO/sanitize targets and does not reopen or accept a demand. Privacy,
typed IDs, current/historical results, event lineage, and local preservation
references are revalidated by the owner before commit.

An already-polluted legacy archive is migration input, not a public in-place
sanitize operation. Never hand-edit it or move it back into current state.

`wakeflow_prune_runtime` owns only whole-demand transport retention through
`preview`, `apply`, and `recover`. It requires the matching BusinessArchive and
closed lease/result dependencies. Audit-preserved bytes are released only by
`wakeflow_storage_preserve`; they are not a prune target.

## Pod Host Evidence

Pod scope, launch intents/materialization events, creation receipts, Test-access
plans/receipts, and close intents/receipts are typed facts below
`runtime/hosts/claude-code/evidence/pods/<podId>/`. The current binding remains
under the host identity tree. `control-ready` and `execution-ready` are derived
from strict state plus exact receipts; a suffix, prompt, path, or live tmux pane
is not a binding.

Claude close is machine-verifiable only when the exact close effect and the
absence probe both succeed. Logical close, tmux/session close, and physical
worktree cleanup remain separate facts. Unknown evidence stays blocked.

## Durable Documents

Keep requirement designs, user decisions, completion definitions, non-goals,
and long-lived evidence maps in the configured ledger/support surfaces. Use
workspace-relative anchors, typed IDs, and portable paths. Never store secrets,
raw host handles/locators, user-home/workspace absolute paths, or machine cache
paths in durable documents or BusinessArchives.
