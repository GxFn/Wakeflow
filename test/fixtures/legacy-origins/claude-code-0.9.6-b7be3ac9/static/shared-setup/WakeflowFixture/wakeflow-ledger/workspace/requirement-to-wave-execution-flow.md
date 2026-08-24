# Requirement To Wave Execution Flow

Status: reusable workflow rule
Maintained Window: WakeflowFixture controller

This document keeps the installed workspace from turning large goals directly
into scattered execution prompts. Design discussion, requirement intake,
goal-stage confirmation, task packages, validation, and archive each have a
separate role.

## Mature Route

1. Receive a user/developer goal or Design handoff.
2. Decide whether it affects the current mainline.
3. If it is substantial, create or attach an original plan.
4. Confirm original scope when needed.
5. Build requirement design from local code facts and relevant references.
6. Record implementation dependencies for cross-repository or runtime work.
7. Confirm final goal, non-goals, completion definition, and stage order.
8. Create task packages only for windows that can safely proceed before the next
   real blocker.
9. Send compact direct-thread prompts using the delivery envelope prompt.
10. Import target results, inspect target-authored inputs, and independently validate the relevant behavior.
11. Decide accept, rework, block, next stage, archive, or user confirmation.

## Design Handoff Intake

Design handoff rows are intake candidates, not execution plans. The controller
must place accepted items into the correct ledger before dispatch:

- `global-todo-board.md` for parked or observable work;
- current plan `TODO / Backlog` for work that affects the active mainline;
- `requirement-designs/<demand>/` for substantial demands;
- state-root task packages for confirmed executable work.

## Task Package Rule

Prefer one meaningful same-window package over many tiny prompts when the work
shares one boundary and validation route. Each package must state:

- phase goal;
- mainline action;
- merged TODOs;
- explicit exclusions;
- first blocker;
- validation;
- evidence return requirements;
- required AGENTS/window-positioning gate.

## Verification

Use the smallest validation that proves the changed surface. Do not send Test
work unless a real project, runtime, Dashboard, cold-start/rescan, or other
environment-specific condition is required.
