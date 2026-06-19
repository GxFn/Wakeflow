# Wakeflow Ledgers Reference

## Storage Model

Wakeflow repository tracks reusable capability assets only. Installed project
state belongs elsewhere:

- `.wakeflow-active/`: ignored active state roots, current indexes, TODO
  projections, intake, test cards, and progress docs.
- `.wakeflow-local/`: ignored local config, real thread ids (Claude Code
  session ids), delivery loop runtime, and keep-live state.
- `../Design/` and `../Test/`: sibling Design/Test working surfaces when the
  user has not configured external Design/Test repositories.
- `../wakeflow-ledger/`: project-specific long-term plans, decisions, archives,
  and evidence maps.

Do not track product repositories, Design, Test, or real test projects inside
the Wakeflow repository.

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
support surface. Wakeflow accepts them through handoff board intake.

Test plans and reports may live in an external Test repository or internal Test
support surface. Wakeflow links to evidence instead of duplicating execution
details in controller docs.

## Archive

Archive scripts compact historical current-index rows, completed TODOs, and
summary maps into the ledger. They do not make acceptance decisions.
