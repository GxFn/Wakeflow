import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { parseWakeflowDurableIdOfKind } from "../../../src/contracts/identity/wakeflow-durable-id.js";
import {
  LoadedArtifactTreeIdentityError,
  validateLoadedArtifactTreeManifest,
} from "../../../src/foundation/artifact/loaded-artifact-tree-identity.js";
import { computeCanonicalJsonSha256Digest } from "../../../src/foundation/crypto/canonical-json-sha256.js";
import { parseSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import {
  computeManagedEvidenceManifestDigest,
  createManagedEvidenceManifest,
  MANAGED_EVIDENCE_MANIFEST_KIND,
  MANAGED_EVIDENCE_PAYLOAD_LIMITS,
  type ManagedEvidenceManifestDraft,
  ManagedEvidenceManifestError,
  type ManagedEvidenceManifestErrorReason,
  parseManagedEvidenceManifest,
  parseManagedEvidenceManifestDocument,
  renderManagedEvidenceManifest,
} from "../../../src/governance/evidence/managed-evidence-manifest.js";
import { MANAGED_EVIDENCE_ROOT_REF } from "../../../src/governance/evidence/managed-evidence-resource-paths.js";
import { WAKEFLOW_DEMAND_TREE_CAPACITY } from "../../../src/kernel/limits.js";

const UUIDS = {
  evidence: "11111111-1111-4111-8111-111111111111",
  program: "22222222-2222-4222-8222-222222222222",
  demand: "33333333-3333-4333-8333-333333333333",
  repository: "44444444-4444-4444-8444-444444444444",
  surface: "55555555-5555-4555-8555-555555555555",
  window: "66666666-6666-4666-8666-666666666666",
} as const;

const IDS = {
  evidence: parseWakeflowDurableIdOfKind(`evidence_${UUIDS.evidence}`, "evidence"),
  program: parseWakeflowDurableIdOfKind(`program_${UUIDS.program}`, "program"),
  demand: parseWakeflowDurableIdOfKind(`demand_${UUIDS.demand}`, "demand"),
  repository: parseWakeflowDurableIdOfKind(`repository_${UUIDS.repository}`, "repository"),
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
    kind: "test-output",
    recordedBy: Object.freeze({
      windowId: IDS.window,
      configDigest: CONFIG_DIGEST,
    }),
    source: Object.freeze({
      kind: "managed-path" as const,
      root: Object.freeze({
        kind: "repository" as const,
        repositoryId: IDS.repository,
      }),
      path: "artifacts/test-run",
      resourceType: "tree" as const,
    }),
    payload: Object.freeze({
      artifactDigest: computeCanonicalJsonSha256Digest(manifest),
      treeManifest: manifest,
    }),
    contentReview: Object.freeze({
      disposition: "controller-confirmed" as const,
      opaqueFileRefs: Object.freeze(["screenshots/result.png"]),
      privacyFindings: Object.freeze([]),
    }),
  }) as unknown as ManagedEvidenceManifestDraft;
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
  equal(computeManagedEvidenceManifestDigest(manifest), manifest.manifestDigest);

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
        kind: "managed-path" as const,
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
        privacyFindings: [],
      },
    },
    { clock: () => CAPTURED_AT },
  );
  equal(manifest.source.kind === "managed-path" ? manifest.source.resourceType : null, "file");
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
            privacyFindings: [],
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
            privacyFindings: [],
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
  expectManifestError(() => createManagedEvidenceManifest(accessorDraft), "input", "$draft");

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

test("kind 与来源绑定，隐私命中必须指向 payload 成员且有序，确认处置与命中集合闭合", () => {
  expectManifestError(
    () =>
      createManagedEvidenceManifest({ ...treeDraft(), kind: "link" }, { clock: () => CAPTURED_AT }),
    "kind",
    "$/kind",
  );
  const reviewed = createManagedEvidenceManifest(
    {
      ...treeDraft(),
      contentReview: {
        disposition: "controller-confirmed",
        opaqueFileRefs: ["screenshots/result.png"],
        privacyFindings: [
          { ref: "logs/report.txt", line: 2, kind: "unlisted-absolute-path" },
          { ref: "logs/report.txt", line: 7, kind: "bare-uuid" },
        ],
      },
    },
    { clock: () => CAPTURED_AT },
  );
  equal(reviewed.contentReview.privacyFindings.length, 2);
  expectManifestError(
    () =>
      createManagedEvidenceManifest(
        {
          ...treeDraft(),
          contentReview: {
            disposition: "controller-confirmed",
            opaqueFileRefs: [],
            privacyFindings: [{ ref: "missing.txt", line: 1, kind: "bare-uuid" }],
          },
        },
        { clock: () => CAPTURED_AT },
      ),
    "content-review",
    "$/contentReview/privacyFindings/0/ref",
  );
  expectManifestError(
    () =>
      createManagedEvidenceManifest(
        {
          ...treeDraft(),
          contentReview: {
            disposition: "controller-confirmed",
            opaqueFileRefs: [],
            privacyFindings: [
              { ref: "logs/report.txt", line: 7, kind: "bare-uuid" },
              { ref: "logs/report.txt", line: 2, kind: "unlisted-absolute-path" },
            ],
          },
        },
        { clock: () => CAPTURED_AT },
      ),
    "ordering",
    "$/contentReview/privacyFindings/1",
  );
  expectManifestError(
    () =>
      createManagedEvidenceManifest(
        {
          ...treeDraft(),
          contentReview: {
            disposition: "not-required",
            opaqueFileRefs: [],
            privacyFindings: [{ ref: "logs/report.txt", line: 2, kind: "bare-uuid" }],
          },
        },
        { clock: () => CAPTURED_AT },
      ),
    "schema",
    "$/contentReview/privacyFindings",
  );
});

test("Manifest容量按实际写入的缩进文档计量，而不是紧凑规范形式", () => {
  const entries = Array.from({ length: 60_000 }, () => ({ ref: "x" }));
  const candidate = { payload: { files: entries } };
  equal(JSON.stringify(candidate).length < 1024 * 1024, true);
  equal(JSON.stringify(candidate, null, 2).length > 1024 * 1024, true);
  expectManifestError(() => parseManagedEvidenceManifest(candidate), "capacity", "$manifest");
});

test("能记录的证据必须能归档：证据单文件与总量上限不超过 Demand 树容量（复审 G12）", () => {
  equal(
    MANAGED_EVIDENCE_PAYLOAD_LIMITS.maxFileBytes,
    WAKEFLOW_DEMAND_TREE_CAPACITY.maximumFileBytes,
  );
  equal(MANAGED_EVIDENCE_PAYLOAD_LIMITS.maxFileBytes, 16 * 1024 * 1024);
  equal(
    MANAGED_EVIDENCE_PAYLOAD_LIMITS.maxTotalBytes <=
      WAKEFLOW_DEMAND_TREE_CAPACITY.maximumTotalBytes,
    true,
  );
});

test("能归档的深度：payload ref 的段数上限是 Demand 树深度上限减去 artifacts/managed-evidence/<id>/payload 的四层（open-items W10）", () => {
  // final record 的 payload 成员落在 Demand 根的第 (4 + ref 段数) 层；归档扫描以 Demand 根为深 0，成员深度即段数。
  equal(MANAGED_EVIDENCE_ROOT_REF.split("/").length + 2, 4);
  equal(MANAGED_EVIDENCE_PAYLOAD_LIMITS.maxDepth, WAKEFLOW_DEMAND_TREE_CAPACITY.maximumDepth - 4);
  equal(MANAGED_EVIDENCE_PAYLOAD_LIMITS.maxDepth, 20);
  const treeManifestWithRefDepth = (depth: number) => ({
    artifactKind: "wakeflow-loaded-artifact-tree",
    schemaVersion: 1,
    fileCount: 1,
    files: [
      {
        bytes: 1,
        digest: `sha256:${"0".repeat(64)}`,
        executable: false,
        ref: Array.from({ length: depth }, (_, index) => `d${index}`).join("/"),
      },
    ],
    totalBytes: 1,
  });
  // 20 段的 ref 落在 Demand 根第 24 层，恰在归档容量之内；21 段被 depth-limit 拒绝。
  equal(
    validateLoadedArtifactTreeManifest(treeManifestWithRefDepth(20), {
      limits: MANAGED_EVIDENCE_PAYLOAD_LIMITS,
    }).fileCount,
    1,
  );
  throws(
    () =>
      validateLoadedArtifactTreeManifest(treeManifestWithRefDepth(21), {
        limits: MANAGED_EVIDENCE_PAYLOAD_LIMITS,
      }),
    (error: unknown) =>
      error instanceof LoadedArtifactTreeIdentityError && error.reason === "depth-limit",
  );
});
