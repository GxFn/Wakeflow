# Option Planning

Use this method after the requirement is clear but more than one credible
implementation, boundary, sequencing, migration, or rollout direction remains.

## Preserved Method

- Keep two to four real alternatives alive long enough to compare them.
- Map context boundaries, interfaces, data/state ownership, consumers, failure
  modes, quality attributes, rollout, and reversibility.
- Include a conservative or staged option when it is genuinely viable.
- Recommend one direction only as Design advice and name evidence that would
  invalidate the recommendation.

## Workflow

1. Restate the user-visible outcome and the decision that remains open.
2. Map current components, owners, public seams, constraints, non-goals, and
   existing validation paths.
3. Produce two to four materially different options. Do not disguise the same
   route with different wording.
4. Compare every option using the same dimensions.
5. Recommend one option as advice, with confirmation needs and reversal cost.
6. Keep the result pending when the user/controller has not made the final
   decision.

## Option Format

```markdown
### Option <n>: <name>

- Scenario and user-visible result:
- Affected repositories/windows:
- Interfaces and consumers:
- Data or state ownership:
- Failure modes and mitigation:
- Validation path:
- Rollout, migration, or deletion path:
- Cost and reversibility:
- Residual risks:
- Open decisions:
- Fit:
```

## Comparison Gate

Reject an option that is only an interface, type, mock, provider shell, or
adapter without a named consumer, consumption step, and validation signal.
Suggest a durable architecture-decision record only when the choice is costly
to reverse, surprising without context, and involves a real tradeoff; writing
that product record still requires explicit owner authorization.

Do not select executable scope, write product architecture records, create task
packages, or dispatch a preferred option from this method.
