---
name: heuristic-design-review
description: Use in a Wakeflow Design window to review a product flow, screen, or requirement against established usability heuristics before controller handoff or implementation planning.
---

# Heuristic Design Review

Use this skill when Design needs a structured UX review without turning the
review into an implementation task.

## Review Frame

- Identify the user, job, entry point, exit point, and expected state change.
- Review the flow against these usability lenses:
  - system status and progress visibility;
  - language that matches the user's world;
  - user control, undo, cancellation, and escape paths;
  - consistency with surrounding product patterns;
  - error prevention, recovery, and helpful messages;
  - recognition over recall;
  - efficiency for repeated users;
  - visual clarity and minimal distraction;
  - accessibility and inclusive interaction;
  - help or guidance only where the interface cannot be self-evident.

## Output

For each finding, write:

- Observation.
- User impact.
- Evidence or screen/flow reference.
- Severity: blocker, high, medium, low.
- Recommendation.
- Whether controller, product code, Test, or user decision owns the next step.

## Boundaries

- Do not prescribe implementation details unless the code facts are known.
- Do not turn a design suggestion into confirmed scope.
- Do not call a preference a blocker unless it affects the completion
  definition, accessibility, reliability, or user task success.

## References

- Nielsen Norman Group: https://www.nngroup.com/articles/ten-usability-heuristics/
- Material Design foundations: https://m3.material.io/foundations
