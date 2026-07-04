# Wakeflow Ledgers Reference

## Storage Model (three tiers + one map)

Wakeflow repository tracks reusable capability assets only. Installed project
state lives in three tiers, and ONE command explains all of it:
`wakeflow_view scope=storage` — every known tree with its class, size, age,
plus legacy residue, unknown trees, and aging audit holds.

- `.wakeflow-active/`: ignored ACTIVE business state. `index.md` is the single
  controller entry; `current/` holds the status doc, global TODO board,
  test-exchange, and one state root per active demand.
- `.wakeflow-local/`: ignored machine-local runtime — real thread ids,
  the derived config overlay, isolation worktrees, delivery transport, host
  handles, and `preserved/` audit holds. Never committed.
- `../Design/` and `../Test/`: sibling Design/Test working surfaces when the
  user has not configured external Design/Test repositories.
- `../wakeflow-ledger/` (location is `projectLedgerRoot` in
  `wakeflow.config.json` — CHECK THE CONFIG before assuming the sibling
  default): project-specific long-term plans, decisions, archives, and
  evidence maps; version-controlled.

Do not track product repositories, Design, Test, or real test projects inside
the Wakeflow repository.

## Storage Classes (descriptive, never gates)

The storage map classifies every tree; the class answers "may I touch it":

| Class | Meaning | Touch rule |
| --- | --- | --- |
| authority | machine/human truth (state roots, worktrees, ledger) | never hand-delete while active |
| projection | regenerable views (progress docs, window-config, focus docs) | safe to delete; a render rebuilds |
| transport | replay-safe delivery artifacts | GC only via `wakeflow_prune_runtime` |
| evidence | target results | never deleted by any GC |
| handles | host session handles, locks, temp prompts | regenerable; real session ids live here |
| preserved | canonical audit holds under `.wakeflow-local/preserved/` | review, then delete or prune after retention |
| legacy | known residue from older runtimes | fold via `preserve` or delete — after user review |
| unknown | anything else under `.wakeflow-local/` | route to the user; NEVER auto-delete |

In-place orientation: `wakeflow-storage seed-readmes --write` converges short
READMEs at `.wakeflow-active/`, `.wakeflow-local/`, `wakeflow-delivery/`,
`hosts/`, and the ledger root — each answers "what is this / who writes it /
may I touch it" right next to the data. `check-workspace` (Claude edition)
reminds when they are missing or stale.

## Rescue Convention And GC

- The ONE sanctioned manual-rescue move is `wakeflow-storage preserve
  --source <path> --reason <slug> --write`: it relocates the path into
  `.wakeflow-local/preserved/<YYYY-MM-DD>-<reason>/` and writes the
  `MANIFEST.md` (who/why/source/retention). Inventing any other holding
  location recreates the unowned-residue problem this convention exists to
  end.
- `archive-demand --redact` machine-moves the un-redacted original into
  `preserved/<date>-archive-original-<demand>/` after the ledger commit, so
  `current/` stays clean without manual moves.
- GC: `wakeflow_prune_runtime` (transport, default) and
  `wakeflow_prune_runtime target=preserved` (audit holds older than
  `preservedRetentionDays`, default 30) — both dry-run first. Legacy and
  unknown trees are never pruned by any tool; they are surfaced as reminders
  and decided by the user.

## Current Workspace Documents

The installed workspace index is the single active controller entrypoint. It
links current status, current state roots, TODO projections, Design/Test intake,
and archive maps. Active runtime docs are local and usually not committed.

## Long-Term Records

Use the external workspace ledger for:

- requirement designs;
- goal/stage confirmations;
- archived plans;
- completed TODO history;
- test history;
- cross-repository evidence maps;
- per-window function/value records (see Per-Window Folders).

Wakeflow initialization creates starter ledger entries for:

- `wakeflow-ledger/requirement-designs/README.md`;
- `wakeflow-ledger/goal-stage-confirmation/README.md`;
- `wakeflow-ledger/goal-stage-confirmation/process.md`;
- `wakeflow-ledger/workspace/workspace-record-map.md`;
- `wakeflow-ledger/workspace/requirement-to-wave-execution-flow.md`;
- `wakeflow-ledger/workspace/todo-window-scheduling-policy.md`;
- `wakeflow-ledger/workspace/workspace-doc-archive-policy.md`;
- `wakeflow-ledger/workspace/archive/index.md`.

Long-term documents must avoid user absolute paths, API keys, tokens, and other
private information. Use lowercase kebab-case names and dates.

## Per-Window Folders

Each managed window/repository gets its own folder under the ledger
(`wakeflow-ledger/<window>/`). Keep these folders focused on the window's own
function and value documentation — what the window does, its capabilities,
interfaces, integration points, and the durable reference a contributor to that
window needs. They do NOT hold requirement or process-flow documents: requirement
designs, goal/stage confirmations, wave-execution flow, and TODO scheduling stay
in the controller's shared ledger areas (`requirement-designs/`,
`goal-stage-confirmation/`, `workspace/`). A window folder carries the window's
value, not the controller's planning trail.

## Design/Test Records

Design drafts may live in an external Design repository or internal Design
support surface. Wakeflow accepts them through controller TODO delivery via `wakeflow_deliver`.

Test plans and reports may live in an external Test repository or internal Test
support surface. Wakeflow links to evidence instead of duplicating execution
details in controller docs.

## Archive

Archive scripts compact historical current-index rows, completed TODOs, and
summary maps into the ledger. They do not make acceptance decisions.
