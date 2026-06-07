---
name: workspace-wakeflow-progressive-validation
description: Use when Wakeflow needs to link into a configured Progressive Chain Validation (PCV) source or validation artifact workspace for source-derived chain plans, scoped rounds, before/after metrics, scorecards, or PCV-guided workflow repair.
---

# Workspace Progressive Chain Validation Bridge

This is an optional Wakeflow bridge into an external Progressive Chain
Validation source. It does not redefine PCV and does not replace the workspace
`AGENTS.md` stop card, state root, dispatch rules, or controller acceptance.

Use this bridge only when the current state root, plan, or workspace
configuration explicitly names a PCV source checkout, validation artifact
workspace, or PCV run. Wakeflow must not assume a fixed repository name,
artifact directory, product overlay, or controller window.

## Source Of Truth

- Canonical PCV source repo: the repo named by the current state root, plan, or
  workspace config.
- Local PCV checkout: the path named by the current state root, plan, or
  workspace config.
- Validation artifact workspace: the path named by the current state root,
  plan, or workspace config.
- Expected PCV commit: optional; use only when the current task names a commit
  or revision constraint.

When PCV execution, planning quality, node contracts, metrics, overlays, or
templates matter, load the configured PCV source entrypoint first. Then load
only the references needed for the current task, such as metric contracts,
chain-plan generation rules, source adapters, overlays, or plan templates.

If the configured source checkout or revision cannot be verified, stop before
treating PCV output as current evidence. For discussion-only work, state that
the answer is based on available Wakeflow context rather than a verified PCV
source checkout.

## When To Use

Use this bridge when:

- A TODO, wave, state root, or user request explicitly mentions Progressive
  Chain Validation.
- A long workflow needs a source-derived node chain before implementation.
- A task needs before/after scorecards, useful-unit metrics, stage loss,
  trace/artifact/source-ref linkage, or a `blocked-by-observability-gap`
  decision.
- The workspace is deciding whether to run a broad smoke, split a node, add
  observability, or stop at a current-node boundary.

Do not use PCV as a generic replacement for normal workspace validation, TODO
bookkeeping, Wakeflow Delivery Loop delivery, or final acceptance. PCV is a
chain-planning and node-validation aid; controller judgment remains in
workspace `AGENTS.md` and the active Wakeflow state root.

## Workspace Routing

- Active PCV run artifacts live in the validation artifact workspace named by
  the current state root, plan, or workspace config.
- Long-term requirement and evidence records stay in the configured
  `wakeflow-ledger/` destination for the owning window or demand.
- PCV source changes belong in the independent PCV source repository, not in
  Wakeflow, unless the current plan explicitly assigns Wakeflow source work.
- Wakeflow records how it consumes PCV output. Runtime dispatch state and final
  acceptance stay under Wakeflow control; PCV node/round artifacts stay under
  the configured validation artifact workspace.

## Control Workflow

1. Apply the workspace stop card: state the user goal, current evidence,
   minimum closure, and first blocker.
2. Read the current state root, plan, and any PCV source/artifact coordinates
   they name.
3. Verify the configured PCV source checkout and expected revision when current
   PCV facts are needed.
4. Load the configured PCV method entrypoint, then the minimum relevant
   references.
5. Build the source chain map from real code before applying overlays or prior
   plans.
6. Decide whether this is plan-only, round execution, engineering repair
   packaging, live local-chain prep, or acceptance review.
7. For execution, advance only one current round/node at a time. Broad
   cold-start, rescan, daemon, or end-to-end commands are observation-only until
   prerequisite component nodes have passed.
8. Record verified PCV facts in the configured artifact workspace; do not turn
   PCV output into Wakeflow acceptance.

## Product-Specific Overlays

Product adapters and overlays are optional. Load only overlays named by the
current state root, plan, or verified PCV source map. An overlay is a coverage
oracle, not proof. If source boundaries disagree with the overlay, record the
split, merge, missing, or conditional mapping and keep the cursor on the first
unproven boundary.

## Boundaries

- Hard anti-failure rules, repository boundaries, Test usage limits, Wakeflow
  delivery limits, and acceptance rules stay in workspace `AGENTS.md`.
- PCV is not a default dispatch window. Treat it as a source or artifact
  capability unless a Wakeflow plan explicitly assigns work to the independent
  PCV repository.
- Do not copy canonical PCV references into Wakeflow to make local edits easier.
  Patch the PCV source repo when PCV itself needs changes.
- Do not run full cold-start, rescan, or end-to-end commands just to fill a PCV
  plan. If the current node cannot be isolated, first add or request
  observability, dry-run, or no-delivery support.
