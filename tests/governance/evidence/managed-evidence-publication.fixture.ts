import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { validateLoadedArtifactTreeManifest } from "../../../src/foundation/artifact/loaded-artifact-tree-identity.js";
import { computeCanonicalJsonSha256Digest } from "../../../src/foundation/crypto/canonical-json-sha256.js";
import {
  computeSha256Digest,
  parseSha256Digest,
} from "../../../src/foundation/crypto/sha256.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { createManagedEvidenceCapturePlan } from "../../../src/governance/evidence/managed-evidence-capture-plan.js";
import { createManagedEvidenceManifest } from "../../../src/governance/evidence/managed-evidence-manifest.js";
import { createManagedEvidencePublicationTransaction } from "../../../src/governance/evidence/managed-evidence-publication-transaction.js";

/** Managed Evidence纯合同与存储测试共享的最小、无I/O fixture。 */

export const MANAGED_EVIDENCE_PUBLICATION_TEST_IDS = Object.freeze({
  program: parseWakeflowDurableIdOfKind(
    "program_11111111-1111-4111-8111-111111111111",
    "program",
  ),
  otherProgram: parseWakeflowDurableIdOfKind(
    "program_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    "program",
  ),
  demand: parseWakeflowDurableIdOfKind(
    "demand_22222222-2222-4222-8222-222222222222",
    "demand",
  ),
  evidence: parseWakeflowDurableIdOfKind(
    "evidence_33333333-3333-4333-8333-333333333333",
    "evidence",
  ),
  repository: parseWakeflowDurableIdOfKind(
    "repository_44444444-4444-4444-8444-444444444444",
    "repository",
  ),
  window: parseWakeflowDurableIdOfKind(
    "window_55555555-5555-4555-8555-555555555555",
    "window",
  ),
  previousEvent: parseWakeflowDurableIdOfKind(
    "demand-event_66666666-6666-4666-8666-666666666666",
    "demand-event",
  ),
  event: parseWakeflowDurableIdOfKind(
    "demand-event_77777777-7777-4777-8777-777777777777",
    "demand-event",
  ),
  commit: parseWakeflowDurableIdOfKind(
    "demand-event-commit_88888888-8888-4888-8888-888888888888",
    "demand-event-commit",
  ),
});

export const MANAGED_EVIDENCE_PUBLICATION_TEST_DIGESTS = Object.freeze({
  authority: parseSha256Digest(`sha256:${"a".repeat(64)}`),
  config: parseSha256Digest(`sha256:${"b".repeat(64)}`),
  state: parseSha256Digest(`sha256:${"c".repeat(64)}`),
  previousEvent: parseSha256Digest(`sha256:${"d".repeat(64)}`),
  replacement: parseSha256Digest(`sha256:${"f".repeat(64)}`),
});

export const MANAGED_EVIDENCE_PUBLICATION_TEST_CAPTURED_AT = parseUtcInstant(
  "2026-09-02T08:00:00.000Z",
);
export const MANAGED_EVIDENCE_PUBLICATION_TEST_CONTENT = encodeUtf8(
  "managed evidence\n",
);

export function createManagedEvidenceCapturePlanFixture() {
  const ids = MANAGED_EVIDENCE_PUBLICATION_TEST_IDS;
  const digests = MANAGED_EVIDENCE_PUBLICATION_TEST_DIGESTS;
  const content = MANAGED_EVIDENCE_PUBLICATION_TEST_CONTENT;
  const treeManifest = validateLoadedArtifactTreeManifest({
    artifactKind: "wakeflow-loaded-artifact-tree",
    schemaVersion: 1,
    fileCount: 1,
    files: [{
      bytes: content.byteLength,
      digest: computeSha256Digest(content),
      executable: false,
      ref: "content",
    }],
    totalBytes: content.byteLength,
  });
  const manifest = createManagedEvidenceManifest(
    {
      evidenceId: ids.evidence,
      programId: ids.program,
      demandId: ids.demand,
      demandAuthorityDigest: digests.authority,
      evidenceType: "test-output",
      recordedBy: {
        windowId: ids.window,
        configDigest: digests.config,
      },
      source: {
        root: { kind: "repository", repositoryId: ids.repository },
        path: "artifacts/result.txt",
        resourceType: "file",
      },
      sensitivity: "internal",
      payload: {
        artifactDigest: computeCanonicalJsonSha256Digest(treeManifest),
        treeManifest,
      },
      contentReview: {
        disposition: "not-required",
        opaqueFileRefs: [],
      },
    },
    { clock: () => MANAGED_EVIDENCE_PUBLICATION_TEST_CAPTURED_AT },
  );
  return createManagedEvidenceCapturePlan({
    configDigest: digests.config,
    expectedDemand: {
      streamRevision: 4,
      stateDigest: digests.state,
      lastEventId: ids.previousEvent,
      lastEventDigest: digests.previousEvent,
    },
    manifest,
  });
}

export function createManagedEvidencePublicationTransactionFixture() {
  const capturePlan = createManagedEvidenceCapturePlanFixture();
  return Object.freeze({
    capturePlan,
    transaction: createManagedEvidencePublicationTransaction({
      capturePlan,
      eventId: MANAGED_EVIDENCE_PUBLICATION_TEST_IDS.event,
      commitId: MANAGED_EVIDENCE_PUBLICATION_TEST_IDS.commit,
    }),
  });
}
