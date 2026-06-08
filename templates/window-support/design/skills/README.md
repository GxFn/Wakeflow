# Design Skills

These skills are Wakeflow-adapted Design capabilities. They digest mature
external skill patterns into Design-window responsibilities while preserving
the original method strength: clarify requirements, compare options, write
controller-intake-ready designs, propose vertical slices, and hand off evidence.

Design skills do not dispatch implementation, mutate controller state, accept
work, or edit product code unless a controller state root explicitly authorizes
an exception.

## Installed Skills

- `requirement-clarification/SKILL.md`
  - Purpose: turn fuzzy intent into a verifiable requirement input.
  - Sources: OpenAI `define-goal`, Matt Pocock `grill-me` and
    `grill-with-docs`, `feature-design-assistant`, requirement-quality
    standards, and clarifying-question research.
  - Output: clarified goal, scope, evidence, non-goals, stop conditions, and
    decision questions.
- `option-planning/SKILL.md`
  - Purpose: compare multiple implementation or architecture options before
    controller/user confirmation.
  - Sources: `feature-design-assistant`, `senior-architect`, `zoom-out`, and
    architecture decision practice.
  - Output: option comparison, risks, interfaces, validation routes, and
    confirmation questions.
- `requirement-design/SKILL.md`
  - Purpose: write a controller-intake-ready requirement design.
  - Sources: `to-prd`, agile product owner patterns, planning-with-files, and
    requirement-quality standards.
  - Output: problem, goals, non-goals, user stories, implementation decisions,
    testing decisions, acceptance criteria, risks, and source references.
- `work-slicing/SKILL.md`
  - Purpose: propose vertical-slice TODO/task-package candidates from a
    confirmed requirement design.
  - Sources: `to-issues`, INVEST user story criteria, and vertical-slice
    delivery practice.
  - Output: candidate slices with AFK/HITL status, dependencies, user stories,
    validation, and evidence expectations.
- `design-handoff/SKILL.md`
  - Purpose: hand off Design facts, recommendations, risks, and open questions
    to the controller without duplicating full artifacts.
  - Sources: `handoff`, planning-with-files, redaction practice, and Wakeflow
    controller-intake boundaries.
  - Output: concise handoff, source references, suggested next action, and
    suggested skills.

## Quality Standard

Each skill must preserve the mature source method it adapts. Do not reduce a
skill to a short checklist. Deleting or merging logic requires an explicit
reason: role conflict, unavailable tool assumption, duplicated authority,
runtime leakage, no consumer, or complete replacement by another skill.
