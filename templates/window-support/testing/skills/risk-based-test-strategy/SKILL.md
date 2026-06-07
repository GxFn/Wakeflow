---
name: risk-based-test-strategy
description: Use in a Wakeflow Test window when a controller state root assigns Test to choose or justify the smallest real-scenario validation plan that can answer the current risk question.
---

# Risk-Based Test Strategy

Use this skill to decide what Test should actually run for a controller-assigned
task.

## Inputs

- Controller state root and test card.
- Owning product repository and validation already performed by controller or
  product window.
- Changed user path, data path, integration, or runtime environment.
- Known risks, residual risks, and invalid conclusions.

## Method

1. Restate the exact test question.
2. Identify the risk type: user-critical path, data integrity, compatibility,
   regression, accessibility, security, performance, or environment.
3. Choose the lightest test layer that can answer it:
   - static/code review evidence;
   - unit/integration evidence from product repo;
   - API/contract probe;
   - browser or real-project scenario;
   - manual observation.
4. Name what success proves and what it does not prove.
5. Capture commands, logs, screenshots, reports, and residual risk.

## Output

- Test scope and non-scope.
- Required setup and data.
- Commands or manual steps.
- Evidence artifacts.
- Pass/fail meaning.
- Follow-up owner if the test exposes a product defect.

## Stop Conditions

- The controller state root or test card is missing.
- The task is only asking Test to rediscover a known script or code defect.
- The proposed test would expand beyond the assigned repository or user goal.
