# Planning, delivery and review

Read this when you reach step 6, 7, 8, 10, 11 or 12. It is Controller depth;
the boundaries are in `SKILL.md`.

## Step 6 - Writing a task package

A task package is an immutable contract between you and one target window. It
is appended, never edited: a changed mind is a new package with declared
lineage, not a correction.

`wakeflow_plan_target_task` appends one package. What you write:

- **Assignment** - which repository and which work type.
- **Goal** - one paragraph a target can restate in a sentence. If you cannot
  write it that way, the task is still two tasks.
- **Boundary** - what is explicitly out of scope. This is the most valuable
  paragraph you write, because it is what stops a target from "improving"
  code no one reviewed.
- **Completion expectation** - what must be true and observable when the work
  is done.
- **Acceptance anchors** - each one bound to an acceptance-criteria item that
  exists in the requirement package. An invented anchor is refused; that
  refusal is protecting the trace from requirement to result.

What Wakeflow derives and you must not restate: the window, the environment,
the baselines.

Lineage rules that decide which call you make:

- First package for a repository in this Demand: no lineage.
- After a redesign decision: a replacement package. The old target and package
  become superseded.
- Follow-up work on a finished Demand: a continuation package, reached through
  `wakeflow_continue_demand` first.
- Re-testing after remediation: a retest package.

One active lineage per repository. A second unfinished target in the same
repository is refused - finish or supersede the first.

A test package additionally carries the frozen test contract: the approved
steps bound to acceptance-criteria items, the allowed skills, the setup, the
attempt budget and the stop conditions. Freeze it deliberately, because the
test window is not allowed to revise it.

When the requirement package asks for user review of the task plan, show the
plan to the user and get their answer before applying. That is the flow's
second confirmation point.

## Step 7 - Preparing a delivery

`wakeflow_prepare_delivery` does the whole preparation in one call: it takes
the window work claim, renders the prompt skeleton around your three
paragraphs, appends the envelope with its fence token, and returns a one-shot
permit.

Your three paragraphs are the only part a target reads first, so write them as
instructions to a competent colleague who has not been in this conversation:
what to achieve, where to focus, what not to touch. Do not restate the package
- the target reads it - and do not put an absolute local path or a handle in
them.

A target is preparable when it is planned, when a rework was requested, when a
product-defect rework was authorized, or when its re-arms are exhausted and it
needs a fresh envelope. Anything else is refused because the target already
has work in flight.

Replaying the same preparation key returns the first permit and the same
fence. That is the correct response to "did my last call go through" - replay,
do not prepare a second delivery.

## Step 8 - The host effect and its evidence

This is the one place where a confident report is most likely to be wrong, so
the rule is blunt: performing the send is not evidence that it landed.

Wakeflow derives the disposition itself:

- **accepted** - the target session produced a `user-prompt-submit` hook
  record whose prompt digest matches the envelope's, or the host's own send
  call returned success. Nothing else accepts.
- **rejected-before-send** - the send call itself failed without touching the
  session. Only then is the work claim released and only then may the delivery
  be re-armed.
- **indeterminate** - everything else, including a readback that failed. The
  claim is retained and the delivery is never resent.

On Claude Code the helper's `deliver` output carries that lookup for you as
`landing`: `observed` with the record id means the prompt was submitted in the
bound session and the outcome will be accepted; `pending` means no record
appeared within the wait. A prompt pasted while the window is mid-turn is
queued by Claude Code and still gets its record at once, so pending usually
means the wrong or a dead window - record the outcome as the helper reported
it and let Wakeflow decide. Readback is only screen text and never proves
landing.

An indeterminate delivery is not a dead end. When the landing evidence arrives
later, call `wakeflow_record_delivery_outcome` again with a new idempotency
key and the same delivery; it will accept then.

`wakeflow_rearm_delivery` re-issues the permit for a rejected-before-send
delivery with a fresh claim and fence, at most three times per envelope. After
that, prepare the target again for a new envelope.

Never resend a prompt by hand because a window "looks idle". Duplicate work in
a target window is expensive and invisible until the results disagree.

## Step 10 - Inspecting the review unit

`wakeflow_inspect_target_result_review` is read-only and runs no checks. It
shows the task package, the authority-enriched result, prior decisions, the
callback landing, the target session's completion evidence, the decisions the
rules currently allow, and for a test result the per-step record beside its
approved baseline.

Reading it is what acknowledges the callback. Then do the work it cannot do:

1. Read the actual diff and the actual evidence. The report's self-assessment
   is a claim, not a finding.
2. Check each acceptance anchor against what you observed, not against what
   the report says about it.
3. Notice what is missing. An anchor answered with a confident sentence and no
   evidence is the most common failure you will see.

The callback is sent before the target window's turn ends, so a unit read
seconds after the callback may still show the target's completion record as
pending. That is timing, not a missing record: read the unit again after the
window goes idle instead of deciding around it.

If the set of allowed decisions does not contain what you want to record, the
reason is in the unit: the target's completion evidence has not arrived yet, or
the Demand is waiting on a decision. Fix the cause; do not look for another
tool.

## Step 11 - Recording a decision

Implementation results take `accept`, `rework`, `blocked` or `escalate`
through `wakeflow_record_implementation_review_decision`. Accept requires the
target session's own completion record - you cannot accept work whose window
never finished its turn - and one of two groundings: a `completed` result,
whose report already ties every anchor to managed evidence, or a
`needs-review` result together with your own `anchorEvidence`, one entry per
acceptance anchor naming the managed evidence you recorded for this Demand.
An accept that leaves an anchor unbound, or names evidence this Demand does
not hold, is refused.

Rework names at least one `failed` independent check. The failed checks are
exactly the corrections the target receives with the rework delivery, so a
rework whose checks all passed is refused when recorded - it could never be
delivered. Use rework when the change itself must be fixed. When the work is
right and only the report lacks evidence - a `needs-review` result is the
common case - do not send it back: record the evidence, verify each anchor
yourself and accept with `anchorEvidence`. Rework's
`implementationQuality` says what you found: `satisfactory` when the change is
right and only the report is redone, `unverified` when you could not verify it,
`defective` when the change itself is wrong. Accept stays `satisfactory` only.

Test results take `accept`, `request-another-attempt`, `blocked` or `escalate`
through `wakeflow_record_test_review_decision`. The step classifications gate
the choice: another attempt only for harness defects, flakiness or missing
evidence and only inside the attempt budget; blocked for environment failures;
escalate with a product defect, which authorizes remediation on the affected
implementation targets in the same commit.

Write the decision in your own words and make the reason checkable: name the
anchor, the file, the evidence. "Looks good" is not a review.

On escalate, hand the user the issue, the options and your recommendation, then
bring their answer back with `wakeflow_continue_demand` in its
record-decision action. A Demand that is waiting on a decision moves for no
other reason.

After a decision that needs a follow-up decision - one recorded while blocked
or escalated - carry the resumption the unit gave you. Recording a decision
without it is refused rather than silently overwriting the escalation.

## Step 12 - Completion, cancellation and continuation

`wakeflow_complete_demand` previews the gates and lists blockers without
writing, then applies as one transaction: the completion event, the sealed
archive under the ledger with its verify report, the requirement package marked
archived, and the active root deleted. Run the preview early enough that the
blockers are still cheap to fix.

`wakeflow_cancel_demand` ends a non-terminal Demand with a reason. Results and
evidence are kept, the work claims are released, the requirement package is
withdrawn. A pending review result refuses the cancel - decide it first.

`wakeflow_continue_demand` reopens a completed Demand from its archive for
optimization, a requirement supplement or a verified bug. The active root is
restored and the route asks for a new task package before anything else.

All three take preview, apply and recover, and all three delete or restore an
active root. Read the preview to the user before you apply any of them.
