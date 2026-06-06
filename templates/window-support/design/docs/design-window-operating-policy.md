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
- Draft original plans, requirement designs, workspace signals, and handoffs.
- Compare architecture options and tradeoffs.
- Identify code-research requests for Wakeflow or source windows.
- Identify whether discussion should return as a bug signal, TODO candidate,
  research request, user decision, or current-mainline blocker.

## Design Requirements

- Original plans record user goal, background, scope, constraints, and
  confirmation questions. Do not write execution phases before confirmation.
- Requirement designs must include user scenario, full functional loop, inputs,
  outputs, state changes, producer, consumer, failure path, repository boundary,
  validation strategy, and completion definition.
- Complex demands must explicitly state whether code-fact research is needed.
- Phases are candidates only; final phase order is set by Wakeflow.
- TODOs, risks, deletion candidates, compatibility retention, validation gaps,
  and preferences must be recorded in design documents or handoff drafts.
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
phase candidates, validation needs, non-goals, and forbidden shortcuts.
