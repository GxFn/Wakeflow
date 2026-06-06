# Workspace Document Archive Policy

Status: reusable workflow rule
Maintained Window: Wakeflow controller

Wakeflow keeps the active workspace readable by separating current work from
long-term history.

## Active Area

Keep current state in:

```text
.workspace-active/workspace/
.workspace-active/workspace/current/
```

This area may contain current status, TODOs, Design/Test intake projections,
state roots, task packages, and active plans.

## Long-Term Ledger

Keep durable records in:

```text
workspace-ledger/
workspace-ledger/workspace/
workspace-ledger/workspace/archive/
workspace-ledger/requirement-designs/
workspace-ledger/<WindowName>/
```

## Archive Rules

Archive completed plans, replaced current documents, completed TODO history, and
old dispatch notes only after:

- the current index no longer points at them as active work;
- target evidence has been reviewed;
- TODOs have been rolled or closed;
- the archive map can find the history later.

Do not archive active, blocked, in-progress, or review-needed work.

## Archive Shape

```text
workspace-ledger/workspace/archive/YYYY-MM/<topic>/
  index.md
  ...
```

Archive body files preserve evidence snapshots. Summary maps live in `index.md`
files and `workspace-record-map.md`.
