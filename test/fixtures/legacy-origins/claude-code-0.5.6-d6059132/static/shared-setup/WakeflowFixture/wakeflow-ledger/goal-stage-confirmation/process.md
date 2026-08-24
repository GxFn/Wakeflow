# Goal-Stage Confirmation Process

Status: reusable process rule
Maintained Window: WakeflowFixture controller

Wakeflow uses this process when a demand is large enough to affect multiple
repositories, user-visible behavior, runtime architecture, deletion boundaries,
release flow, test strategy, or phase order.

## Trigger

Use goal-stage confirmation when:

- the final completion definition is not obvious;
- a Design handoff proposes phases or TODO candidates;
- downstream windows depend on an upstream contract, artifact, or evidence;
- implementation might remove, replace, or postpone existing capability;
- the controller finds that a current plan lacks phase order or producer /
  consumer dependencies.

Small single-repository fixes can skip this process only when the goal,
boundary, validation, and first blocker are already clear.

## Standard Route

1. Stop dispatch until the current goal and scope are clear.
2. Create or attach an original plan under the requirement-design ledger.
3. Confirm the original goal when it changes scope, deletion, phase order, or
   user-visible behavior.
4. Research local code facts, real entrypoints, tests, build surfaces,
   persistence, and consumers.
5. Create or attach the requirement design.
6. Record code implementation dependencies for cross-repository or runtime
   work.
7. Create a task-level goal-stage confirmation document.
8. State final completion definition, non-goals, affected windows, producer /
   consumer order, validation, risks, and open confirmations.
9. Keep `send to` empty until the confirmation is accepted.
10. After confirmation, create state-root task packages or a current execution
    plan only for unblocked windows.
11. Review target evidence before acceptance; scripts and target returns do not
    replace controller judgment.

## Acceptance Bar

A stage can be accepted only when evidence covers the actual user/workflow
surface: real entrypoint, real data or state change, real consumer, failure
path, boundary path, and a reproducible validation command or report.

Thin contracts, empty adapters, static mocks, unused exports, or unconsumed
types are not complete implementation.
