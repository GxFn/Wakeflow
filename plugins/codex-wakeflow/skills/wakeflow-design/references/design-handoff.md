# Design Handoff

Use this method to determine whether Design input is ready for controller
delivery and to build a compact, traceable submission.

## Iron Law

**NO `wakeflow_deliver` CALL UNTIL THE DESIGN AND ITS SUBMISSION ARE EXPLICITLY CONFIRMED.** A complete-looking draft, controller interest, or planned `Auto Claim` cell is not confirmation.

## Preserved Method

- Reference existing artifacts instead of copying them.
- Separate verified fact, Design recommendation, user/controller decision, and
  unresolved question.
- Redact secrets, private handles, local runtime paths, and unrelated personal
  data.
- Preserve non-goals, risks, source references, and the next required judgment.

## Readiness Review

Check that the proportional demand input contains the roles required by its
type and that every reference is resolvable and current. For a substantial
requirement, this includes the confirmed original plan, requirement design,
code facts, landing intent, non-goals, answered user decisions, and Test
decision. A bug, supplement, or research item uses its smaller but still
complete authority set.

Return one readiness state:

- `ready-for-controller-delivery`
- `needs-user-decision`
- `needs-clarification`
- `needs-option-planning`
- `needs-requirement-design`
- `blocked`

## Handoff Format

```markdown
## Design Handoff

- Goal:
- Verified facts:
- Confirmed decisions:
- Design recommendations:
- Open questions:
- Non-goals:
- Risks:
- Completion evidence:
- Testing decision:
- Required controller judgment:
- Suggested next action:
- Source artifacts:
- Redaction notes:
- Readiness:
```

## Delivery Procedure

1. Present the compact handoff and readiness result in conversation.
2. Obtain explicit user/controller confirmation of the design scope and the
   request to submit it.
3. If any required role, answer, reference, digest, or confirmation is missing,
   do not deliver; return the exact upstream gap.
4. Call `wakeflow_view` with
   `{ root, operation: "config", request: {} }`. From
   `result.topology.windows`, resolve this exact Design `windowId` and the sole
   controller `windowId`. Missing, duplicate, or conflicting identity blocks
   delivery.
5. Call `wakeflow_next_work` with
   `{ root, operation: "inspect", request: {} }` and retain its
   `result.contentDigest` as `expectedBoardDigest`. Do not reconstruct a digest
   from rendered text.
6. Build one row containing exactly these 13 string fields:

   ```text
   ID
   Status
   Type
   Priority
   Owner
   Item / Goal
   Affects Retest / Dispatch
   Dependency / Trigger
   Recommended Window
   Current Mount
   Auto Claim
   Testing Decision
   Documents
   ```

   Use an unused portable opaque `ID`; `pending-claim` only for ready work and
   `parked` only for an explicitly confirmed dependency wait; one of
   `requirement|bug|supplement|research`; one of `P0|P1|P2|P3`; the exact Design
   `windowId` as `Owner`; the exact controller `windowId` as
   `Recommended Window`; `none` as `Current Mount`; and `yes|no` for both
   boolean cells. A parked row should use `Auto Claim: no`. `Testing Decision`
   must be `<controller-only|real-environment|not-applicable>: <summary>`;
   research requires `not-applicable`, while every other type forbids it.
   `Documents` must be one or more canonical Markdown authority links separated
   by one space: each label starts with a letter and uses only letters, digits,
   or hyphens; each target is a portable relative file reference with at most
   one optional anchor. Never include secrets, absolute paths, URLs, or private
   host identities.
7. Call `wakeflow_deliver` exactly once with
   `{ root, operation: "append", request: { row, expectedBoardDigest } }`.
8. Report the delivery result. Do not edit, re-status, replace, claim, dispatch,
   or accept from the appended controller-owned row.

The current append owner validates the exact row shape, vocabulary, duplicate
ID, and board CAS. It does not resolve the `Documents` targets, validate their
digests or role completeness, promote a draft, or freeze `demand-authority`.
Design must still refuse incomplete input. When the submitted item will need a
TaskPackage, the controller must independently resolve the references and put
the proportional authority in the initial `wakeflow_create_demand`
publication; the current public surface has no later authority-promotion
operation.

The `Auto Claim` row cell changes only whether the controller may later claim
an already ready item unattended. It never confirms a design or relaxes
delivery readiness.

Do not create a parallel Markdown handoff transport, mutate TODO state by hand,
or hide a scope change in the summary.
