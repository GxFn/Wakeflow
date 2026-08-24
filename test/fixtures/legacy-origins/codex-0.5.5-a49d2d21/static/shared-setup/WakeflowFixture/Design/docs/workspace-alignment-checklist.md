# Design And Wakeflow Alignment Checklist

Status: long-term rule

Use this checklist to confirm that Design documents can be safely imported by
Wakeflow. It is not an execution plan and does not replace controller rules.

## Role Boundary

| Controller Capability | Design Artifact | Boundary |
| --- | --- | --- |
| User goal and completion definition | original plan, requirement design, handoff | Defines the goal; does not announce implementation completion. |
| Original-plan confirmation | confirmation questions and user confirmation state | No execution phases before confirmation. |
| Full functional loop | requirement design loop fields | No empty APIs, empty adapters, or type-only designs. |
| Code facts and research gaps | code facts or handoff research request | Record missing evidence instead of inventing call chains. |
| Repository coverage | scope and suggested windows | Suggestions only; no direct dispatch. |
| TODO / Backlog | design TODO candidates | Requires Wakeflow intake before ledger entry. |
| Signal return | workspace signal | May return anytime; cannot mutate current state. |
| Phase order | phase candidates | Candidates only; not task packages. |
| Test handoff | validation strategy | Wakeflow decides whether to create Test cards. |

## Signal Checklist

- Signal type is set.
- Current-mainline impact is stated.
- Evidence status is stated.
- Owner recommendation is advice only.
- Next step is controller review, not an execution prompt.

## Handoff Checklist

- User goal and final completion definition are explicit.
- Current-mainline relation is stated.
- Original-plan confirmation status is clear.
- Requirement design status is clear.
- Known code facts and research gaps are separated.
- Repository coverage is advice only.
- Phase order remains candidate.
- TODO/Backlog candidates are recorded.
- Validation needs state what must be proven and what cannot be concluded.
- Downgrades, deferrals, compatibility retention, or boundary changes are
  marked pending confirmation.
- Detached Design mode is marked for controller re-import.
