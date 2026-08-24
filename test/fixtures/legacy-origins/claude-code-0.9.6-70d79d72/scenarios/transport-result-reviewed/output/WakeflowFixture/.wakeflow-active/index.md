# Wakeflow Workspace Index

Status: generated runtime entry

> Demand state roots are authoritative.

## Current Controller Entry

| Type | Document | Status | Notes |
| --- | --- | --- | --- |
| Current Status | [current/workspace-current-status.md](current/workspace-current-status.md) | active | Generated from all unarchived demand state roots. |
| Current Work Area | [current/](current/) | maintained | Current status, active TODO, Design/Test intake, and active state roots. |

## Window Coverage Status

| Window | Status | Notes |
| --- | --- | --- |
| WakeflowFixture | active | 1 unarchived demand(s). |
| ProductWindow | active | 1 active target task(s). |
| Design | standby | Delivers requirements through the global TODO board. |
| Test | standby | Receives only explicit state-root Test work after controller acceptance. |

## Status Enum

| Status | Meaning |
| --- | --- |
| idle | No active controller demand is running. |
| standby | Window exists but has no assigned task package. |
| active | At least one unarchived demand is active. |
| blocked | A demand has a blocking state. |
| degraded | A canonical demand state authority artifact is corrupt or inconsistent. |
| complete | Work is accepted and awaiting archive or already archived. |

## Active Demands

- [SCENARIO-TRANSPORT](current/SCENARIO-TRANSPORT/) — `planned`, revision 2, demand authority `draft-unfrozen` (confirmation pending), placement `main`.
