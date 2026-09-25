import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  deriveEvidenceEventIdentity,
  deriveEvidencePlanDigest,
  evidencePlanSummary,
  evidencePreviewNext,
} from "../../../src/capabilities/evidence/decide.js";
import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { createManagedEvidenceCapturePlan } from "../../../src/governance/evidence/managed-evidence-capture-plan.js";
import {
  deriveManagedEvidenceContentBlockers,
  deriveManagedEvidenceId,
  type ManagedEvidenceCaptureReview,
} from "../../../src/governance/evidence/managed-evidence-capture-planning-service.js";
import { createManagedEvidenceManifest } from "../../../src/governance/evidence/managed-evidence-manifest.js";
import {
  managedEvidenceSourceKey,
  parseManagedEvidenceSourceSelection,
} from "../../../src/governance/evidence/managed-evidence-source-selection.js";
import {
  createManagedEvidenceCapturePlanFixture,
  MANAGED_EVIDENCE_PUBLICATION_TEST_DIGESTS,
} from "../../governance/evidence/managed-evidence-publication.fixture.js";

/**
 * evidence 切片的纯决定（§13.89 D1、D3）：计划摘要不含时间、身份派生、计划投影、内容阻塞项。
 */

const EVIDENCE_ID = parseWakeflowDurableIdOfKind(
  "evidence_33333333-3333-4333-8333-333333333333",
  "evidence",
);

test("计划摘要只覆盖内容：同一 Manifest 换一个捕获时间摘要不变，Demand 权威变化摘要变化", () => {
  const plan = createManagedEvidenceCapturePlanFixture();
  const later = createManagedEvidenceCapturePlan({
    configDigest: plan.configDigest,
    expectedDemand: { ...plan.expectedDemand, streamRevision: 9 },
    manifest: createManagedEvidenceManifest(
      {
        evidenceId: plan.manifest.evidenceId,
        programId: plan.manifest.programId,
        demandId: plan.manifest.demandId,
        demandAuthorityDigest: plan.manifest.demandAuthorityDigest,
        kind: plan.manifest.kind,
        recordedBy: plan.manifest.recordedBy,
        source: plan.manifest.source,
        payload: plan.manifest.payload,
        contentReview: plan.manifest.contentReview,
      },
      { clock: () => parseUtcInstant("2026-09-02T09:00:00.000Z") },
    ),
  });
  equal(later.manifest.capturedAt === plan.manifest.capturedAt, false);
  equal(later.planDigest === plan.planDigest, false, "the capture plan digest still binds time");
  equal(deriveEvidencePlanDigest(later), deriveEvidencePlanDigest(plan));
  const otherAuthority = createManagedEvidenceCapturePlan({
    configDigest: plan.configDigest,
    expectedDemand: plan.expectedDemand,
    manifest: createManagedEvidenceManifest(
      {
        evidenceId: plan.manifest.evidenceId,
        programId: plan.manifest.programId,
        demandId: plan.manifest.demandId,
        demandAuthorityDigest: MANAGED_EVIDENCE_PUBLICATION_TEST_DIGESTS.replacement,
        kind: plan.manifest.kind,
        recordedBy: plan.manifest.recordedBy,
        source: plan.manifest.source,
        payload: plan.manifest.payload,
        contentReview: plan.manifest.contentReview,
      },
      { clock: () => plan.manifest.capturedAt },
    ),
  });
  equal(deriveEvidencePlanDigest(otherAuthority) === deriveEvidencePlanDigest(plan), false);
});

test("Event 与 Commit 身份从 Evidence 身份派生且稳定", () => {
  const identity = deriveEvidenceEventIdentity(EVIDENCE_ID);
  deepEqual(deriveEvidenceEventIdentity(EVIDENCE_ID), identity);
  equal(identity.eventId.startsWith("demand-event_"), true);
  equal(identity.commitId.startsWith("demand-event-commit_"), true);
  equal(
    identity.eventId.slice("demand-event_".length) ===
      identity.commitId.slice("demand-event-commit_".length),
    false,
  );
});

test("计划投影只带摘要与计数；preview 的 next 就绪指向 apply、阻塞列出阻塞项", () => {
  const plan = createManagedEvidenceCapturePlanFixture();
  const summary = evidencePlanSummary(plan, false);
  deepEqual(summary, {
    evidenceId: plan.manifest.evidenceId,
    kind: "test-output",
    source: plan.manifest.source,
    payload: {
      artifactDigest: plan.manifest.payload.artifactDigest,
      fileCount: 1,
      totalBytes: plan.manifest.payload.treeManifest.totalBytes,
    },
    contentReview: { disposition: "not-required", opaqueFileCount: 0, privacyFindingCount: 0 },
    recorded: false,
  });
  equal(JSON.stringify(summary).includes("treeManifest"), false);
  deepEqual(evidencePreviewNext({ status: "ready", blockers: [] }), {
    frontier: "evidence-record-apply",
    owner: "controller",
    suggestedTool: "wakeflow_record_evidence",
    blockers: [],
  });
  deepEqual(evidencePreviewNext({ status: "blocked", blockers: ["opaque-content:x.bin"] }), {
    frontier: null,
    owner: "controller",
    suggestedTool: null,
    blockers: ["opaque-content:x.bin"],
  });
});

test("内容阻塞项：凭证类永远阻塞，opaque 与非凭证命中只在 reject 下阻塞，超量命中不能确认", () => {
  const review: ManagedEvidenceCaptureReview = {
    opaqueFileRefs: ["shots/a.bin" as never],
    privacyFindings: [{ ref: "logs/a.txt" as never, line: 3, kind: "unlisted-absolute-path" }],
    credentialFindings: [],
  };
  deepEqual(deriveManagedEvidenceContentBlockers(review, "reject"), [
    "opaque-content:shots/a.bin",
    "privacy:unlisted-absolute-path:logs/a.txt:3",
  ]);
  deepEqual(deriveManagedEvidenceContentBlockers(review, "controller-confirmed"), []);
  const credential: ManagedEvidenceCaptureReview = {
    ...review,
    credentialFindings: [{ ref: "logs/a.txt" as never, line: 9, kind: "provider-credential" }],
  };
  deepEqual(deriveManagedEvidenceContentBlockers(credential, "controller-confirmed"), [
    "privacy:provider-credential:logs/a.txt:9",
  ]);
  const overflow: ManagedEvidenceCaptureReview = {
    opaqueFileRefs: [],
    credentialFindings: [],
    privacyFindings: Array.from({ length: 65 }, (_entry, index) => ({
      ref: "logs/a.txt" as never,
      line: index + 1,
      kind: "bare-uuid" as const,
    })),
  };
  deepEqual(deriveManagedEvidenceContentBlockers(overflow, "controller-confirmed"), [
    "privacy-findings-overflow:65",
  ]);
  equal(deriveManagedEvidenceContentBlockers(overflow, "reject").length, 16, "blockers are capped");
});

test("来源键区分四种来源，同一来源不同负载得到不同身份", () => {
  const selection = parseManagedEvidenceSourceSelection({
    kind: "link",
    source: { kind: "link", url: "https://example.com/a" },
    contentReview: "reject",
  });
  equal(managedEvidenceSourceKey(selection.source), "link:https://example.com/a");
  const plan = createManagedEvidenceCapturePlanFixture();
  equal(
    managedEvidenceSourceKey(plan.manifest.source),
    `managed-path:repository:${
      plan.manifest.source.kind === "managed-path" &&
      plan.manifest.source.root.kind === "repository"
        ? plan.manifest.source.root.repositoryId
        : ""
    }:file:artifacts/result.txt`,
  );
  const digests = MANAGED_EVIDENCE_PUBLICATION_TEST_DIGESTS;
  equal(
    deriveManagedEvidenceId(plan.manifest.demandId, selection, digests.authority) ===
      deriveManagedEvidenceId(plan.manifest.demandId, selection, digests.replacement),
    false,
  );
  deepEqual(
    deriveManagedEvidenceId(plan.manifest.demandId, selection, digests.authority),
    deriveManagedEvidenceId(plan.manifest.demandId, selection, digests.authority),
  );
});
