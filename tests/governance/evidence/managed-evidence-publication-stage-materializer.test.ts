import {
  deepEqual,
  equal,
  rejects,
} from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { validateLoadedArtifactTreeManifest } from "../../../src/foundation/artifact/loaded-artifact-tree-identity.js";
import { computeCanonicalJsonSha256Digest } from "../../../src/foundation/crypto/canonical-json-sha256.js";
import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";
import { createManagedEvidenceCapturePlan } from "../../../src/governance/evidence/managed-evidence-capture-plan.js";
import {
  createManagedEvidenceManifest,
  renderManagedEvidenceManifest,
} from "../../../src/governance/evidence/managed-evidence-manifest.js";
import {
  materializeManagedEvidencePublicationStage,
  ManagedEvidencePublicationStageMaterializationError,
  type ManagedEvidencePublicationStageMaterializationErrorReason,
} from "../../../src/governance/evidence/managed-evidence-publication-stage-materializer.js";
import {
  createManagedEvidencePublicationTransactionJournal,
  loadManagedEvidencePublicationTransaction,
} from "../../../src/governance/evidence/managed-evidence-publication-transaction-store.js";
import {
  createManagedEvidencePublicationTransaction,
  deriveManagedEvidencePublicationRecordTreePlan,
} from "../../../src/governance/evidence/managed-evidence-publication-transaction.js";
import { inspectManagedEvidenceRecordSetInventory } from "../../../src/governance/evidence/managed-evidence-record-set-inventory.js";
import {
  MANAGED_EVIDENCE_MANIFEST_FILE_NAME,
  MANAGED_EVIDENCE_ROOT_REF,
} from "../../../src/governance/evidence/managed-evidence-resource-paths.js";
import {
  createManagedEvidenceCapturePlanFixture,
  createManagedEvidencePublicationTransactionFixture,
  MANAGED_EVIDENCE_PUBLICATION_TEST_CAPTURED_AT,
  MANAGED_EVIDENCE_PUBLICATION_TEST_CONTENT,
  MANAGED_EVIDENCE_PUBLICATION_TEST_DIGESTS,
  MANAGED_EVIDENCE_PUBLICATION_TEST_IDS,
} from "./managed-evidence-publication.fixture.js";

interface MaterializerFixture {
  readonly fixtureRoot: string;
  readonly sourcePath: string;
  readonly demandPath: string;
  readonly sourceRoot: RootedDirectory;
  readonly demandRoot: RootedDirectory;
}

async function createMaterializerFixture(): Promise<MaterializerFixture> {
  const fixtureRoot = mkdtempSync(
    path.join(os.tmpdir(), "wakeflow-evidence-stage-materializer-"),
  );
  const sourcePath = path.join(fixtureRoot, "source");
  const demandPath = path.join(fixtureRoot, "demand");
  mkdirSync(sourcePath, { mode: 0o700 });
  mkdirSync(demandPath, { mode: 0o700 });
  mkdirSync(path.join(demandPath, "artifacts"), { mode: 0o700 });
  mkdirSync(path.join(demandPath, "transactions"), { mode: 0o700 });
  return Object.freeze({
    fixtureRoot,
    sourcePath,
    demandPath,
    sourceRoot: await RootedDirectory.open(sourcePath),
    demandRoot: await RootedDirectory.open(demandPath),
  });
}

async function cleanupMaterializerFixture(
  fixture: MaterializerFixture,
): Promise<void> {
  await fixture.sourceRoot.close();
  await fixture.demandRoot.close();
  rmSync(fixture.fixtureRoot, { recursive: true, force: true });
}

function physical(root: string, ref: string): string {
  return path.join(root, ...ref.split("/"));
}

function createFileSource(fixture: MaterializerFixture): string {
  const target = path.join(fixture.sourcePath, "artifacts", "result.txt");
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  writeFileSync(target, MANAGED_EVIDENCE_PUBLICATION_TEST_CONTENT, {
    mode: 0o600,
  });
  return target;
}

async function expectMaterializationError(
  action: Promise<unknown>,
  reason: ManagedEvidencePublicationStageMaterializationErrorReason,
): Promise<void> {
  await rejects(
    action,
    (error: unknown) =>
      error instanceof ManagedEvidencePublicationStageMaterializationError &&
      error.reason === reason,
  );
}

test("file source先物化payload、最后发布Manifest并可脱离source重用完整stage", async () => {
  const fixture = await createMaterializerFixture();
  try {
    const sourceFile = createFileSource(fixture);
    const { transaction } =
      createManagedEvidencePublicationTransactionFixture();
    const stored = await createManagedEvidencePublicationTransactionJournal(
      fixture.demandRoot,
      transaction,
    );
    const result = await materializeManagedEvidencePublicationStage(
      fixture.sourceRoot,
      fixture.demandRoot,
      transaction,
    );
    const plan = deriveManagedEvidencePublicationRecordTreePlan(transaction);
    equal(result.transactionDigest, stored.transactionDigest);
    equal(result.manifestPublication, "created");
    deepEqual(result.copiedPayloadFiles, ["content"]);
    equal(
      readFileSync(
        path.join(
          physical(fixture.demandPath, plan.candidateRootPath),
          "payload",
          "content",
        ),
      ).toString("utf8"),
      "managed evidence\n",
    );
    equal(
      readFileSync(
        path.join(
          physical(fixture.demandPath, plan.candidateRootPath),
          MANAGED_EVIDENCE_MANIFEST_FILE_NAME,
        ),
        "utf8",
      ),
      renderManagedEvidenceManifest(transaction.manifest),
    );

    rmSync(sourceFile);
    const reused = await materializeManagedEvidencePublicationStage(
      fixture.sourceRoot,
      fixture.demandRoot,
      transaction,
    );
    equal(reused.manifestPublication, "existing");
    deepEqual(reused.copiedPayloadFiles, []);
    equal(
      (await loadManagedEvidencePublicationTransaction(fixture.demandRoot))
        ?.transactionDigest,
      stored.transactionDigest,
    );
  } finally {
    await cleanupMaterializerFixture(fixture);
  }
});

test("payload已关闭而Manifest缺失时无需重读已变化source即可前向完成", async () => {
  const fixture = await createMaterializerFixture();
  try {
    const sourceFile = createFileSource(fixture);
    const { transaction } =
      createManagedEvidencePublicationTransactionFixture();
    await createManagedEvidencePublicationTransactionJournal(
      fixture.demandRoot,
      transaction,
    );
    const plan = deriveManagedEvidencePublicationRecordTreePlan(transaction);
    const stage = physical(fixture.demandPath, plan.candidateRootPath);
    mkdirSync(physical(fixture.demandPath, MANAGED_EVIDENCE_ROOT_REF), {
      mode: 0o700,
    });
    mkdirSync(stage, { mode: 0o700 });
    mkdirSync(path.join(stage, "payload"), { mode: 0o700 });
    writeFileSync(
      path.join(stage, "payload", "content"),
      MANAGED_EVIDENCE_PUBLICATION_TEST_CONTENT,
      { mode: 0o600 },
    );
    rmSync(sourceFile);

    const result = await materializeManagedEvidencePublicationStage(
      fixture.sourceRoot,
      fixture.demandRoot,
      transaction,
    );
    equal(result.manifestPublication, "created");
    deepEqual(result.copiedPayloadFiles, []);
    equal(existsSync(path.join(stage, MANAGED_EVIDENCE_MANIFEST_FILE_NAME)), true);
  } finally {
    await cleanupMaterializerFixture(fixture);
  }
});

function createTreeTransaction(fixture: MaterializerFixture) {
  const readme = encodeUtf8("tree evidence\n");
  const script = encodeUtf8("#!/bin/sh\nexit 0\n");
  mkdirSync(path.join(fixture.sourcePath, "tree", "bin"), {
    recursive: true,
    mode: 0o700,
  });
  writeFileSync(path.join(fixture.sourcePath, "tree", "README.md"), readme, {
    mode: 0o600,
  });
  writeFileSync(path.join(fixture.sourcePath, "tree", "bin", "run.sh"), script, {
    mode: 0o700,
  });
  const treeManifest = validateLoadedArtifactTreeManifest({
    artifactKind: "wakeflow-loaded-artifact-tree",
    schemaVersion: 1,
    fileCount: 2,
    files: [
      {
        bytes: readme.byteLength,
        digest: computeSha256Digest(readme),
        executable: false,
        ref: "README.md",
      },
      {
        bytes: script.byteLength,
        digest: computeSha256Digest(script),
        executable: true,
        ref: "bin/run.sh",
      },
    ],
    totalBytes: readme.byteLength + script.byteLength,
  });
  const ids = MANAGED_EVIDENCE_PUBLICATION_TEST_IDS;
  const digests = MANAGED_EVIDENCE_PUBLICATION_TEST_DIGESTS;
  const manifest = createManagedEvidenceManifest(
    {
      evidenceId: ids.evidence,
      programId: ids.program,
      demandId: ids.demand,
      demandAuthorityDigest: digests.authority,
      evidenceType: "tree-output",
      recordedBy: { windowId: ids.window, configDigest: digests.config },
      source: {
        root: { kind: "repository", repositoryId: ids.repository },
        path: "tree",
        resourceType: "tree",
      },
      sensitivity: "internal",
      payload: {
        artifactDigest: computeCanonicalJsonSha256Digest(treeManifest),
        treeManifest,
      },
      contentReview: { disposition: "not-required", opaqueFileRefs: [] },
    },
    { clock: () => MANAGED_EVIDENCE_PUBLICATION_TEST_CAPTURED_AT },
  );
  const capturePlan = createManagedEvidenceCapturePlan({
    configDigest: digests.config,
    expectedDemand: {
      streamRevision: 4,
      stateDigest: digests.state,
      lastEventId: ids.previousEvent,
      lastEventDigest: digests.previousEvent,
    },
    manifest,
  });
  return createManagedEvidencePublicationTransaction({
    capturePlan,
    eventId: ids.event,
    commitId: ids.commit,
  });
}

test("tree source复用整树identity与streaming copy并保留Manifest executable语义", async () => {
  const fixture = await createMaterializerFixture();
  try {
    const transaction = createTreeTransaction(fixture);
    await createManagedEvidencePublicationTransactionJournal(
      fixture.demandRoot,
      transaction,
    );
    const result = await materializeManagedEvidencePublicationStage(
      fixture.sourceRoot,
      fixture.demandRoot,
      transaction,
    );
    deepEqual(result.copiedPayloadFiles, ["README.md", "bin/run.sh"]);
    const plan = deriveManagedEvidencePublicationRecordTreePlan(transaction);
    const stage = physical(fixture.demandPath, plan.candidateRootPath);
    equal(lstatSync(path.join(stage, "payload", "README.md")).mode & 0o777, 0o600);
    equal(lstatSync(path.join(stage, "payload", "bin", "run.sh")).mode & 0o777, 0o700);
    const managedRootNode = (
      await fixture.demandRoot.inspectExistingResource(
        MANAGED_EVIDENCE_ROOT_REF,
      )
    ).node;
    const journal = await loadManagedEvidencePublicationTransaction(
      fixture.demandRoot,
    );
    if (journal === null) throw new Error("Expected journal.");
    const inventory = await inspectManagedEvidenceRecordSetInventory(
      fixture.demandRoot,
      {
        expectedRootNode: managedRootNode,
        expectedTransactionNode: journal.source.node,
      },
    );
    equal(inventory.publication?.physicalState, "stage-complete");
  } finally {
    await cleanupMaterializerFixture(fixture);
  }
});

test("Manifest marker提前出现的partial stage失败关闭且不会补写payload", async () => {
  const fixture = await createMaterializerFixture();
  try {
    createFileSource(fixture);
    const { transaction } =
      createManagedEvidencePublicationTransactionFixture();
    await createManagedEvidencePublicationTransactionJournal(
      fixture.demandRoot,
      transaction,
    );
    const plan = deriveManagedEvidencePublicationRecordTreePlan(transaction);
    const stage = physical(fixture.demandPath, plan.candidateRootPath);
    mkdirSync(physical(fixture.demandPath, MANAGED_EVIDENCE_ROOT_REF), {
      mode: 0o700,
    });
    mkdirSync(stage, { mode: 0o700 });
    mkdirSync(path.join(stage, "payload"), { mode: 0o700 });
    writeFileSync(
      path.join(stage, MANAGED_EVIDENCE_MANIFEST_FILE_NAME),
      renderManagedEvidenceManifest(transaction.manifest),
      { mode: 0o600 },
    );
    await expectMaterializationError(
      materializeManagedEvidencePublicationStage(
        fixture.sourceRoot,
        fixture.demandRoot,
        transaction,
      ),
      "stage-conflict",
    );
    equal(existsSync(path.join(stage, "payload", "content")), false);
  } finally {
    await cleanupMaterializerFixture(fixture);
  }
});

test("缺失journal或source漂移时不会发布Manifest", async () => {
  const fixture = await createMaterializerFixture();
  try {
    const sourceFile = createFileSource(fixture);
    const capturePlan = createManagedEvidenceCapturePlanFixture();
    const transaction = createManagedEvidencePublicationTransaction({
      capturePlan,
      eventId: MANAGED_EVIDENCE_PUBLICATION_TEST_IDS.event,
      commitId: MANAGED_EVIDENCE_PUBLICATION_TEST_IDS.commit,
    });
    await expectMaterializationError(
      materializeManagedEvidencePublicationStage(
        fixture.sourceRoot,
        fixture.demandRoot,
        transaction,
      ),
      "journal",
    );
    equal(existsSync(physical(fixture.demandPath, MANAGED_EVIDENCE_ROOT_REF)), false);

    await createManagedEvidencePublicationTransactionJournal(
      fixture.demandRoot,
      transaction,
    );
    writeFileSync(sourceFile, "drifted\n");
    await expectMaterializationError(
      materializeManagedEvidencePublicationStage(
        fixture.sourceRoot,
        fixture.demandRoot,
        transaction,
      ),
      "source-changed",
    );
    const plan = deriveManagedEvidencePublicationRecordTreePlan(transaction);
    equal(
      existsSync(
        path.join(
          physical(fixture.demandPath, plan.candidateRootPath),
          MANAGED_EVIDENCE_MANIFEST_FILE_NAME,
        ),
      ),
      false,
    );
  } finally {
    await cleanupMaterializerFixture(fixture);
  }
});
