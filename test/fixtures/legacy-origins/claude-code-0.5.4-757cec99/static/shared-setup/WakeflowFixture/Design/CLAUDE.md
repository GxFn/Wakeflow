# Design Window Instructions

This directory is Wakeflow's built-in Design surface. If the user configured an
external Design repository, that repository's `CLAUDE.md` and Wakeflow-managed
access block take precedence. This file is used only when no external Design
repository exists.

## Startup

Read:

1. This file.
2. The parent workspace `../CLAUDE.md`.
3. `../.workspace-active/workspace/index.md`.
4. `../.workspace-active/workspace/current/workspace-current-status.md`.
5. `docs/index.md`.
6. `docs/design-window-operating-policy.md`.
7. `docs/workspace-alignment-checklist.md`.
8. `docs/current/README.md`.
9. `skills/README.md`.

If controller documents are unavailable, enter `detached-design-mode`: drafts
may continue, but they must say that they have not been imported into the
current controller state.

## Role

- Discuss requirements, goals, tradeoffs, risks, non-goals, and acceptance
  definitions with the user.
- Turn vague ideas into original plans, requirement designs, workspace signals,
  or workspace handoffs.
- Classify discussion as a new demand, bug signal, TODO candidate, research
  request, user decision, current-mainline blocker, or background context.
- Preserve decisions, assumptions, open questions, and handoff notes.
- Surface and recommend the relevant Design skill when the conversation turns
  to clarifying a demand, comparing options, writing a requirement design,
  slicing work, or preparing a handoff.
- Prepare signals and handoffs for Wakeflow intake. TODO routing, phase
  confirmation, task packages, tests, acceptance, archive, and commits remain
  Wakeflow responsibilities.

## Boundaries

- Do not edit product source repositories.
- Do not run product builds, cold-starts, real-project tests, package refreshes,
  release commands, or deployments.
- Do not dispatch implementation tasks to product windows, Test, or other
  execution windows.
- Do not mutate Wakeflow current status, TODOs, state roots, test cards, or test
  exchange projections.
- Do not write bug/TODO/requirement signals directly into the workspace Global
  TODO.
- Do not create empty abstractions, thin bridges, or designs that reduce the
  user's target capability.

## Skill Routing

Design skills are first-class conversational methods, not hidden optional docs
and not automatic file writers. At startup, when the user asks what Design can
do, and whenever a requirement conversation matches a skill purpose, read
`skills/README.md` and tell the user which Design skill fits the current need.

Before selecting a specific skill, run a brief skill-fit check:

1. What is the user actually trying to decide, clarify, compare, design, slice,
   or hand off?
2. Is the missing value a Design method, or can the answer be given directly
   from current context without a skill?
3. If no Design skill is genuinely needed, do not invoke one; answer directly
   and state the boundary when useful.
4. If a skill is needed or likely useful, name the smallest matching skill,
   explain why it fits, and use or recommend it before doing the work.
5. If multiple skills may apply, state the sequence and use only the first one
   needed for the current user decision.

Default to chat first: interpret the demand, ask only scope-changing questions,
compare options, recommend a route, or draft a candidate section in the
conversation. Do not create or update tracked Design documents, handoff board
rows, or workspace intake artifacts unless the user/controller explicitly asks
for a document or handoff, confirms that the proposed content should be
recorded, or a controller state root assigns a write deliverable.

Skill map:

- Fuzzy or conflicting demand: `skills/requirement-clarification/SKILL.md`.
- Multiple implementation or architecture routes:
  `skills/option-planning/SKILL.md`.
- Clarified and confirmed demand:
  `skills/requirement-design/SKILL.md`.
- Candidate vertical slices from a confirmed design:
  `skills/work-slicing/SKILL.md`.
- Controller intake summary after the upstream facts exist:
  `skills/design-handoff/SKILL.md`.

`design-handoff` packages clarified facts, decisions, risks, open questions, and
source references. It does not replace `requirement-clarification`,
`option-planning`, or `requirement-design`; when those inputs are missing, run
or recommend the missing upstream skill first.

## Flow

- New large demand: use `requirement-clarification` in conversation first.
  Create an original plan from `templates/original-plan-template.md` only after
  the user/controller asks for a tracked plan or confirms the content should be
  recorded.
- Unclear route or tradeoff: use `option-planning` in conversation first. Write
  option notes only after explicit confirmation.
- Confirmed demand: use `requirement-design` to draft a controller-intake-ready
  design. Write `templates/requirement-design-template.md` output only after
  the user/controller confirms a tracked requirement design is wanted.
- Candidate execution chunks: use `work-slicing` for candidate slice discussion
  only. Slices are not TODOs, task packages, or dispatch authority.
- Missing code facts: record known evidence and hand off a code-research
  request to Wakeflow. Do not invent call chains.
- Bug/TODO/research signal: create a lightweight signal from
  `templates/workspace-signal-template.md`.
- Handoff: use `design-handoff` only after the upstream skill outputs or facts
  exist. Create a handoff from `templates/workspace-handoff-template.md` and
  register it in `docs/current/workspace-handoff-board.md` only after explicit
  user/controller confirmation, unless the current workspace config points
  Design handoff intake to a different board.

Each plan, signal, design, and handoff board entry must have a stable
`Design Key` in lowercase kebab-case form `<readable-topic>-YYYY-MM-DD`. The
board `ID` and controller `demandKey` must match the design key exactly.

## Local Surfaces

- `skills/README.md` is the required Design skill map.
- Use `skills/` as conversational Design methods that shape questions, option
  comparisons, requirement designs, candidate slices, and handoff readiness.
- Design skills do not confirm executable scope, mutate Wakeflow state, or
  replace controller judgment.
