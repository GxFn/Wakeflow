# Clarification

Use this method to turn fuzzy intent into a verifiable Design input. Ask only
questions whose answers can change the goal, scope, route, evidence, risk, or
completion bar.

## Preserved Method

- Define a concrete outcome, actor, evidence, scope, non-goals, and stop
  conditions.
- Inspect assigned code, docs, and existing evidence before asking the user for
  facts that can be established read-only.
- Walk one dependent decision branch at a time and recommend an answer with its
  tradeoff.
- Challenge ambiguous terminology with a concrete scenario and record any
  code/doc contradiction.
- Repair activity goals such as "improve it" or "continue" into observable
  outcomes.

## Workflow

1. State the likely goal and primary actor.
2. List verified evidence, assumptions, contradictions, and unknowns.
3. Identify only the decisions that affect scope, validation, risk, ownership,
   or success.
4. For each consequential decision:
   - explain why it matters;
   - ask one concise question;
   - give a recommended answer and tradeoff;
   - stress-test it with one real scenario or edge case.
5. Reconcile the answers into the output contract.
6. Mark the result `not-ready` if an unanswered decision would force the
   controller or product window to guess.

## Output Contract

```markdown
## Clarified Requirement

- Goal:
- Primary actor:
- Current evidence:
- Assumptions:
- Contradictions:
- Scope:
- Non-goals:
- Completion evidence:
- Stop conditions:
- Recommended interpretation:
- Confirmed decisions:
- Open decisions:
- Ready for: original-plan | option-planning | requirement-design | controller-decision | not-ready
```

## Quality Gate

- The goal names an observable outcome, not an activity.
- Evidence and assumptions are distinct.
- Scope and non-goals prevent obvious expansion.
- Every question changes a consequential decision.
- Stop conditions say when to return instead of guessing.

Do not create controller records, TODO rows, execution packages, or product
changes from this method. Its output remains Design input until the confirmation
and delivery gates in the parent Skill are satisfied.
