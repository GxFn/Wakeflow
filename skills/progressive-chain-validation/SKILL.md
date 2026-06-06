---
name: workspace-progressive-chain-validation
description: Use when ControlWorkspace needs to link into the external Progressive Chain Validation (PCV) canonical source or the local PCVM workspace for source-derived chain plans, scoped rounds, node-level cold-start/rescan baselines, before/after metrics, scorecards, or PCV-guided workflow repair.
---

# Workspace Progressive Chain Validation Bridge

This is the ControlWorkspace bridge into the external PCV canonical source and the local PCVM artifact workspace. It does not redefine PCV and does not replace the workspace `AGENTS.md` stop card.

For PCVM flow control, load these first:

```text
PCVM/skills/pcvm-flow-controller/SKILL.md
PCVM/config/pcvm-flow-control.json
```

The old route of treating `.workspace-active/workspace/current/` as the PCVM state machine is retired unless a user explicitly asks to update total-control current documents. PCVM run state, scoped round evidence, engineering repair packages, and AI local-chain placeholders live under `PCVM/`.

## Source Of Truth

- Canonical PCV source repo: `https://github.com/GxFn/progressive-chain-validation.git`
- Expected local checkout from the parent workspace root: `progressive-chain-validation/`
- Canonical method package inside that checkout: `progressive-chain-validation/progressive-chain-validation/`
- Current observed source commit: `3322646aa57c67c164eec20626ec5edd9d05b113`

When PCV execution, planning quality, node contract, metrics, overlays, or templates matter, load the canonical package from the local checkout first:

```text
progressive-chain-validation/progressive-chain-validation/SKILL.md
```

Then load only the canonical references needed for the current task, such as:

- `references/metrics-contract.md` for baseline / candidate / comparison / verdict work.
- `references/chain-plan-generation.md` for deriving nodes from source boundaries.
- `references/overlays/alembic-coldstart-rescan.md` for Alembic cold-start or rescan work.
- `templates/plan.md` when producing a PCV plan artifact.

If the local checkout is missing or the commit cannot be verified, stop before treating PCV results as current evidence. For discussion-only work, say that the answer is based on workspace ledger memory rather than a verified PCV source checkout.

## When To Use

Use this bridge when:

- A TODO, wave, or user request mentions PCV / PCVM / Progressive Chain Validation.
- A long workflow needs a source-derived node chain before implementation.
- The task is cold-start / rescan optimization and needs node-level baseline evidence.
- The task needs before/after scorecards, useful-unit metrics, stage loss, trace/artifact/source-ref linkage, or a `blocked-by-observability-gap` decision.
- The workspace is deciding whether to run a broad smoke, split a node, add observability, or stop at a current-node boundary.

Do not use PCV as a generic replacement for normal workspace validation, TODO bookkeeping, Codex Automation Closed Loop delivery, or final acceptance. PCV is a chain-planning and node-validation tool; total-control judgment remains in workspace `AGENTS.md`.

AlembicWorkspace owns judgment, dispatch, acceptance, and Test handoff. PCVM owns the PCV plan artifact, round records, metrics, issue records, and task-package design candidates. Do not use PCVM artifacts to close Workspace TODOs or product acceptance without total-control review.

## Workspace Routing

- Active PCVM run artifacts live under `PCVM/scratch/chain-runs/<run-id>/report/`.
- `PCVM/skills/pcvm-flow-controller/SKILL.md` and `PCVM/config/pcvm-flow-control.json` are the first route-control files for PCVM work.
- Long-term Alembic PCVM requirements live in `workspace-ledger/requirement-designs/progressive-chain-validation-metrics/`.
- Per-repository PCVM evidence remains under the relevant `workspace-ledger/<WindowName>/` folder.
- PCV source changes belong in the independent `progressive-chain-validation/` repo, not in `codex-control-workspace/`.
- This bridge directory only records how ControlWorkspace consumes PCV and PCVM. Runtime dispatch state and final acceptance stay under AlembicWorkspace control; PCVM node/round artifacts stay under `PCVM/`.

## Control Workflow

1. Apply the workspace stop card: state the user goal, current evidence, minimum closure, and first blocker.
2. Read `PCVM/skills/pcvm-flow-controller/SKILL.md` and `PCVM/config/pcvm-flow-control.json`.
3. Read the active PCVM run plan and records.
4. Verify the PCV source checkout when current PCV facts are needed:

   ```text
   git -C progressive-chain-validation rev-parse HEAD
   # or, when already inside codex-control-workspace:
   git -C ../progressive-chain-validation rev-parse HEAD
   ```

5. Load canonical PCV `SKILL.md` as the method entrypoint, then the minimum relevant PCV references.
6. Build the source chain map from real code before applying overlays or prior plans.
7. Decide whether this is plan-only, round execution, engineering repair packaging, live AI local-chain prep, or acceptance review.
8. For execution, advance only one current round/node at a time. Broad cold-start, rescan, daemon, or end-to-end commands are observation-only until prerequisite component nodes have passed.
9. Record verified PCVM facts under `PCVM/scratch/chain-runs/<run-id>/report/`; do not turn PCVM output into total-control acceptance.

## Alembic Cold-Start Shortcut

For Alembic cold-start / rescan optimization, load the canonical Alembic adapter and cold-start overlay after the source map exists:

```text
progressive-chain-validation/progressive-chain-validation/references/adapters/alembic.md
progressive-chain-validation/progressive-chain-validation/references/overlays/alembic-coldstart-rescan.md
```

The overlay is a coverage oracle, not proof. If Alembic source boundaries disagree with the overlay, record the split / merge / missing / conditional mapping and keep the node cursor on the first unproven boundary.

## Boundaries

- Hard anti-failure rules, repository boundaries, AlembicTest usage limits, Codex automation limits, and acceptance rules stay in workspace `AGENTS.md`.
- PCV is not a default dispatch window. Treat it as a skill source unless a control plan explicitly assigns work to the independent PCV repository.
- Do not copy canonical PCV references into ControlWorkspace to make local edits easier. Patch the PCV repo when PCV itself needs changes.
- Do not run full cold-start / rescan just to fill a PCV plan. If the current node cannot be isolated, first add or request observability / dry-run / no-delivery support.
