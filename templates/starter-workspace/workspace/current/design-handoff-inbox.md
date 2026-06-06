# Design Handoff Inbox

Status: starter inbox
Maintained Window: Wakeflow controller

## Purpose

This inbox is the controller-facing projection of Design handoff rows that are
ready for workspace intake. It is generated or refreshed from the configured
Design handoff board by Wakeflow intake tooling.

This file is not Global TODO, not a state root, and not an execution plan. The
controller must still decide whether each row enters `global-todo-board.md`, the
current plan `TODO / Backlog`, a requirement-design directory, or no active
work.

## Pending Controller Intake

| ID | Title | Priority | User Confirmation | Current Mainline Relation | Suggested TODO | Original Plan | Requirement Design | Next Step |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

## Intake Boundaries

- Ready rows require independent controller review before dispatch.
- Design recommendations stay recommendations until the controller accepts them
  into the correct ledger.
- Rows that change scope, phase order, completion definition, or user-visible
  behavior require explicit user or developer confirmation before execution.

## Statistics

- Ready for workspace: 0
- Accepted by workspace: 0
- Other statuses: 0
- Validation issues: 0
