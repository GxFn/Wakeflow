# Window Dispatch Reference

## Dispatch Authority

The controller owns dispatch decisions across all configured product windows,
Design, and Test. It must identify affected repositories from code, docs,
builds, runtime packages, plugin assets, dashboard outputs, and release paths,
not only from the repository named by the user.

Design participates in requirement discussion, signal judgment, non-bug outcome
redesign, and handoff drafting — but through Design's own stateless `wakeflow_deliver`
path, not as a controller dispatch target. The controller does not build a dispatch
packet or delivery envelope for Design; on a `redesign` review decision it parks the
demand and surfaces it to Design, then resumes the same demand with `add-task-package`
once Design delivers the corrected requirement. Test is included only when real-scenario
evidence is required.

## Identity Gate

Every task package and copyable prompt for an execution window must require the
target to:

- read parent `AGENTS.md`;
- read the current state root or controller document;
- read the target repository `AGENTS.md`;
- state the current window, repository, and responsibility;
- state what the window is not responsible for.

If the target cannot confirm identity, it stops and reports a blocker.

## Coverage And Dependencies

Separate final coverage from currently dispatchable windows. A window can be in
the coverage table while still blocked by an upstream producer. Producers create
contracts, types, artifacts, APIs, schemas, release outputs, or migration
evidence. Consumers wait until upstream evidence is backfilled.

Do not let downstream windows guess fields, copy temporary contracts, create
fallbacks, or run empty validation before upstream evidence exists.

## Task Packages

Within one demand each repository runs exactly ONE window with ONE combined
task package: the window self-sequences the package's items, and a window is
never dispatched two simultaneous tasks inside the same demand (the machine
refuses a second in-flight dispatch to the same window). More work for that
repository arrives as the NEXT combined package after review.

Every package's completion definition must state its COMMIT expectation: does
the repo window commit the work (repo windows own their commits), or leave it
uncommitted for controller/user review? Silence here leaves accepted-and-
archived work sitting uncommitted on a main checkout with nobody owning the
decision — say it in the package, and check it at acceptance.

An explicit controller `rework` normally re-dispatches the same target task and
package with a fresh dispatch group. This preserves that task's `reworkCount`
and recurring-problem signal. Add a rework companion package only when the
review truly changes or extends task scope; never create one merely because the
state is `needs-rework`. A `redesign` decision is different: route a new Design
outcome package and do not re-dispatch the product task.

Dispatch by task package, not tiny fragments. A task package should group
mainline work, same-window TODOs, and evidence work that share the same boundary
and validation path.

Each task package must state:

- current phase goal;
- included mainline tasks;
- TODOs it can close;
- explicit non-goals;
- file/module boundary;
- dependencies;
- unified validation command;
- backfill requirements;
- how it advances the final completion definition;
- whether completion leads to next phase, observation, archive, or user
  decision.

For implementation packages, add a small `acceptanceAnchors` array derived
only from confirmed requirement authority. Each `{id, claim, probe, expected}`
entry names one behavior the target must pin as RED before coding. This is not a
second test plan: omit it for doc-only/research work, and route an unstated
requirement back to Design/user instead of inventing an anchor.

## Status Rules

State-machine sources should store machine ids and let
`scripts/lib/wakeflow-status-machine.mjs` render labels. Legacy display text is
migration input only.

- `completed`, `observing`, `none`, `idle`, and `paused` are not send targets.
- `blocked` is sent only when it owns the unblock step or the upstream blocker
  has been cleared.
- `pending` is allowed only for work that can independently execute and
  validate without conflicting with the mainline.

## Standard Prompt

```text
Continue current window task: <currentWindow> / <taskId>.

Task focus (full authority remains in the task package):
- <one-line objective>

Variables:
- currentWindow: <window>
- taskId: <taskId>
- taskPackageId: <package>
- stateRoot: <path>
- stateRevision: <dispatch-snapshot-revision>
- dispatchGroup: <group>
- skill: skills/wakeflow-target/SKILL.md
```

Prompts must stay short. Detailed goals, validation commands, forbidden paths,
evidence fields, and test inference boundaries belong in the state root, task
package, repository `AGENTS.md`, or skill references. When acceptance anchors
exist, add only the craft-skill and anchor pointers plus the pre-code RED
reminder; do not copy the anchor bodies into the prompt.
