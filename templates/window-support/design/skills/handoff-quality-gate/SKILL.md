---
name: handoff-quality-gate
description: Use in a Wakeflow Design window before creating or registering a workspace handoff so the controller receives a complete, bounded, evidence-backed design signal.
---

# Design Handoff Quality Gate

Use this skill immediately before a Design handoff is recorded.

## Required Handoff Contents

- Stable Design Key and short title.
- User goal and final completion definition.
- Confirmed scope, non-goals, and open decisions.
- Primary scenario, edge cases, and failure/recovery expectations.
- Affected windows or repositories, marked as known or suspected.
- Evidence: user statements, screenshots, code facts, research notes, or
  unknowns that require controller code research.
- Recommended next controller action: intake, ask user, code fact analysis,
  TODO, Test planning, or park.

## Quality Checks

- The handoff does not ask product windows to implement before controller
  intake.
- The handoff does not hide a required user decision as a TODO.
- The handoff distinguishes Design recommendation from final product decision.
- The handoff states what would make the work complete and what evidence would
  be invalid.

## Output

If ready, register the handoff in the local handoff board. If not ready, keep it
as a draft and name the missing decision or evidence.

## References

- GOV.UK Service Manual: https://www.gov.uk/service-manual
- W3C WCAG 2.2: https://www.w3.org/TR/WCAG22/
