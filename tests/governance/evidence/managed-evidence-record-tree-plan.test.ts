import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";

import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../../src/foundation/crypto/canonical-json-sha256.js";
import {
  computeSha256Digest,
  parseSha256Digest,
} from "../../../src/foundation/crypto/sha256.js";
import {
  LOADED_ARTIFACT_TREE_IDENTITY_LIMITS,
  validateLoadedArtifactTreeManifest,
  type LoadedArtifactTreeManifest,
} from "../../../src/foundation/artifact/loaded-artifact-tree-identity.js";
import { encodeUtf8 } from "../../../src/foundation/text/utf8.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  createManagedEvidenceManifest,
  MANAGED_EVIDENCE_MANIFEST_MAXIMUM_BYTES,
  MANAGED_EVIDENCE_PAYLOAD_LIMITS,
  renderManagedEvidenceManifest,
  ManagedEvidenceManifestError,
  type ManagedEvidenceManifest,
} from "../../../src/governance/evidence/managed-evidence-manifest.js";
import {
  parseManagedEvidenceRecordTreePlan,
  planManagedEvidenceRecordTree,
  MANAGED_EVIDENCE_RECORD_DIRECTORY_MODE,
  MANAGED_EVIDENCE_RECORD_EXECUTABLE_FILE_MODE,
  MANAGED_EVIDENCE_RECORD_FILE_MODE,
  ManagedEvidenceRecordTreePlanError,
  type ManagedEvidenceRecordTreePlanErrorReason,
} from "../../../src/governance/evidence/managed-evidence-record-tree-plan.js";
import {
  managedEvidencePublicationStageRef,
  managedEvidenceRecordRootRef,
} from "../../../src/governance/evidence/managed-evidence-resource-paths.js";

const IDS = {
  evidence: parseWakeflowDurableIdOfKind(
    "evidence_11111111-1111-4111-8111-111111111111",
    "evidence",
  ),
  program: parseWakeflowDurableIdOfKind(
    "program_22222222-2222-4222-8222-222222222222",
    "program",
  ),
  demand: parseWakeflowDurableIdOfKind(
    "demand_33333333-3333-4333-8333-333333333333",
    "demand",
  ),
  repository: parseWakeflowDurableIdOfKind(
    "repository_44444444-4444-4444-8444-444444444444",
    "repository",
  ),
  window: parseWakeflowDurableIdOfKind(
    "window_55555555-5555-4555-8555-555555555555",
    "window",
  ),
} as const;

const AUTHORITY_DIGEST = parseSha256Digest(`sha256:${"a".repeat(64)}`);
const CONFIG_DIGEST = parseSha256Digest(`sha256:${"b".repeat(64)}`);
const README_BYTES = encodeUtf8("evidence\n");
const SCRIPT_BYTES = encodeUtf8("export {};\n");
const CAPTURED_AT = parseUtcInstant("2026-09-02T01:00:00.000Z");

function draft(tree: Readonly<LoadedArtifactTreeManifest>) {
  return {
    evidenceId: IDS.evidence,
    programId: IDS.program,
    demandId: IDS.demand,
    demandAuthorityDigest: AUTHORITY_DIGEST,
    evidenceType: "test-output",
    recordedBy: {
      windowId: IDS.window,
      configDigest: CONFIG_DIGEST,
    },
    source: {
      root: { kind: "repository" as const, repositoryId: IDS.repository },
      path: "artifacts/test-output",
      resourceType: "tree" as const,
    },
    sensitivity: "internal" as const,
    payload: {
      artifactDigest: computeCanonicalJsonSha256Digest(tree),
      treeManifest: tree,
    },
    contentReview: {
      disposition: "not-required" as const,
      opaqueFileRefs: [] as const,
    },
  };
}

function manifest(): Readonly<ManagedEvidenceManifest> {
  const tree = validateLoadedArtifactTreeManifest(
    {
      artifactKind: "wakeflow-loaded-artifact-tree",
      schemaVersion: 1,
      fileCount: 2,
      files: [
        {
          bytes: README_BYTES.byteLength,
          digest: computeSha256Digest(README_BYTES),
          executable: false,
          ref: "README.md",
        },
        {
          bytes: SCRIPT_BYTES.byteLength,
          digest: computeSha256Digest(SCRIPT_BYTES),
          executable: true,
          ref: "bin/run.mjs",
        },
      ],
      totalBytes: README_BYTES.byteLength + SCRIPT_BYTES.byteLength,
    },
    { limits: MANAGED_EVIDENCE_PAYLOAD_LIMITS },
  );
  return createManagedEvidenceManifest(draft(tree), {
    clock: () => CAPTURED_AT,
  });
}

function expectPlanError(
  action: () => unknown,
  reason: ManagedEvidenceRecordTreePlanErrorReason,
  path: string,
): void {
  throws(
    action,
    (error: unknown) =>
      error instanceof ManagedEvidenceRecordTreePlanError &&
      error.reason === reason &&
      error.path === path,
  );
}

function assertDeepFrozen(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

test("Managed Evidence record plan闭合Manifest文件与payload整树", () => {
  const value = manifest();
  const plan = planManagedEvidenceRecordTree(value);
  const manifestBytes = encodeUtf8(renderManagedEvidenceManifest(value));

  equal(plan.evidenceId, IDS.evidence);
  equal(plan.manifest.manifestDigest, value.manifestDigest);
  equal(plan.manifestDocumentDigest, computeSha256Digest(manifestBytes));
  equal(
    plan.candidateRootPath,
    managedEvidencePublicationStageRef(IDS.evidence),
  );
  equal(plan.destinationRootPath, managedEvidenceRecordRootRef(IDS.evidence));
  equal(
    plan.directoryPlan.directoryMode,
    MANAGED_EVIDENCE_RECORD_DIRECTORY_MODE,
  );
  deepEqual(plan.directoryPlan.directories, ["payload", "payload/bin"]);
  deepEqual(
    plan.directoryPlan.files.map((file) => ({
      path: file.path,
      byteCount: file.byteCount,
      digest: file.digest,
      mode: file.mode,
    })),
    [
      {
        path: "manifest.json",
        byteCount: manifestBytes.byteLength,
        digest: computeSha256Digest(manifestBytes),
        mode: MANAGED_EVIDENCE_RECORD_FILE_MODE,
      },
      {
        path: "payload/README.md",
        byteCount: README_BYTES.byteLength,
        digest: computeSha256Digest(README_BYTES),
        mode: MANAGED_EVIDENCE_RECORD_FILE_MODE,
      },
      {
        path: "payload/bin/run.mjs",
        byteCount: SCRIPT_BYTES.byteLength,
        digest: computeSha256Digest(SCRIPT_BYTES),
        mode: MANAGED_EVIDENCE_RECORD_EXECUTABLE_FILE_MODE,
      },
    ],
  );
  equal(
    plan.directoryPlan.totalBytes,
    manifestBytes.byteLength +
      README_BYTES.byteLength +
      SCRIPT_BYTES.byteLength,
  );
  const { planDigest: _planDigest, ...basis } = plan;
  equal(plan.planDigest, computeCanonicalJsonSha256Digest(basis));
  assertDeepFrozen(plan);
});

test("Record plan对结构克隆保持确定，并严格重验所有派生字段", () => {
  const first = planManagedEvidenceRecordTree(manifest());
  const second = planManagedEvidenceRecordTree(structuredClone(manifest()));
  deepEqual(second, first);
  equal(second.manifest === first.manifest, false);
  deepEqual(parseManagedEvidenceRecordTreePlan(structuredClone(first)), first);

  expectPlanError(
    () =>
      parseManagedEvidenceRecordTreePlan({
        ...first,
        candidateRootPath: first.destinationRootPath,
      }),
    "plan",
    "$plan",
  );
  expectPlanError(
    () =>
      parseManagedEvidenceRecordTreePlan({
        ...first,
        manifestDocumentDigest: parseSha256Digest(`sha256:${"f".repeat(64)}`),
      }),
    "plan",
    "$plan",
  );
  expectPlanError(
    () => parseManagedEvidenceRecordTreePlan({ ...first, future: true }),
    "input",
    "$plan",
  );
});

test("Managed Evidence payload预算为完整final record预留Foundation容量", () => {
  equal(
    MANAGED_EVIDENCE_PAYLOAD_LIMITS.maxDepth,
    LOADED_ARTIFACT_TREE_IDENTITY_LIMITS.maxDepth - 1,
  );
  equal(
    MANAGED_EVIDENCE_PAYLOAD_LIMITS.maxEntries,
    LOADED_ARTIFACT_TREE_IDENTITY_LIMITS.maxEntries - 2,
  );
  equal(
    MANAGED_EVIDENCE_PAYLOAD_LIMITS.maxFiles,
    LOADED_ARTIFACT_TREE_IDENTITY_LIMITS.maxFiles - 1,
  );
  equal(
    MANAGED_EVIDENCE_PAYLOAD_LIMITS.maxRefBytes,
    LOADED_ARTIFACT_TREE_IDENTITY_LIMITS.maxRefBytes - 8,
  );
  equal(
    MANAGED_EVIDENCE_PAYLOAD_LIMITS.maxTotalBytes,
    LOADED_ARTIFACT_TREE_IDENTITY_LIMITS.maxTotalBytes -
      MANAGED_EVIDENCE_MANIFEST_MAXIMUM_BYTES,
  );

  const deepRef = Array.from({ length: 64 }, () => "a").join("/");
  const genericTree = validateLoadedArtifactTreeManifest({
    artifactKind: "wakeflow-loaded-artifact-tree",
    schemaVersion: 1,
    fileCount: 1,
    files: [
      {
        bytes: README_BYTES.byteLength,
        digest: computeSha256Digest(README_BYTES),
        executable: false,
        ref: deepRef,
      },
    ],
    totalBytes: README_BYTES.byteLength,
  });
  throws(
    () =>
      createManagedEvidenceManifest(draft(genericTree), {
        clock: () => CAPTURED_AT,
      }),
    (error: unknown) =>
      error instanceof ManagedEvidenceManifestError &&
      error.reason === "capacity",
  );
});
