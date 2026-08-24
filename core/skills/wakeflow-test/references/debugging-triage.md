# Debugging And Triage

Use this method when an approved validation step or controller-scoped Test-only
diagnostic needs a reliable reproduction and ownership classification.

## Iron Law

**ESTABLISH A FEEDBACK LOOP BEFORE MAKING A ROOT-CAUSE CLAIM.** Logs without a
reproducible signal are observations, not a diagnosis.

## Preserved Method

- Reproduce the exact reported behavior through the mapped boundary.
- Form ranked, falsifiable hypotheses with predicted observations.
- Probe one variable at a time.
- Separate black-box symptom evidence from white-box causal evidence.
- Classify the result before recommending an owner.

## Feedback Loop Order

Prefer the first mapped form that can observe the assigned behavior:

1. Existing targeted check at the public seam.
2. CLI/API/UI action with explicit expected output.
3. Replay of a bounded request, event, trace, or fixture.
4. Minimal Test-owned harness explicitly authorized by the card.
5. Repeated run for suspected flakiness.
6. Human checklist only when automation cannot observe the risk.

If no credible loop can be built, request the missing environment access, log,
trace, repro step, fixture, or instrumentation from the controller. Do not
modify product source to create observability.

## Workflow

1. Confirm the symptom matches the controller question, not a nearby failure.
2. Capture the exact reproduction signal and portable evidence.
3. List three to five ranked hypotheses, each with a falsifiable prediction.
4. Probe one variable per iteration within the card's confirmed environment
   operations and attempt bound.
5. Classify the result:
   - product defect;
   - Test-owned harness/fixture defect;
   - environment or configuration;
   - flaky/non-deterministic;
   - missing evidence or observability;
   - out of scope;
   - needs owner decision.
6. Return evidence, the supported classification, owner recommendation,
   regression seam, limitations, and residual risk.

## Triage Format

```markdown
## Debugging And Triage

- Controller question:
- Reported behavior:
- Reproduction signal:
- Black-box observations:
- White-box observations:
- Ranked hypotheses and predictions:
- One-variable probes:
- Classification:
- Likely owner:
- Regression seam:
- Invalid conclusions:
- Residual risk:
- Recommended next action:
```

Remove or identify temporary Test-owned instrumentation before return. Never
repair product code, write a probe into a product repository, mutate controller
state, dispatch an owner, or claim acceptance.
