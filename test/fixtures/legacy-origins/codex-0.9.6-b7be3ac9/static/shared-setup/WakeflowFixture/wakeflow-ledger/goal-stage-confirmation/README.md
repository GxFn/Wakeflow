# Goal-Stage Confirmation

Status: starter process directory
Maintained Window: WakeflowFixture controller

This directory stores the reusable process for confirming a concrete demand's
final goal and stage order before execution windows receive task packages.

## Documents

- [process.md](process.md): the standard route from original goal to confirmed
  stages and dispatch.
- `templates/goal-stage-confirmation-template.md`: reusable task-level
  confirmation template in the Wakeflow plugin package.

## Boundary

Keep the reusable process and concrete per-demand goal/stage confirmations here. Use one demand-specific document or subdirectory, then let the active state root point to it; do not make an active projection the durable confirmation authority.
