---
name: wakeflow-target
description: Use when a target Codex window receives an exact Wakeflow v3 delivery, executes only its assigned TaskPackage, records a transport-bound TargetResult, or performs an authorized Controller return without taking controller authority.
---

# Wakeflow Target

Use this skill only inside the target window named by the current delivery.
Workspace and repository `AGENTS.md` files remain hard boundaries. The prompt
orients; the immutable TaskPackage owns complete task context; anchored
requirement documents own background; listed Skills own execution procedure.

## Prompt Shape

Target wakeups stay task-first and compact:

```text
Continue current window task: <currentWindow> / <taskId>.

Current objective (the task package is authoritative):
- <one-line objective>

Completion focus (up to two; full criteria are in the task package):
- <bounded observable result>
- <optional second bounded observable result>

- Priority context: <highest-priority confirmed fact>
- Critical boundary [forbidden|outOfScope|inScope]: <highest-priority boundary>

Key acceptance anchors (full probes and expectations are in the task package):
- <anchor id>: <claim>

Read before execution, in order:
- Task package (complete task context): <absolute package path>
- Requirement background entry: <document#section>
- Workspace instructions (only when distinct from repository instructions): <workspace>/AGENTS.md
- Repository instructions: <repository>/AGENTS.md
- Current state root: <absolute state-root path>

Required execution Skills (execution-process authority):
- skills/wakeflow-target/SKILL.md
- <other package-selected Skill>

Identity (full boundaries are in the task package):
- Current responsibility window: <window>
- Only working repository: <absolute repository path>

Before coding: map every `acceptanceAnchors` entry to a RED test or probe; return
needs-review instead of inventing a requirement when an anchor cannot be tested.

Return requirement:
- Execute only this TaskPackage and record a TargetResult with reproducible,
  target-authored review inputs. It is never controller acceptance.
- Test execution contract: <dispatch packet path>#testContract.executionContract

Dispatch record (routing and trace only):
- taskId: <taskId>
- taskPackageId: <package>
- stateRoot: <path>
- stateRevision: <revision>
- dispatchGroup: <group>
```

The prompt may omit conditional lines. It does not repeat the complete
requirement, boundary lists, probes, Test policy, commit policy, or result
contract. Read the TaskPackage first and treat prompt routing fields only as
freshness/navigation anchors.

## Target Flow

1. Confirm identity and authority.
   - Arrival proves only transport, not authorization beyond the exact
     envelope/TaskPackage.
   - Confirm the typed target window, task, demand, dispatch group, packet, and
     current delivery lineage. A title, cwd, or prompt assertion is not identity.
   - Read the listed workspace/repository `AGENTS.md` files and declare the one
     repository responsibility before changing anything.
2. Read the complete task.
   - Read the exact TaskPackage, ordered requirement refs, and every listed
     execution Skill.
   - Follow the packet's ordered `taskBriefing.requiredSkills`. Non-Test packets
     load `skills/wakeflow-target-craft/SKILL.md` and map each package anchor to
     a RED probe; Test packets load `skills/wakeflow-test/SKILL.md`.
   - If the packet carries `testContract`, pass the Test Alignment Gate below first.
3. Execute within the one assigned repository.
   - Do not claim another target, Test role, controller role, or repository.
   - If another repository or a product decision is required, stop and return a
     concrete blocker instead of widening scope.
4. Produce reviewable inputs.
   - Name changed files, diffs/commits, commands and outcomes, logs, reports,
     runtime observations, screenshots, and residual risks as applicable.
   - Prose alone is not completion evidence.
5. Import the TargetResult.
   - Call `wakeflow_record_target_result` with `operation: "import"`, the typed
     `demandId`, and `request:{artifact,transition}`. The transition is exactly
     `{eventId,createdAt,reason,decisionSummary}`. Do not write a local result
     file, inject an expected state selector, or choose an envelope by mtime.
   - The owner accepts only the strict current group → packet → target envelope
     → accepted/ambiguous run → settlement lineage. A first result for a new
     envelope is a new round, not a correction. Same-envelope correction must
     use the exact supersedes tuple selected by the owner.
   - Report `outcome` as `completed`, `blocked`, or `needs-review` honestly,
     with a non-empty summary, exact `repositoryChanges`, `evidenceLocators`,
     verification outcomes, risks, and `craftMapping`.
6. Perform a Controller return only when the strict current snapshot allows it.
   - Call `wakeflow_review_pack operation=group` for this demand/group. It is a
     read-only snapshot, not permission to inspect another group or decide
     acceptance.
   - When the current return unit is eligible, call
     `wakeflow_prepare_delivery operation=controller-preview`, inspect the exact
     result-set/review/binding digests, then call `controller-apply` with the
     confirmed plan. Immediately before the host effect call
     `controller-pre-send` and require its current redacted read model.
   - Send the stored prompt through the Codex host tool under its operation
     fence and make at most one bounded readback. Do not read a raw handle from
     `.wakeflow-local`; the host seam resolves it from the typed binding.
   - Record the observed fact with `wakeflow_record_delivery
     operation=controller-outcome`. This call is not the effect fence and a
     Controller return never acquires the target work lease.
   - An accepted, ambiguous, or sent-unconfirmed current result set is
     deduplicated and must not be resent. Rejected-before-send requires an
     explicit later rearm authority; do not invent retry state.

Target-to-target next-hop delivery is forbidden. Result import, review
inspection, Controller-return preparation, host effect, and outcome recording
remain separate operations.

## Test Alignment Gate

**TEST MUST NOT INVENT A TEST GOAL, GATE, OR METHOD OUTSIDE THE CONFIRMED
REQUIREMENT GOAL AND APPROVED TEST PLAN.**

For a dispatch packet with `testContract.executionContract`:

1. Explore only the assigned real-environment/diagnostic boundary; do not
   assume ownership of the controller's earlier validation.
2. Treat `requirementGoal` and `approvedPlan` as authority.
3. Map every operational step to one approved-plan item before execution.
4. Use only `allowedSkills`; unlisted methods, including PCV, are forbidden.
5. Follow the exact mode/setup policy. Restart/rebuild only when explicitly
   authorized with its reason.
6. Return an unmapped or unavailable step as blocked/needs-review before
   executing it.

A completed Test result maps each approved item exactly once with
`{kind:"test-step", planIndex, step, ref}`. The controller alone decides
whether evidence changes the verdict or Test plan.

## Stop Conditions

Stop and return a blocker when identity/lineage is missing or inconsistent,
required inputs are unavailable, the task crosses repository/role scope, an
acceptance anchor cannot be tested, a Test method is unapproved, or the next
repair would change a product decision. Never treat a bare prompt, stale
envelope, old result, or legacy local runtime as current authority.

## Result Contract

Every result is a strict `artifactKind:"wakeflow-target-result"` record. It
binds the immutable demand, `targetTaskId`, exact
`taskPackage:{taskPackageId,ref,digest}`, `assignment`,
`observedState:{revision,eventId,eventDigest}`, and exact
`transport:{group:{id,ref,digest},envelope:{id,ref,digest}}`. It also includes:

- `outcome` and a non-empty `summary`;
- for a product target, `repositoryChanges` containing exactly one
  `{repositoryId,disposition,commits}` entry matching the
  assigned repository; for Test, an empty `repositoryChanges` array;
- typed `evidenceLocators` entries `{kind,ref,digest}`, reproducible `verification`, and
  honest `risks`;
- for completed non-Test work, exactly one
  `{kind:"acceptance-anchor",anchorId,evidenceRefs:[{ref,digest}]}` mapping per
  package anchor, using only declared locator tuples;
- for completed Test work, exactly one
  `{kind:"test-step",planIndex,step,ref}` mapping per approved plan item, in
  plan order and pointing to one declared locator.

A same-envelope correction adds the exact `supersedes` result tuple selected by
the owner. A first result or new delivery-envelope round must not invent one.

Structural completeness makes a result eligible for controller review. It
does not verify claims and is never automatic acceptance. Do not place raw
thread handles, private absolute paths, or machine-specific cache paths in the
result.
