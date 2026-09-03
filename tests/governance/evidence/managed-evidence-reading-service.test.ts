import { deepEqual, equal, rejects } from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseByteCount } from "../../../src/foundation/numeric/byte-count.js";
import {
  closeDemandOperationAuthorityContext,
  openDemandReadAuthorityContext,
} from "../../../src/governance/demand/demand-operation-authority-context.js";
import { DemandEventSourcingRepository } from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import { ManagedEvidenceCapturePlanningService } from "../../../src/governance/evidence/managed-evidence-capture-planning-service.js";
import { ManagedEvidencePublicationApplicationService } from "../../../src/governance/evidence/managed-evidence-publication-application-service.js";
import {
  createManagedEvidencePublicationTransaction,
  computeManagedEvidencePublicationTransactionDigest,
  deriveManagedEvidencePublicationRecordTreePlan,
} from "../../../src/governance/evidence/managed-evidence-publication-transaction.js";
import {
  loadManagedEvidenceRecord,
  readManagedEvidencePayloadMember,
  ManagedEvidenceRecordReaderError,
} from "../../../src/governance/evidence/managed-evidence-record-reader.js";
import {
  ManagedEvidenceReadingService,
  ManagedEvidenceReadingServiceError,
} from "../../../src/governance/evidence/managed-evidence-reading-service.js";
import {
  cleanupManagedEvidenceCapturePlanningWorkspaceFixture,
  createManagedEvidenceCapturePlanningWorkspaceFixture,
  EVIDENCE_CAPTURED_AT,
  EVIDENCE_DEMAND_ID,
  EVIDENCE_REPOSITORY_ID,
  type ManagedEvidenceCapturePlanningWorkspaceFixture,
} from "./managed-evidence-capture-planning-service.fixture.js";

const EVENT_ID = parseWakeflowDurableIdOfKind(
  "demand-event_e1111111-1111-4111-8111-111111111111",
  "demand-event",
);
const COMMIT_ID = parseWakeflowDurableIdOfKind(
  "demand-event-commit_e2222222-2222-4222-8222-222222222222",
  "demand-event-commit",
);

function demandRootPath(
  fixture: Readonly<ManagedEvidenceCapturePlanningWorkspaceFixture>,
): string {
  return path.join(
    fixture.publication.workspacePath,
    ".wakeflow-active",
    "current",
    EVIDENCE_DEMAND_ID,
  );
}

async function publishEvidence(
  fixture: Readonly<ManagedEvidenceCapturePlanningWorkspaceFixture>,
  source: Readonly<{
    readonly path: string;
    readonly resourceType: "file" | "tree";
  }>,
  opaqueContentPolicy: "controller-confirmed" | "reject",
) {
  const capturePlan = await new ManagedEvidenceCapturePlanningService(
    fixture.publication.workspaceRoot,
  ).preview(
    EVIDENCE_DEMAND_ID,
    {
      evidenceType: "test-output",
      source: {
        root: {
          kind: "repository",
          repositoryId: EVIDENCE_REPOSITORY_ID,
        },
        path: source.path,
        resourceType: source.resourceType,
      },
      sensitivity: "internal",
      opaqueContentPolicy,
    },
    {
      uuidFactory: () => "e3333333-3333-4333-8333-333333333333",
      clock: () => EVIDENCE_CAPTURED_AT,
    },
  );
  const transaction = createManagedEvidencePublicationTransaction({
    capturePlan,
    eventId: EVENT_ID,
    commitId: COMMIT_ID,
  });
  await new ManagedEvidencePublicationApplicationService(
    fixture.publication.workspaceRoot,
  ).apply(
    transaction,
    computeManagedEvidencePublicationTransactionDigest(transaction),
  );
  return Object.freeze({ capturePlan, transaction });
}

test("Reading Service区分Manifest、单成员与完整record验证", async () => {
  const fixture = await createManagedEvidenceCapturePlanningWorkspaceFixture();
  try {
    const { capturePlan } = await publishEvidence(
      fixture,
      {
        path: "artifacts/test-run/logs/report.txt",
        resourceType: "file",
      },
      "reject",
    );
    const snapshotRoot = await RootedDirectory.open(demandRootPath(fixture));
    try {
      const repository = new DemandEventSourcingRepository(snapshotRoot);
      const loaded = await repository.load();
      if (loaded === null) throw new Error("Expected Demand aggregate.");
      await repository.publishSnapshot(loaded.aggregate);
    } finally {
      await snapshotRoot.close();
    }
    const readContext = await openDemandReadAuthorityContext(
      fixture.publication.workspaceRoot,
      capturePlan.manifest.demandId,
      undefined,
    );
    try {
      equal(readContext.loaded.loadMode, "snapshot-tail");
    } finally {
      await closeDemandOperationAuthorityContext(readContext);
    }
    const service = new ManagedEvidenceReadingService(
      fixture.publication.workspaceRoot,
    );
    const manifest = await service.readManifest(
      EVIDENCE_DEMAND_ID,
      capturePlan.manifest.evidenceId,
    );
    equal(manifest.payloadVerification, "deferred");
    equal(manifest.manifest.manifestDigest, capturePlan.manifest.manifestDigest);

    const member = await service.readPayloadMember(
      EVIDENCE_DEMAND_ID,
      capturePlan.manifest.evidenceId,
      "content",
      { maximumBytes: parseByteCount(64) },
    );
    equal(member.payloadVerification, "member");
    equal(member.member.ref, "content");
    equal(member.opaque, false);
    equal(new TextDecoder().decode(member.bytes), "tests passed\n");

    const verified = await service.verifyRecord(
      EVIDENCE_DEMAND_ID,
      capturePlan.manifest.evidenceId,
    );
    equal(verified.payloadVerification, "complete");
    equal(verified.recordTreePlanDigest, manifest.recordTreePlanDigest);

    await rejects(
      service.readPayloadMember(
        EVIDENCE_DEMAND_ID,
        capturePlan.manifest.evidenceId,
        "content",
        { maximumBytes: parseByteCount(4) },
      ),
      (error: unknown) =>
        error instanceof ManagedEvidenceReadingServiceError &&
        error.reason === "capacity",
    );
    await rejects(
      service.readPayloadMember(
        EVIDENCE_DEMAND_ID,
        capturePlan.manifest.evidenceId,
        "missing.txt",
        { maximumBytes: parseByteCount(64) },
      ),
      (error: unknown) =>
        error instanceof ManagedEvidenceReadingServiceError &&
        error.reason === "not-found",
    );

    const demandRoot = await RootedDirectory.open(demandRootPath(fixture));
    try {
      const loaded = await loadManagedEvidenceRecord(
        demandRoot,
        capturePlan.manifest.evidenceId,
      );
      await rejects(
        readManagedEvidencePayloadMember(
          demandRoot,
          structuredClone(loaded),
          "content",
          { maximumBytes: parseByteCount(64) },
        ),
        (error: unknown) =>
          error instanceof ManagedEvidenceRecordReaderError &&
          error.reason === "input",
      );
    } finally {
      await demandRoot.close();
    }
  } finally {
    await cleanupManagedEvidenceCapturePlanningWorkspaceFixture(fixture);
  }
});

test("单成员读取不扫描无关payload，但完整验证和目标读取会发现漂移", async () => {
  const fixture = await createManagedEvidenceCapturePlanningWorkspaceFixture();
  try {
    const { capturePlan, transaction } = await publishEvidence(
      fixture,
      { path: "artifacts/test-run", resourceType: "tree" },
      "controller-confirmed",
    );
    deepEqual(capturePlan.manifest.contentReview.opaqueFileRefs, [
      "screenshots/result.bin",
    ]);
    const plan = deriveManagedEvidencePublicationRecordTreePlan(transaction);
    const payloadRoot = path.join(
      demandRootPath(fixture),
      ...plan.destinationRootPath.split("/"),
      "payload",
    );
    writeFileSync(
      path.join(payloadRoot, "screenshots", "result.bin"),
      Uint8Array.from([0x00, 0x00, 0x00, 0x00]),
    );

    const service = new ManagedEvidenceReadingService(
      fixture.publication.workspaceRoot,
    );
    const unaffected = await service.readPayloadMember(
      EVIDENCE_DEMAND_ID,
      capturePlan.manifest.evidenceId,
      "logs/report.txt",
      { maximumBytes: parseByteCount(64) },
    );
    equal(new TextDecoder().decode(unaffected.bytes), "tests passed\n");
    equal(unaffected.payloadVerification, "member");

    await rejects(
      service.verifyRecord(
        EVIDENCE_DEMAND_ID,
        capturePlan.manifest.evidenceId,
      ),
      (error: unknown) =>
        error instanceof ManagedEvidenceReadingServiceError &&
        error.reason === "record",
    );
    await rejects(
      service.readPayloadMember(
        EVIDENCE_DEMAND_ID,
        capturePlan.manifest.evidenceId,
        "screenshots/result.bin",
        { maximumBytes: parseByteCount(64) },
      ),
      (error: unknown) =>
        error instanceof ManagedEvidenceReadingServiceError &&
        error.reason === "record",
    );
  } finally {
    await cleanupManagedEvidenceCapturePlanningWorkspaceFixture(fixture);
  }
});
