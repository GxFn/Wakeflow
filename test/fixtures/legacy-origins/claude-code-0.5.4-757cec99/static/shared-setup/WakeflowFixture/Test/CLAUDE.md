# Test Window Instructions

This directory is Wakeflow's built-in Test surface. If the user configured an
external Test repository, that repository's `CLAUDE.md` and Wakeflow-managed
access block take precedence. This file is used only when no external Test
repository exists.

## Startup

Read:

1. This file.
2. The parent workspace `../CLAUDE.md`.
3. `../.workspace-active/workspace/index.md`.
4. `../.workspace-active/workspace/current/workspace-current-status.md`.
5. `docs/README.md`.
6. `docs/testing-operation-policy.md`.
7. `docs/current/README.md`.
8. `docs/current/test-window-alignment.md`.
9. `skills/README.md`.

## Role

Test handles real-scenario verification that the controller or product
repository cannot safely reproduce alone, such as:

- real-project cold-start or rescan,
- dashboard or runtime observation,
- daemon/job/log monitoring,
- cross-repository integration smoke,
- reproduction and regression checks.

When a test card, user request, or controller return asks Test to plan
validation, reproduce a bug, design regression coverage, review evidence, or
validate a long chain, proactively recommend the smallest matching Test skill
from `skills/README.md` and use it to shape the work.

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

## Skill Routing

Test skills are first-class evidence methods, not hidden optional docs and not
automatic authority to run broad tests. Before selecting a skill, run a brief
skill-fit check:

1. What exact controller question or user uncertainty needs evidence?
2. Is the missing value a Test method, or can the answer be given directly from
   the assigned state root, test card, and current evidence?
3. If no Test skill is genuinely needed, say so briefly and stay inside the
   assigned test boundary.
4. If a skill is needed or likely useful, name the smallest matching skill,
   explain why it fits, and use or recommend it before running commands,
   writing helpers, or recording backfill.
5. If multiple skills apply, state the sequence and use only the first one
   needed for the current evidence question.

Skill map:

- Validation plan or risk focus: `skills/test-strategy/SKILL.md`.
- Reproduction, isolation, or failure classification:
  `skills/debugging-and-triage/SKILL.md`.
- Behavior-focused regression coverage:
  `skills/regression-design/SKILL.md`.
- Review of target evidence, diffs, reports, logs, or validation output:
  `skills/evidence-review/SKILL.md`.
- Long workflow, source-derived chain plan, node isolation, or scoped round
  verdicts: `skills/progressive-chain-validation/SKILL.md`.

## Local Surfaces

- Use `config/defaults.json` only for generic, secret-free defaults.
- Use `scripts/` for Test-owned helpers that need a real scenario or runtime.
- Use `skills/` only for repeated Test-local validation instructions that do
  not belong in the installed Wakeflow skills or product repositories.
