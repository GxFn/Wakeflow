---
name: debugging-and-triage
description: Use in a Wakeflow Test window when a test card, smoke run, runtime observation, or user report shows a failing or uncertain behavior that needs reproduction, root-cause tracing, and ownership classification.
---

# Debugging And Triage

Build a reliable signal, reproduce the issue, isolate the likely cause, and
return evidence to the controller. Test may diagnose and classify; product code
fixes stay with the owning repository unless the task card explicitly says
otherwise.

## Source Skills Used

- `mattpocock/skills/engineering/diagnose`: feedback loop first, reproduce,
  ranked falsifiable hypotheses, targeted instrumentation, fix/regression
  discipline, cleanup, and post-mortem.
- `systematic-debugging`: reproduce, localize, trace, fix, verify, and
  condition-based waiting.
- `triage`: classify bug, environment, out-of-scope, missing owner, or missing
  evidence.
- Industry basis: scientific debugging and SRE symptom/cause separation.

## Wakeflow Role

Use this skill for Test-scoped failures:

- a controller test card failed;
- a product window backfill has uncertain evidence;
- a runtime/dashboard/cold-start observation is inconsistent;
- a reproducer is needed before routing to a product window.

## Stop Before Guessing

Do not hypothesize from vibes. First create or identify a pass/fail signal.

Try these feedback-loop forms in order:

1. Targeted failing test at the right seam.
2. CLI command with fixture input and expected output.
3. HTTP/curl script against a local or test service.
4. Browser or UI script with explicit assertions.
5. Replay captured request, event, trace, or log.
6. Minimal harness around the failing path.
7. Repeated loop for flaky behavior.
8. Human-in-the-loop checklist only when automation cannot observe the issue.

If no credible loop can be built, stop and request the missing artifact:
environment access, logs, HAR/trace, repro steps, fixture, or instrumentation
permission.

## Workflow

1. Build the feedback loop.
   - Make it specific, fast enough, and deterministic where possible.
   - For flake, raise reproduction rate and record rate.
2. Reproduce the described behavior.
   - Confirm it is the user's/controller's failure, not a nearby failure.
   - Capture exact symptom and evidence path.
3. Generate three to five ranked hypotheses.
   - Each must be falsifiable.
   - Each must state a prediction.
4. Probe one variable at a time.
   - Prefer debugger/inspection when available.
   - Use targeted logs with a unique prefix if logs are needed.
   - Do not "log everything".
5. Classify.
   - Product defect.
   - Test defect.
   - Environment/configuration.
   - Flaky/non-deterministic.
   - Missing evidence.
   - Out of scope.
   - Needs owner decision.
6. Return to controller.
   - Evidence.
   - Classification.
   - Owner recommendation.
   - Whether a regression test seam exists.
   - Residual risk.

## Triage Report Format

```markdown
## Debugging And Triage

- Reported behavior:
- Reproduction signal:
- Evidence:
- Hypotheses:
- Probes:
- Classification:
- Likely owner:
- Regression seam:
- Residual risk:
- Recommended next action:
```

## Cleanup Rules

Before reporting done:

- remove temporary debug instrumentation or mark it clearly as test artifact;
- keep reproducible evidence paths;
- do not leave private logs or secrets in tracked docs;
- preserve the hypothesis that matched the evidence.

## Forbidden Outputs

- No product fix unless authorized by the test card.
- No acceptance decision.
- No controller state mutation.
- No speculative root-cause claim without a signal.
- No next-hop dispatch.

## Quality Bar

The result is useful when the controller can route the issue to the right owner
or decide that evidence is missing. It fails if it contains only log snippets,
single-hypothesis guessing, or "looks fine" without a feedback loop.
