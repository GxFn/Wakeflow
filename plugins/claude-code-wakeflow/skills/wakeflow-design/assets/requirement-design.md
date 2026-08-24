# <Demand Title> Requirement Design

- Status: draft
- Original plan reference:
- Design request reference:
- Owner: Design
- Intended receiver: Wakeflow controller

> This file is a non-authoritative Design draft. It does not become authority
> through its path or status; submit its portable reference only after explicit
> confirmation through the parent Skill's exact TODO-row procedure.

## Problem

Describe the problem from the actor's perspective, not as a list of code edits.

## Confirmed Goal And Completion Definition

- Confirmed goal:
- Completion is true when:
- Completion evidence:
- Stop conditions:

## Non-Goals And Forbidden Shortcuts

- Non-goals:
- Forbidden shortcuts:

## Actors And User Stories

| Actor | Starting state | Action | Expected result | Failure visibility |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |

## Verified Code And Documentation Facts

- Confirmed entrypoints:
- Confirmed call chain:
- Existing public seams:
- Existing tests/builds:
- Terminology or source contradictions:
- Missing facts:

## Proposed Behavior

| Part | Description |
| --- | --- |
| Input |  |
| Producer |  |
| State/data change |  |
| Consumer |  |
| Output |  |
| Failure path |  |
| User verification |  |

## Outcome Gap Or Redesign Trigger

Complete this section only for a non-bug outcome mismatch.

- Observed effect:
- Intended effect:
- Why this is not a simple product-code bug:
- Point-fix loop to stop:
- Required design shift:

## Options And Decisions

| Option | Scenario | Boundaries/consumers | Validation | Risks/reversibility | Decision |
| --- | --- | --- | --- | --- | --- |
| A |  |  |  |  | recommended / rejected / pending |
| B |  |  |  |  | recommended / rejected / pending |

## Repository Boundaries And Landing Intent

`designIntent` is advisory implementation intent. It is not scope or an
acceptance gate.

| Candidate package | Target window/repository | Producer/consumer dependency | designIntent | Validation |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |

## Candidate Vertical Slices

| Slice | HITL / AFK | Observable value or evidence | Owner suggestion | Dependencies | Acceptance signal |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |

## Validation And Testing Decision

- Controller self-verification:
- Product repository verification:
- Real-scenario Test required: yes / no
- Risk that Test must address:
- Strategy source:
- Success means:
- Failure means:
- Invalid conclusions:
- Stop conditions:

When real-scenario Test is required, record the user-confirmed environment
without secrets:

- Environment/base URL reference:
- Account/credential reference:
- Config-value source:
- Data preparation/reset steps:
- Exclusive/shared resource constraints:
- Allowed environment operations:

## Acceptance Criteria

| Criterion | Probe | Expected evidence |
| --- | --- | --- |
|  |  |  |

## Rollout, Compatibility, And Documentation

- Compatibility requirement:
- Migration/rollout path:
- Rollback/recovery path:
- User documentation:
- API/developer documentation:
- Release/operator notes:

## Risks And Open Questions

- Risks:
- Open questions:
- Required controller judgment:

## User Decision Ledger

| Question | Decision | Decision owner | Evidence/reference |
| --- | --- | --- | --- |
|  |  |  |  |

## Source References

-

## Handoff Readiness

- Original plan confirmed:
- Design reconciled with verified code facts:
- Landing intent and dependencies recorded:
- All user decisions answered:
- Testing decision complete:
- Environment confirmed when Test is required:
- Non-goals and forbidden shortcuts recorded:
- Ready for explicit delivery confirmation:
