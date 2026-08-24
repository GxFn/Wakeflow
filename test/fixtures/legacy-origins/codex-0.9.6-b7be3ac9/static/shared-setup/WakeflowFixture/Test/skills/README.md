# Test Skills

These skills are Wakeflow-adapted Test-window capabilities. They turn mature QA,
debugging, TDD, and review practices into review-input-producing workflows.
Their output supports controller review; it is never machine-verified proof or acceptance.

Test skills do not accept product work, dispatch new windows, mutate controller
state, or take over product implementation. A test card authorizes a validation
boundary; it never grants product-code ownership.

## How To Use These Skills

Use these skills proactively while Test is executing an assigned test card or
answering a controller review question:

- Use only a skill listed by the assigned test card. Name the smallest matching
  skill and explain why it answers the frozen test question before running commands
  or recording backfill. Progressive Chain Validation is unavailable unless the
  card explicitly lists `progressive-chain-validation`.
- If a skill is only possibly useful, recommend it as the next method and ask
  only for the missing scope decision that would change the test boundary.
- If the current review question is straightforward and a skill would add no
  value, say that briefly and proceed inside the assigned boundary.
- Do not blend several skills into one vague pass. Use them in sequence and stop
  when the current review question is answered.

## Installed Skills

- `test-strategy/SKILL.md`
  - Purpose: design a risk-based validation plan for a controller test card or
    real scenario.
  - Sources: `senior-qa`, code-review evidence practice, risk-based testing,
    and the test pyramid.
  - Output: exact question, risk focus, test layer, success/failure meaning,
    invalid conclusions, stop conditions, and evidence paths.
- `debugging-and-triage/SKILL.md`
  - Purpose: reproduce, isolate, and classify failing or uncertain behavior.
  - Sources: `diagnose`, `systematic-debugging`, `triage`, scientific
    debugging, and SRE symptom/cause separation.
  - Output: feedback loop, reproduction evidence, hypotheses, probes,
    classification, owner recommendation, and residual risk.
- `regression-design/SKILL.md`
  - Purpose: design behavior-focused regression coverage using public seams.
  - Sources: `tdd`, diagnosis-loop seam discipline, behavior-focused testing,
    and the test pyramid.
  - Output: protected behavior, public seam, fail-before/pass-after signal,
    first tracer bullet, fixtures, risks, and owner.
- `evidence-review/SKILL.md`
  - Purpose: inspect target result inputs, diffs, reports, logs, or validation
    outputs for controller judgment.
  - Sources: `code-reviewer`, `senior-qa`, Google code review practice, and
    SRE evidence discipline.
  - Output: blockers, missing review inputs, minor issues, residual risks, test plan
    assessment, invalid conclusions, and recommended controller decision.
- `progressive-chain-validation/SKILL.md`
  - Purpose: generate and execute source-derived long-chain validation plans
    one node at a time, with isolated fixtures, safe write boundaries,
    before/after metrics, scoped round verdicts, and a required
    `scratch/chain-runs/<run-id>/report/plan.md` artifact.
  - Sources: Progressive Chain Validation, PCVM round/segment semantics, metric
    contracts, node isolation, and bounded terminal execution.
  - Output: source chain map, node cuts, round model, local segment scorecards,
    evidence links, current-node execution log, scoped verdicts, and full-run
    readiness gate.

## Quality Standard

Test output must answer a controller question with reviewable inputs. It is
not enough to say that tests passed. Every result must distinguish success,
failure, invalid conclusion, missing review inputs, and residual risk; the
controller still performs independent validation before acceptance.
