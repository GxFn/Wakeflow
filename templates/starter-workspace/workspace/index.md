# Control Workspace Index

This file is the starter template for the single active workspace entrypoint. After installation, current status, active TODO, test exchange, and active controller state roots live in `.workspace-active/workspace/current/`. Completed plans should be archived to the project ledger, normally `../workspace-ledger/workspace/archive/`.

## 当前总控入口

| 类型 | 文档 | 状态 | 说明 |
| --- | --- | --- | --- |
| 当前状态 | [current/workspace-current-status.md](current/workspace-current-status.md) | idle | Fresh template status; no active demand has been initialized. |
| State Machine Templates | [../../templates/control-state-machine/](../../templates/control-state-machine/) | template | Create new active demands with `controller-state.mjs init`, then read the generated `developer-progress.md`. |
| Global TODO Board | [current/global-todo-board.md](current/global-todo-board.md) | maintained | Cross-plan TODO ledger. |
| Design Handoff Board | [current/design-handoff-board.md](current/design-handoff-board.md) | maintained | Internal DesignWindow handoff board when no external design repository is configured. |
| Test Exchange | [current/test-exchange.md](current/test-exchange.md) | maintained | Human projection for real-scenario validation; state-root `test-cards/*.json` is the machine boundary. |
| Workspace Record Map | [workspace-record-map.md](../../../workspace-ledger/workspace/workspace-record-map.md) | maintained | Long-term archive and evidence map in the external project ledger. |
| 当前短期工作区 | [current/](current/) | maintained | Current status, active TODO, test exchange projection, and active state roots. |
| Script Index | [../../scripts/README.md](../../scripts/README.md) | maintained | Mechanical script entrypoint. |
| Skill Index | [../../skills/README.md](../../skills/README.md) | maintained | Skill assets. |

## Current Dispatch Surface

Keep active dispatch state inside the active controller state root. This index should remain small and should not become a second state surface. Window eligibility, delivery envelopes, target results, and review decisions belong to the active state root and local automation runtime.
