import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../../src/foundation/crypto/canonical-json-sha256.js";
import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  computeManagedEvidenceManifestDigest,
  createManagedEvidenceManifest,
  MANAGED_EVIDENCE_MANIFEST_KIND,
  ManagedEvidenceManifestError,
  parseManagedEvidenceManifest,
  parseManagedEvidenceManifestDocument,
  renderManagedEvidenceManifest,
  type ManagedEvidenceManifestDraft,
  type ManagedEvidenceManifestErrorReason,
} from "../../../src/governance/evidence/managed-evidence-manifest.js";

const UUIDS = {
  evidence: "11111111-1111-4111-8111-111111111111",
  program: "22222222-2222-4222-8222-222222222222",
  demand: "33333333-3333-4333-8333-333333333333",
  repository: "44444444-4444-4444-8444-444444444444",
  surface: "55555555-5555-4555-8555-555555555555",
  window: "66666666-6666-4666-8666-666666666666",
} as const;

const IDS = {
  evidence: parseWakeflowDurableIdOfKind(
    `evidence_${UUIDS.evidence}`,
    "evidence",
  ),
  program: parseWakeflowDurableIdOfKind(`program_${UUIDS.program}`, "program"),
  demand: parseWakeflowDurableIdOfKind(`demand_${UUIDS.demand}`, "demand"),
  repository: parseWakeflowDurableIdOfKind(
    `repository_${UUIDS.repository}`,
    "repository",
  ),
  surface: parseWakeflowDurableIdOfKind(`surface_${UUIDS.surface}`, "surface"),
  window: parseWakeflowDurableIdOfKind(`window_${UUIDS.window}`, "window"),
} as const;

const AUTHORITY_DIGEST = parseSha256Digest(`sha256:${"a".repeat(64)}`);
const CONFIG_DIGEST = parseSha256Digest(`sha256:${"b".repeat(64)}`);
const TEXT_DIGEST = parseSha256Digest(`sha256:${"c".repeat(64)}`);
const OPAQUE_DIGEST = parseSha256Digest(`sha256:${"d".repeat(64)}`);
const CAPTURED_AT = parseUtcInstant("2026-09-01T20:30:00.000Z");

function treeManifest() {
  return Object.freeze({
    artifactKind: "wakeflow-loaded-artifact-tree" as const,
    fileCount: 2,
    files: Object.freeze([
      Object.freeze({
        bytes: 3,
        digest: TEXT_DIGEST,
        executable: false,
        ref: "logs/report.txt",
      }),
      Object.freeze({
        bytes: 4,
        digest: OPAQUE_DIGEST,
        executable: false,
        ref: "screenshots/result.png",
      }),
    ]),
    schemaVersion: 1 as const,
    totalBytes: 7,
  });
}

function fileManifest() {
  return Object.freeze({
    artifactKind: "wakeflow-loaded-artifact-tree" as const,
    fileCount: 1,
    files: Object.freeze([
      Object.freeze({
        bytes: 3,
        digest: TEXT_DIGEST,
        executable: false,
        ref: "content",
      }),
    ]),
    schemaVersion: 1 as const,
    totalBytes: 3,
  });
}

function treeDraft(): ManagedEvidenceManifestDraft {
  const manifest = treeManifest();
  return Object.freeze({
    evidenceId: IDS.evidence,
    programId: IDS.program,
    demandId: IDS.demand,
    demandAuthorityDigest: AUTHORITY_DIGEST,
    evidenceType: "test-output",
    recordedBy: Object.freeze({
      windowId: IDS.window,
      configDigest: CONFIG_DIGEST,
    }),
    source: Object.freeze({
      root: Object.freeze({
        kind: "repository" as const,
        repositoryId: IDS.repository,
      }),
      path: "artifacts/test-run",
      resourceType: "tree" as const,
    }),
    sensitivity: "internal" as const,
    payload: Object.freeze({
      artifactDigest: computeCanonicalJsonSha256Digest(manifest),
      treeManifest: manifest,
    }),
    contentReview: Object.freeze({
      disposition: "controller-confirmed" as const,
      opaqueFileRefs: Object.freeze(["screenshots/result.png"]),
    }),
  }) as ManagedEvidenceManifestDraft;
}

function expectManifestError(
  action: () => unknown,
  reason: ManagedEvidenceManifestErrorReason,
  path: string,
): ManagedEvidenceManifestError {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }
  if (!(caught instanceof ManagedEvidenceManifestError)) {
    throw new Error("Expected ManagedEvidenceManifestError.");
  }
  equal(caught.code, "wakeflow-managed-evidence-manifest");
  equal(caught.reason, reason);
  equal(caught.path, path);
  return caught;
}

test("Managed Evidence Manifest闭合本地tree provenance与payload identity", () => {
  const manifest = createManagedEvidenceManifest(treeDraft(), {
    clock: () => CAPTURED_AT,
  });

  equal(manifest.artifactKind, MANAGED_EVIDENCE_MANIFEST_KIND);
  equal(manifest.schemaVersion, 1);
  equal(manifest.evidenceId, IDS.evidence);
  equal(manifest.capturedAt, CAPTURED_AT);
  equal(manifest.payload.treeManifest.fileCount, 2);
  deepEqual(manifest.contentReview.opaqueFileRefs, ["screenshots/result.png"]);
  equal(Object.isFrozen(manifest), true);
  equal(Object.isFrozen(manifest.payload.treeManifest.files), true);
  equal(
    computeManagedEvidenceManifestDigest(manifest),
    manifest.manifestDigest,
  );

  const document = renderManagedEvidenceManifest(manifest);
  equal(document.endsWith("\n"), true);
  deepEqual(parseManagedEvidenceManifestDocument(document), manifest);
});

test("file来源只接纳规范化为单一content文件的payload", () => {
  const fileTree = fileManifest();
  const manifest = createManagedEvidenceManifest(
    {
      ...treeDraft(),
      source: {
        root: { kind: "support-surface", surfaceId: IDS.surface },
        path: "reports/result.txt",
        resourceType: "file",
      },
      payload: {
        artifactDigest: computeCanonicalJsonSha256Digest(fileTree),
        treeManifest: fileTree,
      },
      contentReview: {
        disposition: "not-required",
        opaqueFileRefs: [],
      },
    },
    { clock: () => CAPTURED_AT },
  );
  equal(manifest.source.resourceType, "file");
  equal(manifest.payload.treeManifest.files[0]?.ref, "content");

  expectManifestError(
    () =>
      createManagedEvidenceManifest(
        {
          ...treeDraft(),
          source: { ...treeDraft().source, resourceType: "file" },
        },
        { clock: () => CAPTURED_AT },
      ),
    "payload",
    "$/payload/treeManifest/files",
  );
});

test("payload digest与opaque review必须闭合完整tree manifest", () => {
  const current = createManagedEvidenceManifest(treeDraft(), {
    clock: () => CAPTURED_AT,
  });
  expectManifestError(
    () =>
      parseManagedEvidenceManifest({
        ...current,
        payload: {
          ...current.payload,
          artifactDigest: parseSha256Digest(`sha256:${"e".repeat(64)}`),
        },
      }),
    "payload",
    "$/payload/artifactDigest",
  );
  expectManifestError(
    () =>
      createManagedEvidenceManifest(
        {
          ...treeDraft(),
          contentReview: {
            disposition: "controller-confirmed",
            opaqueFileRefs: ["missing.bin"],
          },
        },
        { clock: () => CAPTURED_AT },
      ),
    "content-review",
    "$/contentReview/opaqueFileRefs/0",
  );
  expectManifestError(
    () =>
      createManagedEvidenceManifest(
        {
          ...treeDraft(),
          contentReview: {
            disposition: "controller-confirmed",
            opaqueFileRefs: ["screenshots/result.png", "logs/report.txt"],
          },
        },
        { clock: () => CAPTURED_AT },
      ),
    "ordering",
    "$/contentReview/opaqueFileRefs/1",
  );
  expectManifestError(
    () =>
      parseManagedEvidenceManifest({
        ...current,
        manifestDigest: parseSha256Digest(`sha256:${"f".repeat(64)}`),
      }),
    "digest",
    "$/manifestDigest",
  );
});

test("Manifest草稿在读取wall clock之前拒绝开放或行为输入", () => {
  let clockReads = 0;
  expectManifestError(
    () =>
      createManagedEvidenceManifest(
        { ...treeDraft(), futureField: true },
        {
          clock: () => {
            clockReads += 1;
            return CAPTURED_AT;
          },
        },
      ),
    "input",
    "$draft",
  );
  equal(clockReads, 0);

  const accessorDraft = Object.defineProperty({}, "payload", {
    enumerable: true,
    get() {
      throw new Error("must not execute");
    },
  });
  expectManifestError(
    () => createManagedEvidenceManifest(accessorDraft),
    "input",
    "$draft",
  );

  expectManifestError(
    () =>
      createManagedEvidenceManifest(
        {
          ...treeDraft(),
          evidenceId: `archive_${UUIDS.evidence}`,
        },
        { clock: () => CAPTURED_AT },
      ),
    "schema",
    "$/evidenceId",
  );
});
