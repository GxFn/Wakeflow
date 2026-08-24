# Risk Strategy

Use this method to elaborate an approved Test plan into the smallest credible
evidence route. Do not replace the plan or select a new target.

## Preserved Method

- Prioritize by impact and likelihood, not by the number of tests available.
- Prefer unit evidence for isolated logic, integration evidence for boundaries,
  and end-to-end/manual/runtime evidence only for user-visible or
  environment-dependent risk that lower layers cannot prove.
- Treat flakiness as evidence degradation that must be measured and classified.
- State success, failure, invalid conclusions, and stop conditions before
  execution.

## Workflow

1. Restate the confirmed requirement goal and controller question.
2. Name why Test is needed after controller self-checks, or why the assigned
   Test-only diagnostic is independently valid.
3. Map each approved plan item to:
   - risk and affected actor/journey;
   - chosen evidence layer;
   - confirmed environment operation;
   - expected signal and evidence reference;
   - attempt/flake handling and stop condition.
4. Challenge path dependency: choose the method because it fits this risk, not
   because it was used previously.
5. Reject any useful-looking activity that has no approved-plan mapping.

## Strategy Format

```markdown
## Risk Strategy

- Requirement goal:
- Controller question:
- Entry route: accepted-implementation-validation | test-only-diagnostic
- Why Test is needed:
- Risk focus:
- Approved plan mapping:
- Evidence layer and reason:
- Confirmed environment operations:
- Expected success signal:
- Failure signal:
- Invalid conclusions:
- Attempt and flake rule:
- Stop conditions:
- Evidence references:
```

## Quality Gate

Every activity must answer the controller question, cover a named risk, and map
to the frozen plan. "Run the suite" is insufficient. Escalating to a real
scenario requires a risk that cannot be established credibly at a lower layer.

Do not widen the goal, add general QA, choose a different environment, or treat
a pass as acceptance.
