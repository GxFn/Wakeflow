import { equal, throws } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  captureSchemas,
  frozenTestContext,
  implementationBaseline,
  selectEnvelope,
  selectResult,
} from "../../../tooling/capture/contracts.js";
import { canonicalDigest } from "../../../tooling/capture/io.js";
import { prepareCapture } from "../../../tooling/capture/plan.js";
import { captureFixture, writeJson } from "./capture.fixture.js";

test("schema, digest and reference mismatches fail without creating a capture plan", (t) => {
  const f = captureFixture(t);
  const schemas = captureSchemas(f.repository);
  const context = frozenTestContext(f.pkg, f.envelope, undefined, schemas);
  throws(
    () => frozenTestContext({ ...f.pkg, objective: "altered" }, f.envelope, undefined, schemas),
    /capture-contract-relation/u,
  );
  throws(
    () =>
      selectEnvelope(
        { ...f.envelope, portablePrompt: "altered" },
        f.envelope.envelopeDigest,
        schemas,
      ),
    /capture-artifact-digest-mismatch/u,
  );
  const { envelopeDigest: _old, ...body } = f.envelope;
  const badPrompt = { ...body, promptDigest: `sha256:${"f".repeat(64)}` };
  const digest = canonicalDigest(badPrompt);
  throws(
    () => selectEnvelope({ ...badPrompt, envelopeDigest: digest }, digest, schemas),
    /capture-prompt-digest-mismatch/u,
  );
  throws(
    () =>
      selectEnvelope(
        { kind: "snapshot", envelope: f.envelope },
        f.envelope.envelopeDigest,
        schemas,
      ),
    /capture-envelope-unavailable/u,
  );
  throws(
    () =>
      implementationBaseline(
        context,
        "repository_00000000-1234-4123-8123-123456789abc",
        f.result,
        f.commit,
        schemas,
      ),
    /capture-unknown-implementation/u,
  );
  throws(
    () => selectResult({ ...f.result, resultDigest: `sha256:${"f".repeat(64)}` }, schemas),
    /capture-artifact-digest-mismatch/u,
  );
  throws(
    () => selectResult({ isError: true, structuredContent: f.result }, schemas),
    /capture-imported-tool-error/u,
  );
  equal(
    selectResult(
      {
        structuredContent: {
          kind: "WakeflowTargetResultReviewInspectionResult",
          reviewUnit: { targetResult: f.result },
        },
      },
      schemas,
    ).resultDigest,
    f.result.resultDigest,
  );
  writeJson(f.packageFile, { ...f.pkg, objective: "changed package" });
  throws(() => prepareCapture(f.repository, f.selectionFile), /capture-contract-relation/u);
  equal(existsSync(path.join(f.repository, ".build/capture/plans")), false);
});

test("an immutable commit supplies the unique digest-matched envelope; invalid commits and ambiguous sources refuse", (t) => {
  const f = captureFixture(t);
  const schemas = captureSchemas(f.repository);
  const id = "12345678-1234-4123-8123-123456789abc";
  const source = {
    artifactKind: "wakeflow-demand-event-stream-commit",
    schemaVersion: 1,
    commitId: `demand-event-commit_${id}`,
    demandId: f.pkg.demandId,
    commitSequence: 1,
    commandDigest: `sha256:${"a".repeat(64)}`,
    expectedStreamRevision: 0,
    firstStreamRevision: 1,
    lastStreamRevision: 1,
    previousCommitDigest: null,
    events: [
      {
        artifactKind: "wakeflow-demand-event-sourcing-event",
        schemaVersion: 1,
        eventId: `demand-event_${id}`,
        demandId: f.pkg.demandId,
        streamRevision: 1,
        recordedAt: "2026-08-29T10:00:00.000Z",
        eventType: "delivery.delivery-prepared",
        eventVersion: 1,
        data: { envelope: f.envelope },
        resultingStateModelVersion: 1,
        resultingStateDigest: `sha256:${"a".repeat(64)}`,
      },
    ],
  };
  equal(
    selectEnvelope(source, f.envelope.envelopeDigest, schemas).envelopeDigest,
    f.envelope.envelopeDigest,
  );
  writeJson(f.envelopeFile, source);
  const p = prepareCapture(f.repository, f.selectionFile);
  equal(p.status, "prepared");
  const before = readFileSync(f.envelopeFile);
  throws(
    () => selectEnvelope({ ...source, commitSequence: 0 }, f.envelope.envelopeDigest, schemas),
    /capture-contract-schema/u,
  );
  equal(readFileSync(f.envelopeFile).equals(before), true);
  throws(() =>
    selectEnvelope(
      { ...source, events: [source.events[0], source.events[0]] },
      f.envelope.envelopeDigest,
      schemas,
    ),
  );
});
