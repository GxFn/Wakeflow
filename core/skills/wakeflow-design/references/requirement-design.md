# Requirement Design

Use this method to turn confirmed intent and verified code facts into a
controller-intake-ready design, including a redesign when valid implementation
evidence still produces the wrong non-bug outcome.

## Preserved Method

- Synthesize conversation and codebase facts into problem, goal, user stories,
  behavior, decisions, testing decisions, non-goals, risks, and evidence-backed
  acceptance criteria.
- Use existing domain vocabulary and call out conflicts between user language,
  docs, and code.
- Prefer a public seam that proves observable behavior.
- Keep notes, source references, and the deliverable distinct.

## Preconditions

Proceed when the clarified goal is confirmed, the controller assigned a design
request, or a non-bug outcome mismatch has been routed to Design. Run
clarification first if goal, scope, or completion evidence is unclear. Run
option planning first if the implementation direction remains consequentially
ambiguous.

## Workflow

1. Gather user decisions, the original plan, relevant code/docs facts, current
   behavior, existing interfaces, tests, and explicit non-goals.
2. For redesign, record the observed effect, intended effect, why another
   point-fix would be churn, and the required design shift.
3. Sketch the functional loop: input, producer, state/data change, consumer,
   output, failure path, and user verification.
4. Define repository/window boundaries and producer/consumer dependencies.
5. Record implementation decisions and rejected options without inventing code
   facts.
6. Specify validation that proves each observable acceptance criterion.
7. Make an explicit Test decision:
   - no real-scenario Test, with controller/product checks that are sufficient;
   - or real-scenario Test, with risk, reason, success/failure meaning, invalid
     conclusions, and a user-confirmed Test Environment Spec.
8. Mark every open user decision and the confirmation status.

## Required Content

- Problem and confirmed goal.
- Non-goals and primary actors.
- User stories and proposed behavior.
- Verified code facts and contradictions.
- Implementation decisions, boundaries, consumers, and landing intent.
- Outcome-gap trigger when this is a redesign.
- Testing decision and evidence plan.
- Binary or evidence-backed acceptance criteria.
- Rollout, compatibility, documentation, risks, and open questions.
- Controller intake notes, source references, and confirmation status.

Use the requirement-design asset only after a persistent draft is explicitly
authorized. The completed file is still a draft until the parent Skill's
confirmation and delivery gates are satisfied.

## Quality Gate

The controller must be able to infer affected windows, phase/dependency order,
validation, confirmation needs, and forbidden shortcuts without guessing.
"Run tests" is not a testing decision. A missing Test decision or unanswered
user decision makes the design not ready for delivery.
