# Artifact Layout

A progressive-chain-validation run writes records under `scratch/chain-runs/<run-id>/`. This directory is temporary development evidence, not product runtime data.

## Plan-Centric Layout

```text
scratch/chain-runs/<run-id>/
  report/
    plan.md
  attachments/        # optional, only when inline evidence would make plan.md unreadable
  fixtures/           # optional disposable fixtures for focused node tests
  temp-tests/         # optional disposable tests/harnesses, never imported by production code
```

## Rules

- `report/plan.md` is the primary and only required run artifact.
- The plan contains run metadata, safe write boundary, source chain map, reference alignment, benchmark review, node state, per-node design/test plans, execution log, final outcome, and handoff notes.
- Inline evidence in the plan when it is short enough to read.
- Put large command output, binary snapshots, generated JSON reports, or bulky machine output in `attachments/` only when necessary.
- Every attachment needs a short summary and link from the relevant plan section.
- Do not create separate manifest, node-state, chain-map, alignment, skill-review, command-log, round, or final-report files by default.
- `fixtures/` and `temp-tests/` are disposable and must not be imported by production code.
- Do not write run artifacts to project documentation directories unless the user explicitly asked for a durable document.
- Do not write run artifacts to this internal Skill directory.
- Do not use `scratch/chain-runs/` as a user project runtime data root.
- For startup, render `report/plan.md` first, fill its N0/path section before runtime writes, and keep later node state updates inside the plan.

## Run ID

Use:

```text
pcv-YYYYMMDD-HHMM-<target-slug>
```

Example:

```text
pcv-20260506-1430-checkout-flow
```

## Plan Metadata Shape

Keep this metadata at the top of `report/plan.md` instead of a separate manifest:

```text
Run ID:
Target:
Owner:
Started at:
Current node:
Write boundary:
Allowed attachments:
```
