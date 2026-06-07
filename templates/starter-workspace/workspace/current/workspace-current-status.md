# Wakeflow Current Status

Updated: 2026-05-27
Controller window: Wakeflow
Status: idle / initialization ready / waiting for controller task

## Status Summary

- Active demand: none.
- This repository is a freshly extracted Wakeflow runtime template.
- This is the normal ready state after initialization. Entry-sync windows should report readiness and stop until a controller task wakeup names a state root.
- Create a real active demand with `node scripts/wakeflow-state.mjs init --write`; then read the generated `developer-progress.md`.
- Unattended automation is disabled by default.

## Current Ledgers

- Global TODO: [global-todo-board.md](global-todo-board.md)
- Design handoff inbox: [design-handoff-inbox.md](design-handoff-inbox.md)
- Test exchange projection: [test-exchange.md](test-exchange.md)
- Current map: [index.md](index.md)

## Window Dispatch

| Window | Status | Assigned Work | Evidence |
| --- | --- | --- | --- |
| Controller | idle | No active demand; waiting for controller task. | Initialization ready state. |
| Design | standby | No active handoff. | See Design handoff inbox after setup. |
| Test | standby | No active test card. | See Test exchange only after controller assignment. |

## Copyable Prompt

No active demand exists yet. Create a controller state root before copying a
window prompt.

## Backfill Area

- 2026-05-27: Template initialized.
