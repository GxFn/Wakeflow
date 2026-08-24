# Metrics Contract

Use this reference when a plan, repair round, or benchmark needs node-level baseline, scorecard, comparison, or verdict fields. The metrics contract is generic: product-specific node names and evidence paths belong in adapters or overlays.

## Contract Goals

- Give every node a useful unit that represents real workflow value, not just command success.
- Separate quality gates from improvement scoring.
- Make before/after comparisons reproducible from the same fixture or frozen upstream artifact.
- Block verdicts when artifacts, traces, or metrics cannot be linked to the node under review.
- Preserve enough evidence for a future optimizer to improve the same node without rerunning the whole chain first.

## Per-Node Scorecard Fields

Every scored node should declare:

| Field | Meaning | Required |
|-------|---------|----------|
| `usefulUnit` | The smallest user-visible or downstream-consumable unit this node must produce, preserve, or decide. | yes |
| `qualityGate` | Boolean gate with named invariants that must pass before improvement can be counted. | yes |
| `stageLoss` | Numeric or categorical loss signals for this node, such as missing evidence, rejected records, fallback use, vague reasons, duplicate count, budget waste, or unsafe write risk. | yes |
| `baseline` | Pre-change measurement from the same fixture, frozen upstream artifact, or read-only source fact. | yes for optimization work |
| `candidate` | Post-change measurement from the same fixture or artifact. | yes when a repair or optimization was attempted |
| `comparison` | Before/after delta with the quality gate result, loss delta, and unchanged fixture identity. | yes when baseline and candidate exist |
| `verdict` | `pass`, `regression`, `improved`, `neutral`, `blocked`, or `blocked-by-observability-gap`. | yes |
| `evidenceLinks` | Source refs, reports, trace ids, artifact paths, test output, logs, or observation fields used to compute the scorecard. | yes |
| `residualRisk` | Known gaps that do not block the current verdict, or the missing evidence that does block it. | yes |

Keep the scorecard close to the node section in `report/plan.md`. Do not create a separate metrics file unless the output is machine-generated and too bulky to read inline.

## Useful Unit Rule

The useful unit must describe the business or workflow outcome at this node boundary. Examples:

- A normalized intent that preserves the requested execution mode.
- A task row that can be cancelled before downstream dispatch.
- A quality-gated analysis artifact with file-level source evidence.
- A candidate result with accepted/rejected reasons and source references.
- A report row that links session id, node id, artifact id, and trace id.

Avoid weak units such as "command succeeds", "test passes", or "no error". Those can be evidence, but they are not the unit of value.

## Quality Gate Before Improvement

Loss improvement only counts when the node's quality gate passes.

Use this decision order:

1. Check the quality gate against concrete invariants.
2. If the gate fails, verdict is `regression`, `blocked`, or `blocked-by-observability-gap`; do not count lower loss as improvement.
3. If the gate passes, compare `stageLoss` between baseline and candidate.
4. Mark `improved` only when loss decreases without weakening the useful unit, write boundary, or downstream handoff.
5. Mark `neutral` when the gate passes and loss is unchanged.

Example: a candidate that produces fewer rejected records but loses file-level source refs fails the quality gate. It is not an improvement.

## Baseline Shape

Use stable identities so a later run can reproduce the comparison:

```yaml
baseline:
  nodeId: N9-agent-analyze-quality
  fixtureId: fixture-or-frozen-artifact-id
  usefulUnit: quality-gated analysis finding
  qualityGate:
    status: pass|fail|blocked
    invariants:
      - finding has file-level source evidence
      - quality gate artifact is not fallback-only
  stageLoss:
    missingSourceRefs: 0
    fallbackOnlyFindings: 0
    vagueReasonCount: 0
    unlinkedArtifactCount: 0
  evidenceLinks:
    - source:path/or/symbol
    - artifact:scratch/chain-runs/.../report/plan.md#node-n9
```

Use the same shape for `candidate`. Add only fields that the node can actually observe.

## Comparison Shape

```yaml
comparison:
  nodeId: N9-agent-analyze-quality
  fixtureId: same-fixture-or-frozen-artifact-id
  qualityGate:
    baseline: pass
    candidate: pass
  stageLossDelta:
    missingSourceRefs: 0
    fallbackOnlyFindings: -1
    vagueReasonCount: -2
  unchangedBoundaries:
    - same input assembly fixture
    - same downstream cut point
    - same no-delivery guard
  verdict: improved
  rationale: Candidate reduced fallback-only and vague findings while preserving source evidence.
```

If the fixture, input assembly, provider mode, or downstream cut changed, split the comparison or mark it `blocked` until the changed variable is isolated.

## Observability Gap Verdict

Use `blocked-by-observability-gap` when the node's required artifact, trace, metric, source ref, or report field cannot be linked to the node boundary.

Required fields:

```yaml
verdict: blocked-by-observability-gap
blockedReason: artifact/trace/metric cannot be associated with node id
missingLink:
  nodeId: N9-agent-analyze-quality
  expected:
    - trace id or run id
    - artifact path or report field
    - source refs or file evidence
  observed:
    - available field or "none"
firstFix:
  - add node id to the artifact/report/trace producer
  - rerun the same node fixture before scoring quality
```

Do not infer a quality verdict from unrelated artifacts. Do not compare two runs when either side is missing a stable node link.

## Run-Level Summary

At the end of `report/plan.md`, include a compact summary:

| Node | Useful Unit | Quality Gate | Stage Loss Summary | Verdict |
|------|-------------|--------------|--------------------|---------|
| `N9-agent-analyze-quality` | `quality-gated analysis finding` | `pass` | `fallbackOnlyFindings -1` | `improved` |

Run-level status is the worst meaningful node verdict for the selected variant. A single `blocked-by-observability-gap` in a required node blocks the run-level optimization verdict until that gap is repaired.
