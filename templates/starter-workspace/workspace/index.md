# Wakeflow Workspace Index

Status: starter template

## Current Controller Entry

| Type | Document | Status | Notes |
| --- | --- | --- | --- |
| Current Status | [current/workspace-current-status.md](current/workspace-current-status.md) | idle | Fresh template status; no active demand has been initialized. |
| Current Work Area | [current/](current/) | maintained | Current status, active TODO, Design/Test intake, and active state roots. |
| Design Handoff Inbox | [current/design-handoff-inbox.md](current/design-handoff-inbox.md) | starter | Controller intake projection for Design handoff rows. |

## Window Coverage Status

| Window | Status | Notes |
| --- | --- | --- |
| Controller | idle | No active demand has been initialized. |
| Design | standby | Use configured Design workspace or handoff inbox after setup confirmation. |
| Test | standby | Use only for real-scenario validation assigned by a controller state root. |

## Status Enum

| Status | Meaning |
| --- | --- |
| idle | No active controller demand is running. |
| standby | Window exists but has no assigned task package. |
| active | Window has a current assigned task package. |
| blocked | Window or controller has missing evidence, identity, validation, or user decision. |
| complete | Work is accepted by controller judgment with reviewable evidence. |

## Long-Term Records

Project-specific long-term records should live in `../wakeflow-ledger/`, not
inside the reusable Wakeflow repository.

## Starter Ledger Map

| Type | Entry | Notes |
| --- | --- | --- |
| Record Map | `../wakeflow-ledger/workspace/workspace-record-map.md` | Long-term map for requirements, archive, workflow rules, and per-window evidence. |
| Requirement Designs | `../wakeflow-ledger/requirement-designs/` | Original plans, requirement designs, and code implementation dependency research. |
| Goal-Stage Confirmation | `../wakeflow-ledger/goal-stage-confirmation/` | Reusable process for confirming final goal and phase order before dispatch. |
