import { deepEqual, equal, ok, rejects } from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type TestContext, test } from "node:test";

import { validateLoadedArtifactTreeManifest } from "../../../src/foundation/artifact/loaded-artifact-tree-identity.js";
import { computeCanonicalJsonSha256Digest } from "../../../src/foundation/crypto/canonical-json-sha256.js";
import { computeSha256Digest, parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import {
  type DirectoryTreeCandidateProgress,
  inspectDirectoryTreeCandidateProgress,
} from "../../../src/foundation/filesystem/durable-directory-tree-candidate.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { createManagedEvidenceCapturePlan } from "../../../src/governance/evidence/managed-evidence-capture-plan.js";
import { createManagedEvidenceManifest } from "../../../src/governance/evidence/managed-evidence-manifest.js";
import {
  ManagedEvidencePublicationPayloadMaterializationError,
  type ManagedEvidencePublicationPayloadMaterializationErrorReason,
  materializeManagedEvidencePublicationPayload,
} from "../../../src/governance/evidence/managed-evidence-publication-payload-materializer.js";
import {
  createManagedEvidencePublicationTransaction,
  deriveManagedEvidencePublicationRecordTreePlan,
  type ManagedEvidencePublicationTransaction,
} from "../../../src/governance/evidence/managed-evidence-publication-transaction.js";
import { MANAGED_EVIDENCE_ROOT_REF } from "../../../src/governance/evidence/managed-evidence-resource-paths.js";
import {
  encodeManagedEvidenceSourceProjection,
  type ManagedEvidenceReferenceSource,
  renderManagedEvidenceSourceProjection,
} from "../../../src/governance/evidence/managed-evidence-source-projection.js";
import { disposableRoot } from "../../support/temp-root.js";
import { writeTextFile } from "../../support/write-tree.js";
import {
  createManagedEvidenceCapturePlanFixture,
  createManagedEvidencePublicationTransactionFixture,
  MANAGED_EVIDENCE_PUBLICATION_TEST_CAPTURED_AT,
  MANAGED_EVIDENCE_PUBLICATION_TEST_CONTENT,
  MANAGED_EVIDENCE_PUBLICATION_TEST_DIGESTS,
  MANAGED_EVIDENCE_PUBLICATION_TEST_IDS,
} from "./managed-evidence-publication.fixture.js";

/** Direct coverage of the source-specific payload materializer, without the stage materializer. */

const IDS = MANAGED_EVIDENCE_PUBLICATION_TEST_IDS;
const DIGESTS = MANAGED_EVIDENCE_PUBLICATION_TEST_DIGESTS;
const FILE_TEXT = "managed evidence\n";
const TREE_README = "tree evidence\n";
const TREE_SCRIPT = "#!/bin/sh\nexit 0\n";

// Literal key order follows the parsed source descriptor so the projection bytes match.
const OBSERVATION_SOURCE: ManagedEvidenceReferenceSource = {
  kind: "observation",
  hostId: "codex",
  recordId: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
  event: "stop",
  recordedAt: parseUtcInstant("2026-09-02T07:59:00.000Z"),
  turnId: null,
  promptDigest: null,
  lastAssistantMessageDigest: null,
  transcript: "absent",
  recordDigest: parseSha256Digest(`sha256:${"e".repeat(64)}`),
};
const LINK_SOURCE: ManagedEvidenceReferenceSource = {
  kind: "link",
  url: "https://example.com/report",
  digest: null,
};
const COMMIT_SOURCE: ManagedEvidenceReferenceSource = {
  kind: "commit",
  repositoryId: IDS.repository,
  commitOid: "a".repeat(40),
};

type Transaction = Readonly<ManagedEvidencePublicationTransaction>;
type Plan = ReturnType<typeof deriveManagedEvidencePublicationRecordTreePlan>;
type Progress = Readonly<DirectoryTreeCandidateProgress>;
type ReferenceKind = "hook-observation" | "link" | "commit";

interface Harness {
  readonly sourcePath: string;
  readonly demandPath: string;
  readonly sourceRoot: RootedDirectory;
  readonly demandRoot: RootedDirectory;
}

interface MaterializeOptions {
  readonly sourceRoot?: RootedDirectory | null;
  readonly progress?: Progress;
  readonly signal?: AbortSignal;
}

async function openHarness(t: TestContext): Promise<Harness> {
  const roots: RootedDirectory[] = [];
  t.after(async () => {
    for (const root of roots) await root.close();
  });
  const root = disposableRoot(t, "wakeflow-evidence-payload-");
  const sourcePath = path.join(root, "source");
  const demandPath = path.join(root, "demand");
  mkdirSync(sourcePath, { mode: 0o700 });
  mkdirSync(demandPath, { mode: 0o700 });
  const sourceRoot = await RootedDirectory.open(sourcePath);
  const demandRoot = await RootedDirectory.open(demandPath);
  roots.push(sourceRoot, demandRoot);
  return { sourcePath, demandPath, sourceRoot, demandRoot };
}

function physical(root: string, ref: string): string {
  return path.join(root, ...ref.split("/"));
}

/** Creates the empty stage directory the stage materializer would own and returns its plan. */
function prepareStage(harness: Harness, transaction: Transaction): Plan {
  const plan = deriveManagedEvidencePublicationRecordTreePlan(transaction);
  const evidenceRoot = physical(harness.demandPath, MANAGED_EVIDENCE_ROOT_REF);
  mkdirSync(evidenceRoot, { recursive: true, mode: 0o700 });
  mkdirSync(physical(harness.demandPath, plan.candidateRootPath), { mode: 0o700 });
  return plan;
}

function payloadPath(harness: Harness, plan: Plan, ...segments: readonly string[]): string {
  return path.join(physical(harness.demandPath, plan.candidateRootPath), "payload", ...segments);
}

function inspectProgress(harness: Harness, plan: Plan): Promise<Progress> {
  return inspectDirectoryTreeCandidateProgress(
    harness.demandRoot,
    plan.candidateRootPath,
    plan.directoryPlan,
  );
}

/** Runs the materializer against a progress snapshot taken now unless one is supplied. */
async function materialize(
  harness: Harness,
  transaction: unknown,
  plan: Plan,
  options: MaterializeOptions = {},
): Promise<readonly string[]> {
  return materializeManagedEvidencePublicationPayload(
    options.sourceRoot === undefined ? harness.sourceRoot : options.sourceRoot,
    harness.demandRoot,
    transaction,
    plan,
    options.progress ?? (await inspectProgress(harness, plan)),
    options.signal === undefined ? {} : { signal: options.signal },
  );
}

function writeFileSource(harness: Harness, text = FILE_TEXT, mode = 0o600): string {
  return writeTextFile(harness.sourcePath, "artifacts/result.txt", text, mode);
}

function singleContentManifest(bytes: Uint8Array, executable: boolean, digest?: string) {
  return validateLoadedArtifactTreeManifest({
    artifactKind: "wakeflow-loaded-artifact-tree",
    schemaVersion: 1,
    fileCount: 1,
    files: [
      { bytes: bytes.byteLength, digest: digest ?? computeSha256Digest(bytes), executable, ref: "content" },
    ],
    totalBytes: bytes.byteLength,
  });
}

function createTreeTransaction(harness: Harness): Transaction {
  const readme = encodeUtf8(TREE_README);
  const script = encodeUtf8(TREE_SCRIPT);
  writeTextFile(harness.sourcePath, "tree/README.md", TREE_README, 0o600);
  writeTextFile(harness.sourcePath, "tree/bin/run.sh", TREE_SCRIPT, 0o700);
  const treeManifest = validateLoadedArtifactTreeManifest({
    artifactKind: "wakeflow-loaded-artifact-tree",
    schemaVersion: 1,
    fileCount: 2,
    files: [
      { bytes: readme.byteLength, digest: computeSha256Digest(readme), executable: false, ref: "README.md" },
      { bytes: script.byteLength, digest: computeSha256Digest(script), executable: true, ref: "bin/run.sh" },
    ],
    totalBytes: readme.byteLength + script.byteLength,
  });
  return createManagedEvidencePublicationTransaction({
    capturePlan: createManagedEvidenceCapturePlanFixture({
      source: { path: "tree", resourceType: "tree" },
      treeManifest,
    }),
    eventId: IDS.event,
    commitId: IDS.commit,
  });
}

/** Reference sources carry the projection digest in their Manifest; `contentDigest` can lie. */
function createReferenceTransaction(
  kind: ReferenceKind,
  source: ManagedEvidenceReferenceSource,
  contentDigest?: string,
): Transaction {
  const projection = encodeManagedEvidenceSourceProjection(source);
  const treeManifest = singleContentManifest(projection.bytes, false, contentDigest);
  const manifest = createManagedEvidenceManifest(
    {
      evidenceId: IDS.evidence,
      programId: IDS.program,
      demandId: IDS.demand,
      demandAuthorityDigest: DIGESTS.authority,
      kind,
      recordedBy: { windowId: IDS.window, configDigest: DIGESTS.config },
      source,
      payload: { artifactDigest: computeCanonicalJsonSha256Digest(treeManifest), treeManifest },
      contentReview: { disposition: "not-required", opaqueFileRefs: [], privacyFindings: [] },
    },
    { clock: () => MANAGED_EVIDENCE_PUBLICATION_TEST_CAPTURED_AT },
  );
  const capturePlan = createManagedEvidenceCapturePlan({
    configDigest: DIGESTS.config,
    expectedDemand: {
      streamRevision: 4,
      stateDigest: DIGESTS.state,
      lastEventId: IDS.previousEvent,
      lastEventDigest: DIGESTS.previousEvent,
    },
    manifest,
  });
  return createManagedEvidencePublicationTransaction({
    capturePlan,
    eventId: IDS.event,
    commitId: IDS.commit,
  });
}

function referenceSourceOf(transaction: Transaction): ManagedEvidenceReferenceSource {
  const source = transaction.manifest.source;
  if (source.kind === "managed-path") throw new Error("Expected a reference source.");
  return source;
}

async function expectFailure(
  action: Promise<unknown>,
  reason: ManagedEvidencePublicationPayloadMaterializationErrorReason,
  errorPath: string,
): Promise<void> {
  await rejects(action, (error: unknown) => {
    ok(error instanceof ManagedEvidencePublicationPayloadMaterializationError, String(error));
    equal(error.reason, reason);
    equal(error.path, errorPath);
    equal(error.code, "wakeflow-managed-evidence-publication-payload-materialization");
    return true;
  });
}

test("file source copies payload/content with record modes and is idempotent afterwards", async (t) => {
  const harness = await openHarness(t);
  const sourceFile = writeFileSource(harness);
  const { transaction } = createManagedEvidencePublicationTransactionFixture();
  const plan = prepareStage(harness, transaction);
  const before = await inspectProgress(harness, plan);
  equal(before.status, "incomplete");
  deepEqual(before.missingDirectories, ["payload"]);
  deepEqual([...before.missingFiles].sort(), ["manifest.json", "payload/content"]);
  const copied = await materialize(harness, transaction, plan);
  deepEqual(copied, ["content"]);
  ok(Object.isFrozen(copied));
  const content = payloadPath(harness, plan, "content");
  equal(readFileSync(content, "utf8"), FILE_TEXT);
  equal(lstatSync(payloadPath(harness, plan)).mode & 0o777, 0o700);
  equal(lstatSync(content).mode & 0o777, 0o600);
  const after = await inspectProgress(harness, plan);
  deepEqual(after.missingDirectories, []);
  deepEqual(after.missingFiles, ["manifest.json"]);
  rmSync(sourceFile);
  deepEqual(await materialize(harness, transaction, plan), []);
  equal(readFileSync(content, "utf8"), FILE_TEXT);
});

test("file source honours the Manifest executable flag with the executable record mode", async (t) => {
  const harness = await openHarness(t);
  writeFileSource(harness, FILE_TEXT, 0o700);
  const treeManifest = singleContentManifest(MANAGED_EVIDENCE_PUBLICATION_TEST_CONTENT, true);
  const transaction = createManagedEvidencePublicationTransaction({
    capturePlan: createManagedEvidenceCapturePlanFixture({ treeManifest }),
    eventId: IDS.event,
    commitId: IDS.commit,
  });
  const plan = prepareStage(harness, transaction);
  deepEqual(await materialize(harness, transaction, plan), ["content"]);
  equal(lstatSync(payloadPath(harness, plan, "content")).mode & 0o777, 0o700);
  deepEqual((await inspectProgress(harness, plan)).missingFiles, ["manifest.json"]);
});

test("tree source transfers the whole tree with per-file modes", async (t) => {
  const harness = await openHarness(t);
  const transaction = createTreeTransaction(harness);
  const plan = prepareStage(harness, transaction);
  deepEqual(await materialize(harness, transaction, plan), ["README.md", "bin/run.sh"]);
  equal(readFileSync(payloadPath(harness, plan, "README.md"), "utf8"), TREE_README);
  equal(readFileSync(payloadPath(harness, plan, "bin", "run.sh"), "utf8"), TREE_SCRIPT);
  equal(lstatSync(payloadPath(harness, plan)).mode & 0o777, 0o700);
  equal(lstatSync(payloadPath(harness, plan, "bin")).mode & 0o777, 0o700);
  equal(lstatSync(payloadPath(harness, plan, "README.md")).mode & 0o777, 0o600);
  equal(lstatSync(payloadPath(harness, plan, "bin", "run.sh")).mode & 0o777, 0o700);
  const after = await inspectProgress(harness, plan);
  deepEqual(after.missingDirectories, []);
  deepEqual(after.missingFiles, ["manifest.json"]);
});

async function expectProjectionPayload(
  t: TestContext,
  kind: ReferenceKind,
  source: ManagedEvidenceReferenceSource,
): Promise<void> {
  const harness = await openHarness(t);
  const transaction = createReferenceTransaction(kind, source);
  const plan = prepareStage(harness, transaction);
  const detached = { sourceRoot: null };
  deepEqual(await materialize(harness, transaction, plan, detached), ["content"]);
  const content = payloadPath(harness, plan, "content");
  const text = readFileSync(content, "utf8");
  equal(text, renderManagedEvidenceSourceProjection(referenceSourceOf(transaction)));
  deepEqual(JSON.parse(text), {
    artifactKind: "wakeflow-managed-evidence-source-projection",
    schemaVersion: 1,
    source: JSON.parse(JSON.stringify(source)),
  });
  equal(computeSha256Digest(encodeUtf8(text)), transaction.manifest.payload.treeManifest.files[0]?.digest);
  equal(lstatSync(payloadPath(harness, plan)).mode & 0o777, 0o700);
  equal(lstatSync(content).mode & 0o777, 0o600);
  deepEqual((await inspectProgress(harness, plan)).missingFiles, ["manifest.json"]);
  deepEqual(await materialize(harness, transaction, plan, detached), []);
}

test("hook observation source materializes its projection without reading the record", async (t) => {
  await expectProjectionPayload(t, "hook-observation", OBSERVATION_SOURCE);
});

test("https link source materializes its projection without fetching the link", async (t) => {
  await expectProjectionPayload(t, "link", LINK_SOURCE);
});

test("commit reference source materializes its projection without opening a repository", async (t) => {
  await expectProjectionPayload(t, "commit", COMMIT_SOURCE);
});

test("input rejections name the offending argument and leave the stage untouched", async (t) => {
  const harness = await openHarness(t);
  writeFileSource(harness);
  const { transaction } = createManagedEvidencePublicationTransactionFixture();
  const plan = prepareStage(harness, transaction);
  const progress = await inspectProgress(harness, plan);
  const raw = materializeManagedEvidencePublicationPayload;
  const { sourceRoot, demandRoot } = harness;
  await expectFailure(raw(sourceRoot, {} as never, transaction, plan, progress), "input", "$demandRoot");
  const unknownOption = raw(sourceRoot, demandRoot, transaction, plan, progress, { extra: true } as never);
  await expectFailure(unknownOption, "input", "$options");
  await expectFailure(materialize(harness, {}, plan, { progress }), "input", "$transaction");
  await expectFailure(raw(sourceRoot, demandRoot, transaction, {}, progress), "input", "$plan");
  const link = createReferenceTransaction("link", LINK_SOURCE);
  const linkPlan = deriveManagedEvidencePublicationRecordTreePlan(link);
  await expectFailure(materialize(harness, transaction, linkPlan, { progress }), "input", "$plan");
  const lying = Object.freeze({ ...progress, status: "complete" as const });
  await expectFailure(materialize(harness, transaction, plan, { progress: lying }), "input", "$progress");
  await expectFailure(materialize(harness, transaction, plan, { sourceRoot: null }), "input", "$sourceRoot");
  await expectFailure(materialize(harness, link, linkPlan), "input", "$sourceRoot");
  equal(existsSync(payloadPath(harness, plan)), false);
});

test("an already aborted signal fails before any filesystem effect", async (t) => {
  const harness = await openHarness(t);
  writeFileSource(harness);
  const { transaction } = createManagedEvidencePublicationTransactionFixture();
  const plan = prepareStage(harness, transaction);
  const controller = new AbortController();
  controller.abort();
  const aborted = materialize(harness, transaction, plan, { signal: controller.signal });
  await expectFailure(aborted, "aborted", "$signal");
  equal(existsSync(payloadPath(harness, plan)), false);
});

test("a source file larger than its Manifest byte count is a capacity failure", async (t) => {
  const harness = await openHarness(t);
  writeFileSource(harness, `${FILE_TEXT}and more bytes than the Manifest admits\n`);
  const { transaction } = createManagedEvidencePublicationTransactionFixture();
  const plan = prepareStage(harness, transaction);
  await expectFailure(materialize(harness, transaction, plan), "capacity", "$source");
  equal(existsSync(payloadPath(harness, plan, "content")), false);
});

test("file sources that drift, vanish, become symlinks or directories are source-changed", async (t) => {
  const harness = await openHarness(t);
  const sourceFile = writeFileSource(harness, "MANAGED EVIDENCE\n");
  const { transaction } = createManagedEvidencePublicationTransactionFixture();
  const plan = prepareStage(harness, transaction);
  const attempt = () => materialize(harness, transaction, plan);
  await expectFailure(attempt(), "source-changed", "$source");
  rmSync(sourceFile);
  await expectFailure(attempt(), "source-changed", "$source");
  symlinkSync("elsewhere.txt", sourceFile);
  await expectFailure(attempt(), "source-changed", "$source");
  rmSync(sourceFile);
  mkdirSync(sourceFile, { mode: 0o700 });
  await expectFailure(attempt(), "source-changed", "$source");
  equal(existsSync(payloadPath(harness, plan, "content")), false);
});

test("tree sources that drift, vanish or stop being directories are source-changed", async (t) => {
  const harness = await openHarness(t);
  const transaction = createTreeTransaction(harness);
  const plan = prepareStage(harness, transaction);
  const attempt = () => materialize(harness, transaction, plan);
  writeTextFile(harness.sourcePath, "tree/README.md", "TREE EVIDENCE\n");
  await expectFailure(attempt(), "source-changed", "$source");
  rmSync(path.join(harness.sourcePath, "tree"), { recursive: true });
  await expectFailure(attempt(), "source-changed", "$source");
  writeTextFile(harness.sourcePath, "tree", "not a tree\n");
  await expectFailure(attempt(), "source-changed", "$source");
  equal(existsSync(payloadPath(harness, plan, "README.md")), false);
});

test("a reference Manifest whose content digest disagrees with its projection is source-changed", async (t) => {
  const harness = await openHarness(t);
  const transaction = createReferenceTransaction("commit", COMMIT_SOURCE, DIGESTS.replacement);
  const plan = prepareStage(harness, transaction);
  const attempt = materialize(harness, transaction, plan, { sourceRoot: null });
  await expectFailure(attempt, "source-changed", "$source");
  equal(existsSync(payloadPath(harness, plan, "content")), false);
});

test("a closed source root is a source-root-scope failure for file and tree sources", async (t) => {
  const harness = await openHarness(t);
  writeFileSource(harness);
  const { transaction } = createManagedEvidencePublicationTransactionFixture();
  const plan = prepareStage(harness, transaction);
  const tree = createTreeTransaction(harness);
  const treePlan = deriveManagedEvidencePublicationRecordTreePlan(tree);
  const progress = await inspectProgress(harness, plan);
  const treeProgress = await inspectProgress(harness, treePlan);
  await harness.sourceRoot.close();
  const file = materialize(harness, transaction, plan, { progress });
  await expectFailure(file, "source-root-scope", "$sourceRoot");
  const whole = materialize(harness, tree, treePlan, { progress: treeProgress });
  await expectFailure(whole, "source-root-scope", "$sourceRoot");
});

test("a closed Demand root is a destination-root-scope failure", async (t) => {
  const harness = await openHarness(t);
  writeFileSource(harness);
  const { transaction } = createManagedEvidencePublicationTransactionFixture();
  const plan = prepareStage(harness, transaction);
  const progress = await inspectProgress(harness, plan);
  await harness.demandRoot.close();
  const attempt = materialize(harness, transaction, plan, { progress });
  await expectFailure(attempt, "destination-root-scope", "$demandRoot");
  equal(existsSync(payloadPath(harness, plan)), false);
});

test("stage conflicts: payload occupied by a file, or content present behind stale progress", async (t) => {
  const harness = await openHarness(t);
  writeFileSource(harness);
  const { transaction } = createManagedEvidencePublicationTransactionFixture();
  const plan = prepareStage(harness, transaction);
  const empty = await inspectProgress(harness, plan);
  const run = (progress: Progress) => materialize(harness, transaction, plan, { progress });
  writeFileSync(payloadPath(harness, plan), "occupied\n", { mode: 0o600 });
  await expectFailure(run(empty), "stage-conflict", "$payload");
  rmSync(payloadPath(harness, plan));
  mkdirSync(payloadPath(harness, plan), { mode: 0o700 });
  writeFileSync(payloadPath(harness, plan, "content"), "already here\n", { mode: 0o600 });
  const stale = Object.freeze({ ...empty, missingDirectories: Object.freeze([]) });
  await expectFailure(run(stale), "stage-conflict", "$payload");
  equal(readFileSync(payloadPath(harness, plan, "content"), "utf8"), "already here\n");
});
