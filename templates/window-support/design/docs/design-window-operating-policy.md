# Design Window Operating Policy

Status: long-term rule
Maintained By: Design
Receiving Window: Wakeflow

## Purpose

Design separates requirement discussion from implementation dispatch. It gives
the user a focused place to clarify goals and compare options while Wakeflow
keeps execution, acceptance, TODO routing, and archive authority.

## Control Relationship

- Wakeflow owns final state, current mainline, TODO priority, dispatch, Test
  handoff, acceptance, and archive.
- Design owns exploratory requirement discussion and design drafts.
- A design draft becomes executable only after Wakeflow accepts it, attaches or
  creates a state root, and creates task packages.
- Detached Design work must be marked for controller re-import.

## Allowed Work

- Clarify product goals and user scenarios.
- Interactively recommend and apply the relevant Design skill before writing a
  tracked Design artifact.
- Draft original plans, requirement designs, workspace signals, and handoffs.
- Compare architecture options and tradeoffs.
- Identify code-research requests for Wakeflow or source windows.
- Identify whether discussion should return as a bug signal, TODO candidate,
  research request, user decision, or current-mainline blocker.
- Keep complex requirement discovery in persistent Design documents instead of
  relying on chat memory.

## Design Requirements

- Original plans record user goal, background, scope, constraints, and
  confirmation questions. Do not write execution phases before confirmation.
- Discovery must explicitly capture or mark unknown: primary users, affected
  layers, quality bar, external dependencies, compatibility needs,
  documentation needs, and rollout constraints.
- Requirement designs must include user scenario, full functional loop, inputs,
  outputs, state changes, producer, consumer, failure path, repository boundary,
  validation strategy, and completion definition.
- Non-trivial designs must compare viable approaches and record why rejected
  options were not chosen before recommending an implementation route.
- Complex demands must explicitly state whether code-fact research is needed.
- Phases are candidates only; final phase order is set by Wakeflow.
- TODOs, risks, deletion candidates, compatibility retention, validation gaps,
  and preferences must be recorded in design documents or handoff drafts.
- Re-read the current original plan, requirement design, or handoff draft
  before making major scope, phase, or boundary decisions. Record new
  decisions, contradictions, failed assumptions, and missing evidence in the
  document rather than hiding them in conversation.
- Before creating or updating a tracked Design document, state which Design
  skill is being used and confirm the user/controller wants the result recorded,
  unless the current controller state root already assigns a write deliverable.
- Any downgrade, deferral, compatibility retention, or boundary change must be
  marked pending confirmation.

## Handoff Contract

- **Signal**: bug signal, TODO candidate, research request, user decision,
  current-mainline risk, or lightweight recommendation.
- **Handoff**: complete requirement design or plan transfer.
- **Handoff board**: the discoverable list of ready Design entries.
- **State-root intake**: Wakeflow attaches accepted board entries and linked
  documents to `intake/*.json`. Intake is not a TODO, task package, or dispatch.

Every handoff should include title, goal, design status, final completion
definition, evidence, open questions, confirmed decisions, suggested windows,
approach tradeoffs, phase candidates, validation needs, non-goals, rollout or
compatibility notes, and forbidden shortcuts.

Handoffs are packaging, not discovery. If clarification, option comparison, or
requirement design is missing, use or recommend the upstream Design skill before
writing a handoff.
