---
name: requirement-design
description: Use in a Wakeflow Design window to turn a clarified and confirmed requirement into a controller-intake-ready requirement design with user stories, decisions, tests, non-goals, and acceptance criteria.
---

# Requirement Design

Write a requirement design that the Wakeflow controller can review, schedule,
and dispatch. This skill turns known context into a structured design; it does
not interview endlessly, publish issues, mutate controller state, or implement
product code.

## Source Skills Used

- `mattpocock/skills/engineering/to-prd`: synthesize conversation and codebase
  understanding into problem, solution, user stories, implementation decisions,
  testing decisions, out-of-scope, and notes.
- `vadimcomanescu/codex-skills/.../agile-product-owner`: INVEST-style stories
  and acceptance criteria.
- `planning-with-files`: separate notes from deliverables and keep references
  explicit.
- Industry basis: ISO/IEC/IEEE 29148-style requirement quality and INVEST
  slicing criteria.

## Preconditions

Use this skill only when at least one of these is true:

- the user has confirmed the clarified requirement;
- the controller asked Design for a requirement design;
- a Design handoff has enough evidence to draft a candidate and clearly mark
  open decisions.

If the goal, scope, or completion evidence is unclear, run
`requirement-clarification` first. If the implementation route is unclear, run
`option-planning` first.

## Interaction First

Default to conversation. Use this skill to draft or review requirement-design
sections with the user, call out gaps, and recommend the next Design or
controller decision before writing any tracked Design artifact.

Do not create or update requirement-design documents, handoff drafts, or board
rows as the first action. Write files only when the user/controller explicitly
asks for a tracked artifact, confirms that the proposed content should be
recorded, or a controller state root assigns a write deliverable. If a write is
justified, state what will be written and why before editing.

## Workflow

1. Gather facts.
   - Conversation and user decisions.
   - Existing Design notes and original plan.
   - Relevant product docs, ADRs, current behavior, and code seams.
   - Current Wakeflow state root or controller document when provided.
2. Respect domain language.
   - Use existing glossary or code vocabulary.
   - Call out conflicts between user language and code/docs.
3. Sketch testing seams before writing the final design.
   - Prefer existing public seams.
   - Use the highest seam that proves observable behavior.
   - If a new seam is needed, justify it.
4. Draft the design as a controller artifact in the conversation.
   - Write a tracked requirement-design document only after explicit
     user/controller confirmation.
5. Mark confirmation status.
   - `confirmed`
   - `candidate`
   - `needs-user-decision`
   - `needs-controller-intake`

## Required Sections

```markdown
# <requirement title>

## Problem

## Goal

## Non-goals

## Primary actors

## User stories

## Proposed behavior

## Implementation decisions

## Testing decisions

## Acceptance criteria

## Risks and open questions

## Controller intake notes

## Source references
```

## Section Rules

- `Problem` is from the user's perspective, not a code-change summary.
- `Goal` must name the observable outcome.
- `Non-goals` must prevent scope drift.
- `User stories` should be extensive enough to cover the meaningful behavior,
  but not padded with duplicate cases.
- `Implementation decisions` may name modules, interfaces, contracts, schema or
  state changes, but avoid brittle file-path inventories unless the path itself
  is part of the decision.
- `Testing decisions` must state what makes a good test for this requirement,
  which seam should be used, and which prior tests or patterns are relevant.
- `Acceptance criteria` must be binary or evidence-backed.
- `Controller intake notes` must state whether Design thinks this is ready for
  task-package planning, user confirmation, option planning, or stop.

## Allowed Outputs

- Conversational requirement-design draft or review.
- Wakeflow Design requirement-design documents.
- Requirement-design candidate sections in a handoff.
- Controller intake notes and open questions.

## Forbidden Outputs

- No issue tracker publishing.
- No `ready-for-agent` or equivalent execution label.
- No product code edits.
- No controller state mutation.
- No invented code facts.
- No unconfirmed Design suggestion marked as executable scope.
- No tracked Design document or board update as the first action without an
  explicit write request or confirmation.

## Quality Bar

The design is good when a controller can decide phase order, affected windows,
producer/consumer dependencies, validation strategy, and user-confirmation needs
without guessing. It fails if it reads like a feature wish list, omits testing
decisions, or cannot be traced back to user goals and evidence.
