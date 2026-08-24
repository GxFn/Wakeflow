# TODO And Backlog Reference

TODO/Backlog is a scheduling ledger, not the source of the user goal.

## Intake

Add an item only when it has:

- a stable id;
- a real user goal or verified defect;
- source requirement authority: original plan, requirement design,
  user/controller decision, or verified defect inside confirmed scope;
- an owner candidate;
- priority;
- current-mainline relation;
- evidence status;
- dependency or trigger;
- reason it belongs in TODO instead of the active state root.

Design signals and handoffs are candidates until the controller reviews and
routes them.

Code facts, target backfill, Test output, residual fields, and implementation
leftovers are evidence, not requirement authority. Before adding a TODO from
them, read the full original plan / requirement design and confirm the item is
not excluded by a decision, non-goal, or forbidden shortcut. If authority is
unclear, record a pending decision or risk instead of new work.

## Rolling TODOs

When accepting or archiving work:

- close solved TODOs with controller validation references;
- keep valid remaining TODOs with updated blockers;
- add newly found TODOs with validation references and original-requirement authority;
- explain why an observed issue does not enter TODO.

Do not close a TODO from script output alone. Inspect the relevant inputs and
run the required independent checks.

## Dispatch Use

Several authorized TODO rows may inform one coherent TaskPackage only when they
share the same responsibility window, boundary, objective, and validation path
before the next real blocker. The controller translates them into the package's
typed context and expectations; the schema has no TODO `items` collection and
the package does not become a second TODO ledger. Do not fragment dispatch only
to move counters.

## Archive

Completed demand-owned TODO history is preserved through the typed
`wakeflow_archive` preview/apply/inspect/recover flow. Active or observing rows
remain under the TODO service's current authority. Long-term history belongs in
the portable BusinessArchive and workspace ledger projections.
