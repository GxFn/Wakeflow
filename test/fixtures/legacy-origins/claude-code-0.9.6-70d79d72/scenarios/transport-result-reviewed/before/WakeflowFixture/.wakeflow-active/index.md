# WakeflowFixture Workspace Index

Status: starter template

## Current Controller Entry

| Type | Document | Status | Notes |
| --- | --- | --- | --- |
| Current Status | [current/workspace-current-status.md](current/workspace-current-status.md) | idle | Workspace initialized; no active demand has been initialized. |
| Current Work Area | [current/](current/) | maintained | Current status, active TODO, Design/Test intake, and active state roots. |

## Window Coverage Status

| Window | Status | Notes |
| --- | --- | --- |
| WakeflowFixture | idle | No active demand has been initialized; waiting for controller task. |
| ProductWindow | standby | Configured responsibility window: Project repository; confirm scope and responsibility before enabling.. |
| Design | standby | Delivers confirmed requirements through the global TODO board. |
| Test | standby | Receives only explicit state-root Test work after controller acceptance. |

## Status Enum

| Status | Meaning |
| --- | --- |
| idle | No active controller demand is running; initialized windows wait for a task wakeup. |
| standby | Window exists but has no assigned task package. |
| active | Window has a current assigned task package. |
| blocked | Window or controller has missing review inputs, identity, validation, or user decision. |
| complete | Work is accepted only after explicit controller judgment and independent validation. |

## Long-Term Records

Project-specific long-term records should live in `wakeflow-ledger/`, not
inside the reusable Wakeflow repository.

## Starter Ledger Map

| Type | Entry | Notes |
| --- | --- | --- |
| Record Map | `wakeflow-ledger/workspace/workspace-record-map.md` | Long-term map for requirements, archive, workflow rules, and per-window evidence. |
| Requirement Designs | `wakeflow-ledger/requirement-designs/` | Original plans, requirement designs, and code implementation dependency research. |
| Goal-Stage Confirmation | `wakeflow-ledger/goal-stage-confirmation/` | Reusable process for confirming final goal and phase order before dispatch. |
