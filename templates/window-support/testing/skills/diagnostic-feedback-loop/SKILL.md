---
name: diagnostic-feedback-loop
description: Use in a Wakeflow Test window when a controller state root assigns a failing or uncertain runtime behavior that needs reproduce-isolate-verify evidence.
---

# Diagnostic Feedback Loop

Use this skill for assigned failure diagnosis. Keep the loop small and evidence
driven.

## Inputs

- Controller state root and test card.
- Exact symptom, user path, or runtime signal.
- Owning repository and any product-window validation already completed.
- Commands, fixtures, URLs, logs, screenshots, or reports already available.

## Method

1. Reproduce or confirm the symptom with the narrowest scenario available.
2. Pin the boundary: repository, process, route, UI surface, data source, or
   integration.
3. Form one hypothesis at a time.
4. Run the smallest probe that can confirm or reject that hypothesis.
5. Record the observed evidence before changing setup or widening scope.
6. Return the next owner and repair direction instead of silently fixing
   product code.

## Output

- Symptom and reproduction status.
- Boundary under test.
- Hypotheses tried and evidence for each.
- Commands, logs, screenshots, report paths, and environment details.
- Result classification: reproduced, not reproduced, blocked, external, or
  fixed upstream.
- Recommended next owner and next test, if any.

## Stop Conditions

- The state root or test card is missing.
- The test would require product implementation not assigned to Test.
- The diagnostic scope grows beyond the controller question.
- Evidence points to a product defect that needs the owning repository window.
