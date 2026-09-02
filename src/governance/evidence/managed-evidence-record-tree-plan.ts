import {
  parseWakeflowDurableIdOfKind,
  WakeflowDurableIdError,
  type WakeflowDurableId,
} from "../../contracts/identity/wakeflow-durable-id.js";
import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import {
  computeSha256Digest,
  parseSha256Digest,
  Sha256Error,
  type Sha256Digest,
} from "../../foundation/crypto/sha256.js";
import {
  parsePlainRecord,
  PassiveOwnDataError,
} from "../../foundation/data/passive-own-data.js";
import { LOADED_ARTIFACT_TREE_IDENTITY_LIMITS } from "../../foundation/artifact/loaded-artifact-tree-identity.js";
import {
  parseDirectoryTreeCandidatePlan,
  planDirectoryTreeCandidateFromFileDescriptors,
  DurableDirectoryTreeCandidateError,
  type DirectoryTreeCandidatePlan,
  type DirectoryTreeCandidatePlanFile,
} from "../../foundation/filesystem/durable-directory-tree-candidate.js";
import {
  parsePortableResourcePath,
  PortableResourcePathError,
  type PortableResourcePath,
} from "../../foundation/filesystem/portable-resource-path.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import {
  parseManagedEvidenceManifest,
  renderManagedEvidenceManifest,
  ManagedEvidenceManifestError,
  type ManagedEvidenceManifest,
} from "./managed-evidence-manifest.js";
import {
  managedEvidencePublicationStageRef,
  managedEvidenceRecordRootRef,
  MANAGED_EVIDENCE_MANIFEST_FILE_NAME,
  MANAGED_EVIDENCE_PAYLOAD_DIRECTORY_NAME,
} from "./managed-evidence-resource-paths.js";

/**
 * Wakeflow Governance / Evidence：完整final record tree的纯清单计划。
 *
 * 计划把确定性`manifest.json`文档和Manifest已闭合的payload文件描述符组合为一份
 * Foundation `DirectoryTreeCandidatePlan`。payload executable bit映射为私有0700，
 * 其他文件为0600，全部目录为0700。计划不读取source、不携带payload字节、不创建
 * stage、不决定Event顺序，也不把tree digest解释为业务Manifest摘要。
 *
 * 物理owner必须先完成payload，再最后写入manifest文件；该写入顺序属于后续事务，
 * 不改变按路径排序的清单身份。
 */

export const MANAGED_EVIDENCE_RECORD_TREE_PLAN_KIND =
  "wakeflow-managed-evidence-record-tree-plan" as const;
export const MANAGED_EVIDENCE_RECORD_TREE_PLAN_VERSION = 1 as const;
export const MANAGED_EVIDENCE_RECORD_DIRECTORY_MODE = 0o700;
export const MANAGED_EVIDENCE_RECORD_FILE_MODE = 0o600;
export const MANAGED_EVIDENCE_RECORD_EXECUTABLE_FILE_MODE = 0o700;

export interface ManagedEvidenceRecordTreePlan {
  readonly artifactKind: typeof MANAGED_EVIDENCE_RECORD_TREE_PLAN_KIND;
  readonly schemaVersion: typeof MANAGED_EVIDENCE_RECORD_TREE_PLAN_VERSION;
  readonly evidenceId: WakeflowDurableId<"evidence">;
  readonly manifest: Readonly<ManagedEvidenceManifest>;
  readonly manifestDocumentDigest: Sha256Digest;
  readonly candidateRootPath: PortableResourcePath;
  readonly destinationRootPath: PortableResourcePath;
  readonly directoryPlan: Readonly<DirectoryTreeCandidatePlan>;
  readonly planDigest: Sha256Digest;
}

export type ManagedEvidenceRecordTreePlanErrorReason =
  "input" | "identifier" | "manifest" | "capacity" | "path" | "plan";

const ERROR_MESSAGES = {
  input: "Managed evidence record tree plan input is invalid.",
  identifier: "Managed evidence record tree plan identity is invalid.",
  manifest: "Managed evidence record tree plan Manifest is invalid.",
  capacity: "Managed evidence record tree exceeds its admitted capacity.",
  path: "Managed evidence record tree paths are invalid.",
  plan: "Managed evidence record tree plan is inconsistent.",
} as const satisfies Readonly<
  Record<ManagedEvidenceRecordTreePlanErrorReason, string>
>;

/** Managed Evidence record tree无法形成关闭计划时的稳定错误。 */
export class ManagedEvidenceRecordTreePlanError extends Error {
  override readonly name = "ManagedEvidenceRecordTreePlanError";
  readonly code = "wakeflow-managed-evidence-record-tree-plan" as const;
  readonly reason: ManagedEvidenceRecordTreePlanErrorReason;
  readonly path: string;

  constructor(reason: ManagedEvidenceRecordTreePlanErrorReason, path: string) {
    super(ERROR_MESSAGES[reason]);
    this.reason = reason;
    this.path = path;
  }
}

interface ManagedEvidenceRecordTreePlanBasis {
  readonly artifactKind: typeof MANAGED_EVIDENCE_RECORD_TREE_PLAN_KIND;
  readonly schemaVersion: typeof MANAGED_EVIDENCE_RECORD_TREE_PLAN_VERSION;
  readonly evidenceId: WakeflowDurableId<"evidence">;
  readonly manifest: Readonly<ManagedEvidenceManifest>;
  readonly manifestDocumentDigest: Sha256Digest;
  readonly candidateRootPath: PortableResourcePath;
  readonly destinationRootPath: PortableResourcePath;
  readonly directoryPlan: Readonly<DirectoryTreeCandidatePlan>;
}

const PLAN_FIELDS = Object.freeze([
  "artifactKind",
  "candidateRootPath",
  "destinationRootPath",
  "directoryPlan",
  "evidenceId",
  "manifest",
  "manifestDocumentDigest",
  "planDigest",
  "schemaVersion",
] as const);
const RECORD_CAPACITY = Object.freeze({
  maximumDepth: LOADED_ARTIFACT_TREE_IDENTITY_LIMITS.maxDepth,
  maximumEntries: LOADED_ARTIFACT_TREE_IDENTITY_LIMITS.maxEntries,
  maximumFileBytes: LOADED_ARTIFACT_TREE_IDENTITY_LIMITS.maxFileBytes,
  maximumFiles: LOADED_ARTIFACT_TREE_IDENTITY_LIMITS.maxFiles,
  maximumTotalBytes: LOADED_ARTIFACT_TREE_IDENTITY_LIMITS.maxTotalBytes,
} as const);

function fail(
  reason: ManagedEvidenceRecordTreePlanErrorReason,
  path: string,
): never {
  throw new ManagedEvidenceRecordTreePlanError(reason, path);
}

function exactRecord(value: unknown): Readonly<Record<string, unknown>> {
  let record: Readonly<Record<string, unknown>>;
  try {
    record = parsePlainRecord(value, "$plan");
  } catch (error: unknown) {
    if (error instanceof PassiveOwnDataError) fail("input", "$plan");
    throw error;
  }
  const actual = Object.keys(record).sort();
  const expected = [...PLAN_FIELDS].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    fail("input", "$plan");
  }
  return record;
}

function parseManifest(value: unknown): Readonly<ManagedEvidenceManifest> {
  try {
    return parseManagedEvidenceManifest(value);
  } catch (error: unknown) {
    if (error instanceof ManagedEvidenceManifestError) {
      if (error.reason === "capacity") fail("capacity", "$/manifest");
      fail("manifest", "$/manifest");
    }
    throw error;
  }
}

function parseEvidenceId(value: unknown): WakeflowDurableId<"evidence"> {
  try {
    return parseWakeflowDurableIdOfKind(value, "evidence", "$/evidenceId");
  } catch (error: unknown) {
    if (error instanceof WakeflowDurableIdError) {
      fail("identifier", "$/evidenceId");
    }
    throw error;
  }
}

function parsePath(value: unknown, path: string): PortableResourcePath {
  try {
    return parsePortableResourcePath(value, path);
  } catch (error: unknown) {
    if (error instanceof PortableResourcePathError) fail("path", path);
    throw error;
  }
}

function parseDigest(value: unknown, path: string): Sha256Digest {
  try {
    return parseSha256Digest(value, path);
  } catch (error: unknown) {
    if (error instanceof Sha256Error) fail("plan", path);
    throw error;
  }
}

function parseDirectoryPlan(
  value: unknown,
): Readonly<DirectoryTreeCandidatePlan> {
  try {
    return parseDirectoryTreeCandidatePlan(value, RECORD_CAPACITY);
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryTreeCandidateError) {
      if (error.reason === "capacity") fail("capacity", "$/directoryPlan");
      fail("plan", "$/directoryPlan");
    }
    throw error;
  }
}

function payloadPath(ref: PortableResourcePath): PortableResourcePath {
  return parsePortableResourcePath(
    `${MANAGED_EVIDENCE_PAYLOAD_DIRECTORY_NAME}/${ref}`,
  );
}

function planFiles(
  manifest: Readonly<ManagedEvidenceManifest>,
  manifestDocument: Uint8Array,
): readonly Readonly<DirectoryTreeCandidatePlanFile>[] {
  return Object.freeze([
    Object.freeze({
      path: parsePortableResourcePath(MANAGED_EVIDENCE_MANIFEST_FILE_NAME),
      byteCount: parseByteCount(
        manifestDocument.byteLength,
        "$manifestDocument",
      ),
      digest: computeSha256Digest(manifestDocument, "$manifestDocument"),
      mode: MANAGED_EVIDENCE_RECORD_FILE_MODE,
    }),
    ...manifest.payload.treeManifest.files.map((file) =>
      Object.freeze({
        path: payloadPath(file.ref),
        byteCount: file.bytes,
        digest: file.digest,
        mode: file.executable
          ? MANAGED_EVIDENCE_RECORD_EXECUTABLE_FILE_MODE
          : MANAGED_EVIDENCE_RECORD_FILE_MODE,
      }),
    ),
  ]);
}

function buildBasis(
  manifest: Readonly<ManagedEvidenceManifest>,
): Readonly<ManagedEvidenceRecordTreePlanBasis> {
  const manifestDocument = encodeUtf8(
    renderManagedEvidenceManifest(manifest),
    "$manifestDocument",
  );
  let directoryPlan: Readonly<DirectoryTreeCandidatePlan>;
  try {
    directoryPlan = planDirectoryTreeCandidateFromFileDescriptors(
      planFiles(manifest, manifestDocument),
      {
        directoryMode: MANAGED_EVIDENCE_RECORD_DIRECTORY_MODE,
        ...RECORD_CAPACITY,
      },
    );
  } catch (error: unknown) {
    if (error instanceof DurableDirectoryTreeCandidateError) {
      if (error.reason === "capacity") fail("capacity", "$/manifest/payload");
      fail("plan", "$/manifest/payload");
    }
    throw error;
  }
  return Object.freeze({
    artifactKind: MANAGED_EVIDENCE_RECORD_TREE_PLAN_KIND,
    schemaVersion: MANAGED_EVIDENCE_RECORD_TREE_PLAN_VERSION,
    evidenceId: manifest.evidenceId,
    manifest,
    manifestDocumentDigest: computeSha256Digest(
      manifestDocument,
      "$manifestDocument",
    ),
    candidateRootPath: managedEvidencePublicationStageRef(manifest.evidenceId),
    destinationRootPath: managedEvidenceRecordRootRef(manifest.evidenceId),
    directoryPlan,
  });
}

/** 严格重验Manifest文档、payload映射、stage/final路径和完整计划摘要。 */
export function parseManagedEvidenceRecordTreePlan(
  value: unknown,
): Readonly<ManagedEvidenceRecordTreePlan> {
  const record = exactRecord(value);
  if (
    record.artifactKind !== MANAGED_EVIDENCE_RECORD_TREE_PLAN_KIND ||
    record.schemaVersion !== MANAGED_EVIDENCE_RECORD_TREE_PLAN_VERSION
  ) {
    fail("input", "$plan");
  }
  const manifest = parseManifest(record.manifest);
  const evidenceId = parseEvidenceId(record.evidenceId);
  const manifestDocumentDigest = parseDigest(
    record.manifestDocumentDigest,
    "$/manifestDocumentDigest",
  );
  const candidateRootPath = parsePath(
    record.candidateRootPath,
    "$/candidateRootPath",
  );
  const destinationRootPath = parsePath(
    record.destinationRootPath,
    "$/destinationRootPath",
  );
  const directoryPlan = parseDirectoryPlan(record.directoryPlan);
  const planDigest = parseDigest(record.planDigest, "$/planDigest");
  const expected = buildBasis(manifest);
  if (
    evidenceId !== expected.evidenceId ||
    manifestDocumentDigest !== expected.manifestDocumentDigest ||
    candidateRootPath !== expected.candidateRootPath ||
    destinationRootPath !== expected.destinationRootPath ||
    computeCanonicalJsonSha256Digest(directoryPlan) !==
      computeCanonicalJsonSha256Digest(expected.directoryPlan)
  ) {
    fail("plan", "$plan");
  }
  const basis = Object.freeze({
    ...expected,
    directoryPlan,
  });
  if (planDigest !== computeCanonicalJsonSha256Digest(basis, "$plan")) {
    fail("plan", "$/planDigest");
  }
  return Object.freeze({ ...basis, planDigest });
}

/** 从完整Manifest编译一份零I/O、确定性的final record tree计划。 */
export function planManagedEvidenceRecordTree(
  manifestValue: unknown,
): Readonly<ManagedEvidenceRecordTreePlan> {
  const basis = buildBasis(parseManifest(manifestValue));
  return parseManagedEvidenceRecordTreePlan({
    ...basis,
    planDigest: computeCanonicalJsonSha256Digest(basis, "$plan"),
  });
}
