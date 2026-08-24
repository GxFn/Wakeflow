---
name: test-strategy
description: Use in a Wakeflow Test window to design a risk-based validation plan for a controller test card, real-project scenario, release check, runtime observation, or cross-repository integration question.
---

# Test Strategy

Design the smallest real validation plan that answers the controller's question
with credible evidence. This skill belongs to Test windows. It plans and
collects evidence; it does not accept product work or dispatch follow-up
implementation.

## Source Skills Used

- `senior-qa`: risky user journeys, test layer choice, must-pass automated
  tests, focused manual checklist, and flakiness as a product bug.
- `code-reviewer`: evidence should cover correctness, safety, maintainability,
  performance, and tests when relevant.
- Industry basis: risk-based testing, test pyramid, and evidence confidence.

## Wakeflow Role

Use this skill only when Test is justified by one of these:

- real project/environment verification;
- cold-start, dashboard, runtime, daemon, or monitoring observation;
- reproduction/regression that the controller cannot safely perform alone;
- cross-repository integration evidence;
- release or smoke confidence.

Do not use Test to rediscover defects already known to the controller or to run
general QA without a boundary.

## Required Inputs

- Controller test card or state-root reference.
- Exact question Test must answer.
- Target repository/window.
- What the controller/product window already self-verified.
- Success meaning.
- Failure meaning.
- Invalid conclusions.
- Stop conditions.

If those inputs are missing, stop and report missing test boundary evidence.

## Workflow

1. Restate the question.
   - What decision will this evidence enable?
   - What must not be concluded from this run?
2. Map risk.
   - Critical user journey.
   - Money/auth/data loss/privacy/security risk.
   - Integration boundary.
   - Runtime or environment dependency.
   - Known flaky area.
3. Choose test layer.
   - Unit for isolated logic.
   - Integration for boundary behavior.
   - E2E/manual for key user-visible or environment-dependent paths.
   - Runtime/log/dashboard observation only when the question needs real
     operational evidence.
4. Define evidence.
   - Commands.
   - Reports, logs, screenshots, runtime JSON, or traces.
   - Expected pass/fail signal.
   - Re-run or flake handling rule.
5. Run only the agreed boundary.
6. Return evidence and interpretation without accepting product completion.

## Evidence Plan Format

```markdown
## Test Strategy

- Question:
- Target:
- Why Test is needed:
- Risk focus:
- Test layer:
- Commands or observations:
- Expected success signal:
- Failure signal:
- Invalid conclusions:
- Stop conditions:
- Evidence paths:
```

## Flakiness Rule

Treat flakiness as evidence degradation, not as "mostly passing". If a result is
flaky:

- record reproduction rate or affected command;
- identify likely category when possible;
- do not call the tested behavior accepted;
- route to debugging/triage or owning repository.

## Allowed Outputs

- Test plan or strategy note.
- Test evidence summary.
- Failure classification.
- Recommendation for controller review.

## Forbidden Outputs

- No final acceptance.
- No product implementation unless the test card explicitly authorizes it.
- No unbounded exploratory QA.
- No target-to-target dispatch.
- No global TODO mutation.

## Quality Bar

A good strategy names the exact question, risk, chosen layer, evidence, success
meaning, failure meaning, invalid conclusion, and stop condition. It fails if it
just says "run tests" or expands beyond the controller's test boundary.
