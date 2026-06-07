---
name: requirements-framing
description: Use in a Wakeflow Design window when a user request is vague, mixed, or solution-first and needs to become a clear original plan, requirement design, signal, or handoff candidate without starting implementation.
---

# Requirements Framing

Use this skill to convert a fuzzy request into a Design artifact that the
Wakeflow controller can safely receive.

## Inputs

- User goal in the user's own language.
- Current product or workflow context, if known.
- Existing evidence, code facts, screenshots, incidents, or constraints.
- Explicit non-goals, deletion requests, stop requests, or scope reductions.

## Method

1. Restate the user outcome, not just the proposed mechanism.
2. Separate goals, non-goals, assumptions, open questions, and constraints.
3. Identify the primary user scenario and at least one failure or edge scenario.
4. Name affected repositories or windows only when evidence supports them.
5. Define observable completion: user-visible behavior, state/data change,
   accepted evidence, and invalid conclusions.
6. Decide the next Design artifact:
   - original plan for a new or large demand;
   - requirement design for confirmed work;
   - workspace signal for a bug, TODO, or research cue;
   - handoff only when controller intake has enough evidence.

## Output

- Goal and completion definition.
- In scope / out of scope.
- User scenarios and edge cases.
- Evidence already known.
- Unknowns that block execution.
- Recommended artifact and why.

## Stop Conditions

- The request would change product behavior without a user decision.
- The design depends on code facts that have not been checked.
- The output is only an empty interface, placeholder, or handoff without a real
  scenario and completion definition.

## References

- GOV.UK Service Manual: https://www.gov.uk/service-manual
- Nielsen Norman Group usability heuristics: https://www.nngroup.com/articles/ten-usability-heuristics/
