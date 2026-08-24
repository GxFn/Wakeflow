# Progressive Chain Round Model

Progressive chain validation uses rounds because one pass over a long chain
cannot honestly prove every layer. A round has a narrow evidence scope, a clear
entry condition, and a bounded verdict. Later rounds add stronger evidence
without rewriting the meaning of earlier rounds.

## Round Purpose

A round answers one question:

```text
Under this exact evidence scope, did the selected chain segment improve,
regress, pass, or remain blocked?
```

The first round is allowed to be limited. Its value is to reveal chain shape,
data boundaries, deterministic engineering gaps, and metric baselines. It must
not pretend to be full runtime, live provider, user-interface, or delivery
acceptance.

## Round Types

| Round Type | Evidence Scope | Purpose | May Prove | Cannot Prove |
| --- | --- | --- | --- | --- |
| `R-discovery` | source + unit + fixture | map chain, find engineering gaps, define metrics | chain shape, deterministic contracts, fixture behavior | live runtime, provider quality, delivery safety |
| `R-engineering-repair` | source + unit + fixture + targeted integration | fix deterministic gaps and rerun same metrics | before/after improvement under stable fixtures | live provider quality, real project behavior |
| `R-runtime-smoke` | runtime, no live delivery | run safe local runtime boundaries | write roots, session/report wiring, lifecycle health | provider quality unless live provider is enabled |
| `R-live-local` | live provider or external service, local chain segment | validate one model/service-backed stage at a time | scoped analyze/producer/consumer behavior | full product acceptance |
| `R-expansion` | broader inputs, dimensions, or scenarios | expand from one fixture to multiple variants | missing/failed variants, timeouts, scorecard consistency | delivery/export safety |
| `R-ui-observability` | runtime + UI/manual observation | verify user-visible job/process/report surfaces | UI/job observability and cancellation behavior | content quality unless paired with live evidence |
| `R-delivery` | authorized delivery/export/write surface | verify final write surfaces | delivery safety and exported artifacts | earlier quality if not already proven |

## Required Round Fields

Every round record should include:

| Field | Meaning |
| --- | --- |
| `roundId` | Stable id, for example `R1-engineering-discovery`. |
| `roundType` | One of the round types above. |
| `chainSegment` | Whole chain or local segment under review. |
| `evidenceScope` | `source`, `unit`, `fixture`, `runtime`, `live`, `ui`, `delivery`, or another explicit scope. |
| `entryGate` | What must already be true before the round starts. |
| `allowedActions` | What commands/actions may run. |
| `forbiddenActions` | What remains out of scope. |
| `metrics` | The metric set used by this round. |
| `expectedArtifacts` | Plan, records, issues, progress, attachments, reports. |
| `verdictMeaning` | Exact meaning of `pass`, `improved`, `regression`, or `blocked` for this round. |
| `nextRoundCandidates` | Safe next rounds if this one passes. |

## Round Data Semantics

Data is evidence scoped to its round.

- `R-discovery` data is good for design, task packaging, and deterministic bug
  fixes.
- `R-engineering-repair` data is good for before/after engineering comparison.
- `R-live-local` data is good for provider-dependent chain metrics.
- `R-ui-observability` data is good for user-visible job/status/report behavior.
- `R-delivery` data is good for final write surfaces.

Do not combine data from different rounds into one verdict unless the
comparison explicitly says how scopes differ.

## Verdict Scope

Every node verdict must carry a scope:

```text
pass(scope=fixture)
pass(scope=runtime)
blocked(scope=ui-observation)
improved(scope=targeted-integration)
```

Plain `pass` is not enough for progressive chain work.

## Round Completion

A round is complete when:

- the current node set has verdicts within the declared scope;
- data and issue records are updated;
- unresolved risks are typed as product risk, test gap, probe error, expected
  boundary, runtime placeholder, or user decision gap;
- the next round is either named or explicitly left unopened.

Completion does not imply final product acceptance unless the round type and
evidence scope say so.
