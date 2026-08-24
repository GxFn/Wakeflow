# <Demand Title> Requirement Design

Date: YYYY-MM-DD
Status: draft
Owner Window: Design
Receiving Window: Wakeflow

## Confirmed Goal

Summarize the confirmed user goal and link the original plan.

## Final Completion Definition

Wakeflow may accept the demand only when:

- <item>

## User Scenario

- Actor:
- Starting state:
- Action:
- Expected result:
- Failure visibility:

## Functional Loop

| Part | Description |
| --- | --- |
| Input |  |
| Producer |  |
| State/Data Change |  |
| Consumer |  |
| Output |  |
| Failure Path |  |
| User Verification |  |

## Outcome Gap Or Redesign Trigger

Use this section when current implementation evidence is valid but the effect
still misses the user target. Leave blank for first-pass designs.

- Observed effect:
- Why this is not a simple product-code bug:
- Intended effect:
- Point-fix loop to stop:
- Required design shift:

## Repository Boundaries

| Window / Repository | Role | Expected Change | Upstream Dependency | Downstream Consumer |
| --- | --- | --- | --- | --- |
| Wakeflow | controller/runtime support |  |  |  |
| Design | design support |  |  |  |
| Test | real-scenario verification if needed |  |  |  |
| <configured product window> |  |  |  |  |

## Code Facts

- Confirmed entrypoints:
- Confirmed call chain:
- Confirmed tests/builds:
- Missing code facts:

## Approach Options

Record real options only. If there is only one viable route, explain why.

| Option | Summary | Pros | Cons / Risks | Decision |
| --- | --- | --- | --- | --- |
| A |  |  |  | recommended / rejected / pending |
| B |  |  |  | recommended / rejected / pending |

## Phase Candidates

Phases are candidates for Wakeflow review. They are not task packages.

| Phase | Goal | Upstream / Downstream | Completion Signal |
| --- | --- | --- | --- |
| P1 |  |  |  |

## Landing Plan (per-window packages)

One row per intended task package. `designIntent` is the one-line intent the
controller stamps into the package (advisory echo at dispatch and review,
never a score or gate).

| Task Package | Target Window | designIntent (one line) | Validation |
| --- | --- | --- | --- |
|  |  |  |  |

## Validation Strategy

- Controller self-verification:
- Product repository verification:
- Test handoff required: yes/no
- Test Environment Spec (user-confirmed; REQUIRED when Test handoff = yes —
  the controller copies it into each test card's realScenarioConditions and
  Test never chooses or invents environment values):
  - Environment / base URL:
  - Accounts / credentials source (reference, never the secret itself):
  - Config keys and values source:
  - Data preparation / reset steps:
  - Exclusive or shared (cross-demand serial resource?):
- Real scenario required because:
- Success means:
- Failure means:
- This test cannot prove:

## Rollout, Compatibility, And Documentation

- Compatibility requirement:
- Migration or rollout plan:
- Rollback or recovery path:
- User documentation:
- API/developer documentation:
- Release or operator notes:

## TODO / Backlog Candidates

| ID | Type | Priority | Owner Candidate | Reason | Current Mainline Relation |
| --- | --- | --- | --- | --- | --- |

## Risks And Decisions

- Confirmed decisions:
- Pending decisions:
- Risks:
- Non-goals:
- Forbidden shortcuts:

## User Confirmation Ledger

Every open user question must be ANSWERED and recorded here before handoff —
an unanswered question is Design work, not execution work.

| Question | User Answer | Date |
| --- | --- | --- |
|  |  |  |

## Handoff Readiness

- Original plan confirmed:
- Requirement design complete (reconciled against real code facts):
- Code facts sufficient:
- Approach tradeoffs recorded:
- Landing plan with per-package designIntent recorded:
- All open user questions answered (ledger above):
- Test decision recorded (and Environment Spec user-confirmed when yes):
- Rollout / compatibility / docs recorded:
- Needs Wakeflow code research:
- Ready for workspace handoff:
