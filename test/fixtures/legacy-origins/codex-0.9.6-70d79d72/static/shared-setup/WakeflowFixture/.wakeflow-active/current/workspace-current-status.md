# WakeflowFixture Current Status

Updated: 2026-08-10
Controller window: WakeflowFixture
Status: idle / waiting for controller task

## Status Summary

- Active demand: none.
- This workspace is a freshly initialized Wakeflow controller surface for WakeflowFixture.
- Workspace initialization is complete. With no active demand, windows remain idle until a controller task wakeup names a state root.
- Create a real active demand through the configured Wakeflow control surface; in installed plugin workspaces, use the Wakeflow MCP `wakeflow_create_demand` tool. Then read the generated `developer-progress.md`.
- Unattended automation is disabled by default.

## Current Ledgers

- Global TODO: [global-todo-board.md](global-todo-board.md)
- Test exchange projection: [test-exchange.md](test-exchange.md)
- Current map: [index.md](index.md)

## Window Dispatch

| Window | Status | Assigned Work | Evidence |
| --- | --- | --- | --- |
| WakeflowFixture | idle | No active demand; waiting for controller task. | Workspace initialized; no extra registration state is required. |
| ProductWindow | standby | No assigned task package. | Configured responsibility: Project repository; confirm scope and responsibility before enabling.. |
| Design | standby | No active handoff. | Requirements arrive as pending-claim rows on the global TODO board via wakeflow_deliver. |
| Test | standby | No active test card. | Test starts only from an anchored state-root test card after controller acceptance. |

## Copyable Prompt

No active demand exists yet. Create a controller state root before copying a
window prompt.

## Backfill Area

- 2026-08-10: Workspace initialized.
