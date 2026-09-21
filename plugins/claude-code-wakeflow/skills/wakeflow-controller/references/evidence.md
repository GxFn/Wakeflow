# Managed evidence

Read this before you call `wakeflow_record_evidence`. It is Controller depth;
the boundaries are in `SKILL.md`.

## Why evidence is a record and not a paste

A claim inside a conversation cannot be re-checked later. A managed evidence
record can: it is immutable, its identity derives from its content, and a
result that cites it is checked against its digest at import time. That is what
makes "the tests passed" reviewable six weeks later instead of merely
remembered.

So the rule for the whole flow is: anything a decision will rest on gets
recorded before the decision, not described after it.

## What can become evidence

Four sources, and nothing else:

- A file or a directory tree under a root the config already knows about - a
  product repository, a surface, the ledger.
- One host hook observation record, projected without its session handle.
- An https link.
- A commit reference.

Each record also carries a kind from a closed vocabulary. The kind is what a
later result may cite it as: citing a document record as though it were test
output is refused, and that refusal is the point - it stops a plausible
sentence from standing in for a run that never happened.

## The procedure

1. Preview. It derives the plan and writes nothing, and it tells you whether
   this exact content is already recorded.
2. Read what the preview says about privacy and about opaque members before
   you decide anything.
3. Apply with exactly what preview returned.
4. If an apply is interrupted, finish it with recover.

Because identity derives from content, recording the same content twice is not
a duplicate: the second call reports it as already recorded and returns the
same record. Re-recording is therefore a safe thing to do when you are unsure,
and a cheap way to confirm a file has not changed since you looked.

## Privacy, and the two things you may confirm

The scan runs on every record and the outcomes are not symmetric:

- A credential finding always blocks. There is no confirmation that lets it
  through, and there is no version of the situation where the right move is to
  strip the string and retry without telling the user what was in their file.
- An opaque member - a binary or a file with control characters - and an
  unlisted absolute path are blocked until you confirm them explicitly. That
  confirmation is a decision you are making on the user's behalf about what
  leaves their machine, so make it deliberately: look at what the preview
  listed, and confirm only the members you actually understand.

Never confirm a tree you have not looked at because the preview was long.

## Choosing what to record

Record the artifact that would let a reviewer reach your conclusion
independently:

- The command output that shows the run, not a summary of it.
- The file whose content is in question, at the revision in question.
- The hook observation that proves a window did what it was said to have done.
- The commit that carries the change.

Do not record an entire repository tree because it is easier than choosing.
Large opaque trees push the confirmation decision onto you for members you
cannot inspect, and they make the archive worse, not stronger.

Do not record a report as evidence for itself. A target's own report is already
the result; citing it back as evidence of its own truth proves nothing.

## How evidence is used downstream

A target cites evidence by locator and digest inside its report. At import,
Wakeflow resolves each locator inside this Demand's records and checks the
digest; an unresolved locator or a mismatched digest refuses the import. A test
step's observation is bound to its evidence the same way.

At completion, the evidence integrity gate reads these records again. Evidence
that was recorded carelessly becomes a blocker at the least convenient moment,
which is a good reason to record it carefully at the convenient one.
