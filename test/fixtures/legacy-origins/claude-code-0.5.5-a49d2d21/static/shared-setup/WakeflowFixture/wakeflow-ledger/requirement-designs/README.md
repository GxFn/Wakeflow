# Requirement Designs

Status: starter ledger directory
Maintained Window: WakeflowFixture controller

## Purpose

This directory stores requirement-level planning assets for the installed
workspace. It does not replace the active controller index, state roots, task
packages, or per-window evidence records.

Use one subdirectory per substantial demand:

```text
<demand-slug>/
  README.md
  original-plan-YYYY-MM-DD.md
  requirement-design-YYYY-MM-DD.md
  code-implementation-dependency-research-YYYY-MM-DD.md
```

## Workflow

1. Capture the original user/developer goal before designing implementation.
2. Wait for confirmation when the original goal, scope, or completion
   definition is unclear.
3. Ground requirement design in local code facts and any necessary external
   references.
4. Record producer/consumer dependencies, state changes, validation, and
   non-goals.
5. Move toward goal-stage confirmation only after the requirement design is
   reviewable.

## Boundaries

- Requirement designs are not dispatch plans.
- Design candidates are not accepted goals until the controller records that
  decision.
- Current active execution belongs in `.workspace-active/workspace/current/` or
  a Wakeflow state root.
- Per-window completion evidence belongs in the matching window ledger.

## Templates

- `templates/original-plan-template.md`
- `templates/requirement-design-template.md`
- `templates/goal-stage-confirmation-template.md`
