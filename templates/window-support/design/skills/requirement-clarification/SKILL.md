---
name: requirement-clarification
description: Use in a Wakeflow Design window when a user idea, controller request, handoff candidate, or product change needs clarification before it can become an original plan, requirement design, TODO candidate, or controller decision.
---

# Requirement Clarification

Turn fuzzy intent into a requirement input the Wakeflow controller can judge.
This skill is for Design windows only. It clarifies and recommends; it does not
dispatch, mutate controller state, implement product code, accept work, or turn
Design advice into a user decision.

## Source Skills Used

- `openai/skills/.curated/define-goal`: measurable outcome, evidence, bounded
  scope, out-of-scope, stop condition, and weak-goal repair.
- `mattpocock/skills/productivity/grill-me`: walk the design tree one dependent
  decision at a time and provide a recommended answer for each question.
- `mattpocock/skills/engineering/grill-with-docs`: challenge terminology,
  concrete scenarios, code/doc contradictions, and ADR-worthy tradeoffs.
- `vadimcomanescu/codex-skills/.../feature-design-assistant`: bounded discovery
  questions covering users, scope, layers, quality bar, and non-goals.
- Industry basis: ISO/IEC/IEEE 29148-style requirement quality, NASA software
  requirement discipline, Double Diamond discovery/definition, and research on
  clarifying questions as costly but useful information-seeking actions.

## Wakeflow Role

Design owns clarification. The controller owns promotion into executable scope.
Use this skill to prepare one of these outputs:

- clarified requirement brief;
- original-plan candidate;
- requirement-design input;
- controller decision questions;
- Design handoff notes.

Do not create task packages, dispatch packets, global TODO rows, state roots, or
target prompts from this skill.

## First Pass

Start by writing a compact interpretation before asking anything:

1. Likely user goal.
2. Known facts from the conversation, current Design docs, current state root,
   product docs, and repository evidence.
3. Missing decisions that would change scope, implementation route, validation,
   risk, or completion.
4. The safest recommended interpretation if the user does not answer.

Ask a question only when a reasonable answer cannot be inferred and the answer
would change the goal, scope, evidence, phase order, repository boundary, or
success bar. If code/docs/state can answer the question, inspect them first.

## Clarification Loop

Work one decision branch at a time.

For each unresolved branch:

1. Name the ambiguity in concrete terms.
2. Explain why it matters to scope, validation, risk, or acceptance.
3. Ask one concise question, or at most four tightly related discovery
   questions in a single round when the user explicitly asks for a full
   clarification pass.
4. Provide a recommended answer and the tradeoff behind it.
5. Stress-test the answer with one concrete scenario or edge case.
6. Check terminology against existing docs, code vocabulary, or Design glossary.
7. If user language conflicts with code or docs, state the conflict and ask
   which source should control.

Useful question shapes:

- "Which observable behavior proves this is done?"
- "Which actor is primary: user, operator, integration, or internal service?"
- "Which layer is allowed to change: data, API, daemon, UI, runtime, docs, or
  test environment?"
- "What is explicitly out of scope for this round?"
- "What should stop execution and return to the controller?"

## Requirement Quality Bar

A clarified requirement is ready for original-plan or requirement-design work
only when it answers:

- What concrete thing will be true when the work is done?
- Who or what benefits from it?
- Which repositories/windows are plausibly affected?
- What evidence will prove completion?
- Which scope boundaries and non-goals matter?
- Which open decisions still require user or controller confirmation?
- What should cause Wakeflow to stop instead of continuing unattended?

Repair weak goals before passing them downstream. Reject pure activity goals
such as "make progress", "continue investigating", "improve this", or "clean it
up" unless they are sharpened into verifiable outcomes.

## Output Contract

Use this structure for a Design note or handoff section:

```markdown
## Clarified Requirement

- Goal:
- Primary actor:
- Current evidence:
- Scope:
- Non-goals:
- Completion evidence:
- Stop conditions:
- Recommended interpretation:
- Open decisions:
- Ready for:
```

`Ready for` must be one of:

- `original-plan`
- `requirement-design`
- `option-planning`
- `controller-decision`
- `not-ready`

## Allowed Outputs

- Design notes under the Design workspace.
- Original-plan or requirement-design candidate text.
- Controller decision questions.
- Handoff-ready clarification summary.

## Forbidden Outputs

- No product code edits.
- No controller state mutation.
- No task package, dispatch packet, or target prompt.
- No global TODO rows.
- No final product decision language.
- No thread ids, secrets, or local runtime identifiers in tracked docs.

## Quality Bar

This skill is successful when a controller can read the result and decide
whether to ask the user, request an option plan, request a requirement design,
or stop. It fails if it only lists generic questions, ignores existing code/docs,
or leaves the completion evidence vague.
