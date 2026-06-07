---
name: behavior-first-regression-evidence
description: Use in a Wakeflow Test window when assigned to verify that a user-visible or operator-visible behavior still works after a product change.
---

# Behavior-First Regression Evidence

Use this skill to avoid tests that only prove implementation details. The
evidence should answer the controller's behavior question.

## Inputs

- Controller state root, test card, and completion definition.
- Changed behavior, affected user path, or operator workflow.
- Existing product tests, probes, and known residual risks.
- Required runtime, fixture, or data boundary.

## Method

1. Restate the behavior in user or operator terms.
2. Identify the observable signal: UI state, API response, stored data, event,
   log, job state, or exported artifact.
3. Choose the smallest regression check that exercises that signal.
4. Prefer stable selectors, public APIs, and domain-visible outputs over private
   implementation details.
5. Record what the evidence proves and what it does not prove.
6. If the behavior fails, preserve the failure artifact and hand it back to the
   owning repository.

## Output

- Behavior under regression.
- Test path and setup.
- Evidence artifacts.
- Pass/fail meaning.
- Invalid conclusions.
- Residual risks and recommended owner.

## Stop Conditions

- The requested check cannot observe the behavior directly.
- The test only verifies an internal helper, mock, or static fixture.
- Test would need to modify production code without explicit authorization.
