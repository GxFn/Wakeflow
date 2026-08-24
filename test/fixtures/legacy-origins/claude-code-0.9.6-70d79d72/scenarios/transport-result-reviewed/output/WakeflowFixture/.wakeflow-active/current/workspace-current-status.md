# Wakeflow Current Status

Updated: @wakeflow-scenario-time
Controller window: WakeflowFixture
Status: active

## Status Summary

- [SCENARIO-TRANSPORT](SCENARIO-TRANSPORT/developer-progress.md) — `planned`, revision 2, demand authority `draft-unfrozen` (confirmation pending), controller host `claude-code`, placement `main`.

This file is a generated entry projection. Each demand's `wakeflow-state.json` is authoritative; delivery transport state is local under `.wakeflow-local/wakeflow-delivery/`.

## Demand Authority

- Frozen: 0.
- Draft/unfrozen: 1.
- Legacy terminal/unfrozen: 0.
- Pending confirmation: `SCENARIO-TRANSPORT` must freeze its demand authority before task-package creation or dispatch.

## Current Ledgers

- Global TODO: [global-todo-board.md](global-todo-board.md)
- Test exchange: [test-exchange.md](test-exchange.md)
- Current map: [index.md](index.md)

## Window Dispatch

| Window | Status | Assigned Work | Evidence |
| --- | --- | --- | --- |
| WakeflowFixture | active | 1 active/unarchived demand(s) | See Active Demands above. |
| ProductWindow | active | 1 assigned target task(s). | Project repository; confirm scope and responsibility before enabling.. |
| Design | standby | Design intake only. | Global TODO delivery rows. |
| Test | standby | Test only when assigned by a state root. | State-root test cards. |

## Copyable Prompt

Freeze the pending demand authority listed above before creating task packages or dispatching work.

## Backfill Area

- @wakeflow-scenario-time: Workspace entry projection refreshed from 1 unarchived demand(s), including 0 explicitly placed Pod demand(s).
