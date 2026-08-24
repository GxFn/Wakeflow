# Regression Advisory

Use this method after an approved behavior or reproduced defect needs durable
coverage guidance. This method advises the controller and owning product
window; it does not implement product regression tests.

## Preserved Method

- Protect observable behavior through a public seam.
- Prove that the seam exercises the real requirement or defect path.
- Specify fail-before and pass-after signals.
- Start with one tracer bullet, then add cases from evidence rather than a
  horizontal test dump.

## Workflow

1. Name the behavior that must remain true and who observes it.
2. Choose the highest public seam that proves that behavior: public function,
   API, CLI, UI flow, daemon job, documented output, or integration boundary.
3. Explain how the seam exercises the actual call chain and observed failure.
4. Define the expected failing signal before the repair/behavior exists and the
   passing signal afterward.
5. Propose one minimal tracer bullet with fixture, action, and assertion.
6. Add only evidence-backed edge cases and identify the owning product window.
7. If no correct public seam exists, report a testability/observability gap
   instead of coupling to private implementation shape.

## Advisory Format

```markdown
## Regression Advisory

- Behavior to protect:
- Actor/observer:
- Public seam:
- Why this seam exercises the real path:
- Fail-before signal:
- Pass-after signal:
- First tracer bullet:
- Additional evidence-backed cases:
- Fixture/data needs:
- Owning product window:
- Testability gaps:
- Risks and limitations:
```

## Boundary

Actual product regression code belongs to the product window. Test may create a
Test-owned harness or fixture only when the current card explicitly authorizes
that exact asset and maps it to an approved step; such an asset remains outside
product source and cannot substitute for product-owned durable coverage.

Reject private-method tests, internal-shape assertions, unnecessary mocks, bulk
test plans, and coverage that could pass while the user-visible behavior stays
broken. Do not accept the implementation or dispatch the recommendation.
