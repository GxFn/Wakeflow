# Window Dispatch Reference

## Dispatch Authority

The controller owns dispatch decisions across all configured product windows,
Design, and Test. It must identify affected repositories from code, docs,
builds, runtime packages, plugin assets, dashboard outputs, and release paths,
not only from the repository named by the user.

Design participates in requirement discussion, signal judgment, non-bug outcome
redesign, and handoff drafting. On the mainline, Design uses its stateless
`wakeflow_deliver` path and is not a product dispatch target. Inside an
explicitly authorized Pod, `Controller__<pod>` first freezes a
`PodDesignRequest` with `wakeflow_pod_plan action=design-request`, sends that exact
request directly to `Design__<pod>`, and records the matching
`PodDesignHandoffEnvelope` with `wakeflow_pod_record event=design-handoff`;
the same-demand handoff never creates a second
global TODO or routes through mainline Design. Test is included only when
real-scenario evidence is required.

## Placement And Binding Gate

**NO PRODUCT DISPATCH BEFORE THE EXECUTION SURFACE IS VERIFIED.**

| Surface | Required fact |
| --- | --- |
| mainline | selected by default, healthy, idle, exact configured repository |
| Pod | explicit user `authorizationRef`, `execution-ready`, verified host binding |

A busy mainline waits. Missing/unhealthy required mainline identity returns
`mainline-unavailable` before demand/TODO mutation and is repaired; neither
condition authorizes a Pod. Pod product dispatch resolves cwd and Git identity
only from the host-scoped binding receipt. Never derive it from a window
suffix, static config overlay, parent workspace, or prompt assertion.

Journal the exact launch correlation around the Claude helper call. The helper
returns the final session id synchronously: Claude has no Codex
`clientThreadId` pending state, and no temporary request id belongs in the
registry.

Pod Test has one extra gate: prepare and record the independent Test access
probe. Dispatch opens only for `validated` + `direct-multi-root` coverage of
every active product binding. Unsupported access stays blocked; do not
substitute a main checkout, a product window, or an unverified per-repository
executor.

## Identity Gate

Every task package must preserve the full identity boundary. The compact prompt
must navigate to that package and the applicable instruction files, and must
surface the current window, repository, and highest-priority boundary. The
tmux-resident target then:

- read parent `CLAUDE.md`;
- read the current state root or controller document;
- read the target repository `CLAUDE.md`;
- state the current window, repository, and responsibility;
- confirms the complete in-scope, out-of-scope, and forbidden lists from the
  package before execution.

If the target cannot confirm identity, it stops and reports a blocker.

For a Pod product window, identity must also match its verified binding
(`podId`, repository, actual worktree root, Git common dir, base HEAD, and
`mainCheckout=false`). Identity text cannot repair a failed binding.

A dispatch prompt arrives as a user message pasted into the target's tmux pane
by the host helper. Arrival proves transport only; it never grants identity or
authority.

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
and recurring-problem signal. New scope cannot branch while that rework route
is active; after the original task is accepted, the controller may add a
separate supplemental package. A `redesign` decision is different: Design delivers the
corrected requirement through its stateless path, then the controller adds a new
full-context implementation task in the product responsibility window with
`replacesTargetTaskId` pointing to the parked task. The old
redesign task cannot be re-dispatched; accepting the replacement marks it
`superseded`.

For Pod redesign, never use the mainline stateless Design path. The current implementation
has only one immutable Pod Design request/handoff slot, so a later redesign is
a capability blocker; do not author a replacement until a next-generation Pod
Design lineage exists.

Dispatch by task package, not tiny fragments. A task package should group
mainline work, same-window TODOs, and evidence work that share the same boundary
and validation path.

New task packages record the dispatch context once in machine-readable fields:

- `workType`: implementation, research, documentation, or test;
- `objective`: one observable outcome for this target;
- `contextSummary`: a small ordered list of confirmed facts;
- `requirementRefs`: workspace-relative document references. Goal, completion,
  constraint, validation, and design references name an exact Markdown
  `#anchor`; background stays in the document instead of being copied into the
  prompt;
- `boundaries`: explicit `inScope`, `outOfScope`, and `forbidden` lists;
- `completionExpectations`: concrete results required before `completed`;
- `dependsOnTaskIds`: real upstream task ids, all controller-accepted before
  dispatch;
- `commitExpectation`: `commit` or `leave-uncommitted`.

The JSON task package is the complete per-target context. Requirement documents
remain the original goal/background authority. Skills remain the execution
procedure. Do not introduce a second context document or ask the target to
reconstruct these fields from progress prose.

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

Current objective (the task package is authoritative):
- <one-line objective>

Completion focus (full criteria are in the task package):
- <up to two ordered observable results>

- Priority context: <highest-priority confirmed fact>
- Critical boundary [forbidden|outOfScope|inScope]: <highest-priority boundary>

Key acceptance anchors (full probes and expectations are in the task package):
- <up to four anchor ids/claims>

Read before execution, in order:
- Task package (complete task context): <absolute package path>
- Requirement background entry (full anchors are in the task package) [goal]: <document#section>
- Workspace instructions: <workspace>/CLAUDE.md
- Repository instructions: <repository>/CLAUDE.md
- Current state root: <absolute state-root path>

Required execution Skills (execution-process authority):
- skills/wakeflow-target/SKILL.md
- <craft or Test skill when selected by the package>

Identity (full boundaries are in the task package):
- Current responsibility window: <window>
- Only working repository: <absolute repository path>

Before coding: map every package acceptanceAnchor to a RED test or probe; if an
anchor is untestable, return needs-review instead of inventing a requirement.

Return requirement:
- Execute only this task package. Return a TargetResultEnvelope with verifiable
  evidence. A target result is not controller acceptance.
- Test execution contract: <package>#testExecution

Dispatch record (routing and trace only):
- taskId: <taskId>
- taskPackageId: <package>
- stateRoot: <path>
- stateRevision: <dispatch-snapshot-revision>
- dispatchGroup: <group>
```

Anchor, RED, workspace, and Test lines are conditional. Prompts stay bounded:
objective, at most two ordered completion expectations, one priority-context
fact, one critical boundary, at most four anchor ids/claims, one original
requirement entry, and ordered navigation. Full context, requirement anchors,
boundary lists, commit policy, probes, validation commands, evidence fields,
and Test contracts stay in the task package or listed instruction/Skill files.

Before writing transport files, run the target prepare as a preview and inspect
`readiness`, `taskBriefing`, the resolved repository root, required Skills, and
the exact prompt. Only a correct preview is repeated with `apply=true`, passing
the preview's `previewDigest` as `expectedPreviewDigest`. The digest covers the
package, state revision, resolved repository, prompt, and transport
configuration; any change requires a new preview. Preview must not create a
packet, envelope, window config, or target work lease.
