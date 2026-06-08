# Design Skills

These skills are Wakeflow-adapted Design capabilities. They digest mature
external skill patterns into Design-window responsibilities while preserving
the original method strength: clarify requirements with the user, compare
options, draft controller-intake-ready designs, propose vertical slices, and
hand off evidence.

Design skills do not dispatch implementation, mutate controller state, accept
work, or edit product code unless a controller state root explicitly authorizes
an exception.

## Interaction Contract

Design skills are conversational methods first. When a user asks to improve a
requirement, compare routes, design behavior, slice work, or prepare a handoff,
name the relevant skill and use it in the conversation before writing files.

Before selecting a skill, do a skill-fit check:

- If the user only needs a direct answer, status readout, or small explanation,
  do not invoke a Design skill.
- If the user needs clarification, route comparison, requirement design,
  candidate slicing, or controller handoff packaging, name the smallest matching
  skill and why it applies.
- If a skill is only possibly useful, recommend it as the next method and
  explain the tradeoff; do not silently turn the conversation into document
  production.
- If multiple skills apply, use them in sequence rather than blending them into
  one vague "multi-skill" pass.

Do not create or update tracked Design documents, handoff board rows, or
workspace intake artifacts as the first action. Write files only when the user
or controller explicitly asks for a tracked artifact, confirms that the proposed
content should be recorded, or a controller state root assigns a write
deliverable. If a file write is justified, state what will be written and why
before editing.

When the user asks what Design can help with, answer with this skill map instead
of saying only that documents exist.

## Installed Skills

- `requirement-clarification/SKILL.md`
  - Purpose: turn fuzzy intent into a verifiable requirement input.
  - Sources: OpenAI `define-goal`, Matt Pocock `grill-me` and
    `grill-with-docs`, `feature-design-assistant`, requirement-quality
    standards, and clarifying-question research.
  - Interactive output: clarified goal, scope, evidence, non-goals, stop
    conditions, recommended interpretation, and decision questions.
- `option-planning/SKILL.md`
  - Purpose: compare multiple implementation or architecture options before
    controller/user confirmation.
  - Sources: `feature-design-assistant`, `senior-architect`, `zoom-out`, and
    architecture decision practice.
  - Interactive output: option comparison, risks, interfaces, validation routes,
    recommendation, and confirmation questions.
- `requirement-design/SKILL.md`
  - Purpose: write a controller-intake-ready requirement design.
  - Sources: `to-prd`, agile product owner patterns, planning-with-files, and
    requirement-quality standards.
  - Interactive output: problem, goals, non-goals, user stories, implementation
    decisions, testing decisions, acceptance criteria, risks, and source
    references.
- `work-slicing/SKILL.md`
  - Purpose: propose vertical-slice TODO/task-package candidates from a
    confirmed requirement design.
  - Sources: `to-issues`, INVEST user story criteria, and vertical-slice
    delivery practice.
  - Interactive output: candidate slices with AFK/HITL status, dependencies,
    user stories, validation, and evidence expectations.
- `design-handoff/SKILL.md`
  - Purpose: hand off Design facts, recommendations, risks, and open questions
    to the controller without duplicating full artifacts.
  - Sources: `handoff`, planning-with-files, redaction practice, and Wakeflow
    controller-intake boundaries.
  - Interactive output: concise handoff summary, source references, suggested
    next action, and suggested skills.

## Quality Standard

Each skill must preserve the mature source method it adapts. Do not reduce a
skill to a short checklist. Deleting or merging logic requires an explicit
reason: role conflict, unavailable tool assumption, duplicated authority,
runtime leakage, no consumer, or complete replacement by another skill.
