# Test Operation Policy

Status: long-term rule
Maintained By: Test
Receiving Window: Wakeflow

## Purpose

Test provides real-scenario evidence for work that cannot be safely proven by
the controller or product repository alone.

## When To Use Test

- Cold-start, rescan, clean rebuild, or other real runtime flows.
- Dashboard, jobs API, daemon log, or candidate-output monitoring.
- Smoke, reproduction, or regression checks against real configured projects.
- Cross-repository integration evidence that needs a realistic workspace.

Controller-verifiable script checks, targeted units, probes, runtime JSON, logs,
or minimal reproductions should stay with the controller or owning product repo.

## Configuration

Default test settings may live in `config/defaults.json` inside the Test
surface. One-off differences should be command arguments, not long-term config.
Do not write user absolute paths, secrets, tokens, or temporary ports into
tracked configuration.

## Script Ownership

Real-project test scripts belong in the Test repository or Test surface
`scripts/`. Wakeflow root scripts remain limited to governance, validation,
Design/Test intake, archive, status, and dispatch support.

## Document Ownership

Long-term test plans, reproduction notes, monitoring records, and reports belong
in the Test surface. Cross-repository controller plans stay in the state root and
workspace ledger, linking to Test evidence. `test-exchange.md` is a human
projection only.

## Backfill Requirements

Test backfill must include:

- state root, task package, target task, and test card references;
- test target and entrypoint;
- configuration or key parameters;
- job/session id or UI URL summary;
- state changes and candidate counts;
- key log signals;
- failure/cancel/timeout/completed classification;
- whether real project business code changed;
- residual risks and recommended next step.
