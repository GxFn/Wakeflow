# Local Chain Optimization

Progressive chain validation can optimize a local chain segment without
pretending to validate the whole workflow. A local chain segment is a bounded
producer/consumer slice with explicit input, output, side effects, and metrics.

## Local Segment Definition

Each segment must define:

| Field | Meaning |
| --- | --- |
| `segmentId` | Stable id such as `intent-plan`, `consumer-persistence`, or `report-history`. |
| `ownerLayer` | Product or test layer that owns the code or behavior. |
| `inputContract` | The data shape entering the segment. |
| `outputContract` | The useful unit leaving the segment. |
| `sideEffects` | Writes/events/report updates caused by this segment. |
| `upstreamFreeze` | Fixture or runtime artifact used as stable input. |
| `downstreamCut` | Where execution stops. |
| `metrics` | Stage loss and quality gate for the segment. |

## Optimization Loop

Use the same loop for every local segment:

1. Select one segment.
2. Freeze upstream data.
3. Cut downstream effects.
4. Measure baseline.
5. Fix one class of problem.
6. Rerun the same measurement.
7. Record comparison and residual risk.
8. Only then expand to the next segment.

## Metric Classes

| Metric Class | Examples |
| --- | --- |
| data contract | missing field, ambiguous status, duplicate ids, unknown skip reason |
| evidence linkage | missing node id, missing chain id, unlinked artifact, missing report surface |
| source grounding | no referenced files, fallback-only findings, open assumptions |
| side effect safety | unsafe write root, unapproved delivery, mutation outside round |
| runtime health | timeout, missing variant result, cancellation leak, stale session |
| quality | vague rejected reason, incomplete quality gate, incomplete record repair |
| coupling | one function updates too many surfaces, optional step failure obscures core result |
| budget | token, time, process, retry, or tool-call waste that does not improve the useful unit |

## Local Segment Verdicts

Local verdicts must be scoped:

```text
improved(scope=unit)
pass(scope=fixture)
blocked(scope=live-provider)
regression(scope=runtime)
```

The local verdict only applies to that segment. It does not close the whole
progressive chain run.

## Engineering Before Live Evidence

Before opening live provider, UI, delivery, or full runtime rounds,
deterministic segments should have:

- stable input/output contracts;
- explicit skipped/failed/not-applicable semantics;
- reusable fixtures;
- report evidence derived from one evidence envelope;
- no hidden broad runtime writes;
- no unresolved observability gap for required scorecard fields.

Live or real-project evidence should then measure behavior under real
conditions, not discover basic engineering ambiguity.

## Records

`report/plan.md` is the state machine. Keep it readable:

- put source facts, command evidence, measurements, report paths, and ids in
  concise node evidence or linked records;
- put blockers, regressions, residual risks, and open decisions next to the
  affected node;
- put bulky machine output in attachments;
- never let records replace the plan's current-node cursor or verdict.
