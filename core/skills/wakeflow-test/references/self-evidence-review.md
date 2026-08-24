# Self-Evidence Review

Use this method immediately before recording the Test result. Review only the
evidence Test produced for its assigned card/package. Product diffs, product
target results, implementation completeness, and acceptance stay with the
controller.

## Preserved Method

- Evidence before claims, always.
- Separate observable symptom, causal inference, command output, and residual
  risk.
- Check completeness, reproducibility, portability, redaction, and limitations.
- Treat a successful command as one observation, not proof of the whole demand.

## Workflow

1. Restate the frozen controller question and approved plan.
2. Inventory Test-produced evidence only:
   - exact command or observation;
   - outcome and timestamp/attempt identity when relevant;
   - portable ref or digest;
   - environment/card reference;
   - flake/retry facts;
   - interpretation and invalid conclusions.
3. Verify every approved plan item has exactly one intended `test-step` mapping
   and no unknown, duplicate, or mismatched item.
4. Check that references resolve for controller review and contain no secrets,
   private handles, raw local absolute paths, or unbounded logs.
5. Identify missing evidence, contradictions, flakiness, unauthorized actions,
   and residual risks.
6. Choose an honest result readiness:
   - `ready-to-record-completed` when the Test result contract is complete;
   - `ready-to-record-blocked` when a concrete external blocker stopped the
     approved work;
   - `ready-to-record-needs-review` when scope, authority, mapping, or evidence
     needs controller judgment.

## Review Format

```markdown
## Self-Evidence Review

- Controller question:
- Approved plan items:
- Evidence inventory:
- Test-step mapping check:
- Reproducibility check:
- Portability/redaction check:
- Contradictions or flakiness:
- Missing evidence:
- Invalid conclusions:
- Residual risks:
- Result readiness:
```

## Non-Acceptance Boundary

Self-evidence review does not inspect product completion on the controller's
behalf, recommend acceptance, roll TODOs, or complete the demand. It only makes
the Test-authored strict `TargetResult` honest and reviewable. The controller
must independently inspect and validate the returned evidence before any
accept/rework/routing decision.
