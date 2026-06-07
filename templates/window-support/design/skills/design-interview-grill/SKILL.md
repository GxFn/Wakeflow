---
name: design-interview-grill
description: Use in a Wakeflow Design window when a proposed requirement, solution, or handoff needs focused challenge questions before it becomes executable scope.
---

# Design Interview Grill

Use this skill to stress-test a Design idea without turning the conversation
into implementation or controller acceptance.

## Inputs

- User goal and the wording they used.
- Current artifact, if any: original plan, requirement design, signal, or
  handoff draft.
- Known evidence and known missing facts.
- Constraints, explicit non-goals, and decisions that must not be changed.

## Method

1. Name the claim being tested in one sentence.
2. Ask focused questions across:
   - user and trigger: who needs this and when;
   - outcome: what changes for the user or operator;
   - behavior: what should happen, not just what should exist;
   - boundaries: what is out of scope or belongs to another window;
   - failure: what bad state must be prevented or surfaced;
   - evidence: what would prove the requirement is complete.
3. Convert answers into four buckets: confirmed, rejected, unknown, and
   decision needed.
4. Recommend the next Design artifact only when the buckets are clear.

## Output

- Tested claim.
- Questions asked and answers received.
- Confirmed scope and non-scope.
- Unknowns that block execution.
- Decision-needed items.
- Suggested next artifact: original plan, requirement design, signal, or
  handoff candidate.

## Stop Conditions

- The question requires product code facts that have not been checked.
- The design would change visible behavior, repository ownership, or phase
  order without user confirmation.
- The output would be only a thin interface, placeholder, or task list without
  user scenario and completion evidence.
