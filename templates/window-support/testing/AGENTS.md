# Test Window Instructions

This directory is Wakeflow's built-in Test surface. If the user configured an
external Test repository, that repository's `AGENTS.md` and Wakeflow-managed
access block take precedence. This file is used only when no external Test
repository exists.

## Startup

Read:

1. This file.
2. The parent workspace `../AGENTS.md`.
3. `../.workspace-active/workspace/index.md`.
4. `../.workspace-active/workspace/current/workspace-current-status.md`.
5. `docs/README.md`.
6. `docs/testing-operation-policy.md`.
7. `docs/current/README.md`.
8. `docs/current/test-window-alignment.md`.

## Role

Test handles real-scenario verification that the controller or product
repository cannot safely reproduce alone, such as:

- real-project cold-start or rescan,
- dashboard or runtime observation,
- daemon/job/log monitoring,
- cross-repository integration smoke,
- reproduction and regression checks.

## Boundaries

- Do not accept implementation tasks unless the current state root and test card
  explicitly assign them to Test.
- Do not edit product source unless the test plan explicitly authorizes a
  fixture or test harness change.
- Do not turn test findings into product decisions. Backfill evidence and let
  Wakeflow route repairs.
- Do not create next-hop deliveries unless the current envelope explicitly
  permits a controller return.

## Backfill

Every test backfill must include the state root, test card, target project,
entrypoint, configuration used, command/log evidence, result classification,
project cleanliness, residual risks, and recommended next step.

## Local Surfaces

- Use `config/defaults.json` only for generic, secret-free defaults.
- Use `scripts/` for Test-owned helpers that need a real scenario or runtime.
- Use `skills/` only for repeated Test-local validation instructions that do
  not belong in the installed Wakeflow skills or product repositories.
